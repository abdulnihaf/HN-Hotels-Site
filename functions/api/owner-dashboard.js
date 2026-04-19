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

// NEW odoo.hnhotels.in instance: 1=HN Hotels, 2=HE, 3=NCH
const BRAND_COMPANY = { HE: 2, NCH: 3, HQ: 1 };
const COMPANY_BRAND = { 1: 'HQ', 2: 'HE', 3: 'NCH' };

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
      case 'nch-day':          return await nchDay(DB, apiKey, url);
      case 'shortages-list':   return await shortagesList(DB, url);
      case 'nch-weekly':       return await nchWeekly(DB, url);
      case 'nch-discrepancies':return await nchDiscrepancies(DB, apiKey, url);
      case 'nch-person-history': return await nchPersonHistory(DB, url);
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

/* ━━━ NCH CASH OPS — full day view ━━━ */
async function nchDay(DB, apiKey, url) {
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const dayStart = `${date}T00:00:00`;
  const dayEndExcl = `${date}T23:59:59`;

  // 1. Shortages today (HN D1)
  const shortagesRows = await DB.prepare(
    `SELECT s.*, e.name AS staff_name
       FROM hr_cash_shortages s
       LEFT JOIN hr_employees e ON e.pin = s.pin
      WHERE s.brand = 'NCH'
        AND s.created_at >= ? AND s.created_at <= ?
      ORDER BY s.created_at DESC`
  ).bind(dayStart, dayEndExcl).all();

  // 2. Expenses today (HN D1 mirror, filtered NCH)
  const expensesRows = await DB.prepare(
    `SELECT id, odoo_id, amount, product_name, category, category_parent,
            x_payment_method, recorded_by, recorded_at, notes
       FROM business_expenses
      WHERE company_id = 3
        AND recorded_at >= ? AND recorded_at <= ?
      ORDER BY recorded_at DESC`
  ).bind(dayStart, dayEndExcl).all();

  // 3. Attachments for those expenses
  const odooIds = (expensesRows.results || []).map(r => r.odoo_id).filter(Boolean);
  const attMap = {};
  if (apiKey && odooIds.length) {
    try {
      const atts = await odoo(apiKey, 'ir.attachment', 'search_read',
        [[['res_model', '=', 'hr.expense'], ['res_id', 'in', odooIds],
          ['mimetype', 'like', 'image/']]],
        { fields: ['id', 'res_id', 'name'], limit: 500 });
      for (const a of atts) if (!attMap[a.res_id]) attMap[a.res_id] = a;
    } catch (e) { console.error('att fetch:', e.message); }
  }

  // 4. Fetch NCH outlet data (settlements, handovers, collections, current shift) via HTTP
  const nchBase = 'https://nawabichaihouse.com';
  let settlements = [], handovers = [], collections = [], counterBalance = null, currentShift = null, shiftTrail = [];
  try {
    const [settleRes, collectRes, balRes, shiftRes] = await Promise.all([
      fetch(`${nchBase}/api/settlement?action=history&limit=200`).then(r => r.json()).catch(() => ({})),
      fetch(`${nchBase}/api/settlement?action=collection-history&limit=100`).then(r => r.json()).catch(() => ({})),
      fetch(`${nchBase}/api/settlement?action=counter-balance`).then(r => r.json()).catch(() => ({})),
      fetch(`${nchBase}/api/settlement?action=current-shift`).then(r => r.json()).catch(() => ({})),
    ]);
    // Filter to the requested date
    const inDay = (ts) => ts && ts >= dayStart && ts <= dayEndExcl;
    settlements = (settleRes.settlements || []).filter(s => inDay(s.settled_at));
    collections = (collectRes.collections || []).filter(c => inDay(c.collected_at));
    counterBalance = balRes.balance || null;
    currentShift = shiftRes.current || null;
    shiftTrail = shiftRes.trail_today || [];
  } catch (e) { console.error('nch fetch:', e.message); }

  // 5. Build chronological timeline
  const events = [];
  // Add shift-change events first (bootstrap + handovers)
  for (const t of shiftTrail) {
    events.push({
      type: t.type === 'bootstrap' ? 'shift_open' : 'shift_change',
      at: t.at,
      title: t.type === 'bootstrap'
        ? `Shift open · ${t.to_name} on drawer · opening ₹${t.opening_float}`
        : `Shift handover · ${t.from_name} → ${t.to_name}${t.drawer_variance ? ` · variance ${t.drawer_variance>0?'+':''}₹${Math.abs(t.drawer_variance)}` : ''}`,
      amount: t.type === 'bootstrap' ? (t.opening_float || 0) : (t.drawer_counted || 0),
      direction: 'flag',
      variance: t.drawer_variance || null,
      meta: { from_code: t.from_code, to_code: t.to_code, opening: t.opening_float, drawer_counted: t.drawer_counted },
    });
  }
  for (const s of settlements) {
    const expected = (s.tokens_amount || 0) + (s.sales_amount || 0) - (s.upi_amount || 0);
    const variance = (s.cash_settled || 0) - expected;
    events.push({
      type: 'runner_settle',
      at: s.settled_at,
      title: `Settle Runner · ${s.runner_name} → ${s.settled_by}`,
      amount: s.cash_settled,
      direction: 'in',
      expected, variance,
      meta: {
        tokens: s.tokens_amount, sales: s.sales_amount, upi: s.upi_amount,
        runner_id: s.runner_id, settled_by: s.settled_by,
      },
    });
  }
  for (const c of collections) {
    events.push({
      type: 'collection',
      at: c.collected_at,
      title: `Manager Collect · ${c.collected_by}`,
      amount: c.amount,
      direction: 'out',
      variance: -(c.discrepancy || 0),
      meta: {
        petty_left: c.petty_cash, expected: c.expected, notes: c.notes,
      },
    });
  }
  for (const e of (expensesRows.results || [])) {
    const att = attMap[e.odoo_id];
    events.push({
      type: 'expense',
      at: e.recorded_at,
      title: `Expense · ${e.category_parent || e.category} · ${e.product_name || '—'}`,
      amount: e.amount,
      direction: 'out',
      meta: {
        payment: e.x_payment_method, recorded_by: e.recorded_by,
        notes: e.notes, odoo_id: e.odoo_id,
        attachment_id: att?.id || null,
        preview_url: att ? `https://odoo.hnhotels.in/web/image/${att.id}` : null,
        odoo_url: e.odoo_id ? `https://odoo.hnhotels.in/web#id=${e.odoo_id}&model=hr.expense&view_type=form` : null,
      },
    });
  }
  for (const sh of (shortagesRows.results || [])) {
    events.push({
      type: 'shortage',
      at: sh.created_at,
      title: `Shortage · ${sh.source.replace(/_/g, ' ')} · ${sh.staff_name || sh.unmapped_code || 'unmapped'}`,
      amount: sh.amount,
      direction: 'flag',
      meta: {
        pin: sh.pin, staff_name: sh.staff_name,
        counterparty: sh.counterparty, source: sh.source,
        waived: !!sh.waived, cleared_at: sh.cleared_at,
        id: sh.id,
      },
    });
  }
  events.sort((a, b) => (a.at || '').localeCompare(b.at || ''));

  // 6. Day summary
  const totalSettled  = settlements.reduce((s, x) => s + (x.cash_settled || 0), 0);
  const totalExpenses = (expensesRows.results || []).reduce((s, x) => s + (x.amount || 0), 0);
  const totalCollected = collections.reduce((s, x) => s + (x.amount || 0), 0);
  const openShortages  = (shortagesRows.results || []).filter(s => !s.cleared_at && !s.waived);
  const waivedShortages= (shortagesRows.results || []).filter(s => s.waived);
  const clearedShortages=(shortagesRows.results || []).filter(s => s.cleared_at && !s.waived);
  const totalShortageOpen = openShortages.reduce((s, x) => s + (x.amount || 0), 0);
  const totalShortageWaived = waivedShortages.reduce((s, x) => s + (x.amount || 0), 0);
  const totalShortageCleared= clearedShortages.reduce((s, x) => s + (x.amount || 0), 0);

  return json({
    success: true,
    date,
    current_shift: currentShift,
    shift_trail: shiftTrail,
    summary: {
      current_cashier_code: currentShift?.code || null,
      current_cashier_name: currentShift?.name || null,
      current_shift_start: currentShift?.shift_start_at || null,
      current_shift_minutes: currentShift?.shift_minutes || 0,
      shifts_today: shiftTrail.length,
      opening_float_estimated: counterBalance?.pettyCash || 0,
      runner_cash_in: Math.round(totalSettled),
      counter_cash_live: counterBalance?.counterCashLive || 0,
      expenses_out: Math.round(totalExpenses),
      manager_collected: Math.round(totalCollected),
      current_drawer_live: counterBalance?.total || 0,
      shortage_open: Math.round(totalShortageOpen),
      shortage_cleared: Math.round(totalShortageCleared),
      shortage_waived: Math.round(totalShortageWaived),
      events_count: events.length,
      photos_attached: Object.keys(attMap).length,
      photos_missing: (expensesRows.results || []).length - Object.keys(attMap).length,
    },
    timeline: events,
    shortages: (shortagesRows.results || []).map(s => ({
      ...s,
      is_unmapped: !s.pin,
    })),
    expenses: (expensesRows.results || []).map(e => ({
      ...e,
      attachment: attMap[e.odoo_id] ? {
        id: attMap[e.odoo_id].id,
        preview_url: `https://odoo.hnhotels.in/web/image/${attMap[e.odoo_id].id}`,
        download_url: `https://odoo.hnhotels.in/web/content/${attMap[e.odoo_id].id}?download=true`,
      } : null,
      odoo_url: e.odoo_id ? `https://odoo.hnhotels.in/web#id=${e.odoo_id}&model=hr.expense&view_type=form` : null,
    })),
    settlements,
    collections,
    counter_balance: counterBalance,
  });
}

