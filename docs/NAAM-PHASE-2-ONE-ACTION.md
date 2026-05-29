# Naam Phase 2 — The One Action

## The challenge: question "view-only"

Naam is view-only. That was the right call to ship. But the constraint produces a specific daily friction: **the most important micro-decision in Naam — "launch the retargeting campaign whose 10 creatives I built and whose audiences are ready" — cannot be acted on from Naam.** To do it, you must open Claude on the laptop, re-establish the entire Meta lane context, and execute. For something that is a binary yes/no on a campaign already in a known-ready state, that's a 20-minute ritual to answer a 5-second question.

---

## The one action: **Creative → approve to launch**

> **One-tap: "Mark this campaign ready to launch."**  
> Naam writes a single approval record. A Cloudflare cron picks it up, verifies the pre-conditions (audiences populated, creatives exported, adset exists), and fires the Meta API call to change campaign status `PAUSED → ACTIVE`.

**Why this one and not the others:**
- "Send to WABA broadcast" modifies a customer-facing communication channel — high blast radius, irreversible within the 24h customer session window. Wrong context for a phone tap.
- "Schedule on Meta" requires creative selection + audience + budget + schedule — too many inputs for a one-tap action; it's a creative brief, not an approval.
- "Approve to launch" has zero ambiguity: the campaign already exists with the right targeting, budget (₹500/day split), and creatives. The only reason it's paused is that you haven't said "go." That *is* a phone-tap decision — you see the 3.78% CTR, the 5,369 clicks, the retargeting audiences at 36K+ reach — and you either say go or you don't.

This is the only action that: (a) requires no creative input on the spot, (b) is genuinely reversible (pause again in one tap), (c) has pre-conditions that Naam already surfaces, and (d) will be needed **on a recurring basis** as campaigns are created by Codex and handed off waiting for your go.

---

## Data model

### New D1 table: `naam_approvals` (in `hn-hiring`)

```sql
CREATE TABLE naam_approvals (
  id          TEXT PRIMARY KEY,          -- 'approval_<ulid>'
  lane        TEXT NOT NULL,             -- 'meta-ads' | 'google' | 'pisignage' …
  action      TEXT NOT NULL,             -- 'launch_campaign' | 'pause_campaign' | 'resume_campaign'
  target_id   TEXT NOT NULL,             -- campaign/adset/asset id the action acts on
  target_label TEXT,                     -- human label shown in Naam (e.g. "HE Retargeting v2")
  brand       TEXT NOT NULL,             -- 'HE' | 'NCH'
  requested_at TEXT NOT NULL,            -- IST ISO8601
  requested_by TEXT NOT NULL DEFAULT 'naam',
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'executing' | 'done' | 'failed' | 'cancelled'
  precondition_check TEXT,               -- JSON: {audiences_ready, creatives_exported, adset_exists}
  result_msg  TEXT,                      -- what the cron wrote back
  executed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_naam_approvals_status ON naam_approvals(status, created_at DESC);
```

**Boundary:** Naam writes `status='pending'` rows only. The Cloudflare cron owns `executing → done/failed`. Codex CLI may write `cancelled` rows if a campaign's context changes. Naam reads all statuses for display.

---

## API surface

### `GET /api/naam-actions?action=list&brand=HE`
Returns all `naam_approvals` rows for the brand, ordered by `created_at DESC`, limit 50.  
Response: `{ ok, approvals: [{ id, lane, action, target_id, target_label, brand, status, requested_at, result_msg, executed_at }] }`

### `POST /api/naam-actions`  ← **the tap**
Body: `{ action: 'request', lane, action_type, target_id, target_label, brand }`  
Auth: `?pin=<PIN>` (same PIN as the rest of Naam — single-owner, no separate token needed)  
Writes a `pending` row; returns `{ ok, approval_id }`.  
**Idempotency:** if a `pending` row already exists for the same `(lane, action_type, target_id)`, returns the existing id rather than duplicating.

### `POST /api/naam-actions` with `action: 'cancel'`
Body: `{ action: 'cancel', approval_id }` + PIN.  
Sets `status='cancelled'`. Only valid on `pending` rows.

### Internal cron endpoint (NOT Naam-facing): `POST /api/naam-actions?action=cron-execute`
Called by a CF Scheduled Worker (`naam-action-cron`) every 5 minutes.  
For each `pending` row:
1. Runs pre-condition check (audiences populated, adset exists, Meta API reachable).
2. If check passes: calls Meta/Google API (via existing `ads-control.js` or `google-ads.js` action endpoints — no new integrations), writes `status='done'`.
3. If check fails: writes `status='failed'`, `result_msg` explains why.

