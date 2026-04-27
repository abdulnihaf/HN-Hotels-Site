# Cross-Surface Visibility + `/ops/money/` Settlement Console — Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Depends on:** `docs/OPS-CASH-SPEC.md` Phase 1 acceptance §8.8 (the ±0.5% reconciliation gate) — must pass before this phase starts.
**Goal:** (a) Every UI shows the slice of payment-state truth relevant to its role, live. (b) `/ops/money/` is promoted from read-only cockpit to the **single settlement console** for all pay-outs (PO, bill, direct expense). (c) Every surface carries a small audit footer of recent actions.

Global rules (mobile-first, paise integer storage, one-branch-per-phase, reuse-not-reinvent) are defined in `OPS-CASH-SPEC.md` preamble and apply here unchanged.

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
| 3 | **`/ops/purchase/`** | Zoya raises POs | **(This spec owns the "My POs" tab UI.)** Tab filtered by `created_by_pin = session_pin`. Status badges: `Open` → `Bill Pending` → `Paid (cash·₹X·by Naveen·27-Apr)`. Each badge clickable → matching `/ops/cash/` or `/ops/bank/` row. Phase 1 only ensures the underlying `money_events` row carries the data; Phase 2 builds the tab. |
| 4 | **`/ops/purchase/view/`** | PO browser | Add columns: payment_state, payment_source chip (`Cash-Basheer` / `Cash-Nihaf` / `HDFC` / `Razorpay`), settled_by, settled_at. |
| 5 | **`/ops/expense/`** | Naveen records central expense | When vendor is picked, show inline banner: *"3 open POs from {vendor} totalling ₹X. Settle one instead?"* with click-through to `/ops/money/` Pay-Now panel. |
| 6 | **`/ops/bills/`** | Vendor bill viewer | Add payment-source chip per bill row + filter toggle "show paid bills". Add linked-PO and linked-`money_events` IDs. |
| 7 | **`/ops/money/`** | Read-only aggregator | **Promoted to settlement console** (see §3). |
| 8 | **`/ops/bank/`** | Bank ledger | Add `linked_kind` column per row (`po` / `bill` / `expense` / `transfer` / `inflow`) + `linked_ref` (PO name / bill ref / expense id) so any debit shows what it paid for. |
| 9 | **`/ops/vendor/`** | Vendor master | Per-vendor drilldown: open POs, pending bills, last 10 payments (mixed cash + bank), YTD spend. |
| 10 | **`/ops/agents/`** | Finance-watcher review | New rule: **`po_paid_no_money_event`** — PO marked paid/billed in Odoo but no corresponding `money_events` row within **6 hours** (tightened from 48h: same-day cash hygiene needs faster signal; cron runs hourly). Critical severity. Surfaces silent payment-trail gaps from §3.3 partial-failure recovery. |

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

### 3.3 On submit — semantics across two systems

D1 (Cloudflare) and Odoo are two separate systems; "transactional" across them is aspirational. Define the contract precisely:

**Idempotency key:** `idem_key = sha256(po_id_or_bill_id + amount_paise + payment_source + date + recorded_by_pin)`. Client generates this and sends it; server stores it on the `money_events` row in a new `idem_key` column with a unique index. Re-submits with the same key are no-ops returning the existing row.

**Write order (D1 first, Odoo second):**
1. **D1 insert (state=`pending`):** insert `money_events` row with `parse_status='pending'`, `idem_key`, full metadata, `linked_po_id`/`linked_bill_id`. If unique-constraint violation on `idem_key`, fetch existing row and return it.
2. **Odoo flip:** post bill if PO not yet billed (reuse `spend.js:3547` `settle-po`); then register payment on the matching journal.
3. **D1 confirm:** UPDATE the `money_events` row to `parse_status='parsed'` and store `odoo_payment_id` for traceback.

**Partial-failure recovery:**
- If step 2 fails after step 1 succeeds: row stays `parse_status='pending'`. The hourly `po_paid_no_money_event` watcher (§2 row 10) inverts the same logic — `parse_status='pending'` older than 1 hour → "Pending Settlement" alert in `/ops/agents/`. Owner clicks "Retry" → server re-runs step 2 with the same idem_key.
- If step 1 fails: client gets the error; nothing happened anywhere. Safe to retry.
- If step 3 fails after step 2 succeeded: same alert path; retry is idempotent on Odoo side because `idem_key` is checked.

**UI return:** updated state pushed to subscribed UIs via short-poll (§5). No optimistic UI updates on the cashier-facing surfaces — show the actual server state to avoid Basheer thinking a settle succeeded when it's still pending.

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

### 4.3 Shared component delivery — vanilla JS, no build step
The 10 surfaces are static HTML pages served from Cloudflare Pages with inline `<script>` blocks; there is no bundler in this repo. The audit footer must therefore be:
- A single file `ops/_shared/audit-footer.js` (plain ES module, no transpile).
- Imported via `<script type="module" src="/ops/_shared/audit-footer.js"></script>` on each surface.
- Self-contained: registers a custom element `<ops-audit-footer surface="ops/money">` with its own styles inlined via Constructable Stylesheets or a `<style>` element appended to a Shadow DOM. No CSS imports.
- Fetches from `/api/money?action=audit&surface=...` — a new endpoint backed by the `ops_audit_v` view.
- Polls on the same 30-s cadence as the rest of Phase 2.

Do NOT introduce npm, Vite, Rollup, esbuild, or any build pipeline. If a surface can't load the module (e.g., a legacy non-module page), fall back to inline copy-paste — the goal is zero infrastructure change.

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
5. `/ops/agents/` flags any PO marked paid in Odoo without a corresponding `money_events` row within 6 h, AND flags any `money_events` row stuck in `parse_status='pending'` for >1 h (partial-failure recovery from §3.3).
6. Every surface footer shows last 20 actions on that surface, accurate within last poll cycle.
7. Legacy `/ops/purchase/` register-payment still functions (back-compat) but displays the migration banner.

---

## 9. Sequencing

Strict order: **Phase 1 (`OPS-CASH-SPEC.md`) → Phase 2 (this) → Phase 3 (`OPS-DUP-SPEC.md`) → Phase 4 (P&L, separate spec).**

Rules:
- One branch per phase (`claude/ops-cash-trail`, `claude/ops-visibility`, etc.). One draft PR per phase. No bundling.
- Phase 2 cannot start until Phase 1 §8.8 passes (cash + bank ±0.5% reconciliation).
- Phase 3 cannot start until this phase's §8 acceptance passes AND vendor master is enforced everywhere (precondition for dup write-time guards).
- Phase 4 P&L spec will be written after Phase 3 ships. See `docs/EXECUTION-CHARTER.md` for the cross-phase view.
