# Multi-Channel Communications Architecture

**Layers (in order of preference):**

1. **WhatsApp Business API (WABA)** — Sparksol/Meta — rich UX, buttons, multimedia, free-form within 24h reply window
2. **BSNL DLT SMS** — Entity BL-1400079296 — universal reach (no app/internet needed), plain text with reply-code shortcuts
3. **Exotel Voice / IVR** — voice calls + keypress capture — last resort for non-responders, urgent escalations

**Core principle:** Same information delivered through any channel. UI element changes (button → SMS reply code → keypress), payload doesn't.

---

## 1. Channel Selection Logic — When Each Fires

```
Event triggers (cron / webhook / manual)
        │
        ▼
  ┌─────────────────────────┐
  │ Lookup recipient prefs  │
  │ - WhatsApp opted-in?    │
  │ - DLT consent given?    │
  │ - Exotel call OK?       │
  └────────────┬────────────┘
               │
        Has WhatsApp opt-in?
       ┌───────┴────────┐
       YES              NO
        │                │
        ▼                ▼
   Send WABA       Send DLT SMS
        │                │
   (wait 6h)        (wait 6h)
        │                │
   ┌────┴────┐      ┌────┴────┐
  Read?     No      Reply?    No
   │        │       │         │
  done   Send SMS  done    Voice call
                              │
                          (wait 1h)
                              │
                         ┌────┴────┐
                        Press?   Else
                         │       │
                        done  Escalate
                              to Owner
```

### Channel timing for each alert type

| Alert type | First channel | Wait | Fallback 1 | Wait | Fallback 2 | Escalation |
|---|---|---|---|---|---|---|
| Absence inquiry (Basheer) | WABA | 6 hrs | DLT SMS | 6 hrs | Exotel call | → Owner WABA |
| Ghost PIN inquiry (Basheer) | WABA | 24 hrs | DLT SMS | 24 hrs | — | → Owner WABA |
| Daily roster summary (Owner) | WABA | — | — | — | — | — (informational only) |
| Leegality signing reminder (Employee) | WABA | 24 hrs | DLT SMS | 48 hrs | Exotel call | → Owner if 7+ days |
| F&F completion confirmation | WABA | 12 hrs | DLT SMS | 12 hrs | Exotel | → Manual follow-up |
| Probation review (90 days) | WABA | — | — | — | — | — |
| Annual contract renewal | WABA | 7 days | DLT SMS | — | — | — |

---

## 2. Message Templates — Same Content, Different Skin

### Use Case A: Absence Inquiry to Manager

**WABA (rich, with buttons):**
```
Hi Basheer,

Anthony (Washer, PIN 38) hasn't punched in 2 days.
Last day: 06-May-2026.

What's their status?

[On Leave]  [Sick]
[Left Job]  [Bio Issue]

— HN HR
```

**DLT SMS (universal, with reply codes):**
```
HNHTLS: Anthony (PIN 38) absent 2 days since 06-May. Status?
Reply: 1=Leave, 2=Sick, 3=Left, 4=BioIssue
Or open: hnhotels.in/hr/r/X
[BL-1400079296]
```

**Exotel Voice (IVR):**
```
"Hello Basheer. Employee Anthony, PIN three-eight, has not 
punched in for two days. Last working day was sixth May. 

To mark on leave, press 1.
To mark sick, press 2.
To mark as left job, press 3.
For bio issue, press 4.
To call owner, press 9."

[capture DTMF, route to /api/hr-automation?action=hr-absence-respond]
```

**Underlying state stored in D1:** identical record per channel attempt.

### Use Case B: Ghost PIN Onboarding

**WABA (URL button):**
```
Hi Basheer,

PIN 47 has been punching but isn't in our roster.
11 punches in 7 days.

If new employee, complete onboarding:
[Open Form ▶]  ← URL button to /hr/respond/ghost?t=X

If unauthorized, reply STOP.
```

**DLT SMS (URL link):**
```
HNHTLS: PIN 47 not in roster, 11 punches/7 days. 
Onboard at: hnhotels.in/hr/r/Y
Or reply STOP if unauthorized.
[BL-1400079296]
```

