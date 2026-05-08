-- Multi-channel communications schema
-- Companion to schema-hr-automation.sql; adds channel orchestration layer
-- Run via: wrangler d1 execute hn-hiring --file=schema-comms-channels.sql

-- ─── Channel attempt tracking ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_alert_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
    -- 'absence' | 'ghost_pin' | 'daily_summary' | 'leegality_reminder'
    -- | 'fnf_completion' | 'probation_review' | 'contract_renewal'
  channel TEXT NOT NULL,
    -- 'waba' | 'dlt_sms' | 'exotel_voice'
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  template_used TEXT,
  payload_json TEXT,
  sent_at TEXT DEFAULT (datetime('now')),
  delivered_at TEXT,
  read_at TEXT,
  responded_at TEXT,
  response_text TEXT,
  response_method TEXT,
    -- 'button_tap' | 'sms_reply' | 'dtmf_keypress' | 'url_click'
  provider_msg_id TEXT,
  status TEXT DEFAULT 'sent',
    -- sent | delivered | read | responded | failed | timed_out
  error_message TEXT,
  cost_paise INTEGER,
  next_fallback_at TEXT,
    -- when to attempt next channel if no response
  fallback_done INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_alert ON hr_alert_channels(alert_id, alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_channels_status ON hr_alert_channels(status, sent_at);
CREATE INDEX IF NOT EXISTS idx_alert_channels_pending_fallback ON hr_alert_channels(next_fallback_at, fallback_done) WHERE fallback_done = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_channels_unique ON hr_alert_channels(alert_id, alert_type, channel);

-- ─── Recipient preferences ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_recipient_prefs (
  phone TEXT PRIMARY KEY,
  name TEXT,
  waba_opted_in INTEGER DEFAULT 0,
  waba_opted_in_at TEXT,
  dlt_sms_consent INTEGER DEFAULT 1,
  exotel_call_ok INTEGER DEFAULT 1,
  preferred_channel TEXT DEFAULT 'waba',
  do_not_disturb_start TEXT,
  do_not_disturb_end TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  language TEXT DEFAULT 'hi',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed managers
INSERT OR IGNORE INTO hr_recipient_prefs (phone, name, waba_opted_in, dlt_sms_consent, preferred_channel, language) VALUES
  ('9341745726', 'Farooq',  1, 1, 'waba', 'hi'),
  ('9945470320', 'Nihaf',   1, 1, 'waba', 'en');
-- Basheer: UPDATE after phone confirmed

-- ─── DLT template registry (cache of approved templates) ────────────────────
CREATE TABLE IF NOT EXISTS dlt_templates (
  template_name TEXT PRIMARY KEY,
  dlt_template_id TEXT NOT NULL,    -- BSNL DLT assigned ID
  entity_id TEXT NOT NULL,           -- BL-1400079296
  header TEXT NOT NULL,              -- 'HNHTLS'
  category TEXT,                     -- 'transactional' | 'service' | 'promotional'
  body_template TEXT NOT NULL,       -- with {#var#} placeholders
  status TEXT DEFAULT 'pending',     -- pending | approved | rejected
  approved_at TEXT,
  variable_count INTEGER,
  notes TEXT
);

-- Pre-register the 6 templates being approved
INSERT OR IGNORE INTO dlt_templates (template_name, dlt_template_id, entity_id, header, category, body_template, variable_count, notes) VALUES
  ('hr_absence_inquiry_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'service',
   'HNHTLS: {#var#} (PIN {#var#}) absent {#var#} days since {#var#}. Status? Reply 1=Leave 2=Sick 3=Left 4=BioIssue. Open: hnhotels.in/hr/r/{#var#}',
   5, 'Sent to manager when employee absent 2+ days'),
  ('hr_ghost_pin_inquiry_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'service',
   'HNHTLS: Hi {#var#}, PIN {#var#} not in roster, {#var#} punches/{#var#} days. Onboard: hnhotels.in/hr/respond/ghost?t={#var#} or reply STOP if unauthorized.',
   5, 'Sent to manager when CAMS PIN not in roster — name matches WABA template'),
  ('hr_leegality_reminder_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'transactional',
   'HNHTLS: Hi {#var#}, your employment contract awaits Aadhaar OTP signature. Sign here: {#var#} (expires {#var#}). Questions: 9945470320',
   3, 'Sent to employee for unsigned Leegality docs'),
  ('hr_fnf_completion_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'transactional',
   'HNHTLS: Hi {#var#}, your Final Settlement of Rs.{#var#} has been transferred to a/c ending {#var#}. UTR: {#var#}. Thank you.',
   4, 'F&F payment confirmation to ex-employee'),
  ('hr_probation_review_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'service',
   'HNHTLS: Hi {#var#}, your probation period ends {#var#}. Manager will discuss confirmation. Ref: {#var#}',
   3, '14 days before probation end'),
  ('hr_contract_renewal_v1', 'TBD', 'BL-1400079296', 'HNHTLS', 'transactional',
   'HNHTLS: Hi {#var#}, annual contract renewal due. New letter sent to your phone. Sign at: {#var#}. Effective: {#var#}',
   3, 'Annual contract renewal');

-- ─── Add fallback tracking to existing tables ───────────────────────────────
ALTER TABLE hr_absence_alerts ADD COLUMN escalation_level INTEGER DEFAULT 0;
  -- 0=initial, 1=sms_sent, 2=voice_called, 3=escalated_to_owner

ALTER TABLE hr_ghost_pins ADD COLUMN escalation_level INTEGER DEFAULT 0;
