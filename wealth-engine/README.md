# Wealth Engine — Deployment Runbook

Algorithmic trading data pipeline. 61 data sources across 8 layers, dispatched by Cloudflare Worker crons, persisted to D1, surfaced at `hnhotels.in/trading`.

## Status

- ✅ **Schema** — all 8 layers (`migrations/0001_init.sql`)
- ✅ **Shared helpers** — NSE cookie client, Yahoo Finance, CSV/zip parsers, sentiment, D1 batch insert
- ✅ **W1 wealth-price-core** — Layer 1 Price & Volume (10 sources)
- ✅ **W2 wealth-flow-engine** — Layer 2 Institutional Flow (8 sources)
- ✅ **W3 wealth-options** — Layer 3 Options & VIX (5 sources)
- ✅ **W4 wealth-corp-intel** — Layer 4 Corporate Intelligence (8 sources)
- ✅ **W5 wealth-macro-in** — Layer 5a India Macro (7 sources)
- ✅ **W6 wealth-macro-global** — Layer 5b Global / Cross-Asset (8 sources via FRED + Yahoo)
- ✅ **W7 wealth-news** — Layer 6 News & Sentiment (10 sources)
- ✅ **W8 wealth-calendar-breadth** — Layer 7+8 Calendar / Sector / Breadth (5 sources)
- ✅ **W9 wealth-signal-engine** — Composite scoring + cascade detection (7 dimensions, 5 patterns)
- ✅ **Dashboard** — `/trading` route, PIN-gated, mobile-first, 16 tabs
- ✅ **API** — `/api/trading` Pages Function with 22 actions

**Total: 61 sources across 9 Workers feeding 1 D1 database, surfaced through 1 dashboard.**

## One-time setup

### 1. Create the D1 database

```bash
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site
wrangler d1 create wealth-engine
```

Output:
```
✅ Successfully created DB 'wealth-engine'
[[d1_databases]]
binding = "DB"
database_name = "wealth-engine"
database_id = "<UUID-HERE>"
```

Copy the `database_id`.

### 2. Apply the schema

```bash
wrangler d1 execute wealth-engine --remote --file=wealth-engine/migrations/0001_init.sql
```

### 3. Wire the database_id into both wrangler.toml files

Replace `1e3cea30-5990-43d2-a9de-b749d32e225a` with the UUID in:
- `wrangler.toml` (root — for Pages /api/trading)
- `wealth-engine/workers/wealth-price-core/wrangler.toml` (for the cron Worker)

### 4. Set secrets

For the Pages site (the dashboard):
```bash
# DASHBOARD_KEY is reused — same key gates /trading and the Worker triggers
wrangler pages secret put DASHBOARD_KEY --project-name hn-hotels-site
```

For the wealth-price-core Worker:
```bash
cd wealth-engine/workers/wealth-price-core
wrangler secret put DASHBOARD_KEY
```

### 5. Set FRED API key (for W6 macro-global)

```bash
cd wealth-engine/workers/wealth-macro-global
wrangler secret put FRED_API_KEY
# paste the 32-char hex key from fredaccount.stlouisfed.org/apikey
```

### 6. Deploy all 9 Workers

```bash
for w in wealth-price-core wealth-flow-engine wealth-options wealth-corp-intel \
         wealth-macro-in wealth-macro-global wealth-news \
         wealth-calendar-breadth wealth-signal-engine; do
  cd "wealth-engine/workers/$w"
  wrangler secret put DASHBOARD_KEY    # paste the same key each time
  wrangler deploy
  cd -
done
```

Each `wrangler deploy` should list the cron triggers it just registered. Total registered crons across all 9 Workers: ~30 distinct schedules.

### 7. Deploy the Pages site (publishes dashboard + API)

From the repo root:
```bash
wrangler pages deploy . --project-name hn-hotels-site
```

`https://hnhotels.in/trading` will now resolve.

## Verification

Open `https://hnhotels.in/trading`. Enter `DASHBOARD_KEY`. You should see:
- Universe Loaded: 0 rows (until backfill runs)
- Cron Activity: 0 (until first cron fires)
- Source Health: empty (populates after first run)

## First backfill

The Worker exposes an HTTP endpoint for backfill. Run NSE bhavcopy backfill (2 years):

```bash
WORKER_URL="https://wealth-price-core.<your-account>.workers.dev"
curl "$WORKER_URL/backfill?source=nse_bhavcopy&from=2024-05-03&to=2026-05-02&key=$DASHBOARD_KEY"
```

This iterates 500 trading days, fetches each bhavcopy, parses ~2,000 stocks per day, batch-inserts into `equity_eod`. Expect ~30-45 min on free tier.

