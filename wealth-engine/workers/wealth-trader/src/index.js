// ═══════════════════════════════════════════════════════════════════════════
// wealth-trader — autonomous paper-trading executor.
//
// Single cron `*/5 3-10 * * 1-5` (every 5 min during market hours UTC).
// Worker dispatches by IST minute:
//
//   09:30 IST  range_capture      capture 15-min opening high/low per pick
//   09:45 IST  entry_decision_1   Opus: ENTER NOW or WAIT for each pick
//   10:00 IST  entry_decision_2   Opus retry for picks not yet entered
//   10:15 IST  entry_decision_3   Opus final entry attempt
//   10:30 IST  entry_close        no more entries after this
//   11:00-14:00 every :00/:30  management_decision  Opus: HOLD/TIGHTEN/PARTIAL/EXIT
//   14:30 IST  hard_exit          force-close all ENTERED positions
//   Every 5 min mkt hrs   price_monitor   deterministic — read LTP, update peak,
//                                          fire trailing stop if breached, halt at -2%
// ═══════════════════════════════════════════════════════════════════════════

import { callOpus, callSonnet, callHaiku, parseJsonOutput } from '../../_shared/anthropic.js';

const WORKER_NAME = 'wealth-trader';

// ─── RISK CONFIG (May 7 2026 — percentage-based, scales with capital) ──────
// Owner principle: one SQL UPDATE to flip ₹10K (Fri 8 May test) ↔ ₹10L (Mon 11 launch).
// Thresholds stored as ratios in user_config; absolute paise computed at runtime.
//
// Defaults if user_config missing the row:
//   profit_lock_pct    0.05  (was 3%, raised to 5% per scenario backtest data)
//   loss_halt_pct      0.03  (kept at 3% — asymmetric protection: losses cost more)
//   best_target_pct    0.07  (was 5%, raised to 7% — informational only)
//
// All read inside priceMonitor() per cron invocation. ~3 D1 reads per cycle, trivial.
const DEFAULT_PROFIT_LOCK_PCT = 0.05;
const DEFAULT_LOSS_HALT_PCT   = 0.03;
const DEFAULT_BEST_TARGET_PCT = 0.07;
const DEFAULT_CAPITAL_PAISE   = 100000000;    // ₹10,00,000 fallback if user_config missing

// Legacy constants kept for any code path still referencing them — preserve the
// 3% values so this PR is purely additive at the schema level. Live code switches
// to getRiskConfig() below.
const PAPER_CAPITAL_PAISE = 100000000;        // ₹10,00,000 (legacy ref)
const DAILY_LOSS_LIMIT_PAISE = 3000000;       // ₹30,000 (legacy ref)
const PROFIT_LOCK_PAISE = 3000000;            // ₹30,000 (legacy ref)
const DAILY_BEST_TARGET_PAISE = 5000000;      // ₹50,000 (legacy ref)

/**
 * getRiskConfig — read percentage-based thresholds from user_config and compute
 * runtime absolute paise values relative to total_capital_paise.
 *
 * Returns:
 *   {
 *     capital_paise:        live total_capital_paise (₹10K or ₹10L per owner)
 *     profit_lock_paise:    capital × profit_lock_pct
 *     loss_halt_paise:      capital × loss_halt_pct
 *     best_target_paise:    capital × best_target_pct
 *     profit_lock_pct, loss_halt_pct, best_target_pct  (raw ratios for display)
 *   }
 *
 * Single batched SQL read (4 keys) — fast.
 */
async function getRiskConfig(db) {
  const rows = (await db.prepare(`
    SELECT config_key, config_value FROM user_config
    WHERE config_key IN ('total_capital_paise','profit_lock_pct','loss_halt_pct','best_target_pct')
  `).all().catch(() => ({ results: [] }))).results || [];
  const cfg = Object.fromEntries(rows.map(r => [r.config_key, r.config_value]));
  const capitalPaise   = parseInt(cfg.total_capital_paise) || DEFAULT_CAPITAL_PAISE;
  const profitLockPct  = parseFloat(cfg.profit_lock_pct) || DEFAULT_PROFIT_LOCK_PCT;
  const lossHaltPct    = parseFloat(cfg.loss_halt_pct)   || DEFAULT_LOSS_HALT_PCT;
  const bestTargetPct  = parseFloat(cfg.best_target_pct) || DEFAULT_BEST_TARGET_PCT;
  return {
    capital_paise:      capitalPaise,
    profit_lock_paise:  Math.round(capitalPaise * profitLockPct),
    loss_halt_paise:    Math.round(capitalPaise * lossHaltPct),
    best_target_paise:  Math.round(capitalPaise * bestTargetPct),
    profit_lock_pct:    profitLockPct,
    loss_halt_pct:      lossHaltPct,
    best_target_pct:    bestTargetPct,
  };
}

