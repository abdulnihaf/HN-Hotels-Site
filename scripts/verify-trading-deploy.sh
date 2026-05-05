#!/bin/sh
# verify-trading-deploy.sh — guardrail against accidental trading-deploy clobbering
#
# When ANY PR is merged to main, the production Cloudflare Pages deploy is
# replaced. If the merge doesn't include trading.js / kite.js / trading/ tree,
# the production /api/trading endpoint vanishes and the trading PWA breaks.
#
# This script verifies all paths in .cloudflare-protected-paths exist as files
# or non-empty directories. Run pre-merge in CI and locally before pushing.
#
# Exits 0 if all OK. Exits 1 with diagnostic list if any are missing.
#
# To explicitly waive the check (e.g., trading is being intentionally moved),
# the calling PR must include "ACK: trading-deploy-touched-with-owner-approval"
# in its description, and CI should set:
#   TRADING_DEPLOY_TOUCHED=1 bash scripts/verify-trading-deploy.sh
#
# Local usage:
#   bash scripts/verify-trading-deploy.sh
#
# CI usage (.github/workflows or pre-merge hook):
#   bash scripts/verify-trading-deploy.sh || exit 1

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROTECTED_FILE="${REPO_ROOT}/.cloudflare-protected-paths"

if [ ! -f "$PROTECTED_FILE" ]; then
  echo "✗ .cloudflare-protected-paths missing at repo root — guardrail itself was deleted"
  exit 1
fi

if [ "${TRADING_DEPLOY_TOUCHED}" = "1" ]; then
  echo "→ TRADING_DEPLOY_TOUCHED=1 — owner-approved waiver, skipping check"
  exit 0
fi

missing=""
checked=0
while IFS= read -r line; do
  # Skip comments + blank lines
  case "$line" in
    \#*|"") continue ;;
  esac
  path="${REPO_ROOT}/${line}"
  checked=$((checked + 1))
  if [ ! -e "$path" ]; then
    missing="${missing}\n  - ${line}"
  elif [ -d "$path" ] && [ -z "$(ls -A "$path" 2>/dev/null)" ]; then
    missing="${missing}\n  - ${line} (directory exists but empty)"
  fi
done < "$PROTECTED_FILE"

if [ -n "$missing" ]; then
  printf "\n✗ TRADING DEPLOYMENT WOULD BREAK — missing protected paths:%s\n\n" "$missing"
  echo "If this removal is intentional + owner-approved, set:"
  echo "  TRADING_DEPLOY_TOUCHED=1"
  echo "and re-run. Otherwise restore the missing files before merging."
  exit 1
fi

echo "✓ All ${checked} trading-deploy protected paths present."
exit 0
