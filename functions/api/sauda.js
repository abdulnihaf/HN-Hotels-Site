// ═══════════════════════════════════════════════════════════════════════════
// Sauda API — the purchase chamber.
//
//   POST ?action=auth        { pin }            → mint shared Diwan token
//   GET  ?action=catalog                        → live item master (last 30d),
//                                                  every item routed to a vendor
//   POST ?action=place       { for_date, lines }→ create one order per vendor
//                                                  basket (writes sauda_purchase)
//   GET  ?action=today       [?for_date=]       → orders already placed for a day
//
// The catalog is DERIVED from history (buy_lines + sauda_day_po), never a frozen
// seed — so it can't go stale and a 14-day item can't be missing. Unknown items
// are added by staff via place() and appear next time.
// ═══════════════════════════════════════════════════════════════════════════

import { mintToken, verifyToken, corsHeaders } from './_lib/darbar-auth.js';
import { canonVendorKey, vendorView, VENDORS } from './_lib/sauda-vendors.js';

// Purchase-chamber PINs (mirrors Darbar's identity; unifies under Diwan SSO later).
const SAUDA_PINS = {
  '0305': { name: 'Nihaf',   role: 'owner',    fin: true  },
  '8523': { name: 'Basheer', role: 'purchase', fin: false },
  '2026': { name: 'Zoya',    role: 'purchase', fin: false },
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
function withCors(resp, request) {
  const h = corsHeaders(request);
  for (const [k, v] of Object.entries(h)) resp.headers.set(k, v);
  return resp;
}
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '');

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'catalog';
  const db = env.DB;

  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
  if (!db) return withCors(json({ error: 'DB binding missing' }, 500), request);

  try {
    // ── auth (only unauthenticated action) ──
    if (action === 'auth' && request.method === 'POST') {
      const { pin } = await request.json().catch(() => ({}));
      const u = pin && SAUDA_PINS[String(pin).trim()];
      if (!u) return withCors(json({ error: 'invalid PIN' }, 401), request);
      const token = await mintToken(env, u);
      return withCors(json({ token, user: u.name, role: u.role, fin: u.fin }), request);
    }

    // ── everything else needs a valid token ──
    const auth = await verifyToken(env, request);
    if (!auth) return withCors(json({ error: 'unauthorized' }, 401), request);

    if (action === 'catalog' && request.method === 'GET') {
      return withCors(json(await buildCatalog(db)), request);
    }
    if (action === 'today' && request.method === 'GET') {
      const forDate = url.searchParams.get('for_date') || todayIST();
      return withCors(json(await ordersForDay(db, forDate)), request);
    }
    if (action === 'place' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await placeOrders(db, body, auth)), request);
    }
    if (action === 'open' && request.method === 'GET') {
      return withCors(json(await openOrders(db)), request);
    }
    if (action === 'request-pay' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await requestPay(db, body)), request);
    }
    if (action === 'mark-paid' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await markPaid(db, body, auth)), request);
    }
    return withCors(json({ error: `unknown action: ${action}` }, 400), request);
  } catch (e) {
    return withCors(json({ error: 'server error' }, 500), request);
  }
}

function todayIST() {
  // YYYY-MM-DD in IST (UTC+5:30)
  const t = new Date(Date.now() + 330 * 60000);
  return t.toISOString().slice(0, 10);
}

