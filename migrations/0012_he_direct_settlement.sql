CREATE TABLE IF NOT EXISTS he_direct_settlement_sessions (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL DEFAULT 'HE',
  business_date TEXT NOT NULL,
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('bootstrap', 'eod')),
  status TEXT NOT NULL DEFAULT 'submitted',
  actor_pin TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  notes TEXT,
  source_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_he_direct_sessions_date_type
  ON he_direct_settlement_sessions (business_date, settlement_type, created_at);

CREATE TABLE IF NOT EXISTS he_direct_settlement_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  opening_units REAL NOT NULL DEFAULT 0,
  purchased_units REAL NOT NULL DEFAULT 0,
  sold_units REAL NOT NULL DEFAULT 0,
  closing_units REAL NOT NULL DEFAULT 0,
  expected_closing_units REAL NOT NULL DEFAULT 0,
  discrepancy_units REAL NOT NULL DEFAULT 0,
  latest_unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  discrepancy_value_paise INTEGER NOT NULL DEFAULT 0,
  sold_source TEXT NOT NULL DEFAULT 'manual',
  purchase_source_json TEXT,
  sales_source_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES he_direct_settlement_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_he_direct_counts_item
  ON he_direct_settlement_counts (item_key, created_at);

CREATE INDEX IF NOT EXISTS idx_he_direct_counts_session
  ON he_direct_settlement_counts (session_id);

CREATE TABLE IF NOT EXISTS he_direct_vendor_dues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  due_balance_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES he_direct_settlement_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_he_direct_vendor_dues_vendor
  ON he_direct_vendor_dues (vendor_key, created_at);
