# Multi-tenant `hn-winpc` — runbook for any chat operating on the appliance

`hn-winpc` is shared. Multiple Claude Code chats may be acting on it concurrently. To prevent one chat's destructive command from killing another's automation, follow the conventions below.

This file is the **first thing any new chat must read** before doing anything on the PC. The starter prompt at the bottom of `fleet/HOWTO-USE-WINPC.md` enforces this.

## The five rules

### 1. Read the manifest before doing anything risky

Single source of truth: `C:\Users\HN Hotels\Documents\hn-fleet\manifest.json`. Lists every running automation on the PC, what it owns, and what NOT to disturb.

```bash
ssh "HN Hotels@hn-winpc" 'type "C:\Users\HN Hotels\Documents\hn-fleet\manifest.json"'
```

If your action would touch any resource in another automation's `owns` block or its `do_not_disturb` list — STOP. Use a different resource instead.

### 2. Never broadly kill `chrome.exe`

```powershell
# DO NOT — this murders every chat's Chrome including the aggregator
Get-Process chrome | Stop-Process -Force
taskkill /IM chrome.exe /F
```

The aggregator (Swiggy/Zomato data scraper) runs in Chrome's default profile. Killing all `chrome.exe` processes silently breaks the aggregator pipeline until the watchdog catches it. **The watchdog will then fight you** — it relaunches every 5 min.

If you need a browser, launch with a separate user-data-dir:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="C:\Users\HN Hotels\Documents\chrome-profiles\<your-purpose>" `
  --new-window `
  "https://your-target-url"
```

That instance has its own profile, extensions, logins. Killing it kills only your instance, not anyone else's.

To target ONLY your Chrome instance for shutdown:

```powershell
# Kills only Chrome processes whose command-line includes your user-data-dir path
Get-WmiObject Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*chrome-profiles\<your-purpose>*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### 3. Namespace everything you create

| Resource | Required prefix / location |
|---|---|
| Files | `C:\Users\HN Hotels\Documents\hn-<purpose>\` (one folder per automation) |
| Scheduled tasks | Task name: `HN-<Purpose>-<Job>` (e.g. `HN-Aggregator-Watchdog`, `HN-MenuAudit-Daily`) |
| Logs | `C:\Users\HN Hotels\Documents\hn-<purpose>\logs\` |
| Chrome user-data-dir | `C:\Users\HN Hotels\Documents\chrome-profiles\<purpose>\` |
| Lock files (if needed) | `C:\Users\HN Hotels\Documents\hn-locks\<resource>.lock` |
| Startup-folder bats | `hn-<purpose>-<action>.bat` (eg. `hn-aggregator-chrome.bat`) |

If you reuse another chat's path or task name you'll overwrite their setup.

### 4. Register your automation in the manifest

Before launching anything that's meant to keep running, add a block to `manifest.json`:

```json
{
  "automations": {
    "<your-purpose>": {
      "purpose": "1-line description of what this automation does",
      "owner_chat_session": "<your-chat-branch-or-id>",
      "started_at": "<ISO-8601 timestamp>",
      "owns": {
        "files": ["hn-<purpose>/", "..."],
        "tasks": ["HN-<Purpose>-..."],
        "chrome_user_data_dir": "<purpose-or-none>",
        "chrome_tabs": ["..."]
      },
      "do_not_disturb": ["1-line description of what others must not touch"],
      "health_check": "URL or command to verify it's running"
    }
  }
}
```

When you stop / decommission an automation, remove its block.

### 5. Use SSH connection multiplexing (already configured)

The laptop's `~/.ssh/config` has `ControlMaster auto` for `hn-winpc`. This means subsequent SSH calls reuse a single TCP connection rather than opening a new one each time — fast for multiple chats hammering the PC simultaneously.

Side effect: the first SSH per 30 min takes ~1s, subsequent ones take ~50ms. Keeps the PC responsive even with 3+ active chats.

## Currently registered automations (as of 2026-05-10)

See `manifest.json` for the live state. As of writing:

- **`aggregator-pulse`** — Swiggy + Zomato partner-portal data scraping. Runs in Chrome default profile. **Most fragile** — pipeline silence costs business visibility.

## Operational gotchas across multi-chat use

- **Manifest writes need a soft-lock** — if two chats append simultaneously, last write wins. To prevent corruption, read manifest, modify, write atomically (either via PowerShell `Copy-Item` to temp + rename, or a simple lock file convention). Future Phase 4 might formalize this.
- **Watchdogs can fight your work** — if you stop a process owned by another automation, that automation's watchdog will relaunch it. Don't fight watchdogs; respect ownership.
- **Default Chrome restoration policy** (`HKLM\Software\Policies\Google\Chrome\RestoreOnStartup=1`) only affects the default profile. Custom user-data-dirs aren't covered. If your isolated Chrome needs tab restoration, configure within that profile or use `--restore-last-session` in your launch bat.

## Starter prompt for any new Claude Code chat operating on hn-winpc

Paste this at the start of any new session that will touch the PC:

```
hn-winpc is a SHARED Windows appliance — multiple Claude chats run automations on
it concurrently. Before you do anything destructive (process kills, file deletes,
scheduled task changes, registry modifications), READ the manifest first:

  ssh "HN Hotels@hn-winpc" 'type "C:\Users\HN Hotels\Documents\hn-fleet\manifest.json"'

You MUST respect every automation's do_not_disturb list. NEVER run "taskkill /IM
chrome.exe" or "Get-Process chrome | Stop-Process" — that would kill the aggregator
which is running in Chrome's default profile.

If you need a browser, launch one with --user-data-dir set to a path under
C:\Users\HN Hotels\Documents\chrome-profiles\<your-purpose>\. That gives you an
isolated instance — kill it freely, edit profile freely, no interference.

Namespace EVERYTHING you create:
  - Files     → C:\Users\HN Hotels\Documents\hn-<your-purpose>\
  - Tasks     → name: HN-<YourPurpose>-<Job>
  - Logs      → hn-<your-purpose>/logs/
  - Locks     → hn-locks/<resource>.lock

Read fleet/MULTI-TENANT-WINPC.md for full rules. When you start a new persistent
automation, add a block to the manifest. When you decommission one, remove it.

This PC has SSH bridge from the laptop via Tailscale: ssh "HN Hotels@hn-winpc" '<cmd>'.
Default remote shell is cmd.exe — wrap PowerShell explicitly.
```
