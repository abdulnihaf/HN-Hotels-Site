# Nihaf Agent — Sauda Purchases · BUILD PROMPT (v1, 2026-07-01)

> Bounded, output-driven build/run spec for the FIRST Nihaf Agent. Produced by a 9-agent
> ultra design pass, then **substrate-corrected against the live D1** (the design agents read the
> code and pointed at the wrong store; the live data overrides them — see SUBSTRATE).
> Companion: spine §13 (layer), §14 (intelligence), §15 (purpose), and the FigJam diagram.

---

## FIRST PRIORITY CLAUSE (the one thing to wire first — decided by the agent, not by ordering)

**FIRST, wire the live daily "is today's cost complete?" sealer over Zoya's purchase entry** — for
each brand, each business day, judge by **value × category-completeness** (never per-item) and detect
when an **essential high-value category is entirely absent** (NCH milk; HE chicken in any of its 7
forms; HE mutton), then close that gap to exactly two ends: **SEALED** (entered-with-photo, or
explicitly marked not-bought-with-a-reason) or — only after Zoya was chased and stayed reluctant — an
**ATTRIBUTED loss owned by her on the trail**. Two things are non-negotiable inside this same first
clause: **(a) deep-audit-first** — before nagging Zoya to type anything, reconcile against every place
the data could already live and ingest it if found; **(b) the event-log trail written from event one** —
without it you cannot prove Zoya was told, and the whole guarantee collapses. **Do NOT lead with the
19–30 June backfill** — that is one-time historical cleanup with no recurring loss-prevention value; it
is the same engine pointed at old dates and runs SECOND, dripped one date at a time.

---

## OBJECTIVE (locked — spine §15)

The agent's job is **NOT to find discrepancies — it is to SEAL them.** Every brand-day ends in exactly
one of two terminal states, never a silent third: **SEALED** (gap closed before any rupee is lost → ₹0
loss) or **ATTRIBUTED LOSS** (if a loss occurs, it occurs ONLY after the responsible staff was notified
multiple times and stayed reluctant → the loss is **owned by that named staff, proven by the trail**).
Success metric on the agent's own daily ledger = **"₹ sealed" + "unattributed loss = 0"**, never
"discrepancies found". Output-driven. **The trail is the source of truth** — every nudge, ingest,
state-advance, reason-mark, escalation and close is a logged event (actor + time + channel); the agent
decides and attributes FROM the trail and never overwrites it with a blind "done".

---

## SUBSTRATE (LIVE-VERIFIED 2026-07-01 — build against THIS, not the design's labels)

The live store the **HN Staff Android app** writes to is **D1 `hn-ops`** via `functions/api/ops.js`
(deployed `hn-ops-api.pages.dev/api/ops`). VERIFIED: `purchase_orders` holds Zoya's live entries dated
**18, 26, 30 June**. Build against:

- **`purchase_orders`** — header, one row per `outlet_id × vendor_key × for_date` (UNIQUE). `status`
  ORDERED→RECEIVED→RAISED→PAID→RECONCILED; `ordered_by/at`, `received_*`, `raised_*`, `paid_*`,
  `expected_amount_paise`, `pay_amount_paise`, `bank_ref`.
- **`purchase_order_lines`** — RELATIONAL lines (FK `order_id`): `item_code` (`''` = unresolved /
  productive failure), `item_label`, `qty_ordered`, `uom`, `unit_cost_paise` (`0` = unpriced),
  `qty_received`, `receive_state` (`''|ok|short|over|missing`), `flag`. **Lines are relational here —
  NOT a JSON blob.**
- **`purchase_event_log`** — **ALREADY EXISTS** (`order_id, event_type, actor_pin, actor_name,
  payload_json, at`). The trail table is already here — **EXTEND it, do not recreate.**
- **`items`** (183 items / 17 categories; `price_mode` fixed|live, `price_paise`, `default_vendor`,
  `category`, `brand`) + **`item_aliases`** (lower-cased normalization).
- **`purchase_price_history`** (per item×vendor×date `unit_cost_paise`) — the price reference + the
  recurrence signal for essentiality.
- **`purchase_media`** (`kind` goods|bill, R2-backed) — receive already forces goods+bill photo +
  qty>0 + rate>0.
- **Demand / expectation in hn-ops = `purchase_orders` rows with `status='REQUESTED'`** (ops.js
  `action=demand`). `vendors`, `outlets`, `staff` (staff_pin→name/role), `roles`.

**DEAD / LEGACY — never the live substrate (the deep-audit may READ them to recover history):**
- `sauda_purchase` / `sauda.js` / D1 `hn-hiring` — the OLD `sauda.hnhotels.in` web store; data
  **stopped 19 June**; lines live in an `items_json` blob.
