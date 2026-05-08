# SOP — Termination for Poor Performance / Inefficiency

**Trigger:** An employee is consistently underperforming and you want to remove them, but there's no misconduct (no theft, no insubordination, no policy violation).

**Hard truth:** You cannot fire instantly for performance. Karnataka Shops Act Section 39 requires "reasonable cause" + 30-day notice. Performance-based termination requires documentary proof + improvement opportunity.

**Realistic timeline:** 60-90 days from start of process to exit.

**Cost — IMPORTANT correction:** Performance termination falls within "retrenchment" under Section 2(oo) of the Industrial Disputes Act 1947 — it is "termination for any reason whatsoever other than misconduct." For employees with **240+ days of continuous service**, this triggers Section 25F:
- 30 days notice OR 30 days wages-in-lieu
- **PLUS retrenchment compensation: 15 days' average wage × completed years of service**

For an Anthony-tenure employee (~1.5 yrs at ₹17,433): roughly ₹17,433 notice + ₹26,150 retrenchment comp = **~₹43,500 total exit cost**.

**Two ways to reduce this cost:**
1. **Convert to misconduct route** if Service Rules define repeated unmet PIP benchmarks as "habitual neglect of duty" (which they do — see Section 4 of Service Rules). Run domestic enquiry. No Sec 25F compensation. But cost of enquiry (~₹15-40K) and risk if procedurally botched.
2. **Probation termination** if employee is in their first 6 months. No 25F. Just 15 days notice or wages.

For confirmed employees past 240 days: Sec 25F compensation is unavoidable on the simpliciter route.

---

## Procedure

### Phase 1: Identify and Document (Day 0-7)

**Collect specific, measurable evidence of underperformance:**

- For Cleaner: shift cleanliness checklist, customer complaints, photo evidence of areas not cleaned
- For Cashier: cash variance log, customer wait time, transaction errors, refund frequency
- For Cook: ticket time delays, dish-quality complaints, food cost overruns
- For Kitchen Helper: prep delay, hygiene violations, raw material wastage

**Format:** A spreadsheet (or printable log) showing:
- Date
- Specific failure observed
- Observable measure (time / count / amount)
- Impact on operation
- Witness (other employee / manager / customer)

This document is the foundation. Without it, performance termination won't survive scrutiny.

### Phase 2: Verbal Counselling (Day 7)

- Sit with employee in private
- State specific failures (not "you're bad" — say "on Tuesday you took 25 minutes for a chai order; standard is 5 minutes")
- Set expected standard for next 14 days
- Note in employee's file: "Verbal counselling delivered on [date], witnessed by [Manager X]"
- Have employee sign the counselling note (or mark "refused to sign, witnessed by Y")

### Phase 3: Written Warning #1 (Day 21, if no improvement)

- Issue **first written warning** on letterhead
- Specifies:
  - Verbal counselling delivered on [date]
  - Continued failures (cite the log entries)
  - Expected standards
  - 14-day improvement period
  - Consequence: PIP if no improvement
- Get signed receipt
- File copy in employee's record

### Phase 4: Written Warning #2 + PIP (Day 35)

- Issue **second written warning** with **Performance Improvement Plan (PIP)**:
  - 30-day duration
  - Specific KPIs they must meet (e.g., "Zero customer complaints, daily checklist signed off, attendance 30/30")
  - Daily check-ins with their manager
  - Weekly review meetings
  - Failure consequence: termination per Service Rules Section 6
- During PIP:
  - Reassign to less critical tasks if possible
  - Provide training / mentoring
  - Document daily / weekly progress
  - Note any continued failures

### Phase 5: PIP Review (Day 65)

- Formal PIP review meeting
- KPI achievement assessed against the plan
- If passed → PIP closed, employee continues
- If failed → proceed to termination

### Phase 6: Termination Notice (Day 65)

If PIP failed, issue **Termination Letter**:

```
HN HOTELS PRIVATE LIMITED
[Letterhead]

Date: __________

To: [Employee Name]
[Role, Establishment]

Subject: Termination of Services

Dear [Name],

This is with reference to:
1. Verbal counselling delivered on [date]
2. Written warning dated [date]
3. Performance Improvement Plan dated [date]
4. PIP review on [date], findings: failure to meet stated KPIs

Despite the support provided through the PIP, the required performance standards
have not been achieved. The Company has therefore decided to terminate your
employment with effect from __________ (30 days from this notice) under Section 3
and Section 6 of the Service Rules dated [signing date], read with Section 39 of
the Karnataka Shops & Commercial Establishments Act 1961.

You may, at your option:
(a) Serve the 30-day notice period, OR
(b) Receive 30 days' wages in lieu of notice and exit on [Day 65 + 1].

All earned dues will be paid as per Final Settlement Statement to be issued
separately. ESI and EPF settlements will be processed via the respective portals.

We thank you for your service and wish you well in your future endeavours.

Regards,

Abdul Khader Nihaf
Managing Director
HN Hotels Private Limited
DIN: 08387440
```

### Phase 7: Final Settlement (Day 95 if notice served, Day 66 if wages in lieu)

- Earned base wages up to last day
- Leave encashment
- Pro-rated statutory bonus (if applicable)
- 30-day wages in lieu (if employee chose option (b))
- Retention Bonus pro-rated up to last day if conditions met
- ESI / EPF settlement via portal

Pay within 7 days of last working day.

### Phase 8: Closure

- CAMS biometric inactive
- Odoo `hr.employee` archived with reason "Termination — performance"
- File complete bundle:
  - Performance log (the spreadsheet)
  - Verbal counselling note
  - Written warnings (×2)
  - PIP document
  - PIP review minutes
  - Termination letter (signed receipt)
  - F&F statement

---

## The shortcut: Mutual Separation Agreement

If the employee senses the writing on the wall during PIP, you can offer:

- Voluntary resignation by employee
- Company offers: 1 month's wage as goodwill payment
- Employee signs: Resignation letter + Waiver / Settlement Agreement
- No termination on record (better for employee's future job search)
- No retrenchment / Form Q (cleaner for company)
- Net cost is roughly the same (1 month wages either way)

This is preferable when both parties want a graceful exit. Document carefully — the Settlement Agreement should explicitly waive any future claims.

---

## What you cannot do (and why)

| Tempting shortcut | Why it fails |
|---|---|
| Reduce wage to push employee to quit | Section 9A ID Act violation. Court reverses. |
| Make life difficult — bad shifts, no breaks | Constructive dismissal claim. Employee can sue claiming you forced their exit. |
| Fire on the spot citing "loss to business" | Inability to perform is not misconduct. Section 39 requires due process. |
| Skip PIP, go directly to termination notice | Court will rule "no opportunity to improve" — reinstatement order. |
| Use a single warning then terminate | Procedural fairness fails. Need warning escalation. |

---

## Cost of doing this right vs wrong

**Right way:**
- 60-90 days of underperformance (you continue to absorb the loss)
- Documentation effort (~1 hour/week for the manager)
- 30 days wages at exit (₹18,000-30,000 typical)
- **Total: 60-90 days of opportunity cost + 1 month exit pay**

**Wrong way (firing on the spot):**
- Same 60-90 days of underperformance before you noticed
- Labour court case (1-3 years)
- Reinstatement order with back wages (potentially ₹3-6 lakh)
- Reputation hit if it goes to local social media
- **Total: 12-36 months of legal cost + 6-12 months back wages + reputation**

**The legal-safe path is also the cheaper path.**
