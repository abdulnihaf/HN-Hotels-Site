// /api/quant-control
//
// Owner control spine for Quant's intraday timer:
// - GET  ?action=status  -> one remote-control view: gate, scout, broker trail, timer trail, capability matrix
// - POST ?action=tick    -> one high-cadence decision tick; paper by default, real only through existing /api/kite gates
//
// This file deliberately reuses /api/kite for broker mutations. It does not
// duplicate broker credentials, static-IP proxy routing, notional/funds gates,
// NFO buyer-only gates, or square-off logic.

import { buildExecutionGate } from './_lib/wealthExecutionGate.js';

const DEFAULTS = {
  entryDeadline: '1015',
  exitTime: '1245',
  entryLowBps: -80,
  entryHighBps: 35,
  intervalSec: 180,
  profitTakePct: 5.0,
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const apiKey = request.headers.get('x-api-key') || url.searchParams.get('key');
  if (apiKey !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }
  const db = env.WEALTH_DB;
  if (!db) return Response.json({ ok: false, error: 'WEALTH_DB binding missing' }, { status: 500, headers });

  const action = url.searchParams.get('action') || 'status';
  try {
    if (action === 'tick') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      return Response.json(await runTimerTick(db, env, request, url, body, apiKey), { headers });
    }
    if (action === 'override_set') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      return Response.json(await setOverride(db, body), { headers });
    }
    if (action === 'override_clear') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      return Response.json(await clearOverride(db, body), { headers });
    }
    if (action === 'status') return Response.json(await getControlStatus(db, env, url), { headers });
    return Response.json({ ok: false, error: 'unknown action' }, { status: 400, headers });
  } catch (e) {
    return Response.json({ ok: false, error: e.message, stack: e.stack }, { status: 500, headers });
  }
}

async function getControlStatus(db, env, url) {
  const now = Date.now();
  const tradeDate = url.searchParams.get('date') || istDate(now);
  const [config, gate, scout, verdict, witness, override, timer, broker, lab] = await Promise.all([
    getConfigMap(db),
    buildExecutionGate(db, env).catch(e => ({ ok: false, error: String(e.message || e) })),
    getScoutPlan(db, tradeDate),
    getDailyVerdict(db, tradeDate),
    getSelectionWitness(db, tradeDate),
    getActiveOverride(db, tradeDate),
    getTimerTrail(db, tradeDate),
    getBrokerTrail(db, tradeDate),
    getLabTrail(db),
  ]);
  const capabilities = buildCapabilities(config, gate, timer, broker);
  return {
    ok: true,
    trade_date: tradeDate,
    generated_at: now,
    phase: phaseForNow(now),
    config,
    gate,
    scout,
    verdict,
    witness,
    override,
    timer,
    broker,
    lab,
    capabilities,
    next_tick: {
      interval_sec: numberCfg(config, 'quant_timer_interval_sec', DEFAULTS.intervalSec),
      entry_deadline_ist: stringCfg(config, 'quant_timer_entry_deadline_hhmm', DEFAULTS.entryDeadline),
      hard_exit_ist: stringCfg(config, 'quant_timer_exit_hhmm', DEFAULTS.exitTime),
      default_mode: stringCfg(config, 'quant_timer_default_mode', 'paper'),
      auto_enabled: stringCfg(config, 'quant_timer_auto_enabled', '0') === '1',
      real_enabled: stringCfg(config, 'quant_timer_real_enabled', '0') === '1',
    },
  };
}

