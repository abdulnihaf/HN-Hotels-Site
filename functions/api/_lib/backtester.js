// ═══════════════════════════════════════════════════════════════════════════
// Backtester — walk-forward replay of trade card generator over equity_eod
// history. Outputs aggregate stats + per-trade rows.
//
// Scope (v1):
//   - Universe = top N most-liquid NSE stocks by avg volume in lookback window
//   - Period   = recent K trading days
//   - Signal   = simplified composite score from price/volume/delivery only
//                (we don't have full historical FII per-symbol or cascades)
//   - Entry    = next-day open after signal day
//   - Stops    = tranche default (5/7/10% based on score band)
//   - Targets  = adaptive R:R per score band (1.4 / 1.7 / 2.0 / 2.3)
//   - Exit     = stop hit, target hit, or 30-day timeout
//   - Costs    = full round-trip CNC cost model
//
// Designed to fit in a single Worker invocation when scoped tight (~30 stocks
// × 180 days = ~5400 evaluations). Larger sweeps should chunk via run_id.
// ═══════════════════════════════════════════════════════════════════════════

import { roundTripCostCnc, adaptiveMinRR, adaptiveRiskPct } from './costModel.js';
import { recordObservation, scoreBand } from './bayesianLearner.js';

// ─────────────────────────────────────────────────────────
// Simplified signal scoring — what we'd score historically
// using ONLY data we have full historical depth on.
//
// Inputs: array of last 60 trading days for one symbol, oldest-first.
// Returns: { composite_score, sub_scores } or null if insufficient data.
// ─────────────────────────────────────────────────────────
export function scoreSymbolSimple(rows, minHistory = 30) {
  if (!rows || rows.length < minHistory) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!last.close_paise || !prev?.close_paise) return null;

  // Trend (40%): % above 20-day SMA + slope
  const sma20 = avgClose(rows.slice(-20));
  const sma50 = rows.length >= 50 ? avgClose(rows.slice(-50)) : sma20;
  const aboveSma20 = (last.close_paise - sma20) / sma20 * 100;
  const aboveSma50 = (last.close_paise - sma50) / sma50 * 100;
  const sma20Slope = (sma20 - avgClose(rows.slice(-25, -5))) / sma20 * 100;
  // Normalize: +5% above 20SMA = 80, +0% = 50, -5% = 20
  const trendScore = clamp(50 + aboveSma20 * 6 + sma20Slope * 4, 0, 100);

  // Flow (30%): volume vs avg + delivery %
  const avgVol20 = avg(rows.slice(-20).map(r => r.volume || 0));
  const volumeRatio = avgVol20 > 0 ? (last.volume || 0) / avgVol20 : 1;
  const deliveryPct = last.delivery_pct || 50;
  // High volume (>1.5x avg) + high delivery (>50%) = real buying
  const flowScore = clamp(
    (volumeRatio > 1.5 ? 70 : volumeRatio > 1 ? 55 : 40) +
    (deliveryPct - 50) * 0.4,
    0, 100
  );

  // Momentum (15%): 5-day ROC + 20-day ROC
  const roc5 = rows.length >= 6 ? (last.close_paise - rows[rows.length - 6].close_paise) / rows[rows.length - 6].close_paise * 100 : 0;
  const roc20 = rows.length >= 21 ? (last.close_paise - rows[rows.length - 21].close_paise) / rows[rows.length - 21].close_paise * 100 : 0;
  const momentumScore = clamp(50 + roc5 * 3 + roc20 * 1.5, 0, 100);

  // Volatility regime (15%): tight ATR = better entry, wide = wait
  const atr14 = avgRange(rows.slice(-14));
  const atrPct = atr14 / last.close_paise * 100;
  // 1-2% ATR = ideal (50-80), >4% = high vol caution
  const volRegimeScore = clamp(80 - Math.abs(atrPct - 1.5) * 12, 0, 100);

  // Composite
  const composite =
    trendScore * 0.40 +
    flowScore * 0.30 +
    momentumScore * 0.15 +
    volRegimeScore * 0.15;

  return {
    composite_score: parseFloat(composite.toFixed(2)),
    sub_scores: {
      trend: Math.round(trendScore),
      flow: Math.round(flowScore),
      momentum: Math.round(momentumScore),
      vol_regime: Math.round(volRegimeScore),
    },
    above_sma20: parseFloat(aboveSma20.toFixed(2)),
    delivery_pct: deliveryPct,
    volume_ratio: parseFloat(volumeRatio.toFixed(2)),
    atr_pct: parseFloat(atrPct.toFixed(2)),
  };
}

