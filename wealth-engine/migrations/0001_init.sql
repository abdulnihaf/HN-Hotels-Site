-- ═══════════════════════════════════════════════════════════════════════════
-- WEALTH ENGINE — D1 SCHEMA v1
-- Database: wealth-engine
-- All money fields stored in PAISE (INTEGER). Convert to ₹ at display layer.
-- All timestamps stored as ms-epoch INTEGER (UTC). Display in IST.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- OPS / METADATA
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_name TEXT NOT NULL,
  cron_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT,
  rows_written INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  trigger_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_log_recent ON cron_run_log(cron_name, started_at DESC);

CREATE TABLE IF NOT EXISTS source_health (
  source_name TEXT PRIMARY KEY,
  last_success_ts INTEGER,
  consecutive_failures INTEGER DEFAULT 0,
  last_error TEXT,
  is_circuit_broken INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS backfill_progress (
  source_name TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  date_completed TEXT,
  rows_loaded INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  last_attempt_at INTEGER,
  error TEXT,
  PRIMARY KEY (source_name, date_from)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 1 — PRICE & VOLUME (sources 1-10)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equity_eod (
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open_paise INTEGER NOT NULL,
  high_paise INTEGER NOT NULL,
  low_paise INTEGER NOT NULL,
  close_paise INTEGER NOT NULL,
  prev_close_paise INTEGER,
  volume INTEGER,
  delivery_qty INTEGER,
  delivery_pct REAL,
  total_trades INTEGER,
  vwap_paise INTEGER,
  series TEXT,
  isin TEXT,
  source TEXT,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, exchange, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_eod_date ON equity_eod(trade_date);
CREATE INDEX IF NOT EXISTS idx_eod_symbol_recent ON equity_eod(symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_eod_isin ON equity_eod(isin);

CREATE TABLE IF NOT EXISTS indices_eod (
  index_name TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open_paise INTEGER,
  high_paise INTEGER,
  low_paise INTEGER,
  close_paise INTEGER,
  prev_close_paise INTEGER,
  pe_ratio REAL,
  pb_ratio REAL,
  div_yield REAL,
  source TEXT,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (index_name, trade_date)
);

CREATE TABLE IF NOT EXISTS intraday_ticks (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ltp_paise INTEGER NOT NULL,
  volume_cum INTEGER,
  bid_paise INTEGER,
  ask_paise INTEGER,
  buy_qty INTEGER,
  sell_qty INTEGER,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_intraday_ts ON intraday_ticks(ts);

CREATE TABLE IF NOT EXISTS preopen_snapshot (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  iep_paise INTEGER,
  iep_change_pct REAL,
  total_buy_qty INTEGER,
  total_sell_qty INTEGER,
  prev_close_paise INTEGER,
  PRIMARY KEY (symbol, ts)
);

CREATE TABLE IF NOT EXISTS gift_nifty_ticks (
  ts INTEGER PRIMARY KEY,
  ltp REAL,
  change_pct REAL,
  contract_month TEXT,
  volume INTEGER
);

CREATE TABLE IF NOT EXISTS weekly_extremes (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  extreme_type TEXT NOT NULL,
  price_paise INTEGER,
  PRIMARY KEY (trade_date, symbol, extreme_type)
);

CREATE TABLE IF NOT EXISTS circuit_hits (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  circuit_type TEXT NOT NULL,
  band_pct REAL,
  ltp_paise INTEGER,
  PRIMARY KEY (trade_date, symbol, circuit_type)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 2 — INSTITUTIONAL FLOW (sources 11-18)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fii_dii_daily (
  trade_date TEXT NOT NULL,
  segment TEXT NOT NULL,
  fii_buy_cr REAL,
  fii_sell_cr REAL,
  fii_net_cr REAL,
  dii_buy_cr REAL,
  dii_sell_cr REAL,
  dii_net_cr REAL,
  ingested_at INTEGER,
  PRIMARY KEY (trade_date, segment)
);

CREATE TABLE IF NOT EXISTS fii_deriv_daily (
  trade_date TEXT NOT NULL,
  instrument TEXT NOT NULL,
  buy_contracts INTEGER,
  buy_value_cr REAL,
  sell_contracts INTEGER,
  sell_value_cr REAL,
  oi_contracts INTEGER,
  oi_value_cr REAL,
  PRIMARY KEY (trade_date, instrument)
);

CREATE TABLE IF NOT EXISTS fno_participant_oi (
  trade_date TEXT NOT NULL,
  participant TEXT NOT NULL,
  instrument TEXT NOT NULL,
  long_oi INTEGER,
  short_oi INTEGER,
  long_value_cr REAL,
  short_value_cr REAL,
  PRIMARY KEY (trade_date, participant, instrument)
);

CREATE TABLE IF NOT EXISTS bulk_block_deals (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  client_name TEXT,
  txn_type TEXT,
  qty INTEGER,
  price_paise INTEGER,
  ingested_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deals_symbol ON bulk_block_deals(symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_deals_client ON bulk_block_deals(client_name, trade_date DESC);

CREATE TABLE IF NOT EXISTS fno_ban_list (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  PRIMARY KEY (trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS mwpl_utilization (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  mwpl_pct REAL,
  PRIMARY KEY (trade_date, symbol)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 3 — OPTIONS (sources 19-23)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS option_chain_snapshot (
  ts INTEGER NOT NULL,
  underlying TEXT NOT NULL,
  expiry TEXT NOT NULL,
  strike_paise INTEGER NOT NULL,
  ce_oi INTEGER,
  ce_chg_oi INTEGER,
  ce_volume INTEGER,
  ce_iv REAL,
  ce_ltp_paise INTEGER,
  ce_bid_paise INTEGER,
  ce_ask_paise INTEGER,
  pe_oi INTEGER,
  pe_chg_oi INTEGER,
  pe_volume INTEGER,
  pe_iv REAL,
  pe_ltp_paise INTEGER,
  pe_bid_paise INTEGER,
  pe_ask_paise INTEGER,
  underlying_paise INTEGER,
  PRIMARY KEY (ts, underlying, expiry, strike_paise)
);
CREATE INDEX IF NOT EXISTS idx_oc_under_recent ON option_chain_snapshot(underlying, expiry, ts DESC);

CREATE TABLE IF NOT EXISTS india_vix_ticks (
  ts INTEGER PRIMARY KEY,
  vix REAL NOT NULL,
  change_pct REAL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 4 — CORPORATE INTELLIGENCE (sources 24-31)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS corp_announcements (
  id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  ann_time INTEGER NOT NULL,
  category TEXT,
  subject TEXT,
  details TEXT,
  attachment_url TEXT,
  parsed_keywords TEXT,
  sentiment_score REAL,
  materiality_score REAL,
  ingested_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ann_symbol_recent ON corp_announcements(symbol, ann_time DESC);
CREATE INDEX IF NOT EXISTS idx_ann_recent ON corp_announcements(ann_time DESC);

CREATE TABLE IF NOT EXISTS insider_trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  person_name TEXT,
  designation TEXT,
  txn_type TEXT,
  qty INTEGER,
  value_paise INTEGER,
  txn_date TEXT,
  filed_date TEXT,
  reg_compliance TEXT,
  ingested_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_insider_symbol ON insider_trades(symbol, txn_date DESC);

CREATE TABLE IF NOT EXISTS corp_actions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  action_type TEXT,
  ratio TEXT,
  amount_paise INTEGER,
  ex_date TEXT,
  record_date TEXT,
  announcement_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_corp_act_symbol ON corp_actions(symbol, ex_date DESC);

CREATE TABLE IF NOT EXISTS board_meetings (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  purpose TEXT,
  is_results_meeting INTEGER
);
CREATE INDEX IF NOT EXISTS idx_board_date ON board_meetings(meeting_date);

CREATE TABLE IF NOT EXISTS results_calendar (
  symbol TEXT NOT NULL,
  result_date TEXT NOT NULL,
  fiscal_period TEXT,
  expected_session TEXT,
  PRIMARY KEY (symbol, result_date)
);

CREATE TABLE IF NOT EXISTS shareholding_pattern (
  symbol TEXT NOT NULL,
  quarter_end TEXT NOT NULL,
  promoter_pct REAL,
  fii_pct REAL,
  dii_pct REAL,
  public_pct REAL,
  mf_pct REAL,
  insurance_pct REAL,
  PRIMARY KEY (symbol, quarter_end)
);

CREATE TABLE IF NOT EXISTS promoter_pledge (
  symbol TEXT NOT NULL,
  filing_date TEXT NOT NULL,
  pledged_qty INTEGER,
  pledged_pct REAL,
  encumbered_pct REAL,
  PRIMARY KEY (symbol, filing_date)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 5 — MACRO + CROSS-ASSET (sources 32-43)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS macro_indicators (
  indicator_code TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT,
  release_ts INTEGER,
  PRIMARY KEY (indicator_code, observation_date)
);

CREATE TABLE IF NOT EXISTS crossasset_ticks (
  asset_code TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (asset_code, ts)
);
CREATE INDEX IF NOT EXISTS idx_xa_recent ON crossasset_ticks(asset_code, ts DESC);

CREATE TABLE IF NOT EXISTS bond_yields (
  trade_date TEXT NOT NULL,
  tenor TEXT NOT NULL,
  yield_pct REAL,
  PRIMARY KEY (trade_date, tenor)
);

CREATE TABLE IF NOT EXISTS weather_macro (
  observation_date TEXT NOT NULL,
  region TEXT NOT NULL,
  rainfall_mm REAL,
  rainfall_dev_pct REAL,
  forecast_horizon TEXT,
  PRIMARY KEY (observation_date, region)
);

CREATE TABLE IF NOT EXISTS power_consumption (
  observation_date TEXT PRIMARY KEY,
  total_demand_mw REAL,
  yoy_change_pct REAL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 6 — NEWS & SOCIAL (sources 44-53)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS news_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT,
  headline TEXT NOT NULL,
  body_excerpt TEXT,
  symbols_tagged TEXT,
  sectors_tagged TEXT,
  sentiment_score REAL,
  importance_score REAL,
  published_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_recent ON news_items(published_at DESC);

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  author TEXT,
  content TEXT,
  symbols_tagged TEXT,
  sentiment_score REAL,
  engagement_score REAL,
  posted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_recent ON social_posts(posted_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 7 — EVENT CALENDAR (sources 54-57)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS macro_calendar (
  id TEXT PRIMARY KEY,
  event_ts INTEGER NOT NULL,
  country TEXT,
  event_name TEXT,
  importance INTEGER,
  forecast TEXT,
  previous TEXT,
  actual TEXT
);
CREATE INDEX IF NOT EXISTS idx_cal_upcoming ON macro_calendar(event_ts);

-- ═══════════════════════════════════════════════════════════════════════════
-- LAYER 8 — SECTOR & BREADTH (sources 58-61)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sector_indices (
  index_name TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open_paise INTEGER,
  high_paise INTEGER,
  low_paise INTEGER,
  close_paise INTEGER,
  PRIMARY KEY (index_name, trade_date)
);

CREATE TABLE IF NOT EXISTS most_active (
  ts INTEGER NOT NULL,
  rank_type TEXT NOT NULL,
  rank INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  metric_value REAL,
  PRIMARY KEY (ts, rank_type, rank)
);

CREATE TABLE IF NOT EXISTS breadth_data (
  ts INTEGER PRIMARY KEY,
  advances INTEGER,
  declines INTEGER,
  unchanged INTEGER,
  new_highs INTEGER,
  new_lows INTEGER,
  ad_ratio REAL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNAL & PORTFOLIO LAYER
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS signal_scores (
  computed_at INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  trend_score REAL,
  flow_score REAL,
  options_score REAL,
  catalyst_score REAL,
  macro_score REAL,
  sentiment_score REAL,
  breadth_score REAL,
  composite_score REAL,
  rationale_json TEXT,
  PRIMARY KEY (computed_at, symbol)
);
CREATE INDEX IF NOT EXISTS idx_sig_top ON signal_scores(computed_at, composite_score DESC);

CREATE TABLE IF NOT EXISTS cascade_triggers_active (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at INTEGER NOT NULL,
  pattern_name TEXT NOT NULL,
  source_event_id TEXT,
  expected_window_start INTEGER,
  expected_window_end INTEGER,
  affected_symbols TEXT,
  historical_win_rate REAL,
  expected_return_pct REAL,
  status TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tranche TEXT NOT NULL,
  symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  entry_date TEXT,
  entry_price_paise INTEGER,
  qty INTEGER,
  stop_paise INTEGER,
  target_paise INTEGER,
  status TEXT,
  exit_date TEXT,
  exit_price_paise INTEGER,
  pnl_paise INTEGER,
  rationale TEXT
);

CREATE TABLE IF NOT EXISTS trade_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  tranche TEXT,
  from_symbol TEXT,
  to_symbol TEXT,
  amount_paise INTEGER,
  rationale TEXT,
  signal_score_delta REAL
);
