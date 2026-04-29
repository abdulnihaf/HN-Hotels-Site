/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/sales — Slice A read-only handler.
 *
 * Spec: docs/OPS-NCH-SALES-RECON-SPEC.md §6.1
 *
 * Slice A scope: reads only. Returns whatever is currently in the
 * mirror tables, even when the sync worker has not yet populated them
 * (renders the empty-state UI cleanly). Writes (upsert-qr, sync,
 * recompute-day) land in Slice B/C.
 *
 * Actions (all GET, all PIN-gated, all read-only in this slice):
 *   ?action=overview      — KPI tiles for the date range
 *   ?action=daily         — sales_recon_daily rows, newest first
 *   ?action=pm-breakdown  — payments grouped by payment_method_name
 *   ?action=items         — pos_lines_mirror grouped by product
 *   ?action=qr-registry   — razorpay_qr_registry + per-day sums
 *   ?action=qr-collections— razorpay_qr_collections rows
 *   ?action=sync-status   — sales_sync_state rows
 *   ?action=pos-configs   — pos_config_registry rows (for filter dropdown)
 *
 * Auth: PIN with admin/cfo/gm/asstmgr/purchase/cashier/viewer. USERS
 * table is copy-pasted from /api/cash for parity (single source of
 * truth migration is a separate refactor).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
};

const USERS = {
  '0305': { name: 'Nihaf',    role: 'admin'    },
  '5882': { name: 'Nihaf',    role: 'admin'    },
  '3754': { name: 'Naveen',   role: 'cfo'      },
  '6045': { name: 'Faheem',   role: 'asstmgr'  },
  '3678': { name: 'Faheem',   role: 'asstmgr'  },
  '8523': { name: 'Basheer',  role: 'gm'       },
  '6890': { name: 'Tanveer',  role: 'gm'       },
  '3697': { name: 'Yashwant', role: 'gm'       },
  '2026': { name: 'Zoya',     role: 'purchase' },
  '8316': { name: 'Zoya',     role: 'purchase' },
  '4040': { name: 'Haneef',   role: 'viewer'   },
  '5050': { name: 'Nisar',    role: 'viewer'   },
};
const READ_ROLES = new Set(['admin','cfo','gm','asstmgr','purchase','cashier','viewer']);
const SYNC_ROLES = new Set(['admin','cfo']);

// Slice B: dashboard "Sync now" button proxies to spend-sync-cron.
const SPEND_SYNC_URL = 'https://hn-spend-sync-cron.nihafwork.workers.dev';