function avgClose(rows) { return avg(rows.map(r => r.close_paise || 0)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function avgRange(rows) {
  return avg(rows.map(r => (r.high_paise || r.close_paise || 0) - (r.low_paise || r.close_paise || 0)));
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ─────────────────────────────────────────────────────────
// Pick N most-liquid symbols in the window leading up to `asOf`.
// "Most-liquid" = highest average traded value × volume.
// Strategy: try pre-`asOf` lookback first (no look-ahead bias). If that
// returns nothing because the dataset is too thin, fall back to the entire
// available history — the backtester is still useful for smoke testing.
// ─────────────────────────────────────────────────────────
export async function selectLiquidUniverse(db, { topN = 30, lookbackDays = 60, asOf = null }) {
  const anchor = asOf || (await db.prepare(
    `SELECT MAX(trade_date) AS d FROM equity_eod WHERE exchange='NSE'`
  ).first())?.d;
  if (!anchor) return [];

  // Strict (no-look-ahead): days strictly before anchor within window
  let r = await db.prepare(`
    SELECT symbol, AVG(close_paise * volume) AS avg_traded_value, COUNT(*) AS days
    FROM equity_eod
    WHERE exchange='NSE'
      AND trade_date BETWEEN date(?, '-' || ? || ' days') AND date(?, '-1 days')
      AND close_paise > 0 AND volume > 0
    GROUP BY symbol HAVING days >= 1
    ORDER BY avg_traded_value DESC LIMIT ?
  `).bind(anchor, lookbackDays, anchor, topN).all();

  if ((r.results || []).length >= Math.min(topN, 5)) {
    return r.results.map(x => x.symbol);
  }

  // Fallback: use entire available equity_eod (smoke-test mode)
  r = await db.prepare(`
    SELECT symbol, AVG(close_paise * volume) AS avg_traded_value, COUNT(*) AS days
    FROM equity_eod
    WHERE exchange='NSE' AND close_paise > 0 AND volume > 0
    GROUP BY symbol HAVING days >= 1
    ORDER BY avg_traded_value DESC LIMIT ?
  `).bind(topN).all();
  return (r.results || []).map(x => x.symbol);
}

// ─────────────────────────────────────────────────────────
// List all distinct trade dates in equity_eod within range, sorted ascending.
// ─────────────────────────────────────────────────────────
export async function listTradeDates(db, { from, to }) {
  const r = await db.prepare(`
    SELECT DISTINCT trade_date
    FROM equity_eod
    WHERE exchange='NSE' AND trade_date BETWEEN ? AND ?
    ORDER BY trade_date ASC
  `).bind(from, to).all();
  return (r.results || []).map(x => x.trade_date);
}

// ─────────────────────────────────────────────────────────
// Bulk-load full price history for one symbol over [from..to]
// ─────────────────────────────────────────────────────────
export async function loadSymbolHistory(db, symbol, from, to) {
  const r = await db.prepare(`
    SELECT trade_date, open_paise, high_paise, low_paise, close_paise,
           prev_close_paise, volume, delivery_pct
    FROM equity_eod
    WHERE exchange='NSE' AND symbol=? AND trade_date BETWEEN ? AND ?
    ORDER BY trade_date ASC
  `).bind(symbol, from, to).all();
  return r.results || [];
}

// ─────────────────────────────────────────────────────────
// Tranche assignment based on composite score.
// ─────────────────────────────────────────────────────────
function assignTranche(composite) {
  if (composite >= 90) return 'stretch';     // Highest conviction → highest variance
  if (composite >= 80) return 'aggressive';
  return 'base';
}

const STOP_PCT = { base: 5.0, aggressive: 7.0, stretch: 10.0 };

// ─────────────────────────────────────────────────────────
// Run a single backtest sweep. Persists run + per-trade rows to D1.
//
// config = {
//   universe?: string[]      // explicit symbol list, OR omit for auto top-N
//   topN?: number            // if no universe — top-N most liquid; default 30
//   from: 'YYYY-MM-DD',      // signal-date range start
//   to:   'YYYY-MM-DD',      // signal-date range end
//   minScore?: number        // default 70
//   rrRule?: 'flat' | 'adaptive'  // default 'adaptive'
//   flatRR?: number          // if rrRule='flat', this is the ratio (default 2.0)
//   maxHoldDays?: number     // exit if neither stop nor target hit (default 30)
//   capital?: number         // starting paise (default 10_000_000 = ₹1L)
//   riskRule?: 'flat' | 'adaptive'  // sizing rule (default 'adaptive')
//   flatRiskPct?: number     // if 'flat', this % (default 2)
//   maxConcurrent?: number   // open positions cap (default 3)
// }
// ─────────────────────────────────────────────────────────
export async function runBacktest(db, config = {}) {
  const cfg = {
    topN: 30, from: null, to: null,
    minScore: 70, rrRule: 'adaptive', flatRR: 2.0,
    maxHoldDays: 30, capital: 10_000_000,
    riskRule: 'adaptive', flatRiskPct: 2.0, maxConcurrent: 3,
    minHistory: 30,                  // bars of history required before scoring (smoke-mode: lower this)
    feedBayesian: false,             // when true, every simulated trade updates bayesian_priors
    ...config,
  };
  if (!cfg.from || !cfg.to) throw new Error('from + to required');

  const runId = `bt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  await db.prepare(
    `INSERT INTO backtest_runs (run_id, started_at, status, config_json) VALUES (?, ?, 'running', ?)`
  ).bind(runId, startedAt, JSON.stringify(cfg)).run();

  try {
    // 1. Pick universe — anchor liquidity ranking to the BACKTEST's start date,
    // not wall-clock today (so we avoid look-ahead bias and old data still works)
    const universe = cfg.universe && cfg.universe.length
      ? cfg.universe
      : await selectLiquidUniverse(db, { topN: cfg.topN, lookbackDays: 60, asOf: cfg.from });

    // 2. Pre-load full history for each symbol (one query per symbol — N queries)
    // We fetch a buffer of 60 days BEFORE `from` for SMA/ATR computation, plus
    // up to maxHoldDays AFTER `to` for exit price discovery.
    const fromDate = new Date(cfg.from + 'T00:00:00Z');
    const toDate = new Date(cfg.to + 'T00:00:00Z');
    const bufferStart = new Date(fromDate.getTime() - 90 * 86400000);
    const bufferEnd   = new Date(toDate.getTime() + (cfg.maxHoldDays + 5) * 86400000);
    const bufferStartStr = bufferStart.toISOString().slice(0, 10);
    const bufferEndStr   = bufferEnd.toISOString().slice(0, 10);

    const histMap = {};
    for (const sym of universe) {
      histMap[sym] = await loadSymbolHistory(db, sym, bufferStartStr, bufferEndStr);
    }

    // 3. Build a set of valid trade dates (any symbol traded that day)
    const tradeDateSet = new Set();
    for (const sym of universe) {
      for (const r of histMap[sym]) tradeDateSet.add(r.trade_date);
    }
    const allDates = [...tradeDateSet].sort();
    const signalDates = allDates.filter(d => d >= cfg.from && d <= cfg.to);

    // 4. Walk forward over signal dates
    const trades = [];
    const equityCurve = [];
    let capital = cfg.capital;
    let activePositions = []; // {symbol, entry_date, entry_paise, stop_paise, target_paise, qty, tranche, score}

    for (const signalDate of signalDates) {
      // Resolve any active positions with this date
      activePositions = activePositions.filter(pos => {
        const histRow = histMap[pos.symbol].find(r => r.trade_date === signalDate);
        if (!histRow) return true; // no data this day, keep open
        // Check if stop or target hit using high/low
        const high = histRow.high_paise || histRow.close_paise;
        const low  = histRow.low_paise  || histRow.close_paise;
        // Simulate: if both stop AND target could hit same day, assume stop hits first (conservative)
        if (low <= pos.stop_paise) {
          return closeTrade(pos, signalDate, pos.stop_paise, 'stop_hit', trades, c => capital += c);
        }
        if (high >= pos.target_paise) {
          return closeTrade(pos, signalDate, pos.target_paise, 'target_hit', trades, c => capital += c);
        }
        // Hold-day timeout
        const holdDays = daysBetween(pos.entry_date, signalDate);
        if (holdDays >= cfg.maxHoldDays) {
          return closeTrade(pos, signalDate, histRow.close_paise, 'timeout', trades, c => capital += c);
        }
        return true;
      });

      // Skip new signals when concurrency capped
      if (activePositions.length >= cfg.maxConcurrent) {
        equityCurve.push({ trade_date: signalDate, capital_paise: capital, active_positions: activePositions.length });
        continue;
      }

      // Score each symbol AS OF this signal date
      const candidates = [];
      for (const sym of universe) {
        // Skip if already in an open position
        if (activePositions.some(p => p.symbol === sym)) continue;
        const hist = histMap[sym].filter(r => r.trade_date <= signalDate);
        const scored = scoreSymbolSimple(hist, cfg.minHistory);
        if (!scored) continue;
        if (scored.composite_score < cfg.minScore) continue;
        candidates.push({ symbol: sym, ...scored, last: hist[hist.length - 1] });
      }

      // Sort by score, take top up to (maxConcurrent - active)
      candidates.sort((a, b) => b.composite_score - a.composite_score);
      const slotsOpen = cfg.maxConcurrent - activePositions.length;

      for (const cand of candidates.slice(0, slotsOpen)) {
        // Find next-day open price for entry
        const futureRows = histMap[cand.symbol].filter(r => r.trade_date > signalDate);
        if (futureRows.length === 0) continue;
        const entryRow = futureRows[0];
        const entryPaise = entryRow.open_paise || entryRow.close_paise;
        if (!entryPaise) continue;

        // Tranche + stop %
        const tranche = assignTranche(cand.composite_score);
        const stopPctVal = STOP_PCT[tranche];

        // R:R rule
        const minRR = cfg.rrRule === 'flat' ? cfg.flatRR : adaptiveMinRR(cand.composite_score);
        const targetPctVal = stopPctVal * minRR;
        const stopPaise = Math.round(entryPaise * (1 - stopPctVal / 100));
        const targetPaise = Math.round(entryPaise * (1 + targetPctVal / 100));
        const riskPerShare = entryPaise - stopPaise;

        // Sizing rule
        const riskPct = cfg.riskRule === 'flat' ? cfg.flatRiskPct / 100 : adaptiveRiskPct(cand.composite_score);
        const maxRiskPaise = Math.floor(capital * riskPct);
        const qtyByRisk = Math.floor(maxRiskPaise / riskPerShare);
        if (qtyByRisk < 1) continue;

        // Cap by available capital (don't deploy more than 50% of free cash in a single trade)
        const maxByCash = Math.floor(capital * 0.5 / entryPaise);
        const qty = Math.min(qtyByRisk, maxByCash);
        if (qty < 1) continue;

        activePositions.push({
          symbol: cand.symbol,
          entry_date: entryRow.trade_date,
          signal_date: signalDate,
          entry_paise: entryPaise,
          stop_paise: stopPaise,
          target_paise: targetPaise,
          qty,
          tranche,
          composite_score: cand.composite_score,
          rr: minRR,
        });
      }

      equityCurve.push({ trade_date: signalDate, capital_paise: capital, active_positions: activePositions.length });
    }

    // Force-close any remaining open positions at last available close
    for (const pos of activePositions) {
      const lastRow = histMap[pos.symbol].slice().reverse().find(r => r.trade_date >= pos.entry_date);
      if (!lastRow) continue;
      closeTrade(pos, lastRow.trade_date, lastRow.close_paise, 'end_of_data', trades, c => capital += c);
    }

    // 5. Persist trades + equity curve
    if (trades.length > 0) {
      // batch insert in chunks
      const cols = ['run_id','signal_date','symbol','tranche','composite_score',
        'entry_date','entry_paise','stop_paise','target_paise','rr_ratio','qty',
        'exit_date','exit_paise','exit_reason','hold_days',
        'pnl_gross_paise','pnl_net_paise','cost_paise','win_loss'];
      const placeholder = '(' + cols.map(() => '?').join(',') + ')';
      const BATCH = 5; // 19 cols × 5 = 95 params (under 100 limit)
      for (let i = 0; i < trades.length; i += BATCH) {
        const chunk = trades.slice(i, i + BATCH);
        const sql = `INSERT INTO backtest_trades (${cols.join(',')}) VALUES ${chunk.map(() => placeholder).join(',')}`;
        const params = [];
        for (const t of chunk) {
          params.push(runId, t.signal_date, t.symbol, t.tranche, t.composite_score,
            t.entry_date, t.entry_paise, t.stop_paise, t.target_paise, t.rr_ratio, t.qty,
            t.exit_date, t.exit_paise, t.exit_reason, t.hold_days,
            t.pnl_gross_paise, t.pnl_net_paise, t.cost_paise, t.win_loss);
        }
        await db.prepare(sql).bind(...params).run();
      }
    }

    if (equityCurve.length > 0) {
      const BATCH = 25; // 4 cols × 25 = 100 params
      for (let i = 0; i < equityCurve.length; i += BATCH) {
        const chunk = equityCurve.slice(i, i + BATCH);
        const sql = `INSERT OR REPLACE INTO backtest_equity_curve (run_id, trade_date, capital_paise, active_positions) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')}`;
        const params = [];
        for (const e of chunk) params.push(runId, e.trade_date, e.capital_paise, e.active_positions);
        await db.prepare(sql).bind(...params).run();
      }
    }

    // 5b. Feed Bayesian learner if requested (opt-in to avoid polluting priors
    // with backtest data unless user explicitly wants empirical-from-history).
    if (cfg.feedBayesian) {
      for (const t of trades) {
        try {
          await recordObservation(db, {
            backtest_run_id: runId,
            tranche: t.tranche,
            score_band: scoreBand(t.composite_score),
            cascade_pattern: null,    // simplified scoring doesn't have cascade matching
            regime: 'backtest',       // tag separately so backtest data can be filtered out if needed
            symbol: t.symbol,
            composite_score: t.composite_score,
            entry_paise: t.entry_paise,
            exit_paise: t.exit_paise,
            pnl_paise: t.pnl_net_paise,
            hold_days: t.hold_days,
            exit_reason: t.exit_reason,
          });
        } catch {}
      }
    }

    // 6. Compute aggregates
    const wins = trades.filter(t => t.win_loss === 'win').length;
    const losses = trades.filter(t => t.win_loss === 'loss').length;
    const timeouts = trades.filter(t => t.exit_reason === 'timeout' || t.exit_reason === 'end_of_data').length;
    const winRatePct = trades.length > 0 ? wins / trades.length * 100 : 0;
    const winningTrades = trades.filter(t => t.win_loss === 'win');
    const losingTrades  = trades.filter(t => t.win_loss === 'loss');
    const avgWinPct = winningTrades.length > 0
      ? avg(winningTrades.map(t => t.pnl_net_paise / (t.entry_paise * t.qty) * 100)) : 0;
    const avgLossPct = losingTrades.length > 0
      ? avg(losingTrades.map(t => Math.abs(t.pnl_net_paise) / (t.entry_paise * t.qty) * 100)) : 0;
    const expectancyPct = (winRatePct / 100) * avgWinPct - (1 - winRatePct / 100) * avgLossPct;
    const totalReturnPct = (capital - cfg.capital) / cfg.capital * 100;

    // Max drawdown from equity curve
    let peak = cfg.capital, maxDD = 0;
    for (const e of equityCurve) {
      if (e.capital_paise > peak) peak = e.capital_paise;
      const dd = (peak - e.capital_paise) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    // Annualized Sharpe ≈ avg-daily-return / std-daily-return × sqrt(252)
    const dailyRets = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const r = (equityCurve[i].capital_paise - equityCurve[i-1].capital_paise) / equityCurve[i-1].capital_paise;
      dailyRets.push(r);
    }
    const meanRet = dailyRets.length ? avg(dailyRets) : 0;
    const sdRet = stdev(dailyRets);
    const sharpe = sdRet > 0 ? (meanRet / sdRet) * Math.sqrt(252) : 0;

    const totalCosts = trades.reduce((s, t) => s + (t.cost_paise || 0), 0);

    await db.prepare(`
      UPDATE backtest_runs SET
        finished_at=?, status='done',
        total_trades=?, wins=?, losses=?, timeouts=?,
        win_rate_pct=?, avg_win_pct=?, avg_loss_pct=?,
        expectancy_pct=?, total_return_pct=?,
        max_drawdown_pct=?, sharpe=?, costs_paise=?
      WHERE run_id=?
    `).bind(
      Date.now(), trades.length, wins, losses, timeouts,
      parseFloat(winRatePct.toFixed(2)), parseFloat(avgWinPct.toFixed(2)), parseFloat(avgLossPct.toFixed(2)),
      parseFloat(expectancyPct.toFixed(2)), parseFloat(totalReturnPct.toFixed(2)),
      parseFloat(maxDD.toFixed(2)), parseFloat(sharpe.toFixed(3)), totalCosts,
      runId
    ).run();

    return {
      run_id: runId,
      universe_size: universe.length,
      signal_dates_count: signalDates.length,
      trades: trades.length,
      wins, losses, timeouts,
      win_rate_pct: parseFloat(winRatePct.toFixed(2)),
      avg_win_pct: parseFloat(avgWinPct.toFixed(2)),
      avg_loss_pct: parseFloat(avgLossPct.toFixed(2)),
      expectancy_pct: parseFloat(expectancyPct.toFixed(2)),
      total_return_pct: parseFloat(totalReturnPct.toFixed(2)),
      max_drawdown_pct: parseFloat(maxDD.toFixed(2)),
      sharpe: parseFloat(sharpe.toFixed(3)),
      costs_paise: totalCosts,
      final_capital_paise: capital,
    };
  } catch (e) {
    await db.prepare(
      `UPDATE backtest_runs SET status='failed', finished_at=?, notes=? WHERE run_id=?`
    ).bind(Date.now(), String(e).slice(0, 500), runId).run();
    throw e;
  }
}

