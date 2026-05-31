// Milk Thread API — Nawabi buffalo milk, the first OPERATION-shaped purchase thread.
// Operation = item × brand × purpose × vendor × route. This handles the NCH-chai-milk
// operation: ORDER (slot+time → Prabhu) and RECEIVE (live-photo weigh-in → litres).
//
// Design notes (COA):
// - The CAN is a canonical container entity (point: {id, tare, nominal}). New can = 1 INSERT.
// - Posture: TRACK not CATCH. We record ideal (ordered) + actual (received). No blocking.
// - Self-creating schema (CREATE IF NOT EXISTS + idempotent seed) so deploy = push, no migration.
// - Shares Sauda's DB binding (hn-hiring). Additive: own tables, touches nothing existing.

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

  // ---- Sauda's own USERS map (mirrors purchase-control.js) so PINs are consistent ----
  const USERS = {
    '0305': 'Nihaf', '5882': 'Nihaf', '2026': 'Zoya', '8316': 'Zoya',
    '3678': 'Faheem', '6045': 'Faheem', '6890': 'Tanveer', '7115': 'Kesmat',
    '3946': 'Jafar', '9991': 'Mujib', '3697': 'Yashwant', '3754': 'Naveen',
    '8241': 'Nafees', '8523': 'Basheer', '4040': 'Haneef', '5050': 'Nisar'
  };
  const who = pin => USERS[(pin || '').trim()] || null;

  async function ensureSchema() {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS milk_cans (
        can_id TEXT PRIMARY KEY, label TEXT NOT NULL, color TEXT,
        tare_kg REAL NOT NULL, nominal_l INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS milk_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL DEFAULT 'NCH',
        material_code TEXT NOT NULL DEFAULT 'HN-RM-200', vendor TEXT NOT NULL DEFAULT 'Prabhu',
        vendor_phone TEXT, slot TEXT NOT NULL, for_date TEXT NOT NULL,
        litres REAL NOT NULL, delivery_time TEXT, rate_per_l REAL DEFAULT 55,
        message TEXT, placed_by_pin TEXT, placed_by TEXT, placed_at TEXT NOT NULL)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS milk_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL DEFAULT 'NCH',
        material_code TEXT NOT NULL DEFAULT 'HN-RM-200', vendor TEXT DEFAULT 'Prabhu',
        slot TEXT NOT NULL, for_date TEXT NOT NULL, can_id TEXT NOT NULL,
        tare_kg REAL NOT NULL, gross_kg REAL NOT NULL, density_kg_per_l REAL NOT NULL DEFAULT 1.03,
        litres_received REAL NOT NULL, ordered_litres REAL, variance_litres REAL,
        photo_data TEXT, received_by_pin TEXT, received_by TEXT, received_at TEXT NOT NULL, notes TEXT)`),
    ]);
    // idempotent seed of the two known cans (calibrated from Nihaf's photos 2026-05-31)
    await DB.prepare(`INSERT OR IGNORE INTO milk_cans (can_id,label,color,tare_kg,nominal_l,active,created_at)
      VALUES ('BLUE40','Blue 40L can','blue',4.70,40,1,'2026-05-31'),
             ('GREY40','Grey 40L can','grey',4.38,40,1,'2026-05-31')`).run();
  }

  try {
    await ensureSchema();

    if (action === 'verify-pin') {
      const name = who(url.searchParams.get('pin'));
      return name ? json({ success: true, name }) : json({ success: false, error: 'Invalid PIN' }, 401);
    }

    if (action === 'cans') {
      const r = await DB.prepare('SELECT can_id,label,color,tare_kg,nominal_l FROM milk_cans WHERE active=1 ORDER BY nominal_l').all();
      return json({ success: true, cans: r.results || [] });
    }

    // record the order at the moment Nihaf taps "Send to Prabhu" (so receive can compare)
    if (action === 'log-order' && context.request.method === 'POST') {
      const b = await context.request.json();
      const name = who(b.pin);
      if (!name) return json({ success: false, error: 'Invalid PIN' }, 401);
      const slot = ['AM', 'PM', 'ADHOC'].includes(b.slot) ? b.slot : null;
      if (!slot) return json({ success: false, error: 'bad slot' }, 400);
      const litres = parseFloat(b.litres);
      if (!(litres > 0)) return json({ success: false, error: 'litres required' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0, 10);
      const res = await DB.prepare(
        `INSERT INTO milk_orders (slot,for_date,litres,delivery_time,vendor_phone,message,placed_by_pin,placed_by,placed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(slot, forDate, litres, b.delivery_time || '', '9886806395', b.message || '', String(b.pin), name, new Date().toISOString()).run();
      return json({ success: true, id: res.meta?.last_row_id });
    }

    // open orders for a date that haven't been received yet (drives the receive screen's "ordered" compare)
    if (action === 'open-orders') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const r = await DB.prepare(
        `SELECT id,slot,for_date,litres,delivery_time,placed_at FROM milk_orders
         WHERE for_date=? ORDER BY placed_at DESC`
      ).bind(date).all();
      return json({ success: true, orders: r.results || [] });
    }

    if (action === 'receive' && context.request.method === 'POST') {
      const b = await context.request.json();
      const name = who(b.pin);
      if (!name) return json({ success: false, error: 'Invalid PIN' }, 401);
      const slot = ['AM', 'PM', 'ADHOC'].includes(b.slot) ? b.slot : null;
      if (!slot) return json({ success: false, error: 'slot must be AM/PM/ADHOC' }, 400);
      const gross = parseFloat(b.gross_kg);
      if (!(gross > 0)) return json({ success: false, error: 'gross_kg required' }, 400);
      if (!b.photo_data || !String(b.photo_data).startsWith('data:image')) {
        return json({ success: false, error: 'Live photo required' }, 400);
      }
      const can = await DB.prepare('SELECT * FROM milk_cans WHERE can_id=? AND active=1').bind(b.can_id).first();
      if (!can) return json({ success: false, error: 'Unknown can' }, 400);

      const density = parseFloat(b.density_kg_per_l) || 1.03;
      const litres = Math.round(((gross - can.tare_kg) / density) * 100) / 100;
      if (litres <= 0) return json({ success: false, error: `Computed ${litres}L — check weight/can` }, 400);

      // auto-match the ordered litres for this slot+date if present
      const forDate = b.for_date || new Date().toISOString().slice(0, 10);
      let ordered = (b.ordered_litres != null && b.ordered_litres !== '') ? parseFloat(b.ordered_litres) : null;
      if (ordered == null) {
        const o = await DB.prepare(`SELECT litres FROM milk_orders WHERE for_date=? AND slot=? ORDER BY placed_at DESC LIMIT 1`).bind(forDate, slot).first();
        if (o) ordered = o.litres;
      }
      const variance = ordered != null ? Math.round((ordered - litres) * 100) / 100 : null;
      const receivedAt = new Date().toISOString();   // SERVER stamp = canonical receiving time

      const res = await DB.prepare(
        `INSERT INTO milk_receipts
         (slot,for_date,can_id,tare_kg,gross_kg,density_kg_per_l,litres_received,ordered_litres,variance_litres,photo_data,received_by_pin,received_by,received_at,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(slot, forDate, can.can_id, can.tare_kg, gross, density, litres, ordered, variance, b.photo_data, String(b.pin), name, receivedAt, b.notes || '').run();

      return json({ success: true, id: res.meta?.last_row_id, litres_received: litres, ordered_litres: ordered, variance_litres: variance, received_at: receivedAt, can: can.label });
    }

    // the tracking view — ideal vs actual per day (TRACK not CATCH; Nihaf pulls when ready)
    if (action === 'ledger') {
      const days = Math.min(parseInt(url.searchParams.get('days')) || 14, 60);
      const orders = (await DB.prepare(`SELECT for_date,slot,litres,delivery_time,placed_by,placed_at FROM milk_orders ORDER BY for_date DESC, placed_at DESC LIMIT 120`).all()).results || [];
      const receipts = (await DB.prepare(`SELECT for_date,slot,litres_received,ordered_litres,variance_litres,can_id,received_by,received_at FROM milk_receipts ORDER BY for_date DESC, received_at DESC LIMIT 120`).all()).results || [];
      return json({ success: true, days, orders, receipts });
    }

    return json({ success: false, error: 'Invalid action. Use: verify-pin, cans, log-order, open-orders, receive, ledger' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
