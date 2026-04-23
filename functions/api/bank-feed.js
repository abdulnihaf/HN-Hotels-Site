/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Money Events — read/write API for /ops/bank/.
 * Route:  /api/bank-feed
 * D1:     DB (hn-hiring), table money_events + money_source_health
 *         + money_recon_matches
 *
 * Sources supported: hdfc, razorpay, paytm, zomato_*, swiggy, eazydiner,
 *                    federal, manual.
 *
 *   GET /api/bank-feed?action=list
 *        &pin=XXXX
 *        [&limit=100 &source=hdfc &dir=credit|debit &status=unreconciled]
 *   GET /api/bank-feed?action=summary&pin=XXXX
 *        → per-instrument balance + today/7d/30d rollups + source staleness
 *   GET /api/bank-feed?action=health&pin=XXXX
 *        → money_source_health snapshot
 *   POST /api/bank-feed?action=reconcile&pin=XXXX
 *        body: { id, status, matched_expense_id?, matched_vendor_bill_id?,
 *                matched_payout_platform?, notes? }
 *
 * All endpoints require a valid PIN (query param or x-ops-pin header).
 * CORS is scoped to hnhotels.in origins — no credentialed * wildcard.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// Re-using PIN list shape from rm-admin.js. Keep in sync with other ops APIs.
// (Long-term: lift to a shared module; for now duplicated to avoid cross-
// function imports in Pages Functions.)
const PINS = {
  '0305': { name: 'Nihaf',  role: 'admin' },
  '3754': { name: 'Naveen', role: 'admin' },   // CFO
  '6045': { name: 'Faheem', role: 'ops'   },
  '3678': { name: 'Faheem', role: 'ops'   },
  '5882': { name: 'Nihaf',  role: 'admin' },   // legacy
  '2026': { name: 'Zoya',   role: 'ops'   },
};
const ROLE_RANK = { read: 0, ops: 1, admin: 2 };

