#!/bin/bash
# Fix TV-V1 and TV-H1 deployment bug · 2026-05-01
# Problem: Menu Page 1 has horizontal video; KDS Kitchen Pass missing horizontal video
# Fix: Correct playlist assignments + poll until sync confirmed
# Usage: ./fix-deployment.sh
# Requires: PISIGNAGE_TOKEN in .env.local (generate via PiSignage UI → Profile → API Token)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO_ROOT/.env.local" ] && source "$REPO_ROOT/.env.local"

BASE_URL="https://hamzaexpress.pisignage.com/api"

if [ -z "${PISIGNAGE_TOKEN:-}" ]; then
  echo "❌ PISIGNAGE_TOKEN not set in .env.local"
  echo ""
  echo "Generate one:"
  echo "  1. Open https://hamzaexpress.pisignage.com"
  echo "  2. Top-right → Change Profile → Generate API Token"
  echo "  3. Add to .env.local: PISIGNAGE_TOKEN=<token>"
  echo ""
  echo "Alternative: use Chrome MCP method (open Chrome with PiSignage logged in,"
  echo "then Claude can call the API using session cookie via javascript_tool)"
  exit 1
fi

# CPU serial numbers (for API polling only — use internal IDs for player commands)
TV_V1_SERIAL="500000005ac7e22f"
TV_H1_SERIAL="5000000045322d4d"

# MongoDB internal _id values (for POST /api/players/<id> re-deploy)
TV_V1_INTERNAL="69a0bd975b9a6c146ac9dfae"
TV_H1_INTERNAL="69a05aad5b9a6c146a9ae416"

echo "=== PiSignage Deployment Fix · $(date '+%Y-%m-%d %H:%M IST') ==="
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 · Diagnose current playlist state
# ─────────────────────────────────────────────────────────────────────────────

echo "── Step 1: Reading current playlist state ──"
PLAYLISTS=$(curl -sS -H "x-access-token: $PISIGNAGE_TOKEN" "$BASE_URL/playlists")

echo "Menu Page 1 assets:"
echo "$PLAYLISTS" | python3 -c "
import json, sys
d = json.load(sys.stdin)
playlists = d.get('data', {}).get('objects', [])
for p in playlists:
    if p.get('name') == 'Menu Page 1':
        for a in p.get('assets', []):
            print(f\"  {a.get('filename')} (duration={a.get('duration')}s)\")
"

echo ""
echo "KDS Kitchen Pass assets:"
echo "$PLAYLISTS" | python3 -c "
import json, sys
d = json.load(sys.stdin)
playlists = d.get('data', {}).get('objects', [])
for p in playlists:
    if p.get('name') == 'KDS Kitchen Pass':
        for a in p.get('assets', []):
            print(f\"  {a.get('filename')} (duration={a.get('duration')}s)\")
"

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 · Fix Menu Page 1 → VERTICAL video
# ─────────────────────────────────────────────────────────────────────────────

echo "── Step 2: Setting Menu Page 1 → VERTICAL video ──"
PAYLOAD_V1=$(python3 -c "
import json
print(json.dumps({
  'assets': [{
    'filename': 'TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4',
    'duration': 10,
    'fullscreen': True,
    'selected': True,
    'option': {'main': False}
  }],
  'settings': {},
  'layout': '1',
  'templateName': 'custom_layout.html'
}))
")

RESULT_V1=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_V1" \
  "$BASE_URL/playlists/Menu%20Page%201")

STATUS_V1=$(echo "$RESULT_V1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))")
echo "  Menu Page 1 update: success=$STATUS_V1"

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 · Fix KDS Kitchen Pass → HORIZONTAL video
# ─────────────────────────────────────────────────────────────────────────────

echo "── Step 3: Setting KDS Kitchen Pass → HORIZONTAL video ──"
PAYLOAD_H1=$(python3 -c "
import json
print(json.dumps({
  'assets': [{
    'filename': 'TV-Horizontal_GheeRice_Cinemagraph_v1.mp4',
    'duration': 10,
    'fullscreen': True,
    'selected': True,
    'option': {'main': False}
  }],
  'settings': {},
  'layout': '1',
  'templateName': 'custom_layout.html'
}))
")

RESULT_H1=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_H1" \
  "$BASE_URL/playlists/KDS%20Kitchen%20Pass")

STATUS_H1=$(echo "$RESULT_H1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))")
echo "  KDS Kitchen Pass update: success=$STATUS_H1"

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 · Poll for sync (both TVs already have playlists assigned → auto-sync)
# ─────────────────────────────────────────────────────────────────────────────

echo "── Step 4: Polling for device sync (up to 5 min) ──"
echo "  (Both TVs have existing playlist assignments — auto-sync expected within 60–180s)"
echo ""

for i in $(seq 1 10); do
  sleep 30
  echo "  Poll $i/10 ($(( i * 30 ))s elapsed)..."

  PLAYERS=$(curl -sS -H "x-access-token: $PISIGNAGE_TOKEN" "$BASE_URL/players")

  echo "$PLAYERS" | python3 -c "
import json, sys
d = json.load(sys.stdin)
players = d.get('data', {}).get('objects', [])
targets = {
  '${TV_V1_SERIAL}': 'TV-V1 (Menu Page 1)',
  '${TV_H1_SERIAL}': 'TV-H1 (Kitchen Pass)',
}
for p in players:
    pid = p.get('cpuSerialNumber','').replace('-','')
    if pid in targets:
        online = p.get('connectionCount', 0) > 0
        playlist = p.get('currentPlaylist', '?')
        queue = p.get('filesQueue', '')
        wgetspeed = p.get('wgetSpeed', '')
        status = 'ONLINE' if online else 'OFFLINE'
        print(f\"    {targets[pid]}: {status} | playlist={playlist} | queue={queue!r} | wget={wgetspeed!r}\")
"
  echo ""
done

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 · Player-level re-deploy (force immediate sync on stuck devices)
# ─────────────────────────────────────────────────────────────────────────────

echo "── Step 5: Player-level re-deploy (POST /api/players/<internal_id>) ──"
echo "  This forces each device to pull the latest playlist immediately."
echo ""

REDEPLOY_V1=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE_URL/players/$TV_V1_INTERNAL")
echo "  TV-V1 re-deploy: $(echo "$REDEPLOY_V1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))")"

REDEPLOY_H1=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE_URL/players/$TV_H1_INTERNAL")
echo "  TV-H1 re-deploy: $(echo "$REDEPLOY_H1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))")"
echo ""

echo "=== Fix complete. Check TVs physically. ==="
echo ""
echo "If TV-V1 still shows horizontal: the file 'TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4'"
echo "in PiSignage library may itself be horizontal (upload mixup). In that case:"
echo "  1. Delete the file from PiSignage library (/v2/assets/)"
echo "  2. Re-upload from: ~/Desktop/HE_May1_v4_Creative_Production/10_Final_Outputs/Video/TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4"
echo "  3. Re-run this script"
