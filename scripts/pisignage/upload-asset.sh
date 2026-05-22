#!/bin/bash
# Upload a file to PiSignage assets library (two-step: upload + postupload)
# Usage: ./upload-asset.sh /path/to/file.mp4
# Reference: docs/PISIGNAGE_CONTROL.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO_ROOT/.env.local" ] && source "$REPO_ROOT/.env.local"

BASE_URL="https://hamzaexpress.pisignage.com/api"
FILE_PATH="${1:?File path required}"
FILENAME="$(basename "$FILE_PATH")"

if [ -z "${PISIGNAGE_TOKEN:-}" ]; then
  echo "❌ PISIGNAGE_TOKEN not set"; exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "❌ File not found: $FILE_PATH"; exit 1
fi

echo "── Step 1: Uploading $FILENAME ($(stat -f%z "$FILE_PATH" | awk '{printf "%.2fMB", $1/1024/1024}'))..."

UPLOAD_RESULT=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -F "assets=@$FILE_PATH" \
  "$BASE_URL/files")

echo "$UPLOAD_RESULT" | python3 -m json.tool
STATUS=$(echo "$UPLOAD_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','?'))")

if [ "$STATUS" != "True" ] && [ "$STATUS" != "true" ]; then
  echo "❌ Upload failed"; exit 1
fi

echo ""
echo "── Step 2: Registering $FILENAME in asset DB (POST /postupload)..."

POST_RESULT=$(curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"$FILENAME\"}" \
  "$BASE_URL/postupload")

echo "$POST_RESULT" | python3 -m json.tool
echo ""
echo "✅ $FILENAME uploaded and registered. Ready to use in playlists."
