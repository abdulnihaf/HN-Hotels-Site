# 🧠 Claude API Self-Learning Architecture

**Owner's framing (May 6 2026):** "The content of how this self-learns and makes itself better using the Claude API key is the key architecture. So data of everything in a schema easy to infer + the API intelligence prompting architecture across cron and time-frequency IS THE GAME."

**Bottom line:** The system isn't just "a trader with Claude calls." It's a **closed feedback loop** where every Claude call (Opus, Sonnet, Haiku) produces structured data that a LATER Claude call consumes. Quality of compounding skill = quality of this data flow.

---

## 1. Where Claude is called (every API touchpoint)

| # | Cron | When | Model | Purpose | Reads from | Writes to |
|---|---|---|---|---|---|---|
| 1 | `0 2 * * 1-5` | 07:30 IST | **Opus** | Pre-market briefing | `gift_nifty_ticks`, `fii_dii_daily`, `india_vix_ticks`, `news_items` (last 12h), `crossasset_ticks` | `daily_verdicts` (verdict_type=pre_market) |
| 2 | `0 3 * * 1-5` | 08:30 IST | **Opus** | Morning verdict (THE pick selection) | `intraday_suitability` (84 stocks), `signal_scores` top, pre_market briefing, `pick_overrides` (history) | `daily_verdicts` (verdict_type=morning, picks_json, alternatives_json, context_snapshot_json) |
| 3 | `* 4 * * 1-5` | 09:30-10:29 every 1min | **Opus** | entryDecision (per pick when continuous trigger pending) | `paper_trades` WATCHING, `news_items` (last 60min, B-2), `intraday_suitability`, `india_vix_ticks` | `trader_decisions` |
| 4 | `*/3 5-9 * * 1-5` | 10:30-15:29 every 3min | **Opus** | position_mgmt (HOLD/TIGHTEN/PARTIAL/EXIT) | `paper_trades` ENTERED, `intraday_ticks`, `news_items` (4h), `sector_indices`, `breadth_data`, `crossasset_ticks`, `option_chain_snapshot` (Nifty PCR), `intraday_suitability.stat_priors` (S1-S7) | `trader_decisions`, `paper_trades` (state transitions) |
| 5 | (between Opus 4) | every 30min market | **Sonnet** | safety check (lighter, between Opus cycles) | same as above | `trader_decisions` |
| 6 | `*/5 * * * *` | every 5min | **Haiku** | alert triage (news classification) | `news_items` not-yet-classified | `news_items.sentiment_score`, `news_items.importance_score` |
| 7 | `15 * * * *` | hourly | **Haiku** | LLM news tagger (symbols + sentiment) | `news_items` raw | `news_items.symbols_tagged`, `sentiment_score` |
| 8 | `30 10 * * 1-5` | 16:00 IST | **Sonnet** | paper-trade autopsy per closed trade | `paper_trades` EXITED today, `intraday_bars` (entry-to-exit window) | `paper_trade_autopsies` (mfe_paise, mae_paise, slippage, narrative, lesson) |
| 9 | `0 13 * * 1-5` | 18:30 IST | **Sonnet** | EOD Learning Audit ⭐ THE COMPOUNDING ENGINE | EVERYTHING from today: verdicts + paper_trades + autopsies + **`audit_findings`** (cron-detected bugs) + **`pick_overrides`** (manual interventions) + intraday_bars | `eod_learning_audits` (RIGHT/MISSED/LEARNED/LUCK + skill_pct + tuning_suggestions + override_assessment + bugs_observed) |
| 10 | `30 3 * * 1` | Mon 09:00 IST | **Sonnet** | Weekly review | last 5 days: `daily_verdicts`, `paper_trades`, `eod_learning_audits`, `audit_findings` | `weekly_reviews` (5-day pattern, takeaways, strategy_adjustment) |

**~80 Claude API calls/day** during a normal market day.

---

## 2. The compounding chain (how data flows Claude→Claude)

