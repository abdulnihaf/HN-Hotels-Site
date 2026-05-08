# Five Parallel Chat Prompts — Government Registrations

**Purpose:** Five focused Claude Code chats, each driving a different registration via Chrome MCP. Designed to run in parallel where browser cookies allow, sequential where conflicts arise.

**Pre-conditions met:**
- ✅ KYC pack complete at `~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/` (19 files + Employee_Aadhaars subfolder)
- ✅ HDFC details available: Account 50200118314680, IFSC HDFC0000514
- ✅ HE BESCOM electricity account 7613053027
- ⚠️ Still pending: rent agreements, electricity bill PDFs, 2 employee Aadhaars, NCH exact street address

**Browser separation:** Each chat needs its own Chrome browser/profile to keep cookies isolated. Suggested split:
- Chat 1, 2 → Chrome (sequential, same login)
- Chat 3, 4 → Safari (sequential, same ESIC login)
- Chat 5 → Brave or Firefox (separate)

---

## CHAT 1 — Karnataka S&E Registration: Hamza Express

```
Co-pilot mode for Karnataka Shops & Commercial Establishments Act registration — Hamza Express.

Read first:
/Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/goofy-visvesvaraya-ec8f7b/docs/labour-compliance/14_SE_HE_CHEATSHEET.md

Documents in: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/

Memory: project_labour_compliance_2026.md, user_nihaf_profile.md.

Drive Chrome MCP. Open eKarmika (ekarmika.karnataka.gov.in) or fall back to Sevasindhu (sevasindhu.karnataka.gov.in → search "Karnataka Shops and Commercial Establishments").

Process:
1. Read the cheatsheet end to end
2. Login as new employer (Aadhaar OTP — pause for me)
3. Fill Form A for Hamza Express using cheatsheet field values
4. Upload all 14 listed documents from KYC pack
5. Pause for me at: Aadhaar OTP, payment (~₹3,000)
6. Capture Application Number after submit
7. Save provisional acknowledgement PDF as ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/19_HE_SE_Application_Receipt.pdf
8. Report HE S&E application number in this chat when complete

If portal asks for HE rent agreement or electricity bill (still pending physical collection), use FSSAI license `17_HE_FSSAI.pdf` as combined address proof — restaurants commonly do this in Karnataka.
```

---

## CHAT 2 — Karnataka S&E Registration: Nawabi Chai House

```
Co-pilot mode for Karnataka Shops & Commercial Establishments Act registration — Nawabi Chai House.

Read first:
/Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/goofy-visvesvaraya-ec8f7b/docs/labour-compliance/15_SE_NCH_CHEATSHEET.md

Documents in: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/

Memory: project_labour_compliance_2026.md.

Drive Chrome MCP. Open eKarmika (ekarmika.karnataka.gov.in). Owner is already logged in if Chat 1 ran first; same session works.

⚠️ Important: Confirm with me the EXACT NCH street address (door number + street + pincode) before filling Form A. The cheatsheet has placeholder; I will type it during the chat.

Process:
1. Read the cheatsheet end to end
2. From eKarmika dashboard, click "New Application" or "Add Establishment"
3. Fill Form A for Nawabi Chai House
   - Date of commencement: 03/02/2026 (NCH launched 3 Feb 2026)
   - Total employees: 12, all male
4. Upload all 14 listed documents from KYC pack
5. Pause for me at: Aadhaar OTP if re-required, payment (~₹3,000)
6. Capture NCH Application Number
7. Save acknowledgement as 24_NCH_SE_Application_Receipt.pdf in KYC pack
8. Report NCH S&E application number when complete

For address proof use NCH FSSAI license `23_NCH_FSSAI.pdf` + signboard `22_NCH_Signboard.jpg` if rent agreement not yet available.
```

---

## CHAT 3 — ESIC Employer Registration: Hamza Express + Add 5 IPs

