-- ─────────────────────────────────────────────────────────
-- Fix-D: Add vendor + quantity + UOM fields to business_expenses
-- Backward compatible — all new columns nullable.
-- After deploy, spend.js?action=record will persist these fields when
-- the client sends them. Existing rows stay NULL until the optional
-- backfill from Odoo hr.expense runs.
-- Generated 2026-04-25.
-- ─────────────────────────────────────────────────────────

-- Vendor link (maps to res.partner.id; mirrors to vendors.odoo_partner_id)
ALTER TABLE business_expenses ADD COLUMN vendor_id INTEGER;

-- Vendor name snapshot at write time (defensive — Odoo rename shouldn't lose it)
ALTER TABLE business_expenses ADD COLUMN vendor_name TEXT;

-- Quantity + UOM — lets agents reason about ₹/kg, ₹/L, ₹/Unit
ALTER TABLE business_expenses ADD COLUMN quantity REAL;
ALTER TABLE business_expenses ADD COLUMN uom TEXT;

-- Canonical product link — when fix-E lookback merge collapses dups
-- (e.g. Bun ↔ Buns), product_id stays as-recorded but canonical_product_id
-- points to the keeper. Agent fabric joins on canonical_product_id.
ALTER TABLE business_expenses ADD COLUMN canonical_product_id INTEGER;

-- Helpful indexes for vendor + agent queries
CREATE INDEX IF NOT EXISTS idx_be_vendor_id ON business_expenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_be_canonical ON business_expenses(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_be_recorded_at ON business_expenses(recorded_at);
