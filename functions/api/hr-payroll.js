// /api/hr-payroll — Salary advances ledger + monthly payable computation
//
// Scope:
//   1. Advances ledger (hr_advances) — works identically for April back-fill and
//      every month going forward. Owner records advances as they are paid.
//   2. April-only one-time entry: pre-CAMS unpaid leave days per employee
//      (since CAMS attendance only started ~Apr 18, the Apr 1–17 window is
//      blind without a manual number).
//   3. Monthly payable computation — for any pay_period (YYYY-MM):
//        Monthly  : monthly_salary − (LOP days × per_day) − advances_in_month
//        Contract : days_worked × daily_rate − advances_in_month
//      Result snapshotted to hr_payroll_snapshots so once approved it freezes.
//
// Endpoints (all under /api/hr-payroll?action=…):
//   POST  record-advance         { employee_id, advance_date, amount, paid_via, reference?, reason?, notes? }
//   GET   list-advances          ?employee_id=N | ?month=YYYY-MM
//   POST  update-advance         { id, ...fields }
//   POST  delete-advance         { id }
//   POST  set-april-closing      { employee_id, april_unpaid_leave_days, april_paid_leave_days?, notes? }
//   POST  set-april-closing-bulk { rows: [{employee_id, april_unpaid_leave_days, ...}] }
//   GET   april-closing-list     -> { employees: [{id, name, monthly_salary, april_unpaid_leave_days, status}] }
//   POST  compute-payable        { pay_period, employee_id? }    — re-compute a snapshot (no approve)
//   GET   list-payable           ?pay_period=YYYY-MM
//   POST  approve-payable        { snapshot_id | { pay_period, employee_id }, approved_by? }
//   POST  mark-paid              { snapshot_id, payment_reference, paid_at? }
//   GET   summary                ?pay_period=YYYY-MM   — totals: advances_outstanding, payable_due, paid
//
// Auth: same as hr-admin (DASHBOARD_KEY via x-dashboard-key header).

'use strict';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function authOk(request, env, body) {
  const key = request.headers.get('x-dashboard-key') || body?.dashboard_key;
  return key && key === env.DASHBOARD_KEY;
}

function daysInMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function monthBounds(yyyymm) {
  const dim = daysInMonth(yyyymm);
  return { start: `${yyyymm}-01`, end: `${yyyymm}-${String(dim).padStart(2, '0')}`, days: dim };
}

