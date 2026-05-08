-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — RM Sourcing Profiles
-- Stores per-RM canonical sourcing tree (Loose vendors / Branded brand→SKU→
-- supplier / In-house recipes) as a single JSON document for unbounded
-- horizontal expansion without schema migrations.
-- D1: hn-hiring (binding DB)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS rm_sourcing_profiles (
  rm_code           TEXT PRIMARY KEY,    -- canonical e.g. HN-AM-Bl-BTR
  brand_prefix      TEXT NOT NULL,       -- HN | NCH | HE
  rm_type           TEXT NOT NULL,       -- AM | AS | DM | DS
  sourcing_profile  TEXT NOT NULL,       -- Lb | Bl | L | B | I | Lbi | etc.
  item_abbr         TEXT NOT NULL,       -- last 3 chars
  rm_name           TEXT NOT NULL,       -- human-readable name
  data_json         TEXT NOT NULL,       -- full sourcing tree as JSON
  updated_at        INTEGER NOT NULL,    -- ms epoch
  updated_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_rm_sourcing_brand ON rm_sourcing_profiles (brand_prefix);
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_type  ON rm_sourcing_profiles (rm_type);
CREATE INDEX IF NOT EXISTS idx_rm_sourcing_profile ON rm_sourcing_profiles (sourcing_profile);
