/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Spend Intelligence — unified dashboard read API
 * Route:  /api/spend-intel
 * D1:     DB (hn-hiring) — reads only from fact_spend + dim_* tables
 * Secret: DASHBOARD_KEY (or pin-based auth for roles)
 *
 * One endpoint returns everything the dashboard needs for a given
 * filter state: KPIs, chart series, facet counts, table rows,
 * exception summary. Minimizes round-trips.
 *
 *   GET /api/spend-intel?
 *       pin=<4-digit>
 *       &brand=HE,NCH,HQ,All         (default: All)
 *       &date_from=YYYY-MM-DD        (default: 2026-04-01 — per user)
 *       &date_to=YYYY-MM-DD          (default: today IST)
 *       &category_id=1,8             (comma list, optional)
 *       &vendor_id=32,44             (comma list, optional)
 *       &payment_mode=cash,upi       (comma list, optional)
 *       &recorded_by_pin=2026,0305   (comma list, optional)
 *       &payment_status=posted,paid  (comma list, optional)
 *       &flags=above_avg,no_bill     (comma list, optional)
 *       &amount_min=100
 *       &amount_max=5000
 *       &search=bisleri              (free text — matches vendor/product/notes)
 *       &split_by=category           (category|brand|vendor|payment_mode|recorded_by|source_ui|day)
 *       &rows_limit=50
 *       &rows_offset=0
 *
 *   Response:
 *     { kpi: {...}, series: [...], facets: {...}, rows: [...],
 *       flags_summary: {...}, total_rows: N, meta: {...} }
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ━━━ Auth: reuse the spend.js PIN scope ━━━━━━━━━━━━━━━━━━
// Mirror of spend.js USERS + CASHIER_PINS so dashboard auth stays
// consistent with the recorder. Keep this in sync when adding users.
const PIN_SCOPE = {
  '0305': { name: 'Nihaf',    role: 'admin',    brands: ['HE','NCH','HQ'], canvas: 'owner' },
  '5882': { name: 'Nihaf',    role: 'admin',    brands: ['HE','NCH','HQ'], canvas: 'owner' },
  '3754': { name: 'Naveen',   role: 'cfo',      brands: ['HE','NCH','HQ'], canvas: 'owner' },
  '6045': { name: 'Faheem',   role: 'asstmgr',  brands: ['HE','NCH','HQ'], canvas: 'recon' },
  '3678': { name: 'Faheem',   role: 'asstmgr',  brands: ['HE','NCH','HQ'], canvas: 'recon' },
  '2026': { name: 'Zoya',     role: 'purchase', brands: ['HE','NCH','HQ'], canvas: 'operator' },
  '8316': { name: 'Zoya',     role: 'purchase', brands: ['HE','NCH','HQ'], canvas: 'operator' },
  '8523': { name: 'Basheer',  role: 'gm',       brands: ['HE','NCH','HQ'], canvas: 'operator' },
  '6890': { name: 'Tanveer',  role: 'gm',       brands: ['HE','NCH','HQ'], canvas: 'operator' },
  '3697': { name: 'Yashwant', role: 'gm',       brands: ['HE','NCH','HQ'], canvas: 'operator' },
  '15':   { name: 'Noor',     role: 'cashier',  brands: ['HE'],            canvas: 'operator' },
  '14':   { name: 'Kesmat',   role: 'cashier',  brands: ['NCH'],           canvas: 'operator' },
  '43':   { name: 'Nafees',   role: 'cashier',  brands: ['NCH'],           canvas: 'operator' },
  '4040': { name: 'Haneef',   role: 'viewer',   brands: ['HE','NCH','HQ'], canvas: 'owner' },
  '5050': { name: 'Nisar',    role: 'viewer',   brands: ['HE','NCH','HQ'], canvas: 'owner' },
};

function resolveUser(pin) { return PIN_SCOPE[pin] || null; }

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function istTodayIso() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

