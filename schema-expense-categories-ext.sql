-- HN Expense — extendable categories (Apr 20 2026)
-- The 14 built-in categories (IDs 1-15) remain hard-coded in /functions/api/spend.js.
-- This table ONLY holds NEW categories that Naveen adds via /ops/expense/admin/.
-- Custom category IDs start at 100 (never collides with locked 1-15 range).
--
-- Every custom category is bound to an Odoo product.category by STABLE ID (odoo_category_id),
-- not a string ilike — so Odoo-side renames never break the item lookup.
--
-- Run:  wrangler d1 execute DB --remote --file schema-expense-categories-ext.sql

CREATE TABLE IF NOT EXISTS expense_categories_ext (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  label             TEXT NOT NULL,
  emoji             TEXT DEFAULT '📌',
  description       TEXT DEFAULT '',
  backend           TEXT NOT NULL DEFAULT 'hr.expense',    -- locked to hr.expense for now
  odoo_category_id  INTEGER NOT NULL,                      -- stable Odoo product.category ID
  odoo_category_name TEXT,                                 -- mirror for display only
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by_pin    TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Custom category IDs must start at 100 so they never clash with the locked 1-15 range
UPDATE sqlite_sequence SET seq = 99 WHERE name = 'expense_categories_ext';
INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES ('expense_categories_ext', 99);

CREATE INDEX IF NOT EXISTS idx_exp_cat_ext_active ON expense_categories_ext(is_active);
