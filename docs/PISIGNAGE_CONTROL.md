# PiSignage Programmatic Control · HE Outlet · 2026-05-01

This is the canonical reference for controlling Hamza Express's PiSignage deployment from Claude Code or any future automation.

## Account

| | |
|---|---|
| **Dashboard URL** | https://hamzaexpress.pisignage.com |
| **API Base URL** | https://hamzaexpress.pisignage.com/api |
| **Login email** | hnhotelsindia@gmail.com |
| **Subscription** | Standard $60/yr · 5 of 7 licenses used (2 free + 3 paid) · 6 GB storage · valid till 2027-02-26 · next billing 2026-05-26 |
| **Server version** | 3.9.7 |
| **UI version** | 1.0.2 |

---

## Authentication strategies (ranked best → worst)

### A · API Token via POST /api/session (CONFIGURED · 4-hour TTL · refreshable)

The v2 UI does **not** expose "Generate API Token" — that button only existed in the old AngularJS UI (retired). The token is a 4-hour JWT from `POST /api/session`. Token is **currently saved** in `.env.local`.

**To refresh** (PiSignage sends an email OTP on new-IP logins even with TOTP 2FA off):

```bash
# Step 1: trigger OTP — check hnhotelsindia@gmail.com for 6-digit code
curl -s -X POST https://hamzaexpress.pisignage.com/api/session \
  -H "Content-Type: application/json" \
  -d '{"email":"hnhotelsindia@gmail.com","password":"PASS","getToken":true}' | python3 -m json.tool

# Step 2: submit OTP (parameter name is "code", not "otp") + save token
NEW_TOKEN=$(curl -s -X POST https://hamzaexpress.pisignage.com/api/session \
  -H "Content-Type: application/json" \
  -d '{"email":"hnhotelsindia@gmail.com","password":"PASS","getToken":true,"code":"OTP_HERE"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['token'])")

# Upsert into .env.local
if grep -q PISIGNAGE_TOKEN .env.local; then
  sed -i '' "s|^PISIGNAGE_TOKEN=.*|PISIGNAGE_TOKEN=$NEW_TOKEN|" .env.local
else
  echo "PISIGNAGE_TOKEN=$NEW_TOKEN" >> .env.local
fi
```

Auth header for all API calls: `x-access-token: $PISIGNAGE_TOKEN`

⚠️ Token expires in **4 hours**. Re-run Step 2 any time scripts return 401.  
⚠️ 2FA (TOTP) is DISABLED on account. Location-based email OTP still fires for new IPs.

### B · Session cookie via Chrome MCP (CURRENT WORKING METHOD)

Requires user to be logged in to PiSignage in their Chrome browser. Claude in Chrome MCP can then call `/api/*` endpoints with `credentials: 'include'` to use the session cookie.

Verified working endpoints:
- GET `/api/players` (200)
- GET `/api/playlists` (200)
- GET `/api/files` (200)
- GET `/api/users/me` (200)
- POST `/api/playlists/<name>` with `{assets:[...]}` (200 · saves playlist)
- POST `/api/groups/<groupId>` with `{playlists:[...], settings:{}}` (200 · assigns playlist to group)

### C · /api/session POST (works only without 2FA)

```
POST /api/session
{ "email": "...", "password": "...", "getToken": true }
```

Returns JWT (4-hr TTL). Note: Claude cannot enter passwords on user's behalf — user must run this manually if desired.

---

## Device / Player Map (fully verified · 2026-05-01)

All 5 PiSignage devices. 6th TV (TV-H2 outdoor) is USB MARQ standalone — not in PiSignage.

