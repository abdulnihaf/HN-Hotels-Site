const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FINANCE_ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const HE_POS_ODOO_URL = 'https://test.hamzahotel.com/jsonrpc';
const ODOO_DB = 'main';
const HE_COMPANY_ID = 2;
const HE_POS_CONFIGS = [5, 6, 10];

const USERS = {
  '0305': { name: 'Nihaf', role: 'admin' },
  '5882': { name: 'Nihaf', role: 'admin' },
  '2026': { name: 'Zoya', role: 'purchase' },
  '8316': { name: 'Zoya', role: 'purchase' },
  '3678': { name: 'Faheem', role: 'settlement' },
  '6045': { name: 'Faheem', role: 'settlement' },
  '8523': { name: 'Basheer', role: 'settlement' },
  '3754': { name: 'Naveen', role: 'staff' },
  '4040': { name: 'Haneef', role: 'viewer' },
  '5050': { name: 'Nisar', role: 'viewer' },
};

const VENDORS = [
  { key: 'nazeer-nadeem', name: 'Nazeer Nadeem' },
  { key: 'tabrez', name: 'tabrez' },
];

const DIRECT_ITEMS = [
  {
    key: 'water_500ml',
    label: 'Bottled Water 500ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 775,
    purchase_aliases: ['bottled water 500ml', 'bottled water', 'water bottle 500ml'],
    sales_aliases: ['bottled water 500ml', 'water bottle 500ml', 'bisleri 500ml', 'kinley 500ml'],
  },
  {
    key: 'water_1l_bisleri',
    label: 'Bisleri Water 1L',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 1110,
    purchase_aliases: ['bisleri water bottel 1 liter', 'bisleri water bottle 1 liter', 'bisleri water 1 liter'],
    sales_aliases: ['bisleri water 1l', 'bisleri water bottle 1l', 'water bottle 1l'],
  },
  {
    key: 'water_1l_kinley',
    label: 'Kinley Water 1L',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 1100,
    purchase_aliases: ['water bottle 1 liter kinley', 'kinley water 1 liter', 'kinley water bottle 1 liter'],
    sales_aliases: ['kinley water 1l', 'kinley water bottle 1l', 'water bottle 1l'],
  },
  {
    key: 'thums_up_250ml',
    label: 'Thums Up 250ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 1522,
    purchase_aliases: ['thums up 250 ml', 'thums up 250ml', 'thumbs up 250 ml'],
    sales_aliases: ['thums up 250ml', 'thums up 250 ml', 'thumbs up 250ml'],
  },
  {
    key: 'sprite_250ml',
    label: 'Sprite 250ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 1429,
    purchase_aliases: ['sprite 250 ml', 'sprite 250ml'],
    sales_aliases: ['sprite 250ml', 'sprite 250 ml'],
  },
  {
    key: 'coke_250ml',
    label: 'Coke 250ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 1371,
    purchase_aliases: ['coke 250 ml', 'coke 250ml'],
    sales_aliases: ['coke 250ml', 'coke 250 ml', 'coca cola 250ml'],
  },
  {
    key: 'thums_up_750ml',
    label: 'Thums Up 750ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 2691,
    purchase_aliases: ['thumsup 750 ml', 'thums up 750 ml', 'thums up 750ml'],
    sales_aliases: ['thums up 750ml', 'thums up 750 ml', 'thumbs up 750ml'],
  },
  {
    key: 'sprite_750ml',
    label: 'Sprite 750ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 2691,
    purchase_aliases: ['sprite 750 ml', 'sprite 750ml'],
    sales_aliases: ['sprite 750ml', 'sprite 750 ml'],
  },
  {
    key: 'coke_750ml',
    label: 'Coke 750ml',
    vendor_key: 'nazeer-nadeem',
    vendor_name: 'Nazeer Nadeem',
    unit: 'Units',
    fallback_unit_cost_paise: 3083,
    purchase_aliases: ['coke 750 ml', 'coke 750ml'],
    sales_aliases: ['coke 750ml', 'coke 750 ml', 'coca cola 750ml'],
  },
  {
    key: 'rumali_roti',
    label: 'Rumali Roti',
    vendor_key: 'tabrez',
    vendor_name: 'tabrez',
    unit: 'Units',
    fallback_unit_cost_paise: 1000,
    purchase_aliases: ['rumali roti', 'roomali roti'],
    sales_aliases: ['rumali roti', 'roomali roti'],
  },
];

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || '';

  try {
    if (context.request.method === 'GET') {
      if (action === 'verify-pin') return verifyPin(url);
      if (action === 'config') return json({ success: true, brand: 'HE', vendors: VENDORS, items: publicItems() });
      if (action === 'summary') return getSummary(context, url);
      if (action === 'sessions') return getSessions(context, url);
      return json({ success: false, error: `Unknown GET action: ${action}` }, 400);
    }

    if (context.request.method === 'POST') {
      const body = await context.request.json();
      if (body.action === 'save-settlement') return saveSettlement(context, body);
      return json({ success: false, error: `Unknown POST action: ${body.action || action}` }, 400);
    }

    return json({ success: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ success: false, error: err.message || String(err) }, err.status || 500);
  }
}

