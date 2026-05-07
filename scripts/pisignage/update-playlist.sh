#!/bin/bash
# Update a PiSignage playlist · REPLACES the assets array
# Usage: ./update-playlist.sh "<playlist name>" <filename1> [filename2 ...]
# Example: ./update-playlist.sh "Menu Page 1" "TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4"
# Reference: docs/PISIGNAGE_CONTROL.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO_ROOT/.env.local" ] && source "$REPO_ROOT/.env.local"

BASE_URL="https://hamzaexpress.pisignage.com/api"
PLAYLIST_NAME="${1:?Playlist name required}"; shift

if [ -z "${PISIGNAGE_TOKEN:-}" ]; then
  echo "❌ PISIGNAGE_TOKEN not set"; exit 1
fi

# Build assets JSON array from remaining args
ASSETS_JSON=$(python3 -c "
import json, sys
files = sys.argv[1:]
assets = [{'filename': f, 'duration': 10, 'fullscreen': True, 'selected': True, 'option': {'main': False}} for f in files]
print(json.dumps(assets))
" "$@")

PAYLOAD=$(python3 -c "
import json
print(json.dumps({
  'assets': $ASSETS_JSON,
  'settings': {},
  'layout': '1',
  'templateName': 'custom_layout.html'
}))
")

# URL encode playlist name
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PLAYLIST_NAME'))")

curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$BASE_URL/playlists/$ENCODED" \
  | python3 -m json.tool
