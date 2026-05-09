-- Reseed influencer_slots to 5 windows/day × 22 days (May 10–31, 2026) = 110 slots.
--
-- Window strategy aligned with HE's new 2 PM – 3 AM operating window:
--   AFTERNOON  · 4–5:30 PM  · post-lunch quiet · best for content-shoot creators
--   GOLDEN     · 6–7:30 PM  · golden-hour daylight + early dinner
--   PRIME      · 8–9:30 PM  · peak dinner traffic + livelier ambience
--   LATE       · 10–11:30 PM · late dinner + evening crowd
--   MIDNIGHT   · 12–1:30 AM · signature late-night Dakhni window — HE's unique angle
--
-- Capacity = 1 per window (one creator group at a time per window) — feels exclusive,
-- forces creators to book early, signals scarcity. 5 bookings/day target.

-- Drop existing slots (only PENDING bookings exist; no real customer reservations yet)
DELETE FROM influencer_bookings WHERE status = 'pending';
DELETE FROM influencer_slots;

-- Date range generator: 22 days starting May 10
WITH RECURSIVE dates(d) AS (
  SELECT '2026-05-10'
  UNION ALL
  SELECT date(d, '+1 day') FROM dates WHERE d < '2026-05-31'
),
windows(code, label, capacity) AS (
  SELECT 'AFTERNOON', '4:00–5:30 PM', 1 UNION ALL
  SELECT 'GOLDEN',    '6:00–7:30 PM', 1 UNION ALL
  SELECT 'PRIME',     '8:00–9:30 PM', 1 UNION ALL
  SELECT 'LATE',      '10:00–11:30 PM', 1 UNION ALL
  SELECT 'MIDNIGHT',  '12:00–1:30 AM', 1
)
INSERT INTO influencer_slots (slot_date, window_code, window_label, capacity, booked_count, is_blocked, notes)
SELECT d, code, label, capacity, 0, 0,
       CASE
         WHEN d = '2026-05-27' THEN 'Eid-ul-Adha · Mutton Family Pack hero day'
         ELSE NULL
       END
FROM dates, windows
ORDER BY d, CASE code
  WHEN 'AFTERNOON' THEN 1
  WHEN 'GOLDEN'    THEN 2
  WHEN 'PRIME'     THEN 3
  WHEN 'LATE'      THEN 4
  WHEN 'MIDNIGHT'  THEN 5
END;

-- Verify
SELECT
  COUNT(*) total_slots,
  COUNT(DISTINCT slot_date) days,
  MIN(slot_date) first_day,
  MAX(slot_date) last_day,
  COUNT(*) / COUNT(DISTINCT slot_date) slots_per_day
FROM influencer_slots;
