-- Autonomous influencer pipeline — Phase 1 schema.
--
-- Adds 3 tables that the cron Worker needs:
--   - influencer_discovery_queue : new handles awaiting Apify enrichment
--   - influencer_pipeline_runs   : audit log of every cron run (for /pipeline/ dashboard)
--   - influencer_pipeline_config : key-value config (mode, daily targets, hashtag rotation index)

CREATE TABLE IF NOT EXISTS influencer_discovery_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL,
  source          TEXT NOT NULL,                                  -- 'apify_hashtag' | 'apify_tagged' | 'modash' | 'manual'
  source_meta     TEXT,                                           -- JSON {hashtag, dataset_id, ...}
  discovered_at   TEXT NOT NULL DEFAULT (datetime('now')),
  enriched_at     TEXT,
  enrich_status   TEXT NOT NULL DEFAULT 'pending',                -- pending | enriching | enriched | failed | skipped_existing
  enrich_attempts INTEGER NOT NULL DEFAULT 0,
  enrich_error    TEXT,
  UNIQUE(username)
);
CREATE INDEX IF NOT EXISTS idx_idq_status   ON influencer_discovery_queue(enrich_status, discovered_at);
CREATE INDEX IF NOT EXISTS idx_idq_source   ON influencer_discovery_queue(source, discovered_at);

CREATE TABLE IF NOT EXISTS influencer_pipeline_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_name     TEXT NOT NULL,                                    -- 'discovery' | 'enrichment' | 'scoring' | 'outreach_wave'
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'running',                  -- running | ok | error | skipped
  count_in      INTEGER,                                          -- inputs processed
  count_out     INTEGER,                                          -- outputs produced
  cost_usd      REAL,                                             -- API cost (Apify/Anthropic) for this run
  notes         TEXT,                                             -- short summary
  error_msg     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ipr_cron    ON influencer_pipeline_runs(cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipr_status  ON influencer_pipeline_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS influencer_pipeline_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default config
INSERT OR IGNORE INTO influencer_pipeline_config (key, value, description) VALUES
  ('outreach_mode',          'dry_run',  'dry_run | live  — controls whether outreach actually sends'),
  ('outreach_daily_target',  '50',       'unique creators per day target (1 creator across N channels = 1)'),
  ('hero_per_day',           '5',        'HERO bucket creators sent daily (3 channels each)'),
  ('priority_per_day',       '15',       'PRIORITY bucket creators sent daily (2 channels each)'),
  ('standard_per_day',       '30',       'STANDARD bucket creators sent daily (1 channel each)'),
  ('discovery_enabled',      'true',     ''),
  ('enrichment_enabled',     'true',     ''),
  ('scoring_enabled',        'true',     ''),
  ('outreach_enabled',       'true',     ''),
  ('discovery_source',       'apify',    'apify | modash — switches when MODASH_API_KEY env is set'),
  ('hashtag_rotation_index', '0',        'Cron 1 advances this each run; mod-len of hashtag rotation array'),
  ('ai_personalization',     'true',     'Enable Claude Haiku personalization in outreach wave'),
  ('campaign',               'may_2026_v1', '');

-- Seed daily-rotation hashtag set for Cron 1 (avoids duplicate scraping)
-- 7 daily slots × 3 hashtags each = 21 hashtags rotating across week
INSERT OR IGNORE INTO influencer_pipeline_config (key, value, description) VALUES
  ('hashtag_rotation', '[
    ["bangalorefood","bangalorefoodbloggers","bangalorebiryani"],
    ["blrfoodies","blrfood","frazertownfood"],
    ["bangalorefoodie","mosqueroadbangalore","bengalurueats"],
    ["bangaloreblogger","bangalorerestaurants","bengaluru_food"],
    ["foodieblr","shivajinagarfood","biryanibangalore"],
    ["bangalorestreetfood","irani_chai","foodiesofbangalore"],
    ["nammafoodie","bangaloreeats","blrfoodlovers"]
  ]', 'JSON array of 7 daily slots, 3 hashtags each');
