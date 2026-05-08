# HR Automation — Roster Integrity & Onboarding via WhatsApp

**Philosophy:** Technology owns data integrity; staff at outlet are operators, not data maintainers. Basheer (manager) confirms via WhatsApp button taps. Owner reviews on /ops/hr.

**Triggers operating model:**

```
   Cron (every 8 hours)
        │
        ├─► Detect absence patterns  ─► WABA "Is X on leave or left?" ─► Basheer button taps ─► /ops/hr auto-updates
        │
        └─► Detect ghost CAMS PINs    ─► WABA "Who is PIN N?" ─► Mini-UI for Basheer ─► onboarding fields ─► auto-contract via Leegality
```

---

## 1. Detection Logic (cron-triggered)

### 1.1 Absence Detection

**Rule:** Active employee (in /ops/hr `is_active=1`) hasn't punched in 2+ consecutive days where they were expected to work.

**Excluded from detection:**
- Pay type = Contract (until Mujib+Moin policy change in effect — toggle via `track_attendance` flag per employee)
- HQ employees (Nihaf, Naveen — don't punch by role)
- Already-flagged employees with pending alert response

**Frequency:** Every 8 hours (3am, 11am, 7pm IST). 8-hourly catches morning shift no-shows by 11am, evening absences by 7pm.

**Action:** Insert row into `hr_absence_alerts` + send WABA template to Basheer.

### 1.2 Ghost PIN Detection

**Rule:** A PIN punched on CAMS in last 7 days that does NOT exist in `hr_employees` table OR is `is_active=0`.

**Frequency:** Once daily (8am IST).

**Action:** Insert row into `hr_ghost_pins` + send WABA template to Basheer + Owner with link to onboarding mini-UI.

### 1.3 Roster Integrity Score (daily summary)

**Rule:** Compute % of expected employees who punched today. Below 80% → escalation alert.

**Frequency:** Once daily (10pm IST recap).

**Action:** Send daily WABA summary to Owner: "26 active, 22 punched today, 4 absent (X, Y, Z, W), 1 ghost PIN added."

---

## 2. WABA Template Definitions

These need to be registered in Meta Business Manager → Sparksol WABA → Message Templates. Templates pending approval (typically 24 hrs).

### Template A — `hr_absence_inquiry_v1`

```
Hi {{1}},

{{2}} ({{3}}, PIN {{4}}) hasn't punched in for {{5}} consecutive days.

Last day worked: {{6}}.

What's their status?

[On Leave]  [Sick]  [Left Job]  [Still Working - Bio Issue]

Thanks for keeping the roster updated.
— HN Hotels HR System
```

Variables:
1. Recipient name (Basheer)
2. Employee name
3. Role
4. PIN
5. Number of days absent
6. Last working date

Buttons (interactive template):
- "On Leave" → `hr-absence-respond?token=X&status=on_leave`
- "Sick" → `hr-absence-respond?token=X&status=sick`
- "Left Job" → `hr-absence-respond?token=X&status=left`
- "Still Working" → `hr-absence-respond?token=X&status=bio_issue`

### Template B — `hr_ghost_pin_inquiry_v1`

```
Hi {{1}},

A new biometric PIN {{2}} has been punching at the outlet but is NOT in our HR roster.

{{3}} punches detected over {{4}} days.

If this is a new employee, please complete onboarding here:
{{5}}

If this is someone unauthorized using the device, reply STOP.

— HN Hotels HR System
```

Variables:
1. Recipient name
2. Ghost PIN
3. Number of punches
4. Number of days
5. Mini-UI URL with token

### Template C — `hr_daily_summary_v1`

```
Roster summary for {{1}}:

Active: {{2}} | Punched today: {{3}} | Absent: {{4}}
{{5}}

Ghost PINs added: {{6}}
{{7}}

Tap to view: {{8}}

— HN Hotels HR System
```

Variables:
1. Today's date
2-7. Counts and names
8. /ops/hr URL

---

## 3. Database Schema

New tables (D1 migration `schema-hr-automation.sql`):

```sql
-- Absence alerts: one row per employee per absence event (deduped)
CREATE TABLE IF NOT EXISTS hr_absence_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  pin TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  days_absent INTEGER NOT NULL,
  last_working_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending | sent_to_basheer | responded | resolved
  basheer_response TEXT,
    -- on_leave | sick | left | bio_issue | other
  basheer_response_at TEXT,
  basheer_notes TEXT,
  resolution_action TEXT,
    -- 'archived' | 'kept_active' | 'leave_recorded' | 'bio_reset_needed'
  resolved_at TEXT,
  alert_token TEXT UNIQUE,  -- for WABA button URL
  waba_msg_id TEXT,
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_absence_alerts_status ON hr_absence_alerts(status, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_absence_alerts_active ON hr_absence_alerts(employee_id, last_working_date) WHERE status != 'resolved';

-- Ghost PINs: PINs seen on CAMS but not in roster
CREATE TABLE IF NOT EXISTS hr_ghost_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  total_punches INTEGER DEFAULT 0,
  total_days INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected',
    -- detected | sent_to_basheer | onboarding_started | onboarded | ignored | dismissed
  onboarding_token TEXT UNIQUE,  -- for Basheer's mini-UI URL
  basheer_response_at TEXT,
  -- Onboarding fields (filled by Basheer via mini-UI)
  ob_name TEXT,
  ob_known_as TEXT,
  ob_phone TEXT,
  ob_role TEXT,
  ob_brand TEXT,
  ob_pay_type TEXT,
  ob_monthly_salary INTEGER,
  ob_daily_rate REAL,
  ob_aadhaar TEXT,
  ob_dob TEXT,
  ob_start_date TEXT,
  ob_notes TEXT,
  -- Once onboarded, link back to created employee
  resolved_employee_id INTEGER,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghost_pins_pin ON hr_ghost_pins(pin) WHERE status NOT IN ('onboarded', 'dismissed');
CREATE INDEX IF NOT EXISTS idx_ghost_pins_status ON hr_ghost_pins(status);

-- Per-employee attendance-tracking flag (Mujib+Moin etc. start as 0, flip to 1 when policy change effected)
ALTER TABLE hr_employees ADD COLUMN track_attendance INTEGER DEFAULT 1;

-- Add manager phones for routing (Basheer is per-brand)
CREATE TABLE IF NOT EXISTS hr_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_label TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,  -- 10-digit Indian number, no country code
  role TEXT,            -- 'outlet_manager' | 'hr_admin' | 'owner'
  is_active INTEGER DEFAULT 1
);

INSERT OR IGNORE INTO hr_managers (brand_label, name, phone, role) VALUES
  ('NCH', 'Basheer', '<basheer_phone_10digit>', 'outlet_manager'),
  ('HE',  'Farooq',  '<farooq_phone_10digit>',  'outlet_manager'),
  ('HQ',  'Nihaf',   '9945470320', 'owner');
```

---

## 4. API Endpoints (added to `functions/api/hr-admin.js`)

### `action=cron-detect-absences` (called by cron worker)

1. Query employees with `track_attendance=1 AND is_active=1`
2. For each, check `hr_attendance_daily` last 7 days for punches
3. If 0 punches in last 2+ days AND no `hr_absence_alerts` row with status != 'resolved' for this employee + last_working_date:
   - Insert new alert row
   - Generate alert_token (UUID v4)
   - Call `sendAbsenceWaba(env, manager_phone, ...)` to send template

### `action=cron-detect-ghosts` (called by cron worker)

1. Query distinct PINs from `hr_cams_punches` last 7 days
2. Cross-reference with `hr_employees` where pin matches AND is_active=1
3. For each unmatched PIN:
   - INSERT INTO hr_ghost_pins ON CONFLICT skip (the unique index)
   - Update last_seen_at, total_punches, total_days
   - If status='detected' and total_punches>=3, call `sendGhostPinWaba(env, ...)` and update status='sent_to_basheer'

### `action=hr-absence-respond` (webhook from WABA button click)

Query params: `token=X&status=on_leave|sick|left|bio_issue`

1. Validate token, find row in `hr_absence_alerts`
2. Update `basheer_response`, `basheer_response_at`, `status='responded'`
3. Apply resolution_action:
   - `on_leave` → INSERT INTO hr_leaves (existing table); status='resolved'
   - `sick` → same as on_leave but reason='sick'
   - `left` → mark employee `is_active=0`, set `archived_reason`; trigger F&F workflow; status='resolved'; resolution_action='archived'
   - `bio_issue` → flag for manual fix; status='responded'

### `action=hr-ghost-onboard-start` (Basheer's mini-UI loads)

Query params: `token=X`

1. Validate token, return ghost PIN context (PIN, punches, days)
2. Plus dropdowns data: brand options, role suggestions, pay_type options

### `action=hr-ghost-onboard-submit` (mini-UI submits)

POST body: full new employee fields

1. Validate, INSERT INTO hr_employees with the new employee
2. Link drive folder if Basheer provided one (else create later)
3. Update hr_ghost_pins.status='onboarded', resolved_employee_id, resolved_at
4. Trigger contract generation:
   - Call internal `generate-contract` action (Phase 2 from doc 27)
   - Upload to Drive
   - Trigger Leegality eSign send
5. Return success + employee_id

---

## 5. Cron Worker (`workers/hr-cron/`)

New Cloudflare Worker with cron triggers, separate deployment from Pages.

```js
// workers/hr-cron/src/index.js
export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hourIST = (now.getUTCHours() + 5.5) % 24;

    // Every 8 hours: absence detection
    if ([3, 11, 19].some(h => Math.abs(hourIST - h) < 0.5)) {
      ctx.waitUntil(callDashboard(env, 'cron-detect-absences'));
    }

    // 8am IST: ghost PIN detection
    if (Math.abs(hourIST - 8) < 0.5) {
      ctx.waitUntil(callDashboard(env, 'cron-detect-ghosts'));
    }

    // 10pm IST: daily summary to owner
    if (Math.abs(hourIST - 22) < 0.5) {
      ctx.waitUntil(callDashboard(env, 'cron-daily-summary'));
    }
  }
};

async function callDashboard(env, action) {
  const r = await fetch(`https://hnhotels.in/api/hr-admin?action=${action}`, {
    method: 'POST',
    headers: { 'x-cron-token': env.CRON_TOKEN, 'content-type': 'application/json' },
  });
  return r.json();
}
```

```toml
# workers/hr-cron/wrangler.toml
name = "hn-hr-cron"
main = "src/index.js"
compatibility_date = "2024-09-23"

