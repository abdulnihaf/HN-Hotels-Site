// Influencer Bio Pulse — enrich IG profiles via public web_profile_info endpoint
//
// POST /api/influencer-bio-pulse?action=enrich body={handles: [...up to 8...], run_id?: number}
// POST /api/influencer-bio-pulse?action=start-run body={total_requested: 605, triggered_by: 'nihaf'} → returns {run_id}
// POST /api/influencer-bio-pulse?action=finish-run body={run_id}
// GET  /api/influencer-bio-pulse?action=stats
// GET  /api/influencer-bio-pulse?action=list&min_followers=&has_contact=&category=&limit=
// GET  /api/influencer-bio-pulse?action=get&username=
// GET  /api/influencer-bio-pulse?action=runs

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Content-Type': 'application/json',
};

const IG_API = 'https://i.instagram.com/api/v1/users/web_profile_info/';
const IG_APP_ID = '936619743392459';
const UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Regex patterns — broad matches with cleanup
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const INDIAN_PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g;
const WHATSAPP_RE = /(?:wa\.me\/|whatsapp\.com\/send\?phone=|chat\.whatsapp\.com\/)([+\d-]+)/gi;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (action === 'enrich') return enrich(env, body);
      if (action === 'start-run') return startRun(env, body);
      if (action === 'finish-run') return finishRun(env, body);
      return json({ error: 'unknown POST action' }, 400);
    }
    if (request.method === 'GET') {
      if (action === 'stats') return getStats(env);
      if (action === 'list') return getList(env, url);
      if (action === 'get') return getOne(env, url.searchParams.get('username'));
      if (action === 'runs') return getRuns(env);
      return json({ error: 'unknown GET action' }, 400);
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: e.message, stack: e.stack?.slice(0, 500) }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENRICH — fetch a batch of IG handles, regex-extract contacts, upsert D1
// ─────────────────────────────────────────────────────────────────────────────
async function enrich(env, body) {
  const handles = (body.handles || []).filter(h => typeof h === 'string' && h.length > 0).map(h => h.replace(/^@/, '').toLowerCase());
  if (!handles.length) return json({ error: 'no handles' }, 400);
  if (handles.length > 12) return json({ error: 'max 12 handles per batch (rate limit safety)' }, 400);

  const results = [];
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    const t0 = Date.now();
    try {
      const r = await fetchProfile(h);
      const elapsed = Date.now() - t0;
      const stored = await storeResult(env, h, r, elapsed);
      results.push(stored);
    } catch (e) {
      const elapsed = Date.now() - t0;
      results.push(await storeError(env, h, e.message, elapsed));
    }
    // Inter-request delay to stay under IG soft throttle (~9 calls / 30s observed)
    if (i < handles.length - 1) await sleep(2500 + Math.random() * 1500); // 2.5–4s jitter
  }

  // Update run progress if run_id provided
  if (body.run_id) {
    const ok = results.filter(r => r.status === 'ok').length;
    const errs = results.filter(r => r.status === 'error').length;
    const rl = results.filter(r => r.status === 'rate_limit').length;
    await env.DB.prepare(`
      UPDATE influencer_bio_pulse_runs
      SET total_processed = total_processed + ?, total_ok = total_ok + ?, total_errors = total_errors + ?, total_rate_lim = total_rate_lim + ?
      WHERE id = ?
    `).bind(results.length, ok, errs, rl, body.run_id).run();
  }

  return json({ success: true, processed: results.length, results });
}

