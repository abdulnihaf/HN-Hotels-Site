# SOP — Termination for Misconduct (Fraud, Theft, Dishonesty)

**Trigger:** You have specific suspicion or evidence that an employee has committed an act of misconduct under Section 4 of the Service Rules.

**Goal:** Remove the employee with no notice obligation, recover the proven loss, preserve criminal options, withstand potential labour court challenge.

**The only path that holds up in court is procedural fairness. Skipping the enquiry loses the case even when guilt is obvious.**

---

## Procedure (Total: 8-12 days)

### Day 0 — Discovery & Evidence Lockdown

- **Preserve evidence within 4 hours of discovery:**
  - CCTV clips: download to local disk + Drive, with timestamps
  - Cash register tapes / POS logs
  - Inventory reconciliation reports
  - Witness statements (write down names + verbatim what they said)
  - Bank reconciliation if the loss touched accounts
- **Do NOT confront the employee yet** — they may destroy evidence
- **Do NOT post about it on WhatsApp groups or socially** — defamation risk if not proven
- Lock the employee out of any system access (POS, biometric, cash float reassignment)

### Day 1 — Charge-sheet

- Draft and serve a **written charge-sheet** to the employee. Get signed receipt or mark "refused to sign — witness Mr. _____."
- Include:
  - Specific act alleged (date, time, amount)
  - Service Rules section violated (Section 4(a) for theft, etc.)
  - Evidence summary (CCTV, witnesses, inventory)
  - 3-5 working day window for written response
  - **Suspension order** — pending enquiry, with subsistence allowance @ 50% of basic wage if suspension exceeds 30 days (cite Section 4 of Service Rules)
- Photograph the served charge-sheet

### Day 2-5 — Response Window

- Receive written explanation from employee (or note "no response received")
- If response disputes the facts → enquiry mandatory
- If response admits the act → enquiry still recommended (for documentation)
- If no response → proceed to enquiry on Day 6

### Day 6 — Domestic Enquiry

- **Enquiry Officer:** A neutral senior person — could be: CFO Naveen, Tanveer (GM), or external lawyer/HR consultant. Never the same person who discovered the fraud.
- **Setting:** Office room, formal. Schedule 2-3 hours.
- **Procedure:**
  - Read out charge-sheet and evidence
  - Mark documents as Exhibits (E1, E2, E3)
  - Examine company witnesses (you, manager, cashier)
  - Allow employee to cross-examine via their representative (employee can have a co-worker as defence representative — this is their right)
  - Allow employee to lead their own defence and witnesses
  - Record proceedings (write down or audio with consent)
- At end: declare enquiry closed, Enquiry Officer to deliver findings within 2 days

### Day 7-8 — Findings

- Enquiry Officer drafts a **Findings Report**:
  - Summary of charges
  - Summary of evidence presented
  - Summary of employee's defence
  - Findings on each charge (proved / not proved)
  - Recommendation
- Findings shared with the Managing Director

### Day 9 — Order of Dismissal

- MD reviews findings → if misconduct established:
  - Issues **Dismissal Order** in writing
  - Cites: misconduct established, Service Rules clause violated, statutory basis (Section 39 Karnataka Shops Act for misconduct exception)
  - **Explicitly invokes Section 4(6) of Payment of Gratuity Act 1972** to forfeit gratuity (where 5+ years service) — must quantify loss caused. Silence on gratuity = gratuity payable.
  - Effective date: usually same day
  - Final settlement details

### Alternative path: "Loss of Confidence" (use only when enquiry is impractical)

For employees in **positions of special trust** (cashier, accountant, key-holder, store-keeper), Karnataka HC has affirmed that termination on the ground of "loss of confidence" — without full enquiry — is permissible **provided**:

- Employee was in a position of trust as part of their substantive role
- Loss of confidence is based on **objective material on record** (CCTV, reconciliation, witness statements) — not subjective gut feel
- The Tribunal will independently test (under Sec 11A of ID Act) whether the loss was reasonably grounded

**When to use:** Cashier theft case where enquiry is being deliberately stalled by employee, or where employee has absconded after the act.

