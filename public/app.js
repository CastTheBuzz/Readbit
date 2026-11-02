// Readbit — screens and navigation.
import * as store from './store.js';
import { C, load as loadCatalog, idx, authorName, authorLife, catsOf, coverUrl, readTime, bookInfo, search, norm } from './catalog.js';
import { CATS, LANGS, BIT } from './cats.js';
import * as recs from './recs.js';
import { openBook, Reader, printView, toast } from './reader.js';
import * as player from './player.js';

const VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const main = $('#main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PER_PAGE = 30;
const SHELVES = { reading: 'Reading', want: 'Want to read', done: 'Finished', dropped: 'Dropped' };
let reader = null, openBookObj = null, forYouSeed = 0;

// ---------- small building blocks ----------
function hue(id) { return (id * 47) % 360; }
function cover(i, size = '') {
  const id = C.ids[i], t = C.title[i].split(/[:;]/)[0];
  return `<div class="cv ${size}" style="--h:${hue(id)}"><div class="cv-fb"><b>${esc(t.length > 60 ? t.slice(0, 58) + '…' : t)}</b><span>${esc(authorName(i))}</span></div><img src="${coverUrl(id)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
}
function progressOf(id) { const p = store.get('pos:' + id); return p ? Math.round((p.pct || 0) * 100) : 0; }
function badge(id) {
  const s = store.get('shelf:' + id)?.s;
  if (!s) return '';
  if (s === 'reading') return `<span class="badge reading">${progressOf(id)}%</span>`;
  return `<span class="badge ${s}">${{ want: 'Want', done: '✓ Read', dropped: 'Dropped' }[s]}</span>`;
}
function card(i) {
  const id = C.ids[i];
  return `<a class="bk" href="#/book/${id}">${cover(i)}${badge(id)}<b>${esc(C.title[i].split(/[:;]/)[0])}</b><span>${esc(authorName(i))}</span></a>`;
}
function rowItem(i) {
  const id = C.ids[i];
  const cats = catsOf(i).filter(c => c.key !== 'classics' && c.key !== 'deep').slice(0, 2).map(c => c.name).join(' · ');
  return `<a class="li" href="#/book/${id}">${cover(i, 'sm')}<div class="li-t"><b>${esc(C.title[i])}</b><span>${esc(authorName(i))}</span>
    <small>${C.pages[i] ? C.pages[i] + ' pages' : ''}${C.lang[i] !== 'en' ? ' · ' + LANGS[C.lang[i]] : ''}${cats ? ' · ' + esc(cats) : ''}</small></div>${badge(id)}</a>`;
}
const shelfRow = (title, items, more = '', why = '') => items.length ? `<section class="shelf"><div class="sh-head"><h2>${esc(title)}</h2>${more ? `<a href="${more}">See all</a>` : ''}</div>${why ? `<p class="why">${esc(why)}</p>` : ''}<div class="sh-scroll">${items.map(card).join('')}</div></section>` : '';
function pager(cur, pages, href) {
  if (pages <= 1) return '';
  const nums = new Set([1, pages, cur - 1, cur, cur + 1, cur - 2, cur + 2].filter(n => n >= 1 && n <= pages));
  let last = 0, out = '';
  for (const n of [...nums].sort((a, b) => a - b)) { if (n - last > 1) out += '<span class="gap">…</span>'; out += n === cur ? `<span class="pg on">${n}</span>` : `<a class="pg" href="${href(n)}">${n}</a>`; last = n; }
  return `<nav class="pager">${cur > 1 ? `<a class="pg" href="${href(cur - 1)}" aria-label="Previous page">‹</a>` : ''}${out}${cur < pages ? `<a class="pg" href="${href(cur + 1)}" aria-label="Next page">›</a>` : ''}</nav>`;
}
function setTab(name) { document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name)); }
function page(html, tab) { setTab(tab); document.body.classList.remove('reading'); main.innerHTML = html; }
const prefs = () => ({ topics: ['deep', 'life', 'money', 'ideas'], langs: ['en'], len: 'any', ...store.get('prefs', {}) });
const langOk = i => prefs().langs.includes(C.lang[i]);

// ---------- routes ----------
const routes = [
  [/^#?\/?$/, forYou], [/^#\/browse$/, browse], [/^#\/cat\/(\w+)$/, category], [/^#\/search$/, searchView],
  [/^#\/book\/(\d+)$/, bookView], [/^#\/read\/(\d+)$/, readView], [/^#\/print\/(\d+)$/, printRoute], [/^#\/listen\/(\d+)$/, listenView],
  [/^#\/library$/, library], [/^#\/author\/(\d+)$/, authorView], [/^#\/settings$/, settings], [/^#\/welcome$/, welcome],
];
async function route() {
  if (reader) { reader.destroy(); reader = null; }
  if (openBookObj) { openBookObj.close(); openBookObj = null; }
  const [path, qs] = location.hash.split('?');
  const q = new URLSearchParams(qs || '');
  if (!prefs().onboarded && path !== '#/welcome' && path !== '#/settings') { location.replace('#/welcome'); return; }
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { try { await fn(...m.slice(1), q); } catch (e) { if (e instanceof store.AuthError) return showLogin(); document.body.classList.remove('reading'); main.innerHTML = `<div class="empty"><p>😕 ${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`; } if (!path.startsWith('#/read')) window.scrollTo(0, +(sessionStorage.getItem('scroll:' + location.hash) || 0)); return; }
  }
  location.replace('#/');
}
addEventListener('scroll', () => { clearTimeout(window._sc); window._sc = setTimeout(() => sessionStorage.setItem('scroll:' + location.hash, String(scrollY)), 120); }, { passive: true });

// ---------- For you ----------
function forYou() {
  const reading = store.keys('shelf:').map(k => [+k.slice(6), store.get(k)]).filter(([, v]) => v.s === 'reading')
    .sort((a, b) => (store.get('pos:' + b[0])?.t || b[1].t || 0) - (store.get('pos:' + a[0])?.t || a[1].t || 0)).map(([id]) => idx(id)).filter(i => i !== undefined);
  const cont = reading.length ? `<section class="shelf"><div class="sh-head"><h2>Continue reading</h2></div><div class="cont">${reading.slice(0, 3).map(i => {
    const id = C.ids[i], p = progressOf(id);
    return `<a class="cont-item" href="#/read/${id}">${cover(i, 'sm')}<div><b>${esc(C.title[i].split(/[:;]/)[0])}</b><span>${esc(authorName(i))}</span><div class="bar"><i style="width:${p}%"></i></div><small>${p}% · tap to continue</small></div></a>`;
  }).join('')}</div></section>` : '';
  const secs = recs.sections(forYouSeed);
  const h = new Date().getHours();
  page(`<header class="top"><div><small>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</small><h1>For you</h1></div><button class="btn ghost sm" id="refresh">↻ New picks</button></header>
    ${cont}
    ${secs.map(s => shelfRow(s.title, s.items, s.cat ? `#/cat/${s.cat}?sort=rec` : '', s.why)).join('')}
    <p class="foot muted">Picks get better as you finish, like 👍 or drop books.</p>`, 'home');
  $('#refresh').onclick = () => { forYouSeed++; forYou(); window.scrollTo(0, 0); };
}

// ---------- Browse ----------
function browse() {
  const P = prefs(), counts = new Array(CATS.length).fill(0);
  for (let i = 0; i < C.n; i++) if (P.langs.includes(C.lang[i])) for (let b = 0; b < CATS.length; b++) if (C.mask[i] & (1 << b)) counts[b]++;
  const order = CATS.map((c, b) => ({ ...c, b, n: counts[b], mine: P.topics.includes(c.key) })).filter(c => c.n).sort((a, b) => b.mine - a.mine);
  page(`<header class="top"><div><small>${C.n.toLocaleString()} books · ${P.langs.map(l => LANGS[l]).join(', ')}</small><h1>Browse</h1></div></header>
    <a class="search-fake" href="#/search">🔍 Search titles and authors</a>
    <div class="cats">${order.map(c => `<a class="cat ${c.mine ? 'mine' : ''}" href="#/cat/${c.key}" style="--h:${(c.b * 37) % 360}"><span class="ci">${c.icon}</span><b>${esc(c.name)}</b><small>${c.n.toLocaleString()} books</small></a>`).join('')}</div>
    <a class="cat all" href="#/cat/all"><span class="ci">📚</span><b>Everything</b><small>All books in your languages</small></a>`, 'browse');
}

const SORTS = { pop: 'Popular', rec: 'For you', short: 'Shortest', long: 'Longest', az: 'A–Z', old: 'Oldest authors' };
const LENS = { any: 'Any length', s: 'Under 100 p', m: '100–250 p', l: '250–500 p', xl: '500+ p' };
const lenTest = { any: () => true, s: p => p > 0 && p < 100, m: p => p >= 100 && p < 250, l: p => p >= 250 && p < 500, xl: p => p >= 500 };
function filtered(q, base) {
  const P = prefs();
  let lang = q.get('lang') || 'mine', len = q.get('len') || 'any', sort = q.get('sort') || 'pop';
  if (!lenTest[len]) len = 'any';
  if (!SORTS[sort]) sort = 'pop';
  if (lang !== 'mine' && !LANGS[lang]) lang = 'mine';
  const langs = lang === 'mine' ? P.langs : [lang];
  let list = [];
  for (let i = 0; i < C.n; i++) if (langs.includes(C.lang[i]) && lenTest[len](C.pages[i]) && base(i)) list.push(i);
  if (sort === 'rec') { const Pr = recs.profile(); Pr.seen = new Set(); const sc = new Map(list.map(i => [i, recs.score(i, Pr)])); list.sort((a, b) => sc.get(b) - sc.get(a)); }
  else if (sort === 'short') list.sort((a, b) => C.pages[a] - C.pages[b]);
  else if (sort === 'long') list.sort((a, b) => C.pages[b] - C.pages[a]);
  else if (sort === 'az') list.sort((a, b) => C.title[a].localeCompare(C.title[b]));
  else if (sort === 'old') { const yr = i => C.authors[C.auth[i][0]]?.b ?? 9999; list.sort((a, b) => yr(a) - yr(b)); }
  return { list, lang, len, sort };
}
function filterBar(base, q, f) {
  const P = prefs();
  const link = (k, v) => { const n = new URLSearchParams(q); n.set(k, v); n.delete('p'); return `${base}?${n}`; };
  const sel = (k, cur, opts) => `<select class="fsel" data-k="${k}">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const langs = { mine: P.langs.length > 1 ? 'My languages' : LANGS[P.langs[0]], ...Object.fromEntries(Object.entries(LANGS).filter(([l]) => P.langs.length > 1 || l !== P.langs[0])) };
  setTimeout(() => main.querySelectorAll('.fsel').forEach(s => s.onchange = () => { location.hash = link(s.dataset.k, s.value); }));
  return `<div class="filters">${sel('sort', f.sort, SORTS)}${sel('len', f.len, LENS)}${sel('lang', f.lang, langs)}</div>`;
}
function listPage({ title, sub, base, q, test, tab = 'browse', back = '#/browse' }) {
  const f = filtered(q, test);
  const pages = Math.max(1, Math.ceil(f.list.length / PER_PAGE)), cur = Math.min(pages, Math.max(1, +q.get('p') || 1));
  const href = n => { const x = new URLSearchParams(q); x.set('p', n); return `${base}?${x}`; };
  page(`<header class="top"><a class="ib" href="${back}">←</a><div><small>${f.list.length.toLocaleString()} books${pages > 1 ? ` · page ${cur} of ${pages}` : ''}</small><h1>${esc(title)}</h1></div></header>
    ${sub ? `<p class="muted pad">${sub}</p>` : ''}
    ${filterBar(base, q, f)}
    <div class="list">${f.list.slice((cur - 1) * PER_PAGE, cur * PER_PAGE).map(rowItem).join('') || '<p class="empty">No books match these filters.</p>'}</div>
    ${pager(cur, pages, href)}`, tab);
}
function category(key, q) {
  if (key === 'all') return listPage({ title: 'Everything', base: '#/cat/all', q, test: i => !(C.mask[i] & BIT.periodicals) });
  const b = CATS.findIndex(c => c.key === key);
  if (b < 0) throw new Error('Unknown category');
  const SUB = { deep: 'Books that make you think: philosophy, psychological novels, parables, ideas about how to live.', life: 'Autobiographies, memoirs, diaries and letters: real people telling their own story.', money: 'Economics, business, wealth and work — the classics that are free to read.', classics: 'The most-read books on Project Gutenberg and the great reading lists.' };
  listPage({ title: `${CATS[b].icon} ${CATS[b].name}`, sub: SUB[key], base: `#/cat/${key}`, q, test: i => (C.mask[i] & (1 << b)) !== 0 });
}
function authorView(a, q) {
  const A = C.authors[+a];
  if (!A) throw new Error('Unknown author');
  const list = C.authorBooks.get(+a) || [];
  const set = new Set(list);
  listPage({ title: A.name, sub: authorLife(+a) ? `${authorLife(+a)} · ${list.length} book${list.length === 1 ? '' : 's'}` : '', base: `#/author/${a}`, q: q.has('lang') ? q : new URLSearchParams({ ...Object.fromEntries(q), lang: list.some(langOk) ? 'mine' : (C.lang[list[0]] || 'mine') }), test: i => set.has(i), back: 'javascript:history.back()' });
}

// ---------- Search ----------
function searchView(q) {
  const term = q.get('q') || '';
  page(`<header class="top"><div><h1>Search</h1></div></header>
    <form class="sbox" id="sf"><input class="input" type="search" name="q" placeholder="Title or author — e.g. Tolstoy, Walden" value="${esc(term)}" autocomplete="off" enterkeyhint="search"></form>
    <div id="sres"></div>`, 'search');
  const inp = main.querySelector('input'), out = $('#sres');
  const run = () => {
    const t = inp.value.trim();
    history.replaceState(null, '', '#/search' + (t ? '?q=' + encodeURIComponent(t) : ''));
    if (t.length < 2) { out.innerHTML = `<p class="muted pad">Tip: you can search in English, Albanian, French or German titles.</p>${recentSearches()}`; return; }
    const res = search(t, i => !(C.mask[i] & BIT.periodicals));
    const mine = res.filter(langOk), other = res.length - mine.length;
    out.innerHTML = `<p class="muted pad">${mine.length.toLocaleString()} found${other ? ` · ${other} more in other languages` : ''}</p><div class="list">${mine.slice(0, 60).map(rowItem).join('')}</div>${other && mine.length < 10 ? `<h3 class="pad">Other languages</h3><div class="list">${res.filter(i => !langOk(i)).slice(0, 20).map(rowItem).join('')}</div>` : ''}`;
  };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 220); });
  $('#sf').onsubmit = e => { e.preventDefault(); inp.blur(); const v = inp.value.trim(); if (v.length > 1) store.set('searches', [v, ...store.get('searches', []).filter(x => x !== v)].slice(0, 8)); run(); };
  out.addEventListener('click', e => { const a = e.target.closest('[data-s]'); if (a) { inp.value = a.dataset.s; run(); } });
  run();
  if (!term) inp.focus();
}
const recentSearches = () => { const s = store.get('searches', []); return s.length ? `<div class="chips pad">${s.map(x => `<button class="chip" data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''; };

