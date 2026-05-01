// /api/messaging — manual-test backend for /ops/messaging UI
// Provides: list-templates (live from Meta), list-staff (joined hr+optin), send (proxies comms), recent-outbox

const META_GRAPH_VERSION = 'v24.0';
const FAST2SMS_BASE = 'https://www.fast2sms.com/dev/bulkV2';
const SPARKSOL_WABA_ID = '1460647112230193';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

function authOk(request, env, body) {
  const key = request.headers.get('x-dashboard-key') || body?.dashboard_key;
  return key && key === env.DASHBOARD_KEY;
}

async function listTemplates(env) {
  // Live pull from Meta — only Sparksol templates for now (default messaging brand)
  const token = env.WA_SPARKSOL_TOKEN;
  if (!token) return [];
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${SPARKSOL_WABA_ID}/message_templates?fields=name,status,category,language,components&limit=50`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json();
    const templates = (data?.data || []).filter(t => t.status === 'APPROVED').map(t => {
      const body = (t.components || []).find(c => c.type === 'BODY');
      const text = body?.text || '';
      // Count {{n}} placeholders to render input fields
      const matches = text.match(/\{\{(\d+)\}\}/g) || [];
      const varCount = matches.length;
      return {
        name: t.name,
        category: t.category,
        language: t.language,
        body_text: text,
        var_count: varCount,
      };
    });
    return templates;
  } catch (e) {
    return [];
  }
}

async function listStaff(env) {
  const rs = await env.DB.prepare(`
    SELECT
      hr.id, hr.name, hr.phone, hr.brand_label, hr.job_name,
      MAX(CASE WHEN co.channel = 'waba' THEN co.status END) AS waba_status,
      MAX(CASE WHEN co.channel = 'sms'  THEN co.status END) AS sms_status,
      MAX(CASE WHEN co.channel = 'waba' THEN co.consented_at END) AS waba_consented_at
    FROM hr_employees hr
    LEFT JOIN comms_optin co
      ON co.phone = (CASE WHEN length(trim(hr.phone))=10 THEN '91'||trim(hr.phone) ELSE trim(hr.phone) END)
     AND co.brand = 'sparksol'
    WHERE hr.is_active = 1 AND hr.phone IS NOT NULL AND trim(hr.phone) != ''
    GROUP BY hr.id
    ORDER BY hr.brand_label, hr.name
  `).all();
  return (rs.results || []).map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    e164: normalizePhone(r.phone),
    brand: r.brand_label,
    role: r.job_name,
    waba_status: r.waba_status || 'not-tracked',
    sms_status: r.sms_status || 'not-tracked',
    waba_consented_at: r.waba_consented_at || null,
  }));
}

async function recentOutbox(env, limit = 30) {
  const rs = await env.DB.prepare(`
    SELECT id, channel, brand, recipient_phone, template_name, body_text, status, provider_msg_id,
           sent_at, delivered_at, read_at, acked_at, ack_action, error_text
    FROM comms_outbox
    ORDER BY id DESC LIMIT ?
  `).bind(limit).all();
  return rs.results || [];
}

async function counts(env) {
  const optinRs = await env.DB.prepare(`
    SELECT channel, status, COUNT(*) AS cnt
    FROM comms_optin WHERE brand='sparksol'
    GROUP BY channel, status
  `).all();
  const outboxRs = await env.DB.prepare(`
    SELECT channel, COUNT(*) AS cnt
    FROM comms_outbox
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY channel
  `).all();
  return { optin: optinRs.results || [], outbox_24h: outboxRs.results || [] };
}

async function fastSmsBalance(env) {
  if (!env.FAST2SMS_API_KEY) return null;
  try {
    const url = `https://www.fast2sms.com/dev/wallet?authorization=${env.FAST2SMS_API_KEY}`;
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function sendWaba(env, { brand = 'sparksol', phone, template, vars = [] }) {
  const phoneId =
    brand === 'sparksol' ? env.WA_SPARKSOL_PHONE_ID :
    brand === 'nch'      ? env.WA_NCH_PHONE_ID :
    brand === 'he'       ? env.WA_HE_PHONE_ID :
    env.WA_SPARKSOL_PHONE_ID;
  const token =
    brand === 'sparksol' ? (env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN) :
    brand === 'nch'      ? (env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    brand === 'he'       ? (env.WA_HE_TOKEN  || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN) :
    (env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN);
  if (!phoneId || !token) return { ok: false, error: `WABA not configured for brand: ${brand}` };

  const components = vars.length > 0
    ? [{ type: 'body', parameters: vars.map(v => ({ type: 'text', text: String(v) })) }]
    : [];
  const body = {
    messaging_product: 'whatsapp',
    to: normalizePhone(phone),
    type: 'template',
    template: { name: template, language: { code: 'en' }, components },
  };
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`, {
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

async function sendSms(env, { phone, message }) {
  if (!env.FAST2SMS_API_KEY) return { ok: false, error: 'FAST2SMS_API_KEY not set' };
  const to = normalizePhone(phone).replace(/^91/, '');
  const url = new URL(FAST2SMS_BASE);
  url.searchParams.set('authorization', env.FAST2SMS_API_KEY);
  url.searchParams.set('route', 'q');
  url.searchParams.set('numbers', to);
  url.searchParams.set('message', message);
  url.searchParams.set('flash', '0');
  const res = await fetch(url.toString());
  const text = await res.text();
  let respJson = null;
  try { respJson = JSON.parse(text); } catch {}
  return {
    ok: res.ok && respJson?.return === true,
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
      row.tier || 'manual-test',
      row.brand || 'sparksol',
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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'overview';

  // Public: overview (no secrets exposed)
  if (action === 'overview') {
    const [staff, oc, fb, recent] = await Promise.all([
      listStaff(env),
      counts(env),
      fastSmsBalance(env),
      recentOutbox(env, 10),
    ]);
    return json({
      time: new Date().toISOString(),
      counts: oc,
      fast2sms: fb,
      staff_total: staff.length,
      staff_waba_opted_in: staff.filter(s => s.waba_status === 'opted_in').length,
      staff_sms_opted_in:  staff.filter(s => s.sms_status  === 'opted_in').length,
      configured: {
        sparksol_phone_id: !!env.WA_SPARKSOL_PHONE_ID,
        sparksol_token: !!env.WA_SPARKSOL_TOKEN,
        fast2sms: !!env.FAST2SMS_API_KEY,
      },
      recent_outbox: recent.slice(0, 5),
    });
  }

  if (action === 'templates') {
    const t = await listTemplates(env);
    return json({ templates: t });
  }

  if (action === 'staff') {
    const s = await listStaff(env);
    return json({ staff: s });
  }

  if (action === 'outbox') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    const r = await recentOutbox(env, limit);
    return json({ outbox: r });
  }

  // Send actions require POST + auth
  if (request.method !== 'POST') return json({ error: 'POST required for ' + action }, 405);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (!authOk(request, env, body)) return json({ error: 'unauthorized — set x-dashboard-key' }, 401);

  if (action === 'send-bulk') {
    // Batch send to multiple recipients with the same channel + payload
    const { channel, brand = 'sparksol', recipients = [], template, vars = [], message } = body;
    if (!channel || !Array.isArray(recipients) || recipients.length === 0) {
      return json({ error: 'channel + recipients[] required' }, 400);
    }
    if (recipients.length > 200) return json({ error: 'max 200 recipients per call' }, 400);

    const results = [];
    for (const phone of recipients) {
      const recipient = normalizePhone(phone);
      let result;
      try {
        if (channel === 'waba') {
          if (!template) { results.push({ phone: recipient, ok: false, error: 'template required' }); continue; }
          result = await sendWaba(env, { brand, phone: recipient, template, vars });
        } else if (channel === 'sms') {
          if (!message) { results.push({ phone: recipient, ok: false, error: 'message required' }); continue; }
          result = await sendSms(env, { phone: recipient, message });
        } else {
          results.push({ phone: recipient, ok: false, error: 'unsupported channel' });
          continue;
        }
        const status = result.ok ? 'sent' : 'failed';
        const errText = result.ok ? null : (typeof result.response === 'string' ? result.response : JSON.stringify(result.response || result.error));
        await logOutbox(env, {
          tier: 'manual-test-bulk', brand, channel,
          recipient_phone: recipient,
          template_name: template, template_vars: vars,
          body_text: message,
          status,
          provider_msg_id: result.provider_msg_id,
          provider_response: result.response,
          error_text: errText,
        });
        results.push({ phone: recipient, ok: result.ok, provider_msg_id: result.provider_msg_id, error: errText });
      } catch (e) {
        results.push({ phone: recipient, ok: false, error: e?.message || String(e) });
      }
    }
    return json({
      total: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    });
  }

  if (action === 'send') {
    const { channel, brand = 'sparksol', phone, template, vars = [], message } = body;
    if (!channel || !phone) return json({ error: 'channel and phone required' }, 400);
    const recipient = normalizePhone(phone);

    let result;
    if (channel === 'waba') {
      if (!template) return json({ error: 'template required for waba' }, 400);
      result = await sendWaba(env, { brand, phone: recipient, template, vars });
    } else if (channel === 'sms') {
      if (!message) return json({ error: 'message required for sms' }, 400);
      result = await sendSms(env, { phone: recipient, message });
    } else {
      return json({ error: 'unsupported channel: ' + channel }, 400);
    }

    const status = result.ok ? 'sent' : 'failed';
    const errText = result.ok ? null : (typeof result.response === 'string' ? result.response : JSON.stringify(result.response || result.error));

    await logOutbox(env, {
      tier: 'manual-test', brand, channel,
      recipient_phone: recipient,
      template_name: template,
      template_vars: vars,
      body_text: message,
      status,
      provider_msg_id: result.provider_msg_id,
      provider_response: result.response,
      error_text: errText,
    });

    return json({ ok: result.ok, status, provider_msg_id: result.provider_msg_id, response: result.response, error: errText });
  }

  return json({ error: 'unknown action: ' + action }, 400);
}