| Device | CPU Serial | Internal `_id` | Group | Playlist | Orientation | Content |
|---|---|---|---|---|---|---|
| Menu Display - Page 1 | `5000-0000-5ac7-e22f` | `69a0bd975b9a6c146ac9dfae` | `Menu Screen 3 - Page 1` (`69a0c685c219823ea50b6532`) | `Menu Page 1` | **VERTICAL** 1080×1920 | COMBOS |
| Menu Display - Page 2 | `5000-0000-3663-ed95` | `69a0dd165b9a6c146ad84a85` | `Menu Screen 2 - Page 2` (`69a0a25ac219823ea504241d`) | `Menu Page 2` | **VERTICAL** 1080×1920 | KATHI |
| Menu Display - Page 3 | `5000-0000-00c9-a687` | `69a0dd165b9a6c146ad84a7d` | `Menu Screen 1 - Page 3` (`69a0a259c219823ea50423bf`) | `Menu Page 3` | **VERTICAL** 1080×1920 | SHAWARMA |
| Bain Marie - KDS | `5000-0000-d983-526a` | `69a060985b9a6c146a9dc94f` | `Bain Marie - KDS` (`69a0b678c219823ea507ef1e`) | `KDS Bain Marie` | **VERTICAL** 1080×1920 | SHEEK |
| Kitchen Pass - KDS | `5000-0000-4532-2d4d` | `69a05aad5b9a6c146a9ae416` | `Kitchen Pass - KDS` (`69a0b677c219823ea507ef0e`) | `KDS Kitchen Pass` | **HORIZONTAL** 1920×1080 | GRILL |

**TV-H2 outdoor (6th TV — arrives tomorrow):** USB MARQ standalone LED. Not in PiSignage. Requires manual USB drive with JPGs.

**Note on naming confusion:** Group names don't match player names in order — "Menu Screen 1" contains Page 3, "Menu Screen 3" contains Page 1. Don't rely on number matching; use the IDs above.

### Physical placement and orientation

```
OUTLET FLOOR PLAN (simplified)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 [TV-V2]  [TV-V1]  [TV-V3]   ← 3 vertical menu screens, customer-facing
  KATHI   COMBOS  SHAWARMA     mounted on wall above counter

 ─ ─ ─ ─ counter / pass-through ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
 
 [TV-H1 Kitchen Pass KDS] ← HORIZONTAL, visible to kitchen staff
    GRILL (landscape 1920×1080)

 [TV-V4 Bain Marie KDS]   ← VERTICAL, at bain marie station
    SHEEK (portrait 1080×1920)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Why the KDS screens are different orientations:**
- **TV-H1 (Kitchen Pass, horizontal):** Mounted at eye-level horizontally so kitchen staff can see orders while plating. Landscape is wider → shows more info side-by-side.
- **TV-V4 (Bain Marie, vertical):** Mounted in portrait next to bain marie warmers. Portrait fits tall station better.

---

## Aspect Ratios (exact specs · drop-in compatible)

| Surface | Video spec | Static PNG spec | Notes |
|---|---|---|---|
| TV-V1/V2/V3/V4 (vertical) | **1080 × 1920** MP4 | **2151 × 3855** PNG | PiSignage scales PNG to screen native res |
| TV-H1 (horizontal) | **1920 × 1080** MP4 | **3840 × 2160** PNG | |
| TV-H2 outdoor USB | **1920 × 1080** JPG | — | USB MARQ standalone, numbered files |

Both video aspect ratios (9:16 and 16:9) are exact. Static PNGs are 2× resolution for crisp display on 4K screens.

---

## Complete Deploy Flow (fully verified · 2026-05-01)

```
STEP 1: Upload asset to PiSignage library
  Method A: UI → /v2/assets/ → Add Asset → Choose files (1 user OS file-pick)
  Method B: curl POST /api/files/upload -H "x-access-token: $TOKEN" -F "assets=@file.mp4"

STEP 2: Update playlist content (REPLACES assets array entirely)
  POST /api/playlists/<encoded-name>
  Body: { "assets": [{filename, duration, fullscreen, selected, option}], "settings": {}, "layout": "1" }
  ✅ If device already has this playlist assigned → AUTO-SYNCS within 60–180s. Done.
  ❌ If this is a NEW playlist assignment → steps 3+4a are also required.

