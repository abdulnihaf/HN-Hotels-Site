-- Override display fields for the 15 locked expense categories (ids 1-15).
-- id + backend stay immutable (30+ references in spend.js + dashboards).
-- Admin can rename label / swap emoji / edit description / rename the Odoo
-- parent category via /ops/expense/admin/.
--
-- Merged into the CATEGORIES constant at read time in spend.js.
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=schema-expense-cat-override.sql
CREATE TABLE IF NOT EXISTS expense_cat_override (
  id          INTEGER PRIMARY KEY,     -- 1..15 (matches CATEGORIES id)
  label       TEXT,                    -- display label (null = use default)
  emoji       TEXT,                    -- display emoji
  description TEXT,                    -- display description
  parent_name TEXT,                    -- if set, Odoo product.category was renamed
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL            -- pin of admin who last edited
);
