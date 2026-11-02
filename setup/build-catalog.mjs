// Builds Readbit's book catalog from Project Gutenberg's official catalog files.
// Run by setup.mjs (deploy.bat). Usage: node setup/build-catalog.mjs [--refresh] [path-or-url-to-rdf-files.tar.bz2]
// Output: public/catalog/books.json + public/catalog/info/<n>.json (summaries, subjects)
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { CATS, BIT } from '../public/cats.js';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'setup', 'cache');
const OUT = join(ROOT, 'public', 'catalog');
const SRC_URL = 'https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.bz2';
const LANGS = new Set(['en', 'sq', 'fr', 'de']);
export const SHARDS = 400;
const MAX_AGE_DAYS = 30;


// ---------- helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const dec = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const clean = s => dec(s).replace(/\s+/g, ' ').trim();
const blocks = (xml, tag) => { const out = [], re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g'); let m; while ((m = re.exec(xml))) out.push(m[0]); return out; };
const one = (xml, re) => { const m = xml.match(re); return m ? m[1] : null; };
const values = b => [...b.matchAll(/<rdf:value[^>]*>([\s\S]*?)<\/rdf:value>/g)].map(m => clean(m[1]));

// ---------- category rules ----------
const has = (hay, re) => re.test(hay);
function categorize({ subjects, lcc, shelves, downloads }) {
  const s = subjects.join(' | ').toLowerCase();
  const sh = shelves.join(' | ').toLowerCase();
  const all = s + ' | ' + sh;
  const L = lcc.map(x => x.toUpperCase());
  const lccIs = (...p) => L.some(c => p.some(x => c === x || (c.startsWith(x) && !/[A-Z]/.test(c[x.length] || ''))));
  const lccIn = (from, to, letter) => L.some(c => c.length >= 2 && c[0] === letter && c.slice(0, 2) >= from && c.slice(0, 2) <= to);
  let m = 0;
  const fiction = has(all, /fiction|short stories|novels|novellas|fairy tales|fables|legends/) || lccIs('PZ');
  if (fiction) m |= BIT.fiction;
  const lifeSubj = subjects.some(x => /biograph|autobiograph|memoir|diaries|correspondence|personal narratives|^letters\b|-- letters/i.test(x) && !/fiction/i.test(x));
  if (lifeSubj || lccIs('CT') || has(sh, /biograph|memoir/)) m |= BIT.life;
  if (has(all, /philosoph|ethics|stoic|metaphysic|existential|epistemolog/) || (lccIs('B') || lccIn('BA', 'BD', 'B') || lccIs('BH', 'BJ'))) m |= BIT.ideas;
  if (has(all, /psycholog|mind and body|mental |consciousness|dreams|subconscious/) || lccIs('BF')) m |= BIT.mind;
  if (has(all, /religio|christian|bible|buddh|islam|hindu|spiritual|theolog|mystic|sermons|prayers|church|god\b|jesus/) || lccIn('BL', 'BX', 'B')) m |= BIT.faith;
  if (has(all, /economics|finance|money|wealth|business|banks and banking|investment|capital|commerce|political economy|stock exchange|speculation|accounting|entrepreneur|labor|salesmanship|thrift|saving and/) || lccIn('HB', 'HJ', 'H')) m |= BIT.money;
  if (has(all, /conduct of life|success|self-culture|self-help|self-realization|character|happiness|will power|new thought|mental discipline|habit|motivation|attitude/)) m |= BIT.growth;
  if ((has(s, /history|historical/) && !fiction) || lccIs('C', 'D', 'E', 'F') || lccIn('CA', 'CS', 'C') || lccIn('DA', 'DX', 'D')) m |= BIT.history;
  if (has(all, /political science|politic|sociolog|social |socialism|government|democracy|law\b|slavery|women's rights|feminism|civilization/) || lccIs('J', 'K') || lccIn('HM', 'HX', 'H') || lccIn('JA', 'JZ', 'J') || lccIn('KA', 'KZ', 'K')) m |= BIT.society;
  if ((has(all, /science|natural history|physics|astronomy|biology|chemistry|evolution|mathematic|geology|botany|zoology|birds|insects|animals|nature/) && !fiction) || lccIs('Q') || lccIn('QA', 'QR', 'Q')) m |= BIT.science;
  if (has(all, /adventure|sea stories|western stories|pirates|treasure|explorers|survival|frontier and pioneer|shipwreck/)) m |= BIT.adventure;
  if (has(all, /detective|mystery|crime|murder|police|criminals|spy stories|thriller|suspense/)) m |= BIT.mystery;
  if (has(all, /love stories|romance|courtship|man-woman relationship|married people|love --|love$/)) m |= BIT.romance;
  if (has(all, /science fiction|fantasy|fantastic|utopia|dystopia|time travel|imaginary voyages|space|magic|dragons|extraterrestrial/)) m |= BIT.scifi;
  if (has(all, /horror|ghost|gothic|supernatural|vampire|werewolves|haunted|occult/)) m |= BIT.horror;
  if (has(all, /humor|humorous|wit and humor|satire|comic|parodies/)) m |= BIT.humor;
  if (has(all, /\bwar\b|wars|military|soldier|battle|army|navy|warfare/)) m |= BIT.war;
  if (has(all, /poetry|poems|verse|sonnets|ballads|odes/)) m |= BIT.poetry;
  if (has(all, /drama|plays|tragedies|comedies|theater|one-act/)) m |= BIT.drama;
  if (has(all, /description and travel|voyages and travels|travel|guidebooks|explorations/)) m |= BIT.travel;
  if (has(all, /juvenile|children|fairy tales|nursery|picture books|school stories/) || lccIs('PZ')) m |= BIT.kids;
  if (has(all, /sport|games|hunting|fishing|athlet|outdoor|boxing|baseball|football|cricket|golf|mountaineering|cycling|swimming|physical education|exercise/) || lccIs('GV')) m |= BIT.sport;
  if (has(all, /\bart\b|painting|painters|music|musicians|architecture|sculpture|drawing|photography|design/) || lccIs('M', 'N') || lccIn('NA', 'NX', 'N') || lccIn('ML', 'MT', 'M')) m |= BIT.arts;
  if (has(all, /health|hygiene|medicine|medical|nutrition|diet|disease|physiology|nursing|anatomy/) || lccIs('R') || lccIn('RA', 'RZ', 'R')) m |= BIT.health;
  if (has(all, /cookery|cooking|recipes|household|gardening|home economics|beverages|wine|food/) || lccIs('TX')) m |= BIT.food;
  if (has(sh, /best books ever|harvard classics|classics of literature|literature/) || downloads >= 2000) m |= BIT.classics;
  if (has(all, /periodicals|magazine|journal|newspapers|almanacs/) || lccIs('AP', 'AY')) m |= BIT.periodicals;
  const deepSubj = has(all, /psychological fiction|philosophical fiction|allegor|parables|existential|conduct of life|stoic|meaning|death --|good and evil|redemption|conscience|alienation|social classes -- fiction|loneliness|self-realization|didactic fiction|bildungsroman|coming of age|spiritual life/);
  if (deepSubj || ((m & BIT.ideas) && downloads >= 150) || ((m & BIT.fiction) && (m & BIT.classics) && has(all, /psycholog|philosoph|moral|conscience|society/))) m |= BIT.deep;
  return m;
}

// ---------- RDF record ----------
function parseRdf(xml) {
  const id = +one(xml, /<pgterms:ebook rdf:about="ebooks\/(\d+)"/);
  if (!id) return null;
  const type = blocks(xml, 'dcterms:type').flatMap(values)[0];
  if (type && type !== 'Text') return null;
  const langs = blocks(xml, 'dcterms:language').flatMap(values).map(l => l.toLowerCase().slice(0, 2));
  const lang = langs.find(l => LANGS.has(l));
  if (!lang) return null;
  let title = one(xml, /<dcterms:title[^>]*>([\s\S]*?)<\/dcterms:title>/);
  if (!title) return null;
  title = dec(title).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean).join(': ').replace(/\s+/g, ' ').trim();
  if (/^(the )?project gutenberg|index of the project gutenberg|gutenberg (catalog|index)/i.test(title)) return null;
  const authors = [];
  for (const tag of ['dcterms:creator', 'marcrel:aut']) for (const b of blocks(xml, tag)) {
    const name = one(b, /<pgterms:name>([\s\S]*?)<\/pgterms:name>/);
    if (name) authors.push({ name: clean(name), b: one(b, /<pgterms:birthdate[^>]*>(-?\d+)</) || '', d: one(b, /<pgterms:deathdate[^>]*>(-?\d+)</) || '' });
  }
  if (!authors.length) for (const tag of ['marcrel:edt', 'marcrel:com', 'marcrel:ctb']) for (const b of blocks(xml, tag)) {
    const name = one(b, /<pgterms:name>([\s\S]*?)<\/pgterms:name>/);
    if (name) authors.push({ name: clean(name) + (tag === 'marcrel:edt' ? ' (ed.)' : ''), b: '', d: '' });
  }
  const translators = blocks(xml, 'marcrel:trl').map(b => one(b, /<pgterms:name>([\s\S]*?)<\/pgterms:name>/)).filter(Boolean).map(clean);
  const subjects = [], lcc = [];
  for (const b of blocks(xml, 'dcterms:subject')) {
    const v = values(b)[0]; if (!v) continue;
    if (/dcterms\/LCC"|terms\/LCC"/.test(b)) lcc.push(v); else subjects.push(v);
  }
  const shelves = blocks(xml, 'pgterms:bookshelf').flatMap(values);
  const downloads = +(one(xml, /<pgterms:downloads[^>]*>(\d+)</) || 0);
  let summary = one(xml, /<pgterms:marc520>([\s\S]*?)<\/pgterms:marc520>/);
  summary = summary ? clean(summary).replace(/\s*\(This is an automatically generated summary\.\)\s*$/i, '') : '';
  const issued = one(xml, /<dcterms:issued[^>]*>(\d{4})/);
  let txt = 0, html = 0, epub = 0;
  for (const f of blocks(xml, 'pgterms:file')) {
    const url = one(f, /rdf:about="([^"]+)"/) || '';
    const size = +(one(f, /<dcterms:extent[^>]*>(\d+)</) || 0);
    const fmt = values(f).join(' ');
    if (/text\/plain/.test(fmt)) txt = Math.max(txt, size);
    else if (/text\/html/.test(fmt)) html = Math.max(html, size);
    else if (/epub/.test(fmt) || /\.epub/.test(url)) epub = Math.max(epub, size);
  }
  const pages = txt ? Math.round(txt / 2000) : html ? Math.round(html / 2900) : epub ? Math.round(epub / 1300) : 0;
  return { id, title, authors, translators, lang, subjects, lcc, shelves, downloads, summary, issued, pages: Math.max(pages, txt || html || epub ? 1 : 0) };
}

// ---------- tar stream reader (only what Gutenberg's archive needs) ----------
function tarReader(onFile) {
  let buf = Buffer.alloc(0), mode = 'header', name = '', size = 0, want = false, meta = false, longName = '', parts = [], got = 0, pad = 0;
  // GNU long name ('L': the data is the name) or pax header ('x': "len path=...\n" records) apply to the next file
  return chunk => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let off = 0;
    for (;;) {
      if (mode === 'header') {
        if (buf.length - off < 512) break;
        const h = buf.subarray(off, off + 512); off += 512;
        if (h.every(x => x === 0)) continue;
        name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
        if (prefix) name = prefix + '/' + name;
        size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim() || '0', 8) || 0;
        const flag = String.fromCharCode(h[156] || 48);
        if (longName) { name = longName; longName = ''; }
        meta = flag === 'L' || flag === 'x' ? flag : false;
        want = meta || ((flag === '0' || flag === '\0') && name.endsWith('.rdf'));
        parts = []; got = 0; pad = (512 - (size % 512)) % 512;
        mode = size ? 'body' : 'header';
      } else if (mode === 'body') {
        const take = Math.min(size - got, buf.length - off);
        if (take <= 0) break;
        if (want) parts.push(buf.subarray(off, off + take));
        off += take; got += take;
        if (got === size) {
          if (meta) { const t = Buffer.concat(parts).toString('utf8'); if (meta === 'L') longName = t.replace(/\0.*$/s, ''); else { const m = t.match(/\d+ path=([^\n]*)\n/); if (m) longName = m[1]; } }
          else if (want) onFile(name, Buffer.concat(parts).toString('utf8'));
          parts = []; mode = pad ? 'pad' : 'header';
        }
      } else {
        if (buf.length - off < pad) break;
        off += pad; mode = 'header';
      }
    }
    buf = off >= buf.length ? Buffer.alloc(0) : Buffer.from(buf.subarray(off));
  };
}