STEP 3: Assign playlist to group (only for new/changed assignments)
  POST /api/groups/<groupId>
  Body: { "playlists": [{"name": "<playlist>", "plType": "regular", ...}], "settings": {} }
  Returns 200 "Updated Group details"

STEP 4a: Deploy group (push to devices NOW · same endpoint as Step 3, called again)
  UI: Navigate to group page → click green "Deploy" button
  API: POST /api/groups/<groupId>  ← verified 2026-05-01 via Chrome MCP network tab
       Body: same structure as Step 3. PiSignage uses the second POST as the "trigger" to push.
  Without this: devices pick up on next heartbeat (may take hours).

STEP 4b: Re-deploy to individual screen (force immediate sync on stuck device)
  UI: Group page → click device row → Screen Details panel → click "Re-deploy" button
  API: POST /api/players/<player_internal_id>  ← verified 2026-05-01
       Body: empty {}
  Use this when a device shows wrong playlist after Steps 3+4a.
```

**Key rule:** STEP 2 alone is sufficient when the device is ALREADY assigned to the target playlist. Steps 3+4 are only needed when CHANGING which playlist a device's group uses. Use 4b as last resort for stuck devices.

---

## Playlist Update Pattern (Step 2 · verified working)

```javascript
fetch(`/api/playlists/${encodeURIComponent(playlistName)}`, {
  method: 'POST',
  credentials: 'include',  // or { 'x-access-token': TOKEN }
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assets: [{
      filename: 'TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4',
      duration: 10,
      fullscreen: true,
      selected: true,
      option: { main: false }
    }],
    settings: {},
    layout: '1',
    templateName: 'custom_layout.html'
  })
});
```

**This REPLACES the assets array entirely.** To add to existing, fetch playlist first, append to its `assets` array, then POST.

---

## Asset Upload (two-step API · verified from piathome docs)

The API requires TWO calls after a file upload — missing `POST /postupload` was a doc gap:

**Step 1: Upload the file**
```bash
curl -X POST https://hamzaexpress.pisignage.com/api/files \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -F "assets=@/path/to/video.mp4"
```

**Step 2: Store file details (MUST call immediately after upload)**
```bash
curl -X POST https://hamzaexpress.pisignage.com/api/postupload \
  -H "x-access-token: $PISIGNAGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"video.mp4"}'
```

Without Step 2, the file appears in storage but is not recognized by the playlist engine.

**Chrome MCP UI path** (when no token): Open `/v2/assets/` → click + Add Asset → click "video" tile → user clicks "Choose files" → Claude clicks Save & Continue. (The UI handles both steps internally.)

---

## API Endpoints Surface (full · verified from piathome.com/apidocs/ · 2026-05-01)

### Server API (base: `https://hamzaexpress.pisignage.com/api`)

