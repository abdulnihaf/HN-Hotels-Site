# Marketing Shell — Architecture

**Status:** Design locked 2026-05-11. Build phases 0–5 outlined; Phase 0 in progress.
**Author:** Designed in conversation with Nihaf (MD, HN Hotels Pvt Ltd).
**Scope:** Marketing operations across Hamza Express (HE) + Nawabi Chai House (NCH). Six lanes (Influencer · Google · Aggregator-Delivery · Dine-Aggregator · TV · Meta Ads) + one orchestrator. **The pattern is reusable for ops, HR, finance, customer, strategy lanes later** — marketing is the prototype, not the destination.

---

## 1. The problem this architecture solves

Nihaf is the sole executor of a business that needs the throughput of a 6-person marketing team. Today his cognitive bandwidth is the ceiling on output: he can hold a few campaign strategies in his head simultaneously, switch context between them all day, remember where each was when he came back. The ceiling matters more than any single workflow because it limits how much of the business can run in parallel.

The marketing shell **externalizes the cognitive load**. Each lane holds the deep context for one domain so Nihaf's head stays free. He becomes the CEO who directs + approves; the lanes become faithful executors of his judgement.

---

## 2. The three-tier system

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   iPhone        │        │   MacBook       │        │  iPad (optional)│
│ (out + about,   │        │ (workday,       │        │   (TBD role)    │
│  laptop off)    │        │  laptop on)     │        │                 │
│  Claude Code +  │        │  Terminal +     │        │   Tailscale +   │
│  Tailscale      │        │  Tailscale      │        │   ???           │
└────────┬────────┘        └────────┬────────┘        └────────┬────────┘
         │                          │                          │
         │  SSH via Tailscale (100.65.7.61)                    │
         └──────────────┬───────────┴──────────────┬───────────┘
                        ▼                          ▼
              ┌────────────────────────────────────────────────────┐
              │   hn-winpc (always-on, 100.65.7.61, 8 GB RAM)      │
              │                                                    │
              │   Existing (per fleet/winpc-resource-graph.json):  │
              │    • aggregator-pulse · modash-driver              │
              │    • dine-aggregator · tv-control                  │
              │                                                    │
              │   NEW — Marketing Shell layer:                     │
              │    • WSL2 Ubuntu (POSIX dev environment)           │
              │    • Claude Code installed (npm global)            │
              │    • tmux with 7 named sessions:                   │
              │       - marketing-orchestrator                     │
              │       - lane-01-influencer                         │
              │       - lane-02-google                             │
              │       - lane-03-aggregator                         │
              │       - lane-04-dine                               │
              │       - lane-05-tv                                 │
              │       - lane-06-meta                               │
              │    • Lane state files at ~/hn-lanes/<id>/          │
              │    • Inbox/outbox per lane for async dispatch      │
              │    • Cross-lane shared state at ~/hn-lanes/_shared/│
              │    • Git auto-pull cron every 5 min                │
              └────────────────────────────────────────────────────┘
