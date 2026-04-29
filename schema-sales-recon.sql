-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Sales Reconciliation — Slice A schema (read-side mirror only).
-- Spec: docs/OPS-NCH-SALES-RECON-SPEC.md §5
--
-- Seven tables. Read-only mirrors of pos.order / pos.payment /
-- pos.order.line from ops.hamzahotel.com (NCH prod, company_id=10),
-- plus an owner-editable Razorpay QR registry, an idempotent QR
-- collections table, a daily reconciliation rollup, and per-source
-- sync cursors mirroring the cash_sync_state pattern.
--
-- Money is INTEGER paise everywhere. Rupees = paise / 100.0 in the
-- read layer. Quantity (qty) is REAL because POS allows half-units
-- (haleem half-portion = 0.5).
--
-- Run once on prod D1:
--   wrangler d1 execute hn-hiring --remote --file=schema-sales-recon.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━ pos.config registry ━━━
-- Discovered at first sync from Odoo pos.config. Owner labels (label,
-- station_kind) are editable from the dashboard so the UI shows
-- "Counter POS" / "Runner POS" / "Token POS" instead of raw IDs.
-- 27/28 are unlabeled in the asset DB; 29 is "NCH-Delivery counter"
-- per HN-Hotels-Asset-Database.xlsx row 67.

CREATE TABLE IF NOT EXISTS pos_config_registry (
  pos_config_id INTEGER PRIMARY KEY,
  brand         TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  name          TEXT NOT NULL,
  label         TEXT,
  station_kind  TEXT CHECK (station_kind IN ('counter','runner','token','delivery','other')),
  last_seen_at  TEXT,
  notes         TEXT
);

-- Seed the asset-DB-known config so the UI shows it before first sync.
INSERT OR IGNORE INTO pos_config_registry
  (pos_config_id, brand, name, label, station_kind, notes)
VALUES
  (29, 'NCH', 'NCH-Delivery counter', 'Delivery / Counter', 'delivery',
   'Asset DB row 67. PM 50=COD, PM 51=UPI; payment config name nch_razorpay'),
  (27, 'NCH', '(unlabeled — discover at first sync)', NULL, NULL,
   'pos_configs[0] from rm-ops.js BRAND_CONFIG.NCH; rename via /api/sales?action=upsert-config'),
  (28, 'NCH', '(unlabeled — discover at first sync)', NULL, NULL,
   'pos_configs[1] from rm-ops.js BRAND_CONFIG.NCH; rename via /api/sales?action=upsert-config');

-- ━━━ pos.order mirror ━━━
-- One row per Odoo pos.order. order_date_day denormalized (IST YYYY-MM-DD)
-- so daily group-bys do not need a date function on every read.
-- payment_methods_csv is a comma-joined denorm of pos.payment.method names
-- on this order — used for fast "show me cash-only / UPI-only" filters
-- without joining pos_payments_mirror at read time.

