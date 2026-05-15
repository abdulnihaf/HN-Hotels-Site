-- fleet/ai-usage/schema.sql
-- D1 schema for the live AI-key usage dashboard at /ops/ai-usage/.
-- Applied via: wrangler d1 execute hn-hiring --file=fleet/ai-usage/schema.sql --remote
--
-- Push model:
--   Mac → `hn-usage --push` → POST /api/ai-usage → INSERT row
--   Browser → GET /api/ai-usage → SELECT most recent row + last-N hours
--
-- One row = one snapshot of {Claude + delegate (Gemini/Codex/Kimi)} usage.

CREATE TABLE IF NOT EXISTS ai_usage_snapshots (
  snapshot_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  pushed_at       INTEGER NOT NULL,                 -- unix epoch seconds (server-side, on insert)
  client_ts       INTEGER,                          -- unix epoch on Mac at push time
  source_host     TEXT,                             -- hostname of pusher (debug)
  since_ts        INTEGER,                          -- the window-start the snapshot covers

  -- Claude (from local JSONL parsing)
  claude_input_tokens         INTEGER DEFAULT 0,
  claude_cache_write_tokens   INTEGER DEFAULT 0,
  claude_cache_read_tokens    INTEGER DEFAULT 0,
  claude_output_tokens        INTEGER DEFAULT 0,
  claude_messages             INTEGER DEFAULT 0,
  claude_sessions             INTEGER DEFAULT 0,
  claude_cost_usd_sonnet      REAL DEFAULT 0,

  -- Delegates (from ai-delegate log)
  gemini_calls        INTEGER DEFAULT 0,
  gemini_tokens       INTEGER DEFAULT 0,
  codex_calls         INTEGER DEFAULT 0,
  codex_tokens        INTEGER DEFAULT 0,
  kimi_calls          INTEGER DEFAULT 0,
  kimi_tokens         INTEGER DEFAULT 0,
  image_calls         INTEGER DEFAULT 0,

  -- Computed
  total_billable_tokens INTEGER DEFAULT 0,
  claude_pct            REAL DEFAULT 0,
  backup_pct            REAL DEFAULT 0,

  -- Raw payload (for forensic / future-format compatibility)
  data_json           TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_pushed_at_desc
  ON ai_usage_snapshots(pushed_at DESC);