**Exotel Voice:**
```
"PIN forty-seven has been recording attendance but is not 
in our roster. Eleven punches over seven days.

If this is a new employee, you will receive a SMS link 
to complete their onboarding details.

If unauthorized, press 9 to flag."

[on press 9 → mark hr_ghost_pins.status='dismissed', notify owner]
```

### Use Case C: Daily Summary to Owner

**WABA only** (no fallback needed — informational, not actionable):
```
Roster summary 08-May-2026:

Active: 28 | Punched today: 25 | Absent: 3
- Aktar (8d streak)
- Maqbool (8d streak)  
- Aadil (16d streak — escalating)

Pending alerts: 1 awaiting Basheer response
Ghost PINs: 0 new

Tap: hnhotels.in/ops/hr
```

---

## 3. Owner UI — Single Pane to Monitor All Channels

Add new tab in `/ops/hr` called **"Alerts & Comms"**:

```
┌────────────────────────────────────────────────────────────┐
│ /ops/hr → Alerts & Comms                                    │
├────────────────────────────────────────────────────────────┤
│ [Active Alerts: 3]  [Resolved Today: 2]  [Ghost PINs: 1]   │
├────────────────────────────────────────────────────────────┤
│                                                              │
│ ⏳ Anthony — Absence (2 days)                               │
│    📱 WABA sent 11:00 IST → READ at 11:14 (no reply yet)   │
│    Auto-fallback to SMS at 17:00 if no response             │
│    [Send SMS now] [Call via Exotel] [Resolve manually]     │
│                                                              │
│ ⏳ PIN 47 — Ghost Onboarding                                │
│    📱 WABA sent 08:00 IST → DELIVERED, not opened           │
│    📩 SMS sent 14:00 IST → DELIVERED                         │
│    🎯 Awaiting Basheer onboarding form submit               │
│    [Resend WABA] [Call via Exotel] [Dismiss as unauthorized]│
│                                                              │
│ ✓ Muntaz — Resolved                                          │
│    Status: LEFT JOB                                          │
│    Channel: WABA → button tap                                │
│    Response time: 14 min                                     │
│    F&F triggered, archived                                   │
└────────────────────────────────────────────────────────────┘
```

**Key UI elements:**
- Status icons: ⏳ pending · 🔄 in-progress · ✓ resolved · ⚠ escalated
- Channel icons: 📱 WABA · 📩 SMS · ☎ Voice
- Read receipts inline
- Manual override buttons (force fallback, resolve, dismiss)
- Response time SLA tracking (24h target)

---

## 4. D1 Schema for Multi-Channel Tracking

```sql
-- Track every channel attempt per alert
CREATE TABLE IF NOT EXISTS hr_alert_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,           -- FK to hr_absence_alerts.id or hr_ghost_pins.id
  alert_type TEXT NOT NULL,            -- 'absence' | 'ghost_pin' | 'summary' | etc.
  channel TEXT NOT NULL,               -- 'waba' | 'dlt_sms' | 'exotel_voice'
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  template_used TEXT,                  -- e.g., 'hr_absence_inquiry_v1'
  payload_json TEXT,                   -- full message payload as sent
  sent_at TEXT DEFAULT (datetime('now')),
  delivered_at TEXT,
  read_at TEXT,                        -- WABA only
  responded_at TEXT,
  response_text TEXT,
  response_method TEXT,                -- 'button_tap' | 'sms_reply' | 'dtmf_keypress' | 'url_click'
  provider_msg_id TEXT,                -- WABA msg ID, SMS message ID, Exotel call SID
  status TEXT DEFAULT 'sent',          -- sent | delivered | read | responded | failed | timed_out
  error_message TEXT,
  cost_paise INTEGER                   -- track cost: SMS=8paise, voice=~50paise/30s, WABA=free
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_alert ON hr_alert_channels(alert_id, alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_channels_status ON hr_alert_channels(status, sent_at);

-- Recipient channel preferences
CREATE TABLE IF NOT EXISTS hr_recipient_prefs (
  phone TEXT PRIMARY KEY,
  name TEXT,
  waba_opted_in INTEGER DEFAULT 0,
  waba_opted_in_at TEXT,
  dlt_sms_consent INTEGER DEFAULT 1,   -- statutory consent for DLT (verified at onboarding)
  exotel_call_ok INTEGER DEFAULT 1,
  preferred_channel TEXT DEFAULT 'waba',  -- 'waba' | 'sms' | 'voice'
  do_not_disturb_start TEXT,           -- e.g. '22:00' — no calls/SMS after this
  do_not_disturb_end TEXT,             -- e.g. '08:00'
  timezone TEXT DEFAULT 'Asia/Kolkata',
  language TEXT DEFAULT 'hi'           -- 'en' | 'hi' | 'bn' | 'te' | 'ta'
);

INSERT OR IGNORE INTO hr_recipient_prefs (phone, name, waba_opted_in, dlt_sms_consent, preferred_channel) VALUES
  ('919XXXXXXXXX', 'Basheer', 1, 1, 'waba'),
  ('919341745726', 'Farooq',  1, 1, 'waba'),
  ('919945470320', 'Nihaf',   1, 1, 'waba');
```

