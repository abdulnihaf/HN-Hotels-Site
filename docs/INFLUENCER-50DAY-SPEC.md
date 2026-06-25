# Influencer Marketing — Link-to-50-Outreaches-a-Day Engine — EXECUTION SPEC (Chat 17)

> Self-contained build spec for the autonomous influencer outreach loop. You own Hukum **Chat 17 / Influencer**.
> Built ON TOP of a real, ~85%-complete machine shipped 2026-05-15 (commit "feat(modash): discovery scaling —
> 50/day pipeline") that is **dormant** — your job is to resurrect it, wire the owner's gold link as the fuel,
> and switch it on. This is NOT greenfield. Do NOT rebuild what exists; extend it.
> Execution target: Kimi 2.7 (Thinking). Laws: SPINE + EXECUTION-DNA-SPINE (no-regression, derive-don't-ask,
> verify-against-reality, autonomous, COA). Author: Claude (Opus 4.8), 2026-06-26.

## 0. What we're building (one paragraph)

The owner hands the system **one link** — a "gold-mapping / extraction link": a Modash discovery-list export (a
URL, or a CSV/JSON of Bangalore food creators, with handles ± follower/contact fields). From that link the engine
**takes over end-to-end**: it imports and de-dupes the creators, enriches each handle for free into a contactable
lead (email / phone / WhatsApp pulled from the IG bio), scores and tiers them for fit, drafts a personalized
opener, and sends a steady **≥50 outreaches every day** on the safest rail, then tracks replies and follows up.
The owner's only jobs are: paste the link, and approve going live + any spend. Everything else is the engine's.

## 1. Ground truth (verified live 2026-06-26 — do not re-derive, but DO re-verify before mutating)

- **D1:** binding `DB` → database `hn-hiring` (id `a0107321-790a-4d46-ac3c-a54a676c6bcb`). The influencer tables
  live in this SAME database as Darbar + hiring, so cross-joins (e.g. exclude already-contacted) are one-DB JOINs.
- **The machine already exists (REUSE, do not rebuild):**
  - `functions/api/influencer-pipeline.js` (~70KB) — the brain. Actions already built: `cron-discover`,
    `cron-enrich-tick`, `cron-score`, `cron-outreach-wave` (the 50/day send), `modash-next-job`,
    `modash-job-done`, `modash-register-profile`, `modash-enqueue-job`, `set-config`, `trigger-now`, `status`,
    `runs`, `config`, `queue`.
  - `functions/api/influencer-bio-pulse.js` (+ `schema-influencer-bio-pulse.sql`) — the FREE extraction engine.
    Hits IG's public endpoint `i.instagram.com/api/v1/users/web_profile_info/` (header `x-ig-app-id:
    936619743392459`, no token, zero cost), regex-extracts emails/phones/wa.me numbers from bio + bio link.
    Self-throttles 6–9s/request (~9 calls/30s before IG throttles). Writes the master creator DB `influencer_bio_pulse`.
  - `functions/api/_lib/influencer-tier.js` — `scoreRelevance()` (0–10 on BLR signal, food vertical, Dakhni/halal
    fit, ER, recency), `tierOf()` (T0–T7 by followers), `outreachBucket()` (T0 skip, T1–T4 cold-barter feasible,
    **T5+ 60K+ = MANUAL_CASH, never auto-sent**).
  - `functions/api/influencer-outreach.js` — message build + send/queue per channel + `create-batch`/`log`.
  - `functions/api/influencer-bookings.js` (+ `schema-influencer-bookings.sql`) — outreach_token → booking shell →
    5-slot self-serve picker closes `influencer_outreach_log.status='booked'`.
  - `workers/influencer-pipeline-cron/src/index.js` — the Worker clock (auth via `X-Cron-Token`): 4 daily POSTs —
    `cron-discover` (22:00 UTC), `cron-enrich-tick` (22:30), `cron-score` (23:00), `cron-outreach-wave` (04:30).
  - `scripts/influencer_email_sender.py` — local Mac email sender (Gmail App Password). **This is the weak link**
    for autonomy (see §3/§5 — Cloudflare Workers cannot open SMTP).
  - `hn-winpc/modash-driver/poller.js` (+ `HOWTO.md`, `install.ps1`) — Playwright Modash scraper on the Windows
    appliance. **Scaffold, never run live; selectors unverified.** With a gold link you can mostly BYPASS this.
- **D1 tables (exist):** `influencer_bio_pulse` (master), `influencer_bio_pulse_runs`, `influencer_discovery_queue`,
  `influencer_discovery_vectors`, `influencer_pipeline_runs`, `influencer_pipeline_config` (the live control knobs),
  `modash_profiles`, `modash_jobs`, `influencer_slots`, `influencer_bookings`, `influencer_outreach_log` (the single
  outreach source of truth, `UNIQUE(username)`), view `v_influencer_outreach_summary`, `influencer_applications`.
- **Outreach channels available:** Email (safest — `scripts/influencer_email_sender.py`), WABA (`sendWaba()` in
  `functions/api/_lib/comms-core.js`, template `he_influencer_barter_v1`), IG DM (payload only, NOT auto-sendable).
- **Keys (NAMES only):** `APIFY_API_TOKEN`, `ANTHROPIC_API_KEY` (use a dedicated `INFLUENCER_*` copy as a Pages
  secret — the shared key has gone invalid in prod before), `DASHBOARD_API_KEY`, `HE_WHATSAPP_BUSINESS_API_*`,
  `HE_META_INSTAGRAM_IG_*`, `HN_HOTELS_SHARED_META_BUSINESS_META_USER_TOKEN`. **No `MODASH_*` key exists** — Modash
  is cookie-session (the driver rides browser logins). Email needs `GMAIL_FROM`/`GMAIL_APP_PASSWORD` (in `.env.local`).

## 2. Empirical findings — reality drives the design (these are not optional)

- **The link replaces discovery.** The fragile Modash scraper and the paid Apify vectors are the *replenishment*
  layer. For v1 the owner's gold link IS the fuel — feed its handles straight into enrich → score → send and
  largely skip the scraper. Do not block the loop on getting Modash automation working.
- **Email is the only clean 50/day rail.** WABA to cold, non-opted-in creators tanks Meta quality tier and gets
  the number flagged (and the owner's standing direction de-prioritizes WABA for acquisition). IG DM automation
  gets accounts action-blocked fast. → **Email-first as primary**; WABA/IG-DM reserved for HERO creators or warm
  replies only. The existing `cronOutreachWave` already buckets HERO(3 ch) / PRIORITY / STANDARD — keep it.
- **Contact-data hit-rate is the real constraint, not engineering.** Not every handle yields an email. Import
  generously (a few hundred from one link) so bio-pulse enrichment leaves ≥50 email-reachable creators/day.
- **The no-dish guard is law.** A past opener leaked a dish HE doesn't sell. The LLM opener must name NO menu
  items; menu lines (if any) come from live HE POS, never hardcoded.
- **The system is in dry_run and was never flipped live.** `modash_enabled=false`, `outreach_mode` never set to
  `live`. The campaign is hardcoded `may_2026_v1` throughout — make it the active campaign, not May.

## 3. The intelligence (must be ALIVE — not a stale lookup)

The owner wires no "intelligence" here — the machine already scores and routes. Your job is the *loop*, alive:

- **Ingest the link (the missing primitive).** A new action that accepts the gold link/CSV/pasted handles, parses
  to `{username, followers?, engagement_rate?, bio?, category?, external_url?, email?, phone?}`, upserts into
  `influencer_discovery_queue` (source `gold_import`), de-duped by username against `influencer_bio_pulse` +
  `influencer_outreach_log` so a creator is never re-imported or re-contacted.
- **Enrich (reuse).** Drain `gold_import` rows through `influencer-bio-pulse` (free IG endpoint, 6–9s throttle,
  ≤12/batch) → emails/phones/wa.me + ER + recency at zero cost.
- **Score + select (reuse).** `cron-score` + `influencer-tier.js` → COLD_HERO / PRIORITY / STANDARD; T5+ parked as
  MANUAL_CASH for the owner. Default daily wave = 5 HERO + 15 PRIORITY + 30 STANDARD = **50 unique/day**.
- **Personalize (reuse + guard).** One-line opener via the LLM (a dedicated `INFLUENCER_ANTHROPIC_*` Haiku key),
  **no dish names**, brand-correct (HE 1918 heritage as trust; NCH carries no 1918). Per-channel message build.
- **Send autonomously (the real new rail).** Replace the laptop Python script with a server-callable email path so
  "the engine runs it," not a human at a Mac. Build it `dry_run` first.
- **Track + follow up (new wiring).** Auto-ingest replies → `record-reply` → `status='replied'`; a follow-up cron
  (day+3) re-touches non-repliers from `influencer_outreach_log`.
- **Advise honestly.** The dashboard surfaces the daily wave (sent / reachable pool / replies / bookings) with
  honest confidence and the MANUAL_CASH shortlist for the owner.

## 4. The data/model spec — the import contract + the wave contract

**Import contract** — `influencer_discovery_queue` rows from the gold link: `username` (required, IG handle,
lower-cased, `@`-stripped), optional `followers`, `engagement_rate`, `bio`, `category`, `external_url`, `email`,
`phone`, `source='gold_import'`, `imported_at`. De-dupe key = `username`. Accept three input forms: (a) a Modash
export **URL** the driver can open, (b) a pasted **CSV/JSON**, (c) a newline list of bare handles.

**Wave contract** — one row per send in `influencer_outreach_log` (the single source of truth): `username, tier,
bucket, channel('email'|'waba'|'ig_dm'), campaign(active, not 'may_2026_v1'), message, outreach_token, status
('queued'|'sent'|'replied'|'booked'|'bounced'), sent_at`. A day's wave = ≤50 *unique never-contacted* creators,
bucket-capped, staff-/dup-excluded, each minted an `outreach_token` → booking shell.

## 5. Build sequence (additive; each step self-tests; the existing pipeline must never regress)

1. **Import primitive** — add `POST /api/influencer-pipeline?action=import-list` {url | csv | handles[]} → parse →
   upsert `influencer_discovery_queue` (source `gold_import`, dedupe by username vs bio_pulse + outreach_log).
   *Self-test:* import a 10-handle sample → confirm 10 rows, re-import → 0 new (dedupe holds).
2. **Enrich the imported pool** — confirm `cron-enrich-tick` / `influencer-bio-pulse` drains `gold_import` rows.
   *Self-test:* enrich the 10 → confirm emails/phones/ER populated, throttle respected (no IG block).
3. **Score + select (reuse)** — run `cron-score`; confirm tiers + buckets + MANUAL_CASH parking.
   *Self-test:* `cron-score` → buckets sane; a 70K creator lands MANUAL_CASH (never auto-queued).
4. **Autonomous email rail** — remove the laptop dependency: either (a) an HTTP email provider callable from the
   Worker (add a `RESEND_API_KEY`-style Pages secret via `hn-save` — owner action), or (b) port
   `influencer_email_sender.py` to an hn-winpc scheduled poller that drains `status='queued'` (mirror the
   modash-driver multi-tenant convention under `C:\hn-control\`). **Build with `outreach_mode=dry_run` default.**
   *Self-test:* dry-run a wave → 50 fully-rendered emails logged, **zero actually sent**, no-dish guard verified.
5. **Reply + follow-up loop** — wire the existing `hn-gmail-poller` (already runs for bank feeds) + the WABA inbound
   webhook → `record-reply` → `status='replied'`; add `cron-followup` (day+3 nudge to non-repliers).
   *Self-test:* simulate a reply → status flips; a 4-day-old non-replier appears in the follow-up wave.
6. **Owner surface** — a daily-wave monitor + the import box + the MANUAL_CASH shortlist at `ops/influencer/`
   (PIN-gated, mobile-first, reuse the existing `marketing/Influencer/*` UIs). *Self-test:* page renders the live
   wave, lets the owner paste a link, shows reachable-pool math honestly.

## 6. Verification (against reality — never claim done off a compile)

1. `curl '<deploy>/api/influencer-pipeline?action=status'` → live config + last run shapes.
2. Import a **real** gold link the owner provides → rows land; re-import is a no-op (dedupe).
3. Enrich a batch → contact fields populate at zero cost; IG throttle respected.
4. `cron-score` → buckets + tiers + MANUAL_CASH parking correct.
5. **Dry-run a full wave** → exactly ≤50 unique, never-contacted, staff-excluded creators; opener names no dish;
   nothing sent.
6. Confirm NO regression: the existing pipeline actions + bookings loop still work; bio-pulse still zero-cost.

## 7. Deploy / creds / ship (by NAME, never print)

- `source ~/.hn-assets.env`. Cloudflare D1-write: `CLOUDFLARE_API_TOKEN=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_API_TOKEN_D1_WRITE`,
  `CLOUDFLARE_ACCOUNT_ID=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_ACCOUNT_ID`. Migrate:
  `wrangler d1 execute hn-hiring --remote --file=…`. Backend = commit on a `kimi/*` branch → push → draft PR →
  (owner/Claude merges to main, CI deploys). Cron Worker lives in `workers/influencer-pipeline-cron/`.
- Any NEW paid spend (Apify, an email provider) or a NEW outreach secret = owner adds it via `hn-save`; never invent.

## 8. Laws / guardrails

- NO REGRESSION: the existing influencer pipeline + bookings loop keep working; bio-pulse stays zero-cost; verify
  the whole chain (import → enrich → score → wave → reply) after each change.
- NEVER auto-send to T5+ (MANUAL_CASH); never name a dish in an opener; never re-contact a logged creator; respect
  IG enrichment throttle + email warm-drip; keep WABA for HERO/warm only.
- AUTONOMOUS: do branches/PRs/migrations/builds yourself. Route to Nihaf ONLY: (a) the **gold link** (his input),
  (b) flipping `outreach_mode=live` / the first real outward send, (c) approving any spend or a new WABA template.
  Build the entire machine to the edge of that wall and stop there — never before it.
- Report verified facts + gaps; never say "done"/"excellent". Log decisions to `~/.ai-coordination/kimi-decisions.log`
  and the influencer result-ledger.
