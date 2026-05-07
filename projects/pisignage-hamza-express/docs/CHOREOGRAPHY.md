# HE TV Choreography — operating guide

Source of truth for the cross-TV choreography running on the 4 vertical TVs at Hamza Express. Living document — update when scene, assets, or fleet change.

**Public reference:** mirror this content on `hamzaexpress.in/ops/tv-mission-control/choreography/` for owner-facing visibility.

---

## 1. The fleet — what hardware runs the choreography

| TV id | Position | Orientation | IP | Role in choreography |
|---|---|---|---|---|
| `v1` | COMBOS · center customer wall | portrait | 192.168.31.113 | Hero TV — "smart pick" + AllInOne menu + premium motion |
| `v2` | KATHI · left customer wall | portrait | 192.168.31.81 | Kathi-exclusive (K1, KT, KathiPair) |
| `v3` | SHAWARMA · right customer wall | portrait | 192.168.31.135 | Biryani / Mutton motion + multi-combo cards |
| `v4` | SHEEK · Bain Marie | portrait | 192.168.31.164 | Anchor combos + dal/kabab motion at counter |

**Hardware:** Marq LED Smart TV 43" HD (display) + Amazon Fire TV Stick (model AFTSS, Fire OS 9, SDK 28).

**Two horizontal TVs** (`tv-h1` Kitchen Pass · `tv-h2` Outdoor Façade) run different content and are NOT part of the customer-wall choreography.

---

## 2. The current scene — `psychology_v3_kathi`

Loop: **5 slots × 10 seconds = 50 seconds**. Repeats indefinitely.

### Slot grid (what each TV plays at each beat)

| Slot | Time | V1 (combos) | V2 (kathi) | V3 (shawarma) | V4 (bain marie) | Motion |
|---|---|---|---|---|---|---|
| 0 | 0–10s | **V_C3 video** Ghee Rice + Butter Chicken + Kabab cinemagraph | K1 ₹90 static (Chicken Kathi anchor) | **V_C5 video** Chicken Biryani + Kabab cinemagraph | C4 ₹289 static (Mutton Chatpata) | V1 + V3 |
| 1 | 10–20s | AllInOne static (4 Ghee Rice combos) | **V_K1 video** Chicken Kathi cinemagraph | C6 ₹309 static (Mutton Biryani) | C5 ₹229 static (Chicken Biryani) | V2 |
| 2 | 20–30s | **V_C6 video** Mutton Biryani + Kabab cinemagraph | KathiPair static (K1 ₹90 vs KT premium) | **V_C4 video** Mutton Chatpata + Kabab cinemagraph | C3 SMART static (Butter Chicken ₹249) | V1 + V3 |
| 3 | 30–40s | ProteinPair static (C3 vs C4 comparison) | KT static (Chicken Tikka Kathi premium) | BiryaniPair static (C5 vs C6 comparison) | **V_C1 video** Ghee Rice + Dal Fry cinemagraph | V4 |
| 4 | 40–50s | C1 ₹149 static (Ghee Rice + Dal Fry) | **V_KT video** Chicken Tikka Kathi cinemagraph | VegPair static (C1 vs C2 comparison) | **V_C2 video** Ghee Rice + Dal Fry + Kabab cinemagraph | V2 + V4 |

**Cross-TV motion design:** at any moment, one or two TVs are in motion (cinemagraphs) while the others show static cards. The eye is drawn from one motion source to the next as the loop progresses, creating a directed "story" rather than a static menu wall.

**Total assets in active rotation:** 20 of 21 v3 creatives. The 21st (`c2_ghee_dal_kabab_static_v3`) is reserved for daypart scenes.

---

## 3. How synchronization actually works

Each TV runs **Fully Kiosk Browser** (sideloaded APK) pointed at `https://hnhotels.in/choreo/?tv=<v1|v2|v3|v4>`. The page is a custom synchronizer hosted on Cloudflare Pages.

### Boot sequence (~5–8s per TV)

1. **Master clock sync** — JS calls `/api/choreo/time` 5 times, picks the sample with smallest RTT, computes offset = `server_now − local_now`.
2. **Asset preload** — all 5 image/video elements created with `preload="auto"`. Page blocks until every image fires `load` and every video fires `canplaythrough` (with 30s timeout per asset).
3. **Decoder warm-up** — first slot's video calls `play()` so Chromium's H264 decoder allocates and starts buffering frames.
4. **Tick loop start** — every 100ms, compute `slot = floor((Date.now() + offset) % 50000 / 10000)`.

