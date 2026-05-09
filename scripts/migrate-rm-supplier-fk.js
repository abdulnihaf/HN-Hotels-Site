#!/usr/bin/env node
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * migrate-rm-supplier-fk.js
 *
 * One-time migration: walk every rm_sourcing_profiles.data_json,
 * find legacy supplier rows that have { name, abbr } but no vendor_code FK,
 * fuzzy-match against vendor_profiles, and inject vendor_code in place.
 *
 * Idempotent: rows that already have vendor_code are skipped.
 * Rows that fail to match are tagged { legacy: true, ...original fields }
 * so the editor can flag them for owner attention.
 *
 * Usage:
 *   node scripts/migrate-rm-supplier-fk.js \
 *     --base https://hnhotels.in \
 *     --pin 0305 \
 *     [--dry-run]
 *
 * Match strategy (in order, first hit wins):
 *   1. exact: ref.vendor_code === vendor.vendor_code (already migrated, skip)
 *   2. exact: ref.abbr (uppercased) === vendor.identity_abbr
 *   3. exact: ref.name (lowercased) === vendor.vendor_name (lowercased)
 *   4. substring: vendor.identity_abbr appears in ref.name (uppercased)
 *      OR ref.abbr appears in vendor.identity_abbr (when both >= 4 chars)
 *
 * Anything that doesn't match → tag as { legacy: true } and surface in report.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
'use strict';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const has = (k) => args.includes(k);

const BASE = getArg('--base', 'https://hnhotels.in').replace(/\/$/, '');
const PIN  = getArg('--pin', '');
const DRY  = has('--dry-run');
if (!PIN) { console.error('Missing --pin'); process.exit(1); }

const log = (...a) => console.log(...a);