[triggers]
crons = ["0 */8 * * *", "0 8 * * *", "0 22 * * *"]
# Every 8 hours UTC, 8am UTC, 10pm UTC (adjust to IST equivalent)
```

Authentication via `CRON_TOKEN` secret prevents external abuse.

---

## 6. Basheer's Mini-UI (`/hr/respond/`)

Single-page app loaded from WABA button URL with token.

**For absence alert (`/hr/respond/absence?t=X`):**
- Big card: "Is [Employee Name] still working?"
- 4 buttons: On Leave | Sick | Left Job | Bio Issue
- For "On Leave/Sick": optional date picker (return date)
- For "Left Job": confirmation modal — "This will trigger F&F. Last day = ___"
- Submit → POST to `hr-absence-respond` → redirect to thank-you

**For ghost PIN onboarding (`/hr/respond/ghost?t=X`):**
- Form with all employee fields (Aadhaar, name, phone, role, brand, pay type, salary)
- Required: Name, Phone, Role, Brand, Pay Type, Wage
- Optional: Aadhaar, DOB (can be added later)
- "Save & Generate Contract" button → POST to `hr-ghost-onboard-submit`
- Redirect to thank-you with contract preview link

Mobile-first design (Basheer uses phone). Single-column layout, large tap targets.

---

## 7. Deployment Sequence

```bash
# 1. Apply D1 migration
wrangler d1 execute hn-hiring --file=schema-hr-automation.sql

