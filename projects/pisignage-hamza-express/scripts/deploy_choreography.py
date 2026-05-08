#!/usr/bin/env python3
"""Restore each of the 4 vertical-TV playlists to the EXACT 5-slot
psychology_v3_kathi spec. Removes the 1s C2 sync barrier that was added
during cross-TV-sync experiments. Then re-deploys all 4 groups in parallel
within milliseconds of each other."""
import json, os, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

with open(os.path.expanduser("~/Documents/Tech/HN-Hotels-Site/.env.local")) as f:
    for line in f:
        if line.startswith("PISIGNAGE_TOKEN="):
            TOKEN = line.split("=",1)[1].strip()

# Refresh token
sess = urllib.request.Request(
    "https://hamzaexpress.pisignage.com/api/session",
    data=json.dumps({"email":"hnhotelsindia@gmail.com","password":"Abdulkader1*","getToken":True}).encode(),
    headers={"Content-Type":"application/json"}, method="POST")
with urllib.request.urlopen(sess, timeout=15) as r:
    TOKEN = json.load(r)["token"]

BASE = "https://hamzaexpress.pisignage.com/api"

# Pure design from scenes/psychology_v3_kathi.json — 5 slots × 10s = 50s loop
CHOREO = {
    "Menu Page 1": [   # V1
        "Video_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.mp4",
        "Final_v3_TV-V10_GR_AllInOne_C1_C2_C3_C4.png",
        "Video_v3_TV-V6_C6_MuttonBiryani_Kabab.mp4",
        "Final_v3_TV-V7_GR_ProteinPair_C3_C4.png",
        "Final_v3_TV-V2_C1_GheeRice_DalFry.png",
    ],
    "Menu Page 2": [   # V2
        "Final_v3_TV-V11_K1_Chicken_Kathi.png",
        "Video_v3_TV-V11_K1_Chicken_Kathi_c.mp4",
        "Final_v3_TV-V13_Kathi_Pair_K1_KT.png",
        "Final_v3_TV-V12_KT_Chicken_Tikka_Kathi.png",
        "Video_v3_TV-V12_KT_Chicken_Tikka_Kathi_c.mp4",
    ],
    "Menu Page 3": [   # V3
        "Video_v3_TV-V5_C5_ChickenBiryani_Kabab.mp4",
        "Final_v3_TV-V6_C6_MuttonBiryani_Kabab.png",
        "Video_v3_TV-V4_C4_GheeRice_MuttonChatpata_Kabab.mp4",
        "Final_v3_TV-V9_Biryani_Pair_C5_C6.png",
        "Final_v3_TV-V8_GR_VegPair_C1_C2.png",
    ],
    "KDS Bain Marie": [   # V4
        "Final_v3_TV-V4_C4_GheeRice_MuttonChatpata_Kabab.png",
        "Final_v3_TV-V5_C5_ChickenBiryani_Kabab.png",
        "Final_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.png",
        "Video_v3_TV-V2_C1_GheeRice_DalFry.mp4",
        "Video_v3_TV-V1_C2_GheeRice_DalFry_Kabab.mp4",
    ],
}

GROUPS = {
    "Menu Page 1":     "69a0c685c219823ea50b6532",
    "Menu Page 2":     "69faf67259be778b7af67f2b",
    "Menu Page 3":     "69a0a259c219823ea50423bf",
    "KDS Bain Marie":  "69a0b678c219823ea507ef1e",
}

def http_post(path, body):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body).encode(),
        headers={"x-access-token": TOKEN, "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def http_get(path):
    req = urllib.request.Request(BASE + path, headers={"x-access-token": TOKEN})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# Phase 1: rewrite each playlist
print("=" * 70)
print("PHASE 1 — Rewrite playlists to pure 5-slot psychology_v3_kathi spec")
print("=" * 70)
for pl_name, filenames in CHOREO.items():
    pl = http_get(f"/playlists/{urllib.parse.quote(pl_name)}")["data"]
    new_assets = [{
        "filename": fn,
        "duration": 10,
        "selected": True,
        "fullscreen": True,
    } for fn in filenames]
    body = {
        "name": pl_name,
        "assets": new_assets,
        "settings": pl.get("settings", {}),
        "layout": pl.get("layout", "1"),
        "videoWindow": pl.get("videoWindow"),
        "zoneVideoWindow": pl.get("zoneVideoWindow", {}),
        "templateName": pl.get("templateName", "custom_layout.html"),
        "schedule": pl.get("schedule", {}),
    }
    r = http_post(f"/playlists/{urllib.parse.quote(pl_name)}", body)
    print(f"  [{pl_name}]  success={r.get('success')}  assets: {len(pl.get('assets',[]))} → {len(r.get('data',{}).get('assets',[]))}")

# Phase 2: simultaneously deploy all 4 groups
print()
print("=" * 70)
print("PHASE 2 — Simultaneously deploy all 4 groups")
print("=" * 70)

def deploy(pl_name):
    gid = GROUPS[pl_name]
    fns = CHOREO[pl_name] + [f"__{pl_name}.json"]
    pl_obj = [{"name": pl_name, "plType": "regular", "skipForSchedule": False}]
    payload = {
        "playlists":         pl_obj,
        "deployedPlaylists": pl_obj,
        "assets":            fns,
        "deployedAssets":    fns,
        "lastDeployed":      str(int(time.time() * 1000)),
        "animationEnable":   True,
        "animationType":     "fade",
    }
    return http_post(f"/groups/{gid}?deploy=true", payload)

t0 = time.time()
with ThreadPoolExecutor(max_workers=4) as ex:
    futs = {ex.submit(deploy, p): p for p in CHOREO}
    for f in futs:
        p = futs[f]
        r = f.result()
        print(f"  [{p}]  ts={r.get('data',{}).get('lastDeployed')}  ok={r.get('success')}")
print(f"\nParallel deploy spread: {(time.time()-t0)*1000:.0f}ms")
print("\nAll 4 vertical TVs now playing pure psychology_v3_kathi (5×10s = 50s loop, fade transitions).")
