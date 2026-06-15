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

// ── Hyperpure: the planned next-day B2B basket (distinct from local trip vendors) ──
// Bangalore rules (researched 2026-06-15): order by ~23:00 IST → next-day delivery,
// minimum order value ₹1,500, standard delivery ₹99. Prices are live mandi rates
// scraped from the owner's logged-in account into hyperpure_prices.
const HP = { MOV_PAISE: 150000, DELIVERY_PAISE: 9900, CUTOFF_HOUR: 23 };

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
    if (action === 'hyperpure-feed' && request.method === 'GET') {
      return withCors(json(await hyperpureFeed(db)), request);
    }
    if (action === 'hyperpure-place' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await hyperpurePlace(db, body, auth)), request);
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

// ── Owner "to pay": ONE consolidated payment per vendor ──
// All of a vendor's unpaid items (across every order placed that day) merge into
// a single card with one summed amount and one UPI — never per-item payments.
// Hyperpure orders are prepaid online at checkout, so they never enter the list.
async function openOrders(db) {
  const rows = await db.prepare(
    `SELECT id, brand, vendor_name, fulfilment, pay_timing, items_json, status, pay_amount_paise, expected_amount_paise, for_date
       FROM sauda_purchase WHERE paid_at IS NULL AND (pay_timing IS NULL OR pay_timing != 'online')
        ORDER BY for_date DESC, id DESC LIMIT 200`
  ).all();
  // group every unpaid row under its canonical vendor
  const byVendor = new Map();
  for (const o of (rows?.results || [])) {
    const vk = canonVendorKey(o.vendor_name) || 'unassigned';
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push(o);
  }
  const orders = [];
  for (const [vk, list] of byVendor.entries()) {
    const v = vendorView(vk);
    let items = [], amount = 0; const ids = []; const dates = new Set();
    for (const o of list) {
      ids.push(o.id);
      try { items = items.concat(JSON.parse(o.items_json || '[]')); } catch (e) {}
      amount += (o.pay_amount_paise || o.expected_amount_paise || 0);
      if (o.for_date) dates.add(o.for_date);
    }
    const forDates = [...dates].sort();
    orders.push({
      ids, order_count: list.length,
      vendorKey: v.key, vendor_name: v.name, brand: list[0].brand,
      vpa: v.vpa || '', fulfilmentLabel: v.fulfilmentLabel, payLabel: v.payLabel, pay: v.pay,
      items_json: JSON.stringify(items),
      pay_amount_paise: amount,                       // summed; 0 if not yet known
      for_date: forDates[forDates.length - 1] || '', for_dates: forDates,
    });
  }
  orders.sort((a, b) => (b.for_date || '').localeCompare(a.for_date || ''));
  return { orders };
}

// accept either a single id or a vendor's whole set of ids
function idList(body) {
  if (Array.isArray(body.ids)) return body.ids.map((x) => +x).filter(Boolean);
  return body.id ? [+body.id] : [];
}

// ── request payment for a vendor (records the total on the vendor's first order) ──
async function requestPay(db, body) {
  const ids = idList(body);
  const amt = Math.round(+body.amount_paise || 0);
  if (!ids.length) return { ok: false, error: 'no id' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`UPDATE sauda_purchase SET pay_amount_paise=?, pay_requested_at=?, status='REQUESTED', updated_at=? WHERE id=?`)
    .bind(amt, now, now, ids[0]).run();
  return { ok: true, ids, amount_paise: amt };
}

