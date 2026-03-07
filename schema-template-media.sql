CREATE TABLE IF NOT EXISTS template_media (
  template_name TEXT PRIMARY KEY,
  header_image_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
