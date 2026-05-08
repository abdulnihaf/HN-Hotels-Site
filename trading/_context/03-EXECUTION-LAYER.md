# Layer 3 — Execution Layer (wealth-trader)

**Worker:** `wealth-engine/workers/wealth-trader/`
**Job:** Take Opus's morning picks → watch breakout → enter → manage → exit by 15:10. Fully autonomous.

---

## State machine (per pick)

```
WATCHING (08:30-ish)
   │
   │ breakout: LTP > OR_high × 1.001 AND volume_ratio ≥ 0.8
   ▼
ENTERED (09:30-ish)
   │
   ├──► hits stop / trailing-stop hit / 15:10 hard exit ──► EXITED
   │
   └──► strategy_mode promoted to SWING_CONFIRMED + held past 15:10 ──► HELD_OVERNIGHT
                                                                              │
                                                                              ▼
                                                                       (next-day open: review)
```

Other terminal states:
- `SKIPPED` — Opus picked but breakout didn't fire by 10:30 IST cutoff
- `ABANDONED` — entry attempted but order rejected or context invalidated mid-watch

---

## Strategy modes (dynamic)

| Mode | Trail % | Promotion trigger | Exit by 15:10? |
|---|---|---|---|
| `INTRADAY_DEFAULT` | 0.8% trail | (default at entry) | ✅ Yes |
| `SWING_CANDIDATE` | 1.5% trail | LTP > entry + 1.5% AND in last hour AND momentum continues | ✅ Yes (mode review at 15:00) |
| `SWING_CONFIRMED` | 2.0% trail | LTP > entry + 2.5% in last 30 min + Opus position_mgmt approves | ❌ Hold past 15:10 |
| `HELD_OVERNIGHT` | 2.0% trail | (terminal — sleeps with position) | (next day) |

Promotion is gated by Opus position_mgmt LLM call to avoid over-promoting on noise.

---

## Cron schedule

```toml
# Pre-market range-capture from premarket signals (08:30→09:15)
"*/15 3 * * 1-5"

# Breakout entry window (09:30→10:30 IST = 04:00→04:59 UTC) — every minute
"* 4 * * 1-5"

# Active monitor 10:30→15:30 IST (= 05:00→09:59 UTC) — every 3 min
"*/3 5-9 * * 1-5"

# Post-market (16:00→17:00 IST) — settle EXITED + autopsy prep
"*/5 10 * * 1-5"
```

Removed `*/5 3-10 * * 1-5` (was redundant catch-all overlap).

---

## Each tick does

```js
async function tick(env) {
  const positions = await getOpenAutoPositions(env);   // WATCHING + ENTERED
  const ist_phase = computePhase(now);                  // pre-market | entry | active | close
  const intradayContext = await buildLiveContext(env);  // sector indices, breadth, VIX, PCR

  for (const p of positions) {
    if (p.trader_state === 'WATCHING') {
      await checkBreakout(env, p, intradayContext);
    } else if (p.trader_state === 'ENTERED') {
      await managePosition(env, p, intradayContext);
    }
  }

  if (ist_phase === 'hard_exit_window' /* 15:10 */) {
    await squareOffAll(env);   // skips SWING_CONFIRMED + HELD_OVERNIGHT
  }
}
```

---

## checkBreakout (entry logic)

1. Pull last 15-min of OHLC for symbol from `intraday_bars`
2. Compute `OR_high` = max(high) of first 15-min window (09:15–09:30)
3. If LTP > OR_high × 1.001 (0.1% breakout buffer) **AND** current 5-min volume ratio ≥ 0.8 of 20-day avg-of-first-15-min volume:
   - Compute qty: `floor(allocation_paise / LTP)`
   - Compute stop_paise: `LTP × (1 + stop_pct/100)` (stop_pct is negative)
   - Compute target_paise: `LTP × (1 + target_pct/100)`
   - Insert/update paper_trades row: `entry_paise=LTP, qty, stop, target, peak_price=LTP, trader_state='ENTERED'`
   - Log decision in `trader_decisions` (cron_phase, decision='ENTER', rationale, snapshot_json)

If breakout doesn't fire by 10:30 IST → mark as `SKIPPED`, drop from active set.

---

## managePosition (post-entry MTM)

1. Pull live LTP for symbol
2. Update `peak_price_paise = MAX(peak, LTP)`
3. Compute trailing_stop:
   - If LTP < entry → trail stays at entry stop
   - If LTP ≥ entry: `trailing_stop = peak × (1 - trail_pct/100)`
4. Exit conditions (in order):
   - `LTP ≤ trailing_stop` → EXIT (reason: TRAIL_HIT)
   - `LTP ≤ stop_paise` → EXIT (reason: HARD_STOP)
   - `LTP ≥ target_paise` → EXIT (reason: TARGET_HIT)
   - Phase = hard_exit AND mode != SWING_CONFIRMED → EXIT (reason: HARD_15:10)
