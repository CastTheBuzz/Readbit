// Readbit offline support. VERSION is stamped by deploy.bat so phones pick up updates.
const VERSION = 'dev';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/store.js', '/catalog.js', '/cats.js', '/recs.js', '/reader.js', '/player.js', '/lib/jszip.min.js', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];
const APP = 'rb-app-' + VERSION, DATA = 'rb-data-' + VERSION, FONTS = 'rb-fonts';
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(APP);
  await c.addAll(SHELL);
  await (await caches.open(DATA)).add('/catalog/books.json').catch(() => {});
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== APP && k !== DATA && k !== FONTS) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return;
    if (u.pathname.startsWith('/catalog/')) {
      e.respondWith(caches.open(DATA).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
      return;
    }
    e.respondWith(caches.open(APP).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true }) || (u.pathname === '/' ? await c.match('/index.html') : null);
      return hit || fetch(e.request);
    }));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => new Response('', { status: 504 }))));
  }
});
