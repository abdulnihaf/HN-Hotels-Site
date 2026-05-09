# NCH Vendor 60-Day Cleanup Audit — 2026-05-09

## Goal

Filter the live NCH vendor list at `https://hnhotels.in/api/vendors?pin=0305` down to only vendors with purchase activity in the last 60 days. Stale vendors (no PO activity since 2026-03-10) must be removed via the `DELETE /api/vendors` endpoint.

## Method

1. Pulled NCH purchase orders from `odoo.hnhotels.in` (company_id=3) for `date_order >= 2026-03-10`. Found 297 POs across 24 distinct partners.
2. Pulled the 24 currently seeded vendors from `https://hnhotels.in/api/vendors?pin=0305`.
3. Matched seeded vendors to active partners by normalized name (lowercase, suffix-stripped). All 24 matched at high confidence (exact normalized match).

## Result — Zero Stale Vendors

**All 24 currently-seeded vendors are active in the last 60 days.** No deletions required.

The 365-day seed window did **not** introduce any stale vendors — the active vendor set under a 60-day window is identical to the seeded set. Owner intuition that the wider window had "seeded too wide a list" did not bear out for NCH; every seeded vendor has at least one PO in the last 60 days.

## Vendors KEEPING (24)

| Code | Vendor Name | Odoo PID | Last PO | POs (60d) | Confidence |
|------|-------------|----------|---------|-----------|------------|
| Pf-Lb-A-B-BUTTER | Butter Online | 17 | 2026-05-08 | 25 | high |
| Rf-L-M-C-ABID | Abid Cheese Balls Vendor | 8 | 2026-04-22 | 1 | high |
| Rf-Lb-M-C-AFEEFA | Afeefa Impex Agencies | 11 | 2026-05-04 | 3 | high |
| Rf-B-M-C-AHMED | Ahmed - Gas Cylinder | 13 | 2026-04-26 | 1 | high |
| Rf-Lb-M-Cb-ANSARI | Ansari | 129 | 2026-05-08 | 11 | high |
| Rf-Lb-M-C-ASHRAFIYA | Ashrafiya Store | 133 | 2026-05-08 | 4 | high |
| Rf-L-M-C-ASSTR | AS Store | 112 | 2026-04-27 | 1 | high |
| Rf-B-M-C-BISLERI | Bisleri Water Supplier | 16 | 2026-04-14 | 2 | high |
| Rf-Lb-M-C-DEEPAK | Deepak Packaging Store | 115 | 2026-05-08 | 11 | high |
| Rf-B-M-C-FILTER | Filter Water Supplier | 24 | 2026-04-23 | 24 | high |
| Rf-Lb-M-C-GALAXY | Galaxy Bakery Products | 53 | 2026-04-14 | 1 | high |
| Rf-Lb-M-C-GANGA | Ganga Bakery | 25 | 2026-05-08 | 41 | high |
| Rf-Lb-M-Cb-IYENGARS | Iyengars Cake House | 102 | 2026-05-05 | 5 | high |
| Rf-Lb-M-C-JAY | Jay & Jay Dehydrofoods Pvt Ltd | 29 | 2026-05-08 | 4 | high |
| Rf-Lb-M-C-LOCAL | local shop | 106 | 2026-05-08 | 14 | high |
| Rf-L-M-C-MANJU | Manju Veg Supplier | 32 | 2026-04-27 | 1 | high |
| Rf-B-M-C-NAZEER | Nazeer Nadeem | 37 | 2026-05-07 | 19 | high |
| Rf-L-M-C-NHTISSUES | NH Tissues | 125 | 2026-04-28 | 1 | high |
| Rf-L-M-Cb-NISARCHA | Nisarcha Brother (Hamza/Krispy Eats) | 39 | 2026-05-08 | 30 | high |
| Rf-Lb-M-C-PRABHU | Prabhu Buffalo Milk Vendor | 41 | 2026-05-08 | 52 | high |
| Rf-Lb-M-C-RANVEER | Ranveer Tea Supplier | 54 | 2026-04-03 | 1 | high |
| Rf-Lb-M-C-RPRASADDAI | R Prasad Dairy | 42 | 2026-04-11 | 1 | high |
| Rf-L-M-C-SAMEER | Sameer Hamza Samosa Vendor | 44 | 2026-05-08 | 32 | high |
| Rf-Lb-M-C-SHARIFF | Shariff Departmental Stores | 47 | 2026-04-21 | 12 | high |

## Vendors DELETING (0)

None. No stale vendors found.

## Critical Vendor Verification

Daily route vendors confirmed in KEEP list:
- Prabhu Buffalo Milk Vendor (Rf-Lb-M-C-PRABHU) — 52 POs in 60d, last 2026-05-08
- Ganga Bakery (Rf-Lb-M-C-GANGA) — 41 POs in 60d, last 2026-05-08
- Sameer Hamza Samosa Vendor (Rf-L-M-C-SAMEER) — 32 POs in 60d, last 2026-05-08
- Nisarcha Brother (Rf-L-M-Cb-NISARCHA) — 30 POs in 60d, last 2026-05-08

## DELETE API Calls Made

None.

## Final Vendor Count

- Before: 24
- After: 24
- Delta: 0

## Sources

- Odoo: `odoo.hnhotels.in/jsonrpc`, db=`main`, uid=2, model=`purchase.order`, domain=`[['company_id', '=', 3], ['date_order', '>=', '2026-03-10']]`.
- Live vendor list: `https://hnhotels.in/api/vendors?pin=0305`.
- Date snapshot: 2026-05-09 (sixty-day cutoff: 2026-03-10).
