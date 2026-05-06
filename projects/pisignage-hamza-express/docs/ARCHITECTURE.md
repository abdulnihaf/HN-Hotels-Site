# PiSignage Fleet — Operating Architecture

**Status:** Active as of 2026-05-06
**Outlets covered:** Hamza Express (HE) — 6 Fire TV Stick screens

## Two layers, sharply separated

| Layer | When you touch it | What lives there |
|---|---|---|
| **ADB / device-level** | One time, per device | Bootstrap settings on a freshly-installed Fire Stick. Burned into Android's `settings.db`. After bootstrap, never run again unless settings drift. |
| **PiSignage-native** | All ongoing operations | Daily reboot, sync, content updates, health checks, recovery. Driven by PiSignage's own API. Works from anywhere — no LAN access, no laptop on Hamza WiFi. |

If you find yourself reaching for ADB during normal operations, **something is wrong with the architecture, not with the fleet.** Fix the architecture instead.

## Layer 1 — ADB bootstrap (one time per Fire Stick)

When a new Fire Stick joins the fleet, or after a Fire OS factory reset:

```bash
bash projects/pisignage-hamza-express/scripts/adb_no_sleep_all.sh
```

This writes the following to Android's `settings.db` (persists across reboots forever):

| Setting | Value | Why |
|---|---|---|
| `screen_off_timeout` | `2147483647` | Screen never sleeps |
| `stay_on_while_plugged_in` | `3` | Stay awake on AC + USB |
| `screensaver_enabled` | `0` | No Daydream interrupting playback |
| `wifi_sleep_policy` | `2` | WiFi never sleeps — keeps PiSignage downloads flowing |
| `wifi_enhanced_auto_join` | `0` | Disable aggressive WiFi power-save |
| `development_settings_enabled` | `1` | Developer Options stays on |
| `adb_enabled` | `1` | ADB-over-TCP persists across reboots |
| `adaptive_sleep` | `0` | Fire OS 9 adaptive-sleep off |

After this runs successfully, **the device is bootstrapped forever**. Verify in 24h that the values stuck (`adb shell settings get …`); if so, never run the script again.

## Layer 2 — PiSignage-native ongoing ops

### A. Daily fleet sync — automatic

Every PiSignage **group** in this account is configured for `reboot.enable=true` at `06:45` IST:

```python
python3 projects/pisignage-hamza-express/scripts/pisignage_enable_daily_reboot.py
```

Run once; configuration lives in PiSignage server forever. Each morning at 06:45:

1. PiSignage tells the player to reboot Fire OS
2. Fire OS reboots (~30s)
3. PiSignage app auto-starts (Android default app behavior)
4. App fetches latest playlist + assets
5. All 6 screens begin asset[0] within seconds of each other

By the time the outlet opens at 7am, the fleet is in sync. **No human action, no laptop, no ADB.**

### B. Health check — anytime, anywhere

```bash
python3 projects/pisignage-hamza-express/scripts/pisignage_health_check.py        # all TVs
python3 projects/pisignage-hamza-express/scripts/pisignage_health_check.py tv-v2  # one TV
```

Reads PiSignage's player status API (no LAN access needed). Per TV, verifies:

- `online`             — `isConnected=true`
- `fresh<5min`         — last heartbeat is recent
- `group_id` / `group_name` — player is assigned to the expected group from `registry/fleet.json`
- `playlist`           — currently playing the expected playlist
- `tvOn`               — TV is powered on (where CEC supported)
- `playlistOn`         — playback is actually running

Exit code `0` = all green; `1` = at least one failure. Wire into a cron / scheduled task / phone shortcut if desired.

### C. Content updates

Always via PiSignage API (`engine/ps_engine.py` — `_push_deploy_to_group`). Never via ADB.

### D. Recovery from corruption (V2-style breakage)

If a player gets into a bad state:

1. Inspect with `pisignage_health_check.py <tv-id>` — see what's drifting
2. If CDN folder is broken: create a new group, deploy the playlist fresh, reassign player to new group (all via PiSignage API)
3. PiSignage's clean re-sync handles the rest

ADB `pm clear` is only needed if the **app itself** is in a hard crash loop and won't pick up the new group assignment — a rare edge case, not a routine recovery.

## Layer 1.5 — ADB emergency-only scripts

These scripts exist for **escalation when PiSignage-native fails**:

| Script | When to use |
|---|---|
| `adb_sync_restart.sh` | PiSignage 06:45 reboot didn't fire on a TV; force resync mid-day |
| `adb_screenshot_all.sh` | Visual debugging when API status is misleading |
| `adb_verify_sync.sh` | Verify timeline alignment to the millisecond |

Document in any ticket if you reach for these. If a recurring issue forces repeated ADB use, that's a signal the PiSignage layer is missing something — fix the layer, don't paper over with ADB.

## Registry — single source of truth

`registry/fleet.json` maps each `tv-id` to its PiSignage IDs and ADB IP. **PiSignage is the truth-source for IPs** (it learns DHCP changes automatically). When ADB fails to reach a TV, run `pisignage_health_check.py` first — it will report the actual current IP from PiSignage.

`registry/assets.json` maps logical asset IDs to PiSignage filenames. Update when uploading new creatives.

## What to do daily

**Owner side:** nothing. Outlet opens at 7am with TVs already synced.

**Optional verification:** run `pisignage_health_check.py` once a day from anywhere (phone, laptop, anywhere with internet). If all green, fleet is healthy.

**When deploying new content:** use `engine/ps_engine.py` to push to PiSignage, then run `pisignage_health_check.py` to confirm players picked it up.
