// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-orchestrator
// Automation layer — eliminates manual touchpoints across the engine.
//
// Crons:
//   1. Backfill orchestrator      — every 10 min, drains backfill_queue
//   2. Watchdog                   — every hour, checks cron health + sources
//   3. Pre-market briefing        — 08:00 IST daily M-F
//   4. Daily briefing compile     — 08:30 IST daily M-F
//   5. Cascade alert delta        — every 30 min during market hours
//   6. Stop-loss watcher          — every 5 min during market hours
//   7. Kite token reminder        — 06:05 IST daily M-F (after token expiry)
//   8. EOD portfolio snapshot     — 16:00 IST daily M-F (after market close)
//   9. Database vacuum            — Sat 02:00 IST weekly
//  10. Weekly performance digest  — Sun 18:00 IST weekly
// ═══════════════════════════════════════════════════════════════════════════

import { ymdHyphen, istNow, isISTMarketDay, safeFloat, rupeesToPaise } from '../../_shared/nseClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-orchestrator';

function emit(db, severity, category, title, body, opts = {}) {
  return db.prepare(
    `INSERT INTO system_alerts (ts,severity,category,title,body,related_symbol,related_pattern)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(Date.now(), severity, category, title, body || null, opts.symbol || null, opts.pattern || null).run();
}

// ────────────────────────────────────────────────────────────────────────
// CRON 1 — Backfill orchestrator
// Drains the backfill_queue table — picks the highest-priority queued item,
// invokes the corresponding Worker's HTTP /backfill endpoint, marks complete.
// Subrequest cap: 1000 per invocation. We process at most 1 batch per tick.
// ────────────────────────────────────────────────────────────────────────
// Maps backfill_queue.worker_name → service binding env property.
// Service Bindings bypass Cloudflare's worker-to-worker public-URL block.
const WORKER_SERVICE_MAP = {
  'wealth-price-core':   'WEALTH_PRICE_CORE',
  'wealth-flow-engine':  'WEALTH_FLOW_ENGINE',
  'wealth-signal-engine': 'WEALTH_SIGNAL_ENGINE',
};

async function runBackfillOrchestrator(env) {
  // Pick up to N chunks queued + drain them IN PARALLEL via Promise.all.
  // Each chunk has 25 sec timeout. Worker wall-clock budget = 30 sec on paid.
  // Parallelism × timeout fits — sequential would not.
  const MAX_PARALLEL_CHUNKS = 5;

  // Pick distinct (source) jobs to drain — avoid two parallel calls into same source's progress row
  const candidates = (await env.DB.prepare(
    `SELECT q.* FROM backfill_queue q
     LEFT JOIN backfill_progress p
       ON p.source_name=q.source_name AND p.date_from=q.date_from
     WHERE q.status IN ('queued','running')
       AND (p.status IS NULL OR p.status != 'complete')
     ORDER BY q.priority, q.created_at LIMIT ?`
  ).bind(MAX_PARALLEL_CHUNKS).all()).results || [];

  if (candidates.length === 0) return { rows: 0, skipped: 'queue-empty' };

  // Mark all as running
  for (const next of candidates) {
    if (next.status === 'queued') {
      await env.DB.prepare(
        `UPDATE backfill_queue SET status='running', started_at=? WHERE id=?`
      ).bind(Date.now(), next.id).run();
    }
  }

  // Drain in parallel
  const results = await Promise.allSettled(candidates.map(async (next) => {
    const serviceName = WORKER_SERVICE_MAP[next.worker_name];
    if (!serviceName || !env[serviceName]) {
      throw new Error(`No service binding for ${next.worker_name}`);
    }
    const path = `https://internal/backfill?source=${encodeURIComponent(next.source_name)}&from=${next.date_from}&to=${next.date_to}&key=${env.DASHBOARD_KEY}`;
    const r = await env[serviceName].fetch(path, { signal: AbortSignal.timeout(25000) });
    const j = await r.json();
    return { next, result: j };
  }));

  // Process results
  let totalDrained = 0;
  let chunksCompleted = 0;
  for (let i = 0; i < results.length; i++) {
    const next = candidates[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      const j = r.value.result;
      totalDrained += j.rows || 0;
      if (j.chunk_complete || j.status === 'complete' || j.status === 'already-complete') {
        await env.DB.prepare(
          `UPDATE backfill_queue SET status='complete', finished_at=? WHERE id=?`
        ).bind(Date.now(), next.id).run();
        await emit(env.DB, 'info', 'data_quality', `Backfill complete: ${next.source_name}`,
          `${next.date_from} → ${next.date_to}, +${j.rows || 0} rows last chunk`);
        chunksCompleted++;
      }
      // partial: leave as running, next tick continues
    } else {
      const err = String(r.reason).slice(0, 500);
      // Don't mark as error if it's just a timeout — chunk likely partial; let it retry
      if (!err.includes('timeout') && !err.includes('Timeout')) {
        await env.DB.prepare(
          `UPDATE backfill_queue SET status='error', error=?, finished_at=? WHERE id=?`
        ).bind(err, Date.now(), next.id).run();
        await emit(env.DB, 'warn', 'data_quality', `Backfill failed: ${next.source_name}`, err);
      }
      // For timeouts: stay 'running', try again next tick
    }
  }
  return { rows: totalDrained, chunks_attempted: candidates.length, chunks_completed: chunksCompleted };
}

