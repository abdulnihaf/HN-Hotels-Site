// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-price-core
// Layer 1 — Price & Volume (sources 1-10)
//
// Cron handlers: dispatched by scheduled() based on cron pattern.
// HTTP handlers: dispatched by /run/<source>?key=<DASHBOARD_KEY>
//                used for backfill and manual reruns.
//
// Sources covered:
//   1  NSE EOD bhavcopy           (cron: daily 18:00 IST)
//   2  BSE EOD bhavcopy           (cron: daily 18:15 IST)
//   3  NSE indices history        (cron: daily 17:35 IST)
//   4  NSE pre-open snapshot      (cron: 09:00-09:08 IST every minute)
//   5  NSE intraday quote         (cron: every 5 min during market)
//   6  NSE delivery %             (cron: daily 19:30 IST — joined into equity_eod)
//   7  Yahoo Finance India        (cron: every 15 min during market)
//   8  GIFT Nifty                 (cron: every 5 min 06:30-23:55 IST)
//   9  NSE 52-week high/low       (cron: daily 16:00 IST)
//   10 NSE upper/lower circuit    (cron: daily 16:00 IST)
// ═══════════════════════════════════════════════════════════════════════════

import {
  NSEClient,
  ymdHyphen,
  ymdCompact,
  ddmmyy,
  ddmmyyyy,
  rupeesToPaise,
  safeInt,
  safeFloat,
  isISTMarketDay,
  istNow,
} from '../../_shared/nseClient.js';
import { yahooChart, yahooEodIN } from '../../_shared/yahooClient.js';
import { csvToObjects, unzipFirst, parseCsv } from '../../_shared/csv.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-price-core';

// ────────────────────────────────────────────────
// SOURCE 1 — NSE EOD bhavcopy
// ────────────────────────────────────────────────
async function ingestNseBhavcopy(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const yyyymmdd = ymdCompact(target);
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const buf = await nse.getBhavcopy(yyyymmdd);
  if (!buf) return { rows: 0, skipped: 'bhavcopy-not-published-yet' };
  const csv = await unzipFirst(buf);
  const rowsObj = csvToObjects(csv);
  const ingestedAt = Date.now();
  const rows = [];
  for (const r of rowsObj) {
    const series = (r.SctySrs || r.SERIES || '').trim();
    if (series && series !== 'EQ' && series !== 'BE' && series !== 'BZ') continue;
    const symbol = (r.TckrSymb || r.SYMBOL || '').trim();
    if (!symbol) continue;
    rows.push({
      symbol,
      exchange: 'NSE',
      trade_date: dateStr,
      open_paise: rupeesToPaise(r.OpnPric || r.OPEN),
      high_paise: rupeesToPaise(r.HghPric || r.HIGH),
      low_paise: rupeesToPaise(r.LwPric || r.LOW),
      close_paise: rupeesToPaise(r.ClsPric || r.CLOSE),
      prev_close_paise: rupeesToPaise(r.PrvsClsgPric || r.PREVCLOSE),
      volume: safeInt(r.TtlTradgVol || r.TOTTRDQTY),
      total_trades: safeInt(r.TtlNbOfTxsExctd || r.TOTALTRADES),
      vwap_paise: null,
      series,
      isin: (r.ISIN || '').trim() || null,
      source: 'nse_bhavcopy',
      ingested_at: ingestedAt,
    });
  }
  const cols = ['symbol','exchange','trade_date','open_paise','high_paise','low_paise',
    'close_paise','prev_close_paise','volume','total_trades','vwap_paise','series',
    'isin','source','ingested_at'];
  const written = await batchInsert(env.DB, 'equity_eod', cols, rows, 'REPLACE');
  return { rows: written, attempted: rows.length };
}

