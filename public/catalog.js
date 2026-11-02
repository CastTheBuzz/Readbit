// The book catalog (built from Project Gutenberg by deploy.bat), loaded once and kept on the phone.
import { CATS } from './cats.js';

export const C = { ready: false, n: 0, built: '', ids: null, title: [], auth: [], lang: [], pages: null, dl: null, mask: null, year: null, authors: [], byId: new Map(), authorBooks: null, _search: null };
let loading;

export function load() {
  return loading ||= (async () => {
    const r = await fetch('/catalog/books.json');
    if (!r.ok) throw new Error('The book catalog is missing. Run deploy.bat on your PC.');
    const d = await r.json();
    const n = d.books.length;
    C.n = n; C.built = d.built; C.authors = d.authors.map(parseAuthor);
    C.ids = new Int32Array(n); C.pages = new Int32Array(n); C.dl = new Int32Array(n); C.mask = new Int32Array(n); C.year = new Int16Array(n);
    C.title = new Array(n); C.auth = new Array(n); C.lang = new Array(n);
    // the server's category order may differ from this app version's: remap bits by key
    const remap = d.cats.map(k => CATS.findIndex(c => c.key === k));
    const same = remap.every((v, i) => v === i);
    C.authorBooks = new Map();
    d.books.forEach((b, i) => {
      C.ids[i] = b[0]; C.title[i] = b[1]; C.auth[i] = Array.isArray(b[2]) ? b[2] : [b[2]];
      C.lang[i] = b[3]; C.pages[i] = b[4]; C.dl[i] = b[5]; C.year[i] = b[7] || 0;
      let m = b[6];
      if (!same) { let m2 = 0; remap.forEach((to, from) => { if (to >= 0 && (m & (1 << from))) m2 |= 1 << to; }); m = m2; }
      C.mask[i] = m;
      C.byId.set(b[0], i);
      for (const a of C.auth[i]) { if (!C.authorBooks.has(a)) C.authorBooks.set(a, []); C.authorBooks.get(a).push(i); }
    });
    C.ready = true;
    return C;
  })().catch(e => { loading = null; throw e; });
}

function parseAuthor(s) {
  const [raw, b, d] = s.split('|');
  let name = raw.replace(/\s*\([^)]*\)/g, '').trim();
  const i = name.indexOf(',');
  if (i > 0 && name.indexOf(',', i + 1) < 0) {
    const last = name.slice(0, i).trim(), first = name.slice(i + 1).trim();
    if (first && !/\b(of|the|de|von|emperor|king|queen|saint|pope|duke|earl|lord|sir)\b/i.test(first) && first.split(' ').length <= 4) name = `${first} ${last}`;
    else if (/\b(emperor|king|queen|pope|duke|earl)\b/i.test(first)) name = last;
  }
  return { raw, name, b: b ? +b : null, d: d ? +d : null };
}

export const idx = id => C.byId.get(+id);
export const authorName = i => C.auth[i].map(a => C.authors[a]?.name || 'Unknown').join(', ');
export const authorLife = a => { const x = C.authors[a]; return x && (x.b || x.d) ? `${x.b ?? '?'}–${x.d ?? ''}` : ''; };
export const hasCat = (i, key) => (C.mask[i] & (1 << CATS.findIndex(c => c.key === key))) !== 0;
export const catsOf = i => CATS.filter((c, b) => C.mask[i] & (1 << b));
export const coverUrl = id => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
export function readTime(pages) {
  const m = Math.round(pages * 1.6);
  return m < 60 ? `${Math.max(5, Math.round(m / 5) * 5)} min` : `${Math.round(m / 60)} h`;
}
export const lengthBand = p => (p <= 0 ? '' : p < 100 ? 'short' : p < 250 ? 'medium' : p < 500 ? 'long' : 'very long');

const info = new Map();
export async function bookInfo(id) {
  const shard = id % 400;
  if (!info.has(shard)) info.set(shard, fetch(`/catalog/info/${shard}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})));
  const s = await info.get(shard);
  return s[id] || {};
}

// ---------- search ----------
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ëç ]+/g, ' ').replace(/\s+/g, ' ').trim();
function ensureIdx() {
  if (!C._search) C._search = C.title.map((t, i) => ({ t: norm(t), a: norm(C.auth[i].map(a => C.authors[a]?.raw + ' ' + C.authors[a]?.name).join(' ')) }));
}
export function search(q, filter = () => true) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  ensureIdx();
  const nq = words.join(' ');
  const out = [];
  for (let i = 0; i < C.n; i++) {
    const s = C._search[i];
    let score = 0, ok = true;
    for (const w of words) {
      const inT = s.t.includes(w), inA = s.a.includes(w);
      if (!inT && !inA) { ok = false; break; }
      score += (inT ? 2 : 0) + (inA ? 1.5 : 0) + (new RegExp('\\b' + w.replace(/[^a-z0-9]/g, '')).test(s.t) ? 1 : 0);
    }
    if (!ok || !filter(i)) continue;
    if (s.t === nq) score += 8; else if (s.t.startsWith(nq)) score += 4;
    out.push([i, score + Math.log10(C.dl[i] + 1)]);
  }
  return out.sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

export function findBook(title, author) {
  const t = norm(title), a = norm(author);
  ensureIdx();
  let best = -1;
  for (let i = 0; i < C.n; i++) {
    const s = C._search[i];
    if (!s.t.startsWith(t)) continue;
    if (a && !s.a.includes(a)) continue;
    if (best < 0 || C.dl[i] > C.dl[best]) best = i;
  }
  return best;
}
