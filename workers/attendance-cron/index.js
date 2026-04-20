/**
 * hn-attendance-cron — Cloudflare Worker
 *
 * Fires every 15 min. Calls the HN HR Ops Pages Function to pull
 * hr.attendance from Odoo → D1 hr_attendance_daily for today (IST).
 *
 * Active window: 06:00–23:00 IST only (skips overnight runs).
 * Manual trigger: GET /?key=<ADMIN_PIN> returns result inline.
 *
 * Architecture:
 *   [Cron trigger] → [this Worker] → POST https://hnhotels.in/api/hr-admin
 *                                         → pullAttendance (Odoo → D1)
 */

export default {
  // Manual trigger: GET /?key=<ADMIN_PIN>
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!env.ADMIN_PIN || key !== env.ADMIN_PIN) {
      return new Response('unauthorized', { status: 401 });
    }
    const result = await runPull(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Scheduled trigger: every 15 min
  // Piggybacks spend-sync-cron on this trigger because we are at the
  // free-tier 5-crons-per-account cap. 15-min freshness is plenty for
  // fact_spend; attendance was already the highest-frequency cron.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPull(env));
    ctx.waitUntil(pingSpendSync(env));
  },
};

async function pingSpendSync(env) {
  const url = env.SPEND_SYNC_URL;
  const key = env.SPEND_SYNC_KEY;
  if (!url || !key) return;  // not configured — silently skip
  try {
    await fetch(`${url}?key=${encodeURIComponent(key)}&instance=all`, {
      method: 'GET',
      // 25s max — leaves headroom for attendance-cron's own budget
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    // Swallow — spend-sync failure should not cascade and kill attendance
    console.error('spend-sync ping failed:', e.message);
  }
}

async function runPull(env) {
  const now = new Date();

  // IST = UTC + 5h30m
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istNow = new Date(istMs);
  const istHour = istNow.getUTCHours();      // 0-23 in IST
  const istMinute = istNow.getUTCMinutes();
  const today = istNow.toISOString().slice(0, 10);  // YYYY-MM-DD IST

  // Run 05:00–02:59 IST. Covers:
  //   NCH morning shift starts 06:00 (need 05:xx to warm up yesterday close)
  //   HE late-night check-outs up to 02:00+ (yesterday's shift still running)
  //   Idle window 03:00–04:59 when both brands are fully closed/quiet.
  if (istHour >= 3 && istHour < 5) {
    return { skipped: true, reason: `outside active window (IST ${istHour}:${String(istMinute).padStart(2,'0')})` };
  }

  const pagesUrl = (env.PAGES_URL || 'https://hnhotels.in').replace(/\/$/, '');
  const pin = env.ADMIN_PIN;

  if (!pin) return { error: 'ADMIN_PIN secret not set' };

  // Recompute yesterday + today shift-days. The server expands the punch
  // fetch window by ±1 day internally to catch cross-midnight punches, but
  // it only writes rows for shift-days inside [from, to]. Including
  // yesterday ensures HE's post-midnight check-outs finalise correctly.
  const yesterday = new Date(istMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let result;
  try {
    // pin goes in the request body (hr-admin.js reads body.pin, not a header)
    const res = await fetch(`${pagesUrl}/api/hr-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pull-attendance',
        pin,
        from: yesterday,
        to: today,
      }),
    });

    const text = await res.text();
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok) {
      console.error(`[attendance-cron] pull-attendance HTTP ${res.status}:`, text.slice(0, 500));
      return { error: `HTTP ${res.status}`, date: today, body: result };
    }

    console.log(`[attendance-cron] ${yesterday}..${today} — employees: ${result.employees}, punches: ${result.punches}, written: ${JSON.stringify(result.written)}`);
    return { success: true, from: yesterday, to: today, ...result };

  } catch (e) {
    console.error('[attendance-cron] fetch failed:', e.message);
    return { error: e.message, date: today };
  }
}
