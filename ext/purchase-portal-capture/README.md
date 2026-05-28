# HN Purchase Portal Capture

Chrome extension for Phase 5 of the HN Hotels purchase console.

It captures the currently logged-in browser session for one purchase portal and sends it to the existing purchase-console session vault through:

`https://hnhotels.in/api/purchase-control?action=upsert-portal-session`

The popup never prints cookie values, tokens, or storage values. It only shows capture counts and vault health.

## Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the folder in your local HN Hotels checkout:

`/Users/nihaf/Documents/Tech/HN-Hotels-Site/ext/purchase-portal-capture`

If you previously loaded this extension from `/tmp/...`, remove that entry first
and reload from the permanent path so updates to `manifest.json` take effect.

## Capture Flow

1. Open one portal in Chrome and make sure you are logged in.
2. Click the `HN Purchase Portal Capture` extension.
3. Select the portal, enter the purchase-console PIN, location, pincode, and expiry hours.
4. Click `Capture current tab`.
5. Repeat for all 8 portals:
   - Hyperpure
   - Zepto
   - Flipkart Minutes
   - Instamart
   - Blinkit
   - Amazon Now
   - BigBasket
   - JioMart
6. Open `/ops/purchase-console/` and check `Portal Sessions`.

## Live Quote Flow

### Preferred — dashboard-driven (v1.6.0)

1. In `/ops/purchase-console/`, create a run and add raw materials to the tray.
2. Click `Get live prices`.
3. The dashboard creates one quote batch in D1 and asks this extension to run
   every ready portal for that batch. The extension opens (or reuses) one tab
   per portal in the background, runs the search, ingests results, and reports
   per-source progress back to the dashboard.

This avoids opening the popup eight times per run. The popup flow below still
works as a manual fallback for one portal at a time.

### Fallback — per-portal popup

1. In `/ops/purchase-console/`, create a run, add items, and click `Get quotes`.
2. Open the matching logged-in portal tab.
3. Open this extension and click `Run live quotes from tab`.
4. The extension runs waiting quote jobs inside the browser session and sends normalized results back to the purchase console.

For Hyperpure, v1.2 uses the live website search UI instead of guessing API headers. It temporarily watches the page's own search network response, types the queued raw-material query into Hyperpure's real search box, and ingests the returned SKU/price payload.

Hyperpure v1.3 adds a DOM fallback: if the network response is blocked or hidden, the extension opens Hyperpure's `/in/search/...` result page and extracts visible product cards, prices, pack sizes, and out-of-stock state from the rendered page.

Phase 7 v1.4 adds the same browser-driven live quote path for the other seven portals. For Zepto, Flipkart Minutes, Instamart, Blinkit, Amazon Now, BigBasket, and JioMart, the extension opens the logged-in portal search page for each queued item, reads visible product cards, and sends normalized SKU title, price, pack size, stock state, delivery text, and product URL back to the purchase console.

Phase 9 v1.5 also captures visible product thumbnails when the portal exposes them. The purchase console uses those thumbnails only as visual confirmation beside the SKU title, price, pack size, UOM, and match confidence.

## When Login Expires

If a portal shows `MISSING`, `EXPIRED`, or `ACTION_REQUIRED`, open that portal, log in again, and capture the current tab again.

If the extension has been updated, reload it once from `chrome://extensions` before recapturing. Hyperpure requires this because its usable `token` and `outletId` can be visible browser cookies rather than cookies returned by the Chrome cookies API.

If a portal loads but returns no quote, keep that portal tab active, search the same raw material once manually, and then run live quotes again. That gives Phase 7 a rendered search page to read while a portal-specific API adapter is added.
