#!/usr/bin/env node
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * build-vendor-mapping-worksheet.js
 *
 * Pull NCH active vendors (last 365d) from odoo.hnhotels.in (co_id 3),
 * cross-reference with the 55 canonical RM codes, infer PAY_SEQ + SELLS,
 * and emit a printable HTML worksheet at:
 *   ops/visual/vendor-mapping-worksheet/index.html
 *
 * Owner prints, hand-fills OPM and PMS columns per vendor, returns to system.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE_LOCAL = path.join(ROOT, '.env.local');
// Worktree fallback — main env at parent
const ENV_FILE_PARENT = '/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local';
const OUT_HTML = path.join(ROOT, 'ops', 'visual', 'vendor-mapping-worksheet', 'index.html');

function loadEnvLocal() {
  const candidates = [ENV_FILE_LOCAL, ENV_FILE_PARENT];
  for (const file of candidates) {
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
  console.warn('[env] No .env.local found in repo root or parent.');
  return null;
}

function pickRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysAgoIso(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d);
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

/* ─── 55 canonical RMs (same as functions/api/rm-sourcing.js SEED_RMS) ─── */
const SEED_RMS = [
  // HN- cross-brand (12)
  { rm_code: 'HN-AM-P-Lb-SUG', rm_name: 'Sugar' },
  { rm_code: 'HN-AM-P-Lb-MDA', rm_name: 'Maida' },
  { rm_code: 'HN-AM-P-Lb-SOJ', rm_name: 'Sooji' },
  { rm_code: 'HN-AM-P-Lb-SAU', rm_name: 'Saunf' },
  { rm_code: 'HN-AM-P-Lb-KAJ', rm_name: 'Kaju' },
  { rm_code: 'HN-AM-P-Lb-CAR', rm_name: 'Cardamom' },
  { rm_code: 'HN-AM-P-Lb-OIL', rm_name: 'Oil' },
  { rm_code: 'HN-AM-P-Lb-ALM', rm_name: 'Almonds' },
  { rm_code: 'HN-AM-P-Bl-BTR', rm_name: 'Butter' },
  { rm_code: 'HN-AM-P-B-SOD',  rm_name: 'Soda' },
  { rm_code: 'HN-AM-O-B-LPG',  rm_name: 'LPG' },
  { rm_code: 'HN-AM-P-L-CHL',  rm_name: 'Charcoal' },
  { rm_code: 'HN-AM-P-L-GIN',  rm_name: 'Ginger' },
  // NCH-only AM
  { rm_code: 'NCH-AM-P-Lb-MLK',  rm_name: 'Buffalo Milk' },
  { rm_code: 'NCH-AM-Pr-Bl-TEA', rm_name: 'Tea Powder' },
  { rm_code: 'NCH-AM-P-Bl-SMP',  rm_name: 'Skimmed Milk Powder' },
  { rm_code: 'NCH-AM-P-Lb-SAF',  rm_name: 'Saffron' },
  { rm_code: 'NCH-AM-P-B-WTR',   rm_name: 'Bottled Water' },
  { rm_code: 'NCH-AM-P-L-SBJ',   rm_name: 'Sabja' },
  { rm_code: 'NCH-AM-P-B-CHC',   rm_name: 'Chocolate Powder' },
  { rm_code: 'NCH-AM-P-Lb-BDM',  rm_name: 'Badam Powder' },
  { rm_code: 'NCH-AM-P-B-MMD',   rm_name: 'Milkmaid' },
  { rm_code: 'NCH-AM-P-Lb-CUS',  rm_name: 'Custard Powder' },
  { rm_code: 'NCH-AS-P-Li-CCT',  rm_name: 'Chicken Cutlet Raw' },
  { rm_code: 'NCH-AS-P-Li-CHB',  rm_name: 'Chicken Bites Raw' },
  { rm_code: 'NCH-AS-P-Li-SMS',  rm_name: 'Samosa Raw' },
  { rm_code: 'NCH-AS-P-Lbi-BUN', rm_name: 'Bun' },
  { rm_code: 'NCH-AS-P-Lb-PMK',  rm_name: 'Pumpkin Seeds' },
  { rm_code: 'NCH-AS-P-Lb-HNY',  rm_name: 'Honey' },
  { rm_code: 'NCH-AS-P-B-HRK',   rm_name: 'Horlicks' },
  { rm_code: 'NCH-AS-P-B-BST',   rm_name: 'Boost' },
  { rm_code: 'NCH-AS-P-B-JAM',   rm_name: 'Jam' },
  { rm_code: 'NCH-AS-P-B-NUT',   rm_name: 'Nutella' },
  // Niloufer biscuit family (DM/DS)
  { rm_code: 'NCH-DM-Pr-Bl-OSB', rm_name: 'Osmania Biscuit' },
  { rm_code: 'NCH-DM-R-B-BAC',   rm_name: 'Butter Almond Cookies' },
  { rm_code: 'NCH-DM-R-B-CCO',   rm_name: 'Choco Chips Osmania Biscuit' },
  { rm_code: 'NCH-DM-R-B-DCC',   rm_name: 'Double Choco Chip Cookies' },
  { rm_code: 'NCH-DM-R-B-DFB',   rm_name: 'Dry Fruit Biscuit' },
  { rm_code: 'NCH-DM-R-B-FRB',   rm_name: 'Fruit Biscuit' },
  { rm_code: 'NCH-DM-R-B-HOB',   rm_name: 'Honey Oats Biscuit' },
  { rm_code: 'NCH-DM-R-B-MGB',   rm_name: 'Multi Grain Biscuit' },
  { rm_code: 'NCH-DM-R-B-MMB',   rm_name: 'Melting Moment Biscuit' },
  { rm_code: 'NCH-DM-R-B-RPL',   rm_name: 'Round Plum' },
  { rm_code: 'NCH-DM-R-B-SLB',   rm_name: 'Salt Biscuit' },
  { rm_code: 'NCH-DS-P-B-CPP',   rm_name: 'Coffee Pouch' },
  { rm_code: 'NCH-DS-R-B-ACG',   rm_name: 'Assorted Cookies Gift Pack' },
  { rm_code: 'NCH-DS-R-B-AST',   rm_name: 'Almond Sticks' },
  { rm_code: 'NCH-DS-R-B-ATB',   rm_name: '100% Atta Biscuit' },
  { rm_code: 'NCH-DS-R-B-CHK',   rm_name: 'Cherry Khopra' },
  { rm_code: 'NCH-DS-R-B-COB',   rm_name: 'Coconut Biscuit' },
  { rm_code: 'NCH-DS-R-B-DKR',   rm_name: 'Dum Ka Roat' },
  { rm_code: 'NCH-DS-R-B-MGR',   rm_name: 'Multi Grain Ragi Biscuit' },
  { rm_code: 'NCH-DS-R-B-OMC',   rm_name: 'Oatmeal Cookies' },
  { rm_code: 'NCH-DS-R-B-PLM',   rm_name: 'Palmiers' },
  { rm_code: 'NCH-DS-R-B-RGB',   rm_name: 'Ragi Biscuit' },
];

/* ─── Heuristic name-matcher: Odoo product name → canonical RM code ───
 * Each rule: keyword(s) in product name (case-insensitive) → rm_code.
 * Rules ordered specific-first; first match wins. */
const NAME_RULES = [
  // SAF before SUG (Saffron contains 'Saf')
  [['saffron', 'kesar'], 'NCH-AM-P-Lb-SAF'],
  // BDM (Badam Powder) before ALM (Almonds whole)
  [['badam powder', 'badam pwd'], 'NCH-AM-P-Lb-BDM'],
  [['almond', 'badam'], 'HN-AM-P-Lb-ALM'],
  // Custard Powder
  [['custard'], 'NCH-AM-P-Lb-CUS'],
  // Milkmaid
  [['milkmaid', 'condensed milk'], 'NCH-AM-P-B-MMD'],
  // Skimmed Milk Powder
  [['skimmed milk', 'smp', 'milk powder'], 'NCH-AM-P-Bl-SMP'],
  // Buffalo Milk (raw)
  [['buffalo milk', 'milk -', 'fresh milk', 'cow milk', 'liquid milk'], 'NCH-AM-P-Lb-MLK'],
  // generic milk fallback (after BDM/SMP/MMD/MLK specific cases above)
  [['milk'], 'NCH-AM-P-Lb-MLK'],
  // Tea Powder
  [['tea powder', 'tea -', 'chai powder', 'dust tea'], 'NCH-AM-Pr-Bl-TEA'],
  // Bottled Water
  [['bottled water', 'mineral water', 'aquafina', 'kinley', 'bisleri', 'filter water', 'drinking water'], 'NCH-AM-P-B-WTR'],
  // Sabja
  [['sabja', 'basil seed'], 'NCH-AM-P-L-SBJ'],
  // Chocolate Powder
  [['chocolate powder', 'cocoa powder', 'choco powder'], 'NCH-AM-P-B-CHC'],
  // Chicken raws (NCH-AS-P-Li-*)
  [['chicken cutlet'], 'NCH-AS-P-Li-CCT'],
  [['chicken bite', 'chicken nugget'], 'NCH-AS-P-Li-CHB'],
  [['samosa', 'samoosa'], 'NCH-AS-P-Li-SMS'],
  // Bun
  [['bun', 'pao'], 'NCH-AS-P-Lbi-BUN'],
  // Pumpkin seeds
  [['pumpkin seed'], 'NCH-AS-P-Lb-PMK'],
  // Honey
  [['honey'], 'NCH-AS-P-Lb-HNY'],
  // Spreads
  [['horlicks'], 'NCH-AS-P-B-HRK'],
  [['boost'], 'NCH-AS-P-B-BST'],
  [['jam'], 'NCH-AS-P-B-JAM'],
  [['nutella', 'choco spread'], 'NCH-AS-P-B-NUT'],
  // Niloufer biscuit family
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
  // HN-shared
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
    for (const kw of keywords) {
      if (lower.includes(kw)) return code;
    }
  }
  return null;
}

