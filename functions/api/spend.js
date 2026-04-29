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

// ━━━ Fuzzy duplicate detection (Apr 2026 fix-A) ━━━
// Catches "Bun"/"Buns", "Samoosa"/"Samosa", "Lemon"/"Lemon (Nimbu)",
// "Pudina"/"Fresh Mint (Pudina)" before they pollute Odoo product list.
// Mirror sets from vendor.js so spend.js can validate before the mirror call.
const VALID_PRIMARY_BRANDS = new Set(['HE', 'NCH', 'BOTH']);
const VALID_PAYMENT_TERMS  = new Set(['on_delivery', '7d', '15d', '30d', '45d', 'other']);
const ALLOWED_HYGIENE_ROLES = new Set(['admin', 'cfo', 'gm', 'asstmgr']);

function _normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[\(\)\[\]\{\}.,;:!?'"`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Strip bracketed content: "Lemon (Nimbu)" → "lemon", "Mutton (Cut)" → "mutton"
function _stripParens(s) {
  return String(s || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ')
    .replace(/[.,;:!?'"`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function _levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}
// Common cooking-modifier tokens that are NOT useful for dedup signal —
// "Black Cardamom" vs "Green Cardamom" share 'cardamom' but are distinct items.
const _STOPLIST_TOKENS = new Set([
  'powder','leaves','seeds','masala','flour','salt','oil','ghee','sauce','spice',
  'spices','dry','dried','fresh','paste','raw','whole','ground','chilli','chili',
  'chilly','sugar','milk','water','curd','cream','butter','cheese','garlic','ginger',
  'mint','green','black','red','white','yellow','brown','jeera','cumin','coriander',
  'cardamom','clove','cloves','pepper','peppers','seed','leaf','rice','dal',
  'flour','cashew','almond','coconut','curry','meat','chicken','mutton','fish',
  'sambar','rasam','tea','coffee','flour','grain','grains','desi','asli',
  'whole','half','quarter','pieces','piece','pkt','packet','litre','liter','kg',
  'gram','units','unit',
]);
function _tokens(s) {
  return _normName(s).split(' ')
    .filter(t => t.length >= 5)            // raise floor: 4→5
    .filter(t => !_STOPLIST_TOKENS.has(t)); // drop noise tokens
}
// Returns the closest existing product object that's a likely duplicate, or null.
// Match reasons: 'exact', 'levenshtein', 'parens_strip', 'substring'.
// Removed shared_token — over-fires for items sharing common nouns
// (Black/Green Cardamom, Curry/Bay Leaves, Beat/Weekly Police are NOT dups).
function findFuzzyDup(newName, existing) {
  const nN = _normName(newName);
  const nP = _stripParens(newName);
  if (nN.length < 2) return null;
  let best = null;
  for (const p of existing) {
    if (!p?.name) continue;
    const eN = _normName(p.name);
    const eP = _stripParens(p.name);
    if (!eN) continue;
    if (eN === nN) return { ...p, match_reason: 'exact' };
    // 'Lemon' vs 'Lemon (Nimbu)' → after parens-strip both = 'lemon' → MATCH.
    // BUT skip if either bracketed content is a brand/scope marker (HE/NCH/HQ/Both)
    // — those are intentional per-brand items, not duplicates.
    const hasBrandParens = (s) => /\((HE|NCH|HQ|BOTH|both|he|nch|hq)\)/i.test(s) || /\((HE|NCH|HQ)[^)]*\)/i.test(s);
    if (nP && eP && nP === eP && nN !== eN && !hasBrandParens(newName) && !hasBrandParens(p.name)) {
      return { ...p, match_reason: 'parens_strip' };
    }
    // Levenshtein — only count INSERTIONS/DELETIONS (single-char additions),
    // not SUBSTITUTIONS (which usually mean different items: Card vs Cash, ASI vs SI).
    // A pure insert/delete leaves abs(len_diff) === edit_dist; a substitution makes them differ.
    const dist = _levenshtein(nN, eN);
    if (dist === 1 && Math.abs(nN.length - eN.length) === 1) {
      if (!best || dist < best._dist) {
        best = { ...p, _dist: dist, match_reason: 'levenshtein_insert_delete' };
      }
      continue;
    }
    if (dist === 2 && Math.abs(nN.length - eN.length) === 2) {
      if (!best || dist < best._dist) {
        best = { ...p, _dist: dist, match_reason: 'levenshtein_insert_delete' };
      }
      continue;
    }
    // Substring: require shorter side ≥ 6 chars AND make up ≥70% of longer side.
    // Bumped 60→70% — stops 'Bun' matching 'Bun Maska', etc.
    const shorter = nN.length <= eN.length ? nN : eN;
    const longer  = shorter === nN ? eN : nN;
    if (shorter.length >= 6 && longer.includes(shorter) && (shorter.length / longer.length) >= 0.7) {
      if (!best || best.match_reason !== 'levenshtein') {
        best = { ...p, match_reason: 'substring' };
      }
    }
  }
  if (best) { delete best._dist; }
  return best;
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
  // Investor view-only access — no cats means all reads work, no writes (no role in write allowlists)
  '4040': { name: 'Haneef',   brands: ['HE','NCH','HQ'], cats: 'all', role: 'viewer' },
  '5050': { name: 'Nisar',    brands: ['HE','NCH','HQ'], cats: 'all', role: 'viewer' },
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
        { fields: ['id', 'name', 'default_code', 'standard_price', 'create_date', 'uom_id'], order: 'name asc', limit: 500 });

      // Flatten uom_id [id, name] → uom_name string for the client
      const withUom = all.map(p => ({
        ...p,
        uom_name: Array.isArray(p.uom_id) ? p.uom_id[1] : (p.uom_id || null),
      }));

      // Brand filter: if &brand=NCH|HE|HQ — keep only products that have been bought
      // for that company (via purchase.order.line) OR are recently created (<7 days).
      // Absent brand param → return all (back-compat for /ops/expense/ central view).
      const brandParam = (url.searchParams.get('brand') || '').toUpperCase();
      const wantCompanyId = BRAND_COMPANY[brandParam];
      if (wantCompanyId && withUom.length) {
        try {
          const allIds = withUom.map(p => p.id);
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

          const filtered = withUom.filter(p =>
            brandProductIds.has(p.id) ||
            (p.create_date && p.create_date >= sevenDaysAgo)
          );

          // If filter collapsed to nothing sensible (<3 items), fall back to full set with a flag
          if (filtered.length < 3) {
            return json({ success: true, products: withUom, brand_filtered: false,
                          reason: 'Not enough brand history — showing full registry' });
          }
          return json({ success: true, products: filtered, brand_filtered: true, brand: brandParam });
        } catch (e) { console.error('brand filter fail:', e.message); }
      }
      return json({ success: true, products: withUom, brand_filtered: false });
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
    // Hard rules (Apr 2026 fix-A "expense data quality"):
    //   1) uom_id REQUIRED — without it, kg/L/Units distinction is permanently lost.
    //   2) Fuzzy-dup check vs existing products in same Odoo category.
    //      Returns 409 with existing match if Levenshtein ≤ 2 / substring / shared
    //      ≥4-char token. Caller can pass {force:true} to override (e.g. "Bun" vs
    //      "Burger Bun" if they really are different items).
    if (action === 'create-expense-product' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, cat_id, name, uom_id, force } = body;
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

      // ── HARD RULE 0 (Apr 2026 fix-C): Cat 1 raw materials must come from
      //   Zoya's central registry (/ops/purchase). New HN-RM-* codes assigned
      //   centrally guarantee BOM mapping + supplier traceability + UOM consistency.
      //   Counter cashiers cannot inline-create RMs anymore. ───────
      if (catIdInt === 1) {
        return json({
          success: false,
          error: 'cat1_inline_blocked',
          message: 'Raw materials must be added by Zoya in /ops/purchase (so each gets an HN-RM-* code + canonical UOM + supplier link). Tell her the item name and supplier; once she creates it the dropdown will refresh.',
          deep_link: 'https://hnhotels.in/ops/purchase/',
        }, 400);
      }

      // ── HARD RULE 1: UOM required ────────────────────────
      const uomIdInt = parseInt(uom_id, 10);
      if (!uomIdInt || uomIdInt <= 0) {
        return json({
          success: false,
          error: 'uom_required',
          message: 'Unit of measure is required. Pick kg / L / Units / packets etc. so the product is consistent across kitchens.',
        }, 400);
      }

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

      // ── HARD RULE 2: fuzzy-dup check (skipped if force=true) ─
      if (!force) {
        const existingInCat = await odoo(apiKey, 'product.product', 'search_read',
          [[['categ_id', '=', categId], ['active', '=', true]]],
          { fields: ['id', 'name', 'default_code', 'uom_id'], limit: 500 });
        const candidate = findFuzzyDup(name.trim(), existingInCat);
        if (candidate) {
          return json({
            success: false,
            error: 'fuzzy_duplicate',
            message: `Looks like "${candidate.name}" already exists in this category. Pick the existing one, or pass force=true to create a new product anyway.`,
            existing: {
              id: candidate.id,
              name: candidate.name,
              default_code: candidate.default_code || null,
              uom_id: Array.isArray(candidate.uom_id) ? candidate.uom_id[0] : candidate.uom_id,
              uom_name: Array.isArray(candidate.uom_id) ? candidate.uom_id[1] : null,
              match_reason: candidate.match_reason,
            },
          }, 409);
        }
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
        uom_id: uomIdInt,
      }]);

      return json({ success: true, product: { id: prodId, name: name.trim() } });
    }

    // ── CREATE VENDOR (inline-add for cats 1, 14, 15) ──────
    // Hard rules (Apr 2026 fix-B "vendor data quality"):
    //   1) phone REQUIRED — without it the vendor-watcher agent can't match
    //      incoming WhatsApp/SMS, and dedup fails.
    //   2) Phone-uniqueness check vs existing res.partner — if same digits already
    //      exist, return 409 with existing match. Caller can pass {force:true} to
    //      override (e.g. two distinct shops sharing a household phone).
    //   3) Auto-mirror to /api/vendor (D1 vendor master) so the new vendor gets
    //      brand + payment_terms + delivery_slot + GSTIN/PAN slots, not just
    //      name+phone in Odoo. Mirror failure does NOT block parent create.
    if (action === 'create-vendor' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, name, phone, email, address, gst, primary_brand, payment_terms, force } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!name?.trim()) return json({ success: false, error: 'Name required' }, 400);

      // ── HARD RULE 1: phone required ──────────────────────
      const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
      const phoneDigits = cleanPhone.replace(/[^\d]/g, '');
      if (phoneDigits.length < 10) {
        return json({
          success: false,
          error: 'phone_required',
          message: 'Vendor phone is required (min 10 digits). The vendor-watcher agent matches incoming WhatsApp/SMS by phone — without it dedup fails.',
        }, 400);
      }

      // ── HARD RULE 2: phone-uniqueness check ─────────────
      if (!force) {
        // Search by last 10 digits to catch +91 vs no-prefix variations
        const last10 = phoneDigits.slice(-10);
        const existing = await odoo(apiKey, 'res.partner', 'search_read',
          [[['supplier_rank', '>', 0], ['phone', 'ilike', last10]]],
          { fields: ['id', 'name', 'phone'], limit: 5 });
        if (existing.length) {
          const e = existing[0];
          return json({
            success: false,
            error: 'phone_duplicate',
            message: `Phone ${last10} already linked to "${e.name}". Pick that vendor, or pass force=true to create a new one anyway (rare — usually a household phone shared by two distinct shops).`,
            existing: { id: e.id, name: e.name, phone: e.phone || null },
          }, 409);
        }
      }

      const partnerVals = {
        name: name.trim(),
        supplier_rank: 1,
        is_company: true,
        phone: cleanPhone,
      };
      if (email?.trim())   partnerVals.email   = email.trim();
      if (address?.trim()) partnerVals.street  = address.trim();
      if (gst?.trim())     partnerVals.vat     = gst.trim().toUpperCase();

      const vendorId = await odoo(apiKey, 'res.partner', 'create', [partnerVals]);

      // ── RULE 3: mirror to /api/vendor (best-effort, non-blocking) ─
      let mirror_status = 'skipped';
      try {
        const mirrorBody = {
          vendor_key: name.trim().toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60),
          name: name.trim(),
          phone: cleanPhone,
          owner_contact: null,
          address: address?.trim() || null,
          gstin: gst?.trim() || null,
          primary_brand: VALID_PRIMARY_BRANDS.has(primary_brand) ? primary_brand : null,
          payment_terms: VALID_PAYMENT_TERMS.has(payment_terms) ? payment_terms : null,
          notes: `Created via /api/spend create-vendor by ${user.name} (${user.role})`,
        };
        const m = await fetch(`${new URL(request.url).origin}/api/vendor?action=create&pin=${encodeURIComponent(pin)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mirrorBody),
        });
        const mj = await m.json().catch(() => ({}));
        if (mj.ok) {
          // Link the just-created Odoo res.partner ID into the D1 row
          mirror_status = 'mirrored';
          if (DB && mj.id) {
            try {
              await DB.prepare(`UPDATE vendors SET odoo_partner_id = ? WHERE id = ?`)
                .bind(vendorId, mj.id).run();
            } catch (_) { /* non-blocking */ }
          }
        } else if (mj.error === 'vendor_key_exists') {
          mirror_status = 'already_in_d1';
        } else {
          mirror_status = 'mirror_failed:' + (mj.error || 'unknown');
        }
      } catch (e) {
        mirror_status = 'mirror_exception:' + String(e.message || e).slice(0, 60);
      }

      return json({
        success: true,
        vendor: { id: vendorId, name: name.trim(), phone: cleanPhone },
        mirror_status,
      });
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

      // History support — `days` (default 1) or `from`/`to` (YYYY-MM-DD).
      // Surfaces what's already been entered so Naveen doesn't re-key items
      // he thinks didn't save (same root-cause as the Apr 22 outlet dups).
      // Optional `brand` (HE/NCH/HQ) filter — defaults to user's allowed brands.
      const daysParam = parseInt(url.searchParams.get('days') || '1', 10);
      const days = Math.min(Math.max(isNaN(daysParam) ? 1 : daysParam, 1), 30);
      const fromParam = url.searchParams.get('from');
      const toParam   = url.searchParams.get('to');
      const brandParam = (url.searchParams.get('brand') || 'ALL').toUpperCase();

      // business_expenses.recorded_at is stored as `datetime('now')` in SQLite
      // — UTC string like '2026-04-24 08:23:35'. Compare against IST date
      // boundaries converted to UTC for correct timezone behaviour.
      const ymdToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const istDayStartUTC = (ymd) => {
        const d = new Date(Date.parse(`${ymd}T00:00:00.000Z`) - 5.5 * 3600 * 1000);
        return d.toISOString().replace('T', ' ').slice(0, 19);  // SQLite-compatible
      };
      let startUTC, endUTC;
      if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
        startUTC = istDayStartUTC(fromParam);
        const toPlus1 = new Date(Date.parse(`${toParam}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
        endUTC = istDayStartUTC(toPlus1);
      } else {
        const fromIST = new Date(Date.parse(`${ymdToday}T00:00:00.000Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
        startUTC = istDayStartUTC(fromIST);
        const toPlus1 = new Date(Date.parse(`${ymdToday}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
        endUTC = istDayStartUTC(toPlus1);
      }

      let sql = `SELECT be.id, be.odoo_id, be.category, be.category_parent, be.amount,
                        be.product_name, be.product_id, be.company_id,
                        be.x_payment_method as payment_method, be.x_location, be.x_pool,
                        be.recorded_by as recorded_by_pin, be.recorded_at as created_at, be.notes,
                        be.quantity, be.uom, be.vendor_id, be.vendor_name,
                        COALESCE(be.uom, rmp.uom) as uom_display
                   FROM business_expenses be
                   LEFT JOIN rm_products rmp
                          ON rmp.odoo_id = be.product_id AND rmp.odoo_id IS NOT NULL
                  WHERE be.recorded_at >= ? AND be.recorded_at < ?`;
      const args = [startUTC, endUTC];
      if (brandParam !== 'ALL' && ['HE', 'NCH', 'HQ'].includes(brandParam)) {
        sql += ` AND be.x_location = ?`;
        args.push(brandParam);
      }
      sql += ` ORDER BY be.recorded_at DESC LIMIT 500`;

      const rows = await DB.prepare(sql).bind(...args).all().catch((e) => ({ results: [], _err: e.message }));
      // Tag each row with IST date for client-side grouping
      const items = (rows.results || []).map((r) => {
        const t = Date.parse((r.created_at || '').replace(' ', 'T') + 'Z');
        const istDate = isNaN(t) ? null : new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        return { ...r, ist_date: istDate };
      });
      const total = items.reduce((s, r) => s + (r.amount || 0), 0);
      return json({ success: true, entries: items, total, days, brand: brandParam, from: fromParam, to: toParam });
    }

    // ── EXPENSE EXPORT (audit PDF source) ──────────────────
    // Returns full granular rows for a date range — IST-tagged, RM-flagged.
    // is_rm: 1 if product links to rm_products OR category_parent starts with '01 ·'
    // qty_missing: 1 only for is_rm rows where quantity IS NULL (these need hand-entry)
    // vendor_missing: 1 for is_rm rows where vendor_name IS NULL
    if (action === 'expense-export') {
      if (!DB) return json({ success: false, error: 'DB not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user || !['admin', 'cfo'].includes(user.role)) return json({ success: false, error: 'Admin or CFO PIN required' }, 401);

      const fromParam = url.searchParams.get('from') || '2026-04-01';
      const toParam   = url.searchParams.get('to')   || '2026-04-30';
      const brandParam = (url.searchParams.get('brand') || 'ALL').toUpperCase();

      const istDayStartUTC = (ymd) => {
        const d = new Date(Date.parse(`${ymd}T00:00:00.000Z`) - 5.5 * 3600 * 1000);
        return d.toISOString().replace('T', ' ').slice(0, 19);
      };
      const startUTC = istDayStartUTC(fromParam);
      const toPlus1  = new Date(Date.parse(`${toParam}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
      const endUTC   = istDayStartUTC(toPlus1);

      let sql = `
        SELECT be.id, be.odoo_id,
               be.category, be.category_parent,
               be.amount, be.product_name, be.product_id, be.company_id,
               be.x_payment_method AS payment_method, be.x_location, be.x_pool,
               be.recorded_by AS recorded_by_pin, be.recorded_at AS created_at, be.notes,
               be.quantity, be.uom, be.vendor_id, be.vendor_name,
               COALESCE(be.uom, rmp.uom) AS uom_display,
               CASE WHEN rmp.uom IS NOT NULL
                      OR LOWER(COALESCE(be.category_parent,'')) LIKE '01%'
                      OR LOWER(COALESCE(be.category_parent,'')) LIKE '%raw material%'
                    THEN 1 ELSE 0 END AS is_rm,
               CASE WHEN (rmp.uom IS NOT NULL
                            OR LOWER(COALESCE(be.category_parent,'')) LIKE '01%'
                            OR LOWER(COALESCE(be.category_parent,'')) LIKE '%raw material%')
                         AND be.quantity IS NULL
                    THEN 1 ELSE 0 END AS qty_missing,
               CASE WHEN (rmp.uom IS NOT NULL
                            OR LOWER(COALESCE(be.category_parent,'')) LIKE '01%'
                            OR LOWER(COALESCE(be.category_parent,'')) LIKE '%raw material%')
                         AND (be.vendor_name IS NULL OR be.vendor_name = '')
                    THEN 1 ELSE 0 END AS vendor_missing
          FROM business_expenses be
          LEFT JOIN rm_products rmp
                 ON rmp.odoo_id = be.product_id AND rmp.odoo_id IS NOT NULL
         WHERE be.recorded_at >= ? AND be.recorded_at < ?`;
      const args = [startUTC, endUTC];
      if (brandParam !== 'ALL' && ['HE', 'NCH', 'HQ'].includes(brandParam)) {
        sql += ` AND be.x_location = ?`;
        args.push(brandParam);
      }
      sql += ` ORDER BY be.recorded_at ASC LIMIT 2000`;

      const rows = await DB.prepare(sql).bind(...args).all().catch(e => ({ results: [], error: e.message }));
      const items = (rows.results || []).map(r => {
        const t = Date.parse((r.created_at || '').replace(' ', 'T') + 'Z');
        const ist_date = isNaN(t) ? null : new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        return { ...r, ist_date };
      });

      const total         = items.reduce((s, r) => s + (r.amount || 0), 0);
      const rm_rows       = items.filter(r => r.is_rm);
      const qty_missing   = items.filter(r => r.qty_missing).length;
      const vendor_missing = items.filter(r => r.vendor_missing).length;

      return json({ success: true, entries: items, total,
        summary: { total_rows: items.length, rm_rows: rm_rows.length, qty_missing, vendor_missing },
        from: fromParam, to: toParam, brand: brandParam });
    }

    // ── RECORD EXPENSE (cats 3-13) → hr.expense ────────────
    if (action === 'record' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      // Backward-compat shim — accept both `category` (HN UIs, NCH outlet) and
      // `category_id` (HE outlet). Without this, HE outlet expenses were 100%
      // failing with "Unknown category" since launch (silent orphaning).
      const catId = body.category ?? body.category_id;
      // Backward-compat shim — accept HE-style raw `photo_b64` (data-URI string)
      // and normalize into the {name, mimetype, data_b64} attachment shape that
      // saveAttachment + syncToDrive expect. Without this, every HE outlet bill
      // photo was silently dropped.
      if (!body.attachment && body.photo_b64) {
        const raw = String(body.photo_b64);
        const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
        const mimeMatch = raw.match(/^data:([^;]+);/);
        body.attachment = {
          name: `${body.brand || 'spend'}-${new Date().toISOString().slice(0,10)}-bill.jpg`,
          mimetype: mimeMatch?.[1] || 'image/jpeg',
          data_b64: b64,
        };
      }
      const { pin, brand, product_id, amount, payment_method,
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
        // Apr 2026 fix-D: also persist vendor_id, vendor_name, quantity, uom when
        // the client sent them. All optional — backward compatible with old callers.
        if (DB) {
          const payMode = payment_method === 'cash' ? 'cash' : 'bank';
          const qty   = body.quantity != null && !Number.isNaN(parseFloat(body.quantity)) ? parseFloat(body.quantity) : null;
          const uomT  = body.uom?.trim?.() || null;
          const vId   = body.vendor_id ? parseInt(body.vendor_id, 10) : null;
          const vName = body.vendor_name?.trim?.() || null;
          await DB.prepare(
            `INSERT INTO business_expenses
               (recorded_by, recorded_at, amount, description, category, payment_mode, notes,
                odoo_id, company_id, product_id, product_name, category_parent,
                x_pool, x_payment_method, x_location, x_excluded_from_pnl, odoo_synced_at,
                x_payroll_period, x_payroll_intent, x_employee_odoo_id,
                vendor_id, vendor_name, quantity, uom)
             VALUES (?, datetime('now'), ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, datetime('now'),
                     ?, ?, ?,
                     ?, ?, ?, ?)`
          ).bind(
            user.name, parseFloat(amount), prodName, cat.label, payMode, notes || '',
            expenseId, companyId, parseInt(product_id, 10), prodName, cat.parentName || null,
            expenseVals.x_pool, expenseVals.x_payment_method, brand, cat.id === 13 ? 1 : 0,
            payrollPeriod, payrollIntent, (cat.id === 3 || cat.id === 4) ? empId : null,
            vId, vName, qty, uomT
          ).run().catch(e => console.error('mirror fail:', e.message));
        }

        return json({ success: true,
          odoo_id: expenseId, expense_id: expenseId,  // expense_id alias for HE outlet caller
          backend: 'hr.expense', category: cat.label,
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
      // 'cashier' added so outlet "Pay open PO" tile can list POs for that brand
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr', 'cashier'];
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

      // Phase 4 — load PO lifecycle (received_at, received_by) from D1 once
      // and merge into PO rows below. Pure read; no behaviour change for
      // non-PO rows.
      const lifecycleMap = {};
      if (DB && pos.length) {
        try {
          const poIdsForLifecycle = pos.map(p => p.id);
          const lcRes = await DB.prepare(
            `SELECT odoo_po_id, received_at, received_by_name
               FROM po_lifecycle
              WHERE odoo_po_id IN (${poIdsForLifecycle.map(() => '?').join(',')})`
          ).bind(...poIdsForLifecycle).all().catch(() => ({ results: [] }));
          for (const r of (lcRes.results || [])) {
            lifecycleMap[r.odoo_po_id] = { received_at: r.received_at, received_by: r.received_by_name };
          }
        } catch (_) { /* soft-fail */ }
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
        ...pos.map(p => {
          const row = toRow('PO', {
            odoo_id: p.id,
            date: (p.date_order || '').slice(0, 10),
            vendor: p.partner_id ? { id: p.partner_id[0], name: p.partner_id[1] } : null,
            item_or_ref: `${p.name || 'PO'} · ${p.order_line?.length || 0} item${p.order_line?.length === 1 ? '' : 's'}`,
            company_id: p.company_id?.[0],
            amount: p.amount_total || 0,
            state: p.state,
            recorded_by_user_id: p.x_recorded_by_user_id?.[0] || null,
            recorded_by_name:    p.x_recorded_by_user_id?.[1] || null,
          }, poAtts);
          row.odoo_name = p.name;  // explicit (was already in item_or_ref but UI wants standalone)
          // Phase 4: lifecycle overlay
          const lc = lifecycleMap[p.id];
          if (lc) { row.received_at = lc.received_at; row.received_by = lc.received_by; }
          return row;
        }),
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
      // 'cashier' added so outlet "Pay open PO" tile can list POs for that brand
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr', 'cashier'];
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

      // ── PHASE 0 — refresh stale D1 odoo_ids (match hn_code ↔ Odoo default_code) ─
      // D1 rm_products.odoo_id was written before the Apr 18 Odoo rebuild and points
      // to dead IDs. Re-map against current Odoo using default_code = hn_code. Also
      // refreshes rm_vendors.odoo_id by matching on trimmed+lower-cased name.
      if (phase === 'refresh-ids' || phase === 'all') {
        // Products: fetch all products with HN-RM-* default_code
        const odooProducts = await odoo(apiKey, 'product.product', 'search_read',
          [[['default_code', 'like', 'HN-RM-']]],
          { fields: ['id', 'default_code', 'name'], limit: 500 });
        const codeToId = Object.fromEntries(odooProducts.map(p => [p.default_code, p.id]));

        const d1Prods = await DB.prepare(
          `SELECT id AS d1_id, hn_code, name, odoo_id FROM rm_products WHERE is_active = 1`
        ).all();
        const prodUpdates = [], prodSkipped = [], prodUnmatched = [];
        for (const p of (d1Prods.results || [])) {
          const realId = codeToId[p.hn_code];
          if (!realId) {
            prodUnmatched.push({ hn_code: p.hn_code, name: p.name, stale_odoo_id: p.odoo_id });
            continue;
          }
          if (p.odoo_id === realId) { prodSkipped.push(p.hn_code); continue; }
          prodUpdates.push({ d1_id: p.d1_id, hn_code: p.hn_code, stale: p.odoo_id, real: realId });
        }
        if (!dry_run && prodUpdates.length) {
          for (const u of prodUpdates) {
            await DB.prepare(`UPDATE rm_products SET odoo_id = ?, updated_at = datetime('now') WHERE id = ?`)
              .bind(u.real, u.d1_id).run();
          }
        }

        // Vendors: fetch all suppliers in Odoo, match by name
        const odooVendors = await odoo(apiKey, 'res.partner', 'search_read',
          [[['supplier_rank', '>', 0], ['active', '=', true]]],
          { fields: ['id', 'name', 'phone'], limit: 500 });
        const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const nameToVendorIds = {};
        for (const v of odooVendors) {
          const k = normName(v.name);
          if (!nameToVendorIds[k]) nameToVendorIds[k] = [];
          nameToVendorIds[k].push(v.id);
        }
        const d1Vendors = await DB.prepare(
          `SELECT id AS d1_id, key, name, odoo_id FROM rm_vendors WHERE is_active = 1`
        ).all();
        const vendorUpdates = [], vendorSkipped = [], vendorUnmatched = [], vendorAmbiguous = [];
        for (const v of (d1Vendors.results || [])) {
          const candidates = nameToVendorIds[normName(v.name)] || [];
          if (!candidates.length) { vendorUnmatched.push({ key: v.key, name: v.name, stale_odoo_id: v.odoo_id }); continue; }
          if (candidates.length > 1) { vendorAmbiguous.push({ key: v.key, name: v.name, matches: candidates }); continue; }
          const realId = candidates[0];
          if (v.odoo_id === realId) { vendorSkipped.push(v.key); continue; }
          vendorUpdates.push({ d1_id: v.d1_id, key: v.key, name: v.name, stale: v.odoo_id, real: realId });
        }
        if (!dry_run && vendorUpdates.length) {
          for (const u of vendorUpdates) {
            await DB.prepare(`UPDATE rm_vendors SET odoo_id = ?, updated_at = datetime('now') WHERE id = ?`)
              .bind(u.real, u.d1_id).run();
          }
        }
        // Null out stale odoo_ids for unmatched vendors so downstream queries
        // (e.g. supplierinfo sync) don't try to reference non-existent partners
        if (!dry_run && vendorUnmatched.length) {
          for (const u of vendorUnmatched) {
            if (u.stale_odoo_id != null) {
              await DB.prepare(`UPDATE rm_vendors SET odoo_id = NULL, updated_at = datetime('now') WHERE key = ?`)
                .bind(u.key).run();
            }
          }
        }
        // Same for unmatched products — clear stale product odoo_id
        if (!dry_run && prodUnmatched.length) {
          for (const u of prodUnmatched) {
            if (u.stale_odoo_id != null) {
              await DB.prepare(`UPDATE rm_products SET odoo_id = NULL, updated_at = datetime('now') WHERE hn_code = ?`)
                .bind(u.hn_code).run();
            }
          }
        }

        report.steps.push({
          phase: 'refresh-ids',
          summary: `Products: ${prodUpdates.length} ${dry_run?'would-update':'updated'}, ${prodSkipped.length} already correct, ${prodUnmatched.length} unmatched · Vendors: ${vendorUpdates.length} ${dry_run?'would-update':'updated'}, ${vendorSkipped.length} already correct, ${vendorUnmatched.length} unmatched, ${vendorAmbiguous.length} ambiguous`,
          product_updates_sample: prodUpdates.slice(0, 5),
          product_unmatched: prodUnmatched,
          vendor_updates_sample: vendorUpdates.slice(0, 10),
          vendor_unmatched: vendorUnmatched,
          vendor_ambiguous: vendorAmbiguous,
        });
      }

      // ── PHASE 1 — create sub-categories (BATCHED: 1 search + 1 create) ──
      const subCatMap = {};  // D1 category name → Odoo category id
      if (phase === 'categories' || phase === 'all') {
        const d1Cats = await DB.prepare(
          `SELECT DISTINCT category FROM rm_products WHERE is_active = 1 ORDER BY category`
        ).all();
        const subCatNames = (d1Cats.results || []).map(r => r.category).filter(Boolean);
        // Single search: all sub-cats already under the RM parent
        const existingSubs = await odoo(apiKey, 'product.category', 'search_read',
          [[['parent_id', '=', rmParentId]]], { fields: ['id', 'name'], limit: 200 });
        const existingByName = Object.fromEntries(existingSubs.map(s => [s.name, s.id]));
        const created = [], existed = [], toCreate = [];
        for (const subName of subCatNames) {
          const odooName = `RM / ${subName}`;
          if (existingByName[odooName] != null) {
            subCatMap[subName] = existingByName[odooName];
            existed.push({ d1_name: subName, odoo_name: odooName, id: existingByName[odooName] });
          } else {
            toCreate.push({ d1_name: subName, odoo_name: odooName });
          }
        }
        // Batch create — single Odoo call with array of records
        if (toCreate.length && !dry_run) {
          const vals = toCreate.map(c => ({ name: c.odoo_name, parent_id: rmParentId }));
          const newIds = await odoo(apiKey, 'product.category', 'create', [vals]);
          const idsArr = Array.isArray(newIds) ? newIds : [newIds];
          toCreate.forEach((c, i) => {
            subCatMap[c.d1_name] = idsArr[i];
            created.push({ ...c, id: idsArr[i] });
          });
        } else if (toCreate.length && dry_run) {
          toCreate.forEach(c => {
            subCatMap[c.d1_name] = null;
            created.push({ ...c, id: null, dry_run: true });
          });
        }
        report.steps.push({
          phase: 'categories',
          summary: `${created.length} ${dry_run?'would-create':'created'}, ${existed.length} already existed`,
          created: created.slice(0, 40), existed_count: existed.length,
        });
      }

      // ── PHASE 2 — re-link products (BATCHED by target category) ────────
      if (phase === 'relink' || phase === 'all') {
        if (!Object.keys(subCatMap).length) {
          const subs = await odoo(apiKey, 'product.category', 'search_read',
            [[['parent_id', '=', rmParentId]]],
            { fields: ['id', 'name'], limit: 200 });
          for (const s of subs) {
            const d1Name = s.name.startsWith('RM / ') ? s.name.slice(5) : s.name;
            subCatMap[d1Name] = s.id;
          }
        }
        const products = await DB.prepare(
          `SELECT hn_code, name, category, odoo_id FROM rm_products WHERE is_active = 1 AND odoo_id IS NOT NULL`
        ).all();
        const rows = products.results || [];
        const ids = rows.map(r => r.odoo_id);
        const currentProducts = ids.length ? await odoo(apiKey, 'product.product', 'search_read',
          [[['id', 'in', ids]]],
          { fields: ['id', 'name', 'categ_id', 'product_tmpl_id'], limit: 2000 }) : [];
        const curByOdoo = Object.fromEntries(currentProducts.map(p => [p.id, p]));

        // Group template ids by target category — one write call per group
        const groups = {};    // targetCatId → [tmplId, ...]
        const missing_subcat = [], skipped_already = [], skipped_missing = [];
        for (const r of rows) {
          const targetCatId = subCatMap[r.category];
          if (!targetCatId) { missing_subcat.push({ hn_code: r.hn_code, d1_category: r.category }); continue; }
          const cur = curByOdoo[r.odoo_id];
          if (!cur) { skipped_missing.push({ hn_code: r.hn_code }); continue; }
          if (cur.categ_id?.[0] === targetCatId) { skipped_already.push(r.hn_code); continue; }
          const tmplId = cur.product_tmpl_id?.[0] || null;
          if (!tmplId) { skipped_missing.push({ hn_code: r.hn_code, reason: 'no template' }); continue; }
          if (!groups[targetCatId]) groups[targetCatId] = [];
          groups[targetCatId].push({ hn_code: r.hn_code, odoo_id: r.odoo_id, tmpl_id: tmplId, from: cur.categ_id?.[0] });
        }

        let relinkedCount = 0;
        const relinked_sample = [];
        if (!dry_run) {
          // Parallel group-writes (one subrequest per category group, ~29 max)
          const writes = Object.entries(groups).map(async ([targetCatId, items]) => {
            const tmplIds = items.map(i => i.tmpl_id);
            await odoo(apiKey, 'product.template', 'write', [tmplIds, { categ_id: parseInt(targetCatId, 10) }]);
            return items.length;
          });
          const counts = await Promise.all(writes);
          relinkedCount = counts.reduce((a, b) => a + b, 0);
        } else {
          relinkedCount = Object.values(groups).reduce((a, b) => a + b.length, 0);
        }
        for (const items of Object.values(groups)) {
          for (const it of items.slice(0, 2)) relinked_sample.push(it);
          if (relinked_sample.length >= 10) break;
        }
        report.steps.push({
          phase: 'relink',
          summary: `${relinkedCount} ${dry_run?'would-relink':'re-linked'} across ${Object.keys(groups).length} category groups, ${skipped_already.length} already correct, ${skipped_missing.length} skipped, ${missing_subcat.length} couldn't resolve sub-cat`,
          relinked_sample,
          missing_subcat,
          skipped_missing_sample: skipped_missing.slice(0, 5),
        });
      }

      // ── PHASE 3 — sync supplierinfo (BATCHED: 2 searches + 1 create) ───
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

        // Batch lookup all product templates in one call
        const prodIds = [...new Set(rows.map(r => r.product_odoo_id))];
        const prods = prodIds.length ? await odoo(apiKey, 'product.product', 'search_read',
          [[['id', 'in', prodIds]]],
          { fields: ['id', 'product_tmpl_id'], limit: 2000 }) : [];
        const tmplByProdId = Object.fromEntries(prods.map(p => [p.id, p.product_tmpl_id?.[0]]));

        // Batch lookup existing supplierinfo links for ALL vendor×template pairs
        const vendorIds = [...new Set(rows.map(r => r.vendor_odoo_id))];
        const tmplIds = [...new Set(Object.values(tmplByProdId).filter(Boolean))];
        const existingLinks = (vendorIds.length && tmplIds.length) ? await odoo(apiKey, 'product.supplierinfo', 'search_read',
          [[['partner_id', 'in', vendorIds], ['product_tmpl_id', 'in', tmplIds]]],
          { fields: ['id', 'partner_id', 'product_tmpl_id', 'price'], limit: 5000 }) : [];
        const existingKey = new Set(existingLinks.map(e => `${e.partner_id?.[0]}-${e.product_tmpl_id?.[0]}`));

        // Decide which rows need creation
        const toCreate = [];
        const created = [], existed = [], failed = [];
        for (const r of rows) {
          const tmplId = tmplByProdId[r.product_odoo_id];
          if (!tmplId) { failed.push({ code: r.product_code, reason: 'no template' }); continue; }
          const key = `${r.vendor_odoo_id}-${tmplId}`;
          if (existingKey.has(key)) { existed.push(key); continue; }
          const vals = {
            partner_id: r.vendor_odoo_id,
            product_tmpl_id: tmplId,
            sequence: r.is_primary ? 1 : 10,
          };
          if (r.last_price != null && r.last_price > 0) vals.price = r.last_price;
          toCreate.push({ vals, hint: { code: r.product_code, vendor: r.vendor_name } });
          existingKey.add(key); // avoid duplicate creates within same run
        }

        if (!dry_run && toCreate.length) {
          // Pre-validate: check which partners + templates actually exist as active in Odoo.
          // One bad ref makes the whole batch fail, so filter first, then per-row create the rest.
          const partnerIds = [...new Set(toCreate.map(t => t.vals.partner_id))];
          const activePartners = await odoo(apiKey, 'res.partner', 'search_read',
            [[['id', 'in', partnerIds]]], { fields: ['id', 'active', 'name', 'supplier_rank'], limit: 500 });
          const activePartnerSet = new Set(activePartners.filter(p => p.active !== false).map(p => p.id));
          const tmplIdsToCheck = [...new Set(toCreate.map(t => t.vals.product_tmpl_id))];
          const activeTmpls = await odoo(apiKey, 'product.template', 'search_read',
            [[['id', 'in', tmplIdsToCheck]]], { fields: ['id', 'active'], limit: 2000 });
          const activeTmplSet = new Set(activeTmpls.filter(t => t.active !== false).map(t => t.id));

          // Try batch first with only validated rows
          const validRows = toCreate.filter(t =>
            activePartnerSet.has(t.vals.partner_id) && activeTmplSet.has(t.vals.product_tmpl_id));
          const prefilteredOut = toCreate.length - validRows.length;

          if (validRows.length) {
            try {
              const valsArr = validRows.map(t => t.vals);
              const newIds = await odoo(apiKey, 'product.supplierinfo', 'create', [valsArr]);
              const idsArr = Array.isArray(newIds) ? newIds : [newIds];
              validRows.forEach((t, i) => {
                created.push({ ...t.hint, supplierinfo_id: idsArr[i] });
              });
            } catch (e) {
              // Batch failed — try per-row to isolate which record Odoo is rejecting
              for (const t of validRows) {
                try {
                  const newId = await odoo(apiKey, 'product.supplierinfo', 'create', [t.vals]);
                  created.push({ ...t.hint, supplierinfo_id: newId });
                } catch (inner) {
                  failed.push({ ...t.hint, reason: inner.message.slice(0, 200) });
                }
              }
            }
          }
          if (prefilteredOut) {
            failed.push({ reason: `${prefilteredOut} rows filtered — partner or template archived/deleted` });
          }
        } else if (dry_run) {
          toCreate.forEach(t => created.push({ ...t.hint, dry_run: true }));
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
      // 'cashier' added so outlet "Pay open PO" tile can list POs for that brand
      const LEDGER_ROLES = ['admin', 'cfo', 'purchase', 'gm', 'asstmgr', 'cashier'];
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
    // ── UNIVERSAL PRODUCT MASTER (manager view — fix-data-quality v2) ──
    // GET ?action=list-products-master&pin=&filter=all|no_uom|no_vendor|has_gap&q=
    // Returns all expense-able Odoo products + their D1 vendor mappings.
    // Surfaces gaps (no UOM, no vendor) so Basheer can correct in /ops/vendor.
    if (action === 'list-products-master') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!ALLOWED_HYGIENE_ROLES.has(user.role)) return json({ success: false, error: 'Manager/admin only' }, 403);
      const filter = url.searchParams.get('filter') || 'all';
      const q      = (url.searchParams.get('q') || '').trim().toLowerCase();

      const products = await odoo(apiKey, 'product.product', 'search_read',
        [[['can_be_expensed', '=', true], ['active', '=', true]]],
        { fields: ['id', 'name', 'default_code', 'categ_id', 'uom_id', 'type'], limit: 2000 });

      // Pull vendor_products mappings keyed by HN-RM code first, fall back to product name
      const mapByRm = new Map(); // hn_rm_code → [{vendor_id, vendor_name, uom, qty_hint, unit_price}, …]
      const mapByName = new Map(); // lower(product_name) → same shape
      if (DB) {
        const rows = (await DB.prepare(
          `SELECT vp.id AS vp_id, vp.vendor_id, v.name AS vendor_name, v.primary_brand,
                  vp.hn_rm_code, vp.product_name, vp.uom, vp.qty_hint, vp.unit_price, vp.is_primary_vendor
             FROM vendor_products vp
             JOIN vendors v ON v.id = vp.vendor_id
             WHERE vp.active = 1 AND v.active = 1`
        ).all()).results || [];
        for (const r of rows) {
          if (r.hn_rm_code) {
            if (!mapByRm.has(r.hn_rm_code)) mapByRm.set(r.hn_rm_code, []);
            mapByRm.get(r.hn_rm_code).push(r);
          }
          const nKey = (r.product_name || '').toLowerCase().trim();
          if (nKey) {
            if (!mapByName.has(nKey)) mapByName.set(nKey, []);
            mapByName.get(nKey).push(r);
          }
        }
      }

      // Categories that legitimately don't need UOM/vendor (salary, rent, utility, etc.)
      // Tagged for UI to skip the "no UOM" warning.
      const NO_UOM_CATEGORIES = new Set([
        'Salary', 'Salary Payment', 'Rent', 'Utility Bill', 'Police / Hafta',
        'Bank Charge', 'Owner Drawing', 'Owner Drawings', 'Tax', 'Insurance',
        'Subscription', 'Loan Repayment', 'Interest',
      ]);

      const out = [];
      for (const p of products) {
        const catId   = Array.isArray(p.categ_id) ? p.categ_id[0] : p.categ_id;
        const catName = Array.isArray(p.categ_id) ? p.categ_id[1] : '';
        const uomId   = Array.isArray(p.uom_id)   ? p.uom_id[0]   : p.uom_id;
        const uomName = Array.isArray(p.uom_id)   ? p.uom_id[1]   : null;
        const isUOMRequired = !NO_UOM_CATEGORIES.has(catName?.split(' / ').pop()?.trim()) &&
                              !NO_UOM_CATEGORIES.has(catName) &&
                              !/Salary|Rent|Hafta|Utility|Police|Bank|Insurance|Subscription|Loan/i.test(catName || '');

        // Resolve mapped vendors — try HN-RM code first, fall back to name match
        let mapped = (p.default_code && mapByRm.get(p.default_code)) || mapByName.get((p.name || '').toLowerCase().trim()) || [];

        const has_uom = !!(uomName && uomName.toLowerCase() !== 'units' && uomName.length);
        // 'Units' is the Odoo default — usually unset by the user. We treat it as
        // "UOM still default" only when we expect kg/L (cat hint), not for cats
        // that genuinely use Units (Bottles, Packets etc.). For now, flag any
        // 'Units' UOM in raw-material-y categories as "needs review" via has_uom.
        const has_vendor = mapped.length > 0;
        const has_gap = isUOMRequired && (!has_uom || !has_vendor);

        const row = {
          id: p.id,
          name: p.name,
          default_code: p.default_code || null,
          categ_id: catId,
          categ_name: catName,
          uom_id: uomId,
          uom_name: uomName,
          uom_required: isUOMRequired,
          mapped_vendors: mapped.map(m => ({
            vp_id: m.vp_id, vendor_id: m.vendor_id, vendor_name: m.vendor_name,
            primary_brand: m.primary_brand, vendor_uom: m.uom, qty_hint: m.qty_hint,
            unit_price: m.unit_price, is_primary_vendor: !!m.is_primary_vendor,
          })),
          has_gap, has_uom, has_vendor,
        };

        // Filter
        if (filter === 'no_uom'    && (has_uom || !isUOMRequired)) continue;
        if (filter === 'no_vendor' && (has_vendor || !isUOMRequired)) continue;
        if (filter === 'has_gap'   && !has_gap) continue;

        if (q) {
          const hay = (p.name + ' ' + (p.default_code || '') + ' ' + (catName || '')).toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push(row);
      }

      // Stats
      const stats = {
        total: products.length,
        shown: out.length,
        no_uom: products.filter(p => {
          const u = Array.isArray(p.uom_id) ? p.uom_id[1] : null;
          return !u || u.toLowerCase() === 'units';
        }).length,
        no_vendor_in_d1: out.filter(r => r.uom_required && !r.has_vendor).length,
        has_gap: out.filter(r => r.has_gap).length,
      };
      return json({ success: true, stats, products: out });
    }

    // ── UPDATE PRODUCT (rename / change UOM in Odoo from manager UI) ──
    // POST { pin, product_id, name?, uom_id?, default_code? }
    if (action === 'update-product' && request.method === 'POST') {
      const body = await request.json();
      const { pin, product_id, name, uom_id, default_code } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!ALLOWED_HYGIENE_ROLES.has(user.role)) return json({ success: false, error: 'Manager/admin only' }, 403);
      if (!product_id) return json({ success: false, error: 'product_id required' }, 400);
      const updates = {};
      if (name?.trim())         updates.name = name.trim();
      if (uom_id)               updates.uom_id = parseInt(uom_id, 10);
      if (default_code?.trim()) updates.default_code = default_code.trim();
      if (!Object.keys(updates).length) return json({ success: false, error: 'Nothing to update' }, 400);
      await odoo(apiKey, 'product.product', 'write', [[parseInt(product_id, 10)], updates]);
      return json({ success: true, product_id, updates });
    }

    // ── PRODUCT DUP SCAN (manager hygiene panel — fix-E live mode) ──
    // GET ?action=scan-product-dups&pin= → live fuzzy scan over recent
    // expense products (Odoo product.product where can_be_expensed=true).
    // Manager-facing — surfaces candidates that the curated MERGE_GROUPS
    // didn't pre-handle. Each candidate includes business_expenses row counts
    // so the manager can see impact before approving.
    if (action === 'scan-product-dups') {
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!ALLOWED_HYGIENE_ROLES.has(user.role)) return json({ success: false, error: 'Manager/admin only' }, 403);

      const products = await odoo(apiKey, 'product.product', 'search_read',
        [[['can_be_expensed', '=', true], ['active', '=', true]]],
        { fields: ['id', 'name', 'default_code', 'categ_id', 'uom_id'], limit: 1000 });

      // Group by category, then fuzzy within group (cross-category matches are noise)
      const byCat = new Map();
      for (const p of products) {
        const cid = Array.isArray(p.categ_id) ? p.categ_id[0] : p.categ_id;
        if (!byCat.has(cid)) byCat.set(cid, []);
        byCat.get(cid).push(p);
      }

      const candidates = [];
      for (const [cid, items] of byCat.entries()) {
        const seen = new Set();
        for (const p of items) {
          if (seen.has(p.id)) continue;
          const others = items.filter(o => o.id !== p.id && !seen.has(o.id));
          const dup = findFuzzyDup(p.name, others);
          if (!dup) continue;
          // Skip exact-equal-after-normalisation triggered by curated merges already
          if (dup.match_reason === 'exact') continue;
          // Decide which is canonical: prefer one with default_code or longer name
          const aHasCode = !!p.default_code, bHasCode = !!dup.default_code;
          const keep = bHasCode && !aHasCode ? dup : (aHasCode && !bHasCode ? p : (p.name.length >= dup.name.length ? p : dup));
          const drop = keep.id === p.id ? dup : p;
          seen.add(drop.id); seen.add(keep.id);

          let beRows = 0;
          if (DB) {
            try {
              const r = await DB.prepare(`SELECT COUNT(*) AS n FROM business_expenses WHERE product_id = ?`).bind(drop.id).first();
              beRows = r?.n || 0;
            } catch (_) {}
          }
          candidates.push({
            keep:  { id: keep.id, name: keep.name, default_code: keep.default_code, uom: Array.isArray(keep.uom_id) ? keep.uom_id[1] : null },
            drop:  { id: drop.id, name: drop.name, default_code: drop.default_code, uom: Array.isArray(drop.uom_id) ? drop.uom_id[1] : null },
            categ_id: cid,
            match_reason: dup.match_reason,
            be_rows: beRows,
          });
        }
      }
      return json({ success: true, candidates_count: candidates.length, candidates });
    }

    // ── MERGE PRODUCT PAIR (manager-approved single pair) ──
    // POST { pin, keep_id, drop_id } → archives drop in Odoo + re-points
    // business_expenses canonical_product_id. Idempotent.
    if (action === 'merge-product-pair' && request.method === 'POST') {
      const body = await request.json();
      const { pin, keep_id, drop_id } = body;
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!ALLOWED_HYGIENE_ROLES.has(user.role)) return json({ success: false, error: 'Manager/admin only' }, 403);
      if (!keep_id || !drop_id || keep_id === drop_id) return json({ success: false, error: 'keep_id + drop_id required (distinct)' }, 400);

      let beRows = 0;
      if (DB) {
        const upd = await DB.prepare(
          `UPDATE business_expenses SET canonical_product_id = ? WHERE product_id = ? AND (canonical_product_id IS NULL OR canonical_product_id != ?)`
        ).bind(parseInt(keep_id, 10), parseInt(drop_id, 10), parseInt(keep_id, 10)).run();
        beRows = upd.meta?.changes || 0;
      }
      let archived = false, archive_error = null;
      try {
        await odoo(apiKey, 'product.product', 'write', [[parseInt(drop_id, 10)], { active: false }]);
        archived = true;
      } catch (e) {
        archive_error = String(e.message || e).slice(0, 120);
      }
      return json({ success: true, keep_id, drop_id, be_rows_repointed: beRows, archived, archive_error });
    }

    // ── DUPLICATE PRODUCT MERGE (Apr 2026 fix-E lookback cleanup) ──
    // GET  ?action=merge-duplicate-products&dry_run=1  → preview canonical groupings
    // POST ?action=merge-duplicate-products            → apply: re-point business_expenses,
    //                                                    archive Odoo dup products
    // Admin only. Idempotent.
    if (action === 'merge-duplicate-products') {
      const pin = url.searchParams.get('pin') || (request.method === 'POST' ? (await request.clone().json().catch(()=>({}))).pin : null);
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (user.role !== 'admin' && user.role !== 'cfo') {
        return json({ success: false, error: 'Admin/CFO only' }, 403);
      }

      // Known canonical mappings (curated 2026-04-25 from D1 audit). Future
      // merges should be added here, not invented at runtime.
      const MERGE_GROUPS = [
        { keep_name: 'Bun',   merge_names: ['Buns'] },
        { keep_name: 'Lemon (Nimbu)', merge_names: ['Lemon'] },
        { keep_name: 'Fresh Mint (Pudina)', merge_names: ['Pudina'] },
        { keep_name: 'Samosa Raw', merge_names: ['Samoosa', 'Samosa'] },
        { keep_name: 'Bottled Water (500ml)', merge_names: ['Aqua king water 500 ml', 'Bisleri water'] },
        { keep_name: 'Packaging (bags/paper/foil)', merge_names: ['Packing Meterials', 'Packing Materials'] },
      ];

      const dryRun = request.method === 'GET' || url.searchParams.get('dry_run') === '1';
      const report = { dry_run: dryRun, groups: [] };

      for (const g of MERGE_GROUPS) {
        const groupReport = { keep_name: g.keep_name, merge_names: g.merge_names, keep_id: null, dups: [], be_rows_repointed: 0 };

        // Resolve canonical product_id (case-insensitive name match in Odoo)
        const keepHits = await odoo(apiKey, 'product.product', 'search_read',
          [[['name', 'ilike', g.keep_name]]],
          { fields: ['id', 'name', 'default_code', 'active'], limit: 5 });
        const keep = keepHits.find(p => p.name.trim().toLowerCase() === g.keep_name.toLowerCase()) || keepHits[0];
        if (!keep) { groupReport.note = 'canonical_not_found'; report.groups.push(groupReport); continue; }
        groupReport.keep_id = keep.id;

        for (const dn of g.merge_names) {
          const dups = await odoo(apiKey, 'product.product', 'search_read',
            [[['name', 'ilike', dn], ['id', '!=', keep.id]]],
            { fields: ['id', 'name', 'active'], limit: 10 });
          for (const d of dups) {
            // Match exact (case-insensitive) only — defends against unintended catches
            if (d.name.trim().toLowerCase() !== dn.toLowerCase()) continue;
            const dupEntry = { id: d.id, name: d.name, was_active: !!d.active, be_rows: 0 };

            if (DB) {
              // Count business_expenses rows touching this dup
              const cnt = await DB.prepare(
                `SELECT COUNT(*) AS n FROM business_expenses WHERE product_id = ?`
              ).bind(d.id).first();
              dupEntry.be_rows = cnt?.n || 0;
            }

            if (!dryRun) {
              // 1) Re-point business_expenses canonical_product_id (keep product_id as historical)
              if (DB) {
                const upd = await DB.prepare(
                  `UPDATE business_expenses SET canonical_product_id = ? WHERE product_id = ? AND (canonical_product_id IS NULL OR canonical_product_id != ?)`
                ).bind(keep.id, d.id, keep.id).run();
                groupReport.be_rows_repointed += (upd.meta?.changes || 0);
              }
              // 2) Archive the Odoo dup product so cashiers can't pick it again
              try {
                await odoo(apiKey, 'product.product', 'write', [[d.id], { active: false }]);
                dupEntry.archived = true;
              } catch (e) {
                dupEntry.archived = false;
                dupEntry.error = String(e.message || e).slice(0, 80);
              }
            }
            groupReport.dups.push(dupEntry);
          }
        }
        report.groups.push(groupReport);
      }

      return json({ success: true, ...report });
    }

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

    // ════════════════════════════════════════════════════════════════════
    // BILLS API — for /ops/bills/ dedicated bill upload + payment tracker.
    //
    // Why these live in spend.js (not a new file): reuses the saveAttachment
    // / syncToDrive / logBillAttachment / odoo / USERS helpers without
    // duplication. Same auth model. Zero new schema. All 4 actions use
    // existing Odoo models (account.move, account.payment, account.move.line)
    // and the existing D1 bill_attachments table.
    //
    // Backward-compat guarantees:
    //   • No existing endpoint signature changes.
    //   • No existing JSON response field renamed/removed.
    //   • If a user creates a bill via /ops/expense/ cat 14, it still works
    //     identically — these actions are an alternate, additive path.
    //   • Idempotency check on (vendor_id + bill_ref + bill_date + amount)
    //     prevents accidental dup-billing across both paths.
    // ════════════════════════════════════════════════════════════════════

    // ── GET: payment-journals — list bank/cash journals filtered by brand ─
    if (action === 'payment-journals') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const companyId = BRAND_COMPANY[brand];
      if (!companyId) return json({ success: false, error: 'Unknown brand' }, 400);
      const journals = await odoo(apiKey, 'account.journal', 'search_read',
        [[['type', 'in', ['bank', 'cash']], ['company_id', '=', companyId]]],
        { fields: ['id', 'name', 'type', 'code'], order: 'sequence asc, name asc' });
      return json({ success: true, journals });
    }

    // ── GET: list-bills — for /ops/bills/ Unpaid + Recent tabs ────────────
    // Query: ?status=unpaid|all  &days=N  &brand=NCH|HE|HQ|ALL  &pin=...
    if (action === 'list-bills') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const pin = url.searchParams.get('pin');
      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!BILL_VIEW_ROLES.has(user.role)) {
        return json({ success: false, error: `Role ${user.role} cannot view bills` }, 403);
      }
      const status = url.searchParams.get('status') || 'unpaid';
      const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10), 1), 365);
      const brand = (url.searchParams.get('brand') || 'ALL').toUpperCase();
      const companyId = brand !== 'ALL' ? BRAND_COMPANY[brand] : null;

      // Date window — IST today minus N days, inclusive
      const ymdToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const fromYmd = new Date(Date.parse(`${ymdToday}T00:00:00.000Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);

      const domain = [['move_type', '=', 'in_invoice']];
      if (companyId) domain.push(['company_id', '=', companyId]);
      if (status === 'unpaid') {
        domain.push(['payment_state', '!=', 'paid']);
        domain.push(['state', '=', 'posted']);
      } else if (status === 'all') {
        domain.push(['invoice_date', '>=', fromYmd]);
      }

      const bills = await odoo(apiKey, 'account.move', 'search_read',
        [domain],
        { fields: ['id', 'name', 'ref', 'invoice_date', 'invoice_date_due',
                   'partner_id', 'company_id', 'amount_total', 'amount_residual',
                   'payment_state', 'state', 'invoice_origin',
                   'narration', 'x_recorded_by_user_id'],
          order: status === 'unpaid' ? 'invoice_date_due asc nulls last' : 'invoice_date desc',
          limit: 200 });

      // Attachments via existing D1 bill_attachments
      const billIds = bills.map(b => b.id);
      const attMap = {};
      if (DB && billIds.length) {
        try {
          const placeholders = billIds.map(() => '?').join(',');
          const r = await DB.prepare(
            `SELECT entry_odoo_id, drive_view_url, filename FROM bill_attachments
              WHERE entry_kind = 'Bill' AND entry_odoo_id IN (${placeholders})`
          ).bind(...billIds).all().catch(() => ({ results: [] }));
          for (const row of (r.results || [])) {
            if (!attMap[row.entry_odoo_id]) attMap[row.entry_odoo_id] = [];
            attMap[row.entry_odoo_id].push({ drive_url: row.drive_view_url, filename: row.filename });
          }
        } catch (_) { /* soft-fail */ }
      }

      const COMPANY_BRAND = { 1: 'HQ', 2: 'HE', 3: 'NCH' };
      const todayMs = Date.now();
      const out = bills.map(b => {
        const dueMs = b.invoice_date_due ? Date.parse(b.invoice_date_due) : null;
        const isOverdue = dueMs !== null && dueMs < todayMs && b.payment_state !== 'paid';
        return {
          id: b.id,
          ref: b.ref || b.name,
          odoo_name: b.name,
          vendor_id: b.partner_id?.[0] || null,
          vendor_name: b.partner_id?.[1] || null,
          brand: COMPANY_BRAND[b.company_id?.[0]] || '?',
          invoice_date: b.invoice_date,
          due_date: b.invoice_date_due,
          amount_total: b.amount_total || 0,
          amount_residual: b.amount_residual || 0,
          amount_paid: (b.amount_total || 0) - (b.amount_residual || 0),
          payment_state: b.payment_state || 'not_paid',
          is_overdue: isOverdue,
          recorded_by: b.x_recorded_by_user_id?.[1] || null,
          notes: b.narration || '',
          from_po: b.invoice_origin || null,
          attachments: attMap[b.id] || [],
          attachment_count: (attMap[b.id] || []).length,
        };
      });

      const totals = {
        count: out.length,
        unpaid_total: out.filter(b => b.payment_state !== 'paid').reduce((s, b) => s + b.amount_residual, 0),
        overdue_count: out.filter(b => b.is_overdue).length,
        overdue_total: out.filter(b => b.is_overdue).reduce((s, b) => s + b.amount_residual, 0),
      };
      return json({ success: true, bills: out, totals, status, brand, days });
    }

    // ── POST: upload-bill — create new vendor bill (paid/unpaid/partial) ──
    // Body: {
    //   pin, brand, vendor_id, amount, bill_date, due_date?, bill_ref?, notes?,
    //   attachment? (existing shape: {name, mimetype, data_b64}),
    //   payment_status: 'unpaid' | 'paid' | 'partial',
    //   payment_amount?: number (for partial),
    //   payment_journal_id?: number (account.journal id; required for paid/partial),
    //   payment_date?: YYYY-MM-DD (for paid/partial),
    //   payment_method_label?: string (e.g. "Basheer cash" — display only)
    // }
    if (action === 'upload-bill' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, brand, vendor_id, amount, bill_date, due_date, bill_ref, notes,
              payment_status, payment_amount, payment_journal_id, payment_date,
              payment_method_label } = body;

      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!BILL_UPLOAD_ROLES.has(user.role)) {
        return json({ success: false, error: `Role ${user.role} cannot upload bills` }, 403);
      }
      const companyId = BRAND_COMPANY[(brand || '').toUpperCase()];
      if (!companyId) return json({ success: false, error: 'Unknown brand' }, 400);
      if (!vendor_id) return json({ success: false, error: 'Vendor required' }, 400);
      const amt = parseFloat(amount);
      if (!(amt > 0)) return json({ success: false, error: 'Amount must be > 0' }, 400);
      if (!bill_date || !/^\d{4}-\d{2}-\d{2}$/.test(bill_date)) {
        return json({ success: false, error: 'bill_date YYYY-MM-DD required' }, 400);
      }
      const status = (payment_status || 'unpaid').toLowerCase();
      if (!['unpaid', 'paid', 'partial'].includes(status)) {
        return json({ success: false, error: 'payment_status must be unpaid|paid|partial' }, 400);
      }

      // Idempotency: reject if a bill with same (vendor + ref + date + amount) already exists.
      // Prevents accidental dup if user double-taps Save.
      if (bill_ref) {
        const existing = await odoo(apiKey, 'account.move', 'search_read',
          [[['move_type', '=', 'in_invoice'], ['company_id', '=', companyId],
            ['partner_id', '=', parseInt(vendor_id, 10)], ['ref', '=', bill_ref],
            ['invoice_date', '=', bill_date]]],
          { fields: ['id', 'name', 'amount_total'], limit: 1 });
        if (existing.length && Math.abs(existing[0].amount_total - amt) < 0.5) {
          return json({ success: false, code: 'DUPLICATE',
            error: `A bill with same vendor + ref + date + amount already exists: ${existing[0].name}`,
            existing_bill_id: existing[0].id }, 409);
        }
      }

      // 1. Create + post the bill
      const moveVals = {
        move_type: 'in_invoice',
        partner_id: parseInt(vendor_id, 10),
        company_id: companyId,
        invoice_date: bill_date,
        invoice_date_due: due_date || null,
        ref: bill_ref || null,
        narration: notes || null,
        x_recorded_by_user_id: pinToUid(pin),
        invoice_line_ids: [[0, 0, {
          name: notes || bill_ref || 'Vendor bill',
          quantity: 1,
          price_unit: amt,
        }]],
      };
      const billId = await odoo(apiKey, 'account.move', 'create', [moveVals]);
      await odoo(apiKey, 'account.move', 'action_post', [[billId]]);

      // 2. Attachment (Odoo + Drive + bill_attachments) — reuses existing helpers
      let attId = null, driveInfo = null;
      if (body.attachment) {
        body.attachment = {
          ...body.attachment,
          name: buildBillFilename({
            date: bill_date, category: 'Vendor Bill', brand,
            product: bill_ref || 'bill', amount: amt, recorded_by: user.name,
          }),
        };
        attId = await saveAttachment(apiKey, body.attachment, 'account.move', billId);
        driveInfo = await syncToDrive(env, {
          date: bill_date, company: brand, category: 'Vendor Bill',
          product: bill_ref || 'bill', amount: amt, recorded_by: user.name,
          filename: body.attachment.name, mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64,
        });
        await logBillAttachment(DB, {
          kind: 'Bill', odoo_id: billId, brand,
          entry_date: bill_date, entry_amount: amt,
          odoo_attachment_id: attId,
          drive_file_id: driveInfo?.file_id, drive_view_url: driveInfo?.view_url, drive_path: driveInfo?.path,
          filename: body.attachment.name, mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64, pin, user_name: user.name,
        });
      }

      // 3. If paid/partial — register payment via JE pattern (same as rm-ops.registerPaymentJE)
      let paymentInfo = null;
      if (status !== 'unpaid') {
        const payAmt = status === 'partial' ? parseFloat(payment_amount) : amt;
        if (!(payAmt > 0) || payAmt > amt + 0.01) {
          return json({ success: false, error: `Invalid payment_amount ${payAmt} for bill of ${amt}` }, 400);
        }
        if (!payment_journal_id) {
          return json({ success: false, error: 'payment_journal_id required for paid/partial' }, 400);
        }
        const payDate = payment_date || bill_date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
          return json({ success: false, error: 'payment_date YYYY-MM-DD required' }, 400);
        }

        try {
          paymentInfo = await _settleBillJE(apiKey, env, {
            bill_id: billId, amount: payAmt, payment_date: payDate,
            journal_id: parseInt(payment_journal_id, 10),
            partner_id: parseInt(vendor_id, 10),
            company_id: companyId,
            memo: payment_method_label
              ? `${payment_method_label}${notes ? ' — ' + notes : ''}`
              : (notes || `Payment for bill ${bill_ref || billId}`),
          });
        } catch (e) {
          // Bill is already created + posted; payment failed. Surface clearly so
          // the user can retry payment without re-uploading the bill.
          return json({ success: true, partial_failure: true,
            bill_id: billId, payment_error: e.message,
            message: 'Bill saved as UNPAID — payment registration failed; retry from Unpaid tab' });
        }
      }

      return json({ success: true,
        bill_id: billId, attachment_id: attId, drive_view_url: driveInfo?.view_url || null,
        payment: paymentInfo,
        payment_status: paymentInfo ? (paymentInfo.payment_state || status) : 'unpaid' });
    }

    // ── POST: pay-bill — settle an existing unpaid/partial bill ───────────
    // Body: { pin, bill_id, amount, payment_date, payment_journal_id, payment_method_label?, memo? }
    if (action === 'pay-bill' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, bill_id, amount, payment_date, payment_journal_id, payment_method_label, memo } = body;

      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!BILL_PAY_ROLES.has(user.role)) {
        return json({ success: false, error: `Role ${user.role} cannot pay bills` }, 403);
      }
      if (!bill_id || !amount || !payment_date || !payment_journal_id) {
        return json({ success: false, error: 'bill_id, amount, payment_date, payment_journal_id required' }, 400);
      }
      const amt = parseFloat(amount);
      if (!(amt > 0)) return json({ success: false, error: 'amount must be > 0' }, 400);

      const bill = await odoo(apiKey, 'account.move', 'read',
        [[parseInt(bill_id, 10)]],
        { fields: ['id', 'name', 'state', 'move_type', 'amount_residual', 'company_id', 'partner_id'] });
      if (!bill?.[0]) return json({ success: false, error: 'Bill not found' }, 404);
      const b = bill[0];
      if (b.move_type !== 'in_invoice') return json({ success: false, error: 'Not a vendor bill' }, 400);
      if (b.state !== 'posted') return json({ success: false, error: `Bill state=${b.state}, must be posted` }, 400);
      if (amt > (b.amount_residual || 0) + 0.01) {
        return json({ success: false, error: `Amount ${amt} exceeds residual ${b.amount_residual}` }, 400);
      }

      try {
        const result = await _settleBillJE(apiKey, env, {
          bill_id: b.id, amount: amt, payment_date,
          journal_id: parseInt(payment_journal_id, 10),
          partner_id: b.partner_id[0],
          company_id: b.company_id[0],
          memo: payment_method_label
            ? `${payment_method_label}${memo ? ' — ' + memo : ''}`
            : (memo || `Payment for ${b.name}`),
        });
        return json({ success: true, ...result });
      } catch (e) {
        return json({ success: false, error: e.message }, 500);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 2: settle-po — atomic PO → Bill → Payment in one call.
    //
    // The architectural fix for the cross-kind double-count problem.
    // Used by:
    //   • Surface A: /ops/purchase/ Zoya cart-submit "Mark as paid" toggle
    //     (calls create-po then settle-po with the new PO id)
    //   • Surface B: /ops/v2/ outlet "Pay open PO" tile, via NCH /api/rectify
    //     and HE /api/v2 wrappers (which also write outlet D1 for till drop)
    //
    // Body: {
    //   pin, brand, po_id,
    //   payment_amount? (default = PO total — for partial payment),
    //   payment_journal_id, payment_date,
    //   payment_method_label? (free-text "Basheer cash" / "Nihaf HDFC" etc.),
    //   bill_ref?, bill_due_date?, notes?,
    //   attachment? ({name, mimetype, data_b64} — bill photo),
    //   skip_if_already_billed? (default true — idempotent vs double-bill)
    // }
    //
    // Atomic steps:
    //   1. Read PO, verify state in [purchase, done] AND company match
    //   2. Idempotency: if PO already has a posted bill, settle that bill instead
    //      of creating a new one (covers retry-after-failure case)
    //   3. Else: action_create_invoice → get bill_id → action_post
    //   4. Update bill ref / due_date / narration if provided
    //   5. Attach photo (Odoo + Drive + bill_attachments) if provided
    //   6. Call _settleBillJE for the payment (full or partial)
    //
    // Returns: { po_id, po_name, bill_id, payment_move_id, amount_paid,
    //            new_residual, payment_state, attachment_id, drive_view_url }
    // ════════════════════════════════════════════════════════════════════
    if (action === 'settle-po' && request.method === 'POST') {
      if (!apiKey) return json({ success: false, error: 'Odoo API key not configured' }, 500);
      const body = await request.json();
      const { pin, brand, po_id, payment_amount, payment_journal_id, payment_date,
              payment_method_label, bill_ref, bill_due_date, notes,
              skip_if_already_billed = true } = body;

      const user = resolveUser(pin);
      if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
      if (!BILL_PAY_ROLES.has(user.role) && user.role !== 'cashier' && user.role !== 'purchase') {
        return json({ success: false, error: `Role ${user.role} cannot settle POs` }, 403);
      }
      const companyId = BRAND_COMPANY[(brand || '').toUpperCase()];
      if (!companyId) return json({ success: false, error: 'Unknown brand' }, 400);
      if (!po_id) return json({ success: false, error: 'po_id required' }, 400);
      if (!payment_journal_id) return json({ success: false, error: 'payment_journal_id required' }, 400);
      const payDate = payment_date || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
        return json({ success: false, error: 'payment_date YYYY-MM-DD required' }, 400);
      }

      // 1. Read PO
      const poId = parseInt(po_id, 10);
      const po = await odoo(apiKey, 'purchase.order', 'read',
        [[poId]],
        { fields: ['id', 'name', 'state', 'company_id', 'partner_id',
                   'amount_total', 'invoice_status'] });
      if (!po?.[0]) return json({ success: false, error: 'PO not found' }, 404);
      const p = po[0];
      if (p.company_id[0] !== companyId) {
        return json({ success: false, error: `PO belongs to a different brand` }, 400);
      }
      if (!['purchase', 'done'].includes(p.state)) {
        return json({ success: false, error: `PO state=${p.state}, must be confirmed` }, 400);
      }

      // 2. Idempotency check — does this PO already have a posted bill?
      let billId = null;
      if (skip_if_already_billed) {
        const existing = await odoo(apiKey, 'account.move', 'search_read',
          [[['invoice_origin', '=', p.name],
            ['move_type', '=', 'in_invoice'],
            ['company_id', '=', companyId]]],
          { fields: ['id', 'state', 'amount_residual', 'payment_state'],
            limit: 1, order: 'id desc' });
        if (existing.length) {
          billId = existing[0].id;
          // If bill already fully paid, just return that — caller can interpret
          if (existing[0].payment_state === 'paid') {
            return json({ success: true, already_paid: true,
              po_id: poId, po_name: p.name, bill_id: billId,
              payment_state: 'paid' });
          }
        }
      }

      // 3. Create + post bill if needed
      if (!billId) {
        try {
          const inv = await odoo(apiKey, 'purchase.order', 'action_create_invoice', [[poId]]);
          if (inv && inv.res_id) billId = inv.res_id;
          else if (inv && inv.domain) {
            const m = JSON.stringify(inv.domain).match(/\[(\d+)\]/);
            if (m) billId = parseInt(m[1], 10);
          }
          if (!billId) {
            // Fallback search
            const found = await odoo(apiKey, 'account.move', 'search',
              [[['invoice_origin', '=', p.name], ['move_type', '=', 'in_invoice']]],
              { limit: 1, order: 'id desc' });
            if (found?.length) billId = found[0];
          }
        } catch (e) {
          return json({ success: false, error: `Bill creation failed: ${e.message}` }, 500);
        }
        if (!billId) return json({ success: false, error: 'Bill not created (no id returned)' }, 500);

        // Update bill with provided fields BEFORE posting
        const writeVals = { x_recorded_by_user_id: pinToUid(pin) };
        if (bill_ref) writeVals.ref = bill_ref;
        if (bill_due_date) writeVals.invoice_date_due = bill_due_date;
        if (notes) writeVals.narration = notes;
        try { await odoo(apiKey, 'account.move', 'write', [[billId], writeVals]); } catch (_) {}

        // Post the bill
        try { await odoo(apiKey, 'account.move', 'action_post', [[billId]]); }
        catch (e) {
          return json({ success: false, error: `Bill post failed: ${e.message}`, bill_id: billId }, 500);
        }
      }

      // 4. Attachment (optional)
      let attId = null, driveInfo = null;
      if (body.attachment) {
        body.attachment = {
          ...body.attachment,
          name: buildBillFilename({
            date: payDate, category: 'PO Settlement', brand,
            product: p.name, amount: p.amount_total, recorded_by: user.name,
          }),
        };
        attId = await saveAttachment(apiKey, body.attachment, 'account.move', billId);
        driveInfo = await syncToDrive(env, {
          date: payDate, company: brand, category: 'PO Settlement',
          product: p.name, amount: p.amount_total, recorded_by: user.name,
          filename: body.attachment.name, mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64,
        });
        await logBillAttachment(DB, {
          kind: 'Bill', odoo_id: billId, brand,
          entry_date: payDate, entry_amount: p.amount_total,
          odoo_attachment_id: attId,
          drive_file_id: driveInfo?.file_id, drive_view_url: driveInfo?.view_url, drive_path: driveInfo?.path,
          filename: body.attachment.name, mimetype: body.attachment.mimetype,
          data_b64: body.attachment.data_b64, pin, user_name: user.name,
        });
      }

      // 5. Read bill residual + decide payment amount
      const billRow = await odoo(apiKey, 'account.move', 'read',
        [[billId]], { fields: ['amount_residual', 'amount_total', 'name'] });
      const residual = billRow?.[0]?.amount_residual || 0;
      const amt = parseFloat(payment_amount) || residual;
      if (!(amt > 0)) return json({ success: false, error: 'payment_amount must be > 0' }, 400);
      if (amt > residual + 0.01) {
        return json({ success: false, error: `Payment ${amt} exceeds bill residual ${residual}` }, 400);
      }

      // 6. Settle the bill
      try {
        const settled = await _settleBillJE(apiKey, env, {
          bill_id: billId, amount: amt, payment_date: payDate,
          journal_id: parseInt(payment_journal_id, 10),
          partner_id: p.partner_id[0],
          company_id: companyId,
          memo: payment_method_label
            ? `${payment_method_label}${notes ? ' — ' + notes : ''} (PO ${p.name})`
            : (notes || `Payment for PO ${p.name}`),
        });
        return json({ success: true,
          po_id: poId, po_name: p.name, bill_id: billId, bill_ref: billRow?.[0]?.name,
          ...settled,
          attachment_id: attId, drive_view_url: driveInfo?.view_url || null,
        });
      } catch (e) {
        return json({ success: false, partial_failure: true,
          po_id: poId, bill_id: billId,
          payment_error: e.message,
          message: 'PO billed successfully but payment failed — retry from /ops/bills/ Unpaid tab' }, 500);
      }
    }

    return json({ success: false, error: 'Unknown action', actions: ['verify-pin','products','employees','vendors','recent','record','upload-bill','pay-bill','list-bills','payment-journals','settle-po'] }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}

// ━━━ Bill API helpers (Phase 1: /ops/bills/) ━━━━━━━━━━━━━━━━━━━━━━━━━━

// Roles allowed to upload / pay / view bills. Aligned with USERS map.
const BILL_VIEW_ROLES   = new Set(['admin', 'cfo', 'gm', 'asstmgr', 'purchase', 'viewer']);
const BILL_UPLOAD_ROLES = new Set(['admin', 'cfo', 'gm', 'asstmgr', 'purchase']);
const BILL_PAY_ROLES    = new Set(['admin', 'cfo', 'gm']);  // Naveen, Nihaf, Basheer, Tanveer, Yashwant

// Settle an Odoo vendor bill via direct journal entry — same pattern as
// rm-ops.registerPaymentJE. Bypasses account.payment state machine entirely;
// creates a Dr Payable / Cr Cash JE, posts it, reconciles the new debit line
// with the bill's payable line. Works on every Odoo version.
//
// Returns: { payment_move_id, amount_paid, new_residual, payment_state }
async function _settleBillJE(apiKey, env, opts) {
  const { bill_id, amount, payment_date, journal_id, partner_id, company_id, memo } = opts;

  // Find the bill's UNRECONCILED payable line
  const billLines = await odoo(apiKey, 'account.move.line', 'search_read',
    [[['move_id', '=', bill_id], ['account_id.account_type', 'in', ['liability_payable']]]],
    { fields: ['id', 'account_id', 'partner_id', 'debit', 'credit', 'reconciled', 'amount_residual'] });
  const payableLine = billLines.find(l => !l.reconciled);
  if (!payableLine) throw new Error('Bill payable line not found or already reconciled');
  const payable_account_id = payableLine.account_id[0];

  // Read journal's default account (cash/bank)
  const jrn = await odoo(apiKey, 'account.journal', 'read',
    [[journal_id]], { fields: ['id', 'name', 'default_account_id', 'company_id'] });
  if (!jrn?.[0]?.default_account_id) throw new Error('Journal has no default_account_id');
  if (jrn[0].company_id[0] !== company_id) throw new Error('Journal belongs to a different company');
  const cash_account_id = jrn[0].default_account_id[0];

  // Create payment JE: Dr Payable / Cr Cash
  const pmtMoveId = await odoo(apiKey, 'account.move', 'create',
    [{
      move_type: 'entry',
      journal_id: journal_id,
      date: payment_date,
      ref: memo,
      company_id: company_id,
      line_ids: [
        [0, 0, { account_id: payable_account_id, partner_id, debit: amount, credit: 0, name: memo }],
        [0, 0, { account_id: cash_account_id,    partner_id, debit: 0, credit: amount, name: memo }],
      ],
    }]);
  await odoo(apiKey, 'account.move', 'action_post', [[pmtMoveId]]);

  // Reconcile new payable-debit with bill's payable-credit
  const newLines = await odoo(apiKey, 'account.move.line', 'search_read',
    [[['move_id', '=', pmtMoveId], ['account_id', '=', payable_account_id]]],
    { fields: ['id', 'debit', 'credit'] });
  const newDebit = newLines.find(l => l.debit > 0);
  if (!newDebit) throw new Error('Payment payable-debit line not found');
  await odoo(apiKey, 'account.move.line', 'reconcile', [[payableLine.id, newDebit.id]]);

  // Re-read bill to surface new state
  const after = await odoo(apiKey, 'account.move', 'read',
    [[bill_id]], { fields: ['amount_residual', 'payment_state', 'name'] });

  return {
    payment_move_id: pmtMoveId,
    bill_id, bill_ref: after?.[0]?.name,
    amount_paid: amount,
    new_residual: after?.[0]?.amount_residual ?? null,
    payment_state: after?.[0]?.payment_state ?? null,
  };
}
