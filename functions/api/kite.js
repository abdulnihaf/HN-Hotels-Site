// ═══════════════════════════════════════════════════════════════════════════
// /api/kite — Proxy + status + ORDER EXECUTION for Kite Connect API.
//
// Reads access_token from D1.kite_tokens (latest is_active=1).
// Refuses if token is expired (forces re-OAuth).
//
// READ actions (GET):
//   status        — connection state
//   profile       — /user/profile
//   margins       — /user/margins (free funds for trade sizing)
//   holdings      — /portfolio/holdings
//   positions     — /portfolio/positions
//   quote         — /quote?i=NSE:RELIANCE,NSE:HDFCBANK
//   ltp           — /quote/ltp?i=...
//   ohlc          — /quote/ohlc?i=...
//   orders        — /orders (today's orders)
//   order_status  — /orders/<order_id>
//   gtt_list      — /gtt/triggers
//   gtt_get       — /gtt/triggers/<id>
//   instruments   — /instruments/<exchange>
//   historical    — /instruments/historical/<token>/<interval>?from=...&to=...
//
// WRITE actions (POST) — surgical execution layer:
//   place_order   — POST /orders/regular  → buy/sell market or limit
//   modify_order  — PUT  /orders/regular/<order_id>
//   cancel_order  — DELETE /orders/regular/<order_id>
//   place_gtt     — POST /gtt/triggers   → OCO stop+target
//   delete_gtt    — DELETE /gtt/triggers/<id>
//
// Each POST is gated by DASHBOARD_KEY auth + writes to kite_api_log for audit.
// Order placement is user-triggered (one-click), not auto-trading.
// ═══════════════════════════════════════════════════════════════════════════

const KITE_BASE = 'https://api.kite.trade';

// Fix #3 (order-path hardening): product must be EXPLICIT on every order.
// The old `body.product` default silently turned any caller that omitted
// product (e.g. a non-iOS client) into a CNC *delivery* order — wrong and unhedged
// for the intraday MIS strategy. assertProduct rejects a missing/invalid product
// instead of guessing. Valid Kite products: MIS (intraday), CNC (delivery),
// NRML (F&O / overnight margin), MTF (margin funding).
const VALID_PRODUCTS = ['MIS', 'CNC', 'NRML', 'MTF'];
function assertProduct(body) {
  if (!body || !body.product) {
    throw new Error('Missing required field: product — must be one of MIS, CNC, NRML, MTF (no silent CNC default)');
  }
  if (!VALID_PRODUCTS.includes(body.product)) {
    throw new Error(`Invalid product '${body.product}' — must be one of ${VALID_PRODUCTS.join(', ')}`);
  }
}

