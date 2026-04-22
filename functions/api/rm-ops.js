/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — Raw Materials Operations API
 * Route:  /api/rm-ops
 * D1:     DB (hn-hiring)
 * Secrets: ODOO_API_KEY, ODOO_UID_ZOYA, ODOO_KEY_ZOYA,
 *          ODOO_UID_FAHEEM, ODOO_KEY_FAHEEM
 *
 * Purchase (Zoya) → Consumption (POS) → Settlement (Faheem)
 * Brand-aware: every call takes brand=HE|NCH
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB = 'main';

/* ━━━ Brand Config ━━━ */

// Company IDs are for odoo.hnhotels.in (verified 2026-04-20 via diagnose-multicompany):
//   1 = HN Hotels Pvt Ltd (HQ)  |  2 = Hamza Express  |  3 = Nawabi Chai House
// DO NOT use old ops.hamzahotel.com IDs here (those were 1/10/13).
// Location / picking_type / pos_config IDs below are from the old instance and
// have NOT been re-verified for odoo.hnhotels.in — inventory flows (settlement,
// kitchen-stock, receive-delivery) may need re-mapping separately.
const BRAND_CONFIG = {
  NCH: {
    company_id: 3,
    locations: { VENDORS: 1, STOCK: 34, MAIN: 39, COLD: 40, KITCHEN: 41, WASTAGE: 42 },
    picking_types: { to_kitchen: 20, from_cold: 21, return: 22, wastage: 23 },
    pos_configs: [27, 28],
  },
  HE: {
    company_id: 2,
    locations: { VENDORS: 1, STOCK: 5, MAIN: 47, COLD: 48, KITCHEN: 49, WASTAGE: 50 },
    picking_types: { to_kitchen: 30, from_cold: 31, return: 32, wastage: 33 },
    pos_configs: [5, 6, 10],
  },
  HQ: {
    company_id: 1,
    // HQ has no warehouse — service / capex / centralized purchases only.
    // Inventory-related actions (settlement, stock count) skip HQ.
    locations: {},
    picking_types: {},
    pos_configs: [],
  },
};

/* ━━━ Multi-company context helper ━━━
 * Odoo execute_kw uses the API user's default company when allowed_company_ids
 * is absent from context. If the target company differs from the user's default,
 * Odoo raises "Access to unauthorized or invalid companies." on any write.
 * Always inject this into kwargs for every create / write / action call. */
function coCtx(cfg, extra) {
  return { ...(extra || {}), context: { ...(extra?.context || {}), allowed_company_ids: [cfg.company_id] } };
}

/* ━━━ User / PIN → Odoo Credentials ━━━ */

const USERS = {
  '0305': { name: 'Nihaf',   role: 'admin',      odoo: 'system', odoo_uid: 2 },
  '5882': { name: 'Nihaf',   role: 'admin',      odoo: 'system', odoo_uid: 2 },
  '2026': { name: 'Zoya',    role: 'purchase',   odoo: 'zoya',   odoo_uid: 6 },
  '8316': { name: 'Zoya',    role: 'purchase',   odoo: 'zoya',   odoo_uid: 6 },
  '3678': { name: 'Faheem',  role: 'settlement', odoo: 'faheem', odoo_uid: 9 },
  '6045': { name: 'Faheem',  role: 'settlement', odoo: 'faheem', odoo_uid: 9 },
  '6890': { name: 'Tanveer', role: 'staff',      odoo: 'system', odoo_uid: 8 },
  '7115': { name: 'Kesmat',  role: 'staff',      odoo: 'system', odoo_uid: 13 },
  '3946': { name: 'Jafar',   role: 'staff',      odoo: 'system', odoo_uid: 2 },
  '9991': { name: 'Mujib',   role: 'staff',      odoo: 'system', odoo_uid: 15 },
  '3697': { name: 'Yashwant',role: 'staff',      odoo: 'system', odoo_uid: 10 },
  '3754': { name: 'Naveen',  role: 'staff',      odoo: 'system', odoo_uid: 5 },
  '8241': { name: 'Nafees',  role: 'staff',      odoo: 'system', odoo_uid: 14 },
  '8523': { name: 'Basheer', role: 'staff',      odoo: 'system', odoo_uid: 7 },
};

function getOdooCredentials(user, env) {
  if (user.odoo === 'zoya' && env.ODOO_UID_ZOYA && env.ODOO_KEY_ZOYA) {
    return { uid: parseInt(env.ODOO_UID_ZOYA), key: env.ODOO_KEY_ZOYA };
  }
  if (user.odoo === 'faheem' && env.ODOO_UID_FAHEEM && env.ODOO_KEY_FAHEEM) {
    return { uid: parseInt(env.ODOO_UID_FAHEEM), key: env.ODOO_KEY_FAHEEM };
  }
  return { uid: 2, key: env.ODOO_API_KEY };
}

/* ━━━ Helpers ━━━ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function istNow() {
  return new Date(Date.now() + 5.5 * 3600000);
}

function toOdooDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function istToUTC(istString) {
  const d = new Date(istString);
  return new Date(d.getTime() - 5.5 * 3600000);
}

/* ━━━ Odoo JSON-RPC ━━━ */

async function odooCall(uid, apiKey, model, method, args, kwargs) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, uid, apiKey, model, method, args, kwargs || {}],
      },
      id: Date.now(),
    }),
  });
  const d = await r.json();
  if (d.error) {
    const msg = d.error.data?.message || d.error.message || JSON.stringify(d.error);
    throw new Error(`Odoo ${model}.${method}: ${msg}`);
  }
  return d.result;
}

/* ━━━ Main Handler ━━━ */

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const env = context.env;
  const DB = env.DB;

  try {
    if (context.request.method === 'GET') return await handleGet(action, url, env, DB);
    if (context.request.method === 'POST') return await handlePost(action, context, env, DB);
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * GET Endpoints (reads — use system credentials)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handleGet(action, url, env, DB) {
  const pin = url.searchParams.get('pin');
  const user = pin ? USERS[pin] : null;
  if (!user) return json({ error: 'Invalid PIN' }, 401);

  // verify-pin doesn't need brand — used by dashboard PIN gate
  if (action === 'verify-pin') return json({ success: true, user: user.name, role: user.role });

  // market-prices is cross-brand — admin only
  if (action === 'market-prices') return getMarketPrices(user, DB);

  const brand = url.searchParams.get('brand');
  if (!brand || !BRAND_CONFIG[brand]) return json({ error: 'Missing or invalid brand (HE|NCH)' }, 400);

  const cfg = BRAND_CONFIG[brand];
  const creds = getOdooCredentials({ odoo: 'system' }, env);

  switch (action) {
    case 'vendors':     return getVendors(creds, cfg);
    case 'products':    return getProducts(creds, cfg);
    case 'last-prices': return getLastPrices(creds, cfg, url);
    case 'recent-pos':  return getRecentPOs(creds, cfg, url);
    case 'purchase-catalog': return getPurchaseCatalog(creds, cfg, brand, url, DB);
    case 'po-detail':       return getPODetail(creds, cfg, url);
    case 'pending-deliveries': return getPendingDeliveries(creds, cfg);
    case 'consumption': return getConsumption(creds, cfg, url);
    case 'kitchen-stock': return getKitchenStock(creds, cfg);
    case 'settlement-prepare': return settlementPrepare(creds, cfg, brand, DB);
    case 'tracked-items': return getTrackedItems(brand, DB);
    case 'search-products': return searchUntracked(brand, url, DB);
    case 'settlement-history': return getSettlementHistory(brand, url, DB);
    case 'price-history': return getPriceHistory(brand, url, DB);
    case 'status': return getOpsStatus(brand, DB);

    /* ── Phase 3: Variant-aware purchase + price intelligence ── */
    case 'variant-pickers':  return getVariantPickers(brand, url, DB);
    case 'price-intel':      return getPriceIntel(brand, url, DB);
    case 'variant-price-summary': return getVariantPriceSummary(brand, url, DB);

    /* ── Payment journals (bank/cash) for vendor-payment UI ── */
    case 'payment-journals':  return getPaymentJournals(creds, cfg);
    /* ── UoM list (for dropdowns) ── */
    case 'uoms':              return getUoms(creds);

    /* ── Debug: inspect a payment + its bill reconciliation state ── */
    case 'probe-payment':     return probePayment(creds, cfg, url);
    case 'probe-journal':     return probeJournal(creds, cfg, url);

    default: return json({ error: `Unknown GET action: ${action}` }, 400);
  }
}

/* ── Vendors ── */

async function getVendors(creds, cfg) {
  const vendors = await odooCall(creds.uid, creds.key,
    'res.partner', 'search_read',
    [[['supplier_rank', '>', 0], ['company_id', 'in', [cfg.company_id, false]]]],
    { fields: ['id', 'name', 'phone'], order: 'name asc' }
  );
  return json({
    success: true,
    vendors: vendors.map(v => ({ id: v.id, name: v.name, phone: v.phone || '' })),
  });
}

/* ── Products ── */

async function getProducts(creds, cfg) {
  const products = await odooCall(creds.uid, creds.key,
    'product.product', 'search_read',
    [[['default_code', 'like', 'HN-RM-'], ['company_id', 'in', [cfg.company_id, false]]]],
    { fields: ['id', 'name', 'default_code', 'uom_id', 'categ_id'], order: 'name asc' }
  );
  return json({
    success: true,
    products: products.map(p => ({
      id: p.id, name: p.name, code: p.default_code || '',
      uom: p.uom_id ? p.uom_id[1] : 'Units',
      category: p.categ_id ? p.categ_id[1] : '',
    })),
  });
}

/* ── Last Prices (per vendor) ── */

async function getLastPrices(creds, cfg, url) {
  const vendorId = parseInt(url.searchParams.get('vendor_id'));
  if (!vendorId) return json({ error: 'Missing vendor_id' }, 400);

  const poLines = await odooCall(creds.uid, creds.key,
    'purchase.order.line', 'search_read',
    [[['partner_id', '=', vendorId],
      ['state', 'in', ['purchase', 'done']],
      ['company_id', '=', cfg.company_id]]],
    { fields: ['product_id', 'price_unit', 'date_order'], order: 'date_order desc', limit: 200 }
  );

  const prices = {};
  for (const line of poLines) {
    const pid = line.product_id[0];
    if (!prices[pid]) {
      prices[pid] = { price: line.price_unit, date: line.date_order };
    }
  }
  return json({ success: true, prices });
}

/* ── Recent POs ── */

async function getRecentPOs(creds, cfg, url) {
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const pos = await odooCall(creds.uid, creds.key,
    'purchase.order', 'search_read',
    [[['company_id', '=', cfg.company_id]]],
    {
      fields: ['id', 'name', 'partner_id', 'date_order', 'state', 'amount_total', 'create_uid'],
      order: 'date_order desc', limit,
    }
  );
  return json({
    success: true,
    orders: pos.map(p => ({
      id: p.id, name: p.name,
      vendor: p.partner_id ? p.partner_id[1] : 'Unknown',
      date: p.date_order, state: p.state, total: p.amount_total,
      created_by: p.create_uid ? p.create_uid[1] : '',
    })),
  });
}

/* ── Purchase Catalog (one-stop for purchase UI) ── */

async function getPurchaseCatalog(creds, cfg, brand, url, DB) {
  const [odooProducts, odooVendors, vendorMappings, lastPricesAll, recentPOsRaw, pendingPickings] =
    await Promise.all([
      odooCall(creds.uid, creds.key, 'product.product', 'search_read',
        // Source of truth is the "Raw Materials" category (id=21).
        // Legacy HN-RM-* SKU prefix kept as a fallback for products that
        // haven't been re-categorized yet.
        // seller_ids exposes product.supplierinfo links so we can surface
        // vendors even when the D1 rm_vendor_products mapping is absent
        // (e.g. RMs added via the /ops/purchase/ Add-RM modal which writes
        // supplierinfo in Odoo but not the D1 mirror).
        [[
          '|',
            ['categ_id', '=', 21],
            ['default_code', 'like', 'HN-RM-'],
          ['company_id', 'in', [cfg.company_id, false]],
          ['active', '=', true],
        ]],
        { fields: ['id', 'name', 'default_code', 'uom_id', 'categ_id',
                   'product_tmpl_id', 'seller_ids'], order: 'name asc' }),
      odooCall(creds.uid, creds.key, 'res.partner', 'search_read',
        [[['supplier_rank', '>', 0], ['company_id', 'in', [cfg.company_id, false]]]],
        { fields: ['id', 'name', 'phone'], order: 'name asc' }),
      DB ? DB.prepare(
        'SELECT vp.product_code, vp.vendor_key, vp.is_primary, v.name as vendor_name, v.odoo_id as vendor_odoo_id FROM rm_vendor_products vp JOIN rm_vendors v ON vp.vendor_key = v.key'
      ).all() : { results: [] },
      DB ? DB.prepare(
        'SELECT product_code, price, source, recorded_at FROM rm_daily_prices WHERE brand = ? ORDER BY recorded_at DESC'
      ).bind(brand).all() : { results: [] },
      odooCall(creds.uid, creds.key, 'purchase.order', 'search_read',
        [[['company_id', '=', cfg.company_id]]],
        { fields: ['id', 'name', 'partner_id', 'date_order', 'state', 'amount_total', 'create_uid'],
          order: 'date_order desc', limit: 15 }),
      odooCall(creds.uid, creds.key, 'stock.picking', 'search_read',
        [[['picking_type_code', '=', 'incoming'], ['state', '=', 'assigned'],
          ['company_id', '=', cfg.company_id]]],
        { fields: ['id', 'name', 'partner_id', 'scheduled_date', 'origin', 'purchase_id'],
          order: 'scheduled_date desc', limit: 20 }),
    ]);

  // vendor mappings: product_code → [{key, name, odoo_id, is_primary}]
  // Self-heal stale odoo_ids: D1's rm_vendors.odoo_id may be from the old
  // ops.hamzahotel.com instance; remap to the live odoo.hnhotels.in id via
  // case-insensitive name match so the PO create payload uses a valid partner.
  const liveVendorByName = {};
  for (const v of odooVendors) {
    liveVendorByName[v.name.trim().toLowerCase()] = v.id;
  }
  const vendorMap = {};
  for (const m of (vendorMappings.results || [])) {
    if (!vendorMap[m.product_code]) vendorMap[m.product_code] = [];
    const liveId = liveVendorByName[(m.vendor_name || '').trim().toLowerCase()];
    vendorMap[m.product_code].push({
      key: m.vendor_key, name: m.vendor_name,
      odoo_id: liveId || m.vendor_odoo_id,
      odoo_id_stale: !liveId && !!m.vendor_odoo_id,
      is_primary: !!m.is_primary,
    });
  }

  // Secondary vendor source: product.supplierinfo in Odoo. Keyed by
  // product_id + product_tmpl_id so RMs added via the Add-RM modal (which
  // only writes supplierinfo, not the D1 mirror) still resolve a vendor.
  const supplierinfoVendorMap = {};
  const allSupplierinfoIds = [...new Set(odooProducts.flatMap(p => p.seller_ids || []))];
  if (allSupplierinfoIds.length > 0) {
    const supplierinfos = await odooCall(creds.uid, creds.key,
      'product.supplierinfo', 'search_read',
      [[['id', 'in', allSupplierinfoIds]]],
      { fields: ['id', 'partner_id', 'product_tmpl_id', 'product_id', 'price', 'min_qty'] });
    // Tag each vendor link with a synthetic primary flag (first seller = primary)
    const seenByTmpl = new Set();
    for (const si of supplierinfos) {
      if (!si.partner_id) continue;
      const vendorOdooId = si.partner_id[0];
      const vendorName = si.partner_id[1] || '';
      const tmplId = si.product_tmpl_id?.[0];
      const prodId = si.product_id?.[0];
      const isPrimary = tmplId && !seenByTmpl.has(tmplId);
      if (isPrimary) seenByTmpl.add(tmplId);
      const link = {
        key: `si-${si.id}`, name: vendorName,
        odoo_id: vendorOdooId, odoo_id_stale: false,
        is_primary: isPrimary,
        price: si.price || 0,
      };
      // Key by product_tmpl_id (covers all variants of the template) and
      // also by specific product_id when the supplierinfo is variant-scoped.
      if (tmplId) {
        const tk = `tmpl:${tmplId}`;
        (supplierinfoVendorMap[tk] = supplierinfoVendorMap[tk] || []).push(link);
      }
      if (prodId) {
        const pk = `prod:${prodId}`;
        (supplierinfoVendorMap[pk] = supplierinfoVendorMap[pk] || []).push(link);
      }
    }
  }

  // latest price per product (first occurrence = most recent due to ORDER BY)
  const priceMap = {};
  for (const p of (lastPricesAll.results || [])) {
    if (!priceMap[p.product_code]) {
      priceMap[p.product_code] = { price: p.price, source: p.source, date: p.recorded_at };
    }
  }

  // Fetch move lines for pending pickings (one batch call)
  let pendingMoves = [];
  const pendingPickingIds = (pendingPickings || []).map(p => p.id);
  if (pendingPickingIds.length > 0) {
    pendingMoves = await odooCall(creds.uid, creds.key,
      'stock.move', 'search_read',
      [[['picking_id', 'in', pendingPickingIds], ['state', '!=', 'cancel']]],
      { fields: ['id', 'picking_id', 'product_id', 'product_uom_qty', 'product_uom'] }
    );
  }
  const movesByPicking = {};
  for (const m of pendingMoves) {
    const pid = m.picking_id[0];
    if (!movesByPicking[pid]) movesByPicking[pid] = [];
    movesByPicking[pid].push({
      product_name: m.product_id ? m.product_id[1] : 'Unknown',
      qty: m.product_uom_qty,
      uom: m.product_uom ? m.product_uom[1] : 'Units',
    });
  }

  // Merge D1 vendorMap with Odoo supplierinfo, deduped by odoo_id. D1 takes
  // precedence when both exist; supplierinfo fills gaps for new-flow RMs.
  function mergeVendors(codeBased, prodId, tmplId) {
    const byOdooId = new Map();
    for (const v of codeBased || []) byOdooId.set(v.odoo_id, v);
    const siLinks = [
      ...(supplierinfoVendorMap[`tmpl:${tmplId}`] || []),
      ...(supplierinfoVendorMap[`prod:${prodId}`] || []),
    ];
    for (const v of siLinks) {
      if (!byOdooId.has(v.odoo_id)) byOdooId.set(v.odoo_id, v);
    }
    return [...byOdooId.values()];
  }

  return json({
    success: true,
    products: odooProducts.map(p => ({
      id: p.id, name: p.name, code: p.default_code || '',
      uom: p.uom_id ? p.uom_id[1] : 'Units',
      category: p.categ_id ? p.categ_id[1] : '',
      vendors: mergeVendors(vendorMap[p.default_code], p.id, p.product_tmpl_id?.[0]),
      lastPrice: priceMap[p.default_code] || null,
    })),
    vendors: odooVendors.map(v => ({ id: v.id, name: v.name, phone: v.phone || '' })),
    recentPOs: recentPOsRaw.map(p => ({
      id: p.id, name: p.name,
      vendor: p.partner_id ? p.partner_id[1] : 'Unknown',
      date: p.date_order, state: p.state, total: p.amount_total,
      created_by: p.create_uid ? p.create_uid[1] : '',
    })),
    pendingDeliveries: (pendingPickings || []).map(p => ({
      picking_id: p.id,
      name: p.name,
      vendor: p.partner_id ? p.partner_id[1] : 'Unknown',
      date: p.scheduled_date,
      po_name: p.origin || '',
      po_id: p.purchase_id ? p.purchase_id[0] : null,
      items: movesByPicking[p.id] || [],
    })),
  });
}

/* ── PO Detail (for edit/delete flow) ── */

async function getPODetail(creds, cfg, url) {
  const poId = parseInt(url.searchParams.get('po_id'));
  if (!poId) return json({ error: 'Missing po_id' }, 400);

  // Read PO header + lines + linked pickings in parallel
  const [poArr, poLines, pickings] = await Promise.all([
    odooCall(creds.uid, creds.key, 'purchase.order', 'read', [[poId]],
      { fields: ['id', 'name', 'partner_id', 'state', 'amount_total', 'date_order', 'company_id'] }),
    odooCall(creds.uid, creds.key, 'purchase.order.line', 'search_read',
      [[['order_id', '=', poId]]],
      { fields: ['id', 'product_id', 'product_qty', 'price_unit', 'price_subtotal', 'name', 'product_uom_id'] }),
    odooCall(creds.uid, creds.key, 'stock.picking', 'search_read',
      [[['purchase_id', '=', poId]]],
      { fields: ['id', 'name', 'state'] }),
  ]);

  if (!poArr || poArr.length === 0) return json({ error: 'PO not found' }, 404);
  const po = poArr[0];

  // Determine if PO is editable: must be confirmed AND picking not yet done
  const pickingDone = pickings.some(p => p.state === 'done');
  const editable = po.state === 'purchase' && !pickingDone;

  return json({
    success: true,
    po: {
      id: po.id, name: po.name,
      vendor: po.partner_id ? po.partner_id[1] : 'Unknown',
      vendor_id: po.partner_id ? po.partner_id[0] : null,
      state: po.state, total: po.amount_total,
      date: po.date_order,
    },
    lines: poLines.map(l => ({
      id: l.id,
      product_id: l.product_id ? l.product_id[0] : null,
      product_name: l.product_id ? l.product_id[1] : l.name,
      qty: l.product_qty,
      price_unit: l.price_unit,
      subtotal: l.price_subtotal,
      uom: l.product_uom_id ? l.product_uom_id[1] : 'Units',
    })),
    pickings: pickings.map(p => ({ id: p.id, name: p.name, state: p.state })),
    editable,
    editableReason: !editable
      ? (po.state === 'cancel' ? 'PO is cancelled'
        : po.state === 'draft' ? 'PO is still in draft'
        : pickingDone ? 'Stock already received — cannot modify'
        : 'PO state does not allow editing')
      : null,
  });
}

/* ── Consumption (POS sales + stock transfers) ── */

async function getConsumption(creds, cfg, url) {
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  let fromUTC, toUTC;
  if (fromParam) {
    fromUTC = istToUTC(fromParam);
  } else {
    fromUTC = new Date(Date.now() - 24 * 3600000);
  }
  if (toParam) {
    toUTC = istToUTC(toParam);
  } else {
    toUTC = new Date();
  }

  const fromOdoo = toOdooDatetime(fromUTC);
  const toOdoo = toOdooDatetime(toUTC);

  // Parallel: POS sales + stock transfers + kitchen stock
  const [sales, transfers, kitchenStock] = await Promise.all([
    fetchPOSSales(creds, cfg, fromOdoo, toOdoo),
    fetchTransfers(creds, cfg, fromOdoo, toOdoo),
    fetchKitchenStockRaw(creds, cfg),
  ]);

  // Aggregate consumption per raw material
  const consumption = {};
  const allProductIds = new Set([
    ...Object.keys(transfers.sentToKitchen),
    ...Object.keys(transfers.returned),
    ...Object.keys(transfers.wasted),
  ]);

  for (const idStr of allProductIds) {
    const id = parseInt(idStr);
    const sent = transfers.sentToKitchen[id] || 0;
    const ret = transfers.returned[id] || 0;
    const waste = transfers.wasted[id] || 0;
    consumption[id] = {
      sentToKitchen: round(sent),
      returned: round(ret),
      wasted: round(waste),
      netConsumed: round(sent - ret),
    };
  }

  return json({
    success: true,
    period: {
      from: new Date(fromUTC.getTime() + 5.5 * 3600000).toISOString(),
      to: new Date(toUTC.getTime() + 5.5 * 3600000).toISOString(),
    },
    sales,
    consumption,
    kitchenStock,
  });
}

/* ── Kitchen Stock ── */

async function getKitchenStock(creds, cfg) {
  const stock = await fetchKitchenStockRaw(creds, cfg);
  return json({ success: true, stock });
}

/* ── Search untracked products (for add-item modal) ── */

async function searchUntracked(brand, url, DB) {
  if (!DB) return json({ success: true, products: [] });
  const q = (url.searchParams.get('q') || '').trim();
  const like = `%${q}%`;
  const rows = await DB.prepare(`
    SELECT hn_code, name, uom, category FROM rm_products
    WHERE brand IN (?, 'BOTH')
    AND (? = '' OR name LIKE ? OR hn_code LIKE ?)
    AND hn_code NOT IN (
      SELECT product_code FROM rm_tracked_items WHERE brand = ? AND is_active = 1
    )
    ORDER BY name LIMIT 20
  `).bind(brand, q, like, like, brand).all();
  return json({ success: true, products: rows.results || [] });
}

/* ── Add a product to tracked items (Faheem / admin) ── */

async function addTrackedItem(body, user, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'settlement') {
    return json({ error: 'Only admin or settlement role can add tracked items' }, 403);
  }
  const { product_code } = body;
  if (!product_code) return json({ error: 'Missing product_code' }, 400);
  if (!DB) return json({ error: 'DB unavailable' }, 503);

  const product = await DB.prepare(
    'SELECT hn_code, name, uom, category FROM rm_products WHERE hn_code = ?'
  ).bind(product_code).first();
  if (!product) return json({ error: `Product ${product_code} not found in registry` }, 404);

  await DB.prepare(
    "INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method, is_active) VALUES (?, ?, 1, 'direct', 1)"
  ).bind(product_code, brand).run();

  // If it existed but was deactivated, re-activate it
  await DB.prepare(
    'UPDATE rm_tracked_items SET is_active = 1 WHERE product_code = ? AND brand = ?'
  ).bind(product_code, brand).run();

  return json({
    success: true,
    item: { code: product.hn_code, name: product.name, uom: product.uom, category: product.category },
  });
}