// ---------- Book page ----------
async function bookView(id) {
  const i = idx(id);
  if (i === undefined) throw new Error('This book is not in the catalog.');
  const sh = store.get('shelf:' + id)?.s, p = progressOf(id), rate = store.get('rate:' + id, 0);
  const authors = C.auth[i];
  const cats = catsOf(i).filter(c => c.key !== 'periodicals');
  const kept = await store.saved.get(id).catch(() => null);
  const aud = store.get('aud:' + id);
  page(`<header class="top"><a class="ib" href="javascript:history.back()">←</a></header>
    <div class="bk-hero">${cover(i, 'lg')}<div>
      <h1>${esc(C.title[i])}</h1>
      <p class="by">${authors.map(a => `<a href="#/author/${a}">${esc(C.authors[a]?.name)}</a>${authorLife(a) ? ` <small>(${authorLife(a)})</small>` : ''}`).join(', ')}</p>
      <p class="facts">${C.pages[i] ? `${C.pages[i]} pages · about ${readTime(C.pages[i])}` : ''} · ${LANGS[C.lang[i]]}</p>
    </div></div>
    <div class="actions">
      <a class="btn primary big" href="#/read/${id}">${sh === 'reading' && p ? `Continue · ${p}%` : sh === 'done' ? 'Read again' : 'Start reading'}</a>
      <select class="shelf-sel" aria-label="Shelf"><option value="">＋ Add to shelf</option>${Object.entries(SHELVES).map(([k, l]) => `<option value="${k}" ${sh === k ? 'selected' : ''}>${sh === k ? '✓ ' : ''}${l}</option>`).join('')}${sh ? '<option value="none">Remove from shelves</option>' : ''}</select>
    </div>
    ${sh === 'done' || sh === 'dropped' ? `<div class="rate"><span>Did you like it?</span><button class="chip ${rate > 0 ? 'on' : ''}" data-r="1">👍</button><button class="chip ${rate < 0 ? 'on' : ''}" data-r="-1">👎</button></div>` : ''}
    <div class="cats-inline">${cats.map(c => `<a class="chip" href="#/cat/${c.key}">${c.icon} ${esc(c.name)}</a>`).join('')}</div>
    <div id="about" class="about"><p class="muted">…</p></div>
    <section class="box"><h3>🎧 Listen</h3><div id="listen">${aud ? `<button class="btn" id="aud-go">▶ Continue listening</button>` : `<button class="btn" id="aud-find">Find a free audiobook</button>`}<p class="muted small">Human-read recordings from LibriVox. Or use “Read aloud” inside the reader.</p></div></section>
    <section class="box"><h3>⬇️ Keep it</h3>
      <div class="row wrap">
        <button class="btn" id="keep">${kept ? '✓ On this phone' : '📱 Save on this phone'}</button>
        <a class="btn" href="/api/epub/${id}?dl=1&name=${encodeURIComponent(C.title[i].split(/[:;]/)[0])}" download>EPUB file</a>
        <a class="btn" href="#/print/${id}">🖨 Print / PDF</a>
      </div>
      <p class="muted small">${kept ? `Saved (${(kept.size / 1e6).toFixed(1)} MB) — works without internet. ` : 'Books you open are saved automatically. '}</p>
    </section>
    <div class="row pad"><button class="btn ghost sm" id="hide">${store.get('hide:' + id) ? 'Show in suggestions again' : '🙈 Not interested'}</button><a class="btn ghost sm" href="https://www.gutenberg.org/ebooks/${id}" target="_blank" rel="noopener">View on Gutenberg ↗</a></div>
    <div id="similar"></div>`, '');
  main.querySelector('.shelf-sel').onchange = e => {
    const v = e.target.value;
    if (v === 'none') { store.del('shelf:' + id); toast('Removed from shelves'); }
    else if (v) { store.set('shelf:' + id, { s: v, t: Date.now() }); toast(`Moved to ${SHELVES[v]}`); }
    bookView(id);
  };
  main.querySelectorAll('.rate .chip').forEach(b => b.onclick = () => { const r = +b.dataset.r; store.set('rate:' + id, rate === r ? 0 : r); bookView(id); });
  $('#hide').onclick = () => { if (store.get('hide:' + id)) store.del('hide:' + id); else { store.set('hide:' + id, 1); toast('Won’t suggest this again'); } bookView(id); };
  $('#keep').onclick = async e => {
    const b = e.target;
    if (kept) { await store.saved.remove(id); toast('Removed from this phone'); return bookView(id); }
    b.disabled = true; b.textContent = 'Downloading…';
    try { await store.bookBlob(id); toast('Saved on this phone'); bookView(id); } catch (err) { b.disabled = false; b.textContent = '📱 Save on this phone'; toast(err.message); }
  };
  const goAud = $('#aud-go'), findAud = $('#aud-find');
  if (goAud) goAud.onclick = () => resumeAudio(id, i);
  if (findAud) findAud.onclick = () => showAudio(id, i);
  bookInfo(+id).then(inf => {
    const el = $('#about'); if (!el) return;
    el.innerHTML = `${inf.s ? `<p>${esc(inf.s)}</p>` : '<p class="muted">No description for this book.</p>'}
      ${inf.tr ? `<p class="muted small">Translated by ${esc(inf.tr.join(', '))}</p>` : ''}
      ${inf.sub ? `<p class="subjects">${inf.sub.map(s => `<span>${esc(s)}</span>`).join('')}</p>` : ''}`;
  });
  setTimeout(() => {
    const el = $('#similar'); if (!el) return;
    const P = recs.profile();
    el.innerHTML = shelfRow('More like this', recs.moreLike(i, P, 12));
  }, 30);
}

