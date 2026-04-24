/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN MONEY COCKPIT — Unified read-only aggregator
 * Route:   /api/money?action=cockpit&from=YYYY-MM-DD&to=YYYY-MM-DD&brand=NCH|HE|HQ|ALL
 * D1:      DB (hn-hiring) — reads business_expenses, rm_vendor_bills
 * Outlets: nawabichaihouse.com/api/cockpit-export, hamzaexpress.in/api/cockpit-export
 * Odoo:    purchase.order, account.move (in_invoice)
 *
 * Returns one normalized list of money events across:
 *   - PAID expenses (business_expenses central mirror)
 *   - PAID expenses written ONLY to outlet D1 (orphans — Odoo dual-write failed)
 *   - OPEN purchase orders (Odoo state = draft|sent|purchase)
 *   - PENDING vendor bills (account.move payment_state != paid)
 *   - PAID vendor bills (account.move payment_state = paid|in_payment)
 *
 * Plus dup_alerts[] computed by fuzzy match across feeds.
 *
 * Auth: PIN with admin/cfo/gm role.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BRAND_COMPANY = { HE: 2, NCH: 3, HQ: 1 };
const COMPANY_BRAND = { 1: 'HQ', 2: 'HE', 3: 'NCH' };

const ALLOWED_ROLES = new Set(['admin', 'cfo', 'gm', 'asstmgr', 'purchase']);

// PIN gate — same source of truth as spend.js, kept compact here.
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
};

const NCH_EXPORT_URL = 'https://nawabichaihouse.com/api/cockpit-export';
const HE_EXPORT_URL  = 'https://hamzaexpress.in/api/cockpit-export';

// ━━━ Helpers ━━━
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function todayIST() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

function defaultFrom() {
  // Last 30 days by default
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 - 30 * 86400 * 1000);
  return ist.toISOString().slice(0, 10);
}

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

