# 19 · MASTER UI/UX DESIGN — Wealth Engine Personal Trading Desk

> **Goal**: a single personalized surface that REPLACES every third-party tool the owner currently context-switches to (TradingView, Sensibull, StockEdge, Tijori, Screener.in, Trendlyne, MoneyControl, Investing.com, NSE app).
>
> **Constraint**: only surface what we have **already deployed**. No data sources we don't ingest. No tools we don't have priors for.
>
> **Status**: DESIGN SPEC ONLY. No code shipped from this doc — phased implementation per §8.
>
> **Read this BEFORE any UI work** going forward.

---

## 0. Why this is a single-surface problem, not a redesign

Owner is a **one-man army** running 2 restaurants while paper-trading toward the May 11 real-money launch. Every tab-switch to a third-party tool is:
1. **Cognitive cost** — context-shift between mental models
2. **Time cost** — average 8-12 sec per switch × 30+ switches/day = 4-6 min/day lost
3. **Trust cost** — each tool has its own data freshness, time zone, ranking logic that may disagree with our engine
4. **Sandbox blocker** — the iPhone Claude Code sandbox can't reach trade.hnhotels.in or external sites simultaneously

The fix isn't "build a TradingView clone." It's: **bake every signal he currently goes elsewhere for INTO our existing engine UI, ranked and filtered through our specific intelligence layer.**

The owner's exact words: *"I will not have to use another third party to view any stocks or anything related to stocks."*

---

## 1. The deep audit — every signal we have to surface

86 D1 tables, grouped by intelligence purpose. **The UI must surface EXACTLY this — no more, no less.**

### Layer 1 — Pick selection intelligence

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `intraday_suitability` | 73-stock pool · `intraday_score`, `owner_score`, `loss_resistance_score`, `hit_2pct_rate`, `hit_3pct_rate`, `avg_open_to_high_pct`, `avg_up_last_week_pct`, `green_close_rate`, `hit_neg_2pct_rate` | 16:30 IST daily + 06:00 IST daily_enrich | Pool ranking screen (replaces StockEdge scans) |
| `daily_verdicts` | Opus morning compose (08:30 IST) + invalidator fires + EOD audits | Real-time as Opus fires | Today's verdict view (replaces own analysis time) |
| `pick_overrides` | When owner overrode Opus picks + reason | On override | Override tracking + post-mortem |
| `signal_scores` | Broader 4,167-stock universe with `composite_score` | Hourly market + 19:00 IST nightly | Optional swing/positional screen |
| `cascade_triggers_active` | Detected cascade patterns (REPEAT_BLOCK_BUYER, etc.) | Cascade detection cron | Cascade alert badges on stock cards |
| `bayesian_priors` + `bayesian_observations` | Per-pattern posterior probabilities | Updated on each trade outcome | Trust-meter on system signals |

### Layer 2 — Real-time price + market state

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `intraday_ticks` | 1-min Kite quotes for active 73 pool | Every 1 min during 09:15-15:30 IST (post TZ-2 fix) | Live LTP everywhere |
| `intraday_bars` | 5-min OHLC for active 73 pool | Every 5 min during market | Stock chart (replaces TradingView) |
| `equity_eod` | Daily EOD bhavcopy (NSE + BSE) | 18:00 / 18:15 IST | 30-day sparklines + back-history |
| `indices_eod` | NIFTY 50, BANK NIFTY, INDIA VIX, sector indices EOD | 17:35 IST | Index strip top spine |
| `sector_indices` | Live sector index ticks every 15 min | `*/15 3-10 * * 1-5` | Sector RS heatmap (replaces sector view) |
| `breadth_data` | A/D ratio, new highs, new lows | Every 5 min market | Breadth gauge in spine |
| `india_vix_ticks` | India VIX ticks | `*/3 3-10` market hours | VIX badge (volatility regime) |
| `crossasset_ticks` | DXY, BRENT, USDINR, GOLD, US10Y, VIX_US | Every 5 min always-on | Cross-asset strip (replaces Investing.com) |
| `gift_nifty_ticks` | GIFT Nifty 21h overnight | Every 5 min `*/5 1-18` | Pre-market gap signal |
| `option_chain_snapshot` | Nifty/BankNifty/FinNifty option chain + IV + Greeks | 1 min Nifty, 2 min BankNifty | Options panel (replaces Sensibull, partial) |
| `weekly_extremes` | 52w high/low + circuit hits | 16:00 / 16:01 IST | 52w-band bar on stock card |
| `circuit_hits` | Upper/lower circuit fires | 16:01 IST | Circuit-hit badge |
| `most_active` | Volume leaders | Every 5 min market | Volume leader strip |

### Layer 3 — Trade execution + position state

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `paper_trades` | Every paper trade row (entry/stop/target/exit/pnl) + `target_locked` (F-EXIT-1) + `opus_extension_until` (F-L4-LOCK) | Real-time | Position card (replaces broker app) |
| `trader_decisions` | Every cron-level decision Opus/Sonnet/deterministic made | Real-time | Reasoning timeline (NEW — no third-party equivalent) |
| `paper_trade_autopsies` | Sonnet 16:00 IST per-position post-mortem | 16:00 IST daily | Per-trade debrief |
| `eod_learning_audits` | RIGHT/MISSED/LEARNED/LUCK attribution + Sonnet narrative | 18:30 IST daily | Daily learning view |
| `opening_ranges` | First-15min OHLC per pick (used for breakout entry) | 09:30 IST | Entry-trigger overlay on chart |
| `kite_holdings_live`, `kite_funds_live`, `kite_orders_log`, `kite_trades` | Live broker state (post-real-money) | Every 5 min market | Real-money state when live |
| `kite_endpoint_health`, `kite_token_reminders` | Kite OAuth + endpoint health | Multiple crons | Token health badge |
| `position_watchlist` | Long-form swing positions | Manual + engine | Swing layer (separate from intraday) |

