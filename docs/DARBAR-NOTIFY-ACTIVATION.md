# Darbar Notify — Activation Runbook

This is the single document you follow to light up the notify system.
Two independent tracks run in parallel. Both must complete before the final step.

---

## Track A — WABA Template Approval

Do this once per template inside Meta Business Manager.

**Where to go:** business.facebook.com → your account → WhatsApp → Manage → Message Templates → Create Template

For each template below, fill in exactly the fields shown. The Body text is the
literal string — copy-paste without modification.

---

### 1. darbar_missed_exit_v1

| Field | Value |
|---|---|
| Template name | `darbar_missed_exit_v1` |
| Category | **UTILITY** |
| Language | English |
| Header | (none — leave blank) |
| Body | `Hi {{1}}, aapne aaj kaam khatam hone par punch nahi kiya. Ye missed-punch ke roop me darj hai. Kal punch out yaad rakhna. - HN Hotels` |
| Footer | (none) |
| Buttons | None |
| Variables | 1 variable: `{{1}}` = employee first name (e.g. "Sabir") |

---

### 2. darbar_absent_v1

| Field | Value |
|---|---|
| Template name | `darbar_absent_v1` |
| Category | **UTILITY** |
| Language | English |
| Header | (none) |
| Body | `Hi {{1}}, abhi tak aapka punch nahi dikha. Kaam pe ho ya aaj chhutti? - HN Hotels` |
| Footer | (none) |
| Buttons | None |
| Variables | 1 variable: `{{1}}` = employee first name |

---

### 3. darbar_break_open_v1

| Field | Value |
|---|---|
| Template name | `darbar_break_open_v1` |
| Category | **UTILITY** |
| Language | English |
| Header | (none) |
| Body | `Hi {{1}}, aapka break-return punch nahi mila. Wapas aane par punch karna yaad rakhein. - HN Hotels` |
| Footer | (none) |
| Buttons | None |
| Variables | 1 variable: `{{1}}` = employee first name |

---

### 4. darbar_departed_confirm_v1

| Field | Value |
|---|---|
| Template name | `darbar_departed_confirm_v1` |
| Category | **UTILITY** |
| Language | English |
| Header | (none) |
| Body | `HN Hotels: {{1}} ne {{2}} din se punch nahi kiya ({{3}}). Owner please confirm exit ya leave.` |
| Footer | (none) |
| Buttons | None |
| Variables | 3 variables: `{{1}}` = employee name, `{{2}}` = days absent (number), `{{3}}` = brand (HE or NCH) |

---

### 5. darbar_ghost_pin_v1

| Field | Value |
|---|---|
| Template name | `darbar_ghost_pin_v1` |
| Category | **UTILITY** |
| Language | English |
| Header | (none) |
| Body | `HN Hotels: PIN {{1}} {{2}} baar punch kar raha hai ({{3}} din) par roster me naam nahi hai. Owner please naam dein.` |
| Footer | (none) |
| Buttons | None |
| Variables | 3 variables: `{{1}}` = PIN number, `{{2}}` = punch count, `{{3}}` = days seen |

---

### When Meta approves a template

Meta sends you an email and shows "Approved" in the template list.

For each approved template, run this command (replace the template name and the
6-digit ID Meta shows under the template):

```
curl -s -X POST "https://darbar.hnhotels.in/api/comms?action=update-dlt-template" \
  -H "Content-Type: application/json" \
  -d '{
    "template_name": "darbar_missed_exit_v1",
    "dlt_template_id": "<META_TEMPLATE_ID>",
    "status": "approved"
  }'
```

Repeat for each of the 5 templates. That command flips `status='approved'` in
`dlt_templates` and the system starts using it immediately — no redeploy needed.

To verify a template is live:

```
curl -s "https://darbar.hnhotels.in/api/comms?action=list-dlt-templates" | grep darbar_
```

A row showing `"status":"approved"` and a real `dlt_template_id` (not "TBD") is
live and ready.

---

## Track B — Sabir Phone Verification

Sabir (PIN 16, Abdul Sabir Khan, HE tandoor) has no phone on record.
Until his number is confirmed, the system silently skips nudges to him
(`phone_verification_pending=1`). This is intentional — a wrong number
getting shift messages is a privacy incident.

### Step 1 — Get Sabir's number

Ask Sabir directly for his WhatsApp number (10 digits). Write it down.

### Step 2 — Apply the migration (if not yet done)

```bash
cd /Users/nihaf/Documents/Tech/HN-Darbar
wrangler d1 execute hn-hiring --remote --file=schema-darbar-sabir-phone.sql
```

This adds the `phone_verification_pending` column and flags Sabir's row.
It is idempotent — safe to run again if unsure.

### Step 3 — Set the verified number and clear the guard

```
curl -s -X POST "https://darbar.hnhotels.in/api/hr-admin?action=set-phone" \
  -H "Content-Type: application/json" \
  -d '{
    "pin": "16",
    "phone": "<SABIR_10_DIGIT_NUMBER>",
    "clear_verification_pending": true
  }'
```

This writes the phone to `hr_employees.phone` and sets
`phone_verification_pending=0` in one atomic update.

### Step 4 — Verify

```
curl -s "https://darbar.hnhotels.in/api/hr-admin?action=get-employee&pin=16" | \
  grep -E '"phone"|"phone_verification_pending"'
```

Expected: `"phone": "91XXXXXXXXXX"` and `"phone_verification_pending": 0`.

---

## Final Step — Enable notify-run

Once at least the darbar_absent_v1 and darbar_missed_exit_v1 WABA templates
are approved (Track A), run a manual dry-run to verify the cron fires correctly:

```
curl -s -X POST "https://darbar.hnhotels.in/api/hr-automation?action=cron-detect-absences" \
  -H "x-cron-token: <CRON_TOKEN>"
```

To get CRON_TOKEN:
```bash
grep -i CRON_TOKEN ~/.hn-assets.env
```

A successful response includes `"sent": [...]` with template names. Any employee
without an approved template will show `"skipped": "dlt_not_approved"` — that is
expected and safe. The system never hard-fails on a missing template; it skips
gracefully.

The cron is already wired to fire every 8 hours via the Cloudflare Worker schedule.
No further action needed once the dry-run succeeds.

---

## Status Checklist

| Item | Done? |
|---|---|
| darbar_missed_exit_v1 approved in Meta | |
| darbar_absent_v1 approved in Meta | |
| darbar_break_open_v1 approved in Meta | |
| darbar_departed_confirm_v1 approved in Meta | |
| darbar_ghost_pin_v1 approved in Meta | |
| Each template flipped to approved via update-dlt-template curl | |
| schema-darbar-sabir-phone.sql applied to D1 | |
| Sabir phone confirmed and set-phone called | |
| Dry-run cron-detect-absences returns sent rows | |

---

*Runbook version: 2026-05-29. No redeploy is required at any step — the system reads
dlt_templates at runtime and phone_verification_pending at send time.*
