# 18 · PROTECTED SURFACES — UI/UX work boundary

> **Purpose**: there are parallel chats working on this codebase — some doing UI/UX work, others building intelligence/data/cron infrastructure. This doc draws the line so cosmetic work CANNOT silently break the intelligence layer that drives the May 11 real-money launch.
>
> **Read this BEFORE making any change.** Any session opening this codebase should read this file.

---

## 0. The bright line

```
🔴 PROTECTED (do not modify in UI/UX sessions)
   ├── wealth-engine/workers/**/*           ← ALL worker code + wrangler.toml
   ├── wealth-engine/_shared/**/*           ← shared libraries
   ├── wealth-engine/migrations/**/*        ← D1 schema migrations
   └── functions/api/trading.js (existing)  ← existing switch cases & functions

🟡 ADDITIVE-ALLOWED (UI sessions may extend, but only additively)
   ├── functions/api/trading.js             ← NEW switch cases + NEW read-only functions
   │   ↳ Allowed: SELECT-only queries returning data the UI needs
   │   ↳ Forbidden: INSERT / UPDATE / DELETE on existing tables
   │   ↳ Forbidden: Claude / external API calls from new endpoints
   │   ↳ Forbidden: modifying existing switch cases or functions
   └── trading/_context/**/*.md             ← additive context docs

🟢 FREELY EDITABLE (UI sessions own these)
   ├── trading/**/*.html                    ← page templates, layout, CSS
   ├── trading/**/*.css (if added)          ← stylesheets
   ├── trading/_lib/*.js                    ← UI helper libs (no D1 writes)
   ├── trading/sw.js                        ← service worker (cache version + URLs only)
   ├── trading/manifest.json                ← PWA manifest
   ├── trading/icons/**/*.svg               ← icons + branding
   └── NEW pages under trading/             ← e.g., /trading/dashboard/
```

---

## 1. Why this boundary exists

### What lives in the protected zones

The **intelligence layer** is built on top of:

| Layer | Lives in | Why protected |
|---|---|---|
| **Pick selection** (which stocks to trade) | `wealth-verdict/src/index.js` (Opus calls + ranking) | Wrong picks = real-money loss |
| **Cron schedules** (when crons fire) | `wealth-*/wrangler.toml` | A 30-min off-by-30-min bug today (TZ-1) silently captured zero pre-open data for weeks |
| **Trade execution logic** (entry / stop / target / trail / hard exit) | `wealth-trader/src/index.js` | Single line wrong = wick-stop loss like AEROFLEX (₹17K hypothetical today) |
| **Data ingestion** (Kite quotes, intraday bars, intraday_suitability) | `wealth-price-core`, `wealth-intraday-bars` | Polluted ticks = Opus picks based on stale data |
| **Self-learning + audit** (audit_findings, eod_learning_audits) | `wealth-orchestrator`, `wealth-verdict` | Drift undetectable if the audit layer itself is modified |
| **API contract** (trading.js existing functions) | `functions/api/trading.js` | UI assumes specific response shapes — modifying breaks all readers silently |

### What's safe to change

**HTML / CSS / SVG / cosmetic JS**: zero blast radius if changed. Worst case the page renders ugly.

**New API endpoints (read-only, additive)**: blast radius bounded to the new endpoint. As long as it doesn't INSERT/UPDATE/DELETE D1 or make external API calls, the worst case is the new endpoint returns wrong data — no contagion.

---

## 2. Self-check before any change in a UI/UX session

```
□ Am I touching any file in wealth-engine/workers/**?           → STOP, this is protected
□ Am I touching any wrangler.toml?                              → STOP, protected
□ Am I modifying an existing switch case in functions/api/trading.js? → STOP
□ Am I modifying an existing function in functions/api/trading.js?    → STOP
□ Am I writing to any D1 table the intelligence layer reads?    → STOP
□ Am I calling Anthropic / Kite / external APIs from new code?  → STOP

If all 6 unchecked: proceed.
```

---

## 3. Allowed-additive pattern for new API endpoints

