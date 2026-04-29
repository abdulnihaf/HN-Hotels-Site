-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Phase 1 v2 — Cash trail (separate from money_events on purpose).
--
-- Why a SEPARATE table from money_events:
--   The previous Phase 1 attempt wrote cash rows into money_events. Several
--   /api/bank-feed actions (notably action=list) default to NO source/
--   instrument filter, so cash rows leaked into /ops/bank/. Physical
--   separation makes that pollution impossible — /ops/bank/ literally
--   cannot query a table it does not reference.
--
-- Architecture:
--   cash_events       — per-pile credit/debit rows, definitive-source-keyed
--   cash_sync_state   — per-source cursor table for idempotent sync workers
--
-- Sources of truth (read-only) feeding cash_events:
--   NCH outlet (nawabichaihouse.com):
--     /api/settlement?action=history          → runner cash_settled credits
--     /api/settlement?action=expense-history  → counter expense debits
--     /api/settlement?action=collection-history → 2-leg transfer (till→Basheer)
--     /api/nch-data                            → mainCounter cash sales
--   HE outlet (hamzaexpress.in):
--     /api/v2?action=shift-live                → captain handovers (cash IN)
--     /api/v2?action=history-expenses          → counter expense debits
--   HN central (this D1):
--     business_expenses cash rows, x_pool != 'counter' → central pile debits
--   Real-time hooks:
--     /api/spend?action=settle-po with cash_instrument → po_settle debit
--     /api/cash?action=transfer                  → 2-leg pile↔pile
--
-- Anchors (per-brand v2 launch event):
--   NCH: 2026-04-19 21:00:50 IST, opening float ₹70
--        (NCH /api/settlement collection-history id=75: HISTORICAL RESET)
--   HE:  2026-04-23 15:03:07 IST, opening float ₹1025
--        (HE /api/v2 shift id=2: "Real shift — opening float Rs 1025
--         seeded via CLI", Nihaf PIN 5882)
--   Pre-anchor cash data is archived; not synced.
--
-- Idempotency:
--   Every sync row has a deterministic source_ref (e.g.
--   'nch:settlement:334', 'odoo:pos.order:1234', 'he:shift-exp:19').
--   UNIQUE(source, source_ref) guarantees re-running sync workers is safe.
--
-- Run once on prod D1:
--   wrangler d1 execute hn-hiring --remote --file=schema-cash-events.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS cash_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The four physical cash piles. Strict CHECK — typos fail loudly here.
  instrument TEXT NOT NULL CHECK (instrument IN
    ('pos_counter_he', 'pos_counter_nch', 'cash_basheer', 'cash_nihaf')),

  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),

  -- Where the row originated. Determines how the sync worker recognizes
  -- it on re-run + how the UI groups it.
  source TEXT NOT NULL CHECK (source IN (
    'opening_float',          -- per-brand v2-launch anchor row
    'pos_sale',               -- HE Odoo pos.order cash payment
    'main_counter_cash',      -- NCH /api/nch-data mainCounter.cash daily
    'runner_settlement',      -- NCH /api/settlement?action=history
    'captain_handover',       -- HE /api/v2 shift-live captain cash_handed_over
    'counter_expense',        -- NCH expense-history OR HE history-expenses
    'collection_handover',    -- NCH collection (till→Basheer 2-leg)
    'central_expense',        -- HN central business_expenses cash, non-counter
    'po_settle',              -- /api/spend?action=settle-po with cash_instrument
    'transfer',               -- /api/cash?action=transfer (pile→pile)
    'deposit_to_bank',        -- pile→HDFC/Federal (1-leg debit on cash side)
    'external_capital_in',    -- explicit owner injection
    'manual'                  -- owner-recorded one-off, never auto-synced
  )),

  -- Stable, deterministic per-source key. Examples:
  --   'nch:settlement:334'
  --   'nch:collection:75:leg1' / 'nch:collection:75:leg2'
  --   'nch:exp-history:143'
  --   'nch:nch-data:2026-04-25:main_cash'
  --   'odoo:pos.order:1234'
  --   'he:shift-expense:19'
  --   'he:shift-handover:2:SK_Muntaz'
  --   'be:585'                     (HN central business_expenses.id)
  --   'opening:nch:2026-04-19'
  --   'opening:he:2026-04-23'
  --   'po-settle:<po_id>:<bill_id>'
  --   'transfer:<group_id>:leg1'   (paired with leg2 via transfer_group_id)
  source_ref TEXT,

  brand TEXT CHECK (brand IN ('NCH', 'HE', 'HQ') OR brand IS NULL),

  txn_at TEXT NOT NULL,                   -- IST ISO; the wall-clock time
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),

  recorded_by_pin TEXT,
  recorded_by_name TEXT,

  -- Optional line metadata (populated when source has it)
  vendor_id INTEGER,
  vendor_name TEXT,
  category_id INTEGER,
  category TEXT,
  product_id INTEGER,
  product_name TEXT,
  qty REAL,
  uom TEXT,
  bill_ref TEXT,
  bill_date TEXT,
  attachment_url TEXT,

  -- Cross-references back to source systems (helpful for ledger drilldown)
  linked_po_id INTEGER,
  linked_po_name TEXT,
  matched_expense_id INTEGER,             -- → business_expenses.id
  matched_settlement_id INTEGER,          -- → NCH settlement-history.id
  matched_collection_id INTEGER,          -- → NCH collection-history.id
  matched_pos_order_id INTEGER,           -- → Odoo pos.order.id
  matched_shift_id INTEGER,               -- → HE outlet shifts.id

  -- 2-leg transfer linkage (collection_handover / transfer / etc.)
  transfer_group_id TEXT,

  -- Phase 3 dup-cleanup hook: cashier-affirmed "this is a separate purchase"
  verified_separate INTEGER NOT NULL DEFAULT 0,

  notes TEXT
);