// ── Static-IP order egress ───────────────────────────────────────────────────
// Kite requires LIVE orders to arrive from ONE whitelisted IP (a SEBI rule).
// Cloudflare has no fixed egress IP, so order *mutations* (POST/PUT/DELETE on
// /orders & /gtt) are routed through a tiny proxy on the RTX box, which has a
// fixed IP registered in the Kite developer console. Reads stay direct on
// Cloudflare (Kite doesn't gate them) so they're unaffected if the box is down.
// Config lives in D1 user_config (kite_order_base, kite_proxy_secret) — set/clear
// without a redeploy. When kite_order_base is unset, this is a no-op (direct).
let ORDER_PROXY = null;   // { base, secret } | null  (set per request from D1)
function routeOrder(url, opts = {}) {
  if (!ORDER_PROXY || !ORDER_PROXY.base) return [url, opts];
  const method = (opts.method || 'GET').toUpperCase();
  const isOrderPath = url.startsWith(KITE_BASE + '/orders') || url.startsWith(KITE_BASE + '/gtt');
  if (method === 'GET' || !isOrderPath) return [url, opts];     // only mutating order/GTT calls
  const proxiedUrl = ORDER_PROXY.base + url.slice(KITE_BASE.length);
  const proxiedOpts = {
    ...opts,
    headers: { ...(opts.headers || {}), ...(ORDER_PROXY.secret ? { 'X-Proxy-Secret': ORDER_PROXY.secret } : {}) },
  };
  return [proxiedUrl, proxiedOpts];
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const apiKey = request.headers.get('x-api-key') || url.searchParams.get('key');
  if (apiKey !== (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }

  const db = env.WEALTH_DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'WEALTH_DB binding missing' }), { status: 500, headers });
  }

  // Load the static-IP order-egress config (no-op when unset → direct to Kite).
  try {
    const pr = await db.prepare(
      `SELECT config_key, config_value FROM user_config WHERE config_key IN ('kite_order_base','kite_proxy_secret')`
    ).all();
    const m = {};
    for (const r of (pr.results || [])) m[r.config_key] = r.config_value;
    ORDER_PROXY = m.kite_order_base ? { base: m.kite_order_base, secret: m.kite_proxy_secret || '' } : null;
  } catch { ORDER_PROXY = null; }

  const action = url.searchParams.get('action') || 'status';

  try {
    if (action === 'status') return Response.json(await getStatus(db, env), { headers });

    // All other actions need a valid access token
    const tok = await getActiveToken(db);
    if (!tok) return Response.json({ error: 'kite_not_connected', message: 'No active Kite token. Visit /wealth/auth/login to authenticate.' }, { status: 401, headers });
    if (Date.now() > tok.expires_at) return Response.json({ error: 'kite_expired', expired_at: tok.expires_at, message: 'Kite token expired. Re-authenticate at /wealth/auth/login.' }, { status: 401, headers });

    const kiteHeaders = {
      'X-Kite-Version': '3',
      'Authorization': `token ${env.KITE_API_KEY}:${tok.access_token}`,
    };

    // ─────────────────────────────────────────────────────
    // P1: BRACKET FLOW — atomic order + GTT with retries + fallback
    // ─────────────────────────────────────────────────────
    if (action === 'place_bracket') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      const body = await request.json().catch(() => ({}));
      const out = await placeBracket(env, db, kiteHeaders, body);
      await recordRun(db, {
        scenario: body.scenario || 'E5', kind: 'bracket', surface: body.surface,
        mode: body.bypass_block === true ? 'tiny_real' : 'sim',
        symbol: body.tradingsymbol, qty: body.quantity, tag: body.tag || 'HN_WE_BRK',
        status: out.naked_position ? 'failed_no_stop'
              : out.blocked ? 'blocked'
              : out.deduped ? 'deduped'
              : out.ok ? (out.fallback_used ? 'complete_with_fallback' : 'complete') : 'error',
        intent: body, steps: out.steps,
        rawError: out.error || out.warning || null,
        actionRequired: out.action_required || (out.naked_position ? 'naked_position' : null),
        bracketId: out.bracket_id,
      }).catch(() => {});
      return Response.json(out, { headers });
    }

    // ─────────────────────────────────────────────────────
    // ONE-TIME PIPELINE SMOKE TEST — place a tiny order then immediately exit it,
    // returning a step-by-step log. Proves the place→exit workflow before real money.
    // Self-removing: on a confirmed pass it sets user_config.pipeline_test_passed so the
    // app hides the card. ?simulate=1 runs the wiring WITHOUT any real order (safe to call).
    // ─────────────────────────────────────────────────────
    if (action === 'pipeline_test') {
      const body = request.method === 'POST' ? (await request.json().catch(() => ({}))) : {};
      if (url.searchParams.get('simulate') === '1') body.simulate = true;
      if (url.searchParams.get('symbol')) body.symbol = url.searchParams.get('symbol');
      if (url.searchParams.get('qty')) body.qty = url.searchParams.get('qty');
      const out = await pipelineTest(env, db, kiteHeaders, body);
      await recordRun(db, {
        scenario: body.scenario || 'E1', kind: 'equity_roundtrip', surface: body.surface,
        mode: (body.simulate === true || body.simulate === '1') ? 'sim' : 'tiny_real',
        symbol: out.symbol, qty: out.qty, tag: 'HN_WE_PIPETEST',
        status: out.overall === 'pass' || out.overall === 'pass_simulated' ? 'complete'
              : out.overall === 'blocked' ? 'blocked'
              : out.overall === 'partial' ? 'partial' : 'error',
        intent: body, steps: out.steps,
        rawError: out.failed_step ? (out.summary || out.failed_step) : null,
      }).catch(() => {});
      return Response.json(out, { headers });
    }

    // ─────────────────────────────────────────────────────
    // P2: MARGIN PRE-CHECK
    // ─────────────────────────────────────────────────────
    if (action === 'order_margins') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      return Response.json(await orderMargins(env, db, kiteHeaders, await request.json()), { headers });
    }

    // ─────────────────────────────────────────────────────
    // P3: INSTRUMENTS LOOKUP + SYNC
    // ─────────────────────────────────────────────────────
    if (action === 'instrument_lookup') {
      const symbol = url.searchParams.get('symbol');
      const exch = url.searchParams.get('exchange') || 'NSE';
      if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400, headers });
      return Response.json(await instrumentLookup(db, symbol, exch), { headers });
    }
    if (action === 'sync_instruments') {
      // ?exchange=NSE|NFO syncs just one; omitted → both NSE + NFO.
      return Response.json(await syncInstruments(env, db, kiteHeaders, url.searchParams.get('exchange')), { headers });
    }

    // ─────────────────────────────────────────────────────
    // P4: ENDPOINT HEALTH
    // ─────────────────────────────────────────────────────
    if (action === 'endpoint_health') {
      const r = await db.prepare(`SELECT * FROM kite_endpoint_health ORDER BY total_calls DESC LIMIT 50`).all();
      return Response.json({ endpoints: r.results || [] }, { headers });
    }

    // ─────────────────────────────────────────────────────
    // RECONCILE actions (sync Kite state into D1)
    // ─────────────────────────────────────────────────────
    if (action === 'reconcile_holdings') {
      return Response.json(await reconcileHoldings(env, db, kiteHeaders), { headers });
    }
    if (action === 'reconcile_funds') {
      return Response.json(await reconcileFunds(env, db, kiteHeaders), { headers });
    }
    if (action === 'reconcile_orders') {
      return Response.json(await reconcileOrders(env, db, kiteHeaders), { headers });
    }
    if (action === 'reconcile_trades') {
      return Response.json(await reconcileTrades(env, db, kiteHeaders), { headers });
    }
    if (action === 'reconcile_positions') {
      return Response.json(await reconcilePositions(env, db, kiteHeaders), { headers });
    }
    if (action === 'reconcile_all') {
      const [h, f, o, t, p] = await Promise.all([
        reconcileHoldings(env, db, kiteHeaders),
        reconcileFunds(env, db, kiteHeaders),
        reconcileOrders(env, db, kiteHeaders),
        reconcileTrades(env, db, kiteHeaders),
        reconcilePositions(env, db, kiteHeaders),
      ]);
      return Response.json({ holdings: h, funds: f, orders: o, trades: t, positions: p }, { headers });
    }
    // Square off a live position (owner one-tap exit) — opposite MARKET order, box-proxied.
    // Supports partial exit via body.quantity (sell part of the net, rest stays open).
    if (action === 'square_off') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      const body = await request.json().catch(() => ({}));
      const out = await squareOff(env, db, kiteHeaders, body);
      await recordRun(db, {
        scenario: body.scenario || '', kind: 'partial_exit', surface: body.surface,
        mode: body.bypass_block === true ? 'tiny_real' : 'sim',
        symbol: body.tradingsymbol, qty: out.squared?.qty,
        tag: out.order?.kite_response ? body.tag : body.tag, status: out.ok ? 'complete' : 'error',
        intent: body, steps: [{ name: 'square_off', ok: out.ok, detail: out.message || null, raw: out.order }],
        rawError: out.order?.error || null, actionRequired: out.order?.naked_position ? 'naked_position' : null,
      }).catch(() => {});
      return Response.json(out, { headers });
    }
    // Square off EVERYTHING (panic) — both MIS and CNC/NRML, per-leg retry, loud remaining list.
    if (action === 'square_off_all') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      const body = await request.json().catch(() => ({}));
      const out = await squareOffAll(env, db, kiteHeaders, body);
      await recordRun(db, {
        scenario: body.scenario || 'X2', kind: 'square_off_all', surface: body.surface,
        mode: body.bypass_block === true ? 'tiny_real' : 'sim',
        status: out.flat ? 'complete' : 'failed_no_stop',
        intent: body,
        steps: [
          ...out.squared.map((s, i) => ({ name: `squared_${s.tradingsymbol}`, ok: true, detail: `${s.qty} ${s.product}`, raw: s.order })),
          ...out.remaining.map((s) => ({ name: `remaining_${s.tradingsymbol}`, ok: false, detail: `${s.qty} ${s.product}`, raw: { error: s.error } })),
        ],
        rawError: out.remaining.length ? out.message : null,
        actionRequired: out.remaining.length ? 'square_off_all_incomplete' : null,
      }).catch(() => {});
      return Response.json(out, { headers });
    }

    // ─────────────────────────────────────────────────────
    // WRITE actions (require POST)
    // ─────────────────────────────────────────────────────
    if (action === 'place_order') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      const body = await request.json().catch(() => ({}));
      if (url.searchParams.get('simulate') === '1') body.simulate = true;
      const out = await placeOrder(env, db, kiteHeaders, body);
      // Derive a max-loss for the trail: qty × ref (entry) — exits are flattening.
      const refR = body.ref_price != null ? Number(body.ref_price) : (body.price != null ? Number(body.price) : null);
      await recordRun(db, {
        scenario: body.scenario || '', kind: 'place_order', surface: body.surface,
        mode: (body.simulate === true || body.simulate === '1') ? 'sim' : 'tiny_real',
        symbol: body.tradingsymbol, qty: body.quantity, tag: body.tag,
        status: out.blocked ? 'blocked'
              : out.deduped ? 'deduped'
              : out.simulated ? 'complete'
              : out.ok ? 'placed' : 'error',
        maxLossPaise: (refR != null && body.transaction_type === 'BUY') ? Math.round(body.quantity * refR * 100) : null,
        intent: body,
        steps: [{ name: 'place_order', ok: out.ok === true, detail: out.message || out.error || null, raw: out.kite_response || out }],
        rawError: out.error || (out.kite_response && out.kite_response.message) || null,
      }).catch(() => {});
      return Response.json(out, { headers });
    }
    // ── Exec-Lab run history (the app reads its own trail; you diagnose via D1) ──
    if (action === 'lab_runs') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
      const scenario = url.searchParams.get('scenario');
      const rows = scenario
        ? await db.prepare(`SELECT * FROM lab_runs WHERE scenario=? ORDER BY id DESC LIMIT ?`).bind(scenario, limit).all()
        : await db.prepare(`SELECT * FROM lab_runs ORDER BY id DESC LIMIT ?`).bind(limit).all();
      return Response.json({ ok: true, runs: rows.results || [] }, { headers });
    }
    if (action === 'lab_run') {
      const runId = url.searchParams.get('run_id');
      if (!runId) return Response.json({ error: 'run_id required' }, { status: 400, headers });
      const run = await db.prepare(`SELECT * FROM lab_runs WHERE id=?`).bind(runId).first();
      const steps = await db.prepare(`SELECT * FROM lab_steps WHERE run_id=? ORDER BY seq`).bind(runId).all();
      return Response.json({ ok: !!run, run: run || null, steps: steps.results || [] }, { headers });
    }
    // §6.2: TIME-EXIT CRON SCAFFOLD — SIM/DRY ONLY, NOT ARMED against real orders.
    // This proves the wiring (what would be squared at the configured IST time) WITHOUT
    // sending anything. It refuses to fire a real square-off unless BOTH time_exit_enabled=1
    // AND ?arm=1 are set — neither is true for tomorrow. The real arming is a deliberate
    // Stage-2 decision (a Cloudflare Cron Worker), never a momentum step out of tomorrow.
    if (action === 'time_exit_cron') {
      const armCfg = await db.prepare(`SELECT config_value FROM user_config WHERE config_key='time_exit_enabled' LIMIT 1`).first().catch(() => null);
      const armed = armCfg?.config_value === '1' && url.searchParams.get('arm') === '1';
      const r = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: kiteHeaders });
      const j = await r.json().catch(() => ({}));
      const open = ((j.data && j.data.net) || []).filter(p => (p.quantity || 0) !== 0);
      const wouldSquare = open.map(p => ({ tradingsymbol: p.tradingsymbol, product: p.product, qty: Math.abs(p.quantity) }));
      if (!armed) {
        await recordRun(db, {
          scenario: 'X3', kind: 'time_exit_dry', surface: 'cron', mode: 'sim', status: 'complete',
          intent: { armed: false }, steps: wouldSquare.map((w, i) => ({ name: `would_square_${w.tradingsymbol}`, ok: true, detail: `${w.qty} ${w.product}`, raw: w })),
        }).catch(() => {});
        return Response.json({ ok: true, armed: false, dry_run: true, would_square: wouldSquare,
          message: `DRY RUN (time-exit not armed). Would square ${wouldSquare.length} MIS position(s) at the configured IST time. Real arming is a deliberate Stage-2 step — time_exit_enabled=1 AND ?arm=1 both required.` }, { headers });
      }
      // armed path (NOT reachable tomorrow): real square_off_all.
      const out = await squareOffAll(env, db, kiteHeaders, { bypass_block: false });
      return Response.json({ ok: out.ok, armed: true, ...out }, { headers });
    }
    if (action === 'place_gtt') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      return Response.json(await placeGtt(env, db, kiteHeaders, await request.json()), { headers });
    }
    if (action === 'cancel_order') {
      if (request.method !== 'POST' && request.method !== 'DELETE') return Response.json({ error: 'POST/DELETE required' }, { status: 405, headers });
      const orderId = url.searchParams.get('order_id');
      if (!orderId) return Response.json({ error: 'order_id required' }, { status: 400, headers });
      return Response.json(await cancelOrder(db, kiteHeaders, orderId), { headers });
    }
    if (action === 'delete_gtt') {
      if (request.method !== 'POST' && request.method !== 'DELETE') return Response.json({ error: 'POST/DELETE required' }, { status: 405, headers });
      const gttId = url.searchParams.get('gtt_id');
      if (!gttId) return Response.json({ error: 'gtt_id required' }, { status: 400, headers });
      return Response.json(await deleteGtt(db, kiteHeaders, gttId), { headers });
    }
    if (action === 'modify_order') {
      if (request.method !== 'POST' && request.method !== 'PUT') return Response.json({ error: 'POST/PUT required' }, { status: 405, headers });
      const orderId = url.searchParams.get('order_id');
      if (!orderId) return Response.json({ error: 'order_id required' }, { status: 400, headers });
      return Response.json(await modifyOrder(db, kiteHeaders, orderId, await request.json()), { headers });
    }
    // §6.4: GTT MODIFY (PUT /gtt/triggers/:id) — trail / resize a stop in place.
    if (action === 'modify_gtt') {
      if (request.method !== 'POST' && request.method !== 'PUT') return Response.json({ error: 'POST/PUT required' }, { status: 405, headers });
      const gttId = url.searchParams.get('gtt_id');
      if (!gttId) return Response.json({ error: 'gtt_id required' }, { status: 400, headers });
      return Response.json(await modifyGtt(db, kiteHeaders, gttId, await request.json()), { headers });
    }

    // ─────────────────────────────────────────────────────
    // READ actions (GET)
    // ─────────────────────────────────────────────────────
    let path, qs = '';
    switch (action) {
      case 'profile':     path = '/user/profile'; break;
      case 'margins':     path = '/user/margins'; break;
      case 'holdings':    path = '/portfolio/holdings'; break;
      case 'positions':   path = '/portfolio/positions'; break;
      case 'orders':      path = '/orders'; break;
      case 'quote':       path = '/quote'; qs = `?${buildInstrumentsQs(url)}`; break;
      case 'ltp':         path = '/quote/ltp'; qs = `?${buildInstrumentsQs(url)}`; break;
      case 'ohlc':        path = '/quote/ohlc'; qs = `?${buildInstrumentsQs(url)}`; break;
      case 'gtt_list':    path = '/gtt/triggers'; break;
      case 'order_status': {
        const orderId = url.searchParams.get('order_id');
        if (!orderId) return Response.json({ error: 'order_id required' }, { status: 400, headers });
        path = `/orders/${encodeURIComponent(orderId)}`;
        break;
      }
      case 'gtt_get': {
        const gttId = url.searchParams.get('gtt_id');
        if (!gttId) return Response.json({ error: 'gtt_id required' }, { status: 400, headers });
        path = `/gtt/triggers/${encodeURIComponent(gttId)}`;
        break;
      }
      case 'instruments': {
        const exchange = url.searchParams.get('exchange') || 'NSE';
        return await proxyText(`${KITE_BASE}/instruments/${exchange}`, kiteHeaders, db, headers);
      }
      case 'historical': {
        const token = url.searchParams.get('instrument_token');
        const interval = url.searchParams.get('interval') || 'day';
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!token || !from || !to) return Response.json({ error: 'instrument_token, from, to required' }, { status: 400, headers });
        path = `/instruments/historical/${token}/${interval}`;
        qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        break;
      }
      default:
        return Response.json({ error: 'unknown action' }, { status: 400, headers });
    }

    return await proxyJson(`${KITE_BASE}${path}${qs}`, kiteHeaders, db, headers);
  } catch (e) {
    return Response.json({ error: e.message, stack: e.stack }, { status: 500, headers });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SURGICAL EXECUTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/kite?action=place_order
// Body:
//   { exchange, tradingsymbol, transaction_type, quantity,
//     product, order_type, price?, trigger_price?, validity?, tag? }
// product is REQUIRED (MIS|CNC|NRML|MTF — no default). Defaults: order_type=MARKET, validity=DAY, variety=regular
//
// ═══ THE SINGLE HARDENED DOOR (Exec-Lab §6.1) ═════════════════════════════════
// placeOrder is now the ONE order primitive every entry/exit flows through:
//   placeBracket's buy leg + squareOff call it, so iOS AND the future auto-bridge
//   inherit every guard from one place. The guards it now carries, all
//   DIRECTION-AWARE (entry = BUY-to-open, exit = SELL / square-off):
//     • kiteFetch  — circuit breaker + kite_endpoint_health writes (was raw fetch).
//     • Idempotency tag — 120s dedupe window keyed on the client tag, so a retry
//       never double-fires a real order (lifted from placeBracket's pattern).
//     • Fund-check — DIRECTION-AWARE: an ENTRY (BUY) runs the live free-cash
//       fail-safe; an EXIT (SELL / square-off) SKIPS it (bypass_funds_check) so a
//       flatten is never wrongly refused at cash=0.
//     • max_order_notional_paise cap — refuse if qty × ref_price exceeds the
//       per-test ceiling. A fat-finger is structurally impossible, not caught.
//     • Orphan recovery — surfaced via recordRun on the choke path (see action=*).
//
// Internal callers (placeBracket buy leg) pass _internal:true to SKIP the dedupe
// and fund-check here (the bracket already ran BOTH upstream once), so the bracket
// normal path stays byte-for-byte identical: same single fund-check, same single
// kiteFetch BUY. is_exit / bypass_funds_check make the direction explicit.
async function placeOrder(env, db, kiteHeaders, body) {
  const required = ['exchange', 'tradingsymbol', 'transaction_type', 'quantity'];
  for (const f of required) {
    if (!body[f]) throw new Error(`Missing required field: ${f}`);
  }
  if (!['BUY','SELL'].includes(body.transaction_type)) throw new Error('transaction_type must be BUY or SELL');
  if (!Number.isInteger(body.quantity) || body.quantity < 1) throw new Error('quantity must be positive integer');
  assertProduct(body);   // Fix #3: no silent CNC default

  const variety = body.variety || 'regular';
  const internal = body._internal === true;     // called by placeBracket buy leg
  // Direction: an EXIT (SELL / square-off) skips the fund-check; an ENTRY (BUY)
  // runs it. Caller can also force the bypass explicitly.
  const isExit = body.is_exit === true || body.transaction_type === 'SELL';
  const skipFundCheck = internal || body.bypass_funds_check === true || isExit;

  // ─── Pre-launch / CPV-pending safety guard ──────────────
  // If user_config.block_real_orders = 1, refuse to place real orders.
  // Override possible by passing body.bypass_block = true (e.g., manual emergency).
  const block = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='block_real_orders' LIMIT 1`
  ).first();
  if (block?.config_value === '1' && !body.bypass_block) {
    return {
      ok: false,
      blocked: true,
      reason: 'block_real_orders=1 in user_config',
      message: 'Real orders are blocked while engine is in shadow_run mode (pre-launch / CPV pending / paused). To unblock: UPDATE user_config SET config_value=\'0\' WHERE config_key=\'block_real_orders\'. Or pass bypass_block:true if you understand the risk.',
      attempted_order: { ...body, quantity: body.quantity, tradingsymbol: body.tradingsymbol },
    };
  }
  if (!body.bypass_market_hours && !isNseRegularMarketOpen()) {
    await logKite(db, `/orders/${variety} preflight`, 'POST', 422, 0, 'market_closed_preflight');
    return {
      ok: false,
      error: 'market_closed_preflight',
      message: 'NSE regular market is closed. Live order not sent to Kite.',
      attempted_order: { ...body, quantity: body.quantity, tradingsymbol: body.tradingsymbol },
    };
  }

  // ─── §6.1 max_order_notional_paise cap (fat-finger made impossible) ─────────
  // Refuse if qty × ref_price exceeds the per-test ceiling. ref_price preference:
  // explicit ref_price (rupees) → LIMIT price → trigger_price → instrument last_price.
  // If no reference price can be derived (a MARKET order with no price hint and no
  // cached LTP), we cannot bound the spend → refuse on the fail-safe side rather
  // than place an unbounded order.
  //
  // NO-REGRESSION: the cap is OPT-IN (body.enforce_notional_cap === true) so it
  // does NOT break the existing Execute-tab bracket, which sizes real orders against
  // the engine's tranches (₹1000s) and would otherwise be refused by the ₹500 Lab
  // ceiling. The Lab sets enforce_notional_cap:true on every tiny test order, making
  // a fat-finger structurally impossible THERE; production sizing is untouched.
  if (body.enforce_notional_cap === true) {
    const capRow = await db.prepare(
      `SELECT config_value FROM user_config WHERE config_key='max_order_notional_paise' LIMIT 1`
    ).first();
    const capPaise = capRow ? parseInt(capRow.config_value, 10) : NaN;
    if (Number.isFinite(capPaise) && capPaise > 0) {
      let refRupees = null;
      if (body.ref_price != null) refRupees = Number(body.ref_price);
      else if (body.price != null) refRupees = Number(body.price);
      else if (body.trigger_price != null) refRupees = Number(body.trigger_price);
      else {
        // MARKET with no hint — look up the instrument's cached last_price.
        try {
          const inst = await db.prepare(
            `SELECT last_price FROM kite_instruments WHERE tradingsymbol=? AND exchange=? LIMIT 1`
          ).bind(body.tradingsymbol, body.exchange).first();
          if (inst && inst.last_price != null) refRupees = Number(inst.last_price);
        } catch { refRupees = null; }
      }
      // Exits are flattening an existing position; the cap is an ENTRY guard
      // (it bounds money put AT RISK). Never let the cap block a square-off.
      if (!isExit) {
        if (refRupees == null || !Number.isFinite(refRupees) || refRupees <= 0) {
          return {
            ok: false, error: 'notional_unbounded',
            message: `Cannot bound order spend: no reference price for ${body.exchange}:${body.tradingsymbol} (MARKET order, no price hint, no cached last_price). Order refused (fail-safe). Pass ref_price or sync_instruments first.`,
            attempted_order: { tradingsymbol: body.tradingsymbol, quantity: body.quantity },
          };
        }
        const notionalPaise = Math.round(body.quantity * refRupees * 100);
        if (notionalPaise > capPaise) {
          return {
            ok: false, error: 'over_notional_cap',
            notional_paise: notionalPaise, cap_paise: capPaise,
            message: `Refused: this order is ~₹${Math.round(notionalPaise / 100)} (${body.quantity} × ₹${refRupees}) which exceeds the per-test ceiling of ₹${Math.round(capPaise / 100)}. Max you can lose this run is capped — raise max_order_notional_paise deliberately to allow a bigger order.`,
            attempted_order: { tradingsymbol: body.tradingsymbol, quantity: body.quantity },
          };
        }
      }
    }
  }

  // ─── §6.1 Idempotency / double-fire guard (lifted from placeBracket) ────────
  // A network timeout mid-order + a client retry (or a double tap) must NOT fire a
  // SECOND real order. Window-keyed dedupe on (symbol, transaction_type, tag): a
  // non-error lab_runs row for the same symbol+side+tag inside the window means an
  // order is already in-flight/placed → return it, suppress the duplicate.
  // Internal bracket buys skip this (the bracket already deduped on kite_bracket_orders).
  const DEDUPE_WINDOW_MS = 120000;
  const idemTag = body.tag ? String(body.tag).slice(0, 20) : null;
  if (!internal && idemTag) {
    const dupe = await db.prepare(
      `SELECT id, status, raw_error, steps_json, created_at
         FROM lab_runs
        WHERE symbol = ? AND tag = ?
          AND kind = 'place_order'
          AND status NOT IN ('error','blocked','market_closed','over_notional_cap','notional_unbounded')
          AND json_extract(intent_json, '$.transaction_type') = ?
          AND created_at > ?
        ORDER BY id DESC LIMIT 1`
    ).bind(body.tradingsymbol, idemTag, body.transaction_type,
           new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()).first().catch(() => null);
    if (dupe) {
      return {
        ok: true, deduped: true, lab_run_id: dupe.id,
        message: `Duplicate suppressed — a ${body.transaction_type} ${body.tradingsymbol} (tag ${idemTag}) was placed ${Math.round((Date.now() - Date.parse(dupe.created_at)) / 1000)}s ago (run ${dupe.id}, status ${dupe.status}). No second order sent.`,
      };
    }
  }

  // ─── §6.1 DIRECTION-AWARE fund-check (entry only; exit skips) ───────────────
  // An ENTRY (BUY-to-open) runs the live free-cash fail-safe: refresh funds, ask
  // Kite's margin calc for this order's requirement, refuse if free cash can't
  // cover it (or can't be verified). An EXIT (SELL / square-off) SKIPS this — else
  // a flatten is wrongly refused at cash=0 and the position can't be closed.
  //
  // NFO (options) orders SKIP the equity free-cash check here — their margin is
  // validated by nfoBuyerGate (order_margins ≤ ₹2k cap) below, and equity cash is
  // the wrong segment for an option buyer's premium debit. Avoids a false
  // insufficient_free_cash refusal on a valid capped-premium option buy.
  const isNfo = String(body.exchange).toUpperCase() === 'NFO';
  if (!skipFundCheck && !isNfo && body.transaction_type === 'BUY') {
    let availableCashPaise = null;
    try {
      const rf = await reconcileFunds(env, db, kiteHeaders);
      if (rf && rf.ok === true) {
        const f = await db.prepare(
          `SELECT available_cash_paise FROM kite_funds_live WHERE segment='equity'`
        ).first();
        availableCashPaise = f ? Number(f.available_cash_paise) : null;
      }
    } catch { availableCashPaise = null; }

    let requiredPaise = null;
    try {
      const m = await orderMargins(env, db, kiteHeaders, {
        orders: [{
          exchange: body.exchange, tradingsymbol: body.tradingsymbol, transaction_type: 'BUY',
          variety, product: body.product,
          order_type: body.order_type || 'MARKET', quantity: body.quantity,
          price: body.price != null ? Number(body.price) : 0,
        }],
      });
      const leg = (m && m.ok && Array.isArray(m.data)) ? m.data[0] : null;
      if (leg && leg.total != null) requiredPaise = Math.round(Number(leg.total) * 100);
    } catch { requiredPaise = null; }
    if (requiredPaise == null) {
      const refRupees = body.ref_price != null ? Number(body.ref_price)
        : (body.price != null ? Number(body.price)
        : (body.trigger_price != null ? Number(body.trigger_price) : 0));
      requiredPaise = Math.round(body.quantity * refRupees * 100);
    }

    if (availableCashPaise == null || requiredPaise > availableCashPaise) {
      const reason = availableCashPaise == null ? 'funds_unverified' : 'insufficient_free_cash';
      return {
        ok: false, error: reason,
        required_paise: requiredPaise, available_cash_paise: availableCashPaise,
        message: availableCashPaise == null
          ? 'Could not verify live free cash with Kite — real order NOT sent (fail-safe). Retry once funds are confirmed, or pass bypass_funds_check to override.'
          : `Insufficient free cash: this order needs about ₹${Math.round(requiredPaise / 100)} but only ₹${Math.round(availableCashPaise / 100)} is free. No order sent.`,
      };
    }
  }

  // ─── §6.3 NFO buyer-only gate (options: index weeklies only, buyer-only) ────
  // Three hard rules, applied to any NFO order. Index options are cash-settled
  // (safe); stock options are physically settled (lakhs of delivery risk) → index
  // whitelist only. Writing (opening SELL) needs SPAN margin → blocked. qty must be
  // an exact multiple of the instrument's lot_size. Runs BEFORE simulate so SIM
  // proves the gate too (O5 writing-blocked is provable at ₹0).
  if (String(body.exchange).toUpperCase() === 'NFO' && !body.bypass_nfo_gate) {
    const gate = await nfoBuyerGate(env, db, kiteHeaders, body);
    if (!gate.ok) return gate;   // refused-by-construction; verbatim reason inside
  }

  // ─── SIM rung: every guard above ran for real (block, market-hours, cap,
  // dedupe, fund-check) but NOTHING is sent to Kite — ₹0 risk software path. This
  // is how the Lab SIM-proves a raw order and its reject/validation paths. A SIM
  // order returns a synthetic accept so a SIM round-trip can complete.
  if (body.simulate === true || body.simulate === '1') {
    return {
      ok: true, simulated: true,
      order_id: `SIM_${body.transaction_type}_${body.tradingsymbol}_${Date.now()}`,
      message: `Simulated ${body.transaction_type} ${body.quantity} ${body.exchange}:${body.tradingsymbol} (${body.product} ${body.order_type || 'MARKET'}) — passed all guards, nothing sent to broker.`,
    };
  }

  const formData = new URLSearchParams({
    exchange: body.exchange,
    tradingsymbol: body.tradingsymbol,
    transaction_type: body.transaction_type,
    quantity: String(body.quantity),
    product: body.product,
    order_type: body.order_type || 'MARKET',
    validity: body.validity || 'DAY',
  });
  if (body.price != null) formData.set('price', String(body.price));
  if (body.trigger_price != null) formData.set('trigger_price', String(body.trigger_price));
  if (body.disclosed_quantity != null) formData.set('disclosed_quantity', String(body.disclosed_quantity));
  if (body.tag) formData.set('tag', String(body.tag).slice(0, 20));

  // §6.1: route through kiteFetch (circuit breaker + kite_endpoint_health writes)
  // instead of raw fetch — so a Lab order trips the breaker and stamps
  // last_success_ts like every other call. Returns { ok, status, body }.
  const r = await kiteFetch(db, `${KITE_BASE}/orders/${variety}`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const j = r.body || {};

  if (!r.ok || j.status !== 'success') {
    return { ok: false, error: j.message || r.error || 'Order failed', kite_response: j, http_status: r.status };
  }
  return { ok: true, order_id: j.data.order_id, kite_response: j };
}

// POST /api/kite?action=place_gtt
// Body:
//   { tradingsymbol, exchange, last_price, type='two-leg',
//     stop_trigger, stop_price, target_trigger, target_price,
//     quantity, transaction_type='SELL', product (REQUIRED: MIS|CNC|NRML|MTF) }
// type='single' is also supported with single trigger_value + price.
async function placeGtt(env, db, kiteHeaders, body) {
  const required = ['tradingsymbol', 'exchange', 'last_price', 'quantity'];
  for (const f of required) {
    if (!body[f]) throw new Error(`Missing required field: ${f}`);
  }
  assertProduct(body);   // Fix #3: GTT legs must carry an explicit product too

  const isOco = body.type === 'two-leg' || (body.stop_trigger && body.target_trigger);

  let condition, orders;
  if (isOco) {
    if (!body.stop_trigger || !body.target_trigger) throw new Error('OCO requires stop_trigger and target_trigger');
    condition = {
      exchange: body.exchange,
      tradingsymbol: body.tradingsymbol,
      last_price: Number(body.last_price),
      trigger_values: [Number(body.stop_trigger), Number(body.target_trigger)],
    };
    orders = [
      {
        exchange: body.exchange,
        tradingsymbol: body.tradingsymbol,
        transaction_type: body.transaction_type || 'SELL',
        quantity: body.quantity,
        order_type: 'LIMIT',
        product: body.product,
        price: Number(body.stop_price || body.stop_trigger),
      },
      {
        exchange: body.exchange,
        tradingsymbol: body.tradingsymbol,
        transaction_type: body.transaction_type || 'SELL',
        quantity: body.quantity,
        order_type: 'LIMIT',
        product: body.product,
        price: Number(body.target_price || body.target_trigger),
      },
    ];
  } else {
    if (!body.trigger_value || body.price == null) throw new Error('single-leg GTT requires trigger_value and price');
    condition = {
      exchange: body.exchange,
      tradingsymbol: body.tradingsymbol,
      last_price: Number(body.last_price),
      trigger_values: [Number(body.trigger_value)],
    };
    orders = [{
      exchange: body.exchange,
      tradingsymbol: body.tradingsymbol,
      transaction_type: body.transaction_type || 'SELL',
      quantity: body.quantity,
      order_type: 'LIMIT',
      product: body.product,
      price: Number(body.price),
    }];
  }

  const formData = new URLSearchParams({
    type: isOco ? 'two-leg' : 'single',
    condition: JSON.stringify(condition),
    orders: JSON.stringify(orders),
  });

  const t0 = Date.now();
  const [gu, go] = routeOrder(`${KITE_BASE}/gtt/triggers`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const res = await fetch(gu, go);
  const j = await res.json();
  await logKite(db, `/gtt/triggers POST`, 'POST', res.status, Date.now() - t0, res.ok ? null : (j.message || j.error_type));

  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'GTT failed', kite_response: j, http_status: res.status };
  }
  return { ok: true, gtt_id: j.data.trigger_id, kite_response: j };
}

async function cancelOrder(db, kiteHeaders, orderId) {
  const variety = 'regular';
  const url = `${KITE_BASE}/orders/${variety}/${encodeURIComponent(orderId)}`;
  const t0 = Date.now();
  const [cu, co] = routeOrder(url, { method: 'DELETE', headers: kiteHeaders });
  const res = await fetch(cu, co);
  const j = await res.json();
  await logKite(db, `/orders/${variety} DELETE`, 'DELETE', res.status, Date.now() - t0, res.ok ? null : (j.message || ''));
  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'Cancel failed' };
  }
  return { ok: true, kite_response: j };
}

async function deleteGtt(db, kiteHeaders, gttId) {
  const url = `${KITE_BASE}/gtt/triggers/${encodeURIComponent(gttId)}`;
  const t0 = Date.now();
  const [du, dop] = routeOrder(url, { method: 'DELETE', headers: kiteHeaders });
  const res = await fetch(du, dop);
  const j = await res.json();
  await logKite(db, `/gtt/triggers DELETE`, 'DELETE', res.status, Date.now() - t0, res.ok ? null : (j.message || ''));
  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'GTT delete failed' };
  }
  return { ok: true };
}

// §6.4: GTT MODIFY (PUT /gtt/triggers/:id) — for trailing / resizing a stop without
// delete+replace. Same body shape as place_gtt (type, condition legs); rebuilds the
// trigger in place. Used by partial-exit (resize GTT qty to the held remainder) and
// the future trailing-stop cron. Routes through routeOrder (static-IP egress).
async function modifyGtt(db, kiteHeaders, gttId, body) {
  const required = ['tradingsymbol', 'exchange', 'last_price', 'quantity'];
  for (const f of required) {
    if (!body[f]) throw new Error(`Missing required field: ${f}`);
  }
  assertProduct(body);   // GTT legs carry an explicit product
  const isOco = body.type === 'two-leg' || (body.stop_trigger && body.target_trigger);
  let condition, orders;
  if (isOco) {
    if (!body.stop_trigger || !body.target_trigger) throw new Error('OCO requires stop_trigger and target_trigger');
    condition = {
      exchange: body.exchange, tradingsymbol: body.tradingsymbol,
      last_price: Number(body.last_price),
      trigger_values: [Number(body.stop_trigger), Number(body.target_trigger)],
    };
    orders = [
      { exchange: body.exchange, tradingsymbol: body.tradingsymbol, transaction_type: body.transaction_type || 'SELL',
        quantity: body.quantity, order_type: 'LIMIT', product: body.product, price: Number(body.stop_price || body.stop_trigger) },
      { exchange: body.exchange, tradingsymbol: body.tradingsymbol, transaction_type: body.transaction_type || 'SELL',
        quantity: body.quantity, order_type: 'LIMIT', product: body.product, price: Number(body.target_price || body.target_trigger) },
    ];
  } else {
    if (!body.trigger_value || body.price == null) throw new Error('single-leg GTT requires trigger_value and price');
    condition = {
      exchange: body.exchange, tradingsymbol: body.tradingsymbol,
      last_price: Number(body.last_price), trigger_values: [Number(body.trigger_value)],
    };
    orders = [{ exchange: body.exchange, tradingsymbol: body.tradingsymbol, transaction_type: body.transaction_type || 'SELL',
      quantity: body.quantity, order_type: 'LIMIT', product: body.product, price: Number(body.price) }];
  }
  const formData = new URLSearchParams({
    type: isOco ? 'two-leg' : 'single',
    condition: JSON.stringify(condition),
    orders: JSON.stringify(orders),
  });
  const url = `${KITE_BASE}/gtt/triggers/${encodeURIComponent(gttId)}`;
  const t0 = Date.now();
  const [gu, go] = routeOrder(url, {
    method: 'PUT',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const res = await fetch(gu, go);
  const j = await res.json();
  await logKite(db, `/gtt/triggers PUT`, 'PUT', res.status, Date.now() - t0, res.ok ? null : (j.message || j.error_type));
  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'GTT modify failed', kite_response: j, http_status: res.status };
  }
  return { ok: true, gtt_id: j.data?.trigger_id || gttId, kite_response: j };
}

async function modifyOrder(db, kiteHeaders, orderId, body) {
  const variety = 'regular';
  const formData = new URLSearchParams();
  if (body.quantity != null) formData.set('quantity', String(body.quantity));
  if (body.price != null) formData.set('price', String(body.price));
  if (body.order_type) formData.set('order_type', body.order_type);
  if (body.trigger_price != null) formData.set('trigger_price', String(body.trigger_price));
  if (body.validity) formData.set('validity', body.validity);

  const url = `${KITE_BASE}/orders/${variety}/${encodeURIComponent(orderId)}`;
  const t0 = Date.now();
  const [mu, mo] = routeOrder(url, {
    method: 'PUT',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const res = await fetch(mu, mo);
  const j = await res.json();
  await logKite(db, `/orders/${variety} PUT`, 'PUT', res.status, Date.now() - t0, res.ok ? null : (j.message || ''));
  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'Modify failed' };
  }
  return { ok: true, order_id: j.data.order_id, kite_response: j };
}

// ═══════════════════════════════════════════════════════════════════════════
// P4: kiteFetch — wrapped fetch with rate-limit, retry, circuit-breaker
// All Kite API calls should go through this. It:
//   - Tracks per-endpoint health in kite_endpoint_health
//   - Circuit-breaks if 5 consecutive failures (60-sec cooldown)
//   - On 429: exponential backoff (1, 2, 4 sec) up to 3 retries
//   - On 5xx: 1 retry after 1 sec
//   - Logs every call to kite_api_log
// ═══════════════════════════════════════════════════════════════════════════
async function kiteFetch(db, url, opts = {}, attempt = 1) {
  const u = new URL(url);
  const endpoint = u.pathname;

  // Check circuit breaker
  const health = await db.prepare(
    `SELECT is_circuit_open, circuit_opens_until, consecutive_failures FROM kite_endpoint_health WHERE endpoint=?`
  ).bind(endpoint).first();
  if (health?.is_circuit_open && health.circuit_opens_until > Date.now()) {
    const wait = Math.round((health.circuit_opens_until - Date.now()) / 1000);
    throw new Error(`Circuit open for ${endpoint} — ${wait}s remaining (${health.consecutive_failures} failures)`);
  }

  const t0 = Date.now();
  let res, body, err;
  const [fetchUrl, fetchOpts] = routeOrder(url, opts);   // static-IP egress for order mutations
  try {
    res = await fetch(fetchUrl, { ...fetchOpts, signal: AbortSignal.timeout(15000) });
    try { body = await res.json(); } catch { body = null; }
  } catch (e) {
    err = String(e).slice(0, 300);
  }
  const dur = Date.now() - t0;
  const status = res?.status || 0;

  // Log to kite_api_log
  await db.prepare(
    `INSERT INTO kite_api_log (endpoint,method,status,duration_ms,error,ts)
     VALUES (?,?,?,?,?,?)`
  ).bind(endpoint, opts.method || 'GET', status, dur,
    (status >= 400 || err) ? (err || body?.message || `HTTP ${status}`) : null, Date.now()
  ).run();

  // Update endpoint_health
  const now = Date.now();
  if (status >= 200 && status < 300) {
    // Success — reset failure counter, close circuit
    await db.prepare(
      `INSERT INTO kite_endpoint_health (endpoint,last_success_ts,total_calls,consecutive_failures,is_circuit_open,updated_at)
       VALUES (?,?,1,0,0,?)
       ON CONFLICT(endpoint) DO UPDATE SET
         last_success_ts=excluded.last_success_ts,
         total_calls=total_calls+1,
         consecutive_failures=0,
         is_circuit_open=0,
         circuit_opens_until=NULL,
         updated_at=excluded.updated_at`
    ).bind(endpoint, now, now).run();
    return { ok: true, status, body, duration_ms: dur };
  }

  // 429 → exponential backoff retry
  if (status === 429 && attempt <= 3) {
    const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
    await db.prepare(
      `INSERT INTO kite_endpoint_health (endpoint,total_429,total_calls,updated_at)
       VALUES (?,1,1,?)
       ON CONFLICT(endpoint) DO UPDATE SET total_429=total_429+1, total_calls=total_calls+1, updated_at=?`
    ).bind(endpoint, now, now).run();
    await new Promise(r => setTimeout(r, delay));
    return kiteFetch(db, url, opts, attempt + 1);
  }

  // 5xx → 1 retry after 1 sec
  if (status >= 500 && status < 600 && attempt === 1) {
    await db.prepare(
      `INSERT INTO kite_endpoint_health (endpoint,total_5xx,total_calls,updated_at)
       VALUES (?,1,1,?)
       ON CONFLICT(endpoint) DO UPDATE SET total_5xx=total_5xx+1, total_calls=total_calls+1, updated_at=?`
    ).bind(endpoint, now, now).run();
    await new Promise(r => setTimeout(r, 1000));
    return kiteFetch(db, url, opts, attempt + 1);
  }

  // Failure — increment counter, maybe open circuit
  const newFailures = (health?.consecutive_failures || 0) + 1;
  const shouldOpenCircuit = newFailures >= 5;
  await db.prepare(
    `INSERT INTO kite_endpoint_health
       (endpoint,last_failure_ts,consecutive_failures,total_calls,is_circuit_open,circuit_opens_until,updated_at)
     VALUES (?,?,?,1,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       last_failure_ts=excluded.last_failure_ts,
       consecutive_failures=excluded.consecutive_failures,
       total_calls=total_calls+1,
       is_circuit_open=excluded.is_circuit_open,
       circuit_opens_until=excluded.circuit_opens_until,
       updated_at=excluded.updated_at`
  ).bind(
    endpoint, now, newFailures,
    shouldOpenCircuit ? 1 : 0,
    shouldOpenCircuit ? now + 60000 : null,
    now
  ).run();

  return { ok: false, status, body, error: err || body?.message, duration_ms: dur };
}

// ═══════════════════════════════════════════════════════════════════════════
// P1: place_bracket — atomic CNC order + GTT with retry + fallback to SL-M
// ═══════════════════════════════════════════════════════════════════════════
async function placeBracket(env, db, kiteHeaders, body) {
  // Validate
  const required = ['exchange', 'tradingsymbol', 'quantity', 'stop_price', 'target_price'];
  for (const f of required) {
    if (body[f] == null) throw new Error(`Missing required field: ${f}`);
  }
  assertProduct(body);   // Fix #3: no silent CNC default on the bracket buy/stop/target legs
  const symbol = body.tradingsymbol;
  const exchange = body.exchange;
  const qty = body.quantity;
  const stopPrice = parseFloat(body.stop_price);
  const targetPrice = parseFloat(body.target_price);
  const tag = body.tag || 'HN_WE_BRK';

  // ─── Fix #1: idempotency / double-buy guard ───────────────────────────────
  // The hole: kite_bracket_orders had no tag column and placeBracket had no
  // dedupe, so a network timeout mid-BUY + a client retry (or a double tap)
  // could fire a SECOND market order. Refuse a new bracket when a NON-failed row
  // for this symbol already exists inside the dedupe window — that row is either
  // an in-flight execution or a just-placed order, so a retry must NOT buy again;
  // we return the existing row and treat the retry as the original request.
  // 'failed' / 'blocked_shadow' / 'market_closed' rows never reached Kite, so a
  // genuine retry after one of those SHOULD proceed (they're excluded here).
  // Window-based (not tag-based) because every current caller sends a CONSTANT
  // tag (HN_WE_BRK / HN_WE_AUTO / app tag); a same-symbol re-entry after the
  // window is still allowed. (The tag is stored for audit + a future per-intent
  // idempotency key, which could widen this to a symbol+tag match.)
  const DEDUPE_WINDOW_MS = 120000; // 2 min — covers Kite's 15s call timeout +
                                   // any client retry with wide margin.
  const dupe = await db.prepare(
    `SELECT id, step, buy_order_id, gtt_id, fallback_sl_order_id, fill_price_paise, created_at
       FROM kite_bracket_orders
      WHERE symbol = ?
        AND step NOT IN ('failed','blocked_shadow','market_closed')
        AND created_at > ?
      ORDER BY id DESC LIMIT 1`
  ).bind(symbol, Date.now() - DEDUPE_WINDOW_MS).first();
  if (dupe) {
    return {
      ok: true,                 // request honored — an order for this symbol is
      deduped: true,            // already in-flight/placed; we prevented a 2nd buy
      bracket_id: dupe.id,
      step: dupe.step,
      buy_order_id: dupe.buy_order_id || null,
      gtt_id: dupe.gtt_id || null,
      fallback_sl_order_id: dupe.fallback_sl_order_id || null,
      fill_price: dupe.fill_price_paise != null ? dupe.fill_price_paise / 100 : null,
      message: `Duplicate suppressed — a bracket for ${symbol} placed ${Math.round((Date.now() - dupe.created_at) / 1000)}s ago is already ${dupe.step} (id ${dupe.id}). No second order sent.`,
    };
  }

  // Create bracket-order tracking row before local guards so owner taps that
  // never reach Kite (shadow mode / pre-market) remain visible in audit trail.
  const bracketRowId = (await db.prepare(
    `INSERT INTO kite_bracket_orders
       (symbol,exchange,qty,intended_stop_paise,intended_target_paise,step,tag,created_at)
     VALUES (?,?,?,?,?,'starting',?,?)`
  ).bind(symbol, exchange, qty, Math.round(stopPrice * 100), Math.round(targetPrice * 100), tag, Date.now()).run()).meta?.last_row_id;

  // Pre-launch guard
  const block = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='block_real_orders'`
  ).first();
  if (block?.config_value === '1' && !body.bypass_block) {
    await db.prepare(`UPDATE kite_bracket_orders SET step='blocked_shadow', error=?, completed_at=? WHERE id=?`)
      .bind('block_real_orders=1 shadow_run', Date.now(), bracketRowId).run();
    return {
      ok: false, blocked: true, bracket_id: bracketRowId,
      reason: 'shadow_run',
      message: 'Real orders blocked. Engine is in shadow mode (CPV pending). Set block_real_orders=0 to unlock.',
      simulated: {
        symbol, qty, stop_price: stopPrice, target_price: targetPrice,
        flow: '1) MARKET BUY → 2) wait for fill → 3) GTT OCO → 4) verify',
        would_have_executed: true,
      },
    };
  }
  if (!body.bypass_market_hours && !isNseRegularMarketOpen()) {
    await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, completed_at=? WHERE id=?`)
      .bind('market_closed_preflight', Date.now(), bracketRowId).run();
    return {
      ok: false,
      bracket_id: bracketRowId,
      error: 'market_closed_preflight',
      message: 'NSE regular market is closed. Bracket order not sent to Kite.',
    };
  }

  // ─── Fix #2: live free-cash gate (size against available.cash, not net) ────
  // The engine's deployable is a STATIC notional (today_deployable_paise, ₹1L
  // default) and never checks real free cash. Live Kite available.cash can be 0
  // while net still shows ₹1L, so an EDGE verdict could size a real order against
  // money that isn't free → a margin reject or an oversized (leveraged) position.
  // Refuse unless freshly-verified free cash covers this order's actual margin.
  // Trade-off: adds ~1 Kite round-trip (~0.3–0.8s) before the buy. Acceptable —
  // correctness > sub-second latency on the money path, and well within the 20s
  // auto-bridge ceiling (the 12s fill poll dominates). bypass_funds_check escapes.
  if (!body.bypass_funds_check) {
    // Refresh funds FIRST — never trust a stale snapshot. If the refresh fails,
    // free cash is treated as unverified and the order is refused (fail-safe).
    let availableCashPaise = null;
    try {
      const rf = await reconcileFunds(env, db, kiteHeaders);
      if (rf && rf.ok === true) {
        const f = await db.prepare(
          `SELECT available_cash_paise FROM kite_funds_live WHERE segment='equity'`
        ).first();
        availableCashPaise = f ? Number(f.available_cash_paise) : null;
      }
    } catch { availableCashPaise = null; }

    // This order's actual cash requirement — ask Kite's margin calculator; on any
    // failure fall back to a CONSERVATIVE notional (qty × highest reference price).
    let requiredPaise = null;
    try {
      const m = await orderMargins(env, db, kiteHeaders, {
        orders: [{
          exchange, tradingsymbol: symbol, transaction_type: 'BUY',
          variety: 'regular', product: body.product,
          order_type: body.order_type || 'MARKET', quantity: qty,
          price: body.price != null ? Number(body.price) : 0,
        }],
      });
      const leg = (m && m.ok && Array.isArray(m.data)) ? m.data[0] : null;
      if (leg && leg.total != null) requiredPaise = Math.round(Number(leg.total) * 100);
    } catch { requiredPaise = null; }
    if (requiredPaise == null) {
      const refRupees = Math.max(targetPrice, stopPrice, body.price != null ? Number(body.price) : 0);
      requiredPaise = Math.round(qty * refRupees * 100);   // conservative notional upper bound
    }

    if (availableCashPaise == null || requiredPaise > availableCashPaise) {
      const reason = availableCashPaise == null ? 'funds_unverified' : 'insufficient_free_cash';
      await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, completed_at=? WHERE id=?`)
        .bind(reason, Date.now(), bracketRowId).run();
      return {
        ok: false, bracket_id: bracketRowId, error: reason,
        required_paise: requiredPaise,
        available_cash_paise: availableCashPaise,
        message: availableCashPaise == null
          ? 'Could not verify live free cash with Kite — real order NOT sent (fail-safe). Retry once funds are confirmed, or pass bypass_funds_check to override.'
          : `Insufficient free cash: this order needs about ₹${Math.round(requiredPaise / 100)} but only ₹${Math.round(availableCashPaise / 100)} is free. No order sent — the engine sizes against a fixed ₹1L notional, but real free cash is the real limit.`,
      };
    }
  }

  const result = { ok: false, bracket_id: bracketRowId, steps: [] };

  // ─── Step 1: place market buy ─────────────────────────────
  // §6.1: route the buy leg through the unified placeOrder so it inherits
  // kiteFetch + the notional cap from the one door. The bracket already ran BOTH
  // the dedupe (on kite_bracket_orders) and the fund-check above, so we pass
  // _internal:true (skip placeOrder's dedupe + fund-check) and ref_price (so the
  // notional cap can bound a MARKET buy without a price). This keeps the bracket
  // normal path byte-for-byte identical: one fund-check, one kiteFetch BUY, same
  // form fields — only the call site moved into the shared primitive.
  const refRupeesBuy = body.price != null ? Number(body.price) : Math.max(targetPrice, stopPrice);
  const buyRes = await placeOrder(env, db, kiteHeaders, {
    exchange, tradingsymbol: symbol,
    transaction_type: 'BUY', quantity: qty,
    product: body.product,
    order_type: body.order_type || 'MARKET',
    validity: 'DAY', tag,
    price: body.price != null ? body.price : undefined,
    variety: 'regular',
    ref_price: refRupeesBuy,
    _internal: true,            // bracket already deduped + fund-checked upstream
    bypass_block: true,         // the bracket's own block guard already passed above
    bypass_market_hours: true,  // the bracket's own market-hours guard already passed above
  });
  const buyJ = buyRes.kite_response || {};
  const buyOk = buyRes.ok === true && !!buyRes.order_id;
  result.steps.push({ step: 'place_buy', ok: buyOk, http: buyRes.http_status, ...buyJ });

  if (!buyOk) {
    const errMsg = buyRes.error || buyJ.message || 'Buy order failed';
    await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, completed_at=? WHERE id=?`)
      .bind(errMsg, Date.now(), bracketRowId).run();
    return { ...result, error: errMsg };
  }
  const buyOrderId = buyRes.order_id;
  await db.prepare(`UPDATE kite_bracket_orders SET buy_order_id=?, step='fill_polling' WHERE id=?`)
    .bind(buyOrderId, bracketRowId).run();

  // ─── Step 2: poll for fill (max 12 sec for market order) ─
  let fillPrice = null, filledQty = 0;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await kiteFetch(db, `${KITE_BASE}/orders/${encodeURIComponent(buyOrderId)}`, { headers: kiteHeaders });
    if (r.ok && r.body?.data) {
      const last = r.body.data[r.body.data.length - 1];
      if (last?.status === 'COMPLETE') {
        fillPrice = last.average_price;
        filledQty = last.filled_quantity;
        break;
      }
      if (last?.status === 'REJECTED') {
        await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, buy_status='REJECTED', completed_at=? WHERE id=?`)
          .bind(last.status_message || 'rejected', Date.now(), bracketRowId).run();
        return { ...result, error: 'Buy rejected: ' + (last.status_message || '') };
      }
    }
  }
  if (!fillPrice) {
    // ─── Fix #4a: never walk away from a possibly-naked position ──────────────
    // A MARKET order can fill just after the 12s poll window; the old code gave up
    // here, which could strand a filled position with NO stop. Do one authoritative
    // status check, then: recover a (full/partial) late fill and protect it; else
    // cancel the still-pending buy so it can't fill later unprotected; else, if we
    // can confirm neither, surface a LOUD "check / square off now" state.
    const fin = await kiteFetch(db, `${KITE_BASE}/orders/${encodeURIComponent(buyOrderId)}`, { headers: kiteHeaders });
    const finLast = (fin.ok && fin.body?.data) ? fin.body.data[fin.body.data.length - 1] : null;
    if (finLast && (finLast.filled_quantity || 0) > 0) {
      fillPrice = finLast.average_price;
      filledQty = finLast.filled_quantity;
      if (filledQty < qty) await cancelOrder(db, kiteHeaders, buyOrderId).catch(() => {}); // kill unfilled remainder
      result.steps.push({ step: 'late_fill_recovered', ok: true, recovered: 'after_timeout', fill_price: fillPrice, filled_qty: filledQty });
    } else {
      // Nothing filled yet — cancel the pending buy, then re-check for a fill that raced the cancel.
      const cancel = await cancelOrder(db, kiteHeaders, buyOrderId).catch(() => ({ ok: false }));
      const rc = await kiteFetch(db, `${KITE_BASE}/orders/${encodeURIComponent(buyOrderId)}`, { headers: kiteHeaders });
      const rcLast = (rc.ok && rc.body?.data) ? rc.body.data[rc.body.data.length - 1] : null;
      if (rcLast && (rcLast.filled_quantity || 0) > 0) {
        fillPrice = rcLast.average_price;
        filledQty = rcLast.filled_quantity;
        result.steps.push({ step: 'late_fill_recovered', ok: true, recovered: 'after_cancel', fill_price: fillPrice, filled_qty: filledQty });
      } else if (cancel.ok || ['CANCELLED', 'REJECTED'].includes(rcLast?.status)) {
        await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, buy_status='UNFILLED_CANCELLED', completed_at=? WHERE id=?`)
          .bind('Fill timeout — pending buy cancelled, no position taken', Date.now(), bracketRowId).run();
        result.steps.push({ step: 'fill_timeout_cancelled', ok: true });
        return { ...result, ok: false, error: 'Fill not confirmed in 12s; pending buy was cancelled — no position taken.' };
      } else {
        await db.prepare(`UPDATE kite_bracket_orders SET step='unconfirmed_no_stop', error=?, buy_status='UNCONFIRMED', completed_at=? WHERE id=?`)
          .bind('Fill timeout — neither fill nor cancel confirmed', Date.now(), bracketRowId).run();
        result.steps.push({ step: 'fill_unconfirmed', ok: false, error: 'fill_unconfirmed' });
        return {
          ...result, ok: false, error: 'fill_unconfirmed_check_now',
          naked_risk: true, action_required: 'CHECK_AND_SQUAREOFF', buy_order_id: buyOrderId,
          warning: `⚠️ ${symbol}: buy ${buyOrderId} was neither confirmed filled NOR cancelled in time. If it fills you will hold ~${qty} with NO stop. Open Kite NOW — square off or place a stop.`,
        };
      }
    }
  }
  result.steps.push({ step: 'filled', ok: true, fill_price: fillPrice, filled_qty: filledQty });
  await db.prepare(`UPDATE kite_bracket_orders SET buy_status='COMPLETE', fill_price_paise=?, fill_qty=?, step='filled' WHERE id=?`)
    .bind(Math.round(fillPrice * 100), filledQty, bracketRowId).run();

  // ─── Step 3: place GTT OCO with up to 3 retries ────────────
  // §6.4 stop-leg hardening. Kite's GTT trigger-orders accept ONLY order_type:LIMIT
  // (SL-M is NOT a valid GTT leg type — Kite rejects it), so a true SL-M cannot live
  // inside the GTT. A plain stop-LIMIT at the trigger price can be TRADED THROUGH on a
  // fast adverse gap → naked position (the 9-failure history). The fix that stays
  // within the GTT constraint: place the STOP leg's LIMIT price a buffer BELOW its
  // trigger (a marketable sell-limit) so when the stop fires it fills through a normal
  // gap instead of resting unfilled — SL-M-like behaviour. The TARGET leg stays a
  // plain LIMIT at target (we WANT it to rest for the better price). The buffer is
  // config-driven (gtt_stop_slip_pct, default 0.5%). The true SL-M order_type still
  // lives in the step-4 standalone fallback, where Kite DOES accept it.
  // Trade-off named: the stop fills near (not exactly at) the trigger on a gap — that
  // is the cost of guaranteeing the exit vs. risking an unfilled rest. Acceptable; an
  // unprotected naked position is the worse outcome.
  const slipRow = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='gtt_stop_slip_pct' LIMIT 1`
  ).first().catch(() => null);
  const stopSlipPct = slipRow ? (parseFloat(slipRow.config_value) || 0.5) : 0.5;
  const tickSize = 0.05;   // NSE/NFO default tick; rounding keeps the price valid.
  const rawStopLimit = stopPrice * (1 - stopSlipPct / 100);
  const stopLimitPrice = Math.max(tickSize, Math.round(rawStopLimit / tickSize) * tickSize);
  let gttId = null;
  let gttLastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const gttForm = new URLSearchParams({
      type: 'two-leg',
      condition: JSON.stringify({
        exchange, tradingsymbol: symbol,
        last_price: fillPrice,
        trigger_values: [stopPrice, targetPrice],
      }),
      orders: JSON.stringify([
        // STOP leg: LIMIT priced BELOW the trigger (SL-M-emulating marketable limit).
        { exchange, tradingsymbol: symbol, transaction_type: 'SELL', quantity: filledQty,
          order_type: 'LIMIT', product: body.product, price: Number(stopLimitPrice.toFixed(2)) },
        // TARGET leg: plain LIMIT at target (rests for the better price).
        { exchange, tradingsymbol: symbol, transaction_type: 'SELL', quantity: filledQty,
          order_type: 'LIMIT', product: body.product, price: targetPrice },
      ]),
    });
    const r = await kiteFetch(db, `${KITE_BASE}/gtt/triggers`, {
      method: 'POST',
      headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: gttForm.toString(),
    });
    if (r.ok && r.body?.status === 'success') {
      gttId = r.body.data.trigger_id;
      result.steps.push({ step: 'gtt_placed', ok: true, gtt_id: gttId, attempt });
      break;
    }
    gttLastError = r.body?.message || `HTTP ${r.status}`;
    if (attempt < 3) await new Promise(res => setTimeout(res, attempt * 1000));
  }

  if (gttId) {
    await db.prepare(`UPDATE kite_bracket_orders SET gtt_id=?, gtt_attempts=?, step='complete', completed_at=? WHERE id=?`)
      .bind(gttId, 3, Date.now(), bracketRowId).run();
    return { ...result, ok: true, fill_price: fillPrice, gtt_id: gttId, fallback_used: false };
  }

  // ─── Step 4: GTT failed — fallback to single-leg SL-M (2 attempts) ─────────
  // Fix #4b: a filled position with no stop is the worst outcome, so retry the
  // SL-M once, and if it STILL fails surface a loud, structured naked-position
  // state the app can act on — not just a warning string.
  result.steps.push({ step: 'gtt_failed', ok: false, error: gttLastError });
  await db.prepare(`UPDATE kite_bracket_orders SET gtt_attempts=3, gtt_last_error=?, step='gtt_failed_fallback_sl' WHERE id=?`)
    .bind(gttLastError, bracketRowId).run();

  let slOk = false, slOrderId = null, slLastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const slForm = new URLSearchParams({
      exchange, tradingsymbol: symbol,
      transaction_type: 'SELL', quantity: String(filledQty),
      product: body.product,
      order_type: 'SL-M', validity: 'DAY',
      trigger_price: String(stopPrice),
      tag: tag + '_SL',
    });
    const slR = await kiteFetch(db, `${KITE_BASE}/orders/regular`, {
      method: 'POST',
      headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: slForm.toString(),
    });
    slOk = slR.ok && slR.body?.status === 'success';
    if (slOk) { slOrderId = slR.body.data.order_id; break; }
    slLastError = slR.body?.message || `HTTP ${slR.status}`;
    if (attempt < 2) await new Promise(res => setTimeout(res, 1000));
  }
  result.steps.push({ step: 'fallback_sl_m', ok: slOk, order_id: slOrderId, error: slOk ? null : slLastError });
  await db.prepare(`UPDATE kite_bracket_orders SET fallback_sl_order_id=?, step=?, completed_at=? WHERE id=?`)
    .bind(slOrderId, slOk ? 'complete_with_fallback' : 'failed_no_stop', Date.now(), bracketRowId).run();

  if (slOk) {
    return {
      ...result, ok: true, fill_price: fillPrice, gtt_id: null,
      fallback_used: true, fallback_sl_order_id: slOrderId,
      warning: `GTT failed (${gttLastError}). Fallback SL-M stop placed at ₹${stopPrice}. NO target leg — set a target in Kite if you want one.`,
    };
  }
  // Both GTT and SL-M failed → a REAL position now exists with NO stop. Loud + actionable.
  return {
    ...result, ok: false, fill_price: fillPrice, gtt_id: null,
    fallback_used: true, fallback_sl_order_id: null,
    naked_position: true,
    action_required: 'PLACE_STOP_OR_SQUAREOFF',
    position: { tradingsymbol: symbol, exchange, qty: filledQty, fill_price: fillPrice, product: body.product },
    error: 'no_stop_naked_position',
    warning: `⚠️ BOUGHT ${filledQty} ${symbol} at ₹${fillPrice} but BOTH the GTT and the SL-M stop FAILED (${gttLastError}; ${slLastError}). You are holding an UNPROTECTED position — open Kite NOW and square off or place a stop.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// P2: order_margins — pre-trade margin requirement check
// ═══════════════════════════════════════════════════════════════════════════
async function orderMargins(env, db, kiteHeaders, body) {
  // body = { orders: [{exchange, tradingsymbol, transaction_type, variety, product, order_type, quantity, price, trigger_price}, ...] }
  const orders = Array.isArray(body) ? body : (body.orders || [body]);
  if (orders.length === 0) return { ok: false, error: 'orders array required' };

  const r = await kiteFetch(db, `${KITE_BASE}/margins/orders`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(orders),
  });
  if (!r.ok || r.body?.status !== 'success') {
    return { ok: false, error: r.body?.message || `HTTP ${r.status}` };
  }
  return { ok: true, data: r.body.data };
}

// ═══════════════════════════════════════════════════════════════════════════
// §6.3 NFO buyer-only gate — the three hard rules that close the catastrophic
// options space by construction. Returns { ok:true } to allow, or { ok:false, … }
// with a verbatim reason to REFUSE. Never throws (so a SIM run sees the refusal,
// not a 500).
// ═══════════════════════════════════════════════════════════════════════════
async function nfoBuyerGate(env, db, kiteHeaders, body) {
  const symbol = String(body.tradingsymbol || '').toUpperCase();

  // Rule 0 — resolve the instrument so we know lot_size + expiry + type. Without
  // it we cannot enforce qty=N×lot or the expiry-day reject → refuse (fail-safe).
  const lk = await instrumentLookup(db, body.tradingsymbol, 'NFO').catch(() => ({ ok: false }));
  if (!lk.ok || !lk.instrument) {
    return {
      ok: false, error: 'nfo_instrument_unresolved',
      message: `NFO instrument ${symbol} not found in kite_instruments. Run sync_instruments (now pulls NFO) then retry. No order sent.`,
    };
  }
  const inst = lk.instrument;
  const instType = String(inst.instrument_type || '').toUpperCase();   // CE | PE | FUT
  const lotSize = Number(inst.lot_size) || 0;
  const name = String(inst.name || '').toUpperCase();

  // Rule 3a — index weeklies only (cash-settled). Whitelist by underlying NAME
  // prefix (NIFTY/BANKNIFTY/…); a stock option's name is the stock → rejected.
  const wlRow = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='nfo_index_whitelist' LIMIT 1`
  ).first().catch(() => null);
  const whitelist = (wlRow?.config_value || 'NIFTY,BANKNIFTY,FINNIFTY,MIDCPNIFTY')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const isIndex = whitelist.some(w => name === w || symbol.startsWith(w));
  if (!isIndex) {
    return {
      ok: false, error: 'nfo_not_index_whitelist',
      message: `${symbol} (underlying '${inst.name}') is not a whitelisted index weekly. Stock options are physically settled (delivery risk in lakhs) — index options only. Allowed: ${whitelist.join(', ')}. No order sent.`,
    };
  }

  // Rule 2 — buyer-only: refuse an OPENING SELL on NFO unless a matching long is
  // held (selling to CLOSE an existing long is fine; opening a short = writing).
  if (body.transaction_type === 'SELL') {
    let heldLong = 0;
    try {
      const r = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: kiteHeaders });
      const j = await r.json().catch(() => ({}));
      const pos = ((j.data && j.data.net) || []).find(p => p.tradingsymbol === body.tradingsymbol);
      if (pos) heldLong = pos.quantity || 0;
    } catch { heldLong = 0; }
    if (heldLong <= 0) {
      return {
        ok: false, error: 'nfo_opening_sell_blocked',
        message: `Refused: opening SELL on ${symbol} = option WRITING (unbounded risk, needs SPAN margin). Buyer-only. A SELL is allowed only to close a held long (held: ${heldLong}). No order sent.`,
      };
    }
    if (Math.abs(body.quantity) > heldLong) {
      return {
        ok: false, error: 'nfo_sell_exceeds_long',
        message: `Refused: SELL ${body.quantity} exceeds the held long of ${heldLong} ${symbol} — the excess would open a naked short. No order sent.`,
      };
    }
  }

  // Rule — qty must be an exact multiple of lot_size (Nifty 65 / BankNifty 30 etc.,
  // read LIVE from kite_instruments, never hardcoded).
  if (lotSize > 0 && (body.quantity % lotSize) !== 0) {
    return {
      ok: false, error: 'nfo_qty_not_lot_multiple',
      lot_size: lotSize,
      message: `Refused: quantity ${body.quantity} is not a multiple of the lot size ${lotSize} for ${symbol}. Order qty on NFO must be N × ${lotSize}. No order sent.`,
    };
  }

  // Rule 3b — never trade into expiry day (an OTM weekly can decay to ₹0 in-session).
  if (inst.expiry) {
    const istNow = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const expiry = String(inst.expiry).slice(0, 10);
    if (expiry === istNow && !body.bypass_expiry_day) {
      return {
        ok: false, error: 'nfo_expiry_day_blocked',
        expiry, message: `Refused: ${symbol} expires TODAY (${expiry}). An expiry-day OTM option can decay to ₹0 in-session — use a next-week expiry. No order sent.`,
      };
    }
  }

  // Rule 1 — order_margins.total cap: > ₹2k blocks (catches writing / wrong product
  // that demands SPAN margin; a single capped-premium long lot is well under). Only
  // enforced for entries (BUY). On any margin-calc failure, fail-safe REFUSE.
  if (body.transaction_type === 'BUY') {
    const capRow = await db.prepare(
      `SELECT config_value FROM user_config WHERE config_key='nfo_option_margin_cap_paise' LIMIT 1`
    ).first().catch(() => null);
    const capPaise = capRow ? parseInt(capRow.config_value, 10) : 200000;   // ₹2000
    let totalPaise = null;
    try {
      const m = await orderMargins(env, db, kiteHeaders, {
        orders: [{
          exchange: 'NFO', tradingsymbol: body.tradingsymbol, transaction_type: 'BUY',
          variety: body.variety || 'regular', product: body.product,
          order_type: body.order_type || 'MARKET', quantity: body.quantity,
          price: body.price != null ? Number(body.price) : 0,
        }],
      });
      const leg = (m && m.ok && Array.isArray(m.data)) ? m.data[0] : null;
      if (leg && leg.total != null) totalPaise = Math.round(Number(leg.total) * 100);
    } catch { totalPaise = null; }
    // In SIM with no live token we may not get a margin; allow SIM through ONLY
    // when explicitly simulating, since the real-order path will re-run this gate.
    if (totalPaise == null && !(body.simulate === true || body.simulate === '1')) {
      return {
        ok: false, error: 'nfo_margin_unverified',
        message: `Could not verify option margin with Kite for ${symbol} — real order NOT sent (fail-safe). Retry once the margin check succeeds.`,
      };
    }
    if (totalPaise != null && totalPaise > capPaise) {
      return {
        ok: false, error: 'nfo_margin_over_cap',
        total_paise: totalPaise, cap_paise: capPaise,
        message: `Refused: ${symbol} order margin is ₹${Math.round(totalPaise / 100)} which exceeds the ₹${Math.round(capPaise / 100)} option cap. A high margin means this is NOT a simple capped-premium long buy (likely writing / wrong product). No order sent.`,
      };
    }
  }

  return { ok: true, lot_size: lotSize, instrument_type: instType, expiry: inst.expiry || null };
}