// ---------- download ----------
async function getSource({ refresh = false, src: srcArg } = {}) {
  if (srcArg && !/^https?:/.test(srcArg)) return srcArg;
  const url = srcArg || SRC_URL;
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, 'rdf-files.tar.bz2');
  const fresh = existsSync(file) && (Date.now() - statSync(file).mtimeMs) / 864e5 < MAX_AGE_DAYS && statSync(file).size > 1e6;
  if (fresh && !refresh) { console.log('  Using the catalog downloaded on ' + new Date(statSync(file).mtimeMs).toLocaleDateString()); return file; }
  console.log('  Downloading the Project Gutenberg catalog (about 100 MB, once a month)...');
  const res = await fetch(url, { headers: { 'User-Agent': 'Readbit/1.0 (personal reading app)' } });
  if (!res.ok || !res.body) throw new Error(`Catalog download failed (HTTP ${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  let done = 0, last = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', c => { done += c.length; const p = total ? Math.floor(done / total * 100) : Math.floor(done / 1e7); if (p !== last) { last = p; process.stdout.write(total ? `\r  ${p}%   ` : `\r  ${(done / 1e6).toFixed(0)} MB   `); } });
  await pipeline(src, createWriteStream(file + '.part'));
  process.stdout.write('\n');
  renameSync(file + '.part', file);
  return file;
}

// ---------- main ----------
export async function build(opts = {}) {
  const file = await getSource(opts);
  console.log('  Reading the catalog (a few minutes)...');
  const unbz = require('unbzip2-stream');
  const books = [];
  let seen = 0;
  const feed = tarReader((name, xml) => {
    seen++;
    if (seen % 5000 === 0) process.stdout.write(`\r  ${seen} records read, ${books.length} books kept   `);
    try { const b = parseRdf(xml); if (b) books.push(b); } catch {}
  });
  await new Promise((resolve, reject) => {
    const s = createReadStream(file).pipe(unbz());
    s.on('data', feed); s.on('end', resolve); s.on('error', reject);
  });
  process.stdout.write('\n');
  if (books.length < 100) throw new Error(`Only ${books.length} books found — the catalog file looks broken. Run with --refresh.`);

  books.sort((a, b) => b.downloads - a.downloads || a.id - b.id);
  const authors = [], aIdx = new Map();
  const rows = books.map(b => {
    const ai = b.authors.map(a => {
      const k = `${a.name}|${a.b}|${a.d}`;
      if (!aIdx.has(k)) { aIdx.set(k, authors.length); authors.push(k); }
      return aIdx.get(k);
    });
    const mask = categorize(b);
    return [b.id, b.title, ai.length === 1 ? ai[0] : ai, b.lang, b.pages, b.downloads, mask, b.issued ? +b.issued : 0];
  });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'info'), { recursive: true });
  const built = new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT, 'books.json'), JSON.stringify({ v: 1, built, count: rows.length, cats: CATS.map(c => c.key), authors, books: rows }));
  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const b of books) {
    const o = {};
    if (b.summary) o.s = b.summary;
    if (b.subjects.length) o.sub = b.subjects.slice(0, 8);
    if (b.shelves.length) o.sh = b.shelves.slice(0, 6);
    if (b.translators.length) o.tr = b.translators;
    shards[b.id % SHARDS][b.id] = o;
  }
  shards.forEach((s, i) => writeFileSync(join(OUT, 'info', `${i}.json`), JSON.stringify(s)));
  const byCat = CATS.map((c, i) => `${c.name}: ${rows.filter(r => r[6] & (1 << i)).length}`);
  console.log(`  ✓ ${rows.length} books (${['en', 'sq', 'fr', 'de'].map(l => l + ' ' + rows.filter(r => r[3] === l).length).join(', ')})`);
  return { count: rows.length, built, byCat };
}

export { parseRdf, categorize, tarReader };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  build({ refresh: args.includes('--refresh'), src: args.find(a => !a.startsWith('--')) }).then(r => { console.log('  ' + r.byCat.join(' · ')); }).catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
}
