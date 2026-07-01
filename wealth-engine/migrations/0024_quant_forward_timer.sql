-- Migration 0024: Quant forward timer
--
-- Purpose:
--   Persist the high-cadence entry/exit timer trail that sits between the
--   morning intelligence pick and any possible broker order. This is not a
--   broker-order surface. Real orders remain gated by daily_verdicts.picks_json,
--   broker_facing_picks_authorized, Kite health, static-IP proxy health, and
--   user_config auto-real switches.
--
-- Apply:
--   wrangler d1 execute wealth-engine --remote --file=wealth-engine/migrations/0024_quant_forward_timer.sql

CREATE TABLE IF NOT EXISTS quant_timer_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date          TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'paper', -- paper | real
  strategy            TEXT NOT NULL DEFAULT 'forward_timer_v1',
  source              TEXT,                          -- scout_today | execution_gate | manual
  source_verdict_id   INTEGER,
  primary_symbol      TEXT,
  candidates_json     TEXT,
  proof_state         TEXT,                          -- REJECTED | PAPER_SCOUT | WATCH_SCOUT | DEPLOYABLE
  target_kpi          TEXT DEFAULT '+5pct_intraday_monthly_average',
  status              TEXT NOT NULL DEFAULT 'running',
  gate_json           TEXT,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_quant_timer_runs_date ON quant_timer_runs(trade_date DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quant_timer_runs_symbol ON quant_timer_runs(primary_symbol, trade_date DESC);

CREATE TABLE IF NOT EXISTS quant_timer_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER,
  trade_date          TEXT NOT NULL,
  ts                  TEXT NOT NULL,
  symbol              TEXT,
  state_before        TEXT,
  state_after         TEXT,
  decision            TEXT NOT NULL,                 -- WATCH | ENTER_PAPER | ENTER_REAL | HOLD | EXIT_* | PASS | BLOCKED
  ltp_paise           INTEGER,
  entry_paise         INTEGER,
  stop_paise          INTEGER,
  target_paise        INTEGER,
  qty                 INTEGER,
  pnl_pct             REAL,
  trigger_json        TEXT,
  action_json         TEXT,
  gate_json           TEXT,
  raw_json            TEXT,
  broker_order_id     TEXT,
  broker_status       TEXT,
  failure_code        TEXT,
  idempotency_key     TEXT,
  actor               TEXT DEFAULT 'quant_timer',
  terminal            INTEGER DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES quant_timer_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_quant_timer_events_date ON quant_timer_events(trade_date DESC, ts DESC);
CREATE INDEX IF NOT EXISTS idx_quant_timer_events_run ON quant_timer_events(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_quant_timer_events_symbol ON quant_timer_events(symbol, trade_date DESC, ts DESC);
CREATE INDEX IF NOT EXISTS idx_quant_timer_events_order ON quant_timer_events(broker_order_id);

CREATE TABLE IF NOT EXISTS quant_control_overrides (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active', -- active | superseded | cleared | expired
  actor               TEXT NOT NULL DEFAULT 'owner_control',
  reason              TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  exchange            TEXT NOT NULL DEFAULT 'NSE',
  product             TEXT NOT NULL DEFAULT 'MIS',
  entry_paise         INTEGER NOT NULL,
  stop_paise          INTEGER NOT NULL,
  target_paise        INTEGER NOT NULL,
  qty                 INTEGER NOT NULL,
  original_plan_json  TEXT,
  override_plan_json  TEXT,
  expires_at          TEXT,
  created_at          TEXT NOT NULL,
  cleared_at          TEXT,
  clear_reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_quant_control_overrides_active ON quant_control_overrides(trade_date, status, expires_at);

INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  ('quant_timer_default_mode', 'paper', 'Quant forward timer default mode. Real entry requires --mode real --allow-real plus the server execution gate.', strftime('%s','now')*1000),
  ('quant_timer_interval_sec', '180', 'Quant forward timer loop interval in seconds.', strftime('%s','now')*1000),
  ('quant_timer_auto_enabled', '1', 'When 1, wealth-orchestrator may call /api/quant-control?action=tick during market hours. Paper by default.', strftime('%s','now')*1000),
  ('quant_timer_real_enabled', '0', 'When 1, Quant timer may request real broker entry/exit, still gated by auto_real_trades_enabled and execution_gate.', strftime('%s','now')*1000),
  ('quant_timer_entry_deadline_hhmm', '1015', 'IST HHMM latest time to enter the forward-timer plan.', strftime('%s','now')*1000),
  ('quant_timer_exit_hhmm', '1245', 'IST HHMM hard time exit for the forward-timer plan.', strftime('%s','now')*1000),
  ('quant_timer_entry_band_low_bps', '-80', 'Entry band lower bound in basis points around planned entry. -80 = -0.80%.', strftime('%s','now')*1000),
  ('quant_timer_entry_band_high_bps', '35', 'Entry band upper bound in basis points around planned entry. 35 = +0.35%; do not chase above it.', strftime('%s','now')*1000),
  ('quant_timer_profit_take_pct', '5.0', 'Quant forward timer profit-take witness threshold. Target KPI is +5% intraday, proven over a monthly trail.', strftime('%s','now')*1000),
  ('quant_timer_daily_loss_kill_pct', '2.5', 'Quant forward timer kill switch threshold. Real trading remains disabled unless the broker gate is DEPLOYABLE.', strftime('%s','now')*1000);