```
                     ┌─ DAY 1 ─────────────────────────────────┐
07:30 │ Opus pre-market brief
08:30 │ Opus morning verdict ──┐
09:30 │ range_capture          │  picks_json
09:45 │ Opus entryDecision ←───┤
10:00 │ Opus entryDecision     │
11:00 │ Opus position_mgmt ←───┘  +stat_priors from intraday_suitability
       (every 30min)               +news_items (B-2)
                                   +S1-S7 statistical exit rules
15:10 │ hard_exit_1510
16:00 │ Sonnet autopsy per trade (mfe/mae/slippage/lesson)
16:30 │ suitabilityRefresh (engine, no Claude — but rebuilds candidate pool)
18:30 │ Sonnet EOD audit  ←──────  Reads autopsies + audit_findings + pick_overrides
                                  Outputs: skill_pct, tuning_suggestions, lesson
                     └────────────────────────────────────────┘
                                   ↓
                                   ↓ feeds INTO next day
                                   ↓
                     ┌─ DAY 2 ─────────────────────────────────┐
07:30 │ Opus pre-market brief        ← reads eod_learning_audits[Day 1]
08:30 │ Opus morning verdict ←───────  +last 5 days' lessons in context
                                       +intraday_suitability v(N+1) refreshed
                                       +pick_overrides (knows owner override pattern)
                     ...
                     └────────────────────────────────────────┘

  After 7 days:
    Sonnet weekly review ← reads ALL 5 EODs + auto-suggests strategy_adjustment

  After 30 days:
    skill_pct trend visible. If >55% sustained → flip paper to ₹10L real.
```

---

## 3. The schema (what gets persisted, key columns for inference)

### `daily_verdicts` — Opus's brain output
```sql
trade_date TEXT, verdict_type TEXT (pre_market|morning|invalidator),
decision TEXT (TRADE|SIT_OUT|OBSERVE), recommended_symbol TEXT,
picks_json JSON [{symbol, weight_pct, stop_pct, target_pct, trail_pct, rationale}, ...],
alternatives_json JSON {rejected_setups:[{symbol, why_not}]},
context_snapshot_json JSON  ← THE INPUT CONTEXT OPUS SAW
   {regime, dim_health_pct, intraday_suitable_picks[], recent_concalls,
    material_filings, fii_dii, vix, sector_leaders, ...},
narrative TEXT, headline TEXT,
composed_by_model TEXT (claude-opus-4-5), cost_paise INT
```

**Inferable patterns:** Did Opus regime-classify correctly? Did dim_health degrade? Were rejected setups actually winners?

### `pick_overrides` — owner's manual interventions
```sql
trade_date TEXT, overridden_at INT,
original_picks_json JSON (what Opus picked),
new_picks_json JSON (what owner chose),
override_reason TEXT, overridden_by TEXT
```

**Inferable patterns:** When owner overrides, does owner-pick beat Opus-pick? Does override frequency correlate with low dim_health? Is owner intuition calibrated?

### `paper_trades` — execution outcomes
```sql
symbol, qty, entry_paise, stop_paise, target_paise, exit_paise, exit_reason,
trader_state (WATCHING|ENTERED|EXITED|SKIPPED|HELD_OVERNIGHT|ABANDONED),
peak_price_paise, trailing_stop_paise, strategy_mode,
auto_managed BOOL, is_active BOOL,
pnl_gross_paise, pnl_net_paise, win_loss
```

**Inferable patterns:** Hit-rate per stock × time-of-day × volume_ratio at entry × news sentiment.

### `trader_decisions` — every cron decision
```sql
ts INT, paper_trade_id INT, symbol, cron_phase, decision,
ltp_paise, snapshot_json (full ctx Opus saw at decision time),
rationale TEXT, composed_by_model TEXT, cost_paise INT
```

**Inferable patterns:** Decision quality at each cron-fire moment. Was the rationale predictive? Did Opus position_mgmt's S1-S7 rules actually fire when expected?

### `paper_trade_autopsies` — Sonnet's per-trade post-mortem
```sql
paper_trade_id, mfe_paise (max favorable), mae_paise (max adverse),
slippage_pct, time_to_mfe_min, time_to_mae_min,
narrative TEXT, lesson TEXT, lesson_confidence INT
```

**Inferable patterns:** MFE/MAE distribution → calibrate trail width. Slippage trend → realistic fee model accuracy.

### `audit_findings` — cron-detected bugs/gaps (NEW May 6)
```sql
detected_at INT, trade_date, category, severity (P0|P1|P2),
layer (SELECTION|CAPITAL|ENTRY|MANAGEMENT|EXIT|META),
signature TEXT (dedupe key), title, detail, proposed_fix,
data_json, resolved_at INT, resolved_by TEXT
```

**Inferable patterns:** System reliability over time. Most-common bug categories. Mean-time-to-detect (MTTD) per category.

### `eod_learning_audits` — Sonnet's daily verdict on the day
```sql
audit_date, picks_summary_json, buckets_json {RIGHT, MISSED, LEARNED, LUCK},
narrative TEXT, skill_pct REAL, data_quality_pct REAL (NEW),
tuning_suggestions_json, override_assessment_json (NEW),
bugs_observed_json (NEW — count of P0/P1 findings),
model_used, cost_paise
```