# 2. Deploy cron worker
cd workers/hr-cron
wrangler deploy
wrangler secret put CRON_TOKEN  # set the same token in Pages env

# 3. Set CRON_TOKEN in Pages env
cd ../..
wrangler pages secret put CRON_TOKEN --project-name hn-hotels-site

# 4. Register WABA templates in Meta Business Manager
#    - hr_absence_inquiry_v1 (with 4 quick-reply buttons)
#    - hr_ghost_pin_inquiry_v1 (with URL button)
#    - hr_daily_summary_v1
#    Wait 24 hrs for approval

# 5. Update hr_managers table with actual phones
wrangler d1 execute hn-hiring --command="UPDATE hr_managers SET phone='9XXXXXXXXX' WHERE name='Basheer'"
wrangler d1 execute hn-hiring --command="UPDATE hr_managers SET phone='9XXXXXXXXX' WHERE name='Farooq'"

# 6. Push code (auto-deploys Pages)
git push

# 7. Test: manually trigger cron to verify flow
curl -X POST https://hnhotels.in/api/hr-admin?action=cron-detect-absences \
  -H "x-cron-token: <token>"
```

---

## 8. Expected Behavior After Deployment

### Day 1 (cron runs at 11am)
- Detects Muntaz, Noor (both 10+ days absent) — already known, alerts go to Basheer
- Detects 5 ghost PINs (11, 22, 42, 45, 46) — alerts go to Basheer with onboarding links

### Day 1 (Basheer responds)
- Taps "Left Job" for Muntaz → F&F triggered, archived
- Taps "Left Job" for Noor → same
- Taps onboarding link for ghost PIN 11 → fills form → contract auto-generated → Leegality eSign sent

### Day 2 (cron runs)
- No re-alerts for already-resolved Muntaz/Noor
- New ghost PIN detected (if any) → alert
- New 2-day absence (e.g., Aktar, Maqbool) → alert

### Steady State
- 1-2 absence alerts per week (typical for ~28 staff)
- 0-1 ghost PIN per week (rare new hire scenario)
- Owner receives daily summary 10pm with workforce health

---

## 9. What This Replaces

Without this automation:
- Owner manually checks /ops/hr for absences (often missed)
- New hires require: Owner adds employee → Owner generates contract → Owner sends to Leegality (3 manual steps)
- Departed employees stay active in roster for weeks (paying ESI premium for ghost staff)
- F&F gets delayed beyond Karnataka Code on Wages 2-day requirement
- Statutory compliance gaps appear over time

With this automation:
- Absence detected within 24 hrs of pattern emerging
- Ghost workers detected within 24 hrs of first punch
- Onboarding compresses from days to minutes
- Owner's role: review weekly summary, respond to escalations only
- Basheer's role: confirm via 1-tap WhatsApp buttons (no app to install, no UI to learn)

---

## 10. Risk Profile

| Risk | Mitigation |
|---|---|
| False positive (employee on planned leave gets "Left?" alert) | Track approved leaves in hr_leaves; cron skips employees with pending leaves |
| Basheer delayed in responding | Auto-escalate to Owner after 48 hrs |
| WABA template rejection by Meta | Use plain text fallback templates |
| Cron worker fails silently | Add health check endpoint hit by external monitor |
| Basheer accidentally taps "Left Job" | Confirmation modal in mini-UI before destructive action |
| Ghost worker is unauthorized device user | "STOP" reply path → flag PIN, escalate to Owner |
