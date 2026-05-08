# ESI Registration — Step-by-Step Walkthrough

**Portal:** [https://esic.gov.in](https://esic.gov.in) → "Employer" → "Sign Up"
**Or:** [https://www.esic.in](https://www.esic.in) → e-Pehchan portal
**Time required:** ~30 minutes per establishment + processing wait
**Cost:** ZERO (no registration fee under ESI Act)

---

## Two registrations needed

We need **TWO separate ESI Code Numbers** because HE and NCH operate from different physical premises:

| Establishment | Address | Headcount | ESI applicability |
|---|---|---|---|
| **Hamza Express (HE)** | #19, HKP Road, Shivajinagar, Bangalore 560051 | 16 | Required (10+ threshold crossed) |
| **Nawabi Chai House (NCH)** | Shivajinagar (separate premises) | 12 | Required (10+ threshold crossed) |
| **HQ (HN Hotels)** | #22, 3rd Floor, HKP Road | 4 | NOT required (under 10 threshold) |

Both registrations will be under the same employer entity: **HN Hotels Private Limited (CIN U55101KA2023PTC182051)**.

---

## Documents to keep ready before starting

### Company-level (same for both registrations)
- [ ] Certificate of Incorporation of HN Hotels Pvt Ltd
- [ ] Company PAN: AAHCH1024M
- [ ] Company TAN: BLRH15862A
- [ ] GST Certificate (if any)
- [ ] Memorandum and Articles of Association (MoA, AoA)
- [ ] Cancelled cheque of company bank account (HDFC main)
- [ ] Director's PAN — Abdul Khader Nihaf
- [ ] Director's Aadhaar — Abdul Khader Nihaf

### Establishment-level (one set per registration)
- [ ] Address proof of premises:
  - Rent agreement OR ownership document
  - Latest electricity bill / property tax receipt
- [ ] FSSAI License copy (different per establishment)
- [ ] Karnataka S&E Registration certificate (after we obtain — can register ESI without it but will need to upload later)
- [ ] List of employees with date of joining, designation, gross wage, Aadhaar, DOB
- [ ] Photograph of premises signboard (proof of operation)

### Employee-level (for each ESI-zone employee being enrolled)
- [ ] Aadhaar card (front + back)
- [ ] Bank account number + IFSC (can be added later)
- [ ] Photograph (passport size — can use existing CAMS bio photo if good)
- [ ] Family member details: spouse name, spouse DOB, children names + DOBs (for dependant coverage)

---

## Phase 1 — Employer Registration (per establishment)

### Step 1: Create employer account
1. Go to [https://www.esic.in](https://www.esic.in)
2. Click **"Sign Up"** → **"New Employer Registration"**
3. Provide:
   - Name of unit: **Hamza Express** (or Nawabi Chai House)
   - Type: Private Limited Company
   - Mobile: 9945470320 (or your number)
   - Email: nihafwork@gmail.com
4. OTP verification → set password
5. You receive a **temporary login**

### Step 2: Fill Form 1 (Employer's Registration Form)
1. Login → Dashboard → "Form 1"
2. **Employer details:**
   - Name: HN Hotels Private Limited
   - PAN: AAHCH1024M
   - CIN: U55101KA2023PTC182051
   - Date of incorporation: 11-Dec-2023
   - Nature: Restaurant / Eating House
3. **Establishment details:**
   - Establishment name: Hamza Express (or NCH)
   - Address: [exact premises address]
   - District: Bengaluru Urban
   - State: Karnataka
   - Pincode: 560051
4. **Date of commencement of operations:** Date when this establishment first crossed 10 employees
5. **Date of applicability of ESI Act:** Same as above OR earliest signed contract — whichever is later
6. **Nature of business:** Service > Hotels & Restaurants
7. **Number of employees** drawing wages ≤ ₹21,000: For HE = 7 (if including Laden/Yahabu pre-bump) or 5 (post-bump). For NCH = 9.
8. **Bank details:** Company HDFC account
9. **Authorised signatory:** Abdul Khader Nihaf, MD

### Step 3: Upload documents
Upload all the documents from "Establishment-level" checklist above. PDF format, each <2MB.

### Step 4: Submit
- Receive **17-digit ESI Code Number** typically within 24-48 hours (often instant)
- This is your establishment's permanent ESI ID
- Note it down — you'll use it for monthly challan generation

**Repeat the entire Phase 1 for the second establishment.** You'll end up with two distinct ESI Code Numbers — one for HE, one for NCH.

---

## Phase 2 — Add Insured Persons (employees)

For each of the 14 ESI-zone employees:

### Step 1: Login to employer portal with new ESI Code
- Establishment: Hamza Express (use HE code) → for the 5 HE ESI-zone employees
- Establishment: NCH (use NCH code) → for the 9 NCH ESI-zone employees

### Step 2: Add IP (Insured Person)
1. Dashboard → "Insured Person" → "Add New"
2. Provide for each employee:
   - Aadhaar (auto-fetches name, DOB, address, photo)
   - Date of joining
   - Wage details: monthly gross, basic, HRA, etc. (use values from `01_RESTRUCTURE_WORKSHEET.csv`)
   - Bank account (optional — can skip for now)
   - Family/Nominee details
3. System generates:
   - **IP Number** (10-digit) — like an Aadhaar for ESI
   - **e-Pehchan Card** (downloadable PDF) → print and give to employee

### Step 3: Family registration (optional but recommended)
For each insured person, add:
- Spouse: name, DOB, Aadhaar
- Children (up to 2): name, DOB, Aadhaar
- Parents (if dependent): name, DOB, relationship

This enables FREE medical coverage for the entire family at any ESIC dispensary/hospital.

### Step 4: Print e-Pehchan
- Each employee gets a printed plastic-quality card with their IP number + photo
- They carry this to ESIC hospital/dispensary for free treatment
- Hand it over to them when you have the conversation about CTC restructure — major morale lift

---

## Phase 3 — Monthly Compliance (recurring forever)

### Each month (by 15th of following month):

1. **Generate challan** on ESIC portal:
   - Login → "Challan" → "Generate"
   - System auto-calculates: 4% of total ESI-zone gross (3.25% employer + 0.75% employee)
   - For our setup: ~₹9,810/month total (₹7,969 employer + ₹1,841 employee)
2. **Pay challan** via net banking (HDFC supported)
3. **Upload monthly return** showing wage of each IP, hours worked, days present
4. **Reconcile** — system shows paid challans, dues, any mismatches

### Automation possibility (later):
- Add `/api/hr-admin?action=esi-challan-prep` endpoint
- Runs on 1st of each month
- Pulls payroll data from Odoo
- Generates the monthly contribution sheet
- WhatsApp the file to CFO Naveen for upload + payment

---

## Common rejection reasons and how to avoid them

| Rejection | Fix |
|---|---|
| "Employee count <10" | Confirm establishment headcount in Form 1 — must be ≥10 to register |
| "Address mismatch with FSSAI" | Use the EXACT same address that's on the FSSAI license |
| "PAN-name mismatch" | The company name in Form 1 must match exactly with PAN database — use "HN HOTELS PRIVATE LIMITED" |
| "Authorised signatory KYC" | Director's Aadhaar + PAN must match name spelling |
| "Bank verification fail" | Use cancelled cheque from the same account that's used in CIN filings |

---

## What changes after registration

### Display requirements (must post at each outlet):
- ESI Code Number on a notice board near entrance
- ESI Form ESI-37 (abstract of the Act in vernacular language)
- Notice of nearest ESIC dispensary

### Payslip changes:
- Add line: "Employee ESI Contribution @ 0.75%: ₹___"
- Add line: "Employer ESI Contribution @ 3.25%: ₹___ (paid by company)"
- Show net payable

### Records to maintain:
- ESI register (Form 6) — auto-generated by ESIC portal
- Challan copies — keep PDF + paper for 7 years
- IP-wise wage and contribution register

---

## When you can stop ESI for an employee

- Employee leaves → mark "Date of Exit" in IP profile within 7 days. Stops contribution from next month.
- Employee crosses ₹21,000 wage threshold → cannot remove mid-contribution-period (April-Sep or Oct-March). Continue till end of period, then exclude.
- Establishment headcount drops below 10 → ESI registration once made does NOT auto-revoke. Continue compliance.

---

## Realistic timeline

| Day | Activity |
|---|---|
| Day 1 (today) | Collect missing Aadhaar from 5 ESI-zone staff |
| Day 2 | Sit down for CTC restructure conversations (8-10 employees) |
| Day 3 | Finish remaining CTC conversations + collect signed Form 11 from all |
| Day 4 | Register HE on ESIC portal (Form 1) |
| Day 5 | Register NCH on ESIC portal (Form 1) |
| Day 6-7 | ESI Code Numbers received → add 14 IPs across both codes |
| Day 8 | Print and distribute e-Pehchan cards to staff |
| Day 9 | Visit Senior Labour Inspector with everything for compounding |
| Day 30 | First monthly challan generation + payment by 15th of next month |

---

## After registration — the conversation closes

Once you have:
- ESI Code Number for HE
- ESI Code Number for NCH
- 14 IP numbers + e-Pehchan cards
- Signed contract amendments + Form 11s

→ The labour inspector visit becomes a 15-minute walk-in. You hand over: the two ESI registration certificates, the file of Form 11s, the file of contract amendments, the new wage register (Form IV), and the attendance register print from CAMS.

He will likely compound the 7 violations for ~₹10K-25K total. Pay. Receipt. Done.