async function runTimerTick(db, env, request, url, body, apiKey) {
  const now = Date.now();
  const tradeDate = body.trade_date || url.searchParams.get('date') || istDate(now);
  const config = await getConfigMap(db);
  const gate = await buildExecutionGate(db, env);
  const scout = await getScoutPlan(db, tradeDate);
  const override = await getActiveOverride(db, tradeDate);
  const manual = normalizeManualPlan(body);
  const plan = manual || planFromOverride(override) || planFromScout(scout) || planFromGate(gate);
  const mode = String(body.mode || url.searchParams.get('mode') || stringCfg(config, 'quant_timer_default_mode', 'paper')).toLowerCase();
  const allowReal = body.allow_real === true || body.allow_real === '1' || url.searchParams.get('allow_real') === '1';
  const strategy = body.strategy || 'forward_timer_v1';

  const runId = await ensureTimerRun(db, {
    tradeDate, mode, strategy, source: manual ? 'manual' : scout?.has_scout ? 'scout_today' : 'execution_gate',
    verdictId: scout?.verdict_id || gate?.verdict_id || null,
    primarySymbol: plan?.symbol || null,
    candidates: scout?.candidates || (gate?.machine_execution_plan || []).map(p => p.symbol).filter(Boolean),
    proofState: scout?.edge_state || gate?.decision || null,
    gate,
  });

  if (!plan?.symbol) {
    return await finishTick(db, runId, {
      tradeDate, symbol: null, stateBefore: 'NO_PLAN', stateAfter: 'BLOCKED',
      decision: 'BLOCKED', reason: 'no_strategy_plan', gate, raw: { scout, gate },
    });
  }

  const symbol = plan.symbol.toUpperCase();
  const ltp = await fetchLtp(request, apiKey, plan.exchange || 'NSE', symbol);
  if (!ltp?.ltp_paise) {
    return await finishTick(db, runId, {
      tradeDate, symbol, stateBefore: 'WATCHING', stateAfter: 'BLOCKED',
      decision: 'BLOCKED', reason: 'ltp_unavailable', gate, raw: { ltp, plan },
    });
  }

  const prev = await latestTimerState(db, tradeDate, symbol);
  const stateBefore = prev?.state_after || 'WATCHING';
  const entryPaise = plan.entry_paise || prev?.entry_paise || ltp.ltp_paise;
  const stopPaise = plan.stop_paise || prev?.stop_paise || Math.round(entryPaise * 0.975);
  const baseTarget = plan.target_paise || prev?.target_paise || Math.round(entryPaise * 1.02);
  const profitTakePct = numberCfg(config, 'quant_timer_profit_take_pct', DEFAULTS.profitTakePct);
  const targetPaise = Math.max(baseTarget, Math.round(entryPaise * (1 + profitTakePct / 100)));
  const qty = Number(plan.qty || prev?.qty || 1);
  const hhmm = istHhmm(now);
  const entryDeadline = stringCfg(config, 'quant_timer_entry_deadline_hhmm', DEFAULTS.entryDeadline);
  const exitTime = stringCfg(config, 'quant_timer_exit_hhmm', DEFAULTS.exitTime);
  const lowBps = numberCfg(config, 'quant_timer_entry_band_low_bps', DEFAULTS.entryLowBps);
  const highBps = numberCfg(config, 'quant_timer_entry_band_high_bps', DEFAULTS.entryHighBps);
  const entryLow = Math.round(entryPaise * (1 + lowBps / 10000));
  const entryHigh = Math.round(entryPaise * (1 + highBps / 10000));

  let decision = 'WATCH';
  let stateAfter = stateBefore;
  let reason = 'watching_entry_band';
  let action = null;
  let pnlPct = null;

  if (stateBefore === 'ENTERED' || stateBefore === 'HOLD') {
    pnlPct = +(((ltp.ltp_paise - entryPaise) / entryPaise) * 100).toFixed(2);
    if (ltp.ltp_paise <= stopPaise) {
      decision = 'EXIT_STOP'; stateAfter = 'EXITED'; reason = 'stop_hit';
      action = await maybeExitReal(request, apiKey, mode, allowReal, config, symbol, qty, 'HNQT_EXIT_STOP');
      if (mode === 'real' && (!action || action.ok !== true)) {
        decision = 'BLOCKED'; stateAfter = stateBefore; reason = action?.error || action?.reason || 'broker_exit_failed';
      }
    } else if (ltp.ltp_paise >= targetPaise) {
      decision = 'EXIT_PROFIT'; stateAfter = 'EXITED'; reason = 'profit_target_hit';
      action = await maybeExitReal(request, apiKey, mode, allowReal, config, symbol, qty, 'HNQT_EXIT_PROF');
      if (mode === 'real' && (!action || action.ok !== true)) {
        decision = 'BLOCKED'; stateAfter = stateBefore; reason = action?.error || action?.reason || 'broker_exit_failed';
      }
    } else if (hhmm >= exitTime) {
      decision = 'EXIT_TIME'; stateAfter = 'EXITED'; reason = 'hard_time_exit';
      action = await maybeExitReal(request, apiKey, mode, allowReal, config, symbol, qty, 'HNQT_EXIT_TIME');
      if (mode === 'real' && (!action || action.ok !== true)) {
        decision = 'BLOCKED'; stateAfter = stateBefore; reason = action?.error || action?.reason || 'broker_exit_failed';
      }
    } else {
      decision = 'HOLD'; stateAfter = 'HOLD'; reason = 'inside_exit_rules';
    }
  } else if (hhmm > entryDeadline) {
    decision = 'PASS'; stateAfter = 'PASSED'; reason = 'entry_deadline_missed';
  } else if (ltp.ltp_paise < stopPaise) {
    decision = 'PASS'; stateAfter = 'INVALIDATED'; reason = 'below_stop_before_entry';
  } else if (ltp.ltp_paise >= entryLow && ltp.ltp_paise <= entryHigh) {
    if (mode === 'real') {
      const realReady = canRealEnter(config, gate, allowReal, symbol);
      if (!realReady.ok) {
        decision = 'BLOCKED'; stateAfter = 'WATCHING'; reason = realReady.reason;
        action = { ok: false, blocked: true, reason: realReady.reason };
      } else {
        decision = 'ENTER_REAL'; stateAfter = 'ENTERED'; reason = 'entry_band_touched';
        action = await callKite(request, apiKey, 'place_order', {
          exchange: plan.exchange || 'NSE',
          tradingsymbol: symbol,
          transaction_type: 'BUY',
          quantity: qty,
          product: plan.product || 'MIS',
          order_type: 'MARKET',
          validity: 'DAY',
          tag: tagFor('HNQT_ENTRY', symbol),
          surface: 'quant_timer',
        });
        if (!action || action.ok !== true) {
          decision = 'BLOCKED'; stateAfter = 'WATCHING';
          reason = action?.error || action?.reason || 'broker_entry_failed';
        }
      }
    } else {
      decision = 'ENTER_PAPER'; stateAfter = 'ENTERED'; reason = 'entry_band_touched_paper';
      action = { ok: true, paper: true, message: `Paper entry ${symbol} x ${qty}` };
    }
  } else if (ltp.ltp_paise > entryHigh) {
    decision = 'WATCH'; stateAfter = 'WATCHING'; reason = 'do_not_chase_wait_pullback';
  } else {
    decision = 'WATCH'; stateAfter = 'WATCHING'; reason = 'below_entry_band_waiting';
  }

  return await finishTick(db, runId, {
    tradeDate, symbol, stateBefore, stateAfter, decision, ltpPaise: ltp.ltp_paise,
    entryPaise, stopPaise, targetPaise, qty, pnlPct, reason, action, gate,
    raw: { plan, override, ltp, mode, allow_real: allowReal, entry_band: { low_paise: entryLow, high_paise: entryHigh }, hhmm },
  });
}

