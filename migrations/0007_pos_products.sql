-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — POS Product Entity Ring
--
-- Closes Framework Gap 2 in the COA architecture: the 33 NCH service POS
-- products + 21 retail Niloufer SKUs that previously lived only in the
-- Foundation Sheet's "POS Products" tab are now first-class D1 rows with a
-- canonical code grammar that lets recipes (future ring) reference them by
-- FK rather than free-text.
--
-- Canonical grammar (locked):
--   {BRAND} - {SHAPE} - {ITEM}
--     BRAND ∈ {NCH, HE, HN}
--     SHAPE ∈ {S1...S10}
--       S1  — RESALE (bought-and-sold-as-is, e.g. Niloufer 100g pack)
--       S2  — MULTI_UNIT (N units of same RM per sale, e.g. 3-pack biscuits)
--       S3  — SINGLE_PORTION (exact recipe, multiple RMs in fixed proportions)
--       S4  — MULTI_PORTION (recipe scaled to multiple portions)
--       S5  — BATCH+APX (drawn from a batch with approximate per-cup ratios)
--       S6  — MARINATED_PROTEIN (HE-side: protein with marination)
--       S7  — WRAP (HE-side: wrap/roll item)
--       S8  — UNIT_PROTEIN (HE-side: unit-priced protein)
--       S9  — COMPOSITE (composite of multiple sub-items, e.g. thali plate)
--       S10 — NO_RM (service charge, packaging fee, no RM consumption)
--     ITEM — 3-char uppercase abbreviation, unique within (BRAND, SHAPE).
--
-- data_json shape (flexible properties):
--   {
--     "price":   { "mrp": int, "dsp": int },
--     "channels": { "dine_in": bool, "delivery": bool, "swiggy": bool, "zomato": bool, ... },
--     "category": "biscuit" | "chai" | ...,
--     "season":   "year-round" | "monsoon" | "summer" | "winter" | "festival",
--     "notes":    ""
--   }
--
-- Recipe FK enforcement against rm_recipes is reserved for the future Action
-- ring — establishing the entity now so the FK target exists when recipes
-- migrate into D1.
--
-- D1: hn-hiring (binding DB).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS pos_products (
  pos_code      TEXT PRIMARY KEY,                                       -- e.g. NCH-S5-IRC
  brand_prefix  TEXT NOT NULL CHECK(brand_prefix IN ('NCH','HE','HN')),
  shape         TEXT NOT NULL CHECK(shape IN ('S1','S2','S3','S4','S5','S6','S7','S8','S9','S10')),
  item_abbr     TEXT NOT NULL,                                          -- 3 uppercase chars
  pos_name      TEXT NOT NULL,                                          -- human-readable
  data_json     TEXT NOT NULL DEFAULT '{}',                             -- price/channels/category/season/notes
  updated_at    INTEGER NOT NULL,                                       -- ms epoch
  updated_by    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_brand_shape_item ON pos_products(brand_prefix, shape, item_abbr);
CREATE INDEX        IF NOT EXISTS idx_pos_brand            ON pos_products(brand_prefix);
CREATE INDEX        IF NOT EXISTS idx_pos_shape            ON pos_products(shape);