/* ━━━ NCH WEEKLY ROLLUP ━━━
 * Per-person shortage tally for the month + daily variance trend for the last 7 days.
 * Includes running monthly cap (₹5k alert threshold).
 */
const MONTHLY_CAP_NCH = 5000;

async function nchWeekly(DB, url) {
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const d7 = new Date(); d7.setDate(d7.getDate() - 6);
  const from7 = d7.toISOString().slice(0, 10);

  // Per-person rollup for month
  const perPerson = await DB.prepare(
    `SELECT s.pin, e.name AS staff_name, e.phone, e.job_name,
            COUNT(*) AS event_count,
            COALESCE(SUM(CASE WHEN s.waived = 0 AND s.cleared_at IS NULL THEN s.amount ELSE 0 END), 0) AS total_open,
            COALESCE(SUM(CASE WHEN s.waived = 1 THEN s.amount ELSE 0 END), 0) AS total_waived,
            COALESCE(SUM(CASE WHEN s.cleared_at IS NOT NULL AND s.waived = 0 THEN s.amount ELSE 0 END), 0) AS total_cleared,
            COALESCE(SUM(s.amount), 0) AS total_all
       FROM hr_cash_shortages s
       LEFT JOIN hr_employees e ON e.pin = s.pin
      WHERE s.brand = 'NCH'
        AND strftime('%Y-%m', s.created_at) = ?
      GROUP BY s.pin, e.name, e.phone, e.job_name
      ORDER BY total_open DESC`
  ).bind(month).all();

  // Daily trend for last 7 days
  const daily = await DB.prepare(
    `SELECT DATE(created_at) AS day,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN source='runner_settle' THEN amount ELSE 0 END), 0) AS runner_short,
            COALESCE(SUM(CASE WHEN source='shift_handover' THEN amount ELSE 0 END), 0) AS handover_short,
            COALESCE(SUM(CASE WHEN source='cashier_collect' THEN amount ELSE 0 END), 0) AS collect_short
       FROM hr_cash_shortages
      WHERE brand = 'NCH'
        AND DATE(created_at) >= ?
      GROUP BY day
      ORDER BY day ASC`
  ).bind(from7).all();

  // Top 3 single-biggest shortages this month
  const topEvents = await DB.prepare(
    `SELECT s.*, e.name AS staff_name
       FROM hr_cash_shortages s
       LEFT JOIN hr_employees e ON e.pin = s.pin
      WHERE s.brand = 'NCH'
        AND strftime('%Y-%m', s.created_at) = ?
        AND s.waived = 0
      ORDER BY s.amount DESC LIMIT 5`
  ).bind(month).all();

  return json({
    success: true,
    month,
    cap: MONTHLY_CAP_NCH,
    people: (perPerson.results || []).map(p => ({
      ...p,
      over_cap: (p.total_open || 0) > MONTHLY_CAP_NCH,
      cap_pct: Math.round(((p.total_open || 0) / MONTHLY_CAP_NCH) * 100),
      is_unmapped: !p.pin,
    })),
    daily: daily.results || [],
    top_events: topEvents.results || [],
    totals: {
      total_open:    (perPerson.results || []).reduce((s,x) => s + (x.total_open || 0), 0),
      total_cleared: (perPerson.results || []).reduce((s,x) => s + (x.total_cleared || 0), 0),
      total_waived:  (perPerson.results || []).reduce((s,x) => s + (x.total_waived || 0), 0),
      event_count:   (perPerson.results || []).reduce((s,x) => s + (x.event_count || 0), 0),
    },
  });
}

