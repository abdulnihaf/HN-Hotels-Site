# HN Money Flow — How to Use & Test Guide

**For:** Basheer · Noor · Zoya · Naveen · Tanveer · Faheem
**Goal:** Make sure every rupee spent or owed is recorded in the right place, exactly once, and shows up correctly in the Money Cockpit.

Last updated: 2026-04-24

---

## 1. The 5 Apps — Who Uses What, When

| # | App URL | Who | When to use it | What it records |
|---|---|---|---|---|
| 1 | `nawabichaihouse.com/ops/v2/` | Basheer / Kesmat / Nafees (NCH cashier) | When NCH outlet **pays cash from the till** for any expense — buns, milk, water, police, repairs, etc. | A paid expense that hits NCH cash register today. |
| 2 | `hamzaexpress.in/ops/v2/` | Noor (HE cashier) | When HE outlet **pays cash from the till** | A paid expense that hits HE cash register today. |
| 3 | `hnhotels.in/ops/purchase/` | Zoya | When she **places a purchase order** with a vendor (vendor will deliver later, payment will happen later) | A Purchase Order (PO). Just a commitment — no money has moved yet. |
| 4 | `hnhotels.in/ops/expense/` | Naveen | When **he personally pays** an expense from HN bank/UPI/cash, or records a vendor bill that wasn't from a PO | A central paid expense OR a direct vendor bill (cat 14). |
| 5 | `hnhotels.in/ops/money/` | Nihaf / Naveen / Zoya / GMs | **To check & verify** — never to record anything. | Read-only dashboard showing everything from #1–#4 in one place. |

