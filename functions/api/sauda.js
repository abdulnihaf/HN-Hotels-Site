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
    if (action === 'vendor-event' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await vendorEvent(db, body, auth, env)), request);
    }
    if (action === 'vendor-media' && request.method === 'GET') {
      return withCors(await vendorMedia(env, db, url, auth), request);
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
      return withCors(json(await settingsVendor(db, body, auth)), request);
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
    if (action === 'purchase-receipt' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await purchaseReceipt(db, body, auth)), request);
    }
    if (action === 'purchase-prices' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await purchasePrices(db, body, auth, env)), request);
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

// ── The cart catalog IS the canonical sauda_item master (175 items + the loaded
//    prices). Rates auto-fill from price_paise; live items (chicken/mutton/veg)
//    carry no price so the rate stays blank for today's number. Search also matches
//    aliases (haldi → Turmeric). Vendor baskets group by each item's default_vendor. ──
function catalogNameKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\bkabab\b/g, 'kebab')
    .replace(/\bshawarama\b/g, 'shawarma')
    .replace(/\bshawarma\s+chicken\s*\(?\s*boneless\s*\)?/g, 'shawarma chicken')
    .replace(/\broasted?\s+chicken\b/g, 'grill chicken')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function catalogPickRank(it) {
  const code = String((it && it.item_code) || '');
  let rank = 0;
  if (/^HE_/.test(code)) rank += 100;
  if (!/^itm_/.test(code)) rank += 20;
  if (!(it && it.flagged)) rank += 5;
  if ((it && it.price_paise) > 0) rank += 1;
  return rank;
}
async function buildCatalog(db) {
  const vdir = await getVendorDirectory(db);
  const [itemsRes, aliasRes] = await Promise.all([
    db.prepare(`SELECT item_code,label,unit,price_paise,price_mode,default_vendor,flagged FROM sauda_item WHERE active=1 ORDER BY label`).all(),
    db.prepare(`SELECT alias,item_code FROM sauda_item_alias`).all(),
  ]);
  const items = (itemsRes && itemsRes.results) || [];
  if (!items.length) {
    // master not seeded yet → empty catalog (creates on first settings read)
    return { generatedFrom: 'sauda_item master (empty)', itemCount: 0, vendorCount: 0, vendors: [], flat: [] };
  }
  const aliasByCode = new Map();
  for (const a of ((aliasRes && aliasRes.results) || [])) {
    if (!aliasByCode.has(a.item_code)) aliasByCode.set(a.item_code, []);
    if (String(a.alias).toLowerCase() !== String(a.item_code)) aliasByCode.get(a.item_code).push(a.alias);
  }
  const picked = new Map();
  for (const it of items) {
    const live = it.price_mode === 'live';
    const vk = (it.default_vendor && vdir.byKey[it.default_vendor]) ? it.default_vendor : 'unassigned';
    const row = {
      name: it.label,
      item_code: it.item_code,
      unit: it.unit || '',
      brand: 'both',
      live,
      price_paise: live ? 0 : (it.price_paise || 0),
      alias: (aliasByCode.get(it.item_code) || []).slice(0, 8).join(' '),
    };
    const key = [vk, catalogNameKey(it.label), String(it.unit || '').toLowerCase()].join('|');
    const current = picked.get(key);
    if (!current || catalogPickRank(it) > catalogPickRank(current.raw)) picked.set(key, { vk, row, raw: it });
  }
  const baskets = new Map();
  for (const p of picked.values()) {
    if (!baskets.has(p.vk)) baskets.set(p.vk, []);
    baskets.get(p.vk).push(p.row);
  }
  const vendors = [...baskets.entries()].map(([vk, list]) => ({
    ...(vdir.byKey[vk] || vdir.byKey.unassigned),
    items: list.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => b.items.length - a.items.length);

  const flat = [];
  for (const v of vendors) for (const it of v.items) flat.push({ ...it, vendorKey: v.key, vendorName: v.name });

  return {
    generatedFrom: 'sauda_item master',
    itemCount: flat.length,
    vendorCount: vendors.filter((v) => v.key !== 'unassigned').length,
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
function orderLineSignature(lines) {
  return JSON.stringify((Array.isArray(lines) ? lines : [])
    .map((l) => ({
      sku: String(l.sku || l.item || '').trim().toLowerCase(),
      item: String(l.item || '').trim().toLowerCase(),
      qty: String(l.qty ?? '').trim(),
      unit: String(l.unit || '').trim().toLowerCase(),
      brand: String(l.brand || 'both').trim().toLowerCase(),
    }))
    .sort((a, b) => (a.sku + a.item).localeCompare(b.sku + b.item)));
}
function lineBillingQty(l) {
  if (l && l.bill_qty != null && String(l.bill_qty).trim() !== '') return qtyNum(l.bill_qty);
  if (l && l.billing_qty != null && String(l.billing_qty).trim() !== '') return qtyNum(l.billing_qty);
  if (l && l.live_qty != null && String(l.live_qty).trim() !== '') return qtyNum(l.live_qty);
  return qtyNum(l && l.qty);
}
function purchaseTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((s, l) => s + Math.round(lineBillingQty(l) * (Math.max(0, Math.round(+l.price_paise || 0)))), 0);
}
function ledgerEventType(value) {
  const t = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return ['opening', 'bill', 'payment', 'credit', 'debit', 'adjustment', 'receipt'].includes(t) ? t : 'adjustment';
}
function ledgerEventAmount(e) {
  const src = e || {};
  let amt = Math.round(+src.signed_amount_paise || +src.amount_paise || 0);
  if (!amt && src.amount_rupees != null) amt = Math.round(+src.amount_rupees * 100);
  const type = ledgerEventType(src.event_type || src.type);
  if (type === 'receipt') return 0;
  if (['payment', 'credit'].includes(type)) return -Math.abs(amt);
  if (['opening', 'bill', 'debit'].includes(type)) return Math.abs(amt);
  return amt;
}
function ledgerEventKey(vendorKey, eventDate, type, amount, ref, note) {
  return [vendorKey, eventDate, type, amount, norm(ref || ''), norm(note || '')].join('|').slice(0, 420);
}

// ── Place: one sauda_purchase row per vendor basket ──
// body = { for_date?, lines: [{ item, sku?, qty, unit, vendorKey, brand, price_paise? }] }
// price_paise = the per-unit price staff captured for today's buy. The vendor's
// basket total (expected_amount_paise) is summed from it, so "To pay" is never
// a blank field someone has to re-type — today's prices ARE the bill.
async function placeOrders(db, body, auth, env, context) {
  const forDate = (body.for_date || todayIST()).slice(0, 10);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return { ok: false, error: 'no lines' };
  const vdir = await getVendorDirectory(db);

  // group lines by vendor
  const byVendor = new Map();
  for (const ln of lines) {
    const v = resolveVendor(vdir, ln.vendorKey);
    const vk = v.key;
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
  let inserted = 0;
  let duplicates = 0;
  for (const [vk, vlines] of byVendor.entries()) {
    const v = vdir.byKey[vk] || vdir.byKey.unassigned;
    const expected = vlines.reduce((s, l) => s + Math.round(qtyNum(l.qty) * (l.price_paise || 0)), 0);
    const sig = orderLineSignature(vlines);
    const existing = ((await db.prepare(
      `SELECT id, items_json, expected_amount_paise, status
         FROM sauda_purchase
        WHERE vendor_name=? AND for_date=? AND status IN ('ORDERED','REQUESTED','PAID')
        ORDER BY id DESC LIMIT 20`
    ).bind(v.name, forDate).all()).results) || [];
    const dup = existing.find((r) => {
      let old = [];
      try { old = JSON.parse(r.items_json || '[]'); } catch (e) {}
      return orderLineSignature(old) === sig;
    });
    if (dup) {
      duplicates += 1;
      created.push({ vendor: v.name, vendorKey: vk, fulfilment: v.fulfilment, lines: vlines, expected_amount_paise: expected, id: dup.id, duplicate: true });
      continue;
    }
    const res = await db.prepare(
      `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, expected_amount_paise, ordered_at, ordered_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      v.brand || 'both', v.name, forDate, v.fulfilment, v.pay,
      JSON.stringify(vlines), 'ORDERED', expected, nowIso, (auth && auth.u) || ''
    ).run();
    created.push({ vendor: v.name, vendorKey: vk, fulfilment: v.fulfilment, lines: vlines, expected_amount_paise: expected, id: res?.meta?.last_row_id });
    inserted += 1;
  }

  // Notify the runner: collect items → Basheer (he goes & buys); everything else
  // → Zoya (places it with the vendor for delivery). Non-blocking + fail-safe.
  const notifyCreated = created.filter((c) => !c.duplicate);
  try {
    if (notifyCreated.length) {
      const p = notifyOnPlace(env, notifyCreated, forDate);
      if (context && context.waitUntil) context.waitUntil(p);
    }
  } catch (e) {}

  return {
    ok: true, for_date: forDate, placed: inserted, duplicates,
    orders: created.map((c) => ({ vendor: c.vendor, vendorKey: c.vendorKey, lines: c.lines.length, expected_amount_paise: c.expected_amount_paise, id: c.id, duplicate: !!c.duplicate })),
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
const VENDOR_ODOO_PARTNERS = { afeefa: 11 };
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

const MN_BROILERS_CHICKEN = [
  {
    item_code: 'HE_BONELESS',
    label: 'Boneless chicken',
    unit: 'kg',
    aliases: ['boneless chicken', 'boneless', 'chicken boneless'],
  },
  {
    item_code: 'HE_SHAWARMA',
    label: 'Shawarma chicken',
    unit: 'kg',
    aliases: ['shawarma chicken', 'shawarama chicken', 'chicken shawarma', 'shawarma', 'shawarma chicken boneless', 'boneless shawarma chicken', 'shawarma boneless chicken'],
  },
  {
    item_code: 'HE_KEBAB',
    label: 'Kebab chicken',
    unit: 'birds',
    aliases: ['kebab chicken', 'kabab chicken', 'chicken kebab', 'kebab'],
  },
  {
    item_code: 'HE_TANDOORI',
    label: 'Tandoori chicken',
    unit: 'birds',
    aliases: ['tandoori chicken', 'chicken tandoori', 'tandoori cut'],
  },
  {
    item_code: 'HE_GRILL',
    label: 'Grill chicken',
    unit: 'birds',
    aliases: ['grill chicken'],
  },
  {
    item_code: 'HE_TANGDI',
    label: 'Tangdi (drumstick)',
    unit: 'pc',
    aliases: ['tangdi chicken', 'chicken drumstick', 'drumstick', 'tangdi'],
  },
  {
    item_code: 'HE_LOLLIPOP',
    label: 'Lollipop / wings',
    unit: 'pc',
    aliases: ['lollipop chicken', 'chicken lollipop', 'chicken wings', 'wings', 'lollipop wings'],
  },
];

const LOCAL_VENDOR_ITEMS = [
  {
    item_code: 'NCH_TEA_POWDER',
    label: 'Tea Powder - Liberty Premium',
    unit: 'kg',
    pack_label: '5 kg bag',
    pack_qty: 5,
    price_paise: 47000,
    price_mode: 'fixed',
    form: 'loose',
    brand: 'NCH',
    default_vendor: 'afeefa',
    category: 'Beverage Inputs',
    note: 'Afeefa invoice T-431: effective rate includes 5% IGST; 50 kg = Rs 23,500.',
    aliases: ['tea powder', 'liberty premium', 'liberty premium 5kg', 'afeefa tea', 'afifa tea'],
  },
];
const AFEEFA_BANK = {
  account_name: 'AFEEFA IMPEX AGENCIES',
  account_number: '50200116872951',
  ifsc: 'HDFC0011941',
  bank: 'HDFC Bank',
  branch: 'PERIAMET VEPERY HIGH ROAD BRANCH',
};

async function upsertChickenItems(db, now) {
  const stmts = [];
  for (const item of MN_BROILERS_CHICKEN) {
    stmts.push(db.prepare(`
      INSERT INTO sauda_item (
        item_code, label, unit, pack_label, pack_qty, price_paise, price_mode,
        form, brand, default_vendor, category, cmp_query, cmp_must, cmp_not, cmp_band,
        note, flagged, active, updated_by, updated_at
      ) VALUES (?, ?, ?, '', 1, 0, 'live', 'defined', 'HE', 'mnbroilers', 'Meat & Poultry', '', '[]', '[]', '[]', '', 0, 1, 'seed', ?)
      ON CONFLICT(item_code) DO UPDATE SET
        label=excluded.label,
        unit=excluded.unit,
        pack_label=excluded.pack_label,
        pack_qty=excluded.pack_qty,
        price_paise=excluded.price_paise,
        price_mode=excluded.price_mode,
        form=excluded.form,
        brand=excluded.brand,
        default_vendor=excluded.default_vendor,
        category=excluded.category,
        cmp_query=excluded.cmp_query,
        cmp_must=excluded.cmp_must,
        cmp_not=excluded.cmp_not,
        cmp_band=excluded.cmp_band,
        note=excluded.note,
        flagged=excluded.flagged,
        active=excluded.active,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at
    `).bind(item.item_code, item.label, item.unit, now));
    for (const alias of item.aliases || []) {
      stmts.push(db.prepare(`
        INSERT INTO sauda_item_alias (alias, item_code, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET item_code=excluded.item_code, created_at=excluded.created_at
      `).bind(String(alias).toLowerCase(), item.item_code, now));
    }
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
}

async function upsertLocalVendorItems(db, now) {
  const stmts = [];
  for (const item of LOCAL_VENDOR_ITEMS) {
    stmts.push(db.prepare(`
      INSERT OR IGNORE INTO sauda_item (
        item_code, label, unit, pack_label, pack_qty, price_paise, price_mode,
        form, brand, default_vendor, category, note, flagged, active, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'seed', ?)
    `).bind(
      item.item_code, item.label, item.unit, item.pack_label || '', item.pack_qty || 1,
      item.price_paise || 0, item.price_mode || 'fixed', item.form || 'loose',
      item.brand || '', item.default_vendor || '', item.category || '', item.note || '', now
    ));
    for (const alias of item.aliases || []) {
      stmts.push(db.prepare(`
        INSERT INTO sauda_item_alias (alias, item_code, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET item_code=excluded.item_code, created_at=excluded.created_at
      `).bind(String(alias).toLowerCase(), item.item_code, now));
    }
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
}

async function ensureSettingsTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_item (item_code TEXT PRIMARY KEY, label TEXT, unit TEXT, pack_label TEXT, pack_qty REAL,
      price_paise INTEGER DEFAULT 0, price_mode TEXT DEFAULT 'fixed', form TEXT DEFAULT 'loose', brand TEXT DEFAULT '', default_vendor TEXT DEFAULT '', category TEXT DEFAULT '',
      cmp_query TEXT DEFAULT '', cmp_must TEXT DEFAULT '[]', cmp_not TEXT DEFAULT '[]', cmp_band TEXT DEFAULT '[]',
      flagged INTEGER DEFAULT 0, note TEXT DEFAULT '', active INTEGER DEFAULT 1, updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_item_alias (alias TEXT PRIMARY KEY, item_code TEXT, created_at TEXT DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor (vendor_key TEXT PRIMARY KEY, name TEXT, brand TEXT DEFAULT 'both',
      fulfilment TEXT DEFAULT 'deliver', pay TEXT DEFAULT 'per', phone TEXT DEFAULT '', vpa_json TEXT DEFAULT '[]',
      bank_json TEXT DEFAULT '{}', odoo_partner_id INTEGER, rzp_contact_id TEXT DEFAULT '',
      rzp_fund_account_id TEXT DEFAULT '', rzp_fund_account_mode TEXT DEFAULT '',
      aliases_json TEXT DEFAULT '[]', cat TEXT DEFAULT '', flagged INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '')`),
  ]);
  // add form (loose|defined) + brand to an already-existing table; on first add, the
  // catalog items (packaged buys) become 'defined' SKUs.
  let added = false;
  try { await db.prepare("ALTER TABLE sauda_item ADD COLUMN form TEXT DEFAULT 'loose'").run(); added = true; } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_item ADD COLUMN brand TEXT DEFAULT ''").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_vendor ADD COLUMN bank_json TEXT DEFAULT '{}'").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_vendor ADD COLUMN odoo_partner_id INTEGER").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_vendor ADD COLUMN rzp_contact_id TEXT DEFAULT ''").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_vendor ADD COLUMN rzp_fund_account_id TEXT DEFAULT ''").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE sauda_vendor ADD COLUMN rzp_fund_account_mode TEXT DEFAULT ''").run(); } catch (e) {}
  if (added) {
    const keys = HP_CATALOG.map((c) => c.key);
    try { await db.prepare(`UPDATE sauda_item SET form='defined' WHERE item_code IN (${keys.map(() => '?').join(',')})`).bind(...keys).run(); } catch (e) {}
  }
}

async function seedSettings(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM sauda_item').first();
  const seeded = !(row && row.n > 0);
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const stmts = [];
  for (const [k, v] of Object.entries(VENDORS)) {
    const bankSeed = k === 'afeefa' ? AFEEFA_BANK : {};
    const flagged = (v.vpa || validBankDetails(bankSeed)) ? 0 : 1;
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_vendor (vendor_key,name,brand,fulfilment,pay,phone,vpa_json,bank_json,aliases_json,cat,flagged,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(k, v.name, v.brand || 'both', v.fulfilment, v.pay, VENDOR_PHONES[k] || '', JSON.stringify(v.vpa ? [v.vpa] : []), JSON.stringify(bankSeed), JSON.stringify(v.aliases || []), v.cat || '', flagged, 'seed', now));
  }
  for (const c of HP_CATALOG) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_item (item_code,label,unit,pack_label,pack_qty,price_paise,price_mode,default_vendor,cmp_query,cmp_must,cmp_not,cmp_band,flagged,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(c.key, c.label, c.unit, c.buy.pack, c.buy.qty, c.buy.base_paise, 'fixed', DEFAULT_VENDOR[c.key] || '', c.query, JSON.stringify(c.must || []), JSON.stringify(c.not || []), JSON.stringify(c.band || []), /CONFIRM/i.test(c.label) ? 1 : 0, 'seed', now));
  }
  for (const [code, arr] of Object.entries(ITEM_ALIASES)) for (const a of arr) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO sauda_item_alias (alias,item_code,created_at) VALUES (?,?,?)`).bind(String(a).toLowerCase(), code, now));
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
  for (const [vendorKey, partnerId] of Object.entries(VENDOR_ODOO_PARTNERS)) {
    await db.prepare(`UPDATE sauda_vendor SET odoo_partner_id=COALESCE(odoo_partner_id, ?) WHERE vendor_key=?`)
      .bind(partnerId, vendorKey).run().catch(() => {});
  }
  const afeefaRow = await db.prepare(`SELECT bank_json, flagged FROM sauda_vendor WHERE vendor_key='afeefa'`).first().catch(() => null);
  if (!validBankDetails(afeefaRow && afeefaRow.bank_json) || (afeefaRow && afeefaRow.flagged)) {
    await db.prepare(`UPDATE sauda_vendor SET bank_json=?, flagged=0, updated_by=?, updated_at=? WHERE vendor_key='afeefa'`)
      .bind(JSON.stringify(AFEEFA_BANK), 'seed', now).run().catch(() => {});
  }
  await upsertChickenItems(db, now);
  await upsertLocalVendorItems(db, now);
  return { seeded, vendors: Object.keys(VENDORS).length, items: HP_CATALOG.length + MN_BROILERS_CHICKEN.length + LOCAL_VENDOR_ITEMS.length };
}

const FULFILMENT_LABEL = {
  deliver: 'delivers',
  collect: 'collect',
  standing: 'standing',
  porter: 'porter',
  bus: 'intercity',
};
const PAY_LABEL = {
  per: 'pay per order',
  khata_roll: 'khata',
  khata_periodic: 'khata (weekly)',
};
function jsonArray(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : []; } catch (e) { return []; }
}
function jsonObject(s) {
  try { const o = typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
function cleanBankDetails(raw, prev) {
  const src = jsonObject(raw);
  const old = jsonObject(prev);
  const val = (k, fallback) => String(src[k] != null ? src[k] : (fallback != null ? fallback : '')).trim();
  const accountNumber = val('account_number', '');
  const bank = {
    account_name: val('account_name', val('name', '')),
    account_number: accountNumber.replace(/\s+/g, ''),
    ifsc: val('ifsc', '').toUpperCase().replace(/\s+/g, ''),
    bank: val('bank', ''),
    branch: val('branch', ''),
    qr_ref: val('qr_ref', ''),
    source: val('source', ''),
  };
  if (!bank.account_number && val('account_last4', '')) bank.account_last4 = val('account_last4', '');
  else if (bank.account_number) bank.account_last4 = bank.account_number.slice(-4);
  if (!bank.bank && old.bank && !('bank' in src)) bank.bank = old.bank;
  Object.keys(bank).forEach((k) => { if (!bank[k]) delete bank[k]; });
  return bank;
}
function vendorKeyBase(s) {
  const slug = String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 42);
  return slug || 'vendor';
}
async function uniqueVendorKey(db, name) {
  const base = vendorKeyBase(name);
  let key = base, n = 1;
  while (await db.prepare('SELECT 1 FROM sauda_vendor WHERE vendor_key=?').bind(key).first()) key = (base + '_' + (++n)).slice(0, 48);
  return key;
}
function cleanVpas(vpas, vpa) {
  const raw = Array.isArray(vpas) ? vpas : (vpa ? [vpa] : []);
  return raw.map((x) => String(x || '').trim()).filter(Boolean);
}
function validPhone(phone) {
  return String(phone || '').replace(/\D/g, '').length >= 10;
}
function validVpaList(vpas) {
  return Array.isArray(vpas) && vpas.some((x) => /@/.test(String(x || '')));
}
function validBankDetails(bank) {
  const b = jsonObject(bank);
  return !!(String(b.account_number || '').trim() && String(b.ifsc || '').trim() && String(b.account_name || '').trim());
}
function hasPaymentRail(v) {
  return !!((v && v.vpa) || validBankDetails(v && v.bank));
}
function bankLabel(bank) {
  const b = jsonObject(bank);
  if (!Object.keys(b).length) return '';
  const last4 = b.account_last4 || (b.account_number ? String(b.account_number).slice(-4) : '');
  return [b.bank || 'Bank', last4 ? ('a/c ' + last4) : '', b.ifsc || ''].filter(Boolean).join(' · ');
}
function payRail(v) {
  if (v && v.vpa) return 'upi';
  if (validBankDetails(v && v.bank)) return 'bank';
  return 'manual';
}
function vendorFromRow(r) {
  const vpas = jsonArray(r.vpa_json);
  const aliases = jsonArray(r.aliases_json);
  const bank = cleanBankDetails(r.bank_json || '{}');
  const fulfilment = r.fulfilment || 'deliver';
  const pay = r.pay || 'per';
  const v = {
    key: r.vendor_key,
    name: r.name || r.vendor_key,
    brand: r.brand || 'both',
    fulfilment,
    pay,
    phone: r.phone || '',
    vpas,
    vpa: vpas[0] || '',
    bank,
    bankLabel: bankLabel(bank),
    odoo_partner_id: r.odoo_partner_id || null,
    aliases,
    cat: r.cat || '',
    flagged: r.flagged ? 1 : 0,
    fulfilmentLabel: FULFILMENT_LABEL[fulfilment] || fulfilment,
    payLabel: PAY_LABEL[pay] || pay,
  };
  v.payRail = payRail(v);
  return v;
}
async function getVendorDirectory(db) {
  await ensureSettingsTables(db);
  await seedSettings(db);
  const rows = ((await db.prepare(`SELECT vendor_key,name,brand,fulfilment,pay,phone,vpa_json,bank_json,odoo_partner_id,aliases_json,cat,flagged FROM sauda_vendor WHERE active=1 ORDER BY name`).all()).results) || [];
  const byKey = { unassigned: vendorView('unassigned') };
  const byAlias = {};
  for (const r of rows) {
    const v = vendorFromRow(r);
    byKey[v.key] = v;
    byAlias[norm(v.key)] = v;
    byAlias[norm(v.name)] = v;
    for (const a of v.aliases || []) byAlias[norm(a)] = v;
  }
  return { byKey, byAlias, list: Object.values(byKey) };
}
function resolveVendor(vdir, raw) {
  const key = String(raw || '').trim();
  if (key && vdir.byKey[key]) return vdir.byKey[key];
  const canonical = canonVendorKey(key);
  if (canonical && vdir.byKey[canonical]) return vdir.byKey[canonical];
  const alias = norm(key);
  if (alias && vdir.byAlias[alias]) return vdir.byAlias[alias];
  return vdir.byKey.unassigned;
}

async function getSettings(db) {
  await ensureSettingsTables(db);
  const seed = await seedSettings(db);
  const items = ((await db.prepare(`SELECT item_code,label,unit,pack_label,pack_qty,price_paise,price_mode,form,brand,default_vendor,category,flagged,note FROM sauda_item WHERE active=1 ORDER BY label`).all()).results) || [];
  const vendors = ((await db.prepare(`SELECT vendor_key,name,brand,fulfilment,pay,phone,vpa_json,bank_json,odoo_partner_id,aliases_json,cat,flagged FROM sauda_vendor WHERE active=1 ORDER BY name`).all()).results) || [];
  const aliasRows = ((await db.prepare(`SELECT alias,item_code FROM sauda_item_alias`).all()).results) || [];
  const aliasByItem = {};
  for (const r of aliasRows) (aliasByItem[r.item_code] = aliasByItem[r.item_code] || []).push(r.alias);
  for (const it of items) it.aliases = aliasByItem[it.item_code] || [];
  for (const v of vendors) {
    v.vpas = jsonArray(v.vpa_json);
    v.aliases = jsonArray(v.aliases_json);
    v.bank = cleanBankDetails(v.bank_json || '{}');
    v.bankLabel = bankLabel(v.bank);
    v.payRail = v.vpas[0] ? 'upi' : (validBankDetails(v.bank) ? 'bank' : 'manual');
  }
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
    const targetVendor = String((body && body.default_vendor) || '').trim();
    if (targetVendor) {
      const rows = ((await db.prepare(`SELECT item_code,label,unit,default_vendor FROM sauda_item WHERE active=1 AND default_vendor=?`).bind(targetVendor).all()).results) || [];
      const nextKey = [targetVendor, catalogNameKey(label), String((body && body.unit) || '').toLowerCase()].join('|');
      const existing = rows.find((r) => [targetVendor, catalogNameKey(r.label), String(r.unit || '').toLowerCase()].join('|') === nextKey);
      if (existing) return { ok: true, item_code: existing.item_code, created: false, duplicate: true };
    }
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
async function settingsVendor(db, body, auth) {
  await ensureSettingsTables(db);
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const by = (auth && auth.u) || '';
  let key = String((body && body.vendor_key) || '').trim();
  const vpas = cleanVpas(body && body.vpas, body && body.vpa);
  const bodyHasBank = body && ('bank' in body || 'bank_json' in body);
  const bank = bodyHasBank ? cleanBankDetails((body && (body.bank || body.bank_json)) || {}) : {};
  const phone = String((body && body.phone) || '').trim();
  if (!key || key === 'NEW') {
    const name = String((body && body.name) || '').trim();
    if (!name) return { ok: false, error: 'vendor name required' };
    if (!validPhone(phone)) return { ok: false, error: 'vendor phone required' };
    if (!validVpaList(vpas) && !validBankDetails(bank)) return { ok: false, error: 'vendor UPI or bank account required' };
    key = await uniqueVendorKey(db, name);
    await db.prepare(`INSERT INTO sauda_vendor (vendor_key,name,brand,fulfilment,pay,phone,vpa_json,bank_json,odoo_partner_id,aliases_json,cat,flagged,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      key, name, body.brand || 'both', body.fulfilment || 'deliver', body.pay || 'per',
      phone, JSON.stringify(vpas), JSON.stringify(bank), Number(body && body.odoo_partner_id) || null,
      JSON.stringify(cleanVpas(body && body.aliases)), body.cat || '', 0, by, now
    ).run();
    return { ok: true, created: true, vendor_key: key, vendor: vendorFromRow({
      vendor_key: key, name, brand: body.brand || 'both', fulfilment: body.fulfilment || 'deliver',
      pay: body.pay || 'per', phone, vpa_json: JSON.stringify(vpas), aliases_json: JSON.stringify(cleanVpas(body && body.aliases)),
      bank_json: JSON.stringify(bank), odoo_partner_id: Number(body && body.odoo_partner_id) || null, cat: body.cat || '', flagged: 0,
    }) };
  }
  const existing = await db.prepare('SELECT * FROM sauda_vendor WHERE vendor_key=? AND active=1').bind(key).first();
  if (!existing) return { ok: false, error: 'vendor not found' };
  const nextPhone = ('phone' in body) ? phone : (existing.phone || '');
  const nextVpas = ('vpas' in body || 'vpa' in body) ? vpas : jsonArray(existing.vpa_json);
  const nextBank = bodyHasBank ? bank : cleanBankDetails(existing.bank_json || '{}');
  if (!validPhone(nextPhone) && !validBankDetails(nextBank)) return { ok: false, error: 'vendor phone required' };
  if (!validVpaList(nextVpas) && !validBankDetails(nextBank)) return { ok: false, error: 'vendor UPI or bank account required' };
  const sets = [], vals = [];
  if ('name' in body) { sets.push('name=?'); vals.push(String(body.name || '')); }
  if ('brand' in body) { sets.push('brand=?'); vals.push(String(body.brand || 'both')); }
  if ('cat' in body) { sets.push('cat=?'); vals.push(String(body.cat || '')); }
  if ('phone' in body) { sets.push('phone=?'); vals.push(nextPhone); }
  if ('vpas' in body || 'vpa' in body) { sets.push('vpa_json=?'); vals.push(JSON.stringify(nextVpas)); }
  if (bodyHasBank) { sets.push('bank_json=?'); vals.push(JSON.stringify(nextBank)); }
  if ('odoo_partner_id' in body) { sets.push('odoo_partner_id=?'); vals.push(Number(body.odoo_partner_id) || null); }
  if ('fulfilment' in body) { sets.push('fulfilment=?'); vals.push(String(body.fulfilment || 'deliver')); }
  if ('pay' in body) { sets.push('pay=?'); vals.push(String(body.pay || 'per')); }
  if ('aliases' in body) { const a = Array.isArray(body.aliases) ? body.aliases.map((x) => String(x).trim()).filter(Boolean) : []; sets.push('aliases_json=?'); vals.push(JSON.stringify(a)); }
  if ('flagged' in body) { sets.push('flagged=?'); vals.push(body.flagged ? 1 : 0); }
  if (!sets.length) return { ok: false, error: 'nothing to update' };
  sets.push('updated_by=?', 'updated_at=?'); vals.push(by, now);
  await db.prepare(`UPDATE sauda_vendor SET ${sets.join(', ')} WHERE vendor_key=?`).bind(...vals, key).run();
  return { ok: true };
}

