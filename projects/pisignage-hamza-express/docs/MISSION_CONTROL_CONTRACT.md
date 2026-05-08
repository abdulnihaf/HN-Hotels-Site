# TV Mission Control · Choreography page — design contract

**Page URL (target):** `https://hamzaexpress.in/ops/tv-mission-control/choreography/`
**Backed by:** PiSignage REST API (live as of 2026-05-07)
**Production state:** all 4 vertical TVs play `psychology_v3_kathi` (5 slots × 10s = 50s loop)

---

## The single variable that drives the fleet: `active_scene`

Everything customer-facing on the 4 vertical TVs is determined by **one server-side selector**: which scene is currently deployed. Owner picks a scene from the page; the system pushes the scene's slot map to all 4 PiSignage playlists and re-deploys the 4 groups simultaneously.

A **scene** is a JSON file that fully specifies the choreography:

```jsonc
{
  "name": "psychology_v3_kathi",
  "loop_seconds": 50,
  "slot_seconds": 10,
  "num_slots": 5,
  "tv_assets": {
    "tv-v1": [
      "Video_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.mp4",
      "Final_v3_TV-V10_GR_AllInOne_C1_C2_C3_C4.png",
      "Video_v3_TV-V6_C6_MuttonBiryani_Kabab.mp4",
      "Final_v3_TV-V7_GR_ProteinPair_C3_C4.png",
      "Final_v3_TV-V2_C1_GheeRice_DalFry.png"
    ],
    "tv-v2": [/* 5 filenames */],
    "tv-v3": [/* 5 filenames */],
    "tv-v4": [/* 5 filenames */]
  },
  "motion_intensity": 8,
  "psychology_notes": "..."
}
```

Scene files live in `projects/pisignage-hamza-express/scenes/`. Today there's one (`psychology_v3_kathi.json`); future scenes go alongside it.

---

## Page contract (what mission-control needs to render and do)

### 1. Active scene selector — **the variable**

```
┌─ Active scene ────────────────────────────┐
│  ⚪ psychology_v3_kathi  (deployed now)   │
│  ⚪ lunch_special                          │
│  ⚪ chai_evening                           │
│  ⚪ kathi_only                             │
│                                            │
│  [Deploy selected scene to fleet]          │
└────────────────────────────────────────────┘
```

Owner picks one. Click "Deploy". System pushes new playlist content to all 4 groups in parallel and force-restarts each PiSignage Player. Takes ~45 seconds end-to-end.

### 2. Live fleet status (read-only)

For each of the 4 vertical TVs:
- Connection state (online/offline based on `lastReported` < 5 min ago)
- Currently-playing playlist name
- Last deployed timestamp (group config `lastDeployed`)
- Disk usage, IP, version
- Sync status if relevant

### 3. Slot grid preview (read-only)

For the active scene, a 5×4 grid showing thumbnail of each asset by slot+TV:

```
            slot 0          slot 1          slot 2          slot 3          slot 4
v1  [V_C3 video] [AllInOne]      [V_C6 video]    [ProteinPair]   [C1 ₹149]
v2  [K1 ₹90]    [V_K1 video]    [KathiPair]     [KT premium]    [V_KT video]
v3  [V_C5 video] [C6 ₹309]      [V_C4 video]    [BiryaniPair]   [VegPair]
v4  [C4 ₹289]   [C5 ₹229]       [C3 SMART]      [V_C1 video]    [V_C2 video]
```

Asset thumbnails come from PiSignage CDN: `/media/_thumbnails/<id>_<filename>` (small preview, public after JWT auth).

### 4. Per-TV recovery actions (only when something's wrong)

- **Restart PiSignage on TV-X** — for stuck players, ADB `am force-stop` + `am start`
- **Re-deploy this group only** — push current scene to one group, useful for re-syncing a single TV
- **Switch to kiosk fallback** — if cross-TV sync becomes critical, flip TV to Fully Kiosk mode (see `KIOSK_FALLBACK_PATH.md`)

