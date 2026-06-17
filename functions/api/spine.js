/* ═══════════════════════════════════════════════════════════════════════════
 * SPINE — HN Hotels Operational Intelligence Endpoint  (read-only)
 * Route:  /api/spine
 *
 * WHY THIS EXISTS
 * ---------------
 * Nihaf runs marketing/ops strategy from a cloud chat (claude.ai) that cannot
 * reach our private domains, and keeps Claude Code (laptop, 24/7) strictly as an
 * EXECUTION engine. SPINE is the read-only "informational engine": one
 * authenticated HTTP surface that serves queryable JSON business context so the
 * cloud chat can answer questions like "what's the business from X to Y", "is it
 * UPI", "who was present on day D" — without any execution or write power.
 *
 * DESIGN PRINCIPLES (binding)
 * ---------------------------
 *  1. READ-ONLY by construction. Only GET. Only SELECT / Odoo read methods.
 *     No POST, no mutation, ever. This file cannot move money or change state.
 *  2. SELF-CONTAINED. Uses ONLY already-provisioned bindings/secrets:
 *       env.DB           — D1 'hn-hiring' (sales, attendance, cash, aggregator…)
 *       env.ODOO_API_KEY — odoo.hnhotels.in finance reads (POs / bills / vendors)
 *     No new Cloudflare secret to provision; deploys via the normal Pages pipe.
 *  3. DEDICATED AUTH. A fresh SPINE token (NOT the DASHBOARD_KEY, which is
 *     embedded in client JS and therefore public). The token's SHA-256 hash is
 *     stored in D1 table `spine_keys`; the raw token lives only with the owner.
 *     env.SPINE_API_KEY is also honoured if ever set (takes precedence).
 *  4. SELF-DESCRIBING. GET /api/spine?resource=manifest returns the full grammar
 *     (entities, resources, params, credential references) so the cloud chat can
 *     discover everything it can ask.
 *  5. Money in PAISE (integer); rupees derived at the display layer.
 *
 * AUTH (any one of):
 *   Authorization: Bearer <SPINE_TOKEN>
 *   x-spine-key: <SPINE_TOKEN>
 *   ?key=<SPINE_TOKEN>
 *
 * QUERY:
 *   GET /api/spine?resource=<name>&<params...>
 *   (alias: ?q= / ?action=)
 * ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = '1.0.0';

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;

// business_expenses / finance-instance company map (per owner-dashboard.js — authoritative for D1 spend)
const FIN_BRAND_COMPANY = { HE: 2, NCH: 3, HQ: 1 };
const FIN_COMPANY_BRAND = { 1: 'HQ', 2: 'HE', 3: 'NCH' };

const CAT_LABELS = {
  1: 'Kitchen RM Purchase', 2: 'Capex', 3: 'Salary', 4: 'Employee Advance',
  5: 'Rent', 6: 'Utility', 7: 'Police / Hafta', 8: 'Petty / Operations',
  9: 'Maintenance / Repair', 10: 'Marketing', 11: 'Food Supplies',
  12: 'Disposables', 13: 'Owner Drawings', 14: 'Direct Vendor Bill', 15: 'Bill from PO',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-spine-key',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ── time helpers (IST = UTC+5:30) ──────────────────────────────────────────
function istNow() { return new Date(Date.now() + 5.5 * 3600 * 1000); }
function istDate() { return istNow().toISOString().slice(0, 10); }
function monthStartIST() { return istDate().slice(0, 7) + '-01'; }
function paiseRupees(p) { return { paise: p || 0, rupees: Math.round((p || 0)) / 100 }; }

// constant-time compare
function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Odoo JSON-RPC read helper (finance instance) ───────────────────────────
async function odoo(apiKey, model, method, args = [], kwargs = {}) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, apiKey, model, method, args, kwargs] },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || d.error.message || 'Odoo error');
  return d.result;
}

// ── LIVE POS (source of truth) ─────────────────────────────────────────────
// Sales/payments/items are queried LIVE from the POS Odoo instances so the
// assistant never reads a stale mirror. read_group keeps it to 1-3 cheap
// aggregate calls regardless of order volume. HE → test.hamzahotel.com,
// NCH → ops.hamzahotel.com (both already hold the keys on this Pages project).
const POS_INSTANCES = {
  HE:  { host: 'https://test.hamzahotel.com/jsonrpc', keys: ['POS_ODOO_KEY', 'TEST_ODOO_KEY', 'ODOO_API_KEY'], uids: ['POS_ODOO_UID', 'TEST_ODOO_UID'] },
  NCH: { host: 'https://ops.hamzahotel.com/jsonrpc',  keys: ['ODOO_NCH_POS_KEY', 'OPS_ODOO_KEY', 'ODOO_API_KEY'], uids: ['OPS_ODOO_UID', 'POS_ODOO_UID'] },
};
const POS_STATES = ['paid', 'done', 'invoiced'];

function posCreds(env, brand) {
  const c = POS_INSTANCES[brand];
  if (!c) return null;
  const key = c.keys.map(k => env[k]).find(Boolean);
  if (!key) return null;
  const uid = parseInt(c.uids.map(u => env[u]).find(Boolean) || '2', 10);
  return { host: c.host, db: 'main', uid, key };
}

async function posRpc(creds, model, method, args = [], kwargs = {}) {
  const r = await fetch(creds.host, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call',
      params: { service: 'object', method: 'execute_kw',
        args: [creds.db, creds.uid, creds.key, model, method, args, kwargs] } }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || d.error.message || 'POS Odoo error');
  return d.result;
}

function classifyPM(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('complimentary') || n.includes('comp')) return 'complimentary';
  if (n.includes('cash')) return 'cash';
  if (n.includes('card')) return 'card';
  if (n.includes('upi') || n.includes('razorpay') || n.includes('paytm') || n.includes('online') || n.includes('gpay')) return 'upi';
  if (n.includes('token') || n.includes('runner')) return 'runner';
  return 'other';
}

// Payment split via one read_group on pos.payment (dotted-path domain on the order).
async function posPaymentSplit(creds, from, to) {
  const rows = await posRpc(creds, 'pos.payment', 'read_group',
    [[['pos_order_id.date_order', '>=', `${from} 00:00:00`],
      ['pos_order_id.date_order', '<=', `${to} 23:59:59`],
      ['pos_order_id.state', 'in', POS_STATES]],
     ['amount:sum'], ['payment_method_id']]);
  const buckets = { cash: 0, upi: 0, card: 0, complimentary: 0, runner: 0, other: 0 };
  const by_method = [];
  for (const r of (rows || [])) {
    const name = r.payment_method_id?.[1] || 'unknown';
    const amt = r.amount || 0;
    buckets[classifyPM(name)] += amt;
    by_method.push({ method: name, rupees: Math.round(amt * 100) / 100, count: r.__count || 0 });
  }
  by_method.sort((a, b) => b.rupees - a.rupees);
  return { buckets, by_method };
}

async function liveRevenue(creds, brand, from, to) {
  const og = await posRpc(creds, 'pos.order', 'read_group',
    [[['date_order', '>=', `${from} 00:00:00`], ['date_order', '<=', `${to} 23:59:59`], ['state', 'in', POS_STATES]],
     ['amount_total:sum'], []]);
  const gross = og?.[0]?.amount_total || 0;
  const orders = og?.[0]?.__count || 0;
  const { buckets } = await posPaymentSplit(creds, from, to);
  const comp = buckets.complimentary || 0;
  return {
    ok: true, resource: 'revenue', brand, range: { from, to },
    totals: {
      gross_sales_rupees: Math.round(gross * 100) / 100,
      complimentary_rupees: Math.round(comp * 100) / 100,
      net_of_complimentary_rupees: Math.round((gross - comp) * 100) / 100,
      cash_rupees: Math.round(buckets.cash * 100) / 100,
      upi_rupees: Math.round(buckets.upi * 100) / 100,
      card_rupees: Math.round(buckets.card * 100) / 100,
      runner_ledger_rupees: Math.round(buckets.runner * 100) / 100,
      order_count: orders,
      avg_ticket_rupees: orders ? Math.round((gross / orders) * 100) / 100 : 0,
    },
    meta: { source: 'odoo-live (POS source of truth)', instance: creds.host, generated_at: istNow().toISOString() },
  };
}

async function liveItems(creds, brand, from, to, limit) {
  const rows = await posRpc(creds, 'pos.order.line', 'read_group',
    [[['order_id.date_order', '>=', `${from} 00:00:00`], ['order_id.date_order', '<=', `${to} 23:59:59`], ['order_id.state', 'in', POS_STATES]],
     ['qty:sum', 'price_subtotal_incl:sum'], ['product_id']],
    { orderby: 'price_subtotal_incl desc', limit });
  return {
    ok: true, resource: 'items', brand, range: { from, to },
    items: (rows || []).map(r => ({
      product: r.product_id?.[1] || 'unknown',
      qty: r.qty || 0,
      lines: r.__count || 0,
      revenue_rupees: Math.round((r.price_subtotal_incl || 0) * 100) / 100,
    })),
    meta: { source: 'odoo-live (POS source of truth)', instance: creds.host, generated_at: istNow().toISOString() },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY
// ═══════════════════════════════════════════════════════════════════════════
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET') return json({ ok: false, error: 'SPINE is read-only — GET only.' }, 405);

  const url = new URL(request.url);
  const resource = (url.searchParams.get('resource') || url.searchParams.get('q') || url.searchParams.get('action') || 'manifest').toLowerCase();

  // health is the only unauthenticated resource (no business data)
  if (resource === 'health') {
    return json({ ok: true, service: 'spine', version: VERSION, time_ist: istNow().toISOString(), authenticated: false });
  }

  // ── auth ──
  const principal = await authenticate(context);
  if (!principal) {
    return json({ ok: false, error: 'Unauthorized. Present the SPINE token via Authorization: Bearer <token>, x-spine-key header, or ?key=. (resource=health is open; resource=manifest documents everything once authed.)' }, 401);
  }

  if (!env.DB) return json({ ok: false, error: 'DB binding not configured' }, 500);

  try {
    switch (resource) {
      case 'manifest':         return json(manifest(url, extractToken(request, url)));
      case 'catalog':          return json({ ok: true, resource, generated_at: istNow().toISOString(), data: CATALOG });
      case 'revenue':          return await revenue(url, env);
      case 'revenue.daily':    return await revenueDaily(url, env);
      case 'payments':         return await payments(url, env);
      case 'items':
      case 'menu.sales':       return await items(url, env);
      case 'attendance':       return await attendance(url, env);
      case 'cash':             return await cash(url, env);
      case 'aggregator':       return await aggregator(url, env);
      case 'expenses':         return await expenses(url, env);
      case 'vendors':          return await vendors(url, env);
      case 'purchase_orders':  return await purchaseOrders(url, env);
      case 'bills':            return await bills(url, env);
      case 'staff':            return await staff(url, env);
      case 'shortages':        return await shortages(url, env);
      case 'razorpay':         return await razorpay(url, env);
      case 'marketing':        return await marketing(url, env);
      case 'credentials':      return json({ ok: true, resource, note: 'Reference layer — names + locations only, never values. Ask Claude Code (executor) to fetch a value by name when an action needs it.', data: CREDENTIAL_REFERENCES });
      default:
        return json({ ok: false, error: `Unknown resource '${resource}'. GET ?resource=manifest for the full list.` }, 400);
    }
  } catch (e) {
    return json({ ok: false, resource, error: e.message }, 500);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH — SHA-256(token) must match an active row in spine_keys (or env override)
// ═══════════════════════════════════════════════════════════════════════════
function extractToken(request, url) {
  const hdr = request.headers.get('authorization') || '';
  const bearer = hdr.toLowerCase().startsWith('bearer ') ? hdr.slice(7).trim() : '';
  return bearer || request.headers.get('x-spine-key') || url.searchParams.get('key') || '';
}

async function authenticate(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = extractToken(request, url);
  if (!token) return null;

  // env override (preferred if ever provisioned as a Pages secret)
  if (env.SPINE_API_KEY && timingSafeEq(token, env.SPINE_API_KEY)) {
    return { source: 'env', scope: 'read' };
  }
  if (!env.DB) return null;

  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT id, scope FROM spine_keys WHERE key_hash = ? AND active = 1`
  ).bind(hash).first().catch(() => null);
  if (!row) return null;

  // best-effort usage stamp (never blocks the response)
  context.waitUntil(
    env.DB.prepare(`UPDATE spine_keys SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE id = ?`)
      .bind(row.id).run().catch(() => {})
  );
  return { source: 'd1', scope: row.scope || 'read', key_id: row.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function rng(url) {
  return {
    from: url.searchParams.get('from') || monthStartIST(),
    to:   url.searchParams.get('to')   || istDate(),
  };
}
function brandUpper(url, def = null) {
  const b = url.searchParams.get('brand');
  return b ? b.toUpperCase() : def;
}

// ── REVENUE: LIVE from POS Odoo; falls back to the (stale) D1 mirror ──
async function revenue(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const creds = posCreds(env, brand);
  if (creds) {
    try { return json(await liveRevenue(creds, brand, from, to)); }
    catch (e) { return await revenueMirror(url, env, `live POS query failed: ${e.message}`); }
  }
  return await revenueMirror(url, env, 'no POS Odoo key configured on this deployment');
}

// Stale fallback: the D1 reconciliation mirror (frozen until the sync ships).
async function revenueMirror(url, env, why) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH'); // sales_recon_daily uses HE / NCH
  const r = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(gross_sales_paise),     0) AS gross,
      COALESCE(SUM(total_cash_paise),      0) AS cash,
      COALESCE(SUM(total_upi_paise),       0) AS upi,
      COALESCE(SUM(counter_card_paise),    0) AS card,
      COALESCE(SUM(complimentary_paise),   0) AS complimentary,
      COALESCE(SUM(counter_upi_pos_paise), 0) AS counter_upi_pos,
      COALESCE(SUM(counter_upi_rzp_paise), 0) AS counter_upi_rzp,
      COALESCE(SUM(runner_sales_paise),    0) AS runner_sales,
      COALESCE(SUM(order_count),           0) AS order_count,
      COUNT(*) AS rows_in_range,
      MAX(last_recomputed_at) AS last_recomputed_at
    FROM sales_recon_daily
    WHERE brand = ? AND day >= ? AND day <= ?
  `).bind(brand, from, to).first();

  const orders = r?.order_count || 0;
  const gross = r?.gross || 0;
  return json({
    ok: true, resource: 'revenue', brand, range: { from, to },
    awaiting_sync: (r?.rows_in_range || 0) === 0,
    last_recomputed_at: r?.last_recomputed_at || null,
    totals: {
      gross_sales: paiseRupees(gross),
      cash: paiseRupees(r?.cash),
      upi: paiseRupees(r?.upi),
      card: paiseRupees(r?.card),
      complimentary: paiseRupees(r?.complimentary),
      order_count: orders,
      avg_ticket_rupees: orders ? Math.round(gross / orders) / 100 : 0,
    },
    upi_detail: {
      counter_upi_pos: paiseRupees(r?.counter_upi_pos),
      counter_upi_rzp: paiseRupees(r?.counter_upi_rzp),
      runner_sales: paiseRupees(r?.runner_sales),
    },
    meta: { source: 'd1-mirror (STALE — frozen until sync ships)', stale_reason: why, generated_at: istNow().toISOString() },
  });
}

async function revenueDaily(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const r = await env.DB.prepare(
    `SELECT day, gross_sales_paise, total_cash_paise, total_upi_paise, counter_card_paise,
            complimentary_paise, order_count, upi_discrepancy_paise
       FROM sales_recon_daily
      WHERE brand = ? AND day >= ? AND day <= ?
      ORDER BY day DESC`
  ).bind(brand, from, to).all();
  return json({
    ok: true, resource: 'revenue.daily', brand, range: { from, to },
    rows: (r.results || []).map(x => ({
      day: x.day,
      gross_rupees: (x.gross_sales_paise || 0) / 100,
      cash_rupees: (x.total_cash_paise || 0) / 100,
      upi_rupees: (x.total_upi_paise || 0) / 100,
      card_rupees: (x.counter_card_paise || 0) / 100,
      complimentary_rupees: (x.complimentary_paise || 0) / 100,
      order_count: x.order_count || 0,
      upi_discrepancy_rupees: (x.upi_discrepancy_paise || 0) / 100,
    })),
    meta: { source: 'D1 sales_recon_daily', generated_at: istNow().toISOString() },
  });
}

// ── PAYMENTS: LIVE split (UPI vs cash vs card) from POS Odoo; mirror fallback ──
async function payments(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const creds = posCreds(env, brand);
  if (creds) {
    try {
      const { buckets, by_method } = await posPaymentSplit(creds, from, to);
      const total = Object.values(buckets).reduce((s, v) => s + v, 0) - (buckets.complimentary || 0);
      return json({
        ok: true, resource: 'payments', brand, range: { from, to },
        split_rupees: {
          cash: Math.round(buckets.cash * 100) / 100,
          upi: Math.round(buckets.upi * 100) / 100,
          card: Math.round(buckets.card * 100) / 100,
          runner_ledger: Math.round(buckets.runner * 100) / 100,
          other: Math.round(buckets.other * 100) / 100,
          complimentary: Math.round(buckets.complimentary * 100) / 100,
        },
        upi_share_pct: total ? Math.round((buckets.upi / total) * 1000) / 10 : 0,
        by_method,
        meta: { source: 'odoo-live (POS source of truth)', instance: creds.host, generated_at: istNow().toISOString() },
      });
    } catch (e) { return await paymentsMirror(url, env, `live POS query failed: ${e.message}`); }
  }
  return await paymentsMirror(url, env, 'no POS Odoo key configured on this deployment');
}

async function paymentsMirror(url, env, why) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const pm = await env.DB.prepare(
    `SELECT payment_method_name, COUNT(*) AS lines, SUM(amount_paise) AS amount_paise
       FROM pos_payments_mirror
      WHERE brand = ? AND order_date_day >= ? AND order_date_day <= ?
      GROUP BY payment_method_name
      ORDER BY amount_paise DESC`
  ).bind(brand, from, to).all();

  let qr = { results: [] };
  try {
    qr = await env.DB.prepare(
      `SELECT method, COUNT(*) AS captures, SUM(amount_paise) AS amount_paise, SUM(fee_paise) AS fee_paise
         FROM razorpay_qr_collections
        WHERE brand = ? AND captured_at_day >= ? AND captured_at_day <= ? AND status = 'captured'
        GROUP BY method
        ORDER BY amount_paise DESC`
    ).bind(brand, from, to).all();
  } catch (_) { /* table may be brand-scoped differently; fail soft */ }

  return json({
    ok: true, resource: 'payments', brand, range: { from, to },
    pos_methods: (pm.results || []).map(r => ({
      method: r.payment_method_name, lines: r.lines, ...paiseRupees(r.amount_paise),
    })),
    razorpay_qr: (qr.results || []).map(r => ({
      method: r.method, captures: r.captures, fee: paiseRupees(r.fee_paise), ...paiseRupees(r.amount_paise),
    })),
    meta: { source: 'd1-mirror (STALE — frozen until sync ships)', stale_reason: why, generated_at: istNow().toISOString() },
  });
}

