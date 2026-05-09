#!/usr/bin/env node
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * vendor-coverage-audit.js
 *
 * Read-only audit. Compares the 24 currently-seeded vendors at
 * /api/vendors against the actual NCH purchase activity at
 * odoo.hnhotels.in (company_id=3, last 365d). Surfaces:
 *
 *   - Per-RM coverage (which RMs have a seeded supplier vs. don't)
 *   - Vendors in Odoo PO data but NOT in seeded set ← THE GAP
 *   - Orphan seeded vendors with zero recent PO activity
 *   - Proposed canonical codes (v7 grammar) for the gap list
 *
 * Writes /tmp/vendor_coverage_audit.md and mirrors to
 * docs/Vendor-Coverage-Audit-2026-05-09.md.
 *
 * NO writes to /api/vendors. NO writes to Odoo. Pure read-only.
 *
 * Usage:  node scripts/vendor-coverage-audit.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE_LOCAL = path.join(ROOT, '.env.local');
const ENV_FILE_PARENT = '/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local';
const REPORT_TMP = '/tmp/vendor_coverage_audit.md';
const REPORT_REPO = path.join(ROOT, 'docs', 'Vendor-Coverage-Audit-2026-05-09.md');

const PROD_BASE = 'https://hnhotels.in';
const PROD_PIN = '0305';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vendor-coverage-audit';

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
function fmtPaise(p) { return `₹${(Math.round((p || 0) / 100)).toLocaleString('en-IN')}`; }

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

/* ─── RM name-rules: same set as seed-vendor-canonical-codes.js ─── */
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

/* ─── Identity derivation (same rules as the seed script) ─── */
function deriveIdentity(vendorName) {
  if (!vendorName) return 'UNKNOWN';
  let s = vendorName
    .replace(/\b(M\.?S\.?|M\/S|Sri|Shri|Mr\.?|Smt\.?|Pvt\.?|Ltd\.?|LLP|Inc\.?|Co\.?|Bros\.?|Brothers|Trader[s]?|Enterprises?|Stores?|Distributor[s]?|Agencies|Agency|Suppliers?|Vendor[s]?|Foods?|Departmental|Department)\b/gi, ' ')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = vendorName;
  const first = (s.split(/\s+/)[0] || vendorName).toUpperCase();
  if (first.length >= 3) return first.slice(0, 10);
  const all = s.split(/\s+/).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return all.slice(0, 10) || 'VENDOR';
}

/* ─── Inference rubrics (mirror seed script) ─── */
const APP_HINTS = ['zepto', 'blinkit', 'hyperpure', 'bigbasket', 'instamart', 'dunzo', 'amazon', 'flipkart', 'jiomart', 'online', 'app', '.com'];

function inferPaySeq(name, billCount, poCount) {
  const n = (name || '').toLowerCase();
  if (APP_HINTS.some(h => n.includes(h))) return 'Pf';
  if (billCount > 0) return 'Rf';
  return 'Rf';
}
function inferSells(rmCodes) {
  if (rmCodes.length === 0) return 'L';
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
  if (hasL && hasB) return 'LB';
  if (hasB) return 'B';
  return 'L';
}
function inferOpm(name) {
  const n = (name || '').toLowerCase();
  if (APP_HINTS.some(h => n.includes(h))) return 'A';
  return 'M';
}
function inferPms(name, billCount) {
  const n = (name || '').toLowerCase();
  if (APP_HINTS.some(h => n.includes(h))) return 'B';
  if (billCount === 0) return 'C';
  return 'Cb';
}
function computeConfidence(name, hasRmMatch) {
  const n = (name || '').toLowerCase();
  if (APP_HINTS.some(h => n.includes(h))) return 'HIGH';
  if (!hasRmMatch) return 'LOW';
  return 'MEDIUM';
}

/* ─── HTTP helpers ─── */
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

/* ─── Main ─── */
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

  // 1) Pull seeded vendors + RMs from production
  console.log('[step 1/5] read-only pull /api/vendors and /api/rm-sourcing');
  const seededRsp = await getJson(`${PROD_BASE}/api/vendors?pin=${PROD_PIN}`);
  const rmsRsp = await getJson(`${PROD_BASE}/api/rm-sourcing?pin=${PROD_PIN}`);
  const seededVendors = seededRsp.vendors || [];
  const rms = rmsRsp.rms || [];
  console.log(`  → seeded vendors: ${seededVendors.length}`);
  console.log(`  → RMs: ${rms.length}`);

  // 2) Pull NCH PO data from Odoo
  const rpc = (model, method, args = [], kwargs = {}) =>
    odooRpc({ host, db: ODOO_DB, uid: ODOO_UID, key: ODOO_API_KEY, model, method, args, kwargs });

  console.log('[step 2/5] purchase.order');
  const pos = await rpc('purchase.order', 'search_read', [
    [['company_id', '=', NCH_CO_ID], ['date_order', '>=', `${FROM_DATE} 00:00:00`]]
  ], { fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state'], limit: 5000 });
  console.log(`  → POs: ${pos.length}`);

  console.log('[step 3/5] purchase.order.line');
  const poIds = pos.map(o => o.id);
  const poLines = [];
  for (let i = 0; i < poIds.length; i += 500) {
    const slice = poIds.slice(i, i + 500);
    const part = await rpc('purchase.order.line', 'search_read',
      [[['order_id', 'in', slice]]],
      { fields: ['id', 'order_id', 'product_id', 'name', 'product_qty', 'price_unit', 'price_subtotal'], limit: 50000 });
    poLines.push(...part);
  }
  console.log(`  → lines: ${poLines.length}`);

  console.log('[step 4/5] account.move (vendor bills)');
  const bills = await rpc('account.move', 'search_read', [
    [['company_id', '=', NCH_CO_ID], ['move_type', '=', 'in_invoice'], ['invoice_date', '>=', FROM_DATE]]
  ], { fields: ['id', 'partner_id', 'invoice_date', 'amount_total'], limit: 5000 });
  console.log(`  → bills: ${bills.length}`);

  console.log('[step 5/5] res.partner');
  const partnerIds = [...new Set(pos.map(o => o.partner_id?.[0]).filter(Boolean))];
  const partners = await rpc('res.partner', 'search_read',
    [[['id', 'in', partnerIds]]],
    { fields: ['id', 'name', 'phone', 'city'], limit: 1000 });
  console.log(`  → partners: ${partners.length}`);

  /* ─── Aggregate ─── */
  const linesByOrder = new Map();
  for (const l of poLines) {
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

  const partnerById = new Map(partners.map(p => [p.id, p]));

  // Per-vendor: aggregate POs, total value, RMs supplied
  const byVendor = new Map();
  for (const p of partners) {
    byVendor.set(p.id, {
      vendor: p,
      poCount: 0, poTotal: 0,
      products: new Map(),    // product_name → { count, value }
      rmAgg: new Map(),       // rm_code → { count, value, names:Set }
      unmapped: new Map(),
      billCount: billsByPartner.get(p.id) || 0,
    });
  }
  // Per-RM aggregate vendors
  const rmToVendors = new Map();    // rm_code → Map(partner_id → {poCount, value})
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
        if (!v.rmAgg.has(rm)) v.rmAgg.set(rm, { count: 0, value: 0, names: new Set() });
        const re = v.rmAgg.get(rm);
        re.count += 1;
        re.value += l.price_subtotal || 0;
        re.names.add(pname);
        if (!rmToVendors.has(rm)) rmToVendors.set(rm, new Map());
        const rmv = rmToVendors.get(rm);
        if (!rmv.has(vid)) rmv.set(vid, { poCount: 0, value: 0, names: new Set() });
        const rentry = rmv.get(vid);
        rentry.poCount += 1;
        rentry.value += l.price_subtotal || 0;
        rentry.names.add(pname);
      } else {
        const key = pname || `pid-${pid}`;
        if (!v.unmapped.has(key)) v.unmapped.set(key, 0);
        v.unmapped.set(key, v.unmapped.get(key) + 1);
      }
    }
  }

  // Map seeded vendors by partner_id where possible (data_json.odoo.partner_id)
  // Also build a name → seeded map (lowercase, normalized) as fallback.
  // The current /api/vendors response shape doesn't include data_json — we
  // join by name match (normalize: lowercase, strip whitespace/punct).
  function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  const seededByName = new Map();
  for (const sv of seededVendors) {
    seededByName.set(normName(sv.vendor_name), sv);
  }

  // Identify which Odoo vendors are seeded (Set B) vs missing (Set A)
  const setA_missing = []; // in Odoo, NOT seeded
  const setB_matched = []; // in Odoo AND seeded
  const matchedSeededNames = new Set();
  for (const [vid, v] of byVendor.entries()) {
    if (v.poCount === 0) continue;
    const name = v.vendor.name || '';
    const sv = seededByName.get(normName(name));
    if (sv) {
      setB_matched.push({ odoo_id: vid, vendor: v, seeded: sv });
      matchedSeededNames.add(normName(name));
    } else {
      setA_missing.push({ odoo_id: vid, vendor: v });
    }
  }
  // Set C: seeded but no Odoo PO activity in 365d
  const setC_orphan = [];
  for (const sv of seededVendors) {
    if (!matchedSeededNames.has(normName(sv.vendor_name))) {
      setC_orphan.push(sv);
    }
  }

  /* ─── Per-RM coverage: classify each RM ─── */
  const seededOdooIds = new Set();
  for (const m of setB_matched) seededOdooIds.add(m.odoo_id);

  const rmRows = [];
  for (const rm of rms) {
    const code = rm.rm_code;
    const vendorMap = rmToVendors.get(code) || new Map();
    const vendorList = [...vendorMap.entries()].map(([vid, e]) => {
      const partner = partnerById.get(vid);
      const isSeeded = seededOdooIds.has(vid);
      return {
        odoo_id: vid,
        vendor_name: partner?.name || `partner-${vid}`,
        po_count: e.poCount,
        value_paise: Math.round(e.value * 100),
        names_supplied: [...e.names],
        is_seeded: isSeeded,
      };
    }).sort((a, b) => b.po_count - a.po_count);

    let status;
    if (vendorList.length === 0) {
      status = 'dormant'; // ❌ no purchase activity in 365d
    } else if (vendorList.some(v => v.is_seeded)) {
      status = vendorList.every(v => v.is_seeded) ? 'covered' : 'partial';
      // partial = some suppliers seeded, others not
    } else {
      status = 'gap'; // ⚠️ has Odoo vendor but supplier not seeded
    }
    rmRows.push({
      rm_code: code,
      rm_name: rm.rm_name,
      brand_prefix: rm.brand_prefix,
      status,
      vendors: vendorList,
    });
  }
  rmRows.sort((a, b) => a.rm_code.localeCompare(b.rm_code));

  /* ─── Build proposed canonical codes for missing vendors ─── */
  const missingProposals = setA_missing.map(({ odoo_id, vendor }) => {
    const v = vendor;
    const rmCodes = [...v.rmAgg.keys()];
    const hasRmMatch = rmCodes.length > 0;
    const paySeq = inferPaySeq(v.vendor.name, v.billCount, v.poCount);
    const sells = inferSells(rmCodes);
    const opm = inferOpm(v.vendor.name);
    const pms = inferPms(v.vendor.name, v.billCount);
    const identity = deriveIdentity(v.vendor.name);
    const confidence = computeConfidence(v.vendor.name, hasRmMatch);
    const proposedCode = `${paySeq}-${sells}-${opm}-${pms}-${identity}`;
    return {
      odoo_id,
      vendor_name: v.vendor.name || '',
      phone: v.vendor.phone || '',
      city: v.vendor.city || '',
      po_count: v.poCount,
      po_total_paise: Math.round(v.poTotal * 100),
      bill_count: v.billCount,
      rm_codes: rmCodes,
      rm_supplied: rmCodes.map(rm => ({
        rm_code: rm,
        po_count: v.rmAgg.get(rm).count,
      })),
      unmapped: [...v.unmapped.entries()].slice(0, 5),
      proposed_code: proposedCode,
      pay_seq: paySeq,
      sells,
      opm,
      pms,
      identity,
      confidence,
    };
  });
  missingProposals.sort((a, b) => b.po_count - a.po_count);

  // Resolve identity collisions among proposals AND against existing seeded
  const existingIdentities = new Set(seededVendors.map(sv => sv.identity_abbr));
  const proposedIdSeen = new Map();
  for (const p of missingProposals) {
    let id = p.identity;
    let collision = existingIdentities.has(id) || (proposedIdSeen.get(id) || 0) > 0;
    if (collision) {
      let n = (proposedIdSeen.get(id) || 0) + 1;
      let candidate;
      do {
        candidate = `${id.slice(0, 9)}${n}`;
        n++;
      } while (existingIdentities.has(candidate) || (proposedIdSeen.get(candidate) || 0) > 0);
      proposedIdSeen.set(id, n - 1);
      proposedIdSeen.set(candidate, 1);
      p.identity = candidate;
      p.proposed_code = `${p.pay_seq}-${p.sells}-${p.opm}-${p.pms}-${candidate}`;
      p.collision_resolved = true;
    } else {
      proposedIdSeen.set(id, 1);
    }
  }

  /* ─── Build report ─── */
  const totalRms = rms.length;
  const rmCovered = rmRows.filter(r => r.status === 'covered').length;
  const rmPartial = rmRows.filter(r => r.status === 'partial').length;
  const rmGap = rmRows.filter(r => r.status === 'gap').length;
  const rmDormant = rmRows.filter(r => r.status === 'dormant').length;
  const odooVendorsActive = setA_missing.length + setB_matched.length;

  const lines = [];
  lines.push('# NCH Vendor Coverage Audit');
  lines.push('');
  lines.push(`**Date:** 2026-05-09  `);
  lines.push(`**Source:** odoo.hnhotels.in (company_id=3) — last 365d  `);
  lines.push(`**Production:** ${PROD_BASE}/api/vendors + /api/rm-sourcing (read-only)  `);
  lines.push('');
  lines.push('Pure read-only audit. NO writes performed to Odoo or to /api/vendors.');
  lines.push('');

  /* Section 1 — Headline counts */
  lines.push('## 1. Headline counts');
  lines.push('');
  lines.push('```');
  lines.push(`Total RMs:                         ${totalRms}`);
  lines.push(`  ✅ Has seeded vendor as supplier  ${rmCovered}`);
  lines.push(`  🟡 Partially covered              ${rmPartial}    (some suppliers seeded, others not)`);
  lines.push(`  ⚠️  Has Odoo vendor, NOT seeded    ${rmGap}    ← GAPS`);
  lines.push(`  ❌ Dormant / no PO in 365d        ${rmDormant}`);
  lines.push('');
  lines.push(`Vendors active in Odoo (365d):     ${odooVendorsActive}`);
  lines.push(`  matched to seeded                 ${setB_matched.length}`);
  lines.push(`  NOT seeded (THE GAP)              ${setA_missing.length}`);
  lines.push(`Vendors currently seeded:          ${seededVendors.length}`);
  lines.push(`  active in Odoo                    ${setB_matched.length}`);
  lines.push(`  orphan (no PO in 365d)            ${setC_orphan.length}`);
  lines.push('```');
  lines.push('');

  /* Section 2 — Per-RM mapping */
  lines.push('## 2. Per-RM mapping');
  lines.push('');
  lines.push('| RM Code | RM Name | Status | Suppliers (PO count) | Notes |');
  lines.push('|---|---|---|---|---|');
  for (const r of rmRows) {
    const icon =
      r.status === 'covered' ? '✅ covered' :
      r.status === 'partial' ? '🟡 partial' :
      r.status === 'gap' ? '⚠️ gap' : '❌ dormant';
    const suppliers = r.vendors.length
      ? r.vendors.map(v => `${v.vendor_name} (${v.po_count}${v.is_seeded ? ' ✓seeded' : ' ✗not seeded'})`).join('<br/>')
      : '_no PO activity in 365d_';
    let notes = '';
    if (r.status === 'partial') {
      const unseeded = r.vendors.filter(v => !v.is_seeded).map(v => v.vendor_name);
      notes = `missing seed: ${unseeded.join(', ')}`;
    } else if (r.status === 'gap') {
      notes = 'all suppliers missing from seed';
    } else if (r.status === 'dormant') {
      notes = 'expected for seasonal/low-volume RMs';
    } else if (r.status === 'covered') {
      notes = 'fully covered';
    }
    lines.push(`| \`${r.rm_code}\` | ${r.rm_name} | ${icon} | ${suppliers} | ${notes} |`);
  }
  lines.push('');

  /* Section 3 — Missing vendor list (THE GAP) */
  lines.push('## 3. Missing vendor list — THE GAP');
  lines.push('');
  lines.push(`${missingProposals.length} vendors have NCH PO activity in 365d but are NOT in the seeded set. Proposed canonical codes (v7 grammar) below — owner adds via UI after v8 grammar lands.`);
  lines.push('');
  lines.push('| # | Proposed Code | Vendor Name | POs / Bills / Total | Supplies | Confidence | Unmapped products |');
  lines.push('|---|---|---|---|---|---|---|');
  missingProposals.forEach((p, i) => {
    const supplies = p.rm_supplied.length
      ? p.rm_supplied.map(x => `\`${x.rm_code}\` (${x.po_count})`).join(', ')
      : '_none mapped_';
    const unmapped = p.unmapped.length
      ? p.unmapped.map(([n]) => n).slice(0, 3).join(' · ')
      : '';
    lines.push(`| ${i+1} | \`${p.proposed_code}\` | ${p.vendor_name}${p.collision_resolved ? ' (id collision-resolved)' : ''} | ${p.po_count} / ${p.bill_count} / ${fmtPaise(p.po_total_paise)} | ${supplies} | ${p.confidence} | ${unmapped} |`);
  });
  lines.push('');

  /* Section 4 — Orphan vendors */
  lines.push('## 4. Orphan seeded vendors (no PO activity in 365d)');
  lines.push('');
  if (setC_orphan.length === 0) {
    lines.push('_None — all seeded vendors have recent PO activity._');
  } else {
    lines.push(`${setC_orphan.length} vendors are in the seeded set but show NO purchase activity at NCH in the last 365 days. These may be:`);
    lines.push('');
    lines.push('- Genuine seasonal vendors who simply did not transact in this window');
    lines.push('- Cross-brand vendors only used by HE (seeded too eagerly from worksheet)');
    lines.push('- Stale/wrong entries that should be deleted');
    lines.push('');
    lines.push('| # | vendor_code | vendor_name |');
    lines.push('|---|---|---|');
    setC_orphan.forEach((sv, i) => {
      lines.push(`| ${i+1} | \`${sv.vendor_code}\` | ${sv.vendor_name} |`);
    });
  }
  lines.push('');

  /* Section 5 — Recommendations */
  lines.push('## 5. Recommendations');
  lines.push('');
  const highCount = missingProposals.filter(p => p.confidence === 'HIGH').length;
  const medCount  = missingProposals.filter(p => p.confidence === 'MEDIUM').length;
  const lowCount  = missingProposals.filter(p => p.confidence === 'LOW').length;
  lines.push('### Priority of vendor additions');
  lines.push('');
  lines.push(`Confidence breakdown of missing vendors: HIGH ${highCount} · MEDIUM ${medCount} · LOW ${lowCount}`);
  lines.push('');
  lines.push('Suggested order:');
  lines.push('');
  lines.push('1. **HIGH confidence** — quick-commerce / app vendors with unambiguous PMS=B grammar. Safe to seed in bulk.');
  lines.push('2. **MEDIUM confidence** — traditional vendors with clear RM coverage; PMS=C is best guess (owner confirms UPI capability when convenient).');
  lines.push('3. **LOW confidence** — vendors with no clear RM mapping (their products did not match any name rule); owner inspects unmapped products to decide whether RM rules need extending or vendor is misc/one-off.');
  lines.push('');
  lines.push('### Whether any seeded vendors should be deleted (orphans)');
  lines.push('');
  if (setC_orphan.length === 0) {
    lines.push('No deletions needed — every seeded vendor has recent PO activity.');
  } else {
    lines.push(`${setC_orphan.length} orphan seeded vendors flagged in Section 4. Owner reviews each: delete if stale, leave if seasonal or used at HE.`);
  }
  lines.push('');
  lines.push('### Confidence overview');
  lines.push('');
  lines.push(`- **Coverage rate:** ${rmCovered + rmPartial} of ${totalRms} RMs (${Math.round(((rmCovered + rmPartial) / totalRms) * 100)}%) have at least one seeded supplier.`);
  lines.push(`- **Gap rate:** ${rmGap} RMs (${Math.round((rmGap / totalRms) * 100)}%) have purchase activity but no seeded supplier.`);
  lines.push(`- **Dormant rate:** ${rmDormant} RMs (${Math.round((rmDormant / totalRms) * 100)}%) have zero purchase activity in 365d — expected for seasonal/specialty items.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Generated by `scripts/vendor-coverage-audit.js` (read-only).');

  const reportText = lines.join('\n');
  fs.writeFileSync(REPORT_TMP, reportText);
  fs.mkdirSync(path.dirname(REPORT_REPO), { recursive: true });
  fs.writeFileSync(REPORT_REPO, reportText);
  console.log(`\n[report] wrote ${REPORT_TMP}`);
  console.log(`[report] mirrored to ${REPORT_REPO}`);

  // Headline echo
  console.log('\n=== HEADLINE ===');
  console.log(`RMs total ${totalRms} | covered ${rmCovered} | partial ${rmPartial} | gap ${rmGap} | dormant ${rmDormant}`);
  console.log(`Vendors seeded ${seededVendors.length} | active in Odoo ${odooVendorsActive} | missing ${setA_missing.length} | orphan ${setC_orphan.length}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
