# `/ops/cash/` — Live Cash Trail Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Goal:** A single live view of all cash on hand across HN Hotels, mirroring `/ops/bank/` but for cash. This is the prerequisite to fixing PO/expense duplication — without an accurate cash trail, dup detection has no ground truth to anchor to.

## Global rules (apply to all three phase specs)

- **Mobile-first.** Every page in scope (cashier `/ops/v2/`, `/ops/cash/`, owner views) must be usable on a phone in portrait. Buttons ≥ 44 px tap target. Test in Safari iOS + Chrome Android before declaring done.
- **Money in paise.** All amounts stored as INTEGER paise in DB and APIs. Convert to rupees (paise / 100) only at the display layer. Never use floats for money math.
- **One branch + one draft PR per phase.** No bundling phases. Phase 1 → Phase 2 → Phase 3 → Phase 4 (P&L) merge sequentially. Each phase's acceptance criteria must pass before the next branch is cut.
- **Reuse, don't reinvent.** Token normalization → reuse `findFuzzyDup` in `functions/api/spend.js`. Ledger UI → mirror `ops/bank/index.html`. Attribution → reuse `recorded_by_pin` / `recorded_by_name` columns already in `business_expenses`, `purchase_bills`, `money_events`.

---

## 1. Owner's mental model (locked in)

```
Live Cash = Counter Cash (HE + NCH)  +  Collected Cash (Basheer / Nihaf)

Cash IN:
  POS sale (HE / NCH)             → counter cash ↑

Cash transfer (zero-sum):
  Basheer takes from till         → counter cash ↓ , Basheer cash ↑
  Basheer gives to Nihaf          → Basheer cash ↓ , Nihaf cash ↑
  Deposit to bank                 → Basheer/Nihaf cash ↓ , HDFC ↑

Cash OUT (3 paths today):
  (a) Counter expense (cat 1 etc.)        via /ops/v2/        → counter cash ↓
  (b) Central paid expense                via /ops/expense/   → Basheer/Nihaf cash ↓
  (c) PO settled by cash                  via /ops/money/     → Basheer/Nihaf cash ↓
```

Every cash movement above must produce one row in a unified ledger with a running balance per cash pile.

---

## 2. What exists today

| Surface | Cash role | Gap |
|---|---|---|
| `/ops/v2/` (HE & NCH) | Live counter cash, per shift | Counter-only; nothing after till |
| `/ops/bank/` | Live HDFC + Razorpay ledger with running balance | Cash invisible |
| `/ops/money/` Paid tab | Lists outflows from outlet + central + PO settle | No running balance, no per-row category/product/uom/bill metadata, no cash-pile breakdown |
| `/ops/expense/` | Records central expense, payment method = cash supported | Doesn't distinguish "Basheer cash" vs "Nihaf cash" |
| `/ops/purchase/` | Zoya raises POs | No "my POs status" view; PO creator can't see when her PO was paid |

---

## 3. What's missing

1. **No `cash_basheer` / `cash_nihaf` instruments** in `money_events` schema. (Today: `hdfc_ca_4680`, `razorpay_balance`, `pos_counter_he`, `pos_counter_nch` exist.)
2. **No counter→collected transfer event** when cash leaves the till.
3. **No unified cash ledger view** — `/ops/bank/` covers bank instruments only.
4. **PO-settled cash payments lack line metadata** (category, product, uom, bill_ref, attachment) on the cash-trail row.
5. **PO creator has no visibility** when her PO is settled.

---

## 4. Functional changes required

### 4.1 Data model
- **Decision: strict CHECK constraint, not free-text.** Add a CHECK to `schema-money-events.sql` on `instrument` enumerating exactly: `hdfc_ca_4680`, `federal_ca`, `razorpay_balance`, `paytm_counter_nihaf`, `pos_counter_he`, `pos_counter_nch`, `cash_basheer`, `cash_nihaf`. Free-text is rejected because a single typo (`cash_basher`) silently corrupts cash totals and is invisible until reconciliation fails. Adding a new instrument later = one schema migration; that's the right friction.
- Add a new `source='cash'` value to the `source` CHECK constraint for the two new cash instruments (HDFC continues with `source='hdfc'`, Razorpay with `'razorpay'`, etc.).
- Seed `money_source_health` rows for `cash_basheer` and `cash_nihaf` under `source='cash'` with `expected_max_gap_minutes=10080` (7 days; cash piles can sit idle longer than bank accounts).

