// aggregator-pulse.js v6.0 FINAL — Orders + Metrics API for HN aggregator pipeline
// Changes vs v3:
//   - classifyUrl now extracts Zomato res_id so per-outlet finance/ads/reviews
//     captures don't collide under a single metric_type (was dedup-dropping NCH).
//   - New GET actions: health, snapshots (time-series), reviews
//   - Orders supports custom from/to date range (IST) in addition to presets
//   - Health endpoint returns status = ok | degraded | down based on silence gaps

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  const apiKey = request.headers.get('x-api-key') || url.searchParams.get('key');
  if (apiKey !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }

  const db = env.DB;

  try {
    if (method === 'POST') return handlePost(db, request, headers, env);
    if (method === 'GET') return handleGet(db, url, headers);
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// ========= POST =========
async function handlePost(db, request, headers, env) {
  const body = await request.json();

  // Route: orders → aggregator_orders, session → KV, metrics → aggregator_snapshots
  if (body.type === 'orders' && body.orders) {
    return storeOrders(db, body.orders, headers);
  }

  // Session posts: retired Apr 19 2026. v6.0 extension is appliance-mode and
  // polls Swiggy directly from Chrome; cron's Swiggy path is disabled so no
  // server-side consumer of KV sessions remains. We accept and discard the
  // payload so older extension builds don't see errors, but no KV writes happen.
  if (body.type === 'session' && body.platform) {
    return new Response(JSON.stringify({ ok: true, written: false, reason: 'kv session storage retired' }), { headers });
  }

  // Default: store as metric snapshot
  const snapshots = body.snapshots || [body];
  let stored = 0;

  for (const snap of snapshots) {
    const platform = snap.platform;
    // v6.0: For api_intercept captures, infer brand from res_id in URL if body didn't supply it
    let brand = snap.outlet?.brand || snap.brand || 'unknown';
    if ((brand === 'all' || brand === 'unknown') && snap.source === 'api_intercept' && snap.url) {
      const inferred = inferBrandFromUrl(snap.url);
      if (inferred) brand = inferred;
    }
    const outletId = snap.outlet?.outlet_id || snap.outlet_id || 'unknown';
    const metricType = snap.source === 'api_intercept' ? 'api_' + classifyUrl(snap.url) : snap.page || 'dom_read';
    const data = JSON.stringify(snap.metrics || snap.data || snap);
    const capturedAt = snap.captured_at || new Date().toISOString();

    if (data === '{}' || data === 'null') continue;

    // Deduplication: skip if an identical metric_type was stored in the last 10 minutes
    // Exception: mac_chrome_manual captures always store (they contain richer data like per-outlet splits)
    if (snap.source !== 'mac_chrome_manual') {
      const recent = await db.prepare(
        `SELECT id FROM aggregator_snapshots WHERE platform=? AND brand=? AND metric_type=? AND datetime(captured_at) > datetime('now', '-10 minutes') LIMIT 1`
      ).bind(platform, brand, metricType).first();
      if (recent) continue;
    }

    await db.prepare(
      `INSERT INTO aggregator_snapshots (platform, brand, outlet_id, metric_type, data, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(platform, brand, outletId, metricType, data, capturedAt).run();

    stored++;
  }

  return new Response(JSON.stringify({ ok: true, stored, received: snapshots.length }), { headers });
}

async function storeOrders(db, orders, headers) {
  let upserted = 0;

  for (const o of orders) {
    if (!o.order_id || !o.platform) continue;

    // Auto-detect brand from items if not provided
    let brand = o.brand || 'unknown';
    if (brand === 'unknown' && o.items) {
      brand = /chai|tea|coffee|bun|irani/i.test(o.items) ? 'nch' : 'he';
    }

    await db.prepare(`
      INSERT INTO aggregator_orders (platform, brand, order_id, status, order_time, order_date, customer_name, items, order_value, net_payout, fees, issues, rating, outlet_name, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, order_id) DO UPDATE SET
        status = excluded.status,
        brand = CASE WHEN excluded.brand != 'unknown' THEN excluded.brand ELSE brand END,
        outlet_name = CASE WHEN excluded.outlet_name IS NOT NULL THEN excluded.outlet_name ELSE outlet_name END,
        net_payout = COALESCE(excluded.net_payout, net_payout),
        fees = COALESCE(excluded.fees, fees),
        issues = COALESCE(excluded.issues, issues),
        rating = COALESCE(excluded.rating, rating),
        captured_at = excluded.captured_at
    `).bind(
      o.platform, brand, o.order_id, o.status || null,
      o.order_time || null, o.order_date || null, o.customer_name || null,
      o.items || null, o.order_value || null, o.net_payout || null,
      o.fees || null, o.issues || null, o.rating || null,
      o.outlet_name || null, o.captured_at || new Date().toISOString()
    ).run();

    upserted++;
  }

  return new Response(JSON.stringify({ ok: true, upserted }), { headers });
}

// ========= GET =========
async function handleGet(db, url, headers) {
  const action = url.searchParams.get('action') || 'orders';

  // --- ORDERS: the primary view ---
  if (action === 'orders') {
    const date = url.searchParams.get('date') || 'today';
    const brand = url.searchParams.get('brand');
    const platform = url.searchParams.get('platform');
    const fromParam = url.searchParams.get('from');   // v6.0: custom range YYYY-MM-DD
    const toParam = url.searchParams.get('to');

    // Use IST offset (+5:30) for date calculations.
    // COALESCE falls back to captured_at (IST-adjusted) if order_date is NULL or empty
    // so orders with unparseable date headers still appear on the day captured.
    const IST = "'+5 hours', '+30 minutes'";
    const EFFECTIVE_DATE = `COALESCE(NULLIF(order_date, ''), date(captured_at, ${IST}))`;
    let dateWhere;
    const params = [];

    if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      // v6.0: custom date range takes precedence
      dateWhere = `${EFFECTIVE_DATE} >= ? AND ${EFFECTIVE_DATE} <= ?`;
      params.push(fromParam, toParam);
    } else switch (date) {
      case 'today':     dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST})`; break;
      case 'yesterday': dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST}, '-1 day')`; break;
      case 'week':      dateWhere = `${EFFECTIVE_DATE} >= date('now', ${IST}, '-7 days')`; break;
      case 'month':     dateWhere = `${EFFECTIVE_DATE} >= date('now', ${IST}, '-30 days')`; break;
      case 'all':       dateWhere = `1=1`; break;
      default:          dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST})`;
    }

    let sql = `SELECT * FROM aggregator_orders WHERE ${dateWhere}`;

    if (brand && brand !== 'all') { sql += ' AND brand = ?'; params.push(brand); }
    if (platform && platform !== 'all') { sql += ' AND platform = ?'; params.push(platform); }

    sql += ' ORDER BY order_date DESC, order_time DESC LIMIT 200';

    const { results } = await db.prepare(sql).bind(...params).all();

    // Summary stats
    const delivered = results.filter(r => r.status === 'DELIVERED' || r.status === 'Delivered');
    const totalRevenue = delivered.reduce((s, r) => s + (r.order_value || 0), 0);
    const totalPayout = delivered.reduce((s, r) => s + (r.net_payout || 0), 0);

    // Per-outlet summary
    const byOutlet = {};
    for (const r of results) {
      const key = `${r.platform}_${r.brand}`;
      if (!byOutlet[key]) byOutlet[key] = { platform: r.platform, brand: r.brand, orders: 0, delivered: 0, revenue: 0, payout: 0 };
      byOutlet[key].orders++;
      if (r.status === 'DELIVERED' || r.status === 'Delivered') {
        byOutlet[key].delivered++;
        byOutlet[key].revenue += r.order_value || 0;
        byOutlet[key].payout += r.net_payout || 0;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      date_filter: date,
      total_orders: results.length,
      total_delivered: delivered.length,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_payout: Math.round(totalPayout * 100) / 100,
      by_outlet: Object.values(byOutlet),
      orders: results,
    }), { headers });
  }

  // --- LATEST: operational metrics ---
  if (action === 'latest') {
    // No 24h filter — always return latest snapshot per metric_type regardless of age
    // Exclude junk API captures (config payloads, heartbeats, session alerts)
    const JUNK_TYPES = ["'heartbeat'","'api_finance'","'api_config'","'api_orders'","'alert_session_redirect'","'orders'","'business-metrics'","'live-tracking'","'business-reports'"];
    const { results } = await db.prepare(`
      SELECT a.* FROM aggregator_snapshots a
      INNER JOIN (
        SELECT platform, brand, metric_type, MAX(id) as max_id
        FROM aggregator_snapshots
        WHERE platform NOT IN ('system')
          AND metric_type NOT IN (${JUNK_TYPES.join(',')})
        GROUP BY platform, brand, metric_type
      ) b ON a.id = b.max_id
      ORDER BY a.captured_at DESC
    `).all();

    const grouped = {};
    for (const row of results) {
      const key = `${row.platform}_${row.brand}`;
      if (!grouped[key]) grouped[key] = { platform: row.platform, brand: row.brand, metrics: {} };
      grouped[key].metrics[row.metric_type] = { data: JSON.parse(row.data), captured_at: row.captured_at };
    }

    // Find overall last snapshot time across all platforms
    const lastAt = results.length ? results[0].captured_at : null;

    return new Response(JSON.stringify({ ok: true, outlets: Object.values(grouped), last_snapshot_at: lastAt }), { headers });
  }

  // --- STATS ---
  if (action === 'stats') {
    const [snapStats, orderStats] = await Promise.all([
      db.prepare(`SELECT platform, brand, COUNT(*) as snaps, MAX(captured_at) as last FROM aggregator_snapshots GROUP BY platform, brand`).all(),
      db.prepare(`SELECT platform, brand, COUNT(*) as orders, MAX(captured_at) as last FROM aggregator_orders GROUP BY platform, brand`).all(),
    ]);

    return new Response(JSON.stringify({
      ok: true,
      snapshots: snapStats.results,
      orders: orderStats.results,
    }), { headers });
  }

  // --- FINANCE: Swiggy payout summary ---
  if (action === 'finance') {
    const { results } = await db.prepare(`
      SELECT a.* FROM aggregator_snapshots a
      INNER JOIN (
        SELECT platform, brand, metric_type, MAX(id) as max_id
        FROM aggregator_snapshots
        WHERE metric_type LIKE 'finance_%'
        GROUP BY platform, brand, metric_type
      ) b ON a.id = b.max_id
    `).all();

    return new Response(JSON.stringify({
      ok: true,
      finance: results.map(r => ({ ...r, data: JSON.parse(r.data) })),
    }), { headers });
  }

  // --- v6.0 HEALTH: silence detection + pipeline status ---
  if (action === 'health') {
    const [swiggyOrder, zomatoOrder, snapshots] = await Promise.all([
      db.prepare(`SELECT MAX(captured_at) as last FROM aggregator_orders WHERE platform='swiggy'`).first(),
      db.prepare(`SELECT MAX(captured_at) as last FROM aggregator_orders WHERE platform='zomato'`).first(),
      db.prepare(`SELECT platform, metric_type, MAX(captured_at) as last FROM aggregator_snapshots WHERE platform IN ('swiggy','zomato') GROUP BY platform, metric_type`).all(),
    ]);

    const now = Date.now();
    const ageMin = (iso) => iso ? Math.round((now - new Date(iso).getTime()) / 60000) : null;

    const lastSwiggyOrderAt = swiggyOrder?.last || null;
    const lastZomatoOrderAt = zomatoOrder?.last || null;
    const lastSnapByPlatform = {};
    for (const r of (snapshots.results || [])) {
      const prev = lastSnapByPlatform[r.platform];
      if (!prev || r.last > prev) lastSnapByPlatform[r.platform] = r.last;
    }

    // Business hours = 12pm IST to 1am IST next day. During those hours we require
    // fresh Zomato data; outside them (1am-12pm IST) we allow silence.
    const istNow = new Date(now + 5.5 * 3600 * 1000);
    const istHour = istNow.getUTCHours();
    const zomatoBusiness = istHour >= 12 || istHour < 1;

    // Compute status
    const swiggyAge = ageMin(lastSwiggyOrderAt);
    const zomatoAge = ageMin(lastZomatoOrderAt);
    const swiggySnapAge = ageMin(lastSnapByPlatform.swiggy);
    const zomatoSnapAge = ageMin(lastSnapByPlatform.zomato);

    let status = 'ok';
    const issues = [];
    if (swiggySnapAge !== null && swiggySnapAge > 30) { status = 'degraded'; issues.push(`swiggy snapshots silent ${swiggySnapAge}min`); }
    if (zomatoBusiness && zomatoSnapAge !== null && zomatoSnapAge > 30) { status = 'degraded'; issues.push(`zomato snapshots silent ${zomatoSnapAge}min`); }
    if (swiggySnapAge !== null && swiggySnapAge > 60) { status = 'down'; }
    if (zomatoBusiness && zomatoSnapAge !== null && zomatoSnapAge > 60) { status = 'down'; }
    if (swiggySnapAge === null && zomatoSnapAge === null) { status = 'down'; issues.push('no snapshots ever'); }

    return new Response(JSON.stringify({
      ok: true,
      status,
      issues,
      last_swiggy_order_at: lastSwiggyOrderAt,
      last_zomato_order_at: lastZomatoOrderAt,
      last_snapshot_at: lastSnapByPlatform,
      age_minutes: {
        swiggy_order: swiggyAge, zomato_order: zomatoAge,
        swiggy_snap: swiggySnapAge, zomato_snap: zomatoSnapAge,
      },
      zomato_business_hours: zomatoBusiness,
      checked_at: new Date().toISOString(),
    }), { headers });
  }

  // --- v6.0 SNAPSHOTS: time-series query for analytics dashboards ---
  if (action === 'snapshots') {
    const metricType = url.searchParams.get('metric_type');
    const metricPrefix = url.searchParams.get('metric_prefix'); // e.g. "api_finance"
    const platform = url.searchParams.get('platform');
    const brand = url.searchParams.get('brand');
    const fromP = url.searchParams.get('from');
    const toP = url.searchParams.get('to');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

    let sql = `SELECT * FROM aggregator_snapshots WHERE 1=1`;
    const params = [];
    if (metricType) {
      // Support `%` wildcards (LIKE) or exact match
      if (metricType.includes('%')) { sql += ' AND metric_type LIKE ?'; params.push(metricType); }
      else { sql += ' AND metric_type = ?'; params.push(metricType); }
    }
    if (metricPrefix) { sql += ' AND metric_type LIKE ?'; params.push(metricPrefix + '%'); }
    if (platform && platform !== 'all') { sql += ' AND platform = ?'; params.push(platform); }
    if (brand && brand !== 'all') { sql += ' AND brand = ?'; params.push(brand); }
    if (fromP && /^\d{4}-\d{2}-\d{2}$/.test(fromP)) { sql += ` AND date(captured_at) >= ?`; params.push(fromP); }
    if (toP && /^\d{4}-\d{2}-\d{2}$/.test(toP)) { sql += ` AND date(captured_at) <= ?`; params.push(toP); }
    sql += ` ORDER BY captured_at DESC LIMIT ?`;
    params.push(limit);

    const { results } = await db.prepare(sql).bind(...params).all();
    const parsed = results.map(r => ({ ...r, data: safeJsonParse(r.data) }));
    return new Response(JSON.stringify({ ok: true, count: parsed.length, snapshots: parsed }), { headers });
  }

  // --- v6.0 REVIEWS: per-review feed from Zomato NPS + Swiggy ratings captures ---
  if (action === 'reviews') {
    const platform = url.searchParams.get('platform');
    const brand = url.searchParams.get('brand');
    const date = url.searchParams.get('date') || 'month';
    const fromP = url.searchParams.get('from');
    const toP = url.searchParams.get('to');
    const IST = "'+5 hours', '+30 minutes'";

    let dateWhere;
    if (fromP && toP && /^\d{4}-\d{2}-\d{2}$/.test(fromP) && /^\d{4}-\d{2}-\d{2}$/.test(toP)) {
      dateWhere = `date(captured_at) BETWEEN ? AND ?`;
    } else {
      switch (date) {
        case 'today': dateWhere = `date(captured_at) = date('now', ${IST})`; break;
        case 'yesterday': dateWhere = `date(captured_at) = date('now', ${IST}, '-1 day')`; break;
        case 'week': dateWhere = `date(captured_at) >= date('now', ${IST}, '-7 days')`; break;
        case 'month': dateWhere = `date(captured_at) >= date('now', ${IST}, '-30 days')`; break;
        default: dateWhere = `date(captured_at) >= date('now', ${IST}, '-30 days')`;
      }
    }

    let sql = `SELECT * FROM aggregator_snapshots WHERE metric_type LIKE 'api_reviews%' OR metric_type LIKE 'api_ratings%'`;
    const params = [];
    if (fromP && toP && /^\d{4}-\d{2}-\d{2}$/.test(fromP) && /^\d{4}-\d{2}-\d{2}$/.test(toP)) {
      params.push(fromP, toP);
    }
    sql += ` AND ${dateWhere}`;
    if (platform && platform !== 'all') { sql += ' AND platform = ?'; params.push(platform); }
    if (brand && brand !== 'all') { sql += ' AND brand = ?'; params.push(brand); }
    sql += ` ORDER BY captured_at DESC LIMIT 100`;

    const { results } = await db.prepare(sql).bind(...params).all();

    // Also include order-level issues from aggregator_orders for the same range
    const orderIssues = await db.prepare(`
      SELECT platform, brand, order_id, customer_name, items, order_value, status, issues, rating, order_date, order_time, outlet_name
      FROM aggregator_orders
      WHERE issues IS NOT NULL AND issues != ''
        AND ${dateWhere.replace('captured_at', 'order_date || \'T00:00:00\'')}
      ORDER BY order_date DESC, order_time DESC LIMIT 200
    `).bind(...(fromP && toP ? [fromP, toP] : [])).all().catch(() => ({ results: [] }));

    return new Response(JSON.stringify({
      ok: true,
      reviews: results.map(r => ({ ...r, data: safeJsonParse(r.data) })),
      order_issues: orderIssues.results || [],
    }), { headers });
  }

  return new Response(JSON.stringify({ error: 'unknown action', valid: ['orders', 'latest', 'stats', 'finance', 'health', 'snapshots', 'reviews'] }), { status: 400, headers });
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return s; } }