**Money-mutation gate:** only `pause_campaign` / `resume_campaign` / `launch_campaign` are permitted. Budget-change actions are explicitly blocked in the cron — the cron throws `403 BUDGET_MUTATION_NOT_PERMITTED` and writes `status='failed'` with that reason.

---

## UI delta (Naam changes only)

### Queue tab (new 5th tab)
Naam's 4 tabs become 5: **Today / Lanes / Creative / Queue / You**.  
Queue tab shows `naam_approvals` in reverse-chronological order with status badges (pending amber / done green / failed red / cancelled muted). Each row shows lane, target label, requested time, current status, and result message.

### One-tap button on lane detail
On the Meta Ads detail pane (and any lane that surfaces a `launchable_campaigns[]` array in `naam-data.json`), a new block appears:

```
┌─────────────────────────────────────┐
│ READY TO LAUNCH                     │
│ HE Retargeting v2                   │
│ campaign 120246050386040505         │
│ ₹500/day · audiences ready          │
│         [→ Approve launch]          │  ← coral, 52px, single tap
└─────────────────────────────────────┘
```

Tap → PIN confirmation (2-second confirm overlay, then `POST /api/naam-actions`) → "Queued for launch" toast → button changes to "Pending ○". No second tap needed to undo — the Queue tab has a Cancel button for pending rows.

**Irreversibility gate:** if `action_type` is `launch_campaign`, the confirm overlay shows:  
*"The campaign will go live within 5 minutes. It will spend ₹500/day. Tap to confirm."*  
One extra tap to confirm spend. This is the only screen in Naam that requires two taps.

### Staleness check
`naam-data.json` carries a `launchable_campaigns[]` array per lane/brand — populated by `naam-snapshot.js` reading the live cockpit APIs. If the snapshot is >24h old, the Approve button is replaced with a "Snapshot stale — refresh first" warning. The action is blocked until data is fresh. This prevents approving a campaign that may have changed since the last snapshot.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Pre-condition check fails (audience not yet populated) | `status='failed'`, Queue shows "Audience not ready yet — retry after 24h". No side effect. |
| Meta API call fails mid-execution | `status='failed'`, cron retries once after 5 min. If second attempt also fails, permanent `failed` + result_msg with the API error. Campaign remains paused. |
| Naam writes a row but cron is down | Row stays `pending`. Naam shows "Queued — awaiting execution (5 min)". After 30 min without execution, Queue shows "Execution delayed — check cron health". |
| Duplicate tap | Idempotency check returns existing `pending` row id. No duplicate API call. |
| Owner cancels before execution | `status='cancelled'`. Cron skips `cancelled` rows. No side effect. |
| Budget mutation accidentally requested | Cron blocks at the gate, writes `status='failed'` with reason `BUDGET_MUTATION_NOT_PERMITTED`. Never reaches Meta/Google API. |

---

## Cron / queue / write-back path

```
[Naam tap]
  → POST /api/naam-actions { action:'request', ... }  (writes D1 pending row)
  → returns approval_id

[CF Scheduled Worker: naam-action-cron, cron: */5 * * * *]
  → GET /api/naam-actions?action=cron-execute
  → for each pending row:
      1. precondition_check() → reads live cockpit API / Meta API
      2. if pass: call /api/ads-control?action=resume&campaign_id=...
         (existing endpoint — no new Meta integration needed)
      3. update D1 row: status='done', executed_at, result_msg
      4. (optional) send Nihaf a WABA confirmation via comms-core sendWaba()

[Naam Queue tab next open]
  → reads naam_approvals via GET /api/naam-actions?action=list
  → shows 'done' with green badge and executed_at time
```

**Write-back to Codex memory:** none. The cron only writes back to `naam_approvals`. The Codex marketing-memory remains Codex-owned and is NOT modified by Naam. The `naam-snapshot.js` will pick up the now-`ACTIVE` campaign status on its next run and update `naam-data.json` accordingly, which is the correct feedback loop: Naam → action → live state → snapshot → Naam sees result.

**Total new infrastructure:** 1 D1 table, 1 new Pages Function (`naam-actions.js`, ~150 lines), 1 new Scheduled Worker (`naam-action-cron`, ~80 lines). No new secrets. Reuses existing `ads-control.js` for the actual API call. Naam's index.html gets ~60 lines for the Queue tab + ~30 for the approve button on lane detail.
