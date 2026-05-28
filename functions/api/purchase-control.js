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

const RUN_STATUSES = ['DRAFT', 'QUOTING', 'REVIEW', 'CART_BUILDING', 'AWAITING_CHECKOUT', 'ORDERED', 'RECONCILED'];
const RUN_TYPES = ['MORNING_PURCHASE', 'EVENING_TOPUP', 'URGENT_FILL'];
const PORTAL_SOURCE_KEYS = SOURCES.map((source) => source.key).filter((key) => key !== 'LOCAL_VENDOR');
const QUOTE_STOCK_STATUSES = ['QUOTED', 'PENDING_ADAPTER', 'OUT_OF_STOCK', 'UNAVAILABLE', 'ERROR'];
const SOURCE_BY_KEY = Object.fromEntries(SOURCES.map((source) => [source.key, source]));
const PORTAL_SESSION_STATUSES = ['READY', 'NOT_CONNECTED', 'EXPIRED', 'OTP_REQUIRED', 'CAPTCHA_REQUIRED', 'LOCATION_MISMATCH', 'RATE_LIMITED', 'BROKEN'];

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

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function round(value, places = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(places));
}

function makeId(prefix) {
  const rand = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${rand}`;
}

function cleanRunStatus(value) {
  return RUN_STATUSES.includes(value) ? value : 'DRAFT';
}

function cleanRunType(value) {
  return RUN_TYPES.includes(value) ? value : 'MORNING_PURCHASE';
}

function cleanSourceKey(value) {
  return SOURCE_BY_KEY[value] ? value : 'LOCAL_VENDOR';
}

function cleanQuoteStatus(value) {
  return QUOTE_STOCK_STATUSES.includes(value) ? value : 'PENDING_ADAPTER';
}

function paiseFrom(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function quoteLineId(batchId, sourceKey, line) {
  const basis = String(line.cart_id || line.item_id || line.product_code || line.name || 'line')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return `PQL-${batchId}-${sourceKey}-${basis}`;
}

function portalSessionKey(sourceKey) {
  return `purchase:portal-session:${sourceKey}`;
}

function cleanPortalSessionStatus(value) {
  return PORTAL_SESSION_STATUSES.includes(value) ? value : 'NOT_CONNECTED';
}

function isPastIso(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function countCookies(payload) {
  const storedCount = Array.isArray(payload?.cookies) ? payload.cookies.length : 0;
  const visibleCount = payload?.visible_cookies && typeof payload.visible_cookies === 'object'
    ? Object.keys(payload.visible_cookies).length
    : 0;
  if (storedCount || visibleCount) return storedCount + visibleCount;
  if (Array.isArray(payload?.storage_state?.cookies)) return payload.storage_state.cookies.length;
  return 0;
}

function countTokens(payload) {
  const tokenish = JSON.stringify(payload || {}).match(/token|auth|jwt|bearer|session/gi);
  return tokenish ? tokenish.length : 0;
}

function browserHint(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('Chrome')) return 'Chrome';
  if (text.includes('Safari')) return 'Safari';
  if (text.includes('Firefox')) return 'Firefox';
  return text.slice(0, 32);
}

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function fieldValue(object, names) {
  const obj = asObject(object);
  const lowerMap = new Map(Object.keys(obj).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lowerMap.get(String(name).toLowerCase());
    if (key && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return '';
}

function deepFieldValue(value, names, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 3 || seen.has(value)) return '';
  seen.add(value);
  const direct = fieldValue(value, names);
  if (direct !== '') return direct;
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const nested = deepFieldValue(child, names, depth + 1, seen);
    if (nested !== '') return nested;
  }
  return '';
}

function parsePricePaise(value, fieldName = '') {
  if (value && typeof value === 'object') {
    const nested = fieldValue(value, ['value', 'amount', 'price', 'sellingPrice', 'rupees', 'displayValue']);
    if (nested !== '') return parsePricePaise(nested, fieldName);
  }
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return 0;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const key = String(fieldName || '').toLowerCase();
  if (key.includes('paise') || key.includes('paisa') || key.includes('cents')) return Math.round(n);
  return n > 10000 ? Math.round(n) : Math.round(n * 100);
}

function priceFromProduct(product) {
  const fields = [
    'sellingPrice',
    'selling_price',
    'discountedPrice',
    'discounted_price',
    'finalPrice',
    'final_price',
    'offerPrice',
    'offer_price',
    'price',
    'unitPrice',
    'unit_price',
    'pricePerUnit',
    'price_per_unit',
    'mrp',
    'MRP',
  ];
  for (const field of fields) {
    const value = deepFieldValue(product, [field]);
    const paise = parsePricePaise(value, field);
    if (paise > 0) return { paise, field };
  }
  return { paise: 0, field: '' };
}

function titleFromProduct(product) {
  return cleanText(deepFieldValue(product, [
    'name',
    'productName',
    'product_name',
    'displayName',
    'display_name',
    'title',
    'skuName',
    'sku_name',
    'itemName',
    'item_name',
    'productTitle',
  ]), 180);
}

function packFromProduct(product) {
  const pack = cleanText(deepFieldValue(product, [
    'packSize',
    'pack_size',
    'pack',
    'quantity',
    'quantityText',
    'quantity_text',
    'unit',
    'unitText',
    'unit_text',
    'uom',
    'weight',
    'size',
    'variantName',
    'variant_name',
  ]), 80);
  if (pack) return pack;
  const title = titleFromProduct(product);
  const match = title.match(/\b\d+(?:\.\d+)?\s?(?:kg|g|gm|ml|l|ltr|litre|pcs|pc|pack|carton|tin|bottle|nos)\b/i);
  return match ? match[0] : '';
}

function productIdFromProduct(product) {
  return cleanText(deepFieldValue(product, [
    'productId',
    'product_id',
    'id',
    'skuId',
    'sku_id',
    'productNumber',
    'product_number',
    'catalogueId',
    'catalogue_id',
  ]), 96);
}

function availabilityFromProduct(product) {
  const text = cleanText(deepFieldValue(product, [
    'stockStatus',
    'stock_status',
    'availability',
    'availabilityStatus',
    'inventoryStatus',
    'status',
    'buttonText',
    'cta',
  ]), 140).toLowerCase();
  if (/out\s*of\s*stock|notify|unavailable|sold\s*out/.test(text)) return 'OUT_OF_STOCK';
  return 'AVAILABLE';
}

function productUrlFromProduct(product, query, sourceKey = 'HYPERPURE') {
  const raw = cleanText(deepFieldValue(product, ['productUrl', 'product_url', 'webUrl', 'web_url', 'url', 'deeplink']), 320);
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw;
  const source = SOURCE_BY_KEY[sourceKey] || SOURCE_BY_KEY.HYPERPURE;
  if (raw.startsWith('/')) {
    try {
      return new URL(raw, source?.url || 'https://www.hyperpure.com/').toString();
    } catch (_) {
      return raw;
    }
  }
  const id = productIdFromProduct(product);
  if (id && sourceKey === 'HYPERPURE') return `https://www.hyperpure.com/search?query=${encodeURIComponent(query || id)}`;
  return source?.url || SOURCE_URLS.HYPERPURE;
}

