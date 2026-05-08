#!/usr/bin/env node
/**
 * contracts-send-leegality.mjs — Send a single employee's current contract via Leegality eSign.
 *
 * Workflow:
 *   1. Fetch employee + current contract_drive_id + stored contract_pdf_sha256
 *   2. Download PDF from Drive, recompute SHA-256
 *   3. Compare to stored — abort if drift
 *   4. POST PDF to Leegality API (signers + workflow)
 *   5. Capture leegality_doc_id + signing URL
 *   6. POST back to /api/hr-contracts?action=send-leegality with the result
 *
 * Usage:
 *   node scripts/contracts-send-leegality.mjs --employee-id 12
 *
 * Required env vars:
 *   DASHBOARD_KEY                — for HN API auth
 *   LEEGALITY_API_BASE           — e.g. https://api.leegality.com
 *   LEEGALITY_API_KEY            — your account key
 *   LEEGALITY_DEFAULT_PROFILE    — your account profile id (set in Leegality dashboard)
 *
 * IMPORTANT — Leegality API call is a TODO STUB. Confirm exact endpoint shape
 * + signer payload from your Leegality account docs before going live.
 */

import { createHash } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const API_BASE = args.api || 'https://hnhotels.in';
const EMP_ID = Number(args['employee-id']);
const DASHBOARD_KEY = process.env.DASHBOARD_KEY;
const LEEGALITY_API_BASE = process.env.LEEGALITY_API_BASE;
const LEEGALITY_API_KEY = process.env.LEEGALITY_API_KEY;
const LEEGALITY_PROFILE = process.env.LEEGALITY_DEFAULT_PROFILE;

if (!EMP_ID) { console.error('Pass --employee-id=N'); process.exit(1); }
if (!DASHBOARD_KEY || !LEEGALITY_API_BASE || !LEEGALITY_API_KEY) {
  console.error('Missing required env vars'); process.exit(1);
}

// ─── 1. Fetch employee contract data ─────────────────────────────────────────
const r = await fetch(`${API_BASE}/api/hr-contracts?action=get-contract-data&employee_id=${EMP_ID}`, {
  headers: { 'x-dashboard-key': DASHBOARD_KEY }
});
const data = await r.json();
if (!r.ok) { console.error('Fetch failed:', data); process.exit(1); }

const e = data.employee;
if (e.contract_dirty) { console.error('Contract has unapplied edits. Run regenerate first.'); process.exit(1); }
if (!e.contract_drive_id || !e.contract_pdf_sha256) { console.error('No contract on file.'); process.exit(1); }
if (e.leegality_doc_id) { console.error(`Already sent (Leegality doc: ${e.leegality_doc_id}).`); process.exit(1); }

// ─── 2. Download PDF + verify hash ──────────────────────────────────────────
const { google } = await import('googleapis');
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const drive = google.drive({ version: 'v3', auth });
const dl = await drive.files.get({ fileId: e.contract_drive_id, alt: 'media' }, { responseType: 'arraybuffer' });
const pdfBuffer = Buffer.from(dl.data);
const liveHash = createHash('sha256').update(pdfBuffer).digest('hex');

if (liveHash.toLowerCase() !== e.contract_pdf_sha256.toLowerCase()) {
  console.error(`❌ INTEGRITY DRIFT — Drive file hash ≠ D1 stored hash.`);
  console.error(`   Drive: ${liveHash}`);
  console.error(`   D1:    ${e.contract_pdf_sha256}`);
  console.error(`   Refusing to send. Run regenerate to re-sync.`);
  process.exit(1);
}
console.log(`✅ Hash verified: ${liveHash.slice(0,12)}…`);

// ─── 3. Send to Leegality (TODO: confirm exact API shape) ────────────────────
//
// Typical Leegality flow (per their documented API):
//   POST {LEEGALITY_API_BASE}/v1/documents
//     body: { profileId, files: [{ name, content (base64) }], signers: [...] }
//   Response: { documentId, signingUrl }
//
// Signers payload (Aadhaar OTP eSign for blue-collar staff):
//   { name, email?, mobile, signType: 'AADHAAR_OTP', order: 1 }

console.log(`🚀 Submitting to Leegality…`);
const filename = `${(e.known_as || e.name).replace(/[^A-Za-z0-9]/g, '_')}_v${e.contract_version}.pdf`;

const lgPayload = {
  profileId: LEEGALITY_PROFILE,
  files: [{ name: filename, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }],
  signers: [
    {
      name: e.name,
      mobile: e.phone,                       // 10-digit
      signType: 'AADHAAR_OTP',
      order: 1,
      signaturePages: [-1],                  // last page; adjust if signature block is elsewhere
    },
  ],
  // Add company signer (Nihaf) here if dual-sign required:
  // { name: 'Abdul Nihaf', mobile: '9945470320', email: 'nihafwork@gmail.com', signType: 'AADHAAR_OTP', order: 2 }
};

const lgRes = await fetch(`${LEEGALITY_API_BASE}/v1/documents`, {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${LEEGALITY_API_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(lgPayload),
});
const lgData = await lgRes.json();
if (!lgRes.ok) { console.error('Leegality send failed:', lgData); process.exit(1); }

const leegality_doc_id = lgData.documentId || lgData.id;
const leegality_url = lgData.signingUrl || lgData.url;
console.log(`✅ Leegality doc created: ${leegality_doc_id}`);
console.log(`   Signing URL: ${leegality_url}`);

// ─── 4. Record back to D1 ────────────────────────────────────────────────────
const recRes = await fetch(`${API_BASE}/api/hr-contracts?action=send-leegality`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dashboard-key': DASHBOARD_KEY },
  body: JSON.stringify({
    employee_id: EMP_ID,
    live_sha256: liveHash,
    leegality_doc_id,
    leegality_url,
    sent_by: process.env.USER || 'cli',
  }),
});
const recData = await recRes.json();
console.log(recRes.ok ? `\n✅ Recorded. Roster will show "eSign sent" status.` : `\n⚠ Recording failed: ${JSON.stringify(recData)}`);
