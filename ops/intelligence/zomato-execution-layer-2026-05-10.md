# Hamza Express · Zomato Execution Layer
**Date:** 2026-05-10 · **Source data:** he-zomato-parsed-2026-05-10.json · **Executor:** Claude  
**Purpose:** Ready-to-paste playbook for the Zomato Restaurant Partner App. Every field, every value, sequenced for speed.

---

## STATUS SNAPSHOT

| Item | State |
|---|---|
| Current Zomato URL | `https://www.zomato.com/bangalore/hamza-express-1-shivajinagar-bangalore/order` |
| Current item count | **79 items** |
| Target item count | **~131 items** (79 existing + 52 to add; cold drinks deferred) |
| Current sections | 8 generic sections |
| Target sections | **10 identity-led sections** |
| Cover photo | Generic / not set — needs heritage photo |
| Restaurant Story | Not set — ready-to-paste copy below |
| Dining rating | 0 (cold-start visibility deficit) |
| Delivery rating | 4.0 (28 reviews) |

---

## PART A — RESTAURANT PROFILE (do this first, takes 5 min)

### A.1 — Story / About Us field
> Location in Partner App: Profile → About → Story / Description

**Paste this exactly:**
```
Hamza Express is the QSR arm of the Hamza family, in the Bangalore food trade since 1918.
Four generations of Dakhni cuisine — Hyderabadi mutton slow-cooked to order, tandoor kebabs,
Dum Biryani — served fast for delivery. Located in the heart of Shivajinagar, walking distance
from MG Road, Commercial Street, and Brigade Road.
```

### A.2 — Cuisine Tags
Current: North Indian, Biryani, Chinese, Mughlai  
**Add:** Hyderabadi (if available as a Zomato tag)  
**Add:** Dakhni (if available as a Zomato tag)  
Do NOT remove existing tags — only add.

### A.3 — Cover Photo
**Nihaf uploads manually.** Use: `~/Desktop/HE_Listing_Photos_2026-05-10/` — any Mutton Brain Dry or Hamza Special hero shot.  
Heritage feel: dark background, overhead shot, copper/brass serving bowl preferred.

### A.4 — Address / Map Pin
Verify pin lands at: **22, H.K.P. Road, Shivajinagar, Bangalore 560051**  
Current shown on listing: "22, 3rd Floor, H.K.P Road" — remove "3rd Floor" if the pin is correct.

---

## PART B — SECTION RESTRUCTURE (do before adding items)

Rename + reorder sections in Partner App → Menu → Sections. Zomato allows drag-to-reorder.

| # (new order) | New Section Name | Action | Current Name |
|---|---|---|---|
| 1 | **Combos & Hero Boxes** | Rename | Combos |
| 2 | **Hamza Heritage 1918 — Signature Mutton** | **Create NEW** | — |
| 3 | **Hyderabadi Dakhni Biryani** | Rename | Rice and Biryani |
| 4 | **Tandoori & Kebabs — Hyderabadi Style** | Merge + rename | Starters + Platter |
| 5 | **Chicken Curries — North Indian + Hyderabadi** | Split + rename | (from Main Course) |
| 6 | **Rolls & Quick Bites** | Rename | Rolls |
| 7 | **Chinese — Indo-Chinese Favourites** | Rename | Fried Rice and Noodles |
| 8 | **Vegetarian** | Split + rename | (from Main Course) |
| 9 | **Breads** | Keep | Breads |
| 10 | **Beverages** | **Create NEW** | — |

**Move items after renaming:**
- From "Main Course" → move all Mutton items to "Hamza Heritage 1918 — Signature Mutton" (after creating it)
- From "Main Course" → move all Biryani items (Chicken Biryani, Mutton Biryani) to "Hyderabadi Dakhni Biryani"
- From "Main Course" → move all Chicken curries to "Chicken Curries — North Indian + Hyderabadi"
- From "Main Course" → move Veg items (Kadai Paneer, Palak Paneer, Aloo Gobi etc.) to "Vegetarian"

---

## PART C — EXISTING ITEMS: SECTION REASSIGNMENT + DESCRIPTOR UPDATE

Items already on Zomato that need to be moved to new sections and get updated descriptions.

### C.1 — Items to MOVE to "Hamza Heritage 1918 — Signature Mutton"

> These are currently in "Main Course". Move to new section.

| Item | Current Price | Badge to Apply | Descriptor |
|---|---|---|---|
| **Hamza Special** (appears as "Hamza Special" on Zomato) | ₹220 | Chef's Special | "The dish that built our reputation since 1918. Slow-cooked mutton in a deep onion-tomato gravy with cardamom, mace, and the Hamza family's secret garam masala blend. Pairs perfectly with ghee rice or naan. Serves 1-2." |

