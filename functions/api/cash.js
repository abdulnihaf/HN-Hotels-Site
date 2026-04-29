/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/cash — Phase 1 v2 cash trail handler.
 *
 * Reads/writes ONLY the cash_events + cash_sync_state tables. Does not
 * touch money_events — that table is owned by /api/bank-feed (HDFC,
 * Federal, Razorpay, Paytm, aggregator settlements). This separation is
 * the structural fix for the v1 regression where cash rows leaked into
 * /ops/bank/.
 *
 * Actions:
 *   GET  ?action=trail&pin=XXXX[&from=YYYY-MM-DD&to=YYYY-MM-DD&instrument=cash_basheer]
 *        → balances + ledger + pending (in-flight runner / captain) summary
 *   GET  ?action=balance&pin=XXXX[&pile=pos_counter_nch]
 *        → just the 4 pile balances (lightweight, for embed elsewhere)
 *   GET  ?action=sync-status&pin=XXXX
 *        → cash_sync_state rows (per-source cursor + last run state)
 *   POST ?action=transfer
 *        body: { pin, from_instrument, to_instrument, amount_paise, txn_at?, notes? }
 *        → 2-leg transfer between cash piles (NOT to/from bank)
 *   POST ?action=deposit-to-bank
 *        body: { pin, from_instrument, amount_paise, txn_at?, notes? }
 *        → 1-leg debit on cash side. Bank credit lands separately
 *          via the HDFC email parser when the deposit clears.
 *   POST ?action=external-capital-in
 *        body: { pin, instrument (cash_basheer|cash_nihaf), amount_paise, txn_at?, notes }
 *        → 1-leg credit; explicit owner injection. notes required.
 *   POST ?action=sync[&source=...]
 *        → run sync workers (or one source if specified). Idempotent.
 *
 * Sources of truth consumed by sync:
 *   nawabichaihouse.com /api/settlement?action=history
 *   nawabichaihouse.com /api/settlement?action=expense-history
 *   nawabichaihouse.com /api/settlement?action=collection-history
 *   nawabichaihouse.com /api/nch-data
 *   hamzaexpress.in     /api/v2?action=shift-live
 *   hamzaexpress.in     /api/v2?action=history-expenses
 *   (HN central D1)     business_expenses x_pool != 'counter' AND cash
 *
 * Auth: PIN with admin/cfo/gm/asstmgr/purchase/cashier/viewer.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const NCH_BASE = 'https://nawabichaihouse.com';
const HE_BASE  = 'https://hamzaexpress.in';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
};

const USERS = {
  '0305': { name: 'Nihaf',    role: 'admin'    },
  '5882': { name: 'Nihaf',    role: 'admin'    },
  '3754': { name: 'Naveen',   role: 'cfo'      },
  '6045': { name: 'Faheem',   role: 'asstmgr'  },
  '3678': { name: 'Faheem',   role: 'asstmgr'  },
  '8523': { name: 'Basheer',  role: 'gm'       },
  '6890': { name: 'Tanveer',  role: 'gm'       },
  '3697': { name: 'Yashwant', role: 'gm'       },
  '2026': { name: 'Zoya',     role: 'purchase' },
  '8316': { name: 'Zoya',     role: 'purchase' },
  '4040': { name: 'Haneef',   role: 'viewer'   },
  '5050': { name: 'Nisar',    role: 'viewer'   },
};
const READ_ROLES     = new Set(['admin','cfo','gm','asstmgr','purchase','cashier','viewer']);
const TRANSFER_ROLES = new Set(['admin','cfo','gm','cashier']);
const SYNC_ROLES     = new Set(['admin','cfo']);

const CASH_INSTRUMENTS = new Set([
  'pos_counter_he', 'pos_counter_nch', 'cash_basheer', 'cash_nihaf',
]);
const BANK_DEPOSIT_TARGETS = new Set([
  'hdfc_ca_4680', 'federal_sa_4510',
]);

// ━━━ Helpers ━━━
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function todayIST() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}
function defaultFrom() {
  // Default to 30 days back, but never before NCH anchor (2026-04-19) —
  // there's nothing in cash_events older than that.
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 - 30 * 86400 * 1000);
  const cap = '2026-04-19';
  const candidate = ist.toISOString().slice(0, 10);
  return candidate < cap ? cap : candidate;
}
function newTransferGroupId() {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0');
  return `xfer_${t}_${r}`;
}
function instrumentLabel(i) {
  return ({
    pos_counter_he:  'Counter HE',
    pos_counter_nch: 'Counter NCH',
    cash_basheer:    'With Basheer',
    cash_nihaf:      'With Nihaf',
    hdfc_ca_4680:    'HDFC Bank',
    federal_sa_4510: 'Federal Bank',
  })[i] || i;
}
function authedUser(pin, minRoleSet = READ_ROLES) {
  const u = USERS[pin];
  if (!u) return null;
  return minRoleSet.has(u.role) ? u : null;
}