```
Co-pilot mode for ESIC Employer Registration under Employees' State Insurance Act 1948 — Hamza Express.

Read first:
/Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/goofy-visvesvaraya-ec8f7b/docs/labour-compliance/16_ESIC_HE_CHEATSHEET.md

Documents in: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/
Employee Aadhaars: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/Employee_Aadhaars/
IP enrollment data: ~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/HN_ESIC_IP_Bulk_Upload.csv

Memory: project_labour_compliance_2026.md, feedback_labour_law_constraints.md.

Drive Chrome MCP. Open ESIC portal (www.esic.in → Sign Up → New Employer Registration).

Process Phase 1 — Employer Registration:
1. Read the cheatsheet
2. New Employer Registration → fill Form 01 for Hamza Express
3. Upload all listed documents from KYC pack including HE FSSAI, signboard, cancelled cheque, all director docs
4. Pause for OTP to my mobile
5. Submit. Capture 17-digit ESI Code Number — save it in this chat
6. Save certificate PDF to KYC pack as 25_HE_ESIC_Certificate.pdf

Process Phase 2 — Add 5 Insured Persons:
After ESI Code received, login to HE establishment and add 5 IPs from the bulk upload CSV (HE rows):
- Anthoni Dhan (Anthony, PIN 38, Aadhaar 7887 4918 0777)
- Faizan Hussain (PIN 4, Aadhaar 4375 8772 3617)
- Faisal Ali (PIN 8) — Aadhaar in Employee_Aadhaars/Faisal_Ali_HE_PIN8_Aadhaar.pdf — extract via OCR or ask me to read aloud
- Hardev Prasad Singh (PIN 3, Aadhaar 9155 7398 1328)
- Dhiraj Kumar (PIN 36, Aadhaar 6510 8443 0755)

For each, enter wage components (Basic ₹15,001, HRA ₹1,216, Other ₹1,216, Gross ₹17,433), date of joining, and family details (collect from me during signing).

Generate e-Pehchan card PDF for each IP — download and save in KYC pack as 26_HE_IP_*.pdf.

Report HE ESI Code + 5 IP numbers in this chat when complete.
```

---

## CHAT 4 — ESIC Employer Registration: Nawabi Chai House + Add 9 IPs

```
Co-pilot mode for ESIC Employer Registration — Nawabi Chai House.

Read first:
/Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/goofy-visvesvaraya-ec8f7b/docs/labour-compliance/17_ESIC_NCH_CHEATSHEET.md

Documents in: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/
Employee Aadhaars: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/Employee_Aadhaars/
IP enrollment data: ~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/HN_ESIC_IP_Bulk_Upload.csv

Memory: project_labour_compliance_2026.md.

Drive Chrome MCP. ESIC portal (www.esic.in). Owner logged in if Chat 3 ran first; click "Add Establishment" or "New Form 01 — Different Unit".

⚠️ Important: Confirm NCH exact street address before filling Form 01.

Process Phase 1 — Employer Registration:
1. Read the cheatsheet
2. Form 01 for Nawabi Chai House
   - Commencement: 03/02/2026
   - Total employees: 12 (9 covered, 3 excluded)
3. Upload NCH-specific docs: FSSAI (23_NCH_FSSAI.pdf), signboard (22_NCH_Signboard.jpg), plus all director and company docs
4. Pause for OTP
5. Submit. Capture 17-digit NCH ESI Code (different from HE)
6. Save certificate as 27_NCH_ESIC_Certificate.pdf

Process Phase 2 — Add 9 Insured Persons:
After NCH ESI Code, switch to NCH establishment in dashboard, add 9 IPs:

| PIN | Name | Aadhaar | DOB | Phone |
|---|---|---|---|---|
| 14 | Md Kesmat Sk | 3244 9506 9098 | 12/04/1998 | 8637895699 |
| 25 | B Aadil Ahmed | 7449 7545 0245 | 24/08/1992 | 9994885263 |
| 29 | Md Aktar | 4606 2896 3828 | 07/07/1998 | 8787894755 |
| 24 | Sabir Ahmed | (extract from Employee_Aadhaars/Sabir_Ahmed_NCH_PIN24_Aadhaar.pdf) | (from same) | 9100533428 |
| 26 | MD Reyaj Ali | 🔴 NOT YET COLLECTED | 🔴 | 7870510936 |
| 27 | Dhananjai Singh | 4600 8988 6106 | 05/09/1994 | 8874730537 |
| 33 | Noim Uddin | 3567 3085 8131 | 02/04/2006 | 8729813746 |
| 30 | MD Maqbool | (extract from Employee_Aadhaars/MD_Maqbool_NCH_PIN30_Aadhaar.pdf) | (from same) | 9366412521 |
| 34 | Ameer Khan | 🔴 NOT YET COLLECTED | 🔴 | 7005607097 |

For 7 of the 9, add IP immediately. For MD Reyaj Ali and Ameer Khan, skip during this session and add later when their Aadhaars are collected.

Wage components per IP: Basic ₹15,001, HRA ~₹1,200-1,700, Other ~₹1,200-1,700, Gross ₹17,433-18,402.

Generate e-Pehchan PDFs for each enrolled IP, save as 28_NCH_IP_*.pdf in KYC pack.

Report NCH ESI Code + 7 IP numbers + 2 pending in this chat.
```

---

## CHAT 5 — Karnataka Labour Welfare Fund + Professional Tax Registration

