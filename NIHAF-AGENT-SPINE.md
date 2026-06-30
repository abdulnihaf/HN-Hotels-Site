# NIHAF AGENT SPINE — intelligence + build context for the closing-layer agent

> Created 2026-06-30. **Resume protocol:** in a fresh chat say
> *"Pull the context of Nihaf Agent intelligence in the Spine"* → read this file end-to-end,
> then continue from §7. Pairs with [[nihaf-lack-spine]] (WHY the agent exists — the measured gap)
> and [[nihaf-brain]] (the constitution).
>
> **Fact status (Hukum truth contract):** lines marked *(verified 2026-06-30)* were queried live;
> *(Nihaf)* = his ground truth; the rest is design decided in-session. Re-verify any *(verified)*
> line before building on it — reality moves.

---

## 0. What Nihaf Agent IS (mission)
The **second Nihaf inside every chamber** that does the boring recurring work which protects
money, proof, discipline, and closure — the work Nihaf will never do himself, because his nature
is to build the next thing, not operate the last one. It is **intelligence for closure, not for
display.** Not an assistant, not a dashboard. It exists *only* where a finding is actionable.
Full "why" = the measured lack ([[nihaf-lack-spine]]): *he builds closing-machines and never
closes the loop on them; the agent is the operator that was never hired.*

## 1. The universal loop (every agent action)
**read source truth → find actionable gap → assign responsible person → send exact chase →
wait → re-read source truth → close automatically or escalate.**
A case is valid ONLY if it can name all five: the exact row · the exact missing proof/action ·
the responsible person · the exact message they get · the auto-close condition. Can't name all
five → it's noise → it must not fire.

## 2. The laws of the agent (binding — every detector obeys these)

**L1 — Reality before record. Reconcile before chase.** *(first law, Nihaf 2026-06-30)*
Absence in the data ≠ absence in reality. The operation probably happened on the ground (cash,
WhatsApp, physical) and only the *record* is missing. The agent never reads a silent trail as a
real gap. Before chasing, it asks an **independent witness** "did this actually happen?" — cash
moved? stock appeared? sales consumed it? CCTV saw it?
 - witness confirms it happened → gap is **recording**, not operations → close the books / flag a
   capture gap; gentler action, often no human chase.
 - no witness either way → verdict **"unknown"** → stay silent; never fire into the dark.
 - chase a human ONLY when reality itself (not paperwork) is genuinely incomplete.