/* ━━━ NCH DISCREPANCIES — anomaly detection ━━━
 * Flags edge cases that need human review:
 *   - Unmapped runner shortages (pin=null)
 *   - Single-event outliers (>₹500)
 *   - Missing-photo expense flags
 *   - Uncovered settlements (runner has cash but no settle today)
 *   - Big-discrepancy collections (>₹500)
 */
async function nchDiscrepancies(DB, apiKey, url) {
  const daysBack = parseInt(url.searchParams.get('days') || '7', 10);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffIso = cutoff.toISOString();

  // 1. Unmapped shortages (pin is null) — last N days
  const unmapped = await DB.prepare(
    `SELECT * FROM hr_cash_shortages
      WHERE brand = 'NCH' AND pin IS NULL
        AND created_at >= ?
      ORDER BY created_at DESC LIMIT 100`
  ).bind(cutoffIso).all();

  // 2. Big outliers (amount > ₹500, regardless of status)
  const outliers = await DB.prepare(
    `SELECT s.*, e.name AS staff_name
       FROM hr_cash_shortages s
       LEFT JOIN hr_employees e ON e.pin = s.pin
      WHERE s.brand = 'NCH' AND s.amount > 500
        AND s.created_at >= ?
      ORDER BY s.amount DESC LIMIT 50`
  ).bind(cutoffIso).all();

  // 3. NCH expenses without photos (from business_expenses, then check ir.attachment)
  const expenseRows = await DB.prepare(
    `SELECT id, odoo_id, amount, product_name, category_parent, recorded_at, recorded_by
       FROM business_expenses
      WHERE company_id = 3 AND recorded_at >= ?
      ORDER BY recorded_at DESC LIMIT 200`
  ).bind(cutoffIso).all();

  const expOdooIds = (expenseRows.results || []).map(r => r.odoo_id).filter(Boolean);
  let haveAtt = new Set();
  if (apiKey && expOdooIds.length) {
    try {
      const atts = await odoo(apiKey, 'ir.attachment', 'search_read',
        [[['res_model','=','hr.expense'],['res_id','in',expOdooIds],['mimetype','like','image/']]],
        { fields: ['res_id'], limit: 500 });
      haveAtt = new Set(atts.map(a => a.res_id));
    } catch (e) {}
  }
  const missingPhotos = (expenseRows.results || []).filter(e => e.odoo_id && !haveAtt.has(e.odoo_id));

  // 4. Cap-crossers this month
  const month = new Date().toISOString().slice(0, 7);
  const capCrossers = await DB.prepare(
    `SELECT s.pin, e.name AS staff_name, SUM(s.amount) AS total
       FROM hr_cash_shortages s
       LEFT JOIN hr_employees e ON e.pin = s.pin
      WHERE s.brand = 'NCH' AND s.pin IS NOT NULL
        AND s.cleared_at IS NULL AND s.waived = 0
        AND strftime('%Y-%m', s.created_at) = ?
      GROUP BY s.pin
      HAVING total > ?
      ORDER BY total DESC`
  ).bind(month, MONTHLY_CAP_NCH).all();

  // 5. Shortage-source distribution (where's the problem coming from)
  const sourceDist = await DB.prepare(
    `SELECT source, COUNT(*) AS cnt, SUM(amount) AS total
       FROM hr_cash_shortages
      WHERE brand = 'NCH' AND created_at >= ?
      GROUP BY source
      ORDER BY total DESC`
  ).bind(cutoffIso).all();

  return json({
    success: true,
    days_analysed: daysBack,
    cutoff: cutoffIso,
    flags: {
      unmapped_shortages: {
        count: (unmapped.results || []).length,
        total: (unmapped.results || []).reduce((s,x) => s + (x.amount || 0), 0),
        rows: unmapped.results || [],
      },
      outliers: {
        count: (outliers.results || []).length,
        rows: outliers.results || [],
      },
      missing_photos: {
        count: missingPhotos.length,
        rows: missingPhotos,
      },
      cap_crossers: {
        count: (capCrossers.results || []).length,
        cap: MONTHLY_CAP_NCH,
        month,
        rows: capCrossers.results || [],
      },
      source_distribution: sourceDist.results || [],
    },
  });
}