5. Mode promotion check (every 5 ticks):
   - If gain > 1.5% and time > 14:00 → propose SWING_CANDIDATE
   - If gain > 2.5% and time > 14:30 → ask Opus to confirm SWING_CONFIRMED
6. Profit-lock check (portfolio level):
   - If total_realized + total_unrealized ≥ +₹30,000 → exit all, halt new entries
   - If total_realized + total_unrealized ≤ -₹30,000 → exit all, halt new entries

---

## Live context fed to Opus position_mgmt

```js
{
  current_phase: 'active_monitor',
  ist_time: '14:08',
  positions: [{ symbol, state, entry_paise, ltp, pnl_pct, peak, trail, time_in_trade_min }],
  intraday_context: {
    nifty_change_pct, banknifty_change_pct,
    sector_index_for_pick: { name: 'NIFTY BANK', change_pct: +0.4 },
    advance_decline_ratio,
    india_vix, vix_change_pct,
    nifty_pcr: 0.92,
    crude_change, usdinr_change,
    breadth_index_open,    // num stocks > 1% above open
  },
  prompt: "Position SBIN +1.4% gain at 14:08, intraday looking weak (Nifty -0.2%, breadth 38/100). Hold or scale out?"
}
```

Opus returns: `HOLD` / `EXIT` / `SCALE_OUT_HALF` / `PROMOTE_SWING`.

---

## Schema additions to `paper_trades`

```sql
auto_managed         INTEGER DEFAULT 0   -- 1 if trader-owned
trader_state         TEXT                -- WATCHING/ENTERED/EXITED/HELD_OVERNIGHT/SKIPPED/ABANDONED
peak_price_paise     INTEGER
trailing_stop_paise  INTEGER
strategy_mode        TEXT DEFAULT 'INTRADAY_DEFAULT'
mode_promoted_at     INTEGER
or_high_paise        INTEGER             -- opening range high captured at 09:30
or_low_paise         INTEGER
exit_reason          TEXT                -- TRAIL_HIT/HARD_STOP/TARGET_HIT/HARD_15:10/PROFIT_LOCK/HALT_LIMIT
```

And the side table:
```sql
CREATE TABLE trader_decisions (
  id INTEGER PRIMARY KEY,
  paper_trade_id INTEGER,
  ts INTEGER,                 -- ms epoch
  cron_phase TEXT,            -- pre_market | entry | active | close
  decision TEXT,              -- WATCH/ENTER/HOLD/EXIT/PROMOTE/SCALE_OUT
  rationale TEXT,
  snapshot_json TEXT,         -- full live_context at moment of decision
  llm_model_used TEXT
);
```

---

## VIX-spike guard

If `india_vix > 22` AND `vix_change_pct > +12%` in last 30 min:
- Skip new entries (WATCHING positions stay watching but won't fire)
- Tighten existing trails by 30%
- Fires alert: `"VIX spike halt — entries paused, trails tightened"`

---

## Risk envelope (live, hard-coded into trader)

```js
PORTFOLIO_CAPITAL_PAISE = 100000000           // ₹10L
MAX_PER_PICK_PCT        = 30                   // ₹3L per stock max
DAILY_PROFIT_LOCK_PAISE = 3000000              // +₹30K → exit all + stop
DAILY_LOSS_HALT_PAISE   = -3000000             // -₹30K → exit all + stop
HARD_EXIT_TIME_IST      = '15:10'
INTRADAY_TRAIL_PCT      = 0.8
SWING_CANDIDATE_TRAIL   = 1.5
SWING_CONFIRMED_TRAIL   = 2.0
```

---

## Where it surfaces in UI

- `/trading/today/` Section 4 (Auto-Trader Positions) — `auto_trader_state` API
- `/trading/today/` Section 5 (Timeline) — `trader_decisions` log inline
- Hero "Today's P&L" card (NEW) — sums `pnl_net_paise` across positions

---

## Common bugs caught & fixed

| Bug | Fix |
|---|---|
| `paper_trades.entry_at NOT NULL` constraint failed for WATCHING | Insert `Date.now()` placeholder at WATCHING; update at ENTERED |
| `qty=1, stop=0, target=0` after Opus picks | range_capture now computes qty/stop/target at insert from live LTP × pcts |
| `kite_tokens ORDER BY created_at` | Wrong column. Schema has `obtained_at`. Fixed to `WHERE is_active=1 ORDER BY id DESC LIMIT 1` |
| `signal_scores.tranche` reference | Column doesn't exist. Removed |
| Opus prompt template literal broken by backtick | Escaped — `"sector"` instead of \`sector\` |
| Cron overlap (5min ⊂ 1min ⊂ 3min) | Removed redundant `*/5 3-10` catch-all |
| Daily loss UI showed -₹20K vs trader's -₹30K | `daily_loss_limit_paise` hardcoded 3000000 in getVerdictToday |