Repeat for BSE and delivery:
```bash
curl "$WORKER_URL/backfill?source=bse_bhavcopy&from=2024-05-03&to=2026-05-02&key=$DASHBOARD_KEY"
curl "$WORKER_URL/backfill?source=delivery&from=2024-05-03&to=2026-05-02&key=$DASHBOARD_KEY"
```

Watch progress on the dashboard's **Cron Health** tab.

## Manual triggers

Run any source on-demand:
```bash
# Today's NSE indices
curl "$WORKER_URL/run/nse_indices?key=$DASHBOARD_KEY"

# Today's pre-open snapshot
curl "$WORKER_URL/run/preopen?key=$DASHBOARD_KEY"

# 52-week extremes
curl "$WORKER_URL/run/52w_extremes?key=$DASHBOARD_KEY"

# Specific date bhavcopy
curl "$WORKER_URL/run/nse_bhavcopy?date=2026-04-30&key=$DASHBOARD_KEY"
```

Check `/status?key=$DASHBOARD_KEY` for last 50 runs.

## Cron schedule reference (W1)

All times below are **IST** (Cloudflare runs the cron in UTC; the wrangler.toml has the UTC equivalents):

| IST Time | Source | Frequency |
|---|---|---|
| 09:00-09:08 | Pre-open snapshot | Every minute |
| 09:15-15:30 | Intraday quote | Every 5 min |
| 09:15-15:30 | Yahoo backup EOD | Every 15 min |
| 06:30-23:55 | GIFT Nifty | Every 5 min |
| 16:00 | 52w extremes + circuits | Daily M-F |
| 17:35 | NSE indices | Daily M-F |
| 18:00 | NSE EOD bhavcopy | Daily M-F |
| 18:15 | BSE EOD bhavcopy | Daily M-F |
| 19:30 | NSE delivery % | Daily M-F |

## Architecture

```
┌─ /trading (Pages site, hnhotels.in/trading)
│   └── PIN-gated dashboard
│       └── calls /api/trading?action=...
│
├─ /api/trading.js (Pages Function)
│   └── reads from WEALTH_DB (D1: wealth-engine)
│
├─ Worker: wealth-price-core
│   ├── scheduled() → cron dispatcher → 10 source ingestors
│   ├── fetch() → /run/<source>, /backfill, /status
│   └── writes to WEALTH_DB
│
└─ D1: wealth-engine
    ├── Layer 1 tables: equity_eod, indices_eod, intraday_ticks,
    │                   preopen_snapshot, gift_nifty_ticks,
    │                   weekly_extremes, circuit_hits
    ├── Layers 2-8 tables (schema ready, Workers pending)
    ├── signal_scores, portfolio_positions, trade_log (signal engine pending)
    └── cron_run_log, source_health, backfill_progress (ops/observability)
```

## Database conventions

- **All money in PAISE** (INTEGER). Convert at display layer via `/100`.
- **All timestamps in ms-epoch UTC** (INTEGER). Display in IST.
- **Date-only fields in `YYYY-MM-DD`** (TEXT) for human readability.
- **`ON CONFLICT REPLACE`** is the default for daily snapshots — same source, same key = newest wins.
- **`source` column** preserved on every row so we can prefer NSE-bhavcopy over Yahoo when both exist for the same symbol+date.

## Roadmap (next workers)

| Worker | Layer | Sources | Status |
|---|---|---|---|
| W1 wealth-price-core | 1 | 10 sources | ✅ Built |
| W2 wealth-flow-engine | 2 | FII/DII, bulk/block, F&O OI, ban list, MWPL | Pending |
| W3 wealth-options | 3 | Nifty/BankNifty/FinNifty/stock chains, India VIX | Pending |
| W4 wealth-corp-intel | 4 | Announcements, insider, actions, board mtg, results, holdings, pledge | Pending |
| W5 wealth-macro-in | 5a | RBI, GST, MoSPI, PMI, IMD, POSOCO | Pending |
| W6 wealth-macro-global | 5b | FRED, DXY, US10Y, VIX, S&P fut, crude, gold, Asian | Pending |
| W7 wealth-news | 6 | GDELT, RSS feeds, Reddit, Nitter, StockTwits | Pending |
| W8 wealth-calendar-breadth | 7+8 | Calendars, sector indices, breadth, bonds | Pending |
| W9 wealth-signal-engine | — | Composite scoring, cascade detection, rotation logic | Pending |

## Testing locally (without deploy)

```bash
cd wealth-engine/workers/wealth-price-core
wrangler dev --remote
```

Then trigger any cron manually:
```bash
wrangler dev --remote --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+12+*+*+1-5"
```