// ─── Time helpers ──────────────────────────────────────────────────────────
function istNow() { return new Date(Date.now() + 5.5 * 3600000); }
function istToday() { return istNow().toISOString().slice(0, 10); }
function istHHMM() {
  const d = istNow();
  return d.toISOString().slice(11, 16); // "HH:MM"
}
function istIs(hh, mm) {
  const t = istHHMM();
  return t === `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

// F&O expiry day check (last Thursday of month) — trade size should be reduced.
// Deterministic — no API call, uses calendar math.
function isFnoExpiryDay(d = istNow()) {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month, lastDay)).getUTCDay();
  const lastThursday = lastDay - ((lastDow + 7 - 4) % 7);
  return d.getUTCDate() === lastThursday;
}
function daysToFnoExpiry(d = istNow()) {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month, lastDay)).getUTCDay();
  const lastThursday = lastDay - ((lastDow + 7 - 4) % 7);
  const today = d.getUTCDate();
  if (today <= lastThursday) return lastThursday - today;
  // After this month's expiry → next month's
  const nextMonthLast = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const nextDow = new Date(Date.UTC(year, month + 1, nextMonthLast)).getUTCDay();
  const nextLastThurs = nextMonthLast - ((nextDow + 7 - 4) % 7);
  const daysInThisMonth = lastDay - today;
  return daysInThisMonth + nextLastThurs;
}

// ─── Cron run logging ──────────────────────────────────────────────────────
async function logCronStart(db, name, source = 'cron') {
  try {
    const r = await db.prepare(`
      INSERT INTO cron_run_log (cron_name, status, started_at, trigger_source)
      VALUES (?, 'running', ?, ?)
    `).bind(`${WORKER_NAME}:${name}`, Date.now(), source).run();
    return r.meta?.last_row_id;
  } catch { return null; }
}
async function logCronEnd(db, id, status, rows, err) {
  if (!id) return;
  try {
    await db.prepare(`
      UPDATE cron_run_log SET status=?, finished_at=?, rows_written=?, error_message=?
      WHERE id=?
    `).bind(status, Date.now(), rows || 0, err ? String(err).slice(0, 500) : null, id).run();
  } catch {}
}

// ─── Decision log (audit trail of every trader decision) ───────────────────
async function logDecision(db, fields) {
  try {
    await db.prepare(`
      INSERT INTO trader_decisions
        (ts, trade_date, cron_phase, symbol, trade_id, state_before, decision,
         state_after, ltp_paise, context_json, rationale, composed_by_model, cost_paise)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      Date.now(), istToday(),
      fields.cron_phase, fields.symbol || null, fields.trade_id || null,
      fields.state_before || null, fields.decision || null, fields.state_after || null,
      fields.ltp_paise || null, fields.context_json ? JSON.stringify(fields.context_json) : null,
      (fields.rationale || '').slice(0, 600),
      fields.composed_by_model || null,
      fields.cost_paise || 0,
    ).run();
  } catch (e) { /* swallow logging errors */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// F-EXIT-2 — TICK-CONFIRMATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════
// May 7 2026 incident: TDPOWERSYS got SKIP_GAPPED_BELOW_STOP at 10:00 IST on a
// SINGLE-TICK wick to ₹1213.60 (stop ₹1214.05). Stock immediately recovered,
// broke trigger ₹1235.70 again at 10:55 IST, sustained for 30+ min. But because
// SKIP set state permanently, priceMonitor never re-considered it. Owner had to
// manually revive at 11:28 IST.
//
// Lesson: deterministic single-tick guardrails are too brittle. Real-money
// wick-stops on equivalent moves would be devastating. Both ENTRY-side
// SKIP_GAPPED_BELOW_STOP and EXIT-side STOP_HIT / TRAILING_STOP_HIT must require
// SUSTAINED breach across at least 2 ticks within last 2 minutes — confirmed
// move, not wick.
//
// confirmedSustainedBelow: returns true ONLY if last 2 min of intraday_ticks
// has ≥ 2 ticks AND ALL of them are ≤ threshold. Used to confirm REAL stop
// breach before SKIP/EXIT. Falls open (returns false) on missing data — better
// to hold the position than exit on bad data.
//
// confirmedSustainedAbove: mirror — returns true if ≥ 2 ticks in last 2 min
// AND ALL > threshold. Used to confirm SKIPPED-row resurrection.
async function confirmedSustainedBelow(db, symbol, thresholdPaise, today) {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const ticks = (await db.prepare(`
    SELECT ts, ltp_paise FROM intraday_ticks
    WHERE symbol=? AND ts >= ?
      AND DATE(ts/1000, 'unixepoch') = ?
    ORDER BY ts DESC LIMIT 10
  `).bind(symbol, cutoff, today).all().catch(() => ({ results: [] }))).results || [];
  if (ticks.length < 2) return false;
  return ticks.every(t => t.ltp_paise <= thresholdPaise);
}

async function confirmedSustainedAbove(db, symbol, thresholdPaise, today) {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const ticks = (await db.prepare(`
    SELECT ts, ltp_paise FROM intraday_ticks
    WHERE symbol=? AND ts >= ?
      AND DATE(ts/1000, 'unixepoch') = ?
    ORDER BY ts DESC LIMIT 10
  `).bind(symbol, cutoff, today).all().catch(() => ({ results: [] }))).results || [];
  if (ticks.length < 2) return false;
  return ticks.every(t => t.ltp_paise > thresholdPaise);
}

// ═══════════════════════════════════════════════════════════════════════════
// KITE LIVE PRICE — fetch LTP for symbols via Kite Connect REST API.
// Kite endpoint: https://api.kite.trade/quote?i=NSE:SYMBOL&i=NSE:SYMBOL2
// Auth header: "token <api_key>:<access_token>"
// ═══════════════════════════════════════════════════════════════════════════
async function getKiteLtp(env, symbols) {
  if (!symbols?.length) return {};
  if (!env.KITE_API_KEY) {
    return { _error: 'KITE_API_KEY missing — auto-trading paused. Reconnect Kite at /wealth/auth/login.' };
  }

  // Read latest active access token from D1. Schema uses obtained_at + is_active,
  // not created_at (the original query had wrong column → silent NULL → false alarm).
  const tokRow = await env.DB.prepare(
    `SELECT access_token, api_key, expires_at FROM kite_tokens
     WHERE is_active=1 ORDER BY id DESC LIMIT 1`
  ).first().catch(() => null);

  if (!tokRow?.access_token) {
    return { _error: 'No Kite access token. User must reconnect via /wealth/auth/login.' };
  }
  if (tokRow.expires_at && tokRow.expires_at < Date.now()) {
    return { _error: 'Kite access token expired. Reconnect via /wealth/auth/login.' };
  }
  // Use api_key from row (stored at OAuth) OR fall back to env.KITE_API_KEY
  const apiKeyToUse = tokRow.api_key || env.KITE_API_KEY;
  if (!apiKeyToUse) {
    return { _error: 'No api_key on row + no env.KITE_API_KEY' };
  }

  const params = symbols.map(s => `i=NSE:${encodeURIComponent(s)}`).join('&');
  const r = await fetch(`https://api.kite.trade/quote?${params}`, {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${apiKeyToUse}:${tokRow.access_token}`,
    },
    signal: AbortSignal.timeout(10000),
  }).catch(e => ({ ok: false, _err: e.message }));

  if (!r.ok) {
    return { _error: `Kite API failed: ${r.status || r._err || 'unknown'}` };
  }
  const j = await r.json();
  if (j.status === 'error') return { _error: `Kite returned error: ${j.message || 'unknown'}` };

  const out = {};
  for (const sym of symbols) {
    const key = `NSE:${sym}`;
    const data = j.data?.[key];
    if (data) {
      out[sym] = {
        ltp_paise: Math.round((data.last_price || 0) * 100),
        volume: data.volume || 0,
        ohlc: {
          open_paise: Math.round((data.ohlc?.open || 0) * 100),
          high_paise: Math.round((data.ohlc?.high || 0) * 100),
          low_paise: Math.round((data.ohlc?.low || 0) * 100),
          close_paise: Math.round((data.ohlc?.close || 0) * 100),
        },
        last_trade_time: data.last_trade_time,
      };
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — RANGE_CAPTURE (09:30 IST)
// Capture each pick's first 15-min OHLC. Used by entry_decision for breakout filter.
// ═══════════════════════════════════════════════════════════════════════════
async function rangeCapture(env) {
  const db = env.DB;
  const today = istToday();

  // Find today's morning verdict picks
  const verdict = await db.prepare(`
    SELECT id, picks_json FROM daily_verdicts
    WHERE trade_date=? AND verdict_type='morning' ORDER BY composed_at DESC LIMIT 1
  `).bind(today).first();

  if (!verdict?.picks_json) return { rows: 0, skipped: 'no-verdict-today' };
  let picks; try { picks = JSON.parse(verdict.picks_json); } catch { return { rows: 0, error: 'parse-fail' }; }
  if (!Array.isArray(picks) || picks.length === 0) return { rows: 0, skipped: 'no-picks-today' };

  const symbols = picks.map(p => p.symbol).filter(Boolean);
  const ltp = await getKiteLtp(env, symbols);
  if (ltp._error) return { rows: 0, error: ltp._error };

  let written = 0;
  for (const sym of symbols) {
    const q = ltp[sym];
    if (!q?.ohlc?.open_paise) continue;
    // At 09:30 IST after market opens, ohlc.high/low reflect first 15 min
    await db.prepare(`
      INSERT OR REPLACE INTO opening_ranges
        (trade_date, symbol, open_paise, high_15min_paise, low_15min_paise, volume_15min, captured_at)
      VALUES (?,?,?,?,?,?,?)
    `).bind(today, sym, q.ohlc.open_paise, q.ohlc.high_paise, q.ohlc.low_paise, q.volume || 0, Date.now()).run();
    written++;
  }

  // Pre-create paper_trade rows in WATCHING state so management cron can find them.
  // CRITICAL: picks_json contains Opus's percentages (stop_pct, target_pct, weight_pct)
  // but NOT computed paise values. Compute them HERE using live LTP at range_capture
  // time — entries will use the same baseline.
  const PAPER_CAPITAL_PAISE = 100000000;  // ₹10L
  for (const p of picks) {
    if (!p.symbol) continue;
    const q = ltp[p.symbol];
    if (!q?.ltp_paise) {
      console.warn(`No LTP for ${p.symbol}, skipping setup creation`);
      continue;
    }

    const exists = await db.prepare(
      `SELECT id FROM paper_trades WHERE symbol=? AND DATE(created_at/1000, 'unixepoch') = ? AND auto_managed=1`
    ).bind(p.symbol, today).first().catch(() => null);
    if (exists) continue;

    // Compute the plan from Opus's percentages + live entry estimate (current LTP)
    const entryEstimate = q.ltp_paise;
    const stopPct = parseFloat(p.stop_pct) || 1.0;
    const targetPct = parseFloat(p.target_pct) || 3.0;
    const weight = parseFloat(p.weight_pct) || 30;
    const stopPaise = Math.round(entryEstimate * (1 - stopPct/100));
    const targetPaise = Math.round(entryEstimate * (1 + targetPct/100));
    const capitalDeployed = Math.round(PAPER_CAPITAL_PAISE * weight / 100);
    const qty = Math.max(1, Math.floor(capitalDeployed / entryEstimate));
    const rrRatio = +(targetPct / stopPct).toFixed(2);

    // Capture 15-min OR data — used by continuous-trigger entry in price_monitor.
    // /quote endpoint returns ohlc.high/low for current trading day. At 09:30 IST
    // (range_capture cron fire), this reflects FIRST 15 MIN of trading.
    const orHigh = q.ohlc?.high_paise || entryEstimate;
    const orLow = q.ohlc?.low_paise || entryEstimate;
    const orVolume = q.volume || 0;

    // BUG FIX (May 5 2026): was is_active=0, which caused priceMonitor's continuous
    // breakout-trigger block (filters WHERE is_active=1) to never fire entries on
    // these new WATCHING rows. Only the every-15-min Opus entryDecision could enter
    // them. Today's outcome: 0 of 3 picks transitioned end-to-end. Setting is_active=1
    // restores continuous breakout-trigger as intended.
    await db.prepare(`
      INSERT INTO paper_trades
        (symbol, qty, entry_paise, stop_paise, target_paise, rr_ratio,
         tranche, composite_score, rationale, source, is_active,
         auto_managed, trader_state, verdict_id, created_at,
         entry_at, q1_passed, q2_passed, q3_passed,
         or_high_paise, or_low_paise, or_volume)
      VALUES (?,?,?,?,?,?, 'base', ?, ?, 'auto_trader', 1,
              1, 'WATCHING', ?, ?, ?, 1, 1, 1,
              ?, ?, ?)
    `).bind(
      p.symbol,
      qty,
      entryEstimate,
      stopPaise,
      targetPaise,
      rrRatio,
      null,
      `${(p.rationale || '').slice(0, 400)} | weight=${weight}% stop=${stopPct}% target=${targetPct}%`,
      verdict.id,
      Date.now(),
      Date.now(),
      orHigh, orLow, orVolume,
    ).run();
  }

  await logDecision(db, {
    cron_phase: 'range_capture',
    decision: `captured ${written} ranges, ${picks.length} setups in WATCHING state`,
    composed_by_model: 'deterministic',
  });
  return { rows: written, picks_in_watching: picks.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — ENTRY_DECISION (09:45 / 10:00 / 10:15 IST)
// For each WATCHING setup, Opus decides: ENTER NOW or WAIT.
// ═══════════════════════════════════════════════════════════════════════════
async function entryDecision(env, attemptNum) {
  const db = env.DB;
  const today = istToday();

  // Find WATCHING auto-managed setups for today
  const watching = (await db.prepare(`
    SELECT pt.id, pt.symbol, pt.qty, pt.entry_paise, pt.stop_paise, pt.target_paise,
           pt.rr_ratio, pt.rationale, pt.entry_attempts,
           o.high_15min_paise, o.low_15min_paise, o.open_paise AS open_15min_paise
    FROM paper_trades pt
    LEFT JOIN opening_ranges o ON o.symbol = pt.symbol AND o.trade_date = ?
    WHERE pt.auto_managed = 1 AND pt.trader_state = 'WATCHING'
      AND DATE(pt.created_at/1000, 'unixepoch') = ?
  `).bind(today, today).all()).results || [];

  if (watching.length === 0) return { rows: 0, skipped: 'no-watching-setups' };

  // Get fresh LTP for each
  const symbols = watching.map(w => w.symbol);
  const ltp = await getKiteLtp(env, symbols);
  if (ltp._error) return { rows: 0, error: ltp._error };

  let entered = 0;
  let totalCost = 0;

  for (const w of watching) {
    const q = ltp[w.symbol];
    if (!q?.ltp_paise) continue;

    // Pre-checks (deterministic) before bothering Opus:
    //   - If price already past target, skip (missed entry)
    //   - If price already below stop, skip (gap-down, would be immediate stop-out)
    if (w.target_paise && q.ltp_paise >= w.target_paise) {
      await db.prepare(`UPDATE paper_trades SET trader_state='SKIPPED', trader_notes='gap above target', last_check_at=? WHERE id=?`).bind(Date.now(), w.id).run();
      await logDecision(db, { cron_phase: `entry_${attemptNum}`, symbol: w.symbol, trade_id: w.id, state_before: 'WATCHING', decision: 'SKIP_GAPPED_PAST_TARGET', state_after: 'SKIPPED', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic' });
      continue;
    }
    if (w.stop_paise && q.ltp_paise <= w.stop_paise) {
      // F-EXIT-2 (May 7 2026): require sustained 2-min breach, not single tick.
      // TDPOWERSYS got SKIPPED on 1-tick wick at 10:00, then broke out at 10:55
      // and ran. Single-tick SKIP is too brittle.
      const confirmed = await confirmedSustainedBelow(db, w.symbol, w.stop_paise, today);
      if (confirmed) {
        await db.prepare(`UPDATE paper_trades SET trader_state='SKIPPED', trader_notes='gap below stop (confirmed 2-min)', last_check_at=? WHERE id=?`).bind(Date.now(), w.id).run();
        await logDecision(db, { cron_phase: `entry_${attemptNum}`, symbol: w.symbol, trade_id: w.id, state_before: 'WATCHING', decision: 'SKIP_GAPPED_BELOW_STOP', state_after: 'SKIPPED', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic', rationale: 'F-EXIT-2 confirmed: ≥2 ticks in last 2min all ≤ stop. Real gap-down, not wick.' });
        continue;
      } else {
        // Single-tick wick — log but DO NOT SKIP. Stay WATCHING for next cycle.
        await db.prepare(`UPDATE paper_trades SET last_check_at=?, trader_notes=? WHERE id=?`).bind(Date.now(), `wick below stop @ ₹${q.ltp_paise/100} (stop ₹${w.stop_paise/100}) — F-EXIT-2 not confirmed, holding WATCHING`, w.id).run();
        await logDecision(db, { cron_phase: `entry_${attemptNum}`, symbol: w.symbol, trade_id: w.id, state_before: 'WATCHING', decision: 'WICK_BELOW_STOP_HOLDING', state_after: 'WATCHING', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic', rationale: 'F-EXIT-2: LTP touched stop but only single tick — last 2min not all below. Holding for next cycle.' });
        continue;
      }
    }

    // VOLUME CONFIRMATION: pull last 10-day avg volume per 5-min bar to compare with
    // current 15-min total. Breakouts on weak volume are unreliable.
    const volContext = await env.DB.prepare(`
      SELECT AVG(b.volume) AS avg_5min_vol_10d
      FROM intraday_bars b
      WHERE b.symbol = ? AND b.interval='5minute' AND b.trade_date < date('now')
        AND b.trade_date >= date('now', '-14 days')
    `).bind(w.symbol).first().catch(() => null);

    const avgVolPer5Min = volContext?.avg_5min_vol_10d || 0;
    const expectedVolFor15Min = avgVolPer5Min * 3;
    const volRatio = (expectedVolFor15Min > 0 && q.volume) ? +(q.volume / expectedVolFor15Min).toFixed(2) : null;
    const volumeConfirmed = volRatio !== null && volRatio >= 1.2;

    // ─── B-2: NEWS CONTEXT for entry-time decision ─────────────────────
    // Until tonight, entryDecision was price-only. If a pick fired breakout but
    // breaking BAD news arrived between 08:30 verdict and the entry attempt,
    // Opus would still say ENTER_NOW. Now we pull last 60 min of news for the
    // symbol and feed it to Opus so it can ABANDON on negative news.
    const recentNews = (await db.prepare(`
      SELECT headline, sentiment_score, importance_score, source,
             datetime(published_at/1000,'unixepoch','+5 hours','+30 minutes') AS ist_time
      FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 60*60*1000
        AND (headline LIKE ? OR symbols_tagged LIKE ?)
      ORDER BY importance_score DESC, published_at DESC LIMIT 5
    `).bind(`%${w.symbol}%`, `%${w.symbol}%`).all().catch(() => ({ results: [] }))).results || [];
    // Compact summary for the prompt (avg sentiment, headline previews)
    const newsSummary = recentNews.length > 0 ? {
      count_60min: recentNews.length,
      avg_sentiment: +(recentNews.reduce((s, n) => s + (n.sentiment_score || 0), 0) / recentNews.length).toFixed(2),
      max_importance: Math.max(...recentNews.map(n => n.importance_score || 0)),
      headlines: recentNews.map(n => `[${n.ist_time}] ${(n.headline || '').slice(0, 100)} (s=${n.sentiment_score?.toFixed(2) || '?'})`),
    } : null;

    // Opus call — should we enter NOW?
    const ctx = {
      symbol: w.symbol,
      attempt: attemptNum,
      time_ist: istHHMM(),
      ltp: q.ltp_paise / 100,
      current_15min_volume: q.volume,
      avg_5min_volume_14d: Math.round(avgVolPer5Min),
      volume_ratio_vs_avg: volRatio,
      volume_confirmed: volumeConfirmed,
      planned_entry: w.entry_paise / 100,
      planned_stop: w.stop_paise / 100,
      planned_target: w.target_paise / 100,
      rr_ratio: w.rr_ratio,
      opening_range_15min: w.high_15min_paise && w.low_15min_paise ? {
        open: w.open_15min_paise / 100,
        high: w.high_15min_paise / 100,
        low: w.low_15min_paise / 100,
        range_pct: ((w.high_15min_paise - w.low_15min_paise) * 100 / w.open_15min_paise).toFixed(2),
      } : null,
      ltp_vs_15min_high_pct: w.high_15min_paise ? (((q.ltp_paise - w.high_15min_paise) / w.high_15min_paise) * 100).toFixed(2) : null,
      pick_rationale: w.rationale,
      is_fno_expiry_day: isFnoExpiryDay(),
      days_to_fno_expiry: daysToFnoExpiry(),
      // B-2: news context — Opus now sees what happened in last 60 min
      recent_news_60min: newsSummary,
    };

    const system = `You are an intraday entry-execution decider for an Indian-equity paper trading system. The morning verdict already picked this stock. Your job: given current LTP, 15-min opening range, VOLUME RATIO vs 14-day average, AND RECENT NEWS (last 60 min), decide ENTER_NOW / WAIT / ABANDON.

Output STRICT JSON: { "decision": "ENTER_NOW" | "WAIT" | "ABANDON", "rationale": "1 sentence", "confidence": 0.0-1.0 }

Rules:
- ENTER_NOW requires ALL THREE: (a) LTP > 15-min high (price confirmed), (b) volume_ratio ≥ 1.2 (volume confirmed — 20%+ above avg), (c) LTP < planned_target × 0.7 (room to run)
- WAIT if: LTP still inside 15-min range OR breakout but volume_ratio < 1.2 (weak breakout) OR very close to target
- ABANDON if: attempt = 3 AND no breakout signal — too late for daily-profit window
- ABANDON if: recent_news_60min has STRONG NEGATIVE catalyst (avg_sentiment < -0.4 with max_importance ≥ 3) — thesis broken regardless of price action
- WAIT (downgrade from ENTER) if: recent_news_60min has mild-negative (avg_sentiment between -0.1 and -0.4) — wait one more attempt to see if price absorbs the news

Volume confirmation is CRITICAL — fake breakouts on low volume are the #1 source of intraday losses. If volume_ratio < 1.2, default to WAIT even if price broke out, unless attempt = 3.

NEWS GUARD is CRITICAL — entering against a fresh negative catalyst is the #2 source of losses. If avg_sentiment < -0.4, ABANDON even if price/volume look good.

Be decisive. Most attempts should be ENTER_NOW (with vol confirmed + no negative news) or WAIT (without). ABANDON only on attempt 3 with no clear signal, OR on strong negative news.`;

    const userPrompt = `Decide entry for this paper trade:\n\n${JSON.stringify(ctx, null, 2)}`;

    let result;
    try {
      result = await callOpus(env, {
        prompt: userPrompt, system, max_tokens: 200,
        purpose: 'trader_entry', worker: WORKER_NAME,
      });
    } catch (e) {
      await logDecision(db, { cron_phase: `entry_${attemptNum}`, symbol: w.symbol, trade_id: w.id, decision: 'OPUS_FAILED', rationale: String(e.message).slice(0, 200), composed_by_model: 'opus' });
      continue;
    }
    totalCost += result.cost_paise || 0;

    const parsed = parseJsonOutput(result.text);
    if (!parsed?.decision) continue;

    if (parsed.decision === 'ENTER_NOW') {
      // Fire paper entry — update paper_trade row
      await db.prepare(`
        UPDATE paper_trades
        SET trader_state='ENTERED', entry_paise=?, peak_price_paise=?,
            trailing_stop_paise=NULL, entry_at=?, entry_attempts=COALESCE(entry_attempts,0)+1,
            last_check_at=?, trader_notes=?, is_active=1
        WHERE id=?
      `).bind(
        q.ltp_paise, q.ltp_paise, Date.now(), Date.now(),
        (parsed.rationale || '').slice(0, 300), w.id,
      ).run();
      entered++;
    } else if (parsed.decision === 'ABANDON') {
      await db.prepare(`UPDATE paper_trades SET trader_state='ABANDONED', trader_notes=?, last_check_at=? WHERE id=?`)
        .bind((parsed.rationale || '').slice(0, 300), Date.now(), w.id).run();
    } else {
      // WAIT
      await db.prepare(`UPDATE paper_trades SET entry_attempts=COALESCE(entry_attempts,0)+1, last_check_at=?, trader_notes=? WHERE id=?`)
        .bind(Date.now(), (parsed.rationale || '').slice(0, 300), w.id).run();
    }

    await logDecision(db, {
      cron_phase: `entry_${attemptNum}`,
      symbol: w.symbol, trade_id: w.id,
      state_before: 'WATCHING',
      decision: parsed.decision,
      state_after: parsed.decision === 'ENTER_NOW' ? 'ENTERED' : (parsed.decision === 'ABANDON' ? 'ABANDONED' : 'WATCHING'),
      ltp_paise: q.ltp_paise,
      context_json: ctx,
      rationale: parsed.rationale,
      composed_by_model: result.model_id,
      cost_paise: result.cost_paise,
    });
  }

  return { rows: entered, attempts_made: watching.length, cost_paise: totalCost };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — PRICE_MONITOR (every 5 min during market)
// Deterministic. For each ENTERED position: read LTP, update peak, check
// trailing stop, fire exit if breached. Also enforces -2% portfolio halt rule.
// ═══════════════════════════════════════════════════════════════════════════
async function priceMonitor(env) {
  const db = env.DB;
  const today = istToday();
  // Risk config — percentage-based, scales with total_capital_paise.
  // Single batched read; used for profit_lock and loss_halt thresholds below.
  const risk = await getRiskConfig(db);

  // ─── PRECISION ENTRY TRIGGERS — process WATCHING + SKIPPED setups ──────
  // Continuous deterministic check: if LTP > OR-high × 1.001 AND volume ≥ 0.8x
  // expected pace → fire ENTER. Catches breakouts within 60s vs every-15-min
  // Opus decisions.
  //
  // F-EXIT-2 RESURRECTION (May 7 2026): SKIPPED rows are now eligible for entry
  // IF stock has sustained 2-min above OR-high × 1.001 AND above stop. Today's
  // TDPOWERSYS broke trigger at 09:40 (5 min above), got SKIPPED at 10:00 on
  // wick, broke trigger again at 10:55 — production missed both because of
  // permanent SKIP-lock + 09:30-09:50 dead zone.
  const watching = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise, stop_paise, target_paise,
           or_high_paise, or_low_paise, rationale, trader_state,
           DATE(created_at/1000, 'unixepoch') AS opened_date
    FROM paper_trades
    WHERE auto_managed=1 AND is_active=1
      AND trader_state IN ('WATCHING', 'SKIPPED')
      AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(today).all()).results || [];

  let entriesFired = 0;
  if (watching.length > 0) {
    const watchingSyms = watching.map(w => w.symbol);
    const watchingLtp = await getKiteLtp(env, watchingSyms);
    if (!watchingLtp._error) {
      for (const w of watching) {
        const q = watchingLtp[w.symbol];
        if (!q?.ltp_paise || !w.or_high_paise) continue;

        // BREAKOUT TRIGGER: LTP must clear OR-high by 0.1% (filters wick noise)
        const breakoutThreshold = Math.round(w.or_high_paise * 1.001);
        if (q.ltp_paise <= breakoutThreshold) continue;

        // F-EXIT-2 RESURRECTION GUARD (May 7 2026): SKIPPED rows need stricter
        // confirmation than WATCHING rows. A stock that wicked below stop earlier
        // must now be sustainedly above trigger AND above original stop for ≥ 2 min
        // before we re-enter. WATCHING rows entering for the first time keep the
        // simpler ≥1 tick above trigger rule (volume confirmation downstream).
        if (w.trader_state === 'SKIPPED') {
          const aboveTrigger = await confirmedSustainedAbove(db, w.symbol, breakoutThreshold, today);
          const aboveStop    = await confirmedSustainedAbove(db, w.symbol, w.stop_paise, today);
          if (!aboveTrigger || !aboveStop) continue;
          await logDecision(db, {
            cron_phase: 'price_monitor', symbol: w.symbol, trade_id: w.id,
            state_before: 'SKIPPED', decision: 'SKIPPED_RESURRECTION_QUALIFIED',
            ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
            rationale: `F-EXIT-2: stock recovered. LTP ₹${q.ltp_paise/100} sustained 2-min above trigger ₹${breakoutThreshold/100} AND above stop ₹${w.stop_paise/100}. Eligible for fresh entry.`,
          });
        }

        // VOLUME CONFIRMATION: pull 14-day avg vol/5min for this symbol
        const volRow = await db.prepare(`
          SELECT AVG(volume) AS avg_vol FROM intraday_bars
          WHERE symbol=? AND interval='5minute' AND trade_date < date('now')
            AND trade_date >= date('now', '-14 days')
        `).bind(w.symbol).first().catch(() => null);
        const avgVol5min = volRow?.avg_vol || 0;
        // BUG FIX (May 5 2026 evening): TIME-AWARE volume threshold.
        // Old formula: volRatio = q.volume / (avgVol5min × 12) — compared cumulative
        // day volume against "what 60 min of avg volume would be." But at 09:30 IST,
        // only 15 min has elapsed since 09:15 open, so even on a strong-volume day
        // the ratio is ~0.25, far below the 0.8 threshold. Result: continuous
        // breakout-trigger never fired in the 09:30-10:00 IST window — exactly when
        // most breakouts happen.
        //
        // New formula: compare against expected-by-now volume. minutes_since_open
        // ÷ 5 = bars_elapsed; expected_vol = avg_vol_per_5min × bars_elapsed.
        // Ratio = 1.0 means current volume matches the avg-day pace at this hour.
        // Threshold 0.8 = need 80% of expected pace = same semantic intent as before.
        const istHM = istHHMM();
        const [istH, istM] = istHM.split(':').map(Number);
        const minutesSinceOpen = Math.max(15, (istH - 9) * 60 + istM - 15);
        const barsSinceOpen = Math.max(3, minutesSinceOpen / 5);  // floor 3 bars (15 min)
        const expectedVolByNow = avgVol5min * barsSinceOpen;
        const volRatio = (avgVol5min > 0 && q.volume && expectedVolByNow > 0)
          ? (q.volume / expectedVolByNow) : null;
        // Need ≥ 0.8× expected pace. NULL → no historical baseline yet → allow.
        if (volRatio !== null && volRatio < 0.8) {
          continue; // weak volume vs expected at this hour, wait
        }

        // ─── FIRE ENTRY at actual breakout price ─────────────────────
        const actualEntry = q.ltp_paise;
        const stopPctFromOriginal = w.entry_paise > 0
          ? ((w.entry_paise - w.stop_paise) / w.entry_paise * 100)
          : 1.0;
        const targetPctFromOriginal = w.entry_paise > 0
          ? ((w.target_paise - w.entry_paise) / w.entry_paise * 100)
          : 3.0;
        // Recompute stop/target based on ACTUAL breakout entry price (not stale estimate)
        const newStop = Math.round(actualEntry * (1 - stopPctFromOriginal/100));
        const newTarget = Math.round(actualEntry * (1 + targetPctFromOriginal/100));
        // Recompute qty based on actual entry (preserve weight)
        const PAPER_CAPITAL_PAISE_LOCAL = 100000000;
        const originalCapital = w.qty * w.entry_paise; // preserves intent
        const newQty = Math.max(1, Math.floor(originalCapital / actualEntry));

        await db.prepare(`
          UPDATE paper_trades
          SET trader_state='ENTERED',
              entry_paise=?, stop_paise=?, target_paise=?,
              peak_price_paise=?, qty=?, entry_at=?,
              entry_trigger_at=?,
              trader_notes=?, last_check_at=?
          WHERE id=?
        `).bind(
          actualEntry, newStop, newTarget,
          actualEntry, newQty, Date.now(),
          Date.now(),
          `BREAKOUT_TRIGGER fired: LTP ₹${actualEntry/100} > OR-high ₹${w.or_high_paise/100} × 1.001 (vol_ratio ${volRatio?.toFixed(2) || '?'})`,
          Date.now(), w.id,
        ).run();

        await logDecision(db, {
          cron_phase: 'breakout_trigger', symbol: w.symbol, trade_id: w.id,
          state_before: 'WATCHING', decision: 'BREAKOUT_ENTER', state_after: 'ENTERED',
          ltp_paise: actualEntry, composed_by_model: 'deterministic',
          rationale: `Auto-entered at breakout: LTP ₹${actualEntry/100} > OR-high ₹${w.or_high_paise/100}, vol_ratio ${volRatio?.toFixed(2) || '?'}, qty ${newQty}, stop ₹${newStop/100}, target ₹${newTarget/100}`,
        });
        entriesFired++;
      }
    }
  }

  // ─── EXIT MONITOR for ENTERED positions ────────────────────────────
  // Read strategy_mode so we apply mode-specific trail width:
  //   INTRADAY_DEFAULT: 0.8% from peak (mechanical, fast)
  //   SWING_CANDIDATE:  1.5% from peak (room to run)
  //   SWING_CONFIRMED:  2.0% from peak (multi-day tolerance)
  const active = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise, stop_paise, target_paise,
           peak_price_paise, trailing_stop_paise, trader_state,
           strategy_mode, rationale, target_locked, trader_notes
    FROM paper_trades
    WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
      AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(today).all()).results || [];

  if (active.length === 0) return { rows: 0, skipped: 'no-active-positions' };

  const symbols = active.map(a => a.symbol);
  const ltp = await getKiteLtp(env, symbols);
  if (ltp._error) {
    // Can't monitor without prices — log + skip
    await logDecision(db, { cron_phase: 'price_monitor', decision: 'KITE_DOWN', rationale: ltp._error, composed_by_model: 'deterministic' });
    return { rows: 0, error: ltp._error };
  }

  let portfolioPnL = 0;
  let exitsfired = 0;

  // Pre-compute portfolio P&L to know if profit-lock should trigger
  for (const a of active) {
    const q = ltp[a.symbol];
    if (q?.ltp_paise) {
      portfolioPnL += (q.ltp_paise - a.entry_paise) * a.qty;
    }
  }
  // PROFIT LOCK: when portfolio P&L ≥ profit_lock threshold, tighten trailing
  // stops to max(entry+1%, current_trail). Winning day can't turn losing.
  // Threshold is now percentage-based (default 5% of total_capital_paise).
  const profitLockActive = portfolioPnL >= risk.profit_lock_paise;

  // ─── VOLATILITY REGIME GUARD ──────────────────────────────────────────
  // Read latest India VIX. If it spiked vs morning open → tighten ALL trails
  // to max(entry+0.5%, peak-0.5%). VIX spikes mid-day are often reversal-warnings.
  let vixSpike = false;
  try {
    const todayMorningVix = (await db.prepare(`
      SELECT context_snapshot_json FROM daily_verdicts
      WHERE trade_date=? AND verdict_type='morning' ORDER BY composed_at DESC LIMIT 1
    `).bind(today).first().catch(() => null));
    let morningVixVal = null;
    if (todayMorningVix?.context_snapshot_json) {
      const ctx = JSON.parse(todayMorningVix.context_snapshot_json);
      morningVixVal = ctx?.india_vix;
    }
    const currentVix = (await db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first().catch(() => null))?.vix;
    if (morningVixVal && currentVix && currentVix - morningVixVal > 1.5) {
      vixSpike = true;
      // Log once per day
      const recent = await db.prepare(`
        SELECT id FROM trader_decisions WHERE trade_date=? AND decision='VIX_SPIKE_GUARD_ARMED' LIMIT 1
      `).bind(today).first().catch(() => null);
      if (!recent) {
        await logDecision(db, {
          cron_phase: 'price_monitor',
          decision: 'VIX_SPIKE_GUARD_ARMED',
          rationale: `VIX ${morningVixVal.toFixed(1)} → ${currentVix.toFixed(1)} (Δ${(currentVix-morningVixVal).toFixed(1)}). Tightening all trails to entry+0.5% / peak-0.5%.`,
          composed_by_model: 'deterministic',
        });
      }
    }
  } catch {}

  for (const a of active) {
    const q = ltp[a.symbol];
    if (!q?.ltp_paise) continue;

    // Update peak
    const newPeak = Math.max(a.peak_price_paise || a.entry_paise, q.ltp_paise);

    // ── MODE-AWARE TRAILING ──
    // Trail width depends on strategy_mode (set by Opus position_mgmt promotion)
    const mode = a.strategy_mode || 'INTRADAY_DEFAULT';
    const trailPct = mode === 'SWING_CONFIRMED' ? 2.0
                   : mode === 'SWING_CANDIDATE' ? 1.5
                   : 0.8;  // INTRADAY_DEFAULT
    const trailAfterPct = mode === 'SWING_CONFIRMED' ? 1.0
                        : mode === 'SWING_CANDIDATE' ? 1.2
                        : 1.5;  // INTRADAY_DEFAULT arms only at +1.5%

    const armPriceEntry = a.entry_paise * (1 + trailAfterPct/100);
    let trailingStop = newPeak >= armPriceEntry
      ? Math.round(newPeak * (1 - trailPct/100))
      : null;

    // PROFIT LOCK override — once portfolio is up ₹30K+, raise every trail to
    // at least entry+1% so we cannot give back the day's win.
    if (profitLockActive) {
      const lockFloor = Math.round(a.entry_paise * 1.01);
      trailingStop = trailingStop ? Math.max(trailingStop, lockFloor) : lockFloor;
    }

    // VIX SPIKE GUARD — tighten further: trail = max(peak-0.5%, entry+0.5%)
    if (vixSpike) {
      const vixFloor = Math.round(a.entry_paise * 1.005);
      const vixTrailFromPeak = Math.round(newPeak * 0.995); // give back only 0.5%
      const vixTighter = Math.max(vixFloor, vixTrailFromPeak);
      trailingStop = trailingStop ? Math.max(trailingStop, vixTighter) : vixTighter;
    }

    let exitNow = false;
    let exitReason = null;

    // PARTIAL EXIT at first-target (60% of full target). Sells 50% of position,
    // keeps 50% as runner with trailing stop. Captures more upside on big days.
    // Requires: full qty still intact (haven't already partial-exited) and
    // LTP ≥ first_target_threshold (entry × (1 + first_target_pct/100)).
    const firstTargetPct = (a.target_paise && a.entry_paise)
      ? (((a.target_paise - a.entry_paise) / a.entry_paise) * 0.6 * 100)  // 60% of full target distance
      : null;
    const firstTargetPaise = firstTargetPct
      ? Math.round(a.entry_paise * (1 + firstTargetPct / 100))
      : null;
    const alreadyPartialExited = (a.trader_notes || '').includes('PARTIAL_50_AT_T1');

    if (firstTargetPaise && !alreadyPartialExited && q.ltp_paise >= firstTargetPaise && a.qty > 1) {
      // Fire partial exit (50%) — book first-target gain, keep runner
      const halfQty = Math.floor(a.qty / 2);
      const partialGrossPaise = (q.ltp_paise - a.entry_paise) * halfQty;
      // BUG FIX (May 5 2026): was 0.3% flat — replaced with realistic Zerodha intraday MIS
      const partialCostPaise = realisticIntradayCostPaise(a.entry_paise, q.ltp_paise, halfQty);
      const partialNetPaise = partialGrossPaise - partialCostPaise;
      await db.prepare(`
        UPDATE paper_trades
        SET qty = qty - ?,
            trader_notes = COALESCE(trader_notes, '') || ?,
            cost_paise = COALESCE(cost_paise, 0) + ?,
            pnl_net_paise = COALESCE(pnl_net_paise, 0) + ?,
            last_check_at = ?
        WHERE id = ?
      `).bind(
        halfQty,
        ` | PARTIAL_50_AT_T1 @ ₹${(q.ltp_paise/100).toFixed(2)} = +₹${Math.round(partialNetPaise/100)}`,
        partialCostPaise, partialNetPaise, Date.now(), a.id,
      ).run();
      // Tighten runner trail to entry+0.5% (lock min profit on remaining half)
      const runnerStopFloor = Math.round(a.entry_paise * 1.005);
      trailingStop = Math.max(trailingStop || runnerStopFloor, runnerStopFloor);
      await db.prepare(`UPDATE paper_trades SET trailing_stop_paise=? WHERE id=?`)
        .bind(trailingStop, a.id).run();
      await logDecision(db, {
        cron_phase: 'price_monitor', symbol: a.symbol, trade_id: a.id,
        state_before: 'ENTERED', decision: 'PARTIAL_EXIT_50_FIRST_TARGET', state_after: 'ENTERED',
        ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
        rationale: `LTP ₹${q.ltp_paise/100} ≥ first_target ₹${firstTargetPaise/100} (60% of full target). Booked 50% qty, runner trail at entry+0.5%`,
      });
      // Don't fire full exit this cycle — let runner continue
      continue;
    }

    // ★ F-EXIT-1 (May 6 2026, evening): per-position target-lock instead of
    //   immediate exit at target. Owner principle: "minimize loss, maximize
    //   profit only when probability of increase is very high."
    //
    //   Reverse-engineering today's HFCL trade exposed the gap: target hit at
    //   ₹137.13 (11:45 IST) → exited → stock continued to ₹142.95 (peak). The
    //   FULL_TARGET_HIT exit treats target as ceiling, not floor.
    //
    //   F-EXIT-1 mechanics: on first target hit, RAISE stop to target (lock the
    //   gain) and let normal trail logic continue. The next exit can ONLY be
    //   either (a) trail breaks below target+trail margin, or (b) STOP_HIT at
    //   target (= guaranteed minimum profit).
    //
    //   Asymmetric upside, zero new downside vs current behavior:
    //   - If price reverses straight back to target: exit at target (= same as
    //     current FULL_TARGET_HIT; stop_paise raised to target_paise)
    //   - If price continues higher: trail rides up, exits on first reversal
    //   - If price reverses below target then below original stop: impossible —
    //     stop is now at target, which is above original stop
    //
    //   position_mgmt cron (every 30 min) reads target_locked=1 and can either
    //   EXTEND_PROFIT (widen target via Opus 5-gate) or FULL_EXIT (book target
    //   gain). Default in interim: trail-driven exit.
    //
    //   ★ One subtlety: if target_locked=1 and stop_paise was raised to target,
    //   then q.ltp_paise <= a.stop_paise also fires the locked-floor exit.
    //   Reason text is differentiated for audit clarity.
    if (q.ltp_paise <= a.stop_paise) {
      // F-EXIT-2 (May 7 2026): require 2-min sustained breach, not single tick.
      // Wick-stop on a single tick costs us a real position when the stock
      // recovers within seconds. Real gap-down stays below for at least 2 min.
      const confirmed = await confirmedSustainedBelow(db, a.symbol, a.stop_paise, today);
      if (confirmed) {
        exitNow = true;
        exitReason = a.target_locked ? 'TARGET_LOCKED_FLOOR_EXIT' : 'STOP_HIT';
      } else {
        // Wick — log + skip exit this cycle, let next price_monitor reassess
        await logDecision(db, {
          cron_phase: 'price_monitor', symbol: a.symbol, trade_id: a.id,
          state_before: 'ENTERED', decision: 'WICK_BELOW_STOP_HOLDING',
          state_after: 'ENTERED', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
          rationale: `F-EXIT-2: LTP ₹${q.ltp_paise/100} ≤ stop ₹${a.stop_paise/100} but last 2min not all below. Single-tick wick — holding position.`,
        });
        // Update peak/trail still — stop check will re-fire next cycle if real
        await db.prepare(`UPDATE paper_trades SET peak_price_paise=?, trailing_stop_paise=?, last_check_at=? WHERE id=?`).bind(newPeak, trailingStop, Date.now(), a.id).run();
        continue;
      }
    } else if (!a.target_locked && q.ltp_paise >= a.target_paise) {
      // F-EXIT-1: lock target as floor, let trail continue. Don't exit this cycle.
      const newStopPaise = Math.max(a.stop_paise, a.target_paise);
      const lockNote = ` | TARGET_LOCKED @ ₹${(q.ltp_paise/100).toFixed(2)} (target=₹${(a.target_paise/100).toFixed(2)}) — F-EXIT-1: stop raised to target, trail captures further upside`;
      await db.prepare(`
        UPDATE paper_trades
        SET stop_paise=?, target_locked=1, peak_price_paise=?, trailing_stop_paise=?,
            last_check_at=?, trader_notes = COALESCE(trader_notes, '') || ?
        WHERE id=?
      `).bind(newStopPaise, newPeak, trailingStop, Date.now(), lockNote, a.id).run();
      await logDecision(db, {
        cron_phase: 'price_monitor', symbol: a.symbol, trade_id: a.id,
        state_before: 'ENTERED', decision: 'TARGET_LOCKED_F_EXIT_1',
        state_after: 'ENTERED', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
        rationale: `LTP ₹${q.ltp_paise/100} ≥ target ₹${a.target_paise/100}. F-EXIT-1: target locked as floor, stop raised from ₹${a.stop_paise/100} to ₹${newStopPaise/100}. Trail-driven exit only above this floor. position_mgmt will assess EXTEND_PROFIT vs FULL_EXIT next cycle.`,
      });
      continue; // Skip exit this cycle
    } else if (trailingStop && q.ltp_paise <= trailingStop) {
      // F-EXIT-2: also confirm trailing-stop breach with 2-min rule
      const confirmedTrail = await confirmedSustainedBelow(db, a.symbol, trailingStop, today);
      if (confirmedTrail) {
        exitNow = true;
        exitReason = a.target_locked ? 'TARGET_LOCKED_TRAIL_EXIT' : 'TRAILING_STOP_HIT';
      } else {
        await logDecision(db, {
          cron_phase: 'price_monitor', symbol: a.symbol, trade_id: a.id,
          state_before: 'ENTERED', decision: 'WICK_BELOW_TRAIL_HOLDING',
          state_after: 'ENTERED', ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
          rationale: `F-EXIT-2: LTP ₹${q.ltp_paise/100} ≤ trail ₹${trailingStop/100} but last 2min not all below. Single-tick wick — holding.`,
        });
        await db.prepare(`UPDATE paper_trades SET peak_price_paise=?, trailing_stop_paise=?, last_check_at=? WHERE id=?`).bind(newPeak, trailingStop, Date.now(), a.id).run();
        continue;
      }
    }

    if (exitNow) {
      await firePaperExit(db, a, q.ltp_paise, exitReason);
      exitsfired++;
      await logDecision(db, {
        cron_phase: 'price_monitor', symbol: a.symbol, trade_id: a.id,
        state_before: 'ENTERED', decision: exitReason, state_after: 'EXITED',
        ltp_paise: q.ltp_paise, composed_by_model: 'deterministic',
        rationale: `LTP ₹${q.ltp_paise/100} | stop ₹${a.stop_paise/100} | target ₹${a.target_paise/100} | trail ₹${trailingStop ? trailingStop/100 : 'none'}`,
      });
    } else {
      // Update peak + trailing stop in DB
      await db.prepare(`
        UPDATE paper_trades SET peak_price_paise=?, trailing_stop_paise=?, last_check_at=? WHERE id=?
      `).bind(newPeak, trailingStop, Date.now(), a.id).run();
    }
  }

  // ★ F-L4-LOCK (May 7 2026 update — percentage-based) — owner's profit-lock rule.
  // Originally hardcoded ₹30K (3%) for ₹10L. Now scales by `profit_lock_pct` from
  // user_config (default 5% per scenario backtest of 7 May session).
  // For ₹10L capital + 5% pct → threshold = ₹50K. For ₹10K capital + 5% → ₹500.
  //
  // Owner principle (raised from 3% to 5% in scenario backtest analysis):
  //   "On ₹10L deployment I want to safely exit at ₹10,50,000. Only hold past
  //    +₹50K when probability of going above +₹70K is extremely high."
  //
  // Implementation: at portfolio P&L ≥ risk.profit_lock_paise, FORCE EXIT default.
  // Each pick exits unless it has opus_extension_until > now (set by Opus
  // position_mgmt EXTEND_PROFIT decision).
  if (portfolioPnL >= risk.profit_lock_paise) {
    const remaining = (await db.prepare(`
      SELECT id, symbol, qty, entry_paise, opus_extension_until FROM paper_trades
      WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
        AND DATE(created_at/1000, 'unixepoch') = ?
    `).bind(today).all()).results || [];
    let forceExited = 0;
    let extended = 0;
    const nowMs = Date.now();
    const lockRupees = Math.round(risk.profit_lock_paise / 100);
    for (const r of remaining) {
      const q = ltp[r.symbol];
      if (!q?.ltp_paise) continue;
      const hasExtension = r.opus_extension_until && r.opus_extension_until > nowMs;
      if (hasExtension) {
        extended++;
        continue;
      }
      await firePaperExit(db, r, q.ltp_paise, `PROFIT_LOCK_FORCE_EXIT_${lockRupees}`);
      exitsfired++;
      forceExited++;
    }
    if (forceExited > 0 || extended > 0) {
      await logDecision(db, {
        cron_phase: 'price_monitor',
        decision: 'PROFIT_LOCK_FORCE_EXIT_FIRED',
        rationale: `Portfolio P&L +₹${Math.round(portfolioPnL/100)} ≥ ₹${lockRupees} threshold (${(risk.profit_lock_pct*100).toFixed(1)}% of ₹${Math.round(risk.capital_paise/100)} capital). Force-exited ${forceExited} positions. ${extended} kept on Opus EXTEND_PROFIT flag.`,
        composed_by_model: 'deterministic',
      });
    }
  }

  // LOSS HALT rule (kept asymmetric at 3% — losses cost more emotionally).
  // Threshold is now percentage-based via risk.loss_halt_paise.
  if (portfolioPnL <= -risk.loss_halt_paise) {
    const remaining = (await db.prepare(`
      SELECT id, symbol, qty, entry_paise FROM paper_trades
      WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
        AND DATE(created_at/1000, 'unixepoch') = ?
    `).bind(today).all()).results || [];
    const haltRupees = Math.round(risk.loss_halt_paise / 100);
    for (const r of remaining) {
      const q = ltp[r.symbol];
      if (!q?.ltp_paise) continue;
      await firePaperExit(db, r, q.ltp_paise, `DAILY_HALT_LOSS_${haltRupees}`);
      exitsfired++;
    }
    await logDecision(db, {
      cron_phase: 'price_monitor',
      decision: 'PORTFOLIO_LOSS_HALT_FIRED',
      rationale: `Portfolio P&L -₹${Math.round(Math.abs(portfolioPnL)/100)} hit -₹${haltRupees} halt rule (${(risk.loss_halt_pct*100).toFixed(1)}% of ₹${Math.round(risk.capital_paise/100)} capital). Exited ${remaining.length} positions. Halted for the day.`,
      composed_by_model: 'deterministic',
    });
  }

  // ★ F-L4-LOCK: legacy PROFIT_LOCK_ARMED replaced with FORCE EXIT above.
  // The trail-tightening at line ~668 (lockFloor = entry × 1.01) still runs
  // for positions that haven't yet reached portfolio +₹30K threshold but are
  // building toward it. That's still useful for protecting incremental gains.

  return {
    rows: active.length,
    exits_fired: exitsfired,
    portfolio_pnl_paise: portfolioPnL,
    profit_lock_active: profitLockActive,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3.5 — POSITION_MANAGEMENT (every 30 min from 11:00 to 14:00 IST)
//
// Opus reviews ALL ENTERED positions WITH context: today's news for each symbol,
// sector behavior, regime status, current P&L. Decides per-position:
//   HOLD            — position is healthy, let it run
//   TIGHTEN_TRAIL   — momentum slowing, narrow trailing band
//   PARTIAL_EXIT_50 — book half profits, let runner go
//   FULL_EXIT       — thesis broken, close now
//
// This is the MOST IMPORTANT INTELLIGENCE LAYER for daily-profit objective.
// Trailing stop alone reacts to PRICE. This layer reacts to CONTEXT.
// ═══════════════════════════════════════════════════════════════════════════
async function positionManagement(env) {
  const db = env.DB;
  const today = istToday();

  const positions = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise, stop_paise, target_paise,
           peak_price_paise, trailing_stop_paise, rationale, entry_at, last_check_at,
           target_locked, opus_extension_until
    FROM paper_trades
    WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
      AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(today).all()).results || [];

  if (positions.length === 0) return { rows: 0, skipped: 'no-positions-to-manage' };

  // Get current LTP for all
  const symbols = positions.map(p => p.symbol);
  const ltp = await getKiteLtp(env, symbols);
  if (ltp._error) return { rows: 0, error: ltp._error };

  // Pull RECENT news per symbol (last 4 hours) — context for Opus
  // BUG FIX (May 5 2026 evening): was querying non-existent news_articles table
  // with wrong column names (title, symbols_extracted). Real table is news_items
  // with headline + symbols_tagged. Three places, all silently returning empty
  // for 5+ days — Opus has been making position decisions WITHOUT news context.
  const newsBySymbol = {};
  for (const sym of symbols) {
    const news = (await db.prepare(`
      SELECT headline AS title, sentiment_score, source, published_at
      FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 4*3600000
        AND (headline LIKE ? OR symbols_tagged LIKE ?)
      ORDER BY published_at DESC LIMIT 5
    `).bind(`%${sym}%`, `%${sym}%`).all().catch(() => ({ results: [] }))).results || [];
    if (news.length > 0) newsBySymbol[sym] = news;
  }

  // Pull current regime + VIX (in case shifted since morning)
  const regimeNow = (await db.prepare(`
    SELECT regime, COUNT(*) AS n FROM signal_scores
    WHERE computed_at = (SELECT MAX(computed_at) FROM signal_scores)
    GROUP BY regime ORDER BY n DESC LIMIT 1
  `).first().catch(() => null)) || { regime: 'unknown' };
  const vixNow = (await db.prepare(`SELECT vix FROM india_vix_ticks ORDER BY ts DESC LIMIT 1`).first().catch(() => null))?.vix;

  // ─── INTRADAY MARKET CONTEXT (now refreshed throughout the day) ──────
  // Live sector indices (every 15 min by wealth-calendar-breadth)
  const liveSectors = (await db.prepare(`
    SELECT i1.* FROM sector_indices i1
    JOIN (SELECT index_name, MAX(trade_date) AS d FROM sector_indices GROUP BY index_name) i2
      ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
    LIMIT 12
  `).all().catch(() => ({ results: [] }))).results || [];

  // Breadth NOW (advance/decline live every 5 min) — table is `breadth_data`
  const breadthNow = await db.prepare(`
    SELECT advances, declines, unchanged, ad_ratio, new_highs, new_lows,
           datetime(ts/1000,'unixepoch','+5 hours 30 minutes') AS ist_time
    FROM breadth_data ORDER BY ts DESC LIMIT 1
  `).first().catch(() => null);

  // Cross-asset live (every 5 min by wealth-macro-global)
  const xAsset = (await db.prepare(`
    SELECT c1.asset_code, c1.ltp, c1.change_pct FROM crossasset_ticks c1
    JOIN (SELECT asset_code, MAX(ts) AS m FROM crossasset_ticks GROUP BY asset_code) c2
      ON c1.asset_code=c2.asset_code AND c1.ts=c2.m
    WHERE c1.asset_code IN ('DXY','BRENT','US10Y','USDINR','GOLD','VIX_US')
  `).all().catch(() => ({ results: [] }))).results || [];

  // Live Nifty PCR (every 1 min from option_chain_snapshot)
  const niftyPcrNow = await db.prepare(`
    SELECT SUM(pe_oi) AS pe, SUM(ce_oi) AS ce
    FROM option_chain_snapshot
    WHERE underlying='NIFTY' AND ts > strftime('%s','now')*1000 - 5*60*1000
  `).first().catch(() => null);
  const niftyPcr = (niftyPcrNow?.pe && niftyPcrNow?.ce > 0) ? +(niftyPcrNow.pe / niftyPcrNow.ce).toFixed(2) : null;

  // Today's morning verdict snapshot for comparison
  const morningVerdict = await db.prepare(`
    SELECT context_snapshot_json FROM daily_verdicts
    WHERE trade_date=? AND verdict_type='morning' ORDER BY composed_at DESC LIMIT 1
  `).bind(today).first().catch(() => null);
  let morningContext = null;
  try { morningContext = JSON.parse(morningVerdict?.context_snapshot_json || 'null'); } catch {}

  // ─── ENRICHMENT for promote-to-swing decisions ─────────────────────
  // For each position we pull additional context:
  //   • Sector relative strength (today vs morning)
  //   • Volume profile (last 15 min vs first 15 min)
  //   • News velocity (last 1h vs day baseline)
  //   • Multi-day breakout pattern (today's price vs 5-day high)
  const enrichBySymbol = {};
  for (const p of positions) {
    const sym = p.symbol;
    // Sector: pull stock's sector + check sector_indices today's move
    const sectorRow = await db.prepare(`
      SELECT sector_bucket FROM sector_classification WHERE symbol=? LIMIT 1
    `).bind(sym).first().catch(() => null);
    const sector = sectorRow?.sector_bucket;

    // Volume profile from intraday_bars: last 15 min vs first 15 min
    const volProfile = await db.prepare(`
      SELECT
        SUM(CASE WHEN ts >= strftime('%s','now')*1000 - 15*60*1000 THEN volume ELSE 0 END) AS last_15m_vol,
        SUM(CASE WHEN ts <= (SELECT MIN(ts) FROM intraday_bars WHERE symbol=? AND trade_date=date('now')) + 15*60*1000 THEN volume ELSE 0 END) AS first_15m_vol
      FROM intraday_bars WHERE symbol=? AND interval='5minute' AND trade_date=date('now')
    `).bind(sym, sym).first().catch(() => null);

    // 5-day high from equity_eod
    const fiveDayHigh = await db.prepare(`
      SELECT MAX(high_paise) AS h FROM equity_eod
      WHERE symbol=? AND trade_date >= date('now', '-7 days') AND trade_date < date('now')
    `).bind(sym).first().catch(() => null);

    // News velocity last 60 min — same bug fix (news_articles → news_items)
    const newsCount = await db.prepare(`
      SELECT COUNT(*) AS n FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 60*60*1000
        AND (headline LIKE ? OR symbols_tagged LIKE ?)
    `).bind(`%${sym}%`, `%${sym}%`).first().catch(() => null);

    enrichBySymbol[sym] = {
      sector,
      vol_last_15m: volProfile?.last_15m_vol || 0,
      vol_first_15m: volProfile?.first_15m_vol || 0,
      vol_sustaining_pct: (volProfile?.first_15m_vol > 0)
        ? +(((volProfile.last_15m_vol || 0) / volProfile.first_15m_vol) * 100).toFixed(1)
        : null,
      five_day_high_rs: fiveDayHigh?.h ? fiveDayHigh.h / 100 : null,
      news_count_last_60min: newsCount?.n || 0,
    };
  }

  // ─── EXIT-INTELLIGENCE ENRICHMENT (May 5 evening) ────────────────────────
  // Owner asked: "exiting at the right time is extremely important — is that
  // layer carefully and intelligently architectured?"
  //
  // Audit revealed: Opus position_mgmt was reading LTP/peak/trail/news/sector
  // but NOT the per-stock 90-day statistical priors (hit_2pct_rate,
  // avg_open_to_high_pct, green_close_rate). Those tell Opus things like:
  //   "this stock typically peaks at +2.92%; we're at +2.5% = 86% captured"
  //   "30% of typical days hit 3%+; we're at 1.5% = still upside likely"
  //   "62% green-close rate; afternoon recovery probable if down now"
  //
  // We now batch-fetch intraday_suitability stats + derive peak_at_ts per
  // position from intraday_bars + compute IST phase + classify trajectory.
  // ─────────────────────────────────────────────────────────────────────────
  const heldSymbols = positions.map(p => p.symbol).filter(Boolean);
  const placeholdersIS = heldSymbols.map(() => '?').join(',');
  const istNow = istHHMM();
  const [istHnow, istMnow] = istNow.split(':').map(Number);

  // Batch 1: 90-day statistical priors per symbol
  const suitabilityRows = heldSymbols.length > 0 ? (await db.prepare(`
    SELECT symbol, hit_2pct_rate, hit_3pct_rate, hit_5pct_rate,
           avg_open_to_high_pct, avg_open_to_low_pct, avg_daily_range_pct,
           green_close_rate, avg_turnover_cr, days_sampled,
           hit_2pct_last_week, avg_up_last_week_pct, green_close_last_week
    FROM intraday_suitability WHERE symbol IN (${placeholdersIS})
  `).bind(...heldSymbols).all().catch(() => ({ results: [] }))).results || [] : [];
  const statsBySymbol = {};
  for (const s of suitabilityRows) statsBySymbol[s.symbol] = s;

  // Batch 2: today's high + low + low timestamp + peak timestamp per symbol.
  // peak_at_ts = ts of the bar where high == max(high) for today (latest match).
  const istDate = istToday();
  const dayExtremes = heldSymbols.length > 0 ? (await db.prepare(`
    SELECT
      b.symbol,
      MAX(b.high_paise) AS day_high,
      MIN(b.low_paise)  AS day_low,
      (SELECT MAX(ts) FROM intraday_bars WHERE symbol=b.symbol AND trade_date=? AND interval='5minute' AND high_paise = (SELECT MAX(high_paise) FROM intraday_bars WHERE symbol=b.symbol AND trade_date=? AND interval='5minute')) AS peak_at_ts,
      (SELECT MAX(ts) FROM intraday_bars WHERE symbol=b.symbol AND trade_date=? AND interval='5minute' AND low_paise  = (SELECT MIN(low_paise)  FROM intraday_bars WHERE symbol=b.symbol AND trade_date=? AND interval='5minute')) AS low_at_ts
    FROM intraday_bars b
    WHERE b.symbol IN (${placeholdersIS}) AND b.trade_date=? AND b.interval='5minute'
    GROUP BY b.symbol
  `).bind(istDate, istDate, istDate, istDate, ...heldSymbols, istDate).all().catch(() => ({ results: [] }))).results || [] : [];
  const extremesBySymbol = {};
  for (const e of dayExtremes) extremesBySymbol[e.symbol] = e;

  // IST phase — Indian intraday has known time profiles. Embed this so Opus
  // applies different exit logic per phase.
  const istMinutesFromOpen = (istHnow - 9) * 60 + istMnow - 15;
  let istPhase;
  if (istMinutesFromOpen < 75) istPhase = 'morning_breakout_window';        // 09:15-10:30
  else if (istMinutesFromOpen < 255) istPhase = 'midday_consolidation';      // 10:30-13:30
  else if (istMinutesFromOpen < 345) istPhase = 'afternoon_momentum_window'; // 13:30-15:00
  else istPhase = 'pre_close_window';                                         // 15:00-15:30

  // Build per-position context (now with statistical priors + trajectory)
  const positionsContext = positions.map(p => {
    const q = ltp[p.symbol];
    const pnlPaise = q?.ltp_paise ? (q.ltp_paise - p.entry_paise) * p.qty : 0;
    const pnlPctNow = q?.ltp_paise ? +((q.ltp_paise - p.entry_paise) / p.entry_paise * 100).toFixed(2) : null;
    const peakPnlPct = p.peak_price_paise ? +((p.peak_price_paise - p.entry_paise) / p.entry_paise * 100).toFixed(2) : null;
    const minutesHeld = p.entry_at ? Math.round((Date.now() - p.entry_at) / 60000) : 0;
    const en = enrichBySymbol[p.symbol] || {};
    const stats = statsBySymbol[p.symbol] || {};
    const ext = extremesBySymbol[p.symbol] || {};
    const ltpRs = q?.ltp_paise / 100;

    // ── STATISTICAL: pct_of_typical_move_captured ──
    // If avg_open_to_high_pct = 2.92 and we're at +2.5% gain, ratio = 0.86 (86% of
    // typical max captured). > 0.8 means tighten aggressively. > 1.0 means exit.
    const pctOfTypicalMoveCaptured = (pnlPctNow && stats.avg_open_to_high_pct && stats.avg_open_to_high_pct > 0)
      ? +(pnlPctNow / stats.avg_open_to_high_pct).toFixed(2)
      : null;

    // ── TIMING: time_since_peak_min ──
    const peakAtTs = ext.peak_at_ts || null;
    const timeSincePeakMin = peakAtTs ? Math.round((Date.now() - peakAtTs) / 60000) : null;
    const lowAtTs = ext.low_at_ts || null;
    const timeSinceLowMin = lowAtTs ? Math.round((Date.now() - lowAtTs) / 60000) : null;

    // ── DRAWDOWN: give-back-from-peak-pct (recoverable vs reversal) ──
    const giveBackPct = (peakPnlPct != null && pnlPctNow != null && peakPnlPct > 0)
      ? +((peakPnlPct - pnlPctNow) / peakPnlPct).toFixed(2)  // 0.0=at peak, 1.0=fully back to entry
      : null;
    // Day-low-pct (lowest point today vs entry, for V-recovery detection)
    const dayLowPaise = ext.day_low || null;
    const dayLowPct = (dayLowPaise && p.entry_paise)
      ? +((dayLowPaise - p.entry_paise) / p.entry_paise * 100).toFixed(2)
      : null;
    const dayLowToNowPct = (dayLowPct != null && pnlPctNow != null)
      ? +(pnlPctNow - dayLowPct).toFixed(2)
      : null;

    // ── TRAJECTORY classification ──
    let trajectory = 'STAIR_STEP';
    if (dayLowPct != null && dayLowPct < -0.5 && pnlPctNow > 0) trajectory = 'V_RECOVERY';
    else if (dayLowPct != null && dayLowPct > -0.3 && (giveBackPct == null || giveBackPct < 0.3)) trajectory = 'LINEAR_UP';
    else if (giveBackPct != null && giveBackPct > 0.4) trajectory = 'FADING_FROM_PEAK';

    return {
      trade_id: p.id,
      symbol: p.symbol,
      strategy_mode: p.strategy_mode || 'INTRADAY_DEFAULT',
      entry_price: p.entry_paise / 100,
      current_ltp: ltpRs,
      peak_price: p.peak_price_paise ? p.peak_price_paise / 100 : null,
      day_low: dayLowPaise ? dayLowPaise / 100 : null,
      stop_price: p.stop_paise / 100,
      target_price: p.target_paise / 100,
      trailing_stop: p.trailing_stop_paise ? p.trailing_stop_paise / 100 : null,
      qty: p.qty,
      pnl_rupees: Math.round(pnlPaise / 100),
      pnl_pct_now: pnlPctNow,
      pnl_pct_at_peak: peakPnlPct,
      day_low_pct: dayLowPct,
      day_low_to_now_pct: dayLowToNowPct,
      give_back_from_peak_pct: giveBackPct,
      time_since_peak_min: timeSincePeakMin,
      time_since_low_min: timeSinceLowMin,
      minutes_held: minutesHeld,
      trajectory,
      ist_phase: istPhase,
      // ★ STATISTICAL PRIORS — 90-day per-stock baseline
      stat_priors: stats.avg_open_to_high_pct != null ? {
        hit_2pct_rate_90d: stats.hit_2pct_rate,
        hit_3pct_rate_90d: stats.hit_3pct_rate,
        hit_5pct_rate_90d: stats.hit_5pct_rate,
        avg_open_to_high_pct_90d: stats.avg_open_to_high_pct,
        avg_open_to_low_pct_90d: stats.avg_open_to_low_pct,
        green_close_rate_90d: stats.green_close_rate,
        avg_daily_range_pct_90d: stats.avg_daily_range_pct,
        // last-week trend (more recent)
        hit_2pct_last_week: stats.hit_2pct_last_week,
        avg_up_last_week_pct: stats.avg_up_last_week_pct,
        green_close_last_week: stats.green_close_last_week,
        days_sampled: stats.days_sampled,
      } : null,
      pct_of_typical_move_captured: pctOfTypicalMoveCaptured,
      // ★ F-EXIT-1 (May 6 2026): target_locked=1 means original target was hit
      //   already; stop_paise was raised to target_paise (= guaranteed minimum
      //   gain). Position is now in trail-only-above-target mode. Opus can
      //   either: WIDEN_TARGET (extend horizon, set new higher target) or
      //   FULL_EXIT (book the target gain now). Default = continue trailing.
      target_locked: p.target_locked === 1,
      // Whether Opus has already extended this position past the +₹30K force-exit
      // threshold. If extension is active and now expired (<1ms), it's a no-op.
      opus_extension_active_until: p.opus_extension_until && p.opus_extension_until > Date.now()
        ? new Date(p.opus_extension_until).toISOString() : null,
      original_thesis: (p.rationale || '').slice(0, 200),
      news_last_4h: newsBySymbol[p.symbol] || [],
      sector: en.sector,
      vol_sustaining_pct: en.vol_sustaining_pct,
      news_velocity_last_60min: en.news_count_last_60min,
      five_day_high: en.five_day_high_rs,
      breaking_5day_high: ltpRs && en.five_day_high_rs ? ltpRs >= en.five_day_high_rs : false,
    };
  });

  const portfolioPnL = positionsContext.reduce((s, p) => s + (p.pnl_rupees || 0) * 100, 0);

  const system = `You are a senior position manager for an Indian-equity paper-trading system. Called every 30 min during market hours. For each ENTERED position, decide:
  HOLD / TIGHTEN_TRAIL / PARTIAL_EXIT_50 / FULL_EXIT / WIDEN_TARGET / EXTEND_PROFIT / HOLD_OVERNIGHT / PROMOTE_TO_SWING_CANDIDATE / PROMOTE_TO_SWING_CONFIRMED

Output STRICT JSON: { "decisions": [ { "trade_id": N, "symbol": "X", "decision": "...", "rationale": "1 sentence", "new_trailing_stop_pct_below_peak": 0.8, "new_target_price": 142.50, "conviction": 0.0-1.0 } ] }

Decision logic (apply per position):
- HOLD if: position trending toward target, no adverse news, sector/regime supportive
- TIGHTEN_TRAIL if: momentum slowing (give-back from peak >50% of remaining target), 2nd half of session, or VIX spiking
- PARTIAL_EXIT_50 if: P&L ≥ +2% AND ≥ 60 min held — book half, let runner go
- FULL_EXIT if: adverse news on this stock, sector reversed, regime flipped to high_vol, give-back from peak >70%, or thesis materially broken

═══ STRATEGY MODE PROMOTION (avoid panic-exit on real winners) ═══
Default mode = INTRADAY_DEFAULT (0.8% trail from peak, hard exit 15:10).
But strong setups deserve longer holds. Promote based on context:

PROMOTE_TO_SWING_CANDIDATE — fire when ALL true:
  • Position P&L ≥ +1.5% (real cushion)
  • Time held ≥ 60 min (not a flash spike)
  • Sector_RS_today_pct > 0.5 (sector is confirming, not rolling)
  • Volume in last 15 min ≥ 50% of first 15 min volume (momentum sustaining)
  • Drawdown from peak < 50% of distance to entry (not topping)
Effects: trail widens to 1.5% from peak, eligible for HOLD_OVERNIGHT later.

PROMOTE_TO_SWING_CONFIRMED — fire when ALL true:
  • Already SWING_CANDIDATE
  • Position P&L ≥ +3%
  • Multi-day breakout pattern (today's high > 5-day high visible in context)
  • News_flow_last_60min ≥ 2x baseline (story building)
  • Catalyst still extending (rationale must cite specific catalyst)
Effects: trail widens to 2.0% from peak, requires HOLD_OVERNIGHT consideration at 14:30.

This means: instead of panic-exiting at first pullback, the system READS THE STORY and decides if this is a real winner that deserves room to run.

═══ HOLD_OVERNIGHT (rare exception — strict gates) ═══
Default = NEVER hold overnight. The system is intraday daily-profit by design.
ONLY invoke HOLD_OVERNIGHT when ALL 6 gates pass simultaneously:
  1. Current IST time is between 14:30 and 15:00 (last decision window)
  2. portfolio_total_pnl_rupees ≥ 30000 (daily target already locked — you're trading house money)
  3. THIS position pnl_pct_now ≥ +2% (real cushion exists)
  4. Your conviction on multi-day continuation ≥ 0.85 (very high)
  5. Multi-timeframe trend agrees up (rationale must explicitly mention D/W/M alignment)
  6. NO earnings within next 5 days for this stock (you must verify in original_thesis or decline)
  7. Max 1 position can be HELD_OVERNIGHT today — if another position already has this status, DON'T pick a second one

When HOLD_OVERNIGHT fires:
  - System auto-raises stop to max(peak × 0.985, entry × 1.01) — locks ≥1% minimum profit
  - Position survives 15:10 hard exit
  - Tomorrow 08:30 IST Opus reviews: continue OR exit at open
  - If pre-market gap-down >2%, system force-exits at open (no questions)

If you invoke HOLD_OVERNIGHT, your rationale MUST cite: (a) which catalyst extends beyond today, (b) D/W/M alignment confirmation, (c) why exit-now would leave significant value.

═══ STATISTICAL EXIT INTELLIGENCE (added May 5 evening) ═══
Each position now arrives with the per-stock 90-day priors AND today's trajectory shape.
USE THESE AGGRESSIVELY for exit timing — they are the difference between skill and luck.

Key fields you'll see in each position object:
  stat_priors.avg_open_to_high_pct_90d   ← typical max gain achievable in a day
  stat_priors.avg_open_to_low_pct_90d    ← typical max drawdown
  stat_priors.green_close_rate_90d       ← % of days this stock closes green
  stat_priors.hit_2pct/3pct/5pct_rate_90d ← how often it reaches each level
  pct_of_typical_move_captured           ← current_gain / avg_open_to_high (0=zero, 1=at typical max, >1=above-average day)
  give_back_from_peak_pct                ← 0=at peak, 1.0=back to entry, > 0.5=meaningful reversal
  time_since_peak_min                    ← stale peak = unlikely to revisit
  trajectory                             ← V_RECOVERY / LINEAR_UP / FADING_FROM_PEAK / STAIR_STEP
  ist_phase                              ← morning_breakout_window / midday_consolidation / afternoon_momentum_window / pre_close_window
  target_locked                          ← TRUE if original target was hit; stop_paise was raised to target. Position is now in trail-only-above-target mode (guaranteed minimum gain).

═══ TARGET_LOCKED POSITIONS — F-EXIT-1 (May 6 2026 evening) ═══

When target_locked=TRUE, the position has already hit its original target. The
deterministic system raised stop_paise to target_paise (= guaranteed minimum
gain) and continues trailing. Owner principle: "minimize loss, maximize profit
ONLY if probability of increase is very high."

Your job for these positions: decide whether to EXTEND beyond target or BOOK NOW.

WIDEN_TARGET (set new higher target) — fire when ALL true:
  • trajectory in ['LINEAR_UP', 'V_RECOVERY']  (NOT 'FADING_FROM_PEAK')
  • pct_of_typical_move_captured < 1.3  (haven't blown past 90d avg max yet)
  • avg_up_last_week_pct > avg_open_to_high_pct_90d × 1.1  (recent regime ≥ 90d)
  • breaking_5day_high OR sector_RS_today > 0.8
  • ist_phase != 'pre_close_window'
  • news_velocity_last_60min ≥ 1 OR vol_sustaining_pct > 60%
  Output: { decision: "WIDEN_TARGET", new_target_price: <Rs X.XX higher than current>,
            new_trailing_stop_pct_below_peak: 1.0,  // wider trail to let it run
            rationale: "Citing all 6 gates with values" }

FULL_EXIT (book the locked target gain now) — default for target_locked:
  • Any of: pct_of_typical_move_captured ≥ 1.5  (already 50% above 90d avg)
            give_back_from_peak_pct > 0.4 AND time_since_peak_min > 30
            ist_phase = 'pre_close_window'
            adverse news on the stock
            sector reversed
  Output: { decision: "FULL_EXIT", rationale: "Target locked, no extension justified by data" }

HOLD (continue trailing) — when neither WIDEN nor FULL_EXIT clearly fires:
  Position keeps running with current stop = target_paise (guaranteed min gain).
  Trail above target captures further upside; reversal exits at target.

PRINCIPLE for target_locked: WIDEN_TARGET requires HIGH confidence (5/6 gates).
The default for an already-locked position is FULL_EXIT (book the gain). The
floor is already guaranteed; only extend if the data shows a real, statistically
supported continuation. Owner's "very sure" gate applies HARDER here — we already
locked profit, additional risk-taking needs strong evidence.

STATISTICAL EXIT RULES (apply BEFORE the discretionary thesis-based ones):

  Rule S1 — STATISTICAL_TARGET_REACHED (FULL_EXIT or strong TIGHTEN):
    pct_of_typical_move_captured ≥ 1.0 → you've hit the 90-day average max for this stock
    Default: FULL_EXIT (mean-reversion likely from here)
    Override only if: trajectory='LINEAR_UP' AND ist_phase='afternoon_momentum_window'
    AND breaking_5day_high (real continuation possible)

  Rule S2 — APPROACHING_TYPICAL_MAX (TIGHTEN_TRAIL hard):
    pct_of_typical_move_captured 0.7-1.0 → near the 90-day avg max
    Action: TIGHTEN_TRAIL to 0.5% below peak (lock most of the gain)

  Rule S3 — STALE_PEAK_FADING (FULL_EXIT):
    time_since_peak_min > 60 AND trajectory='FADING_FROM_PEAK' AND give_back_from_peak_pct > 0.4
    Action: FULL_EXIT — peak is stale + fading is confirmed, peak unlikely to revisit

  Rule S4 — V_RECOVERY MID-DAY (HOLD with confidence):
    trajectory='V_RECOVERY' AND time_since_low_min > 30 AND green_close_rate_90d > 0.55
    Action: HOLD — recoveries from intraday lows that hold for 30+ min often continue

  Rule S5 — IST PHASE-AWARE TRAILS (apply to TIGHTEN_TRAIL trail %):
    ist_phase='morning_breakout_window'   → use 1.0% trail (let momentum run)
    ist_phase='midday_consolidation'      → use 0.6% trail (chop is common)
    ist_phase='afternoon_momentum_window' → use 1.2% trail (allow afternoon move)
    ist_phase='pre_close_window'          → use 0.4% trail (lock gains aggressively)

  Rule S6 — LOW HIT-RATE TARGET (don't get greedy):
    target_pct_remaining > avg_up_last_week_pct AND hit_3pct_rate_90d < 0.3
    Action: PARTIAL_EXIT_50 + TIGHTEN_TRAIL — historical odds say full target rarely hits

  Rule S7 — STRONG WEEK + DAY MATCH (let it run):
    avg_up_last_week_pct > avg_open_to_high_pct_90d × 1.3 AND green_close_last_week ≥ 4/5
    Action: HOLD even at pct_of_typical_move_captured=0.9 (recent regime stronger than 90d avg)

PRINCIPLE: rule conflicts? Statistical rules (S1-S7) WIN over discretionary rules unless
news_last_4h has a strong-positive catalyst (sentiment > +0.5, importance ≥ 4) explaining
why TODAY is special. Document any override in rationale.

═══ EXTEND_PROFIT (rare exception — owner's ₹30K → ₹50K rule, May 6 2026) ═══

Owner principle: at portfolio +₹30K, system DEFAULT is FORCE EXIT all positions.
Only exception: if you (Opus) EXPLICITLY upgrade a position with EXTEND_PROFIT,
the system keeps that position running for next 30 minutes.

ONLY invoke EXTEND_PROFIT when ALL 5 gates pass:
  1. portfolio_pnl >= ₹30000 (we're at the threshold)
  2. THIS position's pct_of_typical_move_captured < 0.7
     (room remaining within 90d avg — hasn't peaked yet)
  3. stat_priors.avg_open_to_high_pct_90d > 4%
     (stock historically reaches >4% on green days — extension worthwhile)
  4. stat_priors.hit_3pct_rate_90d > 30%
     (1 in 3 days hits +3% — odds of further extension supported)
  5. trajectory in ['LINEAR_UP', 'V_RECOVERY']
     (NOT 'FADING_FROM_PEAK' — momentum still building)
  AND no negative news in last 30 min
  AND ist_phase != 'pre_close_window' (no point extending in last 20 min)

When EXTEND_PROFIT fires:
  - System keeps that position running for next 30 min (re-evaluated next position_mgmt)
  - Cumulative target: position contributing toward +₹50K stretch
  - Owner's "very sure" gate is met — Opus is taking responsibility

Output: { decisions: [{ trade_id, decision: "EXTEND_PROFIT", extend_minutes: 30,
          rationale: "Citing all 5 gates with specific values", confidence: 0.9 }] }

Default at +₹30K is FORCE EXIT. EXTEND_PROFIT is the 1-in-10 confident call,
not the default. Be ruthless. ₹30K in hand > +₹50K hopium.

Be DECISIVE. Most healthy positions = HOLD. Most exits = FULL_EXIT or trailing-stop-fired. HOLD_OVERNIGHT is the rare 1-in-20-days call. EXTEND_PROFIT is the rare 1-in-10-days call.`;

  const userPrompt = `Mid-day position review · ${istHHMM()} IST
Portfolio P&L ₹${Math.round(portfolioPnL/100)}  ·  regime=${regimeNow.regime}  ·  VIX=${vixNow || '?'}

═══ LIVE MARKET CONTEXT (refreshed every 5-15 min) ═══
${JSON.stringify({
  live_sectors_today: liveSectors.map(s => ({ name: s.index_name, change_pct: s.change_pct })),
  market_breadth_now: breadthNow ? {
    advances: breadthNow.advances,
    declines: breadthNow.declines,
    ad_ratio: breadthNow.ad_ratio,
    new_highs: breadthNow.new_highs,
    new_lows: breadthNow.new_lows,
    last_update: breadthNow.ist_time,
  } : null,
  cross_asset_live: xAsset.map(a => ({ asset: a.asset_code, ltp: a.ltp, change_pct: a.change_pct })),
  nifty_pcr_now: niftyPcr,
  morning_regime: morningContext?.regime,
  morning_vix: morningContext?.india_vix,
  vix_change_from_morning: (vixNow && morningContext?.india_vix) ? +(vixNow - morningContext.india_vix).toFixed(2) : null,
}, null, 2)}

═══ POSITIONS (with sector RS, vol sustaining, news velocity, 5d-high break) ═══
${JSON.stringify(positionsContext, null, 2)}

Compose decisions JSON. Use the LIVE context to detect:
- Sector your position is in: rolling? confirming?
- Breadth deteriorating (declines > advances 2:1)? → tighten across portfolio
- VIX spike from morning? → de-risk
- Nifty PCR shifted bearish? → consider full exit on weak positions
- USDINR moved? → if IT/exporter positions, weight that signal`;

  let result;
  try {
    result = await callOpus(env, {
      prompt: userPrompt, system, max_tokens: 1200,
      purpose: 'trader_position_mgmt', worker: WORKER_NAME,
    });
  } catch (e) {
    await logDecision(db, { cron_phase: 'position_mgmt', decision: 'OPUS_FAILED', rationale: String(e.message).slice(0, 200), composed_by_model: 'opus' });
    return { rows: 0, error: e.message };
  }

  const parsed = parseJsonOutput(result.text);
  if (!parsed?.decisions) return { rows: 0, error: 'invalid-json', cost_paise: result.cost_paise };

  let actionCount = 0;
  for (const d of parsed.decisions) {
    const pos = positions.find(p => p.id === d.trade_id || p.symbol === d.symbol);
    if (!pos) continue;
    const q = ltp[pos.symbol];

    if (d.decision === 'FULL_EXIT' && q?.ltp_paise) {
      await firePaperExit(db, pos, q.ltp_paise, 'OPUS_FULL_EXIT');
      actionCount++;
    } else if (d.decision === 'WIDEN_TARGET' && q?.ltp_paise && pos.target_locked === 1) {
      // ★ F-EXIT-1 — Opus high-conviction extension on target_locked position.
      // Per the prompt's 6-gate rule: only fires when LINEAR_UP/V_RECOVERY +
      // statistical priors strong + breaking_5day_high or sector_RS_today > 0.8.
      // Opus must specify new_target_price (must be > current ltp).
      const newTargetRs = Number(d.new_target_price);
      const newTrailPct = Math.min(2.0, Math.max(0.6, Number(d.new_trailing_stop_pct_below_peak) || 1.0));
      if (Number.isFinite(newTargetRs) && newTargetRs * 100 > q.ltp_paise) {
        const newTargetPaise = Math.round(newTargetRs * 100);
        // Re-arm the target check by clearing target_locked AND raising target.
        // The locked floor (stop_paise = old target_paise) is preserved as the new minimum.
        const peak = pos.peak_price_paise || q.ltp_paise;
        const newTrailingStop = Math.round(peak * (1 - newTrailPct/100));
        await db.prepare(`
          UPDATE paper_trades
          SET target_paise = ?, target_locked = 0,
              trailing_stop_paise = ?,
              trader_notes = COALESCE(trader_notes, '') || ?,
              last_check_at = ?
          WHERE id = ?
        `).bind(
          newTargetPaise, newTrailingStop,
          ` | WIDEN_TARGET to ₹${newTargetRs.toFixed(2)} (was ₹${(pos.target_paise/100).toFixed(2)}) by Opus, trail=${newTrailPct.toFixed(2)}%: ${(d.rationale || '').slice(0, 200)}`,
          Date.now(), pos.id,
        ).run();
        await logDecision(db, {
          cron_phase: 'position_mgmt', symbol: pos.symbol, trade_id: pos.id,
          state_before: 'ENTERED', decision: 'OPUS_WIDEN_TARGET', state_after: 'ENTERED',
          ltp_paise: q.ltp_paise, composed_by_model: 'opus',
          rationale: `WIDEN_TARGET: ${pos.target_paise/100} → ${newTargetRs}, trail=${newTrailPct}%. ${d.rationale || ''}`,
        });
        actionCount++;
      } else {
        // Invalid new_target_price (≤ current ltp or non-numeric): default to FULL_EXIT
        await firePaperExit(db, pos, q.ltp_paise, 'OPUS_WIDEN_TARGET_INVALID_FULL_EXIT');
        actionCount++;
      }
    } else if (d.decision === 'EXTEND_PROFIT' && q?.ltp_paise) {
      // Owner's ₹30K → ₹50K extension gate. Opus has taken responsibility.
      // Set opus_extension_until = now + (extend_minutes || 30) min.
      const extendMin = Math.min(60, Math.max(15, d.extend_minutes || 30));
      const extendUntil = Date.now() + extendMin * 60000;
      await db.prepare(`
        UPDATE paper_trades
        SET opus_extension_until = ?,
            trader_notes = COALESCE(trader_notes, '') || ?,
            last_check_at = ?
        WHERE id = ?
      `).bind(
        extendUntil,
        ` | EXTEND_PROFIT for ${extendMin}min by Opus: ${(d.rationale || '').slice(0, 200)}`,
        Date.now(), pos.id,
      ).run();
      actionCount++;
    } else if (d.decision === 'PARTIAL_EXIT_50' && q?.ltp_paise && pos.qty > 1) {
      // Realize half — split into two rows: one closed, one continued
      const halfQty = Math.floor(pos.qty / 2);
      // Close half by reducing qty + booking partial pnl in trader_notes
      const partialGrossPaise = (q.ltp_paise - pos.entry_paise) * halfQty;
      const partialCostPaise = Math.round(Math.abs(pos.entry_paise * halfQty) * 0.003);
      const partialNetPaise = partialGrossPaise - partialCostPaise;
      await db.prepare(`
        UPDATE paper_trades
        SET qty = qty - ?,
            trader_notes = COALESCE(trader_notes, '') || ?,
            cost_paise = COALESCE(cost_paise, 0) + ?,
            pnl_net_paise = COALESCE(pnl_net_paise, 0) + ?,
            last_check_at = ?
        WHERE id = ?
      `).bind(
        halfQty,
        ` | PARTIAL_50 @ ₹${(q.ltp_paise/100).toFixed(2)} = +₹${Math.round(partialNetPaise/100)}`,
        partialCostPaise, partialNetPaise, Date.now(), pos.id,
      ).run();
      actionCount++;
    } else if (d.decision === 'TIGHTEN_TRAIL' && q?.ltp_paise) {
      const newTrailPct = d.new_trailing_stop_pct_below_peak || 0.5;
      const peak = pos.peak_price_paise || q.ltp_paise;
      const newTrailingStop = Math.round(peak * (1 - newTrailPct/100));
      // Don't lower an existing trailing stop
      const finalTrail = pos.trailing_stop_paise ? Math.max(pos.trailing_stop_paise, newTrailingStop) : newTrailingStop;
      await db.prepare(`UPDATE paper_trades SET trailing_stop_paise=?, trader_notes=?, last_check_at=? WHERE id=?`)
        .bind(finalTrail, `Trail tightened to ${newTrailPct}% below peak by Opus`, Date.now(), pos.id).run();
      actionCount++;
    } else if (d.decision === 'PROMOTE_TO_SWING_CANDIDATE' && q?.ltp_paise) {
      // Widen trail to 1.5% from peak, mark strategy_mode
      const peak = pos.peak_price_paise || q.ltp_paise;
      const newTrailingStop = Math.round(peak * (1 - 1.5/100));
      const finalTrail = pos.trailing_stop_paise ? Math.max(pos.trailing_stop_paise, newTrailingStop) : newTrailingStop;
      await db.prepare(`
        UPDATE paper_trades
        SET strategy_mode='SWING_CANDIDATE', mode_promoted_at=?, mode_promotion_reason=?,
            trailing_stop_paise=?, trader_notes=?, last_check_at=?
        WHERE id=?
      `).bind(
        Date.now(), (d.rationale || '').slice(0, 200),
        finalTrail,
        `PROMOTED→SWING_CANDIDATE: trail widened to 1.5% from peak. ${d.rationale}`,
        Date.now(), pos.id,
      ).run();
      actionCount++;
    } else if (d.decision === 'PROMOTE_TO_SWING_CONFIRMED' && q?.ltp_paise) {
      // Widen trail to 2.0% from peak, mark strategy_mode (eligible for HOLD_OVERNIGHT)
      const peak = pos.peak_price_paise || q.ltp_paise;
      const newTrailingStop = Math.round(peak * (1 - 2.0/100));
      const finalTrail = pos.trailing_stop_paise ? Math.max(pos.trailing_stop_paise, newTrailingStop) : newTrailingStop;
      await db.prepare(`
        UPDATE paper_trades
        SET strategy_mode='SWING_CONFIRMED', mode_promoted_at=?, mode_promotion_reason=?,
            trailing_stop_paise=?, trader_notes=?, last_check_at=?
        WHERE id=?
      `).bind(
        Date.now(), (d.rationale || '').slice(0, 200),
        finalTrail,
        `PROMOTED→SWING_CONFIRMED: trail widened to 2.0% from peak, eligible for HOLD_OVERNIGHT. ${d.rationale}`,
        Date.now(), pos.id,
      ).run();
      actionCount++;
    } else if (d.decision === 'HOLD_OVERNIGHT' && q?.ltp_paise) {
      // STRICT GATE — all 6 conditions must pass before allowing override
      const portfolioPnL = positionsContext.reduce((s, p) => s + (p.pnl_rupees || 0), 0);
      const posPnlPct = parseFloat(positionsContext.find(c => c.symbol === pos.symbol)?.pnl_pct_now || 0);
      const conviction = parseFloat(d.conviction || 0);
      const t = istHHMM();
      const inWindow = (t >= '14:30' && t <= '15:00');
      // Check no other position already HELD_OVERNIGHT today
      const otherHeld = await db.prepare(`
        SELECT COUNT(*) AS n FROM paper_trades WHERE auto_managed=1 AND trader_state='HELD_OVERNIGHT'
          AND DATE(created_at/1000, 'unixepoch') = ?
      `).bind(today).first();

      const gates = {
        time_window_ok: inWindow,
        daily_target_locked: portfolioPnL >= 30000,
        position_pnl_ok: posPnlPct >= 2.0,
        conviction_ok: conviction >= 0.85,
        no_other_overnight: (otherHeld?.n || 0) === 0,
      };
      const allPass = Object.values(gates).every(v => v === true);

      if (!allPass) {
        // Reject the HOLD_OVERNIGHT — fall back to TIGHTEN_TRAIL as safety
        await db.prepare(`UPDATE paper_trades SET trader_notes=?, last_check_at=? WHERE id=?`)
          .bind(`HOLD_OVERNIGHT REJECTED: gates ${JSON.stringify(gates)}`, Date.now(), pos.id).run();
        await logDecision(db, {
          cron_phase: 'position_mgmt', symbol: pos.symbol, trade_id: pos.id,
          state_before: 'ENTERED', decision: 'HOLD_OVERNIGHT_REJECTED',
          state_after: 'ENTERED', ltp_paise: q.ltp_paise,
          rationale: `Gates failed: ${Object.entries(gates).filter(([_,v])=>!v).map(([k])=>k).join(', ')}`,
          composed_by_model: result.model_id,
        });
      } else {
        // Approved — raise stop to floor max(peak * 0.985, entry * 1.01) and mark HELD_OVERNIGHT
        const peak = pos.peak_price_paise || q.ltp_paise;
        const stopFloor = Math.max(Math.round(peak * 0.985), Math.round(pos.entry_paise * 1.01));
        await db.prepare(`
          UPDATE paper_trades
          SET trader_state='HELD_OVERNIGHT', trailing_stop_paise=?, stop_paise=?,
              trader_notes=?, last_check_at=?
          WHERE id=?
        `).bind(
          stopFloor, stopFloor,
          `HOLD_OVERNIGHT (Opus conviction ${conviction}): ${(d.rationale || '').slice(0, 250)}`,
          Date.now(), pos.id,
        ).run();
        actionCount++;
      }
    }

    await logDecision(db, {
      cron_phase: 'position_mgmt', symbol: pos.symbol, trade_id: pos.id,
      state_before: 'ENTERED',
      decision: d.decision,
      state_after: d.decision === 'FULL_EXIT' ? 'EXITED' : 'ENTERED',
      ltp_paise: q?.ltp_paise,
      context_json: { pnl_pct: positionsContext.find(c => c.symbol === pos.symbol)?.pnl_pct_now },
      rationale: d.rationale,
      composed_by_model: result.model_id,
      cost_paise: Math.round((result.cost_paise || 0) / parsed.decisions.length),
    });
  }

  return { rows: positions.length, actions_taken: actionCount, cost_paise: result.cost_paise };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3.7 — SONNET SAFETY CHECK (every 15 min between Opus mgmt calls)
//
// Lighter, faster than Opus position-mgmt. Reads each ENTERED position's
// recent move + breaking news. Flags URGENT exits only (sharp drops, breaking
// negative news). Never overrides Opus — only fires FULL_EXIT when situation
// is unambiguous. Acts as safety net during 30-min Opus gap.
// ═══════════════════════════════════════════════════════════════════════════
async function sonnetSafetyCheck(env) {
  const db = env.DB;
  const today = istToday();

  const positions = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise, peak_price_paise
    FROM paper_trades
    WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
      AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(today).all()).results || [];
  if (positions.length === 0) return { rows: 0, skipped: 'no-positions' };

  const ltp = await getKiteLtp(env, positions.map(p => p.symbol));
  if (ltp._error) return { rows: 0, error: ltp._error };

  // Pull last 30 min of news per held symbol — same bug fix
  const newsBySymbol = {};
  for (const p of positions) {
    const news = (await db.prepare(`
      SELECT headline AS title, sentiment_score FROM news_items
      WHERE published_at > strftime('%s','now')*1000 - 30*60*1000
        AND (headline LIKE ? OR symbols_tagged LIKE ?)
      ORDER BY published_at DESC LIMIT 3
    `).bind(`%${p.symbol}%`, `%${p.symbol}%`).all().catch(() => ({ results: [] }))).results || [];
    if (news.length > 0) newsBySymbol[p.symbol] = news;
  }

  const ctx = positions.map(p => {
    const q = ltp[p.symbol];
    return {
      trade_id: p.id,
      symbol: p.symbol,
      ltp: q?.ltp_paise / 100,
      entry: p.entry_paise / 100,
      peak: p.peak_price_paise / 100,
      pnl_pct: q?.ltp_paise ? ((q.ltp_paise - p.entry_paise) / p.entry_paise * 100).toFixed(2) : null,
      drawdown_from_peak_pct: q?.ltp_paise && p.peak_price_paise ? ((p.peak_price_paise - q.ltp_paise) / p.peak_price_paise * 100).toFixed(2) : null,
      breaking_news_30min: newsBySymbol[p.symbol] || [],
    };
  });

  const system = `You are a SAFETY-NET intraday position monitor between 30-min Opus management cycles. Your job: flag ONLY urgent exit-now scenarios. Default = NO_ACTION. Output JSON.

Schema: { "actions": [ { "trade_id": N, "decision": "URGENT_EXIT" | "NO_ACTION", "reason": "1 sentence" } ] }

Fire URGENT_EXIT only when ALL of:
  • Position dropped > 1.5% from peak in last 15 min OR has breaking negative news in last 30 min
  • PnL is positive (locking gains) OR PnL is rapidly worsening (-0.5% per 5 min)

If anything is uncertain, choose NO_ACTION and let the next Opus 30-min cycle handle it. Be conservative — don't stack-cancel Opus's plans.`;

  const userPrompt = `Quick safety check at ${istHHMM()} IST:\n${JSON.stringify(ctx, null, 2)}\n\nFire URGENT_EXIT only on unambiguous situations.`;

  let result;
  try {
    result = await callSonnet(env, {
      prompt: userPrompt, system, max_tokens: 400,
      purpose: 'trader_safety_check', worker: WORKER_NAME,
    });
  } catch (e) {
    return { rows: 0, error: e.message };
  }

  const parsed = parseJsonOutput(result.text);
  if (!parsed?.actions) return { rows: 0, cost_paise: result.cost_paise };

  let urgentExits = 0;
  for (const a of parsed.actions) {
    if (a.decision !== 'URGENT_EXIT') continue;
    const pos = positions.find(p => p.id === a.trade_id);
    if (!pos) continue;
    const q = ltp[pos.symbol];
    if (!q?.ltp_paise) continue;
    await firePaperExit(db, pos, q.ltp_paise, 'SONNET_URGENT_EXIT');
    await logDecision(db, {
      cron_phase: 'sonnet_safety', symbol: pos.symbol, trade_id: pos.id,
      state_before: 'ENTERED', decision: 'URGENT_EXIT', state_after: 'EXITED',
      ltp_paise: q.ltp_paise, rationale: a.reason,
      composed_by_model: result.model_id, cost_paise: result.cost_paise,
    });
    urgentExits++;
  }

  return { rows: positions.length, urgent_exits: urgentExits, cost_paise: result.cost_paise };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — HARD_EXIT (14:30 IST)
// Force-close any ENTERED position regardless of price. Sleep flat.
// ═══════════════════════════════════════════════════════════════════════════
async function hardExit(env) {
  const db = env.DB;
  const today = istToday();

  // CRITICAL: Skip HELD_OVERNIGHT AND SWING_CONFIRMED positions —
  // SWING_CONFIRMED positions may have been promoted by Opus at 14:30+ for hold-overnight.
  // Only force-close INTRADAY_DEFAULT/SWING_CANDIDATE ENTERED positions still open at 15:10.
  const remaining = (await db.prepare(`
    SELECT id, symbol, qty, entry_paise FROM paper_trades
    WHERE auto_managed=1 AND is_active=1 AND trader_state='ENTERED'
      AND (strategy_mode IS NULL OR strategy_mode != 'SWING_CONFIRMED')
      AND DATE(created_at/1000, 'unixepoch') = ?
  `).bind(today).all()).results || [];

  if (remaining.length === 0) return { rows: 0, skipped: 'nothing-to-hard-exit' };

  const ltp = await getKiteLtp(env, remaining.map(r => r.symbol));
  let exited = 0;
  for (const r of remaining) {
    const q = ltp[r.symbol];
    const exitPrice = q?.ltp_paise || r.entry_paise; // fallback to entry if no LTP (rare)
    // Decision name now matches actual cron-fire time (15:10 IST, 5min before MIS auto-square at 15:15)
    await firePaperExit(db, r, exitPrice, 'HARD_EXIT_1510');
    exited++;
    await logDecision(db, {
      cron_phase: 'hard_exit_1510', symbol: r.symbol, trade_id: r.id,
      state_before: 'ENTERED', decision: 'HARD_EXIT_1510', state_after: 'EXITED',
      ltp_paise: exitPrice, composed_by_model: 'deterministic',
    });
  }

  return { rows: exited };
}

// Helper — write paper exit (closes the trade row)
//
// COST MODEL: Zerodha intraday MIS realistic round-trip cost. Replaces the old
// flat 0.3%-of-entry-side approximation that was overstating fees ~6× and
// dragging net P&L down vs reality.
//   - Brokerage:  ₹20/side capped (₹40 round-trip in paise = 4000)
//   - STT:        0.025% on sell-side turnover
//   - Exchange:   0.00322% on each side
//   - Stamp duty: 0.003% on buy-side
//   - GST:        18% on (brokerage + exchange)
// Total ≈ 0.04-0.06% of total turnover round-trip. Matches simulateTradeChronological()
// in functions/api/trading.js so live execution + replay use the same cost model.
function realisticIntradayCostPaise(entryPaise, exitPaise, qty) {
  const buyTurnover  = Math.abs(entryPaise) * qty;
  const sellTurnover = Math.abs(exitPaise)  * qty;
  const brokerage    = 4000;                                  // ₹40 round-trip
  const sttSell      = sellTurnover * 0.00025;
  const exchangeBoth = (buyTurnover + sellTurnover) * 0.0000322;
  const stampBuy     = buyTurnover * 0.00003;
  const gst          = (brokerage + exchangeBoth) * 0.18;
  return Math.round(brokerage + sttSell + exchangeBoth + stampBuy + gst);
}

async function firePaperExit(db, trade, exitPaise, reason) {
  const pnlGrossPaise = (exitPaise - trade.entry_paise) * trade.qty;
  const costPaise = realisticIntradayCostPaise(trade.entry_paise, exitPaise, trade.qty);
  const pnlNetPaise = pnlGrossPaise - costPaise;
  const winLoss = pnlNetPaise > 0 ? 'win' : (pnlNetPaise < 0 ? 'loss' : 'breakeven');

  // BUG FIX (May 7 2026, 12:18 IST): the partial-50 booking at first-target
  // (line ~707) ACCUMULATES into pnl_net_paise / cost_paise / pnl_gross_paise
  // via COALESCE(...,0) + ?, but firePaperExit was OVERWRITING with =?, which
  // erased the partial booking on runner exit. Today TDPOWERSYS booked +₹2,469
  // partial, then SONNET_URGENT_EXIT fired on the runner and overwrote the row
  // with only the runner's ₹2,661 — losing ₹2,469 from the daily tally.
  //
  // Fix: ACCUMULATE here too. For trades with no prior partial, COALESCE(...,0)
  // means the result equals the new value (same as old behavior). For trades
  // with a partial, the partial's contribution is preserved.
  //
  // win_loss is recomputed against the FINAL accumulated pnl_net so the flag
  // reflects whether the position-as-a-whole made money, not just the runner.
  await db.prepare(`
    UPDATE paper_trades
    SET is_active = 0,
        trader_state = 'EXITED',
        exit_paise = ?,
        exit_at = ?,
        exit_reason = ?,
        pnl_gross_paise = COALESCE(pnl_gross_paise, 0) + ?,
        pnl_net_paise = COALESCE(pnl_net_paise, 0) + ?,
        cost_paise = COALESCE(cost_paise, 0) + ?,
        win_loss = CASE
                     WHEN COALESCE(pnl_net_paise, 0) + ? > 0 THEN 'win'
                     WHEN COALESCE(pnl_net_paise, 0) + ? < 0 THEN 'loss'
                     ELSE 'breakeven' END,
        last_check_at = ?
    WHERE id = ?
  `).bind(
    exitPaise, Date.now(), reason,
    pnlGrossPaise, pnlNetPaise, costPaise,
    pnlNetPaise, pnlNetPaise,  // for the CASE comparison (sqlite re-binds positionally)
    Date.now(), trade.id,
  ).run();
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON DISPATCHER — single cron, dispatched by IST time
// ═══════════════════════════════════════════════════════════════════════════
async function dispatch(env, opts = {}) {
  const t = istHHMM();
  let phase = opts.force || routeByIstTime(t);

  // ─── B-1 SAFETY NET: range_capture single-point-of-failure protection ───
  // Original behaviour: rangeCapture only fires at exact hhmm '09:30'. If the
  // Cloudflare cron has any delay or the 09:30 invocation fails, no WATCHING
  // rows get created and the entire trading day is dead.
  //
  // Fallback: any cron tick during 09:30-10:30 IST that lands in the entry
  // window will check if rows exist for today; if none, runs rangeCapture as
  // safety net before the routed phase. Idempotent — rangeCapture's
  // `if (exists) continue` per pick means it's a no-op if rows already exist.
  if (!opts.force) {
    const [istH, istM] = t.split(':').map(Number);
    const inEntryWindow =
      (istH === 9 && istM >= 30) || (istH === 10 && istM <= 30);
    if (inEntryWindow) {
      const today = istToday();
      const exists = await env.DB.prepare(
        `SELECT 1 FROM paper_trades
         WHERE auto_managed=1 AND DATE(created_at/1000, 'unixepoch') = ?
         LIMIT 1`
      ).bind(today).first().catch(() => null);
      if (!exists) {
        // No rows yet for today — run rangeCapture as safety net
        const rcResult = await rangeCapture(env);
        await logDecision(env.DB, {
          cron_phase: 'range_capture_fallback',
          decision: `safety-net fired at ${t} IST: ${JSON.stringify(rcResult).slice(0, 200)}`,
          composed_by_model: 'deterministic',
        });
        // If we just successfully ran range_capture, continue normally (don't
        // double-fire it). If routeByIstTime returned 'range_capture', skip
        // the second call.
        if (phase === 'range_capture') phase = null;
      }
    }
  }

  if (!phase) return { rows: 0, skipped: `no-phase-at-${t}` };

  const id = await logCronStart(env.DB, phase);
  try {
    let r;
    switch (phase) {
      case 'range_capture':    r = await rangeCapture(env);                   break;
      case 'entry_1':          r = await entryDecision(env, 1);               break;
      case 'entry_2':          r = await entryDecision(env, 2);               break;
      case 'entry_3':          r = await entryDecision(env, 3);               break;
      case 'position_mgmt':    r = await positionManagement(env);             break;
      case 'sonnet_safety':    r = await sonnetSafetyCheck(env);              break;
      case 'price_monitor':    r = await priceMonitor(env);                   break;
      case 'hard_exit':        r = await hardExit(env);                       break;
      default:                 r = { rows: 0, skipped: `unknown-phase-${phase}` };
    }
    await logCronEnd(env.DB, id, 'success', r.rows || 0, r.error || null);
    return { phase, ...r };
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e));
    return { phase, error: String(e) };
  }
}

function routeByIstTime(hhmm) {
  // hh:mm string in IST
  if (hhmm === '09:30') return 'range_capture';
  if (hhmm === '09:45') return 'entry_1';
  if (hhmm === '10:00') return 'entry_2';
  if (hhmm === '10:15') return 'entry_3';

  // SMART EXIT LADDER (replaces single 14:30 hard_exit):
  //   14:30 — Opus review: keep winners (trailing stop above entry) running, exit losers/marginals
  //   15:00 — final Opus review with tighter criteria
  //   15:10 — HARD EXIT all (5 min before Kite MIS auto-square at 15:15)
  if (hhmm === '15:10') return 'hard_exit';

  // Mid-day Opus position management — every 30 min from 11:00 to 15:00 IST
  // Extended to 14:30 + 15:00 so winners can run into late-afternoon momentum window.
  // Each call: Opus reads news + sector + regime + P&L per position, decides
  // HOLD / TIGHTEN_TRAIL / PARTIAL_EXIT_50 / FULL_EXIT.
  if (['11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00'].includes(hhmm)) {
    return 'position_mgmt';
  }

  // Sonnet safety check — between Opus mgmt cycles (every 15 min through end of day).
  if (['11:15','11:45','12:15','12:45','13:15','13:45','14:15','14:45'].includes(hhmm)) {
    return 'sonnet_safety';
  }

  // All other 5-min marks during market hours → deterministic price monitor.
  //
  // F-EXIT-2 DEAD ZONE FIX (May 7 2026): was `m >= 50`, which gave a 09:30-09:49
  // dead zone where breakout-trigger never ran. TDPOWERSYS broke its trigger
  // ₹1235.70 at 09:40 IST and stayed above for 5 min — production missed it
  // entirely. Now starts at m >= 35: range_capture runs at 09:30, OR is in DB
  // by 09:31, first price_monitor at 09:35. (09:45 returns 'entry_1' first so
  // no double-fire.)
  //
  // Extended through 15:09 so trailing stops + halt rules + profit lock keep
  // firing until the hard_exit at 15:10.
  const [h, m] = hhmm.split(':').map(Number);
  const isMarketHr = (h >= 10 && h < 15) || (h === 15 && m < 10) || (h === 9 && m >= 35);
  if (isMarketHr && m % 5 === 0) return 'price_monitor';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP entrypoints — manual triggers for testing
// ═══════════════════════════════════════════════════════════════════════════
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) {
      return new Response('unauthorized', { status: 401 });
    }
    const force = url.searchParams.get('force_phase');
    if (force) return Response.json(await dispatch(env, { force }));
    if (url.pathname === '/state') {
      const today = istToday();
      const positions = (await env.DB.prepare(`
        SELECT id, symbol, trader_state, entry_paise, peak_price_paise, trailing_stop_paise,
               qty, exit_paise, exit_reason, pnl_net_paise, win_loss
        FROM paper_trades WHERE auto_managed=1 AND DATE(created_at/1000, 'unixepoch')=?
        ORDER BY id ASC
      `).bind(today).all()).results || [];
      const decisions = (await env.DB.prepare(`
        SELECT ts, cron_phase, symbol, decision, rationale FROM trader_decisions
        WHERE trade_date=? ORDER BY ts DESC LIMIT 30
      `).bind(today).all()).results || [];
      return Response.json({ today, ist_time: istHHMM(), positions, recent_decisions: decisions });
    }
    return new Response('wealth-trader — autonomous paper-trading executor', { status: 200 });
  },
};
