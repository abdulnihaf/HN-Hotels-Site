-- HN Ledger — standalone expense book (NOT linked to Odoo)
-- Purpose: let Naveen re-enter every expense from Feb 3 2026 → Apr 1 2026 with
-- full product/UOM/quantity/vendor granularity. Independent of the Odoo-backed
-- /ops/expense/ system. Structure (categories/products/UOMs/vendors) is fully
-- editable by admin — nothing is locked.
--
-- Run:
--   wrangler d1 execute DB --remote --file=schema-ledger.sql

-- ── Categories (editable, not locked) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  emoji       TEXT DEFAULT '📌',
  sort_order  INTEGER DEFAULT 0,
  archived    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_cat_active ON ledger_categories(archived, sort_order);

-- ── UOMs (editable global registry) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_uoms (
  code        TEXT PRIMARY KEY,           -- 'kg', 'ltr', 'pcs', 'month'
  label       TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  archived    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_uom_active ON ledger_uoms(archived, sort_order);

-- ── Products under categories ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES ledger_categories(id),
  name         TEXT NOT NULL,
  default_uom  TEXT REFERENCES ledger_uoms(code),
  notes        TEXT,
  archived     INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  created_by   TEXT,
  UNIQUE(category_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ledger_prod_cat ON ledger_products(category_id, archived);

-- ── Vendors ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_vendors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  phone       TEXT,
  notes       TEXT,
  archived    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_vendor_active ON ledger_vendors(archived, name);

-- ── Entries (the core event table) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date            TEXT NOT NULL,              -- YYYY-MM-DD (bill/purchase date)
  brand                 TEXT,                       -- HE | NCH | HQ (NULL allowed on drafts)
  category_id           INTEGER NOT NULL REFERENCES ledger_categories(id),
  product_id            INTEGER NOT NULL REFERENCES ledger_products(id),
  quantity              REAL NOT NULL DEFAULT 0,
  uom                   TEXT NOT NULL DEFAULT '',
  unit_price            REAL,                       -- optional, derived = amount/qty
  amount                REAL NOT NULL,              -- authoritative total ₹
  vendor_id             INTEGER REFERENCES ledger_vendors(id),
  vendor_name_free      TEXT,                       -- free-text fallback
  payment_mode          TEXT,                       -- cash|hdfc|federal|razorpay|paytm|upi|card|other
  bill_number           TEXT,
  voucher_number        TEXT,                       -- Tally voucher no.
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'final',   -- draft | final
  -- Tally backfill linkage (for reconciliation)
  tally_voucher_ref     TEXT,                       -- composite key: yyyy-mm-dd_vchno_amount
  tally_account_name    TEXT,
  -- Bill primary attachment
  bill_drive_file_id    TEXT,
  bill_drive_view_url   TEXT,
  bill_filename         TEXT,
  -- Meta
  recorded_by           TEXT NOT NULL,
  recorded_at           TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_date    ON ledger_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_brand   ON ledger_entries(brand);
CREATE INDEX IF NOT EXISTS idx_ledger_cat     ON ledger_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ledger_product ON ledger_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_ledger_status  ON ledger_entries(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_tally ON ledger_entries(tally_voucher_ref) WHERE tally_voucher_ref IS NOT NULL;

-- ── Bill attachments (one entry → many bills allowed) ─────────────────────
CREATE TABLE IF NOT EXISTS ledger_bills (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id            INTEGER NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  drive_file_id       TEXT,
  drive_view_url      TEXT,
  drive_folder_path   TEXT,
  filename            TEXT,
  mimetype            TEXT,
  file_size_kb        INTEGER,
  uploaded_by         TEXT,
  uploaded_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_bills_entry ON ledger_bills(entry_id);
