-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0003 — Orchestrator tables
-- Tables that support automation: alerts, briefings, portfolio snapshots,
-- backfill queue, position watchlist (stop-loss monitoring).
-- ═══════════════════════════════════════════════════════════════════════════

-- System alerts — watchdog signals, cascade triggers, stop-loss breaches
CREATE TABLE IF NOT EXISTS system_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  severity TEXT NOT NULL,                 -- 'info' | 'warn' | 'critical'
  category TEXT NOT NULL,                 -- 'watchdog' | 'cascade' | 'stop_loss' | 'data_quality' | 'kite_token'
  title TEXT NOT NULL,
  body TEXT,
  related_symbol TEXT,
  related_pattern TEXT,
  is_read INTEGER DEFAULT 0,
  acted_on INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_recent ON system_alerts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON system_alerts(is_read, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON system_alerts(category, ts DESC);

-- Daily morning briefing — composed at 08:30 IST each market day
CREATE TABLE IF NOT EXISTS daily_briefings (
  briefing_date TEXT PRIMARY KEY,         -- YYYY-MM-DD
  generated_at INTEGER NOT NULL,
  market_pulse TEXT,                      -- JSON {nifty, banknifty, vix, dxy, brent, asian}
  top_signals TEXT,                       -- JSON array of top 10 composite scores
  active_cascades TEXT,                   -- JSON array of active patterns
  fii_dii_yesterday TEXT,                 -- JSON
  key_macro TEXT,                         -- JSON
  upcoming_events TEXT,                   -- JSON (next 5 days events)
  earnings_today TEXT,                    -- JSON
  narrative TEXT                          -- short text summary
);

-- Portfolio snapshots — EOD pull from Kite holdings
CREATE TABLE IF NOT EXISTS portfolio_snapshots_daily (
  snapshot_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  qty INTEGER,
  avg_price_paise INTEGER,
  ltp_paise INTEGER,
  market_value_paise INTEGER,
  pnl_paise INTEGER,
  day_change_pct REAL,
  total_return_pct REAL,
  source TEXT DEFAULT 'kite',
  ingested_at INTEGER,
  PRIMARY KEY (snapshot_date, symbol)
);

-- Backfill queue — orchestrator schedules sources for backfill
CREATE TABLE IF NOT EXISTS backfill_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  priority INTEGER DEFAULT 5,             -- 1=urgent..10=low
  status TEXT DEFAULT 'queued',           -- 'queued' | 'running' | 'complete' | 'error'
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_bf_queued ON backfill_queue(status, priority);

-- Position watchlist — stop-loss + target tracking. Populated when user opens position.
CREATE TABLE IF NOT EXISTS position_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tranche TEXT,                           -- 'base' | 'aggressive' | 'stretch'
  symbol TEXT NOT NULL,
  exchange TEXT DEFAULT 'NSE',
  instrument_type TEXT DEFAULT 'equity',
  qty INTEGER NOT NULL,
  entry_price_paise INTEGER NOT NULL,
  stop_paise INTEGER NOT NULL,
  target_paise INTEGER,
  trailing_stop_paise INTEGER,
  high_water_paise INTEGER,
  entry_date TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_alert_ts INTEGER,
  rationale TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_active ON position_watchlist(is_active);

-- Weekly performance log — Sunday digest writes here
CREATE TABLE IF NOT EXISTS weekly_performance (
  week_ending TEXT PRIMARY KEY,           -- YYYY-MM-DD (Sunday)
  generated_at INTEGER,
  signals_emitted INTEGER,
  signals_actionable INTEGER,             -- those that crossed score threshold
  avg_signal_return_pct REAL,             -- 5-day forward return on top-decile signals
  cascade_triggers INTEGER,
  cascade_avg_return_pct REAL,
  fii_net_cr REAL,
  dii_net_cr REAL,
  nifty_change_pct REAL,
  banknifty_change_pct REAL,
  narrative TEXT
);

-- Kite token reminders — tracks if we've already sent today's expiry alert
CREATE TABLE IF NOT EXISTS kite_token_reminders (
  reminder_date TEXT PRIMARY KEY,         -- YYYY-MM-DD
  sent_at INTEGER,
  reconnected_at INTEGER
);
