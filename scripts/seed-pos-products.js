#!/usr/bin/env node
/**
 * seed-pos-products.js
 *
 * Lightweight idempotent re-seeder. Identical to import-pos-from-sheet.js but
 * intended to be run on demand for verification — not as the primary import.
 * Runs the same merge → POST flow against /api/pos-products.
 *
 * Usage:
 *   node scripts/seed-pos-products.js --base https://hnhotels.in --pin 0305
 */

require('./import-pos-from-sheet.js');