> Note: Most mutton items are MISSING from Zomato entirely — they will be ADDED in Part D. Only "Hamza Special" is already there.

### C.2 — Items to MOVE to "Hyderabadi Dakhni Biryani"

| Item | Current Section | Price | Badge | Descriptor |
|---|---|---|---|---|
| **Mutton Biryani** | Rice and Biryani | ₹350 | Bestseller | "Slow-cooked tender mutton in our 1918 family Dakhni masala. Layered with aged basmati, dum-cooked over coal till the rice carries every flavour. The recipe four generations of Hamza chefs have guarded. Serves 1." |

> Chicken Biryani, Chicken Boneless Biryani, Egg Biryani are MISSING — added in Part D.

### C.3 — Items to MOVE to "Tandoori & Kebabs — Hyderabadi Style"

> Currently in "Starters" or "Platter"

| Item | Current Price | Badge | Descriptor |
|---|---|---|---|
| **Tandoori Chicken** | ₹230 | Bestseller | "Half chicken marinated overnight in our Hyderabadi curd-spice blend, char-grilled in the tandoor till crisp outside, juicy inside. Our most-reordered item. Serves 1-2." |
| **Reshmi Kabab** | ₹240 | — | "Boneless chicken minced with cream, cashew, and fresh coriander — melt-in-the-mouth seekh kabab from the tandoor. Serves 1." |
| **Malai Tikka** | ₹250 | — | "Boneless chicken marinated in hung curd, cream, and mild spices — delicate and smoky from the tandoor. A crowd-pleaser. Serves 1." |
| **Andhra Tikka** | ₹250 | — | "Chicken tikka with an Andhra-Dakhni masala punch — turmeric, red chilli, curry leaf marinade, char-grilled. Serves 1." |
| **Chicken Tikka** | ₹265 | — | "Boneless chicken marinated in yogurt and our spice blend, skewered and char-grilled. The classic. Serves 1." |
| **Kalmi Kabab** | ₹270 | — | "Bone-in chicken drumsticks marinated in our Hyderabadi rub — slow-cooked then flame-finished. Serves 2." |
| **American Chops** | ₹270 | — | "Bone-in chicken cuts marinated in smoky masala, grilled till charred at the edges. Serves 1-2." |
| **Garlic Chicken** | ₹235 | — | "Boneless chicken tossed in roasted garlic, green chilli, and butter — the Indo-Chinese starter that crosses cuisines. Serves 1." |
| **Lemon Chicken** | ₹255 | — | "Crispy battered chicken tossed in lemon and spices — bright, tangy, and addictive. Serves 1." |
| **Kabab Platter** | ₹499 | — | "Assorted tandoori mix — Reshmi Kabab, Chicken Tikka, Malai Tikka, and Tandoori Chicken. The share platter. Serves 2-3." |

> Garlic Kabab, Haryali Tikka (Swiggy-only), Barbeque Chicken (Boona), Mutton Sheekh Kabab, Pathak Kabab — MISSING from Zomato, to be ADDED in Part D.

### C.4 — Items to MOVE to "Chicken Curries — North Indian + Hyderabadi"

| Item | Current Price | Badge | Descriptor |
|---|---|---|---|
| **Butter Chicken** | ₹225 | — | "Tender chicken in our rich tomato-cream Makhani gravy — the familiar North Indian classic, Hamza-style. Pairs with Butter Naan. Serves 1." |
| **Chicken Tikka Masala** | ₹300 | — | "Char-grilled tikka pieces in a thick Mughlai-style gravy, deep with spice. Serves 1." |
| **Mughlai Chicken** | ₹245 | — | "Rich nut-based Mughlai gravy with tender chicken — full, aromatic, pairs with any bread. Serves 1." |
| **Kadai Chicken** | ₹225 | — | "Chicken in a dry-style onion-tomato-pepper masala, finished in the kadai. Serves 1." |
| **Methi Chicken** | ₹225 | — | "Chicken cooked with fresh fenugreek leaves and spices — the earthy Punjabi classic. Serves 1." |
| **Hamza Special** *(chicken variant — verify)* | ₹220 | — | Review whether this is chicken or mutton in the Partner App. |
| **Chicken Kolhapuri Gravy** | ₹210 | — | "Fiery Kolhapuri-style chicken — coconut, sesame, red chilli. Intense heat, deep flavour. Serves 1." |
| **Chicken Sagwala** | ₹235 | — | "Chicken in a fresh spinach-coriander gravy — the Punjabi classic. Light and aromatic. Serves 1." |
| **Chicken Dopiyaza** | ₹235 | — | "Double-onion chicken — onions added at two stages, deep sweetness balancing the spice. Serves 1." |
| **Chicken Chatpata** | ₹235 | — | "Boneless chicken in a tangy-spicy dry masala. Serves 1." |
| **Pudina Chicken** | ₹250 | — | "Chicken cooked in fresh mint and coriander gravy — herbaceous, cooling, unique. Serves 1." |
| **Chicken Hyderabadi Gravy** | ₹225 | — | "Chicken in a Hyderabadi-style yakhni-base gravy with whole spices. Serves 1." |
| **Afghani Chicken** | ₹300 | — | "Bone-in chicken in a cream-and-nut Afghani-style gravy — mild, rich, indulgent. Serves 1." |
| **Punjabi Chicken** | ₹235 | — | "Classic Punjabi chicken masala — onion-tomato-ginger-garlic, robust spice. Serves 1." |
| **Tandoori Chicken Masala** | ₹295 | — | "Char-grilled tandoori chicken pieces finished in a rich Makhani-style sauce. Two flavours in one. Serves 1." |
| **Chicken Kali Mirch** | ₹225 | — | "Chicken cooked in crushed black pepper and cream — the mild-heat specialty. Serves 1." |

