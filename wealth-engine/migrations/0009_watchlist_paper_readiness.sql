-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0009: Watchlist + Paper-trading + Ready-to-Trade gating
--
-- Three small tables that close the user-experience loop:
--   user_watchlist     — symbols you're tracking with intent (separate from engine top picks)
--   paper_trades       — simulated trades that go through full system flow without real orders
--   readiness_check    — checklist state (have you verified data flow? backtested? paper-traded?)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_watchlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT NOT NULL,
  exchange     TEXT NOT NULL DEFAULT 'NSE',
  added_at     INTEGER NOT NULL,
  notes        TEXT,
  thesis       TEXT,                              -- one-sentence reason this is on the list
  category     TEXT DEFAULT 'tracking',           -- tracking | momentum | swing | learning
  is_active    INTEGER NOT NULL DEFAULT 1,
  alert_above  INTEGER,                           -- price above this paise → alert
  alert_below  INTEGER,                           -- price below this paise → alert
  UNIQUE(symbol, exchange, is_active)
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol            TEXT NOT NULL,
  tranche           TEXT,
  composite_score   REAL,
  entry_paise       INTEGER NOT NULL,
  stop_paise        INTEGER NOT NULL,
  target_paise      INTEGER NOT NULL,
  qty               INTEGER NOT NULL,
  rr_ratio          REAL,

  entry_at          INTEGER NOT NULL,             -- ms timestamp at simulated fill
  exit_at           INTEGER,
  exit_paise        INTEGER,
  exit_reason       TEXT,                         -- target_hit | stop_hit | manual | timeout
  pnl_gross_paise   INTEGER,
  pnl_net_paise     INTEGER,
  cost_paise        INTEGER,
  win_loss          TEXT,                         -- pending | win | loss | flat

  rationale         TEXT,                         -- engine's reason
  user_thesis       TEXT,                         -- user's own one-line note pre-trade
  q1_passed         INTEGER,                      -- 1 / 0 / null — did user mark Q1 yes
  q2_passed         INTEGER,
  q3_passed         INTEGER,

  is_active         INTEGER NOT NULL DEFAULT 1,   -- still open vs closed
  source            TEXT DEFAULT 'shadow_card',
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_active ON paper_trades(is_active, entry_at DESC);

-- Single-row table tracking readiness checklist + last-update timestamps
CREATE TABLE IF NOT EXISTS readiness_check (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  -- Data layer health
  equity_eod_dates    INTEGER DEFAULT 0,
  option_chain_rows   INTEGER DEFAULT 0,
  bulk_deals_rows     INTEGER DEFAULT 0,
  fii_dii_rows        INTEGER DEFAULT 0,
  briefings_rows      INTEGER DEFAULT 0,
  signal_max_score    REAL DEFAULT 0,
  -- Engine state
  cards_produced_today INTEGER DEFAULT 0,
  paper_trades_count  INTEGER DEFAULT 0,
  paper_win_rate_pct  REAL,
  bayesian_buckets    INTEGER DEFAULT 0,
  bayesian_samples    INTEGER DEFAULT 0,
  -- User-marked checklist items
  user_understood_3q  INTEGER DEFAULT 0,           -- has user read + acknowledged the 3-question test
  user_set_capital    INTEGER DEFAULT 0,           -- has user set total_capital_paise > 0
  user_funded_kite    INTEGER DEFAULT 0,           -- Zerodha funds available > 0
  user_done_paper     INTEGER DEFAULT 0,           -- has user submitted ≥10 paper trades
  user_acknowledged_risk INTEGER DEFAULT 0,        -- has user explicitly accepted max ₹20K daily loss
  -- Computed
  is_ready            INTEGER DEFAULT 0,           -- 1 when all gates pass
  last_check_at       INTEGER,
  notes               TEXT
);

-- Initialize the singleton
INSERT OR IGNORE INTO readiness_check (id, last_check_at) VALUES (1, strftime('%s','now')*1000);
