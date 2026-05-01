# Comms — Opt-In Runbook (HE WABA only, May 1 cutover)

## Status as of 2026-04-30

| Channel | Status | Notes |
|---|---|---|
| Fast2SMS | ✅ ready | Wallet ₹50, route `q` transactional. DLT pending. |
| HE WABA | ✅ ready | Phone +91 80080 02049, GREEN quality, token in xlsx R8 |
| NCH WABA | ⏳ Path C in progress | Token to be extracted from `nawabi-chai-house-sit` worker via bridge |
| Voice (Exotel) | ⬜ next phase | After May 1 cutover |

## Opt-in flow architecture

```
[ /ops/comms-optin or API direct ]
        ↓ POST /api/comms?action=optin-send { brand, phone, staff_name, staff_role }
[ comms_optin row created status=pending ]
        ↓ Meta Cloud API send template
[ Staff phone receives WhatsApp template ]
        ↓ User replies YES / NO / STOP
[ Meta webhook → /api/comms-webhook ]
        ↓ regex match
[ comms_optin status flipped to opted_in / opted_out ]
        ↓ logged with consent_text + consented_at
[ Future alerts only sent to opted_in phones ]
```

## What you need to do in Meta Business Manager

### 1. Register opt-in template (one-time, ~minutes)

Go to [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates) → select WABA "Hamza Express" → **Create Template**

| Field | Value |
|---|---|
| **Name** | `staff_optin_v1` |
| **Category** | Utility |
| **Language** | English |
| **Header** | None |
| **Body** | `Hi {{1}}, this is HN Hotels Ops. To receive shift alerts, settlement reminders, and discrepancy notifications via WhatsApp, please reply YES. Reply STOP anytime to opt out.` |
| **Footer** | `HN Hotels Pvt Ltd` |
| **Buttons** | (optional) Quick Replies: "YES", "STOP" |
| **Sample value for {{1}}** | `Mainuddin` |

After approval (usually <30 min), set:
```bash
printf '%s' 'staff_optin_v1' | npx wrangler pages secret put WA_OPTIN_TEMPLATE --project-name hn-hotels-site
```

Until then, the worker uses Meta's default `hello_world` template (works for testing without registration).

### 2. Update Meta webhook URL (one-time)

Currently HE webhook → `https://hamzaexpress.in/api/whatsapp`. We need it to also flow into `https://hnhotels.in/api/comms-webhook` so opt-in replies + alert acks land in the central DB.

**Option A (recommended):** point Meta webhook to `hnhotels.in/api/comms-webhook`. The new webhook auto-forwards inbound user messages back to `hamzaexpress.in/api/whatsapp` so the existing customer order flow keeps working unchanged.

Steps:
1. [business.facebook.com/wa/manage/configuration](https://business.facebook.com/wa/manage/configuration) → HE WABA → **Webhook**
2. Callback URL → `https://hnhotels.in/api/comms-webhook`
3. Verify token → use the value of `WA_VERIFY_TOKEN` already set on `hn-hotels-site`
4. Subscribe to fields: `messages`, `message_status`

**Option B:** add opt-in capture inline in `hamzaexpress.in/api/whatsapp.js`. Less clean — splits comms logic across two repos.

### 3. Register the 12 alert templates (after `staff_optin_v1` approves)

Use the bodies in `docs/MAY1-AUTOMATION-FIGJAM.html` §6 → register via the same Meta templates UI.

## Sending the first opt-in (test today, before template approval)

```bash
# Test send to your own number using Meta's default template
curl -X POST https://hnhotels.in/api/comms?action=optin-send \
  -H "x-dashboard-key: $DASHBOARD_KEY" \
  -H "content-type: application/json" \
  -d '{"brand":"he","phone":"<your-10-digit-number>","staff_name":"Nihaf","staff_role":"owner","template":"hello_world"}'
```

You'll get the WhatsApp "Hello World" template. Reply "YES" — webhook fires, `comms_optin` row flips to `opted_in`. Verify:

```bash
curl "https://hnhotels.in/api/comms?action=list-optin" \
  -H "x-dashboard-key: $DASHBOARD_KEY"
```

## Bulk opt-in send to all active staff (May 1 prep)

After `staff_optin_v1` approves, pull active HE staff phones from `/api/hr-admin?action=list-active` and POST each phone:

```bash
# pseudo
for staff in $(curl ... /api/hr-admin?action=list-active); do
  curl -X POST .../api/comms?action=optin-send \
    -d "{\"brand\":\"he\",\"phone\":\"$phone\",\"staff_name\":\"$name\",\"staff_role\":\"$role\",\"template\":\"staff_optin_v1\",\"vars\":[\"$name\"]}"
done
```

I'll wrap this as `/api/comms?action=optin-bulk` once `hr-admin` returns the right shape.

## State to verify before May 1 cutover

- [ ] `staff_optin_v1` template approved in Meta
- [ ] Meta webhook pointed to `hnhotels.in/api/comms-webhook`
- [ ] At least one test opt-in (Nihaf number) shows `opted_in` in `comms_optin`
- [ ] All active HE staff opted in
- [ ] DLT registration done for Fast2SMS sender
- [ ] NCH WABA token extracted via Path C and set as `WA_NCH_TOKEN`
- [ ] All 12 utility templates registered + approved
