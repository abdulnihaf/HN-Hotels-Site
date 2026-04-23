/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Money Events — read/write API for /ops/bank/.
 * Route:  /api/bank-feed
 * D1:     DB (hn-hiring), table money_events + money_source_health
 *         + money_recon_matches
 *
 * Sources supported: hdfc, razorpay, paytm, zomato_*, swiggy, eazydiner,
 *                    federal, manual.
 *
 *   GET /api/bank-feed?action=list
 *        &pin=XXXX
 *        [&limit=100 &source=hdfc &dir=credit|debit &status=unreconciled]
 *   GET /api/bank-feed?action=summary&pin=XXXX
 *        → per-instrument balance + today/7d/30d rollups + source staleness
 *   GET /api/bank-feed?action=health&pin=XXXX
 *        → money_source_health snapshot
 *   POST /api/bank-feed?action=reconcile&pin=XXXX
 *        body: { id, status, matched_expense_id?, matched_vendor_bill_id?,
 *                matched_payout_platform?, notes? }
 *
 * All endpoints require a valid PIN (query param or x-ops-pin header).
 * CORS is scoped to hnhotels.in origins — no credentialed * wildcard.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// Re-using PIN list shape from rm-admin.js. Keep in sync with other ops APIs.
// (Long-term: lift to a shared module; for now duplicated to avoid cross-
// function imports in Pages Functions.)
const PINS = {
  '0305': { name: 'Nihaf',  role: 'admin' },
  '3754': { name: 'Naveen', role: 'admin' },   // CFO
  '6045': { name: 'Faheem', role: 'ops'   },
  '3678': { name: 'Faheem', role: 'ops'   },
  '5882': { name: 'Nihaf',  role: 'admin' },   // legacy
  '2026': { name: 'Zoya',   role: 'ops'   },
};
const ROLE_RANK = { read: 0, ops: 1, admin: 2 };

