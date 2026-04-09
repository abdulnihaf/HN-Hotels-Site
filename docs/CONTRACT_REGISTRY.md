# HN Hotels — Contract Registry & Commission Breakdown
## Last Updated: 2026-04-09

---

# CONTRACT CHECKLIST

| # | Platform | Type | Brand | Contract File | Status |
|---|----------|------|-------|--------------|--------|
| 1 | Zomato | Delivery (Food Ordering) | Hamza Express | `Zomato_Delivery_HamzaExpress.pdf` | VERIFIED |
| 2 | Zomato | Delivery (Food Ordering) | Nawabi Chai House | `Zomato_Delivery_NawabiChaiHouse.pdf` | VERIFIED |
| 3 | Zomato | Dining (District/Pay via App) | Hamza Express | `Zomato_Dining_HamzaExpress_10027341.pdf` | VERIFIED |
| 4 | Zomato | Dining (District/Pay via App) | Nawabi Chai House | `Zomato_Dining_NawabiChaiHouse_10027783.pdf` | VERIFIED |
| 5 | EazyDiner | Dine-in bookings | Hamza Express | (images captured, original shared as PDF) | VERIFIED |
| 6 | Swiggy | Delivery | Both | — | MISSING |
| 7 | Razorpay | Payment Gateway | Both | — | MISSING |
| 8 | Rent | Lease Agreement | Both | — | MISSING |

---

# PRECISE COMMISSION BREAKDOWN BY CONTRACT

---

## CONTRACT 1 & 2: ZOMATO DELIVERY (Food Ordering & Delivery Services)
**Applies to: Hamza Express (Res ID 22632449) & Nawabi Chai House (Res ID 22632430)**
**Signed: 28 March 2026 | Entity: HN HOTELS PRIVATE LIMITED**
**Both contracts have IDENTICAL terms.**

### What is "Gross Sales"? (The base on which commission is calculated)

Per the contract definition:
> 'Gross Sales' shall mean the gross amount charged by the Restaurant Partner to any Customer
> that is attributable to any Order placed through the Platform including any charge payable by
> the Customer to the Restaurant and all applicable taxes LESS delivery charges (for orders
> delivered by restaurant partners themselves) and/or discounts, discounts being offered by the
> Restaurant on the Platform (if any).

**In plain English:**
```
Gross Sales = Food item prices
            + Applicable taxes (GST 5%)
            + Packaging charges (if any, charged to customer)
            - Delivery charges (ONLY if YOU deliver, not Zomato rider)
            - Restaurant-funded discounts (offers YOU fund on the platform)
```

**Since Zomato delivers (you use their logistics), delivery charges are NOT deducted from Gross Sales.**
**So for you: Gross Sales = Menu price + GST + Packaging - Your discounts**

### Fee Structure (post 30-day honeymoon):

| Fee Component | Rate | Calculated On | Example (Rs 350 order) |
|---|---|---|---|
| **Service Fee (within 4km)** | **18%** of Gross Sales | Gross Sales per order | Rs 350 × 18% = **Rs 63** |
| **Service Fee (beyond 4km)** | **18%** + Long Distance Fee | Gross Sales + per-order fee | Rs 63 + Rs 0-35 (see table below) |
| **Payment Mechanism Fee** | **1.84%** of Order Value | Order Value (what customer paid) | Rs 350 × 1.84% = **Rs 6.44** |
| **GST on Service Fee** | **18%** on the commission | The Service Fee amount | Rs 63 × 18% = **Rs 11.34** |
| **GST on Payment Fee** | **18%** on the payment fee | The Payment Fee amount | Rs 6.44 × 18% = **Rs 1.16** |

### Long Distance Enablement Fee (orders BEYOND 4km):

| Commissionable Value (CV) | 4-6 km | 6+ km |
|---|---|---|
| Rs 0-150 | Rs 0/order | Rs 35/order |
| Rs 150+ | Rs 15/order | Rs 35/order |