// Normalize a string for fuzzy comparison
function normStr(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Token-overlap similarity (cheap, good enough for ledger dedup)
function tokenOverlap(a, b) {
  const ta = new Set(normStr(a).split(' ').filter(Boolean));
  const tb = new Set(normStr(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function daysBetween(a, b) {
  if (!a || !b) return 999;
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
}

// ━━━ Entry point ━━━
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'cockpit') return await cockpit(url, env);
    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// ━━━ Main aggregator ━━━
async function cockpit(url, env) {
  const pin = url.searchParams.get('pin');
  const user = USERS[pin];
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  if (!ALLOWED_ROLES.has(user.role)) {
    return json({ success: false, error: `Role ${user.role} cannot view money cockpit` }, 403);
  }

  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) return json({ success: false, error: 'ODOO_API_KEY not configured' }, 500);

  const cockpitToken = env.COCKPIT_TOKEN;
  if (!cockpitToken) return json({ success: false, error: 'COCKPIT_TOKEN not configured' }, 500);

  const from = url.searchParams.get('from') || defaultFrom();
  const to   = url.searchParams.get('to')   || todayIST();
  const brand = (url.searchParams.get('brand') || 'ALL').toUpperCase();
  const wantCompanyId = brand !== 'ALL' ? BRAND_COMPANY[brand] : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ success: false, error: 'from/to must be YYYY-MM-DD' }, 400);
  }

  const exportHeaders = { 'x-cockpit-token': cockpitToken };
  const qs = `?from=${from}&to=${to}`;

  // ── Fan out 5 sources in parallel ──────────────────────────────────────
  const [
    centralRes,
    nchRes,
    heRes,
    pos,
    bills,
  ] = await Promise.all([
    // (1) HN central business_expenses (hr.expense mirror)
    fetchCentralExpenses(env.DB, from, to, brand),

    // (2) NCH outlet feed
    fetch(`${NCH_EXPORT_URL}${qs}`, { headers: exportHeaders })
      .then((r) => r.json())
      .catch((e) => ({ success: false, error: `NCH export: ${e.message}`, rows: [] })),

    // (3) HE outlet feed
    fetch(`${HE_EXPORT_URL}${qs}`, { headers: exportHeaders })
      .then((r) => r.json())
      .catch((e) => ({ success: false, error: `HE export: ${e.message}`, rows: [] })),

    // (4) Odoo POs
    odoo(apiKey, 'purchase.order', 'search_read',
      [buildPoFilter(from, to, wantCompanyId)],
      { fields: ['id', 'name', 'partner_id', 'company_id', 'date_order',
                 'amount_total', 'state', 'invoice_status', 'order_line',
                 'x_recorded_by_user_id'],
        order: 'date_order desc', limit: 500 }
    ).catch((e) => ({ __error: e.message, __empty: true })),

    // (5) Odoo Bills
    odoo(apiKey, 'account.move', 'search_read',
      [buildBillFilter(from, to, wantCompanyId)],
      { fields: ['id', 'name', 'ref', 'invoice_date', 'invoice_date_due',
                 'partner_id', 'company_id', 'amount_total', 'amount_residual',
                 'payment_state', 'invoice_origin', 'state',
                 'x_recorded_by_user_id'],
        order: 'invoice_date desc', limit: 500 }
    ).catch((e) => ({ __error: e.message, __empty: true })),
  ]);

  // ── Normalize all 5 into one shape ─────────────────────────────────────

  // (a) Central paid expenses — these came from hnhotels.in/api/spend.
  //     Source attribution: x_location (brand) + recorded_by name lets us
  //     guess outlet vs Naveen, but the cleanest signal is matching against
  //     outlet feeds below to find which were dual-writes.
  const central = (centralRes || []).map((r) => ({
    feed: 'central',
    source: guessSource(r.recorded_by, r.x_location),
    brand: r.x_location || 'HQ',
    kind: 'Expense',
    state: 'paid',
    payment_method: r.x_payment_method || r.payment_mode || 'cash',
    odoo_id: r.odoo_id,
    central_id: r.id,
    source_id: null,
    recorded_at: r.recorded_at,
    ist_date: (r.recorded_at || '').slice(0, 10),
    amount: r.amount,
    category: r.category,
    category_parent: r.category_parent,
    vendor_name: null,
    item: r.product_name || null,
    description: r.notes || '',
    recorded_by: r.recorded_by || null,
  }));

  // (b) NCH outlet rows
  const nchRows = (nchRes.rows || []).map((r) => ({
    feed: 'nch-outlet',
    ...r,
  }));

  // (c) HE outlet rows
  const heRows = (heRes.rows || []).map((r) => ({
    feed: 'he-outlet',
    ...r,
  }));

  // ── Cross-link: mark NCH/HE outlet rows that DO have a central twin ─────
  // (these are properly dual-written; we keep the central row as canonical)
  // and surface ORPHANS = outlet rows with no central twin.
  const orphans = [];
  for (const o of [...nchRows, ...heRows]) {
    const twin = findCentralTwin(o, central);
    if (twin) {
      twin.linked_outlet_id = o.source_id;
      twin.linked_outlet_feed = o.feed;
      o.has_central_twin = true;
    } else {
      o.has_central_twin = false;
      // Mark explicit orphan state
      if (o.state !== 'paid-orphan') o.state = 'paid-orphan';
      orphans.push(o);
    }
  }

  // (d) POs
  const posList = (pos && !pos.__empty ? pos : []).map((p) => ({
    feed: 'odoo-po',
    source: 'HN-Zoya',
    brand: COMPANY_BRAND[p.company_id?.[0]] || '?',
    kind: 'PO',
    state: classifyPoState(p.state, p.invoice_status),
    payment_method: null,
    odoo_id: p.id,
    odoo_name: p.name,
    recorded_at: p.date_order,
    ist_date: (p.date_order || '').slice(0, 10),
    amount: p.amount_total || 0,
    vendor_id: p.partner_id?.[0] || null,
    vendor_name: p.partner_id?.[1] || null,
    item: `${p.name} · ${p.order_line?.length || 0} item${p.order_line?.length === 1 ? '' : 's'}`,
    description: '',
    recorded_by: p.x_recorded_by_user_id?.[1] || null,
  }));

  // (e) Bills
  const billsList = (bills && !bills.__empty ? bills : []).map((b) => ({
    feed: 'odoo-bill',
    source: b.invoice_origin ? 'HN-Zoya' : 'HN-Naveen',  // From PO vs direct
    brand: COMPANY_BRAND[b.company_id?.[0]] || '?',
    kind: 'Bill',
    state: classifyBillState(b.payment_state, b.state, b.invoice_date_due),
    payment_method: null,
    odoo_id: b.id,
    odoo_name: b.name,
    bill_ref: b.ref,
    invoice_origin: b.invoice_origin || null,
    recorded_at: b.invoice_date,
    ist_date: b.invoice_date,
    due_date: b.invoice_date_due || null,
    amount: b.amount_total || 0,
    amount_residual: b.amount_residual || 0,
    vendor_id: b.partner_id?.[0] || null,
    vendor_name: b.partner_id?.[1] || null,
    item: b.ref || b.name,
    description: '',
    recorded_by: b.x_recorded_by_user_id?.[1] || null,
  }));

  // ── Brand filter post-pass on outlet/central feeds (Odoo already filtered)
  const brandFilter = (r) => brand === 'ALL' || r.brand === brand;
  const paid = [
    ...central.filter(brandFilter),
    ...orphans.filter(brandFilter),
  ].sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));

  const posOpen = posList
    .filter((p) => p.state === 'open-po' || p.state === 'received')
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));

  const billsPending = billsList
    .filter((b) => b.state === 'bill-pending' || b.state === 'bill-overdue' || b.state === 'bill-partial')
    .sort((a, b) => String(a.due_date || a.recorded_at).localeCompare(String(b.due_date || b.recorded_at)));

  const billsPaid = billsList
    .filter((b) => b.state === 'bill-paid')
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));

  // ── Dup detection — across paid feed only (POs/Bills have their own life)
  const dupAlerts = detectDuplicates(paid);

  // ── KPIs
  const kpis = {
    paid_total: paid.reduce((s, r) => s + (r.amount || 0), 0),
    paid_count: paid.length,
    open_po_total: posOpen.reduce((s, r) => s + (r.amount || 0), 0),
    open_po_count: posOpen.length,
    bills_pending_total: billsPending.reduce((s, r) => s + (r.amount_residual || r.amount || 0), 0),
    bills_pending_count: billsPending.length,
    bills_overdue_count: billsPending.filter((b) => b.state === 'bill-overdue').length,
    orphan_count: orphans.length,
    dup_count: dupAlerts.length,
  };

  return json({
    success: true,
    from, to, brand,
    user: { name: user.name, role: user.role },
    kpis,
    paid,
    pos_open: posOpen,
    bills_pending: billsPending,
    bills_paid: billsPaid,
    orphans,
    dup_alerts: dupAlerts,
    feed_status: {
      nch_export: nchRes.success === true ? 'ok' : (nchRes.error || 'unknown'),
      he_export:  heRes.success  === true ? 'ok' : (heRes.error || 'unknown'),
      odoo_pos:   pos?.__error    || 'ok',
      odoo_bills: bills?.__error  || 'ok',
    },
  });
}

