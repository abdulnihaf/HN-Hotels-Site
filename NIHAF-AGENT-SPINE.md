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
· AI model router L3 keys — ALL separate pay-as-you-go, subscriptions (Claude Max / ChatGPT
Pro / Kimi membership) do NOT cover API: `ANTHROPIC_API_KEY` (console.anthropic.com/settings/keys),
`OPENAI_API_KEY` (platform.openai.com/api-keys), `MOONSHOT_API_KEY` (platform.moonshot.ai, recharge
≥$1 to activate, base https://api.moonshot.ai/v1; runtime model `kimi-k2.7-code`, $0.95/$4.00 per
MTok). All three CONFIRMED present in `hn-hotels-site` production secrets (list 2026-06-30), alongside
existing `GEMINI_API_KEY` (→ router has 4 providers), `FAST2SMS_API_KEY`, `EXOTEL_*`, `WA_*`,
`CRON_TOKEN`, `OWNER_PHONE`, `ODOO_*` (POS/reconciliation witnesses), `NAZAR_WITNESS_KEY` — the whole
platform substrate is already provisioned. NOTE: present ≠ proven; functional validity (valid + funded)
is proven only by the router's first live call — build a gated self-test endpoint. · D1: bind
`OPS_DB` (hn-ops) — not yet in wrangler.toml.

## 9. Open threads (where we paused)
- Confirm purchases is the first chamber (or name a harder-biting one).
- Define, per chamber, the **independent witnesses** for reconciliation (Sauda: cash + Anbar
  stock + POS sales).
- Build order: the two soul pieces (re-read-closer + heartbeat) + the dry-run gate in comms-core,
  then one silent loop.
- Nihaf to walk the **true on-the-ground flow** of a purchase (the one input no trail holds).

## 10. UNIVERSAL PLATFORM ARCHITECTURE — BUILD THIS FIRST *(Nihaf 2026-06-30)*

**Decision (supersedes the per-chamber framing in §7):** do NOT build agents per-scenario — that
fragments the plumbing. Build ONE universal platform; every half-agent is a **config** dropped on
it. The node model applied to the agent itself — the substrate is the moat, each agent is a point.
The platform is use-case-agnostic, so it does NOT wait for any trail; build it now. §7 becomes
"how each CONFIG is rolled out" once the platform stands.

**An agent = a config.** Per use-case you declare ONLY:
`{ name, source, schedule, detect_rule, witnesses[], responsible_resolver, message_templates,
close_condition, escalation_ladder, mode }`. Everything below is shared.

**The layers (a case flows top→bottom):**
- **L0 — Agent Registry (config).** Only thing written per use-case. *(new)*
- **L1 — Clock.** Cloudflare crons + hub pattern + `CRON_TOKEN`; one scheduler ticks all agents.
  *(exists: `workers/sauda-remind-cron` pattern → generalize)*
- **L2 — Source/Read (data-from-anywhere).** Pluggable adapters behind one interface: D1
  (hn-ops, hn-hiring), Odoo JSON-RPC, HTTP APIs, R2, snapshots. *(partly exists → formalize)*
