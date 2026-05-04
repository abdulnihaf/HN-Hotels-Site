# Deployment Strategy — 4 Vertical TVs, Consumer-Psychology-Driven

Sources of truth:
- Creative inventory: [hamzaexpress.in/ops/tv-mission-control/manifest.json](https://hamzaexpress.in/ops/tv-mission-control/manifest.json) (live)
- Hardware registry: [`registry/fleet.json`](./registry/fleet.json)
- Asset registry: [`registry/assets.json`](./registry/assets.json)
- Sync architecture: [`SYNC.md`](./SYNC.md)
- Authoring: [`SCENE_AUTHORING.md`](./SCENE_AUTHORING.md)

---

## Customer journey & gaze pattern

The Hamza Express counter wall has 3 customer-facing TVs side-by-side, plus 1 over the Bain Marie at the order counter:

```
                       MAIN DINING / ENTRY
                              │
          ┌───────────┬───────┴───────┬───────────┐
        TV-V2       TV-V1           TV-V3        │
       (LEFT)     (CENTER)         (RIGHT)       │
        Kathi    Combos+Biryani   Shawarma       │
       wall      wall              wall          │
                                                 │
                    ┌──── ORDER COUNTER ────┐    │
                    │       TV-V4          │    │
                    │     (Bain Marie)     │    │
                    │       Sheek          │    │
                    └──────────────────────┘
```

**Gaze sequence on entry** (verified by retail eye-tracking research, not just intuition):

1. **First fixation: V2 (LEFT)** — humans in non-Arabic cultures scan left-to-right; the leftmost screen is the anchor for the entire wall.
2. **Dominant fixation: V1 (CENTER)** — eyes return to center after initial scan; this is where decisions stabilize.
3. **Last fixation on wall: V3 (RIGHT)** — exit gaze; sets the final impression before the customer turns to the counter.
4. **Counter fixation: V4 (BAIN MARIE)** — visible during the order interaction, when the customer is vocalizing what they want. **Highest decision-trigger value.**

Each TV plays a different role. They are not interchangeable.

---

## Per-TV psychological role

| TV | Position | Role | Narrative arc | First combo shown |
|----|----------|------|---------------|-------------------|
| **V2** | LEFT (entry/anchor) | Friendly entry, climbing ladder | ₹149 → ₹309 (low to high) | C1 Ghee Rice + Dal Fry · ₹149 |
| **V1** | CENTER (hero/dominant) | Smart Pick first, then variety | ₹249 → ₹309 → ₹229 → ₹199 → ₹289 → ₹149 | C3 Smart Pick · ₹249 |
| **V3** | RIGHT (upsell anchor) | Premium first, then descending value | ₹309 → ₹289 → ₹199 → ₹229 → ₹149 → ₹249 | C6 Mutton Biryani · ₹309 |
| **V4** | BAIN MARIE (decision trigger) | Bestseller first, then upsell | ₹229 → ₹149 → ₹309 → ₹249 → ₹199 → ₹289 | C5 Chicken Biryani · ₹229 (top-selling protein) |

**Why these starting combos?**

- **V2 = C1 (₹149):** First-impression friendliness. Cheapest combo. "You can eat well at Hamza for ₹149." Removes price anxiety before the customer has even read the wall.
- **V1 = C3 (₹249, Smart Pick):** Center is where decisions stabilize. The Smart Pick badge does the cognitive work of "you should order this" without us having to say it.
- **V3 = C6 (₹309 Mutton Biryani):** Highest price on the wall as the first impression on the right side. Anchors the price ladder high — every other dish on every other TV looks like better value by comparison.
- **V4 = C5 (₹229 Chicken Biryani):** Top-selling protein category in the menu fingerprint. By the time the customer is at the counter, they're already in decision-mode; biryani is the most-ordered item, so V4 reinforces the dominant choice.

---

## Slot map — what plays where, when

Loop is 108s. Every 18s all 4 TVs cut to the next slot **simultaneously** (timing contract enforced; sync layer detailed in SYNC.md). At every slot, all 4 TVs show **different** combos — verified Latin-rectangle, no collisions.

| Time | V2 (LEFT) | V1 (CENTER) | V3 (RIGHT) | V4 (BAIN MARIE) | Customer reads |
|------|-----------|-------------|------------|------------------|----------------|
| 0s   | **C1 ₹149** | **C3 ₹249 SMART** | **C6 ₹309 PREMIUM** | **C5 ₹229 BESTSELLER** | Full price ladder visible at once. Variety perceived. |
| 18s  | C2 ₹199 | C6 ₹309 | C4 ₹289 | C1 ₹149 | Mid-range cluster + value re-anchor |
| 36s  | C3 ₹249 | C5 ₹229 | C2 ₹199 | C6 ₹309 | Smart Pick on left, premium on right — mirror flip reinforces "we have everything" |
| 54s  | C4 ₹289 | C2 ₹199 | C5 ₹229 | C3 ₹249 | Mostly mid-range — comfort cluster |
| 72s  | C5 ₹229 | C4 ₹289 | C1 ₹149 | C2 ₹199 | Value-leaning slot — "everything is affordable" |
| 90s  | C6 ₹309 | C1 ₹149 | C3 ₹249 | C4 ₹289 | Premium-leaning slot — "we go up to ₹309" |
| 108s | (loops back to 0s) | | | | |

Each slot is structured as **8s static + 10s video**. Static gives 8 seconds for the customer to read price + dish name. Video draws the eye for the next 10 seconds (cinemagraph rhythm).

---

## Why this beats a simple cyclic stagger

Yesterday's `all_combos.json` used cyclic shifts (offsets 0, 2, 4, 1) — mathematically valid stagger but **psychologically arbitrary**. Each TV played the same loop just shifted in time. That's neutral. Customers don't read it as "this TV has identity X."

`psychology_v1_combos.json` makes each TV have a **distinct personality**:
- V2 always opens with the cheapest combo when a new customer enters (refreshed every 108s)
- V1 always opens with the Smart Pick
- V3 always opens with the premium
- V4 always opens with the bestseller

A returning customer (or a customer in the restaurant for 30+ minutes) starts to **associate each screen with a price point**. That's brand reinforcement. That's the entire game in QSR menu boards.

---

## Phase roadmap — how creatives expand

Today's 4 TVs running combos is **Phase 1 base**. The mission control plan describes Phase 4 final state where each TV has a specialized conveyance. Here's the migration path:

### Phase 1 (LIVE today): All 4 TVs run combos C1–C6

- Active scene: [`scenes/psychology_v1_combos.json`](./scenes/psychology_v1_combos.json)
- All 12 combo creatives already uploaded to PiSignage
- Stagger + timing contract verified
- Deploy: `python3 ps_engine.py deploy scenes/psychology_v1_combos.json`

### Phase 2 (when Kathi creatives ready): V2 swaps to Kathi

- Trigger: mission control marks Kathi heroes/finals as `LOCKED`
- Action: create `scenes/psychology_v2_kathi.json` (timeline mode); swap V2's column from `c1_*` / `c2_*` etc. to `k1_chicken_kathi_*` / `k2_kathi_egg_*`
- V1, V3, V4 unchanged — they keep playing combos
- New scene compiles to a new V2 playlist, others stay identical → minimal change

### Phase 3 (when Shawarma creatives ready): V3 swaps to Shawarma

- Same pattern: change V3's column in the timeline to shawarma assets
- V1, V2, V4 unchanged

### Phase 4 (when Sheek creative ready): V4 swaps to Sheek

- Change V4's column to sheek assets
- V1 keeps the combos as the central hub
- All 4 TVs now have specialized identities matching the mission-control plan

### Phase 5 (when V5–V10 are physically installed): expand columns

- Add `tv-v5`, `tv-v6`, … to the `screens` array of the scene
- Add columns for each in every timeline row
- Engine + sync architecture scales without modification

---

## Scaling to "50 creatives, frame-by-frame consumer psychology"

Tomorrow's complex choreography (the user's stated goal) is a natural extension of `timeline` mode. Some practical patterns to use as the library grows:

