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
// Cashiers: full expense-cat access (2,3,4,5,6,7,8,9,10,11,12,13,14) — all except
// cat 1 (RM cart UI not in /ops/v2/) and cat 15 (Bill-from-PO picker not in /ops/v2/).
// Brand scope stays outlet-locked so HE cashier can't post NCH entries.
const CASHIER_CATS = [2,3,4,5,6,7,8,9,10,11,12,13,14];
const CASHIER_PINS = {
  '15': { name: 'Noor',    brands: ['HE'],  cats: CASHIER_CATS, role: 'cashier' },
  '14': { name: 'Kesmat',  brands: ['NCH'], cats: CASHIER_CATS, role: 'cashier' },
  '43': { name: 'Nafees',  brands: ['NCH'], cats: CASHIER_CATS, role: 'cashier' },
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

// NEW odoo.hnhotels.in instance (Apr 18, 2026):
//   1 = HN Hotels Pvt Ltd   (HQ)
//   2 = Hamza Express       (HE)
//   3 = Nawabi Chai House   (NCH)
const BRAND_COMPANY = { HE: 2, NCH: 3, HQ: 1 };

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
// Returns { file_id, view_url, path } or null. Back-compat callers that
// treat the return as a string (file_id) are preserved via driveFileId()
// which unwraps the object.
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
    if (!out || out.success === false) return null;
    return { file_id: out.file_id || null, view_url: out.view_url || null, path: out.path || null };
  } catch (e) {
    console.error('drive sync fail:', e.message);
    return null;
  }
}
// Back-compat for response payloads that emit drive_file_id as a scalar.
function driveFileId(driveInfo) { return driveInfo?.file_id || null; }

// ━━━ Structured bill filename ━━━
// Every bill photo is RENAMED server-side to a consistent, scannable pattern
// so Zoya (and anyone browsing Drive / Odoo) can identify it at a glance.
//   2026-04-16_PO-bill_NCH_Prabhu-Buffalo-Milk-Vendor_4400_Zoya.jpg
// Matches the Apps Script sanitize rules so Drive + Odoo + D1 all carry
// the same filename.  User's original upload name (e.g. "WhatsApp Image…")
// is discarded at write time — we keep only what's useful for retrieval.
function sanitizeBillPart(s, max) {
  const out = String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[,()]/g, '')
    .replace(/[·—–]/g, '-');
  return max ? out.slice(0, max) : out;
}
function buildBillFilename({ date, category, brand, product, amount, recorded_by, ext = 'jpg' }) {
  const parts = [
    date || new Date().toISOString().slice(0, 10),
    sanitizeBillPart(category || 'bill', 30),
    String(brand || 'HQ').toUpperCase(),
    sanitizeBillPart(product || 'misc', 40),
    amount != null && !isNaN(amount) ? String(Math.round(Number(amount))) : '0',
    sanitizeBillPart(recorded_by || 'unknown', 20),
  ].filter(Boolean);
  return parts.join('_') + '.' + ext.replace(/^\./, '');
}

