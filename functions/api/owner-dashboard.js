/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Owner Finance Dashboard API
 * Route:  /api/owner-dashboard
 *
 * OWNER-ONLY — PIN gate strict. Merges:
 *   - D1 business_expenses (hr.expense mirror, cats 2-13)
 *   - Odoo purchase.order  (cat 1 RM commitments)
 *   - Odoo account.move    (cats 14, 15 vendor bills + payment state)
 *   - Odoo res.partner     (vendor enrichment)
 *   - Odoo ir.attachment   (bill photos → chatter links)
 *
 * Actions:
 *   overview         — hero KPIs, aggregations for all tabs
 *   category-items   — Level 2 drill: every product in a category + spend
 *   item-entries     — Level 3 drill: every entry for a product
 *   vendor-detail    — every bill/entry for one vendor
 *   operator-detail  — every entry by one operator
 *   photo-grid       — photos filterable by date/brand/cat/vendor
 *   po-list          — cat 1 purchase orders
 *   bill-list        — cats 14+15 vendor bills with payment state
 *   entry-detail     — single entry with full metadata + photo
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;

const OWNER_PINS = {
  '0305': { name: 'Nihaf', role: 'admin' },
  '5882': { name: 'Nihaf', role: 'admin' },
  '3754': { name: 'Naveen', role: 'cfo' },
  '6045': { name: 'Faheem', role: 'asstmgr' },
  '3678': { name: 'Faheem', role: 'asstmgr' },
};

const BRAND_COMPANY = { HE: 1, NCH: 10, HQ: 13 };
const COMPANY_BRAND = { 1: 'HE', 10: 'NCH', 13: 'HQ' };

const CAT_LABELS = {
  1: 'Kitchen RM Purchase',
  2: 'Capex',
  3: 'Salary',
  4: 'Employee Advance',
  5: 'Rent',
  6: 'Utility',
  7: 'Police / Hafta',
  8: 'Petty / Operations',
  9: 'Maintenance / Repair',
  10: 'Marketing',
  11: 'Food Supplies',
  12: 'Disposables',
  13: 'Owner Drawings',
  14: 'Direct Vendor Bill',
  15: 'Bill from PO',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function odoo(apiKey, model, method, args = [], kwargs = {}) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, apiKey, model, method, args, kwargs] },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || d.error.message || 'Odoo error');
  return d.result;
}

function companyFromBrand(brand) {
  return BRAND_COMPANY[(brand || '').toUpperCase()] || null;
}

function authGate(pin) {
  const u = OWNER_PINS[pin];
  return u || null;
}

