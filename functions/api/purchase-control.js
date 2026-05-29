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
  AMAZON_FRESH: 'https://www.amazon.in/',
  // Amazon Business — same `amazon.in` domain (NOT business.amazon.in).
  // Business context is established by the signed-in account, not the
  // URL. So iOS UL handoff is the same Amazon Shopping app; the owner
  // signs in with the HN HOTELS PVT LTD business account and sees B2B
  // prices + GST invoicing automatically.
  AMAZON_BUSINESS: 'https://www.amazon.in/b/',
  // Metro Cash & Carry — German-origin B2B wholesale, now Reliance-
  // owned (2023 acquisition). Pure B2B, GST-required, bulk packs.
  // Strong fit for HN's procurement. No AASA on metro.co.in (verified
  // 2026-05-29) so iOS handoff goes to Safari, not the Metro app — web
  // search is the fallback UX.
  METRO: 'https://www.metro.co.in/',
  // DMart Ready — Avenue Supermarts online ordering. Consumer-tier,
  // mostly regular packs, some larger value packs. dmart.in serves the
  // web ordering flow. No AASA either — Safari fallback.
  DMART: 'https://www.dmart.in/',
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
  // Amazon Fresh — same domain as Now, distinguished by the `i=amazonfresh`
  // store filter on search. Medium pack sizes, scheduled delivery — sits
  // between Q-commerce Now and bulk B2B (Amazon Business / IndiaMART).
  { key: 'AMAZON_FRESH', label: 'Amazon Fresh', status: 'assisted', mode: 'grocery', delivery_band: 'Same-day / scheduled', url: SOURCE_URLS.AMAZON_FRESH },
  // Amazon Business — quick-launch only (mode='b2b_directory'). No VPS
  // scout yet; owner taps the chip, signs in to Amazon Shopping app with
  // the HN business account, sees B2B prices + GST invoicing in the app.
  // Full scout queued for Phase B (needs business-account cookies).
  { key: 'AMAZON_BUSINESS', label: 'Amazon Business', status: 'launcher_only', mode: 'b2b_directory', delivery_band: 'B2B / GST invoice', url: SOURCE_URLS.AMAZON_BUSINESS },
  // Metro Cash & Carry — B2B-only quick-launch. Same shape as
  // Amazon Business (chip-only, eligibility-filtered, full scout
  // queued).
  { key: 'METRO', label: 'Metro', status: 'launcher_only', mode: 'b2b_directory', delivery_band: 'B2B wholesale / pickup', url: SOURCE_URLS.METRO },
  // DMart — consumer-tier quick-launch. Shows on every material
  // (not B2B-restricted). No AASA on dmart.in — Safari fallback.
  { key: 'DMART', label: 'DMart', status: 'launcher_only', mode: 'grocery', delivery_band: 'Pickup / same-day', url: SOURCE_URLS.DMART },
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

function imageUrlFromProduct(product) {
  const raw = cleanText(deepFieldValue(product, [
    'imageUrl',
    'image_url',
    'image',
    'image_url_string',
    'productImage',
    'product_image',
    'thumbnail',
    'thumbnailUrl',
    'thumbnail_url',
    'img',
    'src',
  ]), 520);
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
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

// Decode HTML entities once. Some adapters (notably Amazon) capture URLs from
// rendered HTML where `&` is already entity-encoded as `&amp;`. The UI then
// runs escapeAttr() on render which re-encodes to `&amp;amp;`, the browser
// decodes that to literal `amp;` and Amazon rejects the URL → Universal-Link
// handoff to the iOS app dies. Decode at the API boundary so the stored URL
// is canonical and round-trips cleanly through escapeAttr() exactly once.
function decodeHtmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Reject footer/help/nav anchors that adapters sometimes pick up as the
// "product URL" when the search-result card selector misses. Each portal has
// its own valid path prefixes.
// ============================================================
// B2B channel eligibility (Amazon Business, IndiaMART when wired)
// ============================================================
// B2B channels are vendor/bulk-pack platforms. Showing them for fresh
// produce, fresh chicken, fresh fish, eggs etc. is noise — those are
// APMC / daily-procure relationships, wrong channel entirely. Showing
// them for packaging, bulk dry goods, bulk dairy powders, bulk spices,
// bulk oils is where the B2B win is.
const B2B_ELIGIBLE_CATEGORIES = new Set([
  'Packaging & Disposables',
  'Dry Goods & Staples',
  'Spices & Seasoning',
  'Beverage Inputs',
  'Oils & Fats',
  'Lentils & Pulses',
  'Dry Fruits & Nuts',
  'Sauces & Condiments',
  'Cleaning & Non-Food',
  'Fuel & Production',
]);
// Eligible inside otherwise-mixed categories (Dairy, Bakery, Custom).
const B2B_ELIGIBLE_NAME_PATTERNS = [
  /\bmilkmaid\b/i, /\bcondensed\s*milk\b/i, /\bmilk\s*powder\b/i,
  /\bskimmed\s*milk\b/i, /\bghee\b/i, /\b(buffalo|cow)\s*milk\b/i,
  /\bbun(s)?\b/i, /\bpaav|pav|rumali\b/i, /\bosmania\b/i, /\bbiscuit\b/i,
  /\bpaneer\b/i,
];
// Always-block: wrong channel for B2B even if a category match would pass.
const B2B_BLOCK_NAME_PATTERNS = [
  /\b(fresh|raw)\b/i,
  /\bpalak|spinach|methi|coriander|kothimir|mint|pudina|curry\s*leaf\b/i,
  /\btomato|onion|potato|carrot|capsicum|chili|chilli|garlic|ginger|lemon\b/i,
  /\b(chicken|murgh|mutton|lamb|fish|egg|anda|prawn|seafood)\b/i,
];
function isB2BEligible(material) {
  const name = String(material?.name || '');
  if (B2B_BLOCK_NAME_PATTERNS.some((rx) => rx.test(name))) return false;
  const cat = String(material?.category || '');
  if (B2B_ELIGIBLE_CATEGORIES.has(cat)) return true;
  if (B2B_ELIGIBLE_NAME_PATTERNS.some((rx) => rx.test(name))) return true;
  return false;
}

const VALID_PRODUCT_PATH_PREFIXES = {
  HYPERPURE: ['/in/products/', '/products/', '/in/p/', '/in/category/'],
  BIGBASKET: ['/pd/', '/pc/', '/cl/'],
  BLINKIT: ['/prn/', '/cn/', '/s/'],
  ZEPTO: ['/pn/', '/cn/', '/p/'],
  FLIPKART_MINUTES: ['/p/', '/itm/'],
  // Amazon Now / Fresh URLs follow the same Amazon canonical
  // `<slug>/dp/<asin>` shape. Now-store products carry `almBrandId=ctnow`
  // in query, Fresh products use the Fresh tile flag — both are query
  // params that don't affect path-prefix matching. Path validates for
  // both stores.
  AMAZON_NOW: ['/dp/', '/gp/product/'],
  AMAZON_FRESH: ['/dp/', '/gp/product/'],
  // Amazon Business uses `amazon.in/b/` storefront paths + standard
  // `/dp/<asin>` product detail. Same domain, same validate-by-path.
  AMAZON_BUSINESS: ['/dp/', '/gp/product/', '/b/'],
  // Metro product page format unverified — leave permissive until a
  // scout adapter is built and live URLs flow through.
  METRO: ['/', '/products/', '/p/'],
  // DMart product page format also unverified — permissive.
  DMART: ['/', '/products/', '/p/'],
  JIOMART: ['/p/'],
  INSTAMART: ['/instamart/item/', '/instamart/'],
};

function isPlausibleProductUrl(url, sourceKey) {
  if (!url) return false;
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) return false;
  if (url.startsWith('#') || url.includes('#how-it-works') || url.includes('#footer')) return false;
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path === '/' || path === '') return false;
    if (/^\/(cart|login|signin|signup|help|about|contact|support|policy|terms|privacy)/i.test(path)) return false;
    const prefixes = VALID_PRODUCT_PATH_PREFIXES[sourceKey];
    if (prefixes) {
      // includes() not startsWith() — Amazon's canonical product URLs are
      // `/<seo-slug>/dp/<asin>` (slug precedes `/dp/`), and BB/FK wrap the
      // product id with a leading slug too. The earlier startsWith check
      // dropped every valid Amazon Now URL (128 of them) on 2026-05-29.
      return prefixes.some((p) => path.includes(p));
    }
    return true;
  } catch (_) {
    return false;
  }
}

