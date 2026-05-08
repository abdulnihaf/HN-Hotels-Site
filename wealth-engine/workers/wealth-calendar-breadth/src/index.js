// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-calendar-breadth
// Layer 7 (Calendar) + Layer 8 (Sector & Breadth)
//
// 54 Investing.com economic calendar  daily 06:00 IST
// 55 NSE earnings calendar            daily 18:00 IST
// 58 NSE sectoral indices             daily 17:35 IST + every 30 min live
// 59 NSE most active                  every 30 min during market
// 60 NSE advance/decline              every 30 min during market
// ═══════════════════════════════════════════════════════════════════════════

import { NSEClient, ymdHyphen, istNow, isISTMarketDay, rupeesToPaise, safeInt, safeFloat } from '../../_shared/nseClient.js';
import { yahooChart } from '../../_shared/yahooClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-calendar-breadth';

function hash(s) { let h = 0x811c9dc5; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;} return h.toString(16).padStart(8,'0'); }

// SOURCE 54 — Investing.com economic calendar
async function ingestEconCalendar(env) {
  // Investing.com publishes a daily ICS-like feed; their JSON endpoint is more practical.
  try {
    const res = await fetch('https://sbcharts.investing.com/events_calendar/calendar_data', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.investing.com/economic-calendar/',
      },
      body: 'country%5B%5D=14&country%5B%5D=5&timeZone=23&timeFilter=timeRemain&currentTab=nextWeek&limit_from=0',
    });
    if (!res.ok) return { rows: 0 };
    const j = await res.json();
    const html = j.data || '';
    // Crude parser: rows of country | event | importance | actual | forecast | previous
    const re = /<tr[^>]*event_attr_id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
    const rows = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const block = m[2];
      const eventName = (block.match(/<a[^>]*event-href[^>]*>([^<]+)/) || [])[1];
      const country = (block.match(/<span[^>]*ceFlags[^>]*title="([^"]+)"/) || [])[1];
      const importance = (block.match(/sentiment_(\d+)/) || [])[1];
      const ts = parseInt((block.match(/data-event-datetime="(\d+)"/) || [])[1] || '0', 10) * 1000;
      if (!eventName || !ts) continue;
      rows.push({
        id: hash(`${m[1]}|${eventName}`),
        event_ts: ts,
        country, event_name: eventName,
        importance: safeInt(importance),
        forecast: null, previous: null, actual: null,
      });
    }
    const cols = ['id','event_ts','country','event_name','importance','forecast','previous','actual'];
    const written = await batchInsert(env.DB, 'macro_calendar', cols, rows, 'IGNORE');
    return { rows: written };
  } catch { return { rows: 0 }; }
}

