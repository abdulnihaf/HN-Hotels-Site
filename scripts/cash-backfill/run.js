#!/usr/bin/env node
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * One-shot April back-fill — produces money_events rows for cash
 * outflows that pre-date the cash_basheer / cash_nihaf instruments.
 *
 * Spec: docs/OPS-CASH-SPEC.md §4.6.
 * Phase 1 acceptance: SUM(money_events) per cash instrument matches
 * Odoo cash-journal balance for the same period within ±0.5%
 * (docs/OPS-CASH-SPEC.md §8.8).
 *
 * Usage:
 *   node scripts/cash-backfill/run.js --dry-run --since=2026-04-01
 *      Pulls candidates from D1 and emits a CSV at
 *      data/cash/april-backfill-classifications-<run-id>.csv. No writes.
 *
 *   node scripts/cash-backfill/run.js --commit --since=2026-04-01
 *      Reads the (manually-reviewed) CSV back and inserts money_events
 *      rows. Idempotent via source_ref = `backfill:<kind>:<source-id>`.
 *
 *   node scripts/cash-backfill/run.js --reconcile --since=2026-04-01
 *      Compares D1 cash-pile totals to Odoo cash-journal balances and
 *      prints the per-instrument variance. Use this to verify §8.8 gate.
 *
 * Auth: requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID + D1_DB
 * env vars (or pass --d1-binding to use wrangler shell). Odoo requires
 * ODOO_API_KEY + admin UID. Reconciliation step is read-only.
 *
 * Why this script and not a Worker cron: this is a one-shot
 * ground-truth re-creation. After it runs once and the §8.8 gate
 * passes, going-forward writes use spend.js + money.js Phase 1 hooks.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { argv, exit, env } from 'node:process';
import { join, dirname } from 'node:path';

// ━━━ Args
const flags = Object.fromEntries(
  argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const MODE = flags['dry-run'] ? 'dry-run'
           : flags['commit']  ? 'commit'
           : flags['reconcile'] ? 'reconcile'
           : null;
if (!MODE) {
  console.error('usage: --dry-run | --commit | --reconcile [--since=YYYY-MM-DD]');
  exit(2);
}
const SINCE = flags['since'] || '2026-04-01';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = join('data', 'cash');
const OUT_CSV = join(OUT_DIR, `april-backfill-classifications-${RUN_ID}.csv`);

// ━━━ D1 access via Cloudflare REST (no wrangler dependency).
const CF_TOKEN = env.CLOUDFLARE_API_TOKEN;
const CF_ACC   = env.CLOUDFLARE_ACCOUNT_ID;
const D1_ID    = env.D1_DATABASE_ID;
if (!CF_TOKEN || !CF_ACC || !D1_ID) {
  console.error('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID required.');
  exit(1);
}

async function d1Query(sql, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACC}/d1/database/${D1_ID}/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ sql, params }),
    }
  );
  const d = await r.json();
  if (!d.success) throw new Error(`D1: ${JSON.stringify(d.errors)}`);
  return d.result?.[0]?.results || [];
}

