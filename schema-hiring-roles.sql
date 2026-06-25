-- HN Hotels Hiring — Role registry + campaign intelligence schema
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-hiring-roles.sql

-- Canonical hiring roles (COA: role × brand × channel × priority)
CREATE TABLE IF NOT EXISTS hiring_roles (
  role_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'he',      -- 'he' | 'nch' | 'both'
  creative_key TEXT,                      -- C01–C28 creative taxonomy
  poster_url TEXT,                        -- public image URL for template header
  default_package TEXT,                   -- e.g. "₹18,000–24,000/month + food + stay"
  always_need INTEGER NOT NULL DEFAULT 0, -- 1 = permanent open role
  priority_score INTEGER NOT NULL DEFAULT 50, -- 0-100
  churn_rank INTEGER NOT NULL DEFAULT 50,
  template_name TEXT NOT NULL DEFAULT 'hn_hiring_v1',
  odoo_job_names TEXT,                    -- JSON array of matching Odoo job names
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Learned outcomes: reply → join by (role, template, commission tier, language, send bucket)
CREATE TABLE IF NOT EXISTS campaign_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  role_key TEXT,
  template_name TEXT,
  commission TEXT,
  language TEXT DEFAULT 'en',
  send_time_bucket TEXT,                  -- e.g. "10:00-12:00"
  replied INTEGER DEFAULT 0,
  joined INTEGER DEFAULT 0,
  ignored INTEGER DEFAULT 0,
  not_now INTEGER DEFAULT 0,
  customer_noise INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (role_key) REFERENCES hiring_roles(role_key)
);

-- Extend campaigns with campaign-level variables used by the flexible template
ALTER TABLE campaigns ADD COLUMN commission TEXT;
ALTER TABLE campaigns ADD COLUMN package TEXT;
ALTER TABLE campaigns ADD COLUMN poster_url TEXT;
ALTER TABLE campaigns ADD COLUMN role_key TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hiring_roles_brand ON hiring_roles(brand, active);
CREATE INDEX IF NOT EXISTS idx_hiring_roles_priority ON hiring_roles(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_outcomes_role ON campaign_outcomes(role_key, template_name);
CREATE INDEX IF NOT EXISTS idx_campaigns_role_key ON campaigns(role_key);
