/**
 * HN Hotels — Facebook Group Posting API
 * Cloudflare Pages Function
 *
 * Endpoints:
 *   GET  /api/fb-posting?action=stats             → dashboard overview stats
 *   GET  /api/fb-posting?action=groups             → paginated groups list
 *   GET  /api/fb-posting?action=creatives          → all creatives
 *   GET  /api/fb-posting?action=posts              → post history
 *   GET  /api/fb-posting?action=session&id=X       → session details
 *   GET  /api/fb-posting?action=queue&creative_id=X → next groups to post (auth)
 *   POST /api/fb-posting  { action: "import_groups", groups: [...] }            (auth)
 *   POST /api/fb-posting  { action: "create_creative", ... }                    (auth)
 *   POST /api/fb-posting  { action: "create_session", creative_id, group_ids }  (auth)
 *   POST /api/fb-posting  { action: "update_post", post_id, status, error }     (auth)
 *   POST /api/fb-posting  { action: "update_group", group_id, ... }             (auth)
 *   POST /api/fb-posting  { action: "pause_session", session_id }               (auth)
 *   POST /api/fb-posting  { action: "resume_session", session_id }              (auth)
 *
 * Auth: every mutating POST (and the executor queue) requires one of:
 *   - x-darbar-token   (Darbar iOS app / PWA)
 *   - x-service-key    (internal RTX box / cron; must match env.CAMS_AUTH_TOKEN)
 *   - x-fb-posting-secret (dedicated box secret; must match env.FB_POSTING_SECRET)
 */

import { verifyToken } from './_lib/darbar-auth.js';

const ALLOWED_ORIGINS = new Set([
  'https://darbar.hnhotels.in',
  'https://hnhotels.in',
  'https://app.hnhotels.in',
  'https://hiring-fb.hn-hotels-site.pages.dev',
]);

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://darbar.hnhotels.in';
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-darbar-token, x-service-key, x-fb-posting-secret",
    "Vary": "Origin",
  };
}

function json(data, status = 200, request) {
  const corsHeaders = request ? cors(request) : {
    "Access-Control-Allow-Origin": "https://darbar.hnhotels.in",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-darbar-token, x-service-key, x-fb-posting-secret",
  };
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function err(msg, status = 400, request) {
  return json({ ok: false, error: msg }, status, request);
}

function timingSafeEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Verify request auth. Returns principal or null.
async function verifyAuth(env, request, body = null) {
  // 1. Darbar token / service key (proven HMAC + shared secret pattern)
  const principal = await verifyToken(env, request);
  if (principal) return principal;

  // 2. Dedicated FB posting secret (header or body)
  const secret = request.headers.get('x-fb-posting-secret') || body?.secret || '';
  const expected = env.FB_POSTING_SECRET || env.CAMS_AUTH_TOKEN || env.DASHBOARD_KEY || '';
  if (secret && expected && timingSafeEq(secret, expected)) {
    return { u: 'fb-box', r: 'service', service: true };
  }

  // 3. Service-key fallback to DASHBOARD_KEY (preview deployments inherit this reliably)
  const svc = request.headers.get('x-service-key') || '';
  const svcExpected = env.CAMS_AUTH_TOKEN || env.DASHBOARD_KEY || '';
  if (svc && svcExpected && timingSafeEq(svc, svcExpected)) {
    return { u: 'fb-service', r: 'service', service: true };
  }

  return null;
}

// ─── Group selection intelligence ──────────────────────────
const CREATIVE_RELEVANCE = {
  'Restaurant Cleaner': ['cleaner', 'cleaning', 'housekeeping', 'helper', 'support', 'staff'],
  'Cleaner': ['cleaner', 'cleaning', 'housekeeping', 'helper', 'support', 'staff'],
  'Restaurant Washer': ['washer', 'dishwasher', 'dish washer', 'cleaning', 'helper', 'support', 'staff'],
  'Washer': ['washer', 'dishwasher', 'dish washer', 'cleaning', 'helper', 'support', 'staff'],
  'Restaurant Kitchen Helper': ['kitchen helper', 'kitchenhelper', 'helper', 'boh', 'support', 'staff'],
  'Kitchen Helper': ['kitchen helper', 'kitchenhelper', 'helper', 'boh', 'support', 'staff'],
  'Restaurant Counter Boy': ['counter boy', 'counter', 'server', 'foh', 'service', 'staff'],
  'Counter Boy': ['counter boy', 'counter', 'server', 'foh', 'service', 'staff'],
  'BOH Support Staff': ['boh', 'back of house', 'kitchen helper', 'washer', 'cleaner', 'helper', 'support', 'staff'],
  'HE Hiring Mar 2026': ['restaurant', 'hotel', 'job', 'jobs', 'hiring', 'staff'],
};

function relevanceTermsForCreative(creative) {
  const name = creative?.name || '';
  const terms = new Set();
  // exact creative-name terms
  for (const [key, list] of Object.entries(CREATIVE_RELEVANCE)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      for (const t of list) terms.add(t);
    }
  }
  // generic fallback
  if (terms.size === 0) {
    for (const t of CREATIVE_RELEVANCE['HE Hiring Mar 2026']) terms.add(t);
  }
  return Array.from(terms);
}

