# Adding a new automation to `hn-winpc` — copy-paste template

Use this when starting a 4th, 5th, ... automation that runs on the appliance. The
template enforces isolation so the existing 3 automations (and the next 10) keep
working uninterrupted.

**Read [`MULTI-TENANT-WINPC.md`](MULTI-TENANT-WINPC.md) first.** This template
operationalises that runbook.

---

## Pre-flight (do once per new automation)

Pick a name. The naming convention is one short kebab-case word that becomes the
directory name + Scheduled Task prefix + manifest key. Examples already in use:
`aggregator-pulse`, `modash-driver`, `dine-aggregator`.

For the rest of this template, replace `<purpose>` with your name (e.g.
`gbp-photo-sync`).

## Step 1 — Verify the bridge is alive (you, on laptop)

```bash
# Expect: SSH OK + IP printed
ssh "HN Hotels@hn-winpc" 'echo SSH_OK; powershell -Command "[Net.Dns]::GetHostName()"'

# If "Can't assign requested address": Tailscale flapped on laptop. Reconnect Tailscale,
# then add -o BindAddress=$(ifconfig | grep "inet 100\." | awk '{print $2}' | head -1)
# to the SSH command.
```

If SSH fails:
- Check Tailscale up on laptop (menu bar icon, click Connect)
- Check no other VPN (Mullvad, NordVPN, etc.) is competing for routes
- Verify no firewall is blocking outbound 22 to `100.65.7.61`

**Tailscale on the PC itself** is configured `set unattended` and should never need
re-setup. If `tailscale status` on `hn-winpc` shows offline, that's a fleet-wide
event — escalate, don't try to bring it up via SSH.

## Step 2 — Read the manifest, claim a unique name

```bash
# Read current state
ssh "HN Hotels@hn-winpc" 'type "C:\hn-control\manifest.json"' | python3 -m json.tool

# Confirm <purpose> is NOT already a key under "automations".
# If it is, pick a different name — names are unique per active automation.
```

## Step 3 — Create your working directory + isolated Chrome profile (if needed)

```bash
ssh "HN Hotels@hn-winpc" 'powershell -Command "New-Item -ItemType Directory -Path C:\hn-control\<purpose>\ -Force | Out-Null; New-Item -ItemType Directory -Path C:\hn-control\<purpose>\logs\ -Force | Out-Null"'

# If your automation needs a separate Chrome profile (likely yes, see Step 4):
ssh "HN Hotels@hn-winpc" 'powershell -Command "New-Item -ItemType Directory -Path C:\hn-control\<purpose>\chrome-profile\ -Force | Out-Null"'
```

## Step 4 — Decide your Chrome strategy

**Three options, pick exactly one:**

### A. No Chrome (server-side only — Node, Python, .NET service)
Skip to step 5.

### B. Existing default Chrome, NEW tab only (cheap, shares logins)
Use only if your automation:
- Just needs to open a URL in the existing Chrome
- Doesn't need a different login session
- Won't navigate the existing tabs (Online Ordering / partner portals)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" "https://your-target-url"
# Opens new tab in existing default-profile Chrome. No isolation.
```

⚠ **If you hit a `/onlineordering/...` URL or any page the aggregator's content
scripts inject into, you'll trigger the scrape pipeline. Use option C instead.**

### C. Isolated Chrome instance with its own user-data-dir (recommended)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="C:\hn-control\<purpose>\chrome-profile" `
  --no-first-run `
  --no-default-browser-check `
  --new-window `
  "https://your-target-url"
```

Each `--user-data-dir` is a totally isolated Chrome session. Different cookies,
different extensions, different login state, different process tree. Killing it
kills only this instance. The aggregator's default-profile Chrome stays untouched.

**Login flow** for human-typed credentials (same pattern modash-driver uses):
1. Schedule a one-shot Scheduled Task that runs `chrome.exe --user-data-dir=...`
   with `LogonType=Interactive` so the GUI lands on the desktop session
2. Owner RDPs in, types password, closes Chrome — cookies persist
3. Programmatic automation later launches headless Chrome against the same
   user-data-dir; cookies still valid for ~30 days

**Why one-shot Scheduled Task instead of `Start-Process` over SSH:** SSH-spawned
processes don't render GUI on the user's logged-in desktop. Scheduled Task with
Interactive principal does.

## Step 5 — Decide if you need any contended-resource locks

If your work touches any of these resources, acquire the corresponding lock:

| Resource | Held by … | Acquire if you're … |
|---|---|---|
| `chrome-default.lock` | aggregator-pulse during extension reload | modifying default-Chrome extensions/settings |
| `chrome-tabs.lock` | (currently advisory only — patch pending) | navigating partner Online Ordering tabs |

Pattern:
```powershell
& "C:\hn-control\_shared\acquire-lock.ps1" -Resource "<resource>" -TimeoutSec 60 -OwnerChat "<your-chat-id>"
if ($LASTEXITCODE -ne 0) { Write-Error "Lock unavailable"; exit 1 }
try {
  # ... your contended work ...
} finally {
  & "C:\hn-control\_shared\release-lock.ps1" -Resource "<resource>" -OwnerChat "<your-chat-id>"
}
```

## Step 6 — Register your automation in the manifest

