#!/usr/bin/env bash
# naam-refresh.sh — full Naam refresh in one command.
#
# Sequences all three steps with explicit exit-on-failure so a stale deploy
# (where one step was skipped or failed silently) is impossible.
#
# Steps:
#   1. naam-snapshot.js       — refresh lane metrics from Codex memory + live APIs
#   2. build-creative-manifest.py --skip-menu-thumbs
#                             — rebuild creative manifest + priority thumbs
#                               (skips ~1400 menu photos; add --no-thumbs for fastest run)
#   3. naam-deploy.sh         — push naam/ live to naam.hnhotels.in
#
# Usage:
#   bash scripts/naam-refresh.sh                  # full refresh + deploy
#   bash scripts/naam-refresh.sh --data-only      # snapshot + manifest, no deploy
#   bash scripts/naam-refresh.sh --no-thumbs      # skip ALL thumb generation
#   bash scripts/naam-refresh.sh --deploy-only    # skip snapshot + manifest, just redeploy
#
# Each step exits immediately on failure — the pipeline never proceeds
# with stale data, and the failure step is clearly identified.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_ONLY=0; NO_THUMBS=0; DEPLOY_ONLY=0
for arg in "$@"; do
  case $arg in --data-only) DATA_ONLY=1;; --no-thumbs) NO_THUMBS=1;; --deploy-only) DEPLOY_ONLY=1;; esac
done

THUMB_FLAG="--skip-menu-thumbs"
[[ $NO_THUMBS -eq 1 ]] && THUMB_FLAG="--no-thumbs"

echo "╔══════════════════════════════════╗"
echo "║  Naam — full refresh             ║"
echo "╚══════════════════════════════════╝"

if [[ $DEPLOY_ONLY -eq 0 ]]; then
  echo ""
  echo "▸ Step 1/3 — lane metrics (naam-snapshot.js)"
  node scripts/naam-snapshot.js
  echo "  ✓ naam/data/naam-data.json refreshed"

  echo ""
  echo "▸ Step 2/3 — creative manifest (build-creative-manifest.py $THUMB_FLAG)"
  python3 scripts/build-creative-manifest.py $THUMB_FLAG
  echo "  ✓ naam/data/creative-manifest.json rebuilt"
else
  echo "  (--deploy-only: skipping snapshot + manifest)"
fi

if [[ $DATA_ONLY -eq 0 ]]; then
  echo ""
  echo "▸ Step 3/3 — deploy to naam.hnhotels.in"
  bash scripts/naam-deploy.sh
else
  echo "  (--data-only: skipping deploy)"
  echo ""
  echo "╔══════════════════════════════════╗"
  echo "║  Data refreshed. Run             ║"
  echo "║  bash scripts/naam-refresh.sh   ║"
  echo "║  --deploy-only  to push live.    ║"
  echo "╚══════════════════════════════════╝"
fi