-- ━━━ Indexes ━━━

-- Idempotency. Re-running any sync worker re-INSERTs the same source_ref
-- and gets silently rejected. WHERE clause excludes manual rows so owner
-- can record multiple manual entries with NULL source_ref if desired.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_event_source
  ON cash_events(source, source_ref)
  WHERE source_ref IS NOT NULL;

-- Hot read paths
CREATE INDEX IF NOT EXISTS idx_cash_instrument_txn ON cash_events(instrument, txn_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_brand_txn      ON cash_events(brand, txn_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_source         ON cash_events(source);
CREATE INDEX IF NOT EXISTS idx_cash_transfer_group ON cash_events(transfer_group_id);
CREATE INDEX IF NOT EXISTS idx_cash_linked_po      ON cash_events(linked_po_id);
CREATE INDEX IF NOT EXISTS idx_cash_recorded_at    ON cash_events(recorded_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- cash_sync_state — per-source cursor for sync workers.
-- One row per (sync_source). Workers read the cursor, pull events newer
-- than the cursor, write to cash_events idempotently, advance the cursor.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS cash_sync_state (
  sync_source TEXT PRIMARY KEY CHECK (sync_source IN (
    'nch_settlement_history',     -- runner cash_settled events
    'nch_collection_history',     -- Basheer pickup events
    'nch_expense_history',        -- counter expenses paid from till
    'nch_pos_main_cash',          -- daily main-counter walk-in cash
    'he_shift_expenses',          -- HE outlet expenses (per shift)
    'he_shift_handovers',         -- HE captain cash handovers (per shift)
    'he_pos_orders',              -- HE Odoo pos.order cash sales
    'central_business_expenses'   -- HN central cash expenses
  )),
  last_synced_id INTEGER,         -- cursor for sources with sequential IDs
  last_synced_at TEXT,            -- cursor for time-based sources
  last_run_at TEXT,
  last_run_status TEXT CHECK (last_run_status IN ('ok','error','running','idle')),
  last_error TEXT,
  rows_added_total INTEGER NOT NULL DEFAULT 0,
  rows_added_last_run INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- Seed the cursor table — every source starts at the brand anchor.
INSERT OR IGNORE INTO cash_sync_state (sync_source, last_synced_at, last_run_status, notes) VALUES
  ('nch_settlement_history',   '2026-04-19T15:30:50Z', 'idle', 'NCH anchor — cash trail starts at HISTORICAL RESET event'),
  ('nch_collection_history',   '2026-04-19T15:30:50Z', 'idle', 'NCH anchor'),
  ('nch_expense_history',      '2026-04-19T15:30:50Z', 'idle', 'NCH anchor'),
  ('nch_pos_main_cash',        '2026-04-19T15:30:50Z', 'idle', 'NCH anchor — daily main counter cash from /api/nch-data'),
  ('he_shift_expenses',        '2026-04-23T09:33:07Z', 'idle', 'HE anchor — shift id=2 opened by Nihaf PIN 5882, opening float ₹1025'),
  ('he_shift_handovers',       '2026-04-23T09:33:07Z', 'idle', 'HE anchor — captain handovers from shift-live'),
  ('he_pos_orders',            '2026-04-23T09:33:07Z', 'idle', 'HE anchor — Odoo pos.order company_id=2 cash sales'),
  ('central_business_expenses','2026-04-19T15:30:50Z', 'idle', 'NCH anchor — central HQ-recorded cash expenses');

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Opening-float anchor rows — credits the till at the v2-launch moment
-- per brand. Without these, the first balance read shows zero.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT OR IGNORE INTO cash_events
  (instrument, direction, amount_paise, source, source_ref, brand,
   txn_at, recorded_by_pin, recorded_by_name, notes)
VALUES
  ('pos_counter_nch', 'credit', 7000, 'opening_float', 'opening:nch:2026-04-19',
   'NCH', '2026-04-19T15:30:50Z', '0305', 'Nihaf',
   'NCH cash trail anchor — HISTORICAL RESET, opening float ₹70 (Nafees CASH002, 9 PM IST 2026-04-19). Sourced from NCH /api/settlement collection-history id=75.'),
  ('pos_counter_he', 'credit', 102500, 'opening_float', 'opening:he:2026-04-23',
   'HE', '2026-04-23T09:33:07Z', '5882', 'Nihaf',
   'HE cash trail anchor — shift id=2 opened 2026-04-23 15:03 IST by Nihaf, opening float ₹1025. Sourced from HE /api/v2 shift-live.');