### 4.2 Cash transfers (between any two cash piles)
New action `/api/money?action=cash-transfer` taking:
`{ from_instrument, to_instrument, amount_paise, transferred_at, by_pin, notes }`
Writes two `money_events`: one debit row + one credit row, linked by a shared `transfer_group_id` column (add this column — don't overload `notes`). Zero net effect on total cash.

The endpoint is generic: any (from, to) pair of cash instruments works. Three concrete UI surfaces invoke it:
1. **`/ops/v2/` end-of-shift "Hand over to Basheer"** — `from = pos_counter_he` or `pos_counter_nch`, `to = cash_basheer`.
2. **`/ops/cash/` "Record Transfer"** — generic; user picks both endpoints. Used for **Basheer→Nihaf**, Basheer→bank deposit (when paired with a bank-side credit), and any future cash flow.
3. **`/ops/cash/` "Deposit to bank"** — `from = cash_basheer` or `cash_nihaf`, `to = hdfc_ca_4680` or `federal_ca`. Same transfer mechanism.

### 4.3 Cash outflow rows must carry line metadata
Every cash outflow row in `money_events` (counter expense, central expense paid in cash, PO settled in cash) must populate or link to:
- `vendor_id`, `vendor_name`
- `category_id`, `category_name`
- `product_id`, `product_name`
- `qty`, `uom`
- `bill_ref`, `bill_date`, `attachment_url`
- `linked_po_id`, `linked_po_name` (NULL if not from a PO)
- `recorded_by_pin`, `recorded_by_name`

Today most of this exists in `business_expenses`, `purchase_bills`, and Odoo `account.move` — but it doesn't propagate cleanly to the cash-trail row. The fix is either:
- **(a) Denormalize** these fields onto `money_events` at write time (faster reads, more storage), OR
- **(b) JOIN** at read time via foreign keys (cleaner, slightly slower).

Recommend (b) initially; promote to (a) only if read perf hurts.

### 4.4 PO settle from cash
When `/ops/money/` settles a PO with a cash journal:
- Create the bill (`account.move`) — already done.
- Create the payment (`account.payment`) on cash journal — already done.
- **NEW:** also write a `money_events` row tagged `instrument=cash_basheer` (or `cash_nihaf`), `linked_po_id=<po.id>`, with line metadata propagated from the bill.

### 4.5 PO creator visibility — data hooks only (UI lives in Phase 2)
Phase 1 ensures the **data needed** for PO-creator visibility is present:
- The `money_events` row written when a PO is settled carries `linked_po_id`, `linked_po_name`, `instrument` (so cash-vs-bank is derivable), `recorded_by_pin`, `recorded_by_name`, `txn_at`.
- `/ops/cash/` ledger renders the row with all of the above.

**The "My POs" tab UI in `/ops/purchase/`** is owned by Phase 2 (`OPS-VISIBILITY-SPEC.md` §2 row 3). Phase 1 just guarantees the underlying data is queryable. This avoids touching `ops/purchase/index.html` in Phase 1.

### 4.6 April back-fill plan (critical — do not skip)
Every existing April row in `business_expenses`, `purchase_bills`, and Odoo cash-journal `account.move` was written before `cash_basheer` / `cash_nihaf` instruments existed. Without back-fill, `/ops/cash/` totals will be correct only **prospectively** — defeating Phase 3's reconciliation gate.

**Approach** (one-time idempotent script `scripts/cash-backfill/run.js`):
1. Pull all `business_expenses` rows with `payment_method='cash'` since 2026-04-01.
2. Pull all Odoo `account.payment` rows on cash journals (HE cash, NCH cash, HQ petty) since 2026-04-01.
3. For each, classify which cash pile paid it:
   - Counter expense from outlet `/ops/v2/` → `pos_counter_he` or `pos_counter_nch` (use `brand` column).
   - Central cash expense recorded via `/ops/expense/` → `cash_basheer` by default (Naveen's typical source); flag rows where Nihaf is the recorded payer for manual review.
   - PO-settled cash payment → infer pile from journal name and `recorded_by_pin` (Naveen → Basheer; Nihaf → Nihaf).
4. Write a `money_events` row per pulled record with full line metadata. Use a deterministic `source_ref` (e.g. `backfill:expense:<id>`) so re-running is idempotent.
5. Output a CSV `data/cash/april-backfill-classifications.csv` listing every row + chosen instrument; owner reviews ambiguous rows before final commit.
6. Counter→Basheer transfer events for April are reconstructed from end-of-day cash deposit slips owner provides. If slips are missing for a day, write a single reconciliation transfer event matching the day's net counter cash flow with `notes='backfill: net handover'`.

Acceptance for back-fill: after the script runs, `SUM(money_events)` for each cash instrument matches the corresponding Odoo journal balance for the same period within ±0.5%.

---

## 5. UI/UX — the new `/ops/cash/` page

**Top strip — 5 KPI tiles** (live balances, click filters the ledger below):
- Counter NCH · ₹X
- Counter HE · ₹X
- With Basheer · ₹X
- With Nihaf · ₹X
- **Total Live Cash · ₹X**

**Body — unified ledger** (newest first):

| Date | Brand | Dir | Amount | Vendor | Category | Product | Qty/UOM | Bill Ref | Bill Date | 📎 | Settled By | Linked PO | Running Bal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

**Filters:**
- Date range (default: current month)
- Brand: ALL / NCH / HE / HQ
- Instrument: All / Counter NCH / Counter HE / Basheer / Nihaf
- Vendor (autocomplete from vendor master)
- Category
- Settled by (cashier / Naveen / Zoya / Nihaf)

**Actions:**
- "Record Transfer" (cash hand-over between piles)
- "Reconcile" (mark a row as physically counted + matches)
- Export to CSV / xlsx

---

## 6. Files likely to be touched (best estimate; verify in execution)

| File | Change |
|---|---|
| `schema-money-events.sql` | Add cash instruments to seed/health rows |
| `functions/api/money.js` | New `action=cash-trail` endpoint; extend cockpit to expose cash-pile balances |
| `functions/api/spend.js` | When recording counter expense or central cash expense, also write the cash-pile event |
| `functions/api/rm-ops.js` (and PO-settle path) | When PO settled in cash, write the cash-pile row with line metadata |
| `ops/cash/index.html` | NEW — the unified cash ledger page |
| `ops/v2/` (HE + NCH) | Add "Hand over to Basheer" end-of-shift transfer action |
| `ops/money/index.html` | Add "Cash" tab/link to nav, deduplicate with /ops/cash/ |
| `scripts/cash-backfill/run.js` | NEW — one-time April back-fill script (§4.6) |
| `data/cash/april-backfill-classifications.csv` | OUTPUT of back-fill — owner-reviewed before final write |

(`ops/purchase/index.html` is **NOT** touched in Phase 1. The "My POs" tab UI moves to Phase 2 — see VISIBILITY-SPEC §2 row 3.)

(Confirm before edits — execution chat must read each file first.)

---

## 7. Out of scope

- PO/expense duplicate detection & prevention. That's a separate effort; this spec is the foundation that makes it solvable.
- Dashboard rollups, P&L, GST.
- Reconciliation against physical cash counts (future v2).

---

## 8. Acceptance criteria

1. `/ops/cash/` page loads on phone (Safari iOS + Chrome Android), shows 5 KPI tiles with live balances summing correctly.
2. Posting a counter expense at `/ops/v2/` reduces Counter HE/NCH balance immediately.
3. Posting "Hand over ₹X to Basheer" at end-of-shift reduces Counter and increases Basheer pile by exactly ₹X. A row with `transfer_group_id` ties the two `money_events` legs.
4. **Basheer→Nihaf transfer** invoked via `/ops/cash/` "Record Transfer" reduces Basheer pile and increases Nihaf pile by exactly ₹X with the same `transfer_group_id` mechanism.
5. Posting `/ops/expense/` with method=cash reduces Basheer or Nihaf pile per selection.
6. Settling a PO from `/ops/money/` with a cash journal reduces the chosen cash pile AND writes a row with full bill metadata AND links back to the PO via `linked_po_id`.
7. Total Live Cash on `/ops/cash/` matches: Counter HE + Counter NCH + Basheer + Nihaf, recomputed on every page load.
8. **Reconciliation gate (Phase 1 exit bar):** after the §4.6 back-fill runs, `/ops/cash/` total per cash instrument matches Odoo cash-journal balance for the same period within **±0.5%**. `/ops/bank/` total per bank instrument matches the latest HDFC e-statement closing balance within ±0.5%. This is the entry condition for Phase 2 — do not proceed until it passes.
9. Money is stored as INTEGER paise everywhere; no float comparisons in cash-trail code paths.

---

## 9. Sequencing reminder

Strict order: **Phase 1 (this) → Phase 2 (`OPS-VISIBILITY-SPEC.md`) → Phase 3 (`OPS-DUP-SPEC.md`) → Phase 4 (P&L, spec to be written separately).**

Rules:
- One branch per phase. One draft PR per phase. No bundling.
- Phase 2 cannot start until §8 acceptance criterion 8 (the ±0.5% reconciliation gate) passes.
- Phase 4 P&L will be specified after Phase 3 ships; it consumes the clean cash + bank ledger as input. See `docs/EXECUTION-CHARTER.md` for the cross-phase view.
