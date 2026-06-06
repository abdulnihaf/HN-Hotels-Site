// Sauda Buy Board API — purchase → receive → request → pay loop
// D1 `hn-hiring` (binding DB). Money in paise (INTEGER). Auth via X-Ops-Pin / ?pin.
// Tables auto-create on first call. Additive — touches no existing tables.
//
// Lifecycle per line:  logged → (received) → requested → paid
// Two time-decoupled events joined by a queue: staff log+ask; owner pays whenever.

const PINS = {
  '0305': { name: 'Nihaf', role: 'owner' },
  '5882': { name: 'Nihaf', role: 'owner' },
  '4001': { name: 'Zoya',  role: 'staff' },   // change anytime
  '4002': { name: 'Bashir', role: 'staff' },  // change anytime
};

// Vendor → UPI handle (from the bank-feed vendor map). '' = no QR handle yet (pay manually).
const VENDOR_VPA = {
  'Bootha':          'prabhurathi13@oksbi',
  'Ganga Bakers':    'paytmqr67bsov@ptys',
  'Abdul Suhail':    '8971457998@hdfc',
  'M Farooq':        '7259834218@ibl',
  'Krishnamoorthi':  'krishnamurhinisha@okaxis',
  'Rupnath':         'paytmqr6pdq3f@ptys',
  'Ashrafia':        'q318394880@ybl',
  'Manjunath':       'q025257178@ybl',
  'Nazeer':          'q101761866@ybl',
  'MD Tabrez':       'mdt93044@ybl',
  'Syed Siraj Ahmed':'9916374699ssa@ybl',
  'Jay & Jay':       '',
  'MN chicken':      '',
};

// Every vendor that can appear in the dropdown (the editable mapping).
const VENDORS = Object.keys(VENDOR_VPA);

// ── Seed: today's order (6 June 2026), mapped to vendor + channel ──────────────
// channel: 'go' = someone physically buys & brings; 'delivered' = ordered, arrives.
const SEED_DATE = '2026-06-06';
const SEED = [
  // NCH
  ['NCH','Bootha','delivered','Milk — morning','L','80'],
  ['NCH','Bootha','delivered','Milk — evening','L','40'],
  ['NCH','Ganga Bakers','delivered','Buns','no','150'],
  ['NCH','Abdul Suhail','delivered','Cutlets','box','2'],
  ['NCH','Krishnamoorthi','go','Samosa','no','15'],
  ['NCH','Jay & Jay','delivered','Milk powder','—',''],
  ['NCH','Manjunath','delivered','Lemon','no','20'],
  ['NCH','Nazeer','delivered','Bisleri 500ml','case','5'],
  ['NCH','Nazeer','delivered','Sprite','case','1'],
  ['NCH','Nazeer','delivered','Thumbsup','case','1'],
  ['NCH','Rupnath','delivered','100ml tea cups','pkt','5'],
  ['NCH','Rupnath','delivered','Throwaway cups','pkt','5'],
  ['NCH','Rupnath','delivered','Carry bags','pkt','2'],
  ['NCH','Ashrafia','go','Butter','pkts','5'],
  // HE
  ['HE','Ashrafia','go','Turmeric powder','kg','1'],
  ['HE','Ashrafia','go','Cumin powder','kg','1'],
  ['HE','Ashrafia','go','Oil','L','3'],
  ['HE','Ashrafia','go','Soft oil (refined)','can','1'],
  ['HE','Ashrafia','go','Staff rice','bora',''],
  ['HE','Ashrafia','go','Sweet saunf','—',''],
  ['HE','Ashrafia','go','Surf (detergent)','kg','1'],
  ['HE','Ashrafia','go','Amul cream','L','1'],
  ['HE','Ashrafia','go','Dahi','L','4'],
  ['HE','Ashrafia','go','Milk','L','2'],
  ['HE','Manjunath','delivered','Green chilli','kg','1'],
  ['HE','Manjunath','delivered','Spring onion','bunch','1'],
  ['HE','Manjunath','delivered','Beans','gm','500'],
  ['HE','Manjunath','delivered','Celery leaves','bunch','1'],
  ['HE','Manjunath','delivered','Tomato','kg','2'],
  ['HE','MN chicken','delivered','Shawarma chicken','kg','11'],
  ['HE','Nazeer','delivered','Water (large)','case','2'],
  ['HE','Nazeer','delivered','Coke','case','1'],
  ['HE','Nazeer','delivered','Thumbsup','case','1'],
  ['HE','Rupnath','delivered','Container 1000ml','pc','25'],
  ['HE','Rupnath','delivered','Container 100ml','pc','50'],
  ['HE','Rupnath','delivered','Cover 9x13','kg','1'],
  ['HE','Rupnath','delivered','Tissue paper','bundle','1'],
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
  'Content-Type': 'application/json',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });

function istToday() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
function istNow() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS buy_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      biz_date TEXT NOT NULL, brand TEXT, vendor TEXT, channel TEXT,
      item TEXT, uom TEXT, qty_ordered TEXT DEFAULT '',
      qty_received TEXT DEFAULT '', unit_cost_paise INTEGER DEFAULT 0,
      line_total_paise INTEGER DEFAULT 0, status TEXT DEFAULT 'logged',
      request_id INTEGER DEFAULT NULL,
      updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '',
      edit_log TEXT DEFAULT '[]')`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_buy_lines_date ON buy_lines(biz_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS buy_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      biz_date TEXT NOT NULL, brand TEXT, vendor TEXT, vpa TEXT,
      amount_paise INTEGER DEFAULT 0, line_ids TEXT DEFAULT '[]',
      status TEXT DEFAULT 'requested',
      requested_by TEXT DEFAULT '', requested_at TEXT DEFAULT '',
      paid_by TEXT DEFAULT '', paid_at TEXT DEFAULT '', payment_ref TEXT DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS buy_photos (
      line_id INTEGER PRIMARY KEY, photo TEXT, uploaded_by TEXT DEFAULT '', uploaded_at TEXT DEFAULT '')`),
  ]);
  // sku: JSON per line — {kind:'loose'} OR {kind:'defined',brand,product,pack_g,pack_label,ref_price_paise,source}
  try { await db.prepare("ALTER TABLE buy_lines ADD COLUMN sku TEXT DEFAULT ''").run(); } catch (e) { /* column exists */ }
}