// ─── Compute payable for one employee for one pay period ────────────────────
//
// Returns the breakdown WITHOUT writing — caller decides whether to snapshot.
async function computePayableFor(env, employeeId, payPeriod) {
  const db = env.DB;
  const emp = await db.prepare(`SELECT * FROM hr_employees WHERE id = ?`).bind(employeeId).first();
  if (!emp) throw new Error(`employee ${employeeId} not found`);

  const { start, end, days } = monthBounds(payPeriod);
  const isApril = payPeriod === '2026-04';

  // Sum advances paid in this month (any source)
  const advAgg = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM hr_advances
     WHERE employee_id = ? AND advance_date BETWEEN ? AND ?
  `).bind(employeeId, start, end).first();
  const advances_total = Number(advAgg?.total || 0);
  const advances_count = Number(advAgg?.cnt || 0);

  // Days worked from CAMS-derived hr_attendance_daily (total_hours > 1 = present)
  const attAgg = await db.prepare(`
    SELECT COUNT(*) AS days_present
      FROM hr_attendance_daily
     WHERE employee_id = ? AND date BETWEEN ? AND ? AND total_hours > 1
  `).bind(employeeId, start, end).first();
  const cams_days_present = Number(attAgg?.days_present || 0);

  // Approved leaves overlapping this period (paid OR unpaid — schema doesn't separate today)
  const leaveAgg = await db.prepare(`
    SELECT
      COALESCE(SUM(MAX(0, julianday(MIN(to_date, ?)) - julianday(MAX(from_date, ?)) + 1)), 0) AS leave_days
    FROM hr_leaves
    WHERE employee_id = ? AND status = 'approved'
      AND from_date <= ? AND to_date >= ?
  `).bind(end, start, employeeId, end, start).first().catch(() => ({ leave_days: 0 }));
  const approved_leave_days_in_period = Number(leaveAgg?.leave_days || 0);

  let pay_type = emp.pay_type || 'Monthly';
  const monthly_salary = Number(emp.monthly_salary || 0);
  const daily_rate = Number(emp.daily_rate || 0);

  let base_pay = 0;
  let days_worked = 0;
  let unpaid_leave_days = 0;
  let unpaid_leave_deduction = 0;
  let computation_notes = [];

  if (pay_type === 'Monthly') {
    base_pay = monthly_salary;
    const per_day = days > 0 ? monthly_salary / days : 0;

    // April back-fill: pre-CAMS LOP comes from manual april_unpaid_leave_days
    const pre_cams_lop = isApril ? Number(emp.april_unpaid_leave_days || 0) : 0;

    // CAMS-era LOP = (expected working days in CAMS window) − cams_days_present − approved_paid_leaves_in_window
    // For simplicity v1: CAMS window = whole month for May+, and Apr 18→30 for April
    let cams_window_days = days;
    let cams_window_start = start;
    if (isApril) {
      cams_window_start = '2026-04-18';
      cams_window_days = days - 17; // 30 - 17 = 13 days
    }
    // Approved leaves that fall in CAMS window — for now treat all as paid leaves (no LOP)
    const cams_lop = Math.max(0, cams_window_days - cams_days_present - approved_leave_days_in_period);

    unpaid_leave_days = pre_cams_lop + cams_lop;
    unpaid_leave_deduction = unpaid_leave_days * per_day;
    days_worked = days - unpaid_leave_days;

    if (isApril) {
      computation_notes.push(`April back-fill: ${pre_cams_lop} pre-CAMS LOP + ${cams_lop} CAMS-era LOP (CAMS window ${cams_window_start} → ${end})`);
    }
  } else if (pay_type === 'Contract') {
    // Contract daily: pay = days_worked × daily_rate. April pre-CAMS attendance
    // wasn't tracked for Mujib/Moin — owner enters days_worked manually via
    // april_unpaid_leave_days (negated: 30 − unpaid = worked) OR overrides.
    const assumed_pre_cams_days = isApril ? 17 : 0; // Apr 1–17, before CAMS launch
    const pre_cams_lop = isApril ? Number(emp.april_unpaid_leave_days || 0) : 0;
    const pre_cams_worked = Math.max(0, assumed_pre_cams_days - pre_cams_lop);

    days_worked = pre_cams_worked + cams_days_present;
    base_pay = days_worked * daily_rate;
    unpaid_leave_days = pre_cams_lop;
    unpaid_leave_deduction = 0; // already netted by days_worked
    if (isApril) {
      computation_notes.push(`April Contract: ${pre_cams_worked} pre-CAMS days (17 − ${pre_cams_lop} LOP) + ${cams_days_present} CAMS days = ${days_worked} × ₹${daily_rate}`);
    }
  } else {
    base_pay = monthly_salary; // TBD pay_type — fall back to monthly
  }

  const net_payable = Math.max(0, base_pay - unpaid_leave_deduction - advances_total);

  return {
    employee_id: employeeId,
    pay_period: payPeriod,
    pay_type,
    base_pay: Math.round(base_pay * 100) / 100,
    days_in_month: days,
    days_worked: Math.round(days_worked * 100) / 100,
    unpaid_leave_days: Math.round(unpaid_leave_days * 100) / 100,
    unpaid_leave_deduction: Math.round(unpaid_leave_deduction * 100) / 100,
    advances_total: Math.round(advances_total * 100) / 100,
    advances_count,
    net_payable: Math.round(net_payable * 100) / 100,
    cams_days_present,
    approved_leave_days_in_period,
    computation_notes,
    monthly_salary,
    daily_rate,
    employee_name: emp.known_as || emp.name,
    brand_label: emp.brand_label,
  };
}

async function snapshotPayable(env, computation, opts = {}) {
  const c = computation;
  const json = JSON.stringify(c);
  // UPSERT on (employee_id, pay_period)
  await env.DB.prepare(`
    INSERT INTO hr_payroll_snapshots
      (employee_id, pay_period, base_pay, pay_type, days_worked, days_in_month,
       unpaid_leave_days, unpaid_leave_deduction, advances_total, advances_count,
       net_payable, status, computed_at, computation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'computed', datetime('now'), ?)
    ON CONFLICT(employee_id, pay_period) DO UPDATE SET
      base_pay=excluded.base_pay,
      days_worked=excluded.days_worked,
      days_in_month=excluded.days_in_month,
      unpaid_leave_days=excluded.unpaid_leave_days,
      unpaid_leave_deduction=excluded.unpaid_leave_deduction,
      advances_total=excluded.advances_total,
      advances_count=excluded.advances_count,
      net_payable=excluded.net_payable,
      computed_at=datetime('now'),
      computation_json=excluded.computation_json
    WHERE status = 'computed'
  `).bind(
    c.employee_id, c.pay_period, c.base_pay, c.pay_type, c.days_worked, c.days_in_month,
    c.unpaid_leave_days, c.unpaid_leave_deduction, c.advances_total, c.advances_count,
    c.net_payable, json,
  ).run();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const method = request.method;
  const db = env.DB;

  let body = {};
  if (method === 'POST') {
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  }
  if (!authOk(request, env, body)) return json({ error: 'unauthorized' }, 401);

  // ─── Advances CRUD ──────────────────────────────────────────────────────
  if (action === 'record-advance' && method === 'POST') {
    const {
      employee_id, advance_date, amount,
      paid_via = 'cash', reference = null, reason = null, notes = null,
      source = 'manual', recorded_by = null,
    } = body;
    if (!employee_id || !advance_date || !amount) {
      return json({ error: 'employee_id, advance_date, amount required' }, 400);
    }
    const r = await db.prepare(`
      INSERT INTO hr_advances
        (employee_id, advance_date, amount, paid_via, reference, reason, notes, source, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      employee_id, advance_date, Number(amount),
      paid_via, reference, reason, notes, source, recorded_by,
    ).first();
    return json({ ok: true, id: r?.id });
  }

  if (action === 'record-advance-bulk' && method === 'POST') {
    // Bulk insert. For April back-fill: pass the whole list in one POST.
    // rows: [{ employee_id, advance_date, amount, paid_via?, reference?, reason?, notes? }]
    const { rows = [], source = 'april_backfill', recorded_by = null } = body;
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'rows[] required' }, 400);
    const inserted = [];
    const errors = [];
    for (const r of rows) {
      if (!r.employee_id || !r.advance_date || !r.amount) {
        errors.push({ row: r, error: 'missing employee_id/advance_date/amount' });
        continue;
      }
      try {
        const ins = await db.prepare(`
          INSERT INTO hr_advances
            (employee_id, advance_date, amount, paid_via, reference, reason, notes, source, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `).bind(
          r.employee_id, r.advance_date, Number(r.amount),
          r.paid_via || 'cash', r.reference || null, r.reason || null, r.notes || null,
          source, recorded_by,
        ).first();
        inserted.push({ employee_id: r.employee_id, advance_date: r.advance_date, amount: r.amount, id: ins?.id });
      } catch (e) {
        errors.push({ row: r, error: e.message });
      }
    }
    return json({ ok: errors.length === 0, inserted: inserted.length, errors, ids: inserted.map(x => x.id) });
  }

  if (action === 'list-advances' && method === 'GET') {
    const employeeId = url.searchParams.get('employee_id');
    const month = url.searchParams.get('month'); // YYYY-MM
    const where = []; const binds = [];
    if (employeeId) { where.push('a.employee_id = ?'); binds.push(employeeId); }
    if (month)      { const { start, end } = monthBounds(month); where.push('a.advance_date BETWEEN ? AND ?'); binds.push(start, end); }
    const sql = `
      SELECT a.*, e.name AS employee_name, e.known_as AS employee_known_as, e.brand_label
        FROM hr_advances a
        LEFT JOIN hr_employees e ON e.id = a.employee_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.advance_date DESC, a.id DESC
       LIMIT 500
    `;
    const rs = await db.prepare(sql).bind(...binds).all();
    return json({ rows: rs.results || [] });
  }

  if (action === 'update-advance' && method === 'POST') {
    const { id, advance_date, amount, paid_via, reference, reason, notes } = body;
    if (!id) return json({ error: 'id required' }, 400);
    const sets = []; const binds = [];
    if (advance_date !== undefined) { sets.push('advance_date = ?'); binds.push(advance_date); }
    if (amount !== undefined)       { sets.push('amount = ?');       binds.push(Number(amount)); }
    if (paid_via !== undefined)     { sets.push('paid_via = ?');     binds.push(paid_via); }
    if (reference !== undefined)    { sets.push('reference = ?');    binds.push(reference); }
    if (reason !== undefined)       { sets.push('reason = ?');       binds.push(reason); }
    if (notes !== undefined)        { sets.push('notes = ?');        binds.push(notes); }
    if (!sets.length) return json({ error: 'nothing to update' }, 400);
    binds.push(id);
    const r = await db.prepare(`UPDATE hr_advances SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  if (action === 'delete-advance' && method === 'POST') {
    const { id } = body;
    if (!id) return json({ error: 'id required' }, 400);
    const r = await db.prepare(`DELETE FROM hr_advances WHERE id = ?`).bind(id).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  // ─── April closing (one-time pre-CAMS leave entry) ──────────────────────
  if (action === 'set-april-closing' && method === 'POST') {
    const { employee_id, april_unpaid_leave_days, april_paid_leave_days = null, notes = null } = body;
    if (!employee_id || april_unpaid_leave_days === undefined) {
      return json({ error: 'employee_id and april_unpaid_leave_days required' }, 400);
    }
    const r = await db.prepare(`
      UPDATE hr_employees
         SET april_unpaid_leave_days = ?,
             april_paid_leave_days = ?,
             april_closing_notes = ?,
             april_closing_recorded_at = datetime('now')
       WHERE id = ?
    `).bind(Number(april_unpaid_leave_days), april_paid_leave_days, notes, employee_id).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  if (action === 'set-april-closing-bulk' && method === 'POST') {
    const { rows = [] } = body;
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'rows[] required' }, 400);
    let updated = 0;
    for (const row of rows) {
      if (!row.employee_id || row.april_unpaid_leave_days === undefined) continue;
      const r = await db.prepare(`
        UPDATE hr_employees
           SET april_unpaid_leave_days = ?,
               april_paid_leave_days = ?,
               april_closing_notes = ?,
               april_closing_recorded_at = datetime('now')
         WHERE id = ?
      `).bind(
        Number(row.april_unpaid_leave_days),
        row.april_paid_leave_days ?? null,
        row.notes ?? null,
        row.employee_id,
      ).run();
      updated += r.meta?.changes || 0;
    }
    return json({ ok: true, updated });
  }

  if (action === 'april-closing-list' && method === 'GET') {
    // One row per active employee, with the april closing field + computed advances total
    const rs = await db.prepare(`
      SELECT e.id, e.pin, e.name, e.known_as, e.brand_label, e.pay_type,
             e.monthly_salary, e.daily_rate,
             e.april_unpaid_leave_days, e.april_paid_leave_days,
             e.april_closing_notes, e.april_closing_recorded_at,
             COALESCE((
               SELECT SUM(amount) FROM hr_advances a
                WHERE a.employee_id = e.id
                  AND a.advance_date BETWEEN '2026-04-01' AND '2026-04-30'
             ), 0) AS april_advances_total,
             COALESCE((
               SELECT COUNT(*) FROM hr_advances a
                WHERE a.employee_id = e.id
                  AND a.advance_date BETWEEN '2026-04-01' AND '2026-04-30'
             ), 0) AS april_advances_count
        FROM hr_employees e
       WHERE e.is_active = 1
       ORDER BY e.brand_label, e.name
    `).all();
    return json({ rows: rs.results || [] });
  }

  // ─── Compute / list / approve / mark-paid payable ───────────────────────
  if (action === 'compute-payable' && method === 'POST') {
    const { pay_period, employee_id, force } = body;
    if (!pay_period || !/^\d{4}-\d{2}$/.test(pay_period)) {
      return json({ error: 'pay_period (YYYY-MM) required' }, 400);
    }
    // Settlement-timing rule (locked 2026-05-25): leaves are classified + salary
    // settled only AFTER the month ends (May → 7 June). Computing mid-month treats
    // future days as LOP and over-deducts. Refuse a not-yet-ended period unless the
    // caller explicitly forces it.
    if (!force) {
      const { end } = monthBounds(pay_period);
      const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      if (todayIST <= end) {
        return json({
          error: `pay_period ${pay_period} has not ended yet (today IST ${todayIST}, month ends ${end}). Settlement runs after month-end — pass force:true only to override.`,
          settlement_locked: true,
          month_ends: end,
        }, 409);
      }
    }
    const targets = employee_id
      ? [{ id: employee_id }]
      : (await db.prepare(`SELECT id FROM hr_employees WHERE is_active = 1`).all()).results || [];

    const computed = [];
    for (const t of targets) {
      try {
        const c = await computePayableFor(env, t.id, pay_period);
        await snapshotPayable(env, c);
        computed.push(c);
      } catch (e) {
        computed.push({ employee_id: t.id, error: e.message });
      }
    }
    const total_payable = computed.reduce((s, c) => s + (c.net_payable || 0), 0);
    return json({
      ok: true,
      pay_period,
      count: computed.length,
      total_payable: Math.round(total_payable * 100) / 100,
      rows: computed,
    });
  }

  if (action === 'list-payable' && method === 'GET') {
    const period = url.searchParams.get('pay_period');
    if (!period) return json({ error: 'pay_period required' }, 400);
    const rs = await db.prepare(`
      SELECT s.*, e.name AS employee_name, e.known_as AS employee_known_as,
             e.brand_label, e.pin, e.phone, e.pay_type AS emp_pay_type
        FROM hr_payroll_snapshots s
        LEFT JOIN hr_employees e ON e.id = s.employee_id
       WHERE s.pay_period = ?
       ORDER BY e.brand_label, e.name
    `).bind(period).all();
    const rows = (rs.results || []).map(r => {
      const overridden = r.manual_net_override !== null && r.manual_net_override !== undefined;
      const effective_net = overridden ? Number(r.manual_net_override) : Number(r.net_payable || 0);
      return { ...r, is_overridden: overridden ? 1 : 0, effective_net: Math.round(effective_net * 100) / 100 };
    });
    // Totals use effective_net (override wins) so the settlement sheet reflects
    // what will actually be paid, not the raw computed figure.
    const totals = rows.reduce((acc, r) => {
      acc.base_pay += Number(r.base_pay || 0);
      acc.advances_total += Number(r.advances_total || 0);
      acc.unpaid_leave_deduction += Number(r.unpaid_leave_deduction || 0);
      acc.net_payable += Number(r.net_payable || 0);
      acc.effective_net += Number(r.effective_net || 0);
      acc.overridden_count += r.is_overridden ? 1 : 0;
      acc.paid += r.status === 'paid' ? Number(r.effective_net || 0) : 0;
      acc.due += r.status !== 'paid' ? Number(r.effective_net || 0) : 0;
      return acc;
    }, { base_pay: 0, advances_total: 0, unpaid_leave_deduction: 0, net_payable: 0, effective_net: 0, overridden_count: 0, paid: 0, due: 0 });
    return json({ pay_period: period, rows, totals });
  }

  if (action === 'approve-payable' && method === 'POST') {
    const { snapshot_id, pay_period, employee_id, approved_by = null } = body;
    let where = ''; let binds = [];
    if (snapshot_id) { where = 'id = ?'; binds = [snapshot_id]; }
    else if (pay_period && employee_id) { where = 'pay_period = ? AND employee_id = ?'; binds = [pay_period, employee_id]; }
    else return json({ error: 'snapshot_id OR (pay_period + employee_id) required' }, 400);
    const r = await db.prepare(`
      UPDATE hr_payroll_snapshots
         SET status = 'approved', approved_by = ?, approved_at = datetime('now')
       WHERE ${where} AND status = 'computed'
    `).bind(approved_by, ...binds).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  // ─── Manual final-amount override (Salary lane 09) ──────────────────────
  //   POST { snapshot_id | (pay_period + employee_id), override_amount, reason, by }
  //   override_amount: number → owner-typed final ₹ that wins over computed net.
  //                    null / '' → clears the override (revert to computed).
  // Computed net_payable is never mutated — the override sits beside it for audit.
  // Blocked once status = 'paid' (the payout already went out).
  if (action === 'set-override' && method === 'POST') {
    const { snapshot_id, pay_period, employee_id, override_amount, reason = null, by = null } = body;
    let where = ''; let binds = [];
    if (snapshot_id) { where = 'id = ?'; binds = [snapshot_id]; }
    else if (pay_period && employee_id) { where = 'pay_period = ? AND employee_id = ?'; binds = [pay_period, employee_id]; }
    else return json({ error: 'snapshot_id OR (pay_period + employee_id) required' }, 400);

    const clearing = override_amount === null || override_amount === undefined || override_amount === '';
    let amt = null;
    if (!clearing) {
      amt = Number(override_amount);
      if (!Number.isFinite(amt) || amt < 0) return json({ error: 'override_amount must be a non-negative number, or null to clear' }, 400);
      amt = Math.round(amt * 100) / 100;
    }
    const r = await db.prepare(`
      UPDATE hr_payroll_snapshots
         SET manual_net_override = ?, override_reason = ?, override_by = ?,
             override_at = ${clearing ? 'NULL' : "datetime('now')"}
       WHERE ${where} AND status != 'paid'
    `).bind(amt, clearing ? null : reason, clearing ? null : by, ...binds).run();
    if (!(r.meta?.changes)) return json({ error: 'no matching unpaid snapshot (compute it first, or it is already paid)' }, 404);
    return json({ ok: true, changes: r.meta.changes, cleared: clearing, override_amount: amt });
  }

  if (action === 'mark-paid' && method === 'POST') {
    const { snapshot_id, payment_reference, paid_at = null } = body;
    if (!snapshot_id || !payment_reference) {
      return json({ error: 'snapshot_id and payment_reference required' }, 400);
    }
    // Mark snapshot paid + flag advances as recovered for this period
    const snap = await db.prepare(`SELECT * FROM hr_payroll_snapshots WHERE id = ?`).bind(snapshot_id).first();
    if (!snap) return json({ error: 'snapshot not found' }, 404);
    const { start, end } = monthBounds(snap.pay_period);

    await db.prepare(`
      UPDATE hr_payroll_snapshots
         SET status = 'paid', paid_at = COALESCE(?, datetime('now')), payment_reference = ?
       WHERE id = ?
    `).bind(paid_at, payment_reference, snapshot_id).run();

    await db.prepare(`
      UPDATE hr_advances
         SET recovered = 1, recovered_in_month = ?
       WHERE employee_id = ?
         AND advance_date BETWEEN ? AND ?
         AND recovered = 0
    `).bind(snap.pay_period, snap.employee_id, start, end).run();

    return json({ ok: true });
  }

  // ─── Summary dashboard ─────────────────────────────────────────────────
  if (action === 'summary' && method === 'GET') {
    const period = url.searchParams.get('pay_period');
    const totals = await db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM hr_advances WHERE recovered = 0) AS advances_outstanding,
        (SELECT COUNT(*)                FROM hr_advances WHERE recovered = 0) AS advances_outstanding_count,
        (SELECT COALESCE(SUM(net_payable), 0) FROM hr_payroll_snapshots WHERE pay_period = ? AND status != 'paid') AS due_this_period,
        (SELECT COALESCE(SUM(net_payable), 0) FROM hr_payroll_snapshots WHERE pay_period = ? AND status = 'paid') AS paid_this_period,
        (SELECT COUNT(*)                       FROM hr_payroll_snapshots WHERE pay_period = ? AND status != 'paid') AS due_count,
        (SELECT COUNT(*)                       FROM hr_payroll_snapshots WHERE pay_period = ? AND status = 'paid') AS paid_count
    `).bind(period, period, period, period).first();
    return json({ pay_period: period, ...totals });
  }

  return json({
    error: 'Unknown action',
    valid: [
      'record-advance', 'list-advances', 'update-advance', 'delete-advance',
      'set-april-closing', 'set-april-closing-bulk', 'april-closing-list',
      'compute-payable', 'list-payable', 'approve-payable', 'mark-paid',
      'summary',
    ],
  }, 400);
}
