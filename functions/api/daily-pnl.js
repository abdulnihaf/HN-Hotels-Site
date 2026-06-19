/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/daily-pnl — settlement-gated daily operating P&L.
 *
 * This is a read-and-freeze layer. It does not replace Sauda, Anbar,
 * Takht/Sales, Darbar, or Bills. It consumes their facts and refuses to
 * finalize a day until the required gates are present.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
};

const USERS = {
  '0305': { name: 'Nihaf', role: 'admin', canFinalize: true },
  '5882': { name: 'Nihaf', role: 'admin', canFinalize: true },
  '3754': { name: 'Naveen', role: 'cfo', canFinalize: true },
  '6045': { name: 'Faheem', role: 'asstmgr', canFinalize: true },
  '3678': { name: 'Faheem', role: 'asstmgr', canFinalize: true },
  '8523': { name: 'Basheer', role: 'gm', canFinalize: false },
  '6890': { name: 'Tanveer', role: 'gm', canFinalize: false },
  '3697': { name: 'Yashwant', role: 'gm', canFinalize: false },
  '2026': { name: 'Zoya', role: 'purchase', canFinalize: false },
  '8316': { name: 'Zoya', role: 'purchase', canFinalize: false },
};

const BRAND_LABELS = {
  HE: 'Hamza Express',
  NCH: 'Nawabi Chai House',
};