> Chicken Burtha, Chicken Dopiyaza, Chicken Hyderabadi Gravy, Chicken Saagwala are partly listed above; Chicken Burtha is on Zomato at ₹265.

### C.5 — Items to MOVE to "Vegetarian"

| Item | Current Section | Price | Descriptor |
|---|---|---|---|
| **Kadai Paneer** | Main Course | ₹180 | "Paneer chunks in a dry Kadai masala — crisp edges, smoky finish. Serves 1." |
| **Palak Paneer** | Main Course | ₹200 | "Cottage cheese in fresh spinach gravy. The classic North Indian green. Serves 1." |
| **Paneer Mutter Masala** | Main Course | ₹200 | "Paneer and green peas in a tomato-onion gravy. Serves 1." |
| **Aloo Gobi** | Main Course | ₹180 | "Dry potato and cauliflower stir-fry with turmeric and spices. Serves 1." |
| **Gobi Masala** | Main Course | ₹160 | "Cauliflower in a rich masala sauce. Serves 1." |
| **Mixed Veg Curry** | Main Course | ₹200 | "Seasonal vegetables in a North Indian gravy. Serves 1." |
| **Veg Kofta** | Main Course | ₹220 | "Deep-fried vegetable dumplings in a creamy onion-tomato sauce. Serves 1." |
| **Malai Kofta** | Main Course | ₹240 | "Potato-paneer dumplings in a saffron-cream sauce. Rich and indulgent. Serves 1." |
| **Paneer Butter Masala** | Main Course | ₹180 | "Paneer in Makhani sauce — the crowd-pleasing classic. Serves 1." |
| **Daal Tadka** | Main Course | ₹120 | "Yellow lentils tempered with jeera, garlic, and dried chilli. Comfort food. Serves 1." |
| **Daal Fry** | Main Course | ₹130 | "Toor dal cooked with onion, tomato, and spices — the everyday daal. Serves 1." |

### C.6 — Items to MOVE to "Chinese — Indo-Chinese Favourites"

| Item | Current Section | Price | Descriptor |
|---|---|---|---|
| **Veg Noodles** | Fried Rice and Noodles | ₹150 | "Stir-fried noodles with crisp vegetables, Indo-Chinese style. Serves 1." |
| **Shezwan Noodles** | Fried Rice and Noodles | ₹200 | "Noodles tossed in Schezwan sauce — hot, tangy, addictive. Serves 1." |
| **Chicken Noodles** | Fried Rice and Noodles | ₹190 | "Stir-fried noodles with chicken strips. Serves 1." |
| **Veg Fried Rice** | Fried Rice and Noodles | ₹160 | "Wok-tossed basmati with vegetables and soy. Serves 1." |
| **SPICY** *(verify name — likely a Schezwan rice variant)* | Fried Rice and Noodles | ₹200 | **Clarify item name in Partner App before editing descriptor.** |
| **Chicken Fried Rice** | Fried Rice and Noodles | ₹205 | "Wok-tossed rice with chicken strips, egg, and soy. Serves 1." |
| **Chicken Schezwan Fried Rice** | Fried Rice and Noodles | ₹245 | "Chicken fried rice with fiery Schezwan sauce. Serves 1." |
| **Egg Fried Rice** | Fried Rice and Noodles | ₹180 | "Classic wok-tossed rice with scrambled egg. Serves 1." |

