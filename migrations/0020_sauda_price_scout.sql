-- Sauda Price Scout MVP.
-- Additive only. No price seed rows. Money remains INTEGER paise.
-- Source behavior is data-owned here, not hardcoded in backend matching rules.

ALTER TABLE sx_item ADD COLUMN image_r2_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sx_item ADD COLUMN scout_active INTEGER NOT NULL DEFAULT 0 CHECK (scout_active IN (0,1));
ALTER TABLE sx_item ADD COLUMN mvp_rank INTEGER;

ALTER TABLE sx_price_batch ADD COLUMN source_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sx_price_batch ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sx_price_batch ADD COLUMN pinned_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sx_price_batch ADD COLUMN stale_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sx_price_batch ADD COLUMN host_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sx_price_batch ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sx_price_batch ADD COLUMN notes TEXT NOT NULL DEFAULT '';

ALTER TABLE sx_price_snapshot ADD COLUMN candidate_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sx_price_snapshot ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sx_price_snapshot ADD COLUMN live_state TEXT NOT NULL DEFAULT 'STALE'
  CHECK (live_state IN ('LIVE','STALE','DEAD'));
ALTER TABLE sx_price_snapshot ADD COLUMN match_decision TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (match_decision IN ('PENDING','EXACT','SUBSTITUTE','EMERGENCY','REJECT'));
ALTER TABLE sx_price_snapshot ADD COLUMN source_url TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS sx_source_profile (
  source_key               TEXT PRIMARY KEY,
  label                    TEXT NOT NULL,
  source_kind              TEXT NOT NULL
                            CHECK (source_kind IN ('B2B','QUICK_COMMERCE','MARKETPLACE','LOCAL_VENDOR','OTHER')),
  base_url                 TEXT NOT NULL DEFAULT '',
  priority_rank            INTEGER NOT NULL DEFAULT 100,
  liveness_threshold_hours INTEGER NOT NULL DEFAULT 24,
  discovery_enabled        INTEGER NOT NULL DEFAULT 1 CHECK (discovery_enabled IN (0,1)),
  refresh_enabled          INTEGER NOT NULL DEFAULT 1 CHECK (refresh_enabled IN (0,1)),
  capture_host             TEXT NOT NULL DEFAULT 'RTX',
  auth_mode                TEXT NOT NULL DEFAULT 'logged_in_browser',
  config_json              TEXT NOT NULL DEFAULT '{}',
  notes                    TEXT NOT NULL DEFAULT '',
  updated_by_pin           TEXT NOT NULL DEFAULT '',
  updated_at_ist           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
);

CREATE TABLE IF NOT EXISTS sx_source_search_phrase (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code      TEXT NOT NULL REFERENCES sx_item(item_code),
  source_key     TEXT NOT NULL REFERENCES sx_source_profile(source_key),
  phrase         TEXT NOT NULL,
  priority_rank  INTEGER NOT NULL DEFAULT 100,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  evidence_json  TEXT NOT NULL DEFAULT '{}',
  updated_by_pin TEXT NOT NULL DEFAULT '',
  updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
  UNIQUE (item_code, source_key, phrase)
);

CREATE TABLE IF NOT EXISTS sx_source_candidate (
  candidate_id       TEXT PRIMARY KEY,
  item_code          TEXT NOT NULL REFERENCES sx_item(item_code),
  source_key         TEXT NOT NULL REFERENCES sx_source_profile(source_key),
  source_sku         TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL,
  image_url          TEXT NOT NULL DEFAULT '',
  pack_size          TEXT NOT NULL DEFAULT '',
  unit_label         TEXT NOT NULL DEFAULT '',
  price_paise        INTEGER,
  unit_price_paise   INTEGER,
  currency           TEXT NOT NULL DEFAULT 'INR',
  url                TEXT NOT NULL DEFAULT '',
  captured_at_ist    TEXT NOT NULL,
  batch_id           TEXT NOT NULL DEFAULT '',
  evidence_json      TEXT NOT NULL DEFAULT '{}',
  live_state         TEXT NOT NULL DEFAULT 'STALE'
                      CHECK (live_state IN ('LIVE','STALE','DEAD')),
  match_decision     TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (match_decision IN ('PENDING','EXACT','SUBSTITUTE','EMERGENCY','REJECT')),
  is_pinned          INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  rejection_reason   TEXT NOT NULL DEFAULT '',
  owner_note         TEXT NOT NULL DEFAULT '',
  updated_by_pin     TEXT NOT NULL DEFAULT '',
  updated_at_ist     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
);