**When NOT to use:** First-line strategy when you have evidence — always run the enquiry. Loss of confidence is the backup path for botched enquiries, not a shortcut.

**Reference:** Karnataka HC ruling — Labour Court cannot reinstate "on grounds of sympathy" once theft by trust-position employee proved.

### Day 10 — Final Settlement (F&F)

Calculate:
- **Owed to employee:** earned base wages up to suspension date, full subsistence allowance during suspension, leave encashment
- **Deductible:** Provable loss attributable to misconduct (per Section 10 Payment of Wages Act — must show:
  - Cause of damage / loss
  - Employee's responsibility for it
  - Quantum of loss
  - Notice given to employee
- **Forfeited:** Retention Bonus, any conditional payment per Service Rules
- **NOT payable:** notice period wages (misconduct exception)
- **NOT payable:** retrenchment compensation (this isn't retrenchment)

Pay net amount within 7 days of dismissal (statutory). Do NOT delay this — even guilty employees must be paid earned wages.

### Day 11 — Criminal Action (Optional)

If theft / fraud amount is significant (say >₹10,000):
- File FIR at the local police station (Shivajinagar)
- Provide CCTV evidence + charge-sheet + dismissal order
- This is a separate civil/criminal route from the labour action — they don't conflict

### Day 12+ — Closure

- Mark CAMS biometric inactive
- Update Odoo `hr.employee` → archived with reason "Dismissed for misconduct on [date]"
- File case bundle in "Compliance 2026" binder:
  - Charge-sheet (served + signed receipt)
  - Employee's response
  - Enquiry minutes + exhibits
  - Findings report
  - Dismissal order
  - F&F statement
  - Police FIR (if filed)
  - All evidence (CCTV clips, photos)
- Retain for 7 years (in case of labour court challenge later)

---

## What you can deduct from F&F (legal basis)

Under Section 10 of Payment of Wages Act 1936, deduction for damage / loss is permitted if:

1. Loss occurred while employee was responsible
2. Loss directly attributable to neglect or default of the employee  
3. Maximum deduction = actual loss (no penalty multiplier)
4. Employee given written notice and chance to explain BEFORE deduction
5. Total deductions in any wage period ≤ 75% of wages payable

Examples:
- ✅ Cashier short by ₹2,000 confirmed by reconciliation → deduct ₹2,000
- ✅ Biryani inventory short by 3 kg, CCTV shows employee took it → deduct cost of 3 kg
- ✅ Uniform not returned → deduct fair value (~₹500)
- ❌ "Penalty for fraud" of ₹10,000 above actual loss → NOT permitted (Karnataka labour court will reverse)
- ❌ "30 days wages in lieu of notice" — NOT applicable for misconduct dismissal (you don't owe notice)

---

## Common mistakes that cost you the case

| Mistake | What goes wrong |
|---|---|
| Skipping enquiry, dismissing on the spot | Labour court reinstates with back wages, sometimes years later |
| Enquiry conducted by complainant himself | Bias — enquiry findings invalidated |
| No charge-sheet, just informal conversation | Court rules natural justice violated |
| Withholding earned base wages | Section 7 violation — separate prosecution risk |
| Posting about the fraud on WhatsApp / social | Defamation suit if guilt not formally proved |
| Filing FIR without CCTV / documentary evidence | Police register but case won't sustain; employee gets bail and counter-files for harassment |
| Punishment disproportionate to offence | "Habitual late = dismissal" might be reversed; 1st-time minor offence shouldn't trigger dismissal |

---

## Owner's standing checklist before invoking this SOP

Before you serve a charge-sheet, confirm you have:

- [ ] CCTV footage clearly identifying the employee at the act, with timestamp
- [ ] Quantum of loss documented (cash reconciliation OR inventory variance OR vendor invoice)
- [ ] At least one independent witness (other employee or customer)
- [ ] Documentary trail (POS logs, register entries, vendor confirmations)
- [ ] Service Rules signed by employee (Section 4 — defines misconduct)
- [ ] An Enquiry Officer identified (not yourself)

If 3+ of the above are missing — investigate further before serving charge-sheet. Premature charge-sheet that fails enquiry is worse than no charge-sheet.
