-- ─────────────────────────────────────────────────────────
-- HN Vendor Master — D1 schema
-- Mirrors Odoo res.partner (supplier_rank > 0) + adds operational fields
-- not present in Odoo: payment_terms, primary_brand, delivery_slot,
-- raw materials supplied, owner/contact name, addresses, GSTIN/PAN.
-- D1 is the ops source of truth for the rich vendor profile;
-- Odoo remains the financial system of record (POs, bills).
-- Generated 2026-04-25.
-- ─────────────────────────────────────────────────────────

-- Core vendor record
CREATE TABLE IF NOT EXISTS vendors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_key      TEXT    NOT NULL UNIQUE,           -- slug e.g. 'abid-cheese-balls'
  odoo_partner_id INTEGER UNIQUE,                    -- res.partner.id; nullable until synced
  name            TEXT    NOT NULL,
  phone           TEXT,
  alternate_phone TEXT,
  owner_contact   TEXT,                              -- name of person to call
  address         TEXT,
  gstin           TEXT,
  pan             TEXT,
  bank_upi        TEXT,                              -- 'UPI', 'Cash', 'Bank', 'Bank Transfer', etc.
  payment_terms   TEXT CHECK(payment_terms IN ('on_delivery','7d','15d','30d','45d','other') OR payment_terms IS NULL),
  payment_terms_other TEXT,                          -- when payment_terms = 'other'
  primary_brand   TEXT CHECK(primary_brand IN ('HE','NCH','BOTH') OR primary_brand IS NULL),
  delivery_slot   TEXT,                              -- 'morning','evening','daily','DAY time', etc.
  notes           TEXT,
  active          INTEGER NOT NULL DEFAULT 1,        -- 0=archived, 1=active
  merged_into_id  INTEGER,                           -- when this is a dup, points to canonical vendor.id
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by      TEXT                               -- who last edited (PIN role: admin/cfo/gm/asstmgr/purchase)
);

CREATE INDEX IF NOT EXISTS idx_vendors_phone        ON vendors(phone);
CREATE INDEX IF NOT EXISTS idx_vendors_odoo         ON vendors(odoo_partner_id);
CREATE INDEX IF NOT EXISTS idx_vendors_brand        ON vendors(primary_brand);
CREATE INDEX IF NOT EXISTS idx_vendors_active       ON vendors(active);

-- Vendor → raw material mapping (many-to-many)
-- Tracks which RMs each vendor supplies + per-vendor pricing if known.
CREATE TABLE IF NOT EXISTS vendor_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id       INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  hn_rm_code      TEXT,                              -- 'HN-RM-073' — nullable for vendors with unmapped items
  product_name    TEXT NOT NULL,                     -- 'Chicken Tandoori Cut'
  uom             TEXT,                              -- 'kg', 'L', 'Units'
  qty_hint        REAL,                              -- last-known typical order qty (helps Predictor)
  unit_price      REAL,                              -- last-known unit price (₹) — auto-populated from POs
  unit_price_at   INTEGER,                           -- unixepoch when unit_price was last refreshed
  is_primary_vendor INTEGER NOT NULL DEFAULT 0,      -- 1 if this vendor is the default for this RM
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_vp_vendor    ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vp_rm        ON vendor_products(hn_rm_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_vendor_rm ON vendor_products(vendor_id, hn_rm_code);

-- Vendor activity log (audit trail for edits + Odoo syncs)
CREATE TABLE IF NOT EXISTS vendor_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                         -- 'create','update','merge','sync_odoo','add_product','remove_product'
  payload     TEXT,                                  -- JSON diff
  actor       TEXT,                                  -- PIN holder name+role
  at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_vlog_vendor ON vendor_log(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vlog_at     ON vendor_log(at);

-- Quick aggregate view: vendor with product count + last interaction
-- (Real interaction stats join with business_expenses + rm_vendor_bills at query time.)
CREATE VIEW IF NOT EXISTS vendor_summary AS
SELECT
  v.id, v.vendor_key, v.odoo_partner_id, v.name, v.phone, v.owner_contact,
  v.primary_brand, v.payment_terms, v.bank_upi, v.delivery_slot, v.active,
  (SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = v.id AND vp.active = 1) AS product_count,
  v.updated_at
FROM vendors v
WHERE v.active = 1 AND v.merged_into_id IS NULL;