// ═══════════════════════════════════════════════════════════════════════════
// P3: instrument_lookup + sync_instruments
// ═══════════════════════════════════════════════════════════════════════════
async function instrumentLookup(db, symbol, exchange) {
  const r = await db.prepare(
    `SELECT * FROM kite_instruments WHERE tradingsymbol=? AND exchange=? LIMIT 1`
  ).bind(symbol, exchange).first();
  if (r) return { ok: true, instrument: r };
  return { ok: false, error: `Instrument not found: ${exchange}:${symbol}. Run /api/kite?action=sync_instruments to refresh.` };
}

// §6.3: sync instruments for NSE (equity) AND NFO (options/futures) so option
// symbols + lot_size + expiry are resolvable. Default pulls both; pass an explicit
// exchange (?exchange=NSE) to sync just one. NFO is large (~80–100k rows) but the
// 7-row batched insert keeps each statement under the D1 param cap; a single CSV
// fetch + batched writes stays within the Worker subrequest limit.
async function syncInstruments(env, db, kiteHeaders, only) {
  const exchanges = only ? [String(only).toUpperCase()] : ['NSE', 'NFO'];
  const perExchange = {};
  let totalWritten = 0;
  for (const exch of exchanges) {
    const res = await syncOneExchange(env, db, kiteHeaders, exch);
    perExchange[exch] = res;
    if (res.ok) totalWritten += res.written || 0;
  }
  return { ok: Object.values(perExchange).some(r => r.ok), written: totalWritten, exchanges: perExchange };
}

