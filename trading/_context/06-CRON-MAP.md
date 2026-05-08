# Cron Schedule — Full System Map

**Plan:** Cloudflare Workers Paid ($5/mo) → unlimited crons.
**TZ note:** All crons in UTC. IST = UTC + 5:30. Market 09:15–15:30 IST = 03:45–10:00 UTC.

> **The tables below regenerate from `wealth-engine/workers/*/wrangler.toml`.**
> Do not edit between `<!-- AUTO:* -->` markers — run `node scripts/sync-trading-docs.js`.

## Cron overview (auto-generated)

<!-- AUTO:cron-overview-table -->
| Worker | Crons | Sample (first 3) |
|---|---|---|
| `wealth-calendar-breadth` | 8 | `30 0 * * *` (Econ calendar               06:0)<br>`5 12 * * 1-5` (Sector indices EOD          17:3)<br>`30 12 * * 1-5` (Earnings calendar           18:0) |
| `wealth-corp-intel` | 6 | `*/5 2-17 * * *` (NSE announcements every 5 min  0)<br>`2-57/5 2-17 * * *` (BSE announcements every 5 min  ()<br>`30 11 * * 1-5` (Corp actions          17:00 IST) |
| `wealth-event-scraper` | 4 | `30 0 * * *` (06:00 IST  daily      board meet)<br>`0 1 * * *` (06:30 IST  daily      results ca)<br>`0,30 3-10 * * 1-5` (every 30 min,  09:00-15:30 IST  ) |
| `wealth-flow-engine` | 10 | `0 6 * * 1-5` (11:30 IST)<br>`0 8 * * 1-5` (13:30 IST)<br>`0 9 * * 1-5` (14:30 IST) |
| `wealth-fundamentals` | 1 | `0 1 * * 6` |
| `wealth-intraday-bars` | 3 | `30 0 * * 1` (Daily intraday-bar fetch for top)<br>`30 10 * * 1-5` (Weekly enrich: Saturday 07:00 IS)<br>`30 1 * * 6` |
| `wealth-macro-global` | 5 | `*/5 * * * 1-5` (Rates: DXY, US10Y, US2Y, USDINR,)<br>`1-56/5 * * * 1-5` (Equity futures: S&P/Nasdaq/Dow ()<br>`2-57/5 * * * 1-5` (Commodities: Brent/WTI/Gold/Silv) |
| `wealth-macro-in` | 7 | `0 3 * * *` (RBI 08:30 IST)<br>`30 4 * * *` (POSOCO 10:00 IST)<br>`30 8 * * *` (IMD 14:00 IST) |
| `wealth-news` | 6 | `*/5 * * * *` (RSS aggregator    every 5 min  ()<br>`2-57/5 * * * *` (GDELT             every 5 min of)<br>`*/10 * * * *` (Reddit            every 10 min) |
| `wealth-options` | 5 | `*/1 3-10 * * 1-5` (Nifty option chain    every 1 mi)<br>`*/2 3-10 * * 1-5` (BankNifty             every 2 mi)<br>`*/3 3-10 * * 1-5` (India VIX             every 3 mi) |
| `wealth-orchestrator` | 15 | `*/2 * * * *` (1. Backfill drain    every 2 min)<br>`*/15 * * * *` (2. Watchdog          every 15 mi)<br>`30 2 * * 1-5` (3. Pre-market brief  08:00 IST M) |
| `wealth-price-core` | 10 | `5 12 * * 1-5` (NSE indices             17:35 IS)<br>`30 12 * * 1-5` (NSE EOD bhavcopy        18:00 IS)<br>`45 12 * * 1-5` (BSE EOD bhavcopy        18:15 IS) |
| `wealth-signal-engine` | 6 | `30 13 * * 1-5` (Pre-market 08:30 IST → UTC 03:00)<br>`0 3 * * 1-5` (Market hours 09:30-15:30 IST → U)<br>`0 4-9 * * 1-5` (Market hours every 30 min — casc) |
| `wealth-trader` | 4 | `* 4 * * 1-5` (ACTIVE TRADING — every 3 min UTC)<br>`*/3 5-9 * * 1-5` (PRE-MARKET WARM-UP — UTC 03 = IS)<br>`*/15 3 * * 1-5` (POST-MARKET TRANSITION — UTC 10 ) |
| `wealth-verdict` | 8 | `0 2 * * 1-5` (─── MORNING ────────────────────)<br>`0 3 * * 1-5` (─── ALWAYS-ON ──────────────────)<br>`*/5 * * * *` (─── MARKET HOURS ───────────────) |
| **TOTAL** | **98** | across 15 workers |
<!-- /AUTO:cron-overview-table -->

## All crons by worker (auto-generated)

<!-- AUTO:cron-list-by-worker -->
### `wealth-calendar-breadth` (8 crons)

```toml
"30 0 * * *"   # Econ calendar               06:00 IST
"5 12 * * 1-5"   # Sector indices EOD          17:35 IST
"30 12 * * 1-5"   # Earnings calendar           18:00 IST
"0 16 * * *"   # Yahoo 60-day sector refresh 21:30 IST (rolling window)
"10 16 * * *"   # Bond direction analytic     21:40 IST (after GSec index settles)
"*/5 3-10 * * 1-5"   # Most-active        every 5 min  (was 30)
"2-57/5 3-10 * * 1-5"   # Advance/decline    every 5 min  (was disabled)
"*/15 3-10 * * 1-5"   # Sector indices live every 15 min (NEW)
```

### `wealth-corp-intel` (6 crons)

```toml
"*/5 2-17 * * *"   # NSE announcements every 5 min  08:00-23:00 IST
"2-57/5 2-17 * * *"   # BSE announcements every 5 min  (offset 2 min)
"30 11 * * 1-5"   # Corp actions          17:00 IST
"30 12 * * 1-5"   # Insider trades        18:00 IST  (NSE PIT + BSE Reg 7)
"5 13 * * 1-5"   # Promoter pledge       18:35 IST  (NSE pledgedata + BSE Reg 31, daily)
"0 13 * * 6"   # Shareholding pattern  Sat 18:30 IST
```

### `wealth-event-scraper` (4 crons)

```toml
"30 0 * * *"   # 06:00 IST  daily      board meetings (NSE)
"0 1 * * *"   # 06:30 IST  daily      results calendar (derived)
"0,30 3-10 * * 1-5"   # every 30 min,  09:00-15:30 IST  (India 10Y/5Y/1Y + US 10Y)
"15,45 3-10 * * 1-5"   # every 30 min,  09:15-15:45 IST  (synthetic via IRP)
```

### `wealth-flow-engine` (10 crons)

```toml
"0 6 * * 1-5"   # 11:30 IST
"0 8 * * 1-5"   # 13:30 IST
"0 9 * * 1-5"   # 14:30 IST
"0 12 * * 1-5"   # 17:30 IST  NSE bulk + block deals
"15 12 * * 1-5"   # 17:45 IST  BSE bulk + block deals
"30 12 * * 1-5"   # 18:00 IST  F&O ban list final
"0 13 * * 1-5"   # 18:30 IST  FII/DII cash
"30 13 * * 1-5"   # 19:00 IST  FII derivative
"31 13 * * 1-5"   # 19:01 IST  MWPL (was colliding with fii_deriv)
"0 14 * * 1-5"   # 19:30 IST  F&O participant OI
```

### `wealth-fundamentals` (1 cron)

```toml
"0 1 * * 6"   # 06:30 IST
```

### `wealth-intraday-bars` (3 crons)

```toml
"30 0 * * 1"   # Daily intraday-bar fetch for top 50 intraday-suitable stocks.
"30 10 * * 1-5"   # Weekly enrich: Saturday 07:00 IST = Sat 01:30 UTC, refresh intraday_suitability with
"30 1 * * 6"   # 07:00 IST
```

### `wealth-macro-global` (5 crons)

```toml
"*/5 * * * 1-5"   # Rates: DXY, US10Y, US2Y, USDINR, VIX
"1-56/5 * * * 1-5"   # Equity futures: S&P/Nasdaq/Dow (offset 1 min, was disabled)
"2-57/5 * * * 1-5"   # Commodities: Brent/WTI/Gold/Silver/Copper (offset 2 min, was disabled)
"*/10 0-9 * * 1-5"   # Asian indices Nikkei/HSI/KOSPI
"30 2 * * *"   # FRED 08:00 IST
```

### `wealth-macro-in` (7 crons)

```toml
"0 3 * * *"   # RBI 08:30 IST
"30 4 * * *"   # POSOCO 10:00 IST
"30 8 * * *"   # IMD 14:00 IST
"30 12 * * 1-5"   # Bond yields 18:00 IST
"0 13 1 * *"   # GST monthly
"0 13 3 * *"   # PMI monthly
"0 13 12 * *"   # MoSPI monthly
```

### `wealth-news` (6 crons)

```toml
"*/5 * * * *"   # RSS aggregator    every 5 min  (7 RSS feeds)
"2-57/5 * * * *"   # GDELT             every 5 min offset 2 (was disabled)
"*/10 * * * *"   # Reddit            every 10 min
"4-54/10 * * * *"   # Nitter Twitter    every 10 min offset 4 (was disabled)
"*/10 3-10 * * 1-5"   # StockTwits        every 10 min market hours
"15 * * * *"   # LLM news tagger   hourly at :15 (Haiku, cost-capped)
```

### `wealth-options` (5 crons)

```toml
"*/1 3-10 * * 1-5"   # Nifty option chain    every 1 min
"*/2 3-10 * * 1-5"   # BankNifty             every 2 min
"*/3 3-10 * * 1-5"   # India VIX             every 3 min (was disabled by cron-key bug)
"*/5 3-10 * * 1-5"   # FinNifty              every 5 min
"*/10 3-10 * * 1-5"   # Stock options rotation every 10 min
```

### `wealth-orchestrator` (15 crons)

```toml
"*/2 * * * *"   # 1. Backfill drain    every 2 min
"*/15 * * * *"   # 2. Watchdog          every 15 min
"30 2 * * 1-5"   # 3. Pre-market brief  08:00 IST M-F
"0 3 * * 1-5"   # 4. Daily briefing    08:30 IST M-F
"*/5 3-10 * * 1-5"   # 5. Cascade alerts    every 5 min market (offset 0)
"*/2 3-10 * * 1-5"   # 6. Stop-loss watcher every 2 min market
"3-58/5 3-10 * * 1-5"   # 6a. Paper-trade auto-close every 5 min market (offset 3) — closes on stop/target
"1-56/5 3-10 * * 1-5"   # 6b. Kite reconcile   every 5 min market (offset 1) — holdings, funds, orders, trades
"15 3 * * 1-5"   # 6c. Sync instruments 08:45 IST — Kite NSE instruments CSV → kite_instruments
"30 3 * * 1-5"   # 6d. Sync NFO instr.  09:00 IST — Kite NFO CSV (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY only) → kite_instruments
"55 0 * * 1-5"   # 7. Kite reminder PRE  05:55 IST
"0 1 * * 1-5"   # 7b Kite reminder POST 06:30 IST
"30 10 * * 1-5"   # 8. EOD portfolio     16:00 IST M-F
"30 20 * * 6"   # 9. DB vacuum         Sat 02:00 IST
"30 12 * * 7"   # 10. Weekly digest    Sun 18:00 IST
```

### `wealth-price-core` (10 crons)

```toml
"5 12 * * 1-5"   # NSE indices             17:35 IST
"30 12 * * 1-5"   # NSE EOD bhavcopy        18:00 IST
"45 12 * * 1-5"   # BSE EOD bhavcopy        18:15 IST
"0 14 * * 1-5"   # NSE delivery%           19:30 IST
"30 10 * * 1-5"   # 52w extremes            16:00 IST
"31 10 * * 1-5"   # Circuit hits            16:01 IST (was colliding with 52w)
"0-8 3 * * 1-5"   # Pre-open every minute   09:00-09:08 IST
"*/1 3-10 * * 1-5"   # Intraday quotes         every 1 min, 09:15-15:30 IST
"7-52/15 3-10 * * 1-5"   # Yahoo backup          every 15 min during market (offset)
"*/5 1-18 * * *"   # GIFT Nifty              every 5 min, 06:30-23:55 IST
```

### `wealth-signal-engine` (6 crons)

```toml
"30 13 * * 1-5"   # Pre-market 08:30 IST → UTC 03:00 — cascade refresh on overnight data
"0 3 * * 1-5"   # Market hours 09:30-15:30 IST → UTC 04:00-09:00 hourly — live composite recompute
"0 4-9 * * 1-5"   # Market hours every 30 min — cascade re-scan
"*/30 4-9 * * 1-5"   # 18:05 IST → UTC 12:35 — REPEAT_BLOCK_BUYER detector after bulk/block refresh
"35 12 * * 1-5"   # Sunday 08:30 IST → UTC 03:00 Sun — weekly sector classification refresh
"0 3 * * 7"   # 08:30 IST
```

### `wealth-trader` (4 crons)

```toml
"* 4 * * 1-5"   # ACTIVE TRADING — every 3 min UTC 05:00-09:59 = IST 10:30-15:29
"*/3 5-9 * * 1-5"   # PRE-MARKET WARM-UP — UTC 03 = IST 08:30-09:29 (just before market opens)
"*/15 3 * * 1-5"   # POST-MARKET TRANSITION — UTC 10 = IST 15:30-16:00 (final hard exit + cleanup)
"*/5 10 * * 1-5"
```

### `wealth-verdict` (8 crons)

```toml
"0 2 * * 1-5"   # ─── MORNING ────────────────────────────────────────────────────────────
"0 3 * * 1-5"   # ─── ALWAYS-ON ──────────────────────────────────────────────────────────
"*/5 * * * *"   # ─── MARKET HOURS ───────────────────────────────────────────────────────
"0,15,30,45 4-9 * * 1-5"   # ─── POST-MARKET ────────────────────────────────────────────────────────
"30 10 * * 1-5"   # Phase D.3 — Daily intraday-suitability refresh. 16:30 IST = 11:00 UTC.
"0 11 * * 1-5"   # Phase D.4 — EOD Learning Audit (auto-fires daily, persists to eod_learning_audits).
"0 13 * * 1-5"   # ─── WEEKLY ─────────────────────────────────────────────────────────────
"30 3 * * 1"   # 09:00 IST
```

<!-- /AUTO:cron-list-by-worker -->

---

## Hand-curated commentary (manual, untouched by sync)

### wealth-verdict (decisions / 8 crons)

```toml
"0 2 * * 1-5"               # 07:30 IST  Pre-market enrichment (Opus)
"0 3 * * 1-5"               # 08:30 IST  Main verdict (Opus)
"*/5 * * * *"               # always-on  Alert triager (Haiku)
"0,15,30,45 4-9 * * 1-5"    # 09:15-15:30 / 15min  Verdict invalidator
"30 10 * * 1-5"             # 16:00 IST  Paper-trade autopsy (Sonnet)
"0 11 * * 1-5"              # 16:30 IST  Suitability refresh (engine)
"0 13 * * 1-5"              # 18:30 IST  EOD Learning Audit (Sonnet) ⭐
"30 3 * * 1"                # Mon 09:00  Weekly review (Sonnet)
```

## wealth-trader (execution / 4 crons)

```toml
"*/15 3 * * 1-5"           # 08:30→09:15 IST / 15min  Pre-market range capture
"* 4 * * 1-5"              # 09:30→10:30 IST / 1min   Breakout entry window ★
"*/3 5-9 * * 1-5"          # 10:30→15:30 IST / 3min   Active monitor
"*/5 10 * * 1-5"           # 16:00→17:00 IST / 5min   Post-market settle
```

## wealth-price-core (LTP refresh / 1 cron)

```toml
"* 4-9 * * 1-5"            # 09:30→15:30 IST / 1min   Live LTP for active universe
```

## wealth-intraday-bars (5-min OHLC / 2 crons)

```toml
"*/5 4-9 * * 1-5"          # 09:30→15:30 / 5min       Capture 5-min bars
"30 11 * * 1-5"            # 17:00 IST                EOD enrich + weekly suitability
```

## wealth-kite-bhavcopy (EOD daily bars / 1 cron)

```toml
"30 10 * * 1-5"            # 16:00 IST                Pull EOD bhavcopy from NSE
```

## wealth-news (RSS / 1 cron)

```toml
"*/15 * * * *"             # always-on / 15min        Fetch + dedup + Haiku extract
```

## wealth-options (OI snapshots / 1 cron)

```toml
"*/30 4-9 * * 1-5"         # 09:30→15:30 / 30min      Nifty + BankNifty option chain
```

## wealth-fii-dii (overnight flows / 1 cron)

```toml
"0 12 * * 1-5"             # 17:30 IST                FII/DII cash + futures
```

## wealth-indices (sector + benchmark / 1 cron)

```toml
"*/5 4-9 * * 1-5"          # 09:30→15:30 / 5min       Nifty 50, sector indices
```

## wealth-cross-asset (overnight cues / 1 cron)

```toml
"0 1 * * 1-5"              # 06:30 IST                GIFT Nifty, Dow futures, USD/INR, Crude
"*/30 4-9 * * 1-5"         # market-hours / 30min     Refresh during day
```

## wealth-orchestrator (catch-all / 1 cron — UNDER REVIEW)

```toml
"*/2 4-9 * * 1-5"          # 09:30→15:30 / 2min       Stop-loss watcher
```
⚠️ **Possible overlap with wealth-trader's 1min/3min cycles.** Audit pending: orchestrator's stop-loss check may double-fire vs trader's price_monitor. If overlapping, retire orchestrator.

## wealth-earnings-calendar (1 cron)

```toml
"0 1 * * *"                # 06:30 IST daily          Refresh earnings dates next 30d
```

---

## Total: ~25 crons across 11 workers

(Earlier estimate of 80+ was misleading — that counted total fires/day. Distinct cron expressions ≈ 25.)

### CPU budget

Each Worker invocation budget:
- Free tier: 10ms CPU per request → tight for LLM calls but they're fetch-bound (not CPU)
- Paid tier: 50ms CPU per request → comfortable

LLM calls run as `fetch(api.anthropic.com)` and are subrequests. Limit: **1000 subrequests / invocation** (both free + paid).
- Suitability refresh chunks symbol scans into batches of 50 to stay under cap.
- Backfills (e.g., 30-day intraday bars) chunked across multiple cron fires.

---

## Where it surfaces in UI

- `/trading/ops/` — full cron list with last-fire timestamps and failed-fires last 24h
- `/trading/today/` Section 7 — System Health summary (`cron_fires_24h`, `failed_24h`, current state)

---

## Verifying a cron is alive

```bash
# Cloudflare CLI
wrangler tail wealth-verdict
# Or D1 query
SELECT cron_expr, last_fire_ts, status FROM cron_fires WHERE last_fire_ts > strftime('%s','now','-1 day') ORDER BY last_fire_ts DESC;
```

---

## Common cron pitfalls

| Issue | Lesson |
|---|---|
| `30 12 * * 0` rejected (Sunday) | CF cron parser dislikes day-0 in some scheduler. Switched to Mon |
| Overlap waste (5min ⊂ 1min ⊂ 3min during entry hour) | Removed redundant 5min catch-all |
| Cron didn't fire post-deploy | Wrangler.toml syntax error in triggers; check `wrangler deploy` output |
| Account_id missing → all crons silently skip | Always set `account_id = "3d506f78b08b3d95c667b82ef6ee7ab8"` |
