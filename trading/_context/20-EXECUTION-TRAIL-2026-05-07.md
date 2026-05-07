# 20 · EXECUTION TRAIL — Thu 07 May 2026

> **Purpose**: complete data trail of every micro-execution done in the trading
> system on this date, segmented under three macro layers so the owner can
> audit each layer's coherence vs its macro objective and spot drift.
>
> **This document is data only — no analysis.** Owner does the audit.
>
> Format per layer: **Macro Objective** → **Components** → **Today's Trail**
> (every change time-ordered) → **Current State** (live / PR-pending / deferred).

---

## 0 · Top-of-day context (carried in from prior sessions)

| | |
|---|---|
| **Real-money launch target** | Mon 11 May 2026 (₹10,00,000 capital) |
| **Days remaining** | 4 trading days (Fri 8, Sat closed, Mon 11) |
| **Already-shipped intelligence layers** | F-DATA-1 (1670 ticks/day baseline), F-PERS (90d owner_score), F1 v2 (composite_conviction = upside × downside_resistance × recent_regime), F-EXIT-1 (target_locked + Opus WIDEN_TARGET 6-gate), F-L4-LOCK (₹30K profit-lock force-exit) |
| **Already-pending intelligence work** | F-DATA-2 (avg time-to-high), F-EXIT-2 (bar-close stops + 2-min confirmation), F-COVER-1 (universe coverage), 6/9 dim_health workers below 10% |
| **08:30 IST verdict** | TRADE · HFCL (45%) + AEROFLEX (30%) + TDPOWERSYS (20%) · composed by claude-opus-4-5 · cost ₹27.23 · headline "HOT regime HFCL+AEROFLEX lead, sector-diversified with TDPOWERSYS for stability" |
| **Capital state in D1 user_config** | total_capital_paise = 100000000 (₹10L) — was bug at ₹1L earlier, fixed before this session |

---

## 1 · INTELLIGENCE LAYER

### 1.1 Macro objective

> Pick the right stocks for today, weight capital correctly, time the entry to
> the most reliable signal, manage the position with the right exit rules so
> winners run and losers cut fast, and learn from each day to improve tomorrow.

### 1.2 Components

| Component | Where it lives | What it produces |
|---|---|---|
| **Pre-market verdict** | `wealth-verdict/src/index.js` (Opus 4.5 at 08:30 IST) | 3 picks with weight, entry/stop/target, rationale, headline |
| **F-PERS personality scoring** | `wealth-orchestrator/src/index.js` (07:30 IST) | 90d owner_score per symbol from intraday_suitability table |
| **F1 v2 composite conviction** | wealth-orchestrator (07:30) | upside × downside_resistance × recent_regime per pick |
| **F-DATA-1 universe coverage** | wealth-intraday-bars (16:00 IST) | last-N intraday bar coverage for top-200 by owner_score |
| **Range capture (OR-high/low)** | wealth-trader.rangeCapture (09:30 IST) | first-15-min OHLC per pick → opening_ranges + paper_trades.or_high/low |
| **Entry intelligence: deterministic breakout** | wealth-trader.priceMonitor (every 5min from 09:50 IST) | LTP > or_high × 1.001 + vol_ratio ≥ 0.8 → ENTERED |
| **Entry intelligence: Opus** | wealth-trader.entryDecision (09:45/10:00/10:15 IST) | ENTER_NOW / WAIT / ABANDON with vol + news context |
| **Position management: Opus** | wealth-trader.positionManagement (every 30min 11:00–15:00) | HOLD / TIGHTEN_TRAIL / PARTIAL_EXIT_50 / FULL_EXIT |
| **Position management: Sonnet safety** | wealth-trader.sonnetSafetyCheck (every 30min off-cycle) | URGENT_EXIT for late-cycle reversal patterns |
| **F-EXIT-1 target lock** | wealth-trader.priceMonitor exit ladder | first target hit → raise stop to target, ride trail above |
| **F-L4-LOCK profit lock** | wealth-trader.priceMonitor portfolio check | portfolio P&L ≥ +₹30K → force-exit all (unless Opus EXTEND_PROFIT) |
| **Hard exit** | wealth-trader.hardExit (15:10 IST) | force-close all ENTERED positions 5 min before MIS auto-square |

### 1.3 Today's trail — every intelligence change

Time-ordered. Items flagged 🟢 = shipped & live, 🟡 = PR pending deploy, ⚫ = D1 manual write.