**Inferable patterns:** Skill% trajectory. Has the engine actually improved? Are tuning suggestions being applied?

### `weekly_reviews` — Sonnet's 5-day pattern
```sql
week_start, summary_json, top_takeaways_json, strategy_adjustments_json
```

**Inferable patterns:** Are weekly suggestions converging or diverging? Owner adoption rate of suggestions.

---

## 4. The prompting architecture (what each Claude call SEES)

### Pre-market (Opus, 07:30)
```
SYSTEM: "Summarize overnight context for the morning trading day. Output: bias (BULLISH/BEARISH/NEUTRAL), gap_direction, key_catalysts."
INPUT:  US close, GIFT Nifty, Asia close, breaking news (last 12h), FII/DII yesterday, VIX, cross-asset, today's earnings calendar
OUTPUT: { bias, gap_direction, key_catalysts, narrative }
```

### Morning verdict (Opus, 08:30) — THE pick selection
```
SYSTEM: "Pick 2-3 NSE EQ stocks for intraday paper-trade. Apply sector cap (max 1/sector), conviction-weighted sizing (HIGH=35%, MED=30%, LOW=25%). Reject if R:R < 1.8 or earnings within 5d."
INPUT:  intraday_suitability top-30 (with stat_priors + last_week regime),
        signal_scores top (current signals — F4 pending),
        pre_market briefing,
        pick_overrides last 5 days (← context on owner's tendencies),
        eod_learning_audits last 3 days (← recent lessons),
        regime, breadth, FII/DII, VIX
OUTPUT: { decision, picks[2-3] with full plan, alternatives[], halt_rules }
```

### entryDecision (Opus, 09:45/10:00/10:15) — when to fire ENTER
```
SYSTEM: "Given live LTP, OR-high, volume, AND last-60min news sentiment, decide ENTER_NOW / WAIT / ABANDON."
INPUT:  paper_trade pending, q.ltp, OR_high, volume_ratio, news (last 60min, B-2)
OUTPUT: { decision, rationale, confidence }
```

### position_mgmt (Opus, every 30min during market) — when to exit
```
SYSTEM: "Manage open positions. Use S1-S7 statistical exit rules. STAT_PRIORS win over discretionary unless news has strong catalyst override."
INPUT:  paper_trades ENTERED + stat_priors per pick + pct_of_typical_move_captured + trajectory + ist_phase + give_back_pct + news_last_4h + sector + breadth + VIX + cross_asset + Nifty_PCR
OUTPUT: { decisions[]: per_position {decision, rationale, new_trail_pct} }
```

### EOD Learning Audit (Sonnet, 18:30) — THE compounding moment
```
SYSTEM: "Audit today's paper-trade day. Distinguish skill from luck. EXCLUDE phantom exits (system bugs) from skill calc. Reference audit_findings IDs in narrative."
INPUT:  override_context, system_bugs_today (audit_findings), phantom_exits[],
        skill_eligible_trades[], rejected_setups[], universe_winners_missed[]
OUTPUT: { what_engine_RIGHT, what_engine_MISSED, what_engine_LEARNED, what_was_LUCK,
          what_was_SYSTEM_BUG (NEW), owner_override_assessment (NEW),
          tuning_suggestions[], key_lesson, engine_skill_pct,
          data_quality_pct (NEW) }
```

### Weekly review (Sonnet, Mon 09:00)
```
SYSTEM: "Read 5 days of audits. Find compounding patterns. Suggest 1 strategy adjustment for the week."
INPUT:  last 5 eod_learning_audits, last 5 daily_verdicts, last 5 paper_trades sets, audit_findings recurring
OUTPUT: { 5_day_pattern, top_3_takeaways, strategy_adjustment_test_this_week }
```

---

## 5. The "self-learning gaps" (what's BROKEN today)

