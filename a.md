# Darbar Hiring — Handoff to Codex

> Prepared by Kimi, 26 Jun 2026.  
> Repo: `abdulnihaf/HN-Hotels-Site` · Branch: `main` @ `87c4e42` · iOS build 9 uploaded to TestFlight.

## What Nihaf wants

Finish the Darbar iOS Hiring execution. The Hiring tab must present **three clear channels**:

1. **Manpower Suppliers** — call + log outcomes.
2. **WhatsApp Campaigns** — compose & send brand-aware hiring messages.
3. **Facebook Posting** — post creatives to hiring groups via the existing RTX executor.

The backend scaffolding and the iOS 1-2-3 landing are in place. **Your job is runtime hardening, edge-case fixes, and end-to-end verification on a real device.**

---

## Current state

### Backend (deployed to `darbar.hnhotels.in`, production D1 `hn-hiring`)

| Surface | File | Status |
|---|---|---|
| Darbar hiring API | `functions/api/hiring-darbar.js` | Live. Actions: `overview`, `suppliers`, `supplier`, `exclusion_count`, `log_call`, `supplier_add`, `seed_suppliers`, `roles`, `audience_preview`, `compose`, `send`, `reply`, `inbox`, `campaign`, `mark_outcome`, plus new `fb_*` actions. |
| WhatsApp engine | `functions/api/hiring.js` | Live. Brand-aware HE/NCH. `hn_hiring_v1` template APPROVED on HE WABA. NCH falls back to HE WABA when `WA_NCH_TOKEN` is absent. |
| Facebook control plane | `functions/api/fb-posting.js` | Live. Auth via `x-darbar-token` / `x-service-key` / `x-fb-posting-secret`. Handles group intelligence, sessions, queued posts, executor `next_job`. |
| FB schema / seed | `schema-fb-posting.sql`, `schema-fb-posting-add-status-join.sql`, `seed-fb-creatives.sql` | Already applied to remote `hn-hiring`. |

### iOS (Darbar app, build 9)

| File | Role |
|---|---|
| `ios/DarbarApp/Darbar/DarbarHiringTab.swift` | 1-2-3 hub with three channel cards. |
| `ios/DarbarApp/Darbar/DarbarHiringSuppliersSheet.swift` | Supplier call list + filter + log. |
| `ios/DarbarApp/Darbar/DarbarHiringCampaignSheet.swift` | WhatsApp Roles → Compose → Inbox. |
| `ios/DarbarApp/Darbar/DarbarHiringFacebookSheet.swift` | FB creatives list + sessions + post-to-groups. |
| `ios/DarbarApp/Darbar/DarbarClient.swift` | API actor for `/api/hiring-darbar`. |
| `ios/DarbarApp/Darbar/DarbarModels.swift` | All hiring/FB models. |
| `ios/DarbarApp/Darbar/DarbarAppModel.swift` | Observable state + async actions. |
| `ios/DarbarApp/Darbar/DarbarView.swift` | Sheet enum + `DarbarSheetHost` routes `.hiringSuppliers`, `.hiringCampaign`, `.hiringFacebook`. |

### TestFlight

- Build 9 uploaded, `VALID`, attached to **HN Internal** group.
- `internalBuildState: IN_BETA_TESTING`, `autoNotifyEnabled: true`.

---

## Verified endpoints (curl-tested)

```bash
# Auth via Darbar token or service key (x-service-key: CAMS_AUTH_TOKEN)
GET  /api/hiring-darbar?action=roles&brand=all
GET  /api/hiring-darbar?action=audience_preview&role=Cleaners&brand=he
POST /api/hiring-darbar?action=compose   {role_key, brand, commission, package, audience_mode}
POST /api/hiring-darbar?action=send      {campaign_id}

GET  /api/hiring-darbar?action=fb_overview
GET  /api/hiring-darbar?action=fb_creatives
GET  /api/hiring-darbar?action=fb_preview&creative_id=1
GET  /api/hiring-darbar?action=fb_sessions
GET  /api/hiring-darbar?action=fb_posts&session_id=1
POST /api/hiring-darbar?action=fb_compose {creative_id, brand, daily_cap?, cooldown_days?, location?}
```

