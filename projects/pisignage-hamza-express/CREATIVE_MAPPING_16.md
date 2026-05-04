# 16-Creative Deployment Strategy — Attention Rotation Pattern

**Inventory:** 12 statics + 4 videos = 16 total, mapped across 4 vertical TVs.

**Architecture:** Each TV gets **1 video + 3 statics** (4 slots × 10s each = 40s loop).
At any moment, exactly ONE TV is in motion, the other three are still.
The motion rotates clockwise around the wall, orchestrating the customer's gaze through all 4 TVs in 40 seconds.

---

## The attention rotation pattern

```
  TIME WINDOW          V2 (LEFT)      V1 (CENTER)     V3 (RIGHT)      V4 (BAIN MARIE)
  ─────────────────────────────────────────────────────────────────────────────────
  t=0–10s   (slot 0)   STATIC         🎬 VIDEO        STATIC          STATIC
  t=10–20s  (slot 1)   STATIC         STATIC          🎬 VIDEO        STATIC
  t=20–30s  (slot 2)   STATIC         STATIC          STATIC          🎬 VIDEO
  t=30–40s  (slot 3)   🎬 VIDEO       STATIC          STATIC          STATIC
  t=40s → loops back to slot 0
```

**Customer's gaze journey in 40 seconds:** CENTER → RIGHT → COUNTER → LEFT → (CENTER again)

This is not random. It's deliberate orchestration:

1. **Customer enters → eye lands on V1 (center) which is currently the only moving screen.** The video on V1 is the SMART PICK — most-recommended dish. First impression: the dish you want them to buy.
2. **10s later → V3 (right) starts moving.** Premium dish video. Customer's eye drifts right. Now they're seeing the upper price ceiling.
3. **20s later → V4 (bain marie) starts moving.** They're now looking toward the counter — the action zone where ordering happens. Bestseller video plays right where they're about to walk.
4. **30s later → V2 (left) starts moving.** Gaze pulled back to entry side. Value/affordable dish video. Reinforces "we have something at every price."
5. **Loop.** By the time the customer is standing at the counter (~60s after entry), they've been visually pulled to look at every TV, with attention focused on the right one at the right moment.

This beats the 6-combo cyclic stagger we deployed earlier because:

- **Cyclic stagger** keeps all 4 TVs equally "loud" all the time — the customer's gaze wanders. No screen stands out.
- **Attention rotation** makes one TV "loud" and three "quiet" at any moment — the customer's gaze is gently directed where we want it.

---

## The 16 creative slots (specification)

Each TV has 4 slots: 3 STATIC + 1 VIDEO. Each TV's VIDEO appears at a specific slot index so the rotation pattern works.

### TV-V1 (CENTER — Hero / Decision Hub)
**Role:** The dominant gaze position. The dish you want most people to order.

| Slot | Type | Duration | Role | Suggested content |
|------|------|----------|------|-------------------|
| 0 | 🎬 VIDEO | 10s | **HERO** — opens every loop with motion to anchor the customer | The Smart Pick combo (C3 Ghee Rice + Butter Chicken) — cinemagraph |
| 1 | STATIC | 10s | **TRUST** — heritage / quality marker | "Since 1918 · Four generations of Dakhni" with a heritage shot or chef plating |
| 2 | STATIC | 10s | **MENU** — full decision-matrix view | The AllInOne static (4 GheeRice combos C1–C4 in one frame) |
| 3 | STATIC | 10s | **FLAGSHIP** — hero plated of the brand-defining dish | Mutton Biryani plated (or whatever your single most photogenic dish is) |