// ────────────────────────────────────────────────
// SOURCE 2 — BSE EOD bhavcopy
// ────────────────────────────────────────────────
async function ingestBseBhavcopy(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dmy = ddmmyy(target);
  const dateStr = ymdHyphen(target);
  const url = `https://www.bseindia.com/download/BhavCopy/Equity/EQ${dmy}_CSV.zip`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.bseindia.com/',
    },
  });
  if (res.status === 404) return { rows: 0, skipped: 'bse-not-published-yet' };
  if (!res.ok) throw new Error(`BSE bhavcopy ${res.status}`);
  const buf = await res.arrayBuffer();
  const csv = await unzipFirst(buf);
  const rowsObj = csvToObjects(csv);
  const ingestedAt = Date.now();
  const rows = [];
  for (const r of rowsObj) {
    const symbol = (r.SC_NAME || r.TckrSymb || '').trim();
    const code = (r.SC_CODE || '').trim();
    if (!symbol || !code) continue;
    rows.push({
      symbol: code,
      exchange: 'BSE',
      trade_date: dateStr,
      open_paise: rupeesToPaise(r.OPEN),
      high_paise: rupeesToPaise(r.HIGH),
      low_paise: rupeesToPaise(r.LOW),
      close_paise: rupeesToPaise(r.CLOSE),
      prev_close_paise: rupeesToPaise(r.PREVCLOSE),
      volume: safeInt(r.NO_OF_SHRS || r.NO_TRADES),
      total_trades: safeInt(r.NO_TRADES),
      vwap_paise: null,
      series: null,
      isin: (r.ISIN_CODE || '').trim() || null,
      source: 'bse_bhavcopy',
      ingested_at: ingestedAt,
    });
  }
  const cols = ['symbol','exchange','trade_date','open_paise','high_paise','low_paise',
    'close_paise','prev_close_paise','volume','total_trades','vwap_paise','series',
    'isin','source','ingested_at'];
  const written = await batchInsert(env.DB, 'equity_eod', cols, rows, 'REPLACE');
  return { rows: written, attempted: rows.length };
}

// ────────────────────────────────────────────────
// SOURCE 3 — NSE indices history (135 indices, including 22 sectoral)
//
// NOTE: NSE's /api/allIndices serves the LAST traded value 24/7 — even on
// weekends and holidays it returns Friday's close. We always write the data,
// tagging trade_date with the last market day so weekend re-fires don't
// pollute under fictional Sat/Sun dates.
// ────────────────────────────────────────────────
function lastMarketDay(d) {
  const t = new Date(d);
  while (!isISTMarketDay(t)) t.setUTCDate(t.getUTCDate() - 1);
  return t;
}

async function ingestNseIndices(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : lastMarketDay(istNow());
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const data = await nse.getJson('/api/allIndices');
  const ingestedAt = Date.now();
  const rows = (data.data || []).map(d => ({
    index_name: d.indexSymbol || d.index,
    trade_date: dateStr,
    open_paise: rupeesToPaise(d.open),
    high_paise: rupeesToPaise(d.high),
    low_paise: rupeesToPaise(d.low),
    close_paise: rupeesToPaise(d.last),
    prev_close_paise: rupeesToPaise(d.previousClose),
    pe_ratio: safeFloat(d.pe),
    pb_ratio: safeFloat(d.pb),
    div_yield: safeFloat(d.dy),
    source: 'nse_allindices',
    ingested_at: ingestedAt,
  })).filter(r => r.index_name && r.close_paise != null);
  if (rows.length === 0) return { rows: 0, skipped: 'no-valid-indices' };
  const cols = ['index_name','trade_date','open_paise','high_paise','low_paise',
    'close_paise','prev_close_paise','pe_ratio','pb_ratio','div_yield','source','ingested_at'];
  const written = await batchInsert(env.DB, 'indices_eod', cols, rows, 'REPLACE');
  return { rows: written, total_indices: rows.length, trade_date: dateStr };
}

