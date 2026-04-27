# HN Hotels Ops Refactor — Execution Charter

**Status:** Charter only. No code written.
**Owner:** Nihaf
**Repo:** `abdulnihaf/HN-Hotels-Site`
**Branch where specs live:** `claude/fix-duplicate-po-expense-MduyZ` (PR #11, draft).

This document is the **single entry point** for the laptop execution chat. It consolidates the goal, the phase plan, the global rules, the inputs each phase consumes, the outputs each phase produces, and the prompt to start Phase 1.

---

## 1. The goal in one paragraph

HN Hotels (Hamza Express + Nawabi Chai House under HN Hotels Pvt Ltd) runs a multi-surface ops system across 10 deployments. Cash trail today is opaque (counter cash visible, collected cash with Basheer/Nihaf invisible to system); the same purchase often appears as a PO and as a cash expense, double-counting in P&L; and there is no single place to settle pay-outs. The owner's ultimate goal is a **trustworthy April 2026 P&L per day / per week / live YTD**. To get there, three foundational deployments must ship first, in strict order. Each unlocks the next.

---

## 2. The four phases at a glance

| Phase | Spec | Branch | Owns |
|---|---|---|---|
| **1** | `docs/OPS-CASH-SPEC.md` | `claude/ops-cash-trail` | New `/ops/cash/` page; `cash_basheer` / `cash_nihaf` instruments; cash-transfer endpoint; April back-fill script; "Hand over to Basheer" UI in `/ops/v2/`. |
| **2** | `docs/OPS-VISIBILITY-SPEC.md` | `claude/ops-visibility` | Per-surface visibility on all 10 deployments; `/ops/money/` promoted to settlement console; idempotent two-system settle (D1+Odoo) with partial-failure recovery; shared vanilla-JS audit footer; tightened 6h watchdog. |
| **3** | `docs/OPS-DUP-SPEC.md` | `claude/ops-dup-intelligence` | Forensic engine over April; `dup_candidates` table; `/ops/agents/dup-review/`; soft write-time guards at `/ops/v2/`, `/ops/expense/`, `/ops/purchase/`; "Mark expense as PO-payment" idempotent retroactive link. |
| **4** | (spec to be written after Phase 3 ships) | `claude/ops-pnl` | April P&L line by line: dine-in / aggregator revenue / commissions / COGS / payroll / rent / utilities / EBITDA / NP. Per day / per week / live YTD. |

---

## 3. Global rules (apply across all phases)

1. **Mobile-first.** Every page in scope must work on phone in portrait. Tap targets ≥ 44 px. Validate on Safari iOS + Chrome Android before declaring done.
2. **Money in paise (integer).** Stored as INTEGER paise everywhere. Convert to rupees at display layer only. No float math on money.
3. **One branch + one draft PR per phase.** No bundling. Each phase's acceptance must pass before the next branch is cut.
4. **Reuse, don't reinvent.**
   - Token normalization → `findFuzzyDup` in `functions/api/spend.js`.
   - Ledger UI pattern → `ops/bank/index.html`.
   - Attribution → `recorded_by_pin` / `recorded_by_name` columns already in `business_expenses`, `purchase_bills`, `money_events`.
   - Dual-write D1+Odoo → existing `settle-po` pattern in `spend.js:3547`.
5. **No build pipeline.** All UI is static HTML + plain ES modules served from Cloudflare Pages. Do not introduce npm, Vite, Rollup, esbuild.
6. **No production deploys from Claude.** Owner reviews and merges PRs manually. Claude opens drafts only.
7. **Read before edit.** Every file in a spec's "Files likely to be touched" section must be read fully before being modified.

---

## 4. Phase hand-off gates

| From | To | Gate |
|---|---|---|
| Phase 1 → 2 | — | `OPS-CASH-SPEC.md §8.8` — cash + bank totals reconcile to physicals within ±0.5% after April back-fill runs. |
| Phase 2 → 3 | — | `OPS-VISIBILITY-SPEC.md §8` all criteria pass AND vendor master is enforced on all 10 surfaces (no free-text vendor saves). |
| Phase 3 → 4 | — | `OPS-DUP-SPEC.md §9.9` — post-cleanup `/ops/cash/` + `/ops/bank/` reconcile to physicals within ±0.5%, all 🔴 High dup pairs resolved. |

Skipping a gate poisons every downstream phase. The P&L Phase 4 only works because Phases 1–3 produced a clean ledger; if any gate is fudged, Phase 4 returns garbage.

---

## 5. The 10 deployments (full list, never trim)

| # | URL | Role |
|---|---|---|
| 1 | https://nawabichaihouse.com/ops/v2/ | NCH cashier — sales + counter expense + (Phase 1) end-of-shift handover + (Phase 2) Unsettled POs tab |
| 2 | https://hamzaexpress.in/ops/v2/ | HE cashier — same |
| 3 | https://hnhotels.in/ops/purchase/ | Zoya — raise PO + (Phase 2) "My POs" tab + (Phase 3) PO-create vendor banner |
| 4 | https://hnhotels.in/ops/purchase/view/ | PO browser + (Phase 2) payment-source chips |
| 5 | https://hnhotels.in/ops/expense/ | Naveen — central expense + (Phase 2) open-PO banner + (Phase 3) recently-paid banner |
| 6 | https://hnhotels.in/ops/bills/ | Bill viewer + (Phase 2) payment chips + linked-PO column |
| 7 | https://hnhotels.in/ops/money/ | (Phase 2) **promoted to settlement console** with Pay-Now panel |
| 8 | https://hnhotels.in/ops/bank/ | Bank ledger + (Phase 2) `linked_kind` / `linked_ref` columns |
| 9 | https://hnhotels.in/ops/vendor/ | Vendor master + (Phase 2) per-vendor mini-ledger |
| 10 | https://hnhotels.in/ops/agents/ | Finance-watcher + (Phase 2) `po_paid_no_money_event` rule + (Phase 3) `dup-review` subpage |
| (new) | https://hnhotels.in/ops/cash/ | (Phase 1) live cash ledger — added to nav in `/ops/money/` |

---

## 6. Reference docs (read these in laptop chat before any edit)

| File | Purpose |
|---|---|
| `docs/OPS-CASH-SPEC.md` | Phase 1 spec |
| `docs/OPS-VISIBILITY-SPEC.md` | Phase 2 spec |
| `docs/OPS-DUP-SPEC.md` | Phase 3 spec |
| `docs/EXECUTION-CHARTER.md` | This file — cross-phase view + global rules |
| `docs/MONEY-FLOW-TESTING-GUIDE.md` | Current 5-app architecture, TEST scenarios, cockpit semantics |
| `docs/SOURCES.md` | `money_events` ingest matrix (HDFC, Razorpay, Paytm, Zomato, Swiggy, EazyDiner, POS) |
| `docs/CONTRACT_REGISTRY.md` | Aggregator commission rules — needed for Phase 4 P&L |
| `schema-money-events.sql` | Canonical money ledger schema |
| `schema-purchase-bills.sql`, `schema-business-expenses-fixD.sql`, `schema-vendors.sql`, `schema-ledger.sql` | Adjacent schemas |
| `functions/api/money.js`, `spend.js`, `rm-ops.js`, `agents.js`, `bank-feed.js` | Handlers behind the 10 surfaces |
| `ops/bank/index.html` | UI pattern to mirror for `/ops/cash/` |
| `ops/money/index.html` | The page being upgraded in Phase 2 |
| `ops/v2/` (HE + NCH) | Cashier UI |

---

## 7. The laptop execution prompt — paste this verbatim

```
You are taking over execution of the HN Hotels ops refactor.
Repo is already cloned. Pull latest first:

  git fetch origin
  git checkout claude/fix-duplicate-po-expense-MduyZ
  git pull --ff-only

Read docs/EXECUTION-CHARTER.md FIRST. It is the single entry point.
Then read the three phase specs in order:
  1. docs/OPS-CASH-SPEC.md
  2. docs/OPS-VISIBILITY-SPEC.md
  3. docs/OPS-DUP-SPEC.md
Plus the reference docs listed in CHARTER §6.

Execute strictly in phase order. For each phase:

  a) Cut a new branch from main:
       Phase 1: claude/ops-cash-trail
       Phase 2: claude/ops-visibility   (after Phase 1 merges)
       Phase 3: claude/ops-dup-intelligence  (after Phase 2 merges)
  b) Read every file in that phase's "Files likely to be touched"
     section before any edit.
  c) Implement the spec. Commit incrementally — one logical change
     per commit, descriptive messages.
  d) Open a draft PR after first push. Do not merge.
  e) Verify all acceptance criteria in the spec's §8 (or §9 for dup).
  f) Stop. Wait for owner to merge.
  g) Hand-off gate from CHARTER §4 must pass before next phase.

Global rules (CHARTER §3):
  - Mobile-first; ≥44px tap targets; test Safari iOS + Chrome Android.
  - Money in paise (INTEGER); rupees only at display.
  - One branch + one draft PR per phase. No bundling.
  - Reuse existing patterns; don't invent UI primitives.
  - No build pipeline (vanilla JS / static HTML only).
  - No production deploys from Claude. Drafts only.
  - Read before edit.

Constraints from prior chat (still binding):
  - Owner is on mobile during this work; he cannot easily upload
    files. If you need data input from him, ask for screenshots
    or commit-and-paste-link. Don't block on data uploads.
  - I (the prior chat) committed the three specs to PR #11 on
    branch claude/fix-duplicate-po-expense-MduyZ. They are not
    on main. Cherry-pick or rebase as needed when cutting Phase
    branches; the cleanest path is to rebase each phase branch
    on main AFTER PR #11 merges, but if owner wants Phase 1 to
    start immediately, cut claude/ops-cash-trail from
    claude/fix-duplicate-po-expense-MduyZ so the spec docs
    travel with it.

Phase 4 (April P&L per day / per week / live YTD) is NOT in this
prompt. Owner will brief Phase 4 separately after Phase 3 ships.

Begin by confirming back to me:
  1. You've read all four docs.
  2. Which branch you'll cut and from which base.
  3. Your plan for Phase 1 day 1 (schema migration + back-fill
     script before any UI work, or UI scaffold first?).
Then wait for my go-ahead before writing any code.
```

---

## 8. What is intentionally NOT in this charter

- Phase 4 P&L spec (will be authored after Phase 3 ships against the cleaned ledger).
- Hard-block dup guards (Phase 3 §6 ships soft-warn first; hard-block follows once FP rate < 5%).
- Reconciliation against physical cash counts (Phase 1 v2; current spec only reconciles against Odoo balances).
- Multi-currency, FY rollover, depreciation policy, GST e-filing.
- Push notifications, SMS, WhatsApp alerts.
- Owner-facing investor / partner dashboards.

If any of those become urgent, write a separate spec; do not retrofit into the Phase 1–3 work.