---

## 5. Implementation — Channel Orchestrator

**New module:** `functions/api/_lib/comms-orchestrator.js`

```js
// Single entry point — all alert sends go through here.
// Handles channel selection + escalation timing.

export async function sendAlert(env, db, {
  alertType,        // 'absence' | 'ghost_pin' | 'summary'
  alertId,          // primary key in source table
  recipient,        // { phone, name }
  templateName,     // base template name; channel-specific suffix added
  vars,             // template variables
  buttons,          // optional: array of { id, label, payload }
  urgency,          // 'normal' | 'escalating' | 'critical'
}) {
  const prefs = await getRecipientPrefs(db, recipient.phone);

  // Pick first channel
  const firstChannel = prefs.preferred_channel || 'waba';

  // Send via first channel
  const result = await dispatchChannel(env, firstChannel, { ...arguments[1], prefs });

  // Schedule fallback if no response
  await scheduleEscalation(env, db, {
    alertType, alertId, prefs,
    fallback_after_hours: urgency === 'critical' ? 1 : 6,
  });

  return result;
}

async function dispatchChannel(env, channel, opts) {
  switch (channel) {
    case 'waba': return sendWaba(env, opts);
    case 'dlt_sms': return sendDltSms(env, opts);
    case 'exotel_voice': return triggerExotelCall(env, opts);
    default: throw new Error(`Unknown channel: ${channel}`);
  }
}

// Each channel-specific function:
// - Translates template + vars + buttons into channel-native format
// - Sends via provider API
// - Logs to hr_alert_channels with provider_msg_id
// - Returns { success, msg_id, provider_response }

async function sendWaba(env, opts) { /* uses Meta Cloud API; supports buttons */ }

async function sendDltSms(env, opts) {
  // BSNL DLT — uses approved templates only
  // Maps WABA buttons to SMS reply codes (1, 2, 3, 4 + URL)
  // Headers: BL-1400079296 entity, header HNHTLS
  // Free-form variants of approved templates
}

async function triggerExotelCall(env, opts) {
  // Exotel ConnectApp/IVR
  // Plays text-to-speech (Hindi/English mix)
  // Captures DTMF press
  // Routes to webhook /api/exotel-callback
}
```

**Channel-specific webhooks** (already exists for WABA `/api/comms-webhook`; add `/api/sms-webhook` and `/api/exotel-webhook`):

```js
// /api/sms-webhook — handles inbound SMS replies
// User SMS "1" → look up recent outbox by phone+window → infer alert_id → call respondToAbsence

// /api/exotel-webhook — handles Exotel DTMF + call status
// User presses "1" → same routing as SMS reply "1"
```

---

## 6. Escalation State Machine

