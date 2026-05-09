// /api/influencer-outreach
//
// 3-channel cold outreach hub for the May 2026 campaign:
//   - email   (Gmail SMTP via local Python sender + log-back)
//   - waba    (Meta Cloud API via shared comms-core sendWaba)
//   - ig_dm   (Chrome MCP manual send + log-back)
//
// All actual *sending* happens at the edge of this surface:
//   • Email: a local Python daemon reads `?action=queue&channel=email`, sends via Gmail,
//     posts back via `?action=log` with status='sent'.
//   • WABA:  this Worker calls sendWaba() directly, then stores the outreach row.
//   • IG DM: Nihaf opens the IG profile via Chrome MCP, manually pastes the prepared
//     text from `?action=ig-dm-payload`, then taps a "Mark Sent" button that POSTs
//     `?action=log` with channel='ig_dm', status='sent'.
//
// One row per send attempt. Replies hit `?action=record-reply` (or arrive on WABA webhook).
// Booking tokens generated per outreach so we can attribute conversions.

import { sendWaba, normalizePhone } from './_lib/comms-core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
};
const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
});

const requireKey = (env, request) => {
  const key = request.headers.get('X-Dashboard-Key') || new URL(request.url).searchParams.get('key');
  return key && key === env.DASHBOARD_API_KEY;
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (request.method === 'GET') {
      if (action === 'list')             return await getList(env, url);
      if (action === 'stats')            return await getStats(env);
      if (action === 'queue')            return await getQueue(env, url);
      if (action === 'history')          return await getHistory(env, url);
      if (action === 'ig-dm-payload')    return await getIgDmPayload(env, url);
      if (action === 'email-payload')    return await getEmailPayload(env, url);
    }

    if (request.method === 'POST') {
      const body = await safeJson(request);
      if (action === 'log')              return await logOutreach(env, body);
      if (action === 'send-waba')        return await actionSendWaba(env, body, request);
      if (action === 'record-reply')     return await recordReply(env, body, request);
      if (action === 'mark-bounce')      return await markBounce(env, body, request);
      if (action === 'create-batch')     return await createBatch(env, body, request);
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// READS
// ────────────────────────────────────────────────────────────────────────────

async function getList(env, url) {
  // Returns BLR + 5K-100K + has_contact creators with outreach summary per channel.
  const minF = parseInt(url.searchParams.get('min_followers') || '5000');
  const maxF = parseInt(url.searchParams.get('max_followers') || '100000');
  const requireFood = url.searchParams.get('food') !== '0';
  const channel = url.searchParams.get('channel');           // optional: only-with-contact-on-channel
  const onlyUncontacted = url.searchParams.get('uncontacted') === '1';

  const FOOD_PATTERNS = [
    'food','biryani','foodie','blogger','cafe','restaurant','eats','cuisine',
    'kitchen','dine','chef','review','halal','muslim','street food','hyderab',
    'dakhni','kebab','kabab','mughlai','baker','dessert','chai','coffee','creator','lifestyle',
  ];
  const BLR_PATTERNS = ['bangalore','blr','bengaluru',"b'lore",'banglore','bglr'];

  const blrLikes = BLR_PATTERNS.map(p => `LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%${p}%'`).join(' OR ');
  const foodLikes = FOOD_PATTERNS.map(p => `LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'') || ' ' || IFNULL(p.category_name,'')) LIKE '%${p}%'`).join(' OR ');

  let where = `p.status='ok' AND p.is_private=0
    AND p.followers_count BETWEEN ? AND ?
    AND p.has_any_contact=1
    AND (${blrLikes})`;
  if (requireFood) where += ` AND (${foodLikes})`;
  if (channel === 'email')    where += ` AND p.has_email=1`;
  if (channel === 'waba')     where += ` AND p.has_phone=1`;
  if (channel === 'whatsapp') where += ` AND p.has_whatsapp=1`;

  let sql = `
    SELECT
      p.username, p.full_name, p.biography, p.followers_count, p.is_business_account,
      p.is_verified, p.is_private, p.category_name, p.profile_pic_url,
      p.has_email, p.has_phone, p.has_whatsapp,
      p.business_email, p.business_phone_number,
      p.extracted_emails_json, p.extracted_phones_json, p.extracted_whatsapp_json,
      s.email_sent_at, s.email_status,
      s.waba_sent_at,  s.waba_status,
      s.ig_dm_sent_at, s.ig_dm_status,
      s.last_replied_at, s.total_attempts
    FROM influencer_bio_pulse p
    LEFT JOIN v_influencer_outreach_summary s ON s.username = p.username
    WHERE ${where}
    ORDER BY
      (CASE WHEN p.is_business_account=1 THEN 1 ELSE 0 END
       + CASE WHEN p.is_verified=1 THEN 1 ELSE 0 END
       + CASE WHEN p.followers_count BETWEEN 15000 AND 50000 THEN 1 ELSE 0 END
       + p.contact_channels) DESC,
      p.followers_count DESC
    LIMIT 500`;

  if (onlyUncontacted) {
    sql = sql.replace('LEFT JOIN v_influencer_outreach_summary s ON s.username = p.username',
                      'LEFT JOIN v_influencer_outreach_summary s ON s.username = p.username');
    sql = sql.replace('LIMIT 500', 'AND s.total_attempts IS NULL LIMIT 500');
  }

  const r = await env.DB.prepare(sql).bind(minF, maxF).all();
  return json({ success: true, count: r.results.length, results: r.results });
}

async function getStats(env) {
  const stats = await env.DB.prepare(`
    SELECT
      channel,
      status,
      COUNT(*) c
    FROM influencer_outreach
    WHERE campaign = 'may_2026_v1'
    GROUP BY channel, status
  `).all();

  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) total_sends,
      SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) bounced,
      COUNT(DISTINCT username) unique_creators_contacted
    FROM influencer_outreach
    WHERE campaign = 'may_2026_v1'
  `).first();

  const today = await env.DB.prepare(`
    SELECT channel, COUNT(*) c
    FROM influencer_outreach
    WHERE date(sent_at, 'localtime') = date('now', 'localtime')
    GROUP BY channel
  `).all();

  return json({ success: true, totals, by_channel_status: stats.results, today: today.results });
}

async function getQueue(env, url) {
  // Returns N creators ready to be sent on a given channel today.
  const channel = url.searchParams.get('channel');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  if (!channel) return json({ error: 'channel required' }, 400);

  const contactCol =
    channel === 'email' ? 'p.has_email' :
    channel === 'waba' || channel === 'sms' ? 'p.has_phone' :
    channel === 'ig_dm' ? '1' :
    'p.has_any_contact';

  const r = await env.DB.prepare(`
    SELECT p.username, p.full_name, p.biography, p.followers_count, p.is_business_account,
           p.is_verified, p.business_email, p.business_phone_number,
           p.extracted_emails_json, p.extracted_phones_json, p.extracted_whatsapp_json,
           p.category_name, p.has_email, p.has_phone
    FROM influencer_bio_pulse p
    LEFT JOIN influencer_outreach o
           ON o.username = p.username AND o.channel = ? AND o.campaign = 'may_2026_v1'
    WHERE p.status='ok' AND p.is_private=0
      AND p.followers_count BETWEEN 5000 AND 100000
      AND ${contactCol} = 1
      AND o.id IS NULL
      AND (
        LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bangalore%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%blr%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bengaluru%'
      )
    ORDER BY
      (CASE WHEN p.is_business_account=1 THEN 1 ELSE 0 END
       + CASE WHEN p.is_verified=1 THEN 1 ELSE 0 END
       + CASE WHEN p.followers_count BETWEEN 15000 AND 50000 THEN 1 ELSE 0 END
       + p.contact_channels) DESC,
      p.followers_count DESC
    LIMIT ?
  `).bind(channel, limit).all();

  return json({ success: true, channel, count: r.results.length, queue: r.results });
}

async function getHistory(env, url) {
  const username = url.searchParams.get('username');
  if (!username) return json({ error: 'username required' }, 400);
  const r = await env.DB.prepare(`
    SELECT * FROM influencer_outreach
    WHERE username = ? AND campaign = 'may_2026_v1'
    ORDER BY sent_at DESC
  `).bind(username.toLowerCase()).all();
  return json({ success: true, history: r.results });
}

async function getIgDmPayload(env, url) {
  const username = url.searchParams.get('username');
  if (!username) return json({ error: 'username required' }, 400);
  const p = await env.DB.prepare(`
    SELECT username, full_name, biography, followers_count, category_name
    FROM influencer_bio_pulse WHERE username = ?
  `).bind(username.toLowerCase()).first();
  if (!p) return json({ error: 'not found' }, 404);

  const tier = pickTier(p.followers_count);
  const niche = pickNiche(p);
  const firstName = pickFirstName(p);
  const token = genToken();
  const igMsg = renderIgDm(firstName, niche, tier, token);
  return json({
    success: true,
    username,
    profile_url: 'https://instagram.com/' + username + '/',
    dm_url: 'https://www.instagram.com/direct/new/?username=' + username,
    message: igMsg,
    token,
    tier: tier.name,
    cover_offer: tier.covers,
  });
}

async function getEmailPayload(env, url) {
  const username = url.searchParams.get('username');
  if (!username) return json({ error: 'username required' }, 400);
  const p = await env.DB.prepare(`
    SELECT username, full_name, biography, followers_count, category_name,
           business_email, extracted_emails_json
    FROM influencer_bio_pulse WHERE username = ?
  `).bind(username.toLowerCase()).first();
  if (!p) return json({ error: 'not found' }, 404);

  const emails = pickRecipientEmails(p);
  if (!emails.length) return json({ error: 'no email available' }, 400);

  const tier = pickTier(p.followers_count);
  const niche = pickNiche(p);
  const firstName = pickFirstName(p);
  const token = genToken();

  return json({
    success: true,
    username,
    recipient: emails[0],
    all_emails: emails,
    subject: 'Barter collab — 1918 Hamza Express, Shivajinagar',
    body: renderEmailBody(firstName, niche, tier, token, username),
    token,
    tier: tier.name,
    cover_offer: tier.covers,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// WRITES
// ────────────────────────────────────────────────────────────────────────────

async function logOutreach(env, body) {
  // Used by all 3 channels — local Python email sender, IG-DM mark-sent, manual log.
  // Owner-gated by DASHBOARD_API_KEY.
  if (!env.DASHBOARD_API_KEY || body.key !== env.DASHBOARD_API_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }
  const required = ['username','channel','status'];
  for (const f of required) if (!body[f]) return json({ error: f + ' required' }, 400);

  const r = await env.DB.prepare(`
    INSERT INTO influencer_outreach (
      username, channel, status, recipient, template_used, subject, message_text,
      outreach_token, provider, provider_msg_id, campaign, tier_assigned, cover_offer,
      niche_tag, sent_at, delivered_at, read_at, replied_at, reply_text, bounce_reason,
      notes, actor
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    String(body.username).toLowerCase(),
    body.channel,
    body.status,
    body.recipient || null,
    body.template_used || null,
    body.subject || null,
    body.message_text || null,
    body.outreach_token || null,
    body.provider || null,
    body.provider_msg_id || null,
    body.campaign || 'may_2026_v1',
    body.tier_assigned || null,
    body.cover_offer || null,
    body.niche_tag || null,
    body.sent_at || null,
    body.delivered_at || null,
    body.read_at || null,
    body.replied_at || null,
    body.reply_text || null,
    body.bounce_reason || null,
    body.notes || null,
    body.actor || 'system'
  ).run();

  return json({ success: true, id: r.meta.last_row_id });
}

