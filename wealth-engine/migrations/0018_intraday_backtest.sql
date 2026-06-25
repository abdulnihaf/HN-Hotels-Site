-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0018: Intraday backtest — ADDITIVE ONLY.
--
-- Derives the strategy's REAL edge from history (no waiting on forward paper
-- trades). Walk-forward replay of the price/volume signal spine over a year of
-- equity_eod (daily-bar proxy) and, where 5-min bars exist, the true ORB strategy.
-- Plus a strategy-free daily ACTUAL-winner oracle (pure OHLC arithmetic).
--
-- Also (re)creates intraday_bars + intraday_suitability with IF NOT EXISTS — the
-- live wealth-intraday-bars worker INSERTs into these but no prior migration
-- created them (latent gap; safe whether or not they were hand-made on prod).
-- Touches NOTHING existing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Intraday candle cache (matches the live worker's INSERT shape) ─────────
CREATE TABLE IF NOT EXISTS intraday_bars (
  symbol      TEXT NOT NULL,
  ts          INTEGER NOT NULL,        -- epoch ms
  trade_date  TEXT NOT NULL,           -- IST YYYY-MM-DD
  interval    TEXT NOT NULL DEFAULT '5minute',
  open_paise  INTEGER, high_paise INTEGER, low_paise INTEGER, close_paise INTEGER,
  volume      INTEGER,
  PRIMARY KEY (symbol, ts, interval)
);
CREATE INDEX IF NOT EXISTS idx_ibars_date   ON intraday_bars(trade_date);
CREATE INDEX IF NOT EXISTS idx_ibars_symbol ON intraday_bars(symbol, interval, ts);

-- ── B. Suitability pool (which symbols are worth fetching intraday) ───────────
CREATE TABLE IF NOT EXISTS intraday_suitability (
  symbol                 TEXT PRIMARY KEY,
  intraday_score         REAL,
  hit_2pct_last_week     REAL,
  avg_up_last_week_pct   REAL,
  green_close_last_week  REAL,
  updated_at             INTEGER
);

-- ── C. Intraday backtest runs (peer of backtest_runs; NOT a modification) ─────
CREATE TABLE IF NOT EXISTS backtest_intraday_runs (
  run_id             TEXT PRIMARY KEY,
  started_at         INTEGER NOT NULL,
  finished_at        INTEGER,
  status             TEXT NOT NULL DEFAULT 'running',  -- running|done|failed
  mode               TEXT NOT NULL DEFAULT 'daily_proxy', -- daily_proxy | intraday
  config_json        TEXT NOT NULL,   -- {universe_n, from, to, score_min, picks_per_day, capital_paise, ...}
  trading_days       INTEGER DEFAULT 0,
  total_trades       INTEGER DEFAULT 0,
  wins               INTEGER DEFAULT 0,
  losses             INTEGER DEFAULT 0,
  squareoffs         INTEGER DEFAULT 0,   -- exited flat (neither stop nor target)
  win_rate_pct       REAL,
  avg_win_pct        REAL,
  avg_loss_pct       REAL,
  expectancy_pct     REAL,                -- per-trade % = winrate*avgwin - lossrate*avgloss
  total_return_pct   REAL,                -- compounded over the period
  max_drawdown_pct   REAL,
  sharpe             REAL,
  costs_paise        INTEGER DEFAULT 0,
  winner_capture_pct REAL,                -- % of trades that were a top-3 actual mover that day
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_bt_intra_runs_started ON backtest_intraday_runs(started_at DESC);

-- ── D. Per-trade detail (one simulated same-day entry+exit) ───────────────────
CREATE TABLE IF NOT EXISTS backtest_intraday_trades (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT NOT NULL,
  trade_date       TEXT NOT NULL,        -- entry == exit date (intraday)
  symbol           TEXT NOT NULL,
  signal_score     REAL,                 -- price-only composite at signal time
  regime           TEXT,
  entry_paise      INTEGER NOT NULL,
  stop_paise       INTEGER NOT NULL,
  target_paise     INTEGER NOT NULL,
  rr_ratio         REAL,
  qty              INTEGER NOT NULL,
  exit_paise       INTEGER,
  exit_reason      TEXT,                 -- target_hit|stop_hit|squareoff|no_entry
  pnl_gross_paise  INTEGER,
  pnl_net_paise    INTEGER,
  cost_paise       INTEGER,
  win_loss         TEXT,                 -- win|loss|flat
  was_day_winner   INTEGER DEFAULT 0,    -- 1 if symbol was a top-3 actual mover that day
  FOREIGN KEY (run_id) REFERENCES backtest_intraday_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bt_intra_trades_run  ON backtest_intraday_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_bt_intra_trades_date ON backtest_intraday_trades(run_id, trade_date);

-- ── E. Daily actual-winner oracle — strategy-free ground truth ────────────────
CREATE TABLE IF NOT EXISTS intraday_winner_daily (
  trade_date         TEXT NOT NULL,
  rank               INTEGER NOT NULL,   -- 1 = biggest open->high mover
  symbol             TEXT NOT NULL,
  day_open_paise     INTEGER,
  day_high_paise     INTEGER,
  day_low_paise      INTEGER,
  day_close_paise    INTEGER,
  open_to_high_pct   REAL,               -- max long upside from open
  open_to_low_pct    REAL,               -- max adverse excursion from open
  realised_close_pct REAL,              -- open->close (hold-to-EOD capture)
  turnover_cr        REAL,               -- liquidity, for honest ranking
  source             TEXT DEFAULT 'eod', -- eod (daily-bar proxy) | intraday (5-min)
  computed_at        INTEGER,
  PRIMARY KEY (trade_date, rank, source)
);
CREATE INDEX IF NOT EXISTS idx_iwinner_symbol ON intraday_winner_daily(symbol, trade_date);

-- ── F. Equity curve for intraday runs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_intraday_equity (
  run_id           TEXT NOT NULL,
  trade_date       TEXT NOT NULL,
  capital_paise    INTEGER NOT NULL,
  trades_that_day  INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, trade_date),
  FOREIGN KEY (run_id) REFERENCES backtest_intraday_runs(run_id) ON DELETE CASCADE
);