function productUrlFromProduct(product, query, sourceKey = 'HYPERPURE') {
  const raw = decodeHtmlEntities(cleanText(deepFieldValue(product, ['productUrl', 'product_url', 'webUrl', 'web_url', 'url', 'deeplink']), 320));
  const source = SOURCE_BY_KEY[sourceKey] || SOURCE_BY_KEY.HYPERPURE;
  let candidate = '';
  if (raw.startsWith('https://') || raw.startsWith('http://')) {
    candidate = raw;
  } else if (raw.startsWith('/')) {
    try {
      candidate = new URL(raw, source?.url || 'https://www.hyperpure.com/').toString();
    } catch (_) {
      candidate = '';
    }
  }
  if (candidate && isPlausibleProductUrl(candidate, sourceKey)) return candidate;
  // No usable product URL — return empty so the UI falls back to the portal
  // search-URL builder (which guarantees a Universal-Link-compatible path).
  return '';
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

// Generic adjectives that should not contribute to match-confidence — they
// appear in both grocery commodity queries and unrelated processed-food SKUs.
// Root cause from 2026-05-28 run: "Fresh Coriander" matched "Fresh Noodles"
// because the only shared token between the query and the title was "Fresh".
// Strip these from match tokens so unrelated SKUs collapse to 25% confidence
// instead of 57% and get rejected by the SCOUT_CONFIDENCE_FLOOR.
const MATCH_STOPWORDS = new Set([
  'fresh', 'organic', 'premium', 'pure', 'natural', 'whole',
  'select', 'best', 'quality', 'farm', 'pack', 'packs',
  'new', 'big', 'small', 'mini', 'jumbo', 'value',
  'special', 'classic', 'original', 'choice', 'extra',
]);

function matchTokens(value) {
  return searchableTokens(value).filter((token) => !MATCH_STOPWORDS.has(token));
}

function matchConfidence(query, title) {
  const tokens = matchTokens(query);
  if (!tokens.length) {
    // Query was entirely stopwords (e.g. "Fresh Pack") — fall back to the
    // unfiltered tokens so we don't return 50 for everything.
    const fallback = searchableTokens(query);
    if (!fallback.length) return 50;
    const titleText = cleanText(title, 240).toLowerCase();
    if (!titleText) return 0;
    const hits = fallback.filter((token) => titleText.includes(token)).length;
    return hits ? Math.min(70, 40 + Math.round((hits / fallback.length) * 30)) : 25;
  }
  const titleText = cleanText(title, 240).toLowerCase();
  if (!titleText) return 0;
  const cleanQuery = cleanText(query, 240).toLowerCase();
  if (cleanQuery && titleText.includes(cleanQuery)) return 96;
  const hits = tokens.filter((token) => titleText.includes(token)).length;
  if (!hits) return 25;
  return Math.max(45, Math.min(92, Math.round(40 + (hits / tokens.length) * 52)));
}

// Fresh-commodity disqualifiers. Query-aware: if the user's query itself
// contains the banned token (e.g. "Coriander Powder"), it's not banned for
// that query.
const COMMODITY_BLOCK_TOKENS = [
  'powder', 'juice', 'sauce', 'puree', 'paste', 'concentrate',
  'cubes', 'seasoning', 'pickle', 'chutney', 'ketchup',
  'granules', 'sachet', 'syrup', 'dried', 'frozen',
  'roasted', 'fried', 'instant', 'ready',
  // Bakery / dessert / processed-snack tokens — added after Amazon Now's
  // "Carrot Walnut Cake" matched scout queries at conf 96. None of these
  // are valid fresh-commodity SKUs for a kitchen-restock context.
  'cake', 'cookies', 'cookie', 'muffin', 'biscuit', 'biscuits',
  'cracker', 'crackers', 'wafer', 'wafers', 'noodles', 'pasta',
  'soup', 'jam', 'jelly', 'spread',
];

function commodityBlockedTitle(query, title) {
  const titleText = cleanText(title, 240).toLowerCase();
  if (!titleText) return false;
  const queryText = cleanText(query, 240).toLowerCase();
  return COMMODITY_BLOCK_TOKENS.some((token) => {
    if (!titleText.includes(token)) return false;
    if (queryText.includes(token)) return false;
    return true;
  });
}

const SCOUT_CONFIDENCE_FLOOR = 55;
const EXACT_CONFIDENCE_FLOOR = 70;

function pickBestPortalProduct(products, query, matchRule) {
  const ranked = products
    .map((product) => {
      const title = titleFromProduct(product);
      return {
        product,
        title,
        price: priceFromProduct(product).paise,
        available: availabilityFromProduct(product) !== 'OUT_OF_STOCK',
        confidence: matchConfidence(query, title),
      };
    })
    .filter((item) => item.title);

  const rule = String(matchRule || '').toUpperCase();
  const isScout = rule === 'COMMODITY_EQUIVALENT';
  const isExact = rule === 'EXACT_ONLY';

  const filtered = ranked.filter((item) => {
    if (isScout && commodityBlockedTitle(query, item.title)) return false;
    if (isScout && item.confidence < SCOUT_CONFIDENCE_FLOOR) return false;
    if (isExact && item.confidence < EXACT_CONFIDENCE_FLOOR) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const confDiff = b.confidence - a.confidence;
    if (confDiff) return confDiff;
    return (a.price || 999999999) - (b.price || 999999999);
  });

  const best = filtered.find((item) => item.price > 0 && item.available)
    || filtered.find((item) => item.price > 0)
    || filtered[0]
    || null;

  return {
    best,
    rankedCount: ranked.length,
    filteredCount: filtered.length,
    droppedCount: ranked.length - filtered.length,
    isScout,
    isExact,
  };
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
      image_url: imageUrlFromProduct(product),
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

  const matchRule = line.buying_spec?.match_rule || line.match_rule || '';
  const pick = pickBestPortalProduct(extractProductsFromPayload(data), query, matchRule);
  if (!pick.best) {
    const reason = pick.rankedCount === 0
      ? `Hyperpure returned no SKU for ${query}`
      : pick.isScout
        ? `Hyperpure had ${pick.rankedCount} SKUs but ${pick.droppedCount} were processed forms or low-confidence — no fresh match for ${query}`
        : pick.isExact
          ? `Hyperpure had ${pick.rankedCount} SKUs but none matched the exact SKU for ${query} above the confidence floor`
          : `Hyperpure returned no usable SKU for ${query}`;
    return {
      stock_status: 'UNAVAILABLE',
      match_rule: matchRule,
      match_confidence: 0,
      match_notes: reason,
      expires_at: expiresAt,
      raw: {
        source: 'HYPERPURE',
        response_status: response.status,
        product_count: pick.rankedCount,
        dropped_count: pick.droppedCount,
      },
    };
  }

  return hyperpureQuoteFromProduct(line, pick.best.product, query, expiresAt, response.status);
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

  // ━━━ Daily price snapshot ledger (Phase X) ━━━━━━━━━━━━━━━━
  // One row per (date, material, portal). UPSERT pattern so the same day's
  // morning cron + any number of on-demand refreshes converge to a single row
  // per material × portal × day. Historical drift visible as a time-series.
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS daily_price_snapshots (
      snapshot_date    TEXT NOT NULL,
      material_id      TEXT NOT NULL,
      source_key       TEXT NOT NULL,
      category         TEXT,
      name             TEXT,
      uom              TEXT,
      brand            TEXT,
      sku_title        TEXT,
      sku_url          TEXT,
      pack_size        TEXT,
      price_paise      INTEGER NOT NULL DEFAULT 0,
      unit_price_paise INTEGER NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'INR',
      eta_minutes      INTEGER DEFAULT 0,
      eta_label        TEXT,
      stock_status     TEXT NOT NULL DEFAULT 'PENDING',
      match_rule       TEXT,
      match_confidence INTEGER NOT NULL DEFAULT 0,
      match_notes      TEXT,
      captured_at      TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'manual',
      batch_id         TEXT,
      raw_json         TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (snapshot_date, material_id, source_key)
    )
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date_category
    ON daily_price_snapshots(snapshot_date, category)
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_snapshots_material
    ON daily_price_snapshots(material_id, snapshot_date)
  `).run();

  // image_url added 2026-05-29 — idempotent ALTER.
  try { await DB.prepare(`ALTER TABLE daily_price_snapshots ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`).run(); } catch (_) {}

  // User-defined raw materials (not in Odoo PO history yet). Slug = stable id
  // used by refresh-material when prefixed with "custom:".
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS rm_custom_materials (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      uom         TEXT NOT NULL DEFAULT 'unit',
      brand       TEXT NOT NULL DEFAULT 'BOTH',
      image_url   TEXT NOT NULL DEFAULT '',
      created_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // ─── Vendor-direct workflow (added 2026-05-29) ───
  // Materials with established vendor relationships (chicken → MN
  // Broilers, buns → Ganga Bakery, buffalo milk → local dairy) bypass
  // the portal-scout flow. Instead, Sauda Plan tab groups these as
  // a "VENDOR DIRECT" tier with a "📲 Send via WhatsApp" button that
  // generates a templated message and opens wa.me/<phone>?text=<encoded>.
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_vendors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      whatsapp_phone  TEXT NOT NULL DEFAULT '',
      phone           TEXT NOT NULL DEFAULT '',
      email           TEXT NOT NULL DEFAULT '',
      brand           TEXT NOT NULL DEFAULT 'BOTH',
      outlet_label    TEXT NOT NULL DEFAULT 'Hamza Express',
      message_template TEXT NOT NULL DEFAULT '',
      notes           TEXT NOT NULL DEFAULT '',
      odoo_partner_id INTEGER,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_material_vendor_links (
      material_id   TEXT NOT NULL,
      vendor_id     INTEGER NOT NULL,
      is_primary    INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (material_id, vendor_id),
      FOREIGN KEY (vendor_id) REFERENCES purchase_vendors(id) ON DELETE CASCADE
    )
  `).run();
  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_pmvl_material
    ON purchase_material_vendor_links(material_id)
  `).run();

  // Meta-row per cron / refresh batch. portal_results_json holds per-source
  // counts so observability ('Hyperpure 28 ok / 2 err') is one query away.
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS daily_price_snapshot_batches (
      id                   TEXT PRIMARY KEY,
      batch_date           TEXT NOT NULL,
      batch_kind           TEXT NOT NULL,
      scope                TEXT,
      status               TEXT NOT NULL DEFAULT 'RUNNING',
      triggered_by         TEXT,
      material_count       INTEGER NOT NULL DEFAULT 0,
      ok_count             INTEGER NOT NULL DEFAULT 0,
      unavailable_count    INTEGER NOT NULL DEFAULT 0,
      error_count          INTEGER NOT NULL DEFAULT 0,
      portal_results_json  TEXT NOT NULL DEFAULT '{}',
      started_at           TEXT NOT NULL,
      completed_at         TEXT,
      notes                TEXT
    )
  `).run();

  await DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_batches_date_kind
    ON daily_price_snapshot_batches(batch_date, batch_kind)
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
    if (context.request.method === 'GET') return await handleGet(context.request, url, env);
    if (context.request.method === 'POST') return await handlePost(context, env);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message || 'Unknown error' }, 500);
  }
}

