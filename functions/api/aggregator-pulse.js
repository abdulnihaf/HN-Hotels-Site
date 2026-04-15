// aggregator-pulse.js v3 — Orders + Metrics for complete partner portal replacement
// Orders stored individually with UPSERT (no duplicates)
// Metrics stored as snapshots
// Dashboard queries with date filters, outlet filters

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
    if (method === 'POST') return handlePost(db, request, headers);
    if (method === 'GET') return handleGet(db, url, headers);
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// ========= POST =========
async function handlePost(db, request, headers) {
  const body = await request.json();

  // Route: orders → aggregator_orders, session → KV, metrics → aggregator_snapshots
  if (body.type === 'orders' && body.orders) {
    return storeOrders(db, body.orders, headers);
  }

  // Store auth session to KV for server-side Cron access
  if (body.type === 'session' && body.platform) {
    const sessions = env.SESSIONS;
    if (sessions) {
      const key = `session_${body.platform}`;
      const existing = await sessions.get(key, 'json') || {};
      const merged = {
        ...existing,
        platform: body.platform,
        headers: { ...(existing.headers || {}), ...(body.headers || {}) },
        urls: [...new Set([...(existing.urls || []), ...(body.urls || []), body.url].filter(Boolean))].slice(-50),
        updated_at: new Date().toISOString(),
      };
      await sessions.put(key, JSON.stringify(merged), { expirationTtl: 86400 * 60 }); // 60 days
    }
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // Default: store as metric snapshot
  const snapshots = body.snapshots || [body];
  let stored = 0;

  for (const snap of snapshots) {
    const platform = snap.platform;
    const brand = snap.outlet?.brand || snap.brand || 'unknown';
    const outletId = snap.outlet?.outlet_id || snap.outlet_id || 'unknown';
    const metricType = snap.source === 'api_intercept' ? 'api_' + classifyUrl(snap.url) : snap.page || 'dom_read';
    const data = JSON.stringify(snap.metrics || snap.data || snap);
    const capturedAt = snap.captured_at || new Date().toISOString();

    if (data === '{}' || data === 'null') continue;

    // Deduplication: skip if an identical metric_type was stored in the last 10 minutes
    // Prevents thousands of duplicate rows from the 45-second read interval
    const recent = await db.prepare(
      `SELECT id FROM aggregator_snapshots WHERE platform=? AND brand=? AND metric_type=? AND captured_at > datetime('now', '-10 minutes') LIMIT 1`
    ).bind(platform, brand, metricType).first();
    if (recent) continue;

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

    // Use IST offset (+5:30) for date calculations
    const IST = "'+5 hours', '+30 minutes'";
    let dateWhere;
    switch (date) {
      case 'today': dateWhere = `order_date = date('now', ${IST})`; break;
      case 'yesterday': dateWhere = `order_date = date('now', ${IST}, '-1 day')`; break;
      case 'week': dateWhere = `order_date >= date('now', ${IST}, '-7 days')`; break;
      case 'month': dateWhere = `order_date >= date('now', ${IST}, '-30 days')`; break;
      case 'all': dateWhere = `1=1`; break;
      default: dateWhere = `order_date = date('now', ${IST})`;
    }

    let sql = `SELECT * FROM aggregator_orders WHERE ${dateWhere}`;
    const params = [];

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
    const { results } = await db.prepare(`
      SELECT a.* FROM aggregator_snapshots a
      INNER JOIN (
        SELECT platform, brand, metric_type, MAX(id) as max_id
        FROM aggregator_snapshots
        WHERE captured_at > datetime('now', '-24 hours')
        GROUP BY platform, brand, metric_type
      ) b ON a.id = b.max_id
      ORDER BY a.platform, a.brand
    `).all();

    const grouped = {};
    for (const row of results) {
      const key = `${row.platform}_${row.brand}`;
      if (!grouped[key]) grouped[key] = { platform: row.platform, brand: row.brand, metrics: {} };
      grouped[key].metrics[row.metric_type] = { data: JSON.parse(row.data), captured_at: row.captured_at };
    }

    return new Response(JSON.stringify({ ok: true, outlets: Object.values(grouped) }), { headers });
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

  return new Response(JSON.stringify({ error: 'unknown action', valid: ['orders', 'latest', 'stats', 'finance'] }), { status: 400, headers });
}

function classifyUrl(url) {
  if (!url) return 'unknown';
  if (/orders/i.test(url)) return 'orders';
  if (/sales|revenue|metrics/i.test(url)) return 'sales';
  if (/rating/i.test(url)) return 'ratings';
  if (/menu/i.test(url)) return 'menu';
  if (/funnel/i.test(url)) return 'funnel';
  if (/customer/i.test(url)) return 'customers';
  if (/ads/i.test(url)) return 'ads';
  if (/discount|offer/i.test(url)) return 'discounts';
  if (/finance|payout/i.test(url)) return 'finance';
  if (/restaurant.*config/i.test(url)) return 'config';
  return 'other';
}
// v3.0.1 Tue Apr 14 18:50:52 IST 2026
