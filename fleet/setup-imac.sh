#!/usr/bin/env bash
# setup-imac.sh — one-shot onboarding for the HN office iMac appliance.
#
# What this does (idempotent — safe to re-run):
#   1. Renames hostname to hn-imac (all 3 macOS hostname slots).
#   2. Enables Remote Login (SSH inbound).
#   3. Authorizes the laptop's SSH pubkey for passwordless login.
#   4. Installs Tailscale via Homebrew if missing, opens the app.
#   5. Configures sleep/wake settings for an always-on appliance.
#   6. Disables App Nap globally for Google Chrome.
#   7. Prints a device-specs snippet to paste into fleet/devices.json on the laptop.
#
# What this does NOT do (you do these manually):
#   - Sign into Tailscale (click the menu-bar icon → "Log in" → use nihafwork@gmail.com).
#   - Install Google Chrome (download from google.com/chrome).
#   - Log into the Swiggy + Zomato partner portals.
#   - Load the aggregator-pulse extension into Chrome.
#
# Run with:  bash setup-imac.sh
# You will be prompted for your Mac password when sudo is needed.

set -euo pipefail

LAPTOP_PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE3dsouKr9nCWMyc1AWtfYuT9vHIqygSWCUVcMkuW9Lb nihaf-laptop@hn-fleet'
TARGET_HOSTNAME='hn-imac'
TARGET_COMPUTERNAME='HN iMac'
# Tailscale auth key: pass via env var TS_AUTHKEY at runtime; do NOT hardcode
# (this script is in the repo). Run as:  TS_AUTHKEY=tskey-auth-... bash setup-imac.sh
TS_AUTHKEY="${TS_AUTHKEY:-}"

# ─── colours ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
ok()   { echo -e "${G}[OK]${N}   $1"; }
warn() { echo -e "${Y}[..]${N}   $1"; }
fail() { echo -e "${R}[!!]${N}   $1"; exit 1; }
step() { echo; echo -e "${B}══${N} $1"; }

# ─── 0. preflight ─────────────────────────────────────────────────────────────
step "Preflight"

[[ "$(uname -s)" == "Darwin" ]] || fail "This script is macOS-only. You ran it on $(uname -s)."

MACOS_VER=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VER" | cut -d. -f1)
MACOS_MINOR=$(echo "$MACOS_VER" | cut -d. -f2)
ok "macOS: $MACOS_VER"

# Old macOS (≤ 10.15 Catalina): brew is best-effort, brew --cask tailscale won't
# install the modern app. We expect Tailscale.app to be manually installed from
# https://tailscale.com/download/mac (the site auto-serves a legacy build).
LEGACY_MACOS=false
if [[ "$MACOS_MAJOR" == "10" && "$MACOS_MINOR" -le 15 ]]; then
  LEGACY_MACOS=true
  warn "macOS $MACOS_VER detected — brew --cask tailscale will be skipped."
  warn "Manually download Tailscale from https://tailscale.com/download/mac"
  warn "(the site auto-serves a legacy build that works on this macOS)."
fi

if ! command -v brew >/dev/null 2>&1; then
  if $LEGACY_MACOS; then
    warn "Homebrew not present — that's OK on legacy macOS, we don't need it."
  else
    fail "Homebrew not installed. Install it first: https://brew.sh"
  fi
else
  ok "Homebrew present: $(brew --version | head -1)"
fi

# Take a sudo password ONCE up front; reuse for the duration of the script.
echo "Authorizing sudo for this session…"
sudo -v
( while true; do sudo -n true; sleep 50; kill -0 "$$" || exit; done ) 2>/dev/null &

# ─── 1. hostname ──────────────────────────────────────────────────────────────
step "Hostname → ${TARGET_HOSTNAME}"

CUR_HOSTNAME=$(scutil --get HostName 2>/dev/null || echo "(unset)")
if [[ "$CUR_HOSTNAME" == "$TARGET_HOSTNAME" ]]; then
  ok "HostName already $TARGET_HOSTNAME"
else
  sudo scutil --set HostName "$TARGET_HOSTNAME"
  ok "HostName: $CUR_HOSTNAME → $TARGET_HOSTNAME"
fi

CUR_LOCAL=$(scutil --get LocalHostName 2>/dev/null || echo "(unset)")
if [[ "$CUR_LOCAL" == "$TARGET_HOSTNAME" ]]; then
  ok "LocalHostName already $TARGET_HOSTNAME"
else
  sudo scutil --set LocalHostName "$TARGET_HOSTNAME"
  ok "LocalHostName: $CUR_LOCAL → $TARGET_HOSTNAME"
fi

CUR_COMPUTER=$(scutil --get ComputerName 2>/dev/null || echo "(unset)")
if [[ "$CUR_COMPUTER" == "$TARGET_COMPUTERNAME" ]]; then
  ok "ComputerName already $TARGET_COMPUTERNAME"
else
  sudo scutil --set ComputerName "$TARGET_COMPUTERNAME"
  ok "ComputerName: $CUR_COMPUTER → $TARGET_COMPUTERNAME"
fi

# ─── 2. Remote Login (SSH inbound) ────────────────────────────────────────────
step "Remote Login (SSH inbound)"

if sudo systemsetup -getremotelogin 2>/dev/null | grep -qi "On"; then
  ok "Remote Login already on"
else
  sudo systemsetup -setremotelogin on
  ok "Remote Login enabled"
fi

# ─── 3. authorize laptop pubkey ───────────────────────────────────────────────
step "Authorize laptop SSH pubkey"

mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

if grep -qF "$LAPTOP_PUBKEY" ~/.ssh/authorized_keys; then
  ok "Laptop pubkey already authorized"
else
  echo "$LAPTOP_PUBKEY" >> ~/.ssh/authorized_keys
  ok "Laptop pubkey appended to ~/.ssh/authorized_keys"
