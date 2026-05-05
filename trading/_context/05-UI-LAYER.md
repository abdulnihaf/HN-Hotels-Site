# Layer 5 — UI

**Path:** `trading/` (PWA at `trade.hnhotels.in`)
**Stack:** vanilla HTML/CSS/JS, no build pipeline. Served by Cloudflare Pages.

---

## Routes today (auto-generated)

> Regenerated from `trading/*/index.html` and `trading/sw.js`.

<!-- AUTO:ui-routes-list -->
| Route | File | Lines |
|---|---|---|
| `/trading/` | `trading/index.html` | 1342 |
| `/trading/execute/` | `trading/execute/index.html` | 2729 |
| `/trading/ops/` | `trading/ops/index.html` | 576 |
| `/trading/today/` | `trading/today/index.html` | 2703 |

**Service worker:** `CACHE_VERSION = 'wealth-v26'` · 15 pre-cached URLs
<!-- /AUTO:ui-routes-list -->

## Audience map (manual)

| Route | Purpose | Audience |
|---|---|---|
| `/trading/` | Hub / power dashboard | dev / power-user |
| `/trading/today/` | Daily observation view | OWNER ★ |
| `/trading/execute/` | Manual paper-trade form, picker, math | candidate for retire (see doc 10) |
| `/trading/ops/` | Cron status, spend, system health | dev |

Plus:
- `manifest.json` — PWA manifest (Wealth Engine app)
- `sw.js` — service worker, version `wealth-v24`
- `_lib/picker.js` — stock picker modal, shared
- `icons/` — PWA icons

---

## /trading/today/ — Owner's daily home

**9 sections, top to bottom:**

1. **Hero TODAY'S P&L** ⭐ NEW — large card with day net P&L, positions count, win rate
2. **Phase Clock** — IST time + current phase (PRE_MARKET / ENTRY_WINDOW / ACTIVE / WIND_DOWN / CLOSED)
3. **Alerts panel** — critical alerts only (post-triager, urgency ≥ 4)
4. **Verdict Card** — Opus's 08:30 morning verdict + picks + alternatives + halt rules
5. **Auto-Trader Positions** — every position with state, P&L, mode, recent decisions
6. **Timeline** — chronological log of every cron fire + decision today
7. **Intelligence Audit** — 12 data sources rated `fresh / stale / no-data`
8. **System Health** — cron fires/24h, failed crons, Anthropic spend, Kite token state
9. **EOD Learning Audit** — 4-bucket attribution + skill% bar + Sonnet narrative
10. **Monthly Learning Trail** — last 30 audits + cumulative + tuning suggestions

Plus:
- Footer: `🔍 Pick a stock to paper-trade` (inline picker), `📞 Analyze concall` (modal)
- Collapsed `<details>`: 🔬 Show the math (briefing v2, 9-dim health, MTF, Bayesian, raw signals)

**Design principle:** No buttons that change state. Owner is observer. Period.

---

## /trading/ — Hub

3 KPI cards at top (today, week, month). Below:
- Overview tab — capital deployed, open positions, recent verdicts
- Signals tab — raw signal_scores from intraday_suitability
- Insights tab — Bayesian preview + signal correlations
- Capital tab — drawdown chart + Sharpe-like metric

This is the place where "show the math" power features live. Owner rarely opens this in observation phase.

---

## /trading/execute/ — Legacy power dashboard

Kept around because of:
1. Manual paper-trade form (sym, qty, entry, stop, target, thesis)
2. Stock Picker integration (watchlist + signals)
3. Live Kite order placement (real-money path — only flips on after paper-trade phase)
4. Trade Math panel (R:R, breakeven, position sizing)
5. 3-question test (forces owner to articulate thesis before placing)

**Why this is up for retirement:** All 5 capabilities have alternatives:
1. Manual paper-trade → Today already has `🔍 Pick a stock to paper-trade` inline picker
2. Picker → already lives in `_lib/picker.js`, can open from any page
3. Kite order placement → only matters AFTER paper-trade validation (months away)
4. Trade Math → can move to `Show the math` collapsed section
5. 3-Q test → no longer needed when system is autonomous; can move to Hub

**Recommendation:** see `10-EXECUTE-TAB-CONSOLIDATION.md`.

---

## /trading/ops/ — System ops

- Cron list with last-fire timestamps
- Anthropic spend (today / week / month)
- D1 row counts per table
- Kite token state (active / refresh-needed / expired)
- Manual buttons: `Refresh suitability`, `Force compose verdict`, `Re-run today's audit`

This is the "dev tools" page. Owner only opens to fix something.

---

## PWA manifest + service worker

- App name: "Wealth Engine"
- Theme color: `#0a0f1c`
- Service worker version: `wealth-v24`
- Pre-cached: `/trading/`, `/trading/execute/`, `/trading/today/`, `/trading/ops/`, `manifest.json`, icons, `_lib/picker.js`
- Caching strategy:
  - `/api/*` → network only (NEVER cached)
  - HTML routes → network-first, fallback to cache (offline support)
  - Static assets (svg/png/css/js/json) → cache-first

⚠️ Bump `CACHE_VERSION` in `sw.js` when shipping new HTML.

---

## Mobile-first

- Body padding respects iOS safe-area (notch + home indicator)
- All buttons ≥ 44px tap target
- Sticky header (Kite status always visible)
- Tested: Safari iOS, Chrome Android
- Desktop wide screens (≥ 1280px): grid expands

---

## Auth

PIN gate using `DASHBOARD_KEY` (Cloudflare secret).
- Owner enters PIN once → stored in `localStorage`
- All API calls append `?key=DASHBOARD_KEY`
- API rejects if key mismatch

---

## Recent UI fixes (this session)

| Issue | Fix |
|---|---|
| 90-day history showed `—%` in verdict card | Re-fetch from `intraday_suitability` at read time, attach `intraday_history` to picks |
| Daily loss showed -₹20K but trader uses -₹30K | Hardcoded `daily_loss_limit_paise: 3000000` in getVerdictToday |
| User can't see "today's win" at a glance | NEW: Hero P&L card above Phase Clock |
| Tab nav: Hub/Today/Execute/Ops | NEW: proposing Hub/Today/Ops, with Execute features migrated (see doc 10) |
