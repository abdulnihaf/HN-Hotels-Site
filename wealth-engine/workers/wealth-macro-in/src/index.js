// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-macro-in
// Layer 5a — India Macro + Layer 7 weather/power adjuncts
//
// 33 RBI database          daily 08:30 IST
// 34 GST collection         monthly 1st evening
// 35 MoSPI (CPI/IIP/WPI)    monthly on release
// 36 India PMI (S&P)        monthly 1st-3rd
// 56 IMD weather/monsoon    daily 14:00 IST
// 57 POSOCO power           daily 10:00 IST
// 61 India bond yields      daily 18:00 IST
// ═══════════════════════════════════════════════════════════════════════════

import { ymdHyphen, istNow, safeFloat } from '../../_shared/nseClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-macro-in';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function ingestRbi(env) {
  // RBI publishes a "daily statistical handbook" CSV. We capture the headline
  // policy rates from the home page (parse first numeric value after labels).
  const html = await fetchText('https://www.rbi.org.in/home.aspx');
  const ingestedAt = Date.now();
  const today = ymdHyphen(istNow());
  const grab = (label) => {
    const re = new RegExp(`${label}[^0-9]*([0-9]+\\.[0-9]+)`, 'i');
    const m = html.match(re);
    return m ? safeFloat(m[1]) : null;
  };
  const rows = [
    { indicator_code: 'IN_REPO',    observation_date: today, value: grab('Policy Repo Rate'), source: 'rbi', release_ts: ingestedAt },
    { indicator_code: 'IN_REVREPO', observation_date: today, value: grab('Reverse Repo'), source: 'rbi', release_ts: ingestedAt },
    { indicator_code: 'IN_MSF',     observation_date: today, value: grab('Marginal Standing Facility'), source: 'rbi', release_ts: ingestedAt },
    { indicator_code: 'IN_BANK',    observation_date: today, value: grab('Bank Rate'), source: 'rbi', release_ts: ingestedAt },
    { indicator_code: 'IN_CRR',     observation_date: today, value: grab('CRR'), source: 'rbi', release_ts: ingestedAt },
    { indicator_code: 'IN_SLR',     observation_date: today, value: grab('SLR'), source: 'rbi', release_ts: ingestedAt },
  ].filter(r => r.value != null);
  const cols = ['indicator_code','observation_date','value','source','release_ts'];
  const written = await batchInsert(env.DB, 'macro_indicators', cols, rows, 'REPLACE');
  return { rows: written };
}

async function ingestGst(env) {
  // GST monthly collection — parsed from PIB press release listing
  // Falls back to a conservative no-op if structure changes.
  try {
    const html = await fetchText('https://gstcouncil.gov.in/');
    const m = html.match(/(?:Gross\s+GST\s+collections|GST\s+collection)[^₹]*₹\s*([0-9,]+)\s*crore/i);
    if (!m) return { rows: 0, skipped: 'no-headline-found' };
    const value = parseFloat(m[1].replace(/,/g,''));
    const today = ymdHyphen(istNow());
    await env.DB.prepare(
      `INSERT OR REPLACE INTO macro_indicators (indicator_code,observation_date,value,source,release_ts) VALUES (?,?,?,?,?)`
    ).bind('IN_GST_TOTAL', today, value, 'gst-pib', Date.now()).run();
    return { rows: 1, value };
  } catch {
    return { rows: 0 };
  }
}

async function ingestMospi(env) {
  // MoSPI press release listings — we look for headline numbers in latest releases.
  try {
    const html = await fetchText('https://mospi.gov.in/press-release');
    const ingestedAt = Date.now();
    const rows = [];
    const cpi = html.match(/CPI[^0-9]*([0-9]+\.[0-9]+)\s*(?:per\s*cent|%)/i);
    const iip = html.match(/IIP[^0-9]*([0-9]+\.[0-9]+)\s*(?:per\s*cent|%)/i);
    const wpi = html.match(/WPI[^0-9]*([0-9]+\.[0-9]+)\s*(?:per\s*cent|%)/i);
    const today = ymdHyphen(istNow());
    if (cpi) rows.push({ indicator_code: 'IN_CPI_YOY', observation_date: today, value: safeFloat(cpi[1]), source: 'mospi', release_ts: ingestedAt });
    if (iip) rows.push({ indicator_code: 'IN_IIP_YOY', observation_date: today, value: safeFloat(iip[1]), source: 'mospi', release_ts: ingestedAt });
    if (wpi) rows.push({ indicator_code: 'IN_WPI_YOY', observation_date: today, value: safeFloat(wpi[1]), source: 'mospi', release_ts: ingestedAt });
    const cols = ['indicator_code','observation_date','value','source','release_ts'];
    const written = await batchInsert(env.DB, 'macro_indicators', cols, rows, 'REPLACE');
    return { rows: written };
  } catch { return { rows: 0 }; }
}

