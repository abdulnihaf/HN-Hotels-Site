// ═══════════════════════════════════════════════════════════════════════════
// wealth-verdict — the autonomous Claude operator.
//
// Phase A (08:30 IST daily) → composeVerdict (Opus 4.5)
// Phase B (every 5 min)     → triageAlerts (Haiku 4.5)
// Phase C (every 15 min mkt) → invalidateVerdict (Opus 4.5 — only fires on material change)
// Phase D.1 (16:00 IST)     → autopsyTrades (Sonnet 4.5)
// Phase D.2 (Mon 09:00 IST) → composeWeeklyReview (Sonnet 4.5)
//
// Manual triggers via HTTP:
//   /run/compose?key=...     → force a fresh morning compose (Opus)
//   /run/triage?key=...      → force alert triage pass
//   /run/invalidate?key=...  → force invalidator check
//   /run/autopsy?key=...     → force trade autopsy
//   /run/weekly?key=...      → force weekly review
// ═══════════════════════════════════════════════════════════════════════════

import { callOpus, callSonnet, callHaiku, parseJsonOutput } from '../../_shared/anthropic.js';
import { callOpenAI } from '../../_shared/openai.js';

const WORKER_NAME = 'wealth-verdict';

// ─── Helper: today's date string in IST (YYYY-MM-DD) ──────────────────────
function istToday() {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  return ist.toISOString().slice(0, 10);
}

