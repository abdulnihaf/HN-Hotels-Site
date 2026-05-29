-- ════════════════════════════════════════════════════════════════════════
-- Darbar — additive schema for the sealed-circle write-backs (May 2026)
-- Apply: wrangler d1 execute hn-hiring --remote --file=schema-darbar.sql
-- All additive: a new table + nullable columns. No rebuilds, no data loss.
-- ════════════════════════════════════════════════════════════════════════

-- Exit / full-and-final ledger. mark-exit writes here AND sets
-- hr_employees.is_active=0 (the roster self-corrects from the Today inbox).
CREATE TABLE IF NOT EXISTS hr_exits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id       INTEGER NOT NULL,
  pin               TEXT,
  name              TEXT,
  brand_label       TEXT,
  exit_kind         TEXT NOT NULL DEFAULT 'departed_silent',  -- departed_silent | resigned | misconduct | retrenched | other
  last_working_day  TEXT,             -- best-known last punch date
  days_silent       INTEGER,
  reason            TEXT,
  fnf_status        TEXT NOT NULL DEFAULT 'pending',           -- pending | drafted | settled
  fnf_amount        REAL,             -- owner-entered F&F (rupees)
  fnf_note          TEXT,
  recorded_by       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_exits_emp ON hr_exits(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_exits_status ON hr_exits(fnf_status);

-- Attendance: flag an owner-imputed checkout (manual fix-punch on the board).
ALTER TABLE hr_attendance_daily ADD COLUMN imputed_out INTEGER NOT NULL DEFAULT 0;

-- Payroll: owner manual salary over-write (Nihaf requirement #3/#4) — the
-- formula's net is never silently replaced; the override is recorded alongside.
ALTER TABLE hr_payroll_snapshots ADD COLUMN manual_override_amount REAL;
ALTER TABLE hr_payroll_snapshots ADD COLUMN manual_override_note TEXT;
ALTER TABLE hr_payroll_snapshots ADD COLUMN manual_override_by TEXT;
ALTER TABLE hr_payroll_snapshots ADD COLUMN manual_override_at TEXT;