/* ─── Identity slug derivation: vendor name → uppercase 3-10 char abbr ─── */
function deriveIdentity(vendorName) {
  if (!vendorName) return 'UNKNOWN';
  // Strip common prefixes/suffixes
  let s = vendorName
    .replace(/\b(M\.?S\.?|M\/S|Sri|Shri|Mr\.?|Smt\.?|Pvt\.?|Ltd\.?|LLP|Inc\.?|Co\.?|Bros\.?|Brothers|Trader[s]?|Enterprises?|Stores?|Distributor[s]?|Agencies|Agency|Suppliers?|Vendor[s]?|Foods?)\b/gi, ' ')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = vendorName;
  // Take first word, capped at 10 chars
  const first = s.split(/\s+/)[0] || vendorName;
  return first.toUpperCase().slice(0, 10);
}

/* ─── PAY_SEQ inference ─── */
function inferPaySeq(vendor, bills, poCount) {
  const name = (vendor.name || '').toLowerCase();
  // App / quick-commerce vendors → Pf
  const APP_HINTS = ['zepto', 'blinkit', 'hyperpure', 'dunzo', 'instamart', 'flipkart', 'amazon', 'jiomart'];
  if (APP_HINTS.some(h => name.includes(h))) return { seq: 'Pf', confident: true };
  // Has bills → check pattern
  const myBills = bills.filter(b => b.partner_id && b.partner_id[0] === vendor.id);
  if (myBills.length === 0 && poCount > 0) {
    return { seq: 'Rf', confident: false }; // likely cash daily, not confident
  }
  if (myBills.length > 0) {
    // If most bills paid → Rf (paid after PO); if bills typically unpaid for long → could be either
    return { seq: 'Rf', confident: myBills.length >= 3 };
  }
  return { seq: 'Rf', confident: false };
}