| # | Gap | Impact | Fix status |
|---|---|---|---|
| **G1** | Override history wasn't preserved | EOD audit couldn't compare owner-pick vs Opus-pick | ✅ FIXED (May 6 morning) — `pick_overrides` table + EOD audit reads it |
| **G2** | audit_findings not fed to Sonnet | Sonnet wrote narratives blind to bugs the system itself observed | ✅ FIXED (May 6 morning) — system_bugs_today in EOD prompt |
| **G3** | Phantom exits corrupted skill% | Race condition residue counted as real losses | ✅ FIXED (May 6 morning) — phantom_exits[] separate from skill_eligible_trades[] |
| **G4** | Sonnet outputs not consumed by NEXT day's Opus | Daily lessons evaporated overnight | ⚠️ PARTIAL — composeVerdict prompt should include "last 3 days lessons" — pending verification |
| **G5** | tuning_suggestions never auto-applied | Compounding is owner-gated. Slow. | ⚠️ BY DESIGN. May relax for low-risk params (trail_pct, news_sentiment_threshold). |
| **G6** | data_quality_pct field new, not yet trended | Hard to know "is today's lesson trustworthy?" | ✅ FIXED (May 6 morning) — Sonnet now outputs data_quality_pct |
| **G7** | weekly_reviews never reads audit_findings | Recurring bugs (e.g., 5 days of dim_blindness) don't surface in weekly | ⚠️ PENDING — composeWeeklyReview update needed |
| **G8** | Prompt versions not tracked | Can't A/B test prompt changes — silent regressions invisible | ⚠️ PENDING — `prompt_version` column on each Claude-output table |

---

## 6. The cron timing (why it matters)

```
07:30  Pre-market   ──▶ owner reads
08:00  Pre-market readiness audit (scheduled task, owner-facing)
08:15  Owner connects Kite OAuth
08:30  Morning verdict ──▶ feeds rangeCapture
09:15  Market opens
09:30  range_capture   ──▶ creates paper_trades
09:30+ Continuous trigger (1-min)
09:45/10:00/10:15 Opus entryDecision (with news context — B-2)
10:30+ price_monitor (3-min)
11:00+ Opus position_mgmt (30-min) ◀── stat_priors + S1-S7 + news + sector + breadth
11:15+ Sonnet safety check (between Opus cycles)
14:30  Mode promotion review (SWING_CONFIRMED gate)
15:00  Final position review
15:10  hard_exit_1510  ──▶ trades close
15:30  Market close
16:00  Sonnet autopsy   ──▶ paper_trade_autopsies
16:30  suitabilityRefresh (engine, NO Claude)
18:30  Sonnet EOD audit ⭐ THE compounding moment
       (reads ALL above + audit_findings + pick_overrides)
       ──▶ eod_learning_audits + tuning_suggestions
Mon 09:00 weekly_review (Sonnet) — 5-day pattern
```

**Frequency choices are intentional:**
- Opus is expensive; called only at high-leverage moments (selection + entry/exit decisions)
- Sonnet is cheaper; runs between Opus calls + autopsy + EOD
- Haiku is cheapest; news triage + tagging
- Engine-only paths (range_capture, suitabilityRefresh) handle deterministic compute — no LLM needed

---

## 7. Cost economics

```
Daily during paper-phase (~5 trades, average day):
  Opus calls:  pre_market(1) + morning(1) + entry(3-9) + position_mgmt(9) ≈ 14-22 calls × ₹2-5/call = ~₹40
  Sonnet:      safety(8) + autopsy(3) + EOD(1) = 12 × ₹0.5 = ~₹6
  Haiku:       triage(288) + tag(24) = 312 × ₹0.05 = ~₹16
  ────────
  Total:       ~₹62/day, ~₹1,860/month during paper-trade

Daily caps in functions/api/_lib/anthropic.js:
  DEFAULT_DAILY_CAP_PAISE   = 9999999    (effectively unlimited during paper)
  Will reinstate sensible caps once skill_pct trend stabilizes
```

---

## 8. The architecture verdict (where we stand May 6)

| Layer | Maturity | Self-learning gap |
|---|---|---|
| Selection (Opus 08:30) | 70% | F4 pending: cross-ref signal_scores |
| Capital (sizing) | 20% | F1 pending: blind 30/30/30, no conviction weight |
| Entry (Opus 09:45+) | 60% | F2 pending: naive 09:31-LTP entry, no dip-and-bounce |
| Management (Opus 11:00+, S1-S7) | 90% | Just shipped May 5 evening |
| Exit (deterministic + Opus) | 80% | F3 fixed today (race condition) |
| Learning (Sonnet 18:30) | 75% | G1/G2/G3 just fixed; G4/G7/G8 pending |
| Weekly compounding | 60% | G7 pending: weekly review doesn't read audit_findings |

**Headroom:** When Layer 2 (capital) and Layer 3 (entry) reach 80%+ and self-learning gaps G4/G7/G8 close, the system should produce sustained skill% > 55% within ~30 days.

---

## 9. Update protocol (keep this doc fresh)

After each architectural change touching Claude calls or schemas:
1. Update relevant table in §1 (where Claude is called)
2. Update §3 if schema changed
3. Update §4 if prompts changed
4. Update §5 if a gap closed
5. Bump SW + commit + push

This doc IS the source-of-truth for the system's brain. Treat it that way.