- `sauda_day_po` — **stale since 2 June**; do NOT use as the live demand oracle.
- `buy_lines` — older still.

**Deep-audit must sweep BOTH stores** (hn-ops + old hn-hiring `sauda_purchase`) + orphan
`purchase_media` + any off-system source before nagging Zoya — the "missing" 19–30 June data is partly
sitting in the old web store and must be **INGESTED, not re-keyed**.

**VERIFY before wiring AI:** the L3 model router endpoint (`/api/ai-router`) is live in production
(self-test 4/4) but confirm its path before wiring the judge/OCR tier; ship the deterministic-rules
path first, AI behind it.

---

## INTELLIGENCE — value × category-completeness, never item-presence (spine §14)

Rank the 17 categories per brand by trailing-14-day **rupee value** (`purchase_price_history` +
`purchase_order_lines`) and **recurrence**. A category is **essential** if (value ≥ threshold) OR
(bought ≥ ~80% of trading days) AND it is in the brand's hero set. **Hard essentials** (never
legitimately zero on a normal trading day): NCH → **milk** (all forms, ~₹17,600/day, #1 input);
HE → **chicken across all 7 forms** (ONE case, never 7 messages); HE → **mutton**. **Exclude
low-value/recurrence-only items before any AI sees them** — lemon (₹250, 11/12 days), cabbage →
NEVER flag. Recurrence ≠ value, as a hard constraint. Fire a case ONLY when an essential category is
**entirely absent** (zero lines across all its forms, alias-resolved) for a brand-day. Messages are
**respectful and category-level** ("Chicken hasn't been entered for Hamza Express yet today — add
it?"), never per-item. **30-June canonical test:** NCH ₹23,500 tea + ZERO milk → 1 case; HE eggs/oil/
bread/veg + ZERO chicken + ZERO mutton → 2 cases. **3 respectful messages, not 8, and nothing for
cabbage/lemon.**

---

## FLOW — state machine, the six beats

A **case** = `(brand × for_date × category-or-line × responsible_pin × deadline × proof-state)`,
lifecycle `OPEN → NOTIFIED → REMINDED → ESCALATED → (OWNER) → SEALED | ATTRIBUTED`. No third "archived
unresolved" exit.

- **BEAT 0 — DEEP-AUDIT-FIRST** (mandatory, zero human contact first): reconcile the brand-day against
  every place data could already live — existing `purchase_orders` (incl. `REQUESTED`), the old
  `sauda_purchase` web store, orphan `purchase_media`, the Sauda paste→decode inbox. If found → ingest/
  normalize (route through paste-decode + vision-OCR), log `INGESTED`, seal — **do NOT nag**. Only a
  genuinely empty brand-day opens a case. This is reconcile-before-raise = trusted-on-day-one vs
  muted-on-day-one.
- **BEAT 1 — TODAY FIRST:** open a Zoya case per absent essential category for today, deep-linked
  pre-scoped to brand + date + the missing-category chip.
- **BEAT 2 — BACKFILL SECOND** (19 Jun → last-entered): same engine, old dates, oldest-first, **dripped
  one date per run** (never a 12-date flood), low-urgency, "Day N of M" progress; still deep-audit each
  date (ask once: "For 19–24 June, did you note these somewhere? Send it and I'll enter it; or tap
  'nothing was bought'." before any re-key).
- **BEAT 3 — PRICE PEELS TO BASHIR:** the instant a line is `price_mode='fixed'` with
  `unit_cost_paise=0`, fork a Bashir case, deep-linked to a price screen with **yesterday's price
  pre-filled** (editable — mandi rates move), confirm/override in one tap. **`price_mode='live'` zero is
  NORMAL** (rate comes off the bill at receive) → never a Bashir case. **Single-owner rule:** a line in
  entry phase is Zoya's only; once entry+photo is complete it leaves her and, if fixed/0, appears on
  Bashir's — never both at once.
- **BEAT 4 — EOD TARGET:** per brand-day, target set = essentials this brand buys this weekday, each
  with a `deadline_ts`, surfaced as one glance: **"By 9:30pm: NCH milk entered + priced."** Urgency as a
  TIME, not a duration.
- **BEAT 5 — CONFIRM-DONE HANDOFF:** Zoya's screen carries **[✓ Today's purchase complete — send to
  Bashir]**. On tap → write `ZOYA_DONE` → agent stops nudging Zoya for that brand-date and pivots to
  Bashir's price gaps. **Soft-block:** if an essential target is still empty, warn "milk still not
  entered — confirm anyway?" so she cannot silently close a real gap. "Ball in Bashir's court" is
  literally `ZOYA_DONE` + remaining fixed/0 lines.

---

## THREE SCENARIOS, ONE ENGINE, DIFFERENT DEADLINE MATH

- **BACKFILL** (19 Jun→last-entered): soft, oldest-first, 1/run, fatigue-capped; deep-audit each date.
- **LIVE-YESTERDAY** (yesterday incomplete this morning): **URGENT** — yesterday's P&L is closing in
  Hisaab; receive+price must close before the morning buy (~11:00) and before Hisaab freezes.
- **LIVE-TOMORROW** (today's rolling buying): rolling hard stops — entry ~14:00, prices ~16:00, receive
  ~21:00; EOD target set at first tick; use the real vendor/Hyperpure cutoff already in code, don't
  invent one.

---

## URGENCY TIERS (UX says "by THIS TIME this step must be complete")

- 🔴 **URGENT/HARD:** today's essential-category entry; an unpriced line on goods already RECEIVED (real
  money owed). Shown as a TIME ("by 11:00 AM today"). Ladder: WABA → reminder → SMS (DLT) → Exotel voice
  if value warrants → Nihaf as attributed-risk.
- 🟡 **QUICK/soft:** a few mid-value unpriced lines, goods not yet received — "when you get a moment
  today", repeats next morning.
- 🟢 **BACKFILL:** paced, "3 days left to close June", one date/run.
- Quiet hours hard (~9pm–7am IST; a late gap holds, fires at window-open). Standing authorization
  checked per person before first send. Brand WABA tokens NEVER cross (NCH milk on NCH/Sparksol, HE
  chicken on HE/Sparksol; a missing Sparksol token is a config error, never a borrowed customer token).

---

## THE THREE PEOPLE AS ROLE-VARIABLES (designing for them = designing for the business)

- **NIHAF = WATCHER:** sees only threshold crossings — a payment above his standing threshold (routed
  through the Hukum approval gate as approve/reject, never an FYI) or an attributed-risk line ("HE
  chicken not entered by 11 AM despite 2 asks. Day cost understated. Owner: Zoya."). Self-monitor; a
  clean day reports a single verified ₹0-loss-sealed line, or nothing.
- **ZOYA = ENTRY:** every purchase entered, each WITH a photo; presses CONFIRM-DONE when done.
- **BASHIR = PRICE:** every fixed-mode missing price; gets yesterday's price pre-filled, editable.
- Every recipient keyed by Darbar `staff_pin → phone`; the agent never names a person it knows only by
  code, and if a person is replaced the role-variable re-points with zero rewrite.

---

## EXACT TOOLS + LOOP

ONE Cloudflare cron Worker `nihaf-agent-sauda`, crons covering IST 6–23 every ~30 min (CF cron is UTC —
gate on IST hour inside the handler), silent outside business/quiet hours. Per tick, per brand:
1. READ `purchase_orders` + lines + `items` (master cached ~1h in Worker memory) for the active date
   window where `status != RECONCILED`.
2. Run BEAT 0 deep-audit; ingest if found.
3. CLASSIFY each line state in pure SQL/JS (missing-price = `price_mode='fixed' AND unit_cost_paise=0`;
   missing-receive = `qty_received IS NULL`; missing-proof = no goods/bill media; live/0 = skip).
4. RUN category-completeness essential-absence judgment — rules wrapper does ≥90% (hard-essentials list
   + exclude-trivial); the AI router `classify` tier only for borderline/seasonal categories vs the
   14-day trail, deterministic fallback.
5. RECONCILE-BEFORE-RAISE against the bank/`money_events` feed before any "unpaid/owed" message; a row
   with a matching bank debit auto-advances to PAID, never nags.
6. ROUTE each open gap to its single owner (price→Bashir w/ pre-fill, entry/receive→Zoya,
   money-threshold→Nihaf via Hukum).
7. GENERATE a nudge only if the owner has an actionable gap, within quiet hours + standing auth, past
   cooldown, under the per-person daily cap — **batch per person per brand** (one digest, never
   one-per-item).
8. WRITE the trail (`purchase_event_log`) + a daily metric row (₹ sealed, unattributed count) every
   tick. Vision tier (once router path confirmed) reads bill amount/qty/rate at receive/ingest and
   PRE-FILLS only — the human confirms in one tap (photo = witness, human = committer).

---

## BOUNDED, NOT OPEN-ENDED (hard constraints)

The agent can only act on `purchase_orders` rows in the active date window, only open the fixed case
kinds, only on the essentials set, only after a reconcile pass, only route to the 3 known PINs, only
send within quiet hours + standing auth on the correct brand token, and caps nudges (cooldown +
max-rungs-then-escalate). It **cannot** invent work, message per-item, mutate Odoo, or press a seal on
anyone's behalf — sealing is always a real observed state change (a line, a photo, a bank match), never
a button the agent presses for them. **CORRECTING < IGNORING** is a hard gate: every nudge is a
deep-link with the fix pre-loaded (price keypad up with yesterday's number; receive camera with ordered
qty; missing-category chip), so the corrective tap is fewer than navigating manually, and dismissing
leaves the baton + the clock in the staff member's court. **NO FALSE ALARMS:** reconcile-before-raise +
alias-resolved category + a carry-forward window (an essential bought in bulk in the last N days above
daily burn is presumed covered).

**PHOTO RULE — carried as Nihaf's stated intent (uploaded image, not in-app live capture) but FLAGGED
for his decision:** an upload is the *easier* thing to fake, so if anti-fraud is the goal the stronger
witness is **perceptual-hash uniqueness** (reject reused images) + **bill-OCR cross-check** (vendor +
for_date + amount within tolerance of `expected_amount_paise`), not the upload-vs-capture distinction.
Build to "uploaded + hash-unique + OCR-date-match"; one flag flips it to live-capture if he prefers.

---

## BUILD ORDER (close the circle before any outbound; verify each step on live 30-June data)

1. `purchase_event_log` (extend) + daily-metric + the detector in **SHADOW MODE** (no outbound) — PROVE
   it opens exactly NCH-milk + HE-chicken + HE-mutton for 30 June and NOTHING for cabbage/lemon.
2. Beat-0 deep-audit sweep (hn-ops + old web store + media + paste-decode) — still no chase.
3. Wire the lifecycle ladder to `comms-core` (`runEscalation`, `gap_minutes`) with deep-links + Bashir
   price pre-fill; quiet-hours + brand-token + standing-auth guards on.
4. EOD target + CONFIRM-DONE soft-block + ball-in-court handoff.
5. Hukum WAITING-ON-YOU surface for the OWNER/money threshold + the daily ₹-sealed / zero-unattributed
   verified-good line to the watcher.
6. Backfill drip second.

Nothing reaches Zoya/Bashir until the detector is proven correct in shadow on real data.

---

## ROLE-AS-VARIABLE (extract AFTER Sauda-entry is proven, not before)

This same engine generalizes to a "Closer" where a role is a **config row, not new code**:
`role = (watches: store+query defining a wound) × (detect_rule: value-weighted incompleteness predicate)
× (responsible_pin via Darbar) × (proof that closes it) × (ladder: rungs+stall+channels) × (deadline:
soft|hard|rhythm) × (target) × (terminal: SEALED + ATTRIBUTED predicates) × (brand_token)`. Generic,
built once: day/stage-card + wound model, value×completeness ranking, deep-audit reconcile, ladder
runner + two terminals, trail writer, deadline clock + target poster, comms, AI tiering + cost-cap,
identity resolution, deep-link-with-fix UX. **Bashir-price is already the second config row** (detect:
fixed/0; proof: non-zero rate; provisional yesterday-price keeps the pay chain alive while the case
stays OPEN against Bashir = sealed AND attributed). Takht-cash and Darbar-attendance drop in later as
config rows. **Do NOT generalize before the Sauda instance is verified in shadow** — abstracting a bug
abstracts it into every role.

---

## OPEN GROUND-TRUTH (Nihaf only — answer before this reaches a staff phone)

1. **Surface:** does Zoya use the Android app (hn-ops) or `sauda.hnhotels.in` (web) day-to-day? Live
   data says her recent entries are in hn-ops — confirm so the agent reads the right store + deep-links
   to the right place.
2. **Photo rule:** uploaded + hash-unique + OCR-date-match (my recommendation), force live in-app
   capture, or plain upload?
3. **Order cutoff per brand** (HE/Azeem, NCH/Nafees): one time or per-vendor? Sets the LIVE-TOMORROW
   hard deadline.
4. **Standing authorization + quiet hours** to auto-message Zoya and Bashir on Sparksol WABA (~9pm–7am
   IST?).
5. **Watcher money threshold:** above what ₹ amount must a payment route to you (Hukum approve/reject)?
   Default: ladder-exhausted OR essential still open at cutoff-minus-30 OR any outward money send.
6. **Essential hero set:** exactly NCH = milk; HE = chicken (7 forms, one case) + mutton — plus any
   other never-legitimately-zero category (rice/oil/bread for HE)?
7. **Backfill 19→30 June:** genuinely un-entered, or captured off-system the deep-audit should ingest?

---
*Agent remains DEFERRED (spine §13) until the purchasing build closes — but its debut task IS to close
its own data layer (drive Zoya to complete entry), so this is the wiring that ends the deferral.*
