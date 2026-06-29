-- 0021_kite_bracket_tag.sql
-- Order-path hardening, Fix #1: idempotency / double-buy protection.
--
-- kite_bracket_orders had NO `tag` column and placeBracket did NO server-side
-- dedupe, so a network timeout mid-BUY followed by a client retry (or a double
-- tap in the app) could place a SECOND market order. This adds the tag column
-- (the idempotency key the client already passes through to Kite) plus the two
-- indexes the pre-insert dedupe lookup needs so the guard stays cheap.
--
-- Additive + backward-compatible: existing code that never reads `tag` is
-- unaffected, so this can be applied to live D1 BEFORE the new code deploys.

ALTER TABLE kite_bracket_orders ADD COLUMN tag TEXT;

-- Dedupe lookup is "non-failed row for this symbol created within the window".
CREATE INDEX IF NOT EXISTS idx_kbo_symbol_created ON kite_bracket_orders(symbol, created_at);
-- Future-proofing for a true per-intent idempotency key (symbol+tag match).
CREATE INDEX IF NOT EXISTS idx_kbo_symbol_tag ON kite_bracket_orders(symbol, tag);