### C.7 — Items to STAY in "Rolls & Quick Bites" (existing Rolls section, renamed)

| Item | Current Price | Descriptor |
|---|---|---|
| **Chicken Roll** | ₹115 | "Spiced chicken filling wrapped in a flaky maida paratha — our most-grabbed quick bite. Serves 1." |
| **Egg Roll** | ₹115 | "Egg-coated paratha wrapped around spiced filling. The street classic. Serves 1." |
| **Paneer Roll** | ₹115 | "Paneer tikka filling wrapped in a flaky maida paratha. Serves 1." |

### C.8 — Items to STAY in "Combos & Hero Boxes" (renamed from Combos)

| Item | Current Price | Badge | Note |
|---|---|---|---|
| **Ghee Rice with Butter Chicken and Chicken Kabab** | ₹299 | Most Ordered | Reorder to top |
| **Chicken Biryani with Chicken Kabab** | ₹339 | — | |
| **Ghee Rice with Butter Chicken** | ₹219 | — | |
| **Ghee rice with Daal fry and 500ml bisleri** | ₹219 | — | |
| **Ghee Rice with Daal Fry and Chicken Kabab** | ₹309 | — | |
| **Mutton Biryani with Lollipop** | ₹495 | — | Anchor-decoy price |
| **Butter Naan with Butter Chicken** | ₹219 | — | |
| **Butter Naan with Butter Chicken and Chicken Kabab** | ₹269 | — | |
| **Biryani Rice with Chicken Kabab** | ₹219 | — | |
| **Full Loaded Combo** | ₹619 | — | Anchor-premium — keep at bottom |

---

## PART D — NEW ITEMS TO ADD TO ZOMATO (52 items)

Add via Partner App → Menu → + Add Item. Do them in this priority order (partial completion still ships value).

### Priority 1: Mutton Menu (23 items — the moat)