**CV = the amount on which Service Fee is calculated (Net Sales + taxes)**

### FULL DEDUCTION EXAMPLE — Rs 350 Order within 4km:

```
Customer pays:                           Rs 350.00
                                         ─────────
(-) Service Fee: 18% of Rs 350         = Rs  63.00
(-) GST on Service Fee: 18% of Rs 63  = Rs  11.34
(-) Payment Mechanism Fee: 1.84%       = Rs   6.44
(-) GST on Payment Fee: 18% of Rs 6.44= Rs   1.16
                                         ─────────
TOTAL ZOMATO DEDUCTIONS:               = Rs  81.94
                                         ─────────
NET PAYOUT TO YOU:                     = Rs 268.06
                                         ─────────
EFFECTIVE COMMISSION RATE:               23.41%
```

### Rs 350 Order BEYOND 6km (CV > Rs 150):

```
Customer pays:                           Rs 350.00
(-) Service Fee: 18%                   = Rs  63.00
(-) Long Distance Fee                  = Rs  35.00
(-) GST on Service Fee: 18% of Rs 63  = Rs  11.34
(-) Payment Fee: 1.84%                = Rs   6.44
(-) GST on Payment Fee                = Rs   1.16
                                         ─────────
TOTAL ZOMATO DEDUCTIONS:               = Rs 116.94
NET PAYOUT TO YOU:                     = Rs 233.06
EFFECTIVE COMMISSION RATE:               33.41%
```

### Penalty Deductions (additional costs that can eat into revenue):

| Penalty | When | Cost |
|---|---|---|
| **Customer complaint refund** | Customer complains (quality, missing item, delay) | **50% of refund amount** charged to you (exception: first 2 weeks) |
| **Order rejection (mild)** | Weekly rejections > 0.5% of volume | **10%** of Net Order Value of ALL rejected orders that week |
| **Order rejection (severe)** | Weekly rejections > 2% of volume | **25%** of Net Order Value of ALL rejected orders that week |
| **Price disparity** | Zomato price ≠ dine-in price (via mystery shopping) | **3x the price difference** per order, ongoing until fixed |
| **Discouraged practices** | Sending flyers/discounts to divert Zomato customers | Up to **Rs 1,00,000** per contravention |

### Honeymoon Period:
- **First 30 days (28 Mar → ~27 Apr 2026): Service Fee = 0%**
- Only Payment Mechanism Fee (1.84%) applies during this period
- Long Distance Fee also NOT applicable for first 30 days
- Customer complaint charges: exception for first 2 weeks
- Order rejection charges: exception for first 2 weeks

### Settlement:
- **Weekly** — orders from Mon-Sun settled by Thursday of following week
- Bank: **HDFC Bank**, A/C 50200118314680, IFSC HDFC0000514 (Current Account)

---

## CONTRACT 3 & 4: ZOMATO DINING (District / Pay via Application)
**Applies to: Hamza Express (Res ID 22632449) & Nawabi Chai House (Res ID 22632430)**

### Hamza Express — Dining:
| Service | Commission | Period | Settlement |
|---|---|---|---|
| Pay via Application | **7%** of Net Sales | 01/04/2026 → 01/04/2046 | Bi-weekly |
| Table Reservations | **7%** of Net Sales | 01/04/2026 → 01/04/2046 | Bi-weekly |

### Nawabi Chai House — Dining:
| Service | Commission | Period | Settlement |
|---|---|---|---|
| Pay via Application | **6.84%** of Net Sales | 04/04/2026 → 04/04/2046 | Bi-weekly |
| Table Reservations | **6.84%** of Net Sales | 04/04/2026 → 04/04/2046 | Bi-weekly |

### What is "Net Sales" for Dining?
Per the contract: District transfers "Net Sales received from the Customer" after deducting:
1. Service Fee
2. Taxes (GST on the service fee)
3. Any other amounts/charges under the contract

