# Darbar Hiring — WhatsApp Campaign Engine — EXECUTION SPEC (flow #2)

> Self-contained build spec for the in-app WhatsApp hiring campaign engine. Read alongside
> `docs/DARBAR-HIRING-RECON.md` (the verified recon — §8 has the exact engine surface, exclusion source,
> iOS integration points, ship pipeline). Built ON TOP of the live, shipped Phase-1a (supplier call list).
> Execution target: Kimi 2.7 (Thinking). Laws: SPINE + EXECUTION-DNA-SPINE (no-regression, derive-don't-ask,
> verify-against-reality, autonomous, COA). Author: Claude (Opus 4.8), 2026-06-26.

## 0. What we're building (one paragraph)

Inside the native Darbar iOS app, the owner picks a role → the app shows the right hiring poster → he sets a
**commission** → it sends a brand-correct WhatsApp campaign (Hamza Express number for HE roles, Nawabi Chai House
number for NCH roles) to the right audience, **never to current staff**, and triages the replies. The engine is
**intelligent, not a lookup**: it routes each role to the channel that actually works for it, scores by churn ×
supply × responsiveness, learns from outcomes, and tailors/classifies messages with an LLM.

## 1. Ground truth (verified live 2026-06-26 — do not re-derive, but DO re-verify before mutating)

- **D1:** binding `DB` → database `hn-hiring` (id `a0107321-790a-4d46-ac3c-a54a676c6bcb`). Shared by Darbar
  (`hr_employees`…) AND the hiring engine (`candidates`, `campaigns`, `messages`, `conversations`,
  `webhook_events`, `template_media`, `hiring_suppliers`, `hiring_supplier_calls`). → exclusion = same-DB JOIN.
- **Contacts:** `candidates` = 2,646 phone-verified (Apna job-seekers), 659 never contacted, ~1,760 Bangalore.
  Role mix skewed to skilled/FOH (Manager 562, Captain 273, Supervisor 273, Kitchen Helper 266, Waiter 215,
  Cashier 203, cooks ~250); **THIN on cleaners (53), no dishwasher bucket**. 30 graded suppliers live.
  Exclusion set = 23 active-staff phones (`hr_employees WHERE is_active=1 AND phone IS NOT NULL`).
- **WABA (Meta Cloud API, Graph v21.0):** HE sender `918008002049` (`WA_PHONE_ID`=970365416152029,
  `WA_ACCESS_TOKEN`). NCH + brand split via comms-core env pattern: `WA_HE_*` / `WA_NCH_*`
  (`*_PHONE_ID`,`*_TOKEN`,`*_WABA_ID`), fallbacks `WA_COMMS_TOKEN`→`WA_ACCESS_TOKEN`. Templates are **per-WABA**
  (an HE template and an NCH template are separate creates). Webhook = `POST /api/hiring`.
- **Existing engine (REUSE):** `functions/api/hiring.js` — `create_campaign`, `send_batch` (20 @60ms, builds
  template components incl. header image `link` + body `{{n}}` vars at send), `create_template` (image header via
  resumable upload → `template_media`), `templates`, `inbox`, `conversation`, `reply`. **HE-only today** (single
  `WA_PHONE_ID`/`WA_ACCESS_TOKEN`) — make brand-aware ADDITIVELY (default `brand='he'` → zero HE regression).
- **Darbar surface (REUSE):** `functions/api/hiring-darbar.js` (Darbar-token auth, suppliers live). iOS app
  `ios/DarbarApp/` (SwiftUI, bundle `com.hnhotels.darbar`, Team `FZ58DQ52QS`, HK kit, accent `0x5B86C9`, Hiring
  tab = `DarbarHiringTab.swift`, TestFlight build 7). Ship = archive→export(app-store)→altool, ASC key
  `AuthKey_WSN6HFLA5F` (issuer `e892dd20-b122-413b-9132-8687ca0c1ed5`), app id `6782544979`, group "HN Internal".

## 2. Empirical findings — OUR data drives the design (these are not optional)

- **Reply rate by role (past sends):** Waiter 6.4%, Indian Cook 5.9%, Manager 5.5%, Cashier 4.1%, Supervisor 4.0%,
  Cleaners 3.4%, Captain 2.6%, Kitchen Helper 1.8%, Chinese Cook/Tandoor/Tea Master **0%**. → WhatsApp-DB works for
  **waiters/cooks/managers**; fails for cleaners/helpers/captains → the engine routes those to suppliers/referral/FB.