/* ── Settlement Prepare ── */

async function settlementPrepare(creds, cfg, brand, DB) {
  const now = istNow();
  const nowISO = now.toISOString();

  // Previous settlement
  const previous = DB ? await DB.prepare(
    'SELECT * FROM rm_settlements WHERE brand = ? AND status IN (?, ?) ORDER BY settled_at DESC LIMIT 1'
  ).bind(brand, 'completed', 'bootstrap').first() : null;

  const periodStart = previous ? previous.settled_at : nowISO;
  const periodEnd = nowISO;

  // Opening stock from previous settlement's closing
  let openingStock = {};
  if (previous && previous.closing_stock) {
    openingStock = JSON.parse(previous.closing_stock);
  }

  // Auto-sync: any product in rm_products tagged to this brand/BOTH that isn't yet tracked
  // gets silently inserted so new products Zoya adds automatically appear for Faheem
  if (DB) {
    await DB.prepare(`
      INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method, is_active)
      SELECT hn_code, ?, 1, 'direct', 1 FROM rm_products
      WHERE brand IN (?, 'BOTH')
      AND hn_code NOT IN (SELECT product_code FROM rm_tracked_items WHERE brand = ?)
    `).bind(brand, brand, brand).run();
  }

  // Load intelligence + tracked items + purchases in parallel
  const [intelligence, tracked, purchases] = await Promise.all([
    loadIntelligence(brand, DB),
    DB ? DB.prepare(
      'SELECT ti.*, p.name, p.uom, p.category, p.avg_cost FROM rm_tracked_items ti JOIN rm_products p ON ti.product_code = p.hn_code WHERE ti.brand = ? AND ti.is_active = 1 ORDER BY ti.tier, p.name'
    ).bind(brand).all() : { results: [] },
    fetchPurchasesReceived(creds, cfg,
      toOdooDatetime(istToUTC(periodStart)),
      toOdooDatetime(istToUTC(periodEnd)), true),  // withDetail=true for delivery cards
  ]);

  // Unpack purchases (now returns { purchased, deliveries } when withDetail=true)
  const purchaseData = purchases && typeof purchases === 'object' && 'purchased' in purchases
    ? purchases : { purchased: purchases, deliveries: [] };
  const purchasedQtys = purchaseData.purchased;
  const deliveries    = purchaseData.deliveries;

  // Latest prices per tracked item
  const latestPrices = {};
  if (DB) {
    for (const item of (tracked.results || [])) {
      const price = await DB.prepare(
        'SELECT price, source, recorded_at FROM rm_daily_prices WHERE product_code = ? AND brand = ? ORDER BY recorded_at DESC LIMIT 1'
      ).bind(item.product_code, brand).first();
      if (price) {
        latestPrices[item.product_code] = price;
      } else if (item.avg_cost) {
        latestPrices[item.product_code] = { price: item.avg_cost, source: 'registry_avg', recorded_at: null };
      }
    }
  }

  // Determine settlement mode based on intelligence data
  const hasDecomposition = intelligence.ratios.length > 0;

  return json({
    success: true,
    brand,
    settlementDate: nowISO.slice(0, 10),
    period: { start: periodStart, end: periodEnd },
    needsBootstrap: !previous,
    mode: hasDecomposition ? 'full' : 'direct',
    previousSettlement: previous ? {
      id: previous.id,
      date: previous.settlement_date,
      settledAt: previous.settled_at,
    } : null,
    openingStock,
    trackedItems: (tracked.results || []).map(t => ({
      code: t.product_code,
      name: t.name,
      uom: t.uom,
      category: t.category,
      tier: t.tier,
      countMethod: t.count_method,
      opening: openingStock[t.product_code] || 0,
      purchased: purchasedQtys[t.product_code] || 0,
      latestPrice: latestPrices[t.product_code] || null,
    })),
    purchases: purchasedQtys,
    deliveries,
    latestPrices,
    intelligence: {
      recipes: intelligence.recipes.length,
      ratios: intelligence.ratios.length,
      vessels: intelligence.vessels,
      densities: intelligence.densities,
      zones: intelligence.zones,
      fieldZones: intelligence.fieldZones,
      wastageItems: intelligence.wastageItems,
    },
  });
}

/* ── Tracked Items ── */

async function getTrackedItems(brand, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const items = await DB.prepare(
    'SELECT ti.*, p.name, p.uom, p.category, p.avg_cost FROM rm_tracked_items ti JOIN rm_products p ON ti.product_code = p.hn_code WHERE ti.brand = ? AND ti.is_active = 1 ORDER BY ti.tier, p.name'
  ).bind(brand).all();
  return json({ success: true, items: items.results || [] });
}

/* ── Settlement History ── */

async function getSettlementHistory(brand, url, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const rows = await DB.prepare(
    'SELECT id, brand, settlement_date, settled_by, period_start, period_end, cost_summary, status, settled_at FROM rm_settlements WHERE brand = ? ORDER BY settled_at DESC LIMIT ?'
  ).bind(brand, limit).all();
  return json({ success: true, settlements: rows.results || [] });
}

/* ── Price History ── */

async function getPriceHistory(brand, url, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const code = url.searchParams.get('code');
  const limit = parseInt(url.searchParams.get('limit') || '30');
  if (!code) return json({ error: 'Missing code parameter' }, 400);
  const rows = await DB.prepare(
    'SELECT * FROM rm_daily_prices WHERE product_code = ? AND brand = ? ORDER BY recorded_at DESC LIMIT ?'
  ).bind(code, brand, limit).all();
  return json({ success: true, prices: rows.results || [] });
}

/* ── Ops Status ── */

async function getOpsStatus(brand, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const [tracked, settlements, prices, logs] = await Promise.all([
    DB.prepare('SELECT COUNT(*) as cnt FROM rm_tracked_items WHERE brand = ? AND is_active = 1').bind(brand).first(),
    DB.prepare('SELECT COUNT(*) as cnt FROM rm_settlements WHERE brand = ?').bind(brand).first(),
    DB.prepare('SELECT COUNT(*) as cnt FROM rm_daily_prices WHERE brand = ?').bind(brand).first(),
    DB.prepare('SELECT COUNT(*) as cnt FROM rm_ops_log WHERE brand = ?').bind(brand).first(),
  ]);
  const lastSettlement = await DB.prepare(
    'SELECT settlement_date, settled_by, settled_at FROM rm_settlements WHERE brand = ? ORDER BY settled_at DESC LIMIT 1'
  ).bind(brand).first();
  return json({
    success: true, brand,
    trackedItems: tracked?.cnt || 0,
    settlements: settlements?.cnt || 0,
    priceRecords: prices?.cnt || 0,
    opsLogs: logs?.cnt || 0,
    lastSettlement: lastSettlement || null,
  });
}

/* ── Market Prices (Price Intelligence) ── */

