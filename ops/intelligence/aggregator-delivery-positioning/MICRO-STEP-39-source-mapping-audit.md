# Micro-Step 39 - Source Mapping Audit

**Date:** 2026-05-15  
**Scope:** Audit whether Micro-Step 38 missed context while mapping HE POS SKUs against Swiggy demand and Zomato MG Road rank-price data.  
**Portal action:** None.

## Verdict

No fatal break was found in the main volume spine: the top commercial items still align around biryani, boneless biryani, ghee rice, fried rice, kabab, tandoor, rolls, breads, and gravies. The audit did find three context-collapse risks and corrected them before this file was finalized: Swiggy `ITEM_SALES_COUNT`/`AOV` is now visible, Swiggy source taxonomy is now visible, and direct-name rows with large Swiggy/Zomato price contradiction are no longer allowed to pass as automatically ready.

The remaining blindspots are decision gates, not missing files: portion equivalence, combo equivalence, weak/no external evidence rows, and Zomato average-price skew. These rows are now marked through `execution_mapping_gate` so they cannot silently enter the final price/offer layer.

## Source Audit

| Source | Rows / coverage | What the source means | How it is used now |
|---|---:|---|---|
| HE POS / Odoo | 170 active saleable SKUs | The menu universe we can actually sell today. POS price is tax-base, so the table also estimates customer price with 5% GST. | Base SKU list. Every mapped recommendation must anchor here unless it is explicitly a new SKU/portion opportunity. |
| Swiggy DATA.xlsx | 4787 raw rows; 3354 Central Bangalore rows; 3,216 grouped item-price-taxonomy rows | Local demand evidence. `ORD_COUNT` = order-volume signal; `ITEM_SALES_COUNT` = units/quantity signal; `AOV` = cart context; cuisine/category fields protect against wrong SKU/portion mapping. | Primary order-volume and price evidence, now with orders, units, AOV, cuisine, dish family, item category, combo flag, and veg flag preserved. |
| Zomato MG Road workbook | 183 rows, all MG Road | Rank evidence, not exact order count. `Avg Price` can include high-ticket variants, so it is not blindly treated as mode price. | Popularity/rank confirmation and price cross-check using rank-adjusted lower percentile logic. |

## Coverage Counts

- Direct equivalent rows without price-divergence gate: **8**.
- Direct-name rows now forced to price-divergence review: **28**.
- Higher-pay-price-supported but portion review needed: **56**.
- Usable with operator review: **30**.
- Portion/offer gate required because market pay price is below POS: **9**.
- Weak/no external context rows that must not set final pricing: **39**.
- Current Zomato menu exact-ish match coverage: **107/170** POS SKUs.
- Current Swiggy workbook exact-ish match coverage: **85/170** POS SKUs.

## Confidence Matrix

| Swiggy confidence | Zomato confidence | Rows |
|---|---|---:|
| HIGH | HIGH | 54 |
| HIGH | LOW | 7 |
| HIGH | MEDIUM | 30 |
| HIGH | WEAK | 7 |
| LOW | LOW | 3 |
| LOW | WEAK | 12 |
| MEDIUM | HIGH | 1 |
| MEDIUM | LOW | 5 |
| MEDIUM | MEDIUM | 25 |
| MEDIUM | WEAK | 2 |
| WEAK | WEAK | 24 |


## What Was Missed And Corrected

1. **Swiggy units and AOV were not visible enough.** This mattered because breads, rice, and add-ons can have high units per order. The source map now includes `swiggy_best_match_units` and `swiggy_best_match_aov`.
2. **Swiggy taxonomy was not visible enough.** This mattered because an item with the same words can be a combo, dry starter, gravy, roll, or bread. The source map now carries `swiggy_cg_cuisine`, `swiggy_dish_family`, `swiggy_primary_cuisine`, `swiggy_item_category`, `swiggy_is_combo`, and `swiggy_veg_flag`.
3. **Direct name match was not enough.** If Swiggy and Zomato price signals diverge by 30%+, the row is now review-gated even when both names match cleanly.

## What Was Not Missed

- The 20% reduction rule is not used as a fixed rule. Price is derived from demand/rank evidence first; discount percentage comes later as a mechanism to reach the target customer-paying price.
- Zomato `Avg Price` is not treated as the exact high-volume price. Zomato rank decides popularity; price is adjusted downward when only similar-family evidence exists.
- POS is treated as the source menu, while current Swiggy/Zomato workbooks are treated as current-platform context, not the canonical SKU universe.

## Remaining Blindspots Before Final Output

- **Portion equivalence:** high-volume market rows may represent full, half, box, bowl, or combo cards. Rows with higher supported pay price or below-POS market pay price must be checked before portal changes.
- **Zomato has no item order count:** it gives rank, not count. It is strong for ordering the priority list, weaker for exact price.
- **Weak family rows:** `other` and low-confidence rows should not be touched in the first commercial rollout.
- **Combo mechanics:** Swiggy `IS_COMBO` is blank in the source, so combo detection depends on item text and dish/category fields.
- **Current live portal drift:** before final upload, the high-volume pilot rows need portal evidence to confirm current card name, portion, base price, and active offer mechanics.

