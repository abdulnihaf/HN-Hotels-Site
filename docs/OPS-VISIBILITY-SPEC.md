# Cross-Surface Visibility + `/ops/money/` Settlement Console — Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Depends on:** `docs/OPS-CASH-SPEC.md` (must ship first — cash trail is the data foundation this spec reads from).
**Goal:** (a) Every UI shows the slice of payment-state truth relevant to its role, live. (b) `/ops/money/` is promoted from read-only cockpit to the **single settlement console** for all pay-outs (PO, bill, direct expense). (c) Every surface carries a small audit footer of recent actions.

---

## 1. Owner's intent (locked in)

> "All UIs across the 10 deployments should show a trail of action performed on that deployment. If replicant to another deployment — for example Zoya creates a PO, it shows up in unsettled POs in the cashier deployment; if settled it disappears from cashier; the ledger always has live PO data. `/ops/money/` has clear insight of each PO/expense — knowing for what cash was used and for what bank was used. PO settlement after Basheer collects cash from counter is from `/ops/money/`. `/ops/money/` has all records of all cash and bank transactions across purchase, bills, expense, counter expenses."

This is a read-side propagation problem + a settlement-flow consolidation, not a new data model.

---

## 2. Per-surface visibility matrix

| # | Surface | Today | Must add |
|---|---|---|---|
| 1 | **NCH `/ops/v2/`** | Sales + counter expense | "Unsettled POs (NCH)" tab — read-only list of `purchase.order` rows where `brand=NCH` and state ∈ (`purchase`, `done`) and `invoice_status != 'invoiced'`. Just so cashier knows what's coming; no settle action here. |
| 2 | **HE `/ops/v2/`** | Same | Same as (1), scoped to HE. |
| 3 | **`/ops/purchase/`** | Zoya raises POs | "My POs" tab filtered by `created_by_pin = session_pin`. Status badges: `Open` → `Bill Pending` → `Paid (cash·₹X·by Naveen·27-Apr)`. Each badge clickable → matching `/ops/cash/` or `/ops/bank/` row. |
| 4 | **`/ops/purchase/view/`** | PO browser | Add columns: payment_state, payment_source chip (`Cash-Basheer` / `Cash-Nihaf` / `HDFC` / `Razorpay`), settled_by, settled_at. |
| 5 | **`/ops/expense/`** | Naveen records central expense | When vendor is picked, show inline banner: *"3 open POs from {vendor} totalling ₹X. Settle one instead?"* with click-through to `/ops/money/` Pay-Now panel. |
| 6 | **`/ops/bills/`** | Vendor bill viewer | Add payment-source chip per bill row + filter toggle "show paid bills". Add linked-PO and linked-`money_events` IDs. |
| 7 | **`/ops/money/`** | Read-only aggregator | **Promoted to settlement console** (see §3). |
| 8 | **`/ops/bank/`** | Bank ledger | Add `linked_kind` column per row (`po` / `bill` / `expense` / `transfer` / `inflow`) + `linked_ref` (PO name / bill ref / expense id) so any debit shows what it paid for. |
| 9 | **`/ops/vendor/`** | Vendor master | Per-vendor drilldown: open POs, pending bills, last 10 payments (mixed cash + bank), YTD spend. |
| 10 | **`/ops/agents/`** | Finance-watcher review | New rule: **`po_paid_no_money_event`** — PO marked paid/billed in Odoo but no corresponding `money_events` row within ±48h. Critical severity. Surfaces silent payment-trail gaps. |

---

## 3. `/ops/money/` — settlement console behavior

**Today:** Paid / Open POs / Bills Pending / Orphans / Dupes — all read-only.

**After this deployment:** add a **"Pay Now" panel** at the top with three queues:

### 3.1 Three queues
1. **Open POs awaiting payment** — `purchase.order` where state ∈ (`purchase`, `done`) and `invoice_status` is `to invoice` or `invoiced` but `payment_state != 'paid'`. Sorted by age desc, then amount desc.
2. **Bills pending payment** — `account.move` where `move_type='in_invoice'`, `state='posted'`, `payment_state != 'paid'`. Overdue first (by `invoice_date_due`).
3. **Reimbursements / petty** — counter expenses where outlet paid out of till and HQ owes it back (future v2; tag in spec but skip in v1 if scope tightens).

### 3.2 Settle modal (single entry point)
Click "Settle" on any row → modal with:
- Amount (pre-filled, editable)
- **Payment source** (required dropdown): `Cash-Basheer` / `Cash-Nihaf` / `HDFC` / `Razorpay` (driven by `money_events` instrument list)
- Date (default today)
- Notes (free text)
- Attachment (optional photo of bill/receipt)

### 3.3 On submit (transactional)
1. Write one `money_events` row: direction=debit, instrument=chosen source, amount, vendor_id, category_id, product_id, qty, uom, bill_ref, bill_date, attachment_url, **`linked_po_id`** or **`linked_bill_id`**, `recorded_by_pin`.
2. Flip Odoo state: post bill if PO not yet billed (reuse existing `settle-po` action in `spend.js:3547`), then register payment on the matching journal.
3. Return updated state to all subscribed UIs (push or short-poll — see §6).