| Tag | Method | Path | Purpose | Status |
|---|---|---|---|---|
| session | POST | `/session` | Login with email+password; `getToken:true` returns JWT | ✅ verified |
| session | DELETE | `/session` | Logout | — |
| session | POST | `/token-session` | Login using an existing token (refresh) | — |
| asset | GET | `/files` | List all uploaded files | ✅ |
| asset | POST | `/files` | Upload file(s) multipart | ✅ |
| asset | POST | `/postupload` | **REQUIRED after /files upload** — stores file details in DB | ⚠️ was missing from our docs |
| asset | GET | `/files/{file}` | Get single asset metadata | — |
| asset | POST | `/files/{file}` | Update/rename an asset | — |
| asset | DELETE | `/files/{file}` | Remove an asset | — |
| asset | POST | `/links` | Add a URL link as an asset | — |
| asset | POST | `/notices` | Create a notice asset | — |
| playlist | GET | `/playlists` | List all playlists with assets array | ✅ |
| playlist | POST | `/playlists/{name}` | Create/update playlist (replaces assets array) | ✅ |
| playlist | GET | `/playlists/{name}` | Get single playlist | — |
| playlist | DELETE | `/playlists/{name}` | Remove playlist | — |
| player | GET | `/players` | List all players (serial, group, playlist, online, disk, wget) | ✅ |
| player | POST | `/players` | Create new player | — |
| player | GET | `/players/{id}` | Single player details | ✅ |
| player | POST | `/players/{id}` | Update player / **Re-deploy** (empty body) | ✅ |
| player | DELETE | `/players/{id}` | Remove player | — |
| player | GET | `/screens` | List all players incl. collaborator accounts | — |
| player | POST | `/pitv/{id}` | Switch TV on/off via CEC | — |
| player | POST | `/playlistmedia/{id}/{action}` | Playlist media controls (pause/resume/next) | — |
| player | POST | `/setplaylist/{id}/{playlist}` | **Force-play a specific playlist once immediately** | — |
| group | GET | `/groups` | List all groups | — |
| group | POST | `/groups` | Create group | — |
| group | GET | `/groups/{groupId}` | Get group info | — |
| group | POST | `/groups/{groupId}` | **Update group AND deploy to devices** | ✅ |
| group | DELETE | `/groups/{groupId}` | Remove group | — |
| category | GET | `/labels/{id}` | Get category | — |
| category | POST | `/labels` | Create category | — |
| user | GET | `/users/me` | Current user info (no token field exposed) | ✅ |
| user | GET | `/downloadauth` | Pi device download credentials (user:`pi`, pass:`pi`) | ✅ |
| user | GET | `/installationsettings` | Installation-level settings | ✅ |
| user | POST | `/installationsettings` | Update installation settings | — |
| user | GET | `/licensedetails` | Subscription details (licenses, storage, credits, billing) | ✅ |
| user | GET | `/licenselist` | Individual player license objects | ✅ |
| report | GET | `/getevents` | Last 200 events log | — |

