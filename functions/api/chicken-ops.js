/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HE Chicken Intelligence — Phase 1 API
 * Route: /api/chicken-ops
 * D1:    DB (hn-hiring) — tables: chicken_daily_ledger, chicken_recipe_grams,
 *                                  vendor_gst_treatment, chicken_event_log
 *
 * Read actions (public, no auth):
 *   GET  ?action=ledger&from=&to=&brand=HE
 *   GET  ?action=heatmap&month=YYYY-MM&brand=HE&metric=variance|discrepancy|cost
 *   GET  ?action=day-detail&date=YYYY-MM-DD&brand=HE
 *   GET  ?action=trust-check&from=&to=&brand=HE
 *   GET  ?action=price-backfill-queue&brand=HE
 *
 * Write actions (PIN-gated):
 *   POST ?action=save-price&pin=     body: {date, cut, price_per_kg, gst_inclusive, bill_url?}
 *   POST ?action=set-gst&pin=        body: {vendor_id, gst_inclusive, gst_rate_pct?}
 *   POST ?action=backfill-ledger&pin=0305  body: {from, to, brand?}
 *
 * Business day: 12 PM IST → 3 AM IST next day (window = D 06:30 UTC → D 21:30 UTC)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ODOO_URL = 'https://odoo.hnhotels.in/jsonrpc';
const ODOO_DB  = 'main';

const MN_BROILERS_VENDOR_ID = 33;
const BRAND_CFG = {
  HE: { company_id: 2, pos_configs: [5, 6, 10] },
  NCH: { company_id: 3, pos_configs: [27, 28] },
};

// 7 canonical cuts (wings merged into lollipop — same physical product at MN Broilers)
const CUTS = ['boneless','shawarma','kebab','tandoori','grill','tangdi','lollipop'];

// Map MN Broilers product names (as stored in Odoo product master) → canonical cut
const PRODUCT_TO_CUT = {
  'Boneless chicken': 'boneless',
  'Chicken lollipop': 'lollipop',
  'Chicken wings': 'lollipop',                          // wings merged with lollipop (same vendor product)
  'Grill chicken': 'grill',
  'Kebab chicken': 'kebab',
  'Shawarama chicken': 'shawarma',                      // typo preserved in Odoo product master
  'Tangdi chicken (Chicken drumstick)': 'tangdi',
  '[HN-RM-073] Chicken Tandoori Cut': 'tandoori',
};

// Cuts that are billed/consumed as units (1-to-1 mappable → discrepancy logic).
// Mixed cuts (tandoori — whole bird OR biryani slices) get BOTH treatments.
const DISCREPANCY_CUTS = new Set(['grill', 'tandoori', 'lollipop', 'tangdi']);

const USERS = {
  '0305': { name: 'Nihaf',   role: 'admin' },
  '5882': { name: 'Nihaf',   role: 'admin' },
  '2026': { name: 'Zoya',    role: 'purchase' },
  '8316': { name: 'Zoya',    role: 'purchase' },
  '3678': { name: 'Faheem',  role: 'settlement' },
  '6045': { name: 'Faheem',  role: 'settlement' },
  '8523': { name: 'Basheer', role: 'manager' },
  '4040': { name: 'Haneef',  role: 'viewer' },
  '5050': { name: 'Nisar',   role: 'viewer' },
  '1111': { name: 'Shared',  role: 'manager' },       // one-off PIN for chicken price collection
};

