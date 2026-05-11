// functions/api/marketing-bridge.js
//
// Mobile dispatch bridge for the Marketing Shell.
// Architecture: see fleet/marketing-shell/ARCHITECTURE.md §5 (Dispatch flow)
//
// ALL endpoints are GET-only (iPhone Claude Code WebFetch tool is GET-focused).
// Auth: ?token=<MARKETING_BRIDGE_TOKEN> shared secret set via wrangler pages secret.
//
// Endpoints (all under /api/marketing-bridge):
//
//   ?action=dispatch&lane=<id>&directive=<urlencoded>&source=<iphone|ipad|mac|curl>
//     → { job_id, status: "queued", queued_at }
//     Used by: iPhone, iPad, Mac (sends a directive to a specific lane)
//
//   ?action=result&job_id=<id>
//     → { job_id, status, lane, directive, result, error, created_at, completed_at }
//     Used by: iPhone (polls until status === "completed" | "failed" | "timeout")
//
//   ?action=pending&max=<n>
//     → [ { job_id, lane, directive, created_at }, ... ]
//     Used by: winpc poller. Atomically marks rows status='processing' as it returns them.
//
//   ?action=complete&job_id=<id>&result=<urlencoded>
//     → { ok: true }
//     Used by: winpc poller after the lane has produced output.
//
//   ?action=fail&job_id=<id>&error=<urlencoded>
//     → { ok: true }
//     Used by: winpc poller if dispatch failed (timeout, lane down, claude error).
//
//   ?action=status
//     → { queued: n, processing: n, completed_today: n, failed_today: n, recent: [...] }
//     Used by: any client wanting a health snapshot.
//
// Status values: queued | processing | completed | failed | timeout

const VALID_LANES = new Set([
  '01-influencer', '02-google', '03-aggregator', '04-dine', '05-tv', '06-meta',
  'marketing-orchestrator'
]);

const VALID_SOURCES = new Set(['iphone', 'ipad', 'mac', 'curl', 'unknown']);

