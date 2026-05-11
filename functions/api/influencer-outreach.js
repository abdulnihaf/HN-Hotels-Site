// /api/influencer-outreach
//
// 3-channel cold outreach hub for the May 2026 campaign.
// Single source of truth: `influencer_outreach_log` (also written by the booking
// system's `book` action with status='booked' — that's how conversions close).
//
// Channels:
//   - email   (Gmail SMTP via local Python sender + log-back)
//   - waba    (Meta Cloud API via shared comms-core sendWaba)
//   - ig_dm   (Chrome MCP / manual paste + log-back)
//
// Flow per send:
//   1. Generate outreach token + INSERT a booking shell into `influencer_bookings`
//      (so when the creator clicks the link the booking page recognises the token).
//   2. INSERT the send-attempt row into `influencer_outreach_log`.
//   3. Booking page handles `?token=X`. When creator picks slot, booking flow
//      flips status='booked' on the same log row → conversion closes.

import { sendWaba, normalizePhone } from './_lib/comms-core.js';
import { TIER_MATRIX, tierOf, scoreRelevance, bucketOf, offerLine } from './_lib/influencer-tier.js';
import { fetchMenuFeed, renderOfferLines } from './_lib/menu-feed.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
};
const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
});

const dashboardKey = (env) => env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || null;

const requireKey = (env, request, body) => {
  const key =
    request.headers.get('X-Dashboard-Key') ||
    request.headers.get('x-api-key') ||
    new URL(request.url).searchParams.get('key') ||
    (body && body.key);
  const expected = dashboardKey(env);
  return expected && key === expected;
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
      if (action === 'buckets')          return await getBuckets(env, url);
      if (action === 'tier-matrix')      return json({ success: true, matrix: TIER_MATRIX });
    }

    if (request.method === 'POST') {
      const body = await safeJson(request);
      if (action === 'log')              return await logOutreach(env, body, request);
      if (action === 'send-waba')        return await actionSendWaba(env, body, request);
      if (action === 'record-reply')     return await recordReply(env, body, request);
      if (action === 'mark-bounce')      return await markBounce(env, body, request);
      if (action === 'create-batch')     return await createBatch(env, body, request);
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack?.slice(0, 500) }, 500);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// READS
// ────────────────────────────────────────────────────────────────────────────

