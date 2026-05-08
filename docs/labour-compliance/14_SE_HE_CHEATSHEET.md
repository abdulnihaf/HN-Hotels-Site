# Karnataka S&E Registration — Hamza Express (HE) — Field-by-Field

**Portal:** [https://ekarmika.karnataka.gov.in](https://ekarmika.karnataka.gov.in)
**Fallback portal:** [https://sevasindhu.karnataka.gov.in](https://sevasindhu.karnataka.gov.in) → Search "Karnataka Shops and Commercial Establishments Act, 1961"
**Service:** Form A — Application for Registration of Establishment under Karnataka SE Act 1961
**Estimated time:** 30-45 minutes co-pilot
**Fee:** ₹500-3,000 (depends on employee count, see below)
**Output:** Registration Certificate (RC) issued in 7-15 days; provisional ack instantly

---

## Pre-flight Check

Confirm before starting:

- [ ] All KYC docs in `~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/`
- [ ] HE rent agreement / ownership proof (PDF)
- [ ] HE latest BESCOM electricity bill (PDF)
- [ ] HE signboard photo (JPEG)
- [ ] Owner's mobile near you (for OTP)
- [ ] HDFC card / UPI for fee payment (~₹3,000)

---

## Section 1 — Login / Sign Up on eKarmika

Owner first-time login uses Aadhaar OTP authentication.

| Field | Value |
|---|---|
| Login type | New Employer / Owner |
| Mobile Number | (your mobile registered with Aadhaar) |
| Aadhaar Number | (Owner's 12-digit — see `10_Director_Nihaf_Aadhaar.pdf`) |
| OTP | Sent to registered mobile |
| Password (after first login) | Create + save |

If eKarmika throws errors, fall back to Sevasindhu — same credentials.

---

## Section 2 — Application Form A (HE)

### A. Establishment Details

| Field | Value |
|---|---|
| Name of Establishment | **Hamza Express** |
| Postal Address | **#19, H.K.P. Road (Broadway), Shivajinagar, Bangalore – 560051** |
| District | **Bengaluru Urban** |
| Taluk / Zone | **Bengaluru East** |
| Police Station | **Shivajinagar Police Station** |
| Pincode | **560051** |
| Establishment Type | **Commercial Establishment — Restaurant / Eating House** |
| Nature of Business | **Quick Service Restaurant — Indian / Mughlai cuisine, biryani, kabab, tandoor** |

### B. Owner / Employer Details

| Field | Value |
|---|---|
| Name of Employer | **HN Hotels Private Limited** |
| Type of Organisation | **Private Limited Company** |
| CIN | **U55101KA2023PTC182051** |
| Date of Incorporation | **11/12/2023** |
| Registered Office | **#22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore – 560051** |
| PAN | **AAHCH1024M** |
| GSTIN | (lookup from `05_HN_Hotels_GSTIN.pdf`) |

### C. Authorised Signatory

| Field | Value |
|---|---|
| Name | **Abdul Khader Nihaf** |
| Designation | **Managing Director** |
| DIN | **08387440** |
| PAN (personal) | **BEQPN1435R** |
| Aadhaar | (from Aadhaar card) |
| Mobile | (your mobile) |
| Email | **nihafwork@gmail.com** |
| DOB | **03/05/1996** |
| Father's Name | **Haneef Kasargod Mohammed** |

### D. Date of Commencement

| Field | Value |
|---|---|
| Date of commencement | (use earliest date — likely 2024; if unsure, FSSAI license issue date is a safe proxy) |
| Date crossed 10 employees | (owner to recall; conservatively 3-6 months before today) |

### E. Working Hours

| Field | Value |
|---|---|
| Working Hours | **8:00 AM to 8:00 PM** |
| Rest Interval | **1:00 PM to 2:00 PM (by rotation)** |
| Total daily hours | **11 hours** |
| Total weekly hours | **48 hours** |
| Weekly Off | **By rotation, 1 day per week** |
| Working days per week | **6** |
| Holidays | **9 paid holidays per year** |

### F. Employees

| Field | Value |
|---|---|
| Total Employees | **16** |
| Male | **16** |
| Female | **0** |
| Children below 14 | **0** |
| Adolescents 14-18 | **0** |

If portal asks for employee list with names: pull from `01_RESTRUCTURE_WORKSHEET.csv` (rows where Brand=HE).

### G. Bank Details

| Field | Value |
|---|---|
| Bank Name | **HDFC Bank** |
| Branch | **Bannerghatta Road** |
| Account Number | (from `08_BR_MD_Appointment.pdf` or HDFC mobile app) |
| IFSC | (from cancelled cheque) |
| Cancelled Cheque | upload from KYC pack |

### H. Documents to Upload

| Asked For | File |
|---|---|
| Certificate of Incorporation | `02_Certificate_of_Incorporation.pdf` |
| Company PAN | `01_HN_Hotels_Company_PAN.pdf` |
| GSTIN | `05_HN_Hotels_GSTIN.pdf` |
| Director Aadhaar | `10_Director_Nihaf_Aadhaar.pdf` |
| Director PAN | `09_Director_Nihaf_Personal_PAN.jpg` |
| Director Photo | `13_Director_Nihaf_Photo.jpg` |
| Address proof — rent agreement | (collect — name as `14_HE_Rent_Agreement.pdf`) |
| Utility bill — electricity | (collect — name as `15_HE_Electricity_Bill.pdf`) |
| Establishment photo | (phone photo — name as `16_HE_Signboard.jpg`) |
| HE FSSAI license | (find from Drive — name as `17_HE_FSSAI.pdf`) |
| Cancelled cheque | (collect — name as `18_HDFC_Cancelled_Cheque.pdf`) |
| Board Resolution | `08_BR_MD_Appointment.pdf` |
| MoA | `03_MoA_INC-33.pdf` |
| AoA | `04_AoA_INC-34.pdf` |

---

## Section 3 — Fee Payment

Karnataka S&E fee structure (2024-25, verify current on portal):

| Employee count | Fee (5-year validity) |
|---|---|
| 0-9 | ₹600 |
| 10-19 | ₹3,000 |
| 20-49 | ₹6,000 |
| 50-99 | ₹10,000 |

For HE at 16 employees: expect **₹3,000**.

Pay via Razorpay / HDFC card / UPI.

---

## Section 4 — Submit + Acknowledge

After submit:
1. Application number generated — save it
2. Provisional acknowledgement PDF auto-downloads — save as `19_HE_SE_Application_Receipt.pdf`
3. Labour Department may schedule inspection visit within 7-15 days
4. Registration Certificate issued after inspection

---

## Section 5 — Common Rejection Reasons

- **Address mismatch with FSSAI** — match exact address text
- **PAN-name mismatch** — company name must EXACTLY match PAN database ("HN HOTELS PRIVATE LIMITED")
- **Director KYC mismatch** — Aadhaar name must match PAN name
- **Photo too dark/blurry** — re-take signboard in good light
- **Rent agreement expired** — must be valid on registration date

---

## Section 6 — After Certificate Received

The RC contains a **Karnataka Shops Act Registration Number**. Save it — used in:
- ESI registration (asks if you have S&E)
- Inspector visits
- Annual returns (Form B/H/F)
- Aggregator onboarding (Zomato Eatsure, Swiggy ONDC)

Display RC at outlet entrance.

---

## Common Errors and Fixes

| Error | Fix |
|---|---|
| "Aadhaar OTP failed" | Mobile not linked; Seva Kendra OR eKarmika physical office |
| "GSTIN not found" | Wait 5 min, retry — GST validation rate-limited |
| "PAN-CIN mismatch" | Re-check, usually typo; reload and restart |
| "Address proof rejected" | Try different doc — rent vs property tax vs electricity |
| "Photo too large" | Compress to <2MB |
| "Session expired" | Save as draft, resume from dashboard |