// ── ITEMS: LIVE top menu items by revenue from POS Odoo; mirror fallback ──
async function items(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);
  const creds = posCreds(env, brand);
  if (creds && !url.searchParams.get('search')) {
    try { return json(await liveItems(creds, brand, from, to, limit)); }
    catch (e) { return await itemsMirror(url, env, `live POS query failed: ${e.message}`); }
  }
  return await itemsMirror(url, env, creds ? 'search= uses the mirror' : 'no POS Odoo key configured on this deployment');
}

async function itemsMirror(url, env, why) {
  const { from, to } = rng(url);
  const brand = brandUpper(url, 'NCH');
  const search = (url.searchParams.get('search') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);
  const filters = ['brand = ?', 'order_date_day >= ?', 'order_date_day <= ?'];
  const binds = [brand, from, to];
  if (search) { filters.push('product_name LIKE ?'); binds.push(`%${search}%`); }
  const r = await env.DB.prepare(`
    SELECT product_id, product_name, SUM(qty) AS qty,
           COUNT(DISTINCT odoo_pos_order_id) AS orders,
           SUM(price_subtotal_incl_paise) AS revenue_paise
      FROM pos_lines_mirror
     WHERE ${filters.join(' AND ')}
     GROUP BY product_id, product_name
     ORDER BY revenue_paise DESC
     LIMIT ?
  `).bind(...binds, limit).all();
  return json({
    ok: true, resource: 'items', brand, range: { from, to },
    items: (r.results || []).map(x => ({
      product: x.product_name, qty: x.qty, orders: x.orders, ...paiseRupees(x.revenue_paise),
    })),
    meta: { source: 'd1-mirror (STALE — frozen until sync ships)', stale_reason: why, generated_at: istNow().toISOString() },
  });
}

