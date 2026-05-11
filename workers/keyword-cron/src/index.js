// hn-keyword-cron — Cloudflare Worker that fires /api/keyword-tracker?action=fetch
// once daily so the HE keyword universe stays current in D1 (kw_volumes table).
//
// Why a sibling worker: Cloudflare Pages Functions don't support cron triggers
// natively. The Pages Function at /api/keyword-tracker handles the actual
// Keyword Planner fetch + D1 persist; this worker is purely a clock.
//
// No auth needed — /api/keyword-tracker?action=fetch is unauthenticated by
// design (read-style endpoint that mutates a cache).

const PAGES_BASE = 'https://hnhotels.in';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerFetch());
  },

  // Manual trigger via HTTP for testing.
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    const result = await triggerFetch();
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function triggerFetch() {
  try {
    const r = await fetch(`${PAGES_BASE}/api/keyword-tracker?action=fetch`);
    const data = await r.json().catch(() => ({}));
    console.log('[keyword-tracker-fetch]', JSON.stringify(data).slice(0, 500));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error('[keyword-tracker-fetch] error:', e.message);
    return { ok: false, error: e.message };
  }
}
