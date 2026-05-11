# fleet/winpc.sh — bootstrap for any chat operating on the hn-winpc appliance.
#
# Source me at the start of your session:
#
#   cd /path/to/HN-Hotels-Site
#   source fleet/winpc.sh
#   export WINPC_CHAT_ID="my-chat-id"    # optional but recommended
#
# After sourcing you have a `winpc` shell function that dispatches to
# fleet/winpc.mjs. Doctrine: fleet/winpc-MASTER-CONTEXT.md.

WINPC_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"

if [ -z "$WINPC_REPO_ROOT" ] || [ ! -f "$WINPC_REPO_ROOT/fleet/winpc.mjs" ]; then
  echo "winpc.sh: could not locate fleet/winpc.mjs — run this from the HN-Hotels-Site checkout." >&2
  return 1 2>/dev/null || exit 1
fi

export WINPC_REPO_ROOT

winpc() {
  node "$WINPC_REPO_ROOT/fleet/winpc.mjs" "$@"
}

# Quick aliases for the most common reads.
alias winpc-audit='winpc audit'
alias winpc-doctor='winpc doctor'

cat <<EOF
hn-winpc protocol loaded.
  winpc audit          # registered vs live, flag orphans
  winpc doctor         # per-automation health
  winpc help           # all verbs
Doctrine: fleet/winpc-MASTER-CONTEXT.md
Resource graph: fleet/winpc-resource-graph.json
${WINPC_CHAT_ID:+chat-id: $WINPC_CHAT_ID}
EOF