async function showAudio(id, i) {
  const box = $('#listen');
  box.innerHTML = '<p class="muted">Looking on LibriVox…</p>';
  try {
    const books = await player.findAudio(C.title[i], C.authors[C.auth[i][0]]?.raw || '');
    const lang = { en: 'English', fr: 'French', de: 'German', sq: 'Albanian' }[C.lang[i]];
    books.sort((a, b) => (b.language === lang) - (a.language === lang));
    if (!books.length) { box.innerHTML = `<p>No free audiobook for this one yet.</p><p class="muted small">Open the book and use ⋮ → <b>Read aloud</b> to have your phone read it.</p>`; return; }
    box.innerHTML = books.slice(0, 4).map((b, k) => `<div class="aud"><div><b>${esc(b.title)}</b><small>${esc(b.language)} · ${esc(b.total || player.fmt(player.total(b)))} · ${b.sections.length} parts${b.readers.length ? ` · read by ${esc(b.readers.join(', '))}` : ''}</small></div><button class="btn primary" data-k="${k}">▶ Play</button></div>`).join('');
    box.querySelectorAll('[data-k]').forEach(btn => btn.onclick = () => { const lv = books[+btn.dataset.k]; store.set('audbook:' + id, lv); player.load(id, C.title[i].split(/[:;]/)[0], authorName(i), lv, 0, 0); location.hash = `#/listen/${id}`; });
  } catch (e) { if (e instanceof store.AuthError) throw e; box.innerHTML = `<p>${esc(e.message)}</p>`; }
}
function resumeAudio(id, i) {
  const lv = store.get('audbook:' + id), pos = store.get('aud:' + id);
  if (!lv) return showAudio(id, i);
  if (player.P.id !== +id) player.load(id, C.title[i].split(/[:;]/)[0], authorName(i), lv, pos?.sec || 0, pos?.t || 0);
  location.hash = `#/listen/${id}`;
}

