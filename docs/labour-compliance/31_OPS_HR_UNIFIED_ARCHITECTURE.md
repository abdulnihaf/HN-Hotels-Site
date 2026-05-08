# /ops/hr — Unified Architecture (Post-Compliance)

**Status:** Planning. Implementation phased. Replaces ad-hoc tabs with a clean, automated, AI-assisted, comms-driven architecture.

**Operating principle:** Technology owns data integrity end-to-end. Owner approves big decisions; manager confirms via WhatsApp button taps; cron drives state forward; AI handles classification and pattern detection; UI is read-mostly with explicit override controls.

---

## Part 1 — Current State (As-Built)

### Existing tabs in `/ops/hr/index.html` (1,725 lines)

| Tab | Purpose | API endpoints | Issues |
|---|---|---|---|
| **Roster** | List 32 employees, filter by brand, edit via modal, archive | `?action=employees`, `?action=employee-upsert`, `?action=employee-archive` | No contract status; no compliance state; no costing; no compliance health |
| **Attendance** | Daily punch view, settlement, digest | `?action=attendance-daily`, `?action=settlement`, `?action=digest`, `?action=pull-attendance` | Manual digest send; no anomaly detection; ghost punches not flagged |
| **Deductions** | Monthly compute from attendance + leave | `?action=deductions`, `?action=compute-deductions` | Doesn't roll up to costing view; no statutory breakdown |
| **CAMS** | Device management (list users, audit, reboot) | `?action=cams-pull-users`, `?action=cams-audit`, `?action=cams-remote` | Manual ghost detection; no auto-onboarding flow |
| **Sync** | Odoo sync orchestration | `?action=pull-maps`, `?action=sync-all-employees` | Manual triggers; no scheduled sync |
| **Messaging** | Send WhatsApp messages | `/api/messaging?action=*` | Manual sends; no templates per HR scenario |

### What's NOT in /ops/hr today

| Missing | Owner currently does manually |
|---|---|
| Contract status tracking | Outside system (Drive folders) |
| Leegality eSign state | External dashboard |
| Service Rules acknowledgement state | Paper file at HQ |
| ESIC/EPF enrollment state | Spreadsheet / Odoo |
| Per-employee compliance health score | Mental model |
| Total CTC + statutory breakdown | Excel sheet rebuilt monthly |
| Forecast wage burden | Not calculated |
| Probation timer per employee | Not tracked |
| F&F workflow + deadline tracking | Manual whatsapp + bank transfer |
| Absence escalation | Owner watches Roster manually |
| Ghost PIN detection | Manual CAMS audit |
| Renewal countdowns (S&E, FSSAI, etc.) | Not tracked |

---

## Part 2 — Unified Architecture (Target State)

### Tab structure (replaces current 6 tabs with 8 logically-grouped tabs)