const HARD_GATES = ['revenue', 'anbar_settlement', 'labor', 'major_bills'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function brandFrom(v) {
  const b = String(v || 'HE').toUpperCase();
  return b === 'NCH' ? 'NCH' : 'HE';
}

function pinFrom(request, url, body = null) {
  return request.headers.get('X-Ops-Pin') || url.searchParams.get('pin') || body?.pin || '';
}

function userFrom(pin) {
  return USERS[String(pin || '')] || null;
}

function toInt(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function rupeesToPaise(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function paiseFromEither(body, paiseKey, rupeeKey) {
  if (body[paiseKey] !== undefined && body[paiseKey] !== null && body[paiseKey] !== '') return toInt(body[paiseKey]);
  if (body[rupeeKey] !== undefined && body[rupeeKey] !== null && body[rupeeKey] !== '') return rupeesToPaise(body[rupeeKey]);
  return 0;
}

function safeParse(raw, fallback = null) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

function inclusiveDays(start, end) {
  if (!isYmd(start) || !isYmd(end)) return 1;
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86400000) + 1;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function qFirst(DB, sql, ...binds) {
  try { return await DB.prepare(sql).bind(...binds).first(); }
  catch (e) { return { __error: e.message }; }
}

async function qAll(DB, sql, ...binds) {
  try { return (await DB.prepare(sql).bind(...binds).all()).results || []; }
  catch (e) { return { __error: e.message, results: [] }; }
}

async function ensureSchema(DB) {
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS daily_pnl_overheads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL CHECK (brand IN ('HE','NCH','BOTH')),
      label TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'major_bill',
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      brand_share_bp INTEGER NOT NULL DEFAULT 10000,
      vendor_name TEXT,
      source_ref TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_pnl_overheads_brand_period
      ON daily_pnl_overheads(brand, period_start, period_end, active)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS daily_pnl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL CHECK (brand IN ('HE','NCH')),
      business_date TEXT NOT NULL,
      run_status TEXT NOT NULL CHECK (run_status IN ('blocked','draft','final')),
      source_hash TEXT NOT NULL,
      inputs_json TEXT NOT NULL,
      pnl_json TEXT NOT NULL,
      gates_json TEXT NOT NULL,
      revenue_paise INTEGER,
      raw_cogs_paise INTEGER,
      gross_food_profit_paise INTEGER,
      gross_food_margin_bp INTEGER,
      labor_paise INTEGER,
      major_bills_paise INTEGER,
      operating_profit_paise INTEGER,
      operating_margin_bp INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finalized_at TEXT,
      is_current INTEGER NOT NULL DEFAULT 1,
      replaces_run_id INTEGER
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_pnl_runs_brand_day
      ON daily_pnl_runs(brand, business_date, is_current)`),
  ]);
}

async function revenueSource(DB, brand, date) {
  const row = await qFirst(DB, `SELECT * FROM sales_recon_daily WHERE brand=? AND day=?`, brand, date);
  if (row?.__error) return { ok: false, reason: row.__error, revenue_paise: null, source: null };
  if (!row) {
    const latest = await qFirst(DB, `SELECT MAX(day) AS latest_day FROM sales_recon_daily WHERE brand=?`, brand);
    return {
      ok: false,
      reason: latest?.latest_day ? `sales mirror latest is ${latest.latest_day}` : 'sales mirror has no rows',
      revenue_paise: null,
      source: { latest_day: latest?.latest_day || null },
    };
  }
  return {
    ok: true,
    revenue_paise: toInt(row.gross_sales_paise),
    source: {
      table: 'sales_recon_daily',
      brand,
      day: date,
      last_recomputed_at: row.last_recomputed_at,
      order_count: toInt(row.order_count),
      cash_paise: toInt(row.total_cash_paise),
      upi_paise: toInt(row.total_upi_paise),
      card_paise: toInt(row.counter_card_paise),
      complimentary_paise: toInt(row.complimentary_paise),
    },
  };
}

async function anbarSource(DB, brand, date) {
  const row = await qFirst(DB, `
    SELECT * FROM rm_settlements
     WHERE brand=? AND settlement_date=? AND status IN ('completed','final')
     ORDER BY settled_at DESC, id DESC LIMIT 1
  `, brand, date);
  const witnesses = await anbarWitnesses(DB, brand, date);
  if (row?.__error) return { ok: false, reason: row.__error, raw_cogs_paise: null, source: { witnesses } };
  if (!row) {
    const latest = await qFirst(DB, `SELECT MAX(settlement_date) AS latest_day FROM rm_settlements WHERE brand=?`, brand);
    return {
      ok: false,
      reason: latest?.latest_day ? `latest Anbar settlement is ${latest.latest_day}` : 'no Anbar settlement found',
      raw_cogs_paise: null,
      source: { latest_day: latest?.latest_day || null, witnesses },
    };
  }

  const cost = safeParse(row.cost_summary, {});
  const totalRupees = Number(cost?.total || 0);
  return {
    ok: true,
    raw_cogs_paise: rupeesToPaise(totalRupees),
    source: {
      table: 'rm_settlements',
      id: row.id,
      brand,
      settlement_date: row.settlement_date,
      settled_at: row.settled_at,
      settled_by: row.settled_by,
      period_start: row.period_start,
      period_end: row.period_end,
      cost_summary: cost || {},
      witnesses,
    },
  };
}

async function anbarWitnesses(DB, brand, date) {
  const receipts = await qFirst(DB, `
    SELECT COUNT(*) AS rows, COALESCE(SUM(qty),0) AS qty
      FROM rm_outlet_receipts
     WHERE UPPER(brand)=? AND substr(received_at,1,10)=?
  `, brand, date);
  const sauda = await qFirst(DB, `
    SELECT COUNT(*) AS rows,
           COALESCE(SUM(COALESCE(expected_amount_paise, pay_amount_paise, 0)),0) AS amount_paise
      FROM sauda_purchase
     WHERE UPPER(brand)=? AND for_date=? AND COALESCE(status,'') != 'CANCELLED'
  `, brand, date);
  const saudaBoth = await qFirst(DB, `
    SELECT COUNT(*) AS rows,
           COALESCE(SUM(COALESCE(expected_amount_paise, pay_amount_paise, 0)),0) AS amount_paise
      FROM sauda_purchase
     WHERE LOWER(brand)='both' AND for_date=? AND COALESCE(status,'') != 'CANCELLED'
  `, date);
  const chicken = await qFirst(DB, `
    SELECT COUNT(*) AS rows,
           COALESCE(SUM(cost_paise),0) AS cost_paise,
           COALESCE(SUM(purchased_kg),0) AS usable_kg,
           COALESCE(SUM(delivered_kg),0) AS delivered_kg
      FROM chicken_daily_ledger
     WHERE UPPER(brand)=? AND business_date=?
  `, brand, date);
  return {
    receipts: receipts?.__error ? { error: receipts.__error } : { rows: receipts?.rows || 0, qty: receipts?.qty || 0 },
    sauda_purchase: sauda?.__error ? { error: sauda.__error } : { rows: sauda?.rows || 0, amount_paise: toInt(sauda?.amount_paise) },
    sauda_both_purchase: saudaBoth?.__error ? { error: saudaBoth.__error } : { rows: saudaBoth?.rows || 0, amount_paise: toInt(saudaBoth?.amount_paise) },
    chicken_daily_ledger: chicken?.__error ? { error: chicken.__error } : {
      rows: chicken?.rows || 0,
      cost_paise: toInt(chicken?.cost_paise),
      usable_kg: Number(chicken?.usable_kg || 0),
      delivered_kg: Number(chicken?.delivered_kg || 0),
    },
  };
}

async function laborSource(DB, brand, date) {
  const rows = await qAll(DB, `
    SELECT e.*, a.status AS attendance_status, a.total_hours, a.punch_count
      FROM hr_employees e
      LEFT JOIN hr_attendance_daily a ON a.employee_id=e.id AND a.date=?
     WHERE e.brand_label=? AND e.is_active=1
       AND (e.start_date IS NULL OR e.start_date <= ?)
     ORDER BY e.name
  `, date, brand, date);
  if (rows?.__error) return { ok: false, reason: rows.__error, labor_paise: null, source: null };
  if (!rows.length) return { ok: false, reason: 'no active Darbar roster rows', labor_paise: null, source: null };

  const staff = rows.map(r => {
    const name = String(r.name || '');
    const owner = /nihaf/i.test(name);
    const dailyRupees = owner ? 0 : Number(r.daily_rate || 0) > 0 ? Number(r.daily_rate) : Number(r.monthly_salary || 0) / 30;
    return {
      id: r.id,
      pin: r.pin,
      name,
      pay_type: r.pay_type,
      monthly_salary: Number(r.monthly_salary || 0),
      daily_rate: Number(r.daily_rate || 0),
      daily_cost_paise: rupeesToPaise(dailyRupees),
      attendance_status: r.attendance_status || null,
      total_hours: r.total_hours ?? null,
      punch_count: r.punch_count ?? null,
      presence_confirmed: r.presence_confirmed === undefined ? null : Number(r.presence_confirmed || 0),
    };
  });
  return {
    ok: true,
    labor_paise: staff.reduce((sum, r) => sum + r.daily_cost_paise, 0),
    source: {
      table: 'hr_employees',
      method: 'active roster accrual; daily_rate else monthly_salary/30; owner salary zero',
      active_staff: staff.length,
      staff,
    },
  };
}

async function overheadSource(DB, brand, date) {
  const rows = await qAll(DB, `
    SELECT * FROM daily_pnl_overheads
     WHERE active=1
       AND (brand=? OR brand='BOTH')
       AND period_start <= ? AND period_end >= ?
     ORDER BY category, label, id
  `, brand, date, date);
  if (rows?.__error) return { ok: false, reason: rows.__error, major_bills_paise: null, source: null };
  if (!rows.length) {
    return { ok: false, reason: 'no electricity/major bill allocation entered', major_bills_paise: null, source: { rows: [] } };
  }
  const allocations = rows.map(r => {
    const days = inclusiveDays(r.period_start, r.period_end);
    const share = Math.max(0, Math.min(10000, Number(r.brand_share_bp || (r.brand === 'BOTH' ? 5000 : 10000))));
    const allocated = Math.round((Number(r.amount_paise || 0) * share / 10000) / days);
    return {
      id: r.id,
      brand: r.brand,
      label: r.label,
      category: r.category,
      amount_paise: toInt(r.amount_paise),
      period_start: r.period_start,
      period_end: r.period_end,
      days,
      brand_share_bp: share,
      daily_allocated_paise: allocated,
      vendor_name: r.vendor_name || '',
      source_ref: r.source_ref || '',
      notes: r.notes || '',
    };
  });
  return {
    ok: true,
    major_bills_paise: allocations.reduce((sum, r) => sum + r.daily_allocated_paise, 0),
    source: { table: 'daily_pnl_overheads', allocations },
  };
}

function marginBp(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000);
}

async function buildSnapshot(DB, brand, date) {
  await ensureSchema(DB);
  const [revenue, anbar, labor, overhead] = await Promise.all([
    revenueSource(DB, brand, date),
    anbarSource(DB, brand, date),
    laborSource(DB, brand, date),
    overheadSource(DB, brand, date),
  ]);

  const gates = {
    revenue: { ok: !!revenue.ok, reason: revenue.ok ? null : revenue.reason },
    anbar_settlement: { ok: !!anbar.ok, reason: anbar.ok ? null : anbar.reason },
    labor: { ok: !!labor.ok, reason: labor.ok ? null : labor.reason },
    major_bills: { ok: !!overhead.ok, reason: overhead.ok ? null : overhead.reason },
  };
  const missing = HARD_GATES.filter(k => !gates[k].ok);

  const revenuePaise = revenue.revenue_paise;
  const rawCogsPaise = anbar.raw_cogs_paise;
  const laborPaise = labor.labor_paise;
  const majorBillsPaise = overhead.major_bills_paise;
  const grossFoodProfitPaise = revenue.ok && anbar.ok ? revenuePaise - rawCogsPaise : null;
  const operatingProfitPaise = grossFoodProfitPaise !== null && labor.ok && overhead.ok
    ? grossFoodProfitPaise - laborPaise - majorBillsPaise
    : null;

  const pnl = {
    revenue_paise: revenue.ok ? revenuePaise : null,
    raw_cogs_paise: anbar.ok ? rawCogsPaise : null,
    gross_food_profit_paise: grossFoodProfitPaise,
    gross_food_margin_bp: grossFoodProfitPaise === null ? null : marginBp(grossFoodProfitPaise, revenuePaise),
    labor_paise: labor.ok ? laborPaise : null,
    major_bills_paise: overhead.ok ? majorBillsPaise : null,
    operating_profit_paise: operatingProfitPaise,
    operating_margin_bp: operatingProfitPaise === null ? null : marginBp(operatingProfitPaise, revenuePaise),
  };

  const inputs = {
    brand,
    brand_label: BRAND_LABELS[brand],
    business_date: date,
    revenue: revenue.source,
    anbar: anbar.source,
    labor: labor.source,
    overhead: overhead.source,
  };
  const sourceHash = await sha256Hex(JSON.stringify({ brand, date, pnl, gates, inputs }));
  const finalRun = await currentFinalRun(DB, brand, date);
  const finalSourceChanged = finalRun ? finalRun.source_hash !== sourceHash : false;
  const status = missing.length ? 'blocked' : finalRun && !finalSourceChanged ? 'final' : 'draft';

  return {
    success: true,
    brand,
    brand_label: BRAND_LABELS[brand],
    business_date: date,
    status,
    missing_gates: missing,
    gates,
    pnl,
    inputs,
    source_hash: sourceHash,
    final_run: finalRun,
    final_source_changed: finalSourceChanged,
  };
}

async function currentFinalRun(DB, brand, date) {
  const row = await qFirst(DB, `
    SELECT id, brand, business_date, run_status, source_hash, pnl_json, gates_json,
           created_by, created_at, finalized_at
      FROM daily_pnl_runs
     WHERE brand=? AND business_date=? AND is_current=1 AND run_status='final'
     ORDER BY id DESC LIMIT 1
  `, brand, date);
  if (!row || row.__error) return null;
  return {
    id: row.id,
    brand: row.brand,
    business_date: row.business_date,
    source_hash: row.source_hash,
    pnl: safeParse(row.pnl_json, {}),
    gates: safeParse(row.gates_json, {}),
    created_by: row.created_by,
    created_at: row.created_at,
    finalized_at: row.finalized_at,
  };
}

async function finalizeRun(DB, request, url) {
  const body = await request.json().catch(() => ({}));
  const user = userFrom(pinFrom(request, url, body));
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  if (!user.canFinalize) return json({ success: false, error: 'Finalization requires owner/CFO/asst manager PIN' }, 403);

  const brand = brandFrom(body.brand || url.searchParams.get('brand'));
  const date = body.business_date || body.date || url.searchParams.get('date') || todayIST();
  if (!isYmd(date)) return json({ success: false, error: 'business date invalid' }, 400);

  const snap = await buildSnapshot(DB, brand, date);
  if (snap.status === 'blocked') {
    await insertRun(DB, snap, user, 'blocked', null);
    return json({ ...snap, success: false, error: 'P&L blocked by missing gates' }, 409);
  }

  const existing = snap.final_run;
  const force = body.force === true || body.force === 1 || body.force === '1';
  if (existing && existing.source_hash === snap.source_hash) {
    return json({ success: true, idempotent: true, run: existing, snapshot: snap });
  }
  if (existing && !force) {
    return json({
      success: false,
      error: 'Existing final P&L has different source inputs. Re-finalize with force only after reviewing changed sources.',
      existing,
      current_source_hash: snap.source_hash,
      snapshot: snap,
    }, 409);
  }

  if (existing && force) {
    await DB.prepare(`UPDATE daily_pnl_runs SET is_current=0 WHERE id=?`).bind(existing.id).run();
  }
  const inserted = await insertRun(DB, snap, user, 'final', existing?.id || null);
  return json({ success: true, finalized: true, run_id: inserted.meta.last_row_id, snapshot: snap });
}

async function insertRun(DB, snap, user, status, replacesId) {
  const p = snap.pnl;
  return await DB.prepare(`
    INSERT INTO daily_pnl_runs
      (brand, business_date, run_status, source_hash, inputs_json, pnl_json, gates_json,
       revenue_paise, raw_cogs_paise, gross_food_profit_paise, gross_food_margin_bp,
       labor_paise, major_bills_paise, operating_profit_paise, operating_margin_bp,
       created_by, finalized_at, is_current, replaces_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    snap.brand,
    snap.business_date,
    status,
    snap.source_hash,
    JSON.stringify(snap.inputs),
    JSON.stringify(snap.pnl),
    JSON.stringify(snap.gates),
    p.revenue_paise,
    p.raw_cogs_paise,
    p.gross_food_profit_paise,
    p.gross_food_margin_bp,
    p.labor_paise,
    p.major_bills_paise,
    p.operating_profit_paise,
    p.operating_margin_bp,
    user.name,
    status === 'final' ? new Date().toISOString() : null,
    replacesId
  ).run();
}

async function upsertOverhead(DB, request, url) {
  const body = await request.json().catch(() => ({}));
  const user = userFrom(pinFrom(request, url, body));
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  if (!user.canFinalize) return json({ success: false, error: 'Bill allocation requires owner/CFO/asst manager PIN' }, 403);

  await ensureSchema(DB);
  const id = Number(body.id || 0);
  const brand = String(body.brand || 'HE').toUpperCase() === 'BOTH' ? 'BOTH' : brandFrom(body.brand);
  const label = String(body.label || '').trim();
  const amountPaise = paiseFromEither(body, 'amount_paise', 'amount');
  const periodStart = body.period_start;
  const periodEnd = body.period_end || body.period_start;
  const share = Number(body.brand_share_bp || (brand === 'BOTH' ? 5000 : 10000));
  if (!label) return json({ success: false, error: 'label required' }, 400);
  if (!(amountPaise > 0)) return json({ success: false, error: 'amount required' }, 400);
  if (!isYmd(periodStart) || !isYmd(periodEnd)) return json({ success: false, error: 'period dates invalid' }, 400);

  if (id) {
    await DB.prepare(`
      UPDATE daily_pnl_overheads
         SET brand=?, label=?, category=?, amount_paise=?, period_start=?, period_end=?,
             brand_share_bp=?, vendor_name=?, source_ref=?, notes=?, active=?, updated_at=datetime('now')
       WHERE id=?
    `).bind(
      brand, label, body.category || 'major_bill', amountPaise, periodStart, periodEnd,
      Math.max(0, Math.min(10000, share || 0)), body.vendor_name || '', body.source_ref || '',
      body.notes || '', body.active === 0 ? 0 : 1, id
    ).run();
    return json({ success: true, id, updated: true });
  }

  const r = await DB.prepare(`
    INSERT INTO daily_pnl_overheads
      (brand, label, category, amount_paise, period_start, period_end, brand_share_bp,
       vendor_name, source_ref, notes, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    brand, label, body.category || 'major_bill', amountPaise, periodStart, periodEnd,
    Math.max(0, Math.min(10000, share || 0)), body.vendor_name || '', body.source_ref || '',
    body.notes || '', user.name
  ).run();
  return json({ success: true, id: r.meta.last_row_id, created: true });
}

async function listOverheads(DB, request, url) {
  const user = userFrom(pinFrom(request, url));
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  await ensureSchema(DB);
  const brand = brandFrom(url.searchParams.get('brand'));
  const date = url.searchParams.get('date') || todayIST();
  const rows = await qAll(DB, `
    SELECT * FROM daily_pnl_overheads
     WHERE active=1 AND (brand=? OR brand='BOTH')
       AND period_start <= ? AND period_end >= ?
     ORDER BY period_start DESC, label
  `, brand, date, date);
  return json({ success: true, brand, date, overheads: rows?.__error ? [] : rows, error: rows?.__error || null });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!env.DB) return json({ success: false, error: 'DB not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'summary';

  try {
    if (action === 'summary') {
      const user = userFrom(pinFrom(request, url));
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const brand = brandFrom(url.searchParams.get('brand'));
      const date = url.searchParams.get('date') || todayIST();
      if (!isYmd(date)) return json({ success: false, error: 'date invalid' }, 400);
      return json({ ...(await buildSnapshot(env.DB, brand, date)), user: { name: user.name, role: user.role } });
    }
    if (action === 'overheads') return await listOverheads(env.DB, request, url);
    if (action === 'upsert-overhead' && request.method === 'POST') return await upsertOverhead(env.DB, request, url);
    if (action === 'finalize' && request.method === 'POST') return await finalizeRun(env.DB, request, url);
    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}
