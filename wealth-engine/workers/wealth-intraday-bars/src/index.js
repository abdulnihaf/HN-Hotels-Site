// ═══════════════════════════════════════════════════════════════════════════
// wealth-intraday-bars — fetches 5-min OHLC bars from Kite historical API.
//
// Crons:
//   • Sun 06:00 IST  → refresh kite_instruments (symbol → token mapping)
//   • Mon-Fri 16:00  → fetch today's 5-min bars for top 50 intraday-suitable stocks
//   • Sat 07:00      → weekly enrich intraday_suitability with last-week intraday metrics
//
// HTTP:
//   GET /run/refresh_instruments?key=…   → refresh symbol-token map
//   GET /run/fetch_today?key=…&top=50    → fetch today's 5-min bars
//   GET /run/backfill?key=…&days=30&top=50 → backfill N days of 5-min bars
//   GET /state?key=…                     → status: rows in tables, latest dates
// ═══════════════════════════════════════════════════════════════════════════

const WORKER_NAME = 'wealth-intraday-bars';

function istNow() { return new Date(Date.now() + 5.5 * 3600000); }
function istToday() { return istNow().toISOString().slice(0, 10); }

async function logCronStart(db, name, source = 'cron') {
  try {
    const r = await db.prepare(`
      INSERT INTO cron_run_log (cron_name, status, started_at, trigger_source)
      VALUES (?, 'running', ?, ?)
    `).bind(`${WORKER_NAME}:${name}`, Date.now(), source).run();
    return r.meta?.last_row_id;
  } catch { return null; }
}
async function logCronEnd(db, id, status, rows, err) {
  if (!id) return;
  try {
    await db.prepare(`
      UPDATE cron_run_log SET status=?, finished_at=?, rows_written=?, error_message=?
      WHERE id=?
    `).bind(status, Date.now(), rows || 0, err ? String(err).slice(0, 500) : null, id).run();
  } catch {}
}

