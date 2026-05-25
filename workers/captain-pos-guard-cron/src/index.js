// hn-captain-pos-guard-cron — Cloudflare Worker, clock-only.
// Cron */3 fires reconcile + heartbeat on the Pages Function, which holds all
// logic (Workers can't import functions/api/_lib/). Same pattern as health-watcher.

const PAGES_BASE = 'https://hnhotels.in';

async function hit(env, action) {
  const token = env.CRON_TOKEN || '';
  const url = `${PAGES_BASE}/api/captain-pos-guard?action=${action}&token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'x-cron-token': token } });
    const body = await res.text();
    console.log(`[cpg ${action}] ${res.status} ${body.slice(0, 240)}`);
  } catch (err) {
    console.error(`[cpg ${action}] fetch failed:`, err.message);
  }
}

export default {
  async scheduled(event, env, ctx) {
    await hit(env, 'reconcile');
    await hit(env, 'heartbeat');
  },
};
