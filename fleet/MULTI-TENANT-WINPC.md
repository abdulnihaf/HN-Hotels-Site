# Multi-tenant `hn-winpc` — runbook for any chat operating on the appliance

`hn-winpc` is shared. **As of 2026-05-10, three Claude Code chats are concurrently operating it:**

1. **`aggregator-pulse`** (chat: `frosty-heisenberg-e1616d`) — Swiggy + Zomato Online Ordering data scraping. Powers `/ops/aggregator/he/swiggy` + `/he/zomato`. **Most fragile** — runs in Chrome's default profile, must not be killed.
2. **`modash-driver`** (chat: `vibrant-wozniak-b62a56`) — influencer marketing analysis (Modash-driven outreach). Already on disk: `setup-modash-profile.ps1`, `install.ps1`, `acquire-lock.ps1`, `release-lock.ps1`.
3. **`dine-aggregator`** (chat: `bold-mccarthy-572b58`) — Zomato Partner DINING-OUT (Book a Table) audit. **Will navigate same Chrome tabs** — see the cross-chat risks section below.

To prevent one chat's destructive command from killing another's automation, the three rings of isolation below are mandatory. **First thing any new chat must read** before doing anything on the PC.

## Coordination root: `C:\hn-control\`

This directory is the shared coordination plane. Established by `modash-driver` chat first; aggregator and dine adopt it. Layout:

```
C:\hn-control\                        ← shared root, no spaces in path
  manifest.json                       ← single source of truth on running automations
  .locks\                             ← lock files (one per resource being coordinated)
    chrome-default.lock               ← held while modifying default Chrome profile
    chrome-tabs.lock                  ← held while navigating the Online Ordering tabs
    <resource>.lock                   ← any other coordinated resource
  _shared\                            ← cross-automation helper scripts
    acquire-lock.ps1                  ← obtain lock with timeout (modash-driver wrote)
    release-lock.ps1                  ← release held lock
  aggregator-pulse\                   ← (DOCUMENTED here; actual files live elsewhere)
  modash-driver\                      ← per-automation working dir (modash-driver chat)
  dine-aggregator\                    ← per-automation working dir (dine chat)
```

The aggregator's actual files are at `C:\Users\HN Hotels\Documents\hn-aggregator-ext\` (already deployed, not moving). The manifest tracks them.

## The five rules

### 1. Read the manifest before doing anything risky

```bash
ssh "HN Hotels@hn-winpc" 'type "C:\hn-control\manifest.json"'
```

If your action would touch any resource in another automation's `owns` block or its `do_not_disturb` list — STOP. Use a different resource instead, or coordinate via lock.

### 2. Never broadly kill `chrome.exe`

The aggregator runs in Chrome's default profile. Its tabs (`partner.swiggy.com/food/`, `www.zomato.com/partners/onlineordering/...`) must stay open with merchant session live.

```powershell
# DO NOT — kills every chat's Chrome including the aggregator
Get-Process chrome | Stop-Process -Force
taskkill /IM chrome.exe /F
```

If you need a browser for your work, two options:

**Option A — same default Chrome, new tab (cheap, but read rule 4 about tabs)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" "https://your-target-url"
```
This sends the URL to the running Chrome → opens in new tab. Same profile, same logins. Safe as long as you don't close the aggregator's tabs.

**Option B — isolated Chrome instance (full isolation)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="C:\hn-control\<your-purpose>\chrome-profile" `
  --new-window `
  "https://your-target-url"
```
Spawns its own profile + extensions + logins. Killing it kills only this instance. Use when you need different login state, different extensions, or when your work might leave Chrome in a weird state.

