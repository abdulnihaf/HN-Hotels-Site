# Hamza Express · Swiggy Execution Layer
**Date:** 2026-05-10 · **Source data:** he-swiggy-parsed-2026-05-10.json · **Executor:** Claude  
**Outlet ID:** rest1342888 (confirmed = Hamza Express from consumer URL)  
**Purpose:** Ready-to-paste playbook for the Swiggy Partner App. All Swiggy-specific; do NOT copy-paste from Zomato layer — prices, section positions, and badge mechanisms differ.

---

## PHASE 0 STATUS: OUTLET-ID FIX

- **Extension fix deployed to hn-winpc:** ✓ `content-swiggy.js` OUTLETS map corrected to `{'1342888':'he','1342887':'nch'}`
- **D1 backfill migration written:** ✓ `migrations/backfill-swiggy-outlet-id-flip-2026-05-10.sql`
- **Apply migration:** `wrangler d1 execute <DB_NAME> --file=migrations/backfill-swiggy-outlet-id-flip-2026-05-10.sql`
- **Chrome debug port (9222):** Not binding in this session — extension picks up new code on next Chrome restart. Watchdog will trigger.

---

## STATUS SNAPSHOT

| Item | State |
|---|---|
| Swiggy consumer URL | `https://www.swiggy.com/city/bangalore/hamza-express-central-bangalore-rest1342888` |
| Current item count | **80 items** |
| Target item count | **~137 items** (80 existing + 57 to add; cold drinks deferred) |
| Current sections | 12 sections |
| Target sections | **11 sections** (consolidate Salad+Beverages+Egg Dishes) |
| Badge | "NEW" (Swiggy acquisition — TRYNEW 30% off active ✓) |
| Cuisine tags | Biryani, South Indian — both WRONG / incomplete |
| Restaurant-funded offers | **0** — all 5 active offers are platform/card funded |

---

## PART A — SWIGGY PROFILE FIXES (do first)

### A.1 — Cuisine Tags
**Current:** Biryani, South Indian  
**Issue:** "South Indian" is wrong — HE is Hyderabadi / North Indian / Dakhni  
**Change to:** Biryani, North Indian, Hyderabadi, Mughlai  
Partner App: Profile → Basic Info → Cuisine

### A.2 — Cost for Two
**Current:** ₹600 (high — likely auto-set)  
**Consider:** ₹500 (reflects AOV ₹464; lower = appears in more budget searches)  
Partner App: Profile → Pricing

### A.3 — Active Offers (CRITICAL GAP)
Zero restaurant-funded offers. Competitors with their own offers will out-position HE.  
**Add per playbook recommendations (partner.swiggy.com → Promotions → Create Offer):**

| Offer to create | Mechanic | Window | Cap |
|---|---|---|---|
| **Lunch 20% off** | % discount, min order ₹399 | Mon–Fri 12–3pm | ₹100 |
| **Weekend Feast 15% off** | % discount, min order ₹499 | Sat–Sun 12–4pm | ₹80 |

> ⚠️ Do NOT enable auto-renewal on Swiggy ads. Set end date explicitly. Screenshot the settings page after enabling.

### A.4 — "Try New" Badge
**Status:** TRYNEW (30% off upto ₹75) is ACTIVE — Swiggy-funded. Keep this until it expires.  
When it expires: ask your Swiggy PoC to check if HE qualifies for any new-restaurant booster extension.

---

## PART B — SECTION RESTRUCTURE

Target: 11 sections. Swiggy allows section rename and drag-to-reorder in Partner App → Menu.

| # (new order) | New Name | Action | Current Name |
|---|---|---|---|
| 1 | **Combos & Hero Boxes** | Rename | Combo Meals |
| 2 | **Hamza Heritage 1918 — Signature Mutton** | **Create NEW** | — |
| 3 | **Hyderabadi Dakhni Biryani** | Rename | Biryani |
| 4 | **Tandoori & Kebabs — Hyderabadi Style** | Rename | Starters & Kebabs |
| 5 | **Chicken Curries — North Indian + Hyderabadi** | Rename | Chicken Curries |
| 6 | **Rolls & Quick Bites** | Rename | Rolls |
| 7 | **Chinese — Indo-Chinese Favourites** | Rename | Chinese |
| 8 | **Vegetarian** | Keep | Vegetarian |
| 9 | **Rice & Pulao** | Keep | Rice & Pulao |
| 10 | **Breads** | Rename | Indian Breads |
| 11 | **Beverages, Salad & Egg Dishes** | Merge + rename | Beverages + Salad + Egg Dishes (merge 3→1) |

