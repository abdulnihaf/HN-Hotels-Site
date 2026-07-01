// /api/comms-webhook — Meta WhatsApp inbound webhook
// Receives delivery receipts + inbound replies. Captures opt-in YES/NO into comms_optin
// and ack actions (RESOLVE/SNOOZE) into comms_outbox.
// Forwards everything else to brand site so existing whatsapp.js flows keep working.
//
// THE BRAIN (glasses path): a free-form question from the OWNER on the Sparksol
// line (the dedicated, no-customer-flow WABA) is routed to answerBrainQuery() —
// Claude reads live ops data and replies. This is how the Ray-Ban Meta glasses
// ask-and-hear loop works: dictated question in, spoken answer read aloud. Gated
// to OWNER_PHONE + sparksol, so it can never touch HE/NCH customer messaging.
// The webhook acks Meta IMMEDIATELY and thinks in the background (waitUntil) —
// a slow ack makes Meta redeliver and the answer would arrive twice.

import { answerBrainQuery } from './_lib/brain.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const text = (s, status = 200) =>
  new Response(s, { status, headers: { 'content-type': 'text/plain' } });

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

function brandFromPhoneId(env, phoneId) {
  if (phoneId === env.WA_NCH_PHONE_ID) return 'nch';
  if (phoneId === env.WA_HE_PHONE_ID || phoneId === env.WA_PHONE_ID) return 'he';
  if (phoneId === env.WA_SPARKSOL_PHONE_ID) return 'sparksol';
  return null;
}

function messageTimestampIso(m) {
  return m?.timestamp
    ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString()
    : new Date().toISOString();
}

function messageBody(m) {
  if (!m) return '';
  if (m.type === 'text') return m.text?.body || '';
  if (m.type === 'button') return m.button?.text || m.button?.payload || '';
  if (m.type === 'interactive') {
    return m.interactive?.button_reply?.title
      || m.interactive?.button_reply?.id
      || m.interactive?.list_reply?.title
      || m.interactive?.list_reply?.id
      || '[interactive]';
  }
  if (m.type === 'image') return m.image?.caption || '[image]';
  if (m.type === 'video') return m.video?.caption || '[video]';
  if (m.type === 'document') return m.document?.filename || m.document?.caption || '[document]';
  if (m.type === 'audio') return '[audio]';
  if (m.type === 'sticker') return '[sticker]';
  if (m.type === 'location') return `${m.location?.latitude || ''},${m.location?.longitude || ''}`;
  if (m.type === 'contacts') {
    const c = m.contacts?.[0];
    return c ? `${c.name?.formatted_name || 'Contact'} ${c.phones?.[0]?.phone || ''}`.trim() : '[contact]';
  }
  if (m.type === 'order') return '[cart/order]';
  return `[${m.type || 'message'}]`;
}

function messageMediaId(m) {
  return m?.image?.id || m?.video?.id || m?.audio?.id || m?.document?.id || m?.sticker?.id || null;
}

function contactName(value, waId) {
  const contact = (value?.contacts || []).find(c => c.wa_id === waId) || value?.contacts?.[0];
  return contact?.profile?.name || '';
}

function serviceWindowExpiresAt(inboundIso) {
  const t = new Date(inboundIso).getTime();
  return Number.isFinite(t) ? new Date(t + 24 * 60 * 60 * 1000).toISOString() : null;
}

