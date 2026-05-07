#!/usr/bin/env python3
"""Deep audit of every PiSignage variable per TV. Emits markdown."""
import json, os, urllib.request, urllib.parse
from datetime import datetime, timezone

with open(os.path.expanduser("~/Documents/Tech/HN-Hotels-Site/.env.local")) as f:
    for line in f:
        if line.startswith("PISIGNAGE_TOKEN="):
            TOKEN = line.split("=",1)[1].strip()

# Refresh token to ensure it's valid
import urllib.request
import json as _json
sess = urllib.request.Request(
    "https://hamzaexpress.pisignage.com/api/session",
    data=_json.dumps({
        "email":"hnhotelsindia@gmail.com",
        "password":"Abdulkader1*",
        "getToken":True
    }).encode(),
    headers={"Content-Type":"application/json"},
    method="POST")
with urllib.request.urlopen(sess, timeout=15) as r:
    TOKEN = _json.load(r)["token"]

BASE = "https://hamzaexpress.pisignage.com/api"

# Fleet from registry
FLEET = [
    ("tv-v1", "Menu Page 1",     "69a0bd975b9a6c146ac9dfae", "69a0c685c219823ea50b6532", "Menu Screen 3 - Page 1"),
    ("tv-v2", "Menu Page 2",     "69a0dd165b9a6c146ad84a85", "69faf67259be778b7af67f2b", "Kathi - Left Wall V2"),
    ("tv-v3", "Menu Page 3",     "69a0dd165b9a6c146ad84a7d", "69a0a259c219823ea50423bf", "Menu Screen 1 - Page 3"),
    ("tv-v4", "KDS Bain Marie",  "69a060985b9a6c146a9dc94f", "69a0b678c219823ea507ef1e", "Bain Marie - KDS"),
]

def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"x-access-token": TOKEN})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def first(s, n=80):
    if s is None: return ""
    s = str(s)
    return s if len(s) <= n else s[:n] + "…"

# Output target
out_path = "/tmp/PISIGNAGE_TRUTH.md"
out = []
out.append(f"# PiSignage Production Truth — Generated {datetime.now().isoformat(timespec='seconds')}\n")
out.append("Live snapshot of every PiSignage variable per TV. Do NOT edit manually — regenerate via `pisig_deep_audit.py`.\n")

# ── Per-TV deep dump ──────────────────────────────────────────────────────
for tv_id, pl_name, player_id, group_id, group_name in FLEET:
    out.append(f"\n---\n\n## {tv_id.upper()} — `{pl_name}` on group `{group_name}`\n")

    # Player state
    p = fetch(f"/players/{player_id}")["data"]
    out.append("### Player runtime state\n")
    out.append(f"| field | value |\n|---|---|\n")
    for k in ("name","_id","cpuSerialNumber","myIpAddress","ip","version","platform_version",
              "isConnected","webSocket","newSocketIo","socket","connectionCount","registered",
              "licensed","TZ","lastReported","statusChangeTime","tvStatus","cecTvStatus",
              "isCecSupported","disabled","installation","location","piTemperature","uptime",
              "diskSpaceUsed","diskSpaceAvailable",
              "playlistOn","currentPlaylist","syncInProgress","wgetBytes","wgetSpeed","duration"):
        out.append(f"| {k} | `{first(p.get(k))}` |\n")

    # Playlist content
    pl = fetch(f"/playlists/{urllib.parse.quote(pl_name)}")["data"]
    out.append("\n### Playlist composition (slot order)\n")
    out.append(f"`{pl_name}` — `templateName: {pl.get('templateName')}` · `layout: {pl.get('layout')}` · `assets: {len(pl.get('assets',[]))} entries`\n\n")
    out.append("| slot | filename | duration | extra |\n|---|---|---|---|\n")
    for i, a in enumerate(pl.get("assets",[])):
        extras = {k:v for k,v in a.items() if k not in ("filename","duration")}
        out.append(f"| {i} | `{a.get('filename')}` | `{a.get('duration')}s` | `{first(json.dumps(extras), 50)}` |\n")
    if pl.get("settings"):
        out.append(f"\n**Settings:** `{first(json.dumps(pl['settings']), 200)}`\n")
    if pl.get("schedule"):
        out.append(f"**Schedule:** `{first(json.dumps(pl['schedule']), 200)}`\n")

    # Group config (the deployment + play behavior controls)
    g = fetch(f"/groups/{group_id}")["data"]
    out.append("\n### Group config (deployment & playback)\n")
    out.append("| field | value |\n|---|---|\n")
    for k in ("name","_id","installation","color","orientation","resolution",
              "deployedPlaylists","deployedAssets","lastDeployed","deployTime","deployEveryday",
              "playlists","assets","playAllEligiblePlaylists","combineDefaultPlaylist",
              "shuffleContent","alternateContent","loadPlaylistOnCompletion",
              "animationEnable","animationType","timeToStopVideo",
              "monitorArrangement","reboot","sleep","showClock","emergencyMessage",
              "selectedVideoPlayer","enableMpv","enablePio","resizeAssets","videoKeepAspect",
              "imageLetterboxed","videoShowSubtitles","mpvAudioDelay","omxVolume",
              "kioskUi","disableWebUi","disableHwWidgets","disableWarnings","disableAp",
              "urlReloadDisable","keepWeblinksInMemory","signageBackgroundColor",
              "logo","logox","logoy","qrObj","labels"):
        v = g.get(k)
        if v is not None:
            out.append(f"| {k} | `{first(json.dumps(v) if not isinstance(v,(str,int,float,bool)) else v, 100)}` |\n")

# ── Library inventory ─────────────────────────────────────────────────────
out.append("\n\n---\n\n## Asset library inventory\n\n")
all_files = fetch("/files")["data"]["dbdata"]
out.append("| filename | type | resolution | size | thumbnail |\n|---|---|---|---|---|\n")
for f in sorted(all_files, key=lambda x: x["name"]):
    res = f.get("resolution",{})
    out.append(f"| `{f['name']}` | {f.get('type','?')} | {res.get('width','?')}×{res.get('height','?')} | {f.get('size','?')} | `{first(f.get('thumbnail',''),60)}` |\n")

# Save
with open(out_path, "w") as f:
    f.write("".join(out))

print(f"Written: {out_path} ({sum(len(s) for s in out)} chars)")

# Also dump the raw JSON for archival
raw_path = "/tmp/PISIGNAGE_TRUTH.json"
raw = {
    "generated_at": datetime.now().isoformat(timespec="seconds"),
    "fleet": []
}
for tv_id, pl_name, player_id, group_id, group_name in FLEET:
    raw["fleet"].append({
        "tv_id": tv_id,
        "playlist_name": pl_name,
        "player": fetch(f"/players/{player_id}")["data"],
        "playlist": fetch(f"/playlists/{urllib.parse.quote(pl_name)}")["data"],
        "group": fetch(f"/groups/{group_id}")["data"],
    })
raw["library"] = all_files

with open(raw_path, "w") as f:
    json.dump(raw, f, indent=2, default=str)
print(f"Raw: {raw_path}")
