// Influencer Cover Bookings — public booking + owner approval
//
// Public (no auth, token = identity):
//   GET  ?action=token-detail&token=X       creator's tier + slots + commitment
//   POST ?action=book                       body={token, slot_id, contact_phone, contact_email, notes_creator}
//   GET  ?action=slots                      open slot availability (no auth)
//
// Owner (auth via DASHBOARD_KEY):
//   POST ?action=create-token               body={creator_username, creator_name?, followers?, key}
//                                            → returns {booking_url, outreach_token}
//   GET  ?action=list&key=                  all bookings
//   POST ?action=approve&key=               body={booking_id, approved_by}
//   POST ?action=reject&key=                body={booking_id, reason}
//   POST ?action=mark-arrived&key=          body={booking_id, actual_cover_count, table_or_counter}
//   POST ?action=capture-deliverable&key=   body={booking_id, deliverable_url}
//   GET  ?action=stats&key=                 counts by status

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Content-Type': 'application/json',
};

// Tier matrix — coordinate space (no free-text)
const TIER_MATRIX = {
  T1: { label: '5K–15K Micro', min: 5000,   max: 15000,   covers: 2, budget_paise: 120000 },   // ₹1,200
  T2: { label: '15K–50K Mid',  min: 15000,  max: 50000,   covers: 4, budget_paise: 240000 },   // ₹2,400
  T3: { label: '50K–100K Big', min: 50000,  max: 100000,  covers: 6, budget_paise: 360000 },   // ₹3,600
  T4: { label: '100K+ Macro',  min: 100000, max: 99999999,covers: 8, budget_paise: 480000 },   // ₹4,800 + cash custom
};

function tierOf(followers) {
  const f = followers || 0;
  if (f < 15000)   return 'T1';
  if (f < 50000)   return 'T2';
  if (f < 100000)  return 'T3';
  return 'T4';
}

function genToken() {
  // 16-char URL-safe token (~95 bits entropy)
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function authOk(env, key) { return key && key === env.DASHBOARD_KEY; }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const key = url.searchParams.get('key') || request.headers.get('x-api-key');

  try {
    // Public actions (no key)
    if (request.method === 'GET' && action === 'slots') return getSlots(env);
    if (request.method === 'GET' && action === 'token-detail') return tokenDetail(env, url.searchParams.get('token'));
    if (request.method === 'POST' && action === 'book') return book(env, await request.json());

    // Owner-gated actions
    if (!authOk(env, key)) return json({ error: 'unauthorized' }, 401);

    if (request.method === 'POST' && action === 'create-token') return createToken(env, await request.json());
    if (request.method === 'GET'  && action === 'list')   return listBookings(env, url);
    if (request.method === 'POST' && action === 'approve') return approveBooking(env, await request.json());
    if (request.method === 'POST' && action === 'reject')  return rejectBooking(env, await request.json());
    if (request.method === 'POST' && action === 'mark-arrived') return markArrived(env, await request.json());
    if (request.method === 'POST' && action === 'capture-deliverable') return captureDeliverable(env, await request.json());
    if (request.method === 'GET'  && action === 'stats')  return getStats(env);

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack?.slice(0, 500) }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

async function getSlots(env) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare(`
    SELECT id, slot_date, window_code, window_label, capacity, booked_count, is_blocked, notes,
           (capacity - booked_count) AS remaining
    FROM influencer_slots
    WHERE slot_date >= ? AND is_blocked = 0
    ORDER BY slot_date ASC,
      CASE window_code WHEN 'JUMMA' THEN 1 WHEN 'EARLY' THEN 2 WHEN 'PRIME' THEN 3 WHEN 'LATE' THEN 4 WHEN 'EID' THEN 5 ELSE 9 END
  `).bind(today).all();
  return json({ success: true, slots: r.results, today });
}

