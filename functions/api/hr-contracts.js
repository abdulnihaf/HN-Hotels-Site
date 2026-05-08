// /api/hr-contracts — Employment contract lifecycle (review → edit → send via Leegality)
//
// Single source of truth model:
//   Drive holds the PDF. D1 holds its SHA-256 fingerprint.
//   Every send re-hashes the live Drive file and refuses to fire if hash drifts
//   from what D1 last recorded — guarantees "what you saw == what was sent".
//
// Endpoints (all under /api/hr-contracts?action=…, x-dashboard-key auth):
//
//   Bootstrap:
//     POST  set-contract-drive-ids   { rows: [{employee_id, drive_file_id, drive_file_name?, sha256?, size?}] }
//                                    Bulk-link the existing 31 PDFs as v1.
//
//   Per-employee read:
//     GET   get-contract-data        ?employee_id=N
//                                    Returns current editable fields + version + integrity state + recent edits.
//     GET   contract-history         ?employee_id=N
//                                    Full version + edit history.
//
//   Edit:
//     POST  update-contract-data     { employee_id, fields: {...}, edited_by? }
//                                    Saves edits to hr_employees + writes an edit-log row per changed field.
//                                    Sets contract_dirty=1 (next regen will materialise these into a new PDF).
//
//   Regenerate (called by the local regen script after rebuilding the PDF):
//     POST  finalize-regeneration    { employee_id, drive_file_id, drive_file_name, sha256, size_bytes,
//                                       generated_from, generated_by? }
//                                    Creates a new hr_contract_versions row, advances contract_drive_id +
//                                    contract_pdf_sha256, clears contract_dirty, marks edit-log entries applied.
//
//   Integrity:
//     POST  verify-integrity         { employee_id, live_sha256 }
//                                    Compares live Drive hash to D1; returns ok/drift.
//
//   Leegality send:
//     POST  send-leegality           { employee_id, live_sha256, leegality_doc_id, leegality_url }
//                                    Confirms hash match before flipping status to 'sent_leegality'.
//                                    The actual Leegality API call is made by the local sender script
//                                    OR a future CF-side wrapper — this endpoint records the result.
//
//   Leegality cleanup:
//     POST  leegality-inventory      { docs: [{leegality_doc_id, doc_name, status, created_at}] }
//                                    Records the current Leegality doc list. Marks orphans (no matching D1 row).
//     GET   leegality-orphans        Lists docs marked as orphans in the latest inventory.
//     POST  leegality-mark-action    { ids: [...], action: 'kept'|'wiped' }
//                                    Records what the cleanup script did for each doc.
//
// All state changes log to hr_contract_edits (where appropriate) for audit.

'use strict';

import { driveDownload, driveGetMetadata, sha256Hex } from './_lib/drive-server.js';
import { leegalityCreateDocument, leegalityListDocuments, leegalityDeleteDocument } from './_lib/leegality.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function authOk(request, env, body) {
  const key = request.headers.get('x-dashboard-key') || body?.dashboard_key;
  return key && key === env.DASHBOARD_KEY;
}