// ── ATTENDANCE: who was present / absent on a date ──
async function attendance(url, env) {
  const date = url.searchParams.get('date') || istDate();
  const brand = brandUpper(url); // HE | NCH | HQ — hr_employees.brand_label
  let q = `SELECT a.status, a.total_hours, a.first_in_at, a.last_out_at, a.punch_count,
                  e.name, e.known_as, e.job_name, e.department_name, e.brand_label
             FROM hr_attendance_daily a
             JOIN hr_employees e ON e.id = a.employee_id
            WHERE a.date = ? AND e.is_active = 1`;
  const params = [date];
  if (brand) { q += ' AND e.brand_label = ?'; params.push(brand); }
  q += ' ORDER BY e.brand_label, e.name';
  const rows = await env.DB.prepare(q).bind(...params).all();

  const people = (rows.results || []).map(r => ({
    name: r.name, known_as: r.known_as, job: r.job_name, department: r.department_name,
    brand: r.brand_label, status: r.status,
    hours: r.total_hours || 0, first_in: r.first_in_at, last_out: r.last_out_at, punches: r.punch_count || 0,
  }));
  const counts = {};
  for (const p of people) counts[p.status || 'unknown'] = (counts[p.status || 'unknown'] || 0) + 1;

  return json({
    ok: true, resource: 'attendance', date, brand: brand || 'all',
    counts,
    present: people.filter(p => p.status === 'present'),
    absent:  people.filter(p => p.status === 'absent'),
    other:   people.filter(p => !['present', 'absent'].includes(p.status)),
    total_active: people.length,
    meta: { source: 'D1 hr_attendance_daily ⋈ hr_employees (CAMS biometric)', status_legend: 'present | absent | half | ghost | pending | week_off | leave', generated_at: istNow().toISOString() },
  });
}

