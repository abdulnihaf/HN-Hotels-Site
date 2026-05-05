# ⛔ DO NOT TOUCH from non-trading Claude work

**Read this BEFORE making any change in this repo if your task is NOT explicitly about the trading system.**

---

## What happened on May 5, 2026

A Google My Business / Cockpit API session merged a PR to `main`. That merge replaced the production Cloudflare Pages deployment with a version of `main` that **did not contain `functions/api/trading.js`** (because trading files only existed in claude/* worktrees, never in main).

Result: `trade.hnhotels.in/api/trading?action=*` started returning the HN Hotels marketing landing page (Cloudflare's SPA fallback). The trading PWA broke. Auto-trader couldn't reach its own API.

**This must not happen again.** The trading system is owner's active P&L bet — ₹10L real money on the line within months. It is *extremely deep + surgical*. Losing context costs days/weeks.

---

## Hard rules for non-trading sessions

1. **Do not delete, move, or rename anything in `.cloudflare-protected-paths`.**
   That file lists every path the trading deploy depends on. Run `bash scripts/verify-trading-deploy.sh` before any commit.

2. **Do not modify `wrangler.toml`** without re-checking that the `WEALTH_DB` D1 binding still resolves. Removing `[[d1_databases]] binding = "WEALTH_DB"` breaks `/api/trading`.

3. **Do not modify `functions/_middleware.js`** without re-running:
   ```
   curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
     https://trade.hnhotels.in/api/trading?action=todays_plan
   ```
   Expected: `200 application/json`. If you see HTML/marketing landing page, you broke the trading routing.

4. **Do not change anything under `trading/`, `wealth-engine/`, `functions/api/trading.js`, `functions/api/kite.js`, `functions/api/backtest.js`, `functions/api/_lib/{anthropic,coaching,costModel,optionAnalytics,bayesianLearner,backtester}.js`, `functions/wealth/`, or `scripts/sync-trading-docs.js`** unless your task is *explicitly* about the trading system.

5. **CI guardrail.** `scripts/verify-trading-deploy.sh` must pass before any merge to main. If it fails, restore the missing paths or set `TRADING_DEPLOY_TOUCHED=1` (only with explicit owner approval and a PR description containing `ACK: trading-deploy-touched-with-owner-approval`).

6. **If you accidentally delete/move trading paths** in your worktree, run:
   ```bash
   git checkout main -- functions/api/trading.js
   git checkout main -- functions/api/kite.js
   git checkout main -- trading/
   git checkout main -- wealth-engine/
   git checkout main -- functions/_middleware.js
   git checkout main -- functions/wealth/
   git checkout main -- functions/api/_lib/
   git checkout main -- scripts/sync-trading-docs.js
   git checkout main -- .cloudflare-protected-paths
   git checkout main -- scripts/verify-trading-deploy.sh
   ```
   Verify with `bash scripts/verify-trading-deploy.sh`.

---

## What you CAN do (non-trading work)

- Anything outside the protected-paths list
- Read the trading code to understand how it works
- Reference trading patterns in your docs
- File issues / draft PRs that propose trading-system changes (owner reviews)

---

## What you CANNOT do (without explicit owner sign-off)

- Delete or move any protected path
- Modify `wrangler.toml`'s D1 bindings
- Modify `functions/_middleware.js`
- Replace `index.html` at repo root in a way that overrides Pages SPA routing
- Open a PR to main without running `scripts/verify-trading-deploy.sh` first

---

## Why this matters

The trading system has:
- 15 Cloudflare Workers with 98 distinct cron expressions
- 70+ API actions across `functions/api/trading.js`
- 15 D1 migrations with paper_trades, daily_verdicts, intraday_bars, eod_learning_audits, …
- 4 PWA routes with PIN gate, hero P&L, verdict card, EOD audit, monthly trail
- 3-tier Claude API (Opus / Sonnet / Haiku) with cost tracking
- Kite Connect OAuth + LTP feed + 5-min OHLC ingestion
- 4-bucket EOD attribution (RIGHT/MISSED/LEARNED/LUCK) with skill% tracking
- Auto-update scripts for `_context/*.md`

A "small" cleanup PR that touches `functions/` or `trading/` can vaporize this entire stack. **Don't.**

---

## Bottom line

If your task description doesn't say "trading", "wealth-engine", "Kite", "paper-trade", "auto-trader", or similar — assume the trading system is **off-limits**.

When in doubt: read this file again, run the guardrail, ask the owner.
