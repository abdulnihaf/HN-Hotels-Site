/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN VENDOR API — vendor master + RM mapping + Odoo sync
 *
 * Routes (all GET; POST for create/update; PIN-gated):
 *   GET  /api/vendor?action=list&brand=ALL|HE|NCH|BOTH&q=&pin=
 *   GET  /api/vendor?action=get&id=N&pin=
 *   GET  /api/vendor?action=get&key=abid-cheese-balls&pin=
 *   GET  /api/vendor?action=spend-summary&id=N&pin=
 *   GET  /api/vendor?action=odoo-sync&pin= (admin only)
 *   GET  /api/vendor?action=health (no auth — pulse check)
 *   POST /api/vendor?action=create&pin=
 *   POST /api/vendor?action=update&pin=
 *   POST /api/vendor?action=add-product&pin=
 *   POST /api/vendor?action=remove-product&pin=
 *   POST /api/vendor?action=merge&pin= (admin only)
 *
 * D1: vendors, vendor_products, vendor_log
 * Odoo: res.partner (supplier_rank > 0) — pulled via odoo.hnhotels.in/jsonrpc
 * Cross-references: business_expenses, rm_vendor_bills (read-only spend)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_ROLES        = new Set(['admin', 'cfo', 'gm', 'asstmgr', 'purchase']);
const ADMIN_ROLES          = new Set(['admin', 'cfo']);
const VALID_PAYMENT_TERMS  = new Set(['on_delivery', '7d', '15d', '30d', '45d', 'other']);
const VALID_PRIMARY_BRANDS = new Set(['HE', 'NCH', 'BOTH']);

// Mirror of money.js USERS dict — single source of truth lives there;
// duplicate kept compact here for stand-alone deploy convenience.
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

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function badRequest(msg)   { return json({ ok: false, error: msg }, 400); }
function unauthorized()    { return json({ ok: false, error: 'auth_required' }, 401); }
function forbidden()       { return json({ ok: false, error: 'forbidden' }, 403); }
function notFound(msg)     { return json({ ok: false, error: msg || 'not_found' }, 404); }
function serverError(msg)  { return json({ ok: false, error: 'server_error', detail: msg }, 500); }

function auth(pin) {
  if (!pin) return null;
  const u = USERS[String(pin).trim()];
  if (!u || !ALLOWED_ROLES.has(u.role)) return null;
  return u;
}

function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 60);
}

async function odooCall(apiKey, model, method, args = [], kwargs = {}) {
  if (!apiKey) throw new Error('ODOO_API_KEY missing');
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, apiKey, model, method, args, kwargs],
      },
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`odoo:${j.error.message || 'unknown'}`);
  return j.result;
}

async function logVendor(db, vendor_id, action, payload, actor) {
  try {
    await db.prepare(
      `INSERT INTO vendor_log (vendor_id, action, payload, actor) VALUES (?, ?, ?, ?)`
    ).bind(vendor_id, action, JSON.stringify(payload || null), actor || null).run();
  } catch (_) { /* logging is best-effort */ }
}

