# Captain POS Guard — zero-leakage capture, reconciliation & WABA alerting

Guarantees **no captain-POS order is ever silently lost** (the "Session expired" /
network-drop failure that ate ~2 bills on 2026-05-24), by keeping the order in
**multiple independent durable logs** and alerting Nihaf on WABA the moment one
doesn't become a real Odoo bill.

## How it works (multi-log)

```
Captain tab (Chrome/Kiwi)                          Cloudflare                     Odoo (test.hamzahotel.com)
┌──────────────────────────┐    ingest (retry)    ┌──────────────────┐  reconcile  ┌────────────────────┐
│ extension                │ ───────────────────► │ /api/captain-    │ ──────────► │ pos.order (config 6)│
│  inject.js  hooks fetch  │                       │  pos-guard       │             └────────────────────┘
│  content.js IndexedDB ───┼── durable LOCAL log   │  D1: pos_capture  │  + Razorpay payments
│             (offline-safe)│                      │      events       │
└──────────────────────────┘                       │      discrepancies│ ──► WABA template
                                                    └──────────────────┘     captain_pos_discrepancy ──► Nihaf
```

1. Every rung order is written to the tab's **own IndexedDB the instant it's rung** — before any network call. Survives offline / crash / reload.
2. When internet returns, the extension **auto-drains** that log to `/api/captain-pos-guard?action=ingest` → D1 `pos_capture`.
3. The cron (`hn-captain-pos-guard-cron`, every 3 min) runs **reconcile**: proves each capture became a real `pos.order`; anything missing past the grace window, plus stuck drafts, stale sessions, and Razorpay-payment-without-bill → a **discrepancy** → **WABA to Nihaf** via the approved `captain_pos_discrepancy` template. **heartbeat** alerts if the POS goes silent during open hours.

## Deploy

1. **D1 schema** (DB `hn-hiring`, same as agent-notify):
   ```
   wrangler d1 execute hn-hiring --file=migrations/schema-captain-pos-guard.sql --remote
   ```
2. **Pages secrets** (project `hn-hotels-site`):
   ```
   wrangler pages secret put POS_ODOO_KEY        # HE prod Odoo key (HE_CLOUDFLARE_SECRETS_ODOO_API_KEY)
   wrangler pages secret put POS_GUARD_INGEST_TOKEN   # random; also goes in the extension
   wrangler pages secret put RAZORPAY_KEY_ID     # optional — enables payment reconciliation
   wrangler pages secret put RAZORPAY_KEY_SECRET  # optional
   # already present: CRON_TOKEN, WA_HE_PHONE_ID, WA_HE_TOKEN, DB binding
   ```
   Non-secret vars (wrangler.toml [vars] or dashboard): `POS_ODOO_URL=https://test.hamzahotel.com/jsonrpc`, `POS_ODOO_DB=main`, `POS_ODOO_UID=2`, `NIHAF_PHONE=917010426808`.
   The Function auto-deploys with the Pages project on push to `main`.
3. **Cron worker:**
   ```
   cd workers/captain-pos-guard-cron
   wrangler secret put CRON_TOKEN     # must match Pages CRON_TOKEN
   wrangler deploy
   ```
4. **WABA template** `captain_pos_discrepancy` (UTILITY, 5 vars) — already submitted (id 5214427278782890), PENDING approval. No action unless rejected.

## Install the capture extension on the captain tab

Chrome for Android can't load extensions, so use **Kiwi Browser** (or Mises — same code):

1. Set the ingest token in `ops/captain-pos-guard/extension/content.js` → `CONFIG.INGEST_TOKEN` = the value of `POS_GUARD_INGEST_TOKEN`.
2. Push the extension folder to the tab:
   ```
   adb -s HA1SBNPA push ops/captain-pos-guard/extension /sdcard/Download/cpg-extension
   ```
3. On the tab: install **Kiwi Browser** → menu → **Extensions** → enable **Developer mode** → **+ (from .zip/folder)** → select `/sdcard/Download/cpg-extension`.
4. Open the captain POS in **Kiwi** (`test.hamzahotel.com/pos/...`) and use it normally. Capture is automatic; verify with `GET /api/captain-pos-guard?action=status`.

## Tuning (no redeploy — `pos_guard_config` table)

`match_grace_seconds`, `stuck_draft_minutes`, `session_stale_hours`, `silence_minutes`,
`open_hour_ist`/`close_hour_ist`, `captain_config_id`, `nihaf_phone`.

## Not included (separate, careful phase)
- **Nightly session auto-close** (the captain session was open 5 days). Touches HE accounting → ship as its own tested step.
- **Printer IP stability** is a network fix (router DHCP reservation), not part of this.
