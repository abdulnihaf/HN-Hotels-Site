-- Modash multi-account rotation infra.
-- Owner pre-logs each of N trial accounts on hn-winpc Chrome (one-time, per-account
-- isolated user-data-dir). Cookies persist for ~30 days; driver rides the session.
-- Pace deliberately slow (1 search per profile per day, spread across hours) to stay
-- below Modash's anti-abuse heuristics. No passwords stored anywhere.

CREATE TABLE IF NOT EXISTS modash_profiles (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_num              INTEGER UNIQUE NOT NULL,            -- 1..10 (or whatever)
  email                    TEXT,                                -- account email — never password
  status                   TEXT NOT NULL DEFAULT 'pending_setup',
                                                                -- pending_setup → active → depleted | broken
  searches_today           INTEGER NOT NULL DEFAULT 0,
  searches_lifetime        INTEGER NOT NULL DEFAULT 0,
  unlocks_today            INTEGER NOT NULL DEFAULT 0,
  unlocks_lifetime         INTEGER NOT NULL DEFAULT 0,
  last_used_at             TEXT,
  cookies_setup_at         TEXT,                                -- when owner ran setup-modash-profile.ps1 last
  cookies_invalid_at       TEXT,                                -- last time poller reported expired cookies
  notes                    TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mp_status ON modash_profiles(status, last_used_at);

CREATE TABLE IF NOT EXISTS modash_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  status                   TEXT NOT NULL DEFAULT 'pending',     -- pending | running | done | failed
  job_type                 TEXT NOT NULL DEFAULT 'search',      -- search | unlock | audience
  profile_num              INTEGER,                             -- assigned at pick-time
  search_filters_json      TEXT NOT NULL,                       -- {location, followers_from, followers_to, topics, ...}
  result_count             INTEGER,
  result_summary           TEXT,                                -- short text of yield e.g. "47 unique creators"
  picked_at                TEXT,
  completed_at             TEXT,
  error_msg                TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mj_status ON modash_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_mj_profile ON modash_jobs(profile_num, completed_at);

-- Default search filters used by cron-discover when enqueuing Modash jobs
INSERT OR IGNORE INTO influencer_pipeline_config (key, value, description) VALUES
  ('modash_default_filters', '{
    "location": "Bangalore",
    "country": "India",
    "followers_from": 5000,
    "followers_to": 100000,
    "topics": ["food","foodblogger","restaurant","cafe"],
    "language": ["en","hi","ur","kn"],
    "engagement_rate_from": 0.015,
    "lastpost_within_days": 30,
    "page_limit": 1
  }', 'JSON filter set passed to Modash search UI by hn-winpc poller'),
  ('modash_searches_per_profile_per_day', '1', 'Throttle — pace deliberately slow to avoid anti-abuse'),
  ('modash_enabled', 'false', 'Toggle the Modash discovery branch in cron-discover');
