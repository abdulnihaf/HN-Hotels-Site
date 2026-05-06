// Wealth Engine — Service Worker (PWA)
// Caches static assets for offline / fast reload.
// API calls are NEVER cached — always fresh.

const CACHE_VERSION = 'wealth-v34';  // v34: P1-P5 owner-calibrated 4-layer + audit_findings auto-resolve + UI shows resolution state
const STATIC_CACHE = `static-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/trading/',
  '/trading/execute/',
  '/trading/ops/',
  '/trading/today/',
  '/trading/compare/',
  '/trading/audit/',
  '/trading/roadmap/',
  '/trading/manifest.json',
  '/trading/icons/icon-192.svg',
  '/trading/icons/icon-512.svg',
  '/trading/icons/icon-maskable-512.svg',
  '/trading/_lib/picker.js',
  '/trading/_lib/watchlist-component.js',
];

// Install — pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - /api/* → network only (never cache)
//   - /trading/* HTML → network-first, fall back to cache
//   - manifest, icons → cache-first
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API requests — always network, never cache
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle normally
  }

  // Service worker file itself
  if (url.pathname.endsWith('/sw.js')) {
    return;
  }

  // Static assets — cache first
  if (url.pathname.match(/\.(svg|png|ico|css|js|json)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // HTML pages on trade.hnhotels.in OR /trading/* — NETWORK FIRST always
  // (fall back to cache only if offline)
  const isHtmlRoute =
    url.pathname.startsWith('/trading/') ||
    url.pathname === '/' ||
    url.pathname === '/execute/' ||
    url.pathname === '/ops/' ||
    url.pathname === '/data/';
  if (isHtmlRoute) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
});

// Push notification handler (future use)
self.addEventListener('push', (e) => {
  let data = { title: 'Wealth Engine', body: 'Update' };
  try { data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/trading/icons/icon-192.svg',
    badge: '/trading/icons/icon-192.svg',
    tag: data.tag || 'wealth',
    data: data,
  }));
});

// Tap a notification → open the app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/trading/execute/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) {
      if (c.url.includes('/trading/') && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
