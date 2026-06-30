export const BROKER_AUTHORITY = 'broker_facing_picks_authorized';
export const STABLE_KITE_PROXY_BASE = 'https://hukum.hnhotels.in/kite-proxy';

export function parseJsonMaybe(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function istToday(nowMs = Date.now()) {
  return new Date(nowMs + 5.5 * 3600000).toISOString().slice(0, 10);
}

export function isNseRegularMarketOpen(nowMs = Date.now()) {
  const ist = new Date(nowMs + 5.5 * 3600000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return hm >= 915 && hm <= 1530;
}

function classifyFreshness(lastTs, nowMs, liveThresholdMs) {
  if (!lastTs) return { freshness: 'missing', age_minutes: null, healthy_now: false };
  const ts = Number(lastTs);
  const ageMs = nowMs - ts;
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000));
  const today = istToday(nowMs);
  const tsDay = istToday(ts);
  if (ageMs <= liveThresholdMs) return { freshness: 'live', age_minutes: ageMinutes, healthy_now: true };
  if (tsDay !== today) return { freshness: 'prior-session', age_minutes: ageMinutes, healthy_now: false };
  return { freshness: 'delayed', age_minutes: ageMinutes, healthy_now: false };
}

function maxTs(...values) {
  return values.map(v => Number(v || 0)).filter(v => v > 0).sort((a, b) => b - a)[0] || null;
}

async function sourceHealthMap(db) {
  const rows = (await db.prepare(`
    SELECT source_name, last_success_ts, consecutive_failures, last_error, updated_at
    FROM source_health
  `).all().catch(() => ({ results: [] }))).results || [];
  return Object.fromEntries(rows.map(r => [r.source_name, r]));
}

async function latestMorningVerdict(db, date) {
  return await db.prepare(`
    SELECT id, trade_date, verdict_type, decision, headline, narrative,
           recommended_symbol, picks_json, alternatives_json, context_snapshot_json,
           recommended_plan_json, composed_at, composed_by_model, strategy_mode
    FROM daily_verdicts
    WHERE trade_date=? AND verdict_type='morning'
    ORDER BY composed_at DESC LIMIT 1
  `).bind(date).first().catch(() => null);
}

async function scoutState(db, date) {
  const plan = await db.prepare(`
    SELECT id, decision, mode, primary_symbol, candidate_symbols_json, edge_state, state
    FROM scout_plans
    WHERE trade_date=? AND mode='PAPER'
    ORDER BY composed_at DESC LIMIT 1
  `).bind(date).first().catch(() => null);
  if (!plan) return { has_scout: false };
  const outcome = await db.prepare(`
    SELECT action_taken, pnl_net_paise, win_loss, exit_reason
    FROM scout_outcomes
    WHERE plan_id=? LIMIT 1
  `).bind(plan.id).first().catch(() => null);
  return {
    has_scout: true,
    mode: plan.mode,
    decision: plan.decision,
    primary_symbol: plan.primary_symbol,
    candidates: parseJsonMaybe(plan.candidate_symbols_json, []),
    edge_state: plan.edge_state,
    state: plan.state,
    outcome: outcome ? {
      action_taken: outcome.action_taken,
      pnl_net_paise: outcome.pnl_net_paise,
      pnl_net_rs: outcome.pnl_net_paise == null ? null : Math.round(outcome.pnl_net_paise) / 100,
      win_loss: outcome.win_loss,
      exit_reason: outcome.exit_reason,
    } : null,
  };
}

async function proxyConfig(db) {
  const rows = (await db.prepare(`
    SELECT config_key, config_value
    FROM user_config
    WHERE config_key IN ('kite_order_base','kite_proxy_secret')
  `).all().catch(() => ({ results: [] }))).results || [];
  const cfg = Object.fromEntries(rows.map(r => [r.config_key, r.config_value]));
  return {
    base: (cfg.kite_order_base || '').replace(/\/+$/, ''),
    secret: cfg.kite_proxy_secret || '',
  };
}