async function getMarketPrices(user, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);

  const [summaryResult, lastRunResult, trendResult] = await Promise.all([
    DB.prepare(`
      SELECT ps.material_code, ps.item_name, ps.base_unit,
             ps.odoo_avg_cost, ps.cheapest_platform, ps.cheapest_price,
             ps.savings_pct, ps.price_hyperpure, ps.price_blinkit,
             ps.price_zepto, ps.price_bigbasket,
             ps.items_checked, ps.last_run_at, ps.last_run_status,
             rp.category, rp.brand
      FROM rm_price_summary ps
      LEFT JOIN rm_products rp ON rp.hn_code = ps.material_code
      WHERE ps.cheapest_price IS NOT NULL
      ORDER BY ps.savings_pct DESC
    `).all(),

    DB.prepare(`
      SELECT MAX(checked_at) as last_run_date,
             COUNT(*) as items_checked
      FROM rm_market_prices
      WHERE checked_at = DATE('now')
    `).first(),

    DB.prepare(`
      SELECT material_code, platform, price_per_base, checked_at
      FROM rm_market_prices
      WHERE checked_at >= DATE('now', '-7 days')
      ORDER BY material_code, platform, checked_at
    `).all(),
  ]);

  return json({
    success: true,
    summary: summaryResult.results || [],
    lastRun: lastRunResult || { last_run_date: null, items_checked: 0 },
    trend: trendResult.results || [],
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * POST Endpoints (writes — use per-user credentials)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handlePost(action, context, env, DB) {
  const body = await context.request.json();
  const { pin, brand } = body;

  const user = pin ? USERS[pin] : null;
  if (!user) return json({ error: 'Invalid PIN' }, 401);
  if (!brand || !BRAND_CONFIG[brand]) return json({ error: 'Missing or invalid brand' }, 400);

  const cfg = BRAND_CONFIG[brand];
  // Admin-only API policy: PIN + USERS map is the auth gate; Odoo user tracking
  // is via D1 ops log. Per-employee Odoo logins intentionally not created on
  // odoo.hnhotels.in — saves licences and avoids per-user ACL gaps.
  const creds = getOdooCredentials({ odoo: 'system' }, env);

  switch (body.action || action) {
    case 'create-po':       return createPO(body, user, creds, cfg, brand, DB, env);
    case 'add-po-line':     return addPOLine(body, user, creds, cfg, brand, DB, env);
    case 'edit-po-line':    return editPOLine(body, user, creds, cfg, brand, DB, env);
    case 'delete-po-line':  return deletePOLine(body, user, creds, cfg, brand, DB, env);
    case 'cancel-po':       return cancelPO(body, user, creds, cfg, brand, DB, env);
    case 'unlink-vendor-product': return unlinkVendorProduct(body, user, creds, cfg, brand, DB, env);
    case 'set-primary-vendor':    return setPrimaryVendor(body, user, creds, cfg, brand, DB, env);
    case 'receive-delivery': return receiveDelivery(body, user, creds, cfg, brand, DB, env);
    case 'add-product':     return addProduct(body, user, creds, cfg, brand, env, DB);
    case 'update-price':    return updatePrice(body, user, brand, DB);
    case 'link-vendor':     return linkVendor(body, user, creds, cfg, brand, env, DB);
    case 'settlement-submit': return settlementSubmit(body, user, creds, cfg, brand, env, DB);
    case 'add-tracked-item': return addTrackedItem(body, user, brand, DB);

    /* ── Phase 3: explicit variant summary refresh ── */
    case 'refresh-variant-summary': return refreshVariantPriceSummary(body, brand, DB);

    /* ── Phase 4 (unified Purchase UI): list/create/bill ── */
    case 'list-pos':         return listPOs(creds, cfg, brand, body);
    case 'create-bill':      return createBill(body, user, creds, cfg, brand, env, DB);
    case 'direct-bill':      return directBill(body, user, creds, cfg, brand, env, DB);
    case 'list-bills':       return listBills(brand, body, DB);
    case 'vendor-outstanding': return vendorOutstanding(creds, cfg, brand);
    case 'register-payment': return registerPayment(body, user, creds, cfg, brand, DB);
    case 'register-payment-je': return registerPaymentJE(body, user, creds, cfg, brand, DB);
    case 'post-payment':     return postPayment(body, user, creds, cfg);
    case 'unlink-payment':   return unlinkPayment(body, user, creds, cfg);
    case 'create-uom':       return createUom(body, user, creds);

    default: return json({ error: `Unknown POST action: ${body.action}` }, 400);
  }
}

/* ── Create Purchase Order ── */

async function createPO(body, user, creds, cfg, brand, DB, env) {
  // Use admin creds for all Odoo calls: per-user keys may lack product.product
  // read access or may not be configured for this Odoo instance. Auth gate is
  // enforced by PIN + USERS map above — Odoo user tracking is via D1 ops log.
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  const { vendor_id, lines, date } = body;
  if (!vendor_id || !lines || !Array.isArray(lines) || lines.length === 0) {
    return json({ error: 'Missing vendor_id or lines' }, 400);
  }

  // Fetch product UoMs (admin read — product access not guaranteed for all users)
  const productIds = lines.map(l => l.product_id);
  const productData = await odooCall(sysCreds.uid, sysCreds.key,
    'product.product', 'search_read',
    [[['id', 'in', productIds]]],
    { fields: ['id', 'name', 'uom_id'] }
  );
  const uomMap = Object.fromEntries(productData.map(p => [p.id, p.uom_id[0]]));

  // Backdated PO support: historical mode sends date=YYYY-MM-DD for the PO's
  // date_order. Live mode sends nothing and we use now().
  let orderDate = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    orderDate = new Date(`${date}T09:00:00+05:30`);
  }
  const datePlanned = toOdooDatetime(orderDate);
  const dateOrderStr = toOdooDatetime(orderDate);

  // Build PO lines
  const orderLines = lines.map(l => [0, 0, {
    product_id: l.product_id,
    product_qty: l.qty,
    price_unit: l.price_unit,
    name: l.name || 'Purchase',
    product_uom_id: uomMap[l.product_id] || 1,
    date_planned: datePlanned,
  }]);

  const poVals = {
    partner_id: vendor_id,
    company_id: cfg.company_id,
    order_line: orderLines,
  };
  if (date) poVals.date_order = dateOrderStr;

  const poId = await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'create',
    [poVals], coCtx(cfg)
  );

  // Auto-confirm
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'button_confirm', [[poId]], coCtx(cfg)
  );

  // Read PO name
  const po = await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'read', [[poId]], { fields: ['name'] }
  );
  const poName = po[0] ? po[0].name : `PO#${poId}`;

  // Record prices to D1 — Phase 3: variant-aware when odoo_variant_id provided
  // (line.product_id is ALWAYS a product.product/variant id in Odoo; when the
  // product has no attribute variants it is effectively the template as well.
  // line.odoo_variant_id is set by the UI when the user picks a specific
  // variant from the variant modal; fall back to product_id otherwise.)
  const touchedVariants = new Set();
  if (DB) {
    const now = istNow().toISOString();
    for (const line of lines) {
      const prod = productData.find(p => p.id === line.product_id);
      // Legacy flat path: map product.product → HN-RM code
      let hnCode = null;
      if (prod) {
        const d1Product = await DB.prepare(
          'SELECT hn_code FROM rm_products WHERE odoo_id = ?'
        ).bind(line.product_id).first();
        if (d1Product) hnCode = d1Product.hn_code;
      }

      // Phase 3: variant id (explicit from UI, else derive from product_id)
      const variantId = line.odoo_variant_id || line.product_id;
      let variantDisplay = line.variant_display || null;
      if (!variantDisplay) {
        const cachedVariant = await DB.prepare(
          'SELECT display_name FROM rm_product_variants WHERE odoo_variant_id = ?'
        ).bind(variantId).first();
        variantDisplay = cachedVariant?.display_name || (prod ? prod.name : null);
      }

      if (hnCode || variantId) {
        await DB.prepare(
          `INSERT INTO rm_daily_prices
             (product_code, brand, price, recorded_by, source, recorded_at,
              odoo_variant_id, variant_display)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          hnCode || `VID-${variantId}`, brand, line.price_unit,
          user.name, `po:${poName}`, now,
          variantId || null, variantDisplay
        ).run();

        if (variantId) touchedVariants.add(variantId);
      }
    }

    // Phase 3: refresh per-variant rolling stats for variants touched by this PO
    for (const vid of touchedVariants) {
      try { await refreshOneVariantSummary(DB, vid, brand); } catch (_) { /* non-fatal */ }
    }

    // Log the action
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('create_po', brand, user.name, JSON.stringify({
      po_id: poId, po_name: poName, vendor_id, line_count: lines.length,
      variant_ids: [...touchedVariants],
    }), now).run();
  }

  return json({
    success: true, po_id: poId, po_name: poName,
    created_by: user.name, brand,
    variant_ids: [...touchedVariants],
  });
}

/* ── PO Safety Check (shared by edit/delete/cancel) ── */

async function checkPOEditable(creds, poId) {
  const [poArr, pickings] = await Promise.all([
    odooCall(creds.uid, creds.key, 'purchase.order', 'read', [[poId]],
      { fields: ['id', 'name', 'state'] }),
    odooCall(creds.uid, creds.key, 'stock.picking', 'search_read',
      [[['purchase_id', '=', poId]]],
      { fields: ['id', 'state'] }),
  ]);

  if (!poArr || poArr.length === 0) return { ok: false, error: 'PO not found' };
  const po = poArr[0];

  if (po.state === 'cancel') return { ok: false, error: 'PO is already cancelled' };
  if (po.state === 'done') return { ok: false, error: 'PO is already done' };
  if (po.state !== 'purchase') return { ok: false, error: `PO state "${po.state}" does not allow editing` };

  const pickingDone = pickings.some(p => p.state === 'done');
  if (pickingDone) return { ok: false, error: 'Stock already received — cannot modify this PO' };

  return { ok: true, po, pickings };
}

/* ── Edit PO Line (qty / price) ── */

/* ── Vendor ↔ Product mapping management ──
 * Data hygiene actions so Zoya / admin can fix bad links from the UI without
 * touching Odoo directly. Used by the "✏️ Manage list" toggle inside the
 * bulk-entry vendor pane.
 *
 *   unlink-vendor-product: removes a product from a vendor's known catalogue
 *     — deletes product.supplierinfo row(s) for (vendor, product_tmpl) in Odoo
 *     — deletes the matching rm_vendor_products rows in D1 (handles dup vendor keys)
 *
 *   set-primary-vendor: makes the given vendor the "primary" supplier for a
 *     product — sets sequence=1 on its supplierinfo row, sequence=10 on others
 */
async function unlinkVendorProduct(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
  const { vendor_id, product_id } = body;
  if (!vendor_id || !product_id) return json({ error: 'Missing vendor_id or product_id' }, 400);

  // Resolve product_tmpl_id — supplierinfo binds to the template
  const prod = await odooCall(sysCreds.uid, sysCreds.key, 'product.product', 'read',
    [[parseInt(product_id, 10)]], { fields: ['id', 'name', 'default_code', 'product_tmpl_id'] });
  if (!prod?.length) return json({ error: 'Product not found' }, 404);
  const tmplId = prod[0].product_tmpl_id?.[0];
  if (!tmplId) return json({ error: 'Product template not found' }, 404);

  // Find + unlink all supplierinfo rows for this (vendor, template) pair
  const matchingSupplierinfo = await odooCall(sysCreds.uid, sysCreds.key,
    'product.supplierinfo', 'search_read',
    [[['partner_id', '=', parseInt(vendor_id, 10)], ['product_tmpl_id', '=', tmplId]]],
    { fields: ['id'], limit: 10 });
  const siIds = matchingSupplierinfo.map(r => r.id);
  if (siIds.length) {
    await odooCall(sysCreds.uid, sysCreds.key, 'product.supplierinfo', 'unlink', [siIds]);
  }

  // Mirror into D1 — delete rm_vendor_products rows for (product_code, any-vendor-key-that-maps-to-this-odoo-id).
  // The Apr-18 rebuild left duplicate vendor keys for the same partner, so we
  // delete across ALL matching vendor keys to keep UI consistent.
  let d1Deleted = 0;
  if (DB && prod[0].default_code) {
    // Find every D1 vendor_key that currently maps to this Odoo partner
    const keys = await DB.prepare(
      `SELECT key FROM rm_vendors WHERE odoo_id = ? AND is_active = 1`
    ).bind(parseInt(vendor_id, 10)).all();
    const vendorKeys = (keys.results || []).map(r => r.key);
    for (const k of vendorKeys) {
      const res = await DB.prepare(
        `DELETE FROM rm_vendor_products WHERE product_code = ? AND vendor_key = ?`
      ).bind(prod[0].default_code, k).run();
      d1Deleted += res.meta?.changes || 0;
    }
  }

  // Audit log
  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('unlink_vendor_product', brand, user.name, JSON.stringify({
      vendor_id, product_id, product_name: prod[0].name, product_code: prod[0].default_code,
      supplierinfo_ids_removed: siIds, d1_rows_deleted: d1Deleted,
    }), istNow().toISOString()).run();
  }

  return json({
    success: true,
    product_name: prod[0].name,
    product_code: prod[0].default_code,
    supplierinfo_removed: siIds.length,
    d1_rows_removed: d1Deleted,
  });
}

async function setPrimaryVendor(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
  const { vendor_id, product_id } = body;
  if (!vendor_id || !product_id) return json({ error: 'Missing vendor_id or product_id' }, 400);

  const prod = await odooCall(sysCreds.uid, sysCreds.key, 'product.product', 'read',
    [[parseInt(product_id, 10)]], { fields: ['id', 'name', 'default_code', 'product_tmpl_id'] });
  if (!prod?.length) return json({ error: 'Product not found' }, 404);
  const tmplId = prod[0].product_tmpl_id?.[0];
  if (!tmplId) return json({ error: 'Product template not found' }, 404);

  // Fetch all suppliers for this template
  const allSi = await odooCall(sysCreds.uid, sysCreds.key, 'product.supplierinfo', 'search_read',
    [[['product_tmpl_id', '=', tmplId]]], { fields: ['id', 'partner_id', 'sequence'], limit: 50 });
  const targetSi = allSi.find(si => si.partner_id?.[0] === parseInt(vendor_id, 10));
  if (!targetSi) return json({ error: 'This vendor is not in the product\'s supplier list' }, 404);

  // Primary = sequence 1, others = sequence 10
  await odooCall(sysCreds.uid, sysCreds.key, 'product.supplierinfo', 'write', [[targetSi.id], { sequence: 1 }]);
  const others = allSi.filter(si => si.id !== targetSi.id && si.sequence < 10).map(si => si.id);
  if (others.length) {
    await odooCall(sysCreds.uid, sysCreds.key, 'product.supplierinfo', 'write', [others, { sequence: 10 }]);
  }
  // D1 mirror — set is_primary=1 for this pair, 0 for others
  if (DB && prod[0].default_code) {
    const keys = await DB.prepare(
      `SELECT key FROM rm_vendors WHERE odoo_id = ? AND is_active = 1`
    ).bind(parseInt(vendor_id, 10)).all();
    const vendorKeys = (keys.results || []).map(r => r.key);
    await DB.prepare(`UPDATE rm_vendor_products SET is_primary = 0 WHERE product_code = ?`)
      .bind(prod[0].default_code).run();
    for (const k of vendorKeys) {
      await DB.prepare(`UPDATE rm_vendor_products SET is_primary = 1 WHERE product_code = ? AND vendor_key = ?`)
        .bind(prod[0].default_code, k).run();
    }
  }
  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('set_primary_vendor', brand, user.name, JSON.stringify({
      vendor_id, product_id, product_name: prod[0].name,
    }), istNow().toISOString()).run();
  }
  return json({ success: true, product_name: prod[0].name });
}

/* ── Add a new line to an existing PO ──
 * Used by the ledger drawer's "Edit Lines" section so Zoya can enrich a
 * PO that was originally entered as a single-item flat entry (e.g. one of
 * the 168 fragmented POs the audit flagged).  Follows the same cancel→
 * draft→write→confirm cycle as delete-po-line for confirmed POs.
 */
async function addPOLine(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  const { po_id, product_id, qty, price_unit } = body;
  if (!po_id || !product_id) return json({ error: 'Missing po_id or product_id' }, 400);
  if (!qty || qty <= 0) return json({ error: 'Quantity must be positive' }, 400);
  const priceU = price_unit != null ? parseFloat(price_unit) : 0;
  if (priceU < 0) return json({ error: 'Price cannot be negative' }, 400);

  const check = await checkPOEditable(sysCreds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  // Fetch product meta for name (required by Odoo)
  const prod = await odooCall(sysCreds.uid, sysCreds.key,
    'product.product', 'read', [[parseInt(product_id, 10)]],
    { fields: ['id', 'name', 'uom_po_id', 'product_tmpl_id'] });
  if (!prod || !prod.length) return json({ error: 'Product not found' }, 404);

  const lineVals = {
    product_id: parseInt(product_id, 10),
    name: prod[0].name,
    product_qty: qty,
    price_unit: priceU,
  };
  if (prod[0].uom_po_id?.[0]) lineVals.product_uom = prod[0].uom_po_id[0];

  // Confirmed POs need cancel→draft→write→confirm cycle (same as delete-po-line)
  const state = check.po.state;
  if (state === 'purchase') {
    await odooCall(sysCreds.uid, sysCreds.key,
      'purchase.order', 'button_cancel', [[po_id]], coCtx(cfg));
    await odooCall(sysCreds.uid, sysCreds.key,
      'purchase.order', 'button_draft', [[po_id]], coCtx(cfg));
  }
  // Add the line via order_line [[0, 0, vals]] trick
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'write', [[po_id], { order_line: [[0, 0, lineVals]] }], coCtx(cfg));
  if (state === 'purchase') {
    await odooCall(sysCreds.uid, sysCreds.key,
      'purchase.order', 'button_confirm', [[po_id]], coCtx(cfg));
  }

  // Record price in D1 daily prices (if we can map the product)
  if (DB && priceU > 0) {
    const d1Product = await DB.prepare(
      'SELECT hn_code FROM rm_products WHERE odoo_id = ?'
    ).bind(parseInt(product_id, 10)).first();
    if (d1Product) {
      await DB.prepare(
        'INSERT INTO rm_daily_prices (product_code, brand, price, recorded_by, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(d1Product.hn_code, brand, priceU, user.name, `po-add-line:${check.po.name}`, istNow().toISOString()).run();
    }
  }
  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('add_po_line', brand, user.name, JSON.stringify({
      po_id, po_name: check.po.name, product_id, product_name: prod[0].name, qty, price_unit: priceU,
    }), istNow().toISOString()).run();
  }

  return json({ success: true, po_name: check.po.name, product_id, product_name: prod[0].name, qty, price_unit: priceU });
}

async function editPOLine(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  const { po_id, line_id, qty, price_unit } = body;
  if (!po_id || !line_id) return json({ error: 'Missing po_id or line_id' }, 400);
  if (qty == null && price_unit == null) return json({ error: 'Nothing to update — provide qty or price_unit' }, 400);

  // Safety check: PO editable?
  const check = await checkPOEditable(sysCreds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  // Build update fields
  const updates = {};
  if (qty != null) {
    if (qty <= 0) return json({ error: 'Quantity must be positive' }, 400);
    updates.product_qty = qty;
  }
  if (price_unit != null) {
    if (price_unit < 0) return json({ error: 'Price cannot be negative' }, 400);
    updates.price_unit = price_unit;
  }

  // Write to Odoo
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order.line', 'write', [[line_id], updates], coCtx(cfg));

  // If price changed, update D1 daily prices
  if (price_unit != null && DB) {
    // Get the product code for this line
    const lineData = await odooCall(sysCreds.uid, sysCreds.key,
      'purchase.order.line', 'read', [[line_id]],
      { fields: ['product_id'] });
    if (lineData[0]) {
      const productId = lineData[0].product_id[0];
      const d1Product = await DB.prepare(
        'SELECT hn_code FROM rm_products WHERE odoo_id = ?'
      ).bind(productId).first();
      if (d1Product) {
        const now = istNow().toISOString();
        await DB.prepare(
          'INSERT INTO rm_daily_prices (product_code, brand, price, recorded_by, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(d1Product.hn_code, brand, price_unit, user.name, `po-edit:${check.po.name}`, now).run();
      }
    }
  }

  // Log
  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('edit_po_line', brand, user.name, JSON.stringify({
      po_id, po_name: check.po.name, line_id, changes: updates,
    }), istNow().toISOString()).run();
  }

  return json({ success: true, po_name: check.po.name, line_id, updated: updates });
}

/* ── Delete PO Line ── */

async function deletePOLine(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  const { po_id, line_id } = body;
  if (!po_id || !line_id) return json({ error: 'Missing po_id or line_id' }, 400);

  const check = await checkPOEditable(sysCreds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  // Count remaining lines — if this is the last one, cancel PO instead
  const existingLines = await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order.line', 'search_read',
    [[['order_id', '=', po_id]]],
    { fields: ['id'] });

  if (existingLines.length <= 1) {
    // Last line — cancel the entire PO
    await odooCall(sysCreds.uid, sysCreds.key,
      'purchase.order', 'button_cancel', [[po_id]], coCtx(cfg));

    if (DB) {
      await DB.prepare(
        'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind('cancel_po', brand, user.name, JSON.stringify({
        po_id, po_name: check.po.name, reason: 'last_line_deleted',
      }), istNow().toISOString()).run();
    }

    return json({ success: true, po_name: check.po.name, action: 'po_cancelled', reason: 'Last line removed — PO cancelled' });
  }

  // Confirmed POs don't allow line deletion directly.
  // Cycle: cancel → draft → delete line → reconfirm
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'button_cancel', [[po_id]], coCtx(cfg));
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'button_draft', [[po_id]], coCtx(cfg));
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'write', [[po_id], { order_line: [[2, line_id, 0]] }], coCtx(cfg));
  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'button_confirm', [[po_id]], coCtx(cfg));

  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('delete_po_line', brand, user.name, JSON.stringify({
      po_id, po_name: check.po.name, line_id,
    }), istNow().toISOString()).run();
  }

  return json({ success: true, po_name: check.po.name, line_id, action: 'line_deleted' });
}

/* ── Cancel PO ── */

async function cancelPO(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  const { po_id } = body;
  if (!po_id) return json({ error: 'Missing po_id' }, 400);

  const check = await checkPOEditable(sysCreds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  await odooCall(sysCreds.uid, sysCreds.key,
    'purchase.order', 'button_cancel', [[po_id]], coCtx(cfg));

  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('cancel_po', brand, user.name, JSON.stringify({
      po_id, po_name: check.po.name, reason: body.reason || 'user_cancelled',
    }), istNow().toISOString()).run();
  }

  return json({ success: true, po_name: check.po.name, action: 'cancelled' });
}

/* ── Pending Deliveries (receipts waiting to be received) ── */

async function getPendingDeliveries(creds, cfg) {
  // Find incoming pickings in 'assigned' (Ready) state for this company
  const pickings = await odooCall(creds.uid, creds.key,
    'stock.picking', 'search_read',
    [[
      ['picking_type_code', '=', 'incoming'],
      ['state', '=', 'assigned'],
      ['company_id', '=', cfg.company_id],
    ]],
    {
      fields: ['id', 'name', 'partner_id', 'scheduled_date', 'origin', 'state', 'purchase_id'],
      order: 'scheduled_date desc',
      limit: 30,
    }
  );

  if (!pickings || pickings.length === 0) {
    return json({ success: true, deliveries: [] });
  }

  // Fetch move lines for all pickings in one call
  const pickingIds = pickings.map(p => p.id);
  const moves = await odooCall(creds.uid, creds.key,
    'stock.move', 'search_read',
    [[['picking_id', 'in', pickingIds], ['state', '!=', 'cancel']]],
    { fields: ['id', 'picking_id', 'product_id', 'product_uom_qty', 'product_uom'] }
  );

  // Group moves by picking
  const movesByPicking = {};
  for (const m of moves) {
    const pid = m.picking_id[0];
    if (!movesByPicking[pid]) movesByPicking[pid] = [];
    movesByPicking[pid].push({
      id: m.id,
      product_id: m.product_id ? m.product_id[0] : null,
      product_name: m.product_id ? m.product_id[1] : 'Unknown',
      qty: m.product_uom_qty,
      uom: m.product_uom ? m.product_uom[1] : 'Units',
    });
  }

  return json({
    success: true,
    deliveries: pickings.map(p => ({
      picking_id: p.id,
      name: p.name,
      vendor: p.partner_id ? p.partner_id[1] : 'Unknown',
      vendor_id: p.partner_id ? p.partner_id[0] : null,
      date: p.scheduled_date,
      po_name: p.origin || '',
      po_id: p.purchase_id ? p.purchase_id[0] : null,
      items: movesByPicking[p.id] || [],
    })),
  });
}

/* ── Receive Delivery (validate incoming picking) ── */

async function receiveDelivery(body, user, creds, cfg, brand, DB, env) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }

  const { picking_id } = body;
  if (!picking_id) return json({ error: 'Missing picking_id' }, 400);

  // stock.picking.button_validate requires Odoo Inventory/User group (stock.group_stock_user).
  // Purchase users (Zoya) only have purchase.group_purchase_user — they can view receipts but
  // cannot call stock validation methods directly. Use system credentials for all Odoo stock
  // operations; dashboard-level auth is enforced by PIN + role check above.
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);

  // Verify picking exists and is in the right state
  const pickArr = await odooCall(sysCreds.uid, sysCreds.key,
    'stock.picking', 'read', [[picking_id]],
    { fields: ['id', 'name', 'state', 'company_id', 'origin'] }
  );

  if (!pickArr || pickArr.length === 0) return json({ error: 'Receipt not found' }, 404);
  const picking = pickArr[0];

  if (picking.state === 'done') return json({ error: 'Already received' }, 400);
  if (picking.state === 'cancel') return json({ error: 'Receipt is cancelled' }, 400);
  if (picking.state !== 'assigned') return json({ error: `Receipt state "${picking.state}" cannot be validated` }, 400);

  // Detect done-qty field name on stock.move.line.
  // 'product_uom_qty' / 'reserved_uom_qty' on stock.move.line have been renamed
  // multiple times across Odoo versions and are unreliable — DO NOT read from them.
  // Instead: read product_uom_qty from the parent stock.move (stable across all versions),
  // then write done qty directly to each move line.
  const mlFieldDef = await odooCall(sysCreds.uid, sysCreds.key,
    'stock.move.line', 'fields_get', [['quantity', 'qty_done']], { attributes: ['type'] });
  const doneField = mlFieldDef.quantity ? 'quantity' : 'qty_done';

  // Read stock.move records (demand qty lives here, stable in all Odoo versions)
  const moves = await odooCall(sysCreds.uid, sysCreds.key,
    'stock.move', 'search_read',
    [[['picking_id', '=', picking_id], ['state', 'not in', ['done', 'cancel']]]],
    { fields: ['id', 'product_uom_qty', 'move_line_ids', 'product_id'] }
  );

  // Write done qty on every move line, then handle lots
  const allMlIds = [];
  for (const mv of moves) {
    if (!mv.move_line_ids?.length) continue;
    allMlIds.push(...mv.move_line_ids);
    // Single line (typical): full qty. Multi-line (multi-location): split evenly.
    const qtyPerLine = mv.product_uom_qty / mv.move_line_ids.length;
    for (const mlId of mv.move_line_ids) {
      await odooCall(sysCreds.uid, sysCreds.key,
        'stock.move.line', 'write', [[mlId], { [doneField]: qtyPerLine }], coCtx(cfg));
    }
  }

  // Auto-create lot/serial numbers for tracked products that have no lot set yet
  if (allMlIds.length > 0) {
    const moveLines = await odooCall(sysCreds.uid, sysCreds.key,
      'stock.move.line', 'read', [allMlIds],
      { fields: ['id', 'lot_id', 'product_id'] }
    );
    for (const ml of moveLines) {
      if (!ml.lot_id) {
        const prodInfo = await odooCall(sysCreds.uid, sysCreds.key,
          'product.product', 'read', [[ml.product_id[0]]], { fields: ['tracking'] });
        if (prodInfo[0]?.tracking && prodInfo[0].tracking !== 'none') {
          const lotName = `RCV-${picking.name.replace(/\//g, '-')}-${ml.id}`;
          const lotId = await odooCall(sysCreds.uid, sysCreds.key,
            'stock.lot', 'create',
            [{ name: lotName, product_id: ml.product_id[0], company_id: cfg.company_id }], coCtx(cfg));
          await odooCall(sysCreds.uid, sysCreds.key,
            'stock.move.line', 'write', [[ml.id], { lot_id: lotId }], coCtx(cfg));
        }
      }
    }
  }

  // Validate the picking.
  // skip_immediate = don't show "Set Quantities" dialog (we just set them above)
  // skip_backorder = don't create partial backorder (receive everything that was reserved)
  await odooCall(sysCreds.uid, sysCreds.key,
    'stock.picking', 'button_validate', [[picking_id]],
    coCtx(cfg, { context: { skip_backorder: true, skip_immediate: true } }));

  // Verify the picking actually reached 'done' state — guard against Odoo returning
  // a wizard action dict instead of completing the validation
  const verifyArr = await odooCall(sysCreds.uid, sysCreds.key,
    'stock.picking', 'read', [[picking_id]], { fields: ['state'] });
  if (!verifyArr[0] || verifyArr[0].state !== 'done') {
    return json({ error: `Picking validated but state is "${verifyArr[0]?.state}" — check Odoo` }, 500);
  }

  if (DB) {
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('receive_delivery', brand, user.name, JSON.stringify({
      picking_id, picking_name: picking.name, origin: picking.origin,
    }), istNow().toISOString()).run();
  }

  return json({
    success: true,
    picking_name: picking.name,
    origin: picking.origin,
    action: 'received',
  });
}

/* ── Add New Product ── */

async function addProduct(body, user, creds, cfg, brand, env, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  if (!DB) return json({ error: 'Database not configured' }, 500);

  const { name, category, uom, vendor_key } = body;
  if (!name || !category || !uom) {
    return json({ error: 'Missing name, category, or uom' }, 400);
  }
  if (!vendor_key) {
    return json({ error: 'Mandatory: vendor_key. Every product must be mapped to at least one vendor.' }, 400);
  }

  // Verify vendor exists in D1
  const vendor = await DB.prepare('SELECT * FROM rm_vendors WHERE key = ?').bind(vendor_key).first();
  if (!vendor) return json({ error: `Vendor not found: ${vendor_key}` }, 400);

  // Auto-generate next HN-RM code
  const maxCode = await DB.prepare(
    "SELECT MAX(CAST(SUBSTR(hn_code, 7) AS INTEGER)) as max_num FROM rm_products WHERE hn_code LIKE 'HN-RM-%'"
  ).first();
  const nextNum = (maxCode?.max_num || 225) + 1;
  const hnCode = `HN-RM-${String(nextNum).padStart(3, '0')}`;

  // UoM mapping for Odoo
  const UOM_MAP = { kg: 15, L: 12, g: 14, ml: 11, Units: 1, pcs: 1, bundle: 1, cylinder: 1, load: 1 };
  const odooUomId = UOM_MAP[uom] || 1;

  // Find or create category in Odoo
  const brandLabel = brand === 'HE' ? 'Hamza Express' : 'Nawabi Chai House';
  const categName = `Goods / Raw Materials / ${brandLabel}`;
  let categId = null;

  // Use system credentials for category lookup
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
  const cats = await odooCall(sysCreds.uid, sysCreds.key,
    'product.category', 'search_read',
    [[['complete_name', 'like', categName]]],
    { fields: ['id'], limit: 1 }
  );
  if (cats.length > 0) categId = cats[0].id;

  // Create in Odoo
  const odooId = await odooCall(creds.uid, creds.key,
    'product.product', 'create',
    [{
      name,
      default_code: hnCode,
      type: 'consu',
      is_storable: true,
      uom_id: odooUomId,
      company_id: cfg.company_id,
      ...(categId ? { categ_id: categId } : {}),
    }], coCtx(cfg)
  );

  // Create in D1
  const now = istNow().toISOString();
  await DB.prepare(
    'INSERT INTO rm_products (hn_code, name, category, uom, brand, avg_cost, odoo_id, action) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
  ).bind(hnCode, name, category, uom, brand, odooId, 'KEEP').run();

  // Create vendor mapping
  await DB.prepare(
    'INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary) VALUES (?, ?, 1)'
  ).bind(hnCode, vendor_key).run();

  // Create supplierinfo in Odoo (link vendor to product)
  if (vendor.odoo_id) {
    await odooCall(creds.uid, creds.key,
      'product.supplierinfo', 'create',
      [{ partner_id: vendor.odoo_id, product_id: odooId, company_id: cfg.company_id }], coCtx(cfg)
    );
  }

  // Log
  await DB.prepare(
    'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind('add_product', brand, user.name, JSON.stringify({
    hn_code: hnCode, name, category, uom, vendor_key, odoo_id: odooId,
  }), now).run();

  return json({
    success: true, hn_code: hnCode, odoo_id: odooId,
    name, category, uom, brand, vendor_key,
    created_by: user.name,
  });
}