async function actionSendWaba(env, body, request) {
  if (!requireKey(env, request)) return json({ error: 'unauthorized' }, 401);
  const required = ['username','template'];
  for (const f of required) if (!body[f]) return json({ error: f + ' required' }, 400);

  const p = await env.DB.prepare(`
    SELECT username, full_name, biography, followers_count, category_name,
           business_phone_number, extracted_phones_json
    FROM influencer_bio_pulse WHERE username = ?
  `).bind(String(body.username).toLowerCase()).first();
  if (!p) return json({ error: 'creator not found' }, 404);

  const phones = pickRecipientPhones(p);
  const phone = body.phone || phones[0];
  if (!phone) return json({ error: 'no phone available' }, 400);

  const tier = pickTier(p.followers_count);
  const niche = pickNiche(p);
  const firstName = pickFirstName(p);
  const token = body.outreach_token || genToken();

  const vars = body.vars || [
    firstName,
    niche,
    String(tier.covers),
    token,
  ];

  const sendResult = await sendWaba(env, {
    brand: body.brand || 'he',
    phone,
    template: body.template,
    vars,
    language: body.language || 'en',
    buttons: [
      { sub_type: 'url', index: 0, url_token: token },
    ],
  });

  // Log row
  const txt = `Hi ${firstName}, Hamza Express here — Bangalore's 1918 Dakhni biryani (Shivajinagar). Saw your ${niche} content. We'd love to host you for ${tier.covers}-cover barter collab. Pick your slot: hnhotels.in/marketing/Influencer/booking/?t=${token}`;

  const ins = await env.DB.prepare(`
    INSERT INTO influencer_outreach (
      username, channel, status, recipient, template_used, message_text,
      outreach_token, provider, provider_msg_id, tier_assigned, cover_offer,
      niche_tag, actor
    ) VALUES (?, 'waba', ?, ?, ?, ?, ?, 'meta-cloud-api', ?, ?, ?, ?, 'system')
  `).bind(
    p.username,
    sendResult.ok ? 'sent' : 'failed',
    phone,
    body.template,
    txt,
    token,
    sendResult.provider_msg_id || null,
    tier.name,
    tier.covers,
    niche
  ).run();

  return json({
    success: sendResult.ok,
    outreach_id: ins.meta.last_row_id,
    waba_status: sendResult.status,
    provider_msg_id: sendResult.provider_msg_id,
    response: sendResult.response,
  });
}

