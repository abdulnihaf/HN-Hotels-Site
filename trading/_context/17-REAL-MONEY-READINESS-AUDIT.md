# 17 · REAL-MONEY READINESS AUDIT

> **Status**: PRE-AUDIT (Wed May 6, 2026 evening, post-deploy)
> **Real-money go-live target**: **Mon May 11, 2026** — first ₹10L Zerodha real-trading session
> **Paper-trade days remaining**: 2 (Thu May 7, Fri May 8)
> **Sunday May 10 evening**: final audit + GO/NO-GO call

---

## 0. Why this doc exists

Owner is making a deliberate move from ₹10L paper to ₹10L real on Monday. This doc is the **single canonical reference** that:

1. **Captures every learning** from the build phase (since session start) so nothing is lost in the transition.
2. **Auto-populates daily** for Thu + Fri so each day's *pieces missing* / *execution done* / *regressions detected* are logged without owner intervention.
3. **Encodes go/no-go criteria** so the Sunday-night audit is a checklist, not a debate.
4. **Names owner blind spots explicitly** so I take extra care on those areas without being asked.

**Read this doc**: Wed evening (now), Thu evening, Fri evening, Sun evening.

---

## 1. THE TWO LAYERS — readiness audit framework

The system has exactly **two layers** that need to be ready independently. Each can fail independently, and a failure in either kills the day.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — INTELLIGENCE                                          │
│  "Are we picking the right stock for the right reason?"          │
│                                                                  │
│  Pre-market data → scoring/ranking → Opus pick selection         │
│  Built today: P1-P5 + F-DATA-1 (conviction data) + F-PERS        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 — TECHNICAL EXECUTION                                   │
│  "Does the trade enter, manage, and exit cleanly at the right    │
│   moments — and do all the data crons keep the intelligence      │
│   layer fresh throughout the day?"                               │
│                                                                  │
│  Cron schedules · Kite OAuth · order placement · stop/target/    │
│  trail/hard-exit · profit lock · position_mgmt · token health    │
│  Built today: P1 (F-L4-LOCK) + F-EXIT-1 (target lock)            │
└─────────────────────────────────────────────────────────────────┘
```

**Why this split matters**: Layer 1 can be perfect and Layer 2 can lose money (today's AEROFLEX — perfect pick, wick-stopped on noise). Layer 2 can be perfect and Layer 1 can lose money (today's TDPOWERSYS — clean exit logic, but the pick peaked before our entry window). Both layers have to be GREEN independently.

### LAYER 1 — INTELLIGENCE (status as of Wed May 6 evening)

| # | Check | Status | Evidence today | What flips it green |
|---|---|:-:|---|---|
| **L1.1** | Pre-market data feeds | 🟡 | F-DATA-1 fixed today (`avg_up_last_week_pct` was NULL for all 73 stocks; backfill 49/73). 24 NULLs = F-COVER-1 separate issue. | 2 consecutive days of `intraday_suitability` ≥80% column-population at 08:25 IST integrity check. |
| **L1.2** | Pool / universe coverage | 🔴 | 24 of 73 pool stocks have NO `intraday_bars` today (33% blind spot). ATLANTAELE (top-11 by owner_score) is invisible. | F-COVER-1 investigated; ≥90% pool covered for 3 consecutive days. |
| **L1.3** | Conviction formula 3-factor | 🟡 | F1 v2 shipped via P2 but recent_regime was silently null until tonight's F-DATA-1 fix. Untested live. | Thu 09:08 IST verdict ranking uses non-null recent_regime; ranking shape differs meaningfully from the 2-factor version (sanity check: 1+ pick changes vs yesterday). |
| **L1.4** | Time-to-high awareness | 🔴 | `avg_time_to_high_minutes` column doesn't exist. 4 of today's high-score picks (TDPOWERSYS, DEEDEV, AGIIL, STLTECH) had peaks at 09:15-09:25 — uncatchable from 09:30 entry. | Either F-DATA-2 ships before Mon (column added + score penalty wired), OR explicit acceptance with documented filter (skip stocks whose 90d-median time-to-high < 09:30). |
| **L1.5** | Pick selection accuracy | 🟢 | Today Opus caught HFCL (+10.9% #1 runner) and AEROFLEX (+9.39% #2 runner). KRN (top score, sector-capped) also ran +6.92%. | 5+ days of pattern: 1+ of day's top-5 actual runners is in our top-3 picks. |
| **L1.6** | Owner profile freshness | 🟢 | F-PERS shipped + owner_profile injected into Opus prompts. Profile last updated tonight after today's calibration. | Profile auto-updated cron fires (currently manual; could be daily eod). |

**Layer 1 rollup**: 2 GREEN, 2 YELLOW, 2 RED. Layer 1 NOT READY for real money currently.

### LAYER 2 — TECHNICAL EXECUTION (status as of Wed May 6 evening)

| # | Check | Status | Evidence today | What flips it green |
|---|---|:-:|---|---|
| **L2.1** | All scheduled crons firing on time | 🟡 | Today exposed silent cron skip in `wealth-intraday-bars` (`30 0 * * 1-5` not in dispatch map). Fixed. Other workers' cron health unknown. | 2 consecutive days of pre-market integrity check confirming every expected cron in the last 24h appeared in `cron_run_log`. |
| **L2.2** | Kite OAuth token health | 🟡 | Token refresh works; no expiry mid-day historically. But on real-money day a mid-day expiry kills everything. | Pre-market check confirms token won't expire during 09:15-15:30 window. |
| **L2.3** | Entry execution (paper mode) | 🟢 | Today: 3 paper trades entered cleanly (DEEDEV/AGIIL/STLTECH) at expected prices via breakout/fallback logic. | Same cleanliness over Thu+Fri. **First real-money Mon: validate first order goes through to Zerodha actual order book within 5 sec of trigger.** |
| **L2.4** | Stop-loss firing semantics | 🔴 | AEROFLEX wick-stopped today on intra-bar 320.70 (bar closed 321.85, above stop). Stock then ran to 350.05. Wick-stops fire on noise. | F-EXIT-2 ships: stop only fires on 2-min confirmation OR 5-min bar-close ≤ stop. Tested at least 1 paper-trade day. |
| **L2.5** | Per-position target exit (F-EXIT-1) | 🟡 | Shipped tonight: target lock as floor + Opus WIDEN_TARGET 6-gate. Untested live. | Thu/Fri: at least 1 target hit triggers `TARGET_LOCKED_F_EXIT_1` decision in `trader_decisions`; subsequent exit is via stop-at-target OR trail OR Opus WIDEN_TARGET (not via the old immediate FULL_TARGET_HIT). |
| **L2.6** | Hard exit at 15:10 IST | 🟢 | `hardExit` cron at 15:10 IST exists and clears all `auto_managed=1, is_active=1` positions. | Confirm fires on Thu+Fri (existing cron — historically reliable). |
| **L2.7** | Profit lock at +₹30K | 🟢 | F-L4-LOCK shipped today: PROFIT_LOCK_FORCE_EXIT_30K + EXTEND_PROFIT 5-gate (Opus). | If portfolio hits +₹30K on Thu or Fri, force-exit fires. If not, manually re-read code Sunday with fresh eyes. |
| **L2.8** | Loss halt at −₹30K | 🟢 | DAILY_HALT_LOSS_30K already exists (predates today). | If portfolio hits −₹30K, halt fires. Same Sunday-fresh-read if untriggered. |
| **L2.9** | Worker version drift (main vs prod) | 🟡 | PR #65 just merged; main and prod aligned. But future deploys might drift. | Daily check Thu+Fri: every wealth-* worker's deployed version_id matches the latest main branch commit. |
| **L2.10** | Anthropic / Kite quota headroom | 🟡 | No daily quota tracking exists. | Daily quota usage % logged; alert if any source >80% of cap. |

**Layer 2 rollup**: 4 GREEN, 5 YELLOW, 1 RED. Layer 2 NOT READY for real money currently.

### Combined readiness rollup

| Layer | Green | Yellow | Red | Status |
|---|:-:|:-:|:-:|:-:|
| Layer 1 — Intelligence | 2 | 2 | 2 | 🔴 Not ready |
| Layer 2 — Execution | 4 | 5 | 1 | 🔴 Not ready |
| **Combined** | **6** | **7** | **3** | 🔴 **NO-GO** at current hour |

**Required for GO Mon morning**: Each layer independently has 0 RED + ≤2 YELLOW. Currently Layer 1 has 2 RED, Layer 2 has 1 RED. The 3 RED items (L1.2 / L1.4 / L2.4) are the blocking work between now and Sunday.

---

## 2. DAILY LOG — populated each evening by EOD readiness cron

### 📅 Wed May 6, 2026 (today, paper trade)

#### Pieces missing (gaps discovered)
1. **`avg_up_last_week_pct` NULL for 73/73 stocks** — root cause: cron `30 0 * * 1-5` in wrangler.toml but missing from `CRON_DISPATCH` map. Silent skip since column-add. **Fixed tonight via F-DATA-1.** 49/73 now populated.
2. **`avg_time_to_high_minutes` column doesn't exist** — owner_score gives high marks to stocks (TDPOWERSYS, DEEDEV, AGIIL, STLTECH) whose historical peaks print in the first 15 min. We can't enter those before peak. **Not yet fixed.** Tracked as F-DATA-2.
3. **24 of 73 pool stocks have NO bars today** — ATLANTAELE etc. invisible. Bars-coverage cron has silent failure. **Not yet fixed.** Tracked as F-COVER-1.
4. **Stops fire on intra-bar wicks** — AEROFLEX bar low 320.70 (recovered to 321.85 close) fired stop at 322.93. Lost the eventual ₹93K hypothetical run. **Not yet fixed.** Tracked as F-EXIT-2.
5. **`worker_name` column missing in `cron_run_log` INSERTs** for newer workers (wealth-intraday-bars, wealth-verdict, wealth-trader). Silent fail because column has NOT NULL constraint. Cron history invisible. **Not yet fixed.** Low priority but worth fixing alongside F-COVER-1 investigation.

#### Execution done (what shipped)
| Fix ID | Description | Deploy version | Time IST | Risk |
|---|---|---|---|---|
| P1 | F-L4-LOCK force-exit at +₹30K + EXTEND_PROFIT 5-gate | wealth-trader 4cb4b48 (earlier today) | ~16:00 | LOW |
| P2 | F1 v2 composite_conviction (upside × downside_resistance × recent_regime) | wealth-verdict 3db4ff2f | ~16:30 | LOW (silently inert until F-DATA-1 fix) |
| P3 | owner_score formula + hit_neg_2pct_rate computed | wealth-verdict 3db4ff2f | ~16:30 | LOW |
| P4 | F-PERS owner_profile injection | wealth-verdict 3db4ff2f | ~16:30 | LOW |
| P5 | Phantom P&L cleanup + audit_findings auto-resolve | wealth-orchestrator 685e431e | ~17:00 | LOW |
| **F-DATA-1** | Daily cron dispatch fix + manual backfill 49/73 stocks | wealth-intraday-bars 827aa24b | 22:30 | LOW (data integrity only) |
| **F-EXIT-1** | Per-position target-lock as floor + Opus WIDEN_TARGET 6-gate | wealth-trader e21c84b0 | 22:50 | LOW (asymmetric — zero new downside vs current) |

#### Regressions detected (did we lose something when adding something new?)
- **None today.** F-EXIT-1 is strict superset of `FULL_TARGET_HIT` (immediate-reversal exit at target = same outcome as before). F-DATA-1 is data-only.
- **Future watchpoint**: tomorrow morning verify P2's F1 v2 conviction formula now produces meaningfully different ranks vs yesterday (since `recent_regime` factor now flowing). If ranks are identical, the formula or join is still broken silently.

#### Trade outcome (paper)
- **Opus picks (counterfactual)**: TDPOWERSYS −₹3,536 + HFCL +₹8,389 + AEROFLEX −₹3,595 = **+₹1,258**
- **Owner override (actual)**: DEEDEV / AGIIL / STLTECH = **−₹3,931** (per session log; all three peaked before entry)
- **Hypothetical with F-EXIT-1 active on Opus picks**: +₹7,874 (HFCL captured to 138.89 trail)
- **Hypothetical with F-EXIT-1 + F-EXIT-2 active**: ~+₹28,669 (AEROFLEX would not have wick-stopped)
- **Best-case all-in AEROFLEX from open** (your math): ₹93,906 — validates that the picker layer was correct; the lossy layers were sizing + exit logic.

#### Owner blind spots addressed today
- ✅ Cron firing visibility (we discovered the silent skip — now have 2 days of data to confirm fix)
- ✅ Code-vs-deploy drift (PR #65 merged → main and prod aligned)
- ⚠️ Statistical significance — today is 1 data point. The "Opus caught 2 of top-3 runners" needs replication on Thu + Fri before trusting.

#### One-line summary
*Wed May 6 paper-trade exposed exit-logic gap (target as ceiling) and pre-market data silent failure; both fixed tonight. Picker layer validated by HFCL+AEROFLEX. Real-money go-live requires F-EXIT-2 + F-COVER-1 fixes plus 2 days of clean paper trading.*

---

### 📅 Thu May 7, 2026 — to be auto-populated by EOD readiness cron

*Pre-market integrity check at 08:30 IST writes the morning row. EOD readiness cron at 16:00 IST writes the afternoon row.*

#### Pieces missing
- *(populated automatically)*

#### Execution done
- *(populated automatically)*

#### Regressions detected
- *(populated automatically; compares today's F-DATA-1 column population, today's verdict ranking shape, today's trade outcomes vs Wed expectations)*

#### Trade outcome
- *(populated automatically from `paper_trades` + `daily_verdicts`)*

#### Owner blind spots addressed
- *(populated by audit_findings.category='daily_readiness')*

---

### 📅 Fri May 8, 2026 — to be auto-populated by EOD readiness cron

*Same structure as Thu.*

---

## 3. OWNER BLIND SPOTS (where I take extra care)

These are the dimensions where the owner cannot self-audit, so I (Claude) must aggressively log + flag.

| # | Blind spot | Why owner can't self-audit | Mitigation (active) | Mitigation (still needed) |
|---|---|---|---|---|
| **B1** | Cron firing visibility | Doesn't read CF dashboard or cron logs | `cron_run_log` table + audit_findings auto-detection | Pre-market integrity check at 08:30 IST + push notification on red |
| **B2** | D1 column population | Trusts SQL claims + UI views | Pre-market integrity check validates expected non-null rates per column | Per-deploy data-integrity smoke test before claiming "shipped" |
| **B3** | Code-vs-deploy drift | Doesn't compare git HEAD to wrangler version IDs | PR-merge discipline | Daily `wrangler deploy --dry-run` diff vs main |
| **B4** | Statistical significance | Single-day patterns feel like trends | Always cite "5+ day required" before threshold change | Weekly review writes "is this a pattern or noise" verdict |
| **B5** | Opus/Sonnet cost economics | Doesn't track `anthropic_usage` table | `cost_paise` column logged per call | Daily cost summary line in EOD readiness row |
| **B6** | Race conditions across crons | Multi-cron timing is hidden | F3 fix (orchestrator vs trader phantom exits, fixed earlier today) | Add explicit cron-overlap check on every new cron addition |
| **B7** | Conviction/score interpretation | No intuition for "is 51 vs 47 meaningful" | UI pages show absolute + percentile rank | Add "score gap to next pick" + "z-score vs pool" annotations in verdict UI |
| **B8** | Edge cases in exit logic | Trusts simulations match reality | Today's reverse-engineering of HFCL exposed target=ceiling gap | Run F-EXIT-1 simulation on next 5 paper trades vs actual; flag any divergence |
| **B9** | Pool drift (which 73 stocks are in `intraday_suitability`) | Doesn't see when symbols are added/removed | Currently invisible | Add daily diff: "today's pool vs yesterday's pool — which symbols added/removed and why" |
| **B10** | Worker subscription quotas (Kite, Anthropic) | Doesn't track API limits | None | Daily quota usage % in EOD readiness row |

---

## 4. GO / NO-GO CRITERIA — Sunday May 10, 2026 evening

This is the decision protocol on Sunday night. Read each criterion, mark PASS/FAIL/WARN. The decision is mechanical.

### HARD-PASS criteria (all must be ✅ for GO)

| # | Criterion | Pass condition |
|---|---|---|
| H1 | All 8 gates GREEN OR (≥6 GREEN + ≤2 YELLOW + 0 RED) | per Section 1 |
| H2 | F-DATA-1 has populated `avg_up_last_week_pct` for ≥80% of pool 3 days running | query `intraday_suitability` |
| H3 | At least 1 target-hit on Thu or Fri verified `TARGET_LOCKED_F_EXIT_1` decision fired correctly | `trader_decisions` |
| H4 | Zero unresolved CRITICAL audit_findings | `audit_findings` WHERE severity='critical' AND resolved_at IS NULL |
| H5 | Main branch and prod worker version IDs match for all 5 trading workers | wrangler list + git log |
| H6 | Owner has read this doc start to finish on Sunday evening | self-attest |
| H7 | Kite OAuth token valid and won't expire during Mon trading window | `kite_tokens` last_refreshed |

### SOFT-PASS criteria (warning only — affect sizing decision)

| # | Criterion | Default if fails |
|---|---|---|
| S1 | F-EXIT-2 (bar-close stop) shipped + tested 1+ days | Sizing reduced to 20% per pick (max ₹2L per stock) |
| S2 | F-COVER-1 (bar coverage gap) ≥90% pool covered | Sizing reduced + exclude any pick from missing-bars set |
| S3 | F-DATA-2 (avg_time_to_high) shipped | Sizing reduced + manual review of pick time-to-high pattern |
| S4 | Both Thu + Fri paper P&L positive (any positive number) | Sizing halved if either day red |

### EXPLICIT NO-GO conditions (any single fail = NO-GO)

- Any RED gate at Sunday close.
- Any unresolved CRITICAL audit_finding.
- Verdict didn't fire on Thu OR Fri morning.
- Any worker version drift between main and prod (means a hot-fix never made it to main, or vice-versa).
- Owner is not personally available 09:00–15:30 IST Mon (real money requires presence).

### Contingency: NO-GO decision

If NO-GO on Sunday:
1. Postpone real money to Mon May 18 (one week later).
2. Do not push to main any major changes between now and then; only the specific fixes blocking GO.
3. Re-run this audit framework Sun May 17.

If PASS-WITH-WARNING (soft fails):
1. Launch real money with reduced sizing per the default in S1-S4.
2. Run for 1 week. If clean → scale to full ₹10L on Mon May 18.

---

## 5. WHAT GETS LOGGED EACH DAY (auto-populated)

To make this doc trustworthy by Sunday, the following auto-runs daily on Thu + Fri:

### Pre-market integrity check (cron at 08:30 IST weekday, in `wealth-orchestrator`)

Validates BEFORE the 09:08 verdict cron fires:
1. `intraday_suitability.avg_up_last_week_pct` populated ≥80% of pool
2. `kite_tokens` has active token
3. `intraday_bars` has yesterday's data for ≥80% of pool
4. `cron_run_log` last-24h shows expected workers ran (no silent skips)
5. Pool size is within ±5% of 7-day average (no symbol mass-removal)
6. Anthropic usage in last 24h within budget

Writes one `audit_findings` row with category=`pre_market_integrity` per day. Severity=`critical` if any gate fails. Severity=`info` if all pass.

### EOD readiness summary (cron at 16:00 IST weekday, in `wealth-orchestrator`)

After market close, writes one `audit_findings` row with category=`daily_readiness` containing:
- `pieces_missing`: any audit_findings detected during the day still unresolved
- `shipping_events`: any commits/deploys today (from git log + cron_run_log)
- `regressions`: comparisons of today's behavior vs yesterday's expected (verdict ranking shape, trade exit reasons distribution, etc.)
- `trade_outcome`: counter from `paper_trades` for today
- `cost_summary`: total Opus + Sonnet + Haiku spend today

### Sunday night master report (manual, run by owner)

Hits `/api/trading?action=getReadinessReport` → returns the 8-gate rollup + 3-day daily log + go/no-go computation.

---

## 6. CHANGE LOG (git log since session start, curated)

Auto-populated from `git log` on each EOD cron. Reverse-chronological.

### Wed May 6, 2026 — TODAY
- `5cd8976` F-DATA-1 + F-EXIT-1 (this evening's ship)
- `e7c907b` audit auto-resolve + UI status badges
- `82ffb46` P1-P5 owner-calibrated 4-layer architecture
- `91c769f` owner-calibrated architecture master doc
- `b66d2b4` /trade_comparison/ direct Kite LTP fallback
- `870a461` personalization layer
- … *(earlier today's commits)*

### Sat May 9, 2026 — buffer day
*(Likely no commits unless emergency)*

### Sun May 10, 2026 — final audit
*(No commits. Only reading, deciding.)*

---

## 7. THE TRUTH PRINCIPLE

If anything goes wrong on Mon (real money):
- The blame is mine (the architect), not the owner's.
- Every decision recorded here is auditable. Owner does NOT need to remember the reasoning — it's all logged.
- If there's any doubt on Sunday, the answer is **NO-GO**. Real money waits. Paper money is free.

The single most important sentence in this doc:

> **Trading-system maturity is measured by how many silent failures the system catches before they cost real money. Today caught 1 (F-DATA-1). The next 2 days will catch more. Each catch is an architecture win, not a setback.**
