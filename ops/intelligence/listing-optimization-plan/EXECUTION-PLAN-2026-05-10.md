# HE Listing Optimization · Full Execution Plan
**Generated:** 2026-05-10 · **Owner approver:** Nihaf · **Executor:** Claude (with Nihaf in the loop for photos + KAM calls)

---

## Mission, in one paragraph

Take HE from **today's state** (80 Swiggy items / 79 Zomato items, signature mutton menu invisible, 0 dining ratings, no restaurant-funded offers, generic section names, Swiggy outlet-ID bug silently swapping HE↔NCH data) to **fully-optimized state** (~140 items each platform, identity-driven section structure, anchor-priced, badged, heritage-described, with the May playbook offers layered on top). Sequence: **Zomato fully complete → THEN Swiggy.** Photos: Nihaf uploads manually (kept out of automation scope). All hands-on execution runs from the **hn-winpc Windows machine** (Tailscale-bridged Chrome with delivery-profile remote-debug on port 9222 + dining-profile on 9223).

**The two hyper-personalized intelligence layers we'll produce:**
- `zomato-execution-layer-2026-05-10.md` — Zomato-schema-aware playbook + per-item ready-to-paste copy, sequenced for the Zomato Partner App UI
- `swiggy-execution-layer-2026-05-10.md` — Swiggy-equivalent (deferred until Zomato is done; differs because Swiggy is PoC-mediated for offers and has a different menu schema)

Each is hyper-personalized to HE specifically — not a generic template. Mutton-as-moat is the spine, 1918 heritage is the descriptor framing, AOV ₹464 + 24% commissions is the math constraint, May ₹15L target is the outcome to optimize for.

---

## Inputs (already in place)

| Input | Source | Status |
|---|---|---|
| HE POS catalog (165 active products, 25 in Fried Chicken excluded) | `test.hamzahotel.com` Odoo, JSON-RPC | ✅ pulled |
| Swiggy live menu (80 items, 12 sections) | Chrome DevTools scrape | ✅ in `data/snapshots/aggregator-listing/` |
| Zomato live menu (79 items, 8 sections) | Same | ✅ same folder |
| 57+52 missing items, filtered + categorised | Cross-diff | ✅ `he-missing-items-final-2026-05-10.json` |
| Photos for 59 of 67 missing items | Hi-res from `tv-mission-control/` | ✅ `~/Desktop/HE_Listing_Photos_2026-05-10/` |
| Aggregator playbook (offers + ads strategy) | `/ops/intelligence/aggregator-playbook/` | ✅ live |
| Consumer-psychology principles (5 principles distilled) | Web research | ✅ in audit MD §7 |
| **Competitor visual database (21 PNGs)** | Sonnet sub-agent | ✅ `~/Desktop/Competitor_Listings_2026-05-10/` |
| Tailscale + SSH bridge to hn-winpc | Set up earlier today | ✅ verified working |
| Chrome remote-debug ports (9222 delivery, 9223 dining) | hn-winpc | ✅ active |

---

## What's NOT in scope

- **Photo capture / upload** — Nihaf handles manually. Plan defines per-item filename + alt-text + which slot to upload to, but does not automate pixels.
- **POS-side schema changes** — items already exist in Odoo; we only flip `available_in_pos` flags + ensure the right `pos.config` IDs (HE Delivery=7, HE WABA=10) include them. No new product creation.
- **Aggregator commission renegotiation** — separate workstream.
- **Ad spend** — separate workstream (already covered in playbook).

---

## Phase 0 · Foundation fixes (Day 0, 60 min, blocking)

These MUST happen before any listing work, because they corrupt the data model otherwise.

### 0.1 — Flip Swiggy outlet-ID mapping
**File:** `ext/aggregator/content-swiggy.js` line 37
**Change:** `{ '1342888': 'nch', '1342887': 'he' }` → `{ '1342888': 'he', '1342887': 'nch' }`
**Deploy:** scp to hn-winpc, click extension reload in chrome://extensions
**Verify:** next `tick_beacon` capture shows brand inferred correctly from URL

