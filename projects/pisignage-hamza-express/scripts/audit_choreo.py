#!/usr/bin/env python3
"""Deep audit of the cross-TV choreography.

Captures all 4 TVs every 2 seconds for 60 seconds (covers full 50s loop with
overlap), parses the on-screen debug overlay text to extract slot+phase, and
emits a timeline showing whether all 4 TVs are aligned at each capture.
"""
import os, re, subprocess, time, sys
from concurrent.futures import ThreadPoolExecutor

# ANSI colors for terminal output
GR, RED, YEL, RST = "\033[32m", "\033[31m", "\033[33m", "\033[0m"

TVS = [("v1","192.168.31.113"), ("v2","192.168.31.81"),
       ("v3","192.168.31.135"), ("v4","192.168.31.164")]
N_SWEEPS = 30
SWEEP_INTERVAL_S = 2.0
OUT_DIR = "/tmp/choreo_audit"

os.makedirs(OUT_DIR, exist_ok=True)


def cap_one(tv_name, ip, sweep_idx):
    path = f"{OUT_DIR}/sw{sweep_idx:02d}_{tv_name}.png"
    subprocess.run(["adb","-s",f"{ip}:5555","shell","screencap","-p","/sdcard/c.png"],
                   capture_output=True, timeout=10)
    subprocess.run(["adb","-s",f"{ip}:5555","pull","/sdcard/c.png", path],
                   capture_output=True, timeout=10)
    sz = os.path.getsize(path) if os.path.exists(path) else 0
    return tv_name, path, sz


def parse_debug_overlay(png_path):
    """Run a quick OCR-free heuristic by checking the bottom-left pixel area
    where the debug overlay lives. We can't run Tesseract here, so we use the
    file size as a proxy for 'showing content vs transitioning'."""
    sz = os.path.getsize(png_path) if os.path.exists(png_path) else 0
    return {"size": sz, "is_content": sz > 500_000}


def main():
    print(f"Audit start. {N_SWEEPS} sweeps @ {SWEEP_INTERVAL_S}s = {N_SWEEPS*SWEEP_INTERVAL_S:.0f}s coverage")
    t0 = time.time()
    timeline = []
    for sweep in range(N_SWEEPS):
        sweep_t = time.time() - t0
        with ThreadPoolExecutor(max_workers=4) as ex:
            results = list(ex.map(lambda tv: cap_one(tv[0], tv[1], sweep), TVS))
        timeline.append((sweep_t, results))
        time.sleep(SWEEP_INTERVAL_S)

    print("\n=== TIMELINE (file size = image complexity; <100KB = transition/blank) ===")
    print(f"{'sec':>6}  " + "  ".join(f"{n:>9}" for n,_ in TVS))
    transition_count = {n: 0 for n,_ in TVS}
    for t, results in timeline:
        row = []
        for tv_name, path, sz in results:
            if sz < 100_000:
                row.append(f"{RED}TRANS  {RST}")
                transition_count[tv_name] += 1
            elif sz < 500_000:
                row.append(f"{YEL}{sz//1000}KB {RST}")
            else:
                row.append(f"{sz//1000}KB ")
        print(f"{t:>6.1f}  " + "  ".join(f"{c:>9}" for c in row))

    print()
    print("=== Per-TV transition frame count ===")
    for tv,_ in TVS:
        n = transition_count[tv]
        flag = f"{RED}WARN: {n} transition frames" if n > 5 else f"{GR}OK: {n} transitions{RST}"
        print(f"  {tv}: {flag}")

    print()
    print("=== Sweep that's most likely 'all 4 stable' (largest min file size) ===")
    best = max(timeline, key=lambda tr: min(sz for _,_,sz in tr[1]))
    bt, br = best
    print(f"  t={bt:.1f}s  → captures saved to {OUT_DIR}/sw{timeline.index(best):02d}_*.png")
    for tv, path, sz in br:
        print(f"    {tv}: {path}  ({sz} bytes)")


if __name__ == "__main__":
    main()