/* ── Update Price (manual) ── */

async function updatePrice(body, user, brand, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const { product_code, price } = body;
  if (!product_code || price == null) return json({ error: 'Missing product_code or price' }, 400);

  const now = istNow().toISOString();
  await DB.prepare(
    'INSERT INTO rm_daily_prices (product_code, brand, price, recorded_by, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(product_code, brand, price, user.name, 'manual', now).run();

  await DB.prepare(
    'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind('price_update', brand, user.name, JSON.stringify({ product_code, price }), now).run();

  return json({ success: true, product_code, brand, price, recorded_by: user.name });
}

/* ── Link Vendor to Product ── */

async function linkVendor(body, user, creds, cfg, brand, env, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }

  const { product_code, vendor_odoo_id } = body;
  if (!product_code || !vendor_odoo_id) return json({ error: 'Missing product_code or vendor_odoo_id' }, 400);

  // Find vendor in D1 by odoo_id, or create from Odoo
  let vendor = await DB.prepare('SELECT * FROM rm_vendors WHERE odoo_id = ?').bind(vendor_odoo_id).first();

  if (!vendor) {
    const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
    const v = await odooCall(sysCreds.uid, sysCreds.key, 'res.partner', 'read',
      [[vendor_odoo_id]], { fields: ['name', 'phone'] });
    if (!v.length) return json({ error: 'Vendor not found in Odoo' }, 404);

    const key = v[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await DB.prepare('INSERT OR IGNORE INTO rm_vendors (key, name, phone, odoo_id) VALUES (?, ?, ?, ?)')
      .bind(key, v[0].name, v[0].phone || '', vendor_odoo_id).run();
    vendor = await DB.prepare('SELECT * FROM rm_vendors WHERE odoo_id = ?').bind(vendor_odoo_id).first();
  }

  // Create product↔vendor mapping
  await DB.prepare('INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary) VALUES (?, ?, 0)')
    .bind(product_code, vendor.key).run();

  // Also link in Odoo (supplierinfo)
  const product = await DB.prepare('SELECT odoo_id FROM rm_products WHERE hn_code = ?').bind(product_code).first();
  if (product?.odoo_id && vendor.odoo_id) {
    try {
      await odooCall(creds.uid, creds.key, 'product.supplierinfo', 'create',
        [{ partner_id: vendor.odoo_id, product_id: product.odoo_id, company_id: cfg.company_id }], coCtx(cfg));
    } catch (_) { /* supplierinfo may already exist */ }
  }

  const now = istNow().toISOString();
  await DB.prepare(
    'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind('link_vendor', brand, user.name, JSON.stringify({
    product_code, vendor_key: vendor.key, vendor_odoo_id,
  }), now).run();

  return json({ success: true, product_code, vendor_key: vendor.key, vendor_name: vendor.name });
}

/* ── Settlement Submit (intelligence-driven) ── */

