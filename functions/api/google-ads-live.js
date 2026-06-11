// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE ADS LIVE — campaign insights for Naam (GAQL, read-only)
// Auth pattern proven in hamza-express-site/functions/api/google-ads.js (v23).
// Secrets: GOOGLE_ADS_CLIENT_ID/SECRET, GOOGLE_ORGANIC_REFRESH_TOKEN (adwords
// scope), GOOGLE_ADS_DEV_TOKEN. Customer: HE 3681710084.
// DOCTRINE: no conversion metrics — platform conversion tracking is broken for
// HN; impact is judged by POS-spike correlation. Edge-cached 10 min.
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://googleads.googleapis.com/v23';
const CUSTOMER_ID = '3681710084';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const period = url.searchParams.get('period') === '30d' ? 'LAST_30_DAYS' : 'LAST_7_DAYS';

  const cacheKey = new Request(`https://cache.naam/google-ads/${period}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const env = context.env;
  if (!env.GOOGLE_ADS_DEV_TOKEN || !env.GOOGLE_ADS_CLIENT_ID) {
    return new Response(JSON.stringify({ ok: false, error: 'Google Ads secrets not configured' }), { status: 500, headers: cors });
  }

  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_ADS_CLIENT_ID,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: env.GOOGLE_ORGANIC_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    }).then(r => r.json());
    if (!tok.access_token) throw new Error('OAuth failed: ' + JSON.stringify(tok).slice(0, 200));

    const query = `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.impressions,
      metrics.clicks, metrics.ctr, metrics.average_cpc
      FROM campaign WHERE segments.date DURING ${period} AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC`;

    const r = await fetch(`${API}/customers/${CUSTOMER_ID}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tok.access_token}`,
        'developer-token': env.GOOGLE_ADS_DEV_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) throw new Error(`Ads API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();

    const campaigns = (data.results || []).map(x => ({
      name: x.campaign.name,
      status: x.campaign.status,
      spend: Math.round((x.metrics.costMicros || 0) / 1e6),
      impressions: parseInt(x.metrics.impressions || 0),
      clicks: parseInt(x.metrics.clicks || 0),
      ctr: Math.round((x.metrics.ctr || 0) * 10000) / 100,
      cpc: Math.round((x.metrics.averageCpc || 0) / 1e6 * 100) / 100,
    }));
    const totals = campaigns.reduce((t, c) => ({
      spend: t.spend + c.spend, clicks: t.clicks + c.clicks, impressions: t.impressions + c.impressions,
    }), { spend: 0, clicks: 0, impressions: 0 });

    const res = new Response(JSON.stringify({
      ok: true, period: period === 'LAST_30_DAYS' ? '30d' : '7d', asOf: new Date().toISOString(),
      note: 'Conversions omitted by doctrine — judge by POS-spike correlation.',
      totals, campaigns,
    }), { headers: { ...cors, 'Cache-Control': 'public, max-age=600' } });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: cors });
  }
}
