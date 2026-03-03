-- Facebook Group Posting — D1 Schema
-- Tables: fb_groups, fb_creatives, fb_posts, fb_sessions

-- Facebook groups database
CREATE TABLE IF NOT EXISTS fb_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_url TEXT NOT NULL UNIQUE,
  group_id TEXT,
  name TEXT NOT NULL,
  visibility TEXT DEFAULT 'Public',
  members_raw TEXT,
  members_parsed INTEGER DEFAULT 0,
  posts_activity TEXT,
  category TEXT,
  sub_category TEXT,
  keywords TEXT,
  status TEXT DEFAULT 'active',
  total_posts INTEGER DEFAULT 0,
  last_posted_at TEXT,
  last_posted_creative_id INTEGER,
  creatives_posted TEXT,
  is_blocked INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fb_groups_status ON fb_groups(status);
CREATE INDEX IF NOT EXISTS idx_fb_groups_members ON fb_groups(members_parsed);
CREATE INDEX IF NOT EXISTS idx_fb_groups_category ON fb_groups(category);

-- Creatives library (reusable post templates)
CREATE TABLE IF NOT EXISTS fb_creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT DEFAULT 'Hamza Express',
  post_text TEXT,
  image_filename TEXT,
  post_type TEXT DEFAULT 'text_photo',
  times_used INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Post tracking (every post attempt)
CREATE TABLE IF NOT EXISTS fb_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  creative_id INTEGER NOT NULL,
  session_id INTEGER,
  account_name TEXT DEFAULT 'default',
  status TEXT DEFAULT 'queued',
  error_message TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES fb_groups(id),
  FOREIGN KEY (creative_id) REFERENCES fb_creatives(id)
);
CREATE INDEX IF NOT EXISTS idx_fb_posts_status ON fb_posts(status);
CREATE INDEX IF NOT EXISTS idx_fb_posts_group ON fb_posts(group_id);
CREATE INDEX IF NOT EXISTS idx_fb_posts_creative ON fb_posts(creative_id);
CREATE INDEX IF NOT EXISTS idx_fb_posts_session ON fb_posts(session_id);

-- Posting sessions (batch tracking)
CREATE TABLE IF NOT EXISTS fb_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL,
  account_name TEXT DEFAULT 'default',
  total_groups INTEGER DEFAULT 0,
  posted_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (creative_id) REFERENCES fb_creatives(id)
);
