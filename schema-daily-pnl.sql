-- HN Hotels daily operating P&L foundation
-- Business date is IST. Money is stored in paise integers.
-- This layer freezes read-side facts from Takht/Sales, Anbar, Darbar, and major bills.

CREATE TABLE IF NOT EXISTS daily_pnl_overheads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL CHECK (brand IN ('HE','NCH','BOTH')),
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'major_bill',
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  brand_share_bp INTEGER NOT NULL DEFAULT 10000,
  vendor_name TEXT,
  source_ref TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_pnl_overheads_brand_period
  ON daily_pnl_overheads(brand, period_start, period_end, active);

CREATE TABLE IF NOT EXISTS daily_pnl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL CHECK (brand IN ('HE','NCH')),
  business_date TEXT NOT NULL,
  run_status TEXT NOT NULL CHECK (run_status IN ('blocked','draft','final')),
  source_hash TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  pnl_json TEXT NOT NULL,
  gates_json TEXT NOT NULL,
  revenue_paise INTEGER,
  raw_cogs_paise INTEGER,
  gross_food_profit_paise INTEGER,
  gross_food_margin_bp INTEGER,
  labor_paise INTEGER,
  major_bills_paise INTEGER,
  operating_profit_paise INTEGER,
  operating_margin_bp INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  replaces_run_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_daily_pnl_runs_brand_day
  ON daily_pnl_runs(brand, business_date, is_current);
