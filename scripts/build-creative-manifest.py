#!/usr/bin/env python3
"""
build-creative-manifest.py — Creative-library data layer for the "Naam" PWA.

WHAT THIS DOES
--------------
Projects the canonical HN creative registry (+ a few satellite sources) into ONE
slim, web-shaped manifest the Naam PWA reads, and renders tiny WebP thumbnails.

It does NOT rebuild the registry. The registry is the spine; this is a projection.

SOURCES JOINED
--------------
1. Canonical registry (the spine):
   ~/Documents/HN_Creative_Asset_Library/_registry/asset_registry.json   (2388 deduped assets; mtime, size, dedupe)
   ~/Documents/HN_Creative_Asset_Library/_registry/creative_asset_context.json (same assets + asset_id, title, subjects, asset_type, lanes, figma_control_file)
   Joined 1:1 on asset_id = sha1("{canonical_path}|{source_rel}|{size}")[:12]  (matches _tools/build_asset_context.py).

2. TV mission-control (deployed signage), 58 files:
   ~/Documents/Tech/hamza-express-site/ops/tv-mission-control/assets/**   -> lane=tv, status=deployed, source_store=repo-tv

3. Reel / video deliverables (rendered, with _claude.jpg proxy thumbs):
   ~/Documents/HE-Raw-Clips/Exports/*.mp4                                 -> lane=reel, source_store=raw-clips
   ~/Documents/HE-Raw-Clips/AI-Product-Shots/*.mp4                        -> lane=reel, source_store=raw-clips
   ~/Documents/Tech/he-video-engine/out/**/*.mp4                          -> lane=reel, source_store=video-engine

4. Raw reel clips with 4-axis intelligence:
   ~/Documents/HE-Raw-Clips/{Hanin,Hamza,Processed}/*.{mp4,mov}           -> lane=reel, source_store=raw-clips
   Tags (tier/menu_match/category/shot/mood/subject_x/viral/energy/speed) are parsed
   from HE-Raw-Clips/CLIP-INTELLIGENCE.md (Hanin + Hamza per-clip tables) and the
   use-bucketed HE-Raw-Clips/NEW-BATCH-2026-05-25-CLASSIFICATION.md, keyed by IMG_#### id.

5. Desktop deliverable folders (status signalled IN THE FOLDER NAME):
   ~/Desktop/Hamza_Meta_WABA_Voucher_Final_2026-05-25            -> HE/meta/final
   ~/Desktop/Hamza-Meta-WABA-*-Review-* , *_Prompt_*            -> HE/meta/draft
   ~/Desktop/NCH_Chai_Flask_Vendor_Final_*_REJECTED_DO_NOT_USE  -> NCH/packaging/rejected
   (image deliverables only; .md/.zip/.txt skipped)

OUTPUTS
-------
  naam/data/creative-manifest.json                  (Deliverable 1 — flat assets[] + counts envelope)
  naam/public/creative/thumb/<id>.webp              (Deliverable 2 — 512px long-edge WebP, ~20-40 KB)

IDEMPOTENT: existing thumbs are skipped (re-run only renders new/changed sources).
Thumbs prioritise marketing-action lanes; the ~1400 menu photos are rendered last
(and may be left thumbless if --skip-menu-thumbs is passed — the manifest still lists them).

USAGE (run on the laptop when new creatives are added — manual refresh, like snapshot-context.js):
  python3 scripts/build-creative-manifest.py
  python3 scripts/build-creative-manifest.py --skip-menu-thumbs   # fast: skip the 1400 menu photos
  python3 scripts/build-creative-manifest.py --no-thumbs          # manifest only

DEPENDENCIES: Python 3.9+ stdlib + Pillow (PIL). No npm, no heavy deps.
If WebP is unavailable, thumbs fall back to JPEG (still named per-id) and thumb_url
points at the .jpg. ffmpeg is used (if present) to extract a poster frame for videos
that lack a _claude.jpg proxy; if neither is available the asset is left thumbless.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent          # HN-Hotels-Site/
LIB = HOME / "Documents/HN_Creative_Asset_Library"
REG_DIR = LIB / "_registry"
REGISTRY_JSON = REG_DIR / "asset_registry.json"
CONTEXT_JSON = REG_DIR / "creative_asset_context.json"

TV_ASSETS = HOME / "Documents/Tech/hamza-express-site/ops/tv-mission-control/assets"
RAW_CLIPS = HOME / "Documents/HE-Raw-Clips"
VIDEO_ENGINE_OUT = HOME / "Documents/Tech/he-video-engine/out"
DESKTOP = HOME / "Desktop"

OUT_MANIFEST = REPO / "naam/data/creative-manifest.json"
THUMB_DIR = REPO / "naam/creative/thumb"
THUMB_URL_PREFIX = "./creative/thumb"  # RELATIVE — works at both /naam/ and naam.hnhotels.in root

THUMB_LONG_EDGE = 512
WEBP_QUALITY = 78
JPEG_QUALITY = 70
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
SKIP_THUMB_EXTS = {".fig", ".svg", ".pdf", ".ai"}   # UI uses a type badge for these

LANES = ["meta", "flyers", "packaging", "reel", "pisignage",
         "tv", "menu", "brand", "hero", "qr", "other"]

# ----------------------------------------------------------------------------
# PIL (required for image thumbs; degrade gracefully if missing)
# ----------------------------------------------------------------------------
try:
    from PIL import Image, features
    HAVE_PIL = True
    HAVE_WEBP = bool(features.check("webp"))
except Exception:                                       # pragma: no cover
    HAVE_PIL = False
    HAVE_WEBP = False

THUMB_EXT = "webp" if HAVE_WEBP else "jpg"


def have_ffmpeg() -> bool:
    from shutil import which
    return which("ffmpeg") is not None


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def stable_id(canonical_path, source_rel, size) -> str:
    """Mirror _tools/build_asset_context.py::stable_id so ids stay consistent."""
    raw = f"{canonical_path}|{source_rel}|{size}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def synth_id(*parts) -> str:
    """Stable 12-char id for assets that live OUTSIDE the registry (TV/reel/desktop)."""
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def iso_now_ist() -> str:
    return datetime.datetime.now(IST).replace(microsecond=0).isoformat()


def file_mtime_iso(p: Path) -> str:
    try:
        ts = p.stat().st_mtime
        return datetime.datetime.fromtimestamp(ts, IST).replace(microsecond=0).isoformat()
    except OSError:
        return iso_now_ist()


def date_only(iso_or_mtime) -> str:
    if not iso_or_mtime:
        return ""
    return str(iso_or_mtime)[:10]


def type_for_ext(ext: str) -> str:
    ext = ext.lower()
    if ext in VIDEO_EXTS:
        return "video"
    if ext == ".pdf":
        return "pdf"
    if ext == ".fig":
        return "figma"
    return "static"


# ----------------------------------------------------------------------------
# Registry category_dir / asset_type -> lane enum
# ----------------------------------------------------------------------------
def lane_from_registry(category_dir: str, category: str, asset_type: str) -> str:
    cd = (category_dir or "").lower()
    if cd.startswith("01_menu_photos"):
        return "menu"
    if cd.startswith("02_menu_documents"):
        return "menu"
    if cd.startswith("03_hero"):
        return "hero"
    if cd.startswith("04_meta_waba"):
        return "meta"
    if cd.startswith("05_pisignage"):
        return "pisignage"
    if cd.startswith("06_flyers"):
        return "flyers"
    if cd.startswith("07_hiring"):
        return "flyers"          # hiring creatives are print/flyer-shaped
    if cd.startswith("08_packaging"):
        return "packaging"
    if cd.startswith("09_outlet"):
        return "hero"            # outlet/product hero photography
    if cd.startswith("10_qr"):
        return "qr"
    if cd.startswith("00_brand_core"):
        return "brand"
    if cd.startswith("11_figma_source"):
        return "brand"
    return "other"


# ----------------------------------------------------------------------------
# Status resolution
# ----------------------------------------------------------------------------
def status_for_path(path_str: str, in_library: bool = True, deployed: bool = False) -> str:
    p = path_str or ""
    if "REJECTED" in p.upper():
        return "rejected"
    if deployed:
        return "deployed"
    if re.search(r"_final_|_final\b|/.*final.*/", p, re.IGNORECASE) and "Desktop" in p:
        return "final"
    if in_library:
        return "final"           # canonical library = curated/final
    return "draft"


# ----------------------------------------------------------------------------
# Tags from registry record
# ----------------------------------------------------------------------------
def tags_from_ctx(rec: dict) -> list:
    tags = []
    for s in (rec.get("subjects") or []):
        if s and s not in tags:
            tags.append(s)
    at = rec.get("asset_type")
    if at and at not in tags:
        tags.append(at)
    qc = rec.get("quality_class")
    if qc and qc not in ("unknown",) and qc not in tags:
        tags.append(qc)
    return tags[:12]


# ----------------------------------------------------------------------------
# Reel intelligence parser (CLIP-INTELLIGENCE.md + NEW-BATCH classification)
# ----------------------------------------------------------------------------
def parse_reel_intel():
    """Return {img_id: reel_intel_dict} keyed by 'IMG_8145' style ids."""
    intel = {}

    ci = RAW_CLIPS / "CLIP-INTELLIGENCE.md"
    if ci.exists():
        for line in ci.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("| "):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            # Schema: # | Clip | Dur | Res | Tier | Menu Match | Category | Shot | Mood | SubjX | Description | Viral | Energy | Speed
            if len(cells) < 14:
                continue
            clip = cells[1]
            m = re.search(r"IMG[_ ]?(\d+)", clip)
            if not m:
                continue
            img_id = "IMG_" + m.group(1)
            tier = cells[4]
            if not re.match(r"^T[123]$", tier):
                continue   # skip header / divider rows
            menu = cells[5].replace("**", "").strip()
            menu = "" if menu in ("—", "-", "~", "") else menu
            try:
                subj_x = float(cells[9])
            except ValueError:
                subj_x = None
            try:
                viral = int(cells[11])
            except ValueError:
                viral = None
            intel[img_id] = {
                "tier": tier,
                "menu_match": menu or None,
                "category": [c.strip() for c in cells[6].split(",") if c.strip()],
                "shot": cells[7] or None,
                "mood": cells[8] or None,
                "subject_x": subj_x,
                "viral": viral,
                "energy": cells[12] or None,
                "speed": cells[13] or None,
                "source_doc": "CLIP-INTELLIGENCE.md",
            }

    # NEW-BATCH: use-bucketed tables -> coarse tier/menu_match per IMG id
    nb = RAW_CLIPS / "NEW-BATCH-2026-05-25-CLASSIFICATION.md"
    if nb.exists():
        for line in nb.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("| ") or "`IMG_" not in line:
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 2:
                continue
            use = cells[0]
            ids = re.findall(r"IMG_(\d+)", cells[1])
            for n in ids:
                img_id = "IMG_" + n
                if img_id in intel:
                    continue   # per-clip table wins
                intel[img_id] = {
                    "tier": None,
                    "menu_match": use or None,
                    "category": [],
                    "shot": None,
                    "mood": None,
                    "subject_x": None,
                    "viral": None,
                    "energy": None,
                    "speed": None,
                    "source_doc": "NEW-BATCH-2026-05-25-CLASSIFICATION.md",
                }
    return intel


def img_id_of(filename: str):
    m = re.match(r"^IMG[_ ]?(\d+)", filename)
    return ("IMG_" + m.group(1)) if m else None


# ----------------------------------------------------------------------------
# Thumbnail generation
# ----------------------------------------------------------------------------
def resolve_source(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path


def image_dimensions(path: Path):
    if not HAVE_PIL:
        return None
    try:
        with Image.open(path) as im:
            return im.width, im.height
    except Exception:
        return None


def make_thumb_from_image(src: Path, dst: Path) -> bool:
    try:
        with Image.open(src) as im:
            im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
            im.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE), Image.LANCZOS)
            if THUMB_EXT == "webp":
                im.save(dst, "WEBP", quality=WEBP_QUALITY, method=4)
            else:
                im.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return True
    except Exception as e:
        print(f"    ! thumb fail {src.name}: {e}", file=sys.stderr)
        return False


def extract_poster(video: Path, tmp_jpg: Path) -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", str(video),
             "-frames:v", "1", "-q:v", "3", str(tmp_jpg)],
            check=True, timeout=30,
        )
        return tmp_jpg.exists()
    except Exception:
        return False


def video_proxy(video: Path):
    """Return the _claude.jpg proxy sibling if present."""
    cand = video.with_name(video.stem + "_claude.jpg")
    return cand if cand.exists() else None


def ensure_thumb(asset_id: str, src: Path, atype: str, ffmpeg_ok: bool):
    """Generate thumb if missing. Returns ('ok'|'skip'|'exists'|'fail', dims_or_None)."""
    dst = THUMB_DIR / f"{asset_id}.{THUMB_EXT}"
    if dst.exists():
        return "exists", None
    if not HAVE_PIL:
        return "skip", None
    ext = src.suffix.lower()

    if atype == "video":
        proxy = video_proxy(src)
        if proxy:
            ok = make_thumb_from_image(proxy, dst)
            return ("ok" if ok else "fail"), (image_dimensions(proxy) if ok else None)
        if ffmpeg_ok:
            tmp = THUMB_DIR / f".{asset_id}.poster.jpg"
            if extract_poster(src, tmp):
                ok = make_thumb_from_image(tmp, dst)
                dims = image_dimensions(tmp) if ok else None
                try:
                    tmp.unlink()
                except OSError:
                    pass
                return ("ok" if ok else "fail"), dims
        return "skip", None

    if ext in SKIP_THUMB_EXTS:
        return "skip", None
    if ext in IMAGE_EXTS:
        if not src.exists():
            return "skip", None
        dims = image_dimensions(src)
        ok = make_thumb_from_image(src, dst)
        return ("ok" if ok else "fail"), (dims if ok else None)
    return "skip", None


# ----------------------------------------------------------------------------
# Asset assembly
# ----------------------------------------------------------------------------
def aspect_ratio_str(w, h):
    if not w or not h:
        return None
    from math import gcd
    g = gcd(w, h)
    return f"{w // g}:{h // g}"


def build_registry_assets():
    reg = json.loads(REGISTRY_JSON.read_text())
    ctx = json.loads(CONTEXT_JSON.read_text())
    reg_by_id = {stable_id(r.get("canonical_path"), r.get("source_rel"), r.get("size")): r
                 for r in reg}
    assets = []
    for c in ctx:
        aid = c["asset_id"]
        r = reg_by_id.get(aid, {})
        ext = (c.get("ext") or r.get("ext") or "").lower()
        lane = lane_from_registry(c.get("category_dir"), r.get("category"), c.get("asset_type"))
        canonical = c.get("canonical_path") or r.get("canonical_path")
        assets.append({
            "id": aid,
            "brand": c.get("brand") or r.get("brand"),
            "lane": lane,
            "type": type_for_ext(ext),
            "title": c.get("title") or (r.get("name") or "").rsplit(".", 1)[0],
            "thumb_url": f"{THUMB_URL_PREFIX}/{aid}.{THUMB_EXT}",
            "full_url_or_path": canonical,
            "dimensions": None,          # filled during thumb pass (context dims are null)
            "aspect_ratio": c.get("aspect_ratio"),
            "bytes": int(c.get("size_bytes") or r.get("size") or 0),
            "created_date": date_only(r.get("mtime")),
            "status": status_for_path(canonical, in_library=True),
            "deployment": None,
            "tags": tags_from_ctx(c),
            "reel_intel": None,
            "source_store": "library",
            "duplicate_count": int(r.get("duplicate_count", c.get("duplicate_count", 0)) or 0),
            "_src": canonical,           # internal, stripped before write
        })
    return assets


def build_tv_assets():
    assets = []
    if not TV_ASSETS.exists():
        return assets
    for p in sorted(TV_ASSETS.rglob("*")):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext not in (VIDEO_EXTS | IMAGE_EXTS):
            continue
        rel = p.relative_to(TV_ASSETS)
        aid = synth_id("tv", str(rel), p.stat().st_size)
        is_locked = "LOCKED" in str(rel) or "DESKTOP_FINAL" in str(rel)
        assets.append({
            "id": aid,
            "brand": "HE",
            "lane": "tv",
            "type": type_for_ext(ext),
            "title": p.stem.replace("_", " "),
            "thumb_url": f"{THUMB_URL_PREFIX}/{aid}.{THUMB_EXT}",
            "full_url_or_path": str(p),
            "dimensions": None,
            "aspect_ratio": None,
            "bytes": p.stat().st_size,
            "created_date": date_only(file_mtime_iso(p)),
            "status": "deployed",
            "deployment": {"url": "https://hamzaexpress.in/ops/tv-mission-control/",
                           "live_ids": {"pisignage_category": "HE-TV-V2"}},
            "tags": ["tv-signage", str(rel.parts[0])] + (["locked"] if is_locked else []),
            "reel_intel": None,
            "source_store": "repo-tv",
            "duplicate_count": 0,
            "_src": str(p),
        })
    return assets


def build_reel_assets(reel_intel):
    assets = []
    seen_paths = set()

    def add(p: Path, store: str):
        if p in seen_paths:
            return
        seen_paths.add(p)
        ext = p.suffix.lower()
        rel = p.name
        aid = synth_id("reel", store, str(p), p.stat().st_size)
        img_id = img_id_of(p.name)
        intel = reel_intel.get(img_id) if img_id else None
        tags = ["reel"]
        if intel:
            if intel.get("tier"):
                tags.append(intel["tier"])
            tags += [c for c in (intel.get("category") or [])]
        assets.append({
            "id": aid,
            "brand": "HE",
            "lane": "reel",
            "type": type_for_ext(ext),
            "title": p.stem.replace("_", " "),
            "thumb_url": f"{THUMB_URL_PREFIX}/{aid}.{THUMB_EXT}",
            "full_url_or_path": str(p),
            "dimensions": None,
            "aspect_ratio": None,
            "bytes": p.stat().st_size,
            "created_date": date_only(file_mtime_iso(p)),
            "status": "draft",
            "deployment": None,
            "tags": tags[:12],
            "reel_intel": intel,
            "source_store": store,
            "duplicate_count": 0,
            "_src": str(p),
        })

    # rendered reel deliverables
    for sub in ("Exports", "AI-Product-Shots"):
        d = RAW_CLIPS / sub
        if d.exists():
            for p in sorted(d.rglob("*")):
                if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                    add(p, "raw-clips")
    if VIDEO_ENGINE_OUT.exists():
        for p in sorted(VIDEO_ENGINE_OUT.rglob("*")):
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                add(p, "video-engine")

    # raw cataloged clips (carry the 4-axis intelligence)
    for sub in ("Hanin", "Hamza", "Processed"):
        d = RAW_CLIPS / sub
        if d.exists():
            for p in sorted(d.rglob("*")):
                if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                    add(p, "raw-clips")
    return assets


DESKTOP_FOLDERS = [
    ("Hamza_Meta_WABA_Voucher_Final_2026-05-25", "HE", "meta", "final"),
    ("Hamza-Meta-WABA-Gemini-Free-Design-Review-2026-05-23", "HE", "meta", "draft"),
    ("Hamza-Meta-WABA-Voucher-AB-Review-2026-05-23", "HE", "meta", "draft"),
    ("Hamza_AIStudio_Meta_WABA_Voucher_Prompt_2026-05-23", "HE", "meta", "draft"),
    ("NCH_Chai_Flask_Vendor_Final_2026-05-28_REJECTED_DO_NOT_USE", "NCH", "packaging", "rejected"),
]


def build_desktop_assets():
    assets = []
    for folder, brand, lane, status in DESKTOP_FOLDERS:
        base = DESKTOP / folder
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext not in (IMAGE_EXTS | {".pdf"}):
                continue
            if ext in IMAGE_EXTS and "CONTACT_SHEET" in p.name.upper():
                # keep contact sheets, they are useful overviews
                pass
            aid = synth_id("desktop", folder, p.name, p.stat().st_size)
            assets.append({
                "id": aid,
                "brand": brand,
                "lane": lane,
                "type": type_for_ext(ext),
                "title": p.stem.replace("_", " "),
                "thumb_url": f"{THUMB_URL_PREFIX}/{aid}.{THUMB_EXT}",
                "full_url_or_path": str(p),
                "dimensions": None,
                "aspect_ratio": None,
                "bytes": p.stat().st_size,
                "created_date": date_only(file_mtime_iso(p)),
                "status": status,
                "deployment": None,
                "tags": [lane, status, "desktop-deliverable"],
                "reel_intel": None,
                "source_store": "desktop-final",
                "duplicate_count": 0,
                "_src": str(p),
            })
    return assets


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Build Naam creative manifest + thumbs.")
    ap.add_argument("--no-thumbs", action="store_true", help="manifest only; skip thumb rendering")
    ap.add_argument("--skip-menu-thumbs", action="store_true",
                    help="skip thumbs for the ~1400 menu-lane photos (manifest still lists them)")
    args = ap.parse_args()

    if not REGISTRY_JSON.exists() or not CONTEXT_JSON.exists():
        sys.exit(f"Registry not found under {REG_DIR}")

    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    print("Parsing reel intelligence ...")
    reel_intel = parse_reel_intel()
    print(f"  {len(reel_intel)} clip intelligence records")

    print("Building asset set ...")
    assets = (build_registry_assets() + build_tv_assets()
              + build_reel_assets(reel_intel) + build_desktop_assets())

    # de-dup by id (synth ids are path+size stable; registry ids unique)
    by_id = {}
    for a in assets:
        by_id.setdefault(a["id"], a)
    assets = list(by_id.values())
    print(f"  {len(assets)} total assets")

    # ---- thumbnails ----
    counts_thumb = {"ok": 0, "exists": 0, "skip": 0, "fail": 0}
    failed = []
    if not args.no_thumbs:
        ffmpeg_ok = have_ffmpeg()
        if not HAVE_PIL:
            print("  PIL unavailable — skipping all thumbs.", file=sys.stderr)
        # priority order: marketing-action lanes first, menu last
        lane_priority = {l: i for i, l in enumerate(
            ["meta", "flyers", "packaging", "tv", "pisignage", "reel",
             "hero", "brand", "qr", "other", "menu"])}
        ordered = sorted(assets, key=lambda a: lane_priority.get(a["lane"], 99))
        total = len(ordered)
        for i, a in enumerate(ordered):
            if a["lane"] == "menu" and args.skip_menu_thumbs:
                counts_thumb["skip"] += 1
                continue
            src = resolve_source(Path(a["_src"])) if a.get("_src") else None
            if not src:
                counts_thumb["skip"] += 1
                continue
            status, dims = ensure_thumb(a["id"], src, a["type"], ffmpeg_ok)
            counts_thumb[status] = counts_thumb.get(status, 0) + 1
            if status == "fail":
                failed.append(a["full_url_or_path"])
            if dims and not a["dimensions"]:
                a["dimensions"] = {"w": dims[0], "h": dims[1]}
                if not a["aspect_ratio"]:
                    a["aspect_ratio"] = aspect_ratio_str(dims[0], dims[1])
            if (i + 1) % 250 == 0:
                print(f"  thumbs {i+1}/{total} ...")

    # fill dimensions for any thumbed asset we didn't capture (cheap re-read for images)
    # (skipped: dims already captured during ensure_thumb)

    # ---- mark thumb presence / strip internal fields ----
    for a in assets:
        tp = THUMB_DIR / f"{a['id']}.{THUMB_EXT}"
        if not tp.exists():
            a["thumb_url"] = None
        a.pop("_src", None)

    # ---- counts envelope ----
    def tally(key):
        out = {}
        for a in assets:
            out[a[key]] = out.get(a[key], 0) + 1
        return out

    manifest = {
        "schema_version": 1,
        "generated_at": iso_now_ist(),
        "source_registry_mtime": file_mtime_iso(REGISTRY_JSON),
        "counts": {
            "total": len(assets),
            "by_brand": tally("brand"),
            "by_lane": tally("lane"),
            "by_status": tally("status"),
        },
        "lanes": LANES,
        "assets": sorted(assets, key=lambda a: (a["lane"], a["brand"] or "", a["title"] or "")),
    }

    OUT_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    size = OUT_MANIFEST.stat().st_size

    # ---- report ----
    print("\n=== DONE ===")
    print(f"manifest: {OUT_MANIFEST}  ({size:,} bytes)")
    print(f"total assets: {len(assets)}")
    print(f"by_brand:  {manifest['counts']['by_brand']}")
    print(f"by_lane:   {manifest['counts']['by_lane']}")
    print(f"by_status: {manifest['counts']['by_status']}")
    print(f"thumbs:    generated={counts_thumb['ok']} existing={counts_thumb['exists']} "
          f"skipped={counts_thumb['skip']} failed={counts_thumb['fail']}  (ext=.{THUMB_EXT})")
    if failed:
        print(f"failed thumb sources ({len(failed)}):")
        for f in failed[:25]:
            print("  -", f)


if __name__ == "__main__":
    main()
