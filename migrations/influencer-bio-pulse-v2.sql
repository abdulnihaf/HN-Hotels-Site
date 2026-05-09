-- Add button-presence flags + business address + public-contacts visibility
-- Run: wrangler d1 execute hn-hiring --remote --file=migrations/influencer-bio-pulse-v2.sql

ALTER TABLE influencer_bio_pulse ADD COLUMN business_address_json TEXT;
ALTER TABLE influencer_bio_pulse ADD COLUMN should_show_public_contacts INTEGER DEFAULT 0;
ALTER TABLE influencer_bio_pulse ADD COLUMN has_email_button INTEGER DEFAULT 0;
ALTER TABLE influencer_bio_pulse ADD COLUMN has_call_button INTEGER DEFAULT 0;
ALTER TABLE influencer_bio_pulse ADD COLUMN has_any_button INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ibp_button ON influencer_bio_pulse(has_any_button, has_any_contact);
