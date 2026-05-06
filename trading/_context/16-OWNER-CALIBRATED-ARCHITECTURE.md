# 🎯 Owner-Calibrated Architecture — The 4 Intelligence Layers

**Owner's framing (May 6 2026, mid-trading at 12:50 IST):**

> "The only reason I am doing this is betting on my ability to build a successful solution using Claude Code. So if there are any gaps you need to find them — I am purely focusing on an objective and trying to give you all the means you need to achieve that. The context here is me being exactly clear in the direction and exactly what I want. This will exactly guide you to use all your capability in a targeted rather than scattered way."

**This document is the master strategic frame.** Every Claude prompt, every cron, every UI panel, every line of code MUST trace back to one of the principles in this doc.

---

## ⭐ Section A — The strategic meta-frame

```
┌─────────────────────────────────────────────────────────────────┐
│  REAL OBJECTIVE: validate Claude Code as a solution-builder     │
│  by demonstrating it can build a profitable autonomous system   │
│                                                                 │
│  Trading is the proving ground.                                 │
│  Same architectural rigor would apply to any complex domain.    │
│                                                                 │
│  TRADING OBJECTIVE: daily ₹30,000 profit on ₹10L paper-trade    │
│  → validate skill% > 55% sustained                              │
│  → flip to ₹10L real capital                                    │
│  → eventually scale (₹50L, ₹1Cr) once proven                    │
└─────────────────────────────────────────────────────────────────┘
```

**Why this matters for every decision:** Owner provides **direction + means**. Claude must use **full capability targeted, not scattered**. Every gap is a Claude-Code-credibility test. **Honesty > comfort.**

---

## Section B — Owner's risk philosophy (NEW — must encode)

### Principle 1: AVOID PANIC-SELL SETUPS
> "Pick a stock which is highly less probable to lose money on an intraday trade. This way there is no scenario of panic sell when there is a dip which might go up, but I don't want that risk."

**Implementation:**
- L1 picker MUST add a "low-loss-probability score" to ranking
- Formula candidate: `(1 - hit_neg_2pct_rate_90d) × (1 / abs(avg_open_to_low_pct_90d))`
- Picks with `avg_open_to_low_pct < -3%` get HEAVY penalty
- Even high-upside stocks get rejected if downside risk too wide for owner's psychology

### Principle 2: PROFIT LOCKING WITH CONVICTION GATE
> "On a ₹10,00,000 deployment I want to safely exit with ₹10,30,000. So only if the probability of going above ₹30,000 is extremely high (very sure), is when the position is held only on that stock where you feel it can increase more."

**Implementation:**
- Default behavior at portfolio +₹30K = **FORCE EXIT all positions**
- Extension only when:
  - Opus position_mgmt explicitly upgrades the position
  - Citing 90d `avg_open_to_high_pct > 4%` AND last-week regime strong
  - AND multi-timeframe alignment confirms continuation
  - AND no negative news in last 30 min
- Each ₹10K of additional upside requires **escalating conviction** — not the same threshold

**Current gap:** `PROFIT_LOCK_PAISE = 3000000` (3M paise = ₹30K) currently TIGHTENS trails to entry+1%. It does NOT force exit. Tonight's fix: change to FORCE EXIT default + make extension explicit Opus action.

### Principle 3: DON'T HOLD OVERNIGHT UNLESS CERTAIN
Already encoded in S1-S7 (HOLD_OVERNIGHT requires 6 gates). No change needed.

---

## Section C — The 4 Intelligence Layers (every Opus call must master)

```
┌───────────────────────────────────────────────────────────────┐
│  L1: PICK THE STOCK                                           │
│  Question: which stock has lowest intraday-loss probability?  │
│  Owner priority: HIGHEST (wrong pick = loss regardless of L2-4)│
└───────────────────────────────────────────────────────────────┘
                       ↓
┌───────────────────────────────────────────────────────────────┐
│  L2: HOW MUCH CAPITAL                                         │
│  Question: how to weight ₹10L across N picks?                 │
│  Owner priority: HIGH (right pick + wrong size = still loss)  │
└───────────────────────────────────────────────────────────────┘
                       ↓
┌───────────────────────────────────────────────────────────────┐
│  L3: ENTRY TIMING                                             │
│  Question: WHEN exactly to fire the trade — second by second  │
│  Owner priority: HIGH (prices fluctuate in seconds)            │
└───────────────────────────────────────────────────────────────┘
                       ↓
┌───────────────────────────────────────────────────────────────┐
│  L4: EXIT INTELLIGENCE                                        │
│  Question: when/how to exit — default ₹30K force-exit         │
│  Owner priority: HIGH (the ₹30K lock + ₹50K extension gate)   │
└───────────────────────────────────────────────────────────────┘
```

