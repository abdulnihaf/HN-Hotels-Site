-- ═══════════════════════════════════════════════════════════════════════════
-- 0014_verdict_system.sql — Tables backing the autonomous Claude operator.
--
--  daily_verdicts          → Phase A: Opus-composed morning + Phase C: invalidator deltas
--  alert_classifications   → Phase B: Haiku auto-triage outputs
--  paper_trade_autopsies   → Phase D: Sonnet per-trade post-mortem
--  weekly_reviews          → Phase D: Sonnet weekly compose + behavior change
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── daily_verdicts ────────────────────────────────────────────────────────
-- One row per (date, verdict_type). Latest row per date wins.
-- verdict_type:
--   'morning'      — composed at 08:30 IST (verdict_compose cron)
--   'invalidator'  — composed mid-day when material change detected
CREATE TABLE IF NOT EXISTS daily_verdicts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date           TEXT NOT NULL,                    -- 'YYYY-MM-DD' IST
  verdict_type         TEXT NOT NULL,                    -- 'morning' | 'invalidator'
  decision             TEXT NOT NULL,                    -- 'TRADE' | 'SIT_OUT' | 'OBSERVE'
  headline             TEXT,                             -- 1-line action
  narrative            TEXT,                             -- 3-sentence why (Opus output)
  recommended_symbol   TEXT,                             -- NULL on SIT_OUT
  recommended_plan_json TEXT,                            -- {entry, stop, target, qty, rr, ...} JSON
  alternatives_json    TEXT,                             -- top-3 alternatives w/ "why not" each
  context_snapshot_json TEXT,                            -- regime, dim health, max score, FII, VIX (audit trail)
  invalidator_reason   TEXT,                             -- why invalidator fired (NULL for morning)
  composed_at          INTEGER NOT NULL,                 -- epoch ms
  composed_by_model    TEXT,                             -- 'claude-opus-4-5' / 'claude-sonnet-4-5'
  cost_paise           INTEGER,                          -- cost of THIS compose call
  cached               INTEGER DEFAULT 0,
  push_sent            INTEGER DEFAULT 0,                -- 1 if we sent a push notification
  created_at           INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_daily_verdicts_date ON daily_verdicts(trade_date, composed_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_verdicts_type ON daily_verdicts(verdict_type, composed_at DESC);

-- ─── alert_classifications ─────────────────────────────────────────────────
-- Result of Haiku auto-triage. One row per system_alerts.id.
-- classification:
--   'critical'        — surfaces in verdict, never auto-cleared
--   'informational'   — batched into daily digest
--   'noise'           — silent-clear (system_alerts.is_read = 1 set by triager)
CREATE TABLE IF NOT EXISTS alert_classifications (
  alert_id        INTEGER PRIMARY KEY,                   -- FK system_alerts.id
  classification  TEXT NOT NULL,                         -- 'critical' | 'informational' | 'noise'
  confidence      REAL,                                  -- 0-1
  reason          TEXT,                                  -- short rationale
  classified_at   INTEGER NOT NULL,                      -- epoch ms
  classified_by_model TEXT DEFAULT 'claude-haiku-4-5',
  cost_paise      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_class_classification ON alert_classifications(classification);

-- ─── paper_trade_autopsies ─────────────────────────────────────────────────
-- One row per closed paper_trade. Sonnet composes 80-word post-mortem +
-- pattern label + lessons. Patterns surface in future verdicts.
CREATE TABLE IF NOT EXISTS paper_trade_autopsies (
  trade_id              INTEGER PRIMARY KEY,             -- FK paper_trades.id
  symbol                TEXT,
  outcome               TEXT,                            -- 'win' | 'loss' | 'breakeven'
  pnl_pct               REAL,
  hold_days             REAL,
  exit_reason           TEXT,
  narrative             TEXT,                            -- 80-word post-mortem
  pattern_label         TEXT,                            -- 'momentum_loss' / 'stop_too_tight' / 'thesis_held' / etc.
  lessons_json          TEXT,                            -- ["short lesson 1", "short lesson 2", ...]
  composed_at           INTEGER NOT NULL,
  composed_by_model     TEXT DEFAULT 'claude-sonnet-4-5',
  cost_paise            INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_autopsy_pattern ON paper_trade_autopsies(pattern_label, composed_at DESC);

-- ─── weekly_reviews ────────────────────────────────────────────────────────
-- One row per (week_start_date). Sonnet composes the review every Sunday.
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date       TEXT NOT NULL UNIQUE,            -- 'YYYY-MM-DD' (Monday)
  trades_won            INTEGER DEFAULT 0,
  trades_lost           INTEGER DEFAULT 0,
  trades_breakeven      INTEGER DEFAULT 0,
  net_pnl_pct           REAL,
  best_trade_symbol     TEXT,
  worst_trade_symbol    TEXT,
  narrative             TEXT,                            -- 200-word week summary
  behavior_change       TEXT,                            -- 1-2 sentence change suggestion
  trades_summary_json   TEXT,                            -- full trade list w/ outcomes
  composed_at           INTEGER NOT NULL,
  composed_by_model     TEXT DEFAULT 'claude-sonnet-4-5',
  cost_paise            INTEGER DEFAULT 0
);