// SOURCE 55 — NSE earnings calendar (mirrored from board-meetings results-flag)
async function ingestEarningsCalendar(env) {
  // Promote board_meetings.is_results_meeting=1 entries into results_calendar
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO results_calendar (symbol, result_date, fiscal_period, expected_session)
     SELECT symbol, meeting_date, NULL, NULL FROM board_meetings WHERE is_results_meeting=1`
  ).run();
  return { rows: r.meta?.changes || 0 };
}

// SOURCE 58 — NSE sectoral indices
// Expanded from 18 → 24 to cover the full sectoral rotation matrix
const SECTOR_INDICES = [
  'NIFTY BANK','NIFTY IT','NIFTY AUTO','NIFTY FMCG','NIFTY PHARMA',
  'NIFTY METAL','NIFTY REALTY','NIFTY ENERGY','NIFTY MEDIA','NIFTY PSU BANK',
  'NIFTY PVT BANK','NIFTY FIN SERVICE','NIFTY HEALTHCARE','NIFTY CONSUMER DURABLES',
  'NIFTY OIL & GAS','NIFTY MIDCAP 100','NIFTY MIDCAP 50','NIFTY SMLCAP 100',
  // Newly added: full sectoral coverage
  'NIFTY INFRA','NIFTY COMMODITIES','NIFTY MNC','NIFTY SERVICES SECTOR',
  'NIFTY MICROCAP 250','NIFTY 50',
];

// Find the last market day relative to a date (NSE serves data 24/7;
// we just need to tag with the last market session it represents)
function lastMarketDayLocal(d) {
  const t = new Date(d);
  while (!isISTMarketDay(t)) t.setUTCDate(t.getUTCDate() - 1);
  return t;
}

async function ingestSectorIndices(env) {
  // Always run — NSE serves last-known closes 24/7. Tag with last market day.
  const target = lastMarketDayLocal(istNow());
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const data = await nse.getJson('/api/allIndices');
  const items = data?.data || [];
  const rows = items.filter(d => SECTOR_INDICES.includes((d.indexSymbol || d.index || '').toUpperCase())).map(d => ({
    index_name: (d.indexSymbol || d.index).toUpperCase(),
    trade_date: dateStr,
    open_paise: rupeesToPaise(d.open),
    high_paise: rupeesToPaise(d.high),
    low_paise: rupeesToPaise(d.low),
    close_paise: rupeesToPaise(d.last),
  })).filter(r => r.close_paise != null);
  if (rows.length === 0) return { rows: 0, skipped: 'no-data' };
  const cols = ['index_name','trade_date','open_paise','high_paise','low_paise','close_paise'];
  const written = await batchInsert(env.DB, 'sector_indices', cols, rows, 'REPLACE');
  return { rows: written, sectors: rows.length, trade_date: dateStr };
}

// SOURCE 59 — NSE most-active
async function ingestMostActive(env) {
  const ts = Date.now();
  const nse = new NSEClient();
  const rows = [];
  for (const rankType of ['volume', 'value']) {
    try {
      const data = await nse.getJson(`/api/live-analysis-most-active-securities?index=${rankType}&limit=20`);
      const list = data?.data || [];
      list.forEach((d, i) => {
        rows.push({
          ts,
          rank_type: rankType,
          rank: i + 1,
          symbol: d.symbol,
          metric_value: safeFloat(rankType === 'value' ? d.totalTradedValue : d.totalTradedVolume),
        });
      });
    } catch (e) {}
  }
  const cols = ['ts','rank_type','rank','symbol','metric_value'];
  const written = await batchInsert(env.DB, 'most_active', cols, rows, 'REPLACE');
  return { rows: written };
}

// SOURCE 60 — Advance/Decline breadth
async function ingestBreadth(env) {
  const ts = Date.now();
  const nse = new NSEClient();
  try {
    const data = await nse.getJson('/api/market-data-pre-open?key=ALL');
    const items = data?.data || [];
    let advances = 0, declines = 0, unchanged = 0;
    for (const d of items) {
      const ch = safeFloat(d?.metadata?.pChange);
      if (ch == null) continue;
      if (ch > 0) advances++;
      else if (ch < 0) declines++;
      else unchanged++;
    }
    const adRatio = declines ? advances / declines : null;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO breadth_data (ts, advances, declines, unchanged, new_highs, new_lows, ad_ratio)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(ts, advances, declines, unchanged, null, null, adRatio).run();
    return { rows: 1, advances, declines };
  } catch {
    return { rows: 0 };
  }
}

// ─────────────────────────────────────────────────────────
// SOURCE 62 — Bond direction analytic
//
// India doesn't expose 10Y G-Sec yield via free APIs cleanly. But we DO have
// NSE's "NIFTY GS 10YR" total-return index already populated by nse_indices.
// A rising GS price index = yields falling = bullish for rate-sensitives.
//
// We compute 5/20-day price change for each GSec maturity and persist as
// derived bond_yields rows so the signal engine can consume directional
// regime info without needing actual basis-point yields.
// ─────────────────────────────────────────────────────────
async function computeBondDirection(env) {
  const gsecIndices = ['NIFTY GS 4 8YR', 'NIFTY GS 8 13YR', 'NIFTY GS 10YR', 'NIFTY GS 11 15YR', 'NIFTY GS 15YRPLUS'];
  const ts = Date.now();
  const written = [];
  for (const idx of gsecIndices) {
    const rows = (await env.DB.prepare(`
      SELECT trade_date, close_paise FROM indices_eod
      WHERE index_name = ? AND close_paise > 0
      ORDER BY trade_date DESC LIMIT 25
    `).bind(idx).all()).results || [];
    if (rows.length < 6) continue;

    const latest = rows[0].close_paise;
    const lookback5 = rows[Math.min(5, rows.length - 1)].close_paise;
    const lookback20 = rows[Math.min(20, rows.length - 1)].close_paise;
    const change5d = ((latest - lookback5) / lookback5 * 100);
    const change20d = ((latest - lookback20) / lookback20 * 100);
    // Rising price → yields falling → bullish for rate-sensitive (NBFCs, real estate, autos)
    // Map maturity to a label
    const tenor = idx === 'NIFTY GS 10YR' ? '10Y'
                : idx === 'NIFTY GS 4 8YR' ? '4-8Y'
                : idx === 'NIFTY GS 8 13YR' ? '8-13Y'
                : idx === 'NIFTY GS 11 15YR' ? '11-15Y'
                : '15Y+';
    const direction = change5d > 0.3 ? 'yields_falling'
                    : change5d < -0.3 ? 'yields_rising'
                    : 'flat';
    written.push({
      tenor, ts,
      latest_index: latest,
      change_5d_pct: parseFloat(change5d.toFixed(3)),
      change_20d_pct: parseFloat(change20d.toFixed(3)),
      direction,
      trade_date: rows[0].trade_date,
    });
  }

  // Persist to bond_yields table — schema may need a column for derived data
  // We store as: tenor, ts, value (=index price), change_5d_pct, change_20d_pct, direction
  // Note: bond_yields table may not exist with these columns yet; create if needed
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS bond_yields (
      tenor TEXT NOT NULL,
      ts INTEGER NOT NULL,
      trade_date TEXT,
      latest_index REAL,
      change_5d_pct REAL,
      change_20d_pct REAL,
      direction TEXT,
      yield_bp REAL,
      source TEXT DEFAULT 'gsec_index_proxy',
      PRIMARY KEY (tenor, ts)
    )
  `).run();

  if (written.length === 0) return { rows: 0, skipped: 'no-gsec-data' };
  for (const w of written) {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO bond_yields (tenor, ts, trade_date, latest_index, change_5d_pct, change_20d_pct, direction, source)
      VALUES (?,?,?,?,?,?,?, 'gsec_index_proxy')
    `).bind(w.tenor, w.ts, w.trade_date, w.latest_index, w.change_5d_pct, w.change_20d_pct, w.direction).run();
  }
  return { rows: written.length, tenors: written.map(w => `${w.tenor}:${w.direction}`) };
}

// Unique cron expressions only. Paid tier — most-active + breadth every 5 min
// (was 30 min, with breadth silently disabled by cron-key bug).
const CRON_DISPATCH = {
  '30 0 * * *':        { name: 'econ_calendar',     fn: ingestEconCalendar },     // 06:00 IST daily
  '5 12 * * 1-5':      { name: 'sector_indices',    fn: ingestSectorIndices },    // 17:35 IST EOD
  '30 12 * * 1-5':     { name: 'earnings_calendar', fn: ingestEarningsCalendar }, // 18:00 IST EOD
  '0 16 * * *':        { name: 'sector_history_refresh', fn: backfillIndexHistoryYahoo }, // 21:30 IST every day — rolling 60d window
  '10 16 * * *':       { name: 'bond_direction',    fn: computeBondDirection },   // 21:40 IST — after GSec index settles
  '*/5 3-10 * * 1-5':  { name: 'most_active',       fn: ingestMostActive },       // every 5 min market hours (was 30)
  '2-57/5 3-10 * * 1-5': { name: 'breadth',         fn: ingestBreadth },          // every 5 min offset 2 (was disabled)
  '*/15 3-10 * * 1-5': { name: 'sector_intraday',   fn: ingestSectorIndices },    // every 15 min — sector index live (NEW)
};

async function runCron(env, cronExpr) {
  const entry = CRON_DISPATCH[cronExpr];
  if (!entry) return;
  const id = await logCronStart(env.DB, WORKER_NAME, entry.name, 'cron');
  try {
    const r = await entry.fn(env);
    await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
    await markSourceHealth(env.DB, entry.name, true);
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e).slice(0, 500));
    await markSourceHealth(env.DB, entry.name, false, e);
  }
}

// ─────────────────────────────────────────────────────────
// HISTORICAL SECTOR + INDEX BACKFILL via Yahoo Finance
//
// NSE doesn't expose multi-day sectoral history reliably (their
// /api/historical/indicesHistory blocks Worker requests with 403/503).
// Yahoo's chart API has the full history for ^NSEI, ^NSEBANK and most
// sectoral tickers. We backfill 90 days so sector_rotation analytic works.
//
// Map: NSE-name → Yahoo ticker (where available)
// ─────────────────────────────────────────────────────────
const YAHOO_INDEX_MAP = {
  'NIFTY 50':                 '^NSEI',
  'NIFTY BANK':               '^NSEBANK',
  'NIFTY IT':                 '^CNXIT',
  'NIFTY AUTO':               '^CNXAUTO',
  'NIFTY FMCG':               '^CNXFMCG',
  'NIFTY PHARMA':             '^CNXPHARMA',
  'NIFTY METAL':              '^CNXMETAL',
  'NIFTY REALTY':             '^CNXREALTY',
  'NIFTY ENERGY':             '^CNXENERGY',
  'NIFTY MEDIA':              '^CNXMEDIA',
  'NIFTY PSU BANK':           '^CNXPSUBANK',
  'NIFTY FIN SERVICE':        'NIFTY_FIN_SERVICE.NS',
  'NIFTY MIDCAP 100':         '^CNXMIDCAP',
  'NIFTY SMLCAP 100':         '^CNXSMCAP',
  'NIFTY INFRA':              '^CNXINFRA',
  'NIFTY COMMODITIES':        '^CNXCOMMOD',
  'NIFTY MNC':                '^CNXMNC',
};

async function backfillIndexHistoryYahoo(env, days = 90) {
  const now = Date.now();
  const from = now - days * 86400000;
  let totalRows = 0, indicesDone = 0, errors = [];

  for (const [nseName, yahooSymbol] of Object.entries(YAHOO_INDEX_MAP)) {
    try {
      const ticks = await yahooChart(yahooSymbol, { period1: from, period2: now, interval: '1d' });
      if (ticks.length === 0) {
        errors.push(`${nseName}: no data`);
        continue;
      }

      // Decide target table based on whether it's "sectoral"
      const isSectoral = !['NIFTY 50'].includes(nseName);

      // Write to BOTH indices_eod (for breadth) and sector_indices (for rotation)
      const idxRows = ticks.map(t => ({
        index_name: nseName,
        trade_date: new Date(t.ts).toISOString().slice(0, 10),
        open_paise: t.open != null ? Math.round(t.open * 100) : null,
        high_paise: t.high != null ? Math.round(t.high * 100) : null,
        low_paise: t.low != null ? Math.round(t.low * 100) : null,
        close_paise: Math.round(t.close * 100),
        prev_close_paise: null,
        pe_ratio: null, pb_ratio: null, div_yield: null,
        source: 'yahoo_backfill',
        ingested_at: now,
      }));
      const idxCols = ['index_name','trade_date','open_paise','high_paise','low_paise',
        'close_paise','prev_close_paise','pe_ratio','pb_ratio','div_yield','source','ingested_at'];
      const w1 = await batchInsert(env.DB, 'indices_eod', idxCols, idxRows, 'REPLACE');
      totalRows += w1;

      if (isSectoral) {
        const sectorRows = ticks.map(t => ({
          index_name: nseName,
          trade_date: new Date(t.ts).toISOString().slice(0, 10),
          open_paise: t.open != null ? Math.round(t.open * 100) : null,
          high_paise: t.high != null ? Math.round(t.high * 100) : null,
          low_paise: t.low != null ? Math.round(t.low * 100) : null,
          close_paise: Math.round(t.close * 100),
        }));
        const sectorCols = ['index_name','trade_date','open_paise','high_paise','low_paise','close_paise'];
        await batchInsert(env.DB, 'sector_indices', sectorCols, sectorRows, 'REPLACE');
      }
      indicesDone++;
    } catch (e) {
      errors.push(`${nseName}: ${e.message}`);
    }
  }
  return { rows: totalRows, indices_done: indicesDone, errors };
}

const HTTP_HANDLERS = {
  econ_calendar: ingestEconCalendar,
  earnings_calendar: ingestEarningsCalendar,
  sector_indices: ingestSectorIndices,
  most_active: ingestMostActive,
  breadth: ingestBreadth,
  backfill_index_history: backfillIndexHistoryYahoo,
  sector_history_refresh: backfillIndexHistoryYahoo,
  bond_direction: computeBondDirection,
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });
    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, WORKER_NAME, m[1], 'http');
      try {
        const r = await HTTP_HANDLERS[m[1]](env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return new Response('wealth-calendar-breadth', { status: 200 });
  },
};
