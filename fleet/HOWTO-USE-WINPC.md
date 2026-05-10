# How to use `hn-winpc` from Claude Code

This is the always-on Windows appliance in the HN Hotels office. Any Claude Code session opened in this repo on the laptop has full SSH key-auth control over it — no passwords, no extra setup, just SSH commands.

## Hardware + role

- **Machine:** HP EliteDesk 800 G3 DM 35W mini-PC (Intel i3-6100T, 8 GB RAM, 238 GB SSD ~112 GB free, WiFi via USB Realtek RTL8192EU adapter)
- **OS:** Windows 10 Pro (build 19045)
- **Tailscale:** `100.65.7.61` · `hn-winpc.taile7bb4d.ts.net` · unattended mode ON (stays connected even when no user logged in)
- **Currently running:** Chrome with `hn-aggregator-ext` (v6.1.0) auto-loaded, scraping Swiggy + Zomato partner portals 24/7, pushing to `hnhotels.in/api/aggregator-pulse`

## SSH access

```bash
# Default shell on the remote is cmd.exe.
ssh "HN Hotels@hn-winpc" 'whoami; hostname'

# For PowerShell, wrap explicitly:
ssh "HN Hotels@hn-winpc" 'powershell -Command "Get-Service Tailscale"'

# For multi-line PowerShell scripts, pipe via stdin:
cat <<'EOF' | ssh "HN Hotels@hn-winpc" 'powershell -Command "$in=[Console]::In.ReadToEnd(); Invoke-Expression $in"'
Get-Process chrome | Select-Object Name, Id, WorkingSet
$ts = & "C:\Program Files\Tailscale\tailscale.exe" status
$ts
EOF

# File transfer — tar pipe (scp's quoting is unreliable with the spaced username):
tar -cf - mylocaldir | ssh "HN Hotels@hn-winpc" 'powershell -Command "cd \"C:\target\path\"; tar -xf -"'
```

**Why the quoting?** The Windows account is named `HN Hotels` (with a space). OpenSSH's `User` config field doesn't accept spaces, so omit it from `~/.ssh/config` and quote `"HN Hotels@hn-winpc"` on the command line.

## What's deployed and where

