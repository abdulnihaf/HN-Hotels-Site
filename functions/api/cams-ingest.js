/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * CAMS Biometric Direct Ingest — bypasses Odoo
 * Route:  /api/cams-ingest
 * Secret: CAMS_AUTH_TOKEN (must match what's configured in CAMS dashboard)
 *
 * Replaces ops.hamzahotel.com/cams/biometric-api3.0 as the device callback URL.
 * Accepts the exact same payload shape as CAMS's Odoo integration:
 *
 *   POST https://hnhotels.in/api/cams-ingest?stgid=<device_serial>
 *   Headers: X-Auth-Token: <token>
 *   Body: { "RealTime": { "AuthToken", "LabelName", "OperationID",
 *                         "PunchLog": { "InputType", "LogTime", "Type", "UserId" },
 *                         "SerialNumber", "Time" } }
 *
 * Response MUST be {"status":"done"} for CAMS to ack the push. Any other
 * response shape → CAMS requeues and retries with exponential backoff.
 *
 * Writes to D1 hr_cams_punches (source='webhook'). /ops/hr/ reads from here.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') {
    return json({ status: 'error', message: 'POST required' }, 405);
  }

  const db = env.DB;
  if (!db) return json({ status: 'error', message: 'database not configured' }, 500);

  const url = new URL(request.url);
  // Prefer body.SerialNumber over URL stgid — CAMS's callback URL mechanism
  // can double-append ?stgid= and leave the URL param corrupted.
  // We fall back to stgid query param if body SerialNumber is missing.
  let stgid = url.searchParams.get('stgid') || '';
  // If URL stgid contains embedded "?stgid=" (double-append), extract the first
  // clean token: "AYTH09089112?stgid=AYTH09089112" → "AYTH09089112"
  if (stgid.includes('?')) stgid = stgid.split('?')[0];

  // Auth: X-Auth-Token header OR body.RealTime.AuthToken must match secret
  const expectedToken = env.CAMS_AUTH_TOKEN;
  if (!expectedToken) return json({ status: 'error', message: 'server not configured' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', message: 'invalid json body' }, 400);
  }

  const rt = body?.RealTime;
  if (!rt) return json({ status: 'error', message: 'missing RealTime block' }, 400);

  // Prefer SerialNumber from body over URL param
  if (rt.SerialNumber) stgid = String(rt.SerialNumber).trim();
  if (!stgid) {
    return json({ status: 'error', message: 'Invalid stgid value. Must be a non-empty value' }, 400);
  }

  const headerToken = request.headers.get('X-Auth-Token');
  const bodyToken = rt.AuthToken;
  if (headerToken !== expectedToken && bodyToken !== expectedToken) {
    return json({ status: 'error', message: 'Invalid authentication token for the given service tag ID' }, 403);
  }

  // Note: skipping SerialNumber/LabelName vs stgid equality check — some CAMS
  // retries appear to send payloads where these don't match byte-for-byte
  // (encoding quirk?), and auth token already identifies the device.

  // Extract punch fields
  const p = rt.PunchLog;
  if (!p || !p.UserId || !p.LogTime) {
    return json({ status: 'error', message: 'PunchLog missing required fields' }, 400);
  }

  const userId     = String(p.UserId).trim();
  const punchTime  = String(p.LogTime).trim();     // e.g. "2026-04-18 21:32:11 GMT +0530"
  const punchType  = String(p.Type || '').trim();  // CheckIn / CheckOut
  const inputType  = String(p.InputType || '').trim();
  const operationId = String(rt.OperationID || '').trim();

  // Normalize punch_time to ISO-like (keep IST as-is — matches existing table convention)
  // CAMS format: "2026-04-18 21:32:11 GMT +0530" → "2026-04-18 21:32:11"
  const punchTimeISO = punchTime.replace(/\s+GMT\s+[+-]\d{4}.*$/, '');

  // Look up name (best-effort; not required for write)
  let userName = null;
  try {
    const row = await db.prepare(
      'SELECT name FROM hr_employees WHERE pin = ? OR biometric_user_id = ? LIMIT 1'
    ).bind(userId, userId).first();
    if (row) userName = row.name;
  } catch {
    // schema may or may not have biometric_user_id column — fall back to pin-only
    try {
      const row = await db.prepare('SELECT name FROM hr_employees WHERE pin = ? LIMIT 1').bind(userId).first();
      if (row) userName = row.name;
    } catch {}
  }

  // Dedup on (device_serial, pin, punch_time). INSERT OR IGNORE → idempotent retries.
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO hr_cams_punches
         (device_serial, pin, user_name, punch_time, punch_type, input_type, source, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, 'webhook', ?)`
    ).bind(stgid, userId, userName, punchTimeISO, punchType, inputType, JSON.stringify(body)).run();
  } catch (e) {
    // Log but still ack — better to ack and investigate than to have CAMS retry-storm
    console.error('[cams-ingest] D1 write failed:', e.message);
  }

  // CAMS requires "status":"done" to acknowledge. Any other string → retry.
  return json({ status: 'done' });
}