const RECOGNISED_NCH_PMS = new Set([
  'NCH Cash', 'NCH UPI', 'NCH Card',
  'NCH Runner Ledger', 'NCH Token Issue',
  'Complimentary',
  // generic fallbacks observed in the snapshot:
  'Cash', 'UPI',
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function todayIST() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}
function defaultFrom() { return '2026-04-01'; }
function authedUser(pin) {
  const u = USERS[pin];
  if (!u) return null;
  return READ_ROLES.has(u.role) ? u : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!env.DB) return json({ success: false, error: 'DB not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'overview')        return await overview(url, env);
    if (action === 'daily')           return await daily(url, env);
    if (action === 'pm-breakdown')    return await pmBreakdown(url, env);
    if (action === 'items')           return await items(url, env);
    if (action === 'qr-registry')     return await qrRegistry(url, env);
    if (action === 'qr-collections')  return await qrCollections(url, env);
    if (action === 'sync-status')     return await syncStatus(url, env);
    if (action === 'pos-configs')     return await posConfigs(url, env);
    if (action === 'sync' && request.method === 'POST')             return await runSync(request, env);
    if (action === 'upsert-qr' && request.method === 'POST')        return await upsertQr(request, env);
    if (action === 'deactivate-qr' && request.method === 'POST')    return await deactivateQr(request, env);
    if (action === 'upsert-config' && request.method === 'POST')    return await upsertConfig(request, env);
    if (action === 'recompute-day' && request.method === 'POST')    return await recomputeDay(request, env);
    if (action === 'discover-qrs' && request.method === 'POST')     return await discoverQrs(request, env);
    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ READ ENDPOINTS ━━━━━━━━━━━━━━━━━━━━━━━━

// Roll-up summary across the date range. Designed to feed the 4 KPI
// tiles + the secondary-chip row of /ops/sales/. All sums come from
// sales_recon_daily — if that table is empty (pre-sync), the response
// is well-formed zeros + an 'awaiting_sync' flag the UI banners on.
async function overview(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const from = url.searchParams.get('from') || defaultFrom();
  const to   = url.searchParams.get('to')   || todayIST();
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();

  const r = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(gross_sales_paise),     0) AS gross_sales_paise,
      COALESCE(SUM(total_cash_paise),      0) AS total_cash_paise,
      COALESCE(SUM(total_upi_paise),       0) AS total_upi_paise,
      COALESCE(SUM(counter_card_paise),    0) AS total_card_paise,
      COALESCE(SUM(complimentary_paise),   0) AS complimentary_paise,
      COALESCE(SUM(counter_cash_paise),    0) AS counter_cash_paise,
      COALESCE(SUM(counter_upi_pos_paise), 0) AS counter_upi_pos_paise,
      COALESCE(SUM(counter_upi_rzp_paise), 0) AS counter_upi_rzp_paise,
      COALESCE(SUM(runner_sales_paise),    0) AS runner_sales_paise,
      COALESCE(SUM(runner_upi_paise),      0) AS runner_upi_paise,
      COALESCE(SUM(runner_cash_paise),     0) AS runner_cash_paise,
      COALESCE(SUM(unmapped_paise),        0) AS unmapped_paise,
      COALESCE(SUM(order_count),           0) AS order_count,
      COALESCE(SUM(ABS(upi_discrepancy_paise)), 0) AS abs_upi_discrepancy_paise,
      COALESCE(SUM(CASE WHEN ABS(upi_discrepancy_paise) >= 10000 THEN 1 ELSE 0 END), 0) AS red_days,
      COALESCE(SUM(CASE WHEN ABS(upi_discrepancy_paise) BETWEEN 100 AND 9999 THEN 1 ELSE 0 END), 0) AS yellow_days,
      COUNT(*) AS rows_in_range,
      MAX(last_recomputed_at) AS last_recomputed_at
    FROM sales_recon_daily
    WHERE brand = ? AND day >= ? AND day <= ?
  `).bind(brand, from, to).first();

  return json({
    success: true,
    user: user.name,
    brand,
    range: { from, to },
    awaiting_sync: (r?.rows_in_range || 0) === 0,
    last_recomputed_at: r?.last_recomputed_at || null,
    totals: {
      gross_sales_paise:     r?.gross_sales_paise     || 0,
      total_cash_paise:      r?.total_cash_paise      || 0,
      total_upi_paise:       r?.total_upi_paise       || 0,
      total_card_paise:      r?.total_card_paise      || 0,
      complimentary_paise:   r?.complimentary_paise   || 0,
      counter_cash_paise:    r?.counter_cash_paise    || 0,
      counter_upi_pos_paise: r?.counter_upi_pos_paise || 0,
      counter_upi_rzp_paise: r?.counter_upi_rzp_paise || 0,
      runner_sales_paise:    r?.runner_sales_paise    || 0,
      runner_upi_paise:      r?.runner_upi_paise      || 0,
      runner_cash_paise:     r?.runner_cash_paise     || 0,
      unmapped_paise:        r?.unmapped_paise        || 0,
      order_count:           r?.order_count           || 0,
      abs_upi_discrepancy_paise: r?.abs_upi_discrepancy_paise || 0,
      red_days:    r?.red_days    || 0,
      yellow_days: r?.yellow_days || 0,
    },
  });
}

async function daily(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const from  = url.searchParams.get('from')  || defaultFrom();
  const to    = url.searchParams.get('to')    || todayIST();
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const onlyDiscrep = url.searchParams.get('only_discrepancy') === '1';

  const r = await env.DB.prepare(`
    SELECT *
      FROM sales_recon_daily
     WHERE brand = ? AND day >= ? AND day <= ?
       ${onlyDiscrep ? 'AND ABS(upi_discrepancy_paise) >= 100' : ''}
     ORDER BY day DESC
  `).bind(brand, from, to).all();

  return json({ success: true, user: user.name, brand, range: { from, to }, rows: r.results || [] });
}

// Group payments by payment_method_name (and optionally per pos_config_id).
// This drives the PM stack chart in §3 of the dashboard.
async function pmBreakdown(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const from  = url.searchParams.get('from')  || defaultFrom();
  const to    = url.searchParams.get('to')    || todayIST();
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const cfgId = url.searchParams.get('pos_config_id');

  const cfgFilter = cfgId ? 'AND pos_config_id = ?' : '';
  const binds = [brand, from, to];
  if (cfgId) binds.push(parseInt(cfgId, 10));

  const r = await env.DB.prepare(`
    SELECT pos_config_id, payment_method_name,
           COUNT(*) AS lines,
           SUM(amount_paise) AS amount_paise
      FROM pos_payments_mirror
     WHERE brand = ? AND order_date_day >= ? AND order_date_day <= ?
       ${cfgFilter}
     GROUP BY pos_config_id, payment_method_name
     ORDER BY amount_paise DESC
  `).bind(...binds).all();

  // Flag unrecognised PMs so the UI can banner them.
  const rows = (r.results || []).map(row => ({
    ...row,
    recognised: RECOGNISED_NCH_PMS.has(row.payment_method_name),
  }));

  return json({ success: true, user: user.name, brand, range: { from, to }, pos_config_id: cfgId || null, rows });
}

async function items(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const from  = url.searchParams.get('from')  || defaultFrom();
  const to    = url.searchParams.get('to')    || todayIST();
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const cfgId = url.searchParams.get('pos_config_id');
  const search = (url.searchParams.get('search') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);

  const filters = ['brand = ?', 'order_date_day >= ?', 'order_date_day <= ?'];
  const binds = [brand, from, to];
  if (cfgId)  { filters.push('pos_config_id = ?'); binds.push(parseInt(cfgId, 10)); }
  if (search) { filters.push('product_name LIKE ?'); binds.push(`%${search}%`); }

  const r = await env.DB.prepare(`
    SELECT product_id, product_name,
           SUM(qty) AS qty,
           COUNT(DISTINCT odoo_pos_order_id) AS orders,
           SUM(price_subtotal_incl_paise) AS revenue_paise
      FROM pos_lines_mirror
     WHERE ${filters.join(' AND ')}
     GROUP BY product_id, product_name
     ORDER BY revenue_paise DESC
     LIMIT ?
  `).bind(...binds, limit).all();

  return json({ success: true, user: user.name, brand, range: { from, to }, items: r.results || [] });
}

// Registry rows + today + MTD sums attached, so the QR cards in the UI
// don't need a second round-trip.
async function qrRegistry(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const today = todayIST();
  const monthStart = today.slice(0, 7) + '-01';

  const r = await env.DB.prepare(`
    SELECT q.*,
           COALESCE((SELECT SUM(amount_paise) FROM razorpay_qr_collections c
                      WHERE c.qr_code_id = q.qr_code_id
                        AND c.captured_at_day = ?
                        AND c.status = 'captured'), 0) AS today_paise,
           COALESCE((SELECT SUM(amount_paise) FROM razorpay_qr_collections c
                      WHERE c.qr_code_id = q.qr_code_id
                        AND c.captured_at_day >= ?
                        AND c.status = 'captured'), 0) AS mtd_paise,
           (SELECT MAX(captured_at) FROM razorpay_qr_collections c
             WHERE c.qr_code_id = q.qr_code_id) AS last_capture_at
      FROM razorpay_qr_registry q
     WHERE q.brand = ?
     ORDER BY q.role, q.display_name
  `).bind(today, monthStart, brand).all();

  return json({ success: true, user: user.name, brand, qrs: r.results || [] });
}

async function qrCollections(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const from  = url.searchParams.get('from')  || defaultFrom();
  const to    = url.searchParams.get('to')    || todayIST();
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const qr    = url.searchParams.get('qr_code_id');

  const filters = ['brand = ?', 'captured_at_day >= ?', 'captured_at_day <= ?'];
  const binds = [brand, from, to];
  if (qr) { filters.push('qr_code_id = ?'); binds.push(qr); }

  const r = await env.DB.prepare(`
    SELECT razorpay_payment_id, qr_code_id, role, amount_paise, fee_paise, tax_paise,
           status, method, vpa, contact, captured_at, captured_at_day, synced_via
      FROM razorpay_qr_collections
     WHERE ${filters.join(' AND ')}
     ORDER BY captured_at DESC
     LIMIT 1000
  `).bind(...binds).all();

  return json({ success: true, user: user.name, brand, range: { from, to }, qr_code_id: qr || null, rows: r.results || [] });
}

async function syncStatus(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  const r = await env.DB.prepare(`SELECT * FROM sales_sync_state ORDER BY sync_source`).all();
  return json({ success: true, user: user.name, sources: r.results || [] });
}

async function posConfigs(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const r = await env.DB.prepare(`SELECT * FROM pos_config_registry WHERE brand = ? ORDER BY pos_config_id`).bind(brand).all();
  return json({ success: true, user: user.name, brand, configs: r.results || [] });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ SYNC PROXY ━━━━━━━━━━━━━━━━━━━━━━━━
//
// "Sync now" button in /ops/sales/ pings spend-sync-cron, which runs the
// nch-sales flows (Slice B) and reports each sub-flow's row count + error.
// admin/cfo only — same role gate /api/cash uses.

async function runSync(request, env) {
  let pin, force;
  try {
    const body = await request.json();
    pin = body.pin; force = !!body.force;
  } catch {
    pin = new URL(request.url).searchParams.get('pin');
    force = new URL(request.url).searchParams.get('force') === '1';
  }
  const u = USERS[pin];
  if (!u || !SYNC_ROLES.has(u.role)) {
    return json({ success: false, error: 'admin/cfo only' }, 401);
  }
  if (!env.DASHBOARD_KEY) {
    return json({ success: false, error: 'DASHBOARD_KEY not set on this Pages project' }, 500);
  }
  const url = `${SPEND_SYNC_URL}/?key=${encodeURIComponent(env.DASHBOARD_KEY)}&instance=nch-sales${force ? '&force=1' : ''}`;
  const r = await fetch(url);
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = { raw: txt.slice(0, 1000) }; }
  return json({ success: r.ok, ran_by: u.name, status: r.status, result: body });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ WRITE ENDPOINTS — Slice C ━━━━━━━━━━━━━━━━━━━━━━━━

// QR registry CRUD. Stored in razorpay_qr_registry; this is the editable
// surface so runner attrition does not require a redeploy. PIN-gated to
// admin/cfo because mis-attribution silently corrupts the daily recon.
async function upsertQr(request, env) {
  const body = await request.json();
  const u = USERS[body.pin];
  if (!u || !SYNC_ROLES.has(u.role)) return json({ success: false, error: 'admin/cfo only' }, 401);

  const qr = String(body.qr_code_id || '').trim();
  const brand = String(body.brand || 'NCH').toUpperCase();
  const role = String(body.role || '').toLowerCase();
  const display = String(body.display_name || '').trim();
  const runnerName = body.runner_name ? String(body.runner_name).trim() : null;
  const runnerPin = body.runner_pin ? String(body.runner_pin).trim() : null;
  const active = body.active === false ? 0 : 1;
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  if (!/^qr_[A-Za-z0-9]+$/.test(qr)) {
    return json({ success: false, error: `qr_code_id must look like 'qr_XXXX' (got: ${qr})` }, 400);
  }
  if (brand !== 'NCH' && brand !== 'HE') return json({ success: false, error: 'brand must be NCH or HE' }, 400);
  if (role !== 'counter' && role !== 'runner') return json({ success: false, error: "role must be 'counter' or 'runner'" }, 400);
  if (display.length < 2) return json({ success: false, error: 'display_name required (≥ 2 chars)' }, 400);
  if (role === 'runner' && !runnerName) return json({ success: false, error: 'runner_name required for role=runner' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO razorpay_qr_registry
         (qr_code_id, brand, role, runner_name, runner_pin, display_name, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(qr_code_id) DO UPDATE SET
         brand=excluded.brand,
         role=excluded.role,
         runner_name=excluded.runner_name,
         runner_pin=excluded.runner_pin,
         display_name=excluded.display_name,
         active=excluded.active,
         notes=excluded.notes,
         deactivated_at = CASE WHEN excluded.active = 0 AND razorpay_qr_registry.active = 1
                               THEN ? ELSE razorpay_qr_registry.deactivated_at END`
    ).bind(qr, brand, role, runnerName, runnerPin, display, active, notes, new Date().toISOString()).run();
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
  return json({ success: true, qr_code_id: qr, brand, role, display_name: display, active, recorded_by: u.name });
}

async function deactivateQr(request, env) {
  const body = await request.json();
  const u = USERS[body.pin];
  if (!u || !SYNC_ROLES.has(u.role)) return json({ success: false, error: 'admin/cfo only' }, 401);
  const qr = String(body.qr_code_id || '').trim();
  if (!qr) return json({ success: false, error: 'qr_code_id required' }, 400);
  await env.DB.prepare(
    `UPDATE razorpay_qr_registry SET active = 0, deactivated_at = ? WHERE qr_code_id = ?`
  ).bind(new Date().toISOString(), qr).run();
  return json({ success: true, qr_code_id: qr, recorded_by: u.name });
}

// pos.config label / station_kind editor. Names auto-flow from Odoo on
// the daily refresh; the OWNER's label + kind is what the dashboard
// renders ("Counter POS" / "Runner POS" / "Token POS").
async function upsertConfig(request, env) {
  const body = await request.json();
  const u = USERS[body.pin];
  if (!u || !SYNC_ROLES.has(u.role)) return json({ success: false, error: 'admin/cfo only' }, 401);

  const cfgId = parseInt(body.pos_config_id, 10);
  if (!Number.isFinite(cfgId) || cfgId <= 0) return json({ success: false, error: 'pos_config_id required (positive int)' }, 400);
  const label = body.label ? String(body.label).slice(0, 80) : null;
  const kind = body.station_kind ? String(body.station_kind).toLowerCase() : null;
  if (kind && !['counter','runner','token','delivery','other'].includes(kind)) {
    return json({ success: false, error: 'station_kind must be one of counter|runner|token|delivery|other' }, 400);
  }
  const r = await env.DB.prepare(
    `UPDATE pos_config_registry SET label = ?, station_kind = ? WHERE pos_config_id = ?`
  ).bind(label, kind, cfgId).run();
  if (!r.meta?.changes) return json({ success: false, error: `pos_config_id ${cfgId} not in registry — wait for next sync` }, 404);
  return json({ success: true, pos_config_id: cfgId, label, station_kind: kind, recorded_by: u.name });
}

// Force-refresh sales_recon_daily for one day. Runs the same in-Worker
// computeReconDay logic — except the Function calls a SQL replica of
// the math. Cleaner: we issue a small compute right here.
async function recomputeDay(request, env) {
  const body = await request.json();
  const u = USERS[body.pin];
  if (!u || !SYNC_ROLES.has(u.role)) return json({ success: false, error: 'admin/cfo only' }, 401);
  const day = String(body.day || '').trim();
  const brand = String(body.brand || 'NCH').toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ success: false, error: 'day required (YYYY-MM-DD)' }, 400);

  const pmRows = (await env.DB.prepare(
    `SELECT payment_method_name, SUM(amount_paise) AS p FROM pos_payments_mirror
      WHERE brand = ? AND order_date_day = ? GROUP BY payment_method_name`
  ).bind(brand, day).all()).results || [];
  const qrRows = (await env.DB.prepare(
    `SELECT role, SUM(amount_paise) AS p FROM razorpay_qr_collections
      WHERE brand = ? AND captured_at_day = ? AND status = 'captured' GROUP BY role`
  ).bind(brand, day).all()).results || [];
  const ord = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') NOT LIKE '%Complimentary%'
                              THEN amount_total_paise ELSE 0 END), 0) AS gross,
            COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') LIKE '%Complimentary%'
                              THEN amount_total_paise ELSE 0 END), 0) AS comp
       FROM pos_orders_mirror WHERE brand = ? AND order_date_day = ?`
  ).bind(brand, day).first();

  const pm = (n) => pmRows.find(r => r.payment_method_name === n)?.p || 0;
  const qr = (r) => qrRows.find(x => x.role === r)?.p || 0;
  let unmapped = 0;
  for (const r of pmRows) if (!RECOGNISED_NCH_PMS.has(r.payment_method_name)) unmapped += r.p || 0;

  const counter_cash    = pm('NCH Cash') + pm('Cash');
  const counter_upi_pos = pm('NCH UPI')  + pm('UPI');
  const counter_upi_rzp = qr('counter');
  const counter_card    = pm('NCH Card');
  const runner_sales    = pm('NCH Runner Ledger') + pm('NCH Token Issue');
  const runner_upi      = qr('runner');
  const runner_cash     = Math.max(0, runner_sales - runner_upi);
  const total_cash      = counter_cash + runner_cash;
  const total_upi       = counter_upi_rzp + runner_upi;
  const upi_discrepancy = counter_upi_pos - counter_upi_rzp;

  await env.DB.prepare(
    `INSERT INTO sales_recon_daily (
       brand, day, gross_sales_paise,
       counter_cash_paise, counter_upi_pos_paise, counter_upi_rzp_paise, counter_card_paise,
       runner_sales_paise, runner_upi_paise, runner_cash_paise,
       total_cash_paise, total_upi_paise, upi_discrepancy_paise,
       complimentary_paise, unmapped_paise, order_count, last_recomputed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(brand, day) DO UPDATE SET
       gross_sales_paise=excluded.gross_sales_paise,
       counter_cash_paise=excluded.counter_cash_paise,
       counter_upi_pos_paise=excluded.counter_upi_pos_paise,
       counter_upi_rzp_paise=excluded.counter_upi_rzp_paise,
       counter_card_paise=excluded.counter_card_paise,
       runner_sales_paise=excluded.runner_sales_paise,
       runner_upi_paise=excluded.runner_upi_paise,
       runner_cash_paise=excluded.runner_cash_paise,
       total_cash_paise=excluded.total_cash_paise,
       total_upi_paise=excluded.total_upi_paise,
       upi_discrepancy_paise=excluded.upi_discrepancy_paise,
       complimentary_paise=excluded.complimentary_paise,
       unmapped_paise=excluded.unmapped_paise,
       order_count=excluded.order_count,
       last_recomputed_at=excluded.last_recomputed_at`
  ).bind(
    brand, day, ord?.gross || 0,
    counter_cash, counter_upi_pos, counter_upi_rzp, counter_card,
    runner_sales, runner_upi, runner_cash,
    total_cash, total_upi, upi_discrepancy,
    ord?.comp || 0, unmapped, ord?.n || 0,
    new Date().toISOString()
  ).run();

  return json({
    success: true, brand, day, recorded_by: u.name,
    computed: {
      gross_sales_paise: ord?.gross || 0,
      total_cash_paise: total_cash,
      total_upi_paise:  total_upi,
      counter_card_paise: counter_card,
      upi_discrepancy_paise: upi_discrepancy,
      unmapped_paise: unmapped,
      order_count: ord?.n || 0,
    },
  });
}

// Discover NCH Razorpay QRs autonomously instead of 6× "+ Add QR" clicks.
// Calls Razorpay GET /v1/qr_codes (the merchant's QR list), classifies each
// by name pattern, and bulk-upserts into razorpay_qr_registry with sensible
// defaults that the owner can refine via the existing edit sheet if needed.
//
// Classification rules (in order):
//   1. name contains "counter"  → role=counter
//   2. name contains "runner"   → role=runner; runner_name = words after "runner"
//   3. name matches a known NCH runner (Nafees / Kesmat / Mujib / Dhanush) → role=runner
//   4. fallback → role=runner with notes="auto-classified, needs review"
//
// Returns a {discovered, registered, skipped} report so the UI can render
// a one-shot result panel. Idempotent — re-running updates display_name +
// notes from Razorpay-side changes; runner_pin/runner_name preserved on
// rows the owner has already curated (NULLs only get filled, non-NULL
// values are kept).
async function discoverQrs(request, env) {
  let pin;
  try { pin = (await request.json()).pin; } catch { pin = new URL(request.url).searchParams.get('pin'); }
  const u = USERS[pin];
  if (!u || !SYNC_ROLES.has(u.role)) return json({ success: false, error: 'admin/cfo only' }, 401);
  if (!env.RAZORPAY_KEY || !env.RAZORPAY_SECRET) {
    return json({
      success: false,
      error: 'RAZORPAY_KEY / RAZORPAY_SECRET not set on this Pages project. Run: wrangler pages secret put RAZORPAY_KEY --project-name hn-hotels-site (value from HN-Hotels-Asset-Database.xlsx row 73), then RAZORPAY_SECRET (row 74).',
    }, 503);
  }

  const auth = 'Basic ' + btoa(`${env.RAZORPAY_KEY}:${env.RAZORPAY_SECRET}`);
  const r = await fetch('https://api.razorpay.com/v1/qr_codes?count=100', { headers: { Authorization: auth } });
  if (!r.ok) {
    const t = await r.text();
    return json({ success: false, error: `Razorpay HTTP ${r.status}: ${t.slice(0, 300)}` }, 502);
  }
  const j = await r.json();
  const items = j.items || [];

  const KNOWN_RUNNERS = ['nafees', 'kesmat', 'mujib', 'dhanush', 'kismat', 'nafeez'];
  const classify = (name) => {
    const lc = String(name || '').toLowerCase();
    if (lc.includes('counter')) return { role: 'counter', runner_name: null };
    const m = lc.match(/runner[\s\-_:]+([a-z]+)/);
    if (m) return { role: 'runner', runner_name: m[1].replace(/\b\w/g, c => c.toUpperCase()) };
    for (const r of KNOWN_RUNNERS) {
      if (lc.includes(r)) return { role: 'runner', runner_name: r.replace(/\b\w/g, c => c.toUpperCase()) };
    }
    return { role: 'runner', runner_name: null, needs_review: true };
  };

  const report = { discovered: items.length, registered: 0, skipped: 0, rows: [] };
  for (const it of items) {
    const cls = classify(it.name);
    const display = String(it.name || it.id).slice(0, 80);
    const noteParts = [];
    if (it.description) noteParts.push(`desc: ${String(it.description).slice(0, 80)}`);
    if (cls.needs_review) noteParts.push('auto-classified — review role/runner_name');
    if (it.usage) noteParts.push(`usage=${it.usage}`);
    const notes = noteParts.join(' · ').slice(0, 500) || null;

    try {
      // Preserve existing curated runner_name / runner_pin (only fill NULLs).
      await env.DB.prepare(
        `INSERT INTO razorpay_qr_registry
           (qr_code_id, brand, role, runner_name, runner_pin, display_name, active, notes)
         VALUES (?, 'NCH', ?, ?, NULL, ?, 1, ?)
         ON CONFLICT(qr_code_id) DO UPDATE SET
           role = CASE WHEN razorpay_qr_registry.role IN ('counter','runner')
                       THEN razorpay_qr_registry.role
                       ELSE excluded.role END,
           runner_name = COALESCE(razorpay_qr_registry.runner_name, excluded.runner_name),
           display_name = excluded.display_name,
           notes = excluded.notes`
      ).bind(it.id, cls.role, cls.runner_name, display, notes).run();
      report.registered++;
      report.rows.push({ qr_code_id: it.id, name: it.name, role: cls.role, runner_name: cls.runner_name, needs_review: !!cls.needs_review });
    } catch (e) {
      report.skipped++;
      report.rows.push({ qr_code_id: it.id, error: e.message });
    }
  }
  return json({ success: true, recorded_by: u.name, ...report });
}