```bash
# 1. Pull current manifest
ssh "HN Hotels@hn-winpc" 'type "C:\hn-control\manifest.json"' > /tmp/manifest.json

# 2. Edit /tmp/manifest.json — add your block under "automations":
```

```jsonc
{
  "automations": {
    // ... existing automations ...
    "<purpose>": {
      "purpose": "Plain-English what + why",
      "criticality": "low | medium | high",
      "owner_chat_session": "<your-claude-chat-id>",
      "started_at": "2026-MM-DDThh:mmZ",
      "owns": {
        "files": [
          "C:\\hn-control\\<purpose>\\"
        ],
        "tasks": ["HN-<Purpose>-<Job>"],
        "chrome_user_data_dir": "C:\\hn-control\\<purpose>\\chrome-profile",
        "chrome_tabs": [],
        "registry": []
      },
      "do_not_disturb": [
        "C:\\hn-control\\<purpose>\\ working dir",
        "<your scheduled task name>",
        "<your Chrome user-data-dir>",
        "node.exe / chrome.exe processes whose cmdline contains C:\\hn-control\\<purpose>\\"
      ],
      "health_check": "https://hnhotels.in/api/<your-endpoint>?action=health",
      "fix_when_broken": "..."
    }
  }
}
```

```bash
# 3. Push the updated manifest atomically (write to temp, then rename)
cat /tmp/manifest.json | ssh "HN Hotels@hn-winpc" 'powershell -Command "$in=[Console]::In.ReadToEnd(); Set-Content -Path C:\hn-control\manifest.json.tmp -Value $in -NoNewline -Encoding UTF8; Move-Item -Force C:\hn-control\manifest.json.tmp C:\hn-control\manifest.json; Write-Output MANIFEST_UPDATED"'
```

## Step 7 — Schedule (if your automation runs persistently)

Three ways your code can run on hn-winpc:

| Trigger | Use when | Mechanism |
|---|---|---|
| At user logon | Owner-driven, runs while user is signed in | `New-ScheduledTask -Trigger (New-ScheduledTaskTrigger -AtLogOn)` |
| On schedule (cron-like) | Periodic poll/sync | `-Trigger (New-ScheduledTaskTrigger -Once -At ... -RepetitionInterval ...)` |
| One-shot in 5 sec | Owner-triggered (e.g. open Chrome window) | `-Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5))` |

Naming convention: **`HN-<Purpose>-<Job>`** (e.g. `HN-Modash-Poller`,
`HN-Aggregator-Watchdog`, `HN-Dine-DailyAudit`). Always prefix `HN-` so cleanup
scripts can find/spare them.

Reference: see `C:\hn-control\modash-driver\install.ps1` for a complete pattern
that registers a logon-triggered restart-on-failure task.

## Step 8 — Smoke test, then leave it running

1. Manually trigger your task once: `schtasks /Run /TN HN-<Purpose>-<Job>`
2. Verify expected log output, API health endpoint, etc.
3. Confirm aggregator-pulse + modash-driver + dine-aggregator are still healthy
   (open `manifest.json`, look at each — none should be broken by your work)
4. Tail your log for at least one full polling cycle
5. Done — automation is live

## Step 9 — When decommissioning (the inverse)

1. Disable + delete your Scheduled Tasks: `schtasks /Delete /TN HN-<Purpose>-<Job> /F`
2. Stop running processes: `Stop-Process -Id <pid>` (only your processes —
   identify by cmdline match)
3. Remove your block from `manifest.json` (atomic write)
4. Delete `C:\hn-control\<purpose>\` if you want
5. Mention the decommission in the chat that owned the automation

## Common antipatterns (don't do these)

| Antipattern | Why it's bad | Do instead |
|---|---|---|
| `Get-Process chrome \| Stop-Process` | Kills aggregator-pulse + modash-driver + dine-aggregator | Filter by cmdline, kill only your own |
| `taskkill /IM chrome.exe /F` | Same | Same |
| Your task name doesn't start with `HN-` | Human can't identify owner during ops triage | Always `HN-<Purpose>-<Job>` |
| Files in `C:\Users\HN Hotels\Desktop\` or `C:\temp\` | Pollutes user's space, no manifest record | `C:\hn-control\<purpose>\` |
| Hard-coded `--user-data-dir=C:\Modash\profiles` (or any non-`hn-control` path) | Out of convention, sandbox missing | `C:\hn-control\<purpose>\chrome-profile\` |
| Direct `manifest.json` write without temp+rename | Race conditions corrupt the file | Atomic write helper (see Step 6) |
| Force-stopping without releasing locks | Stale locks block other chats up to TTL | Always `release-lock.ps1` in `finally` |

## Quick reference card

```
Coordination root:   C:\hn-control\
Manifest:            C:\hn-control\manifest.json
Lock dir:            C:\hn-control\.locks\
Shared helpers:      C:\hn-control\_shared\acquire-lock.ps1, release-lock.ps1

Per-automation dir:  C:\hn-control\<purpose>\
Per-automation log:  C:\hn-control\<purpose>\logs\
Per-automation Chrome:C:\hn-control\<purpose>\chrome-profile\

Task names start with: HN-

SSH command pattern: ssh "HN Hotels@hn-winpc" 'cmd'   (quoted, space in username)
```
