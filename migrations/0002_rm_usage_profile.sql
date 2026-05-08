-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — RM Sourcing Profiles · USAGE Dimension
-- Adds a USAGE classification orthogonal to SOURCING:
--   P  = Production only       (consumed by recipes/service)
--   R  = Retail only           (purchased to resell)
--   Pr = Primary production, retail also possible
--   Rp = Primary retail, production also possible
-- Forbidden: empty USAGE. Every RM is at least one of P or R.
--
-- New canonical code grammar (5 segments):
--   {BRAND}-{TYPE}-{USAGE}-{SOURCING}-{ITEM}
--
-- D1: hn-hiring (binding DB)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE rm_sourcing_profiles ADD COLUMN usage_profile TEXT NOT NULL DEFAULT 'P';

CREATE INDEX IF NOT EXISTS idx_rm_sourcing_usage ON rm_sourcing_profiles (usage_profile);
