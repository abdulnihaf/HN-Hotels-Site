#!/usr/bin/env bash
# sideload_fully_kiosk.sh — Deploy Fully Kiosk Browser to all 4 vertical TVs
# and configure each to load the choreography synchronizer URL.
#
# Run AFTER /choreo/index.html and /api/choreo/* are deployed to hnhotels.in
# (auto-deployed via CF Pages on git push to main).
#
# Per TV, this script:
#   1. ADB-installs Fully Kiosk Browser APK (idempotent — -r reinstall flag)
#   2. Stops PiSignage Player 2 (no longer needed for V1-V4)
#   3. Launches Fully Kiosk
#   4. Completes first-launch wizard via D-pad input simulation
#   5. Reconfigures Start URL to https://hnhotels.in/choreo/?tv=<vN>
#   6. Sets Fully Kiosk as default Home so it auto-launches on Fire OS boot
#   7. Verifies the WebView loaded by screencap
#
# Requires: Hamza WiFi, Fully Kiosk APK at $APK_PATH, all 4 TVs ADB-reachable.
#
# Usage: bash sideload_fully_kiosk.sh [tv-id]
#   - no arg: process all 4 (V1, V2, V3, V4)
#   - tv-id (v1/v2/v3/v4): process just that TV

set -u

APK_PATH="${APK_PATH:-/tmp/disc/fully-kiosk.apk}"
APK_URL="https://www.fully-kiosk.com/files/2025/01/Fully-Kiosk-Browser-v1.57.1.apk"
SYNC_BASE_URL="https://hnhotels.in/choreo"
PKG=de.ozerov.fully

# tv-id : ip
declare -A TVS=(
  ["v1"]="192.168.31.113"
  ["v2"]="192.168.31.81"
  ["v3"]="192.168.31.135"
  ["v4"]="192.168.31.164"
)

# ── Ensure APK is downloaded ─────────────────────────────────────────────
if [ ! -s "$APK_PATH" ]; then
  echo "Downloading Fully Kiosk Browser APK to $APK_PATH..."
  mkdir -p "$(dirname "$APK_PATH")"
  curl -sL -o "$APK_PATH" "$APK_URL"
  if [ ! -s "$APK_PATH" ]; then
    echo "ERROR: APK download failed"
    exit 1
  fi
fi
echo "APK: $APK_PATH ($(stat -f%z "$APK_PATH" 2>/dev/null || stat -c%s "$APK_PATH") bytes)"
echo ""

# ── Per-TV deploy function ───────────────────────────────────────────────
deploy_tv() {
  local tv=$1
  local ip=${TVS[$tv]}
  local target="${ip}:5555"
  local url="${SYNC_BASE_URL}/?tv=${tv}"

  echo "━━━ ${tv} (${ip}) ━━━"

  # 1. Connect ADB
  if ! adb connect "$target" 2>&1 | grep -q "connected"; then
    echo "  ⚠ ADB connect failed — skipping"
    return 1
  fi

  # 2. Install APK (idempotent: -r reinstalls without uninstall)
  echo "  → installing Fully Kiosk Browser..."
  adb -s "$target" install -r "$APK_PATH" 2>&1 | grep -E "Success|Failure" | head -1

  # 3. Stop PiSignage Player 2 (we're replacing it)
  adb -s "$target" shell am force-stop com.pisignage.player2 2>/dev/null

  # 4. Launch Fully Kiosk fresh (clears any prior state via pm clear)
  adb -s "$target" shell pm clear $PKG 2>&1 | tail -1
  adb -s "$target" shell am start -n $PKG/.MainActivity >/dev/null 2>&1
  sleep 4

  # 5. Complete first-launch wizard via D-pad input
  #    Layout: Start URL field → Fullscreen toggle → Action Bar toggle →
  #            Address Bar toggle → START USING FULLY button
  #    From initial focus (URL field), press DOWN 5x then CENTER to click START.
  echo "  → completing first-launch wizard..."
  for _ in 1 2 3 4 5; do
    adb -s "$target" shell input keyevent KEYCODE_DPAD_DOWN
    sleep 0.25
  done
  adb -s "$target" shell input keyevent KEYCODE_DPAD_CENTER
  sleep 4

  # 6. Now Fully Kiosk is past wizard. Use its public LOAD_URL action to
  #    point at our synchronizer URL. This action is registered after wizard.
  echo "  → loading ${url}..."
  adb -s "$target" shell am start -a de.ozerov.fully.action.LOAD_URL -d "$url" >/dev/null 2>&1
  sleep 6

  # 7. Configure Fully Kiosk to use this URL on every launch.
  #    This is done via the LOAD_URL action which also persists the URL when
  #    saveStartUrl flag is implied, OR via the Settings activity.
  #    Belt-and-suspenders: also send via intent extras.
  adb -s "$target" shell am start -n $PKG/.MainActivity \
    --es startUrl "$url" \
    --es kioskUrl "$url" \
    --ez kioskMode true \
    --ez fullScreen true 2>&1 | tail -1

  sleep 4

  # 8. Set Fully Kiosk as default home (auto-launches on Fire OS boot)
  echo "  → setting as default home launcher..."
  adb -s "$target" shell cmd package set-home-activity $PKG/.MainActivity 2>&1 | tail -1

  # 9. Verify by screencap
  local cap="/tmp/sideload_${tv}.png"
  adb -s "$target" shell screencap -p /sdcard/c.png >/dev/null 2>&1
  adb -s "$target" pull /sdcard/c.png "$cap" >/dev/null 2>&1
  if [ -s "$cap" ]; then
    local sz=$(stat -f%z "$cap" 2>/dev/null || stat -c%s "$cap")
    echo "  ✓ screencap saved: $cap ($sz bytes)"
  else
    echo "  ⚠ screencap failed"
  fi

  # 10. Confirm focused app
  local focus=$(adb -s "$target" shell dumpsys window 2>/dev/null | grep mCurrentFocus | head -1 | tr -d '\r')
  echo "  → focused: $focus"
  echo ""
}

# ── Main loop ────────────────────────────────────────────────────────────
if [ $# -eq 1 ]; then
  if [ -n "${TVS[$1]:-}" ]; then
    deploy_tv "$1"
  else
    echo "Unknown TV id: $1 (expected v1, v2, v3, or v4)"
    exit 1
  fi
else
  for tv in v1 v2 v3 v4; do
    deploy_tv "$tv"
  done
fi

echo "=== Done. Verify each TV at https://hnhotels.in/choreo/?tv=<vN> ==="
