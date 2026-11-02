// Recommendations — worked out on the phone from what you pick, read, finish, like and drop.
import { C, findBook } from './catalog.js';
import { CATS, BIT } from './cats.js';
import * as store from './store.js';

// Hand-picked starting points that fit "deep messages, real lives, money". Missing ones are skipped.
export const STARTERS = [
  ['Meditations', 'Marcus Aurelius'], ['Walden', 'Thoreau'], ['Autobiography of Benjamin Franklin', 'Franklin'],
  ['Narrative of the Life of Frederick Douglass', 'Douglass'], ['Up from Slavery', 'Washington'], ['The Story of My Life', 'Keller'],
  ['Siddhartha', 'Hesse'], ['Notes from the Underground', 'Dostoyevsky'], ['The Death of Ivan Ilych', 'Tolstoy'],
  ['Crime and Punishment', 'Dostoyevsky'], ['The Science of Getting Rich', 'Wattles'], ['As a Man Thinketh', 'Allen'],
  ['The Prophet', 'Gibran'], ['The Richest Man in Babylon', 'Clason'], ['An Inquiry into the Nature and Causes of the Wealth of Nations', 'Smith'],
  ['Self-Reliance', 'Emerson'], ['The Enchiridion', 'Epictetus'], ['Metamorphosis', 'Kafka'], ['The Great Gatsby', 'Fitzgerald'],
  ['Thus Spake Zarathustra', 'Nietzsche'], ['The Souls of Black Folk', 'Du Bois'], ['Twenty Years at Hull-House', 'Addams'],
  ['The Picture of Dorian Gray', 'Wilde'], ['Frankenstein', 'Shelley'], ['The Autobiography of an Ex-Colored Man', 'Johnson'],
  ['Acres of Diamonds', 'Conwell'], ['How to Live on 24 Hours a Day', 'Bennett'], ['The Way to Wealth', 'Franklin'],
];
let starterIdx;
export function starters() {
  if (!starterIdx) starterIdx = [...new Set(STARTERS.map(([t, a]) => findBook(t, a)).filter(i => i >= 0))];
  return starterIdx;
}

const W = { done: 2, reading: 1.5, want: 1, dropped: -2 };
const HIDE_MASK = BIT.periodicals;

export function profile() {
  const prefs = store.get('prefs', {});
  const topics = prefs.topics || ['deep', 'life', 'money', 'ideas'];
  const langs = new Set(prefs.langs || ['en']);
  const aff = new Float32Array(CATS.length);
  topics.forEach(k => { const b = CATS.findIndex(c => c.key === k); if (b >= 0) aff[b] += 1.5; });
  const authors = new Map();
  const seen = new Set();
  let n = 0;
  for (const k of store.keys('shelf:')) {
    const id = +k.slice(6), i = C.byId.get(id); if (i === undefined) continue;
    seen.add(i);
    const sh = store.get(k);
    let w = W[sh.s] || 0;
    const rate = store.get('rate:' + id, 0);
    if (rate > 0) w += 2; if (rate < 0) w -= 3;
    for (let b = 0; b < CATS.length; b++) if (C.mask[i] & (1 << b)) aff[b] += w * 0.6;
    for (const a of C.auth[i]) authors.set(a, (authors.get(a) || 0) + w);
    n++;
  }
  for (const k of store.keys('hide:')) { const i = C.byId.get(+k.slice(5)); if (i !== undefined) seen.add(i); }
  const wantKids = topics.includes('kids');
  return { aff, authors, seen, langs, n, len: prefs.len || 'any', wantKids, topics };
}

function lenFit(p, pref) {
  if (pref === 'any' || !p) return 0;
  const band = p < 120 ? 'short' : p < 350 ? 'medium' : 'long';
  if (band === pref) return 1.6;
  if (pref === 'short' && p > 250) return -3;
  if (pref === 'long' && p < 60) return -2;
  return (pref === 'medium' || band === 'medium') ? -0.4 : -2.5;
}

