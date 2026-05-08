# D1 Schema — wealth-engine

**Database:** `wealth-engine` (id: `1e3cea30-5990-43d2-a9de-b749d32e225a`)
**Migrations:** `wealth-engine/migrations/00**_*.sql`

All money columns are `INTEGER` storing **paise**. Display layer divides by 100.
All timestamps are `INTEGER` storing **ms epoch UTC**. Display formats to IST.

---

## Market data tables

### `daily_bars`
```sql
symbol TEXT, date TEXT, open INTEGER, high INTEGER, low INTEGER,
close INTEGER, volume INTEGER, prev_close INTEGER, traded_value INTEGER,
PRIMARY KEY (symbol, date)
```
Source: wealth-kite-bhavcopy. EOD daily.

### `intraday_bars`
```sql
symbol TEXT, ts INTEGER, open INTEGER, high INTEGER, low INTEGER,
close INTEGER, volume INTEGER, oi INTEGER,
PRIMARY KEY (symbol, ts)
```
Source: wealth-intraday-bars. 5-min during market hours.

### `kite_quotes`
```sql
symbol TEXT, ts INTEGER, ltp INTEGER, bid INTEGER, ask INTEGER,
day_high INTEGER, day_low INTEGER, day_open INTEGER, volume INTEGER, oi INTEGER
```
Source: wealth-price-core. ⚠️ table sometimes empty — verify writes.

### `kite_instruments`
```sql
instrument_token INTEGER PRIMARY KEY, exchange_token INTEGER,
symbol TEXT, name TEXT, last_price INTEGER, expiry TEXT,
strike INTEGER, tick_size INTEGER, lot_size INTEGER,
instrument_type TEXT, segment TEXT, exchange TEXT
```
Source: wealth-intraday-bars weekly refresh.

### `kite_tokens`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, access_token TEXT, refresh_token TEXT,
public_token TEXT, user_id TEXT, obtained_at INTEGER, expires_at INTEGER,
is_active INTEGER DEFAULT 1
```
⚠️ Sort by `id DESC LIMIT 1` to get current token. (NOT `created_at`.)

### `options_snapshots`
```sql
underlying TEXT, expiry TEXT, strike INTEGER, type TEXT,
oi INTEGER, iv REAL, ts INTEGER, ltp INTEGER, volume INTEGER
```

### `index_snapshots`
```sql
index_name TEXT, ts INTEGER, value INTEGER, change_pct REAL
```

### `fii_dii_flows`
```sql
date TEXT, segment TEXT, fii_buy INTEGER, fii_sell INTEGER,
dii_buy INTEGER, dii_sell INTEGER, net INTEGER
```

### `earnings_calendar`
```sql
symbol TEXT, ann_date TEXT, period TEXT, before_market INTEGER
```

### `news_articles`
```sql
id TEXT PRIMARY KEY, source TEXT, headline TEXT, body TEXT,
url TEXT, published_at INTEGER, fetched_at INTEGER,
tickers_json TEXT, sentiment TEXT, urgency INTEGER, processed INTEGER
```
⚠️ Currently `no_data` per intelligence_audit — verify cron firing.

---

## Decision / verdict tables

### `daily_verdicts` (Migration 0014)
```sql
id INTEGER PRIMARY KEY, date TEXT, version INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1,
verdict TEXT,             -- TRADE / SIT_OUT / OBSERVE
recommended_symbol TEXT,  -- denormalized top pick
picks_json TEXT,          -- full array of picks
alternatives_json TEXT,
portfolio_summary_json TEXT,
halt_rules_json TEXT,
rationale TEXT,
llm_model_used TEXT,
prompt_tokens INTEGER, completion_tokens INTEGER, cost_paise INTEGER,
created_at INTEGER, invalidated_at INTEGER
```

### `pre_market_briefings`
```sql
date TEXT PRIMARY KEY, briefing_md TEXT, briefing_json TEXT, model_used TEXT, created_at INTEGER
```

### `alert_classifications` (Migration 0014)
```sql
id INTEGER PRIMARY KEY, news_id TEXT, classification TEXT,
affects_picks_json TEXT, urgency INTEGER, ts INTEGER
```

### `intraday_suitability` (Migration 0015)
```sql
symbol TEXT PRIMARY KEY,
sector_bucket TEXT,
regime TEXT,                   -- HOT / STABLE / COOLING / ILLIQUID
hybrid_score REAL,
rr_ratio REAL, green_day_rate REAL, liquidity_score REAL,
recency_factor REAL, daily_atr REAL, intraday_vol_pct REAL,
last_ranked_at INTEGER
```

---

## Execution tables

### `paper_trades` (extended)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT,
entry_at INTEGER NOT NULL,         -- ⚠️ insert Date.now() placeholder for WATCHING
entry_paise INTEGER, qty INTEGER,
stop_paise INTEGER, target_paise INTEGER,
exit_at INTEGER, exit_paise INTEGER, exit_reason TEXT,
pnl_paise INTEGER, pnl_net_paise INTEGER, win_loss TEXT,
thesis TEXT, source TEXT,
auto_managed INTEGER DEFAULT 0,
trader_state TEXT,                 -- WATCHING/ENTERED/EXITED/HELD_OVERNIGHT/SKIPPED/ABANDONED
peak_price_paise INTEGER,
trailing_stop_paise INTEGER,
strategy_mode TEXT DEFAULT 'INTRADAY_DEFAULT',
mode_promoted_at INTEGER,
or_high_paise INTEGER, or_low_paise INTEGER
```

