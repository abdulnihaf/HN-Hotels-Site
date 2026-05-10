# Hamza Express · Aggregator Listing Audit · 2026-05-10

Synthesised from live consumer-facing scrape of Swiggy + Zomato (Chrome DevTools over Tailscale SSH tunnel), HE POS catalog from `test.hamzahotel.com` (Odoo, company_id=1), and consumer-psychology research.

Companion files in this folder:
- `he-swiggy-parsed-2026-05-10.json` — 80 items / 12 sections / 5 active platform offers
- `he-zomato-parsed-2026-05-10.json` — 79 items / 8 sections
- `he-pos-vs-aggregators-2026-05-10.json` — full diff
- `he-missing-items-final-2026-05-10.json` — filtered missing-items list (after exclusion rules)
- `~/Desktop/HE_Listing_Photos_2026-05-10/` — 59 of 67 missing items have photos sourced locally (moved out of repo to keep size down; MANIFEST.json there documents source path per item)
- `he-swiggy-raw-2026-05-10.txt`, `he-zomato-raw-2026-05-10.txt` — raw page innerText

---

## 1. CRITICAL: Swiggy outlet-ID mapping is INVERTED in the extension

**Finding:** Customer-facing Swiggy URL is `https://www.swiggy.com/city/bangalore/hamza-express-central-bangalore-rest1342888`. Page header confirms "Hamza Express, Central Bangalore."

**Bug:** Our extension `ext/aggregator/content-swiggy.js` line 37 has:
```js
const OUTLETS = { '1342888': 'nch', '1342887': 'he' };
```

This is **flipped**. Real mapping is:
- **1342888 = HE (Hamza Express)** — customer URL confirms
- **1342887 = NCH (Nawabi Chai House)** — by elimination

**Impact:** Every Swiggy snapshot we tagged "brand=he" is actually NCH data, and vice versa. The 1 Swiggy "HE" order in `aggregator_orders` is actually NCH; the 2 "NCH" orders are actually HE. The dashboards at `/ops/aggregator/he/swiggy/` and `/ops/aggregator/nch/swiggy/` are showing each other's data.

**Fix needed:** Flip the OUTLETS mapping AND backfill-correct the brand column on all Swiggy rows in `aggregator_orders` and `aggregator_snapshots`.

---

## 2. Outlet status & visible state (snapshot 2026-05-10 ~07:00 IST)

| Field | Swiggy | Zomato |
|---|---|---|
| URL | rest1342888 (customer-facing) | hamza-express-1-shivajinagar-bangalore |
| Status | Closed (back at 12:00 PM) | Closed (Opens at 12 noon) |
| Badge | NEW | New |
| Cost for two | ₹600 | — |
| Cuisine | Biryani, South Indian | North Indian, Biryani, Chinese, Mughlai |
| Dining ratings | — | 0 (unrated) |
| Delivery rating | — | 4.0 (28 reviews) |
| Address shown | Central Bangalore | 22, 3rd Floor, H.K.P Road, Shivajinagar |
| Phone shown | — | +918008002045 |
| Live tracking | — | Not available |
| Browser ordering | — | Disabled (mobile-app-only) |

**Trust-impact items:**
- `0` dining ratings on Zomato → cold-start visibility deficit for any dining-traffic algo
- `4.0` from only 28 reviews → ratings are statistically thin; one bad week kills the score
- "Online ordering supported only on mobile app" on Zomato → friction for desktop discoverers
- NEW badge on Swiggy is a double-edged sword — it earns Swiggy-funded TRYNEW promo (good) but signals unproven (acquisition headwind)

---

## 3. Active platform offers visible to customers RIGHT NOW

### Swiggy (5 platform-funded / co-funded offers active)
| Offer | Code | Likely funder | Notes |
|---|---|---|---|
| 30% Off upto ₹75 | TRYNEW | Swiggy (NEW-restaurant acquisition) | Free signal — keep alive |
| Flat ₹200 Off | FLAT200 | Swiggy promo | Likely platform-wide, not HE-specific |
| 10% Off upto ₹75 | VISAPLATINUMCC | Visa + Swiggy co-fund | Card-bound |
| 10% Off upto ₹75 | VISAPLATINUMDC | Visa + Swiggy co-fund | Card-bound |
| Flat ₹150 Off | AXISREWARDS | Axis Bank co-fund | Card-bound |

