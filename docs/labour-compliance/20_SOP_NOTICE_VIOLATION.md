# SOP — Employee Resigns Without Serving Notice Period

**Trigger:** Employee announces departure, leaves abruptly, or stops reporting without serving the 30-day notice required by Service Rules Section 3.

**Hard rule:** You CANNOT withhold earned base wages. Payment of Wages Act 1936 makes this illegal regardless of contract.

**What you CAN do:** Forfeit Retention Bonus, deduct unreturned property, document for future reference checks.

---

## Procedure

### Day 0 — Discovery
- Confirm the employee's intent (verbal resignation, no-show, written resignation)
- Secure all company property they hold: cash float, keys, biometric removal, badges, uniform, equipment
- Take a photograph of the cash counter / inventory at handover (or last seen) for any reconciliation

### Day 1 — Document
- Issue **Acknowledgement of Resignation** letter:
  - "We acknowledge your resignation effective [date]"
  - "Notice period required is 30 days. You served _ days. Shortfall: _ days."
  - "Per Service Rules Section 3(f), the following consequences apply..."
  - List items being forfeited or deducted with statutory basis

### Day 2 — Reconcile
- Calculate Final Settlement (F&F):
  - **Owed by Company:** earned base wages up to last working day, leave encashment (per Karnataka Shops Act), proportionate statutory bonus if applicable
  - **Deductible (with notice):** unreturned company property at fair value, any cash short / inventory loss attributable to employee with proof, monetary advances unrecovered
  - **Forfeited:** Retention Bonus (per Service Rules 9), unearned variable pay
  - **Statutory:** ESI / EPF / PT carryforward — process via portal, do not withhold

### Day 3-5 — Communicate
- Issue **F&F Settlement Statement** to employee in writing
- Pay net amount within 2 working days of last working day (per Karnataka Code on Wages Rules 2024) (statutory deadline under Payment of Wages Act)
- Get written receipt or proof of bank transfer

### Day 7 — Close
- Mark CAMS biometric inactive
- Mark Odoo `hr.employee` as archived with reason
- Update D1 `hr_employees.is_active = 0`
- File the F&F documentation in the employee's Drive folder
- For ESIC: mark Date of Exit on the IP record (if previously enrolled)

### Day 30 — Reference protocol
- If contacted by another employer for reference: state factual information only (dates, role, reason for exit). Do not editorialize. Maintain a contemporaneous note of the reference call.

---

## What NOT to do

- ❌ Do NOT withhold the last month's earned wages
- ❌ Do NOT issue threatening letters demanding "30 days wages in lieu of notice" from employee
- ❌ Do NOT make negative public statements about the ex-employee
- ❌ Do NOT block their PF / ESI claim — process those separately and on time
- ❌ Do NOT refuse to issue a Relieving Letter (state factually: "Mr X served from D1 to D2 in capacity Y. Notice period was not served fully.")

---

## Forfeiture protection — what to do TODAY (preventive)

Build the Retention Bonus mechanism into your monthly payroll NOW so it has teeth when you need it later:

1. **Carve out** ~10% of every employee's monthly wage as a "Retention Bonus" payable quarterly.
   - Example: Anthony's ₹17,433 → ₹15,690 monthly + ₹1,743 retention bonus paid every 3 months.
   - Total cost is the same (₹17,433/month equivalent annualised).
   - But the ₹1,743 × 3 = ₹5,229 is forfeitable if they leave abruptly during that quarter.

2. **Document this in the Salary Letter** (it's already partly there in Service Rules Section 9).

3. **Pay the quarterly retention** only to those who served the entire quarter.

This converts a non-leverage situation (no notice violation recovery) into a real ₹5K disincentive per employee per quarter — without raising costs to the company at all.

---

## Quick-reference template letter

> ```
> HN HOTELS PRIVATE LIMITED
> [Letterhead]
>
> Date: __________
>
> To: [Employee Name]
> Establishment: [HE / NCH / HQ]
>
> Subject: Acknowledgement of Resignation and Final Settlement
>
> Dear [Name],
>
> We acknowledge your resignation effective [date]. Per Section 3 of the Service Rules
> & Code of Conduct dated [signing date], a 30-day notice was required. You served
> [N] days, leaving a shortfall of [30-N] days.
>
> Per Service Rules Section 3(f), the following Final Settlement applies:
>
> Owed to you:
>   Base wages [last cycle]:           ₹ ______
>   Leave encashment:                   ₹ ______
>   Pro-rated statutory bonus:          ₹ ______
>   Subtotal:                           ₹ ______
>
> Deductions (per Section 10, Payment of Wages Act 1936):
>   Unreturned uniform / equipment:     ₹ ______
>   Cash short / inventory loss:        ₹ ______ (proof attached)
>   Monetary advances outstanding:      ₹ ______
>   Subtotal:                           ₹ ______
>
> Forfeited (per Service Rules 9):
>   Unpaid Retention Bonus:             ₹ ______ (forfeited, not paid)
>
> Net payable to you:                   ₹ ______
>
> This will be transferred to your bank account [last 4 digits ____] within 7 working
> days. ESI and EPF settlements (where applicable) will be processed separately
> through the respective portals.
>
> Kindly return any company property still in your possession to avoid further
> deductions.
>
> Regards,
>
> Abdul Khader Nihaf
> Managing Director
> HN Hotels Private Limited
> DIN: 08387440
> ```
