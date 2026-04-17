-- HN Hotels — HR + Biometric Attendance Schema
-- Database: hn-hiring (D1)
-- Run: wrangler d1 execute DB --remote --file schema-hr.sql
--
-- Design principles (mirror Nihaf's Apps Script conventions):
--   * pin (string) is the canonical biometric ID. Maps to hr.employee.pin in Odoo.
--   * company_id: '1' = HN Hotels Pvt Ltd (HE), '10' = Nawabi Chai House (NCH), NULL = shared (HQ/office).
--   * Archive via is_active=0, never delete.
--   * Lookup tables for company / department / job cache Odoo IDs, avoiding API thrash.
--   * attendance_daily is derived from Odoo hr.attendance — one row per (pin, date).
--   * Deductions are computed from attendance_daily against shift_rules.

-- ============================================================
-- EMPLOYEES — canonical roster (source of truth for D1)
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin TEXT UNIQUE,                         -- biometric ID string; NULL until enrolled
  row_no INTEGER,                          -- original # in salary register (traceability)
  name TEXT NOT NULL,                      -- full legal name (matches Odoo hr.employee.name)
  known_as TEXT,                           -- informal short name
  company_id TEXT,                         -- '1', '10', NULL (shared)
  brand_label TEXT NOT NULL CHECK (brand_label IN ('HE', 'NCH', 'HQ', 'TBD')),
  department_name TEXT,                    -- resolved → hr_department_map.odoo_id
  job_name TEXT,                           -- resolved → hr_job_map.odoo_id
  pay_type TEXT CHECK (pay_type IN ('Contract','Monthly','TBD')),
  monthly_salary REAL NOT NULL DEFAULT 0,  -- ₹ per month (base pay)
  daily_rate REAL,                         -- derived or contract-specified
  start_date TEXT,                         -- ISO yyyy-mm-dd
  phone TEXT,
  aadhaar_last4 TEXT,
  aadhaar_full TEXT,                       -- → hr.employee.identification_id (stored encrypted at rest ideally)
  dob TEXT,
  gender TEXT CHECK (gender IN ('male','female','other')),
  address TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  notes TEXT,
  -- Odoo sync
  odoo_employee_id INTEGER,                -- hr.employee id
  odoo_contract_id INTEGER,                -- hr.contract id (so daily deductions can reference wage/schedule)
  synced_at TEXT,
  sync_status TEXT DEFAULT 'Pending' CHECK (sync_status IN ('Pending','Synced','Error','Manual','Archived')),
  sync_error TEXT,
  -- Biometric enrollment
  bio_enrolled INTEGER DEFAULT 0,          -- 1 when we've confirmed device has the user
  bio_enrolled_at TEXT,
  -- Lifecycle
  is_active INTEGER DEFAULT 1,
  archived_at TEXT,
  archive_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_emp_pin       ON hr_employees(pin);
CREATE INDEX IF NOT EXISTS idx_hr_emp_company   ON hr_employees(company_id);
CREATE INDEX IF NOT EXISTS idx_hr_emp_brand     ON hr_employees(brand_label);
CREATE INDEX IF NOT EXISTS idx_hr_emp_active    ON hr_employees(is_active);
CREATE INDEX IF NOT EXISTS idx_hr_emp_odoo      ON hr_employees(odoo_employee_id);

-- ============================================================
-- LOOKUP MAPS — cache Odoo IDs (mirror Apps Script OdooMap pattern)
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_company_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_label TEXT UNIQUE NOT NULL CHECK (brand_label IN ('HE','NCH','HQ')),
  odoo_company_id INTEGER NOT NULL,
  odoo_name TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hr_department_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- "HE - Kitchen"
  company_id TEXT,                         -- '1', '10', NULL
  odoo_department_id INTEGER NOT NULL,
  odoo_parent_id INTEGER,
  is_assignable INTEGER DEFAULT 1,         -- parent-only depts = 0
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, company_id)
);

CREATE TABLE IF NOT EXISTS hr_job_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- "Captain", "Tandoor Chef"
  company_id TEXT,                         -- '1', '10', NULL = shared
  odoo_job_id INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, company_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_jobmap_name ON hr_job_map(name);
CREATE INDEX IF NOT EXISTS idx_hr_deptmap_name ON hr_department_map(name);

-- ============================================================
-- SHIFT RULES — per brand/pay_type deduction policy
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_shift_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_label TEXT NOT NULL CHECK (brand_label IN ('HE','NCH','HQ')),
  pay_type TEXT NOT NULL CHECK (pay_type IN ('Contract','Monthly')),
  min_daily_hours REAL NOT NULL DEFAULT 6, -- below this = half-day
  expected_daily_hours REAL NOT NULL DEFAULT 8,
  full_day_threshold REAL NOT NULL DEFAULT 6,  -- >= threshold = full day
  half_day_threshold REAL NOT NULL DEFAULT 2,  -- < this = absent (e.g., 2h = ghost punch)
  allow_single_punch INTEGER DEFAULT 0,    -- 0 = single punch flagged; 1 = ok
  week_off TEXT DEFAULT 'sunday',          -- "sunday" | "monday" | "none"
  applies_to_office INTEGER DEFAULT 0,     -- 1 = office staff (no deduction)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(brand_label, pay_type)
);

