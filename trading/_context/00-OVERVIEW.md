# HN Wealth Engine — System Overview

**Purpose:** Autonomous Indian-equity intraday paper-trading platform. Owner is **observer** post-08:15 IST Kite OAuth. System is fully autonomous after that.

**Phase:** Paper trade for 5–30 days → validate skill% honestly → deploy ₹10L real capital on Zerodha.

**Daily target:** 3–5% of deployed capital (₹30k–₹50k/day on ₹10L).

**Strategy class:** Intraday momentum + opening-range breakout, sleep flat by 15:10 IST.

---

## Core principle

```
Owner connects Kite at 08:15 → walks away.
Opus picks 2–3 stocks at 08:30 (with ₹100K–₹350K/pick allocation).
Trader watches breakout, enters, manages, exits by 15:10.
EOD: 4-bucket attribution (RIGHT / MISSED / LEARNED / LUCK) → tunes tomorrow.
Owner reads `/trading/today/` like a newspaper. No buttons.
```

---

## Architecture stack

| Layer | Tech | Why |
|---|---|---|
| Compute | Cloudflare Workers + Pages | Free / paid tier scales unlimited crons |
| Database | Cloudflare D1 (SQLite) | One DB `wealth-engine`, all tables |
| Decision | Anthropic Claude (Opus 4.5 / Sonnet 4.5 / Haiku 4.5) | Tier-tiered: Opus for picks, Haiku for extraction |
| Market data | Kite Connect (Zerodha) | LTP + 5-min OHLC + instruments mapping |
| News | RSS feeds (Moneycontrol, ET Markets) + Haiku extraction | Pre-market enrichment + alert triage |
| Frontend | Vanilla HTML/CSS/JS, no build pipeline | PWA, offline-first, mobile-first |
| Auth | PIN gate (DASHBOARD_KEY) | Owner-only |

## Live workers (auto-generated)

> Regenerated from `wealth-engine/workers/*/wrangler.toml`.

<!-- AUTO:workers-summary -->
| Worker | Crons | src/index.js lines |
|---|---|---|
| `wealth-calendar-breadth` | 8 | 382 |
| `wealth-corp-intel` | 6 | 547 |
| `wealth-event-scraper` | 4 | 364 |
| `wealth-flow-engine` | 10 | 589 |
| `wealth-fundamentals` | 1 | 512 |
| `wealth-intraday-bars` | 3 | 365 |
| `wealth-macro-global` | 5 | 154 |
| `wealth-macro-in` | 7 | 192 |
| `wealth-news` | 6 | 463 |
| `wealth-options` | 5 | 345 |
| `wealth-orchestrator` | 15 | 1051 |
| `wealth-price-core` | 10 | 691 |
| `wealth-signal-engine` | 6 | 1091 |
| `wealth-trader` | 4 | 1427 |
| `wealth-verdict` | 8 | 1617 |
| **15 workers total** | 98 | — |
<!-- /AUTO:workers-summary -->

---

## 4 phases of the day

| Phase | Time IST | Cron | Worker | LLM |
|---|---|---|---|---|
| **A0** Pre-market enrichment | 07:30 | `0 2 * * 1-5` | wealth-verdict | Opus |
| **A** Morning verdict | 08:30 | `0 3 * * 1-5` | wealth-verdict | Opus |
| **B** Alert triage (always-on) | every 5min | `*/5 * * * *` | wealth-verdict | Haiku |
| **C** Verdict invalidator | 09:15–15:30 / 15min | `0,15,30,45 4-9 * * 1-5` | wealth-verdict | Opus (only on material change) |
| **EXEC** Trader breakout watch | 09:30–10:30 / 1min | `* 4 * * 1-5` | wealth-trader | Opus position_mgmt |
| **EXEC** Trader active monitor | 10:30–15:30 / 3min | `*/3 5-9 * * 1-5` | wealth-trader | Opus |
| **D.1** Paper-trade autopsy | 16:00 | `30 10 * * 1-5` | wealth-verdict | Sonnet |
| **D.3** Suitability refresh | 16:30 | `0 11 * * 1-5` | wealth-verdict | engine-only |
| **D.4** EOD Learning Audit | 18:30 | `0 13 * * 1-5` | wealth-verdict | Sonnet |
| **D.2** Weekly review | Mon 09:00 | `30 3 * * 1` | wealth-verdict | Sonnet |

---

## Where each layer lives

- `01-DATA-INGESTION-LAYER.md` — kite-bhavcopy, intraday-bars, news, OI, FII/DII
- `02-DECISION-LAYER.md` — wealth-verdict (Opus picks), signal scoring, sector cap, conviction sizing
- `03-EXECUTION-LAYER.md` — wealth-trader (state machine: WATCHING → ENTERED → EXITED/HELD_OVERNIGHT)
- `04-LEARNING-LAYER.md` — autopsy + EOD 4-bucket audit + monthly trail + suitability backtest
- `05-UI-LAYER.md` — Today / Hub / Execute / Ops + component breakdown
- `06-CRON-MAP.md` — full cron schedule
- `07-D1-SCHEMA.md` — all tables
- `08-API-ENDPOINTS.md` — every `/api/trading?action=` route
- `09-RISK-ENVELOPE.md` — caps, stops, locks, halts
- `10-EXECUTE-TAB-CONSOLIDATION.md` — why Execute tab can retire

---

## Owner's golden rules

1. **No production deploys from Claude.** Draft PRs only.
2. **Money in paise (INTEGER)** in D1. Convert to rupees only at display.
3. **Read before edit.** Always `Read` the full file before changing it.
4. **Vanilla JS only.** No npm / Vite / Rollup / esbuild.
5. **Mobile-first.** ≥44px tap targets. Test Safari iOS + Chrome Android.
6. **Architect, don't ask.** Make decisions. Don't ask permission for technical/workflow choices.
7. **Don't change strategy without proper understanding.** Push back on ideas before implementing.

---

## Live URLs

| URL | What |
|---|---|
| `trade.hnhotels.in/trading/today/` | Owner's daily observation view |
| `trade.hnhotels.in/trading/` | Hub / power dashboard |
| `trade.hnhotels.in/trading/ops/` | System ops (cron status, spend) |
| `trade.hnhotels.in/trading/execute/` | Legacy power dashboard (candidate for retirement) |
| `trade.hnhotels.in/api/trading?action=…` | All data APIs |
