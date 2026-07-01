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

const THREAD_SOURCES = new Set(['all', 'hiring', 'darbar_staff', 'from_darbar', 'staff', 'customer']);

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

function mediaFilename(message, meta) {
  const rawBody = String(message.body || '').replace(/^\[[^\]]+\]\s*/, '').trim();
  const fromBody = rawBody && !rawBody.startsWith('[') ? rawBody : '';
  const mime = String(meta?.mime_type || '').toLowerCase();
  const ext = mime.includes('pdf') ? 'pdf'
    : mime.includes('png') ? 'png'
    : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
    : mime.includes('mp4') ? 'mp4'
    : mime.includes('mpeg') ? 'mp3'
    : 'bin';
  const base = fromBody || `${message.msg_type || 'media'}-${message.id}.${ext}`;
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 160) || `media-${message.id}.${ext}`;
}

async function fetchMedia(env, url) {
  const id = parseInt(url.searchParams.get('message_id') || url.searchParams.get('id') || '', 10);
  if (!id) return bad('message_id required');
  const message = await env.DB.prepare(`
    SELECT id, brand, msg_type, body, media_id
      FROM comms_messages
     WHERE id = ?
  `).bind(id).first();
  if (!message) return bad('message not found', 404);
  if (!message.media_id) return bad('message has no media', 404);

  const cfg = brandConfig(env, message.brand);
  if (!cfg?.token) return bad(`WABA token missing for ${message.brand}`, 500);

  const metaResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(message.media_id)}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  const meta = await metaResp.json().catch(() => ({}));
  if (!metaResp.ok || meta.error || !meta.url) {
    return bad(
      'This saved WhatsApp file is not currently retrievable from Meta. It may be old/expired or the brand token may not have access to that media object.',
      metaResp.status === 400 ? 410 : (metaResp.status || 502),
      { meta_error: meta?.error?.message || 'Meta media lookup failed' }
    );
  }

  const mediaResp = await fetch(meta.url, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  if (!mediaResp.ok) {
    const text = await mediaResp.text().catch(() => '');
    return bad(text || 'Meta media download failed', mediaResp.status || 502);
  }
  const headers = new Headers(CORS_HEADERS);
  const contentType = meta.mime_type || mediaResp.headers.get('content-type') || 'application/octet-stream';
  const filename = mediaFilename(message, meta);
  headers.set('content-type', contentType);
  headers.set('content-disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
  headers.set('cache-control', 'private, max-age=300');
  return new Response(mediaResp.body, { status: 200, headers });
}

function publicOutbox(row) {
  return {
    id: row.id,
    alert_id: row.alert_id || '',
    tier: row.tier || '',
    brand: row.brand || '',
    channel: row.channel || '',
    recipient_phone: row.recipient_phone || '',
    template_name: row.template_name || '',
    template_vars: parseJson(row.template_vars, []),
    body_text: row.body_text || '',
    status: row.status || '',
    provider_msg_id: row.provider_msg_id || '',
    error_text: row.error_text || '',
    sent_at: row.sent_at || '',
    delivered_at: row.delivered_at || '',
    read_at: row.read_at || '',
    acked_at: row.acked_at || '',
    ack_action: row.ack_action || '',
    created_at: row.created_at || '',
  };
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function threadIdFor(brand, phone) {
  return `${brand}:${normalizePhone(phone)}`;
}

function brandFromPhoneId(env, phoneId) {
  if (!phoneId) return null;
  if (phoneId === env.WA_NCH_PHONE_ID) return 'nch';
  if (phoneId === env.WA_SPARKSOL_PHONE_ID) return 'sparksol';
  if (phoneId === env.WA_HE_PHONE_ID || phoneId === env.WA_PHONE_ID) return 'he';
  return null;
}

function brandFromLabel(label, fallback = 'he') {
  const s = String(label || '').toLowerCase();
  if (s.includes('nawabi') || s.includes('nch')) return 'nch';
  if (s.includes('spark')) return 'sparksol';
  if (s.includes('hamza') || s === 'he') return 'he';
  if (['he', 'nch', 'sparksol'].includes(s)) return s;
  return fallback;
}

function coerceBrand(raw, fallback = 'he') {
  const b = String(raw || '').toLowerCase();
  if (['he', 'nch', 'sparksol'].includes(b)) return b;
  if (b === 'hq') return 'sparksol';
  return brandFromLabel(raw, fallback);
}

function normalizeIso(raw, fallback = nowIso()) {
  if (!raw) return fallback;
  const value = String(raw);
  if (/^\d+$/.test(value)) {
    const n = parseInt(value, 10);
    const ms = value.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
}

function serviceWindowExpiresAt(inboundIso) {
  const t = new Date(inboundIso).getTime();
  return Number.isFinite(t) ? new Date(t + 24 * 60 * 60 * 1000).toISOString() : null;
}

function safeStringify(value, max = 10000) {
  try { return JSON.stringify(value || {}).slice(0, max); } catch { return '{}'; }
}

function sourceForFilter(raw) {
  const source = String(raw || 'all').toLowerCase();
  return THREAD_SOURCES.has(source) ? source : 'all';
}

function hiringLeadContext(row) {
  return {
    source: 'Darbar Hiring',
    campaign_name: row.campaign_name || '',
    campaign_role: row.campaign_role || row.role || '',
    campaign_brand: row.campaign_brand || '',
    candidate_name: row.candidate_name || '',
    campaign_id: row.campaign_id ? String(row.campaign_id) : '',
    last_classified_at: nowIso(),
  };
}

function staffLeadContext(row) {
  return {
    source: 'From Darbar',
    staff_id: row.id ? String(row.id) : '',
    staff_name: row.known_as || row.name || '',
    staff_brand: row.brand_label || '',
    staff_role: row.job_name || '',
    staff_pin: row.pin || '',
    last_classified_at: nowIso(),
  };
}

function safeParse(raw) {
  if (!raw || typeof raw !== 'string') return raw && typeof raw === 'object' ? raw : null;
  try { return JSON.parse(raw); } catch { return null; }
}

function quoteIdent(name) {
  const n = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`unsafe identifier: ${n}`);
  return `"${n}"`;
}

async function tableExists(env, table) {
  const row = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
  ).bind(table).first();
  return !!row?.name;
}

async function tableColumns(env, table) {
  if (!(await tableExists(env, table))) return [];
  const rows = await env.DB.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  return (rows.results || []).map(r => r.name);
}

async function tableCount(env, table) {
  if (!(await tableExists(env, table))) return 0;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).first();
  return row?.n || 0;
}

