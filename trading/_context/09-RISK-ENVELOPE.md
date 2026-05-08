# Risk Envelope

**Hard-coded into wealth-trader. Cannot be overridden by Opus.**

---

## Capital

```js
PORTFOLIO_CAPITAL_PAISE = 100000000   // ₹10,00,000 (₹10 lakh)
```

## Per-pick caps

```js
MAX_PER_PICK_PCT          = 30        // ₹3L max per stock
MAX_PICKS_PER_DAY         = 3         // 2-3 picks; engine rarely picks 1
TYPICAL_DEPLOYABLE_PCT    = 95        // 5% slippage buffer
```

## Conviction-weighted sizing

```js
HIGH conviction   → 35% of deployable
MEDIUM            → 30%
LOW               → 25%
// Sum normalized to ≤ 95% if 3 picks
```

## Per-trade stops/targets

Default percentages (Opus can override within bounds):

```js
DEFAULT_STOP_PCT          = -1.2        // tight stop
DEFAULT_TARGET_PCT        = +2.5        // 2:1 R:R minimum
MIN_RR_RATIO              = 1.8         // pick rejected if R:R < 1.8
MAX_STOP_PCT              = -2.0        // never wider than -2%
MAX_TARGET_PCT            = +5.0        // beyond this, intraday unlikely
```

## Trailing stops (mode-aware)

```js
INTRADAY_DEFAULT_TRAIL    = 0.8         // tight intraday trail
SWING_CANDIDATE_TRAIL     = 1.5
SWING_CONFIRMED_TRAIL     = 2.0
HELD_OVERNIGHT_TRAIL      = 2.0
```

## Daily portfolio guards

```js
DAILY_PROFIT_LOCK_PAISE   = 3000000    // +₹30K → exit all + stop
DAILY_LOSS_HALT_PAISE     = -3000000   // -₹30K → exit all + stop
```

When tripped:
- Exit ALL open positions immediately at LTP
- Block new entries for the rest of the day
- Set `halt_state = 'PROFIT_LOCK' | 'LOSS_HALT'` in `daily_verdicts`
- UI shows red banner

⚠️ Past bug: UI showed -₹20K limit but trader used -₹30K. Fixed by hardcoding `daily_loss_limit_paise: 3000000` in `getVerdictToday`.

## Sector concentration cap

```js
MAX_PICKS_PER_SECTOR = 1   // bank+bank+bank rejected, pick 1 from sector
```

Sector buckets: `BANK / IT / AUTO / PHARMA / FMCG / METAL / ENERGY / REALTY / CHEM / INFRA / OTHERS`.

Engine pre-filter applies this BEFORE Opus sees the candidate set, so Opus picks from sector-diverse shortlist.

## Hard exit time

```js
HARD_EXIT_TIME_IST = '15:10'
```

At 15:10 IST trader squares off ALL positions whose `strategy_mode` is `INTRADAY_DEFAULT` or `SWING_CANDIDATE`.
Skips: `SWING_CONFIRMED` and `HELD_OVERNIGHT` (intentional carryovers).

## Earnings exclusion

```js
EARNINGS_BLACKOUT_DAYS = 5   // skip if earnings in next 5 trading days
```

Filter applied at engine pre-selection (before Opus). Hard rule.

## VIX guards

```js
VIX_PANIC_LEVEL  = 22       // above this, halt new entries
VIX_SPIKE_PCT    = 12       // 12% VIX jump in 30min → halt + tighten trails
```

## Liquidity floor

```js
MIN_DAILY_TRADED_VALUE_CR = 5    // skip stocks trading < ₹5cr/day on average
```

`intraday_suitability.regime = 'ILLIQUID'` filters them out of the candidate pool.

## Slippage + impact assumptions

For paper P&L compute (in autopsy + EOD audit):

```js
SLIPPAGE_BPS = 5    // 0.05%
IMPACT_BPS   = 10   // 0.10%
TOTAL_BPS    = 15   // 0.15% per side
```

So entry P&L deducts 0.15% × notional, exit P&L deducts another 0.15%. Net round-trip cost ≈ 0.30%.

## Anthropic API cost cap (paper-trade phase)

```js
DEFAULT_DAILY_CAP_PAISE   = 9999999   // effectively unlimited
DEFAULT_MONTHLY_CAP_PAISE = 99999999  // ditto
```

Owner explicitly removed caps during paper phase: *"do not put a hard cap on usage right now first month"*.
Will reinstate sensible caps once daily spend pattern is clear (~₹50/day expected).

---

## When does the system halt itself?

| Trigger | Action | Recovery |
|---|---|---|
| Profit-lock +₹30K | Exit all, halt entries | Resume next day |
| Loss-halt -₹30K | Exit all, halt entries | Resume next day |
| VIX > 22 + spike | Pause entries, tighten trails | Auto-resume when VIX cools |
| Kite token expired | All entries fail safely with logged error | Owner re-OAuth at Today UI |
| Anthropic API failed all 3 tiers | engine_only_fallback (mechanical breakout) | Auto-recovers next call |
| Cron didn't fire | Watcher cron reports failed_24h count | Manual force_* endpoints |
| News with urgency 5 affects pick | Force invalidate verdict mid-day | Opus re-composes |

---

## Where it surfaces in UI

- Verdict card shows halt rules block prominently
- Auto-trader header shows day P&L vs +30K/-30K thresholds
- Hero P&L card (NEW) shows distance to lock/halt as progress bar
- System Health surfaces VIX state + Kite token state

---

## What gets monitored AFTER paper phase (real money)

When system flips from paper to real ₹10L:

- Add **portfolio drawdown circuit-breaker** — 5% from start-of-day NAV peak halts trading
- Add **per-symbol max-loss circuit** — 1% portfolio loss on a single stock halts that stock
- Add **broker-rejection alarms** — Kite order rejection 3× in a row pauses 1h
- Tighten Anthropic caps to ~₹150/day
- Add **owner alert via WABA** for any halt (currently UI-only)
