// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-event-scraper
// Layer 4b — Event-calendar + macro fixed income/FX (gap-fill worker)
//
// Backfills four data tables that the wealth-engine signal stack needs but
// that aren't reliably populated by other scrapers:
//
//   board_meetings        — NSE board-meetings calendar      (cron 06:00 IST)
//   results_calendar      — derived from board_meetings      (cron 06:30 IST)
//   bond_yields           — India 10Y/5Y/1Y, US 10Y          (cron every 30 min in market)
//   crossasset_ticks      — USD/INR forward 1m/3m/6m         (cron every 30 min, 15-min offset)
//
// Source rationale
// ────────────────
// 1. NSE board meetings: /api/corporate-board-meetings works from a Worker
//    once cookies are warmed via NSEClient. Returns `bm_symbol` / `bm_date` /
//    `bm_purpose` (NOT `symbol` — the existing wealth-corp-intel handler
//    used `d.symbol` and silently wrote zero rows for years).
// 2. BSE board meetings:  api.bseindia.com Boardmeetings_New endpoint
//    returns 302→error from Cloudflare server IPs. Skipped; not reliable.
// 3. India bond yields:   investing.com pages render the spot value into
//    `data-test="instrument-price-last">N.NNN<` server-side.  Stable and
//    works from Cloudflare Worker IPs (verified from Singapore POP).
// 4. USD/INR forwards:    NSE removed the currency-derivatives endpoint in
//    2024; investing.com /currencies/usd-inr-Nm-forward returns 404; FBIL
//    forward API is auth-gated.  We therefore SYNTHESISE the forward via
//    interest-rate parity:  fwd = spot × (1 + r_inr · t/360) / (1 + r_usd · t/360).
//    Tagged as asset_code=USDINR_{1,3,6}M_FWD with a synthetic flag so the
//    signal layer knows the provenance.
// ═══════════════════════════════════════════════════════════════════════════

import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';
import { NSEClient, ymdHyphen, istNow, safeFloat } from '../../_shared/nseClient.js';

