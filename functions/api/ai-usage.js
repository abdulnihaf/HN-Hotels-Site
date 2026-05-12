// functions/api/ai-usage.js
//
// Live AI key usage dashboard backend. Stores per-snapshot usage telemetry
// pushed from Mac (`hn-usage --push`) and serves it back to /ops/ai-usage/.
//
// Endpoints:
//   GET  /api/ai-usage              → { latest, last24h: [...] }   (public read, cached)
//   GET  /api/ai-usage?action=ping  → { ok: true, now }
//   POST /api/ai-usage              → insert snapshot (auth via AI_USAGE_TOKEN)
//
// Auth model:
//   POST: header `X-Usage-Token` or ?token=… must match env.AI_USAGE_TOKEN.
//   GET:  open. Aggregate dashboard, no PII.

const MAX_BODY_BYTES = 64 * 1024;   // 64KB upper bound for safety
const LAST_N_HOURS_DEFAULT = 24;

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    },
  });

const err = (msg, status = 400) => json({ error: msg }, status);

function nowSec() { return Math.floor(Date.now() / 1000); }

async function getLatest(env) {
  const row = await env.DB.prepare(
    `SELECT * FROM ai_usage_snapshots ORDER BY pushed_at DESC LIMIT 1`
  ).first();
  return row || null;
}

async function getLastN(env, hours) {
  const cutoff = nowSec() - hours * 3600;
  const rows = await env.DB.prepare(
    `SELECT snapshot_id, pushed_at, total_billable_tokens, claude_pct, backup_pct,
            claude_input_tokens, claude_cache_read_tokens, claude_output_tokens,
            claude_api_billable_tokens, claude_api_cost_usd_sonnet, claude_api_messages,
            claude_subscription_billable_tokens, claude_subscription_cost_usd_sonnet, claude_subscription_messages,
            gemini_calls, gemini_tokens, codex_calls, codex_tokens,
            kimi_calls, kimi_tokens, image_calls,
            claude_cost_usd_sonnet
       FROM ai_usage_snapshots
      WHERE pushed_at > ?
      ORDER BY pushed_at ASC`
  ).bind(cutoff).all();
  return rows.results || [];
}

async function actionGet(env, url) {
  const hours = Math.min(parseInt(url.searchParams.get('hours') || `${LAST_N_HOURS_DEFAULT}`, 10), 168);
  const [latest, last24h] = await Promise.all([
    getLatest(env),
    getLastN(env, hours),
  ]);
  return json({
    latest,
    last_n_hours: last24h,
    hours,
    server_now: nowSec(),
  });
}

async function actionPing(env) {
  // Count rows + return latest timestamp — useful for confidence
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(pushed_at) AS latest FROM ai_usage_snapshots`).first();
  return json({ ok: true, now: nowSec(), rows: c.n || 0, latest: c.latest || null });
}

async function actionPost(env, request, url) {
  const headerTok = request.headers.get('x-usage-token') || request.headers.get('X-Usage-Token');
  const qTok = url.searchParams.get('token');
  const tok = headerTok || qTok;
  if (!env.AI_USAGE_TOKEN) return err('AI_USAGE_TOKEN not configured on Worker', 500);
  if (!tok || tok !== env.AI_USAGE_TOKEN) return err('unauthorized', 401);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return err(`body too large (${text.length} > ${MAX_BODY_BYTES})`);

  let body;
  try { body = JSON.parse(text); } catch (e) { return err('invalid json: ' + e.message); }

  const now = nowSec();
  const v = (k, dflt = 0) => {
    const n = body[k];
    if (typeof n === 'number' && isFinite(n)) return Math.round(n);
    return dflt;
  };
  const f = (k, dflt = 0) => {
    const n = body[k];
    if (typeof n === 'number' && isFinite(n)) return n;
    return dflt;
  };

  await env.DB.prepare(
    `INSERT INTO ai_usage_snapshots (
       pushed_at, client_ts, source_host, since_ts,
       claude_input_tokens, claude_cache_write_tokens, claude_cache_read_tokens, claude_output_tokens,
       claude_messages, claude_sessions, claude_cost_usd_sonnet,
       claude_api_billable_tokens, claude_api_input_tokens, claude_api_cache_read_tokens,
       claude_api_output_tokens, claude_api_messages, claude_api_cost_usd_sonnet,
       claude_subscription_billable_tokens, claude_subscription_input_tokens, claude_subscription_cache_read_tokens,
       claude_subscription_output_tokens, claude_subscription_messages, claude_subscription_cost_usd_sonnet,
       gemini_calls, gemini_tokens, codex_calls, codex_tokens, kimi_calls, kimi_tokens, image_calls,
       total_billable_tokens, claude_pct, backup_pct, data_json
     ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?, ?)`
  ).bind(
    now,
    v('client_ts'),
    String(body.source_host || '').slice(0, 64),
    v('since_ts'),
    v('claude_input_tokens'),
    v('claude_cache_write_tokens'),
    v('claude_cache_read_tokens'),
    v('claude_output_tokens'),
    v('claude_messages'),
    v('claude_sessions'),
    f('claude_cost_usd_sonnet'),
    v('claude_api_billable_tokens'),
    v('claude_api_input_tokens'),
    v('claude_api_cache_read_tokens'),
    v('claude_api_output_tokens'),
    v('claude_api_messages'),
    f('claude_api_cost_usd_sonnet'),
    v('claude_subscription_billable_tokens'),
    v('claude_subscription_input_tokens'),
    v('claude_subscription_cache_read_tokens'),
    v('claude_subscription_output_tokens'),
    v('claude_subscription_messages'),
    f('claude_subscription_cost_usd_sonnet'),
    v('gemini_calls'),
    v('gemini_tokens'),
    v('codex_calls'),
    v('codex_tokens'),
    v('kimi_calls'),
    v('kimi_tokens'),
    v('image_calls'),
    v('total_billable_tokens'),
    f('claude_pct'),
    f('backup_pct'),
    text.slice(0, MAX_BODY_BYTES),
  ).run();

  return json({ ok: true, pushed_at: now });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (request.method === 'POST') {
      return await actionPost(env, request, url);
    }
    const action = url.searchParams.get('action');
    if (action === 'ping') return await actionPing(env);
    return await actionGet(env, url);
  } catch (e) {
    return json({ error: 'internal', message: String(e), stack: e.stack }, 500);
  }
}
