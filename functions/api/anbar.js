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
  { code: 'NCH-WTR', name: 'Water Bottle',    uom: 'bottle', locs: ['counter'],          pos: [{ tmpl: 1076, f: 1 }] },
  { code: 'NCH-KH',  name: 'Khajoor',         uom: 'piece',  locs: ['counter'],          made_in_house: true, pos: [{ tmpl: 1435, f: 1 }] },
  { code: 'NCH-BUN', name: 'Bun (all types)', uom: 'bun',    locs: ['counter'],          pos: [{ tmpl: 1029, f: 1 }, { tmpl: 1644, f: 1 }, { tmpl: 1645, f: 1 }, { tmpl: 1643, f: 1 }] },
  { code: 'NCH-CC',  name: 'Chicken Cutlet',  uom: 'piece',  locs: ['counter'],          ccase: { name: 'box', size: 30 }, pos: [{ tmpl: 1031, f: 1 }] },
  { code: 'NCH-PS',  name: 'Pyaaz Samosa',    uom: 'piece',  locs: ['counter'],          pos: [{ tmpl: 1097, f: 1 }] },
  // Store-only items (layer 2 ingredients): tracked at the store door from the
  // moment anything exits. No POS term — store law is count + received − issued.
  // Consumption joins later via the chai recipe lane.
  { code: 'HN-RM-202', name: 'Tea Powder',          uom: 'kg', locs: ['store'], pos: [] },
  { code: 'HN-RM-201', name: 'Skimmed Milk Powder', uom: 'kg', locs: ['store'], pos: [] },
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

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