async function handleGet(request, url, env) {
  const action = url.searchParams.get('action') || 'materials';

  // Bearer-protected machine-to-machine actions bypass the PIN gate.
  if (action === 'portal-session-export') {
    const auth = (request?.headers?.get('authorization') || '').trim();
    if (!env.SCOUT_VPS_API_KEY || auth !== `Bearer ${env.SCOUT_VPS_API_KEY}`) {
      return json({ error: 'unauthorized' }, 401);
    }
    return handleSessionExport(url, env);
  }

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
    const days = Math.max(1, Math.min(1095, parseInt(url.searchParams.get('days') || '90', 10)));
    const creds = getOdooCredentials({ odoo: 'system' }, env);
    const data = await loadMaterialUniverse(creds, brand, days);
    // Layer in user-defined custom materials so the Sauda can show items the
    // owner hasn't purchased via Odoo yet (e.g. tonight's chicken-cut tracker).
    try {
      await ensurePurchaseRunSchema(env.DB);
      const customs = await env.DB.prepare(`
        SELECT slug, name, category, uom, brand, image_url, created_at FROM rm_custom_materials
        WHERE brand = 'BOTH' OR brand = ?
        ORDER BY category ASC, name ASC
      `).bind(brand === 'BOTH' ? 'BOTH' : brand).all();
      const extra = (customs.results || []).map((row) => ({
        id: `custom:${row.slug}`,
        product_code: `custom:${row.slug}`,
        item_id: `custom:${row.slug}`,
        name: row.name,
        search_query: row.name,
        category: row.category || 'Custom',
        uom: row.uom || 'unit',
        brands_seen: [row.brand || 'BOTH'],
        product_ids_by_brand: {},
        vendors: [],
        times_ordered: 0,
        total_qty: 0,
        known_amount: 0,
        lines_without_amount: 0,
        avg_unit_price: 0,
        local_price: 0,
        last_purchase_date: '',
        last_qty: 0,
        suggested_qty: 1,
        po_count: 0,
        raw_name_variants: [],
        priority_hint: 'Manual',
        source_keys: PORTAL_SOURCE_KEYS,
        preferred_source: 'LOCAL_VENDOR',
        last_vendor_id: null,
        last_vendor_name: '',
        confidence: 'manual',
        confidence_reasons: ['Owner-added custom material'],
        is_custom: true,
        image_url: row.image_url || '',
        created_at: row.created_at,
      }));
      if (extra.length) {
        // Avoid duplicates if a custom slug shadows an Odoo product_code.
        const known = new Set((data.items || []).map((it) => String(it.product_code || it.id || '')));
        for (const row of extra) {
          if (!known.has(row.product_code)) data.items.push(row);
        }
        // Re-derive category counts so the UI dropdown stays accurate.
        const seen = new Set();
        const cats = [];
        for (const it of data.items) {
          const c = it.category || 'Custom';
          if (!seen.has(c)) { seen.add(c); cats.push({ name: c, count: 0 }); }
          cats[cats.findIndex((x) => x.name === c)].count += 1;
        }
        data.categories = cats.sort((a, b) => a.name.localeCompare(b.name));
        data.summary = data.summary || {};
        data.summary.item_count = data.items.length;
        data.summary.category_count = data.categories.length;
        data.summary.custom_count = extra.length;
      }
    } catch (err) {
      // Schema/D1 hiccup — fall back to Odoo-only universe.
    }
    // Tag B2B eligibility so the UI knows whether to render Amazon
    // Business + IndiaMART chips. Eligibility ≠ live quote — it just
    // controls whether the chip exists for the material. A scout (when
    // wired) would populate actual prices on top.
    for (const item of (data.items || [])) {
      item.b2b_eligible = isB2BEligible(item);
    }
    // Tag vendor links so the UI knows which materials route to a
    // vendor-direct flow (chicken → MN Broilers) vs portal scouts.
    try {
      await ensurePurchaseRunSchema(env.DB);
      const vRows = await env.DB.prepare(`
        SELECT l.material_id, v.id AS vendor_id, v.slug, v.name, v.whatsapp_phone,
               v.phone, v.email, v.brand, v.outlet_label, v.message_template, l.is_primary
        FROM purchase_material_vendor_links l
        JOIN purchase_vendors v ON v.id = l.vendor_id
        ORDER BY l.is_primary DESC, v.name ASC
      `).all();
      const byMaterial = new Map();
      for (const r of (vRows.results || [])) {
        if (!byMaterial.has(r.material_id)) byMaterial.set(r.material_id, []);
        byMaterial.get(r.material_id).push({
          vendor_id: r.vendor_id, slug: r.slug, name: r.name,
          whatsapp_phone: r.whatsapp_phone, phone: r.phone,
          email: r.email, brand: r.brand, outlet_label: r.outlet_label,
          message_template: r.message_template,
          is_primary: !!r.is_primary,
        });
      }
      for (const item of (data.items || [])) {
        const code = String(item.product_code || item.id || '');
        const vendors = byMaterial.get(code) || [];
        item.vendor_links = vendors;
        item.primary_vendor = vendors.find((v) => v.is_primary) || vendors[0] || null;
      }
    } catch (_) {
      // schema/D1 hiccup — pass through without vendor tags
    }
    return json({
      success: true,
      ...data,
      user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
    });
  }

  if (action === 'daily-snapshot') {
    return getDailySnapshot(url, user, env);
  }

  // List configured vendors with material-count (used by /ops/purchase-
  // console/ to render the vendor-management settings section).
  if (action === 'list-vendors') {
    return listPurchaseVendors({}, user, env);
  }

  return json({ error: `Unknown GET action: ${action}` }, 400);
}

// ━━━ portal-session-export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bearer-protected machine-to-machine read of captured portal sessions.
// Called by the VPS scout service (Phase X.5) to inject logged-in cookies
// into Playwright before scouting. NOT gated by PIN — gated by
// env.SCOUT_VPS_API_KEY, which is set both here as a Pages secret and on
// the VPS .env as HN_API_KEY.
//
// GET  /api/purchase-control?action=portal-session-export
//   Authorization: Bearer ${SCOUT_VPS_API_KEY}
//   ?source_key=HYPERPURE             -> { source_key, ready, session }
//   ?source_key=ALL  (default)         -> { sources: { HYPERPURE: {...}, ... } }
//
// Never reads via PIN scope; never returns anything if the bearer is wrong.
// Response includes only what Playwright needs: cookies array, local_storage,
// session_storage, captured_url, user_agent. Drops admin/PII fields.

