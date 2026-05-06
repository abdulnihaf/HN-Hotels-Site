# 🧠 Personalization Layer — The Owner Knowledge Graph

**Owner's framing (May 6 2026):**
> "Understanding ME, what is my context of stock trading, how am I communicating with you, how much is the knowledge of mine in the stock market. I am purely thinking from a logical reasoning point of view with no technical knowledge because I don't want to get into it. My objective is to make a daily profit.
> Deeply analysing the chat from the very beginning and how we arrived at the final stage we are and exactly how am I inferring things which might right or wrong but this gives you deep understanding of how I am operating. Understanding the gap of my knowledge and filling that in the self-learning and execution. So along with the layer of external which derives the profit, the personalised layer of how I am is also important."

This document defines the **second self-learning layer**: not the market, but the OWNER. The system reads market data AND owner data, fuses both, and tunes itself per-owner.

---

## 1. Two layers of self-learning

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL LAYER (market)                       │
│  90d daily_bars + 30d intraday_bars + signal_scores +            │
│  news_items + macro + options + breadth + cross_asset            │
│  → Opus picks 2-3 stocks                                         │
│  → wealth-trader executes                                        │
│  → Sonnet writes EOD audit                                       │
└─────────────────────────────────────────────────────────────────┘
                          ⇡ informs ⇣
