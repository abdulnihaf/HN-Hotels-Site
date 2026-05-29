/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DARBAR — the staffing command surface (chamber #4 of the Diwan)
 *
 * Darbar is the SURFACE. The heavy lifting lives in the existing APIs:
 *   - attendance read  → /api/hr-admin  (pull-attendance, attendance-daily)
 *   - advances/payroll → /api/hr-payroll
 *   - contracts        → /api/hr-contracts
 *   - notify rails     → /api/_lib/comms-core (sendWithFallback)
 * This module adds the CONNECTIVE tissue that seals the self-driving circle for
 * a single owner-user: the exception inbox (who left / who's a ghost / who's
 * silent), and the write-backs that resolve each exception in one tap.
 *
 * DOCTRINE (COA): the punch sequence IS the operation. Staff tap; the system
 * interprets; Nihaf only sees flagged-and-unhandled. Nobody maintains this —
 * so every signal that would otherwise need Nihaf to *remember* is surfaced
 * here on its own.
 *
 * Actions:
 *   GET  ?action=home        — hero stats + exception inbox + portal health (1 round-trip)
 *   GET  ?action=reconcile   — ghost / departed / never-punched diff (read; cron writes via POST)
 *   POST ?action=reconcile   — persist newly-detected ghost pins into hr_ghost_pins
 *   POST ?action=mark-exit    (Phase 3)
 *   POST ?action=mark-leave   (Phase 3)
 *   POST ?action=fix-punch    (Phase 3)
 *   POST ?action=salary-override (Phase 3)
 *   POST ?action=notify-run   (Phase 4)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { sendWithFallback } from './_lib/comms-core.js';
import { mintToken, verifyToken, corsHeaders } from './_lib/darbar-auth.js';

// Server-side PIN map — the REAL auth boundary (mirrors ops/darbar/app.js USERS,
// which is now only a UX convenience). PINs are verified here, never client-side.
const AUTH_PINS = {
  '0305': { name: 'Nihaf',   role: 'admin',      fin: true  },
  '8523': { name: 'Basheer', role: 'manager',    fin: false },
  '2026': { name: 'Zoya',    role: 'onboarding', fin: false },
  '4040': { name: 'Haneef',  role: 'manager',    fin: false },
  '5050': { name: 'Nissar',  role: 'manager',    fin: false },
};
// Actions that mutate money / roster identity — admin (fin) only.
const ADMIN_ONLY = new Set(['salary-override', 'mark-exit', 'onboard']);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Attach reflected CORS headers to any Response before it leaves.
function withCors(resp, request) {
  const h = corsHeaders(request);
  for (const [k, v] of Object.entries(h)) resp.headers.set(k, v);
  return resp;
}

// Departed tiers (consecutive silent days). Never auto-deactivate — surface to owner.
const DEPARTED_WATCH = 7;        // first nudge
const DEPARTED_STRONG = 14;
const DEPARTED_CERTAIN = 21;
const GHOST_ACTIVE_DAYS = 3;     // a ghost pin that punched within N days is "working now"

// IST helpers as SQL fragments (punch_time is stored as IST wall-clock text).
const IST = `'+330 minutes'`;                       // UTC -> IST
const HE_DAY = `date(datetime('now', ${IST}, '-4 hours'))`;  // HE 4am business day

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'home';
  const db = env.DB;

  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
  if (!db) return withCors(json({ error: 'DB binding missing' }, 500), request);

  try {
    // ── auth: the only unauthenticated action. Verifies the PIN server-side. ──
    if (action === 'auth' && request.method === 'POST') {
      const { pin } = await request.json().catch(() => ({}));
      const u = pin && AUTH_PINS[String(pin)];
      if (!u) return withCors(json({ error: 'invalid PIN' }, 401), request);
      const token = await mintToken(env, u);
      return withCors(json({ token, user: u.name, role: u.role, fin: u.fin }), request);
    }

    // ── everything else REQUIRES a valid token (or internal service key) ──
    const auth = await verifyToken(env, request);
    if (!auth) return withCors(json({ error: 'unauthorized' }, 401), request);

    if (request.method === 'GET') {
      if (action === 'home') return withCors(await home(db, url), request);
      if (action === 'reconcile') return withCors(await reconcile(db, false), request);
      return withCors(json({ error: `unknown GET action: ${action}` }, 400), request);
    }
    if (request.method === 'POST') {
      if (ADMIN_ONLY.has(action) && !(auth.f || auth.r === 'admin')) {
        return withCors(json({ error: 'forbidden — admin only' }, 403), request);
      }
      const body = await request.json().catch(() => ({}));
      if (action === 'reconcile')       return withCors(await reconcile(db, true), request);
      if (action === 'mark-exit')       return withCors(await markExit(db, body), request);
      if (action === 'mark-leave')      return withCors(await markLeave(db, body), request);
      if (action === 'fix-punch')       return withCors(await fixPunch(db, body), request);
      if (action === 'salary-override') return withCors(await salaryOverride(db, body), request);
      if (action === 'dismiss-ghost')   return withCors(await dismissGhost(db, body), request);
      if (action === 'onboard')         return withCors(await onboard(db, body), request);
      if (action === 'notify-run')      return withCors(await notifyRun(db, env, body), request);
      return withCors(json({ error: `unknown POST action: ${action}` }, 400), request);
    }
    return withCors(json({ error: 'method not allowed' }, 405), request);
  } catch (e) {
    return withCors(json({ error: 'server error' }, 500), request);   // never echo internals
  }
}