// ─── Get active Kite token from D1 ─────────────────────────────────────────
async function getKiteAuth(env) {
  const r = await env.DB.prepare(`
    SELECT access_token, api_key FROM kite_tokens WHERE is_active=1 ORDER BY id DESC LIMIT 1
  `).first().catch(() => null);
  if (!r?.access_token) return { error: 'no-active-kite-token' };
  // Use api_key from row (stored at OAuth time) or fall back to env
  const apiKey = r.api_key || env.KITE_API_KEY;
  if (!apiKey) return { error: 'no-api-key' };
  return { access_token: r.access_token, api_key: apiKey };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — refresh kite_instruments (Sunday 06:00 IST)
// Kite Connect publishes a CSV dump of all instruments. We fetch + parse + store.
// ═══════════════════════════════════════════════════════════════════════════
async function refreshInstruments(env) {
  const auth = await getKiteAuth(env);
  if (auth.error) return { rows: 0, error: auth.error };

  const r = await fetch('https://api.kite.trade/instruments', {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${auth.api_key}:${auth.access_token}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) return { rows: 0, error: `kite-instruments-fetch-failed-${r.status}` };
  const csv = await r.text();
  const lines = csv.split('\n').filter(Boolean);
  if (lines.length < 2) return { rows: 0, error: 'empty-csv' };

  // CSV header: instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
  const header = lines[0].split(',');
  const idx = (col) => header.indexOf(col);
  const tokenIdx = idx('instrument_token');
  const exTokenIdx = idx('exchange_token');
  const symIdx = idx('tradingsymbol');
  const nameIdx = idx('name');
  const exchIdx = idx('exchange');
  const segIdx = idx('segment');
  const typeIdx = idx('instrument_type');
  const lotIdx = idx('lot_size');
  const tickIdx = idx('tick_size');
  const expiryIdx = idx('expiry');
  const strikeIdx = idx('strike');

  // Filter: NSE EQ only for now (intraday-suitability scope)
  const nowMs = Date.now();
  let written = 0;
  const batchSize = 500;
  let batch = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[exchIdx] !== 'NSE') continue;
    if (cols[typeIdx] !== 'EQ') continue;
    batch.push([
      parseInt(cols[tokenIdx]) || null,
      parseInt(cols[exTokenIdx]) || null,
      cols[symIdx] || '',
      (cols[nameIdx] || '').replace(/^"|"$/g, ''),
      cols[exchIdx],
      cols[segIdx],
      cols[typeIdx],
      parseInt(cols[lotIdx]) || 1,
      parseFloat(cols[tickIdx]) || 0.05,
      cols[expiryIdx] || null,
      parseFloat(cols[strikeIdx]) || 0,
      nowMs,
    ]);
    if (batch.length >= batchSize) {
      await writeInstrumentsBatch(env.DB, batch);
      written += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await writeInstrumentsBatch(env.DB, batch);
    written += batch.length;
  }

  return { rows: written };
}

async function writeInstrumentsBatch(db, batch) {
  const stmts = batch.map(b => db.prepare(`
    INSERT OR REPLACE INTO kite_instruments
      (instrument_token, exchange_token, tradingsymbol, name, exchange, segment,
       instrument_type, lot_size, tick_size, expiry, strike, refreshed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(...b));
  await db.batch(stmts);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — fetchHistoricalBars(symbols, interval, fromDate, toDate)
// Hits Kite historical API for 5-min bars. Stores in intraday_bars table.
// ═══════════════════════════════════════════════════════════════════════════
async function fetchHistoricalBars(env, symbols, interval, fromDate, toDate) {
  const auth = await getKiteAuth(env);
  if (auth.error) return { rows: 0, error: auth.error };

  // Look up instrument tokens
  const placeholders = symbols.map(() => '?').join(',');
  const tokens = (await env.DB.prepare(`
    SELECT tradingsymbol, instrument_token FROM kite_instruments
    WHERE tradingsymbol IN (${placeholders}) AND exchange='NSE' AND instrument_type='EQ'
  `).bind(...symbols).all()).results || [];

  const tokenBySymbol = {};
  for (const t of tokens) tokenBySymbol[t.tradingsymbol] = t.instrument_token;

  const missing = symbols.filter(s => !tokenBySymbol[s]);
  if (missing.length === symbols.length) {
    return { rows: 0, error: 'no-tokens-found-run-refresh-instruments-first', missing };
  }

  let totalRows = 0;
  let errors = [];

  for (const symbol of symbols) {
    const token = tokenBySymbol[symbol];
    if (!token) { errors.push(`${symbol}:no-token`); continue; }

    const url = `https://api.kite.trade/instruments/historical/${token}/${interval}?from=${fromDate}&to=${toDate}`;
    try {
      const r = await fetch(url, {
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${auth.api_key}:${auth.access_token}`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { errors.push(`${symbol}:http-${r.status}`); continue; }
      const j = await r.json();
      if (j.status !== 'success') { errors.push(`${symbol}:${j.message?.slice(0,50) || 'no-data'}`); continue; }

      const candles = j.data?.candles || [];
      if (candles.length === 0) continue;

      const stmts = [];
      for (const c of candles) {
        // candle = [timestamp, open, high, low, close, volume]
        const ts = new Date(c[0]).getTime();
        const tradeDate = new Date(ts + 5.5 * 3600000).toISOString().slice(0, 10);
        stmts.push(env.DB.prepare(`
          INSERT OR REPLACE INTO intraday_bars
            (symbol, ts, trade_date, interval, open_paise, high_paise, low_paise, close_paise, volume)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
          symbol, ts, tradeDate, interval,
          Math.round(c[1] * 100), Math.round(c[2] * 100),
          Math.round(c[3] * 100), Math.round(c[4] * 100),
          c[5] || 0,
        ));
      }
      // Batch in chunks of 50 to avoid D1 limits
      for (let i = 0; i < stmts.length; i += 50) {
        await env.DB.batch(stmts.slice(i, i + 50));
      }
      totalRows += candles.length;
    } catch (e) {
      errors.push(`${symbol}:${(e.message || '').slice(0, 50)}`);
    }
  }

  return { rows: totalRows, errors: errors.slice(0, 10), symbols_processed: symbols.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — fetchToday (cron at 16:00 IST)
// Fetch today's 5-min bars for top-50 intraday-suitable stocks.
// ═══════════════════════════════════════════════════════════════════════════
// F-COVER-1 fix (May 7 2026 morning): default top 50 → 200 so the fetchToday
// cron covers the FULL intraday_suitability pool (currently 73 stocks).
// Previously bottom 24 stocks (ranked 50-73 by intraday_score) had no bars,
// invalidating their pool ranking + breaking pre-market integrity L1.2.
// 200 is a safe over-cap since pool is bounded by F38 universe filter.
async function fetchToday(env, opts = {}) {
  const top = parseInt(opts.top || 200);
  const symbols = (await env.DB.prepare(`
    SELECT symbol FROM intraday_suitability ORDER BY intraday_score DESC LIMIT ?
  `).bind(top).all()).results.map(r => r.symbol);
  if (symbols.length === 0) return { rows: 0, error: 'no-suitable-stocks-yet' };

  const today = istToday();
  // Kite expects YYYY-MM-DD HH:mm:ss format
  return await fetchHistoricalBars(env, symbols, '5minute', `${today} 09:15:00`, `${today} 15:30:00`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — backfill (HTTP-triggered for initial fill)
// ═══════════════════════════════════════════════════════════════════════════
async function backfill(env, opts = {}) {
  const days = parseInt(opts.days || 30);
  const top = parseInt(opts.top || 200);  // F-COVER-1: matches fetchToday — full pool
  const symbols = (await env.DB.prepare(`
    SELECT symbol FROM intraday_suitability ORDER BY intraday_score DESC LIMIT ?
  `).bind(top).all()).results.map(r => r.symbol);
  if (symbols.length === 0) return { rows: 0, error: 'no-suitable-stocks' };

  const today = istNow();
  const fromDate = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const toDate = today.toISOString().slice(0, 10);

  return await fetchHistoricalBars(
    env, symbols, '5minute',
    `${fromDate} 09:15:00`, `${toDate} 15:30:00`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — weekly enrichment of intraday_suitability with last-week metrics
// Adds: hit_2pct_last_week, avg_open_to_high_last_week, etc., distilled from intraday_bars.
// (Adds new columns if not present.)
// ═══════════════════════════════════════════════════════════════════════════
async function weeklyEnrich(env) {
  const db = env.DB;
  // Ensure new columns exist (idempotent)
  for (const col of ['hit_2pct_last_week', 'avg_up_last_week_pct', 'green_close_last_week']) {
    try {
      await db.prepare(`ALTER TABLE intraday_suitability ADD COLUMN ${col} REAL`).run();
    } catch { /* already exists */ }
  }

  // Compute per-symbol last-week stats from intraday_bars (5-min interval)
  // Aggregate to daily OHLC from 5-min bars, then compute hit-rates.
  const stats = (await db.prepare(`
    WITH daily AS (
      SELECT
        symbol,
        trade_date,
        MIN(CASE WHEN ts = (SELECT MIN(ts) FROM intraday_bars b2 WHERE b2.symbol = b.symbol AND b2.trade_date = b.trade_date) THEN open_paise END) AS day_open,
        MAX(high_paise) AS day_high,
        MIN(low_paise) AS day_low,
        MAX(CASE WHEN ts = (SELECT MAX(ts) FROM intraday_bars b3 WHERE b3.symbol = b.symbol AND b3.trade_date = b.trade_date) THEN close_paise END) AS day_close
      FROM intraday_bars b
      WHERE interval='5minute'
        AND trade_date >= date('now', '-7 days')
      GROUP BY symbol, trade_date
    )
    SELECT
      symbol,
      ROUND(AVG(CASE WHEN (day_high - day_open) * 100.0 / day_open >= 2 THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_2pct_last_week,
      ROUND(AVG((day_high - day_open) * 100.0 / day_open), 2) AS avg_up_last_week_pct,
      ROUND(AVG(CASE WHEN day_close > day_open THEN 1.0 ELSE 0.0 END) * 100, 1) AS green_close_last_week
    FROM daily
    WHERE day_open > 0
    GROUP BY symbol
  `).all()).results || [];

  let updated = 0;
  for (const s of stats) {
    await db.prepare(`
      UPDATE intraday_suitability
      SET hit_2pct_last_week = ?, avg_up_last_week_pct = ?, green_close_last_week = ?
      WHERE symbol = ?
    `).bind(s.hit_2pct_last_week, s.avg_up_last_week_pct, s.green_close_last_week, s.symbol).run();
    updated++;
  }

  return { rows: updated };
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON DISPATCH
// ═══════════════════════════════════════════════════════════════════════════
// F-DATA-1 fix (May 6 2026, evening):
// The wrangler.toml has a cron entry "30 0 * * 1-5" (06:00 IST weekday) for
// daily enrich, but the dispatch map below was missing that key — so the
// scheduled handler silently returned and avg_up_last_week_pct was NULL for
// all 73 pool stocks. Adding the dispatch entry fixes the silent skip.
//
// Note: '30 0 * * 1-5' overlaps with '30 0 * * 1' on Mondays — both fire.
// Separate keys is fine; CF dispatches each cron expression independently.
const CRON_DISPATCH = {
  '30 0 * * 1':    { name: 'refresh_instruments', fn: refreshInstruments },
  '30 0 * * 1-5':  { name: 'daily_enrich',        fn: weeklyEnrich },
  '30 10 * * 1-5': { name: 'fetch_today',         fn: fetchToday },
  '30 1 * * 6':    { name: 'weekly_enrich',       fn: weeklyEnrich },
};

const HTTP_HANDLERS = {
  refresh_instruments: refreshInstruments,
  fetch_today: fetchToday,
  backfill: backfill,
  weekly_enrich: weeklyEnrich,
};

async function runCron(env, cronExpr) {
  const entry = CRON_DISPATCH[cronExpr];
  if (!entry) return;
  const id = await logCronStart(env.DB, entry.name);
  try {
    const r = await entry.fn(env);
    await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error || null);
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e));
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.cron));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }
    const m = url.pathname.match(/^\/run\/([a-z_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, m[1], 'http');
      try {
        const opts = {
          top: url.searchParams.get('top'),
          days: url.searchParams.get('days'),
        };
        const r = await HTTP_HANDLERS[m[1]](env, opts);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error || null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    if (url.pathname === '/state') {
      const inst = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM kite_instruments`).first()).n;
      const bars = (await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(trade_date) AS last_date FROM intraday_bars`).first());
      return Response.json({
        instruments: inst,
        intraday_bars: bars.n,
        latest_bar_date: bars.last_date,
      });
    }
    return new Response('wealth-intraday-bars', { status: 200 });
  },
};