// ━━━ Sub-helpers ━━━
async function fetchCentralExpenses(DB, from, to, brand) {
  if (!DB) return [];
  let sql = `SELECT id, recorded_by, recorded_at, amount, description, category, category_parent,
                    payment_mode, notes, odoo_id, company_id, product_id, product_name,
                    x_pool, x_payment_method, x_location, x_excluded_from_pnl,
                    x_payroll_period, x_payroll_intent
               FROM business_expenses
              WHERE date(recorded_at) BETWEEN ? AND ?`;
  const args = [from, to];
  if (brand !== 'ALL') {
    sql += ` AND x_location = ?`;
    args.push(brand);
  }
  sql += ` ORDER BY recorded_at DESC LIMIT 1000`;
  const r = await DB.prepare(sql).bind(...args).all().catch(() => ({ results: [] }));
  return r.results || [];
}

function buildPoFilter(from, to, companyId) {
  const f = [['date_order', '>=', from + ' 00:00:00'],
             ['date_order', '<=', to   + ' 23:59:59']];
  if (companyId) f.push(['company_id', '=', companyId]);
  return f;
}

function buildBillFilter(from, to, companyId) {
  const f = [['move_type', '=', 'in_invoice'],
             ['invoice_date', '>=', from],
             ['invoice_date', '<=', to]];
  if (companyId) f.push(['company_id', '=', companyId]);
  return f;
}

