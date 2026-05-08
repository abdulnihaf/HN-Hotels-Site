// ═══════════════════════════════════════════════════════════════════════════
// Bayesian post-trade learner
//
// After each closed trade we update Beta(α, β) posteriors per bucket and
// expose smoothed empirical win-rate + R:R for adaptive sizing.
//
// Why Bayesian (vs. running average)?
//   - Handles small sample sizes gracefully (Laplace prior = neutral)
//   - Smoothly transitions from priors → empirical as data accumulates
//   - Built-in uncertainty (we know how confident we are about each bucket)
//
// Bucketing scheme:
//   bucket_key = `${tranche}|${score_band}|${cascade_pattern || 'none'}|${regime}`
// ═══════════════════════════════════════════════════════════════════════════

// Score bands match adaptiveRiskPct
export function scoreBand(composite) {
  if (composite >= 90) return '90+';
  if (composite >= 80) return '80-90';
  if (composite >= 70) return '70-80';
  return '<70';
}

// Make the bucket key — short, deterministic
export function bucketKey({ tranche, score_band, cascade_pattern, regime }) {
  return [
    tranche || 'base',
    score_band || '<70',
    cascade_pattern || 'none',
    regime || 'unknown',
  ].join('|');
}

// ─────────────────────────────────────────────────────────
// Record one observation. Updates both:
//   1. bayesian_observations (append-only log)
//   2. bayesian_priors        (running posterior per bucket)
// ─────────────────────────────────────────────────────────
export async function recordObservation(db, obs) {
  const {
    position_id = null, backtest_run_id = null,
    tranche, score_band, cascade_pattern = null, regime = 'unknown',
    symbol, composite_score, entry_paise, exit_paise, pnl_paise, hold_days, exit_reason,
  } = obs;

  if (entry_paise == null || exit_paise == null) {
    throw new Error('recordObservation requires entry_paise + exit_paise');
  }

  const pnlPct = entry_paise > 0 ? (exit_paise - entry_paise) / entry_paise * 100 : 0;
  const winLoss = pnlPct > 0.05 ? 'win' : pnlPct < -0.05 ? 'loss' : 'flat';
  const key = bucketKey({ tranche, score_band, cascade_pattern, regime });
  const now = Date.now();

  // Append to observations log
  await db.prepare(`
    INSERT INTO bayesian_observations
      (ts, position_id, backtest_run_id, bucket_key, tranche, score_band,
       cascade_pattern, regime, symbol, composite_score, entry_paise,
       exit_paise, pnl_pct, pnl_paise, win_loss, hold_days, exit_reason, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    now, position_id, backtest_run_id, key, tranche || 'base', score_band, cascade_pattern,
    regime, symbol, composite_score, entry_paise, exit_paise, pnlPct, pnl_paise,
    winLoss, hold_days, exit_reason || null, now
  ).run();

  // Upsert posterior
  // Posterior update: α += win, β += loss (with Laplace prior of 1 already in)
  const isWin = winLoss === 'win';
  const isLoss = winLoss === 'loss';

  // Realized R:R: if win, gain%/risk%. If loss, just count as 1× risk taken.
  // We track sum_rr_realized so we can derive avg_rr later.
  // For sizing, what we want is empirical avg_rr ≈ (sum_win_pct/wins) / (sum_loss_pct/losses)
  const winPct = isWin ? Math.abs(pnlPct) : 0;
  const lossPct = isLoss ? Math.abs(pnlPct) : 0;

  // Get current row to compute streak
  const cur = await db.prepare(`SELECT * FROM bayesian_priors WHERE bucket_key=?`).bind(key).first();
  const nextConsecWins = isWin ? (cur?.consecutive_wins || 0) + 1 : 0;
  const nextConsecLosses = isLoss ? (cur?.consecutive_losses || 0) + 1 : 0;

  await db.prepare(`
    INSERT INTO bayesian_priors
      (bucket_key, tranche, score_band, cascade_pattern, regime,
       alpha, beta, win_count, loss_count, total_trades,
       sum_pnl_pct, sum_win_pct, sum_loss_pct,
       avg_hold_days, last_updated_at, first_observed_at,
       last_pnl_pct, consecutive_wins, consecutive_losses)
    VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      alpha           = bayesian_priors.alpha + ?,
      beta            = bayesian_priors.beta + ?,
      win_count       = bayesian_priors.win_count + ?,
      loss_count      = bayesian_priors.loss_count + ?,
      total_trades    = bayesian_priors.total_trades + 1,
      sum_pnl_pct     = bayesian_priors.sum_pnl_pct + ?,
      sum_win_pct     = bayesian_priors.sum_win_pct + ?,
      sum_loss_pct    = bayesian_priors.sum_loss_pct + ?,
      avg_hold_days   = ((bayesian_priors.avg_hold_days * bayesian_priors.total_trades) + ?) / (bayesian_priors.total_trades + 1),
      last_updated_at = ?,
      last_pnl_pct    = ?,
      consecutive_wins = ?,
      consecutive_losses = ?
  `).bind(
    // INSERT values (first time bucket seen — Laplace prior = α=β=1, plus this trade)
    key, tranche || 'base', score_band, cascade_pattern, regime,
    1 + (isWin ? 1 : 0), 1 + (isLoss ? 1 : 0),
    isWin ? 1 : 0, isLoss ? 1 : 0, 1,
    pnlPct, winPct, lossPct,
    hold_days || 0, now, now,
    pnlPct, nextConsecWins, nextConsecLosses,
    // ON CONFLICT update values
    isWin ? 1 : 0, isLoss ? 1 : 0,
    isWin ? 1 : 0, isLoss ? 1 : 0,
    pnlPct, winPct, lossPct,
    hold_days || 0,
    now, pnlPct, nextConsecWins, nextConsecLosses,
  ).run();

  return { bucket_key: key, win_loss: winLoss, pnl_pct: pnlPct };
}

// ─────────────────────────────────────────────────────────
// Read posterior for a bucket. Returns posterior win_rate, avg_win_pct,
// avg_loss_pct, avg_rr_realized, sample size.
// `prior` is the fallback when sample size is too small.
//
// Uses bucket cascade — start specific, fall back broader if low sample:
//   1. Exact bucket: tranche|band|cascade|regime
//   2. Drop regime: tranche|band|cascade|*
//   3. Drop cascade: tranche|band|*|*
//   4. Just tranche+band: *|band|*|*
// ─────────────────────────────────────────────────────────
const MIN_SAMPLES_FOR_POSTERIOR = 30;

export async function getPosterior(db, { tranche, score_band, cascade_pattern, regime }, prior = null) {
  // Build cascade of bucket keys to try
  const candidates = [
    bucketKey({ tranche, score_band, cascade_pattern, regime }),
    bucketKey({ tranche, score_band, cascade_pattern, regime: '*' }),
    bucketKey({ tranche, score_band, cascade_pattern: '*', regime: '*' }),
    bucketKey({ tranche: '*', score_band, cascade_pattern: '*', regime: '*' }),
  ];

  for (const key of candidates) {
    // For wildcards we aggregate across matching rows
    const useWildcard = key.includes('*');
    let row;
    if (!useWildcard) {
      row = await db.prepare(`SELECT * FROM bayesian_priors WHERE bucket_key=?`).bind(key).first();
    } else {
      // Convert to LIKE pattern
      const likePattern = key.replace(/\*/g, '%');
      row = await db.prepare(`
        SELECT
          'aggregate' AS bucket_key,
          SUM(alpha) AS alpha, SUM(beta) AS beta,
          SUM(win_count) AS win_count, SUM(loss_count) AS loss_count,
          SUM(total_trades) AS total_trades,
          SUM(sum_pnl_pct) AS sum_pnl_pct,
          SUM(sum_win_pct) AS sum_win_pct,
          SUM(sum_loss_pct) AS sum_loss_pct
        FROM bayesian_priors WHERE bucket_key LIKE ?
      `).bind(likePattern).first();
    }
    if (!row || !row.total_trades || row.total_trades < MIN_SAMPLES_FOR_POSTERIOR) continue;

    // Posterior win rate = α / (α + β)
    const alpha = row.alpha || 1;
    const beta = row.beta || 1;
    const winRate = alpha / (alpha + beta);
    const avgWinPct = row.win_count > 0 ? row.sum_win_pct / row.win_count : 0;
    const avgLossPct = row.loss_count > 0 ? row.sum_loss_pct / row.loss_count : 0;
    const avgRR = avgLossPct > 0 ? avgWinPct / avgLossPct : 1;

    return {
      source: 'empirical',
      bucket_used: key,
      total_trades: row.total_trades,
      win_count: row.win_count,
      loss_count: row.loss_count,
      win_rate: parseFloat(winRate.toFixed(3)),
      avg_win_pct: parseFloat(avgWinPct.toFixed(2)),
      avg_loss_pct: parseFloat(avgLossPct.toFixed(2)),
      avg_rr_realized: parseFloat(avgRR.toFixed(2)),
      sum_pnl_pct: parseFloat((row.sum_pnl_pct || 0).toFixed(2)),
      // 95% credible interval (approx via normal — fine for sizing)
      ci_low:  parseFloat(Math.max(0, winRate - 1.96 * Math.sqrt(winRate * (1-winRate) / row.total_trades)).toFixed(3)),
      ci_high: parseFloat(Math.min(1, winRate + 1.96 * Math.sqrt(winRate * (1-winRate) / row.total_trades)).toFixed(3)),
    };
  }

  // No bucket has enough data — fall back to prior
  return prior
    ? { source: 'prior', ...prior }
    : { source: 'prior', win_rate: null, avg_rr_realized: null, total_trades: 0 };
}

// ─────────────────────────────────────────────────────────
// Helper: derive simple regime classification from indices_eod.
// Used at the moment a trade is opened so we can bucket it correctly.
// ─────────────────────────────────────────────────────────
export async function detectRegime(db) {
  // Pull last 20 trading days of Nifty 50 and India VIX
  const niftyRows = (await db.prepare(`
    SELECT trade_date, close_paise
    FROM indices_eod WHERE index_name = 'NIFTY 50' AND close_paise > 0
    ORDER BY trade_date DESC LIMIT 21
  `).all()).results || [];

  if (niftyRows.length < 6) return 'unknown';

  const latest = niftyRows[0].close_paise;
  const day5 = niftyRows[Math.min(5, niftyRows.length - 1)].close_paise;
  const day20 = niftyRows[Math.min(20, niftyRows.length - 1)].close_paise;
  const change5 = (latest - day5) / day5 * 100;
  const change20 = (latest - day20) / day20 * 100;

  // VIX context
  const vixRow = await db.prepare(
    `SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`
  ).first();
  const vix = vixRow?.vix || 14;

  if (vix > 18) return 'high_vol';
  if (change20 > 4 && change5 > 1) return 'trending_up';
  if (change20 < -4 && change5 < -1) return 'trending_down';
  return 'ranging';
}
