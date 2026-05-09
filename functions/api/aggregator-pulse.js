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
    // Embed source URL inside the data JSON for api_intercept captures so Phase 3
    // mining can identify the originating endpoint after the fact. No schema change
    // needed; consumers just read data._intercept_url when present.
    let payload = snap.metrics || snap.data || snap;
    if (snap.source === 'api_intercept' && snap.url && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      payload = { ...payload, _intercept_url: snap.url };
    }
    const data = JSON.stringify(payload);
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

  // --- v6.1 PARSED: per-brand per-platform structured data for the new HE/NCH UI ---
  // Returns clean, sectioned data that the new dashboard can consume directly without
  // having to know about raw metric_types or snapshot shape. Each section carries a
  // `data_scope` flag so the UI can label clearly when data is HE-only vs combined.
  if (action === 'parsed') {
    const brand = url.searchParams.get('brand');     // 'he' | 'nch'
    const platform = url.searchParams.get('platform'); // 'swiggy' | 'zomato'
    const period = url.searchParams.get('period') || 'today'; // today|yesterday|thisweek|lastweek|month
    const HE_OUTLET_SWIGGY = '1342887';
    const NCH_OUTLET_SWIGGY = '1342888';
    const HE_OUTLET_ZOMATO = '22632449';
    const NCH_OUTLET_ZOMATO = '22632430';
    const targetSwiggyOutlet = brand === 'he' ? HE_OUTLET_SWIGGY : NCH_OUTLET_SWIGGY;
    const targetZomatoOutlet = brand === 'he' ? HE_OUTLET_ZOMATO : NCH_OUTLET_ZOMATO;

    if (!['he', 'nch'].includes(brand)) {
      return new Response(JSON.stringify({ error: 'brand must be he or nch' }), { status: 400, headers });
    }
    if (!['swiggy', 'zomato'].includes(platform)) {
      return new Response(JSON.stringify({ error: 'platform must be swiggy or zomato' }), { status: 400, headers });
    }

    // Helper: latest snapshot of a given metric_type (any brand/outlet)
    const latestSnap = async (mt, brandFilter) => {
      let sql = `SELECT * FROM aggregator_snapshots WHERE platform = ? AND metric_type = ?`;
      const p = [platform, mt];
      if (brandFilter) { sql += ` AND brand = ?`; p.push(brandFilter); }
      sql += ` ORDER BY captured_at DESC LIMIT 1`;
      const row = await db.prepare(sql).bind(...p).first();
      return row ? { ...row, data: safeJsonParse(row.data) } : null;
    };

    // Helper: latest snapshot whose metric_type has a given prefix (e.g. live_tracking_api)
    const latestSnapPrefix = async (prefix, brandFilter) => {
      let sql = `SELECT * FROM aggregator_snapshots WHERE platform = ? AND metric_type LIKE ?`;
      const p = [platform, prefix + '%'];
      if (brandFilter) { sql += ` AND brand = ?`; p.push(brandFilter); }
      sql += ` ORDER BY captured_at DESC LIMIT 1`;
      const row = await db.prepare(sql).bind(...p).first();
      return row ? { ...row, data: safeJsonParse(row.data) } : null;
    };

    const sections = {};

    if (platform === 'swiggy') {
      // === SWIGGY ===
      const reportType = `reports_swiggy_${period}`;
      const report = await latestSnap(reportType, 'all');
      const liveOrders = await latestSnap('live_orders', 'all');
      const apiOrders = await latestSnap('api_orders', 'all');

      const num = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      // ---- GROWTH (HE-only — DERIVED from per-brand orders + order-detail captures) ----
      // Strict policy: NO combined HE+NCH data on a brand-specific endpoint. If we
      // can't compute HE-only, we explicitly list the metric as not_yet_he_only with
      // a reason — never show combined data masquerading as HE.
      sections.growth = {
        data_scope: 'he_only',
        data_scope_note: 'Strict per-brand. Funnel/ads/listing not surfaced here because Swiggy business-metrics is combined-only — listed in not_yet_he_only with the gap reason.',
        captured_at: null,  // populated from orders block below
        not_yet_he_only: {
          impressions: 'Combined HE+NCH only on Swiggy business-metrics. Needs extension to apply outlet filter (Phase 1B).',
          menu_opens: 'same — combined-only',
          funnel_conversion_pct: 'same — combined-only',
          ads_spend: 'same — combined-only (Swiggy reports ads at brand=all)',
          cba_sales: 'same — combined-only',
          listing_menu_score: 'Combined Swiggy menu score covers HE+NCH menu union. Per-outlet score requires outlet filter.',
          items_with_photos_pct: 'same — combined-only',
          online_availability_pct_swiggy_metric: 'Use the per-brand availability derived from api_orders.restaurantData below instead.',
          discount_sales: 'Combined-only on Swiggy. Per-brand discount usage IS available via order-detail (Zomato platform), see /he/zomato.',
        },
        // HE-only fields (derived from per-brand sources) populated after orders block runs.
        // See section.sales for the actual numbers — Sales section is the canonical HE-only revenue/order view.
      };

      // ---- OPS (strict HE-only) ----
      const liveOutlet = (() => {
        if (!apiOrders) return null;
        const rd = apiOrders.data?.restaurantData;
        if (!Array.isArray(rd)) return null;
        return rd.find(x => String(x.restaurantId) === targetSwiggyOutlet) || null;
      })();
      const liveOrderEntry = (() => {
        if (!liveOrders) return null;
        const outlets = liveOrders.data?.outlets;
        if (!Array.isArray(outlets)) return null;
        return outlets.find(x => String(x.restaurantId) === targetSwiggyOutlet) || null;
      })();

      sections.ops = {
        data_scope: 'he_only',
        data_scope_note: 'Strict per-brand. Live status is HE-only via api_orders.restaurantData filter. Combined HE+NCH delivery-quality / cancellations / complaints / bolt metrics REMOVED — see not_yet_he_only.',
        captured_at: apiOrders?.captured_at || liveOrders?.captured_at || null,
        live_status: liveOutlet ? {
          outlet_id: liveOutlet.restaurantId,
          is_open: liveOutlet.isOpen,
          is_serviceable: liveOutlet.isServiceable,
          stress: liveOutlet.stressInfo?.stress || false,
          active_batches: Object.keys(liveOutlet.batches || {}).length,
          updated_at: apiOrders.captured_at,
        } : (liveOrderEntry ? {
          outlet_id: liveOrderEntry.restaurantId,
          is_serviceable: liveOrderEntry.isServiceable,
          active_batches: liveOrderEntry.activeBatches,
          updated_at: liveOrders.captured_at,
        } : { available: false, reason: 'api_orders capture for this outlet not present yet — extension cycles every few min' }),
        // HE-only cancellation + delay rate computed from aggregator_orders below
        not_yet_he_only: {
          kitchen_prep_time_min: 'Combined Swiggy reports — needs extension outlet filter',
          mfr_accuracy_pct: 'same — combined Swiggy metric',
          delayed_10min_pct: 'same',
          online_availability_pct: 'same',
          poor_rated_orders: 'same',
          complaint_pct: 'same — Swiggy combined complaint counter',
          wrong_items: 'same',
          missing_items: 'same',
          quality_issues: 'same',
          packaging_issues: 'same',
          bolt_metrics: 'Bolt instant-delivery metrics combined HE+NCH. HE not enrolled in Bolt — number is irrelevant for HE.',
        },
      };

      // ---- SALES (will be overridden later by per-brand aggregation from aggregator_orders) ----
      // Placeholder — the actual per-brand sales numbers are computed in the ORDERS block below.
      sections.sales = {
        data_scope: 'he_only',
        data_scope_note: 'Computed from aggregator_orders WHERE brand=he/nch — see below for actual values.',
        // overridden after orders block runs
      };

      sections.finance = {
        data_scope: 'unavailable',
        reason: 'Swiggy finance page DOM extraction not yet implemented. The api_finance_* snapshots in DB are misclassified Swiggy config responses, not real finance data.',
      };

      sections.reviews = {
        data_scope: 'unavailable',
        reason: 'Swiggy reviews extraction not yet implemented.',
      };

    } else {
      // === ZOMATO (delivery only) ===
      const liveTrack = await latestSnap('live_tracking', 'all');
      const liveTrackApi = await latestSnap('live_tracking_api', 'all');
      const restMetrics = await latestSnap('restaurant_metrics', 'all');

      const num = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      // ---- GROWTH (HE-only — strict; no combined data leaks through) ----
      // Zomato live_tracking metrics are combined HE+NCH because both outlets are
      // selected by default. We do NOT surface those numbers here. Per-brand growth
      // intelligence comes from order-detail captures (top dishes, customer cohorts,
      // discount usage, payment methods) computed below.
      sections.growth = {
        data_scope: 'he_only',
        data_scope_note: 'Strict per-brand. Combined-only Zomato metrics excluded — see not_yet_he_only for the full gap list.',
        captured_at: null,  // populated by order-detail compute below
        // Top dishes + customer cohorts populated after the order-detail compute step further down.
        not_yet_he_only: {
          impressions: 'Zomato live_tracking returns combined HE+NCH. Needs outlet filter applied by extension (Phase 1B).',
          menu_opens: 'same — combined-only',
          cart_builds: 'same',
          orders_placed: 'same',
          imp_to_menu_pct: 'same',
          menu_to_cart_pct: 'same',
          cart_to_order_pct: 'same',
          new_users: 'Combined Zomato customer counters — outlet filter needed for per-brand split.',
          repeat_users: 'same',
          lapsed_users: 'same',
          sales_from_offers: 'Combined Zomato offer revenue. Per-brand offer effectiveness is derivable from order-detail.calculations field — see top_dishes / discount_orders below when populated.',
          listing_score: 'Zomato never exposes a per-outlet listing score in the merchant view. Listing-quality audit needs consumer-side scraping (Phase 4).',
        },
        // top_dishes_he, customer_cohort_he, payment_mix_he, discount_usage_pct populated after the order-detail join below.
      };

      // ---- OPS (strict HE-only) ----
      const myOutletMeta = (() => {
        if (!restMetrics) return null;
        const ents = restMetrics.data?.entities;
        if (!Array.isArray(ents)) return null;
        return ents.find(e => String(e.res_id) === targetZomatoOutlet || String(e.id) === targetZomatoOutlet) || null;
      })();

      sections.ops = {
        data_scope: 'he_only',
        data_scope_note: 'Strict per-brand. Outlet metadata is HE-only via restaurant_metrics filter. Combined HE+NCH delivery_quality fields REMOVED — see not_yet_he_only.',
        captured_at: restMetrics?.captured_at || null,
        outlet_metadata: myOutletMeta ? {
          res_id: myOutletMeta.res_id || myOutletMeta.id,
          address: myOutletMeta.address,
          active_since: myOutletMeta.active_since,
          am_email: myOutletMeta.am_details?.poc_email,
          am_phone: myOutletMeta.am_details?.poc_phone,
        } : { available: false, reason: `Restaurant metadata for outlet ${targetZomatoOutlet} not found in latest restaurant_metrics capture` },
        // HE-only cancellation rate, delay rate, issue counts computed from aggregator_orders below
        not_yet_he_only: {
          rejected_pct: 'Combined Zomato live_tracking metric. Per-brand rejection rate is derivable from aggregator_orders.status — surfaced below as cancellation_rate_pct.',
          delayed_pct: 'Combined-only. Per-brand delay info is in aggregator_orders.issues.',
          poor_rated_pct: 'Combined-only.',
          lost_sales: 'Combined Zomato lost_sales. Cannot derive HE-only without outlet filter capture.',
        },
      };

      // ---- SALES (placeholder — actual values from per-brand orders below) ----
      sections.sales = {
        data_scope: 'he_only',
        data_scope_note: 'Computed from aggregator_orders WHERE brand=he/nch — see Sales totals below.',
        // overridden after orders block runs
      };

      sections.finance = {
        data_scope: 'unavailable',
        reason: 'Zomato delivery finance/payout extraction not yet implemented in extension.',
      };

      sections.reviews = {
        data_scope: 'unavailable',
        reason: 'Zomato delivery reviews/NPS extraction not yet implemented in extension.',
      };
    }

    // ---- ORDERS (always per-brand from aggregator_orders table) ----
    const IST = "'+5 hours', '+30 minutes'";
    const EFFECTIVE_DATE = `COALESCE(NULLIF(order_date, ''), date(captured_at, ${IST}))`;
    let dateWhere;
    switch (period) {
      case 'today':     dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST})`; break;
      case 'yesterday': dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST}, '-1 day')`; break;
      case 'thisweek':  dateWhere = `${EFFECTIVE_DATE} >= date('now', ${IST}, 'weekday 0', '-7 days')`; break;
      case 'lastweek':  dateWhere = `${EFFECTIVE_DATE} >= date('now', ${IST}, 'weekday 0', '-14 days') AND ${EFFECTIVE_DATE} < date('now', ${IST}, 'weekday 0', '-7 days')`; break;
      case 'month':     dateWhere = `${EFFECTIVE_DATE} >= date('now', ${IST}, '-30 days')`; break;
      default:          dateWhere = `${EFFECTIVE_DATE} = date('now', ${IST})`;
    }
    const orderRows = await db.prepare(`
      SELECT * FROM aggregator_orders
      WHERE ${dateWhere} AND platform = ? AND brand = ?
      ORDER BY order_date DESC, order_time DESC LIMIT 200
    `).bind(platform, brand).all();

    // ---- DAILY series (always 30-day window, regardless of period filter) ----
    // This powers the Insights-tab daily chart. Built independent of the period
    // filter so the chart is a stable 30-day reference for trend + gap detection.
    const dailyRows = await db.prepare(`
      SELECT
        ${EFFECTIVE_DATE} AS d,
        COUNT(*) AS orders,
        SUM(CASE WHEN LOWER(status) LIKE '%delivered%' THEN order_value ELSE 0 END) AS revenue,
        SUM(CASE WHEN LOWER(status) LIKE '%delivered%' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN LOWER(status) LIKE '%cancel%' OR LOWER(status) LIKE '%reject%' THEN 1 ELSE 0 END) AS cancelled
      FROM aggregator_orders
      WHERE ${EFFECTIVE_DATE} >= date('now', ${IST}, '-30 days')
        AND platform = ? AND brand = ?
      GROUP BY d
      ORDER BY d ASC
    `).bind(platform, brand).all();
    // Fill calendar gaps so chart shows missing-capture days as zero bars
    const dailyMap = {};
    for (const r of (dailyRows.results || [])) {
      dailyMap[r.d] = {
        date: r.d,
        orders: r.orders || 0,
        revenue: Math.round((r.revenue || 0) * 100) / 100,
        delivered: r.delivered || 0,
        cancelled: r.cancelled || 0,
      };
    }
    // Generate 30 calendar dates ending today (IST)
    const dailyFilled = [];
    const todayIst = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
    for (let i = 30; i >= 0; i--) {
      const d = new Date(todayIst);
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      dailyFilled.push(dailyMap[ds] || { date: ds, orders: 0, revenue: 0, delivered: 0, cancelled: 0 });
    }

    const ordersList = orderRows.results || [];
    const delivered = ordersList.filter(r => /delivered/i.test(r.status || ''));
    const totalRevenue = Math.round(delivered.reduce((s, r) => s + (r.order_value || 0), 0) * 100) / 100;
    const totalPayout = Math.round(delivered.reduce((s, r) => s + (r.net_payout || 0), 0) * 100) / 100;
    const aov = delivered.length ? Math.round(totalRevenue / delivered.length) : 0;
    const cancelled = ordersList.filter(r => /cancel|reject/i.test(r.status || ''));
    const cancelledLoss = Math.round(cancelled.reduce((s, r) => s + (r.order_value || 0), 0) * 100) / 100;

    sections.orders = {
      data_scope: 'he_only_or_nch_only',
      captured_at: ordersList[0]?.captured_at || null,
      total_orders: ordersList.length,
      total_delivered: delivered.length,
      total_revenue: totalRevenue,
      total_payout: totalPayout,
      orders: ordersList,
    };

    // 30-day daily series — for Insights chart + gap visualization
    sections.daily = {
      data_scope: brand === 'he' ? 'he_only' : 'nch_only',
      window_days: 31,
      points: dailyFilled,
      note: 'Per-IST-day orders + delivered revenue. Days with zero values may be (a) genuine zero-order days or (b) capture gaps when extension was offline. Click a bar to drill into that day\'s orders.',
    };

    // CRITICAL: override Sales section with HE-only / NCH-only aggregation from
    // aggregator_orders. The earlier sections.sales (set by Swiggy/Zomato platform
    // blocks above) used combined data — replaced here with brand-filtered truth.
    sections.sales = {
      data_scope: brand === 'he' ? 'he_only' : 'nch_only',
      data_provenance: 'aggregator_orders (per-order rows, brand-filtered)',
      data_scope_note: `Aggregated from aggregator_orders WHERE brand='${brand}' AND platform='${platform}'. Genuinely ${brand.toUpperCase()}-only — does NOT include the other brand.`,
      captured_at: ordersList[0]?.captured_at || null,
      totals: {
        net_sales: totalRevenue,
        delivered_orders: delivered.length,
        aov: aov,
        cancelled_orders: cancelled.length,
        cancelled_loss: cancelledLoss,
        net_payout: totalPayout,
      },
      period_note: `${ordersList.length} orders found in period (${delivered.length} delivered).`,
    };

    // ---- CAPTURE HEALTH ----
    // Reports the truth about how reliable the per-order data is. The dashboard
    // uses this to decide whether to show the per-order chart vs the aggregate
    // fallback banner.
    const lastOrderRow = await db.prepare(`
      SELECT MAX(captured_at) AS last_capture, COUNT(*) AS total_orders
      FROM aggregator_orders WHERE platform = ? AND brand = ?
    `).bind(platform, brand).first();
    const last30dCount = dailyFilled.reduce((s, p) => s + p.orders, 0);
    const nonZeroDays = dailyFilled.filter(p => p.orders > 0).length;
    sections.capture_health = {
      platform,
      brand,
      last_per_order_capture: lastOrderRow?.last_capture || null,
      total_per_order_rows_alltime: lastOrderRow?.total_orders || 0,
      orders_last_30d: last30dCount,
      non_zero_days_last_30d: nonZeroDays,
      coverage_pct_last_30d: Math.round(nonZeroDays / 31 * 100),
      // "sparse" = effectively no per-order data (Swiggy is currently in this state)
      per_order_status: last30dCount < 5 ? 'sparse' : (nonZeroDays < 15 ? 'partial' : 'healthy'),
    };

    // ---- SWIGGY AGGREGATE FALLBACK ----
    // Swiggy historical per-order data isn't being captured by the extension
    // today (Finance-page DOM scrape died ~Apr 17, fetchOrders API isn't
    // intercepted in normal nav flow). However, business-metrics page DOES
    // produce reports_swiggy_{period} aggregates which we capture every cycle.
    // When per-order data is sparse, populate sections.sales_aggregate with
    // those numbers so the dashboard isn't empty.
    //
    // CAVEAT: reports_swiggy_* is brand='all' (combined HE+NCH) because
    // Swiggy's business-metrics page shows combined view by default.
    // Surfacing it as he_only would lie. We label it explicitly as combined.
    if (platform === 'swiggy' && sections.capture_health.per_order_status === 'sparse') {
      const reportType = `reports_swiggy_${period}`;
      const reportRow = await db.prepare(`
        SELECT * FROM aggregator_snapshots
        WHERE platform='swiggy' AND metric_type=? AND brand='all'
        ORDER BY captured_at DESC LIMIT 1
      `).bind(reportType).first();
      if (reportRow) {
        const reportData = safeJsonParse(reportRow.data) || {};
        const num = (v) => {
          if (v === null || v === undefined || v === '') return null;
          const n = parseFloat(v);
          return isNaN(n) ? null : n;
        };
        sections.sales_aggregate = {
          data_scope: 'combined_he_nch',
          data_provenance: `aggregator_snapshots metric_type='${reportType}' (Swiggy business-metrics page, combined view)`,
          captured_at: reportRow.captured_at,
          totals: {
            net_sales: num(reportData.rpt_net_sales),
            delivered_orders: num(reportData.rpt_delivered_orders),
            cancelled_orders: num(reportData.rpt_cancelled_orders),
            aov: num(reportData.rpt_net_aov),
            impressions: num(reportData.impressions),
            menu_opens: num(reportData.menu_opens),
            cart_builds: num(reportData.cart_builds),
            orders_placed: num(reportData.orders_placed),
            new_customers: num(reportData.new_customers),
            repeat_customers: num(reportData.repeat_customers),
          },
          warning: `These numbers are COMBINED HE+NCH on Swiggy. Per-outlet split requires Finance-page DOM scrape (broken since 2026-04-17) or fetchOrders API capture (not currently triggered by extension nav). Use as approximate signal only.`,
        };
      }
    }

    // ===== HE-only enrichment from per-brand order data =====
    // Sales is already correct above. Now populate Growth + Ops with HE-only-derived
    // metrics from aggregator_orders + Zomato order-detail captures.

    const cancellationRate = ordersList.length ? Math.round(cancelled.length / ordersList.length * 1000) / 10 : null;
    const ordersWithIssues = ordersList.filter(r => r.issues && String(r.issues).trim());
    const issueRate = ordersList.length ? Math.round(ordersWithIssues.length / ordersList.length * 1000) / 10 : null;
    const issueBreakdown = {};
    for (const r of ordersWithIssues) {
      const text = String(r.issues).toLowerCase();
      if (/delay/.test(text))                           issueBreakdown.delay = (issueBreakdown.delay || 0) + 1;
      if (/wrong/.test(text))                           issueBreakdown.wrong_item = (issueBreakdown.wrong_item || 0) + 1;
      if (/missing/.test(text))                         issueBreakdown.missing_item = (issueBreakdown.missing_item || 0) + 1;
      if (/quality|cold|stale/.test(text))              issueBreakdown.quality = (issueBreakdown.quality || 0) + 1;
      if (/packag/.test(text))                          issueBreakdown.packaging = (issueBreakdown.packaging || 0) + 1;
    }
    const ratedOrders = ordersList.filter(r => r.rating !== null && r.rating !== undefined);
    const avgRating = ratedOrders.length ? Math.round(ratedOrders.reduce((s, r) => s + (r.rating || 0), 0) / ratedOrders.length * 10) / 10 : null;
    const poorRated = ratedOrders.filter(r => (r.rating || 0) <= 3);

    sections.ops.cancellation_rate_pct = cancellationRate;
    sections.ops.cancellation_count = cancelled.length;
    sections.ops.issue_rate_pct = issueRate;
    sections.ops.issue_breakdown = issueBreakdown;
    sections.ops.rated_orders = ratedOrders.length;
    sections.ops.avg_rating = avgRating;
    sections.ops.poor_rated_count = poorRated.length;

    // Top dishes + customer cohort from Zomato order-detail captures (only Zomato has these)
    if (platform === 'zomato') {
      const HE_OUTLET_Z = '22632449', NCH_OUTLET_Z = '22632430';
      const targetOutlet = brand === 'he' ? HE_OUTLET_Z : NCH_OUTLET_Z;
      // Pull api_orders captures matching this brand (filter by resId in the order JSON)
      const { results: detailRows } = await db.prepare(`
        SELECT * FROM aggregator_snapshots
        WHERE platform='zomato' AND metric_type='api_orders'
        ORDER BY captured_at DESC LIMIT 200
      `).all();
      const dishStats = {};      // name -> {orders, quantity, revenue, tags, discount_count}
      let firstTimeCustomers = 0, repeatCustomers = 0;
      let ordersWithDiscount = 0, totalDetailOrders = 0;
      const paymentMethods = {};
      for (const row of (detailRows || [])) {
        const d = safeJsonParse(row.data);
        const order = d?.order;
        if (!order || !order.id) continue;
        if (String(order.resId) !== targetOutlet) continue;
        totalDetailOrders++;
        const dishes = order.cartDetails?.items?.dishes || [];
        const creator = order.creator || {};
        const lifetime = creator.orderCount;
        if (lifetime === 1) firstTimeCustomers++;
        else if (lifetime > 1) repeatCustomers++;
        const pm = order.paymentMethod || 'unknown';
        paymentMethods[pm] = (paymentMethods[pm] || 0) + 1;
        let orderHadDiscount = false;
        for (const dish of dishes) {
          const k = dish.name || 'unknown';
          if (!dishStats[k]) dishStats[k] = { name: k, orders: 0, quantity: 0, revenue: 0, tags: new Set(), discount_count: 0 };
          dishStats[k].orders++;
          dishStats[k].quantity += dish.quantity || 0;
          dishStats[k].revenue += dish.totalCost || 0;
          for (const t of (dish.metadata?.tags || [])) dishStats[k].tags.add(t);
          const calcs = dish.calculations || [];
          if (calcs.length > 0) { dishStats[k].discount_count++; orderHadDiscount = true; }
        }
        if (orderHadDiscount) ordersWithDiscount++;
      }
      const topDishes = Object.values(dishStats)
        .map(d => ({ ...d, tags: Array.from(d.tags) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 15);
      sections.growth.top_dishes_he = topDishes;
      sections.growth.customer_cohort_he = {
        sample_size: firstTimeCustomers + repeatCustomers,
        first_time_orders: firstTimeCustomers,
        repeat_orders: repeatCustomers,
        first_time_pct: (firstTimeCustomers + repeatCustomers) ? Math.round(firstTimeCustomers / (firstTimeCustomers + repeatCustomers) * 1000) / 10 : null,
      };
      sections.growth.payment_mix_he = paymentMethods;
      sections.growth.discount_usage_he = {
        orders_with_discount: ordersWithDiscount,
        total_orders_in_sample: totalDetailOrders,
        usage_rate_pct: totalDetailOrders ? Math.round(ordersWithDiscount / totalDetailOrders * 1000) / 10 : null,
        note: 'Discount usage rate is from order-detail captures (Zomato only). Sample size = total order-detail captures with brand match. Smaller than total HE orders because order-detail fires only when partner clicks into an order.',
      };
      sections.growth.captured_at = ordersList[0]?.captured_at || null;
    }

    return new Response(JSON.stringify({
      ok: true,
      brand,
      platform,
      period,
      generated_at: new Date().toISOString(),
      sections,
    }), { headers });
  }

  // --- DAY-ORDERS: drill-through for the daily chart. Returns the full order list for one IST day. ---
  if (action === 'day-orders') {
    const brand = url.searchParams.get('brand');
    const platform = url.searchParams.get('platform');
    const date = url.searchParams.get('date'); // YYYY-MM-DD (IST day)
    if (!['he', 'nch'].includes(brand)) {
      return new Response(JSON.stringify({ error: 'brand must be he or nch' }), { status: 400, headers });
    }
    if (!['swiggy', 'zomato'].includes(platform)) {
      return new Response(JSON.stringify({ error: 'platform must be swiggy or zomato' }), { status: 400, headers });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return new Response(JSON.stringify({ error: 'date must be YYYY-MM-DD' }), { status: 400, headers });
    }
    const IST = "'+5 hours', '+30 minutes'";
    const EFFECTIVE_DATE = `COALESCE(NULLIF(order_date, ''), date(captured_at, ${IST}))`;
    const rows = await db.prepare(`
      SELECT * FROM aggregator_orders
      WHERE ${EFFECTIVE_DATE} = ? AND platform = ? AND brand = ?
      ORDER BY order_time DESC, captured_at DESC
    `).bind(date, platform, brand).all();
    const orders = rows.results || [];
    const delivered = orders.filter(r => /delivered/i.test(r.status || ''));
    const cancelled = orders.filter(r => /cancel|reject/i.test(r.status || ''));
    return new Response(JSON.stringify({
      ok: true, brand, platform, date,
      total_orders: orders.length,
      total_delivered: delivered.length,
      total_cancelled: cancelled.length,
      revenue: Math.round(delivered.reduce((s, r) => s + (r.order_value || 0), 0) * 100) / 100,
      orders,
    }), { headers });
  }

  // --- v6.2 ORDER-DETAIL: Phase 3 API mining — parse api_orders captures into rich per-order data ---
  // The Zomato partner portal fires GET /merchant-api/order/{id} when an order detail
  // panel is opened. The response includes the cart breakdown (dishes/quantities/prices/
  // discounts/tags), customer profile (name + lifetime order count), timeline, and prep
  // time settings. We were storing this raw as metric_type='api_orders' but never
  // exposing the structured fields. This action surfaces them.
  if (action === 'order-detail') {
    const brand = url.searchParams.get('brand'); // 'he' | 'nch' | null=all
    const platform = url.searchParams.get('platform') || 'zomato';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const HE_OUTLET_ZOMATO = '22632449';
    const NCH_OUTLET_ZOMATO = '22632430';

    // Pull api_orders captures (the raw order-detail API responses)
    const { results } = await db.prepare(`
      SELECT * FROM aggregator_snapshots
      WHERE platform = ? AND metric_type = 'api_orders'
      ORDER BY captured_at DESC LIMIT ?
    `).bind(platform, limit * 3).all();  // over-fetch since list+detail mixed

    const parsedOrders = [];
    const dishStats = {};  // name -> {orders, quantity, revenue, tags_seen}

    for (const row of (results || [])) {
      const data = safeJsonParse(row.data);
      const order = data?.order;
      if (!order || !order.id) continue;  // skip list responses

      const resId = String(order.resId || '');
      const orderBrand = resId === HE_OUTLET_ZOMATO ? 'he' : resId === NCH_OUTLET_ZOMATO ? 'nch' : 'unknown';
      if (brand && brand !== 'all' && orderBrand !== brand) continue;

      const cart = order.cartDetails || {};
      const dishes = cart.items?.dishes || [];
      const creator = order.creator || {};

      const parsedDishes = dishes.map(d => ({
        catalogue_id: d.metadata?.catalogueId || null,
        name: d.name,
        quantity: d.quantity,
        unit_cost: d.unitCost,
        total_cost: d.totalCost,
        discount: (d.calculations || []).map(c => ({
          name: c.name,
          amount: c.amount,
          is_percentage: c.isPercentage,
        })),
        tags: d.metadata?.tags || [],
      }));

      // Aggregate dish stats across all orders
      for (const d of parsedDishes) {
        const k = d.name || 'unknown';
        if (!dishStats[k]) {
          dishStats[k] = { name: k, catalogue_id: d.catalogue_id, orders: 0, quantity: 0, revenue: 0, tags: new Set(), discount_count: 0 };
        }
        dishStats[k].orders += 1;
        dishStats[k].quantity += d.quantity || 0;
        dishStats[k].revenue += d.total_cost || 0;
        if (d.discount.length > 0) dishStats[k].discount_count += 1;
        for (const t of (d.tags || [])) dishStats[k].tags.add(t);
      }

      parsedOrders.push({
        order_id: order.id,
        display_id: order.displayId,
        platform: 'zomato',
        brand: orderBrand,
        outlet_res_id: resId,
        state: order.state,
        delivery_mode: order.deliveryMode,
        zomato_delivered: order.zomatoDelivered,
        rider_assigned: order.riderAssigned,
        payment: {
          method: order.paymentMethod,
          type: order.paymentDetails?.paymentType,
        },
        timeline: {
          created_at: order.createdAt,
          actioned_at: order.actionedAt,
          food_ready_at: order.foodOrderReady,
          updated_at: order.updatedAt,
          prep_min: order.handoverDetails?.time,
          prep_min_min: order.handoverDetails?.minTime,
          prep_min_max: order.handoverDetails?.maxTime,
        },
        customer: {
          user_id: creator.userId,
          name: creator.name,
          lifetime_orders: creator.orderCount,
          lifetime_orders_label: creator.orderCountDisplay,
          country_code: creator.countryIsdCode,
          profile_url: creator.profileUrl,
        },
        cart: {
          subtotal: cart.subtotal?.amountDetails?.totalCost,
          total: cart.total?.amountDetails?.totalCost,
          dishes: parsedDishes,
        },
        captured_at: row.captured_at,
      });
    }

    // Convert dish stats Set to array, sort
    const dishesAgg = Object.values(dishStats)
      .map(d => ({ ...d, tags: Array.from(d.tags) }))
      .sort((a, b) => b.revenue - a.revenue);

    return new Response(JSON.stringify({
      ok: true,
      platform,
      brand: brand || 'all',
      order_count: parsedOrders.length,
      orders: parsedOrders.slice(0, limit),
      dish_aggregate: dishesAgg,
      mining_note: parsedOrders.length < 5
        ? 'Sparse data — extension needs to capture more order-detail API calls (currently fires only when partner clicks into an order). Phase 3B candidate: extension auto-clicks each order in order history.'
        : null,
    }), { headers });
  }

  return new Response(JSON.stringify({ error: 'unknown action', valid: ['orders', 'latest', 'stats', 'finance', 'health', 'snapshots', 'reviews', 'parsed', 'order-detail'] }), { status: 400, headers });
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

  // Config endpoints — checked first so we don't mistake fetchConfig / fetchKey-list for orders/finance.
  // Swiggy in particular fires rms.swiggy.com/api/v1/fetchConfig?key=CLOUDINARY_MIGRATION_ENABLED,...
  // every few minutes — that's not finance, it's runtime feature flags.
  if (/fetchConfig|featureFlag|\/config(?:s)?\b|key=[A-Z_,]+/i.test(url)) return 'config';
  if (/restaurant.*config/i.test(url)) return 'config';

  // Check specific patterns BEFORE generic ones (order matters).
  if (/\/nps\b|\/review|feedback|customer-voice/i.test(url)) return `reviews${suffix}`;
  if (/\/ads\b|promot|campaign|marketing-tools/i.test(url)) return `ads${suffix}`;
  if (/\/finance\b|payout|settlement|invoice|earning/i.test(url)) return `finance${suffix}`;
  if (/\/rating\b/i.test(url)) return `ratings${suffix}`;
  if (/fetchOrders|order.*list|order\/history|merchant-api\/orders/i.test(url)) return `orders${suffix}`;
  // Generic /order/ pattern is intentionally narrower than before — too many config
  // and routing endpoints contain the word "order" without being order data.
  if (/\/orders?\//i.test(url) && !/config|tracking|key=|status$/i.test(url)) return `orders${suffix}`;
  if (/sales|revenue|metrics|business.report/i.test(url)) return `sales${suffix}`;
  if (/menu/i.test(url)) return `menu${suffix}`;
  if (/funnel/i.test(url)) return `funnel${suffix}`;
  if (/customer/i.test(url)) return `customers${suffix}`;
  if (/discount|offer/i.test(url)) return `discounts${suffix}`;
  return 'other';
}

function inferBrandFromUrl(url) {
  const resId = extractResId(url);
  if (!resId) return null;
  return ZOMATO_OUTLET[resId] || SWIGGY_OUTLET[resId] || null;
}
// v3.0.1 Tue Apr 14 18:50:52 IST 2026
