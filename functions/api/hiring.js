/**
 * HN Hotels — Hiring Campaign API
 * Cloudflare Pages Function
 *
 * Endpoints:
 *   GET  /api/hiring?action=campaigns          → list all campaigns
 *   GET  /api/hiring?action=stats               → overall dashboard stats
 *   GET  /api/hiring?action=messages&id=<id>    → messages for a campaign
 *   GET  /api/hiring?action=inbox               → inbox conversations
 *   GET  /api/hiring?action=conversation&phone=X → thread for a phone
 *   GET  /api/hiring?hub.mode=subscribe         → Meta webhook verification
 *   POST /api/hiring  { action: "create_campaign", ... }
 *   POST /api/hiring  { action: "import_candidates", ... }
 *   POST /api/hiring  { action: "import_send_log", ... }
 *   POST /api/hiring  { action: "send_batch", campaign_id, ... }
 *   POST /api/hiring  { action: "pause_campaign", ... }
 *   POST /api/hiring  { action: "reply", phone, text }
 *   POST /api/hiring  { action: "mark_read", phone }
 *   POST /api/hiring  (raw Meta webhook payload)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Helper: send a WhatsApp message ────────────────────────
async function sendWhatsApp(env, to, payload) {
  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
    }
  );
  return resp.json();
}

// ─── Helper: extract 10-digit phone from various formats ────
function normalizePhone(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.slice(-10);
}

// ─── Helper: update campaign counts from message statuses ───
async function refreshCampaignCounts(db, campaignId) {
  await db
    .prepare(
      `UPDATE campaigns SET
         sent_count = (SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status IN ('sent','delivered','read')),
         delivered_count = (SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status IN ('delivered','read')),
         read_count = (SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status = 'read'),
         failed_count = (SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status = 'failed')
       WHERE id = ?`
    )
    .bind(campaignId, campaignId, campaignId, campaignId, campaignId)
    .run();
}

// ─── GET handlers ──────────────────────────────────────────
async function handleGet(url, env) {
  const action = url.searchParams.get("action");
  const db = env.DB;

  // ── Meta Webhook Verification ──
  const hubMode = url.searchParams.get("hub.mode");
  if (hubMode === "subscribe") {
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (token === (env.WA_VERIFY_TOKEN || "hn-hiring-verify-2026")) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (action === "campaigns") {
    const rows = await db
      .prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`)
      .all();
    return json({ campaigns: rows.results });
  }

  if (action === "stats") {
    const campaigns = await db
      .prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`)
      .all();

    const totals = await db
      .prepare(
        `SELECT
           COUNT(*) as total_messages,
           SUM(CASE WHEN status='sent' OR status='delivered' OR status='read' THEN 1 ELSE 0 END) as total_sent,
           SUM(CASE WHEN status='delivered' OR status='read' THEN 1 ELSE 0 END) as total_delivered,
           SUM(CASE WHEN status='read' THEN 1 ELSE 0 END) as total_read,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as total_failed,
           SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) as total_queued
         FROM messages`
      )
      .first();

    // Inbox unread count
    const unread = await db
      .prepare(`SELECT COUNT(DISTINCT phone) as count FROM conversations WHERE status = 'unread' AND direction = 'inbound'`)
      .first();

    return json({
      campaigns: campaigns.results,
      totals: totals || {
        total_messages: 0,
        total_sent: 0,
        total_delivered: 0,
        total_read: 0,
        total_failed: 0,
        total_queued: 0,
      },
      unread_conversations: unread?.count || 0,
    });
  }

  if (action === "messages") {
    const id = url.searchParams.get("id");
    const status = url.searchParams.get("status");
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 50;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM messages WHERE campaign_id = ?`;
    const params = [id];

    if (status && status !== "all") {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.prepare(query).bind(...params).all();

    const countQuery =
      status && status !== "all"
        ? `SELECT COUNT(*) as total FROM messages WHERE campaign_id = ? AND status = ?`
        : `SELECT COUNT(*) as total FROM messages WHERE campaign_id = ?`;
    const countParams = status && status !== "all" ? [id, status] : [id];
    const count = await db.prepare(countQuery).bind(...countParams).first();

    return json({
      messages: rows.results,
      total: count?.total || 0,
      page,
      pages: Math.ceil((count?.total || 0) / limit),
    });
  }

  // ── Inbox: list conversations with latest message ──
  if (action === "inbox") {
    const status = url.searchParams.get("status") || "all";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 30;
    const offset = (page - 1) * limit;

    // Get unique phone conversations with latest message
    let query = `
      SELECT
        c.phone,
        c.candidate_name,
        c.campaign_id,
        c.body as last_message,
        c.direction as last_direction,
        c.created_at as last_message_at,
        c.msg_type,
        m.candidate_name as msg_candidate_name,
        cam.name as campaign_name,
        cam.role as campaign_role,
        (SELECT COUNT(*) FROM conversations c2 WHERE c2.phone = c.phone AND c2.status = 'unread' AND c2.direction = 'inbound') as unread_count,
        (SELECT COUNT(*) FROM conversations c3 WHERE c3.phone = c.phone) as total_messages
      FROM conversations c
      LEFT JOIN messages m ON m.phone = c.phone AND m.campaign_id = c.campaign_id
      LEFT JOIN campaigns cam ON cam.id = c.campaign_id
      WHERE c.id = (
        SELECT MAX(c4.id) FROM conversations c4 WHERE c4.phone = c.phone
      )`;

    const params = [];
    if (status === "unread") {
      query += ` AND (SELECT COUNT(*) FROM conversations c5 WHERE c5.phone = c.phone AND c5.status = 'unread' AND c5.direction = 'inbound') > 0`;
    } else if (status === "replied") {
      query += ` AND (SELECT COUNT(*) FROM conversations c5 WHERE c5.phone = c.phone AND c5.direction = 'outbound') > 0`;
    }

    query += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.prepare(query).bind(...params).all();

    // Total conversations count
    const countResult = await db
      .prepare(`SELECT COUNT(DISTINCT phone) as total FROM conversations`)
      .first();

    return json({
      conversations: rows.results.map((r) => ({
        phone: r.phone,
        candidate_name: r.candidate_name || r.msg_candidate_name || "",
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name || "",
        campaign_role: r.campaign_role || "",
        last_message: r.last_message || "",
        last_direction: r.last_direction,
        last_message_at: r.last_message_at,
        msg_type: r.msg_type,
        unread_count: r.unread_count || 0,
        total_messages: r.total_messages || 0,
      })),
      total: countResult?.total || 0,
      page,
      pages: Math.ceil((countResult?.total || 0) / limit),
    });
  }

  // ── Conversation thread for a phone ──
  if (action === "conversation") {
    const phone = normalizePhone(url.searchParams.get("phone"));
    if (!phone) return json({ error: "Phone required" }, 400);

    // Get all conversation messages
    const thread = await db
      .prepare(
        `SELECT * FROM conversations WHERE phone = ? ORDER BY created_at ASC`
      )
      .bind(phone)
      .all();

    // Get candidate info from messages table
    const candidate = await db
      .prepare(
        `SELECT m.*, c.name as campaign_name, c.role as campaign_role, c.template_name
         FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id
         WHERE m.phone = ? ORDER BY m.id DESC LIMIT 1`
      )
      .bind(phone)
      .first();

    // Mark all unread as read
    await db
      .prepare(
        `UPDATE conversations SET status = 'read' WHERE phone = ? AND status = 'unread'`
      )
      .bind(phone)
      .run();

    return json({
      thread: thread.results,
      candidate: candidate
        ? {
            phone: candidate.phone,
            name: candidate.candidate_name || "",
            campaign_name: candidate.campaign_name || "",
            campaign_role: candidate.campaign_role || "",
            template_name: candidate.template_name || "",
            template_params: candidate.template_params || "[]",
            status: candidate.status,
            sent_at: candidate.sent_at,
            delivered_at: candidate.delivered_at,
            read_at: candidate.read_at,
          }
        : null,
    });
  }

  return json({ error: "Unknown action" }, 400);
}

// ─── POST handlers ─────────────────────────────────────────
async function handlePost(request, env) {
  const db = env.DB;

  // Check if this is a raw Meta webhook (no action field, has "object" field)
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ── Direct Meta Webhook ──
  // Meta sends webhooks with { object: "whatsapp_business_account", entry: [...] }
  if (body.object === "whatsapp_business_account") {
    return handleWebhook(db, body);
  }

  const { action } = body;

  // ── Create Campaign ──
  if (action === "create_campaign") {
    const { name, template_name, role, salary, campaign_type, brand, category } = body;
    const result = await db
      .prepare(
        `INSERT INTO campaigns (name, template_name, role, salary, campaign_type, brand, category)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        name,
        template_name,
        role,
        salary || "",
        campaign_type || "personalized",
        brand || "Hamza Express",
        category || "hiring"
      )
      .run();

    return json({ id: result.meta.last_row_id, success: true });
  }

  // ── Import candidates from CSV data ──
  if (action === "import_candidates") {
    const { campaign_id, candidates } = body;
    if (!candidates || !candidates.length) {
      return json({ error: "No candidates" }, 400);
    }

    const stmt = db.prepare(
      `INSERT INTO messages (campaign_id, phone, candidate_name, template_params, status)
       VALUES (?, ?, ?, ?, 'queued')`
    );

    const batch = candidates.map((c) =>
      stmt.bind(
        campaign_id,
        c.phone,
        c.name || "",
        JSON.stringify(c.params || [])
      )
    );

    for (let i = 0; i < batch.length; i += 100) {
      await db.batch(batch.slice(i, i + 100));
    }

    await db
      .prepare(
        `UPDATE campaigns SET total_candidates = total_candidates + ? WHERE id = ?`
      )
      .bind(candidates.length, campaign_id)
      .run();

    return json({ imported: candidates.length, success: true });
  }

  // ── Import historical send log (one-time bootstrap) ──
  if (action === "import_send_log") {
    const { campaigns: campaignsData, messages: messagesData } = body;
    // campaignsData = [{ name, role, salary, template_name, sent_count }]
    // messagesData = [{ campaign_name, phone, name, role, wamid, status }]

    if (!campaignsData || !messagesData) {
      return json({ error: "campaigns and messages arrays required" }, 400);
    }

    // Create campaigns
    const campaignIds = {};
    for (const c of campaignsData) {
      const existing = await db
        .prepare(`SELECT id FROM campaigns WHERE name = ?`)
        .bind(c.name)
        .first();

      if (existing) {
        campaignIds[c.name] = existing.id;
      } else {
        const result = await db
          .prepare(
            `INSERT INTO campaigns (name, template_name, role, salary, campaign_type, brand, category, status, total_candidates, sent_count, started_at, completed_at)
             VALUES (?, ?, ?, ?, 'personalized', 'Hamza Express', 'hiring', 'completed', ?, ?, datetime('now'), datetime('now'))`
          )
          .bind(
            c.name,
            c.template_name || "he_hiring_mar26",
            c.role,
            c.salary || "",
            c.sent_count || 0,
            c.sent_count || 0
          )
          .run();
        campaignIds[c.name] = result.meta.last_row_id;
      }
    }

    // Insert messages in batches
    const stmt = db.prepare(
      `INSERT INTO messages (campaign_id, phone, candidate_name, wamid, status, sent_at)
       VALUES (?, ?, ?, ?, 'sent', datetime('now'))`
    );

    const batch = messagesData.map((m) =>
      stmt.bind(
        campaignIds[m.campaign_name] || 0,
        normalizePhone(m.phone),
        m.name || "",
        m.wamid || ""
      )
    );

    for (let i = 0; i < batch.length; i += 100) {
      await db.batch(batch.slice(i, i + 100));
    }

    return json({
      campaigns_created: Object.keys(campaignIds).length,
      messages_imported: messagesData.length,
      success: true,
    });
  }

  // ── Send batch of messages ──
  if (action === "send_batch") {
    const { campaign_id, batch_size = 20 } = body;
    const WA_TOKEN = env.WA_ACCESS_TOKEN;
    const WA_PHONE_ID = env.WA_PHONE_ID;

    if (!WA_TOKEN || !WA_PHONE_ID) {
      return json({ error: "WhatsApp credentials not configured" }, 500);
    }

    const campaign = await db
      .prepare(`SELECT * FROM campaigns WHERE id = ?`)
      .bind(campaign_id)
      .first();

    if (!campaign) return json({ error: "Campaign not found" }, 404);

    if (campaign.status === "draft" || campaign.status === "paused") {
      await db
        .prepare(
          `UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?`
        )
        .bind(campaign_id)
        .run();
    }

    const queued = await db
      .prepare(
        `SELECT * FROM messages WHERE campaign_id = ? AND status = 'queued' LIMIT ?`
      )
      .bind(campaign_id, batch_size)
      .all();

    if (!queued.results.length) {
      await db
        .prepare(
          `UPDATE campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .bind(campaign_id)
        .run();
      return json({ sent: 0, remaining: 0, status: "completed" });
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const msg of queued.results) {
      try {
        const params = JSON.parse(msg.template_params || "[]");
        const components = [];

        components.push({
          type: "header",
          parameters: [
            { type: "image", image: { id: env.WA_MEDIA_ID || "" } },
          ],
        });

        if (params.length > 0) {
          components.push({
            type: "body",
            parameters: params.map((p) => ({ type: "text", text: p })),
          });
        }

        const result = await sendWhatsApp(env, `91${msg.phone}`, {
          type: "template",
          template: {
            name: campaign.template_name,
            language: { code: "en" },
            components,
          },
        });

        if (result.messages && result.messages[0]) {
          await db
            .prepare(
              `UPDATE messages SET status = 'sent', wamid = ?, wa_id = ?, sent_at = datetime('now') WHERE id = ?`
            )
            .bind(
              result.messages[0].id,
              result.contacts?.[0]?.wa_id || "",
              msg.id
            )
            .run();
          sentCount++;
        } else {
          const errMsg = result.error?.message || "Unknown error";
          const errCode = result.error?.code?.toString() || "";
          await db
            .prepare(
              `UPDATE messages SET status = 'failed', error_code = ?, error_message = ?, failed_at = datetime('now') WHERE id = ?`
            )
            .bind(errCode, errMsg, msg.id)
            .run();
          failedCount++;
        }
      } catch (err) {
        await db
          .prepare(
            `UPDATE messages SET status = 'failed', error_message = ?, failed_at = datetime('now') WHERE id = ?`
          )
          .bind(err.message, msg.id)
          .run();
        failedCount++;
      }

      await new Promise((r) => setTimeout(r, 60));
    }

    await refreshCampaignCounts(db, campaign_id);

    const remaining = await db
      .prepare(
        `SELECT COUNT(*) as count FROM messages WHERE campaign_id = ? AND status = 'queued'`
      )
      .bind(campaign_id)
      .first();

    if (remaining.count === 0) {
      await db
        .prepare(
          `UPDATE campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .bind(campaign_id)
        .run();
    }

    return json({
      sent: sentCount,
      failed: failedCount,
      remaining: remaining.count,
      status: remaining.count === 0 ? "completed" : "sending",
    });
  }

  // ── Pause campaign ──
  if (action === "pause_campaign") {
    const { campaign_id } = body;
    await db
      .prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ?`)
      .bind(campaign_id)
      .run();
    return json({ success: true });
  }

  // ── Send reply to candidate ──
  if (action === "reply") {
    const { phone, text } = body;
    if (!phone || !text) {
      return json({ error: "phone and text required" }, 400);
    }

    const normalizedPhone = normalizePhone(phone);
    const WA_TOKEN = env.WA_ACCESS_TOKEN;
    const WA_PHONE_ID = env.WA_PHONE_ID;

    if (!WA_TOKEN || !WA_PHONE_ID) {
      return json({ error: "WhatsApp credentials not configured" }, 500);
    }

    // Send via WhatsApp API (free-form text within 24hr window)
    const result = await sendWhatsApp(env, `91${normalizedPhone}`, {
      type: "text",
      text: { body: text },
    });

    const wamid = result.messages?.[0]?.id || "";
    const success = !!wamid;

    if (!success) {
      return json({
        success: false,
        error: result.error?.message || "Failed to send",
        error_code: result.error?.code,
      });
    }

    // Find related campaign for this phone
    const msg = await db
      .prepare(
        `SELECT campaign_id, candidate_name FROM messages WHERE phone = ? ORDER BY id DESC LIMIT 1`
      )
      .bind(normalizedPhone)
      .first();

    // Insert outbound conversation record
    await db
      .prepare(
        `INSERT INTO conversations (phone, campaign_id, message_id, candidate_name, direction, msg_type, body, wamid, status)
         VALUES (?, ?, ?, ?, 'outbound', 'text', ?, ?, 'sent')`
      )
      .bind(
        normalizedPhone,
        msg?.campaign_id || null,
        null,
        msg?.candidate_name || "",
        text,
        wamid
      )
      .run();

    return json({ success: true, wamid });
  }

  // ── Mark conversation as read ──
  if (action === "mark_read") {
    const { phone } = body;
    if (!phone) return json({ error: "phone required" }, 400);

    const normalizedPhone = normalizePhone(phone);
    await db
      .prepare(
        `UPDATE conversations SET status = 'read' WHERE phone = ? AND status = 'unread'`
      )
      .bind(normalizedPhone)
      .run();

    return json({ success: true });
  }

  // ── Legacy webhook format (action: "webhook") ──
  if (action === "webhook") {
    return handleWebhook(db, body);
  }

  return json({ error: "Unknown action" }, 400);
}

// ─── Webhook handler (Meta WhatsApp) ───────────────────────
async function handleWebhook(db, body) {
  const entry = body.entry || [];

  for (const e of entry) {
    for (const change of e.changes || []) {
      const value = change.value || {};

      // ── Status updates (delivery receipts) ──
      const statuses = value.statuses || [];
      for (const s of statuses) {
        const wamid = s.id;
        const status = s.status;
        const timestamp = s.timestamp
          ? new Date(parseInt(s.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        // Log webhook event
        await db
          .prepare(
            `INSERT INTO webhook_events (wamid, event_type, status, timestamp, error_code, error_title)
             VALUES (?, 'status', ?, ?, ?, ?)`
          )
          .bind(
            wamid,
            status,
            timestamp,
            s.errors?.[0]?.code?.toString() || null,
            s.errors?.[0]?.title || null
          )
          .run();

        // Update message status
        if (status === "sent") {
          await db
            .prepare(
              `UPDATE messages SET status = 'sent', sent_at = ? WHERE wamid = ? AND status = 'queued'`
            )
            .bind(timestamp, wamid)
            .run();
        } else if (status === "delivered") {
          await db
            .prepare(
              `UPDATE messages SET status = 'delivered', delivered_at = ? WHERE wamid = ? AND status IN ('sent')`
            )
            .bind(timestamp, wamid)
            .run();
        } else if (status === "read") {
          await db
            .prepare(
              `UPDATE messages SET status = 'read', read_at = ? WHERE wamid = ? AND status IN ('sent', 'delivered')`
            )
            .bind(timestamp, wamid)
            .run();
        } else if (status === "failed") {
          await db
            .prepare(
              `UPDATE messages SET status = 'failed', failed_at = ?, error_code = ?, error_message = ? WHERE wamid = ?`
            )
            .bind(
              timestamp,
              s.errors?.[0]?.code?.toString() || "",
              s.errors?.[0]?.title || "Delivery failed",
              wamid
            )
            .run();
        }

        // Update campaign counts
        const msg = await db
          .prepare(`SELECT campaign_id FROM messages WHERE wamid = ?`)
          .bind(wamid)
          .first();

        if (msg) {
          await refreshCampaignCounts(db, msg.campaign_id);
        }
      }

      // ── Incoming messages (candidate replies) ──
      const messages = value.messages || [];
      for (const msg of messages) {
        const senderFull = msg.from || ""; // e.g. "919876543210"
        const senderPhone = normalizePhone(senderFull); // → "9876543210"
        const msgType = msg.type || "text";
        const wamid = msg.id || "";
        const timestamp = msg.timestamp
          ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        // Extract message body based on type
        let messageBody = "";
        if (msgType === "text") {
          messageBody = msg.text?.body || "";
        } else if (msgType === "button") {
          messageBody = msg.button?.text || msg.button?.payload || "";
        } else if (msgType === "interactive") {
          messageBody =
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            "[interactive]";
        } else if (msgType === "image") {
          messageBody = msg.image?.caption || "[Image]";
        } else if (msgType === "document") {
          messageBody = msg.document?.caption || "[Document]";
        } else if (msgType === "audio") {
          messageBody = "[Voice message]";
        } else if (msgType === "video") {
          messageBody = msg.video?.caption || "[Video]";
        } else if (msgType === "location") {
          messageBody = `[Location: ${msg.location?.latitude}, ${msg.location?.longitude}]`;
        } else if (msgType === "reaction") {
          messageBody = msg.reaction?.emoji || "[Reaction]";
        } else {
          messageBody = `[${msgType}]`;
        }

        // Check for duplicate wamid
        const existing = await db
          .prepare(`SELECT id FROM conversations WHERE wamid = ?`)
          .bind(wamid)
          .first();
        if (existing) continue;

        // Find related campaign message for this phone
        const originalMsg = await db
          .prepare(
            `SELECT id, campaign_id, candidate_name FROM messages WHERE phone = ? ORDER BY id DESC LIMIT 1`
          )
          .bind(senderPhone)
          .first();

        // Log webhook event
        await db
          .prepare(
            `INSERT INTO webhook_events (wamid, event_type, status, timestamp, raw_payload)
             VALUES (?, 'message', ?, ?, ?)`
          )
          .bind(wamid, msgType, timestamp, JSON.stringify(msg).slice(0, 2000))
          .run();

        // Insert conversation record
        await db
          .prepare(
            `INSERT INTO conversations (phone, campaign_id, message_id, candidate_name, direction, msg_type, body, wamid, status, created_at)
             VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, 'unread', ?)`
          )
          .bind(
            senderPhone,
            originalMsg?.campaign_id || null,
            originalMsg?.id || null,
            originalMsg?.candidate_name || value.contacts?.[0]?.profile?.name || "",
            msgType,
            messageBody,
            wamid,
            timestamp
          )
          .run();

        // Mark original message as having a reply
        if (originalMsg) {
          await db
            .prepare(
              `UPDATE messages SET has_reply = 1, last_reply_at = ? WHERE id = ?`
            )
            .bind(timestamp, originalMsg.id)
            .run();
        }
      }
    }
  }

  return json({ success: true });
}

// ─── Main handler ──────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    if (request.method === "GET") {
      return handleGet(url, env);
    }
    if (request.method === "POST") {
      return handlePost(request, env);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("Hiring API error:", err);
    return json({ error: err.message }, 500);
  }
}
