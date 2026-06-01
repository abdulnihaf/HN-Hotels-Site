#!/usr/bin/env python3
"""
NVR health probe — runs every 30 min on hn-frigate via systemd timer.

For each of the NVR's 16 channels:
  1. Read configured Address + Mac + VideoInputs[0].Name from RemoteDevice config.
  2. Look up the MAC's current LAN IP via ip-neigh (ARP cache).
  3. Decide channel state:
       LIVE    — VideoInputs[0].Name is populated (NVR sees the camera over CPPLUS)
       DRIFT   — Name empty AND MAC is alive on LAN at a different IP than Address
       LOST    — Name empty AND MAC nowhere on LAN (power / cable / camera dead)
  4. Track consecutive-dark cycles in SQLite.
  5. Emit state.json + history.ndjson.
  6. If a channel has been DRIFT/LOST for >= ESCALATE_AFTER cycles → POST a WABA
     alert via hnhotels.in/api/comms (template nvr_channel_dark_v1).

The probe does NOT auto-heal — RemoteDevice.Address writes are locked on this
CP Plus firmware (verified 2026-06-02). It surfaces the drift + the new IP so
the operator (Nihaf) can either click "Modify" in the NVR UI or — better — pin
DHCP reservations on the JioFiber router by MAC so drift cannot recur.

This is COA: closure by detection + escalation. The constraint that would make
drift impossible is the DHCP reservation step (see fleet/nvr-health/README.md).
"""
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import urllib.parse
import urllib.request
import ssl
import hashlib

NVR_HOST = "192.168.31.53"
NVR_USER = "admin"
NVR_PW = os.environ.get("NVR_PW", "admin@123#")
LAN_CIDR = "192.168.31.0/24"
STATE_DIR = Path("/var/lib/nvr-health")
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_JSON = STATE_DIR / "state.json"
HISTORY_NDJSON = STATE_DIR / "history.ndjson"
DB_PATH = STATE_DIR / "state.db"
ESCALATE_AFTER = 2  # cycles (1h with 30-min schedule)
COMMS_URL = "https://hnhotels.in/api/comms"
COMMS_KEY = os.environ.get("HN_COMMS_KEY", "")
TIMEOUT_S = 8

SSL_CTX = ssl._create_unverified_context()


def nvr_get(path: str) -> str:
    """Digest-auth GET against the NVR. Returns body text or ''."""
    url = f"https://{NVR_HOST}{path}"
    pm = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    pm.add_password(None, url, NVR_USER, NVR_PW)
    opener = urllib.request.build_opener(
        urllib.request.HTTPDigestAuthHandler(pm),
        urllib.request.HTTPSHandler(context=SSL_CTX),
    )
    try:
        with opener.open(url, timeout=TIMEOUT_S) as r:
            return r.read().decode(errors="replace")
    except Exception as e:
        return ""


def parse_remote_device(body: str):
    """
    Parse table.RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_N.<field>=<value>.
    Returns dict[ch_index] = {address, mac, name}.
    """
    out = {}
    for line in body.splitlines():
        if "NETCAMERA_INFO_" not in line:
            continue
        try:
            key, val = line.split("=", 1)
        except ValueError:
            continue
        # key example: table.RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_2.Address
        head, _, field = key.rpartition(".")
        if "VideoInputs[0]" in head:
            # head ends with ..._N.VideoInputs[0]; field is "Name"/"ServiceType"/...
            base = head.rsplit(".VideoInputs[0]", 1)[0]
        else:
            base = head
        idx_token = base.rsplit("NETCAMERA_INFO_", 1)[-1]
        try:
            idx = int(idx_token)
        except ValueError:
            continue
        rec = out.setdefault(idx, {})
        if field == "Address":
            rec["address"] = val.strip()
        elif field == "Mac":
            rec["mac"] = val.strip().lower()
        elif field == "Name" and "VideoInputs[0]" in head:
            rec["name"] = val.strip()
    return out


