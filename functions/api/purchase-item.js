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

  // Manager (Basheer) WhatsApp — pulled LIVE from Darbar's hr_employees (single source of truth,
  // not hardcoded). Basheer = PIN 8523. Falls back to '' so the UI shows "set number" rather than guess.
  async function managerPhone() {
    try {
      const r = await DB.prepare(`SELECT phone FROM hr_employees WHERE pin='8523' AND is_active=1 LIMIT 1`).first();
      return (r?.phone || '').replace(/[^\d]/g, '');
    } catch (_) { return ''; }
  }

  async function ensureSchema() {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_items (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT 'NCH',
        vendor TEXT, vendor_phone TEXT, emoji TEXT DEFAULT '📦',
        channel TEXT NOT NULL DEFAULT 'vendor',     -- 'vendor' (WhatsApp) | 'ration' (departmental/q-comm)
        order_unit TEXT NOT NULL DEFAULT 'units',   -- how owner orders (e.g. "buns")
        pack_qty REAL DEFAULT 1, pack_rate REAL DEFAULT 0, pack_label TEXT DEFAULT '',
        receive_unit TEXT NOT NULL DEFAULT 'units',
        last_dept_price REAL DEFAULT 0, last_dept_store TEXT DEFAULT '', last_qcomm_price REAL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 100)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS manager_pickup_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, item_name TEXT, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty REAL NOT NULL, unit TEXT, store_hint TEXT,
        status TEXT NOT NULL DEFAULT 'open',   -- open | sent | done
        added_by TEXT, added_at TEXT NOT NULL, sent_at TEXT)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty REAL NOT NULL, message TEXT,
        placed_by_pin TEXT, placed_by TEXT, placed_at TEXT NOT NULL)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty_received REAL NOT NULL, ordered_qty REAL, variance REAL,
        photo_data TEXT, received_by_pin TEXT, received_by TEXT, received_at TEXT NOT NULL, notes TEXT)`),
    ]);
    // MIGRATE FIRST — older purchase_items table may predate these columns (CREATE IF NOT EXISTS skips them).
    // Must run before any INSERT that references the new columns.
    for (const col of [
      "channel TEXT NOT NULL DEFAULT 'vendor'", 'last_dept_price REAL DEFAULT 0',
      "last_dept_store TEXT DEFAULT ''", 'last_qcomm_price REAL DEFAULT 0']) {
      try { await DB.prepare(`ALTER TABLE purchase_items ADD COLUMN ${col}`).run(); } catch (_) { /* already exists */ }
    }
    // idempotent seed (now safe — columns guaranteed present).
    await DB.batch([
      DB.prepare(`INSERT OR IGNORE INTO purchase_items (code,name,brand,vendor,vendor_phone,emoji,channel,order_unit,pack_qty,pack_rate,pack_label,receive_unit,active,sort) VALUES
        ('BUNS','Buns','NCH','Ganga Bakery','917019547835','🍞','vendor','buns',3,25,'3-piece pack','buns',1,10)`),
      DB.prepare(`INSERT OR IGNORE INTO purchase_items (code,name,brand,vendor,vendor_phone,emoji,channel,order_unit,pack_qty,pack_rate,pack_label,receive_unit,active,sort) VALUES
        ('WATER','Bisleri 500ml Water','NCH','Nadeem (Water & Cold Drinks)','919900323484','💧','vendor','cases',1,0,'','cases',1,20)`),
      DB.prepare(`INSERT OR IGNORE INTO purchase_items (code,name,brand,emoji,channel,order_unit,receive_unit,last_dept_price,last_dept_store,last_qcomm_price,active,sort) VALUES
        ('BUTTER','Amul Butter','NCH','🧈','ration','kg','kg',285,'Ashrafiya',280,1,30)`),
      DB.prepare(`INSERT OR IGNORE INTO purchase_items (code,name,brand,emoji,channel,order_unit,receive_unit,last_dept_price,last_dept_store,last_qcomm_price,active,sort) VALUES
        ('MILKMAID','Milkmaid (Condensed Milk)','NCH','🥫','ration','kg','kg',324,'Ashrafiya',0,1,40)`),
      // ensure existing rows carry channel even if they were inserted pre-migration
      DB.prepare(`UPDATE purchase_items SET channel='vendor' WHERE code IN ('BUNS','WATER') AND (channel IS NULL OR channel='')`),
      DB.prepare(`UPDATE purchase_items SET channel='ration', last_dept_price=285, last_dept_store='Ashrafiya', last_qcomm_price=280 WHERE code='BUTTER'`),
      DB.prepare(`UPDATE purchase_items SET channel='ration', last_dept_price=324, last_dept_store='Ashrafiya' WHERE code='MILKMAID'`),
    ]);
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

    // ── RATION rail: add an item to Basheer's departmental go-collect list ──
    if (action === 'add-to-manager-list' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      const it = await DB.prepare('SELECT code,name,order_unit,last_dept_store FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      // de-dupe: one open line per item+date — update qty instead of stacking
      const ex = await DB.prepare(`SELECT id FROM manager_pickup_list WHERE item_code=? AND for_date=? AND status='open'`).bind(b.item_code, forDate).first();
      if (ex) {
        await DB.prepare(`UPDATE manager_pickup_list SET qty=?, added_by=?, added_at=? WHERE id=?`).bind(qty, name, new Date().toISOString(), ex.id).run();
        return json({ success:true, id: ex.id, updated:true });
      }
      const res = await DB.prepare(`INSERT INTO manager_pickup_list (item_code,item_name,for_date,qty,unit,store_hint,status,added_by,added_at) VALUES (?,?,?,?,?,?, 'open', ?, ?)`)
        .bind(it.code, it.name, forDate, qty, it.order_unit, b.store_hint || it.last_dept_store || '', name, new Date().toISOString()).run();
      return json({ success:true, id: res.meta?.last_row_id });
    }

    // view the current open pickup list (owner)
    if (action === 'manager-list') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
      const r = await DB.prepare(`SELECT id,item_code,item_name,qty,unit,store_hint,status,added_by FROM manager_pickup_list WHERE for_date=? AND status='open' ORDER BY id`).bind(date).all();
      return json({ success:true, manager_phone: await managerPhone(), items: r.results || [] });
    }

    // remove a line from the list
    if (action === 'remove-from-manager-list' && context.request.method === 'POST') {
      const b = await context.request.json(); if (!who(b.pin)) return json({ success:false, error:'Invalid PIN' }, 401);
      await DB.prepare(`DELETE FROM manager_pickup_list WHERE id=?`).bind(b.id).run();
      return json({ success:true });
    }

    // mark the whole list sent (after owner taps the WhatsApp send)
    if (action === 'mark-list-sent' && context.request.method === 'POST') {
      const b = await context.request.json(); if (!who(b.pin)) return json({ success:false, error:'Invalid PIN' }, 401);
      const date = b.for_date || new Date().toISOString().slice(0,10);
      await DB.prepare(`UPDATE manager_pickup_list SET status='sent', sent_at=? WHERE for_date=? AND status='open'`).bind(new Date().toISOString(), date).run();
      return json({ success:true });
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