### L1 — Picking the Stock

**Current engine:** `intraday_suitability` filter (90d) → top-30 by hybrid_score → sector cap → top-5 to Opus.

**Current optimization:** Upside (`hit_2pct_rate ≥ 50%`, `avg_open_to_high_pct ≥ 1.5%`).

**OWNER GAP:** Engine doesn't explicitly optimize for **DOWNSIDE RESISTANCE**. A stock with 80% hit-2% upside but also -4% avg-open-to-low is HIGH downside risk and shouldn't pass owner's filter.

**Tonight's fix (F-L1):**
```sql
-- New score for ranking (added to existing intraday_suitability)
loss_resistance_score = 
  ROUND(
    (100 - LEAST(100, hit_neg_2pct_rate * 100)) * 0.4 +  -- low neg-2% hit rate weighted high
    (100 / (1 + abs(avg_open_to_low_pct))) * 0.4 +        -- shallow avg-open-to-low weighted high
    (green_close_rate) * 0.2,                              -- consistency weighted moderate
    1
  )

-- Composite ranking for owner-calibrated picks:
owner_score = intraday_score × 0.6 + loss_resistance_score × 0.4
```

Picks now optimize for both upside potential AND downside resistance, weighted 60/40.

### L2 — Capital Weightage

**Current engine:** F1 not yet implemented — blind 30/30/30.

**OWNER GAP:** Needs combined upside-conviction × downside-resistance × recent-regime score.

**Tonight's fix (F1 v2 — now owner-calibrated):**
```js
// For each pick:
const upside_conviction = stat_priors.hit_2pct_rate × stat_priors.avg_open_to_high_pct;
const downside_resistance = (1 - stat_priors.hit_neg_2pct_rate) × (1 / abs(stat_priors.avg_open_to_low_pct));
const recent_regime = stat_priors.hit_2pct_last_week × stat_priors.green_close_last_week;
const composite_conviction = upside_conviction × downside_resistance × recent_regime;

// Normalize across picks, allocate weights:
//   Top conviction:    40-50% capital
//   Mid conviction:    25-30% capital
//   Bottom conviction: 15-20% capital
//   NEVER equal split
```

Today's case: HFCL had highest `composite_conviction` (low downside + strong recent regime). Would have been 45-50% allocation, not 30%. That alone would have changed outcome materially.

### L3 — Entry Timing Intelligence

**Current engine:** range_capture at 09:30 → continuous breakout-trigger every 1min → Opus entryDecision at 09:45/10:00/10:15. Uses 09:31 LTP as entry estimate.

**OWNER GAP:** Naive — fires on first breakout above OR-high. Doesn't wait for "cleanest" entry.

**Owner's framing:** "Prices fluctuate in seconds, is there an intelligence behind exact entry timing?"

**Tonight's fix candidate (F2 — but HIGH risk):**

3-stage surgical entry:
```
Stage 1 (09:15-09:30): Observe opening range. Capture OR-high, OR-low, OR-volume.
Stage 2 (09:30-10:00): Wait for FIRST DIP. Let price test below OR-midpoint.
                       Confirm dip-bounce (last 2 bars close higher than previous low).
Stage 3 (above-bounce): Place entry just above the DIP-LOW.
                       Stop = dip-low − ATR-buffer (NOT entry × 0.988)
                       Target = entry + 2.5×R (R = entry-to-stop distance)
```

Effect: if the 3-stage entry doesn't trigger (no dip + bounce confirmed), position is SKIPPED. Better to skip than enter at the wrong moment.

**Risk:** New code path. Cannot validate without paper-day testing. **Defer to weekend** unless owner accepts pre-validation deploy.

### L4 — Exit Intelligence

**Current engine:** S1-S7 statistical rules + trailing stop + partial exit at first target + hard exit 15:10. Profit-lock at +₹30K tightens trails (does NOT force exit).

**OWNER GAP:** Default at +₹30K should be FORCE EXIT, with extension only on explicit Opus upgrade citing 90d typical_max > current_gain × 1.5.

