-- HN Hotels — Purchase Bills (3-way match cache)
-- Mirror of Odoo account.move (vendor bills) for fast dashboard reads.
-- Source of truth = Odoo. D1 is read-through cache.

CREATE TABLE IF NOT EXISTS rm_vendor_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,                    -- HE | NCH
  odoo_move_id INTEGER UNIQUE,            -- account.move.id in Odoo
  odoo_po_id INTEGER,                     -- linked purchase.order.id (null if direct bill)
  odoo_po_name TEXT,                      -- e.g. P00564
  vendor_id INTEGER NOT NULL,             -- res.partner.id
  vendor_name TEXT NOT NULL,
  bill_ref TEXT,                          -- vendor's invoice number
  bill_date TEXT NOT NULL,                -- YYYY-MM-DD
  due_date TEXT,
  amount_untaxed REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  amount_total REAL NOT NULL,
  amount_paid REAL DEFAULT 0,             -- running total of registered payments (mirrors Odoo)
  payment_state TEXT DEFAULT 'not_paid',  -- not_paid | in_payment | partial | paid (from Odoo)
  state TEXT DEFAULT 'posted',            -- draft | posted | paid
  bill_photo_drive_id TEXT,
  bill_photo_link TEXT,
  notes TEXT,
  recorded_by TEXT,
  recorded_at TEXT DEFAULT (datetime('now')),
  is_direct INTEGER DEFAULT 0             -- 1 = no PO link
);

-- Migration ALTERs for existing deployments (idempotent — CREATE TABLE IF NOT
-- EXISTS above won't add new columns to an existing table). Run via the
-- migrate-bills-schema admin action:
--   POST /api/rm-ops {action:migrate-bills-schema, pin:0305}
-- ALTER TABLE rm_vendor_bills ADD COLUMN amount_paid REAL DEFAULT 0;
-- ALTER TABLE rm_vendor_bills ADD COLUMN payment_state TEXT DEFAULT 'not_paid';

CREATE INDEX IF NOT EXISTS idx_bills_brand ON rm_vendor_bills(brand);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON rm_vendor_bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bills_po ON rm_vendor_bills(odoo_po_id);
CREATE INDEX IF NOT EXISTS idx_bills_date ON rm_vendor_bills(bill_date);
