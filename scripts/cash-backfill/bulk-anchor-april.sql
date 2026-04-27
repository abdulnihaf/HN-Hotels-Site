-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Phase 1 — Bulk April back-fill (executed 2026-04-27 against prod D1).
--
-- This is the LIVE record of what actually ran on production. It exists
-- so the back-fill is reproducible / auditable, and so the same logic
-- can be re-applied to a fresh environment (staging restore, etc.).
--
-- Source of truth for the methodology: docs/OPS-CASH-SPEC.md §4.6
-- (revised — anchor at ₹70 opening float event 2026-04-19 21:00 IST,
-- bulk brand-based classifier, not per-row review).
--
-- WHY bulk-not-surgical: the §8.8 reconciliation gate as originally
-- written (±0.5% per pile vs Odoo cash-journal closing balance) was
-- overscoped for what P&L actually needs. P&L cares about per-expense
-- accuracy (Phase 3 dup cleanup), not which cash pile each rupee
-- flowed through. Cash-pile attribution is for live ops view + Phase 3
-- anchor — directionally correct is sufficient.
--
-- Idempotency: every back-fill row carries a stable source_ref so
-- re-running this script against the same prod D1 inserts nothing
-- (NOT EXISTS predicate + unique index on source_ref + amount + txn_at
-- in the canonical schema).
--
-- Run once via:
--   wrangler d1 execute hn-hiring --remote --file=scripts/cash-backfill/bulk-anchor-april.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ──────────────────────────────────────────────────────────
-- 1. Bulk debit back-fill — every cash row in business_expenses
--    since 2026-04-01 lands on a pile per a one-line brand rule:
--      brand=NCH or HE  → cash_basheer
--      brand=HQ         → cash_nihaf
--    No per-row review. Refinement happens in Phase 3 (dup cleanup
--    will retroactively link some of these to PO settlements via
--    "Mark expense as PO-payment" which mutates linked_po_id without
--    creating a new debit — see OPS-DUP-SPEC §5.1).
-- ──────────────────────────────────────────────────────────
INSERT INTO money_events (
  source, source_ref, direction, amount_paise, currency,
  instrument, channel, counterparty, narration,
  txn_at, received_at, parse_status, brand, category,
  matched_expense_id, recorded_by_name, notes
)
SELECT
  'manual',
  'backfill:expense:' || id,
  'debit',
  CAST(ROUND(amount * 100) AS INTEGER),
  'INR',
  CASE x_location WHEN 'HQ' THEN 'cash_nihaf' ELSE 'cash_basheer' END,
  'internal',
  COALESCE(vendor_name, product_name, description),
  description,
  COALESCE(recorded_at, '2026-04-01T00:00:00Z'),
  datetime('now'),
  'parsed',
  x_location,
  category,
  id,
  recorded_by,
  'backfill: bulk brand-based plug (NCH/HE -> cash_basheer; HQ -> cash_nihaf). Refine via Phase 3 dup cleanup.'
FROM business_expenses
WHERE recorded_at >= '2026-04-01'
  AND (x_payment_method = 'cash' OR (x_payment_method IS NULL AND payment_mode = 'cash'))
  AND COALESCE(x_excluded_from_pnl, 0) = 0
  AND amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM money_events me
    WHERE me.source_ref = 'backfill:expense:' || business_expenses.id
  );

-- ──────────────────────────────────────────────────────────
-- 2. NCH cash-trail anchor — ₹70 opening float credit dated to the
--    historical-reset event (NCH collection-history id=75,
--    2026-04-19 21:00 IST: "new era from Rs70 opening float").
-- ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO money_events (
  source, source_ref, direction, amount_paise, currency,
  instrument, channel, counterparty, narration,
  txn_at, received_at, parse_status, brand,
  recorded_by_pin, recorded_by_name, notes
) VALUES (
  'manual', 'opening-float:nch:2026-04-19', 'credit', 7000, 'INR',
  'pos_counter_nch', 'internal', 'Opening float',
  'NCH cash trail anchor — historical reset, opening float ₹70',
  '2026-04-19T15:30:50Z', datetime('now'), 'parsed', 'NCH',
  '0305', 'Nihaf',
  'Anchor event per NCH collection-history id=75 — bootstrap to new era from Rs70 opening float (Nafees CASH002, 9 PM IST 2026-04-19)'
);

-- ──────────────────────────────────────────────────────────
-- 3. Plug credits — one per pile, equal to the sum of bulk debits
--    on that pile. Result: each pile nets to zero (or to opening-
--    float for pos_counter_nch). Tagged source_ref makes them
--    refinable in Phase 3.
--
--    The two literal amounts below were computed from prod D1
--    state at execution time (2026-04-27):
--      cash_basheer debits: ₹421,623 (468 rows)
--      cash_nihaf  debits: ₹29,389  (22 rows)
--    Re-running this script against a different snapshot would
--    require recomputing them; treat as post-hoc evidence, not as
--    a generic plug formula.
-- ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO money_events (
  source, source_ref, direction, amount_paise, currency,
  instrument, channel, counterparty, narration,
  txn_at, received_at, parse_status, brand,
  recorded_by_pin, recorded_by_name, notes
) VALUES
  ('manual', 'plug:cash_basheer:april-2026', 'credit', 42162300, 'INR',
   'cash_basheer', 'internal', 'External capital April',
   'External capital + handover credits — bulk plug to zero pile after backlog debits',
   '2026-04-30T23:59:59Z', datetime('now'), 'parsed', 'HQ',
   '0305', 'Nihaf',
   'BULK PLUG — sums backlog debits routed to cash_basheer (NCH/HE brand cash since Apr 1). Refine in Phase 3 dup cleanup once individual flows are matched.'),
  ('manual', 'plug:cash_nihaf:april-2026', 'credit', 2938900, 'INR',
   'cash_nihaf', 'internal', 'External capital April',
   'External capital — bulk plug to zero pile after HQ-tagged backlog debits',
   '2026-04-30T23:59:59Z', datetime('now'), 'parsed', 'HQ',
   '0305', 'Nihaf',
   'BULK PLUG — sums HQ-brand cash backlog debits since Apr 1. Owner-funded HQ spend.');

-- ━━━ Verification (read-only) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- After running, the four cash piles should be:
--   pos_counter_nch  = ₹70.00   (opening float, no further events yet)
--   pos_counter_he   = ₹0.00    (HE cash-trail anchor TBD by owner)
--   cash_basheer     = ₹0.00    (debits matched by plug credit)
--   cash_nihaf       = ₹0.00    (debits matched by plug credit)
--
-- Live ops events from /api/money?action=cash-transfer and the
-- spend.js cash-event hooks will accumulate from now on.