async function getList(env, url) {
  const minF = parseInt(url.searchParams.get('min_followers') || '5000');
  const maxF = parseInt(url.searchParams.get('max_followers') || '100000');
  const requireFood = url.searchParams.get('food') !== '0';
  const channel = url.searchParams.get('channel');

  const FOOD_PATTERNS = [
    'food','biryani','foodie','blogger','cafe','restaurant','eats','cuisine',
    'kitchen','dine','chef','review','halal','muslim','street food','hyderab',
    'dakhni','kebab','kabab','mughlai','baker','dessert','chai','coffee','creator','lifestyle',
  ];
  const BLR_PATTERNS = ['bangalore','blr','bengaluru',"b''lore",'banglore','bglr'];

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

  const sql = `
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

  const r = await env.DB.prepare(sql).bind(minF, maxF).all();
  // Score + bucket each row in-flight
  const enriched = r.results.map(c => {
    const { score, reasons } = scoreRelevance(c);
    const bucket = bucketOf(score);
    const tierKey = tierOf(c.followers_count);
    return { ...c, relevance_score: score, score_reasons: reasons, bucket, tier: tierKey, tier_meta: TIER_MATRIX[tierKey] };
  });
  // Sort by score desc within bucket order HERO > PRIORITY > STANDARD > SKIP, then followers desc
  const bucketRank = { HERO: 0, PRIORITY: 1, STANDARD: 2, SKIP: 3 };
  enriched.sort((a, b) =>
    (bucketRank[a.bucket] - bucketRank[b.bucket]) ||
    (b.relevance_score - a.relevance_score) ||
    (b.followers_count - a.followers_count)
  );
  return json({ success: true, count: enriched.length, results: enriched });
}

async function getBuckets(env, url) {
  const minF = parseInt(url.searchParams.get('min_followers') || '5000');
  const maxF = parseInt(url.searchParams.get('max_followers') || '100000');
  const requireFood = url.searchParams.get('food') !== '0';

  const FOOD_PATTERNS = [
    'food','biryani','foodie','blogger','cafe','restaurant','eats','cuisine',
    'kitchen','dine','chef','review','halal','muslim','street food','hyderab',
    'dakhni','kebab','kabab','mughlai','baker','dessert','chai','coffee','creator','lifestyle',
  ];
  const BLR_PATTERNS = ['bangalore','blr','bengaluru',"b''lore",'banglore','bglr'];
  const blrLikes = BLR_PATTERNS.map(p => `LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%${p}%'`).join(' OR ');
  const foodLikes = FOOD_PATTERNS.map(p => `LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'') || ' ' || IFNULL(p.category_name,'')) LIKE '%${p}%'`).join(' OR ');

  let where = `p.status='ok' AND p.is_private=0
    AND p.followers_count BETWEEN ? AND ?
    AND p.has_any_contact=1
    AND (${blrLikes})`;
  if (requireFood) where += ` AND (${foodLikes})`;

  const r = await env.DB.prepare(`
    SELECT p.username, p.full_name, p.biography, p.followers_count, p.is_business_account,
           p.is_verified, p.category_name, p.has_email, p.has_phone, p.has_whatsapp,
           p.profile_pic_url
    FROM influencer_bio_pulse p
    WHERE ${where}
  `).bind(minF, maxF).all();

  const buckets = { HERO: [], PRIORITY: [], STANDARD: [], SKIP: [] };
  for (const c of r.results) {
    const { score } = scoreRelevance(c);
    const bucket = bucketOf(score);
    const tierKey = tierOf(c.followers_count);
    buckets[bucket].push({ ...c, relevance_score: score, bucket, tier: tierKey, tier_meta: TIER_MATRIX[tierKey] });
  }
  for (const b of Object.keys(buckets)) {
    buckets[b].sort((a, b2) => b2.relevance_score - a.relevance_score || b2.followers_count - a.followers_count);
  }

  return json({
    success: true,
    counts: {
      HERO: buckets.HERO.length,
      PRIORITY: buckets.PRIORITY.length,
      STANDARD: buckets.STANDARD.length,
      SKIP: buckets.SKIP.length,
    },
    buckets,
    tier_matrix: TIER_MATRIX,
  });
}

