# Sauda — The 100x Intelligence Architecture

*Produced 2026-05-29 as part of the Phase-3 architectural pass.*
*This document is read-only guidance — no code ships here.*

---

## The single architectural change that 10×s Sauda's intelligence

**Bind the morning plan to live POS burn rates.**

Today Sauda knows the *cheapest source per material*. It does not know *which materials are running out* or *at what rate*. The morning plan pre-sections into "NCH morning / HE evening / vendor calls" by static category mapping. Nihaf still decides *how much* to buy, and the list has no concept of urgency — a zero-stock critical item and a well-stocked slow-mover appear side by side with equal weight.

The change: pull `pos.order.line` data from both Odoo instances every 24 hours, compute a 7-day rolling burn rate per material (in the material's canonical UOM — kg, L, Units), and re-rank the morning plan by the compound score:

```
urgency_score = (avg_daily_burn × best_unit_price_paise) × session_health_multiplier
```

where `session_health_multiplier` is 1.0 when the cheapest portal's session is READY, 0.7 when it is stale (>12h), and 0.3 when NOT_CONNECTED (de-prioritise items you can't actually buy today). The morning plan becomes a **ranked procurement queue**, not a categorised checklist.

This is intelligence, not a feature. The UI surface does not change in structure. The data changes, and the sort order changes, and that is enough — because the hardest part of Nihaf's 6:30 AM is not finding a price, it is knowing *what to buy first*.

---

## The constraints it removes

| Constraint today | After this change |
|---|---|
| **Cookie-staleness blindness** | Stale sessions actively *demote* items in the queue — you only see a hard-to-buy item at top if you can actually buy it. Session-health is no longer cosmetic; it gates rank. |
| **Density blindness** | Burn rate is in canonical UOM (kg/L/Units from Odoo). Price comparison is already normalised to the same UOM (the Phase-1 fix). First time both are grounded in the same unit simultaneously. |
| **Settlement opacity** | Knowing `avg_daily_burn_kg` for Refined Oil lets Sauda compute "last purchase was 5kg, burn is 1.2kg/day → 4.2 days remaining." That's the beginning of a true inventory position, not just a price list. |
| **Static plan weight** | Every item having equal weight in the current plan is the core cognitive tax at 6:30 AM. Burn × price × session rank eliminates it. |

---

## What it costs

| Layer | Work | Magnitude |
|---|---|---|
| **D1** | New table `material_burn_rates (material_id TEXT PK, brand TEXT, avg_daily_qty REAL, avg_daily_paise REAL, last_computed_at TEXT, days_window INTEGER)` | ~221 rows, trivial |
| **Worker / cron** | New action `refresh-burn-rates` on `/api/purchase-control` (POST, admin-only). Calls Odoo `pos.order.line` via JSON-RPC (company-scoped), joins to material by `product_code`, aggregates 7-day rolling window, upserts D1. Scheduled 05:45 IST daily (before the 06:30 scout) via the existing CF cron mechanism — one new entry in a new worker or the same cron trigger pattern. | ~100 lines of backend |
| **UI surface** | In `renderPlan()` and the morning auto-seed: replace the category-bucket sort with `urgency_score` sort. Add a small "⚑ high burn" indicator chip (gold, reuses existing chip CSS) to items in the top quartile. No new tabs, no new modals. | ~30 lines of UI |
| **Odoo API** | `pos.order.line` is already read by `loadMaterialUniverse` for the material universe. Burn-rate pull reuses the same `odooCall()` helper, same credentials (uid=2, `ODOO_API_KEY`), filtered to `date_order` within 7 days. Two company calls (HE at `test.hamzahotel.com`, NCH at `ops.hamzahotel.com`). | Existing pattern |

**Total cost: one new D1 table, one new cron action (~100 lines), ~30 lines of UI sort-change.** One focused session.

---

## What it kills downstream

