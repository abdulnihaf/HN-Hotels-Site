/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/naam-creative-asset — public image proxy for R2 NAAM_CREATIVE.
 *
 * Instagram and Google Business Profile require public HTTPS image URLs.
 * This endpoint serves objects from the NAAM_CREATIVE bucket with
 * permissive CORS so platform crawlers can fetch them.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ALLOW_ORIGINS = new Set([
  'https://naam.hnhotels.in',
  'https://hnhotels.in',
  'http://localhost:8789', 'http://127.0.0.1:8789',
]);

function cors(origin) {
  const o = origin || '';
  const allow = ALLOW_ORIGINS.has(o) || /^https:\/\/[a-z0-9-]+\.(naam-ec8|naam|hn-hotels-site)\.pages\.dev$/.test(o)
    ? o : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response(JSON.stringify({ ok: false, error: 'key required' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });

  const bucket = env.NAAM_CREATIVE;
  if (!bucket) return new Response(JSON.stringify({ ok: false, error: 'bucket not configured' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });

  try {
    const obj = await bucket.get(key);
    if (!obj) return new Response('not found', { status: 404, headers });
    const body = await obj.arrayBuffer();
    const out = new Response(body, {
      headers: {
        ...headers,
        'Content-Type': obj.httpMetadata?.contentType || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
    return out;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
}