```
┌──────────────────────────────────────────────────────────────────────┐
│ /ops/hr                                                                │
│ ├── 1. Dashboard       ← landing, single-pane health view             │
│ ├── 2. Roster          ← employee list with full state badges        │
│ ├── 3. Attendance      ← punch + leave + settlement (existing)        │
│ ├── 4. Costing         ← per-employee + aggregate burden, forecasting │
│ ├── 5. Compliance      ← contracts, Service Rules, ESIC, statutory   │
│ ├── 6. Alerts          ← absence/ghost/Leegality pending + history   │
│ ├── 7. Onboard / Exit  ← new hire wizard + F&F workflow              │
│ └── 8. Ops             ← CAMS, Sync, Reports (admin tools)           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Part 3 — Per-Tab Design

### Tab 1 — Dashboard (NEW, landing page)

**Purpose:** Owner opens /ops/hr, sees today's full picture in 30 seconds.

```
┌────────────────────────────────────────────────────────────────┐
│ HN HOTELS — HR Dashboard                            [⟳]        │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Workforce: 28 active   ↗ +2 this month   Cost: ₹6.8L / month   │
│                                                                  │
│ ┌─ Today (08-May-2026) ──────────────────────────────┐         │
│ │ Punched: 24 / 28 expected                            │         │
│ │ Absent: 3 (Aktar 8d, Maqbool 8d, Aadil 16d ⚠️)      │         │
│ │ On approved leave: 1                                 │         │
│ │ Ghost PINs detected today: 0                         │         │
│ └──────────────────────────────────────────────────────┘         │
│                                                                  │
│ ┌─ Pending Action ─────────────────────────────────────┐         │
│ │ ⏳ 3 absence alerts awaiting Basheer response       │         │
│ │ ⏳ 5 contracts pending Leegality eSign              │         │
│ │ ⏳ 2 employees missing Aadhaar (blocking ESIC)      │         │
│ │ ⚠️  Aadil 16d streak — escalate to Owner today       │         │
│ │ [View Alerts] [View Compliance]                      │         │
│ └──────────────────────────────────────────────────────┘         │
│                                                                  │
│ ┌─ Compliance Health ───────────────────────────────┐          │
│ │ Contracts signed:    23 / 28  (82%)               │          │
│ │ ESIC enrolled:       0 / 14    (pending)           │          │
│ │ EPF excluded sign:   18 / 28  (Form 11 collected) │          │
│ │ WABA opted-in:       19 / 28  (68%)               │          │
│ │ Bank/UPI configured: 28 / 28  (✓ 100%)            │          │
│ └──────────────────────────────────────────────────────┘          │
│                                                                  │
│ ┌─ Renewals & Deadlines ────────────────────────────┐          │
│ │ S&E Registration HE: NOT YET (apply by 13-May)   │          │
│ │ S&E Registration NCH: NOT YET (apply by 13-May)  │          │
│ │ ESIC monthly challan: due 15-Jun-2026             │          │
│ │ HE FSSAI renewal: 18 months                       │          │
│ │ Compounding visit: pending                        │          │
│ └──────────────────────────────────────────────────────┘          │
│                                                                  │
│ ┌─ Recent Activity (last 24h) ──────────────────────┐          │
│ │ • Anthony marked "On Leave" by Basheer (11:14)   │          │
│ │ • PIN 47 onboarded as Vikram (Cleaner, NCH)      │          │
│ │ • Daily digest sent to Owner (10pm)               │          │
│ └──────────────────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────────────┘
```

**Data sources:** All other tabs roll up here. Auto-refreshes every 60s when tab is active.

**AI elements:**
- "Aadil 16d streak ⚠️" — anomaly detection promotes from warning to escalation
- "Apply by 13-May" — deadline calculated from operational start dates
- "+2 this month" trend — derived from join dates

---

### Tab 2 — Roster (enhanced from current)

**Per-employee row** (replaces current minimal view):

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Md Kesmat Sk    [NCH]  [Monthly]                              ⏳ Active │
│ #1 · PIN 14 · Cashier                                                    │
│ 📎 Aadhar  📎 PAN  📎 Photo  📄 Contract Signed ✓  📩 WABA opt-in ✓   │
│ 🎯 ESIC enrolled ⏳ pending  💰 ₹19K/mo  ☎ 8637895699                  │
│                                                                            │
│ Last punch: today 09:32 IST · This month: 26 days · Avg shift: 9.4 hrs    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Filter / sort options:**
- Brand: HE / NCH / HQ / All
- Pay type: Monthly / Contract / All
- Compliance status: Fully compliant / Pending contract / Pending ESIC / Pending Aadhaar
- Activity: Punching today / Absent N+ days / Probation
- Sort: Name / Last punch / Days absent / Salary high-to-low

**Bulk actions:**
- Send Leegality contract to selected
- Send WABA opt-in to selected
- Send daily reminder to selected
- Export CSV
- Generate barcodes batch

**Per-row actions (right-click / hover):**
- Edit details
- View attendance history
- View contract PDF
- View costing
- Send WABA message
- Mark on leave
- Archive (with F&F trigger)

---

### Tab 3 — Attendance (existing, refined)

**Keep current functionality** + add:
- **Anomaly highlighter:** ghost punches (login but <2hrs) flagged in red
- **Leave overlay:** approved leaves shown alongside absences
- **Auto-pull cron:** every 5 min during shift hours (8 AM-8 PM IST)
- **Trends:** 7-day and 30-day attendance pattern per employee
- **Break compliance:** auto-flags if rest interval <1 hour (Section 14 KSE)

---

### Tab 4 — Costing (NEW, comprehensive)

**Per-employee monthly cost breakdown:**

```
┌─ MD Kesmat (NCH Cashier) — May 2026 ──────────────────────────┐
│                                                                  │
│ EARNINGS COMPONENT          PAID       NOT PAID    OWED          │
│ Monthly Base (85%)         ₹15,640         —          —          │
│ Quarterly Retention        (accrual ₹2,762/mo)        —          │
│ Overtime / NH compensation     —           —          —          │
│ ────────────────────────                                          │
│ Wage subtotal              ₹18,402                               │
│                                                                  │
│ EMPLOYER STATUTORY COST                                          │
│ Employer ESI 3.25%             —    (employee absorbs via pass-thru)│
│ Employer EPF 12%               —    (Excluded — basic > ₹15K)    │
│ Gratuity provision (4.81%)  ₹722    accounting only              │
│ PT employer share          ₹208                                  │
│ LWF employer share          ₹7                                   │
│ ────────────────────────                                          │
│ Statutory subtotal         ₹937                                  │
│                                                                  │
│ DEDUCTIONS FROM EMPLOYEE                                         │
│ Employee ESI 0.75%         ₹138                                  │
│ Employee EPF 12%             —    (excluded)                     │
│ PT employee share          ₹150                                  │
│ LWF employee share          ₹3                                   │
│ Loss of pay (LOP days)       —                                   │
│ Advance recovery             —                                   │
│ ────────────────────────                                          │
│ Net deductions             ₹291                                  │
│                                                                  │
│ NET TAKE-HOME              ₹18,111                               │
│ TOTAL COMPANY COST         ₹19,339                               │
│ (Base + employer share + provisions)                             │
└──────────────────────────────────────────────────────────────────┘
```

**Aggregate views:**

| View | What it shows |
|---|---|
| **By brand** | HE wages: ₹3.2L, NCH: ₹2.4L, HQ: ₹1.1L |
| **By pay type** | Monthly: ₹4.8L, Contract: ₹1.9L (with daily-rate variability) |
| **Statutory burden** | Total ESI ₹X, EPF ₹0, PT ₹X, LWF ₹X, Gratuity provision ₹X |
| **Variable vs fixed** | Fixed (Monthly base): ₹4.8L, Variable (Retention + Contract days): ₹2.0L |
| **Forecast** | Next 3 months projected based on planned hires + attrition |
| **YoY trend** | Month-over-month change |

**Export:**
- Monthly Odoo journal entry (P&L line items by GL account)
- Employee payslip PDFs (one per employee)
- ESI challan worksheet (auto-fills ESIC portal data)
- PT remittance worksheet

**Cron:**
- 1st of month: auto-compute all employee costs based on attendance
- 7th of month: auto-generate payslips
- 15th of month: auto-prepare ESI/EPF challans

---

### Tab 5 — Compliance (NEW, comprehensive)

**Per-employee compliance card:**

```
┌─ Md Kesmat Sk — Compliance Status ─────────────────────────────┐
│                                                                  │
│ IDENTITY                                                         │
│ ✓ Aadhaar           3244 9506 9098                              │
│ ✓ DOB               12-Apr-1998                                 │
│ ✓ PAN               not collected (not required for this wage)  │
│ ✓ Bank account      HDFC ****4680 (verified)                    │
│ ✓ Phone (Aadhaar)   8637895699 ← used for WABA + Aadhaar OTP    │
│                                                                  │
│ EMPLOYMENT CONTRACT                                              │
│ ✓ Letter signed     08-May-2026 via Leegality                   │
│ ✓ Service Rules     Acknowledged                                │
│ ✓ Form 11 EPF       Filed (Excluded Employee, Para 26A)         │
│ ✓ Witness           Faisal Ali (PIN 8)                          │
│ ⏳ Probation         N/A — completed > 6 months service           │
│                                                                  │
│ STATUTORY ENROLLMENT                                             │
│ ⏳ ESIC IP           Pending (awaiting employer code)             │
│ — EPF              Excluded (basic > ₹15,001)                   │
│ ⏳ LWF               Pending (employer registration in progress)  │
│ ⏳ PT slab           ₹150/month (₹15K-25K bracket)                │
│                                                                  │
│ COMMUNICATION                                                    │
│ ✓ WABA opt-in      Yes (consented 02-May-2026)                  │
│ — DLT SMS          Pending BSNL approval                        │
│ — Voice (Exotel)   Available, not yet used                      │
│                                                                  │
│ DOCUMENTS IN DRIVE                                               │
│ ✓ Aadhaar card     Drive: 1NVYXi…                               │
│ ✓ Signed contract  Drive: ____ (after Leegality)                │
│ ✓ Bio photo        CAMS                                         │
│                                                                  │
│ COMPLIANCE SCORE: 85% (8/9 mandatory)                            │
└──────────────────────────────────────────────────────────────────┘
```

**Aggregate compliance dashboard:**

| Metric | Value | Action |
|---|---|---|
| Fully compliant | 18 / 28 (64%) | List view |
| Missing Aadhaar | 4 | Auto-WABA reminder to employee |
| Contract not signed | 5 | Auto-resend Leegality |
| ESIC IP not enrolled | 14 | Block: needs ESIC employer code first |
| WABA not opted-in | 9 | Auto-send opt-in template |

**Statutory health (separate view):**

| Item | Status | Next deadline |
|---|---|---|
| Karnataka S&E (HE) | NOT REGISTERED | Apply ASAP |
| Karnataka S&E (NCH) | NOT REGISTERED | Apply ASAP |
| ESIC employer (HE) | NOT REGISTERED | Apply after S&E |
| ESIC employer (NCH) | NOT REGISTERED | Apply after S&E |
| EPFO (deferred) | Not triggered (under 20/establishment) | Watchlist |
| LWF Karnataka | NOT REGISTERED | ₹2,400/yr — folded into compounding |
| Professional Tax | NOT REGISTERED | Apply parallel |
| FSSAI HE | Valid | Renewal in 18 months |
| FSSAI NCH | Valid | Renewal in 18 months |
| Compounding visit | Pending | After all S&E + ESIC done |
| Form Q (Karnataka) | Not needed yet | — |
| MCA annual filing | On schedule | Done by Naveen |

**Cron:**
- Daily: check renewal countdowns
- Weekly: alert on items <30 days from deadline
- Monthly: compliance score recalculation

---

### Tab 6 — Alerts (NEW)

**Active alerts list** (from `hr_absence_alerts` + `hr_ghost_pins` + `comms_outbox` joined):

```
┌─ Active Alerts (3) ────────────────────────────────────────────┐
│                                                                  │
│ ⏳ Anthony — Absence (2 days)                                   │
│    Brand: HE · PIN 38 · Last: 06-May                            │
│    📱 WABA sent 11:00 → READ at 11:14                            │
│    Awaiting Basheer response. Auto-fallback to SMS at 17:00.    │
│    [Send SMS now] [Call Exotel] [Mark resolved]                 │
│                                                                  │
│ ⏳ PIN 47 — Ghost Onboarding                                    │
│    11 punches in 7 days · Last: 08-May                          │
│    📱 WABA sent 08:00 → DELIVERED                                │
│    📩 SMS sent 14:00 → DELIVERED                                  │
│    Awaiting Basheer onboarding form submission.                 │
│    [Resend WABA] [Call Exotel] [Dismiss as unauthorized]        │
│                                                                  │
│ ⚠ Aadil — 16-day absence (ESCALATED)                            │
│    Brand: NCH · PIN 25 · Last: 22-Apr                           │
│    📱 WABA sent twice → IGNORED                                   │
│    📩 SMS sent → IGNORED                                          │
│    ☎ Voice call attempted → no answer                            │
│    Escalated to Owner 06-May.                                   │
│    [Mark left job] [F&F trigger] [Manual call]                  │
└──────────────────────────────────────────────────────────────────┘