---

## PART C — EXISTING ITEMS: SECTION MOVES + DESCRIPTOR UPDATES

### C.1 — Items to MOVE to "Tandoori & Kebabs — Hyderabadi Style"

> Currently in "Starters & Kebabs". Rename section and update first-item order.

| Item | Current Price | Badge | Markup Price (show MRP) | Descriptor |
|---|---|---|---|---|
| **Kabab Platter** | ₹499 | — | ₹599 | "Assorted tandoori mix — Reshmi Kabab, Chicken Tikka, Malai Tikka, and Tandoori Chicken. The share platter. Serves 2-3." |
| **Kalmi Kabab** | ₹270 | — | ₹320 | "Bone-in chicken drumsticks marinated in our Hyderabadi rub — slow-cooked then flame-finished. Serves 2." |
| **American Chops** | ₹270 | — | ₹320 | "Bone-in chicken cuts marinated in smoky masala, grilled till charred at the edges. Serves 1-2." |
| **Chicken Tikka** | ₹265 | — | ₹310 | "Boneless chicken marinated in yogurt and our spice blend, skewered and char-grilled. The classic. Serves 1." |
| **Lemon Chicken** | ₹255 | — | ₹300 | "Crispy battered chicken tossed in lemon and spices — bright, tangy, and addictive. Serves 1." |
| **Andhra Tikka** | ₹250 | — | ₹290 | "Chicken tikka with an Andhra-Dakhni masala punch — turmeric, red chilli, curry leaf marinade, char-grilled. Serves 1." |
| **Malai Tikka** | ₹250 | — | ₹290 | "Boneless chicken marinated in hung curd, cream, and mild spices — delicate and smoky from the tandoor. A crowd-pleaser. Serves 1." |
| **Reshmi Kabab** | ₹240 | — | ₹280 | "Boneless chicken minced with cream, cashew, and fresh coriander — melt-in-the-mouth seekh kabab from the tandoor. Serves 1." |
| **Irani Chicken** | ₹230 | — | ₹270 | "Bone-in chicken marinated in an Irani-style dry rub — aromatic, spiced, and flame-charred. Serves 1." |
| **Chicken 65** | ₹230 | — | ₹270 | "Crispy deep-fried chicken marinated in ginger-garlic and red chilli — the South Indian classic. Serves 1." |
| **Chicken Kabab** | ₹210 | Bestseller | ₹250 | "Minced chicken seekh kabab — our most-reordered starter. Char-grilled fresh. Serves 1." |
| **Chicken Lollipop** | ₹200 | — | ₹240 | "French-trimmed drumettes in a spicy batter, deep-fried crisp. Serves 1." |
| **Chicken Pepper Dry** | ₹235 | — | ₹275 | "Boneless chicken stir-fried with crushed black pepper and curry leaves. Serves 1." |
| **Chicken Singapuri** | ₹255 | — | — | "Chicken in a Singapore-style sweet-spicy sauce. Serves 1." |
| **Chicken Chatpata** | ₹235 | — | ₹275 | "Boneless chicken in a tangy-spicy dry masala. Serves 1." |

> **Note on Markup Price:** In Swiggy Partner App, the "Item MRP / Strikethrough Price" field lets you show a higher MRP crossed out next to the selling price. This creates a visual discount perception. Apply to moat items. Cap markup at ~20% above selling price. This is NOT a real discount — just visual anchoring. Verify field availability in your Swiggy Partner App version.

### C.2 — Items to MOVE to "Chicken Curries — North Indian + Hyderabadi" (stay in same section, just rename)

