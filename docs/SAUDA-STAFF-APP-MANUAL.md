# HN Ops app — Sauda (purchase) · one-page manual

**What it is:** the HN Ops Android app for Sauda purchase work. Azeem/Nafees create item-first demand without knowing vendors. Zoya/Bashir convert that demand into vendor orders, receiving proof, rates, and payment trail. Everything shown is decided by the staff PIN.

The complete cross-chamber Android model is in `docs/HN-STAFF-ANDROID-UX-MODEL.md`. This page stays as the Sauda worker manual.

---

## 1. Install (once)
1. Open the link on the phone: **https://hn-ops-api.pages.dev/get/**
2. Tap **Download & install** → open the file → if asked, **allow install from this source** → **Install**.
3. If a *Play Protect* warning shows, tap **Install anyway** (it's our own app).
4. Open **HN Ops**, type the staff **PIN**.

The phone asks to "allow this source" only the **first** time. After that, installs and updates are one tap.

---

## 2. Logging in
- Type the 4-digit PIN → tap **Enter**.
- The PIN *is* the identity. Azeem/Nafees get a simple item-demand surface. Zoya/Bashir get the purchase bucket and proof/payment controls. Nobody picks a screen — the role decides.

---

## 3. Azeem/Nafees: create demand
- Tap **Sauda**.
- Search by item name. Hindi names are searchable where mapped.
- Tap the speaker icon to hear the item name in Indian English and Hindi.
- Add the item, enter quantity, and send the demand.
- Vendor stays hidden. The system routes the demand by the item master so outlet staff do not need vendor intelligence.

---

## 4. Zoya/Bashir: the purchase day board
- Pick the outlet at the top: **HE** or **NCH**.
- The date sits in the middle with **‹ ›** arrows — tap to move day to day. Opens on **today**.
- Below: **one card per vendor** for that outlet, that day. Each card shows the vendor, **how many items**, the **fulfilment** (collect / deliver / standing), the **₹ expected**, and a **status** (REQUESTED → ORDERED → RECEIVED → RAISED/PAID).
- This is the rule: **one vendor = one card = one order**. Even if many items go to the same vendor, it's a single card.

---

## 5. Place or confirm an order
1. Tap **Place order** (bottom-right).
2. **Pick the vendor** from the list.
3. Search the product under that vendor.
4. If the product already exists, tap **+** on the product row → a **quantity box** and **unit box** appear. For half kg, type `0.5` and keep unit `kg`. If the bill itself is in grams, type `500` and change unit to `g`. Tap **✕** to remove a line.
5. If the product is missing, tap **Product** next to the search box. This opens **Add product**.
6. Fill **Product name**, **Unit**, **Category**, and **Price mode**. Choose **Live bill rate** if the rate changes bill-to-bill, or **Fixed expected rate** if the expected rate should be saved.
7. Tap **Save product**. The app saves it under the selected vendor and immediately adds it to the order card.
8. The running total shows at the bottom (**N items · ₹ expected**).
9. Tap **Place order**. The card now appears on the day board under that vendor.
10. If the card came from Azeem/Nafees demand, open it and tap **Vendor order placed** after the real order is placed.

> Add items only for **one vendor** per order. For a second vendor, place another order — that keeps "one vendor, one card, one payment."

**Exact Add Product path:** Open **HN Ops** → enter Zoya PIN `2026` → **Sauda** → **Place order** → select **HE/NCH** date if needed → **Pick vendor** or tap **Vendor** to add one → search product → tap **Product** / **Add product** → **Save product**.

The product button is intentionally not a top-level tab. A product belongs under a vendor, so the app unlocks **Product** only after a vendor is selected.

**Unit rule in version 2.3:** do not create a second product just because one purchase is half kg. Keep the master item as kg and enter decimal quantity (`0.5 kg`). Change the line unit only when the vendor bill uses another unit, such as `g`, `pcs`, `box`, or `L`. If the line unit changes away from the master unit, the expected rate is cleared and that line becomes **rate at bill** so grams are never multiplied by a kg rate.

---

## 6. Receive an order
1. On the day board, tap the vendor's **card**.
2. You see every item that was ordered, with its quantity and rate.
3. Tap **Receive goods**.
4. Take **Goods photo** and **Bill photo**.
5. Each line shows a **received** box and a **rate** box. Correct quantity and rate from the actual bill.
6. Tap **Save proof**. The card turns **RECEIVED**.

A **⚠ note** on a line (e.g. "price is per box — confirm at bill") means the rate is checked against the actual bill later — it does not block receiving.

---

## 7. Payment trail
- After receiving, save method, amount, and reference.
- Bashir/Zoya can raise the trail; owner-level approval can mark paid.
- Cash-to-Tijori adjustment is not automatic yet; the saved trail is the proof basis for that later layer.

---

## 8. Updates — how the app stays current
- **Most changes need nothing from Zoya.** New vendors, new items, price or routing fixes live on our server — her app shows them the next time she opens a screen. No download.
- **Before login:** tap **Update app** on the PIN screen. If a newer app exists, the installer opens directly.
- **After login:** if a newer app exists, she also sees an **"Update available"** banner on the home screen → tap **Update**.
- First update asks **allow this source** once. After that, updates are one tap.

---

## What's deliberately **not** here (yet)
Automatic Tijori cash reduction, khata diary intelligence, and Nihaf Agent reminder loops are the next layers. This slice closes tomorrow's purchase miss: demand -> ordered -> received proof -> rate/payment trail.

*PINs: Azeem `7341` · Nafees `3160` · Zoya `2026` · Bashir `8523` · Admin Console `5634` · owner `0305`. Admin Console sees all outlets/chambers but does not carry final owner payment approval. App: HN Ops (Android). Backend: hn-ops-api (Cloudflare).*