async function fetchProfile(username) {
  const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  const u = IG_API + '?username=' + encodeURIComponent(username);
  const resp = await fetch(u, {
    headers: {
      'x-ig-app-id': IG_APP_ID,
      'User-Agent': ua,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const txt = await resp.text();
  return { status: resp.status, body: txt, headers: Object.fromEntries(resp.headers) };
}

async function storeResult(env, username, raw, elapsedMs) {
  const status = classifyStatus(raw);
  if (status !== 'ok') {
    return await storeError(env, username, status, elapsedMs);
  }

  let user;
  try {
    const j = JSON.parse(raw.body);
    user = j?.data?.user;
    if (!user) return await storeError(env, username, 'no_user_in_response', elapsedMs);
  } catch (e) {
    return await storeError(env, username, 'json_parse_failed', elapsedMs);
  }

  const bio = user.biography || '';
  const bioLinks = user.bio_links || [];
  const contacts = extractContacts(bio, bioLinks);
  const hasEmail = contacts.emails.length > 0 || !!user.business_email;
  const hasPhone = contacts.phones.length > 0 || !!user.business_phone_number;
  const hasWa = contacts.whatsapp.length > 0;
  const channels = (hasEmail ? 1 : 0) + (hasPhone ? 1 : 0) + (hasWa ? 1 : 0);

  await env.DB.prepare(`
    INSERT INTO influencer_bio_pulse
      (username, full_name, biography, external_url, bio_links_json, category_name,
       is_business_account, is_professional_account, is_verified, is_private,
       followers_count, following_count, media_count, profile_pic_url,
       business_email, business_phone_number, business_contact_method,
       extracted_emails_json, extracted_phones_json, extracted_whatsapp_json,
       has_email, has_phone, has_whatsapp, has_any_contact, contact_channels,
       status, error_message, raw_response_size, fetched_at, fetch_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, datetime('now'), ?)
    ON CONFLICT(username) DO UPDATE SET
      full_name = excluded.full_name,
      biography = excluded.biography,
      external_url = excluded.external_url,
      bio_links_json = excluded.bio_links_json,
      category_name = excluded.category_name,
      is_business_account = excluded.is_business_account,
      is_professional_account = excluded.is_professional_account,
      is_verified = excluded.is_verified,
      is_private = excluded.is_private,
      followers_count = excluded.followers_count,
      following_count = excluded.following_count,
      media_count = excluded.media_count,
      profile_pic_url = excluded.profile_pic_url,
      business_email = excluded.business_email,
      business_phone_number = excluded.business_phone_number,
      business_contact_method = excluded.business_contact_method,
      extracted_emails_json = excluded.extracted_emails_json,
      extracted_phones_json = excluded.extracted_phones_json,
      extracted_whatsapp_json = excluded.extracted_whatsapp_json,
      has_email = excluded.has_email,
      has_phone = excluded.has_phone,
      has_whatsapp = excluded.has_whatsapp,
      has_any_contact = excluded.has_any_contact,
      contact_channels = excluded.contact_channels,
      status = 'ok',
      error_message = NULL,
      raw_response_size = excluded.raw_response_size,
      fetched_at = datetime('now'),
      fetch_duration_ms = excluded.fetch_duration_ms
  `).bind(
    username,
    user.full_name || null,
    bio,
    user.external_url || null,
    JSON.stringify(bioLinks),
    user.category_name || null,
    user.is_business_account ? 1 : 0,
    user.is_professional_account ? 1 : 0,
    user.is_verified ? 1 : 0,
    user.is_private ? 1 : 0,
    user.edge_followed_by?.count ?? null,
    user.edge_follow?.count ?? null,
    user.edge_owner_to_timeline_media?.count ?? null,
    user.profile_pic_url_hd || user.profile_pic_url || null,
    user.business_email || null,
    user.business_phone_number || null,
    user.business_contact_method || null,
    JSON.stringify(contacts.emails),
    JSON.stringify(contacts.phones),
    JSON.stringify(contacts.whatsapp),
    hasEmail ? 1 : 0,
    hasPhone ? 1 : 0,
    hasWa ? 1 : 0,
    (channels > 0) ? 1 : 0,
    channels,
    raw.body.length,
    elapsedMs
  ).run();

  return {
    username,
    status: 'ok',
    has_any_contact: channels > 0,
    contact_channels: channels,
    followers: user.edge_followed_by?.count,
  };
}

async function storeError(env, username, errMsg, elapsedMs) {
  const status = errMsg === 'rate_limit' ? 'rate_limit' :
                 errMsg === 'not_found' ? 'not_found' :
                 errMsg === 'private' ? 'private' : 'error';
  await env.DB.prepare(`
    INSERT INTO influencer_bio_pulse (username, status, error_message, fetched_at, fetch_duration_ms)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(username) DO UPDATE SET
      status = CASE WHEN influencer_bio_pulse.status = 'ok' THEN influencer_bio_pulse.status ELSE excluded.status END,
      error_message = excluded.error_message,
      fetched_at = excluded.fetched_at,
      fetch_duration_ms = excluded.fetch_duration_ms
  `).bind(username, status, errMsg, elapsedMs).run();
  return { username, status, error: errMsg };
}

function classifyStatus(raw) {
  if (raw.status === 200 && raw.body && raw.body.length > 1000) return 'ok';
  if (raw.status === 200 && raw.body && raw.body.length < 200) return 'rate_limit';   // stripped skeleton
  if (raw.status === 404) return 'not_found';
  if (raw.status === 429) return 'rate_limit';
  if (raw.status === 403) return 'rate_limit';
  if (raw.status === 401) return 'private';
  return 'error';
}

function extractContacts(bio, bioLinks) {
  const txt = bio || '';
  const emails = new Set();
  const phones = new Set();
  const wa = new Set();

  for (const m of txt.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (e.endsWith('.png') || e.endsWith('.jpg') || e.endsWith('.svg')) continue; // dud
    emails.add(e);
  }
  for (const m of txt.matchAll(INDIAN_PHONE_RE)) {
    const p = normalizePhone(m[0]);
    if (p) phones.add(p);
  }
  for (const m of txt.matchAll(WHATSAPP_RE)) {
    const w = normalizePhone(m[1]);
    if (w) wa.add(w);
  }

  // Also scan bio_links URLs
  for (const link of (bioLinks || [])) {
    const candidates = [link.url, link.lynx_url].filter(Boolean);
    for (const u of candidates) {
      const decoded = tryDecode(u);
      for (const m of decoded.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());
      for (const m of decoded.matchAll(WHATSAPP_RE)) {
        const w = normalizePhone(m[1]);
        if (w) wa.add(w);
      }
      // mailto: links
      if (decoded.startsWith('mailto:')) {
        const e = decoded.slice(7).split('?')[0].toLowerCase();
        if (e.includes('@')) emails.add(e);
      }
    }
  }

  return {
    emails: [...emails],
    phones: [...phones],
    whatsapp: [...wa],
  };
}

function normalizePhone(s) {
  if (!s) return null;
  const digits = String(s).replace(/[^\d+]/g, '');
  // Strip leading +91 / 91 to get 10-digit, then add +91 back if 10 digits starting 6-9
  let m = digits.match(/(?:\+?91)?([6-9]\d{9})/);
  if (m) return '+91' + m[1];
  m = digits.match(/^([6-9]\d{9})$/);
  if (m) return '+91' + m[1];
  // International format from wa.me links
  if (digits.startsWith('+') && digits.length >= 11) return digits;
  return null;
}

function tryDecode(u) {
  try {
    // Instagram bio links sometimes wrap external URLs as l.instagram.com/?u=...
    if (u.includes('l.instagram.com') && u.includes('u=')) {
      const inner = new URL(u).searchParams.get('u');
      if (inner) return decodeURIComponent(inner);
    }
    return u;
  } catch (_) { return u; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// RUNS
// ─────────────────────────────────────────────────────────────────────────────
async function startRun(env, body) {
  const r = await env.DB.prepare(`
    INSERT INTO influencer_bio_pulse_runs (total_requested, triggered_by, notes)
    VALUES (?, ?, ?)
  `).bind(body.total_requested || 0, body.triggered_by || 'unknown', body.notes || null).run();
  return json({ success: true, run_id: r.meta.last_row_id });
}

async function finishRun(env, body) {
  if (!body.run_id) return json({ error: 'run_id required' }, 400);
  await env.DB.prepare(`UPDATE influencer_bio_pulse_runs SET completed_at = datetime('now') WHERE id = ?`).bind(body.run_id).run();
  return json({ success: true });
}

async function getRuns(env) {
  const r = await env.DB.prepare(`SELECT * FROM influencer_bio_pulse_runs ORDER BY id DESC LIMIT 30`).all();
  return json({ success: true, runs: r.results });
}

// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────
async function getStats(env) {
  const total = await env.DB.prepare(`SELECT COUNT(*) c FROM influencer_bio_pulse`).first();
  const byStatus = await env.DB.prepare(`SELECT status, COUNT(*) c FROM influencer_bio_pulse GROUP BY status`).all();
  const contacts = await env.DB.prepare(`
    SELECT
      SUM(has_email) AS with_email,
      SUM(has_phone) AS with_phone,
      SUM(has_whatsapp) AS with_whatsapp,
      SUM(has_any_contact) AS with_any_contact,
      SUM(is_business_account) AS business_accts,
      SUM(is_verified) AS verified
    FROM influencer_bio_pulse WHERE status = 'ok'
  `).first();
  const byCategory = await env.DB.prepare(`
    SELECT category_name, COUNT(*) c FROM influencer_bio_pulse
    WHERE status = 'ok' AND category_name IS NOT NULL
    GROUP BY category_name ORDER BY c DESC LIMIT 20
  `).all();
  return json({
    success: true,
    total: total.c,
    by_status: byStatus.results,
    contacts,
    top_categories: byCategory.results,
  });
}

async function getList(env, url) {
  const params = url.searchParams;
  const minF = parseInt(params.get('min_followers') || '0', 10);
  const maxF = parseInt(params.get('max_followers') || '100000000', 10);
  const hasContact = params.get('has_contact');
  const cat = params.get('category');
  const limit = Math.min(parseInt(params.get('limit') || '500', 10), 1000);
  let sql = `SELECT * FROM influencer_bio_pulse WHERE status = 'ok' AND followers_count BETWEEN ? AND ?`;
  const args = [minF, maxF];
  if (hasContact === '1') sql += ' AND has_any_contact = 1';
  if (hasContact === '0') sql += ' AND has_any_contact = 0';
  if (cat) { sql += ' AND category_name = ?'; args.push(cat); }
  sql += ' ORDER BY contact_channels DESC, followers_count DESC LIMIT ?';
  args.push(limit);
  const r = await env.DB.prepare(sql).bind(...args).all();
  return json({ success: true, count: r.results.length, results: r.results });
}

async function getOne(env, username) {
  if (!username) return json({ error: 'username required' }, 400);
  const u = username.replace(/^@/, '').toLowerCase();
  const r = await env.DB.prepare(`SELECT * FROM influencer_bio_pulse WHERE username = ?`).bind(u).first();
  if (!r) return json({ success: false, found: false });
  return json({ success: true, found: true, profile: r });
}
