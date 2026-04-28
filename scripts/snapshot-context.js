#!/usr/bin/env node
/**
 * snapshot-context.js — pull fresh business state into data/snapshots/.
 *
 * Why this exists: iPhone Claude Code is sandboxed and cannot reach our
 * private domains. Owner runs this on laptop; the JSON outputs get committed;
 * iPhone sessions read those instead of trying to fetch live.
 *
 * Run:  node scripts/snapshot-context.js
 *
 * Reads .env.local (gitignored) for tokens. Required keys:
 *   DASHBOARD_API_KEY   — for hnhotels.in/api/aggregator-pulse
 *   TEST_ODOO_KEY       — Odoo API key for test.hamzahotel.com (HE prod)
 *   TEST_ODOO_UID       — uid (default 2)
 *   OPS_ODOO_KEY        — Odoo API key for ops.hamzahotel.com (NCH prod)
 *   OPS_ODOO_UID        — uid (default 2)
 *
 * Writes to data/snapshots/:
 *   aggregator-latest.json
 *   sales-daily-last60d.json
 *   google-ads-latest.json
 *   meta-ctwa-latest.json
 *   waba-leads-latest.json
 *   snapshot-meta.json
 *
 * Idempotent — re-running overwrites the JSONs with fresh data.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'data', 'snapshots');
const ENV_FILE = path.join(ROOT, '.env.local');

// ─── env loader (no dotenv dep) ────────────────────────────────────────────

function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn(`[env] ${ENV_FILE} not found — relying on process.env only.`);
    return;
  }
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgoIso(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d);
}
const TODAY = isoDate(new Date());
const FROM_60D = daysAgoIso(60);

function writeJson(name, data) {
  const file = path.join(SNAP_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function pickRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} (add to .env.local)`);
  return v;
}

async function fetchJson(url, opts = {}, label = '') {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${label || url} → HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function odooRpc({ host, db, uid, key, model, method, args = [], kwargs = {} }) {
  const body = {
    jsonrpc: '2.0', method: 'call',
    params: {
      service: 'object', method: 'execute_kw',
      args: [db, uid, key, model, method, args, kwargs],
    },
  };
  const r = await fetch(`https://${host}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.error) {
    const msg = d.error.data?.message || d.error.message || 'odoo error';
    throw new Error(`${host} ${model}.${method}: ${msg}`);
  }
  return d.result;
}

// ─── source pulls ──────────────────────────────────────────────────────────

async function pullAggregator() {
  const key = pickRequired('DASHBOARD_API_KEY');
  const base = 'https://hnhotels.in/api/aggregator-pulse';
  const headers = { 'x-api-key': key };

  const [orders, finance, latest, health, stats] = await Promise.all([
    fetchJson(`${base}?action=orders&date=month`, { headers }, 'aggregator orders').catch(e => ({ error: e.message })),
    fetchJson(`${base}?action=finance`,           { headers }, 'aggregator finance').catch(e => ({ error: e.message })),
    fetchJson(`${base}?action=latest`,            { headers }, 'aggregator latest').catch(e => ({ error: e.message })),
    fetchJson(`${base}?action=health`,            { headers }, 'aggregator health').catch(e => ({ error: e.message })),
    fetchJson(`${base}?action=stats`,             { headers }, 'aggregator stats').catch(e => ({ error: e.message })),
  ]);

  return {
    captured_at: new Date().toISOString(),
    source: base,
    window: { from: daysAgoIso(30), to: TODAY },
    orders, finance, latest, health, stats,
  };
}

/**
 * Pull pos.order from one Odoo instance, last 60 days. Aggregate to
 * { date, brand, channel, orders, gross, net, count } daily rows.
 *
 * Channel inference: we read pos.payment.method.id->name on each order's
 * payment_ids. Whatever journal name appears (e.g. "Cash", "Razorpay",
 * "Zomato", "Swiggy", "Token Issue") becomes the channel. Owner
 * reclassifies in analysis if needed.
 */
