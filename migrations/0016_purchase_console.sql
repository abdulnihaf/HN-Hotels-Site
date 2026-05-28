-- HN Hotels - Purchase Console source adapter schema
-- Additive only. Money is stored in paise for all new purchase-console tables.

CREATE TABLE IF NOT EXISTS purchase_source_captures (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  auth_mode TEXT,
  endpoint_host TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  run_kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  items_seen INTEGER DEFAULT 0,
  items_changed INTEGER DEFAULT 0,
  error TEXT,
  meta_json TEXT,
  FOREIGN KEY (source_key) REFERENCES purchase_source_captures(source_key)
);

CREATE TABLE IF NOT EXISTS purchase_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  product_code TEXT,
  source_item_id TEXT,
  source_item_name TEXT NOT NULL,
  pack_label TEXT,
  pack_qty REAL,
  pack_uom TEXT,
  normalized_qty REAL,
  normalized_uom TEXT,
  price_paise INTEGER NOT NULL,
  normalized_price_paise INTEGER,
  in_stock INTEGER DEFAULT 1,
  confidence TEXT DEFAULT 'medium',
  captured_at TEXT DEFAULT (datetime('now')),
  raw_ref TEXT,
  FOREIGN KEY (source_key) REFERENCES purchase_source_captures(source_key)
);

CREATE INDEX IF NOT EXISTS idx_purchase_source_runs_source_time
  ON purchase_source_runs(source_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_price_snapshots_product_source_time
  ON purchase_price_snapshots(product_code, source_key, captured_at DESC);

INSERT OR IGNORE INTO purchase_source_captures
  (source_key, source_label, status, auth_mode, endpoint_host, notes)
VALUES
  ('LOCAL_VENDOR', 'Local vendors', 'live', 'Odoo purchase history', 'odoo.hnhotels.in', 'Baseline source from POs and vendor-product mappings'),
  ('HYPERPURE', 'Zomato Hyperpure', 'live', 'Price intelligence feed', 'hyperpure.com', 'Primary external benchmark source'),
  ('ZEPTO', 'Zepto', 'planned', 'Frontend API capture', 'zepto.com', 'Future quick-commerce adapter'),
  ('FLIPKART_MINUTES', 'Flipkart Minutes', 'planned', 'Frontend API capture', 'flipkart.com', 'Future quick-commerce adapter'),
  ('INSTAMART', 'Instamart', 'planned', 'Frontend API capture', 'swiggy.com', 'Future quick-commerce adapter'),
  ('BLINKIT', 'Blinkit', 'planned', 'Frontend API capture', 'blinkit.com', 'Future quick-commerce adapter'),
  ('AMAZON_NOW', 'Amazon Now', 'planned', 'Frontend API capture', 'amazon.in', 'Future quick-commerce adapter'),
  ('BIGBASKET', 'BigBasket', 'planned', 'Frontend API capture', 'bigbasket.com', 'Future staple comparison adapter'),
  ('JIOMART', 'JioMart', 'planned', 'Frontend API capture', 'jiomart.com', 'Future staple comparison adapter');
