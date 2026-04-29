/**
 * hn-spend-sync-cron — every 5 min, pulls delta from Odoo into fact_spend.
 *
 * Read path: dashboard hits D1 fact_spend (fast, filterable).
 * Write path: only this worker touches Odoo. Odoo remains source of truth
 *             for the records themselves; D1 is the query layer.
 *
 * Sources:
 *   hnhotels   → odoo.hnhotels.in  (purchase.order, hr.expense, account.move)
 *   ops-hamza  → ops.hamzahotel.com (hr.expense — legacy NCH v2 path)
 *
 * Cursor: sync_cursor.last_write_date per (instance, model). Next run pulls
 * where write_date > cursor, so we catch both new rows and edits. Newly
 * deleted rows are handled by a reconcile scan (runs once per hour).
 *
 * Manual: GET /?key=<DASHBOARD_KEY>&instance=hnhotels|ops-hamza|all&force=1
 */

// ━━━ Config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const INSTANCES = {
  hnhotels: {
    url: 'https://odoo.hnhotels.in/jsonrpc',
    db: 'main',
    uid: 2,
    keyVar: 'ODOO_KEY_HNHOTELS',
    brandByCompany: { 1: 'HQ', 2: 'HE', 3: 'NCH' },
    // Sink for all brands from these dates onwards — no cap.
    cutoverMax: null,
  },
  'ops-hamza': {
    url: 'https://ops.hamzahotel.com/jsonrpc',
    db: 'main',
    uid: 2,
    keyVar: 'ODOO_KEY_OPS_HAMZA',
    // OLD instance: NCH=10, HE=1 (test only), HQ=13
    brandByCompany: { 1: 'HE', 10: 'NCH', 13: 'HQ' },
    // Instance-cutover: keep ops-hamza rows ONLY for the pre-migration
    // historical window. After the cutover date per brand, the same POs
    // also exist in odoo.hnhotels.in — taking both would double-count.
    // NCH moved to odoo.hnhotels.in on 2026-04-01 (Excel backfill + live).
    // HE moved on 2026-04-16 (live /ops/purchase/ + Excel backfill).
    // Sync worker ignores rows whose date_approve/date_order is >= cutover
    // for the matching brand; dedup audit 2026-04-20.
    cutoverMax: {
      NCH: '2026-03-31',
      HE:  '2026-04-15',
      HQ:  '2000-01-01',  // ops-hamza never had real HQ activity
    },
  },
};

// Canonical 15-category taxonomy (mirrors spend.js CATEGORIES parentName)
const PARENT_TO_CAT = {
  '01 · Raw Materials': 1,
  '14 · One-Time Capex': 2,
  '02 · Salaries': 3,
  '03 · Rent': 5,
  '04 · Utilities': 6,
  '05 · Police & Compliance': 7,
  '06 · Operations (Petty)': 8,
  '07 · Maintenance & Repairs': 9,
  '08 · Marketing & Promotion': 10,
  '09 · Technology': 11,
  '10 · Owner Drawings': 12,
  '11 · Miscellaneous': 13,
};

const CAT_LABEL = {
  1: 'Raw Material Purchase', 2: 'Capex / Equipment',
  3: 'Salary Payment',        4: 'Salary Advance',
  5: 'Rent',                  6: 'Utility Bill',
  7: 'Police / Hafta',        8: 'Petty / Operations',
  9: 'Maintenance / Repair', 10: 'Marketing / Ads',
 11: 'Tech / SaaS / Bank',   12: 'Owner Drawings',
 13: 'Misc / Other',         14: 'Vendor Bill (direct)',
 15: 'Vendor Bill (from PO)',
};

// NCH counter_expense category_code → our canonical 15-cat (spend.js)
const NCH_CODE_TO_CAT = {
  // Police bribes — all collapse to cat 7
  BEAT: 7, CHETA: 7, HOYSALA: 7, ASI: 7, WEEKLY: 7, CIRCLE: 7, SI: 7,
  // Raw material / consumables
  MILK: 1, RM: 1,
  // Utility
  GAS: 6, MISC: 6,
  // Petty / ops
  SUPPLIES: 8, CLEANING: 8, STAFF_FOOD: 8, TRANSPORT: 8,
  // Maintenance
  REPAIR: 9, EMERGENCY: 9,
  // Capex
  ASSET: 2,
  // Salary advance
  ADVANCE: 4,
  // Marketing + tech + legal
  MARKETING: 10, TECH: 11, LEGAL: 13,
};

// Cashier slot → PIN (from spend.js CASHIER_PINS)
const NCH_SLOT_TO_PIN = {
  CASH001: '14', // Kesmat
  CASH002: '43', // Nafees
};

// PIN mapping from dim_user (hnhotels instance uids)
const UID_TO_PIN_HNHOTELS = {
  2:  ['0305', 'Nihaf',    'admin'],
  5:  ['3754', 'Naveen',   'cfo'],
  6:  ['2026', 'Zoya',     'purchase'],
  7:  ['8523', 'Basheer',  'gm'],
  8:  ['6890', 'Tanveer',  'gm'],
  9:  ['6045', 'Faheem',   'asstmgr'],
 10:  ['3697', 'Yashwant', 'gm'],
 11:  ['15',   'Noor',     'cashier'],
 13:  ['14',   'Kesmat',   'cashier'],
 14:  ['43',   'Nafees',   'cashier'],
};