// ── CASH: live balances per pile (anchor + delta) ──
async function cash(url, env) {
  const result = await env.DB.prepare(`
    WITH anchor AS (
      SELECT a.instrument, a.balance_paise_after AS bal_paise, a.txn_at AS anchor_at, a.id AS anchor_id
        FROM cash_events a
       WHERE a.balance_paise_after IS NOT NULL
         AND a.id = (SELECT b.id FROM cash_events b
                      WHERE b.instrument = a.instrument AND b.balance_paise_after IS NOT NULL
                      ORDER BY b.txn_at DESC, b.id DESC LIMIT 1)
    )
    SELECT i.instrument,
           COALESCE(a.bal_paise, 0) + COALESCE((
             SELECT SUM(CASE d.direction WHEN 'credit' THEN d.amount_paise ELSE -d.amount_paise END)
               FROM cash_events d
              WHERE d.instrument = i.instrument AND d.balance_paise_after IS NULL
                AND (a.anchor_at IS NULL OR d.txn_at > a.anchor_at OR (d.txn_at = a.anchor_at AND d.id > a.anchor_id))
           ), 0) AS balance_paise,
           a.anchor_at,
           (SELECT MAX(txn_at) FROM cash_events e WHERE e.instrument = i.instrument) AS last_event_at
      FROM (SELECT 'pos_counter_he' AS instrument
              UNION SELECT 'pos_counter_nch'
              UNION SELECT 'cash_basheer'
              UNION SELECT 'cash_nihaf') i
      LEFT JOIN anchor a ON a.instrument = i.instrument
  `).all().catch(() => ({ results: [] }));

  const labels = {
    pos_counter_he: 'HE counter drawer', pos_counter_nch: 'NCH counter drawer',
    cash_basheer: 'Basheer cash (manager)', cash_nihaf: 'Nihaf cash (owner)',
  };
  const balances = (result.results || []).map(b => ({
    instrument: b.instrument, label: labels[b.instrument] || b.instrument,
    ...paiseRupees(b.balance_paise), anchored_at: b.anchor_at, last_event_at: b.last_event_at,
  }));
  const total = balances.reduce((s, b) => s + (b.paise || 0), 0);
  return json({
    ok: true, resource: 'cash', as_of: istNow().toISOString(),
    balances, total: paiseRupees(total),
    meta: { source: 'D1 cash_events (anchor+delta)', note: 'Physical-count reconcile events are the authoritative pivot.', generated_at: istNow().toISOString() },
  });
}

// ── AGGREGATOR: Swiggy / Zomato orders summary ──
async function aggregator(url, env) {
  const { from, to } = rng(url);
  const brand = (url.searchParams.get('brand') || '').toLowerCase(); // aggregator_orders uses he/nch
  const platform = (url.searchParams.get('platform') || '').toLowerCase();
  const IST = "'+5 hours', '+30 minutes'";
  const EFFECTIVE_DATE = `COALESCE(NULLIF(order_date, ''), date(captured_at, ${IST}))`;
  let sql = `SELECT platform, brand, status, order_value, net_payout, rating
               FROM aggregator_orders
              WHERE ${EFFECTIVE_DATE} >= ? AND ${EFFECTIVE_DATE} <= ?`;
  const params = [from, to];
  if (brand && brand !== 'all') { sql += ' AND brand = ?'; params.push(brand); }
  if (platform && platform !== 'all') { sql += ' AND platform = ?'; params.push(platform); }
  sql += ' ORDER BY order_date DESC, order_time DESC LIMIT 1000';
  const { results } = await env.DB.prepare(sql).bind(...params).all();

  const byOutlet = {};
  for (const r of results) {
    const key = `${r.platform}_${r.brand}`;
    if (!byOutlet[key]) byOutlet[key] = { platform: r.platform, brand: r.brand, orders: 0, delivered: 0, revenue_rupees: 0, payout_rupees: 0 };
    byOutlet[key].orders++;
    if (r.status === 'DELIVERED' || r.status === 'Delivered') {
      byOutlet[key].delivered++;
      byOutlet[key].revenue_rupees += r.order_value || 0;
      byOutlet[key].payout_rupees += r.net_payout || 0;
    }
  }
  const delivered = results.filter(r => r.status === 'DELIVERED' || r.status === 'Delivered');
  return json({
    ok: true, resource: 'aggregator', range: { from, to }, brand: brand || 'all', platform: platform || 'all',
    total_orders: results.length, total_delivered: delivered.length,
    total_revenue_rupees: Math.round(delivered.reduce((s, r) => s + (r.order_value || 0), 0) * 100) / 100,
    total_payout_rupees: Math.round(delivered.reduce((s, r) => s + (r.net_payout || 0), 0) * 100) / 100,
    by_outlet: Object.values(byOutlet),
    meta: { source: 'D1 aggregator_orders (Swiggy + Zomato pull)', note: 'order_value/net_payout are stored in rupees here, not paise.', generated_at: istNow().toISOString() },
  });
}