```
Co-pilot mode for Karnataka Labour Welfare Fund (LWF) and Professional Tax (PT) employer registrations.

Memory: project_labour_compliance_2026.md.

Documents in: ~/Desktop/HN_Leegality_KYC_Pack_2026-05-07/

Drive Chrome MCP. Two small portals to complete in sequence.

═══════════════════════════════════════════════════
PART 1 — Karnataka Labour Welfare Fund
═══════════════════════════════════════════════════

Portal: https://kklwf.karnataka.gov.in
Service: Employer Registration under Karnataka Labour Welfare Fund Act 1965
Estimated time: 15 min
Fee: ₹0 registration; ₹40 employer + ₹20 employee per half-year per worker

Field values:
- Employer: HN HOTELS PRIVATE LIMITED
- CIN: U55101KA2023PTC182051
- PAN: AAHCH1024M
- GSTIN: (from 05_HN_Hotels_GSTIN.pdf)
- Address: #22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore 560051
- Type: Commercial Establishment / Restaurant
- Total Employees: 32 (16 HE + 12 NCH + 4 HQ)
- Authorised Signatory: Abdul Khader Nihaf, MD, DIN 08387440
- Mobile / Email: (your mobile / nihafwork@gmail.com)
- Bank: HDFC, Account 50200118314680, IFSC HDFC0000514

Documents to upload: CoI, Company PAN, GSTIN, Director Aadhaar+PAN, Cancelled Cheque, Address Proof (FSSAI works).

After submit:
- Receive LWF Registration Number
- First contribution due: as on 31 December (₹40 employer + ₹20 employee per worker; total ~₹2,400/yr for 32 staff, of which ₹1,920 employer and ₹480 employee)
- Save certificate as 29_LWF_Certificate.pdf in KYC pack

═══════════════════════════════════════════════════
PART 2 — Karnataka Professional Tax (Employer Registration)
═══════════════════════════════════════════════════

Portal: https://pt.kar.nic.in
Service: Employer Registration under Karnataka Tax on Professions, Trades, Callings and Employments Act 1976
Estimated time: 30 min
Fee: ₹2,500/year as employer + monthly deductions per employee slab

Karnataka PT slabs (employees):
- Salary ≤ ₹15,000/month: ₹0 PT
- ₹15,001 – ₹20,000: ₹150/month
- ≥ ₹20,001: ₹200/month

For HN Hotels:
- 14 ESI-zone employees (₹17,433-18,402): ₹150/month each = ₹2,100/month total
- 17 above-ceiling (₹20,000+): ₹200/month each = ₹3,400/month total
- Combined PT collection from employees: ~₹5,500/month
- Employer's own PT: ₹2,500/year

Field values:
- Same employer details as LWF above
- Employees: 32 with wage breakdown by slab
- Authorised Signatory: same

Documents: CoI, PAN, GST, Aadhaar, cancelled cheque, address proof.

After submit:
- Receive Professional Tax Registration Certificate (PTRC) number
- Receive Professional Tax Enrolment Certificate (PTEC) number for the company
- Save both as 30_PT_Certificate.pdf in KYC pack
- Set monthly remittance reminder for CFO Naveen

═══════════════════════════════════════════════════

Pause for me at:
- Aadhaar OTPs
- Payment (~₹2,500 PT employer fee)
- Final submit

Report LWF Registration Number + PT PTRC/PTEC numbers in this chat when complete.
```

---

## Cost Summary — All 5 Registrations

| Registration | Setup fee | Recurring |
|---|---|---|
| S&E HE | ₹3,000 (5-year validity) | ₹3,000 / 5 yrs |
| S&E NCH | ₹3,000 (5-year validity) | ₹3,000 / 5 yrs |
| ESIC HE | ₹0 | 3.25% × wages × 5 IPs |
| ESIC NCH | ₹0 | 3.25% × wages × 9 IPs |
| LWF | ₹0 | ₹2,400/yr (₹1,920 employer share) |
| PT | ₹2,500 | ₹2,500/yr employer + ₹150-200/employee/month deducted from wages |
| **Setup total** | **₹8,500** | — |

---

## Decision Tree — Which Order to Run

| Scenario | Run order |
|---|---|
| **All docs collected, max parallel** | Chat 1 + Chat 3 simultaneously; Chat 2 + Chat 4 simultaneously after first batch; Chat 5 last |
| **Limited bandwidth, sequential** | 1 → 2 → 3 → 4 → 5 over 2-3 days |
| **Some docs missing (2 Aadhaars + electricity bills)** | Run 1, 2, 5 today (no missing items); run 3, 4 after collecting remaining items |
| **Only S&E urgent for inspector visit** | Run 1, 2 today; queue 3, 4, 5 for after inspector visit |

---

## After All 5 Chats Complete

Come back to a parent chat (this one or new) and say:

```
All 5 registrations complete:
- S&E HE: [number]
- S&E NCH: [number]
- ESIC HE: [17-digit code], 5 IPs added
- ESIC NCH: [17-digit code], 9 IPs added (or 7 if 2 Aadhaars pending)
- LWF: [number]
- PT PTRC: [number], PT PTEC: [number]

Next: schedule Senior Labour Inspector visit for compounding.
```

I'll then:
- Update memory with all registration numbers
- Generate the compounding visit packet
- Update the statutory ESI notice with actual ESI Code numbers
- Build the monthly compliance reminder for Naveen