-- ============================================================
-- DAILY ATTENDANCE — derived from Odoo hr.attendance pulls
-- One row per (pin, date). Recomputed nightly.
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_attendance_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin TEXT NOT NULL,
  employee_id INTEGER NOT NULL,            -- FK hr_employees.id (D1)
  odoo_employee_id INTEGER,                -- denormalised for fast join
  date TEXT NOT NULL,                      -- yyyy-mm-dd (IST)
  first_in_at TEXT,                        -- ISO timestamp
  last_out_at TEXT,
  punch_count INTEGER DEFAULT 0,           -- total punches across the day
  total_hours REAL DEFAULT 0,              -- sum of paired IN→OUT durations
  status TEXT NOT NULL CHECK (status IN ('absent','present','half','ghost','week_off','leave','pending')),
  is_single_punch INTEGER DEFAULT 0,       -- 1 = only IN, no OUT (or vice-versa)
  expected_hours REAL,                     -- from shift_rules
  deducted_amount REAL DEFAULT 0,          -- ₹ deducted this day (0 for week_off/leave/full)
  deduction_reason TEXT,
  raw_punches_json TEXT,                   -- array of { time, type, source } for audit
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pin, date),
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_att_pin_date ON hr_attendance_daily(pin, date);
CREATE INDEX IF NOT EXISTS idx_hr_att_date     ON hr_attendance_daily(date);
CREATE INDEX IF NOT EXISTS idx_hr_att_status   ON hr_attendance_daily(status);

-- ============================================================
-- LEAVES — approved/pending leave requests (manual entry initially)
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  pin TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  leave_type TEXT CHECK (leave_type IN ('paid','unpaid','sick','casual','compoff')),
  approved INTEGER DEFAULT 0,
  approved_by TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_leaves_emp_date ON hr_leaves(employee_id, start_date);

-- ============================================================
-- SYNC LOG — audit trail (mirror rm_sync_log pattern)
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                    -- create_employee, update_employee, archive_employee, sync_attendance, enroll_bio, …
  target_model TEXT,                       -- hr.employee, hr.contract, hr.attendance, cams.device
  target_id INTEGER,                       -- Odoo id or D1 id
  reference TEXT,                          -- employee name / pin
  details TEXT,                            -- JSON
  status TEXT DEFAULT 'ok' CHECK (status IN ('ok','error','partial')),
  error TEXT,
  synced_by TEXT,                          -- PIN user (Nihaf / Zoya / Faheem)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_sync_log_action ON hr_sync_log(action);
CREATE INDEX IF NOT EXISTS idx_hr_sync_log_date   ON hr_sync_log(created_at);

-- ============================================================
-- CAMS DEVICE REGISTRY — track each CAMS F38+ we operate
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_cams_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_number TEXT UNIQUE NOT NULL,      -- AYTH09089112
  device_uuid TEXT,                        -- 1374196020710146049 (CAMS dashboard)
  label TEXT,
  brand_label TEXT CHECK (brand_label IN ('HE','NCH','HQ')),
  location TEXT,                           -- outlet name
  callback_url TEXT,                       -- configured endpoint (for reference)
  auth_token_hash TEXT,                    -- sha256 of current AuthToken (for rotation tracking)
  push_user_data INTEGER DEFAULT 1,
  restful_api INTEGER DEFAULT 1,
  reverify_seconds INTEGER DEFAULT 30,     -- duplicate-punch guard
  last_online_at TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- RAW PUNCH LEDGER — optional secondary audit mirror
-- If we later add a shadow webhook, this stores exactly what CAMS pushed.
-- For now (CAMS → Odoo direct), this table is filled via read-back from Odoo hr.attendance.
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_cams_punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_serial TEXT NOT NULL,
  pin TEXT NOT NULL,
  user_name TEXT,                          -- as reported by CAMS
  punch_time TEXT NOT NULL,                -- ISO (IST)
  punch_type TEXT,                         -- CheckIn/CheckOut/BreakIn/BreakOut/…
  input_type TEXT,                         -- Fingerprint/Face/Palm/Card/Password
  odoo_attendance_id INTEGER,              -- Odoo hr.attendance id when linked
  source TEXT DEFAULT 'odoo' CHECK (source IN ('odoo','webhook','manual')),
  raw_json TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_serial, pin, punch_time)
);

CREATE INDEX IF NOT EXISTS idx_hr_punches_pin_time ON hr_cams_punches(pin, punch_time);
CREATE INDEX IF NOT EXISTS idx_hr_punches_date     ON hr_cams_punches(substr(punch_time,1,10));

-- ============================================================
-- SEED — company map + default shift rules
-- ============================================================
INSERT OR IGNORE INTO hr_company_map (brand_label, odoo_company_id, odoo_name) VALUES
  ('HE',   1,  'HN Hotels Pvt Ltd'),
  ('NCH',  10, 'Nawabi Chai House');
-- HQ has no company_id in Odoo (shared), so no row here.

INSERT OR IGNORE INTO hr_shift_rules
  (brand_label, pay_type, min_daily_hours, expected_daily_hours, full_day_threshold, half_day_threshold, allow_single_punch, week_off, applies_to_office)
VALUES
  ('HE',  'Contract', 10, 12, 8, 2, 0, 'none',   0),
  ('HE',  'Monthly',   6,  8, 6, 2, 0, 'none',   0),
  ('NCH', 'Contract', 10, 12, 8, 2, 0, 'none',   0),
  ('NCH', 'Monthly',   6,  8, 6, 2, 0, 'none',   0),
  ('HQ',  'Monthly',   0,  8, 0, 0, 1, 'sunday', 1);
