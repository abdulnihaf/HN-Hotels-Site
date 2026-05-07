-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0015 — Risk config as percentages (scales with capital)
--
-- Owner principle (May 7 2026): one SQL UPDATE to flip ₹10K (Fri 8 May test)
-- ↔ ₹10L (Mon 11 May launch). Storing thresholds as ratios in user_config
-- means changing total_capital_paise auto-scales every threshold.
--
-- Why these defaults:
--   profit_lock_pct = 0.05  (5%)  — raised from 3% per scenario backtest of
--                                   2026-05-07: best feasible no-hindsight
--                                   was ₹40,669 (4.07%) on ₹10L; 5% is a
--                                   realistic stretch when F-EXIT-2 +
--                                   afternoon-hold + regime-aware partial
--                                   booking are all live.
--   loss_halt_pct   = 0.03  (3%)  — KEPT asymmetric. Losses cost more
--                                   emotionally; symmetric protection would
--                                   over-loosen the halt.
--   best_target_pct = 0.07  (7%)  — informational stretch (was 5%).
--
-- Used by:
--   wealth-trader/src/index.js :: getRiskConfig() → priceMonitor() force-exit
--   functions/api/trading.js   :: today_consolidated portfolio roll-up
-- ═══════════════════════════════════════════════════════════════════════════

INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  ('profit_lock_pct',  '0.05',  'F-L4-LOCK threshold as ratio of total_capital_paise. 0.05 = 5%. Raised from hardcoded ₹30K (3%) on 2026-05-07.', strftime('%s','now')*1000),
  ('loss_halt_pct',    '0.03',  'Daily loss halt threshold as ratio of total_capital_paise. 0.03 = 3%. Kept asymmetric vs profit_lock_pct.', strftime('%s','now')*1000),
  ('best_target_pct',  '0.07',  'Best-case stretch target as ratio of capital. Informational only.', strftime('%s','now')*1000);

-- Note: total_capital_paise is left at whatever it currently is. To switch
-- between ₹10K (Fri 8 May test) and ₹10L (Mon 11 May launch) update that key:
--   UPDATE user_config SET config_value='1000000'   WHERE config_key='total_capital_paise';   -- ₹10K
--   UPDATE user_config SET config_value='100000000' WHERE config_key='total_capital_paise';   -- ₹10L
