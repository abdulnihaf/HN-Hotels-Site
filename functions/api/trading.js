// /api/trading — read-only API for the /trading dashboard.
// Reads from wealth-engine D1 (binding: WEALTH_DB).
// PIN-gated via DASHBOARD_KEY (same pattern as other ops dashboards).

import { roundTripCostCnc, adaptiveMinRR, adaptiveRiskPct, netExpectedValue } from './_lib/costModel.js';
import { computeOptionAnalytics } from './_lib/optionAnalytics.js';
import { recordObservation, getPosterior, scoreBand, detectRegime } from './_lib/bayesianLearner.js';
import { getTodaysPlan, getGlossary } from './_lib/coaching.js';
import { callHaiku, getSpendSummary } from './_lib/anthropic.js';
//
// Actions:
//   health     — cron run log + source health summary
//   eod        — equity_eod history for a symbol
//   indices    — latest snapshot of all indices
//   preopen    — today's pre-open snapshot
//   intraday   — recent intraday ticks for watchlist
//   extremes   — today's 52w highs/lows
//   circuits   — today's upper/lower circuit hits
//   backfill   — backfill progress per source
//   universe   — counts of distinct symbols/dates ingested
//   signals    — top signal scores (returns empty until signal engine deployed)
//   summary    — single call returning everything the dashboard needs

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const apiKey = request.headers.get('x-api-key') || url.searchParams.get('key');
  if (apiKey !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }

  const db = env.WEALTH_DB;
  if (!db) {
    return new Response(JSON.stringify({
      error: 'wealth-engine D1 not bound. Add [[d1_databases]] WEALTH_DB binding to wrangler.toml after `wrangler d1 create wealth-engine`.',
    }), { status: 500, headers });
  }

  const action = url.searchParams.get('action') || 'summary';

  try {
    switch (action) {
      case 'health':       return Response.json(await getHealth(db), { headers });
      case 'eod':          return Response.json(await getEod(db, url), { headers });
      case 'indices':      return Response.json(await getIndices(db), { headers });
      case 'preopen':      return Response.json(await getPreopen(db), { headers });
      case 'intraday':     return Response.json(await getIntraday(db, url), { headers });
      case 'extremes':     return Response.json(await getExtremes(db), { headers });
      case 'circuits':     return Response.json(await getCircuits(db), { headers });
      case 'backfill':     return Response.json(await getBackfill(db), { headers });
      case 'universe':     return Response.json(await getUniverse(db), { headers });
      case 'signals':      return Response.json(await getSignals(db), { headers });
      case 'cascades':     return Response.json(await getCascades(db), { headers });
      case 'fii_dii':      return Response.json(await getFiiDii(db), { headers });
      case 'bulk_block':   return Response.json(await getBulkBlock(db, url), { headers });
      case 'option_chain': return Response.json(await getOptionChain(db, url), { headers });
      case 'announcements': return Response.json(await getAnnouncements(db, url), { headers });
      case 'macro':        return Response.json(await getMacro(db), { headers });
      case 'crossasset':   return Response.json(await getCrossAsset(db), { headers });
      case 'news':         return Response.json(await getNews(db, url), { headers });
      case 'social':       return Response.json(await getSocial(db, url), { headers });
      case 'sectors':      return Response.json(await getSectors(db), { headers });
      case 'breadth':      return Response.json(await getBreadth(db), { headers });
      case 'calendar':     return Response.json(await getCalendar(db), { headers });
      case 'alerts':       return Response.json(await getAlerts(db, url), { headers });
      case 'mark_alert_read': return Response.json(await markAlertRead(db, url), { headers });
      case 'mark_all_alerts_read': return Response.json(await markAllAlertsRead(db, url), { headers });
      case 'tag_news_keywords':    return Response.json(await tagNewsKeywords(db, url), { headers });
      case 'briefing':     return Response.json(await getBriefing(db), { headers });
      case 'portfolio':    return Response.json(await getPortfolio(db, url), { headers });
      case 'positions':    return Response.json(await getPositions(db), { headers });
      case 'add_position': return Response.json(await addPosition(db, url, request), { headers });
      case 'close_position': return Response.json(await closePosition(db, url), { headers });
      case 'weekly_perf':  return Response.json(await getWeeklyPerf(db), { headers });
      case 'queue':        return Response.json(await getQueue(db), { headers });
      case 'markets_101':  return Response.json(await getMarkets101(db), { headers });
      case 'option_analytics':  return Response.json(await getOptionAnalyticsView(db, url), { headers });
      case 'sector_rotation':   return Response.json(await getSectorRotation(db, url), { headers });
      case 'bayesian_state':    return Response.json(await getBayesianState(db), { headers });
      case 'bond_direction':    return Response.json(await getBondDirection(db), { headers });
      // ── Watchlist ──
      case 'watchlist':         return Response.json(await getWatchlist(db, url), { headers });
      case 'watchlist_add':     return Response.json(await addWatchlist(db, url), { headers });
      case 'watchlist_remove':  return Response.json(await removeWatchlist(db, url), { headers });
      case 'symbol_search':     return Response.json(await searchSymbols(db, url), { headers });
      case 'watchlist_seed':    return Response.json(await seedStarterWatchlist(db, url), { headers });
      case 'stock_picker':      return Response.json(await stockPicker(db, env, url), { headers });
      // ── Paper trading ──
      case 'paper_trades':      return Response.json(await getPaperTrades(db, url, env), { headers });
      case 'paper_open':        return Response.json(await openPaperTrade(db, url), { headers });
      case 'paper_close':       return Response.json(await closePaperTrade(db, url), { headers });
      case 'paper_tick':        return Response.json(await tickPaperTrades(db, env), { headers });
      // ── Readiness ──
      case 'readiness':         return Response.json(await getReadiness(db), { headers });
      case 'readiness_set':     return Response.json(await setReadinessFlag(db, url), { headers });
      // ── Pre-market briefing ──
      case 'morning_briefing':  return Response.json(await getMorningBriefing(db), { headers });
      // ── Today's coaching plan ──
      case 'todays_plan':       return Response.json(await getTodaysPlan(db, env), { headers });
      case 'glossary':          return Response.json(getGlossary(url), { headers });
      case 'top_recommendation': return Response.json(await getTopRecommendation(db, env), { headers });
      case 'anthropic_spend':    return Response.json(await getSpendSummary(env.WEALTH_DB || db), { headers });
      case 'engine_state':       return Response.json(await getEngineState(db, env), { headers });
      case 'briefing_v2':        return Response.json(await getBriefingV2(db, env), { headers });
      case 'analyze_concall':    return Response.json(await analyzeConcallPages(db, env, request), { headers });
      case 'verdict_today':      return Response.json(await getVerdictToday(db, env), { headers });
      case 'trade_comparison':   return Response.json(await getTradeComparison(db, env, url), { headers });
      case 'ops_audit_today':    return Response.json(await getOpsAuditToday(db, url), { headers });
      case 'todays_watchlist':   return Response.json(await getTodaysWatchlist(db, url), { headers });
      case 'auto_trader_state':  return Response.json(await getAutoTraderState(db), { headers });
      case 'trader_timeline':    return Response.json(await getTraderTimeline(db, url), { headers });
      case 'intelligence_audit': return Response.json(await getIntelligenceAudit(db), { headers });
      case 'system_health':      return Response.json(await getSystemHealth(db), { headers });
      case 'eod_learning_audit': return Response.json(await getEodLearningAudit(db, env, url), { headers });
      case 'readiness_report':   return Response.json(await getReadinessReport(db, url), { headers });
      case 'top_strip':          return Response.json(await getTopStrip(db), { headers });
      case 'today_consolidated': return Response.json(await getTodayConsolidated(db), { headers });
      case 'monthly_learning_trail': return Response.json(await getMonthlyLearningTrail(db, url), { headers });
      case 'weekly_review_latest': return Response.json(await getLatestWeeklyReview(db), { headers });
      case 'autopsy_latest':     return Response.json(await getLatestAutopsies(db, url), { headers });
      case 'config':       return Response.json(await getConfig(db), { headers });
      case 'set_config':   return Response.json(await setConfig(db, url), { headers });
      case 'ops_health':   return Response.json(await getOpsHealth(db), { headers });
      case 'execute_view': return Response.json(await getExecuteView(db, env), { headers });
      case 'summary':      return Response.json(await getSummary(db), { headers });
      default:             return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers });
  }
}

// ─────────────────────────────────────────────────────────
async function getHealth(db) {
  const recentRuns = await db.prepare(
    `SELECT cron_name, status, started_at, finished_at, duration_ms, rows_written, error_message, trigger_source
     FROM cron_run_log ORDER BY started_at DESC LIMIT 30`
  ).all();
  const sourceHealth = await db.prepare(
    `SELECT source_name, last_success_ts, consecutive_failures, last_error, is_circuit_broken, updated_at
     FROM source_health ORDER BY source_name`
  ).all();
  const dailyByCron = await db.prepare(
    `SELECT cron_name,
            COUNT(*) AS runs,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
            SUM(rows_written) AS rows
     FROM cron_run_log
     WHERE started_at > ?
     GROUP BY cron_name`
  ).bind(Date.now() - 86400000).all();
  return {
    recent_runs: recentRuns.results || [],
    source_health: sourceHealth.results || [],
    last_24h: dailyByCron.results || [],
  };
}

async function getEod(db, url) {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) throw new Error('symbol required');
  const from = url.searchParams.get('from') || '2024-05-03';
  const to = url.searchParams.get('to') || '2099-01-01';
  const exchange = url.searchParams.get('exchange') || 'NSE';
  const r = await db.prepare(
    `SELECT trade_date, open_paise, high_paise, low_paise, close_paise, prev_close_paise,
            volume, delivery_qty, delivery_pct, vwap_paise, source
     FROM equity_eod WHERE symbol=? AND exchange=? AND trade_date BETWEEN ? AND ?
     ORDER BY trade_date`
  ).bind(symbol, exchange, from, to).all();
  return { symbol, exchange, rows: r.results || [] };
}

async function getIndices(db) {
  const r = await db.prepare(
    `SELECT i1.* FROM indices_eod i1
     JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
       ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
     ORDER BY i1.index_name`
  ).all();
  return { indices: r.results || [] };
}

async function getPreopen(db) {
  const r = await db.prepare(
    `SELECT * FROM preopen_snapshot
     WHERE ts > ?
     ORDER BY ts DESC, ABS(iep_change_pct) DESC
     LIMIT 50`
  ).bind(Date.now() - 86400000).all();
  return { rows: r.results || [] };
}

async function getIntraday(db, url) {
  const symbol = url.searchParams.get('symbol');
  const since = parseInt(url.searchParams.get('since') || (Date.now() - 3600000));
  let q;
  if (symbol) {
    q = db.prepare(
      `SELECT * FROM intraday_ticks WHERE symbol=? AND ts > ? ORDER BY ts DESC LIMIT 200`
    ).bind(symbol, since);
  } else {
    q = db.prepare(
      `SELECT * FROM intraday_ticks WHERE ts > ? ORDER BY ts DESC LIMIT 200`
    ).bind(since);
  }
  const r = await q.all();
  return { rows: r.results || [] };
}

async function getExtremes(db) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT * FROM weekly_extremes WHERE trade_date=? ORDER BY extreme_type, symbol`
  ).bind(today).all();
  return { date: today, rows: r.results || [] };
}

async function getCircuits(db) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT * FROM circuit_hits WHERE trade_date=? ORDER BY circuit_type, symbol`
  ).bind(today).all();
  return { date: today, rows: r.results || [] };
}

async function getBackfill(db) {
  const r = await db.prepare(
    `SELECT source_name, date_from, date_to, date_completed, rows_loaded, status, last_attempt_at, error
     FROM backfill_progress ORDER BY last_attempt_at DESC`
  ).all();
  return { rows: r.results || [] };
}

async function getUniverse(db) {
  const eod = await db.prepare(
    `SELECT exchange, COUNT(DISTINCT symbol) AS symbols, COUNT(DISTINCT trade_date) AS days,
            MIN(trade_date) AS min_date, MAX(trade_date) AS max_date, COUNT(*) AS total_rows
     FROM equity_eod GROUP BY exchange`
  ).all();
  const indices = await db.prepare(
    `SELECT COUNT(DISTINCT index_name) AS n_indices, MAX(trade_date) AS latest FROM indices_eod`
  ).all();
  return { eod: eod.results || [], indices: indices.results?.[0] || {} };
}

async function getSignals(db) {
  // Placeholder until signal engine W9 deploys
  try {
    const r = await db.prepare(
      `SELECT s.* FROM signal_scores s
       JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x
       ON s.computed_at = x.m
       ORDER BY s.composite_score DESC LIMIT 20`
    ).all();
    return { signals: r.results || [], note: 'signal engine not yet deployed; this returns empty until W9' };
  } catch {
    return { signals: [], note: 'signal_scores table empty' };
  }
}

async function getCascades(db) {
  try {
    const r = await db.prepare(
      `SELECT * FROM cascade_triggers_active
       WHERE status='active' AND expected_window_end > ?
       ORDER BY detected_at DESC LIMIT 50`
    ).bind(Date.now()).all();
    return { cascades: r.results || [] };
  } catch { return { cascades: [] }; }
}

async function getFiiDii(db) {
  const r = await db.prepare(
    `SELECT * FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 60`
  ).all();
  return { rows: r.results || [] };
}

async function getBulkBlock(db, url) {
  const days = parseInt(url.searchParams.get('days') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT * FROM bulk_block_deals WHERE trade_date >= ?
     ORDER BY trade_date DESC, qty DESC LIMIT 200`
  ).bind(since).all();
  return { rows: r.results || [] };
}

async function getOptionChain(db, url) {
  const underlying = url.searchParams.get('underlying') || 'NIFTY';
  const r = await db.prepare(
    `SELECT * FROM option_chain_snapshot WHERE underlying=?
     AND ts = (SELECT MAX(ts) FROM option_chain_snapshot WHERE underlying=?)
     ORDER BY expiry, strike_paise`
  ).bind(underlying, underlying).all();
  return { underlying, rows: r.results || [] };
}

async function getAnnouncements(db, url) {
  const symbol = url.searchParams.get('symbol');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  let q;
  if (symbol) {
    q = db.prepare(
      `SELECT * FROM corp_announcements WHERE symbol=?
       ORDER BY ann_time DESC LIMIT ?`
    ).bind(symbol, limit);
  } else {
    q = db.prepare(
      `SELECT * FROM corp_announcements
       WHERE materiality_score > 0.5
       ORDER BY ann_time DESC LIMIT ?`
    ).bind(limit);
  }
  const r = await q.all();
  return { rows: r.results || [] };
}

async function getMacro(db) {
  const r = await db.prepare(
    `SELECT m1.* FROM macro_indicators m1
     JOIN (SELECT indicator_code, MAX(observation_date) AS d FROM macro_indicators GROUP BY indicator_code) m2
       ON m1.indicator_code=m2.indicator_code AND m1.observation_date=m2.d
     ORDER BY m1.indicator_code`
  ).all();
  return { rows: r.results || [] };
}

async function getCrossAsset(db) {
  const r = await db.prepare(
    `SELECT c1.* FROM crossasset_ticks c1
     JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks GROUP BY asset_code) c2
       ON c1.asset_code=c2.asset_code AND c1.ts=c2.m
     ORDER BY c1.asset_code`
  ).all();
  return { rows: r.results || [] };
}

async function getNews(db, url) {
  const symbol = url.searchParams.get('symbol');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  let q;
  if (symbol) {
    q = db.prepare(
      `SELECT * FROM news_items WHERE symbols_tagged LIKE ?
       ORDER BY published_at DESC LIMIT ?`
    ).bind(`%"${symbol}"%`, limit);
  } else {
    q = db.prepare(
      `SELECT * FROM news_items
       WHERE importance_score > 0.5
       ORDER BY published_at DESC LIMIT ?`
    ).bind(limit);
  }
  const r = await q.all();
  return { rows: r.results || [] };
}

async function getSocial(db, url) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const r = await db.prepare(
    `SELECT * FROM social_posts
     WHERE engagement_score > 1
     ORDER BY posted_at DESC LIMIT ?`
  ).bind(limit).all();
  return { rows: r.results || [] };
}

async function getSectors(db) {
  const r = await db.prepare(
    `SELECT s1.* FROM sector_indices s1
     JOIN (SELECT index_name, MAX(trade_date) AS d FROM sector_indices GROUP BY index_name) s2
       ON s1.index_name=s2.index_name AND s1.trade_date=s2.d
     ORDER BY s1.index_name`
  ).all();
  return { rows: r.results || [] };
}

async function getBreadth(db) {
  const r = await db.prepare(
    `SELECT * FROM breadth_data ORDER BY ts DESC LIMIT 30`
  ).all();
  return { rows: r.results || [] };
}

async function getCalendar(db) {
  const upcoming = await db.prepare(
    `SELECT * FROM macro_calendar WHERE event_ts > ? ORDER BY event_ts LIMIT 50`
  ).bind(Date.now()).all();
  const earnings = await db.prepare(
    `SELECT * FROM results_calendar WHERE result_date >= date('now') ORDER BY result_date LIMIT 50`
  ).all();
  return { macro: upcoming.results || [], earnings: earnings.results || [] };
}

async function getAlerts(db, url) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const unreadOnly = url.searchParams.get('unread') === '1';
  const includeNoise = url.searchParams.get('noise') === '1';

  // Watchdog noise filter — these alerts repeat constantly without actionable signal:
  //   "Cron stale: <X>" for crons that legitimately don't run today (weekends, holidays,
  //   one-shot crons that already finished, deprecated crons).
  // Keep them in DB for audit but hide from the active alerts UI by default.
  const noiseSuppression = includeNoise ? '' : `
    AND NOT (
      category='watchdog' AND title LIKE 'Cron stale:%' AND (
           title LIKE '%seed_backfill%'
        OR title LIKE '%imd%'
        OR title LIKE '%posoco%'
        OR title LIKE '%fred%'
        OR title LIKE '%db_vacuum%'
        OR title LIKE '%weekly_digest%'
        OR title LIKE '%backfill:nse_bulk%'
        OR title LIKE '%backfill:nse_block%'
        OR title LIKE '%backfill:bse_deals%'
        OR title LIKE '%backfill:fno_participant_oi%'
        OR title LIKE '%backfill:nse_bhavcopy%'
        OR title LIKE '%backfill:bse_bhavcopy%'
        OR title LIKE '%backfill:delivery%'
        OR title LIKE '%backfill:fii_dii_cash%'
        OR title LIKE '%backfill:fii_deriv%'
        OR title LIKE '%backfill:mwpl%'
        OR title LIKE '%sector_history_refresh%'
        OR title LIKE '%bond_direction%'
        OR title LIKE '%yahoo_eod%'
      )
    )
  `;
  const sql = unreadOnly
    ? `SELECT * FROM system_alerts WHERE is_read=0 ${noiseSuppression} ORDER BY ts DESC LIMIT ?`
    : `SELECT * FROM system_alerts WHERE 1=1 ${noiseSuppression} ORDER BY ts DESC LIMIT ?`;
  const r = await db.prepare(sql).bind(limit).all();
  const counts = await db.prepare(
    `SELECT severity, COUNT(*) AS n FROM system_alerts WHERE is_read=0 ${noiseSuppression} GROUP BY severity`
  ).all();
  // Also report suppressed-noise count so user knows it exists
  const suppressedCount = await db.prepare(
    `SELECT COUNT(*) AS n FROM system_alerts WHERE is_read=0 AND category='watchdog' AND title LIKE 'Cron stale:%'`
  ).first();
  return {
    alerts: r.results || [],
    unread_counts: counts.results || [],
    noise_suppressed: suppressedCount?.n || 0,
  };
}

async function markAlertRead(db, url) {
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return { error: 'id required' };
  await db.prepare(`UPDATE system_alerts SET is_read=1 WHERE id=?`).bind(id).run();
  return { ok: true };
}

// Mark ALL unread as read in one shot — clears backlog
async function markAllAlertsRead(db, url) {
  const r = await db.prepare(
    `UPDATE system_alerts SET is_read=1 WHERE is_read=0`
  ).run();
  return { ok: true, marked: r.meta?.changes || 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=tag_news_keywords
//
// Bulk-tag news_items with symbol references via keyword match against the
// top-100 liquid F&O stocks. Cheap fallback for the proper NLP tagger that
// only catches 6% of news today. Run this on-demand or as a 6-hourly cron.
// ═══════════════════════════════════════════════════════════════════════════
async function tagNewsKeywords(db, url) {
  const lookbackDays = parseInt(url.searchParams.get('days') || '7');
  // 1. Get top liquid symbols + their company names
  const liquidRows = (await db.prepare(`
    WITH liquid AS (
      SELECT e.symbol, AVG(e.close_paise * e.volume / 100.0) AS avg_value
      FROM equity_eod e WHERE exchange='NSE' AND trade_date >= date('now', '-30 days')
        AND volume > 0 GROUP BY symbol
      HAVING avg_value >= 100000000
      ORDER BY avg_value DESC LIMIT 200
    )
    SELECT l.symbol, k.name FROM liquid l
    LEFT JOIN kite_instruments k ON k.tradingsymbol = l.symbol AND k.exchange = 'NSE' AND k.instrument_type = 'EQ'
  `).all()).results || [];

  // 2. Fetch untagged news from last N days
  const since = Date.now() - lookbackDays * 86400000;
  const news = (await db.prepare(`
    SELECT id, headline, body_excerpt FROM news_items
    WHERE published_at > ?
      AND (symbols_tagged IS NULL OR symbols_tagged = '[]')
    LIMIT 500
  `).bind(since).all()).results || [];

  let tagged = 0, total = news.length;
  // 3. For each news, find symbol mentions
  for (const item of news) {
    const haystack = ((item.headline || '') + ' ' + (item.body_excerpt || '')).toUpperCase();
    const matches = [];
    for (const r of liquidRows) {
      // Skip too-short symbols (false positive risk: "L", "M&M", etc.)
      if (r.symbol.length < 4) continue;
      // Word-boundary search to avoid "INFY" matching inside "INFOSYS-LTD"
      const re = new RegExp(`(?:^|[^A-Z0-9])${r.symbol}(?:[^A-Z0-9]|$)`);
      if (re.test(haystack)) {
        matches.push(r.symbol);
        continue;
      }
      // Also check company name (first significant word) e.g. "RELIANCE" matches "Reliance Industries"
      if (r.name) {
        const firstWord = r.name.split(/\s+/)[0].toUpperCase();
        if (firstWord.length >= 5) {
          const reN = new RegExp(`(?:^|[^A-Z])${firstWord}(?:[^A-Z]|$)`);
          if (reN.test(haystack)) matches.push(r.symbol);
        }
      }
    }
    if (matches.length > 0) {
      // Cap at 5 symbols per news to avoid noise
      const unique = [...new Set(matches)].slice(0, 5);
      await db.prepare(`UPDATE news_items SET symbols_tagged = ? WHERE id = ?`)
        .bind(JSON.stringify(unique), item.id).run();
      tagged++;
    }
  }
  return { ok: true, total_processed: total, tagged, ratio: total > 0 ? (tagged / total).toFixed(2) : 0 };
}

async function getBriefing(db) {
  const r = await db.prepare(
    `SELECT * FROM daily_briefings ORDER BY briefing_date DESC LIMIT 1`
  ).first();
  if (!r) return { briefing: null };
  // Parse JSON fields
  for (const k of ['market_pulse','top_signals','active_cascades','fii_dii_yesterday','key_macro','upcoming_events','earnings_today']) {
    try { r[k] = JSON.parse(r[k] || 'null'); } catch {}
  }
  return { briefing: r };
}

async function getPortfolio(db, url) {
  const days = parseInt(url.searchParams.get('days') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT * FROM portfolio_snapshots_daily WHERE snapshot_date >= ?
     ORDER BY snapshot_date DESC, pnl_paise DESC`
  ).bind(since).all();
  // Aggregate today vs yesterday for KPIs
  const latest = await db.prepare(
    `SELECT MAX(snapshot_date) AS d FROM portfolio_snapshots_daily`
  ).first();
  const todayRows = latest?.d ? (await db.prepare(
    `SELECT * FROM portfolio_snapshots_daily WHERE snapshot_date=?`
  ).bind(latest.d).all()).results : [];
  const totalValue = todayRows.reduce((a, r) => a + (r.market_value_paise || 0), 0);
  const totalPnl = todayRows.reduce((a, r) => a + (r.pnl_paise || 0), 0);
  return {
    rows: r.results || [],
    summary: {
      latest_date: latest?.d,
      total_value_paise: totalValue,
      total_pnl_paise: totalPnl,
      position_count: todayRows.length,
    },
  };
}

async function getPositions(db) {
  const r = await db.prepare(
    `SELECT * FROM position_watchlist WHERE is_active=1 ORDER BY entry_date DESC`
  ).all();
  return { positions: r.results || [] };
}

