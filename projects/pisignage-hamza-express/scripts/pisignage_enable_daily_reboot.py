#!/usr/bin/env python3
"""Enable PiSignage native daily reboot at 06:45 IST on all 6 fleet groups.

This replaces adb_sync_restart.sh as the daily-sync mechanism.
Run once. Settings persist in PiSignage server config — no re-runs needed.
"""
import json
import os
import urllib.request
import urllib.error

# Load token
TOKEN = None
with open(os.path.expanduser("~/Documents/Tech/HN-Hotels-Site/.env.local")) as f:
    for line in f:
        if line.startswith("PISIGNAGE_TOKEN="):
            TOKEN = line.split("=", 1)[1].strip()
            break
assert TOKEN, "PISIGNAGE_TOKEN not found in .env.local"

GROUPS = [
    ("TV-V1 (Menu Screen 3 - Page 1)",  "69a0c685c219823ea50b6532"),
    ("TV-V2 (Kathi - Left Wall V2)",    "69faf67259be778b7af67f2b"),
    ("TV-V3 (Menu Screen 1 - Page 3)",  "69a0a259c219823ea50423bf"),
    ("TV-V4 (Bain Marie - KDS)",        "69a0b678c219823ea507ef1e"),
    ("TV-H1 (Kitchen Pass - KDS)",      "69a0b677c219823ea507ef0e"),
    ("TV-H2 (Outdoor Facade)",          "69f6013bedc3464da687f668"),
]

REBOOT_CONFIG = {"reboot": {"enable": True, "time": "06:45"}}

print("=== Enable PiSignage daily reboot 06:45 IST on 6 groups ===\n")
for name, gid in GROUPS:
    url = f"https://hamzaexpress.pisignage.com/api/groups/{gid}"
    req = urllib.request.Request(
        url,
        data=json.dumps(REBOOT_CONFIG).encode(),
        headers={"x-access-token": TOKEN, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
        ok = body.get("success")
        rb = body.get("data", {}).get("reboot", {})
        print(f"  [{'OK' if ok else 'FAIL'}]  {name:42}  reboot={json.dumps(rb)}")
    except urllib.error.HTTPError as e:
        print(f"  [FAIL]  {name:42}  HTTP {e.code}: {e.read()[:120]}")
    except Exception as e:
        print(f"  [FAIL]  {name:42}  {type(e).__name__}: {e}")

print("\nNext: PiSignage Player 2 reads group config every ~60s.")
print("Tomorrow at 06:45 IST all 6 Fire Sticks will reboot natively.")
print("After reboot, app auto-starts → all begin playlist at asset[0].")
print("→ adb_sync_restart.sh is now obsolete for daily ops.")
