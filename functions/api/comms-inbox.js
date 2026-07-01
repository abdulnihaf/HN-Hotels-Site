// /api/comms-inbox
// Native mobile API for the standalone HN Comms WhatsApp inbox.
//
// Thin clients only: iOS and Android read/write the same cloud D1 store.
// Outbound sends must go through comms-core and every attempt is logged.

import {
  logOutbox,
  normalizePhone,
  sendWaba,
  sendWabaText,
} from './_lib/comms-core.js';

const META_GRAPH_VERSION = 'v24.0';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-dashboard-key, x-comms-key',
};

const BRAND_LABELS = {
  he: 'Hamza Express',
  nch: 'Nawabi Chai House',
  sparksol: 'SparkSol',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

function bad(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

function readAuth(request, body) {
  const auth = request.headers.get('authorization') || '';
  return request.headers.get('x-comms-key')
    || request.headers.get('x-dashboard-key')
    || body?.comms_key
    || body?.dashboard_key
    || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '');
}

function requireAuth(env, request, body = null) {
  const expected = env.HN_COMMS_APP_KEY || env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  if (!expected) return true;
  return readAuth(request, body) === expected;
}

function pickToken(env, names) {
  for (const name of names) {
    if (env[name]) return { token: env[name], source: name };
  }
  return { token: null, source: 'none' };
}

function brandConfig(env, brand) {
  const b = (brand || '').toLowerCase();
  if (b === 'he') {
    const picked = pickToken(env, ['WA_HE_TOKEN', 'WA_COMMS_TOKEN', 'WA_ACCESS_TOKEN']);
    return {
      brand: 'he',
      label: 'Hamza Express',
      phone_id: env.WA_HE_PHONE_ID || env.WA_PHONE_ID,
      waba_id: env.WA_HE_WABA_ID || env.WABA_ID,
      token: picked.token,
      token_source: picked.source,
    };
  }
  if (b === 'nch') {
    const picked = pickToken(env, ['WA_NCH_TOKEN', 'WA_COMMS_TOKEN', 'WA_ACCESS_TOKEN']);
    return {
      brand: 'nch',
      label: 'Nawabi Chai House',
      phone_id: env.WA_NCH_PHONE_ID,
      waba_id: env.WA_NCH_WABA_ID,
      token: picked.token,
      token_source: picked.source,
    };
  }
  if (b === 'sparksol') {
    const picked = pickToken(env, ['WA_SPARKSOL_TOKEN', 'WA_COMMS_TOKEN', 'WA_ACCESS_TOKEN']);
    return {
      brand: 'sparksol',
      label: 'SparkSol',
      phone_id: env.WA_SPARKSOL_PHONE_ID,
      waba_id: env.WA_SPARKSOL_WABA_ID || env.WABA_ID,
      token: picked.token,
      token_source: picked.source,
    };
  }
  return null;
}

function brandError() {
  return 'brand must be he, nch, or sparksol';
}

function mediaKindFor(file, requested) {
  const explicit = String(requested || '').toLowerCase();
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(explicit)) return explicit;
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function providerError(response) {
  if (!response) return null;
  if (response.error?.message) return String(response.error.message).slice(0, 1000);
  if (typeof response === 'string') return response.slice(0, 1000);
  return JSON.stringify(response).slice(0, 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function isWindowOpen(thread) {
  const exp = thread?.service_window_expires_at;
  return !!exp && exp > nowIso();
}

function minutesRemaining(thread) {
  if (!thread?.service_window_expires_at) return 0;
  const ms = new Date(thread.service_window_expires_at).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60000));
}

function publicThread(row) {
  const open = isWindowOpen(row);
  return {
    thread_id: row.thread_id,
    brand: row.brand,
    brand_label: BRAND_LABELS[row.brand] || row.brand,
    phone: row.phone,
    wa_id: row.wa_id,
    display_name: row.display_name || '',
    lead_status: row.lead_status || 'unknown',
    lead_source: row.lead_source || '',
    assigned_to: row.assigned_to || '',
    status: row.status || 'open',
    last_message_at: row.last_message_at,
    last_inbound_at: row.last_inbound_at,
    last_outbound_at: row.last_outbound_at,
    last_body: row.last_body || '',
    last_direction: row.last_direction || '',
    last_msg_type: row.last_msg_type || '',
    unread_count: row.unread_count || 0,
    service_window_expires_at: row.service_window_expires_at,
    service_window_open: open,
    service_window_minutes_remaining: minutesRemaining(row),
    lead_context: parseJson(row.lead_context_json, null),
    updated_at: row.updated_at,
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    brand: row.brand,
    phone: row.phone,
    direction: row.direction,
    msg_type: row.msg_type || 'text',
    body: row.body || '',
    template_name: row.template_name || '',
    wamid: row.wamid || '',
    status: row.status || '',
    error_text: row.error_text || '',
    media_id: row.media_id || '',
    outbox_id: row.outbox_id || null,
    actor: row.actor || '',
    created_at: row.created_at,
  };
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function threadIdFor(brand, phone) {
  return `${brand}:${normalizePhone(phone)}`;
}

async function listThreads(env, url) {
  const brand = url.searchParams.get('brand') || 'all';
  const leadStatus = url.searchParams.get('lead_status') || 'all';
  const status = url.searchParams.get('status') || 'all';
  const search = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  let where = 'WHERE 1 = 1';
  const params = [];
  if (brand !== 'all') {
    where += ' AND brand = ?';
    params.push(brand);
  }
  if (leadStatus !== 'all') {
    where += " AND COALESCE(lead_status, 'unknown') = ?";
    params.push(leadStatus);
  }
  if (status !== 'all') {
    if (status === 'unread') {
      where += ' AND unread_count > 0';
    } else {
      where += ' AND status = ?';
      params.push(status);
    }
  }
  if (search) {
    where += ' AND (phone LIKE ? OR display_name LIKE ? OR last_body LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const rows = await env.DB.prepare(`
    SELECT *
      FROM comms_threads
      ${where}
     ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
     LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS n
      FROM comms_threads
      ${where}
  `).bind(...params).first();

  return json({
    ok: true,
    threads: (rows.results || []).map(publicThread),
    total: count?.n || 0,
    limit,
    offset,
  });
}

async function loadThread(env, url) {
  const brand = (url.searchParams.get('brand') || '').toLowerCase();
  const phone = url.searchParams.get('phone') || '';
  const explicitThreadId = url.searchParams.get('thread_id') || '';
  const threadId = explicitThreadId || (brand && phone ? threadIdFor(brand, phone) : '');
  if (!threadId) return bad('thread_id or brand+phone required');

  const thread = await env.DB.prepare('SELECT * FROM comms_threads WHERE thread_id = ?')
    .bind(threadId)
    .first();
  if (!thread) return bad('thread not found', 404);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '120', 10) || 120, 200);
  const rows = await env.DB.prepare(`
    SELECT *
      FROM comms_messages
     WHERE thread_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?
  `).bind(threadId, limit).all();

  const outbox = await env.DB.prepare(`
    SELECT id, status, provider_msg_id, error_text, sent_at, delivered_at, read_at
      FROM comms_outbox
     WHERE brand = ? AND recipient_phone = ?
     ORDER BY id DESC
     LIMIT 20
  `).bind(thread.brand, thread.phone).all();

  return json({
    ok: true,
    thread: publicThread(thread),
    messages: (rows.results || []).reverse().map(publicMessage),
    recent_outbox: outbox.results || [],
  });
}

async function listQuickReplies(env, url) {
  const brand = (url.searchParams.get('brand') || 'all').toLowerCase();
  const rows = await env.DB.prepare(`
    SELECT id, brand, title, body, sort_order
      FROM comms_quick_replies
     WHERE active = 1
       AND (brand = 'all' OR brand = ?)
     ORDER BY sort_order ASC, title ASC
  `).bind(brand).all();
  return json({ ok: true, quick_replies: rows.results || [] });
}

async function listTemplates(env, url) {
  const brand = (url.searchParams.get('brand') || 'he').toLowerCase();
  const cfg = brandConfig(env, brand);
  if (!cfg) return bad(brandError());
  if (!cfg.token) return bad(`WABA token missing for ${brand}`, 500);
  if (!cfg.waba_id) return bad(`WABA id missing for ${brand}`, 500, { phone_id: cfg.phone_id || null });

  let path = `${cfg.waba_id}/message_templates?limit=100&fields=name,status,category,language,components,id,quality_score,rejected_reason`;
  const name = url.searchParams.get('name');
  if (name) path += `&name=${encodeURIComponent(name)}`;
  const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) return bad(data?.error?.message || 'Meta template lookup failed', resp.status || 502, { meta: data });
  return json({ ok: true, brand, templates: data.data || [], paging: data.paging || null });
}

async function uploadWabaMedia(env, { brand, file }) {
  const cfg = brandConfig(env, brand);
  if (!cfg) return { ok: false, status: 400, response: { error: brandError() } };
  if (!cfg.token || !cfg.phone_id) {
    return { ok: false, status: 500, response: { error: `WABA media upload not configured for ${brand}` } };
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.type || 'application/octet-stream');
  form.append('file', file, file.name || 'attachment');

  const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.phone_id}/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}` },
    body: form,
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return {
    ok: resp.ok && !!data?.id,
    status: resp.status,
    media_id: data?.id || null,
    response: data || text,
  };
}

async function sendWabaMedia(env, { brand, phone, mediaKind, mediaId, caption, filename }) {
  const cfg = brandConfig(env, brand);
  if (!cfg) return { ok: false, status: 400, response: { error: brandError() } };
  if (!cfg.token || !cfg.phone_id) {
    return { ok: false, status: 500, response: { error: `WABA media send not configured for ${brand}` } };
  }

  const mediaPayload = { id: mediaId };
  if (caption && (mediaKind === 'image' || mediaKind === 'video' || mediaKind === 'document')) {
    mediaPayload.caption = caption.slice(0, 1024);
  }
  if (filename && mediaKind === 'document') mediaPayload.filename = filename.slice(0, 240);

  const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.phone_id}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizePhone(phone),
      type: mediaKind,
      [mediaKind]: mediaPayload,
    }),
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return {
    ok: resp.ok,
    status: resp.status,
    provider_msg_id: data?.messages?.[0]?.id || null,
    response: data || text,
  };
}