CREATE TABLE IF NOT EXISTS sx_item_source_map (
  item_code        TEXT NOT NULL REFERENCES sx_item(item_code),
  source_key       TEXT NOT NULL REFERENCES sx_source_profile(source_key),
  candidate_id     TEXT NOT NULL REFERENCES sx_source_candidate(candidate_id),
  mapping_state    TEXT NOT NULL
                   CHECK (mapping_state IN ('EXACT','SUBSTITUTE','EMERGENCY','REJECT')),
  is_pinned        INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  priority_rank    INTEGER NOT NULL DEFAULT 100,
  notes            TEXT NOT NULL DEFAULT '',
  evidence_json    TEXT NOT NULL DEFAULT '{}',
  updated_by_pin   TEXT NOT NULL DEFAULT '',
  updated_at_ist   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
  PRIMARY KEY (item_code, source_key, candidate_id)
);

CREATE TABLE IF NOT EXISTS sx_refresh_job (
  job_id            TEXT PRIMARY KEY,
  job_kind          TEXT NOT NULL
                    CHECK (job_kind IN ('WEEKLY_DISCOVERY','DAILY_PINNED_REFRESH','FALLBACK_SEARCH')),
  item_code         TEXT NOT NULL DEFAULT '',
  source_key        TEXT NOT NULL DEFAULT '',
  candidate_id      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  scheduled_for_ist TEXT NOT NULL DEFAULT '',
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT NOT NULL DEFAULT '',
  evidence_json     TEXT NOT NULL DEFAULT '{}',
  created_by_pin    TEXT NOT NULL DEFAULT '',
  created_at_ist    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
  updated_at_ist    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
);

CREATE INDEX IF NOT EXISTS idx_sx_item_scout_rank
  ON sx_item(scout_active, mvp_rank, label);

CREATE INDEX IF NOT EXISTS idx_sx_source_candidate_item_source
  ON sx_source_candidate(item_code, source_key, captured_at_ist DESC);

CREATE INDEX IF NOT EXISTS idx_sx_source_candidate_live
  ON sx_source_candidate(live_state, match_decision, is_pinned, unit_price_paise);

CREATE INDEX IF NOT EXISTS idx_sx_item_source_map_item
  ON sx_item_source_map(item_code, mapping_state, is_pinned, priority_rank);

CREATE INDEX IF NOT EXISTS idx_sx_refresh_job_status
  ON sx_refresh_job(status, job_kind, scheduled_for_ist);

INSERT OR IGNORE INTO sx_source_profile
  (source_key, label, source_kind, base_url, priority_rank, liveness_threshold_hours, capture_host, auth_mode, notes)
VALUES
  ('HYPERPURE', 'Hyperpure', 'B2B', 'https://www.hyperpure.com/', 10, 30, 'RTX', 'logged_in_browser', 'B2B catalogue and daily benchmark from owner logged-in browser session.'),
  ('ZEPTO', 'Zepto', 'QUICK_COMMERCE', 'https://www.zeptonow.com/', 20, 12, 'RTX', 'logged_in_browser', 'Quick-commerce fallback and price benchmark; location/session dependent.'),
  ('BLINKIT', 'Blinkit', 'QUICK_COMMERCE', 'https://blinkit.com/', 30, 12, 'RTX', 'logged_in_browser', 'Quick-commerce fallback and price benchmark; location/session dependent.'),
  ('INSTAMART', 'Instamart', 'QUICK_COMMERCE', 'https://www.swiggy.com/instamart', 40, 12, 'RTX', 'logged_in_browser', 'Quick-commerce fallback and price benchmark; location/session dependent.'),
  ('AMAZON', 'Amazon', 'MARKETPLACE', 'https://www.amazon.in/', 50, 24, 'RTX', 'logged_in_browser', 'Marketplace grocery/Now/Fresh/Business candidate discovery; availability depends on account/location.'),
  ('FLIPKART', 'Flipkart', 'MARKETPLACE', 'https://www.flipkart.com/', 60, 24, 'RTX', 'logged_in_browser', 'Flipkart Minutes/marketplace candidate discovery; availability depends on account/location.');
