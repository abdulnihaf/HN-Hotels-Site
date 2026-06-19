// ═══════════════════════════════════════════════════════════════════════════
// ANBAR — inventory chamber API (anbar.hnhotels.in)
// Sauda buys · Anbar counts and settles. Layer 1: NCH, six unit-countable items.
//
// The conservation law per item per location:
//   counter: last_count + receipts(counter) + issues(store→counter) − POS sold = expected
//   store:   last_count + receipts(store) − issues(store→counter)            = expected
// Deduction is ALWAYS derived from the POS (configs 27 counter, 32/36 kiosks,
// 37 chai chowki) — staff never record consumption, only receive/issue/count.
//
// D1: hn-hiring → rm_outlet_counts / rm_outlet_receipts / rm_outlet_issues
// Odoo POS (read-only): ops.hamzahotel.com via ODDO key env ODOO_NCH_POS_KEY
// ═══════════════════════════════════════════════════════════════════════════

const ODOO_URL = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB = 'main';
const ODOO_UID = 2;
const POS_CONFIGS = [27, 32, 36, 37];

const PINS = {
  '0305': 'Nihaf', '8523': 'Bashir', '6890': 'Tanveer', '3754': 'Naveen',
  '7115': 'CASH001', '8241': 'CASH002', '2847': 'CASH003', '5190': 'CASH004',
  '3678': 'RUN001', '4421': 'RUN002', '5503': 'RUN003', '6604': 'RUN004', '7705': 'RUN005',
  '2026': 'Zoya',
};

// Layer-1 NCH items. pos = product.template ids + factor (units consumed per line qty).
// All bun SKUs consume the same physical bun → one Anbar item, factor 1 each.
const ITEMS = [
  // HUMANS NEVER MULTIPLY: pack = the unit issues move in (store→counter);
  // case = the unit deliveries arrive in (receives). The server converts both.
  // 1 OB box = 20 packets = 480 pieces · 1 cutlet box = 30 pieces.
  // made_in_house: produced in the kitchen — receive = "made & moved to counter".
  { code: 'NCH-OB',  name: 'Osmania Biscuit', uom: 'piece',  locs: ['counter', 'store'], pack: { name: 'packet', size: 24 }, ccase: { name: 'box', size: 480 }, pos: [{ tmpl: 1030, f: 1 }, { tmpl: 1033, f: 3 }] },
  { code: 'NCH-WTR', name: 'Water Bottle',    uom: 'bottle', locs: ['counter'],          ccase: { name: 'case', size: 24 }, pos: [{ tmpl: 1076, f: 1 }] },
  { code: 'NCH-KH',  name: 'Khajoor',         uom: 'piece',  locs: ['counter'],          made_in_house: true, pos: [{ tmpl: 1435, f: 1 }] },
  { code: 'NCH-BUN', name: 'Bun (all types)', uom: 'bun',    locs: ['counter'],          pos: [{ tmpl: 1029, f: 1 }, { tmpl: 1644, f: 1 }, { tmpl: 1645, f: 1 }, { tmpl: 1643, f: 1 }] },
  { code: 'NCH-CC',  name: 'Chicken Cutlet',  uom: 'piece',  locs: ['counter'],          ccase: { name: 'box', size: 10 }, pos: [{ tmpl: 1031, f: 1 }] },
  { code: 'NCH-PS',  name: 'Pyaaz Samosa',    uom: 'piece',  locs: ['counter'],          pos: [{ tmpl: 1097, f: 1 }] },
  // Store-only items (layer 2 ingredients): tracked at the store door from the
  // moment anything exits. No POS term — store law is count + received − issued.
  // Consumption joins later via the chai recipe lane.
  { code: 'HN-RM-202', name: 'Tea Powder',          uom: 'kg', locs: ['store'], pos: [] },
  { code: 'HN-RM-201', name: 'Skimmed Milk Powder', uom: 'kg', locs: ['store'], pos: [] },
];

