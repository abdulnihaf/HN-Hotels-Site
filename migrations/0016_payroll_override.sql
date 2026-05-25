-- 0016_payroll_override.sql
-- Manual final-amount override for monthly payroll settlement (Salary lane 09).
--
-- WHY: Some staff don't log attendance cleanly, so the CAMS-derived net_payable
-- can be wrong. At month-end settlement (May → 7 June) the owner needs to type a
-- final amount that WINS over the computed figure, with a reason on record. The
-- computed net_payable is preserved untouched for audit; the override sits beside
-- it. effective_net = manual_net_override IS NOT NULL ? manual_net_override : net_payable.
--
-- D1/SQLite note: ALTER TABLE ADD COLUMN has no IF NOT EXISTS — run once.

ALTER TABLE hr_payroll_snapshots ADD COLUMN manual_net_override REAL;          -- owner-typed final ₹; NULL = use computed
ALTER TABLE hr_payroll_snapshots ADD COLUMN override_reason TEXT;              -- why the computed figure was overridden
ALTER TABLE hr_payroll_snapshots ADD COLUMN override_by TEXT;                  -- who set it (owner)
ALTER TABLE hr_payroll_snapshots ADD COLUMN override_at TEXT;                  -- when it was set