| Path | Purpose |
|---|---|
| `C:\Users\HN Hotels\Documents\hn-aggregator-ext\` | Chrome extension v6.1.0 (the appliance code) |
| `C:\Users\HN Hotels\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\hn-aggregator-chrome.bat` | Auto-launches Chrome with `--load-extension=` + Swiggy + Zomato URLs on every login |
| `C:\Users\HN Hotels\Documents\hn-aggregator-watchdog.bat` | Restarts Chrome if process is dead. Triggered by Task Scheduler `HN-Aggregator-Watchdog` every 5 min + at logon |
| `C:\Users\HN Hotels\Documents\hn-aggregator-watchdog.log` | Watchdog event log — read this to confirm relaunches happened |

## What can Claude Code do with this PC

**Anything you'd do with a local Bash shell**, but routed through SSH. Concretely:

### Diagnose / observe
- Check Chrome is alive: `ssh "HN Hotels@hn-winpc" 'tasklist /FI "IMAGENAME eq chrome.exe"'`
- Check Tailscale is up: `ssh "HN Hotels@hn-winpc" '"C:\Program Files\Tailscale\tailscale.exe" status'`
- Read watchdog log: `ssh "HN Hotels@hn-winpc" 'type "C:\Users\HN Hotels\Documents\hn-aggregator-watchdog.log"'`
- Read Chrome console errors: not directly (Chrome logs to its own debug log; can be enabled via `--enable-logging --v=1` flag in the startup bat)
- Check uptime: `ssh "HN Hotels@hn-winpc" 'systeminfo | findstr /B /C:"System Boot Time"'`

### Modify / deploy
- Push new extension version: `tar -cf - ext/aggregator/* | ssh "HN Hotels@hn-winpc" 'powershell -Command "cd \"C:\Users\HN Hotels\Documents\hn-aggregator-ext\"; tar -xf -"'` then restart Chrome
- Restart Chrome to load updated extension: `ssh "HN Hotels@hn-winpc" 'taskkill /IM chrome.exe /F; start "" "C:\Users\HN Hotels\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\hn-aggregator-chrome.bat"'`
- Update Tailscale: `ssh "HN Hotels@hn-winpc" '"C:\Program Files\Tailscale\tailscale.exe" update'`
- Edit watchdog logic: `scp` (or tar-pipe) the new bat over

### Run new automation
- Drop a new .bat / .ps1 into the Startup folder for any other auto-launching task
- Schedule a new task with `schtasks /Create` for any periodic job
- Run any installed Windows tool: PowerShell, Node (if installed), Python, gh CLI, etc.

### Limits — what doesn't work via SSH
- **Cannot launch GUI apps onto the user's logged-in desktop** through SSH. Chrome started via SSH won't appear on screen — it has to come from the user's session (Startup folder, scheduled task with logon trigger, or manual click).
- **Interactive password prompts** for sudo-like elevation don't work through this SSH (the OpenSSH session is non-interactive for UAC).
- **Per-user Chrome profile data** is locked while Chrome is running — close Chrome before editing its profile JSON.

## If something breaks

Most failure modes have a short diagnosis pattern:

| Symptom | Likely cause | Diagnose with |
|---|---|---|
| `ssh hn-winpc` hangs | PC is offline / on different network | `ping hn-winpc` or check Tailscale admin console |
| SSH "permission denied" | Pubkey not authorized OR ACL wrong on `administrators_authorized_keys` | `ssh "HN Hotels@hn-winpc" 'icacls "C:\ProgramData\ssh\administrators_authorized_keys"'` should show only Administrators + SYSTEM |
| Aggregator dashboard goes stale | Chrome dead OR portal session expired OR network down | Check `hnhotels.in/api/aggregator-pulse?action=health`, then SSH and `tasklist`, then check watchdog log |
| Chrome won't auto-restart | Watchdog task not firing | `ssh "HN Hotels@hn-winpc" 'schtasks /Query /TN HN-Aggregator-Watchdog /V'` |
| PC rebooted, nothing started | Auto-login disabled, so user never logged in, so Startup folder didn't fire | Need user to enable autologin via `netplwiz` |

## hn-winpc is shared — multi-tenant rules apply

Multiple Claude Code chats may operate on this PC concurrently (currently 3: this aggregator chat, the modash-driver marketing chat, and the dine-aggregator audit chat). Read **`fleet/MULTI-TENANT-WINPC.md`** before doing anything destructive. The short version:

- Coordination root: `C:\hn-control\` (no spaces, shared directory)
- Read `C:\hn-control\manifest.json` first — lists every running automation and its `do_not_disturb` boundaries.
- **NEVER** run `taskkill /IM chrome.exe` or `Get-Process chrome | Stop-Process` — that kills the aggregator running in Chrome's default profile.
- For visiting URLs, just `chrome.exe URL` opens new tab in existing Chrome (safe). For full isolation, use `--user-data-dir="C:\hn-control\<your-purpose>\chrome-profile"`.
- For navigating the Zomato/Swiggy Online Ordering partner tabs, hold `chrome-tabs.lock` (acquire via `C:\hn-control\_shared\acquire-lock.ps1`) — aggregator auto-cycles them every 3 min otherwise.
- Namespace everything you create: `C:\hn-control\<purpose>\` files, `HN-<Purpose>-<Job>` task names.

## The starter prompt for new Claude sessions

When you open a fresh Claude Code session in this repo and want it to operate `hn-winpc`, paste this:

> hn-winpc is a SHARED Windows appliance reachable from this laptop via Tailscale + SSH. SSH command: `ssh "HN Hotels@hn-winpc" '<cmd>'` (quoted username — has a space). Default remote shell is cmd.exe; wrap PowerShell explicitly.
>
> Multiple Claude chats run automations on this PC concurrently (as of 2026-05-10: aggregator-pulse, modash-driver, dine-aggregator). Coordination root: `C:\hn-control\`. **Before doing anything destructive** (process kills, file deletes, scheduled task changes, registry changes), READ the manifest first:
>
> ```
> ssh "HN Hotels@hn-winpc" 'type "C:\hn-control\manifest.json"'
> ```
>
> You MUST respect every automation's `do_not_disturb` list. NEVER run `taskkill /IM chrome.exe` — that would kill the aggregator running in the default Chrome profile.
>
> If you need a browser:
> - For visiting URLs: `chrome.exe URL` opens a new tab in existing Chrome (safe, doesn't disturb others).
> - For full isolation: launch with `--user-data-dir=C:\hn-control\<your-purpose>\chrome-profile` — that's your isolated Chrome, kill it freely.
>
> If you need to navigate the Zomato/Swiggy Online Ordering partner tabs, hold `chrome-tabs.lock`: `& "C:\hn-control\_shared\acquire-lock.ps1" -Resource chrome-tabs -TimeoutSec 60 -OwnerChat <your-chat-id>` — aggregator auto-cycles them every 3 min otherwise.
>
> Namespace your work: files → `C:\hn-control\<your-purpose>\`, tasks → `HN-<YourPurpose>-<Job>`. Read `fleet/MULTI-TENANT-WINPC.md` for full rules + `fleet/HOWTO-USE-WINPC.md` for the bridge details. The aggregator extension source is at `ext/aggregator/`.
>
> When starting a new persistent automation, append a block to the manifest. When decommissioning, remove it.