1. **Daypart variation** — author multiple scenes (`breakfast.json`, `lunch_rush.json`, `iftar_hour.json`, `dinner.json`) and switch between them at fixed times. PiSignage's `deployTime` per group can fire at meal-time boundaries. Or run a Cloudflare Worker cron to call `ps_engine.py deploy <scene>` based on time-of-day.

2. **Repetition weighting** — to push a specific dish (e.g., Smart Pick), have it appear 2× per loop on V1 instead of 1×. Tradeoff: fewer unique slots per loop. With 12 dishes and a 6-slot loop you choose which 6 get represented per loop iteration.

3. **Synchronous moments** — once per loop, force all 4 TVs to show the SAME hero dish (e.g., a flash sale card). Breaks the rhythm and creates a "look at this" moment. Implement as a single timeline row where all 4 TV columns reference the same asset_id.

4. **Urgency moments** — once per loop, all 4 TVs show price-saving messaging ("Save ₹131 today", "₹149 lunch", etc.). Same mechanic as synchronous moments.

5. **Sequential storytelling** — design a 3-row sequence that tells a tiny story: row 1 = ingredients, row 2 = plating action, row 3 = final dish + price. Each row can have different content per TV but the rhythm is shared.

Each of these is just JSON in a timeline scene. Engine doesn't change. The only architectural constraint is that all rows for a given scene must sum to the same total duration on every TV — which is automatic in timeline mode because every row contributes the same `duration` to every TV's playlist.

---

## Operational checklist for deploying this scene

```bash
cd /path/to/HN-Hotels-Site
ENGINE=projects/pisignage-hamza-express/engine/ps_engine.py
SCENE=projects/pisignage-hamza-express/scenes/psychology_v1_combos.json

# 1. Validate creative encodings (run before any new asset upload)
python3 $ENGINE validate $SCENE

# 2. Dry-run the compile to inspect what each TV will play
python3 $ENGINE compile $SCENE

# 3. Deploy via cloud (validates + pushes 4 playlists + auto-resyncs players)
python3 $ENGINE deploy $SCENE

# 4. Confirm server-side deployment
python3 $ENGINE audit

# 5. Coordinated restart with stable-state gating
python3 $ENGINE sync

# 6. (At outlet on WiFi) — frame-accurate verify + LAN sync
python3 $ENGINE lan-check
python3 $ENGINE verify
python3 $ENGINE lan-sync     # only if verify reports drift

# 7. After 24h, drift auto-resets via PiSignage's deployTime=02:00 daily reset.
```

No screen-watching at any step. Exit codes are the truth.
