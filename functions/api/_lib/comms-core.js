// /api/_lib/comms-core.js
// Shared send primitives for the HN comms hub.
// Both /api/comms.js (public hub) and /api/hr-automation.js (internal) import from here.
// Single source of truth for: WABA send, SMS send, Exotel voice trigger, comms_outbox logging.
//
// Design rule: NEVER call Meta/Fast2SMS/Exotel APIs from anywhere except this module.
// If a new caller needs to send a message, it imports `sendWaba` / `sendSms` / `sendVoice` here.

const META_GRAPH_VERSION = 'v24.0';
const FAST2SMS_BASE = 'https://www.fast2sms.com/dev/bulkV2';
const _enc = new TextEncoder();
async function hmac256(key, msg) {
  const k = await crypto.subtle.importKey('raw', _enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, _enc.encode(msg)));
}
function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ─── Phone helpers ──────────────────────────────────────────────────────────

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

// Exotel expects a leading 0 + 10 digits for India numbers (no country code).
function toExotelPhone(raw) {
  const n = normalizePhone(raw);
  return n.startsWith('91') ? '0' + n.slice(2) : '0' + n;
}

// ─── WABA send (Meta Cloud API) ─────────────────────────────────────────────

/**
 * Send a WABA template message.
 *
 * @param {object} env  Worker env
 * @param {object} opts
 * @param {string} opts.brand     'sparksol' (default for HR/staff) | 'he' | 'nch'
 * @param {string} opts.phone     E.164-ish, normalised internally
 * @param {string} opts.template  Approved template name
 * @param {string[]} [opts.vars]  Body parameter values, in order
 * @param {string} [opts.language] e.g. 'en' (default), 'hi'
 * @param {Array}  [opts.buttons] Optional template button params:
 *                                [{ sub_type: 'quick_reply', index: '0', payload: '...' }]
 *                                [{ sub_type: 'url',         index: '0', url_token: 'abc' }]
 * @returns {Promise<{ok, status, provider_msg_id, response}>}
 */
export async function sendWaba(env, { brand, phone, template, vars = [], language = 'en', buttons = [] }) {
  const b = brand || 'sparksol';
  const phoneId =
    b === 'sparksol' ? env.WA_SPARKSOL_PHONE_ID :
    b === 'nch'      ? env.WA_NCH_PHONE_ID :
    b === 'he'       ? env.WA_HE_PHONE_ID  :
    env.WA_SPARKSOL_PHONE_ID;
  const token =
    b === 'sparksol' ? (env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN) :
    b === 'nch'      ? (env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    b === 'he'       ? (env.WA_HE_TOKEN  || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    (env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN);

  if (!phoneId || !token) {
    return { ok: false, status: 500, response: { error: 'WABA not configured for brand: ' + b } };
  }

  const to = normalizePhone(phone);
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;

  const components = [];
  if (Array.isArray(vars) && vars.length > 0) {
    components.push({
      type: 'body',
      parameters: vars.map(v => ({ type: 'text', text: String(v) })),
    });
  }
  for (const btn of (buttons || [])) {
    if (btn.sub_type === 'url') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: String(btn.index ?? 0),
        parameters: [{ type: 'text', text: String(btn.url_token ?? '') }],
      });
    } else {
      // default to quick_reply
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(btn.index ?? 0),
        parameters: [{ type: 'payload', payload: String(btn.payload ?? '') }],
      });
    }
  }

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: template, language: { code: language }, components },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(txt); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.messages?.[0]?.id || null,
    response: respJson || txt,
  };
}

// ─── Free-form text (only valid inside an open 24h customer-service window) ─