function parseRange(url) {
  const today = new Date().toISOString().slice(0, 10);
  const from  = url.searchParams.get('from') || '2026-04-01';
  const to    = url.searchParams.get('to')   || today;
  return { from, to };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const pin = url.searchParams.get('pin');
  const user = authGate(pin);
  if (!user) return json({ success: false, error: 'Owner access required' }, 403);

  const apiKey = env.ODOO_API_KEY;
  const DB = env.DB;
  if (!DB) return json({ success: false, error: 'DB not configured' }, 500);

  const action = url.searchParams.get('action') || 'overview';
  const { from, to } = parseRange(url);
  const brand = (url.searchParams.get('brand') || 'all').toUpperCase();
  const companyId = companyFromBrand(brand);
  const brandFilter = companyId ? `AND company_id = ${companyId}` : '';

  try {
    switch (action) {
      case 'overview':         return await overview(DB, apiKey, { from, to, brand, brandFilter, companyId });
      case 'category-items':   return await categoryItems(DB, apiKey, url, { from, to, brandFilter });
      case 'item-entries':     return await itemEntries(DB, apiKey, url, { from, to, brandFilter });
      case 'vendor-detail':    return await vendorDetail(DB, apiKey, url, { from, to, brand, companyId });
      case 'operator-detail':  return await operatorDetail(DB, url, { from, to, brandFilter });
      case 'photo-grid':       return await photoGrid(DB, apiKey, url, { from, to, companyId });
      case 'po-list':          return await poList(apiKey, { from, to, companyId });
      case 'bill-list':        return await billList(apiKey, { from, to, companyId });
      case 'entry-detail':     return await entryDetail(DB, apiKey, url);
      case 'verify':           return json({ success: true, user });
      default: return json({ success: false, error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}

/* ━━━ OVERVIEW ━━━ */
async function overview(DB, apiKey, { from, to, brand, brandFilter, companyId }) {
  // 1. Hero — total expense out from D1 (hr.expense cats 2-13)
  const totalRow = await DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}`
  ).bind(from, to).first();

  const exOut = totalRow.total || 0;
  const exCount = totalRow.cnt || 0;

  // 2. By category (cats 2-13 from D1; cats 14, 15 from Odoo; cat 1 from Odoo)
  const catRows = await DB.prepare(
    `SELECT category_parent AS cat_parent, category AS cat, product_name,
            SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY category_parent, category, product_name
      ORDER BY total DESC`
  ).bind(from, to).all();

  // Aggregate by cat_parent (which is the L1 category label)
  const catMap = {};
  for (const r of (catRows.results || [])) {
    const key = r.cat_parent || r.cat || 'Other';
    if (!catMap[key]) catMap[key] = { parent: key, items: [], total: 0, count: 0 };
    catMap[key].items.push({ product: r.product_name || r.cat, amount: r.total, count: r.cnt });
    catMap[key].total += r.total;
    catMap[key].count += r.cnt;
  }
  const byCategory = Object.values(catMap).sort((a, b) => b.total - a.total);

  // 3. Add cats 1, 14, 15 via Odoo (POs + bills)
  let poTotal = 0, poCount = 0, billsTotal = 0, billsCount = 0, outstandingTotal = 0;
  try {
    if (apiKey) {
      const poDomain = [['date_order', '>=', from], ['date_order', '<=', `${to} 23:59:59`], ['state', 'in', ['purchase', 'done']]];
      if (companyId) poDomain.push(['company_id', '=', companyId]);
      const pos = await odoo(apiKey, 'purchase.order', 'read_group',
        [poDomain, ['amount_total:sum'], []]);
      if (pos && pos[0]) { poTotal = pos[0].amount_total || 0; poCount = pos[0].__count || 0; }

      const billDomain = [['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to], ['state', '=', 'posted']];
      if (companyId) billDomain.push(['company_id', '=', companyId]);
      const bills = await odoo(apiKey, 'account.move', 'read_group',
        [billDomain, ['amount_total:sum'], []]);
      if (bills && bills[0]) { billsTotal = bills[0].amount_total || 0; billsCount = bills[0].__count || 0; }

      const unpaidDomain = [['move_type', '=', 'in_invoice'], ['payment_state', 'in', ['not_paid', 'partial']], ['state', '=', 'posted']];
      if (companyId) unpaidDomain.push(['company_id', '=', companyId]);
      const unpaid = await odoo(apiKey, 'account.move', 'read_group',
        [unpaidDomain, ['amount_residual:sum'], []]);
      if (unpaid && unpaid[0]) outstandingTotal = unpaid[0].amount_residual || 0;
    }
  } catch (e) { console.error('Odoo overview fail:', e.message); }

  // 4. Top vendors (from bills + POs + partner lookup)
  let topVendors = [];
  try {
    if (apiKey) {
      const bvDomain = [['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to], ['state', '=', 'posted']];
      if (companyId) bvDomain.push(['company_id', '=', companyId]);
      const byVendor = await odoo(apiKey, 'account.move', 'read_group',
        [bvDomain, ['amount_total:sum', 'partner_id'], ['partner_id']], { orderby: 'amount_total desc', limit: 20 });
      topVendors = (byVendor || []).map(v => ({
        vendor_id: v.partner_id?.[0],
        vendor_name: v.partner_id?.[1] || 'Unknown',
        total: v.amount_total || 0,
        count: v.__count || 0,
      })).filter(v => v.vendor_id);
    }
  } catch (e) { console.error('vendor rollup fail:', e.message); }

  // 5. By operator (from D1)
  const opRows = await DB.prepare(
    `SELECT recorded_by, SUM(amount) AS total, COUNT(*) AS cnt,
            MAX(recorded_at) AS last_entry,
            MIN(recorded_at) AS first_entry
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY recorded_by
      ORDER BY total DESC`
  ).bind(from, to).all();

  // 6. By payment method
  const payRows = await DB.prepare(
    `SELECT COALESCE(x_payment_method, payment_mode) AS method,
            SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY method
      ORDER BY total DESC`
  ).bind(from, to).all();

  // 7. Daily series (for chart)
  const dailyRows = await DB.prepare(
    `SELECT DATE(recorded_at) AS day, SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      GROUP BY day
      ORDER BY day ASC`
  ).bind(from, to).all();

  // 8. Recent feed (last 30)
  const feed = await DB.prepare(
    `SELECT id, odoo_id, amount, product_name, category, category_parent,
            company_id, x_payment_method, recorded_by, recorded_at, notes
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day') ${brandFilter}
      ORDER BY recorded_at DESC LIMIT 30`
  ).bind(from, to).all();

  // 9. Brand split
  const brandRows = await DB.prepare(
    `SELECT company_id, SUM(amount) AS total, COUNT(*) AS cnt
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day')
      GROUP BY company_id`
  ).bind(from, to).all();

  const byBrand = (brandRows.results || []).map(r => ({
    brand: COMPANY_BRAND[r.company_id] || 'Other',
    total: r.total, count: r.cnt,
  }));

  return json({
    success: true,
    range: { from, to, brand },
    hero: {
      expense_total: Math.round(exOut),
      expense_count: exCount,
      po_total: Math.round(poTotal),
      po_count: poCount,
      bills_total: Math.round(billsTotal),
      bills_count: billsCount,
      outstanding_total: Math.round(outstandingTotal),
      grand_total_out: Math.round(exOut + billsTotal),
    },
    by_brand: byBrand,
    by_category: byCategory,
    by_vendor_top20: topVendors,
    by_operator: (opRows.results || []).map(r => ({
      name: r.recorded_by, total: r.total, count: r.cnt,
      first_entry: r.first_entry, last_entry: r.last_entry,
    })),
    by_payment_method: (payRows.results || []).map(r => ({
      method: r.method, total: r.total, count: r.cnt,
    })),
    daily_series: (dailyRows.results || []).map(r => ({ date: r.day, total: r.total, count: r.cnt })),
    recent_feed: (feed.results || []).map(r => ({
      id: r.id,
      odoo_id: r.odoo_id,
      date: r.recorded_at?.slice(0, 10),
      brand: COMPANY_BRAND[r.company_id] || '—',
      category: r.category_parent || r.category,
      product: r.product_name,
      amount: r.amount,
      operator: r.recorded_by,
      payment_method: r.x_payment_method,
      notes: r.notes || '',
      odoo_url: r.odoo_id ? `https://odoo.hnhotels.in/web#id=${r.odoo_id}&model=hr.expense&view_type=form` : null,
    })),
  });
}