async function settlementSubmit(body, user, creds, cfg, brand, env, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);

  const { counts, raw_input, wastage_items, field_timestamps, notes, is_bootstrap } = body;

  // Must have either counts (direct mode) or raw_input (full decomposition mode)
  const hasCounts = counts && typeof counts === 'object' && Object.keys(counts).length > 0;
  const hasRawInput = raw_input && typeof raw_input === 'object' && Object.keys(raw_input).length > 0;
  if (!hasCounts && !hasRawInput) {
    return json({ error: 'Missing counts or raw_input' }, 400);
  }

  const now = istNow();
  const nowISO = now.toISOString();
  const settlementDate = nowISO.slice(0, 10);

  // Guard against rapid re-submission
  const lastSettlement = await DB.prepare(
    'SELECT settled_at FROM rm_settlements WHERE brand = ? ORDER BY settled_at DESC LIMIT 1'
  ).bind(brand).first();
  if (lastSettlement) {
    const lastTime = new Date(lastSettlement.settled_at).getTime();
    if (Date.now() - lastTime < 120000) {
      return json({ error: 'A settlement was just submitted. Wait 2 minutes.' }, 429);
    }
  }

  // Load intelligence from D1
  const intelligence = await loadIntelligence(brand, DB);
  const hasDecomposition = intelligence.ratios.length > 0;
  const mode = hasRawInput && hasDecomposition ? 'full' : 'direct';

  // Get previous settlement for opening stock
  const previous = await DB.prepare(
    'SELECT * FROM rm_settlements WHERE brand = ? AND status IN (?, ?) ORDER BY settled_at DESC LIMIT 1'
  ).bind(brand, 'completed', 'bootstrap').first();

  const periodStart = previous ? previous.settled_at : nowISO;
  const periodEnd = nowISO;

  let openingStock = {};
  if (previous && previous.closing_stock) {
    openingStock = JSON.parse(previous.closing_stock);
  }

  // ── Step 1: Build closing stock ──
  let closingStock;
  let decomposedRawInput = null;

  if (mode === 'full') {
    // Full decomposition: convert physical forms → raw materials
    decomposedRawInput = decomposeInput(raw_input, intelligence);
    // Merge direct counts first, then overlay decomposed values (decomposed wins for covered items)
    closingStock = { ...(counts || {}), ...decomposedRawInput };
  } else {
    // Direct mode: counts ARE the closing stock
    closingStock = { ...counts };
  }

  // ── Step 2: Gap adjustment (full mode only) ──
  let timestampAdjustments = {};
  if (mode === 'full' && field_timestamps && Object.keys(field_timestamps).length > 0) {
    const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
    const adjResult = await adjustForGaps(
      closingStock, field_timestamps, intelligence, sysCreds, cfg
    );
    closingStock = adjResult.closingStock;
    timestampAdjustments = adjResult.adjustments;
  }

  // ── Bootstrap: just store the count, no consumption/P&L ──
  if (is_bootstrap) {
    await DB.prepare(`INSERT INTO rm_settlements
      (brand, settlement_date, settled_by, period_start, period_end,
       opening_stock, closing_stock, purchased, consumed, cost_summary, notes, status, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bootstrap', ?)`
    ).bind(
      brand, settlementDate, user.name, nowISO, nowISO,
      JSON.stringify(closingStock), JSON.stringify(closingStock),
      '{}', '{}', '{}', notes || '', nowISO
    ).run();

    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('settlement_bootstrap', brand, user.name,
      JSON.stringify({ settlement_date: settlementDate, items: Object.keys(closingStock).length, mode }),
      nowISO).run();

    return json({
      success: true, brand, settlementDate, settledBy: user.name,
      status: 'bootstrap', mode,
      inventory: closingStock,
      rawInput: raw_input || null,
    });
  }

  // ── Step 3: Fetch purchases received in period ──
  const fromOdoo = toOdooDatetime(istToUTC(periodStart));
  const toOdoo = toOdooDatetime(istToUTC(periodEnd));
  const sysCreds = getOdooCredentials({ odoo: 'system' }, env);
  const purchased = await fetchPurchasesReceived(sysCreds, cfg, fromOdoo, toOdoo);

  // ── Step 4: Calculate ACTUAL consumption ──
  const consumed = {};
  const consumptionWarnings = [];
  const allCodes = new Set([
    ...Object.keys(openingStock),
    ...Object.keys(purchased),
    ...Object.keys(closingStock),
  ]);

  for (const code of allCodes) {
    const opening = openingStock[code] || 0;
    const purch = purchased[code] || 0;
    const closing = closingStock[code] || 0;
    const used = round(opening + purch - closing, 4);
    if (used !== 0 || opening > 0 || purch > 0) {
      consumed[code] = used;
      if (used < -0.001) {
        consumptionWarnings.push({
          code, opening, purchased: purch, closing, used,
          message: `Negative: closing (${closing}) > opening (${opening}) + purchased (${purch})`
        });
      }
    }
  }

  // ── Step 5: Calculate EXPECTED consumption from recipes ──
  let expectedConsumption = {};
  let posSales = null;
  if (intelligence.recipes.length > 0) {
    posSales = await fetchPOSSales(sysCreds, cfg, fromOdoo, toOdoo);
    expectedConsumption = calculateExpected(posSales, intelligence.recipesMap);
  }

  // ── Step 6: Decompose wastage → raw materials ──
  const wastedRaw = decomposeWastage(wastage_items, intelligence.wastageRulesMap);

  // ── Step 7: Discrepancy = consumed - expected - wastage ──
  const discrepancy = {};
  let discrepancyValue = 0;
  const allDiscCodes = new Set([...Object.keys(consumed), ...Object.keys(expectedConsumption)]);

  // Get latest prices for cost calculations
  const priceMap = {};
  for (const code of allCodes) {
    const price = await DB.prepare(
      'SELECT price FROM rm_daily_prices WHERE product_code = ? AND brand = ? ORDER BY recorded_at DESC LIMIT 1'
    ).bind(code, brand).first();
    if (price) {
      priceMap[code] = price.price;
    } else {
      const product = await DB.prepare('SELECT avg_cost FROM rm_products WHERE hn_code = ?').bind(code).first();
      priceMap[code] = product?.avg_cost || 0;
    }
  }

  for (const code of allDiscCodes) {
    const actual = consumed[code] || 0;
    const expected = expectedConsumption[code] || 0;
    const wasted = wastedRaw[code] || 0;
    const disc = round(actual - expected - wasted, 4);
    if (Math.abs(disc) > 0.001) {
      const cost = priceMap[code] || 0;
      const discValue = round(disc * cost, 2);
      discrepancy[code] = { qty: disc, value: discValue };
      discrepancyValue += discValue;
    }
  }
  discrepancyValue = round(discrepancyValue, 2);

  // ── Step 8: COGS ──
  let cogsActual = 0;
  for (const [code, qty] of Object.entries(consumed)) {
    cogsActual += Math.max(0, qty) * (priceMap[code] || 0);
  }
  cogsActual = round(cogsActual, 2);

  let cogsExpected = 0;
  for (const [code, qty] of Object.entries(expectedConsumption)) {
    cogsExpected += qty * (priceMap[code] || 0);
  }
  cogsExpected = round(cogsExpected, 2);

  let wastageValue = 0;
  for (const [code, qty] of Object.entries(wastedRaw)) {
    wastageValue += qty * (priceMap[code] || 0);
  }
  wastageValue = round(wastageValue, 2);

  // ── Step 9: P&L ──
  const revenue = posSales ? posSales.revenue : 0;
  const grossProfit = round(revenue - cogsActual, 2);
  const netProfit = round(grossProfit - wastageValue, 2);

  // ── Step 10: Build cost summary ──
  const costSummary = { total: cogsActual, per_item: {} };
  for (const code of allCodes) {
    const qty = consumed[code] || 0;
    const price = priceMap[code] || 0;
    costSummary.per_item[code] = { consumed: qty, price, cost: round(qty * price, 2) };
  }

  // ── Step 11: Store settlement ──
  const fullDetails = JSON.stringify({
    mode, cogsActual, cogsExpected, revenue, grossProfit, netProfit,
    wastageValue, discrepancyValue,
    expectedConsumption, wastedRaw, discrepancy,
    timestampAdjustments: Object.keys(timestampAdjustments).length > 0 ? timestampAdjustments : null,
    warnings: consumptionWarnings.length > 0 ? consumptionWarnings : null,
    rawInput: raw_input || null,
    decomposed: decomposedRawInput,
    posSales: posSales ? { orders: posSales.orders, revenue: posSales.revenue } : null,
  });

  await DB.prepare(`INSERT INTO rm_settlements
    (brand, settlement_date, settled_by, period_start, period_end,
     opening_stock, closing_stock, purchased, consumed, pos_revenue, cost_summary, notes, status, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  ).bind(
    brand, settlementDate, user.name, periodStart, periodEnd,
    JSON.stringify(openingStock),
    JSON.stringify(closingStock),
    JSON.stringify(purchased),
    JSON.stringify(consumed),
    fullDetails,
    JSON.stringify(costSummary),
    notes || '', nowISO
  ).run();

  // ── Step 12: Sync closing stock to Odoo ──
  let odooSyncResult = null;
  try {
    odooSyncResult = await syncStockToOdoo(creds, cfg, closingStock, DB);
  } catch (syncErr) {
    odooSyncResult = { error: syncErr.message };
  }

  // ── Step 13: Upload settlement photos to Google Drive ──
  let drivePhotos = [];
  if (body.item_photos?.length > 0) {
    try {
      drivePhotos = await uploadSettlementPhotos(body.item_photos, brand, user.name, now, env);
    } catch (driveErr) {
      drivePhotos = [{ error: driveErr.message }];
    }
  }

  // Log
  await DB.prepare(
    'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind('settlement', brand, user.name,
    JSON.stringify({ settlement_date: settlementDate, items: Object.keys(closingStock).length,
      mode, cogs: cogsActual, revenue, net: netProfit }),
    nowISO).run();

  return json({
    success: true, brand, settlementDate, settledBy: user.name,
    status: 'completed', mode,
    pnl: { revenue, cogs: cogsActual, cogsExpected, grossProfit, netProfit,
            wastage: wastageValue, discrepancy: discrepancyValue },
    period: { start: periodStart, end: periodEnd },
    inventory: { opening: openingStock, purchased, closing: closingStock, consumed,
                 expected: expectedConsumption, discrepancy, wastedRaw },
    costSummary,
    warnings: consumptionWarnings.length > 0 ? consumptionWarnings : undefined,
    timestampAdjustments: Object.keys(timestampAdjustments).length > 0 ? timestampAdjustments : undefined,
    odooSyncResult,
    drivePhotos: drivePhotos.length > 0 ? drivePhotos : undefined,
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Intelligence Engine — data-driven from D1 tables
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── Load all intelligence for a brand from D1 ── */

async function loadIntelligence(brand, DB) {
  if (!DB) return { recipes: [], recipesMap: {}, ratios: [], ratiosMap: {},
    vessels: [], densities: {}, zones: {}, fieldZones: {}, fieldProducts: {},
    wastageRules: [], wastageRulesMap: {}, wastageItems: [] };

  const [recipesR, ratiosR, vesselsR, densitiesR, zonesR, fieldZonesR, fieldProductsR, wastageR] =
    await Promise.all([
      DB.prepare('SELECT * FROM rm_recipes WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_decomposition_ratios WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_vessels WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_density_constants WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_zones WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_field_zones WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_field_products WHERE brand = ?').bind(brand).all(),
      DB.prepare('SELECT * FROM rm_wastage_rules WHERE brand = ?').bind(brand).all(),
    ]);

  // Build recipesMap: { pos_product_id: { name, materials: { material_code: qty_per_unit } } }
  const recipesMap = {};
  for (const r of (recipesR.results || [])) {
    if (!recipesMap[r.pos_product_id]) {
      recipesMap[r.pos_product_id] = { name: r.pos_product_name, materials: {} };
    }
    recipesMap[r.pos_product_id].materials[r.material_code] = r.qty_per_unit;
  }

  // Build ratiosMap: { ratio_name: { material_code: factor } }
  const ratiosMap = {};
  for (const r of (ratiosR.results || [])) {
    if (!ratiosMap[r.ratio_name]) ratiosMap[r.ratio_name] = {};
    ratiosMap[r.ratio_name][r.material_code] = r.factor;
  }

  // Build vessels: { vessel_code: { name, liquid_type, location, tare_weight_kg } }
  const vessels = {};
  for (const v of (vesselsR.results || [])) {
    vessels[v.vessel_code] = {
      name: v.vessel_name, liquid_type: v.liquid_type,
      location: v.location, tare_weight_kg: v.tare_weight_kg,
    };
  }

  // Build densities: { material_type: density }
  const densities = {};
  for (const d of (densitiesR.results || [])) {
    densities[d.material_type] = d.density;
  }

  // Build zones: { zone_name: threshold_seconds }
  const zones = {};
  for (const z of (zonesR.results || [])) {
    zones[z.zone_name] = z.gap_threshold_seconds;
  }

  // Build fieldZones: { field_name: zone_name }
  const fieldZones = {};
  for (const fz of (fieldZonesR.results || [])) {
    fieldZones[fz.field_name] = fz.zone_name;
  }

  // Build fieldProducts: { field_name: [pos_product_id, ...] }
  const fieldProducts = {};
  for (const fp of (fieldProductsR.results || [])) {
    if (!fieldProducts[fp.field_name]) fieldProducts[fp.field_name] = [];
    fieldProducts[fp.field_name].push(fp.pos_product_id);
  }

  // Build wastageRulesMap: { wastage_item: { states: { state: { label, decomp: { code: factor } } } } }
  const wastageRulesMap = {};
  const wastageItemSet = new Set();
  for (const w of (wastageR.results || [])) {
    if (!wastageRulesMap[w.wastage_item]) {
      wastageRulesMap[w.wastage_item] = { states: {} };
    }
    if (!wastageRulesMap[w.wastage_item].states[w.wastage_state]) {
      wastageRulesMap[w.wastage_item].states[w.wastage_state] = {
        label: w.label || w.wastage_state, uom: w.uom, decomp: {},
      };
    }
    wastageRulesMap[w.wastage_item].states[w.wastage_state].decomp[w.material_code] = w.factor;
    wastageItemSet.add(w.wastage_item);
  }

  // wastageItems: summary for UI (which items + states available)
  const wastageItems = [];
  for (const item of wastageItemSet) {
    const states = Object.entries(wastageRulesMap[item].states).map(([s, v]) => ({
      state: s, label: v.label, uom: v.uom,
    }));
    wastageItems.push({ item, states });
  }

  return {
    recipes: recipesR.results || [],
    recipesMap,
    ratios: ratiosR.results || [],
    ratiosMap,
    vessels,
    densities,
    zones,
    fieldZones,
    fieldProducts,
    wastageRules: wastageR.results || [],
    wastageRulesMap,
    wastageItems,
  };
}

/* ── Decompose raw input → raw material totals (reads from D1 intelligence) ── */

function decomposeInput(input, intelligence) {
  const { ratiosMap, vessels, densities } = intelligence;
  const totals = {};
  const add = (code, qty) => {
    totals[code] = round((totals[code] || 0) + qty, 4);
  };

  // Helper: process vessel weight entries → litres
  const processVessels = (entries, liquidType) => {
    if (!entries || !Array.isArray(entries) || entries.length === 0) return 0;
    const density = densities[liquidType] || 1.0;
    let totalLitres = 0;
    for (const entry of entries) {
      const vessel = vessels[entry.vessel_code];
      const tare = vessel ? vessel.tare_weight_kg : 0;
      const netKg = Math.max(0, (entry.weight_kg || 0) - tare);
      totalLitres += netKg / density;
    }
    return round(totalLitres, 4);
  };

  // Helper: apply a named decomposition ratio
  const applyRatio = (ratioName, qty) => {
    const ratio = ratiosMap[ratioName];
    if (!ratio || qty <= 0) return;
    for (const [code, factor] of Object.entries(ratio)) {
      add(code, qty * factor);
    }
  };

  // ── RAW MATERIALS (direct kg/L/units) ──
  if (input.raw_buffalo_milk) add('HN-RM-200', input.raw_buffalo_milk);
  if (input.raw_milkmaid) add('HN-RM-209', input.raw_milkmaid);
  if (input.raw_smp) add('HN-RM-201', input.raw_smp);

  // Sugar: container weighing or direct
  if (input.sugar_container && Array.isArray(input.sugar_container) && input.sugar_container.length > 0) {
    const netKg = processVessels(input.sugar_container, 'dry_goods');
    if (netKg > 0) add('HN-RM-029', netKg);
  } else if (input.raw_sugar) {
    add('HN-RM-029', input.raw_sugar);
  }

  // Tea Powder: container weighing or direct
  if (input.tea_powder_container && Array.isArray(input.tea_powder_container) && input.tea_powder_container.length > 0) {
    const netKg = processVessels(input.tea_powder_container, 'dry_goods');
    if (netKg > 0) add('HN-RM-202', netKg);
  } else if (input.raw_tea_powder) {
    add('HN-RM-202', input.raw_tea_powder);
  }

  if (input.butter) add('HN-RM-213', input.butter);
  if (input.coffee_powder) add('HN-RM-214', input.coffee_powder);
  if (input.honey) add('HN-RM-215', input.honey);
  if (input.lemons) add('HN-RM-065', input.lemons);
  if (input.oil) add('HN-RM-211', input.oil);

  // ── WATER BOTTLES (kitchen + display) ──
  const waterTotal = (input.water_bottles_kitchen || 0) + (input.water_bottles_display || 0) + (input.water_bottles || 0);
  if (waterTotal) add('HN-RM-207', waterTotal);

  // ── BOILED MILK (vessel weight → litres → decompose) ──
  const boiledMilkL = processVessels(input.boiled_milk_kitchen, 'boiled_milk')
    + processVessels(input.boiled_milk_counter, 'boiled_milk');
  if (boiledMilkL > 0) applyRatio('boiled_milk', boiledMilkL);

  // ── TEA DECOCTION (vessel weight → litres → decompose) ──
  const decoctionL = processVessels(input.tea_decoction_kitchen, 'tea_decoction')
    + processVessels(input.tea_decoction_counter, 'tea_decoction')
    + processVessels(input.tea_decoction, 'tea_decoction');
  if (decoctionL > 0) applyRatio('tea_decoction', decoctionL);

  // ── TEA-SUGAR BOXES ──
  if (input.tea_sugar_boxes) applyRatio('tea_sugar_box', input.tea_sugar_boxes);

  // ── PLAIN BUNS ──
  if (input.plain_buns) add('HN-RM-204', input.plain_buns);

  // ── PREPARED BUN MASKA → decompose ──
  if (input.prepared_bun_maska) applyRatio('bun_maska', input.prepared_bun_maska);

  // ── FRIED ITEMS (kitchen + display, count → raw + oil) ──
  if (input.raw_cutlets) add('HN-RM-206', input.raw_cutlets);
  const friedCutlets = (input.fried_cutlets_kitchen || 0) + (input.fried_cutlets_display || 0) + (input.fried_cutlets || 0);
  if (friedCutlets) {
    add('HN-RM-206', friedCutlets);
    const oilRatio = ratiosMap['fried_cutlet_oil'];
    if (oilRatio) for (const [code, factor] of Object.entries(oilRatio)) add(code, friedCutlets * factor);
  }

  if (input.raw_samosa) add('HN-RM-210', input.raw_samosa);
  const friedSamosa = (input.fried_samosa_kitchen || 0) + (input.fried_samosa_display || 0) + (input.fried_samosa || 0);
  if (friedSamosa) {
    add('HN-RM-210', friedSamosa);
    const oilRatio = ratiosMap['fried_samosa_oil'];
    if (oilRatio) for (const [code, factor] of Object.entries(oilRatio)) add(code, friedSamosa * factor);
  }

  if (input.raw_cheese_balls) add('HN-RM-212', input.raw_cheese_balls);
  const friedCheese = (input.fried_cheese_balls_kitchen || 0) + (input.fried_cheese_balls_display || 0) + (input.fried_cheese_balls || 0);
  if (friedCheese) {
    add('HN-RM-212', friedCheese);
    const oilRatio = ratiosMap['fried_cheese_ball_oil'];
    if (oilRatio) for (const [code, factor] of Object.entries(oilRatio)) add(code, friedCheese * factor);
  }

  // ── OSMANIA BISCUITS (packets + loose) ──
  const osmaniaPackets = (input.osmania_packets_kitchen || 0) + (input.osmania_packets_display || 0) + (input.osmania_packets || 0);
  if (osmaniaPackets) {
    const packetRatio = ratiosMap['osmania_packet'];
    if (packetRatio && packetRatio['HN-RM-205']) {
      add('HN-RM-205', osmaniaPackets * packetRatio['HN-RM-205']);
    } else {
      add('HN-RM-205', osmaniaPackets * 24); // fallback 24 per packet
    }
  }
  const osmaniaLoose = (input.osmania_loose_display || 0) + (input.osmania_loose || 0);
  if (osmaniaLoose) add('HN-RM-205', osmaniaLoose);

  // ── NILOUFER BOXES ──
  const nilouferTotal = (input.niloufer_kitchen || 0) + (input.niloufer_display || 0) + (input.niloufer_storage || 0);
  if (nilouferTotal) add('HN-RM-208', nilouferTotal);

  return totals;
}

/* ── Gap adjustment: compensate for items counted at different times ── */

async function adjustForGaps(closingStock, fieldTimestamps, intelligence, creds, cfg) {
  const { zones, fieldZones, fieldProducts, recipesMap } = intelligence;
  const adjustments = {};
  const adjusted = { ...closingStock };

  // Find the latest timestamp (effective submission time)
  let latestTs = 0;
  for (const isoStr of Object.values(fieldTimestamps)) {
    const t = new Date(isoStr).getTime();
    if (t > latestTs) latestTs = t;
  }
  if (latestTs === 0) return { closingStock: adjusted, adjustments };

  // Build gap queries
  const gapQueries = [];
  for (const [fieldId, isoStr] of Object.entries(fieldTimestamps)) {
    const productIds = fieldProducts[fieldId];
    if (!productIds || productIds.length === 0) continue;

    const fieldTs = new Date(isoStr).getTime();
    const gapSeconds = (latestTs - fieldTs) / 1000;
    const zone = fieldZones[fieldId] || 'kitchen';
    const threshold = zones[zone] || 600;

    if (gapSeconds >= threshold) {
      gapQueries.push({
        fieldId, gapSeconds: Math.round(gapSeconds), productIds,
        fromUTC: new Date(fieldTs).toISOString().slice(0, 19).replace('T', ' '),
        toUTC: new Date(latestTs).toISOString().slice(0, 19).replace('T', ' '),
      });
    }
  }

  if (gapQueries.length === 0) return { closingStock: adjusted, adjustments };

  // Execute gap queries in parallel
  const gapResults = await Promise.all(
    gapQueries.map(gq =>
      fetchGapSalesForProducts(creds, cfg, gq.productIds, gq.fromUTC, gq.toUTC)
        .then(sales => ({ ...gq, sales }))
        .catch(e => ({ ...gq, sales: {}, error: e.message }))
    )
  );

  // Decompose gap sales into raw materials and subtract from closing
  for (const gq of gapResults) {
    const fieldAdj = { gapSeconds: gq.gapSeconds, productsSold: {}, rawAdjusted: {} };

    for (const [pid, salesData] of Object.entries(gq.sales)) {
      const recipe = recipesMap[parseInt(pid)];
      if (!recipe || salesData.qty <= 0) continue;

      fieldAdj.productsSold[pid] = { name: salesData.name, qty: salesData.qty };

      for (const [code, qtyPerUnit] of Object.entries(recipe.materials)) {
        const rawQty = round(salesData.qty * qtyPerUnit, 4);
        if (adjusted[code] !== undefined) {
          adjusted[code] = round(adjusted[code] - rawQty, 4);
          if (adjusted[code] < 0) adjusted[code] = 0;
        }
        fieldAdj.rawAdjusted[code] = round((fieldAdj.rawAdjusted[code] || 0) + rawQty, 4);
      }
    }

    if (Object.keys(fieldAdj.productsSold).length > 0) {
      adjustments[gq.fieldId] = fieldAdj;
    }
  }

  return { closingStock: adjusted, adjustments };
}

/* ── Calculate expected consumption: POS sales × recipes ── */

function calculateExpected(posSales, recipesMap) {
  const expected = {};
  if (!posSales || !posSales.items) return expected;

  for (const item of posSales.items) {
    const recipe = recipesMap[item.productId];
    if (!recipe) continue;
    for (const [code, qtyPerUnit] of Object.entries(recipe.materials)) {
      expected[code] = round((expected[code] || 0) + item.qty * qtyPerUnit, 4);
    }
  }
  return expected;
}

/* ── Decompose wastage items → raw material equivalents ── */

function decomposeWastage(wastageItems, wastageRulesMap) {
  const wastedRaw = {};
  if (!wastageItems || !Array.isArray(wastageItems)) return wastedRaw;

  for (const w of wastageItems) {
    if (!w.item || !w.state || !w.qty) continue;
    const rule = wastageRulesMap[w.item];
    if (!rule || !rule.states[w.state]) continue;

    for (const [code, factor] of Object.entries(rule.states[w.state].decomp)) {
      wastedRaw[code] = round((wastedRaw[code] || 0) + w.qty * factor, 4);
    }
  }
  return wastedRaw;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Shared Odoo Data Fetchers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── POS Sales ── */

async function fetchPOSSales(creds, cfg, fromOdoo, toOdoo) {
  const orderIds = await odooCall(creds.uid, creds.key,
    'pos.order', 'search',
    [[['config_id', 'in', cfg.pos_configs],
      ['date_order', '>=', fromOdoo],
      ['date_order', '<=', toOdoo],
      ['state', 'in', ['paid', 'done', 'invoiced', 'posted']]]]
  );

  if (!orderIds || orderIds.length === 0) return { orders: 0, revenue: 0, items: [] };

  const lines = await odooCall(creds.uid, creds.key,
    'pos.order.line', 'search_read',
    [[['order_id', 'in', orderIds]]],
    { fields: ['product_id', 'qty', 'price_subtotal_incl'] }
  );

  const grouped = {};
  let totalRevenue = 0;
  for (const line of lines) {
    const pid = line.product_id[0];
    const pname = line.product_id[1];
    if (!grouped[pid]) grouped[pid] = { productId: pid, name: pname, qty: 0, amount: 0 };
    grouped[pid].qty += line.qty;
    grouped[pid].amount += line.price_subtotal_incl;
    totalRevenue += line.price_subtotal_incl;
  }

  return {
    orders: orderIds.length,
    revenue: round(totalRevenue),
    items: Object.values(grouped).sort((a, b) => b.amount - a.amount),
  };
}

/* ── Gap Sales for Products (used by gap adjustment) ── */

async function fetchGapSalesForProducts(creds, cfg, productIds, fromOdoo, toOdoo) {
  const orderIds = await odooCall(creds.uid, creds.key,
    'pos.order', 'search',
    [[['config_id', 'in', cfg.pos_configs],
      ['date_order', '>=', fromOdoo],
      ['date_order', '<=', toOdoo],
      ['state', 'in', ['paid', 'done', 'invoiced', 'posted']]]]
  );

  if (!orderIds || orderIds.length === 0) return {};

  const lines = await odooCall(creds.uid, creds.key,
    'pos.order.line', 'search_read',
    [[['order_id', 'in', orderIds], ['product_id', 'in', productIds]]],
    { fields: ['product_id', 'qty'] }
  );

  const sales = {};
  for (const line of lines) {
    const pid = line.product_id[0];
    if (!sales[pid]) sales[pid] = { name: line.product_id[1], qty: 0 };
    sales[pid].qty += line.qty;
  }
  return sales;
}

/* ── Stock Transfers ── */

async function fetchTransfers(creds, cfg, fromOdoo, toOdoo) {
  const result = { sentToKitchen: {}, returned: {}, wasted: {} };
  const pickTypeIds = [
    cfg.picking_types.to_kitchen,
    cfg.picking_types.from_cold,
    cfg.picking_types.return,
    cfg.picking_types.wastage,
  ];

  const pickings = await odooCall(creds.uid, creds.key,
    'stock.picking', 'search_read',
    [[['picking_type_id', 'in', pickTypeIds],
      ['state', '=', 'done'],
      ['date_done', '>=', fromOdoo],
      ['date_done', '<=', toOdoo],
      ['company_id', '=', cfg.company_id]]],
    { fields: ['id', 'picking_type_id', 'move_ids'] }
  );

  if (!pickings || pickings.length === 0) return result;

  const allMoveIds = pickings.flatMap(p => p.move_ids || []);
  if (allMoveIds.length === 0) return result;

  const moves = await odooCall(creds.uid, creds.key,
    'stock.move', 'read', [allMoveIds],
    { fields: ['id', 'product_id', 'quantity', 'picking_id'] }
  );

  const pickTypeMap = {};
  for (const p of pickings) pickTypeMap[p.id] = p.picking_type_id[0];

  for (const move of moves) {
    const pid = move.product_id[0];
    const qty = move.quantity || 0;
    const typeId = pickTypeMap[move.picking_id[0]];

    if (typeId === cfg.picking_types.to_kitchen || typeId === cfg.picking_types.from_cold) {
      result.sentToKitchen[pid] = (result.sentToKitchen[pid] || 0) + qty;
    } else if (typeId === cfg.picking_types.return) {
      result.returned[pid] = (result.returned[pid] || 0) + qty;
    } else if (typeId === cfg.picking_types.wastage) {
      result.wasted[pid] = (result.wasted[pid] || 0) + qty;
    }
  }
  return result;
}

/* ── Kitchen Stock ── */

async function fetchKitchenStockRaw(creds, cfg) {
  const quants = await odooCall(creds.uid, creds.key,
    'stock.quant', 'search_read',
    [[['location_id', '=', cfg.locations.KITCHEN],
      ['quantity', '>', 0],
      ['company_id', '=', cfg.company_id]]],
    { fields: ['product_id', 'quantity'] }
  );

  if (!quants || quants.length === 0) return [];

  const grouped = {};
  for (const q of quants) {
    const pid = q.product_id[0];
    if (!grouped[pid]) grouped[pid] = { productId: pid, name: q.product_id[1], qty: 0 };
    grouped[pid].qty += q.quantity;
  }
  return Object.values(grouped).map(item => ({ ...item, qty: round(item.qty) }));
}

/* ── Purchases Received in Period ── */

async function fetchPurchasesReceived(creds, cfg, fromOdoo, toOdoo, withDetail = false) {
  // Find incoming pickings (receipts) that were completed in the period
  const pickingFields = withDetail
    ? ['id', 'name', 'partner_id', 'date_done', 'move_ids']
    : ['id', 'move_ids'];

  const pickings = await odooCall(creds.uid, creds.key,
    'stock.picking', 'search_read',
    [[['picking_type_id.code', '=', 'incoming'],
      ['state', '=', 'done'],
      ['date_done', '>=', fromOdoo],
      ['date_done', '<=', toOdoo],
      ['company_id', '=', cfg.company_id]]],
    { fields: pickingFields, order: 'date_done desc' }
  );

  if (!pickings || pickings.length === 0) return withDetail ? { purchased: {}, deliveries: [] } : {};

  const allMoveIds = pickings.flatMap(p => p.move_ids || []);
  if (allMoveIds.length === 0) return withDetail ? { purchased: {}, deliveries: [] } : {};

  const moveFields = withDetail
    ? ['id', 'picking_id', 'product_id', 'quantity', 'price_unit', 'product_uom']
    : ['product_id', 'quantity'];

  const moves = await odooCall(creds.uid, creds.key,
    'stock.move', 'read', [allMoveIds],
    { fields: moveFields }
  );

  // Extract HN-RM code from product name "[HN-RM-XXX] Name" or via default_code
  const codeMap = {};
  for (const move of moves) {
    const nameMatch = move.product_id[1]?.match(/\[([^\]]+)\]/);
    if (nameMatch && nameMatch[1].startsWith('HN-RM-')) {
      codeMap[move.product_id[0]] = nameMatch[1];
    }
  }
  // Fallback: batch fetch default_code for any still unmapped
  const unmapped = [...new Set(moves.map(m => m.product_id[0]).filter(id => !codeMap[id]))];
  if (unmapped.length > 0) {
    const products = await odooCall(creds.uid, creds.key,
      'product.product', 'read', [unmapped], { fields: ['id', 'default_code'] });
    for (const p of products) {
      if (p.default_code?.startsWith('HN-RM-')) codeMap[p.id] = p.default_code;
    }
  }

  // Aggregate by HN-RM code
  const purchased = {};
  for (const move of moves) {
    const code = codeMap[move.product_id[0]];
    if (code) purchased[code] = (purchased[code] || 0) + (move.quantity || 0);
  }

  if (!withDetail) return purchased;

  // Build per-picking delivery detail
  const movesByPicking = {};
  for (const move of moves) {
    const pid = move.picking_id?.[0] || move.picking_id;
    if (!movesByPicking[pid]) movesByPicking[pid] = [];
    movesByPicking[pid].push(move);
  }

  const deliveries = pickings.map(p => ({
    picking_id: p.id,
    picking_name: p.name,
    vendor: p.partner_id?.[1] || 'Unknown',
    date_done: p.date_done,
    items: (movesByPicking[p.id] || [])
      .map(m => {
        const code = codeMap[m.product_id[0]];
        const rawName = m.product_id[1] || '';
        const name = rawName.replace(/^\[[^\]]+\]\s*/, ''); // strip [HN-RM-XXX] prefix
        return code ? {
          code, name,
          qty: round(m.quantity || 0, 3),
          uom: m.product_uom?.[1] || '',
          unit_cost: round(m.price_unit || 0, 2),
          total_cost: round((m.quantity || 0) * (m.price_unit || 0), 2),
        } : null;
      })
      .filter(Boolean),
  })).filter(d => d.items.length > 0);

  return { purchased, deliveries };
}

/* ── Sync Stock to Odoo (after settlement) ── */

async function syncStockToOdoo(creds, cfg, counts, DB) {
  const results = [];

  for (const [code, qty] of Object.entries(counts)) {
    // Get Odoo product ID from D1
    const product = await DB.prepare(
      'SELECT odoo_id FROM rm_products WHERE hn_code = ?'
    ).bind(code).first();

    if (!product || !product.odoo_id) continue;

    // Find existing stock.quant at MAIN location
    const quants = await odooCall(creds.uid, creds.key,
      'stock.quant', 'search_read',
      [[['product_id', '=', product.odoo_id],
        ['location_id', '=', cfg.locations.MAIN],
        ['company_id', '=', cfg.company_id]]],
      { fields: ['id', 'quantity'], limit: 1 }
    );

    if (quants.length > 0) {
      // Update existing quant
      const diff = qty - quants[0].quantity;
      if (Math.abs(diff) > 0.001) {
        await odooCall(creds.uid, creds.key,
          'stock.quant', 'write',
          [[quants[0].id], { inventory_quantity: qty }], coCtx(cfg)
        );
        await odooCall(creds.uid, creds.key,
          'stock.quant', 'action_apply_inventory', [[quants[0].id]], coCtx(cfg)
        );
        results.push({ code, odoo_id: product.odoo_id, action: 'updated', from: quants[0].quantity, to: qty });
      } else {
        results.push({ code, odoo_id: product.odoo_id, action: 'unchanged' });
      }
    } else if (qty > 0) {
      // Create new quant via inventory adjustment
      const newQuant = await odooCall(creds.uid, creds.key,
        'stock.quant', 'create',
        [{
          product_id: product.odoo_id,
          location_id: cfg.locations.MAIN,
          inventory_quantity: qty,
          company_id: cfg.company_id,
        }], coCtx(cfg)
      );
      await odooCall(creds.uid, creds.key,
        'stock.quant', 'action_apply_inventory', [[newQuant]], coCtx(cfg)
      );
      results.push({ code, odoo_id: product.odoo_id, action: 'created', qty });
    }
  }
  return results;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Google Drive — Settlement Photo Upload
 * Uses service account JWT (RS256) — no OAuth redirect needed.
 * Secrets: GDRIVE_SA_EMAIL, GDRIVE_SA_PRIVATE_KEY (PEM),
 *          GDRIVE_ROOT_FOLDER_ID
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── Build and sign a JWT, exchange for an access token ── */
async function getGDriveToken(env) {
  const email = env.GDRIVE_SA_EMAIL;
  const pemRaw = env.GDRIVE_SA_PRIVATE_KEY;
  if (!email || !pemRaw) throw new Error('GDRIVE secrets not configured');

  // CF secrets store \n literally — convert to real newlines
  const pem = pemRaw.replace(/\\n/g, '\n');

  // Strip PEM header/footer and decode DER
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')),
    c => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimB64 = btoa(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const sigInput = new TextEncoder().encode(`${header}.${claimB64}`);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, sigInput);
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${header}.${claimB64}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Drive token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/* ── Find existing folder by name+parent, or create it ── */
async function gdriveFindOrCreateFolder(token, name, parentId) {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and trashed=false`);
  const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const found = await search.json();
  if (found.files?.length > 0) return found.files[0].id;

  const create = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const created = await create.json();
  if (!created.id) throw new Error(`Folder create failed: ${JSON.stringify(created)}`);
  return created.id;
}

