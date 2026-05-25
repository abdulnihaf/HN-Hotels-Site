// /api/comms — central comms hub
// Thin route layer over functions/api/_lib/comms-core.js.
// Channels: waba (Meta Cloud API) | sms (Fast2SMS) | voice (Exotel).
// Logs every send to comms_outbox via the core module.

import {
  normalizePhone,
  sendWaba,
  sendAndLog,
  sendWithFallback,
  runEscalation,
  logOutbox,
} from './_lib/comms-core.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const META_GRAPH_VERSION = 'v24.0';
const AGGREGATOR_DAILY_REPORT_TEMPLATE = {
  name: 'aggregator_daily_owner_report_v1',
  language: 'en',
  category: 'UTILITY',
  components: [
    {
      type: 'HEADER',
      format: 'TEXT',
      text: 'Daily aggregator report',
    },
    {
      type: 'BODY',
      text: [
        'HN Hotels daily aggregator operations report is ready for {{1}}.',
        '',
        'This report is generated after outlet close from Swiggy and Zomato order history. It separates delivered orders, rejected or cancelled orders, discount exposure, customer and order signals, and the first operational correction to make before any price or offer change.',
        '',
        'Order and revenue snapshot:',
        '{{2}}',
        '',
        'Improvement focus:',
        '{{3}}',
        '',
        'Full COA dashboard report:',
        '{{4}}',
        '',
        'Review this before changing menu price, discount, stock status, or platform availability.',
      ].join('\n'),
      example: {
        body_text: [[
          'Hamza Express on 25 May 2026',
          '9 total orders; 6 delivered; 2 rejected or cancelled; Rs 1,808 delivered; Rs 1,165 at risk.',
          'Fix rejected orders and out-of-stock cancellation first. Keep offer changes blocked until margin proof is checked.',
          'https://hnhotels.in/ops/he/aggregator/',
        ]],
      },
    },
    {
      type: 'FOOTER',
      text: 'HN Hotels COA daily close',
    },
  ],
};

function authOk(request, env, body) {
  const key = request.headers.get('x-dashboard-key') || body?.dashboard_key;
  return key && key === env.DASHBOARD_KEY;
}

function wabaConfigForBrand(env, brand) {
  const b = brand || 'he';
  if (b === 'nch') {
    return {
      brand: b,
      wabaId: env.WA_NCH_WABA_ID,
      token: env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN,
    };
  }
  if (b === 'he') {
    return {
      brand: b,
      wabaId: env.WA_HE_WABA_ID,
      token: env.WA_HE_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN,
    };
  }
  if (b === 'sparksol') {
    return {
      brand: b,
      wabaId: env.WA_SPARKSOL_WABA_ID || env.WABA_ID,
      token: env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN,
    };
  }
  return { brand: b, error: 'unsupported_brand' };
}

async function graphJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, body };
}

