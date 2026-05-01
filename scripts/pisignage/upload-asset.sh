#!/bin/bash
# Upload a file to PiSignage assets library
# Usage: ./upload-asset.sh /path/to/file.mp4
# Reference: docs/PISIGNAGE_CONTROL.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO_ROOT/.env.local" ] && source "$REPO_ROOT/.env.local"

BASE_URL="https://hamzaexpress.pisignage.com/api"
FILE_PATH="${1:?File path required}"

if [ -z "${PISIGNAGE_TOKEN:-}" ]; then
  echo "❌ PISIGNAGE_TOKEN not set"; exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "❌ File not found: $FILE_PATH"; exit 1
fi

echo "Uploading $(basename "$FILE_PATH") ($(stat -f%z "$FILE_PATH" | awk '{printf "%.2fMB", $1/1024/1024}'))..."

curl -sS -X POST \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -F "assets=@$FILE_PATH" \
  "$BASE_URL/files/upload" \
  | python3 -m json.tool
