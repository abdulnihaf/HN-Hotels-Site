// ═══════════════════════════════════════════════════════════════════════════
// Pages Middleware — Host-aware path rewriter
//
// On `trade.hnhotels.in`: serve the /trading/* tree at root paths.
//   trade.hnhotels.in/           → /trading/execute/  (default landing)
//   trade.hnhotels.in/execute/   → /trading/execute/
//   trade.hnhotels.in/ops/       → /trading/ops/
//   trade.hnhotels.in/data/      → /trading/         (the 20-tab data view)
//   trade.hnhotels.in/api/*      → /api/*            (untouched)
//   trade.hnhotels.in/wealth/*   → /wealth/*         (untouched, OAuth)
//
// On any other host (hnhotels.in, app.hnhotels.in, *.pages.dev): no-op.
// User can still access /trading/* on hnhotels.in directly.
// ═══════════════════════════════════════════════════════════════════════════

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;

  // Only intervene for the trade subdomain
  if (host !== 'trade.hnhotels.in') {
    return next();
  }

  // Pass-through paths — these resolve normally on this host
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/wealth/') ||
    url.pathname.startsWith('/trading/')  // direct /trading/ links still work
  ) {
    return next();
  }

  // PWA assets — rewrite to /trading/* (they don't exist at root)
  if (url.pathname === '/manifest.json') {
    return rewriteTo(request, new URL('/trading/manifest.json', url));
  }
  if (url.pathname === '/sw.js') {
    return rewriteTo(request, new URL('/trading/sw.js', url));
  }
  if (url.pathname.startsWith('/icons/')) {
    return rewriteTo(request, new URL('/trading' + url.pathname, url));
  }
  if (url.pathname === '/favicon.ico') {
    return rewriteTo(request, new URL('/trading/icons/icon-192.svg', url));
  }

  // Root → execute UI (the daily app)
  if (url.pathname === '/' || url.pathname === '') {
    const target = new URL('/trading/execute/', url);
    target.search = url.search;
    return rewriteTo(request, target);
  }

  // /execute, /execute/ → /trading/execute/
  if (url.pathname === '/execute' || url.pathname === '/execute/') {
    const target = new URL('/trading/execute/', url);
    target.search = url.search;
    return rewriteTo(request, target);
  }

  // /ops, /ops/ → /trading/ops/
  if (url.pathname === '/ops' || url.pathname === '/ops/') {
    const target = new URL('/trading/ops/', url);
    target.search = url.search;
    return rewriteTo(request, target);
  }

  // /data, /data/ → /trading/  (the 20-tab data dashboard)
  if (url.pathname === '/data' || url.pathname === '/data/') {
    const target = new URL('/trading/', url);
    target.search = url.search;
    return rewriteTo(request, target);
  }

  // PWA manifest at root → /trading/manifest.json
  // (Otherwise the PWA on trade subdomain would 404)
  if (url.pathname === '/manifest.json') {
    const target = new URL('/trading/manifest.json', url);
    return rewriteTo(request, target);
  }

  // Service worker
  if (url.pathname === '/sw.js') {
    const target = new URL('/trading/sw.js', url);
    return rewriteTo(request, target);
  }

  // Icons
  if (url.pathname.startsWith('/icons/')) {
    const target = new URL('/trading' + url.pathname, url);
    return rewriteTo(request, target);
  }

  // Anything else on the trade subdomain → 404
  return new Response('Not Found', { status: 404 });
}

// Rewrite (internal) — keeps the user-visible URL but serves a different path
function rewriteTo(originalRequest, targetUrl) {
  const newRequest = new Request(targetUrl.toString(), originalRequest);
  return fetch(newRequest);
}
