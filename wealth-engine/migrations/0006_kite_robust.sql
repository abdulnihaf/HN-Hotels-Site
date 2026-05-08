-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0006 — Kite robustness (P1-P4 architecture upgrade)
-- ═══════════════════════════════════════════════════════════════════════════

-- Instruments master — Symbol ↔ instrument_token mapping
-- Required for: historical candles, options chain by token, future WebSocket
-- Refreshed daily from Kite /instruments/NSE CSV (~3MB, ~80k rows)
CREATE TABLE IF NOT EXISTS kite_instruments (
  instrument_token INTEGER PRIMARY KEY,
  exchange_token INTEGER,
  tradingsymbol TEXT NOT NULL,
  name TEXT,
  last_price REAL,
  expiry TEXT,
  strike REAL,
  tick_size REAL,
  lot_size INTEGER,
  instrument_type TEXT,                 -- EQ | FUT | CE | PE | etc
  segment TEXT,                         -- NSE | NFO-OPT | etc
  exchange TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inst_symbol ON kite_instruments(tradingsymbol, exchange);
CREATE INDEX IF NOT EXISTS idx_inst_segment ON kite_instruments(segment);
CREATE INDEX IF NOT EXISTS idx_inst_type ON kite_instruments(instrument_type);

-- Per-endpoint health tracking (P4: rate-limit + circuit breaker)
CREATE TABLE IF NOT EXISTS kite_endpoint_health (
  endpoint TEXT PRIMARY KEY,            -- '/orders' | '/quote/ltp' | etc
  last_success_ts INTEGER,
  last_failure_ts INTEGER,
  consecutive_failures INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  total_429 INTEGER DEFAULT 0,
  total_5xx INTEGER DEFAULT 0,
  is_circuit_open INTEGER DEFAULT 0,    -- 1 = paused due to repeated failures
  circuit_opens_until INTEGER,          -- ms epoch — when circuit can close
  rolling_count INTEGER DEFAULT 0,      -- requests in current rolling window
  rolling_window_start INTEGER,
  updated_at INTEGER
);

-- Bracket order state — multi-step lifecycle tracking for the place_bracket flow
CREATE TABLE IF NOT EXISTS kite_bracket_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  qty INTEGER NOT NULL,
  intended_entry_paise INTEGER,
  intended_stop_paise INTEGER,
  intended_target_paise INTEGER,
  -- Lifecycle
  step TEXT,                            -- 'placed_buy' | 'fill_polling' | 'filled' | 'gtt_placed' | 'gtt_failed_fallback_sl' | 'complete' | 'failed'
  buy_order_id TEXT,
  buy_status TEXT,
  fill_price_paise INTEGER,
  fill_qty INTEGER,
  gtt_id TEXT,                          -- if successful
  gtt_attempts INTEGER DEFAULT 0,
  gtt_last_error TEXT,
  fallback_sl_order_id TEXT,            -- if GTT failed and we placed SL-M instead
  fallback_target_order_id TEXT,        -- separate target if needed
  position_watchlist_id INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_bracket_recent ON kite_bracket_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bracket_symbol ON kite_bracket_orders(symbol, created_at DESC);

-- Margin requirement cache (5-min TTL)
CREATE TABLE IF NOT EXISTS kite_margin_cache (
  cache_key TEXT PRIMARY KEY,           -- hash of symbol+qty+side+product
  symbol TEXT,
  required_total_paise INTEGER,
  required_span_paise INTEGER,
  required_exposure_paise INTEGER,
  raw_json TEXT,
  cached_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_margin_expiry ON kite_margin_cache(expires_at);
