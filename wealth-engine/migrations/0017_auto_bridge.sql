-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0017 — AUTO-BRIDGE: paper_trades.ENTERED → real Kite order
--
-- Owner principle (May 7 2026 EOD):
--   "Manual one-click from /trading/today/ to /trading/execute/ adds ~7 min
--    latency. By the time I see signal + click confirm, the breakout window
--    has passed. We need automation: when paper trader fires ENTRY, it
--    should auto-place real Kite order within seconds. I watch for failures."
--
-- THREE GATES — all must pass for real order to fire:
--   1. user_config.auto_real_trades_enabled = '1'  (master switch, NEW)
--   2. user_config.block_real_orders        = '0'  (existing safety gate)
--   3. user_config.engine_mode              = 'live' (existing mode gate)
--
-- TRACKING:
--   paper_trades.kite_bracket_id (NEW INTEGER column) links paper signal to
--   the real Kite bracket order via kite_bracket_orders.id. NULL = paper-only.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE paper_trades ADD COLUMN kite_bracket_id INTEGER;

INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  ('auto_real_trades_enabled', '0', 'When 1: BREAKOUT_TRIGGER and Opus ENTER_NOW auto-fire /api/kite?action=place_bracket. When 0 (default): paper-only. Owner flips to 1 after pre-flight checks pass tomorrow morning. Gated additionally by block_real_orders=0 + engine_mode=live.', strftime('%s','now')*1000);

-- Tomorrow morning's flip sequence (after pre-flight passes):
--   UPDATE user_config SET config_value='0'    WHERE config_key='block_real_orders';
--   UPDATE user_config SET config_value='live' WHERE config_key='engine_mode';
--   UPDATE user_config SET config_value='1'    WHERE config_key='auto_real_trades_enabled';
-- After 3rd UPDATE, /trading/today/ will show "🟢 AUTO-BRIDGE ARMED" banner.