const ALLOWED_ORIGINS = new Set([
  'https://hnhotels.in',
  'https://www.hnhotels.in',
  'http://localhost:8788',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://hnhotels.in';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function checkPin(pin, minRole = 'ops') {
  const u = PINS[pin];
  if (!u) return null;
  if ((ROLE_RANK[u.role] ?? -1) < (ROLE_RANK[minRole] ?? 99)) return null;
  return u;
}

function pinFromRequest(request, url) {
  return (
    request.headers.get('x-ops-pin') ||
    url.searchParams.get('pin') ||
    ''
  );
}

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request.headers.get('origin') || '') });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const user = checkPin(pinFromRequest(request, url), 'read');
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  const action = url.searchParams.get('action') || 'list';
  const db = env.DB;

  if (action === 'list') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const since = url.searchParams.get('since');
    const dir = url.searchParams.get('dir');
    const status = url.searchParams.get('status');
    const source = url.searchParams.get('source');
    const instrument = url.searchParams.get('instrument');
    const channel = url.searchParams.get('channel');
    const brand = url.searchParams.get('brand');
    const category = url.searchParams.get('category');
    const platform = url.searchParams.get('platform');         // settlement_platform
    const payeeId = url.searchParams.get('payee_id');
    const q = url.searchParams.get('q');                        // counterparty/narration/ref search
    const dateFrom = url.searchParams.get('date_from');         // ISO yyyy-mm-dd
    const dateTo = url.searchParams.get('date_to');
    const minAmt = url.searchParams.get('min_amount');          // in rupees
    const maxAmt = url.searchParams.get('max_amount');

    let sql = `SELECT me.id, me.source, me.source_ref, me.instrument, me.txn_at, me.received_at,
                      me.direction, me.amount_paise, me.balance_paise_after,
                      me.channel, me.counterparty, me.counterparty_ref, me.narration,
                      me.parse_status, me.reconcile_status,
                      me.matched_expense_id, me.matched_vendor_bill_id, me.matched_payout_platform,
                      me.matched_payee_id, me.brand, me.category, me.settlement_platform,
                      mp.name AS payee_name, mp.bank AS payee_bank, mp.last4 AS payee_last4
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE 1=1`;
    const binds = [];
    if (!status)                      sql += ` AND me.parse_status IN ('parsed','partial')`;
    if (since)                      { sql += ' AND (me.txn_at >= ? OR me.received_at >= ?)'; binds.push(since, since); }
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (status === 'unreconciled')    sql += ` AND me.reconcile_status='unreconciled' AND me.parse_status='parsed'`;
    if (status === 'reconciled')      sql += ` AND me.reconcile_status IN ('auto','manual')`;
    if (status === 'quarantined')     sql += ` AND me.parse_status IN ('failed','quarantined','partial')`;
    if (source)                     { sql += ' AND me.source=?';                  binds.push(source); }
    if (instrument)                 { sql += ' AND me.instrument=?';              binds.push(instrument); }
    if (channel)                    { sql += ' AND me.channel=?';                 binds.push(channel); }
    if (brand)                      { sql += ' AND me.brand=?';                   binds.push(brand); }
    if (category)                   { sql += ' AND me.category=?';                binds.push(category); }
    if (platform === 'direct')        sql += ' AND me.settlement_platform IS NULL';
    else if (platform)              { sql += ' AND me.settlement_platform=?';     binds.push(platform); }
    if (payeeId)                    { sql += ' AND me.matched_payee_id=?';        binds.push(parseInt(payeeId, 10)); }
    if (dateFrom)                   { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(dateFrom); }
    if (dateTo)                     { sql += ' AND COALESCE(me.txn_at, me.received_at) <= ?'; binds.push(dateTo + 'T23:59:59+05:30'); }
    if (minAmt)                     { sql += ' AND me.amount_paise >= ?';         binds.push(Math.round(parseFloat(minAmt) * 100)); }
    if (maxAmt)                     { sql += ' AND me.amount_paise <= ?';         binds.push(Math.round(parseFloat(maxAmt) * 100)); }
    if (q) {
      sql += ' AND (me.counterparty LIKE ? OR me.narration LIKE ? OR me.source_ref LIKE ? OR me.counterparty_ref LIKE ?)';
      const needle = '%' + q + '%';
      binds.push(needle, needle, needle, needle);
    }
    sql += ' ORDER BY COALESCE(me.txn_at, me.received_at) DESC, me.id DESC LIMIT ?';
    binds.push(limit);
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, user: user.name, rows: r.results || [] }, 200, origin);
  }

  if (action === 'payees') {
    const registry = url.searchParams.get('registry');
    const category = url.searchParams.get('category');
    const brand = url.searchParams.get('brand');
    let sql = `SELECT mp.id, mp.registry_source, mp.name, mp.bank, mp.account_type,
                      mp.last4, mp.category, mp.commodity, mp.role, mp.brand,
                      mp.is_own_account, mp.notes,
                      (SELECT COUNT(*)            FROM money_events me WHERE me.matched_payee_id = mp.id) AS txn_count,
                      (SELECT SUM(amount_paise)   FROM money_events me WHERE me.matched_payee_id = mp.id AND me.direction='debit'  AND me.parse_status='parsed') AS paid_paise,
                      (SELECT SUM(amount_paise)   FROM money_events me WHERE me.matched_payee_id = mp.id AND me.direction='credit' AND me.parse_status='parsed') AS received_paise,
                      (SELECT MAX(txn_at)         FROM money_events me WHERE me.matched_payee_id = mp.id) AS last_txn_at
               FROM money_payees mp WHERE 1=1`;
    const binds = [];
    if (registry) { sql += ' AND mp.registry_source=?'; binds.push(registry); }
    if (category) { sql += ' AND mp.category=?';        binds.push(category); }
    if (brand)    { sql += ' AND mp.brand=?';           binds.push(brand); }
    sql += ' ORDER BY paid_paise DESC NULLS LAST, mp.name';
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'top_counterparties') {
    // Aggregates by counterparty name (raw, not just registered payees).
    // Useful for discovering unmatched counterparties that should be added
    // to the registry.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 200);
    const dir = url.searchParams.get('dir'); // optional: credit | debit
    const since = url.searchParams.get('since'); // optional ISO date
    let sql = `SELECT COALESCE(me.counterparty, '—') AS counterparty,
                      me.matched_payee_id,
                      mp.name  AS payee_name,
                      mp.brand AS payee_brand,
                      mp.category AS payee_category,
                      me.direction,
                      COUNT(*)                AS n,
                      SUM(me.amount_paise)    AS total_paise,
                      MAX(me.txn_at)          AS last_txn_at
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE me.parse_status='parsed'`;
    const binds = [];
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (since)                               { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(since); }
    sql += ` GROUP BY me.counterparty, me.matched_payee_id, me.direction
             ORDER BY total_paise DESC LIMIT ?`;
    binds.push(limit);
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'platform_summary') {
    // Revenue breakdown by settlement_platform (Razorpay/Paytm/etc.)
    // Shows aggregator gross revenue; commission/net split is future work
    // once platform statements are backfilled.
    const since = url.searchParams.get('since');
    let sql = `SELECT COALESCE(settlement_platform, 'direct') AS platform,
                      direction,
                      COUNT(*) AS n,
                      SUM(amount_paise) AS total_paise
               FROM money_events
               WHERE parse_status='parsed'`;
    const binds = [];
    if (since) { sql += ' AND COALESCE(txn_at, received_at) >= ?'; binds.push(since); }
    sql += ' GROUP BY settlement_platform, direction ORDER BY total_paise DESC';
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'filter_options') {
    // Distinct values that can populate UI dropdowns. One round-trip for
    // all dimensions so the client doesn't have to fire 5 queries.
    const [channels, brands, categories, platforms, instruments] = await Promise.all([
      db.prepare(`SELECT DISTINCT channel FROM money_events WHERE channel IS NOT NULL ORDER BY channel`).all(),
      db.prepare(`SELECT DISTINCT brand   FROM money_events WHERE brand   IS NOT NULL ORDER BY brand`).all(),
      db.prepare(`SELECT DISTINCT category FROM money_events WHERE category IS NOT NULL ORDER BY category`).all(),
      db.prepare(`SELECT DISTINCT settlement_platform FROM money_events WHERE settlement_platform IS NOT NULL ORDER BY settlement_platform`).all(),
      db.prepare(`SELECT DISTINCT instrument FROM money_events ORDER BY instrument`).all(),
    ]);
    return json({
      ok: true,
      channels:    (channels.results   || []).map(r => r.channel),
      brands:      (brands.results     || []).map(r => r.brand),
      categories:  (categories.results || []).map(r => r.category),
      platforms:   (platforms.results  || []).map(r => r.settlement_platform),
      instruments: (instruments.results|| []).map(r => r.instrument),
    }, 200, origin);
  }

  if (action === 'summary') {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const d7  = new Date(now.getTime() - 7  * 86400000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const staleAfter = new Date(now.getTime() - 24 * 3600000).toISOString();

    const [latestByInstr, today, week, month, pstatus, health, lastReceived] = await Promise.all([
      // Most recent balance per instrument where balance is exposed.
      db.prepare(`
        SELECT instrument, balance_paise_after AS balance_paise, txn_at
        FROM money_events
        WHERE balance_paise_after IS NOT NULL
          AND parse_status='parsed'
        GROUP BY instrument
        HAVING txn_at = MAX(txn_at)
      `).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(todayStart).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(d7).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(d30).all(),
      db.prepare(`SELECT parse_status, COUNT(*) AS n
                  FROM money_events GROUP BY parse_status`).all(),
      db.prepare(`SELECT source, instrument, last_event_at,
                         expected_max_gap_minutes, status, notes
                  FROM money_source_health`).all(),
      db.prepare(`SELECT MAX(received_at) AS last_received
                  FROM money_events WHERE parse_status='parsed'`).first(),
    ]);

    // Compute staleness per source: status = 'stale' if last_event_at
    // older than expected_max_gap_minutes, 'silent' if null.
    const healthCooked = (health.results || []).map(h => {
      if (!h.last_event_at) return { ...h, live_status: 'silent' };
      const ageMin = (Date.now() - new Date(h.last_event_at).getTime()) / 60000;
      const live_status = ageMin > h.expected_max_gap_minutes ? 'stale' : 'healthy';
      return { ...h, age_minutes: Math.floor(ageMin), live_status };
    });

    // Top-line stale flag: is any enabled source older than its gap?
    const anyStale = healthCooked.some(h => h.live_status === 'stale' || h.live_status === 'silent');

    return json({
      ok: true,
      user: user.name,
      generated_at: nowIso(),
      balances: (latestByInstr.results || []).map(r => ({
        instrument: r.instrument,
        balance_paise: r.balance_paise,
        balance_rupees: r.balance_paise != null ? r.balance_paise / 100 : null,
        as_of: r.txn_at,
      })),
      today: foldRollup(today.results),
      week:  foldRollup(week.results),
      month: foldRollup(month.results),
      parse_health: Object.fromEntries((pstatus.results || []).map(r => [r.parse_status, r.n])),
      source_health: healthCooked,
      any_source_stale: anyStale,
      last_ingest_at: lastReceived?.last_received || null,
    }, 200, origin);
  }

  if (action === 'unreconciled') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const r = await db.prepare(`
      SELECT id, source, instrument, txn_at, direction, amount_paise,
             counterparty, counterparty_ref, channel, narration, source_ref
      FROM money_events
      WHERE reconcile_status='unreconciled' AND parse_status='parsed'
      ORDER BY COALESCE(txn_at, received_at) DESC LIMIT ?
    `).bind(limit).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'health') {
    const r = await db.prepare(`SELECT * FROM money_source_health`).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const user = checkPin(pinFromRequest(request, url), 'ops');
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  const action = url.searchParams.get('action');
  const body = await request.json().catch(() => ({}));

  if (action === 'reconcile') {
    const id = parseInt(body.id, 10);
    if (!id) return json({ ok: false, error: 'missing_id' }, 400, origin);
    const status = body.status;
    if (!['auto', 'manual', 'ignored', 'unreconciled'].includes(status)) {
      return json({ ok: false, error: 'invalid_status' }, 400, origin);
    }
    // Existence + state-transition check.
    const cur = await env.DB.prepare(
      `SELECT reconcile_status, parse_status FROM money_events WHERE id=?`
    ).bind(id).first();
    if (!cur) return json({ ok: false, error: 'not_found' }, 404, origin);
    if (cur.parse_status !== 'parsed') {
      return json({ ok: false, error: 'cannot_reconcile_unparsed_row' }, 400, origin);
    }
    // Only admin can roll back 'reconciled' → 'unreconciled'.
    if (status === 'unreconciled' && user.role !== 'admin') {
      return json({ ok: false, error: 'admin_only_rollback' }, 403, origin);
    }

    const matched_expense_id    = body.matched_expense_id    ? parseInt(body.matched_expense_id, 10)    : null;
    const matched_vendor_bill_id = body.matched_vendor_bill_id ? parseInt(body.matched_vendor_bill_id, 10) : null;
    const matched_payout_platform = body.matched_payout_platform || null;

    await env.DB.prepare(`
      UPDATE money_events
      SET reconcile_status=?, matched_expense_id=?, matched_vendor_bill_id=?,
          matched_payout_platform=?, reconciled_at=?, reconciled_by=?,
          notes=COALESCE(?, notes)
      WHERE id=?
    `).bind(
      status, matched_expense_id, matched_vendor_bill_id,
      matched_payout_platform, nowIso(), user.name,
      body.notes || null, id,
    ).run();
    return json({ ok: true }, 200, origin);
  }

  if (action === 'match_cross_source') {
    // Pair a gross event (e.g. Zomato payout) with a net event (HDFC credit).
    const gross_event_id = parseInt(body.gross_event_id, 10);
    const net_event_id   = parseInt(body.net_event_id, 10);
    if (!gross_event_id || !net_event_id) {
      return json({ ok: false, error: 'missing_event_ids' }, 400, origin);
    }
    const commission_paise = parseInt(body.commission_paise || '0', 10) || 0;
    const tax_paise = parseInt(body.tax_paise || '0', 10) || 0;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO money_recon_matches
        (gross_event_id, net_event_id, commission_paise, tax_paise,
         notes, matched_at, matched_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gross_event_id, net_event_id, commission_paise, tax_paise,
      body.notes || '', nowIso(), user.name,
    ).run();
    // Mark both events as reconciled.
    await env.DB.prepare(`
      UPDATE money_events
      SET reconcile_status='manual', reconciled_at=?, reconciled_by=?
      WHERE id IN (?, ?)
    `).bind(nowIso(), user.name, gross_event_id, net_event_id).run();
    return json({ ok: true }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
}

function foldRollup(rows) {
  const out = { credit_paise: 0, debit_paise: 0, n_credit: 0, n_debit: 0, net_paise: 0 };
  for (const r of rows || []) {
    if (r.direction === 'credit') { out.credit_paise = r.total_paise || 0; out.n_credit = r.n || 0; }
    if (r.direction === 'debit')  { out.debit_paise  = r.total_paise || 0; out.n_debit  = r.n || 0; }
  }
  out.net_paise = out.credit_paise - out.debit_paise;
  out.credit = out.credit_paise / 100;
  out.debit  = out.debit_paise  / 100;
  out.net    = out.net_paise    / 100;
  return out;
}

function nowIso() { return new Date().toISOString(); }