/* ── Upload a single base64 JPEG via multipart ── */
async function gdriveUploadPhoto(token, filename, base64Data, folderId) {
  // Strip data-URI prefix if present
  const b64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
  const imgBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  const boundary = '------DriveUploadBoundary';
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const metaBytes = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const closeBytes = new TextEncoder().encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metaBytes.length + imgBytes.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(imgBytes, metaBytes.length);
  body.set(closeBytes, metaBytes.length + imgBytes.length);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const result = await res.json();
  if (!result.id) throw new Error(`Upload failed for ${filename}: ${JSON.stringify(result)}`);
  return { filename, driveId: result.id, link: result.webViewLink };
}

/* ── Orchestrator: create folder path, upload all photos ── */
async function uploadSettlementPhotos(photos, brand, userName, nowIST, env) {
  const rootId = env.GDRIVE_ROOT_FOLDER_ID;
  if (!rootId) throw new Error('GDRIVE_ROOT_FOLDER_ID not set');

  const token = await getGDriveToken(env);

  // Path: root / BRAND / YYYY-MM-DD / HHMM - Settlement - UserName
  const dateStr = nowIST.toISOString().slice(0, 10); // YYYY-MM-DD
  const hhmm = nowIST.toISOString().slice(11, 16).replace(':', ''); // HHMM (UTC — close enough for folder name)
  const sessionFolderName = `${hhmm} - Settlement - ${userName}`;

  const brandFolderId   = await gdriveFindOrCreateFolder(token, brand, rootId);
  const dateFolderId    = await gdriveFindOrCreateFolder(token, dateStr, brandFolderId);
  const sessionFolderId = await gdriveFindOrCreateFolder(token, sessionFolderName, dateFolderId);

  const results = [];
  for (const photo of photos) {
    try {
      // filename: "HN-RM-029 - Sugar - 143022.jpg"
      const ts = photo.timestamp ? new Date(photo.timestamp).toISOString().slice(11, 19).replace(/:/g, '') : 'photo';
      const safeName = (photo.label || photo.key || 'item').replace(/[^\w\s-]/g, '').trim().slice(0, 40);
      const filename = `${photo.key} - ${safeName} - ${ts}.jpg`;
      const uploaded = await gdriveUploadPhoto(token, filename, photo.base64, sessionFolderId);
      results.push({ key: photo.key, label: photo.label, ...uploaded });
    } catch (err) {
      results.push({ key: photo.key, label: photo.label, error: err.message });
    }
  }
  return results;
}

/* ━━━ Utility ━━━ */

function round(v, d = 4) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Phase 3: Variant pickers, price intelligence, summary refresh
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * GET /api/rm-ops?action=variant-pickers&brand=HE&q=oil&limit=50
 *
 * Returns variants grouped by template so the Purchase UI can render a
 * two-step picker (tap template → pick variant). Feeds from the Phase-2
 * rm_product_variants cache; unmigrated products surface via getProducts().
 */
async function getVariantPickers(brand, url, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const cfg = BRAND_CONFIG[brand];
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  // Pull active variants; filter by company when company_id is set, and
  // keep rows with company_id=NULL as cross-company (shared catalog).
  let sql = `SELECT odoo_variant_id, odoo_template_id, template_name, display_name,
                    default_code, category, uom, uom_id, company_id,
                    brand_value, pack_value, grade_value,
                    avg_cost, last_price, last_vendor_key
             FROM rm_product_variants
             WHERE is_active = 1
               AND (company_id IS NULL OR company_id = ?)`;
  const params = [cfg.company_id];

  if (q) {
    sql += ' AND (LOWER(template_name) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(default_code) LIKE ?)';
    const pat = `%${q}%`;
    params.push(pat, pat, pat);
  }
  sql += ' ORDER BY template_name ASC, display_name ASC LIMIT ?';
  params.push(limit * 10); // fetch generously, we'll group + trim

  const rows = await DB.prepare(sql).bind(...params).all();
  const variants = rows.results || [];

  // Merge latest per-brand summary so the picker can render badges
  const variantIds = variants.map(v => v.odoo_variant_id).filter(Boolean);
  const summaryMap = {};
  if (variantIds.length) {
    const placeholders = variantIds.map(() => '?').join(',');
    const summaryRows = await DB.prepare(
      `SELECT odoo_variant_id, last_price, price_30d_avg, price_30d_min,
              price_30d_max, trend_pct, market_cheapest_platform,
              market_cheapest_price, market_savings_pct, last_recorded_at
       FROM rm_variant_price_summary
       WHERE brand = ? AND odoo_variant_id IN (${placeholders})`
    ).bind(brand, ...variantIds).all();
    for (const s of (summaryRows.results || [])) summaryMap[s.odoo_variant_id] = s;
  }

  // Group by template
  const groups = {};
  for (const v of variants) {
    const tid = v.odoo_template_id;
    if (!groups[tid]) {
      groups[tid] = {
        template_id: tid,
        template_name: v.template_name,
        category: v.category,
        variants: [],
      };
    }
    groups[tid].variants.push({
      variant_id: v.odoo_variant_id,
      display_name: v.display_name,
      default_code: v.default_code,
      uom: v.uom,
      uom_id: v.uom_id,
      attrs: {
        brand: v.brand_value || null,
        pack: v.pack_value || null,
        grade: v.grade_value || null,
      },
      avg_cost: v.avg_cost,
      last_price: summaryMap[v.odoo_variant_id]?.last_price ?? v.last_price ?? null,
      last_vendor_key: v.last_vendor_key,
      intel: summaryMap[v.odoo_variant_id] || null,
    });
  }

  const templates = Object.values(groups).slice(0, limit);
  return json({
    success: true, brand, count: templates.length, templates,
  });
}

