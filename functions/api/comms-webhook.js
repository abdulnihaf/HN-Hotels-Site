// /api/comms-webhook — Meta WhatsApp inbound webhook
// Receives delivery receipts + inbound replies. Captures opt-in YES/NO into comms_optin
// and ack actions (RESOLVE/SNOOZE) into comms_outbox.
// Forwards everything else to brand site so existing whatsapp.js flows keep working.

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

const YES_RX = /^\s*(yes|y|ok|okay|haan|han|haa|sure|confirm|confirmed|consent|agree|agreed|haa\.?)\s*\.?\s*$/i;
const NO_RX  = /^\s*(no|n|stop|nahi|nahin|opt[\s_-]?out|cancel|unsubscribe)\s*\.?\s*$/i;
const ACK_RX = /^\s*(resolved?|done|fixed|cleared|ack(nowledge)?d?|✅)\s*\.?\s*$/i;
const SNOOZE_RX = /^\s*(snooze|later|busy|wait|hold)\s*\.?\s*$/i;

async function handleInboundMessage(env, { from_phone, msg_text, msg_id, business_phone_id }) {
  const recipient = normalizePhone(from_phone);

  // Determine brand by which business phone the message came in to
  let brand = 'he';
  if (business_phone_id === env.WA_NCH_PHONE_ID) brand = 'nch';
  else if (business_phone_id === env.WA_HE_PHONE_ID) brand = 'he';

  const body = (msg_text || '').trim();

  // 1. Opt-in flow: pending row exists for this phone?
  const pendingOptin = await env.DB.prepare(`
    SELECT id, status FROM comms_optin
     WHERE phone = ? AND brand = ? AND channel = 'waba'
     LIMIT 1
  `).bind(recipient, brand).first();

  if (pendingOptin && pendingOptin.status === 'pending') {
    if (YES_RX.test(body)) {
      await env.DB.prepare(`
        UPDATE comms_optin
           SET status = 'opted_in',
               consented_at = datetime('now'),
               consent_text = ?
         WHERE id = ?
      `).bind(body, pendingOptin.id).run();
      return { handled: 'optin-yes', recipient, brand };
    }
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
