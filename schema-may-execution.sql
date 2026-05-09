-- May 2026 — DO-OR-DIE Execution Command Center
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-may-execution.sql
--
-- COA Doctrine fit:
-- - ENTITY: HE May 2026 sales event (single instance, tracked over 31 days)
-- - ACTION: 7 marketing layers, each a trajectory through marketing space
-- - EVENT: daily sales updates (continuous, recomputed every 30 min)
--
-- Targets are coordinates: brand × month × layer × day → revenue paise
-- Status is enum (planning/executing/live/paused/done), no free-text.

CREATE TABLE IF NOT EXISTS may_layers (
  code                     TEXT PRIMARY KEY,                         -- influencer|flyer|tv|meta|google|aggregator|dine_aggregator
  name                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'planning',         -- planning|executing|live|paused|done
  expected_revenue_paise   INTEGER NOT NULL DEFAULT 0,                -- this layer's contribution forecast
  realized_revenue_paise   INTEGER NOT NULL DEFAULT 0,                -- attributed revenue (manual tag)
  description              TEXT,                                      -- 1-line summary
  notes                    TEXT,                                      -- richer notes
  chat_url                 TEXT,                                      -- link to the parallel chat doing this layer
  position                 INTEGER NOT NULL,                          -- display order
  is_bonus                 INTEGER NOT NULL DEFAULT 0,                -- 1 if not counted in 10L+3L primary target
  next_action              TEXT,                                      -- what's the next surgical step
  next_action_eta          TEXT,                                      -- ISO datetime
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by               TEXT
);

CREATE TABLE IF NOT EXISTS may_layer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  layer_code  TEXT NOT NULL,
  event_type  TEXT NOT NULL,                  -- status_change|note|revenue_attribute|next_action
  before_val  TEXT,
  after_val   TEXT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  actor       TEXT
);

CREATE INDEX IF NOT EXISTS idx_mle_layer ON may_layer_events(layer_code, ts DESC);

-- Daily snapshot of sales (one row per day, recomputed by cron)
CREATE TABLE IF NOT EXISTS may_daily_snapshots (
  date                       TEXT PRIMARY KEY,                       -- YYYY-MM-DD IST
  outlet_revenue_paise       INTEGER NOT NULL DEFAULT 0,             -- HE Cash Counter+Captain+Ground Floor (3 POS)
  outlet_orders              INTEGER NOT NULL DEFAULT 0,
  aggregator_revenue_paise   INTEGER NOT NULL DEFAULT 0,             -- HE Zomato+Swiggy delivery
  aggregator_orders          INTEGER NOT NULL DEFAULT 0,
  bonus_revenue_paise        INTEGER NOT NULL DEFAULT 0,             -- EazyDiner / Zomato Dining if tracked
  bonus_orders               INTEGER NOT NULL DEFAULT 0,
  required_pace_outlet_paise INTEGER,                                -- self-learning: target/day after redistribution
  required_pace_agg_paise    INTEGER,
  refreshed_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Runtime config (target overrides if needed mid-month)
CREATE TABLE IF NOT EXISTS may_config (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed: targets and layers
INSERT OR IGNORE INTO may_config (key, value_json) VALUES
  ('target_outlet_paise',       '"100000000"'),       -- ₹10,00,000 in paise
  ('target_aggregator_paise',   '"30000000"'),        -- ₹3,00,000 in paise
  ('month_start',               '"2026-05-01"'),
  ('month_end',                 '"2026-05-31"'),
  ('he_pos_configs',            '[5, 6, 32]'),        -- HE Cash Counter, Captain, Ground Floor Waiter Non-AC
  ('he_outlet_id_zomato',       '"22632449"'),
  ('he_outlet_id_swiggy',       '"1342887"');

-- Seed the 7 layers (positions = order of execution priority + display)
INSERT OR IGNORE INTO may_layers (code, name, position, status, description, is_bonus) VALUES
  ('influencer',       'Influencer Cover Booking',      1, 'planning', 'Cover-commitment matrix per follower tier; 605-creator DB live; auto-personalized DM/email outreach', 0),
  ('flyer',            'Flyer Distribution',            2, 'planning', '3 variant prints × 12 distribution channels (mosques, hospitals, hotels, auto stand, BMTC, valets, INOX last show)', 0),
  ('tv_conveyance',    'TV In-Outlet Conveyance',       3, 'planning', '6 TVs across outlet, psychology_v2 choreography, 1918 loop on TV-H1 (currently empty), day-part rotation by crowd persona', 0),
  ('meta_ads',         'Meta CTWA Ads',                 4, 'planning', 'CTWA cockpit live; 5 combo ads paused 21-Apr; restart after Faheem clears 146 leads + 9 unhandled intents', 0),
  ('google_ads',       'Google Ads / GMB Paid',         5, 'planning', 'Performance Max Local replacing broken Search campaign (QS=1 PAUSED); landing page fix needed', 0),
  ('aggregator',       'Swiggy + Zomato Delivery',      6, 'planning', 'Zomato live (49 orders Apr 30d); Swiggy dead since Apr 17 — needs revival diagnosis. Target: ₹3L', 0),
  ('dine_aggregator',  'EazyDiner / Zomato Dining / Dine-Out / District (BONUS)', 7, 'planning', 'Contracts signed, no /ops/ surface yet, no spend tracking. All revenue here = bonus on top of 10L+3L', 1);

-- Set initial expected revenue per layer (totals to ₹13L primary)
UPDATE may_layers SET expected_revenue_paise = 30000000 WHERE code = 'influencer';        -- 3L
UPDATE may_layers SET expected_revenue_paise = 15000000 WHERE code = 'flyer';             -- 1.5L
UPDATE may_layers SET expected_revenue_paise = 10000000 WHERE code = 'tv_conveyance';     -- 1L (in-store AOV lift)
UPDATE may_layers SET expected_revenue_paise = 25000000 WHERE code = 'meta_ads';          -- 2.5L (after funnel fix)
UPDATE may_layers SET expected_revenue_paise = 20000000 WHERE code = 'google_ads';        -- 2L (Performance Max Local)
UPDATE may_layers SET expected_revenue_paise = 30000000 WHERE code = 'aggregator';        -- 3L (Zomato + Swiggy delivery)
-- Total: 12.5L (a bit under because eid family pack + organic baseline carry the rest)
