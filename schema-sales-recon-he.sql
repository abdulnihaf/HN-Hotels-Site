-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HE sales-recon migration. Brand-aware extension of the NCH schema.
--
-- Adds two columns to sales_recon_daily (aggregator + waba) so HE's
-- Swiggy/Zomato/WABA channels surface as first-class buckets instead of
-- "unmapped". Useful for NCH too — same channels exist there.
--
-- Drops + recreates sales_sync_state without the CHECK enum so HE's six
-- new sync_source rows can land. The enum prevents typos but blocks
-- brand expansion; trading it for the SAME safety in app code (see
-- spend-sync-cron's syncHeSales / syncNchSales which have hard-coded
-- source names).
--
-- Seeds:
--   pos_config_registry — HE configs 5/6/7/10 from test.hamzahotel.com
--   sales_sync_state    — six he_* cursors anchored at 2026-04-01
--
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=schema-sales-recon-he.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Add aggregator + waba columns to sales_recon_daily
ALTER TABLE sales_recon_daily ADD COLUMN aggregator_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_recon_daily ADD COLUMN waba_paise INTEGER NOT NULL DEFAULT 0;

-- 2. Recreate sales_sync_state without the CHECK enum
CREATE TABLE sales_sync_state_new (
  sync_source         TEXT PRIMARY KEY,
  last_synced_id      INTEGER,
  last_synced_at      TEXT,
  last_run_at         TEXT,
  last_run_status     TEXT CHECK (last_run_status IN ('ok','error','running','idle')),
  last_error          TEXT,
  rows_added_total    INTEGER NOT NULL DEFAULT 0,
  rows_added_last_run INTEGER NOT NULL DEFAULT 0,
  notes               TEXT
);
INSERT INTO sales_sync_state_new
  (sync_source, last_synced_id, last_synced_at, last_run_at, last_run_status, last_error, rows_added_total, rows_added_last_run, notes)
  SELECT sync_source, last_synced_id, last_synced_at, last_run_at, last_run_status, last_error, rows_added_total, rows_added_last_run, notes
    FROM sales_sync_state;
DROP TABLE sales_sync_state;
ALTER TABLE sales_sync_state_new RENAME TO sales_sync_state;

-- 3. HE pos.config registry seed (test.hamzahotel.com company_id=1)
INSERT OR IGNORE INTO pos_config_registry
  (pos_config_id, brand, name, label, station_kind, notes)
VALUES
  (5,  'HE', 'HE - Cash Counter',  'Cash Counter',  'counter',  'test.hamzahotel.com company_id=1'),
  (6,  'HE', 'HE - Captain',       'Captain',       'runner',   'test.hamzahotel.com — captain takes orders at table'),
  (7,  'HE', 'HE - Delivery',      'Delivery',      'delivery', 'test.hamzahotel.com — Swiggy/Zomato'),
  (10, 'HE', 'HE - WABA',          'WABA',          'other',    'test.hamzahotel.com — WhatsApp orders');

-- 4. HE sync cursors
INSERT OR IGNORE INTO sales_sync_state (sync_source, last_synced_at, last_run_status, notes) VALUES
  ('he_pos_config',          '2026-04-01T00:00:00+05:30', 'idle', 'pos.config refresh from test.hamzahotel.com company_id=1'),
  ('he_pos_orders',          '2026-04-01T00:00:00+05:30', 'idle', 'pos.order delta from test.hamzahotel.com'),
  ('he_pos_payments',        '2026-04-01T00:00:00+05:30', 'idle', 'pos.payment delta'),
  ('he_pos_lines',           '2026-04-01T00:00:00+05:30', 'idle', 'pos.order.line delta — Phase 2 BoM input'),
  ('he_paytm_settlement',    '2026-04-01T00:00:00+05:30', 'idle', 'Paytm UPI settlement totals via money_events (HDFC bank feed)'),
  ('he_recon_daily_compute', '2026-04-01T00:00:00+05:30', 'idle', 'HE 14-day rolling materialiser');