const ALLOWED_ORIGINS = new Set([
  'https://hnhotels.in',
  'https://www.hnhotels.in',
  'http://localhost:8788',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://hnhotels.in';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function checkPin(pin, minRole = 'ops') {
  const u = PINS[pin];
  if (!u) return null;
  if ((ROLE_RANK[u.role] ?? -1) < (ROLE_RANK[minRole] ?? 99)) return null;
  return u;
}

function pinFromRequest(request, url) {
  return (
    request.headers.get('x-ops-pin') ||
    url.searchParams.get('pin') ||
    ''
  );
}

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request.headers.get('origin') || '') });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const user = checkPin(pinFromRequest(request, url), 'read');
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  const action = url.searchParams.get('action') || 'list';
  const db = env.DB;

  if (action === 'list') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 5000);
    const since = url.searchParams.get('since');
    const dir = url.searchParams.get('dir');
    const status = url.searchParams.get('status');
    const source = url.searchParams.get('source');
    const instrument = url.searchParams.get('instrument');
    const channel = url.searchParams.get('channel');
    const brand = url.searchParams.get('brand');
    const category = url.searchParams.get('category');
    const platform = url.searchParams.get('platform');         // settlement_platform
    const payeeId = url.searchParams.get('payee_id');
    const q = url.searchParams.get('q');                        // counterparty/narration/ref search
    const dateFrom = url.searchParams.get('date_from');         // ISO yyyy-mm-dd
    const dateTo = url.searchParams.get('date_to');
    const minAmt = url.searchParams.get('min_amount');          // in rupees
    const maxAmt = url.searchParams.get('max_amount');

    let sql = `SELECT me.id, me.source, me.source_ref, me.instrument, me.txn_at, me.received_at,
                      me.direction, me.amount_paise, me.balance_paise_after,
                      me.channel, me.counterparty, me.counterparty_ref, me.narration,
                      me.parse_status, me.reconcile_status,
                      me.matched_expense_id, me.matched_vendor_bill_id, me.matched_payout_platform,
                      me.matched_payee_id, me.brand, me.category, me.settlement_platform,
                      mp.name AS payee_name, mp.bank AS payee_bank, mp.last4 AS payee_last4
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE 1=1`;
    const binds = [];
    if (!status)                      sql += ` AND me.parse_status IN ('parsed','partial')`;
    if (since)                      { sql += ' AND (me.txn_at >= ? OR me.received_at >= ?)'; binds.push(since, since); }
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (status === 'unreconciled')    sql += ` AND me.reconcile_status='unreconciled' AND me.parse_status='parsed'`;
    if (status === 'reconciled')      sql += ` AND me.reconcile_status IN ('auto','manual')`;
    if (status === 'quarantined')     sql += ` AND me.parse_status IN ('failed','quarantined','partial')`;
    if (source)                     { sql += ' AND me.source=?';                  binds.push(source); }
    if (instrument)                 { sql += ' AND me.instrument=?';              binds.push(instrument); }
    if (channel)                    { sql += ' AND me.channel=?';                 binds.push(channel); }
    if (brand)                      { sql += ' AND me.brand=?';                   binds.push(brand); }
    if (category)                   { sql += ' AND me.category=?';                binds.push(category); }
    if (platform === 'direct')        sql += ' AND me.settlement_platform IS NULL';
    else if (platform)              { sql += ' AND me.settlement_platform=?';     binds.push(platform); }
    if (payeeId)                    { sql += ' AND me.matched_payee_id=?';        binds.push(parseInt(payeeId, 10)); }
    if (dateFrom)                   { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(dateFrom); }
    if (dateTo)                     { sql += ' AND COALESCE(me.txn_at, me.received_at) <= ?'; binds.push(dateTo + 'T23:59:59+05:30'); }
    if (minAmt)                     { sql += ' AND me.amount_paise >= ?';         binds.push(Math.round(parseFloat(minAmt) * 100)); }
    if (maxAmt)                     { sql += ' AND me.amount_paise <= ?';         binds.push(Math.round(parseFloat(maxAmt) * 100)); }
    if (q) {
      sql += ' AND (me.counterparty LIKE ? OR me.narration LIKE ? OR me.source_ref LIKE ? OR me.counterparty_ref LIKE ?)';
      const needle = '%' + q + '%';
      binds.push(needle, needle, needle, needle);
    }
    sql += ' ORDER BY COALESCE(me.txn_at, me.received_at) DESC, me.id DESC LIMIT ?';
    binds.push(limit);
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, user: user.name, rows: r.results || [] }, 200, origin);
  }

  if (action === 'payees') {
    const registry = url.searchParams.get('registry');
    const category = url.searchParams.get('category');
    const brand = url.searchParams.get('brand');
    let sql = `SELECT mp.id, mp.registry_source, mp.name, mp.bank, mp.account_type,
                      mp.last4, mp.category, mp.commodity, mp.role, mp.brand,
                      mp.is_own_account, mp.notes,
                      (SELECT COUNT(*)            FROM money_events me WHERE me.matched_payee_id = mp.id) AS txn_count,
                      (SELECT SUM(amount_paise)   FROM money_events me WHERE me.matched_payee_id = mp.id AND me.direction='debit'  AND me.parse_status='parsed') AS paid_paise,
                      (SELECT SUM(amount_paise)   FROM money_events me WHERE me.matched_payee_id = mp.id AND me.direction='credit' AND me.parse_status='parsed') AS received_paise,
                      (SELECT MAX(txn_at)         FROM money_events me WHERE me.matched_payee_id = mp.id) AS last_txn_at
               FROM money_payees mp WHERE 1=1`;
    const binds = [];
    if (registry) { sql += ' AND mp.registry_source=?'; binds.push(registry); }
    if (category) { sql += ' AND mp.category=?';        binds.push(category); }
    if (brand)    { sql += ' AND mp.brand=?';           binds.push(brand); }
    sql += ' ORDER BY paid_paise DESC NULLS LAST, mp.name';
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'top_counterparties') {
    // Aggregates by counterparty name (raw, not just registered payees).
    // Useful for discovering unmatched counterparties that should be added
    // to the registry.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 200);
    const dir = url.searchParams.get('dir'); // optional: credit | debit
    const since = url.searchParams.get('since'); // optional ISO date
    let sql = `SELECT COALESCE(me.counterparty, '—') AS counterparty,
                      me.matched_payee_id,
                      mp.name  AS payee_name,
                      mp.brand AS payee_brand,
                      mp.category AS payee_category,
                      me.direction,
                      COUNT(*)                AS n,
                      SUM(me.amount_paise)    AS total_paise,
                      MAX(me.txn_at)          AS last_txn_at
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE me.parse_status='parsed'`;
    const binds = [];
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (since)                               { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(since); }
    sql += ` GROUP BY me.counterparty, me.matched_payee_id, me.direction
             ORDER BY total_paise DESC LIMIT ?`;
    binds.push(limit);
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'platform_summary') {
    // Revenue breakdown by settlement_platform (Razorpay/Paytm/etc.)
    // Shows aggregator gross revenue; commission/net split is future work
    // once platform statements are backfilled.
    const since = url.searchParams.get('since');
    let sql = `SELECT COALESCE(settlement_platform, 'direct') AS platform,
                      direction,
                      COUNT(*) AS n,
                      SUM(amount_paise) AS total_paise
               FROM money_events
               WHERE parse_status='parsed'`;
    const binds = [];
    if (since) { sql += ' AND COALESCE(txn_at, received_at) >= ?'; binds.push(since); }
    sql += ' GROUP BY settlement_platform, direction ORDER BY total_paise DESC';
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'attention_queue') {
    // Items that need a human decision. Budget-constrained: each query
    // returns ≤10 so the client renders fast. Categories:
    //   unmatched        — parsed credits with a counterparty but no payee link
    //   unusual          — debits in last 7d exceeding 2× the 30d counterparty avg
    //   unreconciled     — platform-settled rows still flagged unreconciled
    const now = new Date();
    const d7  = new Date(now.getTime() -  7 * 86400000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();

    const [unmatched, unusual, unreconciled, counts] = await Promise.all([
      db.prepare(`
        SELECT id, txn_at, direction, amount_paise, counterparty, channel, narration
        FROM money_events
        WHERE parse_status='parsed' AND matched_payee_id IS NULL
          AND counterparty IS NOT NULL AND counterparty != ''
          AND COALESCE(txn_at, received_at) >= ?
        ORDER BY amount_paise DESC LIMIT 10
      `).bind(d30).all(),
      // Rough unusual detector: last-7d debits where the row's amount is
      // >= 2 × the 30d average for the same counterparty. Cheap signal,
      // surfaces the "did I really pay X this much?" checks.
      db.prepare(`
        WITH avg30 AS (
          SELECT counterparty, AVG(amount_paise) AS avg_paise, COUNT(*) AS n
          FROM money_events
          WHERE parse_status='parsed' AND direction='debit'
            AND COALESCE(txn_at, received_at) >= ?
          GROUP BY counterparty HAVING n >= 3
        )
        SELECT me.id, me.txn_at, me.amount_paise, me.counterparty, me.channel,
               a.avg_paise, (me.amount_paise * 1.0 / a.avg_paise) AS ratio
        FROM money_events me
        JOIN avg30 a ON a.counterparty = me.counterparty
        WHERE me.parse_status='parsed' AND me.direction='debit'
          AND COALESCE(me.txn_at, me.received_at) >= ?
          AND me.amount_paise >= a.avg_paise * 2
        ORDER BY ratio DESC LIMIT 10
      `).bind(d30, d7).all(),
      db.prepare(`
        SELECT id, txn_at, amount_paise, counterparty, settlement_platform, channel
        FROM money_events
        WHERE parse_status='parsed' AND reconcile_status='unreconciled'
          AND settlement_platform IS NOT NULL
        ORDER BY COALESCE(txn_at, received_at) DESC LIMIT 10
      `).all(),
      db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM money_events WHERE parse_status='parsed' AND matched_payee_id IS NULL AND counterparty IS NOT NULL AND counterparty != '') AS n_unmatched,
          (SELECT COUNT(*) FROM money_events WHERE parse_status='parsed' AND reconcile_status='unreconciled' AND settlement_platform IS NOT NULL)                  AS n_unreconciled,
          (SELECT COUNT(*) FROM money_events WHERE parse_status IN ('partial','failed','quarantined'))                                                             AS n_parse_issues
      `).first(),
    ]);
    return json({
      ok: true,
      counts,
      unmatched:    unmatched.results    || [],
      unusual:      unusual.results      || [],
      unreconciled: unreconciled.results || [],
    }, 200, origin);
  }

  if (action === 'daily_cashflow') {
    // Per-day sum of credits/debits for the sparkline. Default 30 days.
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const instrument = url.searchParams.get('instrument');
    let sql = `SELECT SUBSTR(COALESCE(txn_at, received_at), 1, 10) AS day,
                      SUM(CASE WHEN direction='credit' THEN amount_paise ELSE 0 END) AS credit_paise,
                      SUM(CASE WHEN direction='debit'  THEN amount_paise ELSE 0 END) AS debit_paise
               FROM money_events
               WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?`;
    const binds = [since];
    if (instrument && instrument !== 'all') { sql += ' AND instrument=?'; binds.push(instrument); }
    sql += ' GROUP BY day ORDER BY day';
    const r = await db.prepare(sql).bind(...binds).all();
    return json({ ok: true, days, rows: r.results || [] }, 200, origin);
  }

  if (action === 'statement') {
    // Branded, printable HTML statement. Respects all filters. Returns
    // a complete HTML document — user opens in new tab and prints to PDF
    // via Cmd/Ctrl+P. No external asset deps; inline CSS sized for A4.
    const dir       = url.searchParams.get('dir');
    const status    = url.searchParams.get('status');
    const instrument= url.searchParams.get('instrument');
    const brand     = url.searchParams.get('brand');
    const category  = url.searchParams.get('category');
    const platform  = url.searchParams.get('platform');
    const payeeId   = url.searchParams.get('payee_id');
    const q         = url.searchParams.get('q');
    const dateFrom  = url.searchParams.get('date_from');
    const dateTo    = url.searchParams.get('date_to');
    const minAmt    = url.searchParams.get('min_amount');
    const maxAmt    = url.searchParams.get('max_amount');

    let sql = `SELECT me.txn_at, me.received_at, me.instrument, me.direction,
                      me.amount_paise, me.balance_paise_after,
                      me.settlement_platform, me.channel,
                      me.counterparty, me.counterparty_ref,
                      mp.name AS payee_name, mp.last4 AS payee_last4,
                      me.category, me.brand, me.source_ref, me.narration,
                      me.reconcile_status
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE 1=1`;
    const binds = [];
    if (!status)                  sql += ` AND me.parse_status IN ('parsed','partial')`;
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (status === 'unreconciled') sql += ` AND me.reconcile_status='unreconciled' AND me.parse_status='parsed'`;
    if (status === 'reconciled')   sql += ` AND me.reconcile_status IN ('auto','manual')`;
    if (instrument)               { sql += ' AND me.instrument=?';           binds.push(instrument); }
    if (brand)                    { sql += ' AND me.brand=?';                binds.push(brand); }
    if (category)                 { sql += ' AND me.category=?';             binds.push(category); }
    if (platform === 'direct')      sql += ' AND me.settlement_platform IS NULL';
    else if (platform)            { sql += ' AND me.settlement_platform=?'; binds.push(platform); }
    if (payeeId)                  { sql += ' AND me.matched_payee_id=?';    binds.push(parseInt(payeeId, 10)); }
    if (dateFrom)                 { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(dateFrom); }
    if (dateTo)                   { sql += ' AND COALESCE(me.txn_at, me.received_at) <= ?'; binds.push(dateTo.length === 10 ? dateTo + 'T23:59:59+05:30' : dateTo); }
    if (minAmt)                   { sql += ' AND me.amount_paise >= ?'; binds.push(Math.round(parseFloat(minAmt) * 100)); }
    if (maxAmt)                   { sql += ' AND me.amount_paise <= ?'; binds.push(Math.round(parseFloat(maxAmt) * 100)); }
    if (q) {
      sql += ' AND (me.counterparty LIKE ? OR me.narration LIKE ? OR me.source_ref LIKE ? OR me.counterparty_ref LIKE ?)';
      const needle = '%' + q + '%';
      binds.push(needle, needle, needle, needle);
    }
    sql += ' ORDER BY COALESCE(me.txn_at, me.received_at) ASC LIMIT 50000';
    const r = await db.prepare(sql).bind(...binds).all();
    const rows = r.results || [];

    // Aggregates.
    const credits = rows.filter(x => x.direction === 'credit');
    const debits  = rows.filter(x => x.direction === 'debit');
    const sumCr   = credits.reduce((a, b) => a + (b.amount_paise || 0), 0);
    const sumDr   = debits .reduce((a, b) => a + (b.amount_paise || 0), 0);
    const net     = sumCr - sumDr;

    const fmtRupees = p => p == null ? '—' : '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtShort  = p => {
      if (p == null) return '—';
      const r = Math.abs(p) / 100;
      if (r >= 10000000) return '₹' + (r / 10000000).toFixed(2) + ' Cr';
      if (r >= 100000)   return '₹' + (r / 100000).toFixed(2) + ' L';
      if (r >= 1000)     return '₹' + (r / 1000).toFixed(1) + 'k';
      return '₹' + Math.round(r).toLocaleString('en-IN');
    };
    const fmtDate = iso => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    const htmlEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

    // Group by day.
    const byDay = new Map();
    for (const x of rows) {
      const d = (x.txn_at || x.received_at || '').slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(x);
    }
    const dayKeys = Array.from(byDay.keys()).sort();

    // Title / filter summary
    const titleBits = [];
    if (instrument === 'hdfc_ca_4680')    titleBits.push('HDFC 4680');
    else if (instrument === 'federal_sa_4510') titleBits.push('Federal 4510');
    if (brand && brand !== 'all') titleBits.push(`brand: ${brand}`);
    if (category)  titleBits.push(category.replace(/_/g, ' '));
    if (platform)  titleBits.push(platform);
    if (dir === 'credit') titleBits.push('credits only');
    if (dir === 'debit')  titleBits.push('debits only');
    if (payeeId) {
      const p = await db.prepare('SELECT name FROM money_payees WHERE id=?').bind(parseInt(payeeId, 10)).first();
      if (p?.name) titleBits.push(`payee: ${p.name}`);
    }
    if (q) titleBits.push(`"${q}"`);
    const filterLabel = titleBits.length ? titleBits.join(' · ') : 'All transactions';
    const rangeLabel = [
      dateFrom ? `from ${fmtDate(dateFrom)}` : null,
      dateTo   ? `to ${fmtDate(dateTo)}`     : null,
    ].filter(Boolean).join(' ') || (rows.length ? `${fmtDate(rows[0].txn_at || rows[0].received_at)} — ${fmtDate(rows[rows.length-1].txn_at || rows[rows.length-1].received_at)}` : '—');

    const nowStr = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const tableRows = dayKeys.map(d => {
      const rs = byDay.get(d);
      const dayCr = rs.filter(x => x.direction === 'credit').reduce((a, b) => a + (b.amount_paise || 0), 0);
      const dayDr = rs.filter(x => x.direction === 'debit').reduce((a, b) => a + (b.amount_paise || 0), 0);
      return `
        <tr class="day-row">
          <td colspan="6">
            <span class="day-label">${fmtDate(d)}</span>
            <span class="day-totals">
              ${dayCr ? `<span class="cr">+${fmtShort(dayCr)}</span>` : ''}
              ${dayDr ? `<span class="dr">−${fmtShort(dayDr)}</span>` : ''}
            </span>
          </td>
        </tr>
        ${rs.map(x => {
          const cp = x.payee_name || x.counterparty || '—';
          const meta = [x.channel, x.settlement_platform, x.payee_last4 ? 'a/c ·' + x.payee_last4 : null].filter(Boolean).join(' · ');
          const amt = fmtRupees(x.amount_paise);
          const isCr = x.direction === 'credit';
          return `
            <tr class="txn">
              <td class="time">${(x.txn_at || '').slice(11, 16) || '—'}</td>
              <td class="cp">
                <div class="cp-name">${htmlEsc(cp)}</div>
                ${meta ? `<div class="cp-meta">${htmlEsc(meta)}</div>` : ''}
                ${x.narration ? `<div class="cp-narr">${htmlEsc((x.narration || '').slice(0, 140))}</div>` : ''}
              </td>
              <td class="cat">${x.category ? htmlEsc(x.category.replace(/_/g, ' ')) : '—'}</td>
              <td class="brand">${x.brand ? htmlEsc(x.brand) : '—'}</td>
              <td class="amt ${isCr ? 'cr' : 'dr'}">${isCr ? '+' : '−'}${fmtRupees(x.amount_paise)}</td>
              <td class="bal">${x.balance_paise_after != null ? fmtRupees(x.balance_paise_after) : ''}</td>
            </tr>
          `;
        }).join('')}
      `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>HN Money Statement — ${htmlEsc(filterLabel)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: #fff; font-size: 11px; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 24px 28px; }
  .header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
  .brand .ac { color: #e8930c; }
  .brand .lbl { color: #666; font-weight: 500; margin-left: 6px; }
  .meta-right { text-align: right; font-size: 10px; color: #666; line-height: 1.5; }
  .meta-right strong { color: #111; font-weight: 600; }
  .context { background: #f7f7f9; border: 1px solid #e5e5e8; padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; font-size: 10px; display: flex; gap: 18px; flex-wrap: wrap; }
  .context div strong { display: block; color: #888; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; margin-bottom: 2px; }
  .context div span { font-size: 12px; color: #111; font-weight: 500; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .summary .card { border: 1px solid #e5e5e8; border-radius: 6px; padding: 10px 12px; }
  .summary .label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; font-weight: 600; }
  .summary .num { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .summary .cr .num { color: #0a7a3a; }
  .summary .dr .num { color: #b4291f; }
  .summary .net .num.neg { color: #b4291f; }
  .summary .n  { font-size: 9px; color: #888; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #888; font-weight: 600; padding: 6px 4px; border-bottom: 1px solid #111; text-align: left; }
  thead th.amt, thead th.bal { text-align: right; }
  tr.day-row td { background: #f7f7f9; padding: 6px 8px; border-bottom: 1px solid #e5e5e8; border-top: 1px solid #e5e5e8; }
  .day-label { font-weight: 600; font-size: 10px; letter-spacing: .02em; color: #111; }
  .day-totals { float: right; font-variant-numeric: tabular-nums; font-size: 10px; }
  .day-totals .cr { color: #0a7a3a; margin-left: 10px; }
  .day-totals .dr { color: #b4291f; margin-left: 10px; }
  tr.txn td { padding: 7px 4px; border-bottom: 1px solid #f0f0f2; vertical-align: top; }
  tr.txn td.time { width: 40px; color: #888; font-variant-numeric: tabular-nums; }
  tr.txn td.cp   { min-width: 200px; }
  .cp-name { font-weight: 500; color: #111; font-size: 11px; }
  .cp-meta { color: #888; font-size: 9px; margin-top: 1px; }
  .cp-narr { color: #aaa; font-size: 8px; margin-top: 1px; line-height: 1.3; }
  tr.txn td.cat, tr.txn td.brand { color: #555; font-size: 10px; text-transform: capitalize; width: 90px; }
  tr.txn td.amt, tr.txn td.bal  { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; width: 90px; }
  tr.txn td.amt.cr { color: #0a7a3a; font-weight: 600; }
  tr.txn td.amt.dr { color: #b4291f; font-weight: 600; }
  tr.txn td.bal    { color: #666; font-size: 10px; }

  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e5e8; font-size: 9px; color: #888; display: flex; justify-content: space-between; }
  .no-print-btns { margin-bottom: 16px; }
  .no-print-btns button { background: #111; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; margin-right: 8px; font-family: inherit; }
  .no-print-btns button.sec { background: #fff; color: #111; border: 1px solid #ccc; }
  @media print { .no-print-btns { display: none !important; } }
</style>
</head><body>
<div class="wrap">
  <div class="no-print-btns">
    <button onclick="window.print()">↓ Save as PDF / Print</button>
    <button class="sec" onclick="window.close()">Close</button>
  </div>
  <div class="header">
    <div>
      <div class="brand"><span class="ac">HN</span> <span class="lbl">money statement</span></div>
    </div>
    <div class="meta-right">
      <strong>Generated:</strong> ${htmlEsc(nowStr)}<br>
      <strong>Source:</strong> hnhotels.in/ops/bank
    </div>
  </div>

  <div class="context">
    <div><strong>Scope</strong><span>${htmlEsc(filterLabel)}</span></div>
    <div><strong>Period</strong><span>${htmlEsc(rangeLabel)}</span></div>
    <div><strong>Transactions</strong><span>${rows.length}</span></div>
  </div>

  <div class="summary">
    <div class="card cr">
      <div class="label">Credits in</div>
      <div class="num">+${fmtRupees(sumCr)}</div>
      <div class="n">${credits.length} txn${credits.length === 1 ? '' : 's'}</div>
    </div>
    <div class="card dr">
      <div class="label">Debits out</div>
      <div class="num">−${fmtRupees(sumDr)}</div>
      <div class="n">${debits.length} txn${debits.length === 1 ? '' : 's'}</div>
    </div>
    <div class="card net">
      <div class="label">Net</div>
      <div class="num ${net < 0 ? 'neg' : ''}">${net >= 0 ? '+' : '−'}${fmtRupees(Math.abs(net))}</div>
      <div class="n">${net >= 0 ? 'inflow' : 'outflow'}</div>
    </div>
    <div class="card">
      <div class="label">Avg / day</div>
      <div class="num">${dayKeys.length ? fmtRupees(Math.round((sumCr + sumDr) / dayKeys.length)) : '—'}</div>
      <div class="n">across ${dayKeys.length} day${dayKeys.length === 1 ? '' : 's'}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="time">Time</th>
        <th class="cp">Counterparty</th>
        <th class="cat">Category</th>
        <th class="brand">Brand</th>
        <th class="amt">Amount</th>
        <th class="bal">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || '<tr><td colspan="6" style="text-align:center;padding:40px;color:#888;">No transactions match this filter.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div>HN Hotels Pvt Ltd · money ledger</div>
    <div>${rows.length} transaction${rows.length === 1 ? '' : 's'} · Generated ${htmlEsc(nowStr)}</div>
  </div>
</div>
</body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(origin) },
    });
  }

  if (action === 'export') {
    // CSV export — respects every filter the list action accepts.
    // Returns Content-Type: text/csv with attachment disposition so the
    // browser triggers a file download. PIN in query param is required
    // (can't set headers during a navigation-driven download).
    const dir = url.searchParams.get('dir');
    const status = url.searchParams.get('status');
    const instrument = url.searchParams.get('instrument');
    const brand = url.searchParams.get('brand');
    const category = url.searchParams.get('category');
    const platform = url.searchParams.get('platform');
    const payeeId = url.searchParams.get('payee_id');
    const q = url.searchParams.get('q');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const minAmt = url.searchParams.get('min_amount');
    const maxAmt = url.searchParams.get('max_amount');

    let sql = `SELECT me.txn_at, me.received_at, me.instrument, me.direction,
                      me.amount_paise, me.balance_paise_after,
                      me.source, me.settlement_platform, me.channel,
                      me.counterparty, me.counterparty_ref,
                      mp.name AS payee_name, me.category, me.brand,
                      me.source_ref, me.narration,
                      me.parse_status, me.reconcile_status
               FROM money_events me
               LEFT JOIN money_payees mp ON mp.id = me.matched_payee_id
               WHERE 1=1`;
    const binds = [];
    if (!status)                   sql += ` AND me.parse_status IN ('parsed','partial')`;
    if (dir === 'credit' || dir === 'debit') { sql += ' AND me.direction=?'; binds.push(dir); }
    if (status === 'unreconciled') sql += ` AND me.reconcile_status='unreconciled' AND me.parse_status='parsed'`;
    if (status === 'reconciled')   sql += ` AND me.reconcile_status IN ('auto','manual')`;
    if (status === 'quarantined')  sql += ` AND me.parse_status IN ('failed','quarantined','partial')`;
    if (instrument)                { sql += ' AND me.instrument=?';          binds.push(instrument); }
    if (brand)                     { sql += ' AND me.brand=?';                binds.push(brand); }
    if (category)                  { sql += ' AND me.category=?';             binds.push(category); }
    if (platform === 'direct')       sql += ' AND me.settlement_platform IS NULL';
    else if (platform)             { sql += ' AND me.settlement_platform=?'; binds.push(platform); }
    if (payeeId)                   { sql += ' AND me.matched_payee_id=?';    binds.push(parseInt(payeeId, 10)); }
    if (dateFrom)                  { sql += ' AND COALESCE(me.txn_at, me.received_at) >= ?'; binds.push(dateFrom); }
    if (dateTo)                    { sql += ' AND COALESCE(me.txn_at, me.received_at) <= ?'; binds.push(dateTo.length === 10 ? dateTo + 'T23:59:59+05:30' : dateTo); }
    if (minAmt)                    { sql += ' AND me.amount_paise >= ?'; binds.push(Math.round(parseFloat(minAmt) * 100)); }
    if (maxAmt)                    { sql += ' AND me.amount_paise <= ?'; binds.push(Math.round(parseFloat(maxAmt) * 100)); }
    if (q) {
      sql += ' AND (me.counterparty LIKE ? OR me.narration LIKE ? OR me.source_ref LIKE ? OR me.counterparty_ref LIKE ?)';
      const needle = '%' + q + '%';
      binds.push(needle, needle, needle, needle);
    }
    sql += ' ORDER BY COALESCE(me.txn_at, me.received_at) DESC, me.id DESC LIMIT 50000';
    const r = await db.prepare(sql).bind(...binds).all();
    const rows = r.results || [];

    const headers = [
      'txn_date', 'received_at', 'account', 'direction',
      'amount_rupees', 'balance_after_rupees',
      'source', 'settlement_platform', 'channel',
      'counterparty', 'counterparty_ref', 'matched_payee',
      'category', 'brand',
      'source_ref', 'narration', 'parse_status', 'reconcile_status',
    ];
    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(',')];
    for (const x of rows) {
      lines.push([
        x.txn_at || '', x.received_at || '',
        x.instrument || '', x.direction || '',
        x.amount_paise != null ? (x.amount_paise / 100).toFixed(2) : '',
        x.balance_paise_after != null ? (x.balance_paise_after / 100).toFixed(2) : '',
        x.source || '', x.settlement_platform || '', x.channel || '',
        x.counterparty || '', x.counterparty_ref || '', x.payee_name || '',
        x.category || '', x.brand || '',
        x.source_ref || '', x.narration || '',
        x.parse_status || '', x.reconcile_status || '',
      ].map(esc).join(','));
    }
    const csv = lines.join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    const filterSuffix = [
      instrument ? instrument.split('_')[0] : null,
      brand, category, platform,
      dir, dateFrom ? 'from-' + dateFrom.slice(0, 10) : null,
    ].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const fname = `hn-money-${stamp}${filterSuffix ? '-' + filterSuffix : ''}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}"`,
        ...corsHeaders(origin),
      },
    });
  }

  if (action === 'filter_options') {
    // Distinct values that can populate UI dropdowns. One round-trip for
    // all dimensions so the client doesn't have to fire 5 queries.
    const [channels, brands, categories, platforms, instruments] = await Promise.all([
      db.prepare(`SELECT DISTINCT channel FROM money_events WHERE channel IS NOT NULL ORDER BY channel`).all(),
      db.prepare(`SELECT DISTINCT brand   FROM money_events WHERE brand   IS NOT NULL ORDER BY brand`).all(),
      db.prepare(`SELECT DISTINCT category FROM money_events WHERE category IS NOT NULL ORDER BY category`).all(),
      db.prepare(`SELECT DISTINCT settlement_platform FROM money_events WHERE settlement_platform IS NOT NULL ORDER BY settlement_platform`).all(),
      db.prepare(`SELECT DISTINCT instrument FROM money_events ORDER BY instrument`).all(),
    ]);
    return json({
      ok: true,
      channels:    (channels.results   || []).map(r => r.channel),
      brands:      (brands.results     || []).map(r => r.brand),
      categories:  (categories.results || []).map(r => r.category),
      platforms:   (platforms.results  || []).map(r => r.settlement_platform),
      instruments: (instruments.results|| []).map(r => r.instrument),
    }, 200, origin);
  }

  if (action === 'summary') {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const d7  = new Date(now.getTime() - 7  * 86400000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const staleAfter = new Date(now.getTime() - 24 * 3600000).toISOString();

    const [latestByInstr, today, week, month, pstatus, health, lastReceived] = await Promise.all([
      // Most recent balance per instrument where balance is exposed.
      db.prepare(`
        SELECT instrument, balance_paise_after AS balance_paise, txn_at
        FROM money_events
        WHERE balance_paise_after IS NOT NULL
          AND parse_status='parsed'
        GROUP BY instrument
        HAVING txn_at = MAX(txn_at)
      `).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(todayStart).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(d7).all(),
      db.prepare(`SELECT direction, SUM(amount_paise) AS total_paise, COUNT(*) AS n
                  FROM money_events
                  WHERE parse_status='parsed' AND COALESCE(txn_at, received_at) >= ?
                  GROUP BY direction`).bind(d30).all(),
      db.prepare(`SELECT parse_status, COUNT(*) AS n
                  FROM money_events GROUP BY parse_status`).all(),
      db.prepare(`SELECT source, instrument, last_event_at,
                         expected_max_gap_minutes, status, notes
                  FROM money_source_health`).all(),
      db.prepare(`SELECT MAX(received_at) AS last_received
                  FROM money_events WHERE parse_status='parsed'`).first(),
    ]);

    // Compute staleness per source: status = 'stale' if last_event_at
    // older than expected_max_gap_minutes, 'silent' if null.
    const healthCooked = (health.results || []).map(h => {
      if (!h.last_event_at) return { ...h, live_status: 'silent' };
      const ageMin = (Date.now() - new Date(h.last_event_at).getTime()) / 60000;
      const live_status = ageMin > h.expected_max_gap_minutes ? 'stale' : 'healthy';
      return { ...h, age_minutes: Math.floor(ageMin), live_status };
    });

    // Top-line stale flag: is any enabled source older than its gap?
    const anyStale = healthCooked.some(h => h.live_status === 'stale' || h.live_status === 'silent');

    return json({
      ok: true,
      user: user.name,
      generated_at: nowIso(),
      balances: (latestByInstr.results || []).map(r => ({
        instrument: r.instrument,
        balance_paise: r.balance_paise,
        balance_rupees: r.balance_paise != null ? r.balance_paise / 100 : null,
        as_of: r.txn_at,
      })),
      today: foldRollup(today.results),
      week:  foldRollup(week.results),
      month: foldRollup(month.results),
      parse_health: Object.fromEntries((pstatus.results || []).map(r => [r.parse_status, r.n])),
      source_health: healthCooked,
      any_source_stale: anyStale,
      last_ingest_at: lastReceived?.last_received || null,
    }, 200, origin);
  }

  if (action === 'unreconciled') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const r = await db.prepare(`
      SELECT id, source, instrument, txn_at, direction, amount_paise,
             counterparty, counterparty_ref, channel, narration, source_ref
      FROM money_events
      WHERE reconcile_status='unreconciled' AND parse_status='parsed'
      ORDER BY COALESCE(txn_at, received_at) DESC LIMIT ?
    `).bind(limit).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  if (action === 'health') {
    const r = await db.prepare(`SELECT * FROM money_source_health`).all();
    return json({ ok: true, rows: r.results || [] }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const user = checkPin(pinFromRequest(request, url), 'ops');
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  const action = url.searchParams.get('action');
  const body = await request.json().catch(() => ({}));

  if (action === 'reconcile') {
    const id = parseInt(body.id, 10);
    if (!id) return json({ ok: false, error: 'missing_id' }, 400, origin);
    const status = body.status;
    if (!['auto', 'manual', 'ignored', 'unreconciled'].includes(status)) {
      return json({ ok: false, error: 'invalid_status' }, 400, origin);
    }
    // Existence + state-transition check.
    const cur = await env.DB.prepare(
      `SELECT reconcile_status, parse_status FROM money_events WHERE id=?`
    ).bind(id).first();
    if (!cur) return json({ ok: false, error: 'not_found' }, 404, origin);
    if (cur.parse_status !== 'parsed') {
      return json({ ok: false, error: 'cannot_reconcile_unparsed_row' }, 400, origin);
    }
    // Only admin can roll back 'reconciled' → 'unreconciled'.
    if (status === 'unreconciled' && user.role !== 'admin') {
      return json({ ok: false, error: 'admin_only_rollback' }, 403, origin);
    }

    const matched_expense_id    = body.matched_expense_id    ? parseInt(body.matched_expense_id, 10)    : null;
    const matched_vendor_bill_id = body.matched_vendor_bill_id ? parseInt(body.matched_vendor_bill_id, 10) : null;
    const matched_payout_platform = body.matched_payout_platform || null;

    await env.DB.prepare(`
      UPDATE money_events
      SET reconcile_status=?, matched_expense_id=?, matched_vendor_bill_id=?,
          matched_payout_platform=?, reconciled_at=?, reconciled_by=?,
          notes=COALESCE(?, notes)
      WHERE id=?
    `).bind(
      status, matched_expense_id, matched_vendor_bill_id,
      matched_payout_platform, nowIso(), user.name,
      body.notes || null, id,
    ).run();
    return json({ ok: true }, 200, origin);
  }

  if (action === 'match_cross_source') {
    // Pair a gross event (e.g. Zomato payout) with a net event (HDFC credit).
    const gross_event_id = parseInt(body.gross_event_id, 10);
    const net_event_id   = parseInt(body.net_event_id, 10);
    if (!gross_event_id || !net_event_id) {
      return json({ ok: false, error: 'missing_event_ids' }, 400, origin);
    }
    const commission_paise = parseInt(body.commission_paise || '0', 10) || 0;
    const tax_paise = parseInt(body.tax_paise || '0', 10) || 0;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO money_recon_matches
        (gross_event_id, net_event_id, commission_paise, tax_paise,
         notes, matched_at, matched_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gross_event_id, net_event_id, commission_paise, tax_paise,
      body.notes || '', nowIso(), user.name,
    ).run();
    // Mark both events as reconciled.
    await env.DB.prepare(`
      UPDATE money_events
      SET reconcile_status='manual', reconciled_at=?, reconciled_by=?
      WHERE id IN (?, ?)
    `).bind(nowIso(), user.name, gross_event_id, net_event_id).run();
    return json({ ok: true }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
}

function foldRollup(rows) {
  const out = { credit_paise: 0, debit_paise: 0, n_credit: 0, n_debit: 0, net_paise: 0 };
  for (const r of rows || []) {
    if (r.direction === 'credit') { out.credit_paise = r.total_paise || 0; out.n_credit = r.n || 0; }
    if (r.direction === 'debit')  { out.debit_paise  = r.total_paise || 0; out.n_debit  = r.n || 0; }
  }
  out.net_paise = out.credit_paise - out.debit_paise;
  out.credit = out.credit_paise / 100;
  out.debit  = out.debit_paise  / 100;
  out.net    = out.net_paise    / 100;
  return out;
}

function nowIso() { return new Date().toISOString(); }