async function syncOneExchange(env, db, kiteHeaders, exchange) {
  const r = await fetch(`${KITE_BASE}/instruments/${exchange}`, { headers: kiteHeaders });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, exchange };
  const csv = await r.text();
  const lines = csv.split('\n');
  if (lines.length < 2) return { ok: false, error: 'empty CSV', exchange };

  // Parse header
  const headers = lines[0].split(',').map(s => s.trim());
  const idx = (n) => headers.indexOf(n);
  const iToken = idx('instrument_token');
  const iExchToken = idx('exchange_token');
  const iSym = idx('tradingsymbol');
  const iName = idx('name');
  const iLast = idx('last_price');
  const iExp = idx('expiry');
  const iStrike = idx('strike');
  const iTick = idx('tick_size');
  const iLot = idx('lot_size');
  const iType = idx('instrument_type');
  const iSeg = idx('segment');
  const iExch = idx('exchange');

  const refreshedAt = Date.now();
  let written = 0;
  // Batch rows per insert (D1 param limit)
  const BATCH = 7;  // D1 param cap ~100 → 7 rows × 13 cols = 91 params
  for (let s = 1; s < lines.length; s += BATCH) {
    const batch = lines.slice(s, s + BATCH).filter(l => l.trim());
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const sql = `INSERT OR REPLACE INTO kite_instruments
      (instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,
       tick_size,lot_size,instrument_type,segment,exchange,refreshed_at)
      VALUES ${placeholders}`;
    const params = [];
    for (const line of batch) {
      const c = line.split(',').map(x => x.replace(/^"|"$/g, ''));
      params.push(
        parseInt(c[iToken]) || 0,
        parseInt(c[iExchToken]) || null,
        c[iSym] || '',
        c[iName] || null,
        parseFloat(c[iLast]) || null,
        c[iExp] || null,
        parseFloat(c[iStrike]) || null,
        parseFloat(c[iTick]) || null,
        parseInt(c[iLot]) || null,
        c[iType] || null,
        c[iSeg] || null,
        c[iExch] || exchange,
        refreshedAt
      );
    }
    try {
      const ins = await db.prepare(sql).bind(...params).run();
      written += ins.meta?.changes || 0;
    } catch (e) {
      // continue with next batch
    }
  }
  return { ok: true, written, total_lines: lines.length - 1, exchange };
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILE LAYER — pulls Kite state into D1 so dashboard is always in sync
// ═══════════════════════════════════════════════════════════════════════════

