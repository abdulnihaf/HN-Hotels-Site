# HN Fleet — Operations Bridge

Cross-network bridge for HN's appliance devices: laptop (mobile dev), office Windows PC (primary always-on appliance), and an office iMac (secondary appliance / macOS jobs). The point of this directory is so any Claude Code session opened on the laptop can reach any appliance, run diagnostics, deploy code, and pull logs — regardless of which WiFi the laptop is on.

## Architecture

```
              ┌── Tailscale overlay network ──┐
              │   (works on any internet,     │
              │    private to nihafwork@      │
              │    gmail.com account)         │
              │                               │
              │   nihaf-laptop  ◀── SSH ──▶   │
              │       │             hn-winpc  │  (PRIMARY appliance,
              │       │                       │   HP EliteDesk 800 G3 DM,
              │       │                       │   Windows 10, 8GB, SSD)
              │       │                       │
              │       └── SSH ──▶  hn-imac    │  (SECONDARY appliance,
              │                               │   macOS Mojave/Catalina-era)
              └───────────────────────────────┘
```

- **Transport:** Tailscale → SSH (key-based, ed25519). Tailscale handles network identity and NAT traversal; SSH handles command execution and file transfer.
- **Identity:** All devices signed into the same Tailscale account (nihafwork@gmail.com). Only those devices can talk.
- **Auth:** Laptop's public key (`~/.ssh/id_ed25519.pub`) authorized on each appliance. Pubkey is mirrored at `fleet/laptop-pubkey.txt` for easy copy.
- **Naming:** Devices renamed to short branded hostnames (`hn-winpc`, `hn-imac`) before Tailscale sign-in so Tailscale picks them up cleanly.

## Why Tailscale, not vanilla SSH

The office appliances will be on office WiFi/ethernet. The laptop roams (home, office, cafe). Plain SSH only works if both sides are on the same LAN or you do messy port-forwarding. Tailscale gives stable private hostnames that resolve from anywhere — set up once, never think about networks again.

## Devices

See `devices.json` for the machine-readable registry. Human summary:

| Device | Role | Always on? | Hardware | Purpose |
|---|---|---|---|---|
| `nihaf-laptop` | dev | no | Apple Silicon, macOS Tahoe | Claude Code workstation; mobile |
| `hn-winpc` | **PRIMARY appliance** | **yes** | HP EliteDesk 800 G3 DM, Win10, 8GB, SSD | Aggregator pulse + future Windows automation |
| `hn-imac` | secondary appliance | yes | iMac, macOS Mojave/Catalina | Backup + macOS-only jobs |

### Why Windows PC is primary, not the iMac

We initially planned the iMac as primary. After inspecting both:

1. **Hardware purpose-fit.** The HP EliteDesk DM is a 35W mini-PC literally built for 24/7 business use — SSD, low heat, gigabit ethernet, no moving parts beyond a small fan. The iMac is older (Mojave/Catalina-era), has full storage blocking macOS updates, and consumer-tier hardware not designed to run forever.
2. **Modern Chrome.** Windows 10 runs current Chrome with no compatibility issues. The Mojave-era iMac is on stale Chrome that the partner portals (Swiggy/Zomato) will eventually flag as outdated and refuse to render.
3. **Wired ethernet > WiFi.** The Windows PC has gigabit ethernet built-in; more stable than WiFi, which matters when Akamai's bot detection sees connection blips as suspicious.
4. **Clean storage.** ~112 GB free on the Windows PC vs full disk on the iMac.

The iMac stays in the fleet as a secondary — useful for any macOS-specific automation, and as a failover if the Windows PC dies.

## Operations

### From the laptop, reach an appliance

```bash
ssh hn-winpc                                    # interactive Windows shell (PowerShell)
ssh hn-winpc 'tasklist | findstr chrome'        # is Chrome alive?
scp -r ~/Downloads/agg-ext hn-winpc:'C:/Users/<user>/Downloads/'  # push files

ssh hn-imac                                     # interactive Mac shell
ssh hn-imac 'pgrep -fl Chrome'                  # is Chrome alive?
ssh hn-imac 'caffeinate -s &'                   # keep awake (one-shot)
```

The shorthands `hn-winpc` and `hn-imac` resolve via Tailscale's MagicDNS (no IP needed).

### Smoke test

