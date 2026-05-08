#!/usr/bin/env node
/**
 * contracts-regenerate.mjs — Materialise dirty contracts into new PDF versions.
 *
 * Workflow:
 *   1. Pulls /api/hr-contracts?action=pending-regenerations → list of dirty employees
 *   2. For each: regenerate DOCX + PDF using the docx generator (TODO: paste yours)
 *   3. Uploads PDF to Drive (overwrites old version filename or creates new)
 *   4. Computes SHA-256 + size
 *   5. POSTs back to /api/hr-contracts?action=finalize-regeneration
 *      → D1 advances contract_drive_id, contract_pdf_sha256, contract_version
 *      → contract_dirty cleared, edits marked applied
 *
 * Usage:
 *   node scripts/contracts-regenerate.mjs --api https://hnhotels.in --drive-folder <id>
 *   node scripts/contracts-regenerate.mjs --employee-id 12   # only one
 *
 * Requires:
 *   - DASHBOARD_KEY env var
 *   - googleapis + docx + (PDF converter of your choice — see TODO in generatePdf())
 *
 * IMPORTANT — generator is currently a TODO STUB. To make this fully functional,
 * paste the body of your existing generate-final.js generator into generateDocxBuffer()
 * and pick a PDF conversion path in convertDocxToPdf().
 */

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const API_BASE = args.api || 'https://hnhotels.in';
const DRIVE_FOLDER_ID = args['drive-folder'] || '1Couoe4_JOD1eChpBijz3dhreyyXjBCYE';
const DASHBOARD_KEY = args.key || process.env.DASHBOARD_KEY;
const SINGLE_EMP = args['employee-id'] ? Number(args['employee-id']) : null;

if (!DASHBOARD_KEY) { console.error('DASHBOARD_KEY required'); process.exit(1); }

// ─── Step 1: Fetch dirty employees ───────────────────────────────────────────
const r = await fetch(`${API_BASE}/api/hr-contracts?action=pending-regenerations`, {
  headers: { 'x-dashboard-key': DASHBOARD_KEY }
});
const data = await r.json();
let pending = data.pending || [];
if (SINGLE_EMP) pending = pending.filter(p => p.id === SINGLE_EMP);

if (!pending.length) {
  console.log('✅ No dirty contracts. Nothing to regenerate.');
  process.exit(0);
}
console.log(`📋 ${pending.length} contract(s) need regeneration:`);
console.table(pending.map(p => ({ id: p.id, name: p.known_as || p.name, brand: p.brand_label, pending_edits: p.pending_edits })));

// ─── Drive auth ──────────────────────────────────────────────────────────────
const { google } = await import('googleapis');
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

// ─── Step 2-4: per-employee regen + upload + finalize ────────────────────────
for (const emp of pending) {
  console.log(`\n→ Regenerating contract for ${emp.known_as || emp.name} (id=${emp.id})…`);
  try {
    const docxBuffer = await generateDocxBuffer(emp);
    const pdfBuffer = await convertDocxToPdf(docxBuffer, emp);
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const nextVersion = (emp.contract_version || 1) + 1;
    const safeName = (emp.known_as || emp.name).replace(/[^A-Za-z0-9]/g, '_');
    const filename = `${String(emp.id).padStart(2,'0')}_${safeName}_v${nextVersion}.pdf`;

    const upload = await drive.files.create({
      requestBody: { name: filename, parents: [DRIVE_FOLDER_ID], mimeType: 'application/pdf' },
      media: { mimeType: 'application/pdf', body: Buffer.from(pdfBuffer) },
      fields: 'id,name',
    });
    const drive_file_id = upload.data.id;

    const fin = await fetch(`${API_BASE}/api/hr-contracts?action=finalize-regeneration`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dashboard-key': DASHBOARD_KEY },
      body: JSON.stringify({
        employee_id: emp.id,
        drive_file_id,
        drive_file_name: filename,
        sha256,
        size_bytes: pdfBuffer.length,
        generated_from: emp,
        generated_by: 'regen_script',
      }),
    });
    const finData = await fin.json();
    if (fin.ok) {
      console.log(`  ✅ v${finData.version_no} ${drive_file_id} hash=${sha256.slice(0,12)}…`);
    } else {
      console.error(`  ❌ finalize failed:`, finData);
    }
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
  }
}

// ─── Generator stubs ─────────────────────────────────────────────────────────
//
// TODO: paste your existing docx generator from /tmp/hn-letters-build/generate-final.js
// into generateDocxBuffer() and pick a PDF conversion path in convertDocxToPdf().
//
// Recommended conversion paths (pick one):
//   1. Drive: upload DOCX → re-export as PDF (free, ~3s)
//   2. CloudConvert API (~$0.01/conversion, fast)
//   3. LibreOffice headless: `soffice --headless --convert-to pdf` (free, slow)
//
async function generateDocxBuffer(emp) {
  // TODO: implement using docx-js + the same template as the original 31 PDFs.
  // Should produce a Buffer of the .docx file.
  throw new Error(
    'TODO: paste your generate-final.js generator into generateDocxBuffer(). ' +
    'See ~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/ for the template output.'
  );
}

async function convertDocxToPdf(docxBuffer, emp) {
  // TODO: pick one of these:
  //
  // OPTION A — Drive convert (upload DOCX as Google Doc, export as PDF):
  //   const up = await drive.files.create({
  //     requestBody: { name: 'tmp.docx', mimeType: 'application/vnd.google-apps.document' },
  //     media: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: Buffer.from(docxBuffer) },
  //     fields: 'id',
  //   });
  //   const pdf = await drive.files.export({ fileId: up.data.id, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
  //   await drive.files.delete({ fileId: up.data.id });
  //   return Buffer.from(pdf.data);
  //
  // OPTION B — LibreOffice (local):
  //   import { execSync } from 'node:child_process';
  //   import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
  //   const dir = mkdtempSync('/tmp/cregen-');
  //   writeFileSync(`${dir}/in.docx`, docxBuffer);
  //   execSync(`soffice --headless --convert-to pdf --outdir ${dir} ${dir}/in.docx`);
  //   return readFileSync(`${dir}/in.pdf`);
  //
  throw new Error('TODO: choose a DOCX→PDF path in convertDocxToPdf().');
}
