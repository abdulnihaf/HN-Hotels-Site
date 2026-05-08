# Exotel Voice — Context Prompt & Workflow Reference

> Paste this into any Claude session that needs to work with the HN Hotels voice alert system.

---

## Account Credentials (all set as Cloudflare secrets — never hardcode)

| Secret Name | Value | Notes |
|---|---|---|
| `EXOTEL_SID` | `hnhotels1` | Account SID |
| `EXOTEL_API_KEY` | `6927b3a9b2adc318e8eedb200ab406209e14629bbbc890d3` | HTTP Basic username |
| `EXOTEL_API_TOKEN` | `e64dead57c3925805bf90b96a9738f465c2e80382fbbd26a` | HTTP Basic password |
| `EXOTEL_CALLER_ID` | `09513886363` | Outbound ExoPhone (India mobile) |

- **Dashboard:** https://my.exotel.com/hnhotels1/
- **Region:** Singapore | **API base:** `https://api.exotel.com`
- **KYC:** Completed & verified (2026-05-05)
- **Credits:** ~277 remaining (~₹0.55/min mobile calls)

---

## Architecture Overview

```
Ops Alert (CRITICAL tier, unacked >5 min)
        │
        ▼
POST /api/comms?action=send
  { channel: "voice", phone: "91XXXXXXXXXX", message_text: "...", alert_id: "..." }
        │
        ▼
sendVoice() in functions/api/comms.js
  → POST https://{API_KEY}:{API_TOKEN}@api.exotel.com/v1/Accounts/hnhotels1/Calls/connect.json
  → Exotel dials EXOTEL_CALLER_ID → recipient
        │
        ▼
Call connects → Exotel fetches ExoML from:
  GET /api/comms-webhook?action=exotel-tts&text=<message>&alert_id=<id>
        │
        ▼
ExoML plays TTS → Gather DTMF:
  "Press 1 to acknowledge. Press 2 to snooze 30 minutes."
        │
        ▼
POST /api/comms-webhook?action=exotel-dtmf&alert_id=<id>
  Digit 1 → comms_outbox: ack_action='resolved'
  Digit 2 → comms_outbox: ack_action='snooze'
        │
        ▼
POST /api/comms-webhook?action=exotel-status
  completed → status='delivered'
  no-answer/busy/failed → status='failed'
```

---

## Key Files

| File | Role |
|---|---|
| `functions/api/comms.js` | Central hub — `sendVoice()` at line ~73, `send` action at ~205 |
| `functions/api/comms-webhook.js` | Webhook handler — `exotel-tts`, `exotel-dtmf`, `exotel-status` |
| `schema-comms.sql` | D1 schema — `comms_outbox` + `comms_optin` tables |
| `.env.local` | Local dev secrets (gitignored) |
| `wrangler.toml` | CF binding docs + secret registry |

---

## How to Trigger a Voice Call (curl test)

```bash
# Replace DASHBOARD_KEY and phone number as needed
curl -X POST "https://hnhotels.in/api/comms?action=send" \
  -H "Content-Type: application/json" \
  -H "x-dashboard-key: $DASHBOARD_KEY" \
  -d '{
    "channel": "voice",
    "phone": "917010426808",
    "message_text": "HN Hotels CRITICAL alert. Kitchen equipment fault at Hamza Express. Immediate attention required.",
    "alert_id": "test-001",
    "tier": "critical",
    "brand": "he"
  }'
```

Expected response:
```json
{
  "ok": true,
  "status": "sent",
  "provider_msg_id": "hnhotels1XXXXXXXXXXXXXXXXXXXXXXXX",
  "response": { "Call": { "Sid": "...", "Status": "in-progress", ... } }
}
```

---

## How to Check Call Status (D1 query)

```bash
npx wrangler d1 execute hn-hiring \
  --command "SELECT id, channel, status, acked_at, ack_action, error_text FROM comms_outbox WHERE channel='voice' ORDER BY id DESC LIMIT 10;"
```

---

## Exotel Direct API (bypass comms.js — for debugging)

```bash
# Make an outbound call directly
curl -X POST \
  "https://6927b3a9b2adc318e8eedb200ab406209e14629bbbc890d3:$EXOTEL_API_TOKEN@api.exotel.com/v1/Accounts/hnhotels1/Calls/connect.json" \
  -d "From=09513886363" \
  -d "To=07010426808" \
  -d "CallerId=09513886363" \
  -d "Url=https://hnhotels.in/api/comms-webhook?action=exotel-tts&text=Test+call+from+HN+Hotels" \
  -d "TimeLimit=60" \
  -d "Record=false"
```

---

## ExoML Reference (what /api/comms-webhook?action=exotel-tts returns)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-IN">{message_text}</Say>
  <Gather numDigits="1" action="https://hnhotels.in/api/comms-webhook?action=exotel-dtmf&alert_id={id}" method="POST" timeout="10">
    <Say voice="en-IN">Press 1 to acknowledge. Press 2 to snooze for 30 minutes.</Say>
  </Gather>
  <Say voice="en-IN">No input received. Goodbye.</Say>
</Response>
```

---

## D1 Schema — comms_outbox (relevant voice columns)

```sql
channel         TEXT  -- 'voice' for Exotel calls
provider_msg_id TEXT  -- Exotel CallSid
alert_id        TEXT  -- links back to the originating alert
status          TEXT  -- pending → sent → delivered (completed) | failed
delivered_at    TEXT  -- set when call status = 'completed'
acked_at        TEXT  -- set when DTMF digit received
ack_action      TEXT  -- 'resolved' (digit 1) | 'snooze' (digit 2)
ack_payload     TEXT  -- raw digit pressed
error_text      TEXT  -- set when status = 'failed' (no-answer/busy/etc)
```

---

## Health Check

```bash
curl "https://hnhotels.in/api/comms?action=health"
# Verify: exotel_sid, exotel_api_key, exotel_api_token, exotel_caller_id all = true
```

---

## Pending / Next Steps

- [ ] Merge PR on `claude/friendly-wing-e64cf1` branch → deploy to production
- [ ] Run test call: `curl` the `/api/comms?action=send` endpoint with `channel=voice` targeting 7010426808
- [ ] Monitor D1: verify `status=delivered` + `acked_at` populated after DTMF press
- [ ] Wire into alert escalation cron: after 5 min no WhatsApp ack → fire voice call
- [ ] Recharge Exotel credits when balance drops below ₹200

---

*Last updated: 2026-05-05 | Account: hnhotels1 | KYC: Completed*