### 3.4 Deprecation path (don't break existing flows immediately)
- `/ops/purchase/` register-payment button stays for now but shows banner: *"Settlement now happens in `/ops/money/`. Pay there for clean trail."*
- `/ops/expense/` direct cash flow stays for true non-PO expenses (utility bills with no PO, petty cash, etc.); banner if vendor has open PO suggests `/ops/money/` instead.
- After 30 days of telemetry showing usage migrated, hard-disable the legacy paths in a follow-up PR.

---

## 4. Per-surface action trail (audit footer)

A shared component, injected as a footer panel on every page (collapsed by default):

**"Last 20 actions on this page"** — columns: timestamp, actor (PIN→name), action verb, target (PO/bill/expense ID), amount (if applicable), link.

### 4.1 Data source
Reuse the `recorded_by_pin` / `recorded_by_name` columns already populated in `business_expenses`, `purchase_bills`, `money_events`. Add a thin view `ops_audit_v` that UNIONs these with a synthetic `surface` column derived from the source table. Per-surface filter = `WHERE surface = ?`.

### 4.2 No new write path
This is read-only over existing data. If a future surface lacks attribution, fix that table's writes — don't build a parallel audit log.

---

## 5. Live propagation — how each UI stays current

Two acceptable mechanisms; pick one in execution:

| Mechanism | Latency | Cost | Pick when |
|---|---|---|---|
| **Short-poll** every 15-30 s while page is foregrounded | 15-30 s | trivial | v1 — fits Cloudflare Pages + D1 stack already in use |
| **SSE / Durable Object pub-sub** on `money_events` writes | < 2 s | one new Worker | v2 — only if owner says polling feels laggy |

Default: **short-poll** for v1. Owner-perceived freshness in 15-30 s is acceptable for cashier "unsettled POs" panel given the workflow rhythm (cash settlement is a daily, not minute-by-minute, event).

---

## 6. Files likely to be touched

(Confirm before edits — execution chat reads each first.)

| File | Change |
|---|---|
| `ops/v2/` (HE + NCH) | Add "Unsettled POs" tab; read-only list; 30-s poll |
| `ops/purchase/index.html` | "My POs" tab; status badges; click-through |
| `ops/purchase/view/index.html` | Add columns; payment-source chip |
| `ops/expense/index.html` | Inline "open POs for this vendor" banner |
| `ops/bills/index.html` | Payment-source chips; paid filter; linked-PO column |
| `ops/money/index.html` | **Largest change.** "Pay Now" panel + Settle modal. Three queues. |
| `ops/bank/index.html` | `linked_kind` + `linked_ref` columns |
| `ops/vendor/index.html` | Per-vendor drilldown panel |
| `ops/agents/index.html` | Surface new `po_paid_no_money_event` rule |
| `functions/api/money.js` | New `action=settle` endpoint (consolidates settle-po + register-payment + money_events write atomically); new `action=pay-now-queues` |
| `functions/api/spend.js` | Refactor existing `settle-po` to be the inner of `money.js:settle`; keep idempotency at line 3585 |
| `functions/api/agents.js` | New rule `po_paid_no_money_event` |
| Shared JS module (new, e.g. `ops/_shared/audit-footer.js`) | Audit footer component |

---

## 7. Out of scope (this PR)

- PO/expense duplicate detection & prevention (separate effort, this branch's original purpose).
- Push notifications to phones.
- Owner-level rollups / P&L (separate dashboard work).
- Multi-currency, FY rollovers.

---

## 8. Acceptance criteria

1. Zoya raises a PO → within 30 s appears in matching brand's `/ops/v2/` Unsettled POs tab AND in `/ops/money/` Pay Now → Open POs queue.
2. Naveen settles that PO from `/ops/money/` choosing source = Cash-Basheer → within 30 s: PO disappears from cashier Unsettled POs; Zoya's My POs tab shows `Paid (cash·₹X·by Naveen·<date>)`; `/ops/cash/` Basheer balance drops by ₹X with full metadata row; `/ops/bank/` is unchanged.
3. Same flow with source = HDFC → `/ops/cash/` unchanged, `/ops/bank/` HDFC balance drops by ₹X, row shows `linked_kind=po`, `linked_ref=<PO.name>`.
4. `/ops/expense/` vendor picker shows the "open POs for this vendor" banner when one exists; click goes to `/ops/money/` Pay Now scrolled to that PO.
5. `/ops/agents/` flags any PO marked paid in Odoo without a corresponding `money_events` row within 48 h.
6. Every surface footer shows last 20 actions on that surface, accurate within last poll cycle.
7. Legacy `/ops/purchase/` register-payment still functions (back-compat) but displays the migration banner.

---

## 9. Sequencing

1. Ship `/ops/cash/` (`OPS-CASH-SPEC.md`).
2. **Ship this** (`OPS-VISIBILITY-SPEC.md`) — read-side propagation + settlement console.
3. Then return to PO/expense duplicate fix on this branch using April data.

Do not interleave 2 with 3. Visibility must be solid before dup work uses it as ground truth.
