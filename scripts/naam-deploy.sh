#!/usr/bin/env bash
# naam-deploy.sh — push the naam/ folder live to naam.hnhotels.in
#
# Naam is a DIRECT-UPLOAD Cloudflare Pages project ("naam", custom domain
# naam.hnhotels.in). It is NOT git-connected (git-connected Pages creation
# needs dashboard OAuth), so it does NOT auto-redeploy on push to main —
# run this after refreshing data or editing the app.
#
# Typical flow:
#   node   scripts/naam-snapshot.js               # refresh lane metrics
#   python3 scripts/build-creative-manifest.py     # refresh creative library
#   bash   scripts/naam-deploy.sh                  # push live
#
# Auth: reads ~/.hn-assets.env for a Pages-scoped CF token. Uses the
# GH-Actions CF token (has Pages:Edit). No secrets are hardcoded here.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
source ~/.hn-assets.env 2>/dev/null || { echo "missing ~/.hn-assets.env"; exit 1; }

export CLOUDFLARE_API_TOKEN="${HN_HOTELS_SHARED_GITHUB_GH_ACTIONS_CF_API_TOKEN:?Pages token not found in vault}"
export CLOUDFLARE_ACCOUNT_ID="${HN_HOTELS_SHARED_CLOUDFLARE_ACCOUNT_CF_ACCOUNT_ID:?account id not found in vault}"

# deploy from a neutral cwd so the repo's wrangler.toml (hn-hotels-site project)
# is not picked up by mistake.
TMP="$(mktemp -d)"
cd "$TMP"
echo "Deploying $REPO/naam → naam.hnhotels.in ..."
wrangler pages deploy "$REPO/naam" --project-name=naam --branch=main --commit-dirty=true
cd / && rm -rf "$TMP"
echo "Done. Live at https://naam.hnhotels.in/"