// Sauda -> Anbar bridge, phase 1: HE chicken receiving. The purchase order line
// remains canonical; Anbar only adds received weights and the inventory movement.
const CHICKEN_SKU_TO_CUT = {
  HE_BONELESS: 'boneless',
  HE_SHAWARMA: 'shawarma',
  HE_KEBAB: 'kebab',
  HE_TANDOORI: 'tandoori',
  HE_GRILL: 'grill',
  HE_TANGDI: 'tangdi',
  HE_LOLLIPOP: 'lollipop',
  HE_WINGS: 'lollipop',
};
const CHICKEN_CUT_LABEL = {
  boneless: 'Boneless chicken',
  shawarma: 'Shawarma chicken',
  kebab: 'Kebab chicken',
  tandoori: 'Tandoori chicken',
  grill: 'Grill chicken',
  tangdi: 'Tangdi (drumstick)',
  lollipop: 'Lollipop / wings',
};
const CHICKEN_CUT_ORDER = ['shawarma', 'boneless', 'kebab', 'tandoori', 'grill', 'tangdi', 'lollipop'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function nowISTText() {
  return new Date(Date.now() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 19);
}
function clean(v, max = 160) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function qtyNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}
function parseItems(raw) {
  try {
    const out = JSON.parse(raw || '[]');
    return Array.isArray(out) ? out : [];
  } catch (e) {
    return [];
  }
}
function lineText(line) {
  return [
    line?.sku, line?.item_code, line?.item, line?.label, line?.name, line?.item_name,
    line?.note, line?.received_note,
  ].map((x) => String(x || '')).join(' ').toLowerCase();
}
function chickenCutForLine(line) {
  const sku = clean(line?.sku || line?.item_code, 80).toUpperCase();
  if (CHICKEN_SKU_TO_CUT[sku]) return CHICKEN_SKU_TO_CUT[sku];
  const t = lineText(line);
  // Shawarma boneless is the same Sauda/MN cut, not a second item.
  if (/shawa?rma|shawarama/.test(t)) return 'shawarma';
  if (/boneless/.test(t)) return 'boneless';
  if (/kebab|kabab/.test(t)) return 'kebab';
  if (/tandoor|tandur|tandoori/.test(t)) return 'tandoori';
  if (/grill/.test(t)) return 'grill';
  if (/tangdi|drumstick/.test(t)) return 'tangdi';
  if (/lollipop|wings?\b/.test(t)) return 'lollipop';
  return '';
}
function itemLabel(line) {
  return clean(line?.item || line?.label || line?.name || line?.item_name || line?.sku || 'Item', 120);
}
function lineUnit(line) {
  return clean(line?.unit || line?.uom || line?.ordered_unit || 'unit', 24);
}
function chickenMovementCode(cut) {
  return `HE-CHICKEN-${String(cut || 'UNKNOWN').toUpperCase()}`;
}
function lineForQueue(order, line, lineIdx) {
  const cut = chickenCutForLine(line);
  const yieldedKg = clean(line?.yielded_kg || line?.received_qty, 32);
  const deliveredKg = clean(line?.delivered_kg || line?.bill_qty || line?.live_qty, 32);
  return {
    order_id: order.id,
    line_idx: lineIdx,
    brand: order.brand || 'HE',
    vendor_name: order.vendor_name || '',
    for_date: order.for_date || '',
    status: order.status || '',
    item: itemLabel(line),
    sku: clean(line?.sku || line?.item_code, 80),
    qty: clean(line?.qty ?? line?.ordered_qty, 32),
    unit: lineUnit(line),
    chicken: !!cut,
    cut,
    cut_label: cut ? CHICKEN_CUT_LABEL[cut] : '',
    yielded_kg: yieldedKg,
    delivered_kg: deliveredKg,
    received_pieces: clean(line?.received_pieces, 32),
    received_note: clean(line?.received_note, 220),
    received_at: clean(line?.received_at, 32),
    received_by: clean(line?.received_by, 80),
    daily_rate_paise: Math.round(+line?.daily_rate_paise || 0),
    cost_paise: Math.round(+line?.cost_paise || 0),
    effective_price_paise: Math.round(+line?.effective_price_paise || +line?.price_paise || 0),
    movement_key: `sauda_purchase:${order.id}:${lineIdx}:receipt`,
  };
}
function applyLedgerToQueueLine(queueLine, ledger) {
  if (!queueLine || !ledger) return queueLine;
  if (!queueLine.yielded_kg && ledger.purchased_kg != null) queueLine.yielded_kg = clean(ledger.purchased_kg, 32);
  if (!queueLine.delivered_kg && ledger.delivered_kg != null) queueLine.delivered_kg = clean(ledger.delivered_kg, 32);
  if (!queueLine.daily_rate_paise && ledger.daily_rate_paise) queueLine.daily_rate_paise = Math.round(+ledger.daily_rate_paise || 0);
  if (!queueLine.cost_paise && ledger.cost_paise) queueLine.cost_paise = Math.round(+ledger.cost_paise || 0);
  if (!queueLine.effective_price_paise && ledger.price_per_kg_paise) queueLine.effective_price_paise = Math.round(+ledger.price_per_kg_paise || 0);
  queueLine.ledger_synced = true;
  return queueLine;
}
function applyLedgerToSaudaLine(line, ledger) {
  if (!line || !ledger) return;
  const dailyRate = Math.round(+ledger.daily_rate_paise || 0);
  const cost = Math.round(+ledger.cost_paise || 0);
  const effective = Math.round(+ledger.price_per_kg_paise || 0);
  if (dailyRate > 0) line.daily_rate_paise = dailyRate;
  if (cost > 0) line.cost_paise = cost;
  if (effective > 0) {
    line.price_paise = effective;
    line.effective_price_paise = effective;
  }
}
function itemAmountPaise(line) {
  const cost = Math.round(+line?.cost_paise || 0);
  if (cost > 0) return cost;
  const price = Math.round(+line?.price_paise || +line?.effective_price_paise || 0);
  const qty = qtyNum(line?.bill_qty || line?.qty || line?.ordered_qty);
  return price > 0 && qty > 0 ? Math.round(price * qty) : 0;
}
function purchaseTotalPaise(items) {
  return (items || []).reduce((sum, line) => sum + itemAmountPaise(line), 0);
}
async function ensureSaudaBridgeTables(DB) {
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS sauda_purchase (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT,
      vendor_name TEXT,
      for_date TEXT,
      fulfilment TEXT,
      pay_timing TEXT,
      items_json TEXT,
      status TEXT,
      expected_amount_paise INTEGER DEFAULT 0,
      pay_amount_paise INTEGER DEFAULT 0,
      ordered_at TEXT,
      ordered_by TEXT,
      received_at TEXT,
      received_by TEXT,
      received_station TEXT,
      received_items_json TEXT,
      paid_at TEXT,
      updated_at TEXT
    )`
  ).run();
  for (const sql of [
    "ALTER TABLE sauda_purchase ADD COLUMN brand TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN vendor_name TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN for_date TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN pay_timing TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN items_json TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN status TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN ordered_at TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN ordered_by TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN received_at TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN received_by TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN received_station TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN received_items_json TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN paid_at TEXT",
    "ALTER TABLE sauda_purchase ADD COLUMN updated_at TEXT",
  ]) {
    try { await DB.prepare(sql).run(); } catch (e) {}
  }
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS anbar_inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_key TEXT UNIQUE,
      brand TEXT NOT NULL,
      loc TEXT DEFAULT 'kitchen',
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      qty REAL NOT NULL,
      uom TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT DEFAULT '',
      sauda_purchase_id INTEGER,
      sauda_line_idx INTEGER,
      event_at TEXT NOT NULL,
      by_person TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anbar_movements_day ON anbar_inventory_movements(brand, event_at, item_code)`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anbar_movements_sauda ON anbar_inventory_movements(sauda_purchase_id, sauda_line_idx)`).run();
}
async function ensureChickenLedgerCompat(DB) {
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS chicken_daily_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_date TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'HE',
      cut TEXT NOT NULL,
      purchased_kg REAL,
      delivered_kg REAL,
      daily_rate_paise INTEGER,
      price_per_kg_paise INTEGER,
      cost_paise INTEGER,
      recipe_consumed_g INTEGER DEFAULT 0,
      variance_pct REAL,
      updated_at TEXT
    )`
  ).run();
  for (const sql of [
    "ALTER TABLE chicken_daily_ledger ADD COLUMN delivered_kg REAL",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN daily_rate_paise INTEGER",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN price_per_kg_paise INTEGER",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN cost_paise INTEGER",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN recipe_consumed_g INTEGER DEFAULT 0",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN variance_pct REAL",
    "ALTER TABLE chicken_daily_ledger ADD COLUMN updated_at TEXT",
  ]) {
    try { await DB.prepare(sql).run(); } catch (e) {}
  }
  try { await DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chicken_daily_ledger_unique ON chicken_daily_ledger(business_date, brand, cut)`).run(); } catch (e) {}
}
async function chickenLedgerByCut(DB, brand, date) {
  await ensureChickenLedgerCompat(DB);
  const rows = (await DB.prepare(
    `SELECT business_date, brand, cut, purchased_kg, delivered_kg, daily_rate_paise,
            price_per_kg_paise, cost_paise, recipe_consumed_g, variance_pct
       FROM chicken_daily_ledger
      WHERE brand=? AND business_date=?`
  ).bind(brand, date).all()).results || [];
  const out = new Map();
  for (const row of rows) out.set(row.cut, row);
  return out;
}
async function upsertChickenLedgerReceipt(DB, { date, brand, cut, yieldedKg, deliveredKg }) {
  await ensureChickenLedgerCompat(DB);
  const existing = await DB.prepare(
    `SELECT id, daily_rate_paise, recipe_consumed_g
       FROM chicken_daily_ledger
      WHERE brand=? AND business_date=? AND cut=?`
  ).bind(brand, date, cut).first();
  const dailyRate = Math.round(+existing?.daily_rate_paise || 0);
  const recipeG = Math.round(+existing?.recipe_consumed_g || 0);
  const costPaise = dailyRate > 0 ? Math.round(deliveredKg * dailyRate) : null;
  const effectivePricePaise = costPaise && yieldedKg > 0 ? Math.round(costPaise / yieldedKg) : null;
  let variancePct = null;
  if (recipeG > 0 && yieldedKg > 0) {
    variancePct = Math.round(((yieldedKg * 1000 - recipeG) / recipeG) * 100 * 100) / 100;
  }
  if (existing) {
    await DB.prepare(
      `UPDATE chicken_daily_ledger
          SET purchased_kg=?,
              delivered_kg=?,
              price_per_kg_paise=CASE WHEN ? IS NOT NULL THEN ? ELSE price_per_kg_paise END,
              cost_paise=CASE WHEN ? IS NOT NULL THEN ? ELSE cost_paise END,
              variance_pct=CASE WHEN ? IS NOT NULL THEN ? ELSE variance_pct END,
              updated_at=datetime('now')
        WHERE id=?`
    ).bind(
      yieldedKg, deliveredKg,
      effectivePricePaise, effectivePricePaise,
      costPaise, costPaise,
      variancePct, variancePct,
      existing.id
    ).run();
  } else {
    await DB.prepare(
      `INSERT INTO chicken_daily_ledger
        (business_date, brand, cut, purchased_kg, delivered_kg, daily_rate_paise,
         price_per_kg_paise, cost_paise, variance_pct, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now'))`
    ).bind(date, brand, cut, yieldedKg, deliveredKg, effectivePricePaise, costPaise, variancePct).run();
  }
  return await DB.prepare(
    `SELECT business_date, brand, cut, purchased_kg, delivered_kg, daily_rate_paise,
            price_per_kg_paise, cost_paise, recipe_consumed_g, variance_pct
       FROM chicken_daily_ledger
      WHERE brand=? AND business_date=? AND cut=?`
  ).bind(brand, date, cut).first();
}
function applySaudaReceipt(line, update, now, person) {
  let changed = 0;
  const yielded = clean(update.yielded_kg ?? update.received_qty, 32);
  if (yielded) {
    if (line.yielded_kg !== yielded) changed++;
    line.yielded_kg = yielded;
    delete line.received_qty;
  }
  const delivered = clean(update.delivered_kg ?? update.bill_qty ?? update.live_qty, 32);
  if (delivered) {
    if (line.delivered_kg !== delivered) changed++;
    line.delivered_kg = delivered;
    delete line.bill_qty;
    delete line.live_qty;
  }
  const pieces = clean(update.received_pieces, 32);
  if (pieces) {
    if (line.received_pieces !== pieces) changed++;
    line.received_pieces = pieces;
  }
  const note = clean(update.received_note || update.note, 220);
  if (note) {
    if (line.received_note !== note) changed++;
    line.received_note = note;
  }
  if (changed) {
    line.received_at = now;
    line.received_by = person;
  }
  return changed;
}

