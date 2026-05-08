// /api/leegality-webhook
// Receives Leegality status callbacks (signed, declined, expired, etc.) and
// updates hr_employees + hr_contract_versions accordingly.
//
// Configure callback URL in Leegality dashboard OR pass it on each document:
//   https://hnhotels.in/api/leegality-webhook
//
// Auth: HMAC verification of body using LEEGALITY_PRIVATE_SALT.
// Leegality typically posts a signature in X-Signature header — we verify
// it matches HMAC-SHA256(salt, raw_body). Mismatch = reject.
//
// Webhook body fields vary by Leegality account tier; we accept any of these:
//   - documentId / id / document_id    → which doc
//   - status                           → 'signed' | 'declined' | 'expired' | 'pending' | 'partial'
//   - referenceId / reference_id       → our 'hr_contract:<emp_id>:vN' tag
//   - signedFileUrl / signed_url       → URL to download the signed PDF
//   - signers[].status                 → per-signer status

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function hmacSha256Hex(key, body) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function pickFirst(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  const rawBody = await request.text();
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'invalid JSON' }, 400); }

  // Verify HMAC signature if salt is configured (default ON)
  const verifyEnabled = env.LEEGALITY_PRIVATE_SALT && env.LEEGALITY_USE_HMAC !== 'false';
  if (verifyEnabled) {
    const provided = request.headers.get('x-signature') || request.headers.get('X-Signature') || '';
    const expected = await hmacSha256Hex(env.LEEGALITY_PRIVATE_SALT, rawBody);
    if (!provided || provided.toLowerCase() !== expected.toLowerCase()) {
      console.error('leegality webhook signature mismatch', { provided: provided.slice(0,16), expected: expected.slice(0,16) });
      return json({ error: 'signature mismatch' }, 401);
    }
  }

  const documentId = pickFirst(payload, 'documentId', 'document_id', 'id', 'docId');
  const status = String(pickFirst(payload, 'status', 'documentStatus') || '').toLowerCase();
  const referenceId = pickFirst(payload, 'referenceId', 'reference_id', 'ref', 'externalId');
  const signedFileUrl = pickFirst(payload, 'signedFileUrl', 'signed_url', 'signedUrl', 'finalDocumentUrl');

  if (!documentId) return json({ error: 'documentId missing in payload', payload }, 400);

  // Find the matching employee (by leegality_doc_id; fallback to referenceId)
  let emp = await env.DB.prepare(
    `SELECT * FROM hr_employees WHERE leegality_doc_id = ? LIMIT 1`
  ).bind(documentId).first();

  if (!emp && referenceId) {
    // referenceId = 'hr_contract:<emp_id>:vN'
    const m = String(referenceId).match(/^hr_contract:(\d+)/);
    if (m) {
      emp = await env.DB.prepare(`SELECT * FROM hr_employees WHERE id = ?`).bind(m[1]).first();
    }
  }

  if (!emp) {
    return json({ error: 'no matching employee for document', documentId, referenceId }, 404);
  }

  const now = new Date().toISOString();

  // Map Leegality status → hr_employees.contract_status
  let newContractStatus;
  let signedAt = null;
  if (status === 'signed' || status === 'completed') {
    newContractStatus = 'signed';
    signedAt = now;
  } else if (status === 'declined' || status === 'rejected') {
    newContractStatus = 'declined';
  } else if (status === 'expired') {
    newContractStatus = 'declined';
  } else if (status === 'partial' || status === 'pending') {
    newContractStatus = 'sent_leegality'; // unchanged; one signer done
  } else {
    // unknown — log but don't change
    return json({ ok: true, ignored: status, employee_id: emp.id });
  }

  await env.DB.prepare(`
    UPDATE hr_employees
       SET contract_status = ?,
           leegality_signed_at = COALESCE(?, leegality_signed_at)
     WHERE id = ?
  `).bind(newContractStatus, signedAt, emp.id).run();

  // Update version row
  await env.DB.prepare(`
    UPDATE hr_contract_versions
       SET status = ?
     WHERE employee_id = ? AND drive_file_id = ?
  `).bind(newContractStatus, emp.id, emp.contract_drive_id).run();

  // If signed PDF URL is provided, download + push to Drive (replaces existing version)
  let signedDriveId = null;
  if (newContractStatus === 'signed' && signedFileUrl) {
    try {
      const { driveUpload } = await import('./_lib/drive-server.js');
      const dl = await fetch(signedFileUrl);
      if (dl.ok) {
        const bytes = await dl.arrayBuffer();
        // Find the per-employee Drive folder (parent of the original contract file)
        const { driveGetMetadata } = await import('./_lib/drive-server.js');
        const meta = await driveGetMetadata(env, emp.contract_drive_id, 'parents');
        const parent = meta?.file?.parents?.[0];
        if (parent) {
          const safeName = (emp.known_as || emp.name).replace(/[^A-Za-z0-9]/g, '_');
          const filename = `${safeName}_signed_v${emp.contract_version || 1}.pdf`;
          const up = await driveUpload(env, { parentId: parent, name: filename, bytes, mimeType: 'application/pdf' });
          if (up.ok) {
            signedDriveId = up.fileId;
            await env.DB.prepare(`
              UPDATE hr_employees SET leegality_signed_pdf_id = ? WHERE id = ?
            `).bind(signedDriveId, emp.id).run();
          }
        }
      }
    } catch (e) {
      console.error('signed PDF download/upload failed:', e?.message || e);
    }
  }

  // Log inbound webhook for audit
  try {
    await env.DB.prepare(`
      INSERT INTO comms_outbox
        (alert_id, tier, brand, channel, recipient_phone, body_text, status, sent_at)
      VALUES (?, 'info', 'leegality', 'webhook', ?, ?, 'received', ?)
    `).bind(
      `leegality:${documentId}`,
      emp.phone || '',
      `Leegality ${status} → ${newContractStatus}${signedDriveId ? ` (signed PDF saved: ${signedDriveId})` : ''}`,
      now,
    ).run();
  } catch {}

  return json({
    ok: true,
    employee_id: emp.id,
    name: emp.name,
    new_status: newContractStatus,
    signed_drive_id: signedDriveId,
  });
}
