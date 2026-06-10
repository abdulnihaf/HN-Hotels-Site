-- hr_cams_user_events — device-origin user lifecycle events (Push User Data)
-- Written by functions/api/cams-ingest.js when CAMS forwards UserUpdated /
-- UserDeleted events (on-device enrollment, edit, delete, and the re-announce
-- burst after a device reconnect). Carries name + pin + face photo straight
-- from the F38+ — the device-first onboarding signal for Darbar ghost cards.
-- The ingest function also auto-creates this table on first event (CREATE IF
-- NOT EXISTS) so no migration ordering dependency exists.

CREATE TABLE IF NOT EXISTS hr_cams_user_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_serial TEXT NOT NULL,
  event_type TEXT NOT NULL,           -- UserUpdated | UserDeleted
  pin TEXT NOT NULL,                  -- device UserID (joins hr_employees.pin)
  user_name TEXT,                     -- FirstName + LastName as enrolled on device
  user_type TEXT,                     -- e.g. 'User'
  operation_time TEXT,                -- when the operation happened on-device (IST, GMT suffix stripped)
  photo_base64 TEXT,                  -- enrolled face photo (JPEG base64) when present
  received_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_serial, event_type, pin, operation_time)
);
