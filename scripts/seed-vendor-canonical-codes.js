#!/usr/bin/env node
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * seed-vendor-canonical-codes.js
 *
 * Pulls NCH vendors (last 365d) from odoo.hnhotels.in, applies the
 * canonical-code inference rubrics, and POSTs each vendor to
 * https://hnhotels.in/api/vendors?action=create.
 *
 * Emits a markdown audit report at /tmp/vendor_seed_report.md (also
 * mirrored to docs/Vendor-Seed-Report-2026-05-09.md).
 *
 * Grammar: {PAY_SEQ}-{SELLS}-{OPM}-{PMS}-{IDENTITY}
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE_LOCAL = path.join(ROOT, '.env.local');
const ENV_FILE_PARENT = '/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local';
const REPORT_TMP = '/tmp/vendor_seed_report.md';
const REPORT_REPO = path.join(ROOT, 'docs', 'Vendor-Seed-Report-2026-05-09.md');

const PROD_BASE = 'https://hnhotels.in';
const PROD_PIN = '0305';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vendor-seed-script';

function loadEnvLocal() {
  for (const file of [ENV_FILE_LOCAL, ENV_FILE_PARENT]) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    return file;
  }
  return null;
}

function pickRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgoIso(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }

async function odooRpc({ host, db, uid, key, model, method, args = [], kwargs = {} }) {
  const body = {
    jsonrpc: '2.0', method: 'call',
    params: { service: 'object', method: 'execute_kw',
      args: [db, uid, key, model, method, args, kwargs] },
  };
  const r = await fetch(`https://${host}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.error) throw new Error(`${host} ${model}.${method}: ${d.error.data?.message || d.error.message}`);
  return d.result;
}

/* ─── Same RM map + rules as build-vendor-mapping-worksheet.js ─── */
const NAME_RULES = [
  [['saffron', 'kesar'], 'NCH-AM-P-Lb-SAF'],
  [['badam powder', 'badam pwd'], 'NCH-AM-P-Lb-BDM'],
  [['almond', 'badam'], 'HN-AM-P-Lb-ALM'],
  [['custard'], 'NCH-AM-P-Lb-CUS'],
  [['milkmaid', 'condensed milk'], 'NCH-AM-P-B-MMD'],
  [['skimmed milk', 'smp', 'milk powder'], 'NCH-AM-P-Bl-SMP'],
  [['buffalo milk', 'milk -', 'fresh milk', 'cow milk', 'liquid milk'], 'NCH-AM-P-Lb-MLK'],
  [['milk'], 'NCH-AM-P-Lb-MLK'],
  [['tea powder', 'tea -', 'chai powder', 'dust tea'], 'NCH-AM-Pr-Bl-TEA'],
  [['bottled water', 'mineral water', 'aquafina', 'kinley', 'bisleri', 'filter water', 'drinking water'], 'NCH-AM-P-B-WTR'],
  [['sabja', 'basil seed'], 'NCH-AM-P-L-SBJ'],
  [['chocolate powder', 'cocoa powder', 'choco powder'], 'NCH-AM-P-B-CHC'],
  [['chicken cutlet'], 'NCH-AS-P-Li-CCT'],
  [['chicken bite', 'chicken nugget'], 'NCH-AS-P-Li-CHB'],
  [['samosa', 'samoosa'], 'NCH-AS-P-Li-SMS'],
  [['bun', 'pao'], 'NCH-AS-P-Lbi-BUN'],
  [['pumpkin seed'], 'NCH-AS-P-Lb-PMK'],
  [['honey'], 'NCH-AS-P-Lb-HNY'],
  [['horlicks'], 'NCH-AS-P-B-HRK'],
  [['boost'], 'NCH-AS-P-B-BST'],
  [['jam'], 'NCH-AS-P-B-JAM'],
  [['nutella', 'choco spread'], 'NCH-AS-P-B-NUT'],
  [['osmania', 'osmaniya'], 'NCH-DM-Pr-Bl-OSB'],
  [['butter almond cookie'], 'NCH-DM-R-B-BAC'],
  [['choco chip', 'choco chips'], 'NCH-DM-R-B-CCO'],
  [['double choco'], 'NCH-DM-R-B-DCC'],
  [['dry fruit biscuit'], 'NCH-DM-R-B-DFB'],
  [['fruit biscuit'], 'NCH-DM-R-B-FRB'],
  [['honey oats'], 'NCH-DM-R-B-HOB'],
  [['multi grain biscuit', 'multigrain biscuit'], 'NCH-DM-R-B-MGB'],
  [['melting moment'], 'NCH-DM-R-B-MMB'],
  [['round plum'], 'NCH-DM-R-B-RPL'],
  [['salt biscuit'], 'NCH-DM-R-B-SLB'],
  [['coffee pouch', 'instant coffee', 'coffee'], 'NCH-DS-P-B-CPP'],
  [['assorted cookie'], 'NCH-DS-R-B-ACG'],
  [['almond stick'], 'NCH-DS-R-B-AST'],
  [['atta biscuit'], 'NCH-DS-R-B-ATB'],
  [['cherry khopra', 'khopra'], 'NCH-DS-R-B-CHK'],
  [['coconut biscuit'], 'NCH-DS-R-B-COB'],
  [['dum ka roat', 'dum-ka-roat'], 'NCH-DS-R-B-DKR'],
  [['multi grain ragi', 'multigrain ragi'], 'NCH-DS-R-B-MGR'],
  [['oatmeal cookie'], 'NCH-DS-R-B-OMC'],
  [['palmier'], 'NCH-DS-R-B-PLM'],
  [['ragi biscuit'], 'NCH-DS-R-B-RGB'],
  [['sugar', 'cheeni'], 'HN-AM-P-Lb-SUG'],
  [['sooji', 'soji', 'rava', 'semolina'], 'HN-AM-P-Lb-SOJ'],
  [['maida', 'flour'], 'HN-AM-P-Lb-MDA'],
  [['saunf', 'fennel'], 'HN-AM-P-Lb-SAU'],
  [['kaju', 'cashew'], 'HN-AM-P-Lb-KAJ'],
  [['cardamom', 'elaichi'], 'HN-AM-P-Lb-CAR'],
  [['oil', 'tel'], 'HN-AM-P-Lb-OIL'],
  [['butter'], 'HN-AM-P-Bl-BTR'],
  [['soda'], 'HN-AM-P-B-SOD'],
  [['lpg', 'gas cylinder', 'cooking gas'], 'HN-AM-O-B-LPG'],
  [['charcoal', 'koyla'], 'HN-AM-P-L-CHL'],
  [['ginger', 'adrak'], 'HN-AM-P-L-GIN'],
];

function matchRm(productName) {
  const lower = (productName || '').toLowerCase();
  for (const [keywords, code] of NAME_RULES) {
    for (const kw of keywords) if (lower.includes(kw)) return code;
  }
  return null;
}

/* ─── Identity derivation ─── */
function deriveIdentity(vendorName) {
  if (!vendorName) return 'UNKNOWN';
  let s = vendorName
    .replace(/\b(M\.?S\.?|M\/S|Sri|Shri|Mr\.?|Smt\.?|Pvt\.?|Ltd\.?|LLP|Inc\.?|Co\.?|Bros\.?|Brothers|Trader[s]?|Enterprises?|Stores?|Distributor[s]?|Agencies|Agency|Suppliers?|Vendor[s]?|Foods?|Departmental|Department)\b/gi, ' ')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = vendorName;
  const first = (s.split(/\s+/)[0] || vendorName).toUpperCase();
  // Cap 3-10 chars; if first word is too short, try concatenating
  if (first.length >= 3) return first.slice(0, 10);
  // Build from concatenation if too short
  const all = s.split(/\s+/).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return all.slice(0, 10) || 'VENDOR';
}

/* ─── Inference rubrics ─── */
const APP_HINTS = ['zepto', 'blinkit', 'hyperpure', 'bigbasket', 'instamart', 'dunzo', 'amazon', 'flipkart', 'jiomart', 'online', 'app', '.com'];

function inferPaySeq(vendor, billCount, poCount) {
  const name = (vendor.name || '').toLowerCase();
  if (APP_HINTS.some(h => name.includes(h))) return { seq: 'Pf', note: 'app/quick-commerce → prepaid' };
  // Has bills + paid → Rf
  if (billCount > 0) return { seq: 'Rf', note: `${billCount} bills on file` };
  // Many POs, no bills → daily route cash, treat as Rf (received then paid same day)
  if (poCount >= 5) return { seq: 'Rf', note: `${poCount} POs, 0 bills — likely daily-route cash` };
  // Small handful of POs, no bills — could be walk-in but default Rf
  return { seq: 'Rf', note: `${poCount} POs, 0 bills — default Rf` };
}

function inferSells(rmCodes, hasUnmapped) {
  if (rmCodes.length === 0) {
    return { sells: 'L', note: 'no RM mapping yet — defaulted to L' };
  }
  let hasL = false, hasB = false;
  for (const code of rmCodes) {
    const parts = code.split('-');
    if (parts.length !== 5) continue;
    const sourcing = parts[3];
    const primary = sourcing[0];
    const alts = sourcing.slice(1).toUpperCase();
    if (primary === 'L' || alts.includes('L')) hasL = true;
    if (primary === 'B' || alts.includes('B')) hasB = true;
  }
  // v8: case-encoded primary + alt. Default primary = whichever side has more
  // RM occurrences; here we have only the boolean presence so default to Lb
  // (loose primary). Owner can flip to Bl via the editor.
  if (hasL && hasB) return { sells: 'Lb', note: `mixed loose+branded across ${rmCodes.length} RMs (default Lb; flip to Bl in editor if branded dominates)` };
  if (hasB) return { sells: 'B', note: `branded supply (${rmCodes.length} RMs)` };
  if (hasL) return { sells: 'L', note: `loose supply (${rmCodes.length} RMs)` };
  return { sells: 'L', note: 'fallback' };
}

function inferOpm(vendorName) {
  const lower = (vendorName || '').toLowerCase();
  if (APP_HINTS.some(h => lower.includes(h))) return { opm: 'A', note: 'app/web platform' };
  return { opm: 'M', note: 'traditional vendor (call/WA/walk-in/route)' };
}

function inferPms(vendorName, billCount) {
  const lower = (vendorName || '').toLowerCase();
  // Quick commerce / online → B
  if (APP_HINTS.some(h => lower.includes(h))) return { pms: 'B', note: 'digital platform — bank/UPI only' };
  // No bills + traditional → C
  if (billCount === 0) return { pms: 'C', note: 'no bills on file → cash assumed' };
  // Has bills → Cb (some digital, mostly cash)
  return { pms: 'Cb', note: `${billCount} bills suggest hybrid` };
}

function computeConfidence(paySeqInf, sellsInf, opmInf, pmsInf, vendorName, hasRmMatch) {
  const lower = (vendorName || '').toLowerCase();
  // High confidence: app vendor (clear PMS=B) OR clear data signals
  const isApp = APP_HINTS.some(h => lower.includes(h));
  if (isApp) return 'HIGH';
  // High confidence: traditional vendor with strong RM coverage + bills (so we know sells + pms reasonably)
  // Default for traditional + no bills + RMs match → MEDIUM (PMS uncertain — owner needs to confirm UPI capability)
  if (!hasRmMatch) return 'LOW'; // unmapped products mean SELLS guess is weak
  // Has RM match, traditional, no bills → MEDIUM (PMS=C is best guess)
  return 'MEDIUM';
}

/* ─── HTTP helper ─── */
async function postCreate(payload) {
  const url = `${PROD_BASE}/api/vendors?pin=${PROD_PIN}&action=create`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(payload),
  });
  const status = r.status;
  let body = null;
  try { body = await r.json(); } catch (_) { body = { error: 'non-json response' }; }
  return { status, body };
}

async function getVendorCount() {
  const r = await fetch(`${PROD_BASE}/api/vendors?pin=${PROD_PIN}`, {
    headers: { 'User-Agent': UA },
  });
  return r.json();
}

/* ─── main ─── */
async function main() {
  loadEnvLocal();
  const ODOO_BASE = pickRequired('ODOO_BASE');
  const ODOO_DB = process.env.ODOO_DB || 'main';
  const ODOO_UID = parseInt(process.env.ODOO_UID || '2', 10);
  const ODOO_API_KEY = pickRequired('ODOO_API_KEY');
  const host = ODOO_BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const NCH_CO_ID = 3;
  const FROM_DATE = daysAgoIso(365);

  console.log(`[odoo] host=${host} co=${NCH_CO_ID} from=${FROM_DATE}`);

  // 0) Production sanity
  console.log('[step 0/5] production vendor count');
  const startCount = await getVendorCount();
  console.log(`  → existing vendors: ${startCount.count}`);
  if (startCount.count > 0) {
    console.error('REFUSING: production already has vendors. Aborting to avoid double-seed.');
    console.error('Existing:', startCount.vendors.map(v => v.vendor_code));
    process.exit(2);
  }

  const rpc = (model, method, args = [], kwargs = {}) =>
    odooRpc({ host, db: ODOO_DB, uid: ODOO_UID, key: ODOO_API_KEY, model, method, args, kwargs });

  console.log('[step 1/5] purchase.order');
  const pos = await rpc('purchase.order', 'search_read', [
    [['company_id', '=', NCH_CO_ID], ['date_order', '>=', `${FROM_DATE} 00:00:00`]]
  ], { fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state'], limit: 5000 });

  console.log('[step 2/5] purchase.order.line');
  const poIds = pos.map(o => o.id);
  const lines = [];
  for (let i = 0; i < poIds.length; i += 500) {
    const slice = poIds.slice(i, i + 500);
    const part = await rpc('purchase.order.line', 'search_read',
      [[['order_id', 'in', slice]]],
      { fields: ['id', 'order_id', 'product_id', 'name', 'product_qty', 'price_unit', 'price_subtotal'], limit: 50000 });
    lines.push(...part);
  }

  console.log('[step 3/5] account.move (vendor bills)');
  const bills = await rpc('account.move', 'search_read', [
    [['company_id', '=', NCH_CO_ID], ['move_type', '=', 'in_invoice'], ['invoice_date', '>=', FROM_DATE]]
  ], { fields: ['id', 'partner_id', 'invoice_date', 'amount_total', 'payment_state', 'state'], limit: 5000 });

  console.log('[step 4/5] res.partner');
  const partnerIds = [...new Set(pos.map(o => o.partner_id?.[0]).filter(Boolean))];
  const partners = await rpc('res.partner', 'search_read',
    [[['id', 'in', partnerIds]]],
    { fields: ['id', 'name', 'phone', 'email', 'property_payment_term_id', 'street', 'city'], limit: 1000 });

  // Aggregate
  const linesByOrder = new Map();
  for (const l of lines) {
    if (!l.order_id) continue;
    const oid = l.order_id[0];
    if (!linesByOrder.has(oid)) linesByOrder.set(oid, []);
    linesByOrder.get(oid).push(l);
  }

  const billsByPartner = new Map();
  for (const b of bills) {
    const pid = b.partner_id?.[0];
    if (!pid) continue;
    billsByPartner.set(pid, (billsByPartner.get(pid) || 0) + 1);
  }

  const byVendor = new Map();
  for (const p of partners) {
    byVendor.set(p.id, {
      vendor: p,
      poCount: 0, poTotal: 0,
      products: new Map(),
      rmAgg: new Map(),
      unmapped: new Map(),
      billCount: billsByPartner.get(p.id) || 0,
    });
  }

  for (const o of pos) {
    const vid = o.partner_id?.[0];
    if (!vid || !byVendor.has(vid)) continue;
    const v = byVendor.get(vid);
    v.poCount += 1;
    v.poTotal += o.amount_total || 0;
    const olines = linesByOrder.get(o.id) || [];
    for (const l of olines) {
      const pid = l.product_id?.[0];
      const pname = l.product_id?.[1] || l.name || '';
      if (!pid) continue;
      const rm = matchRm(pname);
      if (rm) {
        if (!v.rmAgg.has(rm)) v.rmAgg.set(rm, { qty: 0, total: 0, count: 0, names: new Set() });
        const re = v.rmAgg.get(rm);
        re.qty += l.product_qty || 0;
        re.total += l.price_subtotal || 0;
        re.count += 1;
        re.names.add(pname);
      } else {
        const key = pname || `pid-${pid}`;
        if (!v.unmapped.has(key)) v.unmapped.set(key, 0);
        v.unmapped.set(key, v.unmapped.get(key) + 1);
      }
    }
  }

  const rows = [];
  for (const [vid, v] of byVendor.entries()) {
    if (v.poCount === 0) continue;
    const rmCodes = [...v.rmAgg.keys()];
    const hasUnmapped = v.unmapped.size > 0;
    const hasRmMatch = rmCodes.length > 0;
    const paySeqInf = inferPaySeq(v.vendor, v.billCount, v.poCount);
    const sellsInf  = inferSells(rmCodes, hasUnmapped);
    const opmInf    = inferOpm(v.vendor.name);
    const pmsInf    = inferPms(v.vendor.name, v.billCount);
    const confidence = computeConfidence(paySeqInf, sellsInf, opmInf, pmsInf, v.vendor.name, hasRmMatch);
    rows.push({
      odoo_id: vid,
      vendor_name: v.vendor.name || '',
      phone: v.vendor.phone || '',
      city:  v.vendor.city || '',
      identity: deriveIdentity(v.vendor.name),
      po_count: v.poCount,
      po_total_paise: Math.round((v.poTotal || 0) * 100),
      bill_count: v.billCount,
      rm_agg: rmCodes.map(rm => ({ rm_code: rm, po_count: v.rmAgg.get(rm).count })).sort((a,b)=>b.po_count-a.po_count),
      unmapped: [...v.unmapped.entries()].map(([n,c]) => ({ name: n, count: c })).sort((a,b)=>b.count-a.count).slice(0, 4),
      pay_seq: paySeqInf,
      sells:   sellsInf,
      opm:     opmInf,
      pms:     pmsInf,
      confidence,
    });
  }
  rows.sort((a,b) => b.po_count - a.po_count);

  // Resolve identity collisions
  const idCount = new Map();
  for (const r of rows) {
    idCount.set(r.identity, (idCount.get(r.identity) || 0) + 1);
  }
  const idSeen = new Map();
  for (const r of rows) {
    if (idCount.get(r.identity) > 1) {
      const n = (idSeen.get(r.identity) || 0) + 1;
      idSeen.set(r.identity, n);
      // append digit; ensure within 10 chars
      const base = r.identity.slice(0, 9);
      r.identity = `${base}${n}`;
      r.identity_collision = true;
    }
  }

  // POST each
  console.log(`[step 5/5] POSTing ${rows.length} vendors...`);
  const results = [];
  for (const r of rows) {
    const rmsList = r.rm_agg.length
      ? r.rm_agg.map(x => `${x.rm_code} (${x.po_count} PO)`).join(', ')
      : 'none mapped';
    const unmappedList = r.unmapped.length
      ? `; unmapped: ${r.unmapped.map(u => u.name).slice(0,3).join('; ')}`
      : '';

    const notes = [
      `${r.confidence} confidence.`,
      `${r.po_count} POs / ${r.bill_count} bills (last 365d).`,
      `PAY_SEQ=${r.pay_seq.seq} (${r.pay_seq.note}).`,
      `SELLS=${r.sells.sells} (${r.sells.note}).`,
      `OPM=${r.opm.opm} (${r.opm.note}).`,
      `PMS=${r.pms.pms} (${r.pms.note}).`,
      `RMs: ${rmsList}${unmappedList}.`,
    ].join(' ');

    const payload = {
      pay_seq: r.pay_seq.seq,
      sells:   r.sells.sells,
      opm:     r.opm.opm,
      pms:     r.pms.pms,
      identity_abbr: r.identity,
      vendor_name:   r.vendor_name,
      data_json: {
        communication: { primary_mode: '' },
        location: { city: r.city || 'Bangalore', area: '' },
        payment: {},
        gst: { registered: false },
        channel_hint: 'VD',
        odoo: { partner_id: r.odoo_id },
        po_count_365d: r.po_count,
        bill_count_365d: r.bill_count,
        po_total_paise_365d: r.po_total_paise,
        rms_supplied_hint: r.rm_agg.map(x => x.rm_code),
        confidence: r.confidence,
        notes,
      },
    };

    process.stdout.write(`  → ${r.identity.padEnd(10)} ${r.vendor_name.slice(0,40).padEnd(40)} `);
    const res = await postCreate(payload);
    if (res.status === 201 || res.body?.success) {
      console.log(`OK ${res.body.vendor_code}`);
      results.push({ ...r, status: 'OK', vendor_code: res.body.vendor_code, http: res.status });
    } else {
      console.log(`FAIL ${res.status} ${JSON.stringify(res.body).slice(0,120)}`);
      results.push({ ...r, status: 'FAIL', error: res.body?.error || 'unknown', http: res.status });
    }
    // brief pacing — avoid hammering the API
    await new Promise(r => setTimeout(r, 100));
  }

  // Final count
  const endCount = await getVendorCount();
  console.log(`\n[done] production vendor count after seed: ${endCount.count}`);

  // Build report
  const ok = results.filter(r => r.status === 'OK');
  const fail = results.filter(r => r.status === 'FAIL');
  const high = ok.filter(r => r.confidence === 'HIGH');
  const med  = ok.filter(r => r.confidence === 'MEDIUM');
  const low  = ok.filter(r => r.confidence === 'LOW');

  const reportLines = [];
  reportLines.push('# NCH Vendor Canonical-Code Seed Report');
  reportLines.push('');
  reportLines.push(`**Date:** 2026-05-09`);
  reportLines.push(`**Source:** odoo.hnhotels.in (company_id=3) — ${pos.length} POs / ${bills.length} bills (last 365d)`);
  reportLines.push(`**Target:** ${PROD_BASE}/api/vendors`);
  reportLines.push('');
  reportLines.push('## Summary');
  reportLines.push('');
  reportLines.push(`- **Vendors before seed:** ${startCount.count}`);
  reportLines.push(`- **Vendors after seed:**  ${endCount.count}`);
  reportLines.push(`- **Attempted:** ${results.length}`);
  reportLines.push(`- **Succeeded:** ${ok.length}`);
  reportLines.push(`- **Failed:** ${fail.length}`);
  reportLines.push('');
  reportLines.push(`**Confidence breakdown:** HIGH ${high.length} · MEDIUM ${med.length} · LOW ${low.length}`);
  reportLines.push('');
  reportLines.push('## All seeded vendors');
  reportLines.push('');
  reportLines.push('| # | vendor_code | vendor_name | PO/Bills | Confidence | Notes |');
  reportLines.push('|---|---|---|---|---|---|');
  ok.forEach((r, i) => {
    const ambig = r.confidence === 'HIGH' ? '' :
      (r.confidence === 'LOW' ? 'multi-dim ambiguity' : 'PMS uncertain — confirm UPI');
    reportLines.push(`| ${i+1} | \`${r.vendor_code}\` | ${r.vendor_name} | ${r.po_count}/${r.bill_count} | ${r.confidence} | ${ambig} |`);
  });
  reportLines.push('');

  if (low.length) {
    reportLines.push('## LOW-confidence vendors — owner attention');
    reportLines.push('');
    low.forEach(r => {
      reportLines.push(`### \`${r.vendor_code}\` — ${r.vendor_name}`);
      reportLines.push('');
      reportLines.push(`- ${r.po_count} POs, ${r.bill_count} bills`);
      reportLines.push(`- Inference: PAY_SEQ=${r.pay_seq.seq} · SELLS=${r.sells.sells} · OPM=${r.opm.opm} · PMS=${r.pms.pms}`);
      reportLines.push(`- RMs matched: ${r.rm_agg.length ? r.rm_agg.map(x=>x.rm_code).join(', ') : 'none'}`);
      if (r.unmapped.length) {
        reportLines.push(`- Unmapped products: ${r.unmapped.map(u=>u.name).slice(0,3).join(' · ')}`);
      }
      reportLines.push('- **Owner action:** confirm SELLS/PMS, supply identity if needed.');
      reportLines.push('');
    });
  }

  if (med.length) {
    reportLines.push('## MEDIUM-confidence vendors (PMS to confirm)');
    reportLines.push('');
    med.forEach(r => {
      reportLines.push(`- \`${r.vendor_code}\` — ${r.vendor_name} · PMS=${r.pms.pms} (${r.pms.note})`);
    });
    reportLines.push('');
  }

  if (fail.length) {
    reportLines.push('## Failed creates');
    reportLines.push('');
    reportLines.push('| vendor_name | identity | http | error |');
    reportLines.push('|---|---|---|---|');
    fail.forEach(r => {
      reportLines.push(`| ${r.vendor_name} | ${r.identity} | ${r.http} | ${(r.error || '').slice(0,160)} |`);
    });
    reportLines.push('');
  }

  reportLines.push('## Verification');
  reportLines.push('');
  reportLines.push('```');
  reportLines.push(`GET ${PROD_BASE}/api/vendors?pin=${PROD_PIN} → count=${endCount.count}`);
  reportLines.push('```');
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');
  reportLines.push('Generated by `scripts/seed-vendor-canonical-codes.js`.');

  const reportText = reportLines.join('\n');
  fs.writeFileSync(REPORT_TMP, reportText);
  fs.mkdirSync(path.dirname(REPORT_REPO), { recursive: true });
  fs.writeFileSync(REPORT_REPO, reportText);
  console.log(`[report] wrote ${REPORT_TMP} and ${REPORT_REPO}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
