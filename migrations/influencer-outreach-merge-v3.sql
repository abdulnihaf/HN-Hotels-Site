-- Unify outreach tracking — drop the parallel `influencer_outreach` (added briefly
-- earlier today) and extend the existing `influencer_outreach_log` (deployed with
-- the booking system) with the richer columns the new outreach API needs.
--
-- This keeps a single source of truth so the booking flow's
-- `UPDATE influencer_outreach_log SET status='booked' WHERE outreach_token=?`
-- correctly closes the loop on outreach rows the new API creates.

-- 1. Add the rich columns to the existing log table (NULL-safe so existing rows are fine)
ALTER TABLE influencer_outreach_log ADD COLUMN template_used   TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN provider        TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN provider_msg_id TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN tier_assigned   TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN cover_offer     INTEGER;
ALTER TABLE influencer_outreach_log ADD COLUMN niche_tag       TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN campaign        TEXT NOT NULL DEFAULT 'may_2026_v1';
ALTER TABLE influencer_outreach_log ADD COLUMN delivered_at    TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN read_at         TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN replied_at      TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN bounce_reason   TEXT;
ALTER TABLE influencer_outreach_log ADD COLUMN actor           TEXT NOT NULL DEFAULT 'system';

CREATE INDEX IF NOT EXISTS idx_outreach_log_campaign ON influencer_outreach_log(campaign, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_log_channel  ON influencer_outreach_log(channel, status);

-- 2. Drop the parallel table and view (added earlier today, never written to)
DROP VIEW IF EXISTS v_influencer_outreach_summary;
DROP TABLE IF EXISTS influencer_outreach;

-- 3. Recreate the per-creator-channel summary view on top of influencer_outreach_log
CREATE VIEW v_influencer_outreach_summary AS
SELECT
  o.creator_username AS username,
  MAX(CASE WHEN o.channel='email'      THEN o.sent_at END) AS email_sent_at,
  MAX(CASE WHEN o.channel='email'      THEN o.status  END) AS email_status,
  MAX(CASE WHEN o.channel='waba'       OR o.channel='whatsapp' THEN o.sent_at END) AS waba_sent_at,
  MAX(CASE WHEN o.channel='waba'       OR o.channel='whatsapp' THEN o.status  END) AS waba_status,
  MAX(CASE WHEN o.channel='ig_dm'      THEN o.sent_at END) AS ig_dm_sent_at,
  MAX(CASE WHEN o.channel='ig_dm'      THEN o.status  END) AS ig_dm_status,
  MAX(CASE WHEN o.channel='phone_call' THEN o.sent_at END) AS phone_sent_at,
  MAX(CASE WHEN o.channel='phone_call' THEN o.status  END) AS phone_status,
  MAX(o.reply_at)        AS last_replied_at,
  COUNT(*)               AS total_attempts
FROM influencer_outreach_log o
GROUP BY o.creator_username;