function listenView(id) {
  const i = idx(id);
  if (i === undefined) throw new Error('Unknown book');
  const lv = player.P.id === +id ? player.P.lv : store.get('audbook:' + id);
  if (!lv) { location.replace(`#/book/${id}`); return; }
  if (player.P.id !== +id) { const pos = store.get('aud:' + id); player.load(id, C.title[i].split(/[:;]/)[0], authorName(i), lv, pos?.sec || 0, pos?.t || 0, false); }
  const a = player.el();
  page(`<div class="lpg"><header class="top"><a class="ib" href="javascript:history.back()">←</a><div><small>Listening</small><h1 class="clamp">${esc(C.title[i].split(/[:;]/)[0])}</h1></div></header>
    <div class="lis">${cover(i, 'lg')}
      <div class="lis-now"></div>
      <input type="range" class="lis-seek" min="0" max="1000" value="0" aria-label="Position">
      <div class="lis-times"><span class="t1"></span><span class="t2"></span></div>
      <div class="lis-ctl"><button class="ib" data-c="prev" aria-label="Previous part">⏮</button><button class="ib" data-c="back">↺30</button><button class="ib big play" data-c="toggle"></button><button class="ib" data-c="fwd">30↻</button><button class="ib" data-c="next" aria-label="Next part">⏭</button></div>
      <div class="row center"><button class="chip" data-c="rate"></button><a class="chip" href="#/read/${id}">📖 Read the text</a><a class="chip" href="${esc(lv.url)}" target="_blank" rel="noopener">LibriVox ↗</a></div>
    </div>
    <h3 class="pad">Parts</h3><div class="parts">${lv.sections.map((s, k) => `<button class="part" data-s="${k}"><span>${s.n}. ${esc(s.title)}</span><small>${player.fmt(s.secs)}</small></button>`).join('')}</div></div>`, '');
  const seek = main.querySelector('.lis-seek');
  let dragging = false;
  seek.addEventListener('input', () => { dragging = true; }); seek.addEventListener('change', () => { if (a.duration) a.currentTime = seek.value / 1000 * a.duration; dragging = false; });
  const paint = () => {
    if (!main.querySelector('.lis')) { removeEventListener('player-tick', paint); removeEventListener('player', paint); return; }
    const s = lv.sections[player.P.sec];
    main.querySelector('.lis-now').innerHTML = `<b>${esc(s?.title || '')}</b><small>Part ${player.P.sec + 1} of ${lv.sections.length}</small>`;
    main.querySelector('.t1').textContent = player.fmt(a.currentTime); main.querySelector('.t2').textContent = player.fmt(a.duration || s?.secs);
    if (!dragging && a.duration) seek.value = Math.round(a.currentTime / a.duration * 1000);
    main.querySelector('.play').textContent = a.paused ? '▶' : '⏸';
    main.querySelector('[data-c=rate]').textContent = `Speed ${store.get('audioRate', 1)}×`;
    main.querySelectorAll('.part').forEach((b, k) => b.classList.toggle('on', k === player.P.sec));
  };
  addEventListener('player-tick', paint); addEventListener('player', paint);
  main.querySelector('.lpg').addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c, s = e.target.closest('.part[data-s]')?.dataset.s;
    if (s !== undefined) return player.playSection(+s, 0, true);
    if (c === 'toggle') player.toggle();
    if (c === 'back') a.currentTime = Math.max(0, a.currentTime - 30);
    if (c === 'fwd') a.currentTime += 30;
    if (c === 'prev') player.playSection(player.P.sec - 1, 0, true);
    if (c === 'next') player.playSection(player.P.sec + 1, 0, true);
    if (c === 'rate') player.setRate(player.nextRate());
    paint();
  });
  paint();
}

