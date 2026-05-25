-- Delivery Aggregator COA Ring 3 event/intelligence layer.
-- Events are composed from Ring 2 order actions and Ring 1 coordinates.
-- This schema stores proof rows only; it does not authorize price/offer mutation.

CREATE TABLE IF NOT EXISTS aggregator_coa_event (
  event_key TEXT PRIMARY KEY,
  event_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  platform_code TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_date TEXT,
  order_time TEXT,
  order_value REAL,
  estimated_loss REAL NOT NULL DEFAULT 0,
  status_code TEXT,
  item_summary TEXT,
  evidence_json TEXT,
  source_run_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolution_state TEXT NOT NULL DEFAULT 'open'
    CHECK (resolution_state IN ('open', 'watching', 'resolved', 'ignored'))
);

CREATE TABLE IF NOT EXISTS aggregator_coa_price_offer_candidate (
  candidate_key TEXT PRIMARY KEY,
  brand_code TEXT NOT NULL,
  platform_code TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  orders_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  missed_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  delivered_revenue REAL NOT NULL DEFAULT 0,
  cancelled_rejected_loss REAL NOT NULL DEFAULT 0,
  discount_known_orders INTEGER NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  aov REAL NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  gate_status TEXT NOT NULL
    CHECK (gate_status IN ('data_gathering', 'proof_review', 'margin_required', 'ready_for_owner_review')),
  evidence_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agg_coa_event_window
  ON aggregator_coa_event(order_date, brand_code, platform_code, event_code);

CREATE INDEX IF NOT EXISTS idx_agg_coa_event_code
  ON aggregator_coa_event(event_code, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_agg_coa_candidate_window
  ON aggregator_coa_price_offer_candidate(window_from, window_to, brand_code, platform_code);