| # | Item Name | Section | Price (₹) | Veg/Non-Veg | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|---|
| 1 | **Mutton Brain Dry** | Hamza Heritage 1918 — Signature Mutton | 160 | Non-Veg | Chef's Special | "Tender mutton brain slow-cooked with our 1918 Hamza family masala — minced fine and dry-roasted till each piece is crusted with spice. The Dakhni delicacy four generations of Bangalore have asked for by name. Serves 1." | MuttonBrainDry.png |
| 2 | **Mutton Brain** | Hamza Heritage 1918 — Signature Mutton | 160 | Non-Veg | — | "Mutton brain slow-cooked in our Hyderabadi masala — rich, delicate, with a depth of flavour that's uniquely Dakhni. Served with ghee rice. Serves 1." | MuttonBrain.png |
| 3 | **Mutton Hamza Special** | Hamza Heritage 1918 — Signature Mutton | 240 | Non-Veg | Chef's Special | "The dish that built our reputation since 1918. Slow-cooked mutton in a deep onion-tomato gravy with cardamom, mace, and the Hamza family's secret garam masala blend. Pairs perfectly with ghee rice or naan. Serves 1-2." | MuttonHamzaSpecial.png |
| 4 | **Thethar Biryani** | Hyderabadi Dakhni Biryani | 270 | Non-Veg | Chef's Special | "Premium mutton cuts — bone-in, marrow-rich — slow-cooked Hyderabadi style with extra masala intensity. The biryani we serve at our family weddings. Serves 1." | ThetharBiryani.png |
| 5 | **Thethar Pepper Roast** | Hamza Heritage 1918 — Signature Mutton | 320 | Non-Veg | Chef's Special | "Premium mutton dry-roasted with crushed black pepper and curry leaves, finished in a smoking-hot kadai. The flagship of our Dakhni grill repertoire. Serves 1-2." | ThetharPepperRoast.png |
| 6 | **Thethar Pepper Dry** | Hamza Heritage 1918 — Signature Mutton | 300 | Non-Veg | — | "Premium bone-in mutton in a fiery dry-pepper masala — intense, rustic, unmistakably Dakhni. Serves 1-2." | ThetharPepperDry.png |
| 7 | **Mutton Chatpata** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Boneless mutton tossed in a tangy-spicy dry masala — chillies, lemon, fresh coriander. Built for hand-eating with naan or roti. Serves 1." | MuttonChatpata.png |
| 8 | **Mutton Hyderabadi Gravy** | Hamza Heritage 1918 — Signature Mutton | 220 | Non-Veg | — | "Classic Hyderabadi mutton — yakhni-based gravy slow-cooked till the meat falls off the bone. The dish my great-grandfather perfected in 1918. Serves 1-2." | MuttonHyderabadiGravy.png |
| 9 | **Mutton Pepper Dry** | Hamza Heritage 1918 — Signature Mutton | 210 | Non-Veg | — | "Boneless mutton stir-fried with crushed black pepper and curry leaves, finished dry. The South-meets-North Hyderabadi classic. Serves 1." | MuttonPepperDry.png |
| 10 | **Mutton Pepper (Roast)** | Hamza Heritage 1918 — Signature Mutton | 220 | Non-Veg | — | "Bone-in mutton dry-roasted in pepper and ghee till the spice crust caramelises. Hyderabadi soul food. Serves 1-2." | MuttonPepperRoast.png |
| 11 | **Mutton Kolhapuri** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Mutton in the fiery Maharashtrian Kolhapuri masala — coconut, sesame, chilli, our own spice grind. Bring it down with ghee rice or paratha. Serves 1." | MuttonKolhapuri.png |
| 12 | **Mutton Kolhapuri Gravy** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Rich Kolhapuri-style mutton gravy — intense chilli heat balanced with coconut and sesame. Serves 1." | MuttonKolhapuriGravy.png |
| 13 | **Mutton Masala** | Hamza Heritage 1918 — Signature Mutton | 210 | Non-Veg | — | "Mutton in a robust North Indian masala — onion-tomato-ginger-garlic, slow-cooked till rich. Serves 1." | MuttonMasala.png |
| 14 | **Mutton Rogan Josh** | Hamza Heritage 1918 — Signature Mutton | 210 | Non-Veg | — | "Kashmiri-influenced mutton — slow-cooked in fennel, dried ginger, and a scarlet spice paste. Aromatic and warming. Serves 1." | MuttonRoganJosh.png |
| 15 | **Kadai Mutton** | Hamza Heritage 1918 — Signature Mutton | 220 | Non-Veg | — | "Mutton in a dry-style kadai masala — tomatoes, peppers, and whole spices, finished in the iron wok. Serves 1." | KadaiMutton.png |
| 16 | **Methi Mutton** | Hamza Heritage 1918 — Signature Mutton | 210 | Non-Veg | — | "Mutton cooked with fresh fenugreek leaves — the earthy bitterness of methi elevating the slow-cooked meat. Serves 1." | MethiMutton.png |
| 17 | **Mutton Kassa** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Dry-style mutton with whole spices — a thick, rich masala coating on each piece. Serves 1." | MuttonKassa.png |
| 18 | **Mutton Khima** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Minced mutton cooked with onions, tomatoes, and green chillies — the Dakhni kheema. Best with naan. Serves 1." | MuttonKhima.png |
| 19 | **Mutton Punjabi** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Mutton in a bold Punjabi-style masala — strong, hearty, North Indian. Serves 1." | MuttonPunjabi.png |
| 20 | **Mutton Sagwala** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Mutton slow-cooked with fresh spinach and spices — the saagwala classic. Serves 1." | MuttonSagwala.png |
| 21 | **Mutton Achari** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Mutton in a tangy pickle-spice masala — mustard seeds, fenugreek, dried chillies. Unique and punchy. Serves 1." | MuttonAchari.png |
| 22 | **Mutton Tadka** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Mutton in a tarka-style gravy — tempering of whole spices finishing a slow-cooked base. Serves 1." | MuttonTadka.png |
| 23 | **Mutton Chops** | Hamza Heritage 1918 — Signature Mutton | 230 | Non-Veg | — | "Bone-in mutton chops slow-cooked in a rich masala — meaty, succulent, serves 1." | MuttonChops.png |
| 24 | **Mutton Gurda Dry** | Hamza Heritage 1918 — Signature Mutton | 210 | Non-Veg | — | "Mutton kidney dry-roasted in a pungent masala — the offal specialist's choice. Serves 1." | MuttonGurdaDry.png |

### Priority 2: Tandoori Additions (4 items)

| # | Item Name | Section | Price (₹) | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|
| 25 | **Garlic Kabab** | Tandoori & Kebabs — Hyderabadi Style | 240 | New | "Minced chicken seekh kabab pounded with roasted garlic, ginger, and our family green-chilli paste — grilled over coal. Serves 1." | GarlicKabab.png |
| 26 | **Barbeque Chicken (Boona)** | Tandoori & Kebabs — Hyderabadi Style | 220 | New | "Bone-in chicken marinated overnight in a smoky barbecue masala — char-grilled till the edges crisp. The Hyderabadi answer to a Sunday roast. Serves 1-2." | **No photo — shoot at outlet** |
| 27 | **Mutton Sheekh Kabab** | Tandoori & Kebabs — Hyderabadi Style | 150 | New | "Hand-minced mutton seasoned with raw papaya, garam masala, and our Hamza spice blend — skewered and char-grilled. Serves 1." | MuttonShekhKabab.png |
| 28 | **Pathak Kabab** | Tandoori & Kebabs — Hyderabadi Style | 230 | New | "Bone-in chicken pieces marinated in our family Dakhni rub — slow-cooked then flame-finished. Serves 1." | PathakKabab.png |

