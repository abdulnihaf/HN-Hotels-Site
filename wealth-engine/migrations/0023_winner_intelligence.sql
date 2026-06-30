-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0023: Winner Intelligence — ADDITIVE ONLY.
--
-- Purpose: make the stock-picking intelligence VISIBLE + LEARNING.
--   The 09:40 engine ranked by pre-open gap × liquidity. That misses the real
--   intraday winners (which barely gap) and picks circuit traps (SETL 2026-06-30:
--   gapped 7%, locked at 09:40 → 0% capturable). These tables hold the causal
--   ground truth + the missed-winner learning loop + the live decision witness.
--
-- Source of truth: RTX bt.db (5-min bars) → winner_intel.py → these tables.
-- NONE of this is a broker-order surface. The execution gate (picks_json +
-- execution_authority) is untouched. winner_intel is intelligence + learning only.
--
-- MONEY LAW: percentages are REAL (intraday %); any rupee field is INTEGER paise.
-- DATE LAW: trade_date is IST 'YYYY-MM-DD', trading days only. ts = epoch-ms INT.
-- Apply: wrangler d1 execute wealth-engine --remote --file=wealth-engine/migrations/0023_winner_intelligence.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. winner_replay_daily — what ACTUALLY won + whether it was knowable/tradable ──
CREATE TABLE IF NOT EXISTS winner_replay_daily (
  trade_date          TEXT PRIMARY KEY,            -- IST 'YYYY-MM-DD'
  n_symbols           INTEGER,                     -- symbols with intraday bars that day
  n_tradable_winners  INTEGER,                     -- to_high>=3% & to_1430>=1% & not circuit
  n_circuit_traps     INTEGER,                     -- gap>=5% but 0% capturable from 09:40
  top_winners_json    TEXT,                        -- top 10 by day% (prev_close→close), each w/ flags
  top_tradable_json   TEXT,                        -- top by 09:40→high among capturable (the real catchable set)
  top_losers_json     TEXT,                        -- worst by 09:40→14:30
  source              TEXT DEFAULT 'rtx_bars5m',
  generated_at        INTEGER NOT NULL,
  created_at          INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_winner_replay_date ON winner_replay_daily(trade_date DESC);

-- ── 2. missed_winner_autopsy — pick vs realized winners; why missed; rule to change ──
CREATE TABLE IF NOT EXISTS missed_winner_autopsy (
  trade_date              TEXT PRIMARY KEY,
  picks_json              TEXT,                    -- ["SETL","VISL","SRM"] the engine's chosen names
  chosen_detail_json      TEXT,                    -- per pick: score, gap, drive, vwap, realized to_high/to_1430, was-it-a-winner
  best_realized_winner    TEXT,
  best_day_pct            REAL,
  missed_winners_json     TEXT,                    -- per top winner not picked: reject reasons, rejection_valid, reason_later_wrong, rule_change
  n_missed                INTEGER,
  n_reason_later_wrong    INTEGER,                 -- valid rejections that the outcome proved wrong → feeds tomorrow's ranking
  top_losers_json         TEXT,                    -- worst names; picked flag (did we avoid them?)
  generated_at            INTEGER NOT NULL,
  created_at              INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_missed_autopsy_date ON missed_winner_autopsy(trade_date DESC);

-- ── 3. ranker_configs — the versioned two-stage ranker (gate + portable linear model) ──
-- The JS worker replicates Stage A (gate_json thresholds) + Stage B (model_json:
-- z-scored linear weights) so the live 09:40 selection matches the backtested ranker.
CREATE TABLE IF NOT EXISTS ranker_configs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  version         TEXT NOT NULL,                   -- e.g. 'winner_intel_v1'
  is_active       INTEGER DEFAULT 0,
  target          TEXT,                            -- e.g. 'to_1430_pct'
  gate_json       TEXT,                            -- Stage A thresholds (min_liq, max_runup, vwap_floor, ...)
  model_json      TEXT,                            -- Stage B {feat_keys, weights, mu, sd, med, intercept}
  backtest_json   TEXT,                            -- walk-forward metrics summary (honest)
  trained_days    INTEGER,
  date_to         TEXT,
  published_at    INTEGER NOT NULL,
  created_at      INTEGER DEFAULT (strftime('%s','now') * 1000),
  UNIQUE (version)
);
CREATE INDEX IF NOT EXISTS idx_ranker_active ON ranker_configs(is_active, published_at DESC);

-- ── 4. daily_selection_witness — the LIVE 09:40 decision trail (intelligence, not orders) ──
-- One row per market day: what the causal ranker selected, the no-loser gate result,
-- ranked candidates, why-this / why-not-the-missed, expected R, source freshness, and
-- whether picks were broker-facing. Mirrors daily_verdicts but is the INTELLIGENCE
-- witness (never an order surface).
CREATE TABLE IF NOT EXISTS daily_selection_witness (
  trade_date              TEXT PRIMARY KEY,
  decision                TEXT,                    -- OBSERVE | TRADE | PAPER_SCOUT | SIT_OUT
  selected_symbol         TEXT,
  ranked_candidates_json  TEXT,                    -- Stage B survivors ranked w/ scores + plan
  rejected_json           TEXT,                    -- gated-out names + reasons (the no-loser gate)
  no_loser_gate_json      TEXT,                    -- {scanned, gated_out, survivors, reason_histogram}
  expected_r              REAL,
  expected_upside_pct     REAL,
  why_this                TEXT,
  why_not_top_missed_json TEXT,                    -- why the biggest names weren't taken
  source_state            TEXT,                    -- live | stale | eod_fallback
  execution_authority     TEXT,                    -- intelligence_plan_only | broker_facing_picks_authorized
  picks_broker_facing     INTEGER DEFAULT 0,
  ranker_version          TEXT,
  composed_at             INTEGER NOT NULL,
  composed_by             TEXT DEFAULT 'wealth-verdict',
  created_at              INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_selection_witness_date ON daily_selection_witness(trade_date DESC);
