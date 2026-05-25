-- Captain POS Guard — zero-leakage capture + reconciliation + WABA alerting
-- Apply: wrangler d1 execute hn-hiring --file=migrations/schema-captain-pos-guard.sql --remote
--
-- Design (COA): every rung order is a coordinate. The on-device extension writes
-- each order here the instant it is rung (independent of whether Odoo accepted it).
-- The reconciler then proves each captured order became a real Odoo bill; anything
-- that didn't is revenue leakage → a discrepancy → immediate WABA to Nihaf.

-- ── Durable server copy of the on-device local log ───────────────────────────
-- One row per order the captain tab attempted, keyed by the POS client uid so
-- repeated beacons from the device upsert instead of duplicating.
CREATE TABLE IF NOT EXISTS pos_capture (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id       TEXT    NOT NULL,                 -- which tab/browser captured it
  client_uid      TEXT    NOT NULL,                 -- POS order client uid (dedup + match key)
  pos_reference   TEXT,                             -- e.g. "Order 2670-6-000005" if present
  config_id       INTEGER,                          -- 6 = HE Captain
  login_number    TEXT,                             -- POS login counter (bumps on reload)
  amount_total    REAL    NOT NULL DEFAULT 0,
  line_count      INTEGER NOT NULL DEFAULT 0,
  captured_at     INTEGER NOT NULL,                 -- unix sec, when the device rang it
  -- what the device observed about the server sync at capture time:
  --   ok | error | session_expired | offline | pending | unknown
  sync_observed   TEXT    NOT NULL DEFAULT 'unknown',
  raw_json        TEXT,                             -- full captured payload for audit
  -- reconciliation outcome (set by the cron reconciler):
  matched         INTEGER NOT NULL DEFAULT 0,       -- 1 = found as a real Odoo bill
  matched_order_id INTEGER,
  matched_at      INTEGER,
  reconcile_tries INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_poscap_uid     ON pos_capture(client_uid);
CREATE INDEX        IF NOT EXISTS idx_poscap_unmatch ON pos_capture(matched, captured_at);

-- ── Device-side error / connectivity events ──────────────────────────────────
-- session_expired, server_error, offline, online, heartbeat. These let us alert
-- in real time (the moment the device sees a failure) and power the silence check.
CREATE TABLE IF NOT EXISTS pos_capture_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  detail      TEXT,
  client_uid  TEXT,                                 -- order this event relates to, if any
  at          INTEGER NOT NULL,                     -- unix sec on device
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_posevt_type ON pos_capture_events(type, at);

-- ── Deduped discrepancies + notification state ───────────────────────────────
CREATE TABLE IF NOT EXISTS pos_discrepancies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint   TEXT    NOT NULL,                    -- dedup key (kind + natural id)
  kind          TEXT    NOT NULL,                    -- order_not_billed | stuck_draft | session_stale | payment_no_bill | pos_silent | device_error
  severity      TEXT    NOT NULL DEFAULT 'high',     -- critical | high | medium | low
  amount        REAL    NOT NULL DEFAULT 0,
  title         TEXT    NOT NULL,
  detail        TEXT,
  evidence_json TEXT,
  detected_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  -- WABA notify state:
  notified_at   INTEGER,
  notify_status TEXT,                                -- sent | failed | suppressed
  notify_msg_id TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  resolved_at   INTEGER,
  resolved_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posdisc_fp     ON pos_discrepancies(fingerprint);
CREATE INDEX        IF NOT EXISTS idx_posdisc_open   ON pos_discrepancies(resolved, detected_at);

-- ── Runtime-adjustable config (no redeploy to tune) ──────────────────────────
CREATE TABLE IF NOT EXISTS pos_guard_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO pos_guard_config (key, value) VALUES
  ('captain_config_id',        '6'),
  ('match_grace_seconds',      '240'),   -- wait this long before calling a capture "missing"
  ('stuck_draft_minutes',      '15'),    -- draft older than this = stuck
  ('session_stale_hours',      '24'),    -- session open longer than this = flag
  ('silence_minutes',          '40'),    -- no captures + no new orders during open hours = POS silent
  ('open_hour_ist',            '7'),     -- silence check active window (IST)
  ('close_hour_ist',           '3'),     -- ...wraps past midnight to 03:00 IST
  ('reconcile_max_tries',      '8'),     -- stop re-checking a capture after N cron passes
  ('nihaf_phone',              '917010426808');
