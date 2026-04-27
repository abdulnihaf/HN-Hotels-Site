# PO/Expense Duplication Intelligence + April Cleanup — Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Depends on:** `docs/OPS-CASH-SPEC.md` (Phase 1) and `docs/OPS-VISIBILITY-SPEC.md` (Phase 2). Both must ship first.
**Goal:** (a) Surgically identify every PO that was also recorded as a cash/bank expense, using April 1, 2026 onwards as the test corpus. (b) Provide a one-time cleanup workflow for those existing duplicates. (c) Lock write-time guards so going forward, duplication cannot occur silently across deployments.

---

## 1. Owner's intent (locked in)

> "Add a layer where a duplication of a PO is not done as expense. This intelligence needs to be defined very intelligently, understanding the different deployments where duplication is possible. Use data from April 1st as test. Surgically understand which POs are created and the same PO is recorded as an expense — based on price, date matching, and practical understanding of the data. After cleaning this layer, prepare the final P&L."

Two layers:
- **Forensic** — find and clean April's existing dupes.
- **Preventive** — block silent dupes from happening again.

---

## 2. Why this is now tractable (after Phases 1 + 2)

| Phase | What it gave us | Why it matters for dup work |
|---|---|---|
| Phase 1 (`/ops/cash/`) | Every cash outflow row carries `vendor_id`, `category_id`, `product_id`, `qty/uom`, `bill_ref`, `linked_po_id`, `recorded_by` | Anchor fields for matching. Without these, any dup match is fuzzy. |
| Phase 2 (`/ops/money/` settlement console) | All settlements flow through one endpoint with payment_source picker; Zoya's POs propagate to cashier UIs live | Going forward, the only way a PO and an expense for the same purchase coexist is if someone bypassed `/ops/money/` AND ignored the cashier's "Unsettled POs" tab. Smaller surface area to guard. |

April data still has the legacy mess (vendor names typed free-text, no `linked_po_id`, scattered settlements). Phase 3 cleans that up once.

---

## 3. Where duplication can still occur (failure-mode map)

| # | Vector | Lives in | Phase 2 helps? | Phase 3 must handle |
|---|---|---|---|---|
| **D1** | Cashier records counter expense AND Zoya raises PO same day for same vendor | `/ops/v2/` + `/ops/purchase/` | Partial — cashier sees Unsettled POs tab, but if PO didn't exist yet at moment of save, no signal | Add write-time check at `/ops/v2/` save: any PO for this vendor in last 14d ±10%? Banner. |
| **D2** | Naveen records central expense AND Zoya raises PO independently | `/ops/expense/` + `/ops/purchase/` | Partial — Phase 2 banner on vendor-pick flags open POs | Tighten banner to also flag *recently-paid* expenses, not just open POs |
| **D3** | PO settled via `/ops/money/` AND outlet ALSO paid cash for same delivery (timing race: cash paid before PO was raised) | `/ops/v2/` + `/ops/money/` | Soft warning in old Dupes tab | Phase 3 makes Dupes tab hard-actionable — see §6 |
| **D4** | Vendor name drift — same vendor entered as "Ganga Bakery" in PO and "G B Buns" at counter; vendor_id never linked | All surfaces | Phase 2 enforces vendor master, but legacy April data is dirty | Forensic pass uses fuzzy + manual vendor-merge UI |
| **D5** | Amount drift > 5% (rounding, extra item added) — detector misses | All | No | Phase 3 widens window to 15% with confidence tiers |
| **D6** | Different brand tagged by mistake (PO on HE, expense logged under NCH) | All | Phase 2 doesn't fix | Forensic must run brand-agnostic; flag brand-mismatch as a sub-finding |

---

## 4. Forensic engine — April cleanup pass

### 4.1 Inputs
- All `purchase.order` rows where `date_order >= 2026-04-01`.
- All cash/bank outflow events from `money_events` and `business_expenses` where `date >= 2026-04-01`.
- Vendor master snapshot.

### 4.2 Match algorithm — confidence tiers