┌─ Resolved Today (5) ───────────────────────────────────────────┐
│ ✓ Sabir Ahmed — On Leave (responded in 12 min via WABA)        │
│ ✓ MD Reyaj    — Aadhaar collected via mini-UI                   │
│ ✓ Faisal Ali  — Contract signed via Leegality                   │
│ ✓ Mujib       — Now punching (bio policy update)                │
│ ✓ Moin        — Now punching (bio policy update)                │
└──────────────────────────────────────────────────────────────────┘
```

**Tabs within Alerts:**
- Active (pending response)
- Resolved (last 30 days, searchable)
- Escalated (manual owner attention required)
- Channel health (SLA tracking, response rates)

**AI elements:**
- Auto-rank alerts by urgency
- Suggest action: "Aadil 16d streak — historical pattern matches departure (90%)"
- Group similar alerts: "3 employees absent same day — possible holiday?"

---

### Tab 7 — Onboard / Exit (NEW)

**Two sub-tabs in one place** because they're symmetric workflows.

#### Onboarding wizard

```
┌─ Add New Employee ──────────────────────────────────────────────┐
│ Step 1 of 4: Identity                                            │
│                                                                  │
│ Source:  ⦿ Manual entry  ◯ From ghost PIN (47, 11, etc.)         │
│                                                                  │
│ Legal Name        [____________________]                         │
│ Known As          [____________________]                         │
│ Phone             [____________________]                         │
│ Aadhaar           [____________________] [verify via UIDAI]      │
│ DOB               [____________________]                         │
│                                                                  │
│ [Cancel] [Next →]                                                │
└──────────────────────────────────────────────────────────────────┘