async function getWabaTemplate(env, brand, name = AGGREGATOR_DAILY_REPORT_TEMPLATE.name) {
  const cfg = wabaConfigForBrand(env, brand);
  if (cfg.error) return { ok: false, brand, error: cfg.error };
  if (!cfg.wabaId || !cfg.token) return { ok: false, brand, error: 'waba_id_or_token_missing' };

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.wabaId}/message_templates`);
  url.searchParams.set('fields', 'id,name,status,category,language,rejected_reason');
  url.searchParams.set('name', name);
  url.searchParams.set('limit', '10');
  const r = await graphJson(url.toString(), cfg.token);
  if (!r.ok) return { ok: false, brand, status: r.status, response: r.body };
  const found = (r.body?.data || []).find(t => t.name === name);
  return { ok: true, brand, template: found || null };
}

async function ensureAggregatorDailyReportTemplate(env, brand) {
  const existing = await getWabaTemplate(env, brand);
  if (!existing.ok) return existing;
  if (existing.template) return { ...existing, created: false };

  const cfg = wabaConfigForBrand(env, brand);
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.wabaId}/message_templates`;
  const created = await graphJson(url, cfg.token, {
    method: 'POST',
    body: JSON.stringify(AGGREGATOR_DAILY_REPORT_TEMPLATE),
  });
  return {
    ok: created.ok,
    brand,
    created: created.ok,
    status: created.status,
    response: created.body,
  };
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

  // ─── Cron-only escalation runner (different auth: CRON_TOKEN, not DASHBOARD_KEY) ─
  if (action === 'cron-escalate' && request.method === 'POST') {
    if (request.headers.get('x-cron-token') !== env.CRON_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    const r = await runEscalation(env);
    return json({ ok: true, ...r });
  }

  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  if (!authOk(request, env, body)) return json({ error: 'unauthorized' }, 401);

  if (action === 'ensure-aggregator-report-template') {
    const brands = Array.isArray(body.brands) && body.brands.length
      ? body.brands
      : [body.brand || 'he'];
    const results = [];
    for (const brand of brands) {
      results.push(await ensureAggregatorDailyReportTemplate(env, brand));
    }
    return json({
      ok: results.every(r => r.ok),
      template: AGGREGATOR_DAILY_REPORT_TEMPLATE.name,
      results,
    }, results.every(r => r.ok) ? 200 : 500);
  }

  if (action === 'aggregator-report-template-status') {
    const brands = Array.isArray(body.brands) && body.brands.length
      ? body.brands
      : [body.brand || 'he'];
    const results = [];
    for (const brand of brands) {
      results.push(await getWabaTemplate(env, brand));
    }
    return json({
      ok: results.every(r => r.ok),
      template: AGGREGATOR_DAILY_REPORT_TEMPLATE.name,
      results,
    }, results.every(r => r.ok) ? 200 : 500);
  }

  if (action === 'send') {
    const {
      tier = 'info',
      brand = 'sparksol',
      channel,
      phone,
      // waba
      template,
      vars = [],
      language = 'en',
      buttons = [],
      // sms
      message,
      route = 'q',
      // voice
      message_text,
      alert_id,
    } = body;

    if (!channel || !phone) return json({ error: 'channel and phone required' }, 400);

    const result = await sendAndLog(env, {
      channel, phone, alert_id, tier, brand,
      template, vars, language, buttons,
      message, route,
      message_text,
    });

    if (result.error) return json({ error: result.error }, 400);

    return json({
      ok: result.ok,
      status: result.status,
      provider_msg_id: result.provider_msg_id,
      outbox_id: result.outbox_id,
      response: result.response,
    }, result.ok ? 200 : 500);
  }

  // Send with multi-channel fallback (WABA → SMS → optionally Voice).
  // Cron polls /api/comms?action=cron-escalate to fire next channel when ack window expires.
  if (action === 'send-with-fallback') {
    const {
      tier = 'warn',
      brand = 'sparksol',
      phone,
      alert_id,
      // primary channel (always waba in current usage)
      template, vars = [], language = 'en', buttons = [],
      message_text,
      // chain config
      chain,                  // ['waba','sms','voice']
      gap_minutes,            // { waba: 30, sms: 60 }
      fallback_message_text,  // voice text (fallback)
    } = body;
    if (!phone) return json({ error: 'phone required' }, 400);
    const r = await sendWithFallback(env, {
      tier, brand, phone, alert_id,
      template, vars, language, buttons,
      message_text, chain, gap_minutes, fallback_message_text,
      channel: (chain && chain[0]) || 'waba',
    });
    if (r.error) return json({ error: r.error }, 400);
    return json(r, r.ok ? 200 : 500);
  }

  // Admin: update a DLT template's BSNL-assigned ID + status as approvals come in.
  if (action === 'update-dlt-template') {
    const { template_name, dlt_template_id, status = 'approved', body_template, header } = body;
    if (!template_name || !dlt_template_id) {
      return json({ error: 'template_name and dlt_template_id required' }, 400);
    }
    const sets = ['dlt_template_id = ?', 'status = ?', 'approved_at = datetime(\'now\')'];
    const binds = [dlt_template_id, status];
    if (body_template) { sets.push('body_template = ?'); binds.push(body_template); }
    if (header)        { sets.push('header = ?');         binds.push(header); }
    binds.push(template_name);
    const r = await env.DB.prepare(
      `UPDATE dlt_templates SET ${sets.join(', ')} WHERE template_name = ?`
    ).bind(...binds).run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
  }

  // Admin: list DLT templates + approval status (for the Compliance/Ops tab)
  if (action === 'list-dlt-templates') {
    const rs = await env.DB.prepare(
      `SELECT template_name, dlt_template_id, header, status, category, variable_count, notes
         FROM dlt_templates ORDER BY status, template_name`
    ).all();
    return json(rs.results || []);
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
      SELECT id, alert_id, tier, brand, channel, recipient_phone, template_name, status,
             provider_msg_id, sent_at, delivered_at, acked_at, ack_action, created_at, error_text
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