async function getJson(path) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}pin=${encodeURIComponent(PIN)}`;
  const r = await fetch(url);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { throw new Error(`Bad JSON from ${url}: ${t.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${d.error || t.slice(0, 200)}`);
  return d;
}

async function putJson(path, body) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}pin=${encodeURIComponent(PIN)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { throw new Error(`Bad JSON from ${url}: ${t.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${d.error || t.slice(0, 200)}`);
  return d;
}

/* Match a legacy supplier ref against a vendor list. Returns the matching
 * vendor_code, or null if nothing fits. */
function matchVendor(ref, vendors) {
  if (!ref) return null;
  // 1. Already has vendor_code — verify it still exists, otherwise null.
  if (ref.vendor_code) {
    return vendors.some(v => v.vendor_code === ref.vendor_code) ? ref.vendor_code : null;
  }
  const refAbbr = (ref.abbr || '').trim().toUpperCase();
  const refName = (ref.name || '').trim().toLowerCase();

  // 2. abbr === identity_abbr
  if (refAbbr) {
    const hit = vendors.find(v => (v.identity_abbr || '').toUpperCase() === refAbbr);
    if (hit) return hit.vendor_code;
  }
  // 3. name (lowercased) === vendor_name (lowercased)
  if (refName) {
    const hit = vendors.find(v => (v.vendor_name || '').trim().toLowerCase() === refName);
    if (hit) return hit.vendor_code;
  }
  // 4. substring fallback (only when tokens long enough to be discriminating)
  const refNameUpper = refName.toUpperCase();
  if (refAbbr && refAbbr.length >= 4) {
    const hit = vendors.find(v => (v.identity_abbr || '').toUpperCase().includes(refAbbr));
    if (hit) return hit.vendor_code;
  }
  if (refNameUpper) {
    const hit = vendors.find(v => {
      const id = (v.identity_abbr || '').toUpperCase();
      return id.length >= 4 && refNameUpper.includes(id);
    });
    if (hit) return hit.vendor_code;
  }
  return null;
}

/* Walk the data_json tree, returning { changed, stats }. Mutates data in place. */
function migrateData(data, vendors) {
  let changed = false;
  const stats = { total: 0, already_migrated: 0, matched: 0, legacy: 0 };

  function processSupplier(ref) {
    stats.total++;
    if (ref.vendor_code && vendors.some(v => v.vendor_code === ref.vendor_code)) {
      stats.already_migrated++;
      return;
    }
    const code = matchVendor(ref, vendors);
    if (code) {
      // Inject vendor_code; strip legacy fields so the FK is the only source
      // of truth (name/abbr/v_shape are derivable from vendor_profiles).
      ref.vendor_code = code;
      delete ref.name;
      delete ref.abbr;
      delete ref.v_shape;
      delete ref.abbrTouched;
      delete ref.legacy;
      stats.matched++;
      changed = true;
    } else if (!ref.vendor_code) {
      // Couldn't auto-match — tag for owner attention but keep the data.
      if (!ref.legacy) {
        ref.legacy = true;
        changed = true;
      }
      stats.legacy++;
    }
  }

  const looseV = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
  for (const v of looseV) processSupplier(v);
  const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
  for (const br of brands) {
    for (const sk of (br.skus || [])) {
      for (const sup of (sk.suppliers || [])) processSupplier(sup);
    }
  }
  const recipes = (data.in_house && Array.isArray(data.in_house.recipes)) ? data.in_house.recipes : [];
  for (const rec of recipes) {
    for (const sup of (rec.suppliers || [])) processSupplier(sup);
  }
  return { changed, stats };
}

(async () => {
  log(`[migrate-rm-supplier-fk] base=${BASE} pin=${PIN.slice(0, 1)}*** dry-run=${DRY}`);

  const vRs = await getJson('/api/vendors');
  const vendors = vRs.vendors || [];
  log(`Loaded ${vendors.length} vendor profiles.`);

  const rmList = await getJson('/api/rm-sourcing');
  const rms = rmList.rms || [];
  log(`Loaded ${rms.length} RMs. Walking trees…\n`);

  const totals = { rm_walked: 0, rm_changed: 0, supplier_total: 0, matched: 0, legacy: 0, already: 0 };
  const legacyDetail = []; // { rm_code, refs: [] }

  for (const meta of rms) {
    const detail = await getJson(`/api/rm-sourcing?rm_code=${encodeURIComponent(meta.rm_code)}`);
    const data = detail.data || {};
    const { changed, stats } = migrateData(data, vendors);

    totals.rm_walked++;
    totals.supplier_total   += stats.total;
    totals.matched          += stats.matched;
    totals.legacy           += stats.legacy;
    totals.already          += stats.already_migrated;

    if (stats.legacy > 0) {
      // Collect legacy refs for the report.
      const refs = [];
      const looseV = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
      for (const v of looseV) if (v.legacy) refs.push({ where: 'loose', name: v.name, abbr: v.abbr });
      const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
      for (const br of brands) {
        for (const sk of (br.skus || [])) {
          for (const sup of (sk.suppliers || [])) {
            if (sup.legacy) refs.push({ where: `branded:${br.name || br.abbr}/${sk.description || sk.id}`, name: sup.name, abbr: sup.abbr });
          }
        }
      }
      if (refs.length) legacyDetail.push({ rm_code: meta.rm_code, refs });
    }

    if (!changed) {
      log(`  ${meta.rm_code.padEnd(28)} unchanged (already=${stats.already_migrated} legacy=${stats.legacy})`);
      continue;
    }
    totals.rm_changed++;
    log(`  ${meta.rm_code.padEnd(28)} matched=${stats.matched} legacy=${stats.legacy} already=${stats.already_migrated}`);

    if (DRY) continue;

    // Write back via PUT, preserving structured identity columns.
    await putJson(`/api/rm-sourcing?rm_code=${encodeURIComponent(meta.rm_code)}`, {
      data,
      brand_prefix:     detail.brand_prefix,
      rm_type:          detail.rm_type,
      usage_profile:    detail.usage_profile,
      sourcing_profile: detail.sourcing_profile,
      item_abbr:        detail.item_abbr,
      rm_name:          detail.rm_name,
    });
  }

  log('\n━━━ SUMMARY ━━━');
  log(`RMs walked:              ${totals.rm_walked}`);
  log(`RMs changed:             ${totals.rm_changed}${DRY ? ' (dry-run, NOT written)' : ''}`);
  log(`Supplier rows total:     ${totals.supplier_total}`);
  log(`  Already migrated:      ${totals.already}`);
  log(`  Matched + injected FK: ${totals.matched}`);
  log(`  Flagged legacy (no match): ${totals.legacy}`);
  if (legacyDetail.length) {
    log('\nLegacy rows requiring manual re-link:');
    for (const d of legacyDetail) {
      log(`  ${d.rm_code}:`);
      for (const r of d.refs) {
        log(`    [${r.where}] name="${r.name || ''}" abbr="${r.abbr || ''}"`);
      }
    }
  }
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
