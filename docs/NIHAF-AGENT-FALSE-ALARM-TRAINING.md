# Nihaf Agent — false-alarm-proof training (2026-07-01)

> From a 12-angle operational read of **50 real daily POs** (26 HE + 24 NCH, 30 May–1 Jul). The one goal:
> the agent may **only ever chase what a month of real behaviour proves is expected TODAY**, and every
> candidate gap must survive a fixed **ladder of suppressors** before any human is contacted. If any check
> is uncertain → **ask, never assert** (First Law). **Better silent than crying wolf.** Companion:
> [daily basket](NIHAF-AGENT-DAILY-BASKET.md) (the expectation seed), spine §14/§16/§18.

## Training is not "predict orders" — it is: build a deterministic expectation table, then wrap every gap in suppressors so a wrong alarm cannot be emitted by construction.

### Stage 0 — Canonicalise (must run before ANY counting, or every statistic is wrong)
- **Name-resolve:** fold every spelling/format/pack to one entity id. Real cases: `Milk — morning` (dash) ==
  `Milk (morning)` (parens); oil family (Oil/Sunflower/Soft/Sof/Master/Ruchi-Gold/Salad); Romali==Rumali;
  Gobi==Cauliflower; Coriander==Dhania; LPG cylinder==Cylinder(gas); silver-pouch order variants.
  **Guardrail — never cross a real boundary:** Kabab **chili** (spice, gm) ≠ Kabab **chicken** (protein, pc);
  morning-milk ≠ evening-milk; small-cup ≠ big-cup. Resolve by unit + magnitude, not prefix.
- **Unit-convert to one base per entity:** egg **1 crate = 30 pc** (so 30-May "Egg 90 pcs" == 3 crate =
  normal); sugar 1 bag = 50 kg; oil box/can ≈ 15 L; butter 1 kg = 1000 gm; "no"=="pc" for counts, but
  "packet" ≠ "no" for cups (a real 10× difference). **Unknown unit/pack = UNRESOLVED → ask, never guess.**

### Stage 1 — Derive the expectation table (state derived from activity, never declared)
Per brand × entity, over **NORMAL days only**, compute presence-rate, median qty (base unit), and the
observed **max consecutive-absence gap** → assign a CLASS (the whole basis of "expected today"):
- **TRUE-DAILY** (≥90% of normal days, maxgap ≤1): HE **Shawarma chicken** (26/26); NCH **milk-pair, buns,
  butter, cutlet, lemon** (~92%). *Only these may flag a same-day absence.*
- **PERIODIC** (≈30–89%, own multi-day cadence): HE egg (~alternate-day), tomato, oil-lines, LPG, sugar
  (~4-day), dals. *Flag only when days-since-last exceeds its OWN max gap + margin.*
- **DEEP-BULK** (<15%, high volume, lasts weeks): **tea powder** (2/24, ~50 kg), whole spices (clove: 26-day
  gap), maida sacks, packaging. *Never flags on absence.*
- **Vendor-fills allow-set:** any item blank ("—") on ≥30% of its days (oil-box, charcoal, onion, packaging,
  cleaning) is **legitimately blank** — a valid ORDERED state, never a gap.

### Stage 2 — The suppressor ladder (a candidate must survive EVERY rung to reach a human), ranked by false-alarms killed
1. **Day-state gate (biggest).** Classify the DAY before looking at any item:
   **DATA-GAP** (≥2 contiguous absent days in *both* brands — e.g. 18–24 Jun) → zero item alarms, one quiet
   note to Nihaf to check the export. **NO-LIST** (single absent day, one brand — e.g. NCH 9 & 13 Jun) →
   zero alarms, at most one gentle confirm to that sender. **PARTIAL / RESTOCK** (item-count far off the
   ~31 HE / ~13 NCH median, or a restock signature: Maida ≥20 kg / ≥8 whole spices — e.g. HE 28–29 Jun 56/51
   items) → suppress **all** daily-item flags. Only **HAS-PO-NORMAL** days reach rung 2.
2. **Recurrence-class gate.** Only TRUE-DAILY may raise same-day absence; PERIODIC only past its own max gap;
   DEEP-BULK never on absence.
3. **Value gate (~₹300 floor).** Below the floor → silently auto-attributed "trivial" (kills the daily
   lemon/chilli/coriander/samosa churn); protects the milk / shawarma lines.
4. **Substitution-group gate.** Judge the GROUP not the SKU: CHICKEN {shawarma,tandoori,kabab,boneless,
   lollipop} covered if any present; OIL covered if any oil line; MILK is the 2-slot pair.
5. **Co-occurrence gate.** Auto-alarm only on near-1.0 bidirectional locks (milk-morning ⟷ evening 20/20);
   weaker links = chase-once-then-attribute; buffer items (charcoal, cucumber, LPG) never flag on absence.
6. **Confidence gate.** Item is not "expected" until ≥10 delivered days in a rolling ~21-day window; widen
   tolerances around the 18–24 Jun hole; early rates are noise (butter 100%@day3 → 46% real).

### Stage 3 — Resolve, don't assert
A candidate that survives all six rungs is still **not a verdict** — it becomes **one question to the right
sender** (Azeem→HE, Nafees/Basheer→NCH) and the day closes **SEALED** (fixed, ₹0 lost) or **ATTRIBUTED**
(asked, owned, ignored-with-reason). Never re-nag a closed day. A blank "—" is judged **line-present, not
number-filled**. Re-run Stages 0–1 monthly so the table tracks reality with no schema change (self-learning, §18).

## What it CAN flag confidently (small set, only after the full ladder on a NORMAL day)
1. A **TRUE-DAILY anchor** genuinely absent after name+unit resolve on a full list — HE shawarma; NCH
   buns/butter/cutlet/lemon. 2. A **broken hard co-occurrence lock** — milk-morning without milk-evening.
3. A **material PERIODIC item past its OWN max gap** — egg silent >~4 days, sugar >~15, LPG past cadence.
4. A **vendor-fill item ORDERED but never received/priced** downstream — a billing gap, not a PO gap.
5. A **list from a sender not in {Azeem, Nafees, Basheer}**. Everything is a *question*, closed SEALED/ATTRIBUTED.

## Ask, never assume (First Law — resolve these by asking, never guess)
- **Per-item price** for the ₹ gate — ask once, store; never guess a price into a chase.
- Whether a single-brand absent day was a real **NO-LIST** (stock held) or a missed ingest — confirm with that sender.
- Whether a **DATA-GAP** block is an export failure — a QSR + café cannot both buy nothing for a week → treat
  as ingestion until Nihaf confirms.
- Any **UNRESOLVED** item name / pack / unit (e.g. "Gaytri 500gm") — hold it, don't drop or guess-merge; ask to extend the table.
- A **cross-brand item** from a real sender (mutton-kurma from Basheer) — flag to Nihaf, never silently reassign.
- Any survivor that could be innocent — ask *"is X coming today, or already covered?"*, never declare "X is missing".
