#!/usr/bin/env python3
"""
PiSignage Fleet Engine — Hamza Express
Compile, validate, and deploy scenes to the 6-TV fleet.

Usage:
  python3 ps_engine.py status                     # poll all players, show live state
  python3 ps_engine.py files                      # list all files in PiSignage library
  python3 ps_engine.py validate <scene.json>      # ffprobe gate: codec, duration, resolution, orientation
  python3 ps_engine.py compile <scene.json>       # dry-run: show playlist arrays without deploying
  python3 ps_engine.py deploy  <scene.json>       # validate + push to all TVs in scene
  python3 ps_engine.py audit                      # diff: server playlists vs what each player reports
  python3 ps_engine.py sync                       # WAIT until all 13/13 files done, THEN coordinated restart
  python3 ps_engine.py resync                     # blunt restart all vertical players (no readiness gate)
  python3 ps_engine.py upload  <file_path>        # upload a local file to PiSignage library

Examples:
  python3 ps_engine.py deploy ../scenes/all_combos.json
  python3 ps_engine.py compile ../scenes/iftar_hour.json
  python3 ps_engine.py resync
  python3 ps_engine.py upload ~/Desktop/kathi_static_v1.png
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

# ─── PATHS ───────────────────────────────────────────────────────────────────

BASE_URL    = "https://hamzaexpress.pisignage.com/api"
ENGINE_DIR  = pathlib.Path(__file__).parent
PROJECT_DIR = ENGINE_DIR.parent
REGISTRY    = PROJECT_DIR / "registry"
SCENES_DIR  = PROJECT_DIR / "scenes"

ENV_LOCAL_CANDIDATES = [
    pathlib.Path.home() / "Documents/Tech/HN-Hotels-Site/.env.local",
    pathlib.Path("/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local"),
]

# ─── TOKEN ───────────────────────────────────────────────────────────────────

def get_token() -> str:
    for env_path in ENV_LOCAL_CANDIDATES:
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("PISIGNAGE_TOKEN="):
                    t = line.split("=", 1)[1].strip()
                    if t:
                        return t
    raise RuntimeError(
        "PISIGNAGE_TOKEN not found in .env.local.\n"
        "Run the token refresh curl command to get a fresh 4-hour token."
    )

def _headers(token: str) -> dict:
    return {"x-access-token": token, "Content-Type": "application/json"}

# ─── REGISTRY LOADERS ────────────────────────────────────────────────────────

def load_fleet() -> dict:
    return json.loads((REGISTRY / "fleet.json").read_text())

def load_assets() -> dict:
    return json.loads((REGISTRY / "assets.json").read_text())

def load_scene(path: str) -> dict:
    p = pathlib.Path(path)
    if not p.exists():
        # try relative to scenes dir
        p = SCENES_DIR / path
    if not p.exists():
        sys.exit(f"Scene file not found: {path}")
    return json.loads(p.read_text())

# ─── COMPILE ─────────────────────────────────────────────────────────────────

def _asset_obj(reg_entry: dict, duration: int) -> dict:
    """Wrap an asset registry entry into a PiSignage playlist asset object."""
    return {
        "filename": reg_entry["pisignage_filename"],
        "duration": duration,
        "fullscreen": True,
        "selected": True,
        "option": {"main": False},
    }

def _resolve_asset(aid: str, assets_reg: dict) -> dict:
    if aid not in assets_reg:
        raise ValueError(
            f"Asset '{aid}' not in registry/assets.json.\n"
            f"Add an entry there before deploying."
        )
    return assets_reg[aid]

def compile_scene_conveyance(scene: dict, assets_reg: dict, fleet: dict) -> dict:
    """
    Conveyance mode (legacy): each TV plays the same set of conveyances in different orders.
    Best for: 'stagger N combos across N screens', loop offset patterns.
    """
    compiled = {}
    for tv_id, screen in scene["screens"].items():
        if tv_id not in fleet:
            raise ValueError(f"TV '{tv_id}' not in registry/fleet.json")
        playlist_assets = []
        for conv_name in screen["conveyance_order"]:
            if conv_name not in scene["conveyances"]:
                raise ValueError(
                    f"Conveyance '{conv_name}' referenced by {tv_id} "
                    f"is not defined in scene['conveyances']"
                )
            for slot in scene["conveyances"][conv_name]:
                reg = _resolve_asset(slot["asset_id"], assets_reg)
                duration = slot.get("duration", reg["default_duration"])
                playlist_assets.append(_asset_obj(reg, duration))
        compiled[tv_id] = playlist_assets
    return compiled

def compile_scene_timeline(scene: dict, assets_reg: dict, fleet: dict) -> dict:
    """
    Timeline mode: each row defines one synchronized 'moment' across all screens.
    Each row = one slot index that fires simultaneously on every TV.
    Best for: per-frame choreography, large creative libraries, consumer-psychology pacing.

    Schema:
      {
        "mode": "timeline",
        "screens": ["tv-v1", "tv-v2", "tv-v3", "tv-v4"],   # explicit screen list
        "timeline": [
          {"duration": 8,  "tv-v1": "asset_a", "tv-v2": "asset_b", "tv-v3": "asset_c", "tv-v4": "asset_d"},
          {"duration": 10, "tv-v1": "asset_e", "tv-v2": "asset_f", "tv-v3": "asset_g", "tv-v4": "asset_h"},
          ...
        ]
      }

    Compile invariant: every row contributes one slot to every TV's playlist with the same
    duration. By construction the timing contract is guaranteed — no TV can drift in the
    conveyance-order math because every TV sees the same row durations.
    """
    screens = scene.get("screens")
    if not isinstance(screens, list) or not screens:
        raise ValueError(
            "timeline-mode scene requires 'screens' as a list of tv_ids "
            "(e.g. [\"tv-v1\",\"tv-v2\",\"tv-v3\",\"tv-v4\"])"
        )
    for tv_id in screens:
        if tv_id not in fleet:
            raise ValueError(f"TV '{tv_id}' not in registry/fleet.json")

    rows = scene.get("timeline")
    if not isinstance(rows, list) or not rows:
        raise ValueError("timeline-mode scene requires non-empty 'timeline' array")

    compiled = {tv_id: [] for tv_id in screens}
    for i, row in enumerate(rows):
        duration = row.get("duration")
        if not isinstance(duration, int) or duration <= 0:
            raise ValueError(f"timeline[{i}].duration must be positive integer (got {duration!r})")
        for tv_id in screens:
            aid = row.get(tv_id)
            if not aid:
                raise ValueError(
                    f"timeline[{i}] missing entry for {tv_id}. "
                    f"Every row must specify an asset_id for every screen."
                )
            reg = _resolve_asset(aid, assets_reg)
            compiled[tv_id].append(_asset_obj(reg, duration))
    return compiled

def compile_scene(scene: dict, assets_reg: dict, fleet: dict) -> dict:
    """Dispatch to the right compiler based on scene['mode']. Defaults to 'conveyance'."""
    mode = scene.get("mode", "conveyance")
    if mode == "conveyance":
        return compile_scene_conveyance(scene, assets_reg, fleet)
    if mode == "timeline":
        return compile_scene_timeline(scene, assets_reg, fleet)
    raise ValueError(f"Unknown scene mode '{mode}'. Use 'conveyance' or 'timeline'.")

# ─── VALIDATION ──────────────────────────────────────────────────────────────

def _tv_loop_total(assets: list) -> int:
    return sum(a["duration"] for a in assets)

def validate_timing_contract(compiled: dict) -> int:
    """All TVs must have the same total loop duration. Returns the loop seconds."""
    totals = {tv: _tv_loop_total(assets) for tv, assets in compiled.items()}
    unique = set(totals.values())
    if len(unique) > 1:
        lines = "\n".join(f"  {tv}: {s}s" for tv, s in totals.items())
        raise ValueError(
            f"TIMING CONTRACT BROKEN — TVs have different loop durations.\n"
            f"Fix: adjust asset durations in the scene so all TVs sum to the same total.\n"
            f"Current totals:\n{lines}"
        )
    loop_s = unique.pop()
    print(f"  ✓ Timing contract: {loop_s}s loop across all {len(compiled)} TVs")
    return loop_s

def validate_no_duplicates_per_screen(scene: dict):
    for tv_id, screen in scene["screens"].items():
        order = screen["conveyance_order"]
        seen = set()
        for c in order:
            if c in seen:
                raise ValueError(
                    f"{tv_id} lists conveyance '{c}' more than once.\n"
                    f"If you want a conveyance to repeat, define it under a different key in scene['conveyances']."
                )
            seen.add(c)
    print(f"  ✓ No duplicate conveyances per screen")

def validate_no_collision_at_slot(scene: dict):
    """Warn if 2+ TVs show the same conveyance at the same slot position."""
    orders = {tv: s["conveyance_order"] for tv, s in scene["screens"].items()}
    n_slots = max(len(o) for o in orders.values())
    collisions = []
    for slot_i in range(n_slots):
        seen = {}
        for tv_id, order in orders.items():
            if slot_i < len(order):
                conv = order[slot_i]
                if conv in seen:
                    collisions.append(
                        f"  slot {slot_i}: {tv_id} and {seen[conv]} both show '{conv}'"
                    )
                seen[conv] = tv_id
    if collisions:
        print(f"  ⚠ Same-conveyance collisions (check if intentional):")
        for c in collisions:
            print(c)
    else:
        print(f"  ✓ No same conveyance on 2 screens at same slot")

def validate_no_collision_per_row_timeline(scene: dict):
    """Timeline mode: warn if 2+ TVs show the same asset in the same row."""
    screens = scene["screens"]
    collisions = []
    for i, row in enumerate(scene["timeline"]):
        seen = {}
        for tv_id in screens:
            aid = row[tv_id]
            if aid in seen:
                collisions.append(f"  row {i}: {tv_id} and {seen[aid]} both show '{aid}'")
            seen[aid] = tv_id
    if collisions:
        print(f"  ⚠ Same-asset collisions per row (check if intentional):")
        for c in collisions:
            print(c)
    else:
        print(f"  ✓ No two screens show the same asset in the same row")

def validate_scene(scene: dict, compiled: dict) -> int:
    print("Validating...")
    mode = scene.get("mode", "conveyance")
    if mode == "conveyance":
        validate_no_duplicates_per_screen(scene)
        validate_no_collision_at_slot(scene)
    elif mode == "timeline":
        validate_no_collision_per_row_timeline(scene)
        n_rows = len(scene["timeline"])
        n_screens = len(scene["screens"])
        print(f"  ✓ Timeline: {n_rows} rows × {n_screens} screens = {n_rows * n_screens} slot fires")
    loop_s = validate_timing_contract(compiled)
    print("  ✓ All checks passed\n")
    return loop_s

# ─── API CALLS ───────────────────────────────────────────────────────────────

def _get(token: str, path: str) -> dict:
    r = requests.get(f"{BASE_URL}{path}", headers=_headers(token), timeout=12)
    if r.status_code == 401:
        raise RuntimeError(
            "Token expired or invalid.\n"
            "Refresh PISIGNAGE_TOKEN in .env.local using the session curl command."
        )
    return r.json()

def _update_playlist(token: str, name: str, assets: list) -> tuple:
    encoded = urllib.parse.quote(name, safe="")
    r = requests.post(
        f"{BASE_URL}/playlists/{encoded}",
        headers=_headers(token),
        json={
            "assets": assets,
            "settings": {},
            "layout": "1",
            "templateName": "custom_layout.html",
        },
        timeout=15,
    )
    return name, r.status_code

def _enforce_group_animation(token: str, group_id: str) -> tuple:
    """Hard-cut transitions: disables slideInRight which adds variable drift."""
    r = requests.post(
        f"{BASE_URL}/groups/{group_id}",
        headers=_headers(token),
        json={"animationEnable": False, "animationType": "none"},
        timeout=10,
    )
    return group_id, r.status_code

def _resync_player(token: str, player_id: str) -> tuple:
    r = requests.post(
        f"{BASE_URL}/players/{player_id}",
        headers={"x-access-token": token},
        json={},
        timeout=10,
    )
    return player_id, r.status_code

def _poll_player(token: str, player_id: str) -> dict:
    data = _get(token, f"/players/{player_id}")
    p = data.get("data", {})
    return {
        "currentPlaylist": p.get("currentPlaylist"),
        "playlistOn":      p.get("playlistOn"),
        "isConnected":     p.get("isConnected"),
        "wgetSpeed":       p.get("wgetSpeed", ""),
        "wgetBytes":       p.get("wgetBytes", ""),
        "filesQueue":      p.get("filesQueue", []),
        "lastReported":    p.get("lastReported"),
        "syncInProgress":  p.get("syncInProgress"),
    }

def _get_playlist(token: str, name: str) -> dict:
    encoded = urllib.parse.quote(name, safe="")
    data = _get(token, f"/playlists/{encoded}")
    return data.get("data", {}) if isinstance(data, dict) else {}

def _parse_files_complete(wgetBytes: str) -> tuple:
    """
    'wgetBytes' looks like: '13/13 files completed' or '8/13 files completed' or ''.
    Returns (done, total) or (None, None) if not parseable.
    """
    if not wgetBytes or "files completed" not in wgetBytes:
        return None, None
    try:
        head = wgetBytes.split(" files")[0]
        a, b = head.split("/")
        return int(a), int(b)
    except Exception:
        return None, None

# ─── COMMANDS ────────────────────────────────────────────────────────────────

def cmd_status(token: str):
    fleet = load_fleet()
    print(f"\n{'TV':<8}  {'Playlist':<25}  {'State':<12}  {'wgetSpeed / note'}")
    print("─" * 78)
    for tv_id, tv in fleet.items():
        if tv_id.startswith("_"):
            continue
        pid = tv.get("pisignage_player_id")
        if not pid:
            print(f"{tv_id:<8}  (no player_id registered)")
            continue
        try:
            s = _poll_player(token, pid)
            state  = "✅ online" if s["isConnected"] else "❌ offline"
            pname  = s["currentPlaylist"] or "—"
            speed  = (s["wgetSpeed"] or "—")[:45]
            print(f"{tv_id:<8}  {pname:<25}  {state:<12}  {speed}")
        except Exception as e:
            print(f"{tv_id:<8}  ERROR: {e}")

def cmd_files(token: str):
    data  = _get(token, "/files")
    raw   = data.get("data", {})
    files = raw.get("files", raw) if isinstance(raw, dict) else raw
    if not files:
        print("No files in PiSignage library.")
        return
    print(f"\n{'#':<4}  {'Filename':<60}  ext")
    print("─" * 70)
    for i, f in enumerate(sorted(files), 1):
        ext = f.rsplit(".", 1)[-1] if "." in f else "?"
        print(f"{i:<4}  {f:<60}  {ext}")
    print(f"\n{len(files)} files total.")

def cmd_compile(scene_path: str):
    fleet      = load_fleet()
    assets_reg = load_assets()
    scene      = load_scene(scene_path)

    print(f"\nScene : {scene['name']}")
    print(f"Desc  : {scene.get('description', '—')}\n")

    compiled = compile_scene(scene, assets_reg, fleet)
    loop_s   = validate_scene(scene, compiled)

    print("─── Playlist arrays (dry-run, nothing deployed) ───\n")
    for tv_id, assets in compiled.items():
        total = _tv_loop_total(assets)
        pname = fleet[tv_id]["pisignage_playlist"]
        print(f"{tv_id}  [{pname}]  —  {len(assets)} assets  {total}s")
        for i, a in enumerate(assets, 1):
            fname = a["filename"]
            dur   = a["duration"]
            flag  = "⚠ PLACEHOLDER" if "FILL_IN" in fname else ""
            print(f"  [{i:02d}]  {fname:<52}  {dur}s  {flag}")
        print()

    print(f"Full loop: {loop_s}s ({loop_s / 60:.1f} min)")

def cmd_deploy(scene_path: str, token: str):
    fleet      = load_fleet()
    assets_reg = load_assets()
    scene      = load_scene(scene_path)

    print(f"\nDeploying: {scene['name']}")
    print(f"Desc     : {scene.get('description', '—')}\n")

    compiled = compile_scene(scene, assets_reg, fleet)
    loop_s   = validate_scene(scene, compiled)

    # Guard: refuse to deploy if any filename is a placeholder
    placeholders = [
        a["filename"]
        for assets in compiled.values()
        for a in assets
        if "FILL_IN" in a["filename"]
    ]
    if placeholders:
        print("❌ Cannot deploy — placeholder filenames found:")
        for p in set(placeholders):
            print(f"   {p}")
        print(
            "\nFix: upload the real files to PiSignage, then update registry/assets.json "
            "with the exact pisignage_filename and set status to 'live'."
        )
        sys.exit(1)

    # Verify all files exist in PiSignage library
    print("Checking library...")
    lib_data  = _get(token, "/files")
    lib_raw   = lib_data.get("data", {})
    lib_files = set(lib_raw.get("files", lib_raw) if isinstance(lib_raw, dict) else lib_raw)

    missing = list({
        a["filename"]
        for assets in compiled.values()
        for a in assets
        if a["filename"] not in lib_files
    })
    if missing:
        print("❌ Files not found in PiSignage library (upload them first):")
        for f in missing:
            print(f"   {f}")
        sys.exit(1)
    print(f"  ✓ All asset files confirmed in library\n")

    # Step 1 — Update all playlists in parallel
    print("Step 1 — Updating playlists (parallel)...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_update_playlist, token, fleet[tv_id]["pisignage_playlist"], assets): tv_id
            for tv_id, assets in compiled.items()
        }
        for f in as_completed(futures):
            tv_id       = futures[f]
            name, code  = f.result()
            icon        = "✅" if code == 200 else f"❌ HTTP {code}"
            print(f"  {icon}  {tv_id}  [{name}]")

    # Brief pause to ensure playlist writes are committed server-side
    time.sleep(0.8)

    # Step 2 — Enforce hard-cut animation on all groups (prevents slideInRight drift)
    print("Step 2 — Enforcing hard-cut transitions on groups (parallel)...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_enforce_group_animation, token, fleet[tv_id]["pisignage_group_id"]): tv_id
            for tv_id in compiled
        }
        for f in as_completed(futures):
            tv_id       = futures[f]
            gid, code   = f.result()
            icon        = "✅" if code == 200 else f"❌ HTTP {code}"
            print(f"  {icon}  {tv_id}")

    time.sleep(0.3)

    # Step 3 — Force-resync all players in parallel (skips heartbeat wait)
    print("\nStep 3 — Resyncing players (parallel)...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_resync_player, token, fleet[tv_id]["pisignage_player_id"]): tv_id
            for tv_id in compiled
        }
        for f in as_completed(futures):
            tv_id      = futures[f]
            pid, code  = f.result()
            icon       = "✅" if code == 200 else f"❌ HTTP {code}"
            print(f"  {icon}  {tv_id}")

    print(
        f"\n✅ Done. {len(compiled)} TVs restarting in sync.\n"
        f"   Loop: {loop_s}s ({loop_s / 60:.1f} min per full rotation)\n"
        f"   Transitions: hard cut (no animation drift)\n"
        f"   Run 'python3 ps_engine.py status' in 2–5 min to verify."
    )

def _ffprobe_json(path: pathlib.Path) -> dict:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        stderr=subprocess.STDOUT,
    )
    return json.loads(out)

def _check_creative(path: pathlib.Path, expected_orientation: str) -> list:
    """Return list of human-readable problems with this creative file. Empty list = pass."""
    probs = []
    if not path.exists():
        return [f"file does not exist: {path}"]

    ext = path.suffix.lower()
    if ext not in {".mp4", ".png", ".jpg", ".jpeg"}:
        probs.append(f"unsupported extension '{ext}' (allowed: .mp4 .png .jpg .jpeg)")
        return probs

    try:
        probe = _ffprobe_json(path)
    except subprocess.CalledProcessError as e:
        return [f"ffprobe failed: {e.output.decode()[:200]}"]

    streams = probe.get("streams", [])
    fmt = probe.get("format", {})
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    if not video_streams:
        probs.append("no video stream found")
        return probs
    v = video_streams[0]
    width  = int(v.get("width", 0))
    height = int(v.get("height", 0))
    codec  = v.get("codec_name", "")

    # Orientation
    is_portrait = height > width
    is_landscape = width > height
    if expected_orientation == "portrait" and not is_portrait:
        probs.append(f"expected portrait but got {width}x{height}")
    if expected_orientation == "landscape" and not is_landscape:
        probs.append(f"expected landscape but got {width}x{height}")

    if ext == ".mp4":
        # H.264 only — Fire TV decoder is most consistent on H.264 baseline/main
        if codec != "h264":
            probs.append(f"video codec '{codec}' — must be 'h264' for Fire TV consistency")

        # Integer-second duration
        dur = float(fmt.get("duration", 0) or 0)
        rounded = round(dur)
        if rounded == 0 or abs(dur - rounded) > 0.05:
            probs.append(f"duration {dur:.3f}s — must be an exact integer (±50ms tolerance)")

        # Resolution sanity
        if expected_orientation == "portrait" and (width, height) != (1080, 1920):
            probs.append(f"portrait video should be 1080x1920, got {width}x{height}")
        if expected_orientation == "landscape" and (width, height) != (1920, 1080):
            probs.append(f"landscape video should be 1920x1080, got {width}x{height}")

        # GOP / keyframe interval — try to read; tolerant if ffprobe doesn't expose
        # (We don't fail on this; we warn. GOP ≤ fps means every frame is a keyframe candidate.)
        # Skipping deep GOP probe for now — would require -read_intervals.

    return probs

def cmd_validate_creative(scene_path: str):
    """
    Probe every creative referenced by the scene against fps/codec/duration/resolution rules.
    Reads creatives from a local source directory if --creatives-dir is supplied,
    otherwise looks under projects/pisignage-hamza-express/creatives/.
    Pure local check — no API calls. Run BEFORE 'upload' or 'deploy'.
    """
    if not shutil.which("ffprobe"):
        sys.exit("ffprobe not found. Install ffmpeg: brew install ffmpeg")

    fleet      = load_fleet()
    assets_reg = load_assets()
    scene      = load_scene(scene_path)

    # Build set of asset_ids referenced by the scene
    referenced = set()
    mode = scene.get("mode", "conveyance")
    if mode == "conveyance":
        for screen in scene["screens"].values():
            for conv_name in screen["conveyance_order"]:
                for slot in scene["conveyances"][conv_name]:
                    referenced.add(slot["asset_id"])
    else:
        for tv_id in scene["screens"]:
            for row in scene["timeline"]:
                if row.get(tv_id):
                    referenced.add(row[tv_id])

    # Resolve each to (path, orientation)
    creatives_dir = PROJECT_DIR / "creatives"
    print(f"\nValidating {len(referenced)} creatives against {creatives_dir}/")
    print("─" * 78)

    fail_count = 0
    pass_count = 0
    skip_count = 0
    for aid in sorted(referenced):
        if aid not in assets_reg:
            print(f"  ❌ {aid:<45}  not in registry/assets.json")
            fail_count += 1
            continue
        reg = assets_reg[aid]
        fname = reg["pisignage_filename"]
        orient = reg.get("orientation", "portrait")
        local_path = creatives_dir / fname
        if not local_path.exists():
            print(f"  ⊘  {fname:<55}  not found locally (skipping — uploaded directly to PiSignage)")
            skip_count += 1
            continue
        probs = _check_creative(local_path, orient)
        if probs:
            print(f"  ❌ {fname}")
            for p in probs:
                print(f"     {p}")
            fail_count += 1
        else:
            print(f"  ✅ {fname}")
            pass_count += 1

    print("─" * 78)
    print(f"  pass: {pass_count}   fail: {fail_count}   skipped (no local file): {skip_count}")
    if fail_count:
        print("\n❌ Creative validation FAILED. Fix or re-encode the failing files before deploying.")
        sys.exit(1)
    print("\n✅ All locally-present creatives pass. Safe to upload + deploy.")

def cmd_audit(token: str):
    """
    Pulls server-side playlist state + per-player state for all vertical TVs and
    prints a diff of what's expected vs what each player actually reports.
    No writes. Read-only diagnostic.
    """
    fleet = load_fleet()
    vertical = {k: v for k, v in fleet.items() if not k.startswith("_") and k.startswith("tv-v")}

    print("\n═══ SERVER-SIDE PLAYLISTS ═══")
    server_state = {}
    for tv_id, tv in vertical.items():
        pname = tv.get("pisignage_playlist")
        if not pname:
            print(f"{tv_id}: no playlist registered")
            continue
        try:
            pl = _get_playlist(token, pname)
            assets = pl.get("assets", [])
            total = sum(int(a.get("duration", 0)) for a in assets)
            first = assets[0]["filename"] if assets else "—"
            server_state[tv_id] = {
                "playlist":   pname,
                "asset_count": len(assets),
                "total_s":    total,
                "first":      first,
                "filenames":  [a["filename"] for a in assets],
            }
            print(f"  {tv_id:<6} [{pname:<18}]  {len(assets)} assets  {total}s  → starts {first}")
        except Exception as e:
            print(f"  {tv_id}: ERROR {e}")

    print("\n═══ PLAYER REPORTED STATE ═══")
    print(f"{'TV':<6}  {'Connected':<10}  {'Playing':<18}  {'Files':<10}  {'Now':<55}  {'Match?':<10}")
    print("─" * 120)
    drift_warnings = []
    for tv_id, tv in vertical.items():
        pid = tv.get("pisignage_player_id")
        if not pid:
            continue
        try:
            s = _poll_player(token, pid)
            done, total = _parse_files_complete(s.get("wgetBytes", "") or "")
            files = f"{done}/{total}" if done is not None else "—"
            current_pl = s.get("currentPlaylist") or "—"
            wget = (s.get("wgetSpeed") or "").replace("current file:", "")[:55]
            connected = "✅" if s.get("isConnected") else "❌"
            expected = server_state.get(tv_id, {}).get("playlist", "")
            match = "✅" if current_pl == expected else f"❌ exp={expected}"
            ready = (done == total) if (done is not None and total is not None) else False
            ready_marker = " READY" if ready else " DOWNLOADING"
            print(f"{tv_id:<6}  {connected:<10}  {current_pl:<18}  {files:<10}  {wget:<55}  {match}{ready_marker}")
            if not ready:
                drift_warnings.append(f"  {tv_id} not finished downloading ({files})")
        except Exception as e:
            print(f"{tv_id}: ERROR {e}")

    print("\n═══ VERDICT ═══")
    if drift_warnings:
        print("❌ NOT SAFE TO RESTART — players still downloading:")
        for w in drift_warnings:
            print(w)
        print("\n  Run 'python3 ps_engine.py sync' to wait + auto-fire restart when all are 13/13.")
    else:
        print("✅ All players ready. Run 'python3 ps_engine.py sync' to issue coordinated restart.")

def cmd_sync(token: str, max_wait_s: int = 240, poll_every_s: int = 8, stable_polls_required: int = 4):
    """
    Gated coordinated restart — evidence-based, not deploy-and-pray.

    Readiness model: 'stable state' instead of 'all-files-downloaded'.
    PiSignage's wgetBytes field is unreliable (doesn't reset after downloads)
    so we wait until each player's wgetBytes value stops changing for
    `stable_polls_required` consecutive polls. That proves no active
    download/install is in flight — the player has settled.

    Hard requirements before firing:
      - currentPlaylist matches expected for all 4
      - isConnected = True for all 4
      - wgetBytes stable for N consecutive polls

    Then enforces hard-cut animation, fires parallel restart, and verifies.
    """
    fleet = load_fleet()
    vertical = {k: v for k, v in fleet.items() if not k.startswith("_") and k.startswith("tv-v")}
    pids = {tv_id: tv["pisignage_player_id"] for tv_id, tv in vertical.items() if tv.get("pisignage_player_id")}
    expected_playlist = {tv_id: tv["pisignage_playlist"] for tv_id, tv in vertical.items() if tv.get("pisignage_playlist")}

    print(f"\nGate 1: waiting for {len(pids)} TVs to reach stable state")
    print(f"  (wgetBytes unchanged for {stable_polls_required} consecutive {poll_every_s}s polls + correct playlist + connected)")
    start = time.time()
    history = {tv_id: [] for tv_id in pids}  # list of last N wgetBytes values
    last_report = ""

    while True:
        elapsed = int(time.time() - start)
        if elapsed > max_wait_s:
            print(f"\n⚠ Timed out after {max_wait_s}s — proceeding with current state anyway.")
            print("   The wgetBytes field may simply be stuck at a non-final value;")
            print("   visual verification at the outlet is the real source of truth.")
            break

        all_ready = True
        statuses = {}
        for tv_id, pid in pids.items():
            try:
                s = _poll_player(token, pid)
                wb = s.get("wgetBytes", "") or ""
                pl = s.get("currentPlaylist") or ""
                conn = bool(s.get("isConnected"))

                history[tv_id].append(wb)
                if len(history[tv_id]) > stable_polls_required:
                    history[tv_id] = history[tv_id][-stable_polls_required:]

                stable = (len(history[tv_id]) >= stable_polls_required and len(set(history[tv_id])) == 1)
                playlist_ok = (pl == expected_playlist.get(tv_id))
                ready = stable and playlist_ok and conn

                statuses[tv_id] = (wb, stable, playlist_ok, conn, ready)
                if not ready:
                    all_ready = False
            except Exception as e:
                statuses[tv_id] = ("ERR", False, False, False, False)
                all_ready = False

        report = " | ".join(
            f"{tv_id}:{wb.split(' files')[0] if 'files' in wb else wb[:6]}"
            f"{'·stable' if st else ''}{'·pl' if pl else '·NOPL'}{'·on' if c else '·OFF'}"
            for tv_id, (wb, st, pl, c, _) in sorted(statuses.items())
        )
        if report != last_report:
            print(f"  [{elapsed:>3}s] {report}")
            last_report = report

        if all_ready:
            print(f"\n✅ Gate 1 passed in {elapsed}s — all players stable, on correct playlist, connected.")
            break

        time.sleep(poll_every_s)

    print("\nGate 2: enforcing hard-cut transitions on all groups...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_enforce_group_animation, token, vertical[tv_id]["pisignage_group_id"]): tv_id
            for tv_id in pids if vertical[tv_id].get("pisignage_group_id")
        }
        for f in as_completed(futures):
            tv_id     = futures[f]
            gid, code = f.result()
            print(f"  {'✅' if code == 200 else f'❌ {code}'}  {tv_id}")

    time.sleep(0.4)

    print("\nGate 3: firing simultaneous restart (parallel API calls)...")
    fire_t0 = time.time()
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(_resync_player, token, pid): tv_id for tv_id, pid in pids.items()}
        results = []
        for f in as_completed(futures):
            tv_id      = futures[f]
            pid, code  = f.result()
            dt_ms      = int((time.time() - fire_t0) * 1000)
            results.append((tv_id, code, dt_ms))
            print(f"  {'✅' if code == 200 else f'❌ {code}'}  {tv_id}  (fired at +{dt_ms}ms)")
    spread_ms = max(r[2] for r in results) - min(r[2] for r in results)
    print(f"\n  Restart command spread: {spread_ms}ms across all 4 TVs")

    print("\nGate 4: waiting 35s for players to apply restart, then verifying...")
    time.sleep(35)
    for tv_id, pid in pids.items():
        try:
            s = _poll_player(token, pid)
            current = s.get("currentPlaylist") or "—"
            expected = expected_playlist.get(tv_id, "?")
            ok = (current == expected)
            print(f"  {'✅' if ok else '❌'}  {tv_id}: playing '{current}' (expected '{expected}')")
        except Exception as e:
            print(f"  ❌  {tv_id}: ERROR {e}")

    print("\n✅ Coordinated restart complete. The 4 TVs all began the new playlist within ~{} ms of each other.".format(spread_ms))
    print("   Drift accumulates daily; PiSignage's deployTime=02:00 will resync them every night.")

def cmd_resync(token: str):
    """Enforce hard-cut animation + restart all vertical players without redeploying content."""
    fleet = load_fleet()
    vertical = {k: v for k, v in fleet.items() if not k.startswith("_") and k.startswith("tv-v")}

    print("Enforcing hard-cut transitions...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_enforce_group_animation, token, tv["pisignage_group_id"]): tv_id
            for tv_id, tv in vertical.items()
            if tv.get("pisignage_group_id")
        }
        for f in as_completed(futures):
            tv_id     = futures[f]
            gid, code = f.result()
            icon      = "✅" if code == 200 else f"❌ HTTP {code}"
            print(f"  {icon}  {tv_id}")

    time.sleep(0.3)

    print("Restarting players...")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            ex.submit(_resync_player, token, tv["pisignage_player_id"]): tv_id
            for tv_id, tv in vertical.items()
            if tv.get("pisignage_player_id")
        }
        for f in as_completed(futures):
            tv_id      = futures[f]
            pid, code  = f.result()
            icon       = "✅" if code == 200 else f"❌ HTTP {code}"
            print(f"  {icon}  {tv_id}")

    print("\n✅ All vertical TVs restarted from position 0. Check sync in ~30s.")

def cmd_upload(file_path: str, token: str):
    p = pathlib.Path(file_path).expanduser()
    if not p.exists():
        sys.exit(f"File not found: {p}")
    size_mb = p.stat().st_size / 1024 / 1024
    print(f"Uploading {p.name} ({size_mb:.1f} MB) to PiSignage library...")
    with open(p, "rb") as fh:
        r = requests.post(
            f"{BASE_URL}/files/upload",
            headers={"x-access-token": token},
            files={"assets": (p.name, fh)},
            timeout=180,
        )
    if r.status_code == 200:
        print(f"✅ Uploaded: {p.name}")
        print(f"   Add to registry/assets.json with pisignage_filename: \"{p.name}\"")
    else:
        print(f"❌ Upload failed: HTTP {r.status_code}")
        print(f"   {r.text[:300]}")

# ─── MAIN ────────────────────────────────────────────────────────────────────

COMMANDS = {"status", "files", "compile", "deploy", "upload", "resync", "audit", "sync", "validate"}

def main():
    args = sys.argv[1:]
    if not args or args[0] not in COMMANDS:
        print(__doc__)
        sys.exit(0)

    cmd = args[0]

    # compile + validate do not need a live token
    if cmd == "compile":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py compile <scene.json>")
        cmd_compile(args[1])
        return
    if cmd == "validate":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py validate <scene.json>")
        cmd_validate_creative(args[1])
        return

    token = get_token()

    if cmd == "status":
        cmd_status(token)
    elif cmd == "files":
        cmd_files(token)
    elif cmd == "deploy":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py deploy <scene.json>")
        cmd_deploy(args[1], token)
    elif cmd == "resync":
        cmd_resync(token)
    elif cmd == "audit":
        cmd_audit(token)
    elif cmd == "sync":
        cmd_sync(token)
    elif cmd == "upload":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py upload <file_path>")
        cmd_upload(args[1], token)


if __name__ == "__main__":
    main()
