-- Delivery Aggregator COA Ring 1 foundation.
-- Closed entity space for HE/NCH Swiggy/Zomato direct API ingestion.
-- No partner secrets are stored here.

CREATE TABLE IF NOT EXISTS aggregator_coa_brand (
  code TEXT PRIMARY KEY CHECK (code IN ('he', 'nch')),
  canonical_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  legal_entity TEXT NOT NULL DEFAULT 'HN Hotels Private Limited',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aggregator_coa_outlet (
  code TEXT PRIMARY KEY,
  brand_code TEXT NOT NULL REFERENCES aggregator_coa_brand(code),
  canonical_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  locality TEXT NOT NULL,
  production_pos_host TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aggregator_coa_platform (
  code TEXT PRIMARY KEY CHECK (code IN ('swiggy', 'zomato')),
  canonical_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_shape TEXT NOT NULL CHECK (auth_shape IN ('access_token', 'cookie_csrf')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aggregator_coa_platform_outlet (
  code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  brand_code TEXT NOT NULL REFERENCES aggregator_coa_brand(code),
  outlet_code TEXT NOT NULL REFERENCES aggregator_coa_outlet(code),
  platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
  partner_outlet_id TEXT NOT NULL,
  partner_outlet_name TEXT NOT NULL,
  production_role TEXT NOT NULL DEFAULT 'delivery_orders',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform_code, partner_outlet_id),
  CHECK (
    code IN (
      'swiggy_he_1342888',
      'swiggy_nch_1342887',
      'zomato_he_22632449',
      'zomato_nch_22632430'
    )
  )
);

CREATE TABLE IF NOT EXISTS aggregator_coa_pull_source (
  code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('current_orders', 'history_orders', 'order_detail')),
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
  endpoint_family TEXT NOT NULL,
  replayable INTEGER NOT NULL DEFAULT 1 CHECK (replayable IN (0, 1)),
  freshness_sla_minutes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aggregator_coa_health_state (
  code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK (severity IN ('ok', 'warn', 'critical')),
  owner_visible INTEGER NOT NULL DEFAULT 1 CHECK (owner_visible IN (0, 1)),
  waba_alert_allowed INTEGER NOT NULL DEFAULT 0 CHECK (waba_alert_allowed IN (0, 1)),
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aggregator_coa_issue_code (
  code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  platform_code TEXT REFERENCES aggregator_coa_platform(code),
  owner_visible INTEGER NOT NULL DEFAULT 1 CHECK (owner_visible IN (0, 1)),
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aggregator_coa_session_slot (
  code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  platform_code TEXT NOT NULL REFERENCES aggregator_coa_platform(code),
  auth_shape TEXT NOT NULL CHECK (auth_shape IN ('access_token', 'cookie_csrf')),
  secret_storage TEXT NOT NULL CHECK (secret_storage IN ('cloudflare_secret', 'local_curl_file', 'manual_refresh_only')),
  state_code TEXT NOT NULL DEFAULT 'not_configured' REFERENCES aggregator_coa_health_state(code),
  last_validated_at TEXT,
  expires_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agg_coa_platform_outlet_brand
  ON aggregator_coa_platform_outlet(brand_code, platform_code);

CREATE INDEX IF NOT EXISTS idx_agg_coa_pull_platform
  ON aggregator_coa_pull_source(platform_code, source_kind);