Step 2: Role + Establishment
  Brand: [HE / NCH / HQ]
  Department: [auto-suggest from role]
  Job Title: [autocomplete]
  Date of Joining: [today]

Step 3: Compensation (auto-classifies template)
  Pay Type: [Monthly / Contract]
  IF Monthly: Monthly CTC [₹___]   → auto-classifies A/B/C
  IF Contract: Daily Rate [₹___]   → monthly equiv shown
  Probation: [☑ Apply 6-month default]

Step 4: Confirm & Trigger
  ✓ Will create employee record (PIN auto-assigned or use ghost PIN)
  ✓ Will create Drive folder
  ✓ Will generate contract PDF (Template A/B/C)
  ✓ Will upload to Drive
  ✓ Will send via Leegality eSign
  ✓ Will send WABA opt-in template
  ✓ Will mark for ESIC enrollment when employer registered
  
  [← Back] [Save & Trigger Everything]
```

**On submit, backend:**
1. INSERT INTO hr_employees
2. Create Drive folder via API
3. Generate contract via comms-orchestrator (uses templateA/B/C from generator)
4. Upload PDF to Drive
5. Trigger Leegality send via /api/leegality?action=send
6. Trigger WABA opt-in via /api/comms?action=optin-send
7. Update tracker
8. Show success page with timeline of all triggered actions

#### Exit workflow

```
┌─ Initiate Exit — Anthony (PIN 38) ─────────────────────────────┐
│                                                                  │
│ Reason:                                                          │
│   ⦿ Resigned (with notice)                                       │
│   ◯ Resigned (without notice — 15-day shortfall)                 │
│   ◯ Terminated for misconduct (chargesheet + enquiry done)       │
│   ◯ Terminated for performance (PIP failed)                      │
│   ◯ Retrenchment (cost reduction)                                │
│   ◯ Mutual separation                                            │
│                                                                  │
│ Last Working Day: [05-May-2026]                                  │
│                                                                  │
│ F&F CALCULATION (auto-computed):                                 │
│                                                                  │
│ Earned base wages (1-5 May):    ₹2,907                           │
│ Leave encashment (8 days):      ₹4,800                           │
│ Pro-rated quarterly retention:  ₹0  (forfeited — <15 day notice) │
│ Statutory bonus pro-rata:       ₹291                             │
│ Subtotal owed:                  ₹7,998                           │
│                                                                  │
│ Less:                                                            │
│ Liquidated damages (1 mo wage): ₹17,433  (notice violation)      │
│ Advance recovery:               ₹0                               │
│ Loss recovery:                  ₹0                               │
│ Subtotal deductions:            ₹17,433                          │
│                                                                  │
│ NET TO EMPLOYEE: ₹0  (owed wages absorbed against damages cap)   │
│ Note: Cannot recover beyond owed wages per PWA. Contract suit   │
│       optional for the ₹9,435 shortfall.                        │
│                                                                  │
│ Karnataka Code on Wages 2-day deadline: 07-May-2026 (today + 2d) │
│                                                                  │
│ [Cancel] [Generate F&F PDF] [Process Bank Transfer] [Archive]   │
└──────────────────────────────────────────────────────────────────┘
```

**Backend on "Archive":**
1. Mark hr_employees.is_active = 0 with archive_reason
2. Mark CAMS PIN inactive
3. Generate F&F statement PDF
4. Send F&F via WABA + DLT SMS to ex-employee phone
5. Initiate bank transfer (currently manual; future: API)
6. Update hr_absence_alerts to resolved if linked
7. Add to archive list (12-month retention)

**Auto-archive triggers (cron):**
- Manager confirms "Left job" via WABA → triggers exit workflow with default values
- 2-day F&F deadline countdown alerts owner if not processed

---

### Tab 8 — Ops (admin tools, existing CAMS/Sync/Reports merged)

**Sub-tabs:**
- **CAMS** — device management (existing)
- **Sync** — Odoo orchestration (existing)
- **Reports** — settlement, digest, audit, costing exports
- **Renewals** — countdown timers + apply links for S&E, FSSAI, etc.
- **Compliance Binder** — auto-indexed PDF list (signed contracts, certificates)

---

## Part 4 — Data Model (Complete)

### Existing tables (keep, augment)

| Table | Role | Augment with |
|---|---|---|
| `hr_employees` | Master roster | `contract_drive_id`, `contract_status`, `leegality_doc_id`, `track_attendance`, `compliance_score` |
| `hr_attendance_daily` | Daily computed attendance | (no change) |
| `hr_cams_punches` | Raw biometric | (no change) |
| `hr_leaves` | Approved leaves | (no change) |
| `hr_shift_rules` | Brand-level shift defaults | (no change) |
| `hr_managers` | Routing for WABA | (no change) |
| `comms_outbox` | All sends across all channels | use this as single audit log |
| `comms_optin` | WABA opt-in state | augment with `dlt_consent`, `voice_consent` |

### New tables (added by automation work)

| Table | Role | Source migration |
|---|---|---|
| `hr_absence_alerts` | Track 2+ day absence inquiries | `schema-hr-automation.sql` |
| `hr_ghost_pins` | Track CAMS PINs not in roster | `schema-hr-automation.sql` |

### New tables to add (from this spec)

```sql
-- Per-employee monthly cost snapshot (computed on 1st of month, cached)
CREATE TABLE hr_monthly_cost (
  employee_id INTEGER,
  month TEXT,                          -- '2026-05'
  wage_paid INTEGER,                   -- monthly base + retention paid in this month
  retention_accrued INTEGER,            -- portion of quarterly retention accruing this month
  employer_esi INTEGER,
  employer_epf INTEGER,
  gratuity_provision INTEGER,
  pt_employer INTEGER,
  lwf_employer INTEGER,
  total_company_cost INTEGER,
  net_take_home INTEGER,
  bonus_provision INTEGER,
  computed_at TEXT,
  PRIMARY KEY (employee_id, month)
);