// ━━━ Entry point ━━━
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!env.DB) return json({ success: false, error: 'DB not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'trail')                                     return await trail(url, env);
    if (action === 'balance')                                   return await balance(url, env);
    if (action === 'sync-status')                               return await syncStatus(url, env);
    if (action === 'transfer'           && request.method === 'POST') return await transfer(request, env);
    if (action === 'deposit-to-bank'    && request.method === 'POST') return await depositToBank(request, env);
    if (action === 'external-capital-in'&& request.method === 'POST') return await externalCapitalIn(request, env);
    if (action === 'reconcile'          && request.method === 'POST') return await reconcile(request, env);
    if (action === 'sync'               && request.method === 'POST') return await runSync(request, env);
    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ READ ENDPOINTS ━━━━━━━━━━━━━━━━━━━━━━━━

// Balance computation uses the SAME anchor+delta pattern as
// /api/bank-feed?action=summary uses for HDFC: find the latest event
// per instrument carrying balance_paise_after (a reconcile snapshot),
// then add the net of subsequent events whose txn_at > anchor.txn_at
// (or same txn_at AND id > anchor.id). This makes the user's "today's
// physical count at 14:30 IST" the authoritative pivot — pre-reconcile
// rows stay visible in the trail but don't affect "current balance".
async function balance(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const seed = {
    pos_counter_he:  { instrument: 'pos_counter_he',  balance_paise: 0, last_event_at: null, event_count: 0, anchor_at: null, anchor_paise: null },
    pos_counter_nch: { instrument: 'pos_counter_nch', balance_paise: 0, last_event_at: null, event_count: 0, anchor_at: null, anchor_paise: null },
    cash_basheer:    { instrument: 'cash_basheer',    balance_paise: 0, last_event_at: null, event_count: 0, anchor_at: null, anchor_paise: null },
    cash_nihaf:      { instrument: 'cash_nihaf',      balance_paise: 0, last_event_at: null, event_count: 0, anchor_at: null, anchor_paise: null },
  };

  // Anchor + delta per pile.
  const result = await env.DB.prepare(`
    WITH anchor AS (
      SELECT a.instrument, a.balance_paise_after AS bal_paise, a.txn_at AS anchor_at, a.id AS anchor_id
        FROM cash_events a
       WHERE a.balance_paise_after IS NOT NULL
         AND a.id = (
           SELECT b.id FROM cash_events b
            WHERE b.instrument = a.instrument
              AND b.balance_paise_after IS NOT NULL
            ORDER BY b.txn_at DESC, b.id DESC LIMIT 1
         )
    )
    SELECT i.instrument,
           COALESCE(a.bal_paise, 0) + COALESCE((
             SELECT SUM(CASE d.direction WHEN 'credit' THEN d.amount_paise ELSE -d.amount_paise END)
               FROM cash_events d
              WHERE d.instrument = i.instrument
                AND d.balance_paise_after IS NULL
                AND (
                  a.anchor_at IS NULL
                  OR d.txn_at > a.anchor_at
                  OR (d.txn_at = a.anchor_at AND d.id > a.anchor_id)
                )
           ), 0) AS balance_paise,
           a.anchor_at,
           a.bal_paise AS anchor_paise,
           (SELECT COUNT(*) FROM cash_events e WHERE e.instrument = i.instrument) AS event_count,
           (SELECT MAX(txn_at) FROM cash_events e WHERE e.instrument = i.instrument) AS last_event_at
      FROM (SELECT 'pos_counter_he' AS instrument
              UNION SELECT 'pos_counter_nch'
              UNION SELECT 'cash_basheer'
              UNION SELECT 'cash_nihaf') i
      LEFT JOIN anchor a ON a.instrument = i.instrument
  `).all().catch(() => ({ results: [] }));

  for (const row of (result.results || [])) {
    seed[row.instrument] = { ...row };
  }

  const balances = Object.values(seed).map((b) => ({
    ...b,
    label: instrumentLabel(b.instrument),
    balance_rupees: (b.balance_paise || 0) / 100,
    anchor_rupees: b.anchor_paise != null ? b.anchor_paise / 100 : null,
  }));
  const total_paise = balances.reduce((s, b) => s + (b.balance_paise || 0), 0);

  return json({
    success: true,
    as_of: new Date().toISOString(),
    balances,
    total_paise,
    total_rupees: total_paise / 100,
    user: user.name,
  });
}

async function trail(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);

  const today = todayIST();
  const from = url.searchParams.get('from') || defaultFrom();
  const to = url.searchParams.get('to') || today;
  const instrument = url.searchParams.get('instrument');

  // Balances (full lifetime, since anchor)
  const balRes = await balance(url, env);
  const balData = await balRes.clone().json();

  // Ledger within the date window
  const ledgerSql = `
    SELECT id, instrument, direction, amount_paise, source, source_ref,
           brand, txn_at, recorded_at, recorded_by_pin, recorded_by_name,
           vendor_id, vendor_name, category, product_name, qty, uom,
           bill_ref, bill_date, attachment_url,
           linked_po_id, linked_po_name,
           matched_expense_id, matched_settlement_id, matched_collection_id,
           matched_pos_order_id, matched_shift_id,
           transfer_group_id, verified_separate, notes
      FROM cash_events
     WHERE txn_at >= ? AND txn_at <= ?
       ${instrument && CASH_INSTRUMENTS.has(instrument) ? 'AND instrument = ?' : ''}
     ORDER BY txn_at DESC, id DESC
     LIMIT 2000`;
  const binds = [from, to + 'T23:59:59+05:30'];
  if (instrument && CASH_INSTRUMENTS.has(instrument)) binds.push(instrument);

  let ledger = [];
  try {
    const r = await env.DB.prepare(ledgerSql).bind(...binds).all();
    ledger = r.results || [];
  } catch (_) { /* empty result is fine */ }

  // Pending (in-flight) — fetch live, fail-soft
  const pending = await fetchPending().catch((e) => ({ error: e.message, total_paise: 0 }));

  return json({
    success: true,
    as_of: new Date().toISOString(),
    range: { from, to },
    balances: balData.balances,
    total_paise: balData.total_paise,
    total_rupees: balData.total_rupees,
    pending,
    ledger,
    user: user.name,
  });
}

// In-flight cash NOT yet in any pile — held by runners/captains pending settlement.
// Read-only fetch from outlet endpoints; failures don't block the page.
async function fetchPending() {
  const out = { nch_runners_paise: 0, he_captains_paise: 0, total_paise: 0, breakdown: [] };

  // NCH: today's runners[].cashToCollect from /api/nch-data
  try {
    const today = todayIST();
    const tom = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const r = await fetch(`${NCH_BASE}/api/nch-data?from=${today}&to=${tom}`);
    const d = await r.json();
    for (const runner of (d.data?.runners || [])) {
      const cash = parseInt(Math.round((runner.cashToCollect || 0) * 100), 10);
      if (cash > 0) {
        out.nch_runners_paise += cash;
        out.breakdown.push({ pile: 'nch_runner', who: runner.name, paise: cash });
      }
    }
  } catch (e) { out.nch_error = e.message; }

  // HE: shift-live captain_owes (cash_handed_over already in till; "owes" is what's still pending)
  try {
    const r = await fetch(`${HE_BASE}/api/v2?action=shift-live&pin=5882`);
    const d = await r.json();
    for (const c of (d.captain_owes || [])) {
      const owes = parseInt(Math.round((c.owes || 0) * 100), 10);
      if (owes > 0) {
        out.he_captains_paise += owes;
        out.breakdown.push({ pile: 'he_captain', who: c.name, paise: owes });
      }
    }
  } catch (e) { out.he_error = e.message; }

  out.total_paise = out.nch_runners_paise + out.he_captains_paise;
  out.total_rupees = out.total_paise / 100;
  return out;
}

async function syncStatus(url, env) {
  const pin = url.searchParams.get('pin');
  const user = authedUser(pin);
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  const r = await env.DB.prepare(`SELECT * FROM cash_sync_state ORDER BY sync_source`).all();
  return json({ success: true, sources: r.results || [], user: user.name });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ RECONCILE ━━━━━━━━━━━━━━━━━━━━━━━━
//
// Anchor a pile to a physical-count snapshot at a specific timestamp.
// The event row carries balance_paise_after = the anchored amount.
// All future balance reads compute as: anchored_amount + Σ(post-anchor events).
// Pre-anchor events stay visible in the trail but no longer affect "current".
//
// Timestamp semantics:
//   - txn_at REQUIRED. Owner-supplied wall-clock IST when count was taken.
//   - Any event with txn_at <= anchor_txn_at is treated as already-counted.
//   - Any event with txn_at >  anchor_txn_at decrements/increments live.
//
// Why an explicit reconcile event vs simply zeroing out: keeps the audit
// trail intact (you can see what was inferred pre-reconcile vs anchored
// vs post-anchor). Multiple reconciles over time are supported — the
// most-recent one wins per pile.
async function reconcile(request, env) {
  const body = await request.json();
  const { pin, instrument, balance_rupees, balance_paise, txn_at, notes } = body;
  const user = authedUser(pin, TRANSFER_ROLES);
  if (!user) return json({ success: false, error: 'Invalid PIN or insufficient role' }, 401);

  if (!CASH_INSTRUMENTS.has(instrument)) {
    return json({ success: false, error: `instrument must be one of pos_counter_he/nch, cash_basheer, cash_nihaf — got ${instrument}` }, 400);
  }
  // Timestamp is REQUIRED (owner emphasized this is the pivot).
  if (!txn_at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(txn_at)) {
    return json({ success: false, error: 'txn_at required, ISO datetime e.g. 2026-04-29T14:30:00+05:30' }, 400);
  }
  // Accept either rupees or paise (rupees more natural for owner UI).
  let bp = balance_paise;
  if (bp == null && balance_rupees != null) bp = Math.round(parseFloat(balance_rupees) * 100);
  if (!Number.isFinite(bp) || bp < 0) {
    return json({ success: false, error: 'balance_rupees or balance_paise required, ≥ 0' }, 400);
  }
  const memo = String(notes || '').slice(0, 500) || `Reconcile snapshot ${instrument} = ₹${(bp/100).toFixed(2)} at ${txn_at}`;

  // We write the anchor as a credit row carrying balance_paise_after.
  // amount_paise is set to 0 because the row is a SNAPSHOT, not a flow —
  // but CHECK requires amount_paise > 0. Workaround: write 1 paise credit
  // with note explaining (or re-design CHECK). Cleanest: relax CHECK to
  // amount_paise >= 0 for this row. Since CHECKs aren't ALTER-able in
  // SQLite, we instead encode amount_paise = absolute(bp) and direction
  // is 'credit' if it pushes the running balance toward bp, but with
  // balance_paise_after set, the balance computation IGNORES amount_paise
  // anyway (it uses balance_paise_after as the anchor base, then sums
  // POST-anchor events only).
  //
  // To satisfy the >0 CHECK while keeping the math clean: amount_paise=1
  // (token), direction='credit'. The anchor query reads balance_paise_after
  // not amount_paise.
  const txnAtNorm = txn_at; // keep the IST literal owner provided
  const sourceRef = `reconcile:${instrument}:${Date.parse(txn_at)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO cash_events
         (instrument, direction, amount_paise, source, source_ref,
          txn_at, recorded_by_pin, recorded_by_name, balance_paise_after, notes)
       VALUES (?, 'credit', 1, 'manual', ?, ?, ?, ?, ?, ?)`
    ).bind(instrument, sourceRef, txnAtNorm, pin, user.name, bp, memo).run();
  } catch (e) {
    if (/UNIQUE/.test(e.message)) {
      return json({ success: false, error: 'A reconcile event already exists for this exact timestamp. Adjust by 1 second or update the existing one.' }, 409);
    }
    return json({ success: false, error: e.message }, 500);
  }
  return json({
    success: true,
    instrument,
    anchor_paise: bp,
    anchor_rupees: bp / 100,
    anchor_at: txnAtNorm,
    recorded_by: user.name,
    note: 'Future balance reads compute as anchor + sum(events with txn_at > anchor_at). Pre-anchor events remain in trail for audit.',
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ WRITE ENDPOINTS ━━━━━━━━━━━━━━━━━━━━━━━━

async function transfer(request, env) {
  const body = await request.json();
  const { pin, from_instrument, to_instrument, amount_paise, txn_at, notes } = body;
  const user = authedUser(pin, TRANSFER_ROLES);
  if (!user) return json({ success: false, error: 'Invalid PIN or insufficient role' }, 401);

  // Cash↔cash only. Bank deposits use deposit-to-bank.
  if (!CASH_INSTRUMENTS.has(from_instrument)) return json({ success: false, error: `from must be a cash pile, got ${from_instrument}` }, 400);
  if (!CASH_INSTRUMENTS.has(to_instrument))   return json({ success: false, error: `to must be a cash pile, got ${to_instrument}` }, 400);
  if (from_instrument === to_instrument)      return json({ success: false, error: 'from and to must differ' }, 400);
  const amt = parseInt(amount_paise, 10);
  if (!Number.isFinite(amt) || amt <= 0) return json({ success: false, error: 'amount_paise must be a positive integer' }, 400);

  const groupId = newTransferGroupId();
  const at = txn_at && /^\d{4}-\d{2}-\d{2}/.test(txn_at) ? txn_at : new Date().toISOString();
  const memo = String(notes || '').slice(0, 500);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO cash_events (instrument, direction, amount_paise, source, source_ref, txn_at, recorded_by_pin, recorded_by_name, transfer_group_id, notes)
         VALUES (?, 'debit', ?, 'transfer', ?, ?, ?, ?, ?, ?)`
      ).bind(from_instrument, amt, `transfer:${groupId}:leg1`, at, pin, user.name, groupId, memo),
      env.DB.prepare(
        `INSERT INTO cash_events (instrument, direction, amount_paise, source, source_ref, txn_at, recorded_by_pin, recorded_by_name, transfer_group_id, notes)
         VALUES (?, 'credit', ?, 'transfer', ?, ?, ?, ?, ?, ?)`
      ).bind(to_instrument, amt, `transfer:${groupId}:leg2`, at, pin, user.name, groupId, memo),
    ]);
  } catch (e) {
    return json({ success: false, error: `Transfer write failed: ${e.message}` }, 500);
  }
  return json({ success: true, transfer_group_id: groupId, from_instrument, to_instrument, amount_paise: amt, txn_at: at, recorded_by: user.name });
}

async function depositToBank(request, env) {
  const body = await request.json();
  const { pin, from_instrument, amount_paise, txn_at, notes } = body;
  const user = authedUser(pin, TRANSFER_ROLES);
  if (!user) return json({ success: false, error: 'Invalid PIN or insufficient role' }, 401);

  if (!CASH_INSTRUMENTS.has(from_instrument)) return json({ success: false, error: `from must be a cash pile, got ${from_instrument}` }, 400);
  const amt = parseInt(amount_paise, 10);
  if (!Number.isFinite(amt) || amt <= 0) return json({ success: false, error: 'amount_paise must be a positive integer' }, 400);

  const at = txn_at && /^\d{4}-\d{2}-\d{2}/.test(txn_at) ? txn_at : new Date().toISOString();
  const memo = String(notes || '').slice(0, 500) || 'Cash deposited at bank';

  try {
    await env.DB.prepare(
      `INSERT INTO cash_events (instrument, direction, amount_paise, source, source_ref, txn_at, recorded_by_pin, recorded_by_name, notes)
       VALUES (?, 'debit', ?, 'deposit_to_bank', ?, ?, ?, ?, ?)`
    ).bind(from_instrument, amt, `deposit:${Date.now()}:${pin}`, at, pin, user.name,
           memo + ' (bank credit will land via HDFC email parser separately)').run();
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
  return json({ success: true, from_instrument, amount_paise: amt, recorded_by: user.name });
}

async function externalCapitalIn(request, env) {
  const body = await request.json();
  const { pin, instrument, amount_paise, txn_at, notes } = body;
  const user = authedUser(pin, TRANSFER_ROLES);
  if (!user) return json({ success: false, error: 'Invalid PIN or insufficient role' }, 401);

  if (instrument !== 'cash_basheer' && instrument !== 'cash_nihaf') {
    return json({ success: false, error: 'External capital can only credit cash_basheer or cash_nihaf' }, 400);
  }
  const amt = parseInt(amount_paise, 10);
  if (!Number.isFinite(amt) || amt <= 0) return json({ success: false, error: 'amount_paise must be a positive integer' }, 400);
  if (!notes || String(notes).trim().length < 5) return json({ success: false, error: 'notes required (≥5 chars) — describe source' }, 400);

  const at = txn_at && /^\d{4}-\d{2}-\d{2}/.test(txn_at) ? txn_at : new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO cash_events (instrument, direction, amount_paise, source, source_ref, txn_at, recorded_by_pin, recorded_by_name, notes)
       VALUES (?, 'credit', ?, 'external_capital_in', ?, ?, ?, ?, ?)`
    ).bind(instrument, amt, `extcap:${Date.now()}:${pin}`, at, pin, user.name, String(notes).slice(0, 500)).run();
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
  return json({ success: true, instrument, amount_paise: amt, recorded_by: user.name });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━ SYNC WORKER ━━━━━━━━━━━━━━━━━━━━━━━━

async function runSync(request, env) {
  let pin, only;
  try {
    const body = await request.json();
    pin = body.pin; only = body.source;
  } catch (_) {
    const url = new URL(request.url);
    pin = url.searchParams.get('pin');
    only = url.searchParams.get('source');
  }
  const user = authedUser(pin, SYNC_ROLES);
  if (!user) return json({ success: false, error: 'Invalid PIN or admin/cfo only' }, 401);

  const sources = only ? [only] : [
    'nch_settlement_history',
    'nch_collection_history',
    'nch_expense_history',
    'he_shift_expenses',
    'he_shift_handovers',
    'central_business_expenses',
    // 'nch_pos_main_cash' and 'he_pos_orders' are deferred — they require
    // Odoo direct queries (separate Odoo instances ops.hamzahotel.com /
    // test.hamzahotel.com); first cut relies on the operational endpoints
    // above which already aggregate POS data.
  ];

  const results = {};
  for (const s of sources) {
    try {
      await markSyncRunning(env, s);
      const fn = SYNC_HANDLERS[s];
      if (!fn) { results[s] = { error: `no handler for ${s}` }; await markSyncDone(env, s, 'error', 0, `no handler`); continue; }
      const added = await fn(env);
      results[s] = { rows_added: added, status: 'ok' };
      await markSyncDone(env, s, 'ok', added, null);
    } catch (e) {
      results[s] = { error: e.message, status: 'error' };
      await markSyncDone(env, s, 'error', 0, e.message?.slice(0, 500) || 'unknown');
    }
  }
  return json({ success: true, results, ran_by: user.name });
}

async function markSyncRunning(env, src) {
  await env.DB.prepare(`UPDATE cash_sync_state SET last_run_status='running', last_run_at=? WHERE sync_source=?`)
    .bind(new Date().toISOString(), src).run();
}
async function markSyncDone(env, src, status, added, err) {
  await env.DB.prepare(
    `UPDATE cash_sync_state
        SET last_run_status=?,
            last_run_at=?,
            rows_added_last_run=?,
            rows_added_total = COALESCE(rows_added_total, 0) + ?,
            last_error=?
      WHERE sync_source=?`
  ).bind(status, new Date().toISOString(), added, added, err, src).run();
}

// Handler registry — each handler returns count of rows added.
const SYNC_HANDLERS = {
  nch_settlement_history: syncNchSettlementHistory,
  nch_collection_history: syncNchCollectionHistory,
  nch_expense_history:    syncNchExpenseHistory,
  he_shift_expenses:      syncHeShiftExpenses,
  he_shift_handovers:     syncHeShiftHandovers,
  central_business_expenses: syncCentralBusinessExpenses,
};

async function getCursor(env, src) {
  const r = await env.DB.prepare(`SELECT last_synced_id, last_synced_at FROM cash_sync_state WHERE sync_source=?`)
    .bind(src).first();
  return r || { last_synced_id: 0, last_synced_at: '2026-04-19T15:30:50Z' };
}
async function setCursor(env, src, fields) {
  const sets = []; const binds = [];
  if ('last_synced_id' in fields) { sets.push('last_synced_id=?'); binds.push(fields.last_synced_id); }
  if ('last_synced_at' in fields) { sets.push('last_synced_at=?'); binds.push(fields.last_synced_at); }
  if (!sets.length) return;
  binds.push(src);
  await env.DB.prepare(`UPDATE cash_sync_state SET ${sets.join(', ')} WHERE sync_source=?`).bind(...binds).run();
}

// ── Insert helper — silently ignores UNIQUE collisions (idempotency). ──
async function insertEvent(env, row) {
  try {
    await env.DB.prepare(
      `INSERT INTO cash_events
         (instrument, direction, amount_paise, source, source_ref, brand,
          txn_at, recorded_by_name,
          vendor_name, category, product_name,
          matched_expense_id, matched_settlement_id, matched_collection_id, matched_shift_id,
          transfer_group_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.instrument, row.direction, row.amount_paise, row.source, row.source_ref, row.brand || null,
      row.txn_at, row.recorded_by_name || null,
      row.vendor_name || null, row.category || null, row.product_name || null,
      row.matched_expense_id || null, row.matched_settlement_id || null,
      row.matched_collection_id || null, row.matched_shift_id || null,
      row.transfer_group_id || null, row.notes || null
    ).run();
    return true;
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return false;
    throw e;
  }
}

// ── NCH: settlement-history — runner cash_settled credits ──
async function syncNchSettlementHistory(env) {
  const cur = await getCursor(env, 'nch_settlement_history');
  const r = await fetch(`${NCH_BASE}/api/settlement?action=history&limit=500`);
  const d = await r.json();
  if (!d.success) throw new Error('NCH settlement history failed');
  let added = 0; let maxId = cur.last_synced_id || 0;
  for (const s of (d.settlements || [])) {
    if ((s.id || 0) <= (cur.last_synced_id || 0)) continue;
    if ((s.cash_settled || 0) <= 0) continue; // only credits
    const ok = await insertEvent(env, {
      instrument: 'pos_counter_nch', direction: 'credit',
      amount_paise: Math.round(s.cash_settled * 100),
      source: 'runner_settlement', source_ref: `nch:settlement:${s.id}`,
      brand: 'NCH', txn_at: s.settled_at,
      recorded_by_name: s.runner_name,
      matched_settlement_id: s.id,
      notes: `Runner ${s.runner_name} cash_settled (tokens ₹${s.tokens_amount}, sales ₹${s.sales_amount}, upi ₹${s.upi_amount}); settled_by ${s.settled_by}`,
    });
    if (ok) added++;
    if (s.id > maxId) maxId = s.id;
  }
  if (maxId > (cur.last_synced_id || 0)) await setCursor(env, 'nch_settlement_history', { last_synced_id: maxId });
  return added;
}

// ── NCH: collection-history — Basheer pickup events (2-leg transfers) ──
async function syncNchCollectionHistory(env) {
  const cur = await getCursor(env, 'nch_collection_history');
  const r = await fetch(`${NCH_BASE}/api/settlement?action=collection-history&limit=200`);
  const d = await r.json();
  if (!d.success) throw new Error('NCH collection history failed');
  let added = 0; let maxId = cur.last_synced_id || 0;
  for (const c of (d.collections || [])) {
    if ((c.id || 0) <= (cur.last_synced_id || 0)) continue;
    if ((c.amount || 0) <= 0) continue;
    const groupId = `xfer_collection_${c.id}`;
    const at = c.collected_at;
    const amt = Math.round(c.amount * 100);
    const debited = await insertEvent(env, {
      instrument: 'pos_counter_nch', direction: 'debit', amount_paise: amt,
      source: 'collection_handover', source_ref: `nch:collection:${c.id}:leg1`,
      brand: 'NCH', txn_at: at, recorded_by_name: c.collected_by_name || c.collected_by,
      matched_collection_id: c.id, transfer_group_id: groupId,
      notes: `Basheer pickup (settlements ${c.settlement_ids}); discrepancy ${c.discrepancy ?? 'n/a'}`,
    });
    const credited = await insertEvent(env, {
      instrument: 'cash_basheer', direction: 'credit', amount_paise: amt,
      source: 'collection_handover', source_ref: `nch:collection:${c.id}:leg2`,
      brand: 'NCH', txn_at: at, recorded_by_name: c.collected_by_name || c.collected_by,
      matched_collection_id: c.id, transfer_group_id: groupId,
      notes: `From NCH till handover (collection #${c.id})`,
    });
    if (debited) added++;
    if (credited) added++;
    if (c.id > maxId) maxId = c.id;
  }
  if (maxId > (cur.last_synced_id || 0)) await setCursor(env, 'nch_collection_history', { last_synced_id: maxId });
  return added;
}

// ── NCH: expense-history — counter expenses paid from till ──
async function syncNchExpenseHistory(env) {
  const cur = await getCursor(env, 'nch_expense_history');
  const r = await fetch(`${NCH_BASE}/api/settlement?action=expense-history&limit=2000`);
  const d = await r.json();
  if (!d.success) throw new Error('NCH expense history failed');
  let added = 0; let maxId = cur.last_synced_id || 0;
  for (const e of (d.expenses || [])) {
    if ((e.id || 0) <= (cur.last_synced_id || 0)) continue;
    if ((e.amount || 0) <= 0) continue;
    const ok = await insertEvent(env, {
      instrument: 'pos_counter_nch', direction: 'debit',
      amount_paise: Math.round(e.amount * 100),
      source: 'counter_expense', source_ref: `nch:expense:${e.id}`,
      brand: 'NCH', txn_at: e.recorded_at,
      recorded_by_name: e.recorded_by, category: e.category_name,
      notes: `NCH counter expense — ${e.category_name}`,
    });
    if (ok) added++;
    if (e.id > maxId) maxId = e.id;
  }
  if (maxId > (cur.last_synced_id || 0)) await setCursor(env, 'nch_expense_history', { last_synced_id: maxId });
  return added;
}

// ── HE: shift-expenses — counter expenses paid from HE till ──
async function syncHeShiftExpenses(env) {
  const cur = await getCursor(env, 'he_shift_expenses');
  const r = await fetch(`${HE_BASE}/api/v2?action=history-expenses&days=180`);
  const d = await r.json();
  // HE returns array under 'expenses' key. Some shapes: { expenses: [...] }
  // We tolerate both legacy and current shapes.
  const expenses = d.expenses || d.data || [];
  let added = 0; let maxId = cur.last_synced_id || 0;
  for (const e of expenses) {
    if ((e.id || 0) <= (cur.last_synced_id || 0)) continue;
    if ((e.payment_method || 'cash') !== 'cash') continue;  // only cash hits the till
    if ((e.amount || 0) <= 0) continue;
    const ok = await insertEvent(env, {
      instrument: 'pos_counter_he', direction: 'debit',
      amount_paise: Math.round(e.amount * 100),
      source: 'counter_expense', source_ref: `he:shift-exp:${e.id}`,
      brand: 'HE', txn_at: e.recorded_at,
      recorded_by_name: e.recorded_by_name,
      vendor_name: e.vendor_name, category: e.category_label, product_name: e.product_name,
      matched_shift_id: e.shift_id, matched_expense_id: e.hnhotels_expense_id,
      notes: `HE counter expense (shift ${e.shift_id})`,
    });
    if (ok) added++;
    if (e.id > maxId) maxId = e.id;
  }
  if (maxId > (cur.last_synced_id || 0)) await setCursor(env, 'he_shift_expenses', { last_synced_id: maxId });
  return added;
}

// ── HE: shift-handovers — captain cash_handed_over (cash IN to HE till) ──
// Source: shift-live captain_owes[] — but this is the LIVE accumulator, not
// individual events. Strategy: for each (shift, captain), compare current
// cash_handed_over vs the sum we already credited under this source_ref;
// if increased, write a delta credit. Idempotent because source_ref carries
// shift_id + captain_id and we recompute from the cumulative figure.
async function syncHeShiftHandovers(env) {
  const r = await fetch(`${HE_BASE}/api/v2?action=shift-live&pin=5882`);
  const d = await r.json();
  if (!d.success || !d.shift) throw new Error('HE shift-live failed (no shift)');
  const shift = d.shift;
  let added = 0;
  for (const c of (d.captain_owes || [])) {
    const handed = parseFloat(c.cash_handed_over || 0);
    if (handed <= 0) continue;
    const cumPaise = Math.round(handed * 100);
    const refKey = `he:shift-handover:${shift.id}:${c.employee_id}`;
    // Read the sum we've already credited under the related source_ref family:
    const prev = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_paise), 0) AS p FROM cash_events
        WHERE source = 'captain_handover'
          AND source_ref LIKE ?`
    ).bind(`${refKey}%`).first();
    const already = (prev?.p) || 0;
    const delta = cumPaise - already;
    if (delta <= 0) continue;
    const seq = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cash_events
        WHERE source = 'captain_handover'
          AND source_ref LIKE ?`
    ).bind(`${refKey}%`).first();
    const newRef = `${refKey}:seq${(seq?.n || 0) + 1}`;
    const ok = await insertEvent(env, {
      instrument: 'pos_counter_he', direction: 'credit',
      amount_paise: delta,
      source: 'captain_handover', source_ref: newRef,
      brand: 'HE', txn_at: shift.opened_at,  // best available timestamp
      recorded_by_name: c.name,
      matched_shift_id: shift.id,
      notes: `Captain ${c.name} handed cash to HE till (cumulative ₹${handed}, delta this run +₹${(delta/100).toFixed(2)})`,
    });
    if (ok) added++;
  }
  return added;
}

