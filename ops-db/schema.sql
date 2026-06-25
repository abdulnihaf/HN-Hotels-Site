-- ===========================================================================
-- HN-OPS — the ONE clean operations database (Cloudflare D1 `hn-ops`)
-- Authored 2026-06-26. COA model: OUTLET is a first-class coordinate.
-- A new outlet = INSERT one row, never a code change. Same accuracy at 1 or 100.
-- Money in PAISE (integer). Photos -> R2 (r2_key), never base64 in D1.
-- Replaces the fragmented purchase trail (sauda_po + sauda_purchase + buy_lines
-- + sauda_day_po) with ONE model. Old DBs/tables stay untouched (no regression).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- DIMENSION: OUTLET  (the scalability key)
-- Everything currently hardcoded in JS (POS config ids, payment-method ids,
-- settlement model, timezone, Odoo company) becomes DATA keyed by outlet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outlets (
  outlet_id          TEXT PRIMARY KEY,            -- 'he-shivajinagar'
  brand              TEXT NOT NULL,               -- 'HE' | 'NCH'
  name               TEXT NOT NULL,               -- 'Hamza Express'
  city               TEXT DEFAULT 'Bangalore',
  odoo_instance      TEXT DEFAULT '',             -- POS source host
  odoo_company_id    INTEGER,
  pos_config_map     TEXT DEFAULT '{}',           -- JSON: logical->odoo POS config id
  payment_method_map TEXT DEFAULT '{}',           -- JSON: logical->odoo PM id
  settlement_model   TEXT DEFAULT 'discrete',     -- 'discrete' | 'owes_ledger'
  timezone           TEXT DEFAULT 'Asia/Kolkata',
  status             TEXT DEFAULT 'active',
  created_at         TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- IDENTITY / PERMISSION  (Darbar source of truth: staff_pin)
-- Role = COA coordinate (function x brand). The app DERIVES visible chambers
-- from the role's capability set — never hand-painted per person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  role_key     TEXT PRIMARY KEY,                  -- 'buyer','manager','owner','kitchen',...
  label        TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',        -- JSON array of capability keys
  rank         INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff (
  staff_pin   TEXT PRIMARY KEY,                   -- 4-digit, from Darbar hr_employees
  name        TEXT NOT NULL,
  role_key    TEXT NOT NULL,
  outlet_ids  TEXT NOT NULL DEFAULT '[]',         -- JSON array of outlet_id; [] = all
  brand       TEXT DEFAULT '',
  job_name    TEXT DEFAULT '',
  active      INTEGER DEFAULT 1,
  source      TEXT DEFAULT 'darbar',
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- SAUDA (purchase) — vendor + item masters AS DATA, outlet-scoped cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  vendor_key    TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  brand         TEXT DEFAULT 'both',              -- 'HE'|'NCH'|'both'
  outlet_scope  TEXT DEFAULT '[]',                -- JSON array of outlet_id; [] = all of brand
  category      TEXT DEFAULT '',
  fulfilment    TEXT DEFAULT 'deliver',           -- deliver|collect|standing|porter|bus
  pay_behaviour TEXT DEFAULT 'per',               -- per|khata_roll|khata_periodic
  phone         TEXT DEFAULT '',
  vpa_json      TEXT DEFAULT '[]',
  aliases_json  TEXT DEFAULT '[]',
  active        INTEGER DEFAULT 1,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  item_code      TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  unit           TEXT DEFAULT '',
  pack_label     TEXT DEFAULT '',
  price_paise    INTEGER DEFAULT 0,
  price_mode     TEXT DEFAULT 'fixed',            -- fixed | live
  default_vendor TEXT DEFAULT '',                 -- routing key -> vendors.vendor_key
  category       TEXT DEFAULT '',
  brand          TEXT DEFAULT '',
  active         INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_aliases (
  alias     TEXT PRIMARY KEY,                     -- lower-cased
  item_code TEXT NOT NULL
);

-- ONE VENDOR = ONE CARD  (per outlet, per business date)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id             TEXT NOT NULL,
  vendor_key            TEXT NOT NULL,
  for_date              TEXT NOT NULL,            -- business date YYYY-MM-DD (IST)
  status                TEXT NOT NULL DEFAULT 'ORDERED', -- ORDERED->RECEIVED->RAISED->PAID->RECONCILED
  expected_amount_paise INTEGER DEFAULT 0,
  pay_method            TEXT DEFAULT '',
  ordered_at  TEXT, ordered_by  TEXT,
  received_at TEXT, received_by TEXT, received_station TEXT, receive_note TEXT,
  raised_at   TEXT, raised_by   TEXT,
  paid_at     TEXT, pay_amount_paise INTEGER, bank_ref TEXT, reconciled_at TEXT,
  source      TEXT DEFAULT 'manual',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(outlet_id, vendor_key, for_date)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL,
  item_code         TEXT DEFAULT '',              -- '' = unresolved (productive failure)
  item_label        TEXT NOT NULL,               -- always keep the human label
  qty_ordered       REAL,
  uom               TEXT DEFAULT '',
  unit_cost_paise   INTEGER DEFAULT 0,
  line_amount_paise INTEGER DEFAULT 0,
  qty_received      REAL,
  receive_state     TEXT DEFAULT '',             -- ''|ok|short|over|missing
  flag              TEXT DEFAULT '',             -- decode/route flag (e.g. unknown item)
  raw               TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchase_media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  kind       TEXT NOT NULL,                       -- bill | goods
  r2_key     TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id   TEXT NOT NULL,
  vendor_key  TEXT NOT NULL,
  order_id    INTEGER,
  delta_paise INTEGER NOT NULL,                   -- +charge / -payment
  kind        TEXT NOT NULL,                      -- order|payment|adjust
  note        TEXT DEFAULT '',
  at          TEXT DEFAULT (datetime('now'))
);

-- indexes for the hot reads (day board, card lines, ledger)
CREATE INDEX IF NOT EXISTS ix_po_outlet_date  ON purchase_orders(outlet_id, for_date);
CREATE INDEX IF NOT EXISTS ix_po_status       ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS ix_pol_order       ON purchase_order_lines(order_id);
CREATE INDEX IF NOT EXISTS ix_pmedia_order    ON purchase_media(order_id);
CREATE INDEX IF NOT EXISTS ix_vledger_vendor  ON vendor_ledger(outlet_id, vendor_key);
CREATE INDEX IF NOT EXISTS ix_items_vendor    ON items(default_vendor);
