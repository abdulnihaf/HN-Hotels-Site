-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0013: Anthropic API usage tracking + response cache
--
-- Tracks every Claude API call for cost accounting + spend cap enforcement.
-- Caches responses by content-hash to avoid re-calling on identical inputs
-- (news headlines, transcripts, narratives) — 90% cost reduction in steady state.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS anthropic_usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  date            TEXT NOT NULL,                    -- YYYY-MM-DD for daily aggregation
  worker          TEXT,                              -- which worker made the call
  purpose         TEXT,                              -- 'news_tagging' / 'narrative' / 'concall_analysis'
  model           TEXT DEFAULT 'claude-haiku-4-5',
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cached_tokens   INTEGER,                           -- tokens served from prompt cache (0.10×)
  cost_paise      INTEGER,                           -- paise (₹×100), int for SQL math
  cost_usd_x1000  INTEGER,                           -- 1000×USD for precise sum (Haiku is fractional cents)
  request_id      TEXT,
  cached_response INTEGER DEFAULT 0,                 -- 1 if served from our D1 cache (no API call)
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_anthropic_usage_date ON anthropic_usage(date DESC);
CREATE INDEX IF NOT EXISTS idx_anthropic_usage_purpose ON anthropic_usage(purpose, ts DESC);

-- Response cache — keyed by SHA1 hash of (system_prompt + user_prompt + model)
CREATE TABLE IF NOT EXISTS anthropic_cache (
  cache_key       TEXT PRIMARY KEY,
  purpose         TEXT,
  response        TEXT NOT NULL,
  input_tokens    INTEGER,                           -- track what we saved
  output_tokens   INTEGER,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,                           -- when to consider stale
  hit_count       INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_anthropic_cache_expires ON anthropic_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_anthropic_cache_purpose ON anthropic_cache(purpose);