- **Polluted inbox (CRITICAL):** the HE WABA is also the CUSTOMER number → `conversations` mixes hiring replies
  with customer messages (`[order]`, "book a table", "combo offer"). → the hiring inbox MUST scope to
  hiring-campaign-linked replies (`conversations.campaign_id` ∈ hiring campaigns); the LLM classifier must drop
  customer-noise. NEVER treat a customer order as a candidate.
- **Deliverability:** a 772-blast had 450 failed (58%). Warm-first sending + send-safety caps are mandatory.
  Some past campaigns logged 0 delivered/read yet had repliers → webhook status capture was unreliable; the new
  engine MUST verify the webhook updates `messages.status`.
- **Templates:** `he_hiring_mar26` (workhorse) + `he_waiter_hiring` — image header + role/salary vars.

## 3. The intelligence (must be ALIVE — not a stale lookup)

**Role registry `hiring_roles`** (config, in `hn-hiring`):
`role_key, label, brand(HE/NCH), creative_key, poster_url, default_package, always_need INT, priority_score INT(0-100),
churn_rank INT, template_name, odoo_job_name, active`.
Seed by joining Darbar's Odoo jobs (`GET /api/hr-admin?action=maps` → `jobs[]`) to the C-code creative taxonomy
(C01–C28; Cleaner→C23, Washer/Dishwasher→C22, Waiter→C19, Tandoor→C17, Chai Master→C02(NCH), etc.).

**Scoring = priority × supply × responsiveness (all DERIVED, recomputed — never hand-typed):**
- `priority_score` ← churn: seed from owner order (Cleaner/Dishwasher P1 > Waiter > Captain > Cashier > Cooks/Manager),
  refine from Darbar reality (headcount per role in `hr_employees` + exit/onboard frequency over a trailing window).
- `supply` ← live `COUNT(candidates WHERE he_role=…)`.
- `responsiveness` ← historical reply rate per role (from `messages`⋈`conversations` hiring-scoped).
- **Channel routing per role** = the deterministic output:
  - high priority + thin supply + low reply (cleaner/dishwasher) → **suppliers + referral + FB** (NOT DB blast).
  - high priority + good supply + good reply (waiter) → **DB campaign + referral**.
  - low priority + good supply (cook/captain/cashier/manager) → **on-demand DB campaign** when a real need arises.
- **Learns:** a `campaign_outcomes` table logs reply→join by (role, template, incentive, language, send-time);
  the next campaign's defaults reweight toward what converted.
- **Resonates:** an LLM (Claude/Gemini keys in env) (a) tailors message variables to role/region/language/tier +
  the incentive that moves that tier, and (b) classifies each inbound reply (interested / asking salary / sending
  CV / not-now / **customer-noise**) for triage.
