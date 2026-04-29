#!/usr/bin/env node
/**
 * sales-backfill/run-he.js — one-shot Apr 1 → today populate of HE
 * mirror tables. Mirrors run-nch.js but pulls from test.hamzahotel.com
 * (HE prod) company_id=1, and recomputes via /api/sales recompute-day
 * with brand=HE.
 *
 * Run: node scripts/sales-backfill/run-he.js
 */

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
// .env.local is in the main worktree, not the claude worktree
const ENV_FILE = fs.existsSync(path.join(ROOT, '.env.local'))
  ? path.join(ROOT, '.env.local')
  : '/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local';

// Load .env.local
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const KEY = process.env.TEST_ODOO_KEY;
const UID = parseInt(process.env.TEST_ODOO_UID || '2', 10);
if (!KEY) { console.error('TEST_ODOO_KEY missing in .env.local'); process.exit(1); }

const HOST = 'test.hamzahotel.com';
const DB = 'main';
const COMPANY_ID = 1;
const FROM = process.env.BACKFILL_FROM || '2026-04-01';
const TO   = process.env.BACKFILL_TO   || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const D1_DB = 'hn-hiring';
const D1_FLAGS = (process.env.D1_TARGET || 'remote') === 'remote' ? '--remote' : '--local';

async function odoo(model, method, args = [], kwargs = {}) {
  const r = await fetch(`https://${HOST}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw', args: [DB, UID, KEY, model, method, args, kwargs] } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${model}.${method}: ${j.error.data?.message || j.error.message}`);
  return j.result;
}

