-- Aggregator COA daily owner close reports
-- Apply: wrangler d1 execute hn-hiring --file=migrations/0015_aggregator_daily_owner_report.sql --remote

CREATE TABLE IF NOT EXISTS aggregator_daily_owner_report (
  report_key TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  status_code TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_status TEXT,
  model_id TEXT,
  orders_json TEXT,
  events_json TEXT,
  candidates_json TEXT,
  report_json TEXT,
  whatsapp_json TEXT,
  provider_msg_id TEXT,
  error_text TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agg_daily_report_date
  ON aggregator_daily_owner_report(report_date, brand_code, status_code);