-- Statutory deadline tracker (S&E, FSSAI, ESIC challan, etc.)
CREATE TABLE hr_compliance_deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,                       -- 'se_registration' | 'fssai_renewal' | 'esic_challan' | 'pt_filing' | 'lwf_filing' | 'mca_filing'
  brand_label TEXT,                    -- HE / NCH / HQ / null=company-wide
  due_date TEXT,
  status TEXT,                         -- 'pending' | 'in_progress' | 'completed' | 'overdue'
  last_action_at TEXT,
  notes TEXT,
  link TEXT                            -- portal URL where action needed
);

-- F&F workflow tracker
CREATE TABLE hr_exits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER,
  reason TEXT,                         -- 'resigned_with_notice' | 'resigned_without_notice' | 'misconduct' | 'performance' | 'retrenchment' | 'mutual_separation'
  last_working_date TEXT,
  fnf_due_by TEXT,                     -- last_working + 2 days (Karnataka Code on Wages)
  earned_wages INTEGER,
  leave_encashment INTEGER,
  retention_paid INTEGER,
  retention_forfeited INTEGER,
  bonus_pro_rata INTEGER,
  liquidated_damages INTEGER,
  advance_recovery INTEGER,
  loss_recovery INTEGER,
  net_to_employee INTEGER,
  fnf_pdf_drive_id TEXT,
  bank_transfer_utr TEXT,
  bank_transferred_at TEXT,
  status TEXT,                         -- 'pending' | 'fnf_generated' | 'paid' | 'closed'
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- Probation tracker
CREATE TABLE hr_probation (
  employee_id INTEGER PRIMARY KEY,
  start_date TEXT,
  end_date TEXT,                       -- start + 6 months
  extension_count INTEGER DEFAULT 0,   -- max 1 extension allowed
  status TEXT,                         -- 'active' | 'confirmed' | 'extended' | 'failed'
  confirmation_date TEXT,
  reviewer_notes TEXT
);
```

---

## Part 5 — Automation Layer

### Cron triggers (Cloudflare Workers — unlimited per CF plan)

| Frequency | Action | What it does |
|---|---|---|
| Every 5 min during shift hours (8 AM-8 PM IST) | `cams-pull-punches` | Pull latest punches from CAMS device → `hr_cams_punches` |
| Every 8 hours | `cron-detect-absences` | Scan for 2+ day gaps, create `hr_absence_alerts`, send WABA |
| 8 AM IST daily | `cron-detect-ghosts` | Find CAMS PINs not in roster, send WABA to manager |
| 30 min during business hours | `runFallbackEscalation` | Drive multi-channel state machine forward (WABA → SMS → Voice) |
| 10 PM IST daily | `daily-summary` | Send digest to owner via WABA |
| 1st of month at 6 AM | `compute-monthly-cost` | Refresh all `hr_monthly_cost` rows |
| 7th of month | `generate-payslips` | Create per-employee PDF + email/WABA |
| 15th of month | `prepare-statutory-challans` | ESIC + PT + LWF worksheets |
| Daily 9 AM | `check-renewal-deadlines` | Alert owner on items <30 days |
| Daily 9 AM | `check-fnf-deadlines` | Alert if F&F not processed within 2 working days |
| Weekly Mon 9 AM | `compliance-score-refresh` | Recompute per-employee compliance score |
| Daily 11 PM | `archive-confirmed-departures` | Auto-archive employees confirmed left by manager |

### AI assists (LLM via existing Anthropic API)

| Feature | What it does | Trigger |
|---|---|---|
| Template classification | Maps wage + role to A/B/C template, suggests Daily/Monthly | New hire wizard |
| Role autocomplete | Suggests common roles based on brand + dept | Form input |
| Department auto-mapping | Maps free-text role to canonical department | Sync time |
| Anomaly detection | Flags unusual patterns (16d streak = likely departure) | Alert ranking |
| Pattern grouping | "3 employees absent same day = check holiday calendar" | Daily digest |
| Forecast | 3-month wage burden projection | Monthly costing view |
| F&F amount suggestion | Computes net dues with all 8 line items | Exit wizard |
| Liquidated damages calc | Suggests amount based on tenure + role | Exit wizard |
| Compliance score | Per-employee 0-100 score with explanation | Compliance tab |

### Comms triggers (via existing comms-hub `/api/comms?action=send`)

| Event | Channel sequence | Recipient |
|---|---|---|
| 2-day absence | WABA → SMS (6h) → Voice (6h) → Owner escalation (24h) | Manager (Basheer/Farooq) |
| Ghost PIN detected | WABA → SMS (24h) | Manager |
| New hire created | WABA opt-in → SMS fallback | New employee |
| Contract pending sign 24h | WABA reminder → SMS (24h) → Voice (48h) | Employee |
| F&F payment processed | DLT SMS with UTR | Ex-employee |
| Daily roster summary | WABA only | Owner |
| Compliance health weekly | WABA digest | Owner |
| Probation 14d before end | WABA reminder | Manager + Owner |
| Renewal 30d before deadline | WABA reminder | Owner |

---

## Part 6 — Implementation Phases

### Phase 1 (immediate, ~3 days)

- [ ] Apply D1 migrations (`schema-hr-automation.sql`, `schema-comms-channels.sql`, this spec's new tables)
- [ ] Deploy `hr-automation.js` to production
- [ ] Deploy cron worker
- [ ] Push UI Phase 1 changes (Contract badge already added)
- [ ] Configure manager phones in `hr_managers`
- [ ] Test absence detection cron
- [ ] Test ghost PIN flow with PINs 11, 42, 46

### Phase 2 (after Leegality account approved, ~1 week)

- [ ] Wire `ghostOnboardSubmit` → contract gen → Leegality send (auto-trigger from mini-UI submit)
- [ ] Build new Onboarding wizard UI
- [ ] Build Exit/F&F wizard UI
- [ ] Refactor `hr-automation.js` to use comms-hub `/api/comms?action=send` (replace direct provider calls)

### Phase 3 (after BSNL DLT + Exotel verified, ~2 weeks)

- [ ] Implement DLT SMS dispatcher in comms-orchestrator
- [ ] Implement Exotel voice dispatcher
- [ ] Build Alerts tab with multi-channel state visualization
- [ ] Owner manual override controls

### Phase 4 (~1 week)

- [ ] Build Costing tab — per-employee + aggregate views
- [ ] Build Dashboard tab — landing page
- [ ] Build Compliance tab — health scores + statutory deadlines
- [ ] Cron: monthly cost compute + payslip generation

### Phase 5 (polish, ongoing)

- [ ] AI integrations (template classification, anomaly detection, forecasting)
- [ ] Multilingual support (Hindi/Bengali for migrant workers)
- [ ] Mobile-first PWA polish
- [ ] Audit log + permission system
- [ ] Compliance binder auto-index

---

## Part 7 — File Manifest (After Full Build)

### Backend (`functions/api/`)

| File | Purpose |
|---|---|
| `hr-admin.js` | Existing — roster CRUD, attendance pull, settlement |
| `hr-automation.js` | Cron-driven absence/ghost detection, manager response handler |
| `hr-onboarding.js` | NEW — onboarding wizard, contract gen, Leegality trigger |
| `hr-exits.js` | NEW — F&F calculator, exit workflow, archive trigger |
| `hr-costing.js` | NEW — monthly cost compute, payslip gen, statutory worksheets |
| `hr-compliance.js` | NEW — per-employee score, statutory deadline tracker |
| `comms.js` | Existing — single comms hub (WABA/SMS/Voice) |
| `comms-webhook.js` | Existing — inbound webhook (Meta + Exotel + future SMS DLR) |
| `_lib/comms-orchestrator.js` | NEW (built today) — channel selection + fallback |
| `_lib/contract-generator.js` | NEW — port docx-js generator to Worker context |

### Frontend (`/ops/hr/`)

| File | Purpose |
|---|---|
| `index.html` | Single-page app with 8 tabs |
| `js/dashboard.js` | Tab 1 logic |
| `js/roster.js` | Tab 2 logic (existing, refactored) |
| `js/attendance.js` | Tab 3 logic (existing) |
| `js/costing.js` | NEW — Tab 4 logic |
| `js/compliance.js` | NEW — Tab 5 logic |
| `js/alerts.js` | NEW — Tab 6 logic |
| `js/onboard-exit.js` | NEW — Tab 7 logic |
| `js/ops-tools.js` | Tab 8 logic (existing CAMS/Sync) |

### Workers (`workers/`)

| Worker | Purpose |
|---|---|
| `hr-cron/` | NEW (built today) — cron scheduler triggers Pages endpoints |
| `cams-pull-cron/` | Future — direct CAMS device polling every 5 min |

### D1 schemas (`schema-*.sql`)

All migrations applied via wrangler.

---

## Part 8 — Owner's Daily Routine (Target State)

After full build:

**Morning (5 min):**
- Open /ops/hr → Dashboard tab
- Glance at workforce health, pending alerts
- Tap any escalations → resolve via /ops/hr modal or WABA

**Throughout day:**
- WABA buttons resolve absence inquiries (Basheer responds)
- Cron processes everything else
- No active intervention needed

**Evening (1 min):**
- Daily summary lands in WABA at 10 PM
- Glance, no action unless escalation flagged

**Monthly (15 min):**
- Tab 4 Costing → review wage burden, approve monthly P&L journal
- Tab 5 Compliance → check renewal countdowns, file statutory returns

**Quarterly (30 min):**
- Pay quarterly retention bonuses
- Review compliance score trends
- Sit with Naveen for MCA filings

**Annually (~2 hours):**
- Bonus declaration + payment
- Performance review cycle
- Renewal of S&E, FSSAI

That's it. Owner role transforms from "data maintainer" to "approver of exceptions."

---

## Part 9 — What This Replaces

| Manual today | Automated tomorrow |
|---|---|
| Owner checks roster for absences | Cron detects + WABA to manager |
| Owner adds new employee in 5 manual steps | One wizard form → 8 auto-actions |
| Owner manually generates contract | Auto-generated from template + employee data |
| Owner manually sends to Leegality | Auto-triggered on employee creation |
| Owner manually computes monthly cost in Excel | hr_monthly_cost table refreshed by cron |
| Owner manually tracks F&F deadlines | Cron alerts at deadline, calculates amount |
| Owner manually decides which channel to use | Orchestrator routes WABA → SMS → Voice |
| Owner manually maintains compliance binder | Auto-indexed from D1 + Drive folder IDs |

**Time saved for owner: ~2 hours/week reclaimed for actual business decisions.**

---

## Part 10 — Costing Reality (Updated with All Workarounds)

For 28 active employees in May 2026:

| Component | Monthly Total | Annual |
|---|---|---|
| Monthly Base wages (85% of CTC) | ₹4,89,000 | ₹58.7L |
| Quarterly Retention (15% accrued) | ₹86,000 | ₹10.3L |
| Daily wage Contract (variable) | ₹1,12,000 | ₹13.4L |
| HQ salaries | ₹1,10,000 | ₹13.2L |
| **Total wages** | **₹7,97,000** | **₹95.6L** |
| Employer ESI (post pass-through) | ₹0 | ₹0 |
| Employer EPF (Excluded) | ₹0 | ₹0 |
| Gratuity provision (4.81% of basic, accounting only) | ₹15,000 | ₹1.8L |
| PT employer share | ₹208 | ₹2,500 |
| LWF employer share | ₹107 | ₹1,280 |
| Bonus provision (8.33% of cap, applicable employees) | ₹6,500 | ₹78K |
| **Total statutory cost** | **₹21,815** | **₹2.6L** |
| **TOTAL COMPANY COST** | **₹8,18,815** | **₹98.3L** |

**Note:** Statutory cost is mostly accounting provisions (gratuity provision is non-cash). Real cash outflow above wages: ~₹8K/month (PT + LWF + occasional bonus payouts).

The Costing tab will surface this monthly with full per-employee drilldown.

---

## Part 11 — Key Design Decisions

**Decision 1: Single comms hub, not per-domain**
- Use `/api/comms?action=send` for everything
- Don't reimplement WABA/Exotel in `hr-automation.js`
- Refactor in Phase 2

**Decision 2: D1 as single source of truth**
- All state in D1 (no shadow stores in Drive metadata)
- Drive holds files; D1 holds references + state
- Odoo is downstream sync (one-way: D1 → Odoo)

**Decision 3: Cron-driven, not poll-driven**
- Browser doesn't poll for updates
- Cron updates D1; UI refreshes on tab change
- Eliminates "is this current?" confusion

**Decision 4: Manager as confirmation layer, not data entry layer**
- Manager taps WABA buttons (not fills forms)
- Mini-UI exists only for ghost PIN onboarding (one-off form)
- Owner UI is read-mostly

**Decision 5: AI for decisions, not for data**
- LLM classifies wage → template (decision)
- LLM ranks alerts by urgency (decision)
- LLM does NOT generate documents (deterministic JS does)

**Decision 6: Phased rollout, not big-bang**
- Phase 1 ships in 3 days (covers absence detection + ghost detection)
- Each phase ships independently
- Minimum 80% functionality at Phase 3 end

---

## Closing — The Vision

After full build, /ops/hr is the **single pane** for:
- Roster integrity (auto-maintained)
- Compliance health (auto-tracked)
- Comms across 3 channels (auto-routed)
- Onboarding + exits (auto-triggered, auto-calculated)
- Costing (auto-computed monthly)
- Reporting (auto-generated)

Owner intervention required only for: hiring decisions, terminations involving misconduct, statutory disputes.

Manager (Basheer/Farooq) intervention only via WABA button taps — never opens /ops/hr.

Employees never see /ops/hr at all — they receive WABA messages and Leegality eSign requests.

This is the operational North Star.
