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
  '3678': { name: 'Farooq',  role: 'settlement',  odoo: 'faheem' },
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

  const brand = url.searchParams.get('brand');
  if (!brand || !BRAND_CONFIG[brand]) return json({ error: 'Missing or invalid brand (HE|NCH)' }, 400);

  const cfg = BRAND_CONFIG[brand];
  const creds = getOdooCredentials({ odoo: 'system' }, env);

  switch (action) {
    case 'vendors':     return getVendors(creds, cfg);
    case 'products':    return getProducts(creds, cfg);
    case 'last-prices': return getLastPrices(creds, cfg, url);
    case 'recent-pos':  return getRecentPOs(creds, cfg, url);
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
    'SELECT * FROM rm_settlements WHERE brand = ? AND status = ? ORDER BY settled_at DESC LIMIT 1'
  ).bind(brand, 'completed').first() : null;

  const periodStart = previous ? previous.settled_at : nowISO;
  const periodEnd = nowISO;

  // Opening stock from previous settlement's closing
  let openingStock = {};
  if (previous && previous.closing_stock) {
    openingStock = JSON.parse(previous.closing_stock);
  }

  // Tracked items for this brand
  const tracked = DB ? await DB.prepare(
    'SELECT ti.*, p.name, p.uom, p.category, p.avg_cost FROM rm_tracked_items ti JOIN rm_products p ON ti.product_code = p.hn_code WHERE ti.brand = ? AND ti.is_active = 1 ORDER BY ti.tier, p.name'
  ).bind(brand).all() : { results: [] };

  // Purchases received in period
  const fromUTC = istToUTC(periodStart);
  const toUTC = istToUTC(periodEnd);
  const fromOdoo = toOdooDatetime(fromUTC);
  const toOdoo = toOdooDatetime(toUTC);

  const purchases = await fetchPurchasesReceived(creds, cfg, fromOdoo, toOdoo);

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

  return json({
    success: true,
    brand,
    settlementDate: nowISO.slice(0, 10),
    period: { start: periodStart, end: periodEnd },
    needsBootstrap: !previous,
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
    case 'add-product':     return addProduct(body, user, creds, cfg, brand, env, DB);
    case 'update-price':    return updatePrice(body, user, brand, DB);
    case 'settlement-submit': return settlementSubmit(body, user, creds, cfg, brand, DB);
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

/* ── Settlement Submit ── */

async function settlementSubmit(body, user, creds, cfg, brand, DB) {
  if (!DB) return json({ error: 'Database not configured' }, 500);

  const { counts, notes, is_bootstrap } = body;
  if (!counts || typeof counts !== 'object' || Object.keys(counts).length === 0) {
    return json({ error: 'Missing counts object' }, 400);
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

  // Fetch purchases received in period
  const fromUTC = istToUTC(periodStart);
  const toUTC = istToUTC(periodEnd);
  const fromOdoo = toOdooDatetime(fromUTC);
  const toOdoo = toOdooDatetime(toUTC);

  const sysCreds = getOdooCredentials({ odoo: 'system' }, { ...creds, ODOO_API_KEY: creds.key });
  const purchased = await fetchPurchasesReceived(
    { uid: 2, key: DB ? creds.key : creds.key }, cfg, fromOdoo, toOdoo
  );

  // Calculate consumption: opening + purchased - closing
  const consumed = {};
  const costSummary = { total: 0, per_item: {} };

  // Get latest prices
  const priceMap = {};
  for (const code of Object.keys(counts)) {
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

  for (const [code, closingQty] of Object.entries(counts)) {
    const opening = openingStock[code] || 0;
    const purchasedQty = purchased[code] || 0;
    const consumedQty = is_bootstrap ? 0 : round(opening + purchasedQty - closingQty);

    consumed[code] = consumedQty;

    const unitPrice = priceMap[code] || 0;
    const itemCost = round(consumedQty * unitPrice);
    costSummary.per_item[code] = { consumed: consumedQty, price: unitPrice, cost: itemCost };
    costSummary.total += itemCost;
  }
  costSummary.total = round(costSummary.total);

  // Store settlement
  await DB.prepare(`INSERT INTO rm_settlements
    (brand, settlement_date, settled_by, period_start, period_end,
     opening_stock, closing_stock, purchased, consumed, cost_summary, notes, status, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    brand, settlementDate, user.name, periodStart, periodEnd,
    JSON.stringify(openingStock),
    JSON.stringify(counts),
    JSON.stringify(purchased),
    JSON.stringify(consumed),
    JSON.stringify(costSummary),
    notes || '',
    is_bootstrap ? 'bootstrap' : 'completed',
    nowISO
  ).run();

  // Sync closing stock to Odoo (update stock.quant)
  if (!is_bootstrap) {
    const syncResults = await syncStockToOdoo(creds, cfg, counts, DB);
    // Log sync
    await DB.prepare(
      'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('settlement_sync', brand, user.name, JSON.stringify({
      items_synced: syncResults.length, settlement_date: settlementDate,
    }), nowISO).run();
  }

  // Log settlement
  await DB.prepare(
    'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    is_bootstrap ? 'settlement_bootstrap' : 'settlement',
    brand, user.name,
    JSON.stringify({ settlement_date: settlementDate, items: Object.keys(counts).length, total_cost: costSummary.total }),
    nowISO
  ).run();

  return json({
    success: true,
    brand,
    settlementDate,
    settledBy: user.name,
    status: is_bootstrap ? 'bootstrap' : 'completed',
    period: { start: periodStart, end: periodEnd },
    openingStock,
    closingStock: counts,
    purchased,
    consumed,
    costSummary,
  });
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

function round(v, d = 2) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}