async function addPosition(db, url, request) {
  // GET-style for simplicity (key-gated). Use POST in production.
  const p = {
    tranche: url.searchParams.get('tranche') || 'base',
    symbol: url.searchParams.get('symbol'),
    exchange: url.searchParams.get('exchange') || 'NSE',
    qty: parseInt(url.searchParams.get('qty')),
    entry_price_paise: Math.round(parseFloat(url.searchParams.get('entry')) * 100),
    stop_paise: Math.round(parseFloat(url.searchParams.get('stop')) * 100),
    target_paise: url.searchParams.get('target') ? Math.round(parseFloat(url.searchParams.get('target')) * 100) : null,
    entry_date: url.searchParams.get('date') || new Date().toISOString().slice(0, 10),
    rationale: url.searchParams.get('rationale') || null,
  };
  if (!p.symbol || !p.qty || !p.entry_price_paise || !p.stop_paise) {
    return { error: 'symbol, qty, entry, stop required' };
  }
  const r = await db.prepare(
    `INSERT INTO position_watchlist (tranche,symbol,exchange,qty,entry_price_paise,stop_paise,target_paise,entry_date,rationale)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(p.tranche, p.symbol, p.exchange, p.qty, p.entry_price_paise, p.stop_paise, p.target_paise, p.entry_date, p.rationale).run();
  return { ok: true, id: r.meta?.last_row_id };
}

async function closePosition(db, url) {
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return { error: 'id required' };

  // Optional exit price for proper Bayesian observation
  const exitPriceRupees = url.searchParams.get('exit_price');
  const exitReason = url.searchParams.get('exit_reason') || 'manual_close';

  // Look up the position before closing so we can record the observation
  const pos = await db.prepare(
    `SELECT * FROM position_watchlist WHERE id=?`
  ).bind(id).first();

  await db.prepare(`UPDATE position_watchlist SET is_active=0 WHERE id=?`).bind(id).run();

  // Record Bayesian observation if we have enough data
  if (pos && exitPriceRupees) {
    try {
      const exitPaise = Math.round(parseFloat(exitPriceRupees) * 100);
      const regime = await detectRegime(db);
      const band = scoreBand(pos.composite_score || 70);
      // hold_days from entry_date to today
      const holdDays = pos.entry_date
        ? Math.round((Date.now() - new Date(pos.entry_date).getTime()) / 86400000)
        : 0;
      await recordObservation(db, {
        position_id: id,
        tranche: pos.tranche,
        score_band: band,
        cascade_pattern: pos.cascade_pattern || null,
        regime,
        symbol: pos.symbol,
        composite_score: pos.composite_score,
        entry_paise: pos.entry_price_paise,
        exit_paise: exitPaise,
        pnl_paise: (exitPaise - pos.entry_price_paise) * (pos.qty || 1),
        hold_days: holdDays,
        exit_reason: exitReason,
      });
    } catch (e) {
      // Bayesian update is non-critical — never block close on it
      console.warn('Bayesian observation failed:', e.message);
    }
  }
  return { ok: true };
}

async function getWeeklyPerf(db) {
  const r = await db.prepare(
    `SELECT * FROM weekly_performance ORDER BY week_ending DESC LIMIT 12`
  ).all();
  return { rows: r.results || [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=markets_101 — beginner-friendly learning aggregation
// Returns 5 cards: today's story, headlines, top movers, smart money, concept
// ═══════════════════════════════════════════════════════════════════════════
async function getMarkets101(db) {
  // 1. TODAY'S STORY — synthesized narrative from FII/DII + indices + sentiment
  const fiiRecent = (await db.prepare(
    `SELECT * FROM fii_dii_daily WHERE segment='cash' ORDER BY trade_date DESC LIMIT 5`
  ).all()).results || [];
  const indicesLatest = (await db.prepare(`
    SELECT i1.* FROM indices_eod i1
    JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
      ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
    WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX','NIFTY MIDCAP 100')
  `).all()).results || [];
  const repo = (await db.prepare(
    `SELECT value FROM macro_indicators WHERE indicator_code='IN_REPO' ORDER BY observation_date DESC LIMIT 1`
  ).first())?.value;

  // Build narrative
  const storyBits = [];
  // FII trend
  if (fiiRecent.length > 0) {
    const fiiSum5d = fiiRecent.reduce((a, r) => a + (r.fii_net_cr || 0), 0);
    const diiSum5d = fiiRecent.reduce((a, r) => a + (r.dii_net_cr || 0), 0);
    const lastFii = fiiRecent[0]?.fii_net_cr || 0;
    if (Math.abs(fiiSum5d) > 5000) {
      storyBits.push(`Foreign investors ${fiiSum5d > 0 ? 'bought' : 'sold'} ₹${Math.abs(fiiSum5d).toFixed(0)} Cr over the last 5 days (DII ${diiSum5d > 0 ? '+' : ''}${diiSum5d.toFixed(0)} Cr)`);
    } else {
      storyBits.push(`FII flow has been muted (${fiiSum5d.toFixed(0)} Cr net over 5 days) — indecisive money`);
    }
  }
  // Volatility tone
  const vix = indicesLatest.find(i => i.index_name === 'INDIA VIX');
  if (vix) {
    const v = vix.close_paise / 100;
    const tone = v < 13 ? 'unusually calm' : v < 18 ? 'normal' : 'elevated (fear creeping in)';
    storyBits.push(`India VIX is ${v.toFixed(1)} — ${tone}`);
  }
  // Macro tilt
  if (repo != null) {
    storyBits.push(`RBI repo at ${repo.toFixed(2)}% (${repo < 6 ? 'low — bullish for rate-sensitive' : repo < 6.5 ? 'neutral' : 'restrictive'})`);
  }
  const story = storyBits.length > 0 ? storyBits.join('. ') + '.' : 'Market data still loading — full story available once backfill completes (~50-70% remaining).';

  // 2. HEADLINES — top 10 announcements last 14 days, by materiality
  const headlines = (await db.prepare(`
    SELECT id, symbol, ann_time, subject, materiality_score, sentiment_score, category
    FROM corp_announcements
    WHERE ann_time > ? AND materiality_score > 0.5
    ORDER BY materiality_score DESC, ann_time DESC LIMIT 10
  `).bind(Date.now() - 14 * 86400000).all()).results || [];

  // 3. TOP MOVERS — biggest gainers + losers from last EOD
  const lastDate = (await db.prepare(
    `SELECT MAX(trade_date) AS d FROM equity_eod WHERE exchange='NSE'`
  ).first())?.d;
  let topGainers = [], topLosers = [];
  if (lastDate) {
    topGainers = (await db.prepare(`
      SELECT symbol, close_paise, prev_close_paise, volume,
        ((close_paise - prev_close_paise) * 100.0 / prev_close_paise) AS pct_change
      FROM equity_eod
      WHERE exchange='NSE' AND trade_date=? AND volume > 100000
        AND prev_close_paise > 0 AND close_paise > 0
      ORDER BY pct_change DESC LIMIT 5
    `).bind(lastDate).all()).results || [];
    topLosers = (await db.prepare(`
      SELECT symbol, close_paise, prev_close_paise, volume,
        ((close_paise - prev_close_paise) * 100.0 / prev_close_paise) AS pct_change
      FROM equity_eod
      WHERE exchange='NSE' AND trade_date=? AND volume > 100000
        AND prev_close_paise > 0 AND close_paise > 0
      ORDER BY pct_change ASC LIMIT 5
    `).bind(lastDate).all()).results || [];
  }

  // 4. SMART MONEY — last 7 days FII/DII flow as series for chart
  const flowSeries = (await db.prepare(`
    SELECT trade_date, fii_net_cr, dii_net_cr
    FROM fii_dii_daily WHERE segment='cash'
    ORDER BY trade_date DESC LIMIT 7
  `).all()).results || [];

  // 5. CONCEPT OF THE DAY — rotating glossary entry
  const concepts = [
    { term: 'FII / Foreign Institutional Investor', meaning: 'Mutual funds, hedge funds, pension funds based outside India that buy/sell Indian stocks. Their net flow is the #1 driver of Nifty short-term moves.', why: 'When FII buys ₹3000+ Cr in a day, it usually means foreign confidence in India is up. When they sell heavily, EM-wide risk-off is happening.' },
    { term: 'India VIX', meaning: 'A 30-day forward-looking volatility index. Higher = market expects bigger price swings. Calculated from Nifty option premiums.', why: 'VIX < 13 = complacency (calm before a move). VIX > 18 = fear. Trade more cautiously when VIX is high.' },
    { term: 'Delivery %', meaning: 'Of the shares traded today, what % went to actual delivery (real ownership transfer) vs intraday square-off. High delivery % means real conviction buying.', why: 'A stock up 3% with 70% delivery is real institutional accumulation. Same stock up 3% with 20% delivery is intraday speculation that may reverse.' },
    { term: 'Bulk vs Block deals', meaning: 'Bulk deal = single trade > 0.5% of company shares (reported same day). Block deal = pre-arranged 9:00-9:35 AM trade with min ₹10 cr value.', why: 'Block deals show big institutional money entering or exiting. Tracking which client repeatedly buys a stock is one of our cascade signals.' },
    { term: 'GTT (Good Till Triggered)', meaning: 'A persistent order at Zerodha that fires automatically when a price condition is met. OCO GTT has both stop + target — whichever fires first cancels the other.', why: 'After buying, you place a GTT to auto-sell if stock crashes (stop) or rallies to target. Removes emotion from exits.' },
    { term: 'PE / Price-to-Earnings ratio', meaning: 'Stock price ÷ annual earnings per share. PE 20 means investors pay ₹20 for every ₹1 of yearly earnings.', why: 'High PE = expectations are high. Low PE = either a bargain or a value trap. Compare a stock\'s PE to its sector and history, not in isolation.' },
    { term: 'Repo rate (RBI)', meaning: 'The rate at which Indian banks borrow from RBI. Lower repo = cheaper money in the system = bullish for rate-sensitive sectors (banks, NBFCs, real estate, autos).', why: 'When RBI cuts rates, NBFCs like Bajaj Finance often rally 4-8% over next 5 days. This is one of our cascade patterns.' },
    { term: 'Cascade pattern', meaning: 'A documented event-→-reaction sequence (e.g., RBI rate cut → NBFC rally with 1-2 day lag, ~68% historical hit rate).', why: 'Most retail trades on news. Cascades trade the predictable reaction TO the news. Better R:R than chasing the news itself.' },
    { term: 'Stop-loss', meaning: 'A pre-defined exit price on the loss side. If stock drops to this level, sell automatically — caps your downside.', why: 'You set the stop when you\'re calm and rational, before entering. By the time it hits, you\'re emotional. Trust past-you.' },
    { term: 'Reward:Risk (R:R) ratio', meaning: 'Expected gain ÷ expected loss. Our minimum is 2:1 — gain at least ₹2 for every ₹1 risked.', why: 'You can be wrong 60% of the time and still profit at 2:1 R:R. At 1:1 you need 51% accuracy — much harder. Math beats feelings.' },
  ];
  // Day-of-year rotation so concept changes daily
  const doy = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 0).getTime()) / 86400000);
  const todayConcept = concepts[doy % concepts.length];

  return {
    story,
    story_supporting: { fii_5d: fiiRecent, indices: indicesLatest, repo },
    headlines,
    top_movers: { gainers: topGainers, losers: topLosers, latest_date: lastDate },
    smart_money: flowSeries,
    concept: todayConcept,
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=option_analytics[&underlying=NIFTY|BANKNIFTY|...]
//
// Returns derived option-chain analytics: PCR, Max Pain, IV Skew, OI build,
// regime classification. Reads from option_chain_snapshot.
// ═══════════════════════════════════════════════════════════════════════════
async function getOptionAnalyticsView(db, url) {
  const requested = (url.searchParams.get('underlying') || '').toUpperCase();
  if (requested) {
    const a = await computeOptionAnalytics(db, requested);
    return { underlying: requested, analytics: a };
  }
  // Default: compute for all 4 priority underlyings — Nifty, BankNifty, FinNifty, NiftyMidcap
  const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
  const out = {};
  for (const idx of indices) {
    out[idx] = await computeOptionAnalytics(db, idx);
  }
  // Aggregate market-wide signal
  const valid = Object.values(out).filter(x => x && x.regime);
  const aggBullish = valid.filter(x => x.regime.tone === 'bullish').length;
  const aggBearish = valid.filter(x => x.regime.tone === 'bearish').length;
  const aggregate = valid.length === 0
    ? { tone: 'unknown', label: 'no option data — engine waiting for market hours' }
    : aggBullish > aggBearish
      ? { tone: 'bullish', label: `${aggBullish}/${valid.length} index option chains showing bullish positioning` }
      : aggBearish > aggBullish
        ? { tone: 'bearish', label: `${aggBearish}/${valid.length} index option chains showing bearish positioning` }
        : { tone: 'mixed', label: `${aggBullish} bullish vs ${aggBearish} bearish — no decisive options bias` };
  return { by_underlying: out, aggregate, generated_at: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=sector_rotation[&periodDays=20]
//
// Computes relative strength of each sectoral index vs Nifty 50 over the
// requested lookback. Output: ranked list by relative-strength %, plus a
// 1-line "leadership" summary (which sectors lead, which lag).
//
// Reads from sector_indices + indices_eod (Nifty 50 baseline).
// ═══════════════════════════════════════════════════════════════════════════
async function getSectorRotation(db, url) {
  const periodDays = parseInt(url.searchParams.get('periodDays') || '20');
  // Fetch most recent + (period)-days-ago closes for each sector
  const sectors = (await db.prepare(`
    SELECT index_name,
      (SELECT close_paise FROM sector_indices s2 WHERE s2.index_name = s1.index_name ORDER BY trade_date DESC LIMIT 1) AS latest_paise,
      (SELECT trade_date FROM sector_indices s2 WHERE s2.index_name = s1.index_name ORDER BY trade_date DESC LIMIT 1) AS latest_date,
      (SELECT close_paise FROM sector_indices s3 WHERE s3.index_name = s1.index_name AND s3.trade_date <= date((SELECT MAX(trade_date) FROM sector_indices), '-' || ? || ' days') ORDER BY trade_date DESC LIMIT 1) AS lookback_paise
    FROM sector_indices s1
    GROUP BY index_name
  `).bind(periodDays).all()).results || [];

  // Get Nifty 50 baseline from indices_eod
  const niftyLatest = await db.prepare(
    `SELECT close_paise, trade_date FROM indices_eod WHERE index_name='NIFTY 50' ORDER BY trade_date DESC LIMIT 1`
  ).first();
  const niftyLookback = await db.prepare(
    `SELECT close_paise FROM indices_eod WHERE index_name='NIFTY 50' AND trade_date <= date((SELECT MAX(trade_date) FROM indices_eod), '-' || ? || ' days') ORDER BY trade_date DESC LIMIT 1`
  ).bind(periodDays).first();

  if (!niftyLatest || !niftyLookback) {
    return {
      error: 'insufficient_history',
      message: 'Need at least ' + periodDays + ' days of indices_eod data to compute rotation. Wait for backfill.',
      indices_eod_rows: (await db.prepare(`SELECT COUNT(*) AS n FROM indices_eod`).first())?.n || 0,
      sector_rows: (await db.prepare(`SELECT COUNT(*) AS n FROM sector_indices`).first())?.n || 0,
    };
  }

  const niftyReturn = (niftyLatest.close_paise - niftyLookback.close_paise) / niftyLookback.close_paise * 100;

  const ranked = sectors
    .filter(s => s.latest_paise && s.lookback_paise)
    .map(s => {
      const sectorReturn = (s.latest_paise - s.lookback_paise) / s.lookback_paise * 100;
      const relStrength = sectorReturn - niftyReturn;
      return {
        sector: s.index_name,
        latest_paise: s.latest_paise,
        latest_date: s.latest_date,
        return_pct: parseFloat(sectorReturn.toFixed(2)),
        relative_strength_pct: parseFloat(relStrength.toFixed(2)),
        beats_nifty: relStrength > 0,
      };
    })
    .sort((a, b) => b.relative_strength_pct - a.relative_strength_pct);

  // Leadership summary
  const leaders = ranked.slice(0, 3).map(r => `${r.sector.replace('NIFTY ', '')} (+${r.relative_strength_pct}%)`);
  const laggards = ranked.slice(-3).reverse().map(r => `${r.sector.replace('NIFTY ', '')} (${r.relative_strength_pct}%)`);
  const summary = ranked.length > 0
    ? `Last ${periodDays} days: leaders are ${leaders.join(', ')}. Laggards: ${laggards.join(', ')}. Nifty 50: ${niftyReturn >= 0 ? '+' : ''}${niftyReturn.toFixed(2)}%`
    : 'No sector data yet';

  return {
    period_days: periodDays,
    nifty_return_pct: parseFloat(niftyReturn.toFixed(2)),
    nifty_latest_date: niftyLatest.trade_date,
    sectors_ranked: ranked,
    summary,
    generated_at: Date.now(),
  };
}

async function getQueue(db) {
  const r = await db.prepare(
    `SELECT * FROM backfill_queue ORDER BY status='running' DESC, status='queued' DESC, priority, created_at LIMIT 50`
  ).all();
  return { queue: r.results || [] };
}

async function getConfig(db) {
  const r = await db.prepare(
    `SELECT config_key, config_value, description FROM user_config ORDER BY config_key`
  ).all();
  const map = {};
  for (const row of (r.results || [])) map[row.config_key] = row.config_value;
  return { config: map, rows: r.results || [] };
}

async function setConfig(db, url) {
  const key = url.searchParams.get('config_key');
  const value = url.searchParams.get('config_value');
  if (!key || !value) return { error: 'config_key + config_value required' };
  await db.prepare(
    `INSERT OR REPLACE INTO user_config (config_key, config_value, updated_at)
     VALUES (?, ?, ?)`
  ).bind(key, value, Date.now()).run();
  return { ok: true, key, value };
}

// ─────────────────────────────────────────────────────────
// /trading/ops — Technical Operations Health
// ─────────────────────────────────────────────────────────
async function getOpsHealth(db) {
  const now = Date.now();
  const last24h = now - 24 * 3600000;
  const last1h = now - 3600000;

  // Cron run summary by name (last 24h)
  const cronStats = await db.prepare(`
    SELECT cron_name, worker_name,
      COUNT(*) AS runs_24h,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_24h,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_24h,
      MAX(started_at) AS last_run,
      AVG(duration_ms) AS avg_duration_ms,
      SUM(rows_written) AS rows_written_24h
    FROM cron_run_log WHERE started_at > ?
    GROUP BY cron_name, worker_name
    ORDER BY worker_name, cron_name
  `).bind(last24h).all();

  // Source health
  const sourceHealth = await db.prepare(
    `SELECT * FROM source_health ORDER BY is_circuit_broken DESC, consecutive_failures DESC, source_name`
  ).all();

  // Backfill queue (no rows_loaded column — tracked separately in backfill_progress)
  const backfill = await db.prepare(
    `SELECT status, COUNT(*) AS n
     FROM backfill_queue GROUP BY status`
  ).all();

  // Recent errors (last 24h)
  const recentErrors = await db.prepare(`
    SELECT cron_name, worker_name, started_at, error_message
    FROM cron_run_log WHERE status='failed' AND started_at > ?
    ORDER BY started_at DESC LIMIT 20
  `).bind(last24h).all();

  // Table row counts (the 16 most important)
  const tableRows = {};
  const tables = [
    'equity_eod', 'indices_eod', 'fii_dii_daily', 'fii_deriv_daily',
    'fno_participant_oi', 'bulk_block_deals', 'option_chain_snapshot',
    'india_vix_ticks', 'corp_announcements', 'insider_trades',
    'macro_indicators', 'crossasset_ticks', 'news_items', 'social_posts',
    'signal_scores', 'cascade_triggers_active'
  ];
  for (const t of tables) {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      tableRows[t] = r?.n || 0;
    } catch { tableRows[t] = -1; }
  }

  // Health score: 0-100
  const allRuns = (cronStats.results || []).reduce((a, r) => a + (r.runs_24h || 0), 0);
  const allSuccess = (cronStats.results || []).reduce((a, r) => a + (r.success_24h || 0), 0);
  const successRate = allRuns ? (allSuccess / allRuns) : 0;
  const brokenCount = (sourceHealth.results || []).filter(s => s.is_circuit_broken).length;
  const healthScore = Math.round(Math.max(0, Math.min(100, successRate * 100 - brokenCount * 10)));
  const healthLabel = healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'critical';

  return {
    health_score: healthScore,
    health_label: healthLabel,
    summary: {
      runs_24h: allRuns,
      success_24h: allSuccess,
      success_rate_pct: (successRate * 100).toFixed(1),
      broken_sources: brokenCount,
      total_sources: (sourceHealth.results || []).length,
    },
    cron_stats: cronStats.results || [],
    source_health: sourceHealth.results || [],
    backfill_summary: backfill.results || [],
    recent_errors: recentErrors.results || [],
    table_rows: tableRows,
    generated_at: now,
  };
}

// ─────────────────────────────────────────────────────────
// /trading/execute — Personalized execution view for ₹10L capital
//
// For each top signal:
//   - Auto-assigns to base/aggressive/stretch tranche based on scores
//   - Computes max position size from 2%-of-total-capital risk rule
//   - Computes stop_loss using tranche default %
//   - Computes target using min reward:risk ratio (2:1)
//   - Filters out trades where math doesn't work
// ─────────────────────────────────────────────────────────
async function getExecuteView(db, env) {
  // Load user config
  const cfg = await getConfig(db);
  const c = cfg.config;
  const totalCapital = parseInt(c.total_capital_paise || '100000000');
  const maxRiskPct = parseFloat(c.max_risk_per_trade_pct || '2.0');
  const minRRRatio = parseFloat(c.min_reward_risk_ratio || '2.0');
  const maxPositions = parseInt(c.max_active_positions || '3');
  const minScore = parseInt(c.max_signal_threshold || '70');
  const stopPct = {
    base: parseFloat(c.base_stop_pct || '5.0'),
    aggressive: parseFloat(c.aggressive_stop_pct || '7.0'),
    stretch: parseFloat(c.stretch_stop_pct || '10.0'),
  };
  const tranchePaise = {
    base: parseInt(c.base_tranche_paise || '40000000'),
    aggressive: parseInt(c.aggressive_tranche_paise || '30000000'),
    stretch: parseInt(c.stretch_tranche_paise || '30000000'),
  };

  const maxRiskPaise = Math.floor(totalCapital * maxRiskPct / 100);

  // Capital deployment status
  const capStatus = await db.prepare(`SELECT * FROM v_capital_status`).first() || {};

  // Active positions
  const positions = (await db.prepare(
    `SELECT * FROM position_watchlist WHERE is_active=1 ORDER BY entry_date DESC`
  ).all()).results || [];

  // Cooldown check — proxy via system_alerts (3 stop_loss critical alerts in last 7 days)
  const recentStops = await db.prepare(`
    SELECT COUNT(*) AS n FROM system_alerts
    WHERE category='stop_loss' AND severity='critical' AND ts > ?
  `).bind(Date.now() - 7 * 86400000).first();
  const inCooldown = (recentStops?.n || 0) >= 3;

  // Top signals — joined with last EOD to compute daily traded value (₹)
  // for liquidity filtering. Cards must have ≥ ₹10 Cr daily turnover (configurable).
  const minLiquidityRupees = parseInt(c.min_liquidity_rupees || '100000000'); // ₹10 Cr default
  const latestSig = await db.prepare(
    `SELECT MAX(computed_at) AS m FROM signal_scores`
  ).first();
  let topSignals = [];
  if (latestSig?.m) {
    topSignals = (await db.prepare(`
      WITH latest_eod AS (
        SELECT symbol, close_paise, volume,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) AS rn
        FROM equity_eod WHERE exchange='NSE'
      )
      SELECT s.*, e.close_paise AS last_close_paise, e.volume AS last_volume,
        (e.close_paise * e.volume / 100.0) AS traded_value_rupees
      FROM signal_scores s
      LEFT JOIN latest_eod e ON e.symbol = s.symbol AND e.rn = 1
      WHERE s.computed_at = ? AND s.composite_score >= ?
        AND e.close_paise IS NOT NULL
        AND (e.close_paise * e.volume / 100.0) >= ?
      ORDER BY s.composite_score DESC LIMIT 15
    `).bind(latestSig.m, minScore, minLiquidityRupees).all()).results || [];
  }

  // Active cascades
  const cascades = (await db.prepare(`
    SELECT * FROM cascade_triggers_active
    WHERE status='active' AND expected_window_end > ?
    ORDER BY detected_at DESC
  `).bind(Date.now()).all()).results || [];
  const cascadeSymbols = new Set();
  for (const c of cascades) {
    try { JSON.parse(c.affected_symbols || '[]').forEach(s => cascadeSymbols.add(s)); } catch {}
  }

  // Bulk-fetch live LTP from Kite for all top signal symbols (1 API call vs N)
  const ltpMap = await fetchLiveLtp(db, env, topSignals.map(s => s.symbol));

  // Detect current regime ONCE (used for Bayesian bucket lookup per-signal)
  const currentRegime = await detectRegime(db).catch(() => 'unknown');

  // For each signal, prefer LIVE LTP (Kite) over yesterday's EOD close
  // Build BOTH:
  //   - tradeCards: filtered to passing 2:1 R:R math (actionable)
  //   - watchList: ALL signals with their math + reason for inclusion/skip (educational)
  const tradeCards = [];
  const watchList = [];
  for (const sig of topSignals) {
    let entryPaise = ltpMap[sig.symbol];
    let priceSource = 'kite_live';
    if (!entryPaise) {
      const eod = await db.prepare(
        `SELECT close_paise FROM equity_eod WHERE symbol=? AND exchange='NSE'
         ORDER BY trade_date DESC LIMIT 1`
      ).bind(sig.symbol).first();
      if (!eod) {
        // Add to watch list with note about missing price
        watchList.push({
          symbol: sig.symbol,
          composite_score: sig.composite_score,
          tranche: 'base',
          tradeable: false,
          skip_reason: 'no_price_data',
          skip_message: 'No price data — backfill incomplete or symbol not in NSE',
        });
        continue;
      }
      entryPaise = eod.close_paise;
      priceSource = 'eod_close';
    }

    // Auto-route to tranche based on signal characteristics
    let tranche = 'base';
    if (cascadeSymbols.has(sig.symbol)) tranche = 'stretch';
    else if (sig.catalyst_score >= 70 && sig.composite_score >= 75) tranche = 'aggressive';

    // Compute stop using tranche default
    const stopPctVal = stopPct[tranche];
    const stopPaise = Math.round(entryPaise * (1 - stopPctVal / 100));
    const riskPerSharePaise = entryPaise - stopPaise;

    // ─── ADAPTIVE R:R + KELLY-FRACTION SIZING (with Bayesian override) ───
    // Brackets by score band, then refined by empirical posterior once a
    // (tranche × score_band × cascade × regime) bucket has ≥30 observed trades.
    const sigBand = scoreBand(sig.composite_score);
    const cascadePattern = cascadeSymbols.has(sig.symbol)
      ? (cascades.find(cs => {
          try { return JSON.parse(cs.affected_symbols || '[]').includes(sig.symbol); }
          catch { return false; }
        })?.pattern_name || 'generic_cascade')
      : null;
    const posterior = await getPosterior(db, {
      tranche, score_band: sigBand, cascade_pattern: cascadePattern, regime: currentRegime,
    }, null).catch(() => null);

    // If posterior is empirical (≥30 trades), use that win-rate + R:R for sizing.
    // Otherwise fall back to the hardcoded score-band priors.
    const empiricalP = posterior?.source === 'empirical' ? posterior.win_rate : null;
    const empiricalRR = posterior?.source === 'empirical' ? posterior.avg_rr_realized : null;

    const dynamicMinRR = parseFloat(c.rr_rule || 'adaptive') === 'flat'
      ? minRRRatio
      : adaptiveMinRR(sig.composite_score);
    const dynamicRiskFrac = (c.risk_rule || 'adaptive') === 'flat'
      ? maxRiskPct / 100
      : Math.min(adaptiveRiskPct(sig.composite_score, empiricalP, empiricalRR), maxRiskPct / 100);
    const dynamicRiskPaise = Math.floor(totalCapital * dynamicRiskFrac);

    // Position size from adaptive risk rule
    const maxQty = Math.floor(dynamicRiskPaise / riskPerSharePaise);
    if (maxQty < 1) {
      watchList.push({
        symbol: sig.symbol, composite_score: sig.composite_score, tranche,
        entry_paise: entryPaise, stop_pct: stopPctVal,
        tradeable: false, skip_reason: 'qty_too_small',
        skip_message: `Risk per share ₹${(riskPerSharePaise/100).toFixed(2)} > max risk ₹${(dynamicRiskPaise/100).toFixed(0)} (${(dynamicRiskFrac*100).toFixed(2)}% of capital) — single share exceeds adaptive risk band`,
      });
      continue;
    }

    // Cap by tranche capacity
    const maxByTranche = Math.floor(tranchePaise[tranche] / entryPaise);
    const qty = Math.min(maxQty, maxByTranche);
    if (qty < 1) {
      watchList.push({
        symbol: sig.symbol, composite_score: sig.composite_score, tranche,
        entry_paise: entryPaise, stop_pct: stopPctVal,
        tradeable: false, skip_reason: 'tranche_too_small',
        skip_message: `Tranche capacity ₹${(tranchePaise[tranche]/100).toFixed(0)} < single share ₹${(entryPaise/100).toFixed(2)} — stock too expensive for current capital`,
      });
      continue;
    }

    // Compute target using adaptive R:R (or cascade expected return if higher)
    const cascadeReturn = cascades.find(cs => {
      try { return JSON.parse(cs.affected_symbols || '[]').includes(sig.symbol); } catch { return false; }
    })?.expected_return_pct;
    const targetPctFromRR = stopPctVal * dynamicMinRR;
    const targetPct = Math.max(targetPctFromRR, cascadeReturn || 0);
    const targetPaise = Math.round(entryPaise * (1 + targetPct / 100));

    const rewardPerSharePaise = targetPaise - entryPaise;
    const rrRatio = rewardPerSharePaise / riskPerSharePaise;

    // Skip if math doesn't work — using ADAPTIVE threshold
    if (rrRatio < dynamicMinRR) {
      watchList.push({
        symbol: sig.symbol, composite_score: sig.composite_score, tranche,
        entry_paise: entryPaise, stop_pct: stopPctVal, target_pct: targetPct,
        rr_ratio: parseFloat(rrRatio.toFixed(2)),
        tradeable: false, skip_reason: 'rr_below_min',
        skip_message: `R:R ${rrRatio.toFixed(2)}:1 below adaptive min ${dynamicMinRR.toFixed(2)}:1 (score ${sig.composite_score.toFixed(0)}) — wait for better setup`,
      });
      continue;
    }

    const capitalDeployed = qty * entryPaise;
    const maxLossPaise = qty * riskPerSharePaise;
    const maxGainPaise = qty * rewardPerSharePaise;

    // ─── COST-AWARE NET MATH ───
    // Compute round-trip transaction costs at both target + stop scenarios.
    // Surface NET numbers alongside gross so user sees what they'll keep.
    const winCost = roundTripCostCnc(entryPaise, targetPaise, qty);
    const lossCost = roundTripCostCnc(entryPaise, stopPaise, qty);
    const netGainPaise = maxGainPaise - winCost.total_paise;
    const netLossPaise = maxLossPaise + lossCost.total_paise; // costs deepen loss
    const netRr = netLossPaise > 0 ? netGainPaise / netLossPaise : 0;

    tradeCards.push({
      symbol: sig.symbol,
      exchange: 'NSE',
      tranche,
      composite_score: sig.composite_score,
      sub_scores: {
        trend: sig.trend_score,
        flow: sig.flow_score,
        options: sig.options_score,
        catalyst: sig.catalyst_score,
        macro: sig.macro_score,
        sentiment: sig.sentiment_score,
        breadth: sig.breadth_score,
      },
      entry_paise: entryPaise,
      price_source: priceSource,                  // 'kite_live' or 'eod_close'
      stop_paise: stopPaise,
      target_paise: targetPaise,
      stop_pct: stopPctVal,
      target_pct: targetPct,
      qty,
      capital_deployed_paise: capitalDeployed,
      max_loss_paise: maxLossPaise,
      max_gain_paise: maxGainPaise,
      // Cost-adjusted (NET) numbers — what you actually keep / pay after STT, GST, brokerage, exchange, SEBI, DP
      net_gain_paise: netGainPaise,
      net_loss_paise: netLossPaise,
      cost_win_paise: winCost.total_paise,
      cost_loss_paise: lossCost.total_paise,
      net_rr_ratio: parseFloat(netRr.toFixed(2)),
      cost_breakdown: winCost.breakdown,
      // Adaptive R:R + Kelly band info — shows user WHY this card has these numbers
      adaptive_min_rr: parseFloat(dynamicMinRR.toFixed(2)),
      adaptive_risk_pct: parseFloat((dynamicRiskFrac * 100).toFixed(2)),
      sizing_rule: (c.risk_rule || 'adaptive'),
      rr_rule: (c.rr_rule || 'adaptive'),
      // Bayesian posterior — empirical override or prior fallback
      bayesian: posterior ? {
        source: posterior.source,
        win_rate: posterior.win_rate,
        sample_size: posterior.total_trades,
        bucket: posterior.bucket_used,
        avg_rr: posterior.avg_rr_realized,
      } : null,
      regime: currentRegime,
      rr_ratio: parseFloat(rrRatio.toFixed(2)),
      capital_deployed_pct: parseFloat((capitalDeployed / totalCapital * 100).toFixed(1)),
      cascade_match: cascadeSymbols.has(sig.symbol),
      rationale: buildRationale(sig, tranche, !!cascadeReturn),
      // Pre-built order specs ready to POST to /api/kite
      order_spec: {
        exchange: 'NSE',
        tradingsymbol: sig.symbol,
        transaction_type: 'BUY',
        quantity: qty,
        order_type: 'MARKET',
        product: 'CNC',
        validity: 'DAY',
        tag: `HN_WE_${tranche.toUpperCase().slice(0,3)}`,
      },
      gtt_spec: {
        type: 'two-leg',
        tradingsymbol: sig.symbol,
        exchange: 'NSE',
        last_price: parseFloat((entryPaise / 100).toFixed(2)),
        stop_trigger: parseFloat((stopPaise / 100).toFixed(2)),
        stop_price: parseFloat((stopPaise / 100).toFixed(2)),
        target_trigger: parseFloat((targetPaise / 100).toFixed(2)),
        target_price: parseFloat((targetPaise / 100).toFixed(2)),
        quantity: qty,
        transaction_type: 'SELL',
        product: 'CNC',
      },
    });
    // Also add to watch list (tradeable variant)
    watchList.push({
      symbol: sig.symbol, composite_score: sig.composite_score, tranche,
      entry_paise: entryPaise, stop_pct: stopPctVal, target_pct: targetPct,
      qty, rr_ratio: parseFloat(rrRatio.toFixed(2)),
      tradeable: true, skip_reason: null,
      skip_message: 'PASSES MATH — see Trade Cards above',
    });
  }

  // Sort cards by composite score
  tradeCards.sort((a, b) => b.composite_score - a.composite_score);
  watchList.sort((a, b) => b.composite_score - a.composite_score);

  // Block reasons
  const blockers = [];
  if (positions.length >= maxPositions) blockers.push(`Max ${maxPositions} positions reached. Close one before adding new.`);
  if (inCooldown) blockers.push(`COOLDOWN: 3 consecutive stop-losses hit. Take 1 week off (Rule 8).`);
  if (tradeCards.length === 0 && topSignals.length > 0) blockers.push(`Top signals exist but none pass adaptive R:R math (1.4-2.3:1 by score band). Wait for better setups.`);
  if (tradeCards.length === 0 && topSignals.length === 0) blockers.push(`No signals above ${minScore} composite score today. Sit out.`);

  // Daily briefing (latest)
  const briefingRow = await db.prepare(
    `SELECT * FROM daily_briefings ORDER BY briefing_date DESC LIMIT 1`
  ).first();
  let briefing = null;
  if (briefingRow) {
    briefing = { ...briefingRow };
    for (const k of ['market_pulse','top_signals','active_cascades','fii_dii_yesterday','key_macro','upcoming_events','earnings_today']) {
      try { briefing[k] = JSON.parse(briefing[k] || 'null'); } catch {}
    }
  }

  // Market pulse — live snapshot of key indices + cross-asset
  const indicesLatest = (await db.prepare(`
    SELECT i1.* FROM indices_eod i1
    JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
      ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
    WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX')
  `).all()).results || [];
  const crossLatest = (await db.prepare(`
    SELECT c1.asset_code, c1.value, c1.ts FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks GROUP BY asset_code) c2
      ON c1.asset_code=c2.asset_code AND c1.ts=c2.m
    WHERE c1.asset_code IN ('DXY','BRENT','US10Y','VIX_US')
  `).all()).results || [];
  const marketPulse = {
    indices: indicesLatest,
    cross_asset: crossLatest,
  };

  // Engine state (sources health summary, backfill progress)
  const engineState = {
    sources_healthy: (await db.prepare(`SELECT COUNT(*) AS n FROM source_health WHERE is_circuit_broken=0 AND last_success_ts > ?`).bind(Date.now() - 24*3600*1000).first())?.n || 0,
    sources_total: (await db.prepare(`SELECT COUNT(*) AS n FROM source_health`).first())?.n || 0,
    equity_rows: (await db.prepare(`SELECT COUNT(*) AS n FROM equity_eod`).first())?.n || 0,
    equity_dates: (await db.prepare(`SELECT COUNT(DISTINCT trade_date) AS n FROM equity_eod`).first())?.n || 0,
    backfill_pending: (await db.prepare(`SELECT COUNT(*) AS n FROM backfill_queue WHERE status IN ('queued','running')`).first())?.n || 0,
  };

  // Pull live Kite state (reconciled by orchestrator every 5 min)
  const kiteFunds = await db.prepare(
    `SELECT * FROM kite_funds_live WHERE segment='equity' LIMIT 1`
  ).first();
  const kiteHoldings = (await db.prepare(
    `SELECT * FROM kite_holdings_live ORDER BY market_value_paise DESC`
  ).all()).results || [];
  const recentOrders = (await db.prepare(
    `SELECT order_id, tradingsymbol, transaction_type, quantity, filled_quantity,
            average_price_paise, status, status_message, tag, placed_at
     FROM kite_orders_log ORDER BY placed_at DESC LIMIT 10`
  ).all()).results || [];

  // ─── ENRICH trade_cards with day OHLC + ₹10L hypothetical ──────────────
  // Owner asked May 5: render the 15 trade cards in the same rich format as
  // the Today's Watchlist (open / peak / low / close + ₹10L peak/close/drawdown
  // scenario per stock). Reuses the same logic as todays_watchlist.
  if (tradeCards.length > 0) {
    const istDate = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const tcSymbols = [...new Set(tradeCards.map(c => c.symbol))];
    const placeholders = tcSymbols.map(() => '?').join(',');

    const ohlcRows = (await db.prepare(`
      SELECT b.symbol,
        MIN(CASE WHEN ts = (SELECT MIN(ts) FROM intraday_bars b2 WHERE b2.symbol=b.symbol AND b2.trade_date=? AND b2.interval='5minute') THEN open_paise END) AS day_open,
        MAX(b.high_paise) AS day_high,
        MIN(b.low_paise)  AS day_low,
        MAX(CASE WHEN ts = (SELECT MAX(ts) FROM intraday_bars b3 WHERE b3.symbol=b.symbol AND b3.trade_date=? AND b3.interval='5minute') THEN close_paise END) AS day_close,
        SUM(b.volume) AS day_volume
      FROM intraday_bars b
      WHERE b.symbol IN (${placeholders}) AND b.trade_date=? AND b.interval='5minute'
      GROUP BY b.symbol
    `).bind(istDate, istDate, ...tcSymbols, istDate).all().catch(() => ({ results: [] }))).results || [];
    const ohlcMap = {};
    for (const r of ohlcRows) ohlcMap[r.symbol] = r;

    const liveTickRows = (await db.prepare(`
      SELECT t1.symbol, t1.ltp_paise, t1.ts FROM intraday_ticks t1
      JOIN (SELECT symbol, MAX(ts) AS m FROM intraday_ticks WHERE symbol IN (${placeholders}) GROUP BY symbol) t2
        ON t1.symbol=t2.symbol AND t1.ts=t2.m
    `).bind(...tcSymbols).all().catch(() => ({ results: [] }))).results || [];
    const ltpMap = {};
    for (const t of liveTickRows) ltpMap[t.symbol] = t.ltp_paise;

    const prevCloseRows = (await db.prepare(`
      SELECT symbol, close_paise FROM equity_eod
      WHERE symbol IN (${placeholders})
        AND trade_date = (SELECT MAX(trade_date) FROM equity_eod WHERE trade_date < ?)
    `).bind(...tcSymbols, istDate).all().catch(() => ({ results: [] }))).results || [];
    const prevCloseMap = {};
    for (const r of prevCloseRows) prevCloseMap[r.symbol] = r.close_paise;

    const TEN_LAKH = 100000000;
    const zerodhaCost = (e, x, q) => {
      const buy = Math.abs(e) * q, sell = Math.abs(x) * q;
      return Math.round(4000 + sell * 0.00025 + (buy + sell) * 0.0000322 + buy * 0.00003 + (4000 + (buy + sell) * 0.0000322) * 0.18);
    };

    for (const card of tradeCards) {
      const ohlc = ohlcMap[card.symbol];
      const dayOpen   = ohlc?.day_open  || null;
      const dayHigh   = ohlc?.day_high  || null;
      const dayLow    = ohlc?.day_low   || null;
      const dayClose  = ohlc?.day_close || null;
      const dayVolume = ohlc?.day_volume || null;
      const liveLtp = ltpMap[card.symbol] || null;
      const prevClose = prevCloseMap[card.symbol] || null;
      const cur = liveLtp || dayClose || null;

      card.day_open_paise  = dayOpen;
      card.day_high_paise  = dayHigh;
      card.day_low_paise   = dayLow;
      card.day_close_paise = dayClose;
      card.day_volume      = dayVolume;
      card.live_ltp_paise  = liveLtp;
      card.prev_close_paise = prevClose;
      card.day_change_pct = (cur && dayOpen) ? +(((cur - dayOpen) / dayOpen) * 100).toFixed(2) : null;
      card.gap_from_prev_close_pct = (dayOpen && prevClose) ? +(((dayOpen - prevClose) / prevClose) * 100).toFixed(2) : null;

      // ₹10L hypothetical scenarios (same shape as todays_watchlist)
      if (dayOpen && dayOpen > 100) {
        const qty = Math.floor(TEN_LAKH / dayOpen);
        card.if_10L_invested = {
          qty,
          deployed_paise: qty * dayOpen,
          if_exited_at_peak_paise: dayHigh ? (dayHigh - dayOpen) * qty - zerodhaCost(dayOpen, dayHigh, qty) : null,
          if_exited_at_peak_pct: dayHigh ? +(((dayHigh - dayOpen) / dayOpen) * 100).toFixed(2) : null,
          if_held_to_close_paise: dayClose ? (dayClose - dayOpen) * qty - zerodhaCost(dayOpen, dayClose, qty) : null,
          if_held_to_close_pct: dayClose ? +(((dayClose - dayOpen) / dayOpen) * 100).toFixed(2) : null,
          if_held_live_paise: cur ? (cur - dayOpen) * qty - zerodhaCost(dayOpen, cur, qty) : null,
          max_intraday_drawdown_paise: dayLow ? (dayLow - dayOpen) * qty - zerodhaCost(dayOpen, dayLow, qty) : null,
        };
      }
    }
  }

  return {
    user_name: c.user_full_name || c.user_name || 'Trader',
    kite_user_id: c.kite_user_id || null,
    launch_date: c.launch_date || null,
    launch_status: c.launch_status || 'unknown',     // pre_launch | ready | live | paused
    funding_status: c.funding_status || 'unknown',   // pending_cpv_hdfc_freeze | funded | partial | depleted
    cpv_status: c.cpv_status || null,                // requested | scheduled | completed
    engine_mode: c.engine_mode || 'live',            // shadow_run | live
    block_real_orders: c.block_real_orders === '1',  // boolean
    learning_phase: c.learning_phase === '1',
    target_capital_paise: parseInt(c.target_capital_paise || c.total_capital_paise || '10000000'),
    scaling_plan: c.scaling_plan || null,
    kite_live: {
      funds: kiteFunds || null,
      holdings: kiteHoldings,
      recent_orders: recentOrders,
      reconciled_at: kiteFunds?.refreshed_at || null,
    },
    capital: {
      total_paise: totalCapital,
      base_capacity_paise: tranchePaise.base,
      aggressive_capacity_paise: tranchePaise.aggressive,
      stretch_capacity_paise: tranchePaise.stretch,
      base_deployed_paise: capStatus.base_deployed || 0,
      aggressive_deployed_paise: capStatus.aggressive_deployed || 0,
      stretch_deployed_paise: capStatus.stretch_deployed || 0,
      max_risk_per_trade_paise: maxRiskPaise,
    },
    rules: {
      max_risk_per_trade_pct: maxRiskPct,
      min_reward_risk_ratio: minRRRatio,
      max_active_positions: maxPositions,
      min_signal_score: minScore,
    },
    active_positions: positions,
    in_cooldown: inCooldown,
    blockers,
    trade_cards: tradeCards,
    watch_list: watchList,                // ALL signals ≥ min_score with reason
    cascades,
    briefing,                              // daily morning briefing (compiled 08:30 IST)
    market_pulse: marketPulse,             // live market context (Nifty, VIX, DXY, Brent)
    engine_state: engineState,             // sources health, backfill progress
    // ── New analytics layers (best-effort; may be null pre-Monday-market-open) ──
    option_analytics: await safeCall(() => getOptionAnalyticsView(db, new URL('http://x/?'))),
    sector_rotation: await safeCall(() => getSectorRotation(db, new URL('http://x/?periodDays=20'))),
    generated_at: Date.now(),
  };
}

// Wrapper that swallows errors — analytics shouldn't break the main view
// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=bayesian_state
//
// Read-only view of the current learning state — what the engine knows about
// each (tranche × score_band × cascade × regime) bucket.
// ═══════════════════════════════════════════════════════════════════════════
async function getBayesianState(db) {
  const priors = (await db.prepare(`
    SELECT bucket_key, tranche, score_band, cascade_pattern, regime,
      total_trades, win_count, loss_count,
      ROUND(1.0 * alpha / (alpha + beta), 3) AS posterior_win_rate,
      ROUND(sum_pnl_pct / total_trades, 2) AS avg_pnl_pct,
      ROUND(sum_win_pct / NULLIF(win_count, 0), 2) AS avg_win_pct,
      ROUND(sum_loss_pct / NULLIF(loss_count, 0), 2) AS avg_loss_pct,
      consecutive_wins, consecutive_losses,
      avg_hold_days,
      datetime(last_updated_at / 1000, 'unixepoch', 'localtime') AS last_updated
    FROM bayesian_priors
    WHERE total_trades > 0
    ORDER BY total_trades DESC
    LIMIT 100
  `).all()).results || [];

  const recentObs = (await db.prepare(`
    SELECT ts, symbol, tranche, score_band, cascade_pattern, regime,
      composite_score, pnl_pct, win_loss, hold_days, exit_reason
    FROM bayesian_observations
    ORDER BY ts DESC LIMIT 20
  `).all()).results || [];

  const summary = {
    total_buckets_observed: priors.length,
    total_trades_recorded: priors.reduce((s, p) => s + (p.total_trades || 0), 0),
    overall_win_rate: priors.length > 0
      ? parseFloat((priors.reduce((s, p) => s + (p.win_count || 0), 0) /
                    priors.reduce((s, p) => s + (p.total_trades || 0), 0)).toFixed(3))
      : null,
    note: 'Engine uses these posteriors once a bucket has ≥30 trades; before that it falls back to hardcoded priors.',
  };

  return { summary, by_bucket: priors, recent_observations: recentObs, generated_at: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=bond_direction — read computed yield direction
// ═══════════════════════════════════════════════════════════════════════════
async function getBondDirection(db) {
  // Most recent row per tenor
  const rows = (await db.prepare(`
    SELECT b.* FROM bond_yields b
    INNER JOIN (SELECT tenor, MAX(ts) AS max_ts FROM bond_yields GROUP BY tenor) latest
      ON b.tenor = latest.tenor AND b.ts = latest.max_ts
    ORDER BY b.tenor
  `).all()).results || [];
  // Friendly summary
  const tenor10y = rows.find(r => r.tenor === '10Y');
  let summary = 'No bond data yet — runs daily at 21:40 IST.';
  if (tenor10y) {
    const dir = tenor10y.direction;
    summary = dir === 'yields_falling'
      ? `Indian 10Y yields falling (GSec index +${tenor10y.change_5d_pct}% over 5d) — bullish for rate-sensitive sectors (NBFCs, real estate, autos).`
      : dir === 'yields_rising'
      ? `Indian 10Y yields rising (GSec index ${tenor10y.change_5d_pct}% over 5d) — caution on rate-sensitives, favour banks + cap-light businesses.`
      : `Indian 10Y yields flat (GSec index ${tenor10y.change_5d_pct}% over 5d) — no rate-driven theme.`;
  }
  return { summary, tenors: rows, generated_at: Date.now() };
}

async function safeCall(fn) {
  try { return await fn(); } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
}

// Bulk-fetch live LTP from Kite for an array of NSE symbols.
// Returns { SYMBOL: ltp_in_paise }. Empty object if Kite not connected.
// One Kite API call covers up to 250 instruments — well under our top-10 needs.
async function fetchLiveLtp(db, env, symbols) {
  if (!symbols || symbols.length === 0) return {};
  if (!env.KITE_API_KEY) return {};
  // Get active token
  const tok = await db.prepare(
    `SELECT access_token, expires_at FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (!tok || Date.now() > tok.expires_at) return {};

  const params = symbols.map(s => `i=${encodeURIComponent('NSE:' + s)}`).join('&');
  const url = `https://api.kite.trade/quote/ltp?${params}`;
  try {
    const r = await fetch(url, {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return {};
    const j = await r.json();
    const data = j.data || {};
    const out = {};
    for (const key of Object.keys(data)) {
      // key format: "NSE:RELIANCE"
      const sym = key.split(':')[1];
      if (sym && data[key].last_price != null) {
        out[sym] = Math.round(data[key].last_price * 100);
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

function buildRationale(sig, tranche, hasCascade) {
  const drivers = [];
  if (sig.trend_score >= 75) drivers.push('strong uptrend');
  if (sig.flow_score >= 75) drivers.push('institutions accumulating');
  if (sig.catalyst_score >= 75) drivers.push('catalyst imminent');
  if (sig.macro_score >= 75) drivers.push('macro tailwind');
  if (sig.options_score >= 70) drivers.push('options bullish');
  if (sig.sentiment_score >= 70) drivers.push('positive news/social');
  if (sig.breadth_score >= 70) drivers.push('high delivery conviction');
  if (hasCascade) drivers.push('cascade pattern firing');
  const trancheNote = {
    base: 'BASE — quality compounder, hold weeks',
    aggressive: 'AGGRESSIVE — catalyst-driven, hold days',
    stretch: 'STRETCH — cascade play, defined-risk',
  }[tranche];
  return `${trancheNote}. Drivers: ${drivers.length ? drivers.join(', ') : 'composite-only edge'}.`;
}

async function getSummary(db) {
  const [health, indices, extremes, circuits, backfill, universe, signals, cascades, fii, alerts, briefing] = await Promise.all([
    getHealth(db),
    getIndices(db),
    getExtremes(db),
    getCircuits(db),
    getBackfill(db),
    getUniverse(db),
    getSignals(db),
    getCascades(db),
    getFiiDii(db),
    getAlerts(db, new URL('http://x/?limit=10&unread=1')),
    getBriefing(db),
  ]);
  return {
    generated_at: Date.now(),
    health,
    indices,
    extremes,
    circuits,
    backfill,
    universe,
    signals,
    cascades,
    fii,
    alerts,
    briefing,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WATCHLIST
// ═══════════════════════════════════════════════════════════════════════════
async function getWatchlist(db, url) {
  // Hybrid: user-defined PLUS engine top picks (deduped)
  const userRows = (await db.prepare(
    `SELECT id, symbol, exchange, added_at, notes, thesis, category, alert_above, alert_below
     FROM user_watchlist WHERE is_active=1 ORDER BY added_at DESC`
  ).all()).results || [];

  // Engine top picks (latest signal computation, top 10)
  const enginePicks = (await db.prepare(`
    SELECT s.symbol, s.composite_score, s.trend_score, s.flow_score, s.catalyst_score, s.macro_score
    FROM signal_scores s
    JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m
    ORDER BY s.composite_score DESC LIMIT 10
  `).all()).results || [];

  // Latest EOD price for both lists
  const allSyms = [...userRows.map(r => r.symbol), ...enginePicks.map(r => r.symbol)];
  const ltps = {};
  if (allSyms.length > 0) {
    const placeholders = allSyms.map(() => '?').join(',');
    const ltpRows = (await db.prepare(`
      SELECT symbol, close_paise, prev_close_paise, trade_date
      FROM equity_eod e1
      WHERE symbol IN (${placeholders})
        AND trade_date = (SELECT MAX(trade_date) FROM equity_eod e2 WHERE e2.symbol = e1.symbol)
    `).bind(...allSyms).all()).results || [];
    for (const r of ltpRows) ltps[r.symbol] = r;
  }

  return {
    user_watchlist: userRows.map(r => ({ ...r, latest: ltps[r.symbol] || null })),
    engine_picks: enginePicks.map(r => ({ ...r, latest: ltps[r.symbol] || null })),
    generated_at: Date.now(),
  };
}

async function addWatchlist(db, url) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  if (!symbol) return { error: 'symbol required' };
  const exchange = (url.searchParams.get('exchange') || 'NSE').toUpperCase();
  const thesis = url.searchParams.get('thesis') || null;
  const category = url.searchParams.get('category') || 'tracking';
  const alertAbove = url.searchParams.get('alert_above') ? Math.round(parseFloat(url.searchParams.get('alert_above')) * 100) : null;
  const alertBelow = url.searchParams.get('alert_below') ? Math.round(parseFloat(url.searchParams.get('alert_below')) * 100) : null;
  // Soft-delete any existing inactive then insert
  await db.prepare(
    `INSERT OR REPLACE INTO user_watchlist (symbol, exchange, added_at, thesis, category, alert_above, alert_below, is_active)
     VALUES (?,?,?,?,?,?,?,1)`
  ).bind(symbol, exchange, Date.now(), thesis, category, alertAbove, alertBelow).run();
  return { ok: true, symbol };
}

async function removeWatchlist(db, url) {
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return { error: 'id required' };
  await db.prepare(`UPDATE user_watchlist SET is_active=0 WHERE id=?`).bind(id).run();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=stock_picker
//
// Enriched stock list for the picker modal. Returns 4 sections:
//   1. watchlist     — user's tracked stocks (top of list)
//   2. top_movers    — biggest %change today, with volume
//   3. by_sector     — top 5 from each major sector
//   4. all_liquid    — top 100 most-liquid for fallback search
// Each stock has: symbol, name, last_close, prev_close, change_pct, volume,
//                 daily_value_cr, sector. Live LTP from Kite when available.
// ═══════════════════════════════════════════════════════════════════════════
async function stockPicker(db, env, url) {
  const includeLtp = url.searchParams.get('ltp') === '1';
  const search = (url.searchParams.get('q') || '').toUpperCase().trim();

  // Watchlist
  const watchlist = (await db.prepare(`
    SELECT w.symbol, w.thesis, w.category, k.name
    FROM user_watchlist w
    LEFT JOIN kite_instruments k ON k.tradingsymbol = w.symbol AND k.exchange = 'NSE' AND k.instrument_type = 'EQ'
    WHERE w.is_active = 1
    ORDER BY w.added_at DESC
  `).all()).results || [];

  // Latest EOD per symbol — used for price + change
  const liquidStocks = (await db.prepare(`
    WITH latest_eod AS (
      SELECT symbol, close_paise, prev_close_paise, volume, trade_date,
        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) AS rn
      FROM equity_eod WHERE exchange='NSE' AND volume > 0
    ),
    avg_value AS (
      SELECT symbol, AVG(close_paise * volume / 100.0) AS avg_val
      FROM equity_eod WHERE exchange='NSE' AND trade_date >= date('now', '-30 days')
        AND volume > 0
      GROUP BY symbol
    )
    SELECT e.symbol, e.close_paise, e.prev_close_paise, e.volume, e.trade_date,
      a.avg_val, k.name, k.instrument_token
    FROM latest_eod e
    JOIN avg_value a ON a.symbol = e.symbol
    LEFT JOIN kite_instruments k ON k.tradingsymbol = e.symbol AND k.exchange = 'NSE' AND k.instrument_type = 'EQ'
    WHERE e.rn = 1 AND a.avg_val >= 50000000  -- ₹5 Cr+ avg daily
    ORDER BY a.avg_val DESC LIMIT 200
  `).all()).results || [];

  // Decorate with derived fields
  const enrich = (rows) => rows.map(r => {
    const close = r.close_paise || 0;
    const prev = r.prev_close_paise || close;
    const changePct = prev > 0 ? ((close - prev) / prev * 100) : 0;
    const dailyCr = (r.avg_val || 0) / 1e7;
    return {
      symbol: r.symbol,
      name: r.name || r.symbol,
      last_close_rupees: close / 100,
      prev_close_rupees: prev / 100,
      change_pct: parseFloat(changePct.toFixed(2)),
      volume: r.volume,
      daily_value_cr: parseFloat(dailyCr.toFixed(1)),
      trade_date: r.trade_date,
    };
  });

  // Live LTP overlay for top 50 if Kite connected (best-effort; one bulk call)
  let liveLtpMap = {};
  if (includeLtp && env?.KITE_API_KEY) {
    try {
      const top50 = liquidStocks.slice(0, 50).map(r => r.symbol);
      const tok = await db.prepare(
        `SELECT access_token, expires_at FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
      ).first();
      if (tok && Date.now() < tok.expires_at) {
        const params = top50.map(s => `i=${encodeURIComponent('NSE:' + s)}`).join('&');
        const r = await fetch(`https://api.kite.trade/quote/ltp?${params}`, {
          headers: { 'X-Kite-Version': '3', 'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}` },
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const j = await r.json();
          for (const key of Object.keys(j.data || {})) {
            const sym = key.split(':')[1];
            if (sym && j.data[key].last_price != null) liveLtpMap[sym] = j.data[key].last_price;
          }
        }
      }
    } catch {}
  }

  // Apply search filter
  let allEnriched = enrich(liquidStocks);
  if (search) {
    allEnriched = allEnriched.filter(s =>
      s.symbol.includes(search) || (s.name || '').toUpperCase().includes(search)
    );
  }
  // Decorate with live LTP if we have it
  for (const s of allEnriched) {
    if (liveLtpMap[s.symbol]) {
      s.live_ltp_rupees = liveLtpMap[s.symbol];
      s.live_change_pct = s.prev_close_rupees > 0
        ? parseFloat(((liveLtpMap[s.symbol] - s.prev_close_rupees) / s.prev_close_rupees * 100).toFixed(2))
        : 0;
    }
  }

  // Build sections
  const watchlistEnriched = enrich(
    liquidStocks.filter(r => watchlist.some(w => w.symbol === r.symbol))
  ).map(s => ({
    ...s,
    thesis: watchlist.find(w => w.symbol === s.symbol)?.thesis,
    live_ltp_rupees: liveLtpMap[s.symbol],
  }));

  const topMovers = [...allEnriched]
    .sort((a, b) => Math.abs((b.live_change_pct ?? b.change_pct)) - Math.abs((a.live_change_pct ?? a.change_pct)))
    .slice(0, 15);

  return {
    watchlist: watchlistEnriched,
    top_movers: topMovers,
    all_liquid: allEnriched.slice(0, 100),
    total: allEnriched.length,
    live_ltp_count: Object.keys(liveLtpMap).length,
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=watchlist_seed — auto-add 10 starter stocks if user empty
//
// New users open the app with 0 watchlist symbols and don't know what to add.
// Seed with 10 high-quality liquid F&O names spanning sectors so they have
// something to track from day one.
// ═══════════════════════════════════════════════════════════════════════════
async function seedStarterWatchlist(db, url) {
  // Only seed if currently empty
  const existing = await db.prepare(`SELECT COUNT(*) AS n FROM user_watchlist WHERE is_active=1`).first();
  if ((existing?.n || 0) > 0) {
    return { ok: false, reason: 'watchlist already has symbols', count: existing.n };
  }
  // 10 hand-picked liquid + diversified large-caps
  const starter = [
    { symbol: 'RELIANCE',   thesis: 'Energy + retail conglomerate. ₹2700 Cr daily liquidity.', category: 'tracking' },
    { symbol: 'HDFCBANK',   thesis: 'Largest private bank. Reads rate cycle.',  category: 'tracking' },
    { symbol: 'TCS',        thesis: 'IT services bellwether. Reads USD/INR.',   category: 'tracking' },
    { symbol: 'INFY',       thesis: 'IT major. Quarter results = catalyst.',    category: 'tracking' },
    { symbol: 'ITC',        thesis: 'FMCG defensive. Low volatility.',          category: 'tracking' },
    { symbol: 'BAJFINANCE', thesis: 'NBFC leader. Rate-cut beneficiary.',       category: 'tracking' },
    { symbol: 'MARUTI',     thesis: 'Auto. Reads consumer demand.',             category: 'tracking' },
    { symbol: 'TATAMOTORS', thesis: 'Auto + JLR. Crude-sensitive.',             category: 'tracking' },
    { symbol: 'SBIN',       thesis: 'Largest PSU bank. Yield-curve sensitive.', category: 'tracking' },
    { symbol: 'BHARTIARTL', thesis: 'Telecom duopoly leader.',                  category: 'tracking' },
  ];
  const now = Date.now();
  for (const s of starter) {
    await db.prepare(`
      INSERT OR IGNORE INTO user_watchlist
        (symbol, exchange, added_at, thesis, category, is_active)
      VALUES (?, 'NSE', ?, ?, ?, 1)
    `).bind(s.symbol, now, s.thesis, s.category).run();
  }
  return { ok: true, seeded: starter.length, symbols: starter.map(s => s.symbol) };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=symbol_search&q=REL — autocomplete for watchlist + manual paper trade
// ═══════════════════════════════════════════════════════════════════════════
async function searchSymbols(db, url) {
  const q = (url.searchParams.get('q') || '').toUpperCase().trim();
  // Fast path: return common 100 symbols if no query (for initial datalist population)
  if (!q || q.length < 1) {
    const top = (await db.prepare(`
      SELECT tradingsymbol AS symbol, name FROM kite_instruments
      WHERE exchange='NSE' AND segment='NSE' AND instrument_type='EQ'
      ORDER BY tradingsymbol LIMIT 200
    `).all()).results || [];
    return { symbols: top.map(r => r.symbol), count: top.length };
  }
  // Prefix + name match
  const r = (await db.prepare(`
    SELECT tradingsymbol AS symbol, name FROM kite_instruments
    WHERE exchange='NSE' AND segment='NSE' AND instrument_type='EQ'
      AND (tradingsymbol LIKE ? OR name LIKE ?)
    ORDER BY
      CASE WHEN tradingsymbol = ? THEN 0
           WHEN tradingsymbol LIKE ? THEN 1
           ELSE 2 END,
      tradingsymbol
    LIMIT 50
  `).bind(`${q}%`, `%${q}%`, q, `${q}%`).all()).results || [];
  return { symbols: r.map(x => x.symbol), names: Object.fromEntries(r.map(x => [x.symbol, x.name])), count: r.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PAPER TRADING
//
// Goes through full system flow without real Kite orders. Every paper trade
// runs through the same scoring, sizing, stop-loss watching logic — so the
// behavioral muscles + Bayesian posteriors build up exactly as they would
// with real money. block_real_orders config gates whether real orders fire.
// ═══════════════════════════════════════════════════════════════════════════
async function getPaperTrades(db, url, env) {
  const onlyOpen = url.searchParams.get('open') === '1';
  // BUG FIX (May 5 2026 evening): use trader_state for classification, not
  // is_active alone. Old logic treated any is_active=0 row as "closed" — but
  // WATCHING rows inserted before tonight's rangeCapture fix had is_active=0
  // and showed up as bogus "closed" rows with ₹0 exit + ₹0 P&L on the UI.
  const where = onlyOpen
    ? `WHERE trader_state IN ('WATCHING','ENTERED','HELD_OVERNIGHT') OR (is_active=1 AND trader_state IS NULL)`
    : '';
  const rows = (await db.prepare(`
    SELECT * FROM paper_trades ${where} ORDER BY entry_at DESC LIMIT 100
  `).all()).results || [];

  // OPEN = actively being managed (WATCHING, ENTERED, HELD_OVERNIGHT)
  // For legacy rows without trader_state, fall back to is_active.
  const open = rows.filter(r =>
    r.trader_state === 'WATCHING' ||
    r.trader_state === 'ENTERED' ||
    r.trader_state === 'HELD_OVERNIGHT' ||
    (r.trader_state == null && r.is_active === 1)
  );
  // CLOSED = lifecycle completed via EXITED, OR has exit_at set
  const closed = rows.filter(r =>
    r.trader_state === 'EXITED' || (r.trader_state == null && r.exit_at != null)
  );
  // SKIPPED/ABANDONED — never completed lifecycle (no real entry, no real exit)
  // Surfaced separately so UI doesn't pollute "closed" count + 0% win rate.
  const skipped = rows.filter(r =>
    r.trader_state === 'SKIPPED' ||
    r.trader_state === 'ABANDONED' ||
    // WATCHING + is_active=0 = stuck rows from before tonight's is_active fix
    (r.trader_state === 'WATCHING' && r.is_active === 0)
  );

  // Live MTM cascade: intraday_ticks (≤5min old) → Kite live LTP → EOD close
  // Bulk-fetch Kite LTP for all open symbols in ONE call to save subrequests
  const openSymbols = [...new Set(open.map(t => t.symbol))];
  const kiteLtpMap = (env && openSymbols.length > 0)
    ? await fetchLiveLtp(db, env, openSymbols).catch(() => ({}))
    : {};

  for (const t of open) {
    let ltp = null;
    let ltpSource = null;
    // Try intraday_ticks first (only if recent — within 5 min)
    const tick = await db.prepare(
      `SELECT ltp_paise, ts FROM intraday_ticks WHERE symbol=? ORDER BY ts DESC LIMIT 1`
    ).bind(t.symbol).first();
    if (tick && Date.now() - tick.ts < 5 * 60000) {
      ltp = tick.ltp_paise;
      ltpSource = 'intraday_ticks';
    }
    // Fall back to Kite live LTP (most accurate during market hours)
    if (ltp == null && kiteLtpMap[t.symbol]) {
      ltp = kiteLtpMap[t.symbol];
      ltpSource = 'kite_live';
    }
    // Fall back to EOD close (off-hours / non-market days)
    if (ltp == null) {
      const eod = await db.prepare(
        `SELECT close_paise FROM equity_eod WHERE symbol=? AND exchange='NSE' ORDER BY trade_date DESC LIMIT 1`
      ).bind(t.symbol).first();
      if (eod) {
        ltp = eod.close_paise;
        ltpSource = 'eod';
      }
    }
    t.live_ltp_paise = ltp;
    t.ltp_source = ltpSource;
    if (ltp != null) {
      const grossMtm = (ltp - t.entry_paise) * t.qty;
      const cost = roundTripCostCnc(t.entry_paise, ltp, t.qty).total_paise;
      t.live_mtm_gross_paise = grossMtm;
      t.live_mtm_net_paise = grossMtm - cost;
      t.live_mtm_pct = parseFloat(((ltp - t.entry_paise) / t.entry_paise * 100).toFixed(2));
      t.distance_to_stop_pct = parseFloat(((ltp - t.stop_paise) / t.entry_paise * 100).toFixed(2));
      t.distance_to_target_pct = parseFloat(((t.target_paise - ltp) / t.entry_paise * 100).toFixed(2));
    }
  }

  const wins = closed.filter(r => r.win_loss === 'win').length;
  const losses = closed.filter(r => r.win_loss === 'loss').length;
  const totalPnl = closed.reduce((s, r) => s + (r.pnl_net_paise || 0), 0);
  const liveMtm = open.reduce((s, r) => s + (r.live_mtm_net_paise || 0), 0);

  return {
    summary: {
      open_count: open.length,
      closed_count: closed.length,
      skipped_count: skipped.length,           // ← NEW: trades that never completed lifecycle
      wins, losses,
      win_rate_pct: closed.length > 0 ? parseFloat((wins / closed.length * 100).toFixed(1)) : null,
      realized_pnl_paise: totalPnl,
      open_mtm_paise: liveMtm,
      total_pnl_paise: totalPnl + liveMtm,
    },
    open_trades: open,
    recent_closed: closed.slice(0, 25),
    recent_skipped: skipped.slice(0, 25),       // ← NEW: separate from closed so UI can show "skipped"
    generated_at: Date.now(),
  };
}

async function openPaperTrade(db, url) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  const tranche = url.searchParams.get('tranche') || 'base';
  const compositeScore = parseFloat(url.searchParams.get('composite_score') || '0');
  const entryRupees = parseFloat(url.searchParams.get('entry') || '0');
  const stopRupees = parseFloat(url.searchParams.get('stop') || '0');
  const targetRupees = parseFloat(url.searchParams.get('target') || '0');
  const qty = parseInt(url.searchParams.get('qty') || '0');
  const rationale = url.searchParams.get('rationale') || '';
  const userThesis = url.searchParams.get('user_thesis') || '';
  const q1 = url.searchParams.get('q1') === '1' ? 1 : 0;
  const q2 = url.searchParams.get('q2') === '1' ? 1 : 0;
  const q3 = url.searchParams.get('q3') === '1' ? 1 : 0;

  if (!symbol || !entryRupees || !stopRupees || !targetRupees || !qty) {
    return { error: 'symbol, entry, stop, target, qty all required' };
  }
  const entryPaise = Math.round(entryRupees * 100);
  const stopPaise = Math.round(stopRupees * 100);
  const targetPaise = Math.round(targetRupees * 100);
  const rrRatio = ((targetPaise - entryPaise) / (entryPaise - stopPaise)).toFixed(2);

  const r = await db.prepare(`
    INSERT INTO paper_trades
      (symbol, tranche, composite_score, entry_paise, stop_paise, target_paise, qty, rr_ratio,
       entry_at, rationale, user_thesis, q1_passed, q2_passed, q3_passed, is_active, created_at)
    VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?,?, 1, ?)
  `).bind(symbol, tranche, compositeScore, entryPaise, stopPaise, targetPaise, qty, rrRatio,
    Date.now(), rationale, userThesis, q1, q2, q3, Date.now()
  ).run();
  return { ok: true, id: r.meta?.last_row_id, symbol, qty, rr: rrRatio };
}

async function closePaperTrade(db, url) {
  const id = parseInt(url.searchParams.get('id'));
  const exitRupees = parseFloat(url.searchParams.get('exit') || '0');
  const exitReason = url.searchParams.get('exit_reason') || 'manual';
  if (!id || !exitRupees) return { error: 'id + exit required' };

  const t = await db.prepare(`SELECT * FROM paper_trades WHERE id=?`).bind(id).first();
  if (!t) return { error: 'trade not found' };

  const exitPaise = Math.round(exitRupees * 100);
  const grossPnl = (exitPaise - t.entry_paise) * t.qty;
  const cost = roundTripCostCnc(t.entry_paise, exitPaise, t.qty).total_paise;
  const netPnl = grossPnl - cost;
  const winLoss = netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'flat';

  await db.prepare(`
    UPDATE paper_trades SET
      exit_at=?, exit_paise=?, exit_reason=?,
      pnl_gross_paise=?, pnl_net_paise=?, cost_paise=?, win_loss=?, is_active=0
    WHERE id=?
  `).bind(Date.now(), exitPaise, exitReason, grossPnl, netPnl, cost, winLoss, id).run();

  // Feed Bayesian
  try {
    const regime = await detectRegime(db);
    await recordObservation(db, {
      tranche: t.tranche,
      score_band: scoreBand(t.composite_score || 70),
      cascade_pattern: null,
      regime: 'paper',  // separate namespace from real trades
      symbol: t.symbol,
      composite_score: t.composite_score,
      entry_paise: t.entry_paise,
      exit_paise: exitPaise,
      pnl_paise: netPnl,
      hold_days: Math.round((Date.now() - t.entry_at) / 86400000),
      exit_reason: exitReason,
    });
  } catch {}

  return { ok: true, pnl_net_paise: netPnl, win_loss: winLoss };
}

// Auto-tick: check open paper trades against latest LTP, close if stop or target hit
async function tickPaperTrades(db, env) {
  const open = (await db.prepare(`SELECT * FROM paper_trades WHERE is_active=1`).all()).results || [];
  if (!open.length) return { checked: 0, closed: 0 };
  const symbols = [...new Set(open.map(t => t.symbol))];
  const ltpMap = await fetchLiveLtp(db, env, symbols);

  let closed = 0;
  for (const t of open) {
    const ltp = ltpMap[t.symbol];
    if (!ltp) continue;
    let exitReason = null;
    let exitPrice = null;
    if (ltp <= t.stop_paise) { exitReason = 'stop_hit'; exitPrice = t.stop_paise; }
    else if (ltp >= t.target_paise) { exitReason = 'target_hit'; exitPrice = t.target_paise; }
    if (!exitReason) continue;

    const grossPnl = (exitPrice - t.entry_paise) * t.qty;
    const cost = roundTripCostCnc(t.entry_paise, exitPrice, t.qty).total_paise;
    const netPnl = grossPnl - cost;
    const winLoss = netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'flat';
    await db.prepare(`
      UPDATE paper_trades SET exit_at=?, exit_paise=?, exit_reason=?,
        pnl_gross_paise=?, pnl_net_paise=?, cost_paise=?, win_loss=?, is_active=0 WHERE id=?
    `).bind(Date.now(), exitPrice, exitReason, grossPnl, netPnl, cost, winLoss, t.id).run();
    closed++;
  }
  return { checked: open.length, closed };
}

// ═══════════════════════════════════════════════════════════════════════════
// READINESS GATE
//
// Aggregates current system + user state into a single "are we ready to
// trade real money?" judgment. Never auto-toggles block_real_orders — user
// must explicitly flip that. But surfaces what's left to verify.
// ═══════════════════════════════════════════════════════════════════════════
async function getReadiness(db) {
  // Compute live data-state numbers
  const eqDates = (await db.prepare(`SELECT COUNT(DISTINCT trade_date) AS n FROM equity_eod`).first())?.n || 0;
  const optionRows = (await db.prepare(`SELECT COUNT(*) AS n FROM option_chain_snapshot`).first())?.n || 0;
  const bulkRows = (await db.prepare(`SELECT COUNT(*) AS n FROM bulk_block_deals`).first())?.n || 0;
  const fiiRows = (await db.prepare(`SELECT COUNT(*) AS n FROM fii_dii_daily`).first())?.n || 0;
  const briefRows = (await db.prepare(`SELECT COUNT(*) AS n FROM daily_briefings`).first())?.n || 0;
  const sigMax = (await db.prepare(`SELECT MAX(composite_score) AS m FROM signal_scores`).first())?.m || 0;

  const cardsToday = (await db.prepare(`
    SELECT COUNT(*) AS n FROM signal_scores
    WHERE composite_score >= 70 AND computed_at > strftime('%s','now')*1000 - 86400000
  `).first())?.n || 0;

  const paper = (await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN win_loss='win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN is_active=0 THEN 1 ELSE 0 END) AS closed
    FROM paper_trades
  `).first()) || {};
  const paperWinRate = paper.closed > 0 ? (paper.wins / paper.closed * 100).toFixed(1) : null;

  const bayesian = (await db.prepare(`
    SELECT COUNT(*) AS buckets, SUM(total_trades) AS samples FROM bayesian_priors
  `).first()) || {};

  // Read user-marked flags
  const userFlags = await db.prepare(`SELECT * FROM readiness_check WHERE id=1`).first() || {};

  // Update derived data state in singleton
  await db.prepare(`
    UPDATE readiness_check SET
      equity_eod_dates=?, option_chain_rows=?, bulk_deals_rows=?,
      fii_dii_rows=?, briefings_rows=?, signal_max_score=?,
      cards_produced_today=?, paper_trades_count=?, paper_win_rate_pct=?,
      bayesian_buckets=?, bayesian_samples=?, last_check_at=?
    WHERE id=1
  `).bind(
    eqDates, optionRows, bulkRows, fiiRows, briefRows, sigMax,
    cardsToday, paper.total || 0, paperWinRate ? parseFloat(paperWinRate) : null,
    bayesian.buckets || 0, bayesian.samples || 0, Date.now()
  ).run();

  // Define gates with explicit thresholds + status
  const gates = [
    { key: 'equity_history',   pass: eqDates >= 200, label: `Equity EOD: ${eqDates} dates`, target: '≥ 200 dates' },
    { key: 'fii_dii_data',     pass: fiiRows >= 5, label: `FII/DII: ${fiiRows} rows`, target: '≥ 5 sessions' },
    { key: 'briefings_active', pass: briefRows >= 1, label: `Briefings: ${briefRows} rows`, target: '≥ 1 compiled' },
    { key: 'engine_producing', pass: sigMax >= 70, label: `Max signal: ${sigMax.toFixed(1)}`, target: '≥ 70.0 (engine produces cards)' },
    { key: 'paper_trades',     pass: (paper.closed || 0) >= 5, label: `Paper trades closed: ${paper.closed || 0}`, target: '≥ 5 closed' },
    { key: 'paper_win_rate',   pass: paperWinRate ? parseFloat(paperWinRate) >= 50 : false, label: `Paper win rate: ${paperWinRate || '—'}%`, target: '≥ 50%' },
    { key: 'capital_set',      pass: !!userFlags.user_set_capital, label: `Capital config set`, target: 'user-toggled' },
    { key: 'kite_funded',      pass: !!userFlags.user_funded_kite, label: `Kite funds available`, target: 'user-toggled' },
    { key: 'risk_acknowledged', pass: !!userFlags.user_acknowledged_risk, label: `Risk acknowledged`, target: 'user explicitly accepts max ₹20K daily loss' },
    { key: '3q_test_understood', pass: !!userFlags.user_understood_3q, label: `3-question test understood`, target: 'user-toggled' },
    { key: 'paper_done',       pass: !!userFlags.user_done_paper, label: `Paper-trading complete`, target: '≥ 10 paper trades' },
  ];

  const passing = gates.filter(g => g.pass).length;
  const overallReady = passing === gates.length;

  await db.prepare(`UPDATE readiness_check SET is_ready=? WHERE id=1`).bind(overallReady ? 1 : 0).run();

  return {
    overall_ready: overallReady,
    passing: `${passing}/${gates.length}`,
    gates,
    flags: userFlags,
    state: {
      equity_eod_dates: eqDates,
      option_chain_rows: optionRows,
      bulk_deals_rows: bulkRows,
      fii_dii_rows: fiiRows,
      briefings_rows: briefRows,
      signal_max_score: sigMax,
      cards_produced_today: cardsToday,
      paper_total: paper.total || 0,
      paper_closed: paper.closed || 0,
      paper_wins: paper.wins || 0,
      paper_win_rate_pct: paperWinRate,
      bayesian_buckets: bayesian.buckets || 0,
      bayesian_samples: bayesian.samples || 0,
    },
    generated_at: Date.now(),
  };
}

async function setReadinessFlag(db, url) {
  const flag = url.searchParams.get('flag');
  const value = url.searchParams.get('value') === '1' ? 1 : 0;
  const allowed = ['user_understood_3q','user_set_capital','user_funded_kite','user_done_paper','user_acknowledged_risk'];
  if (!allowed.includes(flag)) return { error: `flag must be one of ${allowed.join(', ')}` };
  await db.prepare(`UPDATE readiness_check SET ${flag} = ? WHERE id=1`).bind(value).run();
  return { ok: true, flag, value };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=top_recommendation
//
// Returns ONE recommendation card with full narrative + math, designed for
// the "decisive UX" — user reads, verifies via 3-question test, executes.
//
// Picks the highest-composite trade card from execute_view, enriches with:
//   - 1-paragraph narrative explaining WHY this stock right now
//   - Pre-computed entry / stop / target / qty math
//   - Sources cited (news headline, announcement, sector tag)
//   - Alternatives ranked below
//
// Returns null if no card passes filters today (engine = "sit out").
// ═══════════════════════════════════════════════════════════════════════════
async function getTopRecommendation(db, env) {
  // Re-use execute_view for filtering (liquidity, R:R, threshold, capital, positions)
  const exec = await getExecuteView(db, env);
  const cards = (exec.trade_cards || []);
  if (cards.length === 0) {
    return {
      ok: false,
      reason: 'no_qualifying_cards',
      message: 'No engine cards pass adaptive R:R + liquidity today. Engine recommends: sit out or use manual paper-trade on a watchlist stock you have a thesis on.',
      max_score: exec.engine_state?.signal_max || 0,
      threshold: exec.config?.min_signal_score || 60,
      generated_at: Date.now(),
    };
  }

  const top = cards[0];
  const sym = top.symbol;

  // Enrich with narrative pieces — done in parallel
  const [news, ann, bulkDeal, sectorClass, sectorRot] = await Promise.all([
    db.prepare(`
      SELECT headline, source, published_at, sentiment_score
      FROM news_items WHERE symbols_tagged LIKE ?
        AND published_at > strftime('%s','now')*1000 - 7*86400000
      ORDER BY published_at DESC LIMIT 1
    `).bind(`%${sym}%`).first(),
    db.prepare(`
      SELECT subject, ann_time, materiality_score, category
      FROM corp_announcements WHERE symbol=?
        AND ann_time > strftime('%s','now')*1000 - 14*86400000
      ORDER BY ann_time DESC LIMIT 1
    `).bind(sym).first(),
    db.prepare(`
      SELECT client_name, txn_type, qty, price_paise, trade_date
      FROM bulk_block_deals WHERE symbol=?
        AND trade_date >= date('now', '-3 days')
      ORDER BY trade_date DESC LIMIT 1
    `).bind(sym).first(),
    db.prepare(`SELECT name FROM kite_instruments WHERE tradingsymbol=? AND exchange='NSE' AND instrument_type='EQ' LIMIT 1`).bind(sym).first(),
    safeCall(() => getSectorRotation(db, new URL('http://x/?periodDays=20'))),
  ]);

  // Build narrative paragraphs — each only included if data exists
  const narrativeBits = [];

  // Sub-score commentary
  const subScores = top.sub_scores || {};
  const strongDims = Object.entries(subScores)
    .filter(([k, v]) => v >= 70)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v)}`);
  if (strongDims.length > 0) {
    narrativeBits.push(`Engine sees strong ${strongDims.join(', ')} — composite ${top.composite_score.toFixed(1)} of 100.`);
  }

  // News
  if (news?.headline) {
    const tone = (news.sentiment_score || 0) > 0.2 ? 'positive' : (news.sentiment_score || 0) < -0.2 ? 'negative' : 'neutral';
    narrativeBits.push(`📰 News: "${news.headline.slice(0, 110)}${news.headline.length > 110 ? '…' : ''}" (${news.source}, ${tone} tone)`);
  }

  // Corp announcement
  if (ann?.subject) {
    narrativeBits.push(`📋 Filing: "${ann.subject.slice(0, 110)}${ann.subject.length > 110 ? '…' : ''}" (${ann.category || 'corporate'}, materiality ${Math.round((ann.materiality_score || 0) * 100)}%)`);
  }

  // Bulk deal
  if (bulkDeal) {
    narrativeBits.push(`💼 Block deal ${bulkDeal.trade_date}: ${bulkDeal.client_name?.slice(0, 50) || 'institutional'} ${bulkDeal.txn_type} ${bulkDeal.qty?.toLocaleString('en-IN')} @ ₹${(bulkDeal.price_paise / 100).toFixed(2)}`);
  }

  // Sector context
  if (sectorRot && sectorRot.sectors_ranked) {
    const lead = sectorRot.sectors_ranked[0];
    if (lead) {
      narrativeBits.push(`📊 ${lead.sector.replace('NIFTY ', '')} leading sector +${lead.relative_strength_pct}% vs Nifty (20d).`);
    }
  }

  // Cascade match
  if (top.cascade_match) {
    narrativeBits.push(`⚡ Cascade pattern firing — historical hit-rate sourced from backtests.`);
  }

  // Build "what to do" plan
  const fmtP = (p) => '₹' + (p / 100).toFixed(2);
  const fmtR = (p) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
  const plan = {
    symbol: sym,
    company: sectorClass?.name || sym,
    composite_score: top.composite_score,
    tranche: top.tranche,
    entry_price: top.entry_paise / 100,
    stop_price: top.stop_paise / 100,
    target_price: top.target_paise / 100,
    qty: top.qty,
    capital_deployed: top.capital_deployed_paise / 100,
    max_loss_rupees: top.max_loss_paise / 100,
    max_gain_rupees: top.max_gain_paise / 100,
    rr_ratio: top.rr_ratio,
    stop_pct: top.stop_pct,
    target_pct: top.target_pct,
    cost_loss: top.cost_loss_paise / 100,
    cost_win: top.cost_win_paise / 100,
    net_loss_rupees: top.net_loss_paise / 100,
    net_gain_rupees: top.net_gain_paise / 100,
  };

  // Verdict — 1-line "what should I think"
  const verdict = top.composite_score >= 75
    ? `High-conviction setup — engine is confident. Verify the WHY below holds for you, do the 3-question test, then paper-trade.`
    : top.composite_score >= 65
    ? `Decent setup — verify WHY below, do the 3-question test. Lean smaller size if anything feels off.`
    : `Marginal setup — engine is in early-mode (data still maturing). Only paper-trade if WHY makes intuitive sense to you.`;

  // Headline — what to actually do
  const action_headline = `Paper-trade ${sym}: BUY ${plan.qty} qty at market ${fmtP(top.entry_paise)} · Stop ${fmtP(top.stop_paise)} · Target ${fmtP(top.target_paise)} · Risk ${fmtR(top.max_loss_paise)}`;

  // ─── LLM-generated decision narrative (Feature 2) ───
  // Uses Haiku to weave the 5 narrative_bits into a 2-paragraph "why" that's
  // tailored to a beginner trader. Cached by symbol+date so cost is bounded
  // (~10 calls/day × $0.001 each = ~₹3/day).
  let llm_narrative = null;
  let llm_narrative_error = null;
  try {
    if (env?.ANTHROPIC_API_KEY) {
      const dateKey = new Date().toISOString().slice(0, 10);
      const system = `You are a senior Indian equity trader explaining a paper-trade idea to a beginner who is learning the discipline. You write in clear, plain English (no jargon without explanation). 2 short paragraphs:
1. THE THESIS — why this stock now (use the data points provided)
2. WHAT TO WATCH — what would prove the thesis right or wrong over the next few days
Total: ≤ 110 words. No fluff, no buzzwords. Honest about uncertainty.`;
      const userPrompt = `Stock: ${sym}${sectorClass?.name ? ` (${sectorClass.name})` : ''}
Composite score: ${top.composite_score.toFixed(1)} / 100 (engine threshold: ${exec.config?.min_signal_score || 60})
Tranche: ${top.tranche}
Entry: ₹${(top.entry_paise/100).toFixed(2)} · Stop: ₹${(top.stop_paise/100).toFixed(2)} (-${top.stop_pct}%) · Target: ₹${(top.target_paise/100).toFixed(2)} (+${top.target_pct?.toFixed(1)}%)
R:R: ${top.rr_ratio}:1 · Quantity: ${top.qty} · Capital: ₹${Math.round(top.capital_deployed_paise/100)}

Engine sub-scores (0-100):
${Object.entries(top.sub_scores || {}).map(([k, v]) => `  ${k}: ${Math.round(v)}`).join('\n')}

Supporting data:
${narrativeBits.length > 0 ? narrativeBits.map(b => '- ' + b).join('\n') : '- (no specific news/announcement/deal — score is from technicals + macro)'}
${top.cascade_match ? '- ⚡ Cascade pattern firing — historical setup with edge' : ''}

Write the 2-paragraph thesis + what-to-watch.`;
      const llm = await callHaiku(env, {
        prompt: userPrompt,
        system,
        max_tokens: 220,
        purpose: 'narrative',
        worker: 'pages-trading',
        cache_key: `narrative_${sym}_${dateKey}`,
        cache_ttl_ms: 6 * 3600000, // 6 hr — fresh enough for intraday changes
      });
      llm_narrative = llm.text;
    }
  } catch (e) {
    llm_narrative_error = e.message?.slice(0, 200);
  }

  return {
    ok: true,
    action_headline,
    verdict,
    narrative: narrativeBits.join(' '),
    narrative_bits: narrativeBits,
    llm_narrative,                       // 2-paragraph plain-English thesis
    llm_narrative_error,                 // null on success
    plan,
    full_card: top,
    alternatives: cards.slice(1, 6).map(c => ({
      symbol: c.symbol,
      composite_score: c.composite_score,
      tranche: c.tranche,
      rationale: c.rationale,
    })),
    total_cards: cards.length,
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=engine_state
//
// Real-time visibility into how the engine is making decisions today.
// Joins regime + MTF coverage + per-dim health + cascade activity into one
// payload so Today UI can render an "Engine State" transparency panel.
//
// User can question every layer: "why is regime high_vol?" / "why are 30%
// of stocks vetoed?" / "why is options dim still at 50?"
// ═══════════════════════════════════════════════════════════════════════════
async function getEngineState(db, env) {
  // Latest signal compute
  const latestSig = await db.prepare(
    `SELECT MAX(computed_at) AS m FROM signal_scores`
  ).first();
  if (!latestSig?.m) return { ok: false, reason: 'no-signals-computed-yet' };

  // 1. Regime (from latest scoring run)
  const regimeRow = await db.prepare(
    `SELECT regime, COUNT(*) AS n FROM signal_scores
     WHERE computed_at = ? GROUP BY regime ORDER BY n DESC LIMIT 1`
  ).bind(latestSig.m).first();
  const currentRegime = regimeRow?.regime || 'unknown';

  // Regime evidence (Nifty 20d/50d + VIX)
  const niftyRows = (await db.prepare(`
    SELECT trade_date, close_paise FROM indices_eod WHERE index_name='NIFTY 50'
    ORDER BY trade_date DESC LIMIT 51
  `).all()).results || [];
  const vixRow = await db.prepare(
    `SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`
  ).first();
  const niftyLatest = niftyRows[0]?.close_paise;
  const nifty20d = niftyRows[Math.min(20, niftyRows.length - 1)]?.close_paise;
  const nifty50d = niftyRows[Math.min(50, niftyRows.length - 1)]?.close_paise;
  const nifty20Pct = (niftyLatest && nifty20d) ? ((niftyLatest - nifty20d) / nifty20d * 100) : null;
  const nifty50Pct = (niftyLatest && nifty50d) ? ((niftyLatest - nifty50d) / nifty50d * 100) : null;

  // 2. MTF alignment distribution
  const mtfDist = (await db.prepare(`
    SELECT mtf_alignment, COUNT(*) AS n FROM signal_scores
    WHERE computed_at = ? GROUP BY mtf_alignment ORDER BY n DESC
  `).bind(latestSig.m).all()).results || [];

  // 3. Per-dim health — what % of stocks have non-default (≠ 50) score per dim
  const dimHealth = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ABS(trend_score - 50) > 1 THEN 1 ELSE 0 END) AS trend_active,
      SUM(CASE WHEN ABS(flow_score - 50) > 1 THEN 1 ELSE 0 END) AS flow_active,
      SUM(CASE WHEN ABS(options_score - 50) > 1 THEN 1 ELSE 0 END) AS options_active,
      SUM(CASE WHEN ABS(catalyst_score - 50) > 1 THEN 1 ELSE 0 END) AS catalyst_active,
      SUM(CASE WHEN ABS(macro_score - 50) > 1 THEN 1 ELSE 0 END) AS macro_active,
      SUM(CASE WHEN ABS(sentiment_score - 50) > 1 THEN 1 ELSE 0 END) AS sentiment_active,
      SUM(CASE WHEN ABS(breadth_score - 50) > 1 THEN 1 ELSE 0 END) AS breadth_active,
      SUM(CASE WHEN ABS(retail_buzz_score - 50) > 1 THEN 1 ELSE 0 END) AS retail_buzz_active,
      SUM(CASE WHEN ABS(quality_score - 50) > 1 THEN 1 ELSE 0 END) AS quality_active
    FROM signal_scores WHERE computed_at = ?
  `).bind(latestSig.m).first();

  const total = dimHealth?.total || 1;
  const dims = ['trend','flow','options','catalyst','macro','sentiment','breadth','retail_buzz','quality'];
  const dimCoverage = dims.map(d => ({
    dim: d,
    coverage_pct: parseFloat((((dimHealth?.[`${d}_active`] || 0) / total) * 100).toFixed(1)),
    active: dimHealth?.[`${d}_active`] || 0,
    total,
  }));

  // 4. Cascade activity
  const cascades = (await db.prepare(`
    SELECT pattern_name, COUNT(*) AS n FROM cascade_triggers_active
    WHERE status='active' AND expected_window_end > ? GROUP BY pattern_name
  `).bind(Date.now()).all()).results || [];

  // 5. Top score band distribution
  const scoreBands = (await db.prepare(`
    SELECT
      CASE WHEN composite_score >= 90 THEN '90+'
           WHEN composite_score >= 80 THEN '80-90'
           WHEN composite_score >= 70 THEN '70-80'
           WHEN composite_score >= 60 THEN '60-70'
           ELSE '<60' END AS band,
      COUNT(*) AS n
    FROM signal_scores WHERE computed_at = ? GROUP BY band ORDER BY band DESC
  `).bind(latestSig.m).all()).results || [];

  const maxScore = (await db.prepare(
    `SELECT MAX(composite_score) AS m FROM signal_scores WHERE computed_at = ?`
  ).bind(latestSig.m).first())?.m || 0;

  // Threshold from config
  const thresholdRow = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='max_signal_threshold' LIMIT 1`
  ).first();
  const threshold = parseInt(thresholdRow?.config_value || '70');

  // Plain-English regime explainer
  const regimeExplainers = {
    high_vol:           { tone: 'cautious', desc: 'India VIX > 18 — chaos zone. Macro + flow weighted higher; trade smaller; expect noise; defensives outperform.' },
    strong_trending_up: { tone: 'aggressive', desc: 'Strong uptrend. Trend-following weighted higher; let winners run; tight stops below recent low.' },
    strong_trending_down:{ tone: 'sit_out',   desc: 'Strong downtrend. No long entries today (system blocks all cards).' },
    ranging:            { tone: 'fade',       desc: 'Range-bound market. Mean-reversion plays; flow + catalyst weighted higher.' },
    transitioning:      { tone: 'neutral',    desc: 'No clear regime. Default weights applied; standard discipline.' },
    unknown:            { tone: 'unknown',    desc: 'Insufficient data to detect regime — using transitioning weights as fallback.' },
  };

  return {
    ok: true,
    computed_at: latestSig.m,
    regime: {
      current: currentRegime,
      explainer: regimeExplainers[currentRegime] || regimeExplainers.unknown,
      evidence: {
        nifty_20d_pct: nifty20Pct?.toFixed(2),
        nifty_50d_pct: nifty50Pct?.toFixed(2),
        india_vix: vixRow?.vix,
      },
    },
    mtf_alignment: {
      total_universe: mtfDist.reduce((s, r) => s + (r.n || 0), 0),
      distribution: mtfDist,
      vetoed_pct: parseFloat((mtfDist.filter(r => r.mtf_alignment === 'against_macro' || r.mtf_alignment === 'aligned_down').reduce((s, r) => s + (r.n || 0), 0) / Math.max(1, mtfDist.reduce((s, r) => s + (r.n || 0), 0)) * 100).toFixed(1)),
    },
    dim_health: dimCoverage.sort((a, b) => b.coverage_pct - a.coverage_pct),
    cascades_active: cascades,
    score_distribution: scoreBands,
    max_score_today: parseFloat((maxScore || 0).toFixed(2)),
    threshold,
    cards_today: (scoreBands.find(b => b.band === '70-80')?.n || 0) +
                 (scoreBands.find(b => b.band === '80-90')?.n || 0) +
                 (scoreBands.find(b => b.band === '90+')?.n || 0) +
                 (threshold < 70 ? (scoreBands.find(b => b.band === '60-70')?.n || 0) : 0),
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=briefing_v2
//
// Pre-market briefing v2 — uses ALL new data sources and Claude Haiku to
// compose a plain-English narrative. Replaces the old template-based briefing
// when the user wants the richest version. Cached 1hr by date.
// ═══════════════════════════════════════════════════════════════════════════
async function getBriefingV2(db, env) {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Pull all the supporting data in parallel
  const [fii, indices, sectorRot, bondDir, recentConcalls, topAnnouncements, regime] = await Promise.all([
    db.prepare(`SELECT * FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 5`).all(),
    db.prepare(`
      SELECT i1.* FROM indices_eod i1
      JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
        ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
      WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX','NIFTY MIDCAP 100')
    `).all(),
    safeCall(() => getSectorRotation(db, new URL('http://x/?periodDays=20'))),
    safeCall(() => getBondDirection(db)),
    db.prepare(`
      SELECT symbol, fiscal_period, tone_score, raw_summary
      FROM concall_analysis WHERE analyzed_at > strftime('%s','now')*1000 - 7*86400000
      ORDER BY analyzed_at DESC LIMIT 5
    `).all(),
    db.prepare(`
      SELECT symbol, subject, materiality_score, sentiment_score
      FROM corp_announcements
      WHERE ann_time > strftime('%s','now')*1000 - 2*86400000
        AND materiality_score > 0.7
      ORDER BY materiality_score DESC, ann_time DESC LIMIT 5
    `).all(),
    safeCall(() => getEngineState(db, env)),
  ]);

  // 2. Build context for LLM compose
  const fiiList = (fii.results || []).slice(0, 3);
  const fiiYesterday = fiiList[0];
  const indicesByName = {};
  for (const i of (indices.results || [])) indicesByName[i.index_name] = i;
  const nifty = indicesByName['NIFTY 50'];
  const vix = indicesByName['INDIA VIX'];
  const niftyBank = indicesByName['NIFTY BANK'];

  const sectorLeaders = sectorRot?.sectors_ranked?.slice(0, 3) || [];
  const sectorLaggards = sectorRot?.sectors_ranked?.slice(-3).reverse() || [];

  const supportingFacts = [
    fiiYesterday ? `FII flow yesterday: ₹${Math.round(fiiYesterday.fii_net_cr)} Cr (${fiiYesterday.fii_net_cr > 0 ? 'buying' : 'selling'}). DII: ₹${Math.round(fiiYesterday.dii_net_cr)} Cr.` : null,
    nifty ? `Nifty 50 close: ${(nifty.close_paise / 100).toFixed(0)}.` : null,
    vix ? `India VIX: ${(vix.close_paise / 100).toFixed(2)} — ${(vix.close_paise / 100) > 18 ? 'elevated (caution)' : (vix.close_paise / 100) < 13 ? 'calm (complacency)' : 'normal'}.` : null,
    sectorLeaders.length > 0 ? `Sector leaders (20d): ${sectorLeaders.map(s => `${s.sector.replace('NIFTY ', '')} +${s.relative_strength_pct}%`).join(', ')}.` : null,
    sectorLaggards.length > 0 ? `Sector laggards: ${sectorLaggards.map(s => `${s.sector.replace('NIFTY ', '')} ${s.relative_strength_pct}%`).join(', ')}.` : null,
    bondDir?.summary ? `Rate cycle: ${bondDir.summary}` : null,
    regime?.regime?.current ? `Engine regime today: ${regime.regime.current} — ${regime.regime.explainer?.desc}` : null,
    (recentConcalls.results || []).length > 0 ? `Recent concall tone: ${recentConcalls.results.map(c => `${c.symbol} ${(c.tone_score || 0).toFixed(2)}`).join(', ')}` : null,
    (topAnnouncements.results || []).length > 0 ? `Material filings: ${topAnnouncements.results.slice(0, 3).map(a => `${a.symbol} (${a.subject?.slice(0, 50)})`).join('; ')}` : null,
  ].filter(Boolean);

  // 3. LLM compose (cached 6 hours, costs ~₹0.08)
  let llm_narrative = null;
  let llm_error = null;
  try {
    if (env?.ANTHROPIC_API_KEY) {
      const system = `You are a senior Indian equity strategist writing a pre-market briefing for a beginner trader. Plain English, 3 short paragraphs, no jargon without inline explanation. ≤140 words total.

Structure:
1. THE STORY — what's happening across markets right now (FII + VIX + sectors)
2. WHAT MATTERS TODAY — top 1-2 things to watch (filings, concalls, macro)
3. POSITIONING — what regime calls for (offense / defense / sit out)

Be honest about uncertainty. Don't fluff. No buzzwords.`;
      const userPrompt = `Date: ${today}

Supporting facts:
${supportingFacts.map(f => '- ' + f).join('\n')}

Write the briefing.`;
      const llm = await callHaiku(env, {
        prompt: userPrompt,
        system,
        max_tokens: 280,
        purpose: 'briefing',
        worker: 'pages-trading',
        cache_key: `briefing_${today}`,
        cache_ttl_ms: 6 * 3600000,
      });
      llm_narrative = llm.text;
    }
  } catch (e) {
    llm_error = e.message?.slice(0, 200);
  }

  return {
    ok: true,
    date: today,
    llm_narrative,
    llm_error,
    supporting_facts: supportingFacts,
    raw: {
      fii: fiiList,
      indices: indices.results || [],
      sector_rotation: sectorRot,
      bond_direction: bondDir,
      recent_concalls: recentConcalls.results || [],
      top_announcements: topAnnouncements.results || [],
      regime: regime?.regime,
    },
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=analyze_concall (POST)
//
// Pages-side concall analyzer. Takes { symbol, transcript, fiscal_period,
// transcript_url } in JSON body, runs Claude Haiku, persists to concall_analysis.
// Mirrors the wealth-corp-intel worker's analyzeConcall but lives in Pages so
// the Today UI can call it without inter-worker auth juggling.
// ═══════════════════════════════════════════════════════════════════════════
async function analyzeConcallPages(db, env, request) {
  if (request.method !== 'POST') return { ok: false, error: 'POST required' };
  let body;
  try { body = await request.json(); }
  catch { return { ok: false, error: 'invalid JSON body' }; }

  const { symbol, transcript, fiscal_period = 'unknown', transcript_url = null } = body;
  if (!symbol || !transcript) return { ok: false, error: 'symbol + transcript required' };
  if (typeof transcript !== 'string' || transcript.length < 200) {
    return { ok: false, error: 'transcript too short (≥200 chars)' };
  }
  if (!env?.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured on Pages' };

  const truncated = transcript.slice(0, 20000);
  const symUp = symbol.toUpperCase().trim();

  const system = `You are a senior Indian equity analyst extracting management tone from quarterly earnings call transcripts. Output ONLY a JSON object — no prose.`;
  const userPrompt = `Symbol: ${symUp}
Period: ${fiscal_period}

Transcript (truncated to first 20K chars):
${truncated}

---
Extract and output JSON in EXACTLY this shape:

{
  "tone_score": -1.0 to 1.0,
  "revenue_outlook": "1-2 sentence summary of management's revenue guidance/commentary",
  "margin_commentary": "1-2 sentence summary of margin trends + outlook",
  "capex_plans": "1-2 sentence summary of capex/investment plans",
  "cautionary_notes": "1-2 sentence summary of any risks/concerns management flagged",
  "raw_summary": "3-line big-picture summary"
}

tone_score: -1.0 = very defensive/negative, 0.0 = neutral/factual, +1.0 = very confident/upbeat. Be conservative — most calls are 0 to +0.3 unless management is explicitly bullish or worried.`;

  let result;
  try {
    result = await callHaiku(env, {
      prompt: userPrompt,
      system,
      max_tokens: 600,
      purpose: 'concall_analysis',
      worker: 'pages-trading',
      cache_key: `concall_${symUp}_${fiscal_period}_${transcript.length}`,
      cache_ttl_ms: 90 * 86400000,
    });
  } catch (e) {
    return { ok: false, error: 'LLM call failed: ' + (e.message || String(e)).slice(0, 200) };
  }

  // Parse JSON output — may be wrapped in code fences
  let parsed = null;
  try {
    let txt = (result.text || '').trim();
    const fenced = txt.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenced) txt = fenced[1];
    parsed = JSON.parse(txt);
  } catch {
    return { ok: false, error: 'LLM returned non-JSON', raw: (result.text || '').slice(0, 300) };
  }

  // Persist
  try {
    await db.prepare(`
      INSERT INTO concall_analysis
        (symbol, fiscal_period, transcript_url, analyzed_at,
         tone_score, revenue_outlook, margin_commentary, capex_plans, cautionary_notes, raw_summary, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      symUp, fiscal_period, transcript_url, Date.now(),
      parsed.tone_score || 0,
      (parsed.revenue_outlook || '').slice(0, 500),
      (parsed.margin_commentary || '').slice(0, 500),
      (parsed.capex_plans || '').slice(0, 500),
      (parsed.cautionary_notes || '').slice(0, 500),
      (parsed.raw_summary || '').slice(0, 1000),
      'pages_today_ui'
    ).run();
  } catch (e) {
    return { ok: false, error: 'D1 insert failed: ' + (e.message || String(e)).slice(0, 200), summary: parsed };
  }

  return {
    ok: true,
    symbol: symUp,
    fiscal_period,
    tone_score: parsed.tone_score,
    cost_paise: result.cost_paise,
    cached: result.cached,
    summary: parsed,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=verdict_today
//
// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=todays_watchlist[&date=YYYY-MM-DD]
//
// Owner asked May 5: "different stock lists in /today vs /execute is confusing.
// Can we have ONE canonical list — the candidate pool Opus shortlisted at 08:30,
// the 3 final picks marked, with live LTP, refreshed?"
//
// Returns: the FROZEN candidate pool (top ~10 from intraday_suitable_picks the
// engine pre-filtered for Opus) + the 3 final picks marked, + live LTP joined
// from intraday_ticks, + Kite-format string for clipboard import.
//
// Source of truth:
//   daily_verdicts.context_snapshot_json.intraday_suitable_picks  (the pool)
//   daily_verdicts.picks_json                                     (the 3 picks)
//
// Both frozen at 08:30 IST when Opus composes. Doesn't drift through the day.
// ═══════════════════════════════════════════════════════════════════════════
async function getTodaysWatchlist(db, url) {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const requestedDate = url.searchParams.get('date') || istNow.toISOString().slice(0, 10);

  const verdict = await db.prepare(`
    SELECT id, trade_date, verdict_type, composed_at, context_snapshot_json, picks_json
    FROM daily_verdicts
    WHERE trade_date = ? AND verdict_type='morning'
    ORDER BY composed_at DESC LIMIT 1
  `).bind(requestedDate).first();

  if (!verdict) {
    return { ok: false, reason: 'no-verdict-on-date', date: requestedDate };
  }

  let candidates = [];
  let finalPicks = [];
  try {
    const ctx = JSON.parse(verdict.context_snapshot_json || '{}');
    candidates = ctx.intraday_suitable_picks || [];
  } catch {}
  try {
    finalPicks = JSON.parse(verdict.picks_json || '[]');
  } catch {}

  const finalPickSymbols = new Set(finalPicks.map(p => p.symbol).filter(Boolean));
  const allSymbols = [...new Set([
    ...candidates.map(c => c.symbol).filter(Boolean),
    ...finalPickSymbols,
  ])];

  if (allSymbols.length === 0) {
    return { ok: false, reason: 'no-symbols', date: requestedDate };
  }

  // Live LTP — most recent intraday_ticks per symbol (already populated by
  // wealth-price-core every 1 min during market hours)
  const placeholders = allSymbols.map(() => '?').join(',');
  const liveTicks = (await db.prepare(`
    SELECT t1.symbol, t1.ltp_paise, t1.ts
    FROM intraday_ticks t1
    JOIN (SELECT symbol, MAX(ts) AS m FROM intraday_ticks WHERE symbol IN (${placeholders}) GROUP BY symbol) t2
      ON t1.symbol = t2.symbol AND t1.ts = t2.m
  `).bind(...allSymbols).all().catch(() => ({ results: [] }))).results || [];
  const ltpMap = {};
  for (const t of liveTicks) ltpMap[t.symbol] = { ltp_paise: t.ltp_paise, ts: t.ts };

  // Full day OHLC aggregated from intraday 5-min bars: open (first bar's open),
  // high (max), low (min), close (last bar's close).
  const dayOhlcRows = (await db.prepare(`
    SELECT
      b.symbol,
      MIN(CASE WHEN ts = (SELECT MIN(ts) FROM intraday_bars b2 WHERE b2.symbol=b.symbol AND b2.trade_date=? AND b2.interval='5minute') THEN open_paise END) AS day_open,
      MAX(b.high_paise) AS day_high,
      MIN(b.low_paise)  AS day_low,
      MAX(CASE WHEN ts = (SELECT MAX(ts) FROM intraday_bars b3 WHERE b3.symbol=b.symbol AND b3.trade_date=? AND b3.interval='5minute') THEN close_paise END) AS day_close,
      SUM(b.volume) AS day_volume,
      COUNT(*) AS bars_count
    FROM intraday_bars b
    WHERE b.symbol IN (${placeholders}) AND b.trade_date=? AND b.interval='5minute'
    GROUP BY b.symbol
  `).bind(requestedDate, requestedDate, ...allSymbols, requestedDate).all().catch(() => ({ results: [] }))).results || [];
  const ohlcMap = {};
  for (const r of dayOhlcRows) ohlcMap[r.symbol] = r;

  // Yesterday's close (for gap-from-prev-close context)
  const prevCloseRows = (await db.prepare(`
    SELECT symbol, close_paise FROM equity_eod
    WHERE symbol IN (${placeholders})
      AND trade_date = (SELECT MAX(trade_date) FROM equity_eod WHERE trade_date < ?)
  `).bind(...allSymbols, requestedDate).all().catch(() => ({ results: [] }))).results || [];
  const prevCloseMap = {};
  for (const r of prevCloseRows) prevCloseMap[r.symbol] = r.close_paise;

  // Trader state per symbol (for the 3 final picks)
  const traderRows = (await db.prepare(`
    SELECT symbol, trader_state, qty, entry_paise, exit_paise, exit_reason, pnl_net_paise
    FROM paper_trades
    WHERE auto_managed=1 AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(requestedDate).all().catch(() => ({ results: [] }))).results || [];
  const traderMap = {};
  for (const r of traderRows) traderMap[r.symbol] = r;

  // Helper: realistic Zerodha intraday MIS round-trip cost (matches simulator)
  const zerodhaCost = (entryPaise, exitPaise, qty) => {
    const buyTo = Math.abs(entryPaise) * qty;
    const sellTo = Math.abs(exitPaise) * qty;
    const brokerage = 4000;
    const stt = sellTo * 0.00025;
    const exch = (buyTo + sellTo) * 0.0000322;
    const stamp = buyTo * 0.00003;
    const gst = (brokerage + exch) * 0.18;
    return Math.round(brokerage + stt + exch + stamp + gst);
  };

  // ★ Build watchlist rows with FULL OHLC + ₹10L hypothetical scenarios.
  // Owner asked May 5 evening: "show start, peak, close, and scenario if 10L
  // was invested in that stock — for ALL top picks not just final 3."
  const TEN_LAKH_PAISE = 100000000;  // ₹10,00,000
  const enriched = candidates.map(c => {
    const live = ltpMap[c.symbol];
    const ohlc = ohlcMap[c.symbol];
    const prevClose = prevCloseMap[c.symbol];
    const dayOpen   = ohlc?.day_open  || null;
    const dayHigh   = ohlc?.day_high  || null;
    const dayLow    = ohlc?.day_low   || null;
    const dayClose  = ohlc?.day_close || null;
    const dayVolume = ohlc?.day_volume || null;
    const currentPaise = live?.ltp_paise || dayClose || null;
    const dayChangePct = (currentPaise && dayOpen)
      ? +(((currentPaise - dayOpen) / dayOpen) * 100).toFixed(2)
      : null;
    const gapFromPrevClosePct = (dayOpen && prevClose)
      ? +(((dayOpen - prevClose) / prevClose) * 100).toFixed(2)
      : null;

    // ─── ₹10L HYPOTHETICAL ───
    // Assume ₹10L deployed entirely on this single stock at day open. Compute:
    //   qty = floor(₹10L ÷ open)
    //   peak_pnl  = (high - open) × qty - cost   (best-case if exited at peak)
    //   close_pnl = (close - open) × qty - cost  (passive hold to close)
    //   live_pnl  = (now  - open) × qty - cost   (current MTM if still held)
    //   max_dd    = (low  - open) × qty - cost   (worst intraday drawdown)
    let if10L = null;
    if (dayOpen && dayOpen > 100) {
      const qty = Math.floor(TEN_LAKH_PAISE / dayOpen);
      const deployed = qty * dayOpen;
      const peakPnL = dayHigh ? (dayHigh - dayOpen) * qty - zerodhaCost(dayOpen, dayHigh, qty) : null;
      const closePnL = dayClose ? (dayClose - dayOpen) * qty - zerodhaCost(dayOpen, dayClose, qty) : null;
      const livePnL = currentPaise ? (currentPaise - dayOpen) * qty - zerodhaCost(dayOpen, currentPaise, qty) : null;
      const maxDD = dayLow ? (dayLow - dayOpen) * qty - zerodhaCost(dayOpen, dayLow, qty) : null;
      if10L = {
        qty,
        deployed_paise: deployed,
        if_exited_at_peak_paise: peakPnL,
        if_exited_at_peak_pct: dayHigh ? +(((dayHigh - dayOpen) / dayOpen) * 100).toFixed(2) : null,
        if_held_to_close_paise: closePnL,
        if_held_to_close_pct: dayClose ? +(((dayClose - dayOpen) / dayOpen) * 100).toFixed(2) : null,
        if_held_live_paise: livePnL,
        max_intraday_drawdown_paise: maxDD,
      };
    }

    const finalPick = finalPicks.find(p => p.symbol === c.symbol);
    const trader = traderMap[c.symbol];
    return {
      symbol: c.symbol,
      composite_score: c.composite_score,
      hybrid_score: c.hybrid_score,
      regime: c.regime,
      mtf: c.mtf,
      intraday_history: c.intraday_history,
      // FULL DAY OHLC
      day_open_paise: dayOpen,
      day_high_paise: dayHigh,
      day_low_paise: dayLow,
      day_close_paise: dayClose,
      day_volume: dayVolume,
      prev_close_paise: prevClose || null,
      gap_from_prev_close_pct: gapFromPrevClosePct,
      // LIVE
      live_ltp_paise: live?.ltp_paise || null,
      live_ltp_ts: live?.ts || null,
      day_change_pct: dayChangePct,
      // ★ HYPOTHETICAL ₹10L SCENARIO
      if_10L_invested: if10L,
      // PICK / TRADER STATE
      is_final_pick: !!finalPick,
      pick_weight_pct: finalPick?.weight_pct || null,
      pick_target_pct: finalPick?.target_pct || null,
      pick_stop_pct: finalPick?.stop_pct || null,
      pick_rationale: finalPick?.rationale || null,
      trader_state: trader?.trader_state || null,
      trader_qty: trader?.qty || null,
      trader_entry_paise: trader?.entry_paise || null,
      trader_exit_paise: trader?.exit_paise || null,
      trader_exit_reason: trader?.exit_reason || null,
      trader_pnl_net_paise: trader?.pnl_net_paise || null,
    };
  });

  // Sort: final picks first (⭐), then by hybrid_score DESC
  enriched.sort((a, b) => {
    if (a.is_final_pick && !b.is_final_pick) return -1;
    if (!a.is_final_pick && b.is_final_pick) return 1;
    return (b.hybrid_score || 0) - (a.hybrid_score || 0);
  });

  // Kite-format string for clipboard (manual paste into Kite app watchlist)
  const kiteFormat = enriched.map(e => `NSE:${e.symbol}`).join('\n');

  return {
    ok: true,
    date: requestedDate,
    composed_at: verdict.composed_at,
    composed_at_ist: new Date(verdict.composed_at + 5.5 * 3600000).toISOString().replace('T',' ').slice(0, 19),
    summary: {
      candidate_count: candidates.length,
      final_pick_count: finalPicks.length,
      live_data_available: Object.keys(ltpMap).length > 0,
    },
    watchlist: enriched,
    kite_format: kiteFormat,           // for "Copy to Kite" button
    final_picks_kite_format: finalPicks.map(p => `NSE:${p.symbol}`).join('\n'),
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=ops_audit_today[&date=YYYY-MM-DD]
//
// Owner asked May 6 morning during live trading:
// "build an audit log for today's entire operation to test the entire
// architecture you built. Starting with the intelligence of stock selection,
// the capital division (3 equal parts is BLIND — more capital should go to
// stocks more sure to increase), the entry point (are we firing at 09:30 or
// waiting for the initial dip?). Lay surgical catches across the entire ops
// flow so at market close we can fix the entire intelligence + execution layer."
//
// Returns a chronological timeline of EVERY decision the system (and the owner)
// made today, classified by layer:
//
//   SELECTION  — pre-market brief, morning verdict, owner override
//   CAPITAL    — how qty was computed per pick (currently blind-equal — must fix)
//   ENTRY      — range_capture, breakout-trigger, Opus entryDecision, fallbacks
//   MANAGEMENT — trail updates, position_mgmt, sonnet safety
//   EXIT       — stop_hit / target_hit / trail_hit / hard_exit / orchestrator races
//   META       — system bugs, race conditions, cron misses
//
// Each event has a "surgical_catch" classification:
//   ok       — system worked as intended
//   warning  — system worked but suboptimal (e.g., blind equal capital split)
//   bug      — system had a real defect (e.g., orchestrator vs trader race)
//   gap      — missing intelligence (e.g., entry-timing strategy not surgical)
//
// At market close, owner reviews this list and fixes top-priority items.
// ═══════════════════════════════════════════════════════════════════════════
// REAL-MONEY READINESS REPORT
// ═══════════════════════════════════════════════════════════════════════════
// Returns the 2-layer readiness state for the dashboard at /trading/readiness/.
// Reads `audit_findings` rows tagged with category IN ('pre_market_integrity','eod_readiness')
// and groups by layer + trade_date. The doc this powers is at
// /trading/_context/17-REAL-MONEY-READINESS-AUDIT.md
async function getReadinessReport(db, url) {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const today = url.searchParams.get('date') || istNow.toISOString().slice(0, 10);
  const lookbackDays = parseInt(url.searchParams.get('days') || '7');

  // Pull all readiness-tagged findings for the lookback window
  const cutoffMs = Date.now() - lookbackDays * 86400000;
  const findings = (await db.prepare(`
    SELECT id, trade_date, category, severity, layer, signature, title, detail, proposed_fix, data_json,
           datetime(detected_at/1000,'unixepoch','+5 hours','+30 minutes') AS detected_ist,
           detected_at, resolved_at, resolved_by
    FROM audit_findings
    WHERE category IN ('pre_market_integrity','eod_readiness')
      AND detected_at >= ?
    ORDER BY detected_at DESC
  `).bind(cutoffMs).all()).results || [];

  // Group by trade_date + layer + category
  const byDate = {};
  for (const f of findings) {
    const d = f.trade_date;
    if (!byDate[d]) byDate[d] = { trade_date: d, intelligence: { pre_market: null, eod: null }, execution: { pre_market: null, eod: null } };
    const layerSlot = byDate[d][f.layer];
    if (!layerSlot) continue;
    const slotKey = f.category === 'pre_market_integrity' ? 'pre_market' : 'eod';
    // Keep the latest (highest detected_at) per slot
    if (!layerSlot[slotKey] || layerSlot[slotKey].detected_at < f.detected_at) {
      layerSlot[slotKey] = {
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        proposed_fix: f.proposed_fix,
        data: (() => { try { return JSON.parse(f.data_json || '{}'); } catch { return {}; } })(),
        detected_ist: f.detected_ist,
        detected_at: f.detected_at,
        resolved: !!f.resolved_at,
        resolved_by: f.resolved_by,
      };
    }
  }

  const days = Object.values(byDate).sort((a, b) => b.trade_date.localeCompare(a.trade_date));

  // Compute today's combined rollup
  const todayEntry = byDate[today];
  let todayRollup = { layer1: 'unknown', layer2: 'unknown', combined: 'unknown', go_no_go: 'NO-DATA' };
  if (todayEntry) {
    const l1Worst = ['critical', 'warning', 'info', null].find(s =>
      (todayEntry.intelligence.pre_market?.severity === s) || (todayEntry.intelligence.eod?.severity === s)
    );
    const l2Worst = ['critical', 'warning', 'info', null].find(s =>
      (todayEntry.execution.pre_market?.severity === s) || (todayEntry.execution.eod?.severity === s)
    );
    todayRollup = {
      layer1: l1Worst || 'info',
      layer2: l2Worst || 'info',
      combined: (l1Worst === 'critical' || l2Worst === 'critical') ? 'critical'
              : (l1Worst === 'warning' || l2Worst === 'warning') ? 'warning' : 'info',
      go_no_go: (l1Worst === 'critical' || l2Worst === 'critical') ? 'NO-GO'
              : (l1Worst === 'warning' || l2Worst === 'warning') ? 'GO-WITH-WARNING' : 'GO',
    };
  }

  // Summary counters across the window
  const counts = {
    days_with_data: days.length,
    intelligence_critical_days: days.filter(d => d.intelligence.eod?.severity === 'critical').length,
    execution_critical_days: days.filter(d => d.execution.eod?.severity === 'critical').length,
    intelligence_pieces_missing_today: todayEntry?.intelligence?.eod?.data?.pieces_missing?.length || 0,
    execution_pieces_missing_today: todayEntry?.execution?.eod?.data?.pieces_missing?.length || 0,
  };

  // Today's pick accuracy (if available from EOD finding)
  const pickAccuracy = todayEntry?.intelligence?.eod?.data?.pick_accuracy || null;
  const tradeSummary = todayEntry?.execution?.eod?.data?.trade_summary || null;

  return {
    today,
    lookback_days: lookbackDays,
    rollup: todayRollup,
    counts,
    pick_accuracy: pickAccuracy,
    trade_summary: tradeSummary,
    days,
    real_money_target_date: '2026-05-11',
    paper_trade_days_remaining: Math.max(0, Math.floor((new Date('2026-05-09T00:00:00').getTime() - Date.now()) / 86400000)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE A — THE SPINE — single API call powering the always-visible top strip
// + bottom phase indicator on every /trading/* page.
//
// Per doc 19 §5 + doc 18 §3 (additive read-only). Reads only existing tables,
// performs no writes, makes no external API calls.
//
// Tables read (all confirmed existing): indices_eod, crossasset_ticks,
// gift_nifty_ticks, india_vix_ticks, paper_trades, audit_findings, user_config.
// ═══════════════════════════════════════════════════════════════════════════
async function getTopStrip(db) {
  const nowMs = Date.now();
  const istNow = new Date(nowMs + 5.5 * 3600 * 1000);
  const today = istNow.toISOString().slice(0, 10);
  const dow = istNow.getUTCDay();           // IST day-of-week
  const istMins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

  // ─── 1. INDICES — NIFTY 50, NIFTY BANK, INDIA VIX from indices_eod (latest) ─
  const idxRows = (await db.prepare(`
    SELECT i1.index_name, i1.close_paise, i1.prev_close_paise, i1.trade_date
    FROM indices_eod i1
    JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
      ON i1.index_name = i2.index_name AND i1.trade_date = i2.d
    WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX')
  `).all().catch(() => ({ results: [] }))).results || [];

  const indices = idxRows.map(r => {
    const cp = (r.close_paise || 0) / 100;
    const pp = (r.prev_close_paise || 0) / 100;
    const change_pct = pp > 0 ? ((cp - pp) / pp * 100) : null;
    return {
      name: r.index_name,
      value: cp,
      change_pct: change_pct == null ? null : +change_pct.toFixed(2),
      trade_date: r.trade_date,
    };
  });

  // ─── 2. INDIA VIX live override (more recent than EOD if available) ─────────
  const vixLive = await db.prepare(
    `SELECT vix, ts FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`
  ).first().catch(() => null);
  if (vixLive?.vix) {
    const vixIdx = indices.findIndex(i => i.name === 'INDIA VIX');
    if (vixIdx >= 0) indices[vixIdx].value = vixLive.vix;
    else indices.push({ name: 'INDIA VIX', value: vixLive.vix, change_pct: null });
  }

  // ─── 3. CROSS-ASSET — USDINR, DXY, BRENT, US10Y, GOLD from crossasset_ticks ─
  const caLatest = (await db.prepare(`
    SELECT c1.asset_code, c1.value, c1.ts
    FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks
          WHERE asset_code IN ('USDINR','DXY','BRENT','US10Y','GOLD','VIX_US') GROUP BY asset_code) c2
      ON c1.asset_code = c2.asset_code AND c1.ts = c2.m
  `).all().catch(() => ({ results: [] }))).results || [];

  const dayAgo = nowMs - 26 * 3600 * 1000;
  const caPrev = (await db.prepare(`
    SELECT c1.asset_code, c1.value
    FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks
          WHERE asset_code IN ('USDINR','DXY','BRENT','US10Y','GOLD','VIX_US') AND ts < ?
          GROUP BY asset_code) c2
      ON c1.asset_code = c2.asset_code AND c1.ts = c2.m
  `).bind(dayAgo).all().catch(() => ({ results: [] }))).results || [];

  const prevByCode = Object.fromEntries(caPrev.map(r => [r.asset_code, r.value]));
  const crossasset = {};
  for (const r of caLatest) {
    const prev = prevByCode[r.asset_code];
    crossasset[r.asset_code] = {
      value: r.value,
      change_pct: prev ? +(((r.value - prev) / prev) * 100).toFixed(2) : null,
      ts: r.ts,
    };
  }

  // ─── 4. GIFT NIFTY — latest tick (Singapore market 21h) ──────────────────────
  const giftLatest = await db.prepare(
    `SELECT value, ts FROM gift_nifty_ticks ORDER BY ts DESC LIMIT 1`
  ).first().catch(() => null);
  if (giftLatest) {
    crossasset.GIFT_NIFTY = { value: giftLatest.value, change_pct: null, ts: giftLatest.ts };
  }

  // ─── 5. CAPITAL — total from user_config + deployed/pnl from paper_trades ───
  const cfgRows = (await db.prepare(
    `SELECT config_key, config_value FROM user_config WHERE config_key='total_capital_paise'`
  ).all().catch(() => ({ results: [] }))).results || [];
  const total_capital_paise = cfgRows.length
    ? parseInt(cfgRows[0].config_value || '100000000')
    : 100000000;

  const tradeAgg = await db.prepare(`
    SELECT
      COUNT(CASE WHEN is_active=1 AND auto_managed=1 THEN 1 END) AS active_count,
      COALESCE(SUM(CASE WHEN is_active=1 AND auto_managed=1
                        THEN qty * entry_paise ELSE 0 END), 0) AS deployed_paise,
      COALESCE(SUM(CASE WHEN auto_managed=1 THEN COALESCE(pnl_net_paise, 0) ELSE 0 END), 0) AS today_pnl_paise
    FROM paper_trades
    WHERE DATE(created_at/1000+19800,'unixepoch') = ?
  `).bind(today).first().catch(() => null) || { active_count: 0, deployed_paise: 0, today_pnl_paise: 0 };

  // Live unrealized P&L on still-open positions (using last intraday_ticks LTP)
  const openLive = (await db.prepare(`
    SELECT pt.id, pt.symbol, pt.qty, pt.entry_paise,
      (SELECT ltp_paise FROM intraday_ticks t
       WHERE t.symbol=pt.symbol ORDER BY t.ts DESC LIMIT 1) AS ltp_paise
    FROM paper_trades pt
    WHERE pt.is_active=1 AND pt.auto_managed=1
      AND DATE(pt.created_at/1000+19800,'unixepoch') = ?
  `).bind(today).all().catch(() => ({ results: [] }))).results || [];

  let unrealized_paise = 0;
  for (const pos of openLive) {
    if (pos.ltp_paise && pos.entry_paise && pos.qty) {
      unrealized_paise += (pos.ltp_paise - pos.entry_paise) * pos.qty;
    }
  }

  const total_pnl_paise = (tradeAgg.today_pnl_paise || 0) + unrealized_paise;
  const PROFIT_LOCK_THRESHOLD_PAISE = 3000000;  // ₹30,000 (matches wealth-trader F-L4-LOCK)
  const LOSS_HALT_THRESHOLD_PAISE = -3000000;   // ₹-30,000 (matches DAILY_HALT_LOSS_30K)

  // ─── 6. PHASE — IST clock-derived state machine ─────────────────────────────
  let phaseLabel, phaseColor, phaseStartIst, nextPhaseLabel, nextPhaseIst;
  const isWeekend = (dow === 0 || dow === 6);

  // Convert mins-since-midnight to "HH:MM" string
  const fmtIst = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  if (isWeekend) {
    phaseLabel = 'OFF_HOURS';
    phaseColor = 'gray';
    phaseStartIst = '00:00';
    nextPhaseLabel = 'PRE_MARKET';
    nextPhaseIst = 'Mon 06:00';
  } else if (istMins < 6 * 60) {                      // before 06:00 IST
    phaseLabel = 'OFF_HOURS';
    phaseColor = 'gray';
    phaseStartIst = '23:00';
    nextPhaseLabel = 'PRE_MARKET';
    nextPhaseIst = '06:00';
  } else if (istMins < 9 * 60) {                       // 06:00–09:00 IST
    phaseLabel = 'PRE_MARKET';
    phaseColor = 'yellow';
    phaseStartIst = '06:00';
    nextPhaseLabel = 'PRE_OPEN';
    nextPhaseIst = '09:00';
  } else if (istMins < 9 * 60 + 15) {                  // 09:00–09:14 IST
    phaseLabel = 'PRE_OPEN';
    phaseColor = 'blue';
    phaseStartIst = '09:00';
    nextPhaseLabel = 'LIVE';
    nextPhaseIst = '09:15';
  } else if (istMins < 15 * 60 + 30) {                 // 09:15–15:29 IST
    phaseLabel = 'LIVE';
    phaseColor = 'green';
    phaseStartIst = '09:15';
    nextPhaseLabel = 'CLOSE';
    nextPhaseIst = '15:30';
  } else if (istMins < 16 * 60) {                      // 15:30–15:59 IST
    phaseLabel = 'CLOSE';
    phaseColor = 'purple';
    phaseStartIst = '15:30';
    nextPhaseLabel = 'POST_CLOSE';
    nextPhaseIst = '16:00';
  } else if (istMins < 23 * 60) {                      // 16:00–22:59 IST
    phaseLabel = 'POST_CLOSE';
    phaseColor = 'brown';
    phaseStartIst = '16:00';
    nextPhaseLabel = 'OFF_HOURS';
    nextPhaseIst = '23:00';
  } else {                                              // 23:00+ IST
    phaseLabel = 'OFF_HOURS';
    phaseColor = 'gray';
    phaseStartIst = '23:00';
    nextPhaseLabel = 'PRE_MARKET';
    nextPhaseIst = 'tomorrow 06:00';
  }

  // Hard exit countdown — until 15:10 IST during LIVE phase, else null
  const hardExitMins = 15 * 60 + 10;
  const hard_exit_seconds = (phaseLabel === 'LIVE' && istMins < hardExitMins)
    ? (hardExitMins - istMins) * 60
    : null;

  // ─── 7. READINESS — latest pre_market_integrity + eod_readiness rollup ──────
  const readinessFindings = (await db.prepare(`
    SELECT category, severity, layer, signature
    FROM audit_findings
    WHERE category IN ('pre_market_integrity','eod_readiness') AND trade_date=?
    ORDER BY detected_at DESC
  `).bind(today).all().catch(() => ({ results: [] }))).results || [];

  const sevRank = { critical: 3, warning: 2, info: 1 };
  let layer1Worst = 'info', layer2Worst = 'info';
  for (const f of readinessFindings) {
    if (f.layer === 'intelligence' && (sevRank[f.severity] || 0) > (sevRank[layer1Worst] || 0)) layer1Worst = f.severity;
    if (f.layer === 'execution' && (sevRank[f.severity] || 0) > (sevRank[layer2Worst] || 0)) layer2Worst = f.severity;
  }
  const overallWorst = (sevRank[layer1Worst] >= sevRank[layer2Worst]) ? layer1Worst : layer2Worst;
  const go_no_go = overallWorst === 'critical' ? 'NO_GO'
                 : overallWorst === 'warning' ? 'GO_WITH_WARNING' : 'GO';

  // Days to real-money go-live (target Mon 11 May 2026)
  const realMoneyTarget = new Date('2026-05-11T03:45:00Z'); // 09:15 IST
  const days_to_real_money = Math.max(0, Math.ceil((realMoneyTarget.getTime() - nowMs) / 86400000));

  return {
    indices,
    crossasset,
    capital: {
      total_paise: total_capital_paise,
      deployed_paise: tradeAgg.deployed_paise || 0,
      deployed_pct: total_capital_paise > 0
        ? +((tradeAgg.deployed_paise / total_capital_paise) * 100).toFixed(1)
        : 0,
      position_count: tradeAgg.active_count || 0,
      today_pnl_paise: total_pnl_paise,
      profit_lock_threshold_paise: PROFIT_LOCK_THRESHOLD_PAISE,
      profit_lock_remaining_paise: Math.max(0, PROFIT_LOCK_THRESHOLD_PAISE - total_pnl_paise),
      profit_lock_pct: total_pnl_paise > 0
        ? +((total_pnl_paise / PROFIT_LOCK_THRESHOLD_PAISE) * 100).toFixed(1) : 0,
      loss_halt_threshold_paise: LOSS_HALT_THRESHOLD_PAISE,
    },
    phase: {
      label: phaseLabel,
      color: phaseColor,
      started_ist: phaseStartIst,
      next_phase_label: nextPhaseLabel,
      next_phase_ist: nextPhaseIst,
      hard_exit_seconds,
      ist_now: fmtIst(istMins),
      is_weekend: isWeekend,
    },
    readiness: {
      layer1_severity: layer1Worst,
      layer2_severity: layer2Worst,
      overall_severity: overallWorst,
      go_no_go,
      days_to_real_money,
    },
    generated_at: nowMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE B — TODAY CONSOLIDATED — single-call backing the new /trading/today/ view
// per doc 19 §6.1.
//
// Per doc 18 §3 (additive read-only). Reads only existing tables, no writes,
// no external API calls.
//
// Returns 5 sections:
//   1. pre_market_integrity   (audit_findings layer 1 + 2)
//   2. verdict                (today's morning daily_verdicts + override status)
//   3. pool_top10             (intraday_suitability ranked by owner_score)
//   4. pre_market_feed        (latest crossasset + GIFT NIFTY + breaking news)
//   5. swing_candidates       (signal_scores composite >= 70, capped to 8)
// ═══════════════════════════════════════════════════════════════════════════
async function getTodayConsolidated(db) {
  const nowMs = Date.now();
  const istNow = new Date(nowMs + 5.5 * 3600 * 1000);
  const today = istNow.toISOString().slice(0, 10);
  const istMins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

  // ─── 1. PRE-MARKET INTEGRITY (today's findings, layer 1 + 2) ────────────────
  const integrityRows = (await db.prepare(`
    SELECT category, severity, layer, signature, title, detail, data_json,
           detected_at, resolved_at
    FROM audit_findings
    WHERE category='pre_market_integrity' AND trade_date=?
    ORDER BY detected_at DESC
  `).bind(today).all().catch(() => ({ results: [] }))).results || [];

  // Pick latest per (layer, category) since cron may have fired multiple times
  const intByLayer = {};
  for (const r of integrityRows) {
    if (!intByLayer[r.layer] || intByLayer[r.layer].detected_at < r.detected_at) {
      intByLayer[r.layer] = r;
    }
  }
  const parseChecks = (row) => {
    if (!row?.data_json) return [];
    try { return JSON.parse(row.data_json).checks || []; } catch { return []; }
  };
  const pre_market_integrity = {
    layer1: intByLayer.intelligence ? {
      severity: intByLayer.intelligence.severity,
      title: intByLayer.intelligence.title,
      checks: parseChecks(intByLayer.intelligence),
      detected_at: intByLayer.intelligence.detected_at,
    } : null,
    layer2: intByLayer.execution ? {
      severity: intByLayer.execution.severity,
      title: intByLayer.execution.title,
      checks: parseChecks(intByLayer.execution),
      detected_at: intByLayer.execution.detected_at,
    } : null,
    next_check_ist: '08:25',
  };

  // ─── 2. TODAY'S VERDICT + OVERRIDE STATUS ───────────────────────────────────
  const verdictRow = await db.prepare(`
    SELECT id, verdict_type, decision, headline, narrative,
           recommended_symbol, picks_json, alternatives_json,
           context_snapshot_json, composed_at, composed_by_model, cost_paise,
           portfolio_capital_paise, strategy_mode, entry_window, horizon
    FROM daily_verdicts
    WHERE trade_date=? AND verdict_type='morning'
    ORDER BY id DESC LIMIT 1
  `).bind(today).first().catch(() => null);

  const overrideRow = verdictRow ? await db.prepare(`
    SELECT overridden_at, original_picks_json, new_picks_json, override_reason, overridden_by
    FROM pick_overrides
    WHERE trade_date=?
    ORDER BY id DESC LIMIT 1
  `).bind(today).first().catch(() => null) : null;

  let verdict = null;
  if (verdictRow) {
    let picks = [];
    try { picks = JSON.parse(verdictRow.picks_json || '[]'); } catch {}
    let alternatives = [];
    try { alternatives = JSON.parse(verdictRow.alternatives_json || '[]'); } catch {}
    let context = {};
    try { context = JSON.parse(verdictRow.context_snapshot_json || '{}'); } catch {}
    verdict = {
      id: verdictRow.id,
      type: verdictRow.verdict_type,
      decision: verdictRow.decision,
      headline: verdictRow.headline,
      narrative: verdictRow.narrative,
      recommended_symbol: verdictRow.recommended_symbol,
      picks,
      alternatives,
      context,
      composed_at: verdictRow.composed_at,
      composed_by_model: verdictRow.composed_by_model,
      cost_paise: verdictRow.cost_paise,
      portfolio_capital_paise: verdictRow.portfolio_capital_paise,
      strategy_mode: verdictRow.strategy_mode,
      entry_window: verdictRow.entry_window,
      override: overrideRow ? {
        overridden_at: overrideRow.overridden_at,
        original_picks: (() => { try { return JSON.parse(overrideRow.original_picks_json); } catch { return []; } })(),
        new_picks: (() => { try { return JSON.parse(overrideRow.new_picks_json); } catch { return []; } })(),
        reason: overrideRow.override_reason,
        by: overrideRow.overridden_by,
      } : null,
    };
  }

  // ─── 3. 90D POOL TOP-10 BY OWNER_SCORE ──────────────────────────────────────
  const pool_top10 = (await db.prepare(`
    SELECT
      symbol,
      ROUND(intraday_score, 1) AS intraday_score,
      ROUND(owner_score, 1) AS owner_score,
      ROUND(loss_resistance_score, 1) AS loss_resistance_score,
      ROUND(avg_open_to_high_pct, 2) AS avg_open_to_high_pct,
      ROUND(avg_up_last_week_pct, 2) AS avg_up_last_week_pct,
      hit_2pct_rate, hit_3pct_rate, hit_5pct_rate,
      green_close_rate, hit_neg_2pct_rate,
      hit_2pct_last_week, green_close_last_week,
      sector
    FROM intraday_suitability
    WHERE owner_score IS NOT NULL
    ORDER BY owner_score DESC, intraday_score DESC
    LIMIT 10
  `).all().catch(() => ({ results: [] }))).results || [];

  // ─── 4. LIVE PRE-MARKET FEED ────────────────────────────────────────────────
  // Mix of: latest crossasset moves, GIFT NIFTY ticks, breaking news (last 12h)
  const cutoff12h = nowMs - 12 * 3600 * 1000;

  // 4a. Cross-asset latest + previous (24h ago) for delta
  const xaLatest = (await db.prepare(`
    SELECT c1.asset_code, c1.value, c1.ts
    FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks
          WHERE asset_code IN ('USDINR','DXY','BRENT','US10Y','GOLD','VIX_US')
          GROUP BY asset_code) c2
      ON c1.asset_code = c2.asset_code AND c1.ts = c2.m
  `).all().catch(() => ({ results: [] }))).results || [];

  const xaPrev = (await db.prepare(`
    SELECT c1.asset_code, c1.value
    FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks
          WHERE asset_code IN ('USDINR','DXY','BRENT','US10Y','GOLD','VIX_US')
            AND ts < ?
          GROUP BY asset_code) c2
      ON c1.asset_code = c2.asset_code AND c1.ts = c2.m
  `).bind(nowMs - 26 * 3600 * 1000).all().catch(() => ({ results: [] }))).results || [];
  const prevByCode = Object.fromEntries(xaPrev.map(r => [r.asset_code, r.value]));

  // 4b. GIFT NIFTY latest
  const giftLatest = await db.prepare(
    `SELECT value, ts FROM gift_nifty_ticks ORDER BY ts DESC LIMIT 1`
  ).first().catch(() => null);

  // 4c. Recent news with sentiment
  const newsRows = (await db.prepare(`
    SELECT headline, source, published_at, sentiment_score, importance_score, symbols_tagged
    FROM news_items
    WHERE published_at > ?
    ORDER BY published_at DESC
    LIMIT 8
  `).bind(cutoff12h).all().catch(() => ({ results: [] }))).results || [];

  // Compose the feed: each row has {ts, kind, label, value, change, headline, source}
  const feed = [];
  for (const x of xaLatest) {
    const prev = prevByCode[x.asset_code];
    const change_pct = prev ? +(((x.value - prev) / prev) * 100).toFixed(2) : null;
    feed.push({
      ts: x.ts, kind: 'crossasset',
      label: x.asset_code, value: x.value, change_pct,
    });
  }
  if (giftLatest) {
    feed.push({
      ts: giftLatest.ts, kind: 'gift_nifty',
      label: 'GIFT NIFTY', value: giftLatest.value, change_pct: null,
    });
  }
  for (const n of newsRows) {
    feed.push({
      ts: n.published_at, kind: 'news',
      headline: n.headline, source: n.source,
      sentiment: n.sentiment_score, importance: n.importance_score,
      symbols_tagged: n.symbols_tagged,
    });
  }
  feed.sort((a, b) => b.ts - a.ts);
  const pre_market_feed = feed.slice(0, 12);

  // ─── 5. SWING CANDIDATES (composite_score >= 70, latest snapshot, top 8) ────
  const latestSig = await db.prepare(
    `SELECT MAX(computed_at) AS m FROM signal_scores`
  ).first().catch(() => null);

  let swing_candidates = { computed_at: null, candidates: [] };
  if (latestSig?.m) {
    const sig = (await db.prepare(`
      SELECT symbol, ROUND(composite_score, 1) AS composite_score, regime,
             trend_score, momentum_score, breakout_score
      FROM signal_scores
      WHERE computed_at = ? AND composite_score >= 70
      ORDER BY composite_score DESC LIMIT 8
    `).bind(latestSig.m).all().catch(() => ({ results: [] }))).results || [];
    swing_candidates = { computed_at: latestSig.m, candidates: sig };
  }

  // ─── 6. PHASE (same logic as top_strip but local — saves another roundtrip) ─
  let phaseLabel;
  const dow = istNow.getUTCDay();
  if (dow === 0 || dow === 6) phaseLabel = 'OFF_HOURS';
  else if (istMins < 6 * 60) phaseLabel = 'OFF_HOURS';
  else if (istMins < 9 * 60) phaseLabel = 'PRE_MARKET';
  else if (istMins < 9 * 60 + 15) phaseLabel = 'PRE_OPEN';
  else if (istMins < 15 * 60 + 30) phaseLabel = 'LIVE';
  else if (istMins < 16 * 60) phaseLabel = 'CLOSE';
  else if (istMins < 23 * 60) phaseLabel = 'POST_CLOSE';
  else phaseLabel = 'OFF_HOURS';

  return {
    trade_date: today,
    ist_now_minutes: istMins,
    phase: phaseLabel,
    pre_market_integrity,
    verdict,
    pool_top10,
    pre_market_feed,
    swing_candidates,
    generated_at: nowMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
async function getOpsAuditToday(db, url) {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const date = url.searchParams.get('date') || istNow.toISOString().slice(0, 10);

  // ─── Pull ALL today's events from each source table ────────────────────
  const verdicts = (await db.prepare(`
    SELECT id, verdict_type, decision, recommended_symbol, headline,
           composed_by_model, datetime(composed_at/1000,'unixepoch','+5 hours','+30 minutes') AS ist,
           composed_at AS ts_ms, picks_json, narrative
    FROM daily_verdicts WHERE trade_date=? ORDER BY composed_at ASC
  `).bind(date).all()).results || [];

  const trades = (await db.prepare(`
    SELECT id, symbol, trader_state, qty, entry_paise, stop_paise, target_paise,
           or_high_paise, exit_paise, exit_reason, pnl_net_paise,
           datetime(created_at/1000,'unixepoch','+5 hours','+30 minutes') AS created_ist,
           datetime(coalesce(exit_at,0)/1000,'unixepoch','+5 hours','+30 minutes') AS exit_ist,
           created_at AS created_ms, exit_at AS exit_ms, trader_notes,
           is_active, auto_managed
    FROM paper_trades
    WHERE auto_managed=1 AND DATE(created_at/1000,'unixepoch')=?
    ORDER BY created_at ASC
  `).bind(date).all()).results || [];

  const decisions = (await db.prepare(`
    SELECT cron_phase, symbol, decision, ltp_paise, ts AS ts_ms,
           datetime(ts/1000,'unixepoch','+5 hours','+30 minutes') AS ist,
           composed_by_model, rationale
    FROM trader_decisions
    WHERE ts > strftime('%s','now')*1000 - 86400000
      AND DATE(ts/1000,'unixepoch','+5 hours','+30 minutes')=?
    ORDER BY ts ASC
  `).bind(date).all().catch(() => ({ results: [] }))).results || [];

  const cronFires = (await db.prepare(`
    SELECT worker_name, cron_name, status, rows_written, error_message,
           started_at AS ts_ms,
           datetime(started_at/1000,'unixepoch','+5 hours','+30 minutes') AS ist,
           duration_ms
    FROM cron_run_log
    WHERE DATE(started_at/1000,'unixepoch','+5 hours','+30 minutes')=?
      AND worker_name IN ('wealth-verdict','wealth-trader','wealth-orchestrator','wealth-intraday-bars')
    ORDER BY started_at ASC
  `).bind(date).all().catch(() => ({ results: [] }))).results || [];

  // ─── BUILD TIMELINE EVENTS ────────────────────────────────────────────
  const events = [];

  // SELECTION events (verdicts)
  for (const v of verdicts) {
    let picks = [];
    try { picks = JSON.parse(v.picks_json || '[]'); } catch {}
    const pickSyms = picks.map(p => p.symbol).join(', ');
    const isOverride = (v.narrative || '').toLowerCase().includes('owner override') || (v.headline || '').toLowerCase().includes('override');
    events.push({
      ts_ms: v.ts_ms,
      ist: v.ist,
      layer: 'SELECTION',
      title: `${v.verdict_type === 'morning' ? 'Morning verdict' : v.verdict_type === 'pre_market' ? 'Pre-market brief' : v.verdict_type} → ${v.decision}`,
      detail: `${v.headline || ''}${pickSyms ? ' · picks: ' + pickSyms : ''}`,
      surgical_catch: isOverride ? 'override'
        : v.decision === 'SIT_OUT' ? (picks.length === 0 ? 'gap' : 'ok')
        : 'ok',
      catch_note: isOverride ? 'Owner manually replaced Opus picks — sector cap bypassed deliberately for intraday-only'
        : v.decision === 'SIT_OUT' && picks.length === 0 ? 'BUG: empty pool from suitabilityRefresh column-count mismatch (15 vs 12). Caused entire system to skip the day until manual fix at 08:55 IST.'
        : null,
      data: { model: v.composed_by_model, picks_count: picks.length },
    });
  }

  // CAPITAL events (per-trade qty/stop/target shown for "blind 3-equal" critique)
  for (const t of trades) {
    const TEN_LAKH = 100000000;
    const deployed = t.qty * t.entry_paise;
    const allocPct = +(deployed / TEN_LAKH * 100).toFixed(1);
    events.push({
      ts_ms: t.created_ms,
      ist: t.created_ist,
      layer: 'CAPITAL',
      title: `${t.symbol} — capital allocation: ${allocPct}%`,
      detail: `qty ${t.qty} × ₹${(t.entry_paise/100).toFixed(2)} entry estimate = ₹${Math.round(deployed/100).toLocaleString('en-IN')} deployed (~${allocPct}% of ₹10L). Stop ₹${(t.stop_paise/100).toFixed(2)} · Target ₹${(t.target_paise/100).toFixed(2)}`,
      surgical_catch: allocPct >= 28 && allocPct <= 32 ? 'warning' : 'ok',
      catch_note: allocPct >= 28 && allocPct <= 32
        ? 'CAPITAL DIVISION IS BLIND — every pick gets ~30% regardless of conviction strength. FIX: weight by hybrid_score × signal_score × bayesian_posterior. High-confidence picks should get 40-45%, low get 20-25%. Owner asked for this fix at market close.'
        : null,
      data: { qty: t.qty, deployed_paise: deployed, alloc_pct: allocPct },
    });
  }

  // ENTRY events (range_capture, breakout-trigger, entryDecision)
  for (const d of decisions) {
    let layer = 'ENTRY';
    if (d.cron_phase === 'price_monitor' || d.cron_phase?.includes('mgmt')) layer = 'MANAGEMENT';
    if (d.decision?.includes('EXIT') || d.decision?.includes('STOP_HIT') || d.decision?.includes('TARGET_HIT') || d.decision?.includes('SKIP_GAPPED')) layer = 'EXIT';

    let surgicalCatch = 'ok';
    let catchNote = null;
    if (d.decision === 'SKIP_GAPPED_BELOW_STOP') {
      surgicalCatch = 'gap';
      catchNote = 'GAP: entry strategy is naive — uses 09:31 LTP as entry estimate, then SKIPs if LTP drops below the resulting stop. Better: wait for stock to make initial dip + recovery before placing entry. Or use OR-low + ATR-buffer as stop floor.';
    } else if (d.cron_phase === 'range_capture_fallback') {
      surgicalCatch = 'bug';
      catchNote = 'BUG-CAUGHT: B-1 safety net fired because main 09:30 cron didn\'t fire on time. Needs investigation: why did Cloudflare cron miss?';
    } else if (d.decision === 'WAIT' && d.cron_phase?.startsWith('entry_')) {
      surgicalCatch = 'ok';
      catchNote = 'Opus correctly held entry — LTP below OR-high, no breakout confirmed.';
    }
    events.push({
      ts_ms: d.ts_ms,
      ist: d.ist,
      layer,
      title: `${d.symbol || '(system)'} ${d.cron_phase} → ${d.decision || 'no-op'}`,
      detail: d.rationale ? d.rationale.slice(0, 300) : (d.ltp_paise ? `LTP ₹${(d.ltp_paise/100).toFixed(2)}` : '—'),
      surgical_catch: surgicalCatch,
      catch_note: catchNote,
      data: { model: d.composed_by_model, ltp_paise: d.ltp_paise },
    });
  }

  // EXIT events (paper_trades exited rows + race-condition flag)
  for (const t of trades.filter(t => t.exit_paise || (t.trader_state && t.trader_state !== 'WATCHING' && t.trader_state !== 'ENTERED'))) {
    const isPhantomExit = t.trader_state === 'SKIPPED' && t.exit_paise && t.pnl_net_paise;
    events.push({
      ts_ms: t.exit_ms || t.created_ms,
      ist: t.exit_ist || t.created_ist,
      layer: 'EXIT',
      title: `${t.symbol} — ${t.trader_state} (${t.exit_reason || 'no-reason'})`,
      detail: t.exit_paise
        ? `Exit @ ₹${(t.exit_paise/100).toFixed(2)} · P&L ${(t.pnl_net_paise || 0) >= 0 ? '+' : ''}₹${Math.round((t.pnl_net_paise||0)/100).toLocaleString('en-IN')}`
        : `state: ${t.trader_state}`,
      surgical_catch: isPhantomExit ? 'bug' : 'ok',
      catch_note: isPhantomExit
        ? 'BUG: PHANTOM EXIT. trader_state=SKIPPED but exit_paise + pnl_net set. Caused by orchestrator paperTradeWatcher race: it iterates ALL is_active=1 rows including WATCHING ones, and treats LTP <= stop as exit even before any real entry. wealth-trader then overwrote trader_state to SKIPPED. Both deny each other. FIX: orchestrator must skip auto_managed=1 rows (let trader own lifecycle) OR skip trader_state IN (WATCHING, SKIPPED).'
        : null,
      data: { state: t.trader_state, exit_paise: t.exit_paise, pnl: t.pnl_net_paise },
    });
  }

  // META events (cron health)
  for (const c of cronFires) {
    if (c.status !== 'success') {
      events.push({
        ts_ms: c.ts_ms,
        ist: c.ist,
        layer: 'META',
        title: `${c.worker_name} :: ${c.cron_name} — ${c.status}`,
        detail: c.error_message?.slice(0, 200) || `${c.duration_ms}ms`,
        surgical_catch: 'bug',
        catch_note: c.status === 'failed'
          ? `Cron failed — investigate ${c.worker_name}/${c.cron_name}`
          : 'Cron status not 200 OK',
        data: { worker: c.worker_name, cron: c.cron_name, dur_ms: c.duration_ms },
      });
    }
  }

  // ─── SORT chronologically ─────────────────────────────────────────────
  events.sort((a, b) => (a.ts_ms || 0) - (b.ts_ms || 0));

  // ─── ARCHITECTURE-LEVEL FINDINGS for tonight's fix session ────────────
  const findings = [
    {
      id: 'F1',
      severity: 'P0',
      layer: 'CAPITAL',
      title: 'Capital division is BLIND — equal 30/30/30 ignores conviction strength',
      observed: trades.map(t => ({ symbol: t.symbol, alloc_pct: +(t.qty * t.entry_paise / 100000000 * 100).toFixed(1) })),
      proposed_fix: 'Weight by composite conviction = (hybrid_score × bayesian_posterior_win_rate × recent_regime_strength). Range: 20-50% per pick. Top conviction gets 40-50%, bottom 20-25%.',
      effort_lines: '~30 lines in wealth-verdict::composeVerdict + Opus prompt update',
    },
    {
      id: 'F2',
      severity: 'P0',
      layer: 'ENTRY',
      title: 'Entry timing is naive — uses 09:31 LTP as entry estimate, then skips on first dip',
      observed: 'DEEDEV/STLTECH SKIPPED before any breakout. The LTP at 09:31 was BETWEEN OR-low and OR-high. Stop was set 1.2% below this midpoint. When price made a normal post-09:30 dip below that arbitrary stop, the system thought it was "gapping past stop."',
      proposed_fix: 'Three-stage entry: (a) initial range observed 09:15-09:30. (b) wait for first DIP and bounce confirmation. (c) THEN place entry above the dip-low. Stop = dip-low − ATR-buffer (NOT entry × 0.988). Target = entry + 2.5×R. This is "surgical entry" — caught the dip, ran with the recovery.',
      effort_lines: '~80 lines in wealth-trader::rangeCapture + new entryDipDetector function',
    },
    {
      id: 'F3',
      severity: 'P0',
      layer: 'EXIT',
      title: 'Race condition: orchestrator paperTradeWatcher fires phantom exits on WATCHING rows',
      observed: 'DEEDEV / STLTECH show trader_state=SKIPPED but with exit_paise + non-zero pnl_net. Two systems fought for the row: orchestrator marked EXITED (with stop_hit), then wealth-trader overwrote trader_state=SKIPPED. Result: misleading P&L numbers in the Hero card.',
      proposed_fix: 'Add `AND auto_managed=0` to wealth-orchestrator paperTradeWatcher\'s SELECT (line ~870). Auto-managed trades belong to wealth-trader exclusively.',
      effort_lines: '1-line SQL fix in wealth-orchestrator',
    },
    {
      id: 'F4',
      severity: 'P1',
      layer: 'SELECTION',
      title: 'composeVerdict reads ONLY intraday_suitability, ignores live signal_scores',
      observed: 'Today signal_scores has ABCAPITAL/IDEAFORGE/CAMS/CALSOFT/WOCKPHARMA all at 73-74 composite_score, transitioning regime, aligned_up. NONE were in the 84-pool because they don\'t pass historical hit_2pct >= 50. So Opus never saw them.',
      proposed_fix: 'Cross-reference: pick from INTERSECTION (intraday-suitable AND signal-score-top-50) OR add a 2nd track that shortlists from signal_scores + bayesian_posteriors but with looser intraday-history requirement.',
      effort_lines: '~50 lines in wealth-verdict::composeVerdict candidate-shortlist',
    },
    {
      id: 'F5',
      severity: 'P1',
      layer: 'META',
      title: '6 of 9 dim_health dimensions are <10% — engine is half-blind',
      observed: 'flow 0.7%, options 0%, sentiment 2.9%, macro 3.8%, retail_buzz 0.2%, quality 4.7%. The regime classifier returns "unknown" because it can\'t fuse these dims.',
      proposed_fix: 'Triage each broken dim — likely separate root causes: stale source feeds, broken aggregation queries, schema renames. ~1 hour per dim.',
      effort_lines: '~6 hours total root-cause + fix across 6 dims',
    },
    {
      id: 'F6',
      severity: 'P2',
      layer: 'SELECTION',
      title: 'last_week_* enrichment was 100% NULL until manual trigger this morning',
      observed: 'wealth-intraday-bars Saturday cron last fired May 4. Today (Tuesday) the last-week data was 5 days stale. Manual trigger this morning at 09:25 populated 48/84.',
      proposed_fix: 'Add a daily 06:00 IST trigger for weekly_enrich (currently weekly only). last_week_* should ALWAYS reflect last 5 trading days.',
      effort_lines: '1-line cron addition in wealth-intraday-bars wrangler.toml',
    },
  ];

  // ─── PERSISTED FINDINGS from audit_findings table (cron-collected) ─────
  // wealth-orchestrator runAuditScanner runs every 15min during market hours
  // and writes findings here. Append unresolved findings to the architecture
  // findings list so /audit/ UI surfaces them automatically.
  // Read BOTH open + recently-resolved findings so UI can show ✅ status
  const persistedFindings = (await db.prepare(`
    SELECT id, detected_at, category, severity, layer, signature,
           title, detail, proposed_fix, data_json,
           resolved_at, resolved_by
    FROM audit_findings
    WHERE trade_date=?
    ORDER BY
      CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END,
      CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      detected_at DESC
    LIMIT 50
  `).bind(date).all().catch(() => ({ results: [] }))).results || [];

  const persistedAsFindings = persistedFindings.map(p => {
    let parsedData = {};
    try { parsedData = JSON.parse(p.data_json || '{}'); } catch {}
    const isResolved = p.resolved_at != null;
    return {
      id: `cron:${p.id}`,
      severity: p.severity,
      layer: p.layer,
      title: p.title,
      observed: p.detail,
      proposed_fix: p.proposed_fix,
      effort_lines: 'auto-detected ' + new Date(p.detected_at + 5.5*3600000).toISOString().replace('T',' ').slice(11,19) + ' IST'
        + (isResolved ? ' · resolved ' + new Date(p.resolved_at + 5.5*3600000).toISOString().replace('T',' ').slice(11,19) + ' IST' : ''),
      category: p.category,
      auto_detected: true,
      resolved: isResolved,
      resolved_at: p.resolved_at,
      resolved_by: p.resolved_by,
      data: parsedData,
    };
  });

  // Merge: cron-detected findings first (auto-current), then static architecture findings
  const allFindings = [...persistedAsFindings, ...findings];

  return {
    ok: true,
    date,
    summary: {
      total_events: events.length,
      by_layer: {
        SELECTION: events.filter(e => e.layer === 'SELECTION').length,
        CAPITAL: events.filter(e => e.layer === 'CAPITAL').length,
        ENTRY: events.filter(e => e.layer === 'ENTRY').length,
        MANAGEMENT: events.filter(e => e.layer === 'MANAGEMENT').length,
        EXIT: events.filter(e => e.layer === 'EXIT').length,
        META: events.filter(e => e.layer === 'META').length,
      },
      by_catch: {
        ok: events.filter(e => e.surgical_catch === 'ok').length,
        warning: events.filter(e => e.surgical_catch === 'warning').length,
        bug: events.filter(e => e.surgical_catch === 'bug').length,
        gap: events.filter(e => e.surgical_catch === 'gap').length,
        override: events.filter(e => e.surgical_catch === 'override').length,
      },
      persisted_findings: persistedFindings.length,
      cron_scanned_at: persistedFindings[0]?.detected_at || null,
    },
    timeline: events,
    architecture_findings: allFindings,
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=trade_comparison[&date=YYYY-MM-DD][&opus_symbols=A,B,C]
//
// Owner asked May 6 morning: "compare our current position vs what would have
// been our position if we had entered using the Claude Opus selection stocks.
// Show a live feed of that today, in a different UI."
//
// Context: today owner manually overrode Opus's picks (TDPOWERSYS/HFCL/AEROFLEX)
// with DEEDEV/AGIIL/STLTECH. This endpoint shows side-by-side how each path is
// performing in real-time.
//
// Returns:
//   actual_picks[]    — today's auto_managed paper_trades with live LTP +
//                       post-exit trail (max LTP since exit, current LTP,
//                       did it recover above stop)
//   opus_picks[]      — counterfactual: what would have happened if we had
//                       paper-traded Opus's original 3 instead. Per-pick:
//                       hypothetical entry (open price), live LTP, day OHLC,
//                       hypothetical P&L if held to current LTP
//   summary           — totals for both paths
// ═══════════════════════════════════════════════════════════════════════════
async function getTradeComparison(db, env, url) {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const date = url.searchParams.get('date') || istNow.toISOString().slice(0, 10);

  // For 2026-05-06 the Opus-original picks are hardcoded (since they were
  // overridden in picks_json). For other dates we parse from the first verdict.
  const opusOverride = url.searchParams.get('opus_symbols');
  const opusOriginal = opusOverride
    ? opusOverride.split(',').map(s => s.trim().toUpperCase())
    : (date === '2026-05-06' ? ['TDPOWERSYS', 'HFCL', 'AEROFLEX'] : []);

  // ─── ACTUAL PICKS: today's auto-managed paper_trades ──────────────────
  const actual = (await db.prepare(`
    SELECT id, symbol, trader_state, qty, entry_paise, stop_paise, target_paise,
           or_high_paise, or_low_paise, exit_paise, exit_reason, exit_at,
           pnl_net_paise, peak_price_paise, trader_notes, is_active,
           datetime(created_at/1000,'unixepoch','+5 hours','+30 minutes') AS created_ist,
           datetime(coalesce(exit_at,0)/1000,'unixepoch','+5 hours','+30 minutes') AS exit_ist
    FROM paper_trades
    WHERE auto_managed=1 AND DATE(created_at/1000,'unixepoch')=?
    ORDER BY id ASC
  `).bind(date).all()).results || [];

  const allSymbols = [
    ...new Set([...actual.map(a => a.symbol), ...opusOriginal])
  ].filter(Boolean);

  if (allSymbols.length === 0) {
    return { ok: false, reason: 'no-trades-or-opus-picks', date };
  }

  const placeholders = allSymbols.map(() => '?').join(',');

  // ─── Day OHLC + live LTP per symbol ────────────────────────────────────
  const ohlcRows = (await db.prepare(`
    SELECT b.symbol,
      MIN(CASE WHEN ts = (SELECT MIN(ts) FROM intraday_bars b2 WHERE b2.symbol=b.symbol AND b2.trade_date=? AND b2.interval='5minute') THEN open_paise END) AS day_open,
      MAX(b.high_paise) AS day_high,
      MIN(b.low_paise)  AS day_low,
      MAX(CASE WHEN ts = (SELECT MAX(ts) FROM intraday_bars b3 WHERE b3.symbol=b.symbol AND b3.trade_date=? AND b3.interval='5minute') THEN close_paise END) AS day_close
    FROM intraday_bars b
    WHERE b.symbol IN (${placeholders}) AND b.trade_date=? AND b.interval='5minute'
    GROUP BY b.symbol
  `).bind(date, date, ...allSymbols, date).all().catch(() => ({ results: [] }))).results || [];
  const ohlcMap = {};
  for (const r of ohlcRows) ohlcMap[r.symbol] = r;

  const liveTickRows = (await db.prepare(`
    SELECT t1.symbol, t1.ltp_paise, t1.ts FROM intraday_ticks t1
    JOIN (SELECT symbol, MAX(ts) AS m FROM intraday_ticks WHERE symbol IN (${placeholders}) GROUP BY symbol) t2
      ON t1.symbol=t2.symbol AND t1.ts=t2.m
  `).bind(...allSymbols).all().catch(() => ({ results: [] }))).results || [];
  const ltpMap = {};
  // Treat ticks older than 5 minutes as stale during market hours — force refetch
  const FRESH_THRESHOLD_MS = 5 * 60 * 1000;
  const nowMs = Date.now();
  for (const t of liveTickRows) {
    const isFresh = (nowMs - t.ts) < FRESH_THRESHOLD_MS;
    if (isFresh) ltpMap[t.symbol] = { ltp: t.ltp_paise, ts: t.ts, source: 'intraday_ticks' };
  }

  // CLEANEST FIX (May 6 mid-trade): for any symbol missing fresh LTP — typically
  // the Opus counterfactual picks (TDPOWERSYS, AEROFLEX) that aren't in the
  // active watchlist and so wealth-price-core never polls them — fetch live LTP
  // DIRECTLY from Kite. Guarantees the /compare/ page never has gaps regardless
  // of which stocks are being compared.
  const missingFromTicks = allSymbols.filter(s => !ltpMap[s]);
  if (missingFromTicks.length > 0 && env) {
    const kiteLtp = await fetchLiveLtp(db, env, missingFromTicks).catch(() => ({}));
    for (const sym of Object.keys(kiteLtp)) {
      if (kiteLtp[sym] != null) {
        ltpMap[sym] = { ltp: kiteLtp[sym], ts: nowMs, source: 'kite_direct' };
      }
    }
  }

  // ─── Post-exit max LTP for exited/SKIPPED rows (the "panic-exit" check) ─
  // For each actual pick that's no longer live: how high did the stock go AFTER
  // exit? If it recovered above stop or hit target, exit was premature.
  const postExitMaxBySymbol = {};
  for (const a of actual) {
    if (a.exit_at && a.exit_at > 0) {
      const peakAfterExit = await db.prepare(`
        SELECT MAX(high_paise) AS max_h, MIN(low_paise) AS min_l, MAX(close_paise) AS last_close
        FROM intraday_bars
        WHERE symbol=? AND trade_date=? AND interval='5minute' AND ts > ?
      `).bind(a.symbol, date, a.exit_at).first().catch(() => null);
      postExitMaxBySymbol[a.symbol] = {
        max_high_paise:  peakAfterExit?.max_h || null,
        min_low_paise:   peakAfterExit?.min_l || null,
        last_close_paise: peakAfterExit?.last_close || null,
      };
    }
  }

  // Helper: compute realistic Zerodha intraday MIS round-trip cost
  const zerodhaCost = (e, x, q) => {
    const buy = Math.abs(e) * q, sell = Math.abs(x) * q;
    return Math.round(4000 + sell * 0.00025 + (buy + sell) * 0.0000322 + buy * 0.00003 + (4000 + (buy + sell) * 0.0000322) * 0.18);
  };
  const TEN_LAKH = 100000000;
  const PER_PICK_CAPITAL = 30000000;  // ₹3L per pick (30%)

  // ─── ACTUAL PICKS — enrich with live data + post-exit trail ────────────
  const actualEnriched = actual.map(a => {
    const live = ltpMap[a.symbol];
    const ohlc = ohlcMap[a.symbol];
    const post = postExitMaxBySymbol[a.symbol];
    const cur = live?.ltp || ohlc?.day_close || null;

    // Did the system "panic exit" — i.e., did the stock recover above the stop
    // or even hit target after we exited?
    let panicExitFlag = null;
    let recoveryMaxPaise = null;
    let wouldHaveHit = null;
    if (a.exit_at && post && post.max_high_paise) {
      recoveryMaxPaise = post.max_high_paise;
      wouldHaveHit = a.target_paise && post.max_high_paise >= a.target_paise
        ? 'target' : (post.max_high_paise > a.entry_paise ? 'recovered_above_entry' : 'stayed_below_entry');
      panicExitFlag = wouldHaveHit !== 'stayed_below_entry';
    }

    // If the position is still live (WATCHING/ENTERED), compute live MTM
    let liveMtm = null;
    if (a.trader_state === 'ENTERED' && cur && a.entry_paise) {
      const gross = (cur - a.entry_paise) * a.qty;
      const cost = zerodhaCost(a.entry_paise, cur, a.qty);
      liveMtm = gross - cost;
    }

    return {
      symbol: a.symbol,
      trader_state: a.trader_state,
      qty: a.qty,
      entry_paise: a.entry_paise,
      stop_paise: a.stop_paise,
      target_paise: a.target_paise,
      or_high_paise: a.or_high_paise,
      or_low_paise: a.or_low_paise,
      exit_paise: a.exit_paise,
      exit_reason: a.exit_reason,
      exit_ist: a.exit_ist,
      pnl_net_paise: a.pnl_net_paise,
      live_ltp_paise: live?.ltp || null,
      live_mtm_paise: liveMtm,
      day_open_paise: ohlc?.day_open || null,
      day_high_paise: ohlc?.day_high || null,
      day_low_paise:  ohlc?.day_low  || null,
      day_close_paise: ohlc?.day_close || null,
      day_change_pct: (cur && ohlc?.day_open) ? +(((cur - ohlc.day_open) / ohlc.day_open) * 100).toFixed(2) : null,
      // Post-exit trail
      post_exit: a.exit_at ? {
        max_high_paise_since_exit: recoveryMaxPaise,
        last_close_paise: post?.last_close_paise,
        would_have_hit: wouldHaveHit,           // 'target' | 'recovered_above_entry' | 'stayed_below_entry'
        was_panic_exit: panicExitFlag,
        // What we'd have made if we had stayed in
        if_held_to_now_paise: cur && a.entry_paise && a.qty
          ? (cur - a.entry_paise) * a.qty - zerodhaCost(a.entry_paise, cur, a.qty)
          : null,
      } : null,
    };
  });

  // ─── OPUS PICKS — counterfactual ──────────────────────────────────────
  const opusEnriched = opusOriginal.map(symbol => {
    const live = ltpMap[symbol];
    const ohlc = ohlcMap[symbol];
    const cur = live?.ltp || ohlc?.day_close || null;
    const dayOpen = ohlc?.day_open || null;

    // Hypothetical: paper-trade was placed at day_open with same params
    // (₹3L allocation, 1.2% stop, 2.8% target — same as actual override params)
    let hypothetical = null;
    if (dayOpen && dayOpen > 100 && cur) {
      const qty = Math.floor(PER_PICK_CAPITAL / dayOpen);
      const stop = Math.round(dayOpen * 0.988);
      const target = Math.round(dayOpen * 1.028);
      const grossNow = (cur - dayOpen) * qty;
      const costNow = zerodhaCost(dayOpen, cur, qty);
      // Did stop or target hit during the day?
      const dayHigh = ohlc.day_high || cur;
      const dayLow  = ohlc.day_low  || cur;
      let simExit = null;
      let simExitPaise = null;
      if (dayLow <= stop) { simExit = 'stop_hit'; simExitPaise = stop; }
      else if (dayHigh >= target) { simExit = 'target_hit'; simExitPaise = target; }
      const simPnL = simExitPaise
        ? (simExitPaise - dayOpen) * qty - zerodhaCost(dayOpen, simExitPaise, qty)
        : grossNow - costNow;  // still open hypothetically; live MTM
      hypothetical = {
        entry_paise: dayOpen,
        qty,
        deployed_paise: qty * dayOpen,
        stop_paise: stop,
        target_paise: target,
        sim_exit: simExit,                   // null = still open
        sim_exit_paise: simExitPaise,
        sim_pnl_paise: simPnL,
        if_held_live_paise: grossNow - costNow,
      };
    }

    return {
      symbol,
      live_ltp_paise: live?.ltp || null,
      day_open_paise: dayOpen,
      day_high_paise: ohlc?.day_high || null,
      day_low_paise:  ohlc?.day_low || null,
      day_close_paise: ohlc?.day_close || null,
      day_change_pct: (cur && dayOpen) ? +(((cur - dayOpen) / dayOpen) * 100).toFixed(2) : null,
      hypothetical,
    };
  });

  // ─── Summary totals ────────────────────────────────────────────────────
  const actualRealizedPnL = actualEnriched.reduce((s, a) => s + (a.pnl_net_paise || 0), 0);
  const actualLiveMtm = actualEnriched.reduce((s, a) => s + (a.live_mtm_paise || 0), 0);
  const actualPostExitWouldHave = actualEnriched.reduce((s, a) => s + (a.post_exit?.if_held_to_now_paise || 0), 0);
  const opusSimPnL = opusEnriched.reduce((s, o) => s + (o.hypothetical?.sim_pnl_paise || 0), 0);

  return {
    ok: true,
    date,
    summary: {
      actual_picks_count: actualEnriched.length,
      actual_realized_pnl_paise: actualRealizedPnL,
      actual_live_mtm_paise: actualLiveMtm,
      actual_total_pnl_paise: actualRealizedPnL + actualLiveMtm,
      // What we'd have made if we'd held the exited positions instead of cutting
      actual_if_held_post_exit_paise: actualPostExitWouldHave,
      opus_picks_count: opusEnriched.length,
      opus_sim_pnl_paise: opusSimPnL,
      delta_paise: (actualRealizedPnL + actualLiveMtm) - opusSimPnL,
    },
    actual_picks: actualEnriched,
    opus_picks: opusEnriched,
    generated_at: Date.now(),
  };
}

// Returns the latest verdict for today (morning OR most recent invalidator).
// Worker only stores the SYMBOL Opus picked; this reader joins with the live
// top_recommendation engine to attach a fresh trade plan (entry/stop/target/qty).
// ═══════════════════════════════════════════════════════════════════════════
async function getVerdictToday(db, env) {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const today = istNow.toISOString().slice(0, 10);

  // Latest verdict for today (any type)
  const verdict = await db.prepare(`
    SELECT * FROM daily_verdicts
    WHERE trade_date = ? ORDER BY composed_at DESC LIMIT 1
  `).bind(today).first();

  // Also fetch the original morning verdict if today's latest is an invalidator
  let morning = null;
  if (verdict && verdict.verdict_type === 'invalidator') {
    morning = await db.prepare(`
      SELECT id, decision, headline, narrative, recommended_symbol, composed_at
      FROM daily_verdicts WHERE trade_date=? AND verdict_type='morning'
      ORDER BY composed_at DESC LIMIT 1
    `).bind(today).first();
  }

  if (!verdict) {
    return {
      ok: false,
      reason: 'no-verdict-yet-today',
      hint: 'Morning verdict composes at 08:30 IST Mon-Fri. Use POST /run/compose on wealth-verdict worker to force.',
      date: today,
    };
  }

  // Parse JSON columns safely
  const safeParse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

  // Attach live plan from top_recommendation engine if Opus picked a symbol
  // (Single source of truth: plans are computed dynamically; worker stores only the pick.)
  let livePlan = safeParse(verdict.recommended_plan_json);  // fallback to stored
  if (!livePlan && verdict.recommended_symbol && verdict.decision === 'TRADE') {
    try {
      const fullRec = await getTopRecommendation(db, env);
      if (fullRec.ok) {
        // If engine's top pick == Opus's pick, use the engine's plan directly
        if (fullRec.plan && fullRec.plan.symbol === verdict.recommended_symbol) {
          livePlan = {
            symbol: fullRec.plan.symbol,
            entry_paise: Math.round((fullRec.plan.entry_price || 0) * 100),
            stop_paise: Math.round((fullRec.plan.stop_price || 0) * 100),
            target_paise: Math.round((fullRec.plan.target_price || 0) * 100),
            qty: fullRec.plan.qty,
            capital_deployed_paise: Math.round((fullRec.plan.capital_deployed || 0) * 100),
            rr_ratio: fullRec.plan.rr_ratio,
            stop_pct: fullRec.plan.stop_pct,
            target_pct: fullRec.plan.target_pct,
            net_loss_paise: Math.round((fullRec.plan.net_loss_rupees || 0) * 100),
            net_gain_paise: Math.round((fullRec.plan.net_gain_rupees || 0) * 100),
            composite_score: fullRec.plan.composite_score,
            tranche: fullRec.plan.tranche,
          };
        }
        // If Opus picked from alternatives, find it there
        else if (fullRec.alternatives) {
          const alt = fullRec.alternatives.find(a => a.symbol === verdict.recommended_symbol);
          if (alt) {
            // Only score+rationale from alts; plan needs separate computation
            livePlan = { symbol: alt.symbol, composite_score: alt.composite_score, tranche: alt.tranche, _note: 'alternative — full plan not pre-computed' };
          }
        }
      }
    } catch (e) {
      // Don't break the verdict UI if plan attach fails
    }
  }

  // INTRADAY PORTFOLIO MODE — picks array is the new primary output.
  // Each pick has its own plan; we attach live LTP for entry sizing.
  const picksArr = safeParse(verdict.picks_json) || [];
  const portfolioCapital = verdict.portfolio_capital_paise || 100000000; // ₹10,00,000 in paise

  // ─── Pull historical stats per pick from intraday_suitability ─────────
  // Opus's saved picks_json doesn't echo back the 90-day history — those are
  // computed at compose time from the suitability table. Re-fetch here so UI
  // can display them.
  const histBySymbol = {};
  if (picksArr.length > 0) {
    const symList = picksArr.map(p => p.symbol).filter(Boolean);
    const placeholders = symList.map(() => '?').join(',');
    if (symList.length > 0) {
      const histRows = (await db.prepare(`
        SELECT symbol, hit_2pct_rate, hit_3pct_rate, hit_5pct_rate,
               avg_open_to_high_pct, avg_open_to_low_pct, green_close_rate,
               avg_turnover_cr, hit_2pct_last_week, avg_up_last_week_pct, green_close_last_week
        FROM intraday_suitability WHERE symbol IN (${placeholders})
      `).bind(...symList).all().catch(() => ({ results: [] }))).results || [];
      for (const r of histRows) histBySymbol[r.symbol] = r;
    }
  }

  const enrichedPicks = [];
  for (const p of picksArr) {
    if (!p?.symbol) continue;
    // Compute share count + capital math from weight + live entry estimate
    let entryEstimatePaise = null;
    try {
      const r = await db.prepare(`
        SELECT close_paise FROM equity_eod WHERE symbol = ?
        ORDER BY trade_date DESC LIMIT 1
      `).bind(p.symbol).first();
      entryEstimatePaise = r?.close_paise || null;
    } catch {}

    const weightPct = p.weight_pct || 30;
    const capitalPaise = Math.round(portfolioCapital * weightPct / 100);
    const qty = entryEstimatePaise ? Math.floor(capitalPaise / entryEstimatePaise) : null;
    const stopPct = p.stop_pct || 1.0;
    const targetPct = p.target_pct || 3.0;
    const stopPaise = entryEstimatePaise ? Math.round(entryEstimatePaise * (1 - stopPct/100)) : null;
    const targetPaise = entryEstimatePaise ? Math.round(entryEstimatePaise * (1 + targetPct/100)) : null;
    const maxLossPaise = qty && entryEstimatePaise && stopPaise ? (entryEstimatePaise - stopPaise) * qty : null;
    const maxGainPaise = qty && entryEstimatePaise && targetPaise ? (targetPaise - entryEstimatePaise) * qty : null;

    // Attach historical stats from intraday_suitability for UI display
    const hist = histBySymbol[p.symbol] || {};
    enrichedPicks.push({
      ...p,
      live_entry_estimate_paise: entryEstimatePaise,    // last EOD as proxy for tomorrow's open
      capital_deployed_paise: capitalPaise,
      qty,
      stop_paise: stopPaise,
      target_paise: targetPaise,
      max_loss_paise: maxLossPaise,
      max_gain_paise: maxGainPaise,
      rr_ratio: stopPct > 0 ? +(targetPct / stopPct).toFixed(2) : null,
      // 90-day historical stats (now flowing through to UI)
      intraday_history: {
        hit_2pct_pct_of_days: hist.hit_2pct_rate,
        hit_3pct_pct_of_days: hist.hit_3pct_rate,
        hit_5pct_pct_of_days: hist.hit_5pct_rate,
        avg_open_to_high_pct: hist.avg_open_to_high_pct,
        avg_open_to_low_pct: hist.avg_open_to_low_pct,
        green_close_rate: hist.green_close_rate,
        avg_turnover_cr: hist.avg_turnover_cr,
        // Recency (last week)
        hit_2pct_last_week: hist.hit_2pct_last_week,
        avg_up_last_week_pct: hist.avg_up_last_week_pct,
        green_close_last_week: hist.green_close_last_week,
      },
      // MIS leverage simulation — same trade with 5× margin
      mis_5x_max_loss_paise: maxLossPaise ? maxLossPaise * 5 : null,
      mis_5x_max_gain_paise: maxGainPaise ? maxGainPaise * 5 : null,
    });
  }

  // Portfolio aggregates
  const totalCapital = enrichedPicks.reduce((s, p) => s + (p.capital_deployed_paise || 0), 0);
  const totalMaxLoss = enrichedPicks.reduce((s, p) => s + (p.max_loss_paise || 0), 0);
  const totalMaxGain = enrichedPicks.reduce((s, p) => s + (p.max_gain_paise || 0), 0);

  return {
    ok: true,
    date: today,
    verdict: {
      id: verdict.id,
      type: verdict.verdict_type,
      strategy_mode: verdict.strategy_mode || 'swing',
      decision: verdict.decision,
      headline: verdict.headline,
      narrative: verdict.narrative,
      // INTRADAY PORTFOLIO — primary output
      picks: enrichedPicks,
      portfolio_summary: {
        capital_paise: portfolioCapital,
        capital_deployed_paise: totalCapital,
        capital_deployed_pct: portfolioCapital ? +(totalCapital / portfolioCapital * 100).toFixed(1) : 0,
        max_portfolio_loss_paise: totalMaxLoss,
        max_portfolio_gain_paise: totalMaxGain,
        max_loss_pct_of_capital: portfolioCapital ? +(totalMaxLoss / portfolioCapital * 100).toFixed(2) : 0,
        max_gain_pct_of_capital: portfolioCapital ? +(totalMaxGain / portfolioCapital * 100).toFixed(2) : 0,
        // MIS 5× leverage simulation (informational only — paper trades remain at 1×)
        mis_5x_max_loss_paise: totalMaxLoss * 5,
        mis_5x_max_gain_paise: totalMaxGain * 5,
        mis_5x_loss_pct: +(totalMaxLoss * 5 / portfolioCapital * 100).toFixed(2),
        mis_5x_gain_pct: +(totalMaxGain * 5 / portfolioCapital * 100).toFixed(2),
        // Matches trader code: ₹30K = 3% on ₹10L (was ₹20K, bumped 2026-05-04 audit)
        daily_loss_limit_paise: 3000000,
        profit_lock_threshold_paise: 3000000,
      },
      // Backward-compat fields (single-pick UI)
      recommended_symbol: verdict.recommended_symbol,
      recommended_plan: livePlan,
      entry_window: verdict.entry_window,
      horizon: verdict.horizon,
      time_stop_days: verdict.time_stop_days,
      pre_event_exit: verdict.pre_event_exit,
      // Meta
      alternatives: safeParse(verdict.alternatives_json),
      context_snapshot: safeParse(verdict.context_snapshot_json),
      invalidator_reason: verdict.invalidator_reason,
      composed_at: verdict.composed_at,
      composed_by_model: verdict.composed_by_model,
      cost_paise: verdict.cost_paise,
      cached: !!verdict.cached,
    },
    morning_verdict: morning,
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=weekly_review_latest
// ═══════════════════════════════════════════════════════════════════════════
async function getLatestWeeklyReview(db) {
  const r = await db.prepare(`
    SELECT * FROM weekly_reviews ORDER BY week_start_date DESC LIMIT 1
  `).first();
  if (!r) return { ok: false, reason: 'no-weekly-review-yet' };
  let trades_summary = null;
  try { trades_summary = JSON.parse(r.trades_summary_json || 'null'); } catch {}
  return { ok: true, review: { ...r, trades_summary }, generated_at: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=autopsy_latest&limit=N
// ═══════════════════════════════════════════════════════════════════════════
async function getLatestAutopsies(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5'), 30);
  const rows = (await db.prepare(`
    SELECT trade_id, symbol, outcome, pnl_pct, hold_days, exit_reason,
           narrative, pattern_label, lessons_json, composed_at
    FROM paper_trade_autopsies ORDER BY composed_at DESC LIMIT ?
  `).bind(limit).all()).results || [];
  for (const r of rows) {
    try { r.lessons = JSON.parse(r.lessons_json || '[]'); } catch { r.lessons = []; }
    delete r.lessons_json;
  }
  return { ok: true, autopsies: rows, generated_at: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=auto_trader_state
// Live state of every auto-managed paper trade today.
// Used by Today UI Section 4: "Live Auto-Trader Positions"
// ═══════════════════════════════════════════════════════════════════════════
async function getAutoTraderState(db) {
  const istToday = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

  const positions = (await db.prepare(`
    SELECT pt.id, pt.symbol, pt.qty, pt.trader_state, pt.strategy_mode,
           pt.entry_paise, pt.stop_paise, pt.target_paise,
           pt.peak_price_paise, pt.trailing_stop_paise,
           pt.or_high_paise, pt.or_low_paise,
           pt.entry_at, pt.exit_at, pt.exit_paise, pt.exit_reason,
           pt.pnl_net_paise, pt.win_loss, pt.rationale,
           pt.trader_notes, pt.entry_attempts, pt.mode_promoted_at,
           pt.last_check_at
    FROM paper_trades pt
    WHERE pt.auto_managed=1 AND DATE(pt.created_at/1000, 'unixepoch') = ?
    ORDER BY pt.id ASC
  `).bind(istToday).all()).results || [];

  // Per-position: pull last 3 trader_decisions
  for (const p of positions) {
    const recent = (await db.prepare(`
      SELECT cron_phase, decision, ltp_paise, rationale, ts, composed_by_model
      FROM trader_decisions
      WHERE trade_id = ? OR (trade_id IS NULL AND symbol = ? AND trade_date = ?)
      ORDER BY ts DESC LIMIT 3
    `).bind(p.id, p.symbol, istToday).all().catch(() => ({ results: [] }))).results || [];
    p.recent_decisions = recent;
  }

  // Summary stats
  let totalDeployed = 0;
  let totalPnL = 0;
  const byState = {};
  const byMode = {};
  for (const p of positions) {
    const state = p.trader_state;
    const mode = p.strategy_mode || 'INTRADAY_DEFAULT';
    byState[state] = (byState[state] || 0) + 1;
    byMode[mode] = (byMode[mode] || 0) + 1;
    if (p.entry_paise && p.qty) totalDeployed += p.entry_paise * p.qty;
    if (p.pnl_net_paise) totalPnL += p.pnl_net_paise;
  }

  return {
    ok: true,
    today: istToday,
    positions,
    summary: {
      total_positions: positions.length,
      by_state: byState,
      by_mode: byMode,
      total_deployed_paise: totalDeployed,
      total_pnl_realized_paise: totalPnL,
    },
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=trader_timeline&hours=N
// Today's full execution timeline — every cron decision in chronological order.
// Used by Today UI Section 5: "Timeline"
// ═══════════════════════════════════════════════════════════════════════════
async function getTraderTimeline(db, url) {
  const hours = parseInt(url.searchParams.get('hours') || '24');
  const cutoffMs = Date.now() - hours * 3600000;
  const istToday = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

  // Combine trader_decisions + cron_run_log + system_alerts for the day
  const decisions = (await db.prepare(`
    SELECT 'decision' AS type, ts, cron_phase AS what, symbol, decision,
           rationale, ltp_paise, composed_by_model, cost_paise
    FROM trader_decisions
    WHERE trade_date = ? AND ts > ?
    ORDER BY ts DESC LIMIT 100
  `).bind(istToday, cutoffMs).all().catch(() => ({ results: [] }))).results || [];

  const cronFires = (await db.prepare(`
    SELECT 'cron' AS type, started_at AS ts, cron_name AS what, status,
           rows_written, error_message, duration_ms
    FROM cron_run_log
    WHERE started_at > ? AND cron_name LIKE 'wealth-trader:%'
    ORDER BY started_at DESC LIMIT 100
  `).bind(cutoffMs).all().catch(() => ({ results: [] }))).results || [];

  // Merge + sort chronologically (most recent first)
  const merged = [...decisions, ...cronFires].sort((a, b) => b.ts - a.ts).slice(0, 80);

  // Group by IST hour for UI rendering
  for (const m of merged) {
    const ist = new Date(m.ts + 5.5 * 3600000);
    m.ist_time = ist.toISOString().slice(11, 16);
    m.ist_hour = ist.toISOString().slice(11, 13);
  }

  return {
    ok: true,
    timeline: merged,
    counts: {
      decisions: decisions.length,
      cron_fires: cronFires.length,
    },
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=intelligence_audit
// Meta-audit: where might Opus be missing context? What data is stale?
// Used by Today UI Section 6: "Intelligence Gaps"
// ═══════════════════════════════════════════════════════════════════════════
async function getIntelligenceAudit(db) {
  const nowMs = Date.now();
  const ist = new Date(nowMs + 5.5 * 3600000);
  const istHour = ist.getUTCHours();
  const inMarketHours = istHour >= 9 && istHour < 16;

  // Critical data sources Opus relies on — check freshness
  const sources = [
    {
      name: 'Live LTP (Kite quotes)',
      query: `SELECT MAX(ts) AS last_ts FROM kite_quotes`,
      staleness_threshold_ms: inMarketHours ? 5 * 60 * 1000 : 4 * 3600 * 1000,
      severity: 'critical',
      used_by: 'wealth-trader entry_decision + price_monitor',
    },
    {
      name: 'Intraday 5-min bars',
      query: `SELECT MAX(ts) AS last_ts FROM intraday_bars WHERE trade_date >= date('now', '-1 days')`,
      staleness_threshold_ms: inMarketHours ? 30 * 60 * 1000 : 20 * 3600 * 1000,
      severity: 'high',
      used_by: 'breakout_trigger volume confirmation + ATR computation',
    },
    {
      name: 'Live India VIX',
      query: `SELECT MAX(ts) AS last_ts FROM india_vix_ticks`,
      staleness_threshold_ms: inMarketHours ? 15 * 60 * 1000 : 4 * 3600 * 1000,
      severity: 'high',
      used_by: 'regime guard + position_mgmt VIX-spike detection',
    },
    {
      name: 'Live sector indices',
      query: `SELECT strftime('%s', MAX(trade_date))*1000 AS last_ts FROM sector_indices`,
      staleness_threshold_ms: inMarketHours ? 30 * 60 * 1000 : 24 * 3600 * 1000,
      severity: 'medium',
      used_by: 'position_mgmt sector rotation check',
    },
    {
      name: 'Market breadth (advances/declines)',
      query: `SELECT MAX(ts) AS last_ts FROM breadth_data`,
      staleness_threshold_ms: inMarketHours ? 10 * 60 * 1000 : 4 * 3600 * 1000,
      severity: 'medium',
      used_by: 'position_mgmt market deterioration detection',
    },
    {
      name: 'Cross-asset (DXY, USDINR, Brent, US10Y)',
      query: `SELECT MAX(ts) AS last_ts FROM crossasset_ticks`,
      staleness_threshold_ms: inMarketHours ? 15 * 60 * 1000 : 6 * 3600 * 1000,
      severity: 'medium',
      used_by: 'pre-market compose + position_mgmt cross-asset signals',
    },
    {
      name: 'Option chain (Nifty PCR, IV)',
      query: `SELECT MAX(ts) AS last_ts FROM option_chain_snapshot`,
      staleness_threshold_ms: inMarketHours ? 5 * 60 * 1000 : 4 * 3600 * 1000,
      severity: 'medium',
      used_by: 'morning compose enrichment + position_mgmt PCR signal',
    },
    {
      name: 'News articles',
      // BUG FIX (May 5 2026 evening): real table is news_items, not news_articles.
      // intelligence_audit was reporting "no_data" silently because of wrong name.
      query: `SELECT MAX(published_at) AS last_ts FROM news_items`,
      staleness_threshold_ms: 30 * 60 * 1000,
      severity: 'medium',
      used_by: 'position_mgmt news velocity + autopsy context',
    },
    {
      name: 'Corp announcements',
      query: `SELECT MAX(ann_time) AS last_ts FROM corp_announcements`,
      staleness_threshold_ms: 4 * 3600 * 1000,
      severity: 'medium',
      used_by: 'morning compose material filings filter',
    },
    {
      name: 'Earnings calendar (results_calendar)',
      query: `SELECT strftime('%s', MAX(result_date))*1000 AS last_ts FROM results_calendar`,
      staleness_threshold_ms: 3 * 24 * 3600 * 1000,
      severity: 'high',
      used_by: 'morning compose hard-exclude (gap-risk filter)',
    },
    {
      name: 'Intraday-suitability table',
      query: `SELECT MAX(computed_at) AS last_ts FROM intraday_suitability`,
      staleness_threshold_ms: 36 * 3600 * 1000,
      severity: 'high',
      used_by: 'morning compose stock universe selection',
    },
    {
      name: 'Bulk + block deals',
      query: `SELECT strftime('%s', MAX(trade_date))*1000 AS last_ts FROM bulk_block_deals`,
      staleness_threshold_ms: 36 * 3600 * 1000,
      severity: 'low',
      used_by: 'morning compose whale-flow enrichment',
    },
  ];

  const results = [];
  for (const s of sources) {
    let lastTs = null;
    try {
      const r = await db.prepare(s.query).first();
      lastTs = r?.last_ts;
    } catch (e) { /* skip */ }
    const ageMs = lastTs ? nowMs - lastTs : null;
    const isStale = ageMs == null ? null : ageMs > s.staleness_threshold_ms;
    const ageMinutes = ageMs != null ? Math.round(ageMs / 60000) : null;
    results.push({
      name: s.name,
      severity: s.severity,
      used_by: s.used_by,
      last_update_ms: lastTs,
      age_minutes: ageMinutes,
      threshold_minutes: Math.round(s.staleness_threshold_ms / 60000),
      stale: isStale,
      status: lastTs == null ? 'no_data' : isStale ? 'stale' : 'fresh',
    });
  }

  // Decision quality — was today's morning compose well-fed?
  const morningVerdict = await db.prepare(`
    SELECT context_snapshot_json FROM daily_verdicts
    WHERE trade_date = date('now') AND verdict_type='morning' LIMIT 1
  `).first().catch(() => null);
  let dimsCovered = null;
  try {
    if (morningVerdict?.context_snapshot_json) {
      const ctx = JSON.parse(morningVerdict.context_snapshot_json);
      const dims = ctx.dim_health_pct || {};
      dimsCovered = Object.entries(dims).map(([d, p]) => ({ dim: d, pct: p, status: p > 50 ? 'live' : p > 10 ? 'partial' : 'dead' }));
    }
  } catch {}

  // Identify "decisions made on partial info" — Opus calls today
  const opusCallsToday = await db.prepare(`
    SELECT purpose, COUNT(*) AS n, SUM(cost_paise) AS total_paise
    FROM anthropic_usage WHERE date = date('now') AND model LIKE '%opus%'
    GROUP BY purpose ORDER BY n DESC
  `).all().catch(() => ({ results: [] }));

  const stale_count = results.filter(r => r.stale === true).length;
  const fresh_count = results.filter(r => r.stale === false).length;
  const critical_stale = results.filter(r => r.severity === 'critical' && r.stale === true).length;

  return {
    ok: true,
    in_market_hours: inMarketHours,
    summary: {
      total_sources: results.length,
      fresh: fresh_count,
      stale: stale_count,
      critical_stale,
      health_score_pct: Math.round((fresh_count / Math.max(1, results.length)) * 100),
    },
    sources: results,
    morning_verdict_dim_coverage: dimsCovered,
    opus_calls_today: opusCallsToday.results || [],
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=system_health
// Cron status + worker health + Anthropic spend + errors.
// Used by Today UI Section 7: "System Health"
// ═══════════════════════════════════════════════════════════════════════════
async function getSystemHealth(db) {
  const since24h = Date.now() - 24 * 3600000;
  const since1h = Date.now() - 1 * 3600000;

  // Cron success/failure last 24h
  const cronStats = (await db.prepare(`
    SELECT cron_name,
      COUNT(*) AS total,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      MAX(started_at) AS last_fire_ts
    FROM cron_run_log WHERE started_at > ?
    GROUP BY cron_name ORDER BY total DESC
  `).bind(since24h).all().catch(() => ({ results: [] }))).results || [];

  // Recent errors (last 24h)
  const recentErrors = (await db.prepare(`
    SELECT cron_name, error_message, started_at
    FROM cron_run_log
    WHERE status='failed' AND started_at > ?
    ORDER BY started_at DESC LIMIT 10
  `).bind(since24h).all().catch(() => ({ results: [] }))).results || [];

  // Active alerts
  const alerts = (await db.prepare(`
    SELECT COUNT(*) AS unread FROM system_alerts WHERE is_read=0
  `).first().catch(() => null))?.unread || 0;

  // Kite token state
  const kiteToken = await db.prepare(`
    SELECT user_name, is_active,
           (expires_at - strftime('%s','now')*1000) / 60000 AS minutes_remaining
    FROM kite_tokens WHERE is_active=1 ORDER BY id DESC LIMIT 1
  `).first().catch(() => null);

  // Anthropic spend
  const todaySpend = (await db.prepare(`
    SELECT SUM(cost_paise) AS p, COUNT(*) AS n FROM anthropic_usage
    WHERE date = date('now')
  `).first().catch(() => null));
  const monthSpend = (await db.prepare(`
    SELECT SUM(cost_paise) AS p FROM anthropic_usage
    WHERE date LIKE strftime('%Y-%m-%%', 'now')
  `).first().catch(() => null));

  return {
    ok: true,
    cron_health: {
      total_workers: cronStats.length,
      cron_fires_24h: cronStats.reduce((s, c) => s + (c.total || 0), 0),
      success_24h: cronStats.reduce((s, c) => s + (c.success || 0), 0),
      failed_24h: cronStats.reduce((s, c) => s + (c.failed || 0), 0),
      breakdown: cronStats.slice(0, 20),
    },
    recent_errors: recentErrors,
    alerts_unread: alerts,
    kite_token: kiteToken ? {
      user: kiteToken.user_name,
      active: !!kiteToken.is_active,
      minutes_remaining: kiteToken.minutes_remaining,
    } : null,
    anthropic_spend: {
      today_paise: todaySpend?.p || 0,
      today_calls: todaySpend?.n || 0,
      month_paise: monthSpend?.p || 0,
    },
    generated_at: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=eod_learning_audit&date=YYYY-MM-DD
//
// Self-learning attribution after each paper-trade day. 4 sections:
//   1. WHAT OPUS GOT RIGHT — top picks that won, why thesis held
//   2. OPPORTUNITY COST — top 10 candidates rejected, hypothetical P&L if picked
//   3. UNIVERSE WINNERS MISSED — day's big movers NOT in top picks, why missed
//   4. LOSERS — top 3 picks that lost, what Opus missed in data
//
// Cached per audit_date in eod_learning_audits. Sonnet writes the qualitative
// analysis (~₹3/audit). Code computes deterministic P&L.
// ═══════════════════════════════════════════════════════════════════════════
async function getEodLearningAudit(db, env, url) {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const requestedDate = url.searchParams.get('date') || ist.toISOString().slice(0, 10);
  const force = url.searchParams.get('force') === '1';

  // Cache check
  if (!force) {
    const cached = await db.prepare(`
      SELECT * FROM eod_learning_audits WHERE audit_date = ?
    `).bind(requestedDate).first();
    if (cached) {
      return {
        ok: true, audit_date: requestedDate, cached: true,
        ...buildAuditResponseFromRow(cached),
      };
    }
  }

  // Need: morning verdict + intraday bars + EOD prices for all picks/rejected/universe
  const verdict = await db.prepare(`
    SELECT * FROM daily_verdicts WHERE trade_date = ? AND verdict_type='morning'
    ORDER BY composed_at DESC LIMIT 1
  `).bind(requestedDate).first();

  if (!verdict) return { ok: false, reason: 'no-verdict-on-this-date', date: requestedDate };

  let picks = [], context = null, alternatives = null;
  try {
    picks = JSON.parse(verdict.picks_json || '[]');
    context = JSON.parse(verdict.context_snapshot_json || '{}');
    alternatives = JSON.parse(verdict.alternatives_json || '{}');
  } catch {}

  const top10Candidates = (context?.intraday_suitable_picks || []).slice(0, 10);
  const pickedSymbols = picks.map(p => p.symbol);
  const rejectedSetups = alternatives?.rejected_setups || [];

  // Compute today's actual price action per symbol from intraday_bars
  const allSymbols = [
    ...pickedSymbols,
    ...rejectedSetups.map(r => r.symbol),
    ...top10Candidates.map(c => c.symbol),
  ].filter(Boolean);
  const uniqueSymbols = [...new Set(allSymbols)];
  if (uniqueSymbols.length === 0) return { ok: false, reason: 'no-symbols-to-audit' };

  const placeholders = uniqueSymbols.map(() => '?').join(',');

  // ─── Fetch CHRONOLOGICAL bars (one row per bar, ordered by ts ASC) ───
  // This is the primary source for the path-aware simulator. We also keep
  // aggregate stats for headline display (open/high/low/close).
  const allBars = (await db.prepare(`
    SELECT symbol, ts, open_paise, high_paise, low_paise, close_paise, volume
    FROM intraday_bars
    WHERE symbol IN (${placeholders}) AND interval='5minute' AND trade_date=?
    ORDER BY symbol, ts ASC
  `).bind(...uniqueSymbols, requestedDate).all().catch(() => ({ results: [] }))).results || [];

  // Group bars by symbol for chronological walk; also compute aggregates
  const barsBySymbol = {};        // chronological array per symbol
  const aggBySymbol  = {};        // aggregate {day_open, day_high, day_low, day_close, day_volume, bars}
  for (const b of allBars) {
    if (!barsBySymbol[b.symbol]) barsBySymbol[b.symbol] = [];
    barsBySymbol[b.symbol].push(b);
  }
  for (const sym of Object.keys(barsBySymbol)) {
    const bs = barsBySymbol[sym];
    aggBySymbol[sym] = {
      day_open:   bs[0].open_paise,
      day_close:  bs[bs.length - 1].close_paise,
      day_high:   Math.max(...bs.map(x => x.high_paise || 0)),
      day_low:    Math.min(...bs.map(x => x.low_paise  || Number.MAX_SAFE_INTEGER)),
      day_volume: bs.reduce((s, x) => s + (x.volume || 0), 0),
      bars:       bs.length,
    };
  }

  // ─── SECTION 1: top picks — actual outcomes (path-aware) ──────────
  const section1 = [];
  for (const p of picks) {
    const bars = aggBySymbol[p.symbol];
    const chronoBars = barsBySymbol[p.symbol];
    if (!bars?.day_open) {
      section1.push({ symbol: p.symbol, error: 'no-bars-found', simulation_quality: 'no_bars' });
      continue;
    }
    const dayChangePct = +(((bars.day_close - bars.day_open) / bars.day_open) * 100).toFixed(2);
    const peakPct      = +(((bars.day_high  - bars.day_open) / bars.day_open) * 100).toFixed(2);
    const drawdownPct  = +(((bars.day_low   - bars.day_open) / bars.day_open) * 100).toFixed(2);
    // Path-aware replay: walks bars in time order, real breakout, 15:10 IST exit
    const sim = simulateTradeChronological(p, chronoBars);
    section1.push({
      symbol: p.symbol,
      weight_pct: p.weight_pct,
      rationale: p.rationale,
      bars: { open: bars.day_open / 100, high: bars.day_high / 100, low: bars.day_low / 100, close: bars.day_close / 100 },
      day_change_pct: dayChangePct,
      peak_pct: peakPct,
      drawdown_pct: drawdownPct,
      simulated: sim,
    });
  }

  // ─── SECTION 2: rejected from top 10 — opportunity cost ────────────
  const section2 = [];
  for (const r of rejectedSetups) {
    const bars = aggBySymbol[r.symbol];
    const chronoBars = barsBySymbol[r.symbol];
    if (!bars?.day_open) continue;
    const sim = simulateTradeChronological(
      { symbol: r.symbol, weight_pct: 30, stop_pct: 1.2, target_pct: 3.0 },
      chronoBars
    );
    section2.push({
      symbol: r.symbol,
      why_rejected: r.why_not,
      bars: { open: bars.day_open / 100, close: bars.day_close / 100, high: bars.day_high / 100 },
      peak_pct: +(((bars.day_high - bars.day_open) / bars.day_open) * 100).toFixed(2),
      day_change_pct: +(((bars.day_close - bars.day_open) / bars.day_open) * 100).toFixed(2),
      simulated_pnl_paise: sim.net_pnl_paise,
      simulation_quality: sim.simulation_quality,
      breakout_fired: sim.breakout_fired,
      rejection_was_correct: sim.net_pnl_paise <= 0,
    });
  }

  // ─── SECTION 3: universe winners NOT in top picks ──────────────────
  const universeMovers = (await db.prepare(`
    SELECT b.symbol,
           MIN(b.open_paise) AS o, MAX(b.high_paise) AS h, MIN(b.low_paise) AS l,
           (SELECT close_paise FROM intraday_bars b2 WHERE b2.symbol=b.symbol AND b2.trade_date=?
              ORDER BY ts DESC LIMIT 1) AS c
    FROM intraday_bars b
    WHERE b.trade_date=? AND b.interval='5minute'
    GROUP BY b.symbol
    HAVING o > 0 AND ((SELECT close_paise FROM intraday_bars b3 WHERE b3.symbol=b.symbol AND b3.trade_date=? ORDER BY ts DESC LIMIT 1) - o) * 100.0 / o >= 4
    LIMIT 30
  `).bind(requestedDate, requestedDate, requestedDate).all().catch(() => ({ results: [] }))).results || [];

  const top10Set = new Set(top10Candidates.map(c => c.symbol));
  const section3 = [];
  for (const m of universeMovers) {
    if (top10Set.has(m.symbol)) continue;
    const dayPct = +(((m.c - m.o) / m.o) * 100).toFixed(2);
    if (dayPct < 4) continue;
    // Was it in our suitability table at all?
    const inSuitability = await db.prepare(`SELECT 1 FROM intraday_suitability WHERE symbol = ?`).bind(m.symbol).first().catch(() => null);
    section3.push({
      symbol: m.symbol,
      day_change_pct: dayPct,
      hypothetical_pnl_at_30pct_capital: Math.round((m.c - m.o) * Math.floor(30000000 / m.o)),
      in_intraday_suitability: !!inSuitability,
      gap_type: inSuitability ? 'IN_UNIVERSE_BUT_NOT_TOP_10_RANK' : 'NOT_IN_UNIVERSE_AT_ALL',
    });
  }
  section3.sort((a, b) => b.day_change_pct - a.day_change_pct);
  const top10MissedWinners = section3.slice(0, 8);

  // ─── SECTION 4: top 3 losers — what was missed ────────────────────
  const section4 = section1.filter(s => s.simulated && s.simulated.net_pnl_paise < 0).map(s => ({
    symbol: s.symbol,
    actual_loss_paise: s.simulated.net_pnl_paise,
    exit_reason: s.simulated.exit_reason,
    rationale_at_pick: s.rationale,
    actual_action: { peak_pct: s.peak_pct, drawdown_pct: s.drawdown_pct, close: s.bars.close },
  }));

  // ─── SELF-LEARNING ENRICHMENT (May 6 2026) ─────────────────────────────
  // Owner asked: "Is the system self-learning without gaps? Is the self-learning
  // breaking when I am manually ingesting logics like we did today? In scenarios
  // like today, the entire trail of what we did needs to be used for self-learning."
  //
  // CRITICAL: today the owner overrode Opus's picks AND there was a race
  // condition that created phantom -₹3,931 P&L on never-entered trades. If we
  // feed THIS to Sonnet without context, skill% gets corrupted.
  //
  // Three enrichments:
  // 1. Read pick_overrides — preserves Opus original vs what owner picked
  // 2. Read audit_findings (the new cron-collected bug log) — Sonnet sees
  //    the day's bugs/gaps separately from trade outcomes
  // 3. Detect phantom exits (trader_state=SKIPPED with non-zero pnl) — flag
  //    them as system_bug, NOT trade_outcome, in skill% calc
  // ───────────────────────────────────────────────────────────────────────

  // (1) Override history — does the date have a manual override?
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pick_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      overridden_at INTEGER NOT NULL,
      original_picks_json TEXT,
      new_picks_json TEXT,
      override_reason TEXT,
      overridden_by TEXT
    )
  `).run().catch(() => {});

  const overrideRow = await db.prepare(`
    SELECT * FROM pick_overrides WHERE trade_date=? ORDER BY id DESC LIMIT 1
  `).bind(requestedDate).first().catch(() => null);
  let overrideContext = null;
  if (overrideRow) {
    let origPicks = [];
    let newPicks = [];
    try { origPicks = JSON.parse(overrideRow.original_picks_json || '[]'); } catch {}
    try { newPicks = JSON.parse(overrideRow.new_picks_json || '[]'); } catch {}
    overrideContext = {
      had_override: true,
      original_opus_picks: origPicks.map(p => p.symbol || p),
      owner_chose_picks: newPicks.map(p => p.symbol || p),
      reason: overrideRow.override_reason,
      overridden_by: overrideRow.overridden_by,
      overridden_at_ist: new Date(overrideRow.overridden_at + 5.5*3600000).toISOString().replace('T',' ').slice(0, 19),
    };
  }

  // (2) Audit findings for the date — bugs/gaps detected by cron during the day
  const todaysFindings = (await db.prepare(`
    SELECT category, severity, layer, title, detail, proposed_fix
    FROM audit_findings WHERE trade_date=?
    ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    LIMIT 20
  `).bind(requestedDate).all().catch(() => ({ results: [] }))).results || [];

  // (3) Detect phantom exits in section1 — trades marked SKIPPED with non-zero pnl
  // should be EXCLUDED from skill% calc (they're system_bug residue, not real outcomes)
  const phantomSymbols = section1.filter(s =>
    s.simulated && s.simulated.error === undefined && s.simulated.exit_reason === undefined
  ).map(s => s.symbol);  // (phantom exits stay as 'simulated' but we tag them)

  // Recompute skill-eligible vs phantom-tagged for honest accounting
  const sectionEligible = [];
  const sectionPhantom = [];
  // Cross-reference paper_trades for this date — if trader_state='SKIPPED' AND
  // pnl_net_paise != 0, it's a phantom exit (race condition residue from F3 bug)
  const phantomCheck = (await db.prepare(`
    SELECT symbol FROM paper_trades
    WHERE auto_managed=1 AND DATE(created_at/1000,'unixepoch')=?
      AND trader_state IN ('SKIPPED','ABANDONED')
      AND pnl_net_paise IS NOT NULL AND pnl_net_paise != 0
  `).bind(requestedDate).all().catch(() => ({ results: [] }))).results || [];
  const phantomSet = new Set(phantomCheck.map(r => r.symbol));
  for (const s of section1) {
    if (phantomSet.has(s.symbol)) sectionPhantom.push(s);
    else sectionEligible.push(s);
  }

  // ─── Sonnet narrative — qualitative analysis with lessons ──────────
  let sonnetText = null, sonnetCost = 0, modelId = 'none';
  try {
    if (env?.ANTHROPIC_API_KEY) {
      const { callSonnet } = await import('./_lib/anthropic.js');
      const sys = `You are a trading-system auditor reviewing a paper-trade day. CRITICAL: distinguish DATA-DRIVEN signals (engine could have foreseen) from PURE LUCK (random variance, not predictable from data). This separation is what makes the engine improvable.

You are now also given (a) override_context if owner manually replaced Opus's picks, and (b) system_bugs_today (cron-detected anomalies). DO NOT confuse system bugs with trade outcomes — phantom exits from race conditions are NOT real losses, they are software defects to be flagged separately.

Output STRICT JSON.

Schema:
{
  "what_engine_got_RIGHT": "1-2 sentences. Picks where Opus's reasoning held up. Skill-eligible only — exclude phantom exits.",
  "what_engine_MISSED": "1-2 sentences. Stocks that won but weren't picked, OR rejected stocks that would have won. WHY the engine missed?",
  "what_engine_LEARNED": "1-2 sentences. Concrete pattern from today that should improve tomorrow's selection.",
  "what_was_LUCK": "1-2 sentences. RANDOM outcomes — luck not data-driven.",
  "what_was_SYSTEM_BUG": "1-2 sentences. Anything in system_bugs_today array that materially affected the day. SEPARATE from skill calculation.",
  "owner_override_assessment": "1-2 sentences. ONLY if override_context.had_override is true: did owner-override outperform what Opus would have done? Praise or critique honestly. NULL if no override.",
  "tuning_suggestions": [
    "concrete-changes-3-to-5-items, each citing a specific gap. Reference findings IDs from system_bugs_today when relevant."
  ],
  "key_lesson_for_tomorrow": "1 sentence — single most important takeaway",
  "engine_skill_pct": "0-100. EXCLUDE phantom exits + system bugs from this calc. Of skill-eligible trades only, what % was attributable to engine SKILL vs LUCK?",
  "data_quality_pct": "0-100. How much can we trust today's signal for forward inference? If 6/9 dim_health <10%, this is low. If override_context exists + outcome differs materially, this is also low."
}

Rules:
- Be RUTHLESS on luck attribution. Most short-period results are mostly luck.
- "LEARNED" must cite a SPECIFIC engine change. "Be more careful" is not a lesson.
- "Tuning suggestions" must be implementable.
- "engine_skill_pct" — be conservative. EXCLUDE phantom_exits from numerator AND denominator.
- If override_context exists, calc owner_picks_pnl vs opus_picks_pnl_counterfactual and assess.
- Reference system_bugs_today titles in your narrative — owner needs to see Sonnet acknowledged them.`;

      const userPrompt = `Audit data for ${requestedDate}:

═══ OVERRIDE CONTEXT (manual intervention) ═══
${JSON.stringify(overrideContext || { had_override: false }, null, 2)}

═══ SYSTEM BUGS DETECTED TODAY (cron audit) ═══
${todaysFindings.length > 0 ? JSON.stringify(todaysFindings, null, 2) : '(none — clean day)'}

═══ PHANTOM EXITS (race-condition residue, EXCLUDE from skill calc) ═══
${sectionPhantom.length > 0 ? JSON.stringify(sectionPhantom.map(s => ({ symbol: s.symbol, fake_pnl: s.simulated?.net_pnl_paise })), null, 2) : '(none)'}

═══ SKILL-ELIGIBLE TRADES (use for skill_pct denominator) ═══
${JSON.stringify(sectionEligible, null, 2)}

═══ Section 2 (rejected from top 10) ═══
${JSON.stringify(section2, null, 2)}

═══ Section 3 (universe winners we missed) ═══
${JSON.stringify(top10MissedWinners.slice(0, 5), null, 2)}

═══ Section 4 (top 3 losers) ═══
${JSON.stringify(section4, null, 2)}

Write the audit JSON. Be honest about today's degraded data quality if applicable.`;
      const result = await callSonnet(env, {
        prompt: userPrompt, system: sys, max_tokens: 800,
        purpose: 'eod_learning_audit', worker: 'pages-trading',
      });
      sonnetText = result.text;
      sonnetCost = result.cost_paise || 0;
      modelId = result.model_id;
    }
  } catch (e) {
    sonnetText = `(audit failed: ${(e.message || '').slice(0, 200)})`;
  }

  let sonnetParsed = null;
  if (sonnetText) {
    const cleaned = sonnetText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    try { sonnetParsed = JSON.parse(cleaned); }
    catch { try { const m = cleaned.match(/\{[\s\S]*\}/); if (m) sonnetParsed = JSON.parse(m[0]); } catch {} }
  }

  // Persist + provenance metrics
  const totalRealizedPnl = section1.reduce((s, x) => s + (x.simulated?.net_pnl_paise || 0), 0);
  const totalRejectedPnl = section2.reduce((s, x) => s + (x.simulated_pnl_paise || 0), 0);
  const correctCount     = section1.filter(s => s.simulated?.net_pnl_paise > 0).length;
  const bestMissed       = top10MissedWinners[0];
  // Honesty: count picks where the breakout actually fired vs SKIPPED
  const breakoutFiredCount = section1.filter(s => s.simulated?.breakout_fired === true).length;
  const skippedCount       = section1.filter(s => s.simulated?.exit_reason === 'SKIPPED_NO_BREAKOUT').length;
  const noBarsCount        = section1.filter(s => s.simulated?.simulation_quality === 'no_bars').length;
  // Aggregate simulation quality: chronological if all picks had real bars + chronological replay
  const allChronological = section1.every(s => s.simulated?.simulation_quality === 'replayed_chronological');
  const provenanceQuality = noBarsCount === picks.length
      ? 'no_bars'
      : allChronological
        ? 'replayed_chronological'
        : 'partial';

  try {
    await db.prepare(`
      INSERT OR REPLACE INTO eod_learning_audits
        (audit_date, verdict_id, picks_correct_count, picks_total,
         total_realized_pnl_paise, total_hypothetical_top10_pnl_paise,
         best_universe_winner_symbol, best_universe_winner_pct,
         intelligence_gaps_json, sonnet_narrative, sonnet_lessons_json,
         composed_at, cost_paise)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      requestedDate, verdict.id, correctCount, picks.length,
      totalRealizedPnl, totalRealizedPnl + totalRejectedPnl,
      bestMissed?.symbol || null, bestMissed?.day_change_pct || null,
      JSON.stringify({ section_1: section1, section_2: section2, section_3: top10MissedWinners, section_4: section4 }),
      sonnetText,
      JSON.stringify(sonnetParsed),
      Date.now(), sonnetCost,
    ).run();
  } catch {}

  return {
    ok: true,
    audit_date: requestedDate,
    cached: false,
    summary: {
      picks_correct: correctCount,
      picks_total: picks.length,
      realized_pnl_paise: totalRealizedPnl,
      hypothetical_top10_pnl_paise: totalRealizedPnl + totalRejectedPnl,
      best_missed_winner: bestMissed,
      // Honesty fields — UI surfaces these to distinguish replay quality
      simulation_quality: provenanceQuality,        // 'replayed_chronological' | 'partial' | 'no_bars'
      breakouts_fired: breakoutFiredCount,
      skipped_no_breakout: skippedCount,
      picks_with_no_bars: noBarsCount,
      execution_provenance: 'replay_only',          // 'live_execution' set by trader path; 'replay_only' is EOD audit
      fill_model: 'idealized_chronological',        // future: 'realistic_with_slippage'
    },
    sections: {
      what_engine_got_right: section1.filter(s => s.simulated?.net_pnl_paise > 0),
      rejected_opportunity_cost: section2,
      universe_winners_missed: top10MissedWinners,
      losers_what_opus_missed: section4,
    },
    sonnet_attribution: sonnetParsed,
    sonnet_raw: sonnetText,
    cost_paise: sonnetCost,
    composed_by: modelId,
    generated_at: Date.now(),
  };
}

// Helper — simulate system trade against today's bars (used by EOD audit)
// ─────────────────────────────────────────────────────────────────────────────
// LEGACY simulator — aggregate min/max, NOT path-aware. Kept for backwards
// compat ONLY where chronological bars unavailable. Marked `simulation_quality:
// 'aggregate_idealized'` so UI can flag it. Use simulateTradeChronological()
// for trustworthy P&L.
// ─────────────────────────────────────────────────────────────────────────────
function simulateTrade(pick, bars) {
  if (!bars?.day_open || !bars?.day_high || !bars?.day_low || !bars?.day_close) {
    return { error: 'insufficient bars', simulation_quality: 'no_bars' };
  }
  const stopPct = pick.stop_pct || 1.2;
  const targetPct = pick.target_pct || 3.0;
  const entryEstimate = bars.day_open;  // approximate breakout entry near open
  const stopPrice = entryEstimate * (1 - stopPct/100);
  const targetPrice = entryEstimate * (1 + targetPct/100);
  let exitPrice, exitReason;
  if (bars.day_low <= stopPrice) { exitPrice = stopPrice; exitReason = 'STOP_HIT'; }
  else if (bars.day_high >= targetPrice) { exitPrice = targetPrice; exitReason = 'TARGET_HIT'; }
  else { exitPrice = bars.day_close; exitReason = 'CLOSE_AT_HARD_EXIT'; }
  const weight = pick.weight_pct || 30;
  const capital = 100000000 * weight / 100;
  const qty = Math.floor(capital / entryEstimate);
  const grossPnL = (exitPrice - entryEstimate) * qty;
  const fees = entryEstimate * qty * 0.003;
  return {
    entry_paise: entryEstimate,
    exit_paise: Math.round(exitPrice),
    exit_reason: exitReason,
    qty,
    capital_deployed_paise: Math.round(capital),
    gross_pnl_paise: Math.round(grossPnL),
    fees_paise: Math.round(fees),
    net_pnl_paise: Math.round(grossPnL - fees),
    simulation_quality: 'aggregate_idealized',
    breakout_fired: null,  // unknown — no chronological data
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHRONOLOGICAL simulator — walks 5-min bars in time order.
// Honest replay of trader's strategy:
//   1. Computes Opening Range high = MAX(high_paise) over first 15 min (3 bars)
//   2. Watches for breakout: first bar in 09:30-10:30 IST where close > OR_high × 1.001
//      → if no breakout fires before 10:30 IST, returns SKIPPED (no entry)
//   3. After entry, walks bars maintaining peak + trailing stop
//   4. Exits on FIRST event by time:
//        - low ≤ stop_price        → STOP_HIT
//        - high ≥ target_price     → TARGET_HIT
//        - low ≤ trailing_stop     → TRAIL_HIT
//        - timestamp ≥ 15:10 IST   → HARD_EXIT (intraday strategy mode)
//   5. Realistic Zerodha intraday MIS fees: 0.04% × (entry + exit) × qty
//
// `bars` = chronological array of {ts, open_paise, high_paise, low_paise, close_paise, volume}
// ─────────────────────────────────────────────────────────────────────────────
function simulateTradeChronological(pick, bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 4) {
    return { error: 'insufficient bars', simulation_quality: 'no_bars', breakout_fired: false };
  }
  const stopPct   = pick.stop_pct   || 1.2;
  const targetPct = pick.target_pct || 3.0;
  const trailPct  = opts.trail_pct  || pick.trail_pct || 0.8;   // INTRADAY_DEFAULT
  const weight    = pick.weight_pct || 30;
  const capital   = 100000000 * weight / 100;

  // Helper: convert bar.ts (ms UTC) → IST hour:minute integer for window checks
  const istHM = (ts) => {
    const d = new Date(ts + 5.5 * 3600000);
    return d.getUTCHours() * 100 + d.getUTCMinutes();
  };

  // ─── Step 1: Compute Opening Range = MAX high of first 3 bars (09:15-09:30) ───
  // First 3 5-min bars cover 09:15 → 09:30 IST. Defensive: take whatever bars are
  // present in the 09:15-09:30 window.
  const orBars = bars.filter(b => {
    const hm = istHM(b.ts);
    return hm >= 915 && hm < 930;
  });
  if (orBars.length === 0) {
    return { error: 'no opening-range bars', simulation_quality: 'no_or_bars', breakout_fired: false };
  }
  const orHigh = Math.max(...orBars.map(b => b.high_paise || 0));
  const orLow  = Math.min(...orBars.map(b => b.low_paise  || Number.MAX_SAFE_INTEGER));
  if (!orHigh || orHigh < 100) {
    return { error: 'invalid OR high', simulation_quality: 'no_or_bars', breakout_fired: false };
  }

  // ─── Step 2: Find breakout entry in 09:30-10:30 IST window ───
  // Breakout: first bar where close_paise > orHigh × 1.001
  const breakoutThreshold = orHigh * 1.001;
  let entryBar = null, entryIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const hm = istHM(b.ts);
    if (hm < 930) continue;          // not yet in entry window
    if (hm >= 1030) break;           // entry window closed
    if ((b.close_paise || 0) > breakoutThreshold) {
      entryBar = b;
      entryIdx = i;
      break;
    }
  }

  if (!entryBar) {
    // Real trader would have SKIPPED — no fake P&L attributed
    return {
      simulation_quality: 'replayed_chronological',
      breakout_fired: false,
      exit_reason: 'SKIPPED_NO_BREAKOUT',
      or_high_paise: Math.round(orHigh),
      or_low_paise: Math.round(orLow),
      entry_paise: null,
      exit_paise: null,
      qty: 0,
      capital_deployed_paise: 0,
      gross_pnl_paise: 0,
      fees_paise: 0,
      net_pnl_paise: 0,
    };
  }

  // ─── Step 3: Entry mechanics ───
  const entryPrice = entryBar.close_paise;       // fill on breakout bar's close
  const stopPrice  = entryPrice * (1 - stopPct/100);
  const targetPrice= entryPrice * (1 + targetPct/100);
  const qty        = Math.floor(capital / entryPrice);
  if (qty <= 0) {
    return { error: 'qty=0 (entry_price too high for weight)', simulation_quality: 'replayed_chronological', breakout_fired: true };
  }

  // ─── Step 4: Walk forward chronologically — exit on first trigger ───
  let peakPrice = entryPrice;
  let trailingStop = entryPrice * (1 - trailPct/100);
  let exitBar = null, exitPrice = null, exitReason = null;

  for (let j = entryIdx + 1; j < bars.length; j++) {
    const b = bars[j];
    const hm = istHM(b.ts);

    // Update peak + trailing stop using THIS bar's high
    if ((b.high_paise || 0) > peakPrice) {
      peakPrice = b.high_paise;
      trailingStop = peakPrice * (1 - trailPct/100);
    }

    // Hard exit at 15:10 IST — intraday strategy mode (default)
    if (hm >= 1510) {
      exitBar = b;
      exitPrice = b.close_paise;     // exit at this bar's close
      exitReason = 'HARD_EXIT_1510';
      break;
    }

    // Stop hit (most conservative: check first within bar)
    if ((b.low_paise || 0) <= stopPrice) {
      exitBar = b;
      exitPrice = stopPrice;
      exitReason = 'STOP_HIT';
      break;
    }
    // Target hit
    if ((b.high_paise || 0) >= targetPrice) {
      exitBar = b;
      exitPrice = targetPrice;
      exitReason = 'TARGET_HIT';
      break;
    }
    // Trailing stop hit (only meaningful if peak > entry)
    if (peakPrice > entryPrice && (b.low_paise || 0) <= trailingStop) {
      exitBar = b;
      exitPrice = trailingStop;
      exitReason = 'TRAIL_HIT';
      break;
    }
  }

  // No exit triggered within bars (e.g., bars truncated before 15:10) → use last bar's close
  if (!exitBar) {
    exitBar = bars[bars.length - 1];
    exitPrice = exitBar.close_paise;
    exitReason = 'BARS_EXHAUSTED';
  }

  // ─── Step 5: Realistic Zerodha intraday MIS fee model ───
  // Brokerage capped ₹20/side, STT 0.025% sell-side, exchange ~0.00322% × 2,
  // GST 18%, stamp 0.003% buy-side. Round-trip ≈ 0.04% of (buy_turnover + sell_turnover).
  const buyTurnover  = entryPrice * qty;
  const sellTurnover = exitPrice * qty;
  const brokerage    = 4000;  // ₹40 in paise (₹20 × 2 sides, capped)
  const sttSell      = sellTurnover * 0.00025;
  const exchangeBoth = (buyTurnover + sellTurnover) * 0.0000322;
  const stampBuy     = buyTurnover * 0.00003;
  const gst          = (brokerage + exchangeBoth) * 0.18;
  const fees         = brokerage + sttSell + exchangeBoth + stampBuy + gst;

  const grossPnL = (exitPrice - entryPrice) * qty;
  const netPnL   = grossPnL - fees;

  return {
    simulation_quality: 'replayed_chronological',
    breakout_fired: true,
    or_high_paise:  Math.round(orHigh),
    or_low_paise:   Math.round(orLow),
    entry_ts:       entryBar.ts,
    entry_paise:    Math.round(entryPrice),
    exit_ts:        exitBar.ts,
    exit_paise:     Math.round(exitPrice),
    exit_reason:    exitReason,
    qty,
    peak_paise:     Math.round(peakPrice),
    capital_deployed_paise: Math.round(capital),
    gross_pnl_paise:        Math.round(grossPnL),
    fees_paise:             Math.round(fees),
    net_pnl_paise:          Math.round(netPnL),
    bars_walked:    Math.max(0, (exitBar ? bars.indexOf(exitBar) : bars.length - 1) - entryIdx),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/trading?action=monthly_learning_trail&days=30
//
// Returns last 30 days of EOD audits as a compounding learning trail.
// Used by Today UI section to surface week-over-week patterns + cumulative P&L
// + recurring intelligence gaps.
// ═══════════════════════════════════════════════════════════════════════════
async function getMonthlyLearningTrail(db, url) {
  const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90);

  const audits = (await db.prepare(`
    SELECT audit_date, picks_correct_count, picks_total,
           total_realized_pnl_paise, total_hypothetical_top10_pnl_paise,
           best_universe_winner_symbol, best_universe_winner_pct,
           sonnet_lessons_json, composed_at, cost_paise
    FROM eod_learning_audits
    WHERE audit_date >= date('now', '-${days} days')
    ORDER BY audit_date DESC
  `).all()).results || [];

  // Aggregate stats
  const totalDays = audits.length;
  const winningDays = audits.filter(a => (a.total_realized_pnl_paise || 0) > 0).length;
  const losingDays = audits.filter(a => (a.total_realized_pnl_paise || 0) < 0).length;
  const cumulativePnL = audits.reduce((s, a) => s + (a.total_realized_pnl_paise || 0), 0);
  const cumulativeOpportunityPnL = audits.reduce((s, a) => s + (a.total_hypothetical_top10_pnl_paise || 0), 0);
  const totalPicksCorrect = audits.reduce((s, a) => s + (a.picks_correct_count || 0), 0);
  const totalPicks = audits.reduce((s, a) => s + (a.picks_total || 0), 0);
  const totalAuditCost = audits.reduce((s, a) => s + (a.cost_paise || 0), 0);

  // Best/worst days
  const bestDay = audits.reduce((b, a) => (a.total_realized_pnl_paise || 0) > (b?.total_realized_pnl_paise || -Infinity) ? a : b, null);
  const worstDay = audits.reduce((w, a) => (a.total_realized_pnl_paise || 0) < (w?.total_realized_pnl_paise || Infinity) ? a : w, null);

  // Recurring lessons — accumulate tuning suggestions across days
  const allTuningSuggestions = [];
  const allMissedWinners = [];
  for (const a of audits) {
    try {
      const lessons = JSON.parse(a.sonnet_lessons_json || 'null');
      if (lessons?.tuning_suggestions) allTuningSuggestions.push(...lessons.tuning_suggestions);
    } catch {}
    if (a.best_universe_winner_symbol) {
      allMissedWinners.push({
        date: a.audit_date,
        symbol: a.best_universe_winner_symbol,
        pct: a.best_universe_winner_pct,
      });
    }
  }

  // Day-by-day micro-cards for trail visualization
  const trail = audits.map(a => {
    let lessons = null;
    try { lessons = JSON.parse(a.sonnet_lessons_json || 'null'); } catch {}
    const pnl = a.total_realized_pnl_paise || 0;
    return {
      date: a.audit_date,
      pnl_paise: pnl,
      pnl_pct: +(pnl / 100000000 * 100).toFixed(2),  // % of ₹10L
      picks_correct: a.picks_correct_count,
      picks_total: a.picks_total,
      best_missed: a.best_universe_winner_symbol
        ? { symbol: a.best_universe_winner_symbol, pct: a.best_universe_winner_pct }
        : null,
      key_lesson: lessons?.key_lesson_for_tomorrow || null,
      day_class: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat',
    };
  });

  return {
    ok: true,
    days_audited: totalDays,
    period_days: days,
    summary: {
      winning_days: winningDays,
      losing_days: losingDays,
      flat_days: totalDays - winningDays - losingDays,
      win_rate_pct: totalDays > 0 ? +(winningDays / totalDays * 100).toFixed(1) : 0,
      cumulative_pnl_paise: cumulativePnL,
      cumulative_pnl_pct: +(cumulativePnL / 100000000 * 100).toFixed(2),
      hypothetical_if_all_top10_picked_paise: cumulativeOpportunityPnL,
      opportunity_cost_paise: cumulativeOpportunityPnL - cumulativePnL,
      pick_accuracy: totalPicks > 0 ? +(totalPicksCorrect / totalPicks * 100).toFixed(1) : 0,
      total_audit_cost_paise: totalAuditCost,
      avg_audit_cost_paise: totalDays > 0 ? Math.round(totalAuditCost / totalDays) : 0,
    },
    best_day: bestDay ? { date: bestDay.audit_date, pnl_paise: bestDay.total_realized_pnl_paise } : null,
    worst_day: worstDay ? { date: worstDay.audit_date, pnl_paise: worstDay.total_realized_pnl_paise } : null,
    recent_missed_winners: allMissedWinners.slice(0, 8),
    recent_tuning_suggestions: allTuningSuggestions.slice(0, 12),
    trail,
    generated_at: Date.now(),
  };
}

function buildAuditResponseFromRow(row) {
  let gaps = null, lessons = null;
  try { gaps = JSON.parse(row.intelligence_gaps_json || 'null'); } catch {}
  try { lessons = JSON.parse(row.sonnet_lessons_json || 'null'); } catch {}
  return {
    summary: {
      picks_correct: row.picks_correct_count,
      picks_total: row.picks_total,
      realized_pnl_paise: row.total_realized_pnl_paise,
      hypothetical_top10_pnl_paise: row.total_hypothetical_top10_pnl_paise,
      best_missed_winner: row.best_universe_winner_symbol
        ? { symbol: row.best_universe_winner_symbol, day_change_pct: row.best_universe_winner_pct }
        : null,
    },
    sections: gaps ? {
      what_engine_got_right: gaps.section_1?.filter(s => s.simulated?.net_pnl_paise > 0) || [],
      rejected_opportunity_cost: gaps.section_2 || [],
      universe_winners_missed: gaps.section_3 || [],
      losers_what_opus_missed: gaps.section_4 || [],
    } : null,
    sonnet_attribution: lessons,
    sonnet_raw: row.sonnet_narrative,
    composed_by: 'cached',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MORNING BRIEFING — pre-market story compiled from all live data
// ═══════════════════════════════════════════════════════════════════════════
async function getMorningBriefing(db) {
  // Try the persisted briefing first (compiled by orchestrator at 08:30 IST)
  const persisted = await db.prepare(
    `SELECT * FROM daily_briefings ORDER BY briefing_date DESC LIMIT 1`
  ).first();

  // Compose fresh data EVERY time (cheap) so user always sees current state
  const niftyRow = await db.prepare(
    `SELECT * FROM indices_eod WHERE index_name='NIFTY 50' ORDER BY trade_date DESC LIMIT 1`
  ).first();
  const niftyPrev = await db.prepare(
    `SELECT close_paise FROM indices_eod WHERE index_name='NIFTY 50' AND trade_date < (SELECT MAX(trade_date) FROM indices_eod WHERE index_name='NIFTY 50') ORDER BY trade_date DESC LIMIT 1`
  ).first();
  const vixRow = await db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first();
  const fiiRow = await db.prepare(`SELECT * FROM fii_dii_daily WHERE segment='cash' ORDER BY trade_date DESC LIMIT 1`).first();

  const giftRow = await db.prepare(`SELECT * FROM gift_nifty_ticks ORDER BY ts DESC LIMIT 1`).first();

  // Cross-asset latest
  const cross = (await db.prepare(`
    SELECT c1.* FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks GROUP BY asset_code) c2
      ON c1.asset_code=c2.asset_code AND c1.ts=c2.m
    WHERE c1.asset_code IN ('DXY','BRENT','US10Y','GOLD','VIX_US','NIKKEI','HSI')
  `).all()).results || [];

  // Sector rotation top 3 + bottom 3
  let sectorTop = null;
  try {
    const srot = await getSectorRotation(db, new URL('http://x/?periodDays=20'));
    if (srot.sectors_ranked) {
      sectorTop = {
        leaders: srot.sectors_ranked.slice(0, 3),
        laggards: srot.sectors_ranked.slice(-3).reverse(),
        nifty_return: srot.nifty_return_pct,
      };
    }
  } catch {}

  // Bond direction
  let bond = null;
  try {
    const bd = await getBondDirection(db);
    bond = bd.summary;
  } catch {}

  // Material announcements last 24h
  const announcements = (await db.prepare(`
    SELECT symbol, subject, materiality_score, sentiment_score, ann_time
    FROM corp_announcements
    WHERE ann_time > ? AND materiality_score > 0.6
    ORDER BY materiality_score DESC LIMIT 5
  `).bind(Date.now() - 86400000).all()).results || [];

  // Compose narrative
  const niftyChange = (niftyRow && niftyPrev)
    ? ((niftyRow.close_paise - niftyPrev.close_paise) / niftyPrev.close_paise * 100).toFixed(2)
    : null;
  const vix = vixRow?.vix;
  const vixTone = vix ? (vix < 13 ? 'unusually calm' : vix < 18 ? 'normal' : 'elevated — caution') : null;
  const fiiNet = fiiRow?.fii_net_cr;
  const fiiTone = fiiNet != null
    ? (fiiNet > 1500 ? `aggressively buying (₹${fiiNet.toFixed(0)} Cr)` :
       fiiNet > 0 ? `mildly buying (₹${fiiNet.toFixed(0)} Cr)` :
       fiiNet > -1500 ? `mildly selling (₹${Math.abs(fiiNet).toFixed(0)} Cr)` :
       `aggressively selling (₹${Math.abs(fiiNet).toFixed(0)} Cr)`)
    : null;
  const diiNet = fiiRow?.dii_net_cr;
  const giftBias = giftRow?.change_pct != null
    ? (giftRow.change_pct > 0.3 ? `up +${giftRow.change_pct.toFixed(2)}%` :
       giftRow.change_pct < -0.3 ? `down ${giftRow.change_pct.toFixed(2)}%` :
       'flat')
    : null;

  const narrative = [
    niftyChange != null ? `Nifty 50 closed at ${(niftyRow.close_paise/100).toFixed(0)} (${niftyChange >= 0 ? '+' : ''}${niftyChange}%)` : null,
    vixTone ? `India VIX ${vix.toFixed(1)} — ${vixTone}` : null,
    fiiTone ? `FII ${fiiTone}, DII ${diiNet > 0 ? '+' : ''}${diiNet?.toFixed(0)} Cr` : null,
    sectorTop?.leaders?.length ? `Leaders: ${sectorTop.leaders.map(l => l.sector.replace('NIFTY ', '')).join(', ')}` : null,
    bond ? `Bonds: ${bond.split('—')[1]?.trim() || 'neutral'}` : null,
    giftBias ? `GIFT Nifty ${giftBias}` : null,
  ].filter(Boolean).join('. ') + '.';

  return {
    narrative,
    nifty: niftyRow ? { close: niftyRow.close_paise / 100, change_pct: niftyChange ? parseFloat(niftyChange) : null, date: niftyRow.trade_date } : null,
    vix: vix ? { value: vix, tone: vixTone } : null,
    fii_dii: fiiRow ? { fii_net_cr: fiiNet, dii_net_cr: diiNet, date: fiiRow.trade_date } : null,
    gift_nifty: giftRow ? { ltp: giftRow.ltp, change_pct: giftRow.change_pct, ts: giftRow.ts } : null,
    sector_top: sectorTop,
    bond_direction: bond,
    announcements,
    cross_asset: cross,
    persisted_briefing: persisted,
    generated_at: Date.now(),
  };
}

// Force rebuild 1777805328
// rebuild 1777806162
// rebuild 1777810817
// rebuild 1777812569
// rebuild 1777813687
// rebuild 1777817566
// rebuild 1777873120
// rebuild 1777877338
// rebuild 1777880720
// rebuild 1777880885
// rebuild 1777884265
// trigger redeploy after pages secret 1777884688
// fix env.WEALTH_DB binding 1777884774
// fix DB binding priority 1777884866
