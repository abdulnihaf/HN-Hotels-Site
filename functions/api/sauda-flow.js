// ─────────────────────────────────────────────────────────────────────────
// Sauda Flow — the purchase lifecycle engine (receive → raise → pay → trail)
// Closes the purchase ring: every purchase is one tracked object moving
//   ORDERED → RECEIVED(bill+goods photo) → PAY-RAISED → PAID(bank-matched)
// Design principles (from Nihaf, 2026-06-01):
//   • Zero memory load on owner — the only thing he does is PAY (can't forget,
//     vendor present). Staff do ONE simple step (receive + raise). Bank confirms.
//   • Different purchase types (deliver / porter / collect / bus / standing) and
//     payment timings (per / rolling-khata / periodic-khata) all ride the SAME
//     object; the type just changes labels + which station receives it.
//   • UPI payments self-reconcile against money_events (bank feed) by VPA;
//     blind P2P transfers reconcile by amount+time vs the raised request.
// Isolated file — shares env.DB with purchase-control + money (bank feed).
// ─────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

// Owner PINs (admin). Staff receive is gated by the physical station QR, not a PIN.
const OWNER_PINS = new Set(['0305', '5882']);
const isOwner = (pin) => OWNER_PINS.has(String(pin || ''));

const STATIONS = {
  'NCH-K': { brand: 'NCH', label: 'Nawabi — Kitchen' },
  'NCH-C': { brand: 'NCH', label: 'Nawabi — Cash Counter' },
  'HE-K':  { brand: 'HE',  label: 'Hamza Express — Kitchen' },
  'HE-C':  { brand: 'HE',  label: 'Hamza Express — Cash Counter' },
};

// Known VPA → vendor (harvested from 4-day bank feed). Drives auto-reconcile.
// One vendor may have many VPAs; portals matched by substring below.
const VENDOR_VPAS = {
  'Ganga Bakery': ['paytmqr67bsov@ptys'],
  'Manju Veg Supplier': ['q025257178@ybl'],
  'tabrez': ['mdt93044@ybl'],
  'Nazeer Nadeem': ['q101761866@ybl'],
  'Nisarcha Brother (Hamza/Krispy Eats)': ['8971457998@hdfc', '8971457998@yescred'],
  'Eggs (Syed Lais)': ['syedlaisahmed-2@oksbi', '9916374699@okbizaxis', '590220922@ybl'],
  'Ashrafiya Store': ['q318394880@ybl'],
  'Sameer Hamza Samosa Vendor': ['krishnamurhinisha@okaxis'],
  'Deepak Packaging Store': ['paytmqr6pdq3f@ptys'],
  'M. irshad ahmed': ['imeaty@icici'],
  'Buffalo Milk Vendor': ['9886806395@axl'],
};
const PORTAL_VPA = [['zepto', 'Zepto'], ['swiggy', 'Swiggy'], ['instamart', 'Swiggy'], ['blinkit', 'Blinkit'], ['bigbasket', 'BigBasket'], ['jiomart', 'JioMart'], ['hyperpure', 'Hyperpure']];