This is the Hukum Truth Contract applied: truth by reconciliation, never single-source.
**Corollary — the Map of Darkness:** the agent's most valuable early output is not catching
staff, it's showing Nihaf where operations run with NO digital witness at all (where P&L is
fiction, where cash vanishes unmeasured). That output is a **to-BUILD list** (create a capture
point — Nihaf's strength), not a to-nag list.

**L2 — Forward-only. Historical data is context, not the agent's job.** *(Nihaf 2026-06-30)*
Historical data is used ONLY to understand reality (calibrate, learn the real flow, find the dark
spots). The live workflow watches operations from go-live FORWARD. It does NOT retroactively
chase or back-clean the legacy mess (the frozen POs, the 922 old findings, the stale feeds are
diagnostic context, not work orders). We build from here on.

**L3 — No false alarms.** A warning that cannot name row + missing-proof + person + message +
auto-close + escalation-rule does not exist. When in doubt, stay silent. Never count infra
issues, deliberate caution, or trivia as gaps (see the false-alarm filter in [[nihaf-lack-spine]]).

**L4 — Close by proof, not by "done."** A case closes ONLY because the next read of the source
truth proves the correction — never because someone pressed a button or said "done." *(This
re-read-to-confirm is one of the two new pieces to build.)*

**L5 — One machine, one switch.** "Only-Nihaf" and "staff" flows are the SAME loop. The switch is
the resolved responsible person: staff → chase them; only-Nihaf → surface one tap; no-path-exists
→ escalate to build it. Never build two agents.

**L6 — Born silent, earn the voice.** Every loop is born in dry-run / only-Nihaf mode: it
detects, writes the case, drafts the exact chase — but **sends nothing**. Only Nihaf sees it, for
a few days. It graduates to live staff-chase ONLY after proving it never cries wolf on that rule.
Earn belief before speaking. Zero social blast radius while proving.

**L7 — Immune to its own disease.** The agent must self-run, self-monitor, self-heal, and never
need Nihaf to keep it alive — because the data proves anything needing his daily attention dies
(his own finance-watcher ran one afternoon, dead 66 days). A liveness **heartbeat** ships from
line 1. If the agent ever needs him to tend it, it becomes finding #923.

**L8 — Only money + go-live reach Nihaf.** The single owner-threshold, confirmed by his most
consistent demand: real money moving, or going live. Everything else the agent swallows —
chasing, reminding, re-checking, reconciling. He is the exception-handler, never the inbox.

## 3. The two NEW pieces that are the whole "soul" (the rest already exists)
1. **Re-read-to-prove-closure** (L4) — the verifier that re-runs the source-truth read and closes
   only on proof.
2. **The heartbeat** (L7) — the self-liveness watch so the agent can't silently die.
Everything in §4 already exists — that part is *wiring*, not building.

## 4. Build reality — what exists to wire into *(verified 2026-06-30)*
- **Agent engine** — `functions/api/agents.js` + `schema-agents.sql`; tables `agent_runs`,
  `agent_findings` (D1 `hn-hiring`). Has fingerprint-dedup, verdict, directive, closure_status,
  a per-category RECTIFY map (inline_api/link/note_only + auto_close), Phase-1 `finance-watcher`,
  review UI at `/ops/agents/`. **Phase-1 deliberately does NOT auto-send and does NOT
  re-read-to-close — that is exactly the gap we fill.** *(Live: 922 findings, 15 runs all on
  2026-04-25, dead since — do NOT inherit that fate; that's why L7 exists.)*
- **Comms layer (the chase rail)** — `functions/api/_lib/comms-core.js` is the ENFORCED single
  choke point (in-file rule: never call Meta/Fast2SMS/Exotel except here). Functions: `sendWaba`,
  `sendSms` (Fast2SMS + BSNL-DLT), `sendVoice` (Exotel IVR + DTMF ack), `sendAndLog`,
  `sendWithFallback`, `runEscalation`. Tables: `comms_outbox` (escalation_chain JSON
  `["waba","sms","voice"]`, escalation_step, escalation_due_at, parent_outbox_id, acked_at/
  ack_action = two-way), `comms_optin` (consent gate). Guard: `phone_verification_pending` →
  auto-skip+log. Caveats: WABA ~40% fail (fallback matters); SMS/voice wired but barely tested;
  **a dry-run/agent-send gate is NOT yet in this module — must be added so the agent runs silent (L6).**
- **Cron** — Cloudflare scheduled Workers; shared secret `CRON_TOKEN`; hub pattern (one cron
  pings others). Account on paid tier. Copy `workers/sauda-remind-cron` / `workers/attendance-cron`.
- **Identity / responsible-person** — D1 `hn-hiring` `hr_employees`: `staff_pin` (4-digit Darbar
  PIN), `name`, `brand_label` (HE|NCH|HQ), `job_name`, `phone`, `phone_verification_pending`.
  Role scope via `classifyRole()` in `takht-auth.js`. AUTH_PINS: 0305 Nihaf(admin), 8523 Basheer,
  2026 Zoya(purchase), 4040 Haneef, 5050 Nissar. Every action stamps actor/time/source on the row.

## 5. The chambers + their source-truth trails *(live status 2026-06-30)*
- **Sauda (purchases)** — D1 `hn-ops` (uuid `308b815f-6899-44d8-bb13-b008e7afbef7`):
  `purchase_orders` (status ORDERED→RECEIVED→RAISED→PAID→RECONCILED; expected_amount_paise;
  ordered_by/received_by), `purchase_order_lines` (item_code, qty_received, receive_state),
  `purchase_media` (kind bill|goods, r2_key = proof), `vendors`, `outlets`.
  **SOURCE-TRUTH RULE (Nihaf): use ONLY these OPS_DB tables — never legacy `sauda_purchase`/
  `buy_lines`.** Live: 23 POs all ORDERED, purchase_media=0. Note: OPS_DB binding not yet in
  wrangler.toml; today spine.js purchase reads still hit Odoo. Price/PO capture is moving into the
  HN Staff App (§6).
- **Takht (settlement/sales)** — D1 `hn-hiring` `cash_events` (instrument, direction,
  amount_paise, source, recorded_by_pin, transfer_group_id, matched_* links). Slot→person via
  `nch-settlements` views. Live: 1,395 events, feed stale ~2026-06-20.
- **Anbar (inventory)** — D1 `hn-hiring`: `rm_outlet_receipts` (received_by, movement_key,
  evidence_key), `rm_outlet_issues`, `rm_outlet_counts`, `anbar_settle_photos` (verdict_json =
  vision conforms y/n). Live: thin/early (10 receipts, 14 counts).
- **Darbar (identity)** — `hr_employees` (§4). The capability/responsibility source.
- **Naam (marketing execution)** — `naam_decisions` (move_id, brand) = planned-move trail;
  witness "did the planned move actually execute?".
- **Nazar (visual proof)** — `anbar_settle_photos.verdict_json` is the real visual witness today
  (vision confirms what the system claims); future CCTV.

## 6. Current ground state *(Nihaf, 2026-06-30)* — why forward-only fits
The capture surfaces are being built NOW, which is exactly why the agent watches forward:
- **HN Staff App (Android worker hand)** — being built; records purchase prices (future Sauda
  price/PO capture).
- **Takht** — sales/settlement capture.
- **Anbar** — inventory capture. …and more.
As each surface lands, its trail becomes reliable; a forward-only loop is born silent on it (L6),
reconciles against witnesses (L1), and graduates.

## 7. How we start (rollout — resume here)
1. Pick ONE loop — **purchases first** (his priority + where money freezes), once HN Staff App
   capture is live.
2. **Born silent (L6):** detect + write case + draft chase, send nothing; Nihaf watches a few days.
3. **Reconcile (L1):** cross-check the silent trail vs cash/stock/sales witnesses; only a gap ALL
   witnesses agree is real survives. Expect the first honest output to be a Map-of-Darkness /
   to-build finding, not a chase.
4. Prove zero false alarms → **graduate to live staff chase** via comms-core (waba→sms→voice),
   wait, **re-read (L4)**, auto-close or escalate.
5. **Heartbeat on from line 1 (L7).** Only money/go-live reaches Nihaf (L8). Widen rule by rule.

## 8. Secrets needed when wiring (NAMES ONLY — Worker secrets / .env.local; never plaintext)
`CRON_TOKEN` · WABA: `WA_SPARKSOL_PHONE_ID` `WA_NCH_PHONE_ID` `WA_HE_PHONE_ID`
`WA_SPARKSOL_TOKEN`/`WA_COMMS_TOKEN`/`WA_ACCESS_TOKEN` · SMS: `FAST2SMS_API_KEY`
`FAST2SMS_ENTITY_ID` (BSNL: `BSNL_DLT_API_URL`/`BSNL_DLT_TOKEN`/`BSNL_DLT_ENTITY_ID`) · Voice:
`EXOTEL_SID` `EXOTEL_API_KEY` `EXOTEL_API_TOKEN` `EXOTEL_CALLER_ID` · webhook sig: `DASHBOARD_KEY`
· AI (classification only, where rules are insufficient): provider key (name TBD) · D1: bind
`OPS_DB` (hn-ops) — not yet in wrangler.toml.

## 9. Open threads (where we paused)
- Confirm purchases is the first chamber (or name a harder-biting one).
- Define, per chamber, the **independent witnesses** for reconciliation (Sauda: cash + Anbar
  stock + POS sales).
- Build order: the two soul pieces (re-read-closer + heartbeat) + the dry-run gate in comms-core,
  then one silent loop.
- Nihaf to walk the **true on-the-ground flow** of a purchase (the one input no trail holds).

---
*Truth-source: this is a hypothesis confirmed against the live trail + Nihaf's word; the final
witness is Nihaf. A wrong line in a spine is worse than no spine — correct it here first.*
