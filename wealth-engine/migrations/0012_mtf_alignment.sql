-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0012 — MTF alignment + regime columns on signal_scores
--
-- Adds two pieces of context per scored symbol:
--   mtf_alignment — 'aligned_up' | 'partial_up' | 'mixed' | 'against_macro'
--                   | 'aligned_down'. Lets the cards UI explain WHY a score
--                   was downgraded or excluded.
--   regime        — Nifty + India-VIX regime label at compute time. Same
--                   value for every row in a given computed_at batch; lets
--                   the UI show the prevailing market regime.
--
-- Both are nullable — older rows from before the upgrade will read as null,
-- and the UI tolerates null with a fallback ('—').
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE signal_scores ADD COLUMN mtf_alignment TEXT;
ALTER TABLE signal_scores ADD COLUMN regime TEXT;
