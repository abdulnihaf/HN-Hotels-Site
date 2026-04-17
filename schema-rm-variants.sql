-- Phase 2: Variant cache table
-- Mirrors Odoo product.product (variants) for fast Purchase-tab search.
-- One row per Odoo variant. Template metadata is denormalised so the picker
-- can group by template without re-reading Odoo on every render.

CREATE TABLE IF NOT EXISTS rm_product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odoo_variant_id   INTEGER UNIQUE NOT NULL,  -- product.product id
  odoo_template_id  INTEGER NOT NULL,         -- product.template id
  template_name     TEXT NOT NULL,            -- "Refined Sunflower Oil"
  display_name      TEXT NOT NULL,            -- "Refined Sunflower Oil (Ruchi, 1L)"
  default_code      TEXT,                     -- HN-RM-xxx-N
  category          TEXT,
  category_id       INTEGER,
  uom               TEXT,
  uom_id            INTEGER,
  company_id        INTEGER,                  -- 1 HE, 10 NCH, NULL shared
  attrs_json        TEXT,                     -- {"Brand":"Ruchi","Pack Size":"1L"}
  brand_value       TEXT,
  pack_value        TEXT,
  grade_value       TEXT,
  avg_cost          REAL DEFAULT 0,
  last_price        REAL,
  last_vendor_key   TEXT,
  is_active         INTEGER DEFAULT 1,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pvar_tmpl     ON rm_product_variants(odoo_template_id);
CREATE INDEX IF NOT EXISTS idx_pvar_tmplname ON rm_product_variants(template_name);
CREATE INDEX IF NOT EXISTS idx_pvar_active   ON rm_product_variants(is_active);
CREATE INDEX IF NOT EXISTS idx_pvar_category ON rm_product_variants(category);
CREATE INDEX IF NOT EXISTS idx_pvar_brand    ON rm_product_variants(brand_value);