/* ─── SELLS inference: from RMs supplied ─── */
function inferSells(rmCodes) {
  if (rmCodes.length === 0) return { sells: 'L', confident: false };
  // Decompose sourcing letters from rm codes (segment 4)
  let hasL = false, hasB = false;
  for (const code of rmCodes) {
    const parts = code.split('-');
    if (parts.length !== 5) continue;
    const sourcing = parts[3];
    // Primary uppercase letter
    const primary = sourcing[0];
    // Lowercase alts
    const alts = sourcing.slice(1).toUpperCase();
    if (primary === 'L' || alts.includes('L')) hasL = true;
    if (primary === 'B' || alts.includes('B')) hasB = true;
  }
  if (hasL && hasB) return { sells: 'LB', confident: true };
  if (hasB) return { sells: 'B', confident: true };
  if (hasL) return { sells: 'L', confident: true };
  return { sells: 'L', confident: false };
}

/* ─── HTML escape ─── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(paise) {
  if (!paise) return '0';
  const rs = Math.round(paise);
  return new Intl.NumberFormat('en-IN').format(rs);
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
  const TODAY_ISO = isoDate(new Date());

  console.log(`[odoo] host=${host} db=${ODOO_DB} uid=${ODOO_UID} co=${NCH_CO_ID} from=${FROM_DATE}`);

  const rpc = (model, method, args = [], kwargs = {}) =>
    odooRpc({ host, db: ODOO_DB, uid: ODOO_UID, key: ODOO_API_KEY, model, method, args, kwargs });

  // 1) Pull all NCH purchase.orders in window
  console.log('[step 1/4] pulling purchase.order ...');
  const pos = await rpc('purchase.order', 'search_read', [
    [['company_id', '=', NCH_CO_ID], ['date_order', '>=', `${FROM_DATE} 00:00:00`]]
  ], {
    fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state'],
    limit: 5000,
  });
  console.log(`  → ${pos.length} POs`);

  // 2) Pull purchase.order.line for those POs
  const poIds = pos.map(o => o.id);
  console.log('[step 2/4] pulling purchase.order.line ...');
  const lines = [];
  if (poIds.length) {
    // chunk to keep request size reasonable
    const chunk = 500;
    for (let i = 0; i < poIds.length; i += chunk) {
      const slice = poIds.slice(i, i + chunk);
      const part = await rpc('purchase.order.line', 'search_read', [
        [['order_id', 'in', slice]]
      ], {
        fields: ['id', 'order_id', 'product_id', 'name', 'product_qty', 'price_unit', 'price_subtotal'],
        limit: 50000,
      });
      lines.push(...part);
    }
  }
  console.log(`  → ${lines.length} PO lines`);

  // 3) Pull vendor bills (account.move) for NCH
  console.log('[step 3/4] pulling account.move (vendor bills) ...');
  const bills = await rpc('account.move', 'search_read', [
    [['company_id', '=', NCH_CO_ID],
     ['move_type', '=', 'in_invoice'],
     ['invoice_date', '>=', FROM_DATE]]
  ], {
    fields: ['id', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'payment_state', 'state'],
    limit: 5000,
  });
  console.log(`  → ${bills.length} bills`);

  // 4) Pull res.partner for vendors
  console.log('[step 4/4] pulling res.partner ...');
  const partnerIds = [...new Set(pos.map(o => o.partner_id?.[0]).filter(Boolean))];
  const partners = await rpc('res.partner', 'search_read', [
    [['id', 'in', partnerIds]]
  ], {
    fields: ['id', 'name', 'phone', 'email', 'property_payment_term_id'],
    limit: 1000,
  });
  console.log(`  → ${partners.length} vendor partners`);

  // ─── Aggregate ───
  // vendor_id → { vendor, posByVendor, lines, bills, products: { product_id → { name, qty, total, count } } }
  const byVendor = new Map();
  for (const p of partners) byVendor.set(p.id, {
    vendor: p,
    poCount: 0,
    poTotal: 0,
    products: new Map(), // product_id → { name, qty, total, count }
    rmAgg: new Map(),    // rm_code → { qty, total, count, names: Set }
    unmappedAgg: new Map(), // product_name → { count }
  });

  // first count POs by vendor
  const linesByOrder = new Map();
  for (const l of lines) {
    if (!l.order_id) continue;
    const oid = l.order_id[0];
    if (!linesByOrder.has(oid)) linesByOrder.set(oid, []);
    linesByOrder.get(oid).push(l);
  }
  for (const o of pos) {
    const vid = o.partner_id?.[0];
    if (!vid || !byVendor.has(vid)) continue;
    const v = byVendor.get(vid);
    v.poCount += 1;
    v.poTotal += o.amount_total || 0;
    // accumulate product mix
    const olines = linesByOrder.get(o.id) || [];
    for (const l of olines) {
      const pid = l.product_id?.[0];
      const pname = l.product_id?.[1] || l.name || '';
      if (!pid) continue;
      // product roll-up
      if (!v.products.has(pid)) {
        v.products.set(pid, { name: pname, qty: 0, total: 0, count: 0 });
      }
      const pe = v.products.get(pid);
      pe.qty += l.product_qty || 0;
      pe.total += l.price_subtotal || 0;
      pe.count += 1;
      // RM matching
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
        if (!v.unmappedAgg.has(key)) v.unmappedAgg.set(key, { count: 0, total: 0 });
        const ue = v.unmappedAgg.get(key);
        ue.count += 1;
        ue.total += l.price_subtotal || 0;
      }
    }
  }

  // Build rows
  const rows = [];
  for (const [vid, v] of byVendor.entries()) {
    if (v.poCount === 0) continue; // skip vendors w/no POs in window
    const rmCodes = [...v.rmAgg.keys()];
    const paySeq = inferPaySeq(v.vendor, bills, v.poCount);
    const sells = inferSells(rmCodes);
    rows.push({
      odoo_id: vid,
      vendor_name: v.vendor.name || '',
      phone: v.vendor.phone || '',
      identity: deriveIdentity(v.vendor.name),
      po_count: v.poCount,
      po_total: v.poTotal,
      rm_agg: [...v.rmAgg.entries()].map(([rm, e]) => ({
        rm_code: rm,
        po_count: e.count,
        qty: e.qty,
        total: e.total,
        sample_name: [...e.names][0] || '',
      })).sort((a, b) => b.po_count - a.po_count),
      unmapped: [...v.unmappedAgg.entries()].map(([name, e]) => ({
        name, count: e.count, total: e.total,
      })).sort((a, b) => b.count - a.count).slice(0, 5),
      pay_seq: paySeq,
      sells,
    });
  }
  rows.sort((a, b) => b.po_count - a.po_count);

  // Stats
  const totalProducts = rows.reduce((s, r) => s + r.rm_agg.length + r.unmapped.length, 0);
  const mappedProducts = rows.reduce((s, r) => s + r.rm_agg.length, 0);
  const unmappedProducts = totalProducts - mappedProducts;

  const stats = {
    captured_at: new Date().toISOString(),
    window: { from: FROM_DATE, to: TODAY_ISO },
    vendor_count: rows.length,
    total_pos: pos.length,
    total_lines: lines.length,
    total_bills: bills.length,
    mapped_products: mappedProducts,
    unmapped_products: unmappedProducts,
  };

  console.log('[stats]', stats);

  // Render HTML
  const html = renderHtml(rows, stats);
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html);
  console.log(`[done] wrote ${OUT_HTML} (${rows.length} vendors, ${html.length} bytes)`);
}

/* ─── HTML render ─── */
function renderHtml(rows, stats) {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const captured = new Date(stats.captured_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  // Helper to render one vendor row (table-row)
  function row(r, idx) {
    // RMs cell
    const rmCells = r.rm_agg.map(rm => {
      const qtyLabel = rm.qty ? ` · ${Math.round(rm.qty)}` : '';
      return `<div class="rm-line"><span class="rm-code">${esc(rm.rm_code)}</span> <span class="rm-meta">(${rm.po_count} PO${qtyLabel})</span></div>`;
    }).join('');
    const unmappedCells = r.unmapped.map(u => {
      return `<div class="rm-line unmapped">[Odoo: ${esc(u.name.slice(0, 38))}${u.name.length > 38 ? '…' : ''}] <span class="rm-meta">(${u.count} PO)</span> <span class="flag">?</span></div>`;
    }).join('');
    const rmsCell = (rmCells + unmappedCells) || '<em>—</em>';

    const paySeqLabel = r.pay_seq.confident ? r.pay_seq.seq : `${r.pay_seq.seq}?`;
    const sellsLabel = r.sells.confident ? r.sells.sells : `${r.sells.sells}?`;

    return `
      <tr>
        <td class="num">${idx + 1}</td>
        <td class="vendor-name">
          <div class="v-main">${esc(r.vendor_name)}</div>
          ${r.phone ? `<div class="v-phone">${esc(r.phone)}</div>` : ''}
        </td>
        <td class="identity"><span class="badge">${esc(r.identity)}</span></td>
        <td class="rms">${rmsCell}</td>
        <td class="money">₹${fmtMoney(r.po_total)}</td>
        <td class="seq">${esc(paySeqLabel)}</td>
        <td class="seq">${esc(sellsLabel)}</td>
        <td class="fillable opm-cell" data-col="opm"></td>
        <td class="fillable pms-cell" data-col="pms"></td>
        <td class="fillable notes-cell" data-col="notes"></td>
      </tr>
    `;
  }

  // Section: known vendors
  const knownRows = rows.map((r, i) => row(r, i)).join('');

  // Section: blank rows for missing vendors (12 blanks)
  const blankRows = Array.from({ length: 12 }, (_, i) => `
    <tr class="blank-row">
      <td class="num">${i + 1}</td>
      <td class="fillable name-cell"></td>
      <td class="fillable identity-cell"></td>
      <td class="fillable rms-cell"></td>
      <td class="fillable money-cell"></td>
      <td class="fillable seq-cell"></td>
      <td class="fillable seq-cell"></td>
      <td class="fillable opm-cell"></td>
      <td class="fillable pms-cell"></td>
      <td class="fillable notes-cell"></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NCH Vendor Mapping Worksheet</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  :root {
    --ink: #111;
    --ink-dim: #555;
    --ink-faint: #888;
    --line: #999;
    --line-soft: #ccc;
    --line-faint: #ddd;
    --bg: #fff;
    --stripe: #f5f5f5;
    --fill-bg: #f0f7ff;
    --fill-border: #6b8db5;
    --accent: #1f4d8c;
    --warn: #b8860b;
    --bad: #b22222;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--ink);
    background: var(--bg);
    font-size: 9pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .container { padding: 6mm 4mm; }

  /* Header */
  header.sheet-head {
    border-bottom: 1.5pt solid var(--ink);
    padding-bottom: 6pt;
    margin-bottom: 8pt;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12pt;
    align-items: end;
  }
  header h1 {
    margin: 0;
    font-size: 15pt;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  header .subtitle {
    color: var(--ink-dim);
    font-size: 9pt;
    margin-top: 2pt;
    font-weight: 500;
  }
  header .meta {
    text-align: right;
    font-size: 8pt;
    color: var(--ink-dim);
    line-height: 1.6;
  }
  header .meta .key { font-weight: 600; color: var(--ink); }

  /* Legend */
  .legend {
    border: 1pt solid var(--line-soft);
    padding: 6pt 8pt;
    margin-bottom: 8pt;
    background: #fafafa;
    border-radius: 3pt;
    font-size: 8pt;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8pt;
  }
  .legend h3 {
    margin: 0 0 3pt;
    font-size: 9pt;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .legend dl { margin: 0; padding: 0; }
  .legend dt { display: inline; font-weight: 700; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .legend dd { display: inline; margin: 0 6pt 0 2pt; color: var(--ink-dim); }
  .legend .lg-item { display: block; line-height: 1.5; }

  /* Table */
  table.worksheet {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 8.2pt;
  }
  table.worksheet thead th {
    background: #e8e8e8;
    border: 0.5pt solid var(--line);
    padding: 4pt 4pt;
    text-align: left;
    font-weight: 700;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    vertical-align: top;
    line-height: 1.25;
  }
  table.worksheet thead th .hint {
    display: block;
    font-weight: 400;
    font-size: 6.8pt;
    color: var(--ink-dim);
    text-transform: none;
    letter-spacing: 0;
    margin-top: 1pt;
  }
  table.worksheet thead th.fillable-head {
    background: #d8e6f5;
    color: var(--accent);
  }
  table.worksheet tbody td {
    border: 0.4pt solid var(--line-soft);
    padding: 3pt 4pt;
    vertical-align: top;
  }
  table.worksheet tbody tr:nth-child(even) td:not(.fillable) {
    background: var(--stripe);
  }

  /* Column widths */
  col.c-num     { width: 3%; }
  col.c-vendor  { width: 13%; }
  col.c-id      { width: 7%; }
  col.c-rms     { width: 24%; }
  col.c-money   { width: 7%; }
  col.c-seq     { width: 5%; }
  col.c-fill-md { width: 8%; }
  col.c-fill-lg { width: 10%; }

  td.num { text-align: center; color: var(--ink-faint); font-family: ui-monospace, monospace; }
  td.vendor-name .v-main { font-weight: 600; line-height: 1.3; }
  td.vendor-name .v-phone { font-size: 7.5pt; color: var(--ink-faint); margin-top: 1pt; font-family: ui-monospace, monospace; }
  td.identity .badge {
    display: inline-block;
    padding: 1pt 4pt;
    background: #e8e8e8;
    border: 0.4pt solid var(--line);
    border-radius: 2pt;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  td.rms .rm-line { line-height: 1.45; }
  td.rms .rm-code { font-family: ui-monospace, monospace; font-weight: 600; font-size: 7.6pt; color: var(--accent); }
  td.rms .rm-meta { color: var(--ink-faint); font-size: 7.5pt; }
  td.rms .unmapped { color: var(--warn); font-style: italic; font-size: 7.4pt; }
  td.rms .flag { font-weight: 700; color: var(--bad); }
  td.money { text-align: right; font-family: ui-monospace, monospace; font-size: 8pt; }
  td.seq { text-align: center; font-family: ui-monospace, monospace; font-weight: 600; }

  /* Fillable cells — the columns owner hand-fills */
  td.fillable {
    background: var(--fill-bg) !important;
    border: 0.6pt solid var(--fill-border) !important;
    min-height: 28pt;
  }
  td.fillable.opm-cell, td.fillable.pms-cell { min-height: 28pt; }
  td.fillable.notes-cell { min-height: 28pt; }

  tr.blank-row td.fillable { min-height: 22pt; }
  tr.blank-row { background: #fff; }

  /* Section divider */
  .divider {
    margin: 14pt 0 6pt;
    padding: 5pt 8pt;
    background: #fff8e6;
    border-left: 3pt solid var(--warn);
    border-top: 0.5pt solid var(--line-soft);
    border-bottom: 0.5pt solid var(--line-soft);
    font-weight: 700;
    font-size: 9.5pt;
    color: var(--warn);
  }
  .divider .hint { font-weight: 400; color: var(--ink-dim); margin-left: 6pt; }

  /* Recipe footer */
  .recipe {
    margin-top: 14pt;
    padding: 8pt 10pt;
    border: 1pt solid var(--accent);
    border-radius: 3pt;
    background: #f0f5fa;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  .recipe h3 {
    margin: 0 0 4pt;
    font-size: 10pt;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .recipe .formula {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11pt;
    font-weight: 700;
    background: #fff;
    padding: 6pt 10pt;
    border: 0.5pt solid var(--line);
    border-radius: 2pt;
    margin: 4pt 0 6pt;
    text-align: center;
    letter-spacing: 0.02em;
  }
  .recipe ul { margin: 4pt 0 0 18pt; padding: 0; }
  .recipe li { margin-bottom: 2pt; }
  .recipe .example {
    margin-top: 6pt;
    padding-top: 5pt;
    border-top: 0.4pt dashed var(--line-soft);
    font-size: 8.5pt;
    color: var(--ink-dim);
  }
  .recipe .example .code { font-family: ui-monospace, monospace; font-weight: 700; color: var(--accent); }

  /* Print rules */
  @media print {
    body { background: #fff; color: #111; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .no-print { display: none !important; }
    table.worksheet tbody tr:nth-child(even) td:not(.fillable) { background: var(--stripe) !important; }
    td.fillable { background: var(--fill-bg) !important; }
  }

  /* Screen overrides */
  @media screen {
    body { padding: 12px; max-width: 1500px; margin: 0 auto; }
    .container { padding: 0; }
  }

  /* Web nav (only on screen) */
  .web-nav { margin-bottom: 10pt; padding: 6pt 8pt; background: #f5f5f5; border-radius: 4pt; font-size: 9pt; display: flex; gap: 10pt; flex-wrap: wrap; align-items: center; }
  .web-nav a { color: var(--accent); text-decoration: none; padding: 4pt 8pt; background: #fff; border: 0.5pt solid var(--line-soft); border-radius: 3pt; font-weight: 600; }
  .web-nav a:hover { background: #e8f0fa; }
  .web-nav .sep { color: var(--ink-faint); }
</style>
</head>
<body>
<div class="container">

  <div class="web-nav no-print">
    <strong>NCH Vendor Mapping Worksheet</strong>
    <span class="sep">·</span>
    <a href="/docs/Vendor-Mapping-Worksheet.pdf">⬇ Download PDF</a>
    <a href="/ops/vendor-editor/">↗ Vendor Editor</a>
    <a href="/ops/visual/vendor-shape-directory/">↗ Vendor Shape Directory</a>
    <a href="/ops/visual/coa-doctrine/">↗ COA Doctrine</a>
    <span class="sep">·</span>
    <span style="color:#555">Print this page (Ctrl/Cmd+P) — landscape A4</span>
  </div>

  <header class="sheet-head">
    <div>
      <h1>NCH Vendor Mapping Worksheet — Canonical Code Capture</h1>
      <div class="subtitle">Print → Hand-fill OPM and PMS columns → Return to system for canonical-code seeding</div>
    </div>
    <div class="meta">
      <div><span class="key">Generated:</span> ${esc(captured)}</div>
      <div><span class="key">Window:</span> last 365 days (since ${esc(stats.window.from)})</div>
      <div><span class="key">NCH active vendors:</span> <strong>${stats.vendor_count}</strong></div>
      <div><span class="key">POs in window:</span> ${stats.total_pos} · <span class="key">PO lines:</span> ${stats.total_lines} · <span class="key">Bills:</span> ${stats.total_bills}</div>
    </div>
  </header>

  <div class="legend">
    <div>
      <h3>OPM — Order Placement Mechanism</h3>
      <span class="lg-item"><dt>M-PH</dt><dd>phone call</dd> <dt>M-WA</dt><dd>WhatsApp</dd></span>
      <span class="lg-item"><dt>M-WI</dt><dd>walk-in</dd> <dt>M-RT</dt><dd>route/visit</dd></span>
      <span class="lg-item"><dt>A-AP</dt><dd>app</dd> <dt>A-WB</dt><dd>web</dd> <dt>A-API</dt><dd>API</dd></span>
    </div>
    <div>
      <h3>PMS — Payment Method Set</h3>
      <span class="lg-item"><dt>C</dt><dd>cash only</dd></span>
      <span class="lg-item"><dt>D</dt><dd>digital only (UPI / NEFT / app)</dd></span>
      <span class="lg-item"><dt>H</dt><dd>hybrid (cash + digital)</dd></span>
    </div>
    <div>
      <h3>Auto-inferred (verify)</h3>
      <span class="lg-item"><dt>Rf</dt><dd>regular-recurring (PO → bill → pay)</dd></span>
      <span class="lg-item"><dt>Pf</dt><dd>prepaid (app/quick-commerce)</dd></span>
      <span class="lg-item"><dt>L / B / LB</dt><dd>loose / branded / both</dd></span>
      <span class="lg-item" style="color:#b22222"><dt>?</dt><dd>uncertain — please confirm</dd></span>
    </div>
  </div>

  <table class="worksheet">
    <colgroup>
      <col class="c-num">
      <col class="c-vendor">
      <col class="c-id">
      <col class="c-rms">
      <col class="c-money">
      <col class="c-seq">
      <col class="c-seq">
      <col class="c-fill-md">
      <col class="c-fill-md">
      <col class="c-fill-lg">
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Vendor Name<span class="hint">(from Odoo)</span></th>
        <th>Identity<span class="hint">(auto)</span></th>
        <th>RMs Supplied<span class="hint">(canonical · PO count)</span></th>
        <th>Total ₹<span class="hint">(365d)</span></th>
        <th>PAY_SEQ<span class="hint">(auto)</span></th>
        <th>SELLS<span class="hint">(auto)</span></th>
        <th class="fillable-head">OPM ✏<span class="hint">M-PH/WA/WI/RT or A-AP/WB/API</span></th>
        <th class="fillable-head">PMS ✏<span class="hint">C / D / H</span></th>
        <th class="fillable-head">Notes ✏<span class="hint">(corrections, omissions)</span></th>
      </tr>
    </thead>
    <tbody>
      ${knownRows}
    </tbody>
  </table>

  <div class="divider">
    Vendors I might be missing — please add here
    <span class="hint">(Zepto, Blinkit, Hyperpure, fresh-produce vendor, distributor visits, etc.)</span>
  </div>

  <table class="worksheet">
    <colgroup>
      <col class="c-num">
      <col class="c-vendor">
      <col class="c-id">
      <col class="c-rms">
      <col class="c-money">
      <col class="c-seq">
      <col class="c-seq">
      <col class="c-fill-md">
      <col class="c-fill-md">
      <col class="c-fill-lg">
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th class="fillable-head">Vendor Name ✏</th>
        <th class="fillable-head">Identity ✏</th>
        <th class="fillable-head">RMs Supplied ✏</th>
        <th class="fillable-head">Approx ₹ ✏</th>
        <th class="fillable-head">PAY_SEQ ✏</th>
        <th class="fillable-head">SELLS ✏</th>
        <th class="fillable-head">OPM ✏</th>
        <th class="fillable-head">PMS ✏</th>
        <th class="fillable-head">Notes ✏</th>
      </tr>
    </thead>
    <tbody>
      ${blankRows}
    </tbody>
  </table>

  <div class="recipe">
    <h3>Canonical Code Recipe</h3>
    <div class="formula">{PAY_SEQ}-{SELLS}-{OPM_LETTER}-{PMS}-{IDENTITY}</div>
    <ul>
      <li><strong>PAY_SEQ:</strong> Rf (recurring) or Pf (prepaid)</li>
      <li><strong>SELLS:</strong> L (loose) · B (branded) · LB (both)</li>
      <li><strong>OPM_LETTER:</strong> M if any M-* sub-channel · A if any A-* sub-channel. Sub-channel (PHONE/WA/WI/RT/AP/WB/API) becomes a property in the vendor record, not in the code.</li>
      <li><strong>PMS:</strong> C (cash) · D (digital) · H (hybrid)</li>
      <li><strong>IDENTITY:</strong> 3-10 char vendor abbreviation (uppercase)</li>
    </ul>
    <div class="example">
      Worked example: <em>Prabhu Buffalo Milk Vendor</em> with hand-filled <em>OPM=M-WA, PMS=C</em> → canonical code:
      <span class="code">Rf-L-M-C-PRABHU</span>
    </div>
  </div>

</div>
</body>
</html>`;
}

main().catch(e => {
  console.error('[fatal]', e);
  process.exit(1);
});
