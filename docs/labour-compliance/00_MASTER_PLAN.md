# Labour Law Compliance — Master Plan

**Owner:** Abdul Nihaf (MD, HN Hotels Pvt Ltd)
**Started:** 2026-05-07
**Trigger:** Karnataka Labour Inspector visit at Hamza Express on 2026-04-29 (notice received by Manager Farooq, 7-day deadline expired 2026-05-06)
**Strategy chosen:** Full pass-through ESI compliance + EPF excluded-employee structure

---

## What we're doing and why

The labour inspector flagged 7 violations under Shops & Establishments, Wages, Equal Remuneration, Gratuity, Child Labour, and Welfare Fund Acts. Most are paperwork. The only recurring-cost item is ESI.

We are NOT defaulting to informal speed-money payments. We are formalising compliance because:
1. Annual cost (~₹12,000) is less than one inspection cycle's bribe
2. ESI gives staff free family medical → real retention value
3. Future inspectors lose leverage when paperwork is clean
4. Any future enterprise contract (Zomato Dining, corporate catering) requires compliance
5. Disgruntled-employee complaints become non-issues

Specifically: ESI ceiling is ₹21,000 gross/month. 14 staff are below this. We cannot legally opt them out — but we CAN restructure their CTC so the company's outflow stays ~unchanged and the employee absorbs the contribution as a deduction.

---

## Final decisions (locked)

| Group | Headcount | Action | Cost impact |
|---|---|---|---|
| **ESI-zone (₹18K–₹19K)** | 14 | CTC restructure: new gross = old / 1.0325. Employee absorbs both ESI shares. | ₹0 extra to company |
| **At ESI ceiling (₹21K — Laden, Yahabu)** | 2 | Bump to ₹21,500 → exits ESI. Cheaper than paying ESI on their wages. | +₹500/mo each = ₹12K/yr |
| **Above ESI ceiling (₹24K–₹45K)** | 11 | No change. Sign Form 11 (EPF excluded employee). | ₹0 |
| **HQ (4 staff < 10 threshold)** | 4 | ESI not applicable at establishment level. Form 11 only. | ₹0 |
| **Badol (zero-salary record)** | 1 | Clean up data first. Sync with Odoo. | N/A |

**Total annual recurring cost increase to company: ₹12,000**

This is the entire price tag for full compliance. Compare against: ₹98,670/yr (full absorption path), ₹4,70,400/yr (wage-bump-everyone path), or ₹50K–₹2L/yr per inspection cycle (speed-money path with legal risk).

---

## Pass-through math (per employee)

For ₹18,000 employee:
```
Old gross           ₹18,000   (cash in hand)
─────────────────────────────
New gross           ₹17,433   (= 18000 / 1.0325)
  Basic            ₹15,001   (forced ≥ ₹15,001 for future EPF exclusion)
  HRA              ₹  1,216
  Other Allowance  ₹  1,216
Employer ESI 3.25% ₹    567
─────────────────────────────
Total CTC company   ₹18,000   (UNCHANGED)
Employee ESI 0.75% ₹    131
Take-home           ₹17,302
─────────────────────────────
Employee absorbs    ₹    698/mo
Employee gains      Free medical for self+spouse+2 kids,
                    maternity benefit, 70% wage during sickness
```

Same logic for ₹19K (MD Kesmat) — see `01_RESTRUCTURE_WORKSHEET.csv` for per-employee numbers.

---

## Why basic = ₹15,001 for everyone

EPF Act Para 26A: Employees with **Basic + DA > ₹15,000** at joining are **"excluded employees"** — no mandatory EPF coverage even if establishment crosses 20-employee threshold.

Today: HE has 16 employees, NCH has 12. Both safely under EPF's 20 threshold. EPF does not trigger.

But once HE reaches 20, EPF triggers retroactively. By setting basic ≥ ₹15,001 for everyone NOW, we future-proof: anyone joining or already on roster with basic above threshold remains excluded even after the trigger.

This is free insurance. Costs nothing. Avoids ₹3,840/employee/month future EPF exposure.

---

## The data-gap blocker

5 ESI-zone employees have **missing Aadhaar/DOB** in our records. ESIC registration cannot proceed without these. See `02_DATA_GAPS.md` for the collection list.

These 5 people are the bottleneck. Until their data is collected, ESI registration is half-blind.

---

## Execution sequence

| Step | What | Who | Doc reference |
|---|---|---|---|
| 1 | Collect missing Aadhaar/DOB | Owner / HR (you) | `02_DATA_GAPS.md` |
| 2 | Sit each ESI-zone employee for CTC restructure conversation | Owner | `06_CONVERSATION_SCRIPT.md` |
| 3 | Get signed contract amendment from each | Owner | `03_CONTRACT_AMENDMENT_LETTER.md` |
| 4 | Get signed Form 11 from ALL 32 staff | Owner | `04_FORM11_TEMPLATE.md` |
| 5 | Register HE establishment at ESIC portal | Owner | `05_ESI_REGISTRATION.md` |
| 6 | Register NCH establishment at ESIC portal | Owner | `05_ESI_REGISTRATION.md` |
| 7 | Add 14 ESI-zone employees to ESIC under their establishment | Owner | `05_ESI_REGISTRATION.md` |
| 8 | First ESI challan generation + payment by 15th of next month | CFO Naveen | (after ESIC active) |
| 9 | Update Odoo `hr.contract` records with new structure | Owner | (manual edit, 32 contracts) |
| 10 | Visit Senior Labour Inspector's office with all docs | Owner | (separate from ESI flow) |

---

## What this plan does NOT cover (yet)

- **Gratuity provision** — triggered (10+ employees), but no cash today. Provision-only entry in books. Will be addressed when first employee approaches 5-year tenure.
- **Labour Welfare Fund** — ₹2,400/yr total, defer to inspector visit (settle past dues at compounding).
- **Bonus Act** — triggered (20+ across entity). For sub-₹21K employees (now restructured to ~₹17K gross), statutory bonus = 8.33% of ₹7,000 wage ceiling. Approx ₹7,000/yr/employee × 14 = ₹98K/yr — **address as Diwali bonus** (festival payment that satisfies the Act).
- **Minimum wage edge case** — Karnataka unskilled minimum for hotels (Bangalore Zone 1, April 2025 notification): ~₹17,565. Our new gross of ₹17,433 is ₹132 below. Marginal risk. Mitigation: contract amendment clearly states medical-cover value as part of compensation.

These items are tracked but not blocking.

---

## Files in this folder

| File | Purpose |
|---|---|
| `00_MASTER_PLAN.md` | This document |
| `01_RESTRUCTURE_WORKSHEET.csv` | Per-employee numbers (32 rows) |
| `02_DATA_GAPS.md` | Missing Aadhaar/DOB list |
| `03_CONTRACT_AMENDMENT_LETTER.md` | EN + HI templates |
| `04_FORM11_TEMPLATE.md` | EPF excluded-employee declaration |
| `05_ESI_REGISTRATION.md` | ESIC portal walk-through |
| `06_CONVERSATION_SCRIPT.md` | What to say to each employee |
