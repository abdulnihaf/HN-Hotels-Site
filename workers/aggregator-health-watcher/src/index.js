// hn-aggregator-health-watcher — Cloudflare Worker, clock-only.
// Cron */5 fires a POST to the Pages Function which runs the actual probes
// and triggers comms-core alerts. All logic lives on the Pages side because
// Workers can't import from functions/api/_lib/. Same pattern as hn-hr-cron.

const PAGES_BASE = 'https://hnhotels.in';

export default {
  async scheduled(event, env, ctx) {
    const url = `${PAGES_BASE}/api/aggregator-health-watcher?action=tick&token=${encodeURIComponent(env.CRON_TOKEN || '')}`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'x-cron-token': env.CRON_TOKEN || '' } });
      const body = await res.text();
      console.log(`[health-watcher] ${res.status} ${body.slice(0, 240)}`);
    } catch (err) {
      console.error('[health-watcher] fetch failed:', err.message);
    }
  },
};