/* ━━━ HOME — the daily screen in one round-trip ━━━ */
async function home(db, url) {
  // Resolve the current HE business day once.
  const dayRow = await db.prepare(
    `SELECT ${HE_DAY} AS d, datetime('now', ${IST}) AS ist_now,
            CAST((julianday('now', ${IST}) - julianday(MAX(punch_time))) * 1440 AS INT) AS cams_age_min
       FROM hr_cams_punches`
  ).first();
  const businessDay = dayRow.d;

  // Hero stats — display state derived from punch_count PARITY (not the over-fired
  // stored `ghost`): even=present, odd=missing-punch, 0=absent/pending, off=week_off/leave.
  const stats = await db.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('week_off','leave') THEN 1 ELSE 0 END) AS off,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN status NOT IN ('week_off','leave','pending') AND punch_count>0 AND punch_count%2=0 THEN 1 ELSE 0 END) AS present,
       SUM(CASE WHEN status NOT IN ('week_off','leave','pending') AND punch_count>0 AND punch_count%2=1 THEN 1 ELSE 0 END) AS missing_punch,
       SUM(CASE WHEN status NOT IN ('week_off','leave','pending') AND (punch_count=0 OR punch_count IS NULL) THEN 1 ELSE 0 END) AS absent,
       COUNT(*) AS rows
     FROM hr_attendance_daily ad
     JOIN hr_employees e ON e.id=ad.employee_id AND e.is_active=1 AND e.track_attendance=1
     WHERE ad.date = ?`
  ).bind(businessDay).first();

  const expected = (await db.prepare(
    `SELECT COUNT(*) n FROM hr_employees WHERE is_active=1 AND track_attendance=1 AND pin IS NOT NULL AND pin!=''`
  ).first()).n;

  // ── Exception inbox (ordered: departed → ghost → chronic → never-punched) ──
  const exceptions = [];

  // O1 — departed: active tracked roster gone silent >= watch tier, not on leave.
  const departed = await db.prepare(
    `SELECT e.id, e.pin, e.name, e.known_as, e.brand_label, e.monthly_salary, e.daily_rate, e.phone,
            CAST(julianday('now', ${IST}) - julianday(MAX(p.punch_time)) AS INT) AS days_silent,
            MAX(p.punch_time) AS last_punch
       FROM hr_employees e
       LEFT JOIN hr_cams_punches p ON p.pin = e.pin
      WHERE e.is_active=1 AND e.track_attendance=1
      GROUP BY e.id
      HAVING days_silent >= ${DEPARTED_WATCH} OR days_silent IS NULL
      ORDER BY days_silent DESC`
  ).all();
  for (const r of departed.results || []) {
    // suppress if a leave row covers the silence window
    const leave = await db.prepare(
      `SELECT 1 FROM hr_leaves WHERE employee_id=? AND date(end_date) >= date('now', ${IST}, '-' || ? || ' days') LIMIT 1`
    ).bind(r.id, r.days_silent || 30).first();
    if (leave) continue;
    const tier = (r.days_silent == null || r.days_silent >= DEPARTED_CERTAIN) ? 'certain'
               : r.days_silent >= DEPARTED_STRONG ? 'strong' : 'watch';
    exceptions.push({
      type: 'departed', id: r.id, pin: r.pin,
      name: r.known_as || r.name, brand: r.brand_label,
      days_silent: r.days_silent, last_punch: r.last_punch,
      monthly_salary: r.monthly_salary, daily_rate: r.daily_rate,
      phone: r.phone, tier,
    });
  }

  // O2 — ghost identity: pin punching, no roster row.
  const ghosts = await db.prepare(
    `SELECT p.pin, COUNT(*) AS punches, COUNT(DISTINCT substr(p.punch_time,1,10)) AS days,
            MAX(p.punch_time) AS last_punch,
            CAST(julianday('now', ${IST}) - julianday(MAX(p.punch_time)) AS INT) AS days_silent,
            SUM(CASE WHEN CAST(substr(p.punch_time,12,2) AS INT) < 12 THEN 1 ELSE 0 END) AS morning,
            SUM(CASE WHEN CAST(substr(p.punch_time,12,2) AS INT) >= 12 THEN 1 ELSE 0 END) AS evening
       FROM hr_cams_punches p
       LEFT JOIN hr_employees e ON e.pin = p.pin
      WHERE e.id IS NULL
      GROUP BY p.pin ORDER BY punches DESC`
  ).all();
  for (const r of ghosts.results || []) {
    const g = await db.prepare(`SELECT status FROM hr_ghost_pins WHERE pin=? ORDER BY id DESC LIMIT 1`).bind(r.pin).first();
    if (g && (g.status === 'onboarded' || g.status === 'dismissed')) continue;
    exceptions.push({
      type: 'ghost', pin: r.pin, punches: r.punches, days: r.days,
      last_punch: r.last_punch, days_silent: r.days_silent,
      active: r.days_silent <= GHOST_ACTIVE_DAYS,
      shape: r.morning && r.evening ? 'split (morning+evening)' : r.morning ? 'morning' : 'evening',
    });
  }

  // O4 — chronic missed-punch: same pin odd-count >=3 of trailing 7 business days.
  const chronic = await db.prepare(
    `SELECT e.pin, COALESCE(e.known_as,e.name) AS name, e.brand_label,
            COUNT(*) AS odd_days
       FROM hr_attendance_daily ad
       JOIN hr_employees e ON e.id=ad.employee_id AND e.is_active=1 AND e.track_attendance=1
      WHERE ad.date >= date(?, '-7 days')
        AND ad.punch_count > 0 AND ad.punch_count % 2 = 1
      GROUP BY e.id HAVING odd_days >= 3 ORDER BY odd_days DESC`
  ).bind(businessDay).all();
  for (const r of chronic.results || []) {
    exceptions.push({ type: 'chronic_missed', pin: r.pin, name: r.name, brand: r.brand_label, odd_days: r.odd_days });
  }

  // O3 — never-punched roster pin (enrolled or not?).
  const never = await db.prepare(
    `SELECT e.pin, COALESCE(e.known_as,e.name) AS name, e.brand_label
       FROM hr_employees e
      WHERE e.is_active=1 AND e.track_attendance=1 AND e.pin IS NOT NULL AND e.pin!=''
        AND NOT EXISTS (SELECT 1 FROM hr_cams_punches p WHERE p.pin = e.pin)`
  ).all();
  for (const r of never.results || []) {
    exceptions.push({ type: 'never_punched', pin: r.pin, name: r.name, brand: r.brand_label });
  }

  return json({
    business_day: businessDay,
    ist_now: dayRow.ist_now,
    stats: {
      expected,
      present: stats?.present || 0,
      in_progress: stats?.in_progress || 0,
      missing_punch: stats?.missing_punch || 0,
      absent: stats?.absent || 0,
      off: stats?.off || 0,
    },
    exception_count: exceptions.length,
    exceptions,
    health: {
      cams_last_punch_age_min: dayRow.cams_age_min,
      cams_ok: (dayRow.cams_age_min ?? 9999) < 90,
      ghost_count: (ghosts.results || []).length,
    },
  });
}

/* ━━━ RECONCILE — ghost/departed/never diff. POST persists new ghost pins. ━━━ */
async function reconcile(db, persist) {
  const unknown = await db.prepare(
    `SELECT p.pin, COUNT(*) AS punches, MIN(p.punch_time) AS first_seen, MAX(p.punch_time) AS last_seen,
            COUNT(DISTINCT substr(p.punch_time,1,10)) AS total_days
       FROM hr_cams_punches p
       LEFT JOIN hr_employees e ON e.pin = p.pin
      WHERE e.id IS NULL
      GROUP BY p.pin`
  ).all();

  let inserted = 0;
  if (persist) {
    for (const r of unknown.results || []) {
      const existing = await db.prepare(
        `SELECT id, status FROM hr_ghost_pins WHERE pin=? ORDER BY id DESC LIMIT 1`
      ).bind(r.pin).first();
      if (existing && !['onboarded', 'dismissed'].includes(existing.status)) {
        await db.prepare(
          `UPDATE hr_ghost_pins SET last_seen_at=?, total_punches=?, total_days=? WHERE id=?`
        ).bind(r.last_seen, r.punches, r.total_days, existing.id).run();
      } else if (!existing) {
        await db.prepare(
          `INSERT INTO hr_ghost_pins (pin, first_seen_at, last_seen_at, total_punches, total_days, status)
           VALUES (?, ?, ?, ?, ?, 'detected')`
        ).bind(r.pin, r.first_seen, r.last_seen, r.punches, r.total_days).run();
        inserted++;
      }
    }
  }

  return json({ unknown_pins: (unknown.results || []).map(r => r.pin), detail: unknown.results || [], inserted });
}

/* ━━━ Write-backs (owner-only — gated by token + ADMIN_ONLY in onRequest) ━━━ */

// O1 resolution: the worker has left. Record the exit, stop counting them.
// Never auto-fires — only the owner, from the Today inbox, can confirm a departure.
async function markExit(db, body) {
  const { employee_id, exit_kind = 'departed_silent', reason, recorded_by = 'owner', fnf_amount, fnf_note } = body;
  if (!employee_id) return json({ error: 'employee_id required' }, 400);
  const emp = await db.prepare(`SELECT id, pin, name, known_as, brand_label FROM hr_employees WHERE id=?`).bind(employee_id).first();
  if (!emp) return json({ error: 'employee not found' }, 404);
  const last = await db.prepare(`SELECT MAX(punch_time) AS lp FROM hr_cams_punches WHERE pin=?`).bind(emp.pin).first();
  const lastDay = last?.lp ? String(last.lp).slice(0, 10) : null;
  const daysSilent = last?.lp
    ? (await db.prepare(`SELECT CAST(julianday('now','+330 minutes') - julianday(?) AS INT) d`).bind(last.lp).first()).d
    : null;

  await db.prepare(
    `INSERT INTO hr_exits (employee_id, pin, name, brand_label, exit_kind, last_working_day, days_silent, reason, fnf_amount, fnf_note, fnf_status, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(emp.id, emp.pin, emp.known_as || emp.name, emp.brand_label, exit_kind, lastDay, daysSilent,
         reason || null, fnf_amount ?? null, fnf_note || null, fnf_amount != null ? 'drafted' : 'pending', recorded_by).run();

  await db.prepare(
    `UPDATE hr_employees SET is_active=0, sync_status='Archived', archived_at=datetime('now'),
       archive_reason=?, updated_at=datetime('now') WHERE id=?`
  ).bind(reason || `exit: ${exit_kind}`, emp.id).run();

  await logSync(db, 'darbar_mark_exit', emp.id, `${emp.known_as || emp.name} (pin ${emp.pin}) — ${exit_kind}`, recorded_by);
  return json({ ok: true, employee_id: emp.id, archived: true, exit_kind });
}

