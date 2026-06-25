-- Migration: add status_join column to fb_groups for tagged Drive-sheet re-import
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-fb-posting-add-status-join.sql

ALTER TABLE fb_groups ADD COLUMN status_join TEXT DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_fb_groups_status_join ON fb_groups(status_join);
