-- Apify multi-vector discovery — Phase 1 schema additions.
--
-- Goal: match Modash data quality for BLR food micro influencers using 4
-- discovery vectors (hashtag / geotag / tagged-user / comment-author) plus
-- enriched per-creator signals (engagement rate, recency, topic density).

-- Per-creator extended signals
ALTER TABLE influencer_bio_pulse ADD COLUMN engagement_rate REAL;
ALTER TABLE influencer_bio_pulse ADD COLUMN last_post_at TEXT;
ALTER TABLE influencer_bio_pulse ADD COLUMN food_topic_density REAL;
ALTER TABLE influencer_bio_pulse ADD COLUMN avg_likes_per_post INTEGER;
ALTER TABLE influencer_bio_pulse ADD COLUMN avg_comments_per_post INTEGER;
ALTER TABLE influencer_bio_pulse ADD COLUMN posts_analyzed INTEGER;

CREATE INDEX IF NOT EXISTS idx_ibp_er         ON influencer_bio_pulse(engagement_rate DESC) WHERE engagement_rate IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ibp_last_post  ON influencer_bio_pulse(last_post_at DESC) WHERE last_post_at IS NOT NULL;

-- Track which discovery vectors found each creator (multi-vector bonus)
-- Each row = one (creator, vector) discovery event.
CREATE TABLE IF NOT EXISTS influencer_discovery_vectors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL,
  vector          TEXT NOT NULL CHECK(vector IN ('apify_hashtag','apify_geotag','apify_tagged','apify_comments','modash','manual')),
  source_meta     TEXT,             -- JSON: {hashtag, location_id, source_username, post_url, ...}
  discovered_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(username, vector)          -- a creator counted ONCE per vector regardless of repeat hits
);
CREATE INDEX IF NOT EXISTS idx_idv_username ON influencer_discovery_vectors(username);
CREATE INDEX IF NOT EXISTS idx_idv_vector   ON influencer_discovery_vectors(vector, discovered_at);

-- Backfill discovery_vectors for existing 'apify_hashtag' / 'apify_profile_scraper' rows
INSERT OR IGNORE INTO influencer_discovery_vectors (username, vector, source_meta, discovered_at)
SELECT username, 'apify_hashtag', json_object('backfill', 1), fetched_at
FROM influencer_bio_pulse
WHERE source IN ('apify_hashtag', 'apify_profile_scraper', 'apify_profile_cron');

-- Pipeline config additions for new vectors
INSERT OR IGNORE INTO influencer_pipeline_config (key, value, description) VALUES
  ('discovery_vector_today', 'hashtag',
    'Which vector cron-discover runs today: hashtag | geotag | tagged | comments. Cron auto-rotates daily.'),

  ('geotag_locations', '[
    {"name":"Mosque Road","url":"https://www.instagram.com/explore/locations/241624719333054/mosque-road/"},
    {"name":"Frazer Town","url":"https://www.instagram.com/explore/locations/253149944/frazer-town/"},
    {"name":"Shivajinagar","url":"https://www.instagram.com/explore/locations/270094783/shivajinagar/"},
    {"name":"VV Puram Food Street","url":"https://www.instagram.com/explore/locations/216691428453568/vv-puram-food-street/"},
    {"name":"Indiranagar","url":"https://www.instagram.com/explore/locations/213164262/indiranagar/"},
    {"name":"Koramangala","url":"https://www.instagram.com/explore/locations/214111852/koramangala/"},
    {"name":"Brigade Road","url":"https://www.instagram.com/explore/locations/216043728/brigade-road/"},
    {"name":"Commercial Street","url":"https://www.instagram.com/explore/locations/213389762/commercial-street/"}
  ]', 'BLR food geotag location pages — Apify scrapes each for ownerUsernames.'),

  ('geotag_posts_per_location', '50',
    'Apify scrapes this many recent posts per geotag location.'),

  ('tagged_seed_strategy', 'top_blr_food',
    'Algorithm to pick seed creators for tagged-user expansion. top_blr_food = top-N by score in BLR-food bucket.'),

  ('tagged_seed_count', '20',
    'How many seed creators per tagged-user-expansion run.'),

  ('tagged_posts_per_seed', '12',
    'Apify scrapes last N posts per seed; extracts taggedUsers from each.'),

  ('comment_post_urls', '[]',
    'JSON array of recent BLR food viral post URLs to scrape commenters from. Manually curated; updated weekly. Empty = skip.'),

  ('comment_authors_per_post', '300',
    'Apify scrapes top N commenters per post URL.'),

  ('enrichment_min_er', '0.005',
    'Skip creators with ER below this threshold during enrichment (saves processing dead accounts).'),

  ('enrichment_active_window_days', '60',
    'Skip creators whose last post is older than this (likely dormant).'),

  ('multi_vector_bonus_per_extra', '0.5',
    'Score bonus added per ADDITIONAL discovery vector that found the same creator.');