// ── HN central: business_expenses cash, x_pool != 'counter' ──
// These are central-recorded cash expenses (Naveen at /ops/expense/, etc.).
// PIN-based pile classification: Nihaf → cash_nihaf; everyone else → cash_basheer.
// Imprecise on purpose — Phase 3 dup cleanup retroactively refines via
// "Mark expense as PO-payment" mutating linked_po_id.
async function syncCentralBusinessExpenses(env) {
  const cur = await getCursor(env, 'central_business_expenses');
  const r = await env.DB.prepare(
    `SELECT id, recorded_by, recorded_at, amount, description, category, notes,
            company_id, product_name, x_pool, x_payment_method, x_location,
            x_excluded_from_pnl, vendor_id, vendor_name
       FROM business_expenses
      WHERE recorded_at > ?
        AND (x_payment_method = 'cash' OR (x_payment_method IS NULL AND payment_mode = 'cash'))
        AND COALESCE(x_excluded_from_pnl, 0) = 0
        AND COALESCE(x_pool, '') NOT IN ('counter', 'capex')
        AND amount > 0
      ORDER BY id`
  ).bind(cur.last_synced_id || 0).all();

  let added = 0; let maxId = cur.last_synced_id || 0;
  for (const e of (r.results || [])) {
    if ((e.id || 0) <= (cur.last_synced_id || 0)) continue;
    const isNihaf = String(e.recorded_by || '').toLowerCase().includes('nihaf');
    const pile = isNihaf ? 'cash_nihaf' : 'cash_basheer';
    const ok = await insertEvent(env, {
      instrument: pile, direction: 'debit',
      amount_paise: Math.round(parseFloat(e.amount) * 100),
      source: 'central_expense', source_ref: `be:${e.id}`,
      brand: e.x_location || (e.company_id === 1 ? 'HQ' : e.company_id === 2 ? 'HE' : e.company_id === 3 ? 'NCH' : null),
      txn_at: e.recorded_at,
      recorded_by_name: e.recorded_by,
      vendor_name: e.vendor_name, category: e.category, product_name: e.product_name,
      matched_expense_id: e.id,
      notes: `Central cash expense (recorded_by=${e.recorded_by}, x_pool=${e.x_pool || '—'}); pile rule: ${isNihaf ? 'recorded_by Nihaf → cash_nihaf' : 'else → cash_basheer'}`,
    });
    if (ok) added++;
    if (e.id > maxId) maxId = e.id;
  }
  if (maxId > (cur.last_synced_id || 0)) await setCursor(env, 'central_business_expenses', { last_synced_id: maxId });
  return added;
}