```bash
./fleet/verify-bridge.sh hn-winpc    # primary
./fleet/verify-bridge.sh hn-imac     # secondary
```

Runs a checklist: SSH reachable, latency, appliance state. Prints PASS/FAIL per check.

### Setup runbook (one-time per device)

**Windows PC (primary):**

1. Get `setup-winpc.ps1` onto the iMac. Easiest: clone the HN-Hotels-Site repo on the PC, or copy via USB / OneDrive.
2. Optional: paste a Tailscale auth key into the `$TailscaleAuthKey` variable at the top of the script — saves a manual sign-in step. Get one at `login.tailscale.com/admin/settings/keys` (reusable, ephemeral=OFF).
3. Right-click PowerShell → **Run as Administrator**.
4. `Set-ExecutionPolicy -Scope Process Bypass -Force; .\setup-winpc.ps1`
5. After reboot, sign into Tailscale (the script will tell you the exact command if no auth key was used).
6. Paste the device-spec block the script prints into `fleet/devices.json` over the `hn-winpc` entry.

**iMac (secondary):**

1. Get `setup-imac.sh` onto the iMac (via clone, AirDrop, or iCloud Drive).
2. Run: `bash fleet/setup-imac.sh` (asks for password once).
3. Open Tailscale from the menu bar → sign in with `nihafwork@gmail.com`.
4. Paste the device-spec block printed by the script into `fleet/devices.json`.

**On the laptop, after either device is online:**

```bash
./fleet/verify-bridge.sh hn-winpc    # or hn-imac
```

## Operational gotchas — Windows appliance

- **Hostname change requires reboot.** Setup script prompts for it.
- **OpenSSH admin authorized_keys is special.** Windows OpenSSH puts admin users' authorized_keys at `C:\ProgramData\ssh\administrators_authorized_keys`, NOT the user's `.ssh\authorized_keys`. The setup script populates both with locked-down ACLs. If SSH key auth fails, this is almost always why.
- **Power plan defaults to Balanced (sleeps).** Setup script switches to High Performance and disables every sleep/hibernate timer.
- **USB selective suspend kills network adapters on docks.** Disabled by setup script.
- **Windows Update reboots.** Setup script defines active hours 06:00–23:00 so auto-reboots happen overnight, not during business hours. Major feature updates can still force-reboot — the laptop should occasionally check `ssh hn-winpc 'systeminfo | findstr Boot'` to spot unexpected restarts.

## Operational gotchas — macOS appliance

- **Sleep:** macOS sleeps aggressively. Setup script sets pmset to never sleep computer/disk; display can sleep but computer doesn't.
- **App Nap:** throttles background Chrome tabs. Setup script disables for Chrome via `defaults write`.
- **Login Items:** Chrome must auto-launch on login. Manual step (System Settings → Login Items).
- **Chrome tab restore:** Settings → "Continue where you left off" — manual step.
- **Hostname:** macOS three-name confusion (HostName / LocalHostName / ComputerName). Setup script aligns all three.
- **Old macOS.** If the iMac is stuck on Mojave/Catalina, the latest Tailscale won't install — script falls back to legacy Tailscale package (1.36 for Mojave, 1.62 for Catalina). Both are still backward-compatible with current Tailscale infrastructure.

## What this directory does NOT do (yet)

- **Log shipping:** Chrome console logs from the extension stay on the appliance. To debug, SSH in and read. Future: a small log endpoint added to the Cloudflare Worker so extension errors flow centrally.
- **Auto-recovery:** if Chrome crashes hard or the appliance freezes, no automation kicks in. Future: a watchdog script (Task Scheduler on Windows / launchd on macOS) that restarts Chrome if it dies.
- **Linux migration:** long-term move for hn-winpc when Win10 becomes truly unmaintainable is to install Ubuntu Server LTS on the same hardware. Free, supported indefinitely, lighter than Windows. Out of scope for now.

## Files

- `README.md` — this doc
- `devices.json` — device registry (machine-readable)
- `laptop-pubkey.txt` — laptop's SSH pubkey for `authorized_keys`
- `setup-winpc.ps1` — primary appliance setup (Windows)
- `setup-imac.sh` — secondary appliance setup (macOS)
- `verify-bridge.sh` — laptop-side bridge smoke test (works for any target)
