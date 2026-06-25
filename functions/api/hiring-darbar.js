/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HIRING-DARBAR — the mobile hiring surface for the Darbar app (the work BEFORE hire)
 *
 * Darbar = staff management AFTER hire. This is the sourcing layer BEFORE it.
 * Phase-1 (free channels, no box):
 *   #1 Call manpower suppliers — tap-to-call + log the outcome (hiring_suppliers + …_calls)
 *   #2 Manager-referral WhatsApp blast — categorised, commission, ROSTER-EXCLUDED (uses /api/hiring)
 *
 * Same D1 as Darbar + the WhatsApp hiring engine (binding DB → hn-hiring), so the
 * "never message current staff" exclusion is a same-DB read of hr_employees, not a
 * cross-service call. Auth is the shared Darbar token (x-darbar-token) — same gate
 * as /api/darbar; no new secret, no new origin.
 *
 * Actions:
 *   GET  ?action=overview        — Phase-1 counts (suppliers by grade/status) for the tab header
 *   GET  ?action=suppliers       — graded call list (filter ?status= ?grade=)
 *   GET  ?action=supplier&id=    — one supplier + its call history
 *   GET  ?action=exclusion_count — how many active staff phones are on the do-not-message set
 *   POST ?action=log_call        — record a call attempt + roll the supplier's status
 *   POST ?action=supplier_add    — add one supplier by hand
 *   POST ?action=seed_suppliers  — bulk upsert the research output (admin/service only)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { verifyToken, corsHeaders } from './_lib/darbar-auth.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function withCors(resp, request) {
  const h = corsHeaders(request);
  for (const [k, v] of Object.entries(h)) resp.headers.set(k, v);
  return resp;
}

// --- helpers ---------------------------------------------------------------
const jparse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
const jarr = (v) => Array.isArray(v) ? JSON.stringify(v) : (v == null ? null : JSON.stringify([String(v)]));

// Normalize an Indian phone to bare 10 digits (strip +91 / 0 / spaces). null if not 10 digits.
function normPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(d.length - 10);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

// outcome → supplier status roll
function statusForOutcome(outcome) {
  switch (outcome) {
    case 'reached':       return 'responded';
    case 'will_send':
    case 'sent_jd':       return 'sent_jd';
    case 'not_relevant':  return 'not_relevant';
    case 'dead':          return 'dead';
    case 'no_answer':
    case 'busy':
    case 'callback':      return 'called';
    default:              return 'called';
  }
}