| Tier | Vendor match | Amount window | Date window | Other |
|---|---|---|---|---|
| **🔴 High (auto-pair candidate)** | Exact `vendor_id` match | ±5% | PO−1d to expense+7d | Same brand |
| **🟠 Medium** | Exact `vendor_id` OR token overlap ≥ 70% on normalized vendor name | ±15% | PO−3d to expense+14d | Brand match preferred |
| **🟡 Low (review hint)** | Token overlap 50–70% OR shared phone/GSTIN | ±25% | PO−7d to expense+21d | Cross-brand allowed |
| **— Not flagged** | Anything weaker | — | — | — |

Normalization for vendor token match: lowercase, strip punctuation, drop stoplist tokens (already in `spend.js:findFuzzyDup` — reuse), brand-aware parens.

### 4.3 Output
A new D1 table `dup_candidates` (one row per suspect pair):
```
id, po_id, po_name, expense_kind (counter|central|bill),
expense_id, vendor_id_po, vendor_id_expense, vendor_name_po,
vendor_name_expense, amount_po_paise, amount_expense_paise,
date_po, date_expense, brand_po, brand_expense,
confidence (high|medium|low), match_signals (json), created_at
```
Indexed by `(confidence, brand_po)` for fast review-UI paging.

### 4.4 Idempotency
Re-running the engine MUST be safe. Use `(po_id, expense_kind, expense_id)` as a unique key. If a pair already has a row in the existing `dup_resolutions` table, skip it (already reviewed).

---

## 5. Cleanup review UI — `/ops/agents/dup-review/`

A focused page (or a tab inside `/ops/agents/`):

**Top:** counts per confidence — 🔴 High · 🟠 Medium · 🟡 Low. Defaults to High.

**Body:** card per pair, side-by-side:

```
┌─ PO #456 ──────────┐  ┌─ Cash Expense #789 ──┐
│ Vendor: Ganga …    │  │ Vendor: Ganga …       │
│ ₹996 · 14-Apr      │  │ ₹1000 · 14-Apr        │
│ By: Zoya           │  │ By: Basheer (NCH)     │
│ State: Open        │  │ Source: Counter NCH   │
│ Bill ref: —        │  │ Bill ref: —           │
└────────────────────┘  └───────────────────────┘
Match: vendor 100%, amount 0.4%, date 0d  →  CONFIDENCE: HIGH

[ Same delivery — cancel PO ]   [ Same delivery — keep PO, mark expense as PO-payment ]
[ Two different purchases — dismiss ]   [ Need more info — defer ]
```

### 5.1 Action semantics
| Button | Effect |
|---|---|
| **Cancel PO** | Odoo `purchase.order.button_cancel`; expense row stays as the source of truth. Writes `dup_resolutions` row. |
| **Mark expense as PO-payment** | Run the `/ops/money/` settle path retroactively: post bill from PO, register payment, link to existing `money_events` row (don't create a new debit — instead update `linked_po_id` on the existing row). Idempotent. |
| **Dismiss** | Mark pair as not-a-dup in `dup_resolutions` (action='not-duplicate'). Excluded from future scans unless data changes. |
| **Defer** | Leaves pair pending; resurfaces next scan. |

### 5.2 Bulk actions
For high-confidence pairs only: "Apply same action to all 🔴 High in this batch" with a 5-second undo window.

---

## 6. Preventive layer — write-time guards (going forward)

Three guards, soft (warn) → hard (block) staged rollout.

### 6.1 At `/ops/v2/` cashier save (counter expense)
Before write, query: open POs for `vendor_id` in last 14 days where amount within ±10%.

- **If found:** banner — *"Open PO #456 ₹996 from {vendor} ({age}d old). Are you paying this PO?"*
  - **[Yes — settle PO]** → redirect to `/ops/money/` Pay-Now scrolled to that PO, prefill amount.
  - **[No — separate purchase]** → save proceeds, but `money_events` row gets `verified_separate=true` so forensic engine ignores it.
- Soft v1; consider hard-block in v2 only after telemetry shows false-positive rate < 5%.

### 6.2 At `/ops/expense/` Naveen save (central expense)
Same as 6.1 but checks both open POs AND recently-paid counter expenses (catches "Naveen books expense for something Basheer already paid").

### 6.3 At `/ops/purchase/` Zoya PO create
Before confirming PO, query recent paid expenses for `vendor_id` in last 14 days within ±10% amount.

- **If found:** banner — *"{Vendor} was already paid ₹X on {date} by {who}. Continue creating PO?"*
- Soft warn only — Zoya's POs are often forward-looking (next week's delivery) so false positives are higher here.