To target ONLY your isolated Chrome for shutdown:
```powershell
Get-WmiObject Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*<your-purpose>\chrome-profile*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### 3. Namespace everything you create

| Resource | Required prefix / location |
|---|---|
| Working files | `C:\hn-control\<purpose>\` (one folder per automation) |
| Scheduled tasks | Task name: `HN-<Purpose>-<Job>` (e.g. `HN-Aggregator-Watchdog`, `HN-Modash-Daily`) |
| Logs | `C:\hn-control\<purpose>\logs\` |
| Chrome user-data-dir (if isolated) | `C:\hn-control\<purpose>\chrome-profile\` |
| Lock files | `C:\hn-control\.locks\<resource>.lock` |
| Startup-folder bats | `hn-<purpose>-<action>.bat` (eg. `hn-aggregator-chrome.bat`) |

Aggregator's pre-existing files at `C:\Users\HN Hotels\Documents\hn-aggregator-ext\` and Startup folder bats are exempt from the move — they're already in production. Don't relocate running code.

### 4. Use locks for the truly contended resources

Two known contended resources right now:

- **`chrome-default.lock`** — hold this if you're modifying default-profile Chrome (extensions, settings, user data). Aggregator is the steady-state owner, but if it needs to update the extension, it acquires this lock briefly.
- **`chrome-tabs.lock`** — hold this if you're going to navigate the Online Ordering partner tabs (`partner.swiggy.com/food/...`, `www.zomato.com/partners/onlineordering/...`). The aggregator's content scripts auto-cycle these tabs every 3 min — if you navigate them and don't hold the lock, your nav gets overwritten.

Use `acquire-lock.ps1` / `release-lock.ps1` from `_shared\` (modash-driver wrote these). Pattern:

```powershell
& "C:\hn-control\_shared\acquire-lock.ps1" -Resource "chrome-tabs" -TimeoutSec 60 -OwnerChat "<your-chat-id>"
try {
  # ... your contended work ...
} finally {
  & "C:\hn-control\_shared\release-lock.ps1" -Resource "chrome-tabs"
}
```

If the lock is held by another chat, your script waits up to TimeoutSec then aborts. Stale locks (older than 10 min) are ignored.

### 5. Register your automation in the manifest

Before launching anything that's meant to keep running, add a block to `manifest.json`. When you decommission, remove the block.

## Currently registered automations (live state in `manifest.json` on PC)

### `aggregator-pulse` (this chat — frosty-heisenberg-e1616d)

| Aspect | Detail |
|---|---|
| Purpose | Swiggy + Zomato Online Ordering data scraping; powers `/ops/aggregator/he/swiggy` + `/he/zomato` |
| Files | `C:\Users\HN Hotels\Documents\hn-aggregator-ext\`, watchdog ps1 + log, Startup `hn-aggregator-chrome.bat` |
| Tasks | `HN-Aggregator-Watchdog` (scheduled every 5 min) |
| Chrome | default profile, tabs: `partner.swiggy.com/food/`, `www.zomato.com/partners/onlineordering/reporting?selected_view=view_live_tracking` |
| Do not disturb | `chrome.exe` in default profile, the watchdog task, the partner-portal tabs (unless you hold `chrome-tabs.lock`) |

### `modash-driver` (chat — vibrant-wozniak-b62a56) — VERIFIED LIVE 2026-05-10

| Aspect | Detail |
|---|---|
| Purpose | Autonomous Modash influencer discovery. Polls `hnhotels.in/api/influencer-pipeline` every 60s; when a job is queued, launches headless Chrome with one of the pre-logged Modash profiles, scrapes search results, posts back. |
| Files | `C:\hn-control\modash-driver\` — `poller.js`, `package.json`, `node_modules\`, `setup-modash-profile.ps1`, `install.ps1`, `run-poller.bat`, `poller.log`, `manifest-entry.json`, `HOWTO.md` |
| Profiles | `C:\hn-control\modash-driver\profiles\profile-1\` (account: `contact@hamzahotel.com`) · `profile-2\` (`nihaf@hamzahotel.com`) — each is an isolated Chrome user-data-dir holding cookies. Owner-set, persist ~30d. |
| Tasks | `HN-Modash-Poller` (logon trigger, 5-min restart-on-failure, runs `run-poller.bat`) |
| Chrome | **System Chrome** (`C:\Program Files\Google\Chrome\Application\chrome.exe`) launched by Playwright `chromium.launchPersistentContext` against the per-profile user-data-dir. Headless when polling; visible only during owner-driven `setup-modash-profile.ps1` runs. |
| Cookies / state | `C:\hn-control\modash-driver\profiles\profile-N\Default\Network\Cookies` (32 KB once logged in). DO NOT touch — corrupting forces re-login of that profile. |
| Env vars | `CRON_TOKEN` (=Pages env `MODASH_CRON_TOKEN`, value embedded in `run-poller.bat`), `MODASH_API_BASE`, `MODASH_PROFILES_DIR`, `MODASH_USE_SYSTEM_CHROME=1`, `MODASH_HEADLESS` |
| Do not disturb | The 2 profile dirs (cookies = login state) · `HN-Modash-Poller` Scheduled Task · `node.exe` processes whose cmdline contains `C:\hn-control\modash-driver\poller.js` · the `run-poller.bat` (it has the cron token embedded). Chrome processes whose cmdline matches `*modash-driver\profiles\profile-*` are mine — kill only those if you must, never broadly. |
| Cross-chat risk | **None active.** Modash uses isolated user-data-dirs (different from default Chrome where aggregator runs, different from `dine-profile`), launches a separate Chrome process tree. As long as nobody runs `taskkill /IM chrome.exe /F`, no contention. |

### `dine-aggregator` (chat — bold-mccarthy-572b58)

| Aspect | Detail |
|---|---|
| Purpose | Zomato Partner DINING-OUT (Book a Table) audit — different surface from Online Ordering |
| Files | `C:\hn-control\dine-aggregator\` (TBD) |
| Tasks | none (one-time audit, not 24/7) |
| Chrome | wants to navigate `www.zomato.com/partners/...` tabs to switch to **Dining Out** mode |
| Do not disturb | none owned yet |

**Cross-chat risk between `dine-aggregator` and `aggregator-pulse`:**

The aggregator-pulse content scripts (`content-zomato.js`) auto-cycle the Zomato Partner tab through `/onlineordering/...` URLs every 3 min via `cyclePage()` and `window.location.href = PAGES[nextIdx]`. **If `dine-aggregator` navigates that same tab to Dining Out mode, the aggregator's next cycle will navigate it back to Online Ordering, blowing away the dine-in work.**

Two safe options for `dine-aggregator`:

1. **Open a NEW tab in the same Chrome** for dine-in work (`chrome.exe "https://www.zomato.com/partners/...dineout..."` opens a new tab; the existing Online Ordering tabs in their separate tabs are untouched). The aggregator's content scripts only fire on `/onlineordering/...` pages so the new dine-in tab won't trigger them.
2. **Hold `chrome-tabs.lock`** for the duration of the audit. The aggregator's cycle code can be patched to check this lock before navigating; until that's done, option 1 is safer.

## Operational gotchas across multi-chat use

- **Manifest writes need atomic update** — read manifest → modify → write to `manifest.json.tmp` → rename. Never write directly. Two simultaneous writes corrupt the file.
- **Watchdogs can fight your work** — if you stop a process owned by another automation, that automation's watchdog will relaunch it. Don't fight watchdogs; respect ownership.
- **Default Chrome restoration policy** (`HKLM\Software\Policies\Google\Chrome\RestoreOnStartup=1`) only affects the default profile. Custom user-data-dirs aren't covered. If your isolated Chrome needs tab restoration, configure within that profile or use `--restore-last-session` in your launch bat.
- **SSH connection multiplexing** is configured in laptop's `~/.ssh/config` (`ControlMaster auto`, 30m persist). Multiple chats hammering hn-winpc reuse a single TCP connection. First SSH per 30 min ~1s, subsequent ~50ms.
- **Networking on the laptop side** — if Tailscale and another VPN (Mullvad, NordVPN, etc) are both active, expect routing chaos. Quit the conflicting VPN before doing SSH work.

## Starter prompt for any new Claude Code chat operating on hn-winpc

Paste this at the start of any new session that will touch the PC:

```
hn-winpc is a SHARED Windows appliance — multiple Claude chats run automations on
it concurrently. Coordination root: C:\hn-control\. Shared manifest:
C:\hn-control\manifest.json. Shared lock helpers: C:\hn-control\_shared\
acquire-lock.ps1 + release-lock.ps1.

