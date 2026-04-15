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

const ODOO_URL = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB = 'main';

/* ━━━ Brand Config ━━━ */

const BRAND_CONFIG = {
  NCH: {
    company_id: 10,
    locations: { VENDORS: 1, STOCK: 34, MAIN: 39, COLD: 40, KITCHEN: 41, WASTAGE: 42 },
    picking_types: { to_kitchen: 20, from_cold: 21, return: 22, wastage: 23 },
    pos_configs: [27, 28],
  },
  HE: {
    company_id: 1,
    locations: { VENDORS: 1, STOCK: 5, MAIN: 47, COLD: 48, KITCHEN: 49, WASTAGE: 50 },
    picking_types: { to_kitchen: 30, from_cold: 31, return: 32, wastage: 33 },
    pos_configs: [5, 6, 10],
  },
};

/* ━━━ User / PIN → Odoo Credentials ━━━ */

const USERS = {
  '0305': { name: 'Nihaf',   role: 'admin',      odoo: 'system' },
  '2026': { name: 'Zoya',    role: 'purchase',    odoo: 'zoya' },
  '3678': { name: 'Faheem',  role: 'settlement',  odoo: 'faheem' },
  '6890': { name: 'Tanveer', role: 'staff',       odoo: 'system' },
  '7115': { name: 'Kesmat',  role: 'staff',       odoo: 'system' },
  '3946': { name: 'Jafar',   role: 'staff',       odoo: 'system' },
  '9991': { name: 'Mujib',   role: 'staff',       odoo: 'system' },
  '3697': { name: 'Yashwant',role: 'staff',       odoo: 'system' },
  '3754': { name: 'Naveen',  role: 'staff',       odoo: 'system' },
  '8241': { name: 'Nafees',  role: 'staff',       odoo: 'system' },
  '8523': { name: 'Basheer', role: 'staff',       odoo: 'system' },
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
    case 'settlement-history': return getSettlementHistory(brand, url, DB);
    case 'price-history': return getPriceHistory(brand, url, DB);
    case 'status': return getOpsStatus(brand, DB);
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
        [[['default_code', 'like', 'HN-RM-'], ['company_id', 'in', [cfg.company_id, false]]]],
        { fields: ['id', 'name', 'default_code', 'uom_id', 'categ_id'], order: 'name asc' }),
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
  const vendorMap = {};
  for (const m of (vendorMappings.results || [])) {
    if (!vendorMap[m.product_code]) vendorMap[m.product_code] = [];
    vendorMap[m.product_code].push({
      key: m.vendor_key, name: m.vendor_name,
      odoo_id: m.vendor_odoo_id, is_primary: !!m.is_primary,
    });
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

  return json({
    success: true,
    products: odooProducts.map(p => ({
      id: p.id, name: p.name, code: p.default_code || '',
      uom: p.uom_id ? p.uom_id[1] : 'Units',
      category: p.categ_id ? p.categ_id[1] : '',
      vendors: vendorMap[p.default_code] || [],
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

  // Load intelligence + tracked items + purchases in parallel
  const [intelligence, tracked, purchases] = await Promise.all([
    loadIntelligence(brand, DB),
    DB ? DB.prepare(
      'SELECT ti.*, p.name, p.uom, p.category, p.avg_cost FROM rm_tracked_items ti JOIN rm_products p ON ti.product_code = p.hn_code WHERE ti.brand = ? AND ti.is_active = 1 ORDER BY ti.tier, p.name'
    ).bind(brand).all() : { results: [] },
    fetchPurchasesReceived(creds, cfg,
      toOdooDatetime(istToUTC(periodStart)),
      toOdooDatetime(istToUTC(periodEnd))),
  ]);

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
      purchased: purchases[t.product_code] || 0,
      latestPrice: latestPrices[t.product_code] || null,
    })),
    purchases,
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
  const creds = getOdooCredentials(user, env);

  switch (body.action || action) {
    case 'create-po':       return createPO(body, user, creds, cfg, brand, DB);
    case 'edit-po-line':    return editPOLine(body, user, creds, cfg, brand, DB);
    case 'delete-po-line':  return deletePOLine(body, user, creds, cfg, brand, DB);
    case 'cancel-po':       return cancelPO(body, user, creds, cfg, brand, DB);
    case 'receive-delivery': return receiveDelivery(body, user, creds, cfg, brand, DB, env);
    case 'add-product':     return addProduct(body, user, creds, cfg, brand, env, DB);
    case 'update-price':    return updatePrice(body, user, brand, DB);
    case 'link-vendor':     return linkVendor(body, user, creds, cfg, brand, env, DB);
    case 'settlement-submit': return settlementSubmit(body, user, creds, cfg, brand, env, DB);
    default: return json({ error: `Unknown POST action: ${body.action}` }, 400);
  }
}

/* ── Create Purchase Order ── */

async function createPO(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions for purchase' }, 403);
  }

  const { vendor_id, lines } = body;
  if (!vendor_id || !lines || !Array.isArray(lines) || lines.length === 0) {
    return json({ error: 'Missing vendor_id or lines' }, 400);
  }

  // Fetch product UoMs
  const productIds = lines.map(l => l.product_id);
  const productData = await odooCall(creds.uid, creds.key,
    'product.product', 'search_read',
    [[['id', 'in', productIds]]],
    { fields: ['id', 'name', 'uom_id'] }
  );
  const uomMap = Object.fromEntries(productData.map(p => [p.id, p.uom_id[0]]));

  const datePlanned = toOdooDatetime(new Date());

  // Build PO lines
  const orderLines = lines.map(l => [0, 0, {
    product_id: l.product_id,
    product_qty: l.qty,
    price_unit: l.price_unit,
    name: l.name || 'Purchase',
    product_uom_id: uomMap[l.product_id] || 1,
    date_planned: datePlanned,
  }]);

  // Create PO
  const poId = await odooCall(creds.uid, creds.key,
    'purchase.order', 'create',
    [{ partner_id: vendor_id, company_id: cfg.company_id, order_line: orderLines }]
  );

  // Auto-confirm
  await odooCall(creds.uid, creds.key,
    'purchase.order', 'button_confirm', [[poId]]
  );

  // Read PO name
  const po = await odooCall(creds.uid, creds.key,
    'purchase.order', 'read', [[poId]], { fields: ['name'] }
  );
  const poName = po[0] ? po[0].name : `PO#${poId}`;

  // Record prices to D1
  if (DB) {
    const now = istNow().toISOString();
    for (const line of lines) {
      // Find HN-RM code for this product
      const prod = productData.find(p => p.id === line.product_id);
      if (prod) {
        const d1Product = await DB.prepare(
          'SELECT hn_code FROM rm_products WHERE odoo_id = ?'
        ).bind(line.product_id).first();
        if (d1Product) {
          await DB.prepare(
            'INSERT INTO rm_daily_prices (product_code, brand, price, recorded_by, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(d1Product.hn_code, brand, line.price_unit, user.name, `po:${poName}`, now).run();
        }
      }
    }

    // Log the action
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('create_po', brand, user.name, JSON.stringify({
      po_id: poId, po_name: poName, vendor_id, line_count: lines.length,
    }), now).run();
  }

  return json({
    success: true, po_id: poId, po_name: poName,
    created_by: user.name, brand,
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

async function editPOLine(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }

  const { po_id, line_id, qty, price_unit } = body;
  if (!po_id || !line_id) return json({ error: 'Missing po_id or line_id' }, 400);
  if (qty == null && price_unit == null) return json({ error: 'Nothing to update — provide qty or price_unit' }, 400);

  // Safety check: PO editable?
  const check = await checkPOEditable(creds, po_id);
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
  await odooCall(creds.uid, creds.key,
    'purchase.order.line', 'write', [[line_id], updates]);

  // If price changed, update D1 daily prices
  if (price_unit != null && DB) {
    // Get the product code for this line
    const lineData = await odooCall(creds.uid, creds.key,
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

async function deletePOLine(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }

  const { po_id, line_id } = body;
  if (!po_id || !line_id) return json({ error: 'Missing po_id or line_id' }, 400);

  const check = await checkPOEditable(creds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  // Count remaining lines — if this is the last one, cancel PO instead
  const existingLines = await odooCall(creds.uid, creds.key,
    'purchase.order.line', 'search_read',
    [[['order_id', '=', po_id]]],
    { fields: ['id'] });

  if (existingLines.length <= 1) {
    // Last line — cancel the entire PO
    await odooCall(creds.uid, creds.key,
      'purchase.order', 'button_cancel', [[po_id]]);

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
  await odooCall(creds.uid, creds.key,
    'purchase.order', 'button_cancel', [[po_id]]);
  await odooCall(creds.uid, creds.key,
    'purchase.order', 'button_draft', [[po_id]]);
  await odooCall(creds.uid, creds.key,
    'purchase.order', 'write', [[po_id], { order_line: [[2, line_id, 0]] }]);
  await odooCall(creds.uid, creds.key,
    'purchase.order', 'button_confirm', [[po_id]]);

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

async function cancelPO(body, user, creds, cfg, brand, DB) {
  if (user.role !== 'admin' && user.role !== 'purchase') {
    return json({ error: 'Insufficient permissions' }, 403);
  }

  const { po_id } = body;
  if (!po_id) return json({ error: 'Missing po_id' }, 400);

  const check = await checkPOEditable(creds, po_id);
  if (!check.ok) return json({ error: check.error }, 400);

  await odooCall(creds.uid, creds.key,
    'purchase.order', 'button_cancel', [[po_id]]);

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

  // Copy reserved → done quantities in one call (correct Odoo 17+ API).
  // This replaces the old stock.move.write loop which wrote to a computed field
  // and silently had no effect in Odoo 17/19, leaving done qty at 0.
  await odooCall(sysCreds.uid, sysCreds.key,
    'stock.picking', 'action_set_quantities_to_reservation', [[picking_id]]);

  // Handle lot/serial requirements: read move lines and create lots where missing
  const moveLines = await odooCall(sysCreds.uid, sysCreds.key,
    'stock.move.line', 'search_read',
    [[['picking_id', '=', picking_id], ['state', 'not in', ['done', 'cancel']]]],
    { fields: ['id', 'lot_id', 'product_id'] }
  );

  for (const ml of moveLines) {
    if (!ml.lot_id) {
      const prodInfo = await odooCall(sysCreds.uid, sysCreds.key,
        'product.product', 'read', [[ml.product_id[0]]],
        { fields: ['tracking'] }
      );
      if (prodInfo[0] && prodInfo[0].tracking && prodInfo[0].tracking !== 'none') {
        const lotName = `RCV-${picking.name.replace(/\//g, '-')}-${ml.id}`;
        const lotId = await odooCall(sysCreds.uid, sysCreds.key,
          'stock.lot', 'create',
          [{ name: lotName, product_id: ml.product_id[0], company_id: cfg.company_id }]
        );
        await odooCall(sysCreds.uid, sysCreds.key,
          'stock.move.line', 'write', [[ml.id], { lot_id: lotId }]);
      }
    }
  }

  // Validate — skip_backorder creates no backorder for short-received items,
  // skip_immediate tells Odoo not to reopen the "set quantities" dialog.
  await odooCall(sysCreds.uid, sysCreds.key,
    'stock.picking', 'button_validate', [[picking_id]],
    { context: { skip_backorder: true, skip_immediate: true } });

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
    }]
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
      [{ partner_id: vendor.odoo_id, product_id: odooId, company_id: cfg.company_id }]
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
        [{ partner_id: vendor.odoo_id, product_id: product.odoo_id, company_id: cfg.company_id }]);
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
    closingStock = { ...decomposedRawInput };
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

async function fetchPurchasesReceived(creds, cfg, fromOdoo, toOdoo) {
  // Find incoming pickings (receipts) that were completed in the period
  const pickings = await odooCall(creds.uid, creds.key,
    'stock.picking', 'search_read',
    [[['picking_type_id.code', '=', 'incoming'],
      ['state', '=', 'done'],
      ['date_done', '>=', fromOdoo],
      ['date_done', '<=', toOdoo],
      ['company_id', '=', cfg.company_id]]],
    { fields: ['id', 'move_ids'] }
  );

  if (!pickings || pickings.length === 0) return {};

  const allMoveIds = pickings.flatMap(p => p.move_ids || []);
  if (allMoveIds.length === 0) return {};

  const moves = await odooCall(creds.uid, creds.key,
    'stock.move', 'read', [allMoveIds],
    { fields: ['product_id', 'quantity'] }
  );

  // Get HN-RM codes for products
  const productIds = [...new Set(moves.map(m => m.product_id[0]))];
  // We need to map Odoo product IDs to HN-RM codes
  // Batch fetch product default_codes
  const products = await odooCall(creds.uid, creds.key,
    'product.product', 'read', [productIds],
    { fields: ['id', 'default_code'] }
  );
  const codeMap = {};
  for (const p of products) {
    if (p.default_code && p.default_code.startsWith('HN-RM-')) {
      codeMap[p.id] = p.default_code;
    }
  }

  // Aggregate by HN-RM code
  const purchased = {};
  for (const move of moves) {
    const code = codeMap[move.product_id[0]];
    if (code) {
      purchased[code] = (purchased[code] || 0) + (move.quantity || 0);
    }
  }
  return purchased;
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
          [[quants[0].id], { inventory_quantity: qty }]
        );
        await odooCall(creds.uid, creds.key,
          'stock.quant', 'action_apply_inventory', [[quants[0].id]]
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
        }]
      );
      await odooCall(creds.uid, creds.key,
        'stock.quant', 'action_apply_inventory', [[newQuant]]
      );
      results.push({ code, odoo_id: product.odoo_id, action: 'created', qty });
    }
  }
  return results;
}

/* ━━━ Utility ━━━ */

function round(v, d = 4) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}