// Shape a DB row → API supplier (JSON fields parsed, ints → bools)
function shapeSupplier(r) {
  return {
    id: r.id, name: r.name, type: r.type, phone: r.phone, whatsapp: r.whatsapp,
    area: r.area, city: r.city, website: r.website,
    source_urls: jparse(r.source_urls, []), specialization: r.specialization,
    roles_supplied: jparse(r.roles_supplied, []),
    hospitality_focus: !!r.hospitality_focus, central_blr: !!r.central_blr,
    relevance_score: r.relevance_score, grade: r.grade, confidence: r.confidence,
    evidence: r.evidence, notes: r.notes, status: r.status,
    call_count: r.call_count, last_called_at: r.last_called_at, last_outcome: r.last_outcome,
    source: r.source, created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ===========================================================================
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'overview';
  const db = env.DB;

  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
  if (!db) return withCors(json({ error: 'DB binding missing' }, 500), request);

  try {
    // Every action requires a valid Darbar token (or internal service key).
    const auth = await verifyToken(env, request);
    if (!auth) return withCors(json({ error: 'unauthorized' }, 401), request);
    const isAdmin = !!(auth.f || auth.r === 'admin' || auth.service);

    if (request.method === 'GET') {
      if (action === 'overview')        return withCors(await overview(db), request);
      if (action === 'suppliers')       return withCors(await suppliers(db, url), request);
      if (action === 'supplier')        return withCors(await supplierOne(db, url), request);
      if (action === 'exclusion_count') return withCors(await exclusionCount(db), request);
      if (action === 'roles')           return withCors(await roles(db, url), request);
      if (action === 'audience_preview')return withCors(await audiencePreview(db, url), request);
      if (action === 'inbox')           return withCors(await hiringInbox(db, url), request);
      if (action === 'campaign')        return withCors(await campaignOne(db, url), request);
      if (action === 'fb_overview')     return withCors(await fbOverview(db), request);
      if (action === 'fb_creatives')    return withCors(await fbCreatives(db), request);
      if (action === 'fb_sessions')     return withCors(await fbSessions(db, url), request);
      if (action === 'fb_posts')        return withCors(await fbPosts(db, url), request);
      if (action === 'fb_preview')      return withCors(await fbPreview(db, url, env, request), request);
      return withCors(json({ error: `unknown GET action: ${action}` }, 400), request);
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (action === 'log_call')       return withCors(await logCall(db, body, auth), request);
      if (action === 'supplier_add')   return withCors(await supplierAdd(db, body), request);
      if (action === 'seed_suppliers') {
        if (!isAdmin) return withCors(json({ error: 'forbidden — admin only' }, 403), request);
        return withCors(await seedSuppliers(db, body), request);
      }
      if (action === 'compose')        return withCors(await composeCampaign(db, body, env, request), request);
      if (action === 'send')           return withCors(await sendCampaign(db, body, env, request), request);
      if (action === 'reply')          return withCors(await replyToCandidate(db, body, env, request), request);
      if (action === 'mark_outcome')   return withCors(await markOutcome(db, body), request);
      if (action === 'fb_compose')     return withCors(await fbCompose(db, body, env, request), request);
      if (action === 'fb_pause')       return withCors(await fbPause(db, body, env, request), request);
      if (action === 'fb_resume')      return withCors(await fbResume(db, body, env, request), request);
      return withCors(json({ error: `unknown POST action: ${action}` }, 400), request);
    }

    return withCors(json({ error: 'method not allowed' }, 405), request);
  } catch (e) {
    return withCors(json({ error: String(e && e.message || e) }, 500), request);
  }
}

// --- reads -----------------------------------------------------------------

async function overview(db) {
  // suppliers may not exist on a fresh DB; guard with a count probe.
  const total = await db.prepare(`SELECT COUNT(*) n FROM hiring_suppliers`).first().catch(() => null);
  if (!total) return json({ ready: false, suppliers: { total: 0 }, note: 'suppliers table not provisioned yet' });
  const byGrade = (await db.prepare(
    `SELECT COALESCE(grade,'-') grade, COUNT(*) n FROM hiring_suppliers GROUP BY grade`).all()).results || [];
  const byStatus = (await db.prepare(
    `SELECT status, COUNT(*) n FROM hiring_suppliers GROUP BY status`).all()).results || [];
  const callable = await db.prepare(
    `SELECT COUNT(*) n FROM hiring_suppliers WHERE phone IS NOT NULL`).first();
  const uncalled = await db.prepare(
    `SELECT COUNT(*) n FROM hiring_suppliers WHERE phone IS NOT NULL AND status='new'`).first();
  return json({
    ready: true,
    suppliers: {
      total: total.n,
      callable: callable?.n || 0,
      uncalled: uncalled?.n || 0,
      by_grade: Object.fromEntries(byGrade.map(r => [r.grade, r.n])),
      by_status: Object.fromEntries(byStatus.map(r => [r.status, r.n])),
    },
  });
}

async function suppliers(db, url) {
  const status = url.searchParams.get('status');
  const grade = url.searchParams.get('grade');
  const where = [];
  const binds = [];
  if (status && status !== 'all') { where.push('status = ?'); binds.push(status); }
  if (grade && grade !== 'all')   { where.push('grade = ?');  binds.push(grade); }
  const sql =
    `SELECT * FROM hiring_suppliers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (phone IS NULL) ASC,
              CASE grade WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END ASC,
              relevance_score DESC, name ASC`;
  const rows = (await db.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }))).results || [];
  return json({ suppliers: rows.map(shapeSupplier), count: rows.length });
}

