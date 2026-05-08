// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-options
// Layer 3 — Options Chain & Volatility (sources 19-23)
//
// Sources:
//   19 NSE option chain Nifty       (every 5 min during market)
//   20 NSE option chain Bank Nifty  (every 5 min during market)
//   21 NSE option chain Fin Nifty   (every 15 min)
//   22 NSE stock options (top 50)   (every 30 min — rotates through subset)
//   23 India VIX                    (every 15 min during market)
// ═══════════════════════════════════════════════════════════════════════════

import { NSEClient, isISTMarketDay, istNow, rupeesToPaise, safeInt, safeFloat, ymdHyphen } from '../../_shared/nseClient.js';
import { yahooChart } from '../../_shared/yahooClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-options';

async function ingestOptionChain(env, underlying) {
  if (!isISTMarketDay(istNow())) return { rows: 0, skipped: 'non-market-day' };
  const ts = Date.now();
  const nse = new NSEClient();
  const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(underlying);
  const path = isIndex
    ? `/api/option-chain-indices?symbol=${underlying}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(underlying)}`;
  const data = await nse.getJson(path);
  const records = data?.records?.data || [];
  const underlyingValue = data?.records?.underlyingValue;
  const rows = [];
  for (const r of records) {
    const expiry = r.expiryDate;
    const strike = rupeesToPaise(r.strikePrice);
    if (!expiry || strike == null) continue;
    rows.push({
      ts,
      underlying,
      expiry,
      strike_paise: strike,
      ce_oi: safeInt(r.CE?.openInterest),
      ce_chg_oi: safeInt(r.CE?.changeinOpenInterest),
      ce_volume: safeInt(r.CE?.totalTradedVolume),
      ce_iv: safeFloat(r.CE?.impliedVolatility),
      ce_ltp_paise: rupeesToPaise(r.CE?.lastPrice),
      ce_bid_paise: rupeesToPaise(r.CE?.bidprice),
      ce_ask_paise: rupeesToPaise(r.CE?.askPrice),
      pe_oi: safeInt(r.PE?.openInterest),
      pe_chg_oi: safeInt(r.PE?.changeinOpenInterest),
      pe_volume: safeInt(r.PE?.totalTradedVolume),
      pe_iv: safeFloat(r.PE?.impliedVolatility),
      pe_ltp_paise: rupeesToPaise(r.PE?.lastPrice),
      pe_bid_paise: rupeesToPaise(r.PE?.bidprice),
      pe_ask_paise: rupeesToPaise(r.PE?.askPrice),
      underlying_paise: rupeesToPaise(underlyingValue),
    });
  }
  const cols = ['ts','underlying','expiry','strike_paise','ce_oi','ce_chg_oi','ce_volume','ce_iv',
    'ce_ltp_paise','ce_bid_paise','ce_ask_paise','pe_oi','pe_chg_oi','pe_volume','pe_iv',
    'pe_ltp_paise','pe_bid_paise','pe_ask_paise','underlying_paise'];
  const written = await batchInsert(env.DB, 'option_chain_snapshot', cols, rows, 'REPLACE');
  return { rows: written, underlying, snapshots: rows.length };
}

async function ingestNiftyChain(env)   { return ingestOptionChain(env, 'NIFTY'); }
async function ingestBankNiftyChain(env) { return ingestOptionChain(env, 'BANKNIFTY'); }
async function ingestFinNiftyChain(env)  { return ingestOptionChain(env, 'FINNIFTY'); }
async function ingestMidcpNiftyChain(env) { return ingestOptionChain(env, 'MIDCPNIFTY'); }

// ────────────────────────────────────────────────
// Kite-based option chain ingestion
// NSE's /api/option-chain-indices returns {} from Worker IPs (verified blocked).
// Pivot: Kite's /quote endpoint serves OI + LTP + volume + bid/ask for any NFO
// instrument token, no Greeks but everything our scoring dim needs.
// ────────────────────────────────────────────────

// Map our underlying code → indices_eod.index_name for spot lookup.
const SPOT_INDEX_NAME = {
  NIFTY:      'NIFTY 50',
  BANKNIFTY:  'NIFTY BANK',
  FINNIFTY:   'NIFTY FIN SERVICE',
  MIDCPNIFTY: 'NIFTY MID SELECT',
};

async function getKiteToken(env) {
  const tok = await env.DB.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (!tok || tok.expires_at <= Date.now()) return null;
  if (!env.KITE_API_KEY) return null;
  return tok;
}