function verifyPin(url) {
  const pin = url.searchParams.get('pin') || '';
  const user = USERS[pin];
  if (!user) return json({ success: false, error: 'Invalid PIN' }, 401);
  return json({ success: true, user });
}

async function getSummary(context, url) {
  const user = requireUser(url.searchParams.get('pin'));
  const DB = requireDb(context.env);
  const businessDate = requireBusinessDate(url.searchParams.get('business_date'));
  const settlementType = normalizeSettlementType(url.searchParams.get('settlement_type') || 'eod');
  const window = businessWindowUtc(businessDate);

  const [purchases, sales, latestSession, baselines, vendorDues] = await Promise.all([
    fetchPurchases(context.env, window),
    fetchSales(context.env, window),
    getLatestSession(DB, businessDate, settlementType),
    getBaselines(DB, businessDate, settlementType),
    getVendorDues(DB),
  ]);

  const existingCounts = latestSession
    ? await getSessionCounts(DB, latestSession.id)
    : {};

  const rows = DIRECT_ITEMS.map(item => {
    const existing = existingCounts[item.key];
    const baseline = baselines[item.key];
    const purchase = purchases.byItem[item.key] || emptyMovement();
    const sale = sales.byItem[item.key] || emptyMovement();
    const opening = numberOr(existing?.opening_units, baseline?.closing_units, 0);
    const purchased = settlementType === 'bootstrap' ? 0 : round(purchase.qty);
    const autoSold = settlementType === 'bootstrap' ? 0 : round(sale.qty);
    const sold = settlementType === 'bootstrap' ? 0 : numberOr(existing?.sold_units, autoSold, 0);
    const closing = existing ? Number(existing.closing_units || 0) : null;
    const unitCost = priceFor(item, purchase, existing);
    const expected = round(opening + purchased - sold);
    const discrepancy = closing === null ? null : round(closing - expected);
    return {
      ...publicItem(item),
      opening_units: opening,
      purchased_units: purchased,
      auto_sold_units: autoSold,
      sold_units: sold,
      closing_units: closing,
      expected_closing_units: expected,
      discrepancy_units: discrepancy,
      latest_unit_cost_paise: unitCost,
      discrepancy_value_paise: discrepancy === null ? null : Math.round(discrepancy * unitCost),
      sold_source: sales.source,
      purchase_source: purchase,
      sales_source: sale,
    };
  });

  return json({
    success: true,
    user,
    brand: 'HE',
    business_date: businessDate,
    settlement_type: settlementType,
    business_window_ist: window.ist,
    latest_session: latestSession,
    vendors: VENDORS.map(v => ({ ...v, due_balance_paise: vendorDues[v.key]?.due_balance_paise || 0 })),
    items: rows,
    purchase_status: purchases.status,
    sales_status: sales.status,
    sales_note: sales.note,
  });
}

