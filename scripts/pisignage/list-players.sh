#!/bin/bash
# List all PiSignage players + their current state
# Usage: ./list-players.sh
# Requires: PISIGNAGE_TOKEN in .env.local OR session cookie passed via -b
# Reference: docs/PISIGNAGE_CONTROL.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO_ROOT/.env.local" ] && source "$REPO_ROOT/.env.local"

BASE_URL="https://hamzaexpress.pisignage.com/api"

if [ -z "${PISIGNAGE_TOKEN:-}" ]; then
  echo "❌ PISIGNAGE_TOKEN not set in .env.local"
  echo "Generate one via: hamzaexpress.pisignage.com → Profile → API Token"
  echo "Or fall back to Chrome MCP method (see docs/PISIGNAGE_CONTROL.md)"
  exit 1
fi

curl -sS -H "x-access-token: $PISIGNAGE_TOKEN" "$BASE_URL/players" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d.get('data', {}).get('objects', []):
    print(f\"{p.get('group',{}).get('name','?'):35} | {p.get('cpuSerialNumber','?')} | playlist={p.get('currentPlaylist','?')} | online={p.get('connectionCount',0)>0} | disk={p.get('diskSpaceUsed','?')}\")
"
