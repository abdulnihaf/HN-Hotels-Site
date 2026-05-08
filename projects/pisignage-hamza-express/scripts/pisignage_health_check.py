#!/usr/bin/env python3
"""PiSignage-native fleet health check. Zero ADB dependency.

Reads each player's status from the PiSignage API and reports:
  - online state (isConnected + lastReported recency)
  - currentPlaylist (does it match expected from fleet.json?)
  - syncInProgress / wgetBytes (downloads in flight?)
  - tvStatus (CEC TV power state, where supported)
  - registered group (does it match fleet.json?)

Run anytime — including from a phone via SSH. No WiFi-LAN access required.

Usage:
    python3 pisignage_health_check.py            # all 6 TVs
    python3 pisignage_health_check.py tv-v2      # single TV
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

ENV_PATH = os.path.expanduser("~/Documents/Tech/HN-Hotels-Site/.env.local")
REGISTRY_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "registry", "fleet.json",
)


def load_token():
    with open(ENV_PATH) as f:
        for line in f:
            if line.startswith("PISIGNAGE_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("PISIGNAGE_TOKEN missing from .env.local")


def load_fleet():
    with open(REGISTRY_PATH) as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}


def fetch_player(token, player_id):
    url = f"https://hamzaexpress.pisignage.com/api/players/{player_id}"
    req = urllib.request.Request(url, headers={"x-access-token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())["data"]


def age_minutes(iso_ts):
    if not iso_ts:
        return None
    t = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds() / 60


def status_glyph(ok):
    return "OK  " if ok else "FAIL"


def check_one(token, tv_id, fleet_entry):
    expected_group_id = fleet_entry["pisignage_group_id"]
    expected_group_name = fleet_entry["pisignage_group_name"]
    expected_playlist = fleet_entry.get("pisignage_playlist")

    try:
        p = fetch_player(token, fleet_entry["pisignage_player_id"])
    except Exception as e:
        return {"tv": tv_id, "ok": False, "err": f"API: {e}"}

    actual_group_id = p.get("group", {}).get("_id")
    actual_group_name = p.get("group", {}).get("name")
    actual_playlist = p.get("currentPlaylist")
    last_min = age_minutes(p.get("lastReported"))
    is_connected = p.get("isConnected")

    checks = {
        "online":      is_connected is True,
        "fresh<5min":  last_min is not None and last_min < 5,
        "group_id":    actual_group_id == expected_group_id,
        "group_name":  actual_group_name == expected_group_name,
        "playlist":    expected_playlist is None or actual_playlist == expected_playlist,
        "tvOn":        p.get("tvStatus") is True or not p.get("isCecSupported"),
        "playlistOn":  p.get("playlistOn") is True,
    }
    return {
        "tv": tv_id,
        "label": fleet_entry["label"],
        "checks": checks,
        "actual": {
            "group": actual_group_name,
            "playlist": actual_playlist,
            "last_seen_min": round(last_min, 1) if last_min else None,
            "wget": p.get("wgetBytes"),
            "syncing": p.get("syncInProgress"),
            "ip": p.get("myIpAddress"),
            "version": p.get("version"),
        },
    }


def main():
    token = load_token()
    fleet = load_fleet()

    target = sys.argv[1].lower() if len(sys.argv) > 1 else None
    if target:
        fleet = {k: v for k, v in fleet.items() if k == target}
        if not fleet:
            print(f"Unknown TV id: {target}")
            sys.exit(1)

    print(f"=== PiSignage Fleet Health  ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')} IST) ===\n")
    overall_ok = True
    for tv_id in sorted(fleet.keys()):
        r = check_one(token, tv_id, fleet[tv_id])
        if "err" in r:
            print(f"  [FAIL] {tv_id}  {r['err']}")
            overall_ok = False
            continue
        all_ok = all(r["checks"].values())
        overall_ok = overall_ok and all_ok
        print(f"  [{status_glyph(all_ok)}] {tv_id}  {r['label']}")
        for name, ok in r["checks"].items():
            if not ok:
                print(f"         FAIL: {name}")
        a = r["actual"]
        print(f"         group={a['group']!r}  playlist={a['playlist']!r}")
        print(f"         ip={a['ip']}  last_seen={a['last_seen_min']}min  wget={a['wget']!r}  sync={a['syncing']}")
        print()

    sys.exit(0 if overall_ok else 1)


if __name__ == "__main__":
    main()
