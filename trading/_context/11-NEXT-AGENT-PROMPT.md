# Next Agent — Bootstrap Prompt

Paste this into a fresh Claude Code session to resume HN Wealth Engine work without losing context.

---

## Required context reads (in order)

```
1. /Users/nihaf/.claude/CLAUDE.md                                 # global HN Hotels rules
2. /Users/nihaf/Documents/Tech/HN-Hotels-Site/CLAUDE.md           # repo rules
3. /Users/nihaf/Documents/Tech/HN-Hotels-Site/trading/_context/00-OVERVIEW.md
4. Then dive into the specific layer doc you need (01–10)
```

The 11 docs in `/trading/_context/` are the durable state of the system. Read on demand.

---

## Operating principles (binding)

1. **Owner = observer.** Don't add buttons that change state. UI is read-only post-08:15 OAuth.
2. **Architect, don't ask.** Make decisions. Don't ask permission for technical/workflow choices.
3. **No production deploys from Claude.** Open draft PRs only. Owner reviews + merges.
4. **Read before edit.** Always `Read` the full file. Never patch blind.
5. **One branch + one draft PR per phase.** No bundling.
6. **Money = paise (INTEGER).** Convert at display only.
7. **Vanilla JS.** No build pipeline. No npm. PWA.
8. **Don't change strategy without proper understanding.** Push back on owner ideas if you spot a flaw.

---

## Current state (May 5, 2026)

- **Day:** Active paper-trade phase. Owner connected Kite OAuth at 08:15. System running autonomous.
- **Today's outcome:** Win flagged in EOD audit (~+₹16,845 simulated). Hero P&L card now surfaces this on Today UI.
- **Kite OAuth:** active (stored in `kite_tokens`).
- **Anthropic spend:** uncapped during paper phase (`DEFAULT_DAILY_CAP_PAISE = 9999999`).
- **Paper capital simulated:** ₹10,00,000.
- **Cron count:** ~25 distinct expressions across 11 workers, all deployed.

---

## Open issues (in priority order)

### Bug-class
1. ⚠️ `kite_quotes` table sometimes empty — verify wealth-price-core writes to right binding
2. ⚠️ `news_articles` reports `no_data` in intelligence_audit — verify cron firing
3. ⚠️ wealth-orchestrator stop_loss watcher (every 2min) may overlap wealth-trader — audit & retire orchestrator if redundant

### UI/UX-class
4. Phase 2+3 of Execute tab consolidation (redirect + nav cleanup) — see `10-EXECUTE-TAB-CONSOLIDATION.md`
5. Trade Math + 3-Q test inline migration into Today's picker modal

### Security
6. Rotate Kite API key + secret (leaked in chat, multi-session)
7. Rotate DASHBOARD_KEY (leaked in chat)

### Strategy/data quality
8. Pre-market briefing — verify composeVerdict actually consumes the briefing row (vs. recomputing fresh)
9. Sector concentration cap calibration after 30+ trades
10. Conviction calibration — track HIGH/MED/LOW pick win-rate divergence

---

## Common tasks + how to do them

### Add a new D1 column
```bash
# 1. New migration file
echo "ALTER TABLE paper_trades ADD COLUMN new_col TEXT;" \
  > /Users/nihaf/Documents/Tech/HN-Hotels-Site/wealth-engine/migrations/0017_add_col.sql

# 2. Apply locally first
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site/wealth-engine
wrangler d1 migrations apply wealth-engine --local

# 3. Apply to remote (only if user asks for deploy)
wrangler d1 migrations apply wealth-engine --remote
```

### Add new cron to a worker
1. Edit `wealth-engine/workers/<worker>/wrangler.toml` `[triggers] crons = [...]`
2. Add `case 'CRON_EXPR': return handler(env);` in `src/index.js scheduled()` handler
3. `wrangler deploy` from worker dir
4. Verify: check `cron_fires` table after expected time

### Add a new Today UI section
1. Add `<div id="newSection"></div>` placeholder in `today/index.html` body
2. Add `loadNewSection()` async function with fetch to API
3. Call from `bootApp()` flow after PIN gate
4. Add API handler in `functions/api/trading.js`
5. Bump `sw.js CACHE_VERSION`

### Force-trigger a cron for testing
```
GET /api/trading?action=force_compose_verdict&key=DASHBOARD_KEY
GET /api/trading?action=refire_eod_audit&date=2026-05-05&key=DASHBOARD_KEY
```

---

## When to escalate to owner

- Strategy direction changes (e.g., switch to options, add overnight holds, leverage)
- Money handling changes (paper → real flip, broker switch)
- Capital changes (₹10L → other amount)
- Anything that fires real Kite orders
- Schema changes that drop columns / data

For everything else: architect and ship draft PRs.

---

## Worktree quirks (this session)

This session is in a worktree:
```
/Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/clever-murdock-16b032/
```

The worktree is a full clone. PR/commit from here lands in main repo via owner-side merge.
For iPhone Claude Code sessions: paths look the same, but reachability is sandbox-restricted (see global CLAUDE.md "Sandbox reachability map").

---

## Quick commands

```bash
# See what changed
git -C /Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/clever-murdock-16b032 status

# Worktree context: read these 3 first
cat /Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/clever-murdock-16b032/trading/_context/00-OVERVIEW.md
cat /Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/clever-murdock-16b032/CLAUDE.md
cat /Users/nihaf/.claude/CLAUDE.md

# List context docs
ls /Users/nihaf/Documents/Tech/HN-Hotels-Site/.claude/worktrees/clever-murdock-16b032/trading/_context/
```

---

## Final note

This system is owner's **active P&L bet** — ₹10L real money on the line within months. Treat every decision with that gravity. When in doubt:
- Don't ship without `Read`-ing the full file first
- Don't change risk parameters without owner sign-off
- Don't assume — verify in D1 / via API first
- Don't bundle phases

Be rigorous. Be honest about uncertainty. Surface skill% honestly. The system's trust depends on it.
