# Layer 1 — Data Ingestion

Every byte of market state Opus reads, sourced and timestamped. If a source is stale or missing, the **Intelligence Audit** card on Today UI flags it (`fresh / stale / no-data`).

---

## 1. Kite EOD bhavcopy (NSE/BSE)

- **Worker:** `wealth-engine/workers/wealth-kite-bhavcopy/`
- **Cron:** `30 10 * * 1-5` (16:00 IST, after EOD settle)
- **Pulls:** NSE EQ daily OHLCV for ~2,000 symbols
- **Stores:** `daily_bars` (symbol, date, open, high, low, close, volume, prev_close, traded_value)
- **Used by:** suitability backtest, autopsy, signal scoring

## 2. Kite Intraday 5-min bars

- **Worker:** `wealth-engine/workers/wealth-intraday-bars/` ⭐ NEW
- **Cron:** every 5 min during market hours + EOD enrich
- **Endpoint:** Kite `/instruments/historical/{token}/5minute`
- **Stores:** `intraday_bars` (symbol, ts, open, high, low, close, volume, oi)
- **Backfilled:** 30 days × top 50 symbols (~70k rows on first run)
- **Used by:** opening_range capture, breakout detector, autopsy slippage compute

## 3. Kite Instruments map (token → symbol)

- **Worker:** `wealth-intraday-bars` refreshes weekly
- **Stores:** `kite_instruments` (instrument_token, symbol, exchange, expiry, instrument_type)
- **Used by:** every Kite API call needs `instrument_token` for the symbol

## 4. Kite LTP (real-time)

- **Worker:** `wealth-engine/workers/wealth-price-core/`
- **Cron:** every 1 min during market hours (`* 4-9 * * 1-5`)
- **Pulls:** LTP + bid/ask + day range for active universe
- **Stores:** `kite_quotes` (symbol, ltp, bid, ask, ts, day_high, day_low, volume, oi)
- ⚠️ **OPEN ISSUE:** `kite_quotes` table sometimes empty — verify writes (audit task)
- **Used by:** trader breakout detector, MTM compute, range-capture stop/target

## 5. News RSS

- **Worker:** `wealth-engine/workers/wealth-news/`
- **Cron:** every 15 min (`*/15 * * * *`)
- **Sources:** Moneycontrol, Economic Times Markets, Business Standard, Bloomberg Quint
- **Pipeline:** RSS → dedup → Haiku extracts (sentiment, tickers, catalyst type, urgency 1–5)
- **Stores:** `news_articles` (id, source, headline, body, tickers_json, sentiment, urgency, published_at, fetched_at)
- ⚠️ **OPEN ISSUE:** intelligence_audit reports `no_data` — verify cron firing
- **Used by:** alert_triager (Haiku, every 5min), pre-market enrichment, verdict context

## 6. OI / Options data

- **Worker:** `wealth-engine/workers/wealth-options/`
- **Cron:** every 30 min during market hours
- **Pulls:** Nifty + BankNifty option chain, OI, IV, PCR
- **Stores:** `options_snapshots` (underlying, expiry, strike, type, oi, iv, ts)
- **Used by:** trader's live context (PCR for risk-on/risk-off), regime detection

## 7. FII / DII flows

- **Worker:** `wealth-engine/workers/wealth-fii-dii/`
- **Cron:** daily 17:30 IST (after NSE publishes)
- **Pulls:** NSE FII/DII cash + futures flow JSON
- **Stores:** `fii_dii_flows` (date, segment, fii_buy, fii_sell, dii_buy, dii_sell, net)
- **Used by:** pre-market verdict (Opus reads "FII net: +₹X cr / DII net: -₹Y cr")

## 8. Index snapshots

- **Worker:** `wealth-engine/workers/wealth-indices/`
- **Cron:** every 5 min during market hours
- **Stores:** Nifty 50, Bank Nifty, Nifty IT, Auto, Pharma, FMCG, Metal, Realty, Energy
- **Used by:** sector concentration cap, regime classification

## 9. Cross-asset

- **Worker:** `wealth-engine/workers/wealth-cross-asset/`
- **Pulls:** GIFT Nifty (overnight cue), USD/INR, Crude (Brent), Dow futures
- **Used by:** pre-market 07:30 enrichment

## 10. India VIX

- **Stored:** part of indices snapshots
- **Used by:** trader VIX-spike guard (skips entry if VIX > 22 + jumping)

## 11. Earnings calendar

- **Worker:** `wealth-earnings-calendar/` or merged into news worker
- **Stores:** `earnings_calendar` (symbol, date, before/after market)
- **Used by:** verdict filter — exclude stocks with earnings in next 5 days

## 12. Concall transcripts (manual paste + Haiku)

- **Endpoint:** `/api/trading?action=analyze_concall` (POST body)
- **Modal:** Today UI → "📞 Analyze concall transcript"
- **Pipeline:** owner pastes transcript → Haiku extracts (revenue outlook, margin guidance, capex, cautionary notes)
- **Stores:** `concall_signals` (symbol, qtr, sentiment, key_points_json, processed_at)
- **Cost:** ~₹0.18/transcript, cached 90 days
- **Used by:** verdict context as catalyst signal

---

## Intelligence Audit (Today UI Section 6)

API: `/api/trading?action=intelligence_audit&key=…`

For each of 12 sources, returns:
- `name` (e.g., "kite_quotes")
- `last_seen_ts`
- `freshness_status`: `fresh` (≤ expected gap × 1.5) / `stale` / `no_data`
- `expected_gap_min` (e.g., 1 for LTP, 1440 for bhavcopy)
- `row_count_24h`

UI surfaces: `12/12 fresh` (green) or `9/12 fresh, 2 stale, 1 no_data` (yellow with detail rows).

---

## Failure modes seen so far

| Symptom | Root cause | Fix |
|---|---|---|
| `kite_quotes` empty | wealth-price-core might write to different table or wrangler bind | audit table writes (pending) |
| `news_articles` no_data | RSS fetch silently fails / cron didn't deploy | verify cron list (pending) |
| Kite OAuth expired | token TTL ~7d, refresh logic broken | re-link via Today UI Kite-link button |
| Bhavcopy missing weekend | NSE doesn't publish on holidays | calendar table to mark holidays |
