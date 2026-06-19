/* Naam service worker — instant open + offline last-known view.
   Strategy: app shell cache-first; data network-first with cache fallback;
   creative thumbs cache-first (immutable by content-hash id). */
const VER = 'naam-v10';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // cross-origin live APIs (counters, cockpits): network only, never cache
  if (url.origin !== location.origin) return;
  // data JSON: network-first, fall back to cache (last-known view offline)
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request).then(r => { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // thumbs + shell: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok && (url.pathname.includes('/creative/thumb/') || SHELL.some(s => url.pathname.endsWith(s.replace('./', '/'))))) {
        const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp));
      }
      return r;
    }).catch(() => hit))
  );
});