function etaFromProduct(product, sourceKey) {
  const source = SOURCE_BY_KEY[sourceKey] || SOURCE_BY_KEY.HYPERPURE;
  const explicitMinutes = Number(deepFieldValue(product, ['etaMinutes', 'eta_minutes', 'deliveryMinutes', 'delivery_minutes']));
  const label = cleanText(deepFieldValue(product, [
    'etaLabel',
    'eta_label',
    'deliveryLabel',
    'delivery_label',
    'deliveryTime',
    'delivery_time',
    'delivery',
    'promise',
  ]), 120);
  if (Number.isFinite(explicitMinutes) && explicitMinutes > 0) {
    return { minutes: Math.round(explicitMinutes), label: label || `${Math.round(explicitMinutes)} min` };
  }
  const match = label.match(/\b(?:in\s*)?(\d{1,3})\s?(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\b/i);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const minutes = unit.startsWith('hr') || unit.startsWith('hour')
      ? value * 60
      : unit.startsWith('day')
        ? value * 1440
        : value;
    return { minutes, label };
  }
  if (/tomorrow/i.test(label)) return { minutes: 1440, label };
  if (sourceKey === 'HYPERPURE') return { minutes: 1440, label: 'Hyperpure scheduled' };
  return { minutes: 0, label: label || source?.delivery_band || 'Portal live' };
}

function searchableTokens(value) {
  return cleanText(value, 240).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

function matchConfidence(query, title) {
  const tokens = searchableTokens(query);
  if (!tokens.length) return 50;
  const titleText = cleanText(title, 240).toLowerCase();
  if (!titleText) return 0;
  const cleanQuery = cleanText(query, 240).toLowerCase();
  if (cleanQuery && titleText.includes(cleanQuery)) return 96;
  const hits = tokens.filter((token) => titleText.includes(token)).length;
  if (!hits) return 25;
  return Math.max(45, Math.min(92, Math.round(40 + (hits / tokens.length) * 52)));
}

function extractProductsFromPayload(payload) {
  const products = [];
  const seen = new Set();
  const visited = new Set();

  function visit(value, depth = 0) {
    if (!value || products.length >= 80 || depth > 8) return;
    if (typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    const title = titleFromProduct(value);
    const id = productIdFromProduct(value);
    const price = priceFromProduct(value).paise;
    if (title && (price > 0 || id)) {
      const key = `${id || title}|${price}`;
      if (!seen.has(key)) {
        seen.add(key);
        products.push(value);
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') visit(child, depth + 1);
    }
  }

  visit(payload);
  return products;
}

function sessionPayload(session) {
  return asObject(session?.payload || session?.session || session);
}

function cookieMapFromSessionPayload(payload) {
  const map = {};
  const visible = asObject(payload.visible_cookies || payload.visibleCookies);
  for (const [key, value] of Object.entries(visible)) {
    if (value !== undefined && value !== null && value !== '') map[key] = String(value);
  }
  const cookies = Array.isArray(payload.cookies)
    ? payload.cookies
    : Array.isArray(payload.storage_state?.cookies)
      ? payload.storage_state.cookies
      : [];
  for (const cookie of cookies) {
    if (cookie?.name && cookie.value !== undefined && cookie.value !== null && cookie.value !== '') {
      map[cookie.name] = String(cookie.value);
    }
  }
  return map;
}

function cookieHeader(cookieMap, extra = {}) {
  const merged = { ...cookieMap, ...extra };
  return Object.entries(merged)
    .filter(([key, value]) => key && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('; ');
}

async function getPortalSessionSecret(env, sourceKey) {
  if (!env.SESSIONS) return null;
  const raw = await env.SESSIONS.get(portalSessionKey(sourceKey));
  return raw ? safeJson(raw, null) : null;
}

function hyperpureAuth(session) {
  const payload = sessionPayload(session);
  const cookies = cookieMapFromSessionPayload(payload);
  const local = asObject(payload.local_storage || payload.localStorage);
  const token = cleanText(cookies.token || local.token || local.authToken || local.accessToken, 6000);
  const outletId = cleanText(cookies.outletId || local.outletId || local.selectedOutletId || session?.outlet_id, 120);
  const deviceId = cleanText(cookies.deviceId || local.deviceId || local.device_id || payload.deviceId, 240);
  const apiVersion = cleanText(cookies.apiVersion || local.apiVersion || '12.1', 24);
  const appMode = cleanText(cookies.appMode || local.appMode || 'partner_web', 64);
  const headerCookies = cookieHeader(cookies, {
    deviceId,
    outletId,
    apiVersion,
    appMode,
  });
  return {
    token,
    outletId,
    deviceId,
    apiVersion,
    appMode,
    cookieHeader: headerCookies,
    userAgent: cleanText(session?.user_agent || payload.user_agent || payload.userAgent, 320),
  };
}

function hyperpureHeaders(auth) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-IN,en;q=0.9',
    origin: 'https://www.hyperpure.com',
    referer: 'https://www.hyperpure.com/',
    'user-agent': auth.userAgent || 'Mozilla/5.0 Chrome HN-Purchase-Console',
    APIVersion: auth.apiVersion || '12.1',
    AppType: 'HYPERPURE_WEB',
    'X-client': 'partner_web',
    'x-appmode': auth.appMode || 'partner_web',
    DeviceName: 'Chrome',
  };
  if (auth.deviceId) headers.DeviceId = auth.deviceId;
  if (auth.outletId) headers['X-OutletId'] = auth.outletId;
  if (auth.cookieHeader) headers.Cookie = auth.cookieHeader;
  if (auth.token) headers.Authorization = /^bearer\s/i.test(auth.token) ? auth.token : `Bearer ${auth.token}`;
  return headers;
}

function quoteSearchQuery(line) {
  const spec = asObject(line.buying_spec);
  return cleanText(spec.approved_name || spec.search_query || line.search_query || line.name, 160);
}

function portalErrorQuote(line, sourceKey, message, expiresAt, raw = {}) {
  return {
    stock_status: 'ERROR',
    match_rule: line.buying_spec?.match_rule || line.match_rule || '',
    match_confidence: 0,
    match_notes: message,
    expires_at: expiresAt,
    raw: { source: sourceKey, ...raw },
  };
}

function hyperpureErrorQuote(line, message, expiresAt, raw = {}) {
  return portalErrorQuote(line, 'HYPERPURE', message, expiresAt, raw);
}

function portalQuoteFromProduct(line, product, query, expiresAt, sourceKey, responseStatus) {
  const source = SOURCE_BY_KEY[sourceKey] || SOURCE_BY_KEY.HYPERPURE;
  const title = titleFromProduct(product);
  const price = priceFromProduct(product);
  const pack = packFromProduct(product);
  const availability = availabilityFromProduct(product);
  const confidence = matchConfidence(query, title);
  const eta = etaFromProduct(product, sourceKey);
  return {
    sku_title: title,
    sku_url: productUrlFromProduct(product, query, sourceKey),
    pack_size: pack,
    price_paise: price.paise,
    unit_price_paise: price.paise,
    eta_minutes: eta.minutes,
    eta_label: eta.label,
    stock_status: availability === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : (price.paise > 0 ? 'QUOTED' : 'OUT_OF_STOCK'),
    match_rule: line.buying_spec?.match_rule || line.match_rule || '',
    match_confidence: confidence,
    match_notes: `Live ${source.label} search: ${query}`,
    captured_at: new Date().toISOString(),
    expires_at: expiresAt,
    raw: {
      source: sourceKey,
      response_status: responseStatus,
      product_id: productIdFromProduct(product),
      price_field: price.field,
      availability,
      title,
      pack,
    },
  };
}

function hyperpureQuoteFromProduct(line, product, query, expiresAt, responseStatus) {
  return portalQuoteFromProduct(line, product, query, expiresAt, 'HYPERPURE', responseStatus);
}

async function hyperpureLiveQuote(line, env, expiresAt) {
  const session = await getPortalSessionSecret(env, 'HYPERPURE');
  if (!session) {
    return hyperpureErrorQuote(line, 'Hyperpure session is not in the vault. Capture Hyperpure again from Chrome.', expiresAt, { issue: 'NO_SESSION' });
  }
  const auth = hyperpureAuth(session);
  if (!auth.token || !auth.outletId) {
    return hyperpureErrorQuote(
      line,
      'Hyperpure needs recapture after reloading the Chrome extension; the old capture has cookie names but not token/outletId values.',
      expiresAt,
      { issue: 'RECAPTURE_REQUIRED', has_token: !!auth.token, has_outlet_id: !!auth.outletId }
    );
  }

  const query = quoteSearchQuery(line);
  const url = new URL('https://api.hyperpure.com/consumer/v2/search');
  url.searchParams.set('query', query);
  url.searchParams.set('outletId', auth.outletId);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('fetchThroughV2', 'true');
  url.searchParams.set('searchDebugFlag', 'false');

  let response;
  let data;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: hyperpureHeaders(auth),
    });
    const text = await response.text();
    data = safeJson(text, null);
    if (!data) {
      return hyperpureErrorQuote(line, `Hyperpure returned non-JSON response (${response.status})`, expiresAt, {
        status: response.status,
        body_preview: text.slice(0, 180),
      });
    }
  } catch (error) {
    return hyperpureErrorQuote(line, `Hyperpure live search failed: ${error.message || 'network error'}`, expiresAt, { issue: 'FETCH_FAILED' });
  }

  if (!response.ok) {
    return hyperpureErrorQuote(line, `Hyperpure API rejected live search (${response.status})`, expiresAt, {
      status: response.status,
      code: data?.code || data?.errorCode || data?.message || '',
    });
  }

  const products = extractProductsFromPayload(data)
    .map((product) => ({ product, title: titleFromProduct(product), price: priceFromProduct(product).paise, available: availabilityFromProduct(product) !== 'OUT_OF_STOCK' }))
    .filter((item) => item.title)
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      const scoreDiff = matchConfidence(query, b.title) - matchConfidence(query, a.title);
      if (scoreDiff) return scoreDiff;
      return (a.price || 999999999) - (b.price || 999999999);
    });

  const best = products.find((item) => item.price > 0 && item.available) || products.find((item) => item.price > 0) || products[0];
  if (!best) {
    return {
      stock_status: 'UNAVAILABLE',
      match_rule: line.buying_spec?.match_rule || line.match_rule || '',
      match_confidence: 0,
      match_notes: `Hyperpure returned no SKU for ${query}`,
      expires_at: expiresAt,
      raw: { source: 'HYPERPURE', response_status: response.status, product_count: 0 },
    };
  }

  return hyperpureQuoteFromProduct(line, best.product, query, expiresAt, response.status);
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