## P0 Rows To Review Before Offer Math

| Rank | POS SKU | Gate / issue | Swiggy evidence | Zomato evidence | Derived pay |
|---:|---|---|---|---|---:|
| 3 | Ghee Rice | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | ghee rice (336 orders, 514 units, ₹110.0) | ghee rice (rank 1, ₹159.0) | ₹129 |
| 5 | Mutton Biryani | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | mutton biryani (238 orders, 352 units, ₹490.0) | mutton biryani (rank 3, ₹340.0) | ₹429 |
| 8 | Kalmi Kabab | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | kalmi kabab (4 pieces) (68 orders, 74 units, ₹385.0) | kalmi kabab (rank 4, ₹64.0) | ₹269 |
| 10 | Roomali Roti | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | rumali roti (56 orders, 231 units, ₹25.0) | rumali roti (rank 5, ₹38.0) | ₹29 |
| 12 | Tandoori Chicken | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | tandoori chicken (48 orders, 52 units, ₹155.0) | tandoori chicken (rank 7, ₹283.0) | ₹199 |
| 15 | Tandoori Chicken Masala | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | chicken tandoori masala (22 orders, 22 units, ₹189.0) | tandoori chicken (rank 7, ₹283.0) | ₹199 |
| 18 | Chicken Zinger Roll | PORTION_OR_OFFER_GATE_REQUIRED | chicken roll (114 orders, 161 units, ₹130.0) | chicken roll (rank 15, ₹137.0) | ₹129 |
| 22 | Mutton Masala | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | mutton masala (1 orders, 1 units, ₹479.0) | mutton masala (rank 13, ₹335.0) | ₹429 |
| 24 | Chicken Biryani + 2pc Kabab | HIGHER_PAY_PRICE_SUPPORTED_REVIEW_PORTION <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | biryani rice + chicken kabab (1 orders, 1 units, ₹219.0) | boneless chicken biryani + 2 pieces kebab + coke [250 ml] (rank 3, ₹335.0) | ₹319 |
| 25 | Garlic Kabab | HIGHER_PAY_PRICE_SUPPORTED_REVIEW_PORTION <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | kalmi kebab (17 orders, 17 units, ₹165.0) | kalmi kabab (rank 4, ₹64.0) | ₹299 |
| 26 | Irani Chicken | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | chicken 65 (294 orders, 317 units, ₹375.0) | chicken 65 (rank 28, ₹292.0) | ₹329 |
| 27 | Lemon Chicken | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | lemon chicken (194 orders, 204 units, ₹375.0) | chicken 65 (rank 28, ₹292.0) | ₹349 |
| 28 | Prawns Chilly Manchurian | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | prawns chilly (2 orders, 2 units, ₹180.0) | prawns manchurian (rank 13, ₹330.0) | ₹229 |
| 29 | Shezwan Chicken | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | chicken 65 (294 orders, 317 units, ₹375.0) | chicken 65 (rank 28, ₹292.0) | ₹329 |
| 31 | Hongkong Chicken | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | chicken 65 (294 orders, 317 units, ₹375.0) | chicken 65 (rank 28, ₹292.0) | ₹329 |
| 32 | Paneer Mutter Masala | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | paneer mutter masala (3 orders, 3 units, ₹140.0) | paneer butter masala (rank 13, ₹250.0) | ₹179 |
| 33 | Kulcha | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | kulcha (27 orders, 48 units, ₹70.0) | kulcha (rank 23, ₹39.0) | ₹59 |
| 35 | Shawarma Roll | DIRECT_EQUIVALENT_PRICE_DIVERGENCE_REVIEW <br> SWIGGY_ZOMATO_PRICE_DIVERGENCE_GE_30PCT | chicken shawarma roll (2 orders, 3 units, ₹150.0) | shawarma roll (rank 19, ₹105.0) | ₹199 |


## Output Files

- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-38-pos-sku-volume-price-map.csv` - regenerated source map with the added Swiggy context and execution gates.
- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-39-source-coverage-audit.csv` - source-level coverage and distribution audit.
- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-39-mapping-risk-register.csv` - row-level risk register for mappings that should not flow blindly into final pricing.
- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-39-context-missed-corrections.csv` - exact context-collapse checks and corrections made in this audit.

## Final Read

The execution is now safe to proceed into the offer/pricing layer only if we respect the gates. The intelligence is not "do not run offers". The correct read is: use the target customer-paying price from the volume map, then choose the smartest base price + mandatory offer structure to make the customer feel they are getting the best deal while keeping the SKU positioned where local demand already exists.