function utcToIst(s) {
  if (!s) return null;
  const d = new Date(s.slice(0, 19).replace(' ', 'T') + 'Z');
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')} ${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}`;
}
function sqlEsc(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function execD1Sql(label, statements) {
  if (!statements.length) { console.log(`  ${label}: no rows`); return; }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'he-backfill-'));
  const file = path.join(tmpDir, `${label}.sql`);
  fs.writeFileSync(file, statements.map(s => s.endsWith(';') ? s + '\n' : s + ';\n').join(''));
  try {
    execSync(`npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --file ${JSON.stringify(file)}`,
      { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    console.log(`  ${label}: ${statements.length} stmts OK`);
  } finally {
    try { fs.unlinkSync(file); fs.rmdirSync(tmpDir); } catch {}
  }
}

async function step1_PosConfig() {
  console.log('[1/5] HE pos.config refresh');
  const cfgs = await odoo('pos.config', 'search_read',
    [[['company_id', '=', COMPANY_ID]]],
    { fields: ['id', 'name'] });
  const stmts = cfgs.map(c =>
    `INSERT INTO pos_config_registry (pos_config_id, brand, name, last_seen_at)
     VALUES (${c.id}, 'HE', ${sqlEsc(c.name)}, ${sqlEsc(new Date().toISOString())})
     ON CONFLICT(pos_config_id) DO UPDATE SET name=excluded.name, last_seen_at=excluded.last_seen_at`);
  await execD1Sql('he_pos_config', stmts);
  return cfgs;
}

async function step2_PosOrders() {
  console.log(`[2/5] HE pos.order ${FROM} → ${TO}`);
  let cursor = 0;
  let total = 0;
  let allOrderIds = [];
  while (true) {
    const orders = await odoo('pos.order', 'search_read',
      [[['company_id', '=', COMPANY_ID],
        ['state', 'in', ['paid', 'done', 'invoiced', 'posted']],
        ['date_order', '>=', `${FROM} 00:00:00`],
        ['date_order', '<=', `${TO} 23:59:59`],
        ['id', '>', cursor]]],
      { fields: ['id', 'name', 'date_order', 'amount_total', 'amount_tax', 'state', 'company_id', 'session_id', 'config_id', 'payment_ids'],
        order: 'id asc', limit: 1000 });
    if (!orders.length) break;

    const allPmIds = [...new Set(orders.flatMap(o => o.payment_ids || []))];
    const pmRows = allPmIds.length
      ? await odoo('pos.payment', 'read', [allPmIds], { fields: ['id', 'pos_order_id', 'payment_method_id'] })
      : [];
    const pmById = Object.fromEntries(pmRows.map(p => [p.id, p]));

    const stmts = [];
    for (const o of orders) {
      const dateIst = utcToIst(o.date_order);
      const day = (dateIst || '').slice(0, 10);
      const pmNames = (o.payment_ids || []).map(pid => pmById[pid]?.payment_method_id?.[1]).filter(Boolean);
      const csv = [...new Set(pmNames)].join(',');
      stmts.push(
        `INSERT INTO pos_orders_mirror (
           odoo_pos_order_id, brand, pos_config_id, session_id, order_name,
           order_date_ist, order_date_day,
           amount_total_paise, amount_tax_paise,
           state, payment_methods_csv, synced_at)
         VALUES (${o.id}, 'HE', ${o.config_id?.[0] || 0}, ${o.session_id?.[0] ?? 'NULL'}, ${sqlEsc(o.name)},
                 ${sqlEsc(dateIst)}, ${sqlEsc(day)},
                 ${Math.round((o.amount_total || 0) * 100)}, ${Math.round((o.amount_tax || 0) * 100)},
                 ${sqlEsc(o.state)}, ${sqlEsc(csv)}, ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_order_id) DO UPDATE SET
           amount_total_paise=excluded.amount_total_paise,
           payment_methods_csv=excluded.payment_methods_csv,
           synced_at=excluded.synced_at`);
      allOrderIds.push(o.id);
    }
    await execD1Sql(`he_pos_orders_chunk_${cursor}`, stmts);
    total += orders.length;
    cursor = orders[orders.length - 1].id;
    if (orders.length < 1000) break;
  }
  console.log(`  total HE orders: ${total}`);
  return allOrderIds;
}

let _orderMetaCache = null;
async function loadOrderMeta() {
  if (_orderMetaCache) return _orderMetaCache;
  const cmd = `npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --json --command ${JSON.stringify(
    `SELECT odoo_pos_order_id, pos_config_id, order_date_day FROM pos_orders_mirror WHERE brand='HE'`
  )}`;
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  const start = out.indexOf('[\n  {');
  const parsed = JSON.parse(out.slice(start));
  const rows = parsed[0]?.results || [];
  _orderMetaCache = Object.fromEntries(rows.map(r => [r.odoo_pos_order_id, { day: r.order_date_day, cfg: r.pos_config_id }]));
  return _orderMetaCache;
}

async function step3_PosPayments(orderIds) {
  console.log(`[3/5] HE pos.payment for ${orderIds.length} orders`);
  if (!orderIds.length) return;
  const orderMeta = await loadOrderMeta();
  for (let i = 0; i < orderIds.length; i += 500) {
    const slice = orderIds.slice(i, i + 500);
    const pays = await odoo('pos.payment', 'search_read',
      [[['pos_order_id', 'in', slice]]],
      { fields: ['id', 'pos_order_id', 'payment_method_id', 'amount'] });
    const stmts = [];
    for (const p of pays) {
      const oid = p.pos_order_id?.[0];
      const meta = orderMeta[oid]; if (!meta) continue;
      stmts.push(
        `INSERT INTO pos_payments_mirror (
           odoo_pos_payment_id, odoo_pos_order_id, brand, order_date_day,
           pos_config_id, payment_method_id, payment_method_name,
           amount_paise, synced_at)
         VALUES (${p.id}, ${oid}, 'HE', ${sqlEsc(meta.day)}, ${meta.cfg},
                 ${p.payment_method_id?.[0] || 0}, ${sqlEsc(p.payment_method_id?.[1] || 'unknown')},
                 ${Math.round((p.amount || 0) * 100)}, ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_payment_id) DO UPDATE SET
           amount_paise=excluded.amount_paise,
           payment_method_name=excluded.payment_method_name,
           synced_at=excluded.synced_at`);
    }
    await execD1Sql(`he_pos_payments_chunk_${i}`, stmts);
  }
}

async function step4_PosLines(orderIds) {
  console.log(`[4/5] HE pos.order.line for ${orderIds.length} orders`);
  if (!orderIds.length) return;
  const orderMeta = await loadOrderMeta();
  for (let i = 0; i < orderIds.length; i += 500) {
    const slice = orderIds.slice(i, i + 500);
    const lines = await odoo('pos.order.line', 'search_read',
      [[['order_id', 'in', slice]]],
      { fields: ['id', 'order_id', 'product_id', 'qty', 'price_subtotal_incl'] });
    const stmts = [];
    for (const l of lines) {
      const oid = l.order_id?.[0];
      const meta = orderMeta[oid]; if (!meta) continue;
      stmts.push(
        `INSERT INTO pos_lines_mirror (
           odoo_pos_line_id, odoo_pos_order_id, brand, order_date_day,
           pos_config_id, product_id, product_name,
           qty, price_subtotal_incl_paise, synced_at)
         VALUES (${l.id}, ${oid}, 'HE', ${sqlEsc(meta.day)}, ${meta.cfg},
                 ${l.product_id?.[0] || 0}, ${sqlEsc(l.product_id?.[1] || null)},
                 ${l.qty || 0}, ${Math.round((l.price_subtotal_incl || 0) * 100)},
                 ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_line_id) DO UPDATE SET
           qty=excluded.qty, price_subtotal_incl_paise=excluded.price_subtotal_incl_paise,
           synced_at=excluded.synced_at`);
    }
    await execD1Sql(`he_pos_lines_chunk_${i}`, stmts);
  }
}

async function step5_ReconDaily() {
  console.log(`[5/5] HE recompute Apr 1 → ${TO} via /api/sales recompute-day`);
  const days = [];
  let d = new Date(`${FROM}T00:00:00Z`).getTime();
  const last = new Date(`${TO}T00:00:00Z`).getTime();
  while (d <= last) { days.push(new Date(d).toISOString().slice(0, 10)); d += 86400 * 1000; }

  const PIN = process.env.RECOMPUTE_PIN || '5882';
  const BASE = process.env.RECOMPUTE_BASE || 'https://hnhotels.in';
  for (const day of days) {
    const r = await fetch(`${BASE}/api/sales?action=recompute-day`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN, day, brand: 'HE' }),
    });
    const j = await r.json();
    if (!j.success) { console.error(`  ${day}: FAIL ${j.error}`); continue; }
    const c = j.computed;
    console.log(`  ${day}: gross=₹${c.gross_sales_paise/100}  cash=₹${c.total_cash_paise/100}  upi=₹${c.total_upi_paise/100}  agg=₹${c.aggregator_paise/100}  Δupi=₹${c.upi_discrepancy_paise/100}  orders=${c.order_count}`);
  }
}

(async () => {
  console.log(`[he-backfill] target=${D1_FLAGS} range=${FROM} → ${TO}`);
  await step1_PosConfig();
  const orderIds = await step2_PosOrders();
  await step3_PosPayments(orderIds);
  await step4_PosLines(orderIds);
  await step5_ReconDaily();
  console.log('\n[he-backfill] done.');
})().catch(e => { console.error('[he-backfill] fatal:', e.stack || e.message); process.exit(1); });
