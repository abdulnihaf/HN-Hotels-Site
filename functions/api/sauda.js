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
import { HP_CATALOG } from './_lib/hyperpure-catalog.js';
import { DECODE_SYSTEM } from './_lib/decode-ruleset.js';
import { sendWithFallback } from './_lib/comms-core.js';

// ── Hyperpure: the planned next-day B2B basket (distinct from local trip vendors) ──
// Bangalore rules (researched 2026-06-15): order by ~23:00 IST → next-day delivery,
// minimum order value ₹1,500, standard delivery ₹99. Prices are live mandi rates
// scraped from the owner's logged-in account into hyperpure_prices.
const HP = { MOV_PAISE: 150000, DELIVERY_PAISE: 9900, CUTOFF_HOUR: 23 };

// Each buying source carries its own rules so the comparison UX can warn about
// minimum-cart (a ₹20 item that's cheaper on Zepto is useless if you can't meet
// Zepto's floor). next-day = planned (Hyperpure); instant = quick-commerce.
const SOURCES = {
  hyperpure: { label: 'Hyperpure', kind: 'next-day', min_cart_paise: 150000, delivery_paise: 9900, free_above_paise: null },
  // quick-commerce — only relevant when an item is cheaper here than Hyperpure.
  // free_above = the cart value above which delivery is free (the "worth-it" floor).
  zepto:     { label: 'Zepto',     kind: 'instant', min_cart_paise: 0, delivery_paise: 3500, free_above_paise: 19900 },
  blinkit:   { label: 'Blinkit',   kind: 'instant', min_cart_paise: 0, delivery_paise: 3000, free_above_paise: 19900 },
  instamart: { label: 'Instamart', kind: 'instant', min_cart_paise: 0, delivery_paise: 3500, free_above_paise: 19900 },
  bigbasket: { label: 'BigBasket', kind: 'instant', min_cart_paise: 0, delivery_paise: 3000, free_above_paise: 20000 },
  jiomart:   { label: 'JioMart',   kind: 'instant', min_cart_paise: 0, delivery_paise: 0,    free_above_paise: 25000 },
  amazon:    { label: 'Amazon',    kind: 'instant', min_cart_paise: 0, delivery_paise: 3000, free_above_paise: 0 },
  flipkart:  { label: 'Flipkart',  kind: 'instant', min_cart_paise: 0, delivery_paise: 3000, free_above_paise: 0 },
};

// Purchase-chamber PINs (mirrors Darbar's identity; unifies under Diwan SSO later).
const SAUDA_PINS = {
  '0305': { name: 'Nihaf',   role: 'owner',    fin: true  },
  '8523': { name: 'Basheer', role: 'purchase', fin: false },
  '2026': { name: 'Zoya',    role: 'purchase', fin: false },
};

// shared with the settle cron worker — low-harm: only triggers bank-feed reconcile
const SAUDA_CRON_TOKEN = 'sauda-settle-9k2f7x';

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

    // ── auto-settle: the bank feed confirms payment, live. Callable by the settle
    //    cron (token) OR by the app on a valid PIN (To-pay refresh). No manual tap. ──
    if (action === 'auto-settle') {
      if ((url.searchParams.get('token') || '') !== SAUDA_CRON_TOKEN) {
        const a = await verifyToken(env, request);
        if (!a) return withCors(json({ error: 'unauthorized' }, 401), request);
      }
      return withCors(json(await autoSettle(db)), request);
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
      return withCors(json(await placeOrders(db, body, auth, env, context)), request);
    }
    if (action === 'open' && request.method === 'GET') {
      return withCors(json(await openOrders(db)), request);
    }
    if (action === 'vendor-ledger' && request.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 120);
      return withCors(json(await vendorLedger(db, days)), request);
    }
    // settings: the item + vendor master (Slice 1 — creates + seeds tables on first read)
    if (action === 'settings' && request.method === 'GET') {
      return withCors(json(await getSettings(db)), request);
    }
    // settings-bulk: upsert the canonical item master (collapse-pass result / grid saves)
    if (action === 'settings-bulk' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await settingsBulk(db, body, auth)), request);
    }
    if (action === 'settings-item' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await settingsItem(db, body, auth)), request);
    }
    if (action === 'settings-vendor' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await settingsVendor(db, body)), request);
    }
    // match-payment: preview whether the bank feed already shows this payment (before/without marking)
    if (action === 'match-payment' && request.method === 'GET') {
      const ids = (url.searchParams.get('ids') || '').split(',').map((x) => +x).filter(Boolean);
      const amount = Math.round(+url.searchParams.get('amount_paise') || 0);
      return withCors(json(await previewMatch(db, ids, amount)), request);
    }
    if (action === 'request-pay' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await requestPay(db, body)), request);
    }
    if (action === 'mark-paid' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await markPaid(db, body, auth)), request);
    }
    // direct-pay: pay ANY vendor an ad-hoc amount (not tied to a placed order) — records it
    if (action === 'direct-pay' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await directPay(db, body, auth)), request);
    }
    // payout: RazorpayX pushes money STRAIGHT to the vendor (UPI/bank) — replaces the dead
    // consumer-UPI redirect. Idempotency-protected so a retry never double-pays.
    if (action === 'payout' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await payoutVendor(db, body, auth, env)), request);
    }
    if (action === 'payout-status' && request.method === 'GET') {
      return withCors(json(await payoutStatus(db, env, url.searchParams.get('id') || '')), request);
    }
    if (action === 'hyperpure-feed' && request.method === 'GET') {
      return withCors(json(await hyperpureFeed(db)), request);
    }
    if (action === 'compare' && request.method === 'GET') {
      return withCors(json(await sourcesCompare(db)), request);
    }
    if (action === 'hyperpure-place' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await hyperpurePlace(db, body, auth)), request);
    }
    // need-first buy list: staff add item_key+qty for tomorrow; the routing engine
    // (v1: Claude, manually from the box) decides where each line is cheapest.
    if (action === 'requisition' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await saveRequisition(db, body, auth)), request);
    }
    if (action === 'requisition' && request.method === 'GET') {
      const forDate = url.searchParams.get('for_date') || '';
      const status = url.searchParams.get('status') || '';
      return withCors(json(await getRequisition(db, forDate, status)), request);
    }
    // decode: raw WhatsApp dump (text or screenshot) → clean structured PO via Claude
    if (action === 'decode' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await decodePO(env, body)), request);
    }
    // save-po: a confirmed decoded PO → the purchase-order trail (history)
    if (action === 'save-po' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await savePO(db, body, auth)), request);
    }
    if (action === 'po-history' && request.method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '60', 10) || 60, 200);
      return withCors(json(await poHistory(db, limit)), request);
    }
    // route: take the latest saved order(s) → lanes (local / plan-ahead / quick) by price + timing
    if (action === 'route' && request.method === 'GET') {
      const when = url.searchParams.get('when') === 'today' ? 'today' : 'tomorrow';
      return withCors(json(await routePlan(db, when)), request);
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
function nextDayIST() {
  const t = new Date(Date.now() + 330 * 60000 + 24 * 3600000);
  return t.toISOString().slice(0, 10);
}

// ── Requisition: the day's need-first buy LIST (what to buy, not where) ──
async function ensureRequisitionTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS sauda_requisition (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       for_date TEXT NOT NULL,
       items_json TEXT NOT NULL,
       by_user TEXT,
       status TEXT DEFAULT 'NEW',
       created_at TEXT NOT NULL
     )`
  ).run();
}
async function saveRequisition(db, body, auth) {
  // WHEN is a dimension, not a constant — it decides which sources are feasible.
  // today  → instant quick-commerce + the morning market trip (Hyperpure is out, it's next-day)
  // tomorrow → adds Hyperpure's cheaper next-day rates
  const needBy = (body && body.need_by) === 'today' ? 'today' : 'tomorrow';
  const forDate = (body && body.for_date) || (needBy === 'today' ? todayIST() : nextDayIST());
  const raw = Array.isArray(body && body.items) ? body.items : [];
  const items = raw
    .map((i) => ({ item_key: String((i && i.item_key) || '').trim(), qty: Number(i && i.qty) || 0 }))
    .filter((i) => i.item_key && i.qty > 0);
  if (!items.length) return { ok: false, error: 'empty list' };
  await ensureRequisitionTable(db);
  await db
    .prepare(`INSERT INTO sauda_requisition (for_date, items_json, by_user, status, created_at) VALUES (?,?,?,?,?)`)
    .bind(forDate, JSON.stringify(items), (auth && auth.name) || '', 'NEW', new Date().toISOString())
    .run();
  return { ok: true, for_date: forDate, need_by: needBy, count: items.length };
}
async function getRequisition(db, forDate, status) {
  await ensureRequisitionTable(db);
  const where = [];
  const args = [];
  if (forDate) { where.push('for_date = ?'); args.push(forDate); }
  if (status) { where.push('status = ?'); args.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT id, for_date, items_json, by_user, status, created_at FROM sauda_requisition ${clause} ORDER BY id DESC LIMIT 1`
  );
  const row = args.length ? await stmt.bind(...args).first() : await stmt.first();
  if (!row) return { ok: true, requisition: null };
  let items = [];
  try { items = JSON.parse(row.items_json); } catch (e) {}
  return {
    ok: true,
    requisition: { id: row.id, for_date: row.for_date, need_by: row.for_date === todayIST() ? 'today' : 'tomorrow', items, by_user: row.by_user, status: row.status, created_at: row.created_at },
  };
}

