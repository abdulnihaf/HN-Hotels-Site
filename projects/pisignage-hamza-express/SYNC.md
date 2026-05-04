# Sync Architecture — How Tight Can We Get and Why

## TL;DR

- **Microsecond sync is impossible** on Fire TV Sticks. Don't chase it.
- **Frame-accurate sync (~30–80ms drift)** is achievable and indistinguishable from microsecond sync to a human eye.
- **The path:** integer-second creatives + same loop duration + LAN-direct seek + daily 02:00 reset.

## Drift sources and their floors

Sync is a chain. The weakest link sets the floor.

| Source | Floor | Layer | Mitigation |
|---|---|---|---|
| WiFi packet jitter | 5–20ms | Network | Use LAN seek (port 8000), not cloud API, when at outlet |
| Android CPU scheduling | 5–15ms | OS | Cannot fix; Android 9 is not real-time |
| Hardware H.264 decoder warm-up | 30–100ms | Silicon | Pre-roll buffering (PiSignage v5.x preloads next asset) |
| 60Hz display refresh phase | 0–17ms | Display | Cannot fix; TVs aren't genlocked |
| WebView/Cordova render loop | 8–16ms | App | Cannot fix without forking PiSignage Player |
| NTP / clock drift | 1–10ms/hour | Time | Daily 02:00 deploy resets accumulated phase drift |
| Animation transitions | 500–800ms (variable!) | App config | **Disabled.** `animationEnable=false` on all groups |

Realistic floor with everything tuned: **~30ms**, dominated by hardware decoder warm-up.

## What microsecond sync would require

True µs-accurate sync needs **genlock** — a hardware sync signal that all displays receive and obey:
- SDI black-burst (broadcast TV)
- IEEE-1588 PTP (industrial)
- LTC timecode (film/post)

Fire TV Sticks support **none** of these. There is no software path that beats the silicon.

## The current architecture (cloud-only mode)

When *not* at the outlet, we work via PiSignage's cloud API. Limits:

1. Cloud API has no playback-position read. We can confirm "this player is on this playlist" but not "this player is at slot 4, position 6.2s".
2. Cloud restart commands have ~1–2s delivery jitter via MQTT.
3. The `wgetBytes` field is a stale snapshot, not a live counter. Use **stable-state detection** (value stops changing for N polls) as the readiness gate, not value equality.

What we *can* guarantee from cloud only:
- Playlists are byte-identical to spec (server-side audit)
- All players assigned to correct playlists (`currentPlaylist == expected`)
- Hard-cut animation enabled (`animationEnable=false`)
- Same total loop duration on every TV (`validate_timing_contract`)
- Daily 02:00 reset (`deployTime` + `deployEveryday`)

Drift from cloud-mode coordination: typically **200–800ms** post-restart, growing slowly. Acceptable but visible to a careful viewer.

## The LAN truth layer (when at outlet)

Each PiSignage Player exposes a local HTTP API on **port 8000** of its LAN IP. From a laptop on the same WiFi:

- `GET http://{ip}:8000/api/status` → real-time playback position, slot index, current asset filename
- `GET http://{ip}:8000/api/files` → exact files on local storage with sizes/MD5s
- `POST http://{ip}:8000/api/playlistmedia {index: N}` → seek to slot N immediately

This is what the engine's `verify` and `lan-sync` commands use.

**`verify`:** reads back exact playback position from each TV in parallel; computes drift in ms; technical pass/fail (no eyeballs).
**`lan-sync`:** fires `playlistmedia` to all 4 simultaneously over LAN (RTT 1–3ms); each TV seeks to its correct stagger offset; re-runs verify to confirm.

Drift after `lan-sync`: typically **30–80ms**. Same frame to the human eye.

## Self-healing (the long-term shape)

The endgame removes the human entirely:

1. A small always-on device at the outlet (Raspberry Pi, or your laptop while you're there) runs a cron loop:
   - Every 10 minutes: `python3 ps_engine.py verify`
   - If max drift > 100ms: `python3 ps_engine.py lan-sync`
2. Result is logged to a JSON file or pushed to a Cloudflare Worker for monitoring.
3. WhatsApp alert via the existing brand-comms infra if drift can't be corrected (suggests a TV is offline or an app update is needed).

After that bootstrap, you never look at the TVs.

## Why we can't trust "looks fine"

Visual verification has two failure modes:
1. **False positive:** the eye misses 100–200ms drift in a fast-cut sequence. Looks fine, isn't.
2. **False negative:** ambient lighting / camera sensor / video compression on a phone recording introduces apparent drift that isn't really there.

The engine's `verify` reads the source-of-truth field from each player. That's the technical confirmation.

## Hard constraints on creatives (enforced by `validate`)

See [SCENE_AUTHORING.md](./SCENE_AUTHORING.md) for details. Short version:

- Integer-second durations
- H.264 video, native resolution, no boundary fades
- Same encoder settings across a scene
- All TVs in a scene must have identical total loop duration

If creatives violate these, no engine work makes sync look right. The validator runs before deploy and refuses to proceed when creatives fail the check.

## Daily reset — the safety net

PiSignage's group config supports `deployTime` + `deployEveryday`. All 4 vertical groups currently set to `02:00` daily. Effect: every night at 2am, PiSignage redeploys all playlists and restarts all players in lockstep. Drift accumulated over the previous 24h resets to zero.

This is the floor: even if everything else fails silently, the system re-syncs every night before opening hours.