// ── Build the live item master from the last 30 days, routed to canonical vendors ──
async function buildCatalog(db) {
  const since = `date('now','-30 days')`;
  const [bl, dp] = await Promise.all([
    db.prepare(`SELECT item AS name, vendor AS vend, uom AS unit, brand FROM buy_lines WHERE biz_date >= ${since} AND item != ''`).all(),
    db.prepare(`SELECT item_name AS name, vendor_name AS vend, unit, brand FROM sauda_day_po WHERE for_date >= ${since} AND item_name NOT IN ('NEW','')`).all(),
  ]);

  // dedupe by normalized name; prefer a row whose vendor we recognise.
  const items = new Map();
  const ingest = (rows, weight) => {
    for (const r of (rows?.results || [])) {
      const key = norm(r.name);
      if (!key) continue;
      const vk = canonVendorKey(r.vend);
      const prev = items.get(key);
      const cand = { name: r.name.trim(), vendorKey: vk, unit: (r.unit || '').trim(), brand: (r.brand || 'both'), w: weight + (vk ? 5 : 0) };
      if (!prev || cand.w > prev.w) items.set(key, cand);
    }
  };
  ingest(bl, 1);      // buy_lines (recent)
  ingest(dp, 2);      // sauda_day_po (richer names) wins ties

  // group into vendor baskets
  const baskets = new Map();
  for (const it of items.values()) {
    const vk = it.vendorKey || 'unassigned';
    if (!baskets.has(vk)) baskets.set(vk, []);
    baskets.get(vk).push({ name: it.name, unit: it.unit, brand: it.brand });
  }

  const vendors = [...baskets.entries()].map(([vk, list]) => ({
    ...vendorView(vk),
    items: list.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => b.items.length - a.items.length);

  // flat list for search (each item -> its vendor)
  const flat = [];
  for (const v of vendors) for (const it of v.items) flat.push({ ...it, vendorKey: v.key, vendorName: v.name });

  return {
    generatedFrom: 'last 30 days of buy_lines + sauda_day_po',
    itemCount: flat.length,
    vendorCount: vendors.filter(v => v.key !== 'unassigned').length,
    vendors,
    flat: flat.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── Orders already placed for a given day ──
async function ordersForDay(db, forDate) {
  const rows = await db.prepare(
    `SELECT id, brand, vendor_name, fulfilment, pay_timing, items_json, status, expected_amount_paise, ordered_by, ordered_at
       FROM sauda_purchase WHERE for_date = ? ORDER BY id DESC`
  ).bind(forDate).all();
  return { for_date: forDate, orders: rows?.results || [] };
}

// ── Place: one sauda_purchase row per vendor basket ──
// body = { for_date?, lines: [{ item, qty, unit, vendorKey, brand }] }
async function placeOrders(db, body, auth) {
  const forDate = (body.for_date || todayIST()).slice(0, 10);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return json({ error: 'no lines' }, 400);

  // group lines by vendor
  const byVendor = new Map();
  for (const ln of lines) {
    const vk = ln.vendorKey && VENDORS[ln.vendorKey] ? ln.vendorKey : 'unassigned';
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push({ item: String(ln.item || '').trim(), qty: ln.qty ?? '', unit: ln.unit || '', brand: ln.brand || 'both' });
  }

  const nowIso = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const created = [];
  for (const [vk, vlines] of byVendor.entries()) {
    const v = vendorView(vk);
    const res = await db.prepare(
      `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, ordered_at, ordered_by)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      v.brand || 'both', v.name, forDate, v.fulfilment, v.pay,
      JSON.stringify(vlines), 'ORDERED', nowIso, auth.u || ''
    ).run();
    created.push({ vendor: v.name, vendorKey: vk, lines: vlines.length, id: res?.meta?.last_row_id });
  }
  return { ok: true, for_date: forDate, placed: created.length, orders: created };
}

// ── Owner "to pay": every order not yet paid, with the vendor's saved UPI ──
async function openOrders(db) {
  const rows = await db.prepare(
    `SELECT id, brand, vendor_name, fulfilment, pay_timing, items_json, status, pay_amount_paise, for_date
       FROM sauda_purchase WHERE paid_at IS NULL ORDER BY for_date DESC, id DESC LIMIT 60`
  ).all();
  const orders = (rows?.results || []).map((o) => {
    const vk = canonVendorKey(o.vendor_name);
    const v = vendorView(vk || 'unassigned');
    return { ...o, vendorKey: v.key, vpa: v.vpa || '', fulfilmentLabel: v.fulfilmentLabel, payLabel: v.payLabel, pay: v.pay };
  });
  return { orders };
}

// ── request payment on an order (sets the amount) ──
async function requestPay(db, body) {
  const id = +body.id;
  const amt = Math.round(+body.amount_paise || 0);
  if (!id) return { ok: false, error: 'no id' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`UPDATE sauda_purchase SET pay_amount_paise=?, pay_requested_at=?, status='REQUESTED', updated_at=? WHERE id=?`)
    .bind(amt, now, now, id).run();
  return { ok: true, id, amount_paise: amt };
}

// ── owner marks an order paid (after the UPI app payment) ──
async function markPaid(db, body, auth) {
  const id = +body.id;
  if (!id) return { ok: false, error: 'no id' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`UPDATE sauda_purchase SET paid_at=?, pay_method=?, status='PAID', updated_at=? WHERE id=?`)
    .bind(now, (body.method || 'upi'), now, id).run();
  return { ok: true, id, paid_by: auth.u || '' };
}
