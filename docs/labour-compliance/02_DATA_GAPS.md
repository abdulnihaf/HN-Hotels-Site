# Data Gaps — Must Collect Before ESIC Registration

**Status:** 🔴 BLOCKER for ESI registration
**Source:** Live D1 query on `hr_employees` table, 2026-05-07

---

## Critical (5 ESI-zone employees — cannot register without this)

These 14 employees go INTO ESI. ESIC portal needs Aadhaar + DOB at minimum:

| Brand | PIN | Name | Role | Aadhaar | DOB | Phone (for follow-up) |
|---|---|---|---|---|---|---|
| HE | 8 | **Faisal Ali** | Cleaner | 🔴 MISSING | 🔴 MISSING | 9955692916 |
| NCH | 24 | **Sabir Ahmed** | Runner | 🔴 MISSING | 🔴 MISSING | 9100533428 |
| NCH | 26 | **MD Reyaj Ali** | Cleaner | 🔴 MISSING | 🔴 MISSING | 7870510936 |
| NCH | 30 | **MD Maqbool** | Cleaner | 🔴 MISSING | 🔴 MISSING | 9366412521 |
| NCH | 34 | **Ameer Khan** | Washer/Dishwasher | 🔴 MISSING | 🔴 MISSING | 7005607097 |

**Action:** Tomorrow morning — collect Aadhaar photocopies + read DOB from card + photograph and upload to their Drive folders. CAMS biometric is already enrolled (`bio_enrolled: 1`) so the people are physically here — just need their cards.

After collection, update D1 via `/ops/hr` page and let Odoo sync run.

---

## Lower priority (8 above-ESI-ceiling employees — needed for Form 11)

These employees won't be enrolled in ESI (above ceiling) but will sign Form 11 for EPF exclusion. Form 11 needs Aadhaar + PAN + DOB:

| Brand | PIN | Name | Role | Old Gross | Aadhaar | DOB |
|---|---|---|---|---|---|---|
| HE | 12 | Azeem | Head Chef | ₹36K | 🟡 MISSING | 🟡 MISSING |
| HE | 41 | Ramjan | Tandoor Asst | ₹27K | 🟡 MISSING | 🟡 MISSING |
| HE | 39 | SK Muntaz | Captain | ₹25K | 🟡 MISSING | 🟡 MISSING |
| HE | 28 | Paresh | Porotta Maker | ₹24K | 🟡 MISSING | 🟡 MISSING |
| HQ | — | Abdul Khader Nihaf | MD | ₹30K | 🟡 MISSING | 🟡 MISSING |
| HQ | — | B Naveen Kumar | CFO | ₹30K | 🟡 MISSING | 🟡 MISSING |
| HQ | 35 | Zoya Ahmed | Office Exec | ₹20K | 🟡 MISSING | 🟡 MISSING |
| NCH | 43 | Nafees Ahmed | Cashier | ₹25K | 🟡 MISSING | 🟡 MISSING |

**Action:** Same collection drive. Less time-critical than the 5 above. Can be sequenced over a week.

---

## Already complete (no action needed)

19 of 32 employees have Aadhaar on file. See `01_RESTRUCTURE_WORKSHEET.csv` for the full status per employee.

---

## Collection method

For each missing employee:
1. Ask for Aadhaar card during their shift (most are at outlet daily)
2. Photograph front + back with phone
3. Upload to their Drive folder (existing structure: each employee has folder ID in `drive_folder_id` column)
4. Read out the 12-digit Aadhaar number → enter in `/ops/hr` employee edit screen
5. Read DOB from Aadhaar card → enter in `aadhar_dob` field
6. Save → triggers Odoo sync

Should take ~3 minutes per employee. 13 missing × 3 min = ~40 minutes total field work.

---

## Why we need this exact data

| Field | Used for |
|---|---|
| Aadhaar | ESIC IP (Insured Person) registration. ESIC accepts Aadhaar as primary KYC. |
| DOB | ESIC eligibility validation + Form 11 (EPF) |
| PAN | Form 11 (preferred but Aadhaar can substitute) |
| Bank account | ESI cash benefit payouts (only if employee falls sick — can be added later) |

**Bank account is NOT required at registration time.** Can be added when first sickness claim arises. Don't block on this.
