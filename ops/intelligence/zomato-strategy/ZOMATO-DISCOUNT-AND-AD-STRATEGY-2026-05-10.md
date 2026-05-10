# Zomato Discount + Ad Strategy for Hamza Express
**Generated:** 2026-05-10 · **Owner approver:** Nihaf · **Core thesis:** *Discount must drive volume — if it doesn't translate to incremental orders, the unit economics break. Configure the offer SET that lets Zomato's ML auto-segment customers; let the algorithm do price-discrimination work for you.*

---

## Part 1 · How Zomato's algorithms actually work (synthesised from public sources, partner UI ground-truth, and Zomato's own ML blog)

### 1.1 Search & ranking algorithm — what determines where HE shows up

Zomato treats its ranking algorithm as proprietary and won't disclose details, but the signals can be reverse-engineered from partner-side analytics dashboards + restaurant-tech reportage. Confirmed signals (in order of weight):

| Signal | What it means | HE's current state | Lever to pull |
|---|---|---|---|
| **Rating × review-volume product** | A 4.2 with 800 reviews beats a 4.5 with 30. Zomato weights total review count heavily. | 4.0 from 28 reviews · weak | Drive volume → reviews follow |
| **Rating recency (freshness)** | 50 reviews from last month >> 500 reviews from 2 years ago | NEW outlet — fresh by definition, advantage | Stay active to compound |
| **Order completion rate** | % orders accepted + delivered without cancellation | unknown current; cancellation count = 1 of 67 (1.5%) — healthy | Maintain ≤2% rejections |
| **Delivery time accuracy** | Beating estimated delivery time | unknown; Zomato delivers (we don't) | KAM-mediated |
| **Photo quality + quantity** | Hero photo on every menu item | partial — many items photoless | Phase 2 of execution plan |
| **Listing completeness** | Description, cuisine tags, hours, photos, badges | partial — 79 items vs 140 in POS | Phase 2 |
| **Active promotions** | Having offers configured signals "engaged restaurant" | **0 offers running** | This document fixes |
| **Click-through rate** | % of impressions that click through to menu | unknown; trackable in Zomato Reporting | Compound effect of all above |
| **Prep-time accuracy** | Setting realistic prep time (not aggressive) | unknown | KAM-mediated |
| **Paid promotion** | Ads operate as a **separate sponsored layer above organic** — they don't replace organic ranking | not running ads | Section 3 |

**Threshold bands documented:** 4.2+ = AI starts including in "Top Rated" results · 4.0+ = top visibility tiers · <3.5 = organic reach struggles. HE is at 4.0 — borderline, statistically thin.

### 1.2 Customer-segmentation dimensions (what Zomato KNOWS about each user)

Zomato segments by **city, frequency, cuisine affinity, time-of-day, price elasticity, dietary preference, engagement level (at-risk vs loyal), income, age, location.** Reference: Zomato has published that they process ~250M monthly pings to segment users into "at-risk" and "loyal" cohorts for personalised vouchers.

The dimensions we know are USED for offer-surfacing:

1. **Recency cohort** — Confirmed in their Promo Code form schema: `NEW = users who have not ordered from your restaurant in last 90 days`. Other cohorts (likely): `RETURNING_30D`, `LAPSED_60D`, `LAPSED_90D+`, `LOYAL`.
2. **Price elasticity** — derived from a user's historical AOV vs cuisine-category median. Budget-eaters, mid-spenders, high-spenders.
3. **Time-of-day affinity** — when a user typically orders (lunch dominant vs dinner vs late-night).
4. **Cuisine affinity** — whether biryani is a regular for them or a try-something-new occasion.
5. **Geographic radius** — distance from restaurant.
6. **Membership tier** — Zomato Gold members (~5M, drive ~40% of GOV) vs non-members.
7. **Order frequency** — once/year vs once/week.
8. **Dietary preference** — Veg / Non-veg / Egg-OK.

**What Zomato does with this:** ML-personalised push notifications, ML-timed hunger-window pings, lookalike modelling for new-user acquisition.

### 1.3 The "personalised offer" engine — what we BELIEVE happens (and what we know doesn't)

The user's intuition was: "Zomato's algorithm gives 25% to a budget-eater and 10% to a high-AOV customer." Let me clarify the actual mechanism based on the evidence:

**What's NOT true:** Zomato does NOT take a single offer (e.g. "20% off") and dynamically adjust the % shown to different users. The discount % is fixed per offer.

**What IS true:** Zomato's surfacing engine decides **which offer** (out of the active set on the restaurant) to **promote prominently** to which user. So:

- Restaurant configures 3 offers: 30% off on cart >₹599 · 15% off on cart >₹299 · Free Roomali above ₹399
- Zomato's ML ranks customer A (budget-eater): surfaces "15% off above ₹299" prominently → A converts at low AOV
- Zomato's ML ranks customer B (high-spender, family orderer): surfaces "30% off above ₹599" prominently → B converts at high AOV
- Both customers see the menu; both see SOME offer; the *prominence* differs

**The implication for HE:** **Configure a SET of offers, not one.** The bigger the set, the more cohort-segments Zomato can match. A single "30% off" offer makes Zomato's algo's job linear; a 5-offer-stack lets it personalise.

### 1.4 The dark-side reality: platform-decided discounts you can't refuse

Verified from April-2026 Karnataka media reportage: **Zomato adds platform-funded discounts on top of merchant offers without consent** — flash sales, festive offers, "promo ranjan" offers. Restaurants report:
- 50% off scoped to 3 items × 2 hours got auto-extended to entire menu × full day
- "₹200 off ₹500 / ₹400 off ₹3,000 / ₹70 off ₹200" run without merchant approval
- "Flat ₹120 off on a ₹190 minimum order value" applied — clearly a Zomato AOV-push tactic
- One restaurant chain reported ₹13 lakh in unexpected discount losses

**Operational implication for HE:** The Track Offers tab needs to be **checked daily** — not just to monitor your own offers, but to detect platform-injected ones you didn't authorise. The contract has a "discouraged practices" clause; you can call it out via OTP-based ad-consent flow which exists for ads but NOT for discounts (the loophole).

---

## Part 2 · The volume-vs-margin math (the equation that must hold)

### 2.1 HE's per-order economics inside 4km Zomato

| Component | Value | Math |
|---|---|---|
| AOV (current median) | ₹240 | from real 67-order data |
| Zomato commission (within 4km) | 23.41% | contract verified |
| Net to HE before food cost | ₹184 | ₹240 × 76.59% |
| Food cost (industry estimate) | ~30% = ₹72 | typical biryani QSR |
| **Contribution per full-price order** | **₹112** | 47% |

### 2.2 The discount-cost ceiling — the math you cannot break

For a discount-driven offer to drive incremental volume profitably, the **discount cost per order must be ≤ 30% of contribution** (industry rule of thumb for QSR) — anything above and you're acquiring at a loss without LTV recovery.

| Discount config | Discount cost / order | % of ₹112 contribution | Verdict |
|---|---|---|---|
| 10% upto ₹40 above ₹159 | ~₹16 | 14% | ✅ healthy |
| 20% upto ₹50 above ₹250 | ~₹50 | 45% | ⚠️ above ceiling |
| 30% upto ₹75 above ₹250 | ~₹75 | 67% | ❌ break-even or worse |
| 30% upto ₹150 above ₹500 | ~₹150 | (vs ₹240 contrib) 63% | ⚠️ borderline |
| 50% upto ₹125 above ₹250 | ~₹125 | 112% | ❌ negative-margin acquisition |

### 2.3 The ONLY way a high-discount offer makes sense

For NEW user acquisition, you can break the 30% rule because:

```
Acceptable CAC = (LTV − incremental cost-of-service) × discount factor
LTV per HE Zomato customer (estimate) = 5 orders × ₹112 contribution = ₹560 over 12 months
Acceptable CAC ≤ 50% of LTV = ₹280
```

So a **first-order offer of ~₹150-200 off** is justified ONLY if the second-order conversion rate is **≥40%** (i.e. 4 of 10 first-time customers come back at full price). Below that, you're burning capital.

**This is why the offer SET strategy matters:** the deep discount is reserved for cohort=NEW (one-time CAC); the shallow always-on discounts capture loyalists and upsell budget-eaters.

---

## Part 3 · The offer-set design (volume-driving by construction)

The strategy is **NOT to pick one big-bang offer.** It's to deploy a SET that lets Zomato's ML auto-route each customer cohort to its most-likely-to-convert offer. Here's the configured stack:

### Offer #ZD1 — "First-order Big Discount" — for NEW cohort, all-day

| Field | Value |
|---|---|
| Discount | **30% upto ₹150** |
| Cohort | NEW (90-day-clean users) |
| Days | All 7 |
| Meal time | All day (forced — NEW cohort doesn't allow meal-time-specific) |
| Min order | ₹149 (auto) |
| Funding ask | **Pepper-funded via KAM** (Zomato's first-30-day new-restaurant push) — if granted, costs HE ₹0 per order; if denied, fall back to Salt at full cost |
| Competitive percentile | 68th (mid-pack) |
| Why this and not 50% | At 30% upto ₹150, the worst-case cost is ₹150 per acquisition. At 50% upto ₹150, it's still ₹150 cap, BUT the headline psychology of 50% triggers price-shopper customers who churn at 90-day. 30% catches engaged-but-curious tries. |
| Volume goal | 60+ first orders / month |
| Kill criteria | If 30-day return rate <35%, lower to 20% upto ₹100 |

### Offer #ZD2 — "Lunch Pull (volume engine)" — ALL cohort, lunch-only

| Field | Value |
|---|---|
| Discount | **20% upto ₹100** |
| Cohort | ALL users |
| Days | Mon-Thu (weekday office-lunch focus) |
| Meal time | Lunch (11 AM–3 PM) |
| Min order | ₹129 (auto, meal-time floor) |
| Funding | Salt (restaurant-funded) |
| Competitive percentile | 56th |
| Cost-per-order | ~₹50 (at min cart ₹250) → 45% of contribution — borderline |
| Volume goal | 80+ lunch orders/week (weekday) |
| Why this works | HE's natural AOV is ₹240 — lunch crowd. Discount makes the ₹250-300 ticket easier. Mon-Thu carves out the office-lunch-only window where Empire/commodity competitors don't run offers. |

### Offer #ZD3 — "Snack Steal (capture 4-7 PM dead window)" — ALL cohort, snacks-only

| Field | Value |
|---|---|
| Discount | **30% upto ₹75** |
| Cohort | ALL users |
| Days | All 7 |
| Meal time | Snacks (3 PM–7 PM) |
| Min order | ₹129 |
| Funding | Salt |
| Cost-per-order | ~₹75 cap — ⚠️ careful |
| Volume goal | 40 snack orders/week |
| Why this | Snack daypart is structurally underused — most QSRs go quiet 3-7 PM. HE has Kabab + Roti + Roomali — perfect snack attach. Capture this dead window, drive AOV ₹150-200 (kabab snack territory). The 30% cap of ₹75 lands the actual per-order cost at ~₹40-60 because most snack carts are ₹150-200. |

### Offer #ZD4 — "Family Dinner Lift" — ALL cohort, dinner-only, weekend

| Field | Value |
|---|---|
| Discount | **30% upto ₹150** |
| Cohort | ALL users |
| Days | Fri-Sun |
| Meal time | Dinner (7 PM–11 PM) |
| Min order | ₹129 (auto) — but real customers will trigger at ~₹500+ for family carts |
| Funding | Salt |
| Cost-per-order | ~₹150 cap on a ₹500+ cart = 30% — high but acceptable on bigger contribution-per-order from larger carts |
| Volume goal | 25 weekend dinner orders/week |
| Why this | Dinner family carts. Bigger orders = more contribution despite discount. Weekend-only because weekday dinner is single-person delivery, less margin headroom. |

### Offer #ZD5 — "Free Roomali Roti above ₹399" — Freebie, ALL cohort

| Field | Value |
|---|---|
| Type | Freebie |
| Item | Roomali Roti × 1 (per redemption) |
| Cohort | ALL users |
| Days | All 7 |
| Meal time | All day |
| Min order | ₹399 (auto) |
| Funding | Salt |
| Cost | ~₹15 food cost · 0% discount-perception math (not a % discount) |
| Volume goal | This is a **CART-LIFT mechanism, not a volume mechanism.** Drives AOV from natural ₹240 zone up to ₹399 for customers who need a small nudge to add one more dish. |
| Why this | Roomali Roti is the #1 attach item in HE's actual order data (10 orders × 48 quantity in 30 days). Free roti at ₹15 cost looks like ₹40 value to the customer. Highest perceived-value-to-cost ratio in the whole offer stack. |

### Offer #ZD6 (KAM-only) — Zomato Gold opt-in

| Field | Value |
|---|---|
| Type | Membership program |
| Discount | Per Gold-program standard (typically BOGO mains or 15-30% off Gold members) |
| Cohort | Gold members only (Zomato segments this for you) |
| Funding | Restaurant funds visible discount; commission may renegotiate downward |
| Why mandatory | Gold has 5M+ members driving ~40% of Zomato GOV. Without opt-in, HE is invisible to that 40%. Treat the discount as customer-acquisition-cost, not profit. |
| KAM-trigger needed | Yes |

---

## Part 4 · How the offer-set drives volume (the mechanism)

### 4.1 Cohort × offer matrix — what each customer sees prominently

| Cohort | Daypart | Most prominently surfaced offer | Predicted AOV | Discount cost | Contribution / order |
|---|---|---|---|---|---|
| **NEW user** | Any | ZD1 30%/₹150 first-order | ₹250-400 | ₹100-150 | ₹40-60 (acquisition mode) |
| **Budget-eater (₹200-300 historical AOV)** | Lunch | ZD2 20%/₹100 lunch | ₹250 | ₹50 | ₹62 |
| **Snacker (3-7pm orderer)** | Snacks | ZD3 30%/₹75 snack | ₹180 | ₹54 | ₹35 |
| **Family-orderer (>₹500 AOV history)** | Dinner Fri-Sun | ZD4 30%/₹150 family | ₹600 | ₹150 | ₹250 ← biggest contribution |
| **Loyalist / lunch repeat** | Lunch Mon-Thu | ZD2 same as budget | ₹300 | ₹50 | ₹100 |
| **Cart-stretcher** (₹300 cart hesitating) | Any | ZD5 Free Roomali above ₹399 | ₹420 | ₹15 (roti cost) | ₹150 |
| **Gold member** | Any | ZD6 Gold-exclusive offer | varies | varies | varies |

### 4.2 Why this 6-offer set drives more volume than any single offer

**Single 30% off-everything-always strategy** (the naive approach):
- Same discount % to a budget-eater + a high-spender
- Budget-eater: gets ₹150 off ₹500 → contribution ₹50 — borderline
- High-spender: gets ₹150 off ₹1500 → contribution ₹350 (only 10% effective discount, not 30%) — leaves money on the table
- New user: same offer as everyone, no acquisition push — fewer first-orders

**Multi-offer set strategy** (above):
- Budget-eater: ZD2 lunch 20% → conversion-friendly
- High-spender: ZD4 family dinner with full ₹150 cap = 25% effective on ₹600 — feels generous, but contribution is huge
- New user: ZD1 30%/₹150 first-order — aggressive acquisition push (Pepper-funded if KAM grants)
- Snacker: ZD3 captured in 4-7pm window otherwise lost
- Cart-stretcher: ZD5 freebie nudges them up

**Volume math at full scale:**

| Volume target (90-day) | First-orders | Lunch repeat | Snack daypart | Family dinner | Cart-lift | Total |
|---|---|---|---|---|---|---|
| Orders/month | 60 | 320 (80/wk × 4) | 160 | 100 | (overlay) | **640+** |
| vs current | 67/mo | — | — | — | — | **~10× growth** |

This is the only path to 2.3× revenue (₹15L target) — by **volume, not AOV stretch.** AOV stretch on Zomato is hard because of its commission floor; volume on Zomato is feasible because of the algorithm's hunger for active-promotion signal.

### 4.3 What this set does to Zomato's algorithm specifically

1. **"Active promotions" signal: 5 simultaneous offers** = HE looks like an aggressive, well-managed restaurant. Algorithm rewards this with higher organic surfacing.
2. **Competitive percentile coverage: 56% / 68% / 77%** — HE outperforms 50-77% of North Indian restaurants in Bangalore depending on the offer the customer is shown. Across the cohort spectrum, HE wins.
3. **Multi-cohort offer exposure** = ML has more matching options, customer always sees a relevant offer = higher CTR.
4. **Daypart spread**: HE has at least one offer firing every hour of the day. No "dead window" where customer arrives and HE has nothing to offer.

---

## Part 5 · Configuration tier mapping

Reality check from yesterday's live partner-app audit: only some of these are web-self-serve.

| Offer | Tier | Configurable from |
|---|---|---|
| ZD1 30%/₹150 first-order, NEW cohort | **TIER 1 (web)** | Promo Code form, today |
| ZD2 20%/₹100 lunch Mon-Thu | **TIER 1 (web)** | Promo Code form, today |
| ZD3 30%/₹75 snacks all-day | **TIER 1 (web)** | Promo Code form, today |
| ZD4 30%/₹150 dinner Fri-Sun | **TIER 1 (web)** | Promo Code form, today |
| ZD5 Free Roomali Roti above ₹399 | **TIER 1 (web)** | Freebies form, today |
| ZD6 Zomato Gold opt-in | **TIER 3 (KAM)** | Phone the KAM |

**All 5 main offers are web-configurable today.** Maximum self-serve power. The 6th (Gold) needs one phone call.

### 5.1 Two extra offers (Tier-2 Android-only) to add in week 2 once Nihaf installs the app

**ZD7 — "₹50 off above ₹299" (Fixed Discount)** — Android-app-only. Captures the precise gap above HE's median ₹240 AOV — drives the cart from ₹240 to ₹299 zone. Costs ₹50 per redemption.

**ZD8 — "15% off Mutton items" (Percentage Dish Discount)** — Android-app-only. Drives trial of the moat (the 23-item Mutton menu). Costs ~₹40-50/order. **The ONLY way to surface item-level discounting** — invisible to the algorithm and customer otherwise.

---

## Part 6 · Activation latency and operational cadence

**Latency (from partner UI schema):**
- Same-day activation: offer goes live at the moment you click "Choose outlet & Activate" — within minutes
- Future-day activation: offer goes live at midnight of chosen start date
- No Zomato review/approval queue for these offer types

**No end-date.** Offers run until manually stopped. So you must add **operational cadence**:

### Daily check (5 min)
- Open Track Offers tab on web → confirm only YOUR 5 offers are active
- If platform has injected an unauthorised "promo ranjan" offer → call KAM same-day to remove

### Weekly check (15 min, Monday morning)
- Pull Reporting → Funnel → menu-opens → cart-builds → orders per offer
- If any offer's 7-day conversion is <2%, kill it; create a variant with different daypart or %

### Monthly check (30 min)
- Compare Track Offers performance (orders attributed, revenue, redemption rate) per offer
- Decide whether to scale up the winners (raise discount cap by one notch) or kill the losers
- Re-evaluate KAM ask: if month 1 succeeded, ask for Pepper-funded month 2 push too

### When NEW outlet honeymoon ends (Day 60 since signing 28 Mar 2026 → ~Day 27 May 2026)
- Honeymoon = 0% Service Fee. After this, full 18% kicks in
- Every offer's contribution math changes the day commission becomes real
- Re-run all offers' contribution math in late May. Some may need to be reduced.

---

## Part 7 · The integration with Phase 0-3 of the listing-optimization plan

This discount strategy ONLY works if HE has the right inventory + descriptors + photos + sections at the moment customer clicks. The chain is:

```
Customer sees HE in search
   ↓ (algorithm rewards active offers + reviews)
Customer clicks listing
   ↓ (heritage descriptors, mutton menu visible, badges)
Customer adds items
   ↓ (offer surfaces — ZD1/2/3/4 or ZD5)
Customer completes order
   ↓ (delivery within ETA → review)
Customer reorders next month
   ↓ (NEW cohort drops to LAPSED_60D — different offer surfaces)
```

**If Phase 2 of the execution plan (mutton menu visibility, sections, descriptors) hasn't shipped, configuring these offers FIRST is wasteful** — you're driving traffic to a generic-looking page. Sequence-critical: **listing optimization THEN discount stack.**

**Realistic sequence:**
- Day 1-3: Phase 2 (listing complete, mutton visible, sections renamed)
- Day 4: Configure ZD1+ZD2+ZD5 (the most important 3) on web
- Day 5: KAM call — Gold opt-in + Pepper-funding ask
- Day 6: Configure ZD3+ZD4 if Day 4 lands clean
- Day 7-14: Monitor + iterate
- Day 15: Add Tier-2 offers (Android app — Nihaf installs, configures ZD7+ZD8)

---

## Part 8 · The strategic differentiation — Zomato vs Swiggy positioning recap

This document defines Zomato strategy. For Swiggy, separate document forthcoming. The strategic split:

| | Zomato | Swiggy |
|---|---|---|
| **Geographic discipline** | Strict 4km polygon (avoid 23-41% commission spike beyond) | Wider polygon OK |
| **AOV target** | Volume-first; let median AOV stay ₹240-280 | Push high AOV; ladder to ₹500+ |
| **Offer mechanic** | 5-offer cohort-segmented stack (this document) | 3-offer ladder (Family Feast, mid-tier, combo SKU) |
| **Daypart strategy** | All 5 dayparts have a configured offer | Lunch + dinner only |
| **Algorithm hack** | "Active promotions" signal — keep 5 offers running always | Self-Serve Ads ₹500/day (heritage creative) |
| **KAM ask** | Pepper-funded NEW user offer + Gold opt-in | Free Delivery for One members + KAM-confirmed price-match-tag |
| **Volume goal** | 600+ orders/month in 90 days | 80-120 higher-AOV orders/month |

---

## Part 9 · Sources cited

- [Spice Advisors: Zomato & Swiggy algorithm tips](https://www.spiceadvisors.in/post/zomato-swiggy-algorithm-tips-for-restaurants-the-ultimate-guide-to-rank)
- [chuk.in: How to rank higher on Zomato and Swiggy](https://chuk.in/how-to-rank-higher-on-zomato-swiggy-and-get-more-orders/)
- [restromark.com: How the Zomato algorithm works](https://restromark.com/how-the-zomato-algorithm-works-and-how-your-restaurant-can-leverage-it/)
- [Zomato Blog: Elements of scalable machine learning](https://blog.zomato.com/elements-of-scalable-machine-learning)
- [Zomato Blog: The real value of discount-based customer acquisition](https://www.zomato.com/blog/the-real-value-of-discount-based-customer/)
- [Zomato Blog: Powering restaurant ads on Zomato](https://www.zomato.com/blog/powering-restaurant-ads-on-zomato)
- [Zomato Blog: New ratings system](https://www.zomato.com/blog/new-ratings/)
- [Outlook Business: Restaurants allege Zomato/Swiggy charge for ads/discounts without consent](https://www.outlookbusiness.com/news/restaurants-allege-zomato-swiggy-charge-them-for-ads-discounts-without-consent)
- [Deccan Herald: Bengaluru eateries flag hidden discounts](https://www.deccanherald.com/india/karnataka/bengaluru/their-discount-our-loss-bengaluru-eateries-flag-hidden-discounts-by-food-delivery-platforms-3978905)
- [Inc42: Zomato pushing 5% revenue ad spend](https://inc42.com/buzz/zomato-now-asking-restaurants-to-bear-cost-of-cancellation-increase-marketing-spends/)
- [Outlook Business: Zomato long-distance fee + NRAI](https://www.outlookbusiness.com/corporate/zomato-faces-continued-flak-over-long-distance-fee-nrai-plans-talks-with-deepinder-goyal)
- [GrowthX: Zomato business model & growth strategy](https://growthx.club/blog/zomato-business-model)
- [Zomato Restaurant Partner UI ground-truth (live audit 2026-05-10)](../../../data/snapshots/aggregator-listing/ZOMATO-OFFERS-WEB-AUDIT-2026-05-10.md)
- HN Hotels Aggregator Playbook (this repo): `/ops/intelligence/aggregator-playbook/`
- Zomato Delivery contract — `docs/CONTRACT_REGISTRY.md` (signed 28-Mar-2026 with HN Hotels)

---

## Definition of Done for this strategy

**It's working when, 30 days post-deployment:**

1. **Volume:** ≥4× the order count vs Apr 2026 baseline (67/mo → ≥250/mo)
2. **Mix:** All 5 cohort categories getting orders (NEW first-orders + lunch repeat + snack + family dinner + cart-stretcher)
3. **Margin:** Blended discount cost per order ≤ 25% of contribution (i.e. ₹28 of every ₹112)
4. **Algorithm:** HE's organic ranking visibly improves — appears in "Top Rated" / "Trending" lists in Bangalore Biryani searches
5. **Reviews:** ≥10 new delivery reviews → push toward 4.2+ rating threshold
6. **Cohort recovery:** ≥35% of NEW users return within 30 days at full price (confirms acquisition was real, not deal-chasing)

**It's failing if:**
- Volume rises <2× → discount didn't pull enough new orders → kill the loss-leaders, simplify
- Margin drops below 30% on any specific offer → discount cost > psychological lift → reduce that offer's cap one notch
- Reviews stay flat or decline → operational issue (delivery time, food quality), not discount issue → fix ops first

---

This is the layer. Next document: Swiggy-specific strategy (different mechanics — PoC-mediated, AOV-ladder focused, less algorithmic surfacing of multi-offer sets, more about sponsored search ads + visibility).
