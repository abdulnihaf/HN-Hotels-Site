-- HN Hotels — CAMS F38+ device registration
-- Source: https://camsbiometrics.com/beta/device-management/1374196020710146049
-- Live dashboard snapshot: 2026-04-17

INSERT OR REPLACE INTO hr_cams_devices
  (serial_number, device_uuid, label, brand_label, location,
   callback_url, push_user_data, restful_api, reverify_seconds, notes)
VALUES
  ('AYTH09089112',
   '1374196020710146049',
   'Hawking Plus F38+ — Koramangala',
   'HE',
   'HE Koramangala (counter)',
   'https://ops.hamzahotel.com/cams/biometric-api3.0',
   1,  -- push_user_data ON
   1,  -- restful_api ON
   30, -- reverify window (prevents multi-punch from face-detect bounce)
   'Odoo Standard Edition API service valid until 31-Jan-2027. Direction="Actual" in CAMS. Device was OFFLINE as of 17-Apr-2026 — bring online before first sync test.');

SELECT serial_number, label, brand_label, reverify_seconds, notes FROM hr_cams_devices;