function scoreGroup(group, terms) {
  let score = 0;
  const hay = [
    group.keywords || '',
    group.category || '',
    group.sub_category || '',
    group.name || '',
    group.creatives_posted || '',
  ].join(' ').toLowerCase();
  for (const term of terms) {
    if (hay.includes(term.toLowerCase())) score += 1;
  }
  // small boost for Bangalore / BLR relevance
  if (hay.includes('bangalore') || hay.includes('loc_blr') || hay.includes('blr')) score += 0.5;
  // members size as tie-breaker (normalized to avoid dominating)
  const members = parseInt(group.members_parsed) || 0;
  score += Math.min(members / 50000, 2); // up to 2 points for large groups
  return score;
}

async function selectGroups(db, creative_id, options = {}) {
  const daily_cap = Math.min(Math.max(parseInt(options.daily_cap) || 35, 1), 50);
  const cooldown_days = Math.max(parseInt(options.cooldown_days) || 7, 1);
  const location = (options.location || 'Bangalore').toLowerCase();

  // Get creative
  const creative = await db.prepare(`SELECT * FROM fb_creatives WHERE id = ?`).bind(creative_id).first();
  if (!creative) throw new Error('creative not found');

  const terms = relevanceTermsForCreative(creative);

  // Count today's successful posts across all creatives (daily cap)
  const todayCount = await db.prepare(`
    SELECT COUNT(*) as n FROM fb_posts
    WHERE status = 'success' AND date(posted_at) = date('now')
  `).first();
  const alreadyToday = todayCount?.n || 0;
  const remainingToday = Math.max(daily_cap - alreadyToday, 0);

  // Cooldown date
  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - cooldown_days);
  const cooldownIso = cooldownDate.toISOString().slice(0, 19);

  // Fetch eligible joined groups
  const eligible = await db.prepare(`
    SELECT * FROM fb_groups
    WHERE status = 'active' AND is_blocked = 0 AND status_join = 'Joined'
      AND id NOT IN (
        SELECT group_id FROM fb_posts
        WHERE creative_id = ? AND status IN ('success', 'queued', 'posting')
      )
      AND (last_posted_at IS NULL OR last_posted_at < ?)
  `).bind(creative_id, cooldownIso).all();

  const rows = eligible.results || [];

  // Score and sort
  const scored = rows.map(g => ({ ...g, _score: scoreGroup(g, terms) }));
  scored.sort((a, b) => b._score - a._score || b.members_parsed - a.members_parsed);

  // Rotation: skip the top N groups that were most recently favored by this creative
  // (simpler: pick top daily_cap * 2, then jitter shuffle, then slice)
  const poolSize = Math.min(scored.length, remainingToday * 3 + 10, 200);
  const pool = scored.slice(0, poolSize);

  // Jitter shuffle (Fisher-Yates light)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Re-sort by score within jitter but keep variety: take best from jittered pool
  pool.sort((a, b) => b._score - a._score);
  const selected = pool.slice(0, remainingToday);

  return {
    creative_id,
    daily_cap,
    remaining_today: remainingToday,
    cooldown_days,
    terms,
    eligible_count: rows.length,
    selected_count: selected.length,
    selected: selected.map(g => ({ id: g.id, name: g.name, members_parsed: g.members_parsed, score: g._score })),
  };
}

