-- HR salary advances + April back-fill closing
-- Run via: npx wrangler d1 execute hn-hiring --file=schema-hr-advances.sql
--
-- Design notes:
--   1. ONE ledger table for all salary advances (cash, UPI, bank). Works for the
--      April manual back-fill and every month going forward — same flow.
--      Owner just records each advance as it's paid; monthly payable is computed
--      live from monthly_salary - days-not-worked deduction - SUM(advances in month).
--   2. April-specific exception: CAMS only began registering attendance mid-April,
--      so we cannot derive Apr 1 → CAMS-launch leave count. Capture it as ONE
--      number on the employee row. From May onwards CAMS is the source of truth
--      and these columns stay NULL.

-- ─── Advances ledger ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  advance_date TEXT NOT NULL,                 -- YYYY-MM-DD (date the cash actually left)
  amount REAL NOT NULL,                       -- ₹ rupees (matches monthly_salary unit)
  paid_via TEXT NOT NULL DEFAULT 'cash',      -- 'cash' | 'upi' | 'bank' | 'razorpay' | 'paytm' | 'other'
  reference TEXT,                             -- UTR / UPI ref / receipt number
  reason TEXT,                                -- 'medical' | 'family' | 'rent' | 'festival' | 'other' | free text
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',      -- 'manual' (owner entry) | 'april_backfill' | 'odoo_import' | 'razorpay_webhook'
  recorded_by TEXT,                           -- who entered it
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recovered INTEGER NOT NULL DEFAULT 0,       -- 1 once recovered against payroll (set by compute-payable when applied)
  recovered_in_month TEXT,                    -- 'YYYY-MM' the advance was netted off
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_advances_employee ON hr_advances(employee_id, advance_date);
CREATE INDEX IF NOT EXISTS idx_hr_advances_month    ON hr_advances(advance_date);
CREATE INDEX IF NOT EXISTS idx_hr_advances_unrecovered ON hr_advances(employee_id, recovered) WHERE recovered = 0;

-- ─── April pre-CAMS leaves (one-time per-employee field) ────────────────────
ALTER TABLE hr_employees ADD COLUMN april_unpaid_leave_days REAL;     -- Apr 1 → CAMS launch (~Apr 18); ½-day allowed
ALTER TABLE hr_employees ADD COLUMN april_paid_leave_days REAL;       -- (rare; tracked for completeness)
ALTER TABLE hr_employees ADD COLUMN april_closing_notes TEXT;
ALTER TABLE hr_employees ADD COLUMN april_closing_recorded_at TEXT;

-- ─── Snapshot of April payable (so the computation is auditable + freezable) ─
-- Once the owner reviews and approves April payable for an employee, freeze it
-- here so a later edit to advances/leaves doesn't silently change history.
CREATE TABLE IF NOT EXISTS hr_payroll_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  pay_period TEXT NOT NULL,                   -- 'YYYY-MM'
  base_pay REAL NOT NULL,                     -- monthly_salary or days_worked × daily_rate
  pay_type TEXT NOT NULL,                     -- 'Monthly' | 'Contract'
  days_worked REAL,                           -- from CAMS (post-launch) + assumed-present pre-CAMS
  days_in_month INTEGER,                      -- 30 / 31 / 28
  unpaid_leave_days REAL DEFAULT 0,           -- LOP days (CAMS-derived for May+, manual for April)
  unpaid_leave_deduction REAL DEFAULT 0,
  advances_total REAL DEFAULT 0,              -- sum of unrecovered advances applied this period
  advances_count INTEGER DEFAULT 0,
  net_payable REAL NOT NULL,                  -- base_pay - unpaid_leave_deduction - advances_total
  status TEXT NOT NULL DEFAULT 'computed',    -- 'computed' | 'approved' | 'paid'
  paid_at TEXT,
  payment_reference TEXT,                     -- UTR for the final payout
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  computation_json TEXT,                      -- full breakdown for audit
  UNIQUE(employee_id, pay_period),
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_snap_period ON hr_payroll_snapshots(pay_period, status);
