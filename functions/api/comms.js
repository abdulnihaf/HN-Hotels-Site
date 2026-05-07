// /api/comms — central comms hub
// Routes WABA (Meta Cloud API direct) + SMS (Fast2SMS DLT) per brand and tier.
// Logs every send to comms_outbox.

const META_GRAPH_VERSION = 'v24.0';
const FAST2SMS_BASE = 'https://www.fast2sms.com/dev/bulkV2';

// BSNL DLT sender IDs — registered under PE BL-1400079296 (HN Hotels Pvt Ltd)
// sender_id maps to a 6-char TRAI-approved header.
// fast2sms_tpl_env: CF secret name holding the Fast2SMS numeric template ID
// (assigned by Fast2SMS when you add each template in their DLT panel).
const DLT_TEMPLATES = {
  cash_drift_v1: {
    sender_id: 'HMZOPS',
    fast2sms_tpl_env: 'F2S_TPL_CASH_DRIFT_V1',
    var_count: 4,
    // Alert: Cash drift at {#var#}. POS Rs {#var#} vs actual Rs {#var#}. Diff Rs {#var#}. Check immediately. - HN Hotels
  },
  rp_no_pos_v1: {
    sender_id: 'HMZOPS',
    fast2sms_tpl_env: 'F2S_TPL_RP_NO_POS_V1',
    var_count: 4,
    // Razorpay Rs {#var#} from {#var#} has no POS order at {#var#}. Txn: {#var#}. Investigate. - HN Hotels
  },
  inventory_short_v1: {
    sender_id: 'HMZOPS',
    fast2sms_tpl_env: 'F2S_TPL_INVENTORY_SHORT_V1',
    var_count: 3,
    // Low stock at {#var#}: {#var#} below reorder level. Remaining: {#var#}. Reorder now. - HN Hotels
  },
  no_show_v1: {
    sender_id: 'NAWOPS',
    fast2sms_tpl_env: 'F2S_TPL_NO_SHOW_V1',
    var_count: 4,
    // {#var#} not checked in at {#var#} as of {#var#}. Shift: {#var#}. Follow up. - HN Hotels
  },
  payment_pending_v1: {
    sender_id: 'HMZOPS',
    fast2sms_tpl_env: 'F2S_TPL_PAYMENT_PENDING_V1',
    var_count: 5,
    // Order #{#var#} at {#var#} Rs {#var#} unpaid {#var#} mins. Customer: {#var#}. Action needed. - HN Hotels
  },
  digest_v1: {
    sender_id: 'HNHOPS',
    fast2sms_tpl_env: 'F2S_TPL_DIGEST_V1',
    var_count: 6,
    // Digest {#var#}: HE Rs {#var#} ({#var#} orders) NCH Rs {#var#} ({#var#} orders) Total Rs {#var#}. - HN Hotels
  },
};

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

async function sendSms(env, { phone, message, template, vars = [] }) {
  if (!env.FAST2SMS_API_KEY) {
    return { ok: false, status: 500, response: { error: 'FAST2SMS_API_KEY not set' } };
  }
  const to = normalizePhone(phone).replace(/^91/, '');
  const params = new URL(FAST2SMS_BASE);
  params.searchParams.set('authorization', env.FAST2SMS_API_KEY);
  params.searchParams.set('numbers', to);
  params.searchParams.set('flash', '0');

  if (template) {
    const tpl = DLT_TEMPLATES[template];
    if (!tpl) return { ok: false, status: 400, response: { error: `unknown DLT template: ${template}` } };

    const tplId = env[tpl.fast2sms_tpl_env];
    if (!tplId) {
      // Template ID not yet set — Fast2SMS DLT panel registration pending.
      // Cannot send on DLT route without a numeric template ID.
      return { ok: false, status: 503, response: { error: `Fast2SMS template ID not configured (${tpl.fast2sms_tpl_env}). Register template in Fast2SMS DLT panel first.` } };
    }

    params.searchParams.set('route', 'dlt');
    params.searchParams.set('sender_id', tpl.sender_id);
    params.searchParams.set('message_id', tplId);
    // Fast2SMS expects pipe-separated values with a trailing pipe: val1|val2|val3|
    params.searchParams.set('variables_values', vars.map(String).join('|') + '|');
  } else {
    if (!message) return { ok: false, status: 400, response: { error: 'message or template required' } };
    params.searchParams.set('route', 'q');
    params.searchParams.set('message', message);
  }

  const res = await fetch(params.toString(), { method: 'GET' });
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
        dlt_templates: Object.fromEntries(
          Object.entries(DLT_TEMPLATES).map(([name, t]) => [name, !!env[t.fast2sms_tpl_env]])
        ),
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
        if (!template && !message) return json({ error: 'template or message required for sms' }, 400);
        result = await sendSms(env, { phone: recipient, message, template, vars });
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