// ---------- Reader ----------
async function readView(id) {
  const i = idx(id);
  document.body.classList.add('reading'); setTab('');
  main.innerHTML = `<div class="loading-book">${i !== undefined ? cover(i, 'lg') : ''}<p>Opening the book…</p></div>`;
  let book;
  try { book = await openBook(+id); }
  catch (e) { if (e instanceof store.AuthError) throw e; document.body.classList.remove('reading'); main.innerHTML = `<div class="empty"><p>😕 ${esc(e.message)}</p><a class="btn" href="#/book/${id}">Back</a></div>`; return; }
  if (location.hash.split('?')[0] !== `#/read/${id}`) { book.close(); return; }
  openBookObj = book;
  const title = i !== undefined ? C.title[i].split(/[:;]/)[0] : book.title;
  const author = i !== undefined ? authorName(i) : book.author;
  reader = new Reader(main, book, {
    bookTitle: title, bookAuthor: author,
    onExit: (to, panelEntry) => { reader = null; if (to === 'print') location.hash = `#/print/${id}`; else if (history.length > 1) history.go(panelEntry ? -2 : -1); else location.hash = `#/book/${id}`; },
  });
}
async function printRoute(id) {
  const i = idx(id);
  setTab(''); document.body.classList.add('reading');
  main.innerHTML = '<div class="loading-book"><p>Preparing…</p></div>';
  const book = await openBook(+id);
  openBookObj = book;
  await printView(main, book, { title: i !== undefined ? C.title[i] : book.title, author: i !== undefined ? authorName(i) : book.author, onBack: () => history.back() });
}

