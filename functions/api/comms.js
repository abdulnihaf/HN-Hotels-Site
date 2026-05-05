// /api/comms — central comms hub
// Routes WABA (Meta Cloud API direct) + SMS (Fast2SMS) + Voice (Exotel) per brand and tier.
// Logs every send to comms_outbox.

const META_GRAPH_VERSION = 'v24.0';
const FAST2SMS_BASE = 'https://www.fast2sms.com/dev/bulkV2';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

async function sendWaba(env, { brand, phone, template, vars = [], language = 'en' }) {
  // Sparksol is the dedicated comms WABA for staff alerts (no customer flow on it).
  // HE / NCH WABAs are reserved for customer order flows and untouched.
  // Default brand for comms = sparksol.
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
  const components = vars.length > 0
    ? [{ type: 'body', parameters: vars.map(v => ({ type: 'text', text: String(v) })) }]
    : [];
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(text); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.messages?.[0]?.id || null,
    response: respJson || text,
  };
}

async function sendVoice(env, { phone, message_text, alert_id }) {
  if (!env.EXOTEL_SID || !env.EXOTEL_API_KEY || !env.EXOTEL_API_TOKEN) {
    return { ok: false, status: 500, response: { error: 'Exotel not configured' } };
  }
  if (!env.EXOTEL_CALLER_ID) {
    return { ok: false, status: 500, response: { error: 'EXOTEL_CALLER_ID not set — assign ExoPhone first' } };
  }

  const digits = normalizePhone(phone);
  // Exotel expects 10-digit local or 0XXXXXXXXXX format for India
  const toFormatted = digits.startsWith('91') ? '0' + digits.slice(2) : digits;
  const base = env.PUBLIC_BASE_URL || 'https://hnhotels.in';
  const apiUrl = `https://${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}@api.exotel.com/v1/Accounts/${env.EXOTEL_SID}/Calls/connect.json`;

  const params = new URLSearchParams({
    From: env.EXOTEL_CALLER_ID,
    To: toFormatted,
    CallerId: env.EXOTEL_CALLER_ID,
    TimeLimit: '120',
    Record: 'false',
    StatusCallback: `${base}/api/comms-webhook?action=exotel-status`,
    CustomField: alert_id ? String(alert_id) : '',
    // Exotel fetches this URL when the call connects to get the ExoML call flow
    Url: `${base}/api/comms-webhook?action=exotel-tts&text=${encodeURIComponent((message_text || 'HN Hotels alert').slice(0, 500))}&alert_id=${encodeURIComponent(alert_id || '')}`,
  });

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const respText = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(respText); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    provider_msg_id: respJson?.Call?.Sid || null,
    response: respJson || respText,
  };
}

async function sendSms(env, { phone, message, route = 'q' }) {
  if (!env.FAST2SMS_API_KEY) {
    return { ok: false, status: 500, response: { error: 'FAST2SMS_API_KEY not set' } };
  }
  const to = normalizePhone(phone).replace(/^91/, '');
  const url = new URL(FAST2SMS_BASE);
  url.searchParams.set('authorization', env.FAST2SMS_API_KEY);
  url.searchParams.set('route', route); // q = quick transactional, dlt = DLT-approved transactional
  url.searchParams.set('numbers', to);
  url.searchParams.set('message', message);
  url.searchParams.set('flash', '0');

  const res = await fetch(url.toString(), { method: 'GET' });
  const text = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(text); } catch {}
  return {
    ok: res.ok && (respJson?.return === true),
    status: res.status,
    provider_msg_id: respJson?.request_id ? String(respJson.request_id) : null,
    response: respJson || text,
  };
}