┌─────────────────────────────────────────────────────────────────┐
│                   PERSONALIZATION LAYER (owner)                  │
│  owner_profile (knowledge level, communication style, decision   │
│  principles, anti-patterns, knowledge gaps)                      │
│  + personalization_observations (every interaction-worthy event) │
│  + pick_overrides (when did owner intuition beat/lose to Opus)   │
│  → Tunes Opus prompts ("explain in business terms, not technical")│
│  → Tunes pick filters ("owner won't engage with options/derivs") │
│  → Tunes UI ("observable structure, no blind execution")         │
└─────────────────────────────────────────────────────────────────┘
```

Without the personalization layer, the system is generic. With it, the system becomes **Nihaf's trading platform** — calibrated to his style, knowledge, communication, fund size.

---

## 2. Schema (what's persisted)

### `owner_profile`
Versioned JSON document. Captured manually + extracted from chat + auto-derived from observations.

```sql
CREATE TABLE owner_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,         -- v1 today, v2 next major change
  captured_at INTEGER NOT NULL,
  profile_json TEXT NOT NULL,       -- full JSON below
  source TEXT,                      -- 'manual_extraction' | 'auto_derived' | 'merge'
  is_active INTEGER DEFAULT 1
);
```

**profile_json structure (v1, May 6 2026):**
```
{
  owner_name: "Nihaf",
  objective: { primary: "Daily profit", explicit_quote, secondary[], phase },
  knowledge_level: { self_assessment, explicit_quote, implication, anti_pattern, correct_pattern },
  communication_style: { speed_pattern, typo_pattern, decision_pattern, feedback_pattern, praise_pattern },
  decision_principles: { architect_dont_ask, no_blind_execution, dont_break_what_works,
                         intraday_only_for_now, owner_intuition_can_override },
  trading_style: { preferred_horizon, risk_tolerance, favored_metrics, disliked_metrics,
                   trade_frequency_preference, exit_philosophy },
  operational_pattern: { daily_routine, manual_intervention_threshold, trust_level_today,
                         fund_size_current, fund_size_target_after_validation },
  knowledge_gaps_to_fill: [...],
  anti_patterns_to_avoid: [...],
  communication_to_use_in_prompts_to_owner: { tone, explain_picks_as, explain_exits_as, explain_bugs_as },
  stated_long_term_vision: "..."
}
```

### `personalization_observations`
Append-only log of every interaction-worthy signal.

```sql
CREATE TABLE personalization_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at INTEGER NOT NULL,
  trade_date TEXT,
  category TEXT NOT NULL,           -- OBJECTIVE | KNOWLEDGE_LEVEL | DECISION_PRINCIPLE
                                    -- TRADING_STYLE | INTERVENTION | KNOWLEDGE_GAP
                                    -- COMMUNICATION | CONFIDENCE_PATTERN | OPS_PREFERENCE
  signal TEXT NOT NULL,             -- short slug (architect_dont_ask, no_technical_jargon, ...)
  evidence TEXT,                    -- direct quote OR description of observed behavior
  confidence REAL,                  -- 0-1, how strongly this signal is established
  source TEXT                       -- 'chat_quote' | 'pattern_observation' | 'pick_override_log' | etc
);
```

### `pick_overrides` (already shipped)
Tracks when owner manually replaces Opus picks → critical for owner-vs-Opus calibration.

---

## 3. How the personalization fires (at each Claude call)

### Morning verdict (Opus, 08:30 IST)
**Without personalization:** Opus picks based on data + sector cap.

**With personalization:**
```
SYSTEM: "...You are picking for owner Nihaf. His profile:
- Objective: daily profit (NOT swing/positional)
- Knowledge: logical reasoning, NO technical knowledge (rationale must avoid jargon)
- Last 5 days: owner overrode 1 of 5 days (today, citing 90d-rank > recent-regime)
- Override outcome: [pending tonight's audit]
- Knowledge gap: hasn't grokked sector classification yet
- Anti-pattern: don't lecture on candlestick/MACD/RSI
- Trade freq: prefers 2-3 picks/day, selective

Calibrate picks accordingly: business-logic rationale only, intraday-only horizon,
favor stocks with clear 90d hit-rate over esoteric setups."
```

### entryDecision (Opus, 09:45/10:00/10:15 IST)
**With personalization:**
```
SYSTEM: "When deciding ENTER_NOW vs WAIT, factor owner's confidence pattern:
- Owner is confident when data supports decision (today's 09:11 override at high speed)
- Owner is hesitant when explanation is technical
- ABANDON rationale must be 1-sentence business reasoning ('news invalidated thesis')
  NOT chart-pattern reasoning ('shooting star at resistance')."
```

### EOD audit (Sonnet, 18:30 IST)
**With personalization:**
```
SYSTEM: "Audit today + check owner-pattern calibration:
- If owner overrode today, did override beat Opus's counterfactual? (data: pick_overrides)
- If owner intervention frequency rising, dim_health may be too low (re-prioritize F5)
- Use language owner uses: 'business reasoning', NOT 'technical signal'
- Explain bugs in 1 line + 1-line fix (owner's preferred format from this chat)"
```

### Weekly review (Sonnet, Mon 09:00 IST)
**With personalization:**
```
SYSTEM: "Review last 5 days. Specifically:
- How many overrides happened? Did they beat Opus?
- Owner's confidence trend (intervention frequency × data quality)
- Knowledge gaps still open? (each unresolved gap = Opus prompt enhancement candidate)
- Did engine address the items in last week's tuning_suggestions?"
```

---

## 4. Auto-derivation of profile updates (the feedback loop)

**Daily, post-EOD audit (~19:00 IST):** A new cron should scan today's events and propose profile updates:

```
auto-derive logic:
  IF override_count_last_5d > 2 AND avg_override_outperformance > 0:
    → tag: owner_intuition_calibrated_high
    → action: relax composeVerdict, give owner more leeway
  
  IF dim_health stayed <50% for 3+ days:
    → tag: data_quality_persistently_degraded  
    → action: composeVerdict prompt note "data degraded, recommend conservative picks"
  
  IF owner asked >2 'why?' questions about same topic:
    → tag: persistent_knowledge_gap_<topic>
    → action: future Opus rationale must explicitly address that topic
  
  IF owner phrasing pattern shifts (longer messages, fewer typos, more questions):
    → tag: owner_in_strategic_mode (vs trading_mode)
    → action: Opus should be more verbose + thorough
```

Output: a draft v(N+1) of `owner_profile`. Owner reviews + accepts → becomes new active version.

---

## 5. Historical replay — "1 day = 21 years" architecture

**Owner's framing:**
> "If you extract data exactly in the format you want and run your theory on that data to see the accuracy."

This is the **simulation layer**. Same strategy, run against last 250 trading days (~1 year) of equity_eod + intraday_bars.

### `historical_strategy_replay` (proposed table)
```sql
CREATE TABLE historical_strategy_replay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,             -- UUID for each replay run
  strategy_spec_json TEXT NOT NULL, -- {opus_prompt_version, capital_pct_rule, stop_pct, target_pct, trail_pct, sector_cap, ...}
  replay_date TEXT NOT NULL,        -- the historical day being simulated
  picks_json TEXT,                  -- what Opus would have picked using same rules
  outcomes_json TEXT,               -- per-pick: would-have-entered / -hit-target / -stopped
  net_pnl_paise INTEGER,
  skill_eligible_count INTEGER,
  data_quality_pct REAL,
  computed_at INTEGER
);
```

### How it would work
1. Owner pushes "Run replay: last 250 days with current strategy spec"
2. For each day in last 250:
   - Pull that day's intraday_suitability snapshot (or recompute from equity_eod)
   - Pull that day's news_items + dim_health + signal_scores
   - Run a SIMULATED Opus prompt (cheaper Sonnet for cost) → get picks
   - Run simulator (already shipped: simulateTradeChronological) on intraday_bars
   - Compute net_pnl_paise + skill_eligible_count
3. Aggregate: equity curve, win rate, regime breakdown, top 10 winners/losers

### What it tells you
```
"With current strategy, hypothetical performance over last 250 trading days:
   total P&L: ₹X,XX,XXX (paise)
   win rate:  XX%
   skill_pct trend: ascending/flat/descending
   regime breakdown: HOT 35% (skill 67%) · STABLE 50% (skill 51%) · COOLING 15% (skill 32%)
   top failure mode: [most-common LEARNED bucket pattern]
   recommended tuning: [3 highest-leverage adjustments]"
```

That's "21 years in 1 day" — turns paper-phase 5-30 days into 250-day backtest.

**Effort:** ~200 lines new endpoint + UI. ~3 hours work. **Defer to weekend** — need the foundation (current self-learning) solid first.

---

## 6. The personalization read-cycle (what Opus sees today)

**Right NOW (May 6 morning), composeVerdict at 08:30 IST does NOT read owner_profile.** That's the next wire-up. Until then, personalization layer exists but isn't fed to Opus.

**Tonight (post-market) — F-PERS:** Update composeVerdict to include `owner_context = SELECT profile_json FROM owner_profile WHERE is_active=1` in the system prompt. Same for autopsy + EOD audit.

```js
// Pseudo for composeVerdict update tonight:
const profile = await db.prepare(
  `SELECT profile_json FROM owner_profile WHERE is_active=1 ORDER BY version DESC LIMIT 1`
).first();
const ownerCtx = profile ? JSON.parse(profile.profile_json) : null;
if (ownerCtx) {
  systemPrompt += `\n\n═══ OWNER CONTEXT ═══\n${JSON.stringify({
    objective: ownerCtx.objective.primary,
    knowledge_level: ownerCtx.knowledge_level.self_assessment,
    communication_style: ownerCtx.knowledge_level.correct_pattern,
    anti_patterns: ownerCtx.anti_patterns_to_avoid,
    knowledge_gaps: ownerCtx.knowledge_gaps_to_fill,
  }, null, 2)}\n\nPick + explain in language and frame that respects this profile.`;
}
```

**Then EVERY Opus pick respects:**
- Business-language rationale (no technical jargon)
- Intraday-only horizon
- 2-3 picks max (selective)
- Knowledge gaps proactively addressed

---

## 7. Update protocol

**Profile is updated when:**
1. Owner explicitly states preference shift (e.g., "switching to swing-trade")
2. Auto-derivation detects pattern change (override frequency, knowledge-gap closure)
3. Major market regime shift requires risk tolerance recalibration
4. Fund size changes (₹10L paper → ₹10L real → ₹50L real)

**Versioning:**
- Each material change = new version
- Old versions kept (is_active=0) for audit trail
- Opus reads ONLY active version

**Observations always append.** Never delete. They form the historical record of "how Nihaf operated."

---

## 8. Why this matters for the ₹10L → real-capital decision

When skill_pct sustained > 55% for 30 days, the question isn't "is the engine accurate?" — it's "is the ENGINE accurate FOR NIHAF?"

A generic engine averaging 55% skill might be 40% on Nihaf's intraday-only frame because it includes swing-trade patterns. The personalized engine separates "skill the engine has" from "skill the engine has when calibrated to Nihaf."

That's the single most important differentiator for a ₹10L deployment decision.

---

## 9. Current state (May 6 2026 morning)

```
✅ owner_profile table created + v1 inserted (5,693 bytes)
✅ personalization_observations table created
✅ 12 observations backfilled from this chat
✅ pick_overrides table populated for today
⚠️ composeVerdict not yet reading profile (F-PERS pending tonight)
⚠️ Auto-derivation cron not yet shipped (queue for tomorrow)
⚠️ historical_strategy_replay not yet built (defer to weekend)
```

**Tonight's priority:** wire profile read into 4 Opus prompts (verdict, entry, position_mgmt, weekly review). 1-hour work. Owner's profile starts steering decisions tomorrow morning.
