-- HE keyword volume tracker — Bangalore-wide search volume for HE-relevant queries.
-- Refreshed weekly by /api/keyword-tracker?action=fetch (cron-triggered).
-- Joined with HE GBP search query data at read time to expose impression-share gaps.
--
-- One row per (keyword, captured_at) snapshot. Keyword Planner returns monthly
-- avg search volume — daily refresh would be wasteful since the underlying number
-- only changes monthly.
CREATE TABLE IF NOT EXISTS kw_volumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  block TEXT,                            -- 'generic_near_me' | 'shivajinagar' | 'hero' | 'landmark' | 'other'
  captured_at TEXT NOT NULL,             -- ISO date YYYY-MM-DD (IST)
  avg_monthly_searches INTEGER NOT NULL,
  low_bid_inr REAL,
  high_bid_inr REAL,
  competition TEXT,                      -- 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED'
  competition_index INTEGER,             -- 0..100
  location_id TEXT NOT NULL DEFAULT '1007768', -- Bangalore geoTargetConstant
  UNIQUE(keyword, captured_at, location_id)
);
CREATE INDEX IF NOT EXISTS idx_kw_kw_time    ON kw_volumes (keyword, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_kw_block_time ON kw_volumes (block,   captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_kw_time       ON kw_volumes (captured_at DESC);