async function ensureSchema(DB) {
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_purchase (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL, vendor_id INTEGER, vendor_name TEXT NOT NULL, vendor_vpa TEXT,
      for_date TEXT NOT NULL, fulfilment TEXT, pay_timing TEXT,
      items_json TEXT, expected_amount_paise INTEGER,
      status TEXT NOT NULL DEFAULT 'ORDERED',
      ordered_at TEXT, ordered_by TEXT,
      received_at TEXT, received_by TEXT, received_station TEXT,
      received_items_json TEXT, receive_note TEXT, has_bill INTEGER DEFAULT 0, has_goods INTEGER DEFAULT 0,
      pay_amount_paise INTEGER, pay_requested_at TEXT, pay_requested_by TEXT,
      paid_at TEXT, pay_method TEXT, bank_event_id INTEGER, bank_ref TEXT, reconciled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_purchase_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL,
      kind TEXT NOT NULL, data_url TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sp_status ON sauda_purchase(brand, for_date, status)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_receive_config (
      item_key TEXT PRIMARY KEY,          -- normalized item name
      method TEXT NOT NULL,               -- weigh | count_pack | count | weigh_can
      params_json TEXT,                   -- {units_per_pack, pack_label, unit_label, bag_kg, ...}
      display_unit TEXT,
      updated_by TEXT, updated_at TEXT DEFAULT (datetime('now'))
    )`),
    // the actual day Purchase Order (what Nihaf prepares each night) — the REAL demand,
    // not a guess. Vendor resolved best-effort at import time.
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_day_po (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL, for_date TEXT NOT NULL,
      item_name TEXT NOT NULL, qty TEXT, unit TEXT, category TEXT,
      vendor_name TEXT, vendor_id INTEGER, fulfilment TEXT, pay_timing TEXT,
      sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(brand, for_date, item_name)
    )`),
    // self-learning UPI VPA → vendor map (so every UPI payment auto-maps; new ones labeled once)
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor_vpa (
      vpa TEXT PRIMARY KEY, vendor_name TEXT NOT NULL, vendor_id INTEGER,
      source TEXT, created_at TEXT DEFAULT (datetime('now'))
    )`),
    // vendor running balance ledger. delta_paise SIGN from OUR books:
    //  + = we overpaid → vendor owes us (advance/credit with them, adjust next order or refund)
    //  − = we owe the vendor (pending). balance = SUM(delta_paise).
    DB.prepare(`CREATE TABLE IF NOT EXISTS sauda_vendor_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_name TEXT NOT NULL, delta_paise INTEGER NOT NULL,
      reason TEXT, kind TEXT, on_date TEXT, by TEXT, created_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Default receive method inferred from the item name (owner can override in Sauda).
// weight is what you pay for → meat weighs; bread is sealed-box count; rest count.
function defaultMethod(name) {
  const n = norm(name);
  if (/powder/.test(n)) return { method: 'count', params: { pack_label: 'bag', bag_kg: 1 }, display_unit: 'bag' }; // SMP etc = bags, NOT liquid milk
  if (/(\bmilk\b|buffalo)/.test(n)) return { method: 'weigh_can', params: {}, display_unit: 'L' };
  if (/chicken|broiler|mutton|kebab|tandoori|tangdi|lollipop|grill|chaap|chapash|kurma|korma|brain|bheja|boneless|shawarma|keema|leg|liver/.test(n))
    return { method: 'weigh', params: {}, display_unit: 'kg' };
  if (/\bbun\b|buns|bread|rusk|osmania|biscuit/.test(n))
    return { method: 'count_pack', params: { pack_label: 'box', unit_label: 'pieces', units_per_pack: null }, display_unit: 'pieces' };
  return { method: 'count', params: { pack_label: 'packet' }, display_unit: 'packet' };
}

async function receiveConfigFor(DB, name) {
  const row = await DB.prepare('SELECT method, params_json, display_unit FROM sauda_receive_config WHERE item_key=?').bind(norm(name)).first().catch(() => null);
  if (row) return { method: row.method, params: row.params_json ? JSON.parse(row.params_json) : {}, display_unit: row.display_unit, source: 'set' };
  return { ...defaultMethod(name), source: 'default' };
}

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

// map a bank counterparty_ref / narration to a vendor name (for reconcile)
// vpaRows = [{vpa, vendor_name, vendor_id}] loaded from DB (self-learning) — falls back to seed.
function vendorFromEvent(ev, vpaRows) {
  const ref = String(ev.counterparty_ref || '').toLowerCase();
  if (!ref) return null;
  const rows = vpaRows && vpaRows.length ? vpaRows : Object.entries(VENDOR_VPAS).flatMap(([n, vs]) => vs.map(v => ({ vpa: v, vendor_name: n })));
  for (const r of rows) { const v = String(r.vpa || '').toLowerCase(); if (v && (ref === v || ref.includes(v.split('@')[0]))) return r.vendor_name; }
  const digs = ref.match(/\d{10}/g) || [];
  for (const r of rows) { const v = String(r.vpa || '').toLowerCase(); if (digs.some(d => v.includes(d))) return r.vendor_name; }
  for (const [key, label] of PORTAL_VPA) if (ref.includes(key)) return label;
  return null;
}
async function getVpaRows(DB) {
  // seed once from the hardcoded harvest, then it's owner-extensible in DB
  const cnt = await DB.prepare('SELECT COUNT(*) n FROM sauda_vendor_vpa').first().catch(() => ({ n: 0 }));
  if (!cnt || !cnt.n) {
    for (const [name, vpas] of Object.entries(VENDOR_VPAS)) for (const v of vpas)
      await DB.prepare('INSERT OR IGNORE INTO sauda_vendor_vpa (vpa,vendor_name,source) VALUES (?,?,?)').bind(v.toLowerCase(), name, 'seed').run();
  }
  return (await DB.prepare('SELECT vpa,vendor_name,vendor_id FROM sauda_vendor_vpa').all()).results || [];
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const DB = env.DB;
  try {
    await ensureSchema(DB);

    // ── STAFF: queue of open deliveries to receive at a station ──
    if (action === 'station-queue') {
      const station = url.searchParams.get('station') || '';
      const st = STATIONS[station];
      if (!st) return json({ success: false, error: 'unknown station' }, 400);
      const date = url.searchParams.get('date') || istToday();
      // show today's ORDERED (awaiting receive) + RECEIVED-not-yet-raised for this brand
      const rows = (await DB.prepare(
        `SELECT id, vendor_name, fulfilment, pay_timing, items_json, expected_amount_paise, status,
                received_at, has_bill, has_goods, pay_amount_paise
         FROM sauda_purchase WHERE brand=? AND for_date=? AND status IN ('ORDERED','RECEIVED')
         ORDER BY status DESC, vendor_name`).bind(st.brand, date).all()
      ).results || [];
      // enrich each item with its receive method (how to verify it) — editable per item
      for (const o of rows) {
        const items = o.items_json ? JSON.parse(o.items_json) : [];
        o.recv = [];
        for (const it of items) {
          const cfg = await receiveConfigFor(DB, it.name);
          o.recv.push({ name: it.name, qty: it.qty, unit: it.unit || '', ...cfg });
        }
      }
      return json({ success: true, station, brand: st.brand, label: st.label, date, orders: rows });
    }

    // ── STAFF: receive a delivery (qty + bill photo + goods photo) ──
    if (action === 'receive' && request.method === 'POST') {
      const b = await request.json();
      const id = Number(b.id || 0);
      if (!id) return json({ success: false, error: 'id required' }, 400);
      const cur = await DB.prepare('SELECT id, status, brand, for_date FROM sauda_purchase WHERE id=?').bind(id).first();
      if (!cur) return json({ success: false, error: 'order not found' }, 404);
      const station = b.station || '';
      const recvItems = b.received_items ? JSON.stringify(b.received_items) : null;
      let hasBill = 0, hasGoods = 0;
      if (b.bill_image) { await DB.prepare(`INSERT INTO sauda_purchase_media (purchase_id,kind,data_url) VALUES (?,?,?)`).bind(id, 'bill', b.bill_image).run(); hasBill = 1; }
      if (b.goods_image) { await DB.prepare(`INSERT INTO sauda_purchase_media (purchase_id,kind,data_url) VALUES (?,?,?)`).bind(id, 'goods', b.goods_image).run(); hasGoods = 1; }
      await DB.prepare(
        `UPDATE sauda_purchase SET status='RECEIVED', received_at=?, received_by=?, received_station=?,
           received_items_json=COALESCE(?,received_items_json), receive_note=?,
           has_bill=MAX(has_bill,?), has_goods=MAX(has_goods,?), updated_at=datetime('now') WHERE id=?`
      ).bind(nowIso(), b.received_by || 'staff', station, recvItems, b.note || null, hasBill, hasGoods, id).run();

      // ── SAUDA→ANBAR AUTO-BRIDGE (owner rule 2026-06-11: NO manual second step).
      // Any Anbar-tracked item received at this dock lands in rm_outlet_receipts
      // (inventory add, timestamped NOW) and closes its pending rm_po_expected
      // card. Additive + fail-safe: a bridge error never blocks the dock.
      try {
        if ((cur.brand || 'NCH') === 'NCH' && Array.isArray(b.received_items)) {
          const MAP = [
            [/bun/i, 'NCH-BUN', 'Bun (all types)', 'bun'],
            [/cutlet/i, 'NCH-CC', 'Chicken Cutlet', 'piece'],
            [/samosa/i, 'NCH-PS', 'Pyaaz Samosa', 'piece'],
            [/bisleri|water/i, 'NCH-WTR', 'Water Bottle', 'bottle'],
            [/osmania|usmania/i, 'NCH-OB', 'Osmania Biscuit', 'piece'],
            [/khajoor|khajur/i, 'NCH-KH', 'Khajoor', 'piece'],
          ];
          const ts = nowIso();
          for (const e of b.received_items) {
            const nm = String(e.name || e.item || e.item_key || e.key || '');
            const qty = Number(e.qty ?? e.count ?? e.received_qty ?? e.pieces ?? e.weight_kg ?? 0);
            if (!nm || !(qty > 0)) continue;
            const hit = MAP.find(([re]) => re.test(nm));
            if (!hit) continue;
            await DB.prepare(
              `INSERT INTO rm_outlet_receipts (brand, loc, item_code, item_name, qty, uom, received_at, received_by, source, notes)
               VALUES ('NCH', 'counter', ?, ?, ?, ?, ?, ?, 'vendor', ?)`
            ).bind(hit[1], hit[2], qty, hit[3], ts, b.received_by || 'staff', `auto-bridge from Sauda dock #${id} (${nm})`).run();
            await DB.prepare(
              `UPDATE rm_po_expected SET status='received'
               WHERE id = (SELECT id FROM rm_po_expected WHERE brand='NCH' AND item_code=? AND status='pending' AND po_date=? ORDER BY id LIMIT 1)`
            ).bind(hit[1], cur.for_date || istToday()).run();
          }
        }
      } catch (bridgeErr) { /* never block the dock — Anbar daily count still catches it */ }

      return json({ success: true, id, status: 'RECEIVED' });
    }

    // ── STAFF: raise the payment to owner (only after receive) ──
    if (action === 'raise-payment' && request.method === 'POST') {
      const b = await request.json();
      const id = Number(b.id || 0);
      const amount = Number(b.amount || 0);
      if (!id || !(amount > 0)) return json({ success: false, error: 'id + amount required' }, 400);
      const cur = await DB.prepare('SELECT status, has_bill FROM sauda_purchase WHERE id=?').bind(id).first();
      if (!cur) return json({ success: false, error: 'not found' }, 404);
      if (cur.status === 'ORDERED') return json({ success: false, error: 'receive the goods before raising payment' }, 409);
      await DB.prepare(
        `UPDATE sauda_purchase SET status='RAISED', pay_amount_paise=?, pay_requested_at=?, pay_requested_by=?, updated_at=datetime('now') WHERE id=?`
      ).bind(Math.round(amount * 100), nowIso(), b.by || 'staff', id).run();
      return json({ success: true, id, status: 'RAISED' });
    }

    // ── OWNER: the pay queue (raised, awaiting payment) + recently paid ──
    if (action === 'pay-queue') {
      if (!isOwner(url.searchParams.get('pin'))) return json({ success: false, error: 'owner only' }, 401);
      const date = url.searchParams.get('date') || istToday();
      // self-heal: every time the owner opens the queue, match any new bank debits
      // to open payments — so bank refs fill in with NO manual reconcile step.
      try { await reconcileAll(DB); } catch (_) {}
      const raised = (await DB.prepare(
        `SELECT id, brand, vendor_name, vendor_vpa, fulfilment, pay_timing, items_json,
                pay_amount_paise, pay_requested_at, has_bill, has_goods, status, received_station
         FROM sauda_purchase WHERE status='RAISED' ORDER BY pay_requested_at`).all()).results || [];
      const paid = (await DB.prepare(
        `SELECT id, brand, vendor_name, pay_amount_paise, paid_at, pay_method, bank_ref, reconciled_at
         FROM sauda_purchase WHERE status='PAID' AND for_date=? ORDER BY paid_at DESC LIMIT 50`).bind(date).all()).results || [];
      // attach known VPA for the pay link
      for (const r of raised) {
        if (!r.vendor_vpa) { const vs = VENDOR_VPAS[r.vendor_name]; if (vs && vs.length) r.vendor_vpa = vs[0]; }
      }
      return json({ success: true, raised, paid });
    }

    // ── OWNER: mark a request paid (cash) or initiated (upi) ──
    if (action === 'mark-paid' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      const id = Number(b.id || 0);
      if (!id) return json({ success: false, error: 'id required' }, 400);
      // cash → immediately PAID (no bank trail); upi → PAID but awaits bank reconcile to stamp ref
      await DB.prepare(
        `UPDATE sauda_purchase SET status='PAID', paid_at=?, pay_method=?, updated_at=datetime('now') WHERE id=?`
      ).bind(nowIso(), b.method || 'upi', id).run();
      // try an immediate reconcile pass for this one
      await reconcileOne(DB, id);
      return json({ success: true, id, status: 'PAID' });
    }

    // ── media viewer (proof) ──
    if (action === 'media') {
      if (!isOwner(url.searchParams.get('pin'))) return json({ success: false, error: 'owner only' }, 401);
      const id = Number(url.searchParams.get('id') || 0);
      const kind = url.searchParams.get('kind') || 'bill';
      const m = await DB.prepare(`SELECT data_url FROM sauda_purchase_media WHERE purchase_id=? AND kind=? ORDER BY id DESC LIMIT 1`).bind(id, kind).first();
      return json({ success: true, data_url: m ? m.data_url : null });
    }

    // ── ORDER create (called by /today Send tap; logs ORDERED server-side) ──
    if (action === 'order-create' && request.method === 'POST') {
      const b = await request.json();
      const brand = b.brand || 'NCH';
      const vendor = String(b.vendor_name || '').trim();
      if (!vendor) return json({ success: false, error: 'vendor_name required' }, 400);
      const date = b.for_date || istToday();
      // upsert: one open ORDERED row per vendor per brand per day
      const ex = await DB.prepare(`SELECT id FROM sauda_purchase WHERE brand=? AND vendor_name=? AND for_date=? AND status='ORDERED'`).bind(brand, vendor, date).first();
      const items = b.items ? JSON.stringify(b.items) : null;
      const vpa = b.vendor_vpa || (VENDOR_VPAS[vendor] ? VENDOR_VPAS[vendor][0] : null);
      const amt = b.expected_amount != null ? Math.round(Number(b.expected_amount) * 100) : null;
      if (ex) {
        await DB.prepare(`UPDATE sauda_purchase SET items_json=COALESCE(?,items_json), expected_amount_paise=COALESCE(?,expected_amount_paise), fulfilment=COALESCE(?,fulfilment), pay_timing=COALESCE(?,pay_timing), vendor_vpa=COALESCE(?,vendor_vpa), updated_at=datetime('now') WHERE id=?`)
          .bind(items, amt, b.fulfilment || null, b.pay_timing || null, vpa, ex.id).run();
        return json({ success: true, id: ex.id, status: 'ORDERED', updated: true });
      }
      const r = await DB.prepare(
        `INSERT INTO sauda_purchase (brand,vendor_id,vendor_name,vendor_vpa,for_date,fulfilment,pay_timing,items_json,expected_amount_paise,status,ordered_at,ordered_by)
         VALUES (?,?,?,?,?,?,?,?,?, 'ORDERED', ?, ?)`
      ).bind(brand, b.vendor_id || null, vendor, vpa, date, b.fulfilment || null, b.pay_timing || null, items, amt, nowIso(), b.by || 'owner').run();
      return json({ success: true, id: r.meta?.last_row_id, status: 'ORDERED' });
    }

    // ── cancel an order (cleanup / wrong entry) ──
    if (action === 'cancel' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      await DB.prepare(`UPDATE sauda_purchase SET status='CANCELLED', updated_at=datetime('now') WHERE id=?`).bind(Number(b.id || 0)).run();
      return json({ success: true });
    }

    // ── RECEIVE-METHOD CONFIG (owner-editable from Sauda; no coming back here) ──
    if (action === 'get-methods') {
      // returns every configured item + every item seen in orders (with its effective method)
      const cfgs = (await DB.prepare('SELECT item_key, method, params_json, display_unit, updated_at FROM sauda_receive_config ORDER BY item_key').all()).results || [];
      const seen = (await DB.prepare(`SELECT DISTINCT items_json FROM sauda_purchase WHERE items_json IS NOT NULL ORDER BY id DESC LIMIT 400`).all()).results || [];
      const names = new Set();
      for (const r of seen) { try { for (const it of JSON.parse(r.items_json)) names.add(it.name); } catch (_) {} }
      const items = [];
      for (const name of names) items.push({ name, ...(await receiveConfigFor(DB, name)) });
      return json({ success: true, configured: cfgs, items: items.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (action === 'set-method' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      const key = norm(b.item_key || b.name);
      if (!key || !b.method) return json({ success: false, error: 'item + method required' }, 400);
      await DB.prepare(`INSERT INTO sauda_receive_config (item_key,method,params_json,display_unit,updated_by,updated_at)
        VALUES (?,?,?,?,?,datetime('now'))
        ON CONFLICT(item_key) DO UPDATE SET method=excluded.method, params_json=excluded.params_json, display_unit=excluded.display_unit, updated_by=excluded.updated_by, updated_at=datetime('now')`)
        .bind(key, b.method, JSON.stringify(b.params || {}), b.display_unit || null, b.by || 'owner').run();
      return json({ success: true, item_key: key });
    }

    // ── RECONCILE: match RAISED/PAID-unreconciled orders to bank debits ──
    if (action === 'reconcile') {
      if (!isOwner(url.searchParams.get('pin'))) return json({ success: false, error: 'owner only' }, 401);
      const res = await reconcileAll(DB);
      return json({ success: true, ...res });
    }

    // ── trail (full lifecycle view for an order or a day) ──
    if (action === 'trail') {
      const date = url.searchParams.get('date') || istToday();
      const rows = (await DB.prepare(
        `SELECT id, brand, vendor_name, status, for_date, ordered_at, received_at, received_station,
                has_bill, has_goods, pay_amount_paise, pay_requested_at, paid_at, pay_method, bank_ref, reconciled_at
         FROM sauda_purchase WHERE for_date=? ORDER BY updated_at DESC`).bind(date).all()).results || [];
      return json({ success: true, date, rows });
    }

    // ── DAY-PO: ingest the real prepared order for a date (vendor pre-resolved by caller) ──
    if (action === 'import-po' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      const brand = b.brand, date = b.for_date, items = Array.isArray(b.items) ? b.items : [];
      if (!brand || !date) return json({ success: false, error: 'brand + for_date required' }, 400);
      if (b.replace) await DB.prepare('DELETE FROM sauda_day_po WHERE brand=? AND for_date=?').bind(brand, date).run();
      let n = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.item) continue;
        await DB.prepare(`INSERT INTO sauda_day_po (brand,for_date,item_name,qty,unit,category,vendor_name,vendor_id,fulfilment,pay_timing,sort)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(brand,for_date,item_name) DO UPDATE SET qty=excluded.qty,unit=excluded.unit,category=excluded.category,
          vendor_name=excluded.vendor_name,vendor_id=excluded.vendor_id,fulfilment=excluded.fulfilment,pay_timing=excluded.pay_timing,sort=excluded.sort`)
          .bind(brand, date, it.item, String(it.qty ?? ''), it.unit || '', it.cat || '', it.vendor_name || null, it.vendor_id || null, it.fulfilment || null, it.pay_timing || null, i).run();
        n++;
      }
      return json({ success: true, brand, for_date: date, imported: n });
    }
    if (action === 'day-po') {
      const brand = url.searchParams.get('brand') || 'NCH';
      const date = url.searchParams.get('date') || istToday();
      const rows = (await DB.prepare(`SELECT item_name,qty,unit,category,vendor_name,vendor_id,fulfilment,pay_timing FROM sauda_day_po WHERE brand=? AND for_date=? ORDER BY sort`).bind(brand, date).all()).results || [];
      return json({ success: true, brand, date, items: rows });
    }
    if (action === 'po-dates') {
      const brand = url.searchParams.get('brand') || 'NCH';
      const rows = (await DB.prepare(`SELECT DISTINCT for_date FROM sauda_day_po WHERE brand=? ORDER BY for_date DESC`).bind(brand).all()).results || [];
      return json({ success: true, brand, dates: rows.map(r => r.for_date) });
    }

    // ── VENDOR BALANCE LEDGER (overpaid / we-owe; credit carried to next order or refund) ──
    if (action === 'vendor-adjust' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      const v = String(b.vendor_name || '').trim();
      const amt = Math.round(Number(b.amount || 0) * 100);
      if (!v || !amt) return json({ success: false, error: 'vendor_name + amount required' }, 400);
      // kind: overpaid (+, they owe us) | we_owe (−) | settled (reduces our credit, −) | repaid (we paid down what we owe, +)
      const sign = (b.kind === 'we_owe' || b.kind === 'settled') ? -1 : 1;
      await DB.prepare(`INSERT INTO sauda_vendor_ledger (vendor_name,delta_paise,reason,kind,on_date,by) VALUES (?,?,?,?,?,?)`)
        .bind(v, sign * Math.abs(amt), b.reason || '', b.kind || 'overpaid', b.on_date || istToday(), b.by || 'owner').run();
      return json({ success: true });
    }
    if (action === 'vendor-balances') {
      const rows = (await DB.prepare(`SELECT vendor_name, SUM(delta_paise) bal FROM sauda_vendor_ledger GROUP BY vendor_name HAVING bal != 0 ORDER BY ABS(bal) DESC`).all()).results || [];
      return json({ success: true, balances: rows.map(r => ({ vendor_name: r.vendor_name, balance: r.bal / 100 })) });
    }
    if (action === 'vendor-ledger') {
      const v = url.searchParams.get('vendor');
      const rows = (await DB.prepare(`SELECT delta_paise,reason,kind,on_date FROM sauda_vendor_ledger WHERE vendor_name=? ORDER BY id DESC`).bind(v).all()).results || [];
      return json({ success: true, vendor: v, entries: rows.map(r => ({ amount: r.delta_paise / 100, reason: r.reason, kind: r.kind, date: r.on_date })) });
    }

    // ── VPA→vendor self-learning map ──
    if (action === 'vpa-map') {
      const rows = await getVpaRows(DB);
      return json({ success: true, rows });
    }
    if (action === 'label-vpa' && request.method === 'POST') {
      const b = await request.json();
      if (!isOwner(b.pin)) return json({ success: false, error: 'owner only' }, 401);
      if (!b.vpa || !b.vendor_name) return json({ success: false, error: 'vpa + vendor_name required' }, 400);
      await DB.prepare(`INSERT INTO sauda_vendor_vpa (vpa,vendor_name,vendor_id,source) VALUES (?,?,?,?)
        ON CONFLICT(vpa) DO UPDATE SET vendor_name=excluded.vendor_name, vendor_id=excluded.vendor_id, source='labeled'`)
        .bind(String(b.vpa).toLowerCase(), b.vendor_name, b.vendor_id || null, 'labeled').run();
      return json({ success: true });
    }
    // recent UPI debits whose VPA we DON'T recognise yet — label once, auto forever
    if (action === 'unmapped-upi') {
      if (!isOwner(url.searchParams.get('pin'))) return json({ success: false, error: 'owner only' }, 401);
      const vpaRows = await getVpaRows(DB);
      const days = Math.min(14, parseInt(url.searchParams.get('days') || '5', 10));
      const evs = (await DB.prepare(
        `SELECT id, source_ref, counterparty_ref, narration, amount_paise, txn_at FROM money_events
         WHERE channel='upi' AND direction='debit' AND parse_status='parsed' AND txn_at >= date('now',?) ORDER BY txn_at DESC LIMIT 100`)
        .bind(`-${days} days`).all()).results || [];
      const out = [];
      for (const ev of evs) {
        if (!ev.counterparty_ref) continue; // P2P/no-VPA handled by request-match, not here
        if (vendorFromEvent(ev, vpaRows)) continue;
        const m = /\(([^)]+)\)/.exec(ev.narration || '');
        out.push({ id: ev.id, vpa: ev.counterparty_ref, name_hint: m ? m[1] : '', amount: ev.amount_paise / 100, date: (ev.txn_at || '').slice(0, 10) });
      }
      return json({ success: true, unmapped: out });
    }
    // the live order↔payment circle per day (what was ordered vs what was paid by UPI)
    if (action === 'circle') {
      if (!isOwner(url.searchParams.get('pin'))) return json({ success: false, error: 'owner only' }, 401);
      const vpaRows = await getVpaRows(DB);
      const days = Math.min(14, parseInt(url.searchParams.get('days') || '4', 10));
      const evs = (await DB.prepare(`SELECT counterparty_ref, narration, amount_paise, txn_at FROM money_events
        WHERE channel='upi' AND direction='debit' AND parse_status='parsed' AND txn_at >= date('now',?)`).bind(`-${days} days`).all()).results || [];
      const paid = {};
      for (const ev of evs) { const d = (ev.txn_at || '').slice(0, 10); const v = vendorFromEvent(ev, vpaRows) || '(unmapped)'; (paid[d] = paid[d] || {})[v] = ((paid[d][v] || 0) + ev.amount_paise); }
      const po = (await DB.prepare(`SELECT DISTINCT for_date, vendor_name FROM sauda_day_po WHERE vendor_name IS NOT NULL AND for_date >= date('now',?)`).bind(`-${days} days`).all()).results || [];
      const ordered = {};
      for (const r of po) { (ordered[r.for_date] = ordered[r.for_date] || new Set()).add(r.vendor_name); }
      const dates = [...new Set([...Object.keys(paid), ...Object.keys(ordered)])].sort();
      const result = dates.map(d => ({ date: d, ordered: [...(ordered[d] || [])], paid: Object.fromEntries(Object.entries(paid[d] || {}).map(([k, v]) => [k, v / 100])) }));
      return json({ success: true, circle: result });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// match one paid/raised order against the bank feed
async function reconcileOne(DB, id, vpaRows) {
  if (!vpaRows) vpaRows = await getVpaRows(DB);
  const o = await DB.prepare(`SELECT * FROM sauda_purchase WHERE id=?`).bind(id).first();
  if (!o || o.reconciled_at) return false;
  const amt = o.pay_amount_paise || o.expected_amount_paise;
  if (!amt) return false;
  // candidate bank debits: same amount, debit, within [-2d, +1d] of the request
  const evs = (await DB.prepare(
    `SELECT id, source_ref, counterparty_ref, narration, amount_paise, txn_at, channel
     FROM money_events WHERE direction='debit' AND parse_status='parsed' AND amount_paise=?
       AND txn_at >= date('now','-3 days') ORDER BY txn_at DESC LIMIT 20`).bind(amt).all()).results || [];
  if (!evs.length) return false;
  // never double-spend a bank debit across two orders
  const usedRows = (await DB.prepare(`SELECT bank_event_id FROM sauda_purchase WHERE bank_event_id IS NOT NULL`).all()).results || [];
  const used = new Set(usedRows.map(r => r.bank_event_id));
  const free = evs.filter(e => !used.has(e.id));
  if (!free.length) return false;
  // (1) VPA-confident match wins. (2) else only auto-confirm if the amount+time
  // candidate is UNAMBIGUOUS (exactly one). Ambiguous → leave for owner's glance,
  // never guess a bank ref (that was the dangerous fallback).
  let pick = null, confidence = null;
  for (const ev of free) {
    const v = vendorFromEvent(ev, vpaRows);
    if (v && (v === o.vendor_name || o.vendor_name.includes(v) || v.includes(o.vendor_name.split('(')[0].trim()))) { pick = ev; confidence = 'vpa'; break; }
  }
  if (!pick && free.length === 1) { pick = free[0]; confidence = 'amount_time'; }
  if (!pick) return false; // multiple same-amount candidates, no VPA → tentative, don't stamp
  await DB.prepare(`UPDATE sauda_purchase SET status='PAID', bank_event_id=?, bank_ref=?, pay_method=COALESCE(pay_method,?), reconciled_at=?, receive_note=COALESCE(receive_note,?)||'', paid_at=COALESCE(paid_at,?), updated_at=datetime('now') WHERE id=?`)
    .bind(pick.id, pick.source_ref || null, 'upi', nowIso(), `[reconcile:${confidence}]`, pick.txn_at, id).run();
  return true;
}

async function reconcileAll(DB) {
  const vpaRows = await getVpaRows(DB);
  const open = (await DB.prepare(`SELECT id FROM sauda_purchase WHERE status IN ('RAISED','PAID') AND reconciled_at IS NULL`).all()).results || [];
  let matched = 0;
  for (const o of open) { if (await reconcileOne(DB, o.id, vpaRows)) matched++; }
  return { checked: open.length, matched };
}
