# Darbar Hiring Flow — Recon & Architecture Log

> Living doc. Captures the deep research before building a **mobile hiring flow inside the Darbar app**.
> Darbar = staff management *after* hire. This new layer = everything *before* hire (sourcing → contact → track).
> Started 2026-06-26. Owner: Nihaf. Do not lose this thread.

---

## 1. The objective (owner's words, distilled)

Build a **mobile hiring flow** where all heavy execution runs on the backend (HN RTX box / iMac) and the
owner's experience is **click-click-click** from an app. Make it **part of the Darbar iOS app** (he loves the
Darbar UX and will not lose anything existing) — added as a NEW section, breaking nothing in
Today/Pay/Attendance/Roster. First rollout: **iOS**.

Roles being hired for (from Darbar): majorly **cleaners, dishwashers, service staff** (+ the full HE/NCH role set).

### The 4 channels, in priority order
1. **Call manpower suppliers** — owner's UX = confirm "we've called these people". Costless. **Phase-1.**
2. **WhatsApp blast (categorised)** — to manager-level people, offering **referral commission**. Costless. **Phase-1.**
3. **Apna job post** — paid/effort. **Only if channels 1+2 don't deliver.** **Phase-2.**
4. **Facebook group posting** — broad net. **Phase-2.**

> Phase-1 ships channels 1 + 2 fully (both free). Apna is the fallback when free channels miss.

