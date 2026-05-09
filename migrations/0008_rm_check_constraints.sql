-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — RM doctrine enforcement: DB CHECK constraints
--
-- Audit (docs/COA-Architecture-Audit-2026-05-09.md) flagged rm_sourcing_profiles
-- as the leakiest entity ring: API + editor enforce architectural dimensions,
-- but the table itself accepts ANY TEXT in brand_prefix / rm_type /
-- usage_profile / sourcing_profile. Direct D1 INSERT bypasses every validator.
-- This violates Layer 2 of doctrine: "schema mirrors dimensions".
--
-- This migration brings the RM table to parity with vendor_profiles (post-v8)
-- and pos_products: triple-layer enforcement (DB CHECK + API validator +
-- editor disable-save) for every architectural dimension.
--
-- Closed value sets per locked grammar:
--   brand_prefix     ∈ {NCH, HE, HN}
--   rm_type          ∈ {AM, AS, DM, DS}        (NO P-prefix — PM/PS were
--                                              experimental, never doctrine-locked)
--   usage_profile    ∈ {P, R, O, Pr, Rp, Po, Op, Or, Ro, Pro, Por, Rop, Rpo,
--                       Opr, Orp}             (15 valid combos)
--   sourcing_profile ∈ {L, B, Lb, Bl, Li, Bi, Lbi, Bli}
--                                              (8 valid combos — explicitly
--                                              EXCLUDES I-primary {I, Il, Ib,
--                                              Ilb}: those are states-of-
--                                              production, not RMs)
--
-- Pre-flight verified 2026-05-09 against 55 production rows:
--   brand_prefix      ∈ {HN, NCH}                    → PASS
--   rm_type           ∈ {AM, AS, DM, DS}             → PASS
--   usage_profile     ∈ {O, P, Pr, R}                → PASS
--   sourcing_profile  ∈ {B, Bl, L, Lb, Lbi, Li}      → PASS
-- All 55 rows clear the new CHECKs. Migration is non-destructive.
--
-- D1 / SQLite cannot ALTER TABLE … ADD CHECK; we use the recreate-table
-- workaround established in 0005/0006: create _new with new CHECKs → INSERT
-- SELECT → drop original → rename → restore indexes.
--
-- D1 binding: hn-hiring (DB).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRAGMA foreign_keys = OFF;

CREATE TABLE rm_sourcing_profiles_new (
  rm_code           TEXT PRIMARY KEY,
  brand_prefix      TEXT NOT NULL CHECK(brand_prefix IN ('NCH','HE','HN')),
  rm_type           TEXT NOT NULL CHECK(rm_type IN ('AM','AS','DM','DS')),
  usage_profile     TEXT NOT NULL CHECK(usage_profile IN (
                      'P','R','O',
                      'Pr','Rp','Po','Op','Or','Ro',
                      'Pro','Por','Rop','Rpo','Opr','Orp'
                    )),
  sourcing_profile  TEXT NOT NULL CHECK(sourcing_profile IN (
                      'L','B','Lb','Bl','Li','Bi','Lbi','Bli'
                    )),
  item_abbr         TEXT NOT NULL,
  rm_name           TEXT NOT NULL,
  data_json         TEXT NOT NULL DEFAULT '{}',
  updated_at        INTEGER NOT NULL,
  updated_by        TEXT
);

INSERT INTO rm_sourcing_profiles_new
  (rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
   rm_name, data_json, updated_at, updated_by)
SELECT
  rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
  rm_name, data_json, updated_at, updated_by
FROM rm_sourcing_profiles;

DROP TABLE rm_sourcing_profiles;
ALTER TABLE rm_sourcing_profiles_new RENAME TO rm_sourcing_profiles;

-- Restore indexes that existed on the original table (0001_rm_sourcing_profiles.sql).
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_brand   ON rm_sourcing_profiles(brand_prefix);
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_type    ON rm_sourcing_profiles(rm_type);
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_usage   ON rm_sourcing_profiles(usage_profile);
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_profile ON rm_sourcing_profiles(sourcing_profile);

PRAGMA foreign_keys = ON;