### Priority 3: Biryani Completions (3 items)

| # | Item Name | Section | Price (₹) | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|
| 29 | **Chicken Biryani** | Hyderabadi Dakhni Biryani | 290 | Bestseller | "Chicken dum biryani — tender pieces layered with aged basmati and slow-cooked in our Dakhni masala. The weekday staple since 1918. Serves 1." | ChickenBiryani.png |
| 30 | **Chicken Boneless Biryani** | Hyderabadi Dakhni Biryani | 280 | — | "Boneless chicken dum biryani — same slow-cooked recipe, easier eating. Serves 1." | ChickenBiryani.png |
| 31 | **Egg Biryani** | Hyderabadi Dakhni Biryani | 160 | — | "Dum-cooked basmati with boiled eggs and our biryani masala. Entry-point biryani, full on flavour. Serves 1." | EggBiryani.png |

### Priority 4: Rolls & Quick Bites Additions (2 items)

| # | Item Name | Section | Price (₹) | Badge | Descriptor | Photo |
|---|---|---|---|---|---|---|
| 32 | **Chicken Kathi Roll** | Rolls & Quick Bites | 90 | New | "Spiced chicken filling wrapped in a flaky maida paratha with chutney and onions. The classic Kathi Roll. Serves 1." | ChickenKathiRoll.png |
| 33 | **Shawarma** | Rolls & Quick Bites | 80 | New | "Chicken shawarma — marinated chicken, garlic sauce, pickled vegetables, wrapped tight. Serves 1." | **No photo — shoot at outlet** |

### Priority 5: Chinese Additions (10 items)

| # | Item Name | Section | Price (₹) | Descriptor | Photo |
|---|---|---|---|---|---|
| 34 | **Mutton Fried Rice** | Chinese — Indo-Chinese Favourites | 230 | "Wok-tossed rice with mutton strips — the most premium fried rice on the menu. Serves 1." | MuttonFriedRice.png |
| 35 | **Mutton Noodles** | Chinese — Indo-Chinese Favourites | 230 | "Stir-fried noodles with mutton. Serves 1." | MuttonNoodles.png |
| 36 | **Shezwan Mutton** | Chinese — Indo-Chinese Favourites | 230 | "Mutton in fiery Schezwan sauce — Chinese-style heat meets Hyderabadi spice. Serves 1." | ShezwanMutton.png |
| 37 | **Shezwan Chicken** | Chinese — Indo-Chinese Favourites | 230 | "Chicken tossed in Schezwan sauce — hot, tangy, bold. Serves 1." | ShezwanChicken.png |
| 38 | **Shezwan Fried Rice** | Chinese — Indo-Chinese Favourites | 200 | "Fried rice tossed in Schezwan sauce — spicy and smoky. Serves 1." | ShezwanFriedRice.png |
| 39 | **Mix Noodles** | Chinese — Indo-Chinese Favourites | 240 | "Mixed veg and chicken noodles — the combo plate. Serves 1." | MixNoodles.png |
| 40 | **Mix Fried Rice** | Chinese — Indo-Chinese Favourites | 240 | "Mixed veg and chicken fried rice. Serves 1." | MixFriedRice.png |
| 41 | **Hongkong Chicken** | Chinese — Indo-Chinese Favourites | 220 | "Crispy fried chicken in a sweet-tangy Hong Kong-style sauce. Serves 1." | HongkongChicken.png |
| 42 | **Prawns Chilly Manchurian** | Chinese — Indo-Chinese Favourites | 270 | "Crispy prawns tossed in a spicy Manchurian sauce. Serves 1." | **No photo — shoot at outlet** |
| 43 | **Prawns Fried Rice** | Chinese — Indo-Chinese Favourites | 230 | "Wok-tossed rice with prawns. Serves 1." | PrawnsFriedRice.png |
| 44 | **Prawns Noodles** | Chinese — Indo-Chinese Favourites | 230 | "Stir-fried noodles with prawns. Serves 1." | PrawnsNoodles.png |

### Priority 6: Combo additions (4 items)

