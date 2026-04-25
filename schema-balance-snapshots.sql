-- HDFC daily-balance snapshots — replaces daily XLS upload as the audit
-- anchor. Each row is one "available balance is Rs. X as of DD-MMM-YY"
-- email parsed by the gmail-poller. Drift check (in worker) compares
-- snapshot vs running balance from money_events.
--
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=schema-balance-snapshots.sql

CREATE TABLE IF NOT EXISTS money_balance_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,        -- 'YYYY-MM-DD' as parsed from email's "as of" clause
  balance_paise INTEGER NOT NULL,
  received_at TEXT NOT NULL,          -- when our worker processed the email
  source_email_id TEXT,               -- Gmail message id; null for manual entries
  raw_subject TEXT,
  raw_body TEXT,
  notes TEXT DEFAULT ''
);

-- One snapshot per instrument per day. If multiple balance emails arrive
-- the same day (HDFC sometimes sends 2-3), the LATEST one wins via
-- INSERT OR REPLACE in the worker — same-day balances are usually
-- identical anyway since they reflect EOD.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_balance_snapshot_per_day
  ON money_balance_snapshot(instrument, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_snapshot_date
  ON money_balance_snapshot(snapshot_date);

-- Drift log — each row is one drift check. Lets the dashboard surface
-- "balance has been drifting for N days, total ₹X unaccounted".
CREATE TABLE IF NOT EXISTS money_balance_drift (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  snapshot_paise INTEGER NOT NULL,    -- bank's claimed balance
  computed_paise INTEGER NOT NULL,    -- D1's running-balance for that date
  drift_paise INTEGER NOT NULL,       -- snapshot - computed; positive = D1 is missing credits
  checked_at TEXT NOT NULL,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_drift_date     ON money_balance_drift(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_drift_checked  ON money_balance_drift(checked_at);