async function odoo(key, model, method, args, kwargs = {}) {
  const r = await fetch(ODOO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: {
      service: 'object', method: 'execute_kw', args: [ODOO_DB, ODOO_UID, key, model, method, args, kwargs] } }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || 'odoo error');
  return d.result;
}

// POS units sold per item since `sinceISO` (and optionally until `untilISO`).
// Resolves product.template → variant ids once per call, then sums line qty × factor.
async function soldSince(key, sinceISO, untilISO) {
  const tmplIds = ITEMS.flatMap(i => i.pos.map(p => p.tmpl));
  const variants = await odoo(key, 'product.product', 'search_read',
    [[['product_tmpl_id', 'in', tmplIds]]], { fields: ['id', 'product_tmpl_id'] });
  const factorByVariant = {};
  for (const v of variants) {
    for (const item of ITEMS) {
      const hit = item.pos.find(p => p.tmpl === v.product_tmpl_id[0]);
      if (hit) factorByVariant[v.id] = { code: item.code, f: hit.f };
    }
  }
  const domain = [
    ['order_id.config_id', 'in', POS_CONFIGS],
    ['order_id.date_order', '>=', sinceISO.replace('T', ' ').slice(0, 19)],
    ['order_id.state', 'in', ['paid', 'done', 'invoiced', 'posted']],
    ['product_id', 'in', Object.keys(factorByVariant).map(Number)],
  ];
  if (untilISO) domain.splice(2, 0, ['order_id.date_order', '<=', untilISO.replace('T', ' ').slice(0, 19)]);
  const lines = await odoo(key, 'pos.order.line', 'search_read', [domain],
    { fields: ['product_id', 'qty'], limit: 5000 });
  const sold = {};
  for (const l of lines) {
    const m = factorByVariant[l.product_id[0]];
    if (m) sold[m.code] = (sold[m.code] || 0) + l.qty * m.f;
  }
  return sold;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const ODOO_KEY = context.env.ODOO_NCH_POS_KEY;

  try {
    if (action === 'verify-pin') {
      const person = PINS[url.searchParams.get('pin')];
      return person ? json({ success: true, person }) : json({ success: false, error: 'Wrong PIN' });
    }

    if (action === 'items') {
      return json({ success: true, items: ITEMS.map(({ code, name, uom, locs, pack }) => ({ code, name, uom, locs, pack: pack || null })) });
    }

    // ── SAUDA RECEIVE QUEUE: Anbar reads the placed purchase lines. It does not
    // create another order trail. First production use: HE MN Broilers chicken.
    if (action === 'sauda-receive-queue') {
      await ensureSaudaBridgeTables(DB);
      const date = (url.searchParams.get('date') || url.searchParams.get('for_date') || todayIST()).slice(0, 10);
      const brand = (url.searchParams.get('brand') || 'HE').toUpperCase() === 'NCH' ? 'NCH' : 'HE';
      const kind = (url.searchParams.get('kind') || 'chicken').toLowerCase();
      const ledger = kind === 'chicken' ? await chickenLedgerByCut(DB, brand, date) : new Map();
      const rows = (await DB.prepare(
        `SELECT id, brand, vendor_name, for_date, status, pay_timing, paid_at, ordered_at, ordered_by, items_json
           FROM sauda_purchase
          WHERE brand=? AND for_date=? AND (paid_at IS NULL OR paid_at='')
            AND (pay_timing IS NULL OR pay_timing != 'online')
            AND (status IS NULL OR status NOT IN ('PAID','CANCELLED'))
          ORDER BY id`
      ).bind(brand, date).all()).results || [];
      const orders = [];
      const lines = [];
      for (const row of rows) {
        const items = parseItems(row.items_json);
        const qLines = items.map((line, idx) => lineForQueue(row, line, idx))
          .filter((line) => kind !== 'chicken' || line.chicken);
        for (const line of qLines) applyLedgerToQueueLine(line, ledger.get(line.cut));
        if (!qLines.length) continue;
        qLines.sort((a, b) => CHICKEN_CUT_ORDER.indexOf(a.cut) - CHICKEN_CUT_ORDER.indexOf(b.cut));
        orders.push({ ...row, items_json: undefined, lines: qLines });
        lines.push(...qLines);
      }
      return json({ success: true, date, brand, kind, orders, lines, line_count: lines.length });
    }

    // ── SAUDA RECEIVE WRITE: records actual received weights on the canonical
    // Sauda line and writes one idempotent Anbar stock receipt movement.
    if (action === 'sauda-receive' && context.request.method === 'POST') {
      await ensureSaudaBridgeTables(DB);
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const updates = Array.isArray(body.lines) ? body.lines : [];
      const byId = new Map();
      for (const raw of updates) {
        const id = Math.round(+raw.order_id || +raw.id || 0);
        const idx = Math.round(+raw.line_idx);
        if (!id || !Number.isFinite(idx) || idx < 0) continue;
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push({ ...raw, line_idx: idx });
      }
      if (!byId.size) return json({ success: false, error: 'No valid receipt lines' }, 400);
      const now = nowISTText();
      const station = clean(body.station || body.loc || 'HE-KITCHEN', 40) || 'HE-KITCHEN';
      let changed = 0;
      const saved = [];
      const movements = [];
      for (const [id, lines] of byId.entries()) {
        const row = await DB.prepare(
          `SELECT id, brand, vendor_name, for_date, status, pay_timing, paid_at, items_json
             FROM sauda_purchase
            WHERE id=? AND (pay_timing IS NULL OR pay_timing != 'online')`
        ).bind(id).first();
        if (!row) continue;
        if (row.paid_at) return json({ success: false, error: 'Already paid; receipt cannot change', id }, 409);
        const items = parseItems(row.items_json);
        const receivedLines = [];
        for (const u of lines) {
          const line = items[u.line_idx];
          if (!line) continue;
          const before = JSON.stringify(line);
          const lineChanged = applySaudaReceipt(line, u, now, person);
          if (lineChanged) changed += lineChanged;
          const cut = chickenCutForLine(line);
          const yieldedKg = qtyNum(line.yielded_kg || line.received_qty);
          const deliveredKg = qtyNum(line.delivered_kg || line.bill_qty || line.live_qty);
          const eventAt = clean(line.received_at, 32) || now;
          let ledger = null;
          if (cut && yieldedKg > 0 && deliveredKg > 0) {
            ledger = await upsertChickenLedgerReceipt(DB, {
              date: (row.for_date || todayIST()).slice(0, 10),
              brand: row.brand || 'HE',
              cut,
              yieldedKg,
              deliveredKg,
            });
            applyLedgerToSaudaLine(line, ledger);
          }
          const qLine = applyLedgerToQueueLine(lineForQueue(row, line, u.line_idx), ledger);
          receivedLines.push(qLine);
          if (cut && yieldedKg > 0) {
            const movementKey = `sauda_purchase:${id}:${u.line_idx}:receipt`;
            const meta = {
              vendor_name: row.vendor_name || '',
              for_date: row.for_date || '',
              ordered_qty: clean(line.qty ?? line.ordered_qty, 32),
              ordered_unit: lineUnit(line),
              delivered_kg: deliveredKg || null,
              received_pieces: clean(line.received_pieces, 32),
              note: clean(line.received_note, 220),
              cut,
              sauda_sku: clean(line.sku || line.item_code, 80),
            };
            await DB.prepare(
              `INSERT INTO anbar_inventory_movements (
                 movement_key, brand, loc, item_code, item_name, qty, uom,
                 movement_type, source, source_ref, sauda_purchase_id, sauda_line_idx,
                 event_at, by_person, meta_json, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, 'kg', 'receipt', 'sauda_receive', ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(movement_key) DO UPDATE SET
                 brand=excluded.brand,
                 loc=excluded.loc,
                 item_code=excluded.item_code,
                 item_name=excluded.item_name,
                 qty=excluded.qty,
                 event_at=excluded.event_at,
                 by_person=excluded.by_person,
                 meta_json=excluded.meta_json,
                 updated_at=excluded.updated_at`
            ).bind(
              movementKey,
              row.brand || 'HE',
              station,
              chickenMovementCode(cut),
              CHICKEN_CUT_LABEL[cut] || itemLabel(line),
              yieldedKg,
              String(id),
              id,
              u.line_idx,
              eventAt,
              person,
              JSON.stringify(meta),
              now
            ).run();
            movements.push({ movement_key: movementKey, item_code: chickenMovementCode(cut), qty: yieldedKg, uom: 'kg', cut });
          } else if (before !== JSON.stringify(line)) {
            movements.push({ movement_key: null, item_code: clean(line.sku || line.item_code, 80), qty: yieldedKg || 0, uom: 'kg', cut: cut || '' });
          }
        }
        const expected = purchaseTotalPaise(items);
        await DB.prepare(
          `UPDATE sauda_purchase
              SET items_json=?,
                  expected_amount_paise=CASE WHEN ? > 0 THEN ? ELSE expected_amount_paise END,
                  status=CASE WHEN status='ORDERED' THEN 'RECEIVED' ELSE status END,
                  received_at=?,
                  received_by=?,
                  received_station=?,
                  received_items_json=?,
                  updated_at=?
            WHERE id=?`
        ).bind(JSON.stringify(items), expected, expected, now, person, station, JSON.stringify(receivedLines), now, id).run();
        saved.push({ id, vendor_name: row.vendor_name || '', for_date: row.for_date || '', received_lines: receivedLines.length });
      }
      return json({ success: true, changed, orders: saved, movements, at: now, by: person, station });
    }

    // Generic movement trail for Takht/TV inventory views.
    if (action === 'movements') {
      await ensureSaudaBridgeTables(DB);
      const brand = (url.searchParams.get('brand') || 'HE').toUpperCase() === 'NCH' ? 'NCH' : 'HE';
      const date = (url.searchParams.get('date') || todayIST()).slice(0, 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '120', 10) || 120, 300);
      const rows = (await DB.prepare(
        `SELECT * FROM anbar_inventory_movements
          WHERE brand=? AND substr(event_at,1,10)=?
          ORDER BY event_at DESC, id DESC
          LIMIT ?`
      ).bind(brand, date, limit).all()).results || [];
      return json({ success: true, brand, date, movements: rows });
    }

    // ── LIVE BOARD: per item per location — expected vs last count ──
    if (action === 'live') {
      const out = [];
      for (const item of ITEMS) out.push({ code: item.code, name: item.name, uom: item.uom, locs: item.locs, pack: item.pack || null, ccase: item.ccase || null, made_in_house: !!item.made_in_house });

      // last count per (item, outlet)
      const counts = (await DB.prepare(
        `SELECT item_code, outlet, qty, counted_at FROM rm_outlet_counts c
         WHERE id IN (SELECT MAX(id) FROM rm_outlet_counts WHERE brand='NCH' GROUP BY item_code, outlet)`
      ).all()).results || [];
      const lastCount = {};
      for (const c of counts) lastCount[`${c.item_code}|${c.outlet}`] = c;

      // earliest anchor for the Odoo query window
      const anchors = counts.map(c => c.counted_at).sort();
      const since = anchors[0] || new Date(Date.now() - 86400000).toISOString();

      let sold = {};
      let odooOk = true;
      try { sold = ODOO_KEY ? await soldSince(ODOO_KEY, since) : {}; }
      catch (e) { odooOk = false; }

      for (const item of out) {
        const cKey = `${item.code}|NCH-COUNTER`;
        const sKey = `${item.code}|NCH-STORE`;
        const cc = lastCount[cKey], sc = lastCount[sKey];

        const sums = async (table, timecol, where) =>
          (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM ${table} WHERE brand='NCH' AND item_code=? AND ${where} AND ${timecol} > ?`)
            .bind(item.code, cc ? cc.counted_at : '1970').first())?.t || 0;

        // counter lane (waste rows live in rm_outlet_issues with outlet='NCH-WASTE')
        if (cc) {
          const rec = await sums('rm_outlet_receipts', 'received_at', "loc='counter'");
          const iss = await sums('rm_outlet_issues', 'issued_at', "outlet='NCH-COUNTER'");
          const waste = await sums('rm_outlet_issues', 'issued_at', "outlet='NCH-WASTE'");
          // sold since THIS item's count anchor (re-windowed client-side is overkill; one query window, filter by date in SQL-less way):
          let soldQty = sold[item.code] || 0;
          if (odooOk && ODOO_KEY && cc.counted_at !== since) {
            try { const s2 = await soldSince(ODOO_KEY, cc.counted_at); soldQty = s2[item.code] || 0; } catch (e) { /* keep window value */ }
          }
          item.counter = {
            last_count: cc.qty, counted_at: cc.counted_at,
            received: rec, issued_in: iss, sold: soldQty, waste,
            expected: Math.round((cc.qty + rec + iss - waste - soldQty) * 100) / 100,
            odoo_ok: odooOk,
          };
        } else item.counter = null;

        // store lane
        if (item.locs.includes('store')) {
          if (sc) {
            const rec = (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM rm_outlet_receipts WHERE brand='NCH' AND item_code=? AND loc='store' AND received_at > ?`).bind(item.code, sc.counted_at).first())?.t || 0;
            const iss = (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM rm_outlet_issues WHERE brand='NCH' AND item_code=? AND outlet='NCH-COUNTER' AND issued_at > ?`).bind(item.code, sc.counted_at).first())?.t || 0;
            item.store = { last_count: sc.qty, counted_at: sc.counted_at, received: rec, issued_out: iss, expected: Math.round((sc.qty + rec - iss) * 100) / 100 };
          } else item.store = { last_count: null, note: 'store baseline not counted yet' };
        }
      }
      return json({ success: true, items: out, odoo_ok: odooOk });
    }

    // ── RECORD COUNT (counter or store) — returns variance against expected ──
    if (action === 'record-count' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const loc = body.loc === 'store' ? 'NCH-STORE' : 'NCH-COUNTER';
      const now = new Date().toISOString();
      const results = [];
      for (const e of (body.items || [])) {
        const item = ITEMS.find(i => i.code === e.code);
        if (!item || e.qty == null) continue;
        await DB.prepare(
          `INSERT INTO rm_outlet_counts (brand, outlet, item_code, item_name, qty, uom, counted_at, counted_by, kind, notes)
           VALUES ('NCH', ?, ?, ?, ?, ?, ?, ?, 'daily', ?)`
        ).bind(loc, item.code, item.name, e.qty, item.uom, now, person, body.notes || '').run();
        results.push({ code: item.code, qty: e.qty });
      }
      return json({ success: true, recorded: results.length, at: now, by: person, items: results });
    }

    // ── PLACE ORDER (Zoya/Bashir — creates the receive expectations) ──
    // Placement itself happens on WhatsApp; THIS is the app record that makes
    // the outlet's receive screen know what to expect on the delivery date.
    if (action === 'place-order' && context.request.method === 'POST') {
      const ORDER_PLACERS = ['Zoya', 'Bashir', 'Nihaf', 'Tanveer', 'Naveen'];
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person || !ORDER_PLACERS.includes(person)) return json({ success: false, error: 'Not authorised to place orders' }, 401);
      const poDate = body.po_date;  // 'YYYY-MM-DD' IST delivery date
      if (!/^\d{4}-\d{2}-\d{2}$/.test(poDate || '')) return json({ success: false, error: 'po_date invalid' });
      const brand = body.brand === 'HE' ? 'HE' : 'NCH';   // both houses place here
      const now = new Date().toISOString();
      let n = 0;
      for (const l of (body.lines || [])) {
        if (!(l.qty > 0) || !l.code) continue;
        // Sauda owns the WHOLE day's PO for BOTH houses. NCH tracked items
        // canonicalize against Anbar's ITEMS (they become counter confirm
        // cards); everything else is a PO-only line.
        const item = brand === 'NCH' ? ITEMS.find(i => i.code === l.code) : null;
        const name = item ? item.name : (l.name || l.code);
        const unit = l.unit || (item ? item.uom : 'unit');
        await DB.prepare(
          `INSERT INTO rm_po_expected (brand, po_date, item_code, item_name, ordered_qty, ordered_unit, expect_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(brand, poDate, l.code, name, l.qty, unit, `placed by ${person}${l.note ? ' · ' + l.note : ''}`, now).run();
        n++;
      }
      return json({ success: true, placed: n, po_date: poDate, brand, by: person, at: now });
    }

    // ── CANCEL ORDER LINE (Zoya/Bashir own the order — wrong lines die honestly) ──
    // Cancelled lines keep their row (audit), vanish from the receive screen.
    if (action === 'cancel-line' && context.request.method === 'POST') {
      const ORDER_PLACERS = ['Zoya', 'Bashir', 'Nihaf', 'Tanveer', 'Naveen'];
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person || !ORDER_PLACERS.includes(person)) return json({ success: false, error: 'Not authorised' }, 401);
      const r = await DB.prepare(
        `UPDATE rm_po_expected SET status='cancelled', expect_note = expect_note || ' · CANCELLED by ' || ? || ' ' || ? WHERE id=? AND status='pending'`
      ).bind(person, new Date().toISOString(), body.id).run();
      return json({ success: true, cancelled: r.meta.changes > 0 });
    }

    // ── ORDERS for a date (order page shows what's already placed) ──
    if (action === 'orders') {
      const date = url.searchParams.get('date');
      const brand = url.searchParams.get('brand') === 'HE' ? 'HE' : 'NCH';
      const rows = (await DB.prepare(
        `SELECT * FROM rm_po_expected WHERE brand=? AND po_date=? ORDER BY id`
      ).bind(brand, date).all()).results || [];
      return json({ success: true, po_date: date, brand, lines: rows });
    }

    // ── EXPECTED TODAY (counter receive confirms TRACKED items only — the
    // full PO lives in Sauda; milk/LPG/etc never clutter the counter door) ──
    if (action === 'expected') {
      const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST date
      const tracked = ITEMS.map(i => i.code);
      const rows = ((await DB.prepare(
        `SELECT * FROM rm_po_expected WHERE brand='NCH' AND po_date=? ORDER BY id`
      ).bind(today).all()).results || []).filter(r => tracked.includes(r.item_code));
      return json({ success: true, po_date: today, expected: rows });
    }

    // ── RECORD RECEIPT (delivery arrives — counter fresh items, or store bulk) ──
    // The receive timestamp IS the inventory-add moment. If expected_id is sent,
    // the receiver is confirming a PO line — it gets marked received and linked.
    if (action === 'record-receipt' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      const loc = body.loc === 'store' ? 'store' : 'counter';
      // Case-unit receive: deliveries arrive in boxes/cases — server multiplies.
      let pieces = body.qty, note = body.notes || '';
      if (item.ccase && body.unit === 'case') {
        pieces = body.qty * item.ccase.size;
        note = `${body.qty} ${item.ccase.name}(es) × ${item.ccase.size} = ${pieces} ${item.uom}s. ${note}`.trim();
      }
      // Made-in-house: the kitchen batch counted as it moves to the counter.
      const source = item.made_in_house ? 'kitchen' : 'vendor';
      const now = new Date().toISOString();
      const r = await DB.prepare(
        `INSERT INTO rm_outlet_receipts (brand, loc, item_code, item_name, qty, uom, received_at, received_by, source, notes)
         VALUES ('NCH', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(loc, item.code, item.name, pieces, item.uom, now, person, source, note).run();
      body.qty = pieces;
      if (body.expected_id) {
        await DB.prepare(
          `UPDATE rm_po_expected SET status='received', received_receipt_id=? WHERE id=? AND status='pending'`
        ).bind(r.meta.last_row_id, body.expected_id).run();
      }
      return json({ success: true, at: now, by: person, code: item.code, qty: body.qty, loc });
    }

    // ── RECORD ISSUE (store room → counter; Bashir's action) ──
    if (action === 'record-issue' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      // Pack-unit issue: server does the multiplication — humans never convert.
      let pieces = body.qty, note = body.notes || '';
      if (item.pack && body.unit === 'pack') {
        pieces = body.qty * item.pack.size;
        note = `${body.qty} ${item.pack.name}(s) × ${item.pack.size} = ${pieces} ${item.uom}s. ${note}`.trim();
      }
      const now = new Date().toISOString();
      await DB.prepare(
        `INSERT INTO rm_outlet_issues (brand, outlet, item_code, item_name, qty, uom, issued_at, issued_by, notes)
         VALUES ('NCH', 'NCH-COUNTER', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.code, item.name, pieces, item.uom, now, person, note).run();
      return json({ success: true, at: now, by: person, code: item.code, qty: pieces, packs: item.pack && body.unit === 'pack' ? body.qty : null });
    }

    // ── RECORD WASTE (counter → bin, with reason) ──
    // Waste without a record is where theft hides ("it was waste, promise").
    // A recorded waste event separates spoilage from seepage permanently.
    if (action === 'record-waste' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      const now = new Date().toISOString();
      await DB.prepare(
        `INSERT INTO rm_outlet_issues (brand, outlet, item_code, item_name, qty, uom, issued_at, issued_by, notes)
         VALUES ('NCH', 'NCH-WASTE', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.code, item.name, body.qty, item.uom, now, person, `WASTE: ${body.reason || 'no reason given'}`).run();
      return json({ success: true, at: now, by: person, code: item.code, qty: body.qty });
    }

    // ── HISTORY (audit trail per item) ──
    if (action === 'history') {
      const code = url.searchParams.get('code');
      const limit = parseInt(url.searchParams.get('limit') || '30');
      const rows = (await DB.prepare(
        `SELECT 'count' k, outlet loc, qty, counted_at at, counted_by who, kind, notes FROM rm_outlet_counts WHERE brand='NCH' AND item_code=?
         UNION ALL SELECT 'receipt', loc, qty, received_at, received_by, source, notes FROM rm_outlet_receipts WHERE brand='NCH' AND item_code=?
         UNION ALL SELECT 'issue', outlet, qty, issued_at, issued_by, '', notes FROM rm_outlet_issues WHERE brand='NCH' AND item_code=?
         ORDER BY at DESC LIMIT ?`
      ).bind(code, code, code, limit).all()).results || [];
      return json({ success: true, code, events: rows });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