If a UI feature needs data that doesn't have an endpoint yet, you may add a new switch case + new function in `functions/api/trading.js`. Rules:

```js
// ✅ ALLOWED:
case 'my_new_ui_data': return Response.json(await getMyNewUiData(db, url), { headers });

async function getMyNewUiData(db, url) {
  // SELECT-only queries on existing tables
  const rows = (await db.prepare(`SELECT ... FROM ... WHERE ...`).all()).results || [];
  return { rows, generated_at: Date.now() };
}

// ❌ FORBIDDEN in UI sessions:
async function getMyNewUiData(db, url, env) {
  await db.prepare(`UPDATE ...`).run();      // No writes
  await fetch('https://api.anthropic.com');  // No external calls
  await db.prepare(`INSERT INTO ...`).run(); // No inserts
}
```

---

## 4. Tripwire — verify drift since last known-good baseline

### Last known-good baseline (after PRs #65, #66, #67, #68 — all intelligence work merged)

**Tag**: `tripwire-baseline-2026-05-06-eod`
**Git SHA on main**: `2949372` (which is the no-op revert; net state is identical to `a1e621b8` after the 6 UI experiments were reverted)

### Run drift check anytime

```bash
# From repo root:
bash scripts/verify-no-drift.sh
```

The script:
1. Runs `git diff tripwire-baseline-2026-05-06-eod -- <protected-paths>`
2. Categorizes any output: 🔴 protected-zone drift / 🟡 additive-only drift / 🟢 cosmetic-only drift
3. Returns exit code 0 if clean, non-zero if 🔴 detected

### Auto-detection (pre-market integrity check)

The 08:25 IST `pre_market_integrity` cron now includes a Layer 2 sub-check `L2.5_protected_surfaces_drift` (added with this doc) that:
- Reads the worker version IDs from each Cloudflare deployment
- Compares against expected baseline
- Flags severity=critical in `audit_findings` if any worker drifted unexpectedly

---

## 5. What just happened (incident log — May 6, 2026 evening)

The "Build Indian stock analysis application" chat shipped 6 UI experiments PRs (#69–#75) testing different layouts for `/trading/execute/`. After review they were **all reverted in PR #76**.

**Audit result** (after revert): `git diff a1e621b..origin/main` returns empty. **Zero protected-surface drift.** All intelligence-layer code, cron schedules, Claude API touchpoints, and D1 schema are exactly as I left them after PR #68.

**Spot-check confirmed intact**:
- ✅ `wealth-trader` has F-EXIT-1 `target_locked` logic (20 references)
- ✅ `wealth-orchestrator` has `preMarketIntegrityCheck` + `eodReadinessSummary` (4 references)
- ✅ `wealth-price-core` has TZ-1 fix (`30-38 3 * * 1-5`)
- ✅ `wealth-verdict` has TZ-7 3-cron split (`45 3` + `0 10`)
- ✅ `wealth-signal-engine` has TZ-6 fix (`0 4-10 * * 1-5`)
- ✅ `functions/api/trading.js` has `readiness_report` API endpoint

**During the experimental phase** (before the revert), the other chat DID briefly add 2 new API endpoints to `trading.js`: `top_strip` and `watchlist_sparklines`. Both were strictly read-only and additive (per the rules in §3 above). They got reverted along with the rest, but they were a valid use of the additive-allowed pattern — useful precedent.

---

## 6. Standing ask of any UI session opening this repo

1. Read this file first.
2. Run `bash scripts/verify-no-drift.sh` BEFORE starting work to confirm baseline.
3. Stay in 🟢 zones; if 🟡 needed, follow §3 rules strictly.
4. Run `bash scripts/verify-no-drift.sh` AFTER finishing to confirm only allowed-zones changed.
5. PR description must explicitly state "no protected-surface changes" and `verify-no-drift.sh` exit code = 0.

If a UI session DOES need to modify a protected file (rare, but possible):
- Don't do it in a UI PR.
- Open a separate, narrowly-scoped PR with the rationale.
- Owner reviews + merges.
- Then update `tripwire-baseline-2026-05-06-eod` to a new tag pointing at the new baseline SHA.