// ── Decode: raw WhatsApp dump → clean structured PO (Claude API, no SDK in Worker) ──
const DECODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    orders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brand: { type: 'string' },
          sender: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                raw: { type: 'string' },
                item: { type: 'string' },
                qty: { type: 'string' },
                unit: { type: 'string' },
                category: { type: 'string' },
                flag: { type: 'string' },
              },
              required: ['raw', 'item', 'qty', 'unit', 'category', 'flag'],
            },
          },
        },
        required: ['brand', 'sender', 'items'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['orders', 'notes'],
};

async function decodePO(env, body) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'decode unavailable — API key not configured' };
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  const image = body && typeof body.image === 'string' ? body.image : '';
  if (!text && !image) return { ok: false, error: 'paste the WhatsApp text or attach a screenshot' };

  const brand = body && (body.brand === 'HE' || body.brand === 'NCH') ? body.brand : '';
  const content = [];
  if (brand) {
    content.push({ type: 'text', text: `OPERATOR: all items are ${brand} (${brand === 'HE' ? 'Hamza Express' : 'Nawabi Chai House'}). The paste may have NO sender names and NO timestamps — that is fine; decode the items and assign every one of them to ${brand}.` });
  }
  if (image) {
    const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(image);
    if (!m) return { ok: false, error: 'unsupported image — use PNG/JPEG' };
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    content.push({ type: 'text', text: 'Decode the order(s) in this WhatsApp screenshot.' });
  }
  if (text) content.push({ type: 'text', text });

  const payload = {
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: DECODE_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: DECODE_SCHEMA } },
    messages: [{ role: 'user', content }],
  };

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: 'decode service unreachable' };
  }
  if (!resp.ok) {
    let detail = '';
    try { const j = await resp.json(); detail = (j && j.error && j.error.message) || ''; } catch (e) {}
    return { ok: false, error: `decode failed (${resp.status})`, detail };
  }
  let data;
  try { data = await resp.json(); } catch (e) { return { ok: false, error: 'decode bad response' }; }
  if (data.stop_reason === 'refusal') return { ok: false, error: 'decode refused' };
  const tb = (data.content || []).find((b) => b.type === 'text');
  if (!tb || !tb.text) return { ok: false, error: 'decode returned nothing' };
  let parsed;
  try { parsed = JSON.parse(tb.text); } catch (e) { return { ok: false, error: 'decode parse error' }; }
  return { ok: true, orders: Array.isArray(parsed.orders) ? parsed.orders : [], notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
}