// ── Per-vendor records: count, paid, outstanding, and the full trail (timestamps + method) ──
// Reads the same sauda_purchase rows; online (prepaid Hyperpure) excluded. This is
// the "every record for a vendor" view: how much is paid, how much is left, when.
// catch-up reconcile: bank email alerts lag, so retry matching any PAID-but-unconfirmed
// order against the feed whenever the records are viewed (self-heals delayed confirmations).
async function ensureVendorEventTable(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      amount_paise INTEGER NOT NULL DEFAULT 0,
      ref TEXT DEFAULT '',
      note TEXT DEFAULT '',
      source TEXT DEFAULT 'manual',
      bank_event_id INTEGER DEFAULT NULL,
      bank_ref TEXT DEFAULT '',
      reconciled_at TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      event_key TEXT UNIQUE,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sauda_vendor_event_vendor_date ON sauda_vendor_event(vendor_key,event_date)`),
  ]);
  try { await db.prepare(`ALTER TABLE sauda_vendor_event ADD COLUMN bank_event_id INTEGER DEFAULT NULL`).run(); } catch (e) {}
  try { await db.prepare(`ALTER TABLE sauda_vendor_event ADD COLUMN bank_ref TEXT DEFAULT ''`).run(); } catch (e) {}
  try { await db.prepare(`ALTER TABLE sauda_vendor_event ADD COLUMN reconciled_at TEXT DEFAULT ''`).run(); } catch (e) {}
}
async function ensureVendorAttachmentTable(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor_attachment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_event_id INTEGER NOT NULL,
      vendor_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'invoice',
      r2_key TEXT NOT NULL,
      filename TEXT DEFAULT '',
      mimetype TEXT DEFAULT '',
      file_size_kb INTEGER DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sauda_vendor_attachment_event_kind ON sauda_vendor_attachment(vendor_event_id, kind)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sauda_vendor_attachment_vendor ON sauda_vendor_attachment(vendor_key, created_at DESC)`),
  ]);
}
function parseAttachmentPayload(raw) {
  const att = raw && (raw.attachment || raw.file || raw.media);
  if (!att) return null;
  const rawData = String(att.data_url || att.dataUrl || att.data_b64 || att.base64 || '').trim();
  if (!rawData) return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(rawData);
  const mime = String(att.mimetype || att.mimeType || (m && m[1]) || '').trim() || 'application/octet-stream';
  const base64 = m ? m[2] : rawData.replace(/^.*base64,/, '');
  return {
    name: String(att.name || att.filename || att.file_name || 'invoice').trim() || 'invoice',
    mimetype: mime,
    base64,
  };
}
function attachmentExt(name, mime) {
  const n = String(name || '').toLowerCase();
  const fromName = n.includes('.') ? n.split('.').pop() : '';
  if (fromName && fromName.length <= 5) return fromName;
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'bin';
}
function safeFilePart(s, max) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max || 80) || 'invoice';
}
async function storeVendorAttachment(db, env, vendorKey, eventId, attachment, eventDate, by) {
  if (!env?.EVIDENCE || !attachment || !attachment.base64 || !eventId) return null;
  const bytes = Uint8Array.from(atob(attachment.base64), (c) => c.charCodeAt(0));
  const sizeKb = Math.max(1, Math.round(bytes.length / 1024));
  const fileName = String(attachment.name || 'invoice').trim() || 'invoice';
  const ext = attachmentExt(fileName, attachment.mimetype);
  const r2Key = [
    'sauda',
    safeFilePart(vendorKey, 40),
    String(eventDate || todayIST()).slice(0, 10),
    `${Date.now()}-${safeFilePart(fileName, 40)}.${ext}`,
  ].join('/');
  await env.EVIDENCE.put(r2Key, bytes, {
    httpMetadata: {
      contentType: attachment.mimetype || 'application/octet-stream',
      contentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"`,
    },
  });
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    `INSERT INTO sauda_vendor_attachment (vendor_event_id,vendor_key,kind,r2_key,filename,mimetype,file_size_kb,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(vendor_event_id, kind) DO UPDATE SET
       vendor_key=excluded.vendor_key,
       r2_key=excluded.r2_key,
       filename=excluded.filename,
       mimetype=excluded.mimetype,
       file_size_kb=excluded.file_size_kb,
       created_by=excluded.created_by,
       created_at=excluded.created_at`
  ).bind(eventId, vendorKey, 'invoice', r2Key, fileName, attachment.mimetype || 'application/octet-stream', sizeKb, by || '', now).run();
  return { r2_key: r2Key, filename: fileName, mimetype: attachment.mimetype || 'application/octet-stream', file_size_kb: sizeKb };
}
async function vendorEvent(db, body, auth, env) {
  await ensureVendorEventTable(db);
  await ensureVendorAttachmentTable(db);
  const vdir = await getVendorDirectory(db);
  const rows = Array.isArray(body && body.events) ? body.events : [body || {}];
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const by = (auth && auth.u) || '';
  const out = [];
  for (const raw of rows) {
    const v = resolveVendor(vdir, (raw && (raw.vendor_key || raw.vendorKey || raw.vendor_name || raw.vendor)) || (body && (body.vendor_key || body.vendorKey || body.vendor_name || body.vendor)));
    if (!v || v.key === 'unassigned') return { ok: false, error: 'unknown vendor' };
    const eventDate = String((raw && (raw.event_date || raw.date)) || todayIST()).slice(0, 10);
    const type = ledgerEventType(raw && (raw.event_type || raw.type));
    const amount = ledgerEventAmount({ ...(raw || {}), event_type: type });
    if (!amount && type !== 'receipt') return { ok: false, error: 'amount required', vendor: v.name };
    const ref = String((raw && (raw.ref || raw.invoice_ref || raw.invoice_no)) || '').trim().slice(0, 120);
    const note = String((raw && raw.note) || '').trim().slice(0, 500);
    const source = String((raw && raw.source) || (body && body.source) || 'manual').trim().slice(0, 40);
    const key = String((raw && raw.event_key) || ledgerEventKey(v.key, eventDate, type, amount, ref, note));
    await db.prepare(
      `INSERT INTO sauda_vendor_event (vendor_key,event_type,event_date,amount_paise,ref,note,source,active,event_key,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(event_key) DO UPDATE SET
         amount_paise=excluded.amount_paise,
         ref=excluded.ref,
         note=excluded.note,
         source=excluded.source,
         active=excluded.active,
         updated_at=excluded.updated_at`
    ).bind(v.key, type, eventDate, amount, ref, note, source, raw && raw.active === false ? 0 : 1, key, by, now, now).run();
    const row = await db.prepare(`SELECT id, bank_event_id, bank_ref, reconciled_at FROM sauda_vendor_event WHERE event_key=?`).bind(key).first();
    const attInfo = parseAttachmentPayload(raw);
    let attachment = null;
    if (attInfo) attachment = await storeVendorAttachment(db, env || {}, v.key, row && row.id, attInfo, eventDate, by);
    let reconciled = row && row.reconciled_at ? { bank_ref: row.bank_ref || '', txn_at: '' } : null;
    if (!reconciled && amount < 0 && hasPaymentRail(v)) {
      const m = await findVendorDebit(db, v, Math.abs(amount), eventDate);
      if (m && row && row.id) {
        await db.prepare(`UPDATE sauda_vendor_event SET bank_event_id=?, bank_ref=?, reconciled_at=?, updated_at=? WHERE id=?`)
          .bind(m.bank_event_id, m.bank_ref, now, now, row.id).run();
        reconciled = { bank_ref: m.bank_ref, txn_at: m.txn_at };
      }
    }
    out.push({
      id: row?.id || null,
      vendorKey: v.key,
      vendor: v.name,
      event_type: type,
      event_date: eventDate,
      amount_paise: amount,
      ref,
      note,
      bank_ref: reconciled ? reconciled.bank_ref : (row?.bank_ref || ''),
      reconciled: !!(reconciled || row?.reconciled_at),
      attachment_count: attachment ? 1 : 0,
      attachment,
    });
  }
  return { ok: true, count: out.length, events: out };
}
async function reconcileSweep(db, sinceFloor) {
  const vdir = await getVendorDirectory(db);
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
    const v = resolveVendor(vdir, r.vendor_name);
    const amt = r.pay_amount_paise || r.expected_amount_paise || 0;
    if (!hasPaymentRail(v) || !amt) continue;
    const since = String(r.pay_requested_at || r.ordered_at || '').slice(0, 10) || '2000-01-01';
    const m = await findVendorDebit(db, v, amt, since);
    if (m) { try { await db.prepare(`UPDATE sauda_purchase SET bank_event_id=?, bank_ref=?, reconciled_at=? WHERE id=?`).bind(m.bank_event_id, m.bank_ref, now, r.id).run(); } catch (e) {} }
  }
}