// ─── Cron run logging (matches existing pattern in other workers) ─────────
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
      UPDATE cron_run_log SET status=?, finished_at=?, duration_ms=?, rows_written=?, error_message=?
      WHERE id=?
    `).bind(status, Date.now(), 0, rows || 0, err ? String(err).slice(0, 500) : null, id).run();
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic engine-only verdict — used when ALL 3 LLM tiers fail.
// Generates a basic verdict from regime + max score + dim health, with NO
// LLM call. Loses qualitative narrative but never leaves the user without
// a morning decision. Same JSON shape as the LLM output.
// ═══════════════════════════════════════════════════════════════════════════
function buildEngineOnlyVerdict(ctx, topPicks) {
  const dims = ctx.dim_health_pct || {};
  const deadDims = Object.values(dims).filter(p => p < 10).length;
  const maxScore = topPicks?.[0]?.composite_score || topPicks?.[0]?.score || 0;
  const regime = ctx.regime || 'unknown';
  const topPick = topPicks?.[0];

  // Decision tree (mirrors the rules in the LLM prompt)
  let decision, headline, narrative, sym = null, entry_window = null, horizon = null, time_stop_days = null;

  // Honest fallback narrative (May 7 2026 fix): old narrative said "LLM unavailable"
  // but the actual common cause is LLM truncation (max_tokens hit). Fallback can fire
  // for many reasons — be specific so owner can debug.
  const fallbackReason = 'engine-only fallback (LLM tiers may have failed JSON validation, hit max_tokens cap, or returned errors — check anthropic_usage table for today)';

  if (regime === 'strong_trending_down' || maxScore < 65 || deadDims >= 5) {
    decision = 'SIT_OUT';
    const reasons = [];
    if (regime === 'strong_trending_down') reasons.push('strong downtrend');
    if (maxScore < 65) reasons.push(`max score ${maxScore.toFixed(1)} below 65`);
    if (deadDims >= 5) reasons.push(`${deadDims} of 9 dims data-blind`);
    headline = `Engine-fallback SIT_OUT: ${reasons.join(', ')}`;
    narrative = `${fallbackReason}. ${reasons.join('. ')}. Owner should investigate root cause; today is a sit-out from the deterministic decision tree.`;
  } else if (regime === 'high_vol' && maxScore < 75) {
    decision = 'OBSERVE';
    headline = `High-vol regime, marginal score (${maxScore.toFixed(1)}) — observe, do not enter`;
    narrative = `${fallbackReason}. VIX-elevated regime + marginal score = chaos zone. Watch but don't enter.`;
  } else if (topPick && maxScore >= 70 && topPick.mtf !== 'against_macro' && topPick.mtf !== 'aligned_down') {
    decision = 'TRADE';
    sym = topPick.symbol;
    headline = `Engine-fallback TRADE: ${sym} (score ${maxScore.toFixed(1)})`;
    narrative = `${fallbackReason}. ${sym} is the highest-scoring stock with clean MTF alignment. Trust the engine numbers, lean smaller size since no narrative validation.`;
    entry_window = '09:30–11:30 IST (morning trend window)';
    horizon = 'swing';
    time_stop_days = 5;
  } else {
    decision = 'SIT_OUT';
    headline = 'Engine-fallback SIT_OUT: no clean setup met thresholds';
    narrative = `${fallbackReason}. No setup passed all gates (score≥70, MTF clean, regime favorable).`;
  }

  return {
    decision,
    headline,
    narrative,
    recommended_symbol: sym,
    recommendation_why_picked: sym ? `Highest composite score (${maxScore.toFixed(1)}) with clean MTF` : null,
    entry_window,
    horizon,
    time_stop_days,
    pre_event_exit: null,
    alternatives: (topPicks || []).slice(1, 4).map(p => ({ symbol: p.symbol, why_not: `Lower score ${p.score?.toFixed(1)}` })),
    risk_flags: ['LLM tiers unavailable — verdict is deterministic engine-only fallback. Re-check at 11:00 when invalidator runs (next LLM attempt).'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE A0 — composePreMarketBriefing (07:30 IST, before main compose)
//
// Reads overnight global markets + GIFT Nifty + breaking news → Opus produces
// a 100-word pre-market bias. The 08:30 morning compose reads this and folds
// it into picking decisions, raising selection quality.
// ═══════════════════════════════════════════════════════════════════════════
async function composePreMarketBriefing(env, opts = {}) {
  const db = env.DB;
  const today = istToday();

  // Skip if already composed today (unless force)
  if (!opts.force) {
    const existing = await db.prepare(`
      SELECT id FROM daily_verdicts WHERE trade_date=? AND verdict_type='pre_market'
    `).bind(today).first();
    if (existing) return { rows: 0, skipped: 'already-composed-pre-market' };
  }

  // Pull overnight context
  const [crossAsset, gift, fii, vix, breakingNews] = await Promise.all([
    db.prepare(`
      SELECT c1.* FROM crossasset_ticks c1
      JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks GROUP BY asset_code) c2
        ON c1.asset_code = c2.asset_code AND c1.ts = c2.m
      WHERE c1.asset_code IN ('DXY','BRENT','US10Y','GOLD','VIX_US','NASDAQ','NIKKEI','HSI','SPX','DJI')
    `).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT ltp, change_pct, ts FROM gift_nifty_ticks ORDER BY ts DESC LIMIT 1`).first().catch(() => null),
    db.prepare(`SELECT * FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 1`).first().catch(() => null),
    db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first().catch(() => null),
    // BUG FIX (May 5 2026 evening): news_articles → news_items, title → headline
    db.prepare(`
      SELECT headline AS title, source, published_at FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 12*3600000
      ORDER BY published_at DESC LIMIT 10
    `).all().catch(() => ({ results: [] })),
  ]);

  const ctx = {
    today,
    cross_asset_overnight: (crossAsset.results || []).map(c => ({ code: c.asset_code, ltp: c.ltp, change_pct: c.change_pct })),
    gift_nifty: gift ? { ltp: gift.ltp, change_pct: gift.change_pct } : null,
    fii_yesterday_cr: fii?.fii_net_cr,
    dii_yesterday_cr: fii?.dii_net_cr,
    india_vix_last: vix?.vix,
    breaking_news_12h: (breakingNews.results || []).slice(0, 8).map(n => ({ title: n.title, source: n.source })),
  };

  const system = `You are an Indian-equity pre-market strategist. Produce a 100-word PRE-MARKET BIAS for morning compose at 08:30 IST.

Output STRICT JSON:
{
  "global_setup": "BULLISH|BEARISH|NEUTRAL",
  "expected_open": "GAP_UP|GAP_DOWN|FLAT|VOLATILE",
  "narrative": "≤80 words synthesizing US close, GIFT Nifty, FII flows, VIX, breaking news",
  "sector_lean": ["positive sectors"],
  "sector_avoid": ["sectors at risk"],
  "key_watch": "1 sentence — single most important thing to watch at 09:15"
}

Be honest. If signals mixed, say NEUTRAL.`;

  const userPrompt = `Pre-market state for ${today}:\n${JSON.stringify(ctx, null, 2)}\n\nCompose pre-market bias JSON.`;

  let result;
  try {
    result = await callOpus(env, {
      prompt: userPrompt, system, max_tokens: 500,
      purpose: 'pre_market_compose', worker: WORKER_NAME,
      cache_key: `premarket_${today}`,
      cache_ttl_ms: 4 * 3600 * 1000,
    });
  } catch (e) {
    return { rows: 0, error: 'opus-failed: ' + (e.message || '').slice(0, 200) };
  }

  const parsed = parseJsonOutput(result.text);
  if (!parsed?.narrative) return { rows: 0, error: 'invalid-json' };

  await db.prepare(`
    INSERT INTO daily_verdicts
      (trade_date, verdict_type, decision, headline, narrative,
       context_snapshot_json, composed_at, composed_by_model, cost_paise)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    today, 'pre_market',
    parsed.global_setup || 'NEUTRAL',
    `Pre-market bias: ${parsed.global_setup || 'NEUTRAL'} · ${parsed.expected_open || 'FLAT'}`,
    (parsed.narrative || '').slice(0, 1000),
    JSON.stringify({ ...parsed, ...ctx }),
    Date.now(), result.model_id, result.cost_paise || 0,
  ).run();

  return { rows: 1, bias: parsed.global_setup, expected_open: parsed.expected_open, cost_paise: result.cost_paise };
}

// ═══════════════════════════════════════════════════════════════════════════
// MORNING CARRYOVER REVIEW (called from compose at 08:30 IST)
//
// If any position was held overnight via HOLD_OVERNIGHT, Opus reviews each
// at 08:30 with overnight context (US close, GIFT Nifty, breaking news on
// the symbol). Decides EXIT_AT_OPEN or CONTINUE_HOLDING.
//
// Hard-coded auto-exit: pre-market gap-down >2% on the held position →
// force exit at open (don't extend bleeding).
// ═══════════════════════════════════════════════════════════════════════════
async function reviewOvernightCarryovers(env) {
  const db = env.DB;
  const today = istToday();

  const carryovers = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise, peak_price_paise, trailing_stop_paise,
           stop_paise, target_paise, rationale, trader_notes, entry_at,
           DATE(created_at/1000, 'unixepoch') AS opened_date
    FROM paper_trades
    WHERE auto_managed=1 AND is_active=1 AND trader_state='HELD_OVERNIGHT'
  `).all()).results || [];

  if (carryovers.length === 0) return { rows: 0, skipped: 'no-carryovers' };

  // Pull recent overnight news per symbol
  const decisions = [];
  for (const pos of carryovers) {
    // BUG FIX: news_articles → news_items, title → headline, symbols_extracted → symbols_tagged
    const news = (await db.prepare(`
      SELECT headline AS title, sentiment_score, source FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 18*3600000
        AND (headline LIKE ? OR symbols_tagged LIKE ?)
      ORDER BY published_at DESC LIMIT 5
    `).bind(`%${pos.symbol}%`, `%${pos.symbol}%`).all().catch(() => ({ results: [] }))).results || [];

    const ctx = {
      symbol: pos.symbol,
      qty: pos.qty,
      entry_price: pos.entry_paise / 100,
      peak_yesterday: pos.peak_price_paise ? pos.peak_price_paise / 100 : null,
      stop_floor: pos.stop_paise / 100,
      original_thesis: pos.rationale,
      hold_overnight_rationale: pos.trader_notes,
      overnight_news: news,
      held_since: pos.opened_date,
    };

    const system = `You are reviewing a position that was held overnight via HOLD_OVERNIGHT yesterday. It's now 08:30 IST today — markets open at 09:15. Decide: EXIT_AT_OPEN or CONTINUE_HOLDING.

Output STRICT JSON: { "decision": "EXIT_AT_OPEN" | "CONTINUE_HOLDING", "rationale": "1 sentence", "force_exit_if_gap_down_pct": 2.0 }

Rules:
- EXIT_AT_OPEN if: adverse overnight news, sector turned, US/Asia closed sharply down, or original catalyst played out
- CONTINUE_HOLDING if: catalyst still extending, news supportive, no adverse signals
- Default lean = EXIT_AT_OPEN unless catalyst is very clearly continuing. Sleep flat is the design — overnight extension is the exception.`;

    const userPrompt = `Position held overnight from yesterday:\n${JSON.stringify(ctx, null, 2)}\n\nDecide.`;

    let result;
    try {
      result = await callOpus(env, {
        prompt: userPrompt, system, max_tokens: 250,
        purpose: 'overnight_carryover', worker: WORKER_NAME,
      });
    } catch (e) {
      // If Opus fails, default-safe = EXIT_AT_OPEN
      decisions.push({ pos, decision: 'EXIT_AT_OPEN', rationale: `Opus call failed: ${e.message?.slice(0, 100)}, default-safe exit at open` });
      continue;
    }
    const parsed = parseJsonOutput(result.text);
    if (parsed?.decision === 'CONTINUE_HOLDING') {
      decisions.push({ pos, decision: 'CONTINUE_HOLDING', rationale: parsed.rationale });
    } else {
      decisions.push({ pos, decision: 'EXIT_AT_OPEN', rationale: parsed?.rationale || 'default safe exit' });
    }
  }

  // Apply decisions: mark each carryover with directive
  for (const d of decisions) {
    if (d.decision === 'EXIT_AT_OPEN') {
      // Mark for exit on first price_monitor call after market opens
      await db.prepare(`
        UPDATE paper_trades
        SET trader_state='ENTERED', trader_notes=?, last_check_at=?
        WHERE id=?
      `).bind(`OVERNIGHT_EXIT_QUEUED: ${(d.rationale || '').slice(0, 300)}`, Date.now(), d.pos.id).run();
    } else {
      // Stay HELD_OVERNIGHT — but tighten further (raise stop to peak × 0.99)
      const newStop = Math.round(d.pos.peak_price_paise * 0.99);
      const finalStop = Math.max(d.pos.stop_paise, newStop);
      await db.prepare(`
        UPDATE paper_trades
        SET stop_paise=?, trailing_stop_paise=?, trader_notes=?, last_check_at=?
        WHERE id=?
      `).bind(finalStop, finalStop, `OVERNIGHT_CONTINUE: ${(d.rationale || '').slice(0, 250)}`, Date.now(), d.pos.id).run();
    }
  }

  return { rows: decisions.length, decisions: decisions.map(d => ({ symbol: d.pos.symbol, decision: d.decision })) };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE A — composeVerdict
//
// Pulls all data layers, sends to Opus, gets back ONE verdict.
// Stored in daily_verdicts table. Read by Pages /api/trading?action=verdict_today.
// ═══════════════════════════════════════════════════════════════════════════
async function composeVerdict(env, opts = {}) {
  const db = env.DB;
  const today = istToday();
  const force = !!opts.force;

  // 0. FIRST: review any HELD_OVERNIGHT positions from yesterday's HOLD_OVERNIGHT.
  // Decides EXIT_AT_OPEN vs CONTINUE_HOLDING per position, mid-cron, before main compose.
  let carryoverResult = null;
  try {
    carryoverResult = await reviewOvernightCarryovers(env);
  } catch (e) {
    carryoverResult = { error: String(e).slice(0, 200) };
  }

  // 1. Skip if morning verdict already composed today (unless forced)
  if (!force) {
    const existing = await db.prepare(`
      SELECT id FROM daily_verdicts WHERE trade_date=? AND verdict_type='morning'
      ORDER BY composed_at DESC LIMIT 1
    `).bind(today).first();
    if (existing) return { rows: 0, skipped: 'already-composed-today', id: existing.id, carryover: carryoverResult };
  }

  // 1b. ★ GAP-UP EDGE ENGINE (PRIMARY 09:40 PATH) — deterministic scan of today's
  // actual gap-ups, gated by the nightly-tuned rule the RTX box publishes into
  // wealth_strategy_config. When a config exists it OWNS the decision (a real TRADE
  // with exact entry/stop/time-exit, or an HONEST SIT_OUT when the edge is unproven
  // or nothing clears). The picks are MATH (a coordinate), the LLM only narrates.
  // This is ADDITIVE: if no config is published yet, or the live scan genuinely can't
  // run, we fall through to the legacy LLM-selection path below — no regression.
  try {
    const stratCfg = await loadStrategyConfig(db);
    if (stratCfg) {
      const gap = await runGapEngine(env, db, today, stratCfg, carryoverResult);
      if (gap) return gap;
    }
  } catch (e) {
    console.warn('[gap-engine] failed, falling back to legacy compose:', e.message);
  }

  // 2. Pull every data layer in parallel
  const [
    latestSig,
    fii,
    indices,
    vix,
    sectorRot,
    bondDir,
    recentConcalls,
    topAnnouncements,
    topPicks,
    universeStats,
    dimHealth,
    mtfDist,
    cascades,
  ] = await Promise.all([
    db.prepare(`SELECT MAX(computed_at) AS m FROM signal_scores`).first(),
    db.prepare(`SELECT * FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 3`).all(),
    db.prepare(`
      SELECT i1.* FROM indices_eod i1
      JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
        ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
      WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX')
    `).all(),
    db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first(),
    db.prepare(`
      SELECT * FROM sector_perf_rolling
      WHERE period_days = 20 AND computed_at = (SELECT MAX(computed_at) FROM sector_perf_rolling WHERE period_days = 20)
      ORDER BY relative_strength_pct DESC LIMIT 12
    `).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT direction, change_5d_pct FROM bond_yields WHERE tenor='10Y' ORDER BY ts DESC LIMIT 1`).first().catch(() => null),
    db.prepare(`
      SELECT symbol, fiscal_period, tone_score, raw_summary
      FROM concall_analysis WHERE analyzed_at > strftime('%s','now')*1000 - 14*86400000
      ORDER BY analyzed_at DESC LIMIT 5
    `).all().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT symbol, subject, materiality_score
      FROM corp_announcements
      WHERE ann_time > strftime('%s','now')*1000 - 2*86400000 AND materiality_score > 0.7
      ORDER BY materiality_score DESC LIMIT 5
    `).all().catch(() => ({ results: [] })),
    null, // placeholder — fills below after latestSig
    db.prepare(`SELECT regime, COUNT(*) AS n FROM signal_scores WHERE computed_at = (SELECT MAX(computed_at) FROM signal_scores) GROUP BY regime ORDER BY n DESC LIMIT 1`).first(),
    null, // dim health computed below
    null, // mtf below
    db.prepare(`
      SELECT pattern_name, COUNT(*) AS n FROM cascade_triggers_active
      WHERE status='active' AND expected_window_end > ? GROUP BY pattern_name
    `).bind(Date.now()).all().catch(() => ({ results: [] })),
  ]);

  if (!latestSig?.m) {
    return { rows: 0, error: 'no-signals-computed-yet' };
  }

  // INTRADAY DAILY-PROFIT MODE — RISK-MINIMAL SELECTION.
  //
  // Ranking metric = REWARD/RISK RATIO × GREEN_CLOSE_RATE × LIQUIDITY_FACTOR.
  // This biases selection toward stocks where:
  //   • avg upside is meaningfully > avg downside (R:R ≥ 1.5 ideal, ≥1.7 starred)
  //   • stock closes green more often than red (directional bias)
  //   • liquidity supports ₹3-4L positions without slippage
  // The +5% hit-rate is a TARGET BAND check, not a primary ranking input
  // (we'd rather pick high-R:R consistent earners than rare big-mover lottery tickets).
  // RECENCY-WEIGHTED RANKING — combines 90-day backtest with last-week intraday metrics.
  // last-week metrics from intraday_bars (computed by weekly_enrich cron) reveal
  // CURRENT regime per stock, not just 90-day average. Stocks that are HOT THIS WEEK
  // get boosted; cooling stocks get discounted.
  const topPicksRows = (await db.prepare(`
    SELECT s.symbol, s.composite_score, s.regime, s.mtf_alignment,
           s.trend_score, s.flow_score, s.options_score, s.catalyst_score, s.macro_score,
           s.sentiment_score, s.breadth_score, s.retail_buzz_score, s.quality_score,
           s.rationale_json,
           i.intraday_score, i.hit_2pct_rate, i.hit_3pct_rate, i.hit_5pct_rate,
           i.avg_open_to_high_pct, i.avg_open_to_low_pct, i.green_close_rate,
           i.avg_turnover_cr,
           i.hit_2pct_last_week, i.avg_up_last_week_pct, i.green_close_last_week,
           ROUND(i.avg_open_to_high_pct / ABS(i.avg_open_to_low_pct), 2) AS reward_risk,
           ROUND(
             (i.avg_open_to_high_pct / ABS(i.avg_open_to_low_pct)) *
             (i.green_close_rate / 100.0) *
             (CASE WHEN i.avg_turnover_cr >= 100 THEN 1.0
                   WHEN i.avg_turnover_cr >= 50  THEN 0.85
                   ELSE 0.7 END) *
             -- RECENCY BOOST: stocks where last-week hit-rate ≥ 90d hit-rate × 1.1 get +20% score boost
             -- Stocks where last-week hit-rate ≤ 90d × 0.7 get -30% penalty (cooling regime)
             (CASE
               WHEN i.hit_2pct_last_week IS NOT NULL AND i.hit_2pct_rate > 0 THEN
                 CASE
                   WHEN i.hit_2pct_last_week >= i.hit_2pct_rate * 1.1 THEN 1.20
                   WHEN i.hit_2pct_last_week >= i.hit_2pct_rate * 0.9 THEN 1.0
                   WHEN i.hit_2pct_last_week >= i.hit_2pct_rate * 0.7 THEN 0.85
                   ELSE 0.70
                 END
               ELSE 1.0
             END) *
             100, 2
           ) AS hybrid_score
    FROM signal_scores s
    INNER JOIN intraday_suitability i ON i.symbol = s.symbol
    WHERE s.computed_at = ?
      AND s.mtf_alignment NOT IN ('against_macro','aligned_down')
      AND i.avg_open_to_low_pct < 0
    ORDER BY hybrid_score DESC LIMIT 10
  `).bind(latestSig.m).all()).results || [];

  // Fallback: if no overlap with today's signal_scores, use pure
  // intraday-suitability ranked by reward/risk × green × liquidity.
  if (topPicksRows.length === 0) {
    const fb = (await db.prepare(`
      SELECT i.symbol, NULL AS composite_score, 'unknown' AS regime, 'aligned_up' AS mtf_alignment,
             50 AS trend_score, 50 AS flow_score, 50 AS options_score, 50 AS catalyst_score,
             50 AS macro_score, 50 AS sentiment_score, 50 AS breadth_score,
             50 AS retail_buzz_score, 50 AS quality_score, NULL AS rationale_json,
             i.intraday_score, i.hit_2pct_rate, i.hit_3pct_rate, i.hit_5pct_rate,
             i.avg_open_to_high_pct, i.avg_open_to_low_pct, i.green_close_rate,
             i.avg_turnover_cr,
             ROUND(i.avg_open_to_high_pct / ABS(i.avg_open_to_low_pct), 2) AS reward_risk,
             ROUND(
               (i.avg_open_to_high_pct / ABS(i.avg_open_to_low_pct)) *
               (i.green_close_rate / 100.0) *
               (CASE WHEN i.avg_turnover_cr >= 100 THEN 1.0
                     WHEN i.avg_turnover_cr >= 50  THEN 0.85
                     ELSE 0.7 END) * 100, 2
             ) AS hybrid_score
      FROM intraday_suitability i
      WHERE i.avg_open_to_low_pct < 0
      ORDER BY hybrid_score DESC LIMIT 10
    `).all()).results || [];
    topPicksRows.push(...fb);
  }

  // Dim health
  const dimRow = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ABS(trend_score-50)>1 THEN 1 ELSE 0 END) AS trend_n,
      SUM(CASE WHEN ABS(flow_score-50)>1 THEN 1 ELSE 0 END) AS flow_n,
      SUM(CASE WHEN ABS(options_score-50)>1 THEN 1 ELSE 0 END) AS options_n,
      SUM(CASE WHEN ABS(catalyst_score-50)>1 THEN 1 ELSE 0 END) AS catalyst_n,
      SUM(CASE WHEN ABS(macro_score-50)>1 THEN 1 ELSE 0 END) AS macro_n,
      SUM(CASE WHEN ABS(sentiment_score-50)>1 THEN 1 ELSE 0 END) AS sentiment_n,
      SUM(CASE WHEN ABS(breadth_score-50)>1 THEN 1 ELSE 0 END) AS breadth_n,
      SUM(CASE WHEN ABS(retail_buzz_score-50)>1 THEN 1 ELSE 0 END) AS retail_buzz_n,
      SUM(CASE WHEN ABS(quality_score-50)>1 THEN 1 ELSE 0 END) AS quality_n
    FROM signal_scores WHERE computed_at = ?
  `).bind(latestSig.m).first();
  const total = dimRow?.total || 1;
  const dimPctMap = {};
  for (const d of ['trend','flow','options','catalyst','macro','sentiment','breadth','retail_buzz','quality']) {
    dimPctMap[d] = +((dimRow?.[`${d}_n`] || 0) / total * 100).toFixed(1);
  }

  // MTF veto rate
  const vetoCount = (await db.prepare(`
    SELECT COUNT(*) AS n FROM signal_scores
    WHERE computed_at = ? AND mtf_alignment IN ('against_macro','aligned_down')
  `).bind(latestSig.m).first())?.n || 0;
  const mtfVetoPct = +(vetoCount / total * 100).toFixed(1);

  // 3. Build the Opus prompt — packed with structured data
  const fiiList = fii.results || [];
  const niftyRow = (indices.results || []).find(i => i.index_name === 'NIFTY 50');
  const vixVal = vix?.vix;
  const sectorLeaders = (sectorRot.results || []).slice(0, 3);
  const sectorLaggards = (sectorRot.results || []).slice(-3).reverse();
  const regimeName = mtfDist?.regime || 'unknown';

  const dataContext = {
    today,
    regime: regimeName,
    nifty_close: niftyRow ? +(niftyRow.close_paise / 100).toFixed(0) : null,
    india_vix: vixVal,
    fii_yesterday_cr: fiiList[0]?.fii_net_cr,
    dii_yesterday_cr: fiiList[0]?.dii_net_cr,
    fii_3day_cr: fiiList.reduce((s, f) => s + (f.fii_net_cr || 0), 0),
    sector_leaders: sectorLeaders.map(s => ({ name: s.sector?.replace('NIFTY ', ''), strength_pct: s.relative_strength_pct })),
    sector_laggards: sectorLaggards.map(s => ({ name: s.sector?.replace('NIFTY ', ''), strength_pct: s.relative_strength_pct })),
    bond_direction: bondDir?.direction,
    cascades_active: (cascades.results || []).map(c => `${c.pattern_name} on ${c.n} stocks`),
    universe_total: total,
    mtf_vetoed_pct: mtfVetoPct,
    dim_health_pct: dimPctMap,
    recent_concalls: (recentConcalls.results || []).map(c => ({ symbol: c.symbol, period: c.fiscal_period, tone: c.tone_score, summary: c.raw_summary?.slice(0, 200) })),
    material_filings: (topAnnouncements.results || []).map(a => ({ symbol: a.symbol, subject: a.subject?.slice(0, 100) })),
    intraday_suitable_picks: topPicksRows.map(p => {
      let rationale = null;
      try { rationale = JSON.parse(p.rationale_json || 'null'); } catch {}
      return {
        symbol: p.symbol,
        composite_score: p.composite_score ? +p.composite_score?.toFixed(1) : null,
        intraday_score: p.intraday_score,
        hybrid_score: p.hybrid_score,
        // 90-day historical intraday stats — the BACKBONE of pick selection
        intraday_history: {
          hit_2pct_pct_of_days: p.hit_2pct_rate,
          hit_3pct_pct_of_days: p.hit_3pct_rate,
          hit_5pct_pct_of_days: p.hit_5pct_rate,
          avg_open_to_high_pct: p.avg_open_to_high_pct,
          avg_open_to_low_pct: p.avg_open_to_low_pct,
          green_close_rate: p.green_close_rate,
          avg_turnover_cr: p.avg_turnover_cr,
        },
        regime: p.regime,
        mtf: p.mtf_alignment,
        sub_scores: {
          trend: p.trend_score, flow: p.flow_score, options: p.options_score,
          catalyst: p.catalyst_score, macro: p.macro_score, sentiment: p.sentiment_score,
          breadth: p.breadth_score, retail_buzz: p.retail_buzz_score, quality: p.quality_score,
        },
        rationale: rationale ? (typeof rationale === 'string' ? rationale : JSON.stringify(rationale)) : null,
      };
    }),
  };

  // RISK-MINIMAL plan computation per candidate. Math is deterministic, then
  // Opus picks which 2-3 to actually trade. Each candidate is enriched with
  // event/whale/insider/options/positioning signals from existing D1 tables.
  const PAPER_CAPITAL = 1000000; // ₹10,00,000

  // ─── SIGNAL ENRICHMENT — pull existing-but-unused data per candidate ────
  const candidateSymbols = topPicksRows.map(p => p.symbol);
  const enrichments = {};
  if (candidateSymbols.length > 0) {
    const placeholders = candidateSymbols.map(() => '?').join(',');
    const nowMs = Date.now();
    const fiveDaysAgo = nowMs - 5 * 86400000;
    const thirtyDaysAgo = nowMs - 30 * 86400000;

    // 1. Earnings within next 5 days (gap-risk filter)
    const earnings = (await db.prepare(`
      SELECT symbol, result_date, fiscal_period, expected_session
      FROM results_calendar
      WHERE symbol IN (${placeholders})
        AND result_date >= date('now')
        AND result_date <= date('now', '+5 days')
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const e of earnings) {
      enrichments[e.symbol] = enrichments[e.symbol] || {};
      enrichments[e.symbol].earnings_in_5d = { date: e.result_date, period: e.fiscal_period, session: e.expected_session };
    }

    // 2. Bulk + block deals last 5 days (whale activity)
    const blocks = (await db.prepare(`
      SELECT symbol, deal_type, txn_type, qty, price_paise, client_name, trade_date
      FROM bulk_block_deals
      WHERE symbol IN (${placeholders})
        AND DATE(trade_date) >= DATE('now', '-5 days')
      ORDER BY trade_date DESC LIMIT 30
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const b of blocks) {
      enrichments[b.symbol] = enrichments[b.symbol] || {};
      enrichments[b.symbol].whale_deals_5d = enrichments[b.symbol].whale_deals_5d || [];
      if (enrichments[b.symbol].whale_deals_5d.length < 3) {
        enrichments[b.symbol].whale_deals_5d.push({
          type: `${b.deal_type}_${b.txn_type}`,
          qty: b.qty,
          client: (b.client_name || '').slice(0, 40),
          date: b.trade_date,
        });
      }
    }

    // 3. Promoter pledging changes last 30 days (risk signal)
    const pledges = (await db.prepare(`
      SELECT symbol, filing_date, pledged_pct, encumbered_pct
      FROM promoter_pledge
      WHERE symbol IN (${placeholders})
        AND DATE(filing_date) >= DATE('now', '-30 days')
      ORDER BY filing_date DESC
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const p of pledges) {
      enrichments[p.symbol] = enrichments[p.symbol] || {};
      if (!enrichments[p.symbol].pledge_recent) {
        enrichments[p.symbol].pledge_recent = {
          date: p.filing_date,
          pledged_pct: p.pledged_pct,
          encumbered_pct: p.encumbered_pct,
        };
      }
    }

    // 4. Insider activity last 30 days (direction signal)
    const insider = (await db.prepare(`
      SELECT symbol, txn_type, SUM(qty) AS net_qty, COUNT(*) AS n
      FROM insider_trades
      WHERE symbol IN (${placeholders})
        AND DATE(filed_date) >= DATE('now', '-30 days')
      GROUP BY symbol, txn_type
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const i of insider) {
      enrichments[i.symbol] = enrichments[i.symbol] || {};
      enrichments[i.symbol].insider_30d = enrichments[i.symbol].insider_30d || {};
      enrichments[i.symbol].insider_30d[i.txn_type] = { net_qty: i.net_qty, filings: i.n };
    }

    // 5. Options PCR + IV per pick (institutional positioning)
    const options = (await db.prepare(`
      SELECT underlying AS symbol,
             SUM(pe_oi) AS total_pe_oi,
             SUM(ce_oi) AS total_ce_oi,
             AVG(pe_iv) AS avg_pe_iv,
             AVG(ce_iv) AS avg_ce_iv,
             MAX(ts) AS latest_ts
      FROM option_chain_snapshot
      WHERE underlying IN (${placeholders})
        AND ts > strftime('%s','now')*1000 - 24*3600000
        AND expiry = (SELECT MIN(expiry) FROM option_chain_snapshot WHERE expiry > date('now'))
      GROUP BY underlying
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const o of options) {
      enrichments[o.symbol] = enrichments[o.symbol] || {};
      const pcr = (o.total_ce_oi > 0) ? (o.total_pe_oi / o.total_ce_oi).toFixed(2) : null;
      enrichments[o.symbol].options = {
        pcr,                                    // >1 = bullish (more puts = put writers expect up)
        total_pe_oi: o.total_pe_oi,
        total_ce_oi: o.total_ce_oi,
        avg_pe_iv: o.avg_pe_iv ? +o.avg_pe_iv.toFixed(1) : null,
        avg_ce_iv: o.avg_ce_iv ? +o.avg_ce_iv.toFixed(1) : null,
        iv_skew: (o.avg_pe_iv && o.avg_ce_iv) ? +(o.avg_pe_iv - o.avg_ce_iv).toFixed(2) : null,
      };
    }

    // 6. FII/DII F&O OI participation (latest)
    const fnoOi = (await db.prepare(`
      SELECT participant, long_oi, short_oi, long_value_cr, short_value_cr, trade_date
      FROM fno_participant_oi
      WHERE trade_date = (SELECT MAX(trade_date) FROM fno_participant_oi)
        AND instrument LIKE 'INDEX_FUT%' OR instrument LIKE 'STOCK_FUT%'
    `).all().catch(() => ({ results: [] }))).results || [];
    // This is universe-wide, attach to context not per-pick
    var globalFnoOi = fnoOi.slice(0, 6);
  }
  // ─── Sector classification per candidate (for concentration cap) ─────
  // Hard-rule: max 1 pick per sector_bucket. Prevents 3 banks getting picked
  // and getting clobbered together when banking sector rolls over.
  const sectorBySymbol = {};
  if (candidateSymbols.length > 0) {
    const placeholdersSec = candidateSymbols.map(() => '?').join(',');
    const secRows = (await db.prepare(`
      SELECT symbol, sector_bucket FROM sector_classification
      WHERE symbol IN (${placeholdersSec})
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const r of secRows) sectorBySymbol[r.symbol] = r.sector_bucket;
  }

  // ─── ATR per candidate (for volatility-aware stops/targets) ───────────
  // Avg daily range from last 14 trading days of intraday_bars.
  const atrBySymbol = {};
  if (candidateSymbols.length > 0) {
    const placeholdersATR = candidateSymbols.map(() => '?').join(',');
    const atrRows = (await db.prepare(`
      WITH daily AS (
        SELECT symbol, trade_date, MAX(high_paise) AS h, MIN(low_paise) AS l
        FROM intraday_bars
        WHERE interval='5minute' AND trade_date >= date('now', '-21 days')
          AND symbol IN (${placeholdersATR})
        GROUP BY symbol, trade_date
      )
      SELECT symbol, AVG(h - l) AS atr_paise, COUNT(*) AS days
      FROM daily GROUP BY symbol HAVING days >= 5
    `).bind(...candidateSymbols).all().catch(() => ({ results: [] }))).results || [];
    for (const r of atrRows) atrBySymbol[r.symbol] = r.atr_paise;
  }

  // Attach enrichments per pick
  for (const p of topPicksRows) {
    p._enrichment = enrichments[p.symbol] || {};
  }

  const candidatePlans = topPicksRows.map(p => {
    const hist = {
      hit_2pct: p.hit_2pct_rate || 0,
      hit_3pct: p.hit_3pct_rate || 0,
      hit_5pct: p.hit_5pct_rate || 0,
      avg_up: p.avg_open_to_high_pct || 0,
      avg_dn: p.avg_open_to_low_pct || 0,
      reward_risk: p.reward_risk || 0,
      green: p.green_close_rate || 50,
    };
    // ── ATR-AWARE STOP/TARGET (replaces fixed -1%/+2.5% blanket) ───────
    // Compute ATR % from intraday_bars (~14-day daily range / current price proxy)
    const atrPaise = atrBySymbol[p.symbol];
    const referencePrice = atrPaise ? atrPaise * 50 : null; // back-of-envelope for atr_pct
    // Better: use stock's avg close-paise from last 14 days
    let atrPct = null;
    if (atrPaise && hist.avg_up) {
      // ATR % ≈ (atr_paise / typical_price). Estimate typical_price from avg upside math.
      // We approximate: if avg_up is 3% and that's roughly half the daily range,
      // typical price ≈ atr_paise / (avg_up/100 × 2). Crude but works.
      atrPct = (hist.avg_up * 2 > 0) ? null : null; // placeholder — use avg_dn/up directly
      // Simpler: use avg daily range from suitability table directly
    }
    // Use avg_daily_range from history if available (proxy for ATR %)
    const dailyRangePct = (hist.avg_up + Math.abs(hist.avg_dn)) || 4.0;

    // ── TARGET ── ATR-aware: 60% of typical daily range, capped 2-4%
    const target_pct = +Math.min(Math.max(dailyRangePct * 0.6, 2.0), 4.0).toFixed(2);
    // ── STOP ── ATR-aware: tighter of (35% of daily range, 1.2%, 0.7×avg_dn)
    // Calm stocks (range ~2%) get ~0.7% stop. Volatile stocks (range ~6%) get up to ~1.2%.
    // Never wider than 1.2% — risk-minimal floor.
    const stop_pct = +Math.min(
      dailyRangePct * 0.35,           // ATR-proportional
      1.2,                             // hard ceiling
      Math.abs(hist.avg_dn) * 0.7,     // typical-drawdown-bounded
    ).toFixed(2);
    // ── TRAILING ── arm at half-target, give back 30% of target distance
    const trail_after_pct = +(target_pct * 0.5).toFixed(2);
    const trail_pct = +(target_pct * 0.3).toFixed(2);
    // ── R:R ── Validation
    const rr_ratio = +(target_pct / stop_pct).toFixed(2);
    // ── FIRST-TARGET (partial exit trigger) ── 60% of full target
    const first_target_pct = +(target_pct * 0.6).toFixed(2);
    return {
      symbol: p.symbol,
      hybrid_score: p.hybrid_score,
      reward_risk_history: hist.reward_risk,
      sector: sectorBySymbol[p.symbol] || 'unknown',
      hit_2pct: hist.hit_2pct,
      hit_3pct: hist.hit_3pct,
      hit_5pct: hist.hit_5pct,
      avg_up_pct: hist.avg_up,
      avg_dn_pct: hist.avg_dn,
      green_rate: hist.green,
      turnover_cr: p.avg_turnover_cr,
      // RECENCY — last 7 days from intraday_bars (HOT/COOLING signal)
      last_week_hit_2pct: p.hit_2pct_last_week,
      last_week_avg_up_pct: p.avg_up_last_week_pct,
      last_week_green_close_rate: p.green_close_last_week,
      regime_trend: p.hit_2pct_last_week && p.hit_2pct_rate
        ? (p.hit_2pct_last_week >= p.hit_2pct_rate * 1.1 ? 'HOT'
          : p.hit_2pct_last_week <= p.hit_2pct_rate * 0.7 ? 'COOLING'
          : 'STABLE')
        : 'INSUFFICIENT_DATA',
      target_pct,
      first_target_pct,                  // partial exit (50%) at this level
      stop_pct,
      trail_after_pct,
      trail_pct,
      rr_ratio,
      daily_range_pct_history: dailyRangePct,
      // Per-pick capital math at 30% sizing (max for risk-minimal mode)
      capital_at_30pct_paise: Math.round(PAPER_CAPITAL * 0.30 * 100),
      max_loss_at_30pct_paise: Math.round(PAPER_CAPITAL * 0.30 * (stop_pct / 100) * 100),
      max_target_gain_at_30pct_paise: Math.round(PAPER_CAPITAL * 0.30 * (target_pct / 100) * 100),
      // SIGNAL ENRICHMENT — institutional positioning + event/risk flags
      enrichment_signals: {
        earnings_in_5d: p._enrichment.earnings_in_5d || null,           // CRITICAL: avoid pre-earnings
        whale_deals_5d: p._enrichment.whale_deals_5d || [],              // bulk/block deals
        pledge_recent: p._enrichment.pledge_recent || null,              // pledge change risk
        insider_30d: p._enrichment.insider_30d || null,                  // insider direction
        options: p._enrichment.options || null,                          // PCR, IV skew
      },
    };
  });

  // ★ F-PERS (May 6 evening, P4) — wire owner_profile into the system prompt.
  // Owner profile v2 has STRATEGIC_META_FRAME + RISK_PHILOSOPHY + 4 layer
  // gaps + today's calibration lesson. composeVerdict must pick respecting
  // owner's principles (avoid panic-sell setups, default ₹30K profit-lock,
  // recency-aware override calibration, no-technical-jargon rationale).
  let ownerCtxBlock = '';
  try {
    const profileRow = await env.DB.prepare(
      `SELECT profile_json FROM owner_profile WHERE is_active=1 ORDER BY version DESC LIMIT 1`
    ).first().catch(() => null);
    if (profileRow?.profile_json) {
      const ctx = JSON.parse(profileRow.profile_json);
      // Compact summary — full profile is 7KB, only inject the actionable parts
      const summary = {
        objective: ctx.objective?.primary,
        knowledge_level: ctx.knowledge_level?.self_assessment,
        communication_in_picks: ctx.knowledge_level?.correct_pattern,
        risk_principle_1: ctx.RISK_PHILOSOPHY?.principle_1_avoid_panic_sell_setups?.rule,
        risk_principle_2: ctx.RISK_PHILOSOPHY?.principle_2_profit_locking?.rule,
        anti_patterns: ctx.anti_patterns_to_avoid,
        knowledge_gaps_to_address: ctx.knowledge_gaps_to_fill,
        today_calibration: ctx.TODAY_CALIBRATION_LESSON?.calibration,
      };
      ownerCtxBlock = `\n═══ OWNER CONTEXT (v${profileRow.version || 'unknown'}) — calibrate picks accordingly ═══\n${JSON.stringify(summary, null, 2)}\n
KEY DIRECTIVES:
- Pick rationale must be 1-sentence BUSINESS LOGIC (no technical jargon — owner explicitly avoids candlestick/MACD/RSI lecture)
- Favor stocks with LOW intraday-loss probability (downside_resistance dimension matters as much as upside)
- Default exit at +₹30K — extension only with explicit data-supported case
- Address pending knowledge gaps proactively in narrative (don't make owner ask "why?")\n`;
    }
  } catch (e) {
    console.warn('owner_profile read failed:', e.message);
  }

  const system = `You are a senior Indian-equity intraday trading strategist composing the morning portfolio verdict for an algorithmic system.${ownerCtxBlock}

STRATEGY MODE: INTRADAY DAILY-PROFIT (surgical).
Goal: enter morning, capture intraday peak with trailing stops, exit ALL positions before 14:30 IST. NEVER hold overnight. Sleep flat. Tight stops, achievable targets.

Capital: ₹10,00,000 paper, deployed CONCENTRATED across 2–3 picks (~₹3-4L per stock).

Owner's stated target: 5% min / 10% best-case daily on ₹10L.
Reality: 5%/day on pure cash is ~edge of feasible. Same surgical selection × MIS 5× leverage = 5-10%/day band realistic. Tonight we validate selection on paper at 1×, leverage layer comes after 30-day validation.

SELECTION RULE — pick from the candidates I provide. They're filtered to:
  • Historically hit +2% intraday on ≥50% of days (90-day backtest)
  • ≥₹25 Cr daily turnover (fillable at ₹3-4L)
  • MTF alignment NOT against_macro/aligned_down (vetoed by engine)
  • Hybrid score (70% intraday-suitability + 30% today's regime/catalyst)
Do NOT pick anything outside this list.

Output STRICT JSON only — no prose outside the JSON.

Schema:
{
  "decision": "TRADE" | "SIT_OUT" | "OBSERVE",
  "headline": "≤90 char one-liner of the day's strategy",
  "narrative": "3 short sentences (≤80 words total) — what the engine sees, what to expect, honest about uncertainty",
  "picks": [
    {
      "symbol": "MUST be from intraday_suitable_candidates list provided",
      "weight_pct": 30,                                  // 25-35% per pick (concentrated for daily-profit). 3 picks ≈ 90% deployed, 10% cash buffer.
      "entry_window": "09:30–10:00 IST (open) | 09:45–10:15 IST (15-min confirmation)",
      "stop_pct": "USE the pre-computed stop_pct from candidate's plan (do not override)",
      "target_pct": "USE the pre-computed target_pct from candidate's plan",
      "trail_after_pct": "USE pre-computed trail_after_pct",
      "trail_pct": "USE pre-computed trail_pct",
      "hard_exit_ist": "14:30",                          // ALWAYS 14:30. No overnight. Sleep flat.
      "rationale": "1 sentence — what about TODAY (regime, news, catalyst) makes this stock the right intraday pick"
    }
  ],
  "rejected_setups": [
    { "symbol": "X", "why_not": "1 sentence — usually low R:R or weak today's catalyst" }
  ],
  "risk_flags": [
    "Daily loss limit ₹20,000 (-2% portfolio) — close all + halt if hit",
    "...other concerns specific to today's regime/news"
  ],
  "expected_day_pnl_pct_range": {
    "best_case": "estimated +X% if all 3 picks hit target",
    "median_case": "estimated +X% (weighted by hit-rates)",
    "worst_case": "estimated -X% if all 3 stop out"
  }
}

DECISION RULES:
- SIT_OUT if regime=strong_trending_down OR ≥5 of 9 dims data-blind OR no candidate has reward_risk_history ≥ 1.5
- OBSERVE if regime=high_vol AND no candidate has reward_risk_history ≥ 1.7
- TRADE otherwise → pick 2-3 (NEVER more than 3, NEVER fewer than 2 unless OBSERVE)

PICK SELECTION (RISK-MINIMAL, SURGICAL):
1. Pick from candidate's "hybrid_score" descending (already pre-ranked by reward/risk × green-rate × liquidity)
2. PRIORITIZE candidates with reward_risk_history ≥ 1.7 (starred R:R)
3. SECTOR CONCENTRATION CAP — HARD RULE: NO TWO PICKS in the same "sector" field. If your top 2 are both 'INFORMATION_TECHNOLOGY', drop the lower hybrid_score one and use a different sector. This prevents correlated drawdown when a sector rotates.
4. Avoid 2 picks both with weak today's catalyst
5. NEVER pick a candidate with reward_risk_history < 1.4 (insufficient edge for risk-minimal mode)
6. CONVICTION-WEIGHTED CAPITAL ALLOCATION (May 6 2026 — F1 v2 owner-calibrated):

   Owner explicit rule: "Pick a stock highly less probable to lose money on
   intraday. On ₹10L deployment safely exit at ₹10,30,000."

   Allocate by COMPOSITE CONVICTION = 3 dimensions multiplied:
     A. UPSIDE_CONVICTION = hit_2pct_rate × avg_open_to_high_pct
     B. DOWNSIDE_RESISTANCE = (100 - hit_neg_2pct_rate) × (1 / abs(avg_open_to_low_pct))
        ← THIS IS THE NEW DIMENSION. Owner's panic-sell-avoidance principle.
     C. RECENT_REGIME = hit_2pct_last_week × green_close_last_week
        ← Today's calibration: HFCL won because last-week was 5.81% avg-up
          even though 90d was 2.98%. RECENCY MATTERS.

   Map composite_conviction to weight_pct:
     - VERY HIGH (top quartile composite): weight_pct = 45-50%
     - HIGH (2nd quartile):                weight_pct = 30-35%
     - MEDIUM (3rd quartile):              weight_pct = 20-25%
     - LOW (bottom quartile):              weight_pct = 15-20%
   - Sum ≤ 95% (5% cash buffer)
   - NEVER equal-split. Equal-split is a red flag of laziness.

   In your output, include WEIGHT_RATIONALE field per pick explaining:
     "HFCL 50%: HIGH composite — upside 45 (hit_2pct 55, avg_high 2.98)
      × downside_resistance 8.7 (low hit_neg_2 18, shallow avg_low -1.71)
      × recent_regime 5.8 (last-week 80, green-close 75) = composite 2,288
      → top-quartile of pool → 50% allocation"

   Lazy: "weight_pct=30 because conviction medium" → REJECTED, recompose.

RECENCY (regime_trend field per candidate — THE single most important new signal):
- "HOT" → last-week hit-rate ≥ 1.1× the 90-day average. Stock is currently in a high-volatility window. PRIORITIZE.
- "STABLE" → last-week consistent with 90-day. Default behavior.
- "COOLING" → last-week hit-rate ≤ 0.7× the 90-day average. Stock has shifted regime. AVOID unless strong today's catalyst.
- "INSUFFICIENT_DATA" → no last-week data yet. Use 90-day stats only.

ENRICHMENT SIGNAL RULES (use the enrichment_signals field per candidate):
6. ❌ HARD-EXCLUDE if enrichment_signals.earnings_in_5d is non-null. Earnings during hold = unacceptable gap risk for daily-profit objective. Move to rejected_setups with why_not="earnings within 5d — gap risk".
7. ⚠️ DOWN-WEIGHT if enrichment_signals.pledge_recent shows pledged_pct > 50 OR encumbered_pct rising. Flag in risk_flags.
8. ✅ UP-WEIGHT if enrichment_signals.whale_deals_5d shows institutional BUY (bulk/block buy). Mention in rationale.
9. ✅ UP-WEIGHT if enrichment_signals.insider_30d shows positive net BUY. Mention in rationale.
10. 📊 USE enrichment_signals.options.pcr for directional read: PCR > 1.2 = bullish put-writers (institutions expect price up). PCR < 0.7 = bearish.
11. 📊 USE enrichment_signals.options.iv_skew: positive skew (PE_IV > CE_IV) = put-side hedging premium = caution. Negative skew = bullish.
12. ❌ HARD-EXCLUDE if today is F&O expiry day (last Thursday of month) AND candidate is in F&O — too volatile for daily-profit predictability.

USE THE PRE-COMPUTED STOP/TARGET/TRAIL — DO NOT OVERRIDE.
The candidate's plan parameters are derived from its 90-day history. Stops are tight (≤1.0% cash, capped HARD), targets achievable (70% of typical upside).

DAILY LOSS LIMIT: Always include "Daily loss limit ₹20,000 (-2% portfolio)" as a risk_flag. This is non-negotiable.

Be honest about uncertainty. If candidates are weak, say SIT_OUT or OBSERVE. Don't force trades.`;

  const userPrompt = `Today's market state (machine-extracted from D1):

${JSON.stringify(dataContext, null, 2)}

CANDIDATES — pre-filtered + plan parameters pre-computed:
(These are from the 90-day intraday-suitability backtest, ranked by reward/risk × green-rate × liquidity.
USE the stop_pct / target_pct / trail values exactly as provided. They're math, not opinion.)

${JSON.stringify(candidatePlans, null, 2)}

Compose the verdict JSON. Pick 2-3 from candidates. Do not invent stops or targets.`;

  // 4. Call LLM with graceful tier fallback: Opus → Sonnet → Haiku → engine-only.
  // Anthropic occasionally returns overloaded/529/timeout — we never want the
  // 08:30 morning verdict to be missing. Each tier is cheaper but still smart
  // enough to compose a reasonable verdict from the structured data.
  const callOpts = {
    prompt: userPrompt,
    system,
    // CRITICAL FIX (May 7 2026 morning): max_tokens 1500 was being HIT by all 3 tiers
    // today (Opus + Sonnet + Haiku all returned exactly 1500 output tokens → JSON
    // truncated → parseJsonOutput failed → fell through to engine_only_fallback with
    // misleading "LLM unavailable" narrative. Bumped to 4000 to give the model headroom
    // for: 3 picks × detailed rationale + narrative + alternatives + context refs.
    // Opus 4.5 typical verdict response = ~1800-2400 tokens; 4000 is safe ceiling.
    max_tokens: 4000,
    purpose: 'verdict_compose',
    worker: WORKER_NAME,
    cache_key: `verdict_morning_${today}_${regimeName}_${Math.floor((topPicksRows[0]?.composite_score || 0) / 5) * 5}`,
    cache_ttl_ms: 8 * 3600 * 1000,
  };
  const tiers = [
    { name: 'opus',   call: callOpus,   provider: 'anthropic' },
    { name: 'sonnet', call: callSonnet, provider: 'anthropic' },
    { name: 'haiku',  call: callHaiku,  provider: 'anthropic' },
    // OpenAI fallback (gpt-4.1, JSON mode): fires when every Anthropic tier fails
    // (bad/expired key, overload, malformed JSON). This is what keeps the daily pick
    // alive instead of collapsing to the engine-only SIT_OUT default.
    { name: 'openai-gpt-4.1', call: callOpenAI, provider: 'openai' },
  ];
  // Errors we should fall through on (Anthropic-side / transient):
  const TRANSIENT = /overloaded|529|503|timeout|rate.?limit|service.?unavailable|connection|ECONNRESET|fetch failed/i;

  let result = null;
  let parsed = null;
  let attempts = [];
  let tierUsed = null;

  // Fallback policy: try each tier in order; on ANY Anthropic failure fall through to
  // the next, and ultimately to OpenAI, before the deterministic engine-only verdict.
  // A confirmed Anthropic AUTH failure skips the remaining Anthropic tiers (they share
  // the same key, so they'd fail identically) and jumps straight to OpenAI.
  let anthropicDead = false;
  const AUTH_DEAD = /authentication|invalid x-api-key|permission|unauthorized|401|403/i;
  for (const tier of tiers) {
    if (tier.provider === 'anthropic' && anthropicDead) {
      attempts.push({ tier: tier.name, status: 'skipped_anthropic_auth_dead' });
      continue;
    }
    try {
      const r = await tier.call(env, callOpts);
      const p = parseJsonOutput(r.text);
      if (p && typeof p.decision === 'string') {
        result = r;
        parsed = p;
        tierUsed = tier.name;
        attempts.push({ tier: tier.name, status: 'ok', cost_paise: r.cost_paise });
        break;
      } else {
        // LLM returned but JSON malformed — try next tier
        attempts.push({ tier: tier.name, status: 'malformed_json', raw: (r.text || '').slice(0, 200) });
        continue;
      }
    } catch (e) {
      const msg = (e.message || String(e)).slice(0, 200);
      attempts.push({ tier: tier.name, status: 'failed', error: msg });
      if (tier.provider === 'anthropic' && AUTH_DEAD.test(msg)) anthropicDead = true;
      // Any failure (transient OR hard) advances to the next tier; OpenAI is the
      // final LLM attempt before the engine-only fallback.
      continue;
    }
  }

  // All 3 LLM tiers failed → deterministic engine-only fallback so the
  // morning is never empty. User sees a degraded but informative verdict.
  if (!parsed) {
    const fb = buildEngineOnlyVerdict(dataContext, topPicksRows);
    parsed = fb;
    tierUsed = 'engine_only';
    result = { text: JSON.stringify(fb), cost_paise: 0, cached: false, model_id: 'engine_only_fallback' };
  }

  // The legacy LLM compose path is only narrative unless a tested strategy edge
  // is active. Prevent an unproven-edge LLM response from creating real picks.
  const activeEdgeCfg = await loadStrategyConfig(db).catch(() => null);
  const edgeProven = activeEdgeCfg?.verdict && activeEdgeCfg.verdict !== 'NO_EDGE';
  if (parsed?.decision === 'TRADE' && !edgeProven) {
    parsed.decision = 'SIT_OUT';
    parsed.headline = (`SIT_OUT (no proven edge) - ${parsed.headline || 'LLM trade blocked'}`).slice(0, 200);
    parsed.narrative = `The model suggested a trade, but the active walk-forward strategy config has no proven edge. Trade picks were suppressed. ${parsed.narrative || ''}`.slice(0, 1500);
    parsed.picks = [];
    parsed.recommended_symbol = null;
    parsed.risk_flags = [
      ...(Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []),
      'LLM trade suppressed because no active proven edge is published',
    ];
  }

  // 6. Plan is attached on read by Pages (joins with top_recommendation engine).
  //    Worker just persists Opus's symbol pick — keeps storage minimal + single source of truth.
  const planJson = null;

  // 7. Persist — INTRADAY PORTFOLIO MODE — picks array is the new primary output.
  const picksArr = Array.isArray(parsed.picks) ? parsed.picks : [];
  // Backward-compat: surface first pick as recommended_symbol so old Today UI works
  const firstPick = picksArr[0];
  await db.prepare(`
    INSERT INTO daily_verdicts
      (trade_date, verdict_type, decision, headline, narrative,
       recommended_symbol, recommended_plan_json, alternatives_json,
       context_snapshot_json, composed_at, composed_by_model, cost_paise, cached,
       entry_window, horizon, time_stop_days, pre_event_exit,
       picks_json, strategy_mode, portfolio_capital_paise)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    today, 'morning',
    parsed.decision,
    (parsed.headline || '').slice(0, 200),
    (parsed.narrative || '').slice(0, 1500),
    firstPick?.symbol || parsed.recommended_symbol || null,
    null, // plans live inside picks_json now
    JSON.stringify({
      rejected_setups: parsed.rejected_setups || [],
      risk_flags: parsed.risk_flags || [],
      expected_day_pnl_pct_range: parsed.expected_day_pnl_pct_range || null,
      tier_used: tierUsed,
      attempts: attempts.slice(0, 4),
    }),
    JSON.stringify(dataContext),
    Date.now(),
    result.model_id,
    result.cost_paise || 0,
    result.cached ? 1 : 0,
    firstPick?.entry_window || null,
    'intraday',
    1,                                         // intraday → 1 day
    null,
    JSON.stringify(picksArr),
    'intraday_daily_profit',
    PAPER_CAPITAL * 100,                       // ₹10,00,000 in paise
  ).run();

  return {
    rows: 1,
    decision: parsed.decision,
    symbol: parsed.recommended_symbol,
    tier_used: tierUsed,
    attempts,
    cost_paise: result.cost_paise,
    cached: result.cached,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP-UP EDGE ENGINE — the self-learning intraday loop's live decision-maker.
//   nightly: RTX box walk-forward backtest → wealth_strategy_config (the tuned rule)
//   09:40  : scanGapUp(preopen_snapshot) → point-in-time liquidity gate → exact plan
//   decision: TRADE (edge proven + setup clears) | SIT_OUT (no edge / no setup) — HONEST
// The pick is a coordinate (deterministic). The LLM only writes the narrative.
// ═══════════════════════════════════════════════════════════════════════════

async function loadStrategyConfig(db, strategy = 'gap_up_intraday') {
  return await db.prepare(
    `SELECT * FROM wealth_strategy_config WHERE strategy=? AND is_active=1 ORDER BY published_at DESC LIMIT 1`
  ).bind(strategy).first().catch(() => null);
}

async function loadUserCfg(db, keys) {
  const ph = keys.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT config_key, config_value FROM user_config WHERE config_key IN (${ph})`
  ).bind(...keys).all().catch(() => ({ results: [] }))).results || [];
  const m = {}; for (const r of rows) m[r.config_key] = r.config_value;
  return m;
}

// Exclude index/sector ETFs + bond/gold/silver funds — they gap on flows, not catalysts,
// and are not single-stock intraday setups. Keep real equities only.
function isTradeableEquity(sym) {
  if (!sym) return false;
  const s = sym.toUpperCase();
  return !/(BEES$|ETF$|IETF$|BETF$|^LIQUID|LIQUID$|ADD$|CASE$|^GOLD|GOLD$|^SILVER|SILVER$|^SETF|^NIFTY|NIFTY1$|^BANKNIFTY|^MON100|^MAFANG|^HNGSNG|^PSUBNK|^CPSEETF|^MID150|^NEXT50|^JUNIOR|^MOM\d|^MIDCAP|^SMALLCAP|^METALI|^PHARMABEES|^AUTOBEES|^MAHKTECH|^HDFCNIFTY|^ICICIB22|^QUADFUTURE|^GROWWGOLD|^GROWWSLVR|^TATAGOLD|^TATSILV|^DECNGOLD|^HDFCGOLD|^HDFCSILVER|^AXISGOLD|^AXISILVER|^SBISILVER|^SBILIQ|^GROWWLIQID|^GROWWPOWER|^LIQGRW)/.test(s);
}

// Scan today's pre-open snapshot (full universe, captured 09:00-09:08 IST) for gap-ups,
// then gate by point-in-time trailing-20d liquidity. Returns ranked candidates.
async function scanGapUp(env, db, cfg, today) {
  const gapMin = cfg.gap_min_pct || 3.0;
  const minTurnover = cfg.min_turnover_cr || 10;
  const dayStartMs = Date.now() - 18 * 3600 * 1000; // scope to today's session
  const preRows = (await db.prepare(`
    SELECT p.symbol, p.iep_paise, p.iep_change_pct, p.prev_close_paise, p.total_buy_qty, p.total_sell_qty
    FROM preopen_snapshot p
    JOIN (SELECT symbol, MAX(ts) mts FROM preopen_snapshot WHERE ts > ? GROUP BY symbol) m
      ON p.symbol = m.symbol AND p.ts = m.mts
    WHERE p.iep_change_pct >= ? AND p.iep_paise > 0
    ORDER BY p.iep_change_pct DESC
    LIMIT 80
  `).bind(dayStartMs, gapMin).all().catch(() => ({ results: [] }))).results || [];
  const gappers = preRows.filter(r => isTradeableEquity(r.symbol));
  if (gappers.length === 0) return { candidates: [], scanned: preRows.length, gated: 0, fresh: preRows.length > 0 };

  // point-in-time liquidity: trailing-20d avg turnover (Cr) from equity_eod.
  // Check ALL gappers (not just the biggest-gap ones — those skew illiquid small-caps);
  // the liquid survivors are what the tested edge is actually about.
  const syms = gappers.slice(0, 80).map(r => r.symbol);
  const ph = syms.map(() => '?').join(',');
  const liqRows = (await db.prepare(`
    SELECT symbol, AVG(turnover_cr) liq FROM (
      SELECT symbol, (CAST(volume AS REAL)*close_paise/100.0/1e7) turnover_cr,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) rn
      FROM equity_eod WHERE symbol IN (${ph}) AND volume > 0
    ) WHERE rn <= 20 GROUP BY symbol
  `).bind(...syms).all().catch(() => ({ results: [] }))).results || [];
  const liqBy = {}; for (const r of liqRows) liqBy[r.symbol] = r.liq || 0;

  // earnings-in-5d exclusion (overnight gap risk if held — but mainly avoid event whipsaw)
  const resRows = (await db.prepare(
    `SELECT DISTINCT symbol FROM results_calendar WHERE result_date BETWEEN ? AND date(?, '+5 days')`
  ).bind(today, today).all().catch(() => ({ results: [] }))).results || [];
  const earningsSoon = new Set(resRows.map(r => r.symbol));

  // recent news per gapper (catalyst confirmation tilt)
  const newsRows = (await db.prepare(
    `SELECT symbols_tagged, sentiment_score, importance_score FROM news_items WHERE published_at > ? ORDER BY published_at DESC LIMIT 500`
  ).bind(Date.now() - 36 * 3600 * 1000).all().catch(() => ({ results: [] }))).results || [];
  const newsBy = {};
  for (const n of newsRows) {
    let tags = []; try { tags = JSON.parse(n.symbols_tagged || '[]'); } catch {}
    for (const t of tags) (newsBy[t] = newsBy[t] || []).push(n);
  }

  const candidates = [];
  for (const g of gappers) {
    const liq = liqBy[g.symbol] || 0;
    if (liq < minTurnover) continue;
    if (earningsSoon.has(g.symbol)) continue;
    const news = newsBy[g.symbol] || [];
    const catalyst = news.length ? {
      headlines: news.length,
      sentiment: +(news.reduce((a, n) => a + (n.sentiment_score || 0), 0) / news.length).toFixed(2),
      importance: +Math.max(...news.map(n => n.importance_score || 0)).toFixed(2),
    } : null;
    candidates.push({
      symbol: g.symbol,
      gap_pct: +g.iep_change_pct.toFixed(2),
      open_paise: g.iep_paise,
      prev_close_paise: g.prev_close_paise,
      turnover_cr: +liq.toFixed(1),
      catalyst,
      rank_score: g.iep_change_pct * (liq >= 100 ? 1.0 : liq >= 25 ? 0.9 : 0.8) * (catalyst ? 1.15 : 1.0),
    });
  }
  candidates.sort((a, b) => b.rank_score - a.rank_score);
  return { candidates, scanned: preRows.length, gated: gappers.length, fresh: true };
}

// Pick top-N with a one-per-sector concentration cap (correlated-drawdown guard).
async function pickSectorSpread(db, candidates, maxPicks) {
  if (candidates.length === 0) return [];
  const syms = candidates.map(c => c.symbol);
  const ph = syms.map(() => '?').join(',');
  const secRows = (await db.prepare(
    `SELECT symbol, sector_bucket FROM sector_classification WHERE symbol IN (${ph})`
  ).bind(...syms).all().catch(() => ({ results: [] }))).results || [];
  const secBy = {}; for (const r of secRows) secBy[r.symbol] = r.sector_bucket || 'OTHER';
  const picks = []; const usedSectors = new Set();
  for (const c of candidates) {
    const sec = secBy[c.symbol] || 'OTHER';
    if (sec !== 'OTHER' && usedSectors.has(sec)) continue; // one per known sector
    picks.push({ ...c, sector: sec });
    usedSectors.add(sec);
    if (picks.length >= maxPicks) break;
  }
  return picks;
}

// Best-effort: refine entry to the live 09:40 LTP (fresher than the 09:08 IEP).
// Reads through the Pages /api/kite ltp proxy (not IP-gated). Falls back to IEP on any error.
async function refineEntries(env, picks) {
  if (!picks.length) return;
  for (const p of picks) p.entry_estimate_paise = p.open_paise; // default = pre-open IEP
  try {
    const base = env.PAGES_BASE || 'https://trade.hnhotels.in';
    const qs = picks.map(p => `i=NSE:${encodeURIComponent(p.symbol)}`).join('&');
    const r = await fetch(`${base}/api/kite?action=ltp&${qs}`, {
      headers: { 'x-api-key': env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || '' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;
    const j = await r.json();
    const data = j?.data || {};
    for (const p of picks) {
      const q = data[`NSE:${p.symbol}`];
      if (q && q.last_price > 0) {
        p.entry_estimate_paise = Math.round(q.last_price * 100);
        p.live_quote = true;
      }
    }
  } catch { /* keep IEP entry */ }
}

// Size each pick to the owner's in-play capital, bounded by max risk-per-trade.
// Strategy = WIDE stop + TIME exit (backtest-proven: tight stops whipsaw out).
function sizePicks(picks, cfg, deployablePaise, totalCapPaise, maxRiskPct) {
  const stopPct = cfg.stop_pct || 3.0;
  const targetPct = +Math.max(stopPct * 1.6, 4.0).toFixed(1); // informational ceiling; real exit is time
  const n = picks.length;
  const weightFrac = 0.90 / n; // 10% cash buffer, even split across picks
  // risk cap: position capital so a full stop costs <= maxRiskPct% of TOTAL capital
  const riskCapPaise = maxRiskPct > 0 ? Math.floor(totalCapPaise * (maxRiskPct / stopPct)) : Infinity;
  const out = [];
  for (const p of picks) {
    const entry = p.entry_estimate_paise || p.open_paise;
    if (!entry || entry <= 0) continue;
    const capPaise = Math.min(Math.floor(deployablePaise * weightFrac), riskCapPaise);
    const qty = Math.max(0, Math.floor(capPaise / entry));
    if (qty < 1) continue;
    const stopPaise = Math.round(entry * (1 - stopPct / 100));
    const targetPaise = Math.round(entry * (1 + targetPct / 100));
    const deployedPaise = qty * entry;
    out.push({
      symbol: p.symbol,
      sector: p.sector || 'OTHER',
      weight_pct: +(deployedPaise / deployablePaise * 100).toFixed(1),
      entry_window: '09:40 IST (at scan)',
      entry_estimate_paise: entry,
      live_quote: !!p.live_quote,
      gap_pct: p.gap_pct,
      turnover_cr: p.turnover_cr,
      catalyst: p.catalyst,
      qty,
      capital_deployed_paise: deployedPaise,
      stop_pct: stopPct,
      stop_paise: stopPaise,
      target_pct: targetPct,
      target_paise: targetPaise,
      trail_after_pct: null,
      trail_pct: null,
      hard_exit_ist: cfg.exit_time_ist || '14:30',
      exit_mode: 'time_exit_wide_stop',
      max_loss_paise: qty * (entry - stopPaise),
      max_gain_at_target_paise: qty * (targetPaise - entry),
      rr_ratio: +(targetPct / stopPct).toFixed(2),
      rationale: `Gapped up ${p.gap_pct}% at open on ₹${p.turnover_cr}Cr liquidity${p.catalyst ? ', news catalyst present' : ''}. Hold to ${cfg.exit_time_ist || '14:30'}, wide ${stopPct}% stop.`,
    });
  }
  return out;
}

// LLM narration ONLY (picks are fixed). Honest about the edge. Deterministic fallback.
async function narrateGap(env, today, cfg, decision, picksJson, scan, watch) {
  const det = decision === 'TRADE'
    ? `Engine picked ${picksJson.map(p => p.symbol).join(' + ')} — each gapped up at the open on real liquidity. Plan: enter ~09:40, hold to ${cfg.exit_time_ist}, wide ${cfg.stop_pct}% stop (tight stops whipsaw out — the backtest proved that). Honest: the tested edge is ${cfg.verdict === 'ROBUST_EDGE' ? 'confirmed but small' : 'thin'} (~${cfg.oos_expectancy_pct}%/trade out-of-sample) — size small.`
    : `${scan.gated || 0} stocks gapped up today, but ${cfg.verdict === 'NO_EDGE' ? 'the walk-forward backtest shows no real edge over a random gap pick on this data' : 'none cleared the tuned rule'}. Sitting out is the honest call.${watch.length ? ' Watching: ' + watch.map(w => w.symbol).join(', ') + '.' : ''}`;
  try {
    const sys = `You are narrating an ALREADY-DECIDED intraday gap-up verdict for a non-technical owner. The picks and the decision are FIXED — do NOT change, add, or remove anything. Write a 2-3 sentence plain-English narrative (≤70 words). Be HONEST about the edge: it is ${cfg.verdict} with ~${cfg.oos_expectancy_pct}%/trade out-of-sample expectancy (${cfg.folds_positive} folds positive, p=${cfg.oos_p}). Never fake confidence. Output STRICT JSON: {"narrative":"..."}`;
    const usr = `Decision: ${decision}\nTuned rule: gap≥${cfg.gap_min_pct}%, ${cfg.stop_pct}% stop, exit ${cfg.exit_time_ist}, liquidity≥₹${cfg.min_turnover_cr}Cr.\nPicks: ${JSON.stringify(picksJson.map(p => ({ symbol: p.symbol, gap_pct: p.gap_pct, qty: p.qty, turnover_cr: p.turnover_cr, catalyst: !!p.catalyst })))}\nWatch (if sit-out): ${JSON.stringify(watch)}\nScan: ${scan.scanned} symbols, ${scan.gated} gapped up.`;
    const r = await callOpus(env, { prompt: usr, system: sys, max_tokens: 220, purpose: 'gap_narrate', worker: WORKER_NAME, cache_key: `gap_narr_${today}_${decision}_${picksJson.map(p => p.symbol).join('_')}`, cache_ttl_ms: 6 * 3600 * 1000 });
    const p = parseJsonOutput(r.text);
    if (p && typeof p.narrative === 'string' && p.narrative.length > 10) {
      return { narrative: p.narrative.slice(0, 600), model: r.model_id, cost_paise: r.cost_paise || 0 };
    }
  } catch { /* fall through to deterministic */ }
  return { narrative: det, model: 'gap_engine_deterministic', cost_paise: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCOUT — the daily LEARNING action (additive; never a real trade)
//
// On a NO_EDGE / SIT_OUT day the engine still composes a PAPER scout plan so the
// owner gets a reasoned daily action + a recorded outcome to learn from — instead
// of an empty sit-out screen. It writes ONLY to scout_plans / scout_plan_states
// (migration 0020): never daily_verdicts.decision/picks_json, never paper_trades,
// never any order path. Notional is a tiny FIXED cap, decoupled from real capital,
// so a config flip can never inflate it. No Kite/LTP call — off every broker path.
// HONESTY LAW: a scout is learning + market contact, NOT a proven edge. Gap-ranking
// alone has not beaten a random pick in our year-long tests; the plan says so plainly.
// ═══════════════════════════════════════════════════════════════════════════
const SCOUT_ENABLED = true;
const SCOUT_NOTIONAL_CAP_PAISE = 5000000;   // ₹50,000 paper notional cap/day (decoupled from real capital)
const SCOUT_MAX_PICKS = 3;

// Paper-only sizer — capped, NEVER reads real capital config, no live quote.
function sizeScoutPaper(picks, cfg) {
  const stopPct = (cfg.stop_pct && cfg.stop_pct < 50) ? cfg.stop_pct : 3.0;
  const targetPct = +Math.max(stopPct * 1.6, 4.0).toFixed(1);
  const n = picks.length || 1;
  const perName = Math.floor(SCOUT_NOTIONAL_CAP_PAISE / n);
  const out = [];
  for (const p of picks) {
    const entry = p.open_paise;
    if (!entry || entry <= 0) continue;
    const qty = Math.max(1, Math.floor(perName / entry));
    const stopPaise = Math.round(entry * (1 - stopPct / 100));
    const targetPaise = Math.round(entry * (1 + targetPct / 100));
    out.push({
      symbol: p.symbol, sector: p.sector || 'OTHER',
      gap_pct: p.gap_pct, turnover_cr: p.turnover_cr, catalyst: p.catalyst, rank_score: p.rank_score,
      entry_paise: entry, stop_paise: stopPaise, target_paise: targetPaise,
      stop_pct: stopPct, target_pct: targetPct, qty,
      notional_paise: qty * entry,
      expected_risk_paise: qty * (entry - stopPaise),
      expected_reward_paise: qty * (targetPaise - entry),
      rr_ratio: +(targetPct / stopPct).toFixed(2),
    });
  }
  return out;
}

// Build the "why these, why not the other ~1,200" funnel for the teaching UX.
function composeScoutWhyNot(scan, candidates, picks) {
  const pickSet = new Set(picks.map(p => p.symbol));
  const pickedSectors = new Set(picks.map(p => p.sector));
  const rejected = candidates.filter(c => !pickSet.has(c.symbol)).slice(0, 5).map(c => ({
    symbol: c.symbol, gap_pct: c.gap_pct, turnover_cr: c.turnover_cr,
    reason: (c.sector && pickedSectors.has(c.sector))
      ? 'same sector as a higher-ranked pick (one per sector)'
      : `ranked below the top ${picks.length} on gap × liquidity`,
  }));
  return {
    scanned: scan.scanned,            // pre-open universe seen
    gapped_up: scan.gated,            // cleared the gap threshold
    liquid_scored: candidates.length, // passed the ₹Cr liquidity gate
    picked: picks.length,
    sample_rejected: rejected,
  };
}

// EOD fallback candidate source — used when the live pre-open feed is stale/down
// (so the scout STILL fires every market day). Ranks liquid names by yesterday's
// close-to-close strength × liquidity. Honest: this is yesterday's data, not a live gap.
async function scoutEodFallback(db, cfg) {
  const minTurnover = cfg.min_turnover_cr || 10;
  const rows = (await db.prepare(`
    WITH latest AS (SELECT MAX(trade_date) d FROM equity_eod),
    ranked AS (
      SELECT symbol, trade_date, close_paise, volume,
             LAG(close_paise) OVER (PARTITION BY symbol ORDER BY trade_date) prev_c
      FROM equity_eod
      WHERE trade_date >= date((SELECT d FROM latest), '-7 days')
    )
    SELECT symbol, close_paise, prev_c,
           (CAST(volume AS REAL)*close_paise/100.0/1e7) AS tov,
           100.0*(close_paise - prev_c)/prev_c AS chg
    FROM ranked
    WHERE trade_date = (SELECT d FROM latest) AND prev_c > 0 AND close_paise > 0
  `).all().catch(() => ({ results: [] }))).results || [];
  const cands = rows
    .filter(r => isTradeableEquity(r.symbol) && r.tov >= minTurnover && r.chg > 0)
    .map(r => ({
      symbol: r.symbol, gap_pct: +(+r.chg).toFixed(2), open_paise: r.close_paise,
      prev_close_paise: r.prev_c, turnover_cr: +(+r.tov).toFixed(1), catalyst: null,
      rank_score: r.chg * (r.tov >= 100 ? 1.0 : r.tov >= 25 ? 0.9 : 0.8),
    }))
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, 20);
  return { candidates: cands, scanned: rows.length, gated: cands.length, fresh: false, source: 'eod_fallback' };
}

// Compose + persist today's daily PAPER scout plan. STANDALONE + idempotent: runs
// AFTER composeVerdict regardless of which path decided, so the owner always gets a
// daily learning action — even when the live feed is down (EOD fallback). Fail-CLOSED:
// writes ONLY to scout_plans / scout_plan_states; never daily_verdicts / picks / orders.
async function composeScout(env, db, today) {
  try {
    if (!SCOUT_ENABLED) return null;
    const now = Date.now();
    // idempotent — one PAPER scout per day
    const exists = await db.prepare(
      `SELECT id FROM scout_plans WHERE trade_date=? AND mode='PAPER' LIMIT 1`
    ).bind(today).first().catch(() => null);
    if (exists) return { scout: 'exists', id: exists.id };

    // the verdict spine this scout shadows
    const verdict = await db.prepare(
      `SELECT id, decision FROM daily_verdicts WHERE trade_date=? AND verdict_type='morning' ORDER BY composed_at DESC LIMIT 1`
    ).bind(today).first().catch(() => null);
    const verdictId = verdict?.id ?? null;
    // on a real TRADE day the verdict picks ARE the action — no separate scout needed
    if (verdict && verdict.decision === 'TRADE') return { scout: 'trade_day_skip' };

    const cfg = (await loadStrategyConfig(db).catch(() => null)) || { strategy: 'gap_up_intraday', verdict: 'NO_EDGE', stop_pct: 3.0, exit_time_ist: '14:30' };
    const edgeState = cfg.verdict || 'NO_EDGE';
    const noEdge = edgeState === 'NO_EDGE';

    // candidates: prefer the LIVE pre-open gap scan; if the feed is stale, fall back to EOD.
    let scan = await scanGapUp(env, db, cfg, today).catch(() => null);
    let source = 'live_gap';
    if (!scan || !scan.fresh || !scan.candidates || !scan.candidates.length) {
      scan = await scoutEodFallback(db, cfg);
      source = 'eod_fallback';
    }
    const featuresJson = JSON.stringify({
      source, preopen_fresh: source === 'live_gap',
      scanned: scan?.scanned ?? 0, gapped_up: scan?.gated ?? 0, liquid_scored: scan?.candidates?.length ?? 0,
      config_oos_exp_pct: cfg.oos_expectancy_pct ?? null, folds_positive: cfg.folds_positive ?? null,
      edge_vs_null: cfg.edge_vs_null ?? null, edge_state: edgeState,
    });

    // Nothing to scout at all → honest SKIPPED plan, still on the trail.
    if (!scan || !scan.candidates || !scan.candidates.length) {
      const ins = await db.prepare(`
        INSERT OR IGNORE INTO scout_plans
          (trade_date, strategy, mode, decision, verdict_id, edge_state,
           candidate_symbols_json, primary_symbol, rank_reason, why_not_json,
           features_json, config_oos_exp_pct, honest_expectation,
           state, state_changed_at, owner_action, composed_at, composed_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        today, cfg.strategy || 'gap_up_intraday', 'PAPER', 'SIT_OUT', verdictId, edgeState,
        '[]', null, 'No liquid stock qualified today.',
        JSON.stringify(composeScoutWhyNot(scan || { scanned: 0, gated: 0 }, [], [])),
        featuresJson, cfg.oos_expectancy_pct ?? null,
        'Nothing qualified today. The honest action is to watch the open, take no paper trade, and note why it was a quiet day.',
        'SKIPPED', now, 'auto', now, 'wealth-verdict',
      ).run();
      const pid = ins?.meta?.last_row_id;
      if (pid) await db.prepare(`INSERT INTO scout_plan_states (plan_id, state, reason, at) VALUES (?,?,?,?)`)
        .bind(pid, 'SKIPPED', 'no qualifying candidates', now).run().catch(() => {});
      return { scout: 'SKIPPED', picks: 0, source };
    }

    const top = await pickSectorSpread(db, scan.candidates, SCOUT_MAX_PICKS);
    const scoutPicks = sizeScoutPaper(top, cfg);
    if (!scoutPicks.length) return { scout: 'SKIPPED', picks: 0, source };
    const primary = scoutPicks[0];
    const whyNot = composeScoutWhyNot(scan, scan.candidates, scoutPicks);
    const rankReason = source === 'live_gap'
      ? `Top gap-up (${primary.gap_pct}%) on ₹${primary.turnover_cr}Cr liquidity${primary.catalyst ? ', news catalyst present' : ''}. Honest: gap-ranking alone has NOT beaten a random pick in our year-long tests — a learning pick, not a proven edge.`
      : `Live pre-open feed was down — picked from yesterday's strongest liquid close (${primary.gap_pct}% on ₹${primary.turnover_cr}Cr). Honest: this is yesterday's data, a learning watch only.`;
    const honest = noEdge
      ? 'Learning scout, not a profit trade. No proven edge today (NO_EDGE) — picking among these names is ~breakeven-to-slightly-negative after costs in our tests. PAPER = zero cash; it records what actually happens so you learn the market each day.'
      : `Edge is ${edgeState} (~${cfg.oos_expectancy_pct}%/trade OOS) but small — scouting paper to build contact before sizing real money.`;
    const invalText = `Wrong if it loses the opening level or breaks below VWAP, or doesn't hold its gap by 09:50. Time-stop ${cfg.exit_time_ist || '14:30'} IST.`;
    const invalJson = JSON.stringify({ vwap_break: true, fail_if_no_gap_hold_by: '09:50', time_stop_ist: cfg.exit_time_ist || '14:30', max_adverse_pct: primary.stop_pct });

    const ins = await db.prepare(`
      INSERT OR IGNORE INTO scout_plans
        (trade_date, strategy, mode, decision, verdict_id, config_id, backtest_run_id, edge_state,
         candidate_symbols_json, primary_symbol, rank_reason, why_not_json,
         entry_paise, stop_paise, target_paise, qty, rr_ratio,
         expected_risk_paise, expected_reward_paise, notional_paise,
         invalidation_text, invalidation_json, features_json, config_oos_exp_pct, honest_expectation,
         state, state_changed_at, owner_action, composed_at, composed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      today, cfg.strategy || 'gap_up_intraday', 'PAPER', 'SCOUT', verdictId, cfg.id ?? null, 'gap_edge_nightly', edgeState,
      JSON.stringify(scoutPicks.map(p => p.symbol)), primary.symbol, rankReason, JSON.stringify(whyNot),
      primary.entry_paise, primary.stop_paise, primary.target_paise, primary.qty, primary.rr_ratio,
      primary.expected_risk_paise, primary.expected_reward_paise, scoutPicks.reduce((a, p) => a + p.notional_paise, 0),
      invalText, invalJson, featuresJson, cfg.oos_expectancy_pct ?? null, honest,
      'PLANNED', now, 'auto', now, 'wealth-verdict',
    ).run();
    const pid = ins?.meta?.last_row_id;
    if (pid) await db.prepare(`INSERT INTO scout_plan_states (plan_id, state, reason, at) VALUES (?,?,?,?)`)
      .bind(pid, 'PLANNED', `paper scout composed (${source}): ${scoutPicks.map(p => p.symbol).join(' + ')}`, now).run().catch(() => {});
    return { scout: 'PLANNED', picks: scoutPicks.length, symbols: scoutPicks.map(p => p.symbol), source };
  } catch (e) {
    console.log('composeScout failed (non-fatal):', e?.message || e);
    return null;
  }
}

async function setScoutState(db, planId, state, reason, at) {
  await db.prepare(`UPDATE scout_plans SET state=?, state_changed_at=? WHERE id=?`).bind(state, at, planId).run().catch(() => {});
  await db.prepare(`INSERT INTO scout_plan_states (plan_id,state,reason,at) VALUES (?,?,?,?)`).bind(planId, state, reason, at).run().catch(() => {});
}

// Reconcile prior scout plans into scout_outcomes using EOD OHLC (the worker has no
// intraday bars). Honest COARSE path: target if the day's high reached it; else stop
// if the day's low reached it (conservative — stop assumed first if both hit); else
// time-exit at close. Writes the lesson so the app's learning loop teaches from it.
async function reconcileScouts(env) {
  const db = env.DB;
  const today = istToday();
  let done = 0;
  try {
    const plans = (await db.prepare(`
      SELECT p.* FROM scout_plans p
      LEFT JOIN scout_outcomes o ON o.plan_id = p.id
      WHERE o.id IS NULL AND p.trade_date <= ? AND p.state IN ('PLANNED','ARMED','ENTERED','SKIPPED')
      ORDER BY p.trade_date ASC LIMIT 60
    `).bind(today).all().catch(() => ({ results: [] }))).results || [];
    for (const p of plans) {
      const now = Date.now();
      // SKIPPED / no tradable pick → trivial no-trade outcome
      if (p.decision !== 'SCOUT' || !p.primary_symbol || !p.entry_paise) {
        await db.prepare(`INSERT OR IGNORE INTO scout_outcomes
          (plan_id,trade_date,action_taken,win_loss,pnl_net_paise,caught_grade,lesson_text,pattern_label,reconciled_at)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .bind(p.id, p.trade_date, 'sat_out', 'no_trade', 0, 'sat_out',
            'Quiet day — nothing qualified, no paper trade taken. Sitting out is flat, not a loss.', 'sat_out', now).run().catch(() => {});
        await setScoutState(db, p.id, 'LEARNED', 'reconciled: sat out', now);
        done++; continue;
      }
      const eod = await db.prepare(
        `SELECT open_paise,high_paise,low_paise,close_paise FROM equity_eod WHERE symbol=? AND trade_date=? ORDER BY ingested_at DESC LIMIT 1`
      ).bind(p.primary_symbol, p.trade_date).first().catch(() => null);
      if (!eod || !eod.close_paise) {
        // not observable yet — leave today's plan for the next run; only finalize stale past days
        if (p.trade_date < today) {
          await db.prepare(`INSERT OR IGNORE INTO scout_outcomes
            (plan_id,trade_date,action_taken,win_loss,caught_grade,lesson_text,pattern_label,reconciled_at)
            VALUES (?,?,?,?,?,?,?,?)`)
            .bind(p.id, p.trade_date, 'not_observed', 'no_trade', 'no_data',
              'Could not observe the day — no EOD data for the pick.', 'no_data', now).run().catch(() => {});
          await setScoutState(db, p.id, 'LEARNED', 'reconciled: no EOD', now);
          done++;
        }
        continue;
      }
      const entry = p.entry_paise, target = p.target_paise, stop = p.stop_paise, qty = p.qty || 0;
      const hitStop = stop && eod.low_paise <= stop;
      const hitTarget = target && eod.high_paise >= target;
      let exit, reason, falsifier = 0, falsifierCorrect = null;
      if (hitStop) { exit = stop; reason = 'stop_hit'; falsifier = 1; }   // conservative: stop assumed first if both hit
      else if (hitTarget) { exit = target; reason = 'target_hit'; }
      else { exit = eod.close_paise; reason = 'time_exit'; }
      const gross = qty * (exit - entry);
      const cost = Math.round(qty * entry * 0.0012);                       // ~0.12% MIS round-trip (research cost floor)
      const net = gross - cost;
      const winLoss = net > 0 ? 'win' : net < 0 ? 'loss' : 'flat';
      const r_mult = p.expected_risk_paise ? +(net / p.expected_risk_paise).toFixed(2) : null;
      const oracle = await db.prepare(
        `SELECT symbol, realised_close_pct FROM intraday_winner_daily WHERE trade_date=? AND rank=1 AND source='eod' LIMIT 1`
      ).bind(p.trade_date).first().catch(() => null);
      const pickPct = 100.0 * (eod.close_paise - entry) / entry;
      const caught = pickPct >= 2 ? 'hit' : pickPct >= 0.5 ? 'near' : pickPct <= -1 ? 'far' : 'miss';
      if (hitStop) falsifierCorrect = (eod.close_paise < stop) ? 1 : 0;
      const pattern = reason === 'target_hit' ? 'thesis_held'
        : reason === 'stop_hit' ? 'stop_hit'
        : (Math.abs(pickPct) < 0.5 ? 'momentum_loss' : (pickPct > 0 ? 'partial_run' : 'faded'));
      const lesson = reason === 'target_hit'
        ? `${p.primary_symbol} ran to target. The move held — the kind of day a real edge would catch.`
        : reason === 'stop_hit'
        ? `${p.primary_symbol} broke the stop and ${eod.close_paise < stop ? 'kept falling — the stop was right' : 'recovered after stopping us — the stop was too tight'}.`
        : `${p.primary_symbol} drifted, closed ${pickPct >= 0 ? '+' : ''}${pickPct.toFixed(1)}% from entry. Time-exit, no strong move — a typical no-edge day.`;
      await db.prepare(`INSERT OR IGNORE INTO scout_outcomes
        (plan_id,trade_date,action_taken,actual_entry_paise,actual_exit_paise,actual_qty,exit_reason,
         pnl_gross_paise,pnl_cost_paise,pnl_net_paise,win_loss,r_multiple,
         oracle_top_symbol,oracle_top_pct,caught_grade,falsifier_fired,falsifier_correct,
         lesson_text,pattern_label,reconciled_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.id, p.trade_date, 'paper_observed', entry, exit, qty, reason,
          gross, cost, net, winLoss, r_mult,
          oracle?.symbol || null, oracle?.realised_close_pct ?? null, caught, falsifier, falsifierCorrect,
          lesson, pattern, now).run().catch(() => {});
      await setScoutState(db, p.id, 'LEARNED', `reconciled: ${reason} net ${net}p`, now);
      done++;
    }
  } catch (e) { console.log('reconcileScouts(non-fatal):', e?.message || e); }
  return { rows: done };
}

// EOD learning + scout reconcile (one post-close pass).
async function eodLearningWithScoutReconcile(env) {
  const a = await fireEodLearningAudit(env).catch((e) => ({ error: String(e) }));
  const s = await reconcileScouts(env).catch((e) => ({ error: String(e) }));
  return { rows: (a?.rows || 0) + (s?.rows || 0), eod_learning: a, scout_reconcile: s };
}

// Orchestrates the gap engine: scan → size → narrate → persist. Returns a verdict
// result, or null to fall through to the legacy compose path (no-regression safety net).
async function runGapEngine(env, db, today, cfg, carryover) {
  const scan = await scanGapUp(env, db, cfg, today);
  // If the pre-open feed is empty/stale, we can't run honestly → let legacy path try.
  if (!scan.fresh) return null;

  const uc = await loadUserCfg(db, ['today_deployable_paise', 'total_capital_paise', 'max_active_positions', 'max_risk_per_trade_pct']);
  const deployable = parseInt(uc.today_deployable_paise || uc.total_capital_paise || '10000000', 10);
  const totalCap = parseInt(uc.total_capital_paise || '10000000', 10);
  const maxRiskPct = parseFloat(uc.max_risk_per_trade_pct || '2.0');
  const maxPicks = Math.min(cfg.max_picks || 3, parseInt(uc.max_active_positions || '3', 10));

  const tradable = cfg.verdict && cfg.verdict !== 'NO_EDGE';
  const top = await pickSectorSpread(db, scan.candidates, maxPicks);
  if (tradable && top.length) await refineEntries(env, top);

  let decision, picksJson = [], headline, watch = [];
  if (tradable && top.length) {
    picksJson = sizePicks(top, cfg, deployable, totalCap, maxRiskPct);
  }
  if (picksJson.length) {
    decision = 'TRADE';
    headline = `${picksJson.map(p => p.symbol).join(' + ')} — gap-up ≥${cfg.gap_min_pct}%, hold to ${cfg.exit_time_ist}, wide ${cfg.stop_pct}% stop`;
  } else {
    decision = 'SIT_OUT';
    watch = scan.candidates.slice(0, 6).map(c => ({ symbol: c.symbol, gap_pct: c.gap_pct, turnover_cr: c.turnover_cr, catalyst: !!c.catalyst }));
    headline = !tradable
      ? `SIT OUT — gap-up edge unproven on the tested data (${scan.gated} gappers, but no real edge yet)`
      : `SIT OUT — ${scan.gated} gappers, none cleared the rule today`;
  }

  const narr = await narrateGap(env, today, cfg, decision, picksJson, scan, watch);

  await db.prepare(`
    INSERT INTO daily_verdicts
      (trade_date, verdict_type, decision, headline, narrative,
       recommended_symbol, recommended_plan_json, alternatives_json,
       context_snapshot_json, composed_at, composed_by_model, cost_paise, cached,
       entry_window, horizon, time_stop_days, pre_event_exit,
       picks_json, strategy_mode, portfolio_capital_paise)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    today, 'morning', decision,
    headline.slice(0, 200),
    (narr.narrative || '').slice(0, 1500),
    picksJson[0]?.symbol || null,
    null,
    JSON.stringify({
      engine: 'gap_up',
      edge_verdict: cfg.verdict,
      oos_expectancy_pct: cfg.oos_expectancy_pct,
      oos_trades: cfg.oos_trades,
      folds_positive: cfg.folds_positive,
      edge_vs_null: cfg.edge_vs_null,
      watch,
      risk_flags: [
        `Edge is ${cfg.verdict} (~${cfg.oos_expectancy_pct}%/trade OOS) — size small, this is honest not hype`,
        `Daily loss limit ${Math.round((parseFloat(uc.max_risk_per_trade_pct || '2') / 100) * totalCap / 100)} — stop for the day if hit`,
      ],
      tier_used: narr.model,
    }),
    JSON.stringify({
      engine: 'gap_up_intraday',
      config_date: cfg.config_date,
      tuned_rule: { gap_min_pct: cfg.gap_min_pct, stop_pct: cfg.stop_pct, exit_time_ist: cfg.exit_time_ist, min_turnover_cr: cfg.min_turnover_cr, vol_mult_min: cfg.vol_mult_min },
      scan: { scanned: scan.scanned, gapped_up: scan.gated, cleared: picksJson.length },
      deployable_paise: deployable, carryover: carryover ? 'reviewed' : null,
    }),
    Date.now(),
    narr.model,
    narr.cost_paise || 0,
    0,
    '09:40 IST',
    'intraday', 1, null,
    JSON.stringify(picksJson),
    'intraday_gap_up',
    deployable,
  ).run();

  return {
    rows: 1, engine: 'gap_up', decision,
    picks: picksJson.length, scanned: scan.scanned, gapped_up: scan.gated,
    edge_verdict: cfg.verdict, oos_expectancy_pct: cfg.oos_expectancy_pct,
    symbols: picksJson.map(p => p.symbol),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE B — triageAlerts
//
// Reads unread system_alerts (no classification yet), classifies via Haiku
// into noise|informational|critical. Auto-marks noise as read.
// ═══════════════════════════════════════════════════════════════════════════
async function triageAlerts(env, opts = {}) {
  const db = env.DB;

  // Only triage UNREAD alerts that don't yet have a classification
  const unclassified = (await db.prepare(`
    SELECT a.id, a.severity, a.category, a.title, a.body, a.ts
    FROM system_alerts a
    LEFT JOIN alert_classifications c ON c.alert_id = a.id
    WHERE a.is_read = 0 AND c.alert_id IS NULL
    ORDER BY a.ts DESC LIMIT 30
  `).all()).results || [];

  if (unclassified.length === 0) return { rows: 0, skipped: 'no-unclassified-alerts' };

  let processed = 0;
  let totalCost = 0;
  let cleared = 0;

  for (const a of unclassified) {
    const cacheKey = `alert_class_${a.category}_${(a.title || '').slice(0, 60)}`;

    const system = `You are an alert triager for an algorithmic trading platform. Classify each alert into exactly one bucket — output ONLY a JSON object.

Schema: { "classification": "noise"|"informational"|"critical", "confidence": 0.0-1.0, "reason": "1 short sentence" }

Rules:
- "noise" = repeating watchdog cron-stale messages, expected daily ingest delays, source rate-limit hiccups. Auto-cleared.
- "informational" = data quality dips, missing one symbol's update, low-priority filings. User reads when they want.
- "critical" = stop-loss hit, Kite token expired, broker API down, daily-cap reached, anomalous data spike, regime flip. Surfaces in verdict immediately.`;

    const userPrompt = `Alert:
severity: ${a.severity}
category: ${a.category}
title: ${a.title}
body: ${(a.body || '').slice(0, 400)}

Classify.`;

    let result;
    try {
      result = await callHaiku(env, {
        prompt: userPrompt,
        system,
        max_tokens: 100,
        purpose: 'alert_triage',
        worker: WORKER_NAME,
        cache_key: cacheKey,
        cache_ttl_ms: 30 * 86400000, // 30 days — same-shape alert classifies same
      });
    } catch (e) {
      // If LLM fails, leave alert un-classified — picks up next run
      continue;
    }

    const parsed = parseJsonOutput(result.text);
    if (!parsed || !parsed.classification) continue;

    // Persist classification
    await db.prepare(`
      INSERT OR REPLACE INTO alert_classifications
        (alert_id, classification, confidence, reason, classified_at, classified_by_model, cost_paise)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      a.id,
      parsed.classification,
      parsed.confidence || 0.5,
      (parsed.reason || '').slice(0, 300),
      Date.now(),
      result.model_id,
      result.cost_paise || 0,
    ).run();

    // Auto-clear noise
    if (parsed.classification === 'noise') {
      await db.prepare(`UPDATE system_alerts SET is_read=1 WHERE id=?`).bind(a.id).run();
      cleared++;
    }

    processed++;
    totalCost += result.cost_paise || 0;
  }

  return { rows: processed, cleared_as_noise: cleared, cost_paise: totalCost };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE C — invalidateVerdict
//
// Compares current state to morning verdict's snapshot. If material change
// detected, calls Opus to compose a delta verdict. Most days this is a no-op.
//
// "Material change" triggers (any one):
//   • VIX spiked > 2 points since morning
//   • FII intraday flip (estimate from sector flows or live tape)
//   • Top recommended stock's stop-loss zone breached
//   • Leading sector reversed (top-3 → bottom-3)
//   • Cascade pattern fired that wasn't there at morning
// ═══════════════════════════════════════════════════════════════════════════
async function invalidateVerdict(env, opts = {}) {
  const db = env.DB;
  const today = istToday();
  const force = !!opts.force;

  // Fetch the latest verdict for today (morning OR a previous invalidator)
  const latestVerdict = await db.prepare(`
    SELECT * FROM daily_verdicts WHERE trade_date=? ORDER BY composed_at DESC LIMIT 1
  `).bind(today).first();
  if (!latestVerdict) return { rows: 0, skipped: 'no-morning-verdict-yet' };

  // Don't fire invalidator more than 4× per day (safety)
  const todayInvalidatorCount = (await db.prepare(`
    SELECT COUNT(*) AS n FROM daily_verdicts
    WHERE trade_date=? AND verdict_type='invalidator'
  `).bind(today).first())?.n || 0;
  if (!force && todayInvalidatorCount >= 4) {
    return { rows: 0, skipped: 'invalidator-rate-limited (4/day max)' };
  }

  let snapshot;
  try { snapshot = JSON.parse(latestVerdict.context_snapshot_json || '{}'); }
  catch { return { rows: 0, error: 'snapshot-unparseable' }; }

  // Pull current state of just the things that move
  const [vixNow, latestSig, topPickNow, fiiToday] = await Promise.all([
    db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first(),
    db.prepare(`SELECT MAX(composite_score) AS m FROM signal_scores WHERE computed_at = (SELECT MAX(computed_at) FROM signal_scores)`).first(),
    latestVerdict.recommended_symbol ? db.prepare(`
      SELECT entry_paise, stop_paise FROM trade_cards
      WHERE symbol=? ORDER BY computed_at DESC LIMIT 1
    `).bind(latestVerdict.recommended_symbol).first() : Promise.resolve(null),
    db.prepare(`SELECT fii_net_cr FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 1`).first(),
  ]);

  // Detect material changes
  const triggers = [];
  if (vixNow?.vix && snapshot.india_vix && Math.abs(vixNow.vix - snapshot.india_vix) > 2) {
    triggers.push(`VIX ${snapshot.india_vix.toFixed(1)} → ${vixNow.vix.toFixed(1)} (Δ${(vixNow.vix - snapshot.india_vix).toFixed(1)})`);
  }
  // Stop-loss breach on recommended pick is the highest-priority trigger
  // (we'd need live LTP — defer to next iteration. For now flag if engine score collapses)
  const morningMaxScore = (snapshot.top_5_engine_picks?.[0]?.score) || 0;
  const currentMaxScore = latestSig?.m || 0;
  if (morningMaxScore - currentMaxScore > 8) {
    triggers.push(`Engine top score collapsed ${morningMaxScore.toFixed(1)} → ${currentMaxScore.toFixed(1)}`);
  }

  if (!force && triggers.length === 0) {
    return { rows: 0, skipped: 'no-material-change' };
  }

  // Material change detected → recompose with Opus, lighter prompt
  const system = `You are revising an earlier morning verdict because something material changed mid-day. Output STRICT JSON only.

Schema (same as morning):
{
  "decision": "TRADE" | "SIT_OUT" | "OBSERVE",
  "headline": "≤90 char",
  "narrative": "≤60 words explaining what changed and what to do now",
  "recommended_symbol": null OR a symbol,
  "alternatives": [],
  "risk_flags": []
}

Lean toward SIT_OUT or OBSERVE if anything looks fragile mid-day. The morning verdict already considered the clean state.`;

  const userPrompt = `MORNING VERDICT (issued earlier today):
decision: ${latestVerdict.decision}
headline: ${latestVerdict.headline}
recommended: ${latestVerdict.recommended_symbol || 'none'}
narrative: ${latestVerdict.narrative}

WHAT CHANGED:
${triggers.map(t => '- ' + t).join('\n') || '- (forced refresh)'}

CURRENT STATE:
- VIX now: ${vixNow?.vix?.toFixed(2) || '—'}
- Max engine score now: ${currentMaxScore.toFixed(1)}
- FII today: ${fiiToday?.fii_net_cr?.toFixed(0) || '—'} Cr

Revise the verdict.`;

  let result;
  try {
    result = await callOpus(env, {
      prompt: userPrompt,
      system,
      max_tokens: 400,
      purpose: 'verdict_invalidate',
      worker: WORKER_NAME,
    });
  } catch (e) {
    return { rows: 0, error: 'opus-failed: ' + (e.message || '').slice(0, 200) };
  }

  const parsed = parseJsonOutput(result.text);
  if (!parsed) return { rows: 0, error: 'invalid-json', raw: result.text?.slice(0, 200) };

  await db.prepare(`
    INSERT INTO daily_verdicts
      (trade_date, verdict_type, decision, headline, narrative,
       recommended_symbol, alternatives_json, context_snapshot_json,
       invalidator_reason, composed_at, composed_by_model, cost_paise)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    today, 'invalidator',
    parsed.decision,
    (parsed.headline || '').slice(0, 200),
    (parsed.narrative || '').slice(0, 1000),
    parsed.recommended_symbol || null,
    JSON.stringify({ alternatives: parsed.alternatives || [], risk_flags: parsed.risk_flags || [] }),
    JSON.stringify({ vix_now: vixNow?.vix, current_max_score: currentMaxScore, fii_today: fiiToday?.fii_net_cr }),
    triggers.join(' · '),
    Date.now(),
    result.model_id,
    result.cost_paise || 0,
  ).run();

  return { rows: 1, triggers, decision: parsed.decision, cost_paise: result.cost_paise };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE D.0 (piggybacks autopsy cron) — SUITABILITY REFRESH (16:00 IST daily)
//
// Recompute intraday_suitability from last 90 days of equity_eod. Today's data
// just landed at market close, so tomorrow's morning compose picks from
// freshest possible universe. Replaces the one-time manual populate.
//
// Deterministic SQL only — no LLM cost.
// ═══════════════════════════════════════════════════════════════════════════
async function suitabilityRefresh(env) {
  const db = env.DB;
  try {
    // Atomic refresh: delete + insert in transaction (D1 doesn't support BEGIN, so back-to-back)
    await db.prepare(`DELETE FROM intraday_suitability`).run();
    // BUG FIX (May 6 2026 morning): table has 15 columns (the 12 below + 3
    // last-week enrichment columns added by wealth-intraday-bars). Without an
    // explicit column list, the INSERT requires all 15 values. Result: every
    // 16:30 IST cron fire DELETEd then INSERT failed silently → empty table →
    // composeVerdict had zero candidates → SIT_OUT. Caught morning of May 6.
    // Now: explicit column list, last-week columns left NULL for weekly enrich.
    //
    // F-L1 (May 6 evening, P3): also computes hit_neg_2pct_rate +
    // loss_resistance_score + owner_score for owner's "low intraday-loss
    // probability" principle.
    const r = await db.prepare(`
      INSERT INTO intraday_suitability
        (symbol, hit_2pct_rate, hit_3pct_rate, hit_5pct_rate,
         avg_open_to_high_pct, avg_open_to_low_pct, avg_daily_range_pct,
         green_close_rate, avg_turnover_cr, days_sampled,
         intraday_score, computed_at,
         hit_neg_2pct_rate, loss_resistance_score, owner_score)
      SELECT
        symbol,
        ROUND(AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_2pct_rate,
        ROUND(AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 3 THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_3pct_rate,
        ROUND(AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 5 THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_5pct_rate,
        ROUND(AVG((high_paise - open_paise) * 100.0 / open_paise), 2) AS avg_open_to_high_pct,
        ROUND(AVG((low_paise - open_paise) * 100.0 / open_paise), 2) AS avg_open_to_low_pct,
        ROUND(AVG((high_paise - low_paise) * 100.0 / open_paise), 2) AS avg_daily_range_pct,
        ROUND(AVG(CASE WHEN close_paise > open_paise THEN 1.0 ELSE 0.0 END) * 100, 1) AS green_close_rate,
        ROUND(AVG(CAST(volume AS REAL) * close_paise / 1e9), 1) AS avg_turnover_cr,
        COUNT(*) AS days_sampled,
        ROUND(
          (AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100 * 0.30) +
          (AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 3 THEN 1.0 ELSE 0.0 END) * 100 * 0.25) +
          (AVG(CASE WHEN close_paise > open_paise THEN 1.0 ELSE 0.0 END) * 100 * 0.20) +
          (MIN(AVG((high_paise - open_paise) * 100.0 / open_paise), 4) * 5 * 0.15) +
          (MIN(AVG(CAST(volume AS REAL) * close_paise / 1e9) / 5, 20) * 0.10),
          1
        ) AS intraday_score,
        strftime('%s','now')*1000 AS computed_at,
        -- F-L1 (May 6 evening): downside-resistance dimensions
        ROUND(AVG(CASE WHEN (open_paise - low_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_neg_2pct_rate,
        ROUND(
          (100.0 - (AVG(CASE WHEN (open_paise - low_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100)) * 0.4 +
          (100.0 / (1.0 + ABS(AVG((low_paise - open_paise) * 100.0 / open_paise)))) * 0.4 +
          (AVG(CASE WHEN close_paise > open_paise THEN 1.0 ELSE 0.0 END) * 100 * 0.2),
          1
        ) AS loss_resistance_score,
        ROUND(
          0.6 * (
            (AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100 * 0.30) +
            (AVG(CASE WHEN (high_paise - open_paise) * 100.0 / open_paise >= 3 THEN 1.0 ELSE 0.0 END) * 100 * 0.25) +
            (AVG(CASE WHEN close_paise > open_paise THEN 1.0 ELSE 0.0 END) * 100 * 0.20) +
            (MIN(AVG((high_paise - open_paise) * 100.0 / open_paise), 4) * 5 * 0.15) +
            (MIN(AVG(CAST(volume AS REAL) * close_paise / 1e9) / 5, 20) * 0.10)
          ) +
          0.4 * (
            (100.0 - (AVG(CASE WHEN (open_paise - low_paise) * 100.0 / open_paise >= 2 THEN 1.0 ELSE 0.0 END) * 100)) * 0.4 +
            (100.0 / (1.0 + ABS(AVG((low_paise - open_paise) * 100.0 / open_paise)))) * 0.4 +
            (AVG(CASE WHEN close_paise > open_paise THEN 1.0 ELSE 0.0 END) * 100 * 0.2)
          ),
          1
        ) AS owner_score
      FROM equity_eod
      WHERE trade_date >= date('now', '-90 days')
        AND series = 'EQ'
        AND open_paise > 0
        AND high_paise > low_paise
      GROUP BY symbol
      HAVING days_sampled >= 50
         AND avg_turnover_cr >= 25
         AND hit_2pct_rate >= 50
         AND avg_open_to_high_pct >= 1.5
    `).run();
    return { rows: r.meta?.changes || 0 };
  } catch (e) {
    return { rows: 0, error: String(e).slice(0, 300) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE D.1 — autopsyTrades
//
// For every paper_trade closed today that doesn't already have an autopsy,
// Sonnet writes an 80-word post-mortem + identifies the pattern.
// ═══════════════════════════════════════════════════════════════════════════
async function autopsyTrades(env, opts = {}) {
  const db = env.DB;

  // Schema: paper_trades.is_active=0 means closed; exit_at is the close timestamp.
  // pnl_pct is derived ((exit-entry)/entry*100). hold_days = (exit_at-entry_at)/86400000.
  const closedToday = (await db.prepare(`
    SELECT pt.*, pt.id AS trade_id,
      CASE WHEN pt.entry_paise > 0 AND pt.exit_paise IS NOT NULL
           THEN ROUND(((pt.exit_paise - pt.entry_paise) * 100.0 / pt.entry_paise), 3)
           ELSE NULL END AS pnl_pct_calc,
      CASE WHEN pt.exit_at IS NOT NULL AND pt.entry_at IS NOT NULL
           THEN ROUND((pt.exit_at - pt.entry_at) / 86400000.0, 2)
           ELSE NULL END AS hold_days_calc
    FROM paper_trades pt
    LEFT JOIN paper_trade_autopsies pa ON pa.trade_id = pt.id
    WHERE pt.is_active = 0 AND pa.trade_id IS NULL
      AND pt.exit_at > strftime('%s','now')*1000 - 30*86400000
    ORDER BY pt.exit_at DESC LIMIT 10
  `).all()).results || [];

  if (closedToday.length === 0) return { rows: 0, skipped: 'no-trades-to-autopsy' };

  let processed = 0;
  let totalCost = 0;

  for (const t of closedToday) {
    const pnlPct = t.pnl_pct_calc;
    const holdDays = t.hold_days_calc;
    const outcome = (pnlPct || 0) > 0.5 ? 'win' : (pnlPct || 0) < -0.5 ? 'loss' : 'breakeven';

    const system = `You are a senior trading coach writing a post-mortem for a closed intraday paper trade. Your most important job: distinguish CALCULATED outcomes (planned-and-executed correctly) from LUCK (random variance). Output STRICT JSON only.

Schema:
{
  "narrative": "80-word post-mortem. Honest. Specific. No platitudes.",
  "attribution": "ONE of: EXECUTION_PERFECT | EXECUTION_ERROR | STRATEGY_GAP | LUCKY_WIN | UNLUCKY_LOSS | REGIME_FLIP",
  "pattern_label": "one of: thesis_held | thesis_broken | stop_too_tight | target_too_far | momentum_loss | regime_mismatch | catalyst_misread | clean_winner | clean_loser",
  "what_engine_got_right": "1 sentence",
  "what_engine_got_wrong": "1 sentence (or 'nothing' if EXECUTION_PERFECT)",
  "improvement_signal": "1 specific change to the engine if one is warranted, else null",
  "lessons": ["short lesson 1", "short lesson 2"]
}

ATTRIBUTION RULES (apply rigorously):
- EXECUTION_PERFECT: planned entry hit, planned exit hit, plan was correct. Outcome attributable to good engine + good execution.
- EXECUTION_ERROR: trader (or auto-trader logic) deviated from plan (entered late, exited too early/late, ignored stop). Engine plan was sound, execution failed.
- STRATEGY_GAP: plan itself was wrong — target unrealistic for the day, stop too tight given vol, wrong direction. Even perfect execution would have lost.
- LUCKY_WIN: plan was wrong/marginal but a random move bailed out the trade. Don't reinforce — was luck not skill.
- UNLUCKY_LOSS: plan was right (good R:R, sound thesis) but a random move killed it (gap, news outside engine's view). Don't punish — was luck not skill.
- REGIME_FLIP: market conditions materially changed mid-trade (VIX spike, sector roll). Plan was right at compose time but obsolete by exit time.

Be ruthless on attribution — owner uses this to decide whether to deploy real money. Don't conflate luck with skill or skill with luck.`;

    const userPrompt = `Trade:
symbol: ${t.symbol}
entry: ₹${(t.entry_paise/100).toFixed(2)}
stop: ₹${(t.stop_paise/100).toFixed(2)}
target: ₹${(t.target_paise/100).toFixed(2)}
qty: ${t.qty}
exit: ₹${t.exit_paise ? (t.exit_paise/100).toFixed(2) : '—'}
pnl_pct: ${pnlPct != null ? pnlPct.toFixed(2) + '%' : '—'}
pnl_net_rupees: ${t.pnl_net_paise != null ? '₹' + (t.pnl_net_paise/100).toFixed(0) : '—'}
hold_days: ${holdDays != null ? holdDays.toFixed(1) : '—'}
exit_reason: ${t.exit_reason || '—'}
win_loss: ${t.win_loss || '—'}
user_thesis: ${t.user_thesis || '(none)'}
composite_score_at_entry: ${t.composite_score || '—'}
tranche: ${t.tranche || '—'}
3_question_test: q1=${t.q1_passed} q2=${t.q2_passed} q3=${t.q3_passed}
outcome: ${outcome}

Write the autopsy.`;

    let result;
    try {
      result = await callSonnet(env, {
        prompt: userPrompt,
        system,
        max_tokens: 350,
        purpose: 'paper_autopsy',
        worker: WORKER_NAME,
        cache_key: `autopsy_${t.id}_${t.exit_paise}`,
        cache_ttl_ms: 365 * 86400000, // closed trades don't change
      });
    } catch (e) {
      continue;
    }

    const parsed = parseJsonOutput(result.text);
    if (!parsed?.narrative) continue;

    // Persist with attribution + improvement signal — feeds tomorrow's engine tuning
    await db.prepare(`
      INSERT OR REPLACE INTO paper_trade_autopsies
        (trade_id, symbol, outcome, pnl_pct, hold_days, exit_reason,
         narrative, pattern_label, lessons_json,
         composed_at, composed_by_model, cost_paise)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      t.id, t.symbol, outcome, pnlPct, holdDays, t.exit_reason,
      (parsed.narrative || '').slice(0, 800),
      `${parsed.attribution || 'unknown'}|${parsed.pattern_label || 'unknown'}`.slice(0, 80),
      JSON.stringify({
        attribution: parsed.attribution || null,
        what_right: parsed.what_engine_got_right || null,
        what_wrong: parsed.what_engine_got_wrong || null,
        improvement_signal: parsed.improvement_signal || null,
        lessons: parsed.lessons || [],
      }),
      Date.now(),
      result.model_id,
      result.cost_paise || 0,
    ).run();

    processed++;
    totalCost += result.cost_paise || 0;
  }

  return { rows: processed, cost_paise: totalCost };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE D.2 — composeWeeklyReview
//
// Sunday 18:00 IST: Sonnet reads last week's trades + verdicts, composes
// 200-word review + behavior change suggestion.
// ═══════════════════════════════════════════════════════════════════════════
async function composeWeeklyReview(env, opts = {}) {
  const db = env.DB;
  const force = !!opts.force;

  // Last week's Monday (week we're reviewing)
  const now = new Date(Date.now() + 5.5 * 3600000);
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToLastMonday = dayOfWeek === 0 ? 7 : dayOfWeek + 6;
  const lastMonday = new Date(now.getTime() - daysToLastMonday * 86400000);
  const weekStart = lastMonday.toISOString().slice(0, 10);
  const weekEnd = new Date(lastMonday.getTime() + 6 * 86400000).toISOString().slice(0, 10);

  if (!force) {
    const existing = await db.prepare(`SELECT id FROM weekly_reviews WHERE week_start_date=?`).bind(weekStart).first();
    if (existing) return { rows: 0, skipped: 'already-reviewed-this-week', id: existing.id };
  }

  // Fetch the week's closed trades + verdicts (paper_trades schema: is_active=0 = closed, exit_at = close ts)
  const trades = (await db.prepare(`
    SELECT pt.*,
      CASE WHEN pt.entry_paise > 0 AND pt.exit_paise IS NOT NULL
           THEN ROUND(((pt.exit_paise - pt.entry_paise) * 100.0 / pt.entry_paise), 3)
           ELSE NULL END AS pnl_pct,
      pa.narrative AS autopsy_narrative, pa.pattern_label
    FROM paper_trades pt
    LEFT JOIN paper_trade_autopsies pa ON pa.trade_id = pt.id
    WHERE pt.is_active = 0 AND pt.exit_at >= ? AND pt.exit_at < ?
    ORDER BY pt.exit_at ASC
  `).bind(
    new Date(weekStart + 'T00:00:00Z').getTime(),
    new Date(weekEnd + 'T23:59:59Z').getTime() + 1000,
  ).all()).results || [];

  const verdicts = (await db.prepare(`
    SELECT trade_date, decision, headline, recommended_symbol
    FROM daily_verdicts
    WHERE trade_date BETWEEN ? AND ? AND verdict_type='morning'
    ORDER BY trade_date ASC
  `).bind(weekStart, weekEnd).all()).results || [];

  if (trades.length === 0 && verdicts.length === 0) {
    return { rows: 0, skipped: 'no-activity-this-week' };
  }

  const wins = trades.filter(t => (t.pnl_pct || 0) > 0.5).length;
  const losses = trades.filter(t => (t.pnl_pct || 0) < -0.5).length;
  const breakeven = trades.length - wins - losses;
  const netPnl = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
  const best = trades.length ? trades.reduce((b, t) => (t.pnl_pct || 0) > (b.pnl_pct || 0) ? t : b) : null;
  const worst = trades.length ? trades.reduce((w, t) => (t.pnl_pct || 0) < (w.pnl_pct || 0) ? t : w) : null;

  const system = `You are a trading coach writing a weekly review for a beginner trader. Output STRICT JSON only.

Schema:
{
  "narrative": "200-word week summary. What worked, what didn't, what the engine learned.",
  "behavior_change": "1-2 sentence specific suggested change for next week. Concrete, not abstract."
}`;

  const userPrompt = `Week: ${weekStart} to ${weekEnd}

Trades:
${trades.map(t => `- ${t.symbol}: ${t.pnl_pct?.toFixed(2)}% (${t.exit_reason || 'manual'}) — ${t.pattern_label || 'unlabeled'} — ${t.autopsy_narrative?.slice(0, 100) || ''}`).join('\n') || '(no trades)'}

Daily verdicts:
${verdicts.map(v => `- ${v.trade_date}: ${v.decision} ${v.recommended_symbol ? `(${v.recommended_symbol})` : ''}`).join('\n') || '(no verdicts)'}

Stats:
- Trades: ${trades.length} (${wins}W / ${losses}L / ${breakeven}B)
- Net P&L: ${netPnl.toFixed(2)}%
- Best: ${best?.symbol || '—'} (${best?.pnl_pct?.toFixed(2) || 0}%)
- Worst: ${worst?.symbol || '—'} (${worst?.pnl_pct?.toFixed(2) || 0}%)

Write the review.`;

  let result;
  try {
    result = await callSonnet(env, {
      prompt: userPrompt,
      system,
      max_tokens: 600,
      purpose: 'weekly_review',
      worker: WORKER_NAME,
    });
  } catch (e) {
    return { rows: 0, error: 'sonnet-failed: ' + (e.message || '').slice(0, 200) };
  }

  const parsed = parseJsonOutput(result.text);
  if (!parsed?.narrative) return { rows: 0, error: 'invalid-json' };

  await db.prepare(`
    INSERT OR REPLACE INTO weekly_reviews
      (week_start_date, trades_won, trades_lost, trades_breakeven, net_pnl_pct,
       best_trade_symbol, worst_trade_symbol, narrative, behavior_change,
       trades_summary_json, composed_at, composed_by_model, cost_paise)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    weekStart, wins, losses, breakeven, netPnl,
    best?.symbol || null, worst?.symbol || null,
    (parsed.narrative || '').slice(0, 2000),
    (parsed.behavior_change || '').slice(0, 500),
    JSON.stringify(trades.map(t => ({ symbol: t.symbol, pnl_pct: t.pnl_pct, pattern: t.pattern_label }))),
    Date.now(),
    result.model_id,
    result.cost_paise || 0,
  ).run();

  return { rows: 1, weekStart, trades: trades.length, cost_paise: result.cost_paise };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE D.4 — EOD Learning Audit fire (18:30 IST daily)
// Calls the Pages endpoint that computes attribution + Sonnet narrative.
// Result persists to eod_learning_audits table for compounding monthly trail.
// ═══════════════════════════════════════════════════════════════════════════
async function fireEodLearningAudit(env) {
  const dashboardKey = env.DASHBOARD_KEY;
  if (!dashboardKey) return { rows: 0, error: 'no-dashboard-key' };
  try {
    const r = await fetch(
      `https://hnhotels.in/api/trading?action=eod_learning_audit&force=1&key=${encodeURIComponent(dashboardKey)}`,
      { signal: AbortSignal.timeout(120000) }
    );
    if (!r.ok) return { rows: 0, error: `pages-endpoint-${r.status}` };
    const j = await r.json();
    if (!j.ok) return { rows: 0, error: j.reason || 'audit-failed' };
    return {
      rows: 1,
      audit_date: j.audit_date,
      picks_correct: j.summary?.picks_correct,
      picks_total: j.summary?.picks_total,
      pnl_paise: j.summary?.realized_pnl_paise,
      sonnet_cost_paise: j.cost_paise,
    };
  } catch (e) {
    return { rows: 0, error: String(e.message || e).slice(0, 200) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON DISPATCH — match cron expression to handler
// ═══════════════════════════════════════════════════════════════════════════
// Compose the morning verdict, THEN always compose the daily PAPER scout (idempotent,
// non-fatal). The scout gives the owner a daily learning action even on no-edge days
// without ever touching the verdict decision / picks / order path.
async function composeVerdictWithScout(env, opts = {}) {
  const v = await composeVerdict(env, opts);
  let scout = null;
  try { scout = await composeScout(env, env.DB, istToday()); } catch (e) { console.log('scout(non-fatal):', e?.message || e); }
  return { ...v, scout };
}

const CRON_DISPATCH = {
  '0 2 * * 1-5':              { name: 'pre_market', fn: composePreMarketBriefing },  // 07:30 IST
  '10 4 * * 1-5':             { name: 'compose',    fn: composeVerdictWithScout },// 09:40 IST (after first live signal batch ~09:30) — verdict + daily scout
  '*/5 * * * *':              { name: 'triage',     fn: triageAlerts },          // every 5 min
  // TZ-7 fix May 6 2026 evening: invalidator now covers EXACTLY 09:15-15:30 IST.
  // 3 dispatch entries → same handler. Was just '0,15,30,45 4-9' (09:30-15:15 IST).
  '45 3 * * 1-5':             { name: 'invalidate', fn: invalidateVerdict },     // 09:15 IST market open
  '0,15,30,45 4-9 * * 1-5':   { name: 'invalidate', fn: invalidateVerdict },     // 09:30-15:15 IST every 15 min
  '0 10 * * 1-5':             { name: 'invalidate', fn: invalidateVerdict },     // 15:30 IST market close
  '30 10 * * 1-5':            { name: 'autopsy',    fn: autopsyTrades },         // 16:00 IST
  '0 11 * * 1-5':             { name: 'suit_refresh', fn: suitabilityRefresh },  // 16:30 IST
  '0 13 * * 1-5':             { name: 'eod_learning', fn: eodLearningWithScoutReconcile },// 18:30 IST — daily learning trail + scout reconcile
  '30 3 * * 1':               { name: 'weekly',     fn: composeWeeklyReview },   // Mon 09:00 IST
};

const HTTP_HANDLERS = {
  pre_market:    composePreMarketBriefing,
  compose:       composeVerdictWithScout,
  scout:         (env) => composeScout(env, env.DB, istToday()).then(r => ({ rows: r?.picks || 0, ...r })),
  reconcile_scout: (env) => reconcileScouts(env),
  triage:        triageAlerts,
  invalidate:    invalidateVerdict,
  autopsy:       autopsyTrades,
  weekly:        composeWeeklyReview,
  suit_refresh:  suitabilityRefresh,
  eod_learning:  fireEodLearningAudit,
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }
    const m = url.pathname.match(/^\/run\/([a-z_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, m[1], 'http');
      try {
        const r = await HTTP_HANDLERS[m[1]](env, { force: url.searchParams.get('force') === '1' });
        await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error || null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return new Response('wealth-verdict — Phase A/B/C/D autonomous Claude operator', { status: 200 });
  },
};
