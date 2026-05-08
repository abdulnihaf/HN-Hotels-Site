# Verified Communication Layers — Deep Configuration

**Status as of 2026-05-08:** Both layers below are KYC-verified, secrets configured in Cloudflare, and have working API integrations in `functions/api/comms.js` + `functions/api/comms-webhook.js`. The HR automation built today (`functions/api/hr-automation.js`) should LEVERAGE these — not duplicate them.

---

## Layer 1 — WhatsApp Business API (WABA) — Sparksol

### Account Configuration

| Property | Value |
|---|---|
| **Provider** | Meta Cloud API direct (no aggregator middleman) |
| **Graph version** | v24.0 |
| **Brand routing** | 3 separate WABAs by purpose |

### Three WABA Brands

| Brand | Purpose | Phone ID env var | Token env var |
|---|---|---|---|
| **`sparksol`** | **Staff/HR comms** (dedicated, no customer flow) | `WA_SPARKSOL_PHONE_ID` | `WA_SPARKSOL_TOKEN` |
| `he` | Hamza Express customer order flow | `WA_HE_PHONE_ID` | `WA_HE_TOKEN` |
| `nch` | Nawabi Chai House customer order flow | `WA_NCH_PHONE_ID` | `WA_NCH_TOKEN` |

**Critical:** All HR alerts go through **sparksol** brand. Customer-flow WABAs (he, nch) are reserved and untouched.

### Opt-in System (Live, Verified)

**State machine in `comms_optin` table:**

```
[NEW] employee added
        │
        ▼
optin-send action triggered
        │
   POST WABA template (opt-in CTA)
        │
        ▼
[PENDING] in comms_optin
        │
  Employee replies on WhatsApp
        │
   ┌────┴────┐
  YES/Hi    NO/STOP
   │         │
   ▼         ▼
[OPTED_IN] [OPTED_OUT]
   │         │
Auto-reply  No further messages
welcome     Future: skip channel
```

### Reply Pattern Recognition (regex)

```javascript
YES_RX  = /yes|y|ok|haan|sure|confirm|consent|agree|haa/i
NO_RX   = /no|n|stop|nahi|opt[\s_-]?out|cancel|unsubscribe/i
ACK_RX  = /resolved|done|fixed|cleared|ack(nowledge)?d?|✅/i
SNOOZE_RX = /snooze|later|busy|wait|hold/i
```

### Webhook Flow (Inbound — Live)

`POST /api/comms-webhook` with Meta payload structure:

```
Meta sends → {entry: [{changes: [{value: {messages|statuses}}]}]}
                                              │
                                       ┌──────┴──────┐
                                  messages       statuses
                                       │              │
                                  Inbound user    Delivery state
                                       │              │
                       ┌───────────────┴──┐      ┌────┴────┐
                  optin-pending?      ack-context?  delivered/read/failed
                       │                  │            │
                  YES/NO triggers    Update outbox.  Update outbox.
                  status flip         acked_at         status
                                      ack_action       delivered_at
                                                       read_at
```

### Send Endpoint (Live)

```bash
POST /api/comms?action=send
Header: x-dashboard-key: <DASHBOARD_KEY>
Body: {
  "channel": "waba",
  "brand": "sparksol",          # default for HR
  "phone": "9XXXXXXXXXX",
  "template": "hr_absence_inquiry_v1",
  "vars": ["Basheer", "Anthony", "PIN 38", "2", "06-May-2026"],
  "alert_id": "abs_123"
}
```

### What the HR automation built today needs to USE

In `functions/api/hr-automation.js`, instead of directly calling Meta API (which it currently does in `sendAbsenceWaba()`), it should call `/api/comms?action=send` internally. Benefits:

- Centralised logging (everything goes through `comms_outbox`)
- Brand routing handled in one place
- Status callbacks already wired up
- No duplicate auth / phone / token handling
- Existing webhook handlers already process responses

**Refactor needed in Phase 3:** Replace direct WABA calls in `hr-automation.js` with internal POSTs to `/api/comms?action=send`.

---

## Layer 2 — Exotel Voice — hnhotels1 Account

### Account Configuration

| Property | Value |
|---|---|
| **Account SID** | `hnhotels1` |
| **API Key (env: `EXOTEL_API_KEY`)** | `6927b3a9b2adc318e8eedb200ab406209e14629bbbc890d3` |
| **API Token (env: `EXOTEL_API_TOKEN`)** | `e64dead57c3925805bf90b96a9738f465c2e80382fbbd26a` |
| **Caller ID (env: `EXOTEL_CALLER_ID`)** | `09513886363` |
| **Region** | Singapore |
| **API Base** | `https://api.exotel.com` |
| **Dashboard** | https://my.exotel.com/hnhotels1/ |
| **KYC** | Verified 2026-05-05 |
| **Credits** | ~277 remaining (~₹0.55/min mobile) |

### Outbound Call Flow (Live)

