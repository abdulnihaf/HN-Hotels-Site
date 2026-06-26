/**
 * naam-post-cron — polls /api/naam-post for approved organic posts and fires them.
 *
 * Scheduled: every 15 minutes. The Pages function does the real work; this worker
 * is just a secure ping so the cron lives in a Worker while state stays in Pages/D1.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const token = env.NAAM_POST_CRON_TOKEN;
    if (!token || key !== token) {
      return new Response('unauthorized', { status: 401 });
    }
    return run(env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};

async function run(env) {
  const pagesUrl = (env.PAGES_URL || 'https://hnhotels.in').replace(/\/$/, '');
  const token = env.NAAM_POST_CRON_TOKEN;
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'NAAM_POST_CRON_TOKEN not set' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  try {
    const r = await fetch(`${pagesUrl}/api/naam-post?action=cron&token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log('naam-post-cron:', JSON.stringify(data).slice(0, 500));
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, data }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('naam-post-cron failed:', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
}