async function ensurePurchaseRunSchema(DB) {
  if (!DB) throw new Error('D1 database is not configured');

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_control_runs (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL,
      buyer_name TEXT,
      buyer_role TEXT,
      title TEXT,
      notes TEXT,
      cart_json TEXT NOT NULL DEFAULT '[]',
      items_json TEXT NOT NULL DEFAULT '[]',
      orders_json TEXT NOT NULL DEFAULT '[]',
      quote_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_control_run_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      item_id TEXT,
      product_code TEXT,
      name TEXT NOT NULL,
      category TEXT,
      uom TEXT,
      required_qty REAL DEFAULT 0,
      source_key TEXT,
      match_rule TEXT,
      buying_spec_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'NEEDED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_control_runs_updated
    ON purchase_control_runs(updated_at)
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_control_run_items_run
    ON purchase_control_run_items(run_id)
  `).run();

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_buying_specs (
      key TEXT PRIMARY KEY,
      product_code TEXT,
      item_id TEXT,
      approved_name TEXT NOT NULL,
      base_unit TEXT,
      match_rule TEXT NOT NULL DEFAULT 'EQUIVALENT_ALLOWED',
      preferred_pack TEXT,
      preferred_brand TEXT,
      notes TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_quote_batches (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_sources_json TEXT NOT NULL DEFAULT '[]',
      item_count INTEGER NOT NULL DEFAULT 0,
      quoted_count INTEGER NOT NULL DEFAULT 0,
      unavailable_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_quote_lines (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      cart_id TEXT,
      item_id TEXT,
      product_code TEXT,
      name TEXT NOT NULL,
      category TEXT,
      uom TEXT,
      required_qty REAL DEFAULT 0,
      source_key TEXT NOT NULL,
      source_label TEXT,
      sku_title TEXT,
      sku_url TEXT,
      pack_size TEXT,
      price_paise INTEGER NOT NULL DEFAULT 0,
      unit_price_paise INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      eta_minutes INTEGER DEFAULT 0,
      eta_label TEXT,
      stock_status TEXT NOT NULL DEFAULT 'PENDING_ADAPTER',
      match_rule TEXT,
      match_confidence INTEGER NOT NULL DEFAULT 0,
      match_notes TEXT,
      captured_at TEXT,
      expires_at TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_quote_batches_run
    ON purchase_quote_batches(run_id, updated_at)
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_purchase_quote_lines_batch
    ON purchase_quote_lines(batch_id, cart_id, source_key)
  `).run();

  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_portal_sessions (
      source_key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
      account_label TEXT,
      location_label TEXT,
      pincode TEXT,
      user_agent_hint TEXT,
      cookie_count INTEGER NOT NULL DEFAULT 0,
      token_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      last_captured_at TEXT,
      last_validated_at TEXT,
      issue_code TEXT,
      issue_detail TEXT,
      captured_by TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();
}

function publicRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    brand: row.brand,
    run_type: row.run_type,
    status: row.status,
    buyer_name: row.buyer_name,
    buyer_role: row.buyer_role,
    title: row.title,
    notes: row.notes || '',
    cart: safeJson(row.cart_json, []),
    items: safeJson(row.items_json, []),
    orders: safeJson(row.orders_json, []),
    quote_expires_at: row.quote_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicQuoteBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    run_id: row.run_id,
    brand: row.brand,
    status: row.status,
    requested_sources: safeJson(row.requested_sources_json, []),
    item_count: row.item_count || 0,
    quoted_count: row.quoted_count || 0,
    unavailable_count: row.unavailable_count || 0,
    error_count: row.error_count || 0,
    created_by: row.created_by,
    summary: safeJson(row.summary_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicQuoteLine(row) {
  if (!row) return null;
  return {
    id: row.id,
    batch_id: row.batch_id,
    run_id: row.run_id,
    cart_id: row.cart_id,
    item_id: row.item_id,
    product_code: row.product_code,
    name: row.name,
    category: row.category,
    uom: row.uom,
    required_qty: row.required_qty || 0,
    source_key: row.source_key,
    source_label: row.source_label || SOURCE_BY_KEY[row.source_key]?.label || row.source_key,
    sku_title: row.sku_title || '',
    sku_url: row.sku_url || '',
    pack_size: row.pack_size || '',
    price_paise: row.price_paise || 0,
    unit_price_paise: row.unit_price_paise || 0,
    currency: row.currency || 'INR',
    eta_minutes: row.eta_minutes || 0,
    eta_label: row.eta_label || '',
    stock_status: row.stock_status || 'PENDING_ADAPTER',
    match_rule: row.match_rule || '',
    match_confidence: row.match_confidence || 0,
    match_notes: row.match_notes || '',
    captured_at: row.captured_at || '',
    expires_at: row.expires_at || '',
    raw: safeJson(row.raw_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicPortalSession(row, source, hasSecret) {
  const storedStatus = cleanPortalSessionStatus(row?.status);
  const expired = row?.expires_at ? isPastIso(row.expires_at) : false;
  const status = !row || !hasSecret ? 'NOT_CONNECTED' : expired ? 'EXPIRED' : storedStatus;
  return {
    source_key: source.key,
    source_label: source.label,
    status,
    is_ready: status === 'READY',
    account_label: row?.account_label || '',
    location_label: row?.location_label || '',
    pincode: row?.pincode || '',
    user_agent_hint: row?.user_agent_hint || '',
    cookie_count: row?.cookie_count || 0,
    token_count: row?.token_count || 0,
    expires_at: row?.expires_at || '',
    last_captured_at: row?.last_captured_at || '',
    last_validated_at: row?.last_validated_at || '',
    issue_code: status === 'EXPIRED' ? 'EXPIRED' : row?.issue_code || (status === 'NOT_CONNECTED' ? 'NO_SESSION' : ''),
    issue_detail: status === 'EXPIRED'
      ? 'Saved portal session has expired'
      : row?.issue_detail || (status === 'NOT_CONNECTED' ? 'Reconnect this portal from Chrome capture' : ''),
    can_capture: true,
    url: source.url,
    updated_at: row?.updated_at || '',
  };
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

  if (action === 'list-runs') {
    return listRuns(url, user, env.DB);
  }

  if (action === 'run-detail') {
    return getRunDetail(url, user, env.DB);
  }

  if (action === 'quote-summary') {
    return getQuoteSummary(url, user, env.DB);
  }

  if (action === 'browser-quote-jobs') {
    return getBrowserQuoteJobs(url, user, env.DB);
  }

  if (action === 'portal-health') {
    return getPortalHealth(url, user, env);
  }

  if (action === 'materials') {
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

  return json({ error: `Unknown GET action: ${action}` }, 400);
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

  switch (action) {
    case 'create-run':
      return createRun(body, user, env.DB);
    case 'save-run':
      return saveRun(body, user, env.DB);
    case 'update-run-status':
      return updateRunStatus(body, user, env.DB);
    case 'request-quotes':
      return requestQuotes(body, user, env);
    case 'ingest-quotes':
      return ingestQuotes(body, user, env.DB);
    case 'ingest-browser-search-results':
      return ingestBrowserSearchResults(body, user, env.DB);
    case 'upsert-portal-session':
      return upsertPortalSession(body, user, env);
    case 'validate-portal-sessions':
      return validatePortalSessions(body, user, env);
    case 'create-local-po':
      return createLocalPO(body, user, env, context.env.DB);
    default:
      return json({ error: `Unknown POST action: ${action}` }, 400);
  }
}

async function listRuns(url, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const brand = cleanBrand(url.searchParams.get('brand') || 'BOTH');
  const limit = Math.max(1, Math.min(40, parseInt(url.searchParams.get('limit') || '12', 10)));
  const params = [];
  let where = '1 = 1';
  if (brand !== 'BOTH') {
    where += ' AND brand IN (?, ?)';
    params.push(brand, 'BOTH');
  }
  const rows = await DB.prepare(`
    SELECT * FROM purchase_control_runs
    WHERE ${where}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...params, limit).all();

  return json({
    success: true,
    runs: (rows.results || []).map(publicRun),
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function getRunDetail(url, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const runId = url.searchParams.get('run_id');
  if (!runId) return json({ error: 'Missing run_id' }, 400);
  const row = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!row) return json({ error: 'Run not found' }, 404);
  const items = await DB.prepare(`
    SELECT * FROM purchase_control_run_items
    WHERE run_id = ?
    ORDER BY created_at ASC
  `).bind(runId).all();
  const run = publicRun(row);
  run.item_rows = (items.results || []).map((item) => ({
    ...item,
    buying_spec: safeJson(item.buying_spec_json, {}),
  }));
  return json({
    success: true,
    run,
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function createRun(body, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const brand = cleanBrand(body.brand || 'HE');
  const runType = cleanRunType(body.run_type || 'MORNING_PURCHASE');
  const now = new Date().toISOString();
  const id = makeId('PCR');
  const title = body.title || `${brand} ${runType.replaceAll('_', ' ').toLowerCase()}`;

  await DB.prepare(`
    INSERT INTO purchase_control_runs
      (id, brand, run_type, status, buyer_name, buyer_role, title, notes,
       cart_json, items_json, orders_json, quote_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, brand, runType, 'DRAFT', user.name, user.role, title, body.notes || '',
    '[]', '[]', '[]', null, now, now
  ).run();

  const row = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(id).first();
  return json({ success: true, run: publicRun(row) });
}

async function saveRun(body, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const runId = body.run_id;
  if (!runId) return json({ error: 'Missing run_id' }, 400);

  const existing = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!existing) return json({ error: 'Run not found' }, 404);

  const cart = Array.isArray(body.cart) ? body.cart : [];
  const items = Array.isArray(body.items) ? body.items : cart;
  const status = cleanRunStatus(body.status || existing.status);
  const brand = cleanBrand(body.brand || existing.brand);
  const runType = cleanRunType(body.run_type || existing.run_type);
  const now = new Date().toISOString();
  const quoteExpiresAt = body.quote_expires_at || existing.quote_expires_at || null;

  await DB.prepare(`
    UPDATE purchase_control_runs
    SET brand = ?, run_type = ?, status = ?, title = ?, notes = ?,
        cart_json = ?, items_json = ?, quote_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    brand,
    runType,
    status,
    body.title || existing.title,
    body.notes ?? existing.notes ?? '',
    JSON.stringify(cart),
    JSON.stringify(items),
    quoteExpiresAt,
    now,
    runId
  ).run();

  await DB.prepare('DELETE FROM purchase_control_run_items WHERE run_id = ?').bind(runId).run();
  for (const item of items) {
    const spec = item.buying_spec || {};
    await DB.prepare(`
      INSERT INTO purchase_control_run_items
        (id, run_id, item_id, product_code, name, category, uom, required_qty,
         source_key, match_rule, buying_spec_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      makeId('PCRI'),
      runId,
      item.item_id || item.id || '',
      item.product_code || '',
      item.name || 'Raw material',
      item.category || '',
      item.uom || '',
      safeNumber(item.qty || item.required_qty),
      item.source_key || 'LOCAL_VENDOR',
      spec.match_rule || item.match_rule || 'EQUIVALENT_ALLOWED',
      JSON.stringify(spec),
      item.status || 'NEEDED',
      now,
      now
    ).run();
  }

  const row = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  return json({ success: true, run: publicRun(row) });
}

async function updateRunStatus(body, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const runId = body.run_id;
  const status = cleanRunStatus(body.status);
  if (!runId) return json({ error: 'Missing run_id' }, 400);
  const now = new Date().toISOString();
  await DB.prepare(`
    UPDATE purchase_control_runs
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, now, runId).run();
  const row = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!row) return json({ error: 'Run not found' }, 404);
  return json({
    success: true,
    run: publicRun(row),
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function getPortalHealthRows(env) {
  await ensurePurchaseRunSchema(env.DB);
  const rows = await env.DB.prepare('SELECT * FROM purchase_portal_sessions').all();
  const rowBySource = new Map((rows.results || []).map((row) => [row.source_key, row]));
  const sessions = [];
  for (const source of SOURCES.filter((item) => item.key !== 'LOCAL_VENDOR')) {
    let hasSecret = false;
    try {
      hasSecret = !!(env.SESSIONS && await env.SESSIONS.get(portalSessionKey(source.key)));
    } catch (_) {
      hasSecret = false;
    }
    let session = publicPortalSession(rowBySource.get(source.key), source, hasSecret);
    if (!env.SESSIONS) {
      session = {
        ...session,
        status: 'BROKEN',
        is_ready: false,
        issue_code: 'KV_NOT_CONFIGURED',
        issue_detail: 'SESSIONS KV binding is not configured',
      };
    }
    sessions.push(session);
  }
  return sessions;
}

async function getPortalHealth(url, user, env) {
  const sessions = await getPortalHealthRows(env);
  return json({
    success: true,
    sessions,
    ready_count: sessions.filter((session) => session.status === 'READY').length,
    action_required_count: sessions.filter((session) => session.status !== 'READY').length,
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function portalHealthMap(env) {
  const rows = await getPortalHealthRows(env);
  return new Map(rows.map((row) => [row.source_key, row]));
}

async function upsertPortalSession(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can update portal sessions' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  if (!env.SESSIONS) return json({ error: 'SESSIONS KV binding is not configured' }, 500);

  const sourceKey = cleanSourceKey(body.source_key);
  if (!PORTAL_SOURCE_KEYS.includes(sourceKey)) return json({ error: 'Choose one of the 8 portal sources' }, 400);

  const payload = body.session || body.payload || body.storage_state || null;
  const hasPayload = payload && typeof payload === 'object' && Object.keys(payload).length > 0;
  const expiresAt = body.expires_at || payload?.expires_at || payload?.expiry || '';
  const now = new Date().toISOString();
  const status = cleanPortalSessionStatus(body.status || (hasPayload ? (isPastIso(expiresAt) ? 'EXPIRED' : 'READY') : 'NOT_CONNECTED'));
  const kvValue = {
    source_key: sourceKey,
    captured_at: now,
    captured_by: user.name,
    account_label: body.account_label || '',
    location_label: body.location_label || '',
    pincode: body.pincode || '',
    user_agent: body.user_agent || payload?.user_agent || '',
    expires_at: expiresAt,
    payload,
  };

  if (hasPayload) {
    const ttl = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000) : 0;
    if (ttl > 60) {
      await env.SESSIONS.put(portalSessionKey(sourceKey), JSON.stringify(kvValue), { expirationTtl: ttl });
    } else {
      await env.SESSIONS.put(portalSessionKey(sourceKey), JSON.stringify(kvValue));
    }
  }

  await env.DB.prepare(`
    INSERT INTO purchase_portal_sessions
      (source_key, status, account_label, location_label, pincode, user_agent_hint,
       cookie_count, token_count, expires_at, last_captured_at, last_validated_at,
       issue_code, issue_detail, captured_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      status = excluded.status,
      account_label = excluded.account_label,
      location_label = excluded.location_label,
      pincode = excluded.pincode,
      user_agent_hint = excluded.user_agent_hint,
      cookie_count = excluded.cookie_count,
      token_count = excluded.token_count,
      expires_at = excluded.expires_at,
      last_captured_at = excluded.last_captured_at,
      last_validated_at = excluded.last_validated_at,
      issue_code = excluded.issue_code,
      issue_detail = excluded.issue_detail,
      captured_by = excluded.captured_by,
      updated_at = excluded.updated_at
  `).bind(
    sourceKey,
    status,
    body.account_label || '',
    body.location_label || '',
    body.pincode || '',
    browserHint(body.user_agent || payload?.user_agent),
    countCookies(payload),
    countTokens(payload),
    expiresAt || '',
    hasPayload ? now : body.last_captured_at || '',
    now,
    body.issue_code || '',
    body.issue_detail || '',
    user.name,
    now
  ).run();

  const sessions = await getPortalHealthRows(env);
  return json({
    success: true,
    session: sessions.find((session) => session.source_key === sourceKey),
    ready_count: sessions.filter((session) => session.status === 'READY').length,
    action_required_count: sessions.filter((session) => session.status !== 'READY').length,
  });
}

async function validatePortalSessions(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can validate portal sessions' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const sourceKeys = Array.isArray(body.sources) && body.sources.length
    ? body.sources.map(cleanSourceKey).filter((key) => PORTAL_SOURCE_KEYS.includes(key))
    : PORTAL_SOURCE_KEYS;
  const now = new Date().toISOString();
  const health = await getPortalHealthRows(env);
  const bySource = new Map(health.map((session) => [session.source_key, session]));

  for (const sourceKey of sourceKeys) {
    const session = bySource.get(sourceKey);
    if (!session) continue;
    await env.DB.prepare(`
      INSERT INTO purchase_portal_sessions
        (source_key, status, issue_code, issue_detail, last_validated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        status = excluded.status,
        issue_code = excluded.issue_code,
        issue_detail = excluded.issue_detail,
        last_validated_at = excluded.last_validated_at,
        updated_at = excluded.updated_at
    `).bind(
      sourceKey,
      session.status,
      session.issue_code || '',
      session.issue_detail || '',
      now,
      now
    ).run();
  }

  return getPortalHealth(new URL('https://internal.local/api/purchase-control?action=portal-health'), user, env);
}

async function latestQuoteBatch(DB, runId, batchId) {
  if (batchId) {
    return DB.prepare('SELECT * FROM purchase_quote_batches WHERE id = ? AND run_id = ?').bind(batchId, runId).first();
  }
  return DB.prepare(`
    SELECT * FROM purchase_quote_batches
    WHERE run_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(runId).first();
}

function summarizeQuotes(run, quotes) {
  const quoted = quotes.filter((quote) => quote.stock_status === 'QUOTED' && quote.unit_price_paise > 0);
  const pending = quotes.filter((quote) => quote.stock_status === 'PENDING_ADAPTER');
  const unavailable = quotes.filter((quote) => quote.stock_status === 'OUT_OF_STOCK' || quote.stock_status === 'UNAVAILABLE');
  const errors = quotes.filter((quote) => quote.stock_status === 'ERROR');
  const cart = Array.isArray(run.cart) ? run.cart : [];
  const byCart = cart.map((line) => {
    const lineQuotes = quotes.filter((quote) => quote.cart_id === line.cart_id);
    const valid = lineQuotes
      .filter((quote) => quote.stock_status === 'QUOTED' && quote.unit_price_paise > 0)
      .sort((a, b) => a.unit_price_paise - b.unit_price_paise);
    const fastest = lineQuotes
      .filter((quote) => quote.stock_status === 'QUOTED' && quote.eta_minutes > 0)
      .sort((a, b) => a.eta_minutes - b.eta_minutes)[0] || null;
    return {
      cart_id: line.cart_id,
      name: line.name,
      required_qty: line.qty || line.required_qty || 0,
      best_price: valid[0] || null,
      fastest,
      quote_count: lineQuotes.length,
      pending_count: lineQuotes.filter((quote) => quote.stock_status === 'PENDING_ADAPTER').length,
    };
  });
  const source_statuses = SOURCES.map((source) => {
    const sourceQuotes = quotes.filter((quote) => quote.source_key === source.key);
    return {
      key: source.key,
      label: source.label,
      quoted_count: sourceQuotes.filter((quote) => quote.stock_status === 'QUOTED').length,
      pending_count: sourceQuotes.filter((quote) => quote.stock_status === 'PENDING_ADAPTER').length,
      unavailable_count: sourceQuotes.filter((quote) => quote.stock_status === 'OUT_OF_STOCK' || quote.stock_status === 'UNAVAILABLE').length,
      error_count: sourceQuotes.filter((quote) => quote.stock_status === 'ERROR').length,
    };
  });
  return {
    cart_count: cart.length,
    quote_count: quotes.length,
    quoted_count: quoted.length,
    pending_count: pending.length,
    unavailable_count: unavailable.length,
    error_count: errors.length,
    comparable_line_count: byCart.filter((line) => line.best_price).length,
    by_cart: byCart,
    source_statuses,
  };
}

async function recomputeQuoteBatchCounts(DB, batchId, run) {
  const rows = await DB.prepare(`
    SELECT stock_status, COUNT(*) AS count
    FROM purchase_quote_lines
    WHERE batch_id = ?
    GROUP BY stock_status
  `).bind(batchId).all();
  const counts = Object.fromEntries((rows.results || []).map((row) => [row.stock_status, row.count || 0]));
  const pending = counts.PENDING_ADAPTER || 0;
  const summary = {
    quoted_count: counts.QUOTED || 0,
    pending_count: pending,
    unavailable_count: (counts.OUT_OF_STOCK || 0) + (counts.UNAVAILABLE || 0),
    error_count: counts.ERROR || 0,
  };
  const now = new Date().toISOString();
  const status = pending > 0 ? 'WAITING_FOR_ADAPTERS' : 'CAPTURED';
  await DB.prepare(`
    UPDATE purchase_quote_batches
    SET status = ?, quoted_count = ?, unavailable_count = ?, error_count = ?, summary_json = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    status,
    summary.quoted_count,
    summary.unavailable_count,
    summary.error_count,
    JSON.stringify({ ...summary, run_id: run.id }),
    now,
    batchId
  ).run();
}

async function getQuoteSummary(url, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const runId = url.searchParams.get('run_id');
  const batchId = url.searchParams.get('batch_id');
  if (!runId) return json({ error: 'Missing run_id' }, 400);

  const runRow = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!runRow) return json({ error: 'Run not found' }, 404);
  const run = publicRun(runRow);
  const batchRows = await DB.prepare(`
    SELECT * FROM purchase_quote_batches
    WHERE run_id = ?
    ORDER BY updated_at DESC
    LIMIT 8
  `).bind(runId).all();
  const batchRow = await latestQuoteBatch(DB, runId, batchId);
  const quoteRows = batchRow
    ? await DB.prepare(`
      SELECT * FROM purchase_quote_lines
      WHERE batch_id = ?
      ORDER BY name ASC, source_key ASC
    `).bind(batchRow.id).all()
    : { results: [] };
  const quotes = (quoteRows.results || []).map(publicQuoteLine);
  return json({
    success: true,
    run,
    batch: publicQuoteBatch(batchRow),
    batches: (batchRows.results || []).map(publicQuoteBatch),
    quotes,
    summary: summarizeQuotes(run, quotes),
    portal_sources: SOURCES.filter((source) => source.key !== 'LOCAL_VENDOR'),
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function getBrowserQuoteJobs(url, user, DB) {
  await ensurePurchaseRunSchema(DB);
  const sourceKey = cleanSourceKey(url.searchParams.get('source_key') || 'HYPERPURE');
  if (!PORTAL_SOURCE_KEYS.includes(sourceKey)) return json({ error: 'Choose one of the 8 portal sources' }, 400);

  const requestedRunId = url.searchParams.get('run_id') || '';
  const requestedBatchId = url.searchParams.get('batch_id') || '';
  let batchRow = null;
  if (requestedBatchId) {
    batchRow = await DB.prepare(`
      SELECT b.*, r.status AS run_status
      FROM purchase_quote_batches b
      JOIN purchase_control_runs r ON r.id = b.run_id
      WHERE b.id = ?
      LIMIT 1
    `).bind(requestedBatchId).first();
  } else if (requestedRunId) {
    batchRow = await DB.prepare(`
      SELECT b.*, r.status AS run_status
      FROM purchase_quote_batches b
      JOIN purchase_control_runs r ON r.id = b.run_id
      WHERE b.run_id = ?
      ORDER BY b.updated_at DESC
      LIMIT 1
    `).bind(requestedRunId).first();
  } else {
    batchRow = await DB.prepare(`
      SELECT b.*, r.status AS run_status
      FROM purchase_quote_batches b
      JOIN purchase_control_runs r ON r.id = b.run_id
      WHERE r.status NOT IN ('ORDERED', 'RECONCILED')
        AND EXISTS (
          SELECT 1 FROM purchase_quote_lines q
          WHERE q.batch_id = b.id
            AND q.source_key = ?
            AND q.stock_status IN ('PENDING_ADAPTER', 'ERROR')
        )
      ORDER BY b.updated_at DESC
      LIMIT 1
    `).bind(sourceKey).first();
  }

  if (!batchRow) {
    return json({
      success: true,
      source_key: sourceKey,
      batch: null,
      jobs: [],
      message: 'No browser quote jobs are waiting. Click Get quotes in the purchase console first.',
      user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
    });
  }

  const rows = await DB.prepare(`
    SELECT *
    FROM purchase_quote_lines
    WHERE batch_id = ?
      AND source_key = ?
      AND stock_status IN ('PENDING_ADAPTER', 'ERROR')
    ORDER BY name ASC
    LIMIT 40
  `).bind(batchRow.id, sourceKey).all();

  const jobs = (rows.results || []).map((row) => {
    const quote = publicQuoteLine(row);
    return {
      id: quote.id,
      batch_id: quote.batch_id,
      run_id: quote.run_id,
      cart_id: quote.cart_id,
      source_key: quote.source_key,
      name: quote.name,
      category: quote.category,
      uom: quote.uom,
      required_qty: quote.required_qty,
      product_code: quote.product_code,
      query: cleanText(quote.raw?.search_query || quote.name, 160),
      match_rule: quote.match_rule || '',
      previous_status: quote.stock_status,
      previous_note: quote.match_notes || '',
    };
  });

  return json({
    success: true,
    source_key: sourceKey,
    batch: publicQuoteBatch(batchRow),
    jobs,
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function insertQuoteLine(DB, batchId, runId, line, sourceKey, quote, now) {
  const source = SOURCE_BY_KEY[sourceKey] || { key: sourceKey, label: sourceKey };
  const pricePaise = Number.isInteger(quote.price_paise) ? quote.price_paise : paiseFrom(quote.price || quote.price_rupees);
  const unitPricePaise = Number.isInteger(quote.unit_price_paise)
    ? quote.unit_price_paise
    : paiseFrom(quote.unit_price || quote.unit_price_rupees) || pricePaise;
  const status = cleanQuoteStatus(quote.stock_status || (pricePaise > 0 ? 'QUOTED' : 'PENDING_ADAPTER'));
  const capturedAt = quote.captured_at || (status === 'PENDING_ADAPTER' ? '' : now);
  const id = quote.id || quoteLineId(batchId, sourceKey, line);

  await DB.prepare(`
    INSERT OR REPLACE INTO purchase_quote_lines
      (id, batch_id, run_id, cart_id, item_id, product_code, name, category, uom, required_qty,
       source_key, source_label, sku_title, sku_url, pack_size, price_paise, unit_price_paise, currency,
       eta_minutes, eta_label, stock_status, match_rule, match_confidence, match_notes, captured_at,
       expires_at, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    batchId,
    runId,
    line.cart_id || '',
    line.item_id || line.id || '',
    line.product_code || '',
    line.name || quote.name || 'Raw material',
    line.category || '',
    line.uom || '',
    safeNumber(line.qty || line.required_qty),
    source.key,
    quote.source_label || source.label,
    quote.sku_title || quote.title || '',
    quote.sku_url || quote.url || '',
    quote.pack_size || '',
    Math.max(0, pricePaise || 0),
    Math.max(0, unitPricePaise || 0),
    quote.currency || 'INR',
    Math.max(0, parseInt(quote.eta_minutes || 0, 10) || 0),
    quote.eta_label || '',
    status,
    quote.match_rule || line.buying_spec?.match_rule || line.match_rule || '',
    Math.max(0, Math.min(100, parseInt(quote.match_confidence || 0, 10) || 0)),
    quote.match_notes || '',
    capturedAt,
    quote.expires_at || '',
    JSON.stringify(quote.raw || quote),
    now,
    now
  ).run();
}

async function requestQuotes(body, user, env) {
  const DB = env.DB;
  await ensurePurchaseRunSchema(DB);
  const runId = body.run_id;
  if (!runId) return json({ error: 'Missing run_id' }, 400);
  const runRow = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!runRow) return json({ error: 'Run not found' }, 404);
  const run = publicRun(runRow);
  const cart = Array.isArray(run.cart) ? run.cart : [];
  if (!cart.length) return json({ error: 'Add items to the tray before requesting quotes' }, 400);

  const requestedPortals = Array.isArray(body.sources) && body.sources.length
    ? body.sources.map(cleanSourceKey).filter((key) => PORTAL_SOURCE_KEYS.includes(key))
    : PORTAL_SOURCE_KEYS;
  const sourceKeys = [...new Set([...(body.include_local === false ? [] : ['LOCAL_VENDOR']), ...requestedPortals])];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const batchId = makeId('PQB');
  const portalHealth = await portalHealthMap(env);

  await DB.prepare(`
    INSERT INTO purchase_quote_batches
      (id, run_id, brand, status, requested_sources_json, item_count, quoted_count,
       unavailable_count, error_count, created_by, summary_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    batchId,
    run.id,
    run.brand,
    'WAITING_FOR_ADAPTERS',
    JSON.stringify(sourceKeys),
    cart.length,
    0,
    0,
    0,
    user.name,
    '{}',
    now,
    now
  ).run();

  for (const line of cart) {
    for (const sourceKey of sourceKeys) {
      if (sourceKey === 'LOCAL_VENDOR') {
        const pricePaise = paiseFrom(line.price_unit);
        await insertQuoteLine(DB, batchId, run.id, line, sourceKey, {
          sku_title: line.vendor_name || 'Local vendor price',
          price_paise: pricePaise,
          unit_price_paise: pricePaise,
          eta_label: 'Vendor route',
          stock_status: pricePaise > 0 ? 'QUOTED' : 'UNAVAILABLE',
          match_confidence: pricePaise > 0 ? 100 : 0,
          match_notes: 'Last Odoo vendor price baseline',
          expires_at: expiresAt,
        }, now);
      } else {
        const health = portalHealth.get(sourceKey);
        const ready = health?.status === 'READY';
        await insertQuoteLine(DB, batchId, run.id, line, sourceKey, {
          stock_status: ready ? 'PENDING_ADAPTER' : 'UNAVAILABLE',
          match_rule: line.buying_spec?.match_rule || line.match_rule || '',
          match_notes: ready
            ? 'Session ready; awaiting live capture adapter'
            : `${health?.status || 'NOT_CONNECTED'}: ${health?.issue_detail || 'Reconnect portal session'}`,
          expires_at: expiresAt,
        }, now);
      }
    }
  }

  await recomputeQuoteBatchCounts(DB, batchId, run);
  await DB.prepare(`
    UPDATE purchase_control_runs
    SET status = ?, quote_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).bind('QUOTING', expiresAt, now, run.id).run();

  const fakeUrl = new URL(`https://internal.local/api/purchase-control?action=quote-summary&run_id=${encodeURIComponent(run.id)}&batch_id=${encodeURIComponent(batchId)}`);
  return getQuoteSummary(fakeUrl, user, DB);
}

async function ingestQuotes(body, user, DB) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can ingest quotes' }, 403);
  await ensurePurchaseRunSchema(DB);
  const runId = body.run_id;
  if (!runId) return json({ error: 'Missing run_id' }, 400);
  const batchRow = await latestQuoteBatch(DB, runId, body.batch_id);
  if (!batchRow) return json({ error: 'No quote batch found for this run' }, 404);
  const runRow = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(runId).first();
  if (!runRow) return json({ error: 'Run not found' }, 404);
  const run = publicRun(runRow);
  const cartById = new Map((run.cart || []).map((line) => [line.cart_id, line]));
  const quotes = Array.isArray(body.quotes) ? body.quotes : [];
  if (!quotes.length) return json({ error: 'No quotes supplied' }, 400);
  const now = new Date().toISOString();

  for (const quote of quotes) {
    const sourceKey = cleanSourceKey(quote.source_key);
    const line = cartById.get(quote.cart_id) || {
      cart_id: quote.cart_id || '',
      item_id: quote.item_id || '',
      product_code: quote.product_code || '',
      name: quote.name || quote.sku_title || 'Raw material',
      category: quote.category || '',
      uom: quote.uom || '',
      qty: quote.required_qty || 0,
      buying_spec: { match_rule: quote.match_rule || '' },
    };
    await insertQuoteLine(DB, batchRow.id, run.id, line, sourceKey, quote, now);
  }

  await recomputeQuoteBatchCounts(DB, batchRow.id, run);
  const fakeUrl = new URL(`https://internal.local/api/purchase-control?action=quote-summary&run_id=${encodeURIComponent(run.id)}&batch_id=${encodeURIComponent(batchRow.id)}`);
  return getQuoteSummary(fakeUrl, user, DB);
}

async function ingestBrowserSearchResults(body, user, DB) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can ingest browser quote results' }, 403);
  await ensurePurchaseRunSchema(DB);
  const sourceKey = cleanSourceKey(body.source_key || 'HYPERPURE');
  if (!PORTAL_SOURCE_KEYS.includes(sourceKey)) return json({ error: 'Choose one of the 8 portal sources' }, 400);
  const batchId = body.batch_id;
  const results = Array.isArray(body.results) ? body.results : [];
  if (!batchId) return json({ error: 'Missing batch_id' }, 400);
  if (!results.length) return json({ error: 'No browser results supplied' }, 400);

  const batchRow = await DB.prepare('SELECT * FROM purchase_quote_batches WHERE id = ?').bind(batchId).first();
  if (!batchRow) return json({ error: 'Quote batch not found' }, 404);
  const runRow = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(batchRow.run_id).first();
  if (!runRow) return json({ error: 'Run not found' }, 404);
  const run = publicRun(runRow);
  const expiresAt = run.quote_expires_at || new Date(Date.now() + 15 * 60000).toISOString();
  const now = new Date().toISOString();

  for (const result of results) {
    const cartId = String(result.cart_id || '').trim();
    if (!cartId) continue;
    const existing = await DB.prepare(`
      SELECT *
      FROM purchase_quote_lines
      WHERE batch_id = ? AND source_key = ? AND cart_id = ?
      LIMIT 1
    `).bind(batchId, sourceKey, cartId).first();
    if (!existing) continue;

    const line = {
      cart_id: existing.cart_id,
      item_id: existing.item_id,
      product_code: existing.product_code,
      name: existing.name,
      category: existing.category,
      uom: existing.uom,
      qty: existing.required_qty,
      required_qty: existing.required_qty,
      match_rule: existing.match_rule,
      buying_spec: {
        approved_name: cleanText(result.query || existing.name, 160),
        match_rule: existing.match_rule,
      },
    };

    const source = SOURCE_BY_KEY[sourceKey] || { label: sourceKey };
    const status = parseInt(result.status || 0, 10) || 0;
    let quote;
    if (result.error) {
      quote = portalErrorQuote(line, sourceKey, cleanText(result.error, 240), expiresAt, {
        source: sourceKey,
        browser_status: result.status || 0,
      });
    } else if (status && status >= 400) {
      quote = portalErrorQuote(line, sourceKey, `${source.label} browser search rejected (${status})`, expiresAt, {
        source: sourceKey,
        browser_status: status,
        body_preview: cleanText(result.body_preview || '', 180),
      });
    } else {
      const query = result.query || line.name;
      const products = extractProductsFromPayload(result.data)
        .map((product) => ({
          product,
          title: titleFromProduct(product),
          price: priceFromProduct(product).paise,
          available: availabilityFromProduct(product) !== 'OUT_OF_STOCK',
        }))
        .filter((item) => item.title)
        .sort((a, b) => {
          if (a.available !== b.available) return a.available ? -1 : 1;
          const scoreDiff = matchConfidence(query, b.title) - matchConfidence(query, a.title);
          if (scoreDiff) return scoreDiff;
          return (a.price || 999999999) - (b.price || 999999999);
        });
      const best = products.find((item) => item.price > 0 && item.available) || products.find((item) => item.price > 0) || products[0];
      quote = best
        ? portalQuoteFromProduct(line, best.product, query, expiresAt, sourceKey, status || 200)
        : {
          stock_status: 'UNAVAILABLE',
          match_rule: existing.match_rule || '',
          match_confidence: 0,
          match_notes: `${source.label} returned no SKU for ${query}`,
          expires_at: expiresAt,
          raw: { source: sourceKey, browser_status: status || 200, product_count: 0 },
        };
    }

    await insertQuoteLine(DB, batchId, run.id, line, sourceKey, quote, now);
  }

  await recomputeQuoteBatchCounts(DB, batchId, run);
  const fakeUrl = new URL(`https://internal.local/api/purchase-control?action=quote-summary&run_id=${encodeURIComponent(run.id)}&batch_id=${encodeURIComponent(batchId)}`);
  return getQuoteSummary(fakeUrl, user, DB);
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

    if (body.run_id) {
      try {
        await ensurePurchaseRunSchema(DB);
        const run = await DB.prepare('SELECT * FROM purchase_control_runs WHERE id = ?').bind(body.run_id).first();
        if (run) {
          const orders = safeJson(run.orders_json, []);
          orders.push({
            source_key: 'LOCAL_VENDOR',
            brand,
            po_id: created.id,
            po_name: created.name,
            amount_total: created.amount_total || 0,
            vendor: created.partner_id?.[1] || '',
            created_at: now,
          });
          await DB.prepare(`
            UPDATE purchase_control_runs
            SET orders_json = ?, status = ?, updated_at = ?
            WHERE id = ?
          `).bind(JSON.stringify(orders), 'ORDERED', now, body.run_id).run();
        }
      } catch (_) {
        // Run linking is non-blocking after the Odoo PO is created.
      }
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