// Pull Kite holdings + write to kite_holdings_live + sync into position_watchlist
async function reconcileHoldings(env, db, kiteHeaders) {
  const t0 = Date.now();
  const r = await fetch(`${KITE_BASE}/portfolio/holdings`, { headers: kiteHeaders });
  const j = await r.json();
  await logKite(db, '/portfolio/holdings', 'GET', r.status, Date.now() - t0, r.ok ? null : (j.message || ''));
  if (!r.ok || !j.data) return { ok: false, error: j.message || 'No holdings data' };

  // Clear old snapshot, write new one
  await db.prepare('DELETE FROM kite_holdings_live').run();
  const refreshedAt = Date.now();
  let written = 0;
  for (const h of j.data) {
    const ltp = Math.round((h.last_price || 0) * 100);
    const avg = Math.round((h.average_price || 0) * 100);
    const qty = h.quantity || 0;
    const mv = ltp * qty;
    const pnl = (ltp - avg) * qty;
    await db.prepare(
      `INSERT OR REPLACE INTO kite_holdings_live
       (symbol,exchange,isin,quantity,avg_price_paise,ltp_paise,market_value_paise,pnl_paise,
        day_change_pct,total_return_pct,product,collateral_qty,refreshed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      h.tradingsymbol, h.exchange, h.isin || null, qty, avg, ltp, mv, pnl,
      h.day_change_percentage ?? null,
      avg ? ((ltp - avg) / avg * 100) : null,
      h.product || 'CNC', h.collateral_quantity || 0,
      refreshedAt
    ).run();
    written++;
  }
  return { ok: true, holdings: written };
}

// Pull Kite margins/funds → kite_funds_live
async function reconcileFunds(env, db, kiteHeaders) {
  const t0 = Date.now();
  const r = await fetch(`${KITE_BASE}/user/margins`, { headers: kiteHeaders });
  const j = await r.json();
  await logKite(db, '/user/margins', 'GET', r.status, Date.now() - t0, r.ok ? null : (j.message || ''));
  if (!r.ok || !j.data) return { ok: false, error: j.message || 'No margin data' };

  const refreshedAt = Date.now();
  for (const seg of ['equity', 'commodity']) {
    const m = j.data[seg];
    if (!m) continue;
    const available = m.available || {};
    const utilised = m.utilised || {};
    const cashAvail = (available.cash || 0) + (available.intraday_payin || 0);
    const used = utilised.debits || 0;
    const total = m.net || cashAvail;
    await db.prepare(
      `INSERT OR REPLACE INTO kite_funds_live
       (segment, available_cash_paise, used_margin_paise, total_collateral_paise,
        available_total_paise, refreshed_at, raw_json)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      seg,
      Math.round(cashAvail * 100),
      Math.round(used * 100),
      Math.round((available.collateral || 0) * 100),
      Math.round(total * 100),
      refreshedAt,
      JSON.stringify(m)
    ).run();
  }
  return { ok: true };
}

