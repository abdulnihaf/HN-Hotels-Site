-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0004 — Personalized user_config
-- Stores Nihaf's specific capital, risk rules, and personalization values.
-- The /trading/execute UI reads from this table to compute each trade card.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER
);

-- Seed Nihaf's personal configuration
-- Re-run with `INSERT OR REPLACE` to update any of these values later
INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  -- Capital configuration (in paise)
  ('total_capital_paise',     '100000000',  'Total trading capital ₹10,00,000', strftime('%s','now')*1000),
  ('base_tranche_paise',       '40000000',  'Quality compounders bucket ₹4,00,000', strftime('%s','now')*1000),
  ('aggressive_tranche_paise', '30000000',  'Catalyst-driven swing trades ₹3,00,000', strftime('%s','now')*1000),
  ('stretch_tranche_paise',    '30000000',  'Cascade plays + options ₹3,00,000', strftime('%s','now')*1000),

  -- Risk discipline rules
  ('max_risk_per_trade_pct',   '2.0',       'Max % of TOTAL capital lost per trade — Rule 1', strftime('%s','now')*1000),
  ('min_reward_risk_ratio',    '2.0',       'Min reward:risk ratio to take trade — Rule 2', strftime('%s','now')*1000),
  ('max_active_positions',     '3',         'Max simultaneous positions — Rule 3', strftime('%s','now')*1000),
  ('max_signal_threshold',     '70',        'Min composite score for execute UI to surface', strftime('%s','now')*1000),

  -- Stop-loss percentages by tranche
  ('base_stop_pct',            '5.0',       'Default stop-loss % for base tranche', strftime('%s','now')*1000),
  ('aggressive_stop_pct',      '7.0',       'Default stop-loss % for aggressive tranche', strftime('%s','now')*1000),
  ('stretch_stop_pct',         '10.0',      'Default stop-loss % for stretch tranche', strftime('%s','now')*1000),

  -- Tranche routing rules (for auto-assignment)
  ('base_min_score',           '70',        'Min composite to qualify as BASE candidate', strftime('%s','now')*1000),
  ('aggressive_catalyst_min',  '70',        'Min catalyst score to route to AGGRESSIVE', strftime('%s','now')*1000),
  ('stretch_cascade_required', '1',         'STRETCH trades require active cascade pattern', strftime('%s','now')*1000),

  -- User identity (for display)
  ('user_name',                'Abdul Nihaf','Display name on dashboard', strftime('%s','now')*1000),
  ('experience_level',         'beginner',   'Affects discipline reminders shown', strftime('%s','now')*1000),

  -- Cooldown enforcement
  ('losses_to_cooldown',       '3',         'Consecutive losses that trigger 1-week cooldown — Rule 8', strftime('%s','now')*1000),
  ('wins_before_size_cut',     '3',         'Consecutive wins before next position cut 25% — Rule 7', strftime('%s','now')*1000);

-- Helper view: capital deployment status
DROP VIEW IF EXISTS v_capital_status;
CREATE VIEW v_capital_status AS
SELECT
  (SELECT CAST(config_value AS INTEGER) FROM user_config WHERE config_key='total_capital_paise')      AS total_capital,
  (SELECT CAST(config_value AS INTEGER) FROM user_config WHERE config_key='base_tranche_paise')        AS base_capacity,
  (SELECT CAST(config_value AS INTEGER) FROM user_config WHERE config_key='aggressive_tranche_paise')  AS aggressive_capacity,
  (SELECT CAST(config_value AS INTEGER) FROM user_config WHERE config_key='stretch_tranche_paise')     AS stretch_capacity,
  COALESCE((SELECT SUM(qty * entry_price_paise) FROM position_watchlist WHERE is_active=1 AND tranche='base'), 0)        AS base_deployed,
  COALESCE((SELECT SUM(qty * entry_price_paise) FROM position_watchlist WHERE is_active=1 AND tranche='aggressive'), 0)  AS aggressive_deployed,
  COALESCE((SELECT SUM(qty * entry_price_paise) FROM position_watchlist WHERE is_active=1 AND tranche='stretch'), 0)     AS stretch_deployed,
  (SELECT COUNT(*) FROM position_watchlist WHERE is_active=1) AS active_positions;
