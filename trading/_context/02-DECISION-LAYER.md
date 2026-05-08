# Layer 2 — Decision Layer (wealth-verdict)

**Worker:** `wealth-engine/workers/wealth-verdict/`
**LLM tier:** Opus 4.5 (decisions) / Sonnet 4.5 (analysis) / Haiku 4.5 (extraction)
**Output:** `daily_verdicts` table — 1 row/day with picks_json, rationale, alternatives, halt rules

---

## 8 cron handlers (in `src/index.js`)

```js
case '0 2 * * 1-5': return composePreMarketBriefing(env);    // 07:30 IST
case '0 3 * * 1-5': return composeVerdict(env);              // 08:30 IST  ★ MAIN
case '*/5 * * * *':  return triageAlerts(env);               // every 5 min
case '0,15,30,45 4-9 * * 1-5': return invalidateVerdict(env); // 09:15–15:30
case '30 10 * * 1-5': return autopsyTrades(env);             // 16:00
case '0 11 * * 1-5':  return suitabilityRefresh(env);        // 16:30
case '0 13 * * 1-5':  return fireEodLearningAudit(env);      // 18:30 ⭐ NEW
case '30 3 * * 1':    return composeWeeklyReview(env);       // Mon 09:00
```

---

## A. composeVerdict (★ the brain — runs 08:30 IST daily)

### Input context built for Opus:
1. Pre-market enrichment from `composePreMarketBriefing` (US close, GIFT Nifty, Asia, breaking news)
2. Top 30 candidates from `intraday_suitability` table (HOT/STABLE regimes only, COOLING filtered)
3. Historical pattern: each candidate's **last 90-day intraday score** (R:R × green-rate × liquidity × recency)
4. Sector indices state (Nifty 50, sector rotation map)
5. FII/DII overnight flow
6. India VIX level + trend
7. Earnings calendar exclusion (skip if earnings in next 5d)
8. Open positions carried over (HELD_OVERNIGHT review at 08:30)
9. Last 5 days of paper-trade autopsies (what went right/wrong)

### Selection algorithm (engine before LLM):
```
1. Filter universe to symbols where intraday_suitability.regime IN ('HOT','STABLE')
2. Compute hybrid_score = rr_ratio × green_rate × liquidity_score × recency_factor
3. Sort by hybrid_score DESC
4. Apply sector concentration cap: max 1 pick per sector_bucket
5. Take top 5 candidates → pass to Opus
```

### Opus prompt structure:
```
SYSTEM: You are HN Wealth Engine's senior strategist. Pick 2–3 intraday breakout stocks
        for May ₹10L paper-trade. Sleep flat by 15:10. NSE EQ only. No options.

CONTEXT: [pre-market enrichment]
         [5 candidate stocks with: 90-day stats, regime, sector, last 5 autopsies]
         [open carryover positions if any]
         [sector indices, FII/DII, VIX]

OUTPUT JSON: {
  "verdict": "TRADE" | "SIT_OUT" | "OBSERVE",
  "picks": [
    { "symbol":"SBIN", "conviction":"HIGH"|"MED"|"LOW",
      "allocation_pct": 35, "entry_zone_paise": [...,...],
      "stop_pct": -1.2, "target_pct": +2.5, "rationale": "...",
      "sector_bucket": "BANK", "expected_holding_min": 90 }
  ],
  "alternatives": [...],   // not picked + why_not
  "portfolio_summary": {
    "total_deployed_paise": 950000,
    "expected_pnl_range_paise": [-12000, +28500],
    "daily_loss_limit_paise": 3000000,    // -3% of 10L (HARD HALT)
    "profit_lock_paise": 3000000          // +3% locks gains
  },
  "halt_rules": {...}
}
```

### Conviction-weighted sizing (engine post-processing):
```
HIGH    → 35% of deployable capital
MEDIUM  → 30%
LOW     → 25%
Sum is normalized so total ≤ 95% (5% buffer for slippage).
```

### LLM fallback chain:
```
Opus → if 5xx/timeout → Sonnet → if fail → Haiku → if fail → engine_only_fallback
```
Each tier has its own daily/monthly cap (paid-plan caps effectively unlimited for paper-trade phase).

### Stores:
- `daily_verdicts` (date, verdict, picks_json, alternatives_json, rationale, llm_model_used, prompt_tokens, completion_tokens)

---

## B. composePreMarketBriefing (07:30 IST)

Smaller Opus call. Output is a **context document** consumed by composeVerdict.
Sections:
- Overnight US close (Dow/SPY/Nasdaq)
- GIFT Nifty current premium/discount vs prev Nifty close
- Asia session (Nikkei, Hang Seng) directional bias
- Breaking news headlines from last 12h (top 5 with sentiment)
- FII/DII flow yesterday
- Today's earnings calendar
- Cross-asset (Crude, USD/INR, Dow futures)

Stores `pre_market_briefings` table.

---

## C. invalidateVerdict (every 15 min during market hours)

Re-runs Opus only if **material change** detected:
- One of the picks dropped > 1.5% in 15 min before entry
- News article with urgency ≥ 4 mentions a pick
- VIX spike > 18%
- Sector index moves > 0.8% against the pick

Saves new verdict version, sets `is_active = 1` on new + `is_active = 0` on old.

---

## D. triageAlerts (every 5 min, Haiku)

- Reads last 30 min of `news_articles` not yet triaged
- Haiku classifies: `IGNORE` / `WATCH` / `INVALIDATE` / `OPPORTUNITY`
- For `INVALIDATE`/`OPPORTUNITY`: writes to `alert_classifications`, fires invalidator if pick affected
- For `WATCH`: surfaces in Today UI Alerts panel

---

## E. reviewOvernightCarryovers (helper inside composeVerdict)

If yesterday left positions in `HELD_OVERNIGHT` state:
- Pulls them up first
- Asks Opus: "Hold / exit-on-open / scale-out / scale-in?"
- Outcome modifies today's `picks_json` to include the carryover handling.

---

## Cost (Anthropic API)

Approx daily spend at 5/day × 5 cron families:
- Opus: ~₹40/day (composeVerdict + invalidateVerdict + pre-market)
- Sonnet: ~₹4/day (autopsy + weekly review + EOD audit)
- Haiku: ~₹2/day (alert triage all-day)
- **Total: ~₹46/day, ~₹1,400/month**

Caps in `_lib/anthropic.js`: `DEFAULT_DAILY_CAP_PAISE = 9999999` (effectively no cap during paper-trade).

---

## Where it surfaces in UI

- `/trading/today/` Section 3 (Verdict Card) — `getVerdictToday` API
- `/trading/today/` Section 5 (Timeline) — every cron fire + decision tagged with phase
- `/trading/today/` Section 8 (EOD Audit) — Sonnet narrative on what Opus got right/wrong

---

## Open issues / future tuning

1. **Sector concentration cap** — currently hard limit 1/sector. Could relax to "max 60% in one sector"
2. **Conviction calibration** — track HIGH/MED/LOW pick win-rate divergence after 30+ trades
3. **Carryover review** — early days, no HELD_OVERNIGHT positions yet; logic untested live
4. **Pre-market brief actually consumed?** — verify composeVerdict reads briefing row, not just freshly recomputes
