#!/usr/bin/env bash
# adb_no_sleep_all.sh
# Connect to all 6 Hamza Express FireStick TVs via ADB over WiFi
# and apply no-sleep + screensaver-disable + ADB-persistence settings.
#
# Hardware: Marq LED Smart TV 43" HD (display) + Amazon Fire TV Stick (player, model AFTSS)
# All settings written to Android settings.db — survive reboots natively.
#
# Run this ONCE after any reboot or power cycle. Also safe to run daily.
# Must be on Hamza WiFi (192.168.31.x) for ADB to reach the TVs.
#
# Usage: bash adb_no_sleep_all.sh

declare -A TVS=(
  ["TV-V1"]="192.168.31.113"
  ["TV-V2"]="192.168.31.81"
  ["TV-V3"]="192.168.31.135"
  ["TV-V4"]="192.168.31.164"
  ["TV-H1"]="192.168.31.33"
  ["TV-H2"]="192.168.31.103"
)

apply_no_sleep() {
  local name="$1"
  local ip="$2"
  local target="${ip}:5555"

  echo ""
  echo "━━━ ${name} (${ip}) ━━━"

  # Connect (will prompt on TV screen first time; after that auto-connects)
  if ! adb connect "$target" 2>&1 | grep -q "connected"; then
    echo "  ⚠ Connect failed — check TV is on + ADB Debugging enabled in Developer Options"
    return
  fi

  # 1. Screen off timeout: max integer (~596 hrs) — effectively never
  adb -s "$target" shell settings put system screen_off_timeout 2147483647
  echo "  ✓ screen_off_timeout → 2147483647"

  # 2. Stay on while plugged in (AC=1, USB=2, wireless=4; 3=AC+USB covers all FireStick power modes)
  adb -s "$target" shell settings put global stay_on_while_plugged_in 3
  echo "  ✓ stay_on_while_plugged_in → 3"

  # 3. Disable screensaver / Daydream
  adb -s "$target" shell settings put secure screensaver_enabled 0
  echo "  ✓ screensaver_enabled → 0"

  # 4. Keep WiFi NEVER sleeping — critical for ADB persistence and PiSignage downloads
  adb -s "$target" shell settings put global wifi_sleep_policy 2
  echo "  ✓ wifi_sleep_policy → 2 (NEVER sleep)"

  # 5. Lock WiFi on (disable aggressive power save that cuts ADB at night)
  adb -s "$target" shell settings put global wifi_enhanced_auto_join 0 2>/dev/null && \
    echo "  ✓ wifi_enhanced_auto_join → 0" || true

  # 6. Keep ADB enabled — prevent Fire OS from disabling over TCP on reboot
  adb -s "$target" shell settings put global development_settings_enabled 1
  adb -s "$target" shell settings put global adb_enabled 1
  echo "  ✓ development_settings_enabled → 1"
  echo "  ✓ adb_enabled → 1 (persists TCP ADB across reboots)"

  # 7. Disable adaptive sleep (not all Fire OS versions have this)
  adb -s "$target" shell settings put secure adaptive_sleep 0 2>/dev/null && \
    echo "  ✓ adaptive_sleep → 0" || echo "  - adaptive_sleep: not present (OK)"

  # 8. Verify — read back all critical settings
  local timeout wifi_policy adb_en stay_on
  timeout=$(adb -s "$target" shell settings get system screen_off_timeout 2>/dev/null | tr -d '\r')
  wifi_policy=$(adb -s "$target" shell settings get global wifi_sleep_policy 2>/dev/null | tr -d '\r')
  adb_en=$(adb -s "$target" shell settings get global adb_enabled 2>/dev/null | tr -d '\r')
  stay_on=$(adb -s "$target" shell settings get global stay_on_while_plugged_in 2>/dev/null | tr -d '\r')
  echo "  → Verify: timeout=${timeout}  wifi_sleep=${wifi_policy}  adb_en=${adb_en}  stay_on=${stay_on}"

  # Flag any setting that didn't stick
  [ "$wifi_policy" = "2" ] || echo "  ⚠ wifi_sleep_policy did NOT stick — check Fire OS version"
  [ "$adb_en" = "1" ]     || echo "  ⚠ adb_enabled did NOT stick — may need physical re-enable"
}

echo "=== HE Fleet ADB No-Sleep ==="
echo "Connecting to all 6 FireStick TVs on Hamza WiFi..."

for name in "${!TVS[@]}"; do
  apply_no_sleep "$name" "${TVS[$name]}"
done

echo ""
echo "=== Done. All TVs should now stay on permanently. ==="
echo ""
echo "To verify a specific TV is not sleeping, run:"
echo "  adb -s 192.168.31.113:5555 shell dumpsys power | grep 'mWakefulness'"
echo "  → should show: mWakefulness=Awake"
