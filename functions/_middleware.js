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

  // ── SECURITY: deny public access to internal source/context files ─────────
  // With pages_build_output_dir = "." every committed file is uploaded as a
  // static asset — so /NIHAF-BRAIN.md, /CLAUDE.md, /docs/*.md, schema-*.sql,
  // wrangler.toml etc. were being served on the open web. They exist for
  // Claude/Codex context, NEVER for the public. 404 them on every host, before
  // any routing. App surfaces (.html/.js/.css/.json/images) are untouched.
  if (isInternalAsset(url.pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  // ── darbar.hnhotels.in — serve the Darbar app at the bare subdomain root ──
  // The app lives at /ops/darbar/ and uses absolute asset/api paths, so we only
  // rewrite the bare root (clean URL, no redirect); everything else resolves
  // normally on this host. (CF Pages _redirects can't host-route — hence here.)
  if (host === 'darbar.hnhotels.in') {
    if (url.pathname === '/' || url.pathname === '') {
      const target = new URL('/ops/darbar/index.html', url);
      target.search = url.search;
      return rewriteTo(request, target);
    }
    return next();
  }

  // ── Anbar brand entrypoints — one PWA/backend, brand-scoped launches ──
  // These paths work on both hnhotels.in and anbar.hnhotels.in so QR links can
  // preselect the right outlet without creating separate installed apps.
  const anbarCanonical = canonicalAnbarPath(url);
  if (anbarCanonical) return Response.redirect(anbarCanonical.toString(), 302);

  // ── anbar.hnhotels.in — the storehouse chamber (inventory). App at /ops/anbar/ ──
  if (host === 'anbar.hnhotels.in') {
    if (url.pathname === '/' || url.pathname === '' || url.pathname === '/index.html') {
      return Response.redirect(anbarRootTarget(url).toString(), 302);
    }

    const MAP = {
      '/': '/ops/anbar/',
      '/index.html': '/ops/anbar/',
      '/receive': '/ops/anbar/receive/',
      '/receive/': '/ops/anbar/receive/',
      '/manifest.json': '/ops/anbar/manifest.json',
      '/icon-192.png': '/ops/anbar/icon-192.png',
      '/icon-512.png': '/ops/anbar/icon-512.png',
    };
    const target = MAP[url.pathname];
    if (target) {
      const t = new URL(target, url);
      t.search = url.search;   // preserve ?loc= QR-door scoping
      return rewriteTo(request, t);
    }
    return next();
  }

  // ── sauda.hnhotels.in (and sawda.) — the purchase chamber. App at /ops/sauda/ ──
  if (host === 'sauda.hnhotels.in' || host === 'sawda.hnhotels.in') {
    const MAP = {
      '/': '/ops/sauda/',
      '/index.html': '/ops/sauda/',
      '/manifest.json': '/ops/sauda/manifest.json',
      '/icon-180.png': '/ops/sauda/icon-180.png',
      '/icon-192.png': '/ops/sauda/icon-192.png',
      '/icon-512.png': '/ops/sauda/icon-512.png',
    };
    const target = MAP[url.pathname];
    if (target) {
      const t = new URL(target, url);
      t.search = url.search;
      return rewriteTo(request, t);
    }
    return next();
  }

  // ── hisaab.hnhotels.in — the reckoning chamber (daily P&L). App at /ops/hisaab/ ──
  if (host === 'hisaab.hnhotels.in') {
    const MAP = {
      '/': '/ops/hisaab/',
      '/index.html': '/ops/hisaab/',
    };
    const target = MAP[url.pathname];
    if (target) {
      const t = new URL(target, url);
      t.search = url.search;
      return rewriteTo(request, t);
    }
    return next();
  }

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

// SECURITY: true for internal source/context files that must never be public.
// Matches extensions that are never legitimate app assets + named config files.
// Deliberately does NOT match .json (manifest.json), .html, .js, .css, images.
function isInternalAsset(pathname) {
  if (/\.(md|markdown|sql|toml|sh|bash|lock|gitignore|cfignore)$/i.test(pathname)) return true;
  const base = (pathname.split('/').pop() || '').toLowerCase();
  return base === 'package.json' || base === 'package-lock.json'
      || base === '.env' || base.startsWith('.env.') || base === '.dev.vars';
}

// Rewrite (internal) — keeps the user-visible URL but serves a different path
function rewriteTo(originalRequest, targetUrl) {
  const newRequest = new Request(targetUrl.toString(), originalRequest);
  return fetch(newRequest);
}

function canonicalAnbarPath(url) {
  const p = url.pathname;
  if (p === '/ops/anbar/he' || p === '/ops/anbar/nch' || p === '/ops/anbar/choose') {
    const target = new URL(p + '/', url);
    target.search = url.search;
    return target;
  }
  return null;
}

function anbarRootTarget(url) {
  const target = new URL('/ops/anbar/choose/', url);
  const brand = (url.searchParams.get('brand') || '').toUpperCase();
  const kind = (url.searchParams.get('kind') || '').toLowerCase();
  const vendor = (url.searchParams.get('vendor') || '').toLowerCase();
  const loc = (url.searchParams.get('loc') || '').toLowerCase();

  if (brand === 'HE' || kind === 'chicken' || vendor === 'mn') {
    target.pathname = '/ops/anbar/he/';
  } else if (brand === 'NCH' || loc === 'store' || loc === 'counter' || loc === 'kitchen') {
    target.pathname = '/ops/anbar/nch/';
  }

  target.search = url.search;
  return target;
}
