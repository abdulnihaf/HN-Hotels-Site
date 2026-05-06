#!/usr/bin/env bash
# adb_sync_restart.sh
# Hard-sync all 6 PiSignage players to the SAME start point simultaneously.
#
# HOW IT WORKS:
#   1. Force-stops com.pisignage.player2 on all 6 FireSticks in parallel
#   2. Waits for all stops to complete (~200ms)
#   3. Launches com.pisignage.player2/.MainActivity on all 6 in parallel
#
#   All 6 apps start from asset[0] within the same ~100ms window.
#   V1/V2/V3/V4 run psychology_v3_kathi (5 slots × 10s = 50s loop), so they stay
#   in lockstep for the ENTIRE DAY with zero drift.
#
# WHEN TO RUN:
#   - Every morning when outlet opens
#   - After any content update (once all TVs finish downloading new assets)
#   - After any TV reboots
#
# MUST BE ON HAMZA WIFI (192.168.31.x) for ADB to reach the TVs.
# TV-H2 is on Hamza Ext — same subnet, still reachable.
#
# Usage: bash adb_sync_restart.sh

PKG="com.pisignage.player2"
ACTIVITY="${PKG}/.MainActivity"

# TV name:IP pairs — bash 3.2 compatible (no associative arrays)
TV_NAMES=("TV-V1" "TV-V2" "TV-V3" "TV-V4" "TV-H1" "TV-H2")
TV_IPS=("192.168.31.113" "192.168.31.81" "192.168.31.135" "192.168.31.164" "192.168.31.33" "192.168.31.103")

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