| Item | Current Price | Descriptor |
|---|---|---|
| **Butter Chicken** | ₹225 | "Tender chicken in our rich tomato-cream Makhani gravy — the familiar North Indian classic. Pairs with Butter Naan. Serves 1." |
| **Hamza Special Chicken** | ₹220 | "The Hamza family's signature chicken preparation since 1918 — slow-cooked in a deep onion-tomato gravy with our secret garam masala. Pairs with ghee rice or naan. Serves 1-2." |
| **Kadai Chicken** | ₹225 | "Chicken in a dry-style onion-tomato-pepper masala, finished in the kadai. Serves 1." |
| **Methi Chicken** | ₹225 | "Chicken cooked with fresh fenugreek leaves and spices — the earthy Punjabi classic. Serves 1." |
| **Hyderabadi Chicken** | ₹225 | "Chicken in a classic Hyderabadi yakhni-base gravy with whole spices. Serves 1." |
| **Chicken Kolhapuri Gravy** | ₹210 | "Fiery Kolhapuri-style chicken — coconut, sesame, red chilli. Intense heat, deep flavour. Serves 1." |
| **Chicken Masala** | ₹225 | "Chicken in a robust North Indian masala — onion-tomato-ginger-garlic base. Serves 1." |
| **Mughlai Chicken** | ₹245 | "Rich nut-based Mughlai gravy with tender chicken — full, aromatic, pairs with any bread. Serves 1." |
| **Chicken Kalimirch** | ₹225 | "Chicken cooked in crushed black pepper and cream — the mild-heat specialty. Serves 1." |
| **Tandoori Chicken Masala** | ₹295 | "Char-grilled tandoori chicken pieces finished in a rich Makhani-style sauce. Two flavours in one. Serves 1." |
| **Chicken Tikka Masala** | ₹300 | "Char-grilled tikka pieces in a thick Mughlai-style gravy, deep with spice. Serves 1." |
| **Punjabi Chicken** | ₹235 | "Classic Punjabi chicken masala — onion-tomato-ginger-garlic, robust spice. Serves 1." |
| **Chicken Do Pyaza** | ₹235 | "Double-onion chicken — onions added at two stages, deep sweetness balancing the spice. Serves 1." |

### C.3 — Items to STAY in "Hyderabadi Dakhni Biryani" (rename section, update descriptors)

| Item | Current Price | Badge | Descriptor |
|---|---|---|---|
| **Mutton Biryani** | ₹350 | Bestseller | "Slow-cooked tender mutton in our 1918 family Dakhni masala. Layered with aged basmati, dum-cooked over coal till the rice carries every flavour. The recipe four generations of Hamza chefs have guarded. Serves 1." |
| **Chicken Biryani** | ₹275 | Bestseller | "Chicken dum biryani — tender pieces layered with aged basmati and slow-cooked in our Dakhni masala. The weekday staple. Serves 1." |
| **Chicken Boneless Biryani** | ₹280 | — | "Boneless chicken dum biryani — same slow-cooked recipe, easier eating. Serves 1." |
| **Egg Biryani** | ₹190 | — | "Dum-cooked basmati with boiled eggs and our biryani masala. Entry-point biryani, full on flavour. Serves 1." |

### C.4 — Items to STAY in "Chinese — Indo-Chinese Favourites" (rename section)

| Item | Current Price | Descriptor |
|---|---|---|
| **Chilli Chicken** | ₹220 | "Crispy chicken tossed in a spicy, tangy Chilli Chicken sauce. Serves 1." |
| **Chicken Manchurian** | ₹220 | "Crispy chicken balls in Manchurian gravy — the Indo-Chinese classic. Serves 1." |
| **Singapore Chicken** | ₹220 | "Chicken in a Singapore-style sweet-spicy sauce. Serves 1." |
| **Garlic Chicken** | ₹235 | "Boneless chicken tossed in roasted garlic, green chilli, and butter. Serves 1." |
| **Veg Fried Rice** | ₹160 | "Wok-tossed basmati with vegetables and soy. Serves 1." |
| **Egg Fried Rice** | ₹180 | "Classic wok-tossed rice with scrambled egg. Serves 1." |
| **Prawns Fried Rice** | ₹230 | "Wok-tossed rice with prawns. Serves 1." |
| **Mix Fried Rice** | ₹250 | "Mixed veg and chicken fried rice. Serves 1." |
| **Chicken Noodles** | ₹190 | "Stir-fried noodles with chicken strips. Serves 1." |
| **Prawns Noodles** | ₹230 | "Stir-fried noodles with prawns. Serves 1." |
| **Veg Schezwan Noodles** | ₹200 | "Noodles tossed in Schezwan sauce — hot, tangy, addictive. Serves 1." |

### C.5 — Items to STAY in "Vegetarian" (update descriptors)

| Item | Current Price | Descriptor |
|---|---|---|
| **Kadai Paneer** | ₹180 | "Paneer chunks in a dry Kadai masala — crisp edges, smoky finish. Serves 1." |
| **Palak Paneer** | ₹200 | "Cottage cheese in fresh spinach gravy. The classic North Indian green. Serves 1." |
| **Paneer Butter Masala** | ₹180 | "Paneer in Makhani sauce — the crowd-pleasing classic. Serves 1." |
| **Paneer Matar Masala** | ₹200 | "Paneer and green peas in a tomato-onion gravy. Serves 1." |
| **Malai Kofta** | ₹240 | "Potato-paneer dumplings in a saffron-cream sauce. Rich and indulgent. Serves 1." |
| **Aloo Gobi** | ₹180 | "Dry potato and cauliflower stir-fry with turmeric and spices. Serves 1." |
| **Gobi Masala** | ₹160 | "Cauliflower in a rich masala sauce. Serves 1." |
| **Dal Tadka** | ₹120 | "Yellow lentils tempered with jeera, garlic, and dried chilli. Comfort food. Serves 1." |