async function saveSettlement(context, body) {
  const user = requireUser(body.pin);
  const DB = requireDb(context.env);
  const businessDate = requireBusinessDate(body.business_date);
  const settlementType = normalizeSettlementType(body.settlement_type);
  const rows = Array.isArray(body.items) ? body.items : [];
  if (!rows.length) return json({ success: false, error: 'items required' }, 400);

  const rowByKey = {};
  for (const row of rows) rowByKey[row.item_key || row.key] = row;

  const window = businessWindowUtc(businessDate);
  const [purchases, sales, baselines] = await Promise.all([
    fetchPurchases(context.env, window),
    fetchSales(context.env, window),
    getBaselines(DB, businessDate, settlementType),
  ]);

  const sessionId = `he-direct-${businessDate}-${settlementType}-${Date.now()}`;
  const source = {
    purchase_status: purchases.status,
    sales_status: sales.status,
    sales_note: sales.note,
    business_window_ist: window.ist,
  };

  const statements = [
    DB.prepare(
      `INSERT INTO he_direct_settlement_sessions
       (id, brand, business_date, settlement_type, status, actor_pin, actor_name, notes, source_json)
       VALUES (?, 'HE', ?, ?, 'submitted', ?, ?, ?, ?)`
    ).bind(sessionId, businessDate, settlementType, body.pin, user.name, body.notes || '', JSON.stringify(source)),
  ];

  for (const item of DIRECT_ITEMS) {
    const input = rowByKey[item.key] || {};
    const baseline = baselines[item.key];
    const purchase = purchases.byItem[item.key] || emptyMovement();
    const sale = sales.byItem[item.key] || emptyMovement();
    const opening = settlementType === 'bootstrap'
      ? numberOr(input.closing_units, input.opening_units, 0)
      : numberOr(input.opening_units, baseline?.closing_units, 0);
    const purchased = settlementType === 'bootstrap' ? 0 : round(purchase.qty);
    const sold = settlementType === 'bootstrap' ? 0 : numberOr(input.sold_units, sale.qty, 0);
    const closing = numberOr(input.closing_units, input.opening_units, 0);
    const expected = settlementType === 'bootstrap' ? closing : round(opening + purchased - sold);
    const discrepancy = settlementType === 'bootstrap' ? 0 : round(closing - expected);
    const unitCost = priceFor(item, purchase, input);

    statements.push(DB.prepare(
      `INSERT INTO he_direct_settlement_counts
       (session_id, item_key, item_label, vendor_key, vendor_name, opening_units, purchased_units,
        sold_units, closing_units, expected_closing_units, discrepancy_units, latest_unit_cost_paise,
        discrepancy_value_paise, sold_source, purchase_source_json, sales_source_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sessionId,
      item.key,
      item.label,
      item.vendor_key,
      item.vendor_name,
      opening,
      purchased,
      sold,
      closing,
      expected,
      discrepancy,
      unitCost,
      Math.round(discrepancy * unitCost),
      sales.source,
      JSON.stringify(purchase),
      JSON.stringify(sale)
    ));
  }

  for (const due of Array.isArray(body.vendor_dues) ? body.vendor_dues : []) {
    const vendor = VENDORS.find(v => v.key === due.vendor_key);
    if (!vendor) continue;
    statements.push(DB.prepare(
      `INSERT INTO he_direct_vendor_dues (session_id, vendor_key, vendor_name, due_balance_paise, notes)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(sessionId, vendor.key, vendor.name, rupeesToPaise(due.due_balance || due.due_balance_rupees || 0), due.notes || ''));
  }

  await DB.batch(statements);
  return json({ success: true, session_id: sessionId, business_date: businessDate, settlement_type: settlementType });
}

async function getSessions(context, url) {
  requireUser(url.searchParams.get('pin'));
  const DB = requireDb(context.env);
  const rows = await DB.prepare(
    `SELECT id, business_date, settlement_type, actor_name, notes, created_at
     FROM he_direct_settlement_sessions
     WHERE brand = 'HE'
     ORDER BY business_date DESC, created_at DESC
     LIMIT 25`
  ).all();
  return json({ success: true, sessions: rows.results || [] });
}

async function fetchPurchases(env, window) {
  const key = env.ODOO_API_KEY;
  if (!key) return movementUnavailable('ODOO_API_KEY not configured');
  try {
    const uid = parseInt(env.ODOO_UID || '2', 10);
    const pos = await odooCall(FINANCE_ODOO_URL, uid, key, 'purchase.order', 'search_read',
      [[
        ['company_id', '=', HE_COMPANY_ID],
        ['state', 'in', ['purchase', 'done']],
        ['date_order', '>=', window.fromOdoo],
        ['date_order', '<', window.toOdoo],
      ]],
      { fields: ['id', 'name', 'partner_id', 'date_order', 'state', 'amount_total'], order: 'date_order asc', limit: 300 },
    );
    if (!pos.length) return { status: 'ok', byItem: {}, orders: [] };

    const lines = await odooCall(FINANCE_ODOO_URL, uid, key, 'purchase.order.line', 'search_read',
      [[['order_id', 'in', pos.map(p => p.id)]]],
      { fields: ['id', 'order_id', 'product_id', 'name', 'product_qty', 'price_unit', 'price_subtotal', 'product_uom_id'], limit: 2000 },
    );
    const poById = Object.fromEntries(pos.map(po => [po.id, po]));
    const byItem = {};
    for (const line of lines) {
      const sourceName = line.product_id ? line.product_id[1] : line.name;
      const item = matchItem(sourceName, 'purchase_aliases') || matchItem(line.name, 'purchase_aliases');
      if (!item) continue;
      if (!byItem[item.key]) byItem[item.key] = emptyMovement();
      const qty = Number(line.product_qty || 0);
      const amountPaise = Math.round(Number(line.price_subtotal || 0) * 100);
      const po = poById[line.order_id?.[0]];
      byItem[item.key].qty = round(byItem[item.key].qty + qty);
      byItem[item.key].amount_paise += amountPaise;
      byItem[item.key].lines.push({
        po_id: po?.id,
        po_name: po?.name,
        vendor: po?.partner_id?.[1] || '',
        date_order: po?.date_order,
        product_name: sourceName,
        qty,
        uom: line.product_uom_id?.[1] || item.unit,
        price_unit_paise: Math.round(Number(line.price_unit || 0) * 100),
        subtotal_paise: amountPaise,
      });
    }
    for (const m of Object.values(byItem)) {
      m.avg_unit_cost_paise = m.qty ? Math.round(m.amount_paise / m.qty) : 0;
    }
    return { status: 'ok', byItem, orders: pos.map(p => ({ id: p.id, name: p.name, vendor: p.partner_id?.[1] || '', date_order: p.date_order })) };
  } catch (err) {
    return movementUnavailable(err.message || String(err));
  }
}

async function fetchSales(env, window) {
  const key = env.TEST_ODOO_KEY;
  if (!key) return salesUnavailable('TEST_ODOO_KEY not configured');
  try {
    const uid = parseInt(env.TEST_ODOO_UID || '2', 10);
    const orderIds = await odooCall(HE_POS_ODOO_URL, uid, key, 'pos.order', 'search',
      [[
        ['config_id', 'in', HE_POS_CONFIGS],
        ['date_order', '>=', window.fromOdoo],
        ['date_order', '<', window.toOdoo],
        ['state', 'in', ['paid', 'done', 'invoiced', 'posted']],
      ]],
      { context: { allowed_company_ids: [1] } },
    );
    if (!orderIds.length) return { status: 'ok', source: 'pos-auto', byItem: {}, note: 'No matching POS orders found for the HE 3am business day.' };

    const lines = await odooCall(HE_POS_ODOO_URL, uid, key, 'pos.order.line', 'search_read',
      [[['order_id', 'in', orderIds]]],
      { fields: ['product_id', 'qty'], limit: 3000, context: { allowed_company_ids: [1] } },
    );
    const byItem = {};
    for (const line of lines) {
      const item = matchItem(line.product_id?.[1] || '', 'sales_aliases');
      if (!item) continue;
      if (!byItem[item.key]) byItem[item.key] = emptyMovement();
      byItem[item.key].qty = round(byItem[item.key].qty + Number(line.qty || 0));
      byItem[item.key].lines.push({ product_name: line.product_id?.[1] || '', qty: Number(line.qty || 0) });
    }
    return { status: 'ok', source: 'pos-auto', byItem, note: 'Auto POS match is name-based; override sold units if the POS SKU naming differs.' };
  } catch (err) {
    return salesUnavailable(err.message || String(err));
  }
}

async function getLatestSession(DB, businessDate, settlementType) {
  const row = await DB.prepare(
    `SELECT id, business_date, settlement_type, actor_name, notes, created_at
     FROM he_direct_settlement_sessions
     WHERE brand = 'HE' AND business_date = ? AND settlement_type = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(businessDate, settlementType).first();
  return row || null;
}

async function getSessionCounts(DB, sessionId) {
  const rows = await DB.prepare(
    `SELECT * FROM he_direct_settlement_counts WHERE session_id = ?`
  ).bind(sessionId).all();
  return Object.fromEntries((rows.results || []).map(r => [r.item_key, r]));
}

async function getBaselines(DB, businessDate, settlementType) {
  const out = {};
  for (const item of DIRECT_ITEMS) {
    const row = await DB.prepare(
      `SELECT c.*
       FROM he_direct_settlement_counts c
       JOIN he_direct_settlement_sessions s ON s.id = c.session_id
       WHERE s.brand = 'HE'
         AND c.item_key = ?
         AND (
           s.business_date < ?
           OR (? = 'eod' AND s.business_date = ? AND s.settlement_type = 'bootstrap')
         )
       ORDER BY s.business_date DESC, s.created_at DESC
       LIMIT 1`
    ).bind(item.key, businessDate, settlementType, businessDate).first();
    if (row) out[item.key] = row;
  }
  return out;
}

async function getVendorDues(DB) {
  const out = {};
  for (const vendor of VENDORS) {
    const row = await DB.prepare(
      `SELECT vendor_key, due_balance_paise, notes, created_at
       FROM he_direct_vendor_dues
       WHERE vendor_key = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(vendor.key).first();
    if (row) out[vendor.key] = row;
  }
  return out;
}

async function odooCall(endpoint, uid, apiKey, model, method, args, kwargs) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'object', method: 'execute_kw', args: [ODOO_DB, uid, apiKey, model, method, args, kwargs || {}] },
      id: Date.now(),
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
    throw new Error(`Odoo ${model}.${method}: ${msg}`);
  }
  return data.result || [];
}