```
HR cron / alert trigger
        │
        ▼
POST /api/comms?action=send  channel=voice
        │
        ▼
sendVoice() in comms.js
  POST to api.exotel.com/v1/Accounts/hnhotels1/Calls/connect.json
    From=09513886363
    To=09XXXXXXXXX  (recipient — note 0XXXXXXXXXX format)
    Url=https://hnhotels.in/api/comms-webhook?action=exotel-tts&text=<msg>&alert_id=<id>
    StatusCallback=https://hnhotels.in/api/comms-webhook?action=exotel-status
    TimeLimit=120
        │
        ▼
Exotel dials recipient → call connects
        │
        ▼
Exotel fetches the Url for ExoML
        │
        ▼
GET /api/comms-webhook?action=exotel-tts
  Returns ExoML XML:
    <Response>
      <Say voice="en-IN">{message_text}</Say>
      <Gather numDigits="1" action="/exotel-dtmf" timeout="10">
        <Say>Press 1 to acknowledge. Press 2 to snooze.</Say>
      </Gather>
      <Say>No input received. Goodbye.</Say>
    </Response>
        │
        ▼
Recipient hears message + presses key
        │
        ▼
POST /api/comms-webhook?action=exotel-dtmf
  formData: Digits=1|2, CallSid=...
  → Update comms_outbox.acked_at + ack_action (resolved | snooze)
  → Returns ExoML <Say>Acknowledged. Thank you.</Say><Hangup/>
        │
        ▼
Call ends → Exotel posts status callback
        │
        ▼
POST /api/comms-webhook?action=exotel-status
  formData: CallSid, Status (completed | no-answer | busy | failed)
  → Update comms_outbox.status + delivered_at
```

### Phone Number Formatting

| Input | Stored as | Sent to Exotel as |
|---|---|---|
| `9341745726` | `919341745726` (in DB) | `09341745726` (Exotel India format) |
| `+919945470320` | `919945470320` | `09945470320` |
| `09513886363` (caller) | — | `09513886363` (used as From) |

The `0XXXXXXXXXX` format is India-specific — Exotel requires it for outbound to mobile.

### IVR Voice Used

`voice="en-IN"` — Indian English TTS. Reads `message_text` field as-is.

For Hindi/Bengali support (future): can use `voice="hi-IN"` for Hindi messages. Bengali TTS not directly supported by Exotel; would need pre-recorded audio file URLs.

### Status Callback Mapping

| Exotel Status | comms_outbox status | comms_outbox.delivered_at | comms_outbox.error_text |
|---|---|---|---|
| `completed` | `delivered` | timestamp | null |
| `no-answer` | `failed` | null | "no-answer" |
| `busy` | `failed` | null | "busy" |
| `failed` | `failed` | null | "failed" |
| `cancelled` | `failed` | null | "cancelled" |

### Cost Tracking

Each call ~₹0.55/min for mobile, ~₹0.35/min for landline. 30-second alert call = ~₹0.30 actual cost.

For HR alerts (typical 30-second duration):
- 30 absence alerts/year × ₹0.30 = ₹9
- 10 escalations/year × ₹0.30 = ₹3
- **Total annual voice cost: ~₹15** for HR alone

Negligible. Exotel credits at 277 = ~₹150 worth = years of HR usage.

### What the HR automation built today needs to USE

The same `/api/comms?action=send` endpoint with `channel=voice`. The orchestrator I built in `comms-orchestrator.js` should call this endpoint internally rather than implementing Exotel directly.

---

## Existing comms_outbox Schema (Live, Used)

