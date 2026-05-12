-- Backfill: correct inverted Swiggy brand labels in aggregator_snapshots.
--
-- Root cause: ext/aggregator/content-swiggy.js had `const OUTLETS = { '1342888':
-- 'nch', '1342887': 'he' }` — INVERTED relative to reality (per HE listing
-- audit 2026-05-10). True mapping is 1342888=HE, 1342887=NCH. The extension
-- on hn-winpc deployed the corrected mapping at 2026-05-10T02:46:20Z; this
-- script backfills the prior rows.
--
-- Scope: only rows where `brand` disagrees with the true outlet identity OR
-- where brand was set via the URL→OUTLETS path on platform-wide snapshots.
-- 4547 already-consistent rows (brand set from metric_type prefix) left alone.
--
-- Expected: ~772 rows updated total across two statements. Zero rows touched
-- in aggregator_orders (sampled — outlet_name from Swiggy API matches brand).
-- Run via: npx wrangler d1 execute hn-hiring --remote --file <this-file>
--
-- BRAND–METRIC_TYPE DRIFT NOTE: post-backfill, ~766 rows will have `brand` and
-- `metric_type` semantically disagree (e.g., brand='he' with metric_type='finance_nch_cron').
-- This is COSMETIC ONLY — no worker code filters by metric_type's brand suffix
-- (verified: all metric_type LIKE patterns are `finance_%`, `api_reviews%`, etc.,
-- orthogonal to brand). Brand splitting in every dashboard/API uses the `brand`
-- column. The metric_type drift is a stale label from the inverted-OUTLETS era
-- and is intentionally not renamed here. If future code adds a brand-suffix
-- filter on metric_type, run a follow-up swap-CASE on metric_type with the
-- same WHERE clauses as below.

-- A) Outlet-specific rows where brand disagrees with true outlet identity (343 expected)
UPDATE aggregator_snapshots
SET brand = CASE
  WHEN outlet_id='1342888' AND brand='nch' THEN 'he'
  WHEN outlet_id='1342887' AND brand='he'  THEN 'nch'
  ELSE brand
END
WHERE platform='swiggy'
  AND captured_at < '2026-05-10T02:46:20Z'
  AND ((outlet_id='1342888' AND brand='nch') OR (outlet_id='1342887' AND brand='he'));

-- B) outlet_id='all' rows where brand was set via URL→OUTLETS path (429 expected)
UPDATE aggregator_snapshots
SET brand = CASE brand WHEN 'he' THEN 'nch' WHEN 'nch' THEN 'he' ELSE brand END
WHERE platform='swiggy'
  AND captured_at < '2026-05-10T02:46:20Z'
  AND outlet_id='all'
  AND brand IN ('he','nch');
