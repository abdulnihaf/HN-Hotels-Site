-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HN Spend Intelligence — unified fact layer for dashboard
-- Sources: odoo.hnhotels.in (purchase.order, account.move, hr.expense)
--          ops.hamzahotel.com (NCH v2 hr.expense — until migrated)
-- Dashboard reads ONLY from this schema. Odoo is touched only by
-- workers/spend-sync-cron/.
--
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=schema-spend-intel.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ── fact_spend: one row per spend event ────────────────────
DROP TABLE IF EXISTS fact_spend;
CREATE TABLE fact_spend (
  id                TEXT PRIMARY KEY,          -- '{inst}:{model}:{odoo_id}'
  odoo_instance     TEXT NOT NULL,             -- 'hnhotels' | 'ops-hamza'
  odoo_model        TEXT NOT NULL,             -- 'purchase.order' | 'account.move' | 'hr.expense'
  odoo_id           INTEGER NOT NULL,
  odoo_line_id      INTEGER,                   -- line-level rows carry this; header-only rows null
  odoo_name         TEXT,                      -- 'P00456' | 'INV/2026/0012' | 'EXP/045'

  -- WHEN (IST)
  occurred_at       TEXT NOT NULL,             -- 'YYYY-MM-DD HH:MM' — when spend actually happened
  recorded_at       TEXT NOT NULL,             -- when entered in system
  period_day        TEXT NOT NULL,             -- 'YYYY-MM-DD'
  period_week       TEXT NOT NULL,             -- 'YYYY-Www'
  period_month      TEXT NOT NULL,             -- 'YYYY-MM'

  -- WHERE
  brand             TEXT NOT NULL,             -- 'HE' | 'NCH' | 'HQ'
  outlet            TEXT,                      -- future multi-outlet key
  company_id        INTEGER NOT NULL,

  -- WHAT
  category_id       INTEGER NOT NULL,          -- canonical 1..15 (spend.js CATEGORIES)
  category_label    TEXT,
  sub_kind          TEXT,                      -- free-form detail key ('BESCOM','Zomato-ads',...)
  product_id        INTEGER,
  product_name      TEXT,
  line_qty          REAL,
  line_uom          TEXT,

  -- WHO from
  vendor_id         INTEGER,
  vendor_name       TEXT,
  vendor_tags       TEXT,                      -- JSON array

  -- HOW MUCH
  amount_total      REAL NOT NULL,             -- gross, tax-inclusive
  amount_untaxed    REAL,
  tax_amount        REAL,
  currency          TEXT DEFAULT 'INR',

  -- HOW PAID
  payment_mode      TEXT,                      -- 'cash'|'upi'|'bank'|'credit'|'company_account'
  payment_status    TEXT,                      -- 'draft'|'approved'|'posted'|'paid'|'partial'|'cancel'
  payment_ref       TEXT,

  -- WHO by
  source_ui         TEXT NOT NULL,             -- '/ops/purchase/'|'/ops/expense/'|'v2-nch'|'v2-he'|'odoo-direct'
  recorded_by_pin   TEXT,
  recorded_by_name  TEXT,
  recorded_by_role  TEXT,                      -- 'admin'|'cfo'|'asstmgr'|'purchase'|'gm'|'cashier'|'unknown'

  -- PROOF
  attachment_id     INTEGER,
  attachment_url    TEXT,
  notes             TEXT,

  -- EXCEPTION FLAGS (computed at sync time)
  flag_no_bill         INTEGER DEFAULT 0,
  flag_off_hours       INTEGER DEFAULT 0,
  flag_above_avg       INTEGER DEFAULT 0,
  flag_dup_candidate   INTEGER DEFAULT 0,
  flag_backdated       INTEGER DEFAULT 0,

  last_synced_at    TEXT NOT NULL,
  odoo_checksum     TEXT                       -- hash of mutable fields
);

CREATE INDEX idx_spend_period_day   ON fact_spend(period_day);
CREATE INDEX idx_spend_brand_day    ON fact_spend(brand, period_day);
CREATE INDEX idx_spend_cat_day      ON fact_spend(category_id, period_day);
CREATE INDEX idx_spend_vendor       ON fact_spend(vendor_id);
CREATE INDEX idx_spend_recorded_by  ON fact_spend(recorded_by_pin);
CREATE INDEX idx_spend_source_ui    ON fact_spend(source_ui);
CREATE INDEX idx_spend_payment_mode ON fact_spend(payment_mode);
CREATE INDEX idx_spend_status       ON fact_spend(payment_status);
CREATE INDEX idx_spend_flags        ON fact_spend(flag_no_bill, flag_above_avg, flag_dup_candidate);
CREATE INDEX idx_spend_odoo_ref     ON fact_spend(odoo_instance, odoo_model, odoo_id);

-- ── dim_vendor: tagged vendor registry ─────────────────────
DROP TABLE IF EXISTS dim_vendor;
CREATE TABLE dim_vendor (
  id              INTEGER PRIMARY KEY,         -- odoo.hnhotels.in res.partner id
  odoo_instance   TEXT NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  tags            TEXT,                        -- JSON: ["veg","daily","fresh"]
  payment_terms   TEXT,                        -- 'cash'|'net15'|'net30'|...
  x_purchase_scope TEXT,                       -- 'HE'|'NCH'|'HQ'|'shared'
  active          INTEGER DEFAULT 1,
  last_synced_at  TEXT NOT NULL
);

CREATE INDEX idx_dim_vendor_tags  ON dim_vendor(tags);
CREATE INDEX idx_dim_vendor_scope ON dim_vendor(x_purchase_scope);