export function score(i, P) {
  const m = C.mask[i];
  let s = 0, cats = 0;
  for (let b = 0; b < CATS.length; b++) if (m & (1 << b)) { s += P.aff[b]; cats++; }
  s = cats ? s / Math.sqrt(cats) : -0.5;
  for (const a of C.auth[i]) { const w = P.authors.get(a); if (w) s += Math.max(-3, Math.min(3, w)) * 0.9; }
  s += Math.log10(C.dl[i] + 1) * 0.9 + lenFit(C.pages[i], P.len);
  return s;
}

const eligible = (i, P) => P.langs.has(C.lang[i]) && !P.seen.has(i) && !(C.mask[i] & HIDE_MASK) && (P.wantKids || !(C.mask[i] & BIT.kids)) && C.pages[i] > 2;

// day-seeded jitter so the lists change a little every day (and on "Refresh")
function jitter(seed) { let x = seed | 0 || 1; return () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff); }

export function scoreAll(P, seed = 0) {
  const rnd = jitter(seed + Math.floor(Date.now() / 864e5));
  const base = new Float32Array(C.n).fill(NaN);
  for (let i = 0; i < C.n; i++) if (eligible(i, P)) base[i] = score(i, P) + rnd() * 0.9;
  return base;
}

export function topN(P, { n = 12, filter = () => true, diverse = true, seed = 0, base } = {}) {
  base ||= scoreAll(P, seed);
  const all = [];
  for (let i = 0; i < C.n; i++) if (base[i] === base[i] && filter(i)) all.push([i, base[i]]);
  all.sort((a, b) => b[1] - a[1]);
  if (!diverse) return all.slice(0, n).map(x => x[0]);
  const out = [], perAuthor = new Map();
  for (const [i] of all) {
    const a = C.auth[i][0];
    if ((perAuthor.get(a) || 0) >= 1) continue;
    perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    out.push(i);
    if (out.length >= n) break;
  }
  return out;
}

export function moreLike(i0, P, n = 10, base) {
  const m0 = C.mask[i0] & ~(BIT.classics | BIT.periodicals);
  const a0 = new Set(C.auth[i0]);
  return topN(P, { n, filter: i => i !== i0 && ((C.mask[i] & m0) !== 0 || C.auth[i].some(a => a0.has(a))), diverse: true, seed: i0, base }).sort((x, y) => {
    const sx = popcount(C.mask[x] & m0) + (C.auth[x].some(a => a0.has(a)) ? 2 : 0), sy = popcount(C.mask[y] & m0) + (C.auth[y].some(a => a0.has(a)) ? 2 : 0);
    return sy - sx;
  });
}
const popcount = x => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

export function sections(seed = 0) {
  const P = profile();
  const base = scoreAll(P, seed);
  const out = [];
  out.push({ title: 'Picked for you', why: P.n ? 'Based on your topics and what you read' : 'Based on the topics you chose', items: topN(P, { n: 14, base }) });
  const recent = store.keys('shelf:').map(k => [+k.slice(6), store.get(k)]).filter(([, v]) => v.s === 'done' || v.s === 'reading')
    .sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 2);
  for (const [id] of recent) {
    const i = C.byId.get(id); if (i === undefined || store.get('rate:' + id, 0) < 0) continue;
    out.push({ title: `Because you read ${C.title[i].split(/[:;]/)[0]}`, items: moreLike(i, P, 10, base) });
  }
  for (const k of P.topics) {
    const b = CATS.findIndex(c => c.key === k); if (b < 0) continue;
    out.push({ title: CATS[b].name, cat: k, items: topN(P, { n: 12, filter: i => (C.mask[i] & (1 << b)) !== 0, base }) });
  }
  out.push({ title: 'Short and worth it', why: 'Under 100 pages', items: topN(P, { n: 12, filter: i => C.pages[i] < 100 && (C.mask[i] & (BIT.deep | BIT.ideas | BIT.life | BIT.growth | BIT.classics)) !== 0, base }) });
  const st = starters().filter(i => P.langs.has(C.lang[i]) && !P.seen.has(i));
  if (st.length) out.push({ title: 'Good places to start', why: 'Hand-picked classics', items: st.slice(0, 14) });
  return out.filter(s => s.items.length);
}
