/* --------------------------------------------------------------------------
 * HN Hotels - Purchase Console API
 * Route: /api/purchase-console
 *
 * Purpose:
 * Turn raw material price intelligence into a daily purchase decision surface:
 * local vendor vs Hyperpure vs future quick-commerce adapters.
 *
 * This API intentionally does not replay partner/merchant browser APIs. The
 * Swiggy/Zomato frontend API method is treated as the connector pattern:
 * capture source data -> normalize -> compare -> pack a purchase cart.
 * -------------------------------------------------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const USERS = {
  '0305': { name: 'Nihaf', role: 'admin' },
  '5882': { name: 'Nihaf', role: 'admin' },
  '2026': { name: 'Zoya', role: 'purchase' },
  '8316': { name: 'Zoya', role: 'purchase' },
  '3678': { name: 'Faheem', role: 'settlement' },
  '6045': { name: 'Faheem', role: 'settlement' },
  '6890': { name: 'Tanveer', role: 'staff' },
  '7115': { name: 'Kesmat', role: 'staff' },
  '3946': { name: 'Jafar', role: 'staff' },
  '9991': { name: 'Mujib', role: 'staff' },
  '3697': { name: 'Yashwant', role: 'staff' },
  '3754': { name: 'Naveen', role: 'staff' },
  '8241': { name: 'Nafees', role: 'staff' },
  '8523': { name: 'Basheer', role: 'staff' },
  '4040': { name: 'Haneef', role: 'viewer' },
  '5050': { name: 'Nisar', role: 'viewer' },
};

const SOURCES = [
  {
    key: 'LOCAL_VENDOR',
    label: 'Local vendors',
    kind: 'odoo_po',
    status: 'live',
    authMode: 'Odoo purchase history',
    role: 'Baseline and fallback source',
  },
  {
    key: 'HYPERPURE',
    label: 'Zomato Hyperpure',
    kind: 'market_price',
    status: 'live',
    authMode: 'Price intelligence feed',
    role: 'Primary benchmark source',
  },
  {
    key: 'ZEPTO',
    label: 'Zepto',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Urgent fill-ins and same-day gaps',
  },
  {
    key: 'FLIPKART_MINUTES',
    label: 'Flipkart Minutes',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Urgent fill-ins and same-day gaps',
  },
  {
    key: 'INSTAMART',
    label: 'Instamart',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Urgent fill-ins and same-day gaps',
  },
  {
    key: 'BLINKIT',
    label: 'Blinkit',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Urgent fill-ins and same-day gaps',
  },
  {
    key: 'AMAZON_NOW',
    label: 'Amazon Now',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Urgent fill-ins and same-day gaps',
  },
  {
    key: 'BIGBASKET',
    label: 'BigBasket',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Staple comparison and backup',
  },
  {
    key: 'JIOMART',
    label: 'JioMart',
    kind: 'quick_commerce',
    status: 'planned',
    authMode: 'Frontend API capture',
    role: 'Staple comparison and backup',
  },
];

const SOURCE_PRICE_FIELDS = {
  HYPERPURE: 'price_hyperpure',
  ZEPTO: 'price_zepto',
  FLIPKART_MINUTES: 'price_flipkart_minutes',
  INSTAMART: 'price_instamart',
  BLINKIT: 'price_blinkit',
  AMAZON_NOW: 'price_amazon_now',
  BIGBASKET: 'price_bigbasket',
  JIOMART: 'price_jiomart',
};

const EXTERNAL_SOURCE_KEYS = Object.keys(SOURCE_PRICE_FIELDS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function auth(url) {
  const pin = url.searchParams.get('pin') || '';
  const user = USERS[pin];
  if (!user) return null;
  return user;
}

function cleanBrand(value) {
  if (value === 'HE' || value === 'NCH' || value === 'BOTH') return value;
  return 'BOTH';
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function paise(value) {
  const n = asNumber(value);
  if (n === null) return null;
  return Math.round(n * 100);
}

function rupeesFromPaise(value) {
  if (!Number.isFinite(value)) return null;
  return value / 100;
}

function daysOld(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function safePct(localPrice, marketPrice) {
  const local = asNumber(localPrice);
  const market = asNumber(marketPrice);
  if (!local || !market || local <= 0 || market <= 0) return null;
  return ((local - market) / local) * 100;
}

function formatPlatform(key) {
  if (!key) return null;
  const normalized = String(key).toUpperCase();
  if (normalized === 'HYPERPURE') return 'Hyperpure';
  if (normalized === 'BLINKIT') return 'Blinkit';
  if (normalized === 'ZEPTO') return 'Zepto';
  if (normalized === 'BIGBASKET') return 'BigBasket';
  if (normalized === 'FLIPKART_MINUTES') return 'Flipkart Minutes';
  if (normalized === 'INSTAMART') return 'Instamart';
  if (normalized === 'AMAZON_NOW') return 'Amazon Now';
  if (normalized === 'JIOMART') return 'JioMart';
  return normalized;
}

function addReason(reasons, condition, text) {
  if (condition) reasons.push(text);
}

function confidenceFor(row) {
  const reasons = [];
  const staleLocal = row.local_days_old !== null && row.local_days_old > 30;
  const staleMarket = row.market_days_old !== null && row.market_days_old > 10;
  const extremeSaving = row.savings_pct !== null && row.savings_pct > 75;
  const extremeLoss = row.savings_pct !== null && row.savings_pct < -75;
  const noLocal = !row.local_price;
  const noMarket = !row.cheapest_price;

  addReason(reasons, noLocal, 'Local vendor price missing');
  addReason(reasons, noMarket, 'No external market price');
  addReason(reasons, staleLocal, 'Local price is stale');
  addReason(reasons, staleMarket, 'Market price is stale');
  addReason(reasons, extremeSaving || extremeLoss, 'Possible unit or pack mismatch');

  if (extremeSaving || extremeLoss || (noLocal && noMarket)) {
    return { level: 'low', reasons };
  }
  if (staleLocal || staleMarket || noLocal || noMarket) {
    return { level: 'medium', reasons };
  }
  return { level: 'high', reasons };
}

function decisionFor(row, confidence) {
  if (confidence.level === 'low') {
    return {
      action: 'RECHECK',
      source_key: 'RECHECK',
      label: 'Recheck before ordering',
      priority: 3,
    };
  }
  if (!row.cheapest_price && row.local_price) {
    return {
      action: 'LOCAL',
      source_key: 'LOCAL_VENDOR',
      label: 'Buy from local vendor',
      priority: 2,
    };
  }
  if (!row.local_price && row.cheapest_price) {
    return {
      action: 'TRY_MARKET',
      source_key: row.cheapest_platform || 'HYPERPURE',
      label: `Try ${formatPlatform(row.cheapest_platform) || 'market source'}`,
      priority: 2,
    };
  }
  if (row.savings_pct !== null && row.savings_pct >= 12) {
    return {
      action: 'SWITCH',
      source_key: row.cheapest_platform || 'HYPERPURE',
      label: `Buy from ${formatPlatform(row.cheapest_platform) || 'market source'}`,
      priority: 1,
    };
  }
  if (row.savings_pct !== null && row.savings_pct >= 4) {
    return {
      action: 'WATCH',
      source_key: row.cheapest_platform || 'HYPERPURE',
      label: `Compare ${formatPlatform(row.cheapest_platform) || 'market source'}`,
      priority: 2,
    };
  }
  return {
    action: 'LOCAL',
    source_key: 'LOCAL_VENDOR',
    label: 'Keep local vendor',
    priority: 2,
  };
}

async function maybeAll(statement) {
  try {
    const result = await statement.all();
    return result.results || [];
  } catch (error) {
    return [];
  }
}

async function maybeFirst(statement) {
  try {
    return await statement.first();
  } catch (error) {
    return null;
  }
}

async function getMarketRows(DB, brand) {
  const whereBrand = brand === 'BOTH'
    ? ''
    : "WHERE p.brand IN (?, 'BOTH')";
  const stmt = DB.prepare(`
    SELECT
      ps.product_code,
      p.name,
      p.category,
      p.uom,
      p.brand,
      ps.current_price,
      ps.price_hyperpure,
      ps.price_blinkit,
      ps.price_zepto,
      NULL as price_flipkart_minutes,
      NULL as price_instamart,
      NULL as price_amazon_now,
      ps.price_bigbasket,
      NULL as price_jiomart,
      ps.cheapest_platform,
      ps.cheapest_price,
      ps.savings_pct,
      ps.updated_at
    FROM rm_price_summary ps
    LEFT JOIN rm_products p ON p.hn_code = ps.product_code
    ${whereBrand}
    ORDER BY
      CASE WHEN ps.savings_pct IS NULL THEN -999 ELSE ps.savings_pct END DESC,
      LOWER(COALESCE(p.name, ps.product_code))
  `);
  return brand === 'BOTH' ? maybeAll(stmt) : maybeAll(stmt.bind(brand));
}

async function getTrackedRows(DB, brand) {
  const whereBrand = brand === 'BOTH'
    ? 'WHERE t.is_active = 1'
    : "WHERE t.brand IN (?, 'BOTH') AND t.is_active = 1";
  const stmt = DB.prepare(`
    SELECT
      t.product_code,
      t.brand as tracked_brand,
      t.tier,
      p.name,
      p.category,
      p.uom,
      p.brand
    FROM rm_tracked_items t
    LEFT JOIN rm_products p ON p.hn_code = t.product_code
    ${whereBrand}
  `);
  return brand === 'BOTH' ? maybeAll(stmt) : maybeAll(stmt.bind(brand));
}

async function getLocalPriceRows(DB, brand) {
  const whereBrand = brand === 'BOTH'
    ? 'WHERE price > 0'
    : 'WHERE brand = ? AND price > 0';
  const stmt = DB.prepare(`
    SELECT product_code, brand, price, source, recorded_at
    FROM rm_daily_prices
    ${whereBrand}
    ORDER BY recorded_at DESC
  `);
  const rows = brand === 'BOTH' ? await maybeAll(stmt) : await maybeAll(stmt.bind(brand));
  const latest = new Map();
  rows.forEach((row) => {
    const key = `${row.product_code}:${brand === 'BOTH' ? row.brand : brand}`;
    if (!latest.has(key)) latest.set(key, row);
    if (brand === 'BOTH') {
      const anyBrandKey = `${row.product_code}:BOTH`;
      if (!latest.has(anyBrandKey)) latest.set(anyBrandKey, row);
    }
  });
  return latest;
}

async function getVendorRows(DB) {
  const rows = await maybeAll(DB.prepare(`
    SELECT
      vp.product_code,
      vp.vendor_key,
      vp.is_primary,
      vp.last_price,
      v.name as vendor_name,
      v.phone
    FROM rm_vendor_products vp
    LEFT JOIN rm_vendors v ON v.key = vp.vendor_key
    WHERE COALESCE(v.is_active, 1) = 1
    ORDER BY vp.is_primary DESC, LOWER(COALESCE(v.name, vp.vendor_key))
  `));
  const byProduct = new Map();
  rows.forEach((row) => {
    if (!byProduct.has(row.product_code)) byProduct.set(row.product_code, []);
    byProduct.get(row.product_code).push(row);
  });
  return byProduct;
}

async function getSourceCaptureRows(DB) {
  const rows = await maybeAll(DB.prepare(`
    SELECT source_key, status, last_run_at, last_success_at, last_error, notes
    FROM purchase_source_captures
  `));
  return Object.fromEntries(rows.map((row) => [row.source_key, row]));
}

function sourceCoverage(items, key) {
  const field = SOURCE_PRICE_FIELDS[key];
  if (!field) return null;
  const count = items.filter((item) => item[field] && item[field] > 0).length;
  return { count, total: items.length, pct: items.length ? Math.round((count / items.length) * 100) : 0 };
}

async function getSnapshotRows(DB) {
  const rows = await maybeAll(DB.prepare(`
    SELECT
      source_key,
      product_code,
      source_item_id,
      source_item_name,
      pack_label,
      normalized_price_paise,
      price_paise,
      confidence,
      captured_at
    FROM purchase_price_snapshots
    WHERE product_code IS NOT NULL
    ORDER BY captured_at DESC
  `));
  const latest = new Map();
  rows.forEach((row) => {
    const key = `${row.product_code}:${row.source_key}`;
    if (!latest.has(key)) latest.set(key, row);
  });
  return latest;
}

function applySnapshotPrices(item, snapshotRows) {
  EXTERNAL_SOURCE_KEYS.forEach((sourceKey) => {
    const snapshot = snapshotRows.get(`${item.product_code}:${sourceKey}`);
    if (!snapshot) return;
    const pricePaise = snapshot.normalized_price_paise || snapshot.price_paise;
    if (!pricePaise || pricePaise <= 0) return;
    const field = SOURCE_PRICE_FIELDS[sourceKey];
    item[field] = rupeesFromPaise(pricePaise);
    item[`${field}_captured_at`] = snapshot.captured_at || null;
    item[`${field}_confidence`] = snapshot.confidence || null;
  });
}

function recomputeCheapestMarket(item) {
  const candidates = EXTERNAL_SOURCE_KEYS
    .map((sourceKey) => ({
      sourceKey,
      price: asNumber(item[SOURCE_PRICE_FIELDS[sourceKey]]),
    }))
    .filter((candidate) => candidate.price && candidate.price > 0)
    .sort((a, b) => a.price - b.price);

  if (!candidates.length) {
    item.cheapest_platform = null;
    item.cheapest_price = null;
    item.cheapest_price_paise = null;
    item.savings_pct = null;
    return;
  }

  item.cheapest_platform = candidates[0].sourceKey;
  item.cheapest_price = candidates[0].price;
  item.cheapest_price_paise = paise(candidates[0].price);
  item.savings_pct = safePct(item.local_price, candidates[0].price);
}

function normalizeItem(row, localRows, vendorsByProduct, snapshotRows, brand) {
  const localKey = `${row.product_code}:${brand}`;
  const localFallbackKey = `${row.product_code}:BOTH`;
  const local = localRows.get(localKey) || localRows.get(localFallbackKey) || null;
  const vendors = vendorsByProduct.get(row.product_code) || [];
  const primaryVendor = vendors.find((vendor) => vendor.is_primary) || vendors[0] || null;
  const localPrice = local?.price || primaryVendor?.last_price || row.current_price || null;
  const marketPrice = row.cheapest_price || null;
  const savingsPct = row.savings_pct !== null && row.savings_pct !== undefined
    ? asNumber(row.savings_pct)
    : safePct(localPrice, marketPrice);
  const marketDaysOld = daysOld(row.updated_at);
  const localDaysOld = daysOld(local?.recorded_at);

  const item = {
    product_code: row.product_code,
    name: row.name || row.product_code,
    category: row.category || 'Unmapped',
    uom: row.uom || '',
    brand: row.brand || brand,
    local_price: asNumber(localPrice),
    local_price_paise: paise(localPrice),
    local_source: local?.source || null,
    local_recorded_at: local?.recorded_at || null,
    local_days_old: localDaysOld,
    vendor_key: primaryVendor?.vendor_key || null,
    vendor_name: primaryVendor?.vendor_name || primaryVendor?.vendor_key || null,
    vendor_count: vendors.length,
    price_hyperpure: asNumber(row.price_hyperpure),
    price_blinkit: asNumber(row.price_blinkit),
    price_zepto: asNumber(row.price_zepto),
    price_flipkart_minutes: asNumber(row.price_flipkart_minutes),
    price_instamart: asNumber(row.price_instamart),
    price_amazon_now: asNumber(row.price_amazon_now),
    price_bigbasket: asNumber(row.price_bigbasket),
    price_jiomart: asNumber(row.price_jiomart),
    cheapest_platform: row.cheapest_platform || null,
    cheapest_price: asNumber(marketPrice),
    cheapest_price_paise: paise(marketPrice),
    savings_pct: savingsPct,
    market_updated_at: row.updated_at || null,
    market_days_old: marketDaysOld,
  };

  applySnapshotPrices(item, snapshotRows);
  recomputeCheapestMarket(item);

  const confidence = confidenceFor(item);
  const decision = decisionFor(item, confidence);

  return {
    ...item,
    confidence: confidence.level,
    confidence_reasons: confidence.reasons,
    decision,
    sort_score: (decision.priority * 1000)
      - Math.max(-100, Math.min(100, item.savings_pct || 0)),
  };
}

function trackedOnlyItems(trackedRows, marketCodes, localRows, vendorsByProduct, snapshotRows, brand) {
  const out = [];
  trackedRows.forEach((row) => {
    if (marketCodes.has(row.product_code)) return;
    const local = localRows.get(`${row.product_code}:${brand}`) || localRows.get(`${row.product_code}:BOTH`);
    const vendors = vendorsByProduct.get(row.product_code) || [];
    const primaryVendor = vendors.find((vendor) => vendor.is_primary) || vendors[0] || null;
    const localPrice = local?.price || primaryVendor?.last_price || null;
    const base = normalizeItem({
      product_code: row.product_code,
      name: row.name,
      category: row.category,
      uom: row.uom,
      brand: row.brand,
      current_price: localPrice,
      cheapest_platform: null,
      cheapest_price: null,
      savings_pct: null,
      updated_at: null,
    }, localRows, vendorsByProduct, snapshotRows, brand);
    out.push({
      ...base,
      tracked_tier: row.tier,
      decision: localPrice
        ? { action: 'LOCAL', source_key: 'LOCAL_VENDOR', label: 'Buy from local vendor', priority: 2 }
        : { action: 'RECHECK', source_key: 'RECHECK', label: 'Add price before ordering', priority: 3 },
      sort_score: localPrice ? 2200 : 3300,
    });
  });
  return out;
}

function buildPacks(items) {
  const buckets = {
    HYPERPURE: {
      key: 'HYPERPURE',
      label: 'Hyperpure cart',
      intent: 'Items where the external price beats local enough to switch.',
      items: [],
    },
    QUICK_COMMERCE: {
      key: 'QUICK_COMMERCE',
      label: 'Quick commerce carts',
      intent: 'Urgent items to compare once Zepto, Flipkart Minutes, Instamart, Blinkit, Amazon Now, BigBasket, and JioMart adapters are wired.',
      items: [],
    },
    LOCAL_VENDOR: {
      key: 'LOCAL_VENDOR',
      label: 'Local vendor order',
      intent: 'Items where local price is best or market data is not ready.',
      items: [],
    },
    RECHECK: {
      key: 'RECHECK',
      label: 'Recheck before buying',
      intent: 'Unit mismatch, stale data, or missing price.',
      items: [],
    },
  };

  items.forEach((item) => {
    if (item.decision.action === 'RECHECK') {
      buckets.RECHECK.items.push(item);
      return;
    }
    if (item.decision.action === 'SWITCH' && item.decision.source_key === 'HYPERPURE') {
      buckets.HYPERPURE.items.push(item);
      return;
    }
    if (item.decision.action === 'SWITCH' || item.decision.action === 'TRY_MARKET' || item.decision.action === 'WATCH') {
      buckets.QUICK_COMMERCE.items.push(item);
      return;
    }
    buckets.LOCAL_VENDOR.items.push(item);
  });

  return Object.values(buckets).map((bucket) => {
    const possibleSaving = bucket.items.reduce((sum, item) => {
      if (!item.local_price || !item.cheapest_price || item.savings_pct === null || item.savings_pct <= 0) return sum;
      return sum + ((item.local_price - item.cheapest_price) * 100);
    }, 0);
    return {
      ...bucket,
      count: bucket.items.length,
      possible_saving_paise: Math.round(possibleSaving),
      top_items: bucket.items.slice(0, 12).map((item) => ({
        product_code: item.product_code,
        name: item.name,
        uom: item.uom,
        local_price: item.local_price,
        cheapest_price: item.cheapest_price,
        cheapest_platform: item.cheapest_platform,
        savings_pct: item.savings_pct,
        confidence: item.confidence,
        vendor_name: item.vendor_name,
      })),
    };
  });
}

function summarize(items) {
  const switchNow = items.filter((item) => item.decision.action === 'SWITCH').length;
  const recheck = items.filter((item) => item.decision.action === 'RECHECK').length;
  const localGaps = items.filter((item) => !item.local_price).length;
  const marketGaps = items.filter((item) => !item.cheapest_price).length;
  const highConfidence = items.filter((item) => item.confidence === 'high').length;
  const savingPaise = items.reduce((sum, item) => {
    if (item.decision.action !== 'SWITCH') return sum;
    if (!item.local_price || !item.cheapest_price) return sum;
    return sum + Math.max(0, Math.round((item.local_price - item.cheapest_price) * 100));
  }, 0);

  return {
    item_count: items.length,
    switch_now: switchNow,
    recheck_count: recheck,
    local_price_gaps: localGaps,
    market_price_gaps: marketGaps,
    high_confidence_count: highConfidence,
    possible_saving_paise: savingPaise,
    possible_saving_rupees: rupeesFromPaise(savingPaise),
  };
}

async function buildDashboard(DB, brand) {
  const [marketRows, trackedRows, localRows, vendorsByProduct, snapshotRows, captureRows] = await Promise.all([
    getMarketRows(DB, brand),
    getTrackedRows(DB, brand),
    getLocalPriceRows(DB, brand),
    getVendorRows(DB),
    getSnapshotRows(DB),
    getSourceCaptureRows(DB),
  ]);

  const marketCodes = new Set(marketRows.map((row) => row.product_code));
  const marketItems = marketRows.map((row) => normalizeItem(row, localRows, vendorsByProduct, snapshotRows, brand));
  const trackedItems = trackedOnlyItems(trackedRows, marketCodes, localRows, vendorsByProduct, snapshotRows, brand);
  const items = [...marketItems, ...trackedItems]
    .filter((item) => item.product_code)
    .sort((a, b) => a.sort_score - b.sort_score || a.name.localeCompare(b.name));

  const sources = SOURCES.map((source) => {
    const capture = captureRows[source.key] || {};
    return {
      ...source,
      status: capture.status || source.status,
      last_run_at: capture.last_run_at || null,
      last_success_at: capture.last_success_at || null,
      last_error: capture.last_error || null,
      notes: capture.notes || null,
      coverage: sourceCoverage(items, source.key),
    };
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    brand,
    summary: summarize(items),
    sources,
    packs: buildPacks(items),
    items,
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'dashboard';
  const user = auth(url);
  const DB = context.env.DB;

  if (!user) return json({ error: 'Invalid PIN' }, 401);
  if (!DB) return json({ error: 'D1 binding DB is missing' }, 500);

  try {
    if (context.request.method === 'GET') {
      if (action === 'verify-pin') return json({ ok: true, user });
      if (action === 'sources') {
        const captureRows = await getSourceCaptureRows(DB);
        return json({
          ok: true,
          sources: SOURCES.map((source) => ({ ...source, ...(captureRows[source.key] || {}) })),
        });
      }
      if (action === 'dashboard') {
        const brand = cleanBrand(url.searchParams.get('brand'));
        return json(await buildDashboard(DB, brand));
      }
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    if (context.request.method === 'POST') {
      const body = await context.request.json();
      if (body.action === 'record-source-status') {
        if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
        const sourceKey = String(body.source_key || '').toUpperCase();
        if (!SOURCES.some((source) => source.key === sourceKey)) {
          return json({ error: 'Unknown source_key' }, 400);
        }
        const now = new Date().toISOString();
        await DB.prepare(`
          INSERT INTO purchase_source_captures
            (source_key, source_label, status, last_run_at, last_success_at, last_error, notes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET
            status = excluded.status,
            last_run_at = excluded.last_run_at,
            last_success_at = excluded.last_success_at,
            last_error = excluded.last_error,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        `).bind(
          sourceKey,
          SOURCES.find((source) => source.key === sourceKey)?.label || sourceKey,
          body.status || 'planned',
          body.last_run_at || now,
          body.last_success_at || null,
          body.last_error || null,
          body.notes || null,
          now
        ).run();
        return json({ ok: true });
      }
      if (body.action === 'ingest-price-snapshots') {
        if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
        const sourceKey = String(body.source_key || '').toUpperCase();
        const source = SOURCES.find((row) => row.key === sourceKey);
        if (!source) return json({ error: 'Unknown source_key' }, 400);
        if (!Array.isArray(body.items) || body.items.length === 0) {
          return json({ error: 'items must be a non-empty array' }, 400);
        }

        const now = new Date().toISOString();
        const runResult = await DB.prepare(`
          INSERT INTO purchase_source_runs
            (source_key, run_kind, status, started_at, meta_json)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          sourceKey,
          body.run_kind || 'manual',
          'running',
          now,
          JSON.stringify({ imported_by: user.name, source_ref: body.source_ref || null })
        ).run();
        const runId = runResult?.meta?.last_row_id || null;

        let inserted = 0;
        for (const raw of body.items.slice(0, 1000)) {
          const pricePaise = Number.isFinite(Number(raw.price_paise))
            ? Math.round(Number(raw.price_paise))
            : paise(raw.price_rupees || raw.price);
          if (!pricePaise || pricePaise <= 0 || !raw.source_item_name) continue;
          const normalizedPricePaise = Number.isFinite(Number(raw.normalized_price_paise))
            ? Math.round(Number(raw.normalized_price_paise))
            : pricePaise;
          await DB.prepare(`
            INSERT INTO purchase_price_snapshots
              (source_key, product_code, source_item_id, source_item_name,
               pack_label, pack_qty, pack_uom, normalized_qty, normalized_uom,
               price_paise, normalized_price_paise, in_stock, confidence,
               captured_at, raw_ref)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            sourceKey,
            raw.product_code || null,
            raw.source_item_id || null,
            raw.source_item_name,
            raw.pack_label || null,
            asNumber(raw.pack_qty),
            raw.pack_uom || null,
            asNumber(raw.normalized_qty),
            raw.normalized_uom || null,
            pricePaise,
            normalizedPricePaise,
            raw.in_stock === false ? 0 : 1,
            raw.confidence || 'medium',
            raw.captured_at || now,
            raw.raw_ref || null
          ).run();
          inserted += 1;
        }

        await DB.prepare(`
          UPDATE purchase_source_runs
          SET status = ?, finished_at = ?, items_seen = ?, items_changed = ?
          WHERE id = ?
        `).bind('success', new Date().toISOString(), body.items.length, inserted, runId).run();

        await DB.prepare(`
          INSERT INTO purchase_source_captures
            (source_key, source_label, status, last_run_at, last_success_at, last_error, notes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET
            status = excluded.status,
            last_run_at = excluded.last_run_at,
            last_success_at = excluded.last_success_at,
            last_error = excluded.last_error,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        `).bind(
          sourceKey,
          source.label,
          'live',
          now,
          new Date().toISOString(),
          null,
          body.notes || null,
          new Date().toISOString()
        ).run();

        return json({ ok: true, source_key: sourceKey, inserted });
      }
      return json({ error: `Unknown POST action: ${body.action}` }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