### 0.2 — Backfill brand column on existing Swiggy data
**Action:** D1 migration script swapping brand on all `aggregator_orders` and `aggregator_snapshots` rows where `platform='swiggy'` AND `brand IN ('he','nch')` AND row predates the Swiggy-fix deploy timestamp
**Validation:** post-migration, `/ops/aggregator/he/swiggy/` shows what HE actually got, `/ops/aggregator/nch/swiggy/` shows NCH

### 0.3 — Verify HE POS items are flagged for delivery
On `test.hamzahotel.com`, ensure all 67 missing items (and the 53 already in both platforms) have:
- `available_in_pos = True`
- Bound to `pos.config` 7 (HE Delivery) AND 10 (HE WABA)
- Have a clean `pos_categ_ids` value (used later for menu-section auto-mapping)

**Method:** JSON-RPC bulk update through the existing `TEST_ODOO_KEY` credentials.

**Deliverable:** `data/snapshots/aggregator-listing/he-pos-delivery-config-validated-2026-05-10.json` listing each of the 140 in-scope items + their POS config bindings.

---

## Phase 1 · Zomato Partner Portal deep audit (Day 1, ~3 hours)

Before adding/changing anything, document **every editable surface Zomato exposes** so we know our complete optimization canvas. Without this, we'll do partial work and discover months later that there was a "Story" field we never filled.

### 1.1 — Audit canvas
Open Zomato Restaurant Partner web (`partner.zomato.com`) on hn-winpc Chrome (delivery profile, port 9222). Walk every menu, capture each section's editable fields, save as DOM dump per page.

**Audit dimensions to enumerate:**