async function supplierOne(db, url) {
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return json({ error: 'id required' }, 400);
  const row = await db.prepare(`SELECT * FROM hiring_suppliers WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);
  const calls = (await db.prepare(
    `SELECT id, outcome, note, roles_requested, by_user, created_at
       FROM hiring_supplier_calls WHERE supplier_id = ? ORDER BY created_at DESC`).bind(id).all()).results || [];
  return json({
    supplier: shapeSupplier(row),
    calls: calls.map(c => ({ ...c, roles_requested: jparse(c.roles_requested, []) })),
  });
}

// How many active-staff phones form the do-not-message exclusion set (flow #2 guard).
async function exclusionCount(db) {
  const r = await db.prepare(
    `SELECT COUNT(DISTINCT phone) n FROM hr_employees WHERE is_active = 1 AND phone IS NOT NULL AND phone <> ''`
  ).first().catch(() => null);
  return json({ exclusion_count: r?.n || 0 });
}

// --- writes ----------------------------------------------------------------

async function logCall(db, body, auth) {
  const sid = parseInt(body.supplier_id || 0, 10);
  const outcome = String(body.outcome || '').trim();
  if (!sid || !outcome) return json({ error: 'supplier_id and outcome required' }, 400);
  const exists = await db.prepare(`SELECT id FROM hiring_suppliers WHERE id = ?`).bind(sid).first();
  if (!exists) return json({ error: 'supplier not found' }, 404);

  const roles = jarr(body.roles_requested);
  await db.prepare(
    `INSERT INTO hiring_supplier_calls (supplier_id, outcome, note, roles_requested, by_user)
     VALUES (?,?,?,?,?)`
  ).bind(sid, outcome, body.note || null, roles, (auth && auth.u) || 'owner').run();

  await db.prepare(
    `UPDATE hiring_suppliers
        SET status = ?, last_outcome = ?, last_called_at = datetime('now'),
            call_count = call_count + 1, updated_at = datetime('now')
      WHERE id = ?`
  ).bind(statusForOutcome(outcome), outcome, sid).run();

  const row = await db.prepare(`SELECT * FROM hiring_suppliers WHERE id = ?`).bind(sid).first();
  return json({ ok: true, supplier: shapeSupplier(row) });
}

async function supplierAdd(db, body) {
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'name required' }, 400);
  const phone = normPhone(body.phone);
  const r = await upsertSupplier(db, { ...body, name, phone, source: body.source || 'manual' });
  return json({ ok: true, id: r.id, action: r.action });
}

async function seedSuppliers(db, body) {
  const list = Array.isArray(body.suppliers) ? body.suppliers : [];
  if (!list.length) return json({ error: 'suppliers[] required' }, 400);
  let inserted = 0, updated = 0;
  for (const s of list) {
    if (!s || !s.name) continue;
    const r = await upsertSupplier(db, { ...s, phone: normPhone(s.phone), source: s.source || 'research' });
    if (r.action === 'insert') inserted++; else updated++;
  }
  const total = await db.prepare(`SELECT COUNT(*) n FROM hiring_suppliers`).first();
  return json({ ok: true, inserted, updated, total: total?.n || 0 });
}

// Upsert one supplier: by phone when present (idempotent re-seed), else by lower(name).
async function upsertSupplier(db, s) {
  const fields = {
    name: s.name, type: s.type || null, phone: s.phone || null, whatsapp: normPhone(s.whatsapp),
    area: s.area || null, city: s.city || 'Bangalore', website: s.website || null,
    source_urls: jarr(s.source_urls), specialization: s.specialization || null,
    roles_supplied: jarr(s.roles_supplied),
    hospitality_focus: s.hospitality_focus ? 1 : 0, central_blr: s.central_blr ? 1 : 0,
    relevance_score: Number.isFinite(+s.relevance_score) ? +s.relevance_score : 0,
    grade: s.grade || null, confidence: s.confidence || null,
    evidence: s.evidence || null, notes: s.notes || null, source: s.source || 'research',
  };

  // find existing
  let existing = null;
  if (fields.phone) existing = await db.prepare(`SELECT id FROM hiring_suppliers WHERE phone = ?`).bind(fields.phone).first();
  if (!existing) existing = await db.prepare(`SELECT id FROM hiring_suppliers WHERE lower(name) = lower(?)`).bind(fields.name).first();

  if (existing) {
    await db.prepare(
      `UPDATE hiring_suppliers SET
         name=?, type=COALESCE(?,type), phone=COALESCE(?,phone), whatsapp=COALESCE(?,whatsapp),
         area=COALESCE(?,area), city=?, website=COALESCE(?,website), source_urls=COALESCE(?,source_urls),
         specialization=COALESCE(?,specialization), roles_supplied=COALESCE(?,roles_supplied),
         hospitality_focus=?, central_blr=?, relevance_score=?, grade=COALESCE(?,grade),
         confidence=COALESCE(?,confidence), evidence=COALESCE(?,evidence), notes=COALESCE(?,notes),
         updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      fields.name, fields.type, fields.phone, fields.whatsapp, fields.area, fields.city, fields.website,
      fields.source_urls, fields.specialization, fields.roles_supplied, fields.hospitality_focus,
      fields.central_blr, fields.relevance_score, fields.grade, fields.confidence, fields.evidence,
      fields.notes, existing.id
    ).run();
    return { id: existing.id, action: 'update' };
  }

  const res = await db.prepare(
    `INSERT INTO hiring_suppliers
       (name,type,phone,whatsapp,area,city,website,source_urls,specialization,roles_supplied,
        hospitality_focus,central_blr,relevance_score,grade,confidence,evidence,notes,source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    fields.name, fields.type, fields.phone, fields.whatsapp, fields.area, fields.city, fields.website,
    fields.source_urls, fields.specialization, fields.roles_supplied, fields.hospitality_focus,
    fields.central_blr, fields.relevance_score, fields.grade, fields.confidence, fields.evidence,
    fields.notes, fields.source
  ).run();
  return { id: res.meta?.last_row_id, action: 'insert' };
}

// ===========================================================================
// WhatsApp campaign engine (flow #2) — additive to Phase-1a suppliers
// ===========================================================================

const STAFF_EXCLUSION_SQL = `phone NOT IN (SELECT phone FROM hr_employees WHERE is_active = 1 AND phone IS NOT NULL AND phone <> '')`;

// GET ?action=roles — scored role registry with live supply + responsiveness
async function roles(db, url) {
  const brandFilter = url.searchParams.get('brand') || 'all';
  const rows = (await db.prepare(
    `SELECT * FROM hiring_roles WHERE active = 1 ORDER BY always_need DESC, priority_score DESC, label ASC`
  ).all()).results || [];

  // Supply counts from candidates table by role label
  const supply = await db.prepare(
    `SELECT he_role, COUNT(*) n FROM candidates GROUP BY he_role`
  ).all();
  const supplyMap = {};
  for (const r of (supply.results || [])) supplyMap[r.he_role] = r.n;

  // Historical reply rate per role label: (messages with has_reply) / sent
  const replyStats = await db.prepare(
    `SELECT m.campaign_id, c.role, COUNT(*) sent, SUM(m.has_reply) replied
     FROM messages m JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.status IN ('sent','delivered','read')
     GROUP BY c.role`
  ).all().catch(() => ({ results: [] }));
  const replyMap = {};
  for (const r of (replyStats.results || [])) {
    replyMap[r.role] = { sent: r.sent, replied: r.replied, rate: r.sent ? Math.round((r.replied / r.sent) * 1000) / 10 : 0 };
  }

  const enriched = rows.map(r => {
    const supplyCount = supplyMap[r.label] || 0;
    const reply = replyMap[r.label] || { sent: 0, replied: 0, rate: 0 };
    const channel = channelForRole(r, supplyCount, reply.rate);
    return {
      ...r,
      odoo_job_names: jparse(r.odoo_job_names, []),
      supply_count: supplyCount,
      reply_rate: reply.rate,
      reply_sent: reply.sent,
      reply_replied: reply.replied,
      channel,
    };
  }).filter(r => brandFilter === 'all' || r.brand === brandFilter || r.brand === 'both');

  const nudges = buildNudges(enriched);

  return json({
    roles: enriched,
    nudges,
    counts: {
      always_need: enriched.filter(r => r.always_need).length,
      total: enriched.length,
    },
  });
}

function channelForRole(role, supplyCount, replyRate) {
  if (role.always_need && supplyCount < 30 && replyRate < 3) return 'suppliers+referral+fb';
  if (role.always_need && (supplyCount >= 30 || replyRate >= 3)) return 'db+referral';
  if (!role.always_need && replyRate >= 3) return 'db-on-demand';
  return 'suppliers+referral';
}

function buildNudges(roles) {
  const nudges = [];
  const thin = roles.filter(r => r.always_need && r.supply_count < 30);
  if (thin.length) nudges.push(`${thin.map(r => r.label).join(', ')} — thin supply (${thin.map(r => r.supply_count).join('/')}) → use suppliers + referral`);
  const warm = roles.filter(r => r.reply_rate >= 4 && r.reply_sent >= 20);
  if (warm.length) nudges.push(`${warm.map(r => r.label).join(', ')} — warm WhatsApp channel`);
  return nudges;
}

// GET ?action=audience_preview&role=&brand=&city=
async function audiencePreview(db, url) {
  const role = url.searchParams.get('role');
  const city = url.searchParams.get('city');
  if (!role) return json({ error: 'role required' }, 400);

  let totalQuery = `SELECT COUNT(*) n FROM candidates WHERE he_role = ?`;
  let totalParams = [role];
  if (city) { totalQuery += ` AND city = ?`; totalParams.push(city); }
  const total = await db.prepare(totalQuery).bind(...totalParams).first();

  let afterQuery = `SELECT COUNT(*) n FROM candidates WHERE he_role = ? AND ${STAFF_EXCLUSION_SQL}`;
  let afterParams = [role];
  if (city) { afterQuery += ` AND city = ?`; afterParams.push(city); }
  const after = await db.prepare(afterQuery).bind(...afterParams).first();

  const exclusion = await db.prepare(
    `SELECT COUNT(DISTINCT phone) n FROM hr_employees WHERE is_active = 1 AND phone IS NOT NULL AND phone <> ''`
  ).first();

  return json({
    role,
    city: city || null,
    total_candidates: total?.n || 0,
    after_exclusion: after?.n || 0,
    excluded_staff: exclusion?.n || 0,
  });
}

// POST ?action=compose {role_key, brand, commission, city?, audience_mode?}
async function composeCampaign(db, body, env, request) {
  const roleKey = String(body.role_key || '');
  const commission = String(body.commission || '');
  if (!roleKey) return json({ error: 'role_key required' }, 400);
  if (!commission) return json({ error: 'commission required' }, 400);

  const role = await db.prepare(`SELECT * FROM hiring_roles WHERE role_key = ? AND active = 1`).bind(roleKey).first();
  if (!role) return json({ error: 'role not found' }, 404);

  let brand = String(body.brand || 'he').toLowerCase();
  if (role.brand !== 'both' && role.brand !== brand) brand = role.brand;

  const packageText = body.package || role.default_package || '';
  const posterUrl = body.poster_url || role.poster_url || '';
  const city = body.city || null;
  const audienceMode = body.audience_mode || 'available';
  const today = new Date().toISOString().slice(0, 10);
  const campaignName = `${brand.toUpperCase()} ${role.label} · ${today}`;

  const variableMapping = JSON.stringify(['role', 'package', 'commission']);

  const campRes = await db.prepare(
    `INSERT INTO campaigns (name, template_name, role, role_key, salary, campaign_type, brand, category, variable_mapping, commission, package, poster_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`
  ).bind(
    campaignName,
    role.template_name,
    role.label,
    roleKey,
    '',
    'flexible',
    brand,
    'hiring',
    variableMapping,
    commission,
    packageText,
    posterUrl
  ).run();
  const campaignId = campRes.meta.last_row_id;

  // Build candidate query, excluding active staff and previously-contacted per audience_mode
  let candidateQuery = `SELECT * FROM candidates WHERE he_role = ? AND ${STAFF_EXCLUSION_SQL}`;
  const candidateParams = [role.label];
  if (city) { candidateQuery += ` AND city = ?`; candidateParams.push(city); }
  if (audienceMode === 'available') {
    candidateQuery += ` AND campaign_status = 'none'`;
  } else if (audienceMode === 'not_this_template') {
    candidateQuery += ` AND phone NOT IN (
      SELECT m.phone FROM messages m
      JOIN campaigns camp ON camp.id = m.campaign_id
      WHERE camp.template_name = ? AND m.status != 'failed'
    )`;
    candidateParams.push(role.template_name);
  }
  // Safety cap: never queue more than 500 in one compose
  candidateQuery += ` ORDER BY has_personalization DESC, id ASC LIMIT 500`;

  const candidates = await db.prepare(candidateQuery).bind(...candidateParams).all();
  const rows = candidates.results || [];

  if (rows.length > 0) {
    const msgStmt = db.prepare(
      `INSERT INTO messages (campaign_id, phone, candidate_name, template_params, status)
       VALUES (?, ?, ?, ?, 'queued')`
    );
    const paramsJson = JSON.stringify([role.label, packageText, commission]);
    const batch = rows.map(c => msgStmt.bind(campaignId, c.phone, c.name || c.first_name || '', paramsJson));
    for (let i = 0; i < batch.length; i += 100) await db.batch(batch.slice(i, i + 100));

    await db.prepare(`UPDATE campaigns SET total_candidates = ? WHERE id = ?`).bind(rows.length, campaignId).run();
    await db.prepare(
      `UPDATE candidates SET campaign_status = 'queued', last_campaign_id = ? WHERE phone IN (${rows.map(()=>'?').join(',')})`
    ).bind(campaignId, ...rows.map(c => c.phone)).run();
  }

  return json({
    ok: true,
    campaign_id: campaignId,
    brand,
    role_key: roleKey,
    role_label: role.label,
    queued: rows.length,
    commission,
    package: packageText,
    poster_url: posterUrl,
    audience_mode: audienceMode,
    city: city,
  });
}

// POST ?action=send {campaign_id}
async function sendCampaign(db, body, env, request) {
  const campaignId = parseInt(body.campaign_id || 0, 10);
  if (!campaignId) return json({ error: 'campaign_id required' }, 400);

  const campaign = await db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(campaignId).first();
  if (!campaign) return json({ error: 'campaign not found' }, 404);

  // Respect safety cap: send in batches of 20, one call per request. App can poll.
  const base = new URL(request.url).origin;
  const resp = await fetch(`${base}/api/hiring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send_batch', campaign_id: campaignId, batch_size: 20 }),
  });
  const data = await resp.json().catch(() => ({ error: 'invalid upstream response' }));
  return json({ ...data, campaign_id: campaignId, brand: campaign.brand }, resp.status);
}

