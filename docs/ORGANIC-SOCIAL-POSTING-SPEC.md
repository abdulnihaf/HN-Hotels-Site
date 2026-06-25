# Organic Social Posting — Idea-to-One-Click-Post Engine — EXECUTION SPEC (Chat 28)

> Self-contained build spec for the organic posting flow across Facebook Page, Instagram, and Google Business
> Profile. You own Hukum **Chat 28 / Organic Social Posting**. This is mostly greenfield (nothing publishes today)
> but every primitive exists — tokens, image generator, brand kit, and the proven approve→cron→fire-API pattern.
> Do NOT touch / loosen `functions/api/naam-actions.js` (its 403 mutation-guard is law) — build a SEPARATE surface.
> Execution target: Kimi 2.7 (Thinking). Laws: SPINE + EXECUTION-DNA-SPINE (no-regression, derive-don't-ask,
> verify-against-reality, autonomous, COA). Author: Claude (Opus 4.8), 2026-06-26.

## 0. What we're building (one paragraph)

A six-step posting flow the owner runs from the Naam app: (1) an **intelligence input** decides WHAT to post —
**pluggable**, the owner wires the brain later; (2) the engine writes the **post copy** per channel; (3) the owner
**approves**; (4) the owner can give **suggestions** → it regenerates; (5) it generates the **image at the right
aspect ratios** (IG 1:1 / 4:5 / 9:16, Google 4:3, FB) and hosts them publicly; (6) one more **click** and it
posts to Facebook, Instagram, and Google Business Profile. The owner approves twice (the copy, the final post);
everything in between is the engine's.

## 1. Ground truth (verified live 2026-06-26 — do not re-derive, but DO re-verify before mutating)

- **Naam today is read-only.** `naam/index.html` (PWA, PINs `0305`/`1918`, HE↔NCH toggle), `functions/api/
  naam-actions.js` (D1 table `naam_decisions`, approve/hold decision RECORDS only — hard 403 on
  `/launch|pause|resume|budget|spend|mutate|campaign_status/i`). It posts NOTHING. Leave it intact.
- **Nothing organic publishes anywhere yet.** Every `graph.facebook.com` call in the repo is WABA messaging or
  ads-read (`functions/api/meta-ads.js`). No `/feed`, no IG `/media`+`/media_publish`, no GBP `localPosts` exists.
  `functions/api/fb-posting.js` is FB-**Group** browser-automation (good schema/queue precedent, NOT a publish API).
- **D1:** binding `DB` → database `hn-hiring` (id `a0107321-790a-4d46-ac3c-a54a676c6bcb`). Self-provision new tables
  with `CREATE TABLE IF NOT EXISTS` exactly like `naam-actions.js`.
- **Publish primitives (build these):**
  - **FB Page:** `POST graph.facebook.com/v21.0/{PAGE_ID}/feed` {message, link} or `/{PAGE_ID}/photos`
    {url|source, caption} — single call, returns post id.
  - **Instagram (image MUST be a public https URL):** two-step — ① `POST /{IG_BUSINESS_ID}/media`
    {image_url, caption} → creation id; poll `?fields=status_code` until FINISHED; ② `POST
    /{IG_BUSINESS_ID}/media_publish` {creation_id}.
  - **Google Business Profile:** `POST mybusiness.googleapis.com/v4/{account}/{location}/localPosts`
    {languageCode, summary, callToAction, media:[{mediaFormat:'PHOTO', sourceUrl}]} — sourceUrl must be public https.
- **Image generation (exists):** `~/.local/bin/ai-image --model <m> --aspect <r> --out <path> "<prompt>"`
  (self-sources `GEMINI_API_KEY`). For food use `--model gemini-3.1-flash-image` (Nano-Banana-Pro class); match the
  ~200 real HE dish photos (`~/Documents/Tech/hamza-express-site/assets/menu`) via reference-conditioned
  `:generateContent` (`responseModalities:["IMAGE"]`). **Brand law:** never let the model draw a logo/wordmark/
  emblem/founder — composite exact assets on top; food is photo-led, not glossy CGI.
- **Public image hosting:** repo already binds R2 bucket `EVIDENCE` (`anbar-evidence`) in `wrangler.toml`. Add a
  second public bucket `naam-creative` so IG/GBP can fetch rendered images by URL.
