#!/usr/bin/env bash
# HN Wealth SHIP GATE — refuses to ship a build that regressed the cockpit.
# Parses COCKPIT-MANIFEST.md (# CHECK lines) and verifies every required source
# marker is present in the build being shipped AND every required live endpoint
# responds. Exit 0 = cleared to ship. Exit 1 = REGRESSION, do NOT ship.
#
# Usage:  ./ship-check.sh [SOURCE_DIR]
#   SOURCE_DIR defaults to ./Wealth (the swift sources about to be built).
#   Run as the FIRST step of any archive/install/upload. No green, no ship.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRCDIR="${1:-$HERE/Wealth}"
MANIFEST="$HERE/COCKPIT-MANIFEST.md"
BASE="https://trade.hnhotels.in/api/trading"
[ -f ~/.hn-assets.env ] && source ~/.hn-assets.env 2>/dev/null
KEY="${DASHBOARD_API_KEY:-${DASHBOARD_KEY:-}}"

fail=0; passed=0
red()  { printf "\033[31m%s\033[0m\n" "$1"; }
grn()  { printf "\033[32m%s\033[0m\n" "$1"; }

echo "── HN Wealth ship gate ── source: $SRCDIR"
while IFS= read -r line; do
  case "$line" in
    "# CHECK SRC|"*)
      rest="${line#\# CHECK SRC|}"; file="${rest%%|*}"; rest="${rest#*|}"; marker="${rest%%|*}"; desc="${rest##*|}"
      if grep -qF "$marker" "$SRCDIR/$file" 2>/dev/null; then
        passed=$((passed+1))
      else
        red "  MISSING (source): $desc  [need '$marker' in $file]"; fail=$((fail+1))
      fi ;;
    "# CHECK API|"*)
      rest="${line#\# CHECK API|}"; action="${rest%%|*}"; rest="${rest#*|}"; field="${rest%%|*}"; desc="${rest##*|}"
      body=$(curl -s -m 25 -H "x-api-key: $KEY" "$BASE?action=$action" 2>/dev/null)
      if echo "$body" | grep -qF "\"$field\""; then
        passed=$((passed+1))
      else
        red "  MISSING (live): $desc  [endpoint '$action' has no '$field']"; fail=$((fail+1))
      fi ;;
  esac
done < "$MANIFEST"

echo "──"
if [ "$fail" -eq 0 ]; then
  grn "SHIP GATE PASSED — $passed checks. Cockpit intact, cleared to ship."
  exit 0
else
  red "SHIP GATE FAILED — $fail regression(s), $passed ok. DO NOT SHIP until fixed."
  exit 1
fi