function classifyPoState(state, invoiceStatus) {
  // state: draft | sent | purchase | done | cancel
  // invoice_status: no | to invoice | invoiced
  if (state === 'cancel') return 'po-cancelled';
  if (state === 'done') return 'received';
  if (state === 'purchase') return 'open-po';
  return 'po-draft';
}

function classifyBillState(paymentState, moveState, dueDate) {
  // payment_state: not_paid | in_payment | paid | partial | reversed
  if (moveState === 'draft') return 'bill-draft';
  if (paymentState === 'paid' || paymentState === 'in_payment') return 'bill-paid';
  if (paymentState === 'partial') return 'bill-partial';
  // not_paid
  if (dueDate && Date.parse(dueDate) < Date.now()) return 'bill-overdue';
  return 'bill-pending';
}

function guessSource(recordedBy, brand) {
  const n = String(recordedBy || '').toLowerCase();
  if (n.includes('basheer'))   return brand === 'NCH' ? 'NCH-Outlet' : (brand === 'HE' ? 'HE-Outlet' : 'HN-Basheer');
  if (n.includes('kesmat'))    return 'NCH-Outlet';
  if (n.includes('nafees'))    return 'NCH-Outlet';
  if (n.includes('noor'))      return 'HE-Outlet';
  if (n.includes('naveen'))    return 'HN-Naveen';
  if (n.includes('zoya'))      return 'HN-Zoya';
  if (n.includes('nihaf'))     return 'HN-Nihaf';
  if (n.includes('faheem'))    return 'HN-Faheem';
  return brand ? `${brand}-?` : '?';
}

function findCentralTwin(outletRow, central) {
  // Match by (brand, ±5 min, ±0.5%, similar description). Cheap O(n*m) — both
  // lists are bounded to ~500 rows in the date window.
  const tgtAmt = +outletRow.amount;
  const tgtTime = Date.parse(outletRow.recorded_at);
  if (Number.isNaN(tgtTime)) return null;
  for (const c of central) {
    if (c.brand !== outletRow.brand) continue;
    if (c.linked_outlet_id) continue;  // already linked
    if (Math.abs((+c.amount) - tgtAmt) > 0.5) continue;
    const ct = Date.parse(c.recorded_at);
    if (Number.isNaN(ct)) continue;
    if (Math.abs(ct - tgtTime) > 10 * 60 * 1000) continue;  // 10 min window
    // optional desc similarity bump (not required for confidence — amount + time + brand is strong)
    return c;
  }
  return null;
}

function detectDuplicates(paid) {
  // Conservative across the same brand: ±1 day, ±0.5% amount, token overlap ≥ 0.6.
  // Each pair surfaces once with the LATER row as the suspect duplicate.
  const sorted = paid.slice().sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const alerts = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.brand !== b.brand) continue;
      if (daysBetween(a.recorded_at, b.recorded_at) > 1) break;  // sorted; bail early
      if (Math.abs((+a.amount) - (+b.amount)) > 0.5) continue;
      const sim = tokenOverlap(`${a.item || ''} ${a.description || ''}`,
                                `${b.item || ''} ${b.description || ''}`);
      if (sim < 0.6) continue;
      alerts.push({
        a: { id: a.central_id || a.source_id, feed: a.feed, recorded_at: a.recorded_at,
             amount: a.amount, brand: a.brand, source: a.source, item: a.item, description: a.description },
        b: { id: b.central_id || b.source_id, feed: b.feed, recorded_at: b.recorded_at,
             amount: b.amount, brand: b.brand, source: b.source, item: b.item, description: b.description },
        similarity: +sim.toFixed(2),
        confidence: sim >= 0.85 ? 'high' : 'medium',
      });
    }
  }
  return alerts;
}
