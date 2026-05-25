// aggregator-pulse.js v6.0 FINAL — Orders + Metrics API for HN aggregator pipeline
// Changes vs v3:
//   - classifyUrl now extracts Zomato res_id so per-outlet finance/ads/reviews
//     captures don't collide under a single metric_type (was dedup-dropping NCH).
//   - New GET actions: health, snapshots (time-series), reviews
//   - Orders supports custom from/to date range (IST) in addition to presets
//   - Health endpoint returns status = ok | degraded | down based on silence gaps

import { sendWaba } from './_lib/comms-core.js';

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

  // Direct partner API ingestion. These routes let a Mac/Worker poller replay
  // authenticated Swiggy/Zomato partner API calls and write the same order table
  // without relying on Chrome extension DOM scraping or hn-winpc tab state.
  if (body.type === 'swiggy_fetch_orders' && body.payload) {
    const orders = normalizeSwiggyFetchOrders(body.payload);
    return storeOrders(db, orders, headers);
  }
  if (body.type === 'swiggy_order_history' && body.payload) {
    const orders = normalizeSwiggyHistory(body.payload);
    return storeOrders(db, orders, headers);
  }

  if (body.type === 'zomato_order_history' && body.payload) {
    const orders = normalizeZomatoOrderHistory(body.payload);
    return storeOrders(db, orders, headers);
  }

  if (body.type === 'zomato_order_detail' && (body.payload || body.order)) {
    const order = normalizeZomatoOrderDetail(body.payload || { order: body.order });
    return storeOrders(db, order ? [order] : [], headers);
  }

  // COA Ring 2 action runner. This is the cron/manual-safe direct partner API
  // pull path over the Ring 1 coordinate set. It does not mutate partner
  // portals, POS, Odoo, prices, or offers; it only replays authenticated
  // frontend order APIs, normalizes rows, and records per-coordinate health.
  if ((body.type === 'coa_ring2_pull' || body.action === 'coa_ring2_pull')) {
    const result = await executeAggregatorCoaRing2Pull(db, env, body);
    return new Response(JSON.stringify(result), { headers });
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
  const upserted = await upsertOrders(db, orders);
  return new Response(JSON.stringify({ ok: true, upserted }), { headers });
}

