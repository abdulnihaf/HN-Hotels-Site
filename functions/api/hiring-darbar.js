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