### Layer 4 — Fundamental + corporate context

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `corp_announcements` | NSE + BSE filings (paid-tier 5-min poll) | `*/5 2-17 * * *` | Announcements ticker per stock (replaces NSE app) |
| `corp_actions` | Splits, bonuses, dividends | 17:00 IST | Action calendar overlay |
| `insider_trades` | NSE PIT + BSE Reg 7 | 18:00 IST | Insider activity badge |
| `promoter_pledge` | Daily pledge data | 18:35 IST | Pledge % indicator |
| `shareholding_pattern` | Quarterly Sat 18:30 IST | Weekly | Shareholder concentration card (Tijori-like) |
| `bulk_block_deals` | NSE/BSE bulk + block deals | 17:30 / 17:45 IST | Block-deal feed per stock |
| `fii_dii_daily`, `fii_deriv_daily`, `fno_ban_list`, `fno_participant_oi`, `mwpl_utilization` | FII/DII flow | 18:30-19:30 IST | Flow dashboard |
| `fundamentals_snapshot` | Fundamentals (limited depth) | Weekly Sat | Fundamentals card (Screener-like, partial) |
| `concall_analysis` | Quarterly concall analysis | Manual | Concall sentiment (Tijori-like, partial) |
| `board_meetings`, `results_calendar` | Upcoming events | Daily 06:00 / 06:30 IST | Event calendar |
| `bond_yields` | India 10Y/5Y/1Y + US 10Y | Every 30 min market | Yield curve mini-chart |
| `macro_calendar`, `macro_indicators` | RBI / FRED / IMD / POSOCO / GST / PMI / MoSPI | Multiple daily | Macro event ticker |
| `power_consumption` | POSOCO power data (industrial activity proxy) | 10:00 IST daily | Macro context |

### Layer 5 — News + sentiment

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `news_items` | RSS + GDELT + Reddit + Nitter aggregated | Every 5-10 min | News feed (replaces MoneyControl, partial) |
| `social_posts` | Twitter/X + Reddit social signals | Every 10 min | Social sentiment |
| `alert_classifications` | Haiku-tagged alert importance | Every 5 min | Alert importance badge |

### Layer 6 — System health + audit

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `audit_findings` | All system anomalies + readiness checks (pre_market_integrity, eod_readiness, timezone_correctness) | Real-time + scheduled | Health dashboard (replaces nothing — UNIQUE to us) |
| `cron_run_log` | Every cron fire + status | Real-time | Cron health view |
| `source_health` | Per-data-source health flag | Per cron | Source health pills |
| `system_alerts` | System-level alerts | Real-time | Alert inbox |
| `anthropic_usage`, `anthropic_cache` | Claude API spend + cache hit rate | Per-call | Cost dashboard |
| `kite_api_log`, `kite_endpoint_health` | Kite call history + health | Per-call | Kite health |
| `readiness_check` | Manual readiness flags | On-event | Readiness checklist |

### Layer 7 — Self-learning + personalization

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `owner_profile` | Owner profile JSON (versioned) | On manual update | Inline owner-context everywhere |
| `personalization_observations` | Per-decision observations of owner behavior | Real-time | Style trail |
| `weekly_reviews` | Sonnet weekly review (Mon 09:00 IST) | Weekly | Weekly digest |
| `weekly_performance` | Weekly aggregate metrics | Weekly Sun 18:00 IST | Weekly dashboard |

### Layer 8 — Backtesting (offline)

| Table | What it holds | Cron freshness | Surfaceable as |
|---|---|---|---|
| `backtest_runs`, `backtest_trades`, `backtest_equity_curve` | Backtest replay state | Manual | Backtest tab (defer to weekend deep-work) |

**This is the universe of data.** Every UI design decision must answer: *"which of these 86 tables does this view read from?"*

---

## 2. Owner mental model — the trading day, moment by moment

What he's THINKING during each phase, what he NEEDS, what to surface.

### 06:00–07:30 IST — Wake up, get to office
- **Thinking**: "Did anything break overnight? Are we ready for today?"
- **Needs**: Pre-market integrity check status. Overnight cross-asset moves (DXY, S&P futures, GIFT Nifty). Key news.
- **Surface**: `audit_findings WHERE category='pre_market_integrity' AND trade_date=today` + crossasset_ticks last 12h + breaking news_items.

### 07:30–09:00 IST — Pre-market window
- **Thinking**: "What does the data say to do today? Do I trust it?"
- **Needs**: Opus's morning verdict (composed 08:30 IST). Top-3 picks with rationale. Conviction level. Pre-market gap signal. Sector regime. VIX level. Owner-profile injection visible (so he sees his own preferences reflected).
- **Surface**: `daily_verdicts.morning` + per-pick `intraday_suitability` row + `crossasset_ticks` recent + `cascade_triggers_active`.

### 09:00–09:08 IST — NSE pre-open session
- **Thinking**: "What's the indicative open? Do today's picks gap up or down?"
- **Needs**: Pre-open data per pick (after TZ-1 fix flowing tomorrow). Order book imbalance. Indicative open vs yesterday close.
- **Surface**: `preopen_snapshot` per symbol.

### 09:08–09:15 IST — Final go/no-go
- **Thinking**: "Override the picks or trust the system?"
- **Needs**: One-screen GO/NO-GO. Conviction. Reasons to skip. Override path if needed.
- **Surface**: Verdict decision + override button (logs to `pick_overrides`).

### 09:15–09:30 IST — Market open + observation window
- **Thinking**: "Did the picks open as expected? Are they breaking out?"
- **Needs**: Live LTP + day open + first-15min range building. Breakout watch.
- **Surface**: 3 picks live with bar building + `opening_ranges` + sector context.

### 09:30–10:00 IST — Entry window
- **Thinking**: "Did entries fire? What price?"
- **Needs**: Real-time entry confirmation per pick. Trader_decisions for entry rationale.
- **Surface**: 3 position cards transitioning WATCHING → ENTERED. `trader_decisions` last 30 min.

### 10:00–14:30 IST — Mid-session monitoring
- **Thinking**: "Are positions running or stalling? Should I bail? Should I add?"
- **Needs**: Per-position trail status, target_locked state, profit-lock proximity, news alerts on held symbols, sector rotation, VIX shift. **Most important time block of the day.**
- **Surface**: Live Desk view with all 3 positions + Opus position_mgmt outputs every 30 min + Sonnet safety checks every 15 min between.

### 14:30–15:10 IST — Late-day window
- **Thinking**: "Do I let winners run or lock in profit?"
- **Needs**: WIDEN_TARGET vs FULL_EXIT decisions per position (when target_locked=1). +₹30K force-exit threshold proximity.
- **Surface**: Profit-lock countdown + Opus EXTEND_PROFIT/WIDEN_TARGET decisions + hard-exit countdown.

### 15:10 IST — Hard exit
- **Thinking**: "Am I flat? Did everything close cleanly?"
- **Needs**: Confirmation all 3 positions exited. Exit reason per position. Final P&L.
- **Surface**: 3 exit confirmations + day's running P&L.

