// dine-aggregator-pulse.js
// Read-only GET API for dine-aggregator control surface.
// Actions: health | summary | history | may-attribution
// Auth: x-api-key header OR ?key= query param (same DASHBOARD_KEY as aggregator-pulse)
// DB: env.DB (D1 hn-hiring), table aggregator_snapshots
// Platforms tracked: zomato_dining | swiggy_dineout | eazydiner

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
  if (request.method !== 'GET') return resp({ error: 'GET only' }, 405, HEADERS);

  const authKey = request.headers.get('x-api-key') || url.searchParams.get('key');
  if (authKey !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return resp({ error: 'unauthorized' }, 401, HEADERS);
  }

  const action = url.searchParams.get('action') || 'health';
  const db = env.DB;

  try {
    if (action === 'health') {
      const { results } = await db.prepare(`
        SELECT platform, MAX(captured_at) AS last_seen, COUNT(*) AS total_snapshots
        FROM aggregator_snapshots
        WHERE platform IN ('zomato_dining', 'swiggy_dineout', 'eazydiner')
        GROUP BY platform
      `).all();

      const now = Date.now();
      const STALE_MS = 15 * 60 * 1000; // 15 min without a push = stale

      // Known platforms — show all, even if no data yet
      const expected = ['zomato_dining', 'swiggy_dineout', 'eazydiner'];
      const byPlatform = Object.fromEntries(results.map(r => [r.platform, r]));

      const platforms = expected.map(p => {
        const row = byPlatform[p];
        const lastSeenMs = row?.last_seen ? new Date(row.last_seen).getTime() : null;
        const staleMs = lastSeenMs ? now - lastSeenMs : null;
        return {
          platform: p,
          last_seen: row?.last_seen || null,
          stale_minutes: staleMs ? Math.round(staleMs / 60000) : null,
          total_snapshots: row?.total_snapshots || 0,
          status: !row ? 'never' : staleMs > STALE_MS ? 'stale' : 'live',
        };
      });

      return resp({ ok: true, action: 'health', platforms, ts: new Date().toISOString() }, 200, HEADERS);
    }

    if (action === 'summary') {
      // Latest snapshot per platform+outlet_id+section (metric_type)
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
        byPlatform[row.platform].push({ ...row, data: safeJson(row.data) });
      }

      return resp({ ok: true, action: 'summary', platforms: byPlatform, ts: new Date().toISOString() }, 200, HEADERS);
    }

    if (action === 'history') {
      const platform = url.searchParams.get('platform') || 'zomato_dining';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

      const { results } = await db.prepare(`
        SELECT platform, brand, outlet_id, metric_type, data, captured_at
        FROM aggregator_snapshots
        WHERE platform = ?
        ORDER BY captured_at DESC
        LIMIT ?
      `).bind(platform, limit).all();

      return resp({
        ok: true, action: 'history', platform,
        rows: results.map(r => ({ ...r, data: safeJson(r.data) })),
      }, 200, HEADERS);
    }

    if (action === 'may-attribution') {
      // Best-effort inferred revenue for May 2026 from dine platform snapshots.
      // Each platform card reports rupee_amounts extracted from DOM — we take the
      // max single-snapshot value as the best estimate (avoids double-counting
      // across repeated reads of the same total).
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
        const d = safeJson(row.data);
        const amounts = Array.isArray(d?.rupee_amounts) ? d.rupee_amounts : [];
        const maxAmt = amounts.length ? Math.max(...amounts) : 0;
        const key = `${row.platform}::${row.outlet_id}`;
        if (!totals[key]) totals[key] = { platform: row.platform, outlet_id: row.outlet_id, max_inferred: 0, snapshots: 0 };
        totals[key].snapshots++;
        if (maxAmt > totals[key].max_inferred) totals[key].max_inferred = maxAmt;
      }

      const rows = Object.values(totals);
      const grandTotal = rows.reduce((s, r) => s + r.max_inferred, 0);

      return resp({
        ok: true, action: 'may-attribution',
        grand_total_inferred: grandTotal,
        by_platform: rows,
        note: 'Inferred from DOM-scraped rupee amounts — manual attribution in may_layers is authoritative',
        ts: new Date().toISOString(),
      }, 200, HEADERS);
    }

    return resp({ error: `unknown action: ${action}` }, 400, HEADERS);

  } catch (e) {
    return resp({ error: e.message }, 500, HEADERS);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function resp(data, status, headers) {
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
