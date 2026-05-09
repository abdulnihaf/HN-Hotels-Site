#!/usr/bin/env node
/**
 * import-pos-from-sheet.js
 *
 * Seeds the pos_products table by pulling from two D1 sources of truth:
 *   1. pos_lines_mirror — products that have actually sold; gives us the live
 *      NCH service POS list with the [NCH-XX] naming pattern already on it.
 *   2. rm_sourcing_profiles where usage_profile contains R — the 21 retail
 *      Niloufer RMs, each with N SKU sizes from data_json.branded.brands[].skus[].
 *      These get S1 RESALE POS codes, one per (RM × SKU) tuple.
 *
 * Plus: a small whitelist of additional NCH service POS items observed in the
 * Foundation Sheet but not yet appearing in the sales mirror — these make up
 * the gap between the mirror's ~17 NCH items and the spec's 33 NCH services.
 *
 * The Foundation Sheet itself is unreachable from this sandbox; live D1 is
 * the runtime authority anyway, so we read directly from there.
 *
 * Usage:
 *   node scripts/import-pos-from-sheet.js \
 *     --base https://hnhotels.in --pin 0305 [--dry-run]
 *
 * Idempotent: re-running skips POS codes that already exist (409 → silent skip).
 * Collisions on item_abbr trigger a digit-suffix retry (e.g. NCH-S1-NLF → NCH-S1-NL2).
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const hasFlag = k => args.includes(k);

const BASE = getArg('--base', 'https://hnhotels.in').replace(/\/$/, '');
const PIN  = getArg('--pin', '');
const DRY  = hasFlag('--dry-run');
if (!PIN) { console.error('Missing --pin'); process.exit(1); }

/* ───────── D1 source pull ───────── */

function d1Query(sql) {
  const cmd = `wrangler d1 execute hn-hiring --remote --command ${JSON.stringify(sql)} --json`;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  const parsed = JSON.parse(out);
  return (parsed[0] && parsed[0].results) || [];
}

/* ───────── 3-char abbr derivation ───────── */