async function markRead(env, body) {
  const threadId = body.thread_id || (body.brand && body.phone ? threadIdFor(body.brand, body.phone) : '');
  if (!threadId) return bad('thread_id or brand+phone required');
  await env.DB.prepare(`
    UPDATE comms_messages
       SET status = 'read'
     WHERE thread_id = ?
       AND direction = 'inbound'
       AND status IN ('unread', 'received')
  `).bind(threadId).run();
  await env.DB.prepare(`
    UPDATE comms_threads
       SET unread_count = 0,
           updated_at = datetime('now')
     WHERE thread_id = ?
  `).bind(threadId).run();
  return json({ ok: true, thread_id: threadId });
}

async function sendReply(env, body) {
  const brand = (body.brand || '').toLowerCase();
  const phone = normalizePhone(body.phone || body.wa_id || '');
  const actor = String(body.actor || 'hn-comms-app').slice(0, 80);
  const text = String(body.text || '').trim();
  const templateName = String(body.template_name || body.template || '').trim();
  const templateVars = Array.isArray(body.template_vars) ? body.template_vars : Array.isArray(body.vars) ? body.vars : [];
  const language = body.language || 'en';
  const buttons = Array.isArray(body.buttons) ? body.buttons : [];

  if (!brandConfig(env, brand)) return bad(brandError());
  if (!phone) return bad('phone required');
  if (!text && !templateName) return bad('text or template_name required');

  const threadId = threadIdFor(brand, phone);
  const thread = await env.DB.prepare('SELECT * FROM comms_threads WHERE thread_id = ?')
    .bind(threadId)
    .first();
  const windowOpen = isWindowOpen(thread);

  if (!windowOpen && !templateName) {
    return bad('outside_24h_window_template_required', 409, {
      service_window_open: false,
      service_window_expires_at: thread?.service_window_expires_at || null,
    });
  }

  const sendMode = templateName ? 'template' : 'text';
  const result = sendMode === 'template'
    ? await sendWaba(env, { brand, phone, template: templateName, vars: templateVars, language, buttons })
    : await sendWabaText(env, { brand, phone, body: text });

  const bodyText = text || `[template] ${templateName}`;
  const errText = result.ok ? null : providerError(result.response);

  const outboxId = await logOutbox(env, {
    alert_id: `comms_reply:${threadId}:${Date.now()}`,
    tier: 'reply',
    brand,
    channel: 'waba',
    recipient_phone: phone,
    template_name: templateName || null,
    template_vars: templateName ? templateVars : null,
    body_text: bodyText,
    status: result.ok ? 'sent' : 'failed',
    provider_msg_id: result.provider_msg_id || null,
    provider_response: result.response,
    error_text: errText,
  });

  await env.DB.prepare(`
    INSERT INTO comms_threads
      (thread_id, brand, phone, wa_id, display_name, status,
       last_message_at, last_outbound_at, last_body, last_direction, last_msg_type, updated_at)
    VALUES (?, ?, ?, ?, '', 'open', ?, ?, ?, 'outbound', ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
       last_message_at = excluded.last_message_at,
       last_outbound_at = excluded.last_outbound_at,
       last_body = excluded.last_body,
       last_direction = 'outbound',
       last_msg_type = excluded.last_msg_type,
       updated_at = excluded.updated_at
  `).bind(threadId, brand, phone, phone, nowIso(), nowIso(), bodyText.slice(0, 500), sendMode, nowIso()).run();

  const inserted = await env.DB.prepare(`
    INSERT INTO comms_messages
      (thread_id, brand, phone, direction, msg_type, body, template_name, wamid,
       status, provider_response, error_text, outbox_id, actor, created_at)
    VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    threadId,
    brand,
    phone,
    sendMode,
    bodyText,
    templateName || null,
    result.provider_msg_id || null,
    result.ok ? 'sent' : 'failed',
    JSON.stringify(result.response || {}).slice(0, 4000),
    errText,
    outboxId,
    actor,
    nowIso(),
  ).first();

  return json({
    ok: result.ok,
    send_mode: sendMode,
    service_window_open: windowOpen,
    provider_msg_id: result.provider_msg_id || null,
    outbox_id: outboxId,
    message_id: inserted?.id || null,
    error: errText,
    meta_status: result.status,
  }, result.ok ? 200 : 502);
}

async function sendAttachment(env, form) {
  const brand = String(form.get('brand') || '').toLowerCase();
  const phone = normalizePhone(form.get('phone') || form.get('wa_id') || '');
  const actor = String(form.get('actor') || 'hn-comms-app').slice(0, 80);
  const caption = String(form.get('caption') || '').trim();
  const file = form.get('file');

  if (!brandConfig(env, brand)) return bad(brandError());
  if (!phone) return bad('phone required');
  if (!file || typeof file === 'string' || !file.size) return bad('file required');

  const threadId = threadIdFor(brand, phone);
  const thread = await env.DB.prepare('SELECT * FROM comms_threads WHERE thread_id = ?')
    .bind(threadId)
    .first();

  if (!isWindowOpen(thread)) {
    return bad('outside_24h_window_attachment_not_allowed', 409, {
      service_window_open: false,
      service_window_expires_at: thread?.service_window_expires_at || null,
      note: 'WhatsApp free-form media can only be sent inside the 24-hour customer-service window. Use an approved template outside the window.',
    });
  }

  const mediaKind = mediaKindFor(file, form.get('media_type'));
  const filename = String(file.name || 'attachment').slice(0, 240);
  const bodyText = `[${mediaKind}] ${caption || filename}`.trim();
  const upload = await uploadWabaMedia(env, { brand, file });
  const sendResult = upload.ok
    ? await sendWabaMedia(env, {
        brand,
        phone,
        mediaKind,
        mediaId: upload.media_id,
        caption,
        filename,
      })
    : { ok: false, status: upload.status, response: upload.response, provider_msg_id: null };

  const ok = upload.ok && sendResult.ok;
  const errText = ok ? null : providerError(sendResult.response || upload.response);
  const providerResponse = { upload: upload.response, send: sendResult.response };

  const outboxId = await logOutbox(env, {
    alert_id: `comms_attachment:${threadId}:${Date.now()}`,
    tier: 'reply',
    brand,
    channel: 'waba',
    recipient_phone: phone,
    template_name: null,
    template_vars: null,
    body_text: bodyText,
    status: ok ? 'sent' : 'failed',
    provider_msg_id: sendResult.provider_msg_id || null,
    provider_response: providerResponse,
    error_text: errText,
  });

  await env.DB.prepare(`
    INSERT INTO comms_threads
      (thread_id, brand, phone, wa_id, display_name, status,
       last_message_at, last_outbound_at, last_body, last_direction, last_msg_type, updated_at)
    VALUES (?, ?, ?, ?, '', 'open', ?, ?, ?, 'outbound', ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
       last_message_at = excluded.last_message_at,
       last_outbound_at = excluded.last_outbound_at,
       last_body = excluded.last_body,
       last_direction = 'outbound',
       last_msg_type = excluded.last_msg_type,
       updated_at = excluded.updated_at
  `).bind(threadId, brand, phone, phone, nowIso(), nowIso(), bodyText.slice(0, 500), mediaKind, nowIso()).run();

  const inserted = await env.DB.prepare(`
    INSERT INTO comms_messages
      (thread_id, brand, phone, direction, msg_type, body, wamid, status,
       provider_response, error_text, media_id, outbox_id, actor, created_at)
    VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    threadId,
    brand,
    phone,
    mediaKind,
    caption || filename,
    sendResult.provider_msg_id || null,
    ok ? 'sent' : 'failed',
    JSON.stringify(providerResponse).slice(0, 4000),
    errText,
    upload.media_id || null,
    outboxId,
    actor,
    nowIso(),
  ).first();

  return json({
    ok,
    send_mode: 'attachment',
    media_type: mediaKind,
    filename,
    media_id: upload.media_id || null,
    provider_msg_id: sendResult.provider_msg_id || null,
    outbox_id: outboxId,
    message_id: inserted?.id || null,
    error: errText,
    meta_status: sendResult.status || upload.status,
  }, ok ? 200 : 502);
}

async function health(env) {
  const tables = ['comms_threads', 'comms_messages', 'comms_webhook_events', 'comms_quick_replies', 'comms_outbox'];
  const rows = await env.DB.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND name IN (${tables.map(() => '?').join(',')})
  `).bind(...tables).all();
  const have = new Set((rows.results || []).map(r => r.name));
  return json({
    ok: true,
    auth: {
      hn_comms_app_key_configured: !!env.HN_COMMS_APP_KEY,
      dashboard_key_fallback_configured: !!(env.DASHBOARD_KEY || env.DASHBOARD_API_KEY),
      active_source: env.HN_COMMS_APP_KEY ? 'HN_COMMS_APP_KEY' : (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY) ? 'DASHBOARD_KEY' : 'none',
    },
    tables: Object.fromEntries(tables.map(t => [t, have.has(t)])),
    brands: Object.fromEntries(['he', 'nch', 'sparksol'].map((brand) => {
      const cfg = brandConfig(env, brand);
      return [brand, {
        label: cfg?.label || brand,
        phone_id_configured: !!cfg?.phone_id,
        waba_id_configured: !!cfg?.waba_id,
        token_configured: !!cfg?.token,
        token_source: cfg?.token_source || 'none',
      }];
    })),
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'threads';

  if (request.method === 'GET') {
    if (!requireAuth(env, request)) return bad('unauthorized', 401);
    if (action === 'health') return await health(env);
    if (action === 'threads') return await listThreads(env, url);
    if (action === 'thread') return await loadThread(env, url);
    if (action === 'quick-replies') return await listQuickReplies(env, url);
    if (action === 'templates') return await listTemplates(env, url);
    return bad('unknown action', 404);
  }

  if (request.method !== 'POST') return bad('method not allowed', 405);

  if (action === 'attachment') {
    const form = await request.formData().catch(() => null);
    if (!form) return bad('multipart form required');
    const authBody = {
      comms_key: form.get('comms_key'),
      dashboard_key: form.get('dashboard_key'),
    };
    if (!requireAuth(env, request, authBody)) return bad('unauthorized', 401);
    return await sendAttachment(env, form);
  }

  const body = await request.json().catch(() => ({}));
  if (!requireAuth(env, request, body)) return bad('unauthorized', 401);

  if (action === 'reply' || body.action === 'reply') return await sendReply(env, body);
  if (action === 'mark-read' || body.action === 'mark_read') return await markRead(env, body);
  return bad('unknown action', 404);
}
