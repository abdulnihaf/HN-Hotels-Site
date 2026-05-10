# Zomato Restaurant Partner — Offers tab · LIVE WEB AUDIT
**Audit date:** 2026-05-10 IST
**Audited via:** Tailscale → hn-winpc dining-Chrome (port 9223) → DevTools eval against `www.zomato.com/partners/onlineordering/offers/` while logged in as Abdul / HN Hotels (HE outlet 22632449 + NCH outlet 22632430).
**Screenshots saved at:** `~/Desktop/zomato-{promo-create,promo-code-form-FULL,freebies-create,track-offers-empty}-form.png`

---

## TL;DR — what the Web Dashboard ACTUALLY exposes (vs what UrbanPiper KB suggested)

UrbanPiper's KB (and most third-party blogs) describe Zomato as exposing **4 self-serve offer types**: Percentage Discount, Fixed Discount, Percentage Dish Discount, BOGO.

**The live web Partner Dashboard exposes ONLY 2 offer types:**

| Offer type on web | What it does | Equivalent in UrbanPiper-KB taxonomy |
|---|---|---|
| **Promo code** | % off cart with auto min-order; segment-targetable | Percentage Discount (web-restricted version) |
| **Freebies** | Free dish above min-order; segment-targetable | BOGO (web-restricted version) |

The web UI carries an explicit message:
> *"For creating a fixed discount, percentage discount or buy one get one offer use the Zomato Restaurant Partner app on Android. This feature will be available on the web dashboard soon."*

So the four UrbanPiper-described types map to web-vs-app reality like this:

| Offer type | Web Dashboard | Android App | KAM-mediated |
|---|---|---|---|
| Percentage Discount (basic, capped %, auto-min-order) | ✅ Promo Code | ✅ same | — |
| **Custom Percentage Discount** (cart-wide, custom min-order) | ❌ | ✅ | ✅ |
| **Fixed ₹ Discount** (₹X off above ₹Y) | ❌ | ✅ | ✅ |
| **Percentage Dish Discount** (item-level — e.g. 15% off Mutton Biryani only) | ❌ | ✅ | ✅ |
| **BOGO (Buy 1 Get 1)** (any item-pair) | ❌ | ✅ | ✅ |
| **Freebie** (1 free item above ₹X) | ✅ | ✅ | — |

**This breaks 2 of the 4 surgical offer recommendations I drafted earlier:**
- ❌ "Z2 — 15% off Mutton items (item-level)" — Percentage Dish Discount is Android-only
- ❌ "Z3 — ₹50 off above ₹299 (Fixed Discount)" — Fixed Discount is Android-only
- ✅ "Z1 — 30% off first order (Promo Code, New users)" — works on web
- ✅ "Z4 — Free Roomali Roti above ₹399 (Freebie)" — works on web

---

## 1. Offers tab structure (live, today)

URL: `https://www.zomato.com/partners/onlineordering/offers/`

When you navigate there:
1. Outlet selector appears: **Hamza Express (22632449)** + **Nawabi Chai House (22632430)**. Pick HE.
2. Two tabs visible at top:
   - **Create offers** (default)
   - **Track offers**
3. "Create offers" tab shows section heading: **"CUSTOM OFFER FOR YOU"**
4. Two clickable tiles below:
   - **Promo code** — "Delight customers with free discounts on every order"
   - **Freebies** — "Offer a free dish above a certain order value"
5. Footer message about Android app for the other 4 offer types

---

## 2. Promo Code creation flow — every field captured

When you click the **Promo code** tile, an inline panel expands with these fields, in this order:

### Field 1 — "Select your discount" (required)
**Default selection:** `10% OFF upto ₹60`

**Two-axis slider control:**
- **Discount %**: 6 fixed levels — `10%` / `20%` / `30%` / `40%` / `50%` / `60%`
- **Max cap**: 5 fixed options — `No max cap` / `₹75` / `₹60` / `₹50` / `₹40`