async function recordReply(env, body, request) {
  if (!requireKey(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.channel) return json({ error: 'username + channel required' }, 400);

  await env.DB.prepare(`
    UPDATE influencer_outreach
    SET status = 'replied',
        replied_at = datetime('now'),
        reply_text = COALESCE(?, reply_text)
    WHERE username = ? AND channel = ? AND campaign = 'may_2026_v1'
      AND id = (SELECT MAX(id) FROM influencer_outreach
                WHERE username = ? AND channel = ? AND campaign = 'may_2026_v1')
  `).bind(body.reply_text || null, body.username, body.channel, body.username, body.channel).run();

  return json({ success: true });
}

async function markBounce(env, body, request) {
  if (!requireKey(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.channel) return json({ error: 'username + channel required' }, 400);
  await env.DB.prepare(`
    UPDATE influencer_outreach
    SET status='bounced', bounce_reason=?
    WHERE username=? AND channel=? AND campaign='may_2026_v1'
      AND id = (SELECT MAX(id) FROM influencer_outreach WHERE username=? AND channel=? AND campaign='may_2026_v1')
  `).bind(body.reason || 'unknown', body.username, body.channel, body.username, body.channel).run();
  return json({ success: true });
}

async function createBatch(env, body, request) {
  // Pre-allocate outreach rows in 'queued' status. Used by the local Python email sender
  // to claim a batch of work atomically. Returns the rows it should send.
  if (!requireKey(env, request)) return json({ error: 'unauthorized' }, 401);
  const channel = body.channel || 'email';
  const limit = body.limit || 20;

  // Get queue
  const qr = await env.DB.prepare(`
    SELECT p.username, p.full_name, p.biography, p.followers_count, p.category_name,
           p.business_email, p.business_phone_number,
           p.extracted_emails_json, p.extracted_phones_json, p.extracted_whatsapp_json
    FROM influencer_bio_pulse p
    LEFT JOIN influencer_outreach o
      ON o.username = p.username AND o.channel = ? AND o.campaign='may_2026_v1'
    WHERE p.status='ok' AND p.is_private=0
      AND p.followers_count BETWEEN 5000 AND 100000
      AND ${channel === 'email' ? 'p.has_email=1' : channel === 'waba' ? 'p.has_phone=1' : '1=1'}
      AND o.id IS NULL
      AND (LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bangalore%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%blr%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bengaluru%')
    ORDER BY
      (CASE WHEN p.is_business_account=1 THEN 1 ELSE 0 END
       + CASE WHEN p.is_verified=1 THEN 1 ELSE 0 END
       + CASE WHEN p.followers_count BETWEEN 15000 AND 50000 THEN 1 ELSE 0 END) DESC,
      p.followers_count DESC
    LIMIT ?
  `).bind(channel, limit).all();

  // For each, generate token + assemble payload
  const batch = [];
  for (const r of qr.results) {
    const tier = pickTier(r.followers_count);
    const niche = pickNiche(r);
    const firstName = pickFirstName(r);
    const token = genToken();

    let payload;
    if (channel === 'email') {
      const emails = pickRecipientEmails(r);
      if (!emails.length) continue;
      payload = {
        username: r.username,
        recipient: emails[0],
        subject: 'Barter collab — 1918 Hamza Express, Shivajinagar',
        body: renderEmailBody(firstName, niche, tier, token, r.username),
        token, tier: tier.name, cover_offer: tier.covers, niche_tag: niche,
      };
    } else if (channel === 'waba') {
      const phones = pickRecipientPhones(r);
      if (!phones.length) continue;
      payload = {
        username: r.username,
        recipient: phones[0],
        token, tier: tier.name, cover_offer: tier.covers, niche_tag: niche,
        vars: [firstName, niche, String(tier.covers), token],
      };
    }

    if (payload) {
      // Pre-insert as 'queued' so the same row is not picked up twice
      await env.DB.prepare(`
        INSERT INTO influencer_outreach (
          username, channel, status, recipient, outreach_token, tier_assigned,
          cover_offer, niche_tag, actor
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, 'batch_creator')
      `).bind(r.username, channel, payload.recipient, token, tier.name, tier.covers, niche).run();

      batch.push(payload);
    }
  }

  return json({ success: true, batch_size: batch.length, batch });
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function pickTier(followers) {
  const f = followers || 0;
  if (f < 15000) return { name: 'T1', covers: 2 };
  if (f < 50000) return { name: 'T2', covers: 4 };
  if (f < 100000) return { name: 'T3', covers: 6 };
  return { name: 'T4', covers: 8 };
}

function pickFirstName(p) {
  const fn = p.full_name || '';
  const cleaned = fn.replace(/[^\w\s'-]/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  if (first && first.length > 1 && first.length < 20) return first;
  // Fallback to capitalised username
  const u = String(p.username || '').replace(/[._]/g, ' ').split(' ')[0];
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function pickNiche(p) {
  const blob = (String(p.biography || '') + ' ' + String(p.category_name || '')).toLowerCase();
  if (/biryani|hyderab|dakhni|mughlai|kebab|kabab/.test(blob)) return 'biryani & Dakhni food';
  if (/cafe|coffee|chai/.test(blob)) return 'BLR cafes';
  if (/street food|street/.test(blob)) return 'BLR street food';
  if (/halal|muslim/.test(blob)) return 'halal food in BLR';
  if (/dessert|baker|cake|patisserie/.test(blob)) return 'BLR desserts';
  if (/restaurant|eats|cuisine|dine/.test(blob)) return 'BLR restaurants';
  return 'Bangalore food';
}

function pickRecipientEmails(p) {
  const emails = [];
  if (p.business_email) emails.push(p.business_email.trim().toLowerCase());
  try {
    const ext = JSON.parse(p.extracted_emails_json || '[]');
    for (const e of ext) if (e && !emails.includes(e.toLowerCase())) emails.push(e.toLowerCase());
  } catch {}
  return emails.filter(e => /^[^@]+@[^@]+\.[^@]+$/.test(e));
}

function pickRecipientPhones(p) {
  const phones = [];
  if (p.business_phone_number) {
    const n = normalizePhone(p.business_phone_number);
    if (n.length >= 10) phones.push(n);
  }
  try {
    const ext = JSON.parse(p.extracted_phones_json || '[]');
    for (const ph of ext) {
      const n = normalizePhone(ph);
      if (n.length >= 10 && !phones.includes(n)) phones.push(n);
    }
  } catch {}
  return phones;
}

function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  let t = '';
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  for (let i = 0; i < 16; i++) t += chars[a[i] % chars.length];
  return t;
}

function renderEmailBody(firstName, niche, tier, token, username) {
  const url = `https://hnhotels.in/marketing/Influencer/booking/?t=${token}`;
  return `Hi ${firstName},

Quick one — Hamza Express, the 4th-generation Dakhni/Hyderabadi biryani family in Bangalore since 1918 (Shivajinagar — walking distance from MG Rd / Commercial St / Brigade Rd).

Saw your ${niche} content and would love to host you for a barter collab.

Covered (zero cost to you):
• Full meal for ${tier.covers} people — biryani, mutton brain dry, kababs, tandoori, our signature ghee rice
• Pick your slot: 7-9 PM (early), 9-11 PM (prime), 11 PM-1 AM (late-night)
• Personalised reservation, no waiting
• Pre-Eid Mutton Family Pack (₹2,200) launching May 21 — exclusive media access if you'd like to feature

Ask in return:
• 1 reel or post-set, organic style — no scripted brand-speak
• Tag @hamzaexpressblr + use the geotag pin

Pick your slot directly: ${url}

References:
• https://nawabichaihouse.com (sister brand)
• Outlet: 19, H.K.P. Road, Shivajinagar, Bangalore 560051

Thanks for considering it.

Nihaf
Managing Director, HN Hotels Pvt Ltd
nihaf@hnhotels.in
`;
}

function renderIgDm(firstName, niche, tier, token) {
  const url = `https://hnhotels.in/marketing/Influencer/booking/?t=${token}`;
  return `Hi ${firstName} 👋

Hamza Express — Bangalore's 1918 Dakhni biryani family (Shivajinagar). Saw your ${niche} content.

Want to host you for a barter collab — full meal for ${tier.covers}, your choice of timing.

Pick a slot: ${url}

Outlet: 19, H.K.P. Road, Shivajinagar. — Nihaf, MD HN Hotels`;
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