fi

# ─── 4. Tailscale ─────────────────────────────────────────────────────────────
step "Tailscale install"

if [[ -d /Applications/Tailscale.app ]]; then
  ok "Tailscale.app already installed"
elif $LEGACY_MACOS; then
  fail "Tailscale.app not in /Applications. On legacy macOS, install it manually first:
  1. Download from https://tailscale.com/download/mac
  2. Open the .pkg, follow installer
  3. Re-run this script
  (We can't auto-install on legacy macOS — brew cask requires macOS 11+.)"
else
  warn "Installing via Homebrew (this may take a minute)…"
  brew install --cask tailscale
  ok "Tailscale installed"
fi

# Symlink CLI so `tailscale` works in the terminal.
TS_BIN='/Applications/Tailscale.app/Contents/MacOS/Tailscale'
if [[ -x "$TS_BIN" ]]; then
  if [[ ! -e /usr/local/bin/tailscale ]] && [[ -d /usr/local/bin ]]; then
    sudo ln -sf "$TS_BIN" /usr/local/bin/tailscale
    ok "tailscale CLI symlinked → /usr/local/bin/tailscale"
  fi
fi

# Make sure the app is running so the daemon registers.
if ! pgrep -x "Tailscale" >/dev/null; then
  open -a Tailscale || true
  ok "Tailscale.app launched"
else
  ok "Tailscale daemon already running"
fi

# If TS_AUTHKEY was provided, sign in unattended.
if [[ -n "$TS_AUTHKEY" ]]; then
  if [[ -x "$TS_BIN" ]]; then
    sleep 3  # let daemon settle
    "$TS_BIN" up --authkey="$TS_AUTHKEY" --hostname="$TARGET_HOSTNAME" \
      --accept-routes=false --advertise-exit-node=false 2>&1 || \
      warn "tailscale up failed — sign in manually via menu bar icon"
    ok "Tailscale: signed in (or already up) as $TARGET_HOSTNAME"
  fi
else
  warn "No TS_AUTHKEY provided — sign in manually via menu bar icon → Log in (nihafwork@gmail.com)"
fi

# ─── 5. always-on energy settings ─────────────────────────────────────────────
step "Energy / sleep settings (appliance-mode)"

# pmset reference: https://www.dssw.co.uk/reference/pmset.html
sudo pmset -a sleep 0                # never sleep computer
sudo pmset -a displaysleep 30        # display can sleep, computer cannot
sudo pmset -a disksleep 0            # never sleep disks
sudo pmset -a powernap 0             # disable powernap (can throttle Chrome)
sudo pmset -a womp 1                 # wake on magic packet / network
sudo pmset -a autorestart 1          # auto-reboot after power failure
sudo pmset -a tcpkeepalive 1         # keep TCP connections alive

ok "Energy: never sleep, display 30min, wake-on-network ON, auto-restart ON"

# ─── 6. App Nap off for Chrome ────────────────────────────────────────────────
step "Disable App Nap for Chrome"

defaults write com.google.Chrome NSAppSleepDisabled -bool YES
ok "Chrome will not be put to sleep when its window is hidden"

# ─── 7. capture device specs ──────────────────────────────────────────────────
step "Device fingerprint"

OS_VER=$(sw_vers -productVersion)
OS_BUILD=$(sw_vers -buildVersion)
ARCH=$(uname -m)
MODEL=$(sysctl -n hw.model 2>/dev/null || echo "?")
CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "?")
RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
USER_NAME=$(whoami)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "?")

cat <<DEVSPEC

──────────────────────────────────────────────────────────
Paste this into fleet/devices.json on the LAPTOP:
──────────────────────────────────────────────────────────

  "hn-imac": {
    "role": "appliance",
    "primary_user": "$USER_NAME",
    "platform": "macos",
    "arch": "$ARCH",
    "os_version": "$OS_VER",
    "os_build": "$OS_BUILD",
    "model": "$MODEL",
    "chip": "$CHIP",
    "ram_gb": $RAM_GB,
    "hostname_local": "$TARGET_HOSTNAME",
    "hostname_tailscale": "$TARGET_HOSTNAME",
    "local_ip_at_setup": "$LOCAL_IP",
    "registered_at": "$(date +%Y-%m-%d)",
    "always_on": true,
    "purpose": "Aggregator pulse appliance — Chrome + extension 24/7. Future home for any macOS-bound automation.",
    "capabilities": ["chrome-runtime", "aggregator-pulse"]
  }

──────────────────────────────────────────────────────────
DEVSPEC

# ─── 8. final manual steps ────────────────────────────────────────────────────
step "Manual steps you still need to do"
cat <<MANUAL

  ${Y}1.${N} Open Tailscale (menu-bar icon) → ${B}Log in${N} →
     sign in with ${B}nihafwork@gmail.com${N}.
     This iMac will appear in the Tailscale admin panel as ${B}${TARGET_HOSTNAME}${N}.

  ${Y}2.${N} If Google Chrome is not yet installed, download from
     https://www.google.com/chrome and install.

  ${Y}3.${N} In Chrome → Settings → "Continue where you left off" → ON.
     Log in to:
       • https://partner.swiggy.com/food/
       • https://www.zomato.com/partners/

  ${Y}4.${N} System Settings → General → Login Items →
     add Google Chrome (so it auto-launches on reboot).

  ${Y}5.${N} On the laptop, run:  ${B}./fleet/verify-bridge.sh${N}
     to confirm the bridge is up.

  ${Y}6.${N} Once verified, the aggregator extension gets pushed from laptop
     and loaded in Chrome. (Separate step — not this script.)

MANUAL

ok "Setup script done. Hostname is now ${TARGET_HOSTNAME}."
