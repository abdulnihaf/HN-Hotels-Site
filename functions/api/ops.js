// HN-OPS staff API — the ONE outlet-scoped surface over D1 `hn-ops` (binding OPS_DB).
// COA: role = function x brand; the app DERIVES chambers from capabilities.
// Money in PAISE (integer). Auth via X-Ops-Pin header or ?pin=. IST timestamps.
//
// Endpoints:
//   GET  ?action=me                         -> staff identity, role, capabilities, chambers, outlets
//   GET  ?action=catalog&outlet=            -> vendors (+their items) for vendor-first place
//   GET  ?action=day&outlet=&date=          -> vendor cards (one vendor one card) for the day
//   GET  ?action=card&id=                   -> one card with its lines
//   POST ?action=place    {outlet,vendor_key,for_date,lines:[...]}  -> upsert card + lines
//   POST ?action=receive  {order_id,lines:[{line_id,qty_received,receive_state}],note}
//   POST ?action=route    {labels:[...]}    -> resolve free labels -> item_code+vendor (decode aid)

const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-ops-pin', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });

function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' IST';
}
function istDate() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }

async function auth(env, req, url) {
  const pin = (req.headers.get('x-ops-pin') || url.searchParams.get('pin') || '').trim();
  if (!pin) return null;
  const s = await env.OPS_DB.prepare(
    `SELECT s.staff_pin,s.name,s.role_key,s.outlet_ids,s.brand,s.job_name,r.label role_label,r.capabilities
       FROM staff s JOIN roles r ON r.role_key=s.role_key WHERE s.staff_pin=? AND s.active=1`).bind(pin).first();
  if (!s) return null;
  let caps = []; try { caps = JSON.parse(s.capabilities || '[]'); } catch (e) {}
  let outlets = []; try { outlets = JSON.parse(s.outlet_ids || '[]'); } catch (e) {}
  const chambers = [...new Set(caps.map(c => c.split('.')[0]))];
  return { ...s, caps, outlets, chambers };
}
const can = (u, cap) => u && u.caps.includes(cap);
// an empty outlet list = all outlets (cross-brand). else must be in list.
const outletOk = (u, outlet) => u && (u.outlets.length === 0 || u.outlets.includes(outlet));

// ---- safe deterministic resolver: free label -> item_code (mirror of build_seed.py) ----
const STOP = new Set(['kg','g','gm','gms','gram','grams','l','ltr','litre','ml','pc','pcs','piece','pieces',
  'packet','pack','pkt','bundle','case','crate','box','bag','of','the','and','a']);
const norm = s => (s || '').toString().trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
function toks(s) {
  const out = new Set();
  for (let w of norm(s).split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
    out.add(w);
  } return out;
}
function buildResolver(items, aliases) {
  const exact = new Map(), cand = [];
  for (const it of items) { const k = norm(it.label); if (!exact.has(k)) exact.set(k, it.item_code); cand.push([it.item_code, toks(it.label)]); }
  for (const a of aliases) { const k = norm(a.alias); if (!exact.has(k)) exact.set(k, a.item_code); cand.push([a.item_code, toks(a.alias)]); }
  return function route(label, flagged) {
    const k = norm(label);
    if (exact.has(k)) return exact.get(k);
    if (flagged) return '';
    const q = toks(label); if (!q.size) return '';
    let best = '', bestS = 0;
    for (const [code, ts] of cand) {
      if (!ts.size) continue;
      const inter = [...q].filter(w => ts.has(w));
      if (!inter.length || !inter.some(w => w.length >= 3)) continue;
      const uni = new Set([...q, ...ts]).size, s = inter.length / uni;
      if (s > bestS || (s === bestS && best && code.length < best.length)) { bestS = s; best = code; }
    }
    return bestS >= 0.5 ? best : '';
  };
}

