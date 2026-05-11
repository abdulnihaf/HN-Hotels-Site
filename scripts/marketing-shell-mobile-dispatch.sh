#!/bin/bash
# scripts/marketing-shell-mobile-dispatch.sh
#
# iPhone/iPad/Mac helper that dispatches a directive to a marketing-shell lane
# via the GitHub-backed queue branch (claude/marketing-shell-mobile-queue).
#
# Why a script: iPhone Claude Code sandbox can't reach hnhotels.in or *.ts.net,
# but it CAN talk to github.com. This script uses git push/pull as the transport.
#
# Usage:
#   bash scripts/marketing-shell-mobile-dispatch.sh <lane> "<directive>" [poll_seconds]
#
# Lanes: 01-influencer 02-google 03-aggregator 04-dine 05-tv 06-meta marketing-orchestrator
# Default poll: 30s up to 5 min.
#
# Side effects: creates + pushes data/marketing-shell-mobile/inbox/<id>.json on
# branch claude/marketing-shell-mobile-queue. Polls for outbox file. Prints result.

set -euo pipefail

LANE="${1:-}"
DIRECTIVE="${2:-}"
POLL_INTERVAL="${3:-30}"
MAX_WAIT_SEC=300

if [[ -z "$LANE" || -z "$DIRECTIVE" ]]; then
  echo "Usage: $0 <lane> \"<directive>\" [poll_seconds]" >&2
  echo "Lanes: 01-influencer 02-google 03-aggregator 04-dine 05-tv 06-meta marketing-orchestrator" >&2
  exit 1
fi

case "$LANE" in
  01-influencer|02-google|03-aggregator|04-dine|05-tv|06-meta|marketing-orchestrator|99-general) ;;
  *) echo "ERR: invalid lane '$LANE'. valid: 01-influencer 02-google 03-aggregator 04-dine 05-tv 06-meta marketing-orchestrator 99-general" >&2; exit 1 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "ERR: must be run from inside the HN-Hotels-Site git repo" >&2
  exit 1
fi
cd "$REPO_ROOT"

BRANCH="claude/marketing-shell-mobile-queue"
QUEUE_DIR="data/marketing-shell-mobile"
INBOX="$QUEUE_DIR/inbox"
OUTBOX="$QUEUE_DIR/outbox"

# Remember which branch we were on so we can return
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Fetch + checkout queue branch
git fetch origin "$BRANCH" >/dev/null 2>&1
git checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null 2>&1

# Generate job_id
TIMESTAMP=$(date -u +%s)
RAND=$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 6 || echo "xxxxxx")
JOB_ID="iph-${TIMESTAMP}-${RAND}"

mkdir -p "$INBOX" "$OUTBOX"

# Detect source ΓÇö iPhone Claude Code sets some env, default to iphone
SOURCE="${MARKETING_SHELL_SOURCE:-iphone}"
if [[ "$(uname -s)" == "Darwin" ]]; then SOURCE="mac"; fi

# Write inbox JSON (use jq if available, else printf)
INBOX_FILE="$INBOX/$JOB_ID.json"
if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg id "$JOB_ID" \
    --arg lane "$LANE" \
    --arg directive "$DIRECTIVE" \
    --arg source "$SOURCE" \
    --argjson created_at "$TIMESTAMP" \
    '{job_id:$id, lane:$lane, directive:$directive, source:$source, created_at:$created_at}' \
    > "$INBOX_FILE"
else
  # Crude JSON escape fallback (no embedded quotes / newlines support)
  ESC_DIR=$(printf '%s' "$DIRECTIVE" | sed 's/"/\\"/g')
  printf '{"job_id":"%s","lane":"%s","directive":"%s","source":"%s","created_at":%s}\n' \
    "$JOB_ID" "$LANE" "$ESC_DIR" "$SOURCE" "$TIMESTAMP" \
    > "$INBOX_FILE"
fi

git add "$INBOX_FILE"
git commit -m "inbox: $JOB_ID (lane=$LANE source=$SOURCE)" >/dev/null
git push origin "$BRANCH" >/dev/null 2>&1

echo "DISPATCHED job_id=$JOB_ID lane=$LANE source=$SOURCE"
echo "Polling for result (every ${POLL_INTERVAL}s, up to ${MAX_WAIT_SEC}s)..."

OUTBOX_FILE="$OUTBOX/$JOB_ID.json"
ELAPSED=0
while (( ELAPSED < MAX_WAIT_SEC )); do
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
  git fetch origin "$BRANCH" >/dev/null 2>&1
  git reset --hard "origin/$BRANCH" >/dev/null 2>&1
  if [[ -f "$OUTBOX_FILE" ]]; then
    echo ""
    echo "=== RESULT for $JOB_ID ==="
    if command -v jq >/dev/null 2>&1; then
      STATUS=$(jq -r '.status' "$OUTBOX_FILE")
      echo "status: $STATUS"
      if [[ "$STATUS" == "completed" ]]; then
        jq -r '.result' "$OUTBOX_FILE"
      else
        jq -r '"error: " + (.error // "unknown") + (if .partial then "\n--- partial ---\n" + .partial else "" end)' "$OUTBOX_FILE"
      fi
    else
      cat "$OUTBOX_FILE"
    fi
    # Return to original branch
    git checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true
    exit 0
  fi
  echo "  ...waited ${ELAPSED}s, no outbox yet"
done

echo ""
echo "TIMEOUT after ${MAX_WAIT_SEC}s ΓÇö job $JOB_ID still queued. Try:"
echo "  git fetch origin $BRANCH && git show origin/$BRANCH:$OUTBOX_FILE"
git checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true
exit 2
