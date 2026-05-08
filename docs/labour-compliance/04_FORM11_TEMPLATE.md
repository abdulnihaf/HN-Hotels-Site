# Form 11 — EPF Declaration of Excluded Employee

**Use:** All 32 employees sign this. It's the legal declaration that protects HN Hotels from EPF coverage if any establishment crosses the 20-employee threshold in future.

**Why everyone signs:** Even ESI-zone employees (whose basic is ₹15,001 in the new structure) qualify as "excluded employees" under EPF Para 26A. Signing Form 11 is the formal record.

---

## Statutory format (Form 11 — revised)

This form is prescribed under the Employees' Provident Funds Scheme, 1952. The official PDF is downloadable from [epfindia.gov.in](https://www.epfindia.gov.in/site_en/) — search "Form 11 Composite Declaration."

### Reproduce on a printed sheet for each employee

```
EMPLOYEES' PROVIDENT FUND ORGANISATION
FORM 11 (NEW)
Composite Declaration Form
[Para 34 & 57 of EPF Scheme, 1952; Para 24 of EPS, 1995]

PART A — Employee Details
1. Name of Employee:           _________________________________
2. Father's / Husband's Name:  _________________________________
3. Date of Birth (DD/MM/YYYY): _________________________________
4. Gender:                     [ ] Male  [ ] Female  [ ] Other
5. Marital Status:             [ ] Married  [ ] Unmarried
6. Mobile Number:              _________________________________
7. Email ID:                   _________________________________
8. Aadhaar Number:             _________________________________
9. PAN Number:                 _________________________________
10. Bank Account Number:       _________________________________
11. IFSC Code:                 _________________________________

PART B — Previous Employment (if any)
12. Were you a member of EPF Scheme earlier?       [ ] Yes  [ ] No
13. Were you a member of EPS Scheme earlier?       [ ] Yes  [ ] No
14. If Yes — Previous UAN:                         _____________
15. Previous PF Member ID:                         _____________
16. Date of Exit from previous employment:         _____________
17. Have you withdrawn full PF accumulations?      [ ] Yes  [ ] No

PART C — Declaration of Exclusion (Para 26A)
18. Monthly Pay (Basic + DA): ₹ _______________________________
19. I hereby declare that my monthly pay (Basic + DA) at the time of
    joining HN Hotels Pvt Ltd is more than ₹15,000/-
    [ ] I am a member of EPF and wish to continue
    [ ] I am NOT a member of EPF and do NOT wish to be enrolled (Excluded)

PART D — Declaration & Signature
I certify that the above information is true to the best of my
knowledge. I authorise the Company to make adjustments to my salary
as per the declarations above.

Date:           ___________________
Place:          Bangalore
Employee Signature:  ___________________

Verified by Employer:
Name of Employer:    HN Hotels Private Limited
Establishment Code:  ________________ (after ESIC/EPFO registration)
Employer Signature:  ___________________
Date:                ___________________
Company Seal:
```

---

## Pre-filled batch — generate with this script

For efficient handling of 32 employees, run this from `/ops/hr` once Aadhaar gaps are filled:

```javascript
// Pseudo-code — to add to hr-admin.js as new action
if (action === 'form11-batch') {
  const employees = await db.prepare(
    'SELECT * FROM hr_employees WHERE is_active=1'
  ).all();
  // For each employee, render the Form 11 PDF with their data pre-filled
  // Save to their Drive folder
  // Return list of generated PDF URLs
}
```

For now, manual fill is fine — 32 forms × 2 minutes each = ~1 hour total.

---

## Filing rules

- **One Form 11 per employee** — even if they're already excluded by basic > ₹15K
- **Item 19 — tick "NOT a member, Excluded"** for everyone unless they explicitly ask to opt in to EPF
- **Don't backdate** — date is when the form is actually signed
- **Bank details required** — needed only if employee has prior EPF UAN. Otherwise leave blank.
- **Witness not required** for Form 11 (unlike contract amendment)

---

## What to do with signed forms

1. Photograph the signed form on phone
2. Upload to employee's existing Drive folder (use `drive_folder_id` from D1)
3. Keep physical original in "Compliance 2026" file at HQ
4. Once EPFO registration happens (only if/when an establishment crosses 20), upload Form 11s to EPFO portal as proof of exclusion

**You do NOT need to register with EPFO today.** Both establishments are under 20. Form 11 is collected proactively for future-proofing.

---

## Key legal point

A signed Form 11 with declared basic wage > ₹15,000 is your **complete legal defense** against any future EPF coverage demand for that employee. Section 16(1)(b) of the EPF Scheme + Para 26A together create a clean exclusion.

If an EPFO inspector ever audits you and asks why employee X is not enrolled, you produce:
1. Their salary slip showing basic > ₹15,000
2. Their signed Form 11 dated at joining
3. Their employment contract (Template A or C above)

That's it. End of audit.
