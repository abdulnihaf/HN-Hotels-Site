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
      return Response.json(await placeBracket(env, db, kiteHeaders, await request.json()), { headers });
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
      return Response.json(await syncInstruments(env, db, kiteHeaders), { headers });
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
    if (action === 'reconcile_all') {
      const [h, f, o, t] = await Promise.all([
        reconcileHoldings(env, db, kiteHeaders),
        reconcileFunds(env, db, kiteHeaders),
        reconcileOrders(env, db, kiteHeaders),
        reconcileTrades(env, db, kiteHeaders),
      ]);
      return Response.json({ holdings: h, funds: f, orders: o, trades: t }, { headers });
    }

    // ─────────────────────────────────────────────────────
    // WRITE actions (require POST)
    // ─────────────────────────────────────────────────────
    if (action === 'place_order') {
      if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers });
      return Response.json(await placeOrder(env, db, kiteHeaders, await request.json()), { headers });
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
// Defaults: product=CNC, order_type=MARKET, validity=DAY, variety=regular
async function placeOrder(env, db, kiteHeaders, body) {
  const required = ['exchange', 'tradingsymbol', 'transaction_type', 'quantity'];
  for (const f of required) {
    if (!body[f]) throw new Error(`Missing required field: ${f}`);
  }
  if (!['BUY','SELL'].includes(body.transaction_type)) throw new Error('transaction_type must be BUY or SELL');
  if (!Number.isInteger(body.quantity) || body.quantity < 1) throw new Error('quantity must be positive integer');

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

  const formData = new URLSearchParams({
    exchange: body.exchange,
    tradingsymbol: body.tradingsymbol,
    transaction_type: body.transaction_type,
    quantity: String(body.quantity),
    product: body.product || 'CNC',
    order_type: body.order_type || 'MARKET',
    validity: body.validity || 'DAY',
  });
  if (body.price != null) formData.set('price', String(body.price));
  if (body.trigger_price != null) formData.set('trigger_price', String(body.trigger_price));
  if (body.disclosed_quantity != null) formData.set('disclosed_quantity', String(body.disclosed_quantity));
  if (body.tag) formData.set('tag', String(body.tag).slice(0, 20));

  const variety = body.variety || 'regular';
  const url = `${KITE_BASE}/orders/${variety}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const j = await res.json();
  await logKite(db, `/orders/${variety} POST`, 'POST', res.status, Date.now() - t0, res.ok ? null : (j.message || j.error_type));

  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'Order failed', kite_response: j, http_status: res.status };
  }
  return { ok: true, order_id: j.data.order_id, kite_response: j };
}

// POST /api/kite?action=place_gtt
// Body:
//   { tradingsymbol, exchange, last_price, type='two-leg',
//     stop_trigger, stop_price, target_trigger, target_price,
//     quantity, transaction_type='SELL', product='CNC' }
// type='single' is also supported with single trigger_value + price.
async function placeGtt(env, db, kiteHeaders, body) {
  const required = ['tradingsymbol', 'exchange', 'last_price', 'quantity'];
  for (const f of required) {
    if (!body[f]) throw new Error(`Missing required field: ${f}`);
  }

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
        product: body.product || 'CNC',
        price: Number(body.stop_price || body.stop_trigger),
      },
      {
        exchange: body.exchange,
        tradingsymbol: body.tradingsymbol,
        transaction_type: body.transaction_type || 'SELL',
        quantity: body.quantity,
        order_type: 'LIMIT',
        product: body.product || 'CNC',
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
      product: body.product || 'CNC',
      price: Number(body.price),
    }];
  }

  const formData = new URLSearchParams({
    type: isOco ? 'two-leg' : 'single',
    condition: JSON.stringify(condition),
    orders: JSON.stringify(orders),
  });

  const t0 = Date.now();
  const res = await fetch(`${KITE_BASE}/gtt/triggers`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
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
  const res = await fetch(url, { method: 'DELETE', headers: kiteHeaders });
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
  const res = await fetch(url, { method: 'DELETE', headers: kiteHeaders });
  const j = await res.json();
  await logKite(db, `/gtt/triggers DELETE`, 'DELETE', res.status, Date.now() - t0, res.ok ? null : (j.message || ''));
  if (!res.ok || j.status !== 'success') {
    return { ok: false, error: j.message || 'GTT delete failed' };
  }
  return { ok: true };
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
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
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
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
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
  const symbol = body.tradingsymbol;
  const exchange = body.exchange;
  const qty = body.quantity;
  const stopPrice = parseFloat(body.stop_price);
  const targetPrice = parseFloat(body.target_price);
  const tag = body.tag || 'HN_WE_BRK';

  // Pre-launch guard
  const block = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='block_real_orders'`
  ).first();
  if (block?.config_value === '1' && !body.bypass_block) {
    return {
      ok: false, blocked: true,
      reason: 'shadow_run',
      message: 'Real orders blocked. Engine is in shadow mode (CPV pending). Set block_real_orders=0 to unlock.',
      simulated: {
        symbol, qty, stop_price: stopPrice, target_price: targetPrice,
        flow: '1) MARKET BUY → 2) wait for fill → 3) GTT OCO → 4) verify',
        would_have_executed: true,
      },
    };
  }

  // Create bracket-order tracking row
  const bracketRowId = (await db.prepare(
    `INSERT INTO kite_bracket_orders
       (symbol,exchange,qty,intended_stop_paise,intended_target_paise,step,created_at)
     VALUES (?,?,?,?,?,'starting',?)`
  ).bind(symbol, exchange, qty, Math.round(stopPrice * 100), Math.round(targetPrice * 100), Date.now()).run()).meta?.last_row_id;

  const result = { ok: false, bracket_id: bracketRowId, steps: [] };

  // ─── Step 1: place market buy ─────────────────────────────
  const buyForm = new URLSearchParams({
    exchange, tradingsymbol: symbol,
    transaction_type: 'BUY', quantity: String(qty),
    product: body.product || 'CNC',
    order_type: body.order_type || 'MARKET',
    validity: 'DAY', tag,
  });
  if (body.price != null) buyForm.set('price', String(body.price));

  const buyR = await kiteFetch(db, `${KITE_BASE}/orders/regular`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buyForm.toString(),
  });
  const buyJ = buyR.body || {};
  result.steps.push({ step: 'place_buy', ok: buyR.ok && buyJ.status === 'success', http: buyR.status, ...buyJ });

  if (!buyR.ok || buyJ.status !== 'success') {
    await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, completed_at=? WHERE id=?`)
      .bind(buyJ.message || `HTTP ${buyR.status}`, Date.now(), bracketRowId).run();
    return { ...result, error: buyJ.message || 'Buy order failed' };
  }
  const buyOrderId = buyJ.data.order_id;
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
    await db.prepare(`UPDATE kite_bracket_orders SET step='failed', error=?, buy_status='UNFILLED', completed_at=? WHERE id=?`)
      .bind('Fill timeout — order still pending', Date.now(), bracketRowId).run();
    result.steps.push({ step: 'fill_polling', ok: false, error: 'fill_timeout' });
    return { ...result, error: 'Order placed but fill not confirmed in 12s — check Kite manually' };
  }
  result.steps.push({ step: 'filled', ok: true, fill_price: fillPrice, filled_qty: filledQty });
  await db.prepare(`UPDATE kite_bracket_orders SET buy_status='COMPLETE', fill_price_paise=?, fill_qty=?, step='filled' WHERE id=?`)
    .bind(Math.round(fillPrice * 100), filledQty, bracketRowId).run();

  // ─── Step 3: place GTT OCO with up to 3 retries ────────────
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
        { exchange, tradingsymbol: symbol, transaction_type: 'SELL', quantity: filledQty,
          order_type: 'LIMIT', product: body.product || 'CNC', price: stopPrice },
        { exchange, tradingsymbol: symbol, transaction_type: 'SELL', quantity: filledQty,
          order_type: 'LIMIT', product: body.product || 'CNC', price: targetPrice },
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

  // ─── Step 4: GTT failed — fallback to single-leg SL-M ─────
  result.steps.push({ step: 'gtt_failed', ok: false, error: gttLastError });
  await db.prepare(`UPDATE kite_bracket_orders SET gtt_attempts=3, gtt_last_error=?, step='gtt_failed_fallback_sl' WHERE id=?`)
    .bind(gttLastError, bracketRowId).run();

  const slForm = new URLSearchParams({
    exchange, tradingsymbol: symbol,
    transaction_type: 'SELL', quantity: String(filledQty),
    product: body.product || 'CNC',
    order_type: 'SL-M',
    validity: 'DAY',
    trigger_price: String(stopPrice),
    tag: tag + '_SL',
  });
  const slR = await kiteFetch(db, `${KITE_BASE}/orders/regular`, {
    method: 'POST',
    headers: { ...kiteHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: slForm.toString(),
  });
  const slOk = slR.ok && slR.body?.status === 'success';
  const slOrderId = slOk ? slR.body.data.order_id : null;
  result.steps.push({ step: 'fallback_sl_m', ok: slOk, order_id: slOrderId, error: slOk ? null : slR.body?.message });
  await db.prepare(`UPDATE kite_bracket_orders SET fallback_sl_order_id=?, step=?, completed_at=? WHERE id=?`)
    .bind(slOrderId, slOk ? 'complete_with_fallback' : 'failed_no_stop', Date.now(), bracketRowId).run();

  return {
    ...result,
    ok: slOk,
    fill_price: fillPrice,
    gtt_id: null,
    fallback_used: true,
    fallback_sl_order_id: slOrderId,
    warning: slOk
      ? `GTT failed (${gttLastError}). Fallback SL-M placed. NO target — manually set target in Kite if desired.`
      : `GTT failed AND fallback SL-M failed. POSITION HAS NO STOP. Place stop manually in Kite immediately.`,
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
// P3: instrument_lookup + sync_instruments
// ═══════════════════════════════════════════════════════════════════════════
async function instrumentLookup(db, symbol, exchange) {
  const r = await db.prepare(
    `SELECT * FROM kite_instruments WHERE tradingsymbol=? AND exchange=? LIMIT 1`
  ).bind(symbol, exchange).first();
  if (r) return { ok: true, instrument: r };
  return { ok: false, error: `Instrument not found: ${exchange}:${symbol}. Run /api/kite?action=sync_instruments to refresh.` };
}

async function syncInstruments(env, db, kiteHeaders) {
  // Pull NSE instruments CSV from Kite
  const r = await fetch(`${KITE_BASE}/instruments/NSE`, { headers: kiteHeaders });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  const csv = await r.text();
  const lines = csv.split('\n');
  if (lines.length < 2) return { ok: false, error: 'empty CSV' };

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
  // Batch 50 rows per insert (D1 param limit)
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
        c[iExch] || 'NSE',
        refreshedAt
      );
    }
    try {
      const r = await db.prepare(sql).bind(...params).run();
      written += r.meta?.changes || 0;
    } catch (e) {
      // continue with next batch
    }
  }
  return { ok: true, written, total_lines: lines.length - 1 };
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

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
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
