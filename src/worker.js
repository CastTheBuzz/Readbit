// Readbit — server side. Static app + catalog are served from ./public by Cloudflare;
// this worker handles /api/*: sign-in, syncing your shelves/progress, fetching books and audiobooks.
const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const UA = 'Readbit/1.0 (personal reading app; one reader)';
const COOKIE = 'rb_s';
const YEAR = 365 * 864e5;

function eqBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function checkPass(env, pass) {
  // PASS_HASH = pbkdf2$<iterations>$<salt b64>$<hash b64>  (made by setup.mjs)
  const [kind, iter, salt, want] = String(env.PASS_HASH || '').split('$');
  if (kind !== 'pbkdf2' || !want) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: +iter }, key, 256);
  return eqBytes(new Uint8Array(bits), unb64(want));
}

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

async function session(req, env) {
  const tok = cookie(req, COOKIE);
  if (!tok || tok.length > 100) return null;
  const id = await sha(tok);
  const row = await env.DB.prepare('SELECT id, seen FROM sessions WHERE id = ?').bind(id).first();
  if (!row) return null;
  const now = Date.now();
  if (now - row.seen > 864e5) await env.DB.prepare('UPDATE sessions SET seen = ? WHERE id = ?').bind(now, id).run();
  if (now - row.seen > YEAR) { await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run(); return null; }
  return id;
}

