#!/usr/bin/env bash
# adb_sync_restart.sh — EMERGENCY ONLY
#
# Daily fleet sync is now handled NATIVELY by PiSignage:
#   - Every group has reboot.enable=true at 06:45 IST (set 2026-05-06)
#   - Fire OS reboots → PiSignage app auto-starts → all 6 begin asset[0] in
#     lockstep within seconds
#   - No ADB / no laptop / no Hamza WiFi presence required for daily ops
#
# Run this script ONLY for:
#   - Mid-day drift recovery (force re-sync without waiting for 06:45)
#   - PiSignage native reboot escalation if a TV doesn't sync
#
# Force-stops com.pisignage.player2 on all 6 Fire Sticks in parallel, then
# launches them in the same ~100ms window. V1/V2/V3/V4 share a 50s
# psychology_v3_kathi loop and resume in lockstep.
#
# Requires: laptop on Hamza WiFi (192.168.31.x).
#
# Usage: bash adb_sync_restart.sh

PKG="com.pisignage.player2"
ACTIVITY="${PKG}/.MainActivity"

# TV name:IP pairs — bash 3.2 compatible (no associative arrays)
TV_NAMES=("TV-V1" "TV-V2" "TV-V3" "TV-V4" "TV-H1" "TV-H2")
TV_IPS=("192.168.31.113" "192.168.31.81" "192.168.31.135" "192.168.31.164" "192.168.31.33" "192.168.31.99")

echo "=== HE Fleet Sync Restart ==="
echo "Package: $PKG"
echo ""

# ── PHASE 1: Force-stop all 6 simultaneously ────────────────────────────────
echo "Phase 1: Stopping PiSignage on all 6 TVs simultaneously..."
for i in 0 1 2 3 4 5; do
  name="${TV_NAMES[$i]}"
  ip="${TV_IPS[$i]}"
  (adb -s ${ip}:5555 shell am force-stop "$PKG" 2>/dev/null && echo "  ✓ stopped ${name} (${ip})") &
done
wait
echo ""

# Brief pause — ensures Fire OS has fully cleaned up the app process
sleep 0.8

# ── PHASE 2: Launch all 6 simultaneously ────────────────────────────────────
echo "Phase 2: Launching PiSignage on all 6 TVs simultaneously..."
LAUNCH_TIME=$(date +%H:%M:%S)
for i in 0 1 2 3 4 5; do
  name="${TV_NAMES[$i]}"
  ip="${TV_IPS[$i]}"
  (adb -s ${ip}:5555 shell am start -n "$ACTIVITY" > /dev/null 2>&1 && echo "  ✓ launched ${name} (${ip})") &
done
wait

echo ""
echo "=== Sync complete. All 6 started at ~${LAUNCH_TIME} ==="
echo ""
echo "V1/V2/V3/V4 share a 50-second loop (psychology_v3_kathi Phase 2)."
echo "in lockstep for the rest of the day. No further action needed."
echo ""
echo "Verify in 10 seconds:"
echo "  bash adb_verify_sync.sh"
