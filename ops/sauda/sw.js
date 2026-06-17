// Sauda service worker — native feel without ever trapping a stale build.
//   page/HTML  → network-first (always the latest app; cache only as offline fallback)
//   assets     → stale-while-revalidate (instant load, refreshes in background)
//   /api/*     → never touched (always live)
const CACHE = 'sauda-shell-v2';

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
  const isPage = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (isPage) {
    // network-first → the newest build always wins; cached page only if offline
    e.respondWith(
      fetch(e.request)
        .then((resp) => { if (resp && resp.status === 200) { const cp = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return resp; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
    );
    return;
  }
  // assets → stale-while-revalidate
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
