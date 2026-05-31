// Purchase-Item API — generic COUNT-based vendor purchase thread (buns, water, packaging…).
// Distinct from milk (which is weigh-based, 2 slots). Here: order in the owner's unit,
// vendor bills in their pack SKU, staff receives by COUNT. One engine, items are config.
//
// COA: pack_qty/pack_rate captures "buying unit ≠ counting unit" (Ganga sells 3-piece packs;
// owner thinks in buns). Each item is a point in (item × vendor × order_unit × pack). New item = 1 row.
// Posture: TRACK not CATCH. Self-creating schema. Shares DB binding (hn-hiring).

export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

  const USERS = { '0305':'Nihaf','5882':'Nihaf','2026':'Zoya','8316':'Zoya','3678':'Faheem','6045':'Faheem','6890':'Tanveer','7115':'Kesmat','3946':'Jafar','9991':'Mujib','3697':'Yashwant','3754':'Naveen','8241':'Nafees','8523':'Basheer','4040':'Haneef','5050':'Nisar' };
  const who = pin => USERS[(pin || '').trim()] || null;

  async function ensureSchema() {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_items (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT 'NCH',
        vendor TEXT NOT NULL, vendor_phone TEXT NOT NULL, emoji TEXT DEFAULT '📦',
        order_unit TEXT NOT NULL DEFAULT 'units',   -- how owner orders (e.g. "buns")
        pack_qty REAL DEFAULT 1, pack_rate REAL DEFAULT 0, pack_label TEXT DEFAULT '',
        receive_unit TEXT NOT NULL DEFAULT 'units', active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 100)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty REAL NOT NULL, message TEXT,
        placed_by_pin TEXT, placed_by TEXT, placed_at TEXT NOT NULL)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty_received REAL NOT NULL, ordered_qty REAL, variance REAL,
        photo_data TEXT, received_by_pin TEXT, received_by TEXT, received_at TEXT NOT NULL, notes TEXT)`),
    ]);
    // idempotent seed — Buns first. (Water/packaging added later, same shape.)
    await DB.prepare(`INSERT OR IGNORE INTO purchase_items
      (code,name,brand,vendor,vendor_phone,emoji,order_unit,pack_qty,pack_rate,pack_label,receive_unit,active,sort) VALUES
      ('BUNS','Buns','NCH','Ganga Bakery','917019547835','🍞','buns',3,25,'3-piece pack','buns',1,10)`).run();
  }

  try {
    await ensureSchema();

    if (action === 'verify-pin') { const n = who(url.searchParams.get('pin')); return n ? json({ success:true, name:n }) : json({ success:false, error:'Invalid PIN' }, 401); }

    if (action === 'item') {
      const it = await DB.prepare('SELECT * FROM purchase_items WHERE code=? AND active=1').bind(url.searchParams.get('code')).first();
      return it ? json({ success:true, item:it }) : json({ success:false, error:'Unknown item' }, 404);
    }
    if (action === 'items') {
      const r = await DB.prepare('SELECT * FROM purchase_items WHERE active=1 ORDER BY sort, name').all();
      return json({ success:true, items:r.results || [] });
    }

    if (action === 'log-order' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      const it = await DB.prepare('SELECT code FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      const res = await DB.prepare(`INSERT INTO purchase_item_orders (item_code,for_date,qty,message,placed_by_pin,placed_by,placed_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(b.item_code, forDate, qty, b.message || '', String(b.pin), name, new Date().toISOString()).run();
      return json({ success:true, id: res.meta?.last_row_id });
    }

    if (action === 'receive' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty_received); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      if (!b.photo_data || !String(b.photo_data).startsWith('data:image')) return json({ success:false, error:'Live photo required' }, 400);
      const it = await DB.prepare('SELECT code FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      let ordered = null;
      const o = await DB.prepare('SELECT qty FROM purchase_item_orders WHERE item_code=? AND for_date=? ORDER BY placed_at DESC LIMIT 1').bind(b.item_code, forDate).first();
      if (o) ordered = o.qty;
      const variance = ordered != null ? Math.round((ordered - qty) * 100) / 100 : null;
      const receivedAt = new Date().toISOString();
      const res = await DB.prepare(`INSERT INTO purchase_item_receipts (item_code,for_date,qty_received,ordered_qty,variance,photo_data,received_by_pin,received_by,received_at,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(b.item_code, forDate, qty, ordered, variance, b.photo_data, String(b.pin), name, receivedAt, b.notes || '').run();
      return json({ success:true, id: res.meta?.last_row_id, qty_received: qty, ordered_qty: ordered, variance, received_at: receivedAt });
    }

    if (action === 'ledger') {
      const code = url.searchParams.get('code');
      const ow = code ? ' WHERE item_code=?' : '';
      const orders = (await (code ? DB.prepare(`SELECT item_code,for_date,qty,placed_by,placed_at FROM purchase_item_orders${ow} ORDER BY for_date DESC, placed_at DESC LIMIT 120`).bind(code) : DB.prepare(`SELECT item_code,for_date,qty,placed_by,placed_at FROM purchase_item_orders ORDER BY for_date DESC, placed_at DESC LIMIT 120`)).all()).results || [];
      const receipts = (await (code ? DB.prepare(`SELECT item_code,for_date,qty_received,ordered_qty,variance,received_by,received_at FROM purchase_item_receipts${ow} ORDER BY for_date DESC, received_at DESC LIMIT 120`).bind(code) : DB.prepare(`SELECT item_code,for_date,qty_received,ordered_qty,variance,received_by,received_at FROM purchase_item_receipts ORDER BY for_date DESC, received_at DESC LIMIT 120`)).all()).results || [];
      return json({ success:true, orders, receipts });
    }

    return json({ success:false, error:'Invalid action' }, 400);
  } catch (e) { return json({ success:false, error: e.message }, 500); }
}