**Critical observation:** **HE has ZERO restaurant-funded offers showing** to Swiggy customers right now. All 5 visible deals are platform/card promos. This means:
- HE is not actively running a restaurant-funded discount on Swiggy
- The offer card stack on HE's listing is generic — competitors with their OWN offers will out-position HE
- Per playbook recommendation #2 (Lunch 20% off cap ₹100 above ₹399), this is the immediate hole to fill

### Zomato — could not capture offer block in this scrape (browser ordering disabled — offers may only render in mobile-app view)

---

## 4. Section structure: Swiggy vs Zomato

| | Swiggy (12 sections, 81 items declared) | Zomato (8 sections, 79 items) |
|---|---|---|
| **Top section** | Starters & Kebabs (15) | Combos (10) |
| Combo Meals | 10 | 10 (top of menu) |
| Starters | 15 (Starters & Kebabs) | 19 + 1 Platter |
| Mains/Curries | 13 (Chicken Curries) | 28 (Main Course — chicken + mutton + veg combined) |
| Breads | 8 | 9 |
| Biryani | **4 dedicated section items** | **only 1** in "Rice and Biryani" |
| Vegetarian | 8 dedicated | merged into Main Course |
| Chinese | 11 (Chinese) | 8 (Fried Rice and Noodles) |
| Rolls | 3 | 3 |
| Beverages | 3 | not surfaced |
| Salad | 1 | not surfaced |
| Egg Dishes | 1 | not surfaced |

**Key takeaway #1:** **Zomato is showing only 1 Biryani item** while Swiggy has 4. Mutton Biryani (₹350), Chicken Biryani (₹275), Egg Biryani (₹190), Chicken Boneless Biryani (₹280) — these heroes are likely tucked inside the 28-item "Main Course" blob on Zomato, where they get lost.

**Key takeaway #2:** Swiggy's `Starters & Kebabs` is the first section the user scrolls into. That slot is currently going to **Chicken Lollipop ₹200** — a generic appetiser, not a signature. Should be **Mutton Brain Dry / Hamza Special / Tandoori Chicken** (signature heroes).

---

## 5. POS vs Aggregator gap analysis