/**
 * GET /api/rm-ops?action=price-intel&brand=HE&variant_id=12345&days=90
 *
 * Deep-dive intelligence for one variant:
 *   - rolling stats from rm_variant_price_summary
 *   - recent D1 price history
 *   - market benchmarks (Hyperpure/Blinkit/Zepto/BigBasket) when captured
 *   - vendor-by-vendor last price
 */
async function getPriceIntel(brand, url, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const variantId = parseInt(url.searchParams.get('variant_id') || '0');
  if (!variantId) return json({ error: 'Missing variant_id' }, 400);
  const days = Math.min(parseInt(url.searchParams.get('days') || '90'), 365);

  const [variant, summary, history, market, vendorPrices] = await Promise.all([
    DB.prepare(
      `SELECT odoo_variant_id, odoo_template_id, template_name, display_name,
              default_code, uom, category, brand_value, pack_value, grade_value
       FROM rm_product_variants
       WHERE odoo_variant_id = ?`
    ).bind(variantId).first(),

    DB.prepare(
      `SELECT * FROM rm_variant_price_summary
       WHERE odoo_variant_id = ? AND brand = ?`
    ).bind(variantId, brand).first(),

    DB.prepare(
      `SELECT price, recorded_at, recorded_by, source, variant_display
       FROM rm_daily_prices
       WHERE odoo_variant_id = ? AND brand = ?
         AND recorded_at >= datetime('now', '-' || ? || ' days')
       ORDER BY recorded_at DESC
       LIMIT 200`
    ).bind(variantId, brand, days).all(),

    DB.prepare(
      `SELECT platform, price_per_base, base_unit, match_score, checked_at
       FROM rm_market_prices
       WHERE odoo_variant_id = ?
         AND checked_at >= datetime('now', '-' || ? || ' days')
       ORDER BY checked_at DESC`
    ).bind(variantId, days).all(),

    DB.prepare(
      `SELECT dp.recorded_by, dp.source, dp.price, dp.recorded_at,
              vp.vendor_key, rv.name as vendor_name
       FROM rm_daily_prices dp
       LEFT JOIN rm_vendor_products vp ON vp.odoo_variant_id = dp.odoo_variant_id
       LEFT JOIN rm_vendors rv ON rv.key = vp.vendor_key
       WHERE dp.odoo_variant_id = ? AND dp.brand = ?
       ORDER BY dp.recorded_at DESC
       LIMIT 50`
    ).bind(variantId, brand).all(),
  ]);

  if (!variant) return json({ error: 'Variant not found' }, 404);

  // Derive a recommendation badge colour
  let badge = 'neutral';
  let badgeReason = null;
  if (summary) {
    if (summary.market_savings_pct != null && summary.market_savings_pct > 10) {
      badge = 'red';
      badgeReason = `Paying ${round(summary.market_savings_pct, 1)}% over cheapest market price (${summary.market_cheapest_platform || 'market'})`;
    } else if (summary.trend_pct != null && summary.trend_pct > 15) {
      badge = 'yellow';
      badgeReason = `Price up ${round(summary.trend_pct, 1)}% vs 30d average`;
    } else if (summary.trend_pct != null && summary.trend_pct < -10) {
      badge = 'green';
      badgeReason = `Price down ${round(Math.abs(summary.trend_pct), 1)}% vs 30d average`;
    } else if (summary.price_30d_count > 2) {
      badge = 'green';
      badgeReason = 'Stable pricing window';
    }
  }

  return json({
    success: true, brand,
    variant,
    summary: summary || null,
    badge, badge_reason: badgeReason,
    history: history.results || [],
    market: market.results || [],
    vendorPrices: vendorPrices.results || [],
  });
}

/**
 * GET /api/rm-ops?action=variant-price-summary&brand=HE&limit=100
 *
 * Dashboard listing: all variants with rolling stats + savings opportunities.
 */
async function getVariantPriceSummary(brand, url, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const sortBy = url.searchParams.get('sort') || 'savings';

  let orderClause = 'ORDER BY s.market_savings_pct DESC NULLS LAST';
  if (sortBy === 'trend-up')    orderClause = 'ORDER BY s.trend_pct DESC NULLS LAST';
  if (sortBy === 'trend-down')  orderClause = 'ORDER BY s.trend_pct ASC NULLS LAST';
  if (sortBy === 'recent')      orderClause = 'ORDER BY s.last_recorded_at DESC NULLS LAST';

  const rows = await DB.prepare(
    `SELECT s.*, v.template_name, v.category, v.default_code
     FROM rm_variant_price_summary s
     LEFT JOIN rm_product_variants v ON v.odoo_variant_id = s.odoo_variant_id
     WHERE s.brand = ?
     ${orderClause}
     LIMIT ?`
  ).bind(brand, limit).all();

  return json({
    success: true, brand,
    count: (rows.results || []).length,
    summary: rows.results || [],
  });
}

/**
 * POST /api/rm-ops action=refresh-variant-summary body:{ variant_ids?: [], brand }
 *
 * Recomputes rm_variant_price_summary for one or more variants. When called
 * without variant_ids, refreshes every variant that has a recent price.
 */
async function refreshVariantPriceSummary(body, brand, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);
  const requested = Array.isArray(body.variant_ids) ? body.variant_ids.filter(Boolean) : [];

  let ids = requested;
  if (ids.length === 0) {
    const res = await DB.prepare(
      `SELECT DISTINCT odoo_variant_id
       FROM rm_daily_prices
       WHERE brand = ? AND odoo_variant_id IS NOT NULL
         AND recorded_at >= datetime('now', '-90 days')`
    ).bind(brand).all();
    ids = (res.results || []).map(r => r.odoo_variant_id);
  }

  let refreshed = 0;
  const errors = [];
  for (const vid of ids) {
    try {
      await refreshOneVariantSummary(DB, vid, brand);
      refreshed++;
    } catch (e) {
      errors.push({ variant_id: vid, error: e.message });
    }
  }

  return json({ success: true, brand, refreshed, errors });
}

/**
 * Internal: recompute rm_variant_price_summary for (variant_id × brand).
 * Called automatically from createPO, plus on-demand via refresh endpoint.
 */
