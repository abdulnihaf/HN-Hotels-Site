// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-fundamentals
// Layer Q — Quality dimension fed by Screener.in scrape.
//
// Pulls 7 ratios per symbol — P/E, P/B (computed from price/book), ROE%,
// Debt/Equity (from balance-sheet rows where available), Div Yield%,
// Promoter Holding% (latest quarterly), Market Cap (Cr) — and computes a
// 0-100 quality_score.
//
// Rate limit: ~1 req/sec to avoid Screener throttling. Worker timeout 30s,
// so each /run/fundamentals_ingest call processes ≤25 stocks. Run 8 times
// to cover the top-200 liquid universe.
//
// Cron: weekly Saturday 06:30 IST. Fundamentals barely move week-to-week.
// ═══════════════════════════════════════════════════════════════════════════

import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-fundamentals';
const BATCH_SIZE = 25;          // max stocks per /run/fundamentals_ingest call
const RATE_LIMIT_MS = 1000;     // 1 req/sec to be polite to Screener

// ───────────────────────────────────────────────
// HTML parsing helpers — Screener.in layout (verified May 2026)
//
// top-ratios block (ul#top-ratios):
//   <li class="flex flex-space-between">
//     <span class="name">Stock P/E</span>
//     <span class="nowrap value">
//       <span class="number">22.5</span>
//     </span>
//   </li>
//
// Available labels in default top-ratios: Market Cap, Current Price, High/Low,
// Stock P/E, Book Value, Dividend Yield, ROCE, ROE, Face Value.
// (Debt/Equity and Promoter Holding are NOT in this block — they live in the
// Balance Sheet and Shareholding Pattern sections respectively.)
// ───────────────────────────────────────────────
function decodeHtmlEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeHtmlEntities(String(s || '').replace(/<[^>]+>/g, '').trim());
}

function toNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[,%]/g, '').replace(/[^\d.\-]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Extract a top-ratios value by visible label. Allows whitespace/newlines
// around the label inside <span class="name">…</span>.
function extractTopRatio(html, label) {
  // Build a regex that anchors on `<span class="name">…label…</span>` then
  // looks for the next `<span class="number">…</span>` within ~600 chars.
  const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<span class="name">[\\s\\S]{0,80}?${labelEsc}[\\s\\S]{0,80}?</span>([\\s\\S]{0,800})`,
    'i'
  );
  const m = html.match(re);
  if (!m) return null;
  const after = m[1];
  const numM = after.match(/<span class="number">([^<]*)<\/span>/);
  if (!numM) return null;
  return toNumber(numM[1]);
}

// Promoter holding — quarterly shareholders table.
// Pattern: button with onclick="...promoters', 'quarterly'...>Promoters
// followed by a row of <td>X.XX%</td>. We take the last td in the row, which
// is the most recent quarter.
function extractPromoterHolding(html) {
  const m = html.match(
    /promoters[^>]*?'quarterly'[\s\S]{0,200}?Promoters[\s\S]*?<\/tr>/i
  );
  if (!m) return null;
  const block = m[0];
  // Each cell: <td>50.07%</td> — capture all numeric cells in order.
  const cells = [...block.matchAll(/<td[^>]*>\s*([\d.]+)%?\s*<\/td>/g)].map(x => x[1]);
  if (cells.length === 0) return null;
  return toNumber(cells[cells.length - 1]);
}

// Debt / Equity — derive from Balance Sheet rows.
// Tries:
//   D/E = Borrowings / (Equity Capital + Reserves)
// Pulls the LAST numeric td in each row (most recent year).
// Returns null if any input is missing — better than fake data.
function extractDebtToEquity(html) {
  const idx = html.indexOf('id="balance-sheet"');
  if (idx < 0) return null;
  // Find boundary — walk to next <section or end-of-doc, capped at 60KB.
  const end = Math.min(idx + 60000, html.indexOf('id="cash-flow"', idx) > 0 ? html.indexOf('id="cash-flow"', idx) : idx + 60000);
  const section = html.slice(idx, end);

  function lastNumInRow(rowLabel) {
    // The label is wrapped in a button; e.g. "Borrowings&nbsp;<span class="blue-icon">+</span>"
    const re = new RegExp(`${rowLabel}(?:&nbsp;|\\s)[\\s\\S]*?</tr>`, 'i');
    const m = section.match(re);
    if (!m) return null;
    const cells = [...m[0].matchAll(/<td[^>]*>\s*([\d,.\-]+)\s*<\/td>/g)].map(x => x[1]);
    if (cells.length === 0) return null;
    return toNumber(cells[cells.length - 1]);
  }

  const borrowings = lastNumInRow('Borrowings');
  const equity = lastNumInRow('Equity Capital');
  const reserves = lastNumInRow('Reserves');
  if (borrowings == null || equity == null || reserves == null) return null;
  const denom = equity + reserves;
  if (denom <= 0) return null;
  return borrowings / denom;
}

// Market cap — already extracted by extractTopRatio, but the unit can be Cr
// or Lakh. Default top block lists Market Cap with " Cr." suffix.
function extractMarketCapCr(html) {
  // Find the <li> for Market Cap and read the unit suffix.
  const liM = html.match(/<span class="name">[\s\S]{0,80}?Market Cap[\s\S]{0,80}?<\/span>([\s\S]{0,800}?)<\/li>/i);
  if (!liM) return null;
  const inner = liM[1];
  const numM = inner.match(/<span class="number">([^<]*)<\/span>/);
  if (!numM) return null;
  const num = toNumber(numM[1]);
  if (num == null) return null;
  if (/lakh/i.test(inner)) return num / 100;
  return num;  // Cr by default
}

// Sector / industry — Screener has a "Sector:" label plus an anchor link.
function extractSector(html) {
  let sector = null, industry = null;
  let m = html.match(/Sector\s*:\s*<\/[a-z]+>\s*<a[^>]*>([^<]+)</i);
  if (m) sector = stripTags(m[1]);
  m = html.match(/Industry\s*:\s*<\/[a-z]+>\s*<a[^>]*>([^<]+)</i);
  if (m) industry = stripTags(m[1]);
  return { sector, industry };
}

// ───────────────────────────────────────────────
// Quality score formula (max 100)
// ───────────────────────────────────────────────
function computeQualityScore(f) {
  let s = 0;
  if (f.roe_pct != null) {
    if (f.roe_pct > 15) s += 20;
    else if (f.roe_pct > 10) s += 12;
    else if (f.roe_pct > 5) s += 5;
  }
  if (f.debt_to_equity != null) {
    if (f.debt_to_equity < 0.5) s += 20;
    else if (f.debt_to_equity < 1.0) s += 12;
    else if (f.debt_to_equity < 2.0) s += 5;
  }
  if (f.pe_ratio != null && f.pe_ratio > 0) {
    if (f.pe_ratio >= 8 && f.pe_ratio <= 25) s += 15;
    else if (f.pe_ratio > 25 && f.pe_ratio <= 40) s += 8;
  }
  if (f.pb_ratio != null && f.pb_ratio > 0) {
    if (f.pb_ratio < 3) s += 10;
    else if (f.pb_ratio < 5) s += 5;
  }
  if (f.promoter_holding_pct != null) {
    if (f.promoter_holding_pct > 50) s += 15;
    else if (f.promoter_holding_pct > 30) s += 8;
  }
  if (f.div_yield_pct != null) {
    if (f.div_yield_pct > 1) s += 10;
    else if (f.div_yield_pct > 0) s += 5;
  }
  if (f.market_cap_cr != null && f.market_cap_cr > 500) s += 10;
  return s;
}

// ───────────────────────────────────────────────
// Single-symbol scrape — tries consolidated first, falls back to standalone.
// Returns either a metrics object or { error: '...' }.
// ───────────────────────────────────────────────
async function scrapeFundamentals(symbol) {
  const variants = [
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/`,
  ];
  let lastStatus = 0;
  for (const url of variants) {
    let res;
    try {
      res = await fetch(url, {
        // No cf cache — Screener's response can vary by IP/UA and we don't
        // want a stripped "logged out" cached version to poison subsequent reads.
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (e) {
      return { error: `fetch failed: ${String(e).slice(0, 200)}` };
    }
    lastStatus = res.status;
    if (res.status === 404 && url === variants[0]) {
      continue;  // try standalone
    }
    if (!res.ok) {
      return { error: `HTTP ${res.status} from ${url}`, status: res.status };
    }
    const html = await res.text();
    if (html.length < 5000) {
      return { error: 'response too short — possible block page', status: res.status };
    }
    if (/Just a moment\.\.\./i.test(html) || /cf-browser-verification/i.test(html)) {
      return { error: 'cloudflare-challenge', status: res.status };
    }

    // Extract from top-ratios
    const pe = extractTopRatio(html, 'Stock P/E');
    const dy = extractTopRatio(html, 'Dividend Yield');
    const roe = extractTopRatio(html, 'ROE');
    const bookValue = extractTopRatio(html, 'Book Value');
    const currentPrice = extractTopRatio(html, 'Current Price');
    const mcap = extractMarketCapCr(html);

    // P/B = current price / book value (Screener doesn't show P/B in top block)
    const pb = (currentPrice != null && bookValue != null && bookValue > 0)
      ? currentPrice / bookValue
      : null;

    // Promoter Holding from shareholders table
    const ph = extractPromoterHolding(html);

    // Debt/Equity from balance sheet
    const de = extractDebtToEquity(html);

    const { sector, industry } = extractSector(html);
    const out = {
      symbol,
      pe_ratio: pe,
      pb_ratio: pb,
      roe_pct: roe,
      debt_to_equity: de,
      div_yield_pct: dy,
      promoter_holding_pct: ph,
      market_cap_cr: mcap,
      sector,
      industry,
      source: url.includes('/consolidated/') ? 'screener-consolidated' : 'screener-standalone',
    };
    // Sanity: at least 3 of [pe, pb, roe, de, dy, ph, mcap] must parse, else fail.
    const parsedCount = [pe, pb, roe, de, dy, ph, mcap].filter(v => v != null).length;
    if (parsedCount < 3) {
      return {
        error: `parsed only ${parsedCount}/7 ratios — page format may have changed or symbol invalid`,
        url,
        partial: out,
      };
    }
    return out;
  }
  return { error: `all variants failed (last HTTP ${lastStatus})`, status: lastStatus };
}

// ───────────────────────────────────────────────
// Universe selection — top liquid NSE stocks by 30-day avg turnover.
// ───────────────────────────────────────────────
async function getTopLiquid(env, limit = 200) {
  const r = await env.DB.prepare(`
    SELECT symbol
    FROM equity_eod
    WHERE exchange='NSE'
      AND trade_date >= date('now','-30 days')
      AND volume IS NOT NULL AND volume > 0
    GROUP BY symbol
    HAVING AVG(close_paise * volume) > 50000000000
    ORDER BY AVG(close_paise * volume) DESC
    LIMIT ?
  `).bind(limit).all();
  return (r.results || []).map(x => x.symbol);
}

// ───────────────────────────────────────────────
// Cursor — track which slice we processed last so multiple HTTP calls can
// chunk through the universe. Stored in source_health.last_error as a
// stringified integer offset (cheap K-V; no extra schema).
// ───────────────────────────────────────────────
async function getCursor(env) {
  const r = await env.DB.prepare(
    `SELECT last_error FROM source_health WHERE source_name='fundamentals_cursor'`
  ).first();
  const n = parseInt(r?.last_error || '0', 10);
  return Number.isFinite(n) ? n : 0;
}
async function setCursor(env, offset) {
  await env.DB.prepare(
    `INSERT INTO source_health (source_name,last_success_ts,consecutive_failures,last_error,is_circuit_broken,updated_at)
     VALUES (?, ?, 0, ?, 0, ?)
     ON CONFLICT(source_name) DO UPDATE SET
       last_success_ts=excluded.last_success_ts,
       last_error=excluded.last_error,
       updated_at=excluded.updated_at`
  ).bind('fundamentals_cursor', Date.now(), String(offset), Date.now()).run();
}

// ───────────────────────────────────────────────
// Ingest a chunk — picks the next BATCH_SIZE symbols from the universe and
// scrapes each one. Inserts into fundamentals_snapshot.
// ───────────────────────────────────────────────
async function ingestChunk(env) {
  const universe = await getTopLiquid(env, 200);
  if (universe.length === 0) return { rows: 0, skipped: 'empty-universe' };

  let offset = await getCursor(env);
  if (offset >= universe.length) offset = 0;
  const slice = universe.slice(offset, offset + BATCH_SIZE);

  const refreshedAt = Date.now();
  const rows = [];
  const errors = [];
  for (let i = 0; i < slice.length; i++) {
    const sym = slice[i];
    if (i > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    const f = await scrapeFundamentals(sym);
    if (f.error) {
      errors.push({ symbol: sym, error: f.error });
      continue;
    }
    f.refreshed_at = refreshedAt;
    f.quality_score = computeQualityScore(f);
    f.raw_json = JSON.stringify({
      pe: f.pe_ratio, pb: f.pb_ratio, roe: f.roe_pct, de: f.debt_to_equity,
      dy: f.div_yield_pct, ph: f.promoter_holding_pct, mcap: f.market_cap_cr,
    });
    rows.push(f);
  }

  const cols = ['symbol','refreshed_at','pe_ratio','pb_ratio','roe_pct','debt_to_equity',
    'div_yield_pct','promoter_holding_pct','market_cap_cr','sector','industry',
    'source','raw_json','quality_score'];
  const written = await batchInsert(env.DB, 'fundamentals_snapshot', cols, rows, 'REPLACE');

  const newOffset = offset + BATCH_SIZE >= universe.length ? 0 : offset + BATCH_SIZE;
  await setCursor(env, newOffset);

  return {
    rows: written,
    chunk_offset: offset,
    chunk_size: slice.length,
    universe_size: universe.length,
    next_offset: newOffset,
    errors,
    error_count: errors.length,
  };
}

async function ingestOne(env, symbol) {
  const f = await scrapeFundamentals(symbol);
  if (f.error) return { rows: 0, error: f.error, symbol, partial: f.partial };
  f.refreshed_at = Date.now();
  f.quality_score = computeQualityScore(f);
  f.raw_json = JSON.stringify({
    pe: f.pe_ratio, pb: f.pb_ratio, roe: f.roe_pct, de: f.debt_to_equity,
    dy: f.div_yield_pct, ph: f.promoter_holding_pct, mcap: f.market_cap_cr,
  });
  const cols = ['symbol','refreshed_at','pe_ratio','pb_ratio','roe_pct','debt_to_equity',
    'div_yield_pct','promoter_holding_pct','market_cap_cr','sector','industry',
    'source','raw_json','quality_score'];
  const written = await batchInsert(env.DB, 'fundamentals_snapshot', cols, [f], 'REPLACE');
  return { rows: written, symbol, fundamentals: f };
}

// ───────────────────────────────────────────────
// Cron dispatcher
// ───────────────────────────────────────────────
const CRON_DISPATCH = {
  '0 1 * * 6': { name: 'fundamentals_weekly', fn: ingestChunk },
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

// ───────────────────────────────────────────────
// HTTP dispatcher
// ───────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.cron));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }

    if (url.pathname === '/status') {
      const r = await env.DB.prepare(
        `SELECT cron_name, status, started_at, finished_at, rows_written, error_message
         FROM cron_run_log WHERE worker_name=? ORDER BY started_at DESC LIMIT 30`
      ).bind(WORKER_NAME).all();
      const cursor = await getCursor(env);
      const counts = await env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(refreshed_at) AS latest, AVG(quality_score) AS avg_q
         FROM fundamentals_snapshot`
      ).first();
      return Response.json({ recent_runs: r.results, cursor, snapshot: counts });
    }

    if (url.pathname === '/top') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const r = await env.DB.prepare(
        `SELECT symbol, pe_ratio, pb_ratio, roe_pct, debt_to_equity, div_yield_pct,
                promoter_holding_pct, market_cap_cr, sector, quality_score, refreshed_at
         FROM fundamentals_snapshot
         ORDER BY quality_score DESC LIMIT ?`
      ).bind(limit).all();
      return Response.json({ top: r.results });
    }

    if (url.pathname === '/run/fundamentals_ingest') {
      const id = await logCronStart(env.DB, WORKER_NAME, 'fundamentals_ingest_chunk', 'http');
      try {
        const r = await ingestChunk(env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error_count ? `${r.error_count} errors` : null);
        await markSourceHealth(env.DB, 'fundamentals_ingest', true);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        await markSourceHealth(env.DB, 'fundamentals_ingest', false, e);
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/run/fundamentals_one') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return new Response('symbol required', { status: 400 });
      const id = await logCronStart(env.DB, WORKER_NAME, `fundamentals_one:${symbol}`, 'http');
      try {
        const r = await ingestOne(env, symbol.toUpperCase());
        await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error || null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/run/cursor_reset') {
      await setCursor(env, 0);
      return Response.json({ ok: true, cursor: 0 });
    }

    // Debug: see what Screener returns for a given symbol from this Worker IP.
    if (url.pathname === '/debug/raw') {
      const symbol = url.searchParams.get('symbol') || 'RELIANCE';
      const u = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;
      const res = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
      });
      const text = await res.text();
      const hasTopRatios = text.includes('id="top-ratios"');
      const hasStockPe = text.includes('Stock P/E');
      const hasBookValue = text.includes('Book Value');
      const hasBalance = text.includes('id="balance-sheet"');
      const hasShare = /showShareholders\([^)]*'promoters'/i.test(text);
      const hasChallenge = /Just a moment|cf-mitigated|cf-browser-verification/i.test(text);
      // Show first 500 chars after "id=top-ratios" if it's there
      let topRatiosSnippet = null;
      const idx = text.indexOf('id="top-ratios"');
      if (idx >= 0) topRatiosSnippet = text.slice(idx, idx + 800);
      return Response.json({
        status: res.status,
        length: text.length,
        hasTopRatios, hasStockPe, hasBookValue, hasBalance, hasShare, hasChallenge,
        topRatiosSnippet,
      });
    }

    return new Response(
      'wealth-fundamentals: try /status, /top, /run/fundamentals_one?symbol=X, /run/fundamentals_ingest, /run/cursor_reset',
      { status: 200 }
    );
  },
};