async function pullPosBrand({ host, db, uid, key, brand, label }) {
  // Dial down: just pos.order rows in date window. We don't need lines for
  // daily totals.
  const orders = await odooRpc({
    host, db, uid, key,
    model: 'pos.order', method: 'search_read',
    args: [
      [['date_order', '>=', `${FROM_60D} 00:00:00`],
       ['date_order', '<=', `${TODAY} 23:59:59`],
       ['state', 'in', ['paid', 'done', 'invoiced']]],
    ],
    kwargs: {
      fields: ['id', 'name', 'date_order', 'amount_total', 'amount_paid',
               'amount_tax', 'company_id', 'session_id', 'payment_ids'],
      limit: 50000,
    },
  });

  // Pull payments separately so we can attribute channels.
  const paymentIds = [...new Set(orders.flatMap(o => o.payment_ids || []))];
  let payments = [];
  if (paymentIds.length) {
    // chunk to keep request size sane
    const chunkSize = 2000;
    for (let i = 0; i < paymentIds.length; i += chunkSize) {
      const chunk = paymentIds.slice(i, i + chunkSize);
      const part = await odooRpc({
        host, db, uid, key,
        model: 'pos.payment', method: 'read',
        args: [chunk],
        kwargs: { fields: ['id', 'pos_order_id', 'amount', 'payment_method_id'] },
      });
      payments.push(...part);
    }
  }

  // Map payment_method_id (display name) per pos.payment row.
  const byOrder = new Map();
  for (const p of payments) {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    const method = Array.isArray(p.payment_method_id) ? p.payment_method_id[1] : 'unknown';
    if (!byOrder.has(orderId)) byOrder.set(orderId, []);
    byOrder.get(orderId).push({ method, amount: p.amount });
  }

  // Roll up daily.
  const daily = new Map();   // key: date|channel
  let unmappedOrders = 0;
  for (const o of orders) {
    const date = (o.date_order || '').slice(0, 10);
    const pays = byOrder.get(o.id) || [];
    if (!pays.length) {
      unmappedOrders++;
      const k = `${date}|UNKNOWN`;
      const row = daily.get(k) || { date, channel: 'UNKNOWN', orders: 0, gross: 0 };
      row.orders++;
      row.gross += o.amount_total || 0;
      daily.set(k, row);
      continue;
    }
    // Each payment line counts toward that channel; order count attributed
    // to the channel of the payment line with the largest amount.
    const dominant = pays.slice().sort((a, b) => b.amount - a.amount)[0];
    for (const p of pays) {
      const k = `${date}|${p.method}`;
      const row = daily.get(k) || { date, channel: p.method, orders: 0, gross: 0 };
      if (p === dominant) row.orders++;
      row.gross += p.amount || 0;
      daily.set(k, row);
    }
  }

  const rows = [...daily.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));

  // Channel-name registry observed in this pull (handy for reclassification).
  const channelsSeen = [...new Set(rows.map(r => r.channel))].sort();

  return {
    brand, label, host,
    window: { from: FROM_60D, to: TODAY },
    order_count: orders.length,
    payment_lines: payments.length,
    unmapped_orders: unmappedOrders,
    channels_seen: channelsSeen,
    daily: rows,
  };
}

async function pullSalesDaily() {
  const out = { captured_at: new Date().toISOString(), brands: {} };

  // HE — test.hamzahotel.com
  try {
    out.brands.HE = await pullPosBrand({
      host: 'test.hamzahotel.com',
      db: 'main',
      uid: parseInt(process.env.TEST_ODOO_UID || '2', 10),
      key: pickRequired('TEST_ODOO_KEY'),
      brand: 'HE',
      label: 'Hamza Express (test.hamzahotel.com — HE prod)',
    });
  } catch (e) {
    out.brands.HE = { error: e.message };
  }

  // NCH — ops.hamzahotel.com
  try {
    out.brands.NCH = await pullPosBrand({
      host: 'ops.hamzahotel.com',
      db: 'main',
      uid: parseInt(process.env.OPS_ODOO_UID || '2', 10),
      key: pickRequired('OPS_ODOO_KEY'),
      brand: 'NCH',
      label: 'Nawabi Chai House (ops.hamzahotel.com — NCH prod)',
    });
  } catch (e) {
    out.brands.NCH = { error: e.message };
  }

  return out;
}