function requireUser(pin) {
  const user = USERS[pin || ''];
  if (!user) throw httpError('Invalid PIN', 401);
  return user;
}

function requireDb(env) {
  if (!env.DB) throw httpError('D1 DB not configured', 500);
  return env.DB;
}

function requireBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw httpError('business_date must be YYYY-MM-DD', 400);
  return value;
}

function normalizeSettlementType(value) {
  if (value !== 'bootstrap' && value !== 'eod') throw httpError('settlement_type must be bootstrap or eod', 400);
  return value;
}

function businessWindowUtc(dateText) {
  const start = new Date(`${dateText}T03:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 3600000);
  return {
    fromOdoo: toOdooDatetime(start),
    toOdoo: toOdooDatetime(end),
    ist: {
      from: `${dateText} 03:00`,
      to: formatIstDateTime(end),
    },
  };
}

function toOdooDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatIstDateTime(date) {
  const ist = new Date(date.getTime() + 5.5 * 3600000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')} ${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

function publicItems() {
  return DIRECT_ITEMS.map(publicItem);
}

function publicItem(item) {
  return {
    key: item.key,
    label: item.label,
    vendor_key: item.vendor_key,
    vendor_name: item.vendor_name,
    unit: item.unit,
    fallback_unit_cost_paise: item.fallback_unit_cost_paise,
  };
}

function matchItem(name, field) {
  const n = normalizeName(name);
  if (!n) return null;
  return DIRECT_ITEMS.find(item => item[field].some(alias => n.includes(normalizeName(alias))));
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyMovement() {
  return { qty: 0, amount_paise: 0, avg_unit_cost_paise: 0, lines: [] };
}

function movementUnavailable(message) {
  return { status: 'unavailable', byItem: {}, orders: [], error: message };
}

function salesUnavailable(message) {
  return { status: 'unavailable', source: 'manual', byItem: {}, note: `POS auto sales unavailable: ${message}. Enter sold units manually.` };
}

function priceFor(item, purchase, existing) {
  return Math.max(
    0,
    Math.round(Number(purchase.avg_unit_cost_paise || existing?.latest_unit_cost_paise || item.fallback_unit_cost_paise || 0)),
  );
}

function numberOr(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function round(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function rupeesToPaise(value) {
  return Math.round((Number(value) || 0) * 100);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
