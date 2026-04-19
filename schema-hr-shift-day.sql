-- HN Hotels HR — shift-day migration (Apr 19 2026)
-- Moves attendance from rigid calendar-day bucketing to business-aware shift-day:
--   HE  shift-day starts 09:00 IST   (staff arrive 10 AM, shift runs until ~02:00)
--   NCH shift-day starts 06:00 IST   (24-hour operation, 2 shifts, night shift crosses midnight)
--   HQ  shift-day starts 00:00 IST   (office hours = calendar day)
-- A punch at 00:30 Apr 20 for HE belongs to shift-day Apr 19 (yesterday's shift still running).
-- A punch at 05:00 Apr 20 for NCH belongs to shift-day Apr 19 (yesterday's night shift still running).
--
-- Plus: missing_checkout_hours = 18 — shift-day must be closed AND open IN must be >=18h old
-- before we stamp 'ghost'. Otherwise staff still on shift show as 'present'.
--
-- Run (one-time, idempotent at the UPDATE level — but ALTER will error on re-run; harmless):
--   wrangler d1 execute DB --remote --file schema-hr-shift-day.sql

ALTER TABLE hr_shift_rules ADD COLUMN shift_day_start_hour   INTEGER DEFAULT 0;
ALTER TABLE hr_shift_rules ADD COLUMN missing_checkout_hours INTEGER DEFAULT 18;

UPDATE hr_shift_rules SET shift_day_start_hour = 9  WHERE brand_label = 'HE';
UPDATE hr_shift_rules SET shift_day_start_hour = 6  WHERE brand_label = 'NCH';
UPDATE hr_shift_rules SET shift_day_start_hour = 0  WHERE brand_label = 'HQ';

UPDATE hr_shift_rules SET missing_checkout_hours = 18 WHERE missing_checkout_hours IS NULL;

-- hr_attendance_daily.status CHECK already allows 'pending' — no DDL needed.