- **Keys (NAMES only):** Page tokens `HE_META_ACCESS_TOKEN_PAGE_ACCESS_TOKEN` / `NCH_..._PAGE_ACCESS_TOKEN`; user
  token `HN_HOTELS_SHARED_META_BUSINESS_META_USER_TOKEN` (+ `..._PERMISSIONS`); page ids
  `HE_META_FACEBOOK_FB_PAGE_ID_GRAPH_API` / `NCH_...`; IG ids `HE_META_INSTAGRAM_IG_BUSINESS_ACCOUNT_ID` / `NCH_...`;
  `HN_HOTELS_SHARED_META_GRAPH_API_VERSION`. GBP OAuth `HNHOTELS_GBP_CLIENT_ID/SECRET/REFRESH_TOKEN/SCOPE` (scope
  already includes `business.manage`); locations `HE_GOOGLE_BUSINESS_PROFILE_GBP_LOCATION_RESOURCE_NAME` / `NCH_...`;
  account `HN_HOTELS_SHARED_GOOGLE_BUSINESS_PROFILE_GBP_ACCOUNT_RESOURCE_NAME`. Copy/LLM: `GEMINI_API_KEY`,
  `ANTHROPIC_API_KEY` (use a dedicated `NAAM_*` Pages-secret copy — shared key has been invalid in prod before).

## 2. Empirical findings — reality drives the design (these are not optional)

- **The IG/GBP public-URL rule is the load-bearing constraint.** Generated images must be `PUT` to a public R2 URL
  before the publish call — design the render step to output URLs, not local files.
- **FB/IG Page tokens expire.** Add a `GET /debug_token` health check (pattern already in `hiring.js`); if a saved
  token is short-lived, the owner re-mints a long-lived (→ non-expiring Page) token ONCE. GBP uses a refresh token
  (long-lived) — reuse `gbp-cockpit.js getAccessToken()` verbatim.
- **DESIGN-SPINE says "never ship raw Gemini; finish in Figma" — that can't sit in an auto flow.** Resolution: for
  speed-first social, replace the Figma step with a **deterministic brand-template overlay** (Cinzel hook ≤4 words,
  exact logo composited, text in safe zones, brand-token frame) applied programmatically — and keep the owner's
  visual approval gate (the 4 previews at step 3) so nothing posts unseen.
- **Brand tokens (hard):** HE browns primary `#733316` (`#63361d #431b0b #8d5f3a #a2764b`), consumable `#581810`,
  parchment `#E0C8A0`; NCH chamoisee `#AC7E54`, dark `#5C4033`, gold `#D4A44C`. Display font **Cinzel**, UI Inter.
  **NCH carries NO "1918"** (HE/Hamza-family only). Kebab spelled **SHEEKH** everywhere.
- **Aspect targets:** IG feed 1:1 `1080×1080`, portrait 4:5 `1080×1350`, story/reel 9:16 `1080×1920`; FB 1:1
  `1080×1080`; GBP 4:3 `~1200×900` (1.91:1 also renders). Generate one brand-locked master per ratio with the same
  prompt + reference image.

## 3. The intelligence (must be ALIVE — not a stale lookup) — and PLUGGABLE

The owner wires the "what to post" brain LATER. Make step 1 a swappable input: `idea_source` is an open field and
`create_draft` accepts a fully-specified idea object `{brand, channels[], theme, occasion?, item?, angle?,
reference_image?}`. Any future brain (a cron, QISSA, a Claude call) simply inserts a `status='idea'` row — the
copy→approve→render→post machinery downstream does not care where the idea came from. Everything else is alive:
copy is generated per channel (brand-voice locked, SHEEKH, 1918 for HE only, ONE CTA, channel-appropriate
hashtags), regeneration takes the owner's free-text guidance, and the publish step writes back real post ids.

## 4. The data/model spec — `naam_posts`

New self-provisioning D1 table `naam_posts` (binding `DB`), modeled on `naam_decisions`:
`id, brand, channels(JSON e.g. ["fb","ig","gbp"]), idea_source, idea_json, copy_json(per-channel
caption/hook/cta/hashtags), image_keys_json(public R2 URLs per aspect), status('idea'|'drafted'|'approved'|
'rendering'|'rendered'|'publishing'|'posted'|'failed'), guidance_note, precondition_check(JSON), result_json
(per-channel post id or error), requested_at, posted_at`. Status is the spine of the whole flow.

