# Dine Aggregator Alerting

Owner alerts for Hamza Express dine-in aggregators run through:

- `workers/aggregator-health-watcher/` cron every 5 minutes.
- `functions/api/aggregator-health-watcher.js` for probes, dedupe, WABA sends, and booking movement state.
- `functions/api/aggregator-pulse.js` for source health/summary/attribution reads.

## Platform Actions Covered

| Platform | Outlet | Portal actions scraped |
|---|---:|---|
| Zomato Dining | HE `22632449` | transaction history, offers, payouts |
| Swiggy Dine-Out | HE `1372737` | overview, reservations, payments |
| EazyDiner | HE `712958` | dashboard, reservations, reports |

## WABA Templates

Default template names can be overridden by Cloudflare env vars.

### `he_aggregator_alert_v1`

Purpose: immediate pipeline stale/down alert.

Body:

```text
HN aggregator alert
Severity: {{1}}
Surface: {{2}}
Time: {{3}}
Issue: {{4}}
```

### `he_dine_daily_digest_v1`

Purpose: once-daily owner digest of delivery + dine health and movement.

Body:

```text
{{1}}
{{2}}
{{3}}
{{4}}
{{5}}
{{6}}
```

### `he_dine_booking_alert_v1`

Purpose: immediate alert when a watched dine booking/reservation counter increases.

Body:

```text
HN dine booking movement
Platform: {{1}}
Movement: {{2}}
Current count: {{3}}
Snapshot: {{4}}
Check: {{5}}
```

## Env Vars

- `AGGREGATOR_ALERT_PHONE` preferred owner phone; falls back to `ALERT_PHONE`, then `EXOTEL_CALLER_ID` after India-number normalization.
- `AGGREGATOR_WABA_BRAND` defaults to `he`.
- `AGGREGATOR_WABA_ALERT_TEMPLATE` defaults to `he_aggregator_alert_v1`.
- `AGGREGATOR_WABA_DAILY_TEMPLATE` defaults to `he_dine_daily_digest_v1`.
- `AGGREGATOR_WABA_BOOKING_TEMPLATE` defaults to `he_dine_booking_alert_v1`.
- `AGGREGATOR_DAILY_DIGEST_IST_HOUR` defaults to `10`.
- `AGGREGATOR_ALERT_FALLBACK_MODE` defaults to `crit_or_waba_fail`.

## D1 State

Apply `migrations/schema-aggregator-dine-alert-state.sql` before enabling booking movement alerts in production.

`health_alert_suppression` continues to dedupe stale/down alerts and also stores the daily digest marker.
