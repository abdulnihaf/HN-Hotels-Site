-- HN Hotels — Raw Materials Management Schema
-- Database: hn-hiring (D1)
-- Run: wrangler d1 execute DB --local --file schema-rm.sql

-- Vendors
CREATE TABLE IF NOT EXISTS rm_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  odoo_id INTEGER,
  company_id TEXT,                     -- '1' (HE), '10' (NCH), null (shared)
  rename_from TEXT,                    -- old Odoo name if vendor needs rename
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Products
CREATE TABLE IF NOT EXISTS rm_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_code TEXT UNIQUE NOT NULL,        -- HN-RM-001
  old_code TEXT,                       -- HE-RM-001 / RM-BFM
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  uom TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (brand IN ('HE', 'NCH', 'BOTH')),
  avg_cost REAL DEFAULT 0,
  odoo_id INTEGER,
  action TEXT NOT NULL DEFAULT 'KEEP' CHECK (action IN ('KEEP', 'UPDATE', 'CREATE', 'ARCHIVE')),
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Product ↔ Vendor mappings (many-to-many)
CREATE TABLE IF NOT EXISTS rm_vendor_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,
  last_price REAL,
  notes TEXT,
  FOREIGN KEY (product_code) REFERENCES rm_products(hn_code),
  FOREIGN KEY (vendor_key) REFERENCES rm_vendors(key),
  UNIQUE(product_code, vendor_key)
);

-- Products to archive (REMOVE list)
CREATE TABLE IF NOT EXISTS rm_archive_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_code TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  reason TEXT,
  odoo_id INTEGER,
  archived_at TEXT
);

-- Sync log — tracks what was pushed to Odoo and when
CREATE TABLE IF NOT EXISTS rm_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                -- 'create_product', 'update_product', 'create_vendor', etc.
  target_model TEXT,                   -- 'product.product', 'res.partner', etc.
  target_id INTEGER,                   -- Odoo record ID
  reference TEXT,                      -- HN-RM-001 or vendor key
  details TEXT,                        -- JSON of what was synced
  synced_by TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- OPERATIONAL TABLES (Purchase → Consumption → Settlement)
-- ============================================================

-- Daily prices (auto-recorded from POs, or manual entry)
CREATE TABLE IF NOT EXISTS rm_daily_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  brand TEXT NOT NULL,
  price REAL NOT NULL,
  recorded_by TEXT,
  source TEXT,                        -- 'po:PO00123' or 'manual'
  recorded_at TEXT DEFAULT (datetime('now'))
);

-- Settlement records (per brand, per period)
CREATE TABLE IF NOT EXISTS rm_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  settled_by TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  opening_stock TEXT,                 -- JSON {HN-RM-001: qty, ...}
  closing_stock TEXT,                 -- JSON (physical count)
  purchased TEXT,                     -- JSON (received in period)
  consumed TEXT,                      -- JSON (opening + purchased - closing)
  pos_revenue TEXT,                   -- JSON summary
  cost_summary TEXT,                  -- JSON {total, per_item: {code: cost}}
  notes TEXT,
  status TEXT DEFAULT 'completed',
  settled_at TEXT DEFAULT (datetime('now'))
);

-- Which items each brand counts (priority tiers)
CREATE TABLE IF NOT EXISTS rm_tracked_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  brand TEXT NOT NULL,
  tier INTEGER DEFAULT 1,             -- 1=daily, 2=every 2-3 days, 3=weekly
  count_method TEXT DEFAULT 'direct',  -- 'direct','vessel','container'
  is_active INTEGER DEFAULT 1,
  UNIQUE(product_code, brand)
);

-- Audit log for all operational actions
CREATE TABLE IF NOT EXISTS rm_ops_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  brand TEXT NOT NULL,
  user_name TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_brand ON rm_products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON rm_products(category);
CREATE INDEX IF NOT EXISTS idx_products_action ON rm_products(action);
CREATE INDEX IF NOT EXISTS idx_vendor_products_product ON rm_vendor_products(product_code);
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON rm_vendor_products(vendor_key);
CREATE INDEX IF NOT EXISTS idx_sync_log_ref ON rm_sync_log(reference);
CREATE INDEX IF NOT EXISTS idx_daily_prices_code ON rm_daily_prices(product_code, brand);
CREATE INDEX IF NOT EXISTS idx_settlements_brand ON rm_settlements(brand, settled_at);
CREATE INDEX IF NOT EXISTS idx_tracked_items_brand ON rm_tracked_items(brand, is_active);
CREATE INDEX IF NOT EXISTS idx_ops_log_brand ON rm_ops_log(brand, created_at);
