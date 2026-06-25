# HN Staff app — Sauda (purchase) · one-page manual

**What it is:** the app Zoya uses to **place** vendor orders and **receive** the goods when they arrive. One app, Android phone. Everything she sees is decided by her role — she only sees Sauda, nothing else.

---

## 1. Install (once)
1. Open the link on the phone: **https://hn-ops-api.pages.dev/get/**
2. Tap **Download & install** → open the file → if asked, **allow install from this source** → **Install**.
3. If a *Play Protect* warning shows, tap **Install anyway** (it's our own app).
4. Open **HN Staff**, type the **PIN** (Zoya = `2026`).

The phone asks to "allow this source" only the **first** time. After that, installs and updates are one tap.

---

## 2. Logging in
- Type the 4-digit PIN → tap **Enter**.
- The PIN *is* the identity. Zoya's PIN opens straight into **Sauda** (she's a Buyer). A manager's PIN would show all chambers; a kitchen PIN only Anbar. Nobody picks a screen — the role decides.

---

## 3. The day board (the home of Sauda)
- Pick the outlet at the top: **HE** or **NCH**.
- The date sits in the middle with **‹ ›** arrows — tap to move day to day. Opens on **today**.
- Below: **one card per vendor** for that outlet, that day. Each card shows the vendor, **how many items**, the **fulfilment** (collect / deliver / standing), the **₹ expected**, and a **status** (ORDERED → RECEIVED).
- This is the rule: **one vendor = one card = one order**. Even if many items go to the same vendor, it's a single card.

---

## 4. Place an order
1. Tap **Place order** (bottom-right).
2. **Pick the vendor** from the list.
3. Tap **+** on each item you want → a **quantity box** appears → type the amount (e.g. Maida → `10`), the unit (kg) is shown. Tap **✕** to remove a line.
4. The running total shows at the bottom (**N items · ₹ expected**).
5. Tap **Place order**. The card now appears on the day board under that vendor.

> Add items only for **one vendor** per order. For a second vendor, place another order — that keeps "one vendor, one card, one payment."

---

## 5. Receive an order
1. On the day board, tap the vendor's **card**.
2. You see every item that was ordered, with its quantity and rate.
3. Tap **Receive goods**.
4. Each line shows a **received** box pre-filled with the ordered amount. If less came (e.g. 8 of 10), just change the number.
5. Tap **Confirm received**. The card turns **RECEIVED**.

A **⚠ note** on a line (e.g. "price is per box — confirm at bill") means the rate is checked against the actual bill later — it does not block receiving.

---

## 6. Updates — how the app stays current
- **Most changes need nothing from Zoya.** New vendors, new items, price or routing fixes live on our server — her app shows them the next time she opens a screen. No download.
- **When the app itself changes,** she sees an **"Update available"** banner on the home screen → tap **Update** → it downloads and installs in place. No links, no reinstall hunting. (First update asks "allow this source" once; after that it's one tap.)

---

## What's deliberately **not** here (yet)
Paying vendors and the khata/diary are **owner-only** — Zoya places and receives, she never pays. Editing/cancelling a placed line, bill photos, and the one-payment-across-both-outlets rollup are the next layers. None of these block daily place-and-receive.

*PINs: Zoya `2026` (Buyer) · Bashir `8523` (Manager) · owner `0305`. App: HN Staff (Android). Backend: hn-ops-api (Cloudflare).*
