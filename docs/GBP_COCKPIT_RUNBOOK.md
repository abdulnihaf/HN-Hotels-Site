# GBP Cockpit — Runbook

The dual-brand Google Business Profile cockpit serves both outlets:
- `hnhotels.in/marketing/he/gbp/` — Hamza Express
- `hnhotels.in/marketing/nch/gbp/` — Nawabi Chai House
- `hnhotels.in/api/gbp-cockpit?brand=he|nch&period=7d|28d|90d&compare=prior|yoy|off` — shared API

Single Cloudflare Pages Function backs both pages. One Google account
(`accounts/112047111046090890635`, owned by nihafwork@gmail.com) holds both
canonical locations.

## Canonical IDs (source of truth: HN-Hotels-Asset-Database.xlsx)

| Brand | Account | Location | Place ID | Title |
|---|---|---|---|---|
| HE  | `accounts/112047111046090890635` | `locations/9588185230705816056`  | `ChIJ-QQjtHEXrjsR-Z1RIEm2arg` | Hamza Express |
| NCH | `accounts/112047111046090890635` | `locations/16572235710389279793` | `ChIJq-hENv8XrjsRCjNPpTGIogY` | Nawabi Chai House |

A third stale "Hamza Hotel" listing (`locations/7829573864924925059`,
`ChIJHVEnD2EWrjsREQgNKhAQS8I`) exists under the same Google account.
The API resolves brands by hardcoded location resource name, never by title-substring.

## Required secrets on this Pages project

```bash
wrangler pages secret put GOOGLE_ADS_CLIENT_ID         --project-name=hn-hotels-site
wrangler pages secret put GOOGLE_ADS_CLIENT_SECRET     --project-name=hn-hotels-site
wrangler pages secret put GOOGLE_ORGANIC_REFRESH_TOKEN --project-name=hn-hotels-site
wrangler pages secret put GOOGLE_PLACES_API_KEY        --project-name=hn-hotels-site
```

The first three already exist on the `hamza-express-site` project — paste the
same values here. They mirror the OAuth client "NCH Marketing Web" + a refresh
token with three scopes: `adwords`, `webmasters.readonly`, `business.manage`.

If you need to mint a new refresh token, the script lives at
`hamza-express-site/scripts/generate-organic-token.js`. Authorize redirect URI
`http://localhost:9191/callback` on the OAuth client first.

## APIs touched (project `hn-hotels-marketing`)

| API | Purpose |
|---|---|
| `mybusinessaccountmanagement.googleapis.com` | List accounts (one-time, cached implicitly) |
| `mybusinessbusinessinformation.googleapis.com` | Profile read (categories, hours, phone, description) |
| `businessprofileperformance.googleapis.com` | Daily impressions, calls, directions, etc. T-2 day lag |
| `places.googleapis.com` | Aggregate rating, review count, recent review snippets, photo count, openNow |

All four enabled and verified non-zero on 2026-05-05.

## Daily metric enum gotcha

The Performance API rejects `DIRECTION_REQUESTS` with HTTP 400. The correct
prefixed names are:

```
BUSINESS_IMPRESSIONS_DESKTOP_MAPS
BUSINESS_IMPRESSIONS_MOBILE_MAPS
BUSINESS_IMPRESSIONS_DESKTOP_SEARCH
BUSINESS_IMPRESSIONS_MOBILE_SEARCH
BUSINESS_CONVERSATIONS
BUSINESS_DIRECTION_REQUESTS
BUSINESS_BOOKINGS
BUSINESS_FOOD_ORDERS
BUSINESS_FOOD_MENU_CLICKS
```

But two metrics are *not* prefixed (legacy enum):

```
CALL_CLICKS
WEBSITE_CLICKS
```

End date for queries must be at least 2 days before today — Google's metrics
pipeline lags. The API computes this automatically.

## What's deferred (not in P1)

- Review reply UI (managed separately by owner; not surfaced here by design)
- Q&A answer-as-business
- Local Posts composer (Update / Offer / Event)
- Special-hours editor
- Photo uploader
- D1 caching of daily metrics (avoids API rate limits on heavy use)
- Cron-driven snapshots
- Urgency-bar chip integration with cross-cockpit `/api/urgency`

These are Phase 2/3 items. Most action surfaces in the page deep-link to
`https://business.google.com/` for now.

## How to test locally

```bash
# In the worktree:
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site
wrangler pages dev . --port 8788

# Then in browser:
open http://localhost:8788/marketing/he/gbp/
open http://localhost:8788/marketing/nch/gbp/
```

`wrangler pages dev` reads secrets from `.dev.vars` if present (gitignored).
Drop the four secrets there as `KEY=value` to test against real APIs.

## How to verify after deploy

1. `curl https://hnhotels.in/api/gbp-cockpit?brand=he&period=7d | jq .ok` should be `true`
2. `curl https://hnhotels.in/api/gbp-cockpit?brand=nch&period=7d | jq .summary.actions.directions` should match the Performance API directly (use `hamza-express-site/scripts/list-gbp-locations.js` to cross-check)
3. Open both pages in iPhone Safari at /marketing/he/gbp/ and /marketing/nch/gbp/. Validate hero band, period filter, keyword search, mobile responsiveness.

## Strategic note (recorded 2026-05-05 baseline)

Over the 7 days 2026-04-26 → 2026-05-03:

- **HE:** 1,254 impressions, 24 directions, 1 call
- **NCH:** 1,858 impressions, 82 directions, 3 calls

NCH outperforms HE on every organic metric despite zero paid Maps work — the
cockpit makes this gap legible and is the primary reason the dual-outlet
compare strip is wired in.
