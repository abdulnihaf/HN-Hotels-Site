-- Delivery Aggregator COA Ring 2 action ledger.
-- Pull attempts are trajectories over Ring 1 platform/outlet/source coordinates.
-- No partner secrets are stored here.

CREATE TABLE IF NOT EXISTS aggregator_coa_pull_run (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live', 'backfill')),
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  requested_from TEXT,
  requested_to TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
  attempts_total INTEGER NOT NULL DEFAULT 0,
  attempts_ok INTEGER NOT NULL DEFAULT 0,
  orders_seen INTEGER NOT NULL DEFAULT 0,
  orders_upserted INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS aggregator_coa_pull_attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES aggregator_coa_pull_run(run_id),
  coordinate TEXT NOT NULL,
  platform_outlet_code TEXT NOT NULL REFERENCES aggregator_coa_platform_outlet(code),
  pull_source_code TEXT NOT NULL REFERENCES aggregator_coa_pull_source(code),
  platform_code TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  partner_outlet_id TEXT NOT NULL,
  status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
  http_status INTEGER,
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  response_sample TEXT
);

CREATE TABLE IF NOT EXISTS aggregator_coa_coordinate_health (
  platform_outlet_code TEXT NOT NULL REFERENCES aggregator_coa_platform_outlet(code),
  pull_source_code TEXT NOT NULL REFERENCES aggregator_coa_pull_source(code),
  coordinate TEXT NOT NULL,
  platform_code TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  partner_outlet_id TEXT NOT NULL,
  status_code TEXT NOT NULL REFERENCES aggregator_coa_health_state(code),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_http_status INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_rows_seen INTEGER NOT NULL DEFAULT 0,
  last_rows_upserted INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  waba_alert_last_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform_outlet_code, pull_source_code)
);

CREATE INDEX IF NOT EXISTS idx_agg_coa_attempt_run
  ON aggregator_coa_pull_attempt(run_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agg_coa_attempt_coord
  ON aggregator_coa_pull_attempt(platform_outlet_code, pull_source_code, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agg_coa_health_status
  ON aggregator_coa_coordinate_health(status_code, updated_at DESC);