### Hard rules
- **NEVER message anyone currently working at HN Hotels.** (Exclusion is load-bearing — flow #2 especially.)
- **Intelligent data segregation is paramount** — by role, brand (HE/NCH), location, channel, status.
- Heavy lifting on the backend (RTX/iMac); app is a thin click surface.
- No-regression: adding hiring must not touch the live Darbar chain.

---

## 2. What EXISTS today (verified 2026-06-26)

### A. Facebook channel — REAL and rich (Drive + repo)
**Drive: `PROJ-114 — HE & NCH Hiring Facebook Process`** (folder `1zn-7f-ooQ3-QpZ39U0-1K5nIcfHY2n2-`)
- **`FB Group`** sheet (`1d0oQwrdzBOOwKbUesh8RxSHG4W0lgUF9nQtyJwG19b4`) — master FB group DB.
  - Columns: `Group_URL, Group_Name, Visibility, Members, Posts_Activity, Keywords, Categories, Sub_Categories, Status(Joined/Not_Joined), Join_Date, Creatives_Posted, Last_Post_Date, Post_Count, Is_Blocked, Notes`.
  - ~130 curated groups in the master view; **~1,022 unique groups** in the raw scraped universe (mostly Public).
  - Taxonomy baked in:
    - **Categories**: CAT1 General-Restaurant-India · CAT2 General-Restaurant-Location · CAT3 Restaurant-Cooks-India · CAT4 Restaurant-Cooks-Location · CAT5 Role-Specific.
    - **Locations** (sub-cat): LOC_BLR, LOC_HYD, LOC_CHN, LOC_KRL, LOC_MUM.
    - **Roles R01–R21**: R01 Irani Chai Master, R07 Indian Cook, R13 Waiter, R14 Server, R15 Kitchen Helper, R16 Washer, **R17 Cleaner**, R18 Ops Manager, R19 Supervisor, R20 Cashier, R21 Captain, etc.
    - **Creatives C01–C28** (HE/NCH, Individual/Combo): C01 All_Cooks, C02 Irani_Chai_Master, C08 BOH_Support(Helper+Washer+Cleaner), C09 FOH_Main, C10 FOH_Support, C23 Cleaner, C22 Washer … Post_Text/Drive_Link columns exist but were empty in the export.
- **`FB Workflow`** sheet (`1W1CMykDfQfxvn_dK95tIAMlN1o_b6P8RL8xNzwtfiNU`) — the Apps-Script-driven engine sheet.
  - Keyword→creative routing tab (e.g. "bangalore restaurant job" → C01,C08,C09,C10).
  - Apify FB-group scrape import blocks (one per keyword).
  - Run-log: per-run `Sent` + `Skipped(Duplicates)` (dedupe confirmed).
  - **Engine config (BATCH_SIZE, BATCH_INTERVAL_SECONDS, MAX_GROUPS_PER_EXECUTION) + the Apps Script Code.gs + creative post-text were NOT in the Drive export** — they live in the bound Apps Script project / uncaptured tabs. Known values from the FB Group sheet settings tab: BATCH_SIZE=6, BATCH_INTERVAL=60s, MAX_GROUPS_PER_EXECUTION=30.
  - Supporting: `APIFY/` folder, `Apify_FB_Scraping_Setup_Guide.pdf`, `Manual_FB_Group_Discovery.pdf`, `Mohammed FB Workflow/`, `V2/` (`fb Keywords` sheet `1KCwY99...`), `Scraped/`, `Already Joined/`, `WhatsApp/`→`WA Creatives/`, `FB_Hiring_Creatives_Brief.md`.

**Repo:** `hiring/fb/index.html` (+ `hiring/fb/media/he-hiring-mar26.jpg`), `ops/fb-posting.js`.

### B. WhatsApp hiring-campaign system — REAL (repo + D1) — see §8 for verified surface
- **`functions/api/hiring.js`** (2,139 lines) — the hiring API. FULLY built & fires (Meta Cloud API).
- **D1 `hn-hiring`** schema (from Drive `schema-hiring.sql` + `schema-hiring-v2.sql`):
  - `campaigns(id, name, template_name, category, brand, role, salary, campaign_type, total_candidates, sent/delivered/read/failed_count, status, …)`
  - `messages(id, campaign_id, phone, wa_id, wamid, candidate_name, template_params, status, error_code, queued/sent/delivered/read/failed_at, has_reply, last_reply_at)`
  - `webhook_events(id, wamid, event_type, status, timestamp, error_code, raw_payload, …)`
  - `conversations(id, phone, campaign_id, message_id, candidate_name, direction, msg_type, body, wamid, status, …)` — inbox/reply tracking.
- **UIs:** `hiring/waba/index.html` (campaign sender), `hiring/enrich/index.html` (enrichment), `hiring/expansion/index.html`.
- WABA number on creatives: **8008004202** (call or WhatsApp).

### C. Darbar (the host app) — REAL
- Staff-management system; iOS app native SwiftUI (`claude/ios-darbar-native`, tabs Today/Pay/Attendance/Roster).
- Owns `staff_pin` for every employee; live roster via HR admin endpoint (the exclusion source). [exact endpoint pending workflow]

---

## 3. What is MISSING / UNCONFIRMED (the gaps to close)

1. **🔴 Manpower-supplier "call list" (channel #1 data) — NOT FOUND.**
   Drive search for consultancy/placement/agency/recruiter/contractor/labour/supplier returned only
   vegetable-vendor PO bills ("Manju-Veg-Supplier"). No agency/labour-contractor phone list exists under any
   obvious name. **Hypothesis: this dataset does not yet exist and must be BUILT via deep research**
   (owner himself said "if we do deep research and we have a big list of manpower supply people").
   → ACTION: build a graded manpower-supplier DB via deep research (Bangalore hospitality staffing agencies /
   labour contractors / placement consultancies), 5–10 highly-relevant first. CONFIRM with owner whether a
   list already exists somewhere I haven't looked (his phone / WhatsApp / another account).

2. **🟡 Manager-level referral contacts (channel #2 data).** Source unconfirmed. May overlap with the
   `hn-hiring` contact history or a WhatsApp contact export. Need to locate or build.

3. **🟡 FB engine config + Apps Script code + creative post-text.** Not in the Drive export; in the bound
   Apps Script. Need to pull from the live sheet's Apps Script editor or rebuild server-side.

4. **🟡 Apna automation** — does any exist in repo? [pending workflow `apna-fb-backend`]

---

## 4. Exclusion rule (NEVER message current staff)

- Canonical source = the **live Darbar roster** (always fresh), NOT the stale snapshot
  `HN-Hotels-Active-Staff-2026-04-18.xlsx` (Drive `19_w-waKLxfn3vnwaVD4p-Shapb4AsN_4`, PROJ-196).
- Exclusion key = phone number, normalized. Every outbound contact (WhatsApp manager blast especially)
  must be diffed against the live roster phone set before send. [exact endpoint+fields pending workflow]

---

## 5. Architecture direction (proposed — to finalize after workflow lands)

- **Host:** new "Hiring" section inside the Darbar iOS app. Additive only. Zero edits to existing tabs.
- **Backend:** a `hiring` D1-backed API (reuse/extend `functions/api/hiring.js` + `hn-hiring`), with the
  heavy/browser work (FB posting, Apna posting, scraping, supplier research) delegated to the RTX/iMac box.
- **Data model (COA lens):** every hiring contact is a coordinate —
  `channel × role(R01–R21) × brand(HE/NCH) × location(LOC_*) × status`. No free-text where structure works.
- **Phase-1 (free channels):** (1) Supplier call-list screen — tap-to-call, log outcome; (2) WhatsApp manager
  referral blast — categorised, commission offer, **roster-excluded**.
- **Phase-2:** Apna post (fallback) + FB group posting (reuse the engine).

---

## 6. Drive asset register (file IDs)

| Asset | Type | ID |
|---|---|---|
| PROJ-114 HE & NCH Hiring Facebook Process | folder | `1zn-7f-ooQ3-QpZ39U0-1K5nIcfHY2n2-` |
| FB Group (master groups DB) | gsheet | `1d0oQwrdzBOOwKbUesh8RxSHG4W0lgUF9nQtyJwG19b4` |
| FB Workflow (Apps Script engine sheet) | gsheet | `1W1CMykDfQfxvn_dK95tIAMlN1o_b6P8RL8xNzwtfiNU` |
| fb Keywords (V2) | gsheet | `1KCwY99OTeqCpdUG1hOxGVMuozItVkzRhu-vvPtHMyMY` |
| FB_Hiring_Creatives_Brief.md | doc | `143e0q14JfjOFjg3s0LZzIVkamnL6sdRr` |
| Apify_FB_Scraping_Setup_Guide.pdf | pdf | `1AESw38qJxbPJR68qUK0IeRdPbgn8UCeG` |
| Manual_FB_Group_Discovery.pdf | pdf | `1UtIgaGLwou1gy01qCQlBYpuA9g3IcKZf` |
| PROJ-196 HN Staffing Module | folder | `1EFsl--OSgKo8QtGUlTkWmd9QbEiY_J36` |
| HN-Hotels-Active-Staff-2026-04-18.xlsx (stale exclusion snapshot) | xlsx | `19_w-waKLxfn3vnwaVD4p-Shapb4AsN_4` |

---

## 7. Open questions for owner (non-blocking — keep building meanwhile)

1. The **manpower-supplier call list** — does it already exist somewhere (phone / WhatsApp / a sheet I missed),
   or should I build it from scratch via deep research? (Currently building toward "build it".)
2. Manager-referral **commission** terms (₹ per joined hire?) to put in the WhatsApp template.
3. Confirm WABA sender for hiring = **918008002049** (HE WABA, phone-id 970365416152029), templates `he_hiring_mar26` / `he_hiring_generic_mar26` already on Meta.

---

## 8. VERIFIED ARCHITECTURE & BUILD SPEC (post-workflow `wvzoammy0`, 2026-06-26)

### 8.1 The big realization — the backend mostly EXISTS; this is an integration, not greenfield
- The hiring API `functions/api/hiring.js` and Darbar both bind the **SAME D1**: binding `DB` → database `hn-hiring` (id `a0107321-790a-4d46-ac3c-a54a676c6bcb`). The Hiring tables (`candidates`, `campaigns`, `messages`, `conversations`, `webhook_events`, `template_media`) AND the Darbar tables (`hr_employees`, `hr_attendance_daily`, maps) **live in one database**. → The "never message current staff" exclusion is a **same-DB JOIN**, not a cross-service call. Clean.
- WhatsApp **fires today**: Meta Graph v21.0 from HE number `918008002049` (`WA_PHONE_ID=970365416152029`, `WA_ACCESS_TOKEN`), templates `he_hiring_mar26` (params: first_name,current_title,current_company,he_role,he_salary) + `he_hiring_generic_mar26` (he_role,he_salary). Loop: `create_campaign`→`messages(queued)`→`send_batch`(20 @60ms)→webhook `POST /api/hiring`→`conversations` inbox→`reply`.
- Roles are **Odoo-canonical**, not hardcoded: `GET /api/hr-admin?action=maps` → `jobs[].name` by company. Live active roles incl. Cleaner, Washer/Dishwasher, Waiter/Steward, Runner, cooks. (Brand→company: HE=1, NCH=10, HQ=1.)

### 8.2 Exclusion source (VERIFIED) — never message current staff
- `GET /api/hr-admin?action=employees` (active-only default) → rows from `hr_employees`; exclude on **`phone`** (TEXT, e.g. `917010426808`), name via `COALESCE(known_as,name)`. Gate = `is_active=1` (no `status` col on employees).
- Or directly: `SELECT name, known_as, phone, job_name, brand_label, staff_pin FROM hr_employees WHERE is_active=1 AND phone IS NOT NULL` on `DB`.
- Live: 26 active, 24 with phone, 23 distinct. Normalize + dedupe; ~2 phoneless are fine.
- Auth for server-to-server: `service_key = env.CAMS_AUTH_TOKEN`, or just query `DB` directly from a new Pages Function.

### 8.3 Darbar iOS host (VERIFIED) — additive, breaks nothing
- App root: `/Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site/ios/DarbarApp/` (native SwiftUI, bundle `com.hnhotels.darbar`, Team `FZ58DQ52QS`, iOS 17). Backend base `https://darbar.hnhotels.in`, auth header `x-darbar-token` (PIN 0305 → `/api/darbar?action=auth`).
- **Integration point:** edit ONLY `Darbar/DarbarView.swift` — the `TabView(selection:$tab)` (lines 16–25): add `DarbarHiringTab(model:model, sheet:$sheet).tag(4).tabItem{ Label("Hiring", systemImage:"person.badge.plus") }`. Create ONE new file `Darbar/DarbarHiringTab.swift`. No edits to Today/Attendance/Pay/Roster, sheets, model, or client. XcodeGen folder-target auto-includes the new file (`xcodegen generate`).
- Design tokens: `enum HK` in `Theme.swift` (warm-brown dark). Darbar accent `Color(hex:0x5B86C9)`. Reuse `DarbarScreen`, `DarbarBrandSeg`, `DarbarFace`, `inrLabel`. Ship = TestFlight OTA (altool + ASC key); one-time human gate = ASC app-record for `com.hnhotels.darbar` if not yet created.

### 8.4 Channel reality (VERIFIED) — what fires vs what needs a box
| Channel | State | Needs RTX/box? |
|---|---|---|
| #2 WhatsApp manager/candidate blast | **Fires today** (hiring.js, serverless) | **No** — Cloudflare + Meta |
| #1 Call suppliers | UX not built; pure `tel:`/log | **No** — phone dialer + D1 log |
| #3 Apna **post** | Does NOT exist | Yes (browser automation) — Phase 2 |
| #3 Apna candidate **pull** | `enrich_phone` proxy only (manual IDs) | partial |
| #4 FB group posting | Control plane only (`fb-posting.js` + `/hiring/fb` + tables `fb_groups/fb_creatives/fb_posts/fb_sessions`); **executor NOT built** (intended Claude-in-Chrome). Groups in via CSV (the Drive `FB Group` sheet). | Yes (browser poster) — Phase 2 |
- **Key correction to the brief:** Phase-1 (call suppliers + WhatsApp) needs **no RTX box** — it's serverless + the phone. The box is only for Phase-2 browser posting (FB/Apna). Good news: Phase-1 ships on app + Cloudflare alone.

### 8.5 Gaps to BUILD (confirmed absent)
1. **Manpower-supplier call list** (flow #1 data) — no dataset anywhere. → BUILD via deep research, graded, top 5–10. *(workflow kicked off 2026-06-26.)*
2. **Manager-referral audience** (flow #2) — `candidates` is Apna job-seekers, not managers. Need a `managers`/referral contact set (research or owner-provided).
3. **Unified mobile Hiring surface in Darbar app** — the 3 web UIs (`/hiring/waba|fb|enrich`) are separate desktop, amber-themed, NOT Darbar-styled, NOT in the app. Build the native Darbar Hiring tab.
4. **"Call suppliers" UX** (tap-to-call + log outcome) — does not exist.
5. FB engine config + Apps Script code + creative post-text (in bound Apps Script, not exported).

### 8.6 PHASED BUILD PLAN
**Phase 1 (free channels, no box):**
- 1a. Supplier call-list DB (deep research → graded 5–10) → new `suppliers` table in `hn-hiring`.
- 1b. New Pages Function `functions/api/hiring-darbar.js` (or extend hiring.js) actions: `supplier_list`, `supplier_log_call`, `manager_list`, `exclusion_set` (roster JOIN), `referral_blast` (categorised manager WhatsApp w/ commission, **roster-excluded** before send, reuses hiring.js send path + a new approved template).
- 1c. Darbar iOS **Hiring tab**: (i) Suppliers — tap-to-call + log outcome; (ii) Referral blast — pick role(s)/brand, preview audience minus current staff, one-tap send. COA coordinate: `channel × role × brand × location × status`.
**Phase 2 (broad net, needs box):**
- 2a. Apna job-post automation (browser, RTX/winpc) — only if Phase-1 misses.
- 2b. FB group posting executor (Claude-in-Chrome on the box) consuming `fb_posts` queue; seed `fb_groups` from the Drive `FB Group` sheet.

### 8.8 BUILD LOG — Phase-1a (suppliers) shipped 2026-06-26
- **D1:** `hiring_suppliers` + `hiring_supplier_calls` (+indexes) created in live `hn-hiring` (`schema-suppliers.sql`).
- **Backend:** `functions/api/hiring-darbar.js` — actions `overview`, `suppliers`, `supplier`, `exclusion_count`, `log_call`, `supplier_add`, `seed_suppliers`. Shares Darbar token auth + CORS.
- **Data:** 30 graded Bangalore manpower suppliers seeded from deep research (`data/hiring-suppliers-seed.sql`, generator `scripts/seed-suppliers-from-research.py`). 26 callable, 3 grade-A (Sree Manpower 9620301447, Whitehand 9945741572, S&IB 9836283183), mobile-preferred. Honest gap: best role-fit firms are south BLR; central ones do cleaning only → expect 2–3 vendors. Numbers are research leads — verify on the call.
- **iOS:** `DarbarHiringTab.swift` (new) + 1-line tab in `DarbarView.swift` + model/client/app-model methods. **BUILD SUCCEEDED** (5-tab chain compiles; Today/Attendance/Pay/Roster untouched).
- **Exclusion verified live:** roster JOIN returns 23 active-staff phones for the flow-#2 do-not-message set.
- **Deployed + verified live:** PR #462 merged → `hiring-darbar.js` live on darbar.hnhotels.in (curl-verified: overview 30/26/3A, exclusion_count 23, suppliers grade=A returns the 3 with mobiles).
- **iOS shipped:** Darbar **TestFlight build 7 VALID**, attached to "HN Internal" group (app id 6782544979) — owner taps Update. (No human gate; ASC record pre-existed.)
- **Still to do:** owner phone-test the Hiring tab; build **flow #2** (manager-referral WhatsApp — needs commission ₹/joined-hire + a manager audience: research or owner-provided); then Phase-2 (Apna/FB posting on the box, only if free channels miss).

### 8.7 No-regression checklist (every change)
- iOS: add tab only; full 4-tab build still compiles + runs before "done"; bump nothing in existing tabs.
- Web: bump `?v=` on `ops/darbar/index.html` app.js if touched (edge cache).
- Roster writes go through `hr-admin?action=employee-upsert` / darbar `onboard` (staff_pin + attendance backfill + Odoo mirror) — never raw INSERT into `hr_employees`.
- Verify exclusion JOIN actually removes current staff before ANY blast (test against live 23 numbers).
