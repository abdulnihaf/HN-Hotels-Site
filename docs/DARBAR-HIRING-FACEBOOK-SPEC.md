# Darbar Hiring — Facebook Groups Channel — EXECUTION SPEC (flow #4)

> Build AFTER the WhatsApp engine (`docs/DARBAR-HIRING-WHATSAPP-SPEC.md`) ships. Read alongside
> `docs/DARBAR-HIRING-RECON.md` (§2A = the FB group taxonomy). Execution target: Kimi 2.7 (Thinking).
> Laws: SPINE + EXECUTION-DNA-SPINE. Author: Claude (Opus 4.8), 2026-06-26.

## 0. What we're building & the owner's model

The owner thinks "I need to hire **<role>**" → from the **Darbar app**, one tap → the **HN RTX PC** posts that
role's creative to ~**30–40 relevant Facebook groups** → live progress comes back to the app. **The UX is entirely
in Darbar; the execution is on the box. The problem being solved is the owner NOT having to sit at a computer.**
At 30–40 groups/day this is low-risk — **no IP rotation, no VPN** — the static IP is fine.

## 1. What already exists (verified)

- **Queue control plane (REUSE):** `functions/api/fb-posting.js` + D1 (`hn-hiring`) tables:
  - `fb_groups(id, group_url UNIQUE, group_id, name, visibility, members_raw, members_parsed INT, posts_activity,
    category, sub_category, keywords, status DEFAULT 'active', total_posts, last_posted_at,
    last_posted_creative_id, creatives_posted, is_blocked, notes)`
  - `fb_creatives(id, name, brand, post_text, image_filename, post_type, times_used)`
  - `fb_sessions(id, creative_id, account_name, total_groups, posted_count, failed_count, skipped_count, status)`
  - `fb_posts(id, group_id, creative_id, session_id, account_name, status('queued'|'posting'|'success'|'failed'|'skipped'), error_message, posted_at)`
  - `create_session` fans a creative across active, un-posted groups (`ORDER BY members_parsed DESC`, dedupe per
    creative via `NOT IN (… fb_posts WHERE creative_id=? AND status IN ('success','queued','posting'))`).
    `update_post` flips status + bumps `fb_groups.last_posted_at/last_posted_creative_id` + `fb_creatives.times_used`.
- **Group inventory REALITY (load-bearing):** D1 `fb_groups` holds **371 rows, with `category`/`sub_category`/
  `keywords`/Joined-status all EMPTY** — a partial CSV load. The real ~1,022-group taxonomy (Joined, CAT1-5,
  LOC_*, role tags, Creatives_Posted) lives only in the Drive `FB Group` sheet (`1d0oQwrdzBOOwKbUesh8RxSHG4W0lgUF9nQtyJwG19b4`).
- **Creatives:** 15 FB-square posters exist at `/Users/nihaf/Documents/Design/Hiring/HR-*/*-FB-*.png` (All Cooks,
  Chai Master, FC Cook, Juice, Shawaya, Shawarma, Snacks, Ops Mgr, Supervisor, Cashier, Captain, Waiter…).
  **MISSING — and these are the highest-priority churn roles:** Cleaner (HR-23), Washer (HR-22),
  Kitchen Helper (HR-21), Counter Boy (HR-20), BOH-support combo. The channel cannot serve its primary purpose
  until these are generated.

## 2. THREE blockers to clear BEFORE any live run (from the completeness critic)

- **G1 (P0) — the posting endpoint is OPEN.** `fb-posting.js` `handlePost` has **zero auth, CORS:\***, no secret —
  anyone on the internet can queue/corrupt. **Auth-gate every POST** behind a shared secret (the box already
  proves the pattern with `kite-proxy`). Do this first.
- **G2 (P0) — the importer DROPS tags.** `import_groups` `ON CONFLICT(group_url)` updates only name/members/activity
  — NOT category/sub_category/keywords, and there's no Joined flag. Re-importing the tagged sheet over the 371 rows
  would silently leave selection on NULL tags. **Fix the importer to upsert all tag columns + add a `status_join`
  column, THEN re-import the full tagged sheet.** Joined-count is the real daily ceiling — confirm it from the sheet.
- **G3 (design dependency) — generate the missing Cleaner/Washer/Kitchen-Helper/Counter-Boy FB posters**
  (`~/.local/bin/ai-image`, `gemini-2.5-flash-image-preview`, HE brand DNA, vector law) before the channel can do
  its main job. A "support staff" combo poster covers the always-need group.

## 3. The selection intelligence (what the queue must add)

