// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-flow-engine
// Layer 2 — Institutional Flow & Positioning (sources 11-18)
//
// Sources:
//   11 NSE FII/DII cash                  (cron: daily 18:30 IST)
//   12 NSE FII derivative stats          (cron: daily 19:00 IST)
//   13 NSE F&O participant-wise OI       (cron: daily 19:30 IST)
//   14 NSE bulk deals                    (cron: daily 17:30 IST)
//   15 NSE block deals                   (cron: daily 17:30 IST)
//   16 BSE bulk + block deals            (cron: daily 17:45 IST)
//   17 NSE F&O ban list                  (cron: 18:00 IST + intraday 11:30, 14:30)
//   18 NSE securities-wise position MWPL (cron: daily 19:00 IST)
//
// Backfill range: 3 May 2024 → 2 May 2026 (~500 trading days)
// ═══════════════════════════════════════════════════════════════════════════

import {
  NSEClient, ymdHyphen, ymdCompact, isISTMarketDay, istNow,
  rupeesToPaise, safeInt, safeFloat,
} from '../../_shared/nseClient.js';
import { csvToObjects, parseCsv } from '../../_shared/csv.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-flow-engine';

// Stable hash for deduplication (FNV-1a over a string).
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ────────────────────────────────────────────────
// SOURCE 11 — NSE FII/DII cash
//
// NOTE: NSE's /api/fiidiiTradeReact is a "today only" endpoint — it has no date
// parameter and always returns the most recent published session. Each row in
// the response carries its own `date` field in DD-MMM-YYYY format (e.g.
// "30-Apr-2026"). We MUST trust that date and ignore wall-clock + dateOverride,
// or backfill loops will silently rewrite the same value under different dates.
//
// dateOverride is accepted for compatibility with the orchestrator's backfill
// signature, but if it doesn't match what NSE published, we skip the write and
// return a clear `skipped` reason so the caller can route to a historical source.
// ────────────────────────────────────────────────
function parseNseDdMonYyyy(s) {
  // "30-Apr-2026" → "2026-04-30"  (returns null on parse failure)
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

async function ingestFiiDiiCash(env, dateOverride) {
  const nse = new NSEClient();
  const data = await nse.getJson('/api/fiidiiTradeReact');
  if (!Array.isArray(data) || data.length === 0) {
    return { rows: 0, skipped: 'empty-response' };
  }
  const ingestedAt = Date.now();

  // Pivot rows by (response-published date, segment). Trust NSE's date field;
  // fall back to today only if the field is missing.
  const byDateSeg = {};
  for (const d of data) {
    const seg = (d.category && /derivative|futures|fno/i.test(d.category)) ? 'derivative' : 'cash';
    const responseDate = parseNseDdMonYyyy(d.date) || ymdHyphen(istNow());
    const k = `${responseDate}|${seg}`;
    byDateSeg[k] = byDateSeg[k] || {
      trade_date: responseDate, segment: seg,
      fii_buy_cr: null, fii_sell_cr: null, fii_net_cr: null,
      dii_buy_cr: null, dii_sell_cr: null, dii_net_cr: null,
      ingested_at: ingestedAt,
    };
    const cat = (d.category || '').toUpperCase();
    if (cat.startsWith('FII') || cat.startsWith('FPI')) {
      byDateSeg[k].fii_buy_cr = safeFloat(d.buyValue);
      byDateSeg[k].fii_sell_cr = safeFloat(d.sellValue);
      byDateSeg[k].fii_net_cr = safeFloat(d.netValue);
    } else if (cat.startsWith('DII')) {
      byDateSeg[k].dii_buy_cr = safeFloat(d.buyValue);
      byDateSeg[k].dii_sell_cr = safeFloat(d.sellValue);
      byDateSeg[k].dii_net_cr = safeFloat(d.netValue);
    }
  }
  const merged = Object.values(byDateSeg);

  // If a backfill called this with a specific date and NSE published a different
  // date, we'd otherwise corrupt that historical date with the latest value.
  // Skip the write and surface a backfill-incompatible reason.
  if (dateOverride) {
    const wanted = String(dateOverride).slice(0, 10);
    const published = merged.map(r => r.trade_date);
    if (!published.includes(wanted)) {
      return {
        rows: 0,
        skipped: `not-historical-source (wanted ${wanted}, NSE published ${published.join(',')})`,
        published_dates: published,
      };
    }
  }

  const cols = ['trade_date','segment','fii_buy_cr','fii_sell_cr','fii_net_cr',
    'dii_buy_cr','dii_sell_cr','dii_net_cr','ingested_at'];
  const written = await batchInsert(env.DB, 'fii_dii_daily', cols, merged, 'REPLACE');
  return { rows: written, dates_written: merged.map(r => r.trade_date) };
}

// ────────────────────────────────────────────────
// SOURCE 12 — NSE FII derivative stats
// ────────────────────────────────────────────────
async function ingestFiiDeriv(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  // The endpoint is published as a daily CSV under /api/fiiDeriv
  const data = await nse.getJson('/api/fiiDeriv');
  const items = Array.isArray(data) ? data : (data?.data || []);
  const rows = items.map(d => ({
    trade_date: dateStr,
    instrument: (d.instrument || d.instrumentName || 'unknown').toUpperCase(),
    buy_contracts: safeInt(d.buyContracts),
    buy_value_cr: safeFloat(d.buyValue),
    sell_contracts: safeInt(d.sellContracts),
    sell_value_cr: safeFloat(d.sellValue),
    oi_contracts: safeInt(d.openInterest || d.oiContracts),
    oi_value_cr: safeFloat(d.oiValue),
  })).filter(r => r.instrument && r.instrument !== 'UNKNOWN');
  const cols = ['trade_date','instrument','buy_contracts','buy_value_cr',
    'sell_contracts','sell_value_cr','oi_contracts','oi_value_cr'];
  const written = await batchInsert(env.DB, 'fii_deriv_daily', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 13 — NSE F&O participant-wise OI (CSV report)
// File: https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_DDMMYYYY.csv
// ────────────────────────────────────────────────
async function ingestFnoParticipantOi(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dateStr = ymdHyphen(target);
  const dd = String(target.getUTCDate()).padStart(2, '0');
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = target.getUTCFullYear();
  const url = `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${dd}${mm}${yyyy}.csv`;
  const nse = new NSEClient();
  await nse.warm();
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.nseindia.com/',
      'Cookie': nse.cookies,
    },
  });
  if (res.status === 404) return { rows: 0, skipped: 'not-published-yet' };
  if (!res.ok) throw new Error(`participant_oi ${res.status}`);
  const text = await res.text();
  // The file has a 1-line preamble then a real header. Split lines and find header row.
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const headerIdx = lines.findIndex(l => /Client Type/i.test(l));
  if (headerIdx < 0) return { rows: 0, skipped: 'no-header' };
  const csvText = lines.slice(headerIdx).join('\n');
  const objs = csvToObjects(csvText);
  const rows = [];
  // Each row contains long/short OI for a (participant, instrument) pair.
  // NSE schema: Client Type, Future Index Long, Future Index Short, Future Stock Long, ..., Option Index Call Long, ...
  for (const o of objs) {
    const participant = (o['Client Type'] || '').trim();
    if (!participant) continue;
    const map = [
      { instr: 'futidx', longK: 'Future Index Long', shortK: 'Future Index Short' },
      { instr: 'futstk', longK: 'Future Stock Long', shortK: 'Future Stock Short' },
      { instr: 'optidx_call', longK: 'Option Index Call Long', shortK: 'Option Index Call Short' },
      { instr: 'optidx_put', longK: 'Option Index Put Long', shortK: 'Option Index Put Short' },
      { instr: 'optstk_call', longK: 'Option Stock Call Long', shortK: 'Option Stock Call Short' },
      { instr: 'optstk_put', longK: 'Option Stock Put Long', shortK: 'Option Stock Put Short' },
    ];
    for (const m of map) {
      rows.push({
        trade_date: dateStr,
        participant: participant.toUpperCase(),
        instrument: m.instr,
        long_oi: safeInt(o[m.longK]),
        short_oi: safeInt(o[m.shortK]),
        long_value_cr: null,
        short_value_cr: null,
      });
    }
  }
  const cols = ['trade_date','participant','instrument','long_oi','short_oi','long_value_cr','short_value_cr'];
  const written = await batchInsert(env.DB, 'fno_participant_oi', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 14 — NSE bulk deals
// ────────────────────────────────────────────────
// Helper: parse NSE date "30-Apr-2026" → "2026-04-30"
function parseNseDate(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

// ────────────────────────────────────────────────
// Combined NSE bulk + block deals (single endpoint, current day's data)
//
// NSE's /api/historical/bulk-deals returns 503 to Workers reliably.
// /api/snapshot-capital-market-largedeal returns BOTH bulk + block in one call.
// ────────────────────────────────────────────────
async function ingestNseBulkDeals(env, _dateOverride) {
  const nse = new NSEClient();
  // NSE serves this 24/7 with the most recent published date
  const data = await nse.getJson('/api/snapshot-capital-market-largedeal');
  const ingestedAt = Date.now();
  const rows = [];

  for (const d of (data.BULK_DEALS_DATA || [])) {
    const symbol = (d.symbol || '').trim();
    if (!symbol) continue;
    const tradeDate = parseNseDate(d.date) || ymdHyphen(istNow());
    const client = (d.clientName || '').trim();
    const txn = (d.buySell || '').toLowerCase().includes('buy') ? 'buy' : 'sell';
    const qty = safeInt(d.qty);
    const price = rupeesToPaise(d.watp || d.tradePrice);
    rows.push({
      id: hash(`${tradeDate}|NSE|${symbol}|${client}|${txn}|${qty}|${price}|bulk`),
      trade_date: tradeDate, exchange: 'NSE',
      symbol, deal_type: 'bulk', client_name: client, txn_type: txn,
      qty, price_paise: price, ingested_at: ingestedAt,
    });
  }
  for (const d of (data.BLOCK_DEALS_DATA || [])) {
    const symbol = (d.symbol || '').trim();
    if (!symbol) continue;
    const tradeDate = parseNseDate(d.date) || ymdHyphen(istNow());
    const client = (d.clientName || '').trim();
    const txn = (d.buySell || '').toLowerCase().includes('buy') ? 'buy' : 'sell';
    const qty = safeInt(d.qty);
    const price = rupeesToPaise(d.watp || d.tradePrice);
    rows.push({
      id: hash(`${tradeDate}|NSE|${symbol}|${client}|${txn}|${qty}|${price}|block`),
      trade_date: tradeDate, exchange: 'NSE',
      symbol, deal_type: 'block', client_name: client, txn_type: txn,
      qty, price_paise: price, ingested_at: ingestedAt,
    });
  }
  if (rows.length === 0) return { rows: 0, skipped: 'no-deals-published' };
  const cols = ['id','trade_date','exchange','symbol','deal_type','client_name','txn_type','qty','price_paise','ingested_at'];
  const written = await batchInsert(env.DB, 'bulk_block_deals', cols, rows, 'IGNORE');
  return {
    rows: written,
    bulk_count: data.BULK_DEALS_DATA?.length || 0,
    block_count: data.BLOCK_DEALS_DATA?.length || 0,
  };
}

// ────────────────────────────────────────────────
// SOURCE 15 — NSE block deals
// (Now consolidated into ingestNseBulkDeals via /snapshot-capital-market-largedeal
// since NSE blocks the historical/block-deals endpoint with 503.)
// Kept as a thin alias so existing cron registrations don't break.
// ────────────────────────────────────────────────
async function ingestNseBlockDeals(env) {
  // The combined endpoint already wrote both bulk + block; nothing to do here.
  return { rows: 0, skipped: 'consolidated-into-nse_bulk' };
}

// ────────────────────────────────────────────────
// SOURCE 16 — BSE bulk + block deals
// CSV endpoints:
//   bulk:  https://www.bseindia.com/markets/equity/EQReports/bulk.aspx
//   block: https://www.bseindia.com/markets/equity/EQReports/block_deals.aspx
// We use the BSE API instead which returns JSON.
// ────────────────────────────────────────────────
async function ingestBseDeals(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const yyyymmdd = ymdCompact(target);
  const dateStr = ymdHyphen(target);
  const ingestedAt = Date.now();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.bseindia.com/markets/equity/EQReports/BulkDeals.aspx',
  };
  let totalRows = 0;
  for (const dealType of ['bulk', 'block']) {
    const apiPath = dealType === 'bulk'
      ? `https://api.bseindia.com/BseIndiaAPI/api/BulkDeals/w?Fdate=${yyyymmdd}&TDate=${yyyymmdd}&Pageno=1`
      : `https://api.bseindia.com/BseIndiaAPI/api/BlockDeals/w?Fdate=${yyyymmdd}&TDate=${yyyymmdd}&Pageno=1`;
    try {
      const res = await fetch(apiPath, { headers });
      if (!res.ok) continue;
      const j = await res.json();
      const items = j?.Table || j?.data || [];
      const rows = items.map(d => {
        const symbol = (d.SCRIP_CD || d.scripcode || d.SecCode || '').toString().trim();
        const client = (d.CLIENT_NAME || d.ClientName || '').trim();
        const txnRaw = (d.DEAL_TYPE || d.BuySell || '').toLowerCase();
        const txn = txnRaw.startsWith('b') || txnRaw.includes('buy') ? 'buy' : 'sell';
        const qty = safeInt(d.QTY_TRADED || d.Qty || d.qty);
        const price = rupeesToPaise(d.TRADE_PRICE_WGTAVG || d.TradePrice || d.price);
        return {
          id: hash(`${dateStr}|BSE|${symbol}|${client}|${txn}|${qty}|${price}|${dealType}`),
          trade_date: dateStr,
          exchange: 'BSE',
          symbol,
          deal_type: dealType,
          client_name: client,
          txn_type: txn,
          qty,
          price_paise: price,
          ingested_at: ingestedAt,
        };
      }).filter(r => r.symbol);
      const cols = ['id','trade_date','exchange','symbol','deal_type','client_name','txn_type','qty','price_paise','ingested_at'];
      totalRows += await batchInsert(env.DB, 'bulk_block_deals', cols, rows, 'IGNORE');
    } catch (e) {
      // try the other type
    }
  }
  return { rows: totalRows };
}

// ────────────────────────────────────────────────
// SOURCE 17 — NSE F&O ban list
// ────────────────────────────────────────────────
async function ingestFnoBanList(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dateStr = ymdHyphen(target);
  const nse = new NSEClient();
  const data = await nse.getJson('/api/fno-securities-ban');
  const items = data?.banSecurities || data?.data || [];
  const rows = items.map(d => ({
    trade_date: dateStr,
    symbol: (typeof d === 'string' ? d : (d.symbol || d.scrip || '')).trim().toUpperCase(),
  })).filter(r => r.symbol);
  const cols = ['trade_date','symbol'];
  const written = await batchInsert(env.DB, 'fno_ban_list', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 18 — NSE securities-wise position MWPL
// File: https://nsearchives.nseindia.com/content/nsccl/mwpl_DDMMYYYY.csv
// Each row: SYMBOL, MWPL, OPEN_INTEREST, %_OF_MWPL
// ────────────────────────────────────────────────
async function ingestMwpl(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const dd = String(target.getUTCDate()).padStart(2, '0');
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = target.getUTCFullYear();
  const dateStr = ymdHyphen(target);
  const url = `https://nsearchives.nseindia.com/content/nsccl/mwpl_${dd}${mm}${yyyy}.csv`;
  const nse = new NSEClient();
  await nse.warm();
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.nseindia.com/',
      'Cookie': nse.cookies,
    },
  });
  if (res.status === 404) return { rows: 0, skipped: 'not-published-yet' };
  if (!res.ok) throw new Error(`mwpl ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const headerIdx = lines.findIndex(l => /SYMBOL/i.test(l) && /MWPL/i.test(l));
  if (headerIdx < 0) return { rows: 0, skipped: 'no-header' };
  const csvText = lines.slice(headerIdx).join('\n');
  const objs = csvToObjects(csvText);
  const rows = objs.map(o => {
    const symbol = (o.SYMBOL || o.Symbol || '').trim();
    if (!symbol) return null;
    const pctKey = Object.keys(o).find(k => /%/.test(k) || /MWPL.*PCT/i.test(k));
    return {
      trade_date: dateStr,
      symbol,
      mwpl_pct: safeFloat(o[pctKey] || o['MWPL %'] || o['% OF MWPL']),
    };
  }).filter(Boolean);
  const cols = ['trade_date','symbol','mwpl_pct'];
  const written = await batchInsert(env.DB, 'mwpl_utilization', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// Backfill — CHUNKED architecture (same as W1)
// One invocation processes max ~20 trading days. Orchestrator calls
// repeatedly until backfill_progress.date_completed reaches dateTo.
// ────────────────────────────────────────────────
const MAX_DAYS_PER_CHUNK = 8;  // each chunk ~8-15 sec wall, fits 28sec timeout

async function backfillRange(env, source, dateFrom, dateTo) {
  const fnMap = {
    fii_dii_cash: ingestFiiDiiCash,
    fii_deriv: ingestFiiDeriv,
    fno_participant_oi: ingestFnoParticipantOi,
    nse_bulk: ingestNseBulkDeals,
    nse_block: ingestNseBlockDeals,
    bse_deals: ingestBseDeals,
    mwpl: ingestMwpl,
  };
  const fn = fnMap[source];
  if (!fn) throw new Error(`Unknown backfill source: ${source}`);

  // Resume from last completed day
  const progress = await env.DB.prepare(
    `SELECT date_completed FROM backfill_progress WHERE source_name=? AND date_from=?`
  ).bind(source, dateFrom).first();

  let cursorDate = progress?.date_completed
    ? new Date(`${progress.date_completed}T12:00:00Z`)
    : new Date(`${dateFrom}T12:00:00Z`);
  if (progress?.date_completed) cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);

  const end = new Date(`${dateTo}T12:00:00Z`);
  if (cursorDate > end) return { rows: 0, status: 'already-complete' };

  let totalRows = 0;
  let daysProcessed = 0;
  let lastDate = ymdHyphen(cursorDate);
  let lastError = null;

  for (let d = new Date(cursorDate); d <= end && daysProcessed < MAX_DAYS_PER_CHUNK; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isISTMarketDay(d)) continue;
    const ds = ymdHyphen(d);
    try {
      const r = await fn(env, ds);
      totalRows += r.rows || 0;
      daysProcessed++;
      lastDate = ds;
    } catch (e) {
      lastError = `${ds}: ${String(e).slice(0, 200)}`;
      lastDate = ds;
      daysProcessed++;
    }
  }

  const advancedTo = new Date(`${lastDate}T12:00:00Z`);
  advancedTo.setUTCDate(advancedTo.getUTCDate() + 1);
  const isComplete = advancedTo > end;
  const status = isComplete ? 'complete' : 'partial';

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

  return { rows: totalRows, days: daysProcessed, chunk_complete: isComplete, last_date: lastDate, status };
}

// ────────────────────────────────────────────────
// Cron dispatcher (UTC)
// IST 17:30 → UTC 12:00   IST 17:45 → UTC 12:15
// IST 18:00 → UTC 12:30   IST 18:30 → UTC 13:00
// IST 19:00 → UTC 13:30   IST 19:30 → UTC 14:00
// IST 11:30 → UTC 06:00   IST 14:30 → UTC 09:00
// ────────────────────────────────────────────────
// Each cron expression must be unique (Cloudflare uses literal expr as dispatch key).
// Paid tier — MWPL + ban list refresh more frequently for live signal accuracy.
const CRON_DISPATCH = {
  // EOD reports
  '0 12 * * 1-5':  { name: 'nse_bulk_block', fn: async (e) => {
    const a = await ingestNseBulkDeals(e);
    const b = await ingestNseBlockDeals(e);
    return { rows: (a.rows||0) + (b.rows||0) };
  }},                                                                            // 17:30 IST
  '15 12 * * 1-5': { name: 'bse_deals',          fn: ingestBseDeals },           // 17:45 IST
  '30 12 * * 1-5': { name: 'fno_ban',            fn: ingestFnoBanList },         // 18:00 IST
  '0 13 * * 1-5':  { name: 'fii_dii_cash',       fn: ingestFiiDiiCash },         // 18:30 IST
  '30 13 * * 1-5': { name: 'fii_deriv',          fn: ingestFiiDeriv },           // 19:00 IST
  '31 13 * * 1-5': { name: 'mwpl',               fn: ingestMwpl },               // 19:01 IST (was colliding with fii_deriv)
  '0 14 * * 1-5':  { name: 'fno_participant_oi', fn: ingestFnoParticipantOi },   // 19:30 IST
  // Intraday F&O ban refresh
  '0 6 * * 1-5':   { name: 'fno_ban_1130',       fn: ingestFnoBanList },         // 11:30 IST
  '0 8 * * 1-5':   { name: 'fno_ban_1330',       fn: ingestFnoBanList },         // 13:30 IST
  '0 9 * * 1-5':   { name: 'fno_ban_1430',       fn: ingestFnoBanList },         // 14:30 IST
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

// ────────────────────────────────────────────────
// HTTP dispatcher
// ────────────────────────────────────────────────
const HTTP_HANDLERS = {
  'fii_dii_cash':       ingestFiiDiiCash,
  'fii_deriv':          ingestFiiDeriv,
  'fno_participant_oi': ingestFnoParticipantOi,
  'nse_bulk':           ingestNseBulkDeals,
  'nse_block':          ingestNseBlockDeals,
  'bse_deals':          ingestBseDeals,
  'fno_ban':            ingestFnoBanList,
  'mwpl':               ingestMwpl,
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
         FROM cron_run_log WHERE worker_name=? ORDER BY started_at DESC LIMIT 50`
      ).bind(WORKER_NAME).all();
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

    return new Response('wealth-flow-engine: try /status, /run/<source>, /backfill', { status: 200 });
  },
};
