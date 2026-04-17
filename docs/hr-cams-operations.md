# HR + CAMS F38+ Operational Runbook

**Last updated:** 2026-04-17
**Owner:** Nihaf (MD)
**Device:** CAMS Hawking Plus F38+ · SN `AYTH09089112` · UUID `1374196020710146049`

---

## 1. Architecture

CAMS pushes punches **directly to Odoo** via the paid "Odoo Standard Edition API" module
(valid until 31-Jan-2027). The HN Hotels HR dashboard (`/ops/hr/`) does **not** intercept
the device — it reads `hr.attendance` back from Odoo, reconciles against the roster, and
computes deductions.

```
CAMS F38+ ──HTTPS──► ops.hamzahotel.com/cams/biometric-api3.0 ──► Odoo hr.attendance
                                                                         │
                                                                         ▼
                                     /api/hr-admin pull-attendance ◄─────┘
                                                 │
                                                 ▼
                                     D1: hr_attendance_daily (status + deduction)
                                                 │
                                                 ▼
                                     /ops/hr/ dashboard
```

**Why not intercept?** The Odoo module is already paid-for and handles CAMS Web API 3.0
AuthToken + encryption natively. Building a shadow webhook would duplicate that work.
We read from Odoo instead and compute deductions in D1.

---

## 2. Device configuration (as captured 2026-04-17)

| Setting | Value |
|---|---|
| Callback URL | `https://ops.hamzahotel.com/cams/biometric-api3.0` |
| AuthToken | `zPnrBXmeNd6dTRlQ2ZC5dFov68V8gBh8` |
| Encryption Key | (empty — plain HTTPS) |
| Direction | `Actual` (device reports IN/OUT as-is, we derive server-side) |
| Handle Response | ON |
| Push User Data | ON |
| Restful API | ON |
| Push Photo | OFF |
| LoadPunchLog | OFF |
| Reverify | 30 seconds (duplicate-punch guard) |
| Timezone | `UTC+05:30 Kolkata` |

**If Direction changes to First-In-Rest-Out or ZigZag**, Odoo will populate `check_in`
and `check_out` on `hr.attendance` rows automatically. For now with `Actual`, each punch
creates a new row and we pair them server-side during `pull-attendance`.

---

## 3. The "ghost punch" problem

**Symptom:** CAMS F38+ uses continuous face detection. A single person walking past the
device can be recognised 3–5 times within seconds. Without mitigation, each detection
creates a new punch.

**Mitigation stack:**

1. **Device-level Reverify (30s)** — hardware refuses to re-log the same user within 30s
   of their last punch. Configured on the device, changeable via
   `/api/hr-admin` POST `cams-remote` with `cmd=set-reverify`.
2. **Server-level half-day threshold** — if worked hours < `half_day_threshold`
   (default 2h), status → `ghost` and full day's wage is deducted. The assumption:
   real work below 2h is rare; 90% of sub-2h days are bounces.
3. **Single-punch detection** — if the day has an IN but no OUT (or vice-versa), the
   row is flagged `is_single_punch=1`. For staff without `allow_single_punch=1`, this
   downgrades present → half-day.

**The "register and leave" scenario:** Staff punches in at 08:00 then walks out. No
second punch. `total_hours = 0`, `is_single_punch = 1`, status → `ghost` (below 2h),
full deduction applied. Caught.

---

## 4. Remote device commands

All commands routed via `/api/hr-admin` POST `cams-remote`. Admin PIN required.
Requires Cloudflare Pages secret `CAMS_AUTH_TOKEN` set to the device's current AuthToken.

| cmd | CAMS method | Required params | Effect |
|---|---|---|---|
| `get-users` | `GetUserData` | — | List users enrolled on device |
| `get-logs` | `GetAttLogs` | — | Pull device's internal punch log |
| `delete-user` | `DeleteUser` | `UserID` | Remove a user from the device |
| `push-user` | `AddUser` | `UserID`, `Name` | Enroll a user (face/fingerprint still needed on device) |
| `clear-logs` | `ClearAttLogs` | — | **Destructive:** wipes device punch queue |
| `clear-all` | `ClearAll` | — | **Destructive:** wipes users + logs |
| `reboot` | `Reboot` | — | Device reboots (punches in queue are lost) |
| `set-reverify` | `SetDeviceInfo` | `ReVerify` (seconds) | Change duplicate-punch window |