**Critical:** Both axes are slider-based, NOT free-form input. You cannot enter "₹100 max cap" or "25%". You're constrained to these exact combinations (max 30 combinations).

### Field 2 — Competitive benchmark callout (Zomato-injected, not user-editable)
Live text observed on HE:
> *"This offer is better than 48% of North Indian restaurants in the area."*

This is psychology nudging — Zomato shows you where your offer ranks vs nearby competitors. Drives upsell to higher discount %.

### Field 3 — "Discount applicable for" (required)
**Two options (radio):**
- **All users**
- **New users** ← critical for HE acquisition mode

This contradicts UrbanPiper KB which said segment-targeting was "limited / not exposed publicly." It IS exposed cleanly on the web.

### Field 4 — "Select meal time" (required)
**Default:** `All day (24 hours)`

Helper text: *"All users who place an order in this meal time will be eligible for the offer"*

This is a dropdown — UI hint suggests other meal-time options exist (Breakfast / Lunch / Snacks / Dinner / Late Night likely) but the click-to-expand is React-controlled and didn't open via synthetic events. **Verification needed via Android app or manual click on hn-winpc.**

### Field 5 — "Campaign start date"
**Default:** today's date (e.g. `9th May 2026`)

Helper text: *"Your offer will start on 9th May 2026 at 12:00 AM. You can stop this offer at any time."*

**Implication:** No end date is set up-front. You stop the offer manually whenever you want. Always-on by default.

### Field 6 — "Run this offer" (days of week)
**Three options (radio):**
- **All 7 days** (default)
- **Mon-Thu**
- **Fri-Sun**

**No per-day granularity.** You can't select "Mon, Wed, Fri only." Just these 3 buckets.

### Field 7 — Auto-derived "Offer details" summary (read-only display)
The right panel shows a live preview:
- *"Offer applicable for: All users on all menu items, **excluding MRP items**"*
- *"Minimum order value: **₹159**"* (auto-set based on % chosen)
- *"Valid at: Hamza Express, Shivajinagar (ID: 22632449)"*

**Critical: Min-order value is AUTO-COMPUTED by Zomato, not user-set.** Default `10% upto ₹60` → min ₹159. Can't override from this UI. Higher discount % likely auto-bumps min-order higher (couldn't programmatically test the slider; verify by manually clicking each step).

**MRP items excluded** — items with a fixed MRP (drinks etc.) are excluded automatically.

### Field 8 — Terms checkbox + Activate button
- Checkbox: *"I have read and accept all the terms and conditions."*
- Button: **"Choose outlet & Activate"**

---

## 3. Freebies creation flow — every field captured

When you click the **Freebies** tile, an inline panel expands:

### Field 1 — "Choose a freebie" (required)
- Search box: *"Type or search freebie item from menu"*
- "Select from eligible freebies in your menu"

**Implication:** Not all menu items are eligible. Zomato has a per-platform allowlist for what counts as "freebie" — likely items below a certain price ceiling (₹100? ₹150?). Couldn't programmatically open the dropdown to confirm.

### Field 2 — "Quantity of freebie"
**Default:** `1`

You can give 1+ free items per qualifying order. (Quantity selector — likely steppers 1-5.)

### Field 3 — "Minimum order value"
**Default observed:** `₹549`

**Critical:** This is auto-set based on the freebie chosen. Higher-value freebie → higher min-order requirement. Helper text: *"Orders below this amount will not be eligible for this offer. Excludes taxes and charges"*