### 15:10–16:00 IST — Post-market settlement
- **Thinking**: "What did I make? What did I miss?"
- **Needs**: Realized P&L. Hypothetical (if I had let it run, if I had skipped). Comparison to Opus picks if I overrode.
- **Surface**: EOD trade comparison (existing `/trading/compare/`) + per-trade autopsy.

### 16:00–18:30 IST — Learning window
- **Thinking**: "What did the system get right, miss, learn? Any audit issues?"
- **Needs**: EOD learning audit (Sonnet narrative). Audit findings opened today. Pieces still missing. Tomorrow readiness preview.
- **Surface**: EOD readiness summary + `eod_learning_audits` + `audit_findings` timeline.

### 18:30–22:00 IST — Pre-tomorrow prep
- **Thinking**: "Is tomorrow's intelligence layer ready? Any blockers?"
- **Needs**: Readiness 2-layer status. Open items. Anything I need to do manually.
- **Surface**: `/trading/readiness/` + tripwire status.

**Key insight**: 80% of his time-on-screen is during 09:15-15:30 IST (the Live Desk). 20% is bookend (pre-market + post-close). The **Live Desk view must be ruthlessly information-dense without being noisy.**

---

## 3. Inspiration extraction — what to borrow from each tool

**ONE pattern per tool**, mapped to OUR data. Not a clone, a translation.

| Tool | What it does well | Our pattern to borrow | Mapped to our data |
|---|---|---|---|
| **TradingView** | Chart-as-canvas — price + volume + indicators + drawing tools, all glanceable | Stacked-pane chart with overlay layers (price + volume + RSI/EMA computed on-the-fly from `intraday_bars`) | Single canvas per stock with overlays toggled via chips |
| **Sensibull** | Strategy payoff curves + IV surface visualized | Option chain table with IV column + delta/gamma column on F&O symbols | Read `option_chain_snapshot`; render as stacked tables for CE/PE around ATM |
| **StockEdge** | Clean scanner output (1 row = 1 stock) with per-row pills (delivery%, score, change%) | Pool ranking row component — symbol + 3-5 numeric pills + sparkline | Render `intraday_suitability` rows or `signal_scores` rows |
| **Tijori** | Segment-revenue donut + shareholder-concentration bar | Segment + concentration card (only when we have data, otherwise hide — don't fake) | `shareholding_pattern` for concentration; segment data: NOT INGESTED → show "n/a" gracefully |
| **Screener.in** | 10-year quarterly financials in a wide horizontal scroll | Horizontal scroll of `fundamentals_snapshot` + `equity_eod` 10y aggregates | Limited to what we have; flag depth gap |
| **Trendlyne** | DVM color score (green/amber/red triangle for Durability/Valuation/Momentum) | OUR OWN 3-pill version — Conviction (composite_conviction) / Owner_Score / Recent_Regime, color-coded | Native; DON'T fake broker targets |
| **MoneyControl** | News stream with ticker tape feel | News feed component with sentiment color stripe + symbol pills | `news_items` filtered by symbols_tagged + sentiment_score |
| **Investing.com** | Cross-asset dashboard at-a-glance | Top-strip with cross-asset chips (DXY, USDINR, BRENT, US10Y, GIFT, VIX_US) | `crossasset_ticks` + `gift_nifty_ticks` |
| **NSE app** | Push-style announcement feed | Announcements ticker on each stock card + global feed | `corp_announcements` filtered by symbol or live-feed mode |

**What we DON'T copy**:
- TradingView's drawing tools (overkill, observer mode doesn't draw)
- Sensibull's strategy builder (we don't trade options yet)
- Trendlyne's broker target prices (no source)
- MoneyControl's ad clutter (we have no ads)

---

## 4. Information architecture — 5 surfaces + 1 spine

```
┌──────────────────────────────────────────────────────────────────┐
│  THE SPINE  (always visible, top + bottom)                       │
└──────────────────────────────────────────────────────────────────┘
        ↓ tap any of 5 main views ↓
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 1. TODAY │ 2. DESK  │ 3. STOCK │ 4. INTEL │ 5. HEALTH│
│ Pre-mkt  │ Live mkt │ Per-stk  │ News +   │ Readiness│
│ verdict  │ desk     │ deep-dive│ macro    │ + audit  │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### Why 5 surfaces (not 8 like today, not 3)

Today the codebase has 8 trading surfaces (`/trading/`, `/today/`, `/execute/`, `/ops/`, `/compare/`, `/audit/`, `/roadmap/`, `/readiness/`). They overlap. Some are administrative. Owner gets lost.

5 surfaces map cleanly to the 5 mental modes during a trading day:
1. **TODAY** = "what's the plan?" (pre-market + verdict + override)
2. **DESK** = "what's happening NOW?" (live positions + actions)
3. **STOCK** = "what do I need to know about THIS company?" (deep dive triggered by clicking any symbol anywhere)
4. **INTEL** = "what's moving the broader market?" (news + macro + cross-asset)
5. **HEALTH** = "is the system itself OK?" (readiness + audit + cron + cost)

Old pages map cleanly:
- `/today/` + `/execute/` (intraday parts) → **TODAY**
- `/ops/` → **DESK** (transformed; ops becomes the live trading desk, not just a paper-trade list)
- `/compare/` → **TODAY** (post-close section) and **DESK** (live during trade)
- `/audit/` + `/readiness/` + `/roadmap/` → **HEALTH** (consolidated)
- `/execute/` (swing layer) → de-prioritized, hidden behind a toggle in TODAY (per the user's clarification — swing isn't the May 11 launch focus)

### Device matrix

```
                  iPhone           iPad           Mac
                  (mobile)         (tablet)       (laptop+)
