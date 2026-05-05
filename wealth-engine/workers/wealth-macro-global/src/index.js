// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-macro-global
// Layer 5b — Global Macro & Cross-Asset (sources 32, 37-43)
//
// 32 FRED — US rates/CPI/jobs (daily 08:00 IST)
// 37 DXY                       (every 15 min 24×5)
// 38 US 10Y yield              (every 15 min 24×5)
// 39 VIX (CBOE)                (every 15 min 24×5)
// 40 S&P/Nasdaq/Dow futures    (every 15 min 24×5)
// 41 Brent + WTI crude         (every 15 min 24×5)
// 42 Gold + Silver + Copper    (every 15 min 24×5)
// 43 Asian indices             (every 15 min during their hours)
// ═══════════════════════════════════════════════════════════════════════════

import { yahooChart } from '../../_shared/yahooClient.js';
import { ymdHyphen, istNow, safeFloat } from '../../_shared/nseClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-macro-global';

const CROSSASSET_MAP = {
  DXY:    'DX-Y.NYB',
  US10Y:  '^TNX',
  US2Y:   '^IRX',
  VIX_US: '^VIX',
  SPX_F:  'ES=F',
  NDX_F:  'NQ=F',
  DJI_F:  'YM=F',
  BRENT:  'BZ=F',
  WTI:    'CL=F',
  GOLD:   'GC=F',
  SILVER: 'SI=F',
  COPPER: 'HG=F',
  NIKKEI: '^N225',
  HSI:    '^HSI',
  KOSPI:  '^KS11',
  USDINR: 'INR=X',
};

async function ingestCrossAssetTicks(env, codes) {
  const now = Date.now();
  const rows = [];
  for (const code of codes) {
    const sym = CROSSASSET_MAP[code];
    if (!sym) continue;
    try {
      const ticks = await yahooChart(sym, { range: '1d', interval: '15m' });
      const last = ticks[ticks.length - 1];
      if (last && last.close != null) {
        rows.push({ asset_code: code, ts: now, value: safeFloat(last.close) });
      }
    } catch (e) {}
  }
  const cols = ['asset_code','ts','value'];
  const written = await batchInsert(env.DB, 'crossasset_ticks', cols, rows, 'REPLACE');
  return { rows: written, codes };
}

async function ingestRates(env)    { return ingestCrossAssetTicks(env, ['DXY','US10Y','US2Y','VIX_US','USDINR']); }
async function ingestEquityFut(env){ return ingestCrossAssetTicks(env, ['SPX_F','NDX_F','DJI_F']); }
async function ingestCommods(env)  { return ingestCrossAssetTicks(env, ['BRENT','WTI','GOLD','SILVER','COPPER']); }
async function ingestAsianIdx(env) { return ingestCrossAssetTicks(env, ['NIKKEI','HSI','KOSPI']); }

// SOURCE 32 — FRED
const FRED_SERIES = [
  { id: 'FEDFUNDS',  code: 'US_FFR' },
  { id: 'CPIAUCSL',  code: 'US_CPI' },
  { id: 'UNRATE',    code: 'US_UNEMP' },
  { id: 'PAYEMS',    code: 'US_PAYROLLS' },
  { id: 'DGS10',     code: 'US_10Y_DAILY' },
  { id: 'DGS2',      code: 'US_2Y_DAILY' },
  { id: 'T10Y2Y',    code: 'US_10Y_2Y_SPREAD' },
  { id: 'DEXINUS',   code: 'INR_USD_DAILY' },
];

async function ingestFred(env) {
  if (!env.FRED_API_KEY) return { rows: 0, skipped: 'missing-FRED_API_KEY' };
  const rows = [];
  for (const s of FRED_SERIES) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=5`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      for (const obs of (j.observations || [])) {
        if (obs.value === '.' || obs.value === '') continue;
        rows.push({
          indicator_code: s.code,
          observation_date: obs.date,
          value: safeFloat(obs.value),
          source: 'fred',
          release_ts: Date.now(),
        });
      }
    } catch (e) {}
  }
  const cols = ['indicator_code','observation_date','value','source','release_ts'];
  const written = await batchInsert(env.DB, 'macro_indicators', cols, rows, 'REPLACE');
  return { rows: written };
}

// Unique expressions only. Paid tier — every 5 min on rates/futures/commods
// for real-time cross-asset signals (was 15 min, with 2/3 silently disabled).
const CRON_DISPATCH = {
  '*/5 * * * 1-5':       { name: 'cross_rates',   fn: ingestRates },        // every 5 min  (DXY, US 10Y, US 2Y, USDINR, VIX)
  '1-56/5 * * * 1-5':    { name: 'cross_equity',  fn: ingestEquityFut },    // every 5 min offset 1 (S&P/Nasdaq/Dow futures, was disabled)
  '2-57/5 * * * 1-5':    { name: 'cross_commods', fn: ingestCommods },      // every 5 min offset 2 (Brent/WTI/gold/silver/copper, was disabled)
  '*/10 0-9 * * 1-5':    { name: 'asian_idx',     fn: ingestAsianIdx },     // every 10 min during Asian hours
  '30 2 * * *':          { name: 'fred',          fn: ingestFred },         // 08:00 IST daily (US macro release calendar)
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
  cross_rates: ingestRates,
  cross_equity: ingestEquityFut,
  cross_commods: ingestCommods,
  asian_idx: ingestAsianIdx,
  fred: ingestFred,
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
    return new Response('wealth-macro-global', { status: 200 });
  },
};
