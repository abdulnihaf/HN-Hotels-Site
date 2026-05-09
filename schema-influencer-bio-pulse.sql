-- Influencer Bio Pulse — enrich IG profiles via public web_profile_info endpoint
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-influencer-bio-pulse.sql
--
-- COA Doctrine fit:
--   ENTITY: influencer_handle (@username) — unique coordinate per IG account
--   ACTION: bio enrichment fetch (status enum: ok | not_found | rate_limit | error | private)
--   EVENT: refresh per handle (fetched_at)
--
-- Free public endpoint (no auth, no token, no Modash credit):
--   GET https://i.instagram.com/api/v1/users/web_profile_info/?username={handle}
--   Header: x-ig-app-id: 936619743392459

CREATE TABLE IF NOT EXISTS influencer_bio_pulse (
  username                    TEXT PRIMARY KEY,
  -- Raw response fields
  full_name                   TEXT,
  biography                   TEXT,
  external_url                TEXT,
  bio_links_json              TEXT,         -- JSON array of {url, title, link_type, lynx_url}
  category_name               TEXT,
  is_business_account         INTEGER NOT NULL DEFAULT 0,
  is_professional_account     INTEGER NOT NULL DEFAULT 0,
  is_verified                 INTEGER NOT NULL DEFAULT 0,
  is_private                  INTEGER NOT NULL DEFAULT 0,
  followers_count             INTEGER,
  following_count             INTEGER,
  media_count                 INTEGER,
  profile_pic_url             TEXT,
  business_email              TEXT,         -- usually NULL — IG doesn't surface this 95% of time
  business_phone_number       TEXT,
  business_contact_method     TEXT,         -- TEXT | EMAIL | CALL | UNKNOWN
  -- Regex-extracted from biography + bio_links (the actual gold)
  extracted_emails_json       TEXT,         -- JSON array of unique emails
  extracted_phones_json       TEXT,         -- JSON array of E.164-ish Indian mobiles
  extracted_whatsapp_json     TEXT,         -- JSON array of phone numbers from wa.me / whatsapp.com links
  -- Computed flags
  has_email                   INTEGER NOT NULL DEFAULT 0,
  has_phone                   INTEGER NOT NULL DEFAULT 0,
  has_whatsapp                INTEGER NOT NULL DEFAULT 0,
  has_any_contact             INTEGER NOT NULL DEFAULT 0,
  contact_channels            INTEGER NOT NULL DEFAULT 0,   -- 0..3 (email + phone + wa)
  -- Status / metadata
  status                      TEXT NOT NULL,       -- ok | not_found | rate_limit | error | private
  error_message               TEXT,
  source                      TEXT NOT NULL DEFAULT 'web_profile_info',
  raw_response_size           INTEGER,
  fetched_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  fetch_duration_ms           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ibp_has_contact ON influencer_bio_pulse(has_any_contact, followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_ibp_followers   ON influencer_bio_pulse(followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_ibp_status      ON influencer_bio_pulse(status, fetched_at);
CREATE INDEX IF NOT EXISTS idx_ibp_business    ON influencer_bio_pulse(is_business_account, has_any_contact);
CREATE INDEX IF NOT EXISTS idx_ibp_category    ON influencer_bio_pulse(category_name);

-- Track enrichment progress / batches
CREATE TABLE IF NOT EXISTS influencer_bio_pulse_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  total_requested INTEGER NOT NULL,
  total_processed INTEGER NOT NULL DEFAULT 0,
  total_ok        INTEGER NOT NULL DEFAULT 0,
  total_errors    INTEGER NOT NULL DEFAULT 0,
  total_rate_lim  INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  triggered_by    TEXT
);