## 5. Build sequence (additive; each step self-tests; Naam decision-loop must never regress)

1. **Table + API** — `naam_posts` (self-provision) + `functions/api/naam-post.js` (mirror naam-actions.js auth /
   CORS / PIN; SEPARATE from naam-actions.js): actions `create_draft`, `list`, `approve`, `regenerate`, `result`.
   *Self-test:* create a draft row from a sample idea → `list` returns it; naam-actions.js 403 guard still intact.
2. **Copy generation** — per-channel `{caption, hook, cta, hashtags}` via the LLM, brand-voice locked.
   *Self-test:* generate for a sample idea → no banned content (no NCH "1918", correct SHEEKH spelling, one CTA).
3. **Image render + R2** — render the hero at all aspects (food = `gemini-3.1-flash-image`, match real-photo style,
   composite exact logo, never model-draw marks) → `PUT` to public `naam-creative` R2 → store URLs in
   `image_keys_json`. *Self-test:* render one idea → 4 public URLs, each reachable + correct dimensions.
4. **Publish workers (build DRY by default)** — FB `/feed`+`/photos`; IG `/media`→poll→`/media_publish`; GBP
   `/localPosts` (reuse `getAccessToken()`); Meta token `debug_token` health check.
   *Self-test:* dry-run returns the exact valid payload per channel **without sending**.
5. **Approve → cron → post** — a Cloudflare cron polls `status='approved'` → verifies preconditions (image
   rendered + public URL + token healthy) → fires per-channel → writes post ids/errors → `status='posted'`.
   *Self-test:* in dry mode a row flows draft→approved→(would-post) with payloads logged; live posting stays gated.
6. **UI** — extend `naam/index.html` (new tab or card): copy + the 4 aspect previews + **Approve / Regenerate
   (guidance box) / Post** buttons; same PIN gate + offline-mirror pattern. *Self-test:* full build, PIN gate works,
   a draft is approvable and a (dry) post is firable from the phone.

## 6. Verification (against reality — never claim done off a compile)

1. `curl '<deploy>/api/naam-post?action=list&brand=HE'` → drafts list.
2. Create a draft from a sample idea → copy generated, brand-correct.
3. Regenerate with owner guidance text → copy (and/or image) changes accordingly.
4. Render → 4 aspect images live at public R2 URLs, correct dimensions.
5. **Dry-run all three channels** → FB/IG/GBP payloads valid (IG container reaches FINISHED), nothing posted.
6. NO regression: `naam-actions.js` decision loop + its 403 guard unchanged; Naam's existing 4 tabs still work.

## 7. Deploy / creds / ship (by NAME, never print)

- `source ~/.hn-assets.env`. D1-write: `CLOUDFLARE_API_TOKEN=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_API_TOKEN_D1_WRITE`,
  `CLOUDFLARE_ACCOUNT_ID=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_ACCOUNT_ID`. Add the `naam-creative` R2 binding to
  `wrangler.toml` (public bucket). API functions deploy with the main `hn-hotels-site` project (CI); the Naam UI is
  its own `naam-ec8` Pages project (`scripts/naam-deploy.sh`, direct upload) — respect that split + its CORS list.
- Commit on a `kimi/*` branch → push → draft PR → (owner/Claude merges, CI deploys). New secrets via `hn-save`.

## 8. Laws / guardrails

- NO REGRESSION: do NOT touch/loosen `naam-actions.js` or its 403 mutation-guard; the publish flow is a SEPARATE
  endpoint + worker. Naam's existing tabs keep working.
- NEVER let the image model draw a brand mark/wordmark/founder — composite exact assets; food is photo-led; NCH has
  no "1918"; SHEEKH spelling.
- AUTONOMOUS: do branches/PRs/migrations/builds yourself; build the whole machine in DRY mode. Route to Nihaf ONLY:
  (a) approving the copy (step 3), (b) the final post click (step 6 — the one outward action), (c) a one-time token
  re-mint or any spend. Build to the edge of the post and stop there.
- Report verified facts + gaps; never say "done"/"excellent". Log decisions to `~/.ai-coordination/kimi-decisions.log`
  and the organic-social-posting result-ledger.