async function seedIfEmpty(db, date) {
  if (date !== SEED_DATE) return;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM buy_lines WHERE biz_date=?').bind(date).first();
  if (row && row.n > 0) return;
  const at = istNow();
  const stmts = SEED.map(([brand, vendor, channel, item, uom, qty]) =>
    db.prepare(`INSERT INTO buy_lines (biz_date,brand,vendor,channel,item,uom,qty_ordered,qty_received,status,updated_by,updated_at,edit_log)
                VALUES (?,?,?,?,?,?,?,?, 'logged','system',?, '[]')`)
      .bind(date, brand, vendor, channel, item, uom, qty, qty, at));
  // batch in chunks
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const db = env.DB;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'today';
  const pin = request.headers.get('X-Ops-Pin') || url.searchParams.get('pin') || '';
  const user = PINS[pin] || null;

  try {
    await ensureTables(db);

    // ── verify-pin ────────────────────────────────────────────────
    if (action === 'verify-pin') {
      if (!user) return json({ ok: false, error: 'Invalid PIN' });
      return json({ ok: true, name: user.name, role: user.role });
    }

    // ── meta: vendor list for dropdown ────────────────────────────
    if (action === 'vendors') return json({ ok: true, vendors: VENDORS });

    // ── today: full board for a date (default IST today) ──────────
    if (action === 'today') {
      const date = url.searchParams.get('date') || istToday();
      await seedIfEmpty(db, date);
      const brand = url.searchParams.get('brand'); // optional filter (kitchen QR)
      let sql = 'SELECT buy_lines.*, (SELECT 1 FROM buy_photos p WHERE p.line_id=buy_lines.id) AS has_photo FROM buy_lines WHERE biz_date=?';
      const binds = [date];
      if (brand) { sql += ' AND brand=?'; binds.push(brand); }
      sql += ' ORDER BY channel DESC, vendor, id';
      const lines = (await db.prepare(sql).bind(...binds).all()).results || [];
      const reqs = (await db.prepare('SELECT * FROM buy_requests WHERE biz_date=? ORDER BY id DESC').bind(date).all()).results || [];
      // orders are placed the night before the delivery/purchase date
      const placed = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      return json({ ok: true, date, placed, lines, requests: reqs, vendors: VENDORS, vpa: VENDOR_VPA });
    }

    // ── pay-queue: owner view of all open + recent requests ───────
    if (action === 'pay-queue') {
      if (!user || user.role !== 'owner') return json({ ok: false, error: 'unauthorized' }, 401);
      const reqs = (await db.prepare(
        `SELECT * FROM buy_requests ORDER BY (status='requested') DESC, requested_at DESC LIMIT 200`).all()).results || [];
      // attach line items
      for (const r of reqs) {
        const ids = JSON.parse(r.line_ids || '[]');
        if (ids.length) {
          const ph = ids.map(() => '?').join(',');
          r.lines = (await db.prepare(`SELECT item,uom,qty_received,unit_cost_paise,line_total_paise FROM buy_lines WHERE id IN (${ph})`).bind(...ids).all()).results || [];
        } else r.lines = [];
        r.upi = r.vpa ? `upi://pay?pa=${encodeURIComponent(r.vpa)}&pn=${encodeURIComponent(r.vendor)}&am=${(r.amount_paise/100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(r.vendor+' '+r.biz_date)}` : '';
      }
      return json({ ok: true, requests: reqs });
    }

    // ── get-photo: return the stored image for a line ────────────
    if (action === 'get-photo') {
      const id = url.searchParams.get('id');
      const r = await db.prepare('SELECT photo, uploaded_by, uploaded_at FROM buy_photos WHERE line_id=?').bind(id).first();
      return json({ ok: true, photo: r ? r.photo : null, by: r ? r.uploaded_by : '', at: r ? r.uploaded_at : '' });
    }

    // ===== writes (POST) =====
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));

      // save a line edit (qty received, price, vendor, channel, qty ordered) — logs the change
      if (action === 'save') {
        if (!user) return json({ ok: false, error: 'PIN required' }, 401);
        const { id, field, value } = body; // value as string; price in rupees
        if (!id || !field) return json({ ok: false, error: 'missing id/field' });
        const allowed = ['vendor','channel','qty_ordered','qty_received','price','item'];
        if (!allowed.includes(field)) return json({ ok: false, error: 'bad field' });
        const cur = await db.prepare('SELECT * FROM buy_lines WHERE id=?').bind(id).first();
        if (!cur) return json({ ok: false, error: 'no such line' });
        if (cur.status === 'paid') return json({ ok: false, error: 'line already paid' });

        const log = JSON.parse(cur.edit_log || '[]');
        let setSql, setVal, oldVal;
        if (field === 'price') {
          oldVal = (cur.unit_cost_paise/100).toString();
          const paise = Math.round(parseFloat(value || '0') * 100);
          const qtyNum = parseFloat((cur.qty_received || cur.qty_ordered || '0').replace(/[^0-9.]/g,'')) || 0;
          setSql = 'unit_cost_paise=?, line_total_paise=?';
          setVal = [paise, Math.round(paise * qtyNum)];
        } else {
          oldVal = cur[field === 'qty_received' ? 'qty_received' : field] ?? '';
          setSql = `${field}=?`;
          setVal = [value];
          if (field === 'qty_received') {
            const qtyNum = parseFloat((value || '0').replace(/[^0-9.]/g,'')) || 0;
            setSql += ', line_total_paise=?'; setVal.push(Math.round(cur.unit_cost_paise * qtyNum));
          }
        }
        log.push({ field, old: String(oldVal), new: String(value), by: user.name, at: istNow() });
        await db.prepare(`UPDATE buy_lines SET ${setSql}, updated_by=?, updated_at=?, edit_log=? WHERE id=?`)
          .bind(...setVal, user.name, istNow(), JSON.stringify(log), id).run();
        return json({ ok: true });
      }

      // add an off-list line (something bought that wasn't ordered)
      if (action === 'add-line') {
        if (!user) return json({ ok: false, error: 'PIN required' }, 401);
        const { date, brand, vendor, channel, item, uom, qty } = body;
        await db.prepare(`INSERT INTO buy_lines (biz_date,brand,vendor,channel,item,uom,qty_ordered,qty_received,status,updated_by,updated_at,edit_log)
          VALUES (?,?,?,?,?,?,?,?, 'logged',?,?, ?)`)
          .bind(date||istToday(), brand||'NCH', vendor||'Ashrafia', channel||'go', item||'', uom||'', qty||'', qty||'',
                user.name, istNow(), JSON.stringify([{field:'added',new:item,by:user.name,at:istNow()}])).run();
        return json({ ok: true });
      }

      // request payment for a vendor (basket) — the only door to money
      if (action === 'request-pay') {
        if (!user) return json({ ok: false, error: 'PIN required' }, 401);
        const { date, vendor, brand } = body;
        const d = date || istToday();
        const lines = (await db.prepare(
          `SELECT * FROM buy_lines WHERE biz_date=? AND vendor=? AND status='logged' AND line_total_paise>0`).bind(d, vendor).all()).results || [];
        if (!lines.length) return json({ ok: false, error: 'no priced lines to request for this vendor' });
        const amount = lines.reduce((s, l) => s + (l.line_total_paise||0), 0);
        const ids = lines.map(l => l.id);
        const res = await db.prepare(`INSERT INTO buy_requests (biz_date,brand,vendor,vpa,amount_paise,line_ids,status,requested_by,requested_at)
          VALUES (?,?,?,?,?,?, 'requested',?,?)`)
          .bind(d, brand||lines[0].brand, vendor, VENDOR_VPA[vendor]||'', amount, JSON.stringify(ids), user.name, istNow()).run();
        const rid = res.meta.last_row_id;
        const ph = ids.map(()=>'?').join(',');
        await db.prepare(`UPDATE buy_lines SET status='requested', request_id=? WHERE id IN (${ph})`).bind(rid, ...ids).run();
        return json({ ok: true, request_id: rid, amount_paise: amount });
      }

      // owner marks a request paid (after UPI)
      if (action === 'mark-paid') {
        if (!user || user.role !== 'owner') return json({ ok: false, error: 'owner only' }, 401);
        const { request_id, ref } = body;
        const r = await db.prepare('SELECT * FROM buy_requests WHERE id=?').bind(request_id).first();
        if (!r) return json({ ok: false, error: 'no such request' });
        await db.prepare(`UPDATE buy_requests SET status='paid', paid_by=?, paid_at=?, payment_ref=? WHERE id=?`)
          .bind(user.name, istNow(), ref||'', request_id).run();
        const ids = JSON.parse(r.line_ids || '[]');
        if (ids.length) {
          const ph = ids.map(()=>'?').join(',');
          await db.prepare(`UPDATE buy_lines SET status='paid' WHERE id IN (${ph})`).bind(...ids).run();
        }
        return json({ ok: true });
      }

      // QR receive: kitchen enters received qty (and optionally price) — no PIN, scoped by brand token
      if (action === 'receive') {
        const { id, qty_received, price, by } = body;
        const who = (by || 'Kitchen').slice(0, 24);
        const cur = await db.prepare('SELECT * FROM buy_lines WHERE id=?').bind(id).first();
        if (!cur) return json({ ok: false, error: 'no such line' });
        const log = JSON.parse(cur.edit_log || '[]');
        const qtyNum = parseFloat((qty_received || '0').replace(/[^0-9.]/g,'')) || 0;
        let unit = cur.unit_cost_paise;
        if (price != null && price !== '') unit = Math.round(parseFloat(price) * 100);
        log.push({ field: 'received', old: cur.qty_received||'', new: String(qty_received), by: who, at: istNow() });
        await db.prepare(`UPDATE buy_lines SET qty_received=?, unit_cost_paise=?, line_total_paise=?, updated_by=?, updated_at=?, edit_log=? WHERE id=?`)
          .bind(String(qty_received), unit, Math.round(unit*qtyNum), who, istNow(), JSON.stringify(log), id).run();
        return json({ ok: true });
      }

      // photo: one image per line (base64 data URL). No PIN — kitchen QR can use it too.
      if (action === 'photo') {
        const { id, photo, by } = body;
        if (!id || !photo) return json({ ok: false, error: 'missing id/photo' });
        await db.prepare(`INSERT INTO buy_photos (line_id,photo,uploaded_by,uploaded_at) VALUES (?,?,?,?)
          ON CONFLICT(line_id) DO UPDATE SET photo=excluded.photo, uploaded_by=excluded.uploaded_by, uploaded_at=excluded.uploaded_at`)
          .bind(id, photo, (by || '').slice(0, 24), istNow()).run();
        return json({ ok: true });
      }

      // set-sku: classify a line as loose or a defined branded SKU (with brand/product/pack). No PIN.
      if (action === 'set-sku') {
        const { id, sku, by } = body;
        if (!id) return json({ ok: false, error: 'missing id' });
        const cur = await db.prepare('SELECT sku, edit_log FROM buy_lines WHERE id=?').bind(id).first();
        if (!cur) return json({ ok: false, error: 'no such line' });
        const log = JSON.parse(cur.edit_log || '[]');
        log.push({ field: 'sku', old: cur.sku || '', new: JSON.stringify(sku || {}), by: (by || '').slice(0, 24), at: istNow() });
        await db.prepare('UPDATE buy_lines SET sku=?, edit_log=? WHERE id=?')
          .bind(JSON.stringify(sku || {}), JSON.stringify(log), id).run();
        return json({ ok: true });
      }
    }

    return json({ ok: false, error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message, stack: e.stack }, 500);
  }
}