**Tonight's fix (F-L4-LOCK):**
```js
// In wealth-trader priceMonitor:
if (portfolioPnL >= PROFIT_LOCK_PAISE) {
  // Check if any position has Opus extension flag (set by position_mgmt)
  const hasOpusExtension = positions.some(p => p.opus_extension_until > Date.now());
  
  if (!hasOpusExtension) {
    // FORCE EXIT all positions — owner's default profit-lock rule
    for (const p of activePositions) {
      await firePaperExit(db, p, currentLtp, 'PROFIT_LOCK_FORCE_EXIT');
    }
    // Halt new entries for the day
    await markPortfolioHalted(db, 'profit_lock_30k');
  } else {
    // Some position has Opus extension — keep those, exit others
    for (const p of activePositions) {
      if (p.opus_extension_until <= Date.now()) {
        await firePaperExit(db, p, currentLtp, 'PROFIT_LOCK_NON_EXTENDED');
      }
    }
  }
}
```

Plus update Opus position_mgmt prompt:
```
RULE NEW: If portfolio_pnl ≥ +₹30K, your default is FORCE_EXIT all positions
unless you EXPLICITLY upgrade with EXTEND_PROFIT citing:
  - stat_priors.avg_open_to_high_pct > 4% AND
  - hit_3pct_rate_90d > 30% AND
  - last-week green_close > 3 of 5 days AND
  - mtf_alignment = 'aligned_up'
Output { decision: "EXTEND_PROFIT", extend_until_min: 30, target_paise: ... }
```

---

## Section D — Today's calibration lesson (honest, hard data)

```
12:50 IST live data:
  Owner override (DEEDEV/AGIIL/STLTECH):  ~−₹7,861 (was −₹30K earlier intraday)
  Opus original (TDPOWERSYS/HFCL/AEROFLEX): +₹12,000 (was +₹30K earlier)
  Delta: −₹20,000 owner vs Opus
  
  Specifically: HFCL +6.7% intraday = +₹20,108 hypothetical.
  HFCL had avg_up_last_week 5.81% (vs 90d 2.98%) — recently HOT.
```

**What owner did right:** Methodology was data-driven (top intraday_score). Not emotional. Reasoned argument about sector cap.

**What engine understood better:** Recency weighting. Last-week regime was the dominant signal today. HFCL's 5.81% avg-up last week beat the 90d-rank ordering.

**Calibration:** Owner intuition is methodologically sound but lacks recency weighting. Engine has it via `stat_priors`. Going forward, when overriding, owner should consciously consider recent-week signal.

**Auto-detection planned:** counter `opus_recency_outperformed_owner_lock_to_90d`. After 5+ such days, profile auto-suggests "trust last-week signal more in override decisions."

---

## Section E — Tonight's deep audit plan (post-market, before EOD Sonnet at 18:30)

### 15:30 IST — Market closes. Begin deep-audit session.

