// hn-influencer-pipeline-cron — clock for the autonomous influencer pipeline.
// All logic lives at https://hnhotels.in/api/influencer-pipeline (Pages Function).
// This Worker just fires HTTP POSTs on schedule, authenticated via X-Cron-Token.

const PAGES_BASE = 'https://hnhotels.in';

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const fired = [];

    if (cron === '0 22 * * *') {
      fired.push(call(env, 'cron-discover'));
    } else if (cron === '30 22 * * *') {
      fired.push(call(env, 'cron-enrich-tick'));
    } else if (cron === '0 23 * * *') {
      fired.push(call(env, 'cron-score'));
    } else if (cron === '30 4 * * *') {
      fired.push(call(env, 'cron-outreach-wave'));
    } else {
      // Unknown cron - fire enrich ticker (safe default, idempotent)
      fired.push(call(env, 'cron-enrich-tick'));
    }

    ctx.waitUntil(Promise.all(fired));
  },

  // Manual trigger via HTTP — for testing each cron without waiting for schedule.
  // POST https://<worker-url>/?action=cron-discover  with X-Cron-Token header
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    if (request.headers.get('x-cron-token') !== env.CRON_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
    const action = url.searchParams.get('action');
    const valid = ['cron-discover', 'cron-enrich-tick', 'cron-score', 'cron-outreach-wave'];
    if (!valid.includes(action)) return new Response('unknown action', { status: 400 });

    const result = await call(env, action);
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  },
};

async function call(env, action) {
  const url = `${PAGES_BASE}/api/influencer-pipeline?action=${encodeURIComponent(action)}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Token': env.CRON_TOKEN,
      },
      body: '{}',
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { action, http_status: r.status, body };
  } catch (e) {
    return { action, error: e.message };
  }
}
