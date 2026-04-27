-- Unified money-movement ledger for HN Hotels. Every rupee in or out of any
-- instrument (bank account, payment gateway balance, wallet, cash counter)
-- lands here. One source of truth for cashflow across:
--
--   source             instrument                     evidence path
--   ──────             ──────────                     ─────────────
--   hdfc               hdfc_ca_4680 (HN Hotels PL)    email alert → Email Worker
--   razorpay           razorpay_balance                webhook → Worker
--   paytm              paytm_counter_nihaf             webhook → Worker  (when enabled)
--   zomato_delivery    hdfc_ca_4680 (via settlement)   aggregator API / email parse
--   zomato_dining      hdfc_ca_4680 (via settlement)   aggregator API / email parse
--   swiggy             hdfc_ca_4680 (via settlement)   aggregator API / email parse
--   eazydiner          hdfc_ca_4680 (via settlement)   aggregator API
--   federal            federal_ca (expenses account)   email parse (pending)
--   manual             any                             typed into dashboard
--
-- Cross-source reconciliation: one gross Razorpay payout (source=razorpay,
-- direction=debit from razorpay_balance) maps to one HDFC credit (source=hdfc,
-- direction=credit to hdfc_ca_4680) via money_recon_matches. Keeps "same
-- money, two views" visible without double-counting.
--
-- Money is stored as INTEGER paise. Rupees = paise / 100.0 in the read layer.
-- Avoids IEEE-754 drift in SUM() and equality matches.
--
-- Run:
--   cd HN-Hotels-Site
--   wrangler d1 execute hn-hiring --remote --file=schema-money-events.sql

CREATE TABLE IF NOT EXISTS money_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  source TEXT NOT NULL
    CHECK (source IN ('hdfc','federal','razorpay','paytm',
                      'zomato_delivery','zomato_dining','swiggy','eazydiner',
                      'manual','unknown')),
  source_ref TEXT,                 -- source-native id (UPI Ref, Razorpay payment_id, Zomato payout_id)
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  balance_paise_after INTEGER,     -- only set when the source exposes it (banks)

  instrument TEXT NOT NULL,        -- hdfc_ca_4680 | razorpay_balance | paytm_counter | ...
  channel TEXT,                    -- upi | card | neft | imps | rtgs | wallet | internal | charges | atm
  counterparty TEXT,               -- human-readable merchant / payer
  counterparty_ref TEXT,           -- VPA, phone, UPI handle
  narration TEXT,

  txn_at TEXT,                     -- ISO UTC; NULL if parser couldn't find it (row becomes 'partial')
  received_at TEXT NOT NULL,       -- when our ingest saw it

  parse_status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (parse_status IN ('parsed','partial','failed','quarantined')),

  -- Raw evidence retained for forensic reparse.
  raw_subject TEXT,
  raw_body TEXT,
  raw_payload TEXT,                -- JSON blob for API sources (Razorpay etc.)

  -- Reconciliation state
  reconcile_status TEXT NOT NULL DEFAULT 'unreconciled'
    CHECK (reconcile_status IN ('unreconciled','auto','manual','ignored')),
  matched_expense_id INTEGER,
  matched_vendor_bill_id INTEGER,
  matched_payout_platform TEXT,
  reconciled_at TEXT,
  reconciled_by TEXT,

  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_me_txn_at        ON money_events(txn_at);
CREATE INDEX IF NOT EXISTS idx_me_received_at   ON money_events(received_at);
CREATE INDEX IF NOT EXISTS idx_me_source        ON money_events(source);
CREATE INDEX IF NOT EXISTS idx_me_direction     ON money_events(direction);
CREATE INDEX IF NOT EXISTS idx_me_instrument    ON money_events(instrument);
CREATE INDEX IF NOT EXISTS idx_me_reconcile     ON money_events(reconcile_status);
CREATE INDEX IF NOT EXISTS idx_me_counterparty  ON money_events(counterparty);
CREATE INDEX IF NOT EXISTS idx_me_parse_status  ON money_events(parse_status);

-- Idempotency: two guards, because different sources have different ID guarantees.
--
-- (a) When a source_ref exists, the (source, source_ref, direction, amount_paise, txn_at)
--     tuple is unique. HDFC famously reuses refs across legitimately-different
--     events (batched ATM-fee debits on different dates, POS swipe-reversal
--     pairs with signed amounts). Including direction/amount/date keeps
--     those as separate ledger entries while still catching true dupes
--     (same webhook delivered twice → identical on every field).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_me_source_ref
  ON money_events(source, source_ref, direction, amount_paise, txn_at)
  WHERE source_ref IS NOT NULL;