### 15:30-16:30 — DATA COLLECTION
- Run scripts/sync-trading-docs.js (refresh _context auto-sections)
- Pull full /api/trading?action=ops_audit_today JSON for May 6
- Pull full /api/trading?action=trade_comparison for full-day reconciliation
- Query D1 for: trader_decisions, audit_findings, paper_trades, daily_verdicts (today's)
- Save snapshot to data/snapshots/2026-05-06-deep-audit.json

### 16:30-17:30 — ARCHITECTURE FIXES (4 layer priorities)

Priority 1: **L4 force-exit at ₹30K** (highest leverage, lowest risk — owner's explicit rule)
  - Update wealth-trader priceMonitor (~30 lines)
  - Update Opus position_mgmt prompt (~20 lines)
  - Deploy + verify with manual /run/

Priority 2: **L2 conviction-weighted capital** (F1 v2 with downside-resistance)
  - Update wealth-verdict composeVerdict prompt (~40 lines)
  - Update Opus prompt to require explicit weight rationale
  - Deploy

Priority 3: **L1 picker downside-resistance score** (~50 lines SQL + selection logic)
  - Add `loss_resistance_score` column to intraday_suitability
  - Update suitabilityRefresh INSERT
  - Update composeVerdict to use composite score
  - Deploy

Priority 4 (DEFER): **L3 dip-bounce entry** — needs paper-day validation, defer to weekend.

### 17:30-18:00 — F-PERS WIRE-UP
- Wire owner_profile_v2 into 4 Opus prompts (composeVerdict, entryDecision, position_mgmt, EOD audit)
- Test: force-recompose verdict tomorrow morning, verify Opus narrative respects owner profile

### 18:30 IST — EOD Learning Audit (Sonnet auto-fires)
With all the above shipped, Sonnet now sees:
- override_context (today's loss reality)
- system_bugs_today (race condition residue)
- phantom_exits[] (separate from skill_eligible)
- owner_profile_v2 (the new ₹30K rule + risk philosophy)

Output expected:
- Honest skill% (probably very low for today given overrides + bugs)
- Override assessment (definitively negative today)
- Tuning suggestions targeting L1/L2/L4 gaps

### 19:00-20:00 — REVIEW + DOCUMENTATION
- Read EOD audit output
- Update this doc + ROADMAP with what fired
- Plan tomorrow's morning verdict criteria

---

## Section F — Where I (Claude) need to be EXTRA CAREFUL

```
1. ⛔ Don't suppress owner intuition wholesale
   Today's override was reasoned, not emotional. Future calibration must
   distinguish reasoned-override from emotional-override.

2. ⛔ Don't let auto-extend corrupt skill%
   Profit-lock extension by Opus → if extension fails → that's a SKILL
   deduction, not LUCK. Track carefully in EOD attribution.

3. ⛔ Don't ship L3 changes without paper-day validation
   F2 (3-stage entry) is HIGH risk. Need at least 1 paper-day of testing
   before going live. Never deploy mid-trade.

4. ⛔ Don't conflate 1-day data with calibration
   Today is 1 data point. High noise. Multi-day pattern needed before
   updating principles. Profile updates should happen weekly, not daily.

5. ⛔ Don't bury bad news
   Owner is busy + worried about outcome. Always surface honest
   assessment FIRST, then options. The override-loss today must be
   acknowledged plainly, not buried.

6. ⛔ Don't ship without owner's risk principles encoded
   Every fix tonight must pass the test: "does this respect avoid-panic-
   sell + ₹30K-default-exit + ₹50K-extension-gate?"

7. ⛔ Don't treat trading as separate from solution-building
   This is a Claude Code capability test. Same rigor would apply to any
   complex domain. Don't take shortcuts because "it's just trading."
```

---

## Section G — What owner is aware of in current flow

Based on chat trail since May 5 evening, owner is aware of:

✓ Pages, today, execute, ops, compare, audit, roadmap pages all live  
✓ Watchlist component shared across today/execute  
✓ Hero P&L card shows LIVE/REPLAY/NO-DATA badge  
✓ EOD audit fires 18:30 IST  
✓ Statistical exit rules S1-S7 are active  
✓ B-1 safety net for range_capture  
✓ B-2 news context for entry decisions  
✓ Today's verdict was overridden manually at 09:11 IST  
✓ Race condition F3 was fixed  
✓ intraday_suitability bug was fixed (F-SUIT)  
✓ Audit scanner cron runs every 15 min during market  
✓ pick_overrides table preserves history  
✓ owner_profile v1 was inserted (now v2)  
✓ /trading/compare/ now serves complete live LTP via Kite-direct fallback  

What owner may NOT be aware of yet:

⚠ owner_profile is NOT yet read by Opus prompts (F-PERS pending tonight)  
⚠ Profit-lock at +₹30K currently TIGHTENS trails, doesn't FORCE EXIT (F-L4-LOCK pending)  
⚠ Capital allocation is still BLIND 30/30/30 (F1 v2 pending)  
⚠ L1 picker doesn't optimize for downside-resistance yet (F-L1 pending)  
⚠ Today's specific learnings will only become formal "rules" after EOD audit at 18:30  

---

## Section H — Update protocol

This doc + owner_profile + ROADMAP form the strategic master.

**When to update this doc:**
1. Owner explicitly states new principle (like today's ₹30K rule)
2. Multi-day pattern reveals calibration shift
3. Major architecture layer matures (L1/L2/L3/L4 maturity meter changes)
4. Phase transition (paper → real, ₹10L → ₹50L → ₹1Cr)

**Versioning:**
- This doc is timestamped per-update
- owner_profile is SQL-versioned (v1 → v2 → ...)
- Old versions kept for audit trail (`is_active=0`)

This is the single file Opus's prompts will reference at each call (after F-PERS).