---

## API endpoints needed (to build the page)

These are simple Cloudflare Pages Functions that wrap PiSignage's API behind your dashboard auth. None exist yet — they'll be the second iteration after the page UI shell.

| Endpoint | What it does | PiSignage call(s) it makes |
|---|---|---|
| `GET /api/choreo-control/scenes` | List scenes from `scenes/` folder (currently 1) | none — reads JSON from repo |
| `GET /api/choreo-control/active` | Returns currently-deployed scene name + lastDeployed per group | 4× `GET /api/groups/<id>` |
| `GET /api/choreo-control/fleet-status` | Live state of all 4 TVs | 4× `GET /api/players/<id>` |
| `POST /api/choreo-control/deploy` body `{scene: "..."}` | Apply scene to fleet | 4× `POST /api/playlists/<name>` + 4× `POST /api/groups/<id>?deploy=true` |
| `POST /api/choreo-control/restart` body `{tv: "v2"}` | Force-stop + relaunch PiSignage on one TV | ADB-based (requires Hamza WiFi reachability) — alternative: PiSignage `POST /api/playlistmedia/<player>/<action>` |

For deploy, `projects/pisignage-hamza-express/scripts/deploy_choreography.py` is the working reference implementation. Port its logic into a CF Pages Function.

---

## What's hard about adding new scenes (and what's easy)

**Easy** (5 min per scene):

1. Author the scene JSON in `scenes/<name>.json` — pick 5 assets per TV from the existing 21-creative library
2. Verify all referenced filenames are in `registry/assets.json`
3. Run `bash projects/pisignage-hamza-express/scripts/deploy_choreography.py --scene <name>` (after generalising the script)
4. Commit + push

**Hard / requires forethought:**

- **Loop length changes** — every TV must have the same slot count. If you want a 7-slot scene, all 4 TVs must have 7 assets each. The grid must stay rectangular.
- **Motion balance** — the choreographic value comes from how the 4 TVs RELATE to each other at each slot. The "V1+V3 motion together at slots 0 and 2" pattern in `psychology_v3_kathi` was deliberate. New scenes should articulate their motion intensity & beat distribution explicitly (the `_psychology` field in the scene JSON).
- **Asset duration mismatch** — videos may be shorter than 10s. PiSignage will loop within the slot, sometimes with a small visual gap. Aim for assets >10s OR design slots around the natural asset length.
- **Asset orientation** — current source assets are 1920×1080 designed for portrait-rotated TVs (Fire Sticks output landscape, TVs physically rotated). Don't introduce assets at other dimensions without verifying the visual orientation on a test TV first.

---

## Why this is just one variable

PiSignage's natural cross-TV drift (10–30s — players start asynchronously after download) means we don't need synchronization plumbing on the mission-control side. The owner picks a scene, the system pushes content. Each TV plays the scene's per-TV playlist independently. The visual coherence comes from the *design* of the slots (which assets play together), not from frame-perfect timing.

**If frame-perfect cross-TV sync ever becomes required**, the kiosk-mode synchronizer is preserved end-to-end at `KIOSK_FALLBACK_PATH.md` and can be re-activated with one ADB command. The mission-control page should expose a "fleet sync mode" toggle (PiSignage native vs kiosk synchronizer) when that day comes.

---

## State right now (snapshot for the page's "current deployment" panel)

- **Active scene:** `psychology_v3_kathi`
- **Loop:** 5 slots × 10s = 50s
- **Last deployed:** 2026-05-07 13:37 IST (per group `lastDeployed` after restoration to pure 5-slot)
- **Animation:** fade transitions enabled, 250ms
- **Fleet:** V1/V2/V3/V4 all online, PiSignage Player 2 v5.4.2, all four sockets connected
- **Drift mode:** PiSignage-native (10–30s cross-TV phase variance acceptable)

For full per-TV variable dump, see `PISIGNAGE_TRUTH.md` (regenerate with `python3 scripts/pisig_deep_audit.py`).