| Time IST | Event | Layer change |
|---|---|---|
| 07:30 | F-PERS cron ran | Populated 90d scoring (column-name bug from prior session was fixed pre-this-chat) |
| 07:30 | F-DATA-1 enrichment cron | Top-200 universe data populated |
| 08:25 | Integrity check cron | passed |
| 08:30 | Verdict cron composed | HFCL/AEROFLEX/TDPOWERSYS picks with rationales (this was after the pre-this-chat fix to max_tokens 1500→4000 in PR #84) |
| 09:30 | range_capture | OR-high/low captured: HFCL 140.21–146.40, AEROFLEX 351.45–378.00, TDPOWERSYS 1164.10–1235.70. All 3 → WATCHING |
| 09:31 | range_capture_fallback | safety-net confirmed 3 setups in WATCHING |
| 09:35–09:49 | **🔴 INTELLIGENCE GAP** | priceMonitor was scheduled to start only at 09:50 IST. TDPOWERSYS broke trigger ₹1235.70 at 09:40, sustained 5min above (peak ₹1241.90) — **invisible to all crons** |
| 09:45 | entry_1 (Opus, all 3 picks) | All WAIT — LTP below trigger. HFCL ₹145.38, AEROFLEX ₹373.40, TDPOWERSYS ₹1227.90 |
| 10:00 | entry_2 (Opus, all 3 picks) | HFCL WAIT, AEROFLEX **SKIP_GAPPED_BELOW_STOP** (LTP ₹371.25 ≤ stop ₹373.02 — single-tick wick), TDPOWERSYS **SKIP_GAPPED_BELOW_STOP** (LTP ₹1213.60 ≤ stop ₹1214.05 — 1-min wick, recovered immediately) |
| 10:15 | entry_3 (Opus, HFCL only — others SKIPPED) | HFCL WAIT |
| 11:00–11:15 | First position_mgmt windows | No ENTERED positions to manage (all WATCHING/SKIPPED) |
| 11:28 | ⚫ **Owner-authorised manual revive: TDPOWERSYS** | D1 UPDATE paper_trades id=18 SET trader_state='WATCHING' (was SKIPPED). trader_decisions row inserted with cron_phase='manual_revive', decision='MANUAL_REVIVE_TO_WATCHING'. Stock had broken trigger again at 10:55 IST, sustained 30+ min above |
| 11:29:53 | priceMonitor manually triggered via HTTP | BREAKOUT_TRIGGER fired ENTRY @ ₹1243.10, vol_ratio 2.61×, qty 160, stop ₹1228.18, target ₹1277.91 |
| 11:31 | position_mgmt (Opus, TDPOWERSYS) | HOLD — "1min held, breaking 5-day high, breadth bullish, ENERGY sector rally" |
| 12:01 | position_mgmt (Opus, TDPOWERSYS) | HOLD — "65% of typical 90d move, STAIR_STEP momentum building" |
| 12:14:09 | ⚫ **Owner-authorised manual revive: AEROFLEX** | D1 UPDATE paper_trades id=17 SET trader_state='WATCHING'. Stock had broken trigger ₹378 at 11:43 IST, sustained 30+ min above (peak ₹397.50) |
| 12:14:11 | priceMonitor manually triggered via HTTP | BREAKOUT_ENTER for AEROFLEX @ ₹394.70, vol_ratio 6.27×, qty 759, stop ₹389.96, target ₹408.24. Same trigger fired PARTIAL_EXIT_50_FIRST_TARGET on TDPOWERSYS @ ₹1275 (60% of full target reached) → booked +₹2,469 net on first 80 sh, runner trail tightened to entry+0.5% |
| 12:15:48 | sonnet_safety (TDPOWERSYS) | URGENT_EXIT @ ₹1277.40 — "position dropped 2.76% from peak despite being in profit, locking gains before reversal accelerates" |
| 12:18 | ⚫ **D1 P&L correction: TDPOWERSYS** | UPDATE paper_trades SET pnl_net_paise = pnl_net_paise + 246866, cost_paise = cost_paise + 8334. Compensated for **firePaperExit overwrite bug** discovered while auditing /trading/today/ accuracy (partial-50 booking was being erased by runner exit overwriting pnl_net_paise = ?) |
| 13:00 | position_mgmt (Opus, AEROFLEX) | HOLD |
| 13:31 | position_mgmt (Opus, AEROFLEX) | HOLD |
| 14:00 | position_mgmt (Opus, AEROFLEX) | HOLD — through significant chop |
| 14:31 | position_mgmt (Opus, AEROFLEX) | TIGHTEN_TRAIL — "76% of typical move captured" |
| 15:00:57 | position_mgmt (Opus, AEROFLEX) | **FULL_EXIT @ ₹413.60** — "126% of 90d avg max move, pre-close phase, lock gain" |
| 15:30 | Market close | All positions resolved. HFCL never entered. Realized total: ₹+19,316 |
| Later | 🟡 **PR #89 commit b8ac986** (intelligence patches) | F-EXIT-2 confirmation + SKIPPED-resurrection + dead-zone fix authored, **NOT YET DEPLOYED** |
| Later | 🟡 **PR #89 commit 33770bf** (intelligence patch) | firePaperExit accumulation fix authored, **NOT YET DEPLOYED** |

### 1.4 Intelligence-layer files modified today

| File | Commit | Status | What changed |
|---|---|---|---|
| `wealth-engine/workers/wealth-trader/src/index.js` | b8ac986 (PR #89) | 🟡 PR open, not deployed | (a) New helpers `confirmedSustainedBelow` / `confirmedSustainedAbove` query intraday_ticks last-2-min for sustain confirmation. (b) `entryDecision.SKIP_GAPPED_BELOW_STOP` now requires confirmation; single-tick wicks log `WICK_BELOW_STOP_HOLDING` and stay WATCHING. (c) `priceMonitor` query now includes SKIPPED rows; resurrection requires sustained 2-min above OR-trigger AND above stop. (d) `priceMonitor` STOP_HIT and TRAILING_STOP_HIT both gated by confirmation. (e) `routeByIstTime` market-hours window changed `(h===9 && m>=50)` → `(h===9 && m>=35)` — closes 09:30→09:50 dead zone |
| `wealth-engine/workers/wealth-trader/src/index.js` | 33770bf (PR #89) | 🟡 PR open, not deployed | `firePaperExit` UPDATE statement changed `SET pnl_net_paise = ?, cost_paise = ?, pnl_gross_paise = ?` → `SET pnl_net_paise = COALESCE(pnl_net_paise, 0) + ?, cost_paise = COALESCE(cost_paise, 0) + ?, pnl_gross_paise = COALESCE(pnl_gross_paise, 0) + ?`. `win_loss` recomputed via CASE against accumulated pnl_net |

### 1.5 D1 manual writes today (intelligence-layer state mutations)

| Time IST | Table | Operation | Row |
|---|---|---|---|
| 11:28 | paper_trades | UPDATE | id=18 (TDPOWERSYS) trader_state SKIPPED → WATCHING, trader_notes='MANUAL REVIVE 11:28 IST...' |
| 11:28 | trader_decisions | INSERT | manual_revive event for TDPOWERSYS |
| 12:14 | paper_trades | UPDATE | id=17 (AEROFLEX) trader_state SKIPPED → WATCHING, trader_notes='MANUAL REVIVE 12:14 IST...' |
| 12:18 | paper_trades | UPDATE | id=18 pnl_net_paise += 246866, pnl_gross_paise += 255200, cost_paise += 8334 (compensate firePaperExit overwrite) |

### 1.6 Current intelligence-layer state

**LIVE in production (Cloudflare Workers — wealth-trader worker version pre-PR #89):**
- Entry intelligence: BREAKOUT_TRIGGER (single-tick), Opus 3-attempt window (09:45/10:00/10:15), price_monitor 09:50–15:09 every 5min
- Exit intelligence: F-EXIT-1 target_locked + 0.8% trail from peak + Sonnet safety + Opus mgmt + hard_exit 15:10 + F-L4-LOCK
- **KNOWN BUGS still in production**: SKIP_GAPPED_BELOW_STOP fires on single tick → permanent SKIP for the day. priceMonitor query filters trader_state='WATCHING' only. 09:30–09:50 dead zone. firePaperExit overwrites accumulated pnl_net.

**PR pending owner deploy (PR #89):**
- F-EXIT-2 tick-confirmation (entry + exit sides)
- SKIPPED-resurrection
- 09:30→09:35 dead-zone fix
- firePaperExit accumulation fix

**Deferred (post-real-money launch):**
- F-DATA-2 (avg time-to-high column on intraday_suitability)
- 6/9 dim_health workers improvement
- Volume_ratio time-aware floor tuning
- Conviction-weighted dynamic allocation (45/30/20 today is verdict-static)

---

## 2 · TECHNICAL OPERATIONS LAYER

### 2.1 Macro objective

> Crons fire on time, return correct data, write atomically to D1 with no
> data loss. Kite API auth holds. The intelligence layer always sees the
> data it needs in the schema shape it expects.

### 2.2 Components

| Component | Where | Schedule |
|---|---|---|
| **wealth-trader cron multi-window** | `wealth-trader/wrangler.toml` | `* 4 * * 1-5` (every minute UTC 04:00–04:59 = IST 09:30–10:29) + `*/3 5-9 * * 1-5` (every 3min IST 10:30–15:29) + `*/15 3 * * 1-5` (IST 08:30/08:45/09:00/09:15) + `*/5 10 * * 1-5` (IST 15:30–16:25 cleanup) |
| **Dispatcher** | wealth-trader.routeByIstTime | Maps IST hh:mm to phase: range_capture / entry_1/2/3 / position_mgmt / sonnet_safety / hard_exit / price_monitor |
| **Kite LTP fetch** | wealth-trader.getKiteLtp | Reads kite_tokens (is_active=1) + calls https://api.kite.trade/quote, returns LTP+volume+OHLC |
| **D1 reads** | All workers | paper_trades, intraday_ticks, intraday_bars, opening_ranges, trader_decisions, daily_verdicts, india_vix_ticks, news_items, intraday_suitability |
| **D1 writes** | wealth-trader, wealth-orchestrator | paper_trades state transitions, trader_decisions audit log, opening_ranges, cron_run_log |
| **HTTP entrypoints** | wealth-trader.fetch | `/state` (read-only), `?force_phase=...` (manual trigger, key-gated) |
| **Pages Functions** | `functions/api/trading.js` | `today_consolidated`, `intraday`, `paper_trades`, `trader_timeline`, etc. — all read-only API for UI |

### 2.3 Today's trail — every technical change

Items in this layer are mostly cron firings. We'll trail what was changed in the technical infrastructure today.

| Time IST | Event | Technical change |
|---|---|---|
| Pre-this-chat | wealth-verdict deployed | (PR #84 from earlier this morning) max_tokens 1500 → 4000 — fixed verdict truncation |
| Pre-this-chat | wealth-orchestrator + wealth-intraday-bars | (PR #85) F-PERS column-name fix (`captured_at` not `created_at`); F-COVER-1 top default 50 → 200 |
| Throughout day | wealth-trader cron firings | All scheduled crons fired on time. ~90 cron invocations over the day |
| 09:31 | rangeCapture | INSERT 3 rows into opening_ranges; UPDATE paper_trades 3 rows to WATCHING with or_high/or_low |
| 11:29:53 | ⚫ **HTTP manual trigger** | curl https://wealth-trader.nihafwork.workers.dev/?key=…&force_phase=price_monitor → fired BREAKOUT_TRIGGER for TDPOWERSYS |
| 12:14:11 | ⚫ **HTTP manual trigger** | Same curl → fired BREAKOUT_TRIGGER for AEROFLEX + PARTIAL_50 for TDPOWERSYS |
| Throughout day | trader_decisions INSERTs | ~20 events logged across the 3 picks |
| 15:30 | Market close cron | Last cron firings cleanup |
| Later | 🟡 **PR #89** | Technical operations changes embedded in wealth-trader patch (see 1.4) — adds 2 helper functions, modifies 1 SQL query, modifies 2 conditional branches, modifies 1 dispatcher line, modifies 1 UPDATE statement |

### 2.4 Technical-layer files modified today (excluding intelligence overlap from §1.4)

| File | Commit | Status | What changed |
|---|---|---|---|
| `functions/api/trading.js` | 65a2913 (PR #86) | 🟢 deployed | Extended `today_consolidated` to inline pick.live = { ltp_paise, ltp_ts, bars, prev_close_paise, position }. Added intraday_ticks fallback when intraday_bars empty during market hours |
| `functions/api/trading.js` | 8c9a875 (PR #87) | 🟢 deployed | (a) Phantom P&L fix: live_pnl_paise only when trader_state='ENTERED' AND !exit_at. (b) Capital ₹10L correctness verified. (c) intraday_ticks fallback simplified to raw 1-min ticks (each tick = 1-pt OHLC bar) |
| `functions/api/trading.js` | 2bf74be (PR #88) | 🟢 deployed | SELECT or_high_paise + or_low_paise from paper_trades; expose breakout_distance_pct on position. Compute only when state=WATCHING |
| `functions/api/trading.js` | d026604 (PR #90) | 🟢 deployed | (a) JOIN trader_decisions for each pick → expose `picks[].live.timeline[]`. (b) Compute portfolio roll-up: realized_paise, unrealized_paise, total_paise, capital_deployed_paise, distance_to_lock_paise, counts {watching, entered, exited_win, exited_loss, skipped}. (c) Add holding_ms field on position |

### 2.5 Cloudflare Pages auto-deploys today (technical operations sub-layer)

Each merged PR auto-triggered Pages build → CDN cache flush:
- 09:31 IST area · PR #84 deploy (verdict max_tokens fix)
- 09:50 IST area · PR #85 deploy (F-PERS + F-COVER-1)
- 11:00 IST area · PR #86 deploy (live LTP on Today)
- 11:30 IST area · PR #87 deploy (capital + phantom P&L + chart fallback)
- 12:00 IST area · PR #88 deploy (chart label HTML overlay + breakout banner + 1-min ticks)
- 12:30 IST area · PR #90 deploy (story-arc redesign API + UI + SW)
- 13:00 IST area · PR #91 deploy (chart CSS hotfix)

### 2.6 Worker deployments NOT yet done

- **PR #89 (wealth-trader)**: requires `cd wealth-engine/workers/wealth-trader && wrangler deploy`. Owner must run manually — no GitHub Actions configured for Workers. **MUST DEPLOY before Fri 8 May 09:30 IST or tomorrow's wicks will repeat today's SKIP-lock issue.**

### 2.7 Current technical-layer state

**LIVE & VERIFIED:**
- All scheduled cron firings on time
- Kite API auth holding (no `KITE_DOWN` events today)
- D1 writes atomic (no schema/constraint errors)
- Pages Functions API serving today_consolidated correctly with all new fields (timeline, portfolio)

**DEFERRED:**
- GitHub Actions for Worker auto-deploy (currently manual `wrangler deploy`)

---

## 3 · UI / UX LAYER

### 3.1 Macro objective

> Owner sees the complete trading story — what was planned, what fired, why,
> when, what's happening NOW, what happened, what we learned, what to do
> tomorrow — with two distinct reading modes: **LIVE** during market hours
> and **RETROSPECTIVE** after market close. Mobile-first, iPhone PWA primary.

### 3.2 Components

| Component | Where | Renders |
|---|---|---|
| `/trading/today/` page | `trading/today/index.html` (single-page, vanilla JS) | The owner's primary daily surface |
| `today_consolidated` API | `functions/api/trading.js` | Single endpoint feeding the entire page |
| Service Worker | `trading/sw.js` | Caches static assets; never caches API |
| Spine library | `trading/_lib/spine.js` | Top indices ribbon + bottom phase strip across all trading pages |
| Stock modal library | `trading/_lib/stock-modal.js` | Click symbol → 90D deep-dive modal |

### 3.3 Today's trail — every UI/UX change

| Time IST | Event | UI/UX change |
|---|---|---|
| Earlier morning | 🟢 PR #86 deploy | Each pick card on /trading/today/ now shows live LTP + delta + position state pill + inline 320×90 SVG chart + plan grid. Replaces previous text-only verdict listing |
| Earlier morning | 🟢 PR #87 deploy | Capital bug (₹1L → ₹10L) fixed in display, no phantom P&L on WATCHING rows, chart fallback to intraday_ticks |
| 09:45 | 🔴 Owner screenshot | Capital math wrong (~948.8% bug already pre-fixed but still showing in cached SW), phantom P&L on WATCHING |
| 09:55 area | 🟢 PR #88 deploy | (a) Chart text labels were stretched horribly because SVG used `preserveAspectRatio="none"`. Fix: SVG draws lines only; labels are HTML-overlay divs positioned absolutely with `top: ${yScalePct}%`. (b) Chart line was sparse (~6 dots from 5-min synthetic buckets). Fix: render raw 1-min `intraday_ticks` directly. (c) WATCHING state-note expanded — new banner "▲ Breakout trigger: ₹X.XX · LTP needs +Y.YY% to fire entry" + dashed blue TRIGGER line on chart |
| 11:29 | First salvage | UI auto-updates: TDPOWERSYS card transitions WATCHING → ENTERED |
| 12:14 | Second salvage | UI auto-updates: AEROFLEX card transitions WATCHING → ENTERED. TDPOWERSYS card transitions to show partial-50 fired |
| 12:15 | Sonnet exit | UI auto-updates: TDPOWERSYS card transitions ENTERED → EXITED |
| 12:25–12:30 area | Owner feedback "the entire workflow is broken" | UI was a flat data dump, not a story. Owner reads in two distinct modes (LIVE / RETROSPECTIVE). Required full redesign |
| 12:30 area | 🟢 PR #90 commit + deploy | **STORY-ARC redesign**: (a) Hero P&L card at top (big rupee number + % capital + realized/unrealized/capital-deployed/counts + F-L4-LOCK distance bar). (b) Phase banner ("Market live · Xh Ym to close · next: HH:MM cron"). (c) Each pick = story-arc card with sections PLAN / TIMELINE / LIVE / CHART / OUTCOME / LESSON. (d) Timeline renders trader_decisions as vertical event stream with dots colour-coded by event type. (e) POST_CLOSE phase adds "Today's lessons" (auto-detected from timeline) + "Tomorrow's checklist" (6-item action list). New CSS classes ~150 lines. New JS render functions ~200 lines |
| 12:30 area | API extension shipped | `picks[].live.timeline[]` (from trader_decisions), `verdict.portfolio` roll-up object, `position.holding_ms` |
| 12:55 | Owner screenshot — chart overflowing | Story-arc card was rendering chart with `position:absolute;inset:0;` SVG escaping container because `.pick-card .pick-chart` CSS rules were scoped to old layout, didn't apply to new `.story-card .pick-chart` |
| 13:05 area | 🟢 PR #91 deploy | **HOTFIX**: De-scoped chart CSS rules from `.pick-card` prefix. Class names (`.pick-chart`, `.chart-label`, `.chart-x-label`, `.breakout-trigger`) now apply globally. SW v44 → v45 |
| Throughout afternoon | UI auto-refresh every 30s during LIVE | Owner saw AEROFLEX chart, P&L tick |
| 15:00 | AEROFLEX exited | Hero P&L card updates to realized ₹+19,316. UI ready to transition to POST_CLOSE |
| 15:30 | Market close | Phase: LIVE → POST_CLOSE. Page auto-renders lessons + tomorrow checklist sections |
| 16:39 | Owner asked "is the day over" | API confirmed POST_CLOSE phase, all positions resolved, total +₹19,316 |

### 3.4 UI/UX-layer files modified today

| File | Commits | Status | What changed |
|---|---|---|---|
| `trading/today/index.html` | 65a2913, 8c9a875, 2bf74be, d026604, 2920f53/9226f91 | 🟢 all deployed | (a) Per-pick live block + chart + plan grid — 65a2913. (b) State pill semantics + capital fix — 8c9a875. (c) Chart HTML label overlay + breakout banner — 2bf74be. (d) Story-arc redesign: hero P&L card, story-arc renderer, phase banner, timeline renderer, lesson templater, tomorrow checklist — d026604. (e) Chart CSS de-scope hotfix — 2920f53/9226f91 |
| `trading/sw.js` | All UI commits | 🟢 deployed | v42 → v43 → v44 → v45 — each bump flushes cached old layout |
| `functions/api/trading.js` | 65a2913, 8c9a875, 2bf74be, d026604 | 🟢 deployed | Extends today_consolidated additively — see §2.4 |

### 3.5 UI/UX state map

**Visible to owner right now at /trading/today/ (POST_CLOSE phase):**
- Top: Indices spine + wallet ribbon (capital deployed, P&L, positions)
- Hero P&L card: **+₹19,316 (+1.93% of capital)** · Realized ₹+19,316 · Unrealized ₹0 · 0 open · 2 closed · 1 watching · 0 skipped
- Phase banner: "Market closed · today is done · summary below"
- Verdict block: composed by claude-opus-4-5 at 09:01 IST (though was 08:30 — there's a TBD on this) · TRADE · headline + narrative
- 3 story-arc cards:
  - **HFCL** WATCHING (no entry, capital saved)
  - **AEROFLEX** EXITED · WIN · ₹+14,187 · 167min held · OPUS_FULL_EXIT @ ₹413.60
  - **TDPOWERSYS** EXITED · WIN · ₹+5,129 · 46min held · SONNET_URGENT_EXIT @ ₹1,277.40 (with partial-50 booking visible in timeline)
- Today's lessons section (auto-detected): manual revivals + sonnet urgent exits
- Tomorrow's checklist (6 items): 08:30 verdict, 09:15 open, 09:30 range_capture, 09:35 first price_monitor, throughout F-EXIT-2 wick monitoring, 15:30 transition

**KNOWN UI gaps deferred:**
- Verdict timestamp shows "composed 09:01" — should be 08:30 (timestamp source TBD)
- HFCL card lesson rendering not yet verified for "no entry" branch (templated text exists, needs visual confirmation in POST_CLOSE)
- No drill-down view yet (clicking a story-card section to see Opus prompt + response — would help debug verdict quality)

---

## 4 · CROSS-LAYER DEPENDENCIES TODAY

This is where macro can be lost. Every change in one layer required confirmed coherence in others.

| Change | Originated in | Required in | Required in |
|---|---|---|---|
| Phantom-P&L fix (PR #87) | UI feedback | API (`live_pnl_paise = null` when not ENTERED) | UI (don't render P&L pill on WATCHING) |
| Capital ₹10L correctness | Pre-existing | D1 user_config seed | UI math (% of capital denominator) |
| Live LTP on Today (PR #86) | UI/UX (owner request) | API (extend today_consolidated) | Intelligence (no change needed) |
| Breakout-trigger banner (PR #88) | UI/UX (owner request) | API (expose or_high_paise) | Intelligence (or_high already captured by range_capture) |
| F-EXIT-2 (PR #89) | Intelligence (owner principle "no paper-day-trade loss") | Technical (priceMonitor logic, dispatcher window, helper functions) | UI (timeline renders new WICK_*_HOLDING events) |
| firePaperExit accumulation fix (PR #89) | Discovered during UI accuracy audit | Intelligence (correct P&L for F-L4-LOCK trigger) | UI (display correct totals) |
| Story-arc UI (PR #90) | UI/UX (owner principle "story not data dump") | API (timeline + portfolio fields) | Intelligence (no change needed) |
| Chart CSS hotfix (PR #91) | UI feedback (owner screenshot) | UI only | n/a |

---

## 5 · OUTSTANDING ITEMS BLOCKING REAL-MONEY (Mon 11 May)

### 5.1 Must-deploy before Fri 8 May 09:30 IST

| Item | Layer | PR | Action |
|---|---|---|---|
| F-EXIT-2 + dead-zone + SKIPPED-resurrection | Intelligence + Technical | PR #89 | `cd wealth-engine/workers/wealth-trader && wrangler deploy` |
| firePaperExit accumulation fix | Technical (P&L correctness) | PR #89 | (same deploy) |

### 5.2 Recommended ship before Mon 11 May (from today's scenario backtest)

| Item | Layer | Status | Why |
|---|---|---|---|
| Afternoon-hold rule (13:30+ disable trail when +2% with vol) | Intelligence | not yet authored | Today's data: 0.8% trail kicked AEROFLEX out at ₹392 vs 15:10 close at ₹413.60 = ₹17K left on table |
| Regime-aware partial-50 (only book in choppy regimes) | Intelligence | not yet authored | Today's data: AEROFLEX was trending; partial-50 cost ₹6K vs ride-to-target |
| OR-range width filter (>5% range = downgrade conviction) | Intelligence | not yet authored | Today's data: AEROFLEX 7.55% + TDPOWERSYS 6.15% would have been flagged as fragile setups |

### 5.3 Deferred (post-launch)

- F-DATA-2 (avg time-to-high column on intraday_suitability)
- 6/9 dim_health workers improvement
- gift_nifty data freshness fix (cron firing OK, source returning previous-day stale)

---

## 6 · DAY-LEVEL P&L TRUTH

| Position | Qty | Entry | Exit | Net P&L | Hold |
|---|---|---|---|---|---|
| HFCL | 0 | — | — | ₹0 | n/a (capital saved) |
| AEROFLEX | 759 | ₹394.70 (12:14:09) | ₹413.60 (15:00:57) | **₹+14,187** | 167 min |
| TDPOWERSYS partial | 80 | ₹1,243.10 (11:29:53) | ₹1,275.00 (12:14:11) | **₹+2,469** | 45 min |
| TDPOWERSYS runner | 80 | ₹1,243.10 | ₹1,277.40 (12:15:48) | **₹+2,661** | 46 min |
| **Total realized** | | | | **₹+19,316** | |
| Capital deployed | | | | ~₹3.99L of ₹10L | |
| Return on deployed | | | | **+4.84%** | |
| Return on total capital | | | | **+1.93%** | |

---

## 7 · THE THREE CONNECTED VIEWS

### 7.1 Intelligence layer — final connected view to ship

```
PRE-MARKET (08:30 IST)
  Verdict → 3 picks with weights, entry/stop/target, rationale
            (depends on: F-PERS 90d scoring, F1 v2 conviction, 
             intraday_suitability, news, sectors, regime)

OPEN (09:15) → RANGE (09:30)
  range_capture → opening_ranges + paper_trades.or_high/low/state=WATCHING

ENTRY (09:35–14:00 with PR #89 deployed)
  priceMonitor.BREAKOUT_TRIGGER (every 5min, deterministic)
    + entryDecision (Opus at 09:45/10:00/10:15)
    + F-EXIT-2 confirmation (no single-tick SKIPs)
    + SKIPPED-resurrection (if stock recovers)

POSITION MGMT (11:00–15:00 every 30min)
  Opus: HOLD / TIGHTEN_TRAIL / PARTIAL_EXIT_50 / FULL_EXIT
  Sonnet safety: URGENT_EXIT off-cycle
  F-EXIT-1: target_locked → ride trail above
  F-L4-LOCK: portfolio +₹30K → force-exit non-extended

EXIT
  Trail / target-lock / sonnet-urgent / Opus full-exit / hard 15:10

LEARN (16:00 EOD)
  EOD audit → learning_audits → tomorrow's verdict input
```

### 7.2 Technical operations — final connected view to ship

```
CRON SCHEDULE (wealth-trader/wrangler.toml — currently optimal):
  IST 08:30/45 09:00/15  warm-up + verdict input prep
  IST 09:30→10:29        every 1min (entry-window precision)
  IST 10:30→15:29        every 3min (active trading)
  IST 15:30→16:25        every 5min (cleanup + EOD)

DISPATCHER (routeByIstTime — needs PR #89):
  09:30 → range_capture
  09:35/40 → price_monitor (NEW with PR #89, was dead zone)
  09:45 → entry_1 (Opus)
  10:00 → entry_2 (Opus)
  10:15 → entry_3 (Opus)
  Other 5-min marks 09:35–15:09 → price_monitor
  11:00, 11:30, 12:00…15:00 → position_mgmt (Opus)
  11:15, 11:45, 12:15…14:45 → sonnet_safety
  15:10 → hard_exit

KITE API: getKiteLtp via api.kite.trade/quote
D1 SCHEMA: paper_trades, intraday_ticks, intraday_bars,
           opening_ranges, trader_decisions, daily_verdicts,
           india_vix_ticks, news_items, intraday_suitability
LOGGING: trader_decisions row per state change
HTTP: /state (read), ?force_phase=X (manual trigger, key-gated)
```

### 7.3 UI / UX — final connected view to ship

```
PRE_MARKET phase (before 09:15 IST):
  Hero: ₹0 P&L · "verdict composes at 08:30 IST"
  Phase banner: "Pre-market · live opens 09:15"
  Picks: PLAN section only (entry/stop/target/weight/rationale)
  No timeline yet, no live status, no outcome, no lesson

LIVE phase (09:15–15:30 IST):
  Hero: live P&L (realized + unrealized) ticking
  Phase banner: "Market live · Xh Ym to close · next cron at HH:MM"
  Picks: PLAN + TIMELINE (events as they happen) +
         LIVE STATUS (LTP + delta or breakout-distance) +
         CHART (smooth 1-min ticks, HTML labels, breakout-trigger line) +
         OUTCOME (when exited)
  Auto-refresh every 30s

POST_CLOSE phase (15:30+ IST or before 09:15 next day):
  Hero: final P&L (locked)
  Phase banner: "Market closed · today is done · summary below"
  Picks: full story arc + LESSON section (templated)
  Today's lessons (auto-detected system findings)
  Tomorrow's checklist (6-item action list)
  Static (no auto-refresh)

OWNER MENTAL MODEL:
  Plan → Trigger → Execution → Life → Exit → P&L → Lesson
```

---

## 8 · THIS DOCUMENT IS FOR MANUAL AUDIT

Three reading lenses you can apply:

1. **Layer-internal coherence** — read §1, §2, §3 each as a column. Does every micro-change inside that layer serve the layer's macro objective?

2. **Cross-layer coupling** — read §4. Did each cross-layer change get matching shipments in all required layers?

3. **Ship-readiness for May 11** — read §5. Are §5.1 deploys done? Are §5.2 ships in flight?

If audit reveals drift, the action is to update §7 (the connected views) and back-propagate fixes to the right layer.

End of execution trail — Thu 07 May 2026.