export async function sendWabaText(env, { brand, phone, body }) {
  const b = brand || 'sparksol';
  const phoneId =
    b === 'sparksol' ? env.WA_SPARKSOL_PHONE_ID :
    b === 'nch'      ? env.WA_NCH_PHONE_ID :
    b === 'he'       ? env.WA_HE_PHONE_ID  :
    env.WA_SPARKSOL_PHONE_ID;
  const token =
    b === 'sparksol' ? (env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN) :
    (env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN);
  if (!phoneId || !token) {
    return { ok: false, status: 500, response: { error: 'WABA not configured for brand: ' + b } };
  }
  const to = normalizePhone(phone);
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  const txt = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(txt); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.messages?.[0]?.id || null,
    response: respJson || txt,
  };
}

// ─── SMS send ───────────────────────────────────────────────────────────────
// Two paths:
//   - 'q' (quick-transactional, Fast2SMS branded sender): no DLT compliance, used for non-PE messages
//   - 'dlt' (BSNL-DLT registered): requires sender_id (e.g. HNHTLS) + DLT template_id (BL entity)
// Provider switch (env.SMS_PROVIDER): 'fast2sms' (default) | 'bsnl'
// For BSNL direct gateway, set BSNL_DLT_API_URL + BSNL_DLT_TOKEN secrets.

export async function sendSms(env, { phone, message, route = 'q', sender_id, message_id }) {
  const provider = (env.SMS_PROVIDER || 'fast2sms').toLowerCase();
  if (provider === 'bsnl' && route === 'dlt') return sendBsnlDltSms(env, { phone, message, sender_id, message_id });
  return sendFast2SmsSms(env, { phone, message, route, sender_id, message_id });
}

async function sendFast2SmsSms(env, { phone, message, route = 'q', sender_id, message_id }) {
  if (!env.FAST2SMS_API_KEY) {
    return { ok: false, status: 500, response: { error: 'FAST2SMS_API_KEY not set' } };
  }
  const to = normalizePhone(phone).replace(/^91/, '');
  const url = new URL(FAST2SMS_BASE);
  url.searchParams.set('authorization', env.FAST2SMS_API_KEY);
  url.searchParams.set('numbers', to);
  url.searchParams.set('message', message);
  url.searchParams.set('flash', '0');
  if (route === 'dlt' || route === 'dlt_manual') {
    // PROVEN Fast2SMS DLT path (verified live 2026-05-27, request_ids SpRV8lZgwplwEWQ / S1M1ZfVcRhUOjSU):
    //   route=dlt_manual · sender_id=HNHTLS · entity_id=<PE 19-digit> · template_id=<DLT content id> · message=<rendered, fixed parts MUST match approved template incl \n\n>
    // The inbound param is named `message_id` (carries the DLT content template id from lookupDltTemplate);
    // Fast2SMS dlt_manual expects it as `template_id`. No Fast2SMS-side template add is needed for dlt_manual.
    if (!sender_id) return { ok: false, status: 400, response: { error: 'sender_id required for DLT route' } };
    if (!message_id) return { ok: false, status: 400, response: { error: 'template_id (message_id) required for DLT route' } };
    url.searchParams.set('route', 'dlt_manual');
    url.searchParams.set('sender_id', sender_id);
    url.searchParams.set('entity_id', env.FAST2SMS_ENTITY_ID || '1401667060000079296');
    url.searchParams.set('template_id', message_id);
  } else {
    url.searchParams.set('route', route);
  }

  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(txt); } catch {}
  return {
    ok: res.ok && (respJson?.return === true),
    status: res.status,
    provider_msg_id: respJson?.request_id ? String(respJson.request_id) : null,
    response: respJson || txt,
  };
}

