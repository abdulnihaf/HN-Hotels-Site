-- naam_posts — organic social posting state machine (Chat 28)
-- Self-provisioned by functions/api/naam-post.js; kept here for schema review.

CREATE TABLE IF NOT EXISTS naam_posts (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,                       -- HE | NCH
  channels TEXT NOT NULL,                    -- JSON ["fb","ig","gbp"]
  idea_source TEXT,                          -- free-form brain identifier
  idea_json TEXT,                            -- JSON {theme, occasion?, item?, angle?, reference_image?}
  copy_json TEXT,                            -- JSON {fb, ig, gbp}
  image_keys_json TEXT,                      -- JSON {ig_11, ig_45, ig_916, gbp_43}
  status TEXT NOT NULL DEFAULT 'idea',       -- idea|drafted|approved|rendering|rendered|publishing|posted|failed
  guidance_note TEXT,                        -- owner free-text regeneration guidance
  precondition_check TEXT,                   -- JSON render/publish preconditions
  result_json TEXT,                          -- JSON per-channel post ids / errors
  requested_at TEXT NOT NULL,                -- IST ISO8601
  posted_at TEXT,                            -- IST ISO8601
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_np_brand_status ON naam_posts(brand, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_np_brand_created ON naam_posts(brand, created_at DESC);
