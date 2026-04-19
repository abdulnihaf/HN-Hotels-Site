/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Spend — Unified Recording API
 * Route:  /api/spend
 * D1:     DB (hn-hiring)
 * Secrets: ODOO_API_KEY
 *
 * PIN → brand scope + visible categories → smart dispatcher:
 *   cats 3-13  → hr.expense    (salary, rent, utility, petty, etc.)
 *   cats 1, 2  → purchase.order (raw materials, capex)
 *   cat 14     → account.move direct (vendor bill, no PO)
 *   cat 15     → account.move linked (bill from existing PO)
 *
 * Locked spec from sleepy-mayer session (Apr 18, 13:01).
 * Replaces split between /ops/rm/ /ops/purchase/ /ops/finance/ for entry.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;  // Administrator

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ━━━ PIN → Scope (locked spec) ━━━
const USERS = {
  '0305': { name: 'Nihaf',    brands: ['HE','NCH','HQ'], cats: 'all', role: 'admin' },
  '3754': { name: 'Naveen',   brands: ['HE','NCH','HQ'], cats: 'all', role: 'cfo' },
  '6045': { name: 'Faheem',   brands: ['HE','NCH','HQ'], cats: 'all', role: 'asstmgr' },
  '3678': { name: 'Faheem',   brands: ['HE','NCH','HQ'], cats: 'all', role: 'asstmgr' },
  '5882': { name: 'Nihaf',    brands: ['HE','NCH','HQ'], cats: 'all', role: 'admin' },  // legacy
  // Zoya is INVENTORY-PURCHASE only. She does not handle cash / expenses.
  // Cat 1 = RM purchase (her daily work) · Cat 15 = matching vendor bills to her POs.
  '2026': { name: 'Zoya',     brands: ['HE','NCH','HQ'], cats: [1, 15], role: 'purchase' },
  '8316': { name: 'Zoya',     brands: ['HE','NCH','HQ'], cats: [1, 15], role: 'purchase' },
  // HQ GMs — all daily ops categories, no drawings
  '8523': { name: 'Basheer',  brands: ['HE','NCH','HQ'], cats: 'all', role: 'gm' },
  '6890': { name: 'Tanveer',  brands: ['HE','NCH','HQ'], cats: 'all', role: 'gm' },
  '3697': { name: 'Yashwant', brands: ['HE','NCH','HQ'], cats: 'all', role: 'gm' },
};

// Outlet cashier PINs — scoped to their outlet only (brand chip auto-fixes, no switcher).
// Cats [5,6,7,8,9] = Rent, Utility, Police/Hafta, Petty/Operations, Maintenance/Repair.
// Populate real PINs when onboarding Noor / Kesmat / Nafees.
const CASHIER_PINS = {
  '15': { name: 'Noor',    brands: ['HE'],  cats: [5,6,7,8,9], role: 'cashier' },
  '14': { name: 'Kesmat',  brands: ['NCH'], cats: [5,6,7,8,9], role: 'cashier' },
  '43': { name: 'Nafees',  brands: ['NCH'], cats: [5,6,7,8,9], role: 'cashier' },
};

function resolveUser(pin) {
  return USERS[pin] || CASHIER_PINS[pin] || null;
}

// PIN → Odoo res.users.id (for x_recorded_by_user_id attribution)
// Built from users created in odoo.hnhotels.in on 2026-04-19.
const PIN_TO_UID = {
  '0305': 2,  '5882': 2,     // Nihaf (Administrator)
  '3754': 5,                 // Naveen
  '2026': 6,  '8316': 6,     // Zoya
  '8523': 7,                 // Basheer
  '6890': 8,                 // Tanveer
  '6045': 9,  '3678': 9,     // Faheem
  '3697': 10,                // Ismail (Yashwant PIN mapped to Ismail's Odoo user)
  '15':   11,                // Noor (HE cashier — biometric pin from D1)
  '14':   13,                // Kesmat (NCH cashier)
  '43':   14,                // Nafees (NCH cashier)
};
function pinToUid(pin) { return PIN_TO_UID[pin] || 2; }  // fallback to admin