// ━━━ Bill attachment registry (D1) ━━━
// Write-through log for every bill/receipt photo so the ledger UI can
// reliably show "what's been uploaded" with clickable Drive links —
// independent of Odoo ACL on ir.attachment.
async function logBillAttachment(DB, params) {
  if (!DB) return false;
  const {
    kind, odoo_id, brand, entry_date, entry_amount,
    odoo_attachment_id, drive_file_id, drive_view_url, drive_path,
    filename, mimetype, data_b64, pin, user_name,
  } = params;
  const fileSizeKb = Math.round(((data_b64 || '').length * 3 / 4) / 1024);
  try {
    await DB.prepare(`
      INSERT INTO bill_attachments
        (entry_kind, entry_odoo_id, brand, entry_date, entry_amount,
         odoo_attachment_id, drive_file_id, drive_view_url, drive_folder_path,
         filename, mimetype, file_size_kb, uploaded_by_pin, uploaded_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      kind, parseInt(odoo_id, 10), brand || null, entry_date || null,
      entry_amount != null ? parseFloat(entry_amount) : null,
      odoo_attachment_id || null, drive_file_id || null, drive_view_url || null, drive_path || null,
      filename || 'bill.jpg', mimetype || 'image/jpeg',
      fileSizeKb, String(pin || ''), user_name || null
    ).run();
    return true;
  } catch (e) {
    console.error('bill_attachments insert fail:', e.message);
    return false;
  }
}

// ━━━ 14 Spend Categories (locked spec) ━━━
const CATEGORIES = [
  // Cat 1 has two paths:
  //   - Formal PO flow      → /api/rm-ops?action=create-po  (variant-aware cart at /ops/purchase/)
  //   - Direct cash expense → /api/spend?action=record      (outlet app /ops/v2/)
  // Backend here is hr.expense so the expense path works; PO path is explicit via rm-ops.
  { id: 1,  label: 'Raw Material Purchase', emoji: '🥩', backend: 'hr.expense',     desc: 'Vendor + items (cash or PO)', parentName: '01 · Raw Materials' },
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

// Custom categories Naveen has added via /ops/expense/admin/.
// Returned with shape matching the built-in CATEGORIES so the UI treats them identically.
// Naveen-edited display overrides for the 15 locked categories. Label /
// emoji / description / parentName are editable; id + backend stay fixed.
// Stored in D1 expense_cat_override (see schema-expense-cat-override.sql).
async function loadCategoryOverrides(DB) {
  if (!DB) return {};
  try {
    const r = await DB.prepare(
      `SELECT id, label, emoji, description, parent_name FROM expense_cat_override`
    ).all();
    const map = {};
    for (const row of (r.results || [])) {
      map[row.id] = {
        label: row.label || null,
        emoji: row.emoji || null,
        desc: row.description || null,
        parentName: row.parent_name || null,
      };
    }
    return map;
  } catch (e) {
    console.error('loadCategoryOverrides fail:', e.message);
    return {};
  }
}

// Returns CATEGORIES with admin overrides merged in. Use this instead of
// reading CATEGORIES directly whenever the UI will see the values.
function mergeCategoryOverrides(overrides) {
  return CATEGORIES.map(c => {
    const o = overrides[c.id];
    if (!o) return c;
    return {
      ...c,
      label:      o.label      || c.label,
      emoji:      o.emoji      || c.emoji,
      desc:       o.desc       || c.desc,
      parentName: o.parentName || c.parentName,
    };
  });
}

async function loadCustomCategories(DB) {
  if (!DB) return [];
  try {
    const r = await DB.prepare(
      `SELECT id, label, emoji, description, backend, odoo_category_id, odoo_category_name
         FROM expense_categories_ext
        WHERE is_active = 1
        ORDER BY id ASC`
    ).all();
    return (r.results || []).map(row => ({
      id: row.id,
      label: row.label,
      emoji: row.emoji || '📌',
      desc: row.description || '',
      backend: row.backend || 'hr.expense',
      parentName: row.odoo_category_name || null,
      odoo_category_id: row.odoo_category_id,
      custom: true,
    }));
  } catch (e) {
    console.error('loadCustomCategories fail:', e.message);
    return [];
  }
}

// Admin-capable roles — CFO (Naveen) + admin (Nihaf).
// Gates the /ops/expense/admin/ endpoints.
function isAdminRole(user) {
  return user && (user.role === 'cfo' || user.role === 'admin');
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

      // Merge built-in (locked) cats with custom cats Naveen has added.
      // Custom cats respect the same scope rules — 'all' sees them; scoped PINs never get them
      // (cashiers/Zoya/etc. stay on their locked list until explicitly extended).
      const builtins = visibleCats(user);
      const custom = user.cats === 'all' ? await loadCustomCategories(DB) : [];
      const categories = [...builtins, ...custom];

      return json({
        success: true,
        user: { name: user.name, role: user.role },
        brands: user.brands,
        categories,
        payment_methods: PAYMENT_METHODS,
        can_admin: isAdminRole(user),
      });
    }

    // ── PRODUCTS IN CATEGORY (pulled from Odoo expense taxonomy) ──
    if (action === 'products') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const catId = parseInt(url.searchParams.get('cat') || '0', 10);

      // Resolve cat from built-in const OR from custom cats registry (id >= 100)
      let cat = CATEGORIES.find(c => c.id === catId);
      if (!cat && catId >= 100 && DB) {
        const custom = (await loadCustomCategories(DB)).find(c => c.id === catId);
        if (custom) cat = custom;
      }
      if (!cat) return json({ success: false, error: 'Unknown category' }, 400);
      if (cat.backend !== 'hr.expense') return json({ success: true, products: [] });
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);

      // Resolve Odoo category IDs:
      //   Custom cats → stored odoo_category_id (stable, rename-proof).
      //   Built-in cats → ilike match on parentName (legacy behaviour, unchanged).
      let categIds = [];
      if (cat.custom && cat.odoo_category_id) {
        categIds = [cat.odoo_category_id];
      } else {
        const parentList = await odoo(apiKey, 'product.category', 'search_read',
          [[['name', 'ilike', cat.parentName]]],
          { fields: ['id', 'name'], limit: 5 });
        categIds = parentList.map(c => c.id);
        if (catId === 1) {
          // Also grep the bare "Raw Materials" taxonomy where RM registry lives
          const rmExtra = await odoo(apiKey, 'product.category', 'search_read',
            [[['name', '=', 'Raw Materials']]], { fields: ['id'], limit: 5 });
          for (const r of rmExtra) if (!categIds.includes(r.id)) categIds.push(r.id);
        }
      }
      if (!categIds.length) return json({ success: true, products: [], reason: `No category matching ${cat.parentName}` });

      // Base set: all active can-be-expensed products in those categories
      const all = await odoo(apiKey, 'product.product', 'search_read',
        [[['categ_id', 'in', categIds], ['can_be_expensed', '=', true], ['active', '=', true]]],
        { fields: ['id', 'name', 'default_code', 'standard_price', 'create_date'], order: 'name asc', limit: 500 });

      // Brand filter: if &brand=NCH|HE|HQ — keep only products that have been bought
      // for that company (via purchase.order.line) OR are recently created (<7 days).
      // Absent brand param → return all (back-compat for /ops/expense/ central view).
      const brandParam = (url.searchParams.get('brand') || '').toUpperCase();
      const wantCompanyId = BRAND_COMPANY[brandParam];
      if (wantCompanyId && all.length) {
        try {
          const allIds = all.map(p => p.id);
          // Pull all POs for this company that reference any of these products
          const lines = await odoo(apiKey, 'purchase.order.line', 'search_read',
            [[['company_id', '=', wantCompanyId], ['product_id', 'in', allIds]]],
            { fields: ['product_id'], limit: 5000 });
          const brandProductIds = new Set(lines.map(l => l.product_id?.[0]).filter(Boolean));

          // Also check past hr.expense usage for this company (outlet cash purchases)
          const exps = await odoo(apiKey, 'hr.expense', 'search_read',
            [[['company_id', '=', wantCompanyId], ['product_id', 'in', allIds]]],
            { fields: ['product_id'], limit: 5000 });
          for (const e of exps) if (e.product_id?.[0]) brandProductIds.add(e.product_id[0]);

          // Recently created products (< 7d) always pass the filter so new items don't disappear
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

          const filtered = all.filter(p =>
            brandProductIds.has(p.id) ||
            (p.create_date && p.create_date >= sevenDaysAgo)
          );

          // If filter collapsed to nothing sensible (<3 items), fall back to full set with a flag
          if (filtered.length < 3) {
            return json({ success: true, products: all, brand_filtered: false,
                          reason: 'Not enough brand history — showing full registry' });
          }
          return json({ success: true, products: filtered, brand_filtered: true, brand: brandParam });
        } catch (e) { console.error('brand filter fail:', e.message); }
      }
      return json({ success: true, products: all, brand_filtered: false });
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

      // Pull all parent categories under the root + products per category.
      // Apply admin display overrides so cashier UI shows Naveen's renames.
      const overrides = await loadCategoryOverrides(DB);
      const categoriesForStructure = mergeCategoryOverrides(overrides);
      const structureCats = await Promise.all(categoriesForStructure.map(async (cat) => {
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
      const catIdInt = parseInt(cat_id, 10);
      let cat = CATEGORIES.find(c => c.id === catIdInt);
      if (!cat && catIdInt >= 100 && DB) {
        cat = (await loadCustomCategories(DB)).find(c => c.id === catIdInt);
      }
      if (!cat) return json({ success: false, error: 'Unknown category' }, 400);
      if (cat.backend !== 'hr.expense') return json({ success: false, error: 'Only expense categories support inline product creation' }, 400);
      if (!name?.trim()) return json({ success: false, error: 'Name required' }, 400);

      // Resolve category:
      //   Custom cat → use stored odoo_category_id.
      //   Cat 1 (Raw Material Purchase) lives in the "Raw Materials" taxonomy (id 21)
      //     where Zoya's HN-RM-* registry is.
      //   All other built-in cats resolve via parentName ilike.
      let categId = null;
      if (cat.custom && cat.odoo_category_id) {
        categId = cat.odoo_category_id;
      } else if (catIdInt === 1) {
        const rm = await odoo(apiKey, 'product.category', 'search_read',
          [[['name', '=', 'Raw Materials']]], { fields: ['id'], limit: 1 });
        if (!rm.length) return json({ success: false, error: 'Raw Materials category not found in Odoo' }, 404);
        categId = rm[0].id;
      } else {
        const parentList = await odoo(apiKey, 'product.category', 'search_read',
          [[['name', 'ilike', cat.parentName]]],
          { fields: ['id', 'name'], limit: 1 });
        if (!parentList.length) return json({ success: false, error: `Parent category "${cat.parentName}" not found in Odoo` }, 404);
        categId = parentList[0].id;
      }

      // Raw materials are consumable goods, not services. Everything else is a service.
      const prodType = catIdInt === 1 ? 'consu' : 'service';
      const prodId = await odoo(apiKey, 'product.product', 'create', [{
        name: name.trim(),
        categ_id: categId,
        type: prodType,
        can_be_expensed: true,
        purchase_ok: true,
        sale_ok: false,
        uom_id: uom_id ? parseInt(uom_id, 10) : undefined,
      }]);

      return json({ success: true, product: { id: prodId, name: name.trim() } });
    }

    // ── CREATE VENDOR (inline-add for cats 1, 14, 15) ──────
    if (action === 'create-vendor' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, name, phone, email, address, gst } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!name?.trim()) return json({ success: false, error: 'Name required' }, 400);

      const partnerVals = {
        name: name.trim(),
        supplier_rank: 1,
        is_company: true,
      };
      if (phone?.trim())   partnerVals.phone   = phone.trim();
      if (email?.trim())   partnerVals.email   = email.trim();
      if (address?.trim()) partnerVals.street  = address.trim();
      if (gst?.trim())     partnerVals.vat     = gst.trim().toUpperCase();

      const vendorId = await odoo(apiKey, 'res.partner', 'create', [partnerVals]);

      return json({ success: true, vendor: { id: vendorId, name: name.trim(), phone: phone?.trim() || '' } });
    }

    // ── VENDORS (for Cat 1, 2, 14, 15) ─────────────────────
    if (action === 'vendors') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const companyId = BRAND_COMPANY[brand];
      // Optional cat_id filter: when present, restrict to vendors tagged with
      // the matching "Cat:<id> ..." res.partner.category. Preserves backward
      // compat — omit cat_id and you get all brand vendors as before.
      const catIdRaw = url.searchParams.get('cat_id');
      const catId = catIdRaw ? parseInt(catIdRaw, 10) : null;
      const domain = companyId
        ? [['supplier_rank', '>', 0], ['company_id', 'in', [companyId, false]]]
        : [['supplier_rank', '>', 0]];
      if (catId) {
        // Resolve the Cat:<id> tag → partner category id, then filter
        const tagHits = await odoo(apiKey, 'res.partner.category', 'search_read',
          [[['name', 'like', `Cat:${catId} `]]], { fields: ['id'], limit: 1 });
        if (tagHits.length) {
          domain.push(['category_id', 'in', [tagHits[0].id]]);
        }
        // If tag doesn't exist yet, we silently do not filter — avoids locking
        // users out before Step 1 seeding has run in a fresh environment.
      }
      const vendors = await odoo(apiKey, 'res.partner', 'search_read',
        [domain],
        { fields: ['id', 'name', 'phone', 'category_id'],
          order: 'name asc', limit: 200 });
      // Fallback for empty cat_id result: return all vendors w/ a hint so UI
      // can surface a banner "No vendors tagged for <Cat>. Showing all."
      if (catId && vendors.length === 0) {
        const allVendors = await odoo(apiKey, 'res.partner', 'search_read',
          [domain.filter(d => d[0] !== 'category_id')],
          { fields: ['id', 'name', 'phone', 'category_id'],
            order: 'name asc', limit: 200 });
        return json({ success: true, vendors: allVendors, fallback: true, reason: 'no_tagged_vendors' });
      }
      return json({ success: true, vendors });
    }

    // ── ADMIN: list vendors + category tags (for vendor manager) ────────
    if (action === 'list-vendors-with-cats') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) return json({ success: false, error: 'Admin only' }, 403);

      const vendors = await odoo(apiKey, 'res.partner', 'search_read',
        [[['supplier_rank', '>', 0]]],
        { fields: ['id', 'name', 'phone', 'category_id', 'company_id'],
          order: 'name asc', limit: 500 });

      // Build tagId → cat_id map so UI can show category pills
      const catTags = await odoo(apiKey, 'res.partner.category', 'search_read',
        [[['name', 'like', 'Cat:']]], { fields: ['id', 'name'] });
      const tagToCat = {};
      for (const t of catTags) {
        const m = (t.name || '').match(/^Cat:(\d+) /);
        if (m) tagToCat[t.id] = parseInt(m[1], 10);
      }
      return json({ success: true, vendors, tag_to_cat: tagToCat });
    }

    // ── ADMIN: set vendor category tags (replace, union, or remove) ─────
    if (action === 'set-vendor-cats' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, vendor_id, cat_ids } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) return json({ success: false, error: 'Admin only' }, 403);
      if (!vendor_id || !Array.isArray(cat_ids)) {
        return json({ success: false, error: 'vendor_id + cat_ids required' }, 400);
      }

      // Load all Cat:<id> tags to know which to add/remove
      const catTags = await odoo(apiKey, 'res.partner.category', 'search_read',
        [[['name', 'like', 'Cat:']]], { fields: ['id', 'name'] });
      const tagToCat = {}; const catToTag = {};
      for (const t of catTags) {
        const m = (t.name || '').match(/^Cat:(\d+) /);
        if (m) { tagToCat[t.id] = parseInt(m[1], 10); catToTag[parseInt(m[1], 10)] = t.id; }
      }

      // Read current tags, keep non-Cat:* tags, swap Cat:* tags to desired set
      const vendorRows = await odoo(apiKey, 'res.partner', 'read',
        [[parseInt(vendor_id, 10)]], { fields: ['category_id'] });
      if (!vendorRows.length) return json({ success: false, error: 'Vendor not found' }, 404);
      const currentTags = vendorRows[0].category_id || [];
      const keepTags = currentTags.filter(tid => !(tid in tagToCat));
      const newCatTags = cat_ids.map(c => catToTag[parseInt(c, 10)]).filter(Boolean);
      const finalTags = [...new Set([...keepTags, ...newCatTags])];
      await odoo(apiKey, 'res.partner', 'write',
        [[parseInt(vendor_id, 10)], { category_id: [[6, 0, finalTags]] }]);
      return json({ success: true, vendor_id: parseInt(vendor_id, 10), tags: finalTags });
    }

    // ── ADMIN: edit display of a locked category (1-15) ─────────────────
    // Label / emoji / description / parent_name are editable; id + backend
    // stay immutable (30+ references to id numbers in PIN scope + dashboard).
    if (action === 'edit-category-display' && request.method === 'POST') {
      if (!DB) return json({ success: false, error: 'D1 not configured' }, 500);
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, id, label, emoji, description, parent_name } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) return json({ success: false, error: 'Admin only' }, 403);
      const catId = parseInt(id, 10);
      if (!catId || catId < 1 || catId > 15) {
        return json({ success: false, error: 'id must be 1..15 (use custom category actions for 16+)' }, 400);
      }
      const base = CATEGORIES.find(c => c.id === catId);
      if (!base) return json({ success: false, error: 'Unknown category id' }, 400);

      // Optionally rename the Odoo product.category if parent_name changed
      if (parent_name && parent_name !== base.parentName) {
        try {
          const hits = await odoo(apiKey, 'product.category', 'search_read',
            [[['name', '=', base.parentName]]], { fields: ['id'], limit: 1 });
          if (hits.length) {
            await odoo(apiKey, 'product.category', 'write',
              [[hits[0].id], { name: parent_name }]);
          }
        } catch (e) { /* fall through — record override even if Odoo rename fails */ }
      }

      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await DB.prepare(
        `INSERT INTO expense_cat_override (id, label, emoji, description, parent_name, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           emoji = excluded.emoji,
           description = excluded.description,
           parent_name = excluded.parent_name,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      ).bind(catId,
             label || null, emoji || null, description || null,
             parent_name || null, now, String(pin)).run();

      return json({ success: true, id: catId, label, emoji, description, parent_name });
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
        // Resolve employee_id — salary/advance require explicit; others default to PIN owner,
        // but ONLY if that owner's Odoo employee belongs to the target brand's company.
        // Odoo blocks hr.expense when employee's company_id != record's company_id ("no crossover").
        // Previously fell back to Administrator (id=1, HQ) — broke every NCH/HE expense from an
        // HQ user. Now falls back to the first active employee in the target company.
        let empId = employee_id ? parseInt(employee_id, 10) : null;

        // PRE-FLIGHT: if client supplied an employee_id (from /ops/expense/ dropdown),
        // verify it exists + is active + belongs to target company BEFORE hr.expense.create.
        // D1 hr_employees is a mirror — when it drifts from Odoo (archive/delete in Odoo
        // not reflected in D1), the dropdown serves dead IDs and Odoo raises a raw
        // MissingError. We verify up front, self-heal the D1 mirror, and surface a
        // clear error instead of bubbling Odoo's internal message to Naveen.
        if (empId) {
          const live = await odoo(apiKey, 'hr.employee', 'search_read',
            [[['id', '=', empId], ['company_id', '=', companyId], ['active', '=', true]]],
            { fields: ['id', 'name'], limit: 1 });
          if (!live?.length) {
            // Diagnose: gone entirely, archived, or wrong company?
            const anyHit = await odoo(apiKey, 'hr.employee', 'search_read',
              [[['id', '=', empId]]],
              { fields: ['id', 'active', 'company_id', 'name'], limit: 1,
                context: { active_test: false } });
            // Self-heal D1 so the dropdown stops offering this id next load.
            if (env.DB) {
              await env.DB.prepare(
                "UPDATE hr_employees SET is_active = 0, updated_at = datetime('now') WHERE odoo_employee_id = ?"
              ).bind(empId).run().catch(() => {});
            }
            let reason;
            if (!anyHit?.length) {
              reason = 'no longer exists in Odoo (record deleted)';
            } else if (!anyHit[0].active) {
              reason = 'is archived in Odoo';
            } else {
              const cn = Array.isArray(anyHit[0].company_id) ? anyHit[0].company_id[1] : anyHit[0].company_id;
              reason = `belongs to a different company (${cn}), not ${brand}`;
            }
            return json({
              success: false,
              code: 'EMPLOYEE_STALE',
              stale_odoo_id: empId,
              error: `Selected employee ${reason}. Dropdown has been refreshed — please re-open the form and pick a current employee. If this is a salary/advance, ask Nihaf to (re)create the employee in Odoo first.`,
            }, 409);
          }
        }

        if (!empId) {
          const pinRow = await env.DB.prepare(
            'SELECT odoo_employee_id FROM hr_employees WHERE pin = ? AND is_active = 1'
          ).bind(pin).first().catch(() => null);
          empId = pinRow?.odoo_employee_id || null;

          // Verify PIN-owner's employee is in target company; if not, empId = null to trigger fallback.
          if (empId) {
            const check = await odoo(apiKey, 'hr.employee', 'search_read',
              [[['id', '=', empId], ['company_id', '=', companyId], ['active', '=', true]]],
              { fields: ['id'], limit: 1 });
            if (!check?.length) empId = null;
          }

          // Brand-scoped fallback — any active employee in the target Odoo company.
          if (!empId) {
            const brandEmp = await odoo(apiKey, 'hr.employee', 'search_read',
              [[['company_id', '=', companyId], ['active', '=', true]]],
              { fields: ['id', 'name'], limit: 1 });
            if (!brandEmp?.length) {
              return json({ success: false,
                error: `No active employee in Odoo for ${brand} (company_id=${companyId}) — cannot create hr.expense. Add at least one ${brand} employee in Odoo first.`
              }, 400);
            }
            empId = brandEmp[0].id;
          }
        }

        // Fetch product for name + default_code
        const prodRows = await odoo(apiKey, 'product.product', 'search_read',
          [[['id', '=', parseInt(product_id, 10)]]],
          { fields: ['name', 'default_code'], limit: 1 });
        const prodName = prodRows[0]?.name || 'Expense';

        // Optional backdated date — must be YYYY-MM-DD, defaults to today
        const customDate = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

        // Payroll period + intent — mandatory for cats 3 (Salary Payment) and 4 (Salary Advance).
        // Without this, a March salary paid on April 5 is indistinguishable from an April advance
        // and double-counts in the per-employee settlement ledger.
        //   payroll_period: YYYY-MM (which month is being settled / advanced against)
        //   payroll_intent: 'clear_prior' | 'current_month' | 'advance_next'
        let payrollPeriod = null, payrollIntent = null;
        if (cat.id === 3 || cat.id === 4) {
          payrollPeriod = (body.payroll_period || '').trim();
          payrollIntent = (body.payroll_intent || '').trim();
          if (!/^\d{4}-\d{2}$/.test(payrollPeriod)) {
            return json({ success: false,
              error: 'payroll_period required (YYYY-MM) — which month is this payment settling or advancing against?'
            }, 400);
          }
          const validIntents = cat.id === 3
            ? ['clear_prior', 'current_month']          // Salary Payment — settles a past/current month
            : ['current_month', 'advance_next'];        // Salary Advance — advance against current/next
          if (!validIntents.includes(payrollIntent)) {
            return json({ success: false,
              error: `payroll_intent for ${cat.label} must be one of: ${validIntents.join(', ')}`
            }, 400);
          }
        }

        // Build a period-tagged name so the distinction is visible in Odoo AND in D1.
        // [Mar 2026 · Cleared] Salary Payment — Basheer Bhai
        let baseName = notes ? `${prodName} — ${notes}` : prodName;
        if (payrollPeriod) {
          const [py, pm] = payrollPeriod.split('-');
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const tagMonth = `${months[parseInt(pm,10)-1]} ${py}`;
          const tagIntent = { clear_prior: 'Cleared', current_month: 'Current', advance_next: 'Advance' }[payrollIntent];
          baseName = `[${tagMonth} · ${tagIntent}] ${baseName}`;
        }

        const expenseVals = {
          name: baseName,
          product_id: parseInt(product_id, 10),
          total_amount: parseFloat(amount),
          employee_id: empId,
          company_id: companyId,
          date: customDate,
          payment_mode: 'company_account',  // Paid from company till — no reimbursement
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

        // Optional bill photo — write to Odoo AND to Drive AND to D1 bill_attachments.
        // Only the D1 write makes the bill visible in the ledger UI (/ops/purchase/view/)
        // so this is the source of truth for "what has a bill attached".
        // Rename to structured pattern before any write so Odoo + Drive + D1 all carry
        // the same scannable name (not the original "WhatsApp Image..." filename).
        if (body.attachment) {
          body.attachment = {
            ...body.attachment,
            name: buildBillFilename({
              date: customDate, category: cat.label, brand,
              product: prodName, amount, recorded_by: user.name,
            }),
          };
        }
        const attId = await saveAttachment(apiKey, body.attachment, 'hr.expense', expenseId);
        const driveInfo = await syncToDrive(env, body.attachment ? {
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
        if (body.attachment) {
          await logBillAttachment(DB, {
            kind: 'Expense', odoo_id: expenseId, brand,
            entry_date: customDate, entry_amount: parseFloat(amount),
            odoo_attachment_id: attId,
            drive_file_id: driveInfo?.file_id, drive_view_url: driveInfo?.view_url, drive_path: driveInfo?.path,
            filename: body.attachment.name, mimetype: body.attachment.mimetype,
            data_b64: body.attachment.data_b64, pin, user_name: user.name,
          });
        }
        const driveFile = driveFileId(driveInfo);

        // Mirror to D1 for fast reads (matches existing business_expenses schema)
        if (DB) {
          const payMode = payment_method === 'cash' ? 'cash' : 'bank';
          await DB.prepare(
            `INSERT INTO business_expenses
               (recorded_by, recorded_at, amount, description, category, payment_mode, notes,
                odoo_id, company_id, product_id, product_name, category_parent,
                x_pool, x_payment_method, x_location, x_excluded_from_pnl, odoo_synced_at,
                x_payroll_period, x_payroll_intent, x_employee_odoo_id)
             VALUES (?, datetime('now'), ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, datetime('now'),
                     ?, ?, ?)`
          ).bind(
            user.name, parseFloat(amount), prodName, cat.label, payMode, notes || '',
            expenseId, companyId, parseInt(product_id, 10), prodName, cat.parentName || null,
            expenseVals.x_pool, expenseVals.x_payment_method, brand, cat.id === 13 ? 1 : 0,
            payrollPeriod, payrollIntent, (cat.id === 3 || cat.id === 4) ? empId : null
          ).run().catch(e => console.error('mirror fail:', e.message));
        }

        return json({ success: true, odoo_id: expenseId, backend: 'hr.expense', category: cat.label,
          attachment_id: attId, drive_file_id: driveFile, drive_view_url: driveInfo?.view_url || null });
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
        // Rename for consistency across Odoo + Drive + D1
        if (body.attachment) {
          body.attachment = {
            ...body.attachment,
            name: buildBillFilename({
              date: customInvDate, category: cat.label, brand,
              product: body.vendor_name || 'Vendor-bill',
              amount, recorded_by: user.name,
            }),
          };
        }
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
        if (body.attachment) {
          await logBillAttachment(DB, {
            kind: 'Bill', odoo_id: moveId, brand,
            entry_date: customInvDate, entry_amount: parseFloat(amount),
            odoo_attachment_id: attId14,
            drive_file_id: drive14?.file_id, drive_view_url: drive14?.view_url, drive_path: drive14?.path,
            filename: body.attachment.name, mimetype: body.attachment.mimetype,
            data_b64: body.attachment.data_b64, pin, user_name: user.name,
          });
        }
        return json({ success: true, odoo_id: moveId, backend: 'account.move', category: cat.label,
          attachment_id: attId14, drive_file_id: driveFileId(drive14), drive_view_url: drive14?.view_url || null });
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

    // ── PATCH EXPENSE NAME (admin / cfo only) — fix description without delete/re-create ──
    if (action === 'patch-expense' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, odoo_id, name } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!['admin','cfo'].includes(user.role)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can patch expense names' }, 403);
      }
      if (!odoo_id || !name?.trim()) return json({ success: false, error: 'odoo_id and name required' }, 400);
      await odoo(apiKey, 'hr.expense', 'write', [[parseInt(odoo_id, 10)], { name: name.trim() }]);
      if (DB) {
        await DB.prepare('UPDATE business_expenses SET description = ? WHERE odoo_id = ?')
          .bind(name.trim(), parseInt(odoo_id, 10)).run().catch(() => {});
      }
      return json({ success: true, odoo_id, name: name.trim() });
    }

    // ─────────────────────────────────────────────────────────────────────
    // PURCHASE LEDGER — read-only unified view for Zoya / GMs / admin
    // Returns purchase.order + RM/Capex hr.expense + account.move(in_invoice)
    // in one sorted list, with attachment counts for "missing bill" filter.
    // Roles: admin, cfo, purchase, gm.  Purely additive — does not touch
    // any existing record-creation path.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'purchase-ledger') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr'];
      if (!LEDGER_ROLES.includes(user.role)) {
        return json({ success: false, error: `Access denied for role ${user.role}` }, 403);
      }

      const from = url.searchParams.get('from') || new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
      const to   = url.searchParams.get('to')   || new Date().toISOString().slice(0, 10);
      const brandFilter = (url.searchParams.get('brand') || 'ALL').toUpperCase();
      const companyId = brandFilter !== 'ALL' ? BRAND_COMPANY[brandFilter] : null;

      // Step 1 — resolve RM + Capex category descendants (for hr.expense filter)
      const parentCats = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', 'in', ['01 · Raw Materials', '14 · One-Time Capex']]]],
        { fields: ['id', 'name'] });
      let rmCapexCatIds = [];
      if (parentCats.length) {
        const childCats = await odoo(apiKey, 'product.category', 'search_read',
          [[['id', 'child_of', parentCats.map(c => c.id)]]],
          { fields: ['id'], limit: 500 });
        rmCapexCatIds = childCats.map(c => c.id);
      }

      // Step 2 — parallel fetch PO, RM/Capex expenses, bills
      const poFilter = [['date_order', '>=', from + ' 00:00:00'], ['date_order', '<=', to + ' 23:59:59']];
      if (companyId) poFilter.push(['company_id', '=', companyId]);

      const expFilter = [['date', '>=', from], ['date', '<=', to]];
      if (companyId) expFilter.push(['company_id', '=', companyId]);
      if (rmCapexCatIds.length) expFilter.push(['product_id.categ_id', 'in', rmCapexCatIds]);
      else expFilter.push(['id', '=', -1]); // no categories → return empty

      const billFilter = [['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to]];
      if (companyId) billFilter.push(['company_id', '=', companyId]);

      const [pos, expenses, bills] = await Promise.all([
        // purchase.order: `notes` field was removed in Odoo 17+. Field list kept minimal.
        odoo(apiKey, 'purchase.order', 'search_read', [poFilter],
          { fields: ['id', 'name', 'partner_id', 'company_id', 'date_order', 'amount_total',
                     'state', 'order_line', 'x_recorded_by_user_id'],
            order: 'date_order desc', limit: 500 }),
        odoo(apiKey, 'hr.expense', 'search_read', [expFilter],
          { fields: ['id', 'name', 'date', 'total_amount', 'product_id', 'company_id',
                     'x_pool', 'x_location', 'x_submitted_by_pin', 'x_recorded_by_user_id'],
            order: 'date desc', limit: 500 }),
        // account.move: narration is standard but might be renamed — tolerate missing.
        odoo(apiKey, 'account.move', 'search_read', [billFilter],
          { fields: ['id', 'name', 'ref', 'invoice_date', 'partner_id', 'company_id',
                     'amount_total', 'payment_state', 'invoice_origin', 'x_recorded_by_user_id'],
            order: 'invoice_date desc', limit: 500 }),
      ]);

      // Step 3a — batched Odoo attachment counts (covers bills uploaded outside this UI)
      const countAtt = async (resModel, ids) => {
        if (!ids.length) return {};
        const atts = await odoo(apiKey, 'ir.attachment', 'search_read',
          [[['res_model', '=', resModel], ['res_id', 'in', ids]]],
          { fields: ['res_id'], limit: 5000 });
        const counts = {};
        atts.forEach(a => { counts[a.res_id] = (counts[a.res_id] || 0) + 1; });
        return counts;
      };
      const [poAtts, expAtts, billAtts] = await Promise.all([
        countAtt('purchase.order', pos.map(p => p.id)),
        countAtt('hr.expense',    expenses.map(e => e.id)),
        countAtt('account.move',  bills.map(b => b.id)),
      ]);

      // Step 3b — D1 bill registry (files we've tracked, with Drive URLs).
      // IMPORTANT: D1 caps prepared-statement parameters around 100, so an
      // `entry_odoo_id IN (?,?,...)` with hundreds of ids fails silently and
      // leaves d1Atts empty (producing the "attachments in Odoo not tracked
      // here" fallback even when they ARE tracked). Fix: single range-scan
      // query over bill_attachments filtered by entry_date, then group
      // client-side by (kind, odoo_id).
      const d1Atts = {};
      if (DB) {
        try {
          const res = await DB.prepare(`
            SELECT entry_kind, entry_odoo_id, drive_file_id, drive_view_url, drive_folder_path,
                   filename, file_size_kb, uploaded_by_pin, uploaded_by_name, uploaded_at
            FROM bill_attachments
            WHERE entry_date BETWEEN ? AND ?
            ORDER BY uploaded_at DESC
          `).bind(from, to).all();
          for (const row of res?.results || []) {
            const key = `${row.entry_kind}-${row.entry_odoo_id}`;
            if (!d1Atts[key]) d1Atts[key] = [];
            d1Atts[key].push({
              drive_file_id: row.drive_file_id,
              drive_url: row.drive_view_url,
              drive_path: row.drive_folder_path,
              filename: row.filename,
              size_kb: row.file_size_kb,
              uploaded_by: row.uploaded_by_name,
              uploaded_by_pin: row.uploaded_by_pin,
              uploaded_at: row.uploaded_at,
            });
          }
        } catch (e) { console.error('D1 bill_attachments fetch fail:', e.message); }
      }

      // Step 4 — normalize to unified row shape
      const companyToBrand = { 1: 'HQ', 2: 'HE', 3: 'NCH' };
      const toRow = (kind, base, attMap) => {
        const tracked = d1Atts[`${kind}-${base.odoo_id}`] || [];
        const odooCount = attMap[base.odoo_id] || 0;
        // Show total of what we know: tracked files (with Drive URLs) + any
        // Odoo-side attachments we didn't record (uploaded via Odoo UI).
        // The UI uses `attachments` array for the list; count for the badge.
        const trackedCount = tracked.length;
        const externalInOdoo = Math.max(0, odooCount - trackedCount);
        return {
          kind, odoo_id: base.odoo_id, date: base.date,
          vendor: base.vendor,
          item_or_ref: base.item_or_ref,
          brand: companyToBrand[base.company_id] || '?',
          amount: base.amount,
          state: base.state,
          has_attachment: trackedCount > 0 || odooCount > 0,
          attachment_count: Math.max(trackedCount, odooCount),
          attachments: tracked,                // detailed list with Drive URLs
          odoo_only_count: externalInOdoo,     // files in Odoo not tracked here
          recorded_by_user_id: base.recorded_by_user_id || null,
          recorded_by_name:    base.recorded_by_name    || null,
          recorded_by_pin:     base.recorded_by_pin     || null,
          notes: base.notes || '',
          bill_ref: base.bill_ref || '',
        };
      };

      const rows = [
        ...pos.map(p => toRow('PO', {
          odoo_id: p.id,
          date: (p.date_order || '').slice(0, 10),
          vendor: p.partner_id ? { id: p.partner_id[0], name: p.partner_id[1] } : null,
          item_or_ref: `${p.name || 'PO'} · ${p.order_line?.length || 0} item${p.order_line?.length === 1 ? '' : 's'}`,
          company_id: p.company_id?.[0],
          amount: p.amount_total || 0,
          state: p.state,
          recorded_by_user_id: p.x_recorded_by_user_id?.[0] || null,
          recorded_by_name:    p.x_recorded_by_user_id?.[1] || null,
          // notes for PO go to Odoo chatter (mail.message) — not inline editable in this v1
        }, poAtts)),
        ...expenses.map(e => toRow('Expense', {
          odoo_id: e.id,
          date: e.date || '',
          vendor: null,
          item_or_ref: e.name || e.product_id?.[1] || 'Expense',
          company_id: e.company_id?.[0],
          amount: e.total_amount || 0,
          state: e.x_pool === 'capex' ? 'capex' : 'opex',
          recorded_by_user_id: e.x_recorded_by_user_id?.[0] || null,
          recorded_by_name:    e.x_recorded_by_user_id?.[1] || null,
          recorded_by_pin:     e.x_submitted_by_pin || null,
          notes: e.name || '',  // hr.expense uses `name` as description
        }, expAtts)),
        ...bills.map(b => toRow('Bill', {
          odoo_id: b.id,
          date: b.invoice_date || '',
          vendor: b.partner_id ? { id: b.partner_id[0], name: b.partner_id[1] } : null,
          item_or_ref: b.ref || b.name || 'Bill',
          company_id: b.company_id?.[0],
          amount: b.amount_total || 0,
          state: b.payment_state || 'not_paid',
          recorded_by_user_id: b.x_recorded_by_user_id?.[0] || null,
          recorded_by_name:    b.x_recorded_by_user_id?.[1] || null,
          bill_ref: b.ref || '',
          // narration for Bill goes to Odoo chatter — not inline editable in this v1
        }, billAtts)),
      ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const totals = {
        count: rows.length,
        amount: rows.reduce((s, r) => s + (r.amount || 0), 0),
        missing_bill_count: rows.filter(r => !r.has_attachment).length,
        with_bill_count:    rows.filter(r =>  r.has_attachment).length,
        by_kind: {
          PO:      rows.filter(r => r.kind === 'PO').length,
          Expense: rows.filter(r => r.kind === 'Expense').length,
          Bill:    rows.filter(r => r.kind === 'Bill').length,
        },
      };
      return json({ success: true, rows, totals, from, to, brand: brandFilter });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ATTACH BILL — upload bill photo to an existing PO / Expense / Bill
    // 1. Attach to Odoo (ir.attachment)
    // 2. Send to Google Drive via webhook → structured folder tree
    // 3. Record in D1 bill_attachments with Drive view URL → UI source of truth
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'attach-bill' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, kind, odoo_id, attachment } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr'];
      if (!LEDGER_ROLES.includes(user.role)) return json({ success: false, error: 'Access denied' }, 403);
      if (!odoo_id || !attachment?.data_b64) {
        return json({ success: false, error: 'odoo_id and attachment.data_b64 required' }, 400);
      }
      const MODEL = { PO: 'purchase.order', Expense: 'hr.expense', Bill: 'account.move' };
      const resModel = MODEL[kind];
      if (!resModel) return json({ success: false, error: 'kind must be PO|Expense|Bill' }, 400);

      const entryDate = body.date || new Date().toISOString().slice(0, 10);
      const brand = body.brand || 'HQ';
      const entryAmount = body.amount != null ? parseFloat(body.amount) : null;
      const idInt = parseInt(odoo_id, 10);

      // Rename to structured pattern — overrides whatever filename the user's
      // phone sent (e.g. "WhatsApp Image 2026-04-21 at 16.47.02.jpeg") so Odoo,
      // Drive, and D1 all carry the same readable name.
      const structuredName = buildBillFilename({
        date: entryDate, category: `${kind}-bill`, brand,
        product: body.product_hint || `${kind}-${idInt}`,
        amount: entryAmount, recorded_by: user.name,
      });
      const renamedAttachment = { ...attachment, name: structuredName };

      // Step 1 — Odoo attachment (always attempt; may fail if Odoo rejects)
      let attId = null;
      try {
        attId = await saveAttachment(apiKey, renamedAttachment, resModel, idInt);
      } catch (e) {
        console.error('Odoo attach fail:', e.message);
      }

      // Step 2 — Drive sync (inline so we can capture both file_id AND view_url)
      let driveInfo = null;
      if (env?.DRIVE_WEBHOOK_URL) {
        try {
          const driveRes = await fetch(env.DRIVE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: entryDate,
              company: brand,
              category: `${kind}-bill`,
              product: `${kind} #${odoo_id}`,
              amount: entryAmount,
              recorded_by: user.name,
              filename: renamedAttachment.name,
              mimetype: renamedAttachment.mimetype || 'image/jpeg',
              data_b64: renamedAttachment.data_b64,
            }),
          });
          driveInfo = await driveRes.json().catch(() => null);
          if (driveInfo && !driveInfo.success) driveInfo = null;
        } catch (e) { console.error('Drive sync fail:', e.message); }
      }

      // If BOTH failed we cannot claim the upload worked
      if (!attId && !driveInfo?.file_id) {
        return json({ success: false, error: 'Both Odoo and Drive save failed' }, 500);
      }

      // Step 3 — D1 registry (source of truth for UI)
      const fileSizeKb = Math.round(((renamedAttachment.data_b64 || '').length * 3 / 4) / 1024);
      try {
        if (DB) {
          await DB.prepare(`
            INSERT INTO bill_attachments
              (entry_kind, entry_odoo_id, brand, entry_date, entry_amount,
               odoo_attachment_id, drive_file_id, drive_view_url, drive_folder_path,
               filename, mimetype, file_size_kb, uploaded_by_pin, uploaded_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            kind, idInt, brand, entryDate, entryAmount,
            attId, driveInfo?.file_id || null, driveInfo?.view_url || null, driveInfo?.path || null,
            renamedAttachment.name, renamedAttachment.mimetype || 'image/jpeg',
            fileSizeKb, String(pin), user.name
          ).run();
        }
      } catch (e) { console.error('D1 bill_attachments insert fail:', e.message); }

      return json({
        success: true,
        attachment_id: attId,
        drive_file_id: driveInfo?.file_id || null,
        drive_view_url: driveInfo?.view_url || null,
        drive_path: driveInfo?.path || null,
        filename: renamedAttachment.name,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // BACKFILL BILLS — one-time reconciler for bills uploaded before D1
    // tracking existed.  Walks Odoo ir.attachment rows for PO/Expense/Bill
    // in the date range, looks up each file in Drive by filename via the
    // drive-webhook list endpoint, and inserts bill_attachments rows with
    // the real drive_view_url so every old bill becomes clickable.
    //
    // Admin / CFO only.  Idempotent — skips rows that already exist in D1.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'backfill-bills' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      if (!env?.DRIVE_WEBHOOK_URL) return json({ success: false, error: 'DRIVE_WEBHOOK_URL not set' }, 500);
      if (!DB) return json({ success: false, error: 'D1 binding missing' }, 500);
      const body = await request.json().catch(() => ({}));
      const { pin } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!['admin','cfo'].includes(user.role)) {
        return json({ success: false, error: 'Admin/CFO only' }, 403);
      }
      const from = body.from || '2026-04-01';
      const to   = body.to   || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json({ success: false, error: 'from/to must be YYYY-MM-DD' }, 400);
      }

      // Step 1 — collect entries per kind in the date range with date + brand
      const companyToBrand = { 1: 'HQ', 2: 'HE', 3: 'NCH' };
      const [pos, expenses, bills] = await Promise.all([
        odoo(apiKey, 'purchase.order', 'search_read',
          [[['date_order', '>=', from + ' 00:00:00'], ['date_order', '<=', to + ' 23:59:59']]],
          { fields: ['id', 'date_order', 'company_id', 'amount_total'], limit: 2000 }),
        odoo(apiKey, 'hr.expense', 'search_read',
          [[['date', '>=', from], ['date', '<=', to]]],
          { fields: ['id', 'date', 'company_id', 'total_amount'], limit: 2000 }),
        odoo(apiKey, 'account.move', 'search_read',
          [[['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to]]],
          { fields: ['id', 'invoice_date', 'company_id', 'amount_total'], limit: 2000 }),
      ]);

      // Index: res_model → id → { date, brand, amount }
      const entryIndex = { 'purchase.order': {}, 'hr.expense': {}, 'account.move': {} };
      for (const p of pos) {
        entryIndex['purchase.order'][p.id] = {
          date: (p.date_order || '').slice(0, 10),
          brand: companyToBrand[p.company_id?.[0]] || 'HQ',
          amount: p.amount_total,
        };
      }
      for (const e of expenses) {
        entryIndex['hr.expense'][e.id] = {
          date: e.date || '',
          brand: companyToBrand[e.company_id?.[0]] || 'HQ',
          amount: e.total_amount,
        };
      }
      for (const b of bills) {
        entryIndex['account.move'][b.id] = {
          date: b.invoice_date || '',
          brand: companyToBrand[b.company_id?.[0]] || 'HQ',
          amount: b.amount_total,
        };
      }

      // Step 2 — fetch all ir.attachment rows for these entries
      const allIds = {
        'purchase.order': Object.keys(entryIndex['purchase.order']).map(Number),
        'hr.expense':     Object.keys(entryIndex['hr.expense']).map(Number),
        'account.move':   Object.keys(entryIndex['account.move']).map(Number),
      };
      const attachmentsByModel = {};
      for (const [resModel, ids] of Object.entries(allIds)) {
        if (!ids.length) { attachmentsByModel[resModel] = []; continue; }
        attachmentsByModel[resModel] = await odoo(apiKey, 'ir.attachment', 'search_read',
          [[['res_model', '=', resModel], ['res_id', 'in', ids]]],
          { fields: ['id', 'res_model', 'res_id', 'name', 'mimetype', 'create_date', 'file_size'], limit: 5000 });
      }

      // Step 3 — index existing D1 rows so we can decide per-attachment
      //   • row already exists AND filename already structured → truly skip
      //   • row exists but filename unstructured → rename Drive + Odoo + D1
      //   • row missing → fresh match + insert
      const STRUCTURED_NAME_RE = /^\d{4}-\d{2}-\d{2}_/;
      const existing = await DB.prepare(
        `SELECT id AS d1_id, entry_kind, entry_odoo_id, odoo_attachment_id,
                drive_file_id, filename
         FROM bill_attachments`
      ).all();
      const existingByKey = new Map();
      for (const r of existing.results || []) {
        const k = `${r.entry_kind}-${r.entry_odoo_id}-${r.odoo_attachment_id || 'X'}`;
        existingByKey.set(k, r);
      }
      const kindOf = { 'purchase.order': 'PO', 'hr.expense': 'Expense', 'account.move': 'Bill' };

      // Step 4 — for each unique (date,brand) that has attachments, list Drive folder once
      const folderCache = {};   // key: "YYYY-MM/YYYY-MM-DD/BRAND" -> [{filename,file_id,view_url}, ...]
      const needFolders = new Set();
      const pending = []; // [{att, kind, entry, folderPath, existing?}]
      let alreadyGood = 0;
      for (const [resModel, atts] of Object.entries(attachmentsByModel)) {
        for (const att of atts) {
          const entry = entryIndex[resModel][att.res_id];
          if (!entry || !entry.date) continue;
          const kind = kindOf[resModel];
          const key = `${kind}-${att.res_id}-${att.id}`;
          const existingRow = existingByKey.get(key);
          // If fully processed already (has drive_file_id AND structured name) → truly skip
          if (existingRow && existingRow.drive_file_id && STRUCTURED_NAME_RE.test(existingRow.filename || '')) {
            alreadyGood++;
            continue;
          }
          const [yy, mm] = entry.date.split('-');
          const folderPath = `${yy}-${mm}/${entry.date}/${entry.brand}`;
          needFolders.add(folderPath);
          pending.push({ att, kind, entry, folderPath, existing: existingRow || null });
        }
      }

      // Step 5 — list Drive folders in parallel batches
      async function listFolder(path) {
        try {
          const r = await fetch(`${env.DRIVE_WEBHOOK_URL}?action=list&path=${encodeURIComponent(path)}`);
          const out = await r.json().catch(() => null);
          return out?.success ? (out.files || []) : [];
        } catch (e) { return []; }
      }
      const folderList = Array.from(needFolders);
      // Chunk to avoid overwhelming the webhook — Apps Script is single-threaded
      const CHUNK = 4;
      for (let i = 0; i < folderList.length; i += CHUNK) {
        const slice = folderList.slice(i, i + CHUNK);
        const results = await Promise.all(slice.map(p => listFolder(p).then(files => [p, files])));
        for (const [p, files] of results) folderCache[p] = files;
      }

      // Step 6 — match pending items, rename to structured pattern, insert
      let matched = 0, unmatched = 0, errors = 0, renamed = 0;
      const unmatchedSamples = [];
      const modelByKind = { PO: 'purchase.order', Expense: 'hr.expense', Bill: 'account.move' };

      async function renameDriveFile(fileId, newName) {
        try {
          const r = await fetch(env.DRIVE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rename', file_id: fileId, new_name: newName }),
          });
          const out = await r.json().catch(() => null);
          return out?.success === true;
        } catch (e) { return false; }
      }

      for (const it of pending) {
        const files = folderCache[it.folderPath] || [];
        // Match by exact current name first, then fall back to Odoo's stored name
        // (covers the case where Drive already got renamed but D1 is stale, or vice versa)
        const nameHints = [
          it.existing?.filename,
          it.att.name,
        ].filter(Boolean);
        let match = null;
        for (const h of nameHints) {
          match = files.find(f => f.filename === h);
          if (match) break;
        }
        // File-id match (if we stored it before) beats everything
        if (!match && it.existing?.drive_file_id) {
          match = files.find(f => f.file_id === it.existing.drive_file_id);
        }
        // Prefix fallback for "(1)" collision suffixes
        if (!match) {
          const base = (it.att.name || '').replace(/\.[^.]+$/, '');
          match = files.find(f => f.filename.startsWith(base));
        }
        if (!match) {
          unmatched++;
          if (unmatchedSamples.length < 10) unmatchedSamples.push({ filename: it.att.name, folder: it.folderPath });
          continue;
        }

        const structuredName = buildBillFilename({
          date: it.entry.date,
          category: `${it.kind}-bill`,
          brand: it.entry.brand,
          product: `${it.kind}-${it.att.res_id}`,
          amount: it.entry.amount,
          recorded_by: 'backfill',
        });

        let finalName = match.filename;
        if (match.filename !== structuredName) {
          const ok = await renameDriveFile(match.file_id, structuredName);
          if (ok) { finalName = structuredName; renamed++; }
        }
        if (finalName !== it.att.name) {
          try {
            await odoo(apiKey, 'ir.attachment', 'write', [[it.att.id], { name: finalName }]);
          } catch (e) { /* non-fatal */ }
        }

        try {
          if (it.existing) {
            // Update existing D1 row — fill in drive metadata + new name
            await DB.prepare(`
              UPDATE bill_attachments
              SET drive_file_id = ?, drive_view_url = ?, drive_folder_path = ?,
                  filename = ?
              WHERE id = ?
            `).bind(
              match.file_id, match.view_url, it.folderPath,
              finalName, it.existing.d1_id
            ).run();
          } else {
            await DB.prepare(`
              INSERT INTO bill_attachments
                (entry_kind, entry_odoo_id, brand, entry_date, entry_amount,
                 odoo_attachment_id, drive_file_id, drive_view_url, drive_folder_path,
                 filename, mimetype, file_size_kb, uploaded_by_pin, uploaded_by_name,
                 uploaded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              it.kind, it.att.res_id, it.entry.brand, it.entry.date, it.entry.amount,
              it.att.id, match.file_id, match.view_url, it.folderPath,
              finalName, it.att.mimetype || 'image/jpeg',
              Math.round((match.size || 0) / 1024),
              null, 'backfill',
              (it.att.create_date || new Date().toISOString()).replace('T', ' ').slice(0, 19)
            ).run();
          }
          matched++;
        } catch (e) {
          errors++;
          console.error('backfill insert fail:', e.message);
        }
      }

      return json({
        success: true,
        from, to,
        scanned_entries: pos.length + expenses.length + bills.length,
        scanned_attachments: Object.values(attachmentsByModel).reduce((s, a) => s + a.length, 0),
        folders_listed: folderList.length,
        matched, renamed, unmatched, already_structured: alreadyGood, errors,
        unmatched_samples: unmatchedSamples,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // RM ARCHITECTURE MIGRATION (admin/cfo only, idempotent, dry-run aware)
    // Three phases, runnable independently or together:
    //   phase=categories   → create sub-categories under "01 · Raw Materials"
    //   phase=relink       → re-link each D1 rm_products row to its new sub-cat
    //   phase=supplierinfo → sync D1 rm_vendor_products → Odoo product.supplierinfo
    //   phase=all          → run all three in order
    // Always returns a detailed report. Set dry_run=true to preview without writes.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'rm-migrate' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      if (!DB) return json({ success: false, error: 'D1 binding missing' }, 500);
      const body = await request.json().catch(() => ({}));
      const { pin, phase = 'all', dry_run = true } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!['admin','cfo'].includes(user.role)) {
        return json({ success: false, error: 'Admin/CFO only' }, 403);
      }

      const report = { phase, dry_run, steps: [] };

      // Resolve the RM parent category once (matches spend.js CATEGORIES parentName)
      const rmParentHits = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', '=', '01 · Raw Materials']]], { fields: ['id', 'name'], limit: 1 });
      if (!rmParentHits.length) {
        return json({ success: false, error: 'Parent category "01 · Raw Materials" not found in Odoo' }, 404);
      }
      const rmParentId = rmParentHits[0].id;
      report.rm_parent_category_id = rmParentId;

      // ── PHASE 1 — create sub-categories ────────────────────────────────
      const subCatMap = {};  // D1 category name → Odoo category id
      if (phase === 'categories' || phase === 'all') {
        const d1Cats = await DB.prepare(
          `SELECT DISTINCT category FROM rm_products WHERE is_active = 1 ORDER BY category`
        ).all();
        const subCatNames = (d1Cats.results || []).map(r => r.category).filter(Boolean);
        const created = [], existed = [];
        for (const subName of subCatNames) {
          const odooName = `RM / ${subName}`;
          // Check if already exists under this parent
          const existing = await odoo(apiKey, 'product.category', 'search_read',
            [[['name', '=', odooName], ['parent_id', '=', rmParentId]]],
            { fields: ['id'], limit: 1 });
          if (existing.length) {
            subCatMap[subName] = existing[0].id;
            existed.push({ d1_name: subName, odoo_name: odooName, id: existing[0].id });
            continue;
          }
          if (dry_run) {
            created.push({ d1_name: subName, odoo_name: odooName, id: null, dry_run: true });
            subCatMap[subName] = null;
            continue;
          }
          const newId = await odoo(apiKey, 'product.category', 'create',
            [{ name: odooName, parent_id: rmParentId }]);
          subCatMap[subName] = newId;
          created.push({ d1_name: subName, odoo_name: odooName, id: newId });
        }
        report.steps.push({
          phase: 'categories',
          summary: `${created.length} ${dry_run?'would-create':'created'}, ${existed.length} already existed`,
          created, existed,
        });
      }

      // ── PHASE 2 — re-link products (need subCatMap from Phase 1) ───────
      if (phase === 'relink' || phase === 'all') {
        // If Phase 1 wasn't run, load subcat map from Odoo
        if (!Object.keys(subCatMap).length) {
          const subs = await odoo(apiKey, 'product.category', 'search_read',
            [[['parent_id', '=', rmParentId]]],
            { fields: ['id', 'name'], limit: 100 });
          for (const s of subs) {
            const d1Name = s.name.startsWith('RM / ') ? s.name.slice(5) : s.name;
            subCatMap[d1Name] = s.id;
          }
        }
        const products = await DB.prepare(
          `SELECT hn_code, name, category, odoo_id FROM rm_products WHERE is_active = 1 AND odoo_id IS NOT NULL`
        ).all();
        const rows = products.results || [];
        const relinked = [], skipped = [], missing_subcat = [];

        // Batch-fetch current categ_ids for rollback / idempotency
        const ids = rows.map(r => r.odoo_id);
        const currentProducts = ids.length ? await odoo(apiKey, 'product.product', 'search_read',
          [[['id', 'in', ids]]],
          { fields: ['id', 'name', 'categ_id', 'product_tmpl_id'], limit: 2000 }) : [];
        const curByOdoo = Object.fromEntries(currentProducts.map(p => [p.id, p]));

        for (const r of rows) {
          const targetCatId = subCatMap[r.category];
          if (!targetCatId) {
            missing_subcat.push({ hn_code: r.hn_code, d1_category: r.category });
            continue;
          }
          const cur = curByOdoo[r.odoo_id];
          if (!cur) { skipped.push({ hn_code: r.hn_code, reason: 'odoo product not found' }); continue; }
          const curCatId = cur.categ_id?.[0];
          if (curCatId === targetCatId) {
            skipped.push({ hn_code: r.hn_code, reason: 'already on target category' });
            continue;
          }
          if (dry_run) {
            relinked.push({ hn_code: r.hn_code, odoo_id: r.odoo_id, from: curCatId, to: targetCatId, dry_run: true });
            continue;
          }
          // Write to product.template (categ_id lives there in Odoo 17+)
          const tmplId = cur.product_tmpl_id?.[0];
          if (tmplId) {
            await odoo(apiKey, 'product.template', 'write', [[tmplId], { categ_id: targetCatId }]);
          } else {
            await odoo(apiKey, 'product.product', 'write', [[r.odoo_id], { categ_id: targetCatId }]);
          }
          relinked.push({ hn_code: r.hn_code, odoo_id: r.odoo_id, from: curCatId, to: targetCatId });
        }
        report.steps.push({
          phase: 'relink',
          summary: `${relinked.length} ${dry_run?'would-relink':'re-linked'}, ${skipped.length} skipped (already correct or missing), ${missing_subcat.length} couldn't resolve sub-cat`,
          relinked_sample: relinked.slice(0, 5),
          skipped_sample: skipped.slice(0, 5),
          missing_subcat,
        });
      }

      // ── PHASE 3 — sync supplierinfo (D1 rm_vendor_products → Odoo) ─────
      if (phase === 'supplierinfo' || phase === 'all') {
        const links = await DB.prepare(`
          SELECT vp.product_code, vp.vendor_key, vp.is_primary, vp.last_price, vp.odoo_variant_id,
                 p.odoo_id AS product_odoo_id, p.name AS product_name,
                 v.odoo_id AS vendor_odoo_id, v.name AS vendor_name
          FROM rm_vendor_products vp
          JOIN rm_products p ON p.hn_code = vp.product_code AND p.is_active = 1
          JOIN rm_vendors v ON v.key = vp.vendor_key AND v.is_active = 1
          WHERE v.odoo_id IS NOT NULL AND p.odoo_id IS NOT NULL
        `).all();
        const rows = links.results || [];
        const created = [], existed = [], failed = [];

        // Fetch product templates for each product (supplierinfo binds to template)
        const prodIds = [...new Set(rows.map(r => r.product_odoo_id))];
        const prods = prodIds.length ? await odoo(apiKey, 'product.product', 'search_read',
          [[['id', 'in', prodIds]]],
          { fields: ['id', 'product_tmpl_id'], limit: 2000 }) : [];
        const tmplByProdId = Object.fromEntries(prods.map(p => [p.id, p.product_tmpl_id?.[0]]));

        for (const r of rows) {
          const tmplId = tmplByProdId[r.product_odoo_id];
          if (!tmplId) { failed.push({ code: r.product_code, reason: 'no template' }); continue; }
          // Check existing supplierinfo row
          const existingLink = await odoo(apiKey, 'product.supplierinfo', 'search_read',
            [[['partner_id', '=', r.vendor_odoo_id], ['product_tmpl_id', '=', tmplId]]],
            { fields: ['id', 'price', 'sequence'], limit: 1 });
          if (existingLink.length) {
            existed.push({ code: r.product_code, vendor: r.vendor_name, supplierinfo_id: existingLink[0].id });
            continue;
          }
          if (dry_run) {
            created.push({ code: r.product_code, vendor: r.vendor_name, dry_run: true });
            continue;
          }
          try {
            const vals = {
              partner_id: r.vendor_odoo_id,
              product_tmpl_id: tmplId,
              sequence: r.is_primary ? 1 : 10,
            };
            if (r.last_price != null && r.last_price > 0) vals.price = r.last_price;
            const newId = await odoo(apiKey, 'product.supplierinfo', 'create', [vals]);
            created.push({ code: r.product_code, vendor: r.vendor_name, supplierinfo_id: newId });
          } catch (e) {
            failed.push({ code: r.product_code, vendor: r.vendor_name, reason: e.message });
          }
        }
        report.steps.push({
          phase: 'supplierinfo',
          summary: `${created.length} ${dry_run?'would-create':'created'}, ${existed.length} already existed, ${failed.length} failed`,
          created_sample: created.slice(0, 10),
          existed_count: existed.length,
          failed,
        });
      }

      return json({ success: true, ...report });
    }

    // ─────────────────────────────────────────────────────────────────────
    // UPDATE ENTRY NOTES — edit notes / bill-ref on existing PO / Expense / Bill
    // - Expense: writes to `name` (the description field)
    // - PO / Bill: posts a message to Odoo chatter (mail.message) — the
    //   proper Odoo audit trail, always works regardless of schema changes
    // Bill ref is written to `account.move.ref` directly (standard field)
    // Never touches amount, vendor, product — by design.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'update-entry-notes' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, kind, odoo_id, notes, bill_ref } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr'];
      if (!LEDGER_ROLES.includes(user.role)) return json({ success: false, error: 'Access denied' }, 403);
      if (!odoo_id) return json({ success: false, error: 'odoo_id required' }, 400);
      const MODEL = { PO: 'purchase.order', Expense: 'hr.expense', Bill: 'account.move' };
      const resModel = MODEL[kind];
      if (!resModel) return json({ success: false, error: 'kind must be PO|Expense|Bill' }, 400);

      const id = parseInt(odoo_id, 10);
      const updates = [];

      try {
        if (kind === 'Expense') {
          // hr.expense: name IS the description line, writable directly
          if (typeof notes === 'string' && notes.trim()) {
            await odoo(apiKey, 'hr.expense', 'write', [[id], { name: notes.trim() }]);
            updates.push('notes');
          }
        } else {
          // PO / Bill: post to chatter via message_post so no schema assumptions
          if (typeof notes === 'string' && notes.trim()) {
            const body_html = `<p><b>Note by ${user.name} (PIN ${pin}):</b><br/>${notes.trim().replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`;
            await odoo(apiKey, resModel, 'message_post', [[id]], { body: body_html });
            updates.push('chatter-note');
          }
          // Bill ref is a standard field and always writable
          if (kind === 'Bill' && typeof bill_ref === 'string') {
            await odoo(apiKey, 'account.move', 'write', [[id], { ref: bill_ref.trim() }]);
            updates.push('bill_ref');
          }
        }
      } catch (e) {
        return json({ success: false, error: `Odoo rejected the update: ${e.message}` }, 400);
      }

      if (!updates.length) return json({ success: false, error: 'Nothing to update' }, 400);
      return json({ success: true, updated: updates });
    }

    // ── ARCHIVE PRODUCT (admin/cfo) — marks active=false in Odoo ──────────
    if (action === 'archive-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, product_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can archive products' }, 403);
      }
      if (!product_id) return json({ success: false, error: 'product_id required' }, 400);
      await odoo(apiKey, 'product.product', 'write', [[parseInt(product_id, 10)], { active: false }]);
      return json({ success: true, archived_product_id: product_id });
    }

    // ── UNARCHIVE PRODUCT (admin/cfo) — undo accidental delete ─────────────
    if (action === 'unarchive-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, product_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can unarchive products' }, 403);
      }
      if (!product_id) return json({ success: false, error: 'product_id required' }, 400);
      await odoo(apiKey, 'product.product', 'write', [[parseInt(product_id, 10)], { active: true }]);
      return json({ success: true, unarchived_product_id: product_id });
    }

    // ── RENAME PRODUCT (admin/cfo) — writes new name to Odoo product.product ──
    if (action === 'rename-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, product_id, name } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can rename products' }, 403);
      }
      if (!product_id || !name?.trim()) {
        return json({ success: false, error: 'product_id + name required' }, 400);
      }
      await odoo(apiKey, 'product.product', 'write',
        [[parseInt(product_id, 10)], { name: name.trim() }]);
      return json({ success: true, product_id: parseInt(product_id, 10), name: name.trim() });
    }

    // ── CREATE CATEGORY (admin/cfo) — creates Odoo product.category + D1 row ──
    // Parent under Odoo root "HN Hotels Expenses" so new cats inherit the expense taxonomy.
    // Returns the new D1 row with its synthesized id (>= 100) so the UI can open it immediately.
    if (action === 'create-category' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      if (!DB)     return json({ success: false, error: 'DB not configured' }, 500);
      const body = await request.json();
      const { pin, label, emoji, description, odoo_parent_name } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can add categories' }, 403);
      }
      if (!label?.trim()) return json({ success: false, error: 'label required' }, 400);

      // Resolve parent: default to "HN Hotels Expenses" root.
      // Constrain parent_id=false so we don't match a sub-category that happens to share the name.
      const rootName = (odoo_parent_name || 'HN Hotels Expenses').trim();
      const rootHits = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', '=', rootName], ['parent_id', '=', false]]],
        { fields: ['id', 'name'], limit: 1 });
      if (!rootHits.length) {
        return json({ success: false, error: `Odoo parent category "${rootName}" not found` }, 404);
      }
      const parentId = rootHits[0].id;

      // Create the Odoo product.category — label is what Naveen typed.
      const odooCategName = label.trim();

      // Guard against duplicate: same parent + same name
      const dupe = await odoo(apiKey, 'product.category', 'search_read',
        [[['name', '=', odooCategName], ['parent_id', '=', parentId]]],
        { fields: ['id'], limit: 1 });
      let odooCategId;
      if (dupe.length) {
        odooCategId = dupe[0].id;  // reuse existing — user probably retrying
      } else {
        odooCategId = await odoo(apiKey, 'product.category', 'create', [{
          name: odooCategName,
          parent_id: parentId,
        }]);
      }

      const res = await DB.prepare(
        `INSERT INTO expense_categories_ext
           (label, emoji, description, backend, odoo_category_id, odoo_category_name, created_by_pin)
         VALUES (?, ?, ?, 'hr.expense', ?, ?, ?)
         RETURNING id`
      ).bind(
        label.trim(),
        emoji?.trim() || '📌',
        description?.trim() || '',
        odooCategId,
        odooCategName,
        String(pin),
      ).first();

      return json({
        success: true,
        category: {
          id: res.id,
          label: label.trim(),
          emoji: emoji?.trim() || '📌',
          desc: description?.trim() || '',
          backend: 'hr.expense',
          parentName: odooCategName,
          odoo_category_id: odooCategId,
          custom: true,
        },
      });
    }

    // ── ARCHIVE CATEGORY (admin/cfo, custom cats only) ────────────────────
    // Built-in cats 1-15 are hard-locked. Custom cats can be archived;
    // products inside remain in Odoo under the Odoo category (not auto-archived).
    if (action === 'archive-category' && request.method === 'POST') {
      if (!DB) return json({ success: false, error: 'DB not configured' }, 500);
      const body = await request.json();
      const { pin, category_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Only Nihaf/Naveen can archive categories' }, 403);
      }
      const id = parseInt(category_id, 10);
      if (!id || id < 100) {
        return json({ success: false, error: 'Only custom categories (id >= 100) can be archived' }, 400);
      }
      await DB.prepare(
        `UPDATE expense_categories_ext SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
      ).bind(id).run();
      return json({ success: true, archived_category_id: id });
    }

    // ── ADMIN OVERVIEW — full tree for Naveen's admin UI ─────────────────
    // Returns every category (built-in + custom) with its products. Includes archived
    // products so Naveen can unarchive if he regrets a delete.
    if (action === 'admin-overview') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) {
        return json({ success: false, error: 'Admin only' }, 403);
      }
      const includeArchived = url.searchParams.get('include_archived') === '1';

      const overrides = await loadCategoryOverrides(DB);
      const baseCats = mergeCategoryOverrides(overrides).filter(c => c.backend === 'hr.expense');
      const custom = await loadCustomCategories(DB);
      const allCats = [...baseCats, ...custom];

      const rows = await Promise.all(allCats.map(async (cat) => {
        let categIds = [];
        try {
          if (cat.custom && cat.odoo_category_id) {
            categIds = [cat.odoo_category_id];
          } else if (cat.parentName) {
            // Mirror the products endpoint: ilike on parentName, plus for cat 1
            // also include the bare "Raw Materials" taxonomy where HN-RM-* registry lives.
            const ph = await odoo(apiKey, 'product.category', 'search_read',
              [[['name', 'ilike', cat.parentName]]], { fields: ['id'], limit: 5 });
            categIds = ph.map(r => r.id);
            if (cat.id === 1) {
              const rmExtra = await odoo(apiKey, 'product.category', 'search_read',
                [[['name', '=', 'Raw Materials']]], { fields: ['id'], limit: 5 });
              for (const r of rmExtra) if (!categIds.includes(r.id)) categIds.push(r.id);
            }
          }
          if (!categIds.length) {
            return { ...cat, products: [], resolved: false };
          }
          const domain = [['categ_id', 'in', categIds], ['can_be_expensed', '=', true]];
          if (!includeArchived) domain.push(['active', '=', true]);
          const prods = await odoo(apiKey, 'product.product', 'search_read',
            [domain],
            { fields: ['id', 'name', 'default_code', 'active', 'uom_id'],
              order: 'name asc', limit: 500, context: { active_test: false } });
          return {
            id: cat.id, label: cat.label, emoji: cat.emoji, desc: cat.desc,
            backend: cat.backend, parentName: cat.parentName,
            odoo_category_id: cat.odoo_category_id || categIds[0],
            custom: !!cat.custom,
            products: prods,
            resolved: true,
          };
        } catch (e) {
          return { id: cat.id, label: cat.label, emoji: cat.emoji,
                   custom: !!cat.custom, products: [], resolved: false, error: e.message };
        }
      }));

      return json({ success: true, categories: rows });
    }

    // ── SYNC EMPLOYEES — reconcile D1 hr_employees mirror against Odoo ────
    // Root-cause fix for "hr.employee(N) does not exist" errors in /ops/expense/:
    // D1 mirror drifted from Odoo (archive/delete in Odoo not reflected in D1).
    // This pulls every hr.employee from Odoo (including archived) and:
    //   • Marks D1 rows whose Odoo record is GONE → is_active=0
    //   • Syncs D1 is_active with Odoo active flag (archived in Odoo → inactive in D1)
    //   • Syncs company_id if it changed in Odoo
    //   • Reports Odoo employees that have no D1 row (need manual onboarding w/ PIN)
    // GET supported so Nihaf/Naveen can run it from a browser. Admin/CFO only.
    if (action === 'sync-employees') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin') ||
                  (request.method === 'POST' ? (await request.json().catch(() => ({}))).pin : null);
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) return json({ success: false, error: 'Admin only (admin or CFO)' }, 403);
      if (!DB) return json({ success: false, error: 'D1 not configured' }, 500);

      // Pull every hr.employee from Odoo (active + archived), across all companies.
      const odooEmps = await odoo(apiKey, 'hr.employee', 'search_read',
        [[]],
        { fields: ['id', 'name', 'active', 'company_id', 'pin'],
          limit: 1000, context: { active_test: false } });

      const d1Rows = await DB.prepare(
        'SELECT id, name, pin, brand_label, company_id, odoo_employee_id, is_active FROM hr_employees'
      ).all().catch(() => ({ results: [] }));

      const stats = {
        total_odoo: odooEmps.length,
        total_d1: d1Rows.results.length,
        deactivated_missing: [],   // Odoo record gone
        deactivated_archived: [],  // Odoo still has it but archived
        reactivated: [],           // Odoo active but D1 marked inactive
        company_changed: [],       // company_id moved
        orphan_in_odoo: [],        // Odoo employee with no D1 mirror row
      };

      const d1ByOdooId = new Map();
      for (const r of d1Rows.results) {
        if (r.odoo_employee_id) d1ByOdooId.set(r.odoo_employee_id, r);
      }

      for (const r of d1Rows.results) {
        if (!r.odoo_employee_id) continue;
        const o = odooEmps.find(e => e.id === r.odoo_employee_id);
        if (!o) {
          if (r.is_active) {
            await DB.prepare("UPDATE hr_employees SET is_active=0, updated_at=datetime('now') WHERE id=?")
              .bind(r.id).run().catch(() => {});
            stats.deactivated_missing.push({ d1_id: r.id, name: r.name, odoo_id: r.odoo_employee_id });
          }
          continue;
        }
        const shouldBeActive = o.active ? 1 : 0;
        const odooCompanyId = Array.isArray(o.company_id) ? o.company_id[0] : o.company_id;
        const updates = [];
        const params = [];
        if (r.is_active !== shouldBeActive) {
          updates.push('is_active=?');
          params.push(shouldBeActive);
          if (shouldBeActive) {
            stats.reactivated.push({ d1_id: r.id, name: r.name, odoo_id: r.odoo_employee_id });
          } else {
            stats.deactivated_archived.push({ d1_id: r.id, name: r.name, odoo_id: r.odoo_employee_id });
          }
        }
        if (String(r.company_id) !== String(odooCompanyId)) {
          updates.push('company_id=?');
          params.push(odooCompanyId);
          stats.company_changed.push({ d1_id: r.id, name: r.name, from: r.company_id, to: odooCompanyId });
        }
        if (updates.length) {
          updates.push("updated_at=datetime('now')");
          params.push(r.id);
          await DB.prepare(`UPDATE hr_employees SET ${updates.join(',')} WHERE id=?`)
            .bind(...params).run().catch(() => {});
        }
      }

      for (const o of odooEmps) {
        if (!o.active) continue;  // only flag ACTIVE orphans — archived orphans don't matter
        if (!d1ByOdooId.has(o.id)) {
          stats.orphan_in_odoo.push({
            odoo_id: o.id,
            name: o.name,
            company_id: Array.isArray(o.company_id) ? o.company_id[0] : o.company_id,
          });
        }
      }

      return json({ success: true, stats });
    }

    // ── PAYROLL LEDGER — per-employee salary accrued / paid / advance / balance ──
    // Admin/CFO only. Pulls from D1 mirror (cats 3 + 4) indexed on x_payroll_period +
    // x_employee_odoo_id. Computes settlement position for each active employee.
    //
    // Model:
    //   accrued(month)      = monthly_salary (from hr_employees.monthly_salary)
    //   paid(month)         = SUM(cat 3 where x_payroll_period=month)
    //   advance_out(month)  = SUM(cat 4 where x_payroll_period=month, not yet deducted)
    //   balance(month)      = accrued - paid - advance_out
    //   → Positive balance = employee is owed. Negative = overpaid.
    //
    // Filters: ?month=YYYY-MM (defaults to current)  ?employee_id=N (optional drill-down)
    if (action === 'payroll-ledger') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!isAdminRole(user)) return json({ success: false, error: 'Admin only (admin or CFO)' }, 403);
      if (!DB) return json({ success: false, error: 'D1 not configured' }, 500);

      const today = new Date();
      const defaultMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
      const month = url.searchParams.get('month') || defaultMonth;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return json({ success: false, error: 'month must be YYYY-MM' }, 400);
      }
      const empFilter = url.searchParams.get('employee_id');

      const emps = await DB.prepare(
        `SELECT id, name, brand_label, company_id, monthly_salary, odoo_employee_id
           FROM hr_employees
          WHERE is_active = 1 AND odoo_employee_id IS NOT NULL
          ${empFilter ? 'AND odoo_employee_id = ?' : ''}
          ORDER BY brand_label, name`
      ).bind(...(empFilter ? [parseInt(empFilter, 10)] : [])).all().catch(() => ({ results: [] }));

      // Pull all payroll-tagged entries for this month in one query.
      const entries = await DB.prepare(
        `SELECT x_employee_odoo_id, x_payroll_period, x_payroll_intent, category, amount, recorded_at, description
           FROM business_expenses
          WHERE x_payroll_period = ?
            AND x_employee_odoo_id IS NOT NULL
          ORDER BY recorded_at DESC`
      ).bind(month).all().catch(() => ({ results: [] }));

      // Pull ALL salary-advance entries regardless of period — needed to compute
      // outstanding advance balance (advance taken in month M counts until a salary
      // clearing for M lands). Simple model: advance_out = sum of cat 4 where
      // x_payroll_period <= month AND no corresponding Salary Payment cleared month yet.
      // v1: just show this month's advances — good enough for Naveen's monthly view.

      const rows = emps.results.map(e => {
        const empEntries = entries.results.filter(r => r.x_employee_odoo_id === e.odoo_employee_id);
        const paid = empEntries
          .filter(r => r.category === 'Salary Payment')
          .reduce((s, r) => s + parseFloat(r.amount || 0), 0);
        const advance = empEntries
          .filter(r => r.category === 'Salary Advance')
          .reduce((s, r) => s + parseFloat(r.amount || 0), 0);
        const accrued = parseFloat(e.monthly_salary || 0);
        return {
          employee_id: e.id,
          odoo_employee_id: e.odoo_employee_id,
          name: e.name,
          brand: e.brand_label,
          monthly_salary: accrued,
          accrued,
          paid,
          advance,
          balance: accrued - paid - advance,
          entries: empEntries.map(r => ({
            amount: parseFloat(r.amount || 0),
            type: r.category,
            intent: r.x_payroll_intent,
            at: r.recorded_at,
            note: r.description,
          })),
        };
      });

      // Totals
      const totals = rows.reduce((t, r) => ({
        accrued: t.accrued + r.accrued,
        paid: t.paid + r.paid,
        advance: t.advance + r.advance,
        balance: t.balance + r.balance,
      }), { accrued: 0, paid: 0, advance: 0, balance: 0 });

      return json({ success: true, month, rows, totals });
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
      const effectiveDate = bill_date || new Date().toISOString().slice(0, 10);
      // Rename for consistency
      if (body.attachment) {
        body.attachment = {
          ...body.attachment,
          name: buildBillFilename({
            date: effectiveDate, category: 'Bill-from-PO', brand,
            product: bill_ref || po[0].name,
            amount, recorded_by: user.name,
          }),
        };
      }
      const attIdPo = await saveAttachment(apiKey, body.attachment, 'account.move', moveId);
      const drivePo = await syncToDrive(env, body.attachment ? {
        date: effectiveDate,
        company: brand,
        category: 'Bill from PO',
        product: `Bill ${bill_ref || po[0].name}`,
        amount: parseFloat(amount),
        recorded_by: user.name,
        filename: body.attachment.name,
        mimetype: body.attachment.mimetype,
        data_b64: body.attachment.data_b64,
      } : null);
      if (body.attachment) {
        await logBillAttachment(DB, {
          kind: 'Bill', odoo_id: moveId, brand,
          entry_date: effectiveDate, entry_amount: parseFloat(amount),
          odoo_attachment_id: attIdPo,
          drive_file_id: drivePo?.file_id, drive_view_url: drivePo?.view_url, drive_path: drivePo?.path,
          filename: body.attachment.name, mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64, pin, user_name: user.name,
        });
      }
      return json({ success: true, odoo_id: moveId, po_name: po[0].name, backend: 'account.move',
        attachment_id: attIdPo, drive_file_id: driveFileId(drivePo), drive_view_url: drivePo?.view_url || null });
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