// O1 alternate / absence resolution: they're on leave, not gone. Suppresses alerts + feeds payroll.
async function markLeave(db, body) {
  const { employee_id, start_date, end_date, leave_type = 'unpaid', reason, approved_by = 'owner' } = body;
  if (!employee_id || !start_date) return json({ error: 'employee_id and start_date required' }, 400);
  const end = end_date || start_date;
  await db.prepare(
    `INSERT INTO hr_leaves (employee_id, pin, start_date, end_date, leave_type, approved, approved_by, reason)
     VALUES (?, (SELECT pin FROM hr_employees WHERE id=?), ?, ?, ?, 1, ?, ?)`
  ).bind(employee_id, employee_id, start_date, end, leave_type, approved_by, reason || null).run();
  await logSync(db, 'darbar_mark_leave', employee_id, `${leave_type} ${start_date}..${end}`, approved_by);
  return json({ ok: true, employee_id, start_date, end_date: end, leave_type });
}

// Attendance board one-tap: a worker forgot to punch out → owner imputes the OUT.
// Recorded as imputed (not silently invented); flips the day to complete (even).
async function fixPunch(db, body) {
  const { employee_id, date, out_time, by = 'owner' } = body;
  if (!employee_id || !date) return json({ error: 'employee_id and date required' }, 400);
  const row = await db.prepare(
    `SELECT * FROM hr_attendance_daily WHERE employee_id=? AND date=?`
  ).bind(employee_id, date).first();
  if (!row) return json({ error: 'no attendance row for that day' }, 404);
  // Default imputed out = first_in + 9h (a normal shift) when not supplied.
  const imputedOut = out_time || (await db.prepare(
    `SELECT datetime(?, '+9 hours') t`
  ).bind(row.first_in_at).first()).t;
  const newCount = (row.punch_count || 0) % 2 === 1 ? (row.punch_count + 1) : row.punch_count;
  await db.prepare(
    `UPDATE hr_attendance_daily
        SET last_out_at=?, punch_count=?, is_single_punch=0, imputed_out=1,
            status='present', deducted_amount=0, deduction_reason='owner-imputed checkout',
            computed_at=datetime('now')
      WHERE id=?`
  ).bind(imputedOut, newCount, row.id).run();
  await logSync(db, 'darbar_fix_punch', employee_id, `imputed OUT ${imputedOut} for ${date}`, by);
  return json({ ok: true, employee_id, date, imputed_out: imputedOut });
}

