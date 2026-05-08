-- Migration: comms_outbox escalation chain
-- Adds multi-channel fallback state directly to comms_outbox so it stays
-- the single source of truth. No separate hr_alert_channels coupling needed.
--
-- Run via: npx wrangler d1 execute hn-hiring --file=schema-comms-escalation.sql
--
-- Semantics:
--   escalation_chain  : JSON array like ["waba","sms","voice"] — channels to try in order
--   escalation_step   : 0-indexed position in chain that THIS row represents (0=first send)
--   escalation_due_at : when the cron should fire the next channel if this row isn't ack'd/delivered
--   parent_outbox_id  : links a fallback send back to the original send (NULL on step 0)
--
-- Cron query (find sends due for escalation):
--   SELECT * FROM comms_outbox
--    WHERE escalation_due_at IS NOT NULL
--      AND escalation_due_at < datetime('now')
--      AND acked_at IS NULL
--      AND status NOT IN ('failed', 'responded');

ALTER TABLE comms_outbox ADD COLUMN escalation_chain TEXT;
ALTER TABLE comms_outbox ADD COLUMN escalation_step INTEGER DEFAULT 0;
ALTER TABLE comms_outbox ADD COLUMN escalation_due_at TEXT;
ALTER TABLE comms_outbox ADD COLUMN parent_outbox_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_comms_outbox_escalation_due
  ON comms_outbox(escalation_due_at)
  WHERE escalation_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comms_outbox_alert_chain
  ON comms_outbox(alert_id, escalation_step);