// Pull today's order book → kite_orders_log
async function reconcileOrders(env, db, kiteHeaders) {
  const t0 = Date.now();
  const r = await fetch(`${KITE_BASE}/orders`, { headers: kiteHeaders });
  const j = await r.json();
  await logKite(db, '/orders', 'GET', r.status, Date.now() - t0, r.ok ? null : (j.message || ''));
  if (!r.ok || !j.data) return { ok: false, error: j.message || 'No orders data' };

  const now = Date.now();
  let written = 0;
  for (const o of j.data) {
    await db.prepare(
      `INSERT OR REPLACE INTO kite_orders_log
       (order_id, exchange, tradingsymbol, transaction_type, quantity, filled_quantity,
        pending_quantity, cancelled_quantity, order_type, product, validity,
        price_paise, trigger_price_paise, average_price_paise, status, status_message,
        tag, parent_order_id, placed_at, last_update_ts, exchange_timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      o.order_id, o.exchange, o.tradingsymbol, o.transaction_type, o.quantity,
      o.filled_quantity || 0, o.pending_quantity || 0, o.cancelled_quantity || 0,
      o.order_type, o.product, o.validity,
      Math.round((o.price || 0) * 100),
      Math.round((o.trigger_price || 0) * 100),
      Math.round((o.average_price || 0) * 100),
      o.status, o.status_message || null, o.tag || null, o.parent_order_id || null,
      Date.parse(o.order_timestamp) || now, now,
      Date.parse(o.exchange_timestamp) || null
    ).run();
    written++;
  }
  return { ok: true, orders: written };
}

// Pull today's trades (actual fills) → kite_trades
async function reconcileTrades(env, db, kiteHeaders) {
  const t0 = Date.now();
  const r = await fetch(`${KITE_BASE}/trades`, { headers: kiteHeaders });
  const j = await r.json();
  await logKite(db, '/trades', 'GET', r.status, Date.now() - t0, r.ok ? null : (j.message || ''));
  if (!r.ok || !j.data) return { ok: false, error: j.message || 'No trades data' };

  let written = 0;
  for (const t of j.data) {
    await db.prepare(
      `INSERT OR REPLACE INTO kite_trades
       (trade_id, order_id, exchange, tradingsymbol, transaction_type, quantity,
        average_price_paise, product, filled_at, exchange_timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      t.trade_id, t.order_id, t.exchange, t.tradingsymbol, t.transaction_type,
      t.quantity, Math.round((t.average_price || 0) * 100),
      t.product, Date.parse(t.fill_timestamp) || Date.now(),
      Date.parse(t.exchange_timestamp) || null
    ).run();
    written++;
  }
  return { ok: true, trades: written };
}

// Pull live intraday/positions book → kite_positions_live (track + square-off).
// Net positions with live P&L. The app reads the latest snapshot; square_off acts on it.
async function reconcilePositions(env, db, kiteHeaders) {
  const t0 = Date.now();
  const r = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: kiteHeaders });
  const j = await r.json();
  await logKite(db, '/portfolio/positions', 'GET', r.status, Date.now() - t0, r.ok ? null : (j.message || ''));
  if (!r.ok || !j.data) return { ok: false, error: j.message || 'No positions data' };
  const net = j.data.net || [];
  const now = Date.now();
  const today = new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);
  let written = 0;
  for (const p of net) {
    await db.prepare(
      `INSERT INTO kite_positions_live
        (snapshot_at, trade_date, tradingsymbol, exchange, product, quantity, buy_qty, sell_qty,
         avg_price_paise, last_price_paise, pnl_paise, m2m_paise, realised_paise, unrealised_paise, raw_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      now, today, p.tradingsymbol, p.exchange, p.product,
      p.quantity || 0, p.buy_quantity || 0, p.sell_quantity || 0,
      Math.round((p.average_price || 0) * 100), Math.round((p.last_price || 0) * 100),
      Math.round((p.pnl || 0) * 100), Math.round((p.m2m || 0) * 100),
      Math.round((p.realised || 0) * 100), Math.round((p.unrealised || 0) * 100),
      JSON.stringify(p).slice(0, 2000)
    ).run();
    written++;
  }
  return { ok: true, positions: net.length, written, snapshot_at: now };
}

// Square off a live position — opposite MARKET order for the net qty (owner one-tap exit).
// Respects the same block_real_orders gate as a manual buy; routes through the box proxy.
// §6.2: PARTIAL exit — pass body.quantity to sell only part of the net (the rest
// stays open + its GTT must be resized by the caller via modify_order). A square-off
// is an EXIT, so it routes with is_exit + bypass_funds_check default true (else a
// flatten is wrongly refused at cash=0). Pass bypass_funds_check:false to force the check.
async function squareOff(env, db, kiteHeaders, body) {
  const { tradingsymbol, exchange = 'NSE', product = 'MIS' } = body || {};
  if (!tradingsymbol) return { ok: false, error: 'tradingsymbol required' };
  let netQty = null;          // signed net for direction
  let qty = body.quantity ? Math.abs(Number(body.quantity)) : null;   // requested (partial) magnitude
  // Always resolve the live net so we know the direction and can validate the partial qty.
  {
    const r = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: kiteHeaders });
    const j = await r.json().catch(() => ({}));
    const pos = ((j.data && j.data.net) || []).find(
      p => p.tradingsymbol === tradingsymbol && p.product === product && (p.quantity || 0) !== 0
    );
    if (pos) netQty = pos.quantity;
  }
  // If no explicit qty was given, flatten the whole net.
  if (qty == null) {
    if (netQty == null || netQty === 0) return { ok: false, error: 'no_open_position', tradingsymbol };
    qty = Math.abs(netQty);
  } else {
    // Partial: cap the requested magnitude at the live net so we never oversell.
    if (netQty != null && qty > Math.abs(netQty)) qty = Math.abs(netQty);
  }
  if (!qty || qty === 0) return { ok: false, error: 'no_qty', tradingsymbol };
  // Direction = opposite of the net (long→SELL, short→BUY). If net is unknown
  // (positions read failed), fall back to SELL — the common long-exit case.
  const side = (netQty != null ? netQty : 1) > 0 ? 'SELL' : 'BUY';
  const partial = netQty != null && qty < Math.abs(netQty);
  const res = await placeOrder(env, db, kiteHeaders, {
    exchange, tradingsymbol, transaction_type: side, quantity: qty,
    product, order_type: 'MARKET', validity: 'DAY', tag: body.tag || 'HN_WE_SQOFF',
    is_exit: true,                                                   // direction-aware: skip fund-check
    bypass_funds_check: body.bypass_funds_check !== false,           // default true for exits
    bypass_block: body.bypass_block === true,
    bypass_market_hours: body.bypass_market_hours === true,          // for SIM proving; Kite still gates real off-hours
    simulate: body.simulate === true || body.simulate === '1',
  });
  await reconcilePositions(env, db, kiteHeaders).catch(() => {});
  // ok when the order was accepted (or a dedupe suppressed a genuine double-fire);
  // not-ok when blocked or errored — same contract as before, plus deduped=success.
  const ok = res.deduped === true || (!res.blocked && !res.error && res.ok !== false);
  return {
    ok,
    squared: { tradingsymbol, qty, side, partial, net_before: netQty },
    order: res,
  };
}

// §6.2: square_off_all — the panic button. Loop the LIVE net positions (BOTH MIS
// and CNC/NRML — squareOff defaults MIS, so a CNC/NRML holding is missed otherwise)
// and fire an opposite MARKET for each non-zero net, with one per-leg retry. Returns
// exactly which positions were squared and which REMAIN open (the loud list). Exits
// skip the fund-check by construction (via squareOff), so cash=0 never blocks a flatten.
async function squareOffAll(env, db, kiteHeaders, body = {}) {
  const r = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: kiteHeaders });
  const j = await r.json().catch(() => ({}));
  await logKite(db, '/portfolio/positions', 'GET', r.status, 0, r.ok ? null : 'square_off_all read');
  const net = (j.data && j.data.net) || [];
  const open = net.filter(p => (p.quantity || 0) !== 0);
  const squared = [];
  const remaining = [];
  for (const p of open) {
    let done = false, lastErr = null, lastOrder = null;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const so = await squareOff(env, db, kiteHeaders, {
        tradingsymbol: p.tradingsymbol,
        exchange: p.exchange,
        product: p.product,
        bypass_block: body.bypass_block === true,
        bypass_market_hours: body.bypass_market_hours === true,
        simulate: body.simulate === true || body.simulate === '1',
        // distinct tag per attempt-symbol so the dedupe in placeOrder does not
        // suppress a genuine retry of a DIFFERENT symbol, but DOES suppress an
        // accidental double-fire of the same leg within the window.
        tag: `HN_WE_SQALL_${p.tradingsymbol}`.slice(0, 20),
      });
      lastOrder = so;
      if (so.ok === true || so.order?.deduped) { done = true; break; }
      lastErr = so.order?.error || so.error || 'unknown';
      if (attempt < 2) await new Promise(res => setTimeout(res, 800));
    }
    if (done) squared.push({ tradingsymbol: p.tradingsymbol, product: p.product, qty: Math.abs(p.quantity), order: lastOrder });
    else remaining.push({ tradingsymbol: p.tradingsymbol, product: p.product, qty: Math.abs(p.quantity), error: lastErr });
  }
  await reconcilePositions(env, db, kiteHeaders).catch(() => {});
  return {
    ok: remaining.length === 0,
    flat: remaining.length === 0,
    total_open: open.length,
    squared, remaining,
    message: remaining.length === 0
      ? (open.length === 0 ? 'Book already flat — no open positions.' : `Squared ${squared.length} position(s). Book is flat.`)
      : `⚠️ ${remaining.length} position(s) STILL OPEN after square-off-all: ${remaining.map(x => `${x.tradingsymbol}(${x.product})`).join(', ')}. Retry or square manually in Kite NOW.`,
  };
}

// ── ONE-TIME PIPELINE SMOKE TEST ──────────────────────────────────────────────
// Places a tiny BUY then immediately exits with a SELL, polling each fill, and
// returns a transparent step log so a failure shows EXACTLY where it broke. On a
// confirmed round-trip it stamps user_config.pipeline_test_passed (the app then hides
// the test card). simulate=true runs the wiring with NO real order.
async function pollOrder(kiteHeaders, orderId, tries = 6) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 700));
    try {
      const r = await fetch(`${KITE_BASE}/orders/${encodeURIComponent(orderId)}`, { headers: kiteHeaders });
      const j = await r.json();
      const legs = j.data || [];
      last = legs[legs.length - 1] || last;
      if (last && ['COMPLETE', 'REJECTED', 'CANCELLED'].includes(last.status)) return last;
    } catch {}
  }
  return last;
}

async function pipelineTest(env, db, kiteHeaders, body) {
  const symbol = String(body.symbol || 'IDEA').toUpperCase();   // ultra-cheap, ultra-liquid → ~₹8 test
  const qty = Math.max(1, parseInt(body.qty, 10) || 1);
  const simulate = body.simulate === true || body.simulate === '1';
  const steps = [];
  const add = (name, ok, detail, raw) => { steps.push({ name, ok, detail, raw: raw ?? null, at: Date.now() }); return ok; };

  if (simulate) {
    add('connect', true, 'Broker connection reachable (simulated path).');
    add('place_buy', true, `Would BUY ${qty} ${symbol} at market (MIS) — no real order sent.`);
    add('confirm_buy', true, 'Simulated fill.');
    add('exit_sell', true, `Would SELL ${qty} ${symbol} at market (MIS) — no real order sent.`);
    add('confirm_exit', true, 'Simulated exit fill.');
    return { ok: true, simulate: true, overall: 'pass_simulated', symbol, qty, steps,
      summary: `Wiring OK (simulated — nothing was sent to the broker). Run the live test at market open to confirm a real fill.` };
  }

  // 1 — BUY (real, tiny)
  // No-regression: pipelineTest is the 1-share headline-fill probe; it previously
  // reached Kite directly with no fund-check. Keep that exact behavior — bypass the
  // new entry fund-check here (the order is already bounded to ~₹14 and is the sacred
  // first-fill path). It still flows through the unified door (kiteFetch + logging).
  const buy = await placeOrder(env, db, kiteHeaders, {
    exchange: 'NSE', tradingsymbol: symbol, transaction_type: 'BUY', quantity: qty,
    product: 'MIS', order_type: 'MARKET', validity: 'DAY', tag: 'HN_WE_PIPETEST',
    bypass_funds_check: true,
  });
  if (buy.blocked) { add('place_buy', false, 'Real orders are OFF (practice mode). Turn on real orders to run the live test.', buy);
    return { ok: false, overall: 'blocked', symbol, qty, steps, summary: 'Real orders are blocked — this is the practice setting.' }; }
  if (!buy.ok) { add('place_buy', false, buy.error || 'Buy order was not accepted.', buy);
    return { ok: false, overall: 'fail', failed_step: 'place_buy', symbol, qty, steps, summary: `Could not place the buy: ${buy.error || 'unknown error'}` }; }
  add('place_buy', true, `Buy ${qty} ${symbol} sent (order ${buy.order_id}).`, buy);

  // 2 — confirm fill
  const bs = await pollOrder(kiteHeaders, buy.order_id);
  const buyFilled = bs?.status === 'COMPLETE';
  add('confirm_buy', buyFilled, buyFilled ? `Bought at ₹${bs.average_price}.` : `Buy status: ${bs?.status || 'unknown'}${bs?.status_message ? ' — ' + bs.status_message : ''}`, bs);
  if (bs && (bs.status === 'REJECTED' || bs.status === 'CANCELLED')) {
    return { ok: false, overall: 'fail', failed_step: 'confirm_buy', symbol, qty, steps,
      summary: `Buy ${bs.status}${bs.status_message ? ': ' + bs.status_message : ''}. Nothing to exit — no position taken.` };
  }

  // 3 — EXIT (SELL the same qty)
  const sell = await placeOrder(env, db, kiteHeaders, {
    exchange: 'NSE', tradingsymbol: symbol, transaction_type: 'SELL', quantity: qty,
    product: 'MIS', order_type: 'MARKET', validity: 'DAY', tag: 'HN_WE_PIPETESTX',
  });
  if (!sell.ok) { add('exit_sell', false, sell.error || 'Exit order was not accepted.', sell);
    return { ok: false, overall: 'fail', failed_step: 'exit_sell', symbol, qty, steps,
      summary: `Bought but the exit failed: ${sell.error || 'unknown'}. You may hold ${qty} ${symbol} — square it off from the position card.` }; }
  add('exit_sell', true, `Exit (sell ${qty} ${symbol}) sent (order ${sell.order_id}).`, sell);
  const ss = await pollOrder(kiteHeaders, sell.order_id);
  const sellFilled = ss?.status === 'COMPLETE';
  add('confirm_exit', sellFilled, sellFilled ? `Exited at ₹${ss.average_price}.` : `Exit status: ${ss?.status || 'unknown'}${ss?.status_message ? ' — ' + ss.status_message : ''}`, ss);

  const pass = buyFilled && sellFilled;
  if (pass) {
    const ist = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    await db.prepare(`INSERT OR REPLACE INTO user_config (config_key, config_value, updated_at) VALUES ('pipeline_test_passed', ?, ?)`)
      .bind(ist, Date.now()).run().catch(() => {});
  }
  return { ok: pass, overall: pass ? 'pass' : 'partial', symbol, qty, steps,
    summary: pass
      ? `Pipeline works end to end — bought and exited ${qty} ${symbol}. You're clear to trade. This check is now done and will disappear.`
      : `Order sent but the fill wasn't confirmed in time. Check the position card before trading.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// §6.5 — Execution Lab run/step recorder (diagnostics-first, one trail for all paths)
// ═══════════════════════════════════════════════════════════════════════════
// Every order path leaves the SAME structured, replayable trail in lab_runs +
// lab_steps. Generalizes pipelineTest's steps[] shape: { name, ok, detail, raw }.
// Written once at the choke point (the action handlers). Best-effort: a recorder
// failure must NEVER break the order itself, so every call site wraps in .catch.
//
//   recordRun(db, { scenario, kind, surface, mode, rung, symbol, qty, tag,
//                   status, maxLossPaise, intent, steps, rawError, actionRequired,
//                   bracketId, iosAuthOk })  → run_id
//   recordStep(db, runId, seq, step)  // step = { name, ok, detail, raw }
async function recordRun(db, r) {
  const now = new Date().toISOString();
  const steps = Array.isArray(r.steps) ? r.steps : [];
  // Derive a verbatim raw_error from the steps if not given (first failing step's raw).
  let rawError = r.rawError != null ? r.rawError : null;
  if (rawError == null) {
    const bad = steps.find(s => s && s.ok === false);
    if (bad) {
      const raw = bad.raw;
      rawError = (raw && (raw.message || raw.error)) || bad.detail || null;
    }
  }
  let runId = null;
  try {
    const ins = await db.prepare(
      `INSERT INTO lab_runs
        (scenario, kind, surface, mode, rung, symbol, qty, tag, status, max_loss_paise,
         intent_json, steps_json, raw_error, action_required, bracket_id, ios_auth_ok,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      String(r.scenario || ''), String(r.kind || 'unknown'), r.surface || null,
      String(r.mode || 'sim'), r.rung || (r.mode === 'tiny_real' ? 'tiny_real' : 'sim'),
      r.symbol || null, r.qty != null ? Number(r.qty) : null, r.tag || null,
      String(r.status || 'unknown'), r.maxLossPaise != null ? Number(r.maxLossPaise) : null,
      r.intent != null ? JSON.stringify(r.intent).slice(0, 8000) : null,
      steps.length ? JSON.stringify(steps).slice(0, 12000) : null,
      rawError != null ? String(rawError).slice(0, 2000) : null,
      r.actionRequired || null,
      r.bracketId != null ? Number(r.bracketId) : null,
      r.iosAuthOk != null ? (r.iosAuthOk ? 1 : 0) : null,
      now, now
    ).run();
    runId = ins.meta?.last_row_id ?? null;
  } catch (e) { return null; }
  // Persist each step row too (so a query can join, not just parse JSON).
  if (runId != null && steps.length) {
    let seq = 0;
    for (const s of steps) {
      seq++;
      await recordStep(db, runId, seq, s).catch(() => {});
    }
  }
  return runId;
}

