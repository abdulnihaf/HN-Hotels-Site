# `/ops/cash/` — Live Cash Trail Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Goal:** A single live view of all cash on hand across HN Hotels, mirroring `/ops/bank/` but for cash. This is the prerequisite to fixing PO/expense duplication — without an accurate cash trail, dup detection has no ground truth to anchor to.

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
- Extend the `instrument` CHECK in `schema-money-events.sql` (or accept it as free-text per existing implementation) to formally include:
  - `cash_basheer`
  - `cash_nihaf`
  - (already there) `pos_counter_he`, `pos_counter_nch`
- Seed `money_source_health` rows for both new instruments under `source='manual'` (or a new `source='cash'` after schema review).

### 4.2 Counter→collected transfer
New action `/api/money?action=cash-transfer` taking:
`{ from_instrument, to_instrument, amount_paise, transferred_at, by_pin, notes }`
Writes two `money_events`: one debit row + one credit row, linked by a shared transfer-id (use `notes` or add a `transfer_group_id` column). Zero net effect on total cash.

UI for this lives at the end-of-shift flow in `/ops/v2/` ("Hand over to Basheer" button) and a manual entry in `/ops/cash/` ("Record Transfer").

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

### 4.5 PO creator visibility
- `/ops/purchase/` gets a "My POs" tab (filtered by `recorded_by_pin = session_pin`).
- Each PO row shows status badge:
  `Open` → `Bill Pending` → `Paid (cash · ₹X · by Naveen · 27-Apr)`
- Click-through jumps to the matching `/ops/cash/` ledger row.

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
| `ops/purchase/index.html` | Add "My POs" tab with status badges + click-through to /ops/cash/ |
| `ops/money/index.html` | Add "Cash" tab/link to nav, deduplicate with /ops/cash/ |

(Confirm before edits — execution chat must read each file first.)

---

## 7. Out of scope

- PO/expense duplicate detection & prevention. That's a separate effort; this spec is the foundation that makes it solvable.
- Dashboard rollups, P&L, GST.
- Reconciliation against physical cash counts (future v2).

---

## 8. Acceptance criteria

1. `/ops/cash/` page loads, shows 5 KPI tiles with live balances summing correctly.
2. Posting a counter expense at `/ops/v2/` reduces Counter HE/NCH balance immediately.
3. Posting "Hand over ₹X to Basheer" reduces Counter and increases Basheer pile by exactly ₹X.
4. Posting `/ops/expense/` with method=cash reduces Basheer or Nihaf pile per selection.
5. Settling a PO from `/ops/money/` with a cash journal reduces the chosen cash pile AND writes a row with full bill metadata AND links back to the PO.
6. Zoya opens `/ops/purchase/` "My POs" → sees her PO flipped to `Paid` within 30 s of settlement.
7. Total Live Cash on `/ops/cash/` matches: Counter HE + Counter NCH + Basheer + Nihaf, recomputed on every page load.

---

## 9. Sequencing reminder

This deployment is **strictly before** the PO/expense duplicate fix. Reason: dup detection needs vendor_id, category, product, and a clean cash trail to anchor matches against. Once `/ops/cash/` is live and accurate, dup work uses April data as the test corpus.