**In plain English:**
```
Net Sales = Total bill amount the customer pays via Zomato app at the restaurant
Commission = 7% (HE) or 6.84% (NCH) of that bill amount
+ GST on commission (18% of the commission)
```

### Dining Commission Example — Rs 500 bill at Hamza Express:
```
Customer pays via Zomato app:             Rs 500.00
(-) Commission: 7%                      = Rs  35.00
(-) GST on Commission: 18% of Rs 35    = Rs   6.30
                                          ─────────
TOTAL DEDUCTION:                        = Rs  41.30
NET PAYOUT:                             = Rs 458.70
EFFECTIVE RATE:                            8.26%
```

### Forfeited Cover Charge (Table Reservations):
If a customer books a cover-charge reservation and doesn't show up, the forfeited amount goes:
- **100% to Zomato** (for all reservation types: non-offer, offer-based, peak-hour)
- Duration: 01/04/2026 → 01/04/2046

### Settlement:
- **Bi-weekly** — Mon-Sun net sales settled by Wednesday of following week
- Same HDFC bank account

### Important Restrictions:
- If customer uses a Zomato Offer, they MUST pay via Zomato app/QR — no direct cash accepted for those transactions
- Cannot refuse Offer customers or discourage them from using Dining Services

---

## CONTRACT 5: EAZYDINER
**Applies to: Hamza Express only**
**Signed: 31 March 2026 | Manager: Faheem**

### Commission Structure:
| Fee Type | Rate | Notes |
|---|---|---|
| **EazyDeal (booking)** | **10%** discount to customer | Restaurant funds the discount |
| **Walk-in Offer** | **10%** discount to customer | Restaurant funds the discount |
| **PayEazy Commission** | **5% + 1.8% gateway** + applicable taxes (GST) | When customer pays via EazyDiner app |
| **Per-pax booking fee** | **Rs 30 per pax** + applicable taxes (GST) | Flat fee per person for reservation |

### EazyDiner Example — 4 people, Rs 2000 bill, pays via PayEazy:
```
Bill amount:                              Rs 2,000.00
(-) EazyDeal 10% discount (you fund):  = Rs   200.00  ← customer sees discount, you pay
(-) Per-pax fee: Rs 30 × 4 + GST 18%  = Rs   141.60  ← Rs 120 + Rs 21.60 GST
(-) PayEazy: 5% of Rs 1,800           = Rs    90.00  ← on post-discount amount
(-) Gateway: 1.8% of Rs 1,800         = Rs    32.40
(-) GST on PayEazy+Gateway             = Rs    22.03  ← 18% on Rs 122.40
                                          ──────────
TOTAL COST TO YOU:                      = Rs   486.03
EFFECTIVE COST:                            24.3% of original bill
```

### Restaurant Details on EazyDiner:
- Cuisine: Biryani, Chinese, North Indian
- Cost for two: Rs 500 (minus taxes)
- Timings: 1 PM to 1 AM
- Features: Wheelchair accessible, Kids allowed, Takeaway, AC, Match Screening, Home delivery
- Exit clause: 30-day written notice

---

## COMMISSION COMPARISON — ALL CHANNELS (Rs 350 order)

