-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0002 — Kite Connect token storage
-- ═══════════════════════════════════════════════════════════════════════════
-- Kite access tokens expire at 06:00 IST every day. There is no refresh flow.
-- User must re-authenticate via OAuth each morning.
-- We persist the latest access_token + metadata so dashboard knows whether to
-- prompt re-login.

CREATE TABLE IF NOT EXISTS kite_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,                      -- Kite user_id (e.g. AB1234)
  access_token TEXT NOT NULL,
  public_token TEXT,
  user_name TEXT,
  email TEXT,
  user_type TEXT,                    -- 'individual' | 'corporate'
  broker TEXT,
  exchanges TEXT,                    -- JSON array
  products TEXT,                     -- JSON array
  order_types TEXT,                  -- JSON array
  api_key TEXT,
  obtained_at INTEGER NOT NULL,      -- ms epoch
  expires_at INTEGER NOT NULL,       -- ms epoch (next 06:00 IST after obtained_at)
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_kite_tokens_active ON kite_tokens(is_active, obtained_at DESC);
CREATE INDEX IF NOT EXISTS idx_kite_tokens_expiry ON kite_tokens(expires_at DESC);

-- A small log of Kite API calls — useful for rate-limit debugging
CREATE TABLE IF NOT EXISTS kite_api_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  method TEXT,
  status INTEGER,
  duration_ms INTEGER,
  error TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kite_log_recent ON kite_api_log(ts DESC);