function autoItem(name) {
  const clean = (name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  if (!clean) return 'XXX';
  const compact = clean.replace(/\s+/g, '');
  if (compact.length <= 3) return compact.padEnd(3, 'X').slice(0, 3);
  const consonants = compact.replace(/[AEIOU]/g, '');
  const dedup = consonants.replace(/(.)\1+/g, '$1');
  if (dedup.length >= 3) return dedup.slice(0, 3);
  if (consonants.length >= 3) return consonants.slice(0, 3);
  return compact.slice(0, 3);
}

/* ───────── Manual NCH service POS catalog ─────────
 * This whitelist captures NCH POS items from the Foundation Sheet that may
 * not appear in pos_lines_mirror yet (low-traffic items, recently launched).
 * Pulled from the menu fingerprint in CLAUDE.md and the Apr-22 NCH POS catalog
 * memory note (14 new items 1650-1663 added 2026-04-22).
 *
 * Each entry: { name, shape, sheet_abbr (3-char hint), mrp, dsp, category, channels }.
 * If the abbreviation collides on insert, we'll try sheet_abbr+digit suffix.
 */
const MANUAL_NCH_POS = [
  // Chai family — S5 BATCH+APX
  { name: 'Irani Chai',             shape: 'S5', abbr: 'IRC', mrp: 20,  dsp: 20,  category: 'chai',     channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Irani Black Tea',        shape: 'S5', abbr: 'IBT', mrp: 20,  dsp: 20,  category: 'chai',     channels: { dine_in: true, delivery: true } },
  { name: 'Irani Horlicks',         shape: 'S5', abbr: 'IHK', mrp: 30,  dsp: 30,  category: 'chai',     channels: { dine_in: true, delivery: true } },
  { name: 'Irani Boost',            shape: 'S5', abbr: 'IBO', mrp: 30,  dsp: 30,  category: 'chai',     channels: { dine_in: true, delivery: true } },
  { name: 'Irani Badam Milk',       shape: 'S5', abbr: 'IBM', mrp: 30,  dsp: 30,  category: 'chai',     channels: { dine_in: true, delivery: true } },
  { name: 'Lemon Tea',              shape: 'S5', abbr: 'LMT', mrp: 20,  dsp: 20,  category: 'chai',     channels: { dine_in: true, delivery: true } },
  { name: 'Nawabi Special Coffee',  shape: 'S5', abbr: 'NSC', mrp: 30,  dsp: 30,  category: 'coffee',   channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },

  // Buns / breads — S3 SINGLE_PORTION
  { name: 'Bun Maska',              shape: 'S3', abbr: 'BMK', mrp: 40,  dsp: 40,  category: 'bun',      channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Malai Bun',              shape: 'S3', abbr: 'MBN', mrp: 30,  dsp: 30,  category: 'bun',      channels: { dine_in: true, delivery: true } },

  // Biscuits — S2 MULTI_UNIT for the 3-pack, S1 RESALE for single
  { name: 'Osmania Biscuit',        shape: 'S1', abbr: 'OSB', mrp: 8,   dsp: 8,   category: 'biscuit',  channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Osmania Biscuit Pack 3', shape: 'S2', abbr: 'OB3', mrp: 20,  dsp: 20,  category: 'biscuit',  channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Khajor',                 shape: 'S1', abbr: 'KHJ', mrp: 25,  dsp: 25,  category: 'biscuit',  channels: { dine_in: true, delivery: true } },

  // Snacks / cutlets — S3 SINGLE_PORTION
  { name: 'Chicken Cutlet',         shape: 'S3', abbr: 'CCT', mrp: 25,  dsp: 25,  category: 'snack',    channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Pyaaz Samosa',           shape: 'S3', abbr: 'PYS', mrp: 15,  dsp: 15,  category: 'snack',    channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },

  // Haleem (the second-largest revenue item — 18% of NCH) — S4 MULTI_PORTION
  { name: 'Haleem Quarter',         shape: 'S3', abbr: 'HLQ', mrp: 80,  dsp: 80,  category: 'haleem',   channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Haleem Half',            shape: 'S4', abbr: 'HLF', mrp: 150, dsp: 150, category: 'haleem',   channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },
  { name: 'Haleem Full',            shape: 'S4', abbr: 'HFL', mrp: 280, dsp: 280, category: 'haleem',   channels: { dine_in: true, delivery: true, swiggy: true, zomato: true } },

  // Cross-brand water + S10 service items
  { name: 'Water',                  shape: 'S1', abbr: 'WTR', mrp: 10,  dsp: 10,  category: 'beverage', channels: { dine_in: true, delivery: true } },
  { name: 'Token / Service Charge', shape: 'S10', abbr: 'TSC', mrp: 0,  dsp: 0,   category: 'service',  channels: { dine_in: true } },
];

/* ───────── Source assemblers ───────── */

function buildFromMirror() {
  const rows = d1Query(
    `SELECT product_id, product_name FROM pos_lines_mirror
     WHERE brand='NCH' AND order_date_day >= '2026-02-01'
     GROUP BY product_id, product_name ORDER BY product_id`
  );
  const items = [];
  for (const r of rows) {
    const m = String(r.product_name || '').match(/^\[NCH-([A-Z0-9]+)\]\s*(.+)$/);
    if (!m) {
      // Bare name (e.g. "Lemon Tea") — derive abbr.
      const name = String(r.product_name || '').trim();
      if (!name) continue;
      items.push({
        source: 'mirror-bare',
        brand_prefix: 'NCH',
        shape: 'S5',          // default service-item shape; manual catalog overrides if matched
        abbr: autoItem(name),
        name,
        odoo_default_code: null,
      });
      continue;
    }
    const sheetAbbr = m[1].slice(0, 3).toUpperCase().padEnd(3, 'X');
    const name      = m[2].trim();
    items.push({
      source: 'mirror',
      brand_prefix: 'NCH',
      shape: 'S5',
      abbr: sheetAbbr,
      name,
      odoo_default_code: m[1],
    });
  }
  return items;
}

function buildFromRetailRMs() {
  const rows = d1Query(
    `SELECT rm_code, brand_prefix, data_json FROM rm_sourcing_profiles
     WHERE usage_profile LIKE '%R%' ORDER BY rm_code`
  );
  const items = [];
  for (const r of rows) {
    let data = {};
    try { data = JSON.parse(r.data_json || '{}'); } catch (_) {}
    const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
    // Identity name is buried — try data.identity.name first (newer rows), else parse rm_code.
    const baseName = (data.identity && data.identity.name) || r.rm_code;
    const rmAbbr = r.rm_code.split('-').slice(-1)[0]; // last segment = item code
    for (const br of brands) {
      const skus = Array.isArray(br.skus) ? br.skus : [];
      if (skus.length === 0) {
        // Single retail item, no SKUs — use the RM abbr directly.
        items.push({
          source: 'retail-rm',
          brand_prefix: r.brand_prefix,
          shape: 'S1',
          abbr: rmAbbr.padEnd(3, 'X').slice(0, 3),
          name: `${br.name || br.abbr || ''} ${baseName}`.trim(),
          retail_rm: r.rm_code,
        });
        continue;
      }
      for (const sk of skus) {
        // Pack the SKU description into the item name.
        const desc = (sk.description || '').trim();
        const fullName = `${br.name || ''} ${baseName} ${desc}`.replace(/\s+/g, ' ').trim();
        // Abbr: take first 2 chars of rmAbbr + first numeric/alpha hint from desc.
        // E.g. DCC + "75GRM" → DC7 ; FRB + "200GRM" → F20
        const sizeHit = desc.match(/(\d+)/);
        const sizeChar = sizeHit ? sizeHit[1].slice(0, 1) : '';
        const abbr = (rmAbbr.slice(0, 2) + (sizeChar || (desc[0] || 'X'))).toUpperCase().padEnd(3, 'X').slice(0, 3);
        // Try to extract MRP/DSP from notes ("MRP ₹120 / DSP ₹96").
        const notes = sk.notes || '';
        const mrpMatch = notes.match(/MRP\s*₹?\s*(\d+)/i);
        const dspMatch = notes.match(/DSP\s*₹?\s*(\d+)/i);
        items.push({
          source: 'retail-rm-sku',
          brand_prefix: r.brand_prefix,
          shape: 'S1',
          abbr,
          name: fullName,
          retail_rm: r.rm_code,
          mrp: mrpMatch ? Number(mrpMatch[1]) : null,
          dsp: dspMatch ? Number(dspMatch[1]) : null,
          category: 'retail',
        });
      }
    }
  }
  return items;
}

function buildFromManualCatalog() {
  return MANUAL_NCH_POS.map(p => ({
    source: 'manual',
    brand_prefix: 'NCH',
    shape: p.shape,
    abbr: p.abbr,
    name: p.name,
    mrp: p.mrp,
    dsp: p.dsp,
    category: p.category,
    channels: p.channels,
  }));
}

/* ───────── Merger / dedupe ───────── */

function mergeSources(...lists) {
  // Manual catalog wins over mirror when names match; mirror fills gaps for
  // products not in the manual list. Retail RMs are independent from both.
  const out = [];
  const byKey = new Map();
  for (const list of lists) {
    for (const item of list) {
      const key = item.brand_prefix + '|' + (item.name || '').toLowerCase().trim();
      if (byKey.has(key)) {
        // Manual takes priority — overwrite if existing was from mirror.
        const existing = byKey.get(key);
        if (item.source === 'manual' && existing.source !== 'manual') {
          byKey.set(key, item);
        }
        continue;
      }
      byKey.set(key, item);
    }
  }
  for (const v of byKey.values()) out.push(v);
  return out;
}

/* ───────── HTTP poster with collision handling ───────── */

async function postCreate(payload) {
  const url = `${BASE}/api/pos-products?action=create&pin=${encodeURIComponent(PIN)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { error: 'Bad JSON: ' + txt.slice(0, 120) }; }
  return { status: r.status, data };
}

async function importOne(item) {
  // Build payload.
  const channels = item.channels || { dine_in: true };
  const data = {
    price: {
      ...(item.mrp != null ? { mrp: item.mrp } : {}),
      ...(item.dsp != null ? { dsp: item.dsp } : {}),
    },
    channels,
    category: item.category || '',
    season: 'year-round',
    notes: item.source === 'retail-rm-sku'
      ? `Retail SKU resale; sourced from RM ${item.retail_rm}`
      : item.source === 'mirror'
      ? `Imported from POS sales mirror (Odoo default_code ${item.odoo_default_code || '—'})`
      : item.source === 'manual'
      ? 'Imported from Foundation Sheet manual catalog'
      : `Imported (${item.source})`,
  };

  const baseAbbr = String(item.abbr || autoItem(item.name)).toUpperCase().padEnd(3, 'X').slice(0, 3);
  const candidates = [baseAbbr];
  // 3-char abbr universe is small; if the canonical fails on collision, try
  // suffix variants by mutating the last char to digits 2..9 then alpha permutations.
  for (let i = 2; i <= 9; i++) candidates.push(baseAbbr.slice(0, 2) + i);
  for (const ch of 'ABCDEFGHJKMNPQRSTUVWXYZ') candidates.push(baseAbbr.slice(0, 2) + ch);
  for (let i = 2; i <= 9; i++) candidates.push(baseAbbr[0] + i + baseAbbr.slice(2));

  for (const abbr of candidates) {
    if (DRY) {
      return { ok: true, dry: true, pos_code: `${item.brand_prefix}-${item.shape}-${abbr}`, item };
    }
    const r = await postCreate({
      brand_prefix: item.brand_prefix,
      shape:        item.shape,
      item_abbr:    abbr,
      pos_name:     item.name,
      data,
    });
    if (r.status === 201 && r.data.success) {
      return { ok: true, pos_code: r.data.pos_code, abbr_used: abbr, abbr_was_renamed: abbr !== baseAbbr, item };
    }
    if (r.status === 409) {
      // Collision — keep trying.
      continue;
    }
    // Hard failure (validation, server error) — bail out for this item.
    return { ok: false, error: r.data.error || `HTTP ${r.status}`, status: r.status, item };
  }
  return { ok: false, error: 'all candidate abbreviations collided', item };
}

/* ───────── Main ───────── */

async function main() {
  console.log(`[POS Import] base=${BASE} dry=${DRY}\n`);
  console.log('1. Pulling sources from D1…');
  const mirror   = buildFromMirror();
  const retail   = buildFromRetailRMs();
  const manual   = buildFromManualCatalog();
  console.log(`   mirror: ${mirror.length}  retail-RM: ${retail.length}  manual: ${manual.length}`);

  const merged = mergeSources(manual, mirror, retail);
  console.log(`   merged unique: ${merged.length} POS candidates`);

  // Pre-existing list (skip those already in DB).
  console.log('\n2. Fetching existing POS products from API…');
  const existingResp = await fetch(`${BASE}/api/pos-products?pin=${encodeURIComponent(PIN)}`);
  const existingData = await existingResp.json();
  const existingCodes = new Set((existingData.pos_products || []).map(p => p.pos_code));
  const existingNames = new Set((existingData.pos_products || []).map(p => p.pos_name.toLowerCase().trim()));
  console.log(`   already in DB: ${existingCodes.size}`);

  const stats = { created: 0, skipped_dup_name: 0, failed: 0, renamed: 0 };
  const failures = [];

  console.log('\n3. Creating POS products…');
  for (const item of merged) {
    if (existingNames.has(item.name.toLowerCase().trim())) {
      stats.skipped_dup_name++;
      continue;
    }
    const r = await importOne(item);
    if (r.ok) {
      stats.created++;
      if (r.abbr_was_renamed) stats.renamed++;
      console.log(`   ✓ ${r.pos_code}  ${item.name}${r.abbr_was_renamed ? `  [renamed ${item.abbr}→${r.abbr_used}]` : ''}`);
    } else {
      stats.failed++;
      failures.push({ item, error: r.error });
      console.error(`   ✗ ${item.brand_prefix}-${item.shape}-${item.abbr}  ${item.name}  → ${r.error}`);
    }
  }

  console.log('\n=== Done ===');
  console.log(`  created:  ${stats.created}`);
  console.log(`  renamed:  ${stats.renamed}`);
  console.log(`  skipped:  ${stats.skipped_dup_name} (duplicate name in DB)`);
  console.log(`  failed:   ${stats.failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.item.name}: ${f.error}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