-- ── dim_category: canonical 15-category taxonomy + budgets ─
DROP TABLE IF EXISTS dim_category;
CREATE TABLE dim_category (
  id              INTEGER PRIMARY KEY,         -- 1..15
  label           TEXT NOT NULL,
  emoji           TEXT,
  backend         TEXT,                        -- 'hr.expense'|'purchase.order'|'account.move'
  parent_name     TEXT,                        -- Odoo L1 category name
  classification  TEXT,                        -- 'variable'|'fixed'|'one-time'
  budget_he_monthly  REAL,                     -- target budgets (editable in UI later)
  budget_nch_monthly REAL,
  budget_hq_monthly  REAL
);

-- Seed the 15 categories from spend.js (keep in sync when that file changes)
INSERT INTO dim_category (id, label, emoji, backend, parent_name, classification) VALUES
  (1,  'Raw Material Purchase', '🥩', 'hr.expense',     '01 · Raw Materials',          'variable'),
  (2,  'Capex / Equipment',     '🏗️', 'hr.expense',     '14 · One-Time Capex',         'one-time'),
  (3,  'Salary Payment',        '💼', 'hr.expense',     '02 · Salaries',               'fixed'),
  (4,  'Salary Advance',        '💰', 'hr.expense',     '02 · Salaries',               'fixed'),
  (5,  'Rent',                  '🏠', 'hr.expense',     '03 · Rent',                   'fixed'),
  (6,  'Utility Bill',          '💡', 'hr.expense',     '04 · Utilities',              'variable'),
  (7,  'Police / Hafta',        '🚓', 'hr.expense',     '05 · Police & Compliance',    'fixed'),
  (8,  'Petty / Operations',    '🧹', 'hr.expense',     '06 · Operations (Petty)',     'variable'),
  (9,  'Maintenance / Repair',  '🔧', 'hr.expense',     '07 · Maintenance & Repairs',  'variable'),
  (10, 'Marketing / Ads',       '📢', 'hr.expense',     '08 · Marketing & Promotion',  'variable'),
  (11, 'Tech / SaaS / Bank',    '💻', 'hr.expense',     '09 · Technology',             'fixed'),
  (12, 'Owner Drawings',        '👤', 'hr.expense',     '10 · Owner Drawings',         'one-time'),
  (13, 'Misc / Other',          '🗂️', 'hr.expense',     '11 · Miscellaneous',          'variable'),
  (14, 'Vendor Bill (direct)',  '📄', 'account.move',   'Vendor Bills',                'variable'),
  (15, 'Vendor Bill (from PO)', '📑', 'account.move',   'Vendor Bills',                'variable');

-- ── dim_user: PIN → role / Odoo uid mapping (from spend.js USERS) ─
DROP TABLE IF EXISTS dim_user;
CREATE TABLE dim_user (
  pin            TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,
  brands         TEXT NOT NULL,                -- JSON: ["HE","NCH","HQ"]
  cats_allowed   TEXT,                         -- 'all' or JSON array
  odoo_uid       INTEGER,
  active         INTEGER DEFAULT 1
);

INSERT INTO dim_user (pin, name, role, brands, cats_allowed, odoo_uid) VALUES
  ('0305', 'Nihaf',    'admin',    '["HE","NCH","HQ"]', 'all',          2),
  ('5882', 'Nihaf',    'admin',    '["HE","NCH","HQ"]', 'all',          2),
  ('3754', 'Naveen',   'cfo',      '["HE","NCH","HQ"]', 'all',          5),
  ('6045', 'Faheem',   'asstmgr',  '["HE","NCH","HQ"]', 'all',          9),
  ('3678', 'Faheem',   'asstmgr',  '["HE","NCH","HQ"]', 'all',          9),
  ('2026', 'Zoya',     'purchase', '["HE","NCH","HQ"]', '[1,15]',       6),
  ('8316', 'Zoya',     'purchase', '["HE","NCH","HQ"]', '[1,15]',       6),
  ('8523', 'Basheer',  'gm',       '["HE","NCH","HQ"]', 'all',          7),
  ('6890', 'Tanveer',  'gm',       '["HE","NCH","HQ"]', 'all',          8),
  ('3697', 'Yashwant', 'gm',       '["HE","NCH","HQ"]', 'all',          10),
  ('15',   'Noor',     'cashier',  '["HE"]',            '[2,3,4,5,6,7,8,9,10,11,12,13,14]', 11),
  ('14',   'Kesmat',   'cashier',  '["NCH"]',           '[2,3,4,5,6,7,8,9,10,11,12,13,14]', 13),
  ('43',   'Nafees',   'cashier',  '["NCH"]',           '[2,3,4,5,6,7,8,9,10,11,12,13,14]', 14);

-- ── sync_cursor: per-source high-water mark for delta pulls ─
DROP TABLE IF EXISTS sync_cursor;
CREATE TABLE sync_cursor (
  source_key     TEXT PRIMARY KEY,             -- '{instance}:{model}'
  last_write_date TEXT,                        -- Odoo UTC 'YYYY-MM-DD HH:MM:SS' — max seen
  last_run_at    TEXT,
  last_run_rows  INTEGER,
  last_run_error TEXT
);

-- ── saved_view: per-user dashboard presets ─────────────────
DROP TABLE IF EXISTS saved_view;
CREATE TABLE saved_view (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_pin      TEXT NOT NULL,
  name           TEXT NOT NULL,
  canvas         TEXT NOT NULL,                -- 'owner'|'operator'|'recon'
  filters_json   TEXT NOT NULL,
  split_by       TEXT,
  created_at     TEXT NOT NULL,
  last_used_at   TEXT,
  is_pinned      INTEGER DEFAULT 0
);

CREATE INDEX idx_saved_view_owner ON saved_view(owner_pin, canvas);
