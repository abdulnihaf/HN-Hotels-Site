/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Ledger — Standalone expense book (NOT linked to Odoo)
 * Route: /api/ledger
 * D1:    DB (hn-hiring) — tables: ledger_{categories,uoms,products,vendors,entries,bills}
 * Drive: env.DRIVE_WEBHOOK_LEDGER_URL (preferred) else env.DRIVE_WEBHOOK_URL
 *
 * Lives alongside /api/spend (Odoo-backed) but never touches Odoo.
 * Source of truth for every "what / how much / when / why" row Naveen enters.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── PIN scope. Initially: Nihaf + Naveen only. Others added later.
const LEDGER_USERS = {
  '0305': { name: 'Nihaf',  role: 'admin' },
  '5882': { name: 'Nihaf',  role: 'admin' },
  '3754': { name: 'Naveen', role: 'cfo'   },
};
function resolveUser(pin) { return LEDGER_USERS[pin] || null; }
function isAdminRole(user) { return user && (user.role === 'admin' || user.role === 'cfo'); }

const VALID_BRANDS  = new Set(['HE', 'NCH', 'HQ']);
const PAYMENT_MODES = [
  { key: 'cash',        label: 'Cash' },
  { key: 'hdfc',        label: 'HDFC Bank' },
  { key: 'federal',     label: 'Federal Bank' },
  { key: 'razorpay',    label: 'Razorpay' },
  { key: 'paytm',       label: 'Paytm / UPI' },
  { key: 'upi',         label: 'UPI (other)' },
  { key: 'card',        label: 'Card' },
  { key: 'other',       label: 'Other' },
];

// ── Drive sync helper — prefers a dedicated ledger webhook, falls back to
// the main one with a LEDGER_ filename prefix so bills stay distinguishable
// even in the shared folder tree.
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
    'LEDGER',
    String(brand || 'HQ').toUpperCase(),
    sanitizeBillPart(category || 'expense', 30),
    sanitizeBillPart(product || 'misc', 40),
    amount != null && !isNaN(amount) ? String(Math.round(Number(amount))) : '0',
    sanitizeBillPart(recorded_by || 'unknown', 20),
  ].filter(Boolean);
  return parts.join('_') + '.' + ext.replace(/^\./, '');
}
async function syncToDrive(env, meta) {
  const url = env.DRIVE_WEBHOOK_LEDGER_URL || env.DRIVE_WEBHOOK_URL;
  if (!url || !meta || !meta.data_b64) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    const out = await r.json().catch(() => null);
    if (!out || out.success === false) return null;
    return { file_id: out.file_id || null, view_url: out.view_url || null, path: out.path || null };
  } catch (e) { console.error('drive sync fail:', e.message); return null; }
}

// ── Helpers ──
function nowIso() { return new Date().toISOString(); }
async function getProduct(DB, id) {
  const r = await DB.prepare('SELECT * FROM ledger_products WHERE id = ?').bind(id).first();
  return r || null;
}
async function getCategory(DB, id) {
  const r = await DB.prepare('SELECT * FROM ledger_categories WHERE id = ?').bind(id).first();
  return r || null;
}

