# Scene Authoring — PiSignage Hamza Express

Two scene modes. Pick based on what you're trying to control.

## Mode 1 — `conveyance`  (legacy / simple)

**Use when:** all TVs play the same set of "conveyances" (groups of related creatives) in different orders. Stagger patterns, loop-offset choreographies.

**Schema:**

```json
{
  "name": "...",
  "mode": "conveyance",
  "conveyances": {
    "c1_dish_a": [
      {"asset_id": "...", "duration": 8},
      {"asset_id": "...", "duration": 10}
    ]
  },
  "screens": {
    "tv-v1": {"conveyance_order": ["c1_dish_a", "c2_dish_b", ...]},
    "tv-v2": {"conveyance_order": ["c2_dish_b", "c1_dish_a", ...]}
  }
}
```

**Strengths:** compact when all TVs share content. Easy to express "shift by N slots".
**Weakness:** can't easily express "TV1 plays X while TV2 plays totally unrelated Y at the same moment".

## Mode 2 — `timeline`  (preferred for complex choreography)

**Use when:** you need exact per-moment control — "at moment 4, V1 plays the dish hero, V2 plays the price reveal, V3 plays the brand pulse, V4 plays an upsell."

**Schema:**

```json
{
  "name": "...",
  "mode": "timeline",
  "screens": ["tv-v1", "tv-v2", "tv-v3", "tv-v4"],
  "timeline": [
    {"duration": 8,  "tv-v1": "asset_id_1", "tv-v2": "asset_id_2", "tv-v3": "asset_id_3", "tv-v4": "asset_id_4"},
    {"duration": 10, "tv-v1": "asset_id_5", "tv-v2": "asset_id_6", "tv-v3": "asset_id_7", "tv-v4": "asset_id_8"},
    ...
  ]
}
```

**Each row** = one synchronized moment. Every TV cuts to its column's asset at the same instant.
**Adding TVs** = add a column (`tv-v5`, `tv-v6`...).
**Adding moments** = add a row.
**Adding creatives** = drop them in `registry/assets.json`, reference by `asset_id` from any row.

**Why this is the right format for "frame-by-frame consumer psychology":**

- A row is a moment. You can plan the moment as a unit ("at this moment the customer sees price + product + emotion").
- Rows compose freely. Yesterday's 12-row scene becomes tomorrow's 200-row scene by appending — no architectural change.
- Timing contract is automatic: every TV gets the same row durations → every TV has the same total loop length → simultaneous transitions on every row.

## Creative encoding rules (HARD requirements)

These are enforced by `python3 ps_engine.py validate <scene.json>`. Scenes that violate them won't deploy.

| Rule | Why |
|---|---|
| **Integer-second duration** (±50ms tolerance) | Player playlist durations are integers; sub-second slack accumulates as drift across loops |
| **H.264 codec** for video | Fire TV decoder is most consistent on H.264; HEVC and AV1 have variable warm-up time |
| **Portrait creatives must be 1080×1920** | PiSignage rotates in-app; resolution mismatch triggers software resize → variable jitter |
| **Landscape creatives must be 1920×1080** | Same reason, native Fire TV output resolution |
| **No fade-in / fade-out at clip boundaries** | Boundary fades make "when did the cut happen" ambiguous to the eye → kills perceived sync |
| **Same encoder settings across all clips in a scene** | GOP + keyframe interval drift causes decoder warm-up jitter |

## Authoring workflow

```bash
# 1. Drop new creatives in projects/pisignage-hamza-express/creatives/
# 2. Add entries to registry/assets.json with pisignage_filename + orientation
# 3. Author the scene (conveyance or timeline)
# 4. Validate before doing anything else:
python3 ps_engine.py validate scenes/your_scene.json

# 5. Dry-run compile to see exactly what each TV will play:
python3 ps_engine.py compile scenes/your_scene.json

# 6. Upload any new creatives to PiSignage:
python3 ps_engine.py upload creatives/your_new_file.png

# 7. Deploy:
python3 ps_engine.py deploy scenes/your_scene.json

# 8. Confirm with the cloud audit:
python3 ps_engine.py audit

# 9. Coordinated restart, gated on stable state:
python3 ps_engine.py sync

# 10. Frame-accurate verify (only when on outlet WiFi — see SYNC.md):
python3 ps_engine.py verify
```

## Scaling to 50+ creatives

Nothing in the architecture changes. Some practical advice:

- **Group creatives by intent** in `registry/assets.json` using `tags`. Lets you generate scenes programmatically (`all assets tagged "lunch_rush"`) instead of typing 200 asset_ids.
- **Use timeline mode**. Conveyance mode gets unwieldy past ~15 conveyances.
- **Keep one scene file per *campaign* / *daypart* / *menu*.** Don't put everything in one file.
- **Author scenes in code if rows > 50.** Generate the JSON from a small Python script that takes (creatives, choreography rules) → scene JSON. The engine doesn't care if a human or a script wrote the file.