// ── PO trail: a confirmed decoded order, saved as the purchase-order history ──
async function ensurePoTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS sauda_po (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       brand TEXT,
       for_date TEXT,
       need_by TEXT,
       sender TEXT,
       items_json TEXT NOT NULL,
       source TEXT DEFAULT 'whatsapp-decode',
       by_user TEXT,
       created_at TEXT NOT NULL
     )`
  ).run();
}
async function savePO(db, body, auth) {
  const orders = Array.isArray(body && body.orders) ? body.orders : [];
  const clean = orders
    .map((o) => ({
      brand: String((o && o.brand) || '').trim() || 'NA',
      sender: String((o && o.sender) || '').trim(),
      items: (Array.isArray(o && o.items) ? o.items : [])
        .map((i) => ({
          raw: String((i && i.raw) || ''),
          item: String((i && i.item) || '').trim(),
          qty: String((i && i.qty) || ''),
          unit: String((i && i.unit) || ''),
          category: String((i && i.category) || ''),
          flag: String((i && i.flag) || ''),
        }))
        .filter((i) => i.item),
    }))
    .filter((o) => o.items.length);
  if (!clean.length) return { ok: false, error: 'nothing to save' };
  const needBy = (body && body.need_by) === 'today' ? 'today' : 'tomorrow';
  const forDate = (body && body.for_date) || (needBy === 'today' ? todayIST() : nextDayIST());
  const source = String((body && body.source) || 'whatsapp-decode');
  await ensurePoTable(db);
  const now = new Date().toISOString();
  let saved = 0;
  for (const o of clean) {
    await db
      .prepare(`INSERT INTO sauda_po (brand, for_date, need_by, sender, items_json, source, by_user, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(o.brand, forDate, needBy, o.sender, JSON.stringify(o.items), source, (auth && auth.name) || '', now)
      .run();
    saved += 1;
  }
  return { ok: true, for_date: forDate, need_by: needBy, orders: saved, items: clean.reduce((n, o) => n + o.items.length, 0) };
}
async function poHistory(db, limit) {
  await ensurePoTable(db);
  const rows = ((await db
    .prepare(`SELECT id, brand, for_date, need_by, sender, items_json, source, by_user, created_at FROM sauda_po ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all()).results) || [];
  const orders = rows.map((r) => {
    let items = [];
    try { items = JSON.parse(r.items_json); } catch (e) {}
    return { id: r.id, brand: r.brand, for_date: r.for_date, need_by: r.need_by, sender: r.sender, source: r.source, by_user: r.by_user, created_at: r.created_at, items };
  });
  return { ok: true, orders };
}

// ── Route: latest saved order(s) → lanes (local / plan-ahead / quick) ──
// Uses the live price comparison for the items we have prices on; everything
// else defaults to the local vendor. Hyperpure only counts when buying for
// tomorrow (next-day). This is the "decide what to buy from where" engine.
async function routePlan(db, when) {
  const isToday = when === 'today';
  const cmp = await sourcesCompare(db);
  // index the online "wins" (item where a source beats the local price) by name
  const wins = {};
  for (const it of cmp.items || []) {
    if (it.beats_baseline && it.cheapest_source) {
      wins[norm(it.label)] = {
        source: it.cheapest_source,
        save_unit_paise: it.save_unit_paise || 0,
        unit: it.unit || '',
        srcLabel: (cmp.sources[it.cheapest_source] && cmp.sources[it.cheapest_source].label) || it.cheapest_source,
      };
    }
  }
  function matchWin(name) {
    const n = norm(name);
    if (wins[n]) return wins[n];
    for (const k in wins) { if (n && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) return wins[k]; }
    return null;
  }
  // most recent saved order per brand
  const po = await poHistory(db, 12);
  const seen = {};
  const orders = [];
  for (const o of po.orders) { if (!seen[o.brand]) { seen[o.brand] = 1; orders.push(o); } }
  const lanes = { local: [], plan: [], quick: [] };
  for (const o of orders) {
    for (const it of o.items) {
      const win = matchWin(it.item);
      let lane = 'local', src = '', srcLabel = '', save = 0;
      if (win) {
        if (win.source === 'hyperpure') {
          if (!isToday) { lane = 'plan'; src = 'hyperpure'; srcLabel = win.srcLabel; save = win.save_unit_paise; }
          // for today, Hyperpure can't deliver → stays local
        } else {
          lane = 'quick'; src = win.source; srcLabel = win.srcLabel; save = win.save_unit_paise;
        }
      }
      lanes[lane].push({ brand: o.brand, item: it.item, qty: it.qty, unit: it.unit, category: it.category, flag: it.flag || '', source: src, source_label: srcLabel, save_unit_paise: save });
    }
  }
  return {
    ok: true,
    when,
    note: isToday ? 'Buying for today — Hyperpure (next-day) is out; instant + local only.' : 'Buying for tomorrow — Hyperpure is available (order by 11pm).',
    counts: { local: lanes.local.length, plan: lanes.plan.length, quick: lanes.quick.length },
    lanes,
    orders: orders.map((o) => ({ id: o.id, brand: o.brand, for_date: o.for_date })),
  };
}

// ── Build the live item master from the last 30 days, routed to canonical vendors ──
async function buildCatalog(db) {
  const since = `date('now','-30 days')`;
  const [bl, dp] = await Promise.all([
    db.prepare(`SELECT item AS name, vendor AS vend, uom AS unit, brand, unit_cost_paise FROM buy_lines WHERE biz_date >= ${since} AND item != '' ORDER BY biz_date DESC`).all(),
    db.prepare(`SELECT item_name AS name, vendor_name AS vend, unit, brand FROM sauda_day_po WHERE for_date >= ${since} AND item_name NOT IN ('NEW','')`).all(),
  ]);

  // dedupe by normalized name; prefer a row whose vendor we recognise.
  const items = new Map();
  const priceByKey = new Map();   // norm(name) -> most-recent non-zero unit price (paise), so Place can pre-fill it
  const ingest = (rows, weight) => {
    for (const r of (rows?.results || [])) {
      const key = norm(r.name);
      if (!key) continue;
      if (r.unit_cost_paise > 0 && !priceByKey.has(key)) priceByKey.set(key, r.unit_cost_paise); // buy_lines is DESC → first seen = latest price
      const vk = canonVendorKey(r.vend);
      const prev = items.get(key);
      const cand = { name: r.name.trim(), vendorKey: vk, unit: (r.unit || '').trim(), brand: (r.brand || 'both'), w: weight + (vk ? 5 : 0) };
      if (!prev || cand.w > prev.w) items.set(key, cand);
    }
  };
  ingest(bl, 1);      // buy_lines (recent, carries the last price paid)
  ingest(dp, 2);      // sauda_day_po (richer names) wins ties

  // group into vendor baskets
  const baskets = new Map();
  for (const [key, it] of items.entries()) {
    const vk = it.vendorKey || 'unassigned';
    if (!baskets.has(vk)) baskets.set(vk, []);
    baskets.get(vk).push({ name: it.name, unit: it.unit, brand: it.brand, price_paise: priceByKey.get(key) || 0 });
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

// parse a leading numeric quantity from a string like "2", "2.5", "2 kg", "1.5L"
function qtyNum(q) { const m = String(q == null ? '' : q).match(/-?[\d.]+/); return m ? (parseFloat(m[0]) || 0) : 0; }

// ── Place: one sauda_purchase row per vendor basket ──
// body = { for_date?, lines: [{ item, sku?, qty, unit, vendorKey, brand, price_paise? }] }
// price_paise = the per-unit price staff captured for today's buy. The vendor's
// basket total (expected_amount_paise) is summed from it, so "To pay" is never
// a blank field someone has to re-type — today's prices ARE the bill.
async function placeOrders(db, body, auth, env, context) {
  const forDate = (body.for_date || todayIST()).slice(0, 10);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return { ok: false, error: 'no lines' };

  // group lines by vendor
  const byVendor = new Map();
  for (const ln of lines) {
    const vk = ln.vendorKey && VENDORS[ln.vendorKey] ? ln.vendorKey : 'unassigned';
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push({
      item: String(ln.item || '').trim(),
      sku: String(ln.sku || ln.item || '').trim(),   // the resolved product identity
      qty: ln.qty ?? '',
      unit: ln.unit || '',
      brand: ln.brand || 'both',
      price_paise: Math.max(0, Math.round(+ln.price_paise || 0)),
    });
  }

  const nowIso = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const created = [];
  for (const [vk, vlines] of byVendor.entries()) {
    const v = vendorView(vk);
    const expected = vlines.reduce((s, l) => s + Math.round(qtyNum(l.qty) * (l.price_paise || 0)), 0);
    const res = await db.prepare(
      `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, expected_amount_paise, ordered_at, ordered_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      v.brand || 'both', v.name, forDate, v.fulfilment, v.pay,
      JSON.stringify(vlines), 'ORDERED', expected, nowIso, (auth && auth.u) || ''
    ).run();
    created.push({ vendor: v.name, vendorKey: vk, fulfilment: v.fulfilment, lines: vlines, expected_amount_paise: expected, id: res?.meta?.last_row_id });
  }

  // Notify the runner: collect items → Basheer (he goes & buys); everything else
  // → Zoya (places it with the vendor for delivery). Non-blocking + fail-safe.
  try { const p = notifyOnPlace(env, created, forDate); if (context && context.waitUntil) context.waitUntil(p); } catch (e) {}

  return {
    ok: true, for_date: forDate, placed: created.length,
    orders: created.map((c) => ({ vendor: c.vendor, vendorKey: c.vendorKey, lines: c.lines.length, expected_amount_paise: c.expected_amount_paise, id: c.id })),
  };
}

// ── WhatsApp the right person the moment an order is placed ──
// collect → Basheer (go & buy) · deliver/porter/standing → Zoya (order it in).
// GATED: unless env.SAUDA_STAFF_NOTIFY === '1', the alert is routed to the OWNER
// (test mode, "[TEST → Basheer]" prefix) so staff are never spammed while testing.
// Reuses the approved ops_alert_v1 WABA template via the Sparksol (non-customer) line.
async function notifyOnPlace(env, created, forDate) {
  if (!env) return;
  const owner = env.OWNER_PHONE || '917010426808';
  const live = env.SAUDA_STAFF_NOTIFY === '1';
  const targets = {
    collect: { name: 'Basheer', phone: '9061906916' },
    other:   { name: 'Zoya',    phone: '8147120714' },
  };
  const groups = { collect: [], other: [] };
  for (const c of created) {
    if (c.vendorKey === 'unassigned') continue;
    (c.fulfilment === 'collect' ? groups.collect : groups.other).push(c);
  }
  const link = 'https://sauda.hnhotels.in/';
  for (const g of Object.keys(groups)) {
    const list = groups[g];
    if (!list.length) continue;
    const t = targets[g];
    const itemCount = list.reduce((n, c) => n + c.lines.length, 0);
    const head = (g === 'collect' ? `Sauda: go & buy from ${list.length} vendor(s)` : `Sauda: ${list.length} order(s) to place`);
    const detail = (`${list.map((c) => c.vendor).join(', ')} — ${itemCount} item(s) for ${forDate}.`).slice(0, 600);
    const instr = (g === 'collect' ? 'Collect today; clear any khata on the trip.' : 'Send each vendor their order for delivery.');
    const phone = live ? t.phone : owner;
    const prefix = live ? '' : `[TEST → ${t.name}] `;
    try {
      await sendWithFallback(env, {
        brand: 'sparksol', tier: 'warn',
        alert_id: `sauda_place:${g}:${forDate}:${Math.round(Date.now() / 60000)}`,
        phone, template: 'ops_alert_v1', language: 'en',
        vars: [(prefix + head).slice(0, 60), detail, instr, link],
      });
    } catch (e) { /* never block a placed order on a comms failure */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS MASTER (Slice 1) — the single source of truth for items + vendors.
// Tables sauda_item / sauda_item_alias / sauda_vendor, seeded ONCE from the
// existing HP_CATALOG + VENDORS + decode dictionary. Additive; nothing reads
// these yet (the consumers get wired in later slices). One source, not four.
// ═══════════════════════════════════════════════════════════════════════════
const VENDOR_PHONES = { prabhu:'9886806395', ganga:'7019547835', nisarcha:'8971457998', samosa:'9746581122', osmania:'9482965179', gas:'8553568718', jayjay:'9976688833' };
// obvious default vendor per item (editable in Settings; '' = decide later)
const DEFAULT_VENDOR = {
  sugar:'ashrafiya', atta:'ashrafiya', maida:'ashrafiya', honey:'ashrafiya', chilli_powder:'ashrafiya',
  turmeric:'ashrafiya', apple_chilli:'ashrafiya', whole_cashew:'ashrafiya', baby_cashew:'ashrafiya', magaj:'ashrafiya',
  kasuri_methi:'ashrafiya', colour_red:'ashrafiya', colour_orange:'ashrafiya', msg:'ashrafiya', soya_sauce:'ashrafiya',
  cornflour:'ashrafiya', moong_dal:'ashrafiya', masoor_dal:'ashrafiya', rice:'ashrafiya', tomato_ketchup:'ashrafiya',
  ruchi_gold_oil:'ashrafiya', sunflower_oil:'ashrafiya', condensed_milk:'ashrafiya', amul_cream:'ashrafiya',
  butter_unsalted:'ashrafiya', salted_butter:'ashrafiya', paneer:'ashrafiya',
  milk:'prabhu', curd:'prabhu',
  water_bisleri_500:'nazeer', water_aquaking_500:'nazeer', water_bisleri_1l:'nazeer', coke:'nazeer', thumsup:'nazeer',
  egg:'eggs',
};
// item spellings (raw → canonical key), migrated from the decode dictionary + HP_CATALOG synonyms
const ITEM_ALIASES = {
  sugar:['cheeni','sakkar'], butter_unsalted:['unsalted butter','white butter'], atta:['whole wheat','wheat flour'],
  maida:['white atta','refined flour'], milk:['doodh'], curd:['dahi','yogurt','yoghurt'], honey:['shahad'],
  condensed_milk:['milkmaid','condensed milk'], ruchi_gold_oil:['ruchi gold','ruchigold','palmolein'],
  sunflower_oil:['sunflower'], chilli_powder:['chilly powder','red chilli powder','mirchi powder','lal mirch','mirchi'],
  turmeric:['haldi','haldi powder','turmeric powder'], apple_chilli:['apple chilly','byadgi','byadgi chilli'],
  whole_cashew:['whole kaju'], baby_cashew:['bebi kaju','baby kaju'], magaj:['magaz','melon seeds','char magaj','magaj seeds'],
  amul_cream:['amal cream','fresh cream','cream'], salted_butter:['butter'], tomato_ketchup:['tomato sauce','kisan tomato sauce','ketchup'],
  kasuri_methi:['kasoori methi'], colour_red:['red food colour','red colour','red color'], colour_orange:['orange food colour','orange colour'],
  msg:['ajinomoto','tasting salt','tasting powder','china salt','testing salt'], soya_sauce:['soy sauce'],
  cornflour:['corn flour','corn starch'], moong_dal:['mung dal','moong','mung'], masoor_dal:['masur dal','masrul','masoor'],
  rice:['staff rice','sona masoori','sona masoori rice'], water_bisleri_500:['bisleri 500ml','bisleri 500 ml','bislari water'],
  water_aquaking_500:['aqua king','aquaking'], water_bisleri_1l:['bisleri 1l','bisleri 1 litre','bisleri 1 liter'],
  coke:['cock','coca cola','coca-cola'], thumsup:['thums up','thampsup','thumbs up'], egg:['eggs','anda'],
};

async function ensureSettingsTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_item (item_code TEXT PRIMARY KEY, label TEXT, unit TEXT, pack_label TEXT, pack_qty REAL,
      price_paise INTEGER DEFAULT 0, price_mode TEXT DEFAULT 'fixed', form TEXT DEFAULT 'loose', brand TEXT DEFAULT '', default_vendor TEXT DEFAULT '', category TEXT DEFAULT '',
      cmp_query TEXT DEFAULT '', cmp_must TEXT DEFAULT '[]', cmp_not TEXT DEFAULT '[]', cmp_band TEXT DEFAULT '[]',
      flagged INTEGER DEFAULT 0, note TEXT DEFAULT '', active INTEGER DEFAULT 1, updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_item_alias (alias TEXT PRIMARY KEY, item_code TEXT, created_at TEXT DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor (vendor_key TEXT PRIMARY KEY, name TEXT, brand TEXT DEFAULT 'both',
      fulfilment TEXT DEFAULT 'deliver', pay TEXT DEFAULT 'per', phone TEXT DEFAULT '', vpa_json TEXT DEFAULT '[]',
      aliases_json TEXT DEFAULT '[]', cat TEXT DEFAULT '', flagged INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '')`),
  ]);
  // add form (loose|defined) + brand to an already-existing table; on first add, the
  // catalog items (packaged buys) become 'defined' SKUs.
  let added = false;
  try { await db.prepare("ALTER TABLE sauda_item ADD COLUMN form TEXT DEFAULT 'loose'").run(); added = true; } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_item ADD COLUMN brand TEXT DEFAULT ''").run(); } catch (e) {}
  if (added) {
    const keys = HP_CATALOG.map((c) => c.key);
    try { await db.prepare(`UPDATE sauda_item SET form='defined' WHERE item_code IN (${keys.map(() => '?').join(',')})`).bind(...keys).run(); } catch (e) {}
  }
}

async function seedSettings(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM sauda_item').first();
  if (row && row.n > 0) return { seeded: false };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const stmts = [];
  for (const [k, v] of Object.entries(VENDORS)) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_vendor (vendor_key,name,brand,fulfilment,pay,phone,vpa_json,aliases_json,cat,flagged,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(k, v.name, v.brand || 'both', v.fulfilment, v.pay, VENDOR_PHONES[k] || '', JSON.stringify(v.vpa ? [v.vpa] : []), JSON.stringify(v.aliases || []), v.cat || '', v.vpa ? 0 : 1, 'seed', now));
  }
  for (const c of HP_CATALOG) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_item (item_code,label,unit,pack_label,pack_qty,price_paise,price_mode,default_vendor,cmp_query,cmp_must,cmp_not,cmp_band,flagged,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(c.key, c.label, c.unit, c.buy.pack, c.buy.qty, c.buy.base_paise, 'fixed', DEFAULT_VENDOR[c.key] || '', c.query, JSON.stringify(c.must || []), JSON.stringify(c.not || []), JSON.stringify(c.band || []), /CONFIRM/i.test(c.label) ? 1 : 0, 'seed', now));
  }
  for (const [code, arr] of Object.entries(ITEM_ALIASES)) for (const a of arr) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_item_alias (alias,item_code,created_at) VALUES (?,?,?)`).bind(String(a).toLowerCase(), code, now));
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
  return { seeded: true, vendors: Object.keys(VENDORS).length, items: HP_CATALOG.length };
}

async function getSettings(db) {
  await ensureSettingsTables(db);
  const seed = await seedSettings(db);
  const items = ((await db.prepare(`SELECT item_code,label,unit,pack_label,pack_qty,price_paise,price_mode,form,brand,default_vendor,category,flagged,note FROM sauda_item WHERE active=1 ORDER BY label`).all()).results) || [];
  const vendors = ((await db.prepare(`SELECT vendor_key,name,brand,fulfilment,pay,phone,vpa_json,aliases_json,cat,flagged FROM sauda_vendor WHERE active=1 ORDER BY name`).all()).results) || [];
  const aliasRows = ((await db.prepare(`SELECT alias,item_code FROM sauda_item_alias`).all()).results) || [];
  const aliasByItem = {};
  for (const r of aliasRows) (aliasByItem[r.item_code] = aliasByItem[r.item_code] || []).push(r.alias);
  for (const it of items) it.aliases = aliasByItem[it.item_code] || [];
  for (const v of vendors) { try { v.vpas = JSON.parse(v.vpa_json || '[]'); } catch (e) { v.vpas = []; } try { v.aliases = JSON.parse(v.aliases_json || '[]'); } catch (e) { v.aliases = []; } }
  return { ok: true, seeded: seed.seeded, counts: { items: items.length, vendors: vendors.length, aliases: aliasRows.length }, items, vendors };
}

// ── Bulk upsert the canonical item master (the collapse-pass result + Settings-grid saves) ──
// body = { items: [{ item_code|'NEW', label, unit, pack_label, category, price_mode, price_paise, aliases[], note }] }
async function settingsBulk(db, body, auth) {
  await ensureSettingsTables(db);
  const items = Array.isArray(body && body.items) ? body.items : [];
  if (!items.length) return { ok: false, error: 'no items' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const by = (auth && auth.u) || 'bulk';
  const slug = (s) => ('itm_' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')).slice(0, 40) || 'itm';
  const existing = new Set((((await db.prepare('SELECT item_code FROM sauda_item').all()).results) || []).map((r) => r.item_code));
  const used = new Set(existing);
  const stmts = []; let ins = 0, upd = 0, al = 0;
  for (const it of items) {
    let code = (it.item_code && it.item_code !== 'NEW') ? it.item_code : '';
    const isExisting = code && existing.has(code);
    const mode = it.price_mode === 'live' ? 'live' : 'fixed';
    const price = Math.max(0, Math.round(+it.price_paise || 0));
    if (!isExisting) {
      let base = code || slug(it.label); let c = base, n = 1;
      while (used.has(c)) c = base + '_' + (++n);
      code = c; used.add(code);
      stmts.push(db.prepare(`INSERT INTO sauda_item (item_code,label,unit,pack_label,price_paise,price_mode,category,note,flagged,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(code, it.label || code, it.unit || '', it.pack_label || '', price, mode, it.category || '', it.note || '', 0, by, now));
      ins++;
    } else {
      stmts.push(db.prepare(`UPDATE sauda_item SET label=?, unit=COALESCE(NULLIF(?,''),unit), pack_label=COALESCE(NULLIF(?,''),pack_label), price_mode=?, category=COALESCE(NULLIF(?,''),category), note=COALESCE(NULLIF(?,''),note), price_paise=CASE WHEN ?>0 THEN ? ELSE price_paise END, updated_by=?, updated_at=? WHERE item_code=?`)
        .bind(it.label || code, it.unit || '', it.pack_label || '', mode, it.category || '', it.note || '', price, price, by, now, code));
      upd++;
    }
    for (const a of (Array.isArray(it.aliases) ? it.aliases : [])) {
      const x = String(a).trim().toLowerCase(); if (!x) continue;
      stmts.push(db.prepare(`INSERT INTO sauda_item_alias (alias,item_code,created_at) VALUES (?,?,?) ON CONFLICT(alias) DO UPDATE SET item_code=excluded.item_code`).bind(x, code, now));
      al++;
    }
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
  return { ok: true, inserted: ins, updated: upd, aliases: al };
}

// ── Settings grid: edit/add a single item (partial fields only) ──
async function settingsItem(db, body, auth) {
  await ensureSettingsTables(db);
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const by = (auth && auth.u) || '';
  let code = String((body && body.item_code) || '').trim();
  if (!code || code === 'NEW') {
    const label = String((body && body.label) || '').trim();
    if (!label) return { ok: false, error: 'label required' };
    const slug = (s) => ('itm_' + s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')).slice(0, 40) || 'itm';
    let base = slug(label), c = base, n = 1;
    while (await db.prepare('SELECT 1 FROM sauda_item WHERE item_code=?').bind(c).first()) c = base + '_' + (++n);
    code = c;
    await db.prepare(`INSERT INTO sauda_item (item_code,label,unit,pack_label,price_paise,price_mode,form,brand,default_vendor,category,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(code, label, body.unit || '', body.pack_label || '', Math.max(0, Math.round(+body.price_paise || 0)), body.price_mode === 'live' ? 'live' : 'fixed', body.form === 'defined' ? 'defined' : 'loose', body.brand || '', body.default_vendor || '', body.category || '', by, now).run();
    return { ok: true, item_code: code, created: true };
  }
  const sets = [], vals = [];
  const f = (k, sql, val) => { if (k in body) { sets.push(sql); vals.push(val); } };
  f('label', 'label=?', String(body.label || ''));
  f('unit', 'unit=?', String(body.unit || ''));
  f('pack_label', 'pack_label=?', String(body.pack_label || ''));
  f('form', 'form=?', body.form === 'defined' ? 'defined' : 'loose');
  f('brand', 'brand=?', String(body.brand || ''));
  f('price_mode', 'price_mode=?', body.price_mode === 'live' ? 'live' : 'fixed');
  f('default_vendor', 'default_vendor=?', String(body.default_vendor || ''));
  f('category', 'category=?', String(body.category || ''));
  if ('price_paise' in body) { sets.push('price_paise=?'); vals.push(Math.max(0, Math.round(+body.price_paise || 0))); }
  if ('flagged' in body) { sets.push('flagged=?'); vals.push(body.flagged ? 1 : 0); }
  if ('active' in body) { sets.push('active=?'); vals.push(body.active ? 1 : 0); }
  if (!sets.length) return { ok: false, error: 'nothing to update' };
  sets.push('updated_by=?', 'updated_at=?'); vals.push(by, now);
  await db.prepare(`UPDATE sauda_item SET ${sets.join(', ')} WHERE item_code=?`).bind(...vals, code).run();
  return { ok: true, item_code: code };
}

// ── Settings grid: edit a vendor (phone, UPIs, fulfilment, pay, aliases) ──
async function settingsVendor(db, body) {
  await ensureSettingsTables(db);
  const key = String((body && body.vendor_key) || '').trim();
  if (!key) return { ok: false, error: 'vendor_key required' };
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const sets = [], vals = [];
  if ('name' in body) { sets.push('name=?'); vals.push(String(body.name || '')); }
  if ('phone' in body) { sets.push('phone=?'); vals.push(String(body.phone || '')); }
  if ('vpas' in body) { const a = Array.isArray(body.vpas) ? body.vpas.map((x) => String(x).trim()).filter(Boolean) : []; sets.push('vpa_json=?'); vals.push(JSON.stringify(a)); }
  if ('fulfilment' in body) { sets.push('fulfilment=?'); vals.push(String(body.fulfilment || 'deliver')); }
  if ('pay' in body) { sets.push('pay=?'); vals.push(String(body.pay || 'per')); }
  if ('aliases' in body) { const a = Array.isArray(body.aliases) ? body.aliases.map((x) => String(x).trim()).filter(Boolean) : []; sets.push('aliases_json=?'); vals.push(JSON.stringify(a)); }
  if ('flagged' in body) { sets.push('flagged=?'); vals.push(body.flagged ? 1 : 0); }
  if (!sets.length) return { ok: false, error: 'nothing to update' };
  sets.push('updated_at=?'); vals.push(now);
  await db.prepare(`UPDATE sauda_vendor SET ${sets.join(', ')} WHERE vendor_key=?`).bind(...vals, key).run();
  return { ok: true };
}

// ── Per-vendor records: count, paid, outstanding, and the full trail (timestamps + method) ──
// Reads the same sauda_purchase rows; online (prepaid Hyperpure) excluded. This is
// the "every record for a vendor" view: how much is paid, how much is left, when.
// catch-up reconcile: bank email alerts lag, so retry matching any PAID-but-unconfirmed
// order against the feed whenever the records are viewed (self-heals delayed confirmations).
async function reconcileSweep(db, sinceFloor) {
  let rows = [];
  try {
    rows = ((await db.prepare(
      `SELECT id, vendor_name, pay_amount_paise, expected_amount_paise, pay_requested_at, ordered_at
         FROM sauda_purchase
        WHERE status='PAID' AND reconciled_at IS NULL AND (pay_timing IS NULL OR pay_timing != 'online')
          AND for_date >= ${sinceFloor} ORDER BY id DESC LIMIT 50`).all()).results) || [];
  } catch (e) { return; }
  if (!rows.length) return;
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  for (const r of rows) {
    const v = vendorView(canonVendorKey(r.vendor_name) || 'unassigned');
    const amt = r.pay_amount_paise || r.expected_amount_paise || 0;
    if (!v.vpa || !amt) continue;
    const since = String(r.pay_requested_at || r.ordered_at || '').slice(0, 10) || '2000-01-01';
    const m = await findVendorDebit(db, v.vpa, amt, since);
    if (m) { try { await db.prepare(`UPDATE sauda_purchase SET bank_event_id=?, bank_ref=?, reconciled_at=? WHERE id=?`).bind(m.bank_event_id, m.bank_ref, now, r.id).run(); } catch (e) {} }
  }
}

async function vendorLedger(db, days) {
  const since = `date('now','-${days} days')`;
  await autoSettle(db);   // live: settle anything the bank now confirms (orders + direct pays)
  let rows = [];
  try {
    rows = ((await db.prepare(
      `SELECT id, vendor_name, for_date, fulfilment, pay_timing, items_json, status,
              expected_amount_paise, pay_amount_paise, ordered_at, pay_requested_at, paid_at, pay_method,
              bank_ref, reconciled_at
         FROM sauda_purchase
        WHERE (pay_timing IS NULL OR pay_timing != 'online') AND for_date >= ${since}
        ORDER BY id DESC`
    ).all()).results) || [];
  } catch (e) { rows = []; }

  const byVendor = new Map();
  for (const r of rows) {
    const vk = canonVendorKey(r.vendor_name) || 'unassigned';
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push(r);
  }

  function summarize(vk, list) {
    const v = vendorView(vk);
    let paid = 0, outstanding = 0, lastPaidAt = '';
    const trail = [];
    for (const r of list) {
      const amt = (r.pay_amount_paise || r.expected_amount_paise || 0);
      const isPaid = !!r.paid_at || r.status === 'PAID';
      if (isPaid) { paid += amt; if (r.paid_at && r.paid_at > lastPaidAt) lastPaidAt = r.paid_at; }
      else outstanding += amt;
      let itemCount = 0; try { itemCount = JSON.parse(r.items_json || '[]').length; } catch (e) {}
      trail.push({
        id: r.id, for_date: r.for_date, status: r.status, amount_paise: amt, items: itemCount,
        ordered_at: r.ordered_at || '', pay_requested_at: r.pay_requested_at || '',
        paid_at: r.paid_at || '', method: r.pay_method || '',
        reconciled: !!r.reconciled_at, bank_ref: r.bank_ref || '',
      });
    }
    return {
      vendorKey: v.key, vendor_name: v.name, cat: v.cat || '', vpa: v.vpa || '',
      fulfilmentLabel: v.fulfilmentLabel, payLabel: v.payLabel, pay: v.pay,
      order_count: list.length, paid_paise: paid, outstanding_paise: outstanding,
      last_paid_at: lastPaidAt, trail,
    };
  }

  // EVERY canonical vendor appears (with its UPI id) so this tab is also the
  // pay-any-vendor directory; plus any 'unassigned' bucket that has orders.
  const vendors = Object.keys(VENDORS).map((vk) => summarize(vk, byVendor.get(vk) || []));
  if (byVendor.has('unassigned')) vendors.push(summarize('unassigned', byVendor.get('unassigned')));
  vendors.sort((a, b) =>
    (b.outstanding_paise - a.outstanding_paise) ||
    (b.order_count - a.order_count) ||
    a.vendor_name.localeCompare(b.vendor_name));
  return { ok: true, days, vendors };
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

// ── Bank-feed match: find the UPI debit that proves this vendor was paid ──
// Matches by vendor VPA appearing in money_events.counterparty_ref + exact amount,
// on/after `sinceDate` (so a prior same-amount payment can't false-match), and not
// already claimed by another order (one debit confirms one order). This turns a
// trusted "mark paid" tap into a bank-proven fact — the COA "don't rely on honesty".
async function findVendorDebit(db, vpa, amountPaise, sinceDate) {
  if (!vpa || !amountPaise) return null;
  let used = new Set();
  try {
    const ur = (await db.prepare(`SELECT bank_event_id FROM sauda_purchase WHERE bank_event_id IS NOT NULL`).all()).results || [];
    used = new Set(ur.map((r) => r.bank_event_id));
  } catch (e) {}
  let rows = [];
  try {
    rows = ((await db.prepare(
      `SELECT id, source_ref, counterparty_ref, narration, amount_paise, txn_at
         FROM money_events
        WHERE direction='debit' AND amount_paise=? AND lower(counterparty_ref) LIKE ?
          AND substr(COALESCE(txn_at,received_at),1,10) >= ?
        ORDER BY COALESCE(txn_at,received_at) DESC LIMIT 10`
    ).bind(amountPaise, '%' + String(vpa).toLowerCase() + '%', sinceDate).all()).results) || [];
  } catch (e) { return null; }
  const hit = rows.find((r) => !used.has(r.id));
  if (!hit) return null;
  return { bank_event_id: hit.id, bank_ref: hit.source_ref || hit.counterparty_ref || '', txn_at: hit.txn_at || '' };
}

// preview the match without marking (so the pay screen can show "bank already shows this")
async function previewMatch(db, ids, amount) {
  if (!ids.length || !amount) return { ok: true, matched: false };
  const o = await db.prepare(`SELECT vendor_name, pay_requested_at, ordered_at FROM sauda_purchase WHERE id=?`).bind(ids[0]).first();
  if (!o) return { ok: true, matched: false };
  const v = vendorView(canonVendorKey(o.vendor_name) || 'unassigned');
  const since = String(o.pay_requested_at || o.ordered_at || '').slice(0, 10) || todayIST();
  const m = await findVendorDebit(db, v.vpa, amount, since);
  return { ok: true, matched: !!m, bank_ref: m ? m.bank_ref : '', txn_at: m ? m.txn_at : '', vendor: v.name };
}

// ── owner marks a vendor's order(s) paid — one tap clears all that vendor's items ──
// Then auto-reconciles against the bank feed and stamps bank_ref + reconciled_at if found.
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

  // auto-reconcile: did the bank feed record this exact payment to this vendor?
  let reconciled = null;
  try {
    const o = await db.prepare(`SELECT vendor_name, pay_requested_at, ordered_at FROM sauda_purchase WHERE id=?`).bind(ids[0]).first();
    const v = vendorView(canonVendorKey(o && o.vendor_name) || 'unassigned');
    const since = String((o && (o.pay_requested_at || o.ordered_at)) || now).slice(0, 10);
    if (amt > 0 && v.vpa) {
      const m = await findVendorDebit(db, v.vpa, amt, since);
      if (m) {
        await db.prepare(`UPDATE sauda_purchase SET bank_event_id=?, bank_ref=?, reconciled_at=? WHERE id IN (${ph})`)
          .bind(m.bank_event_id, m.bank_ref, now, ...ids).run();
        reconciled = { bank_ref: m.bank_ref, txn_at: m.txn_at };
      }
    }
  } catch (e) { /* reconcile is best-effort; the PAID status still stands */ }

  return { ok: true, ids, paid_by: (auth && auth.u) || '', reconciled: !!reconciled, bank_ref: reconciled ? reconciled.bank_ref : '' };
}

// ── Live auto-settle: the bank feed IS the confirmation. For every order the owner
// has initiated payment on (REQUESTED), or marked paid but not yet bank-matched,
// find the matching UPI debit and settle it PAID + reconciled — no manual tap. ──
async function autoSettle(db) {
  const settled = [];
  let rows = [];
  try {
    rows = ((await db.prepare(
      `SELECT id, vendor_name, pay_amount_paise, expected_amount_paise, pay_requested_at, ordered_at
         FROM sauda_purchase
        WHERE (pay_timing IS NULL OR pay_timing != 'online')
          AND ( status='REQUESTED' OR (status='PAID' AND reconciled_at IS NULL) )
          AND for_date >= date('now','-7 days')
        ORDER BY id DESC LIMIT 100`).all()).results) || [];
  } catch (e) { return { ok: true, settled: [], count: 0 }; }
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  for (const r of rows) {
    const v = vendorView(canonVendorKey(r.vendor_name) || 'unassigned');
    const amt = r.pay_amount_paise || r.expected_amount_paise || 0;
    if (!v.vpa || !amt) continue;
    const since = String(r.pay_requested_at || r.ordered_at || '').slice(0, 10) || '2000-01-01';
    const m = await findVendorDebit(db, v.vpa, amt, since);
    if (!m) continue;
    await db.prepare(
      `UPDATE sauda_purchase
          SET status='PAID', paid_at=COALESCE(paid_at,?),
              pay_method=CASE WHEN pay_method IS NULL OR pay_method='' THEN 'upi' ELSE pay_method END,
              bank_event_id=?, bank_ref=?, reconciled_at=?, updated_at=? WHERE id=?`
    ).bind(now, m.bank_event_id, m.bank_ref, now, now, r.id).run();
    settled.push({ id: r.id, vendor: v.name, amount_paise: amt, bank_ref: m.bank_ref });
  }
  return { ok: true, settled, count: settled.length };
}

// ── Direct pay: pay ANY vendor an ad-hoc amount, not tied to a placed order.
// Records a REQUESTED sauda_purchase row so it shows in the vendor trail and gets
// bank-verified by auto-settle when the debit lands — same rails as a normal order. ──
async function directPay(db, body, auth) {
  const rawVk = String((body && body.vendorKey) || '');
  const vk = VENDORS[rawVk] ? rawVk : (canonVendorKey(rawVk) || '');
  if (!vk || !VENDORS[vk]) return { ok: false, error: 'unknown vendor' };
  const v = vendorView(vk);
  const amt = Math.round(+(body && body.amount_paise) || 0);
  if (amt <= 0) return { ok: false, error: 'amount required' };
  const forDate = todayIST();
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const items = [{ item: String((body && body.note) || 'Direct payment'), qty: '', unit: '', price_paise: amt, direct: true }];
  const res = await db.prepare(
    `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, expected_amount_paise, pay_amount_paise, pay_requested_at, ordered_at, ordered_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(v.brand || 'both', v.name, forDate, v.fulfilment, v.pay, JSON.stringify(items), 'REQUESTED', amt, amt, now, now, (auth && auth.u) || '').run();
  return { ok: true, id: res?.meta?.last_row_id, vendor: v.name, vpa: v.vpa || '', amount_paise: amt };
}

// ════════════════════════════════════════════════════════════════════════════
// RAZORPAYX PAYOUTS — software moves the money. The consumer-UPI redirect was
// structurally dead (unsigned web intents are risk-declined "as per UPI risk
// policy"). RazorpayX pushes funds straight to the vendor's VPA on business
// rails — no app, no link, a real UTR back. Keys/account come from env secrets.
// ════════════════════════════════════════════════════════════════════════════
function rzpHeaders(env) {
  return { Authorization: 'Basic ' + btoa((env.RAZORPAYX_KEY_ID || '') + ':' + (env.RAZORPAYX_KEY_SECRET || '')), 'Content-Type': 'application/json' };
}
async function rzpFetch(env, path, method, body, extra) {
  const res = await fetch('https://api.razorpay.com/v1' + path, {
    method: method || 'GET',
    headers: Object.assign(rzpHeaders(env), extra || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
// Ensure a Razorpay Contact + Fund Account exist for this vendor; cache ids on sauda_vendor.
async function ensureRzpFundAccount(db, env, vk, v) {
  const row = await db.prepare(`SELECT rzp_contact_id, rzp_fund_account_id FROM sauda_vendor WHERE vendor_key=?`).bind(vk).first().catch(() => null);
  if (row && row.rzp_fund_account_id) return { fund_account_id: row.rzp_fund_account_id };
  const vpa = String((v && v.vpa) || '').trim();
  if (!vpa) return { error: 'no UPI on file for ' + ((v && v.name) || vk) };
  let contactId = row && row.rzp_contact_id;
  if (!contactId) {
    const c = await rzpFetch(env, '/contacts', 'POST', { name: (v && v.name) || vk, type: 'vendor', reference_id: 'sauda_vendor_' + vk, contact: (v && v.phone) || undefined });
    if (!c.ok || !c.data.id) return { error: 'contact failed: ' + ((c.data.error && c.data.error.description) || c.status) };
    contactId = c.data.id;
  }
  const fa = await rzpFetch(env, '/fund_accounts', 'POST', { contact_id: contactId, account_type: 'vpa', vpa: { address: vpa } });
  if (!fa.ok || !fa.data.id) return { error: 'fund account failed: ' + ((fa.data.error && fa.data.error.description) || fa.status) };
  await db.prepare(`UPDATE sauda_vendor SET rzp_contact_id=?, rzp_fund_account_id=? WHERE vendor_key=?`).bind(contactId, fa.data.id, vk).run().catch(() => {});
  return { fund_account_id: fa.data.id, contact_id: contactId };
}
async function payoutVendor(db, body, auth, env) {
  const acct = env.RAZORPAYX_ACCOUNT_NUMBER || '';
  if (!acct) return { ok: false, error: 'payout account not configured' };
  const rawVk = String((body && body.vendorKey) || '');
  const vk = VENDORS[rawVk] ? rawVk : (canonVendorKey(rawVk) || '');
  if (!vk || !VENDORS[vk]) return { ok: false, error: 'unknown vendor' };
  const v = vendorView(vk);
  const amt = Math.round(+(body && body.amount_paise) || 0);
  if (amt <= 0) return { ok: false, error: 'amount required' };
  const orderIds = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : [];

  const ensured = await ensureRzpFundAccount(db, env, vk, v);
  if (ensured.error) return { ok: false, error: ensured.error };

  // persist the idempotency key BEFORE the call — a network retry must never double-pay
  const idem = crypto.randomUUID();
  const ref = 'sauda_' + (orderIds[0] || ('d' + Date.now()));
  await db.prepare(`INSERT INTO sauda_payout (idempotency_key, vendor_key, order_ids, amount_paise, mode, ref, status) VALUES (?,?,?,?,?,?,?)`)
    .bind(idem, vk, JSON.stringify(orderIds), amt, 'UPI', ref, 'creating').run().catch(() => {});

  const p = await rzpFetch(env, '/payouts', 'POST', {
    account_number: acct, fund_account_id: ensured.fund_account_id, amount: amt, currency: 'INR',
    mode: 'UPI', purpose: 'vendor bill', queue_if_low_balance: true, reference_id: ref, narration: ('HN Hotels ' + ((v && v.name) || '')).slice(0, 30),
  }, { 'X-Payout-Idempotency': idem });

  if (!p.ok || !p.data.id) {
    const reason = (p.data.error && p.data.error.description) || ('http ' + p.status);
    await db.prepare(`UPDATE sauda_payout SET status='failed', failure_reason=?, updated_at=datetime('now') WHERE idempotency_key=?`).bind(reason, idem).run().catch(() => {});
    return { ok: false, error: reason };
  }
  await db.prepare(`UPDATE sauda_payout SET rzp_payout_id=?, status=?, utr=?, fees_paise=?, tax_paise=?, updated_at=datetime('now') WHERE idempotency_key=?`)
    .bind(p.data.id, p.data.status || 'processing', p.data.utr || null, p.data.fees || null, p.data.tax || null, idem).run().catch(() => {});
  if (orderIds.length) {
    const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
    for (const id of orderIds) {
      await db.prepare(`UPDATE sauda_purchase SET status='PAID', pay_amount_paise=?, paid_at=?, bank_ref=? WHERE id=?`).bind(amt, now, p.data.id, id).run().catch(() => {});
    }
  }
  return { ok: true, payout_id: p.data.id, status: p.data.status, utr: p.data.utr || null, fees_paise: p.data.fees || 0, vendor: v.name, test: String(env.RAZORPAYX_KEY_ID || '').indexOf('rzp_test_') === 0 };
}
async function payoutStatus(db, env, payoutId) {
  if (!payoutId) return { ok: false, error: 'payout id required' };
  const p = await rzpFetch(env, '/payouts/' + encodeURIComponent(payoutId), 'GET');
  if (!p.ok || !p.data.id) return { ok: false, error: (p.data.error && p.data.error.description) || 'fetch failed' };
  await db.prepare(`UPDATE sauda_payout SET status=?, utr=?, updated_at=datetime('now') WHERE rzp_payout_id=?`).bind(p.data.status, p.data.utr || null, payoutId).run().catch(() => {});
  return { ok: true, status: p.data.status, utr: p.data.utr || null };
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

// ── Multi-source comparison: every item, every source, cheapest flagged ──
// Quick-commerce sources live in item_prices; Hyperpure is read from its own
// table (its UI stays source of truth). The app shows where each item is
// cheapest and which platforms clear their minimum cart.
async function sourcesCompare(db) {
  let ip = { results: [] }, hp = { results: [] };
  try {
    ip = await db.prepare(
      `SELECT item_key, source, matched_name, brand, pack, unit, price_paise, unit_price_paise, image, url
         FROM item_prices WHERE source != 'hyperpure'`).all();
  } catch (e) {}
  try {
    hp = await db.prepare(
      `SELECT item_key, cheapest_name, cheapest_brand, cheapest_pack, cheapest_unit,
              cheapest_price_paise, cheapest_unit_price_paise, cheapest_image
         FROM hyperpure_prices WHERE cheapest_price_paise IS NOT NULL`).all();
  } catch (e) {}
  const scraped = new Map();
  const add = (k, s) => { if (!scraped.has(k)) scraped.set(k, []); scraped.get(k).push(s); };
  for (const r of (ip?.results || [])) add(r.item_key, {
    source: r.source, matched: r.matched_name, brand: r.brand, pack: r.pack, unit: r.unit,
    price_paise: r.price_paise, unit_price_paise: r.unit_price_paise, image: r.image, url: r.url });
  for (const r of (hp?.results || [])) add(r.item_key, {
    source: 'hyperpure', matched: r.cheapest_name, brand: r.cheapest_brand, pack: r.cheapest_pack, unit: r.cheapest_unit,
    price_paise: r.cheapest_price_paise, unit_price_paise: r.cheapest_unit_price_paise, image: r.cheapest_image, url: null });
  // spine off the REAL catalog so every item shows with the owner's baseline price,
  // even before a platform has scraped it. A platform "wins" only when its per-unit
  // beats what the owner currently pays.
  const items = HP_CATALOG.map((c) => {
    const yourUnit = (c.buy && c.buy.qty) ? Math.round(c.buy.base_paise / c.buy.qty) : null;
    const ranked = (scraped.get(c.key) || []).slice().sort((a, b) =>
      (a.unit_price_paise ?? a.price_paise ?? 1e15) - (b.unit_price_paise ?? b.price_paise ?? 1e15));
    const best = ranked[0] || null;
    const beats = !!(best && yourUnit && best.unit_price_paise && best.unit_price_paise < yourUnit);
    return {
      item_key: c.key, label: c.label, unit: c.unit,
      your_pack: (c.buy && c.buy.pack) || '', your_paise: (c.buy && c.buy.base_paise) || null, your_unit_paise: yourUnit,
      sources: ranked,
      cheapest_source: best ? best.source : null,
      beats_baseline: beats,
      save_unit_paise: beats ? (yourUnit - best.unit_price_paise) : 0,
    };
  });
  return { items, sources: SOURCES };
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
