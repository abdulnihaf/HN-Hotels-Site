-- 30-min alert dedup for aggregator-health-watcher.
-- platform values (examples): delivery_zomato, delivery_swiggy, delivery_endpoint,
--                              dine_zomato, dine_swiggy_dineout, dine_eazydiner, dashboard
-- Used by functions/api/aggregator-health-watcher.js.

CREATE TABLE IF NOT EXISTS health_alert_suppression (
  platform       TEXT    PRIMARY KEY,
  last_alert_at  INTEGER NOT NULL,           -- ms since epoch
  last_severity  TEXT    NOT NULL DEFAULT 'warn'  -- 'warn' | 'crit'
);