| Channel | Commission % | Payment Fee | GST on Fees | Total Deduction | Net to You | Effective % Lost |
|---|---|---|---|---|---|---|
| **Dine-in (Direct/Cash)** | 0% | 0% | 0 | Rs 0 | Rs 350 | **0%** |
| **Dine-in (Captain UPI)** | 0% | 0% (UPI MDR = 0) | 0 | Rs 0 | Rs 350 | **0%** |
| **Zomato Dining (HE)** | 7% of Net Sales | — | 18% on comm. | Rs 41.30 | Rs 308.70 | **8.26%** |
| **Zomato Dining (NCH)** | 6.84% of Net Sales | — | 18% on comm. | Rs 40.35 | Rs 309.65 | **8.07%** |
| **EazyDiner (PayEazy)** | 10% discount + 5% + 1.8% | Rs 30/pax | GST on fees | ~Rs 120+ | ~Rs 230 | **~24%** (4 pax) |
| **EazyDiner (walk-in only)** | 10% discount | Rs 30/pax | GST on pax fee | ~Rs 70+ | ~Rs 280 | **~15%** (2 pax) |
| **Zomato Delivery (<4km)** | 18% of Gross Sales | 1.84% of Order Value | 18% on both | Rs 81.94 | Rs 268.06 | **23.41%** |
| **Zomato Delivery (4-6km, CV>150)** | 18% of Gross Sales + Rs 15 | 1.84% | 18% on both | Rs 96.94 | Rs 253.06 | **27.70%** |
| **Zomato Delivery (6km+)** | 18% of Gross Sales + Rs 35 | 1.84% | 18% on both | Rs 116.94 | Rs 233.06 | **33.41%** |
| **WABA Direct (Razorpay UPI)** | 0% | **2% + 18% GST = 2.36%** | included | Rs 8.26 | Rs 341.74 | **2.36%** |
| **WABA Direct (Razorpay Card)** | 0% | **2% + 18% GST = 2.36%** | included | Rs 8.26 | Rs 341.74 | **2.36%** |

### RAZORPAY FEE STRUCTURE (Verified from Razorpay published pricing):
| Payment Method | Razorpay Fee | GST on Fee | Effective Rate |
|---|---|---|---|
| UPI (bank-to-bank) | **2%** | 18% GST on fee | **2.36%** total |
| Debit Card | **2%** | 18% GST on fee | **2.36%** total |
| Credit Card | **2%** | 18% GST on fee | **2.36%** total |
| Payment Links / QR | Same as payment method used | — | **2.36%** for UPI |
| No setup fee, no AMC | — | — | — |

**IMPORTANT NOTE on UPI MDR:**
- Government mandates **0% MDR on bank-to-bank UPI** — but Razorpay charges a **platform fee of 2%** which is separate from MDR
- Captain UPI at counter (direct UPI to your bank QR) = **0%** (no Razorpay involved)
- WABA orders via Razorpay payment link = **2% + GST = 2.36%** (Razorpay platform fee applies)

### PROFITABILITY RANKING (best to worst margin):
1. Dine-in Direct/Cash — **0% lost**
2. WABA Direct (Razorpay) — **~2% lost**
3. Zomato Dining — **~8% lost**
4. EazyDiner walk-in — **~15% lost**
5. Zomato Delivery within 4km — **23.4% lost**
6. EazyDiner PayEazy — **~24% lost**
7. Zomato Delivery 4-6km — **27.7% lost**
8. Zomato Delivery 6km+ — **33.4% lost**

---

## KEY DATES & DEADLINES

| Date | Event | Impact |
|---|---|---|
| **~27 Apr 2026** | Zomato delivery honeymoon ends (30 days from 28 Mar) | Commission jumps from 0% to 18% |
| **~11 Apr 2026** | Customer complaint exception ends (2 weeks from 28 Mar) | 50% of refund amounts start being charged |
| **~11 Apr 2026** | Order rejection penalty exception ends | Rejection penalties start applying |
| **01/04/2046** | Zomato Dining contracts expire (HE) | 20-year term |
| **04/04/2046** | Zomato Dining contracts expire (NCH) | 20-year term |

---

## BANK DETAILS (from contracts)

| Bank | Account | IFSC | Type | Used For |
|---|---|---|---|---|
| HDFC Bank | 50200118314680 | HDFC0000514 | Current | Zomato settlements (both brands) |

---

## CONTRACT 6: SWIGGY DELIVERY (Both HE & NCH — identical terms)
**Signed: 02 March 2026 | Digitally signed by Abdul Khader via MANCH on 04-Mar-2026**
**Entity: HN HOTELS PRIVATE LIMITED**
**FSSAI: 11226333000504**
**Duration: 12 months from Effective Date (reviewable)**
**GST Classification: Category I — Restaurant (Swiggy collects & deposits 5% GST)**
**Invoices sent to: hnhotelsindia@gmail.com**

