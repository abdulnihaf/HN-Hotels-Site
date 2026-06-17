# Reel-Making / Video-Editing — Context Transfer to Codex

**Purpose:** Hand the HE/NCH reel-making (video editing) execution from Claude to
**Codex (GPT-5.5, extra-high)** without re-deriving context. Codex runs on the
**laptop** (`nihafs-macbook-air`), which — unlike a cloud chat — can reach the local
video engine, the raw clips, and the Tailscale fleet. This file is the single
source of truth for the handoff; read it top to bottom before acting.

> **Confidence tags used below:** `[repo]` = verified in this repository ·
> `[owner]` = stated by Nihaf / known to the system but NOT verifiable from the repo
> (Codex should confirm locally before relying on it) · `[infer]` = reasonable
> inference, treat as unconfirmed.

---

## 0. Role split (do not violate)

- **Claude Code = execution engine** on the laptop/fleet. **Cloud chat = analysis only.** `[repo: docs/SPINE-ENDPOINT.md]`
- For this lane, **Codex now drives execution** of reel-making while Claude tokens are conserved.
- **Money is stored in paise (INTEGER).** Convert to rupees only at the display layer. `[repo: CLAUDE.md]`
- **No build pipeline inside `HN-Hotels-Site`** (vanilla HTML/JS/CSS, Cloudflare Pages, no npm/Vite). `[repo: CLAUDE.md]`
  The video engine is a **separate project** and is exempt — do NOT add Remotion/npm into this repo.

---

## 1. Where the video engine actually lives (NOT in this repo)

| Thing | Location | Sync state |
|---|---|---|
| **HE video engine** (Remotion + spine recipe) | `~/Documents/Tech.nosync/he-video-engine/` | `[repo: docs/DIWAN-CENSUS.md:311]` `.nosync` → **never synced, never committed**. Lives only on the laptop. |
| **Raw clips** | `~/Documents/HE-Raw-Clips/` | `[repo: DIWAN-CENSUS.md:193 / ARCHITECTURE.md:193]` **NOT auto-synced** — on-demand SSH copy, too large for continuous sync. |
| **Clip intelligence** | `~/Documents/HE-Raw-Clips/CLIP-INTELLIGENCE.md` | `[repo: graph.json:481]` local only |
| **May-25 batch classification** | `~/Documents/HE-Raw-Clips/NEW-BATCH-2026-05-25-CLASSIFICATION.md` | `[repo: graph.json:484]` local only |
| **Lane prompt** | `~/Documents/Tech/HN-Hotels-Site/_context/Marketing_Execution_Terminals_2026-05-24/prompts/11-reel-making.md` | `[repo: reel-making.json:19]` local only |
| **Resume prompt** | `~/.local/share/hn-marketing-memory/resume-prompts/reel-making.md` | `[repo: reel-making.json:20]` local only |

**Remotion status:** `[owner]` Remotion is already added to the engine project.
It is **not** installed in this repo and must not be. `[repo]` confirms zero
Remotion/npm/`package.json` anywhere in `HN-Hotels-Site`.

**First thing Codex should do on the laptop:** `ls ~/Documents/Tech.nosync/he-video-engine/`
and read its `package.json` / `remotion.config.*` / `src/` to recover the real
composition + render setup. That is the ground truth this repo cannot hold.

---

## 2. The render / GPU aspect — `hn-rtx-worker`

`[repo]` `hn-rtx-worker` is a **third fleet appliance** referenced in code:
- `functions/api/otp-inbox.js:10` — "the login driver on **hn-rtx-worker** reads the freshest unconsumed code"
- `functions/api/hyperpure-prices.js:2` — "the scout on **hn-rtx-worker** scrapes the logged-in Hyperpure account"

So its **confirmed** roles today are scraping/automation (Sauda login driver +
Hyperpure price scout). Reachable over **Tailscale SSH** like the rest of the fleet.

`[owner / infer]` The name "RTX" implies an **NVIDIA RTX GPU**, i.e. this is the
intended **GPU render box for Remotion/FFmpeg** (GPU-accelerated encode). **This
render role is NOT documented in the repo** — `hn-rtx-worker` is **absent from
`fleet/devices.json`** (only `nihafs-macbook-air` and `hn-winpc` are inventoried).

**Action for Codex (do not assume):**
1. SSH in, confirm the box, GPU model, driver/CUDA, and whether FFmpeg has
   NVENC (`ffmpeg -encoders | grep nvenc`) and whether Remotion's GPU/`--gl`
   path or a render queue is set up.
2. If the GPU render role is real and undocumented, **add `hn-rtx-worker` to
   `fleet/devices.json`** (role, IP, GPU, capabilities) so the fleet is honest.
3. Treat it as a **shared appliance** — follow the multi-tenant rules in §4.

---

## 3. The reel-making pipeline + hard guardrails

`[repo: ops/marketing-control/state/lanes/reel-making.json + graph.json #11]`

**Lane #11 "Reel Making" — scope:**
`raw clip classification → reel briefs → footage readiness → storyboarding →
FFmpeg/Remotion/VN-ready exports → reel system memory.`