| Dimension | Examples to look for |
|---|---|
| **Restaurant profile** | Name display, tagline, story/about (the "story field" is the Heritage 1918 vehicle), cuisine tags (max selectable), establishment type, FSSAI, GST, address, geo-pin precision, delivery polygon, contact phone, alternate phone, email, website, social handles |
| **Operating hours** | Per-day hours, holiday calendar, force-close override, prep-time per daypart |
| **Menu structure** | Sections (count, naming, ordering, can rename, can reorder), nested sub-sections, max items per section, item display format |
| **Per-item fields** | Name, description (max chars), price, half/full variants, custom add-ons, variant pricing, photo (size/format/min DPI), badges available (Bestseller / Chef's Special / New / Healthy / etc.), spice level, veg/non-veg/egg, allergen tags, preparation time, item-level discount, item availability toggle, "out of stock" auto-hide rules |
| **Photos** | Restaurant cover photo, gallery (max count), per-item photo (resolution requirements, recommended ratio), video support? |
| **Offers / discounts** | Salt / Pepper / Salt+Pepper, percentage discount, fixed discount, percentage dish discount, BOGO, timing groups, min order value, single-use flag |
| **Marketing / Ads** | Sponsored Listing self-serve UI, Visit Pack family (don't enroll yet — audit only), Brand Tiles, Branding-on-Search, SocialAds (Meta-via-Zomato) |
| **Zomato Gold** | Opt-in flow, terms shown to partner, customer-side display preview |
| **Reviews & responses** | Reviews dashboard, response template, response time SLA exposure to customer |
| **Insights / analytics** | Menu Score (Zomato's own optimisation tool), funnel view (impressions → menu opens → cart builds → orders), peak-hour analytics, search-term inbound report |
| **Operations** | Order-rejection settings, prep-time auto-adjust, packaging instructions, cancellation reasons taxonomy |
| **KAM / support** | Contact details, ticket history, "request callback" surface |

### 1.2 — Document each surface

For every editable field discovered, log:
- **Location** (URL + section + selector)
- **Current value** (what HE has today)
- **Optimal value** (what it should be — derived from the audit MD § 7 or Heritage framing)
- **Gap** (current vs optimal in plain language)
- **Effort to fix** (instant / requires KAM / requires creative asset / requires owner decision)
- **Algorithm impact** (does this lever affect Zomato's ranking algorithm? — based on Spice Advisors / chuk.in research)

Save as: `data/snapshots/aggregator-listing/zomato-portal-audit-2026-05-10.md` plus per-page DOM dumps in `zomato-portal-dumps/`.

### 1.3 — Output of Phase 1

A **canvas** that says: "Zomato exposes these N optimization levers; HE currently uses X of them; here are the Y untapped levers ranked by algorithm-impact / effort." This canvas drives Phase 2/3.

**Critical levers I expect to find but want to verify:**
- Restaurant "Story" / "About us" field (where the 1918 Heritage line goes)
- Per-item "Recommended" toggle (separate from Bestseller badge — auto-pinned to top of section)
- Menu Score Tool (Zomato's free analytics — should be reading this weekly)
- Search-keyword inbound report (tells us what people typed to find HE)
- Customer-replies template (response-time SLA affects ranking)

---

## Phase 2 · Zomato listing completion (Day 2-3, ~6 hours human + ~2 hours automation)

### 2.1 — Add 52 missing items via Zomato Partner App

**Method:** automated DevTools navigation to `partner.zomato.com/menu` from delivery-profile Chrome. Programmatic form-fill for each item:
- Name (from POS)
- Section assignment (from new section structure §3.2)
- Price (from POS `list_price`)
- Description (heritage-led for moat items — see §2.3)
- Veg/Non-veg flag
- Spice level (default Medium for Hyderabadi items)

**Photo upload:** **Nihaf-manual.** Automation pre-fills everything else, leaves a flagged "needs photo" status. Photos in `~/Desktop/HE_Listing_Photos_2026-05-10/` — the manifest there maps photo file → item name. Nihaf opens each "needs photo" row and drags from Desktop.

**Bulk-add ordering:** items added in priority sequence so partial completion still ships value:
1. Hyderabadi mutton menu (the moat) — 23 items
2. Tandoori starters — 4 items (Garlic Kabab, Haryali Tikka, Barbeque Chicken Boona, Pathak Kabab — Mutton Sheekh Kabab is in mutton list)
3. Missing Biryani items on Zomato (Chicken Boneless, Egg, Thethar) — 3 items
4. Shawarma + Chicken Kathi Roll — 2 items
5. Chinese expansion — 10 items
6. Combos missing on Zomato — 4 items
7. Remainder — 6 items

### 2.2 — Reorganize sections per Heritage framing

**Current Zomato section structure (8 sections):**
Combos · Platter · Starters · Main Course · Breads · Rice and Biryani · Fried Rice and Noodles · Rolls

**New target section structure (10 sections, ordered top-to-bottom):**

1. **Combos & Hero Boxes** (rename from "Combos", host the Hero Box ₹459 from the playbook at top)
2. **Hamza Heritage 1918 — Signature Mutton** (NEW — moves all mutton from Main Course here; THIS is the visual identity)
3. **Hyderabadi Dakhni Biryani** (rename from "Rice and Biryani"; lift Mutton/Chicken/Boneless/Egg/Thethar Biryani out of Main Course here)
4. **Tandoori & Kebabs — Hyderabadi Style** (rename from "Starters" + "Platter"; merge)
5. **Chicken Curries — North Indian + Hyderabadi** (split out chicken curries from Main Course)
6. **Rolls & Quick Bites** (rename from "Rolls"; host new Shawarma + Chicken Kathi Roll alongside existing rolls)
7. **Chinese — Indo-Chinese Favourites** (rename from "Fried Rice and Noodles"; expand to include the 10 missing items)
8. **Vegetarian** (split out from Main Course)
9. **Breads** (existing)
10. **Beverages** (NEW — Zomato doesn't currently surface; add the 3 Swiggy bevs)

### 2.3 — Heritage-led descriptors (the copy that converts)

Replace generic auto-templates with copy that monetises the 1918 Dakhni heritage. Format: **2-sentence emotional hook + factual specifics + serves info.**

**Mutton items** — every one gets the heritage frame:

| Item | Description (ready to paste) |
|---|---|
| **Mutton Brain Dry** | "Tender mutton brain slow-cooked with our 1918 Hamza family masala — minced fine and dry-roasted till each piece is crusted with spice. The Dakhni delicacy four generations of Bangalore have asked for by name. Serves 1." |
| **Mutton Hamza Special** | "The dish that built our reputation since 1918. Slow-cooked mutton in a deep onion-tomato gravy with cardamom, mace, and the Hamza family's secret garam masala blend. Pairs perfectly with ghee rice or naan. Serves 1-2." |
| **Mutton Biryani** | "Slow-cooked tender mutton in our 1918 family Dakhni masala. Layered with aged basmati, dum-cooked over coal till the rice carries every flavour. The recipe four generations of Hamza chefs have guarded. Serves 1." |
| **Thethar Biryani** | "Premium mutton cuts — bone-in, marrow-rich — slow-cooked Hyderabadi style with extra masala intensity. The biryani we serve at our family weddings. Serves 1." |
| **Thethar Pepper Roast** | "Premium mutton dry-roasted with crushed black pepper and curry leaves, finished in a smoking-hot kadai. The flagship of our Dakhni grill repertoire. Serves 1-2." |
| **Mutton Chatpata** | "Boneless mutton tossed in a tangy-spicy dry masala — chillies, lemon, fresh coriander. Built for hand-eating with naan or roti. Serves 1." |
| **Mutton Kolhapuri** | "Mutton in the fiery Maharashtrian Kolhapuri masala — coconut, sesame, chilli, our own spice grind. Bring it down with ghee rice or paratha. Serves 1." |
| **Mutton Hyderabadi Gravy** | "Classic Hyderabadi mutton — yakhni-based gravy slow-cooked till the meat falls off the bone. The dish my great-grandfather perfected in 1918. Serves 1-2." |
| **Mutton Pepper Dry** | "Boneless mutton stir-fried with crushed black pepper and curry leaves, finished dry. The South-meets-North Hyderabadi classic. Serves 1." |
| **Mutton Pepper Roast** | "Bone-in mutton dry-roasted in pepper and ghee till the spice crust caramelises. Hyderabadi soul food. Serves 1-2." |

(The remaining 13 mutton items get descriptor templates following the same pattern — generated in Phase 2.3 batch as `data/snapshots/aggregator-listing/he-heritage-descriptors-2026-05-10.json`.)

**Tandoori items** — Dakhni-grill heritage frame:

| Item | Description |
|---|---|
| **Garlic Kabab** | "Minced chicken seekh kabab pounded with roasted garlic, ginger, and our family green-chilli paste — grilled over coal. Serves 1." |
| **Haryali Tikka** | "Boneless chicken marinated in a fresh-coriander-mint paste with hung curd, char-grilled in the tandoor. Light, herbaceous, Dakhni-style. Serves 1." |
| **Barbeque Chicken (Boona)** | "Bone-in chicken marinated overnight in a smoky barbecue masala — char-grilled till the edges crisp. The Hyderabadi answer to a Sunday roast. Serves 1-2." |
| **Mutton Sheekh Kabab** | "Hand-minced mutton seasoned with raw papaya, garam masala, and our Hamza spice blend — skewered and char-grilled. Serves 1." |
| **Pathak Kabab** | "Bone-in chicken pieces marinated in our family Dakhni rub — slow-cooked then flame-finished. Serves 1." |

**Combos (Hero Box etc.):** descriptor leads with "Most-ordered combo" framing (badge psychology).

**Chinese / Veg / Bevs:** functional descriptors — no heritage frame needed (these aren't moat items, they're table-stakes).

### 2.4 — Apply badges (Zomato-exposed labels)

| Badge | Items |
|---|---|
| **Bestseller** | Chicken Biryani, Mutton Biryani, Tandoori Chicken (existing) |
| **Chef's Special** | Mutton Brain Dry, Mutton Hamza Special, Thethar Biryani, Thethar Pepper Roast |
| **New** | Shawarma, Chicken Kathi Roll, Garlic Kabab, Haryali Tikka, Barbeque Chicken (Boona), Pathak Kabab, Mutton Sheekh Kabab, all newly-added Mutton items, Chinese expansion items |
| **Recommended** (if Zomato exposes this — TBD in Phase 1 audit) | Hero Box ₹459, Mutton Biryani, Hamza Special Chicken |

### 2.5 — Restaurant profile enrichment

- **Story / About us field** (location TBD in Phase 1 audit): "Hamza Express is the QSR arm of the Hamza family, in the Bangalore food trade since 1918. Four generations of Dakhni cuisine — Hyderabadi mutton, slow-cooked biryani, tandoor kebabs — served fast for delivery. Located in the heart of Shivajinagar, walking distance from MG Road, Commercial Street, and Brigade Road."
- **Cuisine tags** (currently: North Indian, Biryani, Chinese, Mughlai): add **Hyderabadi**, **Dakhni** if Zomato exposes them as tags; verify in audit.
- **Cover photo** (Nihaf manual): one of the Hero Box / Mutton Brain Dry photos — heritage-style, not generic.
- **Address / map pin precision**: verify pin lands at 22 H.K.P Road exactly.

---

## Phase 3 · Zomato positioning validation (Day 4, ~2 hours)

After Phase 2 deploys, do a closed-loop verification:

### 3.1 — Re-scrape consumer page
Same DevTools tunnel script that captured the baseline. Compare new structure vs target.

### 3.2 — Visual diff against competitor screenshots
Open `~/Desktop/Competitor_Listings_2026-05-10/` PNGs side-by-side. For each axis (cover photo, top-section choice, badge density, descriptor depth, offer-card stack), score HE vs the best 3 competitors on that axis.

### 3.3 — Algorithm health check
- Pull Zomato Menu Score (their own analytics) 24h after deploy
- Pull search-term inbound report — see what queries HE is now ranking for
- Pull funnel: impressions → menu opens → cart builds → orders. Compare to pre-Phase-2 baseline.

### 3.4 — Set up monitoring
Add a daily cron that:
- Hits `/api/aggregator-pulse?action=parsed&platform=zomato&brand=he&period=today`
- Compares item count in `daily.points` for last 3 days vs baseline
- Alerts (WABA notification to Nihaf) if item count drops more than 10% (menu drift / item-disabled detection)

### 3.5 — Output of Phase 3

**Zomato is "fully optimized" when:**
- All 140 in-scope POS items present on Zomato listing
- All 10 sections renamed + reordered per §2.2
- All Mutton + Tandoori items have heritage descriptors per §2.3
- All badges per §2.4 assigned where Zomato exposes them
- Restaurant Story field populated per §2.5
- Photo coverage at ≥95% (bottlenecked on Nihaf-manual upload)
- Menu Score (Zomato's own metric) ≥75 — typical "good" threshold per Restaurant India research
- 7-day post-deploy: menu-opens-to-cart conversion ↑ ≥20% vs pre-Phase-2 baseline (the headline outcome metric)

---

## Phase 4 · Swiggy Partner Portal deep audit (Day 5, ~3 hours)

Same shape as Phase 1 but for Swiggy. **Different challenges:**
- Swiggy is more PoC-mediated for offers — much of what's "self-serve" on Zomato requires a KAM call on Swiggy
- Swiggy menu schema may have fields Zomato doesn't (and vice versa)
- Swiggy outlet-ID context is now post-fix (Phase 0.1) — verify outlet 1342888 is in fact HE on the Partner App side too

**Audit dimensions:** same 12 categories as Phase 1, adjusted for Swiggy-specific UI.

**Things to specifically watch for on Swiggy:**
- Markup-price field (lets you show inflated MRP next to selling price — visual discount perception without actual discount)
- "Try New" badge auto-applied while NEW status holds (when does it expire?)
- Combo SKU mechanics (Swiggy uses combos as menu items, not as offer objects)
- Self-Serve Ads UI access (verify auto-renewal is OFF — see playbook warning)

**Output:** `data/snapshots/aggregator-listing/swiggy-portal-audit-2026-05-10.md`

---

## Phase 5 · Swiggy listing completion + positioning (Day 6-7, ~8 hours)

Same shape as Phase 2-3 for Swiggy.

**57 missing items** added via:
- Self-serve menu UI for items where Swiggy supports it (most basic add)
- KAM call for items requiring backend config (probably not many)

**Section restructuring** — Swiggy has more sections than Zomato (12 today, 11 target):
1. **Combos & Hero Boxes** (existing "Combo Meals" renamed)
2. **Hamza Heritage 1918 — Signature Mutton** (NEW — same as Zomato §2.2)
3. **Hyderabadi Dakhni Biryani** (rename from "Biryani"; lift Thethar Biryani in)
4. **Tandoori & Kebabs — Hyderabadi Style** (rename from "Starters & Kebabs")
5. **Chicken Curries — North Indian + Hyderabadi** (rename from "Chicken Curries")
6. **Rolls & Quick Bites** (rename from "Rolls"; new Shawarma + Kathi Roll)
7. **Chinese — Indo-Chinese Favourites** (rename from "Chinese")
8. **Vegetarian** (existing)
9. **Rice & Pulao** (existing)
10. **Breads** (rename from "Indian Breads")
11. **Beverages + Salad + Egg Dishes** (consolidate — currently fragmented)

**Heritage descriptors:** same JSON file from Phase 2.3 — copy/paste.

**Badges:** same scheme as Zomato.

**Swiggy-specific moves:**
- Apply the Markup-price field to mutton items (show ₹350 → ₹329 visual without restaurant-funded discount)
- Confirm "Try New" badge is showing — it's a Swiggy-funded acquisition tag; if expired, ask KAM to re-flag
- Combo SKUs: ensure the Hero Box ₹459 from the playbook is built as a combo SKU on both platforms

---

## Phase 6 · Cross-platform validation + handoff (Day 8, ~2 hours)

### 6.1 — Side-by-side post-deploy comparison
Compare Zomato pre/post + Swiggy pre/post + against competitor screenshots. Score HE on each psychology axis. Should land in top-quartile of competitor set on every axis.

### 6.2 — Update the dashboards
Strict-HE-only dashboards at `/ops/aggregator/he/swiggy/` and `/he/zomato/` should reflect new menu structure. Specifically the "Listing Audit" tab on each should show ≥0 missing items (currently shows 57 / 52).

### 6.3 — Handoff document
Write `data/snapshots/aggregator-listing/POST-OPTIMIZATION-HANDOFF-2026-05-10.md`:
- What was changed (per platform)
- Before/after metrics (item counts, section counts, badge counts, descriptor depth)
- Daily monitoring plan
- Re-optimization triggers (when to redo: menu drift, new POS items, dropping conversion)

---

## Execution venue: hn-winpc setup

Everything happens on the Windows machine because:
1. Chrome there is in Bangalore geo (Swiggy/Zomato content adapts to it)
2. Both Partner App sessions are logged in there (no fresh login needed every time)
3. Tailscale + remote-debug already proven working

**Tools available on hn-winpc:**
- Chrome on port 9222 (delivery profile, our extension loaded — production capture path; DON'T disrupt it)
- Chrome on port 9223 (dining profile — different login, useful for parallel work)
- SSH with `ssh "HN Hotels@hn-winpc" '<cmd>'` pattern
- DevTools eval helper at `/tmp/devtools-eval.py` (already exists from earlier debug work)
- Watchdog auto-restarts delivery Chrome if it dies

**For this execution we'll use the delivery-profile Chrome (port 9222)** because that's logged into Zomato Partner App + Swiggy Partner App. The dining-profile Chrome stays untouched — multi-tenant courtesy with the other Claude session running there.

**A new session on hn-winpc Chrome should NOT disturb the production capture pipeline** — the extension keeps running, our Partner App tabs sit alongside.

---

## Two hyper-personalized intelligence layers — what they actually contain

When Phase 2 finishes, we save:

### `ops/intelligence/zomato-execution-layer-2026-05-10.md`
Per-item, ready-to-paste:
- Item name (POS-canonical)
- Section assignment (from §2.2)
- Price
- Heritage descriptor (from §2.3, full text)
- Badge to apply (from §2.4)
- Photo filename (from `~/Desktop/HE_Listing_Photos_2026-05-10/MANIFEST.json`)
- Owner-decision flags (where item needs custom variant pricing or unusual customization)
- DOM selector for the Zomato Partner App field (so future automations can re-find)

### `ops/intelligence/swiggy-execution-layer-2026-05-10.md`
Same shape but Swiggy-tuned. Notable differences:
- Markup-price suggestion per moat item
- Combo SKU build instructions (Swiggy treats combos as items)
- KAM contact-trigger items flagged separately (where automation can't go)
- Swiggy badge availability differences

These are NOT generic templates — they're HE-specific, ready to feed back into automation any time we need to re-deploy or audit drift.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Zomato/Swiggy session expires mid-execution** | Chrome cookies persist; re-auth via Nihaf phone OTP if needed (15 min interruption) |
| **Photo upload bottleneck (Nihaf manual)** | Items pre-loaded with metadata; "needs photo" flag lets Nihaf batch upload over 2-3 sittings |
| **Disrupting production capture pipeline** | Use the SAME logged-in Chrome (port 9222) but spawn separate tabs for Partner App — extension service worker keeps running on its existing tabs |
| **Multi-tenant chat collision on hn-winpc** | This work uses port 9222 (delivery profile) only; port 9223 (dining profile, owned by other chat) is left alone. Lock-file pattern in `C:\hn-control\.locks\` if needed |
| **Section-rename rejected by Zomato algorithm** | Some platforms penalise frequent menu changes; test with 1 section rename first, monitor 24h, then batch-rename the rest |
| **KAM unresponsive for backend changes** | Phase 2 maximises self-serve work; KAM-only items deferred to Phase 5b "blocked-on-KAM" handoff |
| **Item add → descriptor mismatch** | Validation script in Phase 3.1 fingerprints each item by hash(name+section+price+description) and alerts if any drift |

---

## Definition of Done (the litmus test)

**Zomato is done when:**
- Visit `https://www.zomato.com/bangalore/hamza-express-1-shivajinagar-bangalore/order` from a clean browser
- Cover photo is heritage-themed
- "Combos & Hero Boxes" section is first; Hero Box ₹459 is first item in it with "Most Ordered" badge
- "Hamza Heritage 1918 — Signature Mutton" is the second section, leads with Mutton Brain Dry
- Every Mutton item has a heritage-led descriptor (not the auto-template)
- 140 items visible (vs 79 today)
- Restaurant story field renders the 1918 line
- Menu Score ≥75 within 24h

**Swiggy is done when:** same checklist, applied to Swiggy customer URL `rest1342888`.

**Whole project is done when:** both above + the dashboards at `/ops/aggregator/he/{swiggy,zomato}/` show menu-opens-to-cart conversion ↑ ≥20% over the 7-day post-deploy window.

---

## Sequencing summary (visual)

```
Day 0:  PHASE 0 — Foundation fixes (outlet-ID flip + POS validation)
        ────────
Day 1:  PHASE 1 — Zomato Partner Portal deep audit
Day 2:  PHASE 2.1-2.2 — Zomato listing completion (52 items, sections)
Day 3:  PHASE 2.3-2.5 — Zomato descriptors, badges, profile
Day 4:  PHASE 3 — Zomato validation + monitoring
        ────────
Day 5:  PHASE 4 — Swiggy Partner Portal deep audit
Day 6:  PHASE 5.1-5.2 — Swiggy listing completion (57 items, sections)
Day 7:  PHASE 5.3-5.5 — Swiggy descriptors, badges, profile
Day 8:  PHASE 6 — Cross-platform validation + handoff
```

**Total: 8 working days. Photo-upload bottleneck (Nihaf-manual) is the only thing that can stretch this.**
