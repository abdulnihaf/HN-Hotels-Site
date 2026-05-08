#!/usr/bin/env bash
# switch_mode.sh — toggle one or all TVs between PiSignage Player 2 and Fully Kiosk synchronizer
#
# Both apps remain installed; this only changes which one is in foreground.
#   - choreo  : Fully Kiosk loads https://hnhotels.in/choreo/?tv=<id>  (sub-100ms cross-TV sync)
#   - pisig   : PiSignage Player 2 plays its assigned playlist (default content management)
#
# Usage:
#   bash switch_mode.sh choreo            # all 4 vertical TVs → Fully Kiosk synchronizer
#   bash switch_mode.sh pisig             # all 4 → PiSignage Player 2
#   bash switch_mode.sh choreo v2         # only V2 → synchronizer
#   bash switch_mode.sh pisig v3          # only V3 → PiSignage
#   bash switch_mode.sh status            # report which app is foreground per TV
#
# Requires: laptop on Hamza WiFi, ADB connected to all four TVs.

# Compatible with bash 3.2 (default macOS) — uses parallel arrays, not assoc arrays.
TV_IDS=(v1 v2 v3 v4)
TV_IPS=(192.168.31.113 192.168.31.81 192.168.31.135 192.168.31.164)

ip_for_tv() {
  local i
  for i in 0 1 2 3; do
    if [ "${TV_IDS[$i]}" = "$1" ]; then
      echo "${TV_IPS[$i]}"
      return 0
    fi
  done
  return 1
}

FULLY=de.ozerov.fully
PISIG=com.pisignage.player2

action="${1:-}"
target="${2:-}"

case "$action" in
  choreo|pisig|status) ;;
  *) echo "Usage: $0 {choreo|pisig|status} [v1|v2|v3|v4]"; exit 1 ;;
esac

if [ -n "$target" ]; then
  if ! ip_for_tv "$target" >/dev/null; then
    echo "Unknown TV: $target  (expected v1, v2, v3, or v4)"
    exit 1
  fi
  selected_tvs="$target"
else
  selected_tvs="v1 v2 v3 v4"
fi

switch_to_choreo() {
  local tv=$1
  local ip=$(ip_for_tv "$tv")
  local target_url="https://hnhotels.in/choreo/?tv=${tv}"
  echo "  ${tv} (${ip}) → choreo"
  adb -s ${ip}:5555 shell am force-stop $PISIG > /dev/null 2>&1
  adb -s ${ip}:5555 shell am start -a android.intent.action.VIEW -d "$target_url" -n $FULLY/.MainActivity > /dev/null 2>&1
}

switch_to_pisig() {
  local tv=$1
  local ip=$(ip_for_tv "$tv")
  echo "  ${tv} (${ip}) → pisig"
  adb -s ${ip}:5555 shell am force-stop $FULLY > /dev/null 2>&1
  adb -s ${ip}:5555 shell pm grant $PISIG android.permission.READ_EXTERNAL_STORAGE > /dev/null 2>&1
  adb -s ${ip}:5555 shell pm grant $PISIG android.permission.WRITE_EXTERNAL_STORAGE > /dev/null 2>&1
  adb -s ${ip}:5555 shell am start -n $PISIG/.MainActivity > /dev/null 2>&1
}

show_status() {
  local tv=$1
  local ip=$(ip_for_tv "$tv")
  local fg=$(adb -s ${ip}:5555 shell dumpsys window 2>/dev/null | grep mCurrentFocus | head -1 | tr -d '\r')
  local mode="?"
  if echo "$fg" | grep -q "$FULLY"; then mode="choreo (Fully Kiosk)"
  elif echo "$fg" | grep -q "$PISIG"; then mode="pisig (PiSignage Player 2)"
  elif echo "$fg" | grep -q "com.amazon.cpl"; then mode="captive portal (broken)"
  elif echo "$fg" | grep -q "com.amazon.tv.launcher"; then mode="Fire TV launcher (no app running)"
  else mode="other"
  fi
  echo "  ${tv} (${ip}): ${mode}"
}

case "$action" in
  choreo)
    echo "=== Switch to choreography synchronizer ==="
    for tv in $selected_tvs; do switch_to_choreo "$tv"; done
    echo ""
    echo "Verify: bash $0 status"
    ;;
  pisig)
    echo "=== Switch to PiSignage Player 2 ==="
    for tv in $selected_tvs; do switch_to_pisig "$tv"; done
    echo ""
    echo "Verify: bash $0 status"
    ;;
  status)
    echo "=== Current mode per TV ==="
    for tv in $selected_tvs; do show_status "$tv"; done
    ;;
esac