Before doing anything destructive (process kills, file deletes, scheduled task
changes, registry modifications), READ the manifest first:

  ssh "HN Hotels@hn-winpc" 'type "C:\hn-control\manifest.json"'

You MUST respect every automation's do_not_disturb list. NEVER run "taskkill /IM
chrome.exe" or "Get-Process chrome | Stop-Process" — that would kill the aggregator
running in Chrome's default profile.

If you need a browser:
  - For visiting URLs in the existing Chrome: pass URL as arg, opens in new tab
  - For isolation: use --user-data-dir=C:\hn-control\<your-purpose>\chrome-profile

If you need to navigate the Zomato/Swiggy partner Online Ordering tabs, hold
chrome-tabs.lock (acquire-lock.ps1) — the aggregator auto-cycles them every 3 min
otherwise.

Namespace EVERYTHING you create:
  - Files     → C:\hn-control\<your-purpose>\
  - Tasks     → name: HN-<YourPurpose>-<Job>
  - Logs      → C:\hn-control\<your-purpose>\logs\
  - Locks     → C:\hn-control\.locks\<resource>.lock

When starting a new persistent automation, add a block to the manifest. When
decommissioning, remove it.

Read fleet/MULTI-TENANT-WINPC.md for full rules. SSH command pattern:
ssh "HN Hotels@hn-winpc" 'cmd' (quoted, space in username). Default remote shell
is cmd.exe — wrap PowerShell explicitly.
```
