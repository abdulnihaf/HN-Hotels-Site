#!/usr/bin/env node
/**
 * sales-backfill/run-nch.js — one-shot Apr 1 → today populate of the
 * sales-recon mirror tables for NCH.
 *
 * Why this exists: the cron worker (workers/spend-sync-cron via
 * attendance-cron piggyback) only runs forward from "now". Without
 * this script the dashboard's daily grid is empty for April. Idempotent
 * via the same UNIQUE keys the cron uses, so re-running is safe.
 *
 * Run:  node scripts/sales-backfill/run-nch.js
 *
 * Env (.env.local, gitignored):
 *   OPS_ODOO_KEY         — ops.hamzahotel.com admin key (asset DB row 36)
 *   OPS_ODOO_UID         — defaults to 2
 *   RAZORPAY_KEY         — Razorpay live key id  (asset DB row 73)
 *   RAZORPAY_SECRET      — Razorpay live key sec (asset DB row 74)
 *   D1_TARGET            — 'local' (default) hits wrangler local D1;
 *                          'remote' hits prod via wrangler --remote
 *   BACKFILL_FROM        — defaults to 2026-04-01
 *   BACKFILL_TO          — defaults to today (IST)
 *
 * Order of operations:
 *   1. Walk pos.config for company_id=10 — upsert pos_config_registry.
 *   2. Walk pos.order in 1000-row chunks since BACKFILL_FROM — upsert
 *      pos_orders_mirror with payment_methods_csv pre-denormalized.
 *   3. Walk pos.payment for those orders — upsert pos_payments_mirror.
 *   4. Walk pos.order.line for those orders — upsert pos_lines_mirror.
 *   5. For each row in razorpay_qr_registry (active, brand=NCH), call
 *      Razorpay /v1/payments/qr_codes/:id/payments?from=...&to=... and
 *      upsert razorpay_qr_collections.
 *   6. For every day in [BACKFILL_FROM, today], compute and upsert
 *      sales_recon_daily.
 *
 * NOTE: D1 writes go via `wrangler d1 execute --command` per row; this
 * is slower than a single bulk SQL but it sidesteps shell-escaping pain
 * for arbitrary product/vendor names. A future optimization is to write
 * the full statement set to a temp .sql file and use `--file` instead.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn(`[env] ${ENV_FILE} not found — relying on process.env`);
    return;
  }
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env: ${k}`); return v; };

const OPS_HOST = 'ops.hamzahotel.com';
const OPS_DB   = 'main';
const NCH_COMPANY_ID = 10;

const D1_DB = 'hn-hiring';
const D1_TARGET = (process.env.D1_TARGET || 'local').toLowerCase();
const D1_FLAGS = D1_TARGET === 'remote' ? '--remote' : '--local';

const FROM = process.env.BACKFILL_FROM || '2026-04-01';
const TO   = process.env.BACKFILL_TO   || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

async function odoo(model, method, args = [], kwargs = {}) {
  const body = {
    jsonrpc: '2.0', method: 'call',
    params: {
      service: 'object', method: 'execute_kw',
      args: [OPS_DB, parseInt(process.env.OPS_ODOO_UID || '2', 10), need('OPS_ODOO_KEY'), model, method, args, kwargs],
    },
  };
  const r = await fetch(`https://${OPS_HOST}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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

// Build a multi-statement SQL file and execute it once via wrangler d1 execute --file.
// One file per "phase" so we don't blow past wrangler's argv length limits.
async function execD1Sql(label, statements) {
  if (!statements.length) { console.log(`  ${label}: no rows`); return; }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-backfill-'));
  const file = path.join(tmpDir, `${label}.sql`);
  // SQLite multi-statement file: each must end with ; and a newline.
  fs.writeFileSync(file, statements.map(s => s.endsWith(';') ? s + '\n' : s + ';\n').join(''));
  try {
    const cmd = `npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --file ${JSON.stringify(file)}`;
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    console.log(`  ${label}: ${statements.length} stmts OK`);
  } finally {
    try { fs.unlinkSync(file); fs.rmdirSync(tmpDir); } catch {}
  }
}

async function step1_PosConfig() {
  console.log('[1/6] pos.config refresh');
  const cfgs = await odoo('pos.config', 'search_read',
    [[['company_id', '=', NCH_COMPANY_ID]]],
    { fields: ['id', 'name'] });
  const stmts = cfgs.map(c =>
    `INSERT INTO pos_config_registry (pos_config_id, brand, name, last_seen_at)
     VALUES (${c.id}, 'NCH', ${sqlEsc(c.name)}, ${sqlEsc(new Date().toISOString())})
     ON CONFLICT(pos_config_id) DO UPDATE SET name=excluded.name, last_seen_at=excluded.last_seen_at`);
  await execD1Sql('pos_config', stmts);
  return cfgs;
}

async function step2_PosOrders() {
  console.log(`[2/6] pos.order ${FROM} → ${TO}`);
  let cursor = 0;
  let total = 0;
  let allOrderIds = [];
  while (true) {
    const orders = await odoo('pos.order', 'search_read',
      [[['company_id', '=', NCH_COMPANY_ID],
        ['state', 'in', ['paid', 'done', 'invoiced', 'posted']],
        ['date_order', '>=', `${FROM} 00:00:00`],
        ['date_order', '<=', `${TO} 23:59:59`],
        ['id', '>', cursor]]],
      { fields: ['id', 'name', 'date_order', 'amount_total', 'amount_tax', 'state',
                 'company_id', 'session_id', 'config_id', 'payment_ids'],
        order: 'id asc', limit: 1000 });
    if (!orders.length) break;

    const allPmIds = [...new Set(orders.flatMap(o => o.payment_ids || []))];
    const pmRows = allPmIds.length
      ? await odoo('pos.payment', 'read', [allPmIds],
          { fields: ['id', 'pos_order_id', 'payment_method_id'] })
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
         VALUES (${o.id}, 'NCH', ${o.config_id?.[0] || 0}, ${o.session_id?.[0] ?? 'NULL'}, ${sqlEsc(o.name)},
                 ${sqlEsc(dateIst)}, ${sqlEsc(day)},
                 ${Math.round((o.amount_total || 0) * 100)}, ${Math.round((o.amount_tax || 0) * 100)},
                 ${sqlEsc(o.state)}, ${sqlEsc(csv)}, ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_order_id) DO UPDATE SET
           amount_total_paise=excluded.amount_total_paise,
           payment_methods_csv=excluded.payment_methods_csv,
           synced_at=excluded.synced_at`);
      allOrderIds.push(o.id);
    }
    await execD1Sql(`pos_orders_chunk_${cursor}`, stmts);
    total += orders.length;
    cursor = orders[orders.length - 1].id;
    if (orders.length < 1000) break;
  }
  console.log(`  ${total} orders mirrored`);
  return allOrderIds;
}

async function step3_PosPayments(orderIds) {
  console.log(`[3/6] pos.payment for ${orderIds.length} orders`);
  if (!orderIds.length) return;
  const orderMeta = await loadOrderMeta(orderIds);
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
         VALUES (${p.id}, ${oid}, 'NCH', ${sqlEsc(meta.day)}, ${meta.cfg},
                 ${p.payment_method_id?.[0] || 0}, ${sqlEsc(p.payment_method_id?.[1] || 'unknown')},
                 ${Math.round((p.amount || 0) * 100)}, ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_payment_id) DO UPDATE SET
           amount_paise=excluded.amount_paise, synced_at=excluded.synced_at`);
    }
    await execD1Sql(`pos_payments_chunk_${i}`, stmts);
  }
}

async function step4_PosLines(orderIds) {
  console.log(`[4/6] pos.order.line for ${orderIds.length} orders`);
  if (!orderIds.length) return;
  const orderMeta = await loadOrderMeta(orderIds);
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
         VALUES (${l.id}, ${oid}, 'NCH', ${sqlEsc(meta.day)}, ${meta.cfg},
                 ${l.product_id?.[0] || 0}, ${sqlEsc(l.product_id?.[1] || null)},
                 ${l.qty || 0}, ${Math.round((l.price_subtotal_incl || 0) * 100)},
                 ${sqlEsc(new Date().toISOString())})
         ON CONFLICT(odoo_pos_line_id) DO UPDATE SET
           qty=excluded.qty, price_subtotal_incl_paise=excluded.price_subtotal_incl_paise,
           synced_at=excluded.synced_at`);
    }
    await execD1Sql(`pos_lines_chunk_${i}`, stmts);
  }
}

// orderId → { day, cfg } lookup (memoised across step3+step4).
let _orderMetaCache = null;
async function loadOrderMeta(orderIds) {
  if (_orderMetaCache) return _orderMetaCache;
  // Load from D1 since step2 just wrote them. Use a single SELECT — wrangler
  // d1 execute --command with JSON output.
  const cmd = `npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --json --command ${JSON.stringify(
    `SELECT odoo_pos_order_id, pos_config_id, order_date_day FROM pos_orders_mirror WHERE brand='NCH'`
  )}`;
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const rows = parsed[0]?.results || [];
  _orderMetaCache = Object.fromEntries(rows.map(r => [r.odoo_pos_order_id, { day: r.order_date_day, cfg: r.pos_config_id }]));
  return _orderMetaCache;
}

async function step5_RazorpayQr() {
  console.log('[5/6] Razorpay QR poll');
  const cmd = `npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --json --command ${JSON.stringify(
    `SELECT qr_code_id, role FROM razorpay_qr_registry WHERE brand='NCH' AND active=1`
  )}`;
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  const qrs = JSON.parse(out)[0]?.results || [];
  if (!qrs.length) { console.log('  no QRs registered yet — skip (Slice C will surface a registration UI)'); return; }

  const auth = 'Basic ' + Buffer.from(`${need('RAZORPAY_KEY')}:${need('RAZORPAY_SECRET')}`).toString('base64');
  const fromTs = Math.floor(new Date(`${FROM}T00:00:00+05:30`).getTime() / 1000);
  const toTs   = Math.floor(new Date(`${TO}T23:59:59+05:30`).getTime() / 1000);

  for (const qr of qrs) {
    let skip = 0;
    let qrTotal = 0;
    while (true) {
      const url = `https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(qr.qr_code_id)}/payments?from=${fromTs}&to=${toTs}&count=100&skip=${skip}`;
      const r = await fetch(url, { headers: { Authorization: auth } });
      if (!r.ok) { console.error(`  qr ${qr.qr_code_id} HTTP ${r.status}`); break; }
      const j = await r.json();
      const items = j.items || [];
      if (!items.length) break;

      const stmts = items.map(p => {
        const capTs = p.captured_at || p.created_at;
        const isoCap = new Date(capTs * 1000).toISOString();
        const istDay = new Date(capTs * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        return `INSERT INTO razorpay_qr_collections (
           razorpay_payment_id, qr_code_id, brand, role,
           amount_paise, fee_paise, tax_paise, status, method,
           vpa, contact, captured_at, captured_at_day,
           synced_at, synced_via, raw_payload)
         VALUES (${sqlEsc(p.id)}, ${sqlEsc(qr.qr_code_id)}, 'NCH', ${sqlEsc(qr.role)},
                 ${p.amount || 0}, ${p.fee || 0}, ${p.tax || 0},
                 ${sqlEsc(p.status || 'unknown')}, ${sqlEsc(p.method || null)},
                 ${sqlEsc(p.vpa || null)}, ${sqlEsc(p.contact || null)},
                 ${sqlEsc(isoCap)}, ${sqlEsc(istDay)},
                 ${sqlEsc(new Date().toISOString())}, 'rest_poll',
                 ${sqlEsc(JSON.stringify(p).slice(0, 8000))})
         ON CONFLICT(razorpay_payment_id) DO UPDATE SET
           amount_paise=excluded.amount_paise, status=excluded.status, synced_at=excluded.synced_at`;
      });
      await execD1Sql(`rzp_${qr.qr_code_id}_${skip}`, stmts);
      qrTotal += items.length;
      if (items.length < 100) break;
      skip += 100;
    }
    console.log(`  qr ${qr.qr_code_id} (${qr.role}): ${qrTotal} payments`);
  }
}

async function step6_ReconDaily() {
  console.log(`[6/6] sales_recon_daily ${FROM} → ${TO}`);
  // For each day, read mirrored payments + qr collections + orders and
  // compute the row in JS. Delegate the math to a single SELECT per day
  // for portability — cheap because indexes hit.
  const days = [];
  let d = new Date(`${FROM}T00:00:00Z`).getTime();
  const last = new Date(`${TO}T00:00:00Z`).getTime();
  while (d <= last) { days.push(new Date(d).toISOString().slice(0, 10)); d += 86400 * 1000; }

  for (const day of days) {
    const select = `SELECT json_object('pm', json_group_object(payment_method_name, p)) AS pm
      FROM (SELECT payment_method_name, SUM(amount_paise) AS p FROM pos_payments_mirror
             WHERE brand='NCH' AND order_date_day=${sqlEsc(day)} GROUP BY payment_method_name)`;
    // D1's json_group_object is supported. We split into 3 reads for
    // simplicity in this script (script doesn't need to be subrequest-cheap).
    const pmJson = await d1Json(`SELECT payment_method_name, SUM(amount_paise) AS p FROM pos_payments_mirror WHERE brand='NCH' AND order_date_day=${sqlEsc(day)} GROUP BY payment_method_name`);
    const qrJson = await d1Json(`SELECT role, SUM(amount_paise) AS p FROM razorpay_qr_collections WHERE brand='NCH' AND captured_at_day=${sqlEsc(day)} AND status='captured' GROUP BY role`);
    const ordJson = await d1Json(`SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') NOT LIKE '%Complimentary%' THEN amount_total_paise ELSE 0 END), 0) AS gross,
        COALESCE(SUM(CASE WHEN COALESCE(payment_methods_csv,'') LIKE '%Complimentary%' THEN amount_total_paise ELSE 0 END), 0) AS comp
        FROM pos_orders_mirror WHERE brand='NCH' AND order_date_day=${sqlEsc(day)}`);

    const pm = (n) => pmJson.find(r => r.payment_method_name === n)?.p || 0;
    const qr = (r) => qrJson.find(x => x.role === r)?.p || 0;
    const RECOGNISED = new Set(['NCH Cash','NCH UPI','NCH Card','NCH Runner Ledger','NCH Token Issue','Complimentary','Cash','UPI']);
    const unmapped = pmJson.filter(r => !RECOGNISED.has(r.payment_method_name)).reduce((s, r) => s + (r.p || 0), 0);

    const counter_cash    = pm('NCH Cash') + pm('Cash');
    const counter_upi_pos = pm('NCH UPI')  + pm('UPI');
    const counter_upi_rzp = qr('counter');
    const counter_card    = pm('NCH Card');
    const runner_sales    = pm('NCH Runner Ledger') + pm('NCH Token Issue');
    const runner_upi      = qr('runner');
    const runner_cash     = Math.max(0, runner_sales - runner_upi);
    const total_cash      = counter_cash + runner_cash;
    const total_upi       = counter_upi_rzp + runner_upi;
    const upi_discrepancy = counter_upi_pos - counter_upi_rzp;
    const ord = ordJson[0] || {};

    const stmt = `INSERT INTO sales_recon_daily (
        brand, day, gross_sales_paise,
        counter_cash_paise, counter_upi_pos_paise, counter_upi_rzp_paise, counter_card_paise,
        runner_sales_paise, runner_upi_paise, runner_cash_paise,
        total_cash_paise, total_upi_paise, upi_discrepancy_paise,
        complimentary_paise, unmapped_paise, order_count, last_recomputed_at)
      VALUES ('NCH', ${sqlEsc(day)}, ${ord.gross || 0},
              ${counter_cash}, ${counter_upi_pos}, ${counter_upi_rzp}, ${counter_card},
              ${runner_sales}, ${runner_upi}, ${runner_cash},
              ${total_cash}, ${total_upi}, ${upi_discrepancy},
              ${ord.comp || 0}, ${unmapped}, ${ord.n || 0},
              ${sqlEsc(new Date().toISOString())})
      ON CONFLICT(brand, day) DO UPDATE SET
        gross_sales_paise=excluded.gross_sales_paise,
        counter_cash_paise=excluded.counter_cash_paise,
        counter_upi_pos_paise=excluded.counter_upi_pos_paise,
        counter_upi_rzp_paise=excluded.counter_upi_rzp_paise,
        counter_card_paise=excluded.counter_card_paise,
        runner_sales_paise=excluded.runner_sales_paise,
        runner_upi_paise=excluded.runner_upi_paise,
        runner_cash_paise=excluded.runner_cash_paise,
        total_cash_paise=excluded.total_cash_paise,
        total_upi_paise=excluded.total_upi_paise,
        upi_discrepancy_paise=excluded.upi_discrepancy_paise,
        complimentary_paise=excluded.complimentary_paise,
        unmapped_paise=excluded.unmapped_paise,
        order_count=excluded.order_count,
        last_recomputed_at=excluded.last_recomputed_at`;
    await execD1Sql(`recon_${day}`, [stmt]);
  }
  console.log(`  ${days.length} days recomputed`);
}

async function d1Json(sql) {
  const cmd = `npx wrangler d1 execute ${D1_DB} ${D1_FLAGS} --json --command ${JSON.stringify(sql)}`;
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out)[0]?.results || [];
}

async function main() {
  loadEnvLocal();
  console.log(`[backfill] D1 target=${D1_TARGET}  range=${FROM}→${TO}`);
  await step1_PosConfig();
  const orderIds = await step2_PosOrders();
  await step3_PosPayments(orderIds);
  await step4_PosLines(orderIds);
  await step5_RazorpayQr();
  await step6_ReconDaily();

  console.log('\n[backfill] done. Quick verification:');
  const counts = await d1Json(
    `SELECT (SELECT COUNT(*) FROM pos_orders_mirror WHERE brand='NCH') AS orders,
            (SELECT COUNT(*) FROM pos_payments_mirror WHERE brand='NCH') AS payments,
            (SELECT COUNT(*) FROM pos_lines_mirror WHERE brand='NCH') AS lines,
            (SELECT COUNT(*) FROM razorpay_qr_collections WHERE brand='NCH') AS rzp_payments,
            (SELECT COUNT(*) FROM sales_recon_daily WHERE brand='NCH') AS recon_days`);
  console.log(JSON.stringify(counts[0], null, 2));
}

main().catch(e => { console.error('[backfill] fatal:', e.stack || e.message); process.exit(1); });
