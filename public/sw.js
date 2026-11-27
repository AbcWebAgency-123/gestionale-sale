// Service worker: rende il gestionale installabile e carica subito l'interfaccia.
// Le chiamate /api/ vanno sempre in rete (dati sempre aggiornati, mai in cache).
const CACHE = 'cardo-v1';
const SHELL = ['/index.html', '/style.css', '/common.js', '/app.js', '/fonts/fonts.css', '/brand/logo-bianco.png', '/brand/app-192.png', '/offline.html'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/display')) return;
  // rete prima, cache come riserva (così ogni aggiornamento del gestionale arriva subito)
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())));
});
