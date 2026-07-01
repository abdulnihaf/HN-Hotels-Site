# HN Comms Native Inbox

Standalone native iOS + Android inbox for HE/NCH/SparkSol WhatsApp Business API messages.

## Grounded State

- HN `functions/api/_lib/comms-core.js` is the send primitive for WABA/SMS/voice and logs outbound attempts in `comms_outbox`.
- HN `functions/api/comms-webhook.js` receives Meta callbacks, updates `comms_outbox`, handles HR/opt-in/ack flows, and forwards HE/NCH inbound customer payloads to the brand sites.
- HN `functions/api/hiring.js` has a hiring inbox over `conversations`, but that table is campaign/candidate shaped and is not the customer comms inbox.
- HE has the mature customer trail in `he-whatsapp`: `wa_messages`, raw webhook vault, message status rows, media vault, `leads`, `/ops/leads`, and `/ops/inbox`.
- NCH has order/session/user WABA flow, but no committed HE-style `wa_messages`/raw event vault found in the repo.

## Additive Backend

- `schema-comms-inbox.sql` creates:
  - `comms_threads`
  - `comms_messages`
  - `comms_webhook_events`
  - `comms_quick_replies`
- `functions/api/comms-inbox.js` exposes the mobile API:
  - `GET ?action=threads`
  - `GET ?action=thread&thread_id=he:91...`
  - `GET ?action=quick-replies&brand=he`
  - `GET ?action=templates&brand=he`
  - `GET ?action=health`
  - `POST ?action=reply`
  - `POST multipart ?action=attachment`
  - `POST ?action=mark-read`
- `functions/api/comms-webhook.js` now mirrors inbound HE/NCH/SparkSol messages and delivery/read/failed callbacks into the HN comms inbox tables before forwarding eligible customer-flow payloads to the existing brand bot handlers.

## Credential Map

- Mobile app gate: `HN_COMMS_APP_KEY`
  - Stored in GitHub Actions as `HN_COMMS_APP_KEY` for APK builds.
  - Provisioned to Cloudflare Pages as `HN_COMMS_APP_KEY` for `/api/comms-inbox`.
  - This is not a Meta token and is safe to rotate independently from WhatsApp.
- Hamza Express WABA:
  - Phone number id: `WA_HE_PHONE_ID`
  - WABA id: `WA_HE_WABA_ID`
  - Send token: `WA_HE_TOKEN`, falling back to `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`
- Nawabi Chai House WABA:
  - Phone number id: `WA_NCH_PHONE_ID`
  - WABA id: `WA_NCH_WABA_ID`
  - Send token: `WA_NCH_TOKEN`, falling back to `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`
- SparkSol staff/HR WABA:
  - Phone number id: `WA_SPARKSOL_PHONE_ID`
  - WABA id: `WA_SPARKSOL_WABA_ID`
  - Send token: `WA_SPARKSOL_TOKEN`, falling back to `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`

If a mobile key is missing, regenerate/store it with `hn-save HN_COMMS_APP_KEY ...`, then set it at GitHub repo `abdulnihaf/HN-Hotels-Site` -> Settings -> Secrets and variables -> Actions -> Repository secrets -> `HN_COMMS_APP_KEY`. The backend deploy workflow provisions the same value to Cloudflare Pages.

If a WABA token is missing or expired, regenerate it in Meta Business Settings -> Users -> System users -> select the HN system user -> Generate new token -> select the WhatsApp app/WABA asset -> include `whatsapp_business_messaging` and `whatsapp_business_management`, then store it in Cloudflare Workers & Pages -> `hn-hotels-site` -> Settings -> Variables and Secrets -> Production using the matching `WA_*_TOKEN` name above.

## Send Rules

- Free-form text is allowed only when `service_window_expires_at` is still open.
- Outside the 24-hour customer-service window, `/api/comms-inbox?action=reply` requires an approved WABA template.
- Attachments upload media to Meta first, send the returned media ID through WABA, and are blocked outside the 24-hour window.
- Every outbound attempt writes:
  - `comms_outbox` for the canonical send trail
  - `comms_messages` for the visible thread row
- A failed Meta send returns `ok:false`; the app must show failure and must not blind-confirm sent.

## Deploy Requirements

Cloudflare auth failed locally on 2026-07-01 with API errors `10000` and `9109`, so the migration could not be applied or verified live from this machine.

Before production use:

1. Repair Cloudflare Wrangler auth for this machine or deploy through a known-good CI/Cloudflare session.
2. Run:
   `wrangler d1 execute hn-hiring --remote --file=schema-comms-inbox.sql`
3. Ensure these env vars/secrets exist on `hn-hotels-site`:
   - `WA_ACCESS_TOKEN`
   - `WA_HE_PHONE_ID`
   - `WA_HE_WABA_ID`
   - `WA_NCH_PHONE_ID`
   - `WA_NCH_WABA_ID`
   - `WA_HE_TOKEN` or `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`
   - `WA_NCH_TOKEN` or `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`
   - `WA_SPARKSOL_PHONE_ID`
   - `WA_SPARKSOL_WABA_ID`
   - `WA_SPARKSOL_TOKEN` or `WA_COMMS_TOKEN` or `WA_ACCESS_TOKEN`
   - `HN_COMMS_APP_KEY`
4. POST a real inbound message to each WABA line and verify:
   - `GET /api/comms-inbox?action=threads&brand=he`
   - `GET /api/comms-inbox?action=threads&brand=nch`
   - `GET /api/comms-inbox?action=threads&brand=sparksol`
   - Thread opens with `service_window_open:true`.
5. Send one test free-form reply inside the window and confirm `comms_outbox` plus `comms_messages` both show the attempt/result.

## Native Apps

### iOS

- Project: `ios/HNCommsApp/HNCommsApp.xcodeproj`
- Bundle id: `com.hnhotels.comms`
- Native SwiftUI, iOS 17+, no local message database.
- Local verification:
  - `xcodegen generate`
  - `xcodebuild -project HNCommsApp.xcodeproj -scheme HNCommsApp -destination 'generic/platform=iOS Simulator' build`
  - `xcodebuild -project HNCommsApp.xcodeproj -scheme HNCommsApp -destination 'generic/platform=iOS' -archivePath "$PWD/build/HNCommsApp.xcarchive" archive`
- TestFlight export currently blocks at provisioning:
  - `error: exportArchive No profiles for 'com.hnhotels.comms' were found`
  - Create/register the App Store profile/app record for `com.hnhotels.comms`, then rerun export/upload.

### Android

- Project: `android/HNCommsApp`
- Application id: `com.hnhotels.comms`
- Native Kotlin/Compose, no local message database.
- HN Staff-style install/update channel:
  - Install page: `https://hn-comms-app.pages.dev/get/`
  - APK: `https://hn-comms-app.pages.dev/HN-Comms.apk`
  - Version metadata: `https://hn-comms-app.pages.dev/version.json`
  - Workflow: `.github/workflows/deploy-hn-comms-app.yml`
- Compose UI supports inbox search/filter across HE/NCH/SparkSol, thread view, quick replies, approved templates, text replies, and document/image/video/audio attachment picking.
- Release APKs are built with `HN_COMMS_APP_KEY` from GitHub Secrets; Meta WABA tokens are never embedded in the app.
- Local verification:
  - `JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home" ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew --no-daemon assembleDebug`
- Debug APK:
  - `android/HNCommsApp/app/build/outputs/apk/debug/app-debug.apk`
  - local copy: `/Users/nihaf/Desktop/HNComms_2026-07-01/HNComms-debug.apk`
