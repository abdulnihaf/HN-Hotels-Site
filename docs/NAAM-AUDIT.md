# Naam — Codebase Audit
*Fresh-eyes review of `claude/naam-v1` (PR #278). Written as if joining mid-sprint.*

---

## File structure

```
naam/
  index.html                 # ~600-line monolith: HTML + all CSS + all JS inline
  manifest.json              # PWA manifest (naam-ec8.pages.dev custom domain)
  sw.js                      # Service worker — cache-first shell, network-first data
  robots.txt / llms.txt      # SEO / discovery blocks
  data/
    naam-data.json           # 13-lane spine: glance metrics, next-actions, freshness
    creative-manifest.json   # 2,646 creative asset records, flat array
  creative/thumb/            # 639 WebP thumbnails (~13 MB) — commit-served by CF Pages
  icons/                     # 192/512/1024 Figma-exported PNGs (Naam chamber tile)

scripts/
  naam-snapshot.js           # Node — reads Codex marketing memory + live APIs → updates naam-data.json
  naam-deploy.sh             # Bash — wrangler pages deploy to naam CF project
  build-creative-manifest.py # Python — projects HN_Creative_Asset_Library registry → creative-manifest.json + thumbs
```

**Logical splits: adequate for the current scale.** The monolith is intentional and matches the Sauda pattern (the UX bar). It loads as one HTTP round-trip, is served cached by the SW, and has no build step to fail. The risk is the 600-line JS scope — no module boundary means a typo anywhere kills everything.

**Duplication:** `naam-data.json` and `creative-manifest.json` partially overlap on brand/lane taxonomy. They evolve independently, so a lane renamed in one but not the other causes silent mismatch. No test catches this.

---

## Data flow — where it breaks silently

```
HN_Creative_Asset_Library/_registry/asset_registry.json
  └─[build-creative-manifest.py]──► creative-manifest.json  ← commit + deploy
       └─[naam/index.html loadCreative()]──► Creative tab

~/.local/share/hn-marketing-memory/state/marketing-memory.json  (Codex-owned, read-only)
  ╠═[naam-snapshot.js]──► naam-data.json  ← commit + deploy
  ╚═ NEVER touched by Naam

naam-data.json
  └─[naam/index.html loadData() in boot()]──► Today + Lanes + You tabs
```

### Silent failure points, ranked by danger

| # | Where | Failure mode | Visibility |
|---|---|---|---|
| 1 | **boot() `loadData()`** | Before Phase 1 fix: unhandled rejection → `state.data = null` → every render throws → blank white screen. No error shown. | **Invisible** ✅ fixed (v3) |
| 2 | **`naam-snapshot.js` Codex memory read** | If `~/.local/share/hn-marketing-memory/state/marketing-memory.json` is stale or absent (Codex lane never re-run), the snapshot silently keeps last-known values with a new `generated_at` timestamp. The You-tab freshness indicator shows "today" even though the data is weeks old. | **Invisible** |
| 3 | **`creative-manifest.json` lane/brand mismatch** | If a lane id is renamed in `naam-data.json` but `creative-manifest.json` still carries the old id, the "N creatives" link in lane detail resolves to 0 — no error, just an empty count. | **Invisible** |
| 4 | **`build-creative-manifest.py` thumb generation** | If PIL is missing or a source file is corrupt, the script logs to stderr but writes `thumb_url: null` for that asset silently. The UI shows a badge (OK) but the owner never knows the thumb is permanently missing. | **Invisible** |
| 5 | **Counter-UPI live fetch timeout** | `renderPulse()` has a `try/catch` — on timeout it shows `—`. But because the fetch uses no AbortController timeout (relies on browser default ~2 min), a slow response blocks the `await` and the Today tab's pulse row shows `…` for up to 2 minutes before the default times out. | **Delayed / confusing** ✅ mitigated by catch but slow |

---

## State management

```js
const state = {
  brand: 'HE',          // persisted to localStorage
  tab: 'today',         // in-memory only
  data: null,           // loaded once in boot(), shared by reference across all tabs
  creative: null,       // loaded lazily on first Creative tab open
  cLane, cStatus, cSearch  // Creative filter state, in-memory
}
```

**How 4 tabs share data:** they don't re-fetch — all four read the same `state.data` object. The single `renderAll()` call re-renders all visible tabs after a brand switch or hard-refresh. This is correct and efficient.

**Re-fetching / caching:** `loadData()` passes `cache:'no-store'` only on explicit hard-refresh. Normal boot uses the SW cache (network-first). This is correct — the SW fetches fresh on network, falls back to cache offline.

**Wrong invalidation risk:** `loadCreative()` is called once (`if(!state.creative)loadCreative()`) — meaning Creative is only loaded when that tab is first opened. If `creative-manifest.json` is re-deployed while the app is open, the old manifest stays in memory. The SW's `naam-v4` version controls this at the cache level, not the JS level. On a "hard refresh" from You-tab, `loadData()` is re-fetched but `state.creative` is NOT reset — stale creative manifest survives. **Fix:** `refreshRow` should also reset `state.creative = null` before `renderAll()`.

---

## Build vs runtime

`build-creative-manifest.py` is **build-time**, not runtime. It:
- Reads laptop-local files (absolute `/Users/nihaf/…` paths)
- Requires PIL + filesystem access
- Takes 10–60 seconds to run
- Outputs committed static JSON + image files

It is NOT a Cloudflare Worker or runtime component. The "runtime" feeling comes from the manual-refresh model (owner runs it when content changes, then redeploys). This is correct — it matches the existing `snapshot-context.js` cadence. The alternative (a CF Worker projecting the registry on-demand) would require the registry to live on R2, which adds cost + complexity for no benefit. Commit-served static JSON is faster, cheaper, and offline-capable.

**The one genuine build-time gap:** there is no `npm run build` or `Makefile` that sequences `naam-snapshot.js → build-creative-manifest.py → naam-deploy.sh`. The owner must run them manually in order. A missed step produces a deploy where the live site has newer JS but stale data.

---

## Top 5 critical issues (ranked by silent-failure risk)

### 1 — `state.creative` not reset on hard-refresh *(medium, silent)*
**Symptom:** You-tab "Hard refresh" refetches `naam-data.json` but Creative tab still shows the old manifest from before the refresh, with no staleness indicator.  
**Fix:** In the hard-refresh handler, add `state.creative = null;` before `renderAll()`.

### 2 — Counter-UPI fetch has no AbortController timeout *(low-medium, slow)*
**Symptom:** On a slow/dropping mobile network, `renderPulse()` awaits for up to browser-default timeout (~2 min), leaving the pulse row at `…`. The 45-second re-poll interval means the next pulse render starts another potentially 2-min await.  
**Fix:** Wrap the fetch in `AbortController` with a 6-second timeout.

### 3 — Lane id / brand key contract is unvalidated *(medium, invisible)*
**Symptom:** If `naam-snapshot.js` updates a lane's `id` and `build-creative-manifest.py` hasn't been re-run, the lane-detail "N creatives" link silently shows 0. No error anywhere.  
**Fix:** Add a 5-line validation step at the end of `naam-snapshot.js` that checks every `lane.related_creative_lane` value against the manifest's `lanes[]` array and `console.warn`s on mismatch.

### 4 — `generated_at` reflects snapshot run, not data freshness *(low, invisible)*
**Symptom:** `naam-snapshot.js` stamps `generated_at` at script execution. If Codex marketing-memory is stale (lane not re-run in 2 weeks), the snapshot still shows `generated_at: today`, making the staleness banner never fire even though the underlying lane data is old. The `freshness_days` per lane is correct, but the You-tab "Snapshot" row will say "today" — misleading.  
**Fix:** Add a `memory_updated_at` field from the Codex memory's `updated_at`, separate from `generated_at`, and show it distinctly in You-tab.

### 5 — SW shell list is hardcoded *(low, future breakage)*
**Symptom:** `sw.js` has `const SHELL = ['./', './index.html', './manifest.json', ...]`. When new static files are added (new icon sizes, new data files), they won't be pre-cached unless SHELL is manually updated.  
**Fix:** Either auto-generate the shell list during deploy, or remove it from SHELL (let data use the network-first path) and only pre-cache `index.html`, `manifest.json`, and `sw.js`.

---

## If I built Naam from scratch today

I would keep the monolith (it's the right call for a single-owner offline-capable PWA), but I would make two structural changes. First, I would separate `naam-data.json` into two files: `naam-lanes.json` (hand-authored lane definitions, URLs, links — slow-changing) and `naam-metrics.json` (live glance numbers, freshness — fast-changing via cron). The snapshot script then only touches `naam-metrics.json`, so a metrics update never risks corrupting the lane schema, and the diff in git is small and reviewable. Second, I would add a 10-line shell script `scripts/naam-refresh.sh` that sequences `naam-snapshot.js → build-creative-manifest.py --skip-menu-thumbs → naam-deploy.sh` with explicit exit-on-failure — eliminating the class of "stale deploy" bugs where one step is skipped. Everything else — vanilla HTML, committed static JSON, CF Pages direct-upload, manual-on-laptop cadence — I would keep exactly as-is.
