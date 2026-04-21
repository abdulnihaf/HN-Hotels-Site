# RM Architecture Migration — Backup Snapshot (2026-04-21)

Captured just before executing the Odoo category re-linking + supplierinfo sync.
Each file is a raw dump of the table / entity at the time of capture. Restorable
by replaying INSERTs or Odoo writes using the stored ids.

## Files
- `d1-rm_products.json`         — 150 active RM products (hn_code, name, category, odoo_id, avg_cost)
- `d1-rm_vendors.json`          — all RM vendors (key, name, odoo_id)
- `d1-rm_vendor_products.json`  — vendor↔product links (primary flag, last_price)
- `d1-rm_product_variants.json` — variant rows (template+variant+attrs)
- `d1-bill_attachments.json`    — all bill/Drive metadata (pre-migration)
- `odoo-product-categories.json` — Odoo product.category tree (pre-migration)
- `odoo-rm-products.json`        — all 147 products in Raw Materials (pre-migration categ_id snapshot)
- `odoo-supplierinfo.json`       — existing product.supplierinfo rows
- `odoo-vendors.json`            — all res.partner rows tagged supplier

## Rollback strategy
1. Phase 1 (create categories) — unlink the new product.category rows with id > snapshot_max_cat_id
2. Phase 2 (relink products) — for each row in d1-rm-products-relinks.json, write original categ_id back
3. Phase 3 (supplierinfo sync) — delete rows in odoo-supplierinfo where id > snapshot_max_supplierinfo_id
