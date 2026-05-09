// May 2026 — DO-OR-DIE Execution Command Center API
// GET  /api/may-execution                       → full state (sales + target + layers)
// POST /api/may-execution?action=update-layer   → { code, status?, expected_revenue_paise?, realized_revenue_paise?, notes?, next_action?, next_action_eta?, chat_url?, actor }
// POST /api/may-execution?action=log-event      → { layer_code, event_type, before_val?, after_val?, actor }
//
// Live data sourced from hamzaexpress.in/api/sales-insights (public, no auth).
// Targets are live-recomputed: required_pace = (target - banked) / days_remaining_inclusive.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Actor',
  'Content-Type': 'application/json',
};

const HE_SALES_URL = 'https://hamzaexpress.in/api/sales-insights';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// IST = UTC+5:30. Returns YYYY-MM-DD in IST for "now" or given date.
function istDateString(d = new Date()) {
  const ist = new Date(d.getTime() + (5.5 * 3600 * 1000));
  return ist.toISOString().slice(0, 10);
}

// Compute the May 2026 day index (1..31) for IST today
function mayDayIndex(today) {
  const t = new Date(today + 'T00:00:00Z'); // treat as date
  const d = t.getUTCDate();
  return d;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'state';

  try {
    if (request.method === 'GET') {
      if (action === 'state') return getState(env);
      if (action === 'refresh') return refreshAndGetState(env);
      return json({ error: 'unknown GET action' }, 400);
    }
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (action === 'update-layer') return updateLayer(env, body);
      if (action === 'log-event') return logEvent(env, body);
      return json({ error: 'unknown POST action' }, 400);
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    return json({ error: err.message, stack: err.stack?.slice(0, 1000) }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE STATE (what the UI reads)
// ─────────────────────────────────────────────────────────────────────────────
async function getState(env) {
  // Read config
  const cfg = await loadConfig(env);
  const today = istDateString();
  const monthStart = cfg.month_start;
  const monthEnd = cfg.month_end;
  const todayDay = mayDayIndex(today);
  const totalDays = 31;
  const daysElapsedExclToday = Math.max(0, todayDay - 1);
  const daysRemainingInclToday = Math.max(1, totalDays - daysElapsedExclToday);

  // Pull live sales (May 1 → today inclusive)
  const sales = await fetchHESales(monthStart, today);

  // Outlet revenue = sum of 3 POS configs (in HE sales-insights, "channels" object).
  // Note: HE returns ALL revenue including the 3 POS configs we filter on. Total is dine-in + direct takeaway.
  const outletRupees = sales?.summary?.totalRevenue || 0;
  const outletPaise = Math.round(outletRupees * 100);
  const outletOrders = sales?.summary?.totalOrders || 0;

  // Aggregator: try HE aggregator-pulse for snapshot
  let aggregatorPaise = 0;
  let aggregatorOrders = 0;
  let aggregatorBreakdown = null;
  try {
    const agg = await fetchHEAggregator(monthStart, today);
    aggregatorPaise = agg.paise;
    aggregatorOrders = agg.orders;
    aggregatorBreakdown = agg.breakdown;
  } catch (e) {
    aggregatorBreakdown = { error: e.message };
  }

  // Persist a daily snapshot for today (overwrite; will be locked overnight by frontend snapshot routine if desired)
  await env.DB.prepare(`
    INSERT INTO may_daily_snapshots (date, outlet_revenue_paise, outlet_orders, aggregator_revenue_paise, aggregator_orders, refreshed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET
      outlet_revenue_paise = excluded.outlet_revenue_paise,
      outlet_orders = excluded.outlet_orders,
      aggregator_revenue_paise = excluded.aggregator_revenue_paise,
      aggregator_orders = excluded.aggregator_orders,
      refreshed_at = excluded.refreshed_at
  `).bind(today, outletPaise, outletOrders, aggregatorPaise, aggregatorOrders).run();

  // Self-learning required pace
  const targetOutletPaise = parseInt(JSON.parse(cfg.target_outlet_paise), 10);
  const targetAggPaise = parseInt(JSON.parse(cfg.target_aggregator_paise), 10);
  const requiredPaceOutlet = Math.max(0, Math.ceil((targetOutletPaise - outletPaise) / daysRemainingInclToday));
  const requiredPaceAgg = Math.max(0, Math.ceil((targetAggPaise - aggregatorPaise) / daysRemainingInclToday));

  // Update today's required pace in snapshot
  await env.DB.prepare(`
    UPDATE may_daily_snapshots SET required_pace_outlet_paise = ?, required_pace_agg_paise = ? WHERE date = ?
  `).bind(requiredPaceOutlet, requiredPaceAgg, today).run();

  // Daily breakdown so far (May 1..today)
  const dailyRows = await env.DB.prepare(`
    SELECT date, outlet_revenue_paise, outlet_orders, aggregator_revenue_paise, aggregator_orders, required_pace_outlet_paise, required_pace_agg_paise, refreshed_at
    FROM may_daily_snapshots
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `).bind(monthStart, monthEnd).all();

  // Layers
  const layers = await env.DB.prepare(`
    SELECT code, name, status, expected_revenue_paise, realized_revenue_paise, description, notes, chat_url, position, is_bonus, next_action, next_action_eta, updated_at, updated_by
    FROM may_layers ORDER BY position ASC
  `).all();

  // Recent events
  const events = await env.DB.prepare(`
    SELECT layer_code, event_type, before_val, after_val, ts, actor
    FROM may_layer_events
    ORDER BY ts DESC LIMIT 50
  `).all();

  // Hourly today (from HE sales response)
  const hourly = sales?.hourly || [];

  // Top products today + MTD (from HE sales)
  const topProducts = sales?.topProducts?.slice(0, 10) || [];

  // POS-channel breakdown
  const channels = sales?.channels || null;

  return json({
    success: true,
    timestamp: new Date().toISOString(),
    today_ist: today,
    month: { start: monthStart, end: monthEnd, day_index: todayDay, days_remaining_incl_today: daysRemainingInclToday, total_days: totalDays },
    targets: {
      outlet_paise: targetOutletPaise,
      aggregator_paise: targetAggPaise,
      outlet_rupees: targetOutletPaise / 100,
      aggregator_rupees: targetAggPaise / 100,
    },
    banked: {
      outlet_paise: outletPaise,
      outlet_orders: outletOrders,
      aggregator_paise: aggregatorPaise,
      aggregator_orders: aggregatorOrders,
      total_paise: outletPaise + aggregatorPaise,
    },
    progress_pct: {
      outlet: Math.round((outletPaise / targetOutletPaise) * 1000) / 10,
      aggregator: targetAggPaise > 0 ? Math.round((aggregatorPaise / targetAggPaise) * 1000) / 10 : 0,
    },
    required_pace: {
      outlet_paise_per_day: requiredPaceOutlet,
      aggregator_paise_per_day: requiredPaceAgg,
      outlet_rupees_per_day: Math.round(requiredPaceOutlet / 100),
      aggregator_rupees_per_day: Math.round(requiredPaceAgg / 100),
      // Original pace if we'd been even from day 1
      original_pace_outlet_per_day: Math.round((targetOutletPaise / totalDays) / 100),
      original_pace_agg_per_day: Math.round((targetAggPaise / totalDays) / 100),
    },
    today: {
      outlet_paise: outletPaise - (dailyRows.results.slice(0, -1).reduce((s, r) => s + (r.outlet_revenue_paise || 0), 0) || 0),
      outlet_orders: outletOrders, // approximate; refined when day-by-day endpoint available
      hourly,
      top_products: topProducts,
      channels,
    },
    daily: dailyRows.results || [],
    aggregator_breakdown: aggregatorBreakdown,
    layers: layers.results || [],
    recent_events: events.results || [],
  });
}

async function refreshAndGetState(env) {
  // Same as getState; the refresh effect is the inline snapshot upsert.
  return getState(env);
}

// ─────────────────────────────────────────────────────────────────────────────
// HE SALES (cross-site fetch — endpoint is public)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchHESales(from, to) {
  const url = `${HE_SALES_URL}?from=${from}&to=${to}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HE sales ${resp.status}`);
  const data = await resp.json();
  if (!data.success) throw new Error('HE sales: not success');
  return data.data;
}

async function fetchHEAggregator(from, to) {
  // Try public read on HE aggregator
  const url = `https://hnhotels.in/api/aggregator-pulse?action=orders&from=${from}&to=${to}`;
  try {
    const resp = await fetch(url, { headers: { 'x-api-key': '' } });
    if (resp.ok) {
      const data = await resp.json();
      const orders = (data?.orders?.orders || []).filter(o => (o.brand || '').toLowerCase() === 'he');
      let paise = 0;
      let count = 0;
      const byPlatform = { zomato: { orders: 0, revenue: 0 }, swiggy: { orders: 0, revenue: 0 } };
      for (const o of orders) {
        const v = parseFloat(o.order_value || 0);
        const p = (o.platform || '').toLowerCase();
        paise += Math.round(v * 100);
        count++;
        if (byPlatform[p]) {
          byPlatform[p].orders++;
          byPlatform[p].revenue += v;
        }
      }
      return { paise, orders: count, breakdown: byPlatform };
    }
  } catch (_) {}
  return { paise: 0, orders: 0, breakdown: { error: 'aggregator-pulse unauth or stale' } };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER UPDATES
// ─────────────────────────────────────────────────────────────────────────────
async function updateLayer(env, body) {
  const { code, actor } = body;
  if (!code) return json({ error: 'code required' }, 400);

  // Only allow specific fields
  const fields = ['status', 'expected_revenue_paise', 'realized_revenue_paise', 'notes', 'next_action', 'next_action_eta', 'chat_url', 'description'];
  const setExpr = [];
  const values = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      setExpr.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (!setExpr.length) return json({ error: 'no fields to update' }, 400);

  setExpr.push(`updated_at = datetime('now')`);
  setExpr.push(`updated_by = ?`);
  values.push(actor || 'unknown');
  values.push(code);

  // Get existing for audit
  const before = await env.DB.prepare(`SELECT * FROM may_layers WHERE code = ?`).bind(code).first();
  if (!before) return json({ error: 'layer not found' }, 404);

  await env.DB.prepare(`UPDATE may_layers SET ${setExpr.join(', ')} WHERE code = ?`).bind(...values).run();

  // Log event for status change
  if (body.status && body.status !== before.status) {
    await env.DB.prepare(`INSERT INTO may_layer_events (layer_code, event_type, before_val, after_val, actor) VALUES (?, 'status_change', ?, ?, ?)`)
      .bind(code, before.status, body.status, actor || 'unknown').run();
  }
  if (body.next_action && body.next_action !== before.next_action) {
    await env.DB.prepare(`INSERT INTO may_layer_events (layer_code, event_type, after_val, actor) VALUES (?, 'next_action', ?, ?)`)
      .bind(code, body.next_action, actor || 'unknown').run();
  }
  if (body.notes && body.notes !== before.notes) {
    await env.DB.prepare(`INSERT INTO may_layer_events (layer_code, event_type, after_val, actor) VALUES (?, 'note', ?, ?)`)
      .bind(code, body.notes.slice(0, 500), actor || 'unknown').run();
  }

  const after = await env.DB.prepare(`SELECT * FROM may_layers WHERE code = ?`).bind(code).first();
  return json({ success: true, layer: after });
}

async function logEvent(env, body) {
  const { layer_code, event_type, before_val, after_val, actor } = body;
  if (!layer_code || !event_type) return json({ error: 'layer_code and event_type required' }, 400);
  await env.DB.prepare(`INSERT INTO may_layer_events (layer_code, event_type, before_val, after_val, actor) VALUES (?, ?, ?, ?, ?)`)
    .bind(layer_code, event_type, before_val || null, after_val || null, actor || 'unknown').run();
  return json({ success: true });
}

async function loadConfig(env) {
  const rows = await env.DB.prepare(`SELECT key, value_json FROM may_config`).all();
  const out = {};
  for (const r of (rows.results || [])) out[r.key] = r.value_json;
  return out;
}