const BRAND_COMPANY = { HE: 1, NCH: 10, HQ: 13 };

// ━━━ Attachment helper ━━━
// Accepts { name, mimetype, data_b64 } and attaches to any Odoo record.
// Silently logs on failure — attachment is best-effort, never blocks the main record.
async function saveAttachment(apiKey, attachment, res_model, res_id) {
  if (!attachment || !attachment.data_b64 || !res_id) return null;
  try {
    const attId = await odoo(apiKey, 'ir.attachment', 'create', [{
      name: (attachment.name || 'bill.jpg').slice(0, 120),
      datas: attachment.data_b64,
      res_model,
      res_id: parseInt(res_id, 10),
      type: 'binary',
      mimetype: attachment.mimetype || 'image/jpeg',
    }]);
    return attId;
  } catch (e) {
    console.error('attachment fail:', e.message);
    return null;
  }
}

// ━━━ Drive sync helper ━━━
// POSTs to Google Apps Script webhook so the bill photo lands in a dated,
// company-scoped Drive folder. Silently skipped if DRIVE_WEBHOOK_URL is unset.
async function syncToDrive(env, meta) {
  if (!env || !env.DRIVE_WEBHOOK_URL) return null;
  if (!meta || !meta.data_b64) return null;
  try {
    const r = await fetch(env.DRIVE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    const out = await r.json().catch(() => null);
    return out?.file_id || null;
  } catch (e) {
    console.error('drive sync fail:', e.message);
    return null;
  }
}

// ━━━ 14 Spend Categories (locked spec) ━━━
const CATEGORIES = [
  { id: 1,  label: 'Raw Material Purchase', emoji: '🥩', backend: 'purchase.order', desc: 'Vendor + items → RM PO' },
  { id: 2,  label: 'Capex / Equipment',     emoji: '🏗️', backend: 'hr.expense',      desc: 'Fridge / AC / Equipment', parentName: '14 · One-Time Capex' },
  { id: 3,  label: 'Salary Payment',        emoji: '💼', backend: 'hr.expense',     desc: 'Employee monthly salary', parentName: '02 · Salaries' },
  { id: 4,  label: 'Salary Advance',        emoji: '💰', backend: 'hr.expense',     desc: 'Employee advance (deducted later)', parentName: '02 · Salaries' },
  { id: 5,  label: 'Rent',                  emoji: '🏠', backend: 'hr.expense',     desc: 'Outlet rent', parentName: '03 · Rent' },
  { id: 6,  label: 'Utility Bill',          emoji: '💡', backend: 'hr.expense',     desc: 'BESCOM / BWSSB / Internet / Gas', parentName: '04 · Utilities' },
  { id: 7,  label: 'Police / Hafta',        emoji: '🚓', backend: 'hr.expense',     desc: 'Beat / Cheta / etc.', parentName: '05 · Police & Compliance' },
  { id: 8,  label: 'Petty / Operations',    emoji: '🧹', backend: 'hr.expense',     desc: 'Cleaning / Kitchen / Stationery / Tea', parentName: '06 · Operations (Petty)' },
  { id: 9,  label: 'Maintenance / Repair',  emoji: '🔧', backend: 'hr.expense',     desc: 'Pest / Plumb / Electrical / Equip', parentName: '07 · Maintenance & Repairs' },
  { id: 10, label: 'Marketing / Ads',       emoji: '📢', backend: 'hr.expense',     desc: 'Meta / Google / Zomato / Influencer', parentName: '08 · Marketing & Promotion' },
  { id: 11, label: 'Tech / SaaS / Bank',    emoji: '💻', backend: 'hr.expense',     desc: 'Cloudflare / Odoo / Razorpay / Bank', parentName: '09 · Technology' },
  { id: 12, label: 'Audit / Legal / Compliance', emoji: '📋', backend: 'hr.expense', desc: 'Audit / MCA / FSSAI / Legal', parentName: '10 · Compliance & Legal' },
  { id: 13, label: 'Owner / Family Drawing', emoji: '👨‍👩‍👧', backend: 'hr.expense', desc: 'Excluded from P&L', parentName: '15 · Owner Drawings (Excl. P&L)' },
  { id: 14, label: 'Direct Vendor Bill (no PO)', emoji: '🧾', backend: 'account.move', desc: 'One-shot vendor bill, no PO' },
  { id: 15, label: 'Bill from PO (3-way match)', emoji: '📄', backend: 'account.move.linked', desc: 'Link bill to existing PO' },
];

const PAYMENT_METHODS = [
  { key: 'cash',        label: 'Cash' },
  { key: 'hdfc_bank',   label: 'HDFC' },
  { key: 'federal_bank',label: 'Federal' },
  { key: 'razorpay',    label: 'Razorpay' },
  { key: 'paytm',       label: 'Paytm (UPI)' },
];

// ━━━ Odoo JSON-RPC helper ━━━
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

function visibleCats(user) {
  if (user.cats === 'all') return CATEGORIES.filter(c => !c.hidden);
  return CATEGORIES.filter(c => !c.hidden && user.cats.includes(c.id));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const DB = env.DB;
  const apiKey = env.ODOO_API_KEY;

  try {
    // ── VERIFY PIN ─────────────────────────────────────────
    if (action === 'verify-pin') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' });
      return json({
        success: true,
        user: { name: user.name, role: user.role },
        brands: user.brands,
        categories: visibleCats(user),
        payment_methods: PAYMENT_METHODS,
      });
    }

    // ── PRODUCTS IN CATEGORY (pulled from Odoo expense taxonomy) ──
    if (action === 'products') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const catId = parseInt(url.searchParams.get('cat') || '0', 10);
      const cat = CATEGORIES.find(c => c.id === catId);
      if (!cat) return json({ success: false, error: 'Unknown category' }, 400);
      if (cat.backend !== 'hr.expense') return json({ success: true, products: [] });
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);

      // Find the Odoo product.category by name — use ilike to tolerate whitespace / punctuation quirks
      const parentList = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', 'ilike', cat.parentName]]],
        { fields: ['id', 'name'], limit: 5 });
      if (!parentList.length) return json({ success: true, products: [], reason: `No category matching ${cat.parentName}` });
      const products = await odoo(apiKey, 'product.product', 'search_read',
        [[['categ_id', '=', parentList[0].id], ['can_be_expensed', '=', true], ['active', '=', true]]],
        { fields: ['id', 'name', 'default_code', 'standard_price'], order: 'name asc', limit: 200 });
      return json({ success: true, products });
    }

    // ── EMPLOYEES (for Salary / Advance categories) ────────
    if (action === 'employees') {
      if (!DB) return json({ success: false, error: 'DB not configured' }, 500);
      const rows = await DB.prepare(
        `SELECT id, name, pin, brand_label, company_id, monthly_salary, odoo_employee_id
           FROM hr_employees
          WHERE is_active = 1 AND odoo_employee_id IS NOT NULL
          ORDER BY brand_label, name`
      ).all();
      return json({ success: true, employees: rows.results });
    }

    // ── EXPORT STRUCTURE (all categories, products, vendors for PDF/XLSX download) ──
    if (action === 'export-structure') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);

      // Resolve the root "HN Hotels Expenses" category
      const rootHits = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', '=', 'HN Hotels Expenses'], ['parent_id', '=', false]]],
        { fields: ['id', 'name'], limit: 1 });
      const rootId = rootHits[0]?.id;

      // Pull all parent categories under the root + products per category
      const structureCats = await Promise.all(CATEGORIES.map(async (cat) => {
        let products = [];
        if (cat.backend === 'hr.expense' && cat.parentName) {
          const parentHits = await odoo(apiKey, 'product.category', 'search_read',
            [[['name', 'ilike', cat.parentName]]], { fields: ['id', 'name'], limit: 5 });
          if (parentHits.length) {
            const rows = await odoo(apiKey, 'product.product', 'search_read',
              [[['categ_id', '=', parentHits[0].id], ['can_be_expensed', '=', true], ['active', '=', true]]],
              { fields: ['id', 'name', 'default_code'], order: 'name asc', limit: 500 });
            products = rows.map(r => ({ id: r.id, name: r.name, code: r.default_code || '' }));
          }
        }
        if (cat.backend === 'purchase.order') {
          // For cat 1: pull all HN-RM-* products (flat, not variant-aware here)
          const rows = await odoo(apiKey, 'product.product', 'search_read',
            [[['default_code', 'like', 'HN-RM-'], ['active', '=', true]]],
            { fields: ['id', 'name', 'default_code'], order: 'name asc', limit: 500 });
          products = rows.map(r => ({ id: r.id, name: r.name, code: r.default_code || '' }));
        }
        return { id: cat.id, label: cat.label, emoji: cat.emoji, desc: cat.desc,
                 backend: cat.backend, parent_name: cat.parentName || null, products };
      }));

      // Vendors with supplier_rank>0 + their product links from D1
      const vendors = await odoo(apiKey, 'res.partner', 'search_read',
        [[['supplier_rank', '>', 0], ['active', '=', true]]],
        { fields: ['id', 'name', 'phone', 'email'], order: 'name asc', limit: 500 });
      let vendorLinks = [];
      if (DB) {
        try {
          const rows = await DB.prepare(
            'SELECT vp.vendor_key, vp.product_code, v.name as vendor_name FROM rm_vendor_products vp JOIN rm_vendors v ON vp.vendor_key = v.key'
          ).all();
          vendorLinks = rows.results || [];
        } catch {}
      }

      return json({
        success: true,
        generated_at: new Date().toISOString(),
        root_category: rootHits[0] || null,
        categories: structureCats,
        vendors,
        vendor_product_links: vendorLinks,
        payment_methods: PAYMENT_METHODS,
        pin_scope_summary: Object.entries({ ...USERS, ...CASHIER_PINS }).map(([pin, u]) => ({
          pin, name: u.name, role: u.role, brands: u.brands,
          cats: u.cats === 'all' ? 'all' : u.cats,
        })),
      });
    }

    // ── EXPORT DATA (actual records: expenses / POs / bills / employees) ──
    if (action === 'export-data') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const type = url.searchParams.get('type') || 'expense';
      const from = url.searchParams.get('from') || new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
      const to   = url.searchParams.get('to')   || new Date().toISOString().slice(0, 10);

      if (type === 'expense') {
        // Pull hr.expense records in the date range
        const rows = await odoo(apiKey, 'hr.expense', 'search_read',
          [[['date', '>=', from], ['date', '<=', to]]],
          { fields: ['id', 'name', 'date', 'total_amount', 'product_id', 'company_id',
                     'x_pool', 'x_payment_method', 'x_location', 'x_submitted_by_pin', 'x_recorded_by_user_id'],
            order: 'date desc, id desc', limit: 2000 });
        return json({ success: true, type, from, to, rows });
      }
      if (type === 'po') {
        const rows = await odoo(apiKey, 'purchase.order', 'search_read',
          [[['date_order', '>=', from + ' 00:00:00'], ['date_order', '<=', to + ' 23:59:59']]],
          { fields: ['id', 'name', 'date_order', 'partner_id', 'company_id', 'amount_total', 'state',
                     'x_recorded_by_user_id'],
            order: 'date_order desc', limit: 2000 });
        return json({ success: true, type, from, to, rows });
      }
      if (type === 'bill') {
        const rows = await odoo(apiKey, 'account.move', 'search_read',
          [[['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to]]],
          { fields: ['id', 'name', 'ref', 'invoice_date', 'partner_id', 'company_id',
                     'amount_total', 'payment_state', 'invoice_origin', 'x_recorded_by_user_id'],
            order: 'invoice_date desc', limit: 2000 });
        return json({ success: true, type, from, to, rows });
      }
      if (type === 'vendor') {
        const rows = await odoo(apiKey, 'res.partner', 'search_read',
          [[['supplier_rank', '>', 0], ['active', '=', true]]],
          { fields: ['id', 'name', 'phone', 'email', 'vat', 'street', 'city', 'state_id', 'country_id',
                     'property_payment_term_id', 'create_date'],
            order: 'name asc', limit: 500 });
        return json({ success: true, type, rows });
      }
      if (type === 'product') {
        const rows = await odoo(apiKey, 'product.product', 'search_read',
          [[['active', '=', true]]],
          { fields: ['id', 'name', 'default_code', 'categ_id', 'type', 'uom_id',
                     'can_be_expensed', 'purchase_ok', 'sale_ok'],
            order: 'default_code asc, name asc', limit: 2000 });
        return json({ success: true, type, rows });
      }
      return json({ success: false, error: 'Unknown type. Use: expense|po|bill|vendor|product' }, 400);
    }

    // ── UoMs (for inline product creation) ─────────────────
    if (action === 'uoms') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const uoms = await odoo(apiKey, 'uom.uom', 'search_read',
        [[]], { fields: ['id', 'name'], limit: 50, order: 'name asc' });
      return json({ success: true, uoms });
    }

    // ── CREATE EXPENSE PRODUCT (inline-add from cats 2-13) ─
    if (action === 'create-expense-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, cat_id, name, uom_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const cat = CATEGORIES.find(c => c.id === parseInt(cat_id, 10));
      if (!cat) return json({ success: false, error: 'Unknown category' }, 400);
      if (cat.backend !== 'hr.expense') return json({ success: false, error: 'Only expense categories support inline product creation' }, 400);
      if (!name?.trim()) return json({ success: false, error: 'Name required' }, 400);

      // Resolve parent category
      const parentList = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', 'ilike', cat.parentName]]],
        { fields: ['id', 'name'], limit: 1 });
      if (!parentList.length) return json({ success: false, error: `Parent category "${cat.parentName}" not found in Odoo` }, 404);

      const prodId = await odoo(apiKey, 'product.product', 'create', [{
        name: name.trim(),
        categ_id: parentList[0].id,
        type: 'service',
        can_be_expensed: true,
        purchase_ok: true,
        sale_ok: false,
        uom_id: uom_id ? parseInt(uom_id, 10) : undefined,
        uom_po_id: uom_id ? parseInt(uom_id, 10) : undefined,
      }]);

      return json({ success: true, product: { id: prodId, name: name.trim() } });
    }

    // ── CREATE VENDOR (inline-add for cats 1, 14, 15) ──────
    if (action === 'create-vendor' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, name, phone } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!name?.trim()) return json({ success: false, error: 'Name required' }, 400);

      const vendorId = await odoo(apiKey, 'res.partner', 'create', [{
        name: name.trim(),
        phone: phone?.trim() || false,
        supplier_rank: 1,
        is_company: true,
      }]);

      return json({ success: true, vendor: { id: vendorId, name: name.trim(), phone: phone?.trim() || '' } });
    }

    // ── VENDORS (for Cat 1, 2, 14, 15) ─────────────────────
    if (action === 'vendors') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const companyId = BRAND_COMPANY[brand];
      const domain = companyId
        ? [['supplier_rank', '>', 0], ['company_id', 'in', [companyId, false]]]
        : [['supplier_rank', '>', 0]];
      const vendors = await odoo(apiKey, 'res.partner', 'search_read',
        [domain],
        { fields: ['id', 'name', 'phone'], order: 'name asc', limit: 200 });
      return json({ success: true, vendors });
    }

    // ── RECENT ENTRIES (last 20) ───────────────────────────
    if (action === 'recent') {
      if (!DB) return json({ success: false, error: 'DB not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      // Pull from business_expenses (hr.expense mirror) and rm purchase logs
      const rows = await DB.prepare(
        `SELECT odoo_id, category, amount, product_name, company_id, x_payment_method as payment_method,
                recorded_by as recorded_by_pin, recorded_at as created_at, notes
           FROM business_expenses
          ORDER BY recorded_at DESC LIMIT 20`
      ).all().catch(() => ({ results: [] }));
      return json({ success: true, entries: rows.results });
    }

    // ── RECORD EXPENSE (cats 3-13) → hr.expense ────────────
    if (action === 'record' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, category: catId, brand, product_id, amount, payment_method,
              employee_id, notes, bill_ref, vendor_name } = body;

      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const cat = CATEGORIES.find(c => c.id === parseInt(catId, 10));
      if (!cat) return json({ success: false, error: 'Unknown category' }, 400);

      // Scope check
      if (user.cats !== 'all' && !user.cats.includes(cat.id)) {
        return json({ success: false, error: `Category ${cat.label} not permitted for ${user.name}` }, 403);
      }
      if (!user.brands.includes(brand)) {
        return json({ success: false, error: `Brand ${brand} not permitted for ${user.name}` }, 403);
      }

      const companyId = BRAND_COMPANY[brand];
      if (!companyId) return json({ success: false, error: 'Unknown brand' }, 400);
      if (!amount || parseFloat(amount) <= 0) return json({ success: false, error: 'Amount must be > 0' }, 400);

      // Cats 3-13 → hr.expense
      if (cat.backend === 'hr.expense') {
        if (!product_id) return json({ success: false, error: 'Product required' }, 400);
        // Resolve employee_id — salary/advance require explicit; others default to PIN owner
        let empId = employee_id;
        if (!empId) {
          // fallback to PIN's own Odoo employee via hr_employees
          const pinRow = await env.DB.prepare(
            'SELECT odoo_employee_id FROM hr_employees WHERE pin = ?'
          ).bind(pin).first().catch(() => null);
          empId = pinRow?.odoo_employee_id || 1;  // Administrator fallback
        }

        // Fetch product for name + default_code
        const prodRows = await odoo(apiKey, 'product.product', 'search_read',
          [[['id', '=', parseInt(product_id, 10)]]],
          { fields: ['name', 'default_code'], limit: 1 });
        const prodName = prodRows[0]?.name || 'Expense';

        // Optional backdated date — must be YYYY-MM-DD, defaults to today
        const customDate = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
        const expenseVals = {
          name: notes ? `${prodName} — ${notes}` : prodName,
          product_id: parseInt(product_id, 10),
          total_amount: parseFloat(amount),
          employee_id: empId,
          company_id: companyId,
          date: customDate,
          x_pool: cat.id === 2 || cat.id === 13 ? 'capex' : 'opex',
          x_payment_method: payment_method || 'cash',
          x_location: brand,
          x_excluded_from_pnl: cat.id === 13,  // Owner drawings
          x_submitted_by_pin: String(pin),
          x_recorded_by_user_id: pinToUid(pin),  // native Odoo audit
        };
        // Vendor mapping — strict for cats 2, 5-12. Odoo hr.expense has vendor_id.
        if (body.vendor_id && ![3, 4, 13].includes(cat.id)) {
          expenseVals.vendor_id = parseInt(body.vendor_id, 10);
        }

        const expenseId = await odoo(apiKey, 'hr.expense', 'create', [expenseVals]);

        // Optional bill photo — write to Odoo AND to Drive
        const attId = await saveAttachment(apiKey, body.attachment, 'hr.expense', expenseId);
        const driveFileId = await syncToDrive(env, body.attachment ? {
          date: customDate,
          company: brand,
          category: cat.label,
          product: prodName,
          amount: parseFloat(amount),
          recorded_by: user.name,
          filename: body.attachment.name,
          mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64,
        } : null);

        // Mirror to D1 for fast reads (matches existing business_expenses schema)
        if (DB) {
          const payMode = payment_method === 'cash' ? 'cash' : 'bank';
          await DB.prepare(
            `INSERT INTO business_expenses
               (recorded_by, recorded_at, amount, description, category, payment_mode, notes,
                odoo_id, company_id, product_id, product_name, category_parent,
                x_pool, x_payment_method, x_location, x_excluded_from_pnl, odoo_synced_at)
             VALUES (?, datetime('now'), ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, datetime('now'))`
          ).bind(
            user.name, parseFloat(amount), prodName, cat.label, payMode, notes || '',
            expenseId, companyId, parseInt(product_id, 10), prodName, cat.parentName || null,
            expenseVals.x_pool, expenseVals.x_payment_method, brand, cat.id === 13 ? 1 : 0
          ).run().catch(e => console.error('mirror fail:', e.message));
        }

        return json({ success: true, odoo_id: expenseId, backend: 'hr.expense', category: cat.label, attachment_id: attId, drive_file_id: driveFileId });
      }

      // Cat 14 → account.move direct vendor bill
      if (cat.backend === 'account.move') {
        if (!body.vendor_id) return json({ success: false, error: 'Vendor required' }, 400);
        const customInvDate = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
        const moveVals = {
          move_type: 'in_invoice',
          partner_id: parseInt(body.vendor_id, 10),
          company_id: companyId,
          invoice_date: customInvDate,
          ref: bill_ref || null,
          narration: notes || null,
          x_recorded_by_user_id: pinToUid(pin),
          invoice_line_ids: [[0, 0, {
            name: vendor_name || 'Vendor charge',
            quantity: 1,
            price_unit: parseFloat(amount),
          }]],
        };
        const moveId = await odoo(apiKey, 'account.move', 'create', [moveVals]);
        const attId14 = await saveAttachment(apiKey, body.attachment, 'account.move', moveId);
        const drive14 = await syncToDrive(env, body.attachment ? {
          date: customInvDate,
          company: brand,
          category: cat.label,
          product: body.vendor_name || 'Vendor bill',
          amount: parseFloat(amount),
          recorded_by: user.name,
          filename: body.attachment.name,
          mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64,
        } : null);
        return json({ success: true, odoo_id: moveId, backend: 'account.move', category: cat.label, attachment_id: attId14, drive_file_id: drive14 });
      }

      // Cat 1 (Raw Material PO) — UI submits directly to /api/rm-ops create-po
      // (avoids duplicating the variant-aware purchase logic)
      if (cat.backend === 'purchase.order') {
        return json({ success: false, error: 'Cat 1 uses /api/rm-ops create-po directly from the UI' }, 501);
      }

      return json({ success: false, error: `Backend ${cat.backend} not implemented yet` }, 501);
    }

    // ── DELETE EXPENSE ENTRY (admin / cfo / asstmgr only) ──────────────────
    if (action === 'delete-entry' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, odoo_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!['admin','cfo','asstmgr'].includes(user.role)) {
        return json({ success: false, error: 'Only Nihaf/Naveen/Faheem can delete entries' }, 403);
      }
      if (!odoo_id) return json({ success: false, error: 'odoo_id required' }, 400);

      // Delete from Odoo (soft-unlink if draft, hard-unlink OK for recent entries)
      try {
        await odoo(apiKey, 'hr.expense', 'unlink', [[parseInt(odoo_id, 10)]]);
      } catch (e) {
        // hr.expense might already be submitted/approved — report but continue D1 cleanup
        return json({ success: false, error: `Odoo delete failed: ${e.message}. Entry may be already submitted — unlink in Odoo UI.` }, 400);
      }

      // Delete D1 mirror
      if (DB) {
        await DB.prepare('DELETE FROM business_expenses WHERE odoo_id = ?').bind(parseInt(odoo_id, 10)).run()
          .catch(e => console.error('D1 delete fail:', e.message));
      }

      return json({ success: true, deleted_odoo_id: odoo_id });
    }

    // ── ARCHIVE PRODUCT (admin only) — marks active=false in Odoo ──────────
    if (action === 'archive-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, product_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (user.role !== 'admin') {
        return json({ success: false, error: 'Only admins can archive products' }, 403);
      }
      if (!product_id) return json({ success: false, error: 'product_id required' }, 400);
      await odoo(apiKey, 'product.product', 'write', [[parseInt(product_id, 10)], { active: false }]);
      return json({ success: true, archived_product_id: product_id });
    }

    // ── ARCHIVE VENDOR (admin only) ────────────────────────────────────────
    if (action === 'archive-vendor' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, vendor_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (user.role !== 'admin') {
        return json({ success: false, error: 'Only admins can archive vendors' }, 403);
      }
      if (!vendor_id) return json({ success: false, error: 'vendor_id required' }, 400);
      await odoo(apiKey, 'res.partner', 'write', [[parseInt(vendor_id, 10)], { active: false }]);
      return json({ success: true, archived_vendor_id: vendor_id });
    }

    // ── CAT 15 — Bill from PO (account.move linked to purchase.order) ──────
    if (action === 'record-bill-from-po' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, brand, po_id, bill_ref, bill_date, amount, notes } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (user.cats !== 'all' && !user.cats.includes(15)) {
        return json({ success: false, error: 'Not permitted' }, 403);
      }
      if (!po_id || !amount) return json({ success: false, error: 'PO + amount required' }, 400);
      const companyId = BRAND_COMPANY[brand];
      if (!companyId) return json({ success: false, error: 'Unknown brand' }, 400);

      // Fetch PO to pull partner_id + link
      const po = await odoo(apiKey, 'purchase.order', 'read',
        [[parseInt(po_id, 10)]], { fields: ['id', 'name', 'partner_id', 'amount_total'] });
      if (!po || !po.length) return json({ success: false, error: 'PO not found' }, 404);
      const vendorId = po[0].partner_id[0];

      const moveVals = {
        move_type: 'in_invoice',
        partner_id: vendorId,
        company_id: companyId,
        invoice_date: bill_date || new Date().toISOString().slice(0, 10),
        ref: bill_ref || po[0].name,
        narration: notes || `Linked to ${po[0].name}`,
        invoice_origin: po[0].name,
        x_recorded_by_user_id: pinToUid(pin),
        invoice_line_ids: [[0, 0, {
          name: `Bill for ${po[0].name}`,
          quantity: 1,
          price_unit: parseFloat(amount),
          purchase_order_id: po[0].id,
        }]],
      };
      const moveId = await odoo(apiKey, 'account.move', 'create', [moveVals]);
      const attIdPo = await saveAttachment(apiKey, body.attachment, 'account.move', moveId);
      const drivePo = await syncToDrive(env, body.attachment ? {
        date: bill_date || new Date().toISOString().slice(0, 10),
        company: brand,
        category: 'Bill from PO',
        product: `Bill ${bill_ref || po[0].name}`,
        amount: parseFloat(amount),
        recorded_by: user.name,
        filename: body.attachment.name,
        mimetype: body.attachment.mimetype,
        data_b64: body.attachment.data_b64,
      } : null);
      return json({ success: true, odoo_id: moveId, po_name: po[0].name, backend: 'account.move', attachment_id: attIdPo, drive_file_id: drivePo });
    }

    // ── List confirmed POs for cat 15 picker ───────────────────────────────
    if (action === 'confirmed-pos') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const companyId = BRAND_COMPANY[brand];
      const domain = companyId
        ? [['state', 'in', ['purchase', 'done']], ['company_id', '=', companyId]]
        : [['state', 'in', ['purchase', 'done']]];
      const pos = await odoo(apiKey, 'purchase.order', 'search_read',
        [domain],
        { fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state'],
          order: 'date_order desc', limit: 50 });
      return json({ success: true, pos });
    }

    return json({ success: false, error: 'Unknown action', actions: ['verify-pin','products','employees','vendors','recent','record'] }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}
