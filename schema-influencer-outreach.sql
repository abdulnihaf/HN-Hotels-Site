-- Influencer cold-outreach log — one row per send-attempt (per channel per send).
-- Used by /api/influencer-outreach + /marketing/Influencer/outreach/ UI.
-- Reads back into the booking system via outreach_token = booking pre-token.

CREATE TABLE IF NOT EXISTS influencer_outreach (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK(channel IN ('email','waba','ig_dm','phone_call','sms')),
  status          TEXT NOT NULL CHECK(status IN ('queued','sent','delivered','read','replied','bounced','failed')),
  recipient       TEXT,                 -- target email/phone/handle (immutable post-send)
  template_used   TEXT,                 -- 'cold_email_v1' / 'he_influencer_barter_v1' / etc.
  subject         TEXT,                 -- email only
  message_text    TEXT,                 -- final text after var substitution
  outreach_token  TEXT,                 -- 16-char token; if creator clicks booking link, ties back here
  provider        TEXT,                 -- 'gmail' | 'meta-cloud-api' | 'fast2sms' | 'manual'
  provider_msg_id TEXT,                 -- gmail Message-ID, Meta wamid, etc.
  campaign        TEXT NOT NULL DEFAULT 'may_2026_v1',
  tier_assigned   TEXT,                 -- 'T1' | 'T2' | 'T3' | 'T4'
  cover_offer     INTEGER,              -- 2 | 4 | 6 | 8
  niche_tag       TEXT,                 -- 'biryani' | 'cafes' | 'street_food' etc. (used in personalisation)
  -- Lifecycle timestamps
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at    TEXT,
  read_at         TEXT,
  replied_at      TEXT,
  reply_text      TEXT,
  bounce_reason   TEXT,
  -- Manual override
  notes           TEXT,
  actor           TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_iout_username ON influencer_outreach(username, channel, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_iout_status   ON influencer_outreach(status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_iout_token    ON influencer_outreach(outreach_token);
CREATE INDEX IF NOT EXISTS idx_iout_campaign ON influencer_outreach(campaign, sent_at DESC);

-- Per-creator outreach summary view (latest per channel)
DROP VIEW IF EXISTS v_influencer_outreach_summary;
CREATE VIEW v_influencer_outreach_summary AS
SELECT
  o.username,
  MAX(CASE WHEN o.channel='email'      THEN o.sent_at END) AS email_sent_at,
  MAX(CASE WHEN o.channel='email'      THEN o.status  END) AS email_status,
  MAX(CASE WHEN o.channel='waba'       THEN o.sent_at END) AS waba_sent_at,
  MAX(CASE WHEN o.channel='waba'       THEN o.status  END) AS waba_status,
  MAX(CASE WHEN o.channel='ig_dm'      THEN o.sent_at END) AS ig_dm_sent_at,
  MAX(CASE WHEN o.channel='ig_dm'      THEN o.status  END) AS ig_dm_status,
  MAX(CASE WHEN o.channel='phone_call' THEN o.sent_at END) AS phone_sent_at,
  MAX(CASE WHEN o.channel='phone_call' THEN o.status  END) AS phone_status,
  MAX(o.replied_at)         AS last_replied_at,
  COUNT(*)                  AS total_attempts
FROM influencer_outreach o
GROUP BY o.username;
