# NCH Vendor Coverage Audit

**Date:** 2026-05-09  
**Source:** odoo.hnhotels.in (company_id=3) — last 365d  
**Production:** https://hnhotels.in/api/vendors + /api/rm-sourcing (read-only)  

Pure read-only audit. NO writes performed to Odoo or to /api/vendors.

## 1. Headline counts

```
Total RMs:                         55
  ✅ Has seeded vendor as supplier  21
  🟡 Partially covered              0    (some suppliers seeded, others not)
  ⚠️  Has Odoo vendor, NOT seeded    0    ← GAPS
  ❌ Dormant / no PO in 365d        34

Vendors active in Odoo (365d):     24
  matched to seeded                 24
  NOT seeded (THE GAP)              0
Vendors currently seeded:          24
  active in Odoo                    24
  orphan (no PO in 365d)            0
```

## 2. Per-RM mapping

| RM Code | RM Name | Status | Suppliers (PO count) | Notes |
|---|---|---|---|---|
| `HN-AM-O-B-LPG` | LPG | ✅ covered | Ahmed - Gas Cylinder (1 ✓seeded) | fully covered |
| `HN-AM-P-B-SOD` | Soda | ✅ covered | Ashrafiya Store (2 ✓seeded) | fully covered |
| `HN-AM-P-Bl-BTR` | Butter | ✅ covered | Butter Online (25 ✓seeded)<br/>Ansari (11 ✓seeded)<br/>local shop (5 ✓seeded)<br/>Ashrafiya Store (1 ✓seeded)<br/>Deepak Packaging Store (1 ✓seeded) | fully covered |
| `HN-AM-P-L-CHL` | Charcoal | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `HN-AM-P-L-GIN` | Ginger | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `HN-AM-P-Lb-ALM` | Almonds | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `HN-AM-P-Lb-CAR` | Cardamom | ✅ covered | Ashrafiya Store (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-CUS` | Custard Powder | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `HN-AM-P-Lb-KAJ` | Kaju | ✅ covered | Ashrafiya Store (1 ✓seeded)<br/>Shariff Departmental Stores (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-MDA` | Maida | ✅ covered | Ashrafiya Store (2 ✓seeded)<br/>Shariff Departmental Stores (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-OIL` | Oil | ✅ covered | Shariff Departmental Stores (2 ✓seeded)<br/>Ashrafiya Store (1 ✓seeded)<br/>Deepak Packaging Store (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-SAU` | Saunf | ✅ covered | Ashrafiya Store (2 ✓seeded)<br/>Shariff Departmental Stores (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-SOJ` | Sooji | ✅ covered | Ashrafiya Store (2 ✓seeded)<br/>Shariff Departmental Stores (1 ✓seeded) | fully covered |
| `HN-AM-P-Lb-SUG` | Sugar | ✅ covered | Shariff Departmental Stores (6 ✓seeded)<br/>Ashrafiya Store (2 ✓seeded) | fully covered |
| `NCH-AM-P-B-CHC` | Chocolate Powder | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AM-P-B-MMD` | Milkmaid | ✅ covered | Shariff Departmental Stores (3 ✓seeded)<br/>Ashrafiya Store (1 ✓seeded)<br/>AS Store (1 ✓seeded) | fully covered |
| `NCH-AM-P-B-WTR` | Bottled Water | ✅ covered | Filter Water Supplier (24 ✓seeded)<br/>Nazeer Nadeem (19 ✓seeded)<br/>Bisleri Water Supplier (2 ✓seeded) | fully covered |
| `NCH-AM-P-Bl-SMP` | Skimmed Milk Powder | ✅ covered | Jay & Jay Dehydrofoods Pvt Ltd (4 ✓seeded) | fully covered |
| `NCH-AM-P-L-SBJ` | Sabja | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AM-P-Lb-BDM` | Badam Powder | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AM-P-Lb-MLK` | Buffalo Milk | ✅ covered | Prabhu Buffalo Milk Vendor (52 ✓seeded)<br/>local shop (1 ✓seeded)<br/>R Prasad Dairy (1 ✓seeded) | fully covered |
| `NCH-AM-P-Lb-SAF` | Saffron | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AM-Pr-Bl-TEA` | Tea Powder | ✅ covered | Afeefa Impex Agencies (3 ✓seeded)<br/>Ranveer Tea Supplier (1 ✓seeded) | fully covered |
| `NCH-AS-P-B-BST` | Boost | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-B-HRK` | Horlicks | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-B-JAM` | Jam | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-B-NUT` | Nutella | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-Lb-HNY` | Honey | ✅ covered | Shariff Departmental Stores (1 ✓seeded) | fully covered |
| `NCH-AS-P-Lb-PMK` | Pumpkin Seeds | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-Lbi-BUN` | Bun | ✅ covered | Ganga Bakery (41 ✓seeded)<br/>Iyengars Cake House (4 ✓seeded)<br/>local shop (3 ✓seeded) | fully covered |
| `NCH-AS-P-Li-CCT` | Chicken Cutlet Raw | ✅ covered | Nisarcha Brother (Hamza/Krispy Eats) (30 ✓seeded) | fully covered |
| `NCH-AS-P-Li-CHB` | Chicken Bites Raw | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-AS-P-Li-SMS` | Samosa Raw | ✅ covered | Sameer Hamza Samosa Vendor (32 ✓seeded)<br/>local shop (2 ✓seeded)<br/>Abid Cheese Balls Vendor (1 ✓seeded) | fully covered |
| `NCH-DM-Pr-Bl-OSB` | Osmania Biscuit | ✅ covered | Galaxy Bakery Products (1 ✓seeded) | fully covered |
| `NCH-DM-R-B-BAC` | Butter Almond Cookies | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-CCO` | Choco Chips Osmania Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-DCC` | Double Choco Chip Cookies | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-DFB` | Dry Fruit Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-FRB` | Fruit Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-HOB` | Honey Oats Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-MGB` | Multi Grain Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-MMB` | Melting Moment Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-RPL` | Round Plum | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DM-R-B-SLB` | Salt Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-P-B-CPP` | Coffee Pouch | ✅ covered | Ashrafiya Store (1 ✓seeded) | fully covered |
| `NCH-DS-R-B-ACG` | Assorted Cookies Gift Pack | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-AST` | Almond Sticks | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-ATB` | 100% Atta Biscuit (No Added Sugar) | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-CHK` | Cherry Khopra | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-COB` | Coconut Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-DKR` | Dum Ka Roat | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-MGR` | Multi Grain Ragi Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-OMC` | Oatmeal Cookies (No Added Sugar) | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-PLM` | Palmiers | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |
| `NCH-DS-R-B-RGB` | Ragi Biscuit | ❌ dormant | _no PO activity in 365d_ | expected for seasonal/low-volume RMs |

## 3. Missing vendor list — THE GAP

0 vendors have NCH PO activity in 365d but are NOT in the seeded set. Proposed canonical codes (v7 grammar) below — owner adds via UI after v8 grammar lands.

| # | Proposed Code | Vendor Name | POs / Bills / Total | Supplies | Confidence | Unmapped products |
|---|---|---|---|---|---|---|

## 4. Orphan seeded vendors (no PO activity in 365d)

_None — all seeded vendors have recent PO activity._

## 5. Recommendations

### Priority of vendor additions

Confidence breakdown of missing vendors: HIGH 0 · MEDIUM 0 · LOW 0

Suggested order:

1. **HIGH confidence** — quick-commerce / app vendors with unambiguous PMS=B grammar. Safe to seed in bulk.
2. **MEDIUM confidence** — traditional vendors with clear RM coverage; PMS=C is best guess (owner confirms UPI capability when convenient).
3. **LOW confidence** — vendors with no clear RM mapping (their products did not match any name rule); owner inspects unmapped products to decide whether RM rules need extending or vendor is misc/one-off.

### Whether any seeded vendors should be deleted (orphans)

No deletions needed — every seeded vendor has recent PO activity.

### Confidence overview

- **Coverage rate:** 21 of 55 RMs (38%) have at least one seeded supplier.
- **Gap rate:** 0 RMs (0%) have purchase activity but no seeded supplier.
- **Dormant rate:** 34 RMs (62%) have zero purchase activity in 365d — expected for seasonal/specialty items.

---

Generated by `scripts/vendor-coverage-audit.js` (read-only).