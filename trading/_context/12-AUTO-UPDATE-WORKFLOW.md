# Auto-Update Workflow — Keep `_context/*.md` Synced With Code

**Problem:** docs go stale fast. By the time we wrote layer doc 06 (Cron Map), the codebase had 15 workers and 70+ API actions vs. the ~11 / ~20 documented manually.

**Solution:** A self-contained Node script that scans actual code state and regenerates marker-bracketed sections in the MD files. Zero npm deps. Owner runs it, or pre-commit hook runs it.

---

## The script

```
scripts/sync-trading-docs.js
```

Pure Node, no deps. Reads source-of-truth files, regenerates `<!-- AUTO:section -->...<!-- /AUTO:section -->` blocks inside the 12 layer docs.

### Usage

```bash
# Update docs in place
node scripts/sync-trading-docs.js

# Show what would change without writing
node scripts/sync-trading-docs.js --dry-run

# CI gate — exits 1 if drift detected
node scripts/sync-trading-docs.js --check
```

---

## What it scans

| Source | Path | Used in |
|---|---|---|
| Workers + crons | `wealth-engine/workers/*/wrangler.toml` | `06-CRON-MAP.md`, `00-OVERVIEW.md` |
| Migration files | `wealth-engine/migrations/*.sql` | `07-D1-SCHEMA.md` |
| API action routes | `functions/api/trading.js` | `08-API-ENDPOINTS.md` |
| UI routes | `trading/*/index.html` | `05-UI-LAYER.md` |
| Service worker version | `trading/sw.js` | `05-UI-LAYER.md` |

---

## Marker convention

Sections that auto-update are wrapped with HTML comments:

```markdown
## Cron table

<!-- AUTO:cron-overview-table -->
| Worker | Crons | Sample |
|---|---|---|
| `wealth-verdict` | 8 | ... |
<!-- /AUTO:cron-overview-table -->
```

Manual content (analysis, recommendations, history) lives **outside** markers and is never touched.

If a marker block doesn't exist in a doc, the script appends one at end-of-file.

---

## Marker inventory (current)

| Marker | File | Source |
|---|---|---|
| `cron-overview-table` | `06-CRON-MAP.md` | wrangler.toml × all workers |
| `cron-list-by-worker` | `06-CRON-MAP.md` | wrangler.toml × all workers |
| `migrations-list` | `07-D1-SCHEMA.md` | migrations/*.sql |
| `api-action-list` | `08-API-ENDPOINTS.md` | trading.js `case 'X'` |
| `ui-routes-list` | `05-UI-LAYER.md` | trading/*/index.html |
| `workers-summary` | `00-OVERVIEW.md` | wealth-engine/workers/* |

To add a new auto-section: add a formatter in `sync-trading-docs.js` `updates` map → add `<!-- AUTO:name -->...<!-- /AUTO:name -->` placeholder anywhere in target MD → run script.

---

## Drift report

Every run rewrites `_context/AUTO-DRIFT-REPORT.md` with:
- Last-sync timestamp (IST)
- Live count of workers / crons / migrations / actions / routes
- List of files updated in this run

Open this file before/after editing to spot drift.

---

## When to run

| Trigger | Action |
|---|---|
| Added/removed a Worker | `node scripts/sync-trading-docs.js` |
| Added cron expression | run script |
| New D1 migration | run script |
| New `?action=X` route | run script |
| New UI route | run script |
| Bumped service-worker version | run script |
| **Pre-commit (recommended)** | install hook (below) |
| **CI / PR check** | `node scripts/sync-trading-docs.js --check` in workflow |

---

## Install pre-commit hook

```bash
# Run from repo root
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
# HN Wealth Engine — keep trading docs in sync with code
# Skip if no source-of-truth files changed
CHANGED=$(git diff --cached --name-only | grep -E '^(wealth-engine/(workers|migrations)/|functions/api/trading\.js|trading/sw\.js|trading/.+/index\.html|trading/index\.html)' || true)
if [ -n "$CHANGED" ]; then
  echo "→ Source files changed, syncing trading docs..."
  node scripts/sync-trading-docs.js --check || {
    echo ""
    echo "❌ Trading docs out of sync. Run:"
    echo "   node scripts/sync-trading-docs.js"
    echo "   git add trading/_context/"
    exit 1
  }
fi
EOF
chmod +x .git/hooks/pre-commit
```

This:
1. Detects if any source-of-truth file is staged
2. Runs `--check` mode (read-only, exits 1 on drift)
3. Blocks commit if drift detected
4. Owner runs sync + git-adds the updated docs

---

## Optional: GitHub Action

Add `.github/workflows/trading-docs-drift.yml`:

```yaml
name: Trading docs drift check
on:
  pull_request:
    paths:
      - 'wealth-engine/**'
      - 'functions/api/trading.js'
      - 'trading/**'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/sync-trading-docs.js --check
```

Fails the PR if MD docs are stale.

---

## Optional: Cloudflare Worker daily reminder

Add to `wealth-orchestrator` (or new `wealth-doc-sync` worker):

```js
// Cron: 0 13 * * 0   (Sun 18:30 IST — weekly)
async function checkDocDrift(env) {
  // This worker can't run node, but it CAN compare D1 row counts
  // to declared schema in 07-D1-SCHEMA.md (committed-content fetched
  // via raw GitHub URL or stashed in KV during build).
  // Posts a Slack/WABA reminder if drift count > threshold.
}
```

This is a stretch — the local script + pre-commit covers 95% of the value.

---

## Why not auto-write to `_context/` from a Worker?

- Workers can't write to git filesystem
- They could write to D1 → but then docs live in 2 places (D1 + git)
- The MD files are owner-readable artifacts. Keeping them in git is the value.
- So: **source = code in git**; **regenerator = node script run locally or in CI**

---

## Manual sections (NEVER touched by sync)

Inside each layer doc, content **outside** AUTO markers is hand-written and stable:
- Architecture rationale
- "Why we did it this way" notes
- Recent bug fixes / lessons
- Strategy decisions
- Open issues / future tuning

The script only touches structural data (lists, tables, counts).

---

## Limits + roadmap

- ⚠️ Current script doesn't read **D1 live state** (table row counts, last cron-fire timestamps). For that, would need to call wrangler CLI from script or hit a `/api/trading?action=ops_state` endpoint.
- ⚠️ Doesn't detect orphan markers (a `<!-- AUTO:foo -->` with no formatter — silently retained).
- ⚠️ Doesn't validate **referential integrity** (e.g., MD says "wealth-trader has 4 crons" while wrangler.toml has 5 — caught by sync, but a doc-only edit could create a fake number that survives until next run).

Roadmap:
1. Add `--verbose` flag showing diff per section
2. Add D1 live-state probe (optional, requires wrangler CLI)
3. Add doc-only-section validator (any `[N workers]` style hardcoded counts flagged)
4. Auto-add missing `<!-- AUTO:* -->` markers based on a manifest

---

## First run

```bash
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site
node scripts/sync-trading-docs.js
# expect: many files updated (initial markers + content)
git status
git add scripts/sync-trading-docs.js trading/_context/
git commit -m "trading: bootstrap auto-sync layer docs"
```

After first run, only re-run when source-of-truth files change.