// v6.0: Classify URL into a metric_type. For Zomato per-outlet endpoints we include
// the res_id so HE and NCH captures don't collide in the 10-min dedup window.
const ZOMATO_OUTLET = {
  '22632449': 'he',   // Hamza Express
  '22632430': 'nch',  // Nawabi Chai House
};
const SWIGGY_OUTLET = {
  '1342887': 'nch',
  '1342888': 'he',
};

function extractResId(url) {
  if (!url) return null;
  // Query-string form: ?res_id=22632449 or &restaurant_id=22632449
  let m = url.match(/[?&](?:res_id|restaurant_id|rest_id|outlet_id)=(\d+)/i);
  if (m) return m[1];
  // Path form: /finance/22632449/ or /restaurant/22632449
  m = url.match(/\/(?:res|restaurant|outlet|finance|ads|reviews|nps|menu)\/(\d{6,})\b/i);
  if (m) return m[1];
  // Bare numeric segment that matches a known outlet
  m = url.match(/\b(22632449|22632430|1342887|1342888)\b/);
  if (m) return m[1];
  return null;
}

function classifyUrl(url) {
  if (!url) return 'unknown';
  const resId = extractResId(url);
  const brandSuffix = ZOMATO_OUTLET[resId] || SWIGGY_OUTLET[resId];
  const suffix = brandSuffix ? `_${brandSuffix}` : '';

  // Check specific patterns BEFORE generic ones (order matters).
  if (/\/nps\b|\/review|feedback|customer-voice/i.test(url)) return `reviews${suffix}`;
  if (/\/ads\b|promot|campaign|marketing-tools/i.test(url)) return `ads${suffix}`;
  if (/\/finance\b|payout|settlement|invoice|earning/i.test(url)) return `finance${suffix}`;
  if (/\/rating\b/i.test(url)) return `ratings${suffix}`;
  if (/order/i.test(url)) return `orders${suffix}`;
  if (/sales|revenue|metrics|business.report/i.test(url)) return `sales${suffix}`;
  if (/menu/i.test(url)) return `menu${suffix}`;
  if (/funnel/i.test(url)) return `funnel${suffix}`;
  if (/customer/i.test(url)) return `customers${suffix}`;
  if (/discount|offer/i.test(url)) return `discounts${suffix}`;
  if (/restaurant.*config/i.test(url)) return 'config';
  return 'other';
}

function inferBrandFromUrl(url) {
  const resId = extractResId(url);
  if (!resId) return null;
  return ZOMATO_OUTLET[resId] || SWIGGY_OUTLET[resId] || null;
}
// v3.0.1 Tue Apr 14 18:50:52 IST 2026
