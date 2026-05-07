# 20 · EXECUTION TRAIL — Thu 07 May 2026

> **Purpose**: forensic data trail of every micro-execution done in the trading
> system on this date. Every event has a **precise timestamp** (IST, second-level)
> sourced from git, GitHub, or D1. Segmented under three macro layers so the
> owner can audit each layer's coherence vs its macro objective.
>
> **This document is data only — no analysis.**
>
> **Timestamp sources:**
> - **Git** = `git log --pretty=format:"%ai"` (commit author time)
> - **GH-PR** = GitHub API `createdAt` / `mergedAt`
> - **D1-TD** = `trader_decisions.ts` from D1 (UTC ms → IST)
> - **D1-PT** = `paper_trades.entry_at / exit_at` from D1
> - **CFP** = Cloudflare Pages auto-deploy (≈ 1 min after PR merge)
> - **MAN** = manual owner D1 write (intervention)
> - **HTTP** = manual HTTP trigger (force_phase=)

---

## 0 · Top-of-day context (carried in from prior sessions)

| | |
|---|---|
| **Real-money launch target** | Mon 11 May 2026 (₹10,00,000 capital) |
| **Days remaining** | 2 trading days (Fri 8 May, Mon 11) |
| **Already-shipped intelligence layers (pre-this-chat)** | F-DATA-1, F-PERS, F1 v2 composite_conviction, F-EXIT-1 target_locked, F-L4-LOCK ₹30K profit-lock |
| **Already-pending intelligence work** | F-DATA-2, F-EXIT-2, F-COVER-1 |
| **08:30 IST verdict** | TRADE · HFCL (45%) + AEROFLEX (30%) + TDPOWERSYS (20%) · composed by claude-opus-4-5 · cost ₹27.23 |
| **Capital state in D1 user_config** | total_capital_paise = 100000000 (₹10L) |

---

## 1 · INTELLIGENCE LAYER

### 1.1 Macro objective

> Pick the right stocks for today, weight capital correctly, time the entry to
> the most reliable signal, manage the position with the right exit rules so
> winners run and losers cut fast, and learn from each day to improve tomorrow.

### 1.2 Components & where they live

