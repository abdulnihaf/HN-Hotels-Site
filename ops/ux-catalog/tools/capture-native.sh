#!/usr/bin/env bash
# HN UX Catalog — native screen capture (durable regenerator)
# Boots the canonical iPhone 17 Pro simulator, builds Sauda + Darbar from their
# pinned app branches, and screenshots EVERY screen via the apps' env-hooks.
# This is the repeatable proof: run it any day to regenerate the native side of
# the side-by-side UX catalog. The PWA side is the live site (see MANIFEST.md).
#
# Usage: capture-native.sh <sauda_app_dir> <darbar_app_dir> <out_dir>
#   <*_app_dir> = path to ios/SaudaApp or ios/DarbarApp at the build-5+ commit
# Requires: Xcode 26.5+, iOS 26.5 simulator runtime, xcodegen.
set -euo pipefail

SAUDA_DIR="${1:?sauda app dir}"; DARBAR_DIR="${2:?darbar app dir}"; OUT="${3:?out dir}"
DEVICE_NAME="HN-iPhone17Pro"
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-26-5"
DDROOT="$HOME/Library/Developer/HukumBuild"

# 1. ensure the canonical device exists + is booted
PUD="$(xcrun simctl list devices 2>/dev/null | grep "$DEVICE_NAME (" | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')"
if [ -z "$PUD" ]; then
  DT="$(xcrun simctl list devicetypes | grep -E 'iPhone 17 Pro' | grep -v Max | head -1 | sed -E 's/.*\((com.apple[^)]+)\)/\1/')"
  PUD="$(xcrun simctl create "$DEVICE_NAME" "$DT" "$RUNTIME")"
fi
xcrun simctl boot "$PUD" 2>/dev/null || true
xcrun simctl bootstatus "$PUD" -b >/dev/null 2>&1 || true
echo "device: $DEVICE_NAME ($PUD)"

build_install () { # dir  scheme(=project)  product  dd
  ( cd "$1" && xcodegen generate >/dev/null 2>&1
    xcodebuild -project "$2.xcodeproj" -scheme "$2" -sdk iphonesimulator -configuration Debug \
      -destination "id=$PUD" -derivedDataPath "$4" CODE_SIGNING_ALLOWED=NO build >/dev/null 2>&1 )
  local app; app="$(find "$4/Build/Products" -name "$3.app" -path '*iphonesimulator*' | head -1)"
  xcrun simctl install "$PUD" "$app"
}
shot () { # bundle  out.png  ENV...   (ENV passed as KEY=VAL pairs)
  local bid="$1" png="$2"; shift 2
  xcrun simctl terminate "$PUD" "$bid" >/dev/null 2>&1 || true
  local env=""; for kv in "$@"; do env="$env SIMCTL_CHILD_$kv"; done
  eval "$env xcrun simctl launch '$PUD' '$bid'" >/dev/null 2>&1
  sleep 7
  xcrun simctl io "$PUD" screenshot "$png" >/dev/null 2>&1 && echo "  ✓ $(basename "$png")"
}

# 2. SAUDA — 8 tabs (HUKUM_SAUDA_TAB rawValue; SAUDA_UNLOCK bypasses the PIN gate)
mkdir -p "$OUT/native/sauda"
build_install "$SAUDA_DIR" SaudaApp Sauda "$DDROOT/DD-sauda-cat"
SB=com.hnhotels.sauda; SO="$OUT/native/sauda"
shot $SB "$SO/01-buylist.png"     SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=buy
shot $SB "$SO/02-place.png"       SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=place
shot $SB "$SO/03-purchaseday.png" SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=purchaseDay HUKUM_SAUDA_DATE=2026-06-19
shot $SB "$SO/04-topay.png"       SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=pay
shot $SB "$SO/05-vendordiary.png" SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=vendors
shot $SB "$SO/06-hyperpure.png"   SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=hyperpure
shot $SB "$SO/07-compare.png"     SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=compare
shot $SB "$SO/08-settings.png"    SAUDA_UNLOCK=1 HUKUM_SAUDA_TAB=settings

# 3. DARBAR — 4 tabs (DARBAR_TAB index 0..3; DARBAR_UNLOCK bypasses the PIN gate)
mkdir -p "$OUT/native/darbar"
build_install "$DARBAR_DIR" DarbarApp Darbar "$DDROOT/DD-darbar-cat"
DB=com.hnhotels.darbar; DO="$OUT/native/darbar"
shot $DB "$DO/01-today.png"      DARBAR_UNLOCK=1 DARBAR_TAB=0
shot $DB "$DO/02-attendance.png" DARBAR_UNLOCK=1 DARBAR_TAB=1
shot $DB "$DO/03-pay.png"        DARBAR_UNLOCK=1 DARBAR_TAB=2
shot $DB "$DO/04-roster.png"     DARBAR_UNLOCK=1 DARBAR_TAB=3

echo "native catalog -> $OUT/native"
