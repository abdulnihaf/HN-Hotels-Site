-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — Vendor Entity Ring (canonical sourcing-side identity)
-- Stores per-vendor canonical code: {PAY_SEQ}-{IDENTITY}
--   PAY_SEQ ∈ {Pf,Rf} — Pay-first vs Receive-first (the architectural binary)
--   IDENTITY — uppercase abbr 3-10 chars, unique across all vendors
-- BRAND scope, SELLS categories, and RM-supplied list are computed views from
-- rm_sourcing_profiles (not stored here). Only the canonical minimum lives in
-- the static row; everything else is data_json properties or computed.
-- D1: hn-hiring (binding DB)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS vendor_profiles (
  vendor_code   TEXT PRIMARY KEY,                            -- e.g. Rf-PRABHU
  pay_seq       TEXT NOT NULL CHECK(pay_seq IN ('Pf','Rf')), -- pay-first vs receive-first
  identity_abbr TEXT NOT NULL,                               -- e.g. PRABHU, ZEPTO, SHARIFF
  vendor_name   TEXT NOT NULL,                               -- human-readable name
  data_json     TEXT NOT NULL DEFAULT '{}',                  -- communication/location/payment/gst/notes
  updated_at    INTEGER NOT NULL,                            -- ms epoch
  updated_by    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_identity ON vendor_profiles(identity_abbr);
CREATE INDEX        IF NOT EXISTS idx_vendor_pay_seq  ON vendor_profiles(pay_seq);