/* ━━━ Helpers ━━━ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(message, status = 400) {
  return json({ success: false, error: message }, status);
}

function businessDayWindow(dateStr) {
  // For business date D (YYYY-MM-DD) in IST:
  //   start = D 12:00 IST = D 06:30 UTC
  //   end   = D+1 03:00 IST = D 21:30 UTC
  const d = new Date(dateStr + 'T00:00:00Z');
  const startUTC = new Date(d.getTime() + 6.5 * 3600000);
  const endUTC   = new Date(d.getTime() + 21.5 * 3600000);
  return {
    startOdoo: startUTC.toISOString().slice(0, 19).replace('T', ' '),
    endOdoo:   endUTC.toISOString().slice(0, 19).replace('T', ' '),
    startUTC, endUTC,
  };
}

function businessDateFromOdoo(odooDatetime) {
  // Inverse: given an Odoo UTC timestamp, return the business date it belongs to.
  // Business day D spans D 06:30 UTC → D 21:30 UTC. Anything in 21:30 → next day 06:30 falls
  // between business days (closed-store hours) — for safety bucket to D (the day starting).
  const utc = new Date(odooDatetime.replace(' ', 'T') + 'Z');
  const ist = new Date(utc.getTime() + 5.5 * 3600000);
  const h = ist.getUTCHours();
  // If IST hour < 12 (between midnight IST and 12 PM IST), this order belongs to
  // PREVIOUS business day (which started at 12 PM IST on day before and ends at 3 AM IST).
  // Specifically: hours 0–2:59 IST → previous day. Hours 3–11:59 IST → "no business day"
  // (kitchen closed) — bucket to previous day too for safety.
  if (h < 12) {
    const prev = new Date(ist.getTime() - 86400000);
    return prev.toISOString().slice(0, 10);
  }
  return ist.toISOString().slice(0, 10);
}

async function odooCall(uid, apiKey, model, method, args, kwargs) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, uid, apiKey, model, method, args, kwargs || {}],
      },
      id: Date.now(),
    }),
  });
  const d = await r.json();
  if (d.error) {
    throw new Error(`Odoo ${model}.${method}: ${d.error.data?.message || d.error.message || 'unknown'}`);
  }
  return d.result;
}

/* ━━━ Main Handler ━━━ */

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const DB = env.DB;

  try {
    if (request.method === 'GET') {
      if (action === 'ledger')               return await getLedger(url, DB);
      if (action === 'heatmap')              return await getHeatmap(url, DB);
      if (action === 'day-detail')           return await getDayDetail(url, DB);
      if (action === 'trust-check')          return await trustCheck(url, DB, env);
      if (action === 'price-backfill-queue') return await getPriceBackfillQueue(url, DB);
    }

    if (request.method === 'POST') {
      const pin = url.searchParams.get('pin');
      const user = USERS[pin];
      if (!user) return err('Invalid PIN', 401);
      const body = await request.json().catch(() => ({}));

      if (action === 'save-price')      return await savePrice(body, user, pin, DB, env);
      if (action === 'set-gst')         return await setGst(body, user, pin, DB);
      if (action === 'upsert-line')     return await upsertLine(body, user, pin, DB);
      if (action === 'save-day-prices') return await saveDayPrices(body, user, pin, DB);
      if (action === 'backfill-ledger') {
        if (user.role !== 'admin') return err('Backfill requires admin PIN', 403);
        return await backfillLedger(body, user, pin, DB, env);
      }
    }

    return err(`Unknown action: ${action}`);
  } catch (e) {
    console.error('chicken-ops error:', e.stack || e.message);
    return err(e.message || 'Internal error', 500);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * READ ACTIONS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function getLedger(url, DB) {
  const from  = url.searchParams.get('from')  || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to    = url.searchParams.get('to')    || new Date().toISOString().slice(0, 10);
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();

  const res = await DB.prepare(`
    SELECT * FROM chicken_daily_ledger
    WHERE brand = ? AND business_date BETWEEN ? AND ?
    ORDER BY business_date DESC, cut ASC
  `).bind(brand, from, to).all();

  return json({ success: true, rows: res.results || [], from, to, brand });
}

async function getHeatmap(url, DB) {
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();
  const metric = url.searchParams.get('metric') || 'cost';

  const from = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;

  const res = await DB.prepare(`
    SELECT business_date,
           SUM(cost_paise) AS cost_paise,
           AVG(variance_pct) AS avg_variance,
           SUM(COALESCE(discrepancy_units, 0)) AS total_discrepancy,
           SUM(purchased_kg) AS total_kg,
           SUM(recipe_consumed_g) AS total_recipe_g
    FROM chicken_daily_ledger
    WHERE brand = ? AND business_date BETWEEN ? AND ?
    GROUP BY business_date
    ORDER BY business_date
  `).bind(brand, from, to).all();

  return json({ success: true, month, brand, metric, days: res.results || [] });
}

async function getDayDetail(url, DB) {
  const date  = url.searchParams.get('date');
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();
  if (!date) return err('Missing date');

  const ledgerRes = await DB.prepare(`
    SELECT * FROM chicken_daily_ledger WHERE brand = ? AND business_date = ? ORDER BY cut
  `).bind(brand, date).all();

  return json({ success: true, date, brand, rows: ledgerRes.results || [] });
}

async function getPriceBackfillQueue(url, DB) {
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();
  // Rows where we have purchased_kg but no price_per_kg_paise yet
  const res = await DB.prepare(`
    SELECT business_date, cut, purchased_kg, delivered_kg, purchased_units, po_odoo_id,
           price_per_kg_paise, daily_rate_paise, cost_paise, bill_attachment_url
    FROM chicken_daily_ledger
    WHERE brand = ? AND purchased_kg IS NOT NULL AND purchased_kg > 0
    ORDER BY business_date DESC, cut ASC
  `).bind(brand).all();

  const rows = res.results || [];
  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.business_date]) byDate[r.business_date] = { date: r.business_date, lines: [], complete: true, daily_rate_paise: null };
    byDate[r.business_date].lines.push(r);
    // Track daily rate (any row with it has it for the whole day)
    if (r.daily_rate_paise && !byDate[r.business_date].daily_rate_paise) {
      byDate[r.business_date].daily_rate_paise = r.daily_rate_paise;
    }
    if (!r.daily_rate_paise || !r.delivered_kg) byDate[r.business_date].complete = false;
  }

  // GST treatment for MN Broilers
  const gstRes = await DB.prepare(`SELECT * FROM vendor_gst_treatment WHERE vendor_id = ?`)
    .bind(MN_BROILERS_VENDOR_ID).first();

  return json({
    success: true,
    brand,
    days: Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)),
    gst: gstRes,
  });
}

