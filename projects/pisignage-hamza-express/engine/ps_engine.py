#!/usr/bin/env python3
"""
PiSignage Fleet Engine — Hamza Express
Compile, validate, and deploy scenes to the 6-TV fleet.

Usage:
  python3 ps_engine.py status                     # poll all players, show live state
  python3 ps_engine.py files                      # list all files in PiSignage library
  python3 ps_engine.py compile <scene.json>       # dry-run: show playlist arrays without deploying
  python3 ps_engine.py deploy  <scene.json>       # validate + push to all TVs in scene
  python3 ps_engine.py resync                     # restart all vertical players from position 0
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

def compile_scene(scene: dict, assets_reg: dict, fleet: dict) -> dict:
    """
    Returns {tv_id: [pisignage_asset_objects]} for every screen in the scene.
    Raises ValueError for any missing asset_id or tv_id.
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
                aid = slot["asset_id"]
                if aid not in assets_reg:
                    raise ValueError(
                        f"Asset '{aid}' not in registry/assets.json.\n"
                        f"Add an entry there before deploying."
                    )
                reg = assets_reg[aid]
                playlist_assets.append({
                    "filename": reg["pisignage_filename"],
                    "duration": slot.get("duration", reg["default_duration"]),
                    "fullscreen": True,
                    "selected": True,
                    "option": {"main": False},
                })
        compiled[tv_id] = playlist_assets
    return compiled

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

def validate_scene(scene: dict, compiled: dict) -> int:
    print("Validating...")
    validate_no_duplicates_per_screen(scene)
    validate_no_collision_at_slot(scene)
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
        "filesQueue":      p.get("filesQueue", []),
        "lastReported":    p.get("lastReported"),
    }

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

COMMANDS = {"status", "files", "compile", "deploy", "upload", "resync"}

def main():
    args = sys.argv[1:]
    if not args or args[0] not in COMMANDS:
        print(__doc__)
        sys.exit(0)

    cmd = args[0]

    # compile does not need a live token
    if cmd == "compile":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py compile <scene.json>")
        cmd_compile(args[1])
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
    elif cmd == "upload":
        if len(args) < 2:
            sys.exit("Usage: ps_engine.py upload <file_path>")
        cmd_upload(args[1], token)


if __name__ == "__main__":
    main()