async function proxyHealth(db, checkNetwork = true) {
  const cfg = await proxyConfig(db);
  const configured = cfg.base === STABLE_KITE_PROXY_BASE;
  if (!cfg.base || !checkNetwork) {
    return {
      stable_ip_proxy_configured: configured,
      stable_ip_proxy_active: false,
      kite_order_base: cfg.base || null,
      proxy_health_http_status: null,
    };
  }
  let status = null;
  let active = false;
  try {
    const res = await fetch(`${cfg.base}/orders/regular`, {
      headers: { 'X-Proxy-Secret': '__codex_health_wrong_secret__' },
      signal: AbortSignal.timeout(2500),
    });
    status = res.status;
    active = res.status === 403;
  } catch {
    active = false;
  }
  return {
    stable_ip_proxy_configured: configured,
    stable_ip_proxy_active: active,
    kite_order_base: cfg.base,
    proxy_health_http_status: status,
  };
}

async function kiteConnected(db) {
  const tok = await db.prepare(`
    SELECT user_name, expires_at, obtained_at
    FROM kite_tokens
    WHERE is_active=1
    ORDER BY obtained_at DESC LIMIT 1
  `).first().catch(() => null);
  const now = Date.now();
  return tok && tok.expires_at > now ? {
    connected: true,
    user_name: tok.user_name,
    expires_at: tok.expires_at,
    expires_in_min: Math.round((tok.expires_at - now) / 60000),
  } : {
    connected: false,
    reason: tok ? 'expired' : 'no_token',
    expires_at: tok?.expires_at || null,
  };
}

async function sourceGate(db, nowMs, inMarketHours) {
  const h = await sourceHealthMap(db);
  const latestTick = await db.prepare(`SELECT MAX(ts) AS ts FROM intraday_ticks`).first().catch(() => null);
  const latestBar = await db.prepare(`SELECT MAX(ts) AS ts FROM intraday_bars`).first().catch(() => null);
  const ltpEndpoint = await db.prepare(`
    SELECT MAX(last_success_ts) AS ts
    FROM kite_endpoint_health
    WHERE endpoint IN ('/quote/ltp','/quote')
  `).first().catch(() => null);
  const intradayHealth = h.intraday || h.intraday_bars || h.cascade_intraday || null;
  const ltpHealth = h.live_ltp || h.kite_quotes || h.reconcile_kite || h.intraday || null;

  const liveThreshold = inMarketHours ? 10 * 60 * 1000 : 45 * 60 * 1000;
  const barThreshold = inMarketHours ? 35 * 60 * 1000 : 90 * 60 * 1000;
  const ltpTs = maxTs(latestTick?.ts, ltpEndpoint?.ts, ltpHealth?.last_success_ts);
  const barTs = maxTs(latestBar?.ts, intradayHealth?.last_success_ts, latestTick?.ts);
  const ltpFresh = classifyFreshness(ltpTs, nowMs, liveThreshold);
  const barsFresh = classifyFreshness(barTs, nowMs, barThreshold);

  return [
    {
      logical_source: 'live_ltp',
      required_for: 'broker_order_entry',
      freshness: ltpFresh.freshness,
      healthy: ltpFresh.healthy_now,
      last_update_ms: ltpTs,
      age_minutes: ltpFresh.age_minutes,
      satisfied_by: [
        latestTick?.ts ? 'intraday_ticks.runtime' : null,
        ltpEndpoint?.ts ? 'kite_endpoint_health./quote_or_ltp' : null,
        ltpHealth ? `source_health.${ltpHealth.source_name}` : null,
      ].filter(Boolean),
      note: 'A real order needs fresh live price/LTP truth, either via source_health or runtime tick/quote proof.',
    },
    {
      logical_source: 'intraday_bars',
      required_for: 'opening_bar_and_gap_context',
      freshness: barsFresh.freshness,
      healthy: barsFresh.healthy_now,
      last_update_ms: barTs,
      age_minutes: barsFresh.age_minutes,
      satisfied_by: [
        latestBar?.ts ? 'intraday_bars.runtime' : null,
        intradayHealth ? `source_health.${intradayHealth.source_name}` : null,
        latestTick?.ts ? 'intraday_ticks.runtime_fallback' : null,
      ].filter(Boolean),
      note: 'Production source_health.intraday satisfies the intraday-bars guard when the row is fresh.',
    },
  ];
}

