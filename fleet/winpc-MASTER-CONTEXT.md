# `hn-winpc` Master Context — the coordinate model for the shared appliance

**Read this first if your session will touch hn-winpc. Everything that was previously prose in `MULTI-TENANT-WINPC.md` is now codified here as coordinates.**

| | |
|---|---|
| Appliance | `hn-winpc` · Tailscale `100.65.7.61` |
| SSH | `ssh "HN Hotels@hn-winpc" '<cmd>'` (quoted, space in username, cmd.exe default — wrap PowerShell explicitly) |
| Resource graph | [`fleet/winpc-resource-graph.json`](./winpc-resource-graph.json) — single source of truth |
| CLI | [`fleet/winpc.mjs`](./winpc.mjs) — node, no deps |
| Bootstrap | `source fleet/winpc.sh` at session start |
| Live manifest on PC | `C:\hn-control\manifest.json` (regenerated from graph by `winpc sync` — deferred V2) |
| Lock helpers on PC | `C:\hn-control\_shared\acquire-lock.ps1` / `release-lock.ps1` |
| Lock dir on PC | `C:\hn-control\.locks\` |

---

## The model in one paragraph

Every thing on hn-winpc that an automation might step on is a **resource**, with a canonical code `winpc.<kind>.<id>`. The set of resource kinds is finite and enumerated (see below). An **automation** is a named block (`aggregator-pulse`, `modash-driver`, `dine-aggregator`, `tv-control`, …) that declares which resources it owns. From that declaration, every other automation's "do not disturb" list is derived automatically — there are no English DND prose blocks any more. Cross-chat coordination uses **locks** (also resources, in the `lock` kind) wrapped by `winpc lock --resource X -- <cmd>`. Onboarding chat N+1 is identical to chat N: `winpc claim …`.

---

## Resource kinds (closed set — never extend without doctrine change)

```
chrome_profile                       — Chromium user-data-dir (cookies, extensions, tabs)
chrome_tab_pattern                   — URL glob held open in some Chrome instance
filesystem_path                      — Absolute path on disk
scheduled_task                       — Windows Task Scheduler entry (must be named HN-<Purpose>-<Job>)
registry_key                         — HKLM/HKCU value
process_pattern                      — long-running process matched by cmdline regex
network_port                         — TCP port bound on winpc
lock                                 — coordination resource in .locks\
chromium_extension_content_script    — URL pattern owned inside the shared extension
```

Each resource has at minimum: `kind`, `id`, `owner` (automation name or null), `criticality` (high/medium/low), `lock_to_write` (the lock-resource needed to mutate, or null), and `notes`.

---

## The constraint set (the validator's brain)

| # | Constraint | Enforced by |
|---|---|---|
| 1 | Two automations may not list the same resource code in `owns`. | `winpc claim` / `winpc regularize` |
| 2 | Verb ∈ {write,delete,kill,register} on a resource you don't own requires holding the resource's `lock_to_write`. | `winpc lock --resource X -- <cmd>` |
| 3 | Each automation's effective DND = union of every other automation's `owns`. **No explicit DND lists are stored.** | derived |
| 4 | An automation's owned `filesystem_path` resources must live under `C:\hn-control\<automation_name>\` — exceptions are tracked in the graph's `exemptions` block. | `winpc claim` warns on path violation |
| 5 | Graph mutations require the `manifest-write` lock during the read-modify-write cycle. | every mutating verb |
| 6 | Two automations may navigate overlapping `chrome_tab_pattern` globs only if both hold `chrome-tabs.lock` or the globs are disjoint. | `winpc lock --resource chrome-tabs -- <cmd>` |

Anything outside this set is convention, not constraint — keep the set small.

---

## The 7 verbs

```
# Read-only
winpc audit                          # diff repo graph vs live winpc, flag orphans
winpc doctor                         # per-automation health probe

# Graph mutations (each takes manifest-write.lock, atomic .tmp+rename)
winpc claim        --automation NAME --purpose "..." --owner-chat CHAT
                   --owns winpc.<kind>.<id> [--owns ...] [--criticality high|medium|low]
winpc regularize   --automation NAME --resource winpc.<kind>.<id>
                   --kind <kind> --id <id> [--criticality ...]
winpc inherit      --automation NAME --new-owner-chat CHAT
winpc decommission --automation NAME [--purge-resources]

# Cross-chat coordination on the appliance
winpc lock         --resource <lock-name> [--owner-chat CHAT] -- <command...>
```

---

## Onboarding the (N+1)-th chat

Whether the appliance is hosting 3 chats or 15, the steps are the same:

```bash
cd /path/to/HN-Hotels-Site
source fleet/winpc.sh
export WINPC_CHAT_ID="my-chat-name"

