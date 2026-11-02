// EPUB reading: opening the book, the reader screen (pages or scroll), bookmarks, highlights, read-aloud, print view.
import * as store from './store.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolve(base, href) {
  const parts = (base + href).split('/'), out = [];
  for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
  return out.join('/');
}
const PG_STRIP = /<(section|div)[^>]*id="pg-(header|footer|machine-header|start-separator|end-separator)"[\s\S]*?<\/\1>/gi;
const textLen = s => s.replace(PG_STRIP, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length;

// ---------- open an EPUB ----------
export async function openBook(id) {
  const blob = await store.bookBlob(id);
  let zip;
  try { zip = await window.JSZip.loadAsync(blob); } catch { await store.saved.remove(id); throw new Error('This book file is damaged. Try opening it again.'); }
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const container = xml(await zip.file('META-INF/container.xml').async('string'));
  const opfPath = container.querySelector('rootfile').getAttribute('full-path');
  const opf = xml(await zip.file(opfPath).async('string'));
  const base = dirOf(opfPath);
  const manifest = new Map();
  for (const it of opf.getElementsByTagNameNS('*', 'item')) {
    manifest.set(it.getAttribute('id'), { href: resolve(base, decodeURIComponent(it.getAttribute('href'))), type: it.getAttribute('media-type'), props: it.getAttribute('properties') || '' });
  }
  const meta = tag => opf.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || '';
  const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map(r => manifest.get(r.getAttribute('idref'))).filter(x => x && /html/.test(x.type));
  const raw = await Promise.all(spine.map(s => zip.file(s.href)?.async('string') ?? ''));
  let chapters = spine.map((s, i) => ({ path: s.href, raw: raw[i], len: textLen(raw[i] || ''), img: /<(img|image)\b/i.test(raw[i] || '') }));
  chapters = chapters.filter(c => c.len >= 30 || (c.img && c.len < 30 && chapters.indexOf(c) === 0));
  if (!chapters.length) throw new Error('This book has no readable text.');
  const byPath = new Map(chapters.map((c, i) => [c.path, i]));

  // table of contents (EPUB3 nav, else NCX)
  const toc = [];
  const navItem = [...manifest.values()].find(m => /\bnav\b/.test(m.props));
  if (navItem && zip.file(navItem.href)) {
    const d = new DOMParser().parseFromString(await zip.file(navItem.href).async('string'), 'application/xhtml+xml');
    const nav = [...d.getElementsByTagName('nav')].find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || d.getElementsByTagName('nav')[0];
    const walk = (ol, depth) => { for (const li of ol?.children || []) { const a = li.querySelector('a'); if (a) addToc(a.textContent, dirOf(navItem.href), a.getAttribute('href'), depth); const sub = [...li.children].find(c => c.tagName.toLowerCase() === 'ol'); if (sub) walk(sub, depth + 1); } };
    if (nav) walk([...nav.children].find(c => c.tagName.toLowerCase() === 'ol'), 0);
  }
  if (!toc.length) {
    const ncx = manifest.get(spineEl?.getAttribute('toc')) || [...manifest.values()].find(m => /ncx/.test(m.type));
    if (ncx && zip.file(ncx.href)) {
      const d = xml(await zip.file(ncx.href).async('string'));
      const walk = (el, depth) => { for (const np of el.children) if (np.localName === 'navPoint') { addToc(np.getElementsByTagNameNS('*', 'text')[0]?.textContent, dirOf(ncx.href), np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src'), depth); walk(np, depth + 1); } };
      const map = d.getElementsByTagNameNS('*', 'navMap')[0]; if (map) walk(map, 0);
    }
  }
  function addToc(label, b, href, depth) {
    if (!href || !label) return;
    const [p, frag] = href.split('#');
    const ch = byPath.get(resolve(b, decodeURIComponent(p)));
    label = label.replace(/\s+/g, ' ').trim();
    if (ch === undefined || !label || /project gutenberg|full license|^contents$/i.test(label)) return;
    toc.push({ label, ch, frag: frag || '', depth });
  }
  chapters.forEach((c, i) => { c.title = toc.find(t => t.ch === i)?.label || (i === 0 ? 'Start' : `Part ${i + 1}`); });

  const total = chapters.reduce((a, c) => a + c.len, 0) || 1;
  let acc = 0; chapters.forEach(c => { c.start = acc / total; acc += c.len; c.share = c.len / total; });
  const blobs = new Map();
  async function asset(path) {
    if (blobs.has(path)) return blobs.get(path);
    const f = zip.file(path); if (!f) return '';
    const url = URL.createObjectURL(await f.async('blob'));
    blobs.set(path, url); return url;
  }
  const cache = new Map();
  async function content(i) {
    if (cache.has(i)) return cache.get(i).cloneNode(true);
    const c = chapters[i];
    let d = new DOMParser().parseFromString(c.raw, 'application/xhtml+xml');
    if (d.getElementsByTagName('parsererror').length) d = new DOMParser().parseFromString(c.raw, 'text/html');
    const body = d.body || d.getElementsByTagName('body')[0];
    const wrap = document.createElement('div');
    if (!body) { cache.set(i, wrap); return wrap.cloneNode(true); }
    body.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button,noscript,#pg-header,#pg-footer,#pg-machine-header,#pg-start-separator,#pg-end-separator,.pg-boilerplate,.pgheader').forEach(e => e.remove());
    const b = dirOf(c.path);
    for (const el of body.querySelectorAll('*')) {
      for (const at of [...el.attributes]) if (/^on/i.test(at.name) || at.name === 'style') el.removeAttribute(at.name);
      const tag = el.localName;
      if (tag === 'img') { const src = el.getAttribute('src'); el.setAttribute('src', src && !/^(https?:|data:)/.test(src) ? await asset(resolve(b, decodeURIComponent(src))) : (src || '')); el.removeAttribute('loading'); el.removeAttribute('width'); el.removeAttribute('height'); }
      if (tag === 'image') { const h = el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('href'); if (h) el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', await asset(resolve(b, decodeURIComponent(h)))); }
      if (tag === 'a') {
        const h = el.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(h)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        else if (h) { const [p, frag] = h.split('#'); const ch = p ? byPath.get(resolve(b, decodeURIComponent(p))) : i; el.setAttribute('href', '#'); el.dataset.ch = ch ?? ''; el.dataset.frag = frag || ''; }
      }
    }
    for (const n of [...body.childNodes]) wrap.appendChild(document.importNode(n, true));
    cache.set(i, wrap);
    return wrap.cloneNode(true);
  }
  const lang = (meta('language') || 'en').slice(0, 2).toLowerCase();
  return { id: +id, title: meta('title'), author: meta('creator'), lang, chapters, toc, content, close() { blobs.forEach(u => URL.revokeObjectURL(u)); } };
}

// ---------- reader settings ----------
export const DEFAULTS = { size: 19, font: 'serif', lh: 1.6, margin: 'm', theme: 'sepia', mode: 'paged', justify: true, rate: 1 };
export const readerPrefs = () => ({ ...DEFAULTS, ...store.get('reader', {}) });
const FONTS = { serif: "'Literata', Georgia, 'Times New Roman', serif", sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", classic: "Georgia, 'Palatino Linotype', Palatino, serif" };
const MARGINS = { s: 14, m: 24, l: 40 };

// ---------- the reader screen ----------
export class Reader {
  constructor(root, book, { onExit, onFinish, bookTitle, bookAuthor } = {}) {
    Object.assign(this, { root, book, onExit, onFinish, bookTitle: bookTitle || book.title, bookAuthor: bookAuthor || book.author });
    this.prefs = readerPrefs();
    this.ch = 0; this.page = 0; this.pages = 1;
    const pos = store.get('pos:' + book.id);
    if (pos && pos.ch < book.chapters.length) { this.ch = pos.ch; this.startF = pos.f || 0; this.startOff = pos.off; }
    this.build();
    this.render(this.ch, { f: this.startF || 0, off: this.startOff });
    this.onResize = () => { if (this._rt == null) this._pin ||= this.anchor(); clearTimeout(this._rt); this._rt = setTimeout(() => { this._rt = null; this.relayout(this._pin); }, 150); };
    addEventListener('resize', this.onResize);
    this.onKey = e => { const t = e.target; if (t && (t.closest?.('input,textarea,select,button,a,[contenteditable]') || t.isContentEditable)) { if (e.key === 'Escape') this.closePanels(); return; } if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); this.next(); } if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.prev(); } if (e.key === 'Escape') this.closePanels(); };
    addEventListener('keydown', this.onKey);
    this.onSel = () => this.selectionChanged();
    document.addEventListener('selectionchange', this.onSel);
    this.onHide = () => { if (document.visibilityState === 'hidden') { this.saveNow(); store.sync({ beacon: true }).catch(() => {}); } else this.lock(); };
    document.addEventListener('visibilitychange', this.onHide);
    this.onPageHide = () => this.saveNow();
    addEventListener('pagehide', this.onPageHide);
    // Android back button closes an open panel instead of leaving the book
    this.onPop = () => { if (this.panelKind) this.closePanels(true); };
    addEventListener('popstate', this.onPop);
    this.lock();
  }

  async lock() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') this.wl = await navigator.wakeLock.request('screen'); } catch {} }

  build() {
    const p = this.prefs;
    this.root.innerHTML = `
    <div class="rd" data-theme="${p.theme}">
      <header class="rd-top">
        <button class="ib" data-a="back" aria-label="Back">←</button>
        <div class="rd-title"><b>${esc(this.bookTitle)}</b><span class="rd-chname"></span></div>
        <button class="ib" data-a="toc" aria-label="Contents">☰</button>
        <button class="ib" data-a="aa" aria-label="Text settings">Aa</button>
        <button class="ib" data-a="bm" aria-label="Bookmark">🔖</button>
        <button class="ib" data-a="more" aria-label="More">⋮</button>
      </header>
      <div class="rd-view"><div class="rd-ch" lang="${esc(this.book.lang)}"></div></div>
      <div class="rd-foot"><span class="rd-left"></span><span class="rd-pct"></span></div>
      <footer class="rd-bottom">
        <input type="range" class="rd-slider" min="0" max="1000" value="0" aria-label="Position in book">
        <div class="rd-binfo"><span class="rd-pinfo"></span><span class="rd-tleft"></span></div>
      </footer>
      <div class="rd-panel" hidden></div>
      <button class="rd-hlbtn" hidden>🖍 Highlight</button>
      <div class="rd-tts" hidden><button data-a="tts-prev">⏮</button><button data-a="tts-toggle">⏸</button><button data-a="tts-next">⏭</button><span class="rd-tts-rate"></span><button data-a="tts-stop">✕</button></div>
      <div class="rd-end" hidden></div>
    </div>`;
    this.el = this.root.querySelector('.rd');
    this.view = this.el.querySelector('.rd-view');
    this.chEl = this.el.querySelector('.rd-ch');
    this.panel = this.el.querySelector('.rd-panel');
    this.applyPrefs();
    this.el.addEventListener('click', e => this.click(e));
    const sl = this.el.querySelector('.rd-slider');
    sl.addEventListener('input', () => { this.el.querySelector('.rd-pinfo').textContent = `${Math.round(sl.value / 10)}%`; });
    sl.addEventListener('change', () => this.goPct(sl.value / 1000));
    // taps and swipes. Touch events (not pointer events) because Android Chrome cancels a
    // pointer as soon as the finger moves sideways, so swipes never reached the reader.
    let sx = 0, sy = 0, lx = 0, ly = 0, st = 0, touching = false, usedTouch = false;
    const start = (x, y) => { sx = lx = x; sy = ly = y; st = Date.now(); touching = true; };
    const end = (x, y, target) => {
      if (!touching) return;
      touching = false;
      if (target?.closest?.('a,.hl')) return;
      const dx = x - sx, dy = y - sy, dt = Date.now() - st;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;
      if (this.prefs.mode === 'paged' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 1000) { dx < 0 ? this.next() : this.prev(); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 500) {
        if (!this.panel.hidden) { this.closePanels(); return; }
        const w = this.view.clientWidth, px = x - this.view.getBoundingClientRect().left;
        if (this.prefs.mode === 'paged' && px < w * 0.3) this.prev();
        else if (this.prefs.mode === 'paged' && px > w * 0.7) this.next();
        else this.el.classList.toggle('bars');
      }
    };
    const v = this.view;
    v.addEventListener('touchstart', e => { usedTouch = true; if (e.touches.length > 1) { touching = false; return; } start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    v.addEventListener('touchmove', e => { const t = e.touches[0]; lx = t.clientX; ly = t.clientY; if (this.prefs.mode === 'paged' && Math.abs(lx - sx) > Math.abs(ly - sy) && e.cancelable) e.preventDefault(); }, { passive: false });
    v.addEventListener('touchend', e => { const t = e.changedTouches[0]; end(t.clientX, t.clientY, e.target); });
    v.addEventListener('touchcancel', () => end(lx, ly, null));
    v.addEventListener('mousedown', e => { if (!usedTouch && e.button === 0) start(e.clientX, e.clientY); });
    v.addEventListener('mouseup', e => { if (!usedTouch) end(e.clientX, e.clientY, e.target); });
    // mouse wheel / trackpad turns pages in page mode (scroll mode scrolls normally)
    let wheelAcc = 0, wheelLock = 0, wheelLast = 0;
    v.addEventListener('wheel', e => {
      if (this.prefs.mode !== 'paged' || e.ctrlKey) return;
      e.preventDefault();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const now = Date.now();
      if (now - wheelLast > 200) { wheelAcc = 0; wheelLock = 0; }
      wheelLast = now;
      if (now < wheelLock) return;
      wheelAcc += e.deltaMode === 1 ? d * 30 : d;
      if (Math.abs(wheelAcc) >= 40) { wheelAcc > 0 ? this.next() : this.prev(); wheelAcc = 0; wheelLock = now + 700; }
    }, { passive: false });
    this.view.addEventListener('scroll', () => { if (this.prefs.mode === 'scroll') { clearTimeout(this._st); this._st = setTimeout(() => { this.updateInfo(); this.save(); }, 250); } }, { passive: true });
  }

  applyPrefs() {
    const p = this.prefs, s = this.el.style;
    this.el.dataset.theme = p.theme;
    this.el.dataset.mode = p.mode;
    s.setProperty('--rd-size', p.size + 'px');
    s.setProperty('--rd-font', FONTS[p.font] || FONTS.serif);
    s.setProperty('--rd-lh', p.lh);
    s.setProperty('--rd-mx', MARGINS[p.margin] + 'px');
    s.setProperty('--rd-align', p.justify ? 'justify' : 'left');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(this.el).getPropertyValue('--rd-bg').trim() || '#f4ecd8');
  }

  setPref(k, v) {
    const f = this._pin ||= this.anchor();
    this.prefs[k] = v;
    store.set('reader', { ...store.get('reader', {}), [k]: v });
    this.applyPrefs();
    this.relayout(f);
    if (this.panelKind === 'aa') this.showAa();
  }

  // ----- layout & position -----
  get pageW() { return this.view.clientWidth; }
  measure() {
    if (this.prefs.mode !== 'paged') { this.pages = 1; return; }
    this.chEl.style.setProperty('--rd-h', this.view.clientHeight + 'px');
    this.chEl.style.setProperty('--rd-w', this.pageW + 'px');
    const sw = this.chEl.scrollWidth;
    this.pages = Math.max(1, Math.round(sw / this.pageW));
    // a trailing column can be created by margins; drop it when it is empty
    if (this.pages > 1) {
      const last = this.chEl.lastElementChild;
      if (last) { const r = last.getBoundingClientRect(), cr = this.chEl.getBoundingClientRect(); const lastPage = Math.floor((r.right - cr.left + this.chEl.scrollLeft - 2) / this.pageW); if (lastPage + 1 < this.pages) this.pages = Math.max(1, lastPage + 1); }
    }
  }
  fraction() {
    if (this.prefs.mode === 'paged') return this.pages > 1 ? this.page / this.pages : 0;
    const max = this.view.scrollHeight - this.view.clientHeight;
    return max > 0 ? this.view.scrollTop / (this.view.scrollHeight) : 0;
  }

  async render(ch, { f = 0, page = null, frag = '', fromEnd = false, off = null } = {}) {
    this.stopTTS(false);
    this.busy = true;
    try {
      this.ch = Math.max(0, Math.min(ch, this.book.chapters.length - 1));
      const node = await this.book.content(this.ch);
      this.chEl.replaceChildren(...node.childNodes);
      this.chEl.scrollLeft = 0; this.view.scrollTop = 0;
      this.paintHighlights();
      this.el.querySelector('.rd-chname').textContent = this.book.chapters[this.ch].title;
      await waitImages(this.chEl, 2500);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      this.measure();
      this.watchImages();
      this.el.querySelector('.rd-end').hidden = true;
      if (frag) { const t = this.chEl.querySelector('#' + CSS.escape(frag)); if (t) return this.showEl(t); }
      if (off != null && !fromEnd && this.goOffset(off)) return;
      if (this.prefs.mode === 'paged') this.goPage(fromEnd ? this.pages - 1 : page ?? Math.min(this.pages - 1, Math.floor(f * this.pages + 0.0001)));
      else { this.view.scrollTop = fromEnd ? this.view.scrollHeight : f * this.view.scrollHeight; this.updateInfo(); this.save(); }
    } finally { this.busy = false; }
  }
  // an image that finishes loading late changes the page count: measure again, stay on the same text
  watchImages() {
    for (const img of this.chEl.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', () => { if (this.chEl.contains(img)) { const a = this._pin || this.anchor(); this.measure(); if (a.off != null) this.goOffset(a.off, !!this._pin); else this.updateInfo(); } }, { once: true });
  }
  // The reading position as "character N of this chapter" (the first word on screen).
  // Font size, rotation and Pages/Scroll changes all go back to that word.
  anchor() {
    // first character whose box is on screen (independent of toolbars covering the text)
    const vr = this.view.getBoundingClientRect(), paged = this.prefs.mode === 'paged';
    const visible = r => (r.width || r.height) && (paged ? r.left >= vr.left - 1 && r.left < vr.right - 1 : r.bottom > vr.top + 2 && r.top < vr.bottom);
    const w = document.createTreeWalker(this.chEl, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    const rg = document.createRange();
    while ((n = w.nextNode())) {
      const l = n.nodeValue.length;
      if (l && n.nodeValue.trim()) {
        rg.selectNodeContents(n);
        const rects = [...rg.getClientRects()];
        if (rects.some(visible)) {
          let lo = 0, hi = l - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            rg.setStart(n, mid); rg.setEnd(n, mid + 1);
            const r = rg.getClientRects()[0] || rg.getBoundingClientRect();
            const before = paged ? r.left < vr.left - 1 : r.bottom <= vr.top + 2;
            if (before) lo = mid + 1; else hi = mid;
          }
          return { off: pos + lo, f: this.fraction() };
        }
      }
      pos += l;
    }
    return { f: this.fraction() };
  }
  rectOfOffset(off) {
    const w = document.createTreeWalker(this.chEl, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    while ((n = w.nextNode())) {
      const l = n.nodeValue.length;
      if (pos + l > off) {
        let i = off - pos;
        while (i < l && /\s/.test(n.nodeValue[i])) i++;
        if (i >= l) i = l - 1;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, Math.min(l, i + 1));
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (rect && (rect.width || rect.height)) return rect;
      }
      pos += l;
    }
    return null;
  }
  pageOfOffset(off) {
    const rect = this.rectOfOffset(off); if (!rect) return null;
    const cr = this.chEl.getBoundingClientRect();
    return Math.max(0, Math.min(this.pages - 1, Math.floor((rect.left - cr.left + this.chEl.scrollLeft + 1) / this.pageW)));
  }
  goOffset(off, keepPin = false) {
    if (this.prefs.mode === 'paged') { const p = this.pageOfOffset(off); if (p == null) return false; this.goPage(p, keepPin); return true; }
    const rect = this.rectOfOffset(off); if (!rect) return false;
    this.view.scrollTop += rect.top - this.view.getBoundingClientRect().top - 50;
    this.updateInfo(); this.save(); return true;
  }
  relayout(a = this.anchor()) {
    if (typeof a === 'number') a = { f: a };
    this.view.scrollTop = 0; this.chEl.scrollLeft = 0;
    requestAnimationFrame(() => {
      this.measure();
      if (a.off != null && this.goOffset(a.off, true)) return;
      if (this.prefs.mode === 'paged') this.goPage(Math.min(this.pages - 1, Math.round(a.f * this.pages)), true);
      else { this.view.scrollTop = a.f * this.view.scrollHeight; this.updateInfo(); }
    });
  }
  // keepPin: a relayout (font, rotation) moved us; the remembered word stays the same so
  // repeated changes don't drift. Any real page turn forgets it.
  goPage(n, keepPin = false) {
    if (!keepPin) this._pin = null;
    this.page = Math.max(0, Math.min(n, this.pages - 1));
    this.chEl.scrollLeft = this.page * this.pageW;
    this.updateInfo(); this.save();
  }
  showEl(el) {
    if (this.prefs.mode === 'paged') {
      const cr = this.chEl.getBoundingClientRect(), r = el.getBoundingClientRect();
      this.goPage(Math.floor((r.left - cr.left + this.chEl.scrollLeft + 2) / this.pageW));
    } else { el.scrollIntoView({ block: 'center' }); this.updateInfo(); this.save(); }
  }
  next() {
    if (this.busy) return;
    if (this.prefs.mode === 'paged' && this.page < this.pages - 1) return this.goPage(this.page + 1);
    if (this.prefs.mode === 'scroll') { const v = this.view; if (v.scrollTop + v.clientHeight < v.scrollHeight - 10) { v.scrollBy({ top: v.clientHeight * 0.9, behavior: 'smooth' }); return; } }
    if (this.ch < this.book.chapters.length - 1) return this.render(this.ch + 1);
    this.showEnd();
  }
  prev() {
    if (this.busy) return;
    if (this.prefs.mode === 'paged' && this.page > 0) return this.goPage(this.page - 1);
    if (this.prefs.mode === 'scroll' && this.view.scrollTop > 10) { this.view.scrollBy({ top: -this.view.clientHeight * 0.9, behavior: 'smooth' }); return; }
    if (this.ch > 0) return this.render(this.ch - 1, { fromEnd: true });
  }
  goPct(p) {
    const cs = this.book.chapters;
    let i = cs.findIndex((c, k) => p < c.start + c.share || k === cs.length - 1);
    const f = cs[i].share ? Math.max(0, Math.min(0.999, (p - cs[i].start) / cs[i].share)) : 0;
    this.render(i, { f });
  }
  overall() {
    const c = this.book.chapters[this.ch];
    const within = this.prefs.mode === 'paged' ? (this.pages > 1 ? (this.page + 1) / this.pages : 1) : Math.min(1, (this.view.scrollTop + this.view.clientHeight) / Math.max(1, this.view.scrollHeight));
    return Math.min(1, c.start + c.share * within);
  }
  updateInfo() {
    const c = this.book.chapters[this.ch], pct = this.overall();
    const within = this.prefs.mode === 'paged' ? (this.pages > 1 ? (this.page + 1) / this.pages : 1) : Math.min(1, (this.view.scrollTop + this.view.clientHeight) / Math.max(1, this.view.scrollHeight));
    const minsLeft = Math.max(0, Math.round(c.len * (1 - within) / 5.5 / 230));
    const bookLeft = Math.round((1 - pct) * this.book.chapters.reduce((a, x) => a + x.len, 0) / 5.5 / 230);
    this.el.querySelector('.rd-left').textContent = within >= 1 ? (this.ch < this.book.chapters.length - 1 ? 'End of chapter' : 'The end') : minsLeft < 1 ? 'Less than a minute left in chapter' : `${minsLeft} min left in chapter`;
    this.el.querySelector('.rd-pct').textContent = Math.floor(pct * 100) + '%';
    this.el.querySelector('.rd-pinfo').textContent = this.prefs.mode === 'paged' ? `Page ${this.page + 1} of ${this.pages} · ${c.title}` : c.title;
    this.el.querySelector('.rd-tleft').textContent = bookLeft >= 60 ? `${Math.round(bookLeft / 6) / 10} h left in book` : `${bookLeft} min left in book`;
    this.el.querySelector('.rd-slider').value = Math.round(pct * 1000);
    const bm = this.findBookmark();
    this.el.querySelector('[data-a=bm]').classList.toggle('on', bm >= 0);
  }
  save() {
    clearTimeout(this._sv);
    this._sv = setTimeout(() => this.saveNow(), 500);
  }
  saveNow() {
    clearTimeout(this._sv);
    if (!this.el || this.busy) return;
    const a = this._pin || this.anchor();
    store.set('pos:' + this.book.id, { ch: this.ch, f: a.f, off: a.off, pct: this.overall(), t: Date.now() });
    const sh = store.get('shelf:' + this.book.id);
    if (!sh || sh.s === 'want') store.set('shelf:' + this.book.id, { s: 'reading', t: Date.now() });
  }
  showEnd() {
    const e = this.el.querySelector('.rd-end');
    const done = store.get('shelf:' + this.book.id)?.s === 'done';
    e.innerHTML = `<div class="card"><div class="big">🎉</div><h3>You reached the end</h3><p>${esc(this.bookTitle)}</p>
      ${done ? '<p class="muted">Marked as finished.</p>' : `<p>Did you like it?</p><div class="row"><button class="btn" data-a="fin" data-r="1">👍 Liked it</button><button class="btn" data-a="fin" data-r="0">😐 It was ok</button><button class="btn" data-a="fin" data-r="-1">👎 Not for me</button></div>`}
      <button class="btn ghost" data-a="endclose">Back to the book</button></div>`;
    e.hidden = false;
  }

  // ----- clicks -----
  click(e) {
    const a = e.target.closest('[data-a]');
    const link = e.target.closest('.rd-ch a[data-ch]');
    if (link) { e.preventDefault(); const ch = link.dataset.ch === '' ? this.ch : +link.dataset.ch; if (ch === this.ch && link.dataset.frag) { const t = this.chEl.querySelector('#' + CSS.escape(link.dataset.frag)); if (t) this.showEl(t); } else this.render(ch, { frag: link.dataset.frag }); return; }
    const mark = e.target.closest('mark.hl');
    if (mark && !a) { this.showNotes(+mark.dataset.i); return; }
    if (!a) return;
    const act = a.dataset.a;
    const acts = {
      back: () => this.exit(), toc: () => this.showToc(), aa: () => this.showAa(), bm: () => this.toggleBookmark(), more: () => this.showMore(),
      'tts-toggle': () => this.toggleTTS(), 'tts-stop': () => this.stopTTS(), 'tts-next': () => this.ttsSkip(1), 'tts-prev': () => this.ttsSkip(-1),
      endclose: () => { this.el.querySelector('.rd-end').hidden = true; },
      fin: () => { const r = +a.dataset.r; store.set('shelf:' + this.book.id, { s: 'done', t: Date.now() }); if (r) store.set('rate:' + this.book.id, r); this.showEnd(); this.onFinish?.(); },
    };
    acts[act]?.();
    if (act.startsWith('p:')) this.panelAction(a);
  }

  // ----- panels -----
  openPanel(kind, html) {
    if (!this.panelKind) history.pushState({ rbPanel: 1 }, '');
    this.panelKind = kind; this.panel.innerHTML = html; this.panel.hidden = false; this.el.classList.add('bars');
  }
  closePanels(fromBack = false) {
    if (!this.panelKind) return;
    this.panel.hidden = true; this.panelKind = null;
    if (!fromBack && history.state?.rbPanel) history.back();
  }
  showToc() {
    const t = this.book.toc.length ? this.book.toc : this.book.chapters.map((c, i) => ({ label: c.title, ch: i, frag: '', depth: 0 }));
    const cur = t.reduce((best, x, i) => (x.ch <= this.ch ? i : best), 0);
    this.openPanel('toc', `<div class="p-head"><b>Contents</b><button class="ib" data-a="p:close">✕</button></div><div class="p-list">${t.map((x, i) => `<button class="p-item ${i === cur ? 'on' : ''}" style="padding-left:${12 + x.depth * 16}px" data-a="p:go" data-ch="${x.ch}" data-frag="${esc(x.frag)}">${esc(x.label)}</button>`).join('')}</div>`);
    this.panel.querySelector('.p-item.on')?.scrollIntoView({ block: 'center' });
  }
  showAa() {
    const p = this.prefs;
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="p:set" data-k="${k}" data-v="${v}" class="${String(p[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    this.openPanel('aa', `<div class="p-head"><b>Text</b><button class="ib" data-a="p:close">✕</button></div>
      <div class="p-body">
        <div class="p-row"><span>Size</span><div class="seg"><button data-a="p:size" data-d="-1">A−</button><span class="seg-val">${p.size}</span><button data-a="p:size" data-d="1">A+</button></div></div>
        <div class="p-row"><span>Font</span>${seg('font', [['serif', 'Literata'], ['classic', 'Georgia'], ['sans', 'Sans']])}</div>
        <div class="p-row"><span>Spacing</span>${seg('lh', [[1.4, 'Tight'], [1.6, 'Normal'], [1.85, 'Airy']])}</div>
        <div class="p-row"><span>Margins</span>${seg('margin', [['s', 'S'], ['m', 'M'], ['l', 'L']])}</div>
        <div class="p-row"><span>Theme</span><div class="seg themes">${[['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['black', 'Black']].map(([v, l]) => `<button data-a="p:set" data-k="theme" data-v="${v}" class="th-${v} ${p.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="p-row"><span>Turning</span>${seg('mode', [['paged', 'Pages'], ['scroll', 'Scroll']])}</div>
        <div class="p-row"><span>Align</span>${seg('justify', [[true, 'Justified'], [false, 'Left']])}</div>
      </div>`);
  }
  showMore() {
    this.openPanel('more', `<div class="p-head"><b>More</b><button class="ib" data-a="p:close">✕</button></div><div class="p-list">
      <button class="p-item" data-a="p:tts">🔊 Read aloud from here</button>
      <button class="p-item" data-a="p:notes">🖍 Highlights & bookmarks</button>
      <button class="p-item" data-a="p:find">🔎 Find in book</button>
      <button class="p-item" data-a="p:print">🖨 Print or save as PDF</button>
      <a class="p-item" href="/api/epub/${this.book.id}?dl=1&name=${encodeURIComponent(this.bookTitle)}" download>⬇️ Download EPUB file</a>
      <button class="p-item" data-a="p:finish">✅ Mark as finished</button>
    </div>`);
  }
  showNotes(focus = -1) {
    const hls = store.get('hl:' + this.book.id, []), bms = store.get('bm:' + this.book.id, []);
    const items = [
      ...bms.map((b, i) => ({ k: 'bm', i, ch: b.ch, f: b.f, text: b.label, t: b.t })),
      ...hls.map((h, i) => ({ k: 'hl', i, ch: h.ch, f: h.f ?? 0, text: h.text, t: h.t })),
    ].sort((a, b) => a.ch - b.ch || a.f - b.f);
    this.openPanel('notes', `<div class="p-head"><b>Highlights & bookmarks</b><button class="ib" data-a="p:close">✕</button></div><div class="p-list">
      ${items.length ? items.map(x => `<div class="note ${x.k === 'hl' && x.i === focus ? 'on' : ''}"><button class="note-go" data-a="p:jump" data-k="${x.k}" data-i="${x.i}"><small>${x.k === 'bm' ? '🔖' : '🖍'} ${esc(this.book.chapters[x.ch]?.title || '')}</small><span>${esc(x.text.length > 220 ? x.text.slice(0, 220) + '…' : x.text)}</span></button><button class="ib" data-a="p:rm" data-k="${x.k}" data-i="${x.i}" aria-label="Remove">🗑</button></div>`).join('') : '<p class="muted pad">Nothing yet. Tap 🔖 to bookmark a page, or select text and tap Highlight.</p>'}
    </div>`);
    this.panel.querySelector('.note.on')?.scrollIntoView({ block: 'center' });
  }
  showFind() {
    this.openPanel('find', `<div class="p-head"><b>Find in book</b><button class="ib" data-a="p:close">✕</button></div><div class="p-body"><input class="input" type="search" placeholder="Word or phrase" autofocus><div class="p-list find-res"></div></div>`);
    const inp = this.panel.querySelector('input'), res = this.panel.querySelector('.find-res');
    inp.focus();
    inp.addEventListener('input', () => {
      clearTimeout(this._ft);
      this._ft = setTimeout(() => {
        const q = inp.value.trim().toLowerCase();
        if (q.length < 3) { res.innerHTML = ''; return; }
        const out = [];
        this.book.chapters.forEach((c, i) => {
          const txt = c._txt ||= decodeEnt(c.raw.replace(/<head[\s\S]*?<\/head>/i, '').replace(PG_STRIP, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
          let at = 0, n = 0; const low = txt.toLowerCase();
          while ((at = low.indexOf(q, at)) >= 0 && n < 20 && out.length < 100) { out.push({ ch: i, k: n, f: at / txt.length, s: txt.slice(Math.max(0, at - 50), at + q.length + 60) }); at += q.length; n++; }
        });
        res.innerHTML = out.length ? out.map(o => `<button class="p-item" data-a="p:findgo" data-ch="${o.ch}" data-f="${o.f}" data-k="${o.k}"><small>${esc(this.book.chapters[o.ch].title)}</small><br>…${esc(o.s)}…</button>`).join('') : '<p class="muted pad">No matches.</p>';
      }, 250);
    });
  }
  panelAction(a) {
    const k = a.dataset.a.slice(2);
    if (k === 'close') return this.closePanels();
    if (k === 'go') { this.closePanels(); return this.render(+a.dataset.ch, { frag: a.dataset.frag }); }
    if (k === 'set') { const v = a.dataset.v; return this.setPref(a.dataset.k, v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v); }
    if (k === 'size') return this.setPref('size', Math.max(13, Math.min(32, this.prefs.size + +a.dataset.d)));
    if (k === 'tts') { this.closePanels(); return this.startTTS(); }
    if (k === 'notes') return this.showNotes();
    if (k === 'find') return this.showFind();
    if (k === 'findgo') {
      const q = this.panel.querySelector('input')?.value.trim().toLowerCase() || '', nth = +a.dataset.k, ch = +a.dataset.ch, f = +a.dataset.f;
      this.closePanels();
      return this.render(ch, { f: Math.max(0, f - 0.01) }).then(() => {
        const norm = this.chEl.textContent.toLowerCase().replace(/\s/g, ' ');
        let at = -1; for (let i = 0; i <= nth; i++) { at = norm.indexOf(q.replace(/\s+/g, ' '), at + 1); if (at < 0) break; }
        if (at >= 0) { this.goOffset(at); flash(this.chEl, at, q.length); }
      });
    }
    if (k === 'print') { this.closePanels(); return this.onExit?.('print'); }
    if (k === 'finish') { this.closePanels(); return this.showEnd(); }
    if (k === 'jump') {
      const list = store.get((a.dataset.k === 'bm' ? 'bm:' : 'hl:') + this.book.id, []), x = list[+a.dataset.i]; if (!x) return;
      this.closePanels();
      if (a.dataset.k === 'hl') return this.render(x.ch).then(() => { const m = this.chEl.querySelector(`mark.hl[data-i="${a.dataset.i}"]`); if (m) this.showEl(m); });
      return this.render(x.ch, { f: x.f, off: x.off });
    }
    if (k === 'rm') {
      const key = (a.dataset.k === 'bm' ? 'bm:' : 'hl:') + this.book.id, list = store.get(key, []).slice();
      list.splice(+a.dataset.i, 1); store.set(key, list);
      if (a.dataset.k === 'hl') { this.render(this.ch, { page: this.page, f: this.fraction() }); }
      this.updateInfo(); return this.showNotes();
    }
  }

  // ----- bookmarks -----
  findBookmark() {
    const list = store.get('bm:' + this.book.id, []);
    if (!list.some(b => b.ch === this.ch)) return -1;
    const f = this.fraction(), tol = this.prefs.mode === 'paged' ? 0.5 / this.pages : 0.03;
    return list.findIndex(b => {
      if (b.ch !== this.ch) return false;
      if (b.off != null) {
        if (this.prefs.mode === 'paged') return this.pageOfOffset(b.off) === this.page;
        const r = this.rectOfOffset(b.off), vr = this.view.getBoundingClientRect();
        return !!r && r.top >= vr.top - 2 && r.top < vr.bottom;
      }
      return Math.abs(b.f - f) <= tol + 1e-6;
    });
  }
  firstVisibleText() {
    const vr = this.view.getBoundingClientRect();
    for (const el of this.chEl.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,div')) {
      const r = el.getBoundingClientRect();
      if (r.right > vr.left + 5 && r.left < vr.right - 5 && r.bottom > vr.top && r.top < vr.bottom && el.textContent.trim().length > 15 && !el.querySelector('p,div')) return el.textContent.trim().replace(/\s+/g, ' ').slice(0, 140);
    }
    return this.book.chapters[this.ch].title;
  }
  toggleBookmark() {
    const key = 'bm:' + this.book.id, list = store.get(key, []).slice(), i = this.findBookmark();
    if (i >= 0) list.splice(i, 1); else { const a = this.anchor(); list.push({ ch: this.ch, f: a.f, off: a.off, label: this.firstVisibleText(), t: Date.now() }); }
    store.set(key, list); this.updateInfo();
    toast(i >= 0 ? 'Bookmark removed' : 'Page bookmarked');
  }

  // ----- highlights -----
  selectionChanged() {
    const b = this.el.querySelector('.rd-hlbtn'), sel = getSelection();
    const ok = sel && !sel.isCollapsed && sel.rangeCount && this.chEl.contains(sel.getRangeAt(0).commonAncestorContainer) && sel.toString().trim().length > 1;
    b.hidden = !ok;
    if (ok && !b._wired) { b._wired = true; b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => this.addHighlight()); }
  }
  addHighlight() {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const pre = document.createRange(); pre.setStart(this.chEl, 0); pre.setEnd(r.startContainer, r.startOffset);
    const off = pre.toString().length, text = r.toString();
    if (!text.trim()) return;
    const key = 'hl:' + this.book.id, list = store.get(key, []).slice();
    list.push({ ch: this.ch, off, len: text.length, text: text.trim().slice(0, 2000), f: this.fraction(), t: Date.now() });
    store.set(key, list);
    sel.removeAllRanges();
    this.el.querySelector('.rd-hlbtn').hidden = true;
    const keep = this.page;
    wrapRange(this.chEl, off, text.length, list.length - 1);
    if (this.prefs.mode === 'paged') this.goPage(keep);
    toast('Highlighted');
  }
  paintHighlights() {
    const list = store.get('hl:' + this.book.id, []);
    list.forEach((h, i) => { if (h.ch === this.ch) wrapRange(this.chEl, h.off, h.len, i); });
  }

  // ----- read aloud -----
  ttsBlocks() {
    const sel = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,dt,dd,.line,div';
    return [...this.chEl.querySelectorAll(sel)].filter(el => el.textContent.trim() && !el.querySelector(sel.split(',').filter(s => s !== '.line').join(',')));
  }
  startTTS(fromStart = false) {
    if (!('speechSynthesis' in window)) return toast('This browser cannot read aloud.');
    const blocks = this.ttsBlocks();
    const vr = this.view.getBoundingClientRect();
    let i = fromStart ? 0 : blocks.findIndex(el => { const r = el.getBoundingClientRect(); return r.right > vr.left + 5 && r.left < vr.right - 5 && r.bottom > vr.top + 5 && r.top < vr.bottom; });
    if (i < 0) i = 0;
    const voices = speechSynthesis.getVoices();
    this.voice = voices.find(v => v.lang?.toLowerCase().startsWith(this.book.lang) && v.localService) || voices.find(v => v.lang?.toLowerCase().startsWith(this.book.lang)) || null;
    if (!this.voice && this.book.lang !== 'en' && !this._warned) { this._warned = true; toast(`No ${this.book.lang.toUpperCase()} voice on this phone, using the default one.`); }
    this.tts = { blocks, i, playing: true };
    this.el.querySelector('.rd-tts').hidden = false;
    this.el.querySelector('.rd-tts-rate').innerHTML = `<button data-a="p:none" class="rate">${this.prefs.rate}×</button>`;
    this.el.querySelector('.rd-tts .rate').onclick = () => { const r = [0.8, 1, 1.2, 1.4, 1.7][([0.8, 1, 1.2, 1.4, 1.7].indexOf(this.prefs.rate) + 1) % 5]; this.prefs.rate = r; store.set('reader', { ...store.get('reader', {}), rate: r }); this.el.querySelector('.rd-tts .rate').textContent = r + '×'; if (this.tts?.playing) { this.speakBlock(); } };
    this.el.querySelector('[data-a=tts-toggle]').textContent = '⏸';
    this.speakBlock();
  }
  speakBlock() {
    const t = this.tts; if (!t) return;
    speechSynthesis.cancel();
    this.chEl.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    if (t.i >= t.blocks.length) {
      if (this.ch < this.book.chapters.length - 1) { this.render(this.ch + 1).then(() => this.startTTS(true)); }
      else this.stopTTS();
      return;
    }
    const el = t.blocks[t.i];
    el.classList.add('speaking');
    const vr = this.view.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.left >= vr.right - 5 || r.right <= vr.left + 5 || r.top >= vr.bottom || r.bottom <= vr.top) this.showEl(el);
    const parts = el.textContent.replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*\s*|.+$/g) || [];
    const chunks = [];
    let cur = '';
    for (const p of parts) { if ((cur + p).length > 220 && cur) { chunks.push(cur); cur = ''; } cur += p; }
    if (cur.trim()) chunks.push(cur);
    let k = 0;
    const say = () => {
      if (!this.tts || this.tts !== t || !t.playing) return;
      if (k >= chunks.length) { t.i++; return this.speakBlock(); }
      const u = new SpeechSynthesisUtterance(chunks[k++]);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang || this.book.lang;
      u.rate = this.prefs.rate;
      u.onend = () => { t.fails = 0; setTimeout(say, 0); };
      u.onerror = e => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        t.fails = (t.fails || 0) + 1;
        if (t.fails >= 2) { this.stopTTS(); toast('Read aloud isn’t working on this device. Check the phone’s text-to-speech settings.'); return; }
        setTimeout(say, 300);
      };
      speechSynthesis.speak(u);
    };
    say();
  }
  toggleTTS() {
    const t = this.tts; if (!t) return;
    t.playing = !t.playing;
    this.el.querySelector('[data-a=tts-toggle]').textContent = t.playing ? '⏸' : '▶️';
    if (t.playing) this.speakBlock(); else speechSynthesis.cancel();
  }
  ttsSkip(d) { if (!this.tts) return; this.tts.i = Math.max(0, this.tts.i + d); this.tts.playing = true; this.el.querySelector('[data-a=tts-toggle]').textContent = '⏸'; this.speakBlock(); }
  stopTTS(hide = true) {
    if (this.tts) { this.tts = null; try { speechSynthesis.cancel(); } catch {} }
    this.chEl?.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    if (hide && this.el) this.el.querySelector('.rd-tts').hidden = true;
  }

  exit(to) {
    const panelEntry = !!(this.panelKind && history.state?.rbPanel);
    this.panelKind = null;
    this.destroy();
    store.sync({ beacon: true }).catch(() => {});
    this.onExit?.(to, panelEntry);
  }
  destroy() {
    this.stopTTS();
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('selectionchange', this.onSel);
    document.removeEventListener('visibilitychange', this.onHide);
    removeEventListener('pagehide', this.onPageHide);
    removeEventListener('popstate', this.onPop);
    try { this.wl?.release(); } catch {}
    this.saveNow();
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#1f1b16');
  }
}

function caretAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const p = document.caretPositionFromPoint?.(x, y); if (!p) return null;
  const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r;
}
function waitImages(root, ms) {
  const imgs = [...root.querySelectorAll('img')].filter(i => !i.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), new Promise(r => setTimeout(r, ms))]);
}
const decodeEnt = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
function flash(root, off, len) {
  wrapRange(root, off, len, -1);
  const m = root.querySelectorAll('mark.hl[data-i="-1"]');
  m.forEach(x => { x.className = 'found'; });
  setTimeout(() => m.forEach(x => x.replaceWith(...x.childNodes)), 2500);
}
function wrapRange(root, off, len, i) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  const end = off + len, hits = [];
  while ((n = walker.nextNode())) {
    const l = n.nodeValue.length;
    if (pos + l > off && pos < end) hits.push([n, Math.max(0, off - pos), Math.min(l, end - pos)]);
    pos += l;
    if (pos >= end) break;
  }
  for (const [node, s, e] of hits) {
    if (!node.nodeValue.slice(s, e).trim()) continue;
    const r = document.createRange(); r.setStart(node, s); r.setEnd(node, e);
    const m = document.createElement('mark'); m.className = 'hl'; m.dataset.i = i;
    try { r.surroundContents(m); } catch {}
  }
}

export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- print / save as PDF ----------
export async function printView(root, book, { title, author, onBack }) {
  const p = { size: 12, font: 'serif', ...store.get('print', {}) };
  root.innerHTML = `<div class="pr">
    <div class="pr-bar no-print">
      <button class="ib" data-a="back">←</button><b>Print or save as PDF</b>
      <label>Text size <select class="pr-size">${[10, 11, 12, 13, 14, 16, 18].map(s => `<option value="${s}" ${s === p.size ? 'selected' : ''}>${s} pt</option>`).join('')}</select></label>
      <label>Font <select class="pr-font"><option value="serif" ${p.font === 'serif' ? 'selected' : ''}>Serif</option><option value="sans" ${p.font === 'sans' ? 'selected' : ''}>Sans</option></select></label>
      <button class="btn primary pr-go">🖨 Print / Save as PDF</button>
      <p class="muted">On your phone choose <b>Save as PDF</b> as the printer.</p>
    </div>
    <article class="pr-book"><section class="pr-title"><h1>${esc(title)}</h1><p>${esc(author)}</p><p class="muted">From Project Gutenberg · gutenberg.org/ebooks/${book.id}</p></section><div class="pr-body"><p class="muted">Preparing the whole book…</p></div></article>
  </div>`;
  const art = root.querySelector('.pr-book'), body = root.querySelector('.pr-body');
  const apply = () => { art.style.setProperty('--pr-size', p.size + 'pt'); art.style.setProperty('--pr-font', p.font === 'sans' ? FONTS.sans : "Georgia, 'Times New Roman', serif"); store.set('print', p); };
  apply();
  root.querySelector('.pr-size').onchange = e => { p.size = +e.target.value; apply(); };
  root.querySelector('.pr-font').onchange = e => { p.font = e.target.value; apply(); };
  root.querySelector('[data-a=back]').onclick = () => onBack();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < book.chapters.length; i++) {
    const sec = document.createElement('section'); sec.className = 'pr-ch';
    sec.append(...(await book.content(i)).childNodes);
    sec.querySelectorAll('a').forEach(a => a.removeAttribute('href'));
    frag.appendChild(sec);
  }
  body.replaceChildren(frag);
  root.querySelector('.pr-go').onclick = async () => { await waitImages(body, 4000); window.print(); };
}
