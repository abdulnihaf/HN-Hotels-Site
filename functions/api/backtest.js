// ═══════════════════════════════════════════════════════════════════════════
// /api/backtest — walk-forward backtester for the trade-card system.
//
// Endpoints:
//   ?action=run&from=YYYY-MM-DD&to=YYYY-MM-DD[&topN=30][&rrRule=adaptive|flat][&riskRule=adaptive|flat][&minScore=70]
//      Runs a fresh backtest synchronously, persists to D1, returns summary
//   ?action=runs[&limit=20]              — list recent runs
//   ?action=run_detail&run_id=…          — fetch full run + per-trade rows
//   ?action=compare_rr&from=…&to=…       — runs flat-2:1 vs adaptive side by side
//
// All endpoints require ?key=DASHBOARD_API_KEY
// ═══════════════════════════════════════════════════════════════════════════

import { runBacktest } from './_lib/backtester.js';

export const onRequest = async (ctx) => {
  const url = new URL(ctx.request.url);
  const action = url.searchParams.get('action') || 'runs';
  const key = url.searchParams.get('key');
  const env = ctx.env;
  const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

  if (key !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }
  const db = env.WEALTH_DB;
  if (!db) return new Response(JSON.stringify({ error: 'WEALTH_DB binding missing' }), { status: 500, headers });

  try {
    switch (action) {
      case 'run':         return Response.json(await doRun(db, url), { headers });
      case 'runs':        return Response.json(await listRuns(db, url), { headers });
      case 'run_detail':  return Response.json(await runDetail(db, url), { headers });
      case 'compare_rr':  return Response.json(await compareRrRules(db, url), { headers });
      default:            return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers });
  }
};

async function doRun(db, url) {
  const cfg = {
    from: url.searchParams.get('from'),
    to:   url.searchParams.get('to'),
    topN: parseInt(url.searchParams.get('topN') || '30'),
    minScore: parseInt(url.searchParams.get('minScore') || '70'),
    rrRule: url.searchParams.get('rrRule') || 'adaptive',
    flatRR: parseFloat(url.searchParams.get('flatRR') || '2.0'),
    riskRule: url.searchParams.get('riskRule') || 'adaptive',
    flatRiskPct: parseFloat(url.searchParams.get('flatRiskPct') || '2.0'),
    maxHoldDays: parseInt(url.searchParams.get('maxHoldDays') || '30'),
    capital: parseInt(url.searchParams.get('capital') || '10000000'),
    maxConcurrent: parseInt(url.searchParams.get('maxConcurrent') || '3'),
    minHistory: parseInt(url.searchParams.get('minHistory') || '30'),
    feedBayesian: url.searchParams.get('feedBayesian') === '1',
  };
  if (!cfg.from || !cfg.to) throw new Error('from + to required (YYYY-MM-DD)');
  return await runBacktest(db, cfg);
}

async function listRuns(db, url) {
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const r = await db.prepare(`
    SELECT * FROM backtest_runs ORDER BY started_at DESC LIMIT ?
  `).bind(limit).all();
  return { runs: r.results || [] };
}

async function runDetail(db, url) {
  const runId = url.searchParams.get('run_id');
  if (!runId) throw new Error('run_id required');
  const run = await db.prepare(`SELECT * FROM backtest_runs WHERE run_id=?`).bind(runId).first();
  if (!run) throw new Error('run not found');
  const trades = (await db.prepare(
    `SELECT * FROM backtest_trades WHERE run_id=? ORDER BY signal_date ASC, composite_score DESC`
  ).bind(runId).all()).results || [];
  const equity = (await db.prepare(
    `SELECT * FROM backtest_equity_curve WHERE run_id=? ORDER BY trade_date ASC`
  ).bind(runId).all()).results || [];
  // Per-tranche breakdown
  const byTranche = {};
  for (const t of trades) {
    if (!byTranche[t.tranche]) byTranche[t.tranche] = { count: 0, wins: 0, losses: 0, pnl: 0 };
    byTranche[t.tranche].count += 1;
    if (t.win_loss === 'win') byTranche[t.tranche].wins += 1;
    if (t.win_loss === 'loss') byTranche[t.tranche].losses += 1;
    byTranche[t.tranche].pnl += t.pnl_net_paise || 0;
  }
  // Per-score-band breakdown
  const byScore = { '90+': null, '80-90': null, '70-80': null };
  for (const k of Object.keys(byScore)) byScore[k] = { count: 0, wins: 0, losses: 0, pnl: 0 };
  for (const t of trades) {
    const k = t.composite_score >= 90 ? '90+' : t.composite_score >= 80 ? '80-90' : '70-80';
    byScore[k].count += 1;
    if (t.win_loss === 'win') byScore[k].wins += 1;
    if (t.win_loss === 'loss') byScore[k].losses += 1;
    byScore[k].pnl += t.pnl_net_paise || 0;
  }
  return { run, trades, equity_curve: equity, by_tranche: byTranche, by_score_band: byScore };
}

async function compareRrRules(db, url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const topN = parseInt(url.searchParams.get('topN') || '30');
  const minScore = parseInt(url.searchParams.get('minScore') || '70');
  if (!from || !to) throw new Error('from + to required');
  const baseCfg = { from, to, topN, minScore, capital: 10000000, maxConcurrent: 3, maxHoldDays: 30 };
  const flatRun = await runBacktest(db, { ...baseCfg, rrRule: 'flat', flatRR: 2.0, riskRule: 'flat', flatRiskPct: 2.0 });
  const adaptiveRun = await runBacktest(db, { ...baseCfg, rrRule: 'adaptive', riskRule: 'adaptive' });
  return {
    config: baseCfg,
    flat_2_to_1_2pct: flatRun,
    adaptive_kelly: adaptiveRun,
    delta: {
      trades:    adaptiveRun.trades - flatRun.trades,
      win_rate_pct: adaptiveRun.win_rate_pct - flatRun.win_rate_pct,
      total_return_pct: adaptiveRun.total_return_pct - flatRun.total_return_pct,
      max_drawdown_pct: adaptiveRun.max_drawdown_pct - flatRun.max_drawdown_pct,
      expectancy_pct: adaptiveRun.expectancy_pct - flatRun.expectancy_pct,
      sharpe: adaptiveRun.sharpe - flatRun.sharpe,
    },
  };
}
