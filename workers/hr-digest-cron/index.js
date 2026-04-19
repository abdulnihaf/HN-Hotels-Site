/**
 * hn-hr-digest-cron — brand-scoped WhatsApp digest cron
 *
 * Fires:
 *   04:15 UTC (09:45 IST) — "recap" of previous shift-day (both HE and NCH)
 *   07:30 UTC (13:00 IST) — "no_show" check for HE (shift opened at 09:00;
 *                            anyone still missing after 4h gets flagged)
 *
 * Delegates the actual rendering + send to hnhotels.in/api/hr-admin
 * (action=digest-send), which orchestrates:
 *   - buildDigest() on D1 attendance data (brand-scoped)
 *   - POST to hamzaexpress.in/api/hr-wa-send for HE + HQ
 *   - POST to nawabichaihouse.com/api/hr-wa-send for NCH
 *   - Sends to Nihaf (with financials) + Basheer (without)
 *
 * Manual trigger: GET /?key=<DASHBOARD_KEY>&mode=recap|no_show&brand=HE|NCH|ALL
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }
    const mode = url.searchParams.get('mode') || 'recap';
    const brand = url.searchParams.get('brand') || 'ALL';
    const result = await runDigest(env, mode, brand);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async scheduled(event, env, ctx) {
    // Cron schedule used to pick mode:
    //   04:15 UTC → recap of yesterday (both brands)
    //   07:30 UTC → no_show check for today (HE only; NCH has no fixed
    //                open-time spike and is 24h)
    const cronMin = new Date(event.scheduledTime).getUTCMinutes();
    const cronHour = new Date(event.scheduledTime).getUTCHours();
    const isRecap = cronHour === 4 && cronMin === 15;
    const isNoShow = cronHour === 7 && cronMin === 30;

    if (isRecap) {
      ctx.waitUntil(runDigest(env, 'recap', 'ALL'));
    } else if (isNoShow) {
      ctx.waitUntil(runDigest(env, 'no_show', 'HE'));
    }
  },
};

async function runDigest(env, mode, brand) {
  if (!env.ADMIN_PIN) return { error: 'ADMIN_PIN not set' };
  const pagesUrl = (env.PAGES_URL || 'https://hnhotels.in').replace(/\/$/, '');

  // For recap: use yesterday's IST shift-day. For no_show: today.
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  if (mode === 'recap') istDate.setUTCDate(istDate.getUTCDate() - 1);
  const dateStr = istDate.toISOString().slice(0, 10);

  try {
    const res = await fetch(`${pagesUrl}/api/hr-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'digest-send',
        pin: env.ADMIN_PIN,
        mode, brand, date: dateStr,
      }),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!res.ok) {
      console.error('[hr-digest-cron] HTTP', res.status, text.slice(0, 500));
      return { error: `HTTP ${res.status}`, date: dateStr, mode, brand, body: parsed };
    }
    console.log(`[hr-digest-cron] ${mode}/${brand}/${dateStr} — ${parsed.summary || 'sent'}`);
    return { success: true, date: dateStr, mode, brand, ...parsed };
  } catch (e) {
    console.error('[hr-digest-cron] fetch failed:', e.message);
    return { error: e.message, date: dateStr, mode, brand };
  }
}