async function ingestPmi(env) {
  try {
    const html = await fetchText('https://www.spglobal.com/marketintelligence/en/mi/research-analysis/india-pmi.html');
    const m = html.match(/(?:Manufacturing|Composite)\s*PMI[^0-9]*([0-9]+\.[0-9]+)/i);
    if (!m) return { rows: 0 };
    const today = ymdHyphen(istNow());
    await env.DB.prepare(
      `INSERT OR REPLACE INTO macro_indicators (indicator_code,observation_date,value,source,release_ts) VALUES (?,?,?,?,?)`
    ).bind('IN_PMI_MFG', today, safeFloat(m[1]), 'spglobal', Date.now()).run();
    return { rows: 1 };
  } catch { return { rows: 0 }; }
}

async function ingestImd(env) {
  // IMD posts daily rainfall + monsoon forecast updates. We capture the all-India
  // departure-from-LPA percentage when the seasonal forecast is updated.
  try {
    const html = await fetchText('https://mausam.imd.gov.in/');
    const m = html.match(/(?:departure|deficiency|surplus)[^-0-9%]*([\-]?\d+(?:\.\d+)?)\s*%/i);
    if (!m) return { rows: 0 };
    const today = ymdHyphen(istNow());
    await env.DB.prepare(
      `INSERT OR REPLACE INTO weather_macro (observation_date,region,rainfall_mm,rainfall_dev_pct,forecast_horizon)
       VALUES (?,?,?,?,?)`
    ).bind(today, 'ALL_INDIA', null, safeFloat(m[1]), 'daily').run();
    return { rows: 1 };
  } catch { return { rows: 0 }; }
}

async function ingestPosoco(env) {
  try {
    const html = await fetchText('https://posoco.in/reports/daily-reports/');
    const m = html.match(/Total\s*demand\s*met[^0-9]*([0-9,]+)/i);
    if (!m) return { rows: 0 };
    const value = parseFloat(m[1].replace(/,/g,''));
    const today = ymdHyphen(istNow());
    await env.DB.prepare(
      `INSERT OR REPLACE INTO power_consumption (observation_date,total_demand_mw,yoy_change_pct) VALUES (?,?,?)`
    ).bind(today, value, null).run();
    return { rows: 1 };
  } catch { return { rows: 0 }; }
}

async function ingestBondYields(env) {
  // CCIL benchmark yields page is dynamic — we use Yahoo for INR 10Y as proxy
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/INRYY10Y.BO?range=1d&interval=1d';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
    if (!res.ok) return { rows: 0 };
    const j = await res.json();
    const close = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.slice(-1)[0];
    if (close == null) return { rows: 0 };
    const today = ymdHyphen(istNow());
    await env.DB.prepare(
      `INSERT OR REPLACE INTO bond_yields (trade_date,tenor,yield_pct) VALUES (?,?,?)`
    ).bind(today, '10Y', safeFloat(close)).run();
    return { rows: 1, value: close };
  } catch { return { rows: 0 }; }
}

const CRON_DISPATCH = {
  '0 3 * * *':       { name: 'rbi',          fn: ingestRbi },        // 08:30 IST
  '0 13 1 * *':      { name: 'gst',          fn: ingestGst },        // Monthly 18:30 IST 1st
  '0 13 12 * *':     { name: 'mospi',        fn: ingestMospi },      // Monthly 18:30 IST 12th
  '0 13 3 * *':      { name: 'pmi',          fn: ingestPmi },        // Monthly 18:30 IST 3rd
  '30 8 * * *':      { name: 'imd',          fn: ingestImd },        // 14:00 IST
  '30 4 * * *':      { name: 'posoco',       fn: ingestPosoco },     // 10:00 IST
  '30 12 * * 1-5':   { name: 'bond_yields',  fn: ingestBondYields }, // 18:00 IST
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

const HTTP_HANDLERS = { rbi:ingestRbi, gst:ingestGst, mospi:ingestMospi, pmi:ingestPmi, imd:ingestImd, posoco:ingestPosoco, bond_yields:ingestBondYields };

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
    return new Response('wealth-macro-in', { status: 200 });
  },
};