┌──────────────┬─────────────┬──────────────┬─────────────────┐
│ THE SPINE    │ Sticky top  │ Top + side   │ Top + persistent│
│              │ + bottom    │ left rail    │ side rail       │
├──────────────┼─────────────┼──────────────┼─────────────────┤
│ Each main    │ Single col, │ 2-pane:      │ 3-pane:         │
│ view         │ tab nav     │ list + detail│ list+detail+ctx │
├──────────────┼─────────────┼──────────────┼─────────────────┤
│ Stock chart  │ 80% width   │ 70% width    │ 50% width +     │
│              │ swipe-able  │ + meta panel │ meta + news     │
├──────────────┼─────────────┼──────────────┼─────────────────┤
│ Position card│ Full bleed  │ 2-up         │ 3-up            │
└──────────────┴─────────────┴──────────────┴─────────────────┘
```

The owner uses **iPhone primarily** during the day (pocket → restaurant → glance). iPad in the evening. Laptop for deep-work sessions (you, the architect). The design must be **iPhone-glanceable first**.

### Navigation model

**Mobile (iPhone)**:
- Bottom-nav with 5 icons (always visible)
- Top spine collapses to single line on scroll
- Each view is single-column scroll-down
- Tap any symbol anywhere → modal sheet with STOCK view

**Tablet (iPad)**:
- Sticky left rail with 5 icons + labels
- Top spine always visible
- Each view is 2-pane (list + detail)
- Tap any symbol → opens in right pane

**Desktop (Mac)**:
- Persistent left rail + persistent right context panel
- Top spine + bottom phase indicator
- 3-pane layouts where applicable
- Keyboard shortcuts (1-5 for views, ESC to close stock modal)

---

## 5. The Spine — always-visible context

Render this on every view. It tells the owner WHERE he is in the trading day at a glance.

### 5.1 Top strip (always visible)

```
Mobile:
┌────────────────────────────────────────────────────────────────┐
│ NIFTY 25,420 +0.4%   BNF 53,810 -0.2%   VIX 13.8   USDINR 83.4 │
│ ───────────────────────────────────────────────────────────────│
│ 💰 ₹3,00,000 / ₹10,00,000 (30%)    📊 P&L +₹1,258    🎯 3 pos │
└────────────────────────────────────────────────────────────────┘

Tablet/Desktop adds chips on right:
... │ DXY 102.3 ↓0.1% │ BRENT 84.2 ↑0.3% │ GIFT +18 │ US10Y 4.2 │
```

**Pull pattern**: single API call `GET /api/trading?action=top_strip` (additive read-only — the same endpoint the previous chat tried to add and revert; we'll re-add it under the additive-allowed pattern). Reads `indices_eod`, `crossasset_ticks`, `engine_config`, `paper_trades` (today's open count + pnl).

### 5.2 Bottom phase indicator (always visible)

```
Mobile:
┌────────────────────────────────────────────────────────────────┐
│ 🟢 LIVE │ Hard exit in 4h 23m │ Profit lock at +₹28,742       │
│ 📍 Tomorrow real-money: 4 days │ Readiness 7G/7Y/3R 🔴 NO-GO   │
└────────────────────────────────────────────────────────────────┘
```

States the bar can show:
- 🟡 **PRE-MARKET** (06:00-09:14 IST): "Pre-market. Verdict at 08:30 IST. T-XX min."
- 🔵 **PRE-OPEN** (09:00-09:14 IST): "NSE pre-open session live. T-XX min to open."
- 🟢 **LIVE** (09:15-15:30 IST): "Live. Hard exit T-XX. Profit lock at +₹XX"
- 🟣 **CLOSE** (15:30-16:00 IST): "Closed. Settling..."
- 🟤 **POST-CLOSE** (16:00-23:00 IST): "Closed. EOD audit at 16:35."
- ⚫ **OFF-HOURS** (23:00-06:00 IST or weekend): "Market closed. Tomorrow opens at 09:15 IST."

The "real-money: X days" countdown is replaced by current-streak metric after May 11.

---

## 6. The 5 views — wireframes

### 6.1 TODAY (pre-market, replaces /today/ + /execute/-intraday)

**Purpose**: one screen to know what's planned, what's the conviction, and whether to override.

```
┌─ TODAY ─────────────────────────────────────────────────────── 06:53 IST ─┐
│                                                                            │
│  [SPINE]                                                                   │
│                                                                            │
│  🟡 Verdict at 08:30 IST  (pre-market enrichment 07:30 IST already ran ✓) │
│                                                                            │
│  ┌─ TONIGHT'S PRE-CHECK ────────────────────────────────────────────────┐ │
│  │ Pre-market integrity check fires at 08:25 IST. No blockers expected. │ │
│  │ • avg_up_last_week_pct populated: 49/73 (target ≥80%)        🟡    │ │
│  │ • intraday_bars yesterday coverage: 49/73 (F-COVER-1 RED)    🔴    │ │
│  │ • Kite token: fresh (issued 2h ago)                          🟢    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ 90D POOL TOP-10 BY OWNER_SCORE ─────────────────────── tap to expand ┐│
│  │ ┌────────────────────────────────────────────────────────────────────┐│ │
│  │ │ TDPOWERSYS  o_score 52.1  intraday 49.9  aw_lw 0.0    [chart] [⏰] ││ │
│  │ │ KRN         o_score 49.9  intraday 51.3  aw_lw n/a    [chart] [⏰] ││ │
│  │ │ AEROFLEX    o_score 49.7  intraday 48.2  aw_lw 4.86%  [chart] [⏰] ││ │
│  │ │ MTARTECH    o_score 48.7  intraday 49.2  aw_lw 6.40%  [chart] [⏰] ││ │
│  │ │ ...                                                                 ││ │
│  │ └────────────────────────────────────────────────────────────────────┘│ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ LIVE PRE-MARKET FEED ──────────────────────────────────────────────┐ │
│  │ 06:53 │ GIFT NIFTY +18 (+0.07%)                                      │ │
│  │ 06:30 │ USDINR 83.42 (-0.05%)                                        │ │
│  │ 03:15 │ S&P futures +0.3%, Nasdaq fut +0.4%                          │ │
│  │ 22:30 │ ⚡ HFCL — board meeting 11 May result announcement           │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ AT 08:30 IST THIS BLOCK FILLS WITH ────────────────────────────────┐ │
│  │ [                  Opus morning verdict appears here                  ]│ │
│  │ [   Pick 1, 2, 3 with rationale + conviction + plain-English why     ]│ │
│  │ [   GO / SIT_OUT / OBSERVE button + OVERRIDE option                  ]│ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  [Swing-layer toggle]  ⊳  show /execute/ composite-score candidates       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

After 08:30 IST the page transforms — the "tonight's pre-check" pane and "90D pool" pane minimize, the verdict pane expands to fill.

### 6.2 DESK (live market, replaces /ops/)

**Purpose**: the **single most important view** — used 09:15-15:30 IST every trading day. This is where 80% of screen time happens.