async function logOutbox(env, row) {
  try {
    await env.DB.prepare(`
      INSERT INTO comms_outbox
        (alert_id, tier, brand, channel, recipient_phone, template_name, template_vars,
         body_text, status, provider_msg_id, provider_response, error_text, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ).run();
  } catch (e) {
    console.error('logOutbox failed:', e?.message || e);
  }
}

function authOk(request, env, body) {
  const key = request.headers.get('x-dashboard-key') || body?.dashboard_key;
  return key && key === env.DASHBOARD_KEY;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'health';

  if (action === 'health') {
    return json({
      ok: true,
      time: new Date().toISOString(),
      default_brand: 'sparksol',
      configured: {
        waba_sparksol_phone_id: !!env.WA_SPARKSOL_PHONE_ID,
        waba_sparksol_token: !!env.WA_SPARKSOL_TOKEN,
        waba_he_phone_id: !!env.WA_HE_PHONE_ID,
        waba_nch_phone_id: !!env.WA_NCH_PHONE_ID,
        waba_he_token: !!(env.WA_HE_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN),
        waba_nch_token: !!(env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN),
        fast2sms_key: !!env.FAST2SMS_API_KEY,
        exotel_sid: !!env.EXOTEL_SID,
        exotel_api_key: !!env.EXOTEL_API_KEY,
        exotel_api_token: !!env.EXOTEL_API_TOKEN,
        exotel_caller_id: !!env.EXOTEL_CALLER_ID,
        d1_bound: !!env.DB,
      },
    });
  }

  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  if (!authOk(request, env, body)) return json({ error: 'unauthorized' }, 401);

  if (action === 'send') {
    const {
      tier = 'info',
      brand = 'hq',
      channel,
      phone,
      template,
      vars = [],
      message,
      message_text,
      alert_id,
    } = body;

    if (!channel || !phone) return json({ error: 'channel and phone required' }, 400);
    const recipient = normalizePhone(phone);

    let result;
    let status = 'pending';
    let errText = null;

    try {
      if (channel === 'waba') {
        if (!template) return json({ error: 'template required for waba' }, 400);
        result = await sendWaba(env, { brand, phone: recipient, template, vars });
      } else if (channel === 'sms') {
        if (!message) return json({ error: 'message required for sms' }, 400);
        result = await sendSms(env, { phone: recipient, message });
      } else if (channel === 'voice') {
        if (!message_text) return json({ error: 'message_text required for voice' }, 400);
        result = await sendVoice(env, { phone: recipient, message_text, alert_id });
      } else {
        return json({ error: `unsupported channel: ${channel}` }, 400);
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

    await logOutbox(env, {
      alert_id, tier, brand, channel,
      recipient_phone: recipient,
      template_name: template,
      template_vars: vars,
      body_text: message,
      status,
      provider_msg_id: result.provider_msg_id,
      provider_response: result.response,
      error_text: errText,
    });

    return json({
      ok: result.ok,
      status,
      provider_msg_id: result.provider_msg_id,
      response: result.response,
    }, result.ok ? 200 : (result.status || 500));
  }

  if (action === 'optin-send') {
    // Send the opt-in template to a staff phone, log to comms_optin as 'pending'.
    // Reply YES on WhatsApp will be captured by /api/comms-webhook and flip status to 'opted_in'.
    const {
      brand = 'he',
      phone,
      staff_name = '',
      staff_role = '',
      template = 'hello_world', // default Meta template; replace with 'staff_optin_v1' once registered
      vars = [],
    } = body;

    if (!phone) return json({ error: 'phone required' }, 400);
    const recipient = normalizePhone(phone);

    // Insert pending opt-in row (UNIQUE on phone+brand+channel — INSERT OR IGNORE keeps existing)
    await env.DB.prepare(`
      INSERT OR IGNORE INTO comms_optin (phone, brand, channel, staff_name, staff_role, status)
      VALUES (?, ?, 'waba', ?, ?, 'pending')
    `).bind(recipient, brand, staff_name, staff_role).run();

    // Send template
    const result = await sendWaba(env, { brand, phone: recipient, template, vars });
    const status = result.ok ? 'sent' : 'failed';
    const errText = result.ok ? null : (typeof result.response === 'string' ? result.response : JSON.stringify(result.response));

    await logOutbox(env, {
      tier: 'info', brand, channel: 'waba',
      recipient_phone: recipient, template_name: template, template_vars: vars,
      body_text: 'OPT-IN REQUEST',
      status,
      provider_msg_id: result.provider_msg_id,
      provider_response: result.response,
      error_text: errText,
    });

    // Link the outbox row to the opt-in row
    if (result.ok && result.provider_msg_id) {
      await env.DB.prepare(`
        UPDATE comms_optin SET consent_msg_id = ?
         WHERE phone = ? AND brand = ? AND channel = 'waba' AND status = 'pending'
      `).bind(result.provider_msg_id, recipient, brand).run();
    }

    return json({ ok: result.ok, status, recipient, provider_msg_id: result.provider_msg_id, response: result.response });
  }

  if (action === 'optin-confirm') {
    // Manual override: mark a phone as opted in (for testing or admin override).
    const { phone, brand = 'he', consent_text = 'manual' } = body;
    if (!phone) return json({ error: 'phone required' }, 400);
    const recipient = normalizePhone(phone);
    const r = await env.DB.prepare(`
      UPDATE comms_optin
         SET status = 'opted_in', consented_at = datetime('now'), consent_text = ?
       WHERE phone = ? AND brand = ? AND channel = 'waba'
    `).bind(consent_text, recipient, brand).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  if (action === 'list-outbox') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const rs = await env.DB.prepare(`
      SELECT id, tier, brand, channel, recipient_phone, template_name, status,
             provider_msg_id, sent_at, created_at, error_text
      FROM comms_outbox ORDER BY id DESC LIMIT ?
    `).bind(limit).all();
    return json(rs.results || []);
  }

  if (action === 'list-optin') {
    const rs = await env.DB.prepare(`
      SELECT id, phone, brand, channel, staff_name, staff_role, status, consented_at
      FROM comms_optin ORDER BY brand, status, phone
    `).all();
    return json(rs.results || []);
  }

  return json({ error: `unknown action: ${action}` }, 400);
}
