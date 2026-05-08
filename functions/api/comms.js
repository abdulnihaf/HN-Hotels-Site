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