/* ━━━ DRILL: Category → Items ━━━ */
async function categoryItems(DB, apiKey, url, { from, to, brandFilter }) {
  const catParent = url.searchParams.get('cat_parent') || '';
  if (!catParent) return json({ success: false, error: 'cat_parent required' }, 400);

  const rows = await DB.prepare(
    `SELECT product_name, product_id,
            SUM(amount) AS total, COUNT(*) AS cnt,
            MAX(recorded_at) AS last_recorded
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day')
        AND category_parent = ? ${brandFilter}
      GROUP BY product_name, product_id
      ORDER BY total DESC`
  ).bind(from, to, catParent).all();

  // Vendor distribution per item — need to go to Odoo for vendor_id
  // For now, skip — v2 will add vendor enrichment per line.

  return json({
    success: true,
    cat_parent: catParent,
    items: (rows.results || []).map(r => ({
      product_id: r.product_id,
      product_name: r.product_name,
      total: r.total,
      count: r.cnt,
      last_recorded: r.last_recorded,
    })),
  });
}

/* ━━━ DRILL: Item → Entries ━━━ */
async function itemEntries(DB, apiKey, url, { from, to, brandFilter }) {
  const productName = url.searchParams.get('product_name') || '';
  if (!productName) return json({ success: false, error: 'product_name required' }, 400);

  const rows = await DB.prepare(
    `SELECT id, odoo_id, amount, company_id, x_payment_method, recorded_by,
            recorded_at, notes, category_parent
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day')
        AND product_name = ? ${brandFilter}
      ORDER BY recorded_at DESC`
  ).bind(from, to, productName).all();

  // Enrich: pull attachments from Odoo in one shot
  const odooIds = (rows.results || []).map(r => r.odoo_id).filter(Boolean);
  let attachments = {};
  try {
    if (apiKey && odooIds.length) {
      const atts = await odoo(apiKey, 'ir.attachment', 'search_read',
        [[['res_model', '=', 'hr.expense'], ['res_id', 'in', odooIds]]],
        { fields: ['id', 'res_id', 'name', 'mimetype'] });
      for (const a of atts) {
        if (!attachments[a.res_id]) attachments[a.res_id] = [];
        attachments[a.res_id].push({ id: a.id, name: a.name, mimetype: a.mimetype });
      }
    }
  } catch (e) { console.error('attachment fetch:', e.message); }

  return json({
    success: true,
    product_name: productName,
    entries: (rows.results || []).map(r => ({
      id: r.id,
      odoo_id: r.odoo_id,
      date: r.recorded_at?.slice(0, 10),
      recorded_at: r.recorded_at,
      brand: COMPANY_BRAND[r.company_id] || '—',
      amount: r.amount,
      payment_method: r.x_payment_method,
      operator: r.recorded_by,
      notes: r.notes,
      category: r.category_parent,
      attachments: attachments[r.odoo_id] || [],
      odoo_url: r.odoo_id ? `https://odoo.hnhotels.in/web#id=${r.odoo_id}&model=hr.expense&view_type=form` : null,
    })),
  });
}