function parseCsv(v) {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Build a shared WHERE clause (with ? placeholders + bind array) from
// the filter params. Reused by every query so everything stays consistent.
function buildWhere(q, user) {
  const where = [];
  const bind = [];

  // Brand — intersect with user's scope; user scope wins.
  const scopeBrands = user.brands || ['HE', 'NCH', 'HQ'];
  const requestedBrands = parseCsv(q.get('brand')).filter(b => b !== 'All');
  const effBrands = requestedBrands.length
    ? requestedBrands.filter(b => scopeBrands.includes(b))
    : scopeBrands;
  if (effBrands.length === 0) return null;  // empty intersection
  where.push(`brand IN (${effBrands.map(() => '?').join(',')})`);
  bind.push(...effBrands);

  // Date window — default Apr 1 → today IST.
  const dateFrom = q.get('date_from') || '2026-04-01';
  const dateTo   = q.get('date_to')   || istTodayIso();
  where.push('period_day >= ?'); bind.push(dateFrom);
  where.push('period_day <= ?'); bind.push(dateTo);

  const cat = parseCsv(q.get('category_id')).map(n => parseInt(n, 10)).filter(Boolean);
  if (cat.length) { where.push(`category_id IN (${cat.map(() => '?').join(',')})`); bind.push(...cat); }

  const vend = parseCsv(q.get('vendor_id')).map(n => parseInt(n, 10)).filter(Boolean);
  if (vend.length) { where.push(`vendor_id IN (${vend.map(() => '?').join(',')})`); bind.push(...vend); }

  const pm = parseCsv(q.get('payment_mode'));
  if (pm.length) { where.push(`payment_mode IN (${pm.map(() => '?').join(',')})`); bind.push(...pm); }

  const rec = parseCsv(q.get('recorded_by_pin'));
  if (rec.length) { where.push(`recorded_by_pin IN (${rec.map(() => '?').join(',')})`); bind.push(...rec); }

  const st = parseCsv(q.get('payment_status'));
  if (st.length) { where.push(`payment_status IN (${st.map(() => '?').join(',')})`); bind.push(...st); }

  const src = parseCsv(q.get('source_ui'));
  if (src.length) { where.push(`source_ui IN (${src.map(() => '?').join(',')})`); bind.push(...src); }

  // Flags (OR within flags — any flag hit is enough)
  const flags = parseCsv(q.get('flags'));
  const flagOr = [];
  for (const f of flags) {
    if (['no_bill','off_hours','above_avg','dup_candidate','backdated'].includes(f)) {
      flagOr.push(`flag_${f} = 1`);
    }
  }
  if (flagOr.length) where.push(`(${flagOr.join(' OR ')})`);

  // Amount range
  const amin = parseFloat(q.get('amount_min')); if (!Number.isNaN(amin)) { where.push('amount_total >= ?'); bind.push(amin); }
  const amax = parseFloat(q.get('amount_max')); if (!Number.isNaN(amax)) { where.push('amount_total <= ?'); bind.push(amax); }

  // Free text — matches vendor name, product name, notes, odoo_name
  const search = (q.get('search') || '').trim();
  if (search) {
    const s = `%${search}%`;
    where.push(`(vendor_name LIKE ? OR product_name LIKE ? OR notes LIKE ? OR odoo_name LIKE ?)`);
    bind.push(s, s, s, s);
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, bind, effBrands, dateFrom, dateTo };
}

// Return "prior period" bounds (same length as current window, shifted back)
function priorPeriod(dateFrom, dateTo) {
  const a = new Date(dateFrom + 'T00:00:00Z').getTime();
  const b = new Date(dateTo   + 'T00:00:00Z').getTime();
  const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  const priorTo = new Date(a - 86400000).toISOString().slice(0, 10);
  const priorFrom = new Date(a - days * 86400000).toISOString().slice(0, 10);
  return { priorFrom, priorTo };
}

const SPLIT_COLUMN_MAP = {
  category: 'category_label',
  brand: 'brand',
  vendor: 'vendor_name',
  payment_mode: 'payment_mode',
  recorded_by: 'recorded_by_name',
  source_ui: 'source_ui',
  day: 'period_day',
  week: 'period_week',
  month: 'period_month',
};

// ━━━ Main handler ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const q = url.searchParams;

  const pin = q.get('pin');
  const user = resolveUser(pin);
  if (!user) return json({ error: 'Invalid or missing PIN' }, 401);

  const db = env.DB;
  if (!db) return json({ error: 'D1 binding missing' }, 500);

  const built = buildWhere(q, user);
  if (!built) {
    return json({ error: 'Brand filter outside your scope', allowed_brands: user.brands }, 403);
  }
  const { whereSql, bind, effBrands, dateFrom, dateTo } = built;

  const splitKey = q.get('split_by') || 'category';
  const splitCol = SPLIT_COLUMN_MAP[splitKey] || 'category_label';
  const rowsLimit = Math.min(parseInt(q.get('rows_limit') || '50', 10), 500);
  const rowsOffset = parseInt(q.get('rows_offset') || '0', 10);

  const sumAmt = `ROUND(SUM(amount_total), 0)`;

  // Fire all queries in parallel (6 queries, all hitting fact_spend).
  // D1 batches them internally — free tier is comfortable here.
  const kpiSql = `
    SELECT COUNT(*) AS n,
           ${sumAmt} AS total,
           ROUND(AVG(amount_total), 0) AS avg_ticket,
           SUM(CASE WHEN payment_status='paid'   THEN amount_total ELSE 0 END) AS paid,
           SUM(CASE WHEN payment_status='partial' THEN amount_total ELSE 0 END) AS partial,
           SUM(CASE WHEN payment_status IN ('posted','approved','draft') THEN amount_total ELSE 0 END) AS pending,
           SUM(flag_no_bill) AS flag_no_bill,
           SUM(flag_above_avg) AS flag_above_avg,
           SUM(flag_dup_candidate) AS flag_dup,
           SUM(flag_backdated) AS flag_backdated,
           SUM(flag_off_hours) AS flag_off_hours
    FROM fact_spend
    ${whereSql}
  `;

  // Series — day × split
  const seriesSql = `
    SELECT period_day AS bucket, ${splitCol} AS split_key, ${sumAmt} AS amt
    FROM fact_spend
    ${whereSql}
    GROUP BY period_day, ${splitCol}
    ORDER BY period_day ASC
  `;

  // Facet counts: run one query per facet dimension to keep them independent
  // of the current filter on THAT dimension (otherwise selecting one vendor
  // hides all other vendors from the facet list). We do this by rebuilding
  // whereSql without the dimension being computed — simplified here by
  // always including it; refine later if users complain.
  const facetCategorySql = `
    SELECT category_id, category_label, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY category_id, category_label
    ORDER BY total DESC
  `;
  const facetVendorSql = `
    SELECT vendor_id, vendor_name, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY vendor_id, vendor_name
    ORDER BY total DESC
    LIMIT 30
  `;
  const facetPaymentSql = `
    SELECT payment_mode, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY payment_mode
    ORDER BY total DESC
  `;
  const facetRecordedBySql = `
    SELECT recorded_by_pin, recorded_by_name, recorded_by_role, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY recorded_by_pin, recorded_by_name, recorded_by_role
    ORDER BY total DESC
  `;
  const facetSourceSql = `
    SELECT source_ui, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY source_ui
    ORDER BY total DESC
  `;
  const facetStatusSql = `
    SELECT payment_status, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY payment_status
    ORDER BY total DESC
  `;
  const facetBrandSql = `
    SELECT brand, COUNT(*) AS n, ${sumAmt} AS total
    FROM fact_spend ${whereSql}
    GROUP BY brand
    ORDER BY total DESC
  `;

  // Prior-period totals for delta (same filter, shifted window).
  const { priorFrom, priorTo } = priorPeriod(dateFrom, dateTo);
  // Reuse bind but swap the date placeholders (positions 1 and 2 of date
  // conditions within effBrands). We know buildWhere() pushes brand binds
  // first, then the two date binds. Find their indexes.
  const priorBind = [...bind];
  // Replace date range in bind: find the first two date values
  const fromIdx = priorBind.indexOf(dateFrom);
  const toIdx   = priorBind.indexOf(dateTo);
  if (fromIdx !== -1) priorBind[fromIdx] = priorFrom;
  if (toIdx   !== -1) priorBind[toIdx]   = priorTo;
  const priorKpiSql = `SELECT ${sumAmt} AS total, COUNT(*) AS n FROM fact_spend ${whereSql}`;

  // Rows — paginated detail table
  const rowsSql = `
    SELECT id, odoo_instance, odoo_model, odoo_id, odoo_name,
           occurred_at, period_day, brand, category_id, category_label,
           sub_kind, product_name, vendor_id, vendor_name,
           amount_total, payment_mode, payment_status, payment_ref,
           source_ui, recorded_by_name, recorded_by_role,
           flag_no_bill, flag_off_hours, flag_above_avg,
           flag_dup_candidate, flag_backdated,
           notes
    FROM fact_spend ${whereSql}
    ORDER BY period_day DESC, occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
  const rowsBind = [...bind, rowsLimit, rowsOffset];

  // Execute
  const [kpi, series, fCat, fVen, fPay, fRec, fSrc, fStat, fBrand, priorKpi, rows] =
    await Promise.all([
      db.prepare(kpiSql).bind(...bind).first(),
      db.prepare(seriesSql).bind(...bind).all(),
      db.prepare(facetCategorySql).bind(...bind).all(),
      db.prepare(facetVendorSql).bind(...bind).all(),
      db.prepare(facetPaymentSql).bind(...bind).all(),
      db.prepare(facetRecordedBySql).bind(...bind).all(),
      db.prepare(facetSourceSql).bind(...bind).all(),
      db.prepare(facetStatusSql).bind(...bind).all(),
      db.prepare(facetBrandSql).bind(...bind).all(),
      db.prepare(priorKpiSql).bind(...priorBind).first(),
      db.prepare(rowsSql).bind(...rowsBind).all(),
    ]);

  // Collate series into [{bucket, splits: [{key, amt}]}] for the client
  const seriesByBucket = {};
  for (const r of (series.results || [])) {
    const b = r.bucket;
    if (!seriesByBucket[b]) seriesByBucket[b] = { bucket: b, splits: [], total: 0 };
    seriesByBucket[b].splits.push({ key: r.split_key || '(none)', amt: r.amt || 0 });
    seriesByBucket[b].total += r.amt || 0;
  }
  const seriesOut = Object.values(seriesByBucket);

  // Delta: (current - prior) / prior
  const priorTotal = priorKpi?.total || 0;
  const curTotal   = kpi?.total || 0;
  const delta_pct  = priorTotal > 0 ? Math.round(((curTotal - priorTotal) / priorTotal) * 1000) / 10 : null;

  return json({
    meta: {
      user: { pin, name: user.name, role: user.role, canvas: user.canvas },
      filters: {
        brand: effBrands, date_from: dateFrom, date_to: dateTo,
        split_by: splitKey,
      },
      prior_period: { from: priorFrom, to: priorTo },
      generated_at: new Date().toISOString(),
    },
    kpi: {
      total: kpi?.total || 0,
      count: kpi?.n || 0,
      avg_ticket: kpi?.avg_ticket || 0,
      paid: kpi?.paid || 0,
      partial: kpi?.partial || 0,
      pending: kpi?.pending || 0,
      prior_total: priorTotal,
      delta_pct,
    },
    series: seriesOut,
    facets: {
      brand:       fBrand.results || [],
      category:    fCat.results   || [],
      vendor:      fVen.results   || [],
      payment_mode: fPay.results  || [],
      recorded_by: fRec.results   || [],
      source_ui:   fSrc.results   || [],
      payment_status: fStat.results || [],
    },
    flags_summary: {
      no_bill:        kpi?.flag_no_bill   || 0,
      above_avg:      kpi?.flag_above_avg || 0,
      dup_candidate:  kpi?.flag_dup       || 0,
      backdated:      kpi?.flag_backdated || 0,
      off_hours:      kpi?.flag_off_hours || 0,
    },
    rows: rows.results || [],
    total_rows: kpi?.n || 0,
  });
}