```sql
CREATE TABLE comms_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT,                 -- generic alert grouping
  tier TEXT,                     -- 'info' | 'warn' | 'critical'
  brand TEXT,                    -- 'sparksol' | 'he' | 'nch' | 'hq'
  channel TEXT,                  -- 'waba' | 'sms' | 'voice'
  recipient_phone TEXT,
  template_name TEXT,            -- WABA template OR 'voice_ivr'
  template_vars TEXT,            -- JSON
  body_text TEXT,                -- for SMS/voice the spoken/sent text
  status TEXT,                   -- pending | sent | delivered | read | responded | failed
  provider_msg_id TEXT,          -- WABA msg ID OR Exotel CallSid
  provider_response TEXT,        -- raw provider JSON
  delivered_at TEXT,
  read_at TEXT,                  -- WABA only
  acked_at TEXT,                 -- when DTMF/reply received
  ack_action TEXT,               -- 'resolved' | 'snooze'
  ack_payload TEXT,              -- raw digit OR reply text
  error_text TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Existing comms_optin Schema (Live, Used)

```sql
CREATE TABLE comms_optin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  brand TEXT NOT NULL,
  channel TEXT NOT NULL,         -- 'waba'
  staff_name TEXT,
  staff_role TEXT,
  status TEXT,                   -- pending | opted_in | opted_out
  consented_at TEXT,
  revoked_at TEXT,
  consent_text TEXT,             -- the "YES" / "OK" they replied with
  consent_msg_id TEXT,           -- linked outbox msg ID
  UNIQUE (phone, brand, channel)
);
```

---

## Critical Insight — What This Means for HR Automation

The HR automation I built today (Phase 1-2) should be REFACTORED to use the existing `comms.js` hub instead of calling provider APIs directly. This eliminates:

| Duplication | Existing solution |
|---|---|
| `sendAbsenceWaba()` directly hits Meta | Should call `/api/comms?action=send&channel=waba&brand=sparksol` |
| `triggerExotelCall()` in comms-orchestrator.js | Should call `/api/comms?action=send&channel=voice` |
| `hr_alert_channels` table in schema-comms-channels.sql | Could merge with existing `comms_outbox` (alert_id + tier as discriminators) |
| `hr_recipient_prefs` separate table | Could augment `comms_optin` with channel preferences |

### Recommended Refactor

**Option A — Use existing hub (recommended):**
- HR automation alerts go through `/api/comms?action=send`
- `comms_outbox` becomes the single source of truth for ALL alerts
- `alert_id` field carries HR-specific identifier (e.g., `hr_absence:123` or `hr_ghost:11`)
- `tier` field signals urgency (`critical` for ghost PINs, `warn` for absence)
- Existing webhook handlers (`comms-webhook.js`) process responses
- Add HR-specific routing in `comms-webhook.js` to update `hr_absence_alerts` / `hr_ghost_pins` based on `alert_id` prefix

**Option B — Keep separate (current):**
- HR module is more isolated
- Doubles the schema + logic surface
- Risk of drift between `comms_outbox` and `hr_alert_channels`

**Option A is cleaner.** The refactor is ~2 hours: replace direct provider calls in hr-automation.js with internal fetches to /api/comms.

---

## Health Check (Current State)

```bash
curl https://hnhotels.in/api/comms?action=health
```

Expected response confirms:
- `waba_sparksol_phone_id`: true (HR comms)
- `waba_sparksol_token`: true
- `exotel_sid`: true
- `exotel_api_key`: true
- `exotel_api_token`: true
- `exotel_caller_id`: true
- `d1_bound`: true

---

## Operational Reality Today

Both layers are LIVE and have been tested:
- Multiple WABA opt-ins completed for HE/NCH staff
- Voice calls have been used for ops alerts (memory: alert_id workflow)
- Status callbacks working (delivered/read/failed)
- DTMF acknowledgement working (resolve/snooze)

**HR automation just needs to plug into this existing rail.** No new infrastructure required — just smarter routing logic on top.

---

## Channel Decision Matrix (Once Logic Defined)

When the orchestration logic gets defined, the picks will be:

| Recipient | Has WABA opt-in? | Default channel | Fallback |
|---|---|---|---|
| Manager (Basheer/Farooq/Nihaf) | Yes (already opted in) | WABA | Voice via Exotel |
| New employee at onboarding | No (pending opt-in) | Voice via Exotel for first contact, then WABA opt-in | SMS via Fast2SMS / DLT |
| Ex-employee for F&F notification | Maybe revoked | DLT SMS (transactional) | Voice as backup |
| Active employee for Leegality reminder | Yes | WABA with URL button | DLT SMS with link |
| Owner daily summary | Yes | WABA | None (informational) |

The detailed timing + escalation logic gets defined when we build Phase 3 (Owner dashboard `/ops/hr/alerts/`).

---

## Files Already in Place (Live)

| File | What it does |
|---|---|
| `functions/api/comms.js` | Send endpoint — sendWaba, sendSms (Fast2SMS), sendVoice (Exotel) |
| `functions/api/comms-webhook.js` | Inbound: Meta webhook + Exotel TTS/DTMF/status |
| `schema-comms.sql` | comms_outbox + comms_optin tables (LIVE in production D1) |
| `docs/EXOTEL_VOICE_CONTEXT.md` | Exotel runbook (in `friendly-wing-e64cf1` branch) |
| `docs/COMMS-OPTIN-RUNBOOK.md` | Opt-in process documentation |

**The HR automation infrastructure I added today (`hr-automation.js`, `comms-orchestrator.js`) is technically NEW but architecturally redundant.** Next session: refactor to use existing `comms.js` hub.

---

## Memory Note for Future Sessions

When the user mentions "send WhatsApp" or "voice alert" or "comms":
- The hub is `/api/comms?action=send` — auth via `x-dashboard-key`
- Default brand for staff/HR comms = `sparksol`
- Default brand for owner/internal = `hq` (or sparksol)
- Existing tables: `comms_outbox` (logs every send), `comms_optin` (opt-in state)
- Webhook for all inbound: `/api/comms-webhook` (Meta + Exotel)
- DTMF: digit 1 = resolved, digit 2 = snooze
- WABA opt-in regex: YES_RX / NO_RX / ACK_RX / SNOOZE_RX
- Phone format: store as `91XXXXXXXXXX`, send to Exotel as `0XXXXXXXXXX`

Don't re-implement. Always go through the hub.
