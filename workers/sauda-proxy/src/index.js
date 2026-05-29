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
    // Everything else: map subdomain-root path -> APP_BASE on origin
    const target = ORIGIN + APP_BASE + (path === '/' ? '/' : path) + url.search;
    const res = await fetch(target, request);
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