async function historySources(env) {
  const tables = [
    'conversations',
    'messages',
    'webhook_events',
    'comms_webhook_events',
    'comms_outbox',
    'comms_threads',
    'comms_messages',
  ];
  const sources = {};
  for (const table of tables) {
    const exists = await tableExists(env, table);
    sources[table] = {
      exists,
      count: exists ? await tableCount(env, table) : 0,
      columns: exists ? await tableColumns(env, table) : [],
    };
  }
  return json({ ok: true, sources });
}

function wabaMessageBody(m) {
  if (!m) return '';
  if (m.type === 'text') return m.text?.body || '';
  if (m.type === 'button') return m.button?.text || m.button?.payload || '';
  if (m.type === 'interactive') {
    return m.interactive?.button_reply?.title
      || m.interactive?.button_reply?.id
      || m.interactive?.list_reply?.title
      || m.interactive?.list_reply?.id
      || '[interactive]';
  }
  if (m.type === 'image') return m.image?.caption || '[image]';
  if (m.type === 'video') return m.video?.caption || '[video]';
  if (m.type === 'document') return m.document?.filename || m.document?.caption || '[document]';
  if (m.type === 'audio') return '[audio]';
  if (m.type === 'sticker') return '[sticker]';
  if (m.type === 'location') return `${m.location?.latitude || ''},${m.location?.longitude || ''}`;
  if (m.type === 'contacts') {
    const c = m.contacts?.[0];
    return c ? `${c.name?.formatted_name || 'Contact'} ${c.phones?.[0]?.phone || ''}`.trim() : '[contact]';
  }
  if (m.type === 'reaction') return m.reaction?.emoji || '[reaction]';
  if (m.type === 'order') return '[cart/order]';
  return `[${m.type || 'message'}]`;
}

function wabaMediaId(m) {
  return m?.image?.id || m?.video?.id || m?.audio?.id || m?.document?.id || m?.sticker?.id || null;
}

function contactDisplayName(value, waId) {
  const contact = (value?.contacts || []).find(c => c.wa_id === waId) || value?.contacts?.[0];
  return contact?.profile?.name || '';
}