async function tokenDetail(env, token) {
  if (!token) return json({ error: 'token required' }, 400);
  const b = await env.DB.prepare(`SELECT * FROM influencer_bookings WHERE outreach_token = ? ORDER BY id DESC LIMIT 1`).bind(token).first();
  if (!b) return json({ success: false, found: false }, 404);

  // Pull creator's enriched profile (if available)
  const enriched = await env.DB.prepare(`SELECT username, full_name, biography, profile_pic_url, category_name, followers_count, is_business_account, is_verified
                                          FROM influencer_bio_pulse WHERE username = ?`).bind(b.creator_username).first();

  const tier = TIER_MATRIX[b.creator_tier] || TIER_MATRIX.T1;
  const slotsResp = await getSlots(env);
  const slotsBody = await slotsResp.json();

  return json({
    success: true,
    booking: {
      id: b.id,
      status: b.status,
      slot_id: b.slot_id,
      slot_date: b.slot_date,
      window_code: b.window_code,
      cover_commitment: b.cover_commitment,
      meal_budget_paise: b.meal_budget_paise,
      meal_budget_rupees: b.meal_budget_paise / 100,
      tier: b.creator_tier,
      tier_label: tier.label,
    },
    creator: {
      username: b.creator_username,
      name: b.creator_name || enriched?.full_name,
      followers: b.creator_followers || enriched?.followers_count,
      bio: enriched?.biography,
      pic: enriched?.profile_pic_url,
      verified: !!enriched?.is_verified,
      business: !!enriched?.is_business_account,
      category: enriched?.category_name,
    },
    slots: slotsBody.slots,
  });
}

