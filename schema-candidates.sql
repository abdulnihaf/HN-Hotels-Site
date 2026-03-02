-- Candidates table for hn-hiring D1
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-candidates.sql

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  first_name TEXT,
  he_role TEXT NOT NULL,
  he_salary TEXT,
  db_role TEXT,
  current_title TEXT,
  current_company TEXT,
  previous_title TEXT,
  previous_company TEXT,
  city TEXT,
  is_bangalore INTEGER DEFAULT 0,
  experience TEXT,
  current_salary INTEGER DEFAULT 0,
  skills TEXT,
  english_level TEXT,
  education TEXT,
  age TEXT,
  gender TEXT,
  has_personalization INTEGER DEFAULT 0,
  source TEXT,
  wa_accessible TEXT,
  campaign_status TEXT DEFAULT 'none',
  last_campaign_id INTEGER,
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (last_campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);
CREATE INDEX IF NOT EXISTS idx_candidates_role ON candidates(he_role);
CREATE INDEX IF NOT EXISTS idx_candidates_bangalore ON candidates(is_bangalore);
CREATE INDEX IF NOT EXISTS idx_candidates_personalization ON candidates(has_personalization);
CREATE INDEX IF NOT EXISTS idx_candidates_campaign_status ON candidates(campaign_status);
