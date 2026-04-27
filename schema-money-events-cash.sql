-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Phase 1 — Cash trail migration. Spec: docs/OPS-CASH-SPEC.md.
--
-- Extends money_events with cash-trail attribution + transfer linkage,
-- and registers cash_basheer / cash_nihaf as first-class instruments
-- alongside the existing pos_counter_he / pos_counter_nch counters.
--
-- Strict enum on `instrument` is enforced at the API write layer
-- (functions/api/money.js, spend.js) — SQLite cannot ADD CHECK to an
-- existing table, so the application is the gatekeeper. New deployments
-- should treat the comment block in schema-money-events.sql as
-- authoritative for the allowed instrument set.
--
-- Run once on each environment:
--   wrangler d1 execute hn-hiring --remote --file=schema-money-events-cash.sql
--
-- ALTER TABLE ADD COLUMN is NOT idempotent in SQLite. Each ADD COLUMN
-- raises "duplicate column" on re-run; that's acceptable here — the
-- intended workflow is a one-shot migration. Wrap each ALTER in a
-- per-statement run if your runner errors out the whole batch.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Two-leg cash transfer linkage. Both legs share a transfer_group_id.
ALTER TABLE money_events ADD COLUMN transfer_group_id TEXT;

-- 2. PO attribution. NULL for non-PO events. Phase 2 settlement console
--    relies on these to show "Paid (cash·₹X·by Naveen·27-Apr)" badges
--    on /ops/purchase/ "My POs". (matched_vendor_bill_id already exists
--    for the bill side; this adds the PO side.)
ALTER TABLE money_events ADD COLUMN linked_po_id INTEGER;
ALTER TABLE money_events ADD COLUMN linked_po_name TEXT;

-- 3. Actor attribution. Existing `business_expenses.recorded_by` lives on
--    the source row, not the cash-trail row. Denormalized here because
--    money_events for outlet expenses don't FK back to a single source
--    table — counter expenses come via spend.js, PO settles via the
--    settle-po path; both populate these directly.
ALTER TABLE money_events ADD COLUMN recorded_by_pin TEXT;
ALTER TABLE money_events ADD COLUMN recorded_by_name TEXT;

-- 4. Phase 2 prep — idempotency key for the upcoming /api/money?action=settle
--    cross-system (D1 + Odoo) write contract. Adding the column now so the
--    cash-trail rows landing in Phase 1 are forward-compatible.
ALTER TABLE money_events ADD COLUMN idem_key TEXT;

-- 5. Phase 3 prep — explicit "this is a separate purchase, not a dup" flag
--    set when a cashier dismisses the §6.1 dup banner. Forensic engine
--    skips rows where verified_separate=1.
ALTER TABLE money_events ADD COLUMN verified_separate INTEGER NOT NULL DEFAULT 0;

-- ━━━ Indexes for the cash-trail read path ━━━
CREATE INDEX IF NOT EXISTS idx_me_transfer_group ON money_events(transfer_group_id);
CREATE INDEX IF NOT EXISTS idx_me_linked_po      ON money_events(linked_po_id);
CREATE INDEX IF NOT EXISTS idx_me_recorded_pin   ON money_events(recorded_by_pin);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_me_idem_key ON money_events(idem_key) WHERE idem_key IS NOT NULL;

-- ━━━ Source health rows for the new cash instruments ━━━
-- Cash piles can sit idle longer than bank accounts, so the watchdog
-- gives them 7 days before flagging stale (vs 1 day for HDFC).
INSERT OR IGNORE INTO money_source_health (source, instrument, expected_max_gap_minutes, notes) VALUES
  ('cash', 'cash_basheer',     10080, 'GM-collected cash held by Basheer until deposit/spend. Two-leg transfer events from pos_counter_he/nch credit this pile.'),
  ('cash', 'cash_nihaf',       10080, 'Owner-held cash. Receives from cash_basheer; spends via /ops/expense/ or /ops/money/ PO settle.'),
  ('cash', 'pos_counter_he',   2880,  'HE outlet till. Cash sales credit; counter expenses + handover-to-Basheer debit.'),
  ('cash', 'pos_counter_nch',  2880,  'NCH outlet till. Cash sales credit; counter expenses + handover-to-Basheer debit.');

-- Cleanup: the original schema seeded paytm_counter_nihaf under source='paytm'.
-- pos_counter_he / pos_counter_nch were never seeded (they were used as
-- instrument values inside business_expenses-driven paths but never had a
-- money_source_health row). The INSERTs above add them now. No-op if a
-- prior migration already added them.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Allowed instrument set (enforced in API write layer):
--   hdfc_ca_4680        (source='hdfc')
--   federal_sa_4510     (source='federal')
--   razorpay_balance    (source='razorpay')
--   paytm_counter_nihaf (source='paytm')
--   pos_counter_he      (source='cash' — HE till)
--   pos_counter_nch     (source='cash' — NCH till)
--   cash_basheer        (source='cash' — GM cash)
--   cash_nihaf          (source='cash' — owner cash)
--
-- Adding a new instrument = update this comment + the API CASH_INSTRUMENTS
-- set in functions/api/money.js + the validInstrumentSet check in spend.js.
-- That's the right friction; free-text instrument names break reconciliation
-- silently.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