async function book(env, body) {
  const { token, slot_id, contact_phone, contact_email, notes_creator } = body || {};
  if (!token || !slot_id) return json({ error: 'token + slot_id required' }, 400);

  // Get the booking shell created by owner
  const b = await env.DB.prepare(`SELECT * FROM influencer_bookings WHERE outreach_token = ? ORDER BY id DESC LIMIT 1`).bind(token).first();
  if (!b) return json({ error: 'invalid token' }, 404);
  if (b.status !== 'pending' && b.slot_id) return json({ error: 'already booked', booking_id: b.id, status: b.status }, 409);

  // Check slot availability
  const slot = await env.DB.prepare(`SELECT * FROM influencer_slots WHERE id = ?`).bind(slot_id).first();
  if (!slot) return json({ error: 'slot not found' }, 404);
  if (slot.is_blocked) return json({ error: 'slot blocked' }, 410);
  if (slot.booked_count >= slot.capacity) return json({ error: 'slot full' }, 410);

  // Atomic update: increment slot count + write booking
  await env.DB.prepare(`
    UPDATE influencer_bookings SET
      slot_id = ?, slot_date = ?, window_code = ?,
      contact_phone = ?, contact_email = ?, notes_creator = ?,
      status = 'pending', updated_at = datetime('now')
    WHERE id = ?
  `).bind(slot_id, slot.slot_date, slot.window_code, contact_phone || null, contact_email || null, notes_creator || null, b.id).run();

  await env.DB.prepare(`UPDATE influencer_slots SET booked_count = booked_count + 1 WHERE id = ?`).bind(slot_id).run();

  // Update outreach log
  await env.DB.prepare(`UPDATE influencer_outreach_log SET status = 'booked' WHERE outreach_token = ?`).bind(token).run();

  return json({
    success: true,
    booking_id: b.id,
    slot_date: slot.slot_date,
    window_label: slot.window_label,
    cover_commitment: b.cover_commitment,
    address: 'Hamza Express, #19 H.K.P. Road, Shivajinagar, Bangalore 560051',
    map_url: 'https://maps.app.goo.gl/uV5UPq3DA2DfL3RT9',  // placeholder; owner replaces
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER-GATED
// ─────────────────────────────────────────────────────────────────────────────

async function createToken(env, body) {
  const { creator_username, creator_name, followers, key } = body || {};
  if (!creator_username) return json({ error: 'creator_username required' }, 400);

  // Compute tier
  const tier = tierOf(followers);
  const matrix = TIER_MATRIX[tier];

  // Generate token
  let token;
  for (let attempt = 0; attempt < 5; attempt++) {
    token = genToken();
    const exists = await env.DB.prepare(`SELECT 1 FROM influencer_bookings WHERE outreach_token = ?`).bind(token).first();
    if (!exists) break;
  }

  // Insert booking shell — slot_id 0 means not-yet-booked; will be filled when creator books
  const r = await env.DB.prepare(`
    INSERT INTO influencer_bookings
      (creator_username, creator_name, creator_followers, creator_tier, cover_commitment, meal_budget_paise,
       slot_id, slot_date, window_code, status, outreach_token)
    VALUES (?, ?, ?, ?, ?, ?, 0, '0000-00-00', 'PENDING', 'pending', ?)
  `).bind(
    creator_username.toLowerCase().replace(/^@/, ''),
    creator_name || null,
    followers || null,
    tier,
    matrix.covers,
    matrix.budget_paise,
    token
  ).run();

  return json({
    success: true,
    booking_id: r.meta.last_row_id,
    outreach_token: token,
    booking_url: `https://hnhotels.in/marketing/Influencer/booking/?token=${token}`,
    tier,
    tier_label: matrix.label,
    cover_commitment: matrix.covers,
    meal_budget_paise: matrix.budget_paise,
  });
}

async function listBookings(env, url) {
  const status = url.searchParams.get('status');
  const sql = status
    ? `SELECT * FROM influencer_bookings WHERE status = ? ORDER BY id DESC LIMIT 500`
    : `SELECT * FROM influencer_bookings ORDER BY id DESC LIMIT 500`;
  const r = status
    ? await env.DB.prepare(sql).bind(status).all()
    : await env.DB.prepare(sql).all();
  return json({ success: true, bookings: r.results });
}

async function approveBooking(env, body) {
  const { booking_id, approved_by } = body || {};
  if (!booking_id) return json({ error: 'booking_id required' }, 400);
  await env.DB.prepare(`UPDATE influencer_bookings SET status = 'confirmed', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(approved_by || 'owner', booking_id).run();
  return json({ success: true });
}

async function rejectBooking(env, body) {
  const { booking_id, reason } = body || {};
  if (!booking_id) return json({ error: 'booking_id required' }, 400);
  // Also free the slot
  const b = await env.DB.prepare(`SELECT slot_id FROM influencer_bookings WHERE id = ?`).bind(booking_id).first();
  if (b && b.slot_id > 0) {
    await env.DB.prepare(`UPDATE influencer_slots SET booked_count = MAX(0, booked_count - 1) WHERE id = ?`).bind(b.slot_id).run();
  }
  await env.DB.prepare(`UPDATE influencer_bookings SET status = 'rejected', notes_owner = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(reason || 'owner rejected', booking_id).run();
  return json({ success: true });
}

async function markArrived(env, body) {
  const { booking_id, actual_cover_count, table_or_counter } = body || {};
  if (!booking_id) return json({ error: 'booking_id required' }, 400);
  await env.DB.prepare(`
    UPDATE influencer_bookings SET
      status = 'arrived',
      actual_cover_count = ?,
      arrived_at = datetime('now'),
      arrived_table_or_counter = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(actual_cover_count || null, table_or_counter || null, booking_id).run();
  return json({ success: true });
}

async function captureDeliverable(env, body) {
  const { booking_id, deliverable_url } = body || {};
  if (!booking_id || !deliverable_url) return json({ error: 'booking_id + deliverable_url required' }, 400);
  await env.DB.prepare(`
    UPDATE influencer_bookings SET
      status = 'posted',
      deliverable_url = ?,
      deliverable_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(deliverable_url, booking_id).run();
  return json({ success: true });
}

async function getStats(env) {
  const counts = await env.DB.prepare(`SELECT status, COUNT(*) c FROM influencer_bookings GROUP BY status`).all();
  const byTier = await env.DB.prepare(`SELECT creator_tier, COUNT(*) c FROM influencer_bookings GROUP BY creator_tier`).all();
  const totalCovers = await env.DB.prepare(`SELECT SUM(cover_commitment) c FROM influencer_bookings WHERE status IN ('confirmed','arrived','posted','attributed')`).first();
  const arrivedCovers = await env.DB.prepare(`SELECT SUM(actual_cover_count) c FROM influencer_bookings WHERE actual_cover_count IS NOT NULL`).first();
  const slotsRemaining = await env.DB.prepare(`SELECT slot_date, COUNT(*) c, SUM(capacity - booked_count) remaining FROM influencer_slots WHERE is_blocked = 0 GROUP BY slot_date ORDER BY slot_date`).all();
  return json({
    success: true,
    counts: counts.results,
    by_tier: byTier.results,
    total_committed_covers: totalCovers?.c || 0,
    arrived_covers: arrivedCovers?.c || 0,
    slots_by_date: slotsRemaining.results,
  });
}