### 6.4 Vendor master enforcement (precondition)
All three guards require `vendor_id` to be present at write time. Phase 2 should already enforce this on new entries, but Phase 3 explicitly verifies the precondition before deploying guards. If any surface still allows free-text vendor → fix that first.

---

## 7. Files likely to be touched

| File | Change |
|---|---|
| `schema-dup-candidates.sql` (new) | Forensic table + indexes |
| `scripts/dup-scan/run.py` or `functions/api/dup-scan.js` (new) | Forensic engine, runs on cron + on-demand |
| `functions/api/agents.js` | Surface `dup_candidates` queue; resolution endpoints |
| `functions/api/money.js` | Extend settle path to support "retroactive PO-payment link" (action 5.1 button 2) |
| `functions/api/spend.js` | Extend `/api/spend?action=record` and the central-expense path with the §6.1 / §6.2 vendor pre-check |
| `functions/api/rm-ops.js` | Extend PO create with §6.3 banner |
| `ops/v2/` (HE + NCH) | Vendor pre-check banner UI |
| `ops/expense/index.html` | Same |
| `ops/purchase/index.html` | Same (with softer copy) |
| `ops/agents/index.html` | New "Dup Review" tab |
| Reuse existing `findFuzzyDup` in `spend.js` for token normalization |

---

## 8. Out of scope

- P&L computation (next milestone after Phase 3 lands).
- Hard-blocking write-time guards (v2 only after FP rate measured).
- Automated PO cancellation without human review (always requires owner click in v1).
- Cross-month dup detection (April only for v1; Mar/May extension is a follow-up).

---

## 9. Acceptance criteria

1. Forensic scan over April data populates `dup_candidates` with non-zero rows in each confidence tier.
2. `/ops/agents/dup-review/` lists 🔴 High pairs by default; each pair card shows side-by-side details + 4 action buttons.
3. Clicking "Cancel PO" on a high-confidence pair: PO state in Odoo flips to `cancel`; pair disappears from queue; `/ops/cash/` row stays unchanged; P&L delta logged.
4. Clicking "Mark expense as PO-payment": existing `money_events` row updates with `linked_po_id`; PO state flips to `paid`; no new debit created; P&L delta = 0.
5. "Dismiss" persists in `dup_resolutions`; pair never re-surfaces.
6. Re-running the scan is idempotent — no duplicate `dup_candidates` rows.
7. At `/ops/v2/` save, picking a vendor with an open PO ±10% in last 14d shows the §6.1 banner; choosing "settle PO" successfully redirects to `/ops/money/` Pay-Now panel; choosing "separate" tags the row with `verified_separate=true`.
8. Same for `/ops/expense/` (§6.2) and `/ops/purchase/` (§6.3).
9. After all April 🔴 High pairs are resolved, `/ops/cash/` total + `/ops/bank/` totals reconcile to physical cash + bank statements within ±0.5% (this becomes the entry condition for the P&L milestone).

---

## 10. Sequencing — the full picture

| Phase | Spec | Output |
|---|---|---|
| **Phase 1** | `OPS-CASH-SPEC.md` | Live cash trail. Cash position visible. |
| **Phase 2** | `OPS-VISIBILITY-SPEC.md` | Cross-surface visibility + `/ops/money/` settlement console. |
| **Phase 3** | **this doc** | April dupes cleaned + write-time guards live. |
| **Next milestone** | (future spec) | April P&L per day / per week / live YTD. Built on clean ledger. |

Strict order. Do not start Phase 3 work until Phase 2 is in production and the vendor master is enforced everywhere. Do not start P&L work until Phase 3 §9 criterion 9 is met.
