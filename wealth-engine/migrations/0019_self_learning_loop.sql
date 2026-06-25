-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0019: Self-learning gap-up loop — ADDITIVE ONLY.
--
-- Closes the open loop: the RTX box re-runs the walk-forward gap-up backtest
-- every night and PUBLISHES a tuned rule here; the 09:40 worker READS it and
-- emits the day's exact entry/exit; the day's pick-vs-outcome is journaled so
-- the system gets smarter from its own track record. Live MIS positions are
-- reconciled so the app can track + square off a real position.
--
-- Three new tables, all CREATE IF NOT EXISTS. Touches NOTHING existing.
--   1. wealth_strategy_config — the nightly-tuned rule + its HONEST OOS stats
--   2. kite_positions_live     — live broker positions snapshot (track + exit)
--   3. wealth_pick_journal      — durable pick-vs-outcome learning record
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tuned strategy config (box writes nightly, 09:40 worker reads active) ──
CREATE TABLE IF NOT EXISTS wealth_strategy_config (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy            TEXT NOT NULL DEFAULT 'gap_up_intraday',
  config_date         TEXT NOT NULL,            -- IST YYYY-MM-DD the run generated this
  is_active           INTEGER NOT NULL DEFAULT 1,  -- 1 = the rule the live engine uses
  verdict             TEXT NOT NULL,            -- ROBUST_EDGE | THIN_EDGE | NO_EDGE
  -- the tuned rule the scanner applies
  gap_min_pct         REAL,                     -- min gap-up % at open to qualify
  stop_pct            REAL,                     -- WIDE stop % (tight stops whipsaw — backtest-proven)
  vol_mult_min        REAL,                     -- opening-volume multiple vs own 20d median (catalyst confirm)
  exit_time_ist       TEXT,                     -- hard time-exit, e.g. '14:30'
  exit_bar            INTEGER,                  -- bar index of the time-exit
  min_turnover_cr     REAL,                     -- point-in-time liquidity floor (Cr/day)
  max_picks           INTEGER DEFAULT 3,
  -- honest stats backing the rule (never hide these)
  oos_expectancy_pct  REAL,                     -- per-trade NET out-of-sample expectancy
  oos_trades          INTEGER,
  oos_p               REAL,                     -- significance
  folds_positive      TEXT,                     -- e.g. '5/6'
  edge_vs_null        REAL,                     -- real - random-null (selection-skill proof)
  universe_syms       INTEGER,
  cost_assumption_pct REAL,
  derived_from        TEXT,                     -- 'gap_edge.py walk-forward OOS'
  params_json         TEXT,                     -- full search_config.json for audit
  published_at        INTEGER NOT NULL,         -- epoch ms
  published_by        TEXT DEFAULT 'rtx-box'
);
CREATE INDEX IF NOT EXISTS idx_wsc_active ON wealth_strategy_config(strategy, is_active, published_at DESC);

-- ── 2. Live broker positions snapshot (reconciled from Kite /portfolio/positions) ──
CREATE TABLE IF NOT EXISTS kite_positions_live (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_at      INTEGER NOT NULL,            -- epoch ms (latest snapshot wins on read)
  trade_date       TEXT NOT NULL,               -- IST YYYY-MM-DD
  tradingsymbol    TEXT NOT NULL,
  exchange         TEXT,
  product          TEXT,                        -- MIS | CNC | NRML
  quantity         INTEGER,                     -- net qty (0 = squared/closed)
  buy_qty          INTEGER,
  sell_qty         INTEGER,
  avg_price_paise  INTEGER,                     -- net average entry
  last_price_paise INTEGER,                     -- live LTP
  pnl_paise        INTEGER,                     -- live P&L (Kite-computed)
  m2m_paise        INTEGER,
  realised_paise   INTEGER,
  unrealised_paise INTEGER,
  verdict_id       INTEGER,                     -- best-effort link to daily_verdicts (symbol+date)
  raw_json         TEXT,
  FOREIGN KEY (verdict_id) REFERENCES daily_verdicts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_kpl_snapshot ON kite_positions_live(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpl_symbol   ON kite_positions_live(trade_date, tradingsymbol, snapshot_at DESC);

-- ── 3. Durable pick-vs-outcome learning journal (nightly, queryable history) ──
CREATE TABLE IF NOT EXISTS wealth_pick_journal (
  trade_date         TEXT NOT NULL,
  strategy           TEXT NOT NULL DEFAULT 'gap_up_intraday',
  verdict_id         INTEGER,
  decision           TEXT,                       -- TRADE | SIT_OUT | OBSERVE
  pick_symbols_json  TEXT,                       -- the picks the engine named
  pick_detail_json   TEXT,                       -- per-pick gap%, entry, stop, exit, size
  action_taken       TEXT,                       -- placed | not_placed | sat_out
  realised_pnl_pct   REAL,                       -- actual outcome if traded
  oracle_top_symbol  TEXT,                       -- what actually moved most that day
  oracle_top_pct     REAL,
  caught_grade       TEXT,                       -- hit | near | far | miss | sat_out | no_data
  config_oos_exp_pct REAL,                       -- the edge estimate live that day
  lesson_text        TEXT,
  learned_at         INTEGER NOT NULL,           -- epoch ms
  PRIMARY KEY (trade_date, strategy)
);
CREATE INDEX IF NOT EXISTS idx_wpj_date ON wealth_pick_journal(trade_date DESC);