CREATE TABLE IF NOT EXISTS pos_orders_mirror (
  odoo_pos_order_id  INTEGER PRIMARY KEY,
  brand              TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  pos_config_id      INTEGER NOT NULL,
  session_id         INTEGER,
  order_name         TEXT,
  order_date_ist     TEXT NOT NULL,
  order_date_day     TEXT NOT NULL,
  amount_total_paise INTEGER NOT NULL,
  amount_tax_paise   INTEGER NOT NULL DEFAULT 0,
  state              TEXT,
  payment_methods_csv TEXT,
  synced_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pom_brand_day      ON pos_orders_mirror(brand, order_date_day);
CREATE INDEX IF NOT EXISTS idx_pom_config_day     ON pos_orders_mirror(pos_config_id, order_date_day);
CREATE INDEX IF NOT EXISTS idx_pom_state          ON pos_orders_mirror(state);

-- ━━━ pos.payment mirror ━━━
-- One row per pos.payment. payment_method_name is a free-text mirror
-- of Odoo pos.payment.method.name — no enum, because new PMs may appear
-- (the `/api/sales?action=overview` response surfaces "unrecognised PMs"
-- so the UI can banner an unmapped row).

CREATE TABLE IF NOT EXISTS pos_payments_mirror (
  odoo_pos_payment_id INTEGER PRIMARY KEY,
  odoo_pos_order_id   INTEGER NOT NULL,
  brand               TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  order_date_day      TEXT NOT NULL,
  pos_config_id       INTEGER NOT NULL,
  payment_method_id   INTEGER NOT NULL,
  payment_method_name TEXT NOT NULL,
  amount_paise        INTEGER NOT NULL,
  synced_at           TEXT NOT NULL,
  FOREIGN KEY (odoo_pos_order_id) REFERENCES pos_orders_mirror(odoo_pos_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ppm_brand_day_pm ON pos_payments_mirror(brand, order_date_day, payment_method_name);
CREATE INDEX IF NOT EXISTS idx_ppm_pm_day       ON pos_payments_mirror(payment_method_name, order_date_day);
CREATE INDEX IF NOT EXISTS idx_ppm_order        ON pos_payments_mirror(odoo_pos_order_id);

-- ━━━ pos.order.line mirror ━━━
-- Item-level, the foundation Phase 2 (BoM-driven dup detection) consumes.
-- qty REAL on purpose; price_subtotal_incl_paise INTEGER on purpose.

CREATE TABLE IF NOT EXISTS pos_lines_mirror (
  odoo_pos_line_id   INTEGER PRIMARY KEY,
  odoo_pos_order_id  INTEGER NOT NULL,
  brand              TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  order_date_day     TEXT NOT NULL,
  pos_config_id      INTEGER NOT NULL,
  product_id         INTEGER NOT NULL,
  product_name       TEXT,
  qty                REAL NOT NULL,
  price_subtotal_incl_paise INTEGER NOT NULL,
  synced_at          TEXT NOT NULL,
  FOREIGN KEY (odoo_pos_order_id) REFERENCES pos_orders_mirror(odoo_pos_order_id)
);

CREATE INDEX IF NOT EXISTS idx_plm_brand_day_product ON pos_lines_mirror(brand, order_date_day, product_id);
CREATE INDEX IF NOT EXISTS idx_plm_product_day       ON pos_lines_mirror(product_id, order_date_day);
CREATE INDEX IF NOT EXISTS idx_plm_order             ON pos_lines_mirror(odoo_pos_order_id);

-- ━━━ Razorpay QR registry ━━━
-- Owner-editable. 6 NCH rows expected at first run: 1 counter + 5 runners.
-- runner_pin matches USERS PIN in /api/cash USERS table when applicable
-- — leave NULL for non-PIN runners (some runners only attend day-rota).

CREATE TABLE IF NOT EXISTS razorpay_qr_registry (
  qr_code_id     TEXT PRIMARY KEY,
  brand          TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  role           TEXT NOT NULL CHECK (role IN ('counter','runner')),
  runner_name    TEXT,
  runner_pin     TEXT,
  display_name   TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at TEXT,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_qrr_brand_active ON razorpay_qr_registry(brand, active);
CREATE INDEX IF NOT EXISTS idx_qrr_role         ON razorpay_qr_registry(role);

-- ━━━ Razorpay QR collections ━━━
-- Fed by both webhook + REST poll. UNIQUE on razorpay_payment_id makes
-- both paths idempotent. captured_at_day is denormalized for fast daily
-- group-bys.

CREATE TABLE IF NOT EXISTS razorpay_qr_collections (
  razorpay_payment_id TEXT PRIMARY KEY,
  qr_code_id          TEXT NOT NULL,
  brand               TEXT NOT NULL CHECK (brand IN ('NCH','HE')),
  role                TEXT NOT NULL CHECK (role IN ('counter','runner')),
  amount_paise        INTEGER NOT NULL CHECK (amount_paise >= 0),
  fee_paise           INTEGER NOT NULL DEFAULT 0,
  tax_paise           INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL,
  method              TEXT,
  vpa                 TEXT,
  contact             TEXT,
  captured_at         TEXT NOT NULL,
  captured_at_day     TEXT NOT NULL,
  synced_at           TEXT NOT NULL,
  synced_via          TEXT NOT NULL CHECK (synced_via IN ('webhook','rest_poll','manual')),
  raw_payload         TEXT,
  notes               TEXT,
  FOREIGN KEY (qr_code_id) REFERENCES razorpay_qr_registry(qr_code_id)
);

CREATE INDEX IF NOT EXISTS idx_qrc_qr_day    ON razorpay_qr_collections(qr_code_id, captured_at_day);
CREATE INDEX IF NOT EXISTS idx_qrc_brand_day ON razorpay_qr_collections(brand, captured_at_day);
CREATE INDEX IF NOT EXISTS idx_qrc_role_day  ON razorpay_qr_collections(role, captured_at_day);

-- ━━━ Daily reconciliation rollup ━━━
-- Materialised. Refreshed by the sync worker on every tick for the
-- rolling 14-day window. Read-side primary table for /ops/sales/.

CREATE TABLE IF NOT EXISTS sales_recon_daily (
  brand                 TEXT NOT NULL,
  day                   TEXT NOT NULL,
  gross_sales_paise     INTEGER NOT NULL,
  counter_cash_paise    INTEGER NOT NULL,
  counter_upi_pos_paise INTEGER NOT NULL,
  counter_upi_rzp_paise INTEGER NOT NULL,
  counter_card_paise    INTEGER NOT NULL,
  runner_sales_paise    INTEGER NOT NULL,
  runner_upi_paise      INTEGER NOT NULL,
  runner_cash_paise     INTEGER NOT NULL,
  total_cash_paise      INTEGER NOT NULL,
  total_upi_paise       INTEGER NOT NULL,
  upi_discrepancy_paise INTEGER NOT NULL,
  complimentary_paise   INTEGER NOT NULL,
  unmapped_paise        INTEGER NOT NULL DEFAULT 0,
  order_count           INTEGER NOT NULL,
  last_recomputed_at    TEXT NOT NULL,
  PRIMARY KEY (brand, day)
);

CREATE INDEX IF NOT EXISTS idx_srd_brand_day_desc ON sales_recon_daily(brand, day DESC);

-- ━━━ Per-source sync cursors ━━━
-- Mirrors cash_sync_state. Anchored at 2026-04-01T00:00:00+05:30 (NCH
-- spec's chosen sales window). Idempotent re-runs use these cursors.

CREATE TABLE IF NOT EXISTS sales_sync_state (
  sync_source TEXT PRIMARY KEY CHECK (sync_source IN (
    'nch_pos_config',
    'nch_pos_orders',
    'nch_pos_payments',
    'nch_pos_lines',
    'nch_razorpay_qr_poll',
    'nch_recon_daily_compute'
  )),
  last_synced_id      INTEGER,
  last_synced_at      TEXT,
  last_run_at         TEXT,
  last_run_status     TEXT CHECK (last_run_status IN ('ok','error','running','idle')),
  last_error          TEXT,
  rows_added_total    INTEGER NOT NULL DEFAULT 0,
  rows_added_last_run INTEGER NOT NULL DEFAULT 0,
  notes               TEXT
);

INSERT OR IGNORE INTO sales_sync_state (sync_source, last_synced_at, last_run_status, notes) VALUES
  ('nch_pos_config',          '2026-04-01T00:00:00+05:30', 'idle', 'pos.config refresh; daily cadence'),
  ('nch_pos_orders',          '2026-04-01T00:00:00+05:30', 'idle', 'pos.order delta from ops.hamzahotel.com company_id=10'),
  ('nch_pos_payments',        '2026-04-01T00:00:00+05:30', 'idle', 'pos.payment delta'),
  ('nch_pos_lines',           '2026-04-01T00:00:00+05:30', 'idle', 'pos.order.line delta — Phase 2 BoM consumption input'),
  ('nch_razorpay_qr_poll',    '2026-04-01T00:00:00+05:30', 'idle', 'Razorpay /v1/payments/qr_codes/:id/payments per registry row'),
  ('nch_recon_daily_compute', '2026-04-01T00:00:00+05:30', 'idle', 'Materialiser; rolling 14-day window');
