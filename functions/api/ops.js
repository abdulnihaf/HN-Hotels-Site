// HN-OPS staff API — the ONE outlet-scoped surface over D1 `hn-ops` (binding OPS_DB).
// COA: role = function x brand; the app DERIVES chambers from capabilities.
// Money in PAISE (integer). Auth via X-Ops-Pin header or ?pin=. IST timestamps.
//
// Endpoints:
//   GET  ?action=me                         -> staff identity, role, capabilities, chambers, outlets
//   GET  ?action=catalog&outlet=            -> vendors (+their items) for vendor-first place
//   GET  ?action=purchase_day&date=&brand=  -> HN-wide purchase day (HE/NCH cards)
//   GET  ?action=purchase_day_pdf&date=     -> printable A4 purchase day
//   GET  ?action=day&outlet=&date=          -> vendor cards (one vendor one card) for one outlet
//   GET  ?action=card&id=                   -> one card with its lines + event trail
//   GET  ?action=vendor_diary&date=&days=   -> per-vendor local purchase ledger + pay queue
//   POST ?action=add-vendor {outlet,name,category,fulfilment,pay_behaviour,phone,vpa?}
//   POST ?action=add-item {outlet,vendor_key,label,unit,category,price_mode,price_paise?}
//   POST ?action=place    {outlet,vendor_key,for_date,lines:[...]}  -> upsert card + lines
//   POST ?action=edit-lines {order_id,lines:[...]} -> replace pre-receive order lines + audit trail
//   POST ?action=delete-order {order_id}    -> cancel pre-receive card + audit trail
//   POST ?action=receive  {order_id,lines:[{line_id,qty_received,receive_state}],note}
//   POST ?action=payment  {order_id,pay_method,pay_amount_paise,bank_ref,paid}
//   POST ?action=route    {labels:[...]}    -> resolve free labels -> item_code+vendor (decode aid)

const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-ops-pin', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });

function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' IST';
}
function istDate() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }
const META_GRAPH_VERSION = 'v24.0';

const ADMIN_CONSOLE_PIN = '5634';
const ADMIN_CONSOLE_CAPS = [
  'sauda.demand', 'sauda.place', 'sauda.receive', 'sauda.raise',
  'anbar.receive', 'anbar.count', 'anbar.audit',
  'takht.settle', 'takht.take', 'takht.account', 'takht.fix',
  'admin.assign', 'admin.view',
];

async function auth(env, req, url) {
  const pin = (req.headers.get('x-ops-pin') || url.searchParams.get('pin') || '').trim();
  if (!pin) return null;
  if (pin === ADMIN_CONSOLE_PIN) {
    return {
      staff_pin: pin,
      name: 'HN Admin Console',
      role_key: 'admin',
      role_label: 'Admin Console',
      outlet_ids: '[]',
      brand: 'HQ',
      job_name: 'Permission audit / admin',
      caps: [...ADMIN_CONSOLE_CAPS],
      outlets: [],
      chambers: [...new Set(ADMIN_CONSOLE_CAPS.map(c => c.split('.')[0]))],
    };
  }
  const s = await env.OPS_DB.prepare(
    `SELECT s.staff_pin,s.name,s.role_key,s.outlet_ids,s.brand,s.job_name,r.label role_label,r.capabilities
       FROM staff s JOIN roles r ON r.role_key=s.role_key WHERE s.staff_pin=? AND s.active=1`).bind(pin).first();
  if (!s) return null;
  let caps = []; try { caps = JSON.parse(s.capabilities || '[]'); } catch (e) {}
  let outlets = []; try { outlets = JSON.parse(s.outlet_ids || '[]'); } catch (e) {}
  if (outlets.length && ['kitchen', 'counter', 'cashier'].includes(s.role_key) && !caps.includes('sauda.demand')) {
    caps.push('sauda.demand');
  }
  const chambers = [...new Set(caps.map(c => c.split('.')[0]))];
  return { ...s, caps, outlets, chambers };
}
const can = (u, cap) => u && u.caps.includes(cap);
// an empty outlet list = all outlets (cross-brand). else must be in list.
const outletOk = (u, outlet) => u && (u.outlets.length === 0 || u.outlets.includes(outlet));
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function brandPassSql(alias, brand) {
  if (!brand || brand === 'all') return { sql: '', vals: [] };
  return { sql: ` AND ${alias}.brand=?`, vals: [brand] };
}
const HINDI_LABELS = [
  [/onion|pyaz|pyaaz/i, 'प्याज़'],
  [/green chilli|hari mirch|mirchi/i, 'हरी मिर्च'],
  [/chilli powder|red chilli|lal mirch/i, 'लाल मिर्च'],
  [/chicken|broiler/i, 'चिकन'],
  [/mutton/i, 'मटन'],
  [/milk|doodh/i, 'दूध'],
  [/curd|dahi/i, 'दही'],
  [/egg|anda/i, 'अंडा'],
  [/rice|chawal/i, 'चावल'],
  [/sugar|cheeni|sakkar/i, 'चीनी'],
  [/maida/i, 'मैदा'],
  [/atta|wheat/i, 'आटा'],
  [/oil/i, 'तेल'],
  [/water|pani/i, 'पानी'],
  [/bun/i, 'बन'],
  [/bread/i, 'ब्रेड'],
  [/butter/i, 'बटर'],
  [/paneer/i, 'पनीर'],
  [/tomato/i, 'टमाटर'],
  [/potato|aloo/i, 'आलू'],
  [/ginger|adrak/i, 'अदरक'],
  [/garlic|lahsun/i, 'लहसुन'],
  [/coriander|dhaniya/i, 'धनिया'],
  [/mint|pudina/i, 'पुदीना'],
  [/salt|namak/i, 'नमक'],
  [/turmeric|haldi/i, 'हल्दी'],
];
function hindiLabelFor(it, aliasText = '') {
  const hay = [it.label, it.item_code, it.category, aliasText].join(' ');
  for (const [re, label] of HINDI_LABELS) if (re.test(hay)) return label;
  return '';
}
function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { contentType: m[1], bytes };
}
async function storeOrderMedia(env, db, orderId, kind, dataUrl, by) {
  if (!dataUrl) return false;
  if (!env.EVIDENCE) throw new Error('evidence bucket missing');
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) throw new Error(`${kind} photo invalid`);
  if (parsed.bytes.byteLength > 3_000_000) throw new Error(`${kind} photo too large`);
  const key = `purchase/${istDate()}/${orderId}/${kind}-${Date.now()}.jpg`;
  await env.EVIDENCE.put(key, parsed.bytes, {
    httpMetadata: { contentType: parsed.contentType || 'image/jpeg' },
    customMetadata: { by: String(by || '').slice(0, 80), kind },
  });
  await db.prepare(`INSERT INTO purchase_media (order_id,kind,r2_key) VALUES (?,?,?)`)
    .bind(orderId, kind, key).run();
  return true;
}
async function allowedOutletRows(db, u) {
  const rows = (await db.prepare(`SELECT outlet_id,brand,name FROM outlets WHERE status='active' ORDER BY brand`).all()).results || [];
  return u.outlets.length ? rows.filter(o => u.outlets.includes(o.outlet_id)) : rows;
}
async function purchaseDayRows(db, u, date, brandFilter) {
  const allowed = await allowedOutletRows(db, u);
  const ids = allowed.map(o => o.outlet_id);
  if (!ids.length) return { allowed, cards: [], linesByOrder: {} };
  const outletById = Object.fromEntries(allowed.map(o => [o.outlet_id, o]));
  const placeholders = ids.map(() => '?').join(',');
  const bf = brandPassSql('o', brandFilter);
  const cards = (await db.prepare(
    `SELECT po.id, po.outlet_id, po.vendor_key, v.name vendor_name, v.fulfilment, v.pay_behaviour, v.phone,
            po.status, po.expected_amount_paise, po.ordered_at, po.ordered_by, po.received_at, po.received_by,
            o.brand outlet_brand, o.name outlet_name,
            (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=po.id) line_count,
            (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=po.id AND l.qty_received IS NOT NULL) recv_count
      FROM purchase_orders po
      JOIN vendors v ON v.vendor_key=po.vendor_key
      JOIN outlets o ON o.outlet_id=po.outlet_id
      WHERE po.for_date=? AND po.outlet_id IN (${placeholders}) AND po.status<>'CANCELLED'${bf.sql}
      ORDER BY o.brand, v.name`).bind(date, ...ids, ...bf.vals).all()).results || [];
  const linesByOrder = {};
  if (cards.length) {
    const ph = cards.map(() => '?').join(',');
    const lines = (await db.prepare(
      `SELECT id,order_id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,qty_received,receive_state,flag
         FROM purchase_order_lines WHERE order_id IN (${ph}) ORDER BY order_id,id`)
      .bind(...cards.map(c => c.id)).all()).results || [];
    for (const l of lines) (linesByOrder[l.order_id] ||= []).push(l);
  }
  return {
    allowed,
    cards: cards.map(c => ({ ...c, outlet_brand: c.outlet_brand || outletById[c.outlet_id]?.brand || '' })),
    linesByOrder
  };
}

