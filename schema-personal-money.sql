-- Personal HDFC ledger — fully isolated from HN Hotels finance.
-- Schema mirrors money_events for code reuse, but lives in its own D1
-- (hn-personal-finance) so personal data never touches /ops/bank/ or any
-- HN-Hotels rollup.
--
-- Account: HDFC SA 50100849934005 (tail 4005), Card 406584XXXXXX8891 (tail 8891)
-- Customer ID: 342720829
--
-- Run:
--   wrangler d1 execute hn-personal-finance --remote --file=schema-personal-money.sql

CREATE TABLE IF NOT EXISTS money_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  source TEXT NOT NULL
    CHECK (source IN ('hdfc','manual','unknown')),
  source_ref TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  balance_paise_after INTEGER,

  instrument TEXT NOT NULL,        -- hdfc_sa_4005
  channel TEXT,
  counterparty TEXT,
  counterparty_ref TEXT,
  narration TEXT,

  txn_at TEXT,
  received_at TEXT NOT NULL,

  parse_status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (parse_status IN ('parsed','partial','failed','quarantined')),

  raw_subject TEXT,
  raw_body TEXT,
  raw_payload TEXT,

  reconcile_status TEXT NOT NULL DEFAULT 'unreconciled'
    CHECK (reconcile_status IN ('unreconciled','auto','manual','ignored')),
  reconciled_at TEXT,
  reconciled_by TEXT,

  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_me_txn_at        ON money_events(txn_at);
CREATE INDEX IF NOT EXISTS idx_me_received_at   ON money_events(received_at);
CREATE INDEX IF NOT EXISTS idx_me_direction     ON money_events(direction);
CREATE INDEX IF NOT EXISTS idx_me_parse_status  ON money_events(parse_status);
CREATE INDEX IF NOT EXISTS idx_me_counterparty  ON money_events(counterparty);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_me_source_ref
  ON money_events(source, source_ref, direction, amount_paise, txn_at)
  WHERE source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_me_fingerprint
  ON money_events(source, instrument, direction, amount_paise, txn_at)
  WHERE source_ref IS NULL AND txn_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS money_source_health (
  source TEXT NOT NULL,
  instrument TEXT NOT NULL,
  last_event_at TEXT,
  last_event_id INTEGER,
  expected_max_gap_minutes INTEGER NOT NULL DEFAULT 1440,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('healthy','stale','silent','unknown','disabled')),
  last_checked_at TEXT,
  notes TEXT DEFAULT '',
  PRIMARY KEY (source, instrument)
);

INSERT OR IGNORE INTO money_source_health (source, instrument, expected_max_gap_minutes, notes) VALUES
  ('hdfc', 'hdfc_sa_4005', 4320, 'Personal HDFC SA; per-txn email alert; quieter than business account so 72h gap');