const sessionCookie = (tok, age) =>
  `${COOKIE}=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

async function login(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  await env.DB.prepare('DELETE FROM attempts WHERE t < ?').bind(now - 15 * 6e4).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE ip = ?').bind(ip).first();
  if (n >= 8) return fail('Too many wrong tries. Wait 15 minutes and try again.', 429);
  let body = {};
  try { body = await req.json(); } catch {}
  if (!body.pass || !(await checkPass(env, body.pass))) {
    await env.DB.prepare('INSERT INTO attempts (ip, t) VALUES (?, ?)').bind(ip, now).run();
    return fail(env.PASS_HASH ? 'Wrong passphrase.' : 'Readbit has no passphrase yet. Run deploy.bat on your PC.', 401);
  }
  const tok = hex(crypto.getRandomValues(new Uint8Array(32)));
  const agent = (req.headers.get('user-agent') || '').slice(0, 200);
  await env.DB.prepare('INSERT INTO sessions (id, created, seen, agent) VALUES (?, ?, ?, ?)').bind(await sha(tok), now, now, agent).run();
  await env.DB.prepare('DELETE FROM attempts WHERE ip = ?').bind(ip).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(tok, YEAR / 1000) });
}

// ---------- your data (shelves, positions, highlights, settings) ----------
async function getState(url, env) {
  const since = Math.max(0, +url.searchParams.get('since') || 0), after = url.searchParams.get('after') || '';
  const now = Date.now();
  const { results } = await env.DB.prepare('SELECT k, v, u, s FROM state WHERE s > ?1 OR (s = ?1 AND k > ?2) ORDER BY s, k LIMIT 5000').bind(since, after).all();
  return json({ items: results.map(r => ({ k: r.k, v: r.v === null ? null : JSON.parse(r.v), u: r.u, s: r.s })), now, more: results.length === 5000 });
}

async function putState(req, env) {
  let body;
  try { body = await req.json(); } catch { return fail('Bad data'); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
  const now = Date.now();
  const stmts = [];
  for (const it of items) {
    if (typeof it.k !== 'string' || !it.k || it.k.length > 120) continue;
    const v = it.v === null || it.v === undefined ? null : JSON.stringify(it.v);
    if (v && v.length > 200000) continue;
    const u = Math.min(+it.u || now, now + 6e4);
    stmts.push(env.DB.prepare(
      'INSERT INTO state (k, v, u, s) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = excluded.v, u = excluded.u, s = excluded.s WHERE excluded.u > state.u'
    ).bind(it.k, v, u, now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, saved: stmts.length, now });
}

// ---------- books ----------
async function cached(req, key, maxAge, make) {
  const cache = caches.default;
  const ck = new Request(new URL(key, req.url).toString());
  let res = await cache.match(ck);
  if (res) return res;
  res = await make();
  if (res.ok) {
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', `public, max-age=${+copy.headers.get('x-ttl') || maxAge}`);
    copy.headers.delete('x-ttl');
    const [a, b] = copy.body.tee();
    const store = new Response(a, copy), give = new Response(b, copy);
    await cache.put(ck, store).catch(() => {});
    return give;
  }
  return res;
}

async function epub(req, env, id, url) {
  const G = env.GUTENBERG || 'https://www.gutenberg.org';
  const res = await cached(req, `/__cache/epub/${id}`, 30 * 86400, async () => {
    let missing = 0;
    for (const name of [`pg${id}-images-3.epub`, `pg${id}-images.epub`, `pg${id}.epub`]) {
      const r = await fetch(`${G}/cache/epub/${id}/${name}`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 86400 } }).catch(() => null);
      if (r?.ok) return new Response(r.body, { headers: { 'content-type': 'application/epub+zip' } });
      if (r?.status === 404) missing++;
    }
    return missing === 3
      ? fail('Project Gutenberg has no e-book file for this title (it may be audio or images only).', 404)
      : fail('This book could not be downloaded from Project Gutenberg right now. Try again later.', 502);
  });
  if (!res.ok) return res;
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'private, max-age=86400');
  if (url.searchParams.get('dl')) {
    const name = (url.searchParams.get('name') || `book-${id}`).replace(/[^\p{L}\p{N} ,.'-]+/gu, '').slice(0, 80).trim() || `book-${id}`;
    out.headers.set('content-disposition', `attachment; filename="book-${id}.epub"; filename*=UTF-8''${encodeURIComponent(name)}.epub`);
  }
  return out;
}

const safeUrl = u => (/^https:\/\//i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) ? u : '');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function audio(req, env, url) {
  const title = (url.searchParams.get('title') || '').split(/[:;]| or,? /i)[0].trim().slice(0, 120);
  const author = norm(url.searchParams.get('author') || '').split(' ')[0] || '';   // catalog names are "Last, First"
  if (!title) return fail('No title');
  const L = env.LIBRIVOX || 'https://librivox.org';
  const key = `/__cache/audio/${encodeURIComponent(norm(title))}/${encodeURIComponent(author)}`;
  return cached(req, key, 7 * 86400, async () => {
    const q = `${L}/api/feed/audiobooks/?format=json&extended=1&limit=20&title=${encodeURIComponent('^' + title)}`;
    const r = await fetch(q, { headers: { 'user-agent': UA } }).catch(() => null);
    if (!r) return fail('Could not reach LibriVox right now. Try again later.', 502);
    let data;
    try { data = await r.json(); } catch { return fail('LibriVox did not answer properly. Try again later.', 502); }
    if (!r.ok && !(data && data.error)) return fail('LibriVox is having problems right now. Try again later.', 502);
    const books = (data.books || []).filter(b => {
      const names = (b.authors || []).map(a => norm(`${a.last_name} ${a.first_name}`)).join(' ');
      return !author || names.includes(author);
    }).map(b => ({
      id: b.id, title: b.title, language: b.language, total: b.totaltime, url: safeUrl((b.url_librivox || '').replace(/^http:/, 'https:')),
      readers: [...new Set((b.sections || []).flatMap(s => (s.readers || []).map(x => x.display_name)))].slice(0, 4),
      sections: (b.sections || []).map(s => ({ n: +s.section_number, title: s.title, url: (s.listen_url || '').replace(/^http:\/\/(?!127\.0\.0\.1|localhost)/, 'https://'), secs: +s.playtime || 0 }))
        .filter(s => safeUrl(s.url)).sort((a, b) => a.n - b.n),
    })).filter(b => b.sections.length);
    return json({ books }, 200, books.length ? {} : { 'x-ttl': '86400' });
  });
}

// ---------- router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (req.method === 'POST') {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) return fail('Blocked', 403);
      }
      if (p === '/api/login' && req.method === 'POST') return await login(req, env);
      const sid = await session(req, env);
      if (!sid) return fail('Please sign in', 401);
      if (p === '/api/me') return json({ ok: true });
      if (p === '/api/logout' && req.method === 'POST') {
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
      }
      if (p === '/api/logout-all' && req.method === 'POST') {
        await env.DB.prepare('DELETE FROM sessions').run();
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
      }
      if (p === '/api/state') return req.method === 'POST' ? await putState(req, env) : await getState(url, env);
      let m = p.match(/^\/api\/epub\/(\d{1,7})$/);
      if (m) return await epub(req, env, +m[1], url);
      if (p === '/api/audio') return await audio(req, env, url);
      return fail('Not found', 404);
    } catch (e) {
      console.error(e);
      return fail('Something went wrong on the server. Try again.', 500);
    }
  },
};
