# HN UX Catalog — manifest (durable, read this before any Sauda/Darbar UX work)

The catalog at **/ops/ux-catalog/** is the side-by-side proof of how the native iOS apps
compare to the deployed web apps, screen by screen. It exists so no future session has to
guess the intended experience — open the link, see every screen native-vs-web with a parity
verdict. Source of truth = the deployed web app; native is matched to it.

## Canonical simulator
- Device: **iPhone 17 Pro** (matches the owner's phone), name `HN-iPhone17Pro`, runtime iOS 26.5.
- Logical viewport for web capture: **402×874 @3x** (= 1206×2622 px, identical to the sim screenshot).

## Pinned app commits (the builds shown in the catalog)
- Sauda  — branch `claude/ios-sauda-app`  @ build 1.0(5)  (`ios/SaudaApp`)
- Darbar — branch `claude/ios-darbar-app` @ build 1.0(5)  (`ios/DarbarApp`)

## Native capture — env-hook → screen map (no tapping needed; deep-link via env)
Bypass the PIN gate with `SAUDA_UNLOCK=1` / `DARBAR_UNLOCK=1` (sim-only, no production effect).
| App | Screen | Launch env (prefix each with `SIMCTL_CHILD_`) |
|---|---|---|
| Sauda | Buy list | `SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=buy` |
| Sauda | Place | `… HUKUM_SAUDA_TAB=place` |
| Sauda | Purchase day | `… HUKUM_SAUDA_TAB=purchaseDay HUKUM_SAUDA_DATE=2026-06-19` |
| Sauda | To pay | `… HUKUM_SAUDA_TAB=pay` |
| Sauda | Vendor diary | `… HUKUM_SAUDA_TAB=vendors` |
| Sauda | Hyperpure | `… HUKUM_SAUDA_TAB=hyperpure` |
| Sauda | Compare | `… HUKUM_SAUDA_TAB=compare` |
| Sauda | Settings | `… HUKUM_SAUDA_TAB=settings` |
| Darbar | Today/Court | `DARBAR_UNLOCK=1 DARBAR_TAB=0` |
| Darbar | Attendance | `… DARBAR_TAB=1` |
| Darbar | Pay | `… DARBAR_TAB=2` |
| Darbar | Roster | `… DARBAR_TAB=3` |

Regenerate the whole native side in one command:
```
ops/ux-catalog/tools/capture-native.sh <path/ios/SaudaApp> <path/ios/DarbarApp> <out_dir>
```

## Web-app capture recipe (the source of truth)
Driven with the chrome-devtools MCP on the laptop (the laptop CAN reach hnhotels.in):
1. `new_page` → `https://sauda.hnhotels.in/ops/sauda/` (Darbar: `https://darbar.hnhotels.in/ops/darbar/`)
2. `emulate viewport 402x874x3,mobile,touch`
3. PIN gate is a numeric keypad — tap **0,3,0,5** (owner PIN); auto-submits on the 4th digit.
   (Snapshot can read stale after unlock — trust the screenshot, not the a11y snapshot.)
4. Tap each tab button, `take_screenshot` to a path inside the repo workspace.

## How parity is judged
Each native screen is diffed against its web-app screenshot by a vision pass → verdict
PASS / MINOR / MISMATCH + a delta list (imagery, missing-section, control, label, color, …),
each with the concrete native-side fix. The catalog `index.html` embeds those verdicts.
Rule: a screen is "shipped right" only when it reaches PASS (or its deltas are explicitly
accepted intentional adaptations). See `correct-or-loop-discipline`.
