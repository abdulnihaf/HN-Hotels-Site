/* --------------------------------------------------------------------------
 * HN Hotels - Purchase Control API
 * Route: /api/purchase-control
 *
 * Phase 1:
 * - Build the live raw-material universe from the last 30 days of Odoo POs.
 * - Normalize materials into categories and purchase-source recommendations.
 * - Create confirmed Odoo purchase orders for local-vendor cart lines.
 *
 * External quick-commerce sources are represented as assisted checkout
 * adapters here. Live price capture can attach to the same source contract.
 * -------------------------------------------------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB = 'main';

const BRAND_CONFIG = {
  HE: { company_id: 2, label: 'Hamza Express' },
  NCH: { company_id: 3, label: 'Nawabi Chai House' },
};

const USERS = {
  '0305': { name: 'Nihaf', role: 'admin', odoo: 'system', odoo_uid: 2 },
  '5882': { name: 'Nihaf', role: 'admin', odoo: 'system', odoo_uid: 2 },
  '2026': { name: 'Zoya', role: 'purchase', odoo: 'zoya', odoo_uid: 6 },
  '8316': { name: 'Zoya', role: 'purchase', odoo: 'zoya', odoo_uid: 6 },
  '3678': { name: 'Faheem', role: 'settlement', odoo: 'faheem', odoo_uid: 9 },
  '6045': { name: 'Faheem', role: 'settlement', odoo: 'faheem', odoo_uid: 9 },
  '6890': { name: 'Tanveer', role: 'staff', odoo: 'system', odoo_uid: 8 },
  '7115': { name: 'Kesmat', role: 'staff', odoo: 'system', odoo_uid: 13 },
  '3946': { name: 'Jafar', role: 'staff', odoo: 'system', odoo_uid: 2 },
  '9991': { name: 'Mujib', role: 'staff', odoo: 'system', odoo_uid: 15 },
  '3697': { name: 'Yashwant', role: 'staff', odoo: 'system', odoo_uid: 10 },
  '3754': { name: 'Naveen', role: 'staff', odoo: 'system', odoo_uid: 5 },
  '8241': { name: 'Nafees', role: 'staff', odoo: 'system', odoo_uid: 14 },
  '8523': { name: 'Basheer', role: 'staff', odoo: 'system', odoo_uid: 7 },
  '4040': { name: 'Haneef', role: 'viewer', odoo: 'system', odoo_uid: 2 },
  '5050': { name: 'Nisar', role: 'viewer', odoo: 'system', odoo_uid: 2 },
};

const CATEGORY_ORDER = [
  'Fresh Vegetables & Produce',
  'Dairy & Eggs',
  'Meat & Poultry',
  'Oils & Fats',
  'Dry Goods & Staples',
  'Lentils & Pulses',
  'Spices & Seasoning',
  'Sauces & Condiments',
  'Dry Fruits & Nuts',
  'Bakery',
  'Ready-Made & Snacks',
  'Beverage Inputs',
  'Water',
  'Packaging & Disposables',
  'Fuel & Production',
  'Cleaning & Non-Food',
];

const SOURCE_URLS = {
  LOCAL_VENDOR: '/ops/purchase/',
  HYPERPURE: 'https://www.hyperpure.com/',
  ZEPTO: 'https://www.zepto.com/',
  FLIPKART_MINUTES: 'https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL',
  INSTAMART: 'https://www.swiggy.com/stores/instamart/',
  BLINKIT: 'https://blinkit.com/',
  AMAZON_NOW: 'https://www.amazon.in/',
  BIGBASKET: 'https://www.bigbasket.com/',
  JIOMART: 'https://www.jiomart.com/',
};

const SOURCES = [
  { key: 'LOCAL_VENDOR', label: 'Local Vendor', status: 'live', mode: 'odoo_po', delivery_band: 'Same day / vendor route', url: SOURCE_URLS.LOCAL_VENDOR },
  { key: 'HYPERPURE', label: 'Hyperpure', status: 'assisted', mode: 'portal_cart', delivery_band: 'Scheduled B2B', url: SOURCE_URLS.HYPERPURE },
  { key: 'ZEPTO', label: 'Zepto', status: 'assisted', mode: 'quick_commerce', delivery_band: 'Fast fill-in', url: SOURCE_URLS.ZEPTO },
  { key: 'FLIPKART_MINUTES', label: 'Flipkart Minutes', status: 'assisted', mode: 'quick_commerce', delivery_band: 'Fast fill-in', url: SOURCE_URLS.FLIPKART_MINUTES },
  { key: 'INSTAMART', label: 'Instamart', status: 'assisted', mode: 'quick_commerce', delivery_band: 'Fast fill-in', url: SOURCE_URLS.INSTAMART },
  { key: 'BLINKIT', label: 'Blinkit', status: 'assisted', mode: 'quick_commerce', delivery_band: 'Fast fill-in', url: SOURCE_URLS.BLINKIT },
  { key: 'AMAZON_NOW', label: 'Amazon Now', status: 'assisted', mode: 'marketplace', delivery_band: 'Fast / scheduled', url: SOURCE_URLS.AMAZON_NOW },
  { key: 'BIGBASKET', label: 'BigBasket', status: 'assisted', mode: 'grocery', delivery_band: 'Scheduled / same day', url: SOURCE_URLS.BIGBASKET },
  { key: 'JIOMART', label: 'JioMart', status: 'assisted', mode: 'grocery', delivery_band: 'Scheduled / same day', url: SOURCE_URLS.JIOMART },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function coCtx(cfg, extra) {
  return { ...(extra || {}), context: { ...(extra?.context || {}), allowed_company_ids: [cfg.company_id] } };
}

function getOdooCredentials(user, env) {
  if (user.odoo === 'zoya' && env.ODOO_UID_ZOYA && env.ODOO_KEY_ZOYA) {
    return { uid: parseInt(env.ODOO_UID_ZOYA, 10), key: env.ODOO_KEY_ZOYA };
  }
  if (user.odoo === 'faheem' && env.ODOO_UID_FAHEEM && env.ODOO_KEY_FAHEEM) {
    return { uid: parseInt(env.ODOO_UID_FAHEEM, 10), key: env.ODOO_KEY_FAHEEM };
  }
  return { uid: 2, key: env.ODOO_API_KEY };
}

async function odooCall(uid, apiKey, model, method, args, kwargs) {
  if (!apiKey) throw new Error('Odoo API key is not configured in this environment');
  const response = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [ODOO_DB, uid, apiKey, model, method, args, kwargs || {}],
      },
      id: Date.now(),
    }),
  });
  const data = await response.json();
  if (data.error) {
    const message = data.error.data?.message || data.error.message || JSON.stringify(data.error);
    throw new Error(`Odoo ${model}.${method}: ${message}`);
  }
  return data.result;
}

function toOdooDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function cleanBrand(value) {
  if (value === 'HE' || value === 'NCH' || value === 'BOTH') return value;
  return 'BOTH';
}

function parseProductName(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) return { code: '', name: raw };
  return { code: match[1].trim(), name: match[2].trim() };
}

function itemKey(code, name, uom) {
  if (code) return `code:${code}`;
  return `name:${String(name || '').toLowerCase()}|uom:${String(uom || '').toLowerCase()}`;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, places = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(places));
}

function maxDate(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return String(a) > String(b) ? a : b;
}

function categoryFor(name, code, odooCategory) {
  const text = `${name || ''} ${code || ''} ${odooCategory || ''}`.toLowerCase();
  const has = (...terms) => terms.some((term) => text.includes(term));

  if (has('bag', 'box', 'foil', 'container', 'parcel', 'packing', 'packaging', 'cover', 'tissue', 'paper', 'cup', 'lid', 'straw', 'plate', 'spoon', 'fork', 'disposable', 'seal', 'sticker', 'carry')) return 'Packaging & Disposables';
  if (has('phenyl', 'soap', 'clean', 'cleaning', 'detergent', 'acid', 'bleach', 'gloves', 'broom', 'mop', 'scrub', 'garbage', 'garbage bag', 'sanitizer')) return 'Cleaning & Non-Food';
  if (has('gas', 'cylinder', 'charcoal', 'coal')) return 'Fuel & Production';
  if (has('water', 'bottle', 'bisleri')) return 'Water';
  if (has('chai', 'tea', 'coffee', 'milk powder', 'boost', 'horlicks', 'badam powder', 'rose syrup', 'sugar syrup', 'rooh')) return 'Beverage Inputs';
  if (has('bun', 'bread', 'pav', 'rumali', 'roti')) return 'Bakery';
  if (has('samosa', 'biscuit', 'chips', 'snack', 'ready')) return 'Ready-Made & Snacks';
  if (has('cashew', 'kaju', 'almond', 'badam', 'raisin', 'kishmish', 'pista', 'dry fruit')) return 'Dry Fruits & Nuts';
  if (has('sauce', 'ketchup', 'mayonnaise', 'vinegar', 'pickle', 'chutney', 'soya sauce')) return 'Sauces & Condiments';
  if (has('masala', 'chilli', 'chili', 'pepper', 'jeera', 'cumin', 'dhaniya', 'coriander powder', 'turmeric', 'haldi', 'garam', 'elaichi', 'cardamom', 'clove', 'lavang', 'cinnamon', 'dalchini', 'bay leaf', 'star anise', 'ginger garlic', 'salt', 'kasuri', 'kesar', 'saffron')) return 'Spices & Seasoning';
  if (has('dal', 'dhal', 'lentil', 'chana', 'gram', 'rajma', 'moong', 'urad', 'toor')) return 'Lentils & Pulses';
  if (has('rice', 'atta', 'maida', 'flour', 'rava', 'sooji', 'sugar', 'jaggery', 'corn flour', 'besan', 'starch', 'vermicelli', 'seviyan')) return 'Dry Goods & Staples';
  if (has('oil', 'ghee', 'butter', 'vanaspati', 'margarine', 'fat')) return 'Oils & Fats';
  if (has('chicken', 'mutton', 'meat', 'keema', 'beef', 'fish', 'prawn', 'bone', 'liver')) return 'Meat & Poultry';
  if (has('milk', 'curd', 'yogurt', 'yoghurt', 'paneer', 'cheese', 'cream', 'egg')) return 'Dairy & Eggs';
  if (has('onion', 'tomato', 'potato', 'carrot', 'cucumber', 'lemon', 'lime', 'mint', 'coriander', 'kothimir', 'green chilli', 'capsicum', 'ginger', 'garlic', 'cabbage', 'beans', 'vegetable', 'fruit', 'banana')) return 'Fresh Vegetables & Produce';

  return CATEGORY_ORDER.includes(odooCategory) ? odooCategory : 'Dry Goods & Staples';
}

function sourceKeysFor(category, name) {
  const text = `${category || ''} ${name || ''}`.toLowerCase();
  const base = ['LOCAL_VENDOR'];
  if (category === 'Meat & Poultry') return ['LOCAL_VENDOR', 'HYPERPURE'];
  if (category === 'Fresh Vegetables & Produce') return ['LOCAL_VENDOR', 'HYPERPURE', 'ZEPTO', 'BLINKIT', 'INSTAMART', 'BIGBASKET'];
  if (category === 'Dairy & Eggs') return ['LOCAL_VENDOR', 'HYPERPURE', 'BLINKIT', 'ZEPTO', 'INSTAMART', 'BIGBASKET'];
  if (category === 'Packaging & Disposables') return ['LOCAL_VENDOR', 'HYPERPURE', 'AMAZON_NOW', 'BIGBASKET', 'JIOMART'];
  if (category === 'Cleaning & Non-Food') return ['LOCAL_VENDOR', 'AMAZON_NOW', 'BIGBASKET', 'JIOMART', 'BLINKIT'];
  if (category === 'Water' || text.includes('bottle')) return ['LOCAL_VENDOR', 'BIGBASKET', 'JIOMART', 'BLINKIT', 'ZEPTO', 'INSTAMART'];
  if (['Dry Goods & Staples', 'Lentils & Pulses', 'Spices & Seasoning', 'Oils & Fats', 'Sauces & Condiments', 'Dry Fruits & Nuts', 'Beverage Inputs'].includes(category)) {
    return ['LOCAL_VENDOR', 'HYPERPURE', 'BIGBASKET', 'JIOMART', 'AMAZON_NOW', 'BLINKIT', 'ZEPTO', 'INSTAMART'];
  }
  return [...base, 'HYPERPURE', 'BIGBASKET', 'BLINKIT', 'ZEPTO'];
}

function priorityHint(timesOrdered, brandsSeen, lastDate) {
  const days = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : 99;
  if (timesOrdered >= 10 || brandsSeen.length > 1 || days <= 2) return 'High';
  if (timesOrdered >= 4 || days <= 7) return 'Medium';
  return 'Low';
}

function suggestedQty(totalQty, timesOrdered, lastQty) {
  if (lastQty > 0) return round(lastQty, 2);
  if (timesOrdered > 0) return round(totalQty / timesOrdered, 2);
  return 1;
}

function canCreate(user) {
  return user.role === 'admin' || user.role === 'purchase';
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(context.request.url);
  const env = context.env;

  try {
    if (context.request.method === 'GET') return await handleGet(url, env);
    if (context.request.method === 'POST') return await handlePost(context, env);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message || 'Unknown error' }, 500);
  }
}

async function handleGet(url, env) {
  const action = url.searchParams.get('action') || 'materials';
  const pin = url.searchParams.get('pin') || '';
  const user = USERS[pin];
  if (!user) return json({ error: 'Invalid PIN' }, 401);

  if (action === 'verify-pin') {
    return json({
      success: true,
      user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
    });
  }

  if (action === 'sources') {
    return json({ success: true, sources: SOURCES });
  }

  if (action !== 'materials') {
    return json({ error: `Unknown GET action: ${action}` }, 400);
  }

  const brand = cleanBrand(url.searchParams.get('brand') || 'BOTH');
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '30', 10)));
  const creds = getOdooCredentials({ odoo: 'system' }, env);
  const data = await loadMaterialUniverse(creds, brand, days);
  return json({
    success: true,
    ...data,
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function loadMaterialUniverse(creds, brand, days) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86400000);
  const brands = brand === 'BOTH' ? ['HE', 'NCH'] : [brand];
  const aggregates = new Map();
  const meta = {
    source: 'Odoo purchase.order + purchase.order.line',
    brand,
    days,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    fetched_at: new Date().toISOString(),
    sample: false,
    po_counts: {},
    line_count: 0,
  };

  for (const b of brands) {
    const cfg = BRAND_CONFIG[b];
    const poRows = await odooCall(creds.uid, creds.key, 'purchase.order', 'search_read', [[
      ['company_id', '=', cfg.company_id],
      ['state', '!=', 'cancel'],
      ['date_order', '>=', toOdooDatetime(from)],
    ]], {
      fields: ['id', 'name', 'partner_id', 'date_order', 'state', 'amount_total'],
      order: 'date_order desc',
      limit: 1200,
    });

    meta.po_counts[b] = poRows.length;
    if (!poRows.length) continue;

    const poById = new Map(poRows.map((po) => [po.id, po]));
    const poIds = poRows.map((po) => po.id);
    const lineRows = await odooCall(creds.uid, creds.key, 'purchase.order.line', 'search_read', [[
      ['order_id', 'in', poIds],
      ['state', '!=', 'cancel'],
    ]], {
      fields: ['id', 'order_id', 'product_id', 'product_qty', 'price_unit', 'price_subtotal', 'name', 'product_uom_id'],
      order: 'id desc',
      limit: 5000,
    });

    meta.line_count += lineRows.length;
    const productIds = [...new Set(lineRows.map((line) => line.product_id?.[0]).filter(Boolean))];
    const products = productIds.length
      ? await odooCall(creds.uid, creds.key, 'product.product', 'read', [productIds], {
        fields: ['id', 'name', 'default_code', 'uom_id', 'categ_id'],
      })
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));

    for (const line of lineRows) {
      const poId = line.order_id?.[0];
      const po = poById.get(poId);
      const productId = line.product_id?.[0] || null;
      const product = productId ? productById.get(productId) : null;
      const parsed = parseProductName(product?.name || line.product_id?.[1] || line.name);
      const code = product?.default_code || parsed.code || '';
      const name = parsed.name || product?.name || line.name || 'Raw material';
      const uom = line.product_uom_id?.[1] || product?.uom_id?.[1] || 'Units';
      const key = itemKey(code, name, uom);
      const vendorId = po?.partner_id?.[0] || null;
      const vendorName = po?.partner_id?.[1] || 'Unknown vendor';
      const date = dateOnly(po?.date_order);
      const qty = safeNumber(line.product_qty);
      const price = safeNumber(line.price_unit);
      const subtotal = safeNumber(line.price_subtotal) || (qty > 0 && price > 0 ? qty * price : 0);

      if (!aggregates.has(key)) {
        const category = categoryFor(name, code, product?.categ_id?.[1]);
        aggregates.set(key, {
          key,
          product_code: code,
          name,
          search_query: name,
          category,
          uom,
          brands_seen: new Set(),
          product_ids_by_brand: {},
          vendorMap: new Map(),
          raw_names: new Set(),
          poIds: new Set(),
          times_ordered: 0,
          total_qty: 0,
          known_amount: 0,
          known_qty: 0,
          lines_without_amount: 0,
          last_purchase_date: '',
          last_qty: 0,
          last_price: 0,
          last_vendor_id: null,
          last_vendor_name: '',
        });
      }

      const item = aggregates.get(key);
      item.brands_seen.add(b);
      if (productId) item.product_ids_by_brand[b] = productId;
      item.raw_names.add(product?.name || line.product_id?.[1] || line.name || name);
      if (poId) item.poIds.add(`${b}:${poId}`);
      item.times_ordered += 1;
      item.total_qty += qty;
      if (subtotal > 0 && qty > 0) {
        item.known_amount += subtotal;
        item.known_qty += qty;
      } else {
        item.lines_without_amount += 1;
      }
      if (!item.last_purchase_date || date > item.last_purchase_date) {
        item.last_purchase_date = date;
        item.last_qty = qty;
        item.last_price = price;
        item.last_vendor_id = vendorId;
        item.last_vendor_name = vendorName;
      }

      const vendorKey = `${b}:${vendorId || vendorName}`;
      if (!item.vendorMap.has(vendorKey)) {
        item.vendorMap.set(vendorKey, {
          brand: b,
          id: vendorId,
          name: vendorName,
          times: 0,
          last_price: 0,
          last_date: '',
        });
      }
      const vendor = item.vendorMap.get(vendorKey);
      vendor.times += 1;
      if (!vendor.last_date || date > vendor.last_date) {
        vendor.last_date = date;
        vendor.last_price = price;
      }
    }
  }

  const items = [...aggregates.values()].map((item) => {
    const avg = item.known_qty > 0 ? item.known_amount / item.known_qty : 0;
    const brandsSeen = [...item.brands_seen].sort();
    const sourceKeys = sourceKeysFor(item.category, item.name);
    const vendors = [...item.vendorMap.values()].sort((a, b) => {
      if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
      return b.times - a.times;
    });
    const localVendor = vendors.find((vendor) => vendor.id === item.last_vendor_id) || vendors[0] || null;

    return {
      id: item.key,
      product_code: item.product_code,
      name: item.name,
      search_query: item.search_query,
      category: item.category,
      uom: item.uom,
      brands_seen: brandsSeen,
      product_ids_by_brand: item.product_ids_by_brand,
      vendors,
      times_ordered: item.times_ordered,
      total_qty: round(item.total_qty),
      known_amount: round(item.known_amount),
      lines_without_amount: item.lines_without_amount,
      avg_unit_price: round(avg),
      local_price: round(item.last_price || avg),
      last_purchase_date: item.last_purchase_date,
      last_qty: round(item.last_qty),
      suggested_qty: suggestedQty(item.total_qty, item.times_ordered, item.last_qty),
      po_count: item.poIds.size,
      raw_name_variants: [...item.raw_names].slice(0, 8),
      priority_hint: priorityHint(item.times_ordered, brandsSeen, item.last_purchase_date),
      source_keys: sourceKeys,
      preferred_source: 'LOCAL_VENDOR',
      last_vendor_id: localVendor?.id || null,
      last_vendor_name: localVendor?.name || '',
      confidence: item.lines_without_amount > item.times_ordered / 2 ? 'medium' : 'high',
      confidence_reasons: item.lines_without_amount > item.times_ordered / 2
        ? ['Some historical PO lines had no reliable amount']
        : ['Live purchase history matched'],
    };
  }).sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    if (b.times_ordered !== a.times_ordered) return b.times_ordered - a.times_ordered;
    return a.name.localeCompare(b.name);
  });

  const categoryCounts = {};
  for (const item of items) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  const categories = CATEGORY_ORDER
    .filter((category) => categoryCounts[category])
    .map((category) => ({ name: category, count: categoryCounts[category] }));

  meta.unique_items = items.length;

  return {
    meta,
    sources: SOURCES,
    category_order: CATEGORY_ORDER,
    categories,
    summary: {
      item_count: items.length,
      category_count: categories.length,
      po_count: Object.values(meta.po_counts).reduce((sum, count) => sum + count, 0),
      line_count: meta.line_count,
      high_priority_count: items.filter((item) => item.priority_hint === 'High').length,
      assisted_source_count: SOURCES.filter((source) => source.status === 'assisted').length,
    },
    items,
  };
}

async function handlePost(context, env) {
  const url = new URL(context.request.url);
  const body = await context.request.json().catch(() => ({}));
  const action = body.action || url.searchParams.get('action');
  const user = USERS[body.pin || ''];
  if (!user) return json({ error: 'Invalid PIN' }, 401);

  if (action !== 'create-local-po') {
    return json({ error: `Unknown POST action: ${action}` }, 400);
  }

  return createLocalPO(body, user, env, context.env.DB);
}

async function createLocalPO(body, user, env, DB) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can create purchase orders' }, 403);

  const brand = body.brand;
  const cfg = BRAND_CONFIG[brand];
  if (!cfg) return json({ error: 'Choose HE or NCH before creating an Odoo PO' }, 400);

  const vendorId = parseInt(body.vendor_id, 10);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!vendorId || !lines.length) return json({ error: 'Missing vendor or PO lines' }, 400);

  const productIds = [...new Set(lines.map((line) => parseInt(line.product_id, 10)).filter(Boolean))];
  if (!productIds.length) return json({ error: 'No Odoo product IDs available for these cart lines' }, 400);

  const creds = getOdooCredentials({ odoo: 'system' }, env);
  const products = await odooCall(creds.uid, creds.key, 'product.product', 'read', [productIds], {
    fields: ['id', 'name', 'default_code', 'uom_id'],
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const planned = toOdooDatetime(new Date());

  const orderLines = [];
  for (const line of lines) {
    const productId = parseInt(line.product_id, 10);
    const product = productById.get(productId);
    if (!product) continue;

    const qty = safeNumber(line.qty);
    const priceUnit = safeNumber(line.price_unit);
    if (qty <= 0) continue;

    orderLines.push([0, 0, {
      product_id: productId,
      product_qty: qty,
      price_unit: priceUnit,
      name: line.name || product.name,
      product_uom_id: product.uom_id?.[0] || 1,
      date_planned: planned,
    }]);
  }

  if (!orderLines.length) return json({ error: 'No valid lines after product validation' }, 400);

  const poId = await odooCall(creds.uid, creds.key, 'purchase.order', 'create', [{
    partner_id: vendorId,
    company_id: cfg.company_id,
    order_line: orderLines,
    x_recorded_by_user_id: user.odoo_uid || 2,
  }], coCtx(cfg));

  await odooCall(creds.uid, creds.key, 'purchase.order', 'button_confirm', [[poId]], coCtx(cfg));
  const po = await odooCall(creds.uid, creds.key, 'purchase.order', 'read', [[poId]], {
    fields: ['id', 'name', 'amount_total', 'partner_id', 'state'],
  });
  const created = po?.[0] || { id: poId, name: `PO#${poId}` };

  if (DB) {
    const now = new Date().toISOString();
    try {
      await DB.prepare(
        'INSERT INTO rm_ops_log (action, brand, user_name, details, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind('purchase_control_create_po', brand, user.name, JSON.stringify({
        po_id: created.id,
        po_name: created.name,
        vendor_id: vendorId,
        line_count: orderLines.length,
      }), now).run();
    } catch (_) {
      // D1 logging is useful, but PO creation must remain the blocking action.
    }
  }

  return json({
    success: true,
    po: {
      id: created.id,
      name: created.name,
      amount_total: created.amount_total || 0,
      vendor: created.partner_id?.[1] || '',
      state: created.state || 'purchase',
      odoo_url: `https://odoo.hnhotels.in/web#id=${created.id}&model=purchase.order&view_type=form`,
    },
  });
}