| # | Item Name | Section | Price (₹) | Descriptor |
|---|---|---|---|---|
| 45 | **Chicken Biryani + 2pc Kabab** | Combos & Hero Boxes | 230 | "Chicken Biryani with 2 pieces of Chicken Kabab. The delivery combo. Serves 1." |
| 46 | **Ghee Rice + Dal Fry** | Combos & Hero Boxes | 150 | "Ghee Rice with Dal Fry — the budget classic. Serves 1." |
| 47 | **Ghee Rice + Dal Fry + 2pc Kabab** | Combos & Hero Boxes | 200 | "Ghee Rice, Dal Fry, and 2 Chicken Kababs. The complete meal. Serves 1." |
| 48 | **Ghee Rice + Mutton Chatpata + 2pc Kabab** | Combos & Hero Boxes | 290 | "Ghee Rice with Mutton Chatpata and 2 Chicken Kababs. The premium combo. Serves 1." |

### Priority 7: Remaining items

| # | Item Name | Section | Price (₹) | Descriptor | Photo |
|---|---|---|---|---|---|
| 49 | **Grill Chicken** | Tandoori & Kebabs — Hyderabadi Style | 240 | "Whole chicken half-grilled on the grill — smoky, charred edges, juicy centre. Serves 1-2." | GrillChicken.png |
| 50 | **Chicken Saagwala** | Chicken Curries — North Indian + Hyderabadi | 220 | "Chicken in fresh spinach gravy — the Punjabi classic. Serves 1." | ChickenSaagwala.png |
| 51 | **Mushroom Masala** | Vegetarian | 180 | "Button mushrooms in a rich tomato-onion masala. Serves 1." | MushroomMasala.png |
| 52 | **Jeera Rice** | Hyderabadi Dakhni Biryani | 100 | "Basmati rice tempered with cumin. Goes with any gravy. Serves 1." | JeeraRice.png |
| 53 | **Plain Rice** | Hyderabadi Dakhni Biryani | 50 | "Steamed basmati rice. Serves 1." | — |

> **NOT adding to Zomato this round:** Cold drink 1L, Cold drink 500ml (low-margin, platform fee eats the margin)

---

## PART E — ITEM ORDERING WITHIN SECTIONS

After adding all items, set this order within each section. Zomato allows drag-and-drop.

