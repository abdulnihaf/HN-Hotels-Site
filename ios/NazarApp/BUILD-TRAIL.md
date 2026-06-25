# NazarApp iOS Build Trail

## 2026-06-25 — Initial build (claude/ios-nazar-app)

**Status:** Code + xcodeproj committed. xcodebuild approval pending.

**What's done:**
- 13 Swift source files + NazarApp.xcodeproj + NazarApp.xcscheme
- `ios/NazarApp/` on branch `claude/ios-nazar-app`, commit 3d2b10e

**Architecture:**
- Bundle ID: `com.hnhotels.nazar`
- Team: `FZ58DQ52QS`
- Deployment: iOS 17.0+
- Auth: Local PIN (seed 0305) + Face ID via LocalAuthentication
- RTX primary: `http://100.107.54.16:8080` (Tailscale)
- go2rtc streams: `http://100.107.54.16:1985/api/stream.mp4?...`
- No WebViews — full native SwiftUI

**3 tabs:**
1. Intelligence — `/nz/flags` cockpit (mode, people, bills, sales, channel states, source health)
2. Cameras — HE/NCH toggle, 2-col JPEG grid, AVPlayer fullscreen via go2rtc MP4
3. Flags — active exceptions list, confirm/reject with `/nz/confirm`

**Dead camera handling:**
- CH03 (`he_first_floor_dinein`) → backup `he_first_floor_dinein_2` for streams
- NCH outdoor (`nch_outdoor_chai`) → backup `nch_outdoor_2`
- `isDead` badge shown on grid + fullscreen

**To compile:**
Run `bash ios/NazarApp/build-sim.sh` (approve xcodebuild once in the permission prompt).
Or: `hn-nazar-ios-sim` (once written to ~/.local/bin/).

**To ship to TestFlight:**
1. Create ASC app record for `com.hnhotels.nazar` (API blocks POST /v1/apps, manual step)
2. `hn-hukum-ios-build` style archive + altool upload

## 2026-06-25 — FINAL ROLLOUT (commit f346236, claude/ios-nazar-app)

**Status:** BUILD SUCCEEDED + sim-verified live on all 3 tabs. Bundle id registered. Awaiting ASC app-record (Nihaf gate) → then TestFlight.

**What changed (rewrite against the LIVE `/nz/flags` shape, read from `~/nazar-srv/nazar_srv.py`):**
- Decode fixes (app was rendering wrong/empty): channel `status` (was `state`), `engine_assert_capable` (was `assert_capable`), `why_not_proof[]` array (was `why_not` String), `confidence_label`, `flags`+`historical` (was `history`). Channels now show real `review`/`not_wired` + POS bills/sales + "review only" badge instead of "unknown".
- Cockpit additions: `why_not_proof` reasons, full `source_health` chips, `live_counts` (occupancy/footfall) with honest trust labels (most `trusted=false` → "unverified").
- Cameras: roster completed to all **16** go2rtc cams (added `he_fried_chicken_kitchen`, `he_main_kitchen_2`, `he_main_kitchen_door`, `nch_kitchen`); stream URL `video=h264` (was `video=copy` → black-screen risk); dead→backup live feed; **DVR rewind** (`POST /nz/rewind {cam,mins}` → play `rw_live`, `POST /nz/rewind/stop`).
- Flags: real flag shape (status/label/camera/bill_match/person_count/reason/code); active + historical + `/nz/confirmations`; confirm by `code`.
- Real 1024×1024 AppIcon (eye, no alpha). `HomeView` `NAZAR_TAB` launch override for verification.

**Verified live (sim on HN-iPhone17Pro, RTX over Tailscale):**
- Watch: channels `review`/`not_wired`, 1F Captain 11 bills ₹10,108, GF Cash 43 bills ₹9,307, why-not-proof 5 reasons, summary bills 54 / sales ₹19,415 (matches `/nz/flags`).
- Cameras: 9 HE feeds live incl. the 3 added; 1F primary "DEAD → BACKUP" badge.
- Flags: honest "No flags today — review mode" (live has 0 active).

**Ship state:**
- Bundle id `com.hnhotels.nazar` registered via ASC API (id `A2XX5WSBFX`).
- App record: **NOT created** — Apple forbids `POST /v1/apps`. **Nihaf gate:** App Store Connect → Apps → ＋ → New App → bundle `com.hnhotels.nazar`, name e.g. "HN Nazar", SKU, language.
- After the record exists: archive (Release, clean /tmp) → export (method=app-store + ASC key `WSN6HFLA5F`) → altool upload (`APPLE_UPLOAD_PW`) → poll VALID → internal betaGroup + add `nihafwork@gmail.com` → Nihaf installs.

**No RTX changes** — pure app rollout; Frigate/go2rtc/services untouched.