async function vendorLedger(db, days) {
  const since = `date('now','-${days} days')`;
  await autoSettle(db);   // live: settle anything the bank now confirms (orders + direct pays)
  await ensureVendorEventTable(db);
  await ensureVendorAttachmentTable(db);
  const vdir = await getVendorDirectory(db);
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
    const vk = resolveVendor(vdir, r.vendor_name).key;
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push(r);
  }

  let eventRows = [];
  try {
    eventRows = ((await db.prepare(
      `SELECT id, vendor_key, event_type, event_date, amount_paise, ref, note, source, bank_event_id, bank_ref, reconciled_at, created_at
         FROM sauda_vendor_event
        WHERE active=1
        ORDER BY event_date DESC, id DESC`
    ).all()).results) || [];
  } catch (e) { eventRows = []; }
  let attRows = [];
  try {
    attRows = ((await db.prepare(
      `SELECT id, vendor_event_id, kind, filename, mimetype, file_size_kb, created_at
         FROM sauda_vendor_attachment
        ORDER BY created_at DESC, id DESC`
    ).all()).results) || [];
  } catch (e) { attRows = []; }
  const attByEvent = new Map();
  for (const a of attRows) {
    if (!attByEvent.has(a.vendor_event_id)) attByEvent.set(a.vendor_event_id, []);
    attByEvent.get(a.vendor_event_id).push({
      id: a.id, kind: a.kind || 'invoice', filename: a.filename || '',
      mimetype: a.mimetype || '', file_size_kb: a.file_size_kb || 0, created_at: a.created_at || '',
    });
  }
  const byEvent = new Map();
  for (const e of eventRows) {
    const vk = resolveVendor(vdir, e.vendor_key).key;
    e.attachments = attByEvent.get(e.id) || [];
    e.attachment_count = e.attachments.length;
    if (!byEvent.has(vk)) byEvent.set(vk, []);
    byEvent.get(vk).push(e);
  }

  function summarize(vk, list, events) {
    const v = vdir.byKey[vk] || vdir.byKey.unassigned;
    let paid = 0, billed = 0, outstanding = 0, lastPaidAt = '';
    const trail = [];
    for (const e of events) {
      const signed = Math.round(+e.amount_paise || 0);
      if (signed < 0) { paid += Math.abs(signed); if (e.event_date && e.event_date > lastPaidAt) lastPaidAt = e.event_date; }
      else billed += signed;
      outstanding += signed;
      const status = String(e.event_type || 'event').toUpperCase();
      const hasAtt = Number(e.attachment_count || 0) > 0;
      trail.push({
        id: 'event-' + e.id, event: true, for_date: e.event_date, status,
        amount_paise: Math.abs(signed), signed_amount_paise: signed, items: 0,
        ordered_at: e.event_date || e.created_at || '', pay_requested_at: '',
        paid_at: signed < 0 ? (e.reconciled_at || e.event_date || '') : '', method: e.event_type || '',
        reconciled: !!e.reconciled_at, ref: e.ref || '', bank_ref: e.bank_ref || '', note: e.note || '', source: e.source || '',
        attachment_count: hasAtt ? e.attachment_count : 0,
        attachments: e.attachments || [],
      });
    }
    for (const r of list) {
      const amt = (r.pay_amount_paise || r.expected_amount_paise || 0);
      const isPaid = !!r.paid_at || r.status === 'PAID';
      billed += amt;
      if (isPaid) { paid += amt; if (r.paid_at && r.paid_at > lastPaidAt) lastPaidAt = r.paid_at; }
      else outstanding += amt;
      let items = [];
      try { items = JSON.parse(r.items_json || '[]'); } catch (e) {}
      const itemCount = Array.isArray(items) ? items.length : 0;
      trail.push({
        id: r.id, for_date: r.for_date, status: r.status, amount_paise: amt, items: itemCount,
        ordered_at: r.ordered_at || '', pay_requested_at: r.pay_requested_at || '',
        paid_at: r.paid_at || '', method: r.pay_method || '',
        reconciled: !!r.reconciled_at, bank_ref: r.bank_ref || '',
        lines: (Array.isArray(items) ? items : []).map((i) => ({
          item: i.item || i.name || '',
          qty: i.qty == null ? '' : String(i.qty),
          unit: i.unit || '',
          price_paise: Math.max(0, Math.round(+i.price_paise || 0)),
          direct: !!i.direct,
          ref: i.ref || i.invoice_ref || '',
        })),
      });
    }
    trail.sort((a, b) => String(b.paid_at || b.pay_requested_at || b.ordered_at || b.for_date || '').localeCompare(String(a.paid_at || a.pay_requested_at || a.ordered_at || a.for_date || '')));
    return {
      vendorKey: v.key, vendor_name: v.name, cat: v.cat || '', vpa: v.vpa || '',
      bank: v.bank || {}, bankLabel: v.bankLabel || '', payRail: v.payRail || payRail(v),
      fulfilmentLabel: v.fulfilmentLabel, payLabel: v.payLabel, pay: v.pay,
      order_count: list.length, ledger_event_count: events.length, entry_count: list.length + events.length,
      billed_paise: billed, paid_paise: paid, outstanding_paise: outstanding,
      last_paid_at: lastPaidAt, trail,
    };
  }

  // EVERY canonical vendor appears (with its UPI id) so this tab is also the
  // pay-any-vendor directory; plus any 'unassigned' bucket that has orders.
  const vendors = vdir.list.filter((v) => v.key !== 'unassigned').map((v) => summarize(v.key, byVendor.get(v.key) || [], byEvent.get(v.key) || []));
  if (byVendor.has('unassigned') || byEvent.has('unassigned')) vendors.push(summarize('unassigned', byVendor.get('unassigned') || [], byEvent.get('unassigned') || []));
  vendors.sort((a, b) =>
    (b.outstanding_paise - a.outstanding_paise) ||
    (b.order_count - a.order_count) ||
    a.vendor_name.localeCompare(b.vendor_name));
  return { ok: true, days, vendors };
}
async function vendorMedia(env, db, url, auth) {
  await ensureVendorAttachmentTable(db);
  const id = Math.round(+url.searchParams.get('id') || 0);
  if (!id) return json({ ok: false, error: 'id required' }, 400);
  const row = await db.prepare(
    `SELECT id, vendor_key, kind, r2_key, filename, mimetype, file_size_kb, created_at
       FROM sauda_vendor_attachment WHERE id=?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: 'not found' }, 404);
  if (!env?.EVIDENCE) return json({ ok: false, error: 'storage not configured' }, 500);
  const obj = await env.EVIDENCE.get(row.r2_key);
  if (!obj) return json({ ok: false, error: 'file missing' }, 404);
  return new Response(await obj.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': row.mimetype || obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${String(row.filename || 'invoice').replace(/"/g, '')}"`,
    },
  });
}

