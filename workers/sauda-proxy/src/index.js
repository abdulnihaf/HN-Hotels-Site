// ═══════════════════════════════════════════════════════════════════════════
// sauda.hnhotels.in — the owner's entry point for the purchase chamber.
//
// Serves the NEW Sauda app (/ops/sauda/ on the Pages origin) at the bare
// subdomain root, so sauda.hnhotels.in IS the app. The app uses absolute paths
// (/ops/sauda/* for assets, /api/* for data), so everything but the bare root
// is a transparent pass-through to the same path on the origin.
//
// (Until 2026-06-15 this proxied the older /ops/purchase-console app; repointed
// to /ops/sauda per the owner — sauda.hnhotels.in is the single test entry.
// The old surfaces still live at hnhotels.in/ops/purchase-console/* if needed.)
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = 'https://hnhotels.in';
const APP = '/ops/sauda';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // service worker at the subdomain root → scope '/' covers the whole app
    if (path === '/sw.js') {
      const r = await fetch(`${ORIGIN}${APP}/sw.js`);
      const h = new Headers(r.headers);
      h.set('content-type', 'application/javascript');
      h.set('service-worker-allowed', '/');
      h.set('cache-control', 'no-cache');
      return new Response(r.body, { status: r.status, headers: h });
    }

    // PWA manifest → rewrite so the installed app opens at the clean subdomain root
    if (path === `${APP}/manifest.json` || path === '/manifest.json') {
      const r = await fetch(`${ORIGIN}${APP}/manifest.json`);
      if (!r.ok) return new Response('manifest unavailable', { status: 502 });
      const m = await r.json();
      m.start_url = '/';
      m.scope = '/';
      return new Response(JSON.stringify(m), {
        headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
      });
    }

    // bare root → the Sauda app's index; everything else passes through to the
    // same path on the origin (app assets live at /ops/sauda/*, data at /api/*)
    const target = (path === '/' || path === '')
      ? `${ORIGIN}${APP}/${url.search}`
      : `${ORIGIN}${path}${url.search}`;

    return fetch(target, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });
  },
};