// ────────────────────────────────────────────────
// SOURCE 4 — NSE pre-open snapshot
// ────────────────────────────────────────────────
async function ingestPreopen(env) {
  const ts = Date.now();
  const nse = new NSEClient();
  const data = await nse.getJson('/api/market-data-pre-open?key=ALL');
  const items = data.data || [];
  const rows = items.map(d => {
    const md = d.metadata || {};
    return {
      symbol: md.symbol,
      ts,
      iep_paise: rupeesToPaise(md.iep || md.lastPrice),
      iep_change_pct: safeFloat(md.pChange),
      total_buy_qty: safeInt(d.totalBuyQuantity),
      total_sell_qty: safeInt(d.totalSellQuantity),
      prev_close_paise: rupeesToPaise(md.previousClose),
    };
  }).filter(r => r.symbol);
  const cols = ['symbol','ts','iep_paise','iep_change_pct','total_buy_qty','total_sell_qty','prev_close_paise'];
  const written = await batchInsert(env.DB, 'preopen_snapshot', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 5 — NSE intraday quote (most-active subset)
// ────────────────────────────────────────────────
async function ingestIntraday(env, symbols) {
  // Dynamically build the watchlist:
  //   1. Default seed (10 large-caps)
  //   2. + Open paper trades (so MTM ticks for them)
  //   3. + Open real positions (already covered by stop_loss watcher but add for safety)
  //   4. + User watchlist symbols
  //   5. + Top 20 signal symbols (so engine cards have fresh prices)
  const seed = (env.WATCHLIST_SYMBOLS || 'RELIANCE,HDFCBANK,ICICIBANK,INFY,TCS,SBIN,BAJFINANCE,LT,ITC,HINDUNILVR').split(',');
  const dynamic = new Set(symbols || seed);

  try {
    const paperOpen = (await env.DB.prepare(
      `SELECT DISTINCT symbol FROM paper_trades WHERE is_active=1`
    ).all()).results || [];
    paperOpen.forEach(r => dynamic.add(r.symbol));

    const realOpen = (await env.DB.prepare(
      `SELECT DISTINCT symbol FROM position_watchlist WHERE is_active=1`
    ).all()).results || [];
    realOpen.forEach(r => dynamic.add(r.symbol));

    const userWl = (await env.DB.prepare(
      `SELECT DISTINCT symbol FROM user_watchlist WHERE is_active=1`
    ).all()).results || [];
    userWl.forEach(r => dynamic.add(r.symbol));

    const topSig = (await env.DB.prepare(`
      SELECT s.symbol FROM signal_scores s
      JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m
      ORDER BY s.composite_score DESC LIMIT 20
    `).all()).results || [];
    topSig.forEach(r => dynamic.add(r.symbol));
  } catch (e) {
    // If queries fail (table missing etc), fall back to seed only
  }

  const watchlist = [...dynamic].slice(0, 50); // cap at 50 to fit in subrequest budget
  const ts = Date.now();
  const nse = new NSEClient();
  const rows = [];
  for (const sym of watchlist) {
    try {
      const j = await nse.getJson(`/api/quote-equity?symbol=${encodeURIComponent(sym)}`);
      const pi = j.priceInfo || {};
      const ltp = rupeesToPaise(pi.lastPrice);
      // Guard: NSE returns null lastPrice in pre-open / post-close. Skip those rows
      // entirely — a tick with no LTP is useless and was crashing the INSERT.
      if (ltp == null) continue;
      const mq = j.marketDeptOrderBook?.totalBuyQuantity ? j.marketDeptOrderBook : null;
      rows.push({
        symbol: sym,
        ts,
        ltp_paise: ltp,
        volume_cum: safeInt(j.preOpenMarket?.totalTradedVolume || j.securityWiseDP?.quantityTraded),
        bid_paise: rupeesToPaise(mq?.bidPrice),
        ask_paise: rupeesToPaise(mq?.askPrice),
        buy_qty: safeInt(mq?.totalBuyQuantity),
        sell_qty: safeInt(mq?.totalSellQuantity),
      });
    } catch (e) {
      // continue with the rest
    }
  }
  if (rows.length === 0) return { rows: 0, skipped: 'no-ltp-available' };
  const cols = ['symbol','ts','ltp_paise','volume_cum','bid_paise','ask_paise','buy_qty','sell_qty'];
  const written = await batchInsert(env.DB, 'intraday_ticks', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 6 — NSE delivery % (sec_bhavdata_full)
//
// NSE publishes sec_bhavdata_full_DDMMYYYY.csv at ~19:30 IST. The CSV holds
// SYMBOL, SERIES, DATE1, ..., DELIV_QTY, DELIV_PER (note: headers have
// leading spaces after commas — parseCsv keeps them, so we trim on lookup).
//
// Quirks:
//   * On NSE holidays the URL DOES return 200 but with the previous trading
//     day's data inside (DATE1 reflects the actual trade date). We therefore
//     read trade_date FROM the row's DATE1 column rather than the requested
//     date — this lets May 1 (Labour Day) calls correctly hydrate Apr 30 rows.
//   * ~3000 rows × sequential UPDATE = blows past 1000 subrequest cap and 30s
//     timeout. Use D1.batch() in chunks of ~50 to fit budget.
// ────────────────────────────────────────────────
const DELIVERY_BATCH_SIZE = 50;

function parseNseDate(s) {
  // "30-Apr-2026" -> "2026-04-30"
  const m = String(s || '').trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                   JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
  const mm = months[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}`;
}

async function ingestDelivery(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dmy8 = ddmmyyyy(target); // sec_bhavdata_full_DDMMYYYY.csv
  const requestedDate = ymdHyphen(target);
  const nse = new NSEClient();
  let text;
  try {
    text = await nse.getDeliveryReport(ymdCompact(target), dmy8);
  } catch (e) {
    return { rows: 0, skipped: 'fetch-error', error: String(e).slice(0, 200), dmy: dmy8 };
  }
  if (!text) return { rows: 0, skipped: 'delivery-not-published-yet', dmy: dmy8 };
  const rowsArr = parseCsv(text);
  if (rowsArr.length < 2) return { rows: 0, skipped: 'empty-csv' };
  const headers = rowsArr[0].map(h => h.trim());
  const idx = (name) => headers.findIndex(h => h.toUpperCase() === name);
  const iSym = idx('SYMBOL');
  const iSer = idx('SERIES');
  const iDate = idx('DATE1');
  const iDelQ = idx('DELIV_QTY');
  const iDelP = idx('DELIV_PER');
  if (iSym < 0 || iSer < 0 || iDelQ < 0 || iDelP < 0) {
    return { rows: 0, skipped: 'header-mismatch', headers };
  }

  // Determine actual trade date from the first usable row (DATE1 is per-row
  // but always identical within a single bhavdata file).
  let actualDate = requestedDate;
  for (let r = 1; r < rowsArr.length; r++) {
    const parsed = parseNseDate(rowsArr[r][iDate]);
    if (parsed) { actualDate = parsed; break; }
  }

  const updates = [];
  for (let r = 1; r < rowsArr.length; r++) {
    const row = rowsArr[r];
    const series = (row[iSer] || '').trim();
    if (series !== 'EQ' && series !== 'BE' && series !== 'BZ') continue;
    const sym = (row[iSym] || '').trim();
    if (!sym) continue;
    const dq = safeInt(row[iDelQ]);
    const dp = safeFloat(row[iDelP]);
    if (dq == null && dp == null) continue;
    updates.push([dq, dp, sym, actualDate]);
  }
  if (!updates.length) return { rows: 0, attempted: 0, trade_date: actualDate };

  // D1 batch UPDATE chunks — keeps subrequest count under control and
  // dramatically faster than awaiting each .run().
  const stmt = env.DB.prepare(
    `UPDATE equity_eod SET delivery_qty=?, delivery_pct=? WHERE symbol=? AND exchange='NSE' AND trade_date=?`
  );
  let written = 0;
  for (let i = 0; i < updates.length; i += DELIVERY_BATCH_SIZE) {
    const chunk = updates.slice(i, i + DELIVERY_BATCH_SIZE);
    const results = await env.DB.batch(chunk.map(u => stmt.bind(...u)));
    for (const r of results) written += r.meta?.changes || 0;
  }
  return {
    rows: written,
    attempted: updates.length,
    trade_date: actualDate,
    requested_date: requestedDate,
  };
}

// ────────────────────────────────────────────────
// SOURCE 7 — Yahoo Finance India (backup EOD)
// ────────────────────────────────────────────────
async function ingestYahooEod(env, symbol, fromMs, toMs) {
  const ticks = await yahooEodIN(symbol, fromMs, toMs);
  const ingestedAt = Date.now();
  const rows = ticks.map(t => {
    const d = new Date(t.ts);
    return {
      symbol,
      exchange: 'NSE',
      trade_date: ymdHyphen(d),
      open_paise: rupeesToPaise(t.open),
      high_paise: rupeesToPaise(t.high),
      low_paise: rupeesToPaise(t.low),
      close_paise: rupeesToPaise(t.close),
      prev_close_paise: null,
      volume: safeInt(t.volume),
      total_trades: null,
      vwap_paise: null,
      series: 'EQ',
      isin: null,
      source: 'yahoo',
      ingested_at: ingestedAt,
    };
  });
  const cols = ['symbol','exchange','trade_date','open_paise','high_paise','low_paise',
    'close_paise','prev_close_paise','volume','total_trades','vwap_paise','series',
    'isin','source','ingested_at'];
  const written = await batchInsert(env.DB, 'equity_eod', cols, rows, 'IGNORE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 8 — GIFT Nifty (Yahoo proxy)
//
// Yahoo doesn't expose GIFT Nifty futures directly with a stable ticker.
// As a practical proxy we use ^NSEI (Nifty 50 spot) with a 5-day window
// at 15m granularity — that gives us the last published close ALWAYS,
// even on weekends, plus pre-open ticks during early IST hours when
// Yahoo updates ^NSEI ahead of the IN open.
// ────────────────────────────────────────────────
async function ingestGiftNifty(env) {
  // 5-day window at 15m granularity = stable + always returns recent data
  const ticks = await yahooChart('^NSEI', { range: '5d', interval: '15m' });
  if (!ticks.length) return { rows: 0, skipped: 'yahoo-empty' };
  // Take the last 12 ticks (3 hours of context) so we have direction info
  const lastN = ticks.slice(-12);
  const prev = lastN[0]?.close;
  const latest = lastN[lastN.length - 1];
  const changePct = (prev && latest?.close) ? ((latest.close - prev) / prev * 100) : null;
  const rows = lastN.map(t => ({
    ts: t.ts,
    ltp: t.close,
    change_pct: t.close && prev ? ((t.close - prev) / prev * 100) : null,
    contract_month: null,
    volume: t.volume,
  }));
  const cols = ['ts','ltp','change_pct','contract_month','volume'];
  const written = await batchInsert(env.DB, 'gift_nifty_ticks', cols, rows, 'REPLACE');
  return { rows: written, latest_ltp: latest?.close, change_pct: changePct };
}

// ────────────────────────────────────────────────
// SOURCE 9 — NSE 52-week highs/lows
// ────────────────────────────────────────────────
async function ingest52w(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const rows = [];
  for (const which of ['high', 'low']) {
    const data = await nse.getJson(`/api/live-analysis-data-52weekhighstock?index=${which === 'high' ? 'high' : 'low'}`);
    const list = data.data || data || [];
    for (const d of list) {
      rows.push({
        trade_date: dateStr,
        symbol: d.symbol,
        extreme_type: which === 'high' ? '52w_high' : '52w_low',
        price_paise: rupeesToPaise(d.ltp || d.lastPrice || d.new_high || d.new_low),
      });
    }
  }
  const cols = ['trade_date','symbol','extreme_type','price_paise'];
  const written = await batchInsert(env.DB, 'weekly_extremes', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 10 — NSE upper/lower circuits
// ────────────────────────────────────────────────
async function ingestCircuits(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const rows = [];
  for (const which of ['upper', 'lower']) {
    try {
      const data = await nse.getJson(`/api/live-analysis-circuits?index=${which}`);
      const list = data.data || [];
      for (const d of list) {
        rows.push({
          trade_date: dateStr,
          symbol: d.symbol,
          circuit_type: which,
          band_pct: safeFloat(d.bandPercentage || d.band),
          ltp_paise: rupeesToPaise(d.ltp || d.lastPrice),
        });
      }
    } catch (e) {
      // continue
    }
  }
  const cols = ['trade_date','symbol','circuit_type','band_pct','ltp_paise'];
  const written = await batchInsert(env.DB, 'circuit_hits', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// Backfill — CHUNKED architecture
// One invocation processes max ~20 trading days (well under 30s timeout
// + 1000 subrequest cap). Orchestrator calls this repeatedly until done.
// State is persisted in backfill_progress.date_completed so we resume.
// ────────────────────────────────────────────────
const MAX_DAYS_PER_CHUNK = 3;  // 3 days × ~7 sec (with D1.batch) ≈ 21s, fits 30s Worker timeout
const SOFT_TIMEOUT_MS = 25000; // exit gracefully before hard kill so logCronEnd + progress update run

async function backfillRange(env, source, dateFrom, dateTo) {
  const startTs = Date.now();
  // Resume: find date_completed for this (source, dateFrom)
  const progress = await env.DB.prepare(
    `SELECT date_completed FROM backfill_progress WHERE source_name=? AND date_from=?`
  ).bind(source, dateFrom).first();

  let cursorDate = progress?.date_completed
    ? new Date(`${progress.date_completed}T12:00:00Z`)
    : new Date(`${dateFrom}T12:00:00Z`);
  // Move past last completed day
  if (progress?.date_completed) cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);

  const end = new Date(`${dateTo}T12:00:00Z`);
  if (cursorDate > end) {
    return { rows: 0, status: 'already-complete' };
  }

  let totalRows = 0;
  let daysProcessed = 0;
  let lastDate = ymdHyphen(cursorDate);
  let lastError = null;

  for (let d = new Date(cursorDate); d <= end && daysProcessed < MAX_DAYS_PER_CHUNK; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isISTMarketDay(d)) continue;
    // Soft timeout: bail before Cloudflare hard-kills us so we can still
    // update progress + close the cron_run_log row cleanly.
    if (Date.now() - startTs > SOFT_TIMEOUT_MS) {
      lastError = `soft-timeout at ${ymdHyphen(d)} after ${daysProcessed} days`;
      break;
    }
    const ds = ymdHyphen(d);
    try {
      let res;
      if (source === 'nse_bhavcopy') res = await ingestNseBhavcopy(env, ds);
      else if (source === 'bse_bhavcopy') res = await ingestBseBhavcopy(env, ds);
      else if (source === 'delivery') res = await ingestDelivery(env, ds);
      else throw new Error(`Unknown backfill source: ${source}`);
      totalRows += res.rows || 0;
      daysProcessed++;
      lastDate = ds;
    } catch (e) {
      // Record per-day error but continue chunk
      lastError = `${ds}: ${String(e).slice(0, 200)}`;
      lastDate = ds;
      daysProcessed++;
    }
  }

  // Determine status: complete if cursor passed end, partial otherwise
  const advancedTo = new Date(`${lastDate}T12:00:00Z`);
  advancedTo.setUTCDate(advancedTo.getUTCDate() + 1);
  const isComplete = advancedTo > end;
  const status = isComplete ? 'complete' : 'partial';

  // Update progress (insert or replace)
  await env.DB.prepare(
    `INSERT INTO backfill_progress (source_name,date_from,date_to,date_completed,rows_loaded,status,last_attempt_at,error)
     VALUES (?,?,?,?,COALESCE((SELECT rows_loaded FROM backfill_progress WHERE source_name=? AND date_from=?),0)+?,?,?,?)
     ON CONFLICT(source_name,date_from) DO UPDATE SET
       date_completed=excluded.date_completed,
       rows_loaded=COALESCE((SELECT rows_loaded FROM backfill_progress WHERE source_name=? AND date_from=?),0)+excluded.rows_loaded,
       status=excluded.status,
       last_attempt_at=excluded.last_attempt_at,
       error=excluded.error`
  ).bind(
    source, dateFrom, dateTo, lastDate,
    source, dateFrom, totalRows, status, Date.now(), lastError,
    source, dateFrom
  ).run();

  return {
    rows: totalRows,
    days: daysProcessed,
    chunk_complete: isComplete,
    last_date: lastDate,
    status,
  };
}

// ────────────────────────────────────────────────
// Cron dispatcher (matches cron pattern → handler)
// ────────────────────────────────────────────────
// Cloudflare uses the literal cron expression as dispatch key — duplicate
// expressions silently overwrite. Every entry MUST have a unique key.
// Paid tier — frequencies optimized for max freshness.
const CRON_MAP = {
  // EOD daily reports (one-shot)
  '5 12 * * 1-5':   { name: 'nse_indices',   fn: ingestNseIndices },     // 17:35 IST
  '30 12 * * 1-5':  { name: 'nse_bhavcopy',  fn: ingestNseBhavcopy },    // 18:00 IST
  '45 12 * * 1-5':  { name: 'bse_bhavcopy',  fn: ingestBseBhavcopy },    // 18:15 IST
  '0 14 * * 1-5':   { name: 'delivery',      fn: ingestDelivery },       // 19:30 IST
  '30 10 * * 1-5':  { name: '52w_extremes',  fn: ingest52w },            // 16:00 IST
  '31 10 * * 1-5':  { name: 'circuits',      fn: ingestCircuits },       // 16:01 IST (was colliding with 52w)
  // Pre-open — TZ-1 fix May 6 2026 evening
  // Was '0-8 3 * * 1-5' (= 08:30-08:38 IST, BEFORE NSE pre-open opens at 09:00).
  // Now fires correctly during NSE pre-open session 09:00-09:08 IST.
  '30-38 3 * * 1-5': { name: 'preopen',      fn: ingestPreopen },        // 09:00-09:08 IST
  // Intraday quotes — TZ-2 fix May 6 2026 evening
  // Was '*/1 3-10 * * 1-5' (= 08:30-16:29 IST, polluted intraday_ticks with
  // 45 min pre-market + 59 min post-market data). Split into 3 ranges covering
  // EXACTLY 09:15-15:30 IST. All three dispatch to the same ingestIntraday handler.
  '45-59 3 * * 1-5': { name: 'intraday',     fn: ingestIntraday },       // 09:15-09:29 IST
  '* 4-9 * * 1-5':   { name: 'intraday',     fn: ingestIntraday },       // 09:30-15:29 IST
  '0 10 * * 1-5':    { name: 'intraday',     fn: ingestIntraday },       // 15:30 IST close
  // Yahoo backup — every 15 min, offset to avoid collision with intraday
  '7-52/15 3-10 * * 1-5': { name: 'yahoo_eod', fn: async (env) => {
    return ingestYahooEod(env, 'RELIANCE', Date.now() - 86400000 * 2, Date.now());
  }},
  // GIFT Nifty extended hours
  '*/5 1-18 * * *': { name: 'gift_nifty',    fn: ingestGiftNifty },      // every 5 min 06:30-23:55 IST
};

async function runCron(env, cronExpr) {
  const entry = CRON_MAP[cronExpr];
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

// ────────────────────────────────────────────────
// HTTP dispatcher: /run/<source>?key=<DASHBOARD_KEY>&date=YYYY-MM-DD
//                 /backfill?source=...&from=...&to=...&key=...
//                 /status
// ────────────────────────────────────────────────
const HTTP_HANDLERS = {
  'nse_bhavcopy':   ingestNseBhavcopy,
  'bse_bhavcopy':   ingestBseBhavcopy,
  'nse_indices':    ingestNseIndices,
  'preopen':        ingestPreopen,
  'intraday':       ingestIntraday,
  'delivery':       ingestDelivery,
  'gift_nifty':     ingestGiftNifty,
  '52w_extremes':   ingest52w,
  'circuits':       ingestCircuits,
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.cron));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (key !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });

    if (url.pathname === '/status') {
      const { results } = await env.DB.prepare(
        `SELECT cron_name, status, started_at, finished_at, rows_written, error_message
         FROM cron_run_log ORDER BY started_at DESC LIMIT 50`
      ).all();
      return Response.json({ recent_runs: results });
    }

    if (url.pathname === '/backfill') {
      const source = url.searchParams.get('source');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!source || !from || !to) return new Response('source/from/to required', { status: 400 });
      const id = await logCronStart(env.DB, WORKER_NAME, `backfill:${source}`, 'http');
      try {
        const r = await backfillRange(env, source, from, to);
        await logCronEnd(env.DB, id, 'success', r.rows, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m) {
      const source = m[1];
      const fn = HTTP_HANDLERS[source];
      if (!fn) return new Response('unknown source', { status: 404 });
      const date = url.searchParams.get('date');
      const id = await logCronStart(env.DB, WORKER_NAME, source, 'http');
      try {
        const r = await fn(env, date);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        await markSourceHealth(env.DB, source, true);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        await markSourceHealth(env.DB, source, false, e);
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    return new Response('wealth-price-core: try /status, /run/<source>, /backfill', { status: 200 });
  },
};