// ---------- My books ----------
async function library(q) {
  const tab = q.get('t') || 'reading';
  const all = store.keys('shelf:').map(k => ({ id: +k.slice(6), ...store.get(k) })).filter(x => idx(x.id) !== undefined);
  const counts = Object.fromEntries(Object.keys(SHELVES).map(k => [k, all.filter(x => x.s === k).length]));
  let body = '';
  if (tab === 'phone') {
    const list = (await store.saved.list().catch(() => [])).sort((a, b) => b.t - a.t);
    const mb = list.reduce((a, x) => a + x.size, 0) / 1e6;
    body = list.length ? `<p class="muted pad">${list.length} books · ${mb.toFixed(1)} MB on this phone</p><div class="list">${list.map(x => { const i = idx(x.id); return i === undefined ? '' : `<div class="li-wrap">${rowItem(i)}<button class="ib rm" data-rm="${x.id}" aria-label="Remove from phone">🗑</button></div>`; }).join('')}</div>` : '<p class="empty">No books saved yet. Books you open are saved automatically.</p>';
  } else {
    const items = all.filter(x => x.s === tab).sort((a, b) => (store.get('pos:' + b.id)?.t || b.t || 0) - (store.get('pos:' + a.id)?.t || a.t || 0));
    body = items.length ? `<div class="list">${items.map(x => rowItem(idx(x.id))).join('')}</div>` : `<p class="empty">${{ reading: 'Nothing in progress. Open a book to start.', want: 'Tap “Add to shelf” on any book to save it for later.', done: 'Books you finish show up here.', dropped: 'Books you gave up on. No shame.' }[tab]}</p>`;
  }
  const notes = store.keys('hl:').reduce((a, k) => a + store.get(k).length, 0);
  page(`<header class="top"><div><small>${all.length} books on your shelves${notes ? ` · ${notes} highlights` : ''}</small><h1>My books</h1></div><a class="ib" href="#/settings" aria-label="Settings">⚙️</a></header>
    <nav class="tabs2">${Object.entries(SHELVES).map(([k, l]) => `<a href="#/library?t=${k}" class="${tab === k ? 'on' : ''}">${l}${counts[k] ? ` <small>${counts[k]}</small>` : ''}</a>`).join('')}<a href="#/library?t=phone" class="${tab === 'phone' ? 'on' : ''}">On phone</a></nav>
    ${body}`, 'library');
  main.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await store.saved.remove(+b.dataset.rm); toast('Removed from this phone'); library(q); });
}