### C.6 — Items to STAY in "Rice & Pulao"

| Item | Current Price | Note |
|---|---|---|
| **Biryani Rice** | ₹120 | Keep |
| **Ghee Rice** | ₹100 | Keep |
| **Jeera Rice** | ₹130 | Keep |
| **Curd Rice** | ₹100 | Keep |

### C.7 — Items to STAY in "Rolls & Quick Bites" (rename from Rolls)

| Item | Current Price | Descriptor |
|---|---|---|
| **Chicken Roll** | ₹115 | "Spiced chicken filling wrapped in a flaky maida paratha — our most-grabbed quick bite. Serves 1." |
| **Egg Roll** | ₹115 | "Egg-coated paratha wrapped around spiced filling. The street classic. Serves 1." |
| **Paneer Roll** | ₹115 | "Paneer tikka filling wrapped in a flaky maida paratha. Serves 1." |

### C.8 — Items to STAY in "Combos & Hero Boxes" (rename from Combo Meals)

Reorder so anchor items are at top:

| # | Item | Price |
|---|---|---|
| 1 | Full Loaded Combo | ₹619 |
| 2 | Mutton Biryani + Chicken Lollipop | ₹495 |
| 3 | Chicken Biryani + Chicken Kabab | ₹339 |
| 4 | Ghee Rice + Butter Chicken + Chicken Kabab | ₹299 |
| 5 | Butter Naan + Butter Chicken + Chicken Kabab | ₹269 |
| 6 | Chicken Biryani + 2pc Kabab *(NEW — to add)* | ~₹230 |
| 7 | Ghee Rice + Butter Chicken | ₹219 |
| 8 | Ghee Rice With Dal Fry | ₹219 |
| 9 | Biryani Rice + Chicken Kabab | ₹219 |
| 10 | Butter Naan + Butter Chicken | ₹219 |

### C.9 — Items to CONSOLIDATE into "Beverages, Salad & Egg Dishes"

Currently 3 separate sections (Beverages + Salad + Egg Dishes). Merge into one section named "Beverages, Salad & Egg Dishes". Keep all 5 items.

| Item | Price |
|---|---|
| Thums Up (300ml) | ₹39 |
| Sprite (300ml) | ₹40 |
| Pepsi (300ml) | ₹39 |
| Onion Salad | ₹29 |
| Egg Masala | ₹150 |

---

## PART D — NEW ITEMS TO ADD TO SWIGGY (57 items, priority-ordered)

### Priority 1: Mutton Heritage Menu (24 items)

