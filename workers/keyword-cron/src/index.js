// hn-keyword-cron — Cloudflare Worker that fires /api/keyword-tracker?action=fetch
// once daily so the HE keyword universe stays current in D1 (kw_volumes table).
//
// Why a sibling worker: Cloudflare Pages Functions don't support cron triggers
// natively. The Pages Function at /api/keyword-tracker handles the actual
// Keyword Planner fetch + D1 persist; this worker is purely a clock.
//
// Auth: /api/keyword-tracker?action=fetch is gated by ?key=DASHBOARD_KEY
// on the Pages Function side (keyword-tracker.js:177). Worker must pass
// env.DASHBOARD_KEY as a query param. Set the secret via:
//   cd workers/keyword-cron && npx wrangler secret put DASHBOARD_KEY

const PAGES_BASE = 'https://hnhotels.in';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerFetch(env));
  },

  // Manual trigger via HTTP for testing.
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    const result = await triggerFetch(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function triggerFetch(env) {
  if (!env.DASHBOARD_KEY) {
    return { ok: false, error: 'DASHBOARD_KEY secret missing — run `wrangler secret put DASHBOARD_KEY`' };
  }
  try {
    const url = `${PAGES_BASE}/api/keyword-tracker?action=fetch&key=${encodeURIComponent(env.DASHBOARD_KEY)}`;
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    console.log('[keyword-tracker-fetch]', JSON.stringify(data).slice(0, 500));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error('[keyword-tracker-fetch] error:', e.message);
    return { ok: false, error: e.message };
  }
}
