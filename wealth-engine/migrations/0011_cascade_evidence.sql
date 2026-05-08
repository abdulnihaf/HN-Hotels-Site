-- 0011_cascade_evidence.sql
-- Add evidence_json column to cascade_triggers_active so detectors can
-- store rich context (client name, days/qty/dates buying, etc) per trigger.
-- This is read by trade-card UI + briefings to explain WHY a cascade fired.

ALTER TABLE cascade_triggers_active ADD COLUMN evidence_json TEXT;

-- Speed up dedupe lookups in REPEAT_BLOCK_BUYER detector
CREATE INDEX IF NOT EXISTS idx_cascade_active_pattern
  ON cascade_triggers_active(pattern_name, status, expected_window_end);