// POST ?action=reply {phone, text, brand?}
async function replyToCandidate(db, body, env, request) {
  const phone = normPhone(body.phone);
  const text = String(body.text || '').trim();
  if (!phone) return json({ error: 'phone required' }, 400);
  if (!text) return json({ error: 'text required' }, 400);

  const brand = body.brand || 'he';
  const base = new URL(request.url).origin;
  const resp = await fetch(`${base}/api/hiring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reply', phone, text, brand }),
  });
  const data = await resp.json().catch(() => ({ error: 'invalid upstream response' }));
  return json(data, resp.status);
}

// GET ?action=inbox&status=unread|all&scope=hiring
async function hiringInbox(db, url) {
  const status = url.searchParams.get('status') || 'all';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = 30;
  const offset = (page - 1) * limit;

  let query = `
    SELECT
      c.phone,
      c.candidate_name,
      c.campaign_id,
      c.body as last_message,
      c.direction as last_direction,
      c.created_at as last_message_at,
      c.msg_type,
      cam.name as campaign_name,
      cam.role as campaign_role,
      cam.brand as campaign_brand,
      (SELECT COUNT(*) FROM conversations c2 WHERE c2.phone = c.phone AND c2.status = 'unread' AND c2.direction = 'inbound') as unread_count,
      (SELECT COUNT(*) FROM conversations c3 WHERE c3.phone = c.phone) as total_messages
    FROM conversations c
    LEFT JOIN campaigns cam ON cam.id = c.campaign_id
    WHERE c.id = (
      SELECT MAX(c4.id) FROM conversations c4 WHERE c4.phone = c.phone
    )
    AND c.campaign_id IS NOT NULL AND cam.category = 'hiring'`;

  const params = [];
  if (status === 'unread') {
    query += ` AND (SELECT COUNT(*) FROM conversations c5 WHERE c5.phone = c.phone AND c5.status = 'unread' AND c5.direction = 'inbound') > 0`;
  }
  query += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const count = await db.prepare(
    `SELECT COUNT(DISTINCT c.phone) n FROM conversations c
     LEFT JOIN campaigns cam ON cam.id = c.campaign_id
     WHERE c.campaign_id IS NOT NULL AND cam.category = 'hiring'`
  ).first();

  return json({
    conversations: (rows.results || []).map(r => ({
      phone: r.phone,
      candidate_name: r.candidate_name || '',
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name || '',
      campaign_role: r.campaign_role || '',
      campaign_brand: r.campaign_brand || '',
      last_message: r.last_message || '',
      last_direction: r.last_direction,
      last_message_at: r.last_message_at,
      msg_type: r.msg_type,
      unread_count: r.unread_count || 0,
      total_messages: r.total_messages || 0,
    })),
    total: count?.n || 0,
    page,
    pages: Math.ceil((count?.n || 0) / limit),
  });
}

// GET ?action=campaign&id=
async function campaignOne(db, url) {
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return json({ error: 'id required' }, 400);
  const campaign = await db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(id).first();
  if (!campaign) return json({ error: 'not found' }, 404);
  const counts = await db.prepare(
    `SELECT
       COUNT(*) total,
       SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) sent,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) queued,
       SUM(has_reply) replies
     FROM messages WHERE campaign_id = ?`
  ).bind(id).first();
  return json({ campaign, counts });
}

// POST ?action=mark_outcome {campaign_id, role_key, outcome: joined|not_now|ignored|customer_noise}
async function markOutcome(db, body) {
  const campaignId = parseInt(body.campaign_id || 0, 10);
  const roleKey = String(body.role_key || '');
  const outcome = String(body.outcome || '');
  if (!campaignId || !roleKey || !outcome) return json({ error: 'campaign_id, role_key, outcome required' }, 400);

  const col = ['joined', 'not_now', 'ignored', 'customer_noise'].includes(outcome) ? outcome : null;
  if (!col) return json({ error: 'invalid outcome' }, 400);

  await db.prepare(
    `INSERT INTO campaign_outcomes (campaign_id, role_key, ${col}) VALUES (?, ?, 1)
     ON CONFLICT DO NOTHING`
  ).bind(campaignId, roleKey).run().catch(() => null);

  return json({ ok: true, campaign_id: campaignId, role_key: roleKey, outcome });
}

// ===========================================================================
// Facebook Group Posting surface (flow #3) — Darbar-facing wrapper around the
// same D1 tables used by the RTX executor in /api/fb-posting.
// ===========================================================================

async function fbOverview(db) {
  const creatives = await db.prepare(`SELECT COUNT(*) n FROM fb_creatives`).first();
  const groups = await db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(members_parsed),0) members FROM fb_groups WHERE status='active' AND is_blocked=0 AND status_join='Joined'`).first();
  const sessions = await db.prepare(`SELECT COUNT(*) n FROM fb_sessions`).first();
  const posts = await db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM fb_posts`).first();
  return json({
    creatives_count: creatives?.n || 0,
    eligible_groups: groups?.n || 0,
    total_members: groups?.members || 0,
    sessions_count: sessions?.n || 0,
    posts_total: posts?.n || 0,
    posts_success: posts?.success || 0,
    posts_failed: posts?.failed || 0,
  });
}

async function fbCreatives(db) {
  const rows = await db.prepare(`SELECT * FROM fb_creatives ORDER BY id DESC`).all();
  return json(rows.results || []);
}

async function fbSessions(db, url) {
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const rows = await db.prepare(`
    SELECT s.*, c.name as creative_name, c.image_filename
    FROM fb_sessions s JOIN fb_creatives c ON s.creative_id = c.id
    ORDER BY s.id DESC LIMIT ?
  `).bind(limit).all();
  return json(rows.results || []);
}

async function fbPosts(db, url) {
  const sessionId = parseInt(url.searchParams.get('session_id') || '0', 10);
  if (!sessionId) return json({ error: 'session_id required' }, 400);
  const rows = await db.prepare(`
    SELECT p.*, g.name as group_name, g.group_url
    FROM fb_posts p JOIN fb_groups g ON p.group_id = g.id
    WHERE p.session_id = ? ORDER BY p.id DESC
  `).bind(sessionId).all();
  return json(rows.results || []);
}

// Internal call to /api/fb-posting using the service key.
async function fbInternal(env, request, body) {
  const base = new URL(request.url).origin;
  const resp = await fetch(`${base}/api/fb-posting`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-key': env.CAMS_AUTH_TOKEN || '',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({ ok: false, error: 'invalid upstream response' }));
  return { data, status: resp.status };
}

// GET ?action=fb_preview&creative_id=X&daily_cap=35&cooldown_days=7&location=Bangalore
async function fbPreview(db, url, env, request) {
  const creativeId = parseInt(url.searchParams.get('creative_id') || '0', 10);
  if (!creativeId) return json({ error: 'creative_id required' }, 400);
  const dailyCap = parseInt(url.searchParams.get('daily_cap') || '35', 10);
  const cooldownDays = parseInt(url.searchParams.get('cooldown_days') || '7', 10);
  const location = url.searchParams.get('location') || 'Bangalore';
  const { data, status } = await fbInternal(env, request, {
    action: 'select_groups',
    creative_id: creativeId,
    daily_cap: dailyCap,
    cooldown_days: cooldownDays,
    location,
  });
  return json(data, status);
}

// POST ?action=fb_compose {creative_id, brand, daily_cap?, cooldown_days?, location?}
async function fbCompose(db, body, env, request) {
  const creativeId = parseInt(body.creative_id || 0, 10);
  if (!creativeId) return json({ error: 'creative_id required' }, 400);
  const { data, status } = await fbInternal(env, request, {
    action: 'create_session',
    creative_id: creativeId,
    account_name: String(body.brand || 'he').toUpperCase(),
    use_intelligence: true,
    daily_cap: body.daily_cap || 35,
    cooldown_days: body.cooldown_days || 7,
    location: body.location || 'Bangalore',
  });
  return json(data, status);
}

async function fbPause(db, body, env, request) {
  const sessionId = parseInt(body.session_id || 0, 10);
  if (!sessionId) return json({ error: 'session_id required' }, 400);
  const { data, status } = await fbInternal(env, request, { action: 'pause_session', session_id: sessionId });
  return json(data, status);
}

async function fbResume(db, body, env, request) {
  const sessionId = parseInt(body.session_id || 0, 10);
  if (!sessionId) return json({ error: 'session_id required' }, 400);
  const { data, status } = await fbInternal(env, request, { action: 'resume_session', session_id: sessionId });
  return json(data, status);
}
