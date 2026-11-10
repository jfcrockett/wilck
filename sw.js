// Offline fallback only: always try the network first so updates show up, fall back to the last copy.
const CACHE = 'wilck-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Live data is cached by the page itself; map tiles are too many to keep.
  if (e.request.method !== 'GET' || u.hostname === 'api.themeparks.wiki' || u.hostname.endsWith('openstreetmap.org')) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true})));
});