// ── Owner "to pay": ONE consolidated payment per vendor ──
// All of a vendor's unpaid items (across every order placed that day) merge into
// a single card with one summed amount and one UPI — never per-item payments.
// Hyperpure orders are prepaid online at checkout, so they never enter the list.
async function openOrders(db) {
  const vdir = await getVendorDirectory(db);
  const rows = await db.prepare(
    `SELECT id, brand, vendor_name, fulfilment, pay_timing, items_json, status, pay_amount_paise, expected_amount_paise, for_date
       FROM sauda_purchase WHERE paid_at IS NULL AND (pay_timing IS NULL OR pay_timing != 'online')
        ORDER BY for_date DESC, id DESC LIMIT 200`
  ).all();
  // group every unpaid row under its canonical vendor
  const byVendor = new Map();
  for (const o of (rows?.results || [])) {
    const vk = resolveVendor(vdir, o.vendor_name).key;
    if (!byVendor.has(vk)) byVendor.set(vk, []);
    byVendor.get(vk).push(o);
  }
  const orders = [];
  for (const [vk, list] of byVendor.entries()) {
    const v = vdir.byKey[vk] || vdir.byKey.unassigned;
    let items = [], amount = 0; const ids = []; const dates = new Set();
    for (const o of list) {
      ids.push(o.id);
      try {
        const parsed = JSON.parse(o.items_json || '[]');
        parsed.forEach((it, idx) => items.push({ ...it, order_id: o.id, line_idx: idx }));
      } catch (e) {}
      amount += (o.pay_amount_paise || o.expected_amount_paise || 0);
      if (o.for_date) dates.add(o.for_date);
    }
    const forDates = [...dates].sort();
    orders.push({
      ids, order_count: list.length,
      vendorKey: v.key, vendor_name: v.name, brand: list[0].brand,
      vpa: v.vpa || '', bank: v.bank || {}, bankLabel: v.bankLabel || '', payRail: v.payRail || payRail(v),
      cat: v.cat || '', fulfilmentLabel: v.fulfilmentLabel, payLabel: v.payLabel, pay: v.pay,
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

async function recordReceiptEvent(db, env, vendorKey, eventDate, orderIds, amountPaise, ref, attachment, by) {
  await ensureVendorEventTable(db);
  await ensureVendorAttachmentTable(db);
  const date = String(eventDate || todayIST()).slice(0, 10);
  const ids = Array.isArray(orderIds) ? orderIds.map((x) => Math.round(+x || 0)).filter(Boolean).sort((a, b) => a - b) : [];
  const cleanRef = String(ref || '').trim().slice(0, 120);
  const note = `Receipt/rates saved for order${ids.length === 1 ? '' : 's'} ${ids.join(', ')}${amountPaise ? `; bill Rs ${(amountPaise / 100).toLocaleString('en-IN')}` : ''}`;
  const key = ['receipt', vendorKey, date, ids.join(','), norm(cleanRef)].join('|').slice(0, 420);
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    `INSERT INTO sauda_vendor_event (vendor_key,event_type,event_date,amount_paise,ref,note,source,active,event_key,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(event_key) DO UPDATE SET
       ref=excluded.ref,
       note=excluded.note,
       active=excluded.active,
       updated_at=excluded.updated_at`
  ).bind(vendorKey, 'receipt', date, 0, cleanRef, note, 'purchase_prices_ui', 1, key, by || '', now, now).run();
  const row = await db.prepare(`SELECT id FROM sauda_vendor_event WHERE event_key=?`).bind(key).first();
  const attInfo = parseAttachmentPayload({ attachment });
  if (attInfo && row && row.id) await storeVendorAttachment(db, env || {}, vendorKey, row.id, attInfo, date, by || '');
  return { id: row?.id || null, event_date: date, ref: cleanRef, attachment_count: attInfo ? 1 : 0 };
}

function cleanLineField(v, max = 80) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function applyReceiptFields(item, u, now, by) {
  let changed = 0;
  if (Object.prototype.hasOwnProperty.call(u, 'received_qty')) {
    item.received_qty = cleanLineField(u.received_qty, 32);
    item.received_unit = cleanLineField(u.received_unit || item.received_unit || 'kg', 16);
    changed++;
  }
  if (Object.prototype.hasOwnProperty.call(u, 'received_pieces')) {
    item.received_pieces = cleanLineField(u.received_pieces, 32);
    changed++;
  }
  if (Object.prototype.hasOwnProperty.call(u, 'received_note')) {
    item.received_note = cleanLineField(u.received_note, 160);
    changed++;
  }
  if (changed) {
    item.received_at = now;
    item.received_by = by || '';
  }
  return changed;
}

// Receiving is an operational day trail, not a payment event. It keeps what
// arrived on the order line and leaves the vendor diary/payment ledger alone.
async function purchaseReceipt(db, body, auth) {
  const updates = Array.isArray(body && body.lines) ? body.lines : [];
  if (!updates.length) return { ok: false, error: 'no receipt lines' };
  const byId = new Map();
  for (const u of updates) {
    const id = Math.round(+u.id || +u.order_id || 0);
    const idx = Math.round(+u.line_idx);
    if (!id || !Number.isFinite(idx) || idx < 0) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ ...u, line_idx: idx });
  }
  if (!byId.size) return { ok: false, error: 'no valid receipt lines' };

  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const by = (auth && auth.u) || '';
  let changed = 0;
  const orders = [];
  for (const [id, lines] of byId.entries()) {
    const row = await db.prepare(
      `SELECT id, vendor_name, for_date, items_json, paid_at FROM sauda_purchase
        WHERE id=? AND (pay_timing IS NULL OR pay_timing != 'online')`
    ).bind(id).first();
    if (!row) continue;
    if (row.paid_at) return { ok: false, error: 'already paid; cannot change receipt lines', id };
    let items = [];
    try { items = JSON.parse(row.items_json || '[]'); } catch (e) {}
    for (const u of lines) {
      if (!items[u.line_idx]) continue;
      changed += applyReceiptFields(items[u.line_idx], u, now, by);
    }
    await db.prepare(`UPDATE sauda_purchase SET items_json=?, updated_at=? WHERE id=?`)
      .bind(JSON.stringify(items), now, id).run();
    orders.push({ id, vendor_name: row.vendor_name || '', for_date: row.for_date || '', items: items.length });
  }
  return { ok: true, changed, orders, updated_by: by };
}

// Live-priced vendors (chicken, mutton, vegetables) can receive the rate later
// in the day. The bill amount must then be recomputed from the saved order lines,
// not typed as an unrelated total.
async function purchasePrices(db, body, auth, env) {
  const updates = Array.isArray(body && body.lines) ? body.lines : [];
  if (!updates.length) return { ok: false, error: 'no rate lines' };
  const byId = new Map();
  for (const u of updates) {
    const id = Math.round(+u.id || +u.order_id || 0);
    const idx = Math.round(+u.line_idx);
    if (!id || !Number.isFinite(idx) || idx < 0) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({
      ...u,
      line_idx: idx,
      price_paise: Math.max(0, Math.round(+u.price_paise || 0)),
      qty: u.qty == null ? null : String(u.qty).trim(),
      bill_qty: u.bill_qty == null ? null : cleanLineField(u.bill_qty, 32),
      bill_unit: u.bill_unit == null ? null : cleanLineField(u.bill_unit, 16),
    });
  }
  if (!byId.size) return { ok: false, error: 'no valid rate lines' };

  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
  let changed = 0;
  let total = 0;
  const orders = [];
  const vdir = await getVendorDirectory(db);
  for (const [id, lines] of byId.entries()) {
    const row = await db.prepare(
      `SELECT id, vendor_name, for_date, items_json, status, paid_at FROM sauda_purchase
        WHERE id=? AND (pay_timing IS NULL OR pay_timing != 'online')`
    ).bind(id).first();
    if (!row) continue;
    if (row.paid_at) return { ok: false, error: 'already paid; cannot change bill lines', id };
    let items = [];
    try { items = JSON.parse(row.items_json || '[]'); } catch (e) {}
    for (const u of lines) {
      if (!items[u.line_idx]) continue;
      applyReceiptFields(items[u.line_idx], u, now, (auth && auth.u) || '');
      items[u.line_idx].price_paise = u.price_paise;
      if (u.qty !== null && u.qty !== '') items[u.line_idx].qty = u.qty;
      if (u.bill_qty !== null && u.bill_qty !== '') items[u.line_idx].bill_qty = u.bill_qty;
      if (u.bill_unit !== null && u.bill_unit !== '') items[u.line_idx].bill_unit = u.bill_unit;
      changed += 1;
    }
    const expected = purchaseTotal(items);
    total += expected;
    const paySql = row.status === 'REQUESTED' ? ', pay_amount_paise=?' : '';
    const stmt = db.prepare(
      `UPDATE sauda_purchase
          SET items_json=?, expected_amount_paise=?, updated_at=?${paySql}
        WHERE id=?`
    );
    if (row.status === 'REQUESTED') await stmt.bind(JSON.stringify(items), expected, now, expected, id).run();
    else await stmt.bind(JSON.stringify(items), expected, now, id).run();
    orders.push({ id, vendor_name: row.vendor_name || '', vendorKey: resolveVendor(vdir, row.vendor_name).key, for_date: row.for_date || '', expected_amount_paise: expected, items: items.length });
  }
  let receipt = null;
  const ref = String((body && (body.receipt_ref || body.ref || body.invoice_ref)) || '').trim();
  const attachment = body && (body.attachment || body.file || body.media);
  if (orders.length && (ref || attachment)) {
    const first = orders[0];
    receipt = await recordReceiptEvent(db, env || {}, first.vendorKey, (body && body.receipt_date) || first.for_date || todayIST(), orders.map((o) => o.id), total, ref, attachment, (auth && auth.u) || '');
  }
  return { ok: true, changed, total_paise: total, orders, receipt, updated_by: (auth && auth.u) || '' };
}

// ── Bank-feed match: find the debit that proves this vendor was paid ──
// Matches by vendor UPI or bank details appearing in money_events + exact amount,
// on/after `sinceDate` (so a prior same-amount payment can't false-match), and not
// already claimed by another order (one debit confirms one order). This turns a
// trusted "mark paid" tap into a bank-proven fact — the COA "don't rely on honesty".
function vendorPaymentTerms(vendorOrVpa) {
  if (typeof vendorOrVpa === 'string') return [vendorOrVpa].filter(Boolean);
  const v = vendorOrVpa || {};
  const b = jsonObject(v.bank || {});
  return [
    v.vpa,
    ...(Array.isArray(v.vpas) ? v.vpas : []),
    b.account_number,
    b.ifsc,
    b.account_name,
    v.name,
  ].map((x) => String(x || '').trim().toLowerCase()).filter((x, i, a) => x.length >= 5 && a.indexOf(x) === i);
}
async function findVendorDebit(db, vendorOrVpa, amountPaise, sinceDate) {
  const terms = vendorPaymentTerms(vendorOrVpa);
  if (!terms.length || !amountPaise) return null;
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
        WHERE direction='debit' AND amount_paise=?
          AND substr(COALESCE(txn_at,received_at),1,10) >= ?
        ORDER BY COALESCE(txn_at,received_at) DESC LIMIT 30`
    ).bind(amountPaise, sinceDate).all()).results) || [];
  } catch (e) { return null; }
  const hit = rows.find((r) => {
    if (used.has(r.id)) return false;
    const hay = [r.source_ref, r.counterparty_ref, r.narration].map((x) => String(x || '').toLowerCase()).join(' ');
    return terms.some((t) => hay.indexOf(t) >= 0);
  });
  if (!hit) return null;
  return { bank_event_id: hit.id, bank_ref: hit.source_ref || hit.counterparty_ref || '', txn_at: hit.txn_at || '' };
}

// preview the match without marking (so the pay screen can show "bank already shows this")
async function previewMatch(db, ids, amount) {
  if (!ids.length || !amount) return { ok: true, matched: false };
  const o = await db.prepare(`SELECT vendor_name, pay_requested_at, ordered_at FROM sauda_purchase WHERE id=?`).bind(ids[0]).first();
  if (!o) return { ok: true, matched: false };
  const v = resolveVendor(await getVendorDirectory(db), o.vendor_name);
  const since = String(o.pay_requested_at || o.ordered_at || '').slice(0, 10) || todayIST();
  const m = await findVendorDebit(db, v, amount, since);
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
    const v = resolveVendor(await getVendorDirectory(db), o && o.vendor_name);
    const since = String((o && (o.pay_requested_at || o.ordered_at)) || now).slice(0, 10);
    if (amt > 0 && hasPaymentRail(v)) {
      const m = await findVendorDebit(db, v, amt, since);
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
  const vdir = await getVendorDirectory(db);
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
    const v = resolveVendor(vdir, r.vendor_name);
    const amt = r.pay_amount_paise || r.expected_amount_paise || 0;
    if (!hasPaymentRail(v) || !amt) continue;
    const since = String(r.pay_requested_at || r.ordered_at || '').slice(0, 10) || '2000-01-01';
    const m = await findVendorDebit(db, v, amt, since);
    if (!m) continue;
    await db.prepare(
      `UPDATE sauda_purchase
          SET status='PAID', paid_at=COALESCE(paid_at,?),
              pay_method=CASE WHEN pay_method IS NULL OR pay_method='' THEN ? ELSE pay_method END,
              bank_event_id=?, bank_ref=?, reconciled_at=?, updated_at=? WHERE id=?`
    ).bind(now, (v.payRail === 'bank' ? 'bank_transfer' : 'upi'), m.bank_event_id, m.bank_ref, now, now, r.id).run();
    settled.push({ id: r.id, vendor: v.name, amount_paise: amt, bank_ref: m.bank_ref });
  }
  let eventRows = [];
  try {
    eventRows = ((await db.prepare(
      `SELECT id, vendor_key, event_type, event_date, amount_paise, bank_event_id, bank_ref, reconciled_at
         FROM sauda_vendor_event
        WHERE active=1 AND (event_type='payment' OR event_type='credit') AND reconciled_at IS NULL
          AND event_date >= date('now','-7 days')
        ORDER BY id DESC LIMIT 200`).all()).results) || [];
  } catch (e) { eventRows = []; }
  for (const e of eventRows) {
    const v = resolveVendor(vdir, e.vendor_key);
    const amt = Math.abs(e.amount_paise || 0);
    if (!hasPaymentRail(v) || !amt) continue;
    const m = await findVendorDebit(db, v, amt, String(e.event_date || '').slice(0, 10) || '2000-01-01');
    if (!m) continue;
    await db.prepare(
      `UPDATE sauda_vendor_event
          SET bank_event_id=?, bank_ref=?, reconciled_at=?, updated_at=?
        WHERE id=?`
    ).bind(m.bank_event_id, m.bank_ref, now, now, e.id).run();
  }
  return { ok: true, settled, count: settled.length };
}

// ── Direct pay: pay ANY vendor an ad-hoc amount, not tied to a placed order.
// Records a REQUESTED sauda_purchase row so it shows in the vendor trail and gets
// bank-verified by auto-settle when the debit lands — same rails as a normal order. ──
function cleanDirectText(value, fallback) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return (s || fallback || '').slice(0, 180);
}
function directItemMatch(items, note, ref) {
  const first = Array.isArray(items) ? items[0] : null;
  if (!first || !first.direct) return false;
  const existingRef = norm(first.ref || first.invoice_ref || '');
  const nextRef = norm(ref || '');
  if (nextRef) return existingRef === nextRef;
  return norm(first.item || '') === norm(note || '');
}
async function directPay(db, body, auth) {
  const vdir = await getVendorDirectory(db);
  const rawVk = String((body && body.vendorKey) || '');
  const v = resolveVendor(vdir, rawVk);
  const vk = v.key;
  if (!rawVk || vk === 'unassigned') return { ok: false, error: 'unknown vendor' };
  const amt = Math.round(+(body && body.amount_paise) || 0);
  if (amt <= 0) return { ok: false, error: 'amount required' };
  const ref = cleanDirectText((body && (body.ref || body.invoice_ref || body.invoice_no)) || '', '');
  const note = cleanDirectText((body && body.note) || '', ref ? ('Invoice ' + ref) : 'Direct payment');
  const forDate = todayIST();
  const now = new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);

  // Idempotency for the manual/RazorpayX simulation button: the same vendor,
  // same day, same amount, same invoice/ref should reopen the existing payable.
  const existing = ((await db.prepare(
    `SELECT id, status, items_json FROM sauda_purchase
      WHERE vendor_name=? AND for_date=? AND pay_amount_paise=? AND status IN ('REQUESTED','PAID')
      ORDER BY id DESC LIMIT 30`
  ).bind(v.name, forDate, amt).all()).results) || [];
  for (const row of existing) {
    let parsed = [];
    try { parsed = JSON.parse(row.items_json || '[]'); } catch (e) {}
    if (directItemMatch(parsed, note, ref)) {
      return {
        ok: true, id: row.id, duplicate: true, status: row.status, vendor: v.name,
        vpa: v.vpa || '', bank: v.bank || {}, bankLabel: v.bankLabel || '',
        payRail: v.payRail || payRail(v), amount_paise: amt,
      };
    }
  }

  const items = [{ item: note, qty: '', unit: '', price_paise: amt, direct: true, ref, method_hint: v.payRail || payRail(v) }];
  const res = await db.prepare(
    `INSERT INTO sauda_purchase (brand, vendor_name, for_date, fulfilment, pay_timing, items_json, status, expected_amount_paise, pay_amount_paise, pay_requested_at, ordered_at, ordered_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(v.brand || 'both', v.name, forDate, v.fulfilment, v.pay, JSON.stringify(items), 'REQUESTED', amt, amt, now, now, (auth && auth.u) || '').run();
  return {
    ok: true, id: res?.meta?.last_row_id, duplicate: false, vendor: v.name,
    vpa: v.vpa || '', bank: v.bank || {}, bankLabel: v.bankLabel || '',
    payRail: v.payRail || payRail(v), amount_paise: amt,
  };
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
  const row = await db.prepare(`SELECT rzp_contact_id, rzp_fund_account_id, rzp_fund_account_mode FROM sauda_vendor WHERE vendor_key=?`).bind(vk).first().catch(() => null);
  if (row && row.rzp_fund_account_id) return { fund_account_id: row.rzp_fund_account_id, mode: row.rzp_fund_account_mode || (v && v.vpa ? 'UPI' : 'NEFT') };
  const vpa = String((v && v.vpa) || '').trim();
  const bank = jsonObject(v && v.bank);
  if (!vpa && !validBankDetails(bank)) return { error: 'no UPI or bank account on file for ' + ((v && v.name) || vk) };
  let contactId = row && row.rzp_contact_id;
  if (!contactId) {
    const c = await rzpFetch(env, '/contacts', 'POST', { name: (v && v.name) || vk, type: 'vendor', reference_id: 'sauda_vendor_' + vk, contact: (v && v.phone) || undefined });
    if (!c.ok || !c.data.id) return { error: 'contact failed: ' + ((c.data.error && c.data.error.description) || c.status) };
    contactId = c.data.id;
  }
  const mode = vpa ? 'UPI' : 'NEFT';
  const payload = vpa
    ? { contact_id: contactId, account_type: 'vpa', vpa: { address: vpa } }
    : { contact_id: contactId, account_type: 'bank_account', bank_account: { name: bank.account_name || ((v && v.name) || vk), ifsc: bank.ifsc, account_number: bank.account_number } };
  const fa = await rzpFetch(env, '/fund_accounts', 'POST', payload);
  if (!fa.ok || !fa.data.id) return { error: 'fund account failed: ' + ((fa.data.error && fa.data.error.description) || fa.status) };
  await db.prepare(`UPDATE sauda_vendor SET rzp_contact_id=?, rzp_fund_account_id=?, rzp_fund_account_mode=? WHERE vendor_key=?`).bind(contactId, fa.data.id, mode, vk).run().catch(() => {});
  return { fund_account_id: fa.data.id, contact_id: contactId, mode };
}
async function payoutVendor(db, body, auth, env) {
  const acct = env.RAZORPAYX_ACCOUNT_NUMBER || '';
  if (!acct) return { ok: false, error: 'payout account not configured' };
  const vdir = await getVendorDirectory(db);
  const rawVk = String((body && body.vendorKey) || '');
  const v = resolveVendor(vdir, rawVk);
  const vk = v.key;
  if (!rawVk || vk === 'unassigned') return { ok: false, error: 'unknown vendor' };
  const amt = Math.round(+(body && body.amount_paise) || 0);
  if (amt <= 0) return { ok: false, error: 'amount required' };
  const orderIds = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : [];

  const ensured = await ensureRzpFundAccount(db, env, vk, v);
  if (ensured.error) return { ok: false, error: ensured.error };

  // persist the idempotency key BEFORE the call — a network retry must never double-pay
  const idem = crypto.randomUUID();
  const ref = 'sauda_' + (orderIds[0] || ('d' + Date.now()));
  const mode = ensured.mode || 'UPI';
  await db.prepare(`INSERT INTO sauda_payout (idempotency_key, vendor_key, order_ids, amount_paise, mode, ref, status) VALUES (?,?,?,?,?,?,?)`)
    .bind(idem, vk, JSON.stringify(orderIds), amt, mode, ref, 'creating').run().catch(() => {});

  const p = await rzpFetch(env, '/payouts', 'POST', {
    account_number: acct, fund_account_id: ensured.fund_account_id, amount: amt, currency: 'INR',
    mode, purpose: 'vendor bill', queue_if_low_balance: true, reference_id: ref, narration: ('HN Hotels ' + ((v && v.name) || '')).slice(0, 30),
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
// Normalise any unit string to one of three measurement axes. A comparison is only
// honest when the owner's baseline unit and Hyperpure's unit sit on the SAME axis —
// kg-vs-kg, L-vs-L, pc-vs-pc. Packaging words (case/box/bottle/crate/tray/bora) are
// ambiguous (the per-unit basis is unknown) → return '' so we refuse to assert a verdict.
function hpAxis(u) {
  u = String(u || '').toLowerCase().trim();
  if (/^(kg|kgs|g|gm|gms|gram|grams|kilo|kilos)$/.test(u)) return 'mass';
  if (/^(l|ltr|litre|liter|lt|ml)$/.test(u)) return 'vol';
  if (/^(pc|pcs|piece|pieces|nos|no|egg|eggs|dozen)$/.test(u)) return 'count';
  return '';
}
// Honest, gated price comparison for one feed row joined to its master catalog item.
// Returns a verdict ONLY when every trust check passes; otherwise verified=false +
// a plain-English reason, and the row degrades to "couldn't compare" in the UI.
function hpCompare(r) {
  const out = { your_unit_paise: null, your_pack: r.c_pack || '', your_unit: r.c_unit || '',
                verified: false, verdict: null, pct: null, save_unit_paise: 0, reason: '' };
  if (r.c_label == null) { out.reason = 'not in your list yet'; return out; }
  const qty = Number(r.c_qty) || 0, price = Number(r.c_price) || 0;
  if (!(qty > 0 && price > 0)) { out.reason = 'no price set in your list'; return out; }
  const yourUnit = Math.round(price / qty);
  out.your_unit_paise = yourUnit;
  const hpUnit = Number(r.cheapest_unit_price_paise) || Number(r.cheapest_price_paise) || 0;
  if (!hpUnit) { out.reason = 'no Hyperpure unit price'; return out; }
  if (Number(r.c_flagged) === 1) { out.reason = 'your price needs confirming'; return out; }
  const a1 = hpAxis(r.c_unit), a2 = hpAxis(r.cheapest_unit);
  if (!a1 || !a2 || a1 !== a2) { out.reason = 'different unit — can’t compare'; return out; }
  let band = null; try { band = JSON.parse(r.c_band || '[]'); } catch (e) {}
  if (Array.isArray(band) && band.length === 2) {
    const hpR = hpUnit / 100;
    if (hpR < band[0] || hpR > band[1]) { out.reason = 'Hyperpure price looks off'; return out; }
  }
  const pct = Math.round((yourUnit - hpUnit) / yourUnit * 100);
  if (Math.abs(pct) > 60) { out.reason = 'match looks wrong — open to check'; return out; }
  out.verified = true;
  out.pct = pct;
  out.save_unit_paise = yourUnit - hpUnit;  // signed: +ve = Hyperpure cheaper
  out.verdict = pct >= 4 ? 'cheaper' : (pct <= -4 ? 'dearer' : 'same');
  return out;
}

async function hyperpureFeed(db) {
  let rows = { results: [] };
  try {
    rows = await db.prepare(
      `SELECT h.item_key, h.query, h.cheapest_name, h.cheapest_price_paise, h.cheapest_image, h.cheapest_pack,
              h.cheapest_unit, h.cheapest_brand, h.cheapest_unit_price_paise, h.options_json, h.match_count, h.scraped_at,
              i.label AS c_label, i.unit AS c_unit, i.pack_label AS c_pack, i.pack_qty AS c_qty,
              i.price_paise AS c_price, i.flagged AS c_flagged, i.cmp_band AS c_band
         FROM hyperpure_prices h
         LEFT JOIN sauda_item i ON i.item_code = h.item_key
        WHERE h.cheapest_price_paise IS NOT NULL ORDER BY h.item_key`
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
    const c = hpCompare(r);
    return {
      item_key: r.item_key,
      name: r.query || r.item_key,          // the catalog/search concept (e.g. "paneer")
      label: r.c_label || '',               // the owner's catalog label (preferred display name)
      matched: r.cheapest_name || '',       // the exact Hyperpure SKU we'd order (cheapest) — shown for transparency
      price_paise: r.cheapest_price_paise,  // Hyperpure pack price
      unit_price_paise: r.cheapest_unit_price_paise || r.cheapest_price_paise,
      unit: r.cheapest_unit || '',          // kg | ltr | pc …
      pack: r.cheapest_pack || '',          // "1 kg", "1 L" …
      brand: r.cheapest_brand || '',
      image: r.cheapest_image || '',
      options: opts,                        // related SKUs (tier 2) — choose from these
      match_count: r.match_count || 0,
      scraped_at: r.scraped_at,
      // honest comparison vs the owner's own price (gated; see hpCompare)
      your_unit_paise: c.your_unit_paise,   // baseline ₹/unit in paise (null if unknown)
      your_pack: c.your_pack,
      your_unit: c.your_unit,
      verified: c.verified,                 // true → a verdict can be trusted
      verdict: c.verdict,                   // 'cheaper' | 'dearer' | 'same' | null
      pct: c.pct,                           // +ve = Hyperpure cheaper than your price
      save_unit_paise: c.save_unit_paise,   // signed ₹/unit in paise
      no_compare_reason: c.reason,          // why no verdict (shown in the "couldn't compare" group)
    };
  });
  const freshest = items.reduce((m, it) => (it.scraped_at && it.scraped_at > m ? it.scraped_at : m), '');
  const stale = freshest ? ((Date.now() - new Date(freshest).getTime()) > 36 * 3600000) : true;
  return {
    items,
    count: items.length,
    scraped_at: freshest,
    stale,                                  // true → client suppresses all verdicts this session
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