async function ensurePurchaseEventLog(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS purchase_event_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL,
      event_type   TEXT NOT NULL,
      actor_pin    TEXT DEFAULT '',
      actor_name   TEXT DEFAULT '',
      payload_json TEXT DEFAULT '{}',
      created_at   TEXT DEFAULT (datetime('now'))
    )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS ix_purchase_event_order ON purchase_event_log(order_id, created_at)`).run();
}
async function writePurchaseEvent(db, orderId, type, u, payload) {
  await ensurePurchaseEventLog(db);
  await db.prepare(
    `INSERT INTO purchase_event_log (order_id,event_type,actor_pin,actor_name,payload_json)
     VALUES (?,?,?,?,?)`)
    .bind(orderId, type, u?.staff_pin || '', u?.name || '', JSON.stringify(payload || {})).run();
}
async function readPurchaseEvents(db, orderId) {
  try {
    const rows = (await db.prepare(
      `SELECT id,event_type,actor_name,created_at,payload_json
         FROM purchase_event_log WHERE order_id=? ORDER BY id DESC LIMIT 30`)
      .bind(orderId).all()).results || [];
    return rows;
  } catch (e) {
    return [];
  }
}
function purchaseLineSnapshot(l) {
  return {
    id: Number(l.id || 0),
    item_code: l.item_code || '',
    item_label: l.item_label || '',
    qty_ordered: l.qty_ordered == null ? null : Number(l.qty_ordered),
    uom: l.uom || '',
    unit_cost_paise: Math.max(0, Math.round(Number(l.unit_cost_paise || 0))),
    line_amount_paise: Math.max(0, Math.round(Number(l.line_amount_paise || 0))),
    flag: l.flag || '',
  };
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}
function rupeeText(paise) {
  const n = Math.max(0, Math.round(Number(paise || 0)));
  return 'Rs ' + Math.round(n / 100).toLocaleString('en-IN');
}
function wabaConfig(env, outletBrand) {
  const b = String(outletBrand || '').toLowerCase();
  const candidates = [
    { brand: 'ops', phoneId: env.WA_OPS_PHONE_ID || env.WA_PHONE_ID, token: env.WA_OPS_TOKEN || env.WA_ACCESS_TOKEN || env.WA_COMMS_TOKEN },
    { brand: 'he', phoneId: env.WA_HE_PHONE_ID, token: env.WA_HE_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN },
    { brand: 'sparksol', phoneId: env.WA_SPARKSOL_PHONE_ID, token: env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN },
    b === 'nch' ? { brand: 'nch', phoneId: env.WA_NCH_PHONE_ID, token: env.WA_NCH_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN } : null,
    b === 'he' ? { brand: 'he', phoneId: env.WA_HE_PHONE_ID, token: env.WA_HE_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN } : null,
  ].filter(Boolean);
  return candidates.find(c => c.phoneId && c.token) || null;
}
async function sendWabaTemplate(env, outletBrand, phone, template, vars) {
  const cfg = wabaConfig(env, outletBrand);
  const to = normalizePhone(phone);
  if (!cfg) return { ok: false, skipped: 'waba_not_configured' };
  if (!to || to.length < 10) return { ok: false, skipped: 'phone_missing' };
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: (vars || []).map(v => ({ type: 'text', text: String(v || '-').slice(0, 900) })),
      }],
    },
  };
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    brand: cfg.brand,
    to,
    template,
    provider_msg_id: parsed?.messages?.[0]?.id || null,
    error: res.ok ? null : (parsed?.error?.message || text.slice(0, 240)),
  };
}
async function resolveStaffPhone(env, db, pin) {
  const p = String(pin || '').trim();
  if (!p) return '';
  if (env.DB) {
    for (const col of ['phone', 'mobile', 'whatsapp']) {
      try {
        const row = await env.DB.prepare(`SELECT ${col} phone FROM hr_employees WHERE staff_pin=? LIMIT 1`).bind(p).first();
        const phone = normalizePhone(row?.phone || '');
        if (phone) return phone;
      } catch (_) {}
    }
  }
  for (const col of ['phone', 'mobile', 'whatsapp']) {
    try {
      const row = await db.prepare(`SELECT ${col} phone FROM staff WHERE staff_pin=? LIMIT 1`).bind(p).first();
      const phone = normalizePhone(row?.phone || '');
      if (phone) return phone;
    } catch (_) {}
  }
  return '';
}
async function purchaseActor(db, orderId, fallbackUser) {
  try {
    const ev = await db.prepare(
      `SELECT actor_pin,actor_name FROM purchase_event_log
        WHERE order_id=? AND event_type IN ('place','mark-ordered')
        ORDER BY id ASC LIMIT 1`).bind(orderId).first();
    if (ev?.actor_pin || ev?.actor_name) return { pin: ev.actor_pin || '', name: ev.actor_name || fallbackUser?.name || '' };
  } catch (_) {}
  return { pin: fallbackUser?.staff_pin || '', name: fallbackUser?.name || '' };
}
function lineSummary(lines) {
  const parts = lines.slice(0, 8).map(l => {
    const q = l.qty_ordered == null ? '' : `${Number(l.qty_ordered).toLocaleString('en-IN')} ${l.uom || ''}`.trim();
    return `${l.item_label}${q ? ' - ' + q : ''}`;
  });
  if (lines.length > 8) parts.push(`+${lines.length - 8} more`);
  return parts.join('; ').slice(0, 900) || 'items as per Sauda card';
}
async function orderSnapshot(db, orderId) {
  const row = await db.prepare(
    `SELECT po.id,po.outlet_id,po.vendor_key,po.for_date,po.status,po.expected_amount_paise,
            po.pay_amount_paise,po.pay_method,po.bank_ref,po.ordered_by,
            v.name vendor_name,v.phone vendor_phone,v.vpa_json,v.fulfilment,v.pay_behaviour,
            o.brand outlet_brand,o.name outlet_name
       FROM purchase_orders po
       JOIN vendors v ON v.vendor_key=po.vendor_key
       JOIN outlets o ON o.outlet_id=po.outlet_id
      WHERE po.id=?`).bind(orderId).first();
  if (!row) return null;
  const lines = (await db.prepare(
    `SELECT item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise
       FROM purchase_order_lines WHERE order_id=? ORDER BY id`).bind(orderId).all()).results || [];
  return { ...row, lines, items_text: lineSummary(lines) };
}
async function dispatchOrderPlacedWaba(context, db, orderId, actorUser) {
  const snap = await orderSnapshot(db, orderId);
  if (!snap) return;
  const actor = { pin: actorUser?.staff_pin || '', name: actorUser?.name || snap.ordered_by || 'HN Staff' };
  const staffPhone = await resolveStaffPhone(context.env, db, actor.pin);
  const amount = snap.expected_amount_paise ? rupeeText(snap.expected_amount_paise) : 'rate at bill';
  const results = {
    vendor: snap.vendor_phone ? await sendWabaTemplate(context.env, snap.outlet_brand, snap.vendor_phone, 'sauda_vendor_order_placed_v1', [
      snap.vendor_name, snap.outlet_name, snap.for_date, snap.items_text, actor.name,
    ]) : { ok: false, skipped: 'vendor_phone_missing' },
    staff: staffPhone ? await sendWabaTemplate(context.env, snap.outlet_brand, staffPhone, 'sauda_staff_order_placed_v1', [
      snap.outlet_name, snap.vendor_name, snap.for_date, snap.items_text, amount,
    ]) : { ok: false, skipped: 'staff_phone_missing', actor_pin: actor.pin, actor_name: actor.name },
  };
  await writePurchaseEvent(db, orderId, 'waba-order-placed', actorUser, results);
}
async function dispatchPaymentDoneWaba(context, db, orderId, payerUser, amountPaise, method, ref) {
  const snap = await orderSnapshot(db, orderId);
  if (!snap) return;
  const actor = await purchaseActor(db, orderId, payerUser);
  const staffPhone = await resolveStaffPhone(context.env, db, actor.pin);
  const amount = rupeeText(amountPaise || snap.pay_amount_paise || snap.expected_amount_paise);
  const methodRef = [method || 'upi', ref || 'ref pending'].filter(Boolean).join(' / ');
  const results = {
    vendor: snap.vendor_phone ? await sendWabaTemplate(context.env, snap.outlet_brand, snap.vendor_phone, 'sauda_vendor_payment_done_v1', [
      snap.vendor_name, snap.outlet_name, amount, payerUser?.name || 'HN Hotels', methodRef,
    ]) : { ok: false, skipped: 'vendor_phone_missing' },
    staff: staffPhone ? await sendWabaTemplate(context.env, snap.outlet_brand, staffPhone, 'sauda_staff_payment_done_v1', [
      snap.vendor_name, snap.outlet_name, amount, methodRef, payerUser?.name || 'HN Hotels',
    ]) : { ok: false, skipped: 'staff_phone_missing', actor_pin: actor.pin, actor_name: actor.name },
  };
  await writePurchaseEvent(db, orderId, 'waba-payment-done', payerUser, results);
}
function waitUntil(context, promise) {
  const guarded = promise.catch(async e => {
    try { console.error('purchase waba dispatch failed', e?.message || e); } catch (_) {}
  });
  if (context.waitUntil) context.waitUntil(guarded);
}

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

function keySlug(s, fallback) {
  const out = norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 54);
  return out || fallback;
}
async function uniqueTextKey(db, table, col, base) {
  const root = keySlug(base, col);
  for (let i = 0; i < 100; i++) {
    const k = i === 0 ? root : `${root}_${i + 1}`;
    const row = await db.prepare(`SELECT ${col} FROM ${table} WHERE ${col}=?`).bind(k).first();
    if (!row) return k;
  }
  return `${root}_${Date.now()}`;
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
      const itemRows = (await db.prepare(
        `SELECT item_code,label,unit,pack_label,price_paise,price_mode,default_vendor,category FROM items
          WHERE active=1 ORDER BY label`).all()).results || [];
      const aliases = (await db.prepare(
        `SELECT item_code, GROUP_CONCAT(alias, ' ') aliases FROM item_aliases GROUP BY item_code`).all()).results || [];
      const aliasByCode = Object.fromEntries(aliases.map(a => [a.item_code, a.aliases || '']));
      let priceRows = [];
      try {
        priceRows = (await db.prepare(
          `SELECT h.item_code,h.item_label,h.for_date last_date,h.qty,h.uom,h.unit_cost_paise,
                  h.line_total_paise,h.vendor_key,h.vendor_name,h.source
             FROM purchase_price_history h
             JOIN (
               SELECT item_code, MAX(for_date || ':' || printf('%010d', id)) latest_key
                 FROM purchase_price_history
                WHERE (outlet_id=? OR outlet_id='' OR brand=? OR brand='both' OR brand='')
                  AND item_code <> ''
                GROUP BY item_code
             ) x ON x.item_code=h.item_code AND x.latest_key=(h.for_date || ':' || printf('%010d', h.id))`)
          .bind(outlet, brand).all()).results || [];
      } catch (e) {
        priceRows = [];
      }
      const cardHistory = (await db.prepare(
        `SELECT l.item_code,l.item_label,po.for_date last_date,l.qty_ordered qty,l.uom,l.unit_cost_paise,
                l.line_amount_paise,po.vendor_key,v.name vendor_name,po.source
           FROM purchase_order_lines l
           JOIN purchase_orders po ON po.id=l.order_id
           JOIN vendors v ON v.vendor_key=po.vendor_key
          WHERE po.outlet_id=? AND l.item_code<>'' ORDER BY po.for_date DESC,l.id DESC`).bind(outlet).all()).results || [];
      const historyByItem = {};
      for (const h of [...priceRows, ...cardHistory]) {
        if (!h.item_code) continue;
        const cur = historyByItem[h.item_code];
        if (cur && (cur.last_date || '') > (h.last_date || '')) continue;
        historyByItem[h.item_code] = {
          item_label: h.item_label || '',
          last_date: h.last_date || '',
          last_qty: h.qty == null ? null : Number(h.qty),
          uom: h.uom || '',
          unit_cost_paise: Number(h.unit_cost_paise || 0),
          line_amount_paise: Number(h.line_total_paise || h.line_amount_paise || 0),
          vendor_key: h.vendor_key || '',
          vendor_name: h.vendor_name || '',
          source: h.source || ''
        };
      }
      const items = itemRows.map(it => ({
        ...it,
        aliases: aliasByCode[it.item_code] || '',
        hindi_label: hindiLabelFor(it, aliasByCode[it.item_code] || ''),
        photo_url: '',
        search_text: [it.label, it.item_code, it.category, it.unit, aliasByCode[it.item_code] || '',
          hindiLabelFor(it, aliasByCode[it.item_code] || '')].join(' ')
      }));
      const byVendor = {};
      for (const it of items) { (byVendor[it.default_vendor] ||= []).push(it); }
      return J({ ok: true, outlet, brand, vendors, items_by_vendor: byVendor, item_count: items.length,
        history_by_item: historyByItem, alias_count: aliases.length });
    }

    // ---------- purchase day: HN-wide owner-style day ledger ----------
    if (action === 'purchase_day' || action === 'purchase_day_pdf') {
      if (!can(u, 'sauda.demand') && !can(u, 'sauda.place') && !can(u, 'sauda.receive') && !can(u, 'sauda.raise')) {
        return J({ ok: false, error: 'not permitted for Sauda' }, 403);
      }
      const date = url.searchParams.get('date') || url.searchParams.get('for_date') || istDate();
      const brandFilter = url.searchParams.get('brand') || 'all';
      const data = await purchaseDayRows(db, u, date, brandFilter);
      const lineCount = data.cards.reduce((n, c) => n + (c.line_count || 0), 0);
      const recvCount = data.cards.reduce((n, c) => n + (c.recv_count || 0), 0);
      const expected = data.cards.reduce((n, c) => n + (c.expected_amount_paise || 0), 0);
      const brands = [...new Set(data.allowed.map(o => o.brand))];
      if (action === 'purchase_day') {
        return J({ ok: true, date, brand: brandFilter, outlets: data.allowed, brands,
          cards: data.cards, lines_by_order: data.linesByOrder,
          summary: { vendor_cards: data.cards.length, order_lines: lineCount,
            received_lines: recvCount, expected_amount_paise: expected } });
      }
      const grouped = {};
      for (const c of data.cards) (grouped[c.outlet_brand] ||= []).push(c);
      const sections = Object.entries(grouped).map(([brand, cards]) => (
        `<section><h2>${esc(brand === 'HE' ? 'Hamza Express' : brand === 'NCH' ? 'Nawabi Chai House' : brand)}
          <span>${cards.length} vendor card${cards.length === 1 ? '' : 's'}</span></h2>` +
        cards.map(c => {
          const lines = data.linesByOrder[c.id] || [];
          const rows = lines.map(l => `<tr${l.flag ? ' class="warn"' : ''}><td>${esc(l.item_label)}</td><td>${esc(l.qty_ordered ?? '')} ${esc(l.uom || '')}</td><td>${l.unit_cost_paise ? esc('₹' + Math.round(l.unit_cost_paise / 100).toLocaleString('en-IN')) : 'rate pending'}</td><td>${l.line_amount_paise ? esc('₹' + Math.round(l.line_amount_paise / 100).toLocaleString('en-IN')) : '—'}</td><td>${l.qty_received != null ? esc(String(l.qty_received) + ' ' + (l.uom || '')) : 'receive pending'}${l.flag ? `<div class="note">${esc(l.flag)}</div>` : ''}</td></tr>`).join('');
          return `<div class="card"><h3>${esc(c.vendor_name)}
            <span>${esc(c.fulfilment || '')} · ${esc(c.pay_behaviour || '')} · ${esc(c.status || '')}</span></h3>
            <table><tr><th>Item</th><th>Ordered</th><th>Rate</th><th>Bill basis</th><th>Received</th></tr>${rows}</table></div>`;
        }).join('') + `</section>`
      )).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>HN Sauda Purchase Day</title>
        <style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:20px;color:#17110d}@page{size:A4 landscape;margin:9mm}.printbar{position:sticky;top:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;margin-bottom:10px;display:flex;gap:8px;align-items:center}.printbar button{padding:7px 12px;border:0;border-radius:7px;background:#581810;color:#fff;font-weight:800}.printbar span{font-size:12px;color:#555}h1{font-size:20px;margin:0 0 3px}.sub{font-size:11px;color:#666;margin-bottom:9px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0 11px}.box{border:1px solid #ddd;border-radius:7px;padding:7px}.box b{display:block;font-size:17px}.box span{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.04em}section,.card{break-inside:avoid}h2{font-size:14px;margin:14px 0 5px;color:#581810;border-bottom:2px solid #581810;padding-bottom:3px}h2 span,h3 span{float:right;color:#777;font-weight:500;font-size:10.5px}h3{font-size:13px;margin:9px 0 4px}table{width:100%;border-collapse:collapse;font-size:10.2px}th{text-align:left;background:#f3efe8;padding:5px;border:1px solid #d6d0c7}td{padding:5px;border:1px solid #e2e2e2;vertical-align:top}.warn td{background:#fff1dd}.note{font-size:9.5px;color:#7a4b11;margin-top:2px}@media print{body{margin:0}.printbar{display:none}}</style></head><body>
        <div class="printbar"><button onclick="window.print()">Print / Save PDF</button><span>A4 landscape · HN-wide Sauda Purchase Day from the staff ops store.</span></div>
        <h1>HN Sauda — Purchase Day · ${esc(date)}</h1><div class="sub">Selected brand: ${esc(brandFilter === 'all' ? 'All' : brandFilter)} · generated ${esc(istNow())}</div>
        <div class="summary"><div class="box"><b>${data.cards.length}</b><span>vendor cards</span></div><div class="box"><b>${lineCount}</b><span>order lines</span></div><div class="box"><b>${recvCount}</b><span>received lines</span></div><div class="box"><b>₹${Math.round(expected / 100).toLocaleString('en-IN')}</b><span>bill basis</span></div></div>
        ${sections || '<p>No purchase orders for this day.</p>'}</body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // ---------- vendor diary: per-vendor outstanding + paid local trail ----------
    if (action === 'vendor_diary') {
      if (!can(u, 'sauda.demand') && !can(u, 'sauda.place') && !can(u, 'sauda.receive') && !can(u, 'sauda.raise') && !can(u, 'sauda.pay')) {
        return J({ ok: false, error: 'not permitted for Sauda' }, 403);
      }
      const date = url.searchParams.get('date') || istDate();
      const days = Math.max(1, Math.min(120, parseInt(url.searchParams.get('days') || '45', 10) || 45));
      const brandFilter = url.searchParams.get('brand') || 'all';
      const allowed = await allowedOutletRows(db, u);
      const ids = allowed.map(o => o.outlet_id);
      if (!ids.length) return J({ ok: true, date, days, brand: brandFilter, vendors: [], summary: { vendor_count: 0, open_cards: 0, outstanding_paise: 0, paid_paise: 0 } });
      const placeholders = ids.map(() => '?').join(',');
      const bf = brandPassSql('o', brandFilter);
      const rows = (await db.prepare(
        `SELECT po.id,po.outlet_id,po.vendor_key,po.for_date,po.status,
                po.expected_amount_paise,po.pay_amount_paise,po.pay_method,po.bank_ref,
                po.ordered_by,po.received_by,po.raised_by,po.paid_at,
                v.name vendor_name,v.brand vendor_brand,v.fulfilment,v.pay_behaviour,v.phone,v.vpa_json,
                o.brand,o.name outlet_name,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=po.id) line_count
           FROM purchase_orders po
           JOIN vendors v ON v.vendor_key=po.vendor_key
           JOIN outlets o ON o.outlet_id=po.outlet_id
          WHERE po.outlet_id IN (${placeholders})
            AND po.status<>'CANCELLED'
            AND po.for_date >= date(?, '-' || ? || ' days')
            AND po.for_date <= ?
            ${bf.sql}
          ORDER BY v.name, po.for_date DESC, po.id DESC`)
        .bind(...ids, date, days - 1, date, ...bf.vals).all()).results || [];
      const byVendor = new Map();
      for (const r of rows) {
        const key = r.vendor_key || r.vendor_name;
        if (!byVendor.has(key)) byVendor.set(key, {
          vendor_key: r.vendor_key,
          vendor_name: r.vendor_name,
          brand: r.vendor_brand || r.brand || '',
          fulfilment: r.fulfilment || '',
          pay_behaviour: r.pay_behaviour || '',
          phone: r.phone || '',
          vpa_json: r.vpa_json || '[]',
          order_count: 0,
          received_paise: 0,
          raised_paise: 0,
          paid_paise: 0,
          outstanding_paise: 0,
          latest_date: '',
          latest_status: '',
          cards: [],
        });
        const v = byVendor.get(key);
        const amount = Math.max(0, Math.round(Number(r.pay_amount_paise || r.expected_amount_paise || 0)));
        v.order_count += 1;
        if (!v.latest_date || r.for_date > v.latest_date) { v.latest_date = r.for_date; v.latest_status = r.status; }
        if (['RECEIVED', 'RAISED', 'PAID', 'RECONCILED'].includes(r.status)) v.received_paise += amount;
        if (r.status === 'RAISED') v.raised_paise += amount;
        if (['PAID', 'RECONCILED'].includes(r.status)) v.paid_paise += amount;
        if (['RECEIVED', 'RAISED'].includes(r.status)) v.outstanding_paise += amount;
        v.cards.push({
          id: r.id,
          outlet_id: r.outlet_id,
          brand: r.brand,
          outlet_name: r.outlet_name,
          for_date: r.for_date,
          status: r.status,
          amount_paise: amount,
          line_count: Number(r.line_count || 0),
          pay_method: r.pay_method || '',
          bank_ref: r.bank_ref || '',
        });
      }
      const vendors = [...byVendor.values()].sort((a, b) => (b.outstanding_paise - a.outstanding_paise) || a.vendor_name.localeCompare(b.vendor_name));
      const summary = {
        vendor_count: vendors.length,
        open_cards: vendors.reduce((n, v) => n + v.cards.filter(c => ['ORDERED', 'RECEIVED', 'RAISED'].includes(c.status)).length, 0),
        outstanding_paise: vendors.reduce((n, v) => n + v.outstanding_paise, 0),
        paid_paise: vendors.reduce((n, v) => n + v.paid_paise, 0),
      };
      return J({ ok: true, date, days, brand: brandFilter, vendors, summary });
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
          WHERE po.outlet_id=? AND po.for_date=? AND po.status<>'CANCELLED' ORDER BY po.expected_amount_paise DESC, v.name`)
        .bind(outlet, date).all()).results || [];
      return J({ ok: true, outlet, date, cards });
    }

    // ---------- one card + lines ----------
    if (action === 'card') {
      const id = url.searchParams.get('id');
      const po = await db.prepare(
        `SELECT po.*, v.name vendor_name, v.fulfilment, v.pay_behaviour, v.phone, v.vpa_json,
                (SELECT COUNT(*) FROM purchase_media m WHERE m.order_id=po.id AND m.kind='goods') goods_photo_count,
                (SELECT COUNT(*) FROM purchase_media m WHERE m.order_id=po.id AND m.kind='bill') bill_photo_count
           FROM purchase_orders po JOIN vendors v ON v.vendor_key=po.vendor_key WHERE po.id=?`).bind(id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const lines = (await db.prepare(
        `SELECT id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,qty_received,receive_state,flag
           FROM purchase_order_lines WHERE order_id=? ORDER BY id`).bind(id).all()).results || [];
      const events = await readPurchaseEvents(db, id);
      return J({ ok: true, card: po, lines, events });
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

    // ---------- MASTER: add a vendor with mandatory operational details ----------
    if (action === 'add-vendor' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to add vendors' }, 403);
      const b = await req.json().catch(() => ({}));
      const outlet = String(b.outlet || '').trim();
      const name = String(b.name || '').trim();
      const category = String(b.category || '').trim();
      const fulfilment = String(b.fulfilment || '').trim();
      const pay = String(b.pay_behaviour || '').trim();
      const phone = String(b.phone || '').trim();
      const vpa = String(b.vpa || '').trim();
      const validFulfilment = new Set(['deliver', 'collect', 'standing', 'porter', 'bus']);
      const validPay = new Set(['per', 'khata_roll', 'khata_periodic']);
      if (!outlet || !name || !category || !fulfilment || !pay || !phone) {
        return J({ ok: false, error: 'vendor name, category, fulfilment, payment rule and phone are required' }, 400);
      }
      if (!validFulfilment.has(fulfilment)) return J({ ok: false, error: 'invalid fulfilment rule' }, 400);
      if (!validPay.has(pay)) return J({ ok: false, error: 'invalid payment rule' }, 400);
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const o = await db.prepare(`SELECT brand FROM outlets WHERE outlet_id=? AND status='active'`).bind(outlet).first();
      if (!o) return J({ ok: false, error: 'unknown outlet' }, 400);
      const duplicate = await db.prepare(
        `SELECT vendor_key,name,brand,category,fulfilment,pay_behaviour,phone,vpa_json
           FROM vendors WHERE lower(name)=lower(?) AND (brand=? OR brand='both') AND active=1 LIMIT 1`)
        .bind(name, o.brand).first();
      if (duplicate) return J({ ok: true, vendor: duplicate, existed: true });
      const vendorKey = await uniqueTextKey(db, 'vendors', 'vendor_key', `${o.brand}_${name}`);
      const vpaJson = vpa ? JSON.stringify([vpa]) : '[]';
      await db.prepare(
        `INSERT INTO vendors (vendor_key,name,brand,category,fulfilment,pay_behaviour,phone,vpa_json,aliases_json,active,updated_at)
         VALUES (?,?,?,?,?,?,?,?, '[]',1,?)`)
        .bind(vendorKey, name, o.brand, category, fulfilment, pay, phone, vpaJson, istNow()).run();
      const vendor = await db.prepare(
        `SELECT vendor_key,name,brand,category,fulfilment,pay_behaviour,phone,vpa_json
           FROM vendors WHERE vendor_key=?`).bind(vendorKey).first();
      return J({ ok: true, vendor, existed: false });
    }

    // ---------- MASTER: add a product under a known vendor ----------
    if (action === 'add-item' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to add products' }, 403);
      const b = await req.json().catch(() => ({}));
      const outlet = String(b.outlet || '').trim();
      const vendorKey = String(b.vendor_key || '').trim();
      const label = String(b.label || b.item_label || '').trim();
      const unit = String(b.unit || '').trim();
      const category = String(b.category || '').trim();
      const priceMode = String(b.price_mode || 'live').trim();
      const pricePaise = Math.max(0, Math.round(Number(b.price_paise || 0)));
      if (!outlet || !vendorKey || !label || !unit || !category || !priceMode) {
        return J({ ok: false, error: 'vendor, product name, unit, category and price mode are required' }, 400);
      }
      if (!['fixed', 'live'].includes(priceMode)) return J({ ok: false, error: 'invalid price mode' }, 400);
      if (priceMode === 'fixed' && pricePaise <= 0) return J({ ok: false, error: 'expected rate required for fixed-rate products' }, 400);
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const o = await db.prepare(`SELECT brand FROM outlets WHERE outlet_id=? AND status='active'`).bind(outlet).first();
      if (!o) return J({ ok: false, error: 'unknown outlet' }, 400);
      const vendor = await db.prepare(`SELECT vendor_key,brand FROM vendors WHERE vendor_key=? AND active=1`).bind(vendorKey).first();
      if (!vendor) return J({ ok: false, error: 'unknown vendor' }, 400);
      if (vendor.brand !== 'both' && vendor.brand !== o.brand) return J({ ok: false, error: 'vendor does not belong to this outlet brand' }, 400);
      const duplicate = await db.prepare(
        `SELECT item_code,label,unit,pack_label,price_paise,price_mode,default_vendor,category,brand
           FROM items WHERE lower(label)=lower(?) AND default_vendor=? AND active=1 LIMIT 1`)
        .bind(label, vendorKey).first();
      if (duplicate) {
        return J({ ok: true, item: { ...duplicate, hindi_label: hindiLabelFor(duplicate, ''), search_text: [duplicate.label, duplicate.item_code, duplicate.category, duplicate.unit].join(' ') }, existed: true });
      }
      const itemCode = await uniqueTextKey(db, 'items', 'item_code', `${o.brand}_${vendorKey}_${label}`);
      await db.prepare(
        `INSERT INTO items (item_code,label,unit,pack_label,price_paise,price_mode,default_vendor,category,brand,active)
         VALUES (?,?,?,?,?,?,?,?,?,1)`)
        .bind(itemCode, label, unit, '', priceMode === 'fixed' ? pricePaise : 0, priceMode, vendorKey, category, o.brand).run();
      const item = await db.prepare(
        `SELECT item_code,label,unit,pack_label,price_paise,price_mode,default_vendor,category,brand
           FROM items WHERE item_code=?`).bind(itemCode).first();
      return J({ ok: true, item: { ...item, hindi_label: hindiLabelFor(item, ''), search_text: [item.label, item.item_code, item.category, item.unit].join(' ') }, existed: false });
    }

    // ---------- DEMAND: outlet staff adds item-first demand; system groups by vendor ----------
    if (action === 'demand' && req.method === 'POST') {
      if (!can(u, 'sauda.demand')) return J({ ok: false, error: 'not permitted to create demand' }, 403);
      const b = await req.json().catch(() => ({}));
      const outlet = b.outlet, for_date = b.for_date || istDate();
      const rawLines = Array.isArray(b.lines) ? b.lines : [];
      if (!outlet || !rawLines.length) return J({ ok: false, error: 'outlet and lines required' }, 400);
      if (!outletOk(u, outlet)) return J({ ok: false, error: 'outlet not permitted' }, 403);

      const items = (await db.prepare(`SELECT item_code,label,unit,price_paise,price_mode,default_vendor FROM items WHERE active=1`).all()).results || [];
      const aliases = (await db.prepare(`SELECT alias,item_code FROM item_aliases`).all()).results || [];
      const resolve = buildResolver(items, aliases);
      const byCode = Object.fromEntries(items.map(i => [i.item_code, i]));
      const grouped = new Map();
      for (const ln of rawLines) {
        const label = String(ln.item_label || ln.label || '').trim();
        if (!label) continue;
        const code = ln.item_code || resolve(label, false);
        const it = code ? byCode[code] : null;
        const vendorKey = (it && it.default_vendor) || '_unrouted';
        const qty = ln.qty != null && ln.qty !== '' ? Number(ln.qty) : null;
        const cost = it && it.price_mode !== 'live' ? Number(it.price_paise || 0) : 0;
        const line = {
          item_code: code || '',
          item_label: it?.label || label,
          qty,
          uom: ln.uom || it?.unit || '',
          unit_cost_paise: cost,
          flag: code ? '' : 'unmapped item - confirm master',
          raw: ln.raw || label,
        };
        (grouped.get(vendorKey) || grouped.set(vendorKey, []).get(vendorKey)).push(line);
      }
      if (!grouped.size) return J({ ok: false, error: 'no valid lines' }, 400);

      const created = [];
      for (const [vendorKey, lines] of grouped.entries()) {
        await db.prepare(
          `INSERT INTO purchase_orders (outlet_id,vendor_key,for_date,status,source,ordered_at,ordered_by)
           VALUES (?,?,?,'REQUESTED','outlet-demand',?,?)
           ON CONFLICT(outlet_id,vendor_key,for_date) DO UPDATE SET
             status=CASE WHEN status='CANCELLED' THEN 'REQUESTED' ELSE status END,
             updated_at=?`)
          .bind(outlet, vendorKey, for_date, istNow(), u.name, istNow()).run();
        const card = await db.prepare(
          `SELECT id FROM purchase_orders WHERE outlet_id=? AND vendor_key=? AND for_date=?`)
          .bind(outlet, vendorKey, for_date).first();
        const stmts = lines.map(ln => {
          const amt = ln.qty != null && ln.unit_cost_paise ? Math.round(ln.qty * ln.unit_cost_paise) : 0;
          return db.prepare(
            `INSERT INTO purchase_order_lines (order_id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,flag,raw)
             VALUES (?,?,?,?,?,?,?,?,?)`)
            .bind(card.id, ln.item_code, ln.item_label, ln.qty, ln.uom, ln.unit_cost_paise, amt, ln.flag, ln.raw);
        });
        await db.batch(stmts);
        const sum = (await db.prepare(`SELECT COALESCE(SUM(line_amount_paise),0) s FROM purchase_order_lines WHERE order_id=?`).bind(card.id).first()).s;
        await db.prepare(`UPDATE purchase_orders SET expected_amount_paise=?, updated_at=? WHERE id=?`).bind(sum, istNow(), card.id).run();
        await writePurchaseEvent(db, card.id, 'demand', u, {
          outlet, for_date, vendor_key: vendorKey, lines_added: lines.length, expected_amount_paise: sum
        });
        created.push({ order_id: card.id, vendor_key: vendorKey, lines_added: lines.length, expected_amount_paise: sum });
      }
      return J({ ok: true, for_date, outlet, orders: created });
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
         ON CONFLICT(outlet_id,vendor_key,for_date) DO UPDATE SET
           status=CASE WHEN status='CANCELLED' THEN 'ORDERED' ELSE status END,
           updated_at=?`)
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
      await writePurchaseEvent(db, card.id, 'place', u, {
        outlet, for_date, vendor_key, lines_added: lines.length, expected_amount_paise: sum
      });
      waitUntil(context, dispatchOrderPlacedWaba(context, db, card.id, u));
      return J({ ok: true, order_id: card.id, expected_amount_paise: sum, lines_added: lines.length });
    }

    // ---------- EDIT: replace pre-receive item lines with a visible trail ----------
    if (action === 'edit-lines' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to edit order items' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      const incoming = Array.isArray(b.lines) ? b.lines : [];
      if (!order_id) return J({ ok: false, error: 'order_id required' }, 400);
      if (!incoming.length) return J({ ok: false, error: 'keep at least one item on the card' }, 400);
      const po = await db.prepare(`SELECT id,outlet_id,status,expected_amount_paise FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      if (!['REQUESTED', 'ORDERED'].includes(po.status)) {
        return J({ ok: false, error: 'items can only be edited before receiving proof' }, 400);
      }
      const existing = (await db.prepare(
        `SELECT id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,qty_received,receive_state,flag,raw
           FROM purchase_order_lines WHERE order_id=? ORDER BY id`).bind(order_id).all()).results || [];
      const byId = Object.fromEntries(existing.map(l => [Number(l.id), l]));
      const seen = new Set();
      const normalized = [];
      for (const ln of incoming) {
        const lineId = Number(ln.line_id || ln.id || 0);
        if (lineId && !byId[lineId]) return J({ ok: false, error: 'unknown edit line' }, 400);
        if (lineId && seen.has(lineId)) return J({ ok: false, error: 'duplicate edit line' }, 400);
        if (lineId) seen.add(lineId);
        const label = String(ln.item_label || ln.label || '').trim();
        if (!label) return J({ ok: false, error: 'item label required' }, 400);
        const qty = ln.qty_ordered != null && ln.qty_ordered !== '' ? Number(ln.qty_ordered) :
          (ln.qty != null && ln.qty !== '' ? Number(ln.qty) : null);
        if (!Number.isFinite(qty) || qty <= 0) return J({ ok: false, error: `quantity required for ${label}` }, 400);
        const cost = Math.max(0, Math.round(Number(ln.unit_cost_paise || 0)));
        const amount = cost ? Math.round(qty * cost) : 0;
        normalized.push({
          line_id: lineId,
          item_code: String(ln.item_code || ''),
          item_label: label,
          qty_ordered: qty,
          uom: String(ln.uom || ''),
          unit_cost_paise: cost,
          line_amount_paise: amount,
          flag: String(ln.flag || ''),
          raw: String(ln.raw || label),
        });
      }
      const removeIds = existing.map(l => Number(l.id)).filter(id => !seen.has(id));
      const expected = normalized.reduce((n, l) => n + l.line_amount_paise, 0);
      const before = existing.map(purchaseLineSnapshot);
      const stmts = [];
      for (const ln of normalized) {
        if (ln.line_id) {
          stmts.push(db.prepare(
            `UPDATE purchase_order_lines
                SET item_code=?, item_label=?, qty_ordered=?, uom=?, unit_cost_paise=?, line_amount_paise=?, flag=?, raw=?
              WHERE id=? AND order_id=?`)
            .bind(ln.item_code, ln.item_label, ln.qty_ordered, ln.uom, ln.unit_cost_paise, ln.line_amount_paise,
              ln.flag, ln.raw, ln.line_id, order_id));
        } else {
          stmts.push(db.prepare(
            `INSERT INTO purchase_order_lines (order_id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,flag,raw)
             VALUES (?,?,?,?,?,?,?,?,?)`)
            .bind(order_id, ln.item_code, ln.item_label, ln.qty_ordered, ln.uom, ln.unit_cost_paise, ln.line_amount_paise,
              ln.flag, ln.raw));
        }
      }
      for (const id of removeIds) {
        stmts.push(db.prepare(`DELETE FROM purchase_order_lines WHERE id=? AND order_id=?`).bind(id, order_id));
      }
      stmts.push(db.prepare(`UPDATE purchase_orders SET expected_amount_paise=?, updated_at=? WHERE id=?`).bind(expected, istNow(), order_id));
      await ensurePurchaseEventLog(db);
      stmts.push(db.prepare(
        `INSERT INTO purchase_event_log (order_id,event_type,actor_pin,actor_name,payload_json)
         VALUES (?,?,?,?,?)`)
        .bind(order_id, 'edit-lines', u.staff_pin || '', u.name || '', JSON.stringify({
          status: po.status,
          previous_amount_paise: Number(po.expected_amount_paise || 0),
          expected_amount_paise: expected,
          removed_line_ids: removeIds,
          before,
          after: normalized.map(l => ({ ...l, id: l.line_id || null })),
        })));
      await db.batch(stmts);
      return J({ ok: true, order_id, expected_amount_paise: expected, lines_updated: normalized.length, lines_removed: removeIds.length });
    }

    // ---------- DELETE: cancel a pre-receive card without destroying its trail ----------
    if (action === 'delete-order' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to delete order cards' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      if (!order_id) return J({ ok: false, error: 'order_id required' }, 400);
      const po = await db.prepare(`SELECT id,outlet_id,status,expected_amount_paise,vendor_key,for_date FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      if (!['REQUESTED', 'ORDERED'].includes(po.status)) {
        return J({ ok: false, error: 'order cards can only be deleted before receiving proof' }, 400);
      }
      const lines = (await db.prepare(
        `SELECT id,item_code,item_label,qty_ordered,uom,unit_cost_paise,line_amount_paise,flag
           FROM purchase_order_lines WHERE order_id=? ORDER BY id`).bind(order_id).all()).results || [];
      await writePurchaseEvent(db, order_id, 'delete-order', u, {
        previous_status: po.status,
        outlet_id: po.outlet_id,
        vendor_key: po.vendor_key,
        for_date: po.for_date,
        expected_amount_paise: Number(po.expected_amount_paise || 0),
        lines: lines.map(purchaseLineSnapshot),
        reason: String(b.reason || 'deleted from Android purchase card').slice(0, 240),
      });
      await db.prepare(`UPDATE purchase_orders SET status='CANCELLED', updated_at=? WHERE id=?`).bind(istNow(), order_id).run();
      return J({ ok: true, order_id, status: 'CANCELLED' });
    }

    // ---------- ORDERED: purchase person confirms vendor order was placed ----------
    if (action === 'mark-ordered' && req.method === 'POST') {
      if (!can(u, 'sauda.place')) return J({ ok: false, error: 'not permitted to place' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      const po = await db.prepare(`SELECT id,outlet_id FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      await db.prepare(`UPDATE purchase_orders SET status='ORDERED', ordered_at=COALESCE(ordered_at,?), ordered_by=?, updated_at=? WHERE id=?`)
        .bind(istNow(), u.name, istNow(), order_id).run();
      await writePurchaseEvent(db, order_id, 'mark-ordered', u, { status: 'ORDERED' });
      waitUntil(context, dispatchOrderPlacedWaba(context, db, order_id, u));
      return J({ ok: true, order_id, status: 'ORDERED' });
    }

    // ---------- RECEIVE: per-line received qty + state, card -> RECEIVED ----------
    if (action === 'receive' && req.method === 'POST') {
      if (!can(u, 'sauda.receive')) return J({ ok: false, error: 'not permitted to receive' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!order_id) return J({ ok: false, error: 'order_id required' }, 400);
      if (!lines.length) return J({ ok: false, error: 'received lines required' }, 400);
      if (!b.goods_image || !b.bill_image) return J({ ok: false, error: 'goods photo and bill photo required before receiving' }, 400);
      const po = await db.prepare(`SELECT id,outlet_id,status FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const existing = (await db.prepare(`SELECT id,qty_ordered,qty_received,unit_cost_paise FROM purchase_order_lines WHERE order_id=?`)
        .bind(order_id).all()).results || [];
      if (lines.length !== existing.length) return J({ ok: false, error: 'every order line must be received' }, 400);
      const byLine = Object.fromEntries(existing.map(l => [l.id, l]));
      const seen = new Set();
      const stmts = [];
      for (const ln of lines) {
        const lineId = Number(ln.line_id || 0);
        if (!byLine[lineId]) return J({ ok: false, error: 'unknown receive line' }, 400);
        if (seen.has(lineId)) return J({ ok: false, error: 'duplicate receive line' }, 400);
        seen.add(lineId);
        const state = String(ln.receive_state || 'ok');
        const qr = ln.qty_received != null && ln.qty_received !== '' ? Number(ln.qty_received) : null;
        const cost = ln.unit_cost_paise != null && ln.unit_cost_paise !== '' ? Math.max(0, Math.round(Number(ln.unit_cost_paise))) : null;
        if (state !== 'missing' && (!Number.isFinite(qr) || qr <= 0)) {
          return J({ ok: false, error: 'received quantity required for every line' }, 400);
        }
        if (state !== 'missing' && (!Number.isFinite(cost) || cost <= 0)) {
          return J({ ok: false, error: 'bill rate required for every line' }, 400);
        }
        const basisQty = state === 'missing' ? 0 : qr;
        const finalCost = state === 'missing' ? 0 : cost;
        const amount = finalCost ? Math.round((Number.isFinite(basisQty) ? basisQty : 0) * finalCost) : 0;
        stmts.push(db.prepare(
          `UPDATE purchase_order_lines SET qty_received=?, receive_state=?, unit_cost_paise=?, line_amount_paise=? WHERE id=? AND order_id=?`)
          .bind(basisQty, state, finalCost, amount, lineId, order_id));
      }
      if (stmts.length) await db.batch(stmts);
      await storeOrderMedia(env, db, order_id, 'goods', b.goods_image, u.name);
      await storeOrderMedia(env, db, order_id, 'bill', b.bill_image, u.name);
      const sum = (await db.prepare(`SELECT COALESCE(SUM(line_amount_paise),0) s FROM purchase_order_lines WHERE order_id=?`).bind(order_id).first()).s;
      await db.prepare(
        `UPDATE purchase_orders SET status='RECEIVED', expected_amount_paise=?, received_at=?, received_by=?, received_station=?, receive_note=?, updated_at=? WHERE id=?`)
        .bind(sum, istNow(), u.name, b.station || u.brand || '', b.note || '', istNow(), order_id).run();
      await writePurchaseEvent(db, order_id, 'receive', u, {
        expected_amount_paise: sum,
        lines_updated: stmts.length,
        goods_photo: true,
        bill_photo: true,
        note: String(b.note || '').slice(0, 400),
      });
      return J({ ok: true, order_id, status: 'RECEIVED', expected_amount_paise: sum, lines_updated: stmts.length });
    }

    // ---------- PAYMENT TRAIL: save requested/paid evidence without forcing one rail ----------
    if (action === 'payment' && req.method === 'POST') {
      if (!can(u, 'sauda.raise') && !can(u, 'sauda.pay')) return J({ ok: false, error: 'not permitted for payment trail' }, 403);
      const b = await req.json().catch(() => ({}));
      const order_id = b.order_id;
      const po = await db.prepare(`SELECT id,outlet_id,status,expected_amount_paise FROM purchase_orders WHERE id=?`).bind(order_id).first();
      if (!po) return J({ ok: false, error: 'card not found' }, 404);
      if (!outletOk(u, po.outlet_id)) return J({ ok: false, error: 'outlet not permitted' }, 403);
      const proof = await db.prepare(
        `SELECT
           SUM(CASE WHEN kind='goods' THEN 1 ELSE 0 END) goods_count,
           SUM(CASE WHEN kind='bill' THEN 1 ELSE 0 END) bill_count
           FROM purchase_media WHERE order_id=?`).bind(order_id).first();
      if (!Number(proof?.goods_count || 0) || !Number(proof?.bill_count || 0)) {
        return J({ ok: false, error: 'receive proof required before payment trail' }, 400);
      }
      const incomplete = await db.prepare(
        `SELECT COUNT(*) n FROM purchase_order_lines
          WHERE order_id=? AND (qty_received IS NULL OR qty_received<=0 OR unit_cost_paise IS NULL OR unit_cost_paise<=0)`)
        .bind(order_id).first();
      if (Number(incomplete?.n || 0) > 0) {
        return J({ ok: false, error: 'received quantity and bill rate required before payment trail' }, 400);
      }
      const paid = !!b.paid && can(u, 'sauda.pay');
      const amount = Math.max(0, Math.round(Number(b.pay_amount_paise || po.expected_amount_paise || 0)));
      if (amount <= 0) return J({ ok: false, error: 'payment amount required' }, 400);
      await db.prepare(
        `UPDATE purchase_orders
            SET status=?, raised_at=COALESCE(raised_at,?), raised_by=COALESCE(raised_by,?),
                pay_method=?, pay_amount_paise=?, bank_ref=?, paid_at=CASE WHEN ? THEN ? ELSE paid_at END,
                updated_at=?
          WHERE id=?`)
        .bind(paid ? 'PAID' : 'RAISED', istNow(), u.name, String(b.pay_method || '').slice(0, 40),
          amount, String(b.bank_ref || '').slice(0, 160), paid ? 1 : 0, istNow(), istNow(), order_id).run();
      await writePurchaseEvent(db, order_id, paid ? 'paid' : 'payment-request', u, {
        pay_method: String(b.pay_method || '').slice(0, 40),
        pay_amount_paise: amount,
        bank_ref: String(b.bank_ref || '').slice(0, 160),
      });
      if (paid) {
        waitUntil(context, dispatchPaymentDoneWaba(context, db, order_id, u, amount, String(b.pay_method || '').slice(0, 40), String(b.bank_ref || '').slice(0, 160)));
      }
      return J({ ok: true, order_id, status: paid ? 'PAID' : 'RAISED', pay_amount_paise: amount });
    }

    return J({ ok: false, error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return J({ ok: false, error: String(e && e.message || e) }, 500);
  }
}
