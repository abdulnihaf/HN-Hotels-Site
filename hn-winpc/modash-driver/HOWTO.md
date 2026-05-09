# hn-winpc Modash poller — operational HOWTO

## What this is

Long-running daemon on hn-winpc that runs Modash discovery searches under pre-logged
Chromium sessions. Each search uses a different Modash trial account (rotated by
profile number). No passwords stored or seen by Claude — owner does each login once,
cookies persist for ~30 days.

## Architecture

```
[CF cron 4 AM IST]
  └─> POST hnhotels.in/api/influencer-pipeline?action=cron-discover
       └─> If modash_enabled=true AND any profile.status=active:
            INSERT INTO modash_jobs (status='pending')

[hn-winpc poller, every 60s]
  └─> GET  hnhotels.in/api/influencer-pipeline?action=modash-next-job
       └─> Pulls one pending job + assigns LRU active profile
  └─> launches Chromium with --user-data-dir=C:\Modash\profiles\profile-N
  └─> navigates marketer.modash.io/discovery/instagram?<filters>
  └─> intercepts XHR with results / scrapes DOM as fallback
  └─> POST hnhotels.in/api/influencer-pipeline?action=modash-job-done
       └─> server pushes results into discovery_queue (Cron 2 enriches via Apify next)
```

## Critical safety boundary

- Aggregator-pulse Chrome runs under default Chrome user-data-dir. UNTOUCHED.
- This poller uses Playwright's bundled Chromium (separate binary, separate user-data-dirs).
- All Modash data lives in C:\Modash\. Aggregator data is elsewhere.
- Killing/restarting this poller never affects aggregator.

## One-time install

Run AS THE "HN Hotels" user (the one currently running aggregator):

```powershell
# 1. Pull/copy the modash-driver folder to the PC
#    (rsync from laptop or git clone or scp the folder over Tailscale)
mkdir C:\Modash\modash-driver
# ...copy hn-winpc/modash-driver/* into C:\Modash\modash-driver\

# 2. Run installer
cd C:\Modash\modash-driver
powershell -ExecutionPolicy Bypass -File .\install.ps1 -CronToken "<paste CRON_TOKEN secret>"
#   Installs Node deps, Playwright Chromium, env vars, scheduled task.
#   CRON_TOKEN must match the same secret used by Pages Functions and the cron Worker.
```

## Per-account setup (do this for each of N Modash accounts)

For each Modash trial account:

```powershell
# Open Chromium for profile-1, log into account-1 manually
powershell -ExecutionPolicy Bypass -File C:\Modash\modash-driver\setup-modash-profile.ps1 `
  -ProfileNum 1 -Email "contact@hamzahotel.com"

# After logging in and closing Chrome, register the profile:
$key = '<DASHBOARD_KEY>'
$body = '{"profile_num": 1, "email": "contact@hamzahotel.com"}'
curl -X POST "https://hnhotels.in/api/influencer-pipeline?action=modash-register-profile" `
  -H "X-Dashboard-Key: $key" -H "Content-Type: application/json" -d $body

# Mark profile as active so the poller picks it up:
$body = '{"profile_num": 1}'
curl -X POST "https://hnhotels.in/api/influencer-pipeline?action=modash-mark-active" `
  -H "X-Dashboard-Key: $key" -H "Content-Type: application/json" -d $body
```

Repeat with `-ProfileNum 2`, `3`, ... up to N for each of the trial accounts.

## Activate the Modash branch in cron-discover

Once at least one profile is active:

```bash
# From any machine — flip modash_enabled to true:
curl -X POST 'https://hnhotels.in/api/influencer-pipeline?action=set-config' \
  -H 'X-Dashboard-Key: <KEY>' -H 'Content-Type: application/json' \
  -d '{"key":"modash_enabled","value":"true"}'
```

The next time `cron-discover` fires (4 AM IST daily), it will enqueue a Modash job
instead of an Apify hashtag scrape, and the poller will execute it.

## Verify it works (smoke test)

```powershell
# Manually enqueue one job to test end-to-end without waiting for cron
$key = '<DASHBOARD_KEY>'
curl -X POST "https://hnhotels.in/api/influencer-pipeline?action=modash-enqueue-job" `
  -H "X-Dashboard-Key: $key" -H "Content-Type: application/json" -d '{}'

# Watch the poller log
Get-Content C:\Modash\modash-driver\poller.log -Tail 30 -Wait

# Or check status via API
curl "https://hnhotels.in/api/influencer-pipeline?action=modash-status"
```

Expected sequence (within 60-90s):
1. Poller picks up the job
2. Launches Chromium in headless mode for profile-1
3. Navigates to Modash discovery URL with filters
4. Intercepts XHR / scrapes results
5. Posts results back → `modash_jobs.status='done'`
6. Discovery queue grows; cron-enrich-tick processes them within 15 min

## What to do when cookies expire (~30 days)

Poller detects this automatically. Profile gets marked `status=broken`. Owner re-runs
`setup-modash-profile.ps1 -ProfileNum N`, logs in again, then `modash-mark-active`.

## Pacing knob

Default: 1 search per profile per day, spread across hours.

Adjust via the `modash_searches_per_profile_per_day` config:

```bash
curl -X POST 'https://hnhotels.in/api/influencer-pipeline?action=set-config' \
  -H 'X-Dashboard-Key: <KEY>' -H 'Content-Type: application/json' \
  -d '{"key":"modash_searches_per_profile_per_day","value":"3"}'
```

If Modash starts blocking, drop back to 1. If we want faster discovery, bump to 2-3.

## Filter tuning

Default filter set is in pipeline_config under `modash_default_filters`. Edit via:

```bash
curl -X POST 'https://hnhotels.in/api/influencer-pipeline?action=set-config' \
  -H 'X-Dashboard-Key: <KEY>' -H 'Content-Type: application/json' \
  -d '{"key":"modash_default_filters","value":"{\"location\":\"Bangalore\",\"followers_from\":15000,\"followers_to\":50000,\"engagement_rate_from\":0.02}"}'
```

## Selector / scraping reliability — known gotcha

`scrapeSearchResults()` in `poller.js` has TWO strategies:

1. **Network interception** (preferred) — listens for the XHR Modash makes to its
   internal search API, parses that JSON. More resilient to UI changes.
2. **DOM scraping** (fallback) — reads visible creator cards.

After first deploy, owner runs a smoke test and inspects the browser DevTools while
running the poller in headed mode (`headless: false` temporarily) to verify which
strategy works. The current code is a SCAFFOLD that handles common Modash response
shapes; if Modash's API shape differs, owner adjusts the parser in
`scrapeSearchResults` (look for the `Modash typically returns ...` comment).

## Logs

```powershell
# Tail logs
Get-Content C:\Modash\modash-driver\poller.log -Tail 50 -Wait

# Or via Scheduled Task event log
Get-ScheduledTaskInfo -TaskName HN-Modash-Poller
```

## Stopping / pausing

```powershell
# Stop poller temporarily
Stop-ScheduledTask -TaskName HN-Modash-Poller

# Disable entirely
Disable-ScheduledTask -TaskName HN-Modash-Poller
```

Or set `modash_enabled=false` via the config endpoint — cron-discover will fall back
to Apify hashtag scrape, no Modash jobs created.