- **L3 — Intelligence = the Nihaf AI model router.** *(NEW — Nihaf's named priority.)* Rules
  FIRST (deterministic, free); model only where rules can't decide. One `think(task, context)`
  interface routing by **priority + fallback + cost-cap** across providers (Kimi → OpenAI →
  Gemini → Claude; provider-agnostic, configurable). Cheap model to classify, strong to judge.
  Centralizes model keys; logs spend; caps cost.
- **L4 — Reconciliation (reality-before-record, law L1).** For a candidate gap, query declared
  WITNESSES (cash/stock/sales/CCTV) → verdict real-gap / recording-gap / unknown. Only real-gaps
  proceed. *(NEW — core discipline)*
- **L5 — Case/Memory.** Each case = row with the 5 required fields + lifecycle + proof +
  reconciliation verdict + re-read-close state. *(exists: `agent_findings` → extend)*
- **L6 — Identity/Responsibility.** case → person → phone → channel → opt-in. *(exists: Darbar /
  `hr_employees`)*
- **L7 — Comms router (universal outbound).** One interface across **WABA → SMS → Voice** with
  escalation ladder, two-way ack, opt-in gate, phone-verify guard. Voice = **Exotel** (telephony)
  + **ElevenLabs** (human TTS). *(largely EXISTS: `comms-core.js` → add ElevenLabs + dry-run gate)*
- **L8 — Gate.** Per-agent mode (silent/dry-run vs live = birth-silent L6); owner-threshold
  (money/go-live → Nihaf = L8); rate limits; compliance. *(partly exists → add dry-run agent gate)*
- **L9 — Liveness/Heartbeat (immune system, law L7).** Every agent + cron emits a pulse; a
  meta-watcher catches any dead agent → self-heal or escalate. The platform watches itself. *(NEW
  — foundational)*
- **L10 — Secrets/Key registry.** All keys by NAME (model + comms + cron), read by the routers,
  never plaintext. See §8.

**Build order:**
1. **Model router (L3)** + **Comms router (L7** — extend `comms-core`: +ElevenLabs, +dry-run gate).
   The two reusable routers Nihaf named; independent of any trail → build first.
2. **Loop engine + Agent Registry + Case layer (L0/L5)** — generalize `agents.js` to run any config.
3. **Heartbeat (L9)** — ship WITH the engine so the platform can't die.
4. **Read adapters (L2) + Reconciliation (L4)** → then **Gate (L8)**.
5. THEN the first agent = a config (purchases, once its trail is reliable).

**To build L3 next, the one input needed from Nihaf:** which providers + which key NAMES exist
(Kimi / OpenAI / Gemini / Claude), priority order, and any monthly cost cap. Names only — keys go
to Worker secrets / `.env.local`, never here.

## 11. BUILD LOG / STATUS *(2026-06-30 — DEPLOYED & VERIFIED LIVE)*

- **L3 model router — LIVE on production.** `functions/api/_lib/ai-router.js` + gated endpoint
  `functions/api/ai-router.js` (`/api/ai-router?action=selftest|think&pin=0305`). Shipped to
  `hn-hotels-site` via PR #499 (squash `15d60ea`), then a redeploy to bind `GEMINI_API_KEY`.
- **Self-test PASSED 4/4** (token-free — lists each provider's models, spends nothing):
  `anthropic` 296ms · `openai` 859ms · `moonshot`(Kimi) 300ms · `gemini` 100ms — all `authenticated`.
  `GEMINI_API_KEY` was stale at first (400 invalid); replaced via `wrangler pages secret put`
  + redeploy → green. Keys are present AND functionally valid — proven by a real auth call, not a guess.
- **SECURITY — fixed & re-verified CLOSED.** `pages_build_output_dir="."` was serving every committed
  file publicly: `hnhotels.in/NIHAF-BRAIN.md`, `/CLAUDE.md`, `/wrangler.toml`, `/docs/*.md` returned
  **200 with raw content** (constitution, endpoint map, secret *names*). `isInternalAsset()` at the TOP
  of `functions/_middleware.js` now 404s `*.md/.sql/.toml/.sh/.lock` + named config on every host;
  app surfaces (.html/.js/.css/.json/img) untouched. Re-tested live post-deploy: those paths now
  **404**, root + `manifest.json` still **200**. Spine markdown is now safe on `main`.
- **Recovery note.** Built in RTX session `6d68c041` (worktree `gallant-khayyam-4a411b`), a box with
  NO git/Cloudflare creds → could neither push nor deploy. The RTX control link dropped (the box
  itself stayed up); the session was recovered to the Mac, rebased onto `main`, and deployed from the
  creds'd machine. Full transcript + bundle archived.
- **NEXT:** **L7 comms router** — extend `comms-core.js` (+ElevenLabs human TTS, +dry-run gate) so the
  agent can chase up the WABA→SMS→voice ladder. Then loop engine + Agent Registry (L0/L5) and
  heartbeat (L9). L3 (done) + L7 (next) are the two reusable routers — the spine that stands
  independent of any chamber's trail.

## 12. THE ROUTER INTELLIGENCE — exactly how `think()` decides (as executed, live)

The router is L3's brain: ONE enforced choke point — `think(env, {...})` — for every LLM call in the
platform. Nothing calls Anthropic / OpenAI / Kimi / Gemini directly, the same way `comms-core.js` is
the only path to a message. That single door is *why* intelligence here is cheap, capped, logged, and
swappable instead of scattered and uncontrolled. Its decision logic, in order:

1. **Rules first, model last.** A caller reaches `think()` ONLY when deterministic rules can't decide.
   The model is the exception-handler, never the default — most cases close with zero spend. (COA:
   the agent is intelligence bounded by a closed space, not a chatbot.)
2. **Tier = how hard the question is.** Three tiers map difficulty to cost:
   `classify` (cheap, high-volume — "is this a real gap? which bucket?") · `summarize` (mid — condense
   a trail) · `judge` (rare, expensive — genuinely hard reasoning). Each tier pins the cheapest-capable
   model per provider (classify ≈ Haiku / Gemini-Flash / Kimi / GPT-4o-mini; judge ≈ Opus / GPT-4o / Kimi).
3. **Priority chain + fallback — the immune system.** Each tier has an ordered provider list —
   classify `anthropic→gemini→moonshot→openai`, summarize `anthropic→moonshot→gemini→openai`,
   judge `anthropic→openai→moonshot`. It tries the first; on ANY failure (error / unconfigured key /
   over-cap) it silently falls to the next brain. A dead provider, a bad key, or a rate-limit NEVER
   stops the agent — it degrades to the next model. Brains are interchangeable by construction.
4. **Cost cap enforced BEFORE spending (paise).** It estimates input tokens, computes the paise cost
   for that provider×tier model (USD price table × ₹88/$), and if the estimate exceeds the cap
   (default ₹5/call) it SKIPS that provider for a cheaper one. The cap is a *door*, not an after-the-fact
   reading — a single call physically cannot blow the budget.
5. **Output is a coordinate, not prose.** Pass a `schema` and the router forces "reply ONLY with valid
   JSON of this shape," strips code fences, and parses it. The agent receives a typed object — COA's
   "code, not free-text" applied to the model's mouth. Every case it emits is structured, never a sentence.
6. **Every spend is logged (the trail is the intelligence).** Each successful call writes to D1
   `ai_spend_log`: provider, model, tier, agent, tokens in/out, cost_paise, time. You can see which
   agent spent what on which brain. Logging is wrapped so it can never break a call.
7. **Total failure is a SIGNAL, not a crash.** If every provider in the chain fails, `think()` returns
   `{ok:false, error:'all_providers_failed', attempts:[…]}` with the per-provider reason — which the
   heartbeat (L9) treats as an owner-threshold event. "All brains down" is itself detected, never silent.
8. **`selfTest()` proves, it doesn't guess.** It lists each provider's models (no tokens spent) to prove
   the key is valid + reachable. That is the 4/4 green in §11 — verification against reality, not assumption.

Prices and model-ids live in the `MODELS` config table — swapping a model string or a price is a
one-line edit, no code change. `USD_INR = 88` is the only FX assumption (refine with a live feed later).

## 13. PURCHASES = AGENT #1's SUBSTRATE — layer pulled, AGENT DEFERRED *(2026-07-01)*

**Decision (Nihaf, 2026-07-01):** the purchasing build — database, frontend, technical wiring — is
still being shaped. Agent #1 does **NOT** come out until that **entity ring closes**. COA reason: the
agent is the *action ring*; it can only sit on a *closed entity ring*. Releasing it onto a moving
schema would mean constant re-training + false alarms against a target still in flux. Pulling this
layer was the step that makes the agent possible later — it is not the agent itself.

**Canonical layer (the REAL one — not the legacy sprawl):**
HN Staff Android app `android/HNStaff` → `functions/api/ops.js` (deployed as `hn-ops-api`) → **D1 `hn-ops`**.
Tables: `purchase_orders` (one card per outlet×vendor×date), `purchase_order_lines` (item lines — every
discrepancy signal lives here: `item_code`, `qty_ordered`, `unit_cost_paise`, `qty_received`,
`receive_state`, `flag`), `purchase_event_log` (the trail), `items`+`item_aliases` (master + normalization),
`purchase_price_history`. **Do NOT wire the agent to the OLD parallel stores** `sauda_purchase`/`buy_lines`/
`sauda_*` in D1 `hn-hiring` — that is the legacy four-app sprawl this rebuild replaces.

**Lifecycle (`purchase_orders.status`):** REQUESTED (demand, `sauda.demand`) → ORDERED (place,
`sauda.place`) → RECEIVED (`sauda.receive`; backend already FORCES goods+bill photo, qty>0, rate>0) →
RAISED → PAID → RECONCILED. Payment is already gated on complete receive proof.

**Discrepancy = STAGE-AWARE (this is the anti-false-alarm rule).** A blank price or a missing item is
NOT a defect by itself — only against the stage + the item's `price_mode`:
- **price-missing:** `unit_cost_paise=0` is a defect ONLY for `price_mode='fixed'` items, OR any line still
  `0` after status=RECEIVED. A `live`-priced line at ORDERED with `0` is NORMAL (rate comes from the bill).
- **item-not-entered:** an expected item (a REQUESTED demand line, or a recurring item in
  `purchase_price_history`) with no matching ORDERED line by cutoff. Sub-case: `item_code=''` + `flag` set =
  un-normalized item ("typed but unmapped").
- **(later):** `qty_received` NULL past cutoff · `receive_state` in short/over/missing · RECEIVED never RAISED/PAID.
Responsible person = the **staff PIN on that stage**. Close = the proof exists in the trail.

**Gate before agent #1 is built:** (1) the purchasing build closes; (2) re-derive these rules against the
FINAL schema (this layer is in flux — treat the columns above as a 2026-07-01 snapshot); (3) confirm whether
*receive* actually happens in-app — live snapshot 2026-07-01: **32 orders all ORDERED, 0 received, 36/78
lines unpriced**, which may mean receive happens on paper / web, not the app (only Nihaf holds this truth).

This section is the **L0 detect-rule + L4 reconciliation draft** for agent #1, captured for resume. Build
it only after the purchasing build closes.

## 14. ANOMALY INTELLIGENCE — value × category-completeness, NOT item-presence *(2026-07-01, Nihaf)*

**Purpose (reframe):** the purchases agent does NOT police individual items. It **certifies today's total
purchasing cost is complete + accurate** — that number feeds Hisaab P&L. An anomaly = "the day's cost is
materially understated because an ESSENTIAL category is entirely missing (a missed entry)", never "some
item wasn't bought."

**Why item-presence checking fails (PROVEN in the trail — D1 `hn-hiring` `buy_lines`, 12 days, Jun '26):**
recurrence ≠ value. Lemon bought 11/12 days = **₹250** total; Tomato 10 days = ₹100; the cheap veg
(chilli, coriander, cucumber, gobi, beans) dominate FREQUENCY but are near-zero value — the "cabbage class."
Value is CONCENTRATED: Buffalo milk **₹17,600**, Rumali roti ₹4,500, then milk/butter/oil/chicken. So
neither flat presence nor recurrence alone works — the signal is **value × expectation at CATEGORY grain.**

**Category-completeness (the core test):** group SKUs into essential category-groups; raise ONLY when a
high-materiality, high-expectation group is **entirely absent today (no SKU, any form).** Worked example —
*Chicken* = the 7 `Meat & Poultry` SKUs in `hn-ops.items` (Boneless/Shawarma/Kebab/Tandoori/Grill/Tangdi/
Lollipop; all `price_mode=live`, vendor `mnbroilers`, brand HE). If even ONE form is entered → covered
(chicken IS there). If ALL 7 absent for HE on an operating day → missed entry → P&L wrong → chase.
Cabbage absent → ignore.

**Tiers (DERIVED from trail spend-share + category recurrence; self-calibrating as the going-forward
`hn-ops` trail grows — THIS is why "no data lost from here" matters):**
- **T1 monitor-always** (material + near-daily): Chicken (HE), Milk/Dairy (esp. NCH), Mutton/red-meat (HE),
  core breads (Rumali roti), cooking oil/fat, charcoal/fuel (HE tandoor).
- **T2 monitor-as-a-whole-only**: low-value daily perishables (veg) — flag only if the ENTIRE fresh-veg run
  is absent (no veg at all = no market run happened), never a single vegetable.
- **T3 never-chase**: stock-up / occasional (the 58 Dry Goods, 32 Packaging, masala) — bought in bulk
  periodically; daily absence is normal.

**Reconcile before raising (anti-false-alarm law):** a missing T1 group is a *candidate*; clear benign
reasons first (outlet closed today? a day-of-week the group isn't bought? menu still sells it?) before
raising. The reconcile + the buyer's answer are themselves trail.

**Chase / UX:** message the responsible buyer (PIN→phone via Darbar, Sparksol WABA) naming ONLY the missing
material groups, with a one-tap deep-link into the HN Staff entry screen **pre-scoped to that group** (vendor
+ SKUs pre-loaded), PLUS a one-tap **"not bought today"** that records legitimate absence into the trail.
Follow up until every T1 group is either ENTERED or explicitly MARKED-absent — then the day's purchasing
cost is **certified** for P&L. Correcting must be fewer taps than ignoring.

**Ground truth to confirm with Nihaf before build:** (1) the exact T1 essential set, per brand (is mutton
daily or specific days? chicken literally every operating day?); (2) the operating calendar (closed days) so
absence isn't false-flagged; (3) whether "not bought today" is a real allowed state per group. Agent still
**DEFERRED** per §13 until the purchasing build closes; this is its L3 (intelligence) + L4 (reconciliation) design.

## 15. THE PURPOSE — SEAL or ATTRIBUTE, never a silent leak *(2026-07-01, Nihaf — doctrine)*

**The agent's objective is NOT to find the discrepancy. It is to SEAL it.** Two terminal outcomes only,
and the trail is what guarantees them:
1. **SEALED** — the gap is closed before any money is lost: the responsible staff fills the missing entry
   (or marks a legitimate "not bought today"). The day's purchasing cost is made whole → **₹0 financial loss.**
2. **ATTRIBUTED LOSS** — if a loss IS incurred, it happens ONLY after the agent has demonstrably notified the
   responsible staff **multiple times** and they stayed reluctant. The loss is then **owned by that staff**,
   proven by the trail. An anonymous leak ("the P&L is just wrong, nobody knows why") becomes a named,
   documented failure.

**There is no third exit.** Every material gap ends as prevented or attributed — never a silent leak. The
shift: the agent is a **loss-sealer + accountability engine**, not a detector. Its success metric is "₹ loss
sealed" + "zero unattributed loss", not "discrepancies found".

**The trail IS the source of truth (Nihaf, verbatim).** Every notification, delivery, acknowledgement, and
action is timestamped in `purchase_event_log` + the comms log. That record is what makes both outcomes
airtight: it certifies the cost is whole, OR it carries the proof that staff X was warned N times and chose
not to act. Responsibility is sealed onto the trail, not argued from memory.

This is COA exact: don't chase what's lost — close the space so the wrong move can't happen; and where it
still happens, the trail names who let it. See the diagram drawn 2026-07-01.

---
*Truth-source: this is a hypothesis confirmed against the live trail + Nihaf's word; the final
witness is Nihaf. A wrong line in a spine is worse than no spine — correct it here first.*