### Pi Player API (base: `http://<pi_ip>:8000/api`)
Direct device control when on same LAN. Uses Basic auth (default `pi:pi`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/play/playlists/{file}` | Play or stop a playlist |
| POST | `/play/files/{action}` | Play or stop a file |
| POST | `/playlistmedia/{action}` | Media controls |
| GET | `/status` | Player status |
| GET | `/settings` | Player settings |
| POST | `/settings/hostname` | Set device name |
| POST | `/settings/sleep` | Set TV on/off schedule |
| POST | `/settings/orienetation` | Set display orientation |
| GET | `/settings/wifiscan` | Scan available WiFi networks |

### Endpoints confirmed 404 (don't use)

- `/api/playlists/<name>/deploy`
- `/api/players/<id>/cmd`, `/sync`, `/resync`, `/installation`
- `/api/groups/<id>/deploy` ← deploy happens via POST `/api/groups/<id>` (no suffix)
- `/api/me`, `/api/profile`, `/api/account`, `/api/tokens`, `/api/api-keys`, `/api/auth/token`

---

## Sync timing observations (2026-05-01)

After updating an EXISTING playlist assignment via POST `/api/playlists/<name>`:
- Device's `lastReported` timestamp updates within ~60s
- Device begins downloading new asset (visible in `wgetSpeed` field)
- `filesQueue` shows download progress
- New playlist starts playing once ALL referenced assets are local
- Total: typically 2–5 minutes

After assigning a NEW playlist via `POST /api/groups/<groupId>` (Step 3):
- Device only picks up the change on next heartbeat OR after Step 4 (green Deploy button)
- Without Deploy button: may take hours; with Deploy button: ~2–5 min

---

## Current Creative Assets (v4 · 2026-05-01)

### Videos (in PiSignage library · uploaded 2026-05-01)

| Filename in PiSignage | Actual dimensions | Playlist target | TV |
|---|---|---|---|
| `TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4` | 1080×1920 (VERTICAL) | `Menu Page 1` | TV-V1 |
| `TV-Horizontal_GheeRice_Cinemagraph_v1.mp4` | 1920×1080 (HORIZONTAL) | `KDS Kitchen Pass` | TV-H1 |

### Local source files (Desktop · verified with mdls)

```
~/Desktop/HE_May1_v4_Creative_Production/10_Final_Outputs/Video/
  TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4   5.28 MB  1080×1920 ✅ VERTICAL
  TV-Horizontal_GheeRice_Cinemagraph_v1.mp4    5.88 MB  1920×1080 ✅ HORIZONTAL

~/Desktop/HE_May1_v4_Creative_Production/10_Final_Outputs/Static/
  TV-V1_GheeRice_Combo_Ladder_v1.png           7.39 MB  (2151×3855 VERTICAL)
  Gemini_FoodOnly_Vertical_for_Veo_v1.png      6.51 MB  (reference only)
```

### HTML creatives (ready to deploy as URL assets or screenshot-to-PNG)

```
~/Desktop/HE_May1_Launch_2026-04-30/Signage/
  V1_HeroOffer_Vertical.html       1080×1920  → TV-V1 or any vertical
  V2_Heritage_Vertical.html        1080×1920  → TV-V2 (KATHI slot backup)
  V3_ComboBreakdown_Vertical.html  1080×1920  → TV-V3 (SHAWARMA slot backup)
  V4_UrgencyCTA_Vertical.html      1080×1920  → any vertical
  H1_Hero_Horizontal.html          1920×1080  → TV-H1 (GRILL slot)
```

### Pending generation (not yet produced)

See `~/Desktop/HE_May1_v4_Creative_Production/07_MISSING_need_generation/MISSING_LIST.md`

TV-V2 (KATHI), TV-V3 (SHAWARMA), TV-V4 (SHEEK), TV-H1 final GRILL frame — all food reference photos needed via AI Studio Imagen 4.

---

## KNOWN BUG · 2026-05-01 · ✅ RESOLVED

### Symptom (was)
- TV-V1 (Menu Page 1, vertical) was playing the **horizontal** video ← wrong orientation
- TV-H1 (Kitchen Pass KDS, horizontal) was NOT playing the horizontal video ← stale

### Root cause
During group-deploy probing, `Menu Screen 3 - Page 1` group's playlist was accidentally changed to `KDS Bain Marie` instead of `Menu Page 1`. Stream timeout left both TVs in inconsistent state.

### Fix applied (2026-05-01)
1. Posted correct vertical video back to `Menu Page 1` playlist via Chrome MCP
2. Clicked Deploy on `Menu Screen 3 - Page 1` group page → `POST /api/groups/69a0c685c219823ea50b6532`
3. Clicked Re-deploy on TV-V1 Screen Details panel → `POST /api/players/69a0bd975b9a6c146ac9dfae`
4. Posted correct horizontal video to `KDS Kitchen Pass` playlist, clicked Deploy on Kitchen Pass group

### Confirmed fixed
- TV-V1: `playlist=Menu Page 1`, `wgetSpeed="current file:TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4"` ✅
- TV-H1: `playlist=KDS Kitchen Pass`, `wgetSpeed="current file:TV-Horizontal_GheeRice_Cinemagraph_v1.mp4"` ✅

---

## What Claude CAN do autonomously (with Chrome MCP + user logged in)

- Read all device status, playlists, files, asset metadata
- Update existing playlists (add/remove/replace assets)
- Assign playlists to groups (POST /api/groups/<groupId>)
- Verify deployment via player polling
- Probe new API endpoints
- Drive UI clicks for file upload (with 1 OS file-pick per file)

## What Claude CANNOT do (without user action)

- Generate or rotate the API token (requires password re-auth)
- Upload local files programmatically (Chrome MCP file_upload returns "Not allowed")
- Read HttpOnly session cookies (browser security)
- Enter any password on the user's behalf

---

## Deploy Flow Recipe (current capability)

```
1. User has Chrome open with PiSignage logged in + Claude-in-Chrome extension active
2. Generate creative (Gemini Imagen 4 / Veo 3.1) → save to Desktop
3. Claude drives Chrome MCP:
   - Navigate /v2/assets/
   - Click + Add Asset → click "video" or "image" tile
4. User clicks "Choose files" + selects file (1 OS dialog click)
5. Claude clicks Save & Continue
6. Claude calls POST /api/playlists/<target> with new assets array
7. If new assignment: Claude calls POST /api/groups/<groupId> with playlist
8. If new assignment: Navigate to group page → click green Deploy button
9. Claude polls GET /api/players/<id> every 30s until filesQueue clears + wgetSpeed shows new file
10. Done — TV plays new content within 2–5 min
```

---

## Helper scripts

All in `scripts/pisignage/`:

- `list-players.sh` — verify device status (requires PISIGNAGE_TOKEN)
- `update-playlist.sh` — update playlist assets (requires PISIGNAGE_TOKEN)
- `upload-asset.sh` — upload file via curl (requires PISIGNAGE_TOKEN)
- `fix-deployment.sh` — fix TV-V1/H1 bug: put correct videos in correct playlists (requires PISIGNAGE_TOKEN)

---

## Known good deployments (2026-05-01)

| Asset | Playlist | Device | Status |
|---|---|---|---|
| `TV-V1_GheeRice_Cinemagraph_vertical_v1.mp4` | Menu Page 1 | TV-V1 | ✅ LIVE |
| `TV-Horizontal_GheeRice_Cinemagraph_v1.mp4` | KDS Kitchen Pass | TV-H1 | ✅ LIVE |

---

## Subscription snapshot (verified 2026-05-01 via /api/licensedetails + UI)

| | |
|---|---|
| **Plan** | Standard |
| **Price** | $60/year (2 free forever + $20/screen/year after that) |
| **Licenses purchased** | 7 total (2 free + 5 paid slots) |
| **Licenses in use** | 5 (2 unused slots available — can add TV-H2 + 1 more free) |
| **Storage** | 6 GB total · 0.1 GB used · 5.9 GB free |
| **Content downloaded** | ~54 MB (of unlimited) |
| **Content uploaded** | ~11 MB |
| **Subscription expires** | 2027-02-26 (11 months remaining) |
| **Next billing** | 2026-05-26 |
| **Credits** | 60/cycle · 61 remaining · needs 5/month for 5 screens |
| **Whitelabel** | Unlocks at 50+ screens (not relevant) |

**Plan includes:** Cloud hosting, email support, all API access, template designer, collaborator accounts.

---

## Critical operational notes

1. **2FA is DISABLED** (disabled 2026-05-01 to enable `POST /api/session` token generation). Re-enable after `PISIGNAGE_TOKEN` is saved to `.env.local`.
2. **Original v3 menu PNGs are STILL in the asset library** — can be re-added to any playlist if needed.
3. **TV-H2 is standalone USB MARQ LED** — not part of PiSignage. Requires manual USB drive with JPGs in numbered order. Has 2 free license slots available if ever adding it to PiSignage.
4. **All Group IDs captured** — see Device/Player Map above. All 5 group IDs verified 2026-05-01.
5. **Asset upload requires two API calls** — `POST /api/files` then `POST /api/postupload`. UI handles this automatically; terminal scripts must do both.
6. **`POST /setplaylist/{playerId}/{playlist}`** — can force-play a playlist on a specific device once without changing the group assignment. Useful for testing a new playlist on one screen before deploying to all.
5. **Device IDs:** The `_id` field from `/api/players` is what PiSignage uses internally. The CPU serial number is what's shown on device config screens. Both are listed in the Device Map above.
