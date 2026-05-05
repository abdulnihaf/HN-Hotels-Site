-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0005 — Deep Kite integration
-- Tables that capture Kite-side state so dashboard is the source of truth.
-- ═══════════════════════════════════════════════════════════════════════════

-- Live holdings reconciled from Kite (refreshed every 5 min during market)
CREATE TABLE IF NOT EXISTS kite_holdings_live (
  symbol TEXT PRIMARY KEY,
  exchange TEXT,
  isin TEXT,
  quantity INTEGER,
  avg_price_paise INTEGER,
  ltp_paise INTEGER,
  market_value_paise INTEGER,
  pnl_paise INTEGER,
  day_change_pct REAL,
  total_return_pct REAL,
  product TEXT,                       -- CNC | NRML | MIS
  collateral_qty INTEGER,
  refreshed_at INTEGER NOT NULL
);

-- Funds / margin snapshot (refreshed every 5 min during market)
CREATE TABLE IF NOT EXISTS kite_funds_live (
  segment TEXT PRIMARY KEY,           -- 'equity' | 'commodity'
  available_cash_paise INTEGER,
  used_margin_paise INTEGER,
  total_collateral_paise INTEGER,
  available_total_paise INTEGER,
  refreshed_at INTEGER NOT NULL,
  raw_json TEXT
);

-- Order log — every order we place + every status update
CREATE TABLE IF NOT EXISTS kite_orders_log (
  order_id TEXT PRIMARY KEY,
  exchange TEXT,
  tradingsymbol TEXT,
  transaction_type TEXT,
  quantity INTEGER,
  filled_quantity INTEGER,
  pending_quantity INTEGER,
  cancelled_quantity INTEGER,
  order_type TEXT,
  product TEXT,
  validity TEXT,
  price_paise INTEGER,
  trigger_price_paise INTEGER,
  average_price_paise INTEGER,
  status TEXT,
  status_message TEXT,
  tag TEXT,
  parent_order_id TEXT,
  placed_at INTEGER NOT NULL,
  last_update_ts INTEGER,
  exchange_timestamp INTEGER,
  related_position_id INTEGER         -- FK to position_watchlist
);
CREATE INDEX IF NOT EXISTS idx_kite_orders_recent ON kite_orders_log(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kite_orders_position ON kite_orders_log(related_position_id);

-- GTT lifecycle log
CREATE TABLE IF NOT EXISTS kite_gtt_log (
  gtt_id TEXT PRIMARY KEY,
  type TEXT,                          -- 'single' | 'two-leg'
  status TEXT,                        -- 'active' | 'triggered' | 'disabled' | 'cancelled' | 'deleted'
  exchange TEXT,
  tradingsymbol TEXT,
  trigger_values_json TEXT,
  orders_json TEXT,
  created_at INTEGER NOT NULL,
  last_update_ts INTEGER,
  triggered_at INTEGER,
  related_position_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kite_gtt_recent ON kite_gtt_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kite_gtt_position ON kite_gtt_log(related_position_id);

-- Trades — actual fills (different from orders, more accurate for fill prices)
CREATE TABLE IF NOT EXISTS kite_trades (
  trade_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  exchange TEXT,
  tradingsymbol TEXT,
  transaction_type TEXT,
  quantity INTEGER,
  average_price_paise INTEGER,
  product TEXT,
  filled_at INTEGER,
  exchange_timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kite_trades_order ON kite_trades(order_id);

-- Add the gtt_id column to position_watchlist so we can manage GTTs per position
ALTER TABLE position_watchlist ADD COLUMN kite_gtt_id TEXT;
ALTER TABLE position_watchlist ADD COLUMN kite_entry_order_id TEXT;
ALTER TABLE position_watchlist ADD COLUMN actual_fill_price_paise INTEGER;