def arp_sweep_lan():
    """Trigger ARP refresh by ping-sweeping every host in /24, then read ip neigh."""
    octets = LAN_CIDR.split("/")[0].rsplit(".", 1)[0]
    procs = []
    for i in range(1, 255):
        procs.append(subprocess.Popen(
            ["ping", "-c1", "-W1", f"{octets}.{i}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ))
    # Don't actually wait for all 254 pings; give it 4s wall time
    deadline = time.time() + 4
    for p in procs:
        try:
            p.wait(timeout=max(0.01, deadline - time.time()))
        except subprocess.TimeoutExpired:
            pass
    # Re-collect any stragglers (avoid zombies)
    for p in procs:
        if p.poll() is None:
            p.kill()

    mac_to_ip = {}
    try:
        out = subprocess.check_output(
            ["ip", "neigh"], stderr=subprocess.STDOUT, text=True, timeout=4
        )
    except Exception:
        return mac_to_ip
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 5 or "lladdr" not in parts:
            continue
        ip = parts[0]
        if "." not in ip:  # skip ipv6
            continue
        try:
            li = parts.index("lladdr")
            mac = parts[li + 1].lower()
            state = parts[-1]
        except (ValueError, IndexError):
            continue
        if state in ("FAILED", "INCOMPLETE"):
            continue
        # Keep first seen; ip neigh shouldn't have dups for a MAC under normal LAN
        mac_to_ip.setdefault(mac, ip)
    return mac_to_ip


def open_db():
    db = sqlite3.connect(str(DB_PATH))
    db.execute("""CREATE TABLE IF NOT EXISTS channel_state (
        idx INTEGER PRIMARY KEY,
        mac TEXT,
        last_state TEXT,
        consecutive_dark INTEGER DEFAULT 0,
        last_alerted_at INTEGER DEFAULT 0,
        first_dark_at INTEGER DEFAULT 0,
        updated_at INTEGER
    )""")
    return db


def alert(channel_summaries, dark_now, dark_persistent):
    """POST WABA alert via comms-core. Best-effort, silent on failure."""
    if not COMMS_KEY or not dark_persistent:
        return None
    body_lines = ["NVR drift alert:"]
    for s in dark_persistent:
        line = f"CH{s['ch']:02d} {s['label']} dark for {s['cycles']} cycles"
        if s.get("new_ip"):
            line += f" — drifted to {s['new_ip']} (NVR has {s['configured_ip']})"
        else:
            line += " — MAC not on LAN (camera offline)"
        body_lines.append(line)
    payload = {
        "action": "send-template",
        "template": "nvr_channel_dark_v1",
        "to": "owner",
        "variables": {"body": "\n".join(body_lines)},
        "context": "nvr-health-cron",
    }
    req = urllib.request.Request(
        f"{COMMS_URL}?key={urllib.parse.quote(COMMS_KEY)}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return r.status
    except Exception as e:
        return f"err:{e}"


def main():
    started = datetime.now(timezone.utc)
    cfg_body = nvr_get("/cgi-bin/configManager.cgi?action=getConfig&name=RemoteDevice")
    if not cfg_body:
        sys.stderr.write("NVR unreachable\n")
        sys.exit(2)
    title_body = nvr_get("/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle")
    channels = parse_remote_device(cfg_body)

    # ChannelTitle has the operator-set names (used even when camera offline)
    titles = {}
    for line in title_body.splitlines():
        if ".Name=" not in line or "ChannelTitle[" not in line:
            continue
        key, val = line.split("=", 1)
        try:
            idx = int(key.split("[", 1)[1].split("]", 1)[0])
        except (IndexError, ValueError):
            continue
        titles[idx] = val.strip()

    mac_ip = arp_sweep_lan()
    db = open_db()
    now_s = int(time.time())

    channel_summaries = []
    dark_now = []
    dark_persistent = []

    for idx in range(16):
        rec = channels.get(idx, {})
        configured = rec.get("address", "")
        mac = rec.get("mac", "").lower()
        name_in_nvr = rec.get("name", "")
        label = titles.get(idx, name_in_nvr) or f"CH{idx+1:02d}"
        current_ip = mac_ip.get(mac, "") if mac else ""

        if name_in_nvr:
            state = "live"
        elif current_ip and current_ip != configured:
            state = "drift"
        elif current_ip:
            state = "ip-match-name-empty"
        else:
            state = "lost"

        row = db.execute(
            "SELECT consecutive_dark, first_dark_at, last_state FROM channel_state WHERE idx=?",
            (idx,),
        ).fetchone()
        prev_consec, first_dark, prev_state = (row or (0, 0, ""))
        if state == "live":
            consec = 0
            first_dark = 0
        else:
            consec = prev_consec + 1
            if first_dark == 0:
                first_dark = now_s

        db.execute("""
            INSERT INTO channel_state(idx, mac, last_state, consecutive_dark, first_dark_at, updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(idx) DO UPDATE SET
              mac=excluded.mac, last_state=excluded.last_state,
              consecutive_dark=excluded.consecutive_dark,
              first_dark_at=excluded.first_dark_at,
              updated_at=excluded.updated_at
        """, (idx, mac, state, consec, first_dark, now_s))

        summary = {
            "ch": idx + 1,
            "idx": idx,
            "label": label,
            "mac": mac,
            "configured_ip": configured,
            "current_ip": current_ip,
            "state": state,
            "cycles": consec,
            "first_dark_at": first_dark,
        }
        if current_ip and current_ip != configured:
            summary["new_ip"] = current_ip
        channel_summaries.append(summary)
        if state != "live":
            dark_now.append(summary)
            if consec >= ESCALATE_AFTER:
                dark_persistent.append(summary)
    db.commit()

    snapshot = {
        "captured_at": started.isoformat(),
        "captured_at_epoch": int(started.timestamp()),
        "nvr": NVR_HOST,
        "channels": channel_summaries,
        "dark_now": [s["ch"] for s in dark_now],
        "dark_persistent": [s["ch"] for s in dark_persistent],
        "lan_macs_seen": len(mac_ip),
    }
    STATE_JSON.write_text(json.dumps(snapshot, indent=2))
    with open(HISTORY_NDJSON, "a") as f:
        f.write(json.dumps({
            "ts": snapshot["captured_at"],
            "dark_now": snapshot["dark_now"],
            "dark_persistent": snapshot["dark_persistent"],
        }) + "\n")

    if dark_persistent:
        result = alert(channel_summaries, dark_now, dark_persistent)
        snapshot["alert_result"] = result
        STATE_JSON.write_text(json.dumps(snapshot, indent=2))

    db.close()
    if dark_now:
        print(f"{len(dark_now)} channel(s) dark: {[s['ch'] for s in dark_now]}", file=sys.stderr)
    else:
        print("all 16 channels live", file=sys.stderr)


if __name__ == "__main__":
    main()