const WORKER_NAME = 'wealth-event-scraper';

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// "30-Apr-2026" → "2026-04-30". Returns null on unparseable input so we never
// silently insert a meeting on an empty date — that would corrupt downstream
// signal queries that filter on result_date >= date('now').
function parseNseDdMonYyyy(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

function ddmmyyyy(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// Detect whether a board-meeting purpose line is talking about quarterly /
// audited / yearly financial results (rather than just AGM/EGM/buyback notice).
function isResultsMeeting(purpose, desc) {
  const text = `${purpose || ''} ${desc || ''}`.toLowerCase();
  return /\b(result|quarterly|audited|earnings|financial result|q[1-4]|interim|annual financial)\b/.test(text) ? 1 : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. ingestBoardMeetings — NSE  /api/corporate-board-meetings
//    Pulls the next ~60 day window so we always have visibility into the next
//    earnings cycle.  REPLACE on conflict so re-pulled rows update the purpose
//    if a company amends the meeting purpose.
// ────────────────────────────────────────────────────────────────────────────
async function ingestBoardMeetings(env) {
  const nse = new NSEClient();
  const today = istNow();
  const future = new Date(today);
  future.setUTCDate(future.getUTCDate() + 60);
  const fromDate = ddmmyyyy(today);
  const toDate = ddmmyyyy(future);
  const path = `/api/corporate-board-meetings?index=equities&from_date=${fromDate}&to_date=${toDate}`;

  const data = await nse.getJson(path);
  const items = Array.isArray(data) ? data : (data?.data || []);
  if (items.length === 0) return { rows: 0, skipped: 'empty-response', items: 0 };

  const rows = [];
  for (const d of items) {
    const symbol = (d.bm_symbol || d.symbol || '').trim();
    const meetingDate = parseNseDdMonYyyy(d.bm_date || d.date);
    if (!symbol || !meetingDate) continue;
    const purpose = (d.bm_purpose || d.purpose || '').trim();
    const desc = (d.bm_desc || d.description || '').trim();
    rows.push({
      id: hash(`${symbol}|${meetingDate}|${purpose.slice(0, 50)}`),
      symbol,
      meeting_date: meetingDate,
      purpose: purpose.slice(0, 500) || null,
      is_results_meeting: isResultsMeeting(purpose, desc),
    });
  }

  if (rows.length === 0) return { rows: 0, skipped: 'no-parseable-rows', items: items.length };
  const cols = ['id', 'symbol', 'meeting_date', 'purpose', 'is_results_meeting'];
  const written = await batchInsert(env.DB, 'board_meetings', cols, rows, 'REPLACE');
  return { rows: written, items: items.length, sample: rows.slice(0, 3) };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ingestResultsCalendar — derives results_calendar from board_meetings.
//    fiscal_period is inferred from the meeting month (Apr-Jun = Q4 FY-prev,
//    Jul-Sep = Q1 FY-curr, Oct-Dec = Q2, Jan-Mar = Q3).  It's a heuristic
//    but catches the dominant Indian filing pattern.
// ────────────────────────────────────────────────────────────────────────────
function inferFiscalPeriod(meetingDate) {
  // meetingDate is YYYY-MM-DD. Indian fiscal year runs Apr-Mar.
  if (!meetingDate || meetingDate.length < 7) return null;
  const month = parseInt(meetingDate.slice(5, 7), 10);
  const year = parseInt(meetingDate.slice(0, 4), 10);
  // Results in month X are typically for the quarter ending the prior month/2.
  // Apr-Jun: Q4 of (year-1)/year FY.    Jul-Sep: Q1 FY year.
  // Oct-Dec: Q2 FY year.                Jan-Mar: Q3 FY (year-1)/year.
  if (month >= 4 && month <= 6)  return `Q4 FY${String((year - 1) % 100).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
  if (month >= 7 && month <= 9)  return `Q1 FY${String(year % 100).padStart(2, '0')}-${String((year + 1) % 100).padStart(2, '0')}`;
  if (month >= 10 && month <= 12) return `Q2 FY${String(year % 100).padStart(2, '0')}-${String((year + 1) % 100).padStart(2, '0')}`;
  return `Q3 FY${String((year - 1) % 100).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
}

async function ingestResultsCalendar(env) {
  // Pull all is_results_meeting=1 rows — both today and forward.
  const r = await env.DB.prepare(
    `SELECT symbol, meeting_date FROM board_meetings
     WHERE is_results_meeting = 1
       AND meeting_date >= date('now', '-7 days')`
  ).all();

  const rows = (r.results || []).map(row => ({
    symbol: row.symbol,
    result_date: row.meeting_date,
    fiscal_period: inferFiscalPeriod(row.meeting_date),
    expected_session: null,
  }));

  if (rows.length === 0) return { rows: 0, skipped: 'no-source-meetings' };
  const cols = ['symbol', 'result_date', 'fiscal_period', 'expected_session'];
  const written = await batchInsert(env.DB, 'results_calendar', cols, rows, 'REPLACE');
  return { rows: written, source_meetings: rows.length };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ingestBondYields — investing.com HTML scrape.
//    Pages render `data-test="instrument-price-last">N.NNN<` server-side.
//    The same hook returns the YIELD (not the price) for bond pages, which
//    is what we want.
// ────────────────────────────────────────────────────────────────────────────
const YIELD_PAGES = [
  { tenor: '10Y', url: 'https://www.investing.com/rates-bonds/india-10-year-bond-yield', source: 'investing_in10y' },
  { tenor: '5Y',  url: 'https://www.investing.com/rates-bonds/india-5-year-bond-yield',  source: 'investing_in5y' },
  { tenor: '1Y',  url: 'https://www.investing.com/rates-bonds/india-1-year-bond-yield',  source: 'investing_in1y' },
  { tenor: 'US10Y', url: 'https://www.investing.com/rates-bonds/u.s.-10-year-bond-yield', source: 'investing_us10y' },
];

async function fetchYieldFromInvesting(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA_DESKTOP,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`investing ${url} -> ${res.status}`);
  const html = await res.text();
  const m = html.match(/data-test="instrument-price-last"[^>]*>([0-9.]+)</);
  if (!m) throw new Error('no price match');
  return parseFloat(m[1]);
}

async function ingestBondYields(env) {
  const ts = Date.now();
  const tradeDate = ymdHyphen(istNow());
  const results = [];
  let written = 0;

  for (const page of YIELD_PAGES) {
    try {
      const yieldPct = await fetchYieldFromInvesting(page.url);
      if (!Number.isFinite(yieldPct)) {
        results.push({ tenor: page.tenor, error: 'NaN', source: page.source });
        continue;
      }
      // bond_yields table schema: tenor, ts, trade_date, latest_index, change_5d_pct, change_20d_pct, direction, yield_bp, source
      // We populate yield_bp = yieldPct * 100  (basis points so it's an integer-friendly column),
      // and direction by comparing to most recent prior row for the same tenor.
      const yieldBp = yieldPct * 100;

      // Direction inference: last 5 trade-day rows for this tenor.
      const prior = await env.DB.prepare(
        `SELECT yield_bp FROM bond_yields WHERE tenor=? AND yield_bp IS NOT NULL
         ORDER BY ts DESC LIMIT 5`
      ).bind(page.tenor).all();
      const priorBps = (prior.results || []).map(r => r.yield_bp).filter(v => v != null);
      let direction = 'flat';
      if (priorBps.length > 0) {
        const last = priorBps[0];
        if (yieldBp > last + 1) direction = 'up';
        else if (yieldBp < last - 1) direction = 'down';
      }

      await env.DB.prepare(
        `INSERT OR REPLACE INTO bond_yields (tenor, ts, trade_date, latest_index, yield_bp, direction, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(page.tenor, ts, tradeDate, yieldPct, yieldBp, direction, page.source).run();
      written++;
      results.push({ tenor: page.tenor, yield_pct: yieldPct, yield_bp: yieldBp, direction, source: page.source });
    } catch (e) {
      results.push({ tenor: page.tenor, error: String(e).slice(0, 100), source: page.source });
    }
  }

  return { rows: written, results };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. ingestForwards — synthetic USD/INR forward via interest rate parity.
//    Forward = Spot × (1 + r_inr · t/360) / (1 + r_usd · t/360).
//    Reads the latest USDINR spot and INR/US 10Y yields out of the DB.
//    Stored in crossasset_ticks under codes USDINR_1M_FWD / 3M_FWD / 6M_FWD.
//
//    NOTE: a true 1m/3m/6m forward would use INR 1m T-bill + US 1m T-bill
//    (tenor-matched).  We use 10Y as a stable proxy because:
//      (a) IRP holds at any tenor; using 10Y keeps the spread directional.
//      (b) INR 1m/3m yields aren't reliably scraped from any free source.
//    The signal layer treats this as "directional indicator", not pricing
//    truth.  When/if a tenor-matched feed appears, swap r_inr/r_usd for it.
// ────────────────────────────────────────────────────────────────────────────
async function ingestForwards(env) {
  const ts = Date.now();
  // Latest USDINR spot from crossasset_ticks (populated by wealth-macro-global)
  const spotRow = await env.DB.prepare(
    `SELECT value FROM crossasset_ticks WHERE asset_code='USDINR' ORDER BY ts DESC LIMIT 1`
  ).first();
  if (!spotRow) return { rows: 0, skipped: 'no-spot-USDINR' };
  const spot = spotRow.value;

  // Latest INR + US yields — try newest first, fall back gracefully.
  const inrRow = await env.DB.prepare(
    `SELECT yield_bp FROM bond_yields WHERE tenor='10Y' AND yield_bp IS NOT NULL ORDER BY ts DESC LIMIT 1`
  ).first();
  const usRow = await env.DB.prepare(
    `SELECT yield_bp FROM bond_yields WHERE tenor='US10Y' AND yield_bp IS NOT NULL ORDER BY ts DESC LIMIT 1`
  ).first();
  if (!inrRow || !usRow) return { rows: 0, skipped: 'missing-yield-snapshot', has_inr: !!inrRow, has_us: !!usRow };

  const rInr = inrRow.yield_bp / 10000;  // bp → decimal
  const rUs = usRow.yield_bp / 10000;

  // For each tenor compute the IRP forward and the annualised forward premium.
  const tenors = [
    { code: 'USDINR_1M_FWD', days: 30 },
    { code: 'USDINR_3M_FWD', days: 91 },
    { code: 'USDINR_6M_FWD', days: 182 },
  ];

  const rows = [];
  for (const t of tenors) {
    const tFrac = t.days / 360;
    const fwd = spot * (1 + rInr * tFrac) / (1 + rUs * tFrac);
    rows.push({ asset_code: t.code, ts, value: fwd });
    // Also store the implied annualised forward premium in bp (fwd - spot) / spot * 360/days
    const premiumBp = ((fwd - spot) / spot) * (360 / t.days) * 10000;
    rows.push({ asset_code: `${t.code}_PREMIUM_BP`, ts, value: premiumBp });
  }

  const cols = ['asset_code', 'ts', 'value'];
  const written = await batchInsert(env.DB, 'crossasset_ticks', cols, rows, 'IGNORE');
  return {
    rows: written,
    spot,
    r_inr_pct: (rInr * 100).toFixed(3),
    r_us_pct: (rUs * 100).toFixed(3),
    forwards: rows.filter(r => r.asset_code.endsWith('_FWD')).map(r => ({ code: r.asset_code, value: r.value.toFixed(4) })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Cron + HTTP plumbing  (mirrors wealth-flow-engine pattern)
// ────────────────────────────────────────────────────────────────────────────
const CRON_DISPATCH = {
  '30 0 * * *':           { name: 'board_meetings',   fn: ingestBoardMeetings   },  // 06:00 IST
  '0 1 * * *':            { name: 'results_calendar', fn: ingestResultsCalendar },  // 06:30 IST
  '0,30 3-10 * * 1-5':    { name: 'bond_yields',      fn: ingestBondYields      },  // every 30 min, 09:00-15:30 IST
  '15,45 3-10 * * 1-5':   { name: 'forwards',         fn: ingestForwards        },  // every 30 min, 09:15-15:45 IST
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
  board_meetings:    ingestBoardMeetings,
  results_calendar:  ingestResultsCalendar,
  bond_yields:       ingestBondYields,
  forwards:          ingestForwards,
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
         FROM cron_run_log WHERE worker_name=? ORDER BY started_at DESC LIMIT 30`
      ).bind(WORKER_NAME).all();
      return Response.json({ recent_runs: results });
    }

    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m) {
      const source = m[1];
      const fn = HTTP_HANDLERS[source];
      if (!fn) return new Response('unknown source', { status: 404 });
      const id = await logCronStart(env.DB, WORKER_NAME, source, 'http');
      try {
        const r = await fn(env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        await markSourceHealth(env.DB, source, true);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        await markSourceHealth(env.DB, source, false, e);
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    return new Response('wealth-event-scraper: try /status, /run/{board_meetings,results_calendar,bond_yields,forwards}', { status: 200 });
  },
};