async function recordStep(db, runId, seq, step) {
  try {
    await db.prepare(
      `INSERT INTO lab_steps (run_id, seq, name, ok, detail, raw_json, at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      runId, seq,
      step?.name || step?.step || null,
      step?.ok === true ? 1 : (step?.ok === false ? 0 : null),
      step?.detail != null ? String(step.detail).slice(0, 1000) : null,
      step?.raw != null ? JSON.stringify(step.raw).slice(0, 4000) : null,
      new Date().toISOString()
    ).run();
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function isNseRegularMarketOpen(nowMs = Date.now()) {
  const ist = new Date(nowMs + 5.5 * 3600000);
  const day = ist.getUTCDay(); // 0 Sun, 6 Sat after IST shift
  if (day === 0 || day === 6) return false;
  const hm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return hm >= 915 && hm <= 1530;
}

async function getActiveToken(db) {
  const r = await db.prepare(
    `SELECT * FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
  ).first();
  return r || null;
}

async function getStatus(db, env) {
  const tok = await getActiveToken(db);
  if (!tok) {
    return {
      connected: false, reason: 'no_token',
      api_key_configured: !!env.KITE_API_KEY,
      api_secret_configured: !!env.KITE_API_SECRET,
      login_url: '/wealth/auth/login',
    };
  }
  const now = Date.now();
  if (now > tok.expires_at) {
    return {
      connected: false, reason: 'expired',
      expired_at: tok.expires_at, user_name: tok.user_name,
      login_url: '/wealth/auth/login',
    };
  }
  return {
    connected: true,
    user_id: tok.user_id, user_name: tok.user_name, email: tok.email,
    obtained_at: tok.obtained_at, expires_at: tok.expires_at,
    expires_in_min: Math.round((tok.expires_at - now) / 60000),
  };
}

function buildInstrumentsQs(url) {
  const insts = url.searchParams.getAll('i');
  if (insts.length === 0) {
    const single = url.searchParams.get('instruments');
    if (single) return single.split(',').map(s => `i=${encodeURIComponent(s.trim())}`).join('&');
  }
  return insts.map(s => `i=${encodeURIComponent(s)}`).join('&');
}

async function proxyJson(targetUrl, kiteHeaders, db, respHeaders) {
  const t0 = Date.now();
  const r = await fetch(targetUrl, { headers: kiteHeaders });
  const dur = Date.now() - t0;
  let body;
  try { body = await r.json(); } catch { body = { error: 'kite_returned_non_json' }; }
  await logKite(db, targetUrl.replace(KITE_BASE, ''), 'GET', r.status, dur, r.ok ? null : (body.message || body.error_type));
  return new Response(JSON.stringify(body), { status: r.status, headers: respHeaders });
}

async function proxyText(targetUrl, kiteHeaders, db, respHeaders) {
  const t0 = Date.now();
  const r = await fetch(targetUrl, { headers: kiteHeaders });
  const dur = Date.now() - t0;
  const text = await r.text();
  await logKite(db, targetUrl.replace(KITE_BASE, ''), 'GET', r.status, dur, r.ok ? null : text.slice(0, 200));
  return new Response(text, { status: r.status, headers: { ...respHeaders, 'Content-Type': 'text/csv' }});
}

async function logKite(db, endpoint, method, status, durationMs, error) {
  try {
    await db.prepare(
      `INSERT INTO kite_api_log (endpoint,method,status,duration_ms,error,ts) VALUES (?,?,?,?,?,?)`
    ).bind(endpoint, method, status, durationMs, error, Date.now()).run();
  } catch (e) {}
}
