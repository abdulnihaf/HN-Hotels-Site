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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_brand ON rm_products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON rm_products(category);
CREATE INDEX IF NOT EXISTS idx_products_action ON rm_products(action);
CREATE INDEX IF NOT EXISTS idx_vendor_products_product ON rm_vendor_products(product_code);
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON rm_vendor_products(vendor_key);
CREATE INDEX IF NOT EXISTS idx_sync_log_ref ON rm_sync_log(reference);