async function handleSessionExport(url, env) {
  if (!env.SCOUT_VPS_API_KEY) return json({ error: 'session export not configured' }, 503);
  if (!env.SESSIONS) return json({ error: 'SESSIONS KV not bound' }, 500);

  const requested = (url.searchParams.get('source_key') || 'ALL').toUpperCase();
  const targets = requested === 'ALL' ? PORTAL_SOURCE_KEYS : [requested];
  const out = {};
  for (const sourceKey of targets) {
    if (!PORTAL_SOURCE_KEYS.includes(sourceKey)) {
      out[sourceKey] = { ready: false, error: 'unknown source' };
      continue;
    }
    const raw = await env.SESSIONS.get(portalSessionKey(sourceKey));
    if (!raw) {
      out[sourceKey] = { ready: false, error: 'no session captured' };
      continue;
    }
    const session = safeJson(raw, null);
    if (!session || !session.payload) {
      out[sourceKey] = { ready: false, error: 'session payload missing' };
      continue;
    }
    const p = session.payload;
    out[sourceKey] = {
      ready: !!session.expires_at && !isPastIso(session.expires_at),
      captured_at: session.captured_at || '',
      expires_at: session.expires_at || '',
      captured_url: p.captured_url || '',
      user_agent: p.user_agent || session.user_agent || '',
      pincode: session.pincode || '',
      location_label: session.location_label || '',
      cookies: Array.isArray(p.cookies) ? p.cookies : [],
      local_storage: p.local_storage || {},
      session_storage: p.session_storage || {},
      visible_cookies: p.visible_cookies || {},
    };
  }
  if (requested !== 'ALL') {
    const single = out[requested];
    return json({ success: true, source_key: requested, ...single });
  }
  return json({ success: true, sources: out });
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
    case 'refresh-material':
      return refreshMaterialSnapshot(body, user, env);
    case 'add-custom-material':
      return addCustomMaterial(body, user, env);
    case 'delete-custom-material':
      return deleteCustomMaterial(body, user, env);
    // ─── Vendor-direct workflow ───
    case 'upsert-vendor':
      return upsertPurchaseVendor(body, user, env);
    case 'list-vendors':
      return listPurchaseVendors(body, user, env);
    case 'link-material-vendor':
      return linkMaterialVendor(body, user, env);
    case 'unlink-material-vendor':
      return unlinkMaterialVendor(body, user, env);
    case 'bulk-link-vendor':
      return bulkLinkMaterialsToVendor(body, user, env);
    case 'set-material-uom':
      return setMaterialUomInOdoo(body, user, env);
    default:
      return json({ error: `Unknown POST action: ${action}` }, 400);
  }
}

// ============================================================
// Set material UOM in Odoo (one-shot, multi-product)
// ============================================================
// Owner clarifies materials by HOW they think about them — Lemon in
// pieces, Coriander/Mint/Curry Leaves in bunch — even when portals sell
// by mass. Intelligence v4 cross-converts at compare time, but the
// material UOM should reflect business semantics in Odoo too.
//
// Body: { product_codes: ['HN-RM-066','HN-RM-067','HN-RM-016'],
//         uom_name: 'bunch' }
// Auto-creates the uom.uom record if missing.
async function setMaterialUomInOdoo(body, user, env) {
  if (!canCreate(user)) return json({ error: 'admin/purchase only' }, 403);
  const creds = getOdooCredentials({ odoo: 'system' }, env);
  if (!creds?.key) return json({ error: 'Odoo creds not configured' }, 500);
  const productCodes = Array.isArray(body.product_codes) ? body.product_codes : [];
  const uomName = String(body.uom_name || '').trim();
  if (!productCodes.length || !uomName) {
    return json({ error: 'product_codes[] and uom_name required' }, 400);
  }
  // Find UOM by name — Odoo 17 dropped category_id from uom.uom (moved
  // to a different model). Just look up by name and require the owner
  // to pre-create the UoM if missing.
  const uomRows = await odooCall(creds.uid, creds.key,
    'uom.uom', 'search_read',
    [[['name', '=ilike', uomName]]],
    { fields: ['id', 'name'], limit: 1 }
  );
  if (!uomRows.length) {
    return json({
      error: `UoM "${uomName}" not found in Odoo. Create it manually at odoo.hnhotels.in → Settings → Technical → Unit of Measures, then re-run. Or use an existing UoM name like "Units" or "Pack".`,
    }, 400);
  }
  const uomId = uomRows[0].id;
  // Look up product templates by default_code
  const products = await odooCall(creds.uid, creds.key,
    'product.template', 'search_read',
    [[['default_code', 'in', productCodes]]],
    { fields: ['id', 'name', 'default_code', 'uom_id'] }
  );
  const updated = [];
  for (const p of products) {
    await odooCall(creds.uid, creds.key,
      'product.template', 'write',
      [[p.id], { uom_id: uomId }],
      {}
    );
    updated.push({ id: p.id, code: p.default_code, name: p.name, old_uom: p.uom_id });
  }
  return json({ success: true, uom_id: uomId, uom_name: uomName, updated });
}

// ============================================================
// Vendor-direct workflow helpers
// ============================================================
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
function cleanPhone(s) {
  // Normalise to +91XXXXXXXXXX (digits only, leading +)
  const digits = String(s || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  // Strip leading 0 / 91 prefix duplication, then prefix +91 if 10-digit
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 13 && digits.startsWith('091')) return '+' + digits.slice(1);
  return '+' + digits;
}

