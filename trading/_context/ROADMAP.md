# 🗺️ HN Wealth Engine — Product Roadmap

**Living document.** Updated May 6 2026, ~10:00 IST during live trading.

The /trading/roadmap/ HTML page is the visual rendering of this. This MD is the source-of-truth for architecture decisions + fix priorities.

---

## 🎯 Outcome guardrails (the "north star")

| What | Target |
|---|---|
| Phase | Paper-trade validation, 5-30 days, then ₹10L real capital |
| Daily P&L target | +₹30K profit-lock · -₹30K loss-halt |
| Skill threshold for real | skill_pct > 55% sustained 30+ days (4-bucket EOD attribution) |
| Owner role | Observer post-08:15 Kite OAuth. No buttons that change state. |

---

## ✅ Shipped today (May 5 evening + May 6 morning)

| ID | Severity | Layer | What | When |
|---|---|---|---|---|
| **F3** | P0 | EXIT | Race-condition fix — orchestrator no longer touches auto_managed rows | May 6 09:55 IST |
| **F6** | P2 | SELECTION | Daily weekly_enrich cron (06:00 IST) | May 6 09:55 IST |
| **SUIT** | P0 | SELECTION | suitabilityRefresh column-mismatch (15→12) bug fixed + table populated | May 6 08:55 IST |
| **B-1** | P0 | ENTRY | rangeCapture safety-net fallback. Fired live today at 09:31:52 — saved the day | May 5 evening |
| **B-2** | P0 | ENTRY | News context for entryDecision (Opus reads last 60min news_items) | May 5 evening |
| **S1-S7** | P0 | EXIT | Statistical exit intelligence — Opus position_mgmt with 90d priors | May 5 evening |
| Compare | P1 | UI | /trading/compare/ — actual vs Opus counterfactual + post-exit panic detector | May 6 09:50 IST |
| Audit | P1 | UI | /trading/audit/ — surgical ops log with architecture findings | May 6 10:00 IST |
| Roadmap | P1 | UI | /trading/roadmap/ — this dashboard | May 6 10:05 IST |
| Watchlist | P1 | UI | /trading/today/ + /trading/execute/ shared rich card component | May 5 evening |

---

## 🟡 Up next — execute at market close TODAY (15:30 IST onwards)

### F1 — Conviction-weighted capital allocation [P0, ~30 lines, medium risk]
Replace blind 30/30/30 with weight = composite_conviction. Range 20-50% per pick.

### F2 — Three-stage surgical entry [P0, ~80 lines, HIGH risk]
Replace naive 09:31 LTP entry with: observe range → wait for dip + bounce → enter above bounce. Stop = dip-low − ATR-buffer.

### F4 — Cross-reference signal_scores [P1, ~50 lines, medium risk]
composeVerdict reads only intraday_suitability. Add second track from signal_scores so live current-signal stocks reach Opus.

---

## 🔴 Deep work — multi-day projects

- **F5** — Fix 6 broken dim_health dimensions (~6 hours, individually)
- **UI-2** — Live MTM in Hero card (~30 lines, low risk)
- **VAR** — VIX-adaptive loss halt (~10 lines)
- **B-3** — HELD_OVERNIGHT pre-market gap-check (new wealth-trader phase)

---

## 🏗️ Architecture layers (priority order)

| Layer | Job | Status |
|---|---|---|
| 1. SELECTION | Pick 2-3 stocks at 08:30 | F1/F4/F5 pending |
| 2. CAPITAL | qty per pick | **F1 BLIND — fix tonight** |
| 3. ENTRY | range_capture → trigger → Opus | **F2 NAIVE — fix tonight** |
| 4. MANAGEMENT | trail / partial / Opus position_mgmt | ✓ S1-S7 shipped May 5 |
| 5. EXIT | stop / target / trail / hard_exit / race-fix | ✓ F3 deployed today |
| 6. LEARNING | autopsy + suitability + audit + weekly | ✓ suit-refresh fixed |

---

## 📊 Progress meter

```
Layer 1 (SELECTION):   50% — 3 P0/P1 fixes pending (F1/F4/F5)
Layer 2 (CAPITAL):     20% — F1 P0 blind today
Layer 3 (ENTRY):       50% — F2 P0 naive, B-1+B-2 shipped
Layer 4 (MANAGEMENT):  90% — S1-S7 shipped
Layer 5 (EXIT):        80% — F3 deployed today
Layer 6 (LEARNING):    80% — suit-refresh fixed, EOD audit working
```

Overall: ~62% mature. Top blockers for ₹10L real capital: F1, F2, F5, + 30 days clean execution data.

---

## 🔄 Update protocol

1. After every shipped fix → mark in this MD + update /roadmap/ HTML
2. Every 15:30 IST market-close → review /trading/audit/ findings, prioritize next batch
3. Every Sunday → owner reviews skill% trend + next week priorities
4. Every 30 days → re-evaluate phase (paper vs real ₹10L)

Source-of-truth file. /trading/roadmap/ HTML is the visual.