async function trustCheck(url, DB, env) {
  // Cross-source reconciliation:
  // 1. Count ledger rows per date
  // 2. Count Odoo PO lines per date (via existing /api/spend?action=purchase-ledger)
  // 3. Flag dates where they don't match
  const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = url.searchParams.get('to')   || new Date().toISOString().slice(0, 10);
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();

  const ledgerRes = await DB.prepare(`
    SELECT business_date, COUNT(*) AS cuts, SUM(purchased_kg) AS total_kg
    FROM chicken_daily_ledger
    WHERE brand = ? AND business_date BETWEEN ? AND ?
    GROUP BY business_date
  `).bind(brand, from, to).all();

  const ledgerByDate = {};
  for (const r of ledgerRes.results || []) ledgerByDate[r.business_date] = r;

  // Compare against Odoo via existing endpoint (avoid re-implementing Odoo auth)
  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) return json({ success: true, from, to, gaps: [], note: 'ODOO_API_KEY missing — skipped Odoo cross-check' });

  const cfg = BRAND_CFG[brand];
  const poFilter = [
    ['date_order', '>=', from + ' 00:00:00'],
    ['date_order', '<=', to + ' 23:59:59'],
    ['partner_id', '=', MN_BROILERS_VENDOR_ID],
    ['company_id', '=', cfg.company_id],
  ];
  const pos = await odooCall(2, apiKey, 'purchase.order', 'search_read',
    [poFilter], { fields: ['id', 'date_order', 'order_line', 'state'] });

  const odooByDate = {};
  for (const p of pos) {
    const d = p.date_order.slice(0, 10);
    if (!odooByDate[d]) odooByDate[d] = { po_count: 0, line_count: 0 };
    odooByDate[d].po_count += 1;
    odooByDate[d].line_count += (p.order_line || []).length;
  }

  const allDates = new Set([...Object.keys(ledgerByDate), ...Object.keys(odooByDate)]);
  const gaps = [];
  for (const d of allDates) {
    const L = ledgerByDate[d];
    const O = odooByDate[d];
    if (!L && O) gaps.push({ date: d, type: 'odoo_no_ledger', odoo_lines: O.line_count });
    else if (L && !O) gaps.push({ date: d, type: 'ledger_no_odoo', ledger_cuts: L.cuts });
    else if (L && O && L.cuts !== O.line_count) {
      gaps.push({ date: d, type: 'count_mismatch', ledger_cuts: L.cuts, odoo_lines: O.line_count });
    }
  }
  gaps.sort((a, b) => a.date.localeCompare(b.date));

  return json({
    success: true, from, to, brand,
    ledger_days: Object.keys(ledgerByDate).length,
    odoo_days: Object.keys(odooByDate).length,
    gaps,
    status: gaps.length === 0 ? 'green' : (gaps.length < 3 ? 'yellow' : 'red'),
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WRITE ACTIONS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// Upsert a (date, cut) line — edits existing qty/price OR creates a new row if missing.
// Body: { date, cut, purchased_kg?, price_per_kg?, gst_inclusive? }
// Used by the price-entry UI to (a) edit a wrong qty from Odoo or (b) add a cut that wasn't ordered through Odoo.
async function upsertLine(body, user, pin, DB) {
  const { date, cut } = body;
  if (!date || !cut) return err('Missing date or cut');
  if (!CUTS.includes(cut)) return err(`Invalid cut: ${cut}. Must be one of ${CUTS.join(', ')}`);

  const existing = await DB.prepare(
    `SELECT id, purchased_kg, price_per_kg_paise, recipe_consumed_g FROM chicken_daily_ledger
     WHERE brand='HE' AND business_date=? AND cut=?`
  ).bind(date, cut).first();

  let purchasedKg = existing?.purchased_kg ?? null;
  if (body.purchased_kg !== undefined && body.purchased_kg !== null && body.purchased_kg !== '') {
    purchasedKg = Number(body.purchased_kg);
  }

  let pricePaise = existing?.price_per_kg_paise ?? null;
  if (body.price_per_kg !== undefined && body.price_per_kg !== null && body.price_per_kg !== '') {
    pricePaise = Math.round(Number(body.price_per_kg) * 100);
  }

  const costPaise = (purchasedKg && pricePaise) ? Math.round(purchasedKg * pricePaise) : null;

  // Recompute variance using existing recipe_consumed_g
  let variancePct = null;
  const recipeG = existing?.recipe_consumed_g || 0;
  if (purchasedKg && recipeG > 0) {
    variancePct = Math.round(((purchasedKg * 1000 - recipeG) / recipeG) * 100 * 100) / 100;
  }

  if (existing) {
    await DB.prepare(`
      UPDATE chicken_daily_ledger
      SET purchased_kg = ?, price_per_kg_paise = ?, cost_paise = ?, variance_pct = ?,
          price_entered_by_pin = COALESCE(?, price_entered_by_pin),
          price_entered_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE price_entered_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(purchasedKg, pricePaise, costPaise, variancePct,
            body.price_per_kg ? pin : null, body.price_per_kg ? '1' : null, existing.id).run();
  } else {
    await DB.prepare(`
      INSERT INTO chicken_daily_ledger
        (business_date, brand, cut, purchased_kg, price_per_kg_paise, cost_paise, variance_pct,
         price_entered_by_pin, price_entered_at, updated_at)
      VALUES (?, 'HE', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(date, cut, purchasedKg, pricePaise, costPaise, variancePct, pin).run();
  }

  await logEvent(DB, 'upsert_line', pin, { date, cut, purchased_kg: purchasedKg, price_per_kg: pricePaise ? pricePaise/100 : null, was_new: !existing });
  return json({ success: true, was_new: !existing, purchased_kg: purchasedKg, price_per_kg_paise: pricePaise, cost_paise: costPaise });
}

// One-shot save for a full day's price entry.
// Body: { date, daily_rate, cuts: [{cut, yielded_kg?, delivered_kg}] }
// Backend computes:
//   cost_paise = round(delivered_kg × daily_rate × 100)
//   price_per_kg_paise (effective ₹/kg of yielded meat) = round(cost_paise / yielded_kg)
//   variance_pct = (yielded_kg × 1000 − recipe_consumed_g) / recipe_consumed_g × 100
async function saveDayPrices(body, user, pin, DB) {
  const { date, daily_rate, cuts } = body;
  if (!date || !daily_rate || !Array.isArray(cuts)) return err('Need date, daily_rate, cuts[]');
  const dailyRatePaise = Math.round(Number(daily_rate) * 100);
  if (!(dailyRatePaise > 0)) return err('Invalid daily_rate');

  const results = [];
  for (const c of cuts) {
    if (!c.cut || !CUTS.includes(c.cut)) { results.push({cut: c.cut, ok: false, error: 'invalid cut'}); continue; }
    if (!c.delivered_kg || Number(c.delivered_kg) <= 0) { results.push({cut: c.cut, ok: false, error: 'delivered_kg required'}); continue; }
    const deliveredKg = Number(c.delivered_kg);

    // Load existing row (yielded kg may already be set from Odoo)
    const existing = await DB.prepare(
      `SELECT id, purchased_kg, recipe_consumed_g FROM chicken_daily_ledger
       WHERE brand='HE' AND business_date=? AND cut=?`
    ).bind(date, c.cut).first();

    let yieldedKg = existing?.purchased_kg ?? null;
    if (c.yielded_kg !== undefined && c.yielded_kg !== null && c.yielded_kg !== '') {
      yieldedKg = Number(c.yielded_kg);
    }
    if (!yieldedKg || yieldedKg <= 0) {
      results.push({cut: c.cut, ok: false, error: 'yielded_kg unknown — provide it for this new cut'});
      continue;
    }

    const costPaise = Math.round(deliveredKg * dailyRatePaise);
    const effectivePricePaise = Math.round(costPaise / yieldedKg);

    const recipeG = existing?.recipe_consumed_g || 0;
    let variancePct = null;
    if (recipeG > 0) {
      variancePct = Math.round(((yieldedKg * 1000 - recipeG) / recipeG) * 100 * 100) / 100;
    }

    if (existing) {
      await DB.prepare(`
        UPDATE chicken_daily_ledger
        SET purchased_kg = ?, delivered_kg = ?, daily_rate_paise = ?,
            price_per_kg_paise = ?, cost_paise = ?, variance_pct = ?,
            price_entered_by_pin = ?, price_entered_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(yieldedKg, deliveredKg, dailyRatePaise, effectivePricePaise, costPaise, variancePct, pin, existing.id).run();
    } else {
      await DB.prepare(`
        INSERT INTO chicken_daily_ledger
          (business_date, brand, cut, purchased_kg, delivered_kg, daily_rate_paise,
           price_per_kg_paise, cost_paise, variance_pct, price_entered_by_pin, price_entered_at, updated_at)
        VALUES (?, 'HE', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(date, c.cut, yieldedKg, deliveredKg, dailyRatePaise, effectivePricePaise, costPaise, variancePct, pin).run();
    }

    results.push({cut: c.cut, ok: true, yielded_kg: yieldedKg, delivered_kg: deliveredKg, cost_paise: costPaise, effective_paise_per_kg: effectivePricePaise});
  }

  await logEvent(DB, 'save_day_prices', pin, { date, daily_rate, cuts_count: cuts.length, ok_count: results.filter(r=>r.ok).length });
  return json({ success: true, date, daily_rate, results });
}

async function setGst(body, user, pin, DB) {
  const vendorId = body.vendor_id || MN_BROILERS_VENDOR_ID;
  const vendorName = body.vendor_name || 'M.N. Broilers (Syed Ahmedulla)';
  const gstInclusive = body.gst_inclusive ? 1 : 0;
  const gstRate = body.gst_rate_pct ?? 0;

  await DB.prepare(`
    INSERT INTO vendor_gst_treatment (vendor_id, vendor_name, gst_inclusive, gst_rate_pct, confirmed_by_pin, confirmed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(vendor_id) DO UPDATE SET
      gst_inclusive = excluded.gst_inclusive,
      gst_rate_pct = excluded.gst_rate_pct,
      confirmed_by_pin = excluded.confirmed_by_pin,
      confirmed_at = datetime('now')
  `).bind(vendorId, vendorName, gstInclusive, gstRate, pin).run();

  await logEvent(DB, 'set_gst', pin, { vendor_id: vendorId, gst_inclusive: gstInclusive });
  return json({ success: true });
}

async function savePrice(body, user, pin, DB, env) {
  const { date, cut, price_per_kg } = body;
  if (!date || !cut || price_per_kg == null) return err('Missing date/cut/price_per_kg');
  const pricePaise = Math.round(Number(price_per_kg) * 100);

  // Find the ledger row
  const row = await DB.prepare(`
    SELECT id, purchased_kg, po_odoo_id FROM chicken_daily_ledger
    WHERE brand = 'HE' AND business_date = ? AND cut = ?
  `).bind(date, cut).first();

  if (!row) return err(`No ledger row for ${date}/${cut} — run backfill first`);

  const costPaise = row.purchased_kg ? Math.round(row.purchased_kg * pricePaise) : null;

  await DB.prepare(`
    UPDATE chicken_daily_ledger
    SET price_per_kg_paise = ?, price_entered_by_pin = ?, price_entered_at = datetime('now'),
        cost_paise = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(pricePaise, pin, costPaise, row.id).run();

  // Also write back to Odoo PO line if po_odoo_id known (best-effort, not blocking)
  let odooSync = null;
  if (row.po_odoo_id && env.ODOO_API_KEY) {
    try {
      // Find the PO line for this cut
      const lines = await odooCall(2, env.ODOO_API_KEY, 'purchase.order.line', 'search_read',
        [[['order_id', '=', row.po_odoo_id]]], { fields: ['id', 'product_id'] });
      const matchLine = lines.find(l => productNameToCut(l.product_id[1]) === cut);
      if (matchLine) {
        await odooCall(2, env.ODOO_API_KEY, 'purchase.order.line', 'write',
          [[matchLine.id], { price_unit: Number(price_per_kg) }],
          { context: { allowed_company_ids: [2] } });
        odooSync = { line_id: matchLine.id, ok: true };
      }
    } catch (e) {
      odooSync = { ok: false, error: e.message };
    }
  }

  await logEvent(DB, 'price_entry', pin, { date, cut, price_per_kg, cost_paise: costPaise, odoo_sync: odooSync });
  return json({ success: true, cost_paise: costPaise, odoo_sync: odooSync });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * BACKFILL — the heart of Phase 1
 *
 * For each business day in [from, to]:
 *   1. Read MN Broilers POs (HE company, partner=33), extract (cut, kg, price, po_id)
 *   2. Read HE POS sales (pos.order.line via Odoo, business-day window, HE configs)
 *   3. Read aggregator orders (internal fetch /api/aggregator-pulse)
 *   4. Map every sale to (cut, grams) via chicken_recipe_grams
 *   5. Upsert one row per (date, cut)
 *
 * Idempotent — re-running overwrites, doesn't duplicate.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function backfillLedger(body, user, pin, DB, env) {
  const from = body.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = body.to   || new Date().toISOString().slice(0, 10);
  const brand = (body.brand || 'HE').toUpperCase();
  const cfg = BRAND_CFG[brand];
  if (!cfg) return err(`Unknown brand: ${brand}`);

  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) return err('ODOO_API_KEY not configured', 500);

  // Load recipe grams map (dish_name + channel → {cut, grams})
  const recipeRes = await DB.prepare(`SELECT dish_name, channel, cut, grams_per_unit FROM chicken_recipe_grams WHERE active = 1`).all();
  const recipe = {};
  for (const r of recipeRes.results || []) {
    recipe[`${r.channel}::${r.dish_name}`] = { cut: r.cut, g: r.grams_per_unit };
  }

  // ── 1. Read MN Broilers POs once, group by business date + cut ──
  const pos = await odooCall(2, apiKey, 'purchase.order', 'search_read', [[
    ['date_order', '>=', from + ' 00:00:00'],
    ['date_order', '<=', to + ' 23:59:59'],
    ['partner_id', '=', MN_BROILERS_VENDOR_ID],
    ['company_id', '=', cfg.company_id],
  ]], { fields: ['id', 'name', 'date_order', 'order_line', 'amount_total'] });

  const allLineIds = pos.flatMap(p => p.order_line || []);
  const poLines = allLineIds.length ? await odooCall(2, apiKey, 'purchase.order.line', 'search_read',
    [[['id', 'in', allLineIds]]],
    { fields: ['id', 'order_id', 'product_id', 'product_qty', 'price_unit'] }) : [];

  const purchasesByDateCut = {};
  for (const p of pos) {
    const businessDate = p.date_order.slice(0, 10);
    for (const lineId of (p.order_line || [])) {
      const ln = poLines.find(l => l.id === lineId);
      if (!ln) continue;
      const cut = productNameToCut(ln.product_id[1]);
      if (!cut) continue;
      const key = `${businessDate}::${cut}`;
      if (!purchasesByDateCut[key]) purchasesByDateCut[key] = { kg: 0, price_total: 0, po_id: p.id, has_price: false };
      purchasesByDateCut[key].kg += ln.product_qty;
      if (ln.price_unit > 0) {
        purchasesByDateCut[key].price_total += ln.price_unit * ln.product_qty;
        purchasesByDateCut[key].has_price = true;
      }
    }
  }

  // ── 2. Read POS sales day by day (business-day window) ──
  const dates = listDates(from, to);
  const salesByDateCut = {};   // {date::cut: {recipe_g, unit_count, dishes: {dish: qty}}}

  for (const date of dates) {
    const w = businessDayWindow(date);
    let posOrders = [];
    try {
      posOrders = await odooCall(2, apiKey, 'pos.order', 'search', [[
        ['config_id', 'in', cfg.pos_configs],
        ['date_order', '>=', w.startOdoo],
        ['date_order', '<=', w.endOdoo],
        ['state', 'in', ['paid', 'done', 'invoiced', 'posted']],
      ]]);
    } catch (e) { console.warn(`POS fetch failed for ${date}: ${e.message}`); continue; }

    if (!posOrders.length) continue;
    const lines = await odooCall(2, apiKey, 'pos.order.line', 'search_read',
      [[['order_id', 'in', posOrders]]], { fields: ['product_id', 'qty'] });

    for (const ln of lines) {
      const dishName = stripPrefix(ln.product_id[1]);
      const r = recipe[`POS::${dishName}`];
      if (!r) continue;
      const key = `${date}::${r.cut}`;
      if (!salesByDateCut[key]) salesByDateCut[key] = { recipe_g: 0, unit_count: 0, dishes: {} };
      salesByDateCut[key].recipe_g += r.g * ln.qty;
      salesByDateCut[key].unit_count += ln.qty;
      salesByDateCut[key].dishes[dishName] = (salesByDateCut[key].dishes[dishName] || 0) + ln.qty;
    }
  }

  // ── 3. Read aggregator orders (Swiggy + Zomato) ──
  // Use the existing /api/aggregator-pulse?action=orders endpoint
  let aggUrl = new URL('https://hnhotels.in/api/aggregator-pulse');
  aggUrl.searchParams.set('action', 'orders');
  aggUrl.searchParams.set('brand', brand.toLowerCase());
  aggUrl.searchParams.set('date', 'all');

  try {
    const aggRes = await fetch(aggUrl.toString()).then(r => r.json());
    const orders = aggRes?.orders || aggRes?.data?.orders || [];
    for (const o of orders) {
      const orderDate = (o.placed_at || o.order_time || o.date || '').slice(0, 10);
      if (!orderDate || orderDate < from || orderDate > to) continue;
      const channel = (o.platform || o.source || '').toLowerCase().includes('zomato') ? 'Zomato' : 'Swiggy';
      // items may be a string ("1 x Foo, 2 x Bar") or array
      const items = parseAggregatorItems(o);
      for (const it of items) {
        const r = recipe[`${channel}::${it.name}`];
        if (!r) continue;
        const key = `${orderDate}::${r.cut}`;
        if (!salesByDateCut[key]) salesByDateCut[key] = { recipe_g: 0, unit_count: 0, dishes: {} };
        salesByDateCut[key].recipe_g += r.g * it.qty;
        salesByDateCut[key].unit_count += it.qty;
        const dishKey = `${it.name} [${channel[0]}]`;
        salesByDateCut[key].dishes[dishKey] = (salesByDateCut[key].dishes[dishKey] || 0) + it.qty;
      }
    }
  } catch (e) { console.warn(`Aggregator fetch failed: ${e.message}`); }

  // ── 4. Upsert ledger rows ──
  let upserted = 0;
  const errors = [];
  const allKeys = new Set([...Object.keys(purchasesByDateCut), ...Object.keys(salesByDateCut)]);

  for (const key of allKeys) {
    const [date, cut] = key.split('::');
    const p = purchasesByDateCut[key];
    const s = salesByDateCut[key];

    const purchasedKg = p?.kg || null;
    const poId = p?.po_id || null;
    const pricePaise = p?.has_price ? Math.round((p.price_total / p.kg) * 100) : null;
    const costPaise = (purchasedKg && pricePaise) ? Math.round(purchasedKg * pricePaise) : null;

    const recipeG = s?.recipe_g ? Math.round(s.recipe_g) : 0;
    const unitCount = s?.unit_count ? Math.round(s.unit_count) : 0;
    const dishesJson = s?.dishes ? JSON.stringify(s.dishes) : null;

    // Variance = (purchased_g − recipe_g) / recipe_g × 100  (when both > 0)
    let variancePct = null;
    if (purchasedKg && recipeG > 0) {
      variancePct = Math.round(((purchasedKg * 1000 - recipeG) / recipeG) * 100 * 100) / 100;
    }

    try {
      await DB.prepare(`
        INSERT INTO chicken_daily_ledger
          (business_date, brand, cut, purchased_kg, po_odoo_id,
           price_per_kg_paise, recipe_consumed_g, unit_sales_count, dishes_sold_json,
           variance_pct, cost_paise, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(business_date, brand, cut) DO UPDATE SET
          purchased_kg = excluded.purchased_kg,
          po_odoo_id = excluded.po_odoo_id,
          price_per_kg_paise = COALESCE(chicken_daily_ledger.price_per_kg_paise, excluded.price_per_kg_paise),
          recipe_consumed_g = excluded.recipe_consumed_g,
          unit_sales_count = excluded.unit_sales_count,
          dishes_sold_json = excluded.dishes_sold_json,
          variance_pct = excluded.variance_pct,
          cost_paise = COALESCE(excluded.cost_paise, chicken_daily_ledger.cost_paise),
          updated_at = datetime('now')
      `).bind(date, brand, cut, purchasedKg, poId, pricePaise, recipeG, unitCount, dishesJson, variancePct, costPaise).run();
      upserted += 1;
    } catch (e) {
      errors.push({ date, cut, error: e.message });
    }
  }

  await logEvent(DB, 'backfill', pin, { from, to, brand, upserted, errors_count: errors.length });

  return json({
    success: true,
    brand, from, to,
    pos_count: pos.length,
    days_processed: dates.length,
    upserted,
    errors_sample: errors.slice(0, 5),
    purchase_keys: Object.keys(purchasesByDateCut).length,
    sales_keys: Object.keys(salesByDateCut).length,
  });
}

/* ━━━ Helpers ━━━ */

function productNameToCut(productName) {
  if (!productName) return null;
  return PRODUCT_TO_CUT[productName] || null;
}

function stripPrefix(name) {
  // Strip Odoo internal-code prefix "[XXX] " from product names
  return name.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function listDates(from, to) {
  const out = [];
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseAggregatorItems(order) {
  // aggregator-pulse stores items either as JSON array or as comma-separated string
  // like "1 x Biryani rice with chicken kabab, 2 x Butter Chicken"
  const items = order.items || order.item_list || order.line_items;
  if (Array.isArray(items)) {
    return items.map(it => ({
      name: it.name || it.item_name || it.product || '',
      qty: Number(it.qty || it.quantity || 1),
    }));
  }
  if (typeof items === 'string') {
    return items.split(/,(?=\s*\d+\s*x\s)/).map(part => {
      const m = part.trim().match(/^(\d+)\s*x\s*(.+)$/i);
      return m ? { qty: Number(m[1]), name: m[2].trim() } : null;
    }).filter(Boolean);
  }
  return [];
}

async function logEvent(DB, type, pin, payload) {
  try {
    await DB.prepare(`INSERT INTO chicken_event_log (event_type, actor_pin, payload_json) VALUES (?, ?, ?)`)
      .bind(type, pin, JSON.stringify(payload)).run();
  } catch (e) { console.error('event log fail:', e.message); }
}
