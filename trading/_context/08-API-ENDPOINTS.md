# API Endpoints — `/api/trading?action=…`

**Path:** `functions/api/trading.js` (Cloudflare Pages Functions)
**Auth:** every call requires `?key=DASHBOARD_KEY` (server-side compares against secret)
**Format:** all responses `{ ok: bool, ... }` JSON

## Live action inventory (auto-generated)

> Regenerated from `case 'X':` statements in `functions/api/trading.js`.

<!-- AUTO:api-action-list -->
| Action | Handler |
|---|---|
| `?action=add_position` | `addPosition()` |
| `?action=alerts` | `getAlerts()` |
| `?action=analyze_concall` | `analyzeConcallPages()` |
| `?action=announcements` | `getAnnouncements()` |
| `?action=anthropic_spend` | `getSpendSummary()` |
| `?action=auto_trader_state` | `getAutoTraderState()` |
| `?action=autopsy_latest` | `getLatestAutopsies()` |
| `?action=backfill` | `getBackfill()` |
| `?action=bayesian_state` | `getBayesianState()` |
| `?action=bond_direction` | `getBondDirection()` |
| `?action=breadth` | `getBreadth()` |
| `?action=briefing` | `getBriefing()` |
| `?action=bulk_block` | `getBulkBlock()` |
| `?action=calendar` | `getCalendar()` |
| `?action=cascades` | `getCascades()` |
| `?action=circuits` | `getCircuits()` |
| `?action=close_position` | `closePosition()` |
| `?action=config` | `getConfig()` |
| `?action=crossasset` | `getCrossAsset()` |
| `?action=engine_state` | `getEngineState()` |
| `?action=eod` | `getEod()` |
| `?action=eod_learning_audit` | `getEodLearningAudit()` |
| `?action=execute_view` | `getExecuteView()` |
| `?action=extremes` | `getExtremes()` |
| `?action=fii_dii` | `getFiiDii()` |
| `?action=glossary` | `getGlossary()` |
| `?action=health` | `getHealth()` |
| `?action=indices` | `getIndices()` |
| `?action=intelligence_audit` | `getIntelligenceAudit()` |
| `?action=intraday` | `getIntraday()` |
| `?action=macro` | `getMacro()` |
| `?action=mark_alert_read` | `markAlertRead()` |
| `?action=mark_all_alerts_read` | `markAllAlertsRead()` |
| `?action=monthly_learning_trail` | `getMonthlyLearningTrail()` |
| `?action=morning_briefing` | `getMorningBriefing()` |
| `?action=news` | `getNews()` |
| `?action=ops_health` | `getOpsHealth()` |
| `?action=option_analytics` | `getOptionAnalyticsView()` |
| `?action=option_chain` | `getOptionChain()` |
| `?action=paper_close` | `closePaperTrade()` |
| `?action=paper_open` | `openPaperTrade()` |
| `?action=paper_tick` | `tickPaperTrades()` |
| `?action=paper_trades` | `getPaperTrades()` |
| `?action=portfolio` | `getPortfolio()` |
| `?action=positions` | `getPositions()` |
| `?action=preopen` | `getPreopen()` |
| `?action=queue` | `getQueue()` |
| `?action=readiness` | `getReadiness()` |
| `?action=readiness_set` | `setReadinessFlag()` |
| `?action=sector_rotation` | `getSectorRotation()` |
| `?action=sectors` | `getSectors()` |
| `?action=set_config` | `setConfig()` |
| `?action=signals` | `getSignals()` |
| `?action=social` | `getSocial()` |
| `?action=stock_picker` | `stockPicker()` |
| `?action=summary` | `getSummary()` |
| `?action=symbol_search` | `searchSymbols()` |
| `?action=system_health` | `getSystemHealth()` |
| `?action=tag_news_keywords` | `tagNewsKeywords()` |
| `?action=todays_plan` | `getTodaysPlan()` |
| `?action=top_recommendation` | `getTopRecommendation()` |
| `?action=trader_timeline` | `getTraderTimeline()` |
| `?action=universe` | `getUniverse()` |
| `?action=verdict_today` | `getVerdictToday()` |
| `?action=watchlist` | `getWatchlist()` |
| `?action=watchlist_add` | `addWatchlist()` |
| `?action=watchlist_remove` | `removeWatchlist()` |
| `?action=watchlist_seed` | `seedStarterWatchlist()` |
| `?action=weekly_perf` | `getWeeklyPerf()` |
| `?action=weekly_review_latest` | `getLatestWeeklyReview()` |

_Total actions: 70_
<!-- /AUTO:api-action-list -->

---

## Hand-curated guide (manual, never overwritten)

## Read endpoints (used by Today UI)

### `verdict_today`
Returns the current active verdict + picks (with intraday_history attached) + portfolio_summary + halt_rules.
Used by: Today UI Section 4 (Verdict Card).