/* ━━━ DRILL: Vendor → bills ━━━ */
async function vendorDetail(DB, apiKey, url, { from, to, brand, companyId }) {
  const vendorId = parseInt(url.searchParams.get('vendor_id'), 10);
  if (!vendorId) return json({ success: false, error: 'vendor_id required' }, 400);
  if (!apiKey) return json({ success: false, error: 'Odoo not configured' }, 500);

  // Vendor info
  const vend = await odoo(apiKey, 'res.partner', 'read',
    [[vendorId]], { fields: ['id', 'name', 'phone', 'email', 'vat'] });
  if (!vend || !vend.length) return json({ success: false, error: 'Vendor not found' }, 404);

  // All bills
  const billDomain = [['move_type', '=', 'in_invoice'], ['partner_id', '=', vendorId],
                     ['invoice_date', '>=', from], ['invoice_date', '<=', to]];
  if (companyId) billDomain.push(['company_id', '=', companyId]);
  const bills = await odoo(apiKey, 'account.move', 'search_read', [billDomain],
    { fields: ['id', 'name', 'ref', 'invoice_date', 'amount_total', 'amount_residual',
               'payment_state', 'state', 'company_id', 'invoice_origin', 'narration',
               'x_recorded_by_user_id'],
      order: 'invoice_date desc', limit: 500 });

  // All POs
  const poDomain = [['partner_id', '=', vendorId], ['date_order', '>=', from], ['date_order', '<=', `${to} 23:59:59`]];
  if (companyId) poDomain.push(['company_id', '=', companyId]);
  const pos = await odoo(apiKey, 'purchase.order', 'search_read', [poDomain],
    { fields: ['id', 'name', 'date_order', 'amount_total', 'state', 'company_id'],
      order: 'date_order desc', limit: 200 });

  // All hr.expense with vendor_id (if stored)
  // Note: vendor_id on hr.expense was added this session; older rows don't have it.
  // Use D1 mirror if indexable, else fall through.

  const totalBilled = bills.reduce((s, b) => s + (b.amount_total || 0), 0);
  const totalOutstanding = bills.reduce((s, b) => s + (b.amount_residual || 0), 0);

  return json({
    success: true,
    vendor: vend[0],
    summary: {
      bills_total: Math.round(totalBilled),
      bills_count: bills.length,
      outstanding: Math.round(totalOutstanding),
      po_total: Math.round(pos.reduce((s, p) => s + (p.amount_total || 0), 0)),
      po_count: pos.length,
    },
    bills: bills.map(b => ({
      id: b.id, name: b.name, ref: b.ref,
      date: b.invoice_date,
      brand: COMPANY_BRAND[b.company_id?.[0]] || '—',
      amount: b.amount_total,
      outstanding: b.amount_residual,
      state: b.state,
      payment_state: b.payment_state,
      origin: b.invoice_origin,
      notes: b.narration,
      odoo_url: `https://odoo.hnhotels.in/web#id=${b.id}&model=account.move&view_type=form`,
    })),
    pos: pos.map(p => ({
      id: p.id, name: p.name,
      date: p.date_order?.slice(0, 10),
      brand: COMPANY_BRAND[p.company_id?.[0]] || '—',
      amount: p.amount_total,
      state: p.state,
      odoo_url: `https://odoo.hnhotels.in/web#id=${p.id}&model=purchase.order&view_type=form`,
    })),
  });
}

