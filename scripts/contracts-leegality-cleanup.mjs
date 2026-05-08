#!/usr/bin/env node
/**
 * contracts-leegality-cleanup.mjs — One-time + ongoing Leegality account cleanup.
 *
 * Workflow:
 *   1. Fetch full doc list from Leegality
 *   2. POST inventory to /api/hr-contracts?action=leegality-inventory
 *      → backend marks each doc as orphan (no D1 leegality_doc_id match) or kept
 *   3. Print orphans, ask for confirmation
 *   4. Delete confirmed orphans via Leegality API
 *   5. POST /api/hr-contracts?action=leegality-mark-action with action='wiped'
 *
 * Usage:
 *   node scripts/contracts-leegality-cleanup.mjs            # safe: list + wipe orphans
 *   node scripts/contracts-leegality-cleanup.mjs --wipe-all # nuclear: wipe EVERY doc
 *
 * Required env: DASHBOARD_KEY, LEEGALITY_API_BASE, LEEGALITY_API_KEY
 */

import readline from 'node:readline';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const API_BASE = args.api || 'https://hnhotels.in';
const WIPE_ALL = !!args['wipe-all'];
const DASHBOARD_KEY = process.env.DASHBOARD_KEY;
const LEEGALITY_API_BASE = process.env.LEEGALITY_API_BASE;
const LEEGALITY_API_KEY = process.env.LEEGALITY_API_KEY;

if (!DASHBOARD_KEY || !LEEGALITY_API_BASE || !LEEGALITY_API_KEY) {
  console.error('Missing env vars: DASHBOARD_KEY, LEEGALITY_API_BASE, LEEGALITY_API_KEY');
  process.exit(1);
}

async function confirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

// ─── 1. List all docs in Leegality ───────────────────────────────────────────
//
// TODO: confirm Leegality list endpoint shape. Typical:
//   GET {LEEGALITY_API_BASE}/v1/documents?limit=200
//
console.log(`📥 Fetching all docs from Leegality…`);
const listRes = await fetch(`${LEEGALITY_API_BASE}/v1/documents?limit=500`, {
  headers: { 'authorization': `Bearer ${LEEGALITY_API_KEY}` },
});
const listData = await listRes.json();
if (!listRes.ok) { console.error('Leegality list failed:', listData); process.exit(1); }

const allDocs = (listData.documents || listData.items || listData).map(d => ({
  leegality_doc_id: d.id || d.documentId,
  doc_name: d.name || d.fileName,
  status: d.status,
  created_at: d.createdAt || d.created_at,
}));
console.log(`   Found ${allDocs.length} docs total`);

// ─── 2. POST inventory to backend (it marks orphans by D1 lookup) ────────────
const invRes = await fetch(`${API_BASE}/api/hr-contracts?action=leegality-inventory`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dashboard-key': DASHBOARD_KEY },
  body: JSON.stringify({ docs: allDocs, replace: true }),
});
const invData = await invRes.json();
console.log(`   Inventory recorded: ${invData.matched} matched · ${invData.orphans} orphans`);

// ─── 3. Fetch orphans ────────────────────────────────────────────────────────
const orphRes = await fetch(`${API_BASE}/api/hr-contracts?action=leegality-orphans`, {
  headers: { 'x-dashboard-key': DASHBOARD_KEY },
});
const orphData = await orphRes.json();
const orphans = orphData.orphans || [];
const targets = WIPE_ALL ? allDocs : orphans;

if (!targets.length) { console.log('✅ Nothing to wipe.'); process.exit(0); }

console.log(`\n📋 ${WIPE_ALL ? 'ALL DOCS' : 'ORPHANS'} (will be deleted):`);
console.table(targets.map(d => ({
  id: (d.leegality_doc_id || '').slice(0,12),
  name: (d.doc_name || '').slice(0, 40),
  status: d.status,
})));

const word = WIPE_ALL ? 'WIPE-ALL' : 'wipe-orphans';
const ans = await confirm(`\n⚠ Type "${word}" to confirm deletion of ${targets.length} doc(s) from Leegality: `);
if (ans !== word.toLowerCase()) { console.log('Aborted.'); process.exit(0); }

// ─── 4. Delete each from Leegality ───────────────────────────────────────────
//
// TODO: confirm Leegality delete endpoint. Typical:
//   DELETE {LEEGALITY_API_BASE}/v1/documents/{id}
//
console.log(`\n🔥 Deleting…`);
const deletedIds = [];
for (const d of targets) {
  const id = d.leegality_doc_id;
  try {
    const r = await fetch(`${LEEGALITY_API_BASE}/v1/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'authorization': `Bearer ${LEEGALITY_API_KEY}` },
    });
    if (r.ok || r.status === 404) {
      deletedIds.push(d.id);
      console.log(`  ✓ ${id.slice(0,12)}`);
    } else {
      console.log(`  ✗ ${id.slice(0,12)} → ${r.status}`);
    }
  } catch (e) {
    console.log(`  ✗ ${id.slice(0,12)} → ${e.message}`);
  }
}

// ─── 5. Mark inventory rows as wiped ─────────────────────────────────────────
if (deletedIds.length && !WIPE_ALL) {
  await fetch(`${API_BASE}/api/hr-contracts?action=leegality-mark-action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dashboard-key': DASHBOARD_KEY },
    body: JSON.stringify({ ids: deletedIds, action: 'wiped' }),
  });
}

console.log(`\n✅ Cleanup complete. ${deletedIds.length}/${targets.length} deleted.`);