```
┌─ DESK ──────────────────────────────────────────────────────── 11:42 IST ─┐
│                                                                            │
│  [SPINE]                                                                   │
│                                                                            │
│  ┌─ POSITION 1 (active) ───────────────────────────────────────────────┐  │
│  │ HFCL  ₹136.45 ↑ +2.3% │ 1,250 sh │ entry 133.40 │ qty cost ₹1,67,500│  │
│  │ ────────────────────────────────────────────────────────────────────│  │
│  │ ┌────────────── 5-min chart (last 2h) ──────────────┐ trail status: │  │
│  │ │     📈 sparkline + entry line + target + stop     │ • +1.5% armed │  │
│  │ │                                              ⊕   │ • 0.8% trail  │  │
│  │ │              ─ ─ target ₹137.13 ─ ─               │ • peak 137.31 │  │
│  │ │       ─────entry──────────────────────            │ • giveback 9% │  │
│  │ │                                                   │ trajectory:   │  │
│  │ │    ─ ─ stop ₹131.83 ─ ─                          │ LINEAR_UP    │  │
│  │ └───────────────────────────────────────────────────┘               │  │
│  │ pnl now +₹3,816  ·  pnl at peak +₹4,889  ·  realized stop +₹3,063  │  │
│  │ ────────────────────────────────────────────────────────────────────│  │
│  │ 🤖 Opus 11:00: HOLD (sector ELECTRICAL +0.8% confirming, vol rising)│  │
│  │ 🤖 Sonnet 11:15: green (no adverse signal in last 30 min)           │  │
│  │ 🎯 Target locked? NO  ·  Will lock at ₹137.13 (T+0.7%)              │  │
│  │ 📰 News last 60min: none                                             │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ POSITION 2 (active, target_locked) ────────────────────────────────┐  │
│  │ AEROFLEX  ₹339.20 ↑ +5.7% │ 880 sh │ entry 320.85 │ TARGET LOCKED ✅│  │
│  │ ────────────────────────────────────────────────────────────────────│  │
│  │ [chart with target line locked + trail above]                        │  │
│  │ pnl now +₹16,148  ·  guaranteed minimum ₹14,830                      │  │
│  │ trail at 1.0% below peak → exit at ₹335.83 if reverses               │  │
│  │ 🤖 Opus 11:30: WIDEN_TARGET to ₹345 (LINEAR_UP, sector RS 0.85,     │  │
│  │    breaking 5d high, vol_sustaining 78%, ist_phase=mid_session ✓)    │  │
│  │ → New target ₹345 set 12 min ago. Trail 1.0% below peak.            │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ POSITION 3 (exited) ───────────────────────────────────────────────┐  │
│  │ TDPOWERSYS  STOP_HIT @ ₹1,158.47 at 09:35 IST  ·  P&L -₹3,527       │  │
│  │ Why exit fired: stop traversed at intra-bar low ₹1,157 in first 5min │  │
│  │ Day-high so far ₹1,194.10 (printed 09:15 — uncatchable from 09:30)  │  │
│  │ ⚠ Sonnet autopsy at 16:00 will analyze this                          │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ MARKET CONTEXT (refreshed every 5 min) ────────────────────────────┐  │
│  │ Regime: RANGING  ·  VIX 13.8 (-0.3 from morning)                     │  │
│  │ Breadth: A 1,820 / D 1,402 (1.30x)  ·  new highs 87 / lows 12        │  │
│  │ Sectors: ELECTRICAL +0.8% · IT -0.3% · BANK -0.1%                   │  │
│  │ FII PCR: 0.92 (mildly bullish)                                       │  │
│  │ Cross-asset: USDINR 83.41 ↓0.05  DXY 102.2 ↓0.1                     │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ OPUS REASONING TIMELINE ──────────────────────────────── tap row ──┐  │
│  │ 11:30 │ AEROFLEX WIDEN_TARGET → ₹345 (5/6 gates passed)              │  │
│  │ 11:00 │ HFCL HOLD (sector confirming)                                │  │
│  │ 11:00 │ AEROFLEX HOLD (linear up, vol sustaining)                    │  │
│  │ 10:30 │ Position_mgmt cron skipped — no open positions yet           │  │
│  │ 10:00 │ Market_open verdict: 1/3 entries fired                       │  │
│  │ 09:45 │ AEROFLEX entry @ ₹320.85 (breakout above first-15min H)      │  │
│  │ 09:30 │ TDPOWERSYS entry @ ₹1,172.30 (fallback, no breakout)         │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key UI principles in the Desk view**:
1. **Position card is the atomic unit** — everything about one position visible without scroll
2. **Reasoning is plain English** — never raw JSON, always Opus's narrative + the gate that fired
3. **Trajectory + trail status are co-located** — owner can see at a glance "is this trending or fading?"
4. **News and market context are separate but adjacent** — surface only what matters NOW
5. **Reasoning timeline is the audit trail** — every decision the system made today

### 6.3 STOCK (deep dive, replaces TradingView + Screener + Tijori + Trendlyne)

**Purpose**: triggered by tapping ANY symbol anywhere. This is the "I'm about to confirm — let me look one more time" view.

```
┌─ STOCK: HFCL ──────────────────────────── tap × to close, or ←/→ to switch─┐
│                                                                              │
│  HFCL  ₹136.45 ↑ +2.3% (today)  ·  ₹133.40 → 142.95 → 142.40 (today's path)│
│  ┌────── Live 1-min + 5-min toggleable chart, 2 panels ────────────────┐    │
│  │                                                                       │    │
│  │   📈 Price                                          (toggle: 1m / 5m) │    │
│  │   ─── EMA20 ─── EMA50 ─── VWAP                                       │    │
│  │   markers: entry ─⚪ peak ─🟢 stop ─🔴 target ─🎯                     │    │
│  │                                                                       │    │
│  │   ────────────────────────────────────────────────────────────────────│    │
│  │   📊 Volume bars                                                      │    │
│  │   pre-market 9:00 ░░  open 9:15 ████  09:30 ███  10:00 ▓▓▓...       │    │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ OUR ENGINE'S TAKE ──────────────────────────────────────────────────┐   │
│  │ Conviction (composite_conviction) ████████░░ 0.78  HIGH              │   │
│  │ • upside × downside_resistance × recent_regime = 0.85 × 0.92 × 0.99  │   │
│  │ owner_score 47.5  intraday_score 43.3  loss_resistance 53.7         │   │
│  │ Recent regime (7d): aw_lw 6.83% · h2_lw 80% · gc_lw 80% — HOT       │   │
│  │ 90d priors: hit_2pct 55.9% · hit_3pct 41.0% · aoh 3.11% · gc 64%   │   │
│  │ Loss resistance: hit_neg_2pct_rate 35.6% (top quartile defensive)   │   │
│  │ Cascade: ─ none active ─                                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ MARKET MICRO ──────────────────────────────────────────────────────┐   │
│  │ Sector: NETWORKING / TELECOM (+0.8% today, RS 0.78)                 │   │
│  │ Open  ₹128.90  ·  Day H  ₹142.95 (15:25)  ·  Day L  ₹128.00 (09:15) │   │
│  │ Close ₹142.40  ·  pct from open +10.86%                              │   │
│  │ 52W H ₹185.50 (3 mo ago)  ·  52W L ₹95.20 (8 mo ago)                │   │
│  │ Delivery % yesterday: 28.4%   ·   Avg 30d: 24.1%                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ FUNDAMENTAL CONTEXT (only what we have ingested) ─────────────────┐    │
│  │ Last results: Q4FY26 (announced 30 Apr) — Net +12% YoY              │    │
│  │ Concall sentiment: positive (analyzed via concall_analysis)          │    │
│  │ Promoter holding: 38.2% (Q4)  ·  pledge: 0% (clean)                 │    │
│  │ Insider trades last 30d: 1 buy (₹1.2cr by promoter)                 │    │
│  │ Bulk/block deals last 7d: none                                       │    │
│  │ Upcoming: board meeting May 11 — RESULTS ANNOUNCEMENT ⚠              │    │
│  │ ⚠ N/A: 10y financials, segment revenue, capacity data — NOT INGESTED│    │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ NEWS (last 4h) ────────────────────────────────────────────────────┐   │
│  │ 11:42 │ ⚪ none in last 60 min                                       │   │
│  │ 09:55 │ 🟢 +0.4 │ HFCL gets ₹120cr order from BSNL │ Reuters       │   │
│  │ 08:30 │ 🟢 +0.2 │ Telecom-equipment Mar export +18% │ MoneyControl  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ ANNOUNCEMENTS (corp_announcements last 30d) ──────────────────────┐    │
│  │ 30 Apr │ Audited results FY26 │ NSE                                 │    │
│  │ 12 Apr │ Board meeting intimation │ NSE                              │    │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─ OPTIONS (only if F&O symbol) ────────────────────────────────────┐     │
│  │ ATM ₹140 CE — premium ₹3.20 IV 28.4% delta 0.52                    │     │
│  │ ATM ₹140 PE — premium ₹2.80 IV 27.9% delta -0.48                   │     │
│  │ [link to deeper option chain panel]                                  │     │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key UI principles in Stock view**:
1. **Honest about gaps** — "n/a not ingested" beats fake data
2. **Our engine's take is FIRST** — composite_conviction, owner_score, recent_regime — that's what makes us NOT a TradingView clone
3. **Chart has only OUR overlays** — entry/peak/stop/target markers + EMAs/VWAP. No drawing tools.
4. **News is sentiment-color-coded** — at-a-glance positive/neutral/negative
5. **Modal sheet on mobile, side-panel on desktop** — non-blocking the main view

### 6.4 INTEL (news + macro + cross-asset, replaces MoneyControl + Investing.com + NSE app)

**Purpose**: scan the broader market for things moving outside our 73-stock pool that might still affect us.

```
┌─ INTEL ────────────────────────────────────────────────────── 11:42 IST ─┐
│                                                                            │
│  [SPINE]                                                                   │
│                                                                            │
│  ┌─ NOW (last 5 min) ──────────────────────────────────────────────────┐  │
│  │ Breaking — 🟢 +0.5 │ FII net buyers ₹1,820cr today (unusual size)   │  │
│  │ Breaking — 🔴 -0.3 │ Brent crude -1.2% on inventory build           │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ MARKET REGIME ──────────────────────────────────────────────────────┐ │
│  │ RANGING (since open)  ·  VIX 13.8 (low-vol regime)                  │ │
│  │ Breadth A/D 1.30x  ·  new highs 87 / lows 12                         │ │
│  │ ┌─ Sector heatmap (sector_indices live) ───────────────────────────┐│ │
│  │ │ ELECTRICAL +0.8%  PHARMA +0.6%  IT -0.3%  AUTO +0.2%             ││ │
│  │ │ BANK -0.1%  ENERGY +0.4%  METAL -0.2%  REALTY +1.1%              ││ │
│  │ └────────────────────────────────────────────────────────────────────┘│ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ CROSS-ASSET ────────────────────────────────────────────────────────┐ │
│  │  USDINR 83.41 ↓0.05  │  DXY 102.2 ↓0.1   │  US10Y 4.18% +0.02     │ │
│  │  BRENT 84.20 ↑0.3    │  GOLD 2,310 +0.2  │  GIFT NIFTY +18 (now)  │ │
│  │  VIX_US 14.2 (steady)                                                │ │
│  │  Asia: NIKKEI -0.1% · HSI +0.4% · KOSPI -0.2%                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ FII/DII FLOWS (yesterday's settlement) ─────────────────────────────┐ │
│  │ FII cash:    +₹1,820cr   │   DII cash:    -₹420cr                   │ │
│  │ FII deriv:   +₹2,140cr (unusually long)                               │ │
│  │ MWPL near-cap: 4 stocks (RPOWER 87%, SUZLON 91%...)                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ NEWS FEED (last 4h, all symbols) ──────────────────────────────────┐  │
│  │ ╔══════════════════════════════════════════════════════════════════╗│  │
│  │ ║ 11:38 │ 🟢 +0.4 │ HFCL gets ₹120cr BSNL order                ║│  │
│  │ ║          [HFCL] tap to filter feed by HFCL                       ║│  │
│  │ ╠══════════════════════════════════════════════════════════════════╣│  │
│  │ ║ 11:30 │ ⚪ +0.0 │ India PMI Apr at 58.8 vs 58.9 prior          ║│  │
│  │ ╠══════════════════════════════════════════════════════════════════╣│  │
│  │ ║ 11:25 │ 🔴 -0.3 │ Crude inventory build above expectations       ║│  │
│  │ ╠══════════════════════════════════════════════════════════════════╣│  │
│  │ ║ 11:20 │ 🟢 +0.6 │ PSU bank credit growth Apr +18% YoY           ║│  │
│  │ ╚══════════════════════════════════════════════════════════════════╝│  │
│  │  [filter: all │ owned positions │ pool symbols │ macro only]        │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ CASCADE TRIGGERS (active) ─────────────────────────────────────────┐  │
│  │ REPEAT_BLOCK_BUYER: SUZLON (3 days, expected window ends 14 May)    │  │
│  │ → Don't trade short on SUZLON till window closes                    │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.5 HEALTH (readiness + audit, consolidates /audit/ + /readiness/ + /roadmap/)

**Purpose**: the system itself — is it working, is it learning, is anything drifting?

```
┌─ HEALTH ───────────────────────────────────────────────────── 11:42 IST ─┐
│                                                                            │
│  [SPINE]                                                                   │
│                                                                            │
│  ┌─ REAL-MONEY READINESS (Mon May 11 target) ──────────────────────────┐  │
│  │ T-4 days  ·  Combined: 7G / 7Y / 3R   →   🔴 NO-GO at this hour     │  │
│  │ ┌─ Layer 1 (Intelligence) ─ 2G/2Y/2R ─┬─ Layer 2 (Execution) 5G/5Y/1R ┐│  │
│  │ │ ✅ Pick selection (HFCL+AEROFLEX  )  │ ✅ Per-position target lock     ││  │
│  │ │ 🟡 Recent_regime data 49/73          │ 🟡 Cron firing health           ││  │
│  │ │ 🔴 Time-to-high not modeled          │ 🔴 Stop wick filter (F-EXIT-2) ││  │
│  │ │ 🔴 24/73 stocks no bars               │ 🟡 Worker version drift         ││  │
│  │ └──────────────────────────────────────┴──────────────────────────────────┘│  │
│  │ [Read full audit doc: 17-REAL-MONEY-READINESS-AUDIT.md →]            │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ TRIPWIRE (protected-surface drift) ────────────────────────────────┐  │
│  │ ✅ CLEAN — no drift since baseline tripwire-baseline-2026-05-06-eod │  │
│  │ Last verified: 11:35 IST (auto-runs hourly during market)            │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ TODAY'S AUDIT FINDINGS (live) ─────────────────────────────────────┐  │
│  │ 🟢 INFO    │ pre_market_integrity Layer 2 → all gates pass (08:25)  │  │
│  │ 🟡 WARN    │ pre_market_integrity Layer 1 → bars coverage 67%       │  │
│  │ 🟢 RESOLVED│ F-DATA-1 silent NULL (shipped tonight)                  │  │
│  │ 🟢 RESOLVED│ F-EXIT-1 target_locked (shipped tonight)                │  │
│  │ 🟢 INFO    │ TZ-1 pre-open cron timezone fix (shipped)               │  │
│  │ 🟢 INFO    │ TZ-2 intraday quotes cron timezone fix (shipped)        │  │
│  │ ─── (auto-resolved) ───                                                │  │
│  │ 🟢 RESOLVED│ Phantom P&L cleanup (resolved by F3 fix)                │  │
│  │ [filter: today / week / unresolved-critical]                          │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ CRON HEALTH (last 24h) ────────────────────────────────────────────┐  │
│  │ ✅ verdict_compose          fired 08:30 IST (29s)                    │  │
│  │ ✅ pre_market_integrity     fired 08:25 IST (1.2s)                   │  │
│  │ ✅ intraday_quotes          fired every 1 min (376/376 expected)     │  │
│  │ ✅ position_mgmt            fired 4×30min (last at 11:30, Opus)      │  │
│  │ 🟡 compute_intraday_hourly  fired 5/6 (one stuck "running" 14:31 yesterday) │  │
│  │ ✅ paper_tick               fired every 5 min                         │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ COST DASHBOARD (last 24h) ─────────────────────────────────────────┐  │
│  │ Opus  4.5  │ 8 calls   │ ₹38.40                                      │  │
│  │ Sonnet 4.5 │ 14 calls  │ ₹14.20                                      │  │
│  │ Haiku 4.5  │ 288 calls │ ₹6.05                                       │  │
│  │ Kite REST  │ 4,210 reqs │ within free tier                            │  │
│  │ ────────────────────────────────────────────────────────────────────│  │
│  │ Total LLM today: ₹58.65                                              │  │
│  │ Cumulative since session start: ₹487.32                              │  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ DEPLOY LOG (last 7d) ──────────────────────────────────────────────┐  │
│  │ today 23:00 │ tripwire-baseline-2026-05-06-eod tagged                │  │
│  │ today 22:50 │ wealth-trader e21c84b0 (F-EXIT-1 target_locked)        │  │
│  │ today 22:30 │ wealth-intraday-bars 827aa24b (F-DATA-1 daily_enrich)  │  │
│  │ today 16:00 │ wealth-orchestrator (P5 phantom cleanup)               │  │
│  │ today 16:30 │ wealth-verdict (P2/P3/P4 conviction + owner_score + F-PERS)│  │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Component library — reusable UI primitives

To keep things consistent across the 5 views, these are the atomic components.

### 7.1 Conviction meter
```
Conviction (composite_conviction) ████████░░ 0.78  HIGH
• upside × downside_resistance × recent_regime = 0.85 × 0.92 × 0.99
```
3-segment bar visualizing each factor + label HIGH/MED/LOW. Used on every stock surface.

### 7.2 Position card
The atomic unit of the Desk view. Self-contained: symbol header, chart, trail status, P&L, reasoning, news, target-lock state.

### 7.3 Reasoning bubble
Surfaces every Opus/Sonnet decision with the gate that fired. Format: "[time] [model] [decision] ([reason snippet, 80 char])".

### 7.4 News pill
`[time] [sentiment_color +/-/0] [score] [headline] [symbol_chips]`. Click → expands to source + full text.

### 7.5 Phase indicator
Color-coded phase chip (PRE-MARKET / PRE-OPEN / LIVE / CLOSE / POST-CLOSE / OFF-HOURS) with countdown to next phase change.

### 7.6 Score pill
For each composite metric (intraday_score, owner_score, etc.), a colored pill: green (top quartile), yellow (median), red (bottom quartile). Text shows raw value.

### 7.7 Sector RS chip
Sector name + change_pct + RS rank chip. Color = direction. Tap → opens INTEL filtered to that sector.

### 7.8 Audit pill
Severity-coded pill: 🔴 critical / 🟡 warning / 🟢 info / ✅ resolved. With short title. Tap → expands to full evidence + proposed fix.

### 7.9 Trail visualization
Mini gauge showing trail position relative to peak + entry: `entry [══════] peak | current ↓ trail`. Visual cue to whether trail is armed and how close to firing.

### 7.10 Cost ribbon
Single horizontal bar: Opus / Sonnet / Haiku / Kite as stacked segments, colored by intensity. Text on tap.

---

## 8. Personalization layer — owner_profile shaping every view

The `owner_profile` table holds the owner's preferences (versioned). Every view reads it and adapts. This is what makes the UI **personal** rather than generic.

| Owner attribute | UI effect |
|---|---|
| `risk_aversion = high` (paper-trading first 7d real-money) | Profit-lock threshold prominently colored green; widen-target gates show all 6 in detail (more conservative bias) |
| `decision_principle = "minimize loss, maximize on probability"` | Default highlight is downside_resistance score, not upside |
| `communication_style = terse + intent-driven` | Reasoning bubbles show 1-line; tap to expand. No full paragraphs by default. |
| `understanding_gaps = code internals, cron schedules, statistical_significance` | Tooltips on every stat ("hit_2pct_rate 55.9% — historically 56% of days, this stock moves >+2% from open"). No raw column names visible without hover. |
| `mode = observer post-08:15 IST` | All actions auto-fire by default; "manual override" is a deliberate side-button, not the primary path |
| `daily_target = ₹30K` (capital ₹10L) | +₹30K threshold labeled "target hit — system will force-exit unless Opus extends" everywhere |
| `extension_principle = "only if probability of increase very high"` | EXTEND_PROFIT shows "5/6 gates passed" not "passed" — owner sees the strictness |
| `device_primary = iPhone` | Default mobile layout; tablet/desktop are progressive enhancements |

The owner sees a UI that REFLECTS HIS OWN PRINCIPLES back at him. He doesn't have to remember "what does +₹30K mean again?" — the UI labels it.

---

## 9. Phased rollout — 5 phases, NOT all at once

This whole spec is too large to ship in one PR. The deep-context-check protocol mandates incremental, verifiable shipping.

| Phase | What ships | Risk | Order |
|---|---|---|---|
| **Phase A** | The Spine (top + bottom) — single component used by every view | 🟢 | ship first, lowest risk |
| **Phase B** | TODAY consolidation — merge `/today/` + `/execute/` (intraday section) into single TODAY view | 🟢 | ship 2nd |
| **Phase C** | DESK transformation — `/ops/` becomes the live Desk view with position cards + reasoning timeline | 🟡 | ship 3rd, requires API additions for trader_decisions feed |
| **Phase D** | STOCK modal — tap-symbol-anywhere → modal with our take + chart + fundamentals + news | 🟡 | ship 4th, biggest visual lift |
| **Phase E** | HEALTH consolidation — `/audit/` + `/readiness/` + `/roadmap/` merged. INTEL view added for news + macro + cross-asset. | 🟢 | ship last; mostly data already surfaceable |

### Per-phase discipline
1. PR description references this doc + which phase
2. `bash scripts/verify-no-drift.sh` exit 0 before AND after
3. Pre-market integrity check passes before any deploy
4. Tag baseline after each phase merges
5. Deprecate old pages (redirect or hide nav) only after new view is verified

### Parallel work safety
- The "Build Indian stock analysis application" chat is doing UI experiments. They CAN ship Phase A-E if they reference this doc.
- I (intelligence-layer chat) won't ship UI work; I'll only ship API additive endpoints they need (under §3 rules of doc 18).
- The doc 18 tripwire catches any drift attempts.

---

## 10. Explicit non-goals — what we DON'T build

Owner's instruction: "ONLY take UI/UX inspiration." Not "build everything those tools have."

| Tool | Feature we DO NOT build | Why |
|---|---|---|
| TradingView | Drawing tools, custom indicators, alerts UI | Observer mode; we don't draw on charts |
| Sensibull | Strategy payoff builder | We don't trade options yet |
| StockEdge | Custom scan builder | Our pool is Opus-driven, not user-built |
| Tijori | Industry segmental data | Not ingested |
| Screener.in | 10y financial spreadsheet | Not ingested at that depth |
| Trendlyne | Broker target prices | No source |
| MoneyControl | Live ticker feed of every stock | Limited to our 73-stock pool + news_items |
| Investing.com | All-asset coverage (forex, crypto, bonds) | Only what wealth-macro-global ingests |
| NSE app | Order placement | Real-money via Kite directly, not via our UI |

If a future feature requires building one of these, it's **a new ingestion cron + new D1 table FIRST** (intelligence layer), then UI second. Not the reverse.

---

## 11. Glossary — terms used throughout this doc

- **Spine** — the always-visible top + bottom strip (index + capital + phase + readiness)
- **Position card** — atomic unit of DESK view; everything about one open position
- **Reasoning bubble** — UI primitive showing one Opus/Sonnet decision
- **News pill** — UI primitive showing one news_items row
- **Conviction meter** — composite_conviction score visualized as 3-segment bar
- **Tripwire** — `scripts/verify-no-drift.sh` — protected-surface drift detector
- **Layer 1 (Intelligence)** — pick selection: which stocks + why (per doc 17)
- **Layer 2 (Execution)** — trade placement + exit + cron health (per doc 17)
- **Phase** — current trading-day mode (PRE-MARKET / PRE-OPEN / LIVE / CLOSE / POST-CLOSE / OFF-HOURS)
- **Owner profile** — `owner_profile` table; versioned preferences feeding personalization

---

## 12. Decision checkpoints before each phase

Before shipping each phase, owner answers in writing:
1. *"Do I trust the data this view is reading from?"* (audit_findings clean for relevant tables)
2. *"Will this view change anything in the intelligence layer?"* (must be NO — UI is read-only consumer)
3. *"What old page is this replacing and how do I roll back?"* (named explicitly)
4. *"Is the verification command (verify-no-drift.sh) still passing?"*
5. *"Does this work on iPhone in <3s on 4G?"* (the actual primary device)

If any answer is "I don't know" → stop. Investigate. Then ship.

---

## 13. The single sentence that captures this design

> **Show the owner exactly what the engine knows, exactly when he needs it, in exactly the depth he can act on — and surface the system's own honesty about what it doesn't know.**

That's the bar. Every other design choice in this doc rolls up to that sentence.