-- (b) When no source_ref (POS swipes, some email parses), the fingerprint
--     of (source, instrument, direction, amount_paise, txn_at) is the
--     dedup key. txn_at MUST be non-null for this path — rows with a null
--     txn_at are stored as 'partial' and must be resolved via reparse.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_me_fingerprint
  ON money_events(source, instrument, direction, amount_paise, txn_at)
  WHERE source_ref IS NULL AND txn_at IS NOT NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Source health / watchdog. One row per (source, instrument). A simple cron
-- or an on-read check flags any source whose last event is older than
-- expected_max_gap_minutes. Dashboard renders a red banner. Fallback signal:
-- if HDFC email stops flowing, watchdog tells you before your books go
-- stale.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS money_source_health (
  source TEXT NOT NULL,
  instrument TEXT NOT NULL,
  last_event_at TEXT,
  last_event_id INTEGER,
  expected_max_gap_minutes INTEGER NOT NULL DEFAULT 1440,  -- 24h
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('healthy','stale','silent','unknown','disabled')),
  last_checked_at TEXT,
  notes TEXT DEFAULT '',
  PRIMARY KEY (source, instrument)
);

-- Seed known sources with expected cadences + brand mapping (tune later).
-- Silent = no event ever, Stale = past gap, Healthy = within gap.
--
-- Brand attribution:
--   razorpay         → NCH  (Nawabi Chai House uses Razorpay for card/UPI)
--   paytm            → HE   (Hamza Express uses Paytm for UPI)
--   hdfc / federal   → mixed; infer brand from counterparty (payee registry + classifier)
--   zomato_delivery  → inferred from order context (aggregator payout splits)
--   zomato_dining    → HE primarily (HE is listed on Zomato Dining)
--   swiggy           → HE (Swiggy delivery revenue)
--   eazydiner        → HE
INSERT OR IGNORE INTO money_source_health (source, instrument, expected_max_gap_minutes, notes) VALUES
  ('hdfc',            'hdfc_ca_4680',        1440, 'HN Hotels PL current account; per-txn email alert; monthly e-stmt as ground truth'),
  ('razorpay',        'razorpay_balance',    2880, 'Brand: NCH. Webhook on payment/payout/settlement events'),
  ('paytm',           'paytm_counter_nihaf', 2880, 'Brand: HE. Awaiting Paytm merchant API access (requested 2026-04)'),
  ('zomato_delivery', 'hdfc_ca_4680',       10080, 'Weekly settlement via HDFC NEFT'),
  ('zomato_dining',   'hdfc_ca_4680',       10080, 'Brand: HE. Weekly settlement via HDFC NEFT'),
  ('swiggy',          'hdfc_ca_4680',       10080, 'Brand: HE. Weekly settlement via HDFC NEFT'),
  ('eazydiner',       'hdfc_ca_4680',       10080, 'Brand: HE. Monthly settlement'),
  ('federal',         'federal_ca',         10080, 'Secondary account, expenses. NetBanking activation pending 2026-04');

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Cross-source reconciliation matches. When one aggregator payout (gross)
-- corresponds to one bank credit (net), link them here with the delta
-- (commission). Lets /ops/bank/ show "gross ₹10,000 - ₹1,740 commission =
-- ₹8,260 net" without counting the rupees twice in rollups.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS money_recon_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gross_event_id INTEGER NOT NULL,        -- e.g. zomato_dining credit
  net_event_id INTEGER NOT NULL,          -- e.g. hdfc credit (after commission)
  commission_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  matched_at TEXT NOT NULL,
  matched_by TEXT NOT NULL,
  FOREIGN KEY (gross_event_id) REFERENCES money_events(id),
  FOREIGN KEY (net_event_id)   REFERENCES money_events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_recon_pair
  ON money_recon_matches(gross_event_id, net_event_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Monthly e-Statement audit layer (from HDFC PDF). Authoritative closing
-- balance per month per account — compared against SUM(money_events) to
-- detect drift. Populated by a separate monthly PDF parser.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS money_monthly_statement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  statement_month TEXT NOT NULL,     -- YYYY-MM
  opening_paise INTEGER NOT NULL,
  closing_paise INTEGER NOT NULL,
  total_credits_paise INTEGER NOT NULL,
  total_debits_paise INTEGER NOT NULL,
  txn_count INTEGER NOT NULL,
  pdf_sha256 TEXT,
  parsed_at TEXT NOT NULL,
  notes TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_monthly_stmt
  ON money_monthly_statement(instrument, statement_month);