const MAX_DIRECTIVE_LEN = 8000;
const MAX_RESULT_LEN = 50000;
const DEFAULT_PENDING_MAX = 5;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const err = (msg, status = 400) => json({ error: msg }, status);

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function randJobId() {
  // 12-char base36 — unique enough for our queue volume
  return 'mb-' + nowSec().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function authenticate(env, url) {
  const token = url.searchParams.get('token');
  if (!env.MARKETING_BRIDGE_TOKEN) {
    return { ok: false, error: 'bridge_not_configured_no_token_in_env' };
  }
  if (!token || token !== env.MARKETING_BRIDGE_TOKEN) {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true };
}

// ─── action: dispatch ───────────────────────────────────────────────────────
async function actionDispatch(env, url) {
  const lane = url.searchParams.get('lane');
  const directive = url.searchParams.get('directive');
  const source = (url.searchParams.get('source') || 'unknown').toLowerCase();

  if (!lane || !VALID_LANES.has(lane)) {
    return err(`invalid lane. valid: ${[...VALID_LANES].join(',')}`);
  }
  if (!directive || directive.length === 0) {
    return err('directive required');
  }
  if (directive.length > MAX_DIRECTIVE_LEN) {
    return err(`directive too long (${directive.length} > ${MAX_DIRECTIVE_LEN})`);
  }
  if (!VALID_SOURCES.has(source)) {
    return err(`invalid source. valid: ${[...VALID_SOURCES].join(',')}`);
  }

  const job_id = randJobId();
  const now = nowSec();

  await env.DB.prepare(
    `INSERT INTO marketing_dispatch_queue (job_id, lane, directive, status, source, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`
  ).bind(job_id, lane, directive, source, now, now).run();

  return json({ job_id, status: 'queued', lane, queued_at: now });
}

// ─── action: result ─────────────────────────────────────────────────────────
async function actionResult(env, url) {
  const job_id = url.searchParams.get('job_id');
  if (!job_id) return err('job_id required');

  const row = await env.DB.prepare(
    `SELECT job_id, lane, directive, status, source, result, error, created_at, picked_at, completed_at
       FROM marketing_dispatch_queue WHERE job_id = ?`
  ).bind(job_id).first();

  if (!row) return json({ error: 'not_found', job_id }, 404);
  return json(row);
}

// ─── action: pending (used by winpc poller) ─────────────────────────────────
async function actionPending(env, url) {
  const max = Math.min(parseInt(url.searchParams.get('max') || `${DEFAULT_PENDING_MAX}`, 10), 20);

  const rows = await env.DB.prepare(
    `SELECT job_id, lane, directive, source, created_at
       FROM marketing_dispatch_queue
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?`
  ).bind(max).all();

  const jobs = (rows.results || []);
  if (jobs.length === 0) return json([]);

  // Atomically mark these as processing
  const now = nowSec();
  const placeholders = jobs.map(() => '?').join(',');
  const ids = jobs.map(j => j.job_id);
  await env.DB.prepare(
    `UPDATE marketing_dispatch_queue
        SET status = 'processing', picked_at = ?, updated_at = ?
      WHERE job_id IN (${placeholders}) AND status = 'queued'`
  ).bind(now, now, ...ids).run();

  return json(jobs);
}

// ─── action: complete ───────────────────────────────────────────────────────
async function actionComplete(env, url) {
  const job_id = url.searchParams.get('job_id');
  const result = url.searchParams.get('result') || '';
  if (!job_id) return err('job_id required');
  if (result.length > MAX_RESULT_LEN) {
    return err(`result too long (${result.length} > ${MAX_RESULT_LEN})`);
  }

  const now = nowSec();
  const r = await env.DB.prepare(
    `UPDATE marketing_dispatch_queue
        SET status = 'completed', result = ?, completed_at = ?, updated_at = ?
      WHERE job_id = ? AND status IN ('processing', 'queued')`
  ).bind(result, now, now, job_id).run();

  if (r.meta && r.meta.changes === 0) {
    return json({ ok: false, error: 'job_not_found_or_already_finalized' }, 404);
  }
  return json({ ok: true, job_id, completed_at: now });
}

// ─── action: fail ───────────────────────────────────────────────────────────
async function actionFail(env, url) {
  const job_id = url.searchParams.get('job_id');
  const error_msg = url.searchParams.get('error') || 'unknown_error';
  if (!job_id) return err('job_id required');

  const now = nowSec();
  await env.DB.prepare(
    `UPDATE marketing_dispatch_queue
        SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
      WHERE job_id = ? AND status IN ('processing', 'queued')`
  ).bind(error_msg, now, now, job_id).run();

  return json({ ok: true, job_id, error: error_msg, completed_at: now });
}

// ─── action: status (health snapshot) ───────────────────────────────────────
async function actionStatus(env) {
  const dayStart = nowSec() - 86400;

  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n
       FROM marketing_dispatch_queue
      WHERE created_at > ?
      GROUP BY status`
  ).bind(dayStart).all();

  const recent = await env.DB.prepare(
    `SELECT job_id, lane, status, source, created_at, completed_at
       FROM marketing_dispatch_queue
      ORDER BY created_at DESC LIMIT 20`
  ).all();

  const buckets = { queued: 0, processing: 0, completed: 0, failed: 0, timeout: 0 };
  for (const r of (counts.results || [])) buckets[r.status] = r.n;

  return json({
    counts_last_24h: buckets,
    recent: recent.results || [],
    now: nowSec(),
  });
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const auth = await authenticate(env, url);
  if (!auth.ok) return err(auth.error, 401);

  const action = url.searchParams.get('action');
  if (!action) return err('action required');

  try {
    switch (action) {
      case 'dispatch':  return await actionDispatch(env, url);
      case 'result':    return await actionResult(env, url);
      case 'pending':   return await actionPending(env, url);
      case 'complete':  return await actionComplete(env, url);
      case 'fail':      return await actionFail(env, url);
      case 'status':    return await actionStatus(env);
      default:          return err(`unknown action: ${action}`);
    }
  } catch (e) {
    return json({ error: 'internal', message: String(e), stack: e.stack }, 500);
  }
}