// ━━━ Cash-pile classifier — same rule as functions/api/spend.js
//     cashPileForRecord(), but read-only against existing rows.
//
// Inputs come from business_expenses.x_payment_method='cash' rows since
// SINCE. The PIN that recorded the row is in business_expenses.recorded_by
// (a name string, not a PIN — historical data is name-keyed). We map by
// name where unambiguous; ambiguous rows go to the CSV with a blank
// `instrument` column for owner review.
function classifyCashPile(row) {
  const recBy = String(row.recorded_by || '').trim().toLowerCase();
  const brand = String(row.x_location || row.brand || '').trim().toUpperCase();
  if (recBy.includes('noor'))   return ['pos_counter_he',  'cashier-HE'];
  if (recBy.includes('kesmat')) return ['pos_counter_nch', 'cashier-NCH'];
  if (recBy.includes('nafees')) return ['pos_counter_nch', 'cashier-NCH'];
  if (recBy.includes('nihaf'))  return ['cash_nihaf',      'owner'];
  if (recBy.includes('naveen')) return ['cash_basheer',    'central-cfo'];
  if (recBy.includes('basheer'))return ['cash_basheer',    'central-gm'];
  if (recBy.includes('tanveer'))return ['cash_basheer',    'central-gm'];
  if (recBy.includes('yashwant') || recBy.includes('ismail'))
                                return ['cash_basheer',    'central-gm'];
  if (recBy.includes('faheem')) return ['cash_basheer',    'central-asstmgr'];
  if (recBy.includes('zoya'))   return ['cash_basheer',    'purchase'];
  // Brand-only fallback for outlets with unfamiliar names.
  if (brand === 'HE')  return [null, 'AMBIGUOUS-HE-default-pos_counter_he'];
  if (brand === 'NCH') return [null, 'AMBIGUOUS-NCH-default-pos_counter_nch'];
  return [null, 'AMBIGUOUS'];
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ━━━ DRY-RUN: pull candidates + emit CSV
async function dryRun() {
  console.error(`[backfill] dry-run since=${SINCE}`);
  const candidates = await d1Query(
    `SELECT id, recorded_by, recorded_at, amount, description, category,
            payment_mode, x_payment_method, x_location, x_pool, x_excluded_from_pnl,
            odoo_id, company_id, product_id, product_name,
            vendor_id, vendor_name
       FROM business_expenses
      WHERE recorded_at >= ?
        AND (x_payment_method = 'cash' OR (x_payment_method IS NULL AND payment_mode='cash'))
        AND COALESCE(x_excluded_from_pnl, 0) = 0
      ORDER BY recorded_at`,
    [SINCE]
  );

  // Skip rows that already have a backfill money_events row.
  const existing = await d1Query(
    `SELECT source_ref FROM money_events
      WHERE source_ref LIKE 'backfill:expense:%'`
  );
  const seen = new Set(existing.map((r) => r.source_ref));

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const lines = [
    [
      'kind', 'source_id', 'recorded_at', 'recorded_by', 'amount_paise',
      'brand', 'category', 'product_name', 'vendor_name',
      'suggested_instrument', 'classification_reason', 'review_action',
    ].join(','),
  ];
  let auto = 0, ambiguous = 0, skip = 0;
  for (const row of candidates) {
    const srcRef = `backfill:expense:${row.id}`;
    if (seen.has(srcRef)) { skip++; continue; }
    const [pile, reason] = classifyCashPile(row);
    if (!pile) ambiguous++; else auto++;
    lines.push([
      'expense', row.id, row.recorded_at, row.recorded_by,
      Math.round(parseFloat(row.amount || 0) * 100),
      row.x_location || '', row.category || '', row.product_name || '',
      row.vendor_name || '',
      pile || '',
      reason,
      pile ? 'auto' : 'REVIEW',
    ].map(csvEscape).join(','));
  }
  writeFileSync(OUT_CSV, lines.join('\n'));
  console.error(`[backfill] wrote ${OUT_CSV}`);
  console.error(`[backfill] auto-classified=${auto}  ambiguous=${ambiguous}  already-backfilled=${skip}`);
  console.error(`[backfill] review the CSV. Fill 'suggested_instrument' on AMBIGUOUS rows. Then re-run with --commit --csv=${OUT_CSV}`);
}

// ━━━ COMMIT: read CSV back, INSERT money_events idempotently.
async function commit() {
  const csvPath = flags['csv'];
  if (!csvPath || !existsSync(csvPath)) {
    console.error(`--csv=<path> required and must exist`);
    exit(2);
  }
  const lines = readFileSync(csvPath, 'utf-8').trim().split('\n');
  const header = lines.shift().split(',');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  let inserted = 0, skipped = 0, missing = 0;

  for (const line of lines) {
    // tolerant CSV parse — re-uses csvEscape's quoting rules
    const cells = parseCsvRow(line);
    const kind = cells[idx['kind']];
    const sourceId = cells[idx['source_id']];
    const instrument = cells[idx['suggested_instrument']];
    if (!instrument) { missing++; continue; }
    const srcRef = `backfill:${kind}:${sourceId}`;
    const recBy = cells[idx['recorded_by']];
    const amountPaise = parseInt(cells[idx['amount_paise']], 10);
    const txnAt = cells[idx['recorded_at']];
    const brand = cells[idx['brand']];
    const category = cells[idx['category']];
    const product = cells[idx['product_name']];
    const vendor = cells[idx['vendor_name']];
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) { skipped++; continue; }
    try {
      await d1Query(
        `INSERT INTO money_events
           (source, source_ref, direction, amount_paise, currency,
            instrument, channel, counterparty, narration,
            txn_at, received_at, parse_status, brand, category,
            matched_expense_id, recorded_by_name, notes)
         VALUES ('cash', ?, 'debit', ?, 'INR',
                 ?, 'internal', ?, ?,
                 ?, datetime('now'), 'parsed', ?, ?,
                 ?, ?, ?)`,
        [srcRef, amountPaise, instrument,
         vendor || product || null, product || null,
         txnAt, brand || null, category || null,
         parseInt(sourceId, 10), recBy || null,
         `Phase-1 April backfill — see ${csvPath}`]
      );
      inserted++;
    } catch (e) {
      // unique-index collision → already done; treat as skip
      if (/UNIQUE/i.test(e.message)) skipped++;
      else { console.error(`[backfill] ${srcRef} failed: ${e.message}`); }
    }
  }
  console.error(`[backfill] inserted=${inserted}  skipped(idem)=${skipped}  missing-instrument=${missing}`);
}

