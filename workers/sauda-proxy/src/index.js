const ORIGIN = 'https://hnhotels.in';
const APP_BASE = '/ops/purchase-console';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Pages Functions / API pass straight through at root
    if (path.startsWith('/api/')) {
      return fetch(ORIGIN + path + url.search, request);
    }
    // Root-scoped manifest: fetch origin manifest, rewrite scope/start_url/icons to root
    if (path === '/manifest.json') {
      const r = await fetch(ORIGIN + APP_BASE + '/manifest.json');
      if (!r.ok) return new Response('manifest unavailable', { status: 502 });
      const m = await r.json();
      m.start_url = '/';
      m.scope = '/';
      if (Array.isArray(m.icons)) {
        m.icons = m.icons.map((i) => ({ ...i, src: '/' + String(i.src).replace(/^\.?\//, '').replace(/^ops\/purchase-console\//, '') }));
      }
      return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
    }
    // The ONE-APP gate (2026-06-11): the bare root serves the PIN-gated role home
    // (/home/) which routes Zoya/Bashir/owner to their tiles. Every existing
    // surface (/today /order /pay /receive /item /milk /ration /browse /portals
    // /place) keeps its path untouched — the home only links to them.
    if (path === '/' || path === '/home' || path === '/home/') {
      const res = await fetch(ORIGIN + APP_BASE + '/home/' + url.search, request);
      const html = (await res.text()).split(APP_BASE + '/').join('/').split(APP_BASE).join('');
      const h = new Headers(res.headers); h.delete('content-length');
      return new Response(html, { status: res.status, headers: h });
    }
    // Payment Requests app (full vendor book + UPI deep links) lives outside
    // APP_BASE — bridge it onto this host at /requests/.
    if (path === '/requests' || path.startsWith('/requests/')) {
      const sub = path.replace(/^\/requests\/?/, '');
      return fetch(ORIGIN + '/ops/sauda-pay/' + sub + url.search, request);
    }
    // Everything else: map subdomain-root path -> APP_BASE on origin.
    // redirect:'follow' — Pages 308-normalizes /dir to /dir/; the incoming
    // request's manual redirect mode must not leak the origin URL to the user.
    const target = ORIGIN + APP_BASE + (path === '/' ? '/' : path) + url.search;
    const res = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      let html = await res.text();
      html = html.split(APP_BASE + '/').join('/').split(APP_BASE).join('');
      const h = new Headers(res.headers);
      h.delete('content-length');
      return new Response(html, { status: res.status, headers: h });
    }
    return res;
  },
};