// ━━━ Odoo RPC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function odoo(instance, apiKey, model, method, args, kwargs = {}) {
  const resp = await fetch(instance.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [instance.db, instance.uid, apiKey, model, method, args, kwargs],
      },
    }),
  });
  const j = await resp.json();
  if (j.error) throw new Error(`[${model}.${method}] ${j.error.data?.message || JSON.stringify(j.error)}`);
  return j.result;
}

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function utcToIst(s) {
  if (!s) return null;
  // Odoo stores 'YYYY-MM-DD HH:MM:SS' in UTC
  const d = new Date(s.slice(0, 19).replace(' ', 'T') + 'Z');
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const Y = ist.getUTCFullYear();
  const M = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const D = String(ist.getUTCDate()).padStart(2, '0');
  const h = String(ist.getUTCHours()).padStart(2, '0');
  const m = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

function periodParts(istStr) {
  const d = new Date(istStr.slice(0, 10) + 'T00:00:00Z');
  const day = istStr.slice(0, 10);
  const month = istStr.slice(0, 7);
  // ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  const week = `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  return { period_day: day, period_week: week, period_month: month };
}

function hoursBetween(a, b) {
  const d1 = new Date(a.slice(0, 16).replace(' ', 'T') + 'Z');
  const d2 = new Date(b.slice(0, 16).replace(' ', 'T') + 'Z');
  return Math.abs((d1 - d2) / 3600000);
}

async function sha16(obj) {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ━━━ Normalizers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function normalizePO(po, lines, vendors, instance, instanceKey) {
  const cid = po.company_id[0];
  const brand = instance.brandByCompany[cid] || 'HQ';
  const occurred = utcToIst(po.date_approve || po.date_order);
  // Cutover skip: if this instance has a cutoverMax for this brand and the
  // PO is on/after that date, the SAME PO also lives on the new instance.
  // Silently drop to avoid double-count. See dedup audit 2026-04-20.
  if (instance.cutoverMax && instance.cutoverMax[brand]) {
    const poDay = (occurred || '').slice(0, 10);
    if (poDay && poDay > instance.cutoverMax[brand]) return [];
  }
  const recorded = utcToIst(po.create_date) || occurred;
  const periods = periodParts(occurred);
  const vendor = po.partner_id ? vendors[po.partner_id[0]] || {} : {};
  const uid = po.create_uid?.[0];
  const [pin, uname, urole] = (instanceKey === 'hnhotels' && UID_TO_PIN_HNHOTELS[uid]) ||
                               [null, po.create_uid?.[1] || null, 'unknown'];
  const stateMap = { draft:'draft', sent:'draft', 'to approve':'draft', purchase:'posted', done:'paid', cancel:'cancel' };
  const status = stateMap[po.state] || po.state;
  const backdated = recorded && occurred && hoursBetween(recorded, occurred) > 48 ? 1 : 0;
  const offHours = parseInt(occurred.slice(11, 13), 10) < 6 ? 1 : 0;

  const rows = [];
  for (const l of lines) {
    const row = {
      id: `${instanceKey}:purchase.order.line:${l.id}`,
      odoo_instance: instanceKey, odoo_model: 'purchase.order', odoo_id: po.id,
      odoo_line_id: l.id, odoo_name: po.name,
      occurred_at: occurred, recorded_at: recorded, ...periods,
      brand, outlet: null, company_id: cid,
      category_id: 1, category_label: CAT_LABEL[1], sub_kind: null,
      product_id: l.product_id?.[0] || null,
      product_name: l.product_id?.[1] || l.name || '',
      line_qty: l.product_qty || 0, line_uom: null,
      vendor_id: po.partner_id?.[0] || null,
      vendor_name: vendor.name || po.partner_id?.[1] || null,
      vendor_tags: JSON.stringify(vendor.tags || []),
      amount_total: l.price_total || 0,
      amount_untaxed: l.price_subtotal || 0,
      tax_amount: l.price_tax || 0,
      currency: 'INR',
      payment_mode: vendor.payment_terms && vendor.payment_terms !== 'Immediate Payment' ? 'credit' : 'cash',
      payment_status: status, payment_ref: null,
      source_ui: '/ops/purchase/',
      recorded_by_pin: pin, recorded_by_name: uname, recorded_by_role: urole,
      attachment_id: null, attachment_url: null, notes: null,
      flag_no_bill: 1, flag_off_hours: offHours, flag_above_avg: 0, flag_dup_candidate: 0,
      flag_backdated: backdated,
      last_synced_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    row.odoo_checksum = await sha16(row);
    rows.push(row);
  }
  return rows;
}

async function normalizeExpense(e, prodCategory, instance, instanceKey) {
  const cid = e.company_id[0];
  const brand = instance.brandByCompany[cid] || 'HQ';
  const occurred = `${e.date} 12:00`;
  if (instance.cutoverMax && instance.cutoverMax[brand]) {
    if (e.date > instance.cutoverMax[brand]) return null;
  }
  const recorded = utcToIst(e.create_date) || occurred;
  const periods = periodParts(occurred);
  const prodName = e.product_id?.[1] || '';
  const prodId = e.product_id?.[0] || null;
  const { parent, complete } = prodCategory[prodId] || {};
  let catId = PARENT_TO_CAT[parent] || 13;
  if (catId === 3 && /advance/i.test(prodName)) catId = 4;
  const empName = e.employee_id?.[1] || 'Unknown';
  const stateMap = { reported:'approved', approved:'approved', posted:'posted', done:'paid', refused:'cancel' };
  const status = stateMap[e.state] || e.state;
  const pmode = ({ own_account: 'cash', company_account: 'company_account' })[e.payment_mode] || 'cash';
  const backdated = hoursBetween(recorded, occurred) > 48 ? 1 : 0;
  const offHours = parseInt(occurred.slice(11, 13), 10) < 6 ? 1 : 0;

  const row = {
    id: `${instanceKey}:hr.expense:${e.id}`,
    odoo_instance: instanceKey, odoo_model: 'hr.expense', odoo_id: e.id,
    odoo_line_id: null, odoo_name: e.name,
    occurred_at: occurred, recorded_at: recorded, ...periods,
    brand, outlet: null, company_id: cid,
    category_id: catId, category_label: CAT_LABEL[catId], sub_kind: complete || null,
    product_id: prodId, product_name: prodName,
    line_qty: null, line_uom: null,
    vendor_id: null, vendor_name: empName, vendor_tags: '[]',
    amount_total: e.total_amount || 0,
    amount_untaxed: e.untaxed_amount || 0,
    tax_amount: e.tax_amount || 0,
    currency: 'INR',
    payment_mode: pmode, payment_status: status, payment_ref: null,
    source_ui: instanceKey === 'ops-hamza' ? 'v2-nch' : '/ops/expense/',
    recorded_by_pin: null, recorded_by_name: empName, recorded_by_role: 'unknown',
    attachment_id: null, attachment_url: null, notes: e.description || null,
    flag_no_bill: [1, 2, 14, 15].includes(catId) ? 1 : 0,
    flag_off_hours: offHours, flag_above_avg: 0, flag_dup_candidate: 0,
    flag_backdated: backdated,
    last_synced_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  row.odoo_checksum = await sha16(row);
  return row;
}

async function normalizeMove(m, lines, vendors, instance, instanceKey) {
  const cid = m.company_id[0];
  const brand = instance.brandByCompany[cid] || 'HQ';
  const occurred = `${m.invoice_date} 12:00`;
  if (instance.cutoverMax && instance.cutoverMax[brand]) {
    if (m.invoice_date > instance.cutoverMax[brand]) return [];
  }
  const recorded = utcToIst(m.create_date) || occurred;
  const periods = periodParts(occurred);
  const vendor = m.partner_id ? vendors[m.partner_id[0]] || {} : {};
  const uid = m.create_uid?.[0];
  const [pin, uname, urole] = (instanceKey === 'hnhotels' && UID_TO_PIN_HNHOTELS[uid]) ||
                               [null, m.create_uid?.[1] || null, 'unknown'];
  const isFromPO = !!m.invoice_origin;
  const catId = isFromPO ? 15 : 14;
  const payMap = { not_paid:'posted', in_payment:'partial', paid:'paid', partial:'partial', reversed:'cancel' };
  const status = payMap[m.payment_state || 'not_paid'] || 'posted';
  const backdated = hoursBetween(recorded, occurred) > 48 ? 1 : 0;

  const rows = [];
  for (const l of lines) {
    if (l.display_type === 'line_section' || l.display_type === 'line_note') continue;
    const row = {
      id: `${instanceKey}:account.move.line:${l.id}`,
      odoo_instance: instanceKey, odoo_model: 'account.move', odoo_id: m.id,
      odoo_line_id: l.id, odoo_name: m.name,
      occurred_at: occurred, recorded_at: recorded, ...periods,
      brand, outlet: null, company_id: cid,
      category_id: catId, category_label: CAT_LABEL[catId], sub_kind: m.invoice_origin || null,
      product_id: l.product_id?.[0] || null,
      product_name: l.product_id?.[1] || l.name || '',
      line_qty: l.quantity || 0, line_uom: null,
      vendor_id: m.partner_id?.[0] || null,
      vendor_name: vendor.name || m.partner_id?.[1] || null,
      vendor_tags: JSON.stringify(vendor.tags || []),
      amount_total: l.price_total || 0,
      amount_untaxed: l.price_subtotal || 0,
      tax_amount: (l.price_total || 0) - (l.price_subtotal || 0),
      currency: 'INR',
      payment_mode: vendor.payment_terms && vendor.payment_terms !== 'Immediate Payment' ? 'credit' : 'bank',
      payment_status: status, payment_ref: m.ref || null,
      source_ui: isFromPO ? '/ops/purchase/' : '/ops/expense/',
      recorded_by_pin: pin, recorded_by_name: uname, recorded_by_role: urole,
      attachment_id: null, attachment_url: null, notes: null,
      flag_no_bill: 0,  // bill itself IS the proof
      flag_off_hours: 0, flag_above_avg: 0, flag_dup_candidate: 0,
      flag_backdated: backdated,
      last_synced_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    row.odoo_checksum = await sha16(row);
    rows.push(row);
  }
  return rows;
}

// ━━━ Vendor + product-category cache (built per sync tick) ━━
async function loadVendorCache(instance, apiKey) {
  let fields = ['id', 'name', 'phone', 'category_id', 'property_supplier_payment_term_id', 'active'];
  let rows;
  try {
    rows = await odoo(instance, apiKey, 'res.partner', 'search_read',
      [[['supplier_rank', '>', 0]]],
      { fields, limit: 500 });
  } catch (e) {
    // ops-hamza has x_purchase_scope field we could use, but not required
    rows = [];
  }
  const tagIds = new Set();
  for (const r of rows) (r.category_id || []).forEach(t => tagIds.add(t));
  let tagsMap = {};
  if (tagIds.size > 0) {
    const tagRows = await odoo(instance, apiKey, 'res.partner.category', 'read',
      [[...tagIds]], { fields: ['name'] });
    for (const t of tagRows) tagsMap[t.id] = t.name;
  }
  const cache = {};
  for (const r of rows) {
    cache[r.id] = {
      name: r.name,
      phone: r.phone || '',
      payment_terms: r.property_supplier_payment_term_id?.[1] || '',
      tags: (r.category_id || []).map(t => tagsMap[t]).filter(Boolean),
    };
  }
  return cache;
}

async function loadProductCategoryCache(instance, apiKey, productIds) {
  if (!productIds.length) return {};
  const prodRows = await odoo(instance, apiKey, 'product.product', 'read',
    [[...productIds]], { fields: ['categ_id', 'name'] });
  const categIds = [...new Set(prodRows.map(p => p.categ_id?.[0]).filter(Boolean))];
  const categRows = categIds.length
    ? await odoo(instance, apiKey, 'product.category', 'read',
        [categIds], { fields: ['name', 'complete_name'] })
    : [];
  const categMap = {};
  for (const c of categRows) {
    const parts = (c.complete_name || c.name).split(' / ').map(s => s.trim());
    categMap[c.id] = {
      complete: c.complete_name || c.name,
      parent: parts.find(p => PARENT_TO_CAT[p]) || null,
    };
  }
  const out = {};
  for (const p of prodRows) {
    const info = categMap[p.categ_id?.[0]] || {};
    out[p.id] = { parent: info.parent, complete: info.complete };
  }
  return out;
}

// ━━━ NCH D1 cashier-counter expense ingest ━━━━━━━━━━━━━━━
// counter_expenses_v2 on nch-settlements D1. These expenses never hit
// Odoo because the NCH v2 /api/rectify flow writes only to NCH's own D1.
// This function pulls delta by id (row id is monotonic, recorded_at is ISO
// UTC) and upserts into fact_spend with odoo_instance='d1-nch'.
async function syncNchCounterExpenses(env, opts = {}) {
  const stats = { instance: 'd1-nch', rows: {}, errors: {} };
  const started = Date.now();
  if (!env.DB_NCH) { stats.errors['counter_expenses_v2'] = 'DB_NCH binding missing'; return stats; }

  // Cursor is the max id seen — simpler + more reliable than recorded_at
  // because recorded_at is a string that sorts fine but id is cheaper.
  const cur = await env.DB.prepare(
    `SELECT last_write_date FROM sync_cursor WHERE source_key = ?`
  ).bind('d1-nch:counter_expenses_v2').first();
  const sinceId = opts.force ? 0 : parseInt(cur?.last_write_date || '0', 10);

  let rows;
  try {
    const q = await env.DB_NCH.prepare(
      `SELECT ce.id, ce.category_code, ce.amount, ce.description,
              ce.recorded_by, ce.recorded_by_name, ce.recorded_at, ce.shift_id,
              vc.name AS category_name
       FROM counter_expenses_v2 ce
       LEFT JOIN v_expense_categories vc ON ce.category_code = vc.code
       WHERE ce.id > ?
       ORDER BY ce.id ASC
       LIMIT 500`
    ).bind(sinceId).all();
    rows = q.results || [];
  } catch (e) { stats.errors['counter_expenses_v2'] = e.message; return stats; }
  stats.rows['counter_expenses_v2'] = rows.length;
  if (!rows.length) {
    // Heartbeat the cursor so we know we checked
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare(
      `INSERT INTO sync_cursor (source_key, last_write_date, last_run_at, last_run_rows)
       VALUES (?, COALESCE((SELECT last_write_date FROM sync_cursor WHERE source_key = ?), '0'), ?, 0)
       ON CONFLICT(source_key) DO UPDATE SET last_run_at = excluded.last_run_at, last_run_rows = 0`
    ).bind('d1-nch:counter_expenses_v2', 'd1-nch:counter_expenses_v2', now).run();
    stats.duration_ms = Date.now() - started;
    stats.total_rows_upserted = 0;
    return stats;
  }

  const factRows = [];
  for (const r of rows) {
    const catId = NCH_CODE_TO_CAT[r.category_code] || 13;
    const pin = NCH_SLOT_TO_PIN[r.recorded_by] || null;
    const occurredIst = utcToIst(r.recorded_at.replace('T', ' ').replace('Z', ''));
    const periods = periodParts(occurredIst);
    const fr = {
      id: `d1-nch:counter_expenses_v2:${r.id}`,
      odoo_instance: 'd1-nch', odoo_model: 'counter_expenses_v2', odoo_id: r.id,
      odoo_line_id: null, odoo_name: `NCH-CE-${String(r.id).padStart(5,'0')}`,
      occurred_at: occurredIst, recorded_at: occurredIst, ...periods,
      brand: 'NCH', outlet: 'NCH-Koramangala', company_id: 10,
      category_id: catId, category_label: CAT_LABEL[catId],
      sub_kind: r.category_name || r.category_code,
      product_id: null, product_name: r.category_name || r.category_code,
      line_qty: null, line_uom: null,
      vendor_id: null, vendor_name: null, vendor_tags: '[]',
      amount_total: r.amount || 0, amount_untaxed: r.amount || 0, tax_amount: 0,
      currency: 'INR',
      payment_mode: 'cash', payment_status: 'posted',
      payment_ref: r.shift_id || null,
      source_ui: 'v2-nch',
      recorded_by_pin: pin, recorded_by_name: r.recorded_by_name || null,
      recorded_by_role: 'cashier',
      attachment_id: null, attachment_url: null, notes: r.description || null,
      flag_no_bill: 0,  // counter-cash tiny expenses, no bill expected
      flag_off_hours: parseInt(occurredIst.slice(11,13), 10) < 6 ? 1 : 0,
      flag_above_avg: 0, flag_dup_candidate: 0,
      flag_backdated: 0,
      last_synced_at: new Date().toISOString().slice(0,19).replace('T',' '),
    };
    fr.odoo_checksum = await sha16(fr);
    factRows.push(fr);
  }

  const COLUMNS = [
    'id','odoo_instance','odoo_model','odoo_id','odoo_line_id','odoo_name',
    'occurred_at','recorded_at','period_day','period_week','period_month',
    'brand','outlet','company_id',
    'category_id','category_label','sub_kind','product_id','product_name','line_qty','line_uom',
    'vendor_id','vendor_name','vendor_tags',
    'amount_total','amount_untaxed','tax_amount','currency',
    'payment_mode','payment_status','payment_ref',
    'source_ui','recorded_by_pin','recorded_by_name','recorded_by_role',
    'attachment_id','attachment_url','notes',
    'flag_no_bill','flag_off_hours','flag_above_avg','flag_dup_candidate','flag_backdated',
    'last_synced_at','odoo_checksum',
  ];
  const placeholders = COLUMNS.map(() => '?').join(',');
  const sql = `REPLACE INTO fact_spend (${COLUMNS.join(',')}) VALUES (${placeholders})`;
  const CHUNK = 50;
  for (let i = 0; i < factRows.length; i += CHUNK) {
    const chunk = factRows.slice(i, i + CHUNK);
    await env.DB.batch(chunk.map(r => env.DB.prepare(sql).bind(...COLUMNS.map(c => r[c] ?? null))));
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const maxId = rows[rows.length - 1].id;
  await env.DB.prepare(
    `REPLACE INTO sync_cursor (source_key, last_write_date, last_run_at, last_run_rows)
     VALUES (?, ?, ?, ?)`
  ).bind('d1-nch:counter_expenses_v2', String(maxId), now, factRows.length).run();

  stats.duration_ms = Date.now() - started;
  stats.total_rows_upserted = factRows.length;
  return stats;
}

// ━━━ Main sync routine per instance ━━━━━━━━━━━━━━━━━━━━━━━
async function syncInstance(env, instanceKey, opts = {}) {
  const instance = INSTANCES[instanceKey];
  const apiKey = env[instance.keyVar];
  if (!apiKey) return { instance: instanceKey, error: `missing secret ${instance.keyVar}` };
  const started = Date.now();
  const stats = { instance: instanceKey, rows: {}, errors: {} };

  // Fetch cursors
  const cursorRows = await env.DB.prepare(
    `SELECT source_key, last_write_date FROM sync_cursor WHERE source_key LIKE ?`
  ).bind(`${instanceKey}:%`).all();
  const cursors = {};
  for (const c of cursorRows.results || []) cursors[c.source_key] = c.last_write_date;

  const DEFAULT_SINCE = '2026-01-01 00:00:00';
  const since = (model) => opts.force ? DEFAULT_SINCE : (cursors[`${instanceKey}:${model}`] || DEFAULT_SINCE);

  // Preload vendor cache once per instance per tick
  const vendors = await loadVendorCache(instance, apiKey);

  const allRows = [];
  const newCursors = {};

  // ── purchase.order ─────────────────────────────────────
  try {
    const sincePO = since('purchase.order');
    const pos = await odoo(instance, apiKey, 'purchase.order', 'search_read',
      [[['write_date', '>', sincePO], ['state', '!=', 'cancel']]],
      { fields: ['id','name','date_order','date_approve','partner_id','company_id',
                 'state','amount_total','write_date','create_date','create_uid','order_line'],
        order: 'write_date asc', limit: 500 });
    stats.rows['purchase.order'] = pos.length;
    if (pos.length) {
      const lineIds = pos.flatMap(p => p.order_line || []);
      const lines = lineIds.length
        ? await odoo(instance, apiKey, 'purchase.order.line', 'read',
            [lineIds], { fields: ['id','order_id','product_id','name','product_qty',
                                  'price_unit','price_subtotal','price_total','price_tax'] })
        : [];
      const linesByPO = {};
      for (const l of lines) (linesByPO[l.order_id[0]] = linesByPO[l.order_id[0]] || []).push(l);
      for (const po of pos) {
        const rows = await normalizePO(po, linesByPO[po.id] || [], vendors, instance, instanceKey);
        allRows.push(...rows);
      }
      newCursors[`${instanceKey}:purchase.order`] = pos[pos.length - 1].write_date;
    }
  } catch (e) { stats.errors['purchase.order'] = e.message; }

  // ── hr.expense ─────────────────────────────────────────
  try {
    const sinceEx = since('hr.expense');
    const exps = await odoo(instance, apiKey, 'hr.expense', 'search_read',
      [[['write_date', '>', sinceEx], ['state', '!=', 'draft']]],
      { fields: ['id','name','date','create_date','write_date','employee_id','product_id',
                 'company_id','state','total_amount','untaxed_amount','tax_amount',
                 'payment_mode','description'],
        order: 'write_date asc', limit: 500 });
    stats.rows['hr.expense'] = exps.length;
    if (exps.length) {
      const prodIds = [...new Set(exps.map(e => e.product_id?.[0]).filter(Boolean))];
      const prodCat = await loadProductCategoryCache(instance, apiKey, prodIds);
      for (const e of exps) {
        const row = await normalizeExpense(e, prodCat, instance, instanceKey);
        if (row) allRows.push(row);  // null = cutover skipped
      }
      newCursors[`${instanceKey}:hr.expense`] = exps[exps.length - 1].write_date;
    }
  } catch (e) { stats.errors['hr.expense'] = e.message; }

  // ── account.move ───────────────────────────────────────
  try {
    const sinceMv = since('account.move');
    const moves = await odoo(instance, apiKey, 'account.move', 'search_read',
      [[['write_date', '>', sinceMv],
        ['move_type', 'in', ['in_invoice', 'in_refund']],
        ['state', '!=', 'cancel']]],
      { fields: ['id','name','invoice_date','create_date','write_date','partner_id','company_id',
                 'state','payment_state','amount_total','amount_untaxed','amount_tax',
                 'invoice_origin','ref','invoice_line_ids','create_uid'],
        order: 'write_date asc', limit: 500 });
    stats.rows['account.move'] = moves.length;
    if (moves.length) {
      const lineIds = moves.flatMap(m => m.invoice_line_ids || []);
      const lines = lineIds.length
        ? await odoo(instance, apiKey, 'account.move.line', 'read',
            [lineIds], { fields: ['id','move_id','product_id','name','quantity',
                                  'price_subtotal','price_total','display_type'] })
        : [];
      const linesByMove = {};
      for (const l of lines) (linesByMove[l.move_id[0]] = linesByMove[l.move_id[0]] || []).push(l);
      for (const m of moves) {
        const rows = await normalizeMove(m, linesByMove[m.id] || [], vendors, instance, instanceKey);
        allRows.push(...rows);
      }
      newCursors[`${instanceKey}:account.move`] = moves[moves.length - 1].write_date;
    }
  } catch (e) { stats.errors['account.move'] = e.message; }

  // ── Upsert into D1 in a single batch ──────────────────
  if (allRows.length) {
    const COLUMNS = [
      'id','odoo_instance','odoo_model','odoo_id','odoo_line_id','odoo_name',
      'occurred_at','recorded_at','period_day','period_week','period_month',
      'brand','outlet','company_id',
      'category_id','category_label','sub_kind','product_id','product_name','line_qty','line_uom',
      'vendor_id','vendor_name','vendor_tags',
      'amount_total','amount_untaxed','tax_amount','currency',
      'payment_mode','payment_status','payment_ref',
      'source_ui','recorded_by_pin','recorded_by_name','recorded_by_role',
      'attachment_id','attachment_url','notes',
      'flag_no_bill','flag_off_hours','flag_above_avg','flag_dup_candidate','flag_backdated',
      'last_synced_at','odoo_checksum',
    ];
    const placeholders = COLUMNS.map(() => '?').join(',');
    const sql = `REPLACE INTO fact_spend (${COLUMNS.join(',')}) VALUES (${placeholders})`;

    // D1 batch caps at 100 statements per call; chunk accordingly
    const CHUNK = 50;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      const stmts = chunk.map(r => env.DB.prepare(sql).bind(...COLUMNS.map(c => r[c] ?? null)));
      await env.DB.batch(stmts);
    }
  }

  // ── Update cursors ─────────────────────────────────────
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const cursorStmts = [];
  for (const [key, writeDate] of Object.entries(newCursors)) {
    cursorStmts.push(env.DB.prepare(
      `REPLACE INTO sync_cursor (source_key, last_write_date, last_run_at, last_run_rows, last_run_error)
       VALUES (?, ?, ?, ?, NULL)`
    ).bind(key, writeDate, now, allRows.length));
  }
  // Also write "touched" cursors for sources that returned 0 rows (so we have a heartbeat)
  for (const model of ['purchase.order','hr.expense','account.move']) {
    const key = `${instanceKey}:${model}`;
    if (!newCursors[key]) {
      cursorStmts.push(env.DB.prepare(
        `INSERT INTO sync_cursor (source_key, last_write_date, last_run_at, last_run_rows, last_run_error)
         VALUES (?, COALESCE((SELECT last_write_date FROM sync_cursor WHERE source_key = ?), ?), ?, 0, ?)
         ON CONFLICT(source_key) DO UPDATE SET last_run_at = excluded.last_run_at, last_run_rows = 0,
           last_run_error = excluded.last_run_error`
      ).bind(key, key, '2026-01-01 00:00:00', now,
             stats.errors[model] ? stats.errors[model].slice(0, 500) : null));
    }
  }
  if (cursorStmts.length) await env.DB.batch(cursorStmts);

  stats.duration_ms = Date.now() - started;
  stats.total_rows_upserted = allRows.length;
  return stats;
}

// ━━━ Post-process flags (cheap pass, runs every tick) ━━━━
async function recomputeFlags(env) {
  // Dup-candidate: same vendor + amount ±1 + within 1 day. Limited scope to
  // last 60 days so we don't rescan the whole table.
  const sinceDay = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare(`
    UPDATE fact_spend SET flag_dup_candidate = 1
    WHERE period_day >= ?
      AND id IN (
        SELECT a.id FROM fact_spend a, fact_spend b
        WHERE a.id < b.id
          AND a.vendor_id = b.vendor_id
          AND a.vendor_id IS NOT NULL
          AND abs(a.amount_total - b.amount_total) <= 1
          AND abs(julianday(a.period_day) - julianday(b.period_day)) <= 1
          AND a.period_day >= ? AND b.period_day >= ?
      )
  `).bind(sinceDay, sinceDay, sinceDay).run();

  // Above-vendor-avg: amount > 2× 30d rolling avg for that vendor (last 7d)
  const recentDay = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare(`
    UPDATE fact_spend SET flag_above_avg = 1
    WHERE period_day >= ?
      AND vendor_id IS NOT NULL
      AND amount_total > 2 * COALESCE((
        SELECT AVG(amount_total) FROM fact_spend f2
        WHERE f2.vendor_id = fact_spend.vendor_id
          AND date(f2.period_day) >= date(fact_spend.period_day, '-30 days')
          AND date(f2.period_day) <  date(fact_spend.period_day)
      ), amount_total * 10)
  `).bind(recentDay).run();
}

// ━━━ Dispatch ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function runSync(env, instancesRequested, opts = {}) {
  const allKeys = [...Object.keys(INSTANCES), 'd1-nch', 'nch-sales'];
  const keys = instancesRequested === 'all' ? allKeys : [instancesRequested];
  const results = [];
  for (const k of keys) {
    try {
      if (k === 'd1-nch')        results.push(await syncNchCounterExpenses(env, opts));
      else if (k === 'nch-sales') results.push(await syncNchSales(env, opts));
      else if (INSTANCES[k])     results.push(await syncInstance(env, k, opts));
      else                        results.push({ instance: k, error: 'unknown instance' });
    } catch (e) { results.push({ instance: k, error: e.message }); }
  }
  try { await recomputeFlags(env); } catch (e) { results.push({ flags_error: e.message }); }
  return { ran_at: new Date().toISOString(), results };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * NCH SALES RECONCILIATION — Slice B
 * Spec: docs/OPS-NCH-SALES-RECON-SPEC.md §6.2
 *
 * Six idempotent sub-flows. Cursors live in sales_sync_state (Slice A).
 * Each flow soft-fails and reports its own row count + error.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// Recognised NCH POS configs sourced from rm-ops.js + asset DB row 67.
// We don't hard-code labels — pos_config_registry is auto-populated by
// syncNchPosConfig and labelled by the owner via /api/sales (Slice C).
const NCH_OPS_COMPANY_ID = 10;

// Razorpay-side flag: payments to a runner QR are matched via
// razorpay_qr_registry. The 'role' on that row drives recon math.
const RAZORPAY_REST = 'https://api.razorpay.com';

async function syncNchSales(env, opts = {}) {
  const stats = { instance: 'nch-sales', rows: {}, errors: {} };
  const apiKey = env.ODOO_KEY_OPS_HAMZA;
  if (!apiKey) { stats.errors._init = 'ODOO_KEY_OPS_HAMZA missing'; return stats; }
  const opsInst = INSTANCES['ops-hamza'];

  const flow = async (source, fn) => {
    await markSalesRunning(env, source);
    try {
      const added = await fn();
      stats.rows[source] = added;
      await markSalesDone(env, source, 'ok', added, null);
    } catch (e) {
      stats.errors[source] = e.message;
      await markSalesDone(env, source, 'error', 0, e.message?.slice(0, 500));
    }
  };

  // 1. pos.config refresh — daily; skip if recent
  await flow('nch_pos_config', async () => {
    const cur = await getSalesCursor(env, 'nch_pos_config');
    if (!opts.force && cur?.last_run_at) {
      const ageH = (Date.now() - new Date(cur.last_run_at).getTime()) / 3600000;
      if (ageH < 24) return 0;
    }
    const cfgs = await odoo(opsInst, apiKey, 'pos.config', 'search_read',
      [[['company_id', '=', NCH_OPS_COMPANY_ID]]],
      { fields: ['id', 'name'] });
    let n = 0;
    for (const c of cfgs) {
      await env.DB.prepare(
        `INSERT INTO pos_config_registry (pos_config_id, brand, name, last_seen_at)
         VALUES (?, 'NCH', ?, ?)
         ON CONFLICT(pos_config_id) DO UPDATE SET
           name = excluded.name, last_seen_at = excluded.last_seen_at`
      ).bind(c.id, c.name, new Date().toISOString()).run();
      n++;
    }
    return n;
  });

  // 2. pos.order delta — by id since last cursor
  await flow('nch_pos_orders', async () => {
    const cur = await getSalesCursor(env, 'nch_pos_orders');
    const sinceId = opts.force ? 0 : (cur?.last_synced_id || 0);
    const orders = await odoo(opsInst, apiKey, 'pos.order', 'search_read',
      [[['company_id', '=', NCH_OPS_COMPANY_ID],
        ['state', 'in', ['paid', 'done', 'invoiced', 'posted']],
        ['id', '>', sinceId]]],
      { fields: ['id', 'name', 'date_order', 'amount_total', 'amount_tax',
                 'state', 'company_id', 'session_id', 'config_id', 'payment_ids'],
        order: 'id asc', limit: 1000 });
    if (!orders.length) return 0;

    // Pull PM names per order in one shot for payment_methods_csv denorm
    const allPmIds = [...new Set(orders.flatMap(o => o.payment_ids || []))];
    const pmRows = allPmIds.length
      ? await odoo(opsInst, apiKey, 'pos.payment', 'read', [allPmIds],
          { fields: ['id', 'pos_order_id', 'payment_method_id'] })
      : [];
    const pmById = Object.fromEntries(pmRows.map(p => [p.id, p]));

    let maxId = sinceId;
    let added = 0;
    for (const o of orders) {
      const dateIst = utcToIst(o.date_order);
      const day = (dateIst || '').slice(0, 10);
      const cfgId = o.config_id?.[0];
      const sessId = o.session_id?.[0] || null;
      const pmNames = (o.payment_ids || []).map(pid => pmById[pid]?.payment_method_id?.[1]).filter(Boolean);
      const csv = [...new Set(pmNames)].join(',');
      try {
        await env.DB.prepare(
          `INSERT INTO pos_orders_mirror (
             odoo_pos_order_id, brand, pos_config_id, session_id, order_name,
             order_date_ist, order_date_day,
             amount_total_paise, amount_tax_paise,
             state, payment_methods_csv, synced_at)
           VALUES (?, 'NCH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(odoo_pos_order_id) DO UPDATE SET
             amount_total_paise = excluded.amount_total_paise,
             amount_tax_paise   = excluded.amount_tax_paise,
             state              = excluded.state,
             payment_methods_csv= excluded.payment_methods_csv,
             synced_at          = excluded.synced_at`
        ).bind(
          o.id, cfgId, sessId, o.name,
          dateIst, day,
          Math.round((o.amount_total || 0) * 100),
          Math.round((o.amount_tax || 0) * 100),
          o.state, csv, new Date().toISOString()
        ).run();
        added++;
      } catch (e) {/* skip malformed row, continue */}
      if (o.id > maxId) maxId = o.id;
    }
    if (maxId > sinceId) await setSalesCursor(env, 'nch_pos_orders', { last_synced_id: maxId });
    return added;
  });

  // 3. pos.payment delta — bound to recently-synced orders only
  await flow('nch_pos_payments', async () => {
    const cur = await getSalesCursor(env, 'nch_pos_payments');
    const sinceId = opts.force ? 0 : (cur?.last_synced_id || 0);
    const pays = await odoo(opsInst, apiKey, 'pos.payment', 'search_read',
      [[['id', '>', sinceId]]],
      { fields: ['id', 'pos_order_id', 'payment_method_id', 'amount'],
        order: 'id asc', limit: 2000 });
    if (!pays.length) return 0;

    // Filter to NCH orders we already mirrored. Fetches order metadata
    // from D1 (cheaper than re-querying Odoo).
    const orderIds = [...new Set(pays.map(p => p.pos_order_id?.[0]).filter(Boolean))];
    const placeholders = orderIds.map(() => '?').join(',');
    const orderRows = orderIds.length
      ? (await env.DB.prepare(
          `SELECT odoo_pos_order_id, pos_config_id, order_date_day
             FROM pos_orders_mirror WHERE odoo_pos_order_id IN (${placeholders})`
        ).bind(...orderIds).all()).results
      : [];
    const orderById = Object.fromEntries(orderRows.map(r => [r.odoo_pos_order_id, r]));

    let maxId = sinceId;
    let added = 0;
    for (const p of pays) {
      const oid = p.pos_order_id?.[0];
      const meta = orderById[oid];
      if (!meta) { if (p.id > maxId) maxId = p.id; continue; } // not NCH or not yet mirrored
      try {
        await env.DB.prepare(
          `INSERT INTO pos_payments_mirror (
             odoo_pos_payment_id, odoo_pos_order_id, brand, order_date_day,
             pos_config_id, payment_method_id, payment_method_name,
             amount_paise, synced_at)
           VALUES (?, ?, 'NCH', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(odoo_pos_payment_id) DO UPDATE SET
             amount_paise = excluded.amount_paise,
             payment_method_name = excluded.payment_method_name,
             synced_at    = excluded.synced_at`
        ).bind(
          p.id, oid, meta.order_date_day, meta.pos_config_id,
          p.payment_method_id?.[0] || 0,
          p.payment_method_id?.[1] || 'unknown',
          Math.round((p.amount || 0) * 100),
          new Date().toISOString()
        ).run();
        added++;
      } catch (e) {/* skip */}
      if (p.id > maxId) maxId = p.id;
    }
    if (maxId > sinceId) await setSalesCursor(env, 'nch_pos_payments', { last_synced_id: maxId });
    return added;
  });

  // 4. pos.order.line delta — same shape, item-level
  await flow('nch_pos_lines', async () => {
    const cur = await getSalesCursor(env, 'nch_pos_lines');
    const sinceId = opts.force ? 0 : (cur?.last_synced_id || 0);
    const lines = await odoo(opsInst, apiKey, 'pos.order.line', 'search_read',
      [[['id', '>', sinceId]]],
      { fields: ['id', 'order_id', 'product_id', 'qty', 'price_subtotal_incl'],
        order: 'id asc', limit: 2000 });
    if (!lines.length) return 0;

    const orderIds = [...new Set(lines.map(l => l.order_id?.[0]).filter(Boolean))];
    const placeholders = orderIds.map(() => '?').join(',');
    const orderRows = orderIds.length
      ? (await env.DB.prepare(
          `SELECT odoo_pos_order_id, pos_config_id, order_date_day
             FROM pos_orders_mirror WHERE odoo_pos_order_id IN (${placeholders})`
        ).bind(...orderIds).all()).results
      : [];
    const orderById = Object.fromEntries(orderRows.map(r => [r.odoo_pos_order_id, r]));

    let maxId = sinceId;
    let added = 0;
    for (const l of lines) {
      const oid = l.order_id?.[0];
      const meta = orderById[oid];
      if (!meta) { if (l.id > maxId) maxId = l.id; continue; }
      try {
        await env.DB.prepare(
          `INSERT INTO pos_lines_mirror (
             odoo_pos_line_id, odoo_pos_order_id, brand, order_date_day,
             pos_config_id, product_id, product_name,
             qty, price_subtotal_incl_paise, synced_at)
           VALUES (?, ?, 'NCH', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(odoo_pos_line_id) DO UPDATE SET
             qty = excluded.qty,
             price_subtotal_incl_paise = excluded.price_subtotal_incl_paise,
             synced_at = excluded.synced_at`
        ).bind(
          l.id, oid, meta.order_date_day, meta.pos_config_id,
          l.product_id?.[0] || 0, l.product_id?.[1] || null,
          l.qty || 0,
          Math.round((l.price_subtotal_incl || 0) * 100),
          new Date().toISOString()
        ).run();
        added++;
      } catch (e) {/* skip */}
      if (l.id > maxId) maxId = l.id;
    }
    if (maxId > sinceId) await setSalesCursor(env, 'nch_pos_lines', { last_synced_id: maxId });
    return added;
  });

  // 5. Razorpay QR collections — mirror DB_NCH.razorpay_sync
  //
  // Architecture pivot 2026-04-29: NCH already syncs Razorpay → its own D1
  // (nch-settlements.razorpay_sync) for /api/validator's QR-bucket recon.
  // Mirroring that table is strictly better than calling Razorpay REST:
  //   - no third-party rate limits
  //   - no RAZORPAY_KEY/SECRET to manage on this worker
  //   - eventually consistent with /ops/v2's source of truth
  //   - qr_label (COUNTER / RUNNER_COUNTER / RUN001..005) is the operational
  //     bucket the validator already uses; we just map to our role enum.
  // Falls back to throwing if DB_NCH binding is missing (caller deals).
  await flow('nch_razorpay_qr_poll', async () => {
    if (!env.DB_NCH) throw new Error('DB_NCH binding missing — required for nch-settlements.razorpay_sync mirror');
    const cur = await getSalesCursor(env, 'nch_razorpay_qr_poll');
    const sinceId = opts.force ? 0 : (cur?.last_synced_id || 0);

    // Pull delta by id from the operational table. id is monotonic in nch-settlements.
    const rows = (await env.DB_NCH.prepare(
      `SELECT id, qr_id, qr_label, payment_id, amount, vpa, status, captured_at
         FROM razorpay_sync
        WHERE id > ?
          AND captured_at >= '2026-04-01'
        ORDER BY id ASC
        LIMIT 5000`
    ).bind(sinceId).all()).results || [];
    if (!rows.length) return 0;

    let added = 0; let maxId = sinceId;
    for (const r of rows) {
      // qr_label → role mapping. COUNTER + RUNNER_COUNTER share the counter
      // pool (validator treats them as the same bucket). RUN001..005 are
      // per-runner-slot, all role=runner.
      const role = (r.qr_label === 'COUNTER' || r.qr_label === 'RUNNER_COUNTER') ? 'counter' : 'runner';
      const ts = r.captured_at;
      const isoCap = ts.includes('T') ? ts : new Date(ts.replace(' ', 'T') + 'Z').toISOString();
      const istDay = new Date(new Date(isoCap).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      try {
        await env.DB.prepare(
          `INSERT INTO razorpay_qr_collections (
             razorpay_payment_id, qr_code_id, brand, role,
             amount_paise, fee_paise, tax_paise, status, method,
             vpa, contact, captured_at, captured_at_day,
             synced_at, synced_via, raw_payload, notes)
           VALUES (?, ?, 'NCH', ?, ?, 0, 0, ?, 'upi', ?, NULL, ?, ?, ?, 'rest_poll', NULL, ?)
           ON CONFLICT(razorpay_payment_id) DO UPDATE SET
             amount_paise = excluded.amount_paise,
             status       = excluded.status,
             synced_at    = excluded.synced_at`
        ).bind(
          r.payment_id, r.qr_id, role,
          Math.round((r.amount || 0) * 100),
          r.status || 'unknown',
          r.vpa || null,
          isoCap, istDay,
          new Date().toISOString(),
          `nch-settlements.razorpay_sync id=${r.id} label=${r.qr_label}`
        ).run();
        added++;
      } catch (_) {/* skip */}
      if (r.id > maxId) maxId = r.id;
    }
    if (maxId > sinceId) await setSalesCursor(env, 'nch_razorpay_qr_poll', { last_synced_id: maxId });
    return added;
  });

  // 6. recompute sales_recon_daily — rolling 14-day window
  await flow('nch_recon_daily_compute', async () => {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const startTs = Date.parse(today + 'T00:00:00Z') - 13 * 86400 * 1000;
    const days = [];
    for (let i = 0; i < 14; i++) {
      days.push(new Date(startTs + i * 86400 * 1000).toISOString().slice(0, 10));
    }
    const recomputeAt = new Date().toISOString();
    let touched = 0;
    for (const day of days) {
      const computed = await computeReconDay(env, 'NCH', day);
      await env.DB.prepare(
        `INSERT INTO sales_recon_daily (
           brand, day, gross_sales_paise,
           counter_cash_paise, counter_upi_pos_paise, counter_upi_rzp_paise, counter_card_paise,
           runner_sales_paise, runner_upi_paise, runner_cash_paise,
           total_cash_paise, total_upi_paise, upi_discrepancy_paise,
           complimentary_paise, unmapped_paise, order_count, last_recomputed_at)
         VALUES ('NCH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        day, computed.gross_sales_paise,
        computed.counter_cash_paise, computed.counter_upi_pos_paise,
        computed.counter_upi_rzp_paise, computed.counter_card_paise,
        computed.runner_sales_paise, computed.runner_upi_paise, computed.runner_cash_paise,
        computed.total_cash_paise, computed.total_upi_paise, computed.upi_discrepancy_paise,
        computed.complimentary_paise, computed.unmapped_paise, computed.order_count,
        recomputeAt
      ).run();
      touched++;
    }
    return touched;
  });

  stats.duration_ms = Date.now() - parseInt(stats.duration_ms || Date.now(), 10);
  return stats;
}

// Compute the reconciliation row for one day from the mirror tables.
// Pure read; called by both the cron flow and (in Slice C) /api/sales?action=recompute-day.
async function computeReconDay(env, brand, day) {
  const pmRows = (await env.DB.prepare(
    `SELECT payment_method_name, SUM(amount_paise) AS p
       FROM pos_payments_mirror WHERE brand = ? AND order_date_day = ?
      GROUP BY payment_method_name`
  ).bind(brand, day).all()).results || [];

  const qrRows = (await env.DB.prepare(
    `SELECT role, SUM(amount_paise) AS p
       FROM razorpay_qr_collections
      WHERE brand = ? AND captured_at_day = ? AND status = 'captured'
      GROUP BY role`
  ).bind(brand, day).all()).results || [];

  const orderRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') NOT LIKE '%Complimentary%'
                              THEN amount_total_paise ELSE 0 END), 0) AS gross,
            COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') LIKE '%Complimentary%'
                              THEN amount_total_paise ELSE 0 END), 0) AS comp
       FROM pos_orders_mirror WHERE brand = ? AND order_date_day = ?`
  ).bind(brand, day).first();

  const pm = (name) => pmRows.find(r => r.payment_method_name === name)?.p || 0;
  const qr = (role) => qrRows.find(r => r.role === role)?.p || 0;

  const RECOGNISED = new Set([
    'NCH Cash', 'NCH UPI', 'NCH Card', 'NCH Runner Ledger', 'NCH Token Issue',
    'Complimentary', 'Cash', 'UPI',
  ]);
  let unmapped = 0;
  for (const r of pmRows) {
    if (!RECOGNISED.has(r.payment_method_name)) unmapped += r.p || 0;
  }

  const counter_cash    = pm('NCH Cash') + pm('Cash');     // Cash fallback for legacy unbranded PM
  const counter_upi_pos = pm('NCH UPI') + pm('UPI');
  const counter_upi_rzp = qr('counter');
  const counter_card    = pm('NCH Card');
  const runner_sales    = pm('NCH Runner Ledger') + pm('NCH Token Issue');
  const runner_upi      = qr('runner');
  const runner_cash     = Math.max(0, runner_sales - runner_upi);
  const total_cash      = counter_cash + runner_cash;
  const total_upi       = counter_upi_rzp + runner_upi;
  const upi_discrepancy = counter_upi_pos - counter_upi_rzp;

  return {
    gross_sales_paise: orderRow?.gross || 0,
    counter_cash_paise: counter_cash,
    counter_upi_pos_paise: counter_upi_pos,
    counter_upi_rzp_paise: counter_upi_rzp,
    counter_card_paise: counter_card,
    runner_sales_paise: runner_sales,
    runner_upi_paise: runner_upi,
    runner_cash_paise: runner_cash,
    total_cash_paise: total_cash,
    total_upi_paise: total_upi,
    upi_discrepancy_paise: upi_discrepancy,
    complimentary_paise: orderRow?.comp || 0,
    unmapped_paise: unmapped,
    order_count: orderRow?.n || 0,
  };
}

async function getSalesCursor(env, src) {
  return await env.DB.prepare(
    `SELECT last_synced_id, last_synced_at, last_run_at, notes
       FROM sales_sync_state WHERE sync_source = ?`
  ).bind(src).first();
}
async function setSalesCursor(env, src, fields) {
  const sets = []; const binds = [];
  if ('last_synced_id' in fields) { sets.push('last_synced_id = ?'); binds.push(fields.last_synced_id); }
  if ('last_synced_at' in fields) { sets.push('last_synced_at = ?'); binds.push(fields.last_synced_at); }
  if (!sets.length) return;
  binds.push(src);
  await env.DB.prepare(`UPDATE sales_sync_state SET ${sets.join(', ')} WHERE sync_source = ?`).bind(...binds).run();
}
async function markSalesRunning(env, src) {
  await env.DB.prepare(
    `UPDATE sales_sync_state SET last_run_status = 'running', last_run_at = ? WHERE sync_source = ?`
  ).bind(new Date().toISOString(), src).run();
}
async function markSalesDone(env, src, status, added, err) {
  await env.DB.prepare(
    `UPDATE sales_sync_state
        SET last_run_status = ?, last_run_at = ?,
            rows_added_last_run = ?,
            rows_added_total = COALESCE(rows_added_total, 0) + ?,
            last_error = ?
      WHERE sync_source = ?`
  ).bind(status, new Date().toISOString(), added, added, err, src).run();
}

// ━━━ Worker exports ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }
    const instance = url.searchParams.get('instance') || 'all';
    const force = url.searchParams.get('force') === '1';
    const out = await runSync(env, instance, { force });
    return new Response(JSON.stringify(out, null, 2),
      { headers: { 'Content-Type': 'application/json' } });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env, 'all'));
  },
};
