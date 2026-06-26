-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0020: Scout learning ledger — ADDITIVE ONLY.
--
-- Purpose: turn "NO_EDGE -> empty sit-out screen" into a daily learning machine.
-- On every market day, even when the proven edge is NO_EDGE, the system composes
-- a controlled SCOUT plan (PAPER = zero cash by default; TOKEN = tiny capped real,
-- Face-ID gated) so the owner gets a reasoned daily action + a recorded outcome to
-- learn from. This NEVER becomes a real TRADE: it writes ONLY to these new tables
-- and never touches daily_verdicts.decision / picks_json / paper_trades.
--
-- COA framing: each market day is ONE point.
--   scout_plans    = candidate_signal -> execution_plan -> decision  (pre-bell)
--   scout_outcomes = outcome -> lesson                               (post-bell)
--   owner_action   = the ONLY human input (approve/skip a TOKEN probe)
--
-- Reuses existing tables by FK instead of duplicating:
--   verdict_id      -> daily_verdicts.id          (the morning decision spine)
--   config_id       -> wealth_strategy_config.id  (the rule live that day)
--   backtest_run_id -> backtest_intraday_runs.run_id (rule provenance)
--
-- MONEY LAW: every rupee is INTEGER paise (mirrors kite_positions_live /
-- intraday_winner_daily). DATE LAW: trade_date is IST 'YYYY-MM-DD', trading days
-- only (the box market-calendar gate decides; weekends/holidays never get a row).
-- Timestamps are epoch-ms INTEGER. Apply with:
--   wrangler d1 execute wealth-engine --remote --file=wealth-engine/migrations/0020_scout_learning_ledger.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. scout_plans — one row per market day: the pre-bell decision coordinate ──
CREATE TABLE IF NOT EXISTS scout_plans (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date            TEXT NOT NULL,                  -- IST 'YYYY-MM-DD', trading days only
  strategy              TEXT NOT NULL DEFAULT 'gap_up_intraday',
  mode                  TEXT NOT NULL DEFAULT 'PAPER',  -- PAPER | TOKEN
  decision              TEXT NOT NULL,                  -- SCOUT | SIT_OUT (scout always proposes a learning action)

  -- ── provenance (reuse, don't duplicate) ──
  verdict_id            INTEGER,                        -- FK daily_verdicts.id (the morning verdict this scout shadows)
  config_id             INTEGER,                        -- FK wealth_strategy_config.id (the rule live that day)
  backtest_run_id       TEXT,                           -- e.g. 'gap_edge_nightly'
  edge_state            TEXT,                           -- snapshot of the edge: ROBUST_EDGE|THIN_EDGE|NO_EDGE

  -- ── candidate_signal ──
  candidate_symbols_json TEXT,                          -- ["TATAMOTORS","SBIN",...] ranked shortlist
  primary_symbol        TEXT,                           -- the #1 scout name
  rank_reason           TEXT,                           -- plain-words WHY it ranked top
  why_not_json          TEXT,                           -- the funnel: {scanned,liquid,scored,passed} + sample rejected names+reasons

  -- ── execution_plan (money = INTEGER paise) ──
  entry_paise           INTEGER,
  stop_paise            INTEGER,
  target_paise          INTEGER,
  qty                   INTEGER,
  rr_ratio              REAL,
  expected_risk_paise   INTEGER,                        -- qty*(entry-stop): capital at risk if stopped
  expected_reward_paise INTEGER,                        -- qty*(target-entry)
  notional_paise        INTEGER,                        -- scout notional sized against (capped, decoupled from real capital)

  -- ── what-proves-wrong (COA falsifier) ──
  invalidation_text     TEXT,
  invalidation_json     TEXT,                           -- {"max_adverse_pct":..,"time_stop_ist":"14:30","vwap_break":true}

  -- ── features-at-decision-time (audit; mirror daily_verdicts.context_snapshot_json) ──
  features_json         TEXT,                           -- {regime,max_composite,fii_net,vix,breadth,gap_pct,vol_mult,turnover_cr,oos_exp_pct,preopen_fresh}
  config_oos_exp_pct    REAL,
  honest_expectation    TEXT,                           -- e.g. "learning only — sub-cost selection, ~breakeven historically"

  -- ── state-ladder ──
  state                 TEXT NOT NULL DEFAULT 'PLANNED',
                        -- PLANNED -> ARMED -> (owner gate for TOKEN) -> ENTERED -> EXITED -> RECONCILED -> LEARNED
                        -- sidetracks: SKIPPED | INVALIDATED | ABORTED
  state_changed_at      INTEGER,

  -- ── owner_action (the ONLY human input) ──
  owner_action          TEXT DEFAULT 'auto',            -- auto (PAPER) | pending | approved | skipped (TOKEN)
  owner_action_at       INTEGER,

  composed_at           INTEGER NOT NULL,               -- epoch ms
  composed_by           TEXT DEFAULT 'wealth-verdict',
  created_at            INTEGER DEFAULT (strftime('%s','now') * 1000),

  FOREIGN KEY (verdict_id) REFERENCES daily_verdicts(id) ON DELETE SET NULL,
  FOREIGN KEY (config_id)  REFERENCES wealth_strategy_config(id) ON DELETE SET NULL,
  UNIQUE (trade_date, strategy, mode)
);
CREATE INDEX IF NOT EXISTS idx_scout_plans_date  ON scout_plans(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_plans_state ON scout_plans(state, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_plans_owner ON scout_plans(owner_action, trade_date DESC);

-- ── 1b. scout_plan_states — append-only state-ladder history ──
CREATE TABLE IF NOT EXISTS scout_plan_states (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL,
  state        TEXT NOT NULL,
  reason       TEXT,
  at           INTEGER NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES scout_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scout_states_plan ON scout_plan_states(plan_id, at);

-- ── 2. scout_outcomes — what actually happened + the lesson (post-bell) ──
CREATE TABLE IF NOT EXISTS scout_outcomes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id               INTEGER NOT NULL,
  trade_date            TEXT NOT NULL,

  action_taken          TEXT,                           -- paper_observed | placed | not_placed | invalidated_pre_entry
  actual_entry_paise    INTEGER,
  actual_exit_paise     INTEGER,
  actual_qty            INTEGER,
  exit_reason           TEXT,                           -- target_hit | stop_hit | time_exit | squareoff | no_entry | invalidated
  pnl_gross_paise       INTEGER,
  pnl_cost_paise        INTEGER,
  pnl_net_paise         INTEGER,                        -- THE number (INTEGER paise, 0 for PAPER cash, but the modelled token-cost P&L)
  win_loss              TEXT,                           -- win | loss | flat | no_trade
  r_multiple            REAL,

  -- ── oracle reconciliation (reuse intraday_winner_daily ground truth) ──
  oracle_top_symbol     TEXT,
  oracle_top_pct        REAL,
  caught_grade          TEXT,                           -- hit | near | far | miss | sat_out | no_data
  falsifier_fired       INTEGER DEFAULT 0,
  falsifier_correct     INTEGER,

  -- ── lesson ──
  lesson_text           TEXT,
  pattern_label         TEXT,                           -- stop_too_tight | momentum_loss | thesis_held | regime_mismatch | ...
  lesson_json           TEXT,
  feeds_config          INTEGER DEFAULT 0,

  reconciled_at         INTEGER NOT NULL,
  composed_by_model     TEXT,
  cost_paise            INTEGER DEFAULT 0,

  FOREIGN KEY (plan_id) REFERENCES scout_plans(id) ON DELETE CASCADE,
  UNIQUE (plan_id)
);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_date    ON scout_outcomes(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_pattern ON scout_outcomes(pattern_label, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_grade   ON scout_outcomes(caught_grade, trade_date DESC);