// Bootstrap — populate backfill_queue with all initial 2-year backfills
async function seedBackfillQueue(env) {
  const FROM = '2024-05-03';
  const TO = ymdHyphen(istNow());
  const queue = [
    // W1 Layer 1
    { worker_name: 'wealth-price-core', source_name: 'nse_bhavcopy', priority: 1 },
    { worker_name: 'wealth-price-core', source_name: 'bse_bhavcopy', priority: 2 },
    { worker_name: 'wealth-price-core', source_name: 'delivery',     priority: 3 },
    // W2 Layer 2
    { worker_name: 'wealth-flow-engine', source_name: 'fii_dii_cash',       priority: 2 },
    { worker_name: 'wealth-flow-engine', source_name: 'fii_deriv',          priority: 3 },
    { worker_name: 'wealth-flow-engine', source_name: 'fno_participant_oi', priority: 3 },
    { worker_name: 'wealth-flow-engine', source_name: 'nse_bulk',           priority: 4 },
    { worker_name: 'wealth-flow-engine', source_name: 'nse_block',          priority: 4 },
    { worker_name: 'wealth-flow-engine', source_name: 'bse_deals',          priority: 5 },
    { worker_name: 'wealth-flow-engine', source_name: 'mwpl',               priority: 5 },
  ];
  const now = Date.now();
  for (const q of queue) {
    await env.DB.prepare(
      `INSERT INTO backfill_queue (worker_name,source_name,date_from,date_to,priority,status,created_at)
       VALUES (?,?,?,?,?,'queued',?)`
    ).bind(q.worker_name, q.source_name, FROM, TO, q.priority, now).run();
  }
  return { rows: queue.length, queued: queue.length };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 2 — Watchdog
// Scans cron_run_log for crons that should have fired but didn't (silent
// failure). Scans source_health for circuit-broken sources. Emits alerts.
// ────────────────────────────────────────────────────────────────────────
async function runWatchdog(env) {
  let alertsEmitted = 0;
  // Stale crons: any cron that succeeded historically but no run in last 90 min
  const stale = (await env.DB.prepare(
    `SELECT cron_name, MAX(started_at) AS last
     FROM cron_run_log GROUP BY cron_name
     HAVING last < ? AND last > ?`
  ).bind(Date.now() - 90 * 60 * 1000, Date.now() - 7 * 86400000).all()).results || [];
  for (const s of stale) {
    // Skip ones that legitimately don't run hourly (weekly, monthly)
    if (/weekly|monthly|shareholding|pledge|gst|mospi|pmi/.test(s.cron_name)) continue;
    // Avoid duplicate alerts within 6 hours
    const recent = await env.DB.prepare(
      `SELECT id FROM system_alerts WHERE category='watchdog' AND title LIKE ?
       AND ts > ? LIMIT 1`
    ).bind(`%${s.cron_name}%`, Date.now() - 6 * 3600000).first();
    if (recent) continue;
    await emit(env.DB, 'warn', 'watchdog', `Cron stale: ${s.cron_name}`,
      `Last run ${Math.round((Date.now() - s.last) / 60000)} min ago — expected within 90 min`);
    alertsEmitted++;
  }
  // Circuit-broken sources
  const broken = (await env.DB.prepare(
    `SELECT source_name, consecutive_failures, last_error FROM source_health
     WHERE is_circuit_broken=1`
  ).all()).results || [];
  for (const b of broken) {
    const recent = await env.DB.prepare(
      `SELECT id FROM system_alerts WHERE category='data_quality' AND related_symbol=?
       AND ts > ? LIMIT 1`
    ).bind(b.source_name, Date.now() - 12 * 3600000).first();
    if (recent) continue;
    await emit(env.DB, 'critical', 'data_quality', `Source circuit-broken: ${b.source_name}`,
      `${b.consecutive_failures} consecutive failures. Error: ${(b.last_error || '').slice(0, 300)}`,
      { symbol: b.source_name });
    alertsEmitted++;
  }
  return { rows: alertsEmitted, stale: stale.length, broken: broken.length };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 3 — Pre-market briefing (08:00 IST)
// Re-runs the cascade detector on overnight US/Asia data
// ────────────────────────────────────────────────────────────────────────
async function preMarketBriefing(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  if (!env.WEALTH_SIGNAL_ENGINE) return { rows: 0, skipped: 'no signal-engine binding' };
  // Fire detect_cascades on signal-engine via Service Binding (no public fetch)
  try {
    const r = await env.WEALTH_SIGNAL_ENGINE.fetch(
      `https://internal/run/detect_cascades?key=${env.DASHBOARD_KEY}`,
      { signal: AbortSignal.timeout(28000) }
    );
    const j = await r.json();
    return { rows: j.cascades || 0, ok: true };
  } catch (e) {
    await emit(env.DB, 'warn', 'watchdog', 'Pre-market cascade refresh failed', String(e).slice(0, 300));
    return { rows: 0, error: String(e) };
  }
}

// ────────────────────────────────────────────────────────────────────────
// CRON 4 — Daily briefing compile (08:30 IST)
// Pulls top signals + active cascades + FII flow + key macro into one record.
//
// Runs every day. On weekends/holidays, briefing is for the NEXT market day
// (preparation for Monday open is the most-read briefing of the week).
// ────────────────────────────────────────────────────────────────────────
function nextMarketDay(d) {
  const t = new Date(d);
  if (isISTMarketDay(t)) return t;
  // Walk forward to next market day
  do { t.setUTCDate(t.getUTCDate() + 1); } while (!isISTMarketDay(t));
  return t;
}

async function compileDailyBriefing(env) {
  const target = nextMarketDay(istNow());
  const today = ymdHyphen(target);

  const topSignals = (await env.DB.prepare(`
    SELECT s.symbol, s.composite_score, s.trend_score, s.flow_score, s.catalyst_score, s.macro_score
    FROM signal_scores s
    JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m
    ORDER BY s.composite_score DESC LIMIT 10
  `).all()).results || [];

  const activeCascades = (await env.DB.prepare(`
    SELECT * FROM cascade_triggers_active WHERE status='active' AND expected_window_end > ?
    ORDER BY detected_at DESC LIMIT 10
  `).bind(Date.now()).all()).results || [];

  const fiiYesterday = (await env.DB.prepare(`
    SELECT * FROM fii_dii_daily WHERE segment='cash' ORDER BY trade_date DESC LIMIT 3
  `).all()).results || [];

  const keyMacro = (await env.DB.prepare(`
    SELECT m1.* FROM macro_indicators m1
    JOIN (SELECT indicator_code, MAX(observation_date) AS d FROM macro_indicators GROUP BY indicator_code) m2
      ON m1.indicator_code=m2.indicator_code AND m1.observation_date=m2.d
    WHERE m1.indicator_code IN ('IN_REPO','US_FFR','US_10Y_DAILY','US_CPI','IN_CPI_YOY')
  `).all()).results || [];

  const indices = (await env.DB.prepare(`
    SELECT i1.* FROM indices_eod i1
    JOIN (SELECT index_name, MAX(trade_date) AS d FROM indices_eod GROUP BY index_name) i2
      ON i1.index_name=i2.index_name AND i1.trade_date=i2.d
    WHERE i1.index_name IN ('NIFTY 50','NIFTY BANK','INDIA VIX')
  `).all()).results || [];

  const upcoming = (await env.DB.prepare(`
    SELECT * FROM macro_calendar WHERE event_ts BETWEEN ? AND ?
    AND importance >= 2 ORDER BY event_ts LIMIT 10
  `).bind(Date.now(), Date.now() + 5 * 86400000).all()).results || [];

  const earningsToday = (await env.DB.prepare(`
    SELECT * FROM results_calendar WHERE result_date=? LIMIT 30
  `).bind(today).all()).results || [];

  // Compose narrative
  const fiiNet = fiiYesterday[0]?.fii_net_cr || 0;
  const fiiTone = fiiNet > 1500 ? 'aggressively buying' : fiiNet > 0 ? 'net buying' : fiiNet > -1500 ? 'net selling' : 'aggressively selling';
  const vix = indices.find(i => i.index_name === 'INDIA VIX');
  const vixVal = vix ? (vix.close_paise / 100).toFixed(1) : '?';
  const vixTone = vix && vix.close_paise > 1800 ? 'elevated' : vix && vix.close_paise > 1400 ? 'normal' : 'low';
  const topSym = topSignals[0]?.symbol;
  const topScore = topSignals[0]?.composite_score?.toFixed(1);
  const cascadeCount = activeCascades.length;
  const earningsCount = earningsToday.length;

  const narrative = [
    `FII ${fiiTone} (${fiiNet?.toFixed(0)} Cr yesterday)`,
    `India VIX ${vixVal} — ${vixTone}`,
    topSym ? `Top signal: ${topSym} at ${topScore}` : null,
    cascadeCount ? `${cascadeCount} active cascade pattern${cascadeCount > 1 ? 's' : ''}` : null,
    earningsCount ? `${earningsCount} earnings today` : null,
  ].filter(Boolean).join('. ') + '.';

  await env.DB.prepare(
    `INSERT OR REPLACE INTO daily_briefings
     (briefing_date,generated_at,market_pulse,top_signals,active_cascades,fii_dii_yesterday,key_macro,upcoming_events,earnings_today,narrative)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(today, Date.now(),
    JSON.stringify(indices),
    JSON.stringify(topSignals),
    JSON.stringify(activeCascades),
    JSON.stringify(fiiYesterday),
    JSON.stringify(keyMacro),
    JSON.stringify(upcoming),
    JSON.stringify(earningsToday),
    narrative
  ).run();

  await emit(env.DB, 'info', 'cascade', 'Daily briefing compiled', narrative);
  return { rows: 1, narrative };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 5 — Cascade alert delta
// Detects newly-active cascade patterns and emits alerts (avoid duplicates)
// ────────────────────────────────────────────────────────────────────────
async function cascadeAlertDelta(env) {
  if (!isISTMarketDay(istNow())) return { rows: 0, skipped: 'non-market-day' };
  const since = Date.now() - 35 * 60 * 1000;
  const newCascades = (await env.DB.prepare(`
    SELECT * FROM cascade_triggers_active WHERE detected_at > ? AND status='active'
  `).bind(since).all()).results || [];
  let alerted = 0;
  for (const c of newCascades) {
    const dup = await env.DB.prepare(
      `SELECT id FROM system_alerts WHERE category='cascade' AND related_pattern=?
       AND ts > ? LIMIT 1`
    ).bind(c.pattern_name, Date.now() - 2 * 3600000).first();
    if (dup) continue;
    let symList = '';
    try { symList = (JSON.parse(c.affected_symbols || '[]')).join(', '); } catch {}
    await emit(env.DB, 'info', 'cascade', `Pattern active: ${c.pattern_name}`,
      `Affected: ${symList} · Win rate ${(c.historical_win_rate * 100).toFixed(0)}% · Expected return ${c.expected_return_pct.toFixed(1)}%`,
      { pattern: c.pattern_name });
    alerted++;
  }
  return { rows: alerted };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 6 — Stop-loss watcher
// Every 5 min during market: pull LTP from intraday_ticks (or Kite if connected),
// compare to position_watchlist stops/targets, alert on breach.
// ────────────────────────────────────────────────────────────────────────
async function stopLossWatcher(env) {
  const now = istNow();
  if (!isISTMarketDay(now)) return { rows: 0, skipped: 'non-market-day' };
  const istHour = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440 / 60;
  if (istHour < 9.25 || istHour > 15.5) return { rows: 0, skipped: 'outside-market-hours' };

  const positions = (await env.DB.prepare(
    `SELECT * FROM position_watchlist WHERE is_active=1`
  ).all()).results || [];
  if (positions.length === 0) return { rows: 0, skipped: 'no-positions' };

  let alerted = 0;
  for (const p of positions) {
    // Latest LTP from intraday_ticks (preferred) or last EOD close (fallback)
    let ltp = null;
    const tick = await env.DB.prepare(
      `SELECT ltp_paise FROM intraday_ticks WHERE symbol=? ORDER BY ts DESC LIMIT 1`
    ).bind(p.symbol).first();
    if (tick) ltp = tick.ltp_paise;
    if (ltp == null) {
      const eod = await env.DB.prepare(
        `SELECT close_paise FROM equity_eod WHERE symbol=? AND exchange=? ORDER BY trade_date DESC LIMIT 1`
      ).bind(p.symbol, p.exchange || 'NSE').first();
      if (eod) ltp = eod.close_paise;
    }
    if (ltp == null) continue;

    // Update high-water mark for trailing stops
    if (!p.high_water_paise || ltp > p.high_water_paise) {
      await env.DB.prepare(
        `UPDATE position_watchlist SET high_water_paise=? WHERE id=?`
      ).bind(ltp, p.id).run();
    }

    // Stop-loss breach
    if (ltp <= p.stop_paise) {
      // Throttle: max 1 alert per position per 30 min
      if (p.last_alert_ts && Date.now() - p.last_alert_ts < 30 * 60 * 1000) continue;
      const lossPct = ((ltp - p.entry_price_paise) / p.entry_price_paise * 100).toFixed(2);
      await emit(env.DB, 'critical', 'stop_loss', `STOP LOSS: ${p.symbol}`,
        `LTP ₹${(ltp/100).toFixed(2)} ≤ stop ₹${(p.stop_paise/100).toFixed(2)} · Loss ${lossPct}% on ${p.qty} qty (${p.tranche})`,
        { symbol: p.symbol });
      await env.DB.prepare(
        `UPDATE position_watchlist SET last_alert_ts=? WHERE id=?`
      ).bind(Date.now(), p.id).run();
      alerted++;
    }
    // Target reached
    if (p.target_paise && ltp >= p.target_paise) {
      if (p.last_alert_ts && Date.now() - p.last_alert_ts < 30 * 60 * 1000) continue;
      const gainPct = ((ltp - p.entry_price_paise) / p.entry_price_paise * 100).toFixed(2);
      await emit(env.DB, 'info', 'stop_loss', `🎯 TARGET HIT: ${p.symbol}`,
        `LTP ₹${(ltp/100).toFixed(2)} ≥ target ₹${(p.target_paise/100).toFixed(2)} · Gain +${gainPct}% on ${p.qty} qty`,
        { symbol: p.symbol });
      await env.DB.prepare(
        `UPDATE position_watchlist SET last_alert_ts=? WHERE id=?`
      ).bind(Date.now(), p.id).run();
      alerted++;
    }
  }
  return { rows: alerted, positions: positions.length };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 6b — Reconcile Kite state every 5 min during market
// Pulls holdings, funds, orders, trades from Kite into D1 so the dashboard
// has live state without waiting for user to refresh.
// ────────────────────────────────────────────────────────────────────────
async function reconcileKite(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const tok = await env.DB.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (!tok || tok.expires_at <= Date.now()) return { rows: 0, skipped: 'no-active-token' };
  if (!env.KITE_API_KEY) return { rows: 0, skipped: 'no-api-key' };

  const auth = `token ${env.KITE_API_KEY}:${tok.access_token}`;
  const baseHeaders = {
    'X-Kite-Version': '3',
    'Authorization': auth,
  };
  let counts = { holdings: 0, orders: 0, trades: 0, funds: 0 };

  // 1. Holdings
  try {
    const r = await fetch('https://api.kite.trade/portfolio/holdings', { headers: baseHeaders });
    if (r.ok) {
      const j = await r.json();
      const data = j.data || [];
      const refreshedAt = Date.now();
      await env.DB.prepare('DELETE FROM kite_holdings_live').run();
      for (const h of data) {
        const ltp = Math.round((h.last_price || 0) * 100);
        const avg = Math.round((h.average_price || 0) * 100);
        const qty = h.quantity || 0;
        await env.DB.prepare(
          `INSERT OR REPLACE INTO kite_holdings_live
           (symbol,exchange,isin,quantity,avg_price_paise,ltp_paise,market_value_paise,pnl_paise,
            day_change_pct,total_return_pct,product,collateral_qty,refreshed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          h.tradingsymbol, h.exchange, h.isin || null, qty, avg, ltp,
          ltp * qty, (ltp - avg) * qty,
          h.day_change_percentage ?? null,
          avg ? ((ltp - avg) / avg * 100) : null,
          h.product || 'CNC', h.collateral_quantity || 0, refreshedAt
        ).run();
        counts.holdings++;
      }
    }
  } catch (e) {}

  // 2. Funds
  try {
    const r = await fetch('https://api.kite.trade/user/margins', { headers: baseHeaders });
    if (r.ok) {
      const j = await r.json();
      const refreshedAt = Date.now();
      for (const seg of ['equity', 'commodity']) {
        const m = j.data?.[seg];
        if (!m) continue;
        const avail = m.available || {};
        const cashAvail = (avail.cash || 0) + (avail.intraday_payin || 0);
        await env.DB.prepare(
          `INSERT OR REPLACE INTO kite_funds_live
           (segment,available_cash_paise,used_margin_paise,total_collateral_paise,
            available_total_paise,refreshed_at,raw_json)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(
          seg, Math.round(cashAvail * 100),
          Math.round((m.utilised?.debits || 0) * 100),
          Math.round((avail.collateral || 0) * 100),
          Math.round((m.net || cashAvail) * 100),
          refreshedAt, JSON.stringify(m)
        ).run();
        counts.funds++;
      }
    }
  } catch (e) {}

  // 3. Orders
  try {
    const r = await fetch('https://api.kite.trade/orders', { headers: baseHeaders });
    if (r.ok) {
      const j = await r.json();
      const now = Date.now();
      for (const o of (j.data || [])) {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO kite_orders_log
           (order_id,exchange,tradingsymbol,transaction_type,quantity,filled_quantity,
            pending_quantity,cancelled_quantity,order_type,product,validity,
            price_paise,trigger_price_paise,average_price_paise,status,status_message,
            tag,parent_order_id,placed_at,last_update_ts,exchange_timestamp)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          o.order_id, o.exchange, o.tradingsymbol, o.transaction_type, o.quantity,
          o.filled_quantity || 0, o.pending_quantity || 0, o.cancelled_quantity || 0,
          o.order_type, o.product, o.validity,
          Math.round((o.price || 0) * 100), Math.round((o.trigger_price || 0) * 100),
          Math.round((o.average_price || 0) * 100),
          o.status, o.status_message || null, o.tag || null, o.parent_order_id || null,
          Date.parse(o.order_timestamp) || now, now,
          Date.parse(o.exchange_timestamp) || null
        ).run();
        counts.orders++;
      }
    }
  } catch (e) {}

  // 4. Trades
  try {
    const r = await fetch('https://api.kite.trade/trades', { headers: baseHeaders });
    if (r.ok) {
      const j = await r.json();
      for (const t of (j.data || [])) {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO kite_trades
           (trade_id,order_id,exchange,tradingsymbol,transaction_type,quantity,
            average_price_paise,product,filled_at,exchange_timestamp)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          t.trade_id, t.order_id, t.exchange, t.tradingsymbol, t.transaction_type,
          t.quantity, Math.round((t.average_price || 0) * 100),
          t.product, Date.parse(t.fill_timestamp) || Date.now(),
          Date.parse(t.exchange_timestamp) || null
        ).run();
        counts.trades++;
      }
    }
  } catch (e) {}

  return { rows: counts.holdings + counts.orders + counts.trades + counts.funds, ...counts };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 6c — Daily Kite instruments sync (08:30 IST, before market opens)
// Pulls /instruments/NSE CSV → kite_instruments table.
// Required for: historical candles, future WebSocket subscriptions.
// ────────────────────────────────────────────────────────────────────────
async function ingestKiteInstrumentsCSV(env, segmentPath, lineFilter) {
  const tok = await env.DB.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (!tok || tok.expires_at <= Date.now()) return { rows: 0, skipped: 'no-active-token' };
  if (!env.KITE_API_KEY) return { rows: 0, skipped: 'no-api-key' };

  const r = await fetch(`https://api.kite.trade/instruments/${segmentPath}`, {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
    },
  });
  if (!r.ok) return { rows: 0, error: `HTTP ${r.status}` };
  const csv = await r.text();
  const lines = csv.split('\n');
  if (lines.length < 2) return { rows: 0, error: 'empty CSV' };

  const headers = lines[0].split(',').map(s => s.trim());
  const idx = (n) => headers.indexOf(n);
  const refreshedAt = Date.now();
  let written = 0;
  const BATCH = 7;  // D1 param cap → 7 rows × 13 cols = 91 params (safe under 100)
  // Pre-filter so we don't even process rows we don't want (NFO CSV is ~100k lines)
  const dataLines = [];
  for (let s = 1; s < lines.length; s++) {
    const line = lines[s];
    if (!line.trim()) continue;
    if (lineFilter && !lineFilter(line)) continue;
    dataLines.push(line);
  }

  // Build prepared statements in chunks, then send via D1.batch() — same pattern as batchInsert.
  const stmts = [];
  for (let s = 0; s < dataLines.length; s += BATCH) {
    const batch = dataLines.slice(s, s + BATCH);
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const sql = `INSERT OR REPLACE INTO kite_instruments
      (instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,
       tick_size,lot_size,instrument_type,segment,exchange,refreshed_at)
      VALUES ${placeholders}`;
    const params = [];
    for (const line of batch) {
      const c = line.split(',').map(x => x.replace(/^"|"$/g, ''));
      params.push(
        parseInt(c[idx('instrument_token')]) || 0,
        parseInt(c[idx('exchange_token')]) || null,
        c[idx('tradingsymbol')] || '',
        c[idx('name')] || null,
        parseFloat(c[idx('last_price')]) || null,
        c[idx('expiry')] || null,
        parseFloat(c[idx('strike')]) || null,
        parseFloat(c[idx('tick_size')]) || null,
        parseInt(c[idx('lot_size')]) || null,
        c[idx('instrument_type')] || null,
        c[idx('segment')] || null,
        c[idx('exchange')] || segmentPath,
        refreshedAt
      );
    }
    stmts.push(env.DB.prepare(sql).bind(...params));
  }
  // D1 batch supports up to 50 statements per call.
  const D1_BATCH = 50;
  for (let i = 0; i < stmts.length; i += D1_BATCH) {
    const slice = stmts.slice(i, i + D1_BATCH);
    try {
      const results = await env.DB.batch(slice);
      for (const res of results) written += res.meta?.changes || 0;
    } catch (e) {
      // continue on partial failure
    }
  }
  return { rows: written, kept_lines: dataLines.length, total_lines: lines.length - 1 };
}

async function syncKiteInstruments(env) {
  const r = await ingestKiteInstrumentsCSV(env, 'NSE', null);
  return r;
}

// NFO instruments — filter to NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY only.
// Full NFO CSV is ~100k lines; we keep only the indices we care about for
// option-chain ingest, which keeps the upsert under the subrequest budget.
async function syncKiteInstrumentsNFO(env) {
  const want = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']);
  // Cheap line filter: the CSV column order is fixed and `name` is the 4th col.
  // Bail-out fast on lines that don't even mention one of our targets to avoid
  // splitting every row of a ~100k-line CSV.
  const lineFilter = (line) => {
    if (!line.includes('NIFTY')) return false;
    const c = line.split(',').map(x => x.replace(/^"|"$/g, ''));
    return want.has(c[3]);
  };
  return ingestKiteInstrumentsCSV(env, 'NFO', lineFilter);
}

// ────────────────────────────────────────────────────────────────────────
// CRON 7 — Kite token reminder (06:05 IST)
// Token expires at 06:00 IST. Emit reminder so dashboard banner shows.
// ────────────────────────────────────────────────────────────────────────
async function kiteTokenReminder(env) {
  const today = ymdHyphen(istNow());
  // Only send once per day
  const sent = await env.DB.prepare(
    `SELECT * FROM kite_token_reminders WHERE reminder_date=?`
  ).bind(today).first();
  if (sent && sent.sent_at) return { rows: 0, skipped: 'already-sent' };

  // Check if there's an active token (post-06:00 it should be expired)
  const tok = await env.DB.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (tok && tok.expires_at > Date.now()) {
    // Token still valid (probably auto-extended somehow) — no reminder needed
    return { rows: 0, skipped: 'token-still-valid' };
  }

  await emit(env.DB, 'warn', 'kite_token', 'Kite token expired',
    'Re-authenticate at /wealth/auth/login (10-second OAuth). Live ticks & order endpoints disabled until reconnected.');

  await env.DB.prepare(
    `INSERT OR REPLACE INTO kite_token_reminders (reminder_date, sent_at) VALUES (?, ?)`
  ).bind(today, Date.now()).run();

  return { rows: 1 };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 8 — EOD portfolio snapshot (16:00 IST)
// Pulls Kite holdings, computes day-over-day P&L, persists.
// Falls back to position_watchlist if Kite is disconnected.
// ────────────────────────────────────────────────────────────────────────
async function eodPortfolioSnapshot(env) {
  const target = istNow();
  if (!isISTMarketDay(target)) return { rows: 0, skipped: 'non-market-day' };
  const today = ymdHyphen(target);

  // Try Kite first
  const tok = await env.DB.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  if (tok && tok.expires_at > Date.now() && env.KITE_API_KEY) {
    try {
      const r = await fetch('https://api.kite.trade/portfolio/holdings', {
        headers: {
          'X-Kite-Version': '3',
          'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
        },
      });
      if (r.ok) {
        const j = await r.json();
        const holdings = j.data || [];
        const ingestedAt = Date.now();
        const rows = holdings.map(h => ({
          snapshot_date: today,
          symbol: h.tradingsymbol,
          qty: h.quantity || 0,
          avg_price_paise: rupeesToPaise(h.average_price),
          ltp_paise: rupeesToPaise(h.last_price),
          market_value_paise: rupeesToPaise((h.last_price || 0) * (h.quantity || 0)),
          pnl_paise: rupeesToPaise(((h.last_price || 0) - (h.average_price || 0)) * (h.quantity || 0)),
          day_change_pct: safeFloat(h.day_change_percentage),
          total_return_pct: h.average_price ? safeFloat(((h.last_price || 0) - h.average_price) / h.average_price * 100) : null,
          source: 'kite',
          ingested_at: ingestedAt,
        }));
        const cols = ['snapshot_date','symbol','qty','avg_price_paise','ltp_paise','market_value_paise',
          'pnl_paise','day_change_pct','total_return_pct','source','ingested_at'];
        const written = await batchInsert(env.DB, 'portfolio_snapshots_daily', cols, rows, 'REPLACE');
        return { rows: written, source: 'kite' };
      }
    } catch (e) {
      // fall through to position_watchlist
    }
  }

  // Fallback: position_watchlist + EOD prices
  const positions = (await env.DB.prepare(
    `SELECT pw.*, e.close_paise AS ltp FROM position_watchlist pw
     LEFT JOIN equity_eod e ON e.symbol=pw.symbol AND e.exchange=pw.exchange
       AND e.trade_date=(SELECT MAX(trade_date) FROM equity_eod WHERE symbol=pw.symbol)
     WHERE pw.is_active=1`
  ).all()).results || [];
  const ingestedAt = Date.now();
  const rows = positions.map(p => ({
    snapshot_date: today,
    symbol: p.symbol,
    qty: p.qty,
    avg_price_paise: p.entry_price_paise,
    ltp_paise: p.ltp,
    market_value_paise: (p.ltp || 0) * (p.qty || 0),
    pnl_paise: ((p.ltp || 0) - p.entry_price_paise) * (p.qty || 0),
    day_change_pct: null,
    total_return_pct: p.entry_price_paise ? ((p.ltp || 0) - p.entry_price_paise) / p.entry_price_paise * 100 : null,
    source: 'watchlist',
    ingested_at: ingestedAt,
  })).filter(r => r.ltp_paise != null);
  const cols = ['snapshot_date','symbol','qty','avg_price_paise','ltp_paise','market_value_paise',
    'pnl_paise','day_change_pct','total_return_pct','source','ingested_at'];
  const written = await batchInsert(env.DB, 'portfolio_snapshots_daily', cols, rows, 'REPLACE');
  return { rows: written, source: 'watchlist' };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 9 — Database vacuum (Sat 02:00 IST weekly)
// Prune intraday_ticks > 90d, social_posts > 30d, news_items > 180d, kite_api_log > 14d
// ────────────────────────────────────────────────────────────────────────
async function databaseVacuum(env) {
  const cutoffs = [
    { table: 'intraday_ticks',     days: 90 },
    { table: 'option_chain_snapshot', days: 30 },
    { table: 'preopen_snapshot',   days: 14 },
    { table: 'gift_nifty_ticks',   days: 14 },
    { table: 'crossasset_ticks',   days: 30 },
    { table: 'india_vix_ticks',    days: 90 },
    { table: 'social_posts',       days: 30 },
    { table: 'news_items',         days: 180 },
    { table: 'most_active',        days: 14 },
    { table: 'breadth_data',       days: 30 },
    { table: 'kite_api_log',       days: 14 },
    { table: 'cron_run_log',       days: 30 },
  ];
  let totalDeleted = 0;
  for (const c of cutoffs) {
    const cutoffMs = Date.now() - c.days * 86400000;
    const tsCol = c.table === 'cron_run_log' ? 'started_at' : (c.table === 'news_items' ? 'published_at' : 'ts');
    try {
      const r = await env.DB.prepare(
        `DELETE FROM ${c.table} WHERE ${tsCol} < ?`
      ).bind(cutoffMs).run();
      totalDeleted += r.meta?.changes || 0;
    } catch (e) {}
  }
  // Drop expired alerts (already-acted, > 30 days)
  await env.DB.prepare(
    `DELETE FROM system_alerts WHERE acted_on=1 AND ts < ?`
  ).bind(Date.now() - 30 * 86400000).run();
  await emit(env.DB, 'info', 'data_quality', 'DB vacuum complete', `Deleted ${totalDeleted} rows`);
  return { rows: totalDeleted };
}

// ────────────────────────────────────────────────────────────────────────
// CRON 10 — Weekly performance digest (Sun 18:00 IST)
// Computes signal accuracy + portfolio return + market context for the week
// ────────────────────────────────────────────────────────────────────────
async function weeklyPerformanceDigest(env) {
  const target = istNow();
  const sundayStr = ymdHyphen(target);
  const weekStartMs = Date.now() - 7 * 86400000;

  // Signals last week
  const sig = (await env.DB.prepare(
    `SELECT COUNT(*) AS n, COUNT(CASE WHEN composite_score >= 65 THEN 1 END) AS actionable
     FROM signal_scores WHERE computed_at >= ?`
  ).bind(weekStartMs).first()) || { n: 0, actionable: 0 };

  // Cascades last week
  const cas = (await env.DB.prepare(
    `SELECT COUNT(*) AS n, AVG(expected_return_pct) AS avg_ret
     FROM cascade_triggers_active WHERE detected_at >= ?`
  ).bind(weekStartMs).first()) || { n: 0, avg_ret: 0 };

  // FII / DII week sum
  const flow = (await env.DB.prepare(
    `SELECT SUM(fii_net_cr) AS fii, SUM(dii_net_cr) AS dii
     FROM fii_dii_daily WHERE segment='cash' AND trade_date >= date('now', '-7 days')`
  ).first()) || { fii: 0, dii: 0 };

  // Nifty / Bank Nifty week change
  const nifty = (await env.DB.prepare(`
    SELECT (
      (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY 50' ORDER BY trade_date DESC LIMIT 1) -
      (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY 50' AND trade_date <= date('now','-7 days') ORDER BY trade_date DESC LIMIT 1)
    ) * 100.0 / (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY 50' AND trade_date <= date('now','-7 days') ORDER BY trade_date DESC LIMIT 1) AS pct
  `).first()) || { pct: null };
  const bankNifty = (await env.DB.prepare(`
    SELECT (
      (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY BANK' ORDER BY trade_date DESC LIMIT 1) -
      (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY BANK' AND trade_date <= date('now','-7 days') ORDER BY trade_date DESC LIMIT 1)
    ) * 100.0 / (SELECT close_paise FROM indices_eod WHERE index_name='NIFTY BANK' AND trade_date <= date('now','-7 days') ORDER BY trade_date DESC LIMIT 1) AS pct
  `).first()) || { pct: null };

  // Forward return on top-decile signals — 5-day comparison
  const sigReturns = (await env.DB.prepare(`
    SELECT s.symbol, s.composite_score, s.computed_at,
      (SELECT close_paise FROM equity_eod WHERE symbol=s.symbol AND trade_date <= date('now') ORDER BY trade_date DESC LIMIT 1) AS now_p,
      (SELECT close_paise FROM equity_eod WHERE symbol=s.symbol AND trade_date <= date('now','-5 days') ORDER BY trade_date DESC LIMIT 1) AS prior_p
    FROM signal_scores s
    WHERE s.computed_at BETWEEN ? AND ?
      AND s.composite_score >= 70
  `).bind(weekStartMs - 7 * 86400000, weekStartMs).all()).results || [];
  let avgFwd = null;
  if (sigReturns.length) {
    const valid = sigReturns.filter(r => r.now_p && r.prior_p);
    if (valid.length) {
      avgFwd = valid.reduce((a, r) => a + (r.now_p - r.prior_p) / r.prior_p, 0) / valid.length * 100;
    }
  }

  const narrative = [
    `Nifty ${nifty.pct != null ? nifty.pct.toFixed(2) + '%' : 'n/a'}, Bank Nifty ${bankNifty.pct != null ? bankNifty.pct.toFixed(2) + '%' : 'n/a'}`,
    `FII net ₹${(flow.fii || 0).toFixed(0)} Cr, DII net ₹${(flow.dii || 0).toFixed(0)} Cr`,
    `${sig.n} signals computed, ${sig.actionable} actionable (>65 score)`,
    avgFwd != null ? `Top-decile signals avg fwd return ${avgFwd.toFixed(2)}%` : null,
    cas.n ? `${cas.n} cascade triggers detected` : null,
  ].filter(Boolean).join('. ') + '.';

  await env.DB.prepare(
    `INSERT OR REPLACE INTO weekly_performance
     (week_ending,generated_at,signals_emitted,signals_actionable,avg_signal_return_pct,
      cascade_triggers,cascade_avg_return_pct,fii_net_cr,dii_net_cr,nifty_change_pct,banknifty_change_pct,narrative)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(sundayStr, Date.now(), sig.n, sig.actionable, avgFwd,
    cas.n, cas.avg_ret, flow.fii, flow.dii, nifty.pct, bankNifty.pct, narrative).run();

  await emit(env.DB, 'info', 'data_quality', 'Weekly digest compiled', narrative);
  return { rows: 1, narrative };
}

// ────────────────────────────────────────────────────────────────────────
// CRON — Paper-trade watcher (5 min market hours)
// Closes paper trades when LTP hits stop or target, records Bayesian obs.
// Same logic as stopLossWatcher but for paper_trades table.
// ────────────────────────────────────────────────────────────────────────
async function paperTradeWatcher(env) {
  const now = istNow();
  if (!isISTMarketDay(now)) return { rows: 0, skipped: 'non-market-day' };
  const istHour = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440 / 60;
  if (istHour < 9.25 || istHour > 15.5) return { rows: 0, skipped: 'outside-market-hours' };

  // BUG FIX (May 6 2026, F3 from /trading/audit/): orchestrator's paper_trade
  // watcher was firing phantom exits on auto_managed rows still in WATCHING
  // state — wealth-trader owns those. Today created bogus -₹3,931 P&L for
  // DEEDEV/STLTECH that never actually entered. Skip auto_managed rows here:
  // wealth-trader manages their full lifecycle.
  const open = (await env.DB.prepare(
    `SELECT * FROM paper_trades WHERE is_active=1 AND COALESCE(auto_managed,0)=0`
  ).all()).results || [];
  if (open.length === 0) return { rows: 0, skipped: 'no-open-paper-trades' };

  // Bulk-fetch live Kite LTP for all open symbols ONCE (saves subrequests)
  const openSymbols = [...new Set(open.map(t => t.symbol))];
  let kiteLtpMap = {};
  try {
    if (env.KITE_API_KEY && openSymbols.length > 0) {
      const tok = await env.DB.prepare(
        `SELECT access_token, expires_at FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
      ).first();
      if (tok && Date.now() < tok.expires_at) {
        const params = openSymbols.map(s => `i=${encodeURIComponent('NSE:' + s)}`).join('&');
        const r = await fetch(`https://api.kite.trade/quote/ltp?${params}`, {
          headers: {
            'X-Kite-Version': '3',
            'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
          },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const j = await r.json();
          for (const key of Object.keys(j.data || {})) {
            const sym = key.split(':')[1];
            if (sym && j.data[key].last_price != null) {
              kiteLtpMap[sym] = Math.round(j.data[key].last_price * 100);
            }
          }
        }
      }
    }
  } catch (e) {
    // Kite call fail is non-critical — fall through to other sources
  }

  let closed = 0;
  for (const t of open) {
    let ltp = null;
    // Priority: intraday_ticks (≤5min) → Kite live → EOD close
    const tick = await env.DB.prepare(
      `SELECT ltp_paise, ts FROM intraday_ticks WHERE symbol=? ORDER BY ts DESC LIMIT 1`
    ).bind(t.symbol).first();
    if (tick && Date.now() - tick.ts < 5 * 60000) ltp = tick.ltp_paise;
    if (ltp == null && kiteLtpMap[t.symbol]) ltp = kiteLtpMap[t.symbol];
    if (ltp == null) {
      const eod = await env.DB.prepare(
        `SELECT close_paise FROM equity_eod WHERE symbol=? AND exchange='NSE' ORDER BY trade_date DESC LIMIT 1`
      ).bind(t.symbol).first();
      if (eod) ltp = eod.close_paise;
    }
    if (ltp == null) continue;

    let exitReason = null, exitPrice = null;
    if (ltp <= t.stop_paise) { exitReason = 'stop_hit'; exitPrice = t.stop_paise; }
    else if (ltp >= t.target_paise) { exitReason = 'target_hit'; exitPrice = t.target_paise; }
    if (!exitReason) continue;

    // Close the paper trade
    const grossPnl = (exitPrice - t.entry_paise) * t.qty;
    // Approximate cost — won't be perfect without the costModel import, but order-of-magnitude is fine
    const sttSell = Math.round(exitPrice * t.qty * 0.001);
    const cost = sttSell + 4000; // ~₹40 brokerage+exchange+GST+stamp+DP combined
    const netPnl = grossPnl - cost;
    const winLoss = netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'flat';
    await env.DB.prepare(`
      UPDATE paper_trades SET exit_at=?, exit_paise=?, exit_reason=?,
        pnl_gross_paise=?, pnl_net_paise=?, cost_paise=?, win_loss=?, is_active=0 WHERE id=?
    `).bind(Date.now(), exitPrice, exitReason, grossPnl, netPnl, cost, winLoss, t.id).run();

    // Bayesian observation
    try {
      await env.DB.prepare(`
        INSERT INTO bayesian_observations
          (ts, position_id, backtest_run_id, bucket_key, tranche, score_band,
           cascade_pattern, regime, symbol, composite_score, entry_paise,
           exit_paise, pnl_pct, pnl_paise, win_loss, hold_days, exit_reason, created_at)
        VALUES (?,NULL,NULL,?,?,?,NULL,'paper',?,?,?,?,?,?,?,?,?,?)
      `).bind(
        Date.now(),
        `${t.tranche}|${t.composite_score >= 90 ? '90+' : t.composite_score >= 80 ? '80-90' : t.composite_score >= 70 ? '70-80' : '<70'}|none|paper`,
        t.tranche,
        t.composite_score >= 90 ? '90+' : t.composite_score >= 80 ? '80-90' : t.composite_score >= 70 ? '70-80' : '<70',
        t.symbol, t.composite_score, t.entry_paise,
        exitPrice,
        ((exitPrice - t.entry_paise) / t.entry_paise * 100),
        netPnl, winLoss,
        Math.round((Date.now() - t.entry_at) / 86400000),
        exitReason, Date.now()
      ).run();
    } catch (e) {
      // observation fail is non-critical
    }

    closed++;
    await emit(env.DB, exitReason === 'target_hit' ? 'info' : 'warn', 'paper_trade',
      `${exitReason === 'target_hit' ? '🎯' : '🛑'} PAPER ${t.symbol} ${exitReason}`,
      `Exit ₹${(exitPrice/100).toFixed(2)} · P&L ${netPnl >= 0 ? '+' : ''}₹${Math.round(netPnl/100).toLocaleString('en-IN')} (${winLoss})`,
      { symbol: t.symbol });
  }
  return { rows: closed, checked: open.length };
}

// ────────────────────────────────────────────────────────────────────────
// Cron dispatcher
// ────────────────────────────────────────────────────────────────────────
const CRON_DISPATCH = {
  '*/2 * * * *':        { name: 'backfill_drain',    fn: runBackfillOrchestrator }, // every 2 min — 5 chunks parallel
  '*/15 * * * *':       { name: 'watchdog',          fn: runWatchdog },             // every 15 min
  '30 2 * * 1-5':       { name: 'pre_market',        fn: preMarketBriefing },       // 08:00 IST
  '0 3 * * 1-5':        { name: 'briefing_compile',  fn: compileDailyBriefing },    // 08:30 IST
  '*/5 3-10 * * 1-5':   { name: 'cascade_alerts',    fn: cascadeAlertDelta },       // every 5 min market (offset 0)
  '*/2 3-10 * * 1-5':   { name: 'stop_loss',         fn: stopLossWatcher },         // every 2 min market
  '3-58/5 3-10 * * 1-5':{ name: 'paper_tick',        fn: paperTradeWatcher },       // every 5 min, offset 3 — paper trade auto-close
  '1-56/5 3-10 * * 1-5':{ name: 'reconcile_kite',    fn: reconcileKite },           // every 5 min, offset 1 — sync Kite holdings/funds/orders/trades
  '15 3 * * 1-5':       { name: 'sync_instruments',  fn: syncKiteInstruments },     // 08:45 IST — sync NSE instruments CSV (~80k rows)
  '30 3 * * 1-5':       { name: 'sync_instruments_nfo', fn: syncKiteInstrumentsNFO }, // 09:00 IST — sync NFO (filtered NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY only)
  '55 0 * * 1-5':       { name: 'kite_reminder_pre', fn: kiteTokenReminder },       // 05:55 IST (PRE-expiry)
  '0 1 * * 1-5':        { name: 'kite_reminder_post',fn: kiteTokenReminder },       // 06:30 IST (POST-expiry final nudge)
  '30 10 * * 1-5':      { name: 'portfolio_eod',     fn: eodPortfolioSnapshot },    // 16:00 IST
  '30 20 * * 6':        { name: 'db_vacuum',         fn: databaseVacuum },          // Sat 02:00 IST
  '30 12 * * 7':        { name: 'weekly_digest',     fn: weeklyPerformanceDigest }, // Sun 18:00 IST
};

async function runCron(env, cronExpr) {
  const entry = CRON_DISPATCH[cronExpr];
  if (!entry) return;
  const id = await logCronStart(env.DB, WORKER_NAME, entry.name, 'cron');
  try {
    const r = await entry.fn(env);
    await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
    await markSourceHealth(env.DB, entry.name, true);
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e).slice(0, 500));
    await markSourceHealth(env.DB, entry.name, false, e);
  }
}

// HTTP — manual triggers + queue management
const HTTP_HANDLERS = {
  backfill_drain:     runBackfillOrchestrator,
  watchdog:           runWatchdog,
  pre_market:         preMarketBriefing,
  briefing_compile:   compileDailyBriefing,
  cascade_alerts:     cascadeAlertDelta,
  stop_loss:          stopLossWatcher,
  paper_tick:         paperTradeWatcher,
  kite_reminder:      kiteTokenReminder,
  portfolio_eod:      eodPortfolioSnapshot,
  db_vacuum:          databaseVacuum,
  weekly_digest:      weeklyPerformanceDigest,
  seed_backfill:      seedBackfillQueue,
  sync_instruments:   syncKiteInstruments,
  sync_instruments_nfo: syncKiteInstrumentsNFO,
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });
    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, WORKER_NAME, m[1], 'http');
      try {
        const r = await HTTP_HANDLERS[m[1]](env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    if (url.pathname === '/queue') {
      const r = await env.DB.prepare(`SELECT * FROM backfill_queue ORDER BY priority, created_at LIMIT 100`).all();
      return Response.json({ queue: r.results });
    }
    return new Response('wealth-orchestrator: try /run/<job>, /queue', { status: 200 });
  },
};