async function kiteOptionChain(env, underlying) {
  if (!isISTMarketDay(istNow())) return { rows: 0, skipped: 'non-market-day' };
  const tok = await getKiteToken(env);
  if (!tok) return { rows: 0, skipped: 'no-active-kite-token' };

  // 1. Pick the latest (nearest) expiry available in kite_instruments for this underlying.
  const expiryRow = await env.DB.prepare(
    `SELECT MIN(expiry) AS expiry FROM kite_instruments
     WHERE name=? AND instrument_type IN ('CE','PE') AND expiry >= date('now')`
  ).bind(underlying).first();
  const expiry = expiryRow?.expiry;
  if (!expiry) return { rows: 0, skipped: `no-expiry-found-for-${underlying}` };

  // 2. All strikes for that underlying+expiry.
  const strikeRows = (await env.DB.prepare(
    `SELECT instrument_token, tradingsymbol, strike, instrument_type
     FROM kite_instruments
     WHERE name=? AND expiry=? AND instrument_type IN ('CE','PE')
     ORDER BY strike, instrument_type`
  ).bind(underlying, expiry).all()).results || [];
  if (strikeRows.length === 0) return { rows: 0, skipped: `no-strikes-for-${underlying}-${expiry}` };

  // 3. Spot from indices_eod (latest available close).
  const spotName = SPOT_INDEX_NAME[underlying];
  if (!spotName) return { rows: 0, skipped: `no-spot-mapping-${underlying}` };
  const spotRow = await env.DB.prepare(
    `SELECT close_paise FROM indices_eod WHERE index_name=? ORDER BY trade_date DESC LIMIT 1`
  ).bind(spotName).first();
  const spotPaise = spotRow?.close_paise;
  if (!spotPaise) return { rows: 0, skipped: `no-spot-${spotName}` };
  const spot = spotPaise / 100;

  // 4. Find ATM strike + filter ±10 strikes.
  const allStrikes = [...new Set(strikeRows.map(r => r.strike))].sort((a, b) => a - b);
  if (allStrikes.length === 0) return { rows: 0, skipped: 'no-strike-list' };
  // Pick strike closest to spot
  let atmIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < allStrikes.length; i++) {
    const d = Math.abs(allStrikes[i] - spot);
    if (d < bestDiff) { bestDiff = d; atmIdx = i; }
  }
  const lo = Math.max(0, atmIdx - 10);
  const hi = Math.min(allStrikes.length - 1, atmIdx + 10);
  const wantStrikes = new Set(allStrikes.slice(lo, hi + 1));
  const targets = strikeRows.filter(r => wantStrikes.has(r.strike));
  if (targets.length === 0) return { rows: 0, skipped: 'no-targets-after-filter' };

  // 5. Bulk-fetch quotes. Kite supports multiple `i=` query params.
  // Format: NFO:NIFTY24500CE — use the tradingsymbol from kite_instruments.
  const params = targets.map(t => `i=${encodeURIComponent('NFO:' + t.tradingsymbol)}`).join('&');
  const url = `https://api.kite.trade/quote?${params}`;
  const r = await fetch(url, {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Kite quote ${r.status}: ${errText.slice(0, 200)}`);
  }
  const quotesJson = await r.json();
  const quotes = quotesJson.data || {};

  // 6. Pair CE + PE per strike → option_chain_snapshot row.
  const ts = Date.now();
  // Build a lookup: tradingsymbol → (instrument_type, strike, quote)
  const byStrike = new Map();  // strike → { CE: {...}, PE: {...} }
  for (const t of targets) {
    const key = `NFO:${t.tradingsymbol}`;
    const q = quotes[key];
    if (!q) continue;
    if (!byStrike.has(t.strike)) byStrike.set(t.strike, {});
    byStrike.get(t.strike)[t.instrument_type] = q;
  }

  const rows = [];
  for (const [strike, sides] of byStrike.entries()) {
    const ce = sides.CE || {};
    const pe = sides.PE || {};
    const ceDepth = ce.depth || {};
    const peDepth = pe.depth || {};
    rows.push({
      ts,
      underlying,
      expiry,
      strike_paise: rupeesToPaise(strike),
      ce_oi: safeInt(ce.oi),
      ce_chg_oi: null,                                // Kite /quote doesn't expose change-in-OI; computed downstream from prior snapshot
      ce_volume: safeInt(ce.volume_traded ?? ce.volume),
      ce_iv: null,                                    // Kite quote endpoint doesn't include IV
      ce_ltp_paise: rupeesToPaise(ce.last_price),
      ce_bid_paise: rupeesToPaise(ceDepth.buy?.[0]?.price),
      ce_ask_paise: rupeesToPaise(ceDepth.sell?.[0]?.price),
      pe_oi: safeInt(pe.oi),
      pe_chg_oi: null,
      pe_volume: safeInt(pe.volume_traded ?? pe.volume),
      pe_iv: null,
      pe_ltp_paise: rupeesToPaise(pe.last_price),
      pe_bid_paise: rupeesToPaise(peDepth.buy?.[0]?.price),
      pe_ask_paise: rupeesToPaise(peDepth.sell?.[0]?.price),
      underlying_paise: spotPaise,
    });
  }

  const cols = ['ts','underlying','expiry','strike_paise','ce_oi','ce_chg_oi','ce_volume','ce_iv',
    'ce_ltp_paise','ce_bid_paise','ce_ask_paise','pe_oi','pe_chg_oi','pe_volume','pe_iv',
    'pe_ltp_paise','pe_bid_paise','pe_ask_paise','underlying_paise'];
  const written = await batchInsert(env.DB, 'option_chain_snapshot', cols, rows, 'REPLACE');
  return { rows: written, underlying, expiry, atm_strike: allStrikes[atmIdx], strikes: rows.length, source: 'kite' };
}

async function kiteNiftyChain(env)      { return kiteOptionChain(env, 'NIFTY'); }
async function kiteBankNiftyChain(env)  { return kiteOptionChain(env, 'BANKNIFTY'); }
async function kiteFinNiftyChain(env)   { return kiteOptionChain(env, 'FINNIFTY'); }
async function kiteMidcpNiftyChain(env) { return kiteOptionChain(env, 'MIDCPNIFTY'); }

async function ingestStockOptions(env) {
  if (!isISTMarketDay(istNow())) return { rows: 0, skipped: 'non-market-day' };
  const list = (env.STOCK_OPTIONS_TOP || 'RELIANCE,HDFCBANK,ICICIBANK,INFY,TCS,SBIN,BAJFINANCE,LT,ITC,HINDUNILVR').split(',');
  // Rotate through the list to respect rate limits — pick 5 per cron tick
  const minute = new Date().getUTCMinutes();
  const idx = Math.floor(minute / 30) % Math.ceil(list.length / 5);
  const subset = list.slice(idx * 5, idx * 5 + 5);
  let total = 0;
  for (const sym of subset) {
    try {
      const r = await ingestOptionChain(env, sym);
      total += r.rows || 0;
    } catch (e) {
      // continue
    }
  }
  return { rows: total };
}

// ────────────────────────────────────────────────
// SOURCE 23 — India VIX
// ────────────────────────────────────────────────
async function ingestIndiaVix(env) {
  // Yahoo carries India VIX as ^INDIAVIX (intermittent). NSE indices feed has it daily.
  const ts = Date.now();
  const nse = new NSEClient();
  try {
    const data = await nse.getJson('/api/allIndices');
    const vix = (data.data || []).find(d => /VIX/i.test(d.indexSymbol || d.index || ''));
    if (vix) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO india_vix_ticks (ts,vix,change_pct) VALUES (?,?,?)`
      ).bind(ts, safeFloat(vix.last), safeFloat(vix.percentChange)).run();
      return { rows: 1, vix: vix.last };
    }
  } catch (e) {
    // fall through to yahoo
  }
  try {
    const ticks = await yahooChart('^INDIAVIX', { range: '1d', interval: '15m' });
    const last = ticks[ticks.length - 1];
    if (last) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO india_vix_ticks (ts,vix,change_pct) VALUES (?,?,?)`
      ).bind(ts, last.close, null).run();
      return { rows: 1, vix: last.close };
    }
  } catch (e) {}
  return { rows: 0 };
}

// ────────────────────────────────────────────────
// Cron dispatcher
// IST 09:15-15:30 → UTC 03:45-10:00 (every 5 min for indices)
// ────────────────────────────────────────────────
// Unique cron expressions only. Paid tier — every-minute on Nifty/BankNifty
// (the two indices that drive 80% of derivative trading).
const CRON_DISPATCH = {
  // Index option chains — Kite-backed (NSE direct returns {} from Worker IPs).
  '*/1 3-10 * * 1-5':   { name: 'nifty_chain',     fn: kiteNiftyChain },        // every 1 min
  '*/2 3-10 * * 1-5':   { name: 'banknifty_chain', fn: kiteBankNiftyChain },    // every 2 min
  '*/5 3-10 * * 1-5':   { name: 'finnifty_chain',  fn: kiteFinNiftyChain },     // every 5 min
  '*/10 3-10 * * 1-5':  { name: 'stock_options',   fn: ingestStockOptions },    // every 10 min — still NSE (equity opt fallback)
  '*/3 3-10 * * 1-5':   { name: 'india_vix',       fn: ingestIndiaVix },        // every 3 min
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

const HTTP_HANDLERS = {
  // Kite-backed (default for index chains)
  nifty_chain:     kiteNiftyChain,
  banknifty_chain: kiteBankNiftyChain,
  finnifty_chain:  kiteFinNiftyChain,
  midcpnifty_chain: kiteMidcpNiftyChain,
  // NSE-backed fallbacks (kept available for manual override / equity options)
  nifty_chain_nse:     ingestNiftyChain,
  banknifty_chain_nse: ingestBankNiftyChain,
  finnifty_chain_nse:  ingestFinNiftyChain,
  stock_options:   ingestStockOptions,
  india_vix:       ingestIndiaVix,
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });

    // Generic Kite chain runner: /run/kite_option_chain?underlying=NIFTY
    if (url.pathname === '/run/kite_option_chain') {
      const underlying = (url.searchParams.get('underlying') || '').toUpperCase();
      const allowed = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'];
      if (!allowed.includes(underlying)) {
        return Response.json({ ok: false, error: `underlying must be one of ${allowed.join(',')}` }, { status: 400 });
      }
      const id = await logCronStart(env.DB, WORKER_NAME, `kite_option_chain:${underlying}`, 'http');
      try {
        const r = await kiteOptionChain(env, underlying);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

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
    return new Response('wealth-options', { status: 200 });
  },
};