| # | Item Name | Section | Price | Markup MRP | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|---|
| 1 | **Mutton Brain Dry** | Hamza Heritage 1918 | ₹160 | ₹200 | Chef's Special | "Tender mutton brain slow-cooked with our 1918 Hamza family masala — minced fine and dry-roasted till each piece is crusted with spice. The Dakhni delicacy four generations of Bangalore have asked for by name. Serves 1." | MuttonBrainDry.png |
| 2 | **Mutton Hamza Special** | Hamza Heritage 1918 | ₹240 | ₹299 | Chef's Special | "The dish that built our reputation since 1918. Slow-cooked mutton in a deep onion-tomato gravy with cardamom, mace, and the Hamza family's secret garam masala blend. Serves 1-2." | MuttonHamzaSpecial.png |
| 3 | **Thethar Pepper Roast** | Hamza Heritage 1918 | ₹320 | ₹399 | Chef's Special | "Premium mutton dry-roasted with crushed black pepper and curry leaves, finished in a smoking-hot kadai. The flagship of our Dakhni grill repertoire. Serves 1-2." | ThetharPepperRoast.png |
| 4 | **Thethar Pepper Dry** | Hamza Heritage 1918 | ₹300 | ₹369 | — | "Premium bone-in mutton in a fiery dry-pepper masala — intense, rustic, unmistakably Dakhni. Serves 1-2." | ThetharPepperDry.png |
| 5 | **Mutton Chatpata** | Hamza Heritage 1918 | ₹230 | ₹279 | New | "Boneless mutton tossed in a tangy-spicy dry masala — chillies, lemon, fresh coriander. Built for hand-eating with naan or roti. Serves 1." | MuttonChatpata.png |
| 6 | **Mutton Hyderabadi Gravy** | Hamza Heritage 1918 | ₹220 | ₹269 | — | "Classic Hyderabadi mutton — yakhni-based gravy slow-cooked till the meat falls off the bone. The dish my great-grandfather perfected in 1918. Serves 1-2." | MuttonHyderabadiGravy.png |
| 7 | **Mutton Pepper Dry** | Hamza Heritage 1918 | ₹210 | ₹260 | — | "Boneless mutton stir-fried with crushed black pepper and curry leaves, finished dry. The South-meets-North Hyderabadi classic. Serves 1." | MuttonPepperDry.png |
| 8 | **Mutton Pepper (Roast)** | Hamza Heritage 1918 | ₹220 | ₹269 | — | "Bone-in mutton dry-roasted in pepper and ghee till the spice crust caramelises. Hyderabadi soul food. Serves 1-2." | MuttonPepperRoast.png |
| 9 | **Mutton Kolhapuri** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Mutton in the fiery Kolhapuri masala — coconut, sesame, chilli, our own spice grind. Serves 1." | MuttonKolhapuri.png |
| 10 | **Mutton Kolhapuri Gravy** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Rich Kolhapuri-style mutton gravy — intense chilli heat balanced with coconut and sesame. Serves 1." | MuttonKolhapuriGravy.png |
| 11 | **Mutton Masala** | Hamza Heritage 1918 | ₹210 | ₹260 | — | "Mutton in a robust North Indian masala — onion-tomato-ginger-garlic, slow-cooked till rich. Serves 1." | MuttonMasala.png |
| 12 | **Mutton Rogan Josh** | Hamza Heritage 1918 | ₹210 | ₹260 | — | "Kashmiri-influenced mutton — slow-cooked in fennel, dried ginger, and a scarlet spice paste. Aromatic and warming. Serves 1." | MuttonRoganJosh.png |
| 13 | **Kadai Mutton** | Hamza Heritage 1918 | ₹220 | ₹269 | — | "Mutton in a dry-style kadai masala — tomatoes, peppers, and whole spices, finished in the iron wok. Serves 1." | KadaiMutton.png |
| 14 | **Methi Mutton** | Hamza Heritage 1918 | ₹210 | ₹260 | — | "Mutton cooked with fresh fenugreek leaves — the earthy bitterness of methi elevating the slow-cooked meat. Serves 1." | MethiMutton.png |
| 15 | **Mutton Kassa** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Dry-style mutton with whole spices — a thick, rich masala coating on each piece. Serves 1." | MuttonKassa.png |
| 16 | **Mutton Khima** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Minced mutton cooked with onions, tomatoes, and green chillies — the Dakhni kheema. Best with naan. Serves 1." | MuttonKhima.png |
| 17 | **Mutton Punjabi** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Mutton in a bold Punjabi-style masala — strong, hearty, North Indian. Serves 1." | MuttonPunjabi.png |
| 18 | **Mutton Sagwala** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Mutton slow-cooked with fresh spinach and spices — the saagwala classic. Serves 1." | MuttonSagwala.png |
| 19 | **Mutton Achari** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Mutton in a tangy pickle-spice masala — mustard seeds, fenugreek, dried chillies. Unique and punchy. Serves 1." | MuttonAchari.png |
| 20 | **Mutton Tadka** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Mutton in a tarka-style gravy — tempering of whole spices finishing a slow-cooked base. Serves 1." | MuttonTadka.png |
| 21 | **Mutton Chops** | Hamza Heritage 1918 | ₹230 | ₹279 | — | "Bone-in mutton chops slow-cooked in a rich masala — meaty, succulent. Serves 1." | MuttonChops.png |
| 22 | **Mutton Gurda Dry** | Hamza Heritage 1918 | ₹210 | ₹260 | — | "Mutton kidney dry-roasted in a pungent masala — the offal specialist's choice. Serves 1." | MuttonGurdaDry.png |
| 23 | **Mutton Brain** | Hamza Heritage 1918 | ₹160 | ₹200 | — | "Mutton brain slow-cooked in our Hyderabadi masala — rich, delicate, with a depth of flavour that's uniquely Dakhni. Serves 1." | MuttonBrain.png |
| 24 | **Thethar Biryani** | Hyderabadi Dakhni Biryani | ₹270 | ₹329 | Chef's Special | "Premium mutton cuts — bone-in, marrow-rich — slow-cooked Hyderabadi style with extra masala intensity. The biryani we serve at our family weddings. Serves 1." | ThetharBiryani.png |

### Priority 2: Tandoori Additions (5 items — Swiggy missing Haryali Tikka too)

