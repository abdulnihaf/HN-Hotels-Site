// ═══════════════════════════════════════════════════════════════════════════
// META ADS — live campaign insights for Naam (naam.hnhotels.in)
//
// DOCTRINE (owner-verified): Meta's conversion column is BROKEN for HN
// (reports 0 despite real click activity). This endpoint deliberately returns
// NO conversion metrics — spend / reach / clicks / CTR / frequency only.
// Sales impact is judged by POS-spike correlation, never platform conversions.
//
// Secrets: META_ADS_TOKEN (user token, ads_read), META_AD_ACCOUNT_ID.
// Edge-cached 10 min — Naam is a glance app, not a trading terminal.
// ═══════════════════════════════════════════════════════════════════════════

const GRAPH = 'https://graph.facebook.com/v21.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const period = url.searchParams.get('period') === '30d' ? 'last_30d' : 'last_7d';

  // Edge cache: one Graph hit per 10 minutes per period
  const cacheKey = new Request(`https://cache.naam/meta-ads/${period}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const TOKEN = context.env.META_ADS_TOKEN;
  const ACCT = context.env.META_AD_ACCOUNT_ID;
  if (!TOKEN || !ACCT) {
    return new Response(JSON.stringify({ ok: false, error: 'META_ADS_TOKEN / META_AD_ACCOUNT_ID not configured' }), { status: 500, headers: cors });
  }

  try {
    const fields = 'campaign_name,spend,impressions,clicks,ctr,cpc,reach,frequency';
    const r = await fetch(`${GRAPH}/act_${ACCT}/insights?level=campaign&fields=${fields}&date_preset=${period}&access_token=${encodeURIComponent(TOKEN)}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);

    const campaigns = (d.data || []).map(c => ({
      name: c.campaign_name,
      spend: Math.round(parseFloat(c.spend || 0)),
      impressions: parseInt(c.impressions || 0),
      clicks: parseInt(c.clicks || 0),
      ctr: Math.round(parseFloat(c.ctr || 0) * 100) / 100,
      cpc: Math.round(parseFloat(c.cpc || 0) * 100) / 100,
      reach: parseInt(c.reach || 0),
      frequency: Math.round(parseFloat(c.frequency || 0) * 100) / 100,
    })).sort((a, b) => b.spend - a.spend);

    const totals = campaigns.reduce((t, c) => ({
      spend: t.spend + c.spend, clicks: t.clicks + c.clicks, impressions: t.impressions + c.impressions,
    }), { spend: 0, clicks: 0, impressions: 0 });

    const res = new Response(JSON.stringify({
      ok: true,
      period: period === 'last_30d' ? '30d' : '7d',
      asOf: new Date().toISOString(),
      note: 'Platform conversion columns are broken for HN — judge impact by POS-spike correlation, not conversions.',
      totals, campaigns,
    }), { headers: { ...cors, 'Cache-Control': 'public, max-age=600' } });

    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: cors });
  }
}
