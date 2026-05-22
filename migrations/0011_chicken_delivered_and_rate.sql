-- migrations/0011_chicken_delivered_and_rate.sql
-- Add MN Broilers cost model columns:
--   delivered_kg     — raw kg MN delivered (vs purchased_kg which is yielded/usable kg from Odoo)
--   daily_rate_paise — single ₹/kg from MN's cash bill, same across all cuts on that day
--
-- Cost formula:  cost_paise = delivered_kg × daily_rate_paise
--                price_per_kg_paise (effective ₹/kg of yielded meat) = cost_paise / purchased_kg
--
-- For existing rows: purchased_kg already holds yielded kg (from Odoo).
-- New rows added via the price-entry UI capture both yielded + delivered.

ALTER TABLE chicken_daily_ledger ADD COLUMN delivered_kg REAL;
ALTER TABLE chicken_daily_ledger ADD COLUMN daily_rate_paise INTEGER;
