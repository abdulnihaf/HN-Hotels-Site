-- Switch influencer pipeline from hardcoded May campaign to active campaign.
-- Adds config knobs for the gold-link + autonomous email rail.
-- Run: wrangler d1 execute hn-hiring --remote --file=migrations/influencer-active-campaign-v1.sql

-- Make active_v1 the current campaign. Existing outreach_log rows keep their
-- original campaign value for audit; new rows will use active_v1.
INSERT OR REPLACE INTO influencer_pipeline_config (key, value, description) VALUES
  ('campaign', 'active_v1', 'Active campaign identifier written to new outreach_log rows');

-- New control knobs for the resurrected pipeline
INSERT OR IGNORE INTO influencer_pipeline_config (key, value, description) VALUES
  ('active_campaign', 'active_v1', 'Alias for campaign — used by newer code paths'),
  ('bio_pulse_per_tick', '12', 'Max gold_import handles enriched per cron-enrich-tick via free IG bio-pulse'),
  ('followup_per_day', '10', 'Max day+3 email follow-up nudges sent per outreach wave'),
  ('email_provider', 'resend', 'resend | queued — primary email rail; falls back to queued if no API key'),
  ('outreach_mode', 'dry_run', 'dry_run | live — MUST stay dry_run until owner approves first real send');

-- Ensure the bio-pulse table can record source='gold_import' (already has source column)
-- No schema change needed; source default is 'web_profile_info'.