| Component | File | Trigger |
|---|---|---|
| Pre-market verdict | `wealth-engine/workers/wealth-verdict/src/index.js` | 08:30 IST cron, Opus 4.5 |
| F-PERS personality scoring | `wealth-engine/workers/wealth-orchestrator/src/index.js` | 07:30 IST cron |
| F1 v2 composite conviction | `wealth-engine/workers/wealth-orchestrator/src/index.js` | 07:30 IST cron |
| F-DATA-1 universe coverage | `wealth-engine/workers/wealth-intraday-bars/src/index.js` | 16:00 IST cron |
| Range capture (OR-high/low) | `wealth-engine/workers/wealth-trader/src/index.js` :: `rangeCapture()` | 09:30 IST |
| Entry: deterministic breakout | `wealth-trader/src/index.js` :: `priceMonitor()` lines 477-571 | every 5min from 09:50 IST (currently — closes 09:30→09:50 dead zone with PR #89) |
| Entry: Opus | `wealth-trader/src/index.js` :: `entryDecision()` | 09:45 / 10:00 / 10:15 IST |
| Position management: Opus | `wealth-trader/src/index.js` :: `positionManagement()` | 11:00, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00 IST |
| Position management: Sonnet | `wealth-trader/src/index.js` :: `sonnetSafetyCheck()` | 11:15, 11:45, 12:15, 12:45, 13:15, 13:45, 14:15, 14:45 IST |
| F-EXIT-1 target lock | `wealth-trader/src/index.js` :: `priceMonitor()` exit ladder lines 757-776 | inline in price_monitor |
| F-L4-LOCK profit lock | `wealth-trader/src/index.js` :: `priceMonitor()` lines 807-837 | inline in price_monitor |
| Hard exit | `wealth-trader/src/index.js` :: `hardExit()` | 15:10 IST |

### 1.3 Today's intelligence-layer event trail (precise IST timestamps)

**Source legend:** D1-TD = trader_decisions row · D1-PT = paper_trades row · MAN = owner D1 write · HTTP = owner HTTP trigger · GH = GitHub API

| Time IST (HH:MM:SS) | Event | LTP | Source | Detail |
|---|---|---|---|---|
| 09:31:01 | paper_trades 3 rows created | — | D1-PT | HFCL id=16, AEROFLEX id=17, TDPOWERSYS id=18 (auto_managed=1) |
| 09:31:02 | range_capture | — | D1-TD | "captured 3 ranges, 3 setups in WATCHING state" (deterministic). OR-high/low: HFCL 140.21–146.40, AEROFLEX 351.45–378.00, TDPOWERSYS 1164.10–1235.70 |
| 09:31:02 | range_capture_fallback | — | D1-TD | safety-net fired: `{rows:3, picks_in_watching:3}` (deterministic) |
| 09:35:00 → 09:49:59 | **🔴 INTELLIGENCE GAP** | — | absence | priceMonitor was NOT scheduled to run before 09:50 IST. TDPOWERSYS broke trigger ₹1235.70 between ~09:40–09:44 (peak ₹1241.90, 5 min above) — invisible to all crons. PR #89 fixes this. |
| 09:45:47 | entry_1 HFCL | ₹145.38 | D1-TD | WAIT — "LTP 0.70% below 15-min high 146.40, vol_ratio 11.72×, waiting for LTP to clear 146.40" (claude-opus-4-5) |
| 09:45:51 | entry_1 AEROFLEX | ₹373.40 | D1-TD | WAIT — "LTP 1.22% below OR-high 378, vol_ratio 27.5×, wait for breakout" (claude-opus-4-5) |
| 09:45:54 | entry_1 TDPOWERSYS | ₹1227.90 | D1-TD | WAIT — "LTP 0.63% below 1235.7, vol_ratio 12.35×, wait" (claude-opus-4-5) |
| 10:00:52 | entry_2 HFCL | ₹143.90 | D1-TD | WAIT — "LTP 1.71% below 146.4, vol_ratio 14.27×, need price clearance" (claude-opus-4-5) |
| 10:00:53 | entry_2 AEROFLEX | ₹371.25 | D1-TD | **SKIP_GAPPED_BELOW_STOP** (deterministic) — 1-tick wick below stop ₹373.02. State → SKIPPED. |
| 10:00:53 | entry_2 TDPOWERSYS | ₹1213.00 | D1-TD | **SKIP_GAPPED_BELOW_STOP** (deterministic) — 1-tick wick below stop ₹1214.05. State → SKIPPED. |
| 10:15:45 | entry_3 HFCL | ₹145.24 | D1-TD | WAIT — "LTP 0.79% below 146.4, vol_ratio 16.4×, last attempt before window closes" (claude-opus-4-5) |
| 11:28:00 | **MAN: manual_revive TDPOWERSYS** | ₹1243.10 | MAN + D1-TD | Owner D1 UPDATE: `paper_trades id=18 SET trader_state='WATCHING'`. Decision row inserted with composed_by_model='human_owner'. Rationale: "stock broke trigger again at 10:55 IST, sustained 30+ min above; 10:00 SKIP was a wick" |
| 11:29:53 | **HTTP: priceMonitor manual fire** + BREAKOUT_ENTER TDPOWERSYS | ₹1243.10 | HTTP + D1-TD + D1-PT | Owner curl `?force_phase=price_monitor`. Worker fired BREAKOUT_TRIGGER. State → ENTERED, qty 160, vol_ratio 2.61×, recomputed stop ₹1228.18, target ₹1277.91. paper_trades.entry_at = 1778133593599 |
| 11:31:22 | position_mgmt TDPOWERSYS | ₹1240.20 | D1-TD | **HOLD** — "1min held, breaking 5-day high (1243>1194), breadth 5:1 A/D, ENERGY rally" (claude-opus-4-5) |
| 12:01:03 | position_mgmt TDPOWERSYS | ₹1266.90 | D1-TD | **HOLD** — "65% of typical 90d move, STAIR_STEP momentum" (claude-opus-4-5) |
| 12:14:09 | **MAN: manual_revive AEROFLEX** | ₹394.70 | MAN | Owner D1 UPDATE: `paper_trades id=17 SET trader_state='WATCHING'`. Stock broke trigger ₹378 at 11:43 IST, sustained above (peak ₹397.50) |
| 12:14:09 | BREAKOUT_ENTER AEROFLEX | ₹394.70 | D1-TD + D1-PT | Same HTTP trigger fired entry. State → ENTERED, qty 759, vol_ratio 6.27×, stop ₹389.96, target ₹408.24. paper_trades.entry_at = 1778136249422 |
| 12:14:11 | PARTIAL_EXIT_50_FIRST_TARGET TDPOWERSYS | ₹1275.00 | D1-TD | Same trigger cycle: TDPOWERSYS hit first-target (60% of full target ₹1263.99). Booked 50% qty (80 sh) for net +₹2,469. Runner trail tightened to entry+0.5%. Remaining qty=80 |
| 12:15:49 | sonnet_safety TDPOWERSYS | ₹1277.40 | D1-TD + D1-PT | **URGENT_EXIT** — "position dropped 2.76% from peak despite being in profit, locking gains" (claude-sonnet-4-5). State → EXITED. paper_trades.exit_at = 1778136348843 |
| 12:18:02 | **MAN: P&L correction TDPOWERSYS** | — | MAN | Owner D1 UPDATE: `pnl_net_paise += 246866, pnl_gross_paise += 255200, cost_paise += 8334`. Compensates firePaperExit overwrite bug (partial booking erased on runner exit). Final pnl_net_paise = 512927 = ₹5,129.27 |
| 12:31:30 | position_mgmt AEROFLEX | ₹400.95 | D1-TD | **HOLD** (claude-opus-4-5) |
| 13:00:58 | position_mgmt AEROFLEX | ₹393.50 | D1-TD | **HOLD** — through chop (claude-opus-4-5) |
| 13:31:15 | position_mgmt AEROFLEX | ₹402.40 | D1-TD | **HOLD** (claude-opus-4-5) |
| 14:00:58 | position_mgmt AEROFLEX | ₹401.30 | D1-TD | **HOLD** (claude-opus-4-5) |
| 14:31:32 | position_mgmt AEROFLEX | ₹406.05 | D1-TD | **TIGHTEN_TRAIL** — "76% of typical move captured" (claude-opus-4-5) |
| 15:00:57 | position_mgmt AEROFLEX | ₹413.60 | D1-TD + D1-PT | **FULL_EXIT** — "126% of 90d avg max move, pre-close phase, lock gain" (claude-opus-4-5). State → EXITED. paper_trades.exit_at = 1778146257166 |
| 15:30:00 | Market close | — | clock | All ENTERED positions resolved. Realized total: ₹+19,316.39 |

### 1.4 Intelligence-layer code changes (every commit, every PR)

| IST Time (commit) | Commit | PR | PR created → merged | Status | What changed |
|---|---|---|---|---|---|
| 08:43:34 | 814fa01 | #83 | 08:44:13 → 08:48:55 | 🟢 deployed | live integrity overlay on Today (snapshot vs live status diff) — UI/intelligence boundary |
| 08:59:08 | cbf18e7 | #84 | 09:06:21 → 09:06:42 | 🟢 deployed | wealth-verdict max_tokens 1500 → 4000 — fixed 08:30 truncation (today's verdict was re-composed at 09:01 IST) |
| 09:24:45 | 0f96da3 | #85 | 09:25:14 → 09:25:24 | 🟢 deployed | F-PERS column-fix (`captured_at` not `created_at`) + F-COVER-1 top default 50→200 |
| 12:00:09 | b8ac986 | **#89** | 12:00:53 → **OPEN** | 🟡 **NOT DEPLOYED** | F-EXIT-2: `confirmedSustainedBelow`/`Above` helpers, entry-side SKIP guarded, exit-side STOP/TRAIL guarded, SKIPPED-resurrection in priceMonitor query, dispatcher window `m>=50` → `m>=35` |
| 12:20:15 | 33770bf | **#89** | (added to open PR) | 🟡 **NOT DEPLOYED** | firePaperExit accumulation fix: SET `pnl_*=?` → SET `pnl_*=COALESCE(pnl_*,0)+?` |

### 1.5 D1 manual writes today (intelligence-layer state mutations)

| IST Time | Table | Operation | Detail |
|---|---|---|---|
| 11:28:00 | paper_trades | UPDATE id=18 | trader_state SKIPPED → WATCHING; trader_notes='MANUAL REVIVE 11:28 IST...'; last_check_at=1778133480000 |
| 11:28:00 | trader_decisions | INSERT | manual_revive event for TDPOWERSYS (composed_by_model='human_owner', LTP 1243.10) |
| 12:14:00 | paper_trades | UPDATE id=17 | trader_state SKIPPED → WATCHING; trader_notes='MANUAL REVIVE 12:14 IST...'; last_check_at=1778135640000 |
| 12:18:02 | paper_trades | UPDATE id=18 | pnl_net_paise += 246866, pnl_gross_paise += 255200, cost_paise += 8334; trader_notes appended with 'TRUE_NET_RECONSTRUCTED' marker |

### 1.6 Current intelligence-layer state

**LIVE in production (wealth-trader Worker version pre-PR #89):**
- Entry intelligence: BREAKOUT_TRIGGER (single-tick), Opus 3-attempt window (09:45/10:00/10:15), price_monitor 09:50–15:09 every 5min
- Exit intelligence: F-EXIT-1 + 0.8% trail + Sonnet safety + Opus mgmt + hard_exit 15:10 + F-L4-LOCK
- **KNOWN BUGS still in production:** (1) SKIP_GAPPED_BELOW_STOP single-tick → permanent SKIP. (2) priceMonitor query filters `trader_state='WATCHING'` only. (3) 09:30–09:50 dead zone. (4) firePaperExit overwrites accumulated pnl_net.

**PR pending owner deploy (PR #89, 2 commits):**
- F-EXIT-2 tick-confirmation (entry + exit sides)
- SKIPPED-resurrection
- 09:30→09:35 dead-zone fix
- firePaperExit accumulation fix

**Deferred (post-real-money launch):**
- F-DATA-2 (avg time-to-high column)
- 6/9 dim_health workers improvement
- Volume_ratio time-aware floor tuning
- Conviction-weighted dynamic allocation

---

## 2 · TECHNICAL OPERATIONS LAYER

### 2.1 Macro objective

> Crons fire on time, return correct data, write atomically to D1 with no
> data loss. Kite API auth holds. The intelligence layer always sees the
> data it needs in the schema shape it expects.

### 2.2 Components & schedule

| Component | File / Endpoint | Schedule (IST) |
|---|---|---|
| wealth-trader cron multi-window | `wealth-engine/workers/wealth-trader/wrangler.toml` | `* 4 * * 1-5` (every min 09:30–10:29) + `*/3 5-9 * * 1-5` (every 3min 10:30–15:29) + `*/15 3 * * 1-5` (08:30/45, 09:00/15) + `*/5 10 * * 1-5` (15:30–16:25) |
| Dispatcher | `wealth-trader/src/index.js` :: `routeByIstTime()` | per-call IST-clock routing |
| Kite LTP fetch | `wealth-trader/src/index.js` :: `getKiteLtp()` | called inline by phases |
| D1 writes | wealth-trader, wealth-orchestrator | per-event |
| HTTP entrypoints | `wealth-trader/src/index.js` :: `fetch()` | `/state` (read), `?force_phase=…` (manual, key-gated) |
| Pages Functions API | `functions/api/trading.js` | per-request, read-only |

### 2.3 Today's technical-layer event trail

| IST Time | Event | Source | Detail |
|---|---|---|---|
| 09:30:07 (commit) | API extension PR #86 commit | Git | 65a2913 — `today_consolidated` adds pick.live = {ltp_paise, ltp_ts, bars, position} |
| 09:30:46 → 09:36:19 | PR #86 created → merged | GH-PR | live LTP + position state + chart on Today verdict cards |
| 09:37:00 ≈ | Cloudflare Pages deploy PR #86 | CFP | ~1 min after merge |
| 09:50:10 (commit) | API fixes PR #87 commit | Git | 8c9a875 — capital ₹10L, no phantom P&L on WATCHING, intraday_ticks fallback |
| 09:50:30 → 09:56:03 | PR #87 created → merged | GH-PR | 3 critical fixes |
| 09:57:00 ≈ | CFP deploy PR #87 | CFP | |
| 10:20:20 (commit) | UI fixes PR #88 commit | Git | 2bf74be — chart HTML overlay, breakout banner, 1-min ticks |
| 10:20:53 → 10:21:18 | PR #88 created → merged | GH-PR | chart label HTML overlay |
| 10:22:00 ≈ | CFP deploy PR #88 | CFP | |
| 11:29:53 | **HTTP: force_phase=price_monitor** | HTTP | curl `https://wealth-trader.nihafwork.workers.dev/?key=…&force_phase=price_monitor`. Response: `{phase: price_monitor, rows: 1, exits_fired: 0}` — fired BREAKOUT_TRIGGER for TDPOWERSYS |
| 12:00:09 (commit) | wealth-trader F-EXIT-2 commit | Git | b8ac986 — PR #89 (NOT DEPLOYED) |
| 12:00:53 | PR #89 created | GH-PR | F-EXIT-2 emergency, currently OPEN |
| 12:14:11 | **HTTP: force_phase=price_monitor** (2nd) | HTTP | Second curl. Response: `{phase: price_monitor, rows: 2, exits_fired: 0, portfolio_pnl_paise: 517990}` — fired BREAKOUT_ENTER for AEROFLEX + PARTIAL_50 for TDPOWERSYS |
| 12:20:15 (commit) | firePaperExit fix commit added to PR #89 | Git | 33770bf — accumulation fix |
| 12:36:43 (commit) | API + UI story-arc commit | Git | d026604 — adds `picks[].live.timeline[]` JOIN trader_decisions, `verdict.portfolio` roll-up |
| 12:37:26 → 12:38:17 | PR #90 created → merged | GH-PR | story-arc redesign |
| 12:39:00 ≈ | CFP deploy PR #90 | CFP | new fields verified live ~12:40 IST |
| 13:00:07 (commit) | chart CSS hotfix commit | Git | 9226f91 — de-scoped chart CSS rules |
| 13:00:11 → 13:01:22 | PR #91 created → merged | GH-PR | hotfix |
| 13:02:00 ≈ | CFP deploy PR #91 | CFP | SW v45 |
| 17:27:22 (commit) | trail doc commit | Git | cd5d08a |
| 17:27:42 | PR #92 created | GH-PR | this document |

### 2.4 Worker deploys outstanding

- **PR #89 (wealth-trader)**: requires `cd wealth-engine/workers/wealth-trader && wrangler deploy`. **No GitHub Actions configured for Workers. MUST DEPLOY before Fri 8 May 09:30 IST.**

### 2.5 Current technical-layer state

- All scheduled cron firings on time today (verified via trader_decisions row appearance at expected IST times)
- Kite API auth holding — no `KITE_DOWN` events logged
- D1 writes atomic — no schema/constraint errors
- Pages Functions serving all new fields correctly post PR #90 deploy

---

## 3 · UI / UX LAYER

### 3.1 Macro objective

> Owner sees the complete trading story — what was planned, what fired, why,
> when, what's happening NOW, what happened, what we learned, what to do
> tomorrow — with two distinct reading modes: **LIVE** during market hours
> and **RETROSPECTIVE** after market close.

### 3.2 Components

| Component | File | Surface |
|---|---|---|
| /trading/today/ page | `trading/today/index.html` (single-page vanilla JS) | Owner's primary daily surface |
| today_consolidated API | `functions/api/trading.js` :: `getTodayConsolidated()` | Single endpoint feeding the page |
| Service Worker | `trading/sw.js` | Cache + version bumps |
| Spine library | `trading/_lib/spine.js` | Top indices + bottom phase strip |
| Stock modal library | `trading/_lib/stock-modal.js` | 90D deep-dive |

### 3.3 Today's UI/UX event trail

| IST Time | Event | Source | Detail |
|---|---|---|---|
| 09:36:19 | PR #86 merged → page now shows live LTP per pick | GH-PR + CFP | each card: live LTP + delta + position state pill + 320×90 SVG chart + plan grid |
| 09:45:00 ≈ | Owner screenshot — capital math wrong + phantom P&L | owner | flagged before this trail-tracking session |
| 09:56:03 | PR #87 merged | GH-PR + CFP | capital ₹10L correctness, no phantom P&L on WATCHING, chart fallback to ticks |
| 10:21:18 | PR #88 merged | GH-PR + CFP | chart HTML label overlay (fixes preserveAspectRatio text stretching), breakout-trigger banner, 1-min tick resolution |
| 11:29:53 | UI auto-update | inferred | TDPOWERSYS card transitions WATCHING → ENTERED on next 30s refresh |
| 12:14:09 | UI auto-update | inferred | AEROFLEX card transitions WATCHING → ENTERED |
| 12:14:11 | UI auto-update | inferred | TDPOWERSYS card shows partial-50 booking |
| 12:15:49 | UI auto-update | inferred | TDPOWERSYS card transitions ENTERED → EXITED |
| 12:25 ≈ | Owner feedback "the entire workflow is broken" | owner | UI was data dump, not story. Required redesign. |
| 12:36:43 (commit) | Story-arc redesign commit | Git | d026604 |
| 12:37:26 → 12:38:17 | PR #90 created → merged | GH-PR | hero P&L + story-arc + phase banner + timeline + lessons + tomorrow |
| 12:40:00 ≈ | CFP deploy PR #90 | CFP | new fields confirmed live; SW v44 |
| 12:55:00 ≈ | Owner screenshot — chart escaping container | owner | story-card layout had no `position:relative`; SVG with `position:absolute` climbed to viewport |
| 13:00:07 (commit) | hotfix commit | Git | 9226f91 |
| 13:00:11 → 13:01:22 | PR #91 created → merged | GH-PR | de-scoped chart CSS rules |
| 13:02:00 ≈ | CFP deploy PR #91 | CFP | SW v45 |
| 15:00:57 | UI auto-update | inferred | AEROFLEX card transitions ENTERED → EXITED with ₹+14,187 |
| 15:30:00 | Phase transition | inferred | LIVE → POST_CLOSE; lessons + tomorrow sections render |
| 16:39:00 ≈ | Owner check-in | owner | confirmed all positions resolved, total ₹+19,316 |
| 17:27:22 (commit) | trail doc | Git | cd5d08a |

### 3.4 UI/UX-layer commits today (precise IST)

| Commit IST | Commit hash | PR | What changed |
|---|---|---|---|
| 09:30:07 | 65a2913 | #86 | Per-pick live block + chart + plan grid replaces text-only listing |
| 09:50:10 | 8c9a875 | #87 | Phantom-P&L fix, capital correctness, chart fallback |
| 10:20:20 | 2bf74be | #88 | Chart HTML overlay, breakout banner, 1-min ticks |
| 12:36:43 | d026604 | #90 | STORY-ARC: hero P&L card, phase banner, story-arc renderer, timeline, lessons, tomorrow checklist |
| 13:00:07 | 9226f91 | #91 | HOTFIX: chart CSS de-scoped from .pick-card prefix |

### 3.5 SW version progression

| IST Time | Version | Triggering PR | Purpose |
|---|---|---|---|
| (pre-this-chat) | v41 | — | baseline |
| 09:36 | v42 | #86 | live LTP + chart |
| 09:56 | v42 confirmed | #87 | capital + phantom P&L (no version bump — was already v42) |
| 10:21 | v43 | #88 | chart HTML overlay |
| 12:38 | v44 | #90 | story-arc redesign |
| 13:01 | v45 | #91 | chart CSS hotfix |

### 3.6 Current UI/UX state at /trading/today/

- Top: spine (indices ribbon) + wallet ribbon (capital, P&L, positions)
- Hero P&L card: **+₹19,316.39 (+1.93% of capital)** · Realized ₹+19,316.39 · Unrealized ₹0 · 0 open · 2 closed · 1 watching · 0 skipped
- Phase banner: "Market closed · today is done · summary below"
- Verdict block: composed by claude-opus-4-5 (08:30 cron with re-compose at 09:01 after PR #84) · TRADE · headline + narrative
- 3 story-arc cards rendering full timelines (HFCL, AEROFLEX, TDPOWERSYS)
- Today's lessons (auto-detected): manual revivals + Sonnet urgent exit
- Tomorrow's checklist (6 items)

---

## 4 · CROSS-LAYER DEPENDENCY MATRIX

| PR | Originated in layer | Required in (intelligence) | Required in (technical) | Required in (UI/UX) |
|---|---|---|---|---|
| #84 max_tokens fix | Intelligence | ✓ (verdict cron change) | ✓ (Workers deploy was already done before this chat) | — |
| #85 F-PERS + F-COVER-1 | Intelligence | ✓ | ✓ | — |
| #86 live LTP on Today | UI/UX | — | ✓ (API extension) | ✓ |
| #87 capital + phantom P&L | UI/UX (defect) | — | ✓ (API field gating) | ✓ |
| #88 chart UX | UI/UX | — | ✓ (API expose or_high_paise) | ✓ |
| #89 F-EXIT-2 + accumulation | Intelligence | ✓ | ✓ (Worker logic + dispatcher + UPDATE statement) | timeline renders new WICK_*_HOLDING events |
| #90 story-arc UI | UI/UX | — | ✓ (API timeline + portfolio fields) | ✓ |
| #91 chart CSS hotfix | UI/UX (defect) | — | — | ✓ |
| #92 trail doc | Documentation | — | — | — |

---

## 5 · OUTSTANDING ITEMS BLOCKING REAL-MONEY (Mon 11 May)

### 5.1 Must-deploy before Fri 8 May 09:30 IST

| Item | Layer | PR | Action |
|---|---|---|---|
| F-EXIT-2 + dead-zone + SKIPPED-resurrection + firePaperExit accumulation | Intelligence + Technical | **PR #89** | `cd wealth-engine/workers/wealth-trader && wrangler deploy` |

### 5.2 Recommended ship before Mon 11 May (from scenario backtest)

| Item | Layer | Status | Why |
|---|---|---|---|
| Afternoon-hold rule (13:30+ disable trail at +2% with vol) | Intelligence | not yet authored | 0.8% trail kicked AEROFLEX out at ₹392 vs 15:10 close ₹413.60 — backtest showed +₹17K left on table |
| Regime-aware partial-50 booking | Intelligence | not yet authored | Today partial-50 cost ₹6K vs ride-to-target on AEROFLEX (trending regime) |
| OR-range width filter (>5% = downgrade conviction) | Intelligence | not yet authored | AEROFLEX 7.55% + TDPOWERSYS 6.15% would have been pre-flagged as fragile |

### 5.3 Deferred (post-launch)

- F-DATA-2 (avg time-to-high column)
- 6/9 dim_health workers improvement
- gift_nifty data freshness fix

---

## 6 · DAY-LEVEL P&L TRUTH (precise from D1)

| Position | Qty | Entry IST | Entry ₹ | Exit IST | Exit ₹ | Net P&L | Hold | Source |
|---|---|---|---|---|---|---|---|---|
| HFCL (id=16) | 0 (n/a) | — | — | — | — | ₹0 | — | D1-PT trader_state=WATCHING |
| AEROFLEX (id=17) | 759 | 12:14:09 | ₹394.70 | 15:00:57 | ₹413.60 | **₹+14,187.12** | 2h 46m 48s | D1-PT pnl_net_paise=1418712 |
| TDPOWERSYS (id=18) partial | 80 | 11:29:53 | ₹1,243.10 | 12:14:11 | ₹1,275.00 | ₹+2,468.66 | 44m 18s | derived from trader_notes |
| TDPOWERSYS (id=18) runner | 80 | 11:29:53 | ₹1,243.10 | 12:15:48 | ₹1,277.40 | ₹+2,660.61 | 45m 55s | D1-PT pnl_net_paise=512927 (after MAN correction) |
| **Total realized** | | | | | | **₹+19,316.39** | | |
| Capital deployed | | | | | | ~₹3.99L of ₹10L | | |
| Return on deployed | | | | | | **+4.84%** | | |
| Return on total capital | | | | | | **+1.93%** | | |

### 6.1 P&L event-stream reconciliation

```
12:14:11  TDPOWERSYS partial booking added pnl_net_paise += 246866
12:15:48  TDPOWERSYS runner exit OVERWROTE pnl_net_paise = 266061  (firePaperExit bug)
12:18:02  MAN correction: pnl_net_paise += 246866 → 512927  (₹5,129.27)
15:00:57  AEROFLEX runner exit (no partial — first run of AEROFLEX, accumulation = ₹14,187.12)
```

If PR #89's firePaperExit fix had been deployed, the 12:18:02 manual correction would not have been needed — pnl_net_paise would have accumulated automatically from 246866 (partial) + 266061 (runner) = 512927.

---

## 7 · THE THREE CONNECTED VIEWS

### 7.1 Intelligence layer (target state for Mon 11 May)

```
PRE-MARKET (08:30 IST)
  Verdict cron → 3 picks (depends on F-PERS, F1 v2, intraday_suitability,
                          news, sectors, regime)

OPEN (09:15) → RANGE (09:30)
  range_capture → opening_ranges + paper_trades.or_high/low → state=WATCHING

ENTRY (09:35–14:00 with PR #89 deployed)
  priceMonitor.BREAKOUT_TRIGGER (every 5min, deterministic)
  + entryDecision (Opus at 09:45/10:00/10:15)
  + F-EXIT-2 confirmation: no single-tick SKIPs
  + SKIPPED-resurrection if stock recovers above trigger

POSITION MGMT (11:00–15:00 every 30min)
  Opus: HOLD / TIGHTEN_TRAIL / PARTIAL_EXIT_50 / FULL_EXIT
  Sonnet safety: URGENT_EXIT off-cycle
  F-EXIT-1: target_locked → ride trail above
  F-L4-LOCK: portfolio +₹30K → force-exit

EXIT
  Trail / target-lock / sonnet-urgent / Opus full-exit / hard 15:10
```

### 7.2 Technical operations (target state)

```
CRON SCHEDULE (wealth-trader/wrangler.toml — currently optimal):
  IST 08:30/45 09:00/15  warm-up
  IST 09:30→10:29        every 1min (entry-window)
  IST 10:30→15:29        every 3min (active trading)
  IST 15:30→16:25        every 5min (cleanup)

DISPATCHER (with PR #89 deployed):
  09:30 → range_capture
  09:35/40 → price_monitor (NEW with PR #89)
  09:45 → entry_1, 10:00 → entry_2, 10:15 → entry_3
  Other 5-min marks 09:35–15:09 → price_monitor
  11:00, 11:30, 12:00…15:00 → position_mgmt (Opus)
  11:15, 11:45, 12:15…14:45 → sonnet_safety
  15:10 → hard_exit
```

### 7.3 UI / UX (target state)

```
PRE_MARKET (before 09:15 IST):
  Hero ₹0 · "verdict composes 08:30"
  Picks: PLAN section only

LIVE (09:15–15:30 IST):
  Hero: live P&L ticking
  Phase banner: next cron HH:MM
  Picks: PLAN + TIMELINE + LIVE STATUS + CHART + OUTCOME (when exited)
  Auto-refresh 30s

POST_CLOSE (15:30+ IST):
  Hero: final P&L locked
  Picks: full arc + LESSON
  Today's lessons (auto-detected)
  Tomorrow's checklist
  Static
```

---

## 8 · READING INSTRUCTIONS

1. **Layer-internal coherence (column-read)** — read §1, §2, §3 each as a column. Does every micro-change inside that layer serve the layer's macro objective?

2. **Cross-layer coupling** — read §4. Did each cross-layer change get matching shipments?

3. **Ship-readiness for May 11** — read §5. Are §5.1 deploys done?

4. **P&L coherence** — read §6.1. Did the event-stream sum to the truth, or did a bug eat a partial booking?

If audit finds drift → update §7 (connected views) → back-propagate fixes.

End of trail — Thu 07 May 2026.