async function maybeExitReal(request, apiKey, mode, allowReal, config, symbol, qty, tagPrefix) {
  if (mode !== 'real') return { ok: true, paper: true, message: `Paper exit ${symbol}` };
  if (!allowReal || stringCfg(config, 'quant_timer_real_enabled', '0') !== '1') {
    return { ok: false, blocked: true, reason: 'real_exit_not_armed' };
  }
  return await callKite(request, apiKey, 'square_off', {
    tradingsymbol: symbol, exchange: 'NSE', product: 'MIS', quantity: qty,
    tag: tagFor(tagPrefix, symbol), surface: 'quant_timer',
  });
}

function canRealEnter(config, gate, allowReal, symbol) {
  if (!allowReal) return { ok: false, reason: 'allow_real_missing' };
  if (stringCfg(config, 'quant_timer_real_enabled', '0') !== '1') return { ok: false, reason: 'quant_timer_real_enabled=0' };
  if (stringCfg(config, 'auto_real_trades_enabled', '0') !== '1') return { ok: false, reason: 'auto_real_trades_enabled=0' };
  if (gate.trade_authorized !== true) return { ok: false, reason: `execution_gate_blocked:${(gate.blocked_reasons || []).join('|')}` };
  const allowed = new Set();
  if (gate.recommended_symbol) allowed.add(String(gate.recommended_symbol).toUpperCase());
  for (const p of (Array.isArray(gate.machine_execution_plan) ? gate.machine_execution_plan : [])) {
    if (p?.symbol) allowed.add(String(p.symbol).toUpperCase());
  }
  if (allowed.size && !allowed.has(String(symbol || '').toUpperCase())) {
    return { ok: false, reason: `symbol_not_authorized_by_gate:${symbol}` };
  }
  return { ok: true };
}

