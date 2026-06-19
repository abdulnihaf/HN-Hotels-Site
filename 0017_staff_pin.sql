-- 0017: Darbar-owned app login PIN for EVERY staff member (FOH + BOH).
-- This is a Darbar identity attribute, defined once at the source. It is DISTINCT
-- from hr_employees.pin (the CAMS biometric device ID). Consumers come later:
--   Takht (FOH: cashier/runner/captain) now · Anbar (BOH: receiving/inventory) later.
-- Generation + auto-assign live in hr-admin.js (assignStaffPin / employee-upsert).
ALTER TABLE hr_employees ADD COLUMN staff_pin TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_emp_staff_pin
  ON hr_employees(staff_pin) WHERE staff_pin IS NOT NULL;
