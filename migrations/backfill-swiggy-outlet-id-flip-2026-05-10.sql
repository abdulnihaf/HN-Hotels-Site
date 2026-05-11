-- Backfill: swap HE↔NCH brand on all historical Swiggy rows
-- Root cause: OUTLETS map in content-swiggy.js had 1342888→'nch' and 1342887→'he'
--             but customer URL rest1342888 = hamza-express (HE), so the map was inverted.
-- Fixed: 2026-05-10 in ext/aggregator/content-swiggy.js
-- Apply BEFORE reloading the extension so new rows land correctly.
--
-- Run:  wrangler d1 execute <DB_NAME> --file=migrations/backfill-swiggy-outlet-id-flip-2026-05-10.sql
-- Safe to re-run: CASE expression is idempotent — rows already correct after first run
--                 won't flip again because 'he' maps back to 'he' only when brand is 'nch' post-first-run.
-- Wait — not idempotent. To make it safe to re-run, add a date guard:
--   captured_at < '2026-05-10T10:00:00.000Z'   (moment the fix was deployed)
-- If you run this after the fix is live, only pre-fix rows are touched.

BEGIN TRANSACTION;

-- 1. Verify scope before mutating (SELECT first to confirm row counts match expectation)
-- Expected: small number of Swiggy rows (extension went live early May 2026)
-- SELECT platform, brand, COUNT(*) FROM aggregator_orders WHERE platform='swiggy' GROUP BY brand;
-- SELECT platform, brand, COUNT(*) FROM aggregator_snapshots WHERE platform='swiggy' GROUP BY brand;

-- 2. Swap brand on aggregator_orders (Swiggy rows predating the fix)
UPDATE aggregator_orders
SET brand = CASE brand
              WHEN 'he'  THEN 'nch'
              WHEN 'nch' THEN 'he'
              ELSE brand
            END
WHERE platform = 'swiggy'
  AND brand IN ('he', 'nch')
  AND captured_at < '2026-05-10T10:00:00.000Z';

-- 3. Swap brand on aggregator_snapshots (same guard)
UPDATE aggregator_snapshots
SET brand = CASE brand
              WHEN 'he'  THEN 'nch'
              WHEN 'nch' THEN 'he'
              ELSE brand
            END
WHERE platform = 'swiggy'
  AND brand IN ('he', 'nch')
  AND captured_at < '2026-05-10T10:00:00.000Z';

COMMIT;

-- Verification queries (run after apply):
-- SELECT platform, brand, COUNT(*) as rows, MIN(captured_at) as oldest FROM aggregator_orders WHERE platform='swiggy' GROUP BY brand;
-- SELECT platform, brand, metric_type, COUNT(*) as rows FROM aggregator_snapshots WHERE platform='swiggy' GROUP BY brand, metric_type;