### Steady-state (after boot)

Every 100ms tick:
- Compute current slot from master-corrected wall-clock.
- If slot changed → toggle CSS `.live` class (250ms opacity crossfade). New slot's video gets `play()`.
- If `phase > 8.5s` → pre-roll the NEXT slot's video so its decoder is warm before transition.
- Pause any video that's neither current nor pre-rolling (keeps simultaneous decode at ≤2 streams — Fire Stick can't handle more reliably).

Every 60s: re-sync master clock (5-sample best-RTT).
Every 60min: rebuild stage with fresh proxy URLs (hides any JWT rotation behind the scenes).

### Asset delivery

- TV → `https://hnhotels.in/api/choreo/asset?f=<filename>` (Cloudflare Pages Function)
- CF Function fetches JWT from `/api/choreo/jwt` (in-memory + KV cached, refreshed via PiSignage email/password secrets)
- CF Function calls `https://hamzaexpress.pisignage.com/media/hamzaexpress/<filename>` with `x-access-token` header
- Streams response back to TV with `Cache-Control: public, max-age=86400, immutable`

### Achieved precision

| Metric | Value |
|---|---|
| Cross-TV slot alignment | <100ms when network is stable |
| Master-clock RTT (typical) | 60–280ms over Hamza WiFi |
| Time-offset accuracy | ±150ms after 5-sample correction |
| Slot-transition fade | 250ms CSS opacity crossfade |

---

## 4. Possibilities — what we can change without reworking the architecture

### Easy (edit one or two files, push to main, reload TVs)

- **Swap assets within existing slots** — change `CHOREO[tv][slot]` filename in `choreo/index.html`. Asset must already exist in PiSignage library and be added to the whitelist in `functions/api/choreo/asset.js`.
- **Reorder slots** — reorder array entries in `CHOREO[tv]`. Loop length stays 50s.
- **Change loop length** — edit `LOOP_MS` and `SLOT_MS` constants. All TVs pick up the change on reload.
- **Add/remove a slot** — edit `NUM_SLOTS`, every `CHOREO[tv]` array, and recompute `LOOP_MS`. Each TV's array must match `NUM_SLOTS`.
- **Reload one TV manually** — `bash projects/pisignage-hamza-express/scripts/switch_mode.sh choreo v2`.
- **Switch any TV back to PiSignage Player 2** — `bash projects/pisignage-hamza-express/scripts/switch_mode.sh pisig v3` (both apps remain installed; this just flips foreground).
- **Inspect what each TV is showing** — `bash projects/pisignage-hamza-express/scripts/switch_mode.sh status`.

### Medium (one new feature)