// BSNL DLT direct-gateway path. Endpoint shape varies by aggregator BSNL gives you;
// adjust BSNL_DLT_API_URL request body shape here when activated.
async function sendBsnlDltSms(env, { phone, message, sender_id, message_id }) {
  if (!env.BSNL_DLT_API_URL || !env.BSNL_DLT_TOKEN) {
    return { ok: false, status: 500, response: { error: 'BSNL_DLT_API_URL / BSNL_DLT_TOKEN not set' } };
  }
  if (!sender_id || !message_id) {
    return { ok: false, status: 400, response: { error: 'sender_id and message_id required for BSNL DLT' } };
  }
  const to = normalizePhone(phone);
  const res = await fetch(env.BSNL_DLT_API_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BSNL_DLT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      entity_id: env.BSNL_DLT_ENTITY_ID || '1401667060000079296',
      header: sender_id,
      template_id: message_id,
      to,
      body: message,
    }),
  });
  const txt = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(txt); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.message_id || respJson?.id || null,
    response: respJson || txt,
  };
}

// ─── DLT template lookup + render ───────────────────────────────────────────
//
// Maps a logical template name (e.g. 'hr_absence_inquiry_v1') to the registered
// BSNL DLT template body + IDs. Renders {#var#} placeholders in order.
// Returns null if the template isn't approved yet — callers should handle gracefully.

export async function lookupDltTemplate(env, templateName, vars = []) {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM dlt_templates WHERE template_name = ? LIMIT 1`
    ).bind(templateName).first();
    if (!row) return null;
    if (row.status !== 'approved') return { ...row, message: null, ready: false };
    if (!row.dlt_template_id || row.dlt_template_id === 'TBD') return { ...row, message: null, ready: false };

    // Render {#var#} placeholders in order
    let body = String(row.body_template || '');
    for (const v of vars) body = body.replace('{#var#}', String(v ?? ''));

    return {
      ready: true,
      message: body,
      sender_id: row.header,
      message_id: row.dlt_template_id,
      entity_id: row.entity_id,
      category: row.category,
    };
  } catch (e) {
    console.error('lookupDltTemplate failed:', e?.message || e);
    return null;
  }
}

// ─── Voice send (Exotel ConnectApp + ExoML callback) ────────────────────────

/**
 * Trigger an outbound Exotel call. Exotel will fetch ExoML from
 *   /api/comms-webhook?action=exotel-tts&text=<msg>&alert_id=<id>
 * which speaks the message and gathers a single DTMF digit (1=resolved, 2=snooze).
 * DTMF digit posts back to /api/comms-webhook?action=exotel-dtmf&alert_id=<id>.
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.phone         recipient
 * @param {string} opts.message_text  spoken text (kept short — IVR will read this then prompt for DTMF)
 * @param {string} [opts.alert_id]    propagates to webhook so DTMF can be linked back
 */
export async function sendVoice(env, { phone, message_text, alert_id = '' }) {
  if (!env.EXOTEL_SID || !env.EXOTEL_API_KEY || !env.EXOTEL_API_TOKEN || !env.EXOTEL_CALLER_ID) {
    return { ok: false, status: 500, response: { error: 'Exotel not configured' } };
  }
  // Exotel app calls use From=recipient and Url=the ExoML app callback.
  // Do not send To here; To is for connect-two-number flows.
  const From = toExotelPhone(phone);
  const base = env.PUBLIC_BASE_URL || 'https://hnhotels.in';
  const ttsUrl = new URL(`${base}/api/comms-webhook`);
  ttsUrl.searchParams.set('action', 'exotel-tts');
  ttsUrl.searchParams.set('text', message_text || 'HN Hotels alert.');
  if (alert_id) ttsUrl.searchParams.set('alert_id', alert_id);
  // HMAC sig so comms-webhook can reject forged/spoofed TTS requests (P1-9 fix).
  // Signed over: action + text + alert_id (all the URL params an attacker can craft).
  if (env.DASHBOARD_KEY) {
    const sigPayload = `exotel-tts:${message_text || 'HN Hotels alert.'}:${alert_id}`;
    const sigBytes = await hmac256(env.DASHBOARD_KEY, sigPayload);
    ttsUrl.searchParams.set('sig', b64url(sigBytes));
  }

  const statusUrl = new URL(`${base}/api/comms-webhook`);
  statusUrl.searchParams.set('action', 'exotel-status');
  if (alert_id) statusUrl.searchParams.set('alert_id', alert_id);

  const exotelHost = env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
  const apiUrl = `https://${exotelHost}/v1/Accounts/${env.EXOTEL_SID}/Calls/connect.json`;
  const body = new URLSearchParams({
    From,
    CallerId: env.EXOTEL_CALLER_ID,
    CallType: 'trans',
    Url: ttsUrl.toString(),
    StatusCallback: statusUrl.toString(),
    TimeLimit: '60',
    TimeOut: '30',
    Record: 'false',
  });

  const auth = 'Basic ' + btoa(`${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}`);
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      authorization: auth,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const txt = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(txt); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.Call?.Sid || null,
    response: respJson || txt,
  };
}

