// /api/comms — central comms hub
// Routes WABA (Meta Cloud API direct) + SMS (Fast2SMS) per brand and tier.
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
  const phoneId =
    brand === 'nch' ? env.WA_NCH_PHONE_ID :
    brand === 'he'  ? env.WA_HE_PHONE_ID  :
    env.WA_HE_PHONE_ID;
  // Prefer brand-specific token, fall back to shared, fall back to legacy.
  // NCH WABA lives outside HN Hotels Pvt Ltd portfolio — uses its own token.
  const token =
    brand === 'nch' ? (env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    brand === 'he'  ? (env.WA_HE_TOKEN  || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    (env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN);
  if (!phoneId || !token) {
    return { ok: false, status: 500, response: { error: 'WABA not configured for brand: ' + brand } };
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
      configured: {
        waba_he_phone_id: !!env.WA_HE_PHONE_ID,
        waba_nch_phone_id: !!env.WA_NCH_PHONE_ID,
        waba_he_token: !!(env.WA_HE_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN),
        waba_nch_token: !!(env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN),
        fast2sms_key: !!env.FAST2SMS_API_KEY,
        d1_bound: !!env.DB,
      },
      notes: {
        nch_token_source: env.WA_NCH_TOKEN ? 'WA_NCH_TOKEN (brand-specific)'
          : env.WA_COMMS_TOKEN ? 'WA_COMMS_TOKEN (shared, may be HE-only-scoped)'
          : env.WA_ACCESS_TOKEN ? 'WA_ACCESS_TOKEN (legacy)' : 'NOT SET',
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
