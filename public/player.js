// Audiobooks from LibriVox (free, read by volunteers), played with a small player that stays on screen.
import * as store from './store.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const P = { id: null, title: '', author: '', lv: null, sec: 0 };
let audio, bar, saveT;
const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const fmt = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
export const total = lv => lv.sections.reduce((a, s) => a + s.secs, 0);

export async function findAudio(title, author) {
  const r = await store.api(`/api/audio?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
  return (await r.json()).books || [];
}

export function init() {
  audio = document.getElementById('audio');
  bar = document.getElementById('mini');
  audio.addEventListener('timeupdate', () => { paint(); clearTimeout(saveT); saveT = setTimeout(savePos, 4000); });
  audio.addEventListener('play', paint); audio.addEventListener('pause', () => { paint(); savePos(); });
  audio.addEventListener('ended', () => { if (P.lv && P.sec < P.lv.sections.length - 1) playSection(P.sec + 1, 0, true); else { savePos(); paint(); } });
  audio.addEventListener('error', () => { if (P.lv) { bar.querySelector('.mini-sub').textContent = 'Could not load this part. Check your connection.'; } });
  bar.addEventListener('click', e => {
    const a = e.target.closest('[data-p]'); if (!a) return;
    const act = a.dataset.p;
    if (act === 'toggle') toggle();
    if (act === 'back') audio.currentTime = Math.max(0, audio.currentTime - 30);
    if (act === 'fwd') audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 30);
    if (act === 'open') location.hash = `#/listen/${P.id}`;
    if (act === 'close') stop();
  });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => { audio.currentTime -= 30; });
    ms.setActionHandler('seekforward', () => { audio.currentTime += 30; });
    ms.setActionHandler('previoustrack', () => P.sec > 0 && playSection(P.sec - 1, 0, true));
    ms.setActionHandler('nexttrack', () => P.lv && P.sec < P.lv.sections.length - 1 && playSection(P.sec + 1, 0, true));
  }
  paint();
}

export function load(id, title, author, lv, sec = 0, t = 0, autoplay = true) {
  Object.assign(P, { id: +id, title, author, lv });
  audio.playbackRate = store.get('audioRate', 1);
  playSection(sec, t, autoplay);
}
export function playSection(sec, t = 0, autoplay = true) {
  if (!P.lv || !Number.isFinite(+sec)) return;
  P.sec = Math.max(0, Math.min(sec, P.lv.sections.length - 1));
  const s = P.lv.sections[P.sec];
  audio.src = s.url;
  audio.playbackRate = store.get('audioRate', 1);
  const seek = () => { if (t) audio.currentTime = t; audio.removeEventListener('loadedmetadata', seek); };
  audio.addEventListener('loadedmetadata', seek);
  if (autoplay) audio.play().catch(() => {});
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: s.title || P.title, artist: P.author, album: P.title, artwork: [{ src: `https://www.gutenberg.org/cache/epub/${P.id}/pg${P.id}.cover.medium.jpg`, sizes: '300x450', type: 'image/jpeg' }] });
  savePos(); paint();
  dispatchEvent(new Event('player'));
}
export function toggle() { if (!P.lv) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
export function stop() { savePos(); audio.pause(); audio.removeAttribute('src'); P.lv = null; P.id = null; paint(); dispatchEvent(new Event('player')); }
export function setRate(r) { store.set('audioRate', r); audio.playbackRate = r; dispatchEvent(new Event('player')); }
export const nextRate = () => SPEEDS[(SPEEDS.indexOf(store.get('audioRate', 1)) + 1) % SPEEDS.length];
export const el = () => audio;

function savePos() {
  if (!P.lv || !P.id) return;
  store.set('aud:' + P.id, { lv: P.lv.id, sec: P.sec, t: Math.floor(audio.currentTime || 0), d: Date.now() });
}
function paint() {
  if (!bar) return;
  document.body.classList.toggle('has-mini', !!P.lv);
  bar.hidden = !P.lv;
  if (!P.lv) { bar._key = null; return; }
  const s = P.lv.sections[P.sec];
  const key = P.id + ':' + P.sec;
  if (bar._key !== key) {
    bar._key = key;
    bar.innerHTML = `<button class="mini-info" data-p="open"><b>${esc(P.title)}</b><span class="mini-sub"></span></button>
      <button class="ib" data-p="back" aria-label="Back 30 seconds">↺</button>
      <button class="ib play" data-p="toggle" aria-label="Play or pause"></button>
      <button class="ib" data-p="fwd" aria-label="Forward 30 seconds">↻</button>
      <button class="ib" data-p="close" aria-label="Close player">✕</button>
      <div class="mini-prog"></div>`;
  }
  bar.querySelector('.mini-sub').textContent = `${s?.title || ''} · ${fmt(audio.currentTime)} / ${fmt(audio.duration || s?.secs)}`;
  bar.querySelector('.play').textContent = audio.paused ? '▶' : '⏸';
  bar.querySelector('.mini-prog').style.width = (audio.duration ? (audio.currentTime / audio.duration * 100).toFixed(1) : 0) + '%';
  dispatchEvent(new Event('player-tick'));
}
