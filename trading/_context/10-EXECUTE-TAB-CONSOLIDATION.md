# Execute Tab — Why It Can Retire

**Owner's question (May 5):**
> "why is still there a requirement of an execute tab, why cant it be a today, tab and then ops and health"

**Short answer:** No good reason. Execute tab can retire. Recommended new structure: **Today + Ops** (Hub becomes the landing page that points to Today).

---

## Audit of `/trading/execute/` (2,728 lines)

What lives there today:

| Feature | Reachable? | Migration target |
|---|---|---|
| **Manual paper-trade form** (sym/qty/entry/stop/target/thesis) | Yes, primary CTA on the page | Today: inline modal via Picker callback (already partially wired) |
| **Stock Picker** (watchlist + signals + search) | `_lib/picker.js` is shared | Already invoked from Today's `🔍 Pick a stock to paper-trade` button |
| **Live Kite order placement** (real-money path) | Yes, but blocked behind a confirm dialog | Move to `/trading/real/` (separate, hidden, only flips on after paper-trade phase) |
| **Trade Math panel** (R:R, breakeven, sizing) | Inline below form | Move to inline collapsible inside the new modal |
| **3-Question Test** (forces thesis articulation) | Below form | Optional — can keep inline in modal, or retire (system is autonomous now) |
| **Power dashboard** (briefing v2, 9-dim health, MTF, Bayesian, raw signals) | Visible by default | Already mirrored in Today's `<details>🔬 Show the math</details>` |
| **Capital banner** (today/week/month KPIs) | Top of page | Already in Hub `/trading/`. Can also move to Today's Hero card |
| **Kite link/status** | In header | Already in Today header |
| **Concall analyzer** | Not on Execute, on Today | Already on Today |

**Net:** Every Execute feature has either (a) already migrated to Today, or (b) is rarely used + can move to Hub or a hidden `/real/` route.

---

## Why Execute existed (history)

1. The original mental model was **owner = trader**. Execute was the cockpit where owner did the trade.
2. Today/Hub was meant for "passive view".
3. Then we built **wealth-trader** auto-execution. Now owner = observer. Cockpit obsolete.
4. We never went back and pruned. Execute was kept "in case owner wants manual override".

But:
- Owner has explicitly said *"I will only paper trade"* + *"system fully autonomous post 08:15 Kite OAuth"*.
- Manual paper-trade is a 1-stock-at-a-time exercise; the system runs 2-3/day automatically.
- Manual override of auto-trader has never been requested.

---

## Recommended new structure

```
/trading/                  HUB — landing page, redirects to /today/ for owner during phase
   └─ also serves as power dashboard for dev / debug

/trading/today/            TODAY — owner's daily home (currently exists, well-built)

/trading/ops/              OPS — cron status, spend, system health, manual triggers

/trading/real/   (HIDDEN)  REAL ORDERS — placeholder, only enabled when owner flips
                            paper→real switch in ops. Has the live Kite order form.

/trading/execute/          ──► REDIRECT to /today/ during paper-phase
                           ──► REDIRECT to /real/ when real-money phase starts
```

### Tab nav simplification

Before:
```
🏠 Hub  |  📋 Today  |  🎯 Execute  |  ⚙️ Ops
```

After:
```
📋 Today  |  ⚙️ Ops          (← owner sees only these 2 in observation phase)
🏠 Hub                       (← landing, separate)
```

---

## Migration steps (ordered, low risk)

### Phase 1 — Make Today fully self-sufficient (mostly done)

- ✅ `🔍 Pick a stock to paper-trade` already opens picker modal
- ✅ Picker callback can either insert a paper-trade directly OR open a paper-trade modal in-page
- ⬜ Move "Trade Math" panel into the picker callback modal so owner can review R:R inline
- ⬜ Move "3-Q test" (if kept) into the picker callback flow

### Phase 2 — Redirect Execute

```js
// trading/execute/index.html (replace whole file with redirect during paper phase)
<script>
  const isPaperPhase = !localStorage.getItem('wealth_real_money_enabled');
  window.location.replace(isPaperPhase ? '/trading/today/' : '/trading/real/');
</script>
```

Or server-side: Cloudflare Pages `_redirects`:
```
/trading/execute/  /trading/today/  302
```

### Phase 3 — Strip tab nav

Remove `Execute` link from all 3 nav blocks (`index.html`, `today/index.html`, `ops/index.html`).

### Phase 4 — Build `/trading/real/`

When owner is ready to flip to real money:
- Copy current Execute's Kite-order-place section into a new `real/index.html`
- Add 2-step confirm + WABA SMS-OTP gate
- Hidden by default; revealed by setting `wealth_real_money_enabled=1` in ops

---

## Why this is safe

1. **No data loss** — Execute is pure UI; all data is in D1.
2. **Picker is shared** — `_lib/picker.js` works from any page.
3. **Service worker bumps** — set `CACHE_VERSION = 'wealth-v25'` to force refresh.
4. **Backout plan** — single commit can revert nav links.

---

## What this saves

- 2,728 lines of HTML/JS gone (Execute tab)
- 1 less route in service worker pre-cache
- 1 less surface area for bugs
- Owner sees exactly what they need: Today + Ops. Mental model = **observer**, no execution buttons.
- Once real-money phase starts, `/real/` is its own scope — paper-phase tooling won't accidentally fire real orders.

---

## What we're NOT doing

- We are NOT deleting Execute's source code yet. Just redirecting it. Code stays in repo for `/real/` to crib from later.
- We are NOT removing Hub. Hub stays as power dashboard. Just nav simplifies.
- We are NOT changing any auto-trader behavior. This is purely UI consolidation.

---

## Implementation tracker

Status as of this session:
- ✅ Audit complete (this doc)
- ⬜ Phase 1 — Trade Math + 3-Q migration
- ⬜ Phase 2 — Execute redirect (1-line `_redirects` change)
- ⬜ Phase 3 — Tab nav cleanup (remove Execute link from 3 files)
- ⬜ Phase 4 — Real-money placeholder route

Next session can ship Phase 2+3 in one PR (fastest win, ~30 min work).
