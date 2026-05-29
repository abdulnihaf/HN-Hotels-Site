// /api/hr-automation — Cron-triggered detection + Basheer response handlers
// Companion to /api/hr-admin.js (kept separate for clarity).
//
// Endpoints:
//   POST ?action=cron-detect-absences     — cron job, scans for 2+ day absences
//   POST ?action=cron-detect-ghosts       — cron job, finds CAMS PINs not in roster
//   POST ?action=cron-daily-summary       — cron job, sends owner daily roster summary
//   GET  ?action=hr-absence-respond       — webhook from WABA button click
//   GET  ?action=hr-ghost-onboard-start   — Basheer's mini-UI loads ghost PIN context
//   POST ?action=hr-ghost-onboard-submit  — Basheer's mini-UI submits new employee data
//
// Auth:
//   Cron actions require x-cron-token header matching env.CRON_TOKEN
//   Webhook actions are public (token in URL itself is the auth — single-use UUID)

'use strict';

import { sendAndLog, sendWithFallback } from './_lib/comms-core.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function generateToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

function todayIST() {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  return d.toISOString().slice(0, 10);
}

function daysAgoIST(n) {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 5);
  d.setUTCMinutes(d.getUTCMinutes() + 30);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const method = request.method;

  // Cron actions require auth
  if (action && action.startsWith('cron-')) {
    if (request.headers.get('x-cron-token') !== env.CRON_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  if (action === 'cron-detect-absences' && method === 'POST') {
    return await detectAbsences(env);
  }

  if (action === 'cron-detect-ghosts' && method === 'POST') {
    return await detectGhosts(env);
  }

  if (action === 'cron-daily-summary' && method === 'POST') {
    return await dailySummary(env);
  }

  if (action === 'hr-absence-respond' && method === 'GET') {
    return await respondToAbsence(env, url.searchParams);
  }

  if (action === 'hr-ghost-onboard-start' && method === 'GET') {
    return await ghostOnboardStart(env, url.searchParams);
  }

  if (action === 'hr-ghost-onboard-submit' && method === 'POST') {
    // Two formats: multipart (Aadhaar file attached) or JSON
    const ctype = request.headers.get('content-type') || '';
    let body, aadhaarFile = null;
    if (ctype.includes('multipart/form-data')) {
      const form = await request.formData();
      const payload = form.get('payload');
      try { body = JSON.parse(payload); } catch { return json({ error: 'invalid payload JSON' }, 400); }
      aadhaarFile = form.get('aadhaar_file');
    } else {
      body = await request.json();
    }
    return await ghostOnboardSubmit(env, body, aadhaarFile);
  }

  return json({ error: 'Unknown action', valid: [
    'cron-detect-absences', 'cron-detect-ghosts', 'cron-daily-summary',
    'hr-absence-respond', 'hr-ghost-onboard-start', 'hr-ghost-onboard-submit'
  ]}, 400);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Absence Detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function detectAbsences(env) {
  const db = env.DB;
  const today = todayIST();
  const twoDaysAgo = daysAgoIST(2);
  const sevenDaysAgo = daysAgoIST(7);

  // Find employees with track_attendance=1 + active + no punches in last 2 days
  const sql = `
    SELECT e.id, e.pin, e.name, e.known_as, e.brand_label, e.job_name, e.pay_type,
           MAX(a.date) AS last_punch_date,
           (julianday(?) - julianday(MAX(a.date))) AS days_since_last_punch
    FROM hr_employees e
    LEFT JOIN hr_attendance_daily a
      ON a.employee_id = e.id
      AND a.date >= ?
      AND COALESCE(a.total_hours, 0) > 1
    WHERE e.is_active = 1
      AND COALESCE(e.track_attendance, 1) = 1
      AND e.brand_label != 'HQ'
    GROUP BY e.id
    HAVING last_punch_date IS NULL OR days_since_last_punch >= 2
  `;
  const candidates = (await db.prepare(sql).bind(today, sevenDaysAgo).all()).results || [];

  // Skip employees who already have an active alert for this absence event
  const newAlerts = [];
  for (const c of candidates) {
    const existing = await db.prepare(`
      SELECT id FROM hr_absence_alerts
       WHERE employee_id = ? AND status != 'resolved'
       LIMIT 1
    `).bind(c.id).first();

    if (existing) continue;

    // Skip employees with approved leave covering today
    const onLeave = await db.prepare(`
      SELECT id FROM hr_leaves
       WHERE employee_id = ? AND status='approved'
         AND ? BETWEEN from_date AND to_date
       LIMIT 1
    `).bind(c.id, today).first().catch(() => null);

    if (onLeave) continue;

    const token = generateToken();
    const daysAbsent = Math.floor(c.days_since_last_punch || 99);

    await db.prepare(`
      INSERT INTO hr_absence_alerts
        (employee_id, pin, days_absent, last_working_date, status, alert_token)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(c.id, c.pin, daysAbsent, c.last_punch_date, token).run();

    newAlerts.push({ ...c, alert_token: token, days_absent: daysAbsent });
  }

  // Send WABA messages — group by brand to route to correct manager
  const sentResults = [];
  for (const alert of newAlerts) {
    const manager = await db.prepare(
      `SELECT * FROM hr_managers WHERE brand_label=? AND is_active=1 LIMIT 1`
    ).bind(alert.brand_label).first();

    if (!manager) {
      sentResults.push({ employee_id: alert.id, sent: false, reason: 'no manager configured' });
      continue;
    }

    try {
      const result = await sendAbsenceWaba(env, manager, alert);
      await db.prepare(`
        UPDATE hr_absence_alerts SET status='sent_to_basheer', waba_msg_id=?
         WHERE alert_token=?
      `).bind(result.msg_id || null, alert.alert_token).run();

      sentResults.push({ employee_id: alert.id, sent: true, manager: manager.name });
    } catch (e) {
      sentResults.push({ employee_id: alert.id, sent: false, error: e.message });
    }
  }

  return json({
    detected: candidates.length,
    new_alerts: newAlerts.length,
    sent: sentResults,
  });
}

async function sendAbsenceWaba(env, manager, alert) {
  // Uses the approved Sparksol template `ops_alert_v1` (4 vars):
  //   "Heads up — {{1}} at {{2}}: {{3}}. Tap to resolve: {{4}}. Reply DONE when fixed."
  // Manager taps the URL and lands on the absence-respond mini-page where they
  // pick On Leave / Sick / Left / Bio Issue.
  const empName = alert.known_as || alert.name;
  const role = alert.job_name || '—';
  const respondUrl = `https://hnhotels.in/hr/respond/?t=${alert.alert_token}&type=absence`;

  const result = await sendWithFallback(env, {
    brand: 'sparksol',
    tier: 'warn',
    alert_id: `hr_absence:${alert.alert_token}`,
    phone: manager.phone,
    template: 'ops_alert_v1',
    language: 'en',
    vars: [
      `${empName} absent ${alert.days_absent}d`,                              // {{1}}
      `${alert.brand_label || ''} (PIN ${alert.pin || '—'}) ${role}`.trim(),  // {{2}}
      `Last punch ${alert.last_working_date || 'unknown'}. Confirm reason`,   // {{3}}
      respondUrl,                                                             // {{4}}
    ],
    chain: ['waba', 'sms'],
    gap_minutes: { waba: 30, sms: 60 },
  });
  if (!result.ok) {
    const errStr = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
    throw new Error(`WABA error: ${errStr}`);
  }
  return { msg_id: result.provider_msg_id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Ghost PIN Detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function detectGhosts(env) {
  const db = env.DB;
  const today = todayIST();
  const sevenDaysAgo = daysAgoIST(7);

  // Find PINs in CAMS punches not matching active employee
  const ghostsSQL = `
    SELECT p.pin,
           COUNT(*) AS total_punches,
           COUNT(DISTINCT date(p.punch_time)) AS total_days,
           MAX(p.punch_time) AS last_seen_at
    FROM hr_cams_punches p
    LEFT JOIN hr_employees e ON e.pin = p.pin AND e.is_active = 1
    WHERE p.punch_time >= ?
      AND e.id IS NULL
    GROUP BY p.pin
  `;
  const ghosts = (await db.prepare(ghostsSQL).bind(sevenDaysAgo + ' 00:00:00').all()).results || [];

  const newAlerts = [];
  for (const g of ghosts) {
    // Upsert ghost PIN row
    const existing = await db.prepare(
      `SELECT id, status, total_punches FROM hr_ghost_pins
        WHERE pin = ? AND status NOT IN ('onboarded', 'dismissed') LIMIT 1`
    ).bind(g.pin).first();

    if (!existing) {
      const token = generateToken();
      await db.prepare(`
        INSERT INTO hr_ghost_pins
          (pin, last_seen_at, total_punches, total_days, status, onboarding_token)
        VALUES (?, ?, ?, ?, 'detected', ?)
      `).bind(g.pin, g.last_seen_at, g.total_punches, g.total_days, token).run();

      // If 3+ punches, alert immediately. Else wait for next cron.
      if (g.total_punches >= 3) {
        newAlerts.push({ ...g, onboarding_token: token, isNew: true });
      }
    } else {
      // Update counters
      await db.prepare(`
        UPDATE hr_ghost_pins
           SET last_seen_at=?, total_punches=?, total_days=?
         WHERE id=?
      `).bind(g.last_seen_at, g.total_punches, g.total_days, existing.id).run();

      if (existing.status === 'detected' && g.total_punches >= 3) {
        // Cross threshold — alert now
        const row = await db.prepare(`SELECT * FROM hr_ghost_pins WHERE id=?`).bind(existing.id).first();
        newAlerts.push({ ...g, onboarding_token: row.onboarding_token, isNew: false });
      }
    }
  }

  // Send WABA alerts
  const sentResults = [];
  for (const a of newAlerts) {
    // Send to NCH manager (Basheer) by default; owner can route differently
    const manager = await db.prepare(
      `SELECT * FROM hr_managers WHERE brand_label='NCH' AND is_active=1 LIMIT 1`
    ).first();

    if (!manager) {
      sentResults.push({ pin: a.pin, sent: false, reason: 'no manager' });
      continue;
    }

    try {
      await sendGhostPinWaba(env, manager, a);
      await db.prepare(`UPDATE hr_ghost_pins SET status='sent_to_basheer' WHERE pin=?`)
        .bind(a.pin).run();
      sentResults.push({ pin: a.pin, sent: true });
    } catch (e) {
      sentResults.push({ pin: a.pin, sent: false, error: e.message });
    }
  }

  return json({ ghosts_detected: ghosts.length, alerts_sent: newAlerts.length, results: sentResults });
}

async function sendGhostPinWaba(env, manager, ghost) {
  // Uses the approved Sparksol template `ops_alert_v1` (4 vars):
  //   "Heads up — {{1}} at {{2}}: {{3}}. Tap to resolve: {{4}}. Reply DONE when fixed."
  // Var 4 is a URL — WhatsApp auto-links it. Manager taps → opens /hr/respond/ghost mini-UI.
  const onboardingUrl = `https://hnhotels.in/hr/respond/?t=${ghost.onboarding_token}&type=ghost`;
  const result = await sendWithFallback(env, {
    brand: 'sparksol',
    tier: 'warn',
    alert_id: `hr_ghost:${ghost.pin}`,
    phone: manager.phone,
    template: 'ops_alert_v1',
    language: 'en',
    vars: [
      `Ghost CAMS PIN ${ghost.pin}`,                                          // {{1}} — what
      ghost.total_days >= 5 ? 'CAMS' : 'CAMS (recent)',                       // {{2}} — where/when
      `${ghost.total_punches} punches across ${ghost.total_days} day(s) — not in /ops/hr roster`, // {{3}} — details
      onboardingUrl,                                                          // {{4}} — actionable URL
    ],
    chain: ['waba', 'sms'],
    gap_minutes: { waba: 30, sms: 60 },
  });
  if (!result.ok) {
    const errStr = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
    throw new Error(`WABA error: ${errStr}`);
  }
  return { msg_id: result.provider_msg_id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Daily Summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function dailySummary(env) {
  const db = env.DB;
  const today = todayIST();

  const stats = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM hr_employees WHERE is_active=1) AS active,
      (SELECT COUNT(*) FROM hr_employees WHERE is_active=1 AND track_attendance=1 AND brand_label != 'HQ') AS expected_punching,
      (SELECT COUNT(DISTINCT a.employee_id) FROM hr_attendance_daily a JOIN hr_employees e ON e.id=a.employee_id
        WHERE a.date=? AND a.total_hours > 1 AND e.is_active=1) AS punched_today,
      (SELECT COUNT(*) FROM hr_absence_alerts WHERE status IN ('pending','sent_to_basheer','responded')) AS pending_alerts,
      (SELECT COUNT(*) FROM hr_ghost_pins WHERE status='sent_to_basheer') AS pending_ghosts
  `).bind(today).first();

  return json({ stats, today, sent: false /* TODO: send WABA daily summary */ });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Webhook: Basheer responds to absence alert
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function respondToAbsence(env, params) {
  const token = params.get('token') || params.get('t');
  const respStatus = params.get('status');

  if (!token || !respStatus) return json({ error: 'token + status required' }, 400);

  const db = env.DB;
  const alert = await db.prepare(`SELECT * FROM hr_absence_alerts WHERE alert_token=?`).bind(token).first();
  if (!alert) return json({ error: 'invalid token' }, 404);
  if (alert.status === 'resolved') return json({ ok: true, already_resolved: true });

  const validStatuses = ['on_leave', 'sick', 'left', 'bio_issue', 'other'];
  if (!validStatuses.includes(respStatus)) return json({ error: 'invalid status' }, 400);

  const now = new Date().toISOString();
  let resolutionAction;

  if (respStatus === 'left') {
    // Archive employee
    await db.prepare(`
      UPDATE hr_employees SET is_active=0, archived_at=?, archive_reason='Departed (Basheer confirmed)'
       WHERE id=?
    `).bind(now, alert.employee_id).run();
    resolutionAction = 'archived';

    // TODO: trigger F&F workflow
  } else if (respStatus === 'on_leave' || respStatus === 'sick') {
    // Record leave (existing hr_leaves table)
    const reason = respStatus === 'sick' ? 'Sick leave' : 'Approved leave';
    await db.prepare(`
      INSERT INTO hr_leaves (employee_id, from_date, to_date, reason, status, source)
      VALUES (?, ?, date('now', '+7 days'), ?, 'approved', 'basheer_waba_response')
    `).bind(alert.employee_id, alert.last_working_date || todayIST(), reason).run().catch(() => {});
    resolutionAction = 'leave_recorded';
  } else if (respStatus === 'bio_issue') {
    resolutionAction = 'bio_reset_needed';
  }

  await db.prepare(`
    UPDATE hr_absence_alerts
       SET status='responded', basheer_response=?, basheer_response_at=?, resolution_action=?, resolved_at=?
     WHERE alert_token=?
  `).bind(respStatus, now, resolutionAction || null, now, token).run();

  // Stop the multi-channel escalation chain in comms_outbox so SMS fallback won't fire.
  await db.prepare(`
    UPDATE comms_outbox
       SET acked_at = datetime('now'),
           ack_action = 'responded',
           ack_payload = ?,
           escalation_due_at = NULL
     WHERE alert_id = ? AND acked_at IS NULL
  `).bind(`url:${respStatus}`, `hr_absence:${token}`).run().catch(() => {});

  // Return HTML thank-you page (browser-friendly since called via URL)
  return new Response(`
    <html><head><meta charset="utf-8"><title>HR Response Recorded</title>
    <style>body{font-family:-apple-system,sans-serif;padding:2rem;text-align:center;background:#f0f9ff}
    h1{color:#0369a1}.box{max-width:400px;margin:auto;padding:2rem;background:white;border-radius:1rem;box-shadow:0 2px 12px rgba(0,0,0,0.05)}
    .ok{color:#059669;font-size:3rem}</style></head>
    <body><div class="box"><div class="ok">✓</div><h1>Recorded</h1>
    <p>Status set to <strong>${respStatus.replace('_', ' ')}</strong>.</p>
    <p>Thank you for keeping the roster updated.</p></div></body></html>
  `, { headers: { 'content-type': 'text/html' } });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Ghost PIN Onboarding flow
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function ghostOnboardStart(env, params) {
  const token = params.get('token') || params.get('t');
  if (!token) return json({ error: 'token required' }, 400);

  const ghost = await env.DB.prepare(`SELECT * FROM hr_ghost_pins WHERE onboarding_token=?`).bind(token).first();
  if (!ghost) return json({ error: 'invalid token' }, 404);

  // Mark as in-progress (allows resumption)
  if (ghost.status === 'sent_to_basheer') {
    await env.DB.prepare(`UPDATE hr_ghost_pins SET status='onboarding_started' WHERE id=?`)
      .bind(ghost.id).run();
  }

  // Look up first/last CAMS punch date for this PIN — first punch IS the start date
  const punchSpan = await env.DB.prepare(`
    SELECT MIN(date(punch_time)) AS first_punch, MAX(date(punch_time)) AS last_punch
      FROM hr_cams_punches WHERE pin = ?
  `).bind(ghost.pin).first();

  return json({
    pin: ghost.pin,
    total_punches: ghost.total_punches,
    total_days: ghost.total_days,
    last_seen_at: ghost.last_seen_at,
    first_punch_date: punchSpan?.first_punch || null,
    last_punch_date: punchSpan?.last_punch || null,
    options: {
      brands: ['HE', 'NCH', 'HQ'],
      pay_types: ['Monthly', 'Contract'],
      roles_he: ['Cleaner', 'Waiter', 'Washer', 'Captain', 'Cashier', 'Helper', 'Cook', 'Tandoor Cook', 'Porotta Maker'],
      roles_nch: ['Cleaner', 'Washer', 'Helper', 'Runner', 'Cashier', 'Tea Master', 'Kitchen Helper'],
    },
  });
}

async function ghostOnboardSubmit(env, body, aadhaarFile = null) {
  const { token, name, known_as, phone, role, brand, pay_type, monthly_salary, daily_rate, aadhaar, dob, start_date, notes } = body;

  if (!token) return json({ error: 'token required' }, 400);
  if (!name || !brand || !pay_type) return json({ error: 'name, brand, pay_type required' }, 400);

  const db = env.DB;
  const ghost = await db.prepare(`SELECT * FROM hr_ghost_pins WHERE onboarding_token=?`).bind(token).first();
  if (!ghost) return json({ error: 'invalid token' }, 404);
  if (ghost.status === 'onboarded') return json({ error: 'already onboarded', employee_id: ghost.resolved_employee_id });

  // Auto-classify template
  const wage = pay_type === 'Monthly' ? Number(monthly_salary) : Number(daily_rate) * 30;
  const template = wage > 21000 ? 'C' : (wage === 21000 ? 'B' : 'A');

  // Insert into hr_employees
  const empResult = await db.prepare(`
    INSERT INTO hr_employees
      (pin, name, known_as, phone, job_name, brand_label, pay_type,
       monthly_salary, daily_rate, aadhaar_full, aadhaar_last4, dob,
       start_date, notes, is_active, track_attendance, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'Pending')
    RETURNING id
  `).bind(
    ghost.pin, name, known_as || null, phone || null, role || null,
    brand, pay_type,
    monthly_salary || null, daily_rate || null,
    aadhaar || null, aadhaar ? aadhaar.replace(/\D/g, '').slice(-4) : null, dob || null,
    start_date || todayIST(), notes || null
  ).first();

  // Update ghost row
  await db.prepare(`
    UPDATE hr_ghost_pins
       SET status='onboarded', resolved_employee_id=?, resolved_at=?,
           ob_name=?, ob_known_as=?, ob_phone=?, ob_role=?, ob_brand=?,
           ob_pay_type=?, ob_monthly_salary=?, ob_daily_rate=?,
           ob_aadhaar=?, ob_dob=?, ob_start_date=?, ob_notes=?
     WHERE id=?
  `).bind(
    empResult.id, new Date().toISOString(),
    name, known_as, phone, role, brand,
    pay_type, monthly_salary, daily_rate,
    aadhaar, dob, start_date, notes,
    ghost.id
  ).run();

  // ─── Aadhaar file: stash in KV for owner to move into Drive ─────────────
  // (Server-side Drive upload from CF Pages requires OAuth refresh token wired
  // as a CF secret — see follow-up. For now, we save the bytes + metadata to
  // KV so nothing is lost; owner sees a flag in /ops/hr to move it.)
  let aadhaar_drive_id = null;
  let aadhaar_pending = false;
  if (aadhaarFile && aadhaarFile.size > 0) {
    aadhaar_pending = true;
    try {
      if (env.HR_KV) {
        const buf = await aadhaarFile.arrayBuffer();
        const filename = aadhaarFile.name || `aadhaar_${empResult.id}.bin`;
        await env.HR_KV.put(
          `aadhaar_pending:${empResult.id}`,
          buf,
          { metadata: { filename, mimeType: aadhaarFile.type, employee_id: empResult.id, size: buf.byteLength } }
        );
      }
    } catch (e) {
      console.error('aadhaar stash failed:', e?.message || e);
    }
  }

  return json({
    success: true,
    employee_id: empResult.id,
    template,
    aadhaar_pending,
    aadhaar_drive_id,
    message: 'Employee added. Contract generation will be triggered separately.',
    next_steps: [
      'Generate contract via /api/hr-admin?action=generate-contract&employee_id=' + empResult.id,
      aadhaar_pending ? 'Move Aadhaar file from KV to Drive folder (owner action)' : null,
      'Send to Leegality for eSign',
    ].filter(Boolean),
  });
}
