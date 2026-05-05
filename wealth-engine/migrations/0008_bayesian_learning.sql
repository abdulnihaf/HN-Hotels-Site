-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0008: Bayesian post-trade learning
--
-- After every closed trade we update Beta(α, β) posteriors per signal-bucket.
-- Adaptive sizing reads the posterior win-rate + average R:R back, replacing
-- the hardcoded priors with empirical numbers as the dataset grows.
--
-- Bucket dimensions:
--   * tranche                 (base / aggressive / stretch)
--   * score_band              (90+ / 80-90 / 70-80)
--   * cascade_pattern         (RBI_RATE_CUT_NBFC_LAG / FII_HEAVY_BOUNCE / ...
--                              / null when no cascade match)
--   * regime                  (trending_up / trending_down / ranging /
--                              high_vol — derived at signal time)
--
-- Posterior:
--   α (alpha)  = wins  + 1   (Laplace prior)
--   β (beta)   = losses + 1
--   E[win_rate] = α / (α + β)
--   95% CI uses incomplete beta function — for now we just track the means.
--
-- After 30 trades in a bucket, posterior overrides the prior in adaptiveRiskPct.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bayesian_priors (
  bucket_key       TEXT PRIMARY KEY,         -- composite key: tranche|band|cascade|regime
  tranche          TEXT,
  score_band       TEXT,                      -- '90+', '80-90', '70-80'
  cascade_pattern  TEXT,                      -- nullable
  regime           TEXT,                      -- 'trending_up'|'trending_down'|'ranging'|'high_vol'|'unknown'

  alpha            INTEGER NOT NULL DEFAULT 1, -- wins + 1 (Laplace)
  beta             INTEGER NOT NULL DEFAULT 1, -- losses + 1

  win_count        INTEGER NOT NULL DEFAULT 0,
  loss_count       INTEGER NOT NULL DEFAULT 0,
  total_trades     INTEGER NOT NULL DEFAULT 0,

  sum_pnl_pct      REAL NOT NULL DEFAULT 0,   -- cumulative % return per trade
  sum_win_pct      REAL NOT NULL DEFAULT 0,
  sum_loss_pct     REAL NOT NULL DEFAULT 0,
  sum_rr_realized  REAL NOT NULL DEFAULT 0,   -- realized R:R for sizing input

  avg_hold_days    REAL,
  last_updated_at  INTEGER,
  first_observed_at INTEGER,
  last_pnl_pct     REAL,                      -- latest trade for streak detection
  consecutive_wins  INTEGER NOT NULL DEFAULT 0,
  consecutive_losses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bayesian_band ON bayesian_priors(score_band);
CREATE INDEX IF NOT EXISTS idx_bayesian_cascade ON bayesian_priors(cascade_pattern);

-- Per-trade learning log — append-only audit trail
CREATE TABLE IF NOT EXISTS bayesian_observations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               INTEGER NOT NULL,
  position_id      INTEGER,                  -- FK to position_watchlist.id (if real trade)
  backtest_run_id  TEXT,                     -- FK to backtest_runs.run_id (if simulated)
  bucket_key       TEXT NOT NULL,
  tranche          TEXT,
  score_band       TEXT,
  cascade_pattern  TEXT,
  regime           TEXT,

  symbol           TEXT,
  composite_score  REAL,
  entry_paise      INTEGER,
  exit_paise       INTEGER,
  pnl_pct          REAL,
  pnl_paise        INTEGER,
  win_loss         TEXT,                      -- 'win' | 'loss' | 'flat'
  hold_days        INTEGER,
  exit_reason      TEXT,

  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obs_ts ON bayesian_observations(ts DESC);
CREATE INDEX IF NOT EXISTS idx_obs_bucket ON bayesian_observations(bucket_key, ts);