### `auto_trader_state`
```json
{
  "ok": true,
  "positions": [{
    "id": 142, "symbol": "SBIN",
    "trader_state": "ENTERED", "strategy_mode": "INTRADAY_DEFAULT",
    "qty": 350, "entry_paise": 78145, "stop_paise": 77202, "target_paise": 80098,
    "peak_price_paise": 78890, "trailing_stop_paise": 78258,
    "exit_paise": null, "exit_reason": null,
    "pnl_paise": null, "pnl_net_paise": null, "win_loss": null,
    "recent_decisions": [{ts, cron_phase, decision, rationale}, ...]
  }, ...],
  "summary": {
    "total_positions": 3,
    "total_deployed_paise": 95000000,
    "total_pnl_realized_paise": 1684500,
    "open_count": 2, "closed_count": 1, "win_count": 1, "loss_count": 0
  }
}
```

### `trader_timeline`
```
?action=trader_timeline&hours=12
```
Returns chronological events: cron fires, decisions, alerts, autopsies merged together for timeline view.

### `intelligence_audit`
Returns 12-source freshness rating. Each source has `name, last_seen_ts, freshness_status, expected_gap_min, row_count_24h`.

### `system_health`
```json
{
  "cron_fires_24h": 1742,
  "failed_24h": 0,
  "anthropic_spend_today_paise": 4520,
  "anthropic_spend_month_paise": 113200,
  "kite_token_state": "active",
  "kite_token_expires_at": 1714974600000
}
```

### `eod_learning_audit`
Returns today's (or specified date's) audit row with 4 buckets + skill% + Sonnet narrative.

### `monthly_learning_trail`
Returns last 30 audits aggregated: cumulative pnl line, win-rate trend, recurring patterns, accumulated tuning.

---

## Picks / candidates

### `pick_candidates`
Returns top 30 candidates from `intraday_suitability` for picker UI. Filter params:
- `regime` (HOT/STABLE)
- `sector` (BANK/IT/...)
- `min_score` (numeric threshold)

### `signal_dump`
Diagnostic — raw signal_scores for a symbol over last N days.

---

## Manual paper-trade write endpoints

### `paper_open` (POST)
```json
{ "symbol":"SBIN", "entry_paise":78100, "qty":350,
  "stop_paise":77100, "target_paise":80000,
  "thesis":"...", "source":"manual" }
```
Inserts a `paper_trades` row with `auto_managed=0`. Owner-driven.

### `paper_close` (POST)
```json
{ "id":142, "exit_paise":78900, "exit_reason":"manual_target_hit" }
```

---

## Concall analyzer

### `analyze_concall` (POST)
```json
{ "symbol":"INFY", "qtr":"Q4FY26", "transcript_text":"..." }
```
Pipeline: Haiku extracts revenue outlook, margin guidance, capex, cautionary notes.
Cost ~₹0.18/transcript. Returns `{ok, key_points, sentiment, cached_until}`.

---

## Force-trigger / debug endpoints

### `force_compose_verdict`
Re-runs `composeVerdict` immediately. Limited to once / 5min.

### `force_invalidate_check`
Re-runs invalidator immediately.

### `refresh_suitability`
Manually re-runs suitability refresh.

### `refire_eod_audit`
Re-runs today's EOD audit (in case 18:30 cron failed).

---

## Kite OAuth flow

### `kite_login_url`
Returns `https://kite.zerodha.com/connect/login?...` with our API key + redirect URI.

### `kite_callback` (GET — Kite redirects here)
Exchanges request_token for access_token. Stores in `kite_tokens` table.

### `kite_status`
Returns `{is_active, expires_at, user_name}`.

---

## Where it surfaces

| API | Used in |
|---|---|
| `verdict_today` | Today Section 4 |
| `auto_trader_state` | Today Section 5 + Hero P&L card |
| `trader_timeline` | Today Section 6 |
| `intelligence_audit` | Today Section 7 |
| `system_health` | Today Section 7 right side |
| `eod_learning_audit` | Today Section 8 |
| `monthly_learning_trail` | Today Section 9 |
| `pick_candidates` | Picker modal in `_lib/picker.js` |
| `paper_open/close` | Execute tab + Today picker callback |

---

## Error envelope

```json
{ "ok": false, "error": "human-readable msg", "code": "OPTIONAL_CODE" }
```

UI Sections all handle the `ok=false` case with red error tag inside the section card.

---

## Caching

- LIst endpoints (auto_trader_state, trader_timeline) — no cache, always fresh
- Heavy compute (intelligence_audit, monthly_learning_trail) — cached 60s in memory
- pick_candidates — cached 5 min (refreshes when suitability cron fires)

Service worker NEVER caches `/api/*` paths (see `sw.js`).
