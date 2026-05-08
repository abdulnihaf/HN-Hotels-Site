-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0016 — TWO-LAYER capital architecture
--
-- Owner architectural principle (May 7 2026):
--   "Total fund of ₹10L is the ceiling — that's a funding event that rarely
--    changes. Daily commitment varies (₹10K Friday test, ₹1L next, ₹10L full
--    deployment). The system must support both layers without code change."
--
-- LAYER 1 — total_capital_paise (CEILING, already exists):
--   Total funded amount in the account. Changes only on funding events
--   (HDFC transfer, withdrawal, etc.). Used as hard upper bound and display
--   reference. Currently 100000000 = ₹10L.
--
-- LAYER 2 — today_deployable_paise (NEW):
--   What you're actually committing TODAY. ≤ total_capital_paise. Drives:
--     - position sizing in rangeCapture
--     - profit lock threshold (5% of today_deployable)
--     - loss halt threshold (3% of today_deployable)
--     - all "% of capital" displays in /trading/today/
--
-- Owner flips today_deployable_paise via ONE SQL UPDATE per day. No code change.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  ('today_deployable_paise', '1000000', 'TODAY''s committed deployable amount (paise). 1000000 = ₹10K (Fri 8 May test). Set to total_capital_paise for full deployment. Changes daily by owner judgment.', strftime('%s','now')*1000);

-- Examples for owner's daily flip:
--   Day 1 (Fri 8 May, ₹10K test):       UPDATE user_config SET config_value='1000000'   WHERE config_key='today_deployable_paise';
--   Day 2 (Mon 11 May, ₹1L scaled up):  UPDATE user_config SET config_value='10000000'  WHERE config_key='today_deployable_paise';
--   Day 3+ (full deployment ₹10L):       UPDATE user_config SET config_value='100000000' WHERE config_key='today_deployable_paise';
--   Pause days (paper only at full ceiling): UPDATE user_config SET config_value='100000000' WHERE config_key='today_deployable_paise';
--                                            (paired with block_real_orders='1' if you want paper-only)