export async function onRequest(context) {
  const { request: req, env } = context;
  if (req.method === 'OPTIONS') return J({ ok: true });
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'me';
  const db = env.OPS_DB;
  if (!db) return J({ ok: false, error: 'OPS_DB binding missing' }, 500);

  const u = await auth(env, req, url);
  if (!u) return J({ ok: false, error: 'bad or missing PIN' }, 401);

  try {
    // ---------- identity ----------
    if (action === 'me') {
      const outletRows = (await db.prepare(
        `SELECT outlet_id,brand,name FROM outlets WHERE status='active' ORDER BY brand`).all()).results || [];
      const mine = u.outlets.length ? outletRows.filter(o => u.outlets.includes(o.outlet_id)) : outletRows;
      return J({ ok: true, pin: u.staff_pin, name: u.name, role: u.role_key, role_label: u.role_label,
        capabilities: u.caps, chambers: u.chambers, outlets: mine });
    }

    // ---------- catalog (vendor-first place) ----------
    if (action === 'catalog') {
      const outlet = url.searchParams.get('outlet') || '';
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const brand = (await db.prepare(`SELECT brand FROM outlets WHERE outlet_id=?`).bind(outlet).first())?.brand || '';
      const vendors = (await db.prepare(
        `SELECT vendor_key,name,brand,category,fulfilment,pay_behaviour,phone,vpa_json FROM vendors
          WHERE active=1 AND (brand='both' OR brand=?) ORDER BY name`).bind(brand).all()).results || [];
      const items = (await db.prepare(
        `SELECT item_code,label,unit,pack_label,price_paise,price_mode,default_vendor,category FROM items
          WHERE active=1 ORDER BY label`).all()).results || [];
      const byVendor = {};
      for (const it of items) { (byVendor[it.default_vendor] ||= []).push(it); }
      return J({ ok: true, outlet, brand, vendors, items_by_vendor: byVendor, item_count: items.length });
    }

    // ---------- day board: one vendor = one card ----------
    if (action === 'day') {
      const outlet = url.searchParams.get('outlet') || '';
      const date = url.searchParams.get('date') || istDate();
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const cards = (await db.prepare(
        `SELECT po.id, po.vendor_key, v.name vendor_name, v.fulfilment, v.pay_behaviour, v.phone,
                po.status, po.expected_amount_paise, po.received_at,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=po.id) line_count,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=po.id AND l.qty_received IS NOT NULL) recv_count
           FROM purchase_orders po JOIN vendors v ON v.vendor_key=po.vendor_key
          WHERE po.outlet_id=? AND po.for_date=? ORDER BY po.expected_amount_paise DESC, v.name`)
        .bind(outlet, date).all()).results || [];
      return J({ ok: true, outlet, date, cards });
    }

    // ---------- one card + lines ----------
    if (action === 'card') {
      const id = url.searchParams.get('id');
      const po = await db.prepare(
        `SELECT po.*, v.name vendor_name, v.fulfilment, v.pay_behaviour, v.phone, v.vpa_json
           FROM purchase_orders po JOIN vendors v ON v.vendor_key=po.vendor_key WHERE po.id=?`).bind(id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const lines = (await db.prepare(
        `SELECT id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,qty_received,receive_state,flag
           FROM purchase_order_lines WHERE order_id=? ORDER BY id`).bind(id).all()).results || [];
      return J({ ok: true, card: po, lines });
    }

    // ---------- route helper (decode aid) ----------
    if (action === 'route' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const labels = body.labels || [];
      const items = (await db.prepare(`SELECT item_code,label,unit,price_paise,price_mode,default_vendor FROM items WHERE active=1`).all()).results || [];
      const aliases = (await db.prepare(`SELECT alias,item_code FROM item_aliases`).all()).results || [];
      const resolve = buildResolver(items, aliases);
      const byCode = Object.fromEntries(items.map(i => [i.item_code, i]));
      const out = labels.map(L => {
        const code = resolve(typeof L === 'string' ? L : L.label, L.flagged);
        const it = code ? byCode[code] : null;
        return { label: typeof L === 'string' ? L : L.label, item_code: code,
          vendor_key: it ? (it.default_vendor || '_unrouted') : '_unrouted',
          unit: it?.unit || '', price_paise: it && it.price_mode !== 'live' ? it.price_paise : 0 };
      });
      return J({ ok: true, routed: out });
    }

    // ---------- PLACE: upsert one vendor card + append lines ----------
    if (action === 'place' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to place' }, 403);
      const b = await req.json().catch(() => ({}));
      const outlet = b.outlet, vendor_key = b.vendor_key, for_date = b.for_date || istDate();
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!outlet || !vendor_key || !lines.length) return J({ ok: false, error: 'outlet, vendor_key, lines required' }, 400);
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const v = await db.prepare(`SELECT vendor_key FROM vendors WHERE vendor_key=?`).bind(vendor_key).first();
      if (!v) return J({ ok: false, error: 'unknown vendor' }, 400);

      // one vendor one card: upsert the card for (outlet,vendor,date)
      await db.prepare(
        `INSERT INTO purchase_orders (outlet_id,vendor_key,for_date,status,source,ordered_at,ordered_by)
         VALUES (?,?,?, 'ORDERED','manual',?,?)
         ON CONFLICT(outlet_id,vendor_key,for_date) DO UPDATE SET updated_at=?`)
        .bind(outlet, vendor_key, for_date, istNow(), u.name, istNow()).run();
      const card = await db.prepare(
        `SELECT id FROM purchase_orders WHERE outlet_id=? AND vendor_key=? AND for_date=?`)
        .bind(outlet, vendor_key, for_date).first();

      const stmts = [];
      for (const ln of lines) {
        const qty = ln.qty != null && ln.qty !== '' ? Number(ln.qty) : null;
        const cost = Number(ln.unit_cost_paise || 0);
        const amt = qty != null && cost ? Math.round(qty * cost) : 0;
        stmts.push(db.prepare(
          `INSERT INTO purchase_order_lines (order_id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,flag,raw)
           VALUES (?,?,?,?,?,?,?,?,?)`).bind(card.id, ln.item_code || '', ln.item_label || ln.label || '',
            qty, ln.uom || '', cost, amt, ln.flag || '', ln.raw || ''));
      }
      await db.batch(stmts);
      // recompute expected + ledger
      const sum = (await db.prepare(`SELECT COALESCE(SUM(line_amount_paise),0) s FROM purchase_order_lines WHERE order_id=?`).bind(card.id).first()).s;
      await db.prepare(`UPDATE purchase_orders SET expected_amount_paise=?, updated_at=? WHERE id=?`).bind(sum, istNow(), card.id).run();
      return J({ ok: true, order_id: card.id, expected_amount_paise: sum, lines_added: lines.length });
    }

    // ---------- RECEIVE: per-line received qty + state, card -> RECEIVED ----------
    if (action === 'receive' && req.method === 'POST') {
      if (!can(u, 'sauda.receive')) return J({ ok: false, error: 'not permitted to receive' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!order_id) return J({ ok: false, error: 'order_id required' }, 400);
      const po = await db.prepare(`SELECT id,outlet_id,status FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const stmts = [];
      for (const ln of lines) {
        const qr = ln.qty_received != null && ln.qty_received !== '' ? Number(ln.qty_received) : null;
        stmts.push(db.prepare(
          `UPDATE purchase_order_lines SET qty_received=?, receive_state=? WHERE id=? AND order_id=?`)
          .bind(qr, ln.receive_state || 'ok', ln.line_id, order_id));
      }
      if (stmts.length) await db.batch(stmts);
      await db.prepare(
        `UPDATE purchase_orders SET status='RECEIVED', received_at=?, received_by=?, received_station=?, receive_note=?, updated_at=? WHERE id=?`)
        .bind(istNow(), u.name, b.station || u.brand || '', b.note || '', istNow(), order_id).run();
      return J({ ok: true, order_id, status: 'RECEIVED', lines_updated: stmts.length });
    }

    return J({ ok: false, error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return J({ ok: false, error: String(e && e.message || e) }, 500);
  }
}