async function pullGoogleAds() {
  const url = 'https://hamzaexpress.in/api/google-cockpit?period=30d';
  const data = await fetchJson(url, {}, 'google-cockpit').catch(e => ({ error: e.message }));
  return { captured_at: new Date().toISOString(), source: url, data };
}

async function pullMetaCtwa() {
  const url = 'https://hamzaexpress.in/api/ctwa-analytics?period=30d';
  const data = await fetchJson(url, {}, 'ctwa-analytics').catch(e => ({ error: e.message }));
  return { captured_at: new Date().toISOString(), source: url, data };
}

async function pullWabaLeads() {
  const base = 'https://hamzaexpress.in/api/leads';
  const [counts, list] = await Promise.all([
    fetchJson(`${base}?action=counts`, {}, 'leads counts').catch(e => ({ error: e.message })),
    fetchJson(`${base}?limit=200`, {}, 'leads list').catch(e => ({ error: e.message })),
  ]);
  return { captured_at: new Date().toISOString(), source: base, counts, list };
}

// ─── orchestration ─────────────────────────────────────────────────────────

function recordCount(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return obj.length;
  // aggregator: orders.total_orders or orders.orders
  if (obj.orders?.total_orders != null) return obj.orders.total_orders;
  if (Array.isArray(obj.orders?.orders)) return obj.orders.orders.length;
  // sales: brands.HE.order_count + brands.NCH.order_count
  if (obj.brands && typeof obj.brands === 'object') {
    let n = 0;
    for (const b of Object.values(obj.brands)) n += b?.order_count || 0;
    return n || null;
  }
  // waba leads: list.leads
  if (Array.isArray(obj.list?.leads)) return obj.list.leads.length;
  // google ads / meta ctwa
  if (obj.data?.overview) return Object.keys(obj.data.overview).length;
  return null;
}

async function main() {
  loadEnvLocal();
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

  console.log(`[snapshot] start · ${new Date().toISOString()}`);
  console.log(`[snapshot] window: ${FROM_60D} → ${TODAY}`);

  const tasks = [
    { key: 'aggregator',  file: 'aggregator-latest.json',     fn: pullAggregator  },
    { key: 'sales',       file: 'sales-daily-last60d.json',   fn: pullSalesDaily  },
    { key: 'google_ads',  file: 'google-ads-latest.json',     fn: pullGoogleAds   },
    { key: 'meta_ctwa',   file: 'meta-ctwa-latest.json',      fn: pullMetaCtwa    },
    { key: 'waba_leads',  file: 'waba-leads-latest.json',     fn: pullWabaLeads   },
  ];

  const results = await Promise.allSettled(tasks.map(t => t.fn()));

  const meta = {
    generated_at: new Date().toISOString(),
    window: { from: FROM_60D, to: TODAY },
    sources: {},
    files: [],
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      const file = writeJson(t.file, r.value);
      const records = recordCount(r.value);
      meta.sources[t.key] = { ok: true, records };
      meta.files.push({ file: t.file, ok: true, records });
      console.log(`  ✓ ${t.file}${records !== null ? ` (${records} records)` : ''}`);
    } else {
      const err = { ok: false, error: String(r.reason && r.reason.message || r.reason) };
      writeJson(t.file, { captured_at: new Date().toISOString(), ...err });
      meta.sources[t.key] = err;
      meta.files.push({ file: t.file, ok: false, error: err.error });
      console.error(`  ✗ ${t.file} — ${err.error}`);
    }
  }

  writeJson('snapshot-meta.json', meta);
  console.log(`[snapshot] done · wrote ${tasks.length + 1} files to data/snapshots/`);
}

main().catch(err => {
  console.error('[snapshot] fatal:', err.stack || err.message);
  process.exit(1);
});