export async function buildExecutionGate(db, env = {}, options = {}) {
  const nowMs = Date.now();
  const date = istToday(nowMs);
  const inMarketHours = isNseRegularMarketOpen(nowMs);
  const verdict = await latestMorningVerdict(db, date);
  const picks = parseJsonMaybe(verdict?.picks_json, []) || [];
  const alternatives = parseJsonMaybe(verdict?.alternatives_json, {}) || {};
  const context = parseJsonMaybe(verdict?.context_snapshot_json, {}) || {};
  const authority = alternatives.execution_authority || context.execution_authority || null;
  const machinePlan = alternatives.machine_execution_plan || null;
  const scout = await scoutState(db, date);
  const requiredSources = await sourceGate(db, nowMs, inMarketHours);
  const proxy = await proxyHealth(db, options.checkProxy !== false);
  const kite = await kiteConnected(db);
  const decision = verdict?.decision || null;
  const picksCount = Array.isArray(picks) ? picks.length : 0;

  const reasons = [];
  if (decision !== 'TRADE') reasons.push(`decision=${decision || 'NONE'}`);
  if (picksCount < 1) reasons.push('picks_json empty');
  if (authority !== BROKER_AUTHORITY) reasons.push(`execution_authority=${authority || 'missing'}`);
  for (const s of requiredSources) if (!s.healthy) reasons.push(`${s.logical_source} ${s.freshness}`);
  if (!kite.connected) reasons.push(`kite=${kite.reason || 'not_connected'}`);
  if (!proxy.stable_ip_proxy_configured) reasons.push('stable_ip_proxy_not_configured');
  if (!proxy.stable_ip_proxy_active) reasons.push('stable_ip_proxy_not_active');
  if (!inMarketHours) reasons.push('market_closed');

  const tradeAuthorized = reasons.length === 0;
  const hasPaperScout = scout.has_scout && scout.mode === 'PAPER';
  const ownerTruth = decision === 'OBSERVE'
    ? (hasPaperScout ? 'Today: OBSERVE + PAPER scout, no broker order.' : 'Today: OBSERVE, no broker order.')
    : decision === 'TRADE'
      ? (tradeAuthorized ? 'Today: TRADE is broker-authorized.' : 'Today: TRADE is staged but broker order is blocked by the gate.')
      : hasPaperScout
        ? 'Today: PAPER scout only, no broker order.'
        : 'Today: no broker order.';

  return {
    ok: true,
    date,
    generated_at: nowMs,
    compose_schedule_ist: '09:40',
    owner_truth: ownerTruth,
    broker_order_surface: tradeAuthorized ? 'authorized' : 'blocked',
    machine_plan_surface: decision === 'OBSERVE' ? 'intelligence_only' : (machinePlan ? 'staged_plan' : 'none'),
    trade_authorized: tradeAuthorized,
    blocked_reasons: reasons,
    decision,
    recommended_symbol: verdict?.recommended_symbol || null,
    verdict_id: verdict?.id || null,
    composed_at: verdict?.composed_at || null,
    composed_by_model: verdict?.composed_by_model || null,
    picks_count: picksCount,
    picks_json_is_broker_surface: true,
    execution_authority: authority,
    required_authority: BROKER_AUTHORITY,
    machine_execution_plan: machinePlan,
    alternatives_are_order_surface: false,
    required_sources: requiredSources,
    kite_connected: kite.connected,
    kite,
    in_market_hours: inMarketHours,
    scout,
    ...proxy,
  };
}