/* ━━━ DRILL: Operator → activity ━━━ */
async function operatorDetail(DB, url, { from, to, brandFilter }) {
  const operator = url.searchParams.get('operator') || '';
  if (!operator) return json({ success: false, error: 'operator required' }, 400);

  const rows = await DB.prepare(
    `SELECT id, odoo_id, amount, category, category_parent, product_name,
            company_id, x_payment_method, recorded_at, notes
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day')
        AND recorded_by = ? ${brandFilter}
      ORDER BY recorded_at DESC`
  ).bind(from, to, operator).all();

  return json({
    success: true,
    operator,
    total: (rows.results || []).reduce((s, r) => s + r.amount, 0),
    count: (rows.results || []).length,
    entries: (rows.results || []).map(r => ({
      id: r.id,
      odoo_id: r.odoo_id,
      date: r.recorded_at?.slice(0, 10),
      recorded_at: r.recorded_at,
      amount: r.amount,
      product: r.product_name,
      category: r.category_parent || r.category,
      brand: COMPANY_BRAND[r.company_id] || '—',
      payment_method: r.x_payment_method,
      notes: r.notes,
      odoo_url: r.odoo_id ? `https://odoo.hnhotels.in/web#id=${r.odoo_id}&model=hr.expense&view_type=form` : null,
    })),
  });
}

/* ━━━ PHOTO GRID ━━━ */
async function photoGrid(DB, apiKey, url, { from, to, companyId }) {
  if (!apiKey) return json({ success: true, photos: [] });

  // Pull D1 entries in range for context
  const brandFilter = companyId ? `AND company_id = ${companyId}` : '';
  const entries = await DB.prepare(
    `SELECT id, odoo_id, amount, product_name, category_parent, company_id,
            recorded_by, recorded_at
       FROM business_expenses
      WHERE recorded_at >= ? AND recorded_at < datetime(?, '+1 day')
        AND odoo_id IS NOT NULL ${brandFilter}
      ORDER BY recorded_at DESC LIMIT 300`
  ).bind(from, to).all();

  const odooIds = (entries.results || []).map(r => r.odoo_id).filter(Boolean);
  if (!odooIds.length) return json({ success: true, photos: [] });

  const atts = await odoo(apiKey, 'ir.attachment', 'search_read',
    [[['res_model', '=', 'hr.expense'], ['res_id', 'in', odooIds],
      ['mimetype', 'like', 'image/']]],
    { fields: ['id', 'res_id', 'name', 'mimetype', 'file_size'], limit: 500 });

  const byExpId = {};
  for (const a of atts) {
    if (!byExpId[a.res_id]) byExpId[a.res_id] = a;  // keep first
  }

  const photos = (entries.results || []).filter(e => byExpId[e.odoo_id]).map(e => ({
    entry_id: e.id,
    odoo_id: e.odoo_id,
    attachment_id: byExpId[e.odoo_id].id,
    attachment_name: byExpId[e.odoo_id].name,
    date: e.recorded_at?.slice(0, 10),
    brand: COMPANY_BRAND[e.company_id] || '—',
    category: e.category_parent,
    product: e.product_name,
    amount: e.amount,
    operator: e.recorded_by,
    // Image URL via Odoo web (authenticated access in browser with cookie)
    preview_url: `https://odoo.hnhotels.in/web/image/${byExpId[e.odoo_id].id}`,
    odoo_url: `https://odoo.hnhotels.in/web#id=${e.odoo_id}&model=hr.expense&view_type=form`,
  }));

  return json({ success: true, photos, missing_count: (entries.results || []).length - photos.length });
}