async function getStats(env) {
  const stats = await env.DB.prepare(`
    SELECT channel, status, COUNT(*) c
    FROM influencer_outreach_log
    WHERE campaign = 'may_2026_v1'
    GROUP BY channel, status
  `).all();

  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) total_sends,
      SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN status='booked'  THEN 1 ELSE 0 END) booked,
      SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) bounced,
      COUNT(DISTINCT creator_username) unique_creators_contacted
    FROM influencer_outreach_log
    WHERE campaign = 'may_2026_v1'
  `).first();

  const today = await env.DB.prepare(`
    SELECT channel, COUNT(*) c
    FROM influencer_outreach_log
    WHERE date(sent_at, 'localtime') = date('now', 'localtime')
      AND campaign = 'may_2026_v1'
    GROUP BY channel
  `).all();

  return json({ success: true, totals, by_channel_status: stats.results, today: today.results });
}

async function getQueue(env, url) {
  const channel = url.searchParams.get('channel');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  if (!channel) return json({ error: 'channel required' }, 400);

  const contactCol =
    channel === 'email' ? 'p.has_email' :
    channel === 'waba' || channel === 'sms' ? 'p.has_phone' :
    '1';

  const r = await env.DB.prepare(`
    SELECT p.username, p.full_name, p.biography, p.followers_count, p.is_business_account,
           p.is_verified, p.business_email, p.business_phone_number,
           p.extracted_emails_json, p.extracted_phones_json, p.extracted_whatsapp_json,
           p.category_name, p.has_email, p.has_phone
    FROM influencer_bio_pulse p
    LEFT JOIN influencer_outreach_log o
           ON o.creator_username = p.username AND o.channel = ? AND o.campaign = 'may_2026_v1'
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
    SELECT * FROM influencer_outreach_log
    WHERE creator_username = ? AND campaign = 'may_2026_v1'
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
  const token = await ensureBookingShell(env, p, tier);

  return json({
    success: true,
    username,
    profile_url: 'https://instagram.com/' + username + '/',
    dm_url: 'https://www.instagram.com/direct/new/?username=' + username,
    message: renderIgDm(firstName, niche, tier, token),
    token,
    tier: tier.name,
    cover_offer: tier.covers,
    niche_tag: niche,
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
  const token = await ensureBookingShell(env, p, tier);

  return json({
    success: true,
    username,
    recipient: emails[0],
    all_emails: emails,
    subject: 'Barter collab — 1918 Hamza Express, Shivajinagar',
    body: renderEmailBody(firstName, niche, tier, token),
    token,
    tier: tier.name,
    cover_offer: tier.covers,
    niche_tag: niche,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// WRITES
// ────────────────────────────────────────────────────────────────────────────

async function logOutreach(env, body, request) {
  if (!requireKey(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.channel || !body.status) {
    return json({ error: 'username + channel + status required' }, 400);
  }

  const r = await env.DB.prepare(`
    INSERT INTO influencer_outreach_log (
      creator_username, channel, to_address, subject, message_text,
      outreach_token, sent_at, sent_by, status,
      template_used, provider, provider_msg_id, tier_assigned, cover_offer,
      niche_tag, campaign, delivered_at, read_at, replied_at, reply_text,
      bounce_reason, actor
    ) VALUES (
      ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    String(body.username).toLowerCase(),
    body.channel,
    body.recipient || body.to_address || null,
    body.subject || null,
    body.message_text || '',
    body.outreach_token || null,
    body.sent_at || null,
    body.actor || body.sent_by || 'system',
    body.status,
    body.template_used || null,
    body.provider || null,
    body.provider_msg_id || null,
    body.tier_assigned || null,
    body.cover_offer || null,
    body.niche_tag || null,
    body.campaign || 'may_2026_v1',
    body.delivered_at || null,
    body.read_at || null,
    body.replied_at || null,
    body.reply_text || null,
    body.bounce_reason || null,
    body.actor || 'system'
  ).run();

  return json({ success: true, id: r.meta.last_row_id });
}

async function actionSendWaba(env, body, request) {
  if (!requireKey(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.template) return json({ error: 'username + template required' }, 400);

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
  const token = await ensureBookingShell(env, p, tier);

  const vars = body.vars || [firstName, niche, String(tier.covers), token];

  const sendResult = await sendWaba(env, {
    brand: body.brand || 'he',
    phone,
    template: body.template,
    vars,
    language: body.language || 'en',
    buttons: [{ sub_type: 'url', index: 0, url_token: token }],
  });

  const txt = `Hi ${firstName}, Hamza Express here — Bangalore's 1918 Dakhni biryani (Shivajinagar). Saw your ${niche} content. Barter collab — full meal for ${tier.covers}. Pick your slot: hnhotels.in/marketing/Influencer/booking/?token=${token}`;

  const ins = await env.DB.prepare(`
    INSERT INTO influencer_outreach_log (
      creator_username, channel, to_address, message_text, outreach_token,
      sent_by, status, template_used, provider, provider_msg_id,
      tier_assigned, cover_offer, niche_tag, campaign, actor
    ) VALUES (?, 'waba', ?, ?, ?, 'system', ?, ?, 'meta-cloud-api', ?, ?, ?, ?, 'may_2026_v1', 'system')
  `).bind(
    p.username, phone, txt, token,
    sendResult.ok ? 'sent' : 'failed',
    body.template,
    sendResult.provider_msg_id || null,
    tier.name, tier.covers, niche
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
  if (!requireKey(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.channel) return json({ error: 'username + channel required' }, 400);
  await env.DB.prepare(`
    UPDATE influencer_outreach_log
    SET status='replied', reply_at=datetime('now'), replied_at=datetime('now'),
        reply_text=COALESCE(?, reply_text)
    WHERE creator_username=? AND channel=? AND campaign='may_2026_v1'
      AND id = (SELECT MAX(id) FROM influencer_outreach_log
                WHERE creator_username=? AND channel=? AND campaign='may_2026_v1')
  `).bind(body.reply_text || null, body.username, body.channel, body.username, body.channel).run();
  return json({ success: true });
}

async function markBounce(env, body, request) {
  if (!requireKey(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.username || !body.channel) return json({ error: 'username + channel required' }, 400);
  await env.DB.prepare(`
    UPDATE influencer_outreach_log
    SET status='bounced', bounce_reason=?
    WHERE creator_username=? AND channel=? AND campaign='may_2026_v1'
      AND id = (SELECT MAX(id) FROM influencer_outreach_log
                WHERE creator_username=? AND channel=? AND campaign='may_2026_v1')
  `).bind(body.reason || 'unknown', body.username, body.channel, body.username, body.channel).run();
  return json({ success: true });
}

async function createBatch(env, body, request) {
  if (!requireKey(env, request, body)) return json({ error: 'unauthorized' }, 401);
  const channel = body.channel || 'email';
  const limit = body.limit || 20;

  // Barter band only (1K–60K = T1..T4). T5+ require cash-component pitch,
  // never auto-batched. Memory: feedback_influencer_barter_targeting.md
  const qr = await env.DB.prepare(`
    SELECT p.username, p.full_name, p.biography, p.followers_count, p.category_name,
           p.business_email, p.business_phone_number,
           p.extracted_emails_json, p.extracted_phones_json, p.extracted_whatsapp_json
    FROM influencer_bio_pulse p
    LEFT JOIN influencer_outreach_log o
      ON o.creator_username = p.username AND o.channel = ? AND o.campaign='may_2026_v1'
    WHERE p.status='ok' AND p.is_private=0
      AND p.followers_count BETWEEN 1000 AND 59999
      AND ${channel === 'email' ? 'p.has_email=1' : channel === 'waba' ? 'p.has_phone=1' : '1=1'}
      AND o.id IS NULL
      AND (LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bangalore%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%blr%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bengaluru%')
    ORDER BY
      (CASE WHEN p.is_business_account=1 THEN 1 ELSE 0 END
       + CASE WHEN p.is_verified=1 THEN 1 ELSE 0 END
       + CASE WHEN p.followers_count BETWEEN 5000 AND 15000 THEN 1 ELSE 0 END) DESC,
      p.followers_count DESC
    LIMIT ?
  `).bind(channel, limit).all();

  // Pull POS top-sellers once for the whole batch — dish names in copy
  // come from live POS, never hardcoded. Memory: feedback_never_invent_menu_items.md
  const menuFeed = await fetchMenuFeed(env);

  const batch = [];
  for (const r of qr.results) {
    const tier = pickTier(r.followers_count);
    const niche = pickNiche(r);
    const firstName = pickFirstName(r);
    const token = await ensureBookingShell(env, r, tier);

    let payload;
    if (channel === 'email') {
      const emails = pickRecipientEmails(r);
      if (!emails.length) continue;
      payload = {
        username: r.username,
        recipient: emails[0],
        subject: 'Barter collab — 1918 Hamza Express, Shivajinagar',
        body: renderEmailBody(firstName, niche, tier, token, menuFeed),
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
        INSERT INTO influencer_outreach_log (
          creator_username, channel, to_address, message_text, outreach_token,
          sent_by, status, tier_assigned, cover_offer, niche_tag, campaign, actor
        ) VALUES (?, ?, ?, '', ?, 'system', 'queued', ?, ?, ?, 'may_2026_v1', 'batch_creator')
      `).bind(r.username, channel, payload.recipient, token, tier.name, tier.covers, niche).run();

      batch.push(payload);
    }
  }

  return json({ success: true, batch_size: batch.length, batch });
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

// Ensures a row in `influencer_bookings` exists for this creator with a fresh
// outreach_token, so the booking page recognises the link when the creator clicks it.
// Returns the token.
async function ensureBookingShell(env, profile, tier) {
  // Reuse an existing pending booking shell for this creator if present, so we
  // don't create token sprawl per send.
  const existing = await env.DB.prepare(`
    SELECT outreach_token FROM influencer_bookings
    WHERE creator_username = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).bind(profile.username).first();
  if (existing && existing.outreach_token) return existing.outreach_token;

  // Generate fresh token
  let token;
  for (let i = 0; i < 5; i++) {
    token = genToken();
    const taken = await env.DB.prepare(`SELECT 1 FROM influencer_bookings WHERE outreach_token=?`).bind(token).first();
    if (!taken) break;
  }

  await env.DB.prepare(`
    INSERT INTO influencer_bookings
      (creator_username, creator_name, creator_followers, creator_tier, cover_commitment,
       meal_budget_paise, slot_id, slot_date, window_code, status, outreach_token)
    VALUES (?, ?, ?, ?, ?, ?, 0, '0000-00-00', 'PENDING', 'pending', ?)
  `).bind(
    profile.username,
    profile.full_name || null,
    profile.followers_count || null,
    tier.name,
    tier.covers,
    tier.budget_paise,
    token
  ).run();

  return token;
}

function pickTier(followers) {
  const key = tierOf(followers);
  return { ...TIER_MATRIX[key], name: key };
}

function pickFirstName(p) {
  const fn = p.full_name || '';
  const cleaned = fn.replace(/[^\w\s'-]/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  if (first && first.length > 1 && first.length < 20) return first;
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
  // Match the booking system's token shape (16-char URL-safe, ~95 bits)
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}

function renderEmailBody(firstName, niche, tier, token, menuFeed) {
  const url = `https://hnhotels.in/marketing/Influencer/booking/?token=${token}`;
  // Offer lines pulled from live HE POS (categories + current top item per category).
  // No hardcoded dish list. Memory: feedback_never_invent_menu_items.md
  const offerLines = renderOfferLines(tier, menuFeed || { byCategory: {} });
  const offerBullet = offerLines.map(l => `  – ${l}`).join('\n');
  return `Hi ${firstName},

Quick one — Hamza Express, the 4th-generation Dakhni/Hyderabadi biryani family in Bangalore since 1918 (Shivajinagar — walking distance from MG Rd / Commercial St / Brigade Rd).

Would love to host you for a barter collab.

Covered (zero cost to you):
• Full meal for ${tier.covers} ${tier.covers === 1 ? 'person' : 'people'}, drawn from what's selling on our table this month:
${offerBullet}
• Pick your slot: 7-9 PM (early), 9-11 PM (prime), 11 PM-1 AM (late-night)
• Personalised reservation, no waiting

Ask in return:
• 1 reel or post-set, organic style — no scripted brand-speak
• Tag @hamzaexpress1918 + use the Shivajinagar geotag

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
  const url = `https://hnhotels.in/marketing/Influencer/booking/?token=${token}`;
  return `Hi ${firstName} 👋

Hamza Express — Bangalore's 1918 Dakhni biryani family (Shivajinagar). Saw your ${niche} content.

Want to host you for a barter collab — full meal for ${tier.covers}, your choice of timing.

Pick a slot: ${url}

Outlet: 19, H.K.P. Road, Shivajinagar. — Nihaf, MD HN Hotels`;
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
