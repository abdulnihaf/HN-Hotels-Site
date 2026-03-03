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
 *   GET  /api/fb-posting?action=queue&creative_id=X → next groups to post
 *   POST /api/fb-posting  { action: "import_groups", groups: [...] }
 *   POST /api/fb-posting  { action: "create_creative", ... }
 *   POST /api/fb-posting  { action: "create_session", creative_id, group_ids }
 *   POST /api/fb-posting  { action: "update_post", post_id, status, error }
 *   POST /api/fb-posting  { action: "update_group", group_id, ... }
 *   POST /api/fb-posting  { action: "pause_session", session_id }
 *   POST /api/fb-posting  { action: "resume_session", session_id }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
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

// ─── GET handlers ──────────────────────────────────────────
async function handleGet(url, db) {
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
    const creative_id = url.searchParams.get("creative_id");
    if (!creative_id) return err("creative_id required");
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

    return json({ ok: true, groups: groups.results || [], count: groups.results?.length || 0 });
  }

  return err("unknown action: " + action);
}

// ─── POST handlers ─────────────────────────────────────────
async function handlePost(body, db) {
  const { action } = body;

  // ── Import Groups ──
  if (action === "import_groups") {
    const { groups } = body;
    if (!groups || !Array.isArray(groups)) return err("groups array required");

    let imported = 0, skipped = 0, errors = 0;

    for (const g of groups) {
      const url = normalizeGroupUrl(g.group_url || g.Group_URL || "");
      if (!url) { errors++; continue; }

      const name = g.name || g.Group_Name || "Unknown";
      const visibility = g.visibility || g.Visibility || "Public";
      const members_raw = g.members_raw || g.Members_Raw || "";
      const members_parsed = parseInt(g.members_parsed || g.Members_Parsed || "0") || 0;
      const posts_activity = g.posts_activity || g.Posts_Activity || "";
      const category = g.category || g.Category || null;
      const group_id = extractGroupId(url);

      try {
        await db.prepare(`
          INSERT INTO fb_groups (group_url, group_id, name, visibility, members_raw, members_parsed, posts_activity, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(group_url) DO UPDATE SET
            name = excluded.name,
            members_raw = excluded.members_raw,
            members_parsed = excluded.members_parsed,
            posts_activity = excluded.posts_activity
        `).bind(url, group_id, name, visibility, members_raw, members_parsed, posts_activity, category).run();
        imported++;
      } catch (e) {
        if (e.message?.includes("UNIQUE")) { skipped++; }
        else { errors++; }
      }
    }

    return json({ ok: true, imported, skipped, errors, total: groups.length });
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

  // ── Create Session ──
  if (action === "create_session") {
    const { creative_id, group_ids, account_name } = body;
    if (!creative_id) return err("creative_id required");

    // Get target groups (either specific IDs or all unposted)
    let targetGroups;
    if (group_ids && group_ids.length > 0) {
      const placeholders = group_ids.map(() => "?").join(",");
      targetGroups = await db.prepare(
        `SELECT id FROM fb_groups WHERE id IN (${placeholders}) AND status='active' AND is_blocked=0`
      ).bind(...group_ids).all();
    } else {
      targetGroups = await db.prepare(`
        SELECT id FROM fb_groups
        WHERE status='active' AND is_blocked=0
          AND id NOT IN (
            SELECT group_id FROM fb_posts WHERE creative_id=? AND status IN ('success','queued','posting')
          )
        ORDER BY members_parsed DESC
      `).bind(creative_id).all();
    }

    const ids = (targetGroups.results || []).map(g => g.id);
    if (ids.length === 0) return err("no target groups found");

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

    return json({ ok: true, session_id: sessionId, total_groups: ids.length });
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
    return new Response(null, { headers: CORS });
  }

  try {
    if (request.method === "GET") {
      return await handleGet(url, db);
    }

    if (request.method === "POST") {
      const body = await request.json();
      return await handlePost(body, db);
    }

    return err("method not allowed", 405);
  } catch (e) {
    console.error("fb-posting error:", e);
    return json({ ok: false, error: e.message || "internal error" }, 500);
  }
}
