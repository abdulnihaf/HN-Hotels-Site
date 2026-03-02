-- HN Hotels Hiring — Schema v2 Migration
-- Adds conversations table for inbox/reply tracking
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-hiring-v2.sql

-- Conversations table: tracks all inbound replies + outbound replies
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  campaign_id INTEGER,
  message_id INTEGER,
  candidate_name TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  msg_type TEXT DEFAULT 'text',
  body TEXT,
  wamid TEXT,
  status TEXT DEFAULT 'unread',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_campaign ON conversations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversations_wamid ON conversations(wamid);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

-- Add reply tracking columns to messages
ALTER TABLE messages ADD COLUMN has_reply INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN last_reply_at TEXT;