// ─── comms_outbox logging ───────────────────────────────────────────────────

/**
 * Log a send attempt to comms_outbox. Single source of truth for ALL outbound messages.
 * Returns the inserted row id (so callers can correlate later updates).
 */
export async function logOutbox(env, row) {
  try {
    const r = await env.DB.prepare(`
      INSERT INTO comms_outbox
        (alert_id, tier, brand, channel, recipient_phone, template_name, template_vars,
         body_text, status, provider_msg_id, provider_response, error_text, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      row.alert_id || null,
      row.tier || 'info',
      row.brand || 'hq',
      row.channel,
      row.recipient_phone,
      row.template_name || null,
      row.template_vars ? JSON.stringify(row.template_vars) : null,
      row.body_text || null,
      row.status,
      row.provider_msg_id || null,
      row.provider_response ? JSON.stringify(row.provider_response) : null,
      row.error_text || null,
      row.sent_at || new Date().toISOString(),
    ).first();
    return r?.id || null;
  } catch (e) {
    console.error('logOutbox failed:', e?.message || e);
    return null;
  }
}

// ─── High-level helper: send + log in one call ──────────────────────────────

/**
 * One-call send-and-log. Returns { ok, status, provider_msg_id, outbox_id, response }.
 * Used by hr-automation.js and any future internal sender so the outbox stays canonical.
 *
 * @param {object} env
 * @param {object} opts
 * @param {'waba'|'sms'|'voice'} opts.channel
 * @param {string} opts.phone
 * @param {string} [opts.alert_id]
 * @param {string} [opts.tier]   'info'|'warn'|'critical'
 * @param {string} [opts.brand]  'sparksol' for HR (default)
 * Plus channel-specific fields:
 *   waba:  template, vars[], language, buttons[]
 *   sms:   message, route
 *   voice: message_text
 */
export async function sendAndLog(env, opts) {
  const {
    channel,
    phone,
    alert_id = null,
    tier = 'info',
    brand = 'sparksol',
    // waba
    template, vars = [], language = 'en', buttons = [],
    // sms
    message, route = 'q', sender_id, message_id,
    // voice
    message_text,
  } = opts;

  if (!channel || !phone) {
    return { ok: false, error: 'channel and phone required' };
  }
  const recipient = normalizePhone(phone);

  // ── Phone-verification guard ──────────────────────────────────────────────
  // If the resolved employee has phone_verification_pending=1, refuse the send.
  // This prevents a message from firing on an unconfirmed/wrong number.
  // We still log a 'skipped' row to comms_outbox so the no-send is auditable.
  if (env.DB) {
    try {
      const guardRow = await env.DB.prepare(
        `SELECT phone_verification_pending FROM hr_employees WHERE phone = ? AND phone_verification_pending = 1 LIMIT 1`
      ).bind(recipient).first();
      if (guardRow) {
        await logOutbox(env, {
          alert_id: opts.alert_id || null,
          tier: opts.tier || 'info',
          brand: opts.brand || 'sparksol',
          channel,
          recipient_phone: recipient,
          template_name: opts.template || null,
          template_vars: channel === 'waba' ? opts.vars : null,
          body_text: opts.message || opts.message_text || null,
          status: 'skipped',
          provider_msg_id: null,
          provider_response: { skipped: 'phone_verification_pending' },
          error_text: 'phone_verification_pending=1 — confirm number with employee first',
        });
        return { ok: false, skipped: 'phone_verification_pending', status: 'skipped' };
      }
    } catch (guardErr) {
      // Guard query failure must never block a legitimate send — log and continue.
      console.error('phone_verification_pending guard query failed:', guardErr?.message || guardErr);
    }
  }
  // ── End phone-verification guard ──────────────────────────────────────────

  let result, errText = null, status = 'pending';
  try {
    if (channel === 'waba') {
      if (!template) return { ok: false, error: 'template required for waba' };
      result = await sendWaba(env, { brand, phone: recipient, template, vars, language, buttons });
    } else if (channel === 'sms') {
      if (!message) return { ok: false, error: 'message required for sms' };
      result = await sendSms(env, { phone: recipient, message, route, sender_id, message_id });
    } else if (channel === 'voice') {
      if (!message_text) return { ok: false, error: 'message_text required for voice' };
      result = await sendVoice(env, { phone: recipient, message_text, alert_id });
    } else {
      return { ok: false, error: `unsupported channel: ${channel}` };
    }
    status = result.ok ? 'sent' : 'failed';
    if (!result.ok) {
      errText = typeof result.response === 'string'
        ? result.response
        : JSON.stringify(result.response);
    }
  } catch (err) {
    status = 'failed';
    errText = err?.message || String(err);
    result = { ok: false, status: 500, response: { error: errText } };
  }

  const outbox_id = await logOutbox(env, {
    alert_id, tier, brand, channel,
    recipient_phone: recipient,
    template_name: template || (channel === 'voice' ? 'voice_ivr' : null),
    template_vars: channel === 'waba' ? vars : null,
    body_text: message || message_text || null,
    status,
    provider_msg_id: result.provider_msg_id,
    provider_response: result.response,
    error_text: errText,
  });

  return {
    ok: result.ok,
    status,
    provider_msg_id: result.provider_msg_id,
    outbox_id,
    response: result.response,
  };
}

// ─── Multi-channel fallback orchestration ───────────────────────────────────
//
// Pattern: send via primary channel, schedule fallback to secondary if not
// acked/delivered within gap_minutes. Cron polls for expired escalations.
//
// Default chains (override via opts.chain):
//   HR alerts:  ['waba','sms']        — manager has WhatsApp; SMS if WABA fails/unread
//   Critical:   ['waba','sms','voice'] — owner-tier; voice if SMS goes unread too
//
// gap_minutes per channel: how long to wait for ack before escalating.
//
// Per-channel send opts are stored in payload_json on the first row (so the cron
// can rebuild context for fallback sends). Templates per channel are looked up
// at fallback time:
//   - waba: opts.template + opts.vars + opts.buttons (already passed in)
//   - sms : derived from dlt_templates row matching opts.template (same template_name)
//   - voice: derived by formatting opts.message_text or summarizing waba template

const DEFAULT_GAP_MINUTES = { waba: 30, sms: 60, voice: 0 };

/**
 * Send first channel + schedule fallback. Returns first send's result + outbox_id.
 *
 * @param {object} env
 * @param {object} opts  Same fields as sendAndLog plus:
 * @param {string[]} [opts.chain]         e.g. ['waba','sms','voice'] (default ['waba','sms'])
 * @param {object}   [opts.gap_minutes]   override per-channel wait (default DEFAULT_GAP_MINUTES)
 * @param {string}   [opts.fallback_message_text]  voice message if WABA template won't translate
 */
export async function sendWithFallback(env, opts) {
  const chain = (opts.chain && opts.chain.length) ? opts.chain : ['waba', 'sms'];
  const gaps = { ...DEFAULT_GAP_MINUTES, ...(opts.gap_minutes || {}) };
  const firstChannel = chain[0];
  const alert_id = opts.alert_id || null;

  // Channel-specific opts for the first send
  const sendOpts = {
    ...opts,
    channel: firstChannel,
  };
  const result = await sendAndLog(env, sendOpts);

  // Schedule next-channel fallback if there's another step in the chain
  const hasNext = chain.length > 1 && result.outbox_id;
  if (hasNext) {
    const dueAt = new Date(Date.now() + (gaps[firstChannel] || 30) * 60 * 1000).toISOString();
    // Persist chain + step + due_at + the original opts for cron rebuild
    const payload = {
      template: opts.template,
      vars: opts.vars,
      language: opts.language,
      buttons: opts.buttons,
      message: opts.message,
      message_text: opts.message_text,
      fallback_message_text: opts.fallback_message_text,
      brand: opts.brand,
      tier: opts.tier,
    };
    try {
      await env.DB.prepare(`
        UPDATE comms_outbox
           SET escalation_chain = ?, escalation_step = 0, escalation_due_at = ?,
               provider_response = COALESCE(provider_response, ?)
         WHERE id = ?
      `).bind(
        JSON.stringify(chain),
        dueAt,
        JSON.stringify({ original_opts: payload }),
        result.outbox_id,
      ).run();
    } catch (e) {
      console.error('sendWithFallback escalation persist failed:', e?.message || e);
    }
  }

  return { ...result, escalation_chain: chain, escalation_due_at: hasNext ? new Date(Date.now() + (gaps[firstChannel] || 30) * 60 * 1000).toISOString() : null };
}

/**
 * Cron-callable: scan comms_outbox for expired escalations and fire next channel.
 * Idempotent: clears escalation_due_at on the source row before sending so a
 * concurrent run won't double-fire.
 *
 * @returns {{ scanned, escalated, results }}
 */
export async function runEscalation(env, { limit = 50, gap_minutes = DEFAULT_GAP_MINUTES } = {}) {
  const due = await env.DB.prepare(`
    SELECT *
      FROM comms_outbox
     WHERE escalation_due_at IS NOT NULL
       AND escalation_due_at <= datetime('now')
       AND acked_at IS NULL
       AND status NOT IN ('responded', 'failed')
     ORDER BY escalation_due_at ASC
     LIMIT ?
  `).bind(limit).all();

  const rows = due.results || [];
  const results = [];
  for (const row of rows) {
    // Lock: clear escalation_due_at so this row won't be picked again
    await env.DB.prepare(
      `UPDATE comms_outbox SET escalation_due_at = NULL WHERE id = ?`
    ).bind(row.id).run();

    let chain = [];
    try { chain = JSON.parse(row.escalation_chain || '[]'); } catch {}
    const nextStep = (row.escalation_step ?? 0) + 1;
    const nextChannel = chain[nextStep];
    if (!nextChannel) {
      results.push({ outbox_id: row.id, action: 'chain_exhausted' });
      continue;
    }

    let origOpts = {};
    try {
      const pr = JSON.parse(row.provider_response || '{}');
      origOpts = pr.original_opts || {};
    } catch {}

    // Channel-specific dispatch via sendAndLog with same alert_id
    let attempt;
    try {
      if (nextChannel === 'sms') {
        // Look up DLT template matching the WABA template_name
        const tplName = origOpts.template || row.template_name;
        const dlt = await lookupDltTemplate(env, tplName, origOpts.vars || []);
        if (!dlt || !dlt.ready) {
          // DLT template not approved yet — try voice if next, else mark waiting
          results.push({ outbox_id: row.id, next_channel: 'sms', skipped: 'dlt_not_approved' });
          // Skip ahead to next-next channel if any
          const skipNextStep = nextStep + 1;
          const skipNextChannel = chain[skipNextStep];
          if (!skipNextChannel) continue;
          attempt = await dispatchEscalationStep(env, {
            row, origOpts, alert_id: row.alert_id, channel: skipNextChannel, step: skipNextStep, chain, gap_minutes,
          });
        } else {
          attempt = await sendAndLog(env, {
            channel: 'sms',
            phone: row.recipient_phone,
            alert_id: row.alert_id,
            tier: row.tier,
            brand: row.brand,
            message: dlt.message,
            route: 'dlt',
            sender_id: dlt.sender_id,
            message_id: dlt.message_id,
          });
          await scheduleNextEscalation(env, attempt.outbox_id, chain, nextStep, gap_minutes, origOpts);
        }
      } else if (nextChannel === 'voice') {
        const message_text = origOpts.fallback_message_text || origOpts.message_text || `HN Hotels alert: ${row.template_name || 'attention required'}.`;
        attempt = await sendAndLog(env, {
          channel: 'voice',
          phone: row.recipient_phone,
          alert_id: row.alert_id,
          tier: row.tier || 'critical',
          brand: row.brand,
          message_text,
        });
        await scheduleNextEscalation(env, attempt.outbox_id, chain, nextStep, gap_minutes, origOpts);
      } else if (nextChannel === 'waba') {
        // Edge case: chain starts with non-waba; not used today
        attempt = await sendAndLog(env, {
          channel: 'waba',
          phone: row.recipient_phone,
          alert_id: row.alert_id,
          tier: row.tier,
          brand: row.brand || 'sparksol',
          template: origOpts.template,
          vars: origOpts.vars,
          language: origOpts.language || 'en',
          buttons: origOpts.buttons,
        });
        await scheduleNextEscalation(env, attempt.outbox_id, chain, nextStep, gap_minutes, origOpts);
      }
      results.push({
        outbox_id: row.id,
        next_channel: nextChannel,
        ok: attempt?.ok ?? false,
        new_outbox_id: attempt?.outbox_id ?? null,
      });
    } catch (e) {
      results.push({ outbox_id: row.id, next_channel: nextChannel, error: e?.message || String(e) });
    }

    // Link new outbox row to parent for audit trail
    if (attempt?.outbox_id) {
      try {
        await env.DB.prepare(
          `UPDATE comms_outbox SET parent_outbox_id = ?, escalation_step = ?, escalation_chain = ? WHERE id = ?`
        ).bind(row.id, nextStep, JSON.stringify(chain), attempt.outbox_id).run();
      } catch {}
    }
  }

  return { scanned: rows.length, escalated: results.filter(r => r.ok).length, results };
}

async function dispatchEscalationStep(env, { row, origOpts, alert_id, channel, step, chain, gap_minutes }) {
  // Helper for the "skip-DLT-not-approved → next channel" path
  if (channel === 'voice') {
    const message_text = origOpts.fallback_message_text || origOpts.message_text || `HN Hotels alert.`;
    const r = await sendAndLog(env, {
      channel: 'voice', phone: row.recipient_phone, alert_id, tier: 'critical', brand: row.brand, message_text,
    });
    await scheduleNextEscalation(env, r.outbox_id, chain, step, gap_minutes, origOpts);
    return r;
  }
  return null;
}

async function scheduleNextEscalation(env, outboxId, chain, currentStep, gaps, origOpts) {
  if (!outboxId) return;
  const nextStep = currentStep + 1;
  if (!chain[nextStep]) return; // chain exhausted
  const channel = chain[currentStep];
  const dueAt = new Date(Date.now() + (gaps[channel] || 30) * 60 * 1000).toISOString();
  await env.DB.prepare(`
    UPDATE comms_outbox
       SET escalation_due_at = ?, escalation_chain = ?, escalation_step = ?,
           provider_response = COALESCE(provider_response, ?)
     WHERE id = ?
  `).bind(
    dueAt,
    JSON.stringify(chain),
    currentStep,
    JSON.stringify({ original_opts: origOpts }),
    outboxId,
  ).run();
}
