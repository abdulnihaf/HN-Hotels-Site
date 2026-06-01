# NVR Channel-Health Cron — hn-frigate

**Lives at:** `/home/hn/nvr-health/` on hn-frigate.  
**Runs:** every 30 minutes via systemd timer (`nvr-health.timer`).  
**Purpose:** detect when an NVR channel goes dark due to DHCP drift or camera
loss, and alert the operator before a recording gap matters.

## What the probe does

For each of the NVR's 16 channels:

1. Reads the NVR's stored `RemoteDevice` config (Address + MAC + camera Name).
2. Ping-sweeps `192.168.31.0/24` and rebuilds the ARP cache.
3. Classifies each channel:
   - `live` — NVR reports the camera Name field populated.
   - `drift` — Name empty; MAC alive on LAN at a **different IP** than NVR has.
   - `lost` — Name empty; MAC nowhere on LAN.
4. Tracks consecutive-dark cycles in SQLite. If a channel stays dark for ≥ 2
   cycles (≈ 1 hour), it fires a WABA alert via `hnhotels.in/api/comms` with
   template `nvr_channel_dark_v1`, including the new IP if it drifted.
5. Writes `/var/lib/nvr-health/state.json` (latest) + `history.ndjson` (log).

## Why the probe does NOT auto-heal

The CP Plus firmware (`1.00.14.00.R`, 2025-11-14) locks `RemoteDevice.Address`
writes via `configManager.cgi setConfig` (returns `Error`). The RPC2 JSON-RPC
endpoint returns HTTP 400 on every login-payload shape we tried — the web UI
talks to an internal websocket at `ws://127.0.0.1:23420/` that we cannot reach
from outside the NVR. Verified 2026-06-02.

**The detection IS the deliverable.** The probe surfaces drift + suggests the
new IP; the operator clicks "Modify" on the NVR UI to apply, OR pins a DHCP
reservation on JioFiber so drift cannot recur. See "Permanent fix" below.

## Install

```bash
# From the repo root, run on your laptop:
scp fleet/nvr-health/probe.py            hn@100.77.199.112:/home/hn/nvr-health/
scp fleet/nvr-health/nvr-health.service  hn@100.77.199.112:/tmp/
scp fleet/nvr-health/nvr-health.timer    hn@100.77.199.112:/tmp/

ssh hn@100.77.199.112 '
  sudo mv /tmp/nvr-health.service /etc/systemd/system/
  sudo mv /tmp/nvr-health.timer   /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now nvr-health.timer
  sudo systemctl start  nvr-health.service   # first run
  systemctl list-timers nvr-health.timer
  cat /var/lib/nvr-health/state.json | head -40
'
```

The `/home/hn/nvr-health/env` file holds optional secrets (do NOT commit):

```
NVR_PW=admin@123#
HN_COMMS_KEY=...               # from ~/.hn-assets.env on the laptop
```

Without `HN_COMMS_KEY` the probe still runs and writes state; alerts are
silently skipped.

## Reading state

- Latest snapshot: `/var/lib/nvr-health/state.json`
- Append-only log: `/var/lib/nvr-health/history.ndjson`
- SQLite for cycle counts: `/var/lib/nvr-health/state.db`
- Logs: `journalctl -u nvr-health.service -n 50`

## Failure modes the probe handles

- NVR unreachable → exit 2, no state file overwrite, no alert.
- ARP sweep finds nothing → MAC marked `lost`, escalates after 2 cycles.
- Camera drifted → reported as `drift` with `new_ip` field showing where it
  actually is. Operator can paste this into NVR UI's Modify dialog directly.
- DLT template not yet approved → alert POST may 4xx; logged in
  `state.json.alert_result` for visibility, never raises.

## Permanent fix (the COA "constraint")

This cron is a **catcher**, not a constraint. The constraint that makes drift
impossible is **DHCP reservations** on the JioFiber gateway at `192.168.31.1`:

- Log in to JioFiber admin (`http://192.168.31.1`).
- Network → DHCP → Static Lease (or "Reserved Address").
- For each of the 16 camera MACs in
  [memory/reference_cctv_device_directory.md], add a reservation pinning the
  MAC to the IP the NVR has stored.

Once that's in place, cameras get the same IP every lease cycle, and this cron
should never see a `drift` state again. It will keep running as a safety net
(catches `lost` from cable/PoE failure, which DHCP reservation can't prevent).

## Related

- Asset directory: `memory/reference_cctv_device_directory.md`
- Frigate context: `memory/project_cctv_slideshow_2026_05_28.md`
- Comms-core (alert path): `memory/reference_comms_hub.md`
