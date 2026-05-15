-- High-water marks for dine-in booking/counter movement alerts.
-- Used by functions/api/aggregator-health-watcher.js.
--
-- platform_key examples:
--   dine_booking:eazydiner:he:712958:reservations_count
--   dine_booking:swiggy_dineout:he:1372737:reservations_count
--   dine_booking:zomato_dining:he:22632449:bookings_count

CREATE TABLE IF NOT EXISTS aggregator_dine_alert_state (
  platform_key       TEXT    PRIMARY KEY,
  last_metric_value  INTEGER NOT NULL,
  last_snapshot_at   TEXT,
  last_alert_at      INTEGER,
  updated_at         INTEGER NOT NULL
);