// ---------- Settings ----------
function settings() {
  const P = prefs();
  const last = store.lastSync();
  page(`<header class="top"><a class="ib" href="#/library">←</a><div><h1>Settings</h1></div></header>
    <section class="box"><h3>Languages</h3><div class="chips">${Object.entries(LANGS).map(([k, l]) => `<button class="chip ${P.langs.includes(k) ? 'on' : ''}" data-lang="${k}">${l}</button>`).join('')}</div>
      <p class="muted small">Albanian books are few on Project Gutenberg (mostly older poetry).</p></section>
    <section class="box"><h3>What I like</h3><div class="chips">${CATS.filter(c => c.key !== 'periodicals').map(c => `<button class="chip ${P.topics.includes(c.key) ? 'on' : ''}" data-topic="${c.key}">${c.icon} ${esc(c.name)}</button>`).join('')}</div></section>
    <section class="box"><h3>Book length I prefer</h3><div class="seg">${[['any', 'Any'], ['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']].map(([v, l]) => `<button class="${P.len === v ? 'on' : ''}" data-len="${v}">${l}</button>`).join('')}</div></section>
    <section class="box"><h3>Sync</h3><p class="small">${last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet'}${store.pending() ? ` · ${store.pending()} change(s) waiting` : ''}</p>
      <div class="row wrap"><button class="btn" id="sync">↻ Sync now</button><button class="btn ghost" id="out">Sign out</button><button class="btn ghost" id="outall">Sign out everywhere</button></div></section>
    <section class="box"><h3>About</h3><p class="small">Readbit ${VERSION} · catalog of ${C.n.toLocaleString()} books from ${esc(C.built)}.<br>Books come from <a href="https://www.gutenberg.org" target="_blank" rel="noopener">Project Gutenberg</a> and audiobooks from <a href="https://librivox.org" target="_blank" rel="noopener">LibriVox</a> — both free, run by volunteers. Run <b>deploy.bat</b> on your PC to update the app or refresh the catalog.</p></section>`, 'library');
  const save = p => store.set('prefs', { ...prefs(), ...p });
  main.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { const l = b.dataset.lang; let ls = prefs().langs; ls = ls.includes(l) ? ls.filter(x => x !== l) : [...ls, l]; if (!ls.length) return toast('Keep at least one language'); save({ langs: ls }); settings(); });
  main.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { const t = b.dataset.topic; let ts = prefs().topics; ts = ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]; save({ topics: ts }); settings(); });
  main.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { save({ len: b.dataset.len }); settings(); });
  $('#sync').onclick = async () => { try { await store.sync(); toast('Synced'); settings(); } catch (e) { if (e instanceof store.AuthError) return showLogin(); toast(e.message); } };
  const signOut = async all => {
    if (all && !confirm('Sign out on every phone and computer?')) return;
    await store.sync().catch(() => {});
    await store.api(all ? '/api/logout-all' : '/api/logout', { method: 'POST' }).catch(() => {});
    player.stop();
    store.wipeLocal();
    if (all) for (const b of await store.saved.list().catch(() => [])) await store.saved.remove(b.id).catch(() => {});
    localStorage.removeItem('rb_signed');
    showLogin();
  };
  $('#out').onclick = () => signOut(false);
  $('#outall').onclick = () => signOut(true);
}

