// hn-hr-cron — Cloudflare Worker with cron triggers for HR automation.
// Triggers /api/hr-automation endpoints on hnhotels.in based on UTC schedule.
// All HR logic lives on the Pages Functions side; this worker is just a clock.

const PAGES_BASE = 'https://hnhotels.in';

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const promises = [];

    // Match exact cron strings from wrangler.toml
    if (cron === '*/15 * * * *') {
      // Multi-channel escalation: WABA → DLT SMS → Voice fallback
      promises.push(callComms(env, 'cron-escalate'));
    } else if (cron === '30 21 * * *' || cron === '30 5 * * *' || cron === '30 13 * * *') {
      // Absence detection (3x daily: pre-shift, mid-shift, end-of-shift)
      promises.push(callPages(env, 'cron-detect-absences'));
    } else if (cron === '30 2 * * *') {
      // Ghost PIN detection (8 AM IST)
      promises.push(callPages(env, 'cron-detect-ghosts'));
    } else if (cron === '30 16 * * *') {
      // Daily summary (10 PM IST)
      promises.push(callPages(env, 'cron-daily-summary'));
    } else {
      // Unknown cron: run safe defaults
      promises.push(callPages(env, 'cron-detect-absences'));
      promises.push(callComms(env, 'cron-escalate'));
    }

    ctx.waitUntil(Promise.all(promises));
  },

  // Manual trigger via HTTP (for testing — needs same auth)
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    if (request.headers.get('x-cron-token') !== env.CRON_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    const action = url.searchParams.get('action');
    const validHrActions = ['cron-detect-absences', 'cron-detect-ghosts', 'cron-daily-summary'];
    const validCommsActions = ['cron-escalate'];
    if (validHrActions.includes(action)) {
      const result = await callPages(env, action);
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    }
    if (validCommsActions.includes(action)) {
      const result = await callComms(env, action);
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('Invalid action', { status: 400 });
  },
};

async function callPages(env, action) {
  try {
    const r = await fetch(`${PAGES_BASE}/api/hr-automation?action=${action}`, {
      method: 'POST',
      headers: {
        'x-cron-token': env.CRON_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ triggered_by: 'cron' }),
    });
    const data = await r.json().catch(() => ({}));
    console.log(`[${action}]`, JSON.stringify(data).slice(0, 500));
    return { action, ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error(`[${action}] error:`, e.message);
    return { action, ok: false, error: e.message };
  }
}

// Calls the comms hub (multi-channel escalation runner)
async function callComms(env, action) {
  try {
    const r = await fetch(`${PAGES_BASE}/api/comms?action=${action}`, {
      method: 'POST',
      headers: {
        'x-cron-token': env.CRON_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ triggered_by: 'cron' }),
    });
    const data = await r.json().catch(() => ({}));
    console.log(`[comms:${action}]`, JSON.stringify(data).slice(0, 500));
    return { action, ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error(`[comms:${action}] error:`, e.message);
    return { action, ok: false, error: e.message };
  }
}