| # | Item Name | Section | Price | Markup MRP | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|---|
| 25 | **Garlic Kabab** | Tandoori & Kebabs | ₹240 | ₹290 | New | "Minced chicken seekh kabab pounded with roasted garlic, ginger, and our family green-chilli paste — grilled over coal. Serves 1." | GarlicKabab.png |
| 26 | **Haryali Tikka** | Tandoori & Kebabs | ₹240 | ₹290 | New | "Boneless chicken marinated in a fresh-coriander-mint paste with hung curd, char-grilled in the tandoor. Light, herbaceous, Dakhni-style. Serves 1." | HaryaliTikka.png |
| 27 | **Mutton Sheekh Kabab** | Tandoori & Kebabs | ₹150 | ₹190 | New | "Hand-minced mutton seasoned with raw papaya, garam masala, and our Hamza spice blend — skewered and char-grilled. Serves 1." | MuttonShekhKabab.png |
| 28 | **Pathak Kabab** | Tandoori & Kebabs | ₹230 | ₹279 | New | "Bone-in chicken pieces marinated in our family Dakhni rub — slow-cooked then flame-finished. Serves 1." | PathakKabab.png |
| 29 | **Barbeque Chicken (Boona)** | Tandoori & Kebabs | ₹220 | ₹270 | New | "Bone-in chicken marinated overnight in a smoky barbecue masala — char-grilled till the edges crisp. The Hyderabadi answer to a Sunday roast. Serves 1-2." | **No photo — shoot at outlet** |

### Priority 3: Rolls & Quick Bites (2 items)

| # | Item Name | Section | Price | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|
| 30 | **Chicken Kathi Roll** | Rolls & Quick Bites | ₹90 | New | "Spiced chicken filling wrapped in a flaky maida paratha with chutney and onions. The classic Kathi Roll. Serves 1." | ChickenKathiRoll.png |
| 31 | **Shawarma** | Rolls & Quick Bites | ₹80 | New | "Chicken shawarma — marinated chicken, garlic sauce, pickled vegetables, wrapped tight. Serves 1." | **No photo — shoot at outlet** |

### Priority 4: Chinese Additions (10 items)

| # | Item Name | Section | Price | Descriptor | Photo |
|---|---|---|---|---|---|
| 32 | **Mutton Fried Rice** | Chinese — Indo-Chinese | ₹230 | "Wok-tossed rice with mutton strips — the most premium fried rice on the menu. Serves 1." | MuttonFriedRice.png |
| 33 | **Mutton Noodles** | Chinese — Indo-Chinese | ₹230 | "Stir-fried noodles with mutton. Serves 1." | MuttonNoodles.png |
| 34 | **Shezwan Mutton** | Chinese — Indo-Chinese | ₹230 | "Mutton in fiery Schezwan sauce — Chinese-style heat meets Hyderabadi spice. Serves 1." | ShezwanMutton.png |
| 35 | **Shezwan Chicken** | Chinese — Indo-Chinese | ₹230 | "Chicken tossed in Schezwan sauce — hot, tangy, bold. Serves 1." | ShezwanChicken.png |
| 36 | **Shezwan Fried Rice** | Chinese — Indo-Chinese | ₹200 | "Fried rice tossed in Schezwan sauce — spicy and smoky. Serves 1." | ShezwanFriedRice.png |
| 37 | **Shezwan Noodles** | Chinese — Indo-Chinese | ₹200 | "Noodles tossed in Schezwan sauce — the spicy version. Serves 1." | ShezwanNoodles.png |
| 38 | **Mix Noodles** | Chinese — Indo-Chinese | ₹240 | "Mixed veg and chicken noodles — the combo plate. Serves 1." | MixNoodles.png |
| 39 | **Chicken Fried Rice** | Chinese — Indo-Chinese | ₹190 | "Wok-tossed rice with chicken strips, egg, and soy. Serves 1." | ChickenFriedRice.png |
| 40 | **Hongkong Chicken** | Chinese — Indo-Chinese | ₹220 | "Crispy fried chicken in a sweet-tangy Hong Kong-style sauce. Serves 1." | HongkongChicken.png |
| 41 | **Veg Noodles** | Chinese — Indo-Chinese | ₹150 | "Stir-fried noodles with crisp vegetables, Indo-Chinese style. Serves 1." | VegNoodles.png |

### Priority 5: Chicken Curry Additions (5 items)