// ━━━ Action handlers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleHealth(env) {
  let dbOk = false, odooOk = false;
  try {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM vendors`).first();
    dbOk = r && typeof r.n === 'number';
  } catch (_) { dbOk = false; }
  try {
    const c = await odooCall(env.ODOO_API_KEY, 'res.partner', 'search_count',
      [[['supplier_rank', '>', 0]]]);
    odooOk = typeof c === 'number';
  } catch (_) { odooOk = false; }
  return json({ ok: true, db: dbOk, odoo: odooOk, ts: Date.now() });
}

async function handleList(env, url) {
  const brand = (url.searchParams.get('brand') || 'ALL').toUpperCase();
  const q     = (url.searchParams.get('q') || '').trim().toLowerCase();
  let where   = `WHERE active = 1 AND merged_into_id IS NULL`;
  const binds = [];

  if (brand !== 'ALL' && VALID_PRIMARY_BRANDS.has(brand)) {
    where += ` AND (primary_brand = ? OR primary_brand = 'BOTH')`;
    binds.push(brand);
  }
  if (q) {
    where += ` AND (LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(owner_contact) LIKE ?)`;
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await env.DB.prepare(
    `SELECT v.id, v.vendor_key, v.odoo_partner_id, v.name, v.phone, v.owner_contact,
            v.primary_brand, v.payment_terms, v.bank_upi, v.delivery_slot, v.address,
            v.updated_at,
            (SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = v.id AND vp.active = 1) AS product_count
       FROM vendors v
       ${where}
       ORDER BY name COLLATE NOCASE ASC`
  ).bind(...binds).all();

  return json({ ok: true, vendors: rows.results || [], total: (rows.results || []).length });
}

async function handleGet(env, url) {
  const id  = url.searchParams.get('id');
  const key = url.searchParams.get('key');
  if (!id && !key) return badRequest('id_or_key_required');

  const sql = id
    ? `SELECT * FROM vendors WHERE id = ? LIMIT 1`
    : `SELECT * FROM vendors WHERE vendor_key = ? LIMIT 1`;
  const v = await env.DB.prepare(sql).bind(id || key).first();
  if (!v) return notFound('vendor_not_found');

  const products = (await env.DB.prepare(
    `SELECT id, hn_rm_code, product_name, uom, qty_hint, unit_price, unit_price_at, is_primary_vendor, active
       FROM vendor_products WHERE vendor_id = ? ORDER BY product_name COLLATE NOCASE ASC`
  ).bind(v.id).all()).results || [];

  // Recent vendor_log entries (last 20)
  const recentLog = (await env.DB.prepare(
    `SELECT action, payload, actor, at FROM vendor_log
       WHERE vendor_id = ? ORDER BY at DESC LIMIT 20`
  ).bind(v.id).all()).results || [];

  return json({ ok: true, vendor: v, products, recent_log: recentLog });
}

async function handleSpendSummary(env, url) {
  // Aggregate spend per vendor across business_expenses + rm_vendor_bills (last 12 months).
  const id = url.searchParams.get('id');
  if (!id) return badRequest('id_required');
  const v = await env.DB.prepare(`SELECT id, name, odoo_partner_id FROM vendors WHERE id = ?`).bind(id).first();
  if (!v) return notFound('vendor_not_found');

  const since = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;

  // Defensive: tables may or may not exist — wrap in try.
  let bexp = { total_amount: 0, n: 0 };
  let rmbills = { total_amount: 0, n: 0 };
  try {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total_amount, COUNT(*) AS n
         FROM business_expenses
         WHERE (vendor_name = ? OR vendor_id = ?) AND created_at >= ?`
    ).bind(v.name, v.odoo_partner_id || -1, since).first();
    if (r) bexp = r;
  } catch (_) {}
  try {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_total),0) AS total_amount, COUNT(*) AS n
         FROM rm_vendor_bills
         WHERE (vendor_name = ? OR partner_id = ?) AND invoice_date >= date('now','-365 day')`
    ).bind(v.name, v.odoo_partner_id || -1).first();
    if (r) rmbills = r;
  } catch (_) {}

  return json({
    ok: true,
    vendor_id: v.id,
    vendor_name: v.name,
    window_days: 365,
    business_expenses: bexp,
    rm_vendor_bills: rmbills,
    total_amount: (bexp.total_amount || 0) + (rmbills.total_amount || 0),
    total_transactions: (bexp.n || 0) + (rmbills.n || 0),
  });
}

async function handleCreate(env, body, actor) {
  const name = String(body.name || '').trim();
  if (!name) return badRequest('name_required');

  const key = body.vendor_key ? slugify(body.vendor_key) : slugify(name);
  if (!key) return badRequest('vendor_key_unslugifiable');

  const exists = await env.DB.prepare(`SELECT id FROM vendors WHERE vendor_key = ?`).bind(key).first();
  if (exists) return badRequest('vendor_key_exists');

  const pt = body.payment_terms || null;
  if (pt && !VALID_PAYMENT_TERMS.has(pt)) return badRequest('invalid_payment_terms');
  const pb = body.primary_brand || null;
  if (pb && !VALID_PRIMARY_BRANDS.has(pb)) return badRequest('invalid_primary_brand');

  const r = await env.DB.prepare(
    `INSERT INTO vendors
       (vendor_key, name, phone, alternate_phone, owner_contact, address, gstin, pan,
        bank_upi, payment_terms, payment_terms_other, primary_brand, delivery_slot, notes,
        active, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, unixepoch())`
  ).bind(
    key, name, body.phone || null, body.alternate_phone || null, body.owner_contact || null,
    body.address || null, body.gstin || null, body.pan || null,
    body.bank_upi || null, pt, body.payment_terms_other || null, pb, body.delivery_slot || null,
    body.notes || null, `${actor.name} (${actor.role})`
  ).run();

  const id = r.meta.last_row_id;
  await logVendor(env.DB, id, 'create', body, `${actor.name} (${actor.role})`);
  return json({ ok: true, id, vendor_key: key });
}

async function handleUpdate(env, body, actor) {
  const id = body.id;
  if (!id) return badRequest('id_required');
  const v = await env.DB.prepare(`SELECT * FROM vendors WHERE id = ?`).bind(id).first();
  if (!v) return notFound('vendor_not_found');

  const fields = ['name','phone','alternate_phone','owner_contact','address','gstin','pan',
    'bank_upi','payment_terms','payment_terms_other','primary_brand','delivery_slot','notes','active'];
  const set = [], binds = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      if (f === 'payment_terms' && body[f] && !VALID_PAYMENT_TERMS.has(body[f])) return badRequest('invalid_payment_terms');
      if (f === 'primary_brand' && body[f] && !VALID_PRIMARY_BRANDS.has(body[f])) return badRequest('invalid_primary_brand');
      set.push(`${f} = ?`); binds.push(body[f]);
    }
  }
  if (!set.length) return badRequest('nothing_to_update');
  set.push(`updated_at = unixepoch()`, `updated_by = ?`);
  binds.push(`${actor.name} (${actor.role})`);
  binds.push(id);

  await env.DB.prepare(`UPDATE vendors SET ${set.join(', ')} WHERE id = ?`).bind(...binds).run();
  await logVendor(env.DB, id, 'update', body, `${actor.name} (${actor.role})`);
  return json({ ok: true });
}

async function handleAddProduct(env, body, actor) {
  const vendor_id = body.vendor_id;
  const name      = String(body.product_name || '').trim();
  if (!vendor_id || !name) return badRequest('vendor_id_and_product_name_required');

  await env.DB.prepare(
    `INSERT INTO vendor_products
       (vendor_id, hn_rm_code, product_name, uom, qty_hint, unit_price, is_primary_vendor, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(vendor_id, hn_rm_code) DO UPDATE SET
       product_name = excluded.product_name,
       uom = excluded.uom,
       qty_hint = excluded.qty_hint,
       unit_price = excluded.unit_price,
       is_primary_vendor = excluded.is_primary_vendor,
       active = 1,
       updated_at = unixepoch()`
  ).bind(
    vendor_id, body.hn_rm_code || null, name, body.uom || null,
    body.qty_hint || null, body.unit_price || null, body.is_primary_vendor ? 1 : 0
  ).run();
  await logVendor(env.DB, vendor_id, 'add_product', body, `${actor.name} (${actor.role})`);
  return json({ ok: true });
}

async function handleRemoveProduct(env, body, actor) {
  const id = body.product_id;
  if (!id) return badRequest('product_id_required');
  const row = await env.DB.prepare(`SELECT vendor_id FROM vendor_products WHERE id = ?`).bind(id).first();
  if (!row) return notFound('product_not_found');
  await env.DB.prepare(`UPDATE vendor_products SET active = 0, updated_at = unixepoch() WHERE id = ?`).bind(id).run();
  await logVendor(env.DB, row.vendor_id, 'remove_product', { product_id: id }, `${actor.name} (${actor.role})`);
  return json({ ok: true });
}

async function handleMerge(env, body, actor) {
  // Mark `from_id` as merged into `into_id`; from now on shows only via canonical.
  const from_id = body.from_id, into_id = body.into_id;
  if (!from_id || !into_id || from_id === into_id) return badRequest('from_and_into_required_distinct');
  const into = await env.DB.prepare(`SELECT id FROM vendors WHERE id = ?`).bind(into_id).first();
  const from = await env.DB.prepare(`SELECT id FROM vendors WHERE id = ?`).bind(from_id).first();
  if (!into || !from) return notFound('vendor_not_found');
  await env.DB.prepare(`UPDATE vendors SET merged_into_id = ?, active = 0, updated_at = unixepoch() WHERE id = ?`)
    .bind(into_id, from_id).run();
  // Re-parent products
  await env.DB.prepare(`UPDATE vendor_products SET vendor_id = ?, updated_at = unixepoch() WHERE vendor_id = ?`)
    .bind(into_id, from_id).run();
  await logVendor(env.DB, into_id, 'merge', { from_id, into_id }, `${actor.name} (${actor.role})`);
  return json({ ok: true });
}

async function handleOdooSync(env, actor) {
  // Pull all res.partner where supplier_rank > 0.
  // For each: if D1 has matching odoo_partner_id → update name/phone.
  // If no match by id but name matches an existing D1 vendor with no odoo id → link them.
  // If no match at all → create stub D1 vendor for visibility.
  const partners = await odooCall(env.ODOO_API_KEY, 'res.partner', 'search_read',
    [[['supplier_rank', '>', 0]]],
    { fields: ['id', 'name', 'phone', 'mobile', 'street', 'city', 'vat', 'company_id', 'active'] });

  const out = { updated: 0, linked: 0, created: 0, total_pulled: partners.length };

  for (const p of partners) {
    const phone = p.phone || p.mobile || null;
    const existsById = await env.DB.prepare(`SELECT id FROM vendors WHERE odoo_partner_id = ?`).bind(p.id).first();
    if (existsById) {
      await env.DB.prepare(
        `UPDATE vendors SET name = ?, phone = COALESCE(phone, ?), updated_at = unixepoch(), updated_by = ?
           WHERE id = ?`
      ).bind(p.name, phone, `${actor.name} (sync)`, existsById.id).run();
      out.updated++;
      await logVendor(env.DB, existsById.id, 'sync_odoo', { odoo_id: p.id }, `${actor.name} (sync)`);
      continue;
    }
    // Try to match by name (case-insensitive)
    const byName = await env.DB.prepare(
      `SELECT id FROM vendors WHERE LOWER(name) = LOWER(?) AND odoo_partner_id IS NULL LIMIT 1`
    ).bind(p.name).first();
    if (byName) {
      await env.DB.prepare(
        `UPDATE vendors SET odoo_partner_id = ?, phone = COALESCE(phone, ?), updated_at = unixepoch(), updated_by = ?
           WHERE id = ?`
      ).bind(p.id, phone, `${actor.name} (sync)`, byName.id).run();
      out.linked++;
      await logVendor(env.DB, byName.id, 'sync_odoo', { odoo_id: p.id, action: 'link' }, `${actor.name} (sync)`);
      continue;
    }
    // Create stub
    const key = slugify(p.name) || `odoo-${p.id}`;
    const r = await env.DB.prepare(
      `INSERT INTO vendors (vendor_key, odoo_partner_id, name, phone, active, updated_by, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, unixepoch())
       ON CONFLICT(vendor_key) DO UPDATE SET odoo_partner_id = excluded.odoo_partner_id, updated_at = unixepoch()`
    ).bind(key, p.id, p.name, phone, `${actor.name} (sync)`).run();
    out.created++;
    if (r.meta && r.meta.last_row_id) {
      await logVendor(env.DB, r.meta.last_row_id, 'sync_odoo', { odoo_id: p.id, action: 'create' }, `${actor.name} (sync)`);
    }
  }

  return json({ ok: true, ...out });
}

// ━━━ Router ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url    = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  if (action === 'health') return handleHealth(env);

  // PIN gate
  const pin  = url.searchParams.get('pin') || '';
  const user = auth(pin);
  if (!user) return unauthorized();

  try {
    if (request.method === 'GET') {
      if (action === 'list')          return handleList(env, url);
      if (action === 'get')           return handleGet(env, url);
      if (action === 'spend-summary') return handleSpendSummary(env, url);
      if (action === 'odoo-sync') {
        if (!ADMIN_ROLES.has(user.role)) return forbidden();
        return handleOdooSync(env, user);
      }
      return badRequest('unknown_action');
    }
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (action === 'create')         return handleCreate(env, body, user);
      if (action === 'update')         return handleUpdate(env, body, user);
      if (action === 'add-product')    return handleAddProduct(env, body, user);
      if (action === 'remove-product') return handleRemoveProduct(env, body, user);
      if (action === 'merge') {
        if (!ADMIN_ROLES.has(user.role)) return forbidden();
        return handleMerge(env, body, user);
      }
      return badRequest('unknown_action');
    }
    return badRequest('method_not_allowed');
  } catch (e) {
    return serverError(e.message || String(e));
  }
}