async function finishTick(db, runId, event) {
  const action = event.action || null;
  const brokerOrderId = action?.order_id || action?.order?.order_id || action?.order?.order?.order_id || action?.kite_response?.data?.order_id || null;
  const failureCode = action?.error || action?.reason || null;
  const terminal = ['EXIT_STOP','EXIT_PROFIT','EXIT_TIME','PASS'].includes(event.decision) ? 1 : 0;
  const row = {
    run_id: runId,
    trade_date: event.tradeDate,
    ts: new Date().toISOString(),
    symbol: event.symbol || null,
    state_before: event.stateBefore || null,
    state_after: event.stateAfter || null,
    decision: event.decision,
    ltp_paise: event.ltpPaise || null,
    entry_paise: event.entryPaise || null,
    stop_paise: event.stopPaise || null,
    target_paise: event.targetPaise || null,
    qty: event.qty || null,
    pnl_pct: event.pnlPct == null ? null : event.pnlPct,
    trigger_json: JSON.stringify({ reason: event.reason || null }),
    action_json: JSON.stringify(event.action || null),
    gate_json: JSON.stringify(event.gate || null),
    raw_json: JSON.stringify(event.raw || null),
    broker_order_id: brokerOrderId,
    broker_status: action?.ok === true ? 'accepted' : action ? 'failed_or_blocked' : null,
    failure_code: failureCode,
    idempotency_key: event.raw?.plan?.symbol ? tagFor(`HNQT_${event.decision}`, event.raw.plan.symbol) : null,
    actor: 'quant_control',
    terminal,
  };
  let persisted = false;
  try {
    await db.prepare(
      `INSERT INTO quant_timer_events
       (run_id, trade_date, ts, symbol, state_before, state_after, decision,
        ltp_paise, entry_paise, stop_paise, target_paise, qty, pnl_pct,
        trigger_json, action_json, gate_json, raw_json,
        broker_order_id, broker_status, failure_code, idempotency_key, actor, terminal)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      row.run_id, row.trade_date, row.ts, row.symbol, row.state_before, row.state_after, row.decision,
      row.ltp_paise, row.entry_paise, row.stop_paise, row.target_paise, row.qty, row.pnl_pct,
      row.trigger_json, row.action_json, row.gate_json, row.raw_json,
      row.broker_order_id, row.broker_status, row.failure_code, row.idempotency_key, row.actor, row.terminal,
    ).run();
    persisted = true;
  } catch (e) {
    row.persist_error = String(e.message || e);
  }
  return { ok: true, persisted, event: row, decision: event.decision, state_after: event.stateAfter, action: event.action || null };
}

async function ensureTimerRun(db, r) {
  try {
    const existing = await db.prepare(
      `SELECT id FROM quant_timer_runs
       WHERE trade_date=? AND mode=? AND strategy=? AND status='running'
       ORDER BY id DESC LIMIT 1`
    ).bind(r.tradeDate, r.mode, r.strategy).first();
    if (existing?.id) return existing.id;
    const ins = await db.prepare(
      `INSERT INTO quant_timer_runs
       (trade_date, mode, strategy, source, source_verdict_id, primary_symbol,
        candidates_json, proof_state, status, gate_json, started_at, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      r.tradeDate, r.mode, r.strategy, r.source, r.verdictId, r.primarySymbol,
      JSON.stringify(r.candidates || []), r.proofState, 'running', JSON.stringify(r.gate || null),
      new Date().toISOString(), 'created_by_quant_control_tick',
    ).run();
    return ins.meta?.last_row_id || null;
  } catch {
    return null;
  }
}

async function getConfigMap(db) {
  const rows = (await db.prepare(`SELECT config_key, config_value FROM user_config`).all().catch(() => ({ results: [] }))).results || [];
  return Object.fromEntries(rows.map(r => [r.config_key, r.config_value]));
}

async function getScoutPlan(db, tradeDate) {
  const p = await db.prepare(
    `SELECT * FROM scout_plans WHERE trade_date=? ORDER BY id DESC LIMIT 1`
  ).bind(tradeDate).first().catch(() => null);
  if (!p) return { has_scout: false };
  const outcome = await db.prepare(
    `SELECT * FROM scout_outcomes WHERE plan_id=? ORDER BY id DESC LIMIT 1`
  ).bind(p.id).first().catch(() => null);
  const candidates = parseJson(p.candidate_symbols_json, []);
  return {
    has_scout: true, id: p.id, trade_date: p.trade_date, mode: p.mode, decision: p.decision,
    verdict_id: p.verdict_id, edge_state: p.edge_state, state: p.state,
    primary_symbol: p.primary_symbol, candidates,
    entry_paise: p.entry_paise, stop_paise: p.stop_paise, target_paise: p.target_paise,
    qty: p.qty, rr_ratio: p.rr_ratio, rank_reason: p.rank_reason,
    invalidation_text: p.invalidation_text, outcome,
  };
}

async function getDailyVerdict(db, tradeDate) {
  return await db.prepare(
    `SELECT id, trade_date, decision, recommended_symbol, headline, narrative,
            picks_json, alternatives_json, context_snapshot_json, composed_at, composed_by_model
     FROM daily_verdicts
     WHERE trade_date=? AND verdict_type='morning'
     ORDER BY composed_at DESC LIMIT 1`
  ).bind(tradeDate).first().catch(() => null);
}

async function getSelectionWitness(db, tradeDate) {
  const w = await db.prepare(`SELECT * FROM daily_selection_witness WHERE trade_date=? LIMIT 1`).bind(tradeDate).first().catch(() => null);
  if (!w) return null;
  return {
    ...w,
    ranked_candidates: parseJson(w.ranked_candidates_json, []),
    rejected: parseJson(w.rejected_json, []),
    no_loser_gate: parseJson(w.no_loser_gate_json, null),
    why_not_top_missed: parseJson(w.why_not_top_missed_json, []),
  };
}

async function getActiveOverride(db, tradeDate) {
  const row = await db.prepare(
    `SELECT * FROM quant_control_overrides
     WHERE trade_date=? AND status='active'
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY id DESC LIMIT 1`
  ).bind(tradeDate, new Date().toISOString()).first().catch(() => null);
  if (!row) return { active: false };
  return {
    active: true,
    ...row,
    original_plan: parseJson(row.original_plan_json, null),
    override_plan: parseJson(row.override_plan_json, null),
  };
}

async function setOverride(db, body) {
  const tradeDate = body.trade_date || istDate(Date.now());
  const plan = normalizeManualPlan(body);
  if (!plan?.symbol || !plan.entry_paise || !plan.stop_paise || !plan.target_paise || !plan.qty) {
    return { ok: false, error: 'symbol, entry, stop, target, qty required' };
  }
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) return { ok: false, error: 'override reason required' };
  const nowIso = new Date().toISOString();
  const expiresAt = body.expires_at || `${tradeDate}T15:30:00+05:30`;
  await db.prepare(
    `UPDATE quant_control_overrides
     SET status='superseded', cleared_at=?, clear_reason='new_override'
     WHERE trade_date=? AND status='active'`
  ).bind(nowIso, tradeDate).run().catch(() => {});
  const ins = await db.prepare(
    `INSERT INTO quant_control_overrides
     (trade_date, status, actor, reason, symbol, exchange, product,
      entry_paise, stop_paise, target_paise, qty, original_plan_json,
      override_plan_json, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    tradeDate, 'active', String(body.actor || 'owner_control'), reason,
    plan.symbol, plan.exchange || 'NSE', plan.product || 'MIS',
    plan.entry_paise, plan.stop_paise, plan.target_paise, plan.qty,
    JSON.stringify(body.original_plan || null), JSON.stringify(plan),
    expiresAt, nowIso,
  ).run();
  return { ok: true, id: ins.meta?.last_row_id, trade_date: tradeDate, override: plan };
}

async function clearOverride(db, body) {
  const tradeDate = body.trade_date || istDate(Date.now());
  const nowIso = new Date().toISOString();
  const r = await db.prepare(
    `UPDATE quant_control_overrides
     SET status='cleared', cleared_at=?, clear_reason=?
     WHERE trade_date=? AND status='active'`
  ).bind(nowIso, String(body.reason || 'manual_clear'), tradeDate).run().catch(() => null);
  return { ok: true, trade_date: tradeDate, changes: r?.meta?.changes || 0 };
}

async function getTimerTrail(db, tradeDate) {
  const runs = (await db.prepare(
    `SELECT * FROM quant_timer_runs WHERE trade_date=? ORDER BY id DESC LIMIT 10`
  ).bind(tradeDate).all().catch(e => ({ results: [], error: String(e.message || e) })));
  const events = (await db.prepare(
    `SELECT * FROM quant_timer_events WHERE trade_date=? ORDER BY id DESC LIMIT 80`
  ).bind(tradeDate).all().catch(e => ({ results: [], error: String(e.message || e) })));
  return {
    available: !runs.error && !events.error,
    runs: runs.results || [],
    events: (events.results || []).map(decodeEvent),
    error: runs.error || events.error || null,
  };
}

async function getBrokerTrail(db, tradeDate) {
  const dayStart = new Date(`${tradeDate}T00:00:00+05:30`).getTime();
  const dayEnd = dayStart + 86400000;
  const orders = (await db.prepare(
    `SELECT order_id, exchange, tradingsymbol, transaction_type, quantity, filled_quantity,
            order_type, product, price_paise, average_price_paise, status, status_message, tag, placed_at
       FROM kite_orders_log WHERE placed_at>=? AND placed_at<? ORDER BY placed_at DESC`
  ).bind(dayStart, dayEnd).all().catch(() => ({ results: [] }))).results || [];
  const trades = (await db.prepare(
    `SELECT trade_id, order_id, exchange, tradingsymbol, transaction_type, quantity,
            average_price_paise, product, filled_at, exchange_timestamp
       FROM kite_trades WHERE filled_at>=? AND filled_at<? ORDER BY filled_at DESC`
  ).bind(dayStart, dayEnd).all().catch(() => ({ results: [] }))).results || [];
  const snap = await db.prepare(`SELECT MAX(snapshot_at) m FROM kite_positions_live`).first().catch(() => null);
  const positions = snap?.m ? (await db.prepare(
    `SELECT * FROM kite_positions_live WHERE snapshot_at=? ORDER BY tradingsymbol`
  ).bind(snap.m).all().catch(() => ({ results: [] }))).results || [] : [];
  return {
    orders, trades, positions, snapshot_at: snap?.m || null,
    flat_symbols: positions.filter(p => p.quantity === 0 && (p.day_buy_quantity || p.day_sell_quantity)).map(p => p.tradingsymbol),
  };
}

async function getLabTrail(db) {
  const runs = (await db.prepare(
    `SELECT id, scenario, kind, surface, mode, symbol, qty, tag, status, raw_error, action_required, created_at
       FROM lab_runs ORDER BY id DESC LIMIT 20`
  ).all().catch(() => ({ results: [] }))).results || [];
  return { runs };
}

async function latestTimerState(db, tradeDate, symbol) {
  return await db.prepare(
    `SELECT * FROM quant_timer_events WHERE trade_date=? AND symbol=? ORDER BY id DESC LIMIT 1`
  ).bind(tradeDate, symbol).first().catch(() => null);
}

async function fetchLtp(request, apiKey, exchange, symbol) {
  const u = new URL(request.url);
  u.pathname = '/api/kite';
  u.search = `?action=ltp&i=${encodeURIComponent(`${exchange}:${symbol}`)}&key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(u.toString(), { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(6000) }).catch(e => ({ ok: false, error: e }));
  if (!r.ok) return { ok: false, error: r.error ? String(r.error) : `HTTP ${r.status}` };
  const j = await r.json().catch(() => ({}));
  const rec = j?.data?.[`${exchange}:${symbol}`];
  if (!rec || rec.last_price == null) return { ok: false, error: 'missing_ltp', raw: j };
  return { ok: true, ltp_rupees: Number(rec.last_price), ltp_paise: Math.round(Number(rec.last_price) * 100), raw: rec };
}

async function callKite(request, apiKey, action, body) {
  const u = new URL(request.url);
  u.pathname = '/api/kite';
  u.search = `?action=${encodeURIComponent(action)}&key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(u.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch(e => ({ ok: false, error: e }));
  if (!r.ok) return { ok: false, error: r.error ? String(r.error) : `HTTP ${r.status}` };
  return await r.json().catch(() => ({ ok: false, error: 'bad_json' }));
}

function buildCapabilities(config, gate, timer, broker) {
  const realArmed = stringCfg(config, 'quant_timer_real_enabled', '0') === '1' && stringCfg(config, 'auto_real_trades_enabled', '0') === '1';
  return [
    cap('paper_forward_timer', timer.available, timer.available ? 'ready' : 'migration_pending',
      'Runs entry-band, stop, +5pct profit, and time-exit decisions without broker cash.'),
    cap('real_equity_forward_timer', realArmed && gate.trade_authorized === true, realArmed ? (gate.trade_authorized ? 'ready' : 'execution_gate_blocked') : 'real_auto_switch_off',
      'Can auto-enter/exit NSE MIS equity only after real switches and broker-facing TRADE gate are both green.'),
    cap('manual_equity_bracket', gate.trade_authorized === true, gate.trade_authorized ? 'ready' : 'execution_gate_blocked',
      'Uses /api/kite place_bracket with buy, protective stop/GTT, and persisted bracket trail.'),
    cap('tiny_real_pipeline_test', true, 'ready',
      'One-share IDEA round-trip proves broker route, static-IP proxy, fills, reconciliation, and flat position.'),
    cap('manual_square_off', true, broker.positions?.some(p => p.quantity !== 0) ? 'open_positions_available' : 'flat_now',
      'Square-off exits skip cash checks so a flatten cannot be trapped by free-cash validation.'),
    cap('panic_square_off_all', true, 'manual_only',
      'Flattens all non-zero Kite positions through the existing broker exit door.'),
    cap('nfo_index_option_buy', true, 'manual_sim_ready_real_gated',
      'Existing order door supports NFO buyer-only index options with lot-size, whitelist, and margin-cap checks. No autonomous option strategy is proven yet.'),
    cap('nfo_option_writing', false, 'blocked_by_design',
      'Opening SELL/write is intentionally blocked; stock options carry physical-delivery risk.'),
  ];
}

function cap(id, enabled, state, detail) {
  return { id, enabled, state, detail };
}

function normalizeManualPlan(body) {
  if (!body || !body.symbol) return null;
  const n = x => x == null || x === '' ? null : Math.round(Number(x) * 100);
  return {
    symbol: String(body.symbol).toUpperCase(),
    exchange: String(body.exchange || 'NSE').toUpperCase(),
    product: String(body.product || 'MIS').toUpperCase(),
    entry_paise: n(body.entry),
    stop_paise: n(body.stop),
    target_paise: n(body.target),
    qty: Math.max(1, parseInt(body.qty, 10) || 1),
  };
}

function planFromScout(s) {
  if (!s?.has_scout || !s.primary_symbol) return null;
  return {
    symbol: s.primary_symbol,
    exchange: 'NSE',
    product: 'MIS',
    entry_paise: s.entry_paise,
    stop_paise: s.stop_paise,
    target_paise: s.target_paise,
    qty: s.qty || 1,
  };
}

function planFromOverride(o) {
  if (!o?.active) return null;
  return {
    symbol: o.symbol,
    exchange: o.exchange || 'NSE',
    product: o.product || 'MIS',
    entry_paise: o.entry_paise,
    stop_paise: o.stop_paise,
    target_paise: o.target_paise,
    qty: o.qty || 1,
  };
}

function planFromGate(g) {
  const p = Array.isArray(g?.machine_execution_plan) ? g.machine_execution_plan[0] : null;
  if (!p?.symbol) return null;
  return {
    symbol: p.symbol,
    exchange: 'NSE',
    product: 'MIS',
    entry_paise: p.entry_estimate_paise,
    stop_paise: p.stop_paise,
    target_paise: p.target_paise,
    qty: p.qty || 1,
  };
}

function decodeEvent(e) {
  return {
    ...e,
    trigger: parseJson(e.trigger_json, null),
    action: parseJson(e.action_json, null),
    gate: parseJson(e.gate_json, null),
    raw: parseJson(e.raw_json, null),
  };
}

function parseJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function stringCfg(cfg, key, fallback) {
  const v = cfg?.[key];
  return v == null || v === '' ? fallback : String(v);
}

function numberCfg(cfg, key, fallback) {
  const n = Number(cfg?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function istDate(ms) {
  return new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
}

function istHhmm(ms) {
  const d = new Date(ms + 5.5 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function phaseForNow(ms) {
  const hm = istHhmm(ms);
  if (hm < '0900') return 'PRE_MARKET';
  if (hm < '0915') return 'PRE_OPEN';
  if (hm <= '1530') return 'LIVE';
  if (hm <= '1630') return 'CLOSE';
  return 'OFF_HOURS';
}

function tagFor(prefix, symbol) {
  return `${prefix}_${symbol}`.replace(/[^A-Z0-9_]/gi, '').slice(0, 20);
}