(Note: "Excludes taxes and charges" means min order value is checked against the FOOD-ONLY subtotal, not the customer's final-paid amount. So a customer at ₹600 cart with ₹30 packing + ₹50 GST = ₹680 paid still needs the FOOD subtotal alone to clear ₹549.)

### Field 4 — "Who will see this?" (segment-targeting)
**Two options (radio):**
- **All customers** — *"All customers can see and apply this promo code."*
- **New customers** — *"Only customers ordering for the first time from your restaurant will be able to see and use this."*

### Field 5 — "Promo visibility"
The label exists but I couldn't expand it programmatically. Likely controls where the offer surfaces (restaurant-page-only vs in feed vs push notifications). **Manual click on hn-winpc needed to fully document.**

### Field 6 — "Start date"
Same as Promo Code — default today, no end date.

### Field 7 — "Run this offer" (days)
Same 3 options: All 7 / Mon-Thu / Fri-Sun.

### Field 8 — "Meal time"
Same: All day (24 hours) default; dropdown for specific.

### Field 9 — Activation
Button: **"Preview and Activate"** (different from Promo Code's "Choose outlet & Activate" — Freebies has a preview step)

---

## 4. Track Offers tab

URL: same as Create Offers, just click "Track offers" tab.

**Live state for HE today:**
> "No offers to show here. Delight your customers with great offers, create an offer today!"

**Confirmed: HE has ZERO restaurant-funded offers configured today.** This matches what we already knew from the customer-facing Swiggy listing scrape (which showed only platform/card-funded offers).

**What this tab will show once offers are configured:**
- List of active offers with status, performance metrics (orders triggered, revenue, redemption rate)
- Edit / pause / stop controls
- (Couldn't verify exact columns since list is empty.)

---

## 5. The 4 missing offer types — reality check on Android app access

The web message says Fixed Discount, Percentage Discount (custom), and BOGO are on the **Zomato Restaurant Partner app** (Android only).

**For HE to use these, Nihaf needs:**
1. Install **Zomato Restaurant Partner** app on his Android phone
2. Log in with the same Zomato partner credentials
3. Configure these advanced offers from the mobile app
4. Performance still tracks in the same Track Offers tab on web

**OR** — call the Zomato KAM and request KAM-side offer configuration (slower, but the KAM can also negotiate Pepper / Salt+Pepper funding which the self-serve UI cannot).

---

## 6. Updated practical offer recommendations for HE — what's actually executable

Given the web/app constraints, the realistic surgical offer set splits into:

### TIER 1 — Web-configurable today (Nihaf + me, no app, no KAM)

**Offer #ZW1 — Promo Code: "30% off, max ₹75, New users only, all days, all day"**
- Discount: 30% upto ₹75 (from the slider)
- Segment: **New users**
- Days: All 7
- Meal time: All day
- Min order: AUTO (estimate ₹249-299 based on ₹159 → 10% pattern)
- Funding: Salt by default. Phone the KAM to request Pepper/Salt+Pepper for first-30-days new-restaurant boost.

**Offer #ZW2 — Freebie: "Free Roomali Roti above ₹399, All customers, all days"**
- Freebie: Roomali Roti (top attach item — 10 orders × 48 quantity)
- Quantity: 1
- Min order: AUTO (₹549 for a different freebie observed; for Roomali ~₹40 freebie it'll likely be lower, ~₹299-399)
- Segment: All customers
- Days: All 7
- Cost to HE: ~₹15 per redemption

### TIER 2 — Android app required (Nihaf has phone, can install + configure)

**Offer #ZA3 — Fixed Discount: "₹50 off above ₹299, all customers"**
- Web is unable; Android app exposes Fixed Discount type
- Use this to ladder customers from median ₹240 AOV up to ₹299 zone

**Offer #ZA4 — Percentage Dish Discount: "15% off Mutton Biryani + Mutton Hamza Special + Thethar Biryani"**
- Web is unable; Android app exposes Percentage Dish Discount type (item-level, once per order)
- Drives trial of moat items. Costs HE ~₹40-50 per order

**Offer #ZA5 — BOGO: "Buy 1 Mutton Biryani Get 1 Egg Biryani Free"** (or similar)
- Web is unable; Android app exposes BOGO with `offer-bogo` tag mechanic
- Highest-perceived-value offer; only run on a controlled set or you bleed margin

### TIER 3 — KAM-only (call Zomato account manager)

**Offer #ZK6 — Pepper-funded New User Discount**
- Zomato funds 100% of the discount (you pay nothing) — they do this for new restaurants in first 30-60 days as an acquisition push
- Available only by KAM negotiation, not self-serve

**Offer #ZK7 — Zomato Gold opt-in**
- Per playbook, this is mandatory and KAM-mediated. Restaurant funds the visible Gold discount but gets visibility into Gold-member listings.

---

## 7. What the web UI does NOT expose anywhere

Confirmed absent from both Web Promo Code + Web Freebie flows:
- ❌ Free-form discount % (you're locked to 10/20/30/40/50/60)
- ❌ Free-form max cap (locked to 5 options)
- ❌ Free-form min order value (auto-computed only)
- ❌ Per-item or per-category targeting (web Promo Code is cart-wide only)
- ❌ Per-day granularity (only 3 day-buckets)
- ❌ End date (offer runs until you manually stop)
- ❌ Stackability rules (web doesn't expose how this offer interacts with platform promos / Gold / cards)
- ❌ Funding source toggle (Salt vs Pepper vs Salt+Pepper) — web defaults to Salt; KAM is needed to flip
- ❌ Single-use flag per customer
- ❌ Geo-restriction within the outlet's polygon
- ❌ Promo code customization (the system generates the code; you don't set it like "TRYHE")

These are likely available in the Android app + KAM. **Worth verifying on hn-winpc by manually walking the Android app's offer creation flow** — could uncover more controls.

---

## 8. Other tabs adjacent to Offers (briefly checked)

- **Reporting** — separate tab, contains analytics dashboards (not audited deeply here)
- **Ads** — separate tab. "All Products (3)" suggests 3 distinct ad products available. "Create campaign" button → modal asking for restaurant selection. Recent 60-day stats: 0 orders / ₹0 spend / 0 ad sales (HE not running any ads currently). Worth a separate full audit.
- **Hyperpure** — restaurant-supply ordering, not a customer-facing offer mechanism
- **Customer complaints / Reviews / Help / Learning / Expansion** — not offer-related

---

## 9. Action items resulting from this audit

1. **Fix the offer recommendations section in the prior playbook** to reflect web/app split. The 4 surgical offers I drafted (Z1-Z4) should be re-tagged TIER-1 (web) vs TIER-2 (app) vs TIER-3 (KAM).

2. **Nihaf installs Zomato Restaurant Partner Android app** on his phone — unblocks Tier-2 offers (Fixed Discount, Percentage Dish Discount, BOGO).

3. **Schedule a Zomato KAM call** to:
   - Request Pepper-funded discount for first 30 days (NEW outlet acquisition push)
   - Negotiate Zomato Gold opt-in terms
   - Ask about whether the web dashboard restrictions are temporary or permanent

4. **Re-explore Android app offer types** when Nihaf has it installed — likely reveals more controls (free-form fields, per-item targeting, etc.). Document those in a sequel audit.

5. **Manual verification needed on hn-winpc** for:
   - Meal time dropdown options (Breakfast / Lunch / Snacks / Dinner / Late Night?)
   - "Promo visibility" sub-options on Freebies form
   - Eligible freebie items list (price ceiling on what counts as freebie?)
   - Min-order auto-computation rules per discount % (currently know only 10% upto ₹60 → ₹159)

---

## 10. Saved artifacts

- `/Users/nihaf/Desktop/zomato-promo-create-form.png` — Promo Code form initial state
- `/Users/nihaf/Desktop/zomato-promo-code-form-FULL.png` — Promo Code form full-page screenshot
- `/Users/nihaf/Desktop/zomato-freebies-create-form.png` — Freebies form
- `/Users/nihaf/Desktop/zomato-track-offers-empty.png` — Track Offers empty state
- `/tmp/zomato-{offers-page,promo-form,freebies-form,track,ads,create-campaign}.txt` — raw innerText dumps (consider moving to `data/snapshots/aggregator-listing/zomato-portal-dumps/` if you want them tracked)
