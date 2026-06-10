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

  // ── Non-punch events (Push User Data: UserUpdated / UserDeleted, etc.) ──
  // CAMS sends these when a user is enrolled/edited on the device (and re-sends
  // the user list after a device reconnect). We MUST ack {"status":"done"} on
  // every event we don't model — any non-done response puts the CAMS queue ON
  // HOLD and head-of-line-blocks all punches behind it (observed live
  // 2026-06-10: a UserUpdated for pin 44 got 400 → whole queue stalled).
  // UserUpdated carries name + pin + face photo straight from the device —
  // stored in hr_cams_user_events as the device-first onboarding signal.
  if (!rt.PunchLog) {
    const uu = rt.UserUpdated || rt.UserDeleted;
    const evType = rt.UserUpdated ? 'UserUpdated' : (rt.UserDeleted ? 'UserDeleted' : 'Unknown');
    const pin = uu ? String(uu.UserID || uu.UserId || '').trim() : '';
    if (uu && pin) {
      const userName = [uu.FirstName, uu.LastName].filter(Boolean).join(' ').trim() || null;
      const opTime = String(uu.OperationTime || '').replace(/\s+GMT\s+[+-]\d{4}.*$/, '') || null;
      const photo = uu.Photo && uu.Photo.Type === 'Base64' ? (uu.Photo.Data || null) : null;
      const insertEvent = () => db.prepare(
        `INSERT OR IGNORE INTO hr_cams_user_events
           (device_serial, event_type, pin, user_name, user_type, operation_time, photo_base64)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(stgid, evType, pin, userName, String(uu.UserType || '').trim() || null, opTime, photo).run();
      try {
        await insertEvent();
      } catch (e) {
        // First event ever: create the table, then retry once.
        try {
          await db.prepare(
            `CREATE TABLE IF NOT EXISTS hr_cams_user_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               device_serial TEXT NOT NULL,
               event_type TEXT NOT NULL,
               pin TEXT NOT NULL,
               user_name TEXT,
               user_type TEXT,
               operation_time TEXT,
               photo_base64 TEXT,
               received_at TEXT DEFAULT (datetime('now')),
               UNIQUE(device_serial, event_type, pin, operation_time)
             )`
          ).run();
          await insertEvent();
        } catch (e2) {
          console.error('[cams-ingest] user-event write failed:', e2.message);
        }
      }
    }
    // Ack unconditionally — never hold the queue over an event we don't model.
    return json({ status: 'done' });
  }

  // Extract punch fields. A malformed PunchLog is logged and ACKED — a retry
  // can never repair it, and a non-done response stalls every event behind it.
  const p = rt.PunchLog;
  if (!p.UserId || !p.LogTime) {
    console.error('[cams-ingest] PunchLog missing required fields:', JSON.stringify(p).slice(0, 200));
    return json({ status: 'done' });
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
  let wrote = false;
  try {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO hr_cams_punches
         (device_serial, pin, user_name, punch_time, punch_type, input_type, source, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, 'webhook', ?)`
    ).bind(stgid, userId, userName, punchTimeISO, punchType, inputType, JSON.stringify(body)).run();
    wrote = (result?.meta?.changes || 0) > 0;
  } catch (e) {
    // Log but still ack — better to ack and investigate than to have CAMS retry-storm
    console.error('[cams-ingest] D1 write failed:', e.message);
  }

  // Auto-trigger attendance rollup — only when a brand-new row landed
  // (dedup'd retries are idempotent, no need to re-compute). Fire-and-forget
  // via context.waitUntil so the CAMS ack is instant.
  //
  // Authorised via service_key = CAMS_AUTH_TOKEN (same secret CAMS sent with
  // this punch). hr-admin.js recognises this and skips the PIN gate.
  //
  // Range: punch_time's calendar date ±1 day so shift-day bucketing covers
  // post-midnight and pre-morning edge cases regardless of brand.
  if (wrote && context.waitUntil) {
    const calDate = punchTimeISO.slice(0, 10);
    const prevDay = new Date(calDate + 'T12:00:00Z');
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    const from = prevDay.toISOString().slice(0, 10);
    const to   = calDate;
    context.waitUntil((async () => {
      try {
        await fetch(`${new URL(request.url).origin}/api/hr-admin`, {
          method: 'POST',
          // x-service-key satisfies hr-admin's front token gate — body
          // service_key alone got 401'd there after the security hardening,
          // which silently killed the auto-rollup 2026-05-31 → 06-10.
          headers: { 'Content-Type': 'application/json', 'x-service-key': expectedToken },
          body: JSON.stringify({
            action: 'pull-attendance',
            service_key: expectedToken,   // CAMS_AUTH_TOKEN (inner PIN bypass)
            from, to,
          }),
        });
      } catch (e) {
        console.error('[cams-ingest] auto pull-attendance failed:', e.message);
      }
    })());
  }

  // CAMS requires "status":"done" to acknowledge. Any other string → retry.
  return json({ status: 'done' });
}
