// Sauda service worker — makes the PWA feel native: the app shell loads
// instantly from cache (no white flash / forced reload on iOS resume), while
// staying fresh in the background. API calls are NEVER cached (always live).
const CACHE = 'sauda-shell-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') >= 0) return; // live data, never cached
  // stale-while-revalidate: serve cache instantly, refresh in the background
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(e.request).then((cached) => {
        const net = fetch(e.request)
          .then((resp) => { if (resp && resp.status === 200) c.put(e.request, resp.clone()); return resp; })
          .catch(() => cached);
        return cached || net;
      })
    )
  );
});
