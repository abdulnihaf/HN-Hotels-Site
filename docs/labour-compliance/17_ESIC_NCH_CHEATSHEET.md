# ESIC Employer Registration — Nawabi Chai House (NCH) — Field-by-Field

**Portal:** [https://www.esic.in](https://www.esic.in) → Sign Up → New Employer Registration
**Service:** Form 01 — Registration of Establishment under ESI Act 1948
**Estimated time:** 45 min Form 01 + 45 min adding 9 IPs = ~90 min
**Fee:** ZERO
**Output:** Separate 17-digit ESI Code Number for NCH (different from HE)

---

## Important — NCH is a SEPARATE Registration

ESIC issues one Code Number per **establishment** (physical premises), not per legal entity. Even though HE and NCH are both under HN Hotels Pvt Ltd, they need:
- Separate ESI Codes (different 17-digit numbers)
- Separate monthly challans
- Separate IP rosters

You'll create a new login session OR use the same login but click **"Add New Establishment"** in your dashboard after HE is done.

---

## Pre-flight Check

- [ ] HE ESIC registration complete (you have HE's 17-digit code)
- [ ] NCH rent agreement (`20_NCH_Rent_Agreement.pdf`)
- [ ] NCH electricity bill (`21_NCH_Electricity_Bill.pdf`)
- [ ] NCH signboard photo (`22_NCH_Signboard.jpg`)
- [ ] NCH FSSAI License (`23_NCH_FSSAI.pdf`)
- [ ] NCH full address (door + street + pincode)
- [ ] 4 missing employee Aadhaars collected (Sabir Ahmed, MD Reyaj Ali, MD Maqbool, Ameer Khan)
- [ ] Cancelled cheque already uploaded for HE — same file works for NCH

---

## Section 1 — Login

Use same credentials as HE (same employer login). Click **"Add Establishment"** or **"New Form 01 — Different Unit"**.

---

## Section 2 — Form 01 (Form 1) — NCH

### A. Employer Details

(Same as HE — same legal entity)

| Field | Value |
|---|---|
| Legal Name | **HN HOTELS PRIVATE LIMITED** |
| Constitution | **Private Limited Company** |
| CIN | **U55101KA2023PTC182051** |
| PAN | **AAHCH1024M** |
| TAN | **BLRH15862A** |
| GSTIN | (same) |
| Udyam | **UDYAM-KR-03-0606827** |
| Registered Office | (same registered office address) |

### B. Establishment Details (NCH-specific)

| Field | Value |
|---|---|
| Name of Unit | **Nawabi Chai House** |
| Address Line 1 | 🔴 **[NCH door no. + street]** |
| Address Line 2 | **Shivajinagar** |
| City | **Bangalore** |
| District | **Bengaluru Urban** |
| State | **Karnataka** |
| Pincode | (NCH actual pincode — likely 560051 or 560002) |
| Telephone | (NCH outlet phone) |
| Nature of Business | **Cafe — Tea House / Eating House** |

### C. ESI Applicability

| Field | Value |
|---|---|
| Date of Commencement | **03/02/2026** (NCH launched ~3 Feb 2026) |
| Date Establishment first employed 10+ persons | (within 1-2 months of launch — owner to confirm) |
| Date ESI Act first applicable | (same as above) |
| Total Employees as on date | **12** |
| Employees ≤ ₹21,000/month (covered) | **9** |
| Employees > ₹21,000/month (excluded) | **3** (Mujib ₹45K, Moin ₹45K, Nafees ₹25K) |

### D. Power Source

| Field | Value |
|---|---|
| Power-driven? | **Yes** (electrical equipment) |
| Registered under Factories Act | **No** |

### E. Authorised Signatory

(Same as HE — Abdul Khader Nihaf, MD, DIN 08387440, PAN BEQPN1435R)

### F. Bank Details

(Same HDFC account as HE)

### G. Documents to Upload (NCH-specific in **bold**)

| Asked For | File |
|---|---|
| Certificate of Incorporation | `02_Certificate_of_Incorporation.pdf` |
| Company PAN | `01_HN_Hotels_Company_PAN.pdf` |
| GSTIN | `05_HN_Hotels_GSTIN.pdf` |
| Udyam | `06_HN_Hotels_Udyam.pdf` |
| **NCH FSSAI License** | `23_NCH_FSSAI.pdf` |
| **NCH Rent Agreement** | `20_NCH_Rent_Agreement.pdf` |
| **NCH Electricity Bill** | `21_NCH_Electricity_Bill.pdf` |
| **NCH Signboard Photo** | `22_NCH_Signboard.jpg` |
| Cancelled Cheque | `18_HDFC_Cancelled_Cheque.pdf` |
| Director Aadhaar | `10_Director_Nihaf_Aadhaar.pdf` |
| Director PAN | `09_Director_Nihaf_Personal_PAN.jpg` |
| Board Resolution | `08_BR_MD_Appointment.pdf` |
| S&E Registration NCH | `24_NCH_SE_Application_Receipt.pdf` (or pending) |

### H. Submit

After submit → 17-digit ESI Code for NCH issued. Save it.

---

## Section 3 — Add Insured Persons (NCH — 9 employees)

After NCH ESI Code received, switch to NCH establishment in dashboard, click **"Insured Person" → "Add IP"** for each:

(Data from `HN_ESIC_IP_Bulk_Upload.csv` — NCH ESI-zone rows)

| # | PIN | Name | Aadhaar | DOB | Phone | New Gross |
|---|---|---|---|---|---|---|
| 1 | 14 | Md Kesmat Sk | 3244 9506 9098 | 12/04/1998 | 8637895699 | ₹18,402 |
| 2 | 25 | B Aadil Ahmed | 7449 7545 0245 | 24/08/1992 | 9994885263 | ₹17,433 |
| 3 | 29 | Md Aktar | 4606 2896 3828 | 07/07/1998 | 8787894755 | ₹17,433 |
| 4 | 24 | Sabir Ahmed | 🔴 collect | 🔴 collect | 9100533428 | ₹17,433 |
| 5 | 26 | MD Reyaj Ali | 🔴 collect | 🔴 collect | 7870510936 | ₹17,433 |
| 6 | 27 | Dhananjai Singh | 4600 8988 6106 | 05/09/1994 | 8874730537 | ₹17,433 |
| 7 | 33 | Noim Uddin | 3567 3085 8131 | 02/04/2006 | 8729813746 | ₹17,433 |
| 8 | 30 | MD Maqbool | 🔴 collect | 🔴 collect | 9366412521 | ₹17,433 |
| 9 | 34 | Ameer Khan | 🔴 collect | 🔴 collect | 7005607097 | ₹17,433 |

For each:
- Wage components:
  - Basic: ₹15,001 (₹15,001 for ₹18,402 also; smartSplit gives basic = 15001)
  - HRA: ~₹1,200-1,700
  - Other: ~₹1,200-1,700
- Family details (collect during signing day if not now)
- Bank details (optional)

Generate e-Pehchan card PDF for each → download → hand to employee.

---

## Section 4 — Display + Posting at NCH

- Fill ESI Code in NCH Statutory Notice
- Display nearest ESIC Dispensary address
- Post all 5 statutory notices laminated at NCH entrance

---

## Section 5 — Monthly Compliance (NCH)

By 15th of every following month:
1. Login → switch to NCH establishment
2. Generate Monthly Contribution Challan
3. For NCH: ~₹6,300/month (9 employees × ~₹17,500 avg × 4%)
4. Pay via HDFC

---

## Section 6 — Combined Monthly Burden

| Establishment | Monthly ESI (employer + employee combined) |
|---|---|
| HE | ~₹3,500 |
| NCH | ~₹6,300 |
| **Total** | **~₹9,800/month** |

Of which:
- Employer share (3.25%): ~₹7,969/month
- Employee share (0.75%): ~₹1,841/month — deducted from each IP's wage

The employee share comes out of their wage automatically (via Option C pass-through).

The employer share is the recurring obligation. Folded into the ₹12K/year extra cost we already calculated for the Laden + Yahabu wage bumps... wait, those are separate.

Total recurring cost reality:
- Laden + Yahabu wage bump: ₹12,000/yr
- HE+NCH employer ESI: ~₹95,628/yr
- BUT employer ESI is offset by the gross-down that Option C pass-through does
- Net: ~₹12K/yr extra (just the bump for those 2 employees)

---

## After NCH ESIC Done

You now have:
- HE ESI Code (17 digits)
- NCH ESI Code (17 digits)
- 14 IP Numbers across both
- 14 e-Pehchan cards
- HDFC challan flow set up

Tell parent chat: "ESIC HE: [code]. ESIC NCH: [code]. 14 IPs added." — memory will update.

Next: compounding visit to Senior Labour Inspector.
