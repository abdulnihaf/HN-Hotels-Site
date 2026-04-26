// HN Corporate Finance Operations API — covers BOTH brands (HE + NCH).
// Odoo (ops.hamzahotel.com) is the master source for expense records.
// D1 hn-hiring.business_expenses is a read-through cache mirroring each hr.expense row.
// Reads hit D1 for speed; writes go Odoo-first then mirror to D1 with odoo_id link.
// GET ?action=expense-taxonomy returns the 15-parent / 87-product tree (from Odoo).
// All endpoints accept ?brand=he|nch (or company_id=1|10) to filter / target.

const COMPANY = { he: 1, nch: 10 };
const COMPANY_NAME = { 1: 'Hamza Express', 10: 'Nawabi Chai House' };
const HN_EXPENSE_ROOT = 'HN Hotels Expenses';

const PINS = {
  '5882': 'Nihaf',
  '3754': 'Naveen',
  '7421': 'Yash',
  '8316': 'Zoya',
  '6045': 'Faheem',
  '4040': 'Haneef',
  '5050': 'Nisar',
};

function companyFromRequest(url, body) {
  const brand = (url.searchParams.get('brand') || body?.brand || '').toLowerCase();
  if (brand === 'he' || brand === 'nch') return COMPANY[brand];
  const cid = parseInt(url.searchParams.get('company_id') || body?.company_id, 10);
  if (cid === 1 || cid === 10) return cid;
  return null;
}

