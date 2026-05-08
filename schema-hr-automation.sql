-- HR Automation schema migration
-- Adds: absence alert tracking, ghost PIN detection, manager routing
-- Run via: wrangler d1 execute hn-hiring --file=schema-hr-automation.sql

-- ─── Absence alerts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_absence_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  pin TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  days_absent INTEGER NOT NULL,
  last_working_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending | sent_to_basheer | responded | resolved
  basheer_response TEXT,
    -- on_leave | sick | left | bio_issue | other
  basheer_response_at TEXT,
  basheer_notes TEXT,
  resolution_action TEXT,
    -- archived | kept_active | leave_recorded | bio_reset_needed
  resolved_at TEXT,
  alert_token TEXT UNIQUE,
  waba_msg_id TEXT,
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_absence_alerts_status ON hr_absence_alerts(status, employee_id);

-- ─── Ghost PINs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_ghost_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  total_punches INTEGER DEFAULT 0,
  total_days INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected',
    -- detected | sent_to_basheer | onboarding_started | onboarded | ignored | dismissed
  onboarding_token TEXT UNIQUE,
  basheer_response_at TEXT,
  -- Onboarding fields filled via mini-UI
  ob_name TEXT,
  ob_known_as TEXT,
  ob_phone TEXT,
  ob_role TEXT,
  ob_brand TEXT,
  ob_pay_type TEXT,
  ob_monthly_salary INTEGER,
  ob_daily_rate REAL,
  ob_aadhaar TEXT,
  ob_dob TEXT,
  ob_start_date TEXT,
  ob_notes TEXT,
  resolved_employee_id INTEGER,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghost_pins_pin_active ON hr_ghost_pins(pin) WHERE status NOT IN ('onboarded', 'dismissed');
CREATE INDEX IF NOT EXISTS idx_ghost_pins_status ON hr_ghost_pins(status);

-- ─── Per-employee attendance-tracking flag ───────────────────────────────────
-- Default ON; turn OFF for HQ employees who don't punch by role
ALTER TABLE hr_employees ADD COLUMN track_attendance INTEGER DEFAULT 1;

-- HQ employees don't punch
UPDATE hr_employees SET track_attendance = 0 WHERE brand_label = 'HQ';

-- ─── Managers table for WhatsApp routing ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_label TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_managers_brand ON hr_managers(brand_label, is_active);

-- Initial managers — UPDATE phones via wrangler after migration
INSERT OR IGNORE INTO hr_managers (brand_label, name, phone, role) VALUES
  ('NCH', 'Basheer', '0000000000', 'outlet_manager'),
  ('HE',  'Farooq',  '9341745726', 'outlet_manager'),
  ('HQ',  'Nihaf',   '9945470320', 'owner');
