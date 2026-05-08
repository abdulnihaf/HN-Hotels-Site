# ESIC Employer Registration — Hamza Express (HE) — Field-by-Field

**Portal:** [https://www.esic.in](https://www.esic.in) → Sign Up → New Employer Registration
**Alternative:** [https://www.esic.gov.in](https://www.esic.gov.in)
**Service:** Form 01 — Registration of Establishment under ESI Act 1948
**Estimated time:** 45 min for Form 01 + 30 min for adding 5 IPs = ~75 min
**Fee:** ZERO (no government fee)
**Output:** 17-digit ESI Code Number — instant to 48 hours
**ESI Act applicability:** Triggered at 10+ employees; HE has 16 → mandatory

---

## Pre-flight Check

- [ ] All KYC docs in `~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/`
- [ ] HDFC cancelled cheque (PDF) in KYC pack as `18_HDFC_Cancelled_Cheque.pdf`
- [ ] HE rent agreement (PDF) — `14_HE_Rent_Agreement.pdf`
- [ ] HE electricity bill (PDF) — `15_HE_Electricity_Bill.pdf`
- [ ] HE signboard photo (JPEG) — `16_HE_Signboard.jpg`
- [ ] HE FSSAI license PDF — `17_HE_FSSAI.pdf`
- [ ] S&E Application Receipt for HE (`19_HE_SE_Application_Receipt.pdf`) OR pending S&E note — ESI accepts pending S&E
- [ ] Aadhaars of 5 ESI-zone employees + their phones + DOB:
  - Faisal Ali, Sabir Ahmed (NCH actually), MD Reyaj Ali (NCH), MD Maqbool (NCH), Ameer Khan (NCH)
  - For HE specifically, only **Faisal Ali** is the missing-Aadhaar one. Other 4 HE ESI-zone (Anthony, Faizan, Hardev Prasad, Dhiraj Kumar, plus Laden/Yahabu) all have Aadhaar in `01_RESTRUCTURE_WORKSHEET.csv`

---

## Section 1 — Sign Up as New Employer

| Field | Value |
|---|---|
| Click | "Sign Up" then "New Employer Registration" |
| Type of Unit | **Private Limited Company** |
| Establishment Name | **Hamza Express** |
| Industry Type | **Service > Hotels & Restaurants > Eating House** |
| Mobile Number | (your mobile) |
| Email | **nihafwork@gmail.com** |
| OTP | sent to your mobile |
| Password | create + save |

After OTP + password setup → temporary login → Form 01 dashboard.

---

## Section 2 — Form 01 (Form 1) — HE Employer Registration

### A. Employer Details

| Field | Value |
|---|---|
| Legal Name of Employer | **HN HOTELS PRIVATE LIMITED** (exactly as on PAN) |
| Constitution | **Private Limited Company** |
| Date of Incorporation | **11/12/2023** |
| CIN | **U55101KA2023PTC182051** |
| PAN | **AAHCH1024M** |
| TAN | **BLRH15862A** |
| GSTIN | (lookup from `05_HN_Hotels_GSTIN.pdf`) |
| Udyam | **UDYAM-KR-03-0606827** |
| Registered Office | **#22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore – 560051** |

### B. Establishment / Factory Details

| Field | Value |
|---|---|
| Name of Unit | **Hamza Express** |
| Address Line 1 | **#19, H.K.P. Road (Broadway)** |
| Address Line 2 | **Shivajinagar** |
| City | **Bangalore** |
| District | **Bengaluru Urban** |
| State | **Karnataka** |
| Pincode | **560051** |
| Telephone | (HE outlet phone if any) |
| Email | **nihafwork@gmail.com** |
| Nature of Business | **Restaurant / Eating House** |

### C. ESI Applicability

| Field | Value |
|---|---|
| Date of Commencement | (HE actual launch date — 2024 or earliest known) |
| Date Establishment first employed 10+ persons | (when HE crossed 10 employees — owner to confirm; if unknown, conservatively use 90 days before today) |
| Date ESI Act first becomes applicable | (same as above — earliest of these two dates) |
| Total Employees as on date | **16** |
| Employees drawing wages ≤ ₹21,000/month (covered) | **5** (after Laden + Yahabu wage bump to ₹21,500) |
| Employees drawing wages > ₹21,000/month (excluded) | **11** |

> If you haven't bumped Laden + Yahabu yet, use **7 covered, 9 excluded**. Plan to bump them BEFORE adding IPs.

### D. Power Source (relevant if Factory Act would apply)

| Field | Value |
|---|---|
| Power-driven? | **Yes** (electrical equipment used) |
| Whether registered under Factories Act | **No** |

### E. Authorised Signatory

| Field | Value |
|---|---|
| Name | **Abdul Khader Nihaf** |
| Designation | **Managing Director** |
| DIN | **08387440** |
| PAN (personal) | **BEQPN1435R** |
| Aadhaar | (Owner's 12-digit) |
| Mobile | (your mobile) |
| Email | **nihafwork@gmail.com** |
| Address | (same as registered office) |

### F. Bank Details

| Field | Value |
|---|---|
| Bank | **HDFC Bank** |
| Branch | **Bannerghatta Road** |
| Account No. | (from cancelled cheque) |
| IFSC | (from cancelled cheque) |
| MICR | (from cancelled cheque) |

### G. Documents to Upload

| Asked For | File |
|---|---|
| Certificate of Incorporation | `02_Certificate_of_Incorporation.pdf` |
| Company PAN | `01_HN_Hotels_Company_PAN.pdf` |
| GSTIN | `05_HN_Hotels_GSTIN.pdf` |
| Udyam | `06_HN_Hotels_Udyam.pdf` |
| HE FSSAI License | `17_HE_FSSAI.pdf` |
| HE Rent Agreement | `14_HE_Rent_Agreement.pdf` |
| HE Electricity Bill | `15_HE_Electricity_Bill.pdf` |
| HE Signboard Photo | `16_HE_Signboard.jpg` |
| Cancelled Cheque | `18_HDFC_Cancelled_Cheque.pdf` |
| Director Aadhaar | `10_Director_Nihaf_Aadhaar.pdf` |
| Director PAN | `09_Director_Nihaf_Personal_PAN.jpg` |
| Board Resolution | `08_BR_MD_Appointment.pdf` |
| S&E Registration | `19_HE_SE_Application_Receipt.pdf` (or pending application note) |

### H. Submit

After review → **Submit Form 01**. ESIC may auto-issue 17-digit ESI Code instantly OR within 24-48 hrs after backend verification.

**Save the ESI Code immediately** — you'll need it for:
- Adding Insured Persons (next step)
- Monthly contribution challan
- Display at outlet
- Inspector visit

---

## Section 3 — Add Insured Persons (HE — 5 employees)

After receiving HE ESI Code, click **"Insured Person" → "Add IP"** and add each of these 5 employees:

(Note: data from `~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/HN_ESIC_IP_Bulk_Upload.csv` — HE ESI-zone rows)

| # | PIN | Name | Aadhaar | DOB | Phone | New Gross |
|---|---|---|---|---|---|---|
| 1 | 38 | Anthoni Dhan (Anthony) | 7887 4918 0777 | 21/12/1997 | 8688591863 | ₹17,433 |
| 2 | 4 | Faizan Hussain | 4375 8772 3617 | 10/12/2004 | 7088155640 | ₹17,433 |
| 3 | 8 | Faisal Ali | 🔴 collect Aadhaar | 🔴 collect DOB | 9955692916 | ₹17,433 |
| 4 | 3 | Hardev Prasad Singh | 9155 7398 1328 | 04/10/1996 | 9771495736 | ₹17,433 |
| 5 | 36 | Dhiraj Kumar | 6510 8443 0755 | 14/03/2004 | 9399906842 | ₹17,433 |

For each IP, enter:

- **Aadhaar** — auto-fetches name, DOB, address, photo from UIDAI
- **Date of Joining** — earliest known; if unknown, use 1 January 2025 as conservative
- **Wage details:**
  - New Gross: ₹17,433
  - Basic: ₹15,001
  - HRA: ₹1,216
  - Other: ₹1,216
- **Family details** (collect during signing day or now):
  - Spouse: name, DOB, Aadhaar (if married)
  - Children: name, DOB (up to 2)
  - Parents: name, DOB (if dependent)
- **Bank details** (optional at registration; can be added later for sickness benefit payouts)

After Add: ESIC generates **IP Number** + **e-Pehchan Card PDF** — download and print, give to employee.

---

## Section 4 — Display + Posting

After ESI Code received:
- Fill in the ESI Code on the **Statutory ESI Notice** at the outlet (the blank line in `HN_Statutory_Notices.docx`)
- Display ESIC Dispensary address (find via [https://www.esic.in](https://www.esic.in) → Find Dispensary)
- Print and post all 5 statutory notices (laminated A3 if possible)

---

## Section 5 — Monthly Compliance (after registration active)

By **15th of every following month**:
1. Login to ESIC employer portal
2. Generate **Monthly Contribution Challan** — system computes 4% (3.25% employer + 0.75% employee) on total ESI-zone wages
3. For HE: ~₹600/month (5 employees × ₹17,433 × 4% = ₹3,486; but only HE — NCH is separate)
4. Pay via HDFC net banking
5. Upload monthly return showing per-IP wage and days worked

Set CFO Naveen up with portal access for ongoing compliance.

---

## Section 6 — Common Errors

| Error | Fix |
|---|---|
| "GSTIN-PAN mismatch" | Verify both — they must reflect same legal entity |
| "Address mismatch with FSSAI" | Use exact address from FSSAI license verbatim |
| "Aadhaar verification failed for IP" | Employee's Aadhaar may be locked, or biometrics suspended; ask them to unlock at uidai.gov.in |
| "Date of joining vs date of ESI applicability" | DOJ must be ≥ ESI applicability date for that employee |
| "Photo too large" | Compress signboard photo to <2MB |

---

## After HE Done

ESIC code for HE saved. Move to NCH cheatsheet (`17_ESIC_NCH_CHEATSHEET.md`) — same flow, separate registration.

Tell parent chat: "ESIC HE: [17-digit code]" so memory updates.
