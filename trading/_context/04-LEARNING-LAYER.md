# Layer 4 — Self-Learning Loop

**Goal:** Every paper-trade day improves tomorrow's picks. **No manual tuning.** Compounding skill, not luck.

---

## The 3 self-learning crons

| Time | Cron | Worker / handler | Output |
|---|---|---|---|
| 16:00 IST | `30 10 * * 1-5` | `wealth-verdict::autopsyTrades` (Sonnet) | `paper_trade_autopsies` row per closed trade |
| 16:30 IST | `0 11 * * 1-5` | `wealth-verdict::suitabilityRefresh` (engine-only) | `intraday_suitability` table fully recomputed |
| 18:30 IST | `0 13 * * 1-5` | `wealth-verdict::fireEodLearningAudit` (Sonnet) ⭐ | `eod_learning_audits` row with 4-bucket attribution |
| Mon 09:00 IST | `30 3 * * 1` | `wealth-verdict::composeWeeklyReview` (Sonnet) | `weekly_reviews` row with 5-day pattern + tuning |

---

## A. Paper-trade autopsy (16:00 IST)

For each `paper_trades` row that EXITED today:

1. Pull intraday 5-min bars between entry and exit timestamps
2. Compute deterministic stats:
   - **Slippage** at entry (entry_paise vs Kite LTP at exact entry timestamp)
   - **Max favorable excursion (MFE)** — peak gain inside the trade
   - **Max adverse excursion (MAE)** — worst drawdown inside the trade
   - **Time-to-MFE** and **time-to-MAE** (early MFE = good entry timing)
   - **Exit timing quality** — what was the post-exit move? Did we leave money?
3. Sonnet writes a 4-line narrative:
   - What happened mechanically
   - What signal was right/wrong
   - What tomorrow's verdict should adjust
   - Confidence in the lesson (1–5)

Stores in `paper_trade_autopsies` (paper_trade_id, mfe_paise, mae_paise, slippage_pct, time_to_mfe_min, narrative, lesson, lesson_confidence, model_used).

---

## B. Suitability refresh (16:30 IST)

The **universe selector**. Rebuilds `intraday_suitability` table every EOD with last 90 days of `daily_bars` + `intraday_bars`.

For each NSE EQ symbol with sufficient liquidity:

```
metrics over last 90 trading days:
  - daily_range_atr           (ATR-14 of daily ranges)
  - intraday_volatility_pct   (avg high-low / open within 09:30-15:30)
  - green_day_rate            (days where close > open)
  - rr_ratio                  (avg gain on green days / avg loss on red days)
  - liquidity_score           (median traded_value / 1cr)
  - recency_factor            (last 20 days weighted heavier than 21–90)
  - sector_bucket             (BANK, IT, AUTO, PHARMA, FMCG, METAL, ENERGY, REALTY, CHEM, INFRA, OTHERS)

regime classification:
  HOT       — high vol, high rr_ratio, recent uptrend, high liquidity
  STABLE    — moderate vol, consistent rr_ratio, decent liquidity
  COOLING   — vol declining, rr deteriorating, recent flat/down
  ILLIQUID  — exclude (filter set by liquidity_score < 0.5)
```

**Hybrid score** for ranking:
```
hybrid_score = rr_ratio × green_day_rate × log(liquidity_score+1) × recency_factor
```

Only `HOT` and `STABLE` qualify for next-day candidate pool. composeVerdict (08:30 next day) takes top 30 from this table → applies sector cap → top 5 to Opus.

---

## C. EOD Learning Audit (18:30 IST) ⭐ THE COMPOUNDING ENGINE

The **honest skill audit**. Runs after autopsy + intraday_bars EOD enrich settled.

### 4-bucket attribution per pick:

| Bucket | Definition | What it teaches |
|---|---|---|
| **RIGHT** | Picked AND won AND signal was correct (not luck) | Repeat the pattern |
| **MISSED** | Did NOT pick, but it would have won big (clear breakout, sector tailwind, strong volume) | Why didn't our universe see it? Tune scoring |
| **LEARNED** | Picked AND lost AND we can articulate why (regime shifted, news invalidated, technical broken) | Add the filter to tomorrow |
| **LUCK** | Picked AND won BUT not because of skill — random catalyst, mean reversion, lucky tape | **Discount this from skill%** |

### Skill% computation:
```
skill_pct = (RIGHT count) / (RIGHT + LEARNED + LUCK + counterfactual_MISSED)

where counterfactual_MISSED only counts misses with high_confidence_should_have_picked = true
```

### What `getEodLearningAudit()` does (in `functions/api/trading.js`):
1. Pulls today's verdict + closed paper_trades + autopsies
2. For each pick: deterministic P&L compute (entry × qty vs exit × qty, minus 0.1% impact + 0.05% slippage)
3. For each MISSED (ran a small scan of top 50 high-volatility symbols not picked, checked if any went +3% on volume): compute counterfactual P&L
4. Sonnet writes per-bucket narrative + monthly tuning suggestion
5. Stores in `eod_learning_audits` (date, picks_summary_json, buckets_json, narrative, skill_pct, tuning_suggestions_json, model_used)

### What surfaces on Today UI Section 8:
- 4 mini-cards (RIGHT / MISSED / LEARNED / LUCK) with P&L per bucket
- Skill% bar (e.g., 67% — green if > 60, yellow 40–60, red < 40)
- Sonnet narrative (3–5 paragraphs)
- Tuning suggestions checklist (e.g., "Tighten sector cap on metals" / "Add VIX > 18 filter")

---