// Nihaf salary requirement #3/#4: owner-entered final payable, overriding the
// attendance-derived figure. Never silently replaces the computed net — recorded alongside.
async function salaryOverride(db, body) {
  const { employee_id, pay_period, amount, note, by = 'owner' } = body;
  if (!employee_id || !pay_period || amount == null) return json({ error: 'employee_id, pay_period, amount required' }, 400);
  const emp = await db.prepare(`SELECT id, pay_type, monthly_salary, daily_rate FROM hr_employees WHERE id=?`).bind(employee_id).first();
  if (!emp) return json({ error: 'employee not found' }, 404);
  const existing = await db.prepare(`SELECT id FROM hr_payroll_snapshots WHERE employee_id=? AND pay_period=?`).bind(employee_id, pay_period).first();
  if (existing) {
    await db.prepare(
      `UPDATE hr_payroll_snapshots SET manual_override_amount=?, manual_override_note=?, manual_override_by=?, manual_override_at=datetime('now') WHERE id=?`
    ).bind(amount, note || null, by, existing.id).run();
  } else {
    await db.prepare(
      `INSERT INTO hr_payroll_snapshots (employee_id, pay_period, base_pay, pay_type, net_payable, status, computed_at,
         manual_override_amount, manual_override_note, manual_override_by, manual_override_at)
       VALUES (?, ?, ?, ?, ?, 'computed', datetime('now'), ?, ?, ?, datetime('now'))`
    ).bind(employee_id, pay_period, emp.monthly_salary || 0, emp.pay_type || 'Monthly', amount, amount, note || null, by).run();
  }
  await logSync(db, 'darbar_salary_override', employee_id, `${pay_period} = ₹${amount}`, by);
  return json({ ok: true, employee_id, pay_period, amount });
}

