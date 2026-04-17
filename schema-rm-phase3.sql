-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Hotels — RM Phase 3: Variant-aware prices + price intelligence
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Phase 2 shipped rm_product_variants (Odoo template → variant cache).
-- Phase 3 wires variant awareness into the price tables (rm_daily_prices,
-- rm_vendor_products, rm_market_prices) and introduces a per-variant
-- rolling-stats table used by price-intel badges on the Purchase UI.
--
-- Strategy: ADDITIVE — every new column is nullable. Legacy rows keep
-- product_code only; new rows set BOTH product_code (template or flat code)
-- AND odoo_variant_id. Back-compat is preserved so Phase 5 (flat→variant
-- migration of 138 products) can proceed at its own pace.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1) Vendor-product links: record which VARIANT a vendor supplies at what price
ALTER TABLE rm_vendor_products ADD COLUMN odoo_variant_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_rm_vendor_products_variant
  ON rm_vendor_products(odoo_variant_id);

-- 2) Daily prices: scope each recorded price to a variant (plus a friendly label)
ALTER TABLE rm_daily_prices ADD COLUMN odoo_variant_id INTEGER;
ALTER TABLE rm_daily_prices ADD COLUMN variant_display TEXT;
CREATE INDEX IF NOT EXISTS idx_rm_daily_prices_variant_brand
  ON rm_daily_prices(odoo_variant_id, brand, recorded_at);

-- 3) Market prices (platform scraping): link a benchmark to a variant when known
ALTER TABLE rm_market_prices ADD COLUMN odoo_variant_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_rm_market_prices_variant
  ON rm_market_prices(odoo_variant_id, checked_at);

-- 4) Variant price summary — one row per (variant × brand), refreshed on write
CREATE TABLE IF NOT EXISTS rm_variant_price_summary (
  odoo_variant_id   INTEGER NOT NULL,
  brand             TEXT NOT NULL,
  display_name      TEXT,
  uom               TEXT,
  last_price        REAL,
  last_vendor_key   TEXT,
  last_source       TEXT,
  last_recorded_at  TEXT,
  price_30d_avg     REAL,
  price_30d_min     REAL,
  price_30d_max     REAL,
  price_30d_count   INTEGER DEFAULT 0,
  price_prev_30d_avg REAL,        -- avg for days 31-60 (for trend computation)
  trend_pct         REAL,          -- % change (last_price vs price_30d_avg)
  market_cheapest_platform TEXT,   -- cheapest platform from rm_market_prices
  market_cheapest_price    REAL,
  market_savings_pct       REAL,   -- (last_price - market_cheapest) / last_price * 100
  updated_at        TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (odoo_variant_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_rm_variant_price_summary_brand_recent
  ON rm_variant_price_summary(brand, last_recorded_at);

CREATE INDEX IF NOT EXISTS idx_rm_variant_price_summary_savings
  ON rm_variant_price_summary(market_savings_pct DESC);