async function upsertThreadForMessage(env, message) {
  const brand = coerceBrand(message.brand);
  const phone = normalizePhone(message.phone);
  const threadId = threadIdFor(brand, phone);
  const createdAt = normalizeIso(message.created_at);
  const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
  const lastInboundAt = direction === 'inbound' ? createdAt : null;
  const lastOutboundAt = direction === 'outbound' ? createdAt : null;
  const unreadIncrement = direction === 'inbound' && message.status === 'unread' ? 1 : 0;
  const serviceExpires = direction === 'inbound' ? serviceWindowExpiresAt(createdAt) : null;
  const leadSource = message.lead_source || null;
  const leadStatus = message.lead_status || null;
  const leadContext = message.lead_context ? safeStringify(message.lead_context, 4000) : null;

  await env.DB.prepare(`
    INSERT INTO comms_threads
      (thread_id, brand, phone, wa_id, phone_number_id, display_name, status,
       lead_status, lead_source, lead_context_json,
       last_message_at, last_inbound_at, last_outbound_at, last_body, last_direction,
       last_msg_type, unread_count, service_window_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', COALESCE(?, 'unknown'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
       wa_id = COALESCE(excluded.wa_id, comms_threads.wa_id),
       phone_number_id = COALESCE(excluded.phone_number_id, comms_threads.phone_number_id),
       display_name = COALESCE(NULLIF(excluded.display_name, ''), comms_threads.display_name),
       lead_status = COALESCE(NULLIF(excluded.lead_status, 'unknown'), comms_threads.lead_status),
       lead_source = COALESCE(excluded.lead_source, comms_threads.lead_source),
       lead_context_json = COALESCE(excluded.lead_context_json, comms_threads.lead_context_json),
       status = CASE
         WHEN comms_threads.status = 'closed' AND excluded.last_direction = 'inbound' THEN 'open'
         ELSE comms_threads.status
       END,
       last_message_at = CASE
         WHEN comms_threads.last_message_at IS NULL OR excluded.last_message_at >= comms_threads.last_message_at
         THEN excluded.last_message_at ELSE comms_threads.last_message_at END,
       last_inbound_at = CASE
         WHEN excluded.last_inbound_at IS NOT NULL
          AND (comms_threads.last_inbound_at IS NULL OR excluded.last_inbound_at >= comms_threads.last_inbound_at)
         THEN excluded.last_inbound_at ELSE comms_threads.last_inbound_at END,
       last_outbound_at = CASE
         WHEN excluded.last_outbound_at IS NOT NULL
          AND (comms_threads.last_outbound_at IS NULL OR excluded.last_outbound_at >= comms_threads.last_outbound_at)
         THEN excluded.last_outbound_at ELSE comms_threads.last_outbound_at END,
       last_body = CASE
         WHEN comms_threads.last_message_at IS NULL OR excluded.last_message_at >= comms_threads.last_message_at
         THEN excluded.last_body ELSE comms_threads.last_body END,
       last_direction = CASE
         WHEN comms_threads.last_message_at IS NULL OR excluded.last_message_at >= comms_threads.last_message_at
         THEN excluded.last_direction ELSE comms_threads.last_direction END,
       last_msg_type = CASE
         WHEN comms_threads.last_message_at IS NULL OR excluded.last_message_at >= comms_threads.last_message_at
         THEN excluded.last_msg_type ELSE comms_threads.last_msg_type END,
       unread_count = comms_threads.unread_count + excluded.unread_count,
       service_window_expires_at = CASE
         WHEN excluded.service_window_expires_at IS NOT NULL
          AND (comms_threads.service_window_expires_at IS NULL OR excluded.service_window_expires_at >= comms_threads.service_window_expires_at)
         THEN excluded.service_window_expires_at ELSE comms_threads.service_window_expires_at END,
       updated_at = excluded.updated_at
  `).bind(
    threadId,
    brand,
    phone,
    normalizePhone(message.wa_id || phone),
    message.phone_number_id || null,
    String(message.display_name || '').slice(0, 160),
    leadStatus,
    leadSource,
    leadContext,
    createdAt,
    lastInboundAt,
    lastOutboundAt,
    String(message.body || '').slice(0, 500),
    direction,
    message.msg_type || 'text',
    unreadIncrement,
    serviceExpires,
    createdAt,
    nowIso(),
  ).run();
}

async function insertHistoryMessage(env, message) {
  const brand = coerceBrand(message.brand);
  const phone = normalizePhone(message.phone);
  if (!brand || !phone) return { inserted: false, reason: 'missing_brand_or_phone' };
  if (message.outbox_id) {
    const existing = await env.DB.prepare(
      `SELECT id FROM comms_messages WHERE outbox_id = ? LIMIT 1`
    ).bind(message.outbox_id).first();
    if (existing?.id) return { inserted: false, reason: 'duplicate_outbox_id' };
  }
  const threadId = threadIdFor(brand, phone);
  const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
  const status = message.status || (direction === 'inbound' ? 'received' : 'sent');
  const createdAt = normalizeIso(message.created_at);

  // Ensure the parent thread exists before inserting the child message. The
  // second upsert below applies the unread increment only after the message
  // insert succeeds, keeping repeated imports idempotent.
  await upsertThreadForMessage(env, {
    ...message,
    brand,
    phone,
    direction,
    status: status === 'unread' ? 'received' : status,
    created_at: createdAt,
  });

  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO comms_messages
      (thread_id, brand, phone, direction, msg_type, body, template_name, wamid,
       status, provider_response, error_text, media_id, raw_payload, outbox_id, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    threadId,
    brand,
    phone,
    direction,
    message.msg_type || 'text',
    String(message.body || '').slice(0, 4000),
    message.template_name || null,
    message.wamid || null,
    status,
    message.provider_response ? safeStringify(message.provider_response, 4000) : null,
    message.error_text || null,
    message.media_id || null,
    message.raw_payload ? safeStringify(message.raw_payload, 10000) : null,
    message.outbox_id || null,
    message.actor || 'history-import',
    createdAt,
  ).first();

  if (!inserted?.id) return { inserted: false, reason: 'duplicate_wamid' };
  await upsertThreadForMessage(env, { ...message, brand, phone, direction, status, created_at: createdAt });
  return { inserted: true, id: inserted.id };
}

function addByBrand(stats, brand, inserted) {
  const b = coerceBrand(brand);
  stats.by_brand[b] = stats.by_brand[b] || { inserted: 0, skipped: 0 };
  stats.by_brand[b][inserted ? 'inserted' : 'skipped'] += 1;
}

function blankImportStats(source, limit, offset) {
  return { source, limit, offset, scanned: 0, extracted: 0, inserted: 0, skipped: 0, by_brand: {} };
}