### Audit device vs roster (catches ghost PINs)

`POST /api/hr-admin` `cams-pull-users` → compares device user list with
`hr_employees.pin`. Returns:
- **Ghosts** — UserIDs on device not in roster (ex-staff, test enrolments)
- **Missing** — PINs in roster not on device (enrolment gap)

Runs automatically from the HR dashboard **CAMS → Audit vs Roster** button.

---

## 5. Setup the AuthToken secret (one-time)

```bash
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site
npx wrangler pages secret put CAMS_AUTH_TOKEN --project-name hn-hotels-site
# paste: zPnrBXmeNd6dTRlQ2ZC5dFov68V8gBh8
```

Until this secret is set, all `cams-remote` commands return
`"CAMS_AUTH_TOKEN not configured"`. Dashboard reads (device registry, notes, roster)
work without it.

---

## 6. Daily ops flow

1. **Morning (manual):** HR reviews `/ops/hr/` **Attendance** tab for yesterday.
   Click **Pull** if Odoo sync missed it.
2. **During the day:** device pushes punches live to Odoo.
3. **Month-end:** `/ops/hr/` **Deductions** tab → month selector → shows per-employee
   net salary after deductions.
4. **Before payroll:** click **Sync → Recompute deductions** to refresh all
   `hr_attendance_daily.deducted_amount` values against latest shift rules.

### First-time setup (once per fresh D1)

1. Bring device online (currently offline as of 2026-04-17).
2. Enroll the 13 staff without bio IDs on the device → note their new PINs →
   update roster via `/ops/hr/` Roster tab → **Edit** → set PIN.
3. Resolve Ameer Khan's brand (HE/NCH) and role.
4. `/ops/hr/` **Sync tab** → "1. Pull dept + job maps" (caches `hr.department`
   and `hr.job` IDs to D1 — avoids repeated API thrash during employee sync).
5. "2. Sync all employees → Odoo" (creates `hr.employee` + `hr.contract` for each
   active staff member with a PIN).
6. "3. Pull attendance" → fetches yesterday's punches and computes deductions.

---

## 7. Current device state (2026-04-17)

- **Status:** OFFLINE
- **Last connected:** 2026-04-01 16:32:15 (17 days ago)
- **Queue:** auto-restart scheduled 2026-04-17 18:14:32
- **Blocker:** physical power + network issue at HE Koramangala counter

**Action:** Nihaf to verify device is powered on and connected to WiFi, then
the CAMS cloud will auto-reconnect and flush queued punches to Odoo.

---

## 8. Shift rules reference

| Brand | Pay type | min_hours | half threshold | full threshold | single punch | week off |
|---|---|---|---|---|---|---|
| HE | Contract | 10 | 2h = absent | ≥8h = full | not allowed | none (hotel runs 7d) |
| HE | Monthly | 6 | 2h = absent | ≥6h = full | not allowed | none |
| NCH | Contract | 10 | 2h = absent | ≥8h = full | not allowed | none |
| NCH | Monthly | 6 | 2h = absent | ≥6h = full | not allowed | none |
| HQ | Monthly | 0 | — | — | allowed | Sunday |

Office (HQ) staff: `applies_to_office=1` → never deducted regardless of punches.
Adjust via `POST /api/hr-admin` `shift-rules-upsert`.

---

## 9. PIN access matrix

| PIN | User | Role | Access |
|---|---|---|---|
| `0305` | Nihaf | admin | All reads + all writes + CAMS remote + archive |
| `2026` | Zoya | hr | Reads + employee CRUD + sync + attendance pull |
| `3678` | Farooq | read | Reads only |
| `1111` | Faheem | read | Reads only |