// ─── Normalize group URL ───────────────────────────────────
function normalizeGroupUrl(url) {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    // Extract /groups/XXXX
    const m = path.match(/\/groups\/([^/]+)/);
    if (!m) return null;
    return `https://facebook.com/groups/${m[1]}`;
  } catch {
    // Try adding https:// if missing
    if (!url.startsWith("http")) {
      return normalizeGroupUrl("https://" + url);
    }
    return null;
  }
}

function extractGroupId(url) {
  const m = url.match(/\/groups\/([^/]+)/);
  return m ? m[1] : null;
}

function normalizeStatusJoin(raw) {
  if (!raw) return 'unknown';
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  if (s.startsWith('join') || s === 'joined') return 'Joined';
  if (s.includes('not_join') || s === 'notjoined') return 'Not_Joined';
  if (s.includes('pending') || s.includes('requested')) return 'Pending';
  return String(raw).trim();
}

// ─── GET handlers ──────────────────────────────────────────
async function handleGet(url, db, env, request) {
  const action = url.searchParams.get("action");

  // ── Stats ──
  if (action === "stats") {
    const [groupStats, categoryStats, postStats, sessionInfo] = await Promise.all([
      db.prepare(`
        SELECT
          COUNT(*) as total_groups,
          SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_groups,
          SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) as blocked_groups,
          SUM(CASE WHEN is_blocked=1 THEN 1 ELSE 0 END) as is_blocked_count,
          SUM(members_parsed) as total_members
        FROM fb_groups
      `).first(),
      db.prepare(`
        SELECT category, COUNT(*) as count, SUM(members_parsed) as members
        FROM fb_groups WHERE category IS NOT NULL
        GROUP BY category ORDER BY count DESC
      `).all(),
      db.prepare(`
        SELECT
          COUNT(*) as total_posts,
          SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN date(posted_at)=date('now') AND status='success' THEN 1 ELSE 0 END) as today_posted
        FROM fb_posts
      `).first(),
      db.prepare(`SELECT * FROM fb_sessions WHERE status='active' ORDER BY id DESC LIMIT 1`).first(),
    ]);

    const creativesCount = await db.prepare(`SELECT COUNT(*) as count FROM fb_creatives`).first();

    return json({
      ok: true,
      stats: {
        groups: groupStats,
        categories: categoryStats.results || [],
        posts: postStats,
        creatives_count: creativesCount?.count || 0,
        active_session: sessionInfo || null,
      },
    });
  }

  // ── Groups ──
  if (action === "groups") {
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = (page - 1) * limit;
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");
    const creative_id = url.searchParams.get("not_posted_creative");

    let where = [];
    let params = [];

    if (category) { where.push("category = ?"); params.push(category); }
    if (status) { where.push("status = ?"); params.push(status); }
    if (search) { where.push("(name LIKE ? OR keywords LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (creative_id) {
      where.push(`id NOT IN (SELECT group_id FROM fb_posts WHERE creative_id = ? AND status = 'success')`);
      params.push(creative_id);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const [groups, total] = await Promise.all([
      db.prepare(`SELECT * FROM fb_groups ${whereClause} ORDER BY members_parsed DESC LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset).all(),
      db.prepare(`SELECT COUNT(*) as count FROM fb_groups ${whereClause}`)
        .bind(...params).first(),
    ]);

    return json({
      ok: true,
      groups: groups.results || [],
      total: total?.count || 0,
      page,
      pages: Math.ceil((total?.count || 0) / limit),
    });
  }

  // ── Creatives ──
  if (action === "creatives") {
    const creatives = await db.prepare(`SELECT * FROM fb_creatives ORDER BY id DESC`).all();
    return json({ ok: true, creatives: creatives.results || [] });
  }

  // ── Posts ──
  if (action === "posts") {
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = (page - 1) * limit;
    const creative_id = url.searchParams.get("creative_id");
    const status = url.searchParams.get("status");
    const session_id = url.searchParams.get("session_id");

    let where = [];
    let params = [];
    if (creative_id) { where.push("p.creative_id = ?"); params.push(creative_id); }
    if (status) { where.push("p.status = ?"); params.push(status); }
    if (session_id) { where.push("p.session_id = ?"); params.push(session_id); }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const posts = await db.prepare(`
      SELECT p.*, g.name as group_name, g.group_url, g.members_parsed,
             c.name as creative_name
      FROM fb_posts p
      JOIN fb_groups g ON p.group_id = g.id
      JOIN fb_creatives c ON p.creative_id = c.id
      ${whereClause}
      ORDER BY p.id DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    const total = await db.prepare(`SELECT COUNT(*) as count FROM fb_posts p ${whereClause}`)
      .bind(...params).first();

    return json({
      ok: true,
      posts: posts.results || [],
      total: total?.count || 0,
      page,
    });
  }

  // ── Session ──
  if (action === "session") {
    const id = url.searchParams.get("id");
    if (!id) return err("session id required");

    const session = await db.prepare(`
      SELECT s.*, c.name as creative_name, c.image_filename
      FROM fb_sessions s JOIN fb_creatives c ON s.creative_id = c.id
      WHERE s.id = ?
    `).bind(id).first();

    if (!session) return err("session not found", 404);

    const posts = await db.prepare(`
      SELECT p.*, g.name as group_name, g.group_url
      FROM fb_posts p JOIN fb_groups g ON p.group_id = g.id
      WHERE p.session_id = ?
      ORDER BY p.id DESC
    `).bind(id).all();

    return json({ ok: true, session, posts: posts.results || [] });
  }

  // ── Queue (next groups to post) ──
  if (action === "queue") {
    const auth = await verifyAuth(env, request, null);
    if (!auth) return err("unauthorized", 401, request);

    const creative_id = url.searchParams.get("creative_id");
    if (!creative_id) return err("creative_id required", 400, request);
    const limit = parseInt(url.searchParams.get("limit") || "20");

    const groups = await db.prepare(`
      SELECT * FROM fb_groups
      WHERE status = 'active' AND is_blocked = 0
        AND id NOT IN (
          SELECT group_id FROM fb_posts
          WHERE creative_id = ? AND status IN ('success', 'queued', 'posting')
        )
      ORDER BY members_parsed DESC
      LIMIT ?
    `).bind(creative_id, limit).all();

    return json({ ok: true, groups: groups.results || [], count: groups.results?.length || 0 }, 200, request);
  }

  // ── Next Job (executor poll) ──
  if (action === "next_job") {
    const auth = await verifyAuth(env, request, null);
    if (!auth) return err("unauthorized", 401, request);

    // Mark one queued post as 'posting' and return it with creative + group
    const job = await db.prepare(`
      SELECT p.*, g.name as group_name, g.group_url, g.members_parsed,
             c.name as creative_name, c.post_text, c.image_filename
      FROM fb_posts p
      JOIN fb_groups g ON p.group_id = g.id
      JOIN fb_creatives c ON p.creative_id = c.id
      WHERE p.status = 'queued'
      ORDER BY p.id ASC
      LIMIT 1
    `).first();

    if (!job) {
      return json({ ok: true, job: null, note: "no queued posts" }, 200, request);
    }

    await db.prepare(`UPDATE fb_posts SET status='posting' WHERE id=?`).bind(job.id).run();

    return json({ ok: true, job }, 200, request);
  }

  return err("unknown action: " + action, 400, request);
}

// ─── POST handlers ─────────────────────────────────────────
async function handlePost(body, db, env, request) {
  const { action } = body;

  const auth = await verifyAuth(env, request, body);
  if (!auth) return err("unauthorized", 401, request);

  // ── Import Groups ──
  if (action === "import_groups") {
    const { groups } = body;
    if (!groups || !Array.isArray(groups)) return err("groups array required", 400, request);

    let imported = 0, skipped = 0, errors = 0;

    for (const g of groups) {
      const url = normalizeGroupUrl(g.group_url || g.Group_URL || "");
      if (!url) { errors++; continue; }

      const name = g.name || g.Group_Name || "Unknown";
      const visibility = g.visibility || g.Visibility || "Public";
      const members_raw = g.members_raw || g.Members || g.Members_Raw || "";
      const members_parsed = parseInt(g.members_parsed || g.Members_Parsed || "0") || 0;
      const posts_activity = g.posts_activity || g.Posts_Activity || "";
      const category = g.category || g.Categories || g.Category || null;
      const sub_category = g.sub_category || g.Sub_Categories || g.Sub_Category || null;
      const keywords = g.keywords || g.Keywords || null;
      const status_join = normalizeStatusJoin(g.status_join || g.Status || g.Joined || null);
      const is_blocked = g.is_blocked || g.Is_Blocked || 0;
      const notes = g.notes || g.Notes || null;
      const group_id = extractGroupId(url);

      try {
        await db.prepare(`
          INSERT INTO fb_groups (
            group_url, group_id, name, visibility, members_raw, members_parsed,
            posts_activity, category, sub_category, keywords, status_join, is_blocked, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(group_url) DO UPDATE SET
            name = excluded.name,
            members_raw = excluded.members_raw,
            members_parsed = excluded.members_parsed,
            posts_activity = excluded.posts_activity,
            category = COALESCE(excluded.category, fb_groups.category),
            sub_category = COALESCE(excluded.sub_category, fb_groups.sub_category),
            keywords = COALESCE(excluded.keywords, fb_groups.keywords),
            status_join = COALESCE(excluded.status_join, fb_groups.status_join),
            is_blocked = excluded.is_blocked,
            notes = COALESCE(excluded.notes, fb_groups.notes)
        `).bind(
          url, group_id, name, visibility, members_raw, members_parsed,
          posts_activity, category, sub_category, keywords, status_join,
          is_blocked ? 1 : 0, notes
        ).run();
        imported++;
      } catch (e) {
        if (e.message?.includes("UNIQUE")) { skipped++; }
        else { errors++; }
      }
    }

    return json({ ok: true, imported, skipped, errors, total: groups.length }, 200, request);
  }

  // ── Create Creative ──
  if (action === "create_creative") {
    const { name, brand, post_text, image_filename, post_type } = body;
    if (!name) return err("name required");

    const result = await db.prepare(`
      INSERT INTO fb_creatives (name, brand, post_text, image_filename, post_type)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      name,
      brand || "Hamza Express",
      post_text || "",
      image_filename || "",
      post_type || "text_photo"
    ).run();

    return json({ ok: true, creative_id: result.meta.last_row_id });
  }

  // ── Select Groups (intelligence: relevance + cooldown + rotation + daily cap) ──
  if (action === "select_groups") {
    const { creative_id, daily_cap, cooldown_days, location } = body;
    if (!creative_id) return err("creative_id required", 400, request);
    try {
      const result = await selectGroups(db, creative_id, { daily_cap, cooldown_days, location });
      return json({ ok: true, ...result }, 200, request);
    } catch (e) {
      return err(e.message, 400, request);
    }
  }

  // ── Create Session ──
  if (action === "create_session") {
    const { creative_id, group_ids, account_name, use_intelligence, daily_cap, cooldown_days, location } = body;
    if (!creative_id) return err("creative_id required", 400, request);

    let ids;
    if (group_ids && group_ids.length > 0) {
      // Explicit group list (admin/debug)
      const placeholders = group_ids.map(() => "?").join(",");
      const targetGroups = await db.prepare(
        `SELECT id FROM fb_groups WHERE id IN (${placeholders}) AND status='active' AND is_blocked=0`
      ).bind(...group_ids).all();
      ids = (targetGroups.results || []).map(g => g.id);
    } else if (use_intelligence) {
      // Use select_groups intelligence
      const selected = await selectGroups(db, creative_id, { daily_cap, cooldown_days, location });
      ids = selected.selected.map(g => g.id);
    } else {
      // Legacy: all unposted active groups by size
      const targetGroups = await db.prepare(`
        SELECT id FROM fb_groups
        WHERE status='active' AND is_blocked=0
          AND id NOT IN (
            SELECT group_id FROM fb_posts WHERE creative_id=? AND status IN ('success','queued','posting')
          )
        ORDER BY members_parsed DESC
      `).bind(creative_id).all();
      ids = (targetGroups.results || []).map(g => g.id);
    }

    if (!ids || ids.length === 0) return err("no target groups found", 400, request);

    // Create session
    const session = await db.prepare(`
      INSERT INTO fb_sessions (creative_id, account_name, total_groups, status)
      VALUES (?, ?, ?, 'active')
    `).bind(creative_id, account_name || "default", ids.length).run();

    const sessionId = session.meta.last_row_id;

    // Create queued posts for each group
    const stmt = db.prepare(`
      INSERT INTO fb_posts (group_id, creative_id, session_id, account_name, status)
      VALUES (?, ?, ?, ?, 'queued')
    `);

    const batchSize = 25;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await db.batch(batch.map(gid =>
        stmt.bind(gid, creative_id, sessionId, account_name || "default")
      ));
    }

    return json({ ok: true, session_id: sessionId, total_groups: ids.length }, 200, request);
  }

  // ── Update Post (called by Claude after posting) ──
  if (action === "update_post") {
    const { post_id, status, error_message } = body;
    if (!post_id || !status) return err("post_id and status required");

    const now = new Date().toISOString().slice(0, 19);

    await db.prepare(`
      UPDATE fb_posts SET status=?, error_message=?, posted_at=? WHERE id=?
    `).bind(status, error_message || null, status === "success" ? now : null, post_id).run();

    // Get the post details to update related records
    const post = await db.prepare(`SELECT * FROM fb_posts WHERE id=?`).bind(post_id).first();
    if (post) {
      // Update session counts
      if (post.session_id) {
        const field = status === "success" ? "posted_count"
                    : status === "failed" ? "failed_count"
                    : status === "skipped" ? "skipped_count" : null;
        if (field) {
          await db.prepare(`UPDATE fb_sessions SET ${field} = ${field} + 1 WHERE id=?`)
            .bind(post.session_id).run();

          // Check if session is complete
          const sess = await db.prepare(`SELECT * FROM fb_sessions WHERE id=?`).bind(post.session_id).first();
          if (sess && (sess.posted_count + sess.failed_count + sess.skipped_count) >= sess.total_groups) {
            await db.prepare(`UPDATE fb_sessions SET status='completed', completed_at=? WHERE id=?`)
              .bind(now, post.session_id).run();
          }
        }
      }

      // Update group tracking
      if (status === "success") {
        await db.prepare(`
          UPDATE fb_groups SET
            total_posts = total_posts + 1,
            last_posted_at = ?,
            last_posted_creative_id = ?
          WHERE id = ?
        `).bind(now, post.creative_id, post.group_id).run();

        // Update creative times_used
        await db.prepare(`UPDATE fb_creatives SET times_used = times_used + 1 WHERE id=?`)
          .bind(post.creative_id).run();
      }
    }

    return json({ ok: true });
  }

  // ── Update Group ──
  if (action === "update_group") {
    const { group_id, status, is_blocked, notes, category } = body;
    if (!group_id) return err("group_id required");

    let sets = [];
    let params = [];

    if (status !== undefined) { sets.push("status = ?"); params.push(status); }
    if (is_blocked !== undefined) { sets.push("is_blocked = ?"); params.push(is_blocked ? 1 : 0); }
    if (notes !== undefined) { sets.push("notes = ?"); params.push(notes); }
    if (category !== undefined) { sets.push("category = ?"); params.push(category); }

    if (sets.length === 0) return err("nothing to update");

    params.push(group_id);
    await db.prepare(`UPDATE fb_groups SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();

    return json({ ok: true });
  }

  // ── Pause Session ──
  if (action === "pause_session") {
    const { session_id } = body;
    if (!session_id) return err("session_id required");
    await db.prepare(`UPDATE fb_sessions SET status='paused' WHERE id=? AND status='active'`)
      .bind(session_id).run();
    return json({ ok: true });
  }

  // ── Resume Session ──
  if (action === "resume_session") {
    const { session_id } = body;
    if (!session_id) return err("session_id required");
    await db.prepare(`UPDATE fb_sessions SET status='active' WHERE id=? AND status='paused'`)
      .bind(session_id).run();
    return json({ ok: true });
  }

  // ── Delete Creative ──
  if (action === "delete_creative") {
    const { creative_id } = body;
    if (!creative_id) return err("creative_id required");
    await db.prepare(`DELETE FROM fb_creatives WHERE id=?`).bind(creative_id).run();
    return json({ ok: true });
  }

  // ── Bulk Update Group Categories ──
  if (action === "bulk_update_category") {
    const { group_ids, category } = body;
    if (!group_ids || !category) return err("group_ids and category required");
    const placeholders = group_ids.map(() => "?").join(",");
    await db.prepare(`UPDATE fb_groups SET category=? WHERE id IN (${placeholders})`)
      .bind(category, ...group_ids).run();
    return json({ ok: true, updated: group_ids.length });
  }

  return err("unknown action: " + action);
}

// ─── Main handler ──────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors(request) });
  }

  try {
    if (request.method === "GET") {
      return await handleGet(url, db, env, request);
    }

    if (request.method === "POST") {
      const body = await request.json();
      return await handlePost(body, db, env, request);
    }

    return err("method not allowed", 405, request);
  } catch (e) {
    console.error("fb-posting error:", e);
    return json({ ok: false, error: e.message || "internal error" }, 500, request);
  }
}