function extractWabaMessagesFromPayload(env, payload, fallback = {}) {
  const found = [];
  const pushFromValue = (value, rawContext) => {
    const phoneNumberId = value?.metadata?.phone_number_id || fallback.phone_number_id || null;
    const brand = brandFromPhoneId(env, phoneNumberId)
      || brandFromLabel(fallback.brand_label, fallback.brand || 'he');
    const contacts = value?.contacts || [];
    for (const m of value?.messages || []) {
      const phone = normalizePhone(m.from || fallback.phone || '');
      if (!phone) continue;
      found.push({
        brand,
        phone,
        wa_id: phone,
        phone_number_id: phoneNumberId,
        display_name: contactDisplayName({ contacts }, m.from) || fallback.display_name || '',
        direction: 'inbound',
        msg_type: m.type || fallback.msg_type || 'text',
        body: wabaMessageBody(m),
        wamid: m.id || fallback.wamid || null,
        status: 'unread',
        media_id: wabaMediaId(m),
        raw_payload: rawContext || m,
        created_at: normalizeIso(m.timestamp || fallback.created_at),
      });
    }
  };

  if (!payload) return found;
  if (Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      for (const change of entry.changes || []) pushFromValue(change.value || {}, payload);
    }
    return found;
  }
  if (Array.isArray(payload.messages)) {
    pushFromValue(payload, payload);
    return found;
  }
  if (payload.id && payload.from) {
    found.push({
      brand: brandFromLabel(fallback.brand_label, fallback.brand || 'he'),
      phone: normalizePhone(payload.from || fallback.phone || ''),
      wa_id: normalizePhone(payload.from || fallback.phone || ''),
      phone_number_id: fallback.phone_number_id || null,
      display_name: fallback.display_name || '',
      direction: 'inbound',
      msg_type: payload.type || fallback.msg_type || 'text',
      body: wabaMessageBody(payload),
      wamid: payload.id || fallback.wamid || null,
      status: 'unread',
      media_id: wabaMediaId(payload),
      raw_payload: payload,
      created_at: normalizeIso(payload.timestamp || fallback.created_at),
    });
  }
  return found.filter(m => m.phone);
}

function extractWabaStatusesFromPayload(env, payload, fallback = {}) {
  const found = [];
  const pushFromValue = (value, rawContext) => {
    const phoneNumberId = value?.metadata?.phone_number_id || fallback.phone_number_id || null;
    const brand = brandFromPhoneId(env, phoneNumberId)
      || brandFromLabel(fallback.brand_label, fallback.brand || 'he');
    for (const s of value?.statuses || []) {
      found.push({
        brand,
        wamid: s.id || fallback.wamid || null,
        phone: normalizePhone(s.recipient_id || fallback.phone || ''),
        status: s.status || fallback.status || 'status',
        error_text: s.errors?.[0]?.title || s.errors?.[0]?.message || fallback.error_text || null,
        raw_payload: rawContext || s,
        created_at: normalizeIso(s.timestamp || fallback.created_at),
      });
    }
  };
  if (!payload) return found;
  if (Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      for (const change of entry.changes || []) pushFromValue(change.value || {}, payload);
    }
    return found;
  }
  if (Array.isArray(payload.statuses)) {
    pushFromValue(payload, payload);
    return found;
  }
  return found;
}

async function mirrorHistoryStatus(env, status) {
  if (!status?.wamid) return false;
  await env.DB.prepare(`
    UPDATE comms_messages
       SET status = ?,
           provider_response = COALESCE(provider_response, ?),
           error_text = COALESCE(error_text, ?)
     WHERE wamid = ?
  `).bind(status.status, safeStringify(status.raw_payload, 4000), status.error_text || null, status.wamid).run();

  if (status.status === 'delivered') {
    await env.DB.prepare(`
      UPDATE comms_outbox
         SET status = 'delivered',
             delivered_at = COALESCE(delivered_at, ?)
       WHERE provider_msg_id = ?
    `).bind(status.created_at, status.wamid).run();
  } else if (status.status === 'read') {
    await env.DB.prepare(`
      UPDATE comms_outbox
         SET status = 'read',
             read_at = COALESCE(read_at, ?)
       WHERE provider_msg_id = ?
    `).bind(status.created_at, status.wamid).run();
  } else if (status.status === 'failed') {
    await env.DB.prepare(`
      UPDATE comms_outbox
         SET status = 'failed',
             error_text = COALESCE(error_text, ?)
       WHERE provider_msg_id = ?
    `).bind(status.error_text || 'WABA failed', status.wamid).run();
  }
  return true;
}

