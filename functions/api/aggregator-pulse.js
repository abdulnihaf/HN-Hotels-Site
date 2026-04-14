// aggregator-pulse.js — Receives + serves aggregator data from Chrome extension
// POST: Extension pushes snapshots (Swiggy/Zomato metrics)
// GET:  Dashboard reads latest metrics

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

  // Auth — accepts both DASHBOARD_KEY (HN Hotels) and DASHBOARD_API_KEY (HE compat)
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

// --- POST: Receive snapshots from extension ---
async function handlePost(db, request, headers) {
  const body = await request.json();
  const snapshots = body.snapshots || [body]; // Accept single or batch

  let stored = 0;

  for (const snap of snapshots) {
    const platform = snap.platform; // 'swiggy' | 'zomato'
    const brand = snap.outlet?.brand || snap.brand || 'unknown';
    const outletId = snap.outlet?.outlet_id || snap.outlet_id || 'unknown';
    const metricType = snap.source === 'api_intercept' ? 'api_' + classifyUrl(snap.url) : snap.page || 'dom_read';
    const data = JSON.stringify(snap.metrics || snap.data || snap);
    const capturedAt = snap.captured_at || new Date().toISOString();

    // Skip empty payloads
    if (data === '{}' || data === 'null') continue;

    await db.prepare(
      `INSERT INTO aggregator_snapshots (platform, brand, outlet_id, metric_type, data, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(platform, brand, outletId, metricType, data, capturedAt).run();

    stored++;
  }

  return new Response(JSON.stringify({ ok: true, stored, received: snapshots.length }), { headers });
}

// --- GET: Serve latest metrics for dashboard ---
async function handleGet(db, url, headers) {
  const action = url.searchParams.get('action') || 'latest';

  if (action === 'latest') {
    // Get most recent snapshot per platform+brand+metric_type
    const { results } = await db.prepare(`
      SELECT a.* FROM aggregator_snapshots a
      INNER JOIN (
        SELECT platform, brand, metric_type, MAX(id) as max_id
        FROM aggregator_snapshots
        WHERE captured_at > datetime('now', '-24 hours')
        GROUP BY platform, brand, metric_type
      ) b ON a.id = b.max_id
      ORDER BY a.platform, a.brand, a.metric_type
    `).all();

    // Group by platform+brand for easy consumption
    const grouped = {};
    for (const row of results) {
      const key = `${row.platform}_${row.brand}`;
      if (!grouped[key]) {
        grouped[key] = { platform: row.platform, brand: row.brand, outlet_id: row.outlet_id, metrics: {} };
      }
      grouped[key].metrics[row.metric_type] = {
        data: JSON.parse(row.data),
        captured_at: row.captured_at,
      };
    }

    return new Response(JSON.stringify({
      ok: true,
      outlets: Object.values(grouped),
      generated_at: new Date().toISOString(),
    }), { headers });
  }

  if (action === 'history') {
    const platform = url.searchParams.get('platform');
    const brand = url.searchParams.get('brand');
    const hours = parseInt(url.searchParams.get('hours') || '24');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

    let sql = `SELECT * FROM aggregator_snapshots WHERE captured_at > datetime('now', '-${hours} hours')`;
    const params = [];

    if (platform) { sql += ' AND platform = ?'; params.push(platform); }
    if (brand) { sql += ' AND brand = ?'; params.push(brand); }

    sql += ` ORDER BY captured_at DESC LIMIT ${limit}`;

    const { results } = await db.prepare(sql).bind(...params).all();
    return new Response(JSON.stringify({ ok: true, count: results.length, snapshots: results }), { headers });
  }

  if (action === 'stats') {
    const { results } = await db.prepare(`
      SELECT
        platform, brand,
        COUNT(*) as total_snapshots,
        MIN(captured_at) as first_capture,
        MAX(captured_at) as last_capture,
        COUNT(DISTINCT metric_type) as metric_types
      FROM aggregator_snapshots
      GROUP BY platform, brand
    `).all();

    return new Response(JSON.stringify({ ok: true, stats: results }), { headers });
  }

  return new Response(JSON.stringify({ error: 'unknown action', valid: ['latest', 'history', 'stats'] }), { status: 400, headers });
}

// --- Classify API URL into a metric type ---
function classifyUrl(url) {
  if (!url) return 'unknown';
  if (/orders/i.test(url)) return 'orders';
  if (/sales|revenue|metrics|business/i.test(url)) return 'sales';
  if (/rating/i.test(url)) return 'ratings';
  if (/menu/i.test(url)) return 'menu';
  if (/funnel/i.test(url)) return 'funnel';
  if (/customer/i.test(url)) return 'customers';
  if (/ads|campaign/i.test(url)) return 'ads';
  if (/discount|offer/i.test(url)) return 'discounts';
  if (/finance|payout/i.test(url)) return 'finance';
  if (/restaurant.*config|restaurant.*minimal/i.test(url)) return 'config';
  return 'other';
}