### TV-V3 (RIGHT — Premium Upsell Anchor)
**Role:** Anchors the price ladder high. Video plays at slot 1 (after V1's video ends).

| Slot | Type | Duration | Role | Suggested content |
|------|------|----------|------|-------------------|
| 0 | STATIC | 10s | **PREMIUM HERO** — most expensive dish, hero shot | Mutton Biryani static (₹309) or Mutton Brain Dry |
| 1 | 🎬 VIDEO | 10s | **DECADENCE** — the most indulgent visual | Mutton Biryani cinemagraph or premium dish video |
| 2 | STATIC | 10s | **UPSELL PAIR** — pair card showing premium options | BiryaniPair (C5 vs C6) with explicit "₹229 / ₹309" |
| 3 | STATIC | 10s | **EXCLUSIVE** — limited / signature dish | Hamza Special / Tandoori Chicken / chef's special with "₹X · since 1918" |

### TV-V4 (BAIN MARIE — At-Counter Decision Trigger)
**Role:** Visible during the order interaction. Video plays at slot 2 (when customer is closest to counter).

| Slot | Type | Duration | Role | Suggested content |
|------|------|----------|------|-------------------|
| 0 | STATIC | 10s | **DECISION** — bestseller, top-selling SKU | Chicken Biryani static (₹229) — top-selling protein |
| 1 | STATIC | 10s | **URGENCY** — offer / limited-time / daypart | "Office Lunch Power · Plate + Drink ₹249" or daypart special |
| 2 | 🎬 VIDEO | 10s | **CRAVE** — most appetizing motion to trigger order | Chicken Biryani cinemagraph or Kabab grill video |
| 3 | STATIC | 10s | **COMPLEMENT** — drink/dessert/side upsell | Cold drink + biryani combo, or Sulaimani chai add-on |

### TV-V2 (LEFT — Friendly Entry / Value Anchor)
**Role:** First impression for entering customers. Video plays at slot 3 (closes the loop with motion before restarting).

| Slot | Type | Duration | Role | Suggested content |
|------|------|----------|------|-------------------|
| 0 | STATIC | 10s | **SAFE ENTRY** — cheapest, universally appealing | C1 Ghee Rice + Dal Fry static (₹149) |
| 1 | STATIC | 10s | **VARIETY** — show another option in same range | C2 Ghee Rice + Dal Fry + Kabab (₹199) — "₹50 more, get protein" |
| 2 | STATIC | 10s | **VALUE PROOF** — pair card showing savings explicitly | VegPair (C1 vs C2) with "Save ₹81" callout |
| 3 | 🎬 VIDEO | 10s | **SIGNATURE ENTRY** — visual that stops a passing-by gaze | Ghee Rice ghee-pour cinemagraph (the "wow" visual moment) |

---

## What I need you to upload (16 files total)

### 12 STATICS (one per slot above)

| File slot | TV | Slot | Filename suggestion (you pick the actual) |
|-----------|----|----|-----------------------------------------|
| S1 | V1 | 1 | `Static_v4_V1_S1_Heritage.png` (1080×1920) |
| S2 | V1 | 2 | `Static_v4_V1_S2_AllInOne_C1_C2_C3_C4.png` (= existing WIP file `Final_v3_TV-V10_GR_AllInOne_C1_C2_C3_C4.png`) |
| S3 | V1 | 3 | `Static_v4_V1_S3_FlagshipHero.png` |
| S4 | V3 | 0 | `Static_v4_V3_S0_PremiumHero.png` (existing `Final_v3_TV-V6_C6_MuttonBiryani_Kabab.png` works) |
| S5 | V3 | 2 | `Static_v4_V3_S2_BiryaniPair_C5_C6.png` (= existing WIP `Final_v3_TV-V9_Biryani_Pair_C5_C6.png`) |
| S6 | V3 | 3 | `Static_v4_V3_S3_Exclusive.png` |
| S7 | V4 | 0 | `Static_v4_V4_S0_Bestseller.png` (existing `Final_v3_TV-V5_C5_ChickenBiryani_Kabab.png` works) |
| S8 | V4 | 1 | `Static_v4_V4_S1_OfferUrgency.png` |
| S9 | V4 | 3 | `Static_v4_V4_S3_Complement.png` |
| S10 | V2 | 0 | `Static_v4_V2_S0_SafeEntry.png` (existing `Final_v3_TV-V2_C1_GheeRice_DalFry.png` works) |
| S11 | V2 | 1 | `Static_v4_V2_S1_Variety.png` (existing `Final_v3_TV-V1_C2_GheeRice_DalFry_Kabab.png` works) |
| S12 | V2 | 2 | `Static_v4_V2_S2_VegPair_C1_C2.png` (= existing WIP `Final_v3_TV-V8_GR_VegPair_C1_C2.png`) |

### 4 VIDEOS (one per TV, at specific slot positions)

| File slot | TV | Slot | Filename suggestion |
|-----------|----|----|--------------------|
| Vid1 | V1 | 0 | `Video_v4_V1_S0_SmartPickHero.mp4` (existing `Video_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.mp4` works) |
| Vid2 | V3 | 1 | `Video_v4_V3_S1_PremiumDecadence.mp4` (existing `Video_v3_TV-V6_C6_MuttonBiryani_Kabab.mp4` works) |
| Vid3 | V4 | 2 | `Video_v4_V4_S2_BestSellerCrave.mp4` (existing `Video_v3_TV-V5_C5_ChickenBiryani_Kabab.mp4` works) |
| Vid4 | V2 | 3 | `Video_v4_V2_S3_SignatureEntry.mp4` (existing `Video_v3_TV-V2_C1_GheeRice_DalFry.mp4` works) |

---

## What's already uploaded vs what you need to create

**Already in PiSignage library (12 files):**
- 6 single-combo statics (C1–C6) → can be reused for some slots
- 6 single-combo videos (C1–C6) → 4 will be reused as the V1/V2/V3/V4 videos; the other 2 (C2 + C4 single-combos) will not be deployed in this scene

**Need to create + upload (4 new statics minimum):**
- `Static_v4_V1_S1_Heritage.png` — heritage trust frame
- `Static_v4_V3_S3_Exclusive.png` — premium signature dish
- `Static_v4_V4_S1_OfferUrgency.png` — daypart offer card
- `Static_v4_V4_S3_Complement.png` — drink/side upsell

**Already produced as WIP at mission control, just need upload (3 files):**
- `Final_v3_TV-V10_GR_AllInOne_C1_C2_C3_C4.png` → use for V1 slot 2
- `Final_v3_TV-V9_Biryani_Pair_C5_C6.png` → use for V3 slot 2
- `Final_v3_TV-V8_GR_VegPair_C1_C2.png` → use for V2 slot 2

---

## Why each slot is what it is (psychology rationale)

**V1 starts with a video** — the central screen catches the customer's attention first; motion grabs the eye before they've fully entered. The Smart Pick is what we want them to remember.

**V1's static slots are TRUST → MENU → FLAGSHIP** — after the hero video, we shift to brand trust (1918 heritage), then full menu view (decision matrix), then a flagship plated shot. This sequence walks the customer through the cognitive stages: emotional connection → rational evaluation → aspirational close.

**V3 video at slot 1** — by the time V3 starts moving, the customer has noticed V1's video and may be looking past V3 to V1. V3's video at slot 1 catches them as they scan right.

**V4 video at slot 2** — this is the moment the customer is closest to the counter. The crave video (food in motion) is the trigger that makes "I'll order that" feel inevitable.

**V2 video at slot 3** — V2 closes the loop. After 30 seconds of attention being elsewhere, V2's video pulls the eye back to the left side, then the loop restarts on V1. This creates a "wave" sensation — the entire wall feels alive.

**No two TVs share a creative.** Every screen has unique content. Total visual variety with zero repetition.

**The price ladder is permanently visible.** At any moment:
- V2 is in the ₹149–₹199 range (its 3 statics)
- V1 is mid-to-premium (₹249 Smart Pick + flagship)
- V3 is premium (₹309 Mutton Biryani)
- V4 is the bestseller + offer
The customer's eye picks up the ladder regardless of where it's looking.

---

## After you upload, the deployment is one command

Once the 16 files are in PiSignage (under exactly the filenames you choose), you give me the filename list and I:
1. Update `registry/assets.json` with the 16 entries
2. Generate `scenes/psychology_v2_16creatives.json` with the timeline-mode scene
3. Run `python3 ps_engine.py validate scenes/psychology_v2_16creatives.json`
4. Run `python3 ps_engine.py deploy scenes/psychology_v2_16creatives.json`
5. Run `python3 ps_engine.py sync`

The scene file is already 90% designed. Just needs the actual filenames slotted in. No re-architecture.

---

## Future scaling path

When you go from 16 → 32 → 50 creatives, the pattern stays the same:

- **More creatives per TV** = longer loops with more slots per TV. E.g., 8 creatives per TV (6 statics + 2 videos) = 80s loop with motion rotation every 10s — more variety, same psychology.
- **More TVs (V5, V6 install)** = more columns in the timeline. Each new TV gets its own role and motion-slot index. The rotation pattern extends naturally (motion now rotates through 6 TVs over 60s).
- **Daypart variation** = different scenes for breakfast / lunch rush / iftar / dinner. Cron triggers `python3 ps_engine.py deploy <scene>` at meal-time boundaries.

The architecture doesn't change. The strategy framework doesn't change. Only the creative library and the scene JSON change.
