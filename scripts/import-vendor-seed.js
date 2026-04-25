#!/usr/bin/env node
/**
 * import-vendor-seed.js
 * One-shot importer for the vendor master seed.
 *
 * Reads data/seed-vendors.json and POSTs each vendor + its products to /api/vendor.
 * Idempotent: skips vendors whose vendor_key already exists in D1.
 *
 * Usage:
 *   node scripts/import-vendor-seed.js \
 *     --base https://hnhotels.in \
 *     --pin 0305
 *
 * For local dev:
 *   node scripts/import-vendor-seed.js --base http://localhost:8788 --pin 0305
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE = getArg('--base', 'https://hnhotels.in').replace(/\/$/, '');
const PIN  = getArg('--pin', '');
if (!PIN) { console.error('Missing --pin'); process.exit(1); }

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed-vendors.json');
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function ensureVendor(v) {
  const url = `${BASE}/api/vendor?action=create&pin=${encodeURIComponent(PIN)}`;
  const body = {
    vendor_key:        v.key,
    name:              v.name,
    phone:             v.phone || null,
    alternate_phone:   v.alternate_phone || null,
    owner_contact:     v.owner_contact || null,
    address:           v.address || null,
    bank_upi:          v.bank_upi || null,
    payment_terms:     v.payment_terms || null,
    primary_brand:     v.primary_brand || null,
    delivery_slot:     v.delivery_slot || null,
    notes:             v.notes || null,
  };
  const r = await postJson(url, body);
  if (r.ok) return { ok: true, id: r.id, created: true };
  if (r.error === 'vendor_key_exists') {
    // fetch by key
    const get = await getJson(`${BASE}/api/vendor?action=get&key=${encodeURIComponent(v.key)}&pin=${encodeURIComponent(PIN)}`);
    if (get.ok) return { ok: true, id: get.vendor.id, created: false };
  }
  return { ok: false, error: r.error || 'unknown', detail: r };
}

async function ensureProduct(vendor_id, p) {
  const url = `${BASE}/api/vendor?action=add-product&pin=${encodeURIComponent(PIN)}`;
  const body = {
    vendor_id,
    hn_rm_code:   p.hn_rm || null,
    product_name: p.name,
    uom:          p.uom || null,
    qty_hint:     p.qty_hint || null,
  };
  const r = await postJson(url, body);
  return r;
}

async function main() {
  console.log(`Importing ${seed.vendors.length} vendors to ${BASE}…\n`);
  const stats = { vendors_created: 0, vendors_existing: 0, vendors_failed: 0, products_added: 0, products_failed: 0 };

  for (const v of seed.vendors) {
    const res = await ensureVendor(v);
    if (!res.ok) {
      console.error(`  ✗ ${v.name}: ${res.error}`);
      stats.vendors_failed++;
      continue;
    }
    if (res.created) stats.vendors_created++; else stats.vendors_existing++;

    // Combine raw_materials and raw_materials_partial into one list
    const products = [...(v.raw_materials || []), ...(v.raw_materials_partial || [])];
    for (const p of products) {
      const pr = await ensureProduct(res.id, p);
      if (pr.ok) stats.products_added++;
      else stats.products_failed++;
    }

    const tag = res.created ? 'NEW' : 'existing';
    console.log(`  ✓ [${tag}] ${v.name} — ${products.length} products`);
  }

  console.log('\nDone:');
  console.log(`  Vendors: ${stats.vendors_created} created, ${stats.vendors_existing} already existed, ${stats.vendors_failed} failed`);
  console.log(`  Products: ${stats.products_added} added, ${stats.products_failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