async function importLegacyConversations(env, { limit, offset }) {
  const stats = blankImportStats('conversations', limit, offset);
  if (!(await tableExists(env, 'conversations'))) return stats;
  const rows = await env.DB.prepare(`
    SELECT c.*, cam.brand AS campaign_brand, cam.name AS campaign_name,
           cam.role AS campaign_role, cam.category AS campaign_category
      FROM conversations c
      LEFT JOIN campaigns cam ON cam.id = c.campaign_id
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  for (const row of rows.results || []) {
    stats.scanned += 1;
    const direction = row.direction === 'outbound' ? 'outbound' : 'inbound';
    const brand = brandFromLabel(row.campaign_brand, 'he');
    const phone = normalizePhone(row.phone || '');
    if (!phone) { stats.skipped += 1; continue; }
    stats.extracted += 1;
    const result = await insertHistoryMessage(env, {
      brand,
      phone,
      wa_id: phone,
      display_name: row.candidate_name || '',
      direction,
      msg_type: row.msg_type || 'text',
      body: row.body || '',
      wamid: row.wamid || `legacy:conversation:${row.id}`,
      status: direction === 'inbound'
        ? (row.status === 'read' ? 'read' : 'unread')
        : (row.status || 'sent'),
      lead_source: row.campaign_id || row.campaign_category === 'hiring' ? 'hiring' : null,
      lead_status: row.status === 'read' ? 'active' : 'new',
      lead_context: row.campaign_id || row.campaign_category === 'hiring' ? hiringLeadContext(row) : null,
      media_id: row.media_id || null,
      raw_payload: { source: 'conversations', row },
      created_at: row.created_at,
    });
    stats[result.inserted ? 'inserted' : 'skipped'] += 1;
    addByBrand(stats, brand, result.inserted);
  }
  return stats;
}

async function importLegacyMessages(env, { limit, offset }) {
  const stats = blankImportStats('messages', limit, offset);
  if (!(await tableExists(env, 'messages'))) return stats;
  const rows = await env.DB.prepare(`
    SELECT m.*, cam.brand AS campaign_brand, cam.name AS campaign_name,
           cam.template_name AS campaign_template, cam.role AS campaign_role,
           cam.category AS campaign_category
      FROM messages m
      LEFT JOIN campaigns cam ON cam.id = m.campaign_id
     ORDER BY COALESCE(m.sent_at, m.queued_at, m.delivered_at, m.read_at, m.failed_at) ASC, m.id ASC
     LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  for (const row of rows.results || []) {
    stats.scanned += 1;
    const phone = normalizePhone(row.phone || '');
    if (!phone) { stats.skipped += 1; continue; }
    const brand = brandFromLabel(row.campaign_brand, 'he');
    const vars = safeParse(row.template_params);
    const varsText = Array.isArray(vars) && vars.length ? ` ${vars.join(' | ')}` : '';
    const templateName = row.campaign_template || row.template_name || '';
    const body = templateName
      ? `[template] ${templateName}${varsText}`
      : `[outbound] ${row.campaign_name || 'WhatsApp message'}${varsText}`;
    stats.extracted += 1;
    const result = await insertHistoryMessage(env, {
      brand,
      phone,
      wa_id: phone,
      display_name: row.candidate_name || '',
      direction: 'outbound',
      msg_type: 'template',
      body,
      template_name: templateName || null,
      wamid: row.wamid || `legacy:message:${row.id}`,
      status: row.status || 'queued',
      lead_source: row.campaign_id || row.campaign_category === 'hiring' ? 'hiring' : null,
      lead_status: 'active',
      lead_context: row.campaign_id || row.campaign_category === 'hiring' ? hiringLeadContext(row) : null,
      provider_response: row.error_message ? { error: row.error_message, code: row.error_code || null } : null,
      error_text: row.error_message || null,
      raw_payload: { source: 'messages', row },
      created_at: row.sent_at || row.queued_at || row.delivered_at || row.read_at || row.failed_at,
    });
    stats[result.inserted ? 'inserted' : 'skipped'] += 1;
    addByBrand(stats, brand, result.inserted);
  }
  return stats;
}

async function importWebhookTable(env, { table, rawColumn, limit, offset }) {
  const stats = blankImportStats(table, limit, offset);
  if (!(await tableExists(env, table))) return stats;
  const columns = await tableColumns(env, table);
  if (!columns.includes(rawColumn)) return stats;
  const orderColumns = ['received_at', 'timestamp', 'created_at']
    .filter(c => columns.includes(c))
    .map(quoteIdent);
  const orderExpr = orderColumns.length > 1
    ? `COALESCE(${orderColumns.join(', ')})`
    : (orderColumns[0] || quoteIdent('id'));
  const rows = await env.DB.prepare(`
    SELECT *
      FROM ${quoteIdent(table)}
     ORDER BY ${orderExpr} ASC, id ASC
     LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  for (const row of rows.results || []) {
    stats.scanned += 1;
    const payload = safeParse(row[rawColumn]);
    if (!payload) { stats.skipped += 1; continue; }
    const fallback = {
      brand: row.brand || null,
      phone_number_id: row.phone_number_id || null,
      phone: row.wa_id || row.phone || null,
      wamid: row.message_id || row.wamid || null,
      msg_type: row.status || row.event_kind || row.event_type || null,
      created_at: row.received_at || row.timestamp || row.created_at || null,
    };
    const messages = extractWabaMessagesFromPayload(env, payload, fallback);
    const statuses = extractWabaStatusesFromPayload(env, payload, fallback);
    stats.extracted += messages.length + statuses.length;
    for (const message of messages) {
      const result = await insertHistoryMessage(env, {
        ...message,
        wamid: message.wamid || `legacy:${table}:${row.id}:${stats.extracted}`,
        raw_payload: { source: table, source_id: row.id, payload: message.raw_payload || payload },
      });
      stats[result.inserted ? 'inserted' : 'skipped'] += 1;
      addByBrand(stats, message.brand, result.inserted);
    }
    for (const status of statuses) {
      const ok = await mirrorHistoryStatus(env, status);
      stats[ok ? 'inserted' : 'skipped'] += 1;
      addByBrand(stats, status.brand, ok);
    }
  }
  return stats;
}

async function importCommsOutbox(env, { limit, offset }) {
  const stats = blankImportStats('comms_outbox', limit, offset);
  if (!(await tableExists(env, 'comms_outbox'))) return stats;
  const rows = await env.DB.prepare(`
    SELECT *
      FROM comms_outbox
     WHERE channel = 'waba'
     ORDER BY COALESCE(sent_at, created_at) ASC, id ASC
     LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  for (const row of rows.results || []) {
    stats.scanned += 1;
    const phone = normalizePhone(row.recipient_phone || '');
    if (!phone) { stats.skipped += 1; continue; }
    const brand = coerceBrand(row.brand, 'sparksol');
    stats.extracted += 1;
    const result = await insertHistoryMessage(env, {
      brand,
      phone,
      wa_id: phone,
      direction: 'outbound',
      msg_type: row.template_name ? 'template' : 'text',
      body: row.body_text || (row.template_name ? `[template] ${row.template_name}` : '[outbound WABA]'),
      template_name: row.template_name || null,
      wamid: row.provider_msg_id || `outbox:${row.id}`,
      status: row.status || 'sent',
      lead_source: brand === 'sparksol' ? 'darbar_staff' : null,
      lead_status: brand === 'sparksol' ? 'active' : null,
      lead_context: brand === 'sparksol' ? { source: 'From Darbar', tier: row.tier || '', alert_id: row.alert_id || '' } : null,
      provider_response: safeParse(row.provider_response) || null,
      error_text: row.error_text || null,
      raw_payload: { source: 'comms_outbox', row },
      outbox_id: row.id,
      actor: row.tier || 'automation',
      created_at: row.sent_at || row.created_at,
    });
    stats[result.inserted ? 'inserted' : 'skipped'] += 1;
    addByBrand(stats, brand, result.inserted);
  }
  return stats;
}

function mergeImportStats(items) {
  const total = { scanned: 0, extracted: 0, inserted: 0, skipped: 0, by_brand: {} };
  for (const item of items) {
    total.scanned += item.scanned || 0;
    total.extracted += item.extracted || 0;
    total.inserted += item.inserted || 0;
    total.skipped += item.skipped || 0;
    for (const [brand, counts] of Object.entries(item.by_brand || {})) {
      total.by_brand[brand] = total.by_brand[brand] || { inserted: 0, skipped: 0 };
      total.by_brand[brand].inserted += counts.inserted || 0;
      total.by_brand[brand].skipped += counts.skipped || 0;
    }
  }
  return total;
}

async function importHistory(env, body) {
  const source = String(body.source || 'all').toLowerCase();
  const requestedLimit = parseInt(body.limit || '500', 10) || 500;
  const limit = source === 'all'
    ? Math.min(requestedLimit, 150)
    : Math.min(requestedLimit, 1000);
  const offset = Math.max(parseInt(body.offset || '0', 10) || 0, 0);
  const jobs = [];

  if (source === 'all' || source === 'conversations') jobs.push(importLegacyConversations(env, { limit, offset }));
  if (source === 'all' || source === 'messages') jobs.push(importLegacyMessages(env, { limit, offset }));
  if (source === 'all' || source === 'webhook_events') jobs.push(importWebhookTable(env, { table: 'webhook_events', rawColumn: 'raw_payload', limit, offset }));
  if (source === 'all' || source === 'comms_webhook_events') jobs.push(importWebhookTable(env, { table: 'comms_webhook_events', rawColumn: 'raw_json', limit, offset }));
  if (source === 'all' || source === 'comms_outbox') jobs.push(importCommsOutbox(env, { limit, offset }));
  if (!jobs.length) return bad('unknown history source');

  const results = [];
  for (const job of jobs) results.push(await job);
  const total = mergeImportStats(results);
  return json({
    ok: true,
    source,
    limit,
    offset,
    results,
    total,
    next_offset: offset + limit,
    note: 'No WhatsApp sends are performed by this import. It only normalizes already-saved D1 history into comms_threads/comms_messages.',
  });
}

async function classifyHiringThreads(env, { limit, offset }) {
  const stats = { source: 'hiring', scanned: 0, classified: 0, skipped: 0 };
  if (!(await tableExists(env, 'campaigns'))) return stats;
  const sources = [];
  if (await tableExists(env, 'conversations')) {
    sources.push(`
      SELECT c.phone, c.candidate_name, c.campaign_id,
             cam.name AS campaign_name, cam.role AS campaign_role,
             cam.brand AS campaign_brand, cam.category AS campaign_category,
             c.created_at AS created_at
        FROM conversations c
        LEFT JOIN campaigns cam ON cam.id = c.campaign_id
       WHERE c.phone IS NOT NULL
         AND trim(c.phone) != ''
         AND (c.campaign_id IS NOT NULL OR cam.category = 'hiring')
    `);
  }
  if (await tableExists(env, 'messages')) {
    sources.push(`
      SELECT m.phone, m.candidate_name, m.campaign_id,
             cam.name AS campaign_name, cam.role AS campaign_role,
             cam.brand AS campaign_brand, cam.category AS campaign_category,
             COALESCE(m.sent_at, m.queued_at, m.delivered_at, m.read_at, m.failed_at, datetime('now')) AS created_at
        FROM messages m
        LEFT JOIN campaigns cam ON cam.id = m.campaign_id
       WHERE m.phone IS NOT NULL
         AND trim(m.phone) != ''
         AND (m.campaign_id IS NOT NULL OR cam.category = 'hiring')
    `);
  }
  if (!sources.length) return stats;

  const rows = await env.DB.prepare(`
    WITH hiring_rows AS (
      ${sources.join('\nUNION ALL\n')}
    )
    SELECT phone,
           MAX(candidate_name) AS candidate_name,
           MAX(campaign_id) AS campaign_id,
           MAX(campaign_name) AS campaign_name,
           MAX(campaign_role) AS campaign_role,
           MAX(campaign_brand) AS campaign_brand,
           MAX(campaign_category) AS campaign_category,
           MAX(created_at) AS last_at,
           COUNT(*) AS total_messages
      FROM hiring_rows
     GROUP BY phone
     ORDER BY MAX(created_at) DESC
     LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  for (const row of rows.results || []) {
    stats.scanned += 1;
    const phone = normalizePhone(row.phone);
    if (!phone) { stats.skipped += 1; continue; }
    const context = hiringLeadContext(row);
    context.total_messages = String(row.total_messages || '');
    const result = await env.DB.prepare(`
      UPDATE comms_threads
         SET lead_source = 'hiring',
             lead_status = CASE WHEN unread_count > 0 THEN 'new' ELSE COALESCE(NULLIF(lead_status, 'unknown'), 'active') END,
             lead_context_json = ?,
             updated_at = ?
       WHERE phone = ?
    `).bind(safeStringify(context, 4000), nowIso(), phone).run();
    stats.classified += result.meta?.changes || 0;
  }
  return stats;
}

async function classifyStaffThreads(env) {
  const stats = { source: 'darbar_staff', scanned: 0, classified: 0, skipped: 0 };
  if (!(await tableExists(env, 'hr_employees'))) return stats;
  const rows = await env.DB.prepare(`
    SELECT id, pin, name, known_as, phone, brand_label, job_name
      FROM hr_employees
     WHERE is_active = 1
       AND phone IS NOT NULL
       AND trim(phone) != ''
  `).all();

  for (const row of rows.results || []) {
    stats.scanned += 1;
    const phone = normalizePhone(row.phone);
    if (!phone) { stats.skipped += 1; continue; }
    const result = await env.DB.prepare(`
      UPDATE comms_threads
         SET lead_source = 'darbar_staff',
             lead_status = COALESCE(NULLIF(lead_status, 'unknown'), 'active'),
             lead_context_json = ?,
             updated_at = ?
       WHERE phone = ?
    `).bind(safeStringify(staffLeadContext(row), 4000), nowIso(), phone).run();
    stats.classified += result.meta?.changes || 0;
  }

  const spark = await env.DB.prepare(`
    UPDATE comms_threads
       SET lead_source = 'darbar_staff',
           lead_status = COALESCE(NULLIF(lead_status, 'unknown'), 'active'),
           lead_context_json = COALESCE(lead_context_json, ?),
           updated_at = ?
     WHERE brand = 'sparksol'
  `).bind(safeStringify({ source: 'From Darbar', last_classified_at: nowIso() }, 4000), nowIso()).run();
  stats.classified += spark.meta?.changes || 0;
  return stats;
}

async function classifyHistory(env, body) {
  const source = sourceForFilter(body.source || 'all');
  const limit = Math.min(parseInt(body.limit || '500', 10) || 500, 1000);
  const offset = Math.max(parseInt(body.offset || '0', 10) || 0, 0);
  const results = [];
  if (source === 'all' || source === 'hiring') {
    results.push(await classifyHiringThreads(env, { limit, offset }));
  }
  if (source === 'all' || source === 'darbar_staff' || source === 'from_darbar' || source === 'staff') {
    results.push(await classifyStaffThreads(env));
  }
  if (!results.length) return bad('unknown source');
  return json({ ok: true, source, limit, offset, results });
}

async function listThreads(env, url) {
  const brand = url.searchParams.get('brand') || 'all';
  const leadStatus = url.searchParams.get('lead_status') || 'all';
  const status = url.searchParams.get('status') || 'all';
  const source = sourceForFilter(url.searchParams.get('source') || 'all');
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
  if (source === 'hiring') {
    where += " AND lead_source = 'hiring'";
  } else if (source === 'darbar_staff' || source === 'from_darbar' || source === 'staff') {
    where += " AND lead_source = 'darbar_staff'";
  } else if (source === 'customer') {
    where += " AND COALESCE(lead_source, '') NOT IN ('hiring', 'darbar_staff')";
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
    source,
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

async function listStaff(env) {
  const rows = await env.DB.prepare(`
    SELECT
      hr.id, hr.name, hr.phone, hr.brand_label, hr.job_name,
      MAX(CASE WHEN co.channel = 'waba' THEN co.status END) AS waba_status,
      MAX(CASE WHEN co.channel = 'waba' THEN co.consented_at END) AS waba_consented_at
    FROM hr_employees hr
    LEFT JOIN comms_optin co
      ON co.phone = (CASE WHEN length(trim(hr.phone)) = 10 THEN '91' || trim(hr.phone) ELSE trim(hr.phone) END)
     AND co.brand = 'sparksol'
    WHERE hr.is_active = 1
      AND hr.phone IS NOT NULL
      AND trim(hr.phone) != ''
    GROUP BY hr.id
    ORDER BY hr.brand_label, hr.name
  `).all();
  return json({
    ok: true,
    staff: (rows.results || []).map(row => ({
      id: row.id,
      name: row.name || '',
      phone: row.phone || '',
      e164: normalizePhone(row.phone || ''),
      brand: row.brand_label || '',
      role: row.job_name || '',
      waba_status: row.waba_status || 'not-tracked',
      waba_consented_at: row.waba_consented_at || null,
    })),
  });
}

async function listAutomationTrail(env, url) {
  const brand = (url.searchParams.get('brand') || 'all').toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '80', 10) || 80, 200);
  const params = [];
  let where = "WHERE channel = 'waba'";
  if (brand !== 'all') {
    where += ' AND brand = ?';
    params.push(brand);
  }
  const rows = await env.DB.prepare(`
    SELECT id, alert_id, tier, brand, channel, recipient_phone, template_name, template_vars,
           body_text, status, provider_msg_id, error_text, sent_at, delivered_at, read_at,
           acked_at, ack_action, created_at
      FROM comms_outbox
     ${where}
     ORDER BY COALESCE(sent_at, created_at) DESC, id DESC
     LIMIT ?
  `).bind(...params, limit).all();
  return json({ ok: true, trail: (rows.results || []).map(publicOutbox), limit });
}

async function listStaffCampaignTemplates(env) {
  const cfg = brandConfig(env, 'sparksol');
  if (!cfg?.token || !cfg?.waba_id) return bad('SparkSol WABA templates not configured', 500);
  const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.waba_id}/message_templates?limit=100&fields=name,status,category,language,components,id`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) return bad(data?.error?.message || 'Meta template lookup failed', resp.status || 502, { meta: data });
  const templates = (data.data || [])
    .filter(t => t.status === 'APPROVED')
    .map(t => {
      const body = (t.components || []).find(c => c.type === 'BODY');
      const text = body?.text || '';
      const varCount = (text.match(/\{\{\d+\}\}/g) || []).length;
      return {
        id: t.id || `${t.name}:${t.language || 'en'}`,
        name: t.name,
        status: t.status,
        category: t.category || '',
        language: t.language || 'en',
        body_text: text,
        var_count: varCount,
      };
    });
  return json({ ok: true, brand: 'sparksol', templates });
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

async function sendStaffCampaign(env, body) {
  const template = String(body.template || body.template_name || '').trim();
  const recipients = Array.isArray(body.recipients) ? body.recipients.map(normalizePhone).filter(Boolean) : [];
  const vars = Array.isArray(body.vars) ? body.vars.map(v => String(v)) : [];
  const language = body.language || 'en';
  const actor = String(body.actor || 'hn-comms-app').slice(0, 80);

  if (!template) return bad('template required');
  if (!recipients.length) return bad('recipients required');
  if (recipients.length > 200) return bad('max 200 recipients per campaign');

  const stamp = Date.now();
  const results = [];
  const staffRows = await env.DB.prepare(`
    SELECT id, pin, name, known_as, phone, brand_label, job_name
      FROM hr_employees
     WHERE is_active = 1
       AND phone IS NOT NULL
       AND trim(phone) != ''
  `).all().catch(() => ({ results: [] }));
  const staffByPhone = new Map((staffRows.results || []).map(row => [normalizePhone(row.phone), row]));
  for (let i = 0; i < recipients.length; i += 1) {
    const phone = recipients[i];
    let result = null;
    let errText = null;
    try {
      result = await sendWaba(env, { brand: 'sparksol', phone, template, vars, language });
      errText = result.ok ? null : providerError(result.response);
    } catch (err) {
      result = { ok: false, status: 500, provider_msg_id: null, response: { error: err?.message || String(err) } };
      errText = providerError(result.response);
    }
    const outboxId = await logOutbox(env, {
      alert_id: `hn_comms_staff_campaign:${stamp}:${i}`,
      tier: 'staff-campaign',
      brand: 'sparksol',
      channel: 'waba',
      recipient_phone: phone,
      template_name: template,
      template_vars: vars,
      body_text: `[staff campaign] ${template}`,
      status: result.ok ? 'sent' : 'failed',
      provider_msg_id: result.provider_msg_id || null,
      provider_response: { actor, response: result.response },
      error_text: errText,
    });
    const staff = staffByPhone.get(phone);
    await insertHistoryMessage(env, {
      brand: 'sparksol',
      phone,
      wa_id: phone,
      direction: 'outbound',
      msg_type: 'template',
      body: `[from Darbar] ${template}${vars.length ? ` ${vars.join(' | ')}` : ''}`,
      template_name: template,
      wamid: result.provider_msg_id || `staff-campaign:${stamp}:${i}`,
      status: result.ok ? 'sent' : 'failed',
      provider_response: { actor, response: result.response },
      error_text: errText,
      raw_payload: { source: 'staff-campaign', vars },
      outbox_id: outboxId,
      actor,
      lead_source: 'darbar_staff',
      lead_status: 'active',
      lead_context: staff ? staffLeadContext(staff) : { source: 'From Darbar' },
      created_at: nowIso(),
    });
    results.push({
      phone,
      ok: !!result.ok,
      status: result.status || null,
      provider_msg_id: result.provider_msg_id || null,
      outbox_id: outboxId,
      error: errText,
    });
  }

  return json({
    ok: results.every(r => r.ok),
    total: results.length,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
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
    if (action === 'media') return await fetchMedia(env, url);
    if (action === 'quick-replies') return await listQuickReplies(env, url);
    if (action === 'templates') return await listTemplates(env, url);
    if (action === 'staff') return await listStaff(env);
    if (action === 'staff-templates') return await listStaffCampaignTemplates(env);
    if (action === 'automation-trail') return await listAutomationTrail(env, url);
    if (action === 'history-sources') return await historySources(env);
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
  if (action === 'staff-campaign' || body.action === 'staff_campaign') return await sendStaffCampaign(env, body);
  if (action === 'mark-read' || body.action === 'mark_read') return await markRead(env, body);
  if (action === 'import-history' || body.action === 'import_history') return await importHistory(env, body);
  if (action === 'classify-history' || body.action === 'classify_history') return await classifyHistory(env, body);
  return bad('unknown action', 404);
}