```

**Single source of truth: winpc.** Mac, iPhone, (and iPad if it joins) are equivalent CLIENTS. None hosts state. All three reach the same brain.

---

## 3. The six lanes

Each lane = one marketing workflow with deep institutional context. Each runs as a long-lived tmux session on winpc. Each operates on its own git branch and writes its own state file.

| Lane ID | Name | Domain | Branch namespace | Primary context source |
|---|---|---|---|---|
| `01-influencer` | Influencer Marketing | Barter outreach, Modash discovery, content cycle | `claude/influencer-*` | `~/hn-workflows/01-influencer.md` |
| `02-google` | Google Optimization | GBP organic + Google Ads | `claude/google-*` | `~/hn-workflows/02-google.md` |
| `03-aggregator` | Swiggy/Zomato Delivery | Listing optimization, restaurant-funded offers, ratings | `claude/aggregator-*` | `~/hn-workflows/03-aggregator-delivery.md` |
| `04-dine` | EazyDiner + Zomato Dine-in + Swiggy Dine-out | Dining audit + KAM activation | `claude/dine-*` | `~/hn-workflows/04-dine-aggregator.md` |
| `05-tv` | TV Control | 6 in-store displays, PiSignage, creative rotation | `claude/tv-*` | `~/hn-workflows/05-tv-control.md` |
| `06-meta` | Meta Ads | CTWA campaigns, leads CRM, token rotation | `claude/meta-*` | `~/hn-workflows/06-meta-ads.md` |

The **orchestrator** sits above these. It holds the cross-lane picture, audits status, dispatches directives, but executes no domain action itself.

---

## 4. State management

### Per-lane state

Every lane writes a `state.json` on winpc at `~/hn-lanes/<lane-id>/state.json`. Schema is canonical (see [state.schema.json](state.schema.json)). At minimum:

- `lane_id`, `lane_name` — identity
- `owner_chat_session` — current Claude session ID
- `status` — idle | active | blocked | paused
- `last_action_at` — ISO-8601 timestamp
- `current_action` — what's being worked on, if anything
- `branch` — the active git branch
- `in_flight[]` — actions started but not done; each tagged with verb + target + awaiting
- `open_items[]` — known TODOs with priority + raised-at + owner-decision-required flag
- `cross_lane_refs[]` — lane IDs this lane reads/produces for
- `kpis_this_month` — lane-specific KPIs (revenue, orders, leads, etc.)

The state file is the **handoff document**. When Mac is off and you reach the lane from iPhone, the lane reads its state file (not the chat scrollback) to know where it is. Chat continuity is nice; state-file continuity is mandatory.

### Cross-lane shared state

At `~/hn-lanes/_shared/`:

- `brand-state.json` — current month targets, banked-to-date per channel, active offers
- `creative-pool.json` — generated creatives with metadata: `{filename, dimensions, brand, channel-tags, reusable_in[], generated_at, gemini_prompt_used}`
- `campaign-graph.json` — which campaigns reference which others (cross-lane mapping)
- `escalation-log.jsonl` — append-only log of anything escalated to Nihaf

Every lane reads `_shared/` at session start. Updates to shared state are committed to the repo so Mac/iPhone see them on next pull.

### Inbox / outbox per lane

- `~/hn-lanes/<id>/inbox/*.md` — pending directives (from Nihaf via any client, or from orchestrator, or from another lane)
- `~/hn-lanes/<id>/outbox/*.md` — completed work summaries + references to artifacts

Processed inbox files move to `inbox/processed/` with result appended.

---

## 5. Dispatch flow

### From Mac (laptop on)

```
$ mkt                  # ssh winpc -t 'wsl tmux attach -t marketing-orchestrator'
$ lane 03              # ssh winpc -t 'wsl tmux attach -t lane-03-aggregator'
$ mkt-dispatch 06 "compose festival CTWA copy for HE"
$ mkt-watch 03         # stream live output
$ mkt-status           # one-line per lane
```

Aliases live in `~/.zshrc`. SSH is via Tailscale. The Claude execution happens on winpc, not on Mac.

### From iPhone (laptop off)

1. Open Claude Code app on iPhone
2. Either:
   - **Resume an existing conversation** with the orchestrator — that conversation knows how to SSH+dispatch
   - **Start a fresh conversation** with the marketing-shell starter prompt — Claude bootstraps
3. Type a directive in plain English
4. iPhone Claude → Bash → SSH into winpc → tmux send-keys to the right lane → captures output → returns to you
5. Result rendered in iPhone Claude chat as if the conversation was happening on winpc

The phone is a thin client. The actual chat with state continuity lives on winpc tmux + JSONL.

### Pattern (the cleanest mental model)

**You don't dispatch FROM a phone TO a lane. You attach the phone TO the orchestrator (or a lane) running on winpc.** The phone provides keyboard + screen; the brain stays in one place.

---

## 6. Sync layers

| Path | Sync mechanism | Why |
|---|---|---|
| `~/Documents/Tech/<repo>/` (working tree, excl. `.git`) | **Git via GitHub** + auto-pull cron on winpc + pull-on-attach on Mac | versioned, conflict-handled |
| `~/Documents/Tech/HN-Hotels-Asset-Database.xlsx` | **Syncthing** (real-time, bidirectional) | gitignored, sensitive, needs both sides |
| `~/Documents/Design/` (visual refs, moodboards, brand) | **Syncthing** | binary, no versioning needed |
| `~/Documents/HE-Raw-Clips/` (large video clips) | **NOT auto-synced** — on-demand SSH copy | too large for continuous sync |
| `~/hn-lanes/<id>/artifacts/` (creatives generated by lanes) | **Auto-rsync from winpc → Mac via Tailscale** every 10 min | creatives land in Documents naturally |
| `~/.hn-assets.env` (224-key catalog) | Regenerated on both sides from xlsx via `hn-save`; xlsx itself synced by Syncthing | secret values |

**Path equivalence is mandatory.** `~/Documents/Design/he-1918.png` resolves to the same conceptual file on Mac (`/Users/nihaf/...`), on winpc (`C:\Users\HN Hotels\...`), and accessible to iPhone Claude via SSH into winpc. Logical path is identical; OS-specific absolute path is hidden behind `~`.

---

## 7. Resource budgeting

winpc constraints (as verified Phase 0):

| Resource | Total | Available | Constraint |
|---|---|---|---|
| RAM | 8 GB | ~3 GB free | **tight** — only 1–2 Claude sessions can be alive concurrently |
| Disk | 250 GB | 190 GB free | comfortable for WSL2 + repos + assets |
| CPU | 4-core | 36% baseline used by aggregator | spikes during dispatch expected |

**Implication:** the marketing shell uses **wake-on-prompt**, not always-on. Only the orchestrator + 1 active lane are alive in tmux at any moment. Other lanes are tmux sessions that exist but have no Claude process attached — Claude is invoked on demand within the session. State persists in files. Re-entering a lane reads its state.json + brief + in_flight items.

If always-on becomes necessary (e.g., reactive monitoring), the right answer is a winpc RAM upgrade (HP EliteDesk 800 G3 DM accepts up to 32 GB). Until then, wake-on-prompt is the architecturally enforced default.

---

## 8. Build phases

| Phase | Deliverable | Status |
|---|---|---|
| **0** | Preflight verifications (SSH, Tailscale, RAM/CPU, WSL2 status, Claude account, iPhone SSH probe) | **In progress** — 9/10 checks done; iPhone SSH probe deferred to user; concurrent-Claude verify deferred to Phase 1 |
| **1** | winpc as Claude execution host (WSL2 + Ubuntu + Node + Claude + tmux + git inside WSL2) | Pending — requires winpc online |
| **2** | Cross-machine state sync (git auto-pull cron + Syncthing on Mac/winpc + artifact rsync) | Pending |
| **3** | Lane structure on winpc (7 tmux sessions + state.json + inbox/outbox + tmux-resurrect) | Pending |
| **4** | Mac + iPhone client tooling (`mkt`/`lane`/`mkt-dispatch`/`mkt-watch`/`mkt-status` aliases + iPhone Claude bootstrap prompt) | **Partially done** — Mac aliases in `~/.zshrc` (this branch); iPhone bootstrap awaits iPad-role decision |
| **5** | Populate lanes + end-to-end test (migrate the 4 active Mac chats, spin up 02/06, run iPhone dispatch test) | Pending |

Each phase has a confirmation gate. None of phases 1–5 begin until phase 0 verifications confirm the constraints, and Nihaf says "proceed."

---

## 9. Scalability path

When marketing succeeds, the same architecture instantiates again for other operational domains. The pattern is identical; only lane definitions change.

| Domain | Lanes (illustrative) | Orchestrator |
|---|---|---|
| **Marketing (today)** | influencer, google, aggregator, dine, tv, meta | marketing-orchestrator |
| **Operations** | vendor-mgmt, supply-chain, procurement, quality | ops-orchestrator |
| **HR** | roster, attendance, compliance, onboarding, exits, payroll | hr-orchestrator |
| **Finance** | monthly-close, vendor-bills, expense-cat, P&L, tax | finance-orchestrator |
| **Customer** | reviews-response, complaints, retention, loyalty | customer-orchestrator |
| **Strategy** | expansion-research, new-markets, M&A, smart-hotel | strategy-orchestrator |
| **Master CEO seat** | (read-only across all orchestrators) | master-orchestrator |

Adding a new domain ≈ 30 min of new tmux session names + new brief files + new state.json schemas. Zero infrastructure change. Same SSH, same client tooling, same sync layers.

---

## 10. Failure modes + recovery

| Failure | Symptom | Recovery |
|---|---|---|
| **winpc reboots** | All tmux sessions die | tmux-resurrect restores them on next tmux start. State files survive on disk. Aggregator auto-resumes via existing Scheduled Task. |
| **Tailscale drops** | SSH unreachable from Mac/iPhone | Both reconnect automatically when network returns. Work pauses until network resumes. State files preserve any in-flight context. |
| **Mac off mid-action** | Chat with Mac terminal cuts | tmux session on winpc keeps running. Re-attach from iPhone or next-day-Mac to continue. |
| **Lane Claude session crashes** | Chat ends mid-turn | Re-invoke `claude` in same tmux session. Claude reads state.json + brief + last few inbox/outbox entries; continues. |
| **State.json corrupted or missing** | Lane can't resume | Reconstruct from brief + git log + outbox history. Flag for owner review. |
| **Concurrent Claude limit hit** (Pro Max simultaneous-session cap) | New session boots an old one | Wake-on-prompt mitigates (max 1–2 Claude alive concurrently). If still hit, switch to per-lane Claude API keys (different billing model). |
| **iPhone Claude can't SSH** | iPhone dispatch fails | Fallback: HTTP bridge at hnhotels.in that proxies SSH commands. Same UX, ~2h to build. |
| **Aggregator interaction with Marketing Shell** | 6 Claude processes compete with aggregator Chrome | RAM budget enforces 1–2 active Claude. Wedge `winpc.mjs` locks prevent direct file collision. |

---

## 11. Doctrine (one-liners, paste-ready)

1. **State files are the handoff. Chat history is decorative.**
2. **Path equivalence is mandatory. `~/Documents/...` resolves to the same conceptual file everywhere.**
3. **The brain is winpc. Mac, iPhone, iPad are clients.**
4. **Wake-on-prompt by default. Always-on requires a hardware upgrade.**
5. **Cross-lane communication via shared state files + commits, never via direct lane-to-lane RPC.**
6. **Nihaf stays the only intelligence trigger. No autonomous schedulers in marketing-shell v1.**
7. **Adding a lane is adding a tmux session + a brief + a state.json. Nothing else.**
8. **Architecture must remain reversible. Any phase undoable by undoing only that phase.**

---

## 12. Related files

- [state.schema.json](state.schema.json) — canonical schema for per-lane state files
- [orchestrator-bootstrap.md](orchestrator-bootstrap.md) — starter prompt for the orchestrator chat
- [lane-bootstrap.template.md](lane-bootstrap.template.md) — starter prompt template for individual lane chats
- [`../winpc-MASTER-CONTEXT.md`](../winpc-MASTER-CONTEXT.md) — winpc coordination doctrine (separate but referenced)
- [`../winpc-resource-graph.json`](../winpc-resource-graph.json) — winpc resource ownership graph
- [`../winpc.mjs`](../winpc.mjs) — winpc coordination CLI (audit/claim/lock/inherit)
- `~/hn-workflows/<id>.md` (laptop) → mirrored to `~/Documents/...` (winpc) — six lane briefs
- [`/Users/nihaf/.claude/CLAUDE.md`](/Users/nihaf/.claude/CLAUDE.md) — global doctrine + delegation protocol
- [`/Users/nihaf/.ai-coordination/HN-HOTELS-PROTOCOL.md`](/Users/nihaf/.ai-coordination/HN-HOTELS-PROTOCOL.md) — 4-tool coordination

---

## 13. Open design questions

These are NOT blockers for Phase 0 or Phase 1, but should be resolved before Phase 4 ships:

1. **iPad role** — second-screen reading, active control with Claude Code app, or background-only? Affects whether iPad gets its own bootstrap prompt.
2. **iPhone Claude SSH capability** — does the iOS Bash tool support SSH over Tailscale? Verification deferred to Nihaf's manual phone test.
3. **Concurrent Claude session limit on Pro Max** — verifying as Phase 1's first step. If blocked, fall back to API-key model per lane.
4. **Always-on vs wake-on-prompt for orchestrator** — wake-on-prompt by default; reconsider only if reactive monitoring becomes a requirement.
5. **Cross-domain orchestrator (master CEO seat)** — defer until ≥2 domains exist (marketing + ops, etc.).