function parseCsvRow(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ━━━ RECONCILE: §8.8 gate. D1 cash-pile totals vs the same period from
//     business_expenses (Odoo's mirrored truth). Bank totals also
//     surfaced to confirm /ops/bank/ side. ±0.5% per instrument.
async function reconcile() {
  console.error(`[reconcile] since=${SINCE}`);
  const cashPiles = await d1Query(
    `SELECT instrument,
            SUM(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END) AS bal_paise,
            COUNT(*) AS rowcount
       FROM money_events
      WHERE instrument IN ('pos_counter_he','pos_counter_nch','cash_basheer','cash_nihaf')
        AND parse_status IN ('parsed','partial')
        AND COALESCE(txn_at, received_at) >= ?
      GROUP BY instrument`,
    [SINCE]
  );
  const expenseSum = await d1Query(
    `SELECT x_location AS brand, SUM(amount) AS total
       FROM business_expenses
      WHERE recorded_at >= ? AND x_payment_method = 'cash'
        AND COALESCE(x_excluded_from_pnl,0)=0
      GROUP BY x_location`,
    [SINCE]
  );

  console.log('\n━━━ Cash-pile balances (D1 money_events) ━━━');
  for (const r of cashPiles) {
    console.log(`  ${r.instrument.padEnd(20)} ₹${(r.bal_paise / 100).toFixed(2).padStart(12)} (${r.rowcount} rows)`);
  }
  const totalPaise = cashPiles.reduce((s, r) => s + r.bal_paise, 0);
  console.log(`  ${'TOTAL'.padEnd(20)} ₹${(totalPaise / 100).toFixed(2).padStart(12)}\n`);

  console.log('━━━ business_expenses cash spend (truth side) ━━━');
  let expTotal = 0;
  for (const r of expenseSum) {
    console.log(`  ${(r.brand || '?').padEnd(8)} ₹${parseFloat(r.total || 0).toFixed(2).padStart(12)}`);
    expTotal += parseFloat(r.total || 0);
  }
  console.log(`  ${'TOTAL'.padEnd(8)} ₹${expTotal.toFixed(2).padStart(12)}\n`);

  // Note: cash piles include credits (handovers, sales) so absolute equality
  // is not expected. The §8.8 gate is per-instrument vs Odoo cash-journal
  // closing balance — that requires Odoo read access. This reconcile mode
  // surfaces what we have in D1 today; cross-check Odoo journals manually
  // until Phase 2 wires the journal-API read into this script.
  console.log('Note: §8.8 gate compares each cash pile to its Odoo cash-journal');
  console.log('closing balance, not to total cash spend. Use this output to spot-');
  console.log('check movement, then verify against Odoo journal trial balance.');
}

const main = MODE === 'dry-run'   ? dryRun
          : MODE === 'commit'     ? commit
          : MODE === 'reconcile'  ? reconcile
          : null;
main().catch((e) => { console.error(e); exit(1); });