// ─────────────────────────────────────────────────────────
// Helper: close an open position, append trade row to result list,
// release capital. Returns false to drop from active list.
// ─────────────────────────────────────────────────────────
function closeTrade(pos, exitDate, exitPaise, reason, trades, addCapital) {
  const grossPnl = (exitPaise - pos.entry_paise) * pos.qty;
  const cost = roundTripCostCnc(pos.entry_paise, exitPaise, pos.qty).total_paise;
  const netPnl = grossPnl - cost;
  const winLoss = netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'flat';
  trades.push({
    signal_date: pos.signal_date,
    symbol: pos.symbol, tranche: pos.tranche, composite_score: pos.composite_score,
    entry_date: pos.entry_date, entry_paise: pos.entry_paise,
    stop_paise: pos.stop_paise, target_paise: pos.target_paise,
    rr_ratio: pos.rr, qty: pos.qty,
    exit_date: exitDate, exit_paise: exitPaise, exit_reason: reason,
    hold_days: daysBetween(pos.entry_date, exitDate),
    pnl_gross_paise: grossPnl, pnl_net_paise: netPnl, cost_paise: cost,
    win_loss: winLoss,
  });
  // Return capital + net pnl to pool
  const proceeds = pos.entry_paise * pos.qty + netPnl;
  addCapital(netPnl); // capital diff = net pnl (entry capital was never actually subtracted from `capital` in this simple model)
  return false;
}

function daysBetween(d1, d2) {
  return Math.round((new Date(d2 + 'T00:00:00Z') - new Date(d1 + 'T00:00:00Z')) / 86400000);
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
