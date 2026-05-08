// /api/comms-webhook — inbound webhook hub
// Handles: Meta WhatsApp delivery receipts + replies, Exotel voice status + DTMF.
// Captures opt-in YES/NO into comms_optin, ack actions into comms_outbox.
// Forwards unhandled WhatsApp messages to brand site.

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

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const YES_RX = /^\s*(yes|y|ok|okay|haan|han|haa|sure|confirm|confirmed|consent|agree|agreed|haa\.?)\s*\.?\s*$/i;
const NO_RX  = /^\s*(no|n|stop|nahi|nahin|opt[\s_-]?out|cancel|unsubscribe)\s*\.?\s*$/i;
const ACK_RX = /^\s*(resolved?|done|fixed|cleared|ack(nowledge)?d?|✅)\s*\.?\s*$/i;
const SNOOZE_RX = /^\s*(snooze|later|busy|wait|hold)\s*\.?\s*$/i;

async function handleInboundMessage(env, { from_phone, msg_text, msg_id, business_phone_id }) {
  const recipient = normalizePhone(from_phone);

  // Determine brand by which business phone the message came in to.
  // Sparksol is the dedicated comms WABA for staff alerts.
  let brand = 'sparksol';
  if (business_phone_id === env.WA_SPARKSOL_PHONE_ID) brand = 'sparksol';
  else if (business_phone_id === env.WA_NCH_PHONE_ID) brand = 'nch';
  else if (business_phone_id === env.WA_HE_PHONE_ID) brand = 'he';

  const body = (msg_text || '').trim();

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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // ── Exotel: TTS call-flow (GET) ───────────────────────────────────────────
  // Exotel fetches this URL when an outbound call connects; we return ExoML.
  if (action === 'exotel-tts') {
    const msgText = url.searchParams.get('text') || 'HN Hotels alert requires your attention.';
    const alertId = url.searchParams.get('alert_id') || '';
    const base = `${url.protocol}//${url.host}`;
    const dtmfUrl = `${base}/api/comms-webhook?action=exotel-dtmf&alert_id=${encodeURIComponent(alertId)}`;
    const exoml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="en-IN">${escapeXml(msgText)}</Say><Gather numDigits="1" action="${escapeXml(dtmfUrl)}" method="POST" timeout="10"><Say voice="en-IN">Press 1 to acknowledge. Press 2 to snooze for 30 minutes.</Say></Gather><Say voice="en-IN">No input received. Goodbye.</Say></Response>`;
    return new Response(exoml, { headers: { 'content-type': 'application/xml' } });
  }

  // ── Exotel: DTMF digit capture (POST) ─────────────────────────────────────
  // Exotel posts here after the Gather node captures a digit.
  if (action === 'exotel-dtmf' && request.method === 'POST') {
    let formData;
    try { formData = await request.formData(); } catch { return json({ error: 'invalid form' }, 400); }
    const digit = formData.get('Digits') || formData.get('digit') || '';
    const callSid = formData.get('CallSid') || formData.get('Sid') || '';
    const alertId = url.searchParams.get('alert_id') || '';

    const row = callSid
      ? await env.DB.prepare(`SELECT id FROM comms_outbox WHERE provider_msg_id=? LIMIT 1`).bind(callSid).first()
      : alertId
        ? await env.DB.prepare(`SELECT id FROM comms_outbox WHERE alert_id=? AND channel='voice' ORDER BY id DESC LIMIT 1`).bind(alertId).first()
        : null;

    if (row && (digit === '1' || digit === '2')) {
      const ackAction = digit === '1' ? 'resolved' : 'snooze';
      await env.DB.prepare(
        `UPDATE comms_outbox SET acked_at=datetime('now'), ack_action=?, ack_payload=? WHERE id=?`
      ).bind(ackAction, digit, row.id).run();
    }

    const sayText = digit === '1' ? 'Acknowledged. Thank you.'
      : digit === '2' ? 'Snoozed for 30 minutes. We will call again if needed.'
      : 'Invalid input. Goodbye.';
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="en-IN">${escapeXml(sayText)}</Say><Hangup/></Response>`,
      { headers: { 'content-type': 'application/xml' } }
    );
  }

  // ── Exotel: call status callback (POST) ───────────────────────────────────
  // Exotel posts here when a call terminates (completed/no-answer/busy/failed).
  if (action === 'exotel-status' && request.method === 'POST') {
    let formData;
    try { formData = await request.formData(); } catch { return json({ ok: true }); }
    const callSid = formData.get('CallSid') || formData.get('Sid') || '';
    const status = (formData.get('Status') || formData.get('DialCallStatus') || '').toLowerCase();
    if (callSid && status) {
      if (status === 'completed') {
        await env.DB.prepare(
          `UPDATE comms_outbox SET status='delivered', delivered_at=datetime('now') WHERE provider_msg_id=? AND delivered_at IS NULL`
        ).bind(callSid).run();
      } else if (['no-answer', 'busy', 'failed', 'cancelled'].includes(status)) {
        await env.DB.prepare(
          `UPDATE comms_outbox SET status='failed', error_text=? WHERE provider_msg_id=?`
        ).bind(status, callSid).run();
      }
    }
    return json({ ok: true });
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
        const result = await handleInboundMessage(env, {
          from_phone, msg_text, msg_id, business_phone_id,
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
