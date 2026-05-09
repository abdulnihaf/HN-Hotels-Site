#!/usr/bin/env bash
# verify-bridge.sh — laptop-side smoke test for the HN fleet bridge.
#
# Run from the laptop after the iMac has been onboarded (Tailscale signed in,
# setup-imac.sh has run). Confirms each layer of the stack independently.

set -uo pipefail

TARGET="${1:-hn-imac}"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
pass() { echo -e "${G}✓${N} $1"; }
fail() { echo -e "${R}✗${N} $1"; FAILED=1; }
warn() { echo -e "${Y}!${N} $1"; }
hdr()  { echo; echo -e "${B}── $1 ──${N}"; }

FAILED=0

hdr "1. Tailscale installed on laptop"
if command -v tailscale >/dev/null 2>&1; then
  pass "tailscale binary present"
elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
  pass "Tailscale.app present (CLI not symlinked — that's ok)"
  alias tailscale='/Applications/Tailscale.app/Contents/MacOS/Tailscale'
else
  fail "Tailscale not installed. Run: brew install --cask tailscale"
  exit 1
fi

hdr "2. Tailscale signed in & connected"
TS=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>&1 || echo "ERROR")
if echo "$TS" | grep -qi "logged out\|stopped\|not running"; then
  fail "Tailscale not connected. Open Tailscale.app menubar → Log in."
  exit 1
elif echo "$TS" | grep -qi "$TARGET"; then
  pass "Tailscale up. Target '$TARGET' visible in tailnet."
else
  warn "Tailscale is up but '$TARGET' not seen in tailnet."
  warn "Devices visible:"
  echo "$TS" | head -10 | sed 's/^/    /'
  fail "iMac not in tailnet — check it's signed in to the same Tailscale account."
  exit 1
fi

hdr "3. ICMP / DNS"
if ping -c 1 -W 2000 "$TARGET" >/dev/null 2>&1; then
  pass "Pings $TARGET (Tailscale MagicDNS resolving)"
else
  fail "Cannot ping $TARGET. Tailnet up but no route — check iMac is online."
fi

hdr "4. SSH reachable"
SSH_OUT=$(ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET" 'echo OK; uname -srv; whoami' 2>&1) || true
if echo "$SSH_OUT" | grep -q "^OK$"; then
  pass "SSH login (key-based, no password)"
  echo "$SSH_OUT" | tail -2 | sed 's/^/    /'
else
  fail "SSH failed:"
  echo "$SSH_OUT" | head -5 | sed 's/^/    /'
fi

hdr "5. Round-trip latency"
PING_AVG=$(ping -c 4 -q "$TARGET" 2>/dev/null | awk -F'/' '/round-trip/ {print $5}' || echo "?")
if [[ "$PING_AVG" != "?" && "$PING_AVG" != "" ]]; then
  pass "Avg latency: ${PING_AVG} ms"
else
  warn "Couldn't measure latency"
fi

hdr "6. iMac appliance state"
ssh -o ConnectTimeout=5 "$TARGET" 'bash -s' 2>/dev/null <<'EOF' || warn "couldn't query appliance state"
echo -n "  uptime:        "; uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1, $2}'
echo -n "  chrome alive:  "; pgrep -fl 'Google Chrome' >/dev/null && echo "yes ($(pgrep -fl 'Google Chrome' | wc -l | tr -d ' ') procs)" || echo "NO"
echo -n "  caffeinate:    "; pmset -g | awk '/sleep/ {print "sleep="$3}' | head -1
echo -n "  tailscale:     "; /Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>/dev/null | head -1
EOF

echo
if [[ $FAILED -eq 0 ]]; then
  echo -e "${G}══ Bridge verified. You can now SSH freely:  ssh $TARGET${N}"
else
  echo -e "${R}══ Bridge has $FAILED failures. Fix above before continuing.${N}"
  exit 1
fi