// ── owner marks a vendor's order(s) paid — one tap clears all that vendor's items ──
async function markPaid(db, body, auth) {
  const ids = idList(body);
  if (!ids.length) return { ok: false, error: 'no id' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const amt = Math.round(+body.amount_paise || 0);
  const ph = ids.map(() => '?').join(',');
  if (amt > 0) {
    await db.prepare(`UPDATE sauda_purchase SET pay_amount_paise=? WHERE id=?`).bind(amt, ids[0]).run();
  }
  await db.prepare(`UPDATE sauda_purchase SET paid_at=?, pay_method=?, status='PAID', updated_at=? WHERE id IN (${ph})`)
    .bind(now, (body.method || 'upi'), now, ...ids).run();
  return { ok: true, ids, paid_by: auth.u || '' };
}

// ── Hyperpure delivery window from the cutoff (IST). Order before 23:00 → tomorrow. ──
function hyperpureWindow() {
  const ist = new Date(Date.now() + 330 * 60000);
  const hour = ist.getUTCHours();           // ist already shifted, so getUTC* = IST clock
  const minute = ist.getUTCMinutes();
  const open = hour < HP.CUTOFF_HOUR;        // still before tonight's cutoff
  const deliverOffset = open ? 1 : 2;        // before 11pm → tomorrow, after → day-after
  const deliver = new Date(ist.getTime() + deliverOffset * 86400000);
  // minutes left until tonight's 23:00 (0 if already past)
  const minsToCutoff = open ? ((HP.CUTOFF_HOUR - hour) * 60 - minute) : 0;
  return {
    nowIstIso: ist.toISOString(),
    cutoff_hour: HP.CUTOFF_HOUR,
    open,
    mins_to_cutoff: minsToCutoff,
    for_date: deliver.toISOString().slice(0, 10),
  };
}

// ── Hyperpure live price feed (read-side; the price-token never reaches the client) ──
async function hyperpureFeed(db) {
  let rows = { results: [] };
  try {
    rows = await db.prepare(
      `SELECT item_key, query, cheapest_name, cheapest_price_paise, cheapest_image, cheapest_pack,
              cheapest_unit, cheapest_brand, cheapest_unit_price_paise, options_json, match_count, scraped_at
         FROM hyperpure_prices WHERE cheapest_price_paise IS NOT NULL ORDER BY item_key`
    ).all();
  } catch (e) { /* table may not exist yet → empty feed */ }
  // a scraped option object (price in rupees) → a feed-item-shaped SKU (paise)
  const toSku = (o) => ({
    matched: o.name || '', pack: o.pack || '', brand: o.brand || '', unit: o.unit || '',
    price_paise: Math.round((o.price || 0) * 100),
    unit_price_paise: Math.round((o.unit_price || o.price || 0) * 100),
    image: o.image || '',
  });
  const items = (rows?.results || []).map((r) => {
    let opts = [];
    try { opts = (JSON.parse(r.options_json || '[]') || []).map(toSku); } catch (e) {}
    return {
      item_key: r.item_key,
      name: r.query || r.item_key,          // the catalog/search concept (e.g. "paneer")
      matched: r.cheapest_name || '',       // the exact Hyperpure SKU we'd order (cheapest)
      price_paise: r.cheapest_price_paise,  // pack price (what the basket charges per unit)
      unit_price_paise: r.cheapest_unit_price_paise || r.cheapest_price_paise,
      unit: r.cheapest_unit || '',          // kg | ltr | pc …
      pack: r.cheapest_pack || '',          // "1 kg", "1 L" …
      brand: r.cheapest_brand || '',
      image: r.cheapest_image || '',
      options: opts,                        // related SKUs (tier 2) — choose from these
      match_count: r.match_count || 0,
      scraped_at: r.scraped_at,
    };
  });
  const freshest = items.reduce((m, it) => (it.scraped_at && it.scraped_at > m ? it.scraped_at : m), '');
  return {
    items,
    count: items.length,
    scraped_at: freshest,
    mov_paise: HP.MOV_PAISE,
    delivery_paise: HP.DELIVERY_PAISE,
    window: hyperpureWindow(),
  };
}

// ── Place tomorrow's Hyperpure basket: one prepaid order the box will fill in-app ──
// body = { lines: [{ item_key, name, qty, unit, price_paise }] }
async function hyperpurePlace(db, body, auth) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return { ok: false, error: 'no lines' };
  const win = hyperpureWindow();
  let subtotal = 0;
  const clean = lines.map((l) => {
    const qty = Math.max(0, Number(l.qty) || 0);
    const price = Math.max(0, Math.round(Number(l.price_paise) || 0));
    subtotal += qty * price;
    return { item_key: l.item_key || '', item: String(l.name || l.item_key || '').trim(), qty,
             unit: l.unit || '', price_paise: price, matched: l.matched || '',
             pack: l.pack || '', brand: l.brand || '', image: l.image || '' };
  });
  if (subtotal < HP.MOV_PAISE) {
    return { ok: false, error: 'below_mov', subtotal_paise: subtotal, mov_paise: HP.MOV_PAISE,
             short_paise: HP.MOV_PAISE - subtotal };
  }
  const total = subtotal + HP.DELIVERY_PAISE;
  const nowIso = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const res = await db.prepare(
    `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, expected_amount_paise, ordered_at, ordered_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    'both', 'Hyperpure', win.for_date, 'deliver', 'online',
    JSON.stringify(clean), 'QUEUED', total, nowIso, auth.u || ''
  ).run();
  return { ok: true, id: res?.meta?.last_row_id, for_date: win.for_date,
           subtotal_paise: subtotal, delivery_paise: HP.DELIVERY_PAISE, total_paise: total,
           lines: clean.length };
}