// Editable per-employee fields. Anything outside this list is FROZEN
// (Service Rules boilerplate, Form 11, statutory text, HN letterhead).
const EDITABLE_FIELDS = new Set([
  'name',
  'known_as',
  'job_name',
  'brand_label',
  'pay_type',
  'monthly_salary',
  'daily_rate',
  'aadhaar_last4',
  'aadhaar_full',
  'dob',
  'phone',
  'start_date',
  'contract_effective_date',
  'contract_special_clauses',
]);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const method = request.method;
  const db = env.DB;

  let body = {};
  if (method === 'POST') {
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  }
  if (!authOk(request, env, body)) return json({ error: 'unauthorized' }, 401);

  // ─── Bootstrap: link existing 31 PDFs as v1 ────────────────────────────
  if (action === 'set-contract-drive-ids' && method === 'POST') {
    const { rows = [], generated_by = 'bootstrap_v1' } = body;
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'rows[] required' }, 400);
    const now = new Date().toISOString();
    const results = [];

    for (const r of rows) {
      const { employee_id, drive_file_id, drive_file_name = null, sha256 = null, size_bytes = null } = r;
      if (!employee_id || !drive_file_id) {
        results.push({ employee_id, ok: false, error: 'employee_id + drive_file_id required' });
        continue;
      }

      try {
        // Capture a snapshot of the current employee data as v1's "generated_from"
        const emp = await db.prepare(
          `SELECT id, name, known_as, job_name, brand_label, pay_type, monthly_salary,
                  daily_rate, aadhaar_last4, aadhaar_full, dob, phone, start_date,
                  contract_effective_date, contract_special_clauses
             FROM hr_employees WHERE id = ?`
        ).bind(employee_id).first();
        if (!emp) {
          results.push({ employee_id, ok: false, error: 'employee not found' });
          continue;
        }

        // Insert version row (v1) — INSERT OR IGNORE so re-running this is idempotent
        await db.prepare(`
          INSERT OR IGNORE INTO hr_contract_versions
            (employee_id, version_no, drive_file_id, drive_file_name, pdf_sha256, pdf_size_bytes,
             generated_from, generated_at, generated_by, status)
          VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'generated')
        `).bind(
          employee_id, drive_file_id, drive_file_name, sha256, size_bytes,
          JSON.stringify(emp), now, generated_by,
        ).run();

        // Update hr_employees pointers
        await db.prepare(`
          UPDATE hr_employees
             SET contract_drive_id = ?,
                 contract_uploaded_at = ?,
                 contract_status = COALESCE(NULLIF(contract_status, 'not_uploaded'), 'pending_review'),
                 contract_pdf_sha256 = COALESCE(?, contract_pdf_sha256),
                 contract_version = MAX(COALESCE(contract_version, 0), 1),
                 contract_dirty = 0,
                 contract_last_regenerated_at = ?
           WHERE id = ?
        `).bind(drive_file_id, now, sha256, now, employee_id).run();

        results.push({ employee_id, ok: true, drive_file_id });
      } catch (e) {
        results.push({ employee_id, ok: false, error: e.message });
      }
    }

    const ok = results.filter(r => r.ok).length;
    return json({ ok: results.every(r => r.ok), updated: ok, total: results.length, results });
  }

  // ─── Read: per-employee contract data + state ──────────────────────────
  if (action === 'get-contract-data' && method === 'GET') {
    const employeeId = url.searchParams.get('employee_id');
    if (!employeeId) return json({ error: 'employee_id required' }, 400);

    const emp = await db.prepare(`
      SELECT id, pin, name, known_as, job_name, brand_label, pay_type,
             monthly_salary, daily_rate, aadhaar_last4, aadhaar_full, dob, phone,
             start_date, contract_effective_date, contract_special_clauses,
             contract_drive_id, contract_uploaded_at, contract_status,
             contract_pdf_sha256, contract_version, contract_dirty, contract_last_regenerated_at,
             leegality_doc_id, leegality_sent_at, leegality_signed_at, leegality_signed_pdf_id,
             is_active
        FROM hr_employees WHERE id = ?
    `).bind(employeeId).first();
    if (!emp) return json({ error: 'employee not found' }, 404);

    // Latest 10 edits (unapplied + applied)
    const editsRs = await db.prepare(`
      SELECT id, version_no, field_name, old_value, new_value, edited_by, edited_at, applied_at
        FROM hr_contract_edits
       WHERE employee_id = ?
       ORDER BY id DESC LIMIT 10
    `).bind(employeeId).all();

    // Versions list
    const versionsRs = await db.prepare(`
      SELECT version_no, drive_file_id, drive_file_name, pdf_sha256, pdf_size_bytes,
             generated_at, generated_by, status, superseded_at
        FROM hr_contract_versions
       WHERE employee_id = ?
       ORDER BY version_no DESC
    `).bind(employeeId).all();

    // Compute auto-derived display values
    const monthly = Number(emp.monthly_salary || 0);
    const retention_quarterly = Math.round(monthly * 0.15);
    const monthly_base = monthly - retention_quarterly;

    return json({
      employee: emp,
      derived: {
        retention_quarterly,
        monthly_base,
        retention_split_label: `${monthly_base}/month + ${retention_quarterly}/quarter (85/15)`,
      },
      drive_view_url: emp.contract_drive_id
        ? `https://drive.google.com/file/d/${emp.contract_drive_id}/view`
        : null,
      versions: versionsRs.results || [],
      recent_edits: editsRs.results || [],
      editable_fields: Array.from(EDITABLE_FIELDS),
      can_send_leegality: !!(emp.contract_drive_id && emp.contract_pdf_sha256 && !emp.contract_dirty
                              && (emp.contract_status === 'pending_review' || emp.contract_status === 'approved')),
      blockers: buildBlockers(emp),
    });
  }

  // ─── Edit: save fields + write audit log ───────────────────────────────
  if (action === 'update-contract-data' && method === 'POST') {
    const { employee_id, fields = {}, edited_by = null } = body;
    if (!employee_id) return json({ error: 'employee_id required' }, 400);

    const emp = await db.prepare(`SELECT * FROM hr_employees WHERE id = ?`).bind(employee_id).first();
    if (!emp) return json({ error: 'employee not found' }, 404);

    const sets = []; const binds = []; const editsLogged = [];
    const nextVersion = (emp.contract_version || 0) + 1;
    const now = new Date().toISOString();

    for (const [field, newRaw] of Object.entries(fields)) {
      if (!EDITABLE_FIELDS.has(field)) {
        return json({ error: `field '${field}' is not editable per-employee`, editable: Array.from(EDITABLE_FIELDS) }, 400);
      }
      const oldVal = emp[field];
      const newVal = newRaw === '' ? null : newRaw;
      // Skip no-ops
      if (String(oldVal ?? '') === String(newVal ?? '')) continue;
      sets.push(`${field} = ?`);
      binds.push(newVal);
      editsLogged.push({ field, old: oldVal, new: newVal });
    }

    if (!sets.length) return json({ ok: true, no_changes: true });

    // Update hr_employees + flip dirty flag
    sets.push('contract_dirty = 1');
    binds.push(employee_id);
    await db.prepare(`UPDATE hr_employees SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    // Write audit log row per field
    for (const e of editsLogged) {
      await db.prepare(`
        INSERT INTO hr_contract_edits
          (employee_id, version_no, field_name, old_value, new_value, edited_by, edited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        employee_id, nextVersion, e.field, String(e.old ?? ''), String(e.new ?? ''),
        edited_by, now,
      ).run();
    }

    return json({
      ok: true,
      employee_id,
      next_version: nextVersion,
      changes: editsLogged.length,
      edits_logged: editsLogged,
      dirty: true,
      next_step: 'Run the regeneration script locally to materialise these edits into a new PDF, then call finalize-regeneration.',
    });
  }

  // ─── Finalize regeneration: called by local script after rebuilding PDF ─
  if (action === 'finalize-regeneration' && method === 'POST') {
    const {
      employee_id, drive_file_id, drive_file_name, sha256, size_bytes,
      generated_from = null, generated_by = 'regen_script',
    } = body;
    if (!employee_id || !drive_file_id || !sha256) {
      return json({ error: 'employee_id, drive_file_id, sha256 required' }, 400);
    }

    const emp = await db.prepare(`SELECT * FROM hr_employees WHERE id = ?`).bind(employee_id).first();
    if (!emp) return json({ error: 'employee not found' }, 404);

    const newVersion = (emp.contract_version || 0) + 1;
    const now = new Date().toISOString();

    // Mark previous version as superseded
    if (emp.contract_drive_id) {
      await db.prepare(`
        UPDATE hr_contract_versions
           SET superseded_at = ?, status = CASE WHEN status = 'sent_leegality' THEN 'sent_leegality' ELSE 'superseded' END
         WHERE employee_id = ? AND drive_file_id = ?
      `).bind(now, employee_id, emp.contract_drive_id).run();
    }

    // Insert new version row
    await db.prepare(`
      INSERT INTO hr_contract_versions
        (employee_id, version_no, drive_file_id, drive_file_name, pdf_sha256, pdf_size_bytes,
         generated_from, generated_at, generated_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')
    `).bind(
      employee_id, newVersion, drive_file_id, drive_file_name, sha256, size_bytes,
      generated_from ? JSON.stringify(generated_from) : null, now, generated_by,
    ).run();

    // Advance pointers
    await db.prepare(`
      UPDATE hr_employees
         SET contract_drive_id = ?,
             contract_uploaded_at = ?,
             contract_pdf_sha256 = ?,
             contract_version = ?,
             contract_dirty = 0,
             contract_last_regenerated_at = ?,
             contract_status = 'pending_review'
       WHERE id = ?
    `).bind(drive_file_id, now, sha256, newVersion, now, employee_id).run();

    // Mark all unapplied edits for this version as applied
    await db.prepare(`
      UPDATE hr_contract_edits
         SET applied_at = ?
       WHERE employee_id = ? AND version_no = ? AND applied_at IS NULL
    `).bind(now, employee_id, newVersion).run();

    return json({ ok: true, employee_id, version_no: newVersion, drive_file_id, sha256 });
  }

  // ─── Integrity check ───────────────────────────────────────────────────
  if (action === 'verify-integrity' && method === 'POST') {
    const { employee_id, live_sha256 } = body;
    if (!employee_id || !live_sha256) return json({ error: 'employee_id + live_sha256 required' }, 400);
    const emp = await db.prepare(
      `SELECT contract_drive_id, contract_pdf_sha256, contract_version, contract_dirty FROM hr_employees WHERE id = ?`
    ).bind(employee_id).first();
    if (!emp) return json({ error: 'employee not found' }, 404);
    const match = (emp.contract_pdf_sha256 || '').toLowerCase() === String(live_sha256).toLowerCase();
    return json({
      ok: match,
      drift: !match,
      stored_sha256: emp.contract_pdf_sha256,
      live_sha256,
      contract_dirty: !!emp.contract_dirty,
      contract_version: emp.contract_version,
    });
  }

  // ─── Send via Leegality (REAL server-side flow) ────────────────────────
  // Pulls PDF from Drive → integrity-checks hash → posts to Leegality →
  // captures docId + signing URL → updates D1.
  if (action === 'send-leegality' && method === 'POST') {
    const { employee_id, sent_by = null, dry_run = false } = body;
    if (!employee_id) return json({ error: 'employee_id required' }, 400);

    const emp = await db.prepare(`SELECT * FROM hr_employees WHERE id = ?`).bind(employee_id).first();
    if (!emp) return json({ error: 'employee not found' }, 404);
    if (emp.contract_dirty) return json({ error: 'contract has unapplied edits — regenerate first' }, 409);
    if (!emp.contract_drive_id) return json({ error: 'no contract Drive file on record' }, 409);
    if (emp.leegality_doc_id) return json({ error: `already sent (Leegality doc ${emp.leegality_doc_id})` }, 409);
    if (!emp.phone) return json({ error: 'employee phone required for Aadhaar OTP eSign' }, 409);

    // 1. Download PDF from Drive
    const dl = await driveDownload(env, emp.contract_drive_id);
    if (!dl.ok) return json({ error: 'Drive download failed', detail: dl }, 502);

    // 2. Verify hash matches D1
    const liveHash = await sha256Hex(dl.bytes);
    if (emp.contract_pdf_sha256 && liveHash.toLowerCase() !== emp.contract_pdf_sha256.toLowerCase()) {
      return json({
        error: 'integrity drift — Drive PDF hash differs from D1; refusing to send',
        stored_sha256: emp.contract_pdf_sha256,
        live_sha256: liveHash,
      }, 409);
    }

    if (dry_run) {
      return json({
        ok: true,
        dry_run: true,
        would_send: {
          employee_id,
          name: emp.name,
          phone: emp.phone,
          drive_file_id: emp.contract_drive_id,
          live_sha256: liveHash,
          size_bytes: dl.size,
        },
      });
    }

    // 3. Build signers (currently single-sign: employee with Aadhaar OTP).
    //    MD signature image is pre-embedded on the PDF (when regenerator runs).
    const documentName = `${(emp.known_as || emp.name).replace(/[^A-Za-z0-9]/g, '_')}_contract_v${emp.contract_version || 1}.pdf`;
    const signers = [
      {
        name: emp.name,
        mobile: emp.phone,
        email: emp.email || null,
        signType: 'AADHAAR_OTP',
        order: 1,
        label: 'employee',
      },
    ];

    // 4. POST to Leegality
    const lg = await leegalityCreateDocument(env, {
      pdfBytes: dl.bytes,
      documentName,
      signers,
      referenceId: `hr_contract:${employee_id}:v${emp.contract_version || 1}`,
    });

    if (!lg.ok) {
      // Surface the full error so we can iterate on the API shape
      return json({
        error: 'Leegality send failed',
        detail: lg.error,
        status: lg.status,
        response: lg.response,
        hint: 'Check LEEGALITY_WORKFLOW_ID is set + workflowId field name + LEEGALITY_USE_HMAC',
      }, 502);
    }

    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE hr_employees
         SET leegality_doc_id = ?,
             leegality_sent_at = ?,
             contract_status = 'sent_leegality'
       WHERE id = ?
    `).bind(lg.documentId, now, employee_id).run();

    await db.prepare(`
      UPDATE hr_contract_versions
         SET status = 'sent_leegality'
       WHERE employee_id = ? AND drive_file_id = ?
    `).bind(employee_id, emp.contract_drive_id).run();

    await db.prepare(`
      INSERT INTO leegality_doc_inventory (leegality_doc_id, matched_employee_id, action_taken, action_at)
      VALUES (?, ?, 'kept', ?)
    `).bind(lg.documentId, employee_id, now).run().catch(() => {});

    return json({
      ok: true,
      employee_id,
      leegality_doc_id: lg.documentId,
      signing_url: lg.signingUrl,
      sent_at: now,
      live_sha256: liveHash,
      raw_response: lg.response,
    });
  }

  // ─── Leegality inventory snapshot (called by cleanup script) ───────────
  if (action === 'leegality-inventory' && method === 'POST') {
    const { docs = [], replace = true } = body;
    if (!Array.isArray(docs)) return json({ error: 'docs[] required' }, 400);

    if (replace) {
      // Clear previous unactioned inventory
      await db.prepare(`DELETE FROM leegality_doc_inventory WHERE action_taken IS NULL`).run();
    }

    let orphans = 0; let matched = 0;
    for (const d of docs) {
      const matchedRow = await db.prepare(
        `SELECT id FROM hr_employees WHERE leegality_doc_id = ? LIMIT 1`
      ).bind(d.leegality_doc_id).first();
      const empId = matchedRow?.id || null;
      if (empId) matched++; else orphans++;
      await db.prepare(`
        INSERT INTO leegality_doc_inventory
          (leegality_doc_id, doc_name, status, created_at_leegality, matched_employee_id)
        VALUES (?, ?, ?, ?, ?)
      `).bind(d.leegality_doc_id, d.doc_name || null, d.status || null, d.created_at || null, empId).run();
    }

    return json({ ok: true, total: docs.length, matched, orphans });
  }

  // ─── Leegality orphans + actions ───────────────────────────────────────
  if (action === 'leegality-orphans' && method === 'GET') {
    const rs = await db.prepare(`
      SELECT id, leegality_doc_id, doc_name, status, created_at_leegality, inventory_taken_at
        FROM leegality_doc_inventory
       WHERE matched_employee_id IS NULL AND action_taken IS NULL
       ORDER BY id DESC
    `).all();
    return json({ orphans: rs.results || [] });
  }

  if (action === 'leegality-mark-action' && method === 'POST') {
    const { ids = [], action: act } = body;
    if (!Array.isArray(ids) || !ids.length || !['kept', 'wiped'].includes(act)) {
      return json({ error: 'ids[] + action (kept|wiped) required' }, 400);
    }
    const placeholders = ids.map(() => '?').join(',');
    const r = await db.prepare(`
      UPDATE leegality_doc_inventory
         SET action_taken = ?, action_at = datetime('now')
       WHERE id IN (${placeholders})
    `).bind(act, ...ids).run();
    return json({ ok: true, updated: r.meta?.changes || 0 });
  }

  // ─── Contract history (full) ───────────────────────────────────────────
  if (action === 'contract-history' && method === 'GET') {
    const employeeId = url.searchParams.get('employee_id');
    if (!employeeId) return json({ error: 'employee_id required' }, 400);
    const versions = await db.prepare(`
      SELECT * FROM hr_contract_versions WHERE employee_id = ? ORDER BY version_no DESC
    `).bind(employeeId).all();
    const edits = await db.prepare(`
      SELECT * FROM hr_contract_edits WHERE employee_id = ? ORDER BY id DESC LIMIT 200
    `).bind(employeeId).all();
    return json({ versions: versions.results || [], edits: edits.results || [] });
  }

  // ─── List all employees with their contract status (for the Roster fetch) ─
  if (action === 'list-with-status' && method === 'GET') {
    const rs = await db.prepare(`
      SELECT id, pin, name, known_as, brand_label, pay_type, is_active,
             contract_drive_id, contract_status, contract_version, contract_dirty,
             contract_last_regenerated_at, contract_pdf_sha256,
             leegality_doc_id, leegality_sent_at, leegality_signed_at
        FROM hr_employees
       WHERE is_active = 1
       ORDER BY brand_label, name
    `).all();
    return json({ rows: rs.results || [] });
  }

  // ─── Pending regenerations (for the local script to know what to rebuild) ─
  if (action === 'pending-regenerations' && method === 'GET') {
    const rs = await db.prepare(`
      SELECT e.id, e.pin, e.name, e.known_as, e.job_name, e.brand_label, e.pay_type,
             e.monthly_salary, e.daily_rate, e.aadhaar_last4, e.aadhaar_full, e.dob,
             e.phone, e.start_date, e.contract_effective_date, e.contract_special_clauses,
             e.contract_version, e.contract_drive_id,
             (SELECT COUNT(*) FROM hr_contract_edits ce
                WHERE ce.employee_id = e.id AND ce.applied_at IS NULL) AS pending_edits
        FROM hr_employees e
       WHERE e.contract_dirty = 1 AND e.is_active = 1
       ORDER BY e.brand_label, e.name
    `).all();
    return json({ pending: rs.results || [] });
  }

  return json({
    error: 'Unknown action',
    valid: [
      'set-contract-drive-ids', 'get-contract-data', 'update-contract-data',
      'finalize-regeneration', 'verify-integrity', 'send-leegality',
      'leegality-inventory', 'leegality-orphans', 'leegality-mark-action',
      'contract-history', 'list-with-status', 'pending-regenerations',
    ],
  }, 400);
}

function buildBlockers(emp) {
  const b = [];
  if (!emp.contract_drive_id) b.push('No contract PDF uploaded yet');
  if (emp.contract_dirty) b.push('Edits saved but not yet regenerated — run regen script');
  if (!emp.contract_pdf_sha256) b.push('PDF hash missing — re-link contract to capture it');
  if (emp.contract_status === 'sent_leegality') b.push('Already sent to Leegality');
  if (emp.contract_status === 'signed') b.push('Already signed');
  return b;
}
