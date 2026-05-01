-- comms_outbox: every outbound message with delivery + ack state
CREATE TABLE IF NOT EXISTS comms_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT,
  tier TEXT NOT NULL DEFAULT 'info',
  brand TEXT NOT NULL DEFAULT 'hq',
  channel TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  template_name TEXT,
  template_vars TEXT,
  body_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_msg_id TEXT,
  provider_response TEXT,
  error_text TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  acked_at TEXT,
  ack_action TEXT,
  ack_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comms_outbox_status ON comms_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_comms_outbox_alert ON comms_outbox(alert_id);
CREATE INDEX IF NOT EXISTS idx_comms_outbox_recipient ON comms_outbox(recipient_phone, created_at);

-- comms_optin: per-phone per-brand per-channel consent registry
CREATE TABLE IF NOT EXISTS comms_optin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  brand TEXT NOT NULL,
  channel TEXT NOT NULL,
  staff_name TEXT,
  staff_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  consent_msg_id TEXT,
  consented_at TEXT,
  consent_text TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(phone, brand, channel)
);
CREATE INDEX IF NOT EXISTS idx_comms_optin_phone ON comms_optin(phone);
CREATE INDEX IF NOT EXISTS idx_comms_optin_status ON comms_optin(status, brand);
