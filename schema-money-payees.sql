-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- money_payees — structured counterparty registry.
--
-- Per-bank, per-instrument beneficiary list. HDFC has its own via
-- "Transfers → View Payees"; Federal has its own via "Beneficiaries".
-- Instead of flattening into one bucket and losing the source, scope
-- each payee row to a registry_source so the same vendor can live in
-- both HDFC-4680's and Federal-4510's registries with different account
-- details (they often do — legacy accounts, one bank per relationship).
--
-- money_events rows reference a payee via matched_payee_id; the
-- dashboard joins through this to render brand, category, and
-- counterparty-centric drill-downs.
--
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=schema-money-payees.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS money_payees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Scope: which instrument's beneficiary list this came from. Same
  -- person can legitimately appear in multiple registries with different
  -- account details. Examples:
  --   'hdfc_4680'      — HDFC A/c 4680 registered payees
  --   'federal_4510'   — Federal A/c 11040100314510 registered payees
  --   'manual'         — added by ops user via dashboard
  --   'derived'        — inferred from unmatched counterparty, awaiting review
  registry_source TEXT NOT NULL DEFAULT 'manual',

  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,     -- upper-cased token set for fuzzy match

  bank TEXT,                          -- "HDFC Bank", "Federal Bank", etc.
  account_type TEXT,                  -- Savings | Current
  last4 TEXT,                         -- last 4 of payee's account number

  -- Taxonomy — fixed set, expand via ALTER if needed.
  category TEXT CHECK (category IN (
    'salary', 'vendor_food', 'vendor_packaging', 'vendor_utility',
    'vendor_other', 'owner', 'petty_cash', 'platform_commission',
    'platform_revenue', 'charges', 'interest', 'transfer_internal',
    'unknown'
  )),

  commodity TEXT,                     -- tea_powder | chicken | coal | grocery | etc.
  role TEXT,                          -- head_cook | tea_master | runner | etc. (when category=salary)

  brand TEXT CHECK (brand IN ('HE', 'NCH', 'HQ', 'mixed', 'unknown')),

  -- True if this payee IS one of Nihaf's own accounts — used to
  -- auto-classify internal transfers (so they're excluded from P&L).
  is_own_account INTEGER NOT NULL DEFAULT 0,

  notes TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (registry_source, name)
);

CREATE INDEX IF NOT EXISTS idx_mp_category   ON money_payees(category);
CREATE INDEX IF NOT EXISTS idx_mp_brand      ON money_payees(brand);
CREATE INDEX IF NOT EXISTS idx_mp_last4      ON money_payees(last4);
CREATE INDEX IF NOT EXISTS idx_mp_norm       ON money_payees(normalized_name);
CREATE INDEX IF NOT EXISTS idx_mp_is_own     ON money_payees(is_own_account);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Add payee/brand/category columns to money_events.
-- Idempotent via CREATE INDEX IF NOT EXISTS; ALTER TABLE ADD COLUMN is
-- NOT idempotent in SQLite, so the migration script checks PRAGMA first.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- NOTE: execute these ALTER statements ONCE. Re-running errors "duplicate
-- column". The D1 MCP migration used below wraps them in a pragma check.
ALTER TABLE money_events ADD COLUMN matched_payee_id INTEGER;
ALTER TABLE money_events ADD COLUMN brand TEXT;
ALTER TABLE money_events ADD COLUMN category TEXT;

CREATE INDEX IF NOT EXISTS idx_me_matched_payee ON money_events(matched_payee_id);
CREATE INDEX IF NOT EXISTS idx_me_brand         ON money_events(brand);
CREATE INDEX IF NOT EXISTS idx_me_category      ON money_events(category);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Register the Federal Bank savings account now that NetBanking access
-- is live. Replaces the old federal_ca placeholder.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DELETE FROM money_source_health WHERE source='federal' AND instrument='federal_ca';

INSERT OR IGNORE INTO money_source_health
  (source, instrument, expected_max_gap_minutes, notes)
VALUES
  ('federal', 'federal_sa_4510', 10080,
   'Abdul Khader Nihaf Savings A/c 11040100314510. NetBanking access live 2026-04-23. XLS backfill + email-alert pipeline pending.');
