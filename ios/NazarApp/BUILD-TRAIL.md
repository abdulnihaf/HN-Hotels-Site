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
