-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — Vendor Entity Ring 5-segment grammar migration
-- Extends vendor_profiles with three new dimensions to lock the
-- canonical code at: {PAY_SEQ}-{SELLS}-{OPM}-{PMS}-{IDENTITY}
--
--   PAY_SEQ ∈ {Pf, Rf}            — pay-first vs receive-first (existing)
--   SELLS   ∈ {L, B, LB}          — alphabetical subset of {L, B}
--                                   (RM-purchase scope only; S/C reserved
--                                   for services/capex when expense scope opens)
--   OPM     ∈ {M, A}              — Manual (call/WA/walk-in/route)
--                                   vs Automatable (app/web/API)
--   PMS     ∈ {C, D, H}           — payment method support:
--                                   Cash-only / Digital-only / Hybrid
--
-- Live vendor count was 0 at migration authoring (verified 2026-05-09).
-- Any pre-existing rows default to ('L','M','C') — owner can correct via editor.
-- D1: hn-hiring (binding DB)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE vendor_profiles ADD COLUMN sells TEXT NOT NULL DEFAULT 'L'
  CHECK(sells IN ('L', 'B', 'LB'));
ALTER TABLE vendor_profiles ADD COLUMN opm TEXT NOT NULL DEFAULT 'M'
  CHECK(opm IN ('M', 'A'));
ALTER TABLE vendor_profiles ADD COLUMN pms TEXT NOT NULL DEFAULT 'C'
  CHECK(pms IN ('C', 'D', 'H'));

CREATE INDEX IF NOT EXISTS idx_vendor_sells ON vendor_profiles(sells);
CREATE INDEX IF NOT EXISTS idx_vendor_opm   ON vendor_profiles(opm);
CREATE INDEX IF NOT EXISTS idx_vendor_pms   ON vendor_profiles(pms);