`fb-posting.js` today has dedupe-per-creative but NO daily cap, NO relevance filter, NO cooldown, NO rotation.
Add a **`select_groups(role/creative, brand, daily_cap=35)`** that ranks eligible groups and returns the top ~30–40:
- **Joined-only** (`status_join='Joined'`) + brand/role/location relevance (R-code + LOC_* + CAT, or name-keyword
  fallback: ~67 hospitality∩Bangalore, 142 generic-job∩Bangalore in the current 371).
- **Not already posted this creative** (existing dedupe) + a **per-group cross-creative cooldown** (don't hit the
  same group more than once every N days — read `last_posted_at`).
- **Rank by `members_parsed` DESC** with **rotation** (so the same 30 aren't hit daily) + jitter.
- Hard **daily cap** (owner-set, default 35) enforced by a per-day counter.

## 4. Low-volume safety (verdict: 30–40/day is CONFIRMED low-risk — conditions)

The binding risk at this volume is **NOT IP, NOT velocity — it is DUPLICATE CONTENT across groups.** So:
- **Vary the caption per group** (different opening line / reworded CTA — light variation is enough at this volume;
  an LLM can spin N variants of one post). Vary nothing else and you risk a spam flag + member reports.
- **Pace 2–3 min between posts**, business hours, jitter (≥90s minimum; "10 in 5 min" trips detection).
- **Warmed/aged account, joined-before-posting**, post as the appropriate identity (decide profile vs Page — owner
  decision; job groups often hold posts for admin approval).
- **Static IP is fine** (consistency = trust); IP rotation/VPN NOT needed at 30–40/day. Safe ceiling for an
  established account ≈ 35–50/day — stay at the owner's 30–40. (Kimi: re-verify current thresholds live.)

## 5. RTX execution model (isolated; the box does the work)

- **Box:** HN RTX (Tailscale `100.107.54.16`; public static IP per memory `rtx-static-ip-odoo` ≈ `106.51.242.12`,
  ACT — verify). Reached via Tailscale / cloudflared tunnel / the `hukum.hnhotels.in` secret-gated proxy pattern
  (`kite-live-order-egress`). **MULTI-TENANT — Nazar/Frigate are SACRED (`hn-rtx-worker-multitenant`): the FB
  poster runs in its OWN isolated Chrome profile/user-data-dir and never touches the camera stack.**
- **Executor:** a logged-in-Facebook browser appliance (the **aggregator-pulse extension-as-poller** pattern,
  `aggregator-selfheal-login`) that **polls the secret-gated queue** (`?action=next_job`) → posts the creative to
  each group with §4 pacing/variation → calls `update_post`. Self-heals FB login via the OTP-relay pattern. Decide
  executor tech (browser extension vs Playwright) — extension matches the proven appliance + lowest maintenance.
- **Trigger path:** Darbar one-tap → `create_session` (with `select_groups`) → box poller picks it up → posts →
  `update_post` → Darbar live progress. Static IP matters only at the FB egress.

## 6. Darbar one-click UX (in the Hiring tab, Liquid Glass)

Pick role → auto-loads the FB creative + the eligible segment ("joined · Bangalore · restaurant · 38 available
today") → preview the post (image + caption) → **tap Post** → live progress (X/38 posted, paced, pause/resume),
the daily 30–40 cap shown plainly, honest failed/pending/capped states → results (which groups landed, failures).
Reuse `fb_sessions`/`fb_posts` status. iOS 26 Liquid Glass tinted to HK; the "you're not at a computer" feeling.
Additive to the Hiring tab; no existing tabs touched.

## 7. Build sequence (each self-tests; box isolated from Nazar)

1. **Auth-gate** `fb-posting.js` (G1) — shared-secret on every POST; verify the open hole is closed.
2. **Fix importer + add `status_join`** (G2) → re-import the full tagged Drive sheet → verify tags + Joined counts populate.
3. **Generate missing posters** (G3) → load into `fb_creatives` + commit FB posters.
4. **`select_groups`** intelligence (daily cap + cooldown + rotation + relevance) → unit-verify the 30–40 picked are joined+relevant+fresh.
5. **RTX executor** (isolated Chrome profile) polling the secret-gated queue → dry-run to 1–2 test groups, confirm `update_post` + isolation (Frigate untouched).
6. **Darbar one-click UX** → ship in build (TestFlight) → owner triggers a small real run (≤10 groups) and watches progress.
7. Scale to 30–40/day only after the small run is clean.

## 8. Open decisions (owner-only)
- Which FB account/Page posts; profile vs Page. · Exact daily cap (default 35). · Which group segments are "in".
- Caption-variation appetite. · Approval before the first real multi-group run (outward-facing).

## 9. Laws
- NEVER disrupt Nazar/Frigate (isolation is hard). · Close G1/G2/G3 before any real run. · Human-paced, vary copy,
  joined-only. · Autonomous build; route to Nihaf only the outward-facing first real run + the open decisions above.
- Report verified facts + gaps; never say "done"/"excellent".