async function upsertPurchaseVendor(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin/purchase PINs can manage vendors' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'name required' }, 400);
  const slug = body.slug ? slugify(body.slug) : slugify(name);
  const whatsapp_phone = cleanPhone(body.whatsapp_phone || body.phone || '');
  const phone = cleanPhone(body.phone || body.whatsapp_phone || '');
  const email = String(body.email || '').trim();
  const brand = cleanBrand(body.brand || 'BOTH');
  const outlet_label = String(body.outlet_label || 'Hamza Express').trim();
  // Default template uses placeholders: {date}, {outlet}, {items_list}
  const message_template = String(body.message_template || '').trim() ||
    'Date: {date}\nOutlet: {outlet}\nOrder:\n{items_list}\n\n— sent via BuyList';
  const notes = String(body.notes || '').trim();
  const odoo_partner_id = body.odoo_partner_id ? Number(body.odoo_partner_id) : null;
  const existing = await env.DB.prepare('SELECT id FROM purchase_vendors WHERE slug = ?').bind(slug).first();
  if (existing) {
    await env.DB.prepare(`
      UPDATE purchase_vendors
      SET name=?, whatsapp_phone=?, phone=?, email=?, brand=?, outlet_label=?,
          message_template=?, notes=?, odoo_partner_id=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(name, whatsapp_phone, phone, email, brand, outlet_label, message_template, notes, odoo_partner_id, existing.id).run();
    return json({ success: true, id: existing.id, slug, action: 'updated' });
  }
  const r = await env.DB.prepare(`
    INSERT INTO purchase_vendors
      (slug, name, whatsapp_phone, phone, email, brand, outlet_label, message_template, notes, odoo_partner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(slug, name, whatsapp_phone, phone, email, brand, outlet_label, message_template, notes, odoo_partner_id).run();
  return json({ success: true, id: r.meta?.last_row_id, slug, action: 'created' });
}

async function listPurchaseVendors(body, user, env) {
  await ensurePurchaseRunSchema(env.DB);
  const rows = await env.DB.prepare(`
    SELECT v.*, COUNT(DISTINCT l.material_id) AS material_count
    FROM purchase_vendors v
    LEFT JOIN purchase_material_vendor_links l ON l.vendor_id = v.id
    GROUP BY v.id
    ORDER BY v.name ASC
  `).all();
  return json({ success: true, vendors: rows.results || [] });
}

async function linkMaterialVendor(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin/purchase PINs can link vendors' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const material_id = String(body.material_id || '').trim();
  const vendor_id = Number(body.vendor_id || 0);
  if (!material_id || !vendor_id) return json({ error: 'material_id + vendor_id required' }, 400);
  const is_primary = body.is_primary === false ? 0 : 1;
  await env.DB.prepare(`
    INSERT INTO purchase_material_vendor_links (material_id, vendor_id, is_primary)
    VALUES (?, ?, ?)
    ON CONFLICT(material_id, vendor_id) DO UPDATE SET is_primary=excluded.is_primary
  `).bind(material_id, vendor_id, is_primary).run();
  return json({ success: true, material_id, vendor_id });
}

async function unlinkMaterialVendor(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin/purchase PINs can manage vendor links' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const material_id = String(body.material_id || '').trim();
  const vendor_id = Number(body.vendor_id || 0);
  if (!material_id || !vendor_id) return json({ error: 'material_id + vendor_id required' }, 400);
  await env.DB.prepare(`
    DELETE FROM purchase_material_vendor_links WHERE material_id=? AND vendor_id=?
  `).bind(material_id, vendor_id).run();
  return json({ success: true });
}

// Bulk-link many materials to one vendor — used to seed all chicken
// cuts → MN Broilers in one POST so the owner doesn't have to manage
// 7+ individual links by hand.
async function bulkLinkMaterialsToVendor(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin/purchase PINs can bulk-link' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const vendor_id = Number(body.vendor_id || 0);
  const material_ids = Array.isArray(body.material_ids) ? body.material_ids : [];
  if (!vendor_id || !material_ids.length) return json({ error: 'vendor_id + material_ids[] required' }, 400);
  const stmts = material_ids.map((mid) =>
    env.DB.prepare(`
      INSERT INTO purchase_material_vendor_links (material_id, vendor_id, is_primary)
      VALUES (?, ?, 1)
      ON CONFLICT(material_id, vendor_id) DO UPDATE SET is_primary=1
    `).bind(String(mid), vendor_id)
  );
  await env.DB.batch(stmts);
  return json({ success: true, vendor_id, linked_count: material_ids.length });
}

async function addCustomMaterial(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can add materials' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const uom = String(body.uom || 'unit').trim() || 'unit';
  const brand = cleanBrand(body.brand || 'BOTH');
  const image_url = String(body.image_url || '').trim();
  if (!name) return json({ error: 'name required' }, 400);
  if (!category) return json({ error: 'category required' }, 400);
  // Slug = stable, kebab-cased. Prefix with a 4-char nonce so two materials
  // with the same name don't collide.
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const nonce = Math.random().toString(36).slice(2, 6);
  const slug = `${base}-${nonce}`;
  await env.DB.prepare(`
    INSERT INTO rm_custom_materials (slug, name, category, uom, brand, image_url, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(slug, name, category, uom, brand, image_url, user.name || 'system').run();
  return json({
    success: true,
    material: {
      slug,
      material_id: `custom:${slug}`,
      product_code: `custom:${slug}`,
      name, category, uom, brand, image_url,
      is_custom: true,
    },
  });
}

async function deleteCustomMaterial(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can delete materials' }, 403);
  await ensurePurchaseRunSchema(env.DB);
  const slug = String(body.slug || '').trim() || String(body.material_id || '').replace(/^custom:/, '').trim();
  if (!slug) return json({ error: 'slug or material_id required' }, 400);
  const res = await env.DB.prepare(`DELETE FROM rm_custom_materials WHERE slug = ?`).bind(slug).run();
  return json({ success: true, deleted: res.meta?.changes || 0 });
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
      const matchRule = existing.match_rule || line.match_rule || '';
      const pick = pickBestPortalProduct(extractProductsFromPayload(result.data), query, matchRule);
      if (pick.best) {
        quote = portalQuoteFromProduct(line, pick.best.product, query, expiresAt, sourceKey, status || 200);
      } else {
        const reason = pick.rankedCount === 0
          ? `${source.label} returned no SKU for ${query}`
          : pick.isScout
            ? `${source.label} had ${pick.rankedCount} SKUs but ${pick.droppedCount} were processed forms or low-confidence — no fresh match for ${query}`
            : pick.isExact
              ? `${source.label} had ${pick.rankedCount} SKUs but none matched the exact SKU for ${query} above the confidence floor`
              : `${source.label} returned no usable SKU for ${query}`;
        quote = {
          stock_status: 'UNAVAILABLE',
          match_rule: matchRule,
          match_confidence: 0,
          match_notes: reason,
          expires_at: expiresAt,
          raw: {
            source: sourceKey,
            browser_status: status || 200,
            product_count: pick.rankedCount,
            dropped_count: pick.droppedCount,
          },
        };
      }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase X — Daily price snapshot ledger
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function istDateYmd(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

function materialIdFromRow(row) {
  if (!row) return '';
  if (row.product_code) return String(row.product_code);
  if (row.item_id) return String(row.item_id).replace(/^code:/, '');
  if (row.id) return String(row.id);
  return '';
}

// Portal scout dispatcher — fans out to the VPS scout service at
// SCOUT_VPS_URL one source per request, in parallel. The VPS runs real
// Playwright Chromium against logged-in portal sessions and returns
// normalized quotes. This replaces the per-portal inline adapters that
// were getting 475 from CF Worker IPs.

const VPS_PORTAL_TIMEOUT_MS = 22000;

async function callVpsScoutForSource(material, sourceKey, env) {
  if (!env.SCOUT_VPS_URL || !env.SCOUT_VPS_BEARER) {
    return { stock_status: 'ERROR', match_confidence: 0, match_notes: 'Scout VPS not configured (SCOUT_VPS_URL / SCOUT_VPS_BEARER missing)', raw: { source: sourceKey, stage: 'config' } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VPS_PORTAL_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.SCOUT_VPS_URL}/scout`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${env.SCOUT_VPS_BEARER}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        material_id: material.material_id,
        name: material.name,
        search_query: material.search_query || material.name,
        match_rule: material.match_rule || 'COMMODITY_EQUIVALENT',
        sources: [sourceKey],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { stock_status: 'ERROR', match_confidence: 0, match_notes: data.error || `VPS scout ${res.status}`, raw: { source: sourceKey, vps_status: res.status } };
    }
    const result = data.results?.[sourceKey];
    if (!result) {
      return { stock_status: 'ERROR', match_confidence: 0, match_notes: `VPS returned no result for ${sourceKey}`, raw: { source: sourceKey } };
    }
    // VPS quote shape already matches our adapter contract.
    return result;
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return {
      stock_status: 'ERROR',
      match_confidence: 0,
      match_notes: aborted ? `Scout VPS timeout after ${VPS_PORTAL_TIMEOUT_MS}ms` : `Scout VPS error: ${err.message}`,
      raw: { source: sourceKey, stage: 'vps_call', aborted },
    };
  } finally {
    clearTimeout(timer);
  }
}

// Which portals have an adapter wired on the VPS. Kept in sync with
// ADAPTERS in /home/hnscout/scout-service/src/portal-runner.js.
const VPS_WIRED_SOURCES = new Set(['HYPERPURE', 'BIGBASKET', 'JIOMART', 'BLINKIT', 'FLIPKART_MINUTES', 'AMAZON_NOW', 'ZEPTO']);

function adapterAvailable(sourceKey) {
  return VPS_WIRED_SOURCES.has(sourceKey);
}

async function upsertDailySnapshot(DB, row) {
  const now = new Date().toISOString();
  await DB.prepare(`
    INSERT INTO daily_price_snapshots
      (snapshot_date, material_id, source_key, category, name, uom, brand,
       sku_title, sku_url, pack_size, price_paise, unit_price_paise, currency,
       eta_minutes, eta_label, stock_status, match_rule, match_confidence,
       match_notes, captured_at, source, batch_id, raw_json, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date, material_id, source_key) DO UPDATE SET
      category         = excluded.category,
      name             = excluded.name,
      uom              = excluded.uom,
      brand            = excluded.brand,
      sku_title        = excluded.sku_title,
      sku_url          = excluded.sku_url,
      pack_size        = excluded.pack_size,
      price_paise      = excluded.price_paise,
      unit_price_paise = excluded.unit_price_paise,
      currency         = excluded.currency,
      eta_minutes      = excluded.eta_minutes,
      eta_label        = excluded.eta_label,
      stock_status     = excluded.stock_status,
      match_rule       = excluded.match_rule,
      match_confidence = excluded.match_confidence,
      match_notes      = excluded.match_notes,
      captured_at      = excluded.captured_at,
      source           = excluded.source,
      batch_id         = excluded.batch_id,
      raw_json         = excluded.raw_json,
      image_url        = excluded.image_url
  `).bind(
    row.snapshot_date,
    row.material_id,
    row.source_key,
    row.category || '',
    row.name || '',
    row.uom || '',
    row.brand || '',
    row.sku_title || '',
    row.sku_url || '',
    row.pack_size || '',
    Math.max(0, parseInt(row.price_paise || 0, 10) || 0),
    Math.max(0, parseInt(row.unit_price_paise || 0, 10) || 0),
    row.currency || 'INR',
    Math.max(0, parseInt(row.eta_minutes || 0, 10) || 0),
    row.eta_label || '',
    row.stock_status || 'PENDING',
    row.match_rule || '',
    Math.max(0, Math.min(100, parseInt(row.match_confidence || 0, 10) || 0)),
    row.match_notes || '',
    row.captured_at || now,
    row.source || 'manual',
    row.batch_id || null,
    JSON.stringify(row.raw || {}),
    String(row.image_url || row.raw?.image_url || '')
  ).run();
}

// ============================================================
// Sauda intelligence layer (added 2026-05-29)
// ============================================================
// Two systematic accuracy fixes applied at API-read time so historical
// daily_price_snapshots rows auto-correct without re-scouting:
//
// 1. PACK-SIZE NORMALIZATION
//    Scout adapters store the raw displayed price in `unit_price_paise`
//    even when the SKU is sold in a pack (`pack_size = "400 g"`,
//    "Pack of 4", "2 kg"). Result: Meatigo 400g pack at ₹239 reads as
//    ₹239/kg when it's actually ₹597/kg. Parse pack_size, divide raw
//    price by pack quantity expressed in the material's UOM.
//
// 2. CATEGORY MISMATCH REJECTION
//    Scout's keyword-overlap matcher matches "Catch Chicken Masala 100g"
//    to a "Shawarma Chicken" material because both contain "chicken".
//    Detect SKU category from sku_title keywords (masala / sauce /
//    snack / biscuit / pickle) and the material's expected category
//    from its name + Odoo category. If the SKU is the wrong category
//    for the material (e.g. material expects raw meat, SKU is a spice
//    mix), demote the row to stock_status='WRONG_CATEGORY' with
//    price=0 so it's excluded from cheapest-source picks.

// --- Pack-size parser ---
// Returns { qty, unit: 'kg'|'g'|'l'|'ml'|'unit' } or null.
function parsePackSize(s) {
  if (!s) return null;
  const txt = String(s).toLowerCase().trim();
  // "Pack of 4" → 4 units
  const packOf = txt.match(/pack\s*of\s*(\d+)/);
  if (packOf) return { qty: Number(packOf[1]), unit: 'unit' };
  // Mass: "400 g", "2.5 kg", "100gm"
  const mass = txt.match(/(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|g)\b/);
  if (mass) {
    const qty = Number(mass[1]);
    const u = mass[2];
    const unit = u.startsWith('kg') ? 'kg' : 'g';
    return { qty, unit };
  }
  // Volume: "1.5 l", "100 ml", "1ltr", "1 litre"
  const vol = txt.match(/(\d+(?:\.\d+)?)\s*(ltrs?|litres?|liters?|ml|l)\b/);
  if (vol) {
    const qty = Number(vol[1]);
    const u = vol[2];
    const unit = u === 'ml' ? 'ml' : 'l';
    return { qty, unit };
  }
  // Count: "4 pc", "12 pcs", "50 nos", "100 count"
  const pcs = txt.match(/(\d+)\s*(pcs?|pieces?|nos|units?|count|tablets?|caps?)\b/);
  if (pcs) return { qty: Number(pcs[1]), unit: 'unit' };
  return null;
}

// Convert pack quantity to material's UOM (kg / l / unit family). Returns
// the multiplier to divide the raw stored price by, or null if families
// don't align (e.g. material in kg but pack is ml — can't normalize).
// ============================================================
// Intelligence v4 — cross-family UOM conversion via mass-per-unit
// ============================================================
// Owner's core ask: "the portals present in their own UOMs; cracking the
// mapping to OUR material UOM is the intelligence." So we add typical
// piece-mass constants for common materials. With this, Hyperpure's
// "Lemon 500 gm pack" → 500g ÷ 70g/lemon = 7.14 lemons → ₹60 ÷ 7.14 ≈
// ₹8.40/Unit. Buns "Pack of 4" stays same-family (count→count). Veg in
// kg vs pack-of-N-pieces uses the constant in reverse: 6-pc capsicum
// pack ≈ 600g → ₹X ÷ 0.6kg/pack = ₹X/0.6 per kg.
//
// Constants are ROUGH industry typicals from Indian grocery norms. If a
// portal SKU title contains an explicit "/kg" or "/pc" ratio, the scout
// can capture it more precisely (future enhancement). Conservative bias
// — slightly under-estimate piece weight so per-Unit cost is slightly
// over-estimated (we lose cheapest battles by tiny margins, never call
// expensive SKUs cheaper than they are).
const MASS_PER_UNIT_G = {
  // ── Citrus / small fruit ──
  lemon: 70, nimbu: 70, lime: 50,
  // ── Veg per piece ──
  tomato: 80, tamatar: 80,
  onion: 150, pyaaz: 150, kanda: 150,
  potato: 200, aloo: 200, batata: 200,
  capsicum: 100, shimla: 100, 'shimla mirch': 100,
  cucumber: 200, kheera: 200,
  carrot: 100, gajar: 100,
  cabbage: 1000, pattagobi: 1000, 'patta gobi': 1000, // typically sold whole
  cauliflower: 800, gobi: 800, 'phool gobi': 800,
  brinjal: 120, baingan: 120, eggplant: 120,
  // ── Bunch items (count-family — each "bunch" is a count) ──
  coriander: 80, kothmir: 80, kothimir: 80, dhaniya: 80, 'fresh coriander': 80,
  mint: 50, pudina: 50, 'fresh mint': 50,
  spinach: 200, palak: 200,
  methi: 150, fenugreek: 150,
  'curry leaf': 30, 'curry leaves': 30, 'kadi patta': 30,
  // ── Animal protein per piece ──
  egg: 50, anda: 50,
  'chicken wing': 80,
  'chicken lollipop': 60,
  'chicken drumstick': 100, tangdi: 100,
  // ── Bakery per piece ──
  bun: 50, buns: 50, paav: 40, pav: 40, 'pav bun': 40, rumali: 30, 'rumali roti': 30,
  // ── Dairy per piece ──
  paneer: 200,    // standard supermarket block
  butter: 100,    // small block typical
};
function massPerUnitG(materialName) {
  const n = String(materialName || '').toLowerCase();
  // Prefer longer match (e.g. "fresh coriander" before "coriander")
  let best = null; let bestLen = 0;
  for (const [k, v] of Object.entries(MASS_PER_UNIT_G)) {
    if (n.includes(k) && k.length > bestLen) { best = v; bestLen = k.length; }
  }
  return best;
}
function detectFamily(unitLike) {
  const u = String(unitLike || '').toLowerCase();
  if (/(kg|gm?|gram)/i.test(u)) return 'mass';
  if (/(litre|liter|ml|^l$|\bl\b)/i.test(u)) return 'vol';
  if (/(unit|pc|pcs?|piece|nos|count|bunch)/i.test(u)) return 'count';
  return null;
}

// Returns { qty, normalized: bool, crossFamily: bool, note: string }
// where qty is the pack's quantity expressed in the MATERIAL's UOM.
// Returns null when conversion is impossible.
function packQtyInMaterialUom(packSizeStr, materialUom, materialName) {
  const pack = parsePackSize(packSizeStr);
  if (!pack || pack.qty <= 0) return null;
  const matFamily = detectFamily(materialUom);
  const packFamily = (pack.unit === 'kg' || pack.unit === 'g') ? 'mass'
                   : (pack.unit === 'l' || pack.unit === 'ml') ? 'vol'
                   : 'count';
  if (!matFamily) return null;

  // Same family — direct conversion (kg/g/l/ml/unit normalisation)
  if (matFamily === packFamily) {
    if (matFamily === 'mass') return pack.unit === 'g' ? pack.qty / 1000 : pack.qty;
    if (matFamily === 'vol')  return pack.unit === 'ml' ? pack.qty / 1000 : pack.qty;
    return pack.qty;
  }

  // Cross-family — use mass-per-unit constant if available
  const m = massPerUnitG(materialName);
  if (!m || m <= 0) return null;

  // Pack is mass, material is count → divide pack mass by mass-per-unit
  if (packFamily === 'mass' && matFamily === 'count') {
    const packMassG = pack.unit === 'kg' ? pack.qty * 1000 : pack.qty;
    return packMassG / m; // number of units in the pack
  }
  // Pack is count, material is mass → multiply pack count by mass-per-unit
  if (packFamily === 'count' && matFamily === 'mass') {
    const totalG = pack.qty * m;
    return totalG / 1000; // material is canonical kg
  }
  // Vol↔count not handled (rare for grocery)
  return null;
}

// Kept for backward compatibility — true ONLY when conversion is
// impossible (cross-family AND no mass-per-unit constant available).
function isUomFamilyMismatch(packSizeStr, materialUom, materialName) {
  if (!packSizeStr || !materialUom) return false;
  // If packQtyInMaterialUom can convert, it's not a mismatch
  return packQtyInMaterialUom(packSizeStr, materialUom, materialName) === null
    && parsePackSize(packSizeStr) !== null;
}

// --- SKU category detector ---
// Reads sku_title and classifies it into a coarse category. Helps reject
// "chicken masala" matching a "chicken" material.
function detectSkuCategory(skuTitle) {
  if (!skuTitle) return 'unknown';
  const t = String(skuTitle).toLowerCase();
  // INTELLIGENCE v2: expanded keyword set after live wrong-matches escaped
  // the v1 filter (Vim Dishwash Pudina, 7UP Lemon, Detoxie Capsicum Shampoo,
  // Sleepy Owl Coffee → Beans, MAI RASOI Coriander Seeds → Coriander Leaves).
  // Order matters — more-specific categories tested first.
  if (/\b(dishwash|dish wash|dish-wash|detergent|soap|shampoo|cleaner|sanitizer|bleach|wipes?|toilet|disinfectant|bathroom|floor cleaner|harpic|colin|vim|rin|surf|tide|ariel|dettol|lifebuoy|lizol|patanjali soap)\b/.test(t)) return 'cleaning';
  // Beverages — cola/soda/juice/tea-bag/coffee — wrong channel for fresh produce/dairy
  if (/\b(coffee|tea bag|tea bags|teabag|soda|cola|pepsi|coke|sprite|fanta|7up|mountain dew|fizz|carbonated|juice|drink|beverage|energy drink|red bull|sting|gatorade|tropicana|real juice|appy|maaza|frooti|slice|nestle pure life|kinley|bisleri|aquafina|himalayan)\b/.test(t)) return 'beverage';
  // Seeds explicitly — coriander/cumin/mustard SEEDS ≠ coriander/cumin LEAVES
  if (/\b(seeds?|sabut|whole|sabu[dt]|saunf|jeera whole|kala jeera|kalonji)\b/.test(t)) return 'seeds-whole-spice';
  if (/\b(masala|seasoning|spice mix|spice blend|curry mix|recipe mix|tadka|garam|sambar mix|chaat masala|pav bhaji masala|rasam powder)\b/.test(t)) return 'masala';
  if (/\b(marinade|sauce|paste|gravy mix|cooking sauce|tikka paste|kebab paste|shawarma paste|seekh paste|ketchup|mayo|mayonnaise|salsa)\b/.test(t)) return 'sauce-paste';
  if (/\b(pickle|chutney|achaar|achar|murabba)\b/.test(t)) return 'pickle-chutney';
  if (/\b(papad|namkeen|chips|wafer|bhujia|sev|mixture|farsan|snack|chivda|haldiram)\b/.test(t)) return 'snack';
  if (/\b(biscuit|cookie|cracker|rusks?|wafer|cake|brownie|muffin|parle|britannia|sunfeast)\b/.test(t)) return 'biscuit-bakery';
  if (/\b(ready to (eat|cook)|instant|mre|microwave meal|3 minute|mtr|gits|knorr)\b/.test(t)) return 'ready-meal';
  if (/\b(supplement|protein powder|whey|multivitamin|tablets?|capsules?|gummies|amway|herbalife|gnc|muscleblaze)\b/.test(t)) return 'supplement';
  // Cosmetics / personal-care safety net
  if (/\b(cream(?!.*(milk|dairy))|lotion|moisturizer|face wash|toothpaste|deodorant|perfume|fragrance|nivea|loreal|ponds|fair and lovely|himalaya wellness|nykaa|biotique)\b/.test(t)) return 'cosmetics';
  return 'unknown';
}

// --- Material expected category ---
// Reads the material name + Odoo category and infers what kind of SKU we
// expect to match against. Materials that ARE themselves a masala / paste
// pass through to the right category (so "Chicken Masala" material does
// NOT reject "MDH Chicken Masala" SKU).
function expectedSkuCategory(materialName, materialCategory) {
  const n = String(materialName || '').toLowerCase();
  const c = String(materialCategory || '').toLowerCase();
  // If the material itself is a masala/spice/powder, it expects masala SKUs
  if (/\b(masala|powder|seasoning|spice|tadka|garam)\b/.test(n)) return 'masala';
  if (/\b(marinade|paste|sauce|chutney|pickle|gravy)\b/.test(n)) return 'sauce-paste';
  if (/\b(biscuit|cookie|cake|rusk|muffin|brownie)\b/.test(n)) return 'biscuit-bakery';
  if (/\b(namkeen|chips|papad|snack|wafer|sev|bhujia)\b/.test(n)) return 'snack';
  // Raw meat materials (no masala/paste qualifier) expect raw meat SKUs
  if (/\b(chicken|murgh|mutton|lamb|goat|fish|prawn|seafood|brain|paya|kabab|tikka|tandoori|drumstick|wing|tangdi|lollipop|shawarma|shawarama|boneless|grill|kheema|keema)\b/.test(n)) return 'meat-raw';
  // Eggs — exclude egg-noodle / egg-biscuit mismatches
  if (/\begg|anda\b/.test(n)) return 'eggs';
  // Fresh produce
  if (/\b(palak|spinach|methi|coriander|kothmir|kothimir|dhaniya|mint|pudina|curry leaf|leaves|patta|bunch)\b/.test(n)) return 'fresh-produce';
  if (/^(tomato|onion|potato|aloo|carrot|cabbage|cauliflower|cucumber|capsicum|chilli|chili|lemon|ginger|garlic|cabbage|beans|peas|matar|brinjal|baingan|lauki|gobi|kheera|nimbu|adrak|lehsun|gajar|kanda)\b/.test(n)) return 'fresh-produce';
  // Dairy
  if (/\b(milk|paneer|cream|butter(?!.*paper)|cheese|ghee|curd|dahi|yogurt|condensed milk|milkmaid)\b/.test(n)) return 'dairy';
  // Default — unknown means don't reject
  return 'unknown';
}

// --- Mismatch decision ---
function isSkuCategoryMismatch(expectedCat, detectedCat) {
  if (expectedCat === 'unknown' || detectedCat === 'unknown') return false;
  if (expectedCat === detectedCat) return false;
  // Universal rejections — cleaning / beverage / cosmetics are NEVER a
  // valid match for any food material. Added in v2 after Vim Dishwash,
  // Detoxie Shampoo, 7UP, Sleepy Owl Coffee escaped v1.
  const ALWAYS_WRONG_FOR_FOOD = ['cleaning', 'cosmetics'];
  const FOOD_EXPECTED = ['meat-raw', 'fresh-produce', 'dairy', 'eggs', 'biscuit-bakery', 'snack', 'masala', 'sauce-paste', 'pickle-chutney', 'ready-meal'];
  if (FOOD_EXPECTED.includes(expectedCat) && ALWAYS_WRONG_FOR_FOOD.includes(detectedCat)) return true;
  // Raw meat material × spice/masala/sauce/snack SKU = wrong channel
  if (expectedCat === 'meat-raw' && ['masala', 'sauce-paste', 'snack', 'pickle-chutney', 'biscuit-bakery', 'ready-meal', 'supplement', 'seeds-whole-spice', 'beverage'].includes(detectedCat)) return true;
  // Fresh produce × packaged/processed (added beverage + seeds + sauce + ready-meal in v2)
  if (expectedCat === 'fresh-produce' && ['snack', 'biscuit-bakery', 'pickle-chutney', 'masala', 'supplement', 'beverage', 'seeds-whole-spice', 'sauce-paste', 'ready-meal'].includes(detectedCat)) return true;
  // Dairy × non-dairy packaged (added beverage)
  if (expectedCat === 'dairy' && ['masala', 'snack', 'biscuit-bakery', 'pickle-chutney', 'supplement', 'ready-meal', 'beverage', 'seeds-whole-spice'].includes(detectedCat)) return true;
  // Eggs × processed
  if (expectedCat === 'eggs' && ['snack', 'biscuit-bakery', 'masala', 'beverage'].includes(detectedCat)) return true;
  // Leaves vs seeds — if material is leaves-flavour fresh-produce (coriander
  // leaves, mint leaves), seeds SKUs are wrong even though category matches
  // "spice-ish". This is the Coriander Seeds → Coriander Leaves bug.
  // Handled implicitly above (fresh-produce rejects seeds-whole-spice).
  return false;
}

function publicSnapshotRow(row) {
  if (!row) return null;
  // Decode HTML entities in stored sku_url so the UI receives a canonical
  // URL. Some adapters (notably Amazon) wrote `&amp;` into the DB; without
  // decoding here the UI's escapeAttr() re-encodes to `&amp;amp;` and the
  // resulting href is broken. Re-validate against the per-portal prefix
  // allowlist so old garbage rows (mailto:, #how-it-works) get dropped.
  const decodedUrl = decodeHtmlEntities(row.sku_url || '');
  const cleanUrl = isPlausibleProductUrl(decodedUrl, row.source_key) ? decodedUrl : '';

  // ─── Intelligence layer ───
  // 1. Pack-size normalization (v4 — cross-family conversion via mass-per-unit)
  const rawPrice = row.unit_price_paise || row.price_paise || 0;
  const packMultiplier = packQtyInMaterialUom(row.pack_size, row.uom, row.name);
  const normalizedPrice = (packMultiplier && packMultiplier > 0)
    ? Math.round(rawPrice / packMultiplier)
    : rawPrice;
  const wasRepriced = packMultiplier && Math.abs(normalizedPrice - rawPrice) > 1;

  // 2. Category mismatch detection
  const expectedCat = expectedSkuCategory(row.name, row.category);
  const detectedCat = detectSkuCategory(row.sku_title);
  const isWrongCategory = isSkuCategoryMismatch(expectedCat, detectedCat);

  // 3. UOM family mismatch — only when conversion is truly impossible
  // (no mass-per-unit constant available for cross-family case).
  const uomMismatch = !isWrongCategory && isUomFamilyMismatch(row.pack_size, row.uom, row.name);

  // Apply: wrong rows get demoted, stock_status changes to flag
  const finalPrice = (isWrongCategory || uomMismatch) ? 0 : normalizedPrice;
  const finalStatus = isWrongCategory ? 'WRONG_CATEGORY'
                     : uomMismatch ? 'UOM_MISMATCH'
                     : (row.stock_status || 'PENDING');
  const noteParts = [];
  if (row.match_notes) noteParts.push(row.match_notes);
  if (wasRepriced) noteParts.push(`[pack-normalized ÷${packMultiplier.toFixed(3)} of ${row.uom}]`);
  if (isWrongCategory) noteParts.push(`[REJECTED] material expects ${expectedCat} but SKU is ${detectedCat}`);
  if (uomMismatch) noteParts.push(`[UOM_MISMATCH] material is "${row.uom}" but SKU pack is "${row.pack_size}" — can't normalize across UOM families`);

  return {
    snapshot_date: row.snapshot_date,
    material_id: row.material_id,
    source_key: row.source_key,
    source_label: SOURCE_BY_KEY[row.source_key]?.label || row.source_key,
    category: row.category || '',
    name: row.name || '',
    uom: row.uom || '',
    brand: row.brand || '',
    sku_title: row.sku_title || '',
    sku_url: cleanUrl,
    pack_size: row.pack_size || '',
    price_paise: finalPrice,
    unit_price_paise: finalPrice,
    currency: row.currency || 'INR',
    eta_minutes: row.eta_minutes || 0,
    eta_label: row.eta_label || '',
    stock_status: finalStatus,
    match_rule: row.match_rule || '',
    match_confidence: row.match_confidence || 0,
    match_notes: noteParts.join(' '),
    captured_at: row.captured_at || '',
    source: row.source || '',
    batch_id: row.batch_id || '',
    image_url: row.image_url || '',
  };
}

async function getDailySnapshot(url, user, env) {
  const DB = env.DB;
  await ensurePurchaseRunSchema(DB);
  const date = url.searchParams.get('date') || istDateYmd();
  const category = url.searchParams.get('category') || '';
  const materialId = url.searchParams.get('material_id') || '';
  const brand = cleanBrand(url.searchParams.get('brand') || 'BOTH');

  const where = ['snapshot_date = ?'];
  const bind = [date];
  if (category) { where.push('category = ?'); bind.push(category); }
  if (materialId) { where.push('material_id = ?'); bind.push(materialId); }
  if (brand !== 'BOTH') {
    where.push('(brand = ? OR brand = ? OR brand IS NULL OR brand = "")');
    bind.push(brand, 'BOTH');
  }

  const rows = await DB.prepare(`
    SELECT * FROM daily_price_snapshots
    WHERE ${where.join(' AND ')}
    ORDER BY material_id ASC, source_key ASC
  `).bind(...bind).all();

  const list = (rows.results || []).map(publicSnapshotRow);

  // Group by material so the UI can render one card per material with its
  // portal rows. Cheaper than the client doing it.
  const grouped = new Map();
  for (const row of list) {
    if (!grouped.has(row.material_id)) {
      grouped.set(row.material_id, {
        material_id: row.material_id,
        name: row.name,
        uom: row.uom,
        category: row.category,
        brand: row.brand,
        sources: [],
      });
    }
    grouped.get(row.material_id).sources.push(row);
  }

  return json({
    success: true,
    date,
    category,
    brand,
    material_count: grouped.size,
    row_count: list.length,
    materials: [...grouped.values()],
    user: { name: user.name, role: user.role, can_create_po: canCreate(user) },
  });
}

async function refreshMaterialSnapshot(body, user, env) {
  if (!canCreate(user)) return json({ error: 'Only admin or purchase PINs can trigger refresh' }, 403);
  const DB = env.DB;
  await ensurePurchaseRunSchema(DB);

  const rawMaterialId = String(body.material_id || '').trim();
  if (!rawMaterialId) return json({ error: 'Missing material_id' }, 400);
  const materialId = rawMaterialId.replace(/^code:/, '');

  // Custom materials (owner-added via add-custom-material): resolve from
  // rm_custom_materials in D1; no Odoo lookup needed.
  let material = null;
  if (materialId.startsWith('custom:')) {
    const slug = materialId.slice('custom:'.length);
    const row = await env.DB.prepare(`
      SELECT slug, name, category, uom, brand, image_url FROM rm_custom_materials WHERE slug = ?
    `).bind(slug).first();
    if (!row) return json({ error: `Custom material ${slug} not found` }, 404);
    material = {
      product_code: materialId,
      item_id: materialId,
      name: row.name,
      category: row.category || 'Custom',
      uom: row.uom || 'unit',
      brand: row.brand || 'BOTH',
      match_rule: 'COMMODITY_EQUIVALENT',
    };
  } else {
    // Resolve material context from the Odoo-backed material universe so we have
    // category, uom, and brand even on a cold refresh.
    const creds = getOdooCredentials({ odoo: 'system' }, env);
    const universe = await loadMaterialUniverse(creds, 'BOTH', 365);
    material = (universe.items || []).find((item) => {
      const code = (item.product_code || '').toString();
      if (code === materialId) return true;
      if ((item.item_id || '').toString().replace(/^code:/, '') === materialId) return true;
      return String(item.id || '') === materialId;
    });
    // Fallback: caller can pass name + category in body for an ad-hoc rescout
    // (used by the custom-SKU search panel and any UI that wants to scout an
    // arbitrary string against the VPS).
    if (!material && body.name) {
      material = {
        product_code: materialId,
        item_id: materialId,
        name: String(body.name).trim(),
        category: String(body.category || 'Custom').trim(),
        uom: String(body.uom || 'unit').trim(),
        brand: cleanBrand(body.brand || 'BOTH'),
        match_rule: 'COMMODITY_EQUIVALENT',
      };
    }
    if (!material) return json({ error: `Material ${materialId} not found in last 365d Odoo universe` }, 404);
  }

  const requestedSources = Array.isArray(body.sources) && body.sources.length
    ? body.sources.map(cleanSourceKey).filter((s) => PORTAL_SOURCE_KEYS.includes(s))
    : PORTAL_SOURCE_KEYS;

  const snapshotDate = istDateYmd();
  const batchId = makeId('PSR');
  const startedAt = new Date().toISOString();

  await DB.prepare(`
    INSERT INTO daily_price_snapshot_batches
      (id, batch_date, batch_kind, scope, status, triggered_by,
       material_count, started_at, portal_results_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    batchId, snapshotDate, 'refresh', materialId, 'RUNNING',
    `manual:${user.name}`, 1, startedAt, '{}'
  ).run();

  const materialContext = {
    material_id: material.product_code || materialId,
    item_id: material.item_id || `code:${material.product_code || materialId}`,
    name: material.name,
    category: material.category || '',
    uom: material.uom || '',
    brand: material.brand || '',
    required_qty: 0,
    search_query: material.name,
    match_rule: material.match_rule || 'COMMODITY_EQUIVALENT',
    product_code: material.product_code || materialId,
  };

  const perPortal = {};
  let ok = 0;
  let unavailable = 0;
  let errors = 0;

  // Fan-out: one VPS request per source in parallel. Each VPS call takes
  // ~6-10s, all complete within ~10s wall-clock. Keeps the API endpoint
  // under the 30s Cloudflare Pages Functions wall-clock budget.
  const sourceQuotes = await Promise.all(
    requestedSources.map(async (sourceKey) => {
      if (!adapterAvailable(sourceKey)) {
        return [sourceKey, { stock_status: 'NO_ADAPTER', match_confidence: 0, match_notes: `No VPS adapter wired for ${sourceKey}`, raw: { source: sourceKey } }];
      }
      const quote = await callVpsScoutForSource(materialContext, sourceKey, env);
      return [sourceKey, quote];
    })
  );

  for (const [sourceKey, quote] of sourceQuotes) {
    const status = String(quote.stock_status || '').toUpperCase();
    const isQuoted = status === 'QUOTED' && (quote.price_paise || 0) > 0;
    const isError = status === 'ERROR';
    const isNoAdapter = status === 'NO_ADAPTER';
    if (isQuoted) ok += 1;
    else if (isError) errors += 1;
    else if (!isNoAdapter) unavailable += 1;

    if (!isNoAdapter) {
      await upsertDailySnapshot(DB, {
        snapshot_date: snapshotDate,
        material_id: materialContext.material_id,
        source_key: sourceKey,
        category: materialContext.category,
        name: materialContext.name,
        uom: materialContext.uom,
        brand: materialContext.brand,
        sku_title: quote.sku_title || '',
        sku_url: quote.sku_url || '',
        pack_size: quote.pack_size || '',
        price_paise: quote.price_paise || 0,
        unit_price_paise: quote.unit_price_paise || quote.price_paise || 0,
        currency: quote.currency || 'INR',
        eta_minutes: quote.eta_minutes || 0,
        eta_label: quote.eta_label || '',
        stock_status: status || 'UNAVAILABLE',
        match_rule: quote.match_rule || materialContext.match_rule,
        match_confidence: quote.match_confidence || 0,
        match_notes: quote.match_notes || '',
        captured_at: quote.captured_at || new Date().toISOString(),
        source: 'on_demand_refresh',
        batch_id: batchId,
        raw: quote.raw || {},
        image_url: quote.image_url || quote.raw?.image_url || '',
      });
    }

    perPortal[sourceKey] = isNoAdapter
      ? { state: 'no_adapter' }
      : {
          state: isQuoted ? 'ok' : isError ? 'error' : 'unavailable',
          price_paise: quote.price_paise || 0,
          sku_title: quote.sku_title || '',
          match_confidence: quote.match_confidence || 0,
          notes: quote.match_notes || '',
        };
  }

  const completedAt = new Date().toISOString();
  await DB.prepare(`
    UPDATE daily_price_snapshot_batches
    SET status = ?, ok_count = ?, unavailable_count = ?, error_count = ?,
        portal_results_json = ?, completed_at = ?
    WHERE id = ?
  `).bind(
    errors === requestedSources.length ? 'FAILED' : (ok ? 'COMPLETED' : 'PARTIAL'),
    ok, unavailable, errors,
    JSON.stringify(perPortal), completedAt, batchId
  ).run();

  // Return the refreshed snapshot for this material so the caller can render
  // immediately without a second round-trip.
  const after = await DB.prepare(`
    SELECT * FROM daily_price_snapshots
    WHERE snapshot_date = ? AND material_id = ?
    ORDER BY source_key ASC
  `).bind(snapshotDate, materialContext.material_id).all();

  return json({
    success: true,
    batch_id: batchId,
    snapshot_date: snapshotDate,
    material_id: materialContext.material_id,
    material_name: materialContext.name,
    counts: { ok, unavailable, error: errors, requested: requestedSources.length },
    portal_results: perPortal,
    snapshot: (after.results || []).map(publicSnapshotRow),
  });
}