| # | Item Name | Section | Price | Descriptor | Photo |
|---|---|---|---|---|---|
| 42 | **Chicken Burtha** | Chicken Curries | ₹265 | "Flame-charred chicken cooked in a spiced tomato-onion gravy — smoky, earthy. Serves 1." | ChickenBurtha.png |
| 43 | **Chicken Dopiyaza** | Chicken Curries | ₹235 | "Double-onion chicken — onions added at two stages, deep sweetness balancing the spice. Serves 1." | — |
| 44 | **Chicken Hyderabadi Gravy** | Chicken Curries | ₹210 | "Chicken in a classic Hyderabadi yakhni-base gravy with whole spices. Serves 1." | — |
| 45 | **Chicken Kali Mirch** | Chicken Curries | ₹210 | "Chicken cooked in crushed black pepper and cream — the mild-heat specialty. Serves 1." | — |
| 46 | **Chicken Saagwala** | Chicken Curries | ₹220 | "Chicken in fresh spinach gravy — the Punjabi classic. Serves 1." | ChickenSaagwala.png |

### Priority 6: Other additions

| # | Item Name | Section | Price | Note | Photo |
|---|---|---|---|---|---|
| 47 | **Grill Chicken** | Tandoori & Kebabs | ₹240 | Grilled chicken half. | GrillChicken.png |
| 48 | **Daal Fry** | Vegetarian | ₹130 | Add to Vegetarian section. | — |
| 49 | **Mixed Veg Curry** | Vegetarian | ₹200 | "Seasonal vegetables in a North Indian gravy. Serves 1." | **No photo — shoot at outlet** |
| 50 | **Mushroom Masala** | Vegetarian | ₹180 | "Button mushrooms in a rich tomato-onion masala. Serves 1." | MushroomMasala.png |
| 51 | **Veg Kofta** | Vegetarian | ₹220 | "Deep-fried vegetable dumplings in a creamy onion-tomato sauce. Serves 1." | — |
| 52 | **Paneer Mutter Masala** | Vegetarian | ₹200 | "Paneer and green peas in a tomato-onion gravy. Serves 1." | — |
| 53 | **Plain Rice** | Rice & Pulao | ₹50 | "Steamed basmati rice. Serves 1." | — |

> **NOT adding:** Cold drink 1L, Cold drink 500ml (below margin threshold at 24.6% commission)

---

## PART E — SECTION ITEM ORDER

### E.1 — Combos & Hero Boxes (section 1)
1. Full Loaded Combo ₹619 *(anchor)*
2. Mutton Biryani + Chicken Lollipop ₹495
3. Chicken Biryani + Chicken Kabab ₹339
4. Ghee Rice + Butter Chicken + Chicken Kabab ₹299 *(Most Ordered badge)*
5. Ghee Rice + Mutton Chatpata + 2pc Kabab ₹290 *(new — premium)*
6. Chicken Biryani + 2pc Kabab ₹230 *(new)*
7. Butter Naan + Butter Chicken + Chicken Kabab ₹269
8. Ghee Rice + Butter Chicken ₹219
9. Ghee Rice With Dal Fry ₹219
10. Biryani Rice + Chicken Kabab ₹219
11. Butter Naan + Butter Chicken ₹219