**Rule of thumb:**
- *I paid in cash now* → use the outlet app (#1 or #2).
- *I'm placing an order, will pay later* → use Purchase (#3).
- *I paid from HN account or it's an HN-level expense* → use Expense (#4).
- *I want to see what's going on* → open Money Cockpit (#5).

---

## 2. The 3 Logical Operations

There are only THREE things that can happen in the system:

```
A. RAISE A PO       → no money moves yet (Zoya's app #3)
B. PAY A PO/BILL    → money moves (Zoya's app #3 register-payment, OR outlet app)
C. RECORD AN EXPENSE → money moved instantly (cash on spot — apps #1, #2, #4)
```

Each lives in a different "kind" inside Odoo:

| Operation | Odoo model | Cockpit shows it as | State means |
|---|---|---|---|
| Raise PO | `purchase.order` | Open POs tab | **Open / Pending** — vendor will deliver, we'll pay later |
| Receive bill from vendor | `account.move` | Bills Pending tab | **Owe vendor money** until we pay |
| Pay a bill | `account.payment` (auto) | Bill flips to "paid" | **Settled** |
| Direct expense (cash) | `hr.expense` | Paid tab | **Already paid** the moment it was recorded |

---

## 3. PINs You'll Need

| Person | App #1 NCH outlet | App #2 HE outlet | Apps #3, #4, #5 |
|---|---|---|---|
| Nihaf | 0305 | 0305 | 0305 |
| Naveen | — | — | 3754 |
| Zoya | — | — | 2026 |
| Basheer | 8523 (GM) | — | 8523 |
| Noor (HE cashier) | — | 15 | — |
| Kesmat (NCH cashier) | 14 | — | — |
| Nafees (NCH cashier) | 43 | — | — |
| Tanveer | — | — | 6890 |

---

## 4. Test Scenarios — Run These End-to-End

After each test, **open `hnhotels.in/ops/money/`** with PIN 0305 (Nihaf), set date range = today, and verify the row appears correctly. Tell me which test fails or shows wrong data.

### TEST 1 — Outlet cash expense (NCH)

**Story:** Basheer pays ₹50 cash at NCH counter for lemons.

1. Open `nawabichaihouse.com/ops/v2/` on phone.
2. Login with PIN **8523** (Basheer).
3. Tap **💸 Expense** → tap **Raw Material Purchase**.
4. Pick product **Lemon** (or add new).
5. Pick vendor (e.g., local).
6. Amount: **50**. Notes: "test entry — lemon".
7. Tap **Save Expense**. Wait for green ✓ toast.

**Verify in `/ops/money/` (login PIN 0305):**
- Date range: Today.
- **Paid tab** → row appears with:
  - Brand chip = `NCH`
  - Source chip = `NCH-Outlet`
  - State = `paid`
  - Item = "Lemon"
  - Amount = ₹50
  - By = "Basheer"
- ✅ KPI "Paid · 1 more" should increase by 1.
- ❌ Should NOT appear in Orphans tab.

---

### TEST 2 — Outlet cash expense (HE) — the recently-fixed flow

**Story:** Noor pays ₹100 cash at HE counter for vegetables.

1. Open `hamzaexpress.in/ops/v2/`.
2. Login with PIN **15** (Noor).
3. Open or continue an active shift.
4. Tap **Expense** → pick category **Petty / Operations** → pick product **Vegetable**.
5. Amount: **100**. Notes: "test entry — vegetable".
6. **Optional: attach a photo** of any receipt (the photo upload was just fixed).
7. Tap **Save expense**. Wait for green toast.

**Verify in `/ops/money/`:**
- **Paid tab** → row appears with:
  - Brand = `HE`
  - Source = `HE-Outlet`
  - State = `paid` (NOT `paid-orphan` — that was the bug we fixed)
  - Item = "Vegetable"
  - Amount = ₹100
  - By = "Shaik Noor Ahmed"
- ✅ KPI "Orphans" should NOT increase.
- If you uploaded a photo: re-open the row → expand details → confirm the Drive link works.

> **If this row appears as an Orphan, the fix didn't take effect — message Nihaf with a screenshot.**

---

### TEST 3 — Direct expense by Naveen (paid from HN account)

**Story:** Naveen pays ₹500 by Razorpay for internet bill.

1. Open `hnhotels.in/ops/expense/`.
2. Login with PIN **3754**.
3. Pick brand: **HQ** (or NCH/HE depending on whose internet).
4. Pick category **Utility Bill** → product **Internet / Broadband**.
5. Amount: **500**. Payment method: **Razorpay**.
6. Optionally attach receipt photo.
7. Tap **Save**.

**Verify in `/ops/money/`:**
- **Paid tab** → row appears with Source = `HN-Naveen`, By = "Naveen".
- KPI "Paid" should be +1.

---

### TEST 4 — Zoya raises a PO (no payment yet)

**Story:** Zoya orders ₹2,000 of mutton from a vendor; the vendor will deliver tomorrow.

1. Open `hnhotels.in/ops/purchase/`.
2. Login with PIN **2026**.
3. Pick brand: **HE**.
4. Tap **Raw Material Purchase** (cat 1).
5. Pick vendor (e.g., **H.K.G.N Mutton Stall**).
6. Add product mutton, qty 1, price ₹2000.
7. Tap **Confirm Purchase Order**.

**Verify in `/ops/money/`:**
- **Open POs tab** → new PO appears with:
  - Brand = `HE`, State = `open-po`
  - Vendor = "H.K.G.N Mutton Stall"
  - Amount = ₹2,000
  - **By = "Zoya"** (this attribution was just fixed — older POs show "—")
- ✅ KPI "Open POs · ₹X" should increase by ₹2,000.
- ❌ Should NOT appear in Paid tab (no money has moved yet).

---

### TEST 5 — Vendor sends bill, then we pay it (the 3-way match)

**Continuing from TEST 4:** Vendor delivers and gives Zoya a bill.

1. In `/ops/purchase/`, find the PO from Test 4.
2. Tap **Record Bill** (or use cat 15 in `/ops/expense/`).
3. Enter bill ref (e.g., "INV-001"), bill date = today, amount = ₹2,000.
4. **Attach photo of the bill.** Save.

**Verify in `/ops/money/`:**
- **Bills Pending tab** → new row:
  - Bill Ref = "INV-001"
  - Vendor = "H.K.G.N Mutton Stall"
  - From PO = the PO number from Test 4
  - State = `bill-pending`
  - 📎 column should show a clickable link to your photo (Drive)
- KPI "Bills Pending · ₹2,000" should increase.

**Now pay the bill:**
1. Back in `/ops/purchase/`, find the bill.
2. Tap **Register Payment** → pick journal (HE Cash / Razorpay / etc.).
3. Amount = ₹2,000. Date = today. Confirm.

**Verify in `/ops/money/`:**
- Bills Pending tab — row should DISAPPEAR.
- Bills Pending KPI drops by ₹2,000.
- (The bill is now "paid" — visible in the Paid sub-section of Bills tab if you scroll down.)

---

### TEST 6 — Cross-kind duplicate detection (the architectural check)

**Story:** Basheer buys ₹1000 of buns from Ganga Bakery in cash (outlet). Same day, Zoya raises a PO for ₹996 of buns from Ganga Bakery.

1. Do TEST 1 but for "Bun" from "Ganga Bakery", amount **1000**.
2. Do TEST 4 but for "Ganga Bakery" vendor, amount **996**.
3. Wait 30 seconds.

**Verify in `/ops/money/`:**
- Open the **🔁 Dupes tab**.
- The two entries should appear together as a **🔴 Cross-system suspect** card with:
  - Left side: the PO (Zoya, ₹996, Ganga Bakery)
  - Right side: the outlet payment (Basheer, ₹1000, Bun)
  - Vendor match: ~100%, Amount diff: ~0.4%, Confidence: high
- This is the system warning you that this purchase is probably double-counted in P&L. **Either close the PO** (it's already paid) **OR delete the outlet expense** (the bill will come via PO instead).

---

## 5. The Money Cockpit — what each tab tells you

| Tab | What it answers |
|---|---|
| **💸 Paid** | "What did we actually spend?" — every rupee that left our hands, across all sources. |
| **📋 Open POs** | "What did we order but haven't been billed for yet?" |
| **🧾 Bills Pending** | "What do we owe vendors right now?" — overdue bills shown in red. |
| **⚠ Orphans** | "Did any outlet entry fail to reach Odoo?" — should normally be 0. |
| **🔁 Dupes** | "Did we record the same purchase twice?" — review and clean up. |

**KPI strip at top:**
- Paid total = real money spent.
- Open POs total = future liability if vendors actually bill.
- Bills Pending = current owed.
- Orphans count = data integrity alarm (should be 0 after fixes).
- Dupe count = clean-up backlog.

**Filters:**
- Brand chips (ALL / NCH / HE / HQ) — narrow to one brand.
- Date pickers + 7d / 30d / 90d quick ranges.

---

## 6. Common Gotchas & Fixes

| Symptom | Likely cause | What to do |
|---|---|---|
| Saved expense at outlet but doesn't show in cockpit | Cockpit cached — hit Refresh button (top-right of `/ops/money/`) | Hit refresh, then check the Orphans tab too. |
| Cockpit shows "by —" on a PO | PO created before 2026-04-24 (no attribution back then). | Going forward all new POs show who created them. Historical ones can't be recovered. |
| HE outlet expense shows as Orphan | The fix didn't deploy or photo upload failed. | Tell Nihaf; he'll re-trigger the sync. |
| Same-feed duplicate alert that ISN'T actually a duplicate | E.g., 3 different police payments each ₹100 same day. | Ignore — system can't tell them apart by description. Real action: just don't worry about it. |
| Cross-system duplicate alert that ISN'T actually a duplicate | E.g., outlet bought ₹1000 of buns AND Zoya placed a separate PO for tomorrow's buns. | Open the dup card, confirm both are legitimate, ignore. (Future: a "Mark not duplicate" button is planned.) |
| Photo doesn't appear in cockpit 📎 column | Either: (a) photo upload failed, (b) you uploaded directly in Odoo (not via our UI). | Re-upload via the app. We track Drive URLs only when uploads come through our APIs. |

---

## 7. Reporting issues back to Nihaf

When something looks wrong, message me with:

1. **Which app** you used (URL).
2. **Which test scenario** (1–6 above) or describe what you did.
3. **Screenshot** of the cockpit row (or absence).
4. **Time** you did the action.

That's enough for me to trace it across NCH/HE/HN logs.

---

## Appendix: Live URLs

- NCH outlet: https://nawabichaihouse.com/ops/v2/
- HE outlet: https://hamzaexpress.in/ops/v2/
- Purchase (Zoya): https://hnhotels.in/ops/purchase/
- Expense (Naveen): https://hnhotels.in/ops/expense/
- **Money Cockpit (everyone): https://hnhotels.in/ops/money/**