### What is "Gross Value"? (The base for Swiggy commission)
The contract says "Gross value of each non Swiggy One order". Unlike Zomato which explicitly defines Gross Sales, Swiggy's Merchant Terms (referenced at partner.swiggy.com) define this similarly — the order value before platform deductions.

### Fee Structure:

| Fee Component | Rate | Calculated On | Example (Rs 350 order) |
|---|---|---|---|
| **Service Fee** | **18%** of Gross Value | Each non-Swiggy One order | Rs 350 × 18% = **Rs 63.00** |
| **Collection Fee** | **2.00%** | Payment collection | Rs 350 × 2% = **Rs 7.00** |
| **GST on Service Fee** | **18%** of Service Fee | Rs 63 | Rs 63 × 18% = **Rs 11.34** |
| **GST on Collection Fee** | **18%** of Collection Fee | Rs 7 | Rs 7 × 18% = **Rs 1.26** |
| **TCS (Tax Collected at Source)** | **1%** | Order value (CGST Act s.52) | Rs 350 × 1% = **Rs 3.50** |

### Swiggy One Additional Fee (Bangalore is listed):

| % of Swiggy One orders in the week | Per Swiggy One order fee |
|---|---|
| 0-20% | Rs 2/order |
| 21-40% | Rs 3/order |
| 41-60% | Rs 4/order |
| Above 60% | Rs 5/order |

GST applicable on Swiggy One fee as well.

### Full Deduction — Rs 350 Non-Swiggy One Order:
```
Customer pays:                              Rs 350.00
(-) Service Fee: 18%                      = Rs  63.00
(-) GST on Service Fee: 18%              = Rs  11.34
(-) Collection Fee: 2%                   = Rs   7.00
(-) GST on Collection Fee: 18%           = Rs   1.26
(-) TCS: 1%                              = Rs   3.50
                                            ─────────
TOTAL SWIGGY DEDUCTIONS:                  = Rs  86.10
NET PAYOUT TO YOU:                        = Rs 263.90
EFFECTIVE COMMISSION RATE:                   24.60%
```

### Full Deduction — Rs 350 Swiggy One Order (30% tier = Rs 3/order):
```
All above:                                = Rs  86.10
(-) Swiggy One fee                        = Rs   3.00
(-) GST on Swiggy One fee                = Rs   0.54
                                            ─────────
TOTAL:                                   = Rs  89.64
NET PAYOUT:                              = Rs 260.36
EFFECTIVE RATE:                              25.61%
```

### One-time Costs:
- **Onboarding Fee: Rs 1,769** — collected Rs 0 upfront, full Rs 1,769 deducted from weekly settlement

### Settlement:
- Weekly — after deductions of Service Fee, Collection Fee, and Other Charges + GST
- Bank: **HDFC Bank**, A/C 50200118314680, IFSC HDFC0000514

### Key Contractual Restrictions:
1. Cannot charge customers delivery fees (Swiggy handles logistics)
2. Cannot charge for anything other than food, beverages, and packaging
3. **Must maintain equal or lower prices** vs dine-in/takeaway/other channels
4. Cannot send marketing material/discounts to Swiggy customers to divert them
5. **Special portion sizes for platform must be proportionate** to own channel portions

---

## ZOMATO vs SWIGGY — HEAD-TO-HEAD COMPARISON (Rs 350 order)

| Fee Component | Zomato (<4km) | Swiggy (non-One) | Difference |
|---|---|---|---|
| Service Fee | 18% = Rs 63 | 18% = Rs 63 | Same |
| Payment/Collection Fee | 1.84% = Rs 6.44 | 2.00% = Rs 7.00 | Swiggy Rs 0.56 more |
| GST on Service Fee | Rs 11.34 | Rs 11.34 | Same |
| GST on Payment Fee | Rs 1.16 | Rs 1.26 | Swiggy Rs 0.10 more |
| TCS | 0 | 1% = Rs 3.50 | **Swiggy charges TCS** |
| **TOTAL DEDUCTIONS** | **Rs 81.94** | **Rs 86.10** | **Swiggy Rs 4.16 more** |
| **NET PAYOUT** | **Rs 268.06** | **Rs 263.90** | |
| **EFFECTIVE RATE** | **23.41%** | **24.60%** | **Swiggy 1.19% costlier** |