/* ━━━ PO LIST (cat 1) ━━━ */
async function poList(apiKey, { from, to, companyId }) {
  if (!apiKey) return json({ success: false, error: 'Odoo not configured' }, 500);
  const domain = [['date_order', '>=', from], ['date_order', '<=', `${to} 23:59:59`]];
  if (companyId) domain.push(['company_id', '=', companyId]);
  const pos = await odoo(apiKey, 'purchase.order', 'search_read', [domain],
    { fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'company_id', 'invoice_status'],
      order: 'date_order desc', limit: 300 });
  return json({
    success: true,
    pos: pos.map(p => ({
      id: p.id, name: p.name,
      vendor: p.partner_id?.[1] || '—',
      vendor_id: p.partner_id?.[0],
      date: p.date_order?.slice(0, 10),
      brand: COMPANY_BRAND[p.company_id?.[0]] || '—',
      amount: p.amount_total,
      state: p.state,
      invoice_status: p.invoice_status,
      odoo_url: `https://odoo.hnhotels.in/web#id=${p.id}&model=purchase.order&view_type=form`,
    })),
  });
}

/* ━━━ BILL LIST (cats 14, 15) ━━━ */
async function billList(apiKey, { from, to, companyId }) {
  if (!apiKey) return json({ success: false, error: 'Odoo not configured' }, 500);
  const domain = [['move_type', '=', 'in_invoice'], ['invoice_date', '>=', from], ['invoice_date', '<=', to]];
  if (companyId) domain.push(['company_id', '=', companyId]);
  const bills = await odoo(apiKey, 'account.move', 'search_read', [domain],
    { fields: ['id', 'name', 'ref', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual',
               'state', 'payment_state', 'invoice_origin', 'company_id'],
      order: 'invoice_date desc', limit: 500 });
  return json({
    success: true,
    bills: bills.map(b => ({
      id: b.id, name: b.name, ref: b.ref,
      vendor: b.partner_id?.[1] || '—',
      vendor_id: b.partner_id?.[0],
      date: b.invoice_date,
      brand: COMPANY_BRAND[b.company_id?.[0]] || '—',
      amount: b.amount_total,
      outstanding: b.amount_residual,
      state: b.state,
      payment_state: b.payment_state,
      origin: b.invoice_origin,
      odoo_url: `https://odoo.hnhotels.in/web#id=${b.id}&model=account.move&view_type=form`,
    })),
  });
}

/* ━━━ ENTRY DETAIL ━━━ */
async function entryDetail(DB, apiKey, url) {
  const entryId = parseInt(url.searchParams.get('entry_id'), 10);
  if (!entryId) return json({ success: false, error: 'entry_id required' }, 400);

  const r = await DB.prepare(
    `SELECT * FROM business_expenses WHERE id = ?`
  ).bind(entryId).first();
  if (!r) return json({ success: false, error: 'Entry not found' }, 404);

  let attachments = [];
  if (apiKey && r.odoo_id) {
    try {
      attachments = await odoo(apiKey, 'ir.attachment', 'search_read',
        [[['res_model', '=', 'hr.expense'], ['res_id', '=', r.odoo_id]]],
        { fields: ['id', 'name', 'mimetype', 'file_size'] });
    } catch (e) { console.error('att fetch:', e.message); }
  }

  return json({
    success: true,
    entry: {
      ...r,
      brand: COMPANY_BRAND[r.company_id] || '—',
      attachments: attachments.map(a => ({
        id: a.id, name: a.name, mimetype: a.mimetype, size: a.file_size,
        preview_url: `https://odoo.hnhotels.in/web/image/${a.id}`,
        download_url: `https://odoo.hnhotels.in/web/content/${a.id}?download=true`,
      })),
      odoo_url: r.odoo_id ? `https://odoo.hnhotels.in/web#id=${r.odoo_id}&model=hr.expense&view_type=form` : null,
    },
  });
}