async function refreshOneVariantSummary(DB, variantId, brand) {
  // Base variant identity (display name, uom)
  const variant = await DB.prepare(
    `SELECT display_name, uom FROM rm_product_variants WHERE odoo_variant_id = ?`
  ).bind(variantId).first();

  // Rolling stats for last 30d and prev 30d
  const stats = await DB.prepare(
    `SELECT
       COUNT(*) as n,
       AVG(price) as avg_p,
       MIN(price) as min_p,
       MAX(price) as max_p
     FROM rm_daily_prices
     WHERE odoo_variant_id = ? AND brand = ?
       AND recorded_at >= datetime('now', '-30 days')`
  ).bind(variantId, brand).first();

  const prevStats = await DB.prepare(
    `SELECT AVG(price) as avg_p
     FROM rm_daily_prices
     WHERE odoo_variant_id = ? AND brand = ?
       AND recorded_at >= datetime('now', '-60 days')
       AND recorded_at < datetime('now', '-30 days')`
  ).bind(variantId, brand).first();

  const latest = await DB.prepare(
    `SELECT dp.price, dp.source, dp.recorded_at,
            (SELECT vendor_key FROM rm_vendor_products
             WHERE odoo_variant_id = dp.odoo_variant_id AND is_primary = 1 LIMIT 1) as vk
     FROM rm_daily_prices dp
     WHERE dp.odoo_variant_id = ? AND dp.brand = ?
     ORDER BY recorded_at DESC LIMIT 1`
  ).bind(variantId, brand).first();

  // Cheapest market platform (most recent snapshot per platform, global)
  const market = await DB.prepare(
    `SELECT platform, price_per_base, checked_at
     FROM rm_market_prices
     WHERE odoo_variant_id = ?
       AND checked_at >= datetime('now', '-14 days')
     ORDER BY price_per_base ASC LIMIT 1`
  ).bind(variantId).first();

  const lastPrice = latest?.price ?? null;
  const avg30 = stats?.avg_p ?? null;
  const prev30 = prevStats?.avg_p ?? null;

  let trendPct = null;
  if (lastPrice != null && avg30 != null && avg30 > 0) {
    trendPct = ((lastPrice - avg30) / avg30) * 100;
  }

  let savingsPct = null;
  if (lastPrice != null && market?.price_per_base != null && lastPrice > 0) {
    savingsPct = ((lastPrice - market.price_per_base) / lastPrice) * 100;
  }

  await DB.prepare(
    `INSERT INTO rm_variant_price_summary
       (odoo_variant_id, brand, display_name, uom,
        last_price, last_vendor_key, last_source, last_recorded_at,
        price_30d_avg, price_30d_min, price_30d_max, price_30d_count,
        price_prev_30d_avg, trend_pct,
        market_cheapest_platform, market_cheapest_price, market_savings_pct,
        updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(odoo_variant_id, brand) DO UPDATE SET
       display_name = excluded.display_name,
       uom = excluded.uom,
       last_price = excluded.last_price,
       last_vendor_key = excluded.last_vendor_key,
       last_source = excluded.last_source,
       last_recorded_at = excluded.last_recorded_at,
       price_30d_avg = excluded.price_30d_avg,
       price_30d_min = excluded.price_30d_min,
       price_30d_max = excluded.price_30d_max,
       price_30d_count = excluded.price_30d_count,
       price_prev_30d_avg = excluded.price_prev_30d_avg,
       trend_pct = excluded.trend_pct,
       market_cheapest_platform = excluded.market_cheapest_platform,
       market_cheapest_price = excluded.market_cheapest_price,
       market_savings_pct = excluded.market_savings_pct,
       updated_at = datetime('now')`
  ).bind(
    variantId, brand,
    variant?.display_name || null,
    variant?.uom || null,
    lastPrice,
    latest?.vk || null,
    latest?.source || null,
    latest?.recorded_at || null,
    avg30, stats?.min_p ?? null, stats?.max_p ?? null, stats?.n ?? 0,
    prev30, trendPct,
    market?.platform || null,
    market?.price_per_base ?? null,
    savingsPct
  ).run();
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Phase 4 — Unified Purchase UI backends
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── List POs with filters (state, vendor, date range) ── */
async function listPOs(creds, cfg, brand, body) {
  const filters = body || {};
  const domain = [['company_id', '=', cfg.company_id]];
  if (filters.state) domain.push(['state', '=', filters.state]);
  if (filters.vendor_id) domain.push(['partner_id', '=', filters.vendor_id]);
  if (filters.from) domain.push(['date_order', '>=', filters.from + ' 00:00:00']);
  if (filters.to)   domain.push(['date_order', '<=', filters.to + ' 23:59:59']);

  const pos = await odooCall(creds.uid, creds.key, 'purchase.order', 'search_read',
    [domain],
    {
      fields: ['id','name','partner_id','partner_ref','date_order','date_planned','amount_total',
               'amount_untaxed','amount_tax','state','user_id','invoice_status'],
      order: 'id desc', limit: filters.limit || 100,
    });
  return json({ success: true, pos });
}

/* ── Create vendor bill (3-way match: PO → Receipt → Bill) ── */
async function createBill(body, user, creds, cfg, brand, env, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const { po_id, bill_ref, bill_date, due_date, amount_total, notes, photo_b64 } = body;
  if (!po_id || !bill_ref || !bill_date || !amount_total) {
    return json({ error: 'po_id, bill_ref, bill_date, amount_total required' }, 400);
  }

  // Get PO lines for invoice creation
  const po = await odooCall(creds.uid, creds.key, 'purchase.order', 'read',
    [[po_id]], { fields: ['name','partner_id','order_line'] });
  if (!po || !po[0]) return json({ error: 'PO not found' }, 404);

  // Use Odoo's native action: action_create_invoice → returns dict with invoice_ids
  let billId;
  try {
    const inv = await odooCall(creds.uid, creds.key, 'purchase.order', 'action_create_invoice', [[po_id]], coCtx(cfg));
    // Sometimes returns {res_id} or {domain: [['id','in',[...]]]}
    if (inv && inv.res_id) billId = inv.res_id;
    else if (inv && inv.domain) {
      const m = JSON.stringify(inv.domain).match(/\[(\d+)\]/);
      if (m) billId = parseInt(m[1]);
    }
    // Fallback: search latest in_invoice for this PO
    if (!billId) {
      const found = await odooCall(creds.uid, creds.key, 'account.move', 'search',
        [[['invoice_origin','=', po[0].name],['move_type','=','in_invoice']]],
        { limit: 1, order: 'id desc' });
      if (found && found.length) billId = found[0];
    }
  } catch (e) {
    return json({ error: 'Bill creation failed: ' + e.message }, 500);
  }
  if (!billId) return json({ error: 'Bill not created (no id returned)' }, 500);

  // Update bill with provided fields
  await odooCall(creds.uid, creds.key, 'account.move', 'write',
    [[billId], {
      ref: bill_ref,
      invoice_date: bill_date,
      invoice_date_due: due_date || null,
      narration: notes || '',
    }], coCtx(cfg));

  // Optionally upload photo to Drive (skip if no photo)
  let photoLink = null, photoId = null;
  if (photo_b64 && env.GDRIVE_SA_EMAIL && env.GDRIVE_SA_PRIVATE_KEY) {
    try {
      const token = await getGDriveToken(env);
      const folderId = await gdriveFindOrCreateFolder(token, 'Bills', env.GDRIVE_ROOT_FOLDER_ID);
      const dateFolder = await gdriveFindOrCreateFolder(token, bill_date, folderId);
      const filename = `${po[0].name}-${bill_ref}.jpg`;
      const result = await gdriveUploadPhoto(token, filename, photo_b64, dateFolder);
      photoLink = result.link; photoId = result.driveId;
    } catch (e) { /* don't block on photo failure */ }
  }

  // Mirror to D1
  if (DB) {
    await DB.prepare(
      `INSERT INTO rm_vendor_bills
        (brand, odoo_move_id, odoo_po_id, odoo_po_name, vendor_id, vendor_name,
         bill_ref, bill_date, due_date, amount_total,
         bill_photo_drive_id, bill_photo_link, notes, recorded_by, is_direct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
    ).bind(brand, billId, po_id, po[0].name,
           po[0].partner_id[0], po[0].partner_id[1],
           bill_ref, bill_date, due_date, parseFloat(amount_total),
           photoId, photoLink, notes || '', user.name).run();
  }

  return json({ success: true, bill_id: billId, photo_link: photoLink });
}

/* ── Direct bill (no PO) — for ad-hoc vendor invoices ── */
async function directBill(body, user, creds, cfg, brand, env, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const { vendor_id, bill_ref, bill_date, amount_total, description, notes, photo_b64 } = body;
  if (!vendor_id || !bill_ref || !bill_date || !amount_total) {
    return json({ error: 'vendor_id, bill_ref, bill_date, amount_total required' }, 400);
  }

  const billId = await odooCall(creds.uid, creds.key, 'account.move', 'create',
    [{
      move_type: 'in_invoice',
      partner_id: vendor_id,
      ref: bill_ref,
      invoice_date: bill_date,
      company_id: cfg.company_id,
      narration: notes || '',
      invoice_line_ids: [[0,0,{
        name: description || 'Direct Vendor Bill',
        quantity: 1,
        price_unit: parseFloat(amount_total),
      }]],
    }], coCtx(cfg));
  await odooCall(creds.uid, creds.key, 'account.move', 'action_post', [[billId]], coCtx(cfg));

  // Vendor name for D1
  const vp = await odooCall(creds.uid, creds.key, 'res.partner', 'read', [[vendor_id]], { fields: ['name'] });

  let photoLink = null, photoId = null;
  if (photo_b64 && env.GDRIVE_SA_EMAIL) {
    try {
      const token = await getGDriveToken(env);
      const folderId = await gdriveFindOrCreateFolder(token, 'Bills', env.GDRIVE_ROOT_FOLDER_ID);
      const dateFolder = await gdriveFindOrCreateFolder(token, bill_date, folderId);
      const filename = `Direct-${bill_ref}.jpg`;
      const result = await gdriveUploadPhoto(token, filename, photo_b64, dateFolder);
      photoLink = result.link; photoId = result.driveId;
    } catch (e) { /* ignore */ }
  }

  if (DB) {
    await DB.prepare(
      `INSERT INTO rm_vendor_bills
        (brand, odoo_move_id, vendor_id, vendor_name, bill_ref, bill_date,
         amount_total, bill_photo_drive_id, bill_photo_link, notes, recorded_by, is_direct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(brand, billId, vendor_id, vp[0]?.name || 'Vendor',
           bill_ref, bill_date, parseFloat(amount_total),
           photoId, photoLink, notes || '', user.name).run();
  }

  return json({ success: true, bill_id: billId, photo_link: photoLink });
}

/* ── List bills (D1 cache) ── */
async function listBills(brand, body, DB) {
  if (!DB) return json({ error: 'DB not configured' }, 500);
  const from = body.from || '2026-04-01';
  const to = body.to || '2026-12-31';
  const rows = await DB.prepare(
    `SELECT * FROM rm_vendor_bills WHERE brand=? AND bill_date BETWEEN ? AND ? ORDER BY bill_date DESC, id DESC LIMIT 200`
  ).bind(brand, from, to).all();
  return json({ success: true, bills: rows.results });
}

/* ── Vendor outstanding payables ── */
async function vendorOutstanding(creds, cfg, brand) {
  const moves = await odooCall(creds.uid, creds.key, 'account.move', 'search_read',
    [[['move_type','=','in_invoice'],['company_id','=',cfg.company_id],['payment_state','!=','paid'],['state','=','posted']]],
    { fields: ['id','name','partner_id','amount_total','amount_residual','invoice_date','invoice_date_due','payment_state'],
      order: 'invoice_date_due asc', limit: 200 });
  const grouped = {};
  for (const m of moves) {
    const vname = m.partner_id ? m.partner_id[1] : 'Unknown';
    if (!grouped[vname]) grouped[vname] = { vendor: vname, outstanding: 0, count: 0, oldest_due: null, bills: [] };
    grouped[vname].outstanding += m.amount_residual || 0;
    grouped[vname].count++;
    if (!grouped[vname].oldest_due || m.invoice_date_due < grouped[vname].oldest_due) {
      grouped[vname].oldest_due = m.invoice_date_due;
    }
    grouped[vname].bills.push({ id: m.id, ref: m.name, amount: m.amount_residual, due: m.invoice_date_due });
  }
  return json({ success: true, outstanding: Object.values(grouped).sort((a,b)=>b.outstanding-a.outstanding) });
}

/* ━━━ Unlink an orphan payment (state=draft, move_id=false) ━━━
 * For cleanup of half-created payments. Safe only when the payment never
 * posted — we verify move_id is false before allowing the delete. */
async function unlinkPayment(body, user, creds, cfg) {
  if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
  const payment_id = parseInt(body.payment_id);
  if (!payment_id) return json({ error: 'payment_id required' }, 400);
  const p = await odooCall(creds.uid, creds.key, 'account.payment', 'read',
    [[payment_id]], { fields: ['id','name','state','move_id','company_id'] });
  if (!p || !p[0]) return json({ error: 'Payment not found' }, 404);
  if (p[0].company_id[0] !== cfg.company_id) return json({ error: 'Wrong company' }, 400);
  if (p[0].move_id) return json({ error: `Payment has posted move ${p[0].move_id} — cannot delete safely` }, 400);
  // Try draft first in case it's in_process
  if (p[0].state !== 'draft') {
    try { await odooCall(creds.uid, creds.key, 'account.payment', 'action_draft', [[payment_id]], coCtx(cfg)); } catch(_) {}
  }
  await odooCall(creds.uid, creds.key, 'account.payment', 'unlink', [[payment_id]], coCtx(cfg));
  return json({ success: true, deleted: p[0].name });
}

/* ━━━ Register Payment via direct Journal Entry (Odoo-18-safe) ━━━
 * Bypasses the account.payment model entirely. Creates an account.move in
 * the chosen cash/bank journal with two lines (Dr Payable, Cr Cash), posts
 * it, then reconciles the new Payable-debit line with the bill's Payable
 * credit line. Result: bill.amount_residual drops, payment_state transitions
 * to 'partial' or 'paid'. Works on every Odoo version without depending on
 * the account.payment state machine.
 *
 * Body: { pin, brand, bill_id, amount, payment_date, journal_id, memo? }
 */
async function registerPaymentJE(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase' && user.role !== 'settlement') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const { bill_id, amount, payment_date, journal_id, memo } = body;
  if (!bill_id || !amount || !payment_date || !journal_id) {
    return json({ error: 'bill_id, amount, payment_date, journal_id required' }, 400);
  }
  const amt = parseFloat(amount);

  // 1. Read the bill + its payable line (this gives us the AP account to use)
  const bill = await odooCall(creds.uid, creds.key, 'account.move', 'read',
    [[parseInt(bill_id)]],
    { fields: ['id','name','state','move_type','amount_residual','company_id','partner_id','line_ids'] });
  if (!bill || !bill[0]) return json({ error: 'Bill not found' }, 404);
  const b = bill[0];
  if (b.move_type !== 'in_invoice') return json({ error: 'Not a vendor bill' }, 400);
  if (b.state !== 'posted') return json({ error: `Bill state=${b.state}` }, 400);
  if (b.company_id[0] !== cfg.company_id) return json({ error: 'Wrong company' }, 400);
  if (amt > (b.amount_residual || 0) + 0.01) return json({ error: `amount ${amt} exceeds residual ${b.amount_residual}` }, 400);

  // Find the bill's UNRECONCILED payable line (there's exactly one on a vendor bill)
  const billLines = await odooCall(creds.uid, creds.key, 'account.move.line', 'search_read',
    [[['move_id','=',b.id],['account_id.account_type','in',['liability_payable']]]],
    { fields: ['id','account_id','partner_id','debit','credit','reconciled','amount_residual'] });
  const payableLine = billLines.find(l => !l.reconciled);
  if (!payableLine) return json({ error: 'Bill payable line not found or already reconciled' }, 400);
  const payable_account_id = payableLine.account_id[0];

  // 2. Read journal's default_account (cash/bank account) + suspense fallback
  const jrn = await odooCall(creds.uid, creds.key, 'account.journal', 'read',
    [[parseInt(journal_id)]], { fields: ['id','name','default_account_id','company_id'] });
  if (!jrn || !jrn[0] || !jrn[0].default_account_id) return json({ error: 'Journal has no default_account_id' }, 400);
  if (jrn[0].company_id[0] !== cfg.company_id) return json({ error: 'Journal wrong company' }, 400);
  const cash_account_id = jrn[0].default_account_id[0];

  // 3. Create the payment journal entry (Dr Payable / Cr Cash)
  const narration = memo || `Payment: ${b.name}`;
  const pmtMoveId = await odooCall(creds.uid, creds.key, 'account.move', 'create',
    [{
      move_type: 'entry',
      journal_id: parseInt(journal_id),
      date: payment_date,
      ref: narration,
      company_id: cfg.company_id,
      line_ids: [
        [0,0,{ account_id: payable_account_id, partner_id: b.partner_id[0],
               debit: amt, credit: 0, name: narration }],
        [0,0,{ account_id: cash_account_id,    partner_id: b.partner_id[0],
               debit: 0, credit: amt, name: narration }],
      ],
    }], coCtx(cfg));

  // 4. Post it
  await odooCall(creds.uid, creds.key, 'account.move', 'action_post', [[pmtMoveId]], coCtx(cfg));

  // 5. Find the new payable-debit line and reconcile it with the bill's payable line
  const newLines = await odooCall(creds.uid, creds.key, 'account.move.line', 'search_read',
    [[['move_id','=',pmtMoveId],['account_id','=',payable_account_id]]],
    { fields: ['id','debit','credit'] });
  const newPayableDebit = newLines.find(l => l.debit > 0);
  if (!newPayableDebit) return json({ error: 'New payable debit line not found' }, 500);

  await odooCall(creds.uid, creds.key, 'account.move.line', 'reconcile',
    [[payableLine.id, newPayableDebit.id]], coCtx(cfg));

  // 6. Re-read bill to surface new state
  const after = await odooCall(creds.uid, creds.key, 'account.move', 'read',
    [[b.id]], { fields: ['amount_residual','payment_state'] });

  // 7. Mirror to D1
  if (DB) {
    try {
      await DB.prepare(
        `UPDATE rm_vendor_bills
           SET amount_paid = COALESCE(amount_paid,0) + ?,
               payment_state = ?
         WHERE odoo_move_id = ? AND brand = ?`
      ).bind(amt, after?.[0]?.payment_state || 'partial', b.id, brand).run();
    } catch (_) { /* soft-fail if columns don't exist */ }
  }

  return json({
    success: true,
    payment_move_id: pmtMoveId,
    bill_id: b.id,
    bill_ref: b.name,
    amount_paid: amt,
    new_residual: after?.[0]?.amount_residual ?? null,
    payment_state: after?.[0]?.payment_state ?? null,
  });
}

/* ━━━ Post a payment (Odoo 18 flow) ━━━
 * In Odoo 18 the register-wizard can leave payments in 'in_process' with no
 * move_id — the accounting entry isn't actually created until action_post
 * runs on the payment itself. Call this after register-payment if residual
 * didn't drop. Also used to recover stuck payments from earlier attempts. */
async function postPayment(body, user, creds, cfg) {
  if (user.role !== 'admin' && user.role !== 'purchase' && user.role !== 'settlement') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const payment_id = parseInt(body.payment_id);
  if (!payment_id) return json({ error: 'payment_id required' }, 400);

  // Guard: payment must belong to this company.
  const p0 = await odooCall(creds.uid, creds.key, 'account.payment', 'read',
    [[payment_id]], { fields: ['id','state','company_id','move_id','amount','reconciled_bill_ids'] });
  if (!p0 || !p0[0]) return json({ error: 'Payment not found' }, 404);
  if (p0[0].company_id[0] !== cfg.company_id) return json({ error: 'Payment belongs to a different company' }, 400);

  let tried = [];
  let posted = false;
  // Odoo 18 quirk: if the register-wizard's internal post failed silently,
  // the payment sits in in_process with move_id=False. action_post then
  // no-ops. Roll back to draft first, then post fresh.
  if (p0[0].state === 'in_process' && !p0[0].move_id) {
    try {
      await odooCall(creds.uid, creds.key, 'account.payment', 'action_draft', [[payment_id]], coCtx(cfg));
      tried.push({ method: 'action_draft', ok: true });
    } catch (e) {
      tried.push({ method: 'action_draft', error: e.message });
    }
  }
  // Odoo 18 renamed methods around a bit. Try in order, first to succeed wins.
  for (const method of ['action_post', 'action_validate', 'action_paid']) {
    try {
      await odooCall(creds.uid, creds.key, 'account.payment', method, [[payment_id]], coCtx(cfg));
      tried.push({ method, ok: true });
      posted = true;
      break;
    } catch (e) {
      tried.push({ method, error: e.message });
    }
  }

  const after = await odooCall(creds.uid, creds.key, 'account.payment', 'read',
    [[payment_id]], { fields: ['id','name','state','move_id','is_matched'] });
  const bill_ids = p0[0].reconciled_bill_ids || [];
  let bills = [];
  if (bill_ids.length) {
    bills = await odooCall(creds.uid, creds.key, 'account.move', 'read',
      [bill_ids], { fields: ['id','name','amount_residual','payment_state'] });
  }

  return json({ success: posted, tried, payment: after[0], bills });
}

/* ━━━ Debug: probe a journal's config (esp. outstanding accounts) ━━━ */
async function probeJournal(creds, cfg, url) {
  const journal_id = parseInt(url.searchParams.get('journal_id'));
  if (!journal_id) return json({ error: 'journal_id required' }, 400);
  const j = await odooCall(creds.uid, creds.key, 'account.journal', 'read',
    [[journal_id]],
    { fields: ['id','name','type','code','company_id','default_account_id',
               'suspense_account_id','outbound_payment_method_line_ids',
               'inbound_payment_method_line_ids'] });
  // Also read one outbound payment method line to see its payment_account_id
  let outLines = [];
  if (j?.[0]?.outbound_payment_method_line_ids?.length) {
    outLines = await odooCall(creds.uid, creds.key, 'account.payment.method.line', 'read',
      [j[0].outbound_payment_method_line_ids],
      { fields: ['id','name','payment_account_id','payment_method_id','journal_id'] });
  }
  return json({ success: true, journal: j?.[0] || null, outbound_method_lines: outLines });
}

/* ━━━ Debug: probe a payment's state + bill linkage ━━━
 * Reads payment + bill + their reconciliation links so we can see whether
 * Odoo actually tied the payment to the bill. Use: GET …?action=probe-payment
 * &brand=HE&pin=5882&payment_id=1&bill_id=1 */
async function probePayment(creds, cfg, url) {
  const payment_id = parseInt(url.searchParams.get('payment_id'));
  const bill_id = parseInt(url.searchParams.get('bill_id'));
  const out = {};
  if (payment_id) {
    const p = await odooCall(creds.uid, creds.key, 'account.payment', 'read',
      [[payment_id]],
      { fields: ['id','name','state','amount','date','journal_id','partner_id',
                 'payment_type','partner_type','reconciled_bill_ids',
                 'reconciled_bills_count','move_id','is_matched'] });
    out.payment = p?.[0] || null;
  }
  if (bill_id) {
    const b = await odooCall(creds.uid, creds.key, 'account.move', 'read',
      [[bill_id]],
      { fields: ['id','name','state','amount_total','amount_residual','payment_state',
                 'partner_id','company_id'] });
    out.bill = b?.[0] || null;
  }
  return json({ success: true, ...out });
}

/* ━━━ UoM list (global, no company filter) ━━━ */
async function getUoms(creds) {
  // Odoo 18 removed category_id, uom_type, factor from uom.uom — id+name only.
  const uoms = await odooCall(creds.uid, creds.key, 'uom.uom', 'search_read',
    [[['active','=',true]]],
    { fields: ['id','name'], order: 'name asc' });
  return json({ success: true, uoms });
}

/* ━━━ Create a new Unit of Measure ━━━
 * Admin-only. Odoo 18 simplified uom.uom — only name and relative_uom_id
 * are accepted on create. relative_uom_id groups the new UoM with an
 * existing one (default: "Units" id=1). */
async function createUom(body, user, creds) {
  if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
  const { name, reference_uom_id } = body;
  if (!name?.trim()) return json({ error: 'name required' }, 400);

  // Guard: don't create duplicate
  const existing = await odooCall(creds.uid, creds.key, 'uom.uom', 'search_read',
    [[['name','ilike',name.trim()]]], { fields: ['id','name'], limit: 5 });
  if (existing.length) return json({ error: `UoM already exists: ${existing.map(u=>u.name).join(', ')}` }, 409);

  // Odoo 18: only name + relative_uom_id accepted — no uom_type, factor, category_id.
  const refId = parseInt(reference_uom_id) || 1;
  const newId = await odooCall(creds.uid, creds.key, 'uom.uom', 'create',
    [{ name: name.trim(), relative_uom_id: refId }]);

  return json({ success: true, uom: { id: newId, name: name.trim() } });
}

/* ━━━ Payment journals (bank/cash) ━━━
 * Lists payable-capable journals for the brand company. Used by the
 * Register Payment modal so the operator picks HDFC / Federal / Paytm /
 * Cash instead of guessing a journal_id. */
async function getPaymentJournals(creds, cfg) {
  const journals = await odooCall(creds.uid, creds.key,
    'account.journal', 'search_read',
    [[['type','in',['bank','cash']],['company_id','=',cfg.company_id]]],
    { fields: ['id','name','type','code','currency_id'], order: 'sequence asc, name asc' });
  return json({ success: true, journals });
}

/* ━━━ Register Payment against a vendor bill ━━━
 * Uses Odoo's account.payment.register wizard — the same path the web UI
 * takes when you click "Register Payment" on an in_invoice. Handles partial
 * payments, multi-bill batching, and automatic reconciliation.
 *
 * Body: { pin, brand, bill_id, amount, payment_date, journal_id, memo? }
 *   bill_id     — account.move id of the posted in_invoice
 *   amount      — payment amount (float, <= residual for partial)
 *   payment_date— YYYY-MM-DD (historical payments OK)
 *   journal_id  — account.journal id (bank or cash)
 *   memo        — optional free-text ref (goes to payment.ref)
 */
async function registerPayment(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase' && user.role !== 'settlement') {
    return json({ error: 'Insufficient permissions' }, 403);
  }
  const { bill_id, amount, payment_date, journal_id, memo } = body;
  if (!bill_id || !amount || !payment_date || !journal_id) {
    return json({ error: 'bill_id, amount, payment_date, journal_id required' }, 400);
  }

  // Sanity-check the bill: must be posted in_invoice for this company,
  // and the amount must not exceed its residual (partial payments OK).
  const bill = await odooCall(creds.uid, creds.key, 'account.move', 'read',
    [[parseInt(bill_id)]],
    { fields: ['id','name','move_type','state','amount_residual','company_id','partner_id','payment_state'] });
  if (!bill || !bill[0]) return json({ error: 'Bill not found' }, 404);
  const b = bill[0];
  if (b.move_type !== 'in_invoice') return json({ error: 'Not a vendor bill' }, 400);
  if (b.state !== 'posted') return json({ error: `Bill state=${b.state} — must be posted` }, 400);
  if (b.company_id[0] !== cfg.company_id) return json({ error: 'Bill belongs to a different company' }, 400);
  const amt = parseFloat(amount);
  if (amt <= 0) return json({ error: 'amount must be > 0' }, 400);
  if (amt > (b.amount_residual || 0) + 0.01) {
    return json({ error: `amount ${amt} exceeds residual ${b.amount_residual}` }, 400);
  }

  // Odoo payment wizard flow — mirrors the web UI exactly.
  const wizCtx = {
    active_model: 'account.move',
    active_ids: [b.id],
    active_id: b.id,
    allowed_company_ids: [cfg.company_id],
  };

  const wizardId = await odooCall(creds.uid, creds.key,
    'account.payment.register', 'create',
    [{
      payment_date,
      amount: amt,
      journal_id: parseInt(journal_id),
      communication: memo || b.name,
      // payment_type / partner_type are inferred from the active bill;
      // passing them explicitly makes intent unambiguous.
      payment_type: 'outbound',
      partner_type: 'supplier',
      // 'amount' (partial/full handling): default group_payment=false so
      // each bill gets its own payment line — fine for our single-bill case.
    }],
    { context: wizCtx });

  const result = await odooCall(creds.uid, creds.key,
    'account.payment.register', 'action_create_payments',
    [[wizardId]],
    { context: wizCtx });

  // action_create_payments returns either {res_id: <payment_id>} (single)
  // or {domain: [['id','in',[...]]]} (multi). Normalize.
  let paymentId = null;
  if (result && result.res_id) paymentId = result.res_id;
  else if (result && result.domain) {
    const m = JSON.stringify(result.domain).match(/\[(\d+)\]/);
    if (m) paymentId = parseInt(m[1]);
  }

  // Re-read the bill to surface post-payment state
  const after = await odooCall(creds.uid, creds.key, 'account.move', 'read',
    [[b.id]], { fields: ['amount_residual','payment_state'] });

  // Mirror to D1 — reflect new residual on the bill row if present
  if (DB) {
    try {
      await DB.prepare(
        `UPDATE rm_vendor_bills
           SET amount_paid = COALESCE(amount_paid,0) + ?,
               payment_state = ?
         WHERE odoo_move_id = ? AND brand = ?`
      ).bind(amt, after?.[0]?.payment_state || 'partial', b.id, brand).run();
    } catch (_) { /* column may not exist yet — soft-fail */ }
  }

  return json({
    success: true,
    payment_id: paymentId,
    bill_id: b.id,
    bill_ref: b.name,
    amount_paid: amt,
    new_residual: after?.[0]?.amount_residual ?? null,
    payment_state: after?.[0]?.payment_state ?? null,
  });
}
