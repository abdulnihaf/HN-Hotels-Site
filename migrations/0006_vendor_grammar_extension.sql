-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — Vendor v8 grammar doctrine fix
--
-- Owner identified that the v7 grammar couldn't fully encode possibility from
-- impossibility because PAY_SEQ and OPM were exclusive binaries and SELLS used
-- a flat alphabetical pair `LB`. PMS already had the case-encoded primary/alt
-- pattern (C / B / Cb / Bc); v8 extends the same pattern to ALL FOUR
-- architectural dimensions so the math is uniform across the entity ring.
--
-- New grammar (locked):
--   {PAY_SEQ}-{SELLS}-{OPM}-{PMS}-{IDENTITY}
--     PAY_SEQ ∈ {Pf, Rf, Pfr, Rfp}
--       Pf  — only pay-first
--       Rf  — only receive-first
--       Pfr — pay-first primary + receive-first alt (the rarer case)
--       Rfp — receive-first primary + pay-first alt
--     SELLS   ∈ {L, B, Lb, Bl}
--       L   — loose only
--       B   — branded only
--       Lb  — loose primary + branded alt
--       Bl  — branded primary + loose alt
--     OPM     ∈ {M, A, Ma, Am}
--       M   — manual only
--       A   — automatable only
--       Ma  — manual primary + automatable alt
--       Am  — automatable primary + manual alt
--     PMS     ∈ {C, B, Cb, Bc}   (no change — already correct in 0005)
--     IDENTITY — unchanged
--
-- Migration of 24 production vendors:
--   - The 14 SELLS='LB' rows migrate to 'Lb' (default primary letter is the
--     alphabetical first; owner can flip to Bl via the editor).
--   - The vendor_code primary key was constructed from segment values, so any
--     code containing '-LB-' must also be rewritten to '-Lb-' to keep the
--     stored PK in sync with the segment columns.
--   - Existing PAY_SEQ ('Pf' / 'Rf') and OPM ('M' / 'A') values stay valid;
--     the alternates (Pfr/Rfp/Ma/Am) are only available going forward.
--
-- D1 / SQLite cannot ALTER TABLE … DROP CHECK; we use the recreate-table
-- workaround: defensive UPDATE → create _new with new CHECKs → copy → drop →
-- rename → restore indexes.
--
-- Verified 2026-05-09: 24 vendors live, 14 of them with sells='LB'.
-- D1 binding: hn-hiring (DB).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Recreate vendor_profiles with extended CHECK constraints.
--    The data transform from 'LB' → 'Lb' (and any 'BL' to 'Bl' as
--    belt-and-braces) happens inside the INSERT … SELECT, so the new
--    CHECK constraint never sees the old flat value. The vendor_code PK
--    is rewritten in the same SELECT so the stored code matches the
--    migrated segment value (e.g. Rf-LB-M-C-PRABHU → Rf-Lb-M-C-PRABHU).
PRAGMA foreign_keys = OFF;

CREATE TABLE vendor_profiles_new (
  vendor_code   TEXT PRIMARY KEY,
  pay_seq       TEXT NOT NULL CHECK(pay_seq IN ('Pf','Rf','Pfr','Rfp')),
  identity_abbr TEXT NOT NULL,
  vendor_name   TEXT NOT NULL,
  data_json     TEXT NOT NULL DEFAULT '{}',
  sells         TEXT NOT NULL DEFAULT 'L'  CHECK(sells IN ('L','B','Lb','Bl')),
  opm           TEXT NOT NULL DEFAULT 'M'  CHECK(opm   IN ('M','A','Ma','Am')),
  pms           TEXT NOT NULL DEFAULT 'C'  CHECK(pms   IN ('C','B','Cb','Bc')),
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT
);

INSERT INTO vendor_profiles_new
  (vendor_code, pay_seq, identity_abbr, vendor_name, data_json,
   sells, opm, pms, updated_at, updated_by)
SELECT
   REPLACE(REPLACE(vendor_code, '-LB-', '-Lb-'), '-BL-', '-Bl-'),
   pay_seq,
   identity_abbr,
   vendor_name,
   data_json,
   CASE sells WHEN 'LB' THEN 'Lb' WHEN 'BL' THEN 'Bl' ELSE sells END,
   opm,
   pms,
   updated_at,
   updated_by
  FROM vendor_profiles;

DROP TABLE vendor_profiles;
ALTER TABLE vendor_profiles_new RENAME TO vendor_profiles;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_identity ON vendor_profiles(identity_abbr);
CREATE INDEX        IF NOT EXISTS idx_vendor_pay_seq  ON vendor_profiles(pay_seq);
CREATE INDEX        IF NOT EXISTS idx_vendor_sells    ON vendor_profiles(sells);
CREATE INDEX        IF NOT EXISTS idx_vendor_opm      ON vendor_profiles(opm);
CREATE INDEX        IF NOT EXISTS idx_vendor_pms      ON vendor_profiles(pms);

PRAGMA foreign_keys = ON;