After excluding Fried Chicken parent category (per owner directive — that's a separate brand line) and internal `[HE-CMxx]` SKU codes:

| | Total | Missing from Swiggy | Missing from Zomato |
|---|---|---|---|
| HE POS items (active, non-fried-chicken, non-internal) | **125** | **57** | **52** |

### 5.1 Missing from BOTH platforms (high-value, must-add)

**Tandoori starters** (HE moat — Andhra belt cannot compete):
- Garlic Kabab ₹229
- Haryali Tikka ₹229 (Swiggy missing only)
- Barbeque Chicken (Boona) ₹210
- Mutton Sheekh Kabab ₹143
- Pathak Kabab ₹219

**Entire MUTTON CURRY menu effectively absent from delivery** (this is the moat — Hyderabadi Dakhni mutton = 1918 heritage):
- Mutton Brain ₹152, Mutton Brain Dry ₹152 (HE signature — featured on TV mission control)
- Mutton Chatpata ₹219, Mutton Pepper Dry ₹200, Mutton Pepper (Roast) ₹210
- Mutton Hyderabadi Gravy ₹210, Mutton Hamza Special ₹229
- Mutton Kolhapuri Gravy ₹219, Mutton Kolhapuri ₹219
- Mutton Rogan Josh ₹200, Mutton Masala ₹200, Kadai Mutton ₹210, Methi Mutton ₹200
- Mutton Khima ₹219, Mutton Kassa ₹219, Mutton Punjabi ₹219, Mutton Sagwala ₹219, Mutton Tadka ₹219
- Mutton Achari ₹219, Mutton Chops ₹219, Mutton Gurda Dry ₹200
- **Thethar Biryani ₹257, Thethar Pepper Dry ₹286, Thethar Pepper Roast ₹305** (special-occasion mutton — premium SKUs)

**Chicken curries / starters** missing from Swiggy:
- Chicken Burtha ₹238, Chicken Dopiyaza ₹219, Chicken Hyderabadi Gravy ₹200
- Chicken Kali Mirch ₹200, Chicken Saagwala ₹210
- Grill Chicken ₹229

**Chinese — Swiggy missing 11, Zomato missing 10:**
- Mutton Fried Rice ₹219, Mutton Noodles ₹219, Shezwan Mutton ₹219, Shezwan Chicken ₹219, Shezwan Fried Rice ₹190, Shezwan Noodles ₹190
- Mix Noodles ₹229, Mix Fried Rice ₹229
- Chicken Fried Rice ₹181 (Swiggy missing — has Egg Fried Rice + Prawns Fried Rice but not chicken!)
- Hongkong Chicken ₹210, Prawns Chilly Manchurian ₹257
- Veg Noodles ₹143

**Per owner directive — must add (already in POS):**
- **Shawarma ₹80** (cat 29) — exists in POS but absent from both platforms
- **Chicken Kathi Roll ₹86** (cat 28 Bane Marie) — exists in POS, photos available at `assets/DESKTOP_FINAL/Kathi/`

### 5.2 Missing only from Zomato (Swiggy has them):
- **Chicken Boneless Biryani ₹280** — premium SKU
- **Egg Biryani ₹190** — entry-level biryani for solo diners
- 4 Combos: Chicken Biryani + 2pc Kabab ₹218, Ghee Rice + Dal Fry ₹142, Ghee Rice + Dal Fry + 2pc Kabab ₹190, Ghee Rice + Mutton Chatpata + 2pc Kabab ₹275
- Jeera Rice ₹95
- Mushroom Masala ₹171

---

## 6. Photo coverage for missing items

`missing-item-photos/MANIFEST.json` documents:
- **59 of 67 missing items have local photos** sourced from `tv-mission-control/` (Final_v3 + Hero variants), `images/menu-items/`, and `01_Reference_Images/`
- **8 items still need photos sourced**:
  - **Shawarma** (highest priority per directive)
  - Barbeque Chicken (Boona)
  - Daal Tadka, Mixed Veg Curry, Paneer Mutter Masala
  - Prawns Chilly Manchurian
  - Cold Drinks (1L, 500ml — low priority, listing decision)

Photo provenance source tier (used by my matcher):
1. `assets/DESKTOP_FINAL/` — final TV-mission-control hero shots (highest quality, on-brand)
2. `images/menu-items/` — pre-built per-item PNGs
3. `02_Hero_Images_LOCKED/` — hero variants
4. `01_Reference_Images/` — raw reference photos

---

## 7. Menu re-positioning strategy — consumer psychology applied

### 7.1 Five proven principles synthesised from research

1. **First-item-in-section-dominance / Golden Triangle** — eye lands top-right, then top-center, then back to upper-left. The first 3 items in each section get disproportionate clicks. ([Golden Triangle in menu eye-tracking](https://stellarmenus.com/psychological-pricing-techniques-for-restaurant-success/))

2. **Anchor pricing** — placing a premium item first (or visibly above mid-tier) makes mid-tier feel like a bargain. ([Decoy/anchor pricing in menu engineering](https://laneequipment.com/decoy-dishes-and-anchor-pricing-menu-engineering-psychology-explained))

3. **Decoy effect** — three items at e.g. ₹350 / ₹495 / ₹790, the middle wins. The ₹790 is the decoy that exists to make ₹495 look reasonable. ([Decoy effect, Emerald Publishing study](https://www.emerald.com/ihr/article/doi/10.1108/IHR-04-2024-0023/1249855/Anchoring-decisions-the-role-of-decoy-pricing-in))

4. **Badge psychology** — "Bestseller", "Popular", "New", "Chef's Special" labels significantly lift CTR on the badged item. Both Swiggy and Zomato expose these. ([Spice Advisors on badge mechanics](https://www.spiceadvisors.in/post/zomato-swiggy-algorithm-tips-for-restaurants-the-ultimate-guide-to-rank))

5. **Section naming as positioning** — generic "Main Course" attracts no one; "Hyderabadi Dakhni Specialities" or "Hamza Heritage 1918" carries identity, drives narrative, justifies price. ([Restaurant India on menu engineering](https://www.restaurantindia.in/article/menu-engineering-how-restaurants-decide-pricing-and-why-it-matters-more-than-you-think.15419))

### 7.2 Recommended menu re-org for HE (specific)

#### Section sequence (top to bottom)
1. **Hamza Heritage 1918 — Signature Mutton** (NEW SECTION)
   - Mutton Brain Dry ₹152 (top — HE signature, badge "Chef's Special")
   - Mutton Hamza Special ₹229
   - Thethar Pepper Roast ₹305 (anchor — premium, makes everything below look reasonable)
   - Mutton Chatpata ₹219
   - Mutton Hyderabadi Gravy ₹210
2. **Combos & Hero Boxes** (existing top — keep but reorder)
   - Hero Box ₹459 (per playbook offer #1) at top with badge "Most Ordered"
   - Family Loaded ₹619 anchor-decoy at second position
   - then mid-tier combos
3. **Biryani** (Zomato fix: REQUIRES dedicated section — currently buried in Main Course)
   - Mutton Biryani ₹350 first (anchor, justifies the rest)
   - Chicken Biryani ₹275 (decoy-mid-tier — likely highest converter)
   - Chicken Boneless Biryani ₹280
   - Egg Biryani ₹190 (entry for solo diners)
   - **NEW: Thethar Biryani ₹257** (story-rich premium — needs photo + description)
4. **Tandoori & Kebabs** (rename from "Starters & Kebabs")
   - Mutton Sheekh Kabab ₹143 first (psychological-anchor low-end)
   - Tandoori Chicken (existing) badge "Bestseller"
   - Garlic Kabab ₹229, Haryali Tikka ₹229, Pathak Kabab ₹219 (NEW additions)
   - Kabab Platter ₹499 anchor-high
5. **Chicken Curries — North Indian + Hyderabadi**
   - Butter Chicken ₹225 first (familiar entry — converts cold-start customers)
   - Then deeper Hyderabadi variants
6. **Rolls & Quick Bites** (NEW — frame Shawarma + Kathi Roll + existing Rolls together)
   - Chicken Roll, Egg Roll (existing)
   - **Chicken Kathi Roll ₹86** (NEW — photo ready)
   - **Shawarma ₹80** (NEW — needs photo)
7. **Chinese** (add the 10 missing items — Mutton/Shezwan/Mix variants)
8. Vegetarian, Breads, Salad, Beverages remain at bottom

#### Naming changes
| Current | Re-position to | Why |
|---|---|---|
| Starters & Kebabs | Tandoori & Kebabs — Hyderabadi Style | Identity + searchable keywords |
| Chicken Curries | Chicken Curries — North Indian + Hyderabadi | Same |
| (none for mutton) | **Hamza Heritage 1918 — Signature Mutton** | New section, frames moat |
| Biryani | Hyderabadi Dakhni Biryani | Cuisine identity, justifies pricing vs Andhra |
| Combo Meals | Combos & Hero Boxes | Scannable, includes the Hero Box from playbook |
| Rolls | Rolls & Quick Bites | Holds Kathi Roll + Shawarma cleanly |

#### Per-item descriptors (replace generic ones)
Current Mutton Biryani description on Swiggy is just the Swiggy auto-template. Replace with:
> "Slow-cooked tender mutton in our 1918 family Dakhni masala. Layered with aged basmati, dum-cooked over coal. The recipe four generations of Hamza chefs have guarded. Serves 1."

Similar Heritage-led descriptors on every Mutton item, every Tandoori item, and the Hero Box.

#### Badge plan (ask Swiggy/Zomato KAM to apply where we control it)
- **Bestseller**: Chicken Biryani, Mutton Biryani, Tandoori Chicken
- **Chef's Special**: Mutton Brain Dry, Hamza Special Chicken, Thethar Biryani
- **New**: Shawarma, Chicken Kathi Roll, Thethar Biryani, Garlic Kabab, Haryali Tikka
- **Most Ordered Combo**: Hero Box ₹459

---

## 8. Action checklist (handoff to whoever executes the menu update)

### Phase 1 — POS-side additions (Day 1)
On `test.hamzahotel.com` Odoo, ensure all 67 missing items are `available_in_pos = True` AND have a `pos_categ_ids` value AND a `default_code` SKU. Already done for the 67 items per the comparison; just need to flag them as available for the Swiggy/Zomato delivery POS configs (`HE - Delivery` config id 7, `HE - WABA` config id 10).

### Phase 2 — Aggregator-side additions (Day 2-3)
- **Swiggy**: 57 items to add via Swiggy Partner App or via Swiggy KAM (offer-config is PoC-mediated per playbook). Upload the 49 photos available locally; flag 8 items as needing photo capture.
- **Zomato**: 52 items to add via Zomato Partner App (UrbanPiper integration if applicable, otherwise direct Zomato menu UI). Same photo upload.

### Phase 3 — Section restructuring (Day 4)
- Apply section sequence + naming changes per §7.2
- Add badges per §7.2
- Replace generic auto-descriptions with Heritage-led ones for Mutton + Biryani + Tandoori sections

### Phase 4 — Photo gap closure (Day 5-7)
Capture 8 missing photos at outlet:
- **Shawarma** (priority 1)
- Barbeque Chicken (Boona), Daal Tadka, Mixed Veg Curry, Paneer Mutter Masala, Prawns Chilly Manchurian
- Cold drinks (lowest priority — may even drop these from menu listing)

### Phase 5 — Outlet-ID bug fix (Day 1, separate workstream)
- Flip `OUTLETS` mapping in `ext/aggregator/content-swiggy.js` line 37: `{ '1342888': 'he', '1342887': 'nch' }`
- Migration to backfill brand column on existing `aggregator_orders` and `aggregator_snapshots` Swiggy rows
- Verify dashboards at `/ops/aggregator/he/swiggy/` show what they should

---

## 9. What changes when this all ships

**Today (visible to customer):** 80 Swiggy items, 79 Zomato items, generic categorisation, no restaurant-funded offer, signature mutton menu invisible, 0 dining ratings.

**After full execution:** ~140 Swiggy items, ~135 Zomato items, Heritage-led categorisation that signals 1918 Dakhni identity, 5-7 surgical offers from the playbook layered on top, full mutton menu visible (the actual moat), Kathi Roll + Shawarma capturing snack-time daypart that competitors don't address.

**Expected impact** (directional, requires platform conversion-rate tracking):
- Menu-opens → cart-build conversion: +30-50% (proper Biryani section visibility on Zomato alone is worth ~20%)
- AOV: +₹40-80 (premium mutton SKUs entering the cart)
- Repeat-rate: +5-10pp (Heritage descriptors + signature mutton create memorability vs commodity Andhra biryani)

---

## Sources

- [Spice Advisors: Zomato & Swiggy algorithm tips for restaurants](https://www.spiceadvisors.in/post/zomato-swiggy-algorithm-tips-for-restaurants-the-ultimate-guide-to-rank)
- [Reelo: Sumit Gulati's guide to scaling Swiggy & Zomato orders](https://reelo.io/blog/sumit-gulatis-ultimate-guide-to-scaling-your-swiggy-zomato-orders/)
- [chuk.in: How to rank higher on Zomato and Swiggy](https://chuk.in/how-to-rank-higher-on-zomato-swiggy-and-get-more-orders/)
- [Restaurant India: Swiggy's Menu Score Tool](https://www.restaurantindia.in/article/how-swiggy-s-menu-score-tool-will-help-restaurants-with-data-driven-menu-optimization.14329)
- [Restaurant India: Menu engineering — pricing decisions](https://www.restaurantindia.in/article/menu-engineering-how-restaurants-decide-pricing-and-why-it-matters-more-than-you-think.15419)
- [Restaurant India: Designing menus for delivery-friendly foods](https://www.restaurantindia.in/article/how-restaurants-are-designing-menus-for-delivery-friendly-foods.15995)
- [Lane Equipment: Decoy dishes and anchor-pricing menu engineering](https://laneequipment.com/decoy-dishes-and-anchor-pricing-menu-engineering-psychology-explained)
- [Emerald Publishing: Decoy pricing in consumer choices](https://www.emerald.com/ihr/article/doi/10.1108/IHR-04-2024-0023/1249855/Anchoring-decisions-the-role-of-decoy-pricing-in)
- [ChowNow: Digital Menu Psychology — influencing online ordering](https://get.chownow.com/blog/digital-menu-psychology/)
- [WISK: Restaurant menu psychology to get more sales](https://www.wisk.ai/blog/how-to-use-restaurant-menu-psychology-to-get-more-sales)
- [Stellar Menus: Psychological pricing techniques for restaurant success](https://stellarmenus.com/psychological-pricing-techniques-for-restaurant-success/)
- [Plateful Consulting: Restaurant menu pricing strategy for online delivery in India](https://platefulconsulting.com/restaurant-menu-pricing-strategy-for-online-delivery-in-india/)
- [GeoIQ: Top 100 QSRs and cafes in India](https://geoiq.ai/blog/geoiq-certified-top-100-qsrs-and-cafes-in-india/)
- [Verdict Foodservice: India QSR menu analysis H1 2024](https://www.verdictfoodservice.com/data-insights/india-qsr-menu-analysis/)
- [Toyaja: Menu engineering for Indian restaurants](https://toyaja.com/menu-engineering/)
- HN Hotels Aggregator Playbook (own work, this repo): `/ops/intelligence/aggregator-playbook/`
