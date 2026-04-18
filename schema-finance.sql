-- HN-level finance tables. Odoo (ops.hamzahotel.com) is the master source of truth.
-- business_expenses = read-through cache of hr.expense (both HE + NCH rows, separated by company_id).
-- bank_transactions = cash-in-hand ledger (HN-wide: deposits, withdrawals, opening balance).
--
-- Run:
--   cd HN-Hotels-Site
--   wrangler d1 execute hn-hiring --remote --file=schema-finance.sql

CREATE TABLE IF NOT EXISTS business_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',   -- legacy label kept for back-compat
  payment_mode TEXT NOT NULL DEFAULT 'cash', -- legacy cash|bank (bank covers all non-cash)
  notes TEXT DEFAULT '',
  -- Odoo-mirror fields
  odoo_id INTEGER,
  company_id INTEGER,          -- 1=HE, 10=NCH
  product_id INTEGER,
  product_name TEXT,
  category_parent TEXT,        -- Odoo L1 parent category name ("03 · Rent", etc.)
  x_pool TEXT,                 -- counter|petty|formal|capex|owner_drawing
  x_payment_method TEXT,       -- cash|hdfc_bank|federal_bank|paytm_upi|razorpay|petty_pool|counter_pool
  x_location TEXT,             -- he_koramangala|nch_koramangala|hq|other
  x_excluded_from_pnl INTEGER DEFAULT 0,
  odoo_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_biz_exp_at ON business_expenses(recorded_at);
CREATE INDEX IF NOT EXISTS idx_biz_exp_odoo ON business_expenses(odoo_id);
CREATE INDEX IF NOT EXISTS idx_biz_exp_company ON business_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_biz_exp_pool ON business_expenses(x_pool);
CREATE INDEX IF NOT EXISTS idx_biz_exp_parent ON business_expenses(category_parent);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  type TEXT NOT NULL,       -- deposit|withdrawal|opening_balance
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  method TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  company_id INTEGER        -- 1=HE, 10=NCH (null = HN-level / unallocated)
);

CREATE INDEX IF NOT EXISTS idx_bank_txn_at ON bank_transactions(recorded_at);
CREATE INDEX IF NOT EXISTS idx_bank_txn_type ON bank_transactions(type);
CREATE INDEX IF NOT EXISTS idx_bank_txn_company ON bank_transactions(company_id);