### E.1 — Hamza Heritage 1918 — Signature Mutton (first section in new order)
1. Mutton Brain Dry *(Chef's Special — leads with HE signature)*
2. Thethar Pepper Roast *(anchor-high)*
3. Mutton Hamza Special *(Chef's Special)*
4. Thethar Biryani
5. Thethar Pepper Dry
6. Mutton Chatpata
7. Mutton Hyderabadi Gravy
8. Mutton Pepper (Roast)
9. Mutton Chops
10. Mutton Kolhapuri
11. Mutton Kolhapuri Gravy
12. Mutton Kassa
13. Mutton Gurda Dry
14. Mutton Khima
15. Mutton Punjabi
16. Mutton Sagwala
17. Mutton Rogan Josh
18. Mutton Achari
19. Mutton Tadka
20. Mutton Masala
21. Methi Mutton
22. Kadai Mutton
23. Mutton Brain
24. Mutton Pepper Dry

### E.2 — Combos & Hero Boxes (second section)
1. Full Loaded Combo ₹619 *(anchor-high first)*
2. Mutton Biryani with Lollipop ₹495 *(decoy)*
3. Ghee Rice + Mutton Chatpata + 2pc Kabab ₹290 *(new)*
4. Chicken Biryani with Chicken Kabab ₹339
5. Ghee Rice with Butter Chicken and Chicken Kabab ₹299 *(Most Ordered badge)*
6. Ghee Rice with Daal Fry and Chicken Kabab ₹309
7. Butter Naan with Butter Chicken and Chicken Kabab ₹269
8. Ghee Rice with Butter Chicken ₹219
9. Butter Naan with Butter Chicken ₹219
10. Biryani Rice with Chicken Kabab ₹219
11. Chicken Biryani + 2pc Kabab ₹230 *(new)*
12. Ghee Rice + Dal Fry + 2pc Kabab ₹200 *(new)*
13. Ghee Rice + Dal Fry ₹150 *(new)*
14. Ghee rice with Daal fry and 500ml bisleri ₹219

### E.3 — Hyderabadi Dakhni Biryani (third section)
1. Mutton Biryani ₹350 *(anchor)*
2. Thethar Biryani ₹270 *(premium decoy)*
3. Chicken Boneless Biryani ₹280
4. Chicken Biryani ₹290
5. Egg Biryani ₹160 *(entry-point)*
6. Jeera Rice ₹100
7. Plain Rice ₹50

### E.4 — Tandoori & Kebabs — Hyderabadi Style (fourth section)
1. Kabab Platter ₹499 *(anchor)*
2. Kalmi Kabab ₹270
3. American Chops ₹270
4. Mutton Sheekh Kabab ₹150 *(low anchor — entry point)*
5. Tandoori Chicken ₹230 *(Bestseller badge)*
6. Garlic Kabab ₹240 *(New)*
7. Pathak Kabab ₹230 *(New)*
8. Barbeque Chicken (Boona) ₹220 *(New)*
9. Grill Chicken ₹240
10. Chicken Tikka ₹265
11. Haryali Tikka ₹265 *(already on Zomato)*
12. Malai Tikka ₹250
13. Andhra Tikka ₹250
14. Reshmi Kabab ₹240
15. Lemon Chicken ₹255
16. Garlic Chicken ₹235
17. Chicken Pepper Dry ₹235 *(currently in Starters)*

---

## PART F — BADGE ASSIGNMENTS (apply in Partner App)

| Item | Badge | Section |
|---|---|---|
| Tandoori Chicken | **Bestseller** | Tandoori & Kebabs |
| Mutton Biryani | **Bestseller** | Hyderabadi Dakhni Biryani |
| Chicken Biryani | **Bestseller** | Hyderabadi Dakhni Biryani |
| Mutton Brain Dry | **Chef's Special** | Hamza Heritage 1918 |
| Mutton Hamza Special | **Chef's Special** | Hamza Heritage 1918 |
| Thethar Biryani | **Chef's Special** | Hyderabadi Dakhni Biryani |
| Thethar Pepper Roast | **Chef's Special** | Hamza Heritage 1918 |
| Ghee Rice with Butter Chicken and Chicken Kabab | **Most Ordered** | Combos |
| Garlic Kabab | **New** | Tandoori & Kebabs |
| Mutton Sheekh Kabab | **New** | Tandoori & Kebabs |
| Pathak Kabab | **New** | Tandoori & Kebabs |
| Barbeque Chicken (Boona) | **New** | Tandoori & Kebabs |
| Chicken Kathi Roll | **New** | Rolls & Quick Bites |
| Shawarma | **New** | Rolls & Quick Bites |
| Mutton Chatpata | **New** | Hamza Heritage 1918 |
| Thethar Pepper Dry | **New** | Hamza Heritage 1918 |

---

## PART G — ITEMS WITH NO PHOTO AVAILABLE (Nihaf must shoot at outlet)

| Item | Priority | Suggested Shot |
|---|---|---|
| **Shawarma** | P1 | Hand-held wrap, open to show filling, natural light |
| **Barbeque Chicken (Boona)** | P2 | On grill rack or black slate, overhead |
| **Prawns Chilly Manchurian** | P3 | In serving bowl, overhead |

> All other new items have photos in `~/Desktop/HE_Listing_Photos_2026-05-10/`

---

## PART H — ITEMS NEEDING OWNER DECISION

| Item | Decision needed |
|---|---|
| **"Hamza Special" on Zomato** | Verify if this is the chicken variant or mutton. If chicken → stays in Chicken Curries. If mutton → move to Hamza Heritage 1918. |
| **"SPICY"** in Fried Rice section | Clarify item name — likely "Egg Fried Rice Spicy" or a Schezwan variant. Rename in Partner App before editing descriptor. |
| **Haryali Tikka** | Already on Zomato (₹265, in Starters) — just move to Tandoori section. No edit needed except section. |
| **Chicken Biryani** | Currently absent from Zomato (only Mutton Biryani is in "Rice and Biryani" section). Add as new item. Verify price: POS ₹275 but suggest ₹290 to match margin after 23% commission. |

---

## PART I — DEFINITION OF DONE (Zomato)

- [ ] Restaurant Story populated (Part A.1)
- [ ] Cuisine tags updated (Part A.2)
- [ ] Cover photo uploaded (Part A.3 — Nihaf manual)
- [ ] 10 sections created + ordered (Part B)
- [ ] All existing items moved to correct new sections (Parts C.1–C.8)
- [ ] All 52+ new items added (Part D)
- [ ] Section item order set as per Part E
- [ ] Badges applied per Part F
- [ ] 3 outlet-shot photos taken and uploaded (Part G — Nihaf manual)
- [ ] Owner decisions resolved (Part H)
- [ ] Post-change: visit Zomato consumer URL and verify "Hamza Heritage 1918 — Signature Mutton" appears as second section
- [ ] Zomato Menu Score ≥ 75 within 24h (check in Partner App → Insights)

---

*Generated by Claude, 2026-05-10. Source: he-zomato-parsed-2026-05-10.json, he-missing-items-final-2026-05-10.json, EXECUTION-PLAN-2026-05-10.md*