// O2 resolution: a ghost pin that is NOT a real worker (visitor / test tap) → dismiss.
async function dismissGhost(db, body) {
  const { pin, by = 'owner' } = body;
  if (!pin) return json({ error: 'pin required' }, 400);
  const g = await db.prepare(`SELECT id FROM hr_ghost_pins WHERE pin=? ORDER BY id DESC LIMIT 1`).bind(pin).first();
  if (g) await db.prepare(`UPDATE hr_ghost_pins SET status='dismissed' WHERE id=?`).bind(g.id).run();
  else await db.prepare(`INSERT INTO hr_ghost_pins (pin, status) VALUES (?, 'dismissed')`).bind(pin).run();
  await logSync(db, 'darbar_dismiss_ghost', null, `ghost pin ${pin} dismissed`, by);
  return json({ ok: true, pin, dismissed: true });
}

// O2 resolution: name a ghost pin → real employee. Mirrors the (fixed) ghost-onboard
// insert with the correct 'Pending' sync_status casing. Odoo mirror + barcode follow via
// the roster sync (uid=2); attendance computes immediately (pullAttendance keys on pin).
async function onboard(db, body) {
  const { pin, name, known_as, brand, pay_type, monthly_salary, daily_rate, phone, role, by = 'owner' } = body;
  if (!pin || !name || !brand || !pay_type) return json({ error: 'pin, name, brand, pay_type required' }, 400);
  const existing = await db.prepare(`SELECT id FROM hr_employees WHERE pin=?`).bind(String(pin)).first();
  if (existing) return json({ error: 'pin already on roster', employee_id: existing.id }, 409);
  const company_id = brand === 'HE' ? '1' : brand === 'NCH' ? '10' : null;
  const res = await db.prepare(
    `INSERT INTO hr_employees (pin, name, known_as, phone, job_name, brand_label, company_id, pay_type,
       monthly_salary, daily_rate, start_date, is_active, track_attendance, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now','+330 minutes'), 1, 1, 'Pending', datetime('now'), datetime('now'))
     RETURNING id`
  ).bind(String(pin), name, known_as || null, phone || null, role || null, brand, company_id, pay_type,
         monthly_salary ?? null, daily_rate ?? null).first();
  await db.prepare(`UPDATE hr_ghost_pins SET status='onboarded', resolved_employee_id=?, resolved_at=datetime('now') WHERE pin=? AND status NOT IN ('onboarded','dismissed')`)
    .bind(res.id, String(pin)).run();
  await logSync(db, 'darbar_onboard', res.id, `${name} (pin ${pin}, ${brand})`, by);
  return json({ ok: true, employee_id: res.id, pin, needs_odoo_sync: true });
}