- **Advises the owner:** the roles board surfaces ranked nudges with honest confidence ("cleaners heating up: N
  exits this week, M fresh leads → suppliers+referral"; "K warm waiters replied, never joined → re-engage").

## 4. The WABA template model (ONE flexible template per brand — fewest approvals)

WhatsApp passes the header **image as a `link` at send time** + body `{{n}}` vars per message → no per-role
template. Approve **`hn_hiring_v1` on HE WABA and on NCH WABA** (2 creates, one-time Meta approval ~1h–1day):
- HEADER = IMAGE (the role's poster, swapped per campaign via `template_media` link).
- BODY vars: `{{1}}=role(s)`, `{{2}}=package`, `{{3}}=commission`. Commission is the **per-campaign variable**.
- Body copy: short, warm, ONE CTA, vernacular-friendly, leads with the incentive that converts the tier (free
  food+stay / weekly off / on-time pay / immediate joining; 1918 heritage as trust). Keep it MARKETING-category
  compliant. (Kimi: VERIFY current Meta marketing-template rules + India per-conversation pricing live.)

## 5. Build sequence (additive; each step self-tests; HE must never regress)

1. **Role registry** — `schema-hiring-roles.sql` + `data/hiring-roles-seed.sql` (apply via wrangler, creds in
   §7); `hiring-darbar.js` `GET ?action=roles` (grouped, scored, with channel routing + nudges).
2. **Posters** — gather `/Users/nihaf/Documents/Design/Hiring/HR-*/*-WA-*.png`, web-optimise (~200KB), commit
   under `hiring/posters/<role_key>.jpg` (served at `https://darbar.hnhotels.in/hiring/posters/…`); store
   `poster_url`. Missing roles → `~/.local/bin/ai-image` (model `gemini-2.5-flash-image-preview`, `GEMINI_API_KEY`,
   HE brand DNA, **vector law: Gemini renders background/photo only**, aspect 1:1).
3. **Brand-aware WABA** in `hiring.js` (additive, default `he`): `getWabaConfigForHiring(env, brand)` (HE=`WA_HE_*`,
   NCH=`WA_NCH_*`); thread `brand` through `metaGraphAPI`/`sendWhatsApp`/`uploadImageToMeta`/`create_template`/
   `send_batch` (campaign carries `brand`). Add `'commission'` to the `variable_mapping` builder. Add
   `exclude_staff` to the `create_campaign` candidate query: `AND phone NOT IN (SELECT phone FROM hr_employees
   WHERE is_active=1 AND phone IS NOT NULL)`. Create `hn_hiring_v1` on both WABAs; poll APPROVED.
4. **Compose orchestration** — `hiring-darbar.js`: `GET ?action=audience_preview&role=&brand=&city=` (total vs
   after-exclusion); `POST ?action=compose` {role_key, brand, commission, audience, city?} → registry lookup →
   `hiring.js create_campaign` (exclude_staff=1, commission var, `template_media` link = poster_url) → returns
   campaign id + queued count; `POST ?action=send` → `send_batch` on the right WABA with safe pacing/caps.
5. **iOS compose UX** (additive, iOS 26 Liquid Glass tinted to HK, availability-gated, fallback ≥iOS17):
   roles board (scored, always-need group on top, poster thumbnails, nudges) + `DarbarComposeSheet.swift`
   (role → brand auto → commission control → live audience preview (roster-excluded) → WhatsApp-accurate
   message+poster preview → send) + a **hiring inbox** (campaign-scoped replies only, LLM-classified, 24h
   quick-reply, mark interested/hired → Darbar onboard). Extend `DarbarSheet`/`DarbarClient`/`DarbarModels`/
   `DarbarAppModel`/`DarbarHiringTab`. Ship TestFlight **build 8** (bump `project.yml` CFBundleVersion→8).

## 6. Verification (against reality — never claim done off a compile)

1. `curl darbar.hnhotels.in/api/hiring-darbar?action=roles` (mint token: `POST /api/darbar?action=auth {pin:"0305"}`)
   → roles scored + reachable `poster_url`s.
2. `hn_hiring_v1` APPROVED on BOTH WABAs; HE's existing campaigns still send (dry `test_template` on HE) — no regression.
3. `audience_preview` total vs after-exclusion; the excluded set == the 23 active-staff phones.
4. **Real test send to Nihaf's own number** (1-number audience): WhatsApp arrives with the right poster, role,
   package, commission, from the correct brand number (HE and NCH each once).
5. iOS: sim build green → TestFlight build 8 VALID → attached to "HN Internal"; owner previews + test-sends on device.
6. Full 5-tab Darbar app builds + runs; HE engine unaffected.

## 7. Deploy / creds / ship (by NAME, never print)

- `source ~/.hn-assets.env`. Cloudflare D1-write: `CLOUDFLARE_API_TOKEN=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_API_TOKEN_D1_WRITE`,
  `CLOUDFLARE_ACCOUNT_ID=$HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_ACCOUNT_ID`. Seed/migrate:
  `wrangler d1 execute hn-hiring --remote --file=…`. Backend deploy = commit→push→`gh pr merge --squash --admin` to
  main (CI deploys to darbar.hnhotels.in). iOS ship pipeline + ASC key: see `docs/DARBAR-HIRING-RECON.md` §8.3 +
  memory `testflight-distribution` / `ios-shipping-wireless-testflight` (xcodegen→archive `/tmp` clean→export
  app-store with ASC key→altool→poll VALID→attach build to group). Pin `HUKUM_TEAM=FZ58DQ52QS`; never `kill -9` codesign.

## 8. Laws / guardrails
- NO REGRESSION: HE engine keeps working; verify the whole chain each change.
- NEVER message the 23 active staff; respect send-safety caps + warm-first; the inbox is customer-polluted — scope it.
- AUTONOMOUS: do merges/deploys/ASC yourself; route to Nihaf ONLY: a phone test, ground truth only he holds, or
  approving money / a real outward broadcast to candidates. Commission ₹ levels + a real broadcast = his approval.
- Report verified facts + gaps; never say "done"/"excellent".