async function upsertOrders(db, orders) {
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

  return upserted;
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

  // --- OWNER-ORDERS: clean order-history view for owner dashboard ---
  // This is intentionally narrower than the old all-in-one dashboard API. It
  // returns order rows enriched with Zomato detail captures when present, so the
  // UI can focus on accepted/delivered/rejected/missed orders before any offer
  // or price-positioning mutation.
  if (action === 'owner-orders') {
    const date = url.searchParams.get('date') || 'today';
    const brand = url.searchParams.get('brand');
    const platform = url.searchParams.get('platform');
    const status = url.searchParams.get('status');
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    const IST = "'+5 hours', '+30 minutes'";
    const EFFECTIVE_DATE = `COALESCE(NULLIF(order_date, ''), date(captured_at, ${IST}))`;
    let dateWhere;
    const params = [];

    if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
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
    sql += ' ORDER BY order_date DESC, order_time DESC, captured_at DESC LIMIT 500';

    const { results } = await db.prepare(sql).bind(...params).all();
    const detailMap = await latestZomatoDetailMap(db);
    const baseRows = results || [];
    const seen = new Set(baseRows.map(r => `${r.platform}:${r.order_id}`));

    const enriched = baseRows.map(row => enrichOwnerOrder(row, detailMap.get(String(row.order_id))));

    // Include rich detail rows even if the base table missed the list-history
    // row. This happens when only an order detail API call was captured.
    for (const detail of detailMap.values()) {
      const key = `zomato:${detail.order_id}`;
      if (seen.has(key)) continue;
      if (platform && platform !== 'all' && platform !== 'zomato') continue;
      if (brand && brand !== 'all' && detail.brand !== brand) continue;
      const d = detail.order_date || (detail.created_at ? extractIstDate(detail.created_at) : null);
      if (!dateMatchesFilter(d, detail.captured_at, { date, fromParam, toParam })) continue;
      enriched.push(enrichOwnerOrder({
        platform: 'zomato',
        brand: detail.brand,
        order_id: detail.order_id,
        status: detail.status,
        order_time: detail.order_time,
        order_date: detail.order_date,
        customer_name: detail.customer_name,
        items: detail.items,
        order_value: detail.order_value,
        net_payout: null,
        fees: null,
        issues: detail.issues,
        rating: null,
        outlet_name: detail.outlet_name,
        captured_at: detail.captured_at,
      }, detail));
    }

    let orders = enriched.sort(compareOwnerOrders);
    if (status && status !== 'all') orders = orders.filter(o => o.status_group === status);

    const summary = ownerOrderSummary(orders);
    return new Response(JSON.stringify({
      ok: true,
      action: 'owner-orders',
      date_filter: date,
      generated_at: new Date().toISOString(),
      summary,
      orders,
      data_notes: {
        discount: 'Populated when a Zomato order-detail response has been captured. List history alone usually does not expose discount lines.',
        rating: 'Order-level star rating is shown only when the partner API exposes it. Aggregate outlet ratings are separate from order history.',
      },
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

  // --- COA ENTITIES: Ring 1 closed coordinate space for aggregator operations ---
  if (action === 'coa-entities') {
    await ensureAggregatorCoaRing1(db);
    const entities = await readAggregatorCoaRing1(db);
    return new Response(JSON.stringify({
      ok: true,
      action: 'coa-entities',
      doctrine: 'COA Ring 1 - Entity. Closed sets only; no free-text operational state.',
      seed_version: AGGREGATOR_COA_RING1_VERSION,
      generated_at: new Date().toISOString(),
      entities,
      cardinality: {
        brands: entities.brands.length,
        outlets: entities.outlets.length,
        platforms: entities.platforms.length,
        platform_outlets: entities.platform_outlets.length,
        pull_sources: entities.pull_sources.length,
        valid_platform_outlet_pull_pairs: validPlatformOutletPullPairs(entities).length,
        health_states: entities.health_states.length,
        issue_codes: entities.issue_codes.length,
        session_slots: entities.session_slots.length,
      },
      valid_platform_outlet_pull_pairs: validPlatformOutletPullPairs(entities),
      constraints: [
        'Only he/nch brands are valid in this ring.',
        'Only swiggy/zomato delivery platforms are valid in this ring.',
        'Swiggy outlet ids are fixed: HE=1342888, NCH=1342887.',
        'Zomato outlet ids are fixed: HE=22632449, NCH=22632430.',
        'Partner auth secrets are not stored in Ring 1 tables.',
        'A session slot can be expired/stale/valid, but the secret material lives outside D1.',
        'Price/offer/POS/Odoo mutation is outside this ring.',
      ],
    }), { headers });
  }

  // --- COA ACTIONS: Ring 2 pull/health ledger over the Ring 1 coordinate space ---
  if (action === 'coa-actions') {
    await ensureAggregatorCoaRing2(db);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const [runs, attempts, health] = await Promise.all([
      db.prepare(`SELECT * FROM aggregator_coa_pull_run ORDER BY started_at DESC LIMIT ?`).bind(limit).all(),
      db.prepare(`SELECT * FROM aggregator_coa_pull_attempt ORDER BY started_at DESC LIMIT ?`).bind(limit * 4).all(),
      db.prepare(`
        SELECT h.*, po.canonical_code AS platform_outlet_canonical, ps.canonical_code AS pull_source_canonical,
               po.partner_outlet_name, ps.source_kind, ps.freshness_sla_minutes
        FROM aggregator_coa_coordinate_health h
        LEFT JOIN aggregator_coa_platform_outlet po ON po.code = h.platform_outlet_code
        LEFT JOIN aggregator_coa_pull_source ps ON ps.code = h.pull_source_code
        ORDER BY h.platform_code, h.brand_code, h.pull_source_code
      `).all(),
    ]);
    return new Response(JSON.stringify({
      ok: true,
      action: 'coa-actions',
      doctrine: 'COA Ring 2 - Action. Every pull attempt is a trajectory over a closed Ring 1 coordinate.',
      seed_version: AGGREGATOR_COA_RING2_VERSION,
      generated_at: new Date().toISOString(),
      latest_runs: (runs.results || []).map(parseRing2JsonColumns),
      latest_attempts: (attempts.results || []).map(parseRing2JsonColumns),
      coordinate_health: (health.results || []).map(parseRing2JsonColumns),
      trigger: {
        method: 'POST',
        body: {
          type: 'coa_ring2_pull',
          mode: 'live',
          from: 'YYYY-MM-DD',
          to: 'YYYY-MM-DD',
          max_pages: 3,
          notify: false,
        },
      },
      constraints: [
        'Ring 2 writes only HN D1 order/health/action rows.',
        'No Swiggy/Zomato portal configuration is changed.',
        'No POS/Odoo/ad/price/offer mutation is possible from this action.',
        'Partner session material must live in Cloudflare secrets, not D1.',
        'WABA owner alert sends only when notify=true and a critical session/parser failure is detected.',
      ],
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

  // --- DINE-HEALTH: pipeline status for dine-in platforms (zomato_dining, swiggy_dineout, eazydiner) ---
  if (action === 'dine-health') {
    const { results } = await db.prepare(`
      SELECT platform, MAX(captured_at) AS last_seen, COUNT(*) AS total_snapshots
      FROM aggregator_snapshots
      WHERE platform IN ('zomato_dining', 'swiggy_dineout', 'eazydiner')
      GROUP BY platform
    `).all();

    const now = Date.now();
    const STALE_MS = 15 * 60 * 1000;
    const expected = ['zomato_dining', 'swiggy_dineout', 'eazydiner'];
    const byPlatform = Object.fromEntries(results.map(r => [r.platform, r]));

    const platforms = expected.map(p => {
      const row = byPlatform[p];
      const lastMs = row?.last_seen ? new Date(row.last_seen).getTime() : null;
      const staleMs = lastMs ? now - lastMs : null;
      return {
        platform: p,
        last_seen: row?.last_seen || null,
        stale_minutes: staleMs != null ? Math.round(staleMs / 60000) : null,
        total_snapshots: row?.total_snapshots || 0,
        status: !row ? 'never' : staleMs > STALE_MS ? 'stale' : 'live',
      };
    });

    return new Response(JSON.stringify({ ok: true, action: 'dine-health', platforms, checked_at: new Date().toISOString() }), { headers });
  }

  // --- DINE-SUMMARY: latest snapshot per dine platform + outlet ---
  if (action === 'dine-summary') {
    const { results } = await db.prepare(`
      SELECT a.platform, a.brand, a.outlet_id, a.metric_type, a.data, a.captured_at
      FROM aggregator_snapshots a
      INNER JOIN (
        SELECT platform, outlet_id, metric_type, MAX(captured_at) AS max_ts
        FROM aggregator_snapshots
        WHERE platform IN ('zomato_dining', 'swiggy_dineout', 'eazydiner')
        GROUP BY platform, outlet_id, metric_type
      ) latest ON a.platform = latest.platform
        AND a.outlet_id = latest.outlet_id
        AND a.metric_type = latest.metric_type
        AND a.captured_at = latest.max_ts
      ORDER BY a.platform, a.outlet_id, a.captured_at DESC
      LIMIT 60
    `).all();

    const byPlatform = {};
    for (const row of results) {
      if (!byPlatform[row.platform]) byPlatform[row.platform] = [];
      byPlatform[row.platform].push({ ...row, data: safeJsonParse(row.data) });
    }
    return new Response(JSON.stringify({ ok: true, action: 'dine-summary', platforms: byPlatform, ts: new Date().toISOString() }), { headers });
  }

  // --- DINE-ATTRIBUTION: best-effort May 2026 revenue inferred from DOM scraping ---
  if (action === 'dine-attribution') {
    const { results } = await db.prepare(`
      SELECT platform, outlet_id, data, captured_at
      FROM aggregator_snapshots
      WHERE platform IN ('zomato_dining', 'swiggy_dineout', 'eazydiner')
        AND captured_at >= '2026-05-01T00:00:00'
      ORDER BY platform, outlet_id, captured_at DESC
      LIMIT 500
    `).all();

    const totals = {};
    for (const row of results) {
      const d = safeJsonParse(row.data);
      const amounts = Array.isArray(d?.rupee_amounts) ? d.rupee_amounts : [];
      const maxAmt = amounts.length ? Math.max(...amounts) : 0;
      const key = `${row.platform}::${row.outlet_id}`;
      if (!totals[key]) totals[key] = { platform: row.platform, outlet_id: row.outlet_id, max_inferred: 0, snapshots: 0 };
      totals[key].snapshots++;
      if (maxAmt > totals[key].max_inferred) totals[key].max_inferred = maxAmt;
    }

    const rows = Object.values(totals);
    const grandTotal = rows.reduce((s, r) => s + r.max_inferred, 0);
    return new Response(JSON.stringify({
      ok: true, action: 'dine-attribution', grand_total_inferred: grandTotal, by_platform: rows,
      note: 'Inferred from DOM rupee amounts — manual attribution in may_layers is authoritative',
      ts: new Date().toISOString(),
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
    const HE_OUTLET_SWIGGY = '1342888';
    const NCH_OUTLET_SWIGGY = '1342887';
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

    // ---- SWIGGY AGGREGATE FALLBACK — REMOVED 2026-05-10 ----
    // Previously surfaced reports_swiggy_{period} (brand='all' = combined HE+NCH)
    // when per-order data was sparse. STRICT HE-ONLY POLICY prohibits any
    // combined data on a brand-specific endpoint, even labelled. Removed.
    // The capture_health field above signals the gap; UI shows banner only.
    // Per-outlet Swiggy capture is being rebuilt via the Finance-page DOM
    // path (work in progress 2026-05-10).

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

  return new Response(JSON.stringify({ error: 'unknown action', valid: ['orders', 'owner-orders', 'latest', 'stats', 'coa-entities', 'coa-actions', 'finance', 'health', 'snapshots', 'reviews', 'parsed', 'day-orders', 'order-detail', 'dine-health', 'dine-summary', 'dine-attribution'] }), { status: 400, headers });
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return s; } }

const AGGREGATOR_COA_RING1_VERSION = '2026-05-25-ring1-v1';
const AGGREGATOR_COA_RING2_VERSION = '2026-05-25-ring2-v1';

const AGGREGATOR_COA_RING1_SEED = {
  brands: [
    ['he', 'HN-BRAND-HE', 'Hamza Express', 'HN Hotels Private Limited'],
    ['nch', 'HN-BRAND-NCH', 'Nawabi Chai House', 'HN Hotels Private Limited'],
  ],
  outlets: [
    ['he_shivajinagar', 'he', 'HN-OUTLET-HE-SHIVAJINAGAR', 'Hamza Express Shivajinagar', 'Shivajinagar', 'test.hamzahotel.com'],
    ['nch_shivajinagar', 'nch', 'HN-OUTLET-NCH-SHIVAJINAGAR', 'Nawabi Chai House Shivajinagar', 'Shivajinagar', 'ops.hamzahotel.com'],
  ],
  platforms: [
    ['swiggy', 'AGG-PLATFORM-SWIGGY', 'Swiggy Partner', 'access_token'],
    ['zomato', 'AGG-PLATFORM-ZOMATO', 'Zomato Merchant', 'cookie_csrf'],
  ],
  platform_outlets: [
    ['swiggy_he_1342888', 'AGG-OUTLET-SWIGGY-HE-1342888', 'he', 'he_shivajinagar', 'swiggy', '1342888', 'Hamza Express'],
    ['swiggy_nch_1342887', 'AGG-OUTLET-SWIGGY-NCH-1342887', 'nch', 'nch_shivajinagar', 'swiggy', '1342887', 'Nawabi Chai House'],
    ['zomato_he_22632449', 'AGG-OUTLET-ZOMATO-HE-22632449', 'he', 'he_shivajinagar', 'zomato', '22632449', 'Hamza Express'],
    ['zomato_nch_22632430', 'AGG-OUTLET-ZOMATO-NCH-22632430', 'nch', 'nch_shivajinagar', 'zomato', '22632430', 'Nawabi Chai House'],
  ],
  pull_sources: [
    ['swiggy_fetch_orders', 'AGG-PULL-SWIGGY-FETCH-ORDERS', 'swiggy', 'current_orders', 'POST', 'rms.swiggy.com/orders/v1/fetchOrders', 2],
    ['swiggy_history', 'AGG-PULL-SWIGGY-HISTORY', 'swiggy', 'history_orders', 'GET', 'rms.swiggy.com/orders/v1/history', 10],
    ['zomato_history_v2', 'AGG-PULL-ZOMATO-HISTORY-V2', 'zomato', 'history_orders', 'POST', 'api.zomato.com/merchant-gw/web/order/history/get-all-v2', 10],
    ['zomato_order_detail', 'AGG-PULL-ZOMATO-ORDER-DETAIL', 'zomato', 'order_detail', 'GET', 'zomato merchant order detail payload', 60],
  ],
  health_states: [
    ['ok', 'AGG-HEALTH-OK', 'ok', 1, 0, 'Last pull succeeded within SLA.'],
    ['not_configured', 'AGG-HEALTH-NOT-CONFIGURED', 'warn', 1, 0, 'Session slot exists but no validated auth material is configured.'],
    ['stale', 'AGG-HEALTH-STALE', 'warn', 1, 1, 'Last successful pull exceeded freshness SLA.'],
    ['unauthorized', 'AGG-HEALTH-UNAUTHORIZED', 'critical', 1, 1, 'Partner API returned unauthorized or forbidden. Session refresh required.'],
    ['parser_failed', 'AGG-HEALTH-PARSER-FAILED', 'critical', 1, 1, 'Partner payload shape changed or normalization failed.'],
    ['empty_response', 'AGG-HEALTH-EMPTY-RESPONSE', 'warn', 1, 0, 'Partner API returned no orders/data for the requested coordinate.'],
    ['partial', 'AGG-HEALTH-PARTIAL', 'warn', 1, 1, 'At least one platform/outlet/source coordinate failed while another succeeded.'],
  ],
  issue_codes: [
    ['missed_acceptance', 'AGG-ISSUE-MISSED-ACCEPTANCE', 'critical', null, 1, 'Order was not accepted before timeout.'],
    ['rejected_by_restaurant', 'AGG-ISSUE-REJECTED-BY-RESTAURANT', 'critical', null, 1, 'Restaurant rejected the order.'],
    ['cancelled', 'AGG-ISSUE-CANCELLED', 'warn', null, 1, 'Order was cancelled.'],
    ['order_ready_not_marked', 'AGG-ISSUE-ORDER-READY-NOT-MARKED', 'warn', 'zomato', 1, 'Food was ready but not marked ready in partner portal.'],
    ['handover_delay', 'AGG-ISSUE-HANDOVER-DELAY', 'warn', null, 1, 'Rider handover exceeded expected time.'],
    ['food_prep_delay', 'AGG-ISSUE-FOOD-PREP-DELAY', 'warn', null, 1, 'Food preparation was delayed.'],
    ['session_expired', 'AGG-ISSUE-SESSION-EXPIRED', 'critical', null, 1, 'Partner API session expired. Refresh cURL required.'],
  ],
  session_slots: [
    ['swiggy_partner_session', 'AGG-SESSION-SWIGGY-PARTNER', 'swiggy', 'access_token', 'cloudflare_secret', 'not_configured', 'Swiggy frontend API access token slot.'],
    ['zomato_partner_session', 'AGG-SESSION-ZOMATO-PARTNER', 'zomato', 'cookie_csrf', 'cloudflare_secret', 'not_configured', 'Zomato cookie plus CSRF session slot.'],
  ],
};

async function ensureAggregatorCoaRing1(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS aggregator_coa_brand (
      code TEXT PRIMARY KEY CHECK (code IN ('he', 'nch')),
      canonical_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      legal_entity TEXT NOT NULL DEFAULT 'HN Hotels Private Limited',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_outlet (
      code TEXT PRIMARY KEY,
      brand_code TEXT NOT NULL REFERENCES aggregator_coa_brand(code),
      canonical_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      locality TEXT NOT NULL,
      production_pos_host TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_platform (
      code TEXT PRIMARY KEY CHECK (code IN ('swiggy', 'zomato')),
      canonical_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      auth_shape TEXT NOT NULL CHECK (auth_shape IN ('access_token', 'cookie_csrf')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_platform_outlet (
      code TEXT PRIMARY KEY,
      canonical_code TEXT NOT NULL UNIQUE,
      brand_code TEXT NOT NULL REFERENCES aggregator_coa_brand(code),
      outlet_code TEXT NOT NULL REFERENCES aggregator_coa_outlet(code),
      platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
      partner_outlet_id TEXT NOT NULL,
      partner_outlet_name TEXT NOT NULL,
      production_role TEXT NOT NULL DEFAULT 'delivery_orders',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform_code, partner_outlet_id),
      CHECK (code IN ('swiggy_he_1342888','swiggy_nch_1342887','zomato_he_22632449','zomato_nch_22632430'))
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_pull_source (
      code TEXT PRIMARY KEY,
      canonical_code TEXT NOT NULL UNIQUE,
      platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('current_orders', 'history_orders', 'order_detail')),
      method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
      endpoint_family TEXT NOT NULL,
      replayable INTEGER NOT NULL DEFAULT 1 CHECK (replayable IN (0, 1)),
      freshness_sla_minutes INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_health_state (
      code TEXT PRIMARY KEY,
      canonical_code TEXT NOT NULL UNIQUE,
      severity TEXT NOT NULL CHECK (severity IN ('ok', 'warn', 'critical')),
      owner_visible INTEGER NOT NULL DEFAULT 1 CHECK (owner_visible IN (0, 1)),
      waba_alert_allowed INTEGER NOT NULL DEFAULT 0 CHECK (waba_alert_allowed IN (0, 1)),
      description TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_issue_code (
      code TEXT PRIMARY KEY,
      canonical_code TEXT NOT NULL UNIQUE,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
      platform_code TEXT REFERENCES aggregator_coa_platform(code),
      owner_visible INTEGER NOT NULL DEFAULT 1 CHECK (owner_visible IN (0, 1)),
      description TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_session_slot (
      code TEXT PRIMARY KEY,
      canonical_code TEXT NOT NULL UNIQUE,
      platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
      auth_shape TEXT NOT NULL CHECK (auth_shape IN ('access_token', 'cookie_csrf')),
      secret_storage TEXT NOT NULL CHECK (secret_storage IN ('cloudflare_secret', 'local_curl_file', 'manual_refresh_only')),
      state_code TEXT NOT NULL DEFAULT 'not_configured' REFERENCES aggregator_coa_health_state(code),
      last_validated_at TEXT,
      expires_at TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agg_coa_platform_outlet_brand ON aggregator_coa_platform_outlet(brand_code, platform_code)`,
    `CREATE INDEX IF NOT EXISTS idx_agg_coa_pull_platform ON aggregator_coa_pull_source(platform_code, source_kind)`,
  ];

  for (const sql of statements) await db.prepare(sql).run();
  await seedAggregatorCoaRing1(db);
}

async function seedAggregatorCoaRing1(db) {
  for (const row of AGGREGATOR_COA_RING1_SEED.brands) {
    await db.prepare(`
      INSERT INTO aggregator_coa_brand (code, canonical_code, display_name, legal_entity)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, display_name=excluded.display_name, legal_entity=excluded.legal_entity, active=1
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.outlets) {
    await db.prepare(`
      INSERT INTO aggregator_coa_outlet (code, brand_code, canonical_code, display_name, locality, production_pos_host)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET brand_code=excluded.brand_code, canonical_code=excluded.canonical_code, display_name=excluded.display_name, locality=excluded.locality, production_pos_host=excluded.production_pos_host, active=1
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.platforms) {
    await db.prepare(`
      INSERT INTO aggregator_coa_platform (code, canonical_code, display_name, auth_shape)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, display_name=excluded.display_name, auth_shape=excluded.auth_shape, active=1
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.platform_outlets) {
    await db.prepare(`
      INSERT INTO aggregator_coa_platform_outlet (code, canonical_code, brand_code, outlet_code, platform_code, partner_outlet_id, partner_outlet_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, brand_code=excluded.brand_code, outlet_code=excluded.outlet_code, platform_code=excluded.platform_code, partner_outlet_id=excluded.partner_outlet_id, partner_outlet_name=excluded.partner_outlet_name, active=1
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.pull_sources) {
    await db.prepare(`
      INSERT INTO aggregator_coa_pull_source (code, canonical_code, platform_code, source_kind, method, endpoint_family, freshness_sla_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, platform_code=excluded.platform_code, source_kind=excluded.source_kind, method=excluded.method, endpoint_family=excluded.endpoint_family, freshness_sla_minutes=excluded.freshness_sla_minutes, active=1
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.health_states) {
    await db.prepare(`
      INSERT INTO aggregator_coa_health_state (code, canonical_code, severity, owner_visible, waba_alert_allowed, description)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, severity=excluded.severity, owner_visible=excluded.owner_visible, waba_alert_allowed=excluded.waba_alert_allowed, description=excluded.description
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.issue_codes) {
    await db.prepare(`
      INSERT INTO aggregator_coa_issue_code (code, canonical_code, severity, platform_code, owner_visible, description)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, severity=excluded.severity, platform_code=excluded.platform_code, owner_visible=excluded.owner_visible, description=excluded.description
    `).bind(...row).run();
  }
  for (const row of AGGREGATOR_COA_RING1_SEED.session_slots) {
    await db.prepare(`
      INSERT INTO aggregator_coa_session_slot (code, canonical_code, platform_code, auth_shape, secret_storage, state_code, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET canonical_code=excluded.canonical_code, platform_code=excluded.platform_code, auth_shape=excluded.auth_shape, secret_storage=excluded.secret_storage, notes=excluded.notes, updated_at=datetime('now')
    `).bind(...row).run();
  }
}

async function readAggregatorCoaRing1(db) {
  const [
    brands, outlets, platforms, platformOutlets, pullSources,
    healthStates, issueCodes, sessionSlots,
  ] = await Promise.all([
    db.prepare(`SELECT * FROM aggregator_coa_brand ORDER BY code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_outlet ORDER BY code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_platform ORDER BY code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_platform_outlet ORDER BY platform_code, brand_code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_pull_source ORDER BY platform_code, source_kind, code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_health_state ORDER BY severity, code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_issue_code ORDER BY severity, code`).all(),
    db.prepare(`SELECT * FROM aggregator_coa_session_slot ORDER BY platform_code, code`).all(),
  ]);
  return {
    brands: brands.results || [],
    outlets: outlets.results || [],
    platforms: platforms.results || [],
    platform_outlets: platformOutlets.results || [],
    pull_sources: pullSources.results || [],
    health_states: healthStates.results || [],
    issue_codes: issueCodes.results || [],
    session_slots: sessionSlots.results || [],
  };
}

function validPlatformOutletPullPairs(entities) {
  const pairs = [];
  for (const po of entities.platform_outlets || []) {
    for (const src of entities.pull_sources || []) {
      if (src.platform_code !== po.platform_code) continue;
      pairs.push({
        coordinate: `${po.canonical_code}/${src.canonical_code}`,
        platform_outlet_code: po.code,
        pull_source_code: src.code,
        brand_code: po.brand_code,
        platform_code: po.platform_code,
        partner_outlet_id: po.partner_outlet_id,
        source_kind: src.source_kind,
        freshness_sla_minutes: src.freshness_sla_minutes,
      });
    }
  }
  return pairs;
}

async function ensureAggregatorCoaRing2(db) {
  await ensureAggregatorCoaRing1(db);
  const statements = [
    `CREATE TABLE IF NOT EXISTS aggregator_coa_pull_run (
      run_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live', 'backfill')),
      triggered_by TEXT NOT NULL DEFAULT 'manual',
      requested_from TEXT,
      requested_to TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
      attempts_total INTEGER NOT NULL DEFAULT 0,
      attempts_ok INTEGER NOT NULL DEFAULT 0,
      orders_seen INTEGER NOT NULL DEFAULT 0,
      orders_upserted INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_pull_attempt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES aggregator_coa_pull_run(run_id),
      coordinate TEXT NOT NULL,
      platform_outlet_code TEXT NOT NULL REFERENCES aggregator_coa_platform_outlet(code),
      pull_source_code TEXT NOT NULL REFERENCES aggregator_coa_pull_source(code),
      platform_code TEXT NOT NULL,
      brand_code TEXT NOT NULL,
      partner_outlet_id TEXT NOT NULL,
      status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
      http_status INTEGER,
      rows_seen INTEGER NOT NULL DEFAULT 0,
      rows_upserted INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      response_sample TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS aggregator_coa_coordinate_health (
      platform_outlet_code TEXT NOT NULL REFERENCES aggregator_coa_platform_outlet(code),
      pull_source_code TEXT NOT NULL REFERENCES aggregator_coa_pull_source(code),
      coordinate TEXT NOT NULL,
      platform_code TEXT NOT NULL,
      brand_code TEXT NOT NULL,
      partner_outlet_id TEXT NOT NULL,
      status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_http_status INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_rows_seen INTEGER NOT NULL DEFAULT 0,
      last_rows_upserted INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      waba_alert_last_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform_outlet_code, pull_source_code)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agg_coa_attempt_run ON aggregator_coa_pull_attempt(run_id, started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agg_coa_attempt_coord ON aggregator_coa_pull_attempt(platform_outlet_code, pull_source_code, started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agg_coa_health_status ON aggregator_coa_coordinate_health(status_code, updated_at DESC)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();

  const entities = await readAggregatorCoaRing1(db);
  for (const pair of validPlatformOutletPullPairs(entities)) {
    await db.prepare(`
      INSERT INTO aggregator_coa_coordinate_health
        (platform_outlet_code, pull_source_code, coordinate, platform_code, brand_code, partner_outlet_id, status_code, last_error)
      VALUES (?, ?, ?, ?, ?, ?, 'not_configured', 'No pull attempt has run for this coordinate yet.')
      ON CONFLICT(platform_outlet_code, pull_source_code) DO UPDATE SET
        coordinate=excluded.coordinate,
        platform_code=excluded.platform_code,
        brand_code=excluded.brand_code,
        partner_outlet_id=excluded.partner_outlet_id,
        updated_at=datetime('now')
    `).bind(
      pair.platform_outlet_code,
      pair.pull_source_code,
      pair.coordinate,
      pair.platform_code,
      pair.brand_code,
      pair.partner_outlet_id
    ).run();
  }
}

function parseRing2JsonColumns(row) {
  if (!row) return row;
  return {
    ...row,
    summary_json: row.summary_json ? safeJsonParse(row.summary_json) : row.summary_json,
    response_sample: row.response_sample ? safeJsonParse(row.response_sample) : row.response_sample,
  };
}

async function executeAggregatorCoaRing2Pull(db, env, body = {}) {
  await ensureAggregatorCoaRing2(db);
  const entities = await readAggregatorCoaRing1(db);
  const pairs = validPlatformOutletPullPairs(entities);
  const mode = body.mode === 'backfill' ? 'backfill' : body.mode === 'dry_run' ? 'dry_run' : 'live';
  const from = validIsoDate(body.from) ? body.from : todayIstDate();
  const to = validIsoDate(body.to) ? body.to : from;
  const maxPages = Math.max(1, Math.min(parseInt(body.max_pages || '3', 10) || 3, 10));
  const limit = Math.max(1, Math.min(parseInt(body.limit || '50', 10) || 50, 100));
  const runId = `agg-ring2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();

  await db.prepare(`
    INSERT INTO aggregator_coa_pull_run
      (run_id, mode, triggered_by, requested_from, requested_to, started_at, status_code)
    VALUES (?, ?, ?, ?, ?, ?, 'stale')
  `).bind(runId, mode, body.triggered_by || 'manual', from, to, startedAt).run();

  const filterPlatform = body.platform && body.platform !== 'all' ? String(body.platform) : null;
  const filterBrand = body.brand && body.brand !== 'all' ? String(body.brand) : null;
  const filterSource = body.source && body.source !== 'all' ? String(body.source) : null;
  const attempts = [];

  for (const pair of pairs) {
    if (filterPlatform && pair.platform_code !== filterPlatform) continue;
    if (filterBrand && pair.brand_code !== filterBrand) continue;
    if (filterSource && pair.pull_source_code !== filterSource && pair.source_kind !== filterSource) continue;
    attempts.push(await runAggregatorPullAttempt(db, env, pair, { runId, mode, from, to, maxPages, limit, notify: body.notify === true }));
  }

  const attemptsOk = attempts.filter(a => a.status_code === 'ok' || a.status_code === 'empty_response').length;
  const critical = attempts.filter(a => ['unauthorized', 'parser_failed'].includes(a.status_code));
  const runnable = attempts.filter(a => a.status_code !== 'not_configured');
  const statusCode = critical.length ? 'partial' : runnable.length && attemptsOk === runnable.length ? 'ok' : 'partial';
  const ordersSeen = attempts.reduce((sum, a) => sum + (a.rows_seen || 0), 0);
  const ordersUpserted = attempts.reduce((sum, a) => sum + (a.rows_upserted || 0), 0);
  const completedAt = new Date().toISOString();
  const summary = {
    pairs_requested: attempts.length,
    attempts_ok: attemptsOk,
    critical_failures: critical.length,
    not_configured: attempts.filter(a => a.status_code === 'not_configured').length,
    source_status_counts: countBy(attempts, 'status_code'),
  };

  await db.prepare(`
    UPDATE aggregator_coa_pull_run
    SET completed_at=?, status_code=?, attempts_total=?, attempts_ok=?, orders_seen=?, orders_upserted=?, summary_json=?
    WHERE run_id=?
  `).bind(completedAt, statusCode, attempts.length, attemptsOk, ordersSeen, ordersUpserted, JSON.stringify(summary), runId).run();

  return {
    ok: critical.length === 0,
    action: 'coa_ring2_pull',
    doctrine: 'COA Ring 2 - Action. Pull attempts over Ring 1 coordinates.',
    seed_version: AGGREGATOR_COA_RING2_VERSION,
    run_id: runId,
    mode,
    requested_from: from,
    requested_to: to,
    status_code: statusCode,
    summary,
    attempts,
    mutation_boundary: 'HN D1 order/action/health rows only. No partner portal, POS, Odoo, price, or offer mutation.',
  };
}

async function runAggregatorPullAttempt(db, env, pair, opts) {
  const startedAt = new Date().toISOString();
  let result;
  try {
    if (pair.platform_code === 'swiggy' && pair.pull_source_code === 'swiggy_history') {
      result = await pullSwiggyHistoryCoordinate(env, pair, opts);
    } else if (pair.platform_code === 'swiggy' && pair.pull_source_code === 'swiggy_fetch_orders') {
      result = await pullSwiggyFetchCoordinate(env, pair);
    } else if (pair.platform_code === 'zomato' && pair.pull_source_code === 'zomato_history_v2') {
      result = await pullZomatoHistoryCoordinate(env, pair, opts);
    } else {
      result = {
        status_code: 'not_configured',
        rows_seen: 0,
        rows: [],
        error: `${pair.pull_source_code} is defined in Ring 1 but automatic pull is not configured in Ring 2 yet.`,
      };
    }
  } catch (err) {
    result = { status_code: 'parser_failed', rows_seen: 0, rows: [], error: err.message };
  }

  if (result.rows?.length && opts.mode !== 'dry_run') {
    result.rows_upserted = await upsertOrders(db, result.rows);
  } else {
    result.rows_upserted = 0;
  }

  const completedAt = new Date().toISOString();
  const sample = result.sample || (result.rows?.length ? result.rows.slice(0, 3).map(r => ({
    order_id: r.order_id, status: r.status, order_date: r.order_date, order_value: r.order_value,
  })) : null);

  await db.prepare(`
    INSERT INTO aggregator_coa_pull_attempt
      (run_id, coordinate, platform_outlet_code, pull_source_code, platform_code, brand_code, partner_outlet_id,
       status_code, http_status, rows_seen, rows_upserted, started_at, completed_at, error, response_sample)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    opts.runId,
    pair.coordinate,
    pair.platform_outlet_code,
    pair.pull_source_code,
    pair.platform_code,
    pair.brand_code,
    pair.partner_outlet_id,
    result.status_code,
    result.http_status || null,
    result.rows_seen || 0,
    result.rows_upserted || 0,
    startedAt,
    completedAt,
    result.error || null,
    sample ? JSON.stringify(sample).slice(0, 2000) : null
  ).run();

  await updateCoordinateHealth(db, pair, result, completedAt);

  const alert = await maybeSendAggregatorSessionAlert(db, env, pair, result, opts);
  return {
    coordinate: pair.coordinate,
    platform_outlet_code: pair.platform_outlet_code,
    pull_source_code: pair.pull_source_code,
    platform: pair.platform_code,
    brand: pair.brand_code,
    partner_outlet_id: pair.partner_outlet_id,
    status_code: result.status_code,
    http_status: result.http_status || null,
    rows_seen: result.rows_seen || 0,
    rows_upserted: result.rows_upserted || 0,
    error: result.error || null,
    alert,
  };
}

async function updateCoordinateHealth(db, pair, result, atIso) {
  const ok = result.status_code === 'ok' || result.status_code === 'empty_response';
  await db.prepare(`
    INSERT INTO aggregator_coa_coordinate_health
      (platform_outlet_code, pull_source_code, coordinate, platform_code, brand_code, partner_outlet_id,
       status_code, last_attempt_at, last_success_at, last_http_status, consecutive_failures,
       last_rows_seen, last_rows_upserted, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(platform_outlet_code, pull_source_code) DO UPDATE SET
      coordinate=excluded.coordinate,
      platform_code=excluded.platform_code,
      brand_code=excluded.brand_code,
      partner_outlet_id=excluded.partner_outlet_id,
      status_code=excluded.status_code,
      last_attempt_at=excluded.last_attempt_at,
      last_success_at=CASE WHEN excluded.last_success_at IS NOT NULL THEN excluded.last_success_at ELSE last_success_at END,
      last_http_status=excluded.last_http_status,
      consecutive_failures=CASE WHEN excluded.last_success_at IS NOT NULL THEN 0 ELSE consecutive_failures + 1 END,
      last_rows_seen=excluded.last_rows_seen,
      last_rows_upserted=excluded.last_rows_upserted,
      last_error=excluded.last_error,
      updated_at=datetime('now')
  `).bind(
    pair.platform_outlet_code,
    pair.pull_source_code,
    pair.coordinate,
    pair.platform_code,
    pair.brand_code,
    pair.partner_outlet_id,
    result.status_code,
    atIso,
    ok ? atIso : null,
    result.http_status || null,
    ok ? 0 : 1,
    result.rows_seen || 0,
    result.rows_upserted || 0,
    result.error || null
  ).run();

  const sessionCode = pair.platform_code === 'swiggy' ? 'swiggy_partner_session' : 'zomato_partner_session';
  const sessionState = ['unauthorized', 'parser_failed'].includes(result.status_code)
    ? result.status_code
    : (ok ? 'ok' : null);
  if (sessionState) {
    await db.prepare(`
      UPDATE aggregator_coa_session_slot
      SET state_code=?, last_validated_at=CASE WHEN ?='ok' THEN ? ELSE last_validated_at END, updated_at=datetime('now')
      WHERE code=?
    `).bind(sessionState, sessionState, atIso, sessionCode).run();
  }
}

async function maybeSendAggregatorSessionAlert(db, env, pair, result, opts) {
  if (!opts.notify) return { skipped: true, reason: 'notify_false' };
  if (!['unauthorized', 'parser_failed'].includes(result.status_code)) return { skipped: true, reason: 'not_critical' };
  if (!env.ALERT_PHONE) return { skipped: true, reason: 'no_ALERT_PHONE' };

  const row = await db.prepare(`
    SELECT waba_alert_last_at
    FROM aggregator_coa_coordinate_health
    WHERE platform_outlet_code=? AND pull_source_code=?
  `).bind(pair.platform_outlet_code, pair.pull_source_code).first();
  if (row?.waba_alert_last_at && Date.now() - new Date(row.waba_alert_last_at).getTime() < 30 * 60_000) {
    return { skipped: true, reason: 'suppressed_30m' };
  }

  const resultSend = await sendWaba(env, {
    brand: 'sparksol',
    phone: env.ALERT_PHONE,
    template: 'aggregator_session_expired_alert_v1',
    language: 'en',
    vars: [
      pair.platform_code.toUpperCase(),
      `${pair.brand_code.toUpperCase()} ${pair.partner_outlet_id}`,
      result.status_code,
      'Refresh partner cURL/session in aggregator dashboard',
    ],
  });
  await db.prepare(`
    UPDATE aggregator_coa_coordinate_health
    SET waba_alert_last_at=?, updated_at=datetime('now')
    WHERE platform_outlet_code=? AND pull_source_code=?
  `).bind(new Date().toISOString(), pair.platform_outlet_code, pair.pull_source_code).run();
  return { sent: resultSend.ok, status: resultSend.status, provider_msg_id: resultSend.provider_msg_id || null };
}

async function pullSwiggyHistoryCoordinate(env, pair, opts) {
  const token = env.AGG_SWIGGY_ACCESS_TOKEN
    || parseCurlText(env.AGG_SWIGGY_FETCH_CURL || env.AGG_SWIGGY_HISTORY_CURL || '')?.headers?.accesstoken;
  if (!token) return { status_code: 'not_configured', rows_seen: 0, rows: [], error: 'Missing AGG_SWIGGY_ACCESS_TOKEN or Swiggy cURL secret.' };

  const rows = [];
  let lastHttp = null;
  for (let page = 0; page < opts.maxPages; page++) {
    const offset = page * 20;
    const url = new URL('https://rms.swiggy.com/orders/v1/history');
    url.searchParams.set('limit', '20');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('ordered_time__gte', opts.from);
    url.searchParams.set('ordered_time__lte', opts.to);
    url.searchParams.set('restaurant_id', pair.partner_outlet_id);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        origin: 'https://partner.swiggy.com',
        referer: 'https://partner.swiggy.com/',
        'user-agent': DEFAULT_PARTNER_UA,
        accesstoken: token,
      },
    });
    lastHttp = res.status;
    const payload = await parsePartnerJson(res);
    if (res.status === 401 || res.status === 403) return { status_code: 'unauthorized', http_status: res.status, rows_seen: 0, rows: [], error: 'Swiggy token unauthorized/expired.' };
    if (!res.ok) return { status_code: 'parser_failed', http_status: res.status, rows_seen: 0, rows: [], error: `Swiggy history HTTP ${res.status}`, sample: payload.sample || null };
    if (payload.parse_error) return { status_code: 'parser_failed', http_status: res.status, rows_seen: 0, rows: [], error: 'Swiggy history JSON parse failed.', sample: payload.sample };
    const pageRows = normalizeSwiggyHistory(payload).map(row => ({
      ...row,
      brand: pair.brand_code,
      outlet_name: DIRECT_SWIGGY_OUTLETS[pair.partner_outlet_id]?.outlet_name || row.outlet_name,
    }));
    rows.push(...pageRows);
    const count = pageRows.length;
    const totalCount = (payload.data || []).reduce((sum, block) => sum + Number(block.data?.meta?.total_count || 0), 0);
    if (!count || count < 20 || (totalCount && offset + count >= totalCount)) break;
  }
  return {
    status_code: rows.length ? 'ok' : 'empty_response',
    http_status: lastHttp,
    rows_seen: rows.length,
    rows,
  };
}

async function pullSwiggyFetchCoordinate(env, pair) {
  const parsed = parseCurlText(env.AGG_SWIGGY_FETCH_CURL || '');
  const token = env.AGG_SWIGGY_ACCESS_TOKEN || parsed?.headers?.accesstoken;
  if (!token) return { status_code: 'not_configured', rows_seen: 0, rows: [], error: 'Missing AGG_SWIGGY_FETCH_CURL or AGG_SWIGGY_ACCESS_TOKEN.' };
  const body = parsed?.body || JSON.stringify({ restaurantIds: [Number(pair.partner_outlet_id)] });
  const headers = {
    ...(parsed?.headers || {}),
    accept: '*/*',
    'content-type': 'application/json',
    origin: 'https://partner.swiggy.com',
    referer: 'https://partner.swiggy.com/',
    'user-agent': DEFAULT_PARTNER_UA,
    accesstoken: token,
  };
  cleanReplayHeaders(headers);
  const res = await fetch('https://rms.swiggy.com/orders/v1/fetchOrders', { method: 'POST', headers, body });
  const payload = await parsePartnerJson(res);
  if (res.status === 401 || res.status === 403) return { status_code: 'unauthorized', http_status: res.status, rows_seen: 0, rows: [], error: 'Swiggy fetch token unauthorized/expired.' };
  if (!res.ok || payload.parse_error) return { status_code: 'parser_failed', http_status: res.status, rows_seen: 0, rows: [], error: payload.parse_error ? 'Swiggy fetch JSON parse failed.' : `Swiggy fetch HTTP ${res.status}`, sample: payload.sample || null };
  const rows = normalizeSwiggyFetchOrders(payload)
    .filter(row => row.brand === pair.brand_code || row.outlet_name === DIRECT_SWIGGY_OUTLETS[pair.partner_outlet_id]?.outlet_name);
  return { status_code: rows.length ? 'ok' : 'empty_response', http_status: res.status, rows_seen: rows.length, rows };
}

async function pullZomatoHistoryCoordinate(env, pair, opts) {
  const parsed = parseCurlText(env.AGG_ZOMATO_HISTORY_CURL || '');
  if (!parsed?.url || !parsed?.headers) return { status_code: 'not_configured', rows_seen: 0, rows: [], error: 'Missing AGG_ZOMATO_HISTORY_CURL secret.' };
  const rows = [];
  const baseBody = parsed.body ? safeJsonParse(parsed.body) : {};
  if (!baseBody || typeof baseBody !== 'object') return { status_code: 'parser_failed', rows_seen: 0, rows: [], error: 'AGG_ZOMATO_HISTORY_CURL body is not JSON.' };
  const headers = { ...parsed.headers, accept: 'application/json, text/plain, */*', 'content-type': 'application/json' };
  cleanReplayHeaders(headers);
  let postback = '';
  let lastHttp = null;
  for (let page = 0; page < opts.maxPages; page++) {
    const body = {
      ...baseBody,
      res_Id: pair.partner_outlet_id,
      limit: opts.limit,
      created_at: `${opts.from},${addIsoDays(opts.to, 1)}`,
      postback_params: postback || '',
      get_filters: postback ? false : true,
    };
    const res = await fetch('https://api.zomato.com/merchant-gw/web/order/history/get-all-v2', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    lastHttp = res.status;
    const payload = await parsePartnerJson(res);
    if (res.status === 401 || res.status === 403) return { status_code: 'unauthorized', http_status: res.status, rows_seen: rows.length, rows, error: 'Zomato cookie/CSRF unauthorized/expired.' };
    if (!res.ok) return { status_code: 'parser_failed', http_status: res.status, rows_seen: rows.length, rows, error: `Zomato history HTTP ${res.status}`, sample: payload.sample || null };
    if (payload.parse_error) return { status_code: 'parser_failed', http_status: res.status, rows_seen: rows.length, rows, error: 'Zomato history JSON parse failed.', sample: payload.sample };
    const pageRows = normalizeZomatoOrderHistory(payload).map(row => ({
      ...row,
      brand: pair.brand_code,
      outlet_name: DIRECT_ZOMATO_OUTLETS[pair.partner_outlet_id]?.outlet_name || row.outlet_name,
    }));
    rows.push(...pageRows);
    postback = payload.postbackParams || payload.postback_params || '';
    if (!payload.hasMore || !postback) break;
  }
  return { status_code: rows.length ? 'ok' : 'empty_response', http_status: lastHttp, rows_seen: rows.length, rows };
}

async function parsePartnerJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { parse_error: true, sample: text.slice(0, 300) }; }
}

function parseCurlText(text) {
  if (!text || typeof text !== 'string') return null;
  const url = text.match(/https?:\/\/[^\s'"]+/)?.[0]?.replace(/\\$/, '');
  const headers = {};
  for (const match of text.matchAll(/(?:-H|--header)\s+['"]([^:'"]+):\s*([^'"]*)['"]/g)) {
    headers[match[1].toLowerCase()] = match[2];
  }
  const cookieMatch = text.match(/(?:-b|--cookie)\s+\$?'([^']*)'/s)
    || text.match(/(?:-b|--cookie)\s+"([\s\S]*?)"/s);
  if (cookieMatch && !headers.cookie) headers.cookie = cookieMatch[1].replace(/\\\n/g, '').replace(/\\'/g, "'");
  const dataMatch = text.match(/--data(?:-raw|-binary)?\s+\$?'([^']*)'/s)
    || text.match(/--data(?:-raw|-binary)?\s+"([\s\S]*?)"/s);
  const body = dataMatch ? dataMatch[1].replace(/\\\n/g, '').replace(/\\'/g, "'") : undefined;
  return { url, headers, body };
}

function cleanReplayHeaders(headers) {
  for (const key of Object.keys(headers)) {
    if (/^(host|content-length|connection|accept-encoding)$/i.test(key)) delete headers[key];
  }
}

function todayIstDate() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addIsoDays(yyyyMmDd, days) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) out[row[key]] = (out[row[key]] || 0) + 1;
  return out;
}

const DEFAULT_PARTNER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const DIRECT_SWIGGY_OUTLETS = {
  '1342888': { brand: 'he', outlet_name: 'Hamza Express' },
  '1342887': { brand: 'nch', outlet_name: 'Nawabi Chai House' },
};

const DIRECT_ZOMATO_OUTLETS = {
  '22632449': { brand: 'he', outlet_name: 'Hamza Express' },
  '22632430': { brand: 'nch', outlet_name: 'Nawabi Chai House' },
};

function normalizeSwiggyFetchOrders(payload) {
  const rows = [];
  for (const restaurant of (payload?.restaurantData || [])) {
    const outlet = DIRECT_SWIGGY_OUTLETS[String(restaurant.restaurantId)] || { brand: 'unknown', outlet_name: null };
    for (const order of (restaurant.orders || [])) {
      const orderedAt = order.status?.ordered_time || order.status?.placed_time || order.last_updated_time || null;
      rows.push({
        platform: 'swiggy',
        brand: outlet.brand,
        order_id: String(order.order_id || ''),
        status: order.status?.order_status || order.status?.placed_status || null,
        order_time: extractLocalTime(orderedAt),
        order_date: extractLocalDate(orderedAt),
        customer_name: order.customer?.name || null,
        items: summarizeSwiggyItems(order.cart?.items || []),
        order_value: numberOrNull(order.bill ?? order.final_gp_price ?? order.cart?.total),
        net_payout: null,
        fees: null,
        issues: summarizeSwiggyIssues(order),
        rating: null,
        outlet_name: outlet.outlet_name || order.restaurant_details?.name || null,
        captured_at: new Date().toISOString(),
      });
    }
  }
  return rows.filter(o => o.order_id);
}

function normalizeSwiggyHistory(payload) {
  const rows = [];
  const capturedAt = new Date().toISOString();
  for (const restaurant of (payload?.data || [])) {
    const restaurantId = String(restaurant.restId || restaurant.restaurantId || '');
    const objects = restaurant?.data?.objects || restaurant?.objects || [];
    for (const order of objects) {
      const restId = String(order.meta_info?.rest_id || restaurantId || '');
      const outlet = DIRECT_SWIGGY_OUTLETS[restId] || { brand: 'unknown', outlet_name: null };
      const orderedAt = order.status?.ordered_time || order.status?.placed_time || null;
      rows.push({
        platform: 'swiggy',
        brand: outlet.brand,
        order_id: String(order.order_id || order.meta_info?.order_id || ''),
        status: order.status?.order_status || order.status?.placed_status || null,
        order_time: extractLocalTime(orderedAt),
        order_date: extractLocalDate(orderedAt),
        customer_name: null,
        items: summarizeSwiggyItems(order.cart?.items || []),
        order_value: numberOrNull(order.bill ?? order.cart?.total),
        net_payout: null,
        fees: JSON.stringify({
          restaurant_trade_discount: numberOrNull(order.restaurant_trade_discount),
          restaurant_offers_discount: numberOrNull(order.restaurant_offers_discount),
          discount: numberOrNull(order.discount),
          spending: numberOrNull(order.spending),
          gst: numberOrNull(order.gst),
          packing_charge: numberOrNull(order.cart?.charges?.packing_charge),
          delivery_charge: numberOrNull(order.cart?.charges?.delivery_charge),
        }),
        issues: summarizeSwiggyIssues(order),
        rating: null,
        outlet_name: outlet.outlet_name,
        captured_at: capturedAt,
      });
    }
  }
  return rows.filter(o => o.order_id);
}

function normalizeZomatoOrderDetail(payload) {
  const order = payload?.order || payload;
  if (!order?.id) return null;
  const outlet = DIRECT_ZOMATO_OUTLETS[String(order.resId || '')] || { brand: 'unknown', outlet_name: null };
  const dishes = order.cartDetails?.items?.dishes || [];
  const createdAt = order.createdAt || order.actionedAt || order.updatedAt || null;
  return {
    platform: 'zomato',
    brand: outlet.brand,
    order_id: String(order.id),
    status: order.state || null,
    order_time: extractIstTime(createdAt),
    order_date: extractIstDate(createdAt),
    customer_name: order.creator?.name || null,
    items: dishes.map(d => `${d.quantity || 1} x ${d.name || 'Unknown item'}`).join(', '),
    order_value: numberOrNull(order.cartDetails?.total?.amountDetails?.totalCost)
      ?? numberOrNull(order.cartDetails?.total)
      ?? sumNumbers(dishes.map(d => d.totalCost)),
    net_payout: null,
    fees: null,
    issues: summarizeZomatoIssues(order),
    rating: null,
    outlet_name: outlet.outlet_name,
    captured_at: new Date().toISOString(),
  };
}

function normalizeZomatoOrderHistory(payload) {
  const snippets = Array.isArray(payload?.snippets) ? payload.snippets : [];
  const capturedAt = new Date().toISOString();
  return snippets.map(snippet => {
    const text = collectPlainStrings(snippet, 80).map(stripZomatoText).filter(Boolean);
    const joined = text.join(' | ');
    const id = firstMatch(joined, /\bID:\s*(\d{5,})\b/i)
      || firstDeepValue(snippet, /^(orderId|order_id|displayId|id)$/i, v => /^\d{5,}$/.test(String(v)));
    if (!id) return null;

    const status = detectZomatoHistoryStatus(text);
    const dateText = text.find(t => /\d{1,2}:\d{2}\s*(AM|PM)\s*\|\s*\d{1,2}\s+[A-Za-z]{3,}/i.test(t)) || '';
    const orderDateTime = parseZomatoHistoryDateTime(dateText);
    const items = text.filter(t => /^\d+\s*x\s+/i.test(t)).join(', ') || null;
    const valueText = text.find(t => /₹\s*[\d,.]+/.test(t)) || '';
    const issue = detectZomatoHistoryIssue(text, status);

    return {
      platform: 'zomato',
      brand: 'unknown',
      order_id: String(id),
      status,
      order_time: orderDateTime.time,
      order_date: orderDateTime.date,
      customer_name: firstMatch(joined, /\bBy\s+([^|]+?)(?:\s*\||$)/i),
      items,
      order_value: numberOrNull(valueText),
      net_payout: null,
      fees: null,
      issues: issue,
      rating: extractPossibleRating(text),
      outlet_name: null,
      captured_at: capturedAt,
    };
  }).filter(Boolean);
}

function summarizeSwiggyItems(items) {
  return (items || []).map(i => `${i.quantity || i.qty || 1} x ${i.name || i.item_name || i.itemName || 'Unknown item'}`).join(', ');
}

function summarizeSwiggyIssues(order) {
  const status = order.status || {};
  const detail = order.meta_info?.details || {};
  const parts = [];
  if (/cancel|reject|out_of_stock/i.test(`${status.order_status || ''} ${status.placed_status || ''} ${status.placingState || ''} ${status.cancel_reason || ''}`)) {
    parts.push(status.cancel_reason || status.placed_status || status.placingState || 'cancelled');
  }
  if (status.hand_over_delayed || detail.hand_over_delayed) parts.push('handover delayed');
  if (order.mfrAccuracy?.message) parts.push(order.mfrAccuracy.message);
  if (order.customer_comment) parts.push(`customer note: ${String(order.customer_comment).slice(0, 120)}`);
  return parts.join('; ') || null;
}

function summarizeZomatoIssues(order) {
  const parts = [];
  if (/reject|timeout|cancel/i.test(order.state || '')) parts.push(order.state);
  const delays = order.delayInfo?.stateMachine || [];
  const activeDelay = delays.find(d => /DELAY/i.test(d.state || '') && !/NO_DELAY/i.test(d.state || ''));
  if (activeDelay) parts.push(activeDelay.state);
  return parts.join('; ') || null;
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function sumNumbers(values) {
  const n = values.reduce((s, v) => s + (numberOrNull(v) || 0), 0);
  return n || null;
}

function extractLocalDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractLocalTime(value) {
  if (!value) return null;
  const m = String(value).match(/[T ](\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function extractIstDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return extractLocalDate(value);
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

function extractIstTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return extractLocalTime(value);
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(11, 16);
}

function collectPlainStrings(value, limit = 80, out = []) {
  if (out.length >= limit || value == null) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const s = String(value).trim();
    if (s) out.push(s);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPlainStrings(item, limit, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value)) {
      collectPlainStrings(child, limit, out);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function stripZomatoText(value) {
  let s = String(value || '').replace(/\u00a0/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    s = s.replace(/<[^|<>]+\|\{[^|{}]+\|([^{}<>]*)\}>/g, '$1');
    s = s.replace(/\{[^|{}]+\|([^{}<>]*)\}/g, '$1');
  }
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstMatch(text, regex) {
  const m = String(text || '').match(regex);
  return m ? m[1].trim() : null;
}

function firstDeepValue(value, keyRegex, valuePredicate) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstDeepValue(child, keyRegex, valuePredicate);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (keyRegex.test(key) && valuePredicate(child)) return child;
      const found = firstDeepValue(child, keyRegex, valuePredicate);
      if (found != null) return found;
    }
  }
  return null;
}

function detectZomatoHistoryStatus(text) {
  const hay = text.join(' ').toUpperCase();
  if (/REJECTED/.test(hay)) return 'REJECTED';
  if (/TIME\s*OUT|TIMED\s*OUT|MISSED/.test(hay)) return 'TIMED_OUT';
  if (/CANCELLED|CANCELED/.test(hay)) return 'CANCELLED';
  if (/DELIVERED/.test(hay)) return 'DELIVERED';
  if (/READY/.test(hay)) return 'READY';
  if (/PREPAR/.test(hay)) return 'PREPARING';
  if (/ACCEPT/.test(hay)) return 'ACCEPTED';
  return null;
}

function detectZomatoHistoryIssue(text, status) {
  const issueLines = text.filter(t => /reject|cancel|missed|timed?\s*out|delay|handover|complaint|not accepted/i.test(t));
  if (issueLines.length) return Array.from(new Set(issueLines)).join('; ');
  if (/REJECT/i.test(status || '')) return 'Rejected by restaurant';
  if (/TIME|MISS/i.test(status || '')) return 'Missed acceptance / timed out';
  if (/CANCEL/i.test(status || '')) return 'Cancelled';
  return null;
}

function parseZomatoHistoryDateTime(value) {
  const m = String(value || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*\|\s*(\d{1,2})\s+([A-Za-z]{3,})/i);
  if (!m) return { date: null, time: null };
  let hour = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && hour !== 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  const monthName = m[5].slice(0, 3).toLowerCase();
  const month = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }[monthName];
  const year = new Date(Date.now() + 330 * 60000).getUTCFullYear();
  return {
    date: month ? `${year}-${month}-${String(parseInt(m[4], 10)).padStart(2, '0')}` : null,
    time: `${String(hour).padStart(2, '0')}:${min}`,
  };
}

function extractPossibleRating(text) {
  const candidates = text
    .map(t => String(t).trim())
    .filter(t => /^[1-5](?:\.0)?$/.test(t));
  return candidates.length === 1 ? Number(candidates[0]) : null;
}

async function latestZomatoDetailMap(db) {
  const { results } = await db.prepare(`
    SELECT * FROM aggregator_snapshots
    WHERE platform='zomato' AND metric_type='api_orders'
    ORDER BY captured_at DESC LIMIT 500
  `).all();
  const map = new Map();
  for (const row of (results || [])) {
    const payload = safeJsonParse(row.data);
    const order = payload?.order || payload;
    if (!order?.id || map.has(String(order.id))) continue;
    const normalized = normalizeZomatoOrderDetail({ order });
    if (!normalized) continue;
    const discount = extractZomatoDiscount(order);
    map.set(String(order.id), {
      ...normalized,
      order_id: String(order.id),
      display_id: order.displayId || null,
      created_at: order.createdAt || null,
      captured_at: row.captured_at,
      customer_order_count: order.creator?.orderCount ?? null,
      customer_order_count_label: order.creator?.orderCountDisplay || null,
      payment_method: order.paymentMethod || order.paymentDetails?.paymentType || null,
      discount_total: discount.total,
      discount_lines: discount.lines,
      detail_available: true,
    });
  }
  return map;
}

function extractZomatoDiscount(order) {
  const lines = [];
  const dishes = order?.cartDetails?.items?.dishes || [];
  for (const dish of dishes) {
    for (const calc of (dish.calculations || [])) {
      const amount = numberOrNull(calc.amount ?? calc.value ?? calc.totalCost ?? calc.cost);
      lines.push({
        item: dish.name || null,
        name: calc.name || calc.title || 'discount',
        amount,
        is_percentage: calc.isPercentage ?? null,
      });
    }
  }
  const total = lines.reduce((sum, line) => sum + (line.amount || 0), 0);
  return { total: lines.length ? Math.round(total * 100) / 100 : null, lines };
}

function enrichOwnerOrder(row, detail) {
  const merged = { ...row };
  if (detail) {
    merged.brand = row.brand && row.brand !== 'unknown' ? row.brand : detail.brand;
    merged.outlet_name = row.outlet_name || detail.outlet_name;
    merged.customer_name = row.customer_name || detail.customer_name;
    merged.items = row.items || detail.items;
    merged.order_value = row.order_value ?? detail.order_value;
    merged.order_date = row.order_date || detail.order_date;
    merged.order_time = row.order_time || detail.order_time;
    merged.issues = row.issues || detail.issues;
  }
  const discountTotal = detail?.discount_total ?? extractStoredDiscount(row);
  const rating = row.rating ?? detail?.rating ?? null;
  const issues = row.issues || detail?.issues || null;
  const statusGroup = ownerStatusGroup(row.status || detail?.status, issues);
  return {
    platform: row.platform,
    brand: merged.brand || 'unknown',
    outlet_name: merged.outlet_name || null,
    order_id: String(row.order_id || detail?.order_id || ''),
    display_id: detail?.display_id || null,
    status: row.status || detail?.status || null,
    status_group: statusGroup,
    order_date: merged.order_date || null,
    order_time: merged.order_time || null,
    customer_name: merged.customer_name || null,
    customer_order_count: detail?.customer_order_count ?? null,
    customer_order_count_label: detail?.customer_order_count_label || null,
    rating,
    items: merged.items || null,
    order_value: merged.order_value ?? null,
    net_payout: row.net_payout ?? null,
    fees: row.fees ?? null,
    discount_total: discountTotal,
    discount_lines: detail?.discount_lines || [],
    payment_method: detail?.payment_method || null,
    issues,
    rejection_reason: /reject|cancel|time|miss/i.test(`${row.status || ''} ${issues || ''}`) ? issues || row.status : null,
    detail_available: Boolean(detail?.detail_available),
    captured_at: row.captured_at || detail?.captured_at || null,
  };
}

function extractStoredDiscount(row) {
  if (row?.platform !== 'swiggy' || !row?.fees) return null;
  const fees = safeJsonParse(row.fees);
  if (!fees || typeof fees !== 'object') return null;
  const values = [
    fees.restaurant_offers_discount,
    fees.restaurant_trade_discount,
    fees.discount,
  ].map(numberOrNull).filter(v => v && v > 0);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) * 100) / 100;
}

function ownerStatusGroup(status, issues) {
  const hay = `${status || ''} ${issues || ''}`.toLowerCase();
  if (/miss|timed?\s*out|not accepted/.test(hay)) return 'missed';
  if (/reject/.test(hay)) return 'rejected';
  if (/cancel/.test(hay)) return 'cancelled';
  if (/deliver/.test(hay)) return 'delivered';
  if (/accept|prepar|ready|placed|ordered|picked|dispatch/.test(hay)) return 'active';
  return 'other';
}

function compareOwnerOrders(a, b) {
  const ad = `${a.order_date || ''}T${a.order_time || '00:00'}`;
  const bd = `${b.order_date || ''}T${b.order_time || '00:00'}`;
  if (ad !== bd) return bd.localeCompare(ad);
  return String(b.captured_at || '').localeCompare(String(a.captured_at || ''));
}

function ownerOrderSummary(orders) {
  const byStatus = {};
  const byPlatform = {};
  let deliveredRevenue = 0;
  let discountKnown = 0;
  for (const order of orders) {
    byStatus[order.status_group] = (byStatus[order.status_group] || 0) + 1;
    byPlatform[order.platform] = (byPlatform[order.platform] || 0) + 1;
    if (order.status_group === 'delivered') deliveredRevenue += order.order_value || 0;
    if (order.discount_total != null) discountKnown++;
  }
  return {
    total_orders: orders.length,
    delivered_orders: byStatus.delivered || 0,
    active_orders: byStatus.active || 0,
    rejected_orders: byStatus.rejected || 0,
    missed_orders: byStatus.missed || 0,
    cancelled_orders: byStatus.cancelled || 0,
    issue_orders: orders.filter(o => o.issues).length,
    delivered_revenue: Math.round(deliveredRevenue * 100) / 100,
    discount_known_orders: discountKnown,
    by_status: byStatus,
    by_platform: byPlatform,
  };
}

function dateMatchesFilter(orderDate, capturedAt, { date, fromParam, toParam }) {
  const effective = orderDate || extractIstDate(capturedAt);
  if (!effective) return date === 'all';
  if (fromParam && toParam) return effective >= fromParam && effective <= toParam;
  const now = new Date(Date.now() + 330 * 60000);
  const today = now.toISOString().slice(0, 10);
  const oneDay = 24 * 60 * 60 * 1000;
  if (date === 'all') return true;
  if (date === 'today') return effective === today;
  if (date === 'yesterday') return effective === new Date(now.getTime() - oneDay).toISOString().slice(0, 10);
  if (date === 'week') return effective >= new Date(now.getTime() - 7 * oneDay).toISOString().slice(0, 10);
  if (date === 'month') return effective >= new Date(now.getTime() - 30 * oneDay).toISOString().slice(0, 10);
  return effective === today;
}

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