// ---------- First run ----------
function welcome(q) {
  const step = Math.min(4, Math.max(1, Math.round(+q.get('s') || 1)));
  const P = prefs();
  const save = p => store.set('prefs', { ...prefs(), ...p });
  const nav = (back, nextLabel = 'Next') => `<div class="row wz-nav">${back ? `<a class="btn ghost" href="#/welcome?s=${step - 1}">Back</a>` : '<span></span>'}<a class="btn primary" href="${step === 4 ? '#/' : `#/welcome?s=${step + 1}`}" id="next">${nextLabel}</a></div>`;
  let body = '';
  if (step === 1) body = `<h1>Welcome to Readbit 📚</h1><p>${C.n.toLocaleString()} free books. Pick what pulls you in — you can change it any time.</p>
    <div class="chips big">${CATS.filter(c => !['periodicals', 'classics'].includes(c.key)).map(c => `<button class="chip ${P.topics.includes(c.key) ? 'on' : ''}" data-topic="${c.key}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>${nav(false)}`;
  if (step === 2) body = `<h1>Languages</h1><p>Which languages do you read?</p><div class="chips big">${Object.entries(LANGS).map(([k, l]) => `<button class="chip ${P.langs.includes(k) ? 'on' : ''}" data-lang="${k}">${l}</button>`).join('')}</div>${nav(true)}`;
  if (step === 3) body = `<h1>Book length</h1><p>What usually works for you?</p><div class="opts">${[['short', 'Short', 'Under ~120 pages — finish in a few evenings'], ['medium', 'Medium', '120–350 pages'], ['long', 'Long', 'Big books are fine'], ['any', 'Doesn’t matter', '']].map(([v, l, d]) => `<button class="opt ${P.len === v ? 'on' : ''}" data-len="${v}"><b>${l}</b><small>${d}</small></button>`).join('')}</div>${nav(true)}`;
  if (step === 4) {
    const Pr = recs.profile();
    const picks = [...new Set([...recs.starters().filter(i => Pr.langs.has(C.lang[i])), ...recs.topN(Pr, { n: 24 })])].slice(0, 24);
    body = `<h1>Anything sound good?</h1><p>Tap the ones you’d like to read. They go to your “Want to read” shelf.</p><div class="pick">${picks.map(i => `<button class="pk ${store.get('shelf:' + C.ids[i]) ? 'on' : ''}" data-id="${C.ids[i]}">${cover(i)}<b>${esc(C.title[i].split(/[:;]/)[0])}</b><span>${esc(authorName(i))}</span></button>`).join('')}</div>${nav(true, 'Show my picks →')}`;
  }
  page(`<div class="wz"><div class="dots">${[1, 2, 3, 4].map(n => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div>${body}</div>`, '');
  main.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { const t = b.dataset.topic; let ts = prefs().topics; ts = ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]; save({ topics: ts }); b.classList.toggle('on'); });
  main.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { const l = b.dataset.lang; let ls = prefs().langs; ls = ls.includes(l) ? ls.filter(x => x !== l) : [...ls, l]; if (!ls.length) return toast('Pick at least one'); save({ langs: ls }); b.classList.toggle('on'); });
  main.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { save({ len: b.dataset.len }); main.querySelectorAll('[data-len]').forEach(x => x.classList.toggle('on', x === b)); });
  main.querySelectorAll('.pk').forEach(b => b.onclick = () => { const id = b.dataset.id; if (store.get('shelf:' + id)) store.del('shelf:' + id); else store.set('shelf:' + id, { s: 'want', t: Date.now() }); b.classList.toggle('on'); });
  $('#next').onclick = e => { if (step === 1 && !prefs().topics.length) { e.preventDefault(); toast('Pick at least one'); } if (step === 4) save({ onboarded: true }); };
}

// ---------- sign in ----------
function showLogin(msg = '') {
  player.stop();
  document.body.classList.add('signed-out');
  main.innerHTML = `<div class="login"><div class="logo">${LOGO}</div><h1>Readbit</h1><p class="muted">Your free library.</p>
    <form id="lf"><input class="input" type="password" name="pass" placeholder="Passphrase" autocomplete="current-password" required autofocus><button class="btn primary big">Open</button><p class="err">${esc(msg)}</p></form>
    <p class="muted small">The passphrase is the one you chose when you ran deploy.bat.</p></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      await store.api('/api/login', { method: 'POST', body: JSON.stringify({ pass: e.target.pass.value }) });
      localStorage.setItem('rb_signed', '1');
      document.body.classList.remove('signed-out');
      await store.sync().catch(() => {});
      start();
    } catch (err) { btn.disabled = false; e.target.querySelector('.err').textContent = err.message; }
  };
}
const LOGO = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#c2410c"/><path d="M14 18c7-3 13-2 18 2v28c-5-4-11-5-18-2z" fill="#fff7ed"/><path d="M50 18c-7-3-13-2-18 2v28c5-4 11-5 18-2z" fill="#fed7aa"/><circle cx="46" cy="44" r="7" fill="#1f1b16"/><path d="M43.5 41v6l5-3z" fill="#fed7aa"/></svg>`;

// ---------- start ----------
let started = false;
async function start() {
  if (!started) {
    started = true;
    addEventListener('hashchange', route);
    store.onChange(k => { if (k === '*' && !reader && !/^#\/(read|print|listen|welcome)/.test(location.hash)) route(); });
    setInterval(() => store.sync().catch(() => {}), 60000);
    addEventListener('online', () => store.sync().catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.sync({ beacon: true }).catch(() => {}); else store.sync().catch(() => {}); });
  }
  route();
}

document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.closest('.cv')) e.target.remove(); }, true);
document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.closest('.cv')) { const im = e.target; if (im.naturalWidth < 20) im.remove(); else im.closest('.cv').classList.add('has-img'); } }, true);

(async function boot() {
  player.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  main.innerHTML = `<div class="loading-book"><div class="logo">${LOGO}</div><p>Loading the library…</p></div>`;
  try { await loadCatalog(); }
  catch (e) { main.innerHTML = `<div class="empty"><p>😕 ${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  try {
    await store.api('/api/me');
    localStorage.setItem('rb_signed', '1');
    store.sync().then(() => {}).catch(() => {});
  } catch (e) {
    if (e instanceof store.AuthError) { localStorage.removeItem('rb_signed'); return showLogin(); }
    if (!localStorage.getItem('rb_signed')) return showLogin('No connection. Connect to the internet to sign in the first time.');
    toast('Offline — your saved books still work.');
  }
  start();
})();