### `trader_decisions`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, paper_trade_id INTEGER, ts INTEGER,
cron_phase TEXT, decision TEXT, rationale TEXT, snapshot_json TEXT,
llm_model_used TEXT
```

### `opening_ranges`
```sql
symbol TEXT, date TEXT, or_high_paise INTEGER, or_low_paise INTEGER,
or_volume INTEGER, captured_at INTEGER,
PRIMARY KEY (symbol, date)
```

---

## Learning / audit tables

### `paper_trade_autopsies` (Migration 0014)
```sql
id INTEGER PRIMARY KEY, paper_trade_id INTEGER UNIQUE,
mfe_paise INTEGER, mae_paise INTEGER, slippage_pct REAL,
time_to_mfe_min INTEGER, time_to_mae_min INTEGER,
narrative TEXT, lesson TEXT, lesson_confidence INTEGER,
post_exit_move_pct REAL, model_used TEXT, created_at INTEGER
```

### `eod_learning_audits` ⭐ NEW
```sql
date TEXT PRIMARY KEY,
picks_summary_json TEXT,           -- compact: [{symbol,bucket,pnl_paise}]
buckets_json TEXT,                 -- {right:{count,pnl},missed:{count,pnl},learned:{count,pnl},luck:{count,pnl}}
narrative TEXT,                    -- Sonnet 3-5 paragraphs
skill_pct REAL,
tuning_suggestions_json TEXT,
model_used TEXT, created_at INTEGER
```

### `weekly_reviews` (Migration 0014)
```sql
week_start TEXT PRIMARY KEY,
summary TEXT, top_takeaways_json TEXT,
strategy_adjustments_json TEXT, model_used TEXT, created_at INTEGER
```

---

## System / observability tables

### `cron_fires`
```sql
worker_name TEXT, cron_expr TEXT, last_fire_ts INTEGER,
last_status TEXT, fires_24h INTEGER, fails_24h INTEGER
```

### `anthropic_spend`
```sql
date TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
cached_tokens INTEGER, cost_paise INTEGER
```

### `concall_signals`
```sql
symbol TEXT, qtr TEXT, sentiment TEXT, key_points_json TEXT,
processed_at INTEGER, expires_at INTEGER
```

---

## Critical conventions

1. **All money = paise (INTEGER).** No REAL. No rupees. Convert at display only.
2. **All time = ms epoch UTC (INTEGER).** Convert to IST at display.
3. **Symbol = uppercase NSE EQ ticker.** No exchange prefix.
4. **Date = `YYYY-MM-DD` IST.** Trading-day local string.
5. **Boolean = INTEGER 0/1.** SQLite has no real bool.
6. **JSON columns** named `*_json`. Always parsed at API boundary.
7. **Soft-delete via `is_active INTEGER`** rather than DELETE — keeps history.

---

## Migration list

> Auto-regenerated from `wealth-engine/migrations/*.sql` — do not edit between markers.

<!-- AUTO:migrations-list -->
| Migration | Tables created | Columns added |
|---|---|---|
| `0001_init.sql` | `cron_run_log`, `source_health`, `backfill_progress`, `equity_eod`, `indices_eod`, `intraday_ticks`, `preopen_snapshot`, `gift_nifty_ticks`, `weekly_extremes`, `circuit_hits`, `fii_dii_daily`, `fii_deriv_daily`, `fno_participant_oi`, `bulk_block_deals`, `fno_ban_list`, `mwpl_utilization`, `option_chain_snapshot`, `india_vix_ticks`, `corp_announcements`, `insider_trades`, `corp_actions`, `board_meetings`, `results_calendar`, `shareholding_pattern`, `promoter_pledge`, `macro_indicators`, `crossasset_ticks`, `bond_yields`, `weather_macro`, `power_consumption`, `news_items`, `social_posts`, `macro_calendar`, `sector_indices`, `most_active`, `breadth_data`, `signal_scores`, `cascade_triggers_active`, `portfolio_positions`, `trade_log` | — |
| `0002_kite_tokens.sql` | `kite_tokens`, `kite_api_log` | — |
| `0003_orchestrator.sql` | `system_alerts`, `daily_briefings`, `portfolio_snapshots_daily`, `backfill_queue`, `position_watchlist`, `weekly_performance`, `kite_token_reminders` | — |
| `0004_user_config.sql` | `user_config` | — |
| `0005_kite_integration.sql` | `kite_holdings_live`, `kite_funds_live`, `kite_orders_log`, `kite_gtt_log`, `kite_trades` | `position_watchlist.kite_gtt_id`, `position_watchlist.kite_entry_order_id`, `position_watchlist.actual_fill_price_paise` |
| `0006_kite_robust.sql` | `kite_instruments`, `kite_endpoint_health`, `kite_bracket_orders`, `kite_margin_cache` | — |
| `0007_backtest.sql` | `backtest_runs`, `backtest_trades`, `backtest_equity_curve` | — |
| `0008_bayesian_learning.sql` | `bayesian_priors`, `bayesian_observations` | — |
| `0009_watchlist_paper_readiness.sql` | `user_watchlist`, `paper_trades`, `readiness_check` | — |
| `0010_fundamentals.sql` | `fundamentals_snapshot` | `signal_scores.quality_score` |
| `0011_cascade_evidence.sql` | — | `cascade_triggers_active.evidence_json` |
| `0011_sector_classification.sql` | `sector_classification` | — |
| `0012_mtf_alignment.sql` | — | `signal_scores.mtf_alignment`, `signal_scores.regime` |
| `0013_anthropic_usage.sql` | `anthropic_usage`, `anthropic_cache` | — |
| `0014_verdict_system.sql` | `daily_verdicts`, `alert_classifications`, `paper_trade_autopsies`, `weekly_reviews` | — |

_Total migrations: 15_
<!-- /AUTO:migrations-list -->

### Hand-curated history

```
0001_init.sql                 -- engine bootstrap
...
0014_verdict_system.sql       -- daily_verdicts, alert_classifications, autopsies, weekly_reviews
0015_intraday_suitability.sql -- intraday_suitability + cols on paper_trades  (planned)
0016_eod_audit.sql            -- eod_learning_audits  (planned)
```

---

## Where it surfaces in UI

- `/trading/ops/` shows row counts per table
- `/trading/today/` Section 7 surfaces table-staleness signals via `intelligence_audit` API