### E.2 — Hamza Heritage 1918 — Signature Mutton (section 2 — THE HERO SECTION)
1. Mutton Brain Dry ₹160 *(Chef's Special — leads)*
2. Thethar Pepper Roast ₹320 *(anchor-high)*
3. Mutton Hamza Special ₹240 *(Chef's Special)*
4. Thethar Pepper Dry ₹300
5. Mutton Chatpata ₹230
6. Mutton Chops ₹230
7. Mutton Kolhapuri ₹230
8. Mutton Kassa ₹230
9. Mutton Hyderabadi Gravy ₹220
10. Mutton Pepper (Roast) ₹220
11. Kadai Mutton ₹220
12. Mutton Achari ₹230
13. Mutton Gurda Dry ₹210
14. Mutton Khima ₹230
15. Mutton Punjabi ₹230
16. Mutton Sagwala ₹230
17. Mutton Tadka ₹230
18. Mutton Masala ₹210
19. Methi Mutton ₹210
20. Mutton Rogan Josh ₹210
21. Mutton Pepper Dry ₹210
22. Mutton Kolhapuri Gravy ₹230
23. Mutton Brain ₹160
24. Mutton Sagwala ₹230

### E.3 — Hyderabadi Dakhni Biryani (section 3)
1. Mutton Biryani ₹350 *(anchor)*
2. Thethar Biryani ₹270 *(new, Chef's Special — premium decoy)*
3. Chicken Boneless Biryani ₹280
4. Chicken Biryani ₹275
5. Egg Biryani ₹190

### E.4 — Tandoori & Kebabs (section 4)
1. Kabab Platter ₹499 *(anchor)*
2. Kalmi Kabab ₹270
3. American Chops ₹270
4. Mutton Sheekh Kabab ₹150 *(low anchor — entry)*
5. Garlic Kabab ₹240 *(New)*
6. Pathak Kabab ₹230 *(New)*
7. Grill Chicken ₹240
8. Haryali Tikka ₹240 *(New)*
9. Barbeque Chicken (Boona) ₹220 *(New)*
10. Chicken Tikka ₹265
11. Chicken Kabab ₹210 *(Bestseller)*
12. Lemon Chicken ₹255
13. Malai Tikka ₹250
14. Andhra Tikka ₹250
15. Reshmi Kabab ₹240
16. Irani Chicken ₹230
17. Chicken 65 ₹230
18. Chicken Lollipop ₹200
19. Chicken Pepper Dry ₹235
20. Chicken Singapuri ₹255
21. Chicken Chatpata ₹235

---

## PART F — BADGE ASSIGNMENTS

| Item | Badge |
|---|---|
| Mutton Biryani | **Bestseller** |
| Chicken Biryani | **Bestseller** |
| Chicken Kabab | **Bestseller** |
| Mutton Brain Dry | **Chef's Special** |
| Mutton Hamza Special | **Chef's Special** |
| Thethar Biryani | **Chef's Special** |
| Thethar Pepper Roast | **Chef's Special** |
| Hamza Special Chicken | **Chef's Special** |
| Ghee Rice + Butter Chicken + Chicken Kabab | **Most Ordered** |
| Garlic Kabab | **New** |
| Haryali Tikka | **New** |
| Mutton Sheekh Kabab | **New** |
| Pathak Kabab | **New** |
| Barbeque Chicken (Boona) | **New** |
| Chicken Kathi Roll | **New** |
| Shawarma | **New** |
| Mutton Chatpata | **New** |
| Thethar Pepper Dry | **New** |

---

## PART G — SWIGGY-SPECIFIC ACTIONS (not in Zomato layer)

### G.1 — Markup Price (Strikethrough MRP)
Apply to all moat items in "Hamza Heritage 1918" and high-value tandoori items.
Mark-up values are in Part D and C.1 above. Keep markup ≤ 25% above actual price.
In Partner App: when editing an item → "MRP" or "Strikethrough Price" field.

### G.2 — "Try New" Badge
Currently active TRYNEW (30% off upto ₹75). This is Swiggy-funded.
**Action:** None required. Monitor expiry date in Promotions → Offers.
When it expires, ask your Swiggy PoC: "Can we extend the new restaurant boost period?"

### G.3 — Restaurant-Funded Offers (0 today → add 2)
See Part A.3 above. Both offers are via Partner App → Promotions → Create Offer.
Do NOT enable auto-renewal. Screenshot settings page.

### G.4 — Ads (optional, Week 2+)
Swiggy Self-Serve Ads are available. Do NOT enable until listing is complete and 
rated restaurant-funded offers are running. Week 2 at earliest.
When you do enable: manually set a daily cap and explicitly set end date.

---

## PART H — ITEMS WITH NO PHOTO (Nihaf must shoot at outlet)

| Item | Priority |
|---|---|
| **Shawarma** | P1 |
| **Barbeque Chicken (Boona)** | P2 |
| **Mixed Veg Curry** | P3 |
| **Prawns Chilly Manchurian** | P4 |

---

## PART I — DEFINITION OF DONE (Swiggy)

- [ ] Cuisine tags fixed to: Biryani, North Indian, Hyderabadi, Mughlai (Part A.1)
- [ ] Cost for Two updated to ₹500 (Part A.2)
- [ ] 2 restaurant-funded offers created (Part A.3)
- [ ] "Try New" badge confirmed active (Part A.4)
- [ ] 11 sections created + ordered (Part B)
- [ ] All existing items moved/renamed per Part C
- [ ] All 57 new items added (Part D)
- [ ] Section item order set per Part E
- [ ] Badges applied per Part F
- [ ] Markup prices applied to moat items (Part G.1)
- [ ] 3+ outlet-shot photos taken + uploaded (Part H — Nihaf manual)
- [ ] Post-change: verify outlet rest1342888 consumer URL shows "Hamza Heritage 1918 — Signature Mutton" as second section
- [ ] No auto-renewal enabled on any ad or offer

---

*Generated by Claude, 2026-05-10. Source: he-swiggy-parsed-2026-05-10.json, he-missing-items-final-2026-05-10.json, EXECUTION-PLAN-2026-05-10.md*