- **New asset upload** — PiSignage server upload endpoint timed out for me 3+ times. Either (a) work around with the `/api/links` endpoint (untried) or (b) ask PiSignage support to investigate.
- **Daypart-specific scenes** — load `?scene=lunch` query param, serve different `CHOREO` map per scene. Schedule in JS based on IST hour.
- **Per-TV custom loop length** — currently all 4 share 50s. Could give each TV a different `LOOP_MS` (kills cross-TV sync but enables per-TV pacing).
- **Audio synchronization** — each TV could play its own audio track muted-and-synced to the slot. Currently all videos `muted=true` (Fire Stick speakers can't drive ambient audio anyway).
- **Non-uniform slot durations** — instead of 5×10s, do `[5, 10, 15, 5, 15]`. Edit `slotMs(slot)` lookup.

### Hard (real engineering work)

- **More than 4 TVs** — add new `tv-id`, allocate unique `CHOREO[tv]` array, sideload Fully Kiosk on the device, update `switch_mode.sh` and the TV registry. Cross-TV choreography design becomes harder past 4 (visual relationships are 2D — eye-line geometry matters).
- **Sub-50ms cross-TV alignment** — current limit is network RTT jitter. To do better, we'd need NTP-style multi-sample clock alignment or a master beacon broadcasting tick over LAN.
- **Different content per TV pair** — would require multiple `CHOREO` namespaces (one per "zone" of the restaurant).
- **Scheduled choreography swaps** — synchronizer doesn't currently respect a schedule. Could add `/api/choreo/active-scene` that returns scene name based on IST time + day.

---

## 5. Limitations — what we can NOT do (or what costs disproportionately)

| Limitation | Why | Cost to fix |
|---|---|---|
| Sub-second cross-TV sync absolute (frame-accurate) | Fire Stick's H264 decoder is a hardware shared resource; play/pause has tens of ms jitter. Plus network RTT is 60-280ms variable. | Custom NTP client + frame-locked playback would need a master Pi. ~1 week build. |
| 5+ simultaneous H264 video streams | AFTSS hardware decoder budget is ~2 simultaneous 1080p H264 streams. Crossing this caused V2's Fully Kiosk to crash back to wizard during testing. | Use lighter codecs (VP9 software decoded) or fewer videos. Fundamentally hardware-bound. |
| Direct PiSignage CDN access from TVs | Jio's WiFi was suspected to block AWS, but actually blocks ICMP only — TCP/443 to pisignage.com works. The asset proxy via Cloudflare exists for OTHER reasons (single point of JWT control, caching, rate-limit shielding). | None — both paths work today. |
| Auto-launch on Fire OS reboot | PiSignage Player 2 has the capability but requires "Display Over Other Apps" permission (manual). Fully Kiosk has cleaner kiosk-mode + boot launch. | Manual one-time permission grant per TV, or use Fully Kiosk's built-in kiosk-mode lock. |
| Editing playlists from non-laptop devices | Currently all changes require editing `choreo/index.html` and `git push`. Owner can't change choreography from a phone. | Build a small dashboard at `hnhotels.in/ops/tv-mission-control/` that POSTs scene config to a CF KV key the synchronizer reads. ~3–4 hours. |
| Internet-out resilience | When the restaurant's internet drops (e.g. Jio billing issue), TVs eventually fail to refresh JWT and assets stop loading. They keep playing the last cached state until the WebView restarts. | Service worker caching all assets locally would survive longer. ~2 hours. |
| TV hardware uniformity | All 4 are AFTSS, but production batches differ — V4 (Bain Marie) consistently shows higher RTT than V1/V2/V3. Could be the WiFi access point's range to that position. | Move WiFi mesh point closer to Bain Marie, or run Ethernet to V4 (impractical at restaurant). |
| Fire OS captive-portal hijacks | When Jio's billing portal intercepts a `generate_204` check, Fire OS's `com.amazon.cpl` activity grabs foreground over Fully Kiosk, and the choreography goes dark. | Disable captive-portal detection: `adb shell settings put global captive_portal_mode 0` (one-time per TV — should add to bootstrap script). |

---

## 6. The "no white flash" video pre-roll mechanism

This is fragile and worth understanding so future edits don't break it.

**The bug we hit (May 7 2026):** V1's slot 2 (V_C6 mutton biryani video) showed a 250ms white flash mid-slot. Logcat: `chromium: UpdateEffectiveFramesQueued AWV - Video renderer video frame queue is empty!`

**Root cause:** when the previous slot ended, the synchronizer paused the previous video and called `play()` on the new slot's video. Chromium's H264 decoder needs ~tens of ms to allocate and decode the first frame, during which the `<video>` element renders white (browser default).

**The fix that DIDN'T work:** keep all 5 videos always playing in the background (opacity:0). Caused V2's Fully Kiosk to crash because AFTSS can't simultaneously decode 5 H264 streams.

**The fix that works:** pre-roll. In the LAST 1.5 seconds of the current slot, start playing the NEXT slot's video. Decoder warms up while invisible. At slot-transition instant, opacity:0 → opacity:1 — first frame is already decoded, no white flash. Inactive videos get `pause()` so we never have more than 2 simultaneous decoders.

**Don't change without testing all transitions:**
- Slot 0 → 1 (V1's V_C3 video → AllInOne PNG): no video pre-roll needed
- Slot 1 → 2 (V1: PNG → V_C6 video): pre-roll critical
- Slot 2 → 3 (V1: V_C6 video → ProteinPair PNG): pause V_C6 cleanly
- Slot 3 → 4 (V1: PNG → C1 PNG): no video pre-roll
- Slot 4 → 0 (V1: C1 PNG → V_C3 video, looping): pre-roll critical AND wraps loop boundary

The pre-roll trigger uses `nextSlot = (slot + 1) % NUM_SLOTS` so wraparound is handled.

---

## 7. Operating procedures

### Owner daily check — "is it working?"

1. Walk past the customer wall — all 4 TVs showing food content, transitioning smoothly.
2. If a TV is dark/wizard/launcher, log the laptop into Hamza WiFi and run:
   ```
   bash projects/pisignage-hamza-express/scripts/switch_mode.sh status
   bash projects/pisignage-hamza-express/scripts/switch_mode.sh choreo
   ```

### After deploying a content change

1. Edit `choreo/index.html` (`CHOREO[tv][slot]` filenames) and/or upload new asset to PiSignage library.
2. If new asset: add filename to `ALLOWED` set in `functions/api/choreo/asset.js`.
3. Commit + push to `main`. Cloudflare Pages auto-deploys in ~30–60s.
4. Reload TVs: `bash switch_mode.sh choreo`.
5. Verify: `python3 audit_choreo.py` (records 30 sweeps × 4 TVs of screencaps).

### When an audit shows transition frames or white flashes

1. Check Fire Stick logcat for `chromium:` errors, `OOM`, or `Permission denied`.
2. Check WiFi RSSI — `adb shell dumpsys wifi | grep RSSI` — anything weaker than -65 dBm degrades buffer reliability.
3. If a TV's PiSignage Player 2 app reports "Permission denied", re-grant: `adb shell pm grant com.pisignage.player2 android.permission.WRITE_EXTERNAL_STORAGE`.

### Disaster recovery — TV stuck on Fire TV launcher / wizard / captive portal

```bash
# Stop everything that might be in foreground
adb -s <ip>:5555 shell am force-stop com.amazon.cpl
adb -s <ip>:5555 shell am force-stop com.amazon.tv.launcher

# Re-deploy the synchronizer
bash projects/pisignage-hamza-express/scripts/switch_mode.sh choreo <vN>

# Or re-sideload Fully Kiosk if it's broken
bash projects/pisignage-hamza-express/scripts/sideload_fully_kiosk.sh <vN>
```

---

## 8. Files map (where each piece of the system lives)

| Concern | File | Notes |
|---|---|---|
| Choreography slots, asset filenames per TV | `choreo/index.html` (`CHOREO` const) | Single source of truth for what plays where |
| Master clock endpoint | `functions/api/choreo/time.js` | Just returns `Date.now()` server-side |
| JWT cache + refresh | `functions/api/choreo/jwt.js` | KV-backed, 5min refresh margin, graceful 429 fallback |
| Asset proxy (Cloudflare → PiSignage CDN) | `functions/api/choreo/asset.js` | Whitelist-gated; auto-refreshes JWT on 401 |
| Asset registry (filenames + metadata) | `projects/pisignage-hamza-express/registry/assets.json` | Maps logical asset_id → PiSignage filename |
| Fleet registry (TV → IP, group, etc.) | `projects/pisignage-hamza-express/registry/fleet.json` | Hardware truth for IPs and PiSignage IDs |
| Scene definition (this scene) | `projects/pisignage-hamza-express/scenes/psychology_v3_kathi.json` | Authoritative slot map; mirrors `CHOREO` in index.html |
| Sideload script | `projects/pisignage-hamza-express/scripts/sideload_fully_kiosk.sh` | One-time per device |
| Mode-switching script | `projects/pisignage-hamza-express/scripts/switch_mode.sh` | Toggle TVs between choreo/pisig |
| Audit script | `audit_choreo.py` (in `/tmp` for now — TODO: move to `scripts/`) | 30-sweep × 4-TV screencap loop |
| This document | `projects/pisignage-hamza-express/docs/CHOREOGRAPHY.md` | Operating reference |

---

## 9. Future scenes (for reference when adding new ones)

The `scenes/` directory holds JSON files for each named scene. To switch the live scene:

1. Create new scene JSON, e.g., `scenes/dinner_special.json`, with the same structure as `psychology_v3_kathi.json`.
2. Add corresponding `CHOREO` map in `choreo/index.html`. (Future: dynamic scene loading from JSON via fetch, indexed by `?scene=...` query param.)
3. Update this document's slot grid table.
4. Test on V1 only first (`switch_mode choreo v1`), verify no flashes/regressions, then roll out to V2/V3/V4.

Naming convention: `<concept>_<variant>.json` (e.g., `psychology_v3_kathi`, `dinner_premium`, `breakfast_chai`).

Each scene file should record its **inventory budget** (how many of the 21 active creatives it uses), its **motion intensity** (motions per loop), and which TVs gain/lose role weight versus the previous scene. See the existing `_psychology` block in `psychology_v3_kathi.json` for the format.
