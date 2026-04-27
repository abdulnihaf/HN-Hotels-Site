# Cash back-fill — April 2026

One-shot script that produces `money_events` rows for cash outflows that
landed before the `cash_basheer` / `cash_nihaf` instruments existed.

Spec: [`docs/OPS-CASH-SPEC.md` §4.6](../../docs/OPS-CASH-SPEC.md). This is
the gate for Phase 1 acceptance §8.8 (±0.5% reconciliation).

## Run order

```bash
# 1. Dry-run — produces a CSV you review before any write.
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export D1_DATABASE_ID=...
node scripts/cash-backfill/run.js --dry-run --since=2026-04-01
# → data/cash/april-backfill-classifications-<run-id>.csv

# 2. Open the CSV. Fill `suggested_instrument` on every REVIEW row.
#    Examples of judgment calls:
#      - Naveen recorded an HE-brand cash expense → cash_basheer (he holds Basheer's pool)
#      - Nihaf recorded an HE-brand cash expense → cash_nihaf
#      - "Other" outlet name → ambiguous → ask owner

# 3. Commit — idempotent INSERT. Re-runnable.
node scripts/cash-backfill/run.js --commit --csv=data/cash/april-backfill-classifications-<run-id>.csv

# 4. Reconcile — print per-pile balances. Use this to verify §8.8.
node scripts/cash-backfill/run.js --reconcile --since=2026-04-01
```

## Idempotency

Each row carries `source_ref = backfill:expense:<id>`. Re-running
`--commit` on the same CSV is safe — the unique index on
`money_events(source, source_ref, direction, amount_paise, txn_at)`
silently rejects the duplicate.

## Counter→Basheer transfer reconstruction (deferred)

§4.6 step 6 calls for reconstructing cashier-to-Basheer hand-over events
from end-of-day cash deposit slips. That's a manual data entry — not
scripted here. Use the `/ops/cash/` "Record Transfer" UI for each day
that has a slip; for missing days, write one synthetic transfer event
matching the day's net counter cash flow with `notes='backfill: net handover'`.

## Out of scope (Phase 1)

- PO-settled cash payments before the new `cash_instrument` body param
  was added to `settle-po`. If a settlement happened in April under the
  old code path, it has no `linked_po_id` row in `money_events` yet.
  The forensic engine in Phase 3 will catch and link these
  retroactively via "Mark expense as PO-payment" (DUP-SPEC §5.1).