- **The pre-sectioning heuristic** (NCH-morning / HE-evening by category) is immediately superseded. You keep the section headers as display grouping if you want, but the *order within and across sections* becomes burn-driven. The heuristic was always a proxy for "what's urgent." This replaces it with the real signal.
- **Manual quantity intuition.** `avg_daily_qty` is surfaced as a one-line sub-label ("burns ~1.2 kg/day"). Nihaf reads the number and orders accordingly. The app is no longer just a price-comparison surface; it is a *procurement decision surface*.
- **The session-health badge as decoration.** Right now the green/amber/red chip tells you a portal's health but doesn't change what you do. Once session health gates rank, a red chip *explains* why an item dropped in the list — it is no longer just a status indicator but a ranking input.
- **The need for a separate "what do I need today" mental step.** Today Nihaf opens Sauda, then separately thinks "what did we run low on yesterday." After this change, that step happens inside Sauda the night before, scored and ready.

---

## The smallest viable first slice — one session, irreversibly informative

**Objective:** Prove that POS burn data is reachable, mappable to materials, and changes the sort order in a way Nihaf can feel on the first morning he uses it.

**What to build:**

1. **A single new API action `compute-burn-rates`** (POST, admin-only). Calls `pos.order.line` on both Odoo instances, 7-day window, joins by `product.default_code = material.product_code`, computes `avg_daily_qty` in the product's `uom_id` unit. Writes to `material_burn_rates` in D1 (the table is created inline via `CREATE TABLE IF NOT EXISTS`, zero migration ceremony).

2. **Fire it once manually** via:
   ```
   POST /api/purchase-control?action=compute-burn-rates&pin=0305
   ```
   Inspect the D1 rows. Verify that top items (ghee, milk, oil, chicken) match Nihaf's intuition of what burns fastest.

3. **Change one line in the UI** — the Plan tab's `renderPlan()` function sorts its material list by `mat.avg_daily_paise_burn` (the computed field joined at `action=materials`) descending instead of by category. No new UI chrome. The morning list now opens with the most expensive daily burn at the top.

That is the irreversibly informative step. Once Nihaf sees the Plan re-ranked — ghee at the top because ₹1731/kg × 1.2kg/day = ₹2077/day burn, versus Silver Pouch Packaging 5×7 near the bottom — the old alphabetical plan becomes unacceptable. The intelligence is felt in the first use, and there is no going back.

**What this slice does NOT build** (deliberate scope):

- The `session_health_multiplier` (deferred — proves the concept first).
- "Days remaining" inventory indicator (needs last-purchase data join — next slice).
- Any UI chrome beyond the re-sort.

The first slice answers exactly one question with real data: *does POS burn, when attached to price, produce a morning plan that is obviously more correct than what exists today?* If yes (it will be), the architecture is proven and every subsequent slice builds on solid ground.

---

## Nihaf-only actions (not blocking any of the above — flag for when ready)

1. **Odoo UOM corrections** (~4 materials): `Sunflower Oil (1 Liter)`, `Ruchi gold` (oil), and similar liquids tagged as `packet` UOM in Odoo. These should be `L` — then they get true per-litre comparison instead of per-pack. *Session work: open Odoo → product → UOM field → set to Litre. ~10 min.*

2. **BigBasket, JioMart, Blinkit, Hyperpure session re-capture**: all four expired today (2026-05-29). Open Chrome on hn-winpc while logged into each portal, run the capture extension. *Physical: requires your Chrome on hn-winpc, ~20 min for all four.*

3. **Amazon Business B2B login**: for GST-invoice pricing, the HN Hotels business account needs to be logged into Amazon in Chrome, then captured. *Physical: one login + extension capture.*

4. **Vendor phones**: Buffalo Milk supplier and Gas-NCH vendor phone numbers — needed for the vendor-direct WhatsApp send rail to be fully seeded. *Physical: paste the two numbers into chat or into Sauda's vendor management UI.*

5. **VPS SSH key for future adapter work**: the current key (`SCOUT_VPS_SSH`) works from this machine. If a new session loses it, the key is at `/Users/nihaf/.hn-assets/hn_scout_vps_ed25519`. No action needed unless the key is rotated.

---

*Sauda does not need more portals. It needs to know which of the portals it already watches matters most, right now, at the price it already has. That is the 100x.*
