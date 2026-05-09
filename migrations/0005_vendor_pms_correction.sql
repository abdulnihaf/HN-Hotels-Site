-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — Vendor PMS scheme correction
--
-- Migration 0004 shipped {C, D, H} for PMS. This migration:
--   1. Renames `D` (Digital-only) → `B` (Bank-only) — `Bank` is the precise
--      domain term; `Digital` was inherited muddled language.
--   2. Replaces single-letter `H` (Hybrid) with case-encoded {Cb, Bc} —
--      uppercase primary + lowercase alternate — mirroring how SOURCING uses
--      Lb/Bl and USAGE uses Pr/Rp. The extra information is which channel
--      is the vendor's PRIMARY; it was previously thrown away in `H`.
--
-- New constraint set: pms ∈ {C, B, Cb, Bc}
--   C  — Cash-only
--   B  — Bank-only
--   Cb — Hybrid, cash primary + bank alternate
--   Bc — Hybrid, bank primary + cash alternate
--
-- D1 / SQLite cannot ALTER TABLE … DROP CHECK; we use the standard
-- recreate-table workaround: create _new with new CHECK, copy, drop, rename.
--
-- Live vendor count was 0 prior to this migration (verified 2026-05-09).
-- Defensive UPDATEs cover any rows that may have been added between PR #129
-- and this migration's apply window.
-- D1: hn-hiring (binding DB)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Defensive value rewrites — rename D→B, fold H→Cb (most common Hybrid
--    intent: small vendors are cash-primary, bank-secondary).
UPDATE vendor_profiles SET pms = 'B'  WHERE pms = 'D';
UPDATE vendor_profiles SET pms = 'Cb' WHERE pms = 'H';

-- 2. Recreate vendor_profiles with the new CHECK on pms.
PRAGMA foreign_keys = OFF;

CREATE TABLE vendor_profiles_new (
  vendor_code   TEXT PRIMARY KEY,
  pay_seq       TEXT NOT NULL CHECK(pay_seq IN ('Pf','Rf')),
  identity_abbr TEXT NOT NULL,
  vendor_name   TEXT NOT NULL,
  data_json     TEXT NOT NULL DEFAULT '{}',
  sells         TEXT NOT NULL DEFAULT 'L'  CHECK(sells IN ('L','B','LB')),
  opm           TEXT NOT NULL DEFAULT 'M'  CHECK(opm   IN ('M','A')),
  pms           TEXT NOT NULL DEFAULT 'C'  CHECK(pms   IN ('C','B','Cb','Bc')),
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT
);

INSERT INTO vendor_profiles_new
  (vendor_code, pay_seq, identity_abbr, vendor_name, data_json,
   sells, opm, pms, updated_at, updated_by)
SELECT
   vendor_code, pay_seq, identity_abbr, vendor_name, data_json,
   sells, opm, pms, updated_at, updated_by
  FROM vendor_profiles;

DROP TABLE vendor_profiles;
ALTER TABLE vendor_profiles_new RENAME TO vendor_profiles;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_identity ON vendor_profiles(identity_abbr);
CREATE INDEX        IF NOT EXISTS idx_vendor_pay_seq  ON vendor_profiles(pay_seq);
CREATE INDEX        IF NOT EXISTS idx_vendor_sells    ON vendor_profiles(sells);
CREATE INDEX        IF NOT EXISTS idx_vendor_opm      ON vendor_profiles(opm);
CREATE INDEX        IF NOT EXISTS idx_vendor_pms      ON vendor_profiles(pms);

PRAGMA foreign_keys = ON;
