#!/usr/bin/env node
/**
 * contracts-upload.mjs — Upload the 31 per-employee contract PDFs to Drive
 * and link them to their D1 employee rows as v1.
 *
 * Run from project root:
 *   node scripts/contracts-upload.mjs \
 *     --bundles ~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/Per_Employee_Bundles \
 *     --drive-folder 1Couoe4_JOD1eChpBijz3dhreyyXjBCYE \
 *     --api https://hnhotels.in
 *
 * Requires:
 *   - gcloud auth application-default login  (for Drive API)
 *   - DASHBOARD_KEY env var (or passed --key=...)
 *   - googleapis npm package (run `npm install googleapis` if not present)
 *
 * What it does:
 *   1. Reads PDFs from --bundles directory
 *   2. Fetches active employees from /api/hr-admin?action=employees
 *   3. Matches each PDF to an employee (by row_no prefix on filename, with name fallback)
 *   4. Prints proposed mapping; waits for "yes" to proceed
 *   5. Uploads each PDF to the Drive folder (or updates if filename already exists)
 *   6. Computes SHA-256 + size for each
 *   7. POSTs {employee_id, drive_file_id, drive_file_name, sha256, size_bytes} to
 *      /api/hr-contracts?action=set-contract-drive-ids in one bulk call
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import readline from 'node:readline';

// ─── Args ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const expandHome = (p) => p?.startsWith('~') ? p.replace(/^~/, homedir()) : p;
const BUNDLES_DIR = expandHome(args.bundles || '~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/Per_Employee_Bundles');
const DRIVE_FOLDER_ID = args['drive-folder'] || '1Couoe4_JOD1eChpBijz3dhreyyXjBCYE';
const API_BASE = args.api || 'https://hnhotels.in';
const DASHBOARD_KEY = args.key || process.env.DASHBOARD_KEY;
const DRY_RUN = !!args['dry-run'];

if (!DASHBOARD_KEY) {
  console.error('Set DASHBOARD_KEY env var or pass --key=...');
  process.exit(1);
}

// ─── Step 1: Read PDF files ──────────────────────────────────────────────────
console.log(`📂 Reading bundles from: ${BUNDLES_DIR}`);
let files;
try {
  files = readdirSync(BUNDLES_DIR)
    .filter(f => extname(f).toLowerCase() === '.pdf')
    .filter(f => !f.toLowerCase().startsWith('00_'))      // skip statutory notices
    .sort();
} catch (e) {
  console.error(`Failed to read directory: ${e.message}`);
  process.exit(1);
}
console.log(`   Found ${files.length} PDFs`);

// ─── Step 2: Fetch active employees from D1 ──────────────────────────────────
console.log(`🔗 Fetching active employees from ${API_BASE}…`);
const empRes = await fetch(`${API_BASE}/api/hr-admin?action=employees&active=1`, {
  headers: { 'x-dashboard-key': DASHBOARD_KEY },
});
if (!empRes.ok) {
  console.error(`Failed: ${empRes.status} ${await empRes.text()}`);
  process.exit(1);
}
const empData = await empRes.json();
const employees = empData.employees || [];
console.log(`   Got ${employees.length} active employees`);

// ─── Step 3: Match files to employees ────────────────────────────────────────
//
// PDF filename pattern: "01_Md_Kesmat_Sk.pdf" — leading 2-digit prefix is the
// row_no (or sequential number from the original generation). We try:
//   (1) row_no exact match
//   (2) name fuzzy match (lowercase, strip non-alphanum)
//
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const proposed = []; const unmatched = [];
for (const filename of files) {
  const m = filename.match(/^(\d+)_(.+)\.pdf$/i);
  if (!m) { unmatched.push({ filename, reason: 'unrecognized filename pattern' }); continue; }
  const rowNo = parseInt(m[1], 10);
  const namePart = m[2].replace(/_/g, ' ');

  // Try row_no
  let emp = employees.find(e => e.row_no === rowNo);
  let how = 'row_no';
  if (!emp) {
    // Try name fuzzy
    const target = normalize(namePart);
    emp = employees.find(e => normalize(e.name) === target || normalize(e.known_as) === target);
    how = emp ? 'name-exact' : null;
  }
  if (!emp) {
    // Loose: substring match
    const target = normalize(namePart);
    emp = employees.find(e => target.includes(normalize(e.name)) || normalize(e.name).includes(target));
    how = emp ? 'name-substring' : null;
  }

  if (emp) {
    proposed.push({ filename, employee_id: emp.id, employee_name: emp.name, row_no: emp.row_no, match: how });
  } else {
    unmatched.push({ filename, namePart, rowNo });
  }
}

console.log('\n📋 Proposed mapping:');
console.table(proposed.map(p => ({ file: p.filename, emp_id: p.employee_id, name: p.employee_name, row_no: p.row_no, match: p.match })));
if (unmatched.length) {
  console.log('\n⚠ UNMATCHED (will be skipped):');
  console.table(unmatched);
}

// ─── Step 4: Confirm ─────────────────────────────────────────────────────────
async function confirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans.trim().toLowerCase() === 'yes'); }));
}

if (DRY_RUN) {
  console.log('\n🌵 --dry-run mode: stopping before upload.');
  process.exit(0);
}

if (!await confirm(`\n→ Upload ${proposed.length} PDFs to Drive folder ${DRIVE_FOLDER_ID} and link in D1? Type "yes" to proceed: `)) {
  console.log('Aborted.');
  process.exit(0);
}

// ─── Step 5: Upload to Drive ─────────────────────────────────────────────────
console.log('\n🚀 Uploading to Drive…');
let google;
try {
  ({ google } = await import('googleapis'));
} catch {
  console.error('Missing dependency. Run: npm install googleapis');
  process.exit(1);
}
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth });

const uploaded = [];
for (const p of proposed) {
  const filePath = join(BUNDLES_DIR, p.filename);
  const bytes = readFileSync(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const size_bytes = bytes.length;

  // Check if file with same name exists in folder
  const existing = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and name='${p.filename}' and trashed=false`,
    fields: 'files(id,name)',
  });

  let fileId;
  if (existing.data.files?.length) {
    fileId = existing.data.files[0].id;
    console.log(`  ↻ ${p.filename} → updating existing ${fileId}`);
    await drive.files.update({
      fileId,
      media: { mimeType: 'application/pdf', body: Buffer.from(bytes) },
    });
  } else {
    const r = await drive.files.create({
      requestBody: { name: p.filename, parents: [DRIVE_FOLDER_ID], mimeType: 'application/pdf' },
      media: { mimeType: 'application/pdf', body: Buffer.from(bytes) },
      fields: 'id,name',
    });
    fileId = r.data.id;
    console.log(`  ✓ ${p.filename} → ${fileId}`);
  }
  uploaded.push({
    employee_id: p.employee_id,
    drive_file_id: fileId,
    drive_file_name: p.filename,
    sha256,
    size_bytes,
  });
}

// ─── Step 6: Bulk-link in D1 ─────────────────────────────────────────────────
console.log(`\n🔗 Linking ${uploaded.length} contracts in D1…`);
const linkRes = await fetch(`${API_BASE}/api/hr-contracts?action=set-contract-drive-ids`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dashboard-key': DASHBOARD_KEY },
  body: JSON.stringify({ rows: uploaded, generated_by: 'bootstrap_script' }),
});
const linkData = await linkRes.json();
console.log('Result:', JSON.stringify(linkData, null, 2));

if (linkData.ok) {
  console.log(`\n✅ Done. ${linkData.updated}/${linkData.total} contracts linked.`);
  console.log(`   Refresh /ops/hr → contract badges should appear.`);
} else {
  console.log(`\n⚠ Partial: ${linkData.updated}/${linkData.total} succeeded. Review errors above.`);
}