```
[NEW] alert detected
       │
       ▼
[SENT_WABA] → wait 6h (or 24h for non-urgent)
       │
   Read? Yes/No?
       │
   ┌───┴───┐
  YES     NO
   │       │
   ▼       ▼
[READ]  [SENT_SMS] → wait 6h
   │       │
Replied?  Replied?
   │       │
  YES     NO
   │       │
   ▼       ▼
[RESOLVED] [SENT_VOICE] → wait 1h
              │
          Pressed key?
              │
          ┌───┴───┐
         YES     NO
          │       │
          ▼       ▼
      [RESOLVED] [ESCALATED_OWNER]
                     │
                  Owner manually resolves
                     │
                     ▼
                 [RESOLVED]
```

Cron worker drives transitions: every 30 min, query `hr_alert_channels` for alerts past their fallback window, send next channel.

---

## 7. Cost Model (per alert)

| Channel | Cost per send | Reach |
|---|---|---|
| WABA (template-initiated) | ₹0 (Meta charges utility category at ~₹0.20/conversation but Sparksol fits utility tier) | Requires opt-in or service window |
| DLT SMS (BSNL) | ~₹0.15-0.30 per SMS | Universal — works on any phone |
| Exotel Voice | ~₹0.50-1.00 per 30s call | Works for any phone with audio |

**Per alert lifecycle worst case:** ₹0 + ₹0.30 + ₹1.00 = ₹1.30
**For ~30 absence alerts/year + 5 ghost PINs/year + daily summaries:** annual cost ≈ ₹100-200

Negligible. Channel choice is about delivery, not cost.

---

## 8. Owner Dashboard — `/ops/hr/alerts/`

New route in /ops/hr showing:

- **Active Alerts** — all pending/in-progress, with channel state per alert
- **Recent Resolutions** — last 7 days, with avg response time
- **Channel Health** — % delivery success by channel, % response by channel
- **Recipient Compliance** — Basheer's response time SLA tracking

Each alert card shows:
- Employee/PIN context
- Channel attempts as horizontal timeline (sent → delivered → read → response)
- Manual action buttons (force fallback, resolve, dismiss)
- Time elapsed + SLA deadline

This is the single pane the owner checks daily. Replaces ad-hoc checking of /ops/hr roster + WhatsApp + SMS.

---

## 9. Implementation Sequence

**Phase 1 (current):** WABA only — already built in `hr-automation.js`

**Phase 2 (next, ~4 hours):**
- Add `hr_alert_channels` + `hr_recipient_prefs` tables
- Create `comms-orchestrator.js` module
- Refactor existing send functions to route through orchestrator

**Phase 3 (after Exotel verification + 6 DLT templates approved, ~6 hours):**
- Implement `sendDltSms()` using BSNL DLT (Templates registered separately on Sparksol Network/SMS gateway)
- Implement `triggerExotelCall()` using Exotel ConnectApp API
- Build `/api/sms-webhook` and `/api/exotel-webhook` for inbound responses
- Cron worker: add `escalate-pending-alerts` action every 30 min

**Phase 4 (~3 hours):**
- Build `/ops/hr/alerts/` dashboard
- Owner monitoring + manual override controls
- Recipient preferences edit UI

**Phase 5 (~2 hours):**
- Multilingual templates (Hindi/Bengali for migrant workers receiving Leegality reminders)
- Per-recipient timezone-aware DND

---

## 10. Risk Profile

| Risk | Mitigation |
|---|---|
| WABA template rejection by Meta | DLT SMS as guaranteed fallback |
| DLT template rejection | Plain transactional templates (no marketing language) |
| Exotel call rejected (DND list) | Fallback to manual notification to Owner |
| Same alert sent on all 3 channels (annoying) | Strict state machine — only ONE active channel at a time |
| Reply on wrong channel (e.g., SMS reply when WABA was sent) | Webhook handlers cross-check `hr_alert_channels` table for any active alert from that phone |
| Recipient changes phone | hr_managers + hr_recipient_prefs both updateable; future alerts use new phone |
| Cron miss → late escalation | Multiple cron triggers (every 30 min) for redundancy |
| Cost spike from runaway loops | hr_alert_channels has UNIQUE constraint on (alert_id, alert_type, channel) |