**NOTE on TCS:** The Rs 3.50 TCS is not a "cost" — it's tax collected at source that you can claim as credit when filing income tax returns. If we exclude TCS, Swiggy's effective cost becomes 23.60% vs Zomato's 23.41% — almost identical.

**Real cost difference (excluding TCS): Swiggy is ~0.19% more expensive per order due to higher collection fee (2% vs 1.84%).**

---

## FINAL COMPLETE COMMISSION COMPARISON — ALL CHANNELS (Rs 350 order)

| # | Channel | Total Deduction | Net to You | Effective % Lost | Contract |
|---|---------|----------------|-----------|-----------------|----------|
| 1 | **Dine-in (Cash/Captain UPI)** | Rs 0 | Rs 350 | **0%** | N/A |
| 2 | **WABA Direct (Razorpay UPI)** | Rs 8.26 | Rs 341.74 | **2.36%** | Razorpay standard |
| 3 | **Zomato Dining HE** | Rs 41.30 | Rs 308.70 | **8.26%** | VERIFIED |
| 4 | **Zomato Dining NCH** | Rs 40.35 | Rs 309.65 | **8.07%** | VERIFIED |
| 5 | **EazyDiner (walk-in, 2 pax)** | ~Rs 70 | ~Rs 280 | **~15%** | VERIFIED |
| 6 | **Zomato Delivery (<4km)** | Rs 81.94 | Rs 268.06 | **23.41%** | VERIFIED |
| 7 | **Swiggy Delivery (non-One)** | Rs 86.10 | Rs 263.90 | **24.60%** | VERIFIED |
| 8 | **EazyDiner (PayEazy, 4 pax)** | ~Rs 120+ | ~Rs 230 | **~24%** | VERIFIED |
| 9 | **Swiggy One (30% tier)** | Rs 89.64 | Rs 260.36 | **25.61%** | VERIFIED |
| 10 | **Zomato Delivery (4-6km)** | Rs 96.94 | Rs 253.06 | **27.70%** | VERIFIED |
| 11 | **Zomato Delivery (6km+)** | Rs 116.94 | Rs 233.06 | **33.41%** | VERIFIED |

---

## UPDATED CONTRACT CHECKLIST

| # | Platform | Type | Brand | Status | File |
|---|----------|------|-------|--------|------|
| 1 | Zomato | Delivery | HE | **VERIFIED** | Zomato_Delivery_HamzaExpress.pdf |
| 2 | Zomato | Delivery | NCH | **VERIFIED** | Zomato_Delivery_NawabiChaiHouse.pdf |
| 3 | Zomato | Dining (District) | HE | **VERIFIED** | Zomato_Dining_HamzaExpress_10027341.pdf |
| 4 | Zomato | Dining (District) | NCH | **VERIFIED** | Zomato_Dining_NawabiChaiHouse_10027783.pdf |
| 5 | EazyDiner | Dine-in | HE | **VERIFIED** | Hamza Express EAZY Diner.pdf |
| 6 | Swiggy | Delivery | Both | **VERIFIED** | Swiggy_Delivery_HamzaExpress_NCH.pdf |
| 7 | Razorpay | Payment Gateway | Both | **VERIFIED** (published rates) | Standard: 2% + 18% GST |
| 8 | Swiggy | Dine-out | Both | **NOT YET ONBOARDED** | Onboarding pending |
| 9 | Rent | Lease Agreement | Both | **MISSING** | Needed for break-even |

All contract PDFs saved to: `/Users/nihaf/Desktop/HN Hotels - Contracts/`