**Design Spine recipe** `[repo: DIWAN-CENSUS.md:311]`:
- **Figma = finishing/production.** **Gemini/Recraft = imagery generation.**
- **ONE PRINCIPLE:** food = **real photo matched to real-photo style**;
  structured/brand = pure vector. (Applies to video creative too.)
- "HE video-creative spine recipe built; engine lives at `~/Documents/Tech.nosync/he-video-engine/`."

**GUARDRAILS — non-negotiable** `[repo: graph.json:474, reel-making.json]`:
- **No wrong-food substitution.** An exact dish/combo reel uses **only Tier-1
  exact clips** of that dish + ambience. Never substitute a similar-looking dish.
- **Candidate clips need Nihaf confirmation** before any exact claim.
- **Open confirm before use:** are `IMG_0435`, `IMG_0449`, `IMG_0476` actually
  ghee rice? Do NOT use them in exact ghee-rice offer reels until Nihaf confirms.
- **Claim accuracy is the lane's stated risk** ("creative publishing and claim accuracy").

---

## 4. Fleet / appliance rules (if Codex touches any machine)

`[repo: CLAUDE.md + fleet/MULTI-TENANT-WINPC.md + fleet/devices.json]`

- **Transport:** Tailscale SSH. Tailnet `taile7bb4d.ts.net`. `[repo: devices.json]`
- **`hn-winpc`** (`ssh "HN Hotels@hn-winpc"`, quoted — username has a space) is a
  **shared** appliance running aggregator-pulse + modash-driver + dine-aggregator.
  **Never** `taskkill /IM chrome.exe /F` or `Stop-Process chrome` — that kills the
  aggregator. Filter by user-data-dir. Read `fleet/MULTI-TENANT-WINPC.md` and the
  live manifest before mutating. Namespace everything (`C:\hn-control\<purpose>\`,
  tasks `HN-<Purpose>-<Job>`).
- **`hn-rtx-worker`** — assume similarly shared (it runs the Sauda login driver +
  Hyperpure scout). Do not disturb those. Namespace any render job.
- **`nihafs-macbook-air`** — the dev workstation; where Codex itself runs.

---

## 5. What has ALREADY been executed (so Codex doesn't redo it)

`[repo: reel-making.json updated 2026-05-31, last_run 2026-05-25]`

1. **Reel Making lane created** and seeded with HE video-engine context.
2. **38-clip "May 25 Hanin batch" classified:**
   - **Tier-1 safe (usable for exact claims):** plated tandoori chicken, red
     chicken tikka, table-spread, roti / rumali roti, venue/counter, takeaway
     packaging footage.
   - **Candidates needing Nihaf confirm:** ghee rice (IMG_0435/0449/0476).
   - **Still UNSAFE for exact claims (no Tier-1 footage yet):** Butter Chicken,
     Dal Fry, Butter Naan, Brain Dry, Mutton Biryani, Chicken Lollipop, Shawarma,
     Fried Rice, Noodles.
3. **Design Spine video-creative recipe built** (engine in Tech.nosync).
4. **Mutation status:** creative memory + classification only — **no reel posted,
   no ad spend, no POS/Odoo/WABA/aggregator/PiSignage/customer-facing change.**

**Not yet done:** no reel actually rendered/exported; no GPU render pipeline
documented; `hn-rtx-worker` render role unverified; footage gaps above unfilled.

---

## 6. Suggested next actions for Codex (pick with Nihaf)

1. Recover engine ground truth: read `~/Documents/Tech.nosync/he-video-engine/`
   (Remotion compositions, render script, the spine recipe file).
2. Verify `hn-rtx-worker` GPU + NVENC + render path; document it into
   `fleet/devices.json` if real.
3. Pick ONE Tier-1-safe dish (e.g. tandoori chicken) and produce a single
   end-to-end reel as the **repeatable template** — brief → storyboard →
   Remotion render → export — respecting the no-wrong-food guardrail.
4. Get Nihaf's ghee-rice confirmation (IMG_0435/0449/0476) to unlock that hero.
5. Identify which heroes still lack Tier-1 footage and request a shoot list.

---

## 7. Write-back (lane memory is authoritative)

This lane is `writeback_required: true`. After execution, update
`ops/marketing-control/state/lanes/reel-making.json` (and mirror in
`ops/marketing-control/state.json`) with: `last_task`, `last_summary`,
`next_action`, `mutation_status`, `last_run_at`. Keep `mutation_status` honest
about exactly what was/wasn't changed. P&L line for spend: `5.4.4 Video
production (reels, promos)` `[repo: docs/PNL_STRUCTURE.md:262]`.

---

## 8. Live data, if Codex needs business numbers

SPINE (`https://hnhotels.in/api/spine`, read-only, token held by Nihaf) serves
revenue/payments/attendance/aggregator/marketing — but **has NO video/reel
resource** (verified: no match in `functions/api/spine.js`). For reel context,
rely on the local clip-intelligence files in §1, not SPINE.