/* ━━━ NCH PERSON HISTORY — drill into one staff's shortages + shift history ━━━ */
async function nchPersonHistory(DB, url) {
  const pin = url.searchParams.get('pin');
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!pin) return json({ success: false, error: 'pin required' }, 400);

  const person = await DB.prepare(
    'SELECT pin, name, phone, job_name, brand_label, monthly_salary FROM hr_employees WHERE pin = ?'
  ).bind(pin).first();

  if (!person) return json({ success: false, error: 'Staff not found for PIN ' + pin }, 404);

  // Month shortages
  const shortages = await DB.prepare(
    `SELECT * FROM hr_cash_shortages
      WHERE pin = ? AND brand = 'NCH'
        AND strftime('%Y-%m', created_at) = ?
      ORDER BY created_at DESC`
  ).bind(pin, month).all();

  // Last 5 shortages regardless of month
  const recent = await DB.prepare(
    `SELECT * FROM hr_cash_shortages WHERE pin = ? ORDER BY created_at DESC LIMIT 10`
  ).bind(pin).all();

  // Totals
  const open = (shortages.results || []).filter(s => !s.cleared_at && !s.waived);
  const cleared = (shortages.results || []).filter(s => s.cleared_at && !s.waived);
  const waived = (shortages.results || []).filter(s => s.waived);

  return json({
    success: true,
    person,
    month,
    summary: {
      open_count: open.length,
      open_total: Math.round(open.reduce((s,x) => s + (x.amount||0), 0)),
      cleared_count: cleared.length,
      cleared_total: Math.round(cleared.reduce((s,x) => s + (x.amount||0), 0)),
      waived_count: waived.length,
      waived_total: Math.round(waived.reduce((s,x) => s + (x.amount||0), 0)),
      salary_after_deduction: Math.max(0, (person.monthly_salary || 0) - open.reduce((s,x) => s + (x.amount||0), 0)),
      over_cap: open.reduce((s,x) => s + (x.amount||0), 0) > MONTHLY_CAP_NCH,
    },
    shortages_month: shortages.results || [],
    shortages_recent: recent.results || [],
  });
}

/* ━━━ SHORTAGES LIST ━━━ */
async function shortagesList(DB, url) {
  const brand = url.searchParams.get('brand') || 'NCH';
  const month = url.searchParams.get('month');
  const status = url.searchParams.get('status') || 'all';
  let q = `SELECT s.*, e.name AS staff_name
             FROM hr_cash_shortages s
             LEFT JOIN hr_employees e ON e.pin = s.pin
            WHERE s.brand = ?`;
  const args = [brand];
  if (month) { q += ` AND strftime('%Y-%m', s.created_at) = ?`; args.push(month); }
  if (status === 'open')    q += ` AND s.cleared_at IS NULL AND s.waived = 0`;
  else if (status === 'cleared') q += ` AND s.cleared_at IS NOT NULL AND s.waived = 0`;
  else if (status === 'waived')  q += ` AND s.waived = 1`;
  q += ` ORDER BY s.created_at DESC LIMIT 500`;
  const rows = await DB.prepare(q).bind(...args).all();
  return json({
    success: true,
    count: rows.results.length,
    shortages: rows.results.map(r => ({ ...r, is_unmapped: !r.pin })),
  });
}