# 1. See what's already running.
winpc audit
winpc doctor

# 2. Define what your automation will own on winpc, then claim it.
#    If your automation will own files, put them under C:\hn-control\<your-name>\
#    Schedule tasks must be named HN-<YourName>-<Job>.
winpc claim \
  --automation my-new-thing \
  --purpose "what it does" \
  --owner-chat $WINPC_CHAT_ID \
  --owns winpc.filesystem_path.C:\\hn-control\\my-new-thing \
  --owns winpc.scheduled_task.HN-MyNewThing-Poller \
  --criticality medium

# 3. Any time you mutate a resource you don't own, wrap with lock:
winpc lock --resource chrome-default -- \
  scp ./patched.js "HN Hotels@hn-winpc:C:\Users\HN Hotels\Documents\hn-aggregator-ext\"

# 4. When your work is done and the automation is no longer running, decommission.
winpc decommission --automation my-new-thing --purge-resources
```

That is the **horizontally-infinite onboarding flow**. There is no per-chat bespoke doctrine; the constraint set takes care of conflicts.

---

## Drift handling — three discrepancies the audit caught on 2026-05-11

These are the kinds of issues the master-context wedge is designed to surface and resolve cleanly.

### A) Unregistered live resource → `regularize`

`C:\hn-control\platform-tools\` (adb + fastboot) was on disk but no automation owned it. Resolved by introducing a `tv-control` automation block and calling:

```bash
winpc regularize --automation tv-control \
  --resource winpc.filesystem_path.platform-tools \
  --kind filesystem_path --id "C:\\hn-control\\platform-tools" --criticality medium
```

### B) Stale `owner_chat_session` → `inherit`

`dine-aggregator` was registered to chat `bold-mccarthy-572b58` which had ended. Future maintenance picks it up via:

```bash
winpc inherit --automation dine-aggregator --new-owner-chat <new-chat-id>
```

### C) Orphan scripts → `winpc audit` flags for owner decision

`C:\hn-control\step2_migrate.ps1` + `C:\hn-control\verify-deploy.ps1` belong to no automation. The graph carries them under `orphans` with `suspected_origin` + `owner_decision_required: true`. Owner decides delete vs adopt; no automated cleanup of orphans (the appliance is a production box; a stray script is safer than a stray delete).

---

## Hard rules that survive the model (these are still true)

- **NEVER `taskkill /IM chrome.exe /F` or `Get-Process chrome | Stop-Process`.** Filter by user-data-dir cmdline. Constraint 2 covers this formally, but the rule is also load-bearing for human operators.
- **NEVER skip the lock when modifying a resource you don't own**, even if you "know it's safe right now". The lock is the only thing keeping the constraint validator honest.
- **Atomic manifest writes.** Read → modify → write to `.tmp` → rename. Every mutating verb in `winpc.mjs` already does this; if you write a helper that touches the graph file directly, do the same.
- **One automation per coordination scope.** If two pieces of code share a profile, an extension, or a scheduled-task family, they should claim under one automation block (e.g., `dine-aggregator`'s content scripts ride inside `aggregator-pulse`'s extension via disjoint URL patterns — that's two automations claiming disjoint `chromium_extension_content_script` resources, not one).
- **The graph is the source of truth.** When in doubt, run `winpc audit` and trust what it says over any markdown file.

---

## What this wedge does NOT do (deferred to V2)

- **Two-way sync to `C:\hn-control\manifest.json`** — repo graph is currently authoritative; the live manifest is informational. A `winpc sync` verb that pushes the graph onto the appliance will land later.
- **Server-side enforcement** — no Windows daemon validates incoming SSH commands. The CLI is honor-system; the constraint validator catches mistakes at claim/regularize time.
- **Auto-discovery** — `winpc audit` lists drift; it doesn't propose fixes. The human picks `regularize` vs delete.
- **Web dashboard** — `winpc doctor` is text-only. Not enough chats to justify a UI yet.

---

## What previously lived in `MULTI-TENANT-WINPC.md`

The old runbook (200 lines of prose, English DND lists, hand-authored markdown tables of automations) is now superseded by this file + the resource graph. The old runbook stays in the tree for one release as a redirect, then gets deleted in a follow-up.

If you find yourself reaching for it, ask first: "is the answer I want already in `fleet/winpc-resource-graph.json` or computable by `winpc audit`?" Almost always: yes.