// ── EXPENSES: spend roll-up from business_expenses (+ optional Odoo PO/bill totals) ──
async function expenses(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url); // HE | NCH | HQ
  const companyId = brand ? FIN_BRAND_COMPANY[brand] : null;
  const brandFilter = companyId ? `AND company_id = ${companyId}` : '';

  const total = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}`
  ).bind(from, to).first();

  const byCat = await env.DB.prepare(
    `SELECT category_parent AS cat, SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY category_parent ORDER BY total DESC`
  ).bind(from, to).all();

  const byPay = await env.DB.prepare(
    `SELECT COALESCE(x_payment_method, payment_mode) AS method, SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY method ORDER BY total DESC`
  ).bind(from, to).all();

  // Odoo POs + outstanding bills (best-effort; finance instance)
  let po = null, billsOut = null;
  if (env.ODOO_API_KEY) {
    try {
      const poDom = [['date_order', '>=', from], ['date_order', '<=', `${to} 23:59:59`], ['state', 'in', ['purchase', 'done']]];
      if (companyId) poDom.push(['company_id', '=', companyId]);
      const g = await odoo(env.ODOO_API_KEY, 'purchase.order', 'read_group', [poDom, ['amount_total:sum'], []]);
      if (g && g[0]) po = { total_rupees: Math.round(g[0].amount_total || 0), count: g[0].__count || 0 };

      const unpaidDom = [['move_type', '=', 'in_invoice'], ['payment_state', 'in', ['not_paid', 'partial']], ['state', '=', 'posted']];
      if (companyId) unpaidDom.push(['company_id', '=', companyId]);
      const u = await odoo(env.ODOO_API_KEY, 'account.move', 'read_group', [unpaidDom, ['amount_residual:sum'], []]);
      if (u && u[0]) billsOut = { outstanding_rupees: Math.round(u[0].amount_residual || 0) };
    } catch (e) { po = { error: e.message }; }
  }

  return json({
    ok: true, resource: 'expenses', brand: brand || 'all', range: { from, to },
    summary: { total_rupees: Math.round(total?.total || 0), entry_count: total?.cnt || 0 },
    by_category: (byCat.results || []).map(r => ({ category: r.cat || 'Other', total_rupees: Math.round(r.total || 0), count: r.cnt })),
    by_payment_method: (byPay.results || []).map(r => ({ method: r.method || 'unknown', total_rupees: Math.round(r.total || 0), count: r.cnt })),
    purchase_orders: po, bills_outstanding: billsOut,
    meta: { source: 'D1 business_expenses (cats 2-13) + Odoo purchase.order/account.move (cats 1,14,15)', generated_at: istNow().toISOString() },
  });
}

// ── VENDORS: active vendor directory (D1) ──
async function vendors(url, env) {
  const brand = brandUpper(url);
  let q = `SELECT name, phone, payment_terms, primary_brand, odoo_partner_id
             FROM vendors WHERE active = 1 AND (merged_into_id IS NULL)`;
  const binds = [];
  if (brand) { q += ' AND (primary_brand = ? OR primary_brand = ?)'; binds.push(brand, 'BOTH'); }
  q += ' ORDER BY name';
  const r = await env.DB.prepare(q).bind(...binds).all().catch(async () => {
    // fallback if merged_into_id column absent
    return await env.DB.prepare(`SELECT name, phone, payment_terms, primary_brand FROM vendors WHERE active = 1 ORDER BY name`).all();
  });
  return json({
    ok: true, resource: 'vendors', brand: brand || 'all', count: (r.results || []).length,
    vendors: r.results || [],
    meta: { source: 'D1 vendors', generated_at: istNow().toISOString() },
  });
}

// ── PURCHASE ORDERS (Odoo finance instance) ──
async function purchaseOrders(url, env) {
  if (!env.ODOO_API_KEY) return json({ ok: false, resource: 'purchase_orders', error: 'ODOO_API_KEY not configured' }, 500);
  const { from, to } = rng(url);
  const brand = brandUpper(url);
  const companyId = brand ? FIN_BRAND_COMPANY[brand] : null;
  const domain = [['date_order', '>=', from], ['date_order', '<=', `${to} 23:59:59`]];
  if (companyId) domain.push(['company_id', '=', companyId]);
  const pos = await odoo(env.ODOO_API_KEY, 'purchase.order', 'search_read', [domain],
    { fields: ['name', 'partner_id', 'date_order', 'amount_total', 'state', 'company_id', 'invoice_status'], order: 'date_order desc', limit: 300 });
  return json({
    ok: true, resource: 'purchase_orders', brand: brand || 'all', range: { from, to },
    count: pos.length,
    purchase_orders: pos.map(p => ({
      name: p.name, vendor: p.partner_id?.[1] || '—', date: p.date_order?.slice(0, 10),
      brand: FIN_COMPANY_BRAND[p.company_id?.[0]] || '—', amount_rupees: p.amount_total, state: p.state, invoice_status: p.invoice_status,
    })),
    meta: { source: 'Odoo odoo.hnhotels.in purchase.order', generated_at: istNow().toISOString() },
  });
}

// ── BILLS (Odoo account.move in_invoice) ──
async function bills(url, env) {
  if (!env.ODOO_API_KEY) return json({ ok: false, resource: 'bills', error: 'ODOO_API_KEY not configured' }, 500);
  const { from, to } = rng(url);
  const brand = brandUpper(url);
  const companyId = brand ? FIN_BRAND_COMPANY[brand] : null;
  const onlyOutstanding = url.searchParams.get('outstanding') === '1';
  const domain = [['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to]];
  if (companyId) domain.push(['company_id', '=', companyId]);
  if (onlyOutstanding) domain.push(['payment_state', 'in', ['not_paid', 'partial']]);
  const bs = await odoo(env.ODOO_API_KEY, 'account.move', 'search_read', [domain],
    { fields: ['name', 'ref', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 'state', 'payment_state', 'company_id'], order: 'invoice_date desc', limit: 500 });
  return json({
    ok: true, resource: 'bills', brand: brand || 'all', range: { from, to }, only_outstanding: onlyOutstanding,
    count: bs.length,
    bills: bs.map(b => ({
      name: b.name, ref: b.ref, vendor: b.partner_id?.[1] || '—', date: b.invoice_date,
      brand: FIN_COMPANY_BRAND[b.company_id?.[0]] || '—', amount_rupees: b.amount_total,
      outstanding_rupees: b.amount_residual, state: b.state, payment_state: b.payment_state,
    })),
    meta: { source: 'Odoo odoo.hnhotels.in account.move (in_invoice)', generated_at: istNow().toISOString() },
  });
}

// ── STAFF: Darbar/HR roster (D1 hr_employees, live) ──
async function staff(url, env) {
  const brand = brandUpper(url); // HE | NCH | HQ
  let q = `SELECT name, known_as, brand_label, job_name, department_name, pay_type,
                  monthly_salary, phone, bio_enrolled, is_active
             FROM hr_employees WHERE is_active = 1`;
  const binds = [];
  if (brand) { q += ' AND brand_label = ?'; binds.push(brand); }
  q += ' ORDER BY brand_label, name';
  const r = await env.DB.prepare(q).bind(...binds).all();
  const people = (r.results || []).map(e => ({
    name: e.name, known_as: e.known_as, brand: e.brand_label, job: e.job_name,
    department: e.department_name, pay_type: e.pay_type,
    monthly_salary_rupees: e.monthly_salary || 0, phone: e.phone,
    biometric_enrolled: !!e.bio_enrolled,
  }));
  return json({
    ok: true, resource: 'staff', brand: brand || 'all', count: people.length, staff: people,
    meta: { source: 'D1 hr_employees (live)', generated_at: istNow().toISOString() },
  });
}

// ── SHORTAGES: cash shortages ledger (D1 hr_cash_shortages, live) ──
async function shortages(url, env) {
  const brand = brandUpper(url) || 'NCH';
  const month = url.searchParams.get('month'); // YYYY-MM optional
  let q = `SELECT s.amount, s.source, s.brand, s.created_at, s.cleared_at, s.waived,
                  s.counterparty, s.unmapped_code, e.name AS staff_name
             FROM hr_cash_shortages s LEFT JOIN hr_employees e ON e.pin = s.pin
            WHERE s.brand = ?`;
  const binds = [brand];
  if (month) { q += ` AND strftime('%Y-%m', s.created_at) = ?`; binds.push(month); }
  q += ' ORDER BY s.created_at DESC LIMIT 500';
  const r = await env.DB.prepare(q).bind(...binds).all();
  const rows = r.results || [];
  const open = rows.filter(x => !x.cleared_at && !x.waived);
  return json({
    ok: true, resource: 'shortages', brand, month: month || 'all',
    summary: {
      open_count: open.length,
      open_total_rupees: Math.round(open.reduce((s, x) => s + (x.amount || 0), 0)),
      total_count: rows.length,
    },
    shortages: rows.map(x => ({
      staff: x.staff_name || x.unmapped_code || 'unmapped', amount_rupees: x.amount,
      source: x.source, brand: x.brand, at: x.created_at,
      status: x.waived ? 'waived' : (x.cleared_at ? 'cleared' : 'open'),
      counterparty: x.counterparty,
    })),
    meta: { source: 'D1 hr_cash_shortages (live)', generated_at: istNow().toISOString() },
  });
}

// ── RAZORPAY: QR/UPI collections. Live via gateway API if keys present on this
//    deployment; otherwise the D1 mirror (flagged with its real freshness). ──
async function razorpay(url, env) {
  const { from, to } = rng(url);
  const brand = brandUpper(url);
  const hasKeys = !!(env.RAZORPAY_KEY && env.RAZORPAY_SECRET);
  let q = `SELECT brand, role, method,
                  COUNT(*) AS captures, SUM(amount_paise) AS amount_paise, SUM(fee_paise) AS fee_paise
             FROM razorpay_qr_collections
            WHERE captured_at_day >= ? AND captured_at_day <= ? AND status = 'captured'`;
  const binds = [from, to];
  if (brand) { q += ' AND brand = ?'; binds.push(brand.toLowerCase()); }
  q += ' GROUP BY brand, role, method ORDER BY amount_paise DESC';
  const r = await env.DB.prepare(q).bind(...binds).all().catch(() => ({ results: [] }));
  const latest = await env.DB.prepare(`SELECT MAX(captured_at_day) AS d FROM razorpay_qr_collections`).first().catch(() => ({}));
  return json({
    ok: true, resource: 'razorpay', brand: brand || 'all', range: { from, to },
    groups: (r.results || []).map(x => ({
      brand: x.brand, role: x.role, method: x.method, captures: x.captures,
      ...paiseRupees(x.amount_paise), fee: paiseRupees(x.fee_paise),
    })),
    meta: {
      source: 'D1 razorpay_qr_collections',
      mirror_latest_day: latest?.d || null,
      live_gateway_available: hasKeys,
      note: hasKeys
        ? 'RAZORPAY keys present — a live gateway poller can be wired on request.'
        : 'STALE: D1 mirror is frozen (no Razorpay sync running) and RAZORPAY_KEY/SECRET are NOT on this Pages project. Live Razorpay needs that key added. Note: UPI revenue as recorded in POS is already live via resource=payments.',
      generated_at: istNow().toISOString(),
    },
  });
}

// ── MARKETING: live proxy to the HE marketing cockpits (open-CORS workers) ──
const MARKETING_FEEDS = {
  google: (p) => `https://hamzaexpress.in/api/google-cockpit?period=${encodeURIComponent(p || '7d')}`,
  ctwa:   (p) => `https://hamzaexpress.in/api/ctwa-analytics?period=${encodeURIComponent(p || '7d')}`,
  leads:  (p) => `https://hamzaexpress.in/api/leads?action=${encodeURIComponent(p || 'counts')}`,
};
async function marketing(url, env) {
  const feed = (url.searchParams.get('feed') || '').toLowerCase();
  const period = url.searchParams.get('period') || url.searchParams.get('action') || '';
  const build = MARKETING_FEEDS[feed];
  if (!build) {
    return json({ ok: true, resource: 'marketing', feeds: Object.keys(MARKETING_FEEDS),
      usage: 'resource=marketing&feed=google|ctwa|leads[&period=7d|30d|all | &action=counts|history|segments]',
      meta: { note: 'HE marketing cockpits, relayed live. Google Ads / Meta CTWA / WABA leads.' } });
  }
  try {
    const upstream = build(period);
    const res = await fetch(upstream, { headers: { 'accept': 'application/json' } });
    const data = await res.json();
    return json({ ok: true, resource: 'marketing', feed, upstream, data,
      meta: { source: 'live proxy (HE cockpit worker)', generated_at: istNow().toISOString() } });
  } catch (e) {
    return json({ ok: false, resource: 'marketing', feed, error: `upstream fetch failed: ${e.message}` }, 502);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MANIFEST — self-describing grammar
// ═══════════════════════════════════════════════════════════════════════════
function manifest(url, token) {
  const base = `${url.origin}/api/spine`;
  // Bake the caller's own key into every example so a single bootstrap link is
  // fully self-propagating: the cloud chat reuses the key it already holds and
  // never has to ask the user to paste a token.
  const k = token ? `&key=${token}` : '';
  return {
    ok: true,
    service: 'SPINE — HN Hotels Operational Intelligence',
    version: VERSION,
    read_only: true,
    generated_at: istNow().toISOString(),
    cloud_chat_setup: {
      you_are_authenticated: !!token,
      bootstrap_link: token ? `${base}?resource=manifest&key=${token}` : null,
      how_to_call: token
        ? 'You already hold a valid SPINE key (it is in every example URL below). Reuse it on EVERY request by appending the same &key=<key>, or send header "Authorization: Bearer <key>". Do NOT ask the user to paste a token — you already have it.'
        : 'Open the bootstrap link the owner gives you; it carries the key. Then reuse that key on every request.',
      rules: [
        'SPINE is READ-ONLY. For anything that changes state (execution), hand off to Claude Code.',
        'To answer a question, pick a resource below, fill from/to/brand, and append the key.',
        'Dates are YYYY-MM-DD in IST. Money: read the *_rupees / .rupees fields.',
      ],
    },
    auth: {
      how: 'Present the SPINE token as Authorization: Bearer <token>, or x-spine-key: <token>, or ?key=<token>.',
      note: 'A dedicated token (NOT DASHBOARD_KEY). Hash stored in D1 spine_keys; raw token held only by owner.',
    },
    money: 'Values labelled *_paise are integers; *_rupees / .rupees are the display value (paise/100).',
    common_params: {
      from: 'YYYY-MM-DD (default: 1st of current month, IST)',
      to: 'YYYY-MM-DD (default: today, IST)',
      brand: 'HE | NCH | HQ  (revenue/payments/items/attendance/expenses use UPPER; aggregator uses he/nch)',
      date: 'YYYY-MM-DD (attendance) — default today IST',
    },
    resources: {
      health:           { auth: false, desc: 'Liveness probe, no business data.', example: `${base}?resource=health` },
      manifest:         { auth: true,  desc: 'This document.', example: `${base}?resource=manifest${k}` },
      catalog:          { auth: true,  desc: 'Stable entity catalog: legal entity, brands/outlets, company-id maps, channel economics, expense taxonomy, targets, menu fingerprint, staff roles.', example: `${base}?resource=catalog${k}` },
      revenue:          { auth: true,  desc: 'LIVE POS sales (gross, cash, UPI, card, complimentary, orders, avg ticket). Queried live from the POS Odoo; mirror only as fallback.', params: ['from', 'to', 'brand'], example: `${base}?resource=revenue&brand=HE&from=2026-06-01&to=2026-06-15${k}` },
      'revenue.daily':  { auth: true,  desc: 'Per-day sales rows (D1 mirror — may be stale until sync ships).', params: ['from', 'to', 'brand'], example: `${base}?resource=revenue.daily&brand=NCH${k}` },
      payments:         { auth: true,  desc: 'LIVE payment-method split (UPI vs cash vs card) from POS Odoo.', params: ['from', 'to', 'brand'], example: `${base}?resource=payments&brand=NCH${k}` },
      items:            { auth: true,  desc: 'LIVE top menu items by revenue from POS Odoo.', params: ['from', 'to', 'brand', 'limit'], example: `${base}?resource=items&brand=HE&limit=20${k}` },
      attendance:       { auth: true,  desc: 'Who was present / absent / on leave on a date.', params: ['date', 'brand'], example: `${base}?resource=attendance&date=2026-06-14&brand=HE${k}` },
      cash:             { auth: true,  desc: 'Live cash balances per pile (counters + manager + owner).', example: `${base}?resource=cash${k}` },
      aggregator:       { auth: true,  desc: 'Swiggy + Zomato order/revenue/payout summary.', params: ['from', 'to', 'brand', 'platform'], example: `${base}?resource=aggregator&brand=he&platform=swiggy${k}` },
      expenses:         { auth: true,  desc: 'Spend roll-up by category + payment method, plus Odoo PO total and outstanding bills.', params: ['from', 'to', 'brand'], example: `${base}?resource=expenses&brand=NCH${k}` },
      vendors:          { auth: true,  desc: 'Active vendor directory.', params: ['brand'], example: `${base}?resource=vendors${k}` },
      purchase_orders:  { auth: true,  desc: 'Odoo purchase orders in range.', params: ['from', 'to', 'brand'], example: `${base}?resource=purchase_orders&brand=HE${k}` },
      bills:            { auth: true,  desc: 'Odoo vendor bills (add &outstanding=1 for unpaid only).', params: ['from', 'to', 'brand', 'outstanding'], example: `${base}?resource=bills&outstanding=1${k}` },
      staff:            { auth: true,  desc: 'LIVE Darbar/HR roster — names, roles, brand, pay type, salary, biometric status.', params: ['brand'], example: `${base}?resource=staff&brand=NCH${k}` },
      shortages:        { auth: true,  desc: 'LIVE cash-shortage ledger (open/cleared/waived).', params: ['brand', 'month'], example: `${base}?resource=shortages&brand=NCH${k}` },
      razorpay:         { auth: true,  desc: 'Razorpay QR/UPI collections. Live gateway needs RAZORPAY keys on this project; today reads the (stale) D1 mirror and says so. UPI revenue is live via resource=payments.', params: ['from', 'to', 'brand'], example: `${base}?resource=razorpay&brand=NCH${k}` },
      marketing:        { auth: true,  desc: 'LIVE proxy to HE marketing cockpits: Google Ads, Meta CTWA, WABA leads.', params: ['feed=google|ctwa|leads', 'period', 'action'], example: `${base}?resource=marketing&feed=google&period=7d${k}` },
      credentials:      { auth: true,  desc: 'Credential REFERENCE layer — names + locations only, never values.', example: `${base}?resource=credentials${k}` },
    },
    entity_catalog_summary: {
      brands: ['HE (Hamza Express — QSR biryani/kabab)', 'NCH (Nawabi Chai House — Irani chai cafe)'],
      finance_company_ids: FIN_COMPANY_BRAND,
      expense_categories: CAT_LABELS,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC CATALOG (stable reference data — sourced from CLAUDE.md + repo audit)
// ═══════════════════════════════════════════════════════════════════════════
const CATALOG = {
  legal_entity: {
    name: 'HN Hotels Private Limited',
    cin: 'U55101KA2023PTC182051', pan: 'AAHCH1024M', tan: 'BLRH15862A', udyam: 'UDYAM-KR-03-0606827',
    incorporated: '2023-12-11',
    registered_office: '#22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore 560051',
    heritage: 'Hamza family in Bangalore food trade since 1918 (four generations); Dakhni cuisine legacy.',
  },
  brands: {
    HE: { name: 'Hamza Express', format: 'QSR (biryani/kabab)', address: '#19, H.K.P. Road, Shivajinagar, Bangalore 560051', sku_count: 176, avg_ticket_rupees: 464, hours: '~07:00–23:00 IST',
          top_skus: ['Ghee Rice 9.7%', 'Chicken Kabab 8.6%', 'Tandoori Chicken 5.3%', 'Mutton Biryani 5.1%', 'Chicken Biryani 5.1%'] },
    NCH: { name: 'Nawabi Chai House', format: 'Irani chai cafe', address: 'Shivajinagar (same locality as HE)', avg_ticket_rupees: 349, hours: '~07:00–23:00 IST',
           concentration: ['Irani Chai 58.7% of revenue', 'Haleem (all sizes) 18%'] },
  },
  odoo_instances: {
    'odoo.hnhotels.in': { role: 'Unified finance (expenses, POs, vendor bills, payroll)', db: 'main', uid: 2, company_ids: { 1: 'HQ', 2: 'HE', 3: 'NCH' } },
    'test.hamzahotel.com': { role: 'HE Production POS (source of truth — confusingly named "test")', db: 'main' },
    'ops.hamzahotel.com': { role: 'NCH Production POS (source of truth)', db: 'main', nch_company_id: 10 },
    note: 'Company-id maps differ by instance: finance instance {1:HQ,2:HE,3:NCH}; HR/POS instance HE=1, NCH=10. Do not mix.',
  },
  channel_economics: {
    dine_in: '0% commission (best margin)',
    waba_direct_razorpay: '~2.36% gateway only',
    zomato_dining_HE: '~8.26% effective',
    swiggy_delivery: '~24.60% effective',
    zomato_delivery_under4km: '~23.41% effective',
    eazydiner: 'Rs 30/cover + 5% + 1.8% gateway',
    settlement_account: 'HDFC Current A/C ****4680',
  },
  signed_contracts: {
    zomato_delivery: 'HE + NCH — 02 Mar 2026',
    swiggy: 'HE + NCH — 02 Mar 2026',
    eazydiner: 'HE only — 28 Mar 2026',
    zomato_dining_HE: 'valid till 2046',
  },
  expense_categories: CAT_LABELS,
  staff_roles: {
    note: 'Names + roles only; PINs are never exposed by SPINE.',
    people: [
      { name: 'Nihaf', role: 'admin (owner)' }, { name: 'Naveen', role: 'cfo' },
      { name: 'Faheem', role: 'asstmgr / settlement' }, { name: 'Zoya', role: 'purchase / onboarding' },
      { name: 'Basheer', role: 'manager (NCH)' }, { name: 'Haneef', role: 'manager / viewer' }, { name: 'Nisar', role: 'manager / viewer' },
    ],
  },
  targets: {
    may_2026: { HE_rupees: 1500000, NCH_rupees: 1200000 },
    mar_2026_actuals: { HE_rupees: 659903, NCH_rupees: 1080731 },
  },
  marketing_direction: 'De-prioritize WABA as order destination (market unfamiliar). Push: Meta Ads, Influencer Marketing, Google Ads, Swiggy/Zomato organic + inorganic. WABA stays for retention/CRM.',
};

// ═══════════════════════════════════════════════════════════════════════════
// CREDENTIAL REFERENCE LAYER — names + locations only, NEVER values.
// The cloud chat asks "which credential unlocks X"; Claude Code (executor)
// fetches the actual value from the named store when an action requires it.
// ═══════════════════════════════════════════════════════════════════════════
const CREDENTIAL_REFERENCES = {
  policy: 'SPINE never returns secret values. These are identifiers + storage locations only.',
  stores: {
    pages_secret: 'Cloudflare Pages secret on project hn-hotels-site (wrangler pages secret put <NAME>)',
    worker_secret: 'Cloudflare Worker secret on the named worker (wrangler secret put <NAME>)',
    d1: 'Row in a D1 database (e.g. spine_keys.key_hash)',
  },
  references: [
    { name: 'SPINE_API_KEY / spine_keys', store: 'd1 (hash) or pages_secret', unlocks: 'This SPINE endpoint', sensitivity: 'high' },
    { name: 'ODOO_API_KEY', store: 'pages_secret', unlocks: 'odoo.hnhotels.in finance (expenses, POs, bills, payroll)', sensitivity: 'high' },
    { name: 'POS_ODOO_KEY / ODOO_NCH_POS_KEY', store: 'pages_secret', unlocks: 'HE (test.hamzahotel.com) / NCH (ops.hamzahotel.com) POS', sensitivity: 'high' },
    { name: 'DASHBOARD_KEY', store: 'pages_secret', unlocks: 'Legacy dashboard APIs (NOTE: also embedded in client JS — treat as semi-public)', sensitivity: 'high' },
    { name: 'CAMS_AUTH_TOKEN', store: 'pages_secret', unlocks: 'Internal service auth (HR/CAMS)', sensitivity: 'high' },
    { name: 'RAZORPAY_WEBHOOK_SECRET', store: 'worker_secret (razorpay-webhook)', unlocks: 'Razorpay webhook signature verification', sensitivity: 'high' },
    { name: 'RAZORPAY_KEY / RAZORPAY_SECRET', store: 'pages_secret on NCH project only — NOT on hn-hotels-site', unlocks: 'Live Razorpay gateway API (QR collections, fees, settlements)', sensitivity: 'high', gap: 'Add to hn-hotels-site Pages (or D1) to make resource=razorpay live; until then it serves the stale D1 mirror.' },
    { name: 'WA_HE_TOKEN / WA_NCH_TOKEN', store: 'pages_secret', unlocks: 'Meta WhatsApp Cloud API per brand', sensitivity: 'high' },
    { name: 'GOOGLE_ADS_* / GOOGLE_ORGANIC_REFRESH_TOKEN', store: 'pages_secret', unlocks: 'Google Ads + Business Profile', sensitivity: 'high' },
    { name: 'EXOTEL_API_KEY / EXOTEL_API_TOKEN', store: 'pages_secret', unlocks: 'Exotel voice', sensitivity: 'high' },
    { name: 'KITE_API_SECRET', store: 'pages_secret', unlocks: 'Zerodha Kite trading (wealth engine)', sensitivity: 'high' },
    { name: 'CRON_TOKEN', store: 'worker_secret (multiple crons)', unlocks: 'Cron job authentication', sensitivity: 'high' },
  ],
  rotation_flags: [
    { file: 'scripts/odoo-expense-skeleton.js', issue: 'literal ODOO_API_KEY committed', severity: 'critical', action: 'rotate on Odoo + strip from history' },
    { file: 'ops/aggregator/brand-dashboard.js & ext/aggregator/background.js', issue: 'literal dashboard key in client/extension code', severity: 'high', action: 'treat DASHBOARD_KEY as public; never reuse for new auth' },
  ],
};