async function persistCommsWebhookEvent(env, { brand, phone_number_id, event_kind, wa_id, message_id, raw_json }) {
  try {
    await env.DB.prepare(`
      INSERT INTO comms_webhook_events
        (brand, phone_number_id, event_kind, wa_id, message_id, raw_json, processed)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(
      brand || null,
      phone_number_id || null,
      event_kind || 'other',
      wa_id || null,
      message_id || null,
      JSON.stringify(raw_json || {}).slice(0, 20000),
    ).run();
  } catch (e) {
    console.error('persistCommsWebhookEvent failed:', e?.message || e);
  }
}

async function persistInboundCommsMessage(env, { value, message, payload, business_phone_id }) {
  const brand = brandFromPhoneId(env, business_phone_id);
  if (!brand || brand === 'sparksol' || !message?.from) return;

  const phone = normalizePhone(message.from);
  const threadId = `${brand}:${phone}`;
  const createdAt = messageTimestampIso(message);
  const body = messageBody(message);
  const mediaId = messageMediaId(message);
  const msgType = message.type || 'text';
  const wamid = message.id || null;

  await persistCommsWebhookEvent(env, {
    brand,
    phone_number_id: business_phone_id,
    event_kind: 'message',
    wa_id: phone,
    message_id: wamid,
    raw_json: payload,
  });

  try {
    const inserted = await env.DB.prepare(`
      INSERT OR IGNORE INTO comms_messages
        (thread_id, brand, phone, direction, msg_type, body, wamid, status,
         media_id, raw_payload, created_at)
      VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'unread', ?, ?, ?)
      RETURNING id
    `).bind(
      threadId,
      brand,
      phone,
      msgType,
      body,
      wamid,
      mediaId,
      JSON.stringify(message).slice(0, 10000),
      createdAt,
    ).first();

    if (!inserted?.id) return;

    await env.DB.prepare(`
      INSERT INTO comms_threads
        (thread_id, brand, phone, wa_id, phone_number_id, display_name, status,
         last_message_at, last_inbound_at, last_body, last_direction, last_msg_type,
         unread_count, service_window_expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 'inbound', ?, 1, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
         phone_number_id = excluded.phone_number_id,
         display_name = COALESCE(NULLIF(excluded.display_name, ''), comms_threads.display_name),
         status = CASE WHEN comms_threads.status = 'closed' THEN 'open' ELSE comms_threads.status END,
         last_message_at = excluded.last_message_at,
         last_inbound_at = excluded.last_inbound_at,
         last_body = excluded.last_body,
         last_direction = 'inbound',
         last_msg_type = excluded.last_msg_type,
         unread_count = comms_threads.unread_count + 1,
         service_window_expires_at = excluded.service_window_expires_at,
         updated_at = excluded.updated_at
    `).bind(
      threadId,
      brand,
      phone,
      phone,
      business_phone_id || null,
      contactName(value, message.from),
      createdAt,
      createdAt,
      body.slice(0, 500),
      msgType,
      serviceWindowExpiresAt(createdAt),
      new Date().toISOString(),
    ).run();
  } catch (e) {
    console.error('persistInboundCommsMessage failed:', e?.message || e);
  }
}

async function mirrorCommsStatus(env, { value, status, payload, business_phone_id }) {
  const brand = brandFromPhoneId(env, business_phone_id);
  if (!brand || brand === 'sparksol') return;
  const wamid = status?.id || null;
  const phone = normalizePhone(status?.recipient_id || '');
  await persistCommsWebhookEvent(env, {
    brand,
    phone_number_id: business_phone_id,
    event_kind: 'status',
    wa_id: phone,
    message_id: wamid,
    raw_json: payload,
  });
  if (!wamid) return;
  try {
    await env.DB.prepare(`
      UPDATE comms_messages
         SET status = ?,
             provider_response = ?
       WHERE wamid = ?
    `).bind(
      status?.status || 'status',
      JSON.stringify(status || value || {}).slice(0, 4000),
      wamid,
    ).run();
  } catch (e) {
    console.error('mirrorCommsStatus failed:', e?.message || e);
  }
}

const YES_RX = /^\s*(yes|y|ok|okay|haan|han|haa|sure|confirm|confirmed|consent|agree|agreed|haa\.?)\s*\.?\s*$/i;
const NO_RX  = /^\s*(no|n|stop|nahi|nahin|opt[\s_-]?out|cancel|unsubscribe)\s*\.?\s*$/i;
const ACK_RX = /^\s*(resolved?|done|fixed|cleared|ack(nowledge)?d?|✅)\s*\.?\s*$/i;
const SNOOZE_RX = /^\s*(snooze|later|busy|wait|hold)\s*\.?\s*$/i;

async function handleInboundMessage(env, { from_phone, msg_text, msg_id, business_phone_id, originBase, waitUntil }) {
  const recipient = normalizePhone(from_phone);

  // Determine brand by which business phone the message came in to.
  // Sparksol is the dedicated comms WABA for staff alerts.
  let brand = 'sparksol';
  if (business_phone_id === env.WA_SPARKSOL_PHONE_ID) brand = 'sparksol';
  else if (business_phone_id === env.WA_NCH_PHONE_ID) brand = 'nch';
  else if (business_phone_id === env.WA_HE_PHONE_ID) brand = 'he';

  const body = (msg_text || '').trim();

  // 0. HR button payload routing — quick-reply buttons send payload like
  //    "absence_resp|<token>|<status>". When tapped, we mark ALL comms_outbox
  //    rows for that alert_id as acked (so the escalation cron doesn't fire SMS
  //    fallback) AND we update hr_absence_alerts via the existing handler.
  const hrAbsence = body.match(/^absence_resp\|([a-f0-9]{16,40})\|(\w+)/i);
  const hrGhost   = body.match(/^ghost_resp\|([a-f0-9]{16,40})/i);
  if (hrAbsence || hrGhost) {
    const token = (hrAbsence || hrGhost)[1];
    const alertIdPrefix = hrAbsence ? `hr_absence:${token}` : `hr_ghost:${token}`;
    // Stop the escalation chain immediately
    await env.DB.prepare(`
      UPDATE comms_outbox
         SET acked_at = datetime('now'),
             ack_action = 'responded',
             ack_payload = ?,
             escalation_due_at = NULL
       WHERE alert_id = ? AND acked_at IS NULL
    `).bind(body, alertIdPrefix).run().catch(() => {});

    if (hrAbsence) {
      const respStatus = hrAbsence[2];
      // Forward to hr-automation handler (it will update hr_absence_alerts + maybe archive)
      try {
        const fwdUrl = new URL('https://hnhotels.in/api/hr-automation');
        fwdUrl.searchParams.set('action', 'hr-absence-respond');
        fwdUrl.searchParams.set('token', token);
        fwdUrl.searchParams.set('status', respStatus);
        await fetch(fwdUrl.toString(), { method: 'GET' });
      } catch (e) {
        console.error('hr-absence forward failed:', e?.message || e);
      }
    }
    return { handled: hrAbsence ? 'hr-absence-button' : 'hr-ghost-button', token };
  }

  // 0.5 THE BRAIN — owner's free-form question on the Sparksol line → Claude.
  //     Sits BEFORE the opt-in flow on purpose: a pending opt-in row swallows
  //     ANY inbound as consent, which would eat a dictated question. Short
  //     control words (yes/no/stop/done/snooze) are excluded so opt-in and ack
  //     flows keep working for the owner too. Hard-gated to OWNER_PHONE +
  //     sparksol, so customer HE/NCH flows are untouched by construction.
  //     We ack Meta now and answer in the background — the brain takes seconds.
  const ownerPhone = env.OWNER_PHONE ? normalizePhone(env.OWNER_PHONE) : null;
  if (brand === 'sparksol' && ownerPhone && recipient === ownerPhone && body
      && !YES_RX.test(body) && !NO_RX.test(body) && !ACK_RX.test(body) && !SNOOZE_RX.test(body)) {
    const think = (async () => {
      try {
        const answer = await answerBrainQuery(env, { question: body, originBase });
        await sendSparksolText(env, recipient, answer);
      } catch (e) {
        console.error('brain failed:', e?.message || e);
        await sendSparksolText(env, recipient, `Brain hit an error: ${String(e?.message || e).slice(0, 150)}`);
      }
    })();
    if (waitUntil) waitUntil(think); else await think;
    return { handled: 'brain', recipient };
  }

  // 1. Opt-in flow: pending row exists for this phone?
  const pendingOptin = await env.DB.prepare(`
    SELECT id, status FROM comms_optin
     WHERE phone = ? AND brand = ? AND channel = 'waba'
     LIMIT 1
  `).bind(recipient, brand).first();

  if (pendingOptin && pendingOptin.status === 'pending') {
    // Inbound-first opt-in: ANY message that isn't an explicit STOP/NO/REVOKE
    // counts as consent. If they messaged us, they opted in.
    if (NO_RX.test(body)) {
      await env.DB.prepare(`
        UPDATE comms_optin
           SET status = 'opted_out',
               consented_at = datetime('now'),
               consent_text = ?
         WHERE id = ?
      `).bind(body, pendingOptin.id).run();
      return { handled: 'optin-no', recipient, brand };
    }
    // Otherwise: opt them in (anything else = consent)
    await env.DB.prepare(`
      UPDATE comms_optin
         SET status = 'opted_in',
             consented_at = datetime('now'),
             consent_text = ?
       WHERE id = ?
    `).bind(body, pendingOptin.id).run();
    // Auto-reply welcome (free-form, allowed within 24h window opened by their inbound)
    await sendWelcomeReply(env, recipient, brand, pendingOptin.staff_name || '');
    return { handled: 'optin-auto', recipient, brand };
  }

  // 2. Already opted-in users can revoke any time via STOP / NO
  if (pendingOptin && pendingOptin.status === 'opted_in' && NO_RX.test(body)) {
    await env.DB.prepare(`
      UPDATE comms_optin
         SET status = 'opted_out',
             revoked_at = datetime('now'),
             consent_text = ?
       WHERE id = ?
    `).bind(body, pendingOptin.id).run();
    return { handled: 'optout-revoke', recipient, brand };
  }

  // 3. Ack flow: most recent unack'd outbox row to this phone in last 24h
  const recentOutbox = await env.DB.prepare(`
    SELECT id FROM comms_outbox
     WHERE recipient_phone = ?
       AND acked_at IS NULL
       AND status IN ('sent', 'delivered', 'read')
       AND datetime(created_at) > datetime('now', '-24 hours')
     ORDER BY id DESC LIMIT 1
  `).bind(recipient).first();

  if (recentOutbox) {
    if (ACK_RX.test(body)) {
      await env.DB.prepare(`
        UPDATE comms_outbox
           SET acked_at = datetime('now'), ack_action = 'resolved', ack_payload = ?
         WHERE id = ?
      `).bind(body, recentOutbox.id).run();
      return { handled: 'ack-resolved', outbox_id: recentOutbox.id };
    }
    if (SNOOZE_RX.test(body)) {
      await env.DB.prepare(`
        UPDATE comms_outbox
           SET acked_at = datetime('now'), ack_action = 'snooze', ack_payload = ?
         WHERE id = ?
      `).bind(body, recentOutbox.id).run();
      return { handled: 'ack-snooze', outbox_id: recentOutbox.id };
    }
  }

  return { handled: 'none' };
}

// Free-form text out on the Sparksol line. Used by the brain to speak its answer
// back. Allowed because the owner just messaged us (24h window is open).
async function sendSparksolText(env, to, body) {
  const phoneId = env.WA_SPARKSOL_PHONE_ID;
  const token   = env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN;
  if (!phoneId || !token) { console.error('sendSparksolText: missing sparksol creds'); return; }
  try {
    await fetch(`https://graph.facebook.com/v24.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
  } catch (e) {
    console.error('sendSparksolText failed:', e?.message || e);
  }
}

async function sendWelcomeReply(env, to, brand, staffName) {
  // Free-form text message inside the 24h window — works only because user just messaged us.
  const phoneId = brand === 'sparksol' ? env.WA_SPARKSOL_PHONE_ID : env.WA_HE_PHONE_ID;
  const token = brand === 'sparksol' ? env.WA_SPARKSOL_TOKEN : (env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN);
  if (!phoneId || !token) return;
  const greeting = staffName ? `Hi ${staffName}!` : 'Hi!';
  const body = `${greeting} You're now subscribed to HN Hotels Ops alerts via WhatsApp.\n\nFrom now on you'll receive shift alerts, settlement reminders, and discrepancy notifications here.\n\nReply STOP anytime to opt out.`;
  try {
    const res = await fetch(`https://graph.facebook.com/v24.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    const respText = await res.text();
    let respJson = null;
    try { respJson = JSON.parse(respText); } catch {}
    const wamid = respJson?.messages?.[0]?.id || null;
    // Log to outbox for audit trail
    await env.DB.prepare(`
      INSERT INTO comms_outbox
        (alert_id, tier, brand, channel, recipient_phone, body_text, status, provider_msg_id, sent_at)
      VALUES (?, 'optin-welcome', ?, 'waba', ?, ?, ?, ?, datetime('now'))
    `).bind('optin-welcome', brand, to, body, res.ok ? 'sent' : 'failed', wamid).run();
  } catch (e) {
    console.error('sendWelcomeReply failed:', e?.message || e);
  }
}

async function handleStatusUpdate(env, { msg_id, status, ts }) {
  // Update outbox delivery state from Meta status callback
  const tsIso = ts ? new Date(parseInt(ts, 10) * 1000).toISOString() : new Date().toISOString();
  if (status === 'delivered') {
    await env.DB.prepare(`
      UPDATE comms_outbox SET status = 'delivered', delivered_at = ?
       WHERE provider_msg_id = ? AND delivered_at IS NULL
    `).bind(tsIso, msg_id).run();
  } else if (status === 'read') {
    await env.DB.prepare(`
      UPDATE comms_outbox SET status = 'read', read_at = ?
       WHERE provider_msg_id = ? AND read_at IS NULL
    `).bind(tsIso, msg_id).run();
  } else if (status === 'failed') {
    await env.DB.prepare(`
      UPDATE comms_outbox SET status = 'failed'
       WHERE provider_msg_id = ?
    `).bind(msg_id).run();
  }
}

async function forwardToBrand(env, brand, payload) {
  // Sparksol has no customer flow — never forward.
  if (brand === 'sparksol') return;
  // Forward unhandled inbound to existing brand whatsapp.js so customer order flow keeps working.
  const url =
    brand === 'nch' ? 'https://nawabichaihouse.com/api/whatsapp'
    : 'https://hamzaexpress.in/api/whatsapp';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-by': 'hn-comms-webhook' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Don't fail webhook if forward fails — Meta will retry, that's worse
    console.error('forwardToBrand failed:', e?.message || e);
  }
}

// ─── Exotel voice helpers ───────────────────────────────────────────────────

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function exoMlResponse(messageText, alertId) {
  // ExoML: speak the alert, then gather a single DTMF digit (1=resolved, 2=snooze).
  const dtmfUrl = new URL('https://hnhotels.in/api/comms-webhook');
  dtmfUrl.searchParams.set('action', 'exotel-dtmf');
  if (alertId) dtmfUrl.searchParams.set('alert_id', alertId);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-IN">${escapeXml(messageText)}</Say>
  <Gather numDigits="1" action="${escapeXml(dtmfUrl.toString())}" method="POST" timeout="10">
    <Say voice="en-IN">Press 1 to acknowledge. Press 2 to snooze for 30 minutes.</Say>
  </Gather>
  <Say voice="en-IN">No input received. Goodbye.</Say>
</Response>`;
  return new Response(xml, { headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

async function handleExotelDtmf(env, { url, request }) {
  // Exotel posts DTMF as form-urlencoded (Digits=1) OR query params depending on flow.
  const alertId = url.searchParams.get('alert_id') || '';
  let digits = url.searchParams.get('Digits') || '';
  let callSid = url.searchParams.get('CallSid') || '';

  if (!digits || !callSid) {
    try {
      const ctype = request.headers.get('content-type') || '';
      if (ctype.includes('application/x-www-form-urlencoded')) {
        const form = await request.formData();
        digits = digits || form.get('Digits') || '';
        callSid = callSid || form.get('CallSid') || '';
      } else if (ctype.includes('application/json')) {
        const j = await request.json().catch(() => ({}));
        digits = digits || j?.Digits || '';
        callSid = callSid || j?.CallSid || '';
      }
    } catch {}
  }

  let action = null;
  if (digits === '1') action = 'resolved';
  else if (digits === '2') action = 'snooze';

  if (action) {
    // Prefer matching by CallSid, fall back to alert_id
    if (callSid) {
      await env.DB.prepare(`
        UPDATE comms_outbox
           SET acked_at = datetime('now'), ack_action = ?, ack_payload = ?
         WHERE provider_msg_id = ? AND channel = 'voice' AND acked_at IS NULL
      `).bind(action, digits, callSid).run();
    } else if (alertId) {
      await env.DB.prepare(`
        UPDATE comms_outbox
           SET acked_at = datetime('now'), ack_action = ?, ack_payload = ?
         WHERE alert_id = ? AND channel = 'voice' AND acked_at IS NULL
      `).bind(action, digits, alertId).run();
    }
  }

  // Acknowledge to caller
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-IN">${action === 'resolved' ? 'Acknowledged. Thank you.' : action === 'snooze' ? 'Snoozed for thirty minutes.' : 'Invalid input. Goodbye.'}</Say>
</Response>`;
  return new Response(xml, { headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

async function handleExotelStatus(env, { url, request }) {
  // Exotel posts status callback when the call reaches a terminal state.
  const alertId = url.searchParams.get('alert_id') || '';
  let callSid = url.searchParams.get('CallSid') || '';
  let callStatus = url.searchParams.get('Status') || url.searchParams.get('CallStatus') || '';
  let recordingUrl = url.searchParams.get('RecordingUrl') || '';

  if (!callSid || !callStatus) {
    try {
      const ctype = request.headers.get('content-type') || '';
      if (ctype.includes('application/x-www-form-urlencoded')) {
        const form = await request.formData();
        callSid = callSid || form.get('CallSid') || '';
        callStatus = callStatus || form.get('Status') || form.get('CallStatus') || '';
        recordingUrl = recordingUrl || form.get('RecordingUrl') || '';
      } else if (ctype.includes('application/json')) {
        const j = await request.json().catch(() => ({}));
        callSid = callSid || j?.CallSid || '';
        callStatus = callStatus || j?.Status || j?.CallStatus || '';
        recordingUrl = recordingUrl || j?.RecordingUrl || '';
      }
    } catch {}
  }

  if (!callSid) return json({ ok: false, reason: 'no CallSid' }, 200);

  const s = String(callStatus).toLowerCase();
  if (s === 'completed') {
    await env.DB.prepare(`
      UPDATE comms_outbox SET status = 'delivered', delivered_at = datetime('now')
       WHERE provider_msg_id = ? AND channel = 'voice' AND delivered_at IS NULL
    `).bind(callSid).run();
  } else if (s === 'no-answer' || s === 'busy' || s === 'failed' || s === 'canceled') {
    await env.DB.prepare(`
      UPDATE comms_outbox SET status = 'failed', error_text = ?
       WHERE provider_msg_id = ? AND channel = 'voice'
    `).bind(`call ${s}`, callSid).run();
  }
  return json({ ok: true, alert_id: alertId, call_sid: callSid, status: s });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // ─── Exotel hooks ─────────────────────────────────────────────────────────
  if (action === 'exotel-tts') {
    // Exotel fetches this to play TTS + gather DTMF. Must return ExoML XML.
    // P1-9 fix: verify the HMAC sig that sendVoice (comms-core) embeds in the URL.
    // Without a valid sig, serve silent ExoML so Exotel doesn't speak attacker text.
    const messageText = url.searchParams.get('text') || 'HN Hotels alert.';
    const alertId = url.searchParams.get('alert_id') || '';
    // P1-9: when DASHBOARD_KEY is configured, a valid HMAC sig is REQUIRED.
    // No sig (or wrong sig) = silent ExoML, never speak attacker-controlled text.
    // Degrades gracefully only when DASHBOARD_KEY is not configured (not the case in prod).
    if (env.DASHBOARD_KEY) {
      const sig = url.searchParams.get('sig') || '';
      const SILENT = new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, { headers: { 'content-type': 'application/xml' } });
      if (!sig) return SILENT;
      const enc = new TextEncoder();
      const k = await crypto.subtle.importKey('raw', enc.encode(env.DASHBOARD_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expected = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`exotel-tts:${messageText}:${alertId}`)));
      let expB64 = ''; for (const b of expected) expB64 += String.fromCharCode(b);
      expB64 = btoa(expB64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (sig !== expB64) return SILENT;
    }
    return exoMlResponse(messageText, alertId);
  }
  if (action === 'exotel-dtmf') {
    return await handleExotelDtmf(env, { url, request });
  }
  if (action === 'exotel-status') {
    return await handleExotelStatus(env, { url, request });
  }

  // Meta webhook verification (GET)
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const verifyToken = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && verifyToken === env.WA_VERIFY_TOKEN) {
      return text(challenge || '');
    }
    return text('forbidden', 403);
  }

  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  // Iterate Meta webhook structure: entry[].changes[].value
  const entries = payload?.entry || [];
  const handled = [];
  let anyMessageInbound = false;
  let inferredBrand = null;

  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const value = change?.value || {};
      const business_phone_id = value?.metadata?.phone_number_id;
      if (business_phone_id === env.WA_NCH_PHONE_ID) inferredBrand = 'nch';
      else if (business_phone_id === env.WA_HE_PHONE_ID) inferredBrand = 'he';

      // Status callbacks (sent/delivered/read/failed)
      const statuses = value?.statuses || [];
      for (const s of statuses) {
        await handleStatusUpdate(env, { msg_id: s?.id, status: s?.status, ts: s?.timestamp });
        await mirrorCommsStatus(env, { value, status: s, payload, business_phone_id });
        handled.push({ type: 'status', id: s?.id, status: s?.status });
      }

      // Inbound user messages
      const messages = value?.messages || [];
      for (const m of messages) {
        anyMessageInbound = true;
        const from_phone = m?.from;
        const msg_id = m?.id;
        // Text messages, button replies, interactive replies — extract text
        let msg_text = m?.text?.body
          || m?.button?.text
          || m?.interactive?.button_reply?.title
          || m?.interactive?.list_reply?.title
          || '';
        await persistInboundCommsMessage(env, { value, message: m, payload, business_phone_id });
        const result = await handleInboundMessage(env, {
          from_phone, msg_text, msg_id, business_phone_id,
          originBase: `${url.protocol}//${url.host}`,
          waitUntil: (p) => context.waitUntil(p),
        });
        handled.push({ type: 'message', from: from_phone, ...result });
      }
    }
  }

  // Forward to existing brand handler so customer order flow keeps working.
  // Only forward if there were inbound messages (not just status callbacks).
  if (anyMessageInbound && inferredBrand) {
    await forwardToBrand(env, inferredBrand, payload);
  }

  return json({ ok: true, handled });
}