## D. Monthly Learning Trail (Today UI Section 9)

API: `getMonthlyLearningTrail` aggregates last 30 `eod_learning_audits`:

- Cumulative P&L (paise) line
- Win rate trend (rolling 5-day)
- Recurring missed-winners (symbols that show up in MISSED bucket > 3 days)
- Recurring lost-patterns (LEARNED bucket repeats by sector / setup)
- Accumulated tuning suggestions still pending (not auto-applied — owner reviews monthly)

Shows as 30 mini-cards (date · skill% · pnl) + summary block at top.

---

## E. Weekly Review (Mon 09:00 IST)

Sonnet reads last 5 days of:
- daily_verdicts
- closed paper_trades
- eod_learning_audits

Output:
- 5-day pattern (HOT regimes that worked, did sector cap help, mode-promotion success)
- Top 3 takeaways
- 1 strategy adjustment to test next week (just suggestion — owner approves before applying)

Stores `weekly_reviews` table.

---

## How "compounding" works

```
Day 1: Pick from intraday_suitability v0 → trade → autopsy → audit → tuning suggestion
Day 2: suitability v1 has yesterday's data → picks may shift toward better-tuned candidates
Day 7: 5 audits + weekly review = first cumulative learning lens
Day 30: 22 audits + 4 weekly reviews + monthly trail. Skill% trend visible.
Day 60: Owner can decide: skill% > 55% sustained → switch from paper to real ₹10L.
```

The system **does NOT auto-apply tuning suggestions**. They are surfaced for owner review.
This is intentional — strategy-tuning is the one gate humans should still hold.

---

## Where it surfaces in UI

- `/trading/today/` Section 8 — EOD Learning Audit (today's 4 buckets + skill%)
- `/trading/today/` Section 9 — Monthly Learning Trail (30-day mini-cards + cumulative)
- `/trading/today/` Section 5 — Timeline events tagged `autopsy` / `eod_audit`

---

## Today's specific issue (May 5 — most recent context)

User reports: **"today is showing as a win but from the UI I am not able to understand how"**

Diagnosis:
- The win is buried inside Section 4 (Auto-Trader Positions header) and Section 8 (EOD Audit, which fires at 18:30)
- No prominent hero `TODAY'S P&L` card at top of Today UI
- User looks at Today during/after market hours and can't see the bottom line at a glance

**Fix shipped today (in this session):** Inserted hero P&L card above Phase Clock — see `05-UI-LAYER.md`.

## Simulator overhaul (May 5, in-session) — `simulateTradeChronological()`

**Why:** The previous `simulateTrade()` was aggregate-min/max — it didn't know whether stop or target hit FIRST in time. So a stock that went to target first then stopped out was reported as STOP_HIT (loss), corrupting the audit's directional signal. Owner caught this with the question *"is the profit calculation real, or just a random number?"*

**New semantics:**

1. **Real Opening Range (OR) compute:** OR_high = MAX of `high_paise` over first 3 bars (09:15-09:30 IST).
2. **Real breakout detection:** Walk bars in 09:30-10:30 IST window. First bar where `close_paise > OR_high × 1.001` is the entry. **If no breakout fires, returns `SKIPPED_NO_BREAKOUT` with P&L=0** — matches what the live trader would have done.
3. **Chronological exit walk:** Iterate bars after entry. First trigger by time wins:
   - `low ≤ stop_price` → STOP_HIT
   - `high ≥ target_price` → TARGET_HIT
   - `low ≤ trailing_stop` (peak × (1 - trail_pct)) → TRAIL_HIT
   - `ts ≥ 15:10 IST` → HARD_EXIT_1510 (intraday default)
4. **Realistic Zerodha intraday MIS fees:** brokerage ₹40 (capped) + STT 0.025% sell-side + exchange 0.00322% × 2 + GST 18% on (brokerage + exchange) + stamp 0.003% buy-side. Round-trip ~0.04-0.06% (vs old model's flat 0.3% one-side which overcharged 6×).

**Output now includes:**
- `simulation_quality`: `replayed_chronological` | `aggregate_idealized` (legacy) | `no_bars`
- `breakout_fired`: true/false
- `or_high_paise` / `or_low_paise`
- `entry_ts` / `exit_ts` (real timestamps)
- `peak_paise` (helps validate trailing-stop arithmetic)
- `bars_walked` (debugging helper)

**EOD audit response now also includes (at `summary` level):**
- `simulation_quality` (aggregate over all picks)
- `breakouts_fired` count
- `skipped_no_breakout` count
- `picks_with_no_bars` count
- `execution_provenance`: `replay_only` (set by audit) vs `live_execution` (set by trader path — future work)
- `fill_model`: `idealized_chronological` (no slippage yet) → next: `realistic_with_slippage`

**Hero P&L card** now shows a colored badge:
- 🟢 `LIVE` — auto-trader fired end-to-end with real Kite LTP
- 🟡 `REPLAY` — post-hoc walk against intraday tape (no live execution)
- ⚪ `NO DATA` — neither

The badge has tooltip text explaining the distinction. Skill validation should only count `LIVE` days.

**What still hasn't been fixed (P1+ in optimization roadmap):**
- Slippage modeling (entry +1 tick, stop -2 ticks)
- Strategy-parity (VIX halt, profit-lock/loss-halt portfolio gates, mode promotion)
- Live-execution provenance writing into `paper_trades.execution_provenance`
- Skill% denominator counting only LIVE days

These are P0-#5/P1/P2/P3 items in `09-RISK-ENVELOPE.md` style follow-ups; see chat history for ranked roadmap.
