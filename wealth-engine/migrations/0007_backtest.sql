-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0007: Backtest framework
--
-- Walk-forward replay of the trade-card generator over historical equity_eod
-- data. Lets us answer empirically: what edge does this system actually have?
-- Each backtest_run is one configuration sweep; each backtest_trade is one
-- simulated entry+exit so we can compute win-rate, expected value, drawdown,
-- and break out by score-band / tranche / R:R rule.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backtest_runs (
  run_id          TEXT PRIMARY KEY,         -- ULID-style; client-supplied or auto
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  status          TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
  config_json     TEXT NOT NULL,            -- {universe, from, to, rr_rule, stop_pct, capital, ...}

  -- Aggregate result columns (denormalized for fast read)
  total_trades        INTEGER DEFAULT 0,
  wins                INTEGER DEFAULT 0,
  losses              INTEGER DEFAULT 0,
  timeouts            INTEGER DEFAULT 0,
  win_rate_pct        REAL,
  avg_win_pct         REAL,
  avg_loss_pct        REAL,
  expectancy_pct      REAL,                 -- avg per-trade % return (win_rate*avg_win - loss_rate*avg_loss)
  total_return_pct    REAL,                 -- compounded portfolio return
  max_drawdown_pct    REAL,
  sharpe              REAL,                 -- annualized Sharpe estimate
  costs_paise         INTEGER DEFAULT 0,    -- total transaction costs across all sim trades
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_started ON backtest_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            TEXT NOT NULL,
  signal_date       TEXT NOT NULL,          -- date the card would have been generated (YYYY-MM-DD)
  symbol            TEXT NOT NULL,
  tranche           TEXT NOT NULL,          -- base|aggressive|stretch
  composite_score   REAL NOT NULL,
  entry_date        TEXT,                   -- next-day open
  entry_paise       INTEGER NOT NULL,       -- simulated fill = next-day open
  stop_paise        INTEGER NOT NULL,
  target_paise      INTEGER NOT NULL,
  rr_ratio          REAL NOT NULL,
  qty               INTEGER NOT NULL,
  exit_date         TEXT,
  exit_paise        INTEGER,
  exit_reason       TEXT,                   -- target_hit | stop_hit | timeout | end_of_data
  hold_days         INTEGER,
  pnl_gross_paise   INTEGER,                -- before transaction costs
  pnl_net_paise     INTEGER,                -- after STT + brokerage + GST + exchange + DP charges
  cost_paise        INTEGER,                -- transaction cost total
  win_loss          TEXT,                   -- win | loss | flat
  FOREIGN KEY (run_id) REFERENCES backtest_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_score ON backtest_trades(run_id, composite_score);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_tranche ON backtest_trades(run_id, tranche);

-- Day-by-day equity curve for the most recent run (overwritten each run for now)
CREATE TABLE IF NOT EXISTS backtest_equity_curve (
  run_id        TEXT NOT NULL,
  trade_date    TEXT NOT NULL,
  capital_paise INTEGER NOT NULL,
  active_positions INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, trade_date),
  FOREIGN KEY (run_id) REFERENCES backtest_runs(run_id) ON DELETE CASCADE
);
