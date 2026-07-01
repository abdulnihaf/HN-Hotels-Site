-- HN Hotels Communications Inbox
-- Additive D1 schema for the standalone native HE/NCH WhatsApp inbox.
-- Run after review:
--   wrangler d1 execute hn-hiring --remote --file=schema-comms-inbox.sql

CREATE TABLE IF NOT EXISTS comms_threads (
  thread_id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  phone TEXT NOT NULL,
  wa_id TEXT,
  phone_number_id TEXT,
  display_name TEXT,
  lead_status TEXT DEFAULT 'unknown',
  lead_source TEXT,
  lead_context_json TEXT,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TEXT,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  last_body TEXT,
  last_direction TEXT,
  last_msg_type TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  service_window_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(brand, phone)
);

CREATE INDEX IF NOT EXISTS idx_comms_threads_brand_time
  ON comms_threads(brand, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_threads_unread
  ON comms_threads(unread_count, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_threads_status
  ON comms_threads(status, lead_status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_threads_phone
  ON comms_threads(phone);

CREATE TABLE IF NOT EXISTS comms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,
  msg_type TEXT DEFAULT 'text',
  body TEXT,
  template_name TEXT,
  wamid TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  provider_response TEXT,
  error_text TEXT,
  media_id TEXT,
  raw_payload TEXT,
  outbox_id INTEGER,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(thread_id) REFERENCES comms_threads(thread_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_messages_wamid
  ON comms_messages(wamid)
  WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comms_messages_thread
  ON comms_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comms_messages_brand_phone
  ON comms_messages(brand, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_messages_status
  ON comms_messages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  brand TEXT,
  phone_number_id TEXT,
  event_kind TEXT,
  wa_id TEXT,
  message_id TEXT,
  raw_json TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 1,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_comms_webhook_events_time
  ON comms_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_webhook_events_msg
  ON comms_webhook_events(message_id);
CREATE INDEX IF NOT EXISTS idx_comms_webhook_events_wa
  ON comms_webhook_events(brand, wa_id, received_at DESC);

CREATE TABLE IF NOT EXISTS comms_quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL DEFAULT 'all',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comms_quick_replies_brand
  ON comms_quick_replies(brand, active, sort_order);

INSERT OR IGNORE INTO comms_quick_replies (id, brand, title, body, sort_order)
VALUES
  (1, 'all', 'Ask Details', 'Could you share a little more detail so we can help properly?', 10),
  (2, 'he', 'HE Pickup', 'Yes, Hamza Express pickup is available. Share what you would like and we will confirm.', 20),
  (3, 'nch', 'NCH Delivery', 'Yes, Nawabi Chai House delivery is available nearby. Please share your location pin.', 30),
  (4, 'all', 'Human Follow-up', 'I am checking this with the team and will reply here shortly.', 40);