// ── Main router ──
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const DB = env.DB;
  if (!DB) return json({ success: false, error: 'D1 not bound' }, 500);

  try {
    // ────── PIN GATE ──────
    const pin = url.searchParams.get('pin') || (await safeBody(request)).pin || '';
    const user = resolveUser(pin);

    if (action === 'verify-pin') {
      if (!user) return json({ success: false, error: 'Invalid PIN' });
      const [cats, uoms] = await Promise.all([
        DB.prepare('SELECT id, name, emoji, sort_order FROM ledger_categories WHERE archived = 0 ORDER BY sort_order, name').all(),
        DB.prepare('SELECT code, label, sort_order FROM ledger_uoms WHERE archived = 0 ORDER BY sort_order, code').all(),
      ]);
      return json({
        success: true,
        user,
        categories: cats.results || [],
        uoms: uoms.results || [],
        payment_modes: PAYMENT_MODES,
        brands: ['HE', 'NCH', 'HQ'],
        can_admin: isAdminRole(user),
      });
    }

    // Every other action requires a valid PIN
    if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

    // ────── READ ACTIONS ──────
    if (action === 'list-products') {
      const catId = parseInt(url.searchParams.get('cat') || '0', 10);
      const showArchived = url.searchParams.get('include_archived') === '1';
      let q = 'SELECT id, category_id, name, default_uom, archived FROM ledger_products';
      const binds = [];
      const where = [];
      if (catId) { where.push('category_id = ?'); binds.push(catId); }
      if (!showArchived) where.push('archived = 0');
      if (where.length) q += ' WHERE ' + where.join(' AND ');
      q += ' ORDER BY name ASC LIMIT 500';
      const r = await DB.prepare(q).bind(...binds).all();
      return json({ success: true, products: r.results || [] });
    }

    if (action === 'list-vendors') {
      const r = await DB.prepare(
        'SELECT id, name, phone, notes, archived FROM ledger_vendors WHERE archived = 0 ORDER BY name ASC'
      ).all();
      return json({ success: true, vendors: r.results || [] });
    }

    if (action === 'count-drafts') {
      const r = await DB.prepare(
        "SELECT COUNT(*) AS n FROM ledger_entries WHERE status = 'draft'"
      ).first();
      return json({ success: true, count: r?.n || 0 });
    }

    if (action === 'list-entries') {
      const from   = url.searchParams.get('from') || '';
      const to     = url.searchParams.get('to') || '';
      const brand  = url.searchParams.get('brand') || '';
      const cat    = parseInt(url.searchParams.get('cat') || '0', 10);
      const status = url.searchParams.get('status') || '';
      const limit  = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 2000);

      const where = [];
      const binds = [];
      if (from)   { where.push('e.entry_date >= ?'); binds.push(from); }
      if (to)     { where.push('e.entry_date <= ?'); binds.push(to); }
      if (brand)  { where.push('e.brand = ?');       binds.push(brand); }
      if (cat)    { where.push('e.category_id = ?'); binds.push(cat); }
      if (status) { where.push('e.status = ?');      binds.push(status); }

      const sql = `
        SELECT
          e.id, e.entry_date, e.brand, e.category_id, e.product_id,
          e.quantity, e.uom, e.unit_price, e.amount,
          e.vendor_id, e.vendor_name_free, e.payment_mode,
          e.bill_number, e.voucher_number, e.notes, e.status,
          e.tally_voucher_ref, e.tally_account_name,
          e.bill_drive_view_url, e.bill_filename,
          e.recorded_by, e.recorded_at, e.updated_at,
          c.name AS category_name, c.emoji AS category_emoji,
          p.name AS product_name, p.default_uom AS product_default_uom,
          v.name AS vendor_name
        FROM ledger_entries e
        LEFT JOIN ledger_categories c ON c.id = e.category_id
        LEFT JOIN ledger_products   p ON p.id = e.product_id
        LEFT JOIN ledger_vendors    v ON v.id = e.vendor_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY e.entry_date DESC, e.id DESC
        LIMIT ?`;
      binds.push(limit);
      const r = await DB.prepare(sql).bind(...binds).all();
      return json({ success: true, entries: r.results || [] });
    }

    if (action === 'get-entry') {
      const id = parseInt(url.searchParams.get('id') || '0', 10);
      if (!id) return json({ success: false, error: 'id required' }, 400);
      const e = await DB.prepare('SELECT * FROM ledger_entries WHERE id = ?').bind(id).first();
      if (!e) return json({ success: false, error: 'not found' }, 404);
      const bills = await DB.prepare('SELECT * FROM ledger_bills WHERE entry_id = ? ORDER BY id ASC').bind(id).all();
      return json({ success: true, entry: e, bills: bills.results || [] });
    }

    if (action === 'summary') {
      // Dashboard totals — per brand / per category within window.
      const from = url.searchParams.get('from') || '2026-02-03';
      const to   = url.searchParams.get('to')   || '2026-04-01';
      const [byBrand, byCat, drafts] = await Promise.all([
        DB.prepare(`
          SELECT COALESCE(brand, 'Unassigned') AS brand,
                 COUNT(*) AS n, SUM(amount) AS total
          FROM ledger_entries WHERE entry_date BETWEEN ? AND ? AND status = 'final'
          GROUP BY brand ORDER BY total DESC`).bind(from, to).all(),
        DB.prepare(`
          SELECT c.id, c.name, c.emoji, COUNT(e.id) AS n, SUM(e.amount) AS total
          FROM ledger_categories c
          LEFT JOIN ledger_entries e
            ON e.category_id = c.id AND e.entry_date BETWEEN ? AND ? AND e.status = 'final'
          WHERE c.archived = 0
          GROUP BY c.id ORDER BY c.sort_order`).bind(from, to).all(),
        DB.prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE status = 'draft'`).first(),
      ]);
      return json({
        success: true,
        window: { from, to },
        by_brand: byBrand.results || [],
        by_category: byCat.results || [],
        drafts_pending: drafts?.n || 0,
      });
    }

    // ────── WRITE ACTIONS (entries) ──────
    const body = await safeBody(request);

    if (action === 'create-entry' || action === 'update-entry') {
      const isUpdate = action === 'update-entry';
      const id = parseInt(body.id || '0', 10);
      if (isUpdate && !id) return json({ success: false, error: 'id required' }, 400);

      // Validate required fields
      const entry_date  = String(body.entry_date || '').trim();
      const brand       = String(body.brand || '').toUpperCase().trim();
      const category_id = parseInt(body.category_id || '0', 10);
      const product_id  = parseInt(body.product_id || '0', 10);
      const quantity    = parseFloat(body.quantity);
      const uom         = String(body.uom || '').trim();
      const amount      = parseFloat(body.amount);
      const status      = (body.status === 'draft') ? 'draft' : 'final';

      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date))
        return json({ success: false, error: 'entry_date must be YYYY-MM-DD' }, 400);
      if (status === 'final' && !VALID_BRANDS.has(brand))
        return json({ success: false, error: 'brand is required to finalize (HE/NCH/HQ)' }, 400);
      if (!category_id || !product_id)
        return json({ success: false, error: 'category_id and product_id required' }, 400);
      if (isNaN(amount) || amount <= 0)
        return json({ success: false, error: 'amount must be positive' }, 400);
      // For final rows, quantity + UOM are mandatory. Draft rows may leave them blank.
      if (status === 'final') {
        if (isNaN(quantity) || quantity <= 0)
          return json({ success: false, error: 'quantity > 0 required to finalize' }, 400);
        if (!uom)
          return json({ success: false, error: 'UOM required to finalize' }, 400);
      }

      // Verify product belongs to category
      const prod = await getProduct(DB, product_id);
      if (!prod) return json({ success: false, error: 'product not found' }, 400);
      if (prod.category_id !== category_id)
        return json({ success: false, error: 'product does not belong to selected category' }, 400);

      const unit_price = (quantity > 0) ? Math.round((amount / quantity) * 100) / 100 : null;
      const vendor_id  = body.vendor_id ? parseInt(body.vendor_id, 10) : null;
      const vendor_name_free = (body.vendor_name_free || '').trim() || null;
      const payment_mode = body.payment_mode || null;
      const bill_number = (body.bill_number || '').trim() || null;
      const voucher_number = (body.voucher_number || '').trim() || null;
      const notes = (body.notes || '').trim() || null;

      // Bill photo (optional) — sync to Drive before writing the row so we
      // can persist the file_id + view_url atomically.
      let drive = null, bill_filename = null;
      if (body.bill && body.bill.data_b64) {
        const cat = await getCategory(DB, category_id);
        bill_filename = buildBillFilename({
          date: entry_date, category: cat?.name || 'expense',
          brand: brand || 'HQ', product: prod.name,
          amount, recorded_by: user.name,
          ext: (body.bill.mimetype || 'image/jpeg').split('/')[1] || 'jpg',
        });
        drive = await syncToDrive(env, {
          date: entry_date,
          company: brand || 'HQ',
          category: 'Ledger-' + (cat?.name || 'Expense').slice(0, 20),
          product: prod.name,
          amount,
          recorded_by: user.name,
          filename: bill_filename,
          mimetype: body.bill.mimetype || 'image/jpeg',
          data_b64: body.bill.data_b64,
        });
      }

      let resultId = id;
      if (isUpdate) {
        await DB.prepare(`
          UPDATE ledger_entries SET
            entry_date = ?, brand = ?, category_id = ?, product_id = ?,
            quantity = ?, uom = ?, unit_price = ?, amount = ?,
            vendor_id = ?, vendor_name_free = ?, payment_mode = ?,
            bill_number = ?, voucher_number = ?, notes = ?, status = ?,
            bill_drive_file_id = COALESCE(?, bill_drive_file_id),
            bill_drive_view_url = COALESCE(?, bill_drive_view_url),
            bill_filename = COALESCE(?, bill_filename),
            updated_at = datetime('now')
          WHERE id = ?`
        ).bind(
          entry_date, brand || null, category_id, product_id,
          quantity || 0, uom, unit_price, amount,
          vendor_id, vendor_name_free, payment_mode,
          bill_number, voucher_number, notes, status,
          drive?.file_id || null, drive?.view_url || null, bill_filename,
          id,
        ).run();
      } else {
        const ins = await DB.prepare(`
          INSERT INTO ledger_entries
            (entry_date, brand, category_id, product_id, quantity, uom, unit_price, amount,
             vendor_id, vendor_name_free, payment_mode, bill_number, voucher_number,
             notes, status, bill_drive_file_id, bill_drive_view_url, bill_filename, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          entry_date, brand || null, category_id, product_id,
          quantity || 0, uom, unit_price, amount,
          vendor_id, vendor_name_free, payment_mode,
          bill_number, voucher_number, notes, status,
          drive?.file_id || null, drive?.view_url || null, bill_filename,
          user.name,
        ).run();
        resultId = ins.meta?.last_row_id;
      }

      // Log bill into ledger_bills if we uploaded one
      if (drive && resultId) {
        try {
          await DB.prepare(`
            INSERT INTO ledger_bills
              (entry_id, drive_file_id, drive_view_url, drive_folder_path,
               filename, mimetype, file_size_kb, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            resultId, drive.file_id || null, drive.view_url || null, drive.path || null,
            bill_filename, body.bill.mimetype || 'image/jpeg',
            Math.round(((body.bill.data_b64 || '').length * 3 / 4) / 1024),
            user.name,
          ).run();
        } catch (e) { console.error('ledger_bills insert fail:', e.message); }
      }

      return json({ success: true, id: resultId, drive });
    }

    if (action === 'delete-entry') {
      if (!isAdminRole(user)) return json({ success: false, error: 'delete is admin-only' }, 403);
      const id = parseInt(body.id || '0', 10);
      if (!id) return json({ success: false, error: 'id required' }, 400);
      await DB.prepare('DELETE FROM ledger_bills WHERE entry_id = ?').bind(id).run();
      await DB.prepare('DELETE FROM ledger_entries WHERE id = ?').bind(id).run();
      return json({ success: true });
    }

    // Inline "+ Add new" for entry form — any authed user can add products/vendors/UOMs
    // from the entry modal. Admin-only actions (rename/archive cats) stay under admin-*.
    if (action === 'quick-add-product') {
      const category_id = parseInt(body.category_id || '0', 10);
      const name = String(body.name || '').trim();
      const default_uom = String(body.default_uom || '').trim() || null;
      if (!category_id || !name)
        return json({ success: false, error: 'category_id and name required' }, 400);
      const ins = await DB.prepare(`
        INSERT INTO ledger_products (category_id, name, default_uom, created_by)
        VALUES (?, ?, ?, ?)`
      ).bind(category_id, name, default_uom, user.name).run();
      return json({ success: true, product: { id: ins.meta?.last_row_id, name, category_id, default_uom } });
    }
    if (action === 'quick-add-vendor') {
      const name = String(body.name || '').trim();
      if (!name) return json({ success: false, error: 'name required' }, 400);
      const phone = (body.phone || '').trim() || null;
      const ins = await DB.prepare(
        'INSERT INTO ledger_vendors (name, phone) VALUES (?, ?)'
      ).bind(name, phone).run();
      return json({ success: true, vendor: { id: ins.meta?.last_row_id, name, phone } });
    }
    if (action === 'quick-add-uom') {
      const code = String(body.code || '').trim().toLowerCase();
      const label = String(body.label || code).trim();
      if (!code) return json({ success: false, error: 'code required' }, 400);
      await DB.prepare(
        'INSERT OR IGNORE INTO ledger_uoms (code, label, sort_order) VALUES (?, ?, 999)'
      ).bind(code, label).run();
      return json({ success: true, uom: { code, label } });
    }

    // ────── ADMIN ACTIONS ──────
    if (action?.startsWith('admin-')) {
      if (!isAdminRole(user)) return json({ success: false, error: 'admin only' }, 403);

      if (action === 'admin-overview') {
        const includeArch = url.searchParams.get('include_archived') === '1';
        const catsR = await DB.prepare(
          `SELECT id, name, emoji, sort_order, archived FROM ledger_categories
           ${includeArch ? '' : 'WHERE archived = 0'} ORDER BY sort_order, name`
        ).all();
        const prodsR = await DB.prepare(
          `SELECT id, category_id, name, default_uom, archived FROM ledger_products
           ${includeArch ? '' : 'WHERE archived = 0'} ORDER BY category_id, name`
        ).all();
        const uomsR = await DB.prepare(
          `SELECT code, label, sort_order, archived FROM ledger_uoms
           ${includeArch ? '' : 'WHERE archived = 0'} ORDER BY sort_order, code`
        ).all();
        const vendR = await DB.prepare(
          `SELECT id, name, phone, notes, archived FROM ledger_vendors
           ${includeArch ? '' : 'WHERE archived = 0'} ORDER BY name`
        ).all();
        const cats = (catsR.results || []).map(c => ({
          ...c,
          products: (prodsR.results || []).filter(p => p.category_id === c.id),
        }));
        return json({
          success: true,
          categories: cats, uoms: uomsR.results || [], vendors: vendR.results || [],
        });
      }

      if (action === 'admin-create-category') {
        const name = String(body.name || '').trim();
        const emoji = String(body.emoji || '📌').trim();
        const sort_order = parseInt(body.sort_order || '500', 10);
        if (!name) return json({ success: false, error: 'name required' }, 400);
        try {
          const ins = await DB.prepare(
            'INSERT INTO ledger_categories (name, emoji, sort_order, created_by) VALUES (?, ?, ?, ?)'
          ).bind(name, emoji, sort_order, user.name).run();
          return json({ success: true, id: ins.meta?.last_row_id });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'category name already exists' : e.message });
        }
      }
      if (action === 'admin-update-category') {
        const id = parseInt(body.id || '0', 10);
        if (!id) return json({ success: false, error: 'id required' }, 400);
        try {
          await DB.prepare(
            'UPDATE ledger_categories SET name = COALESCE(?, name), emoji = COALESCE(?, emoji), sort_order = COALESCE(?, sort_order) WHERE id = ?'
          ).bind(body.name || null, body.emoji || null, body.sort_order != null ? parseInt(body.sort_order, 10) : null, id).run();
          return json({ success: true });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'category name already exists' : e.message });
        }
      }
      if (action === 'admin-archive-category') {
        const id = parseInt(body.id || '0', 10);
        const archive = body.archive !== false ? 1 : 0;
        await DB.prepare('UPDATE ledger_categories SET archived = ? WHERE id = ?').bind(archive, id).run();
        return json({ success: true });
      }

      if (action === 'admin-create-product') {
        const category_id = parseInt(body.category_id || '0', 10);
        const name = String(body.name || '').trim();
        const default_uom = String(body.default_uom || '').trim() || null;
        if (!category_id || !name) return json({ success: false, error: 'category_id and name required' }, 400);
        try {
          const ins = await DB.prepare(
            'INSERT INTO ledger_products (category_id, name, default_uom, created_by) VALUES (?, ?, ?, ?)'
          ).bind(category_id, name, default_uom, user.name).run();
          return json({ success: true, id: ins.meta?.last_row_id });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'product already exists in this category' : e.message });
        }
      }
      if (action === 'admin-update-product') {
        const id = parseInt(body.id || '0', 10);
        if (!id) return json({ success: false, error: 'id required' }, 400);
        try {
          await DB.prepare(
            `UPDATE ledger_products
                SET name = COALESCE(?, name),
                    default_uom = COALESCE(?, default_uom),
                    category_id = COALESCE(?, category_id),
                    notes = COALESCE(?, notes)
              WHERE id = ?`
          ).bind(
            body.name || null,
            body.default_uom != null ? body.default_uom : null,
            body.category_id ? parseInt(body.category_id, 10) : null,
            body.notes != null ? body.notes : null,
            id,
          ).run();
          return json({ success: true });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'a product with that name already exists in this category' : e.message });
        }
      }
      if (action === 'admin-archive-product') {
        const id = parseInt(body.id || '0', 10);
        const archive = body.archive !== false ? 1 : 0;
        await DB.prepare('UPDATE ledger_products SET archived = ? WHERE id = ?').bind(archive, id).run();
        return json({ success: true });
      }

      if (action === 'admin-create-uom') {
        const code = String(body.code || '').trim().toLowerCase();
        const label = String(body.label || code).trim();
        const sort_order = parseInt(body.sort_order || '500', 10);
        if (!code) return json({ success: false, error: 'code required' }, 400);
        try {
          await DB.prepare(
            'INSERT INTO ledger_uoms (code, label, sort_order) VALUES (?, ?, ?)'
          ).bind(code, label, sort_order).run();
          return json({ success: true });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'uom code already exists' : e.message });
        }
      }
      if (action === 'admin-update-uom') {
        const code = String(body.code || '').trim().toLowerCase();
        if (!code) return json({ success: false, error: 'code required' }, 400);
        await DB.prepare(
          'UPDATE ledger_uoms SET label = COALESCE(?, label), sort_order = COALESCE(?, sort_order) WHERE code = ?'
        ).bind(body.label || null, body.sort_order != null ? parseInt(body.sort_order, 10) : null, code).run();
        return json({ success: true });
      }
      if (action === 'admin-archive-uom') {
        const code = String(body.code || '').trim().toLowerCase();
        const archive = body.archive !== false ? 1 : 0;
        await DB.prepare('UPDATE ledger_uoms SET archived = ? WHERE code = ?').bind(archive, code).run();
        return json({ success: true });
      }

      if (action === 'admin-create-vendor') {
        const name = String(body.name || '').trim();
        if (!name) return json({ success: false, error: 'name required' }, 400);
        try {
          const ins = await DB.prepare(
            'INSERT INTO ledger_vendors (name, phone, notes) VALUES (?, ?, ?)'
          ).bind(name, body.phone || null, body.notes || null).run();
          return json({ success: true, id: ins.meta?.last_row_id });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'vendor already exists' : e.message });
        }
      }
      if (action === 'admin-update-vendor') {
        const id = parseInt(body.id || '0', 10);
        if (!id) return json({ success: false, error: 'id required' }, 400);
        try {
          await DB.prepare(
            'UPDATE ledger_vendors SET name = COALESCE(?, name), phone = COALESCE(?, phone), notes = COALESCE(?, notes) WHERE id = ?'
          ).bind(body.name || null, body.phone != null ? body.phone : null, body.notes != null ? body.notes : null, id).run();
          return json({ success: true });
        } catch (e) {
          return json({ success: false, error: e.message.includes('UNIQUE') ? 'a vendor with that name already exists' : e.message });
        }
      }
      if (action === 'admin-archive-vendor') {
        const id = parseInt(body.id || '0', 10);
        const archive = body.archive !== false ? 1 : 0;
        await DB.prepare('UPDATE ledger_vendors SET archived = ? WHERE id = ?').bind(archive, id).run();
        return json({ success: true });
      }
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('ledger.js error:', e.message, e.stack);
    return json({ success: false, error: e.message }, 500);
  }
}

async function safeBody(request) {
  try {
    if (request.method === 'POST') {
      const t = await request.clone().text();
      if (t) return JSON.parse(t);
    }
  } catch (_) {}
  return {};
}
