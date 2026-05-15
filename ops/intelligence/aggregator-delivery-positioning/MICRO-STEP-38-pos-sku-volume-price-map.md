# Micro-Step 38 - POS SKU Volume Price Map

**Date:** 2026-05-15
**Scope:** Extract current HE POS saleable menu and map each SKU to Swiggy volume + Zomato OV-rank price intelligence.
**Portal action:** None.

## Objective

Create the pre-offer SKU intelligence table: POS SKU, closest Swiggy demand match, closest Zomato popularity/rank match, derived customer-paying price point for maximum volume, confidence, and new SKU opportunities.

## Inputs

- HE Odoo POS products read-only: 170 active saleable POS SKUs.
- Swiggy DATA.xlsx Central Bangalore demand items: 3216.
- Zomato MG Road OV rank-price rows: 183.
- Current Zomato menu export rows: 202.

## Method

1. Extract active saleable POS products from HE production Odoo.
2. Convert Odoo tax-base price into estimated POS customer price using 5% restaurant GST.
3. Clean Swiggy demand data to Central Bangalore and rank by order count.
4. Preserve Swiggy item-sales count and AOV as audit context, while using order count as the primary order-volume signal.
5. Treat Zomato OV Rank as popularity/rank signal, not exact order count.
6. Match every POS SKU to similar Swiggy and Zomato items using normalized item tokens, product family, and protein guardrails.
7. Derive a customer-paying volume price by blending Swiggy weighted median price with Zomato rank-adjusted lower percentile price.
8. Do not create offer recommendations yet; this table is the pricing-intelligence base.

## Outputs

- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-38-pos-sku-volume-price-map.csv`
- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-38-new-sku-opportunities.csv`
- `ops/intelligence/aggregator-delivery-positioning/MICRO-STEP-38-pos-sku-volume-price-map.html`

## Top 20 POS SKU Reads

| Rank | POS SKU | Score | Derived Pay Price | Swiggy Match | Zomato Match |
|---:|---|---:|---:|---|---|
| 1 | Chicken Boneless Biryani | 100.0 | ₹369 | chicken boneless biryani | chicken boneless biryani |
| 2 | Chicken Biryani | 70.0 | ₹329 | chicken biryani | chicken biryani |
| 3 | Ghee Rice | 62.76 | ₹129 | ghee rice | ghee rice |
| 4 | Chicken Fried Rice | 62.39 | ₹179 | chicken fried rice | chicken fried rice |
| 5 | Mutton Biryani | 58.03 | ₹429 | mutton biryani | mutton biryani |
| 6 | Chicken Kabab | 57.5 | ₹229 | chicken kabab | chicken kabab |
| 7 | Kerala Paratha | 51.12 | ₹39 | kerala parotta | kerala parotta |
| 8 | Kalmi Kabab | 49.8 | ₹269 | kalmi kabab (4 pieces) | kalmi kabab |
| 9 | Butter Naan | 48.31 | ₹69 | butter naan | butter naan |
| 10 | Roomali Roti | 48.14 | ₹29 | rumali roti | rumali roti |
| 11 | Paneer Butter Masala | 47.36 | ₹269 | paneer butter masala | paneer butter masala |
| 12 | Tandoori Chicken | 45.81 | ₹199 | tandoori chicken | tandoori chicken |
| 13 | Butter Chicken | 43.42 | ₹249 | butter chicken | butter chicken |
| 14 | Chicken Roll | 42.61 | ₹129 | chicken roll | chicken roll |
| 15 | Tandoori Chicken Masala | 42.43 | ₹199 | chicken tandoori masala | tandoori chicken |
| 16 | Chicken Noodles | 41.9 | ₹189 | chicken noodles | chicken noodles |
| 17 | Chicken Kathi Roll | 41.07 | ₹129 | chicken roll | chicken roll |
| 18 | Chicken Zinger Roll | 40.66 | ₹129 | chicken roll | chicken roll |
| 19 | Chicken 65 | 37.79 | ₹349 | chicken 65 | chicken 65 |
| 20 | Chicken Tikka Masala | 37.4 | ₹349 | chicken tikka masala | chicken tikka |

## Core Caveat

This is still pre-offer intelligence. The derived price is the target customer-paying point where volume is likely to happen. The next step is to decide whether each target is achieved by base price, item offer, cart offer, fixed combo, or platform-specific offer mechanics.
