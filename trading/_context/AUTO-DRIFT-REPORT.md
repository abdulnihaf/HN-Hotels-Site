# Auto-sync drift report

**Generated:** 2026-05-05 15:00:52 IST
**Files updated this run:** 05-UI-LAYER.md

## Live counts

- Workers: **15**
- Total crons: **98**
- Migrations: **15**
- API actions: **70**
- UI routes: **4**
- Service worker version: **wealth-v26**

## How to read this

- This file is regenerated on every `node scripts/sync-trading-docs.js` run.
- The numbers above reflect the **actual deployed code state** at sync time.
- If `Files updated this run` is non-empty, it means the MD docs were stale relative to source code.
- If `_none_`, MD docs are in sync with code.

## CI gate

```bash
# Use this in pre-commit / CI to block merging if docs are stale:
node scripts/sync-trading-docs.js --check
# Exits 1 if any AUTO-marked section is out of date.
```

## When to run

- After adding/removing a Worker
- After adding/changing crons in any wrangler.toml
- After adding a D1 migration
- After adding an `?action=…` route in `functions/api/trading.js`
- After adding/removing a UI route under `/trading/`
- Pre-commit hook recommended (see `12-AUTO-UPDATE-WORKFLOW.md`).