function resolvePaymentMethod(xMethod, legacyMode) {
  return xMethod || (legacyMode === 'cash' ? 'cash' : legacyMode === 'bank' ? 'hdfc_bank' : 'cash');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, {headers: corsHeaders});

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const env = context.env;

  try {
    if (!DB) return json({success: false, error: 'Database not configured'});

    // ══════════════════════════════════════════
    // VERIFY PIN
    // ══════════════════════════════════════════
    if (action === 'verify-pin') {
      const pin = url.searchParams.get('pin');
      if (PINS[pin]) return json({success: true, user: PINS[pin]});
      return json({success: false, error: 'Invalid PIN'});
    }

    // ══════════════════════════════════════════
    // EXPENSE TAXONOMY — live from Odoo master
    // ══════════════════════════════════════════
    if (action === 'expense-taxonomy') {
      if (!env.ODOO_API_KEY) return json({success: false, error: 'Odoo API key not configured'});
      const ODOO_URL = env.ODOO_URL || 'https://odoo.hnhotels.in/jsonrpc';
      const ODOO_DB = env.ODOO_DB || 'main';
      const ODOO_UID = parseInt(env.ODOO_UID || '2', 10);
      const KEY = env.ODOO_API_KEY;

      const rootRes = await odooCall(ODOO_URL, ODOO_DB, ODOO_UID, KEY, 'product.category', 'search_read',
        [[['name', '=', HN_EXPENSE_ROOT], ['parent_id', '=', false]]], {fields: ['id', 'name'], limit: 1});
      if (!rootRes.length) return json({success: false, error: 'Root category "HN Hotels Expenses" not found in Odoo'});
      const root = rootRes[0];

      const parents = await odooCall(ODOO_URL, ODOO_DB, ODOO_UID, KEY, 'product.category', 'search_read',
        [[['parent_id', '=', root.id]]], {fields: ['id', 'name'], order: 'name asc'});

      const parentIds = parents.map(p => p.id);
      const products = await odooCall(ODOO_URL, ODOO_DB, ODOO_UID, KEY, 'product.product', 'search_read',
        [[['categ_id', 'in', parentIds], ['can_be_expensed', '=', true], ['active', '=', true]]],
        {fields: ['id', 'name', 'categ_id'], order: 'name asc', limit: 500});

      const byParent = {};
      for (const p of products) {
        const parentId = p.categ_id[0];
        (byParent[parentId] = byParent[parentId] || []).push({id: p.id, name: p.name});
      }
      const tree = parents.map(p => ({id: p.id, name: p.name, products: byParent[p.id] || []}));

      return new Response(JSON.stringify({
        success: true,
        root: {id: root.id, name: root.name},
        parents: tree,
        options: {
          brands: [
            {v: 'nch', l: 'Nawabi Chai House', company_id: 3},
            {v: 'he', l: 'Hamza Express', company_id: 2},
          ],
          payment_methods: [
            {v: 'cash', l: 'Cash'},
            {v: 'hdfc_bank', l: 'HDFC Bank'},
            {v: 'federal_bank', l: 'Federal Bank'},
            {v: 'paytm_upi', l: 'Paytm UPI'},
            {v: 'razorpay', l: 'Razorpay'},
            {v: 'petty_pool', l: 'Petty Pool'},
            {v: 'counter_pool', l: 'Counter Pool'},
          ],
          pools: [
            {v: 'counter', l: 'Counter'},
            {v: 'petty', l: 'Petty'},
            {v: 'formal', l: 'Formal'},
            {v: 'capex', l: 'Capex'},
            {v: 'owner_drawing', l: 'Owner Drawing'},
          ],
          locations: [
            {v: 'nch_koramangala', l: 'NCH Koramangala'},
            {v: 'he_koramangala', l: 'HE Koramangala'},
            {v: 'hq', l: 'HQ'},
            {v: 'other', l: 'Other'},
          ],
        },
      }), {headers: {...corsHeaders, 'Cache-Control': 'public, max-age=300'}});
    }

    // ══════════════════════════════════════════
    // OVERVIEW — KPIs for date range per brand
    // ══════════════════════════════════════════
    if (action === 'overview') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) return json({success: false, error: 'from and to required'});
      const fromISO = from + 'T00:00:00';
      const toISO = to + 'T23:59:59';
      const companyId = companyFromRequest(url, {});

      const where = companyId ? 'WHERE recorded_at BETWEEN ? AND ? AND company_id = ?' : 'WHERE recorded_at BETWEEN ? AND ?';
      const binds = companyId ? [fromISO, toISO, companyId] : [fromISO, toISO];

      const byMode = await DB.prepare(
        `SELECT payment_mode, COALESCE(SUM(amount),0) as total FROM business_expenses ${where} GROUP BY payment_mode`
      ).bind(...binds).all();

      const byParent = await DB.prepare(
        `SELECT COALESCE(category_parent, category) as label, COALESCE(SUM(amount),0) as total, COUNT(*) as cnt
         FROM business_expenses ${where} GROUP BY label ORDER BY total DESC`
      ).bind(...binds).all();

      const byPool = await DB.prepare(
        `SELECT x_pool as pool, COALESCE(SUM(amount),0) as total FROM business_expenses ${where} AND x_pool IS NOT NULL GROUP BY x_pool ORDER BY total DESC`
      ).bind(...binds).all();

      const byBrand = await DB.prepare(
        `SELECT company_id, COALESCE(SUM(amount),0) as total, COUNT(*) as cnt
         FROM business_expenses WHERE recorded_at BETWEEN ? AND ? GROUP BY company_id ORDER BY total DESC`
      ).bind(fromISO, toISO).all();

      const cash = byMode.results.find(r => r.payment_mode === 'cash')?.total || 0;
      const bank = byMode.results.find(r => r.payment_mode === 'bank')?.total || 0;
      const total = cash + bank;

      return json({
        success: true,
        filter: {from, to, company_id: companyId, brand: companyId ? Object.keys(COMPANY).find(k => COMPANY[k] === companyId) : null},
        summary: {total, cash, bank},
        byCategory: byParent.results,
        byPool: byPool.results,
        byBrand: byBrand.results.map(r => ({
          company_id: r.company_id,
          brand: Object.keys(COMPANY).find(k => COMPANY[k] === r.company_id) || 'unallocated',
          name: COMPANY_NAME[r.company_id] || 'Unallocated',
          total: r.total, count: r.cnt,
        })),
      });
    }

    // ══════════════════════════════════════════
    // LEDGER — recent entries with optional filters
    // ══════════════════════════════════════════
    if (action === 'ledger') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) return json({success: false, error: 'from and to required'});
      const fromISO = from + 'T00:00:00';
      const toISO = to + 'T23:59:59';
      const companyId = companyFromRequest(url, {});
      const pool = url.searchParams.get('pool');

      let where = 'WHERE recorded_at BETWEEN ? AND ?';
      const binds = [fromISO, toISO];
      if (companyId) { where += ' AND company_id = ?'; binds.push(companyId); }
      if (pool) { where += ' AND x_pool = ?'; binds.push(pool); }

      const rows = await DB.prepare(
        `SELECT id, recorded_by, recorded_at, amount, description, category_parent, product_name,
                x_pool, x_payment_method, x_location, x_excluded_from_pnl, company_id, odoo_id, notes
         FROM business_expenses ${where} ORDER BY recorded_at DESC LIMIT 500`
      ).bind(...binds).all();

      return json({success: true, entries: rows.results});
    }

    // ══════════════════════════════════════════
    // WRITE — record-expense (Odoo-first, D1 mirror)
    // ══════════════════════════════════════════
    if (context.request.method === 'POST' && action === 'record-expense') {
      const body = await context.request.json();
      const user = PINS[body.pin];
      if (!user) return json({success: false, error: 'Invalid PIN'});

      const {amount, description, product_id, product_name, category_parent, x_pool, x_payment_method, x_location, x_excluded_from_pnl, notes} = body;
      const legacyPayment = body.payment_mode;

      if (!amount || amount <= 0) return json({success: false, error: 'Valid amount required'});
      if (!description || !description.trim()) return json({success: false, error: 'Description required'});
      if (!product_id) return json({success: false, error: 'product_id required — use action=expense-taxonomy to get the list'});

      const companyId = companyFromRequest(url, body);
      if (!companyId) return json({success: false, error: 'brand (he|nch) or company_id required'});

      if (!env.ODOO_API_KEY) return json({success: false, error: 'Odoo API key not configured'});
      const ODOO_URL = env.ODOO_URL || 'https://odoo.hnhotels.in/jsonrpc';
      const ODOO_DB = env.ODOO_DB || 'main';
      const ODOO_UID = parseInt(env.ODOO_UID || '2', 10);
      const KEY = env.ODOO_API_KEY;

      const xPaymentMethod = resolvePaymentMethod(x_payment_method, legacyPayment);
      const nowIso = new Date().toISOString();

      // Pick any active employee in the target company to attach the expense to
      const emps = await odooCall(ODOO_URL, ODOO_DB, ODOO_UID, KEY, 'hr.employee', 'search_read',
        [[['company_id', '=', companyId], ['active', '=', true]]],
        {fields: ['id', 'name'], order: 'id asc', limit: 1});
      if (!emps.length) return json({success: false, error: `No active employee found in company ${companyId} to attach expense to`});
      const employeeId = emps[0].id;

      let odooId;
      try {
        odooId = await odooCall(ODOO_URL, ODOO_DB, ODOO_UID, KEY, 'hr.expense', 'create', [{
          name: description.trim(),
          employee_id: employeeId,
          product_id: product_id,
          total_amount: amount,
          payment_mode: 'company_account',
          company_id: companyId,
          x_payment_method: xPaymentMethod,
          x_pool: x_pool || 'counter',
          x_location: x_location || (companyId === 10 ? 'nch_koramangala' : 'he_koramangala'),
          x_excluded_from_pnl: !!x_excluded_from_pnl,
          x_submitted_by: user.toLowerCase(),
          description: notes || '',
        }]);
      } catch (e) {
        return new Response(JSON.stringify({success: false, error: `Odoo write failed: ${e.message}`}), {status: 502, headers: corsHeaders});
      }

      const legacyMode = xPaymentMethod === 'cash' ? 'cash' : 'bank';
      const effectiveCategory = category_parent || 'other';

      let d1Error = null;
      try {
        await DB.prepare(
          `INSERT INTO business_expenses
            (recorded_by, recorded_at, amount, description, category, payment_mode, notes,
             odoo_id, company_id, product_id, product_name, category_parent,
             x_pool, x_payment_method, x_location, x_excluded_from_pnl, odoo_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user, nowIso, amount, description.trim(), effectiveCategory, legacyMode, notes || '',
          odooId, companyId, product_id, product_name || null, category_parent || null,
          x_pool || 'counter', xPaymentMethod, x_location || (companyId === 10 ? 'nch_koramangala' : 'he_koramangala'),
          x_excluded_from_pnl ? 1 : 0, nowIso
        ).run();
      } catch (e) {
        d1Error = `D1 mirror failed (Odoo row ${odooId} is orphan): ${e.message}`;
      }

      return json({
        success: true,
        odoo_id: odooId,
        warning: d1Error,
        message: `Expense recorded on ${COMPANY_NAME[companyId]}: ₹${amount} (Odoo #${odooId})`,
      });
    }

    // ══════════════════════════════════════════
    // WRITE — record-bank-txn (D1 only; bank ledger lives in D1)
    // ══════════════════════════════════════════
    if (context.request.method === 'POST' && action === 'record-bank-txn') {
      const body = await context.request.json();
      const user = PINS[body.pin];
      if (!user) return json({success: false, error: 'Invalid PIN'});
      const {type, amount, description, method, notes} = body;
      if (!amount || amount <= 0) return json({success: false, error: 'Valid amount required'});
      if (!type || !['deposit', 'withdrawal', 'opening_balance'].includes(type)) return json({success: false, error: 'Type must be deposit, withdrawal, or opening_balance'});
      if (!description || !description.trim()) return json({success: false, error: 'Description required'});
      const companyId = companyFromRequest(url, body);

      await DB.prepare(
        'INSERT INTO bank_transactions (recorded_by, recorded_at, type, amount, description, method, notes, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(user, new Date().toISOString(), type, amount, description.trim(), method || '', notes || '', companyId).run();

      const labels = {deposit: 'Bank deposit', withdrawal: 'Bank withdrawal', opening_balance: 'Opening balance'};
      return json({success: true, message: `${labels[type]} recorded: ₹${amount}`});
    }

    // ══════════════════════════════════════════
    // DELETE — Nihaf only, D1 + Odoo
    // ══════════════════════════════════════════
    if (context.request.method === 'POST' && action === 'delete-entry') {
      const body = await context.request.json();
      const user = PINS[body.pin];
      if (user !== 'Nihaf') return json({success: false, error: 'Only Nihaf can delete entries'});
      const {table, id} = body;
      if (!['business_expenses', 'bank_transactions'].includes(table)) return json({success: false, error: 'Invalid table'});
      if (!id) return json({success: false, error: 'ID required'});

      // If business_expenses with odoo_id, also unlink from Odoo
      if (table === 'business_expenses') {
        const row = await DB.prepare('SELECT odoo_id FROM business_expenses WHERE id = ?').bind(id).first();
        if (row?.odoo_id && env.ODOO_API_KEY) {
          try {
            await odooCall(env.ODOO_URL || 'https://odoo.hnhotels.in/jsonrpc', env.ODOO_DB || 'main',
              parseInt(env.ODOO_UID || '2', 10), env.ODOO_API_KEY, 'hr.expense', 'unlink', [[row.odoo_id]]);
          } catch (e) {
            return json({success: false, error: `Odoo unlink failed (D1 row intact): ${e.message}`});
          }
        }
      }

      const result = await DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      if (result.meta?.changes === 0) return json({success: false, error: 'Entry not found'});
      return json({success: true, message: 'Entry deleted from Odoo + D1'});
    }

    return json({success: false, error: 'Invalid action'});
  } catch (error) {
    return new Response(JSON.stringify({success: false, error: error.message, stack: error.stack}), {status: 500, headers: corsHeaders});
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: corsHeaders});
}

async function odooCall(url, db, uid, apiKey, model, method, positionalArgs, kwargs) {
  const payload = {
    jsonrpc: '2.0', method: 'call',
    params: { service: 'object', method: 'execute_kw',
      args: [db, uid, apiKey, model, method, positionalArgs, kwargs || {}] },
    id: Date.now(),
  };
  const response = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
  const data = await response.json();
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${data.error.data?.message || data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}