Live sample: FB overview currently shows **11 creatives**, **386 eligible joined groups**, **2 sessions**, **375 posts**.

---

## Gaps / finish list for Codex

### 1. Runtime iOS testing on a real device
- Install build 9 from TestFlight on Nihaf’s iPhone.
- Walk through **Suppliers → WhatsApp → Facebook**.
- Check sheet dismissal, pull-to-refresh, error toasts, dark mode / Liquid Glass rendering.

### 2. WhatsApp channel
- The real HE test send to `917010426808` was accepted.
- **NCH still routes through HE WABA** because Cloudflare has no `WA_NCH_TOKEN` with access to NCH WABA `644466865428090`.
  - Either provision a real NCH token + create `hn_hiring_v1` on NCH, **or** leave the HE fallback and just document it.
- Add per-campaign send limits / throttling if needed.
- Ensure replies appear in the Inbox tab and can be replied to.

### 3. Facebook channel
- The iOS sheet lists creatives and sessions, but the **actual post image is not served by the backend yet**. `fb_creatives.image_filename` references files like `C23-FB-Cleaner.png`; add a public static route (e.g. `/hiring/posters/fb/:filename`) or R2/CDN links so the RTX executor can download the image.
- The RTX executor polls `/api/fb-posting?action=next_job` — confirm the box secret `FB_POSTING_SECRET` is configured in Cloudflare Pages secrets and that the executor is alive.
- Add pause/resume buttons in the iOS session card if Nihaf wants manual control.
- Add a real-time refresh/poll for session progress.

### 4. Data & mapping
- No formal `hiring_roles → fb_creatives` mapping exists. The FB sheet currently lists creatives directly. If Nihaf wants role-to-creative mapping, add `fb_creative_id` to `hiring_roles` or a join table.
- Verify group import pipeline is still feeding `fb_groups` with `status_join='Joined'`.

### 5. Build / release hygiene
- Build 9 is the current candidate. If you fix runtime bugs, bump to **build 10** in both `ios/DarbarApp/project.yml` and `ios/DarbarApp/Darbar/Info.plist`, then archive + upload.
- Commit and push to `main` via the `nervous-brahmagupta` worktree (or merge from `kimi/darbar-hiring-whatsapp`).

### 6. Secrets checklist
- Cloudflare Pages production must have: `WA_ACCESS_TOKEN`, `WA_HE_PHONE_ID`, `WA_HE_WABA_ID`, `WA_NCH_PHONE_ID`, `WA_NCH_WABA_ID`, `FB_POSTING_SECRET`, `CAMS_AUTH_TOKEN`, `DASHBOARD_KEY`.
- If NCH should send from its own WABA, add `WA_NCH_TOKEN`.

---

## Quick build commands

```bash
cd /Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site-hiring-whatsapp/ios/DarbarApp
xcodegen generate
xcodebuild -project DarbarApp.xcodeproj -scheme DarbarApp -destination 'generic/platform=iOS' -archivePath build/Darbar.xcarchive archive
xcodebuild -exportArchive -archivePath build/Darbar.xcarchive -exportPath build -exportOptionsPlist exportOptions.plist
xcrun altool --upload-app --type ios --file build/Darbar.ipa --apiKey "$APPLE_ASC_KEY_ID" --apiIssuer "$APPLE_ASC_ISSUER_ID"
```

Poll for `VALID` and attach to the HN Internal beta group via App Store Connect API or web UI.

---

## Contact

- Nihaf’s decision: NCH can use the Hamza Express WABA for now. Do not block the release waiting for a dedicated NCH token.
- Any backend schema changes should be applied with `wrangler d1 execute hn-hiring --remote --file=<file>.sql`.