// Staff punch-nudge engine. DORMANT by default: dry-run unless body.arm===true.
// Do NOT arm in cron until the WABA templates (§ owner submit batch) are approved —
// otherwise it queues sends that fail. SMS leg auto-arms when each DLT id lands
// (lookupDltTemplate returns ready:false meanwhile → skipped gracefully).
// Owner exceptions (departed/ghost) are surfaced IN-APP (the Today inbox), not here.
async function notifyRun(db, env, body) {
  const arm = body.arm === true;
  const day = body.day || (await db.prepare(`SELECT ${HE_DAY} AS d FROM hr_cams_punches`).first()).d;
  const cur = (await db.prepare(`SELECT ${HE_DAY} AS d FROM hr_cams_punches`).first()).d;

  // Departed pins are owner exceptions — never staff-nudge them about absence.
  const dep = await db.prepare(
    `SELECT e.pin FROM hr_employees e LEFT JOIN hr_cams_punches p ON p.pin=e.pin
      WHERE e.is_active=1 AND e.track_attendance=1
      GROUP BY e.id HAVING CAST(julianday('now','+330 minutes')-julianday(MAX(p.punch_time)) AS INT) >= 7`
  ).all();
  const departed = new Set((dep.results || []).map(r => String(r.pin)));

  const rows = await db.prepare(
    `SELECT ad.punch_count, ad.status, e.pin, e.phone, COALESCE(e.known_as,e.name) AS nm
       FROM hr_attendance_daily ad
       JOIN hr_employees e ON e.id=ad.employee_id AND e.is_active=1 AND e.track_attendance=1
      WHERE ad.date=?`
  ).bind(day).all();

  const planned = [];
  for (const r of rows.results || []) {
    const pc = r.punch_count || 0;
    let state = null, template = null;
    if (pc > 0 && pc % 2 === 1) { state = 'missed_exit'; template = 'darbar_missed_exit_v1'; }
    else if (pc === 0 && r.status !== 'leave' && r.status !== 'week_off' && day === cur && !departed.has(String(r.pin))) { state = 'absent'; template = 'darbar_absent_v1'; }
    if (!state) continue;
    const rec = { pin: r.pin, name: r.nm, state };
    if (!r.phone) { rec.skipped = 'no_phone'; planned.push(rec); continue; }
    const alert_id = `darbar_${state}:${r.pin}:${day}`;
    const dup = await db.prepare(`SELECT 1 FROM comms_outbox WHERE alert_id=? LIMIT 1`).bind(alert_id).first();
    if (dup) { rec.skipped = 'already_sent'; planned.push(rec); continue; }
    rec.phone = r.phone; rec.template = template;
    if (arm) {
      try {
        await sendWithFallback(env, {
          brand: 'sparksol', tier: 'info', alert_id, phone: r.phone,
          template, language: 'en', vars: [r.nm],
          chain: ['waba', 'sms'], gap_minutes: { waba: 30, sms: 60 },
        });
        rec.sent = true;
      } catch (e) { rec.error = String(e.message || e); }
    }
    planned.push(rec);
  }
  return json({ day, armed: arm, count: planned.length, planned });
}

async function logSync(db, action, targetId, reference, by) {
  try {
    await db.prepare(
      `INSERT INTO hr_sync_log (action, target_model, target_id, reference, status, synced_by, created_at)
       VALUES (?, 'darbar', ?, ?, 'ok', ?, datetime('now'))`
    ).bind(action, targetId, reference, by).run();
  } catch { /* logging is best-effort */ }
}
