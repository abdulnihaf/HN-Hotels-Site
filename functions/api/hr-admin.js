/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — HR + Biometric Admin API
 * Route:  /api/hr-admin
 * D1:     DB (hn-hiring) — tables prefixed hr_*
 * Secret: ODOO_API_KEY, CAMS_AUTH_TOKEN (optional — device remote)
 *
 * Design mirrors rm-admin.js:
 *   GET  ?action=employees|employee|attendance|deductions|status|...
 *   POST {action, pin, ...}  — PIN-gated writes + Odoo sync
 *
 * Conventions borrowed from Nihaf's Apps Script:
 *   • pin (string) = biometric ID, maps to hr.employee.pin
 *   • fields_get() cached to skip invalid fields per Odoo version
 *   • search-by-pin dedup before create/update
 *   • archive = active:false, never delete
 *   • Multi-company job fix: HE=1, NCH=10, HQ=false (shared)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ODOO_URL  = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB   = 'main';
const ODOO_USER = 'yash@gmail.com';

// CAMS F38+ biometric device config (mirrors live dashboard)
const CAMS_API_BASE = 'https://www.camsbiometrics.com/api3.0';
const CAMS_DEVICE_SERIAL = 'AYTH09089112';

// PIN-gated access. Only 3 accounts as of Apr 19 2026:
//   • Nihaf  (admin)      — full access including financials + deductions
//   • Basheer (manager)   — full read of attendance + discipline view; NO financials
//   • Zoya   (onboarding) — employee create/edit; same read-view as Basheer
// Farooq/Faheem removed — their HR access was never used.
const PINS = {
  '0305': { name: 'Nihaf',   role: 'admin',      phone: '917010426808', view_financials: true  },
  '8523': { name: 'Basheer', role: 'manager',    phone: '919061906916', view_financials: false },
  '2026': { name: 'Zoya',    role: 'onboarding', phone: null,           view_financials: false },
};

// brand_label → Odoo company_id. HQ maps to HE (company 1, the parent Pvt Ltd)
// because Odoo hr.employee requires a non-null company_id. TBD stays false
// (blocks sync — the user must resolve the brand/role first).
const BRAND_COMPANY = { HE: 1, NCH: 10, HQ: 1, TBD: false };

const MAX_RUNTIME_MS = 25000;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Helpers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Role capability map. Higher rank = more privilege.
//   admin (2)       → everything, including financials
//   onboarding (1.5)→ create/edit employees + same read-view as manager
//   manager (1)     → read attendance + discipline, no financials, no edits
//   read (0)        → legacy (no one assigned today)
// Required capability names align with above.
function checkPin(pin, required = 'read') {
  const u = PINS[pin];
  if (!u) return null;
  const rank = { read: 0, manager: 1, onboarding: 1.5, hr: 1.5, admin: 2 };
  const need = rank[required] ?? 0;
  const have = rank[u.role] ?? 0;
  if (have < need) return null;
  return u;
}

function istDate(d = new Date()) {
  // yyyy-mm-dd in IST
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  return new Date(s);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Odoo JSON-RPC
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

let _uid = null;
let _empFieldCache = null;    // hr.employee valid fields
let _contractFieldCache = null; // hr.contract valid fields

async function rpc(service, method, args) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { service, method, args },
    }),
  });
  const d = await r.json();
  if (d.error) {
    const msg = d.error.data?.message || d.error.message || JSON.stringify(d.error);
    throw new Error(`Odoo: ${msg}`);
  }
  return d.result;
}

async function odooAuth(apiKey) {
  if (_uid) return _uid;
  const uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, apiKey, {}]);
  if (!uid) throw new Error('Odoo auth failed — check ODOO_API_KEY');
  _uid = uid;
  return uid;
}

async function odoo(apiKey, model, method, args = [], kwargs = {}) {
  const uid = await odooAuth(apiKey);
  return rpc('object', 'execute_kw', [ODOO_DB, uid, apiKey, model, method, args, kwargs]);
}

/**
 * Mirror of Apps Script getValidEmployeeFields_() — introspect hr.employee
 * once per isolate to strip unknown fields from write payloads.
 */
async function getValidFields(apiKey, model) {
  const cache = model === 'hr.employee' ? _empFieldCache
              : model === 'hr.contract' ? _contractFieldCache
              : null;
  if (cache) return cache;
  const data = await odoo(apiKey, model, 'fields_get', [], { attributes: ['string', 'type'] });
  const valid = {};
  for (const k of Object.keys(data)) valid[k] = data[k].type;
  if (model === 'hr.employee')   _empFieldCache = valid;
  if (model === 'hr.contract')   _contractFieldCache = valid;
  return valid;
}

function filterFields(vals, validMap) {
  const clean = {}, dropped = [];
  for (const [k, v] of Object.entries(vals)) {
    if (validMap[k] !== undefined) clean[k] = v;
    else dropped.push(k);
  }
  return { clean, dropped };
}

/* ━━━ Sync log ━━━ */

async function logSync(db, action, model, targetId, reference, details, syncedBy, status = 'ok', error = null) {
  await db.prepare(
    `INSERT INTO hr_sync_log (action, target_model, target_id, reference, details, status, error, synced_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    action, model, targetId || null, reference || null,
    JSON.stringify(details || {}), status, error, syncedBy,
  ).run();
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * CAMS Gateway — remote control via Web API 3.0
 * Protocol: POST JSON with AuthToken; response.Status=0 = success.
 * Commands per CAMS F38+ "Hawking Plus" documentation:
 *   DeleteUser, ClearUserData, ClearAttLogs, ClearAll, Reboot,
 *   SetDeviceInfo, GetUserData, GetAttLogs.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function camsCommand(serial, token, cmd, params = {}) {
  if (!token) throw new Error('CAMS_AUTH_TOKEN not configured');
  const payload = {
    AuthToken: token,
    Command: cmd,
    Device: serial,
    ...params,
  };
  const r = await fetch(`${CAMS_API_BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`CAMS HTTP ${r.status}: ${text.slice(0, 200)}`);
  if (data.Status !== undefined && data.Status !== 0) {
    throw new Error(`CAMS ${cmd} failed: ${data.Message || JSON.stringify(data)}`);
  }
  return data;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * GET handlers — D1 reads (no auth)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handleGet(url, env) {
  const db = env.DB;
  const action = url.searchParams.get('action');

  // --- Roster list (optional filters) ---
  if (action === 'employees') {
    const brand = url.searchParams.get('brand');           // HE | NCH | HQ | TBD | all
    const active = url.searchParams.get('active') ?? '1';  // '1' | '0' | 'all'
    const syncStatus = url.searchParams.get('sync_status');
    let q = 'SELECT * FROM hr_employees WHERE 1=1';
    const p = [];
    if (active !== 'all') { q += ' AND is_active = ?'; p.push(parseInt(active)); }
    if (brand && brand !== 'all') { q += ' AND brand_label = ?'; p.push(brand); }
    if (syncStatus) { q += ' AND sync_status = ?'; p.push(syncStatus); }
    q += ' ORDER BY brand_label, row_no, name';
    const rows = await db.prepare(q).bind(...p).all();
    return json({ employees: rows.results, count: rows.results.length });
  }

  // --- Single employee ---
  if (action === 'employee') {
    const id = url.searchParams.get('id');
    const pin = url.searchParams.get('pin');
    if (!id && !pin) return json({ error: 'id or pin required' }, 400);
    const row = id
      ? await db.prepare('SELECT * FROM hr_employees WHERE id=?').bind(parseInt(id)).first()
      : await db.prepare('SELECT * FROM hr_employees WHERE pin=?').bind(pin).first();
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ employee: row });
  }

  // --- Shift rules ---
  if (action === 'shift-rules') {
    const rows = await db.prepare('SELECT * FROM hr_shift_rules ORDER BY brand_label, pay_type').all();
    return json({ rules: rows.results });
  }

  // --- Attendance for one employee (date range) ---
  if (action === 'attendance') {
    const pin = url.searchParams.get('pin');
    const from = url.searchParams.get('from') || istDate();
    const to = url.searchParams.get('to') || from;
    if (!pin) return json({ error: 'pin required' }, 400);
    const rows = await db.prepare(
      'SELECT * FROM hr_attendance_daily WHERE pin=? AND date BETWEEN ? AND ? ORDER BY date'
    ).bind(pin, from, to).all();
    return json({ pin, from, to, days: rows.results });
  }

  // --- Daily attendance roll-up for a date ---
  //   Accepts: date=YYYY-MM-DD, brand=HE|NCH|HQ (optional), pin=XXXX (optional,
  //     redacts financials if user is not admin).
  //   Enriches each row with a computed `break_warning` (no_break/short_break/
  //     long_break/null) so the UI + digest don't need to re-derive.
  if (action === 'attendance-daily') {
    const date = url.searchParams.get('date') || istDate();
    const brand = url.searchParams.get('brand');
    const viewerPin = url.searchParams.get('pin');
    const viewer = viewerPin ? PINS[viewerPin] : null;
    const redact = viewer ? !viewer.view_financials : false;

    let q = `SELECT a.*, e.name, e.known_as, e.pin as emp_pin, e.brand_label, e.pay_type,
                    e.monthly_salary, e.daily_rate, e.job_name, e.department_name
             FROM hr_attendance_daily a
             JOIN hr_employees e ON e.id = a.employee_id
             WHERE a.date = ? AND e.is_active = 1`;
    const params = [date];
    if (brand) { q += ' AND e.brand_label = ?'; params.push(brand); }
    q += ' ORDER BY e.brand_label, e.name';

    const rows = await db.prepare(q).bind(...params).all();
    const enriched = (rows.results || []).map(r => {
      const punches = (() => { try { return JSON.parse(r.raw_punches_json || '[]'); } catch { return []; } })();
      const bi = computeBreakGap(punches);
      const warning = breakWarning(r.total_hours || 0, bi.minutes, bi.outliers);
      const out = {
        ...r,
        break_warning: warning,
        break_outliers: bi.outliers,
        break_taken_minutes: bi.minutes,
        break_start_at: bi.start,
        break_end_at: bi.end,
      };
      if (redact) {
        out.monthly_salary = null;
        out.daily_rate = null;
        out.deducted_amount = null;
      }
      return out;
    });
    return json({ date, brand: brand || 'all', viewer: viewer?.name || null, rows: enriched, count: enriched.length });
  }

  // --- Daily digest (WhatsApp-ready text for Nihaf + Basheer) ---
  //   GET ?action=digest&date=YYYY-MM-DD&brand=HE|NCH&mode=recap|no_show
  //   recap   → yesterday summary (who worked what, issues)
  //   no_show → mid-day check for today (who hasn't punched yet after shift open)
  if (action === 'digest') {
    const date = url.searchParams.get('date') || istDate();
    const brand = url.searchParams.get('brand') || 'HE';
    const mode = url.searchParams.get('mode') || 'recap';
    const viewerPin = url.searchParams.get('pin');
    const viewer = viewerPin ? PINS[viewerPin] : null;
    const includeFin = viewer ? !!viewer.view_financials : false;

    const digest = await buildDigest(db, brand, date, mode, includeFin);
    return json({ brand, date, mode, ...digest });
  }

  // --- Settlement sheet — full-day attendance closure, HTML for print/PDF ---
  //   GET ?action=settlement&date=YYYY-MM-DD&pin=XXXX
  //   Returns HTML formatted for A4 print (Cmd+P → Save as PDF).
  //   Shows: every active employee, grouped by brand → department, with in/out,
  //   worked hours, break details, status, and space for manager sign-off.
  //   Financials (deductions) only shown if viewer is admin.
  if (action === 'settlement') {
    const date = url.searchParams.get('date') || shiftDayDelta(istDate(), -1);
    const viewerPin = url.searchParams.get('pin');
    const viewer = viewerPin ? PINS[viewerPin] : null;
    const includeFin = viewer ? !!viewer.view_financials : false;

    const rows = (await db.prepare(
      `SELECT a.*, e.name, e.known_as, e.pin as emp_pin, e.brand_label, e.pay_type,
              e.monthly_salary, e.daily_rate, e.job_name, e.department_name, e.row_no
         FROM hr_employees e
         LEFT JOIN hr_attendance_daily a ON a.employee_id = e.id AND a.date = ?
        WHERE e.is_active = 1
        ORDER BY e.brand_label, e.department_name, e.row_no, e.name`
    ).bind(date).all()).results || [];

    const enriched = rows.map(r => {
      const pairs = (() => { try { return JSON.parse(r.raw_punches_json || '[]'); } catch { return []; } })();
      const bi = pairs.length ? computeBreakGap(pairs) : { minutes: 0, start: null, end: null, outliers: [] };
      return {
        ...r,
        status: r.status || 'absent',
        pairs,
        break_minutes: bi.minutes,
        break_start: bi.start,
        break_end: bi.end,
        break_warning: breakWarning(r.total_hours || 0, bi.minutes, bi.outliers),
        long_break_outliers: bi.outliers || [],
      };
    });

    const t = (iso) => iso ? iso.slice(11, 16) : '—';
    const hm = (min) => {
      if (!min) return '—';
      const h = Math.floor(min / 60), m = min % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const sessionSummary = (r) => {
      const p = r.pairs;
      if (!p.length) return '—';
      const last = p[p.length - 1], first = p[0];
      if (p.length === 1 && !last.out) return `In ${t(first.in)} · open`;
      if (p.length === 1) return `${t(first.in)} → ${t(last.out)}`;
      if (!last.out) return `${t(first.in)} → ${t(p[0].out)} · break ${hm(r.break_minutes)} · back ${t(last.in)} (open)`;
      return `${t(first.in)} → ${t(last.out)}${r.break_minutes ? ` · break ${hm(r.break_minutes)}` : ''}`;
    };
    const statusLabel = {
      present: 'PRESENT', absent: 'ABSENT', half: 'HALF', ghost: 'GHOST',
      pending: 'OPEN', week_off: 'WEEK-OFF', leave: 'LEAVE',
    };
    const statusColor = {
      present: '#0e7c4a', absent: '#b42318', half: '#b54708', ghost: '#6941c6',
      pending: '#b54708', week_off: '#667085', leave: '#175cd3',
    };
    const warningIcon = (w) => {
      if (!w) return '';
      if (w === 'no_break') return '<span style="color:#b54708">⚠ No break</span>';
      if (w === 'short_break') return '<span style="color:#b54708">⚠ Short break</span>';
      if (w === 'long_break') return '<span style="color:#b54708">⚠ Long gap</span>';
      return '';
    };

    // Group: brand → department
    const byBrand = {};
    for (const r of enriched) {
      const b = r.brand_label || 'OTHER';
      const d = r.department_name || 'Unassigned';
      if (!byBrand[b]) byBrand[b] = {};
      if (!byBrand[b][d]) byBrand[b][d] = [];
      byBrand[b][d].push(r);
    }
    const BRAND_FULL = { HE: 'Hamza Express', NCH: 'Nawabi Chai House', HQ: 'HN Hotels (HQ · Office)' };

    // KPI summary
    const counts = { present: 0, absent: 0, half: 0, ghost: 0, pending: 0, leave: 0, week_off: 0 };
    let brkIssues = 0, totalDed = 0;
    for (const r of enriched) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.break_warning) brkIssues++;
      if (includeFin) totalDed += Number(r.deducted_amount) || 0;
    }

    let html = `<!doctype html><html><head><meta charset="utf-8">
<title>Attendance Settlement — ${date}</title>
<style>
  @media print { body { margin: 0 } .no-print { display: none } @page { size: A4; margin: 12mm } }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111; font-size: 12px }
  h1 { font-size: 20px; margin: 0 0 4px }
  .sub { color: #555; font-size: 11px; margin-bottom: 18px }
  .meta { display: flex; gap: 24px; margin-bottom: 16px; flex-wrap: wrap }
  .meta-item { }
  .meta-item .k { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: #777 }
  .meta-item .v { font-size: 16px; font-weight: 700 }
  .brand-h { background: #111; color: #fff; padding: 6px 10px; margin: 20px 0 4px; border-radius: 4px; font-weight: 700 }
  .dept-h { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #555; margin: 10px 0 4px }
  table { width: 100%; border-collapse: collapse; font-size: 11px }
  th, td { border: 0.5px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top }
  th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: .3px }
  .status { font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 3px; color: #fff; display: inline-block }
  .warn { color: #b54708; font-size: 10px }
  .sig-block { margin-top: 36px; display: flex; gap: 60px }
  .sig { flex: 1 }
  .sig .line { border-top: 1px solid #333; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #555 }
  .toolbar { position: fixed; top: 8px; right: 8px }
  .toolbar button { background: #111; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px }
</style></head><body>
<div class="toolbar no-print"><button onclick="window.print()">⬇ Print / Save as PDF</button></div>
<h1>Attendance Settlement — ${date}</h1>
<div class="sub">HN Hotels Pvt Ltd · Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · Viewer: ${viewer?.name || 'unknown'}</div>
<div class="meta">
  <div class="meta-item"><div class="k">Roster</div><div class="v">${enriched.length}</div></div>
  <div class="meta-item"><div class="k">Present</div><div class="v" style="color:#0e7c4a">${counts.present}</div></div>
  <div class="meta-item"><div class="k">Absent</div><div class="v" style="color:#b42318">${counts.absent}</div></div>
  <div class="meta-item"><div class="k">Half-day</div><div class="v" style="color:#b54708">${counts.half}</div></div>
  <div class="meta-item"><div class="k">Ghost</div><div class="v" style="color:#6941c6">${counts.ghost}</div></div>
  <div class="meta-item"><div class="k">Open</div><div class="v" style="color:#b54708">${counts.pending}</div></div>
  <div class="meta-item"><div class="k">Week off</div><div class="v" style="color:#667085">${counts.week_off}</div></div>
  <div class="meta-item"><div class="k">Break issues</div><div class="v" style="color:#b54708">${brkIssues}</div></div>
  ${includeFin ? `<div class="meta-item"><div class="k">Deductions</div><div class="v" style="color:#b42318">₹${totalDed.toLocaleString('en-IN')}</div></div>` : ''}
</div>`;

    for (const brand of ['HE','NCH','HQ']) {
      if (!byBrand[brand]) continue;
      html += `<div class="brand-h">${BRAND_FULL[brand]}</div>`;
      for (const dept of Object.keys(byBrand[brand]).sort()) {
        html += `<div class="dept-h">${escapeHtml(dept)}</div>`;
        html += `<table><thead><tr>
          <th style="width:26px">#</th>
          <th>Name</th>
          <th>Role</th>
          <th>Shift</th>
          <th style="width:50px">Hours</th>
          <th style="width:80px">Status</th>
          <th>Break / issues</th>
          ${includeFin ? '<th style="width:70px">Deduct ₹</th>' : ''}
          <th style="width:80px">Manager note</th>
        </tr></thead><tbody>`;
        for (const r of byBrand[brand][dept]) {
          const name = r.known_as && r.known_as !== r.name ? `${escapeHtml(r.name)} (${escapeHtml(r.known_as)})` : escapeHtml(r.name);
          const hrs = r.total_hours ? (r.total_hours || 0).toFixed(1) + 'h' : '—';
          const warn = warningIcon(r.break_warning) || (r.break_start && r.break_end ? `☕ ${t(r.break_start)}–${t(r.break_end)} (${hm(r.break_minutes)})` : '');
          const ded = (r.deducted_amount) ? `₹${Number(r.deducted_amount).toLocaleString('en-IN')}` : '—';
          html += `<tr>
            <td>${r.emp_pin || '—'}</td>
            <td><strong>${name}</strong></td>
            <td>${escapeHtml(r.job_name || '—')}</td>
            <td>${sessionSummary(r)}</td>
            <td>${hrs}</td>
            <td><span class="status" style="background:${statusColor[r.status] || '#666'}">${statusLabel[r.status] || r.status.toUpperCase()}</span></td>
            <td>${warn || ''}${r.deduction_reason ? `<div class="warn">${escapeHtml(r.deduction_reason)}</div>` : ''}</td>
            ${includeFin ? `<td>${ded}</td>` : ''}
            <td></td>
          </tr>`;
        }
        html += '</tbody></table>';
      }
    }

    html += `
<div class="sig-block">
  <div class="sig"><div class="line">Basheer — GM Sales & Marketing</div></div>
  <div class="sig"><div class="line">Nihaf — MD</div></div>
</div>
<p style="font-size:9px;color:#888;margin-top:30px">
  Biometric source: CAMS F38+ (AYTH09089112) · Shift-day rules: HE 09:00→06:00 next · NCH 06:00→06:00 next · HQ 09:00→09:00 next. Break qualifying window 30–300 min. This settlement reflects the system's reading; use the Manager note column for corrections.
</p>
</body></html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } });
  }

  // --- Deductions for a month (YYYY-MM) ---
  if (action === 'deductions') {
    const month = url.searchParams.get('month') || istDate().slice(0, 7);
    const rows = await db.prepare(
      `SELECT e.id, e.pin, e.name, e.brand_label, e.pay_type, e.monthly_salary, e.daily_rate,
              COUNT(CASE WHEN a.status='present' THEN 1 END) AS days_present,
              COUNT(CASE WHEN a.status='half'    THEN 1 END) AS days_half,
              COUNT(CASE WHEN a.status='absent'  THEN 1 END) AS days_absent,
              COUNT(CASE WHEN a.status='ghost'   THEN 1 END) AS days_ghost,
              COUNT(CASE WHEN a.status='week_off' THEN 1 END) AS days_off,
              COUNT(CASE WHEN a.status='leave'   THEN 1 END) AS days_leave,
              COALESCE(SUM(a.deducted_amount), 0) AS total_deducted,
              SUM(a.total_hours) AS total_hours
       FROM hr_employees e
       LEFT JOIN hr_attendance_daily a
         ON a.employee_id = e.id AND substr(a.date,1,7) = ?
       WHERE e.is_active = 1
       GROUP BY e.id
       ORDER BY e.brand_label, e.row_no, e.name`
    ).bind(month).all();
    return json({ month, rows: rows.results, count: rows.results.length });
  }

  // --- Leaves ---
  if (action === 'leaves') {
    const pin = url.searchParams.get('pin');
    let q = `SELECT l.*, e.name, e.brand_label FROM hr_leaves l
             JOIN hr_employees e ON e.id = l.employee_id`;
    const p = [];
    if (pin) { q += ' WHERE l.pin = ?'; p.push(pin); }
    q += ' ORDER BY l.start_date DESC';
    const rows = await db.prepare(q).bind(...p).all();
    return json({ leaves: rows.results });
  }

  // --- Sync log (recent) ---
  if (action === 'sync-log') {
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const rows = await db.prepare(
      'SELECT * FROM hr_sync_log ORDER BY created_at DESC LIMIT ?'
    ).bind(limit).all();
    return json({ log: rows.results });
  }

  // --- CAMS device registry + live status (if admin pin) ---
  if (action === 'cams-devices') {
    const rows = await db.prepare('SELECT * FROM hr_cams_devices WHERE is_active=1 ORDER BY serial_number').all();
    return json({ devices: rows.results });
  }


  // --- Status dashboard ---
  if (action === 'status') {
    const [total, active, synced, unsynced, pendingBio, byBrand, byPayType, lastSync, attendToday, leavesOpen] =
      await Promise.all([
        db.prepare('SELECT COUNT(*) as c FROM hr_employees').first(),
        db.prepare('SELECT COUNT(*) as c FROM hr_employees WHERE is_active=1').first(),
        db.prepare("SELECT COUNT(*) as c FROM hr_employees WHERE is_active=1 AND sync_status='Synced'").first(),
        db.prepare("SELECT COUNT(*) as c FROM hr_employees WHERE is_active=1 AND sync_status!='Synced'").first(),
        db.prepare('SELECT COUNT(*) as c FROM hr_employees WHERE is_active=1 AND (pin IS NULL OR pin = "")').first(),
        db.prepare('SELECT brand_label, COUNT(*) as c FROM hr_employees WHERE is_active=1 GROUP BY brand_label').all(),
        db.prepare('SELECT pay_type, COUNT(*) as c FROM hr_employees WHERE is_active=1 GROUP BY pay_type').all(),
        db.prepare('SELECT * FROM hr_sync_log ORDER BY created_at DESC LIMIT 1').first(),
        db.prepare('SELECT status, COUNT(*) as c FROM hr_attendance_daily WHERE date=? GROUP BY status').bind(istDate()).all(),
        db.prepare('SELECT COUNT(*) as c FROM hr_leaves WHERE end_date >= date("now")').first(),
      ]);
    return json({
      employees: { total: total.c, active: active.c, synced: synced.c, unsynced: unsynced.c, pending_bio: pendingBio.c },
      by_brand: byBrand.results,
      by_pay_type: byPayType.results,
      attendance_today: { date: istDate(), breakdown: attendToday.results },
      leaves_open: leavesOpen.c,
      last_sync: lastSync,
    });
  }

  // --- Department / Job maps (for UI pickers) ---
  if (action === 'maps') {
    const [companies, depts, jobs] = await Promise.all([
      db.prepare('SELECT * FROM hr_company_map ORDER BY brand_label').all(),
      db.prepare('SELECT * FROM hr_department_map ORDER BY company_id, name').all(),
      db.prepare('SELECT * FROM hr_job_map ORDER BY company_id, name').all(),
    ]);
    return json({
      companies: companies.results,
      departments: depts.results,
      jobs: jobs.results,
    });
  }

  // --- Raw CAMS biometric punches for audit ---
  // Returns all punches from hr_cams_punches for a calendar date range,
  // joined with employee name + brand. Used by /ops/attendance-audit/.
  if (action === 'cams-punches') {
    const date  = url.searchParams.get('date') || istDate();
    const days  = Math.min(parseInt(url.searchParams.get('days') || '2', 10), 7);
    // Build date range: from (date - days + 1) to date, so default = yesterday + today
    const endDate   = date;
    const startDate = (() => {
      const d = new Date(date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - (days - 1));
      return d.toISOString().slice(0, 10);
    })();
    const rows = await db.prepare(`
      SELECT p.pin, p.punch_time, p.punch_type, p.device_serial, p.source,
             e.name, e.brand_label, e.row_no, e.job_name
      FROM hr_cams_punches p
      LEFT JOIN hr_employees e ON e.pin = p.pin AND e.is_active = 1
      WHERE p.punch_time >= ? AND p.punch_time < ?
      ORDER BY p.punch_time ASC
    `).bind(startDate + ' 00:00:00', endDate + ' 23:59:59' ).all();

    // Also load shift rules so the UI can show which shift-day each punch belongs to
    const rules = await db.prepare('SELECT brand_label, shift_day_start_hour FROM hr_shift_rules GROUP BY brand_label').all();
    const shiftHours = {};
    for (const r of rules.results) shiftHours[r.brand_label] = r.shift_day_start_hour || 0;

    return json({ date, startDate, endDate, shiftHours, punches: rows.results, count: rows.results.length });
  }

  return json({
    error: 'Unknown action',
    actions: [
      'employees', 'employee', 'shift-rules',
      'attendance', 'attendance-daily', 'deductions',
      'leaves', 'sync-log', 'cams-devices', 'maps', 'status', 'cams-punches',
    ],
  }, 400);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * POST handlers — PIN-gated
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handlePost(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { action, pin } = body;
  if (!action) return json({ error: 'Missing action' }, 400);

  // Internal service-to-service call bypass.
  //   /api/cams-ingest fires pull-attendance after every punch lands.
  //   Passing service_key = env.CAMS_AUTH_TOKEN authorises as admin.
  //   Using CAMS_AUTH_TOKEN (already a tightly-held secret) avoids adding
  //   a new secret to the hn-hotels-site Pages project.
  if (body.service_key && env.CAMS_AUTH_TOKEN && body.service_key === env.CAMS_AUTH_TOKEN) {
    // Skip PIN check; treat as admin for audit logging
    body._service_user = { name: 'cams-ingest', role: 'admin', view_financials: true };
  }

  // Permission matrix — minimum role required per action.
  //   manager (Basheer)   → view + trigger attendance pull + send digest
  //   onboarding (Zoya)   → manager + create/edit employees
  //   hr                  → legacy (no one today, retained for compat)
  //   admin (Nihaf)       → everything including financial / destructive ops
  const permMap = {
    // Manager-level: Basheer can trigger these from the dashboard
    'pull-attendance':   'manager',  // refresh today's attendance
    'digest-send':       'manager',  // send WhatsApp digest to self+Nihaf

    // Onboarding-level: Zoya (and above) can create/edit employees
    'employee-upsert':   'onboarding',
    'leave-add':         'onboarding',
    'pull-maps':         'onboarding',
    'sync-employee':     'onboarding',
    'rescan-drive':      'onboarding',
    'cams-pull-users':   'onboarding',

    // Admin-only: financial + destructive + shift-rule edits
    'employee-archive':    'admin',
    'shift-rules-upsert':  'admin',
    'leave-approve':       'admin',
    'sync-all-employees':  'admin',
    'compute-deductions':  'admin',
    'cams-device-upsert':  'admin',
    'cams-remote':         'admin',
  };
  const need = permMap[action] || 'read';
  const user = body._service_user || checkPin(pin, need);
  if (!user) return json({ error: `${need} PIN required` }, 403);

  /* ━━━━━━━━━━ D1 roster writes ━━━━━━━━━━ */

  if (action === 'employee-upsert') {
    const e = body;
    if (!e.name) return json({ error: 'name required' }, 400);
    if (e.pin) {
      // dedup by pin — if taken by a different row_no, refuse
      const clash = await db.prepare('SELECT id, name, row_no FROM hr_employees WHERE pin=?').bind(e.pin).first();
      if (clash && clash.id && (!e.id || parseInt(e.id) !== clash.id)) {
        return json({ error: `PIN ${e.pin} already used by ${clash.name} (row ${clash.row_no})` }, 409);
      }
    }

    if (e.id) {
      // UPDATE
      const allow = [
        'pin','row_no','name','name_legal','known_as','company_id','brand_label',
        'department_name','job_name','pay_type','monthly_salary','daily_rate',
        'start_date','phone','aadhaar_last4','aadhaar_full','dob','gender',
        'address','emergency_contact','emergency_phone','notes','bio_enrolled',
        // Aadhar / PAN / barcode (Drive-backed)
        'aadhar_number','aadhar_dob',
        'aadhar_front_drive_id','aadhar_back_drive_id','pan_drive_id',
        'barcode_value','barcode_drive_id','drive_folder_id',
      ];
      const sets = [], vals = [];
      for (const k of allow) {
        if (e[k] !== undefined) { sets.push(`${k}=?`); vals.push(e[k]); }
      }
      if (!sets.length) return json({ error: 'No fields to update' }, 400);
      sets.push("updated_at=datetime('now')");
      sets.push("sync_status='Pending'");
      vals.push(parseInt(e.id));
      await db.prepare(`UPDATE hr_employees SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
      await logSync(db, 'update_employee', 'hr_employees', parseInt(e.id), e.name, { fields: Object.keys(e) }, user.name);
      return json({ success: true, id: parseInt(e.id) });
    }

    // INSERT
    const ins = await db.prepare(
      `INSERT INTO hr_employees
       (pin, row_no, name, known_as, company_id, brand_label, department_name, job_name,
        pay_type, monthly_salary, daily_rate, start_date, phone, aadhaar_last4, aadhaar_full,
        dob, gender, address, emergency_contact, emergency_phone, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      e.pin || null, e.row_no || null, e.name, e.known_as || null,
      e.company_id || null, e.brand_label || 'TBD',
      e.department_name || null, e.job_name || null,
      e.pay_type || 'Monthly', e.monthly_salary || 0, e.daily_rate || null,
      e.start_date || null, e.phone || null, e.aadhaar_last4 || null, e.aadhaar_full || null,
      e.dob || null, e.gender || null, e.address || null,
      e.emergency_contact || null, e.emergency_phone || null, e.notes || null,
    ).run();
    await logSync(db, 'create_employee', 'hr_employees', ins.meta?.last_row_id, e.name, { pin: e.pin }, user.name);
    return json({ success: true, id: ins.meta?.last_row_id });
  }

  /* ━━━ Re-scan Drive folder for new Aadhar/PAN/barcode files ━━━ */
  if (action === 'rescan-drive') {
    const ROOT = env.GDRIVE_HR_ROOT || '1IYoyfhByBR9_2n59Z5U-R_5rMeRnqufQ';
    try {
      const token = await getGDriveToken(env);
      const list = (q) => fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());

      const brandFolders = await list(`'${ROOT}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`);
      let matched = 0; const updates = [];
      for (const bf of (brandFolders.files || [])) {
        if (bf.name.startsWith('_')) continue;
        const staffFolders = await list(`'${bf.id}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`);
        for (const sf of (staffFolders.files || [])) {
          const files = await list(`'${sf.id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
          const fields = { drive_folder_id: sf.id };
          for (const f of (files.files || [])) {
            const n = f.name.toLowerCase();
            if (n.startsWith('aadhar-front')) fields.aadhar_front_drive_id = f.id;
            else if (n.startsWith('aadhar-back')) fields.aadhar_back_drive_id = f.id;
            else if (n.startsWith('pan')) fields.pan_drive_id = f.id;
            else if (n.startsWith('barcode')) fields.barcode_drive_id = f.id;
          }
          const sets = Object.keys(fields).map(k => `${k}=?`).join(', ');
          const vals = [...Object.values(fields), sf.name, sf.name];
          const res = await db.prepare(
            `UPDATE hr_employees SET ${sets} WHERE name_legal=? OR name=?`
          ).bind(...vals).run();
          if (res.meta?.changes) { matched += res.meta.changes; updates.push({ name: sf.name, fields: Object.keys(fields) }); }
        }
      }
      return json({ success: true, matched, updates: updates.slice(0, 10) });
    } catch (e) {
      return json({ error: 'Drive scan failed: ' + e.message }, 500);
    }
  }

  if (action === 'employee-archive') {
    const { id, reason } = body;
    if (!id) return json({ error: 'id required' }, 400);
    const emp = await db.prepare('SELECT * FROM hr_employees WHERE id=?').bind(parseInt(id)).first();
    if (!emp) return json({ error: 'Not found' }, 404);

    // D1 archive
    await db.prepare(
      `UPDATE hr_employees
       SET is_active=0, archived_at=datetime('now'), archive_reason=?,
           sync_status='Archived', updated_at=datetime('now')
       WHERE id=?`
    ).bind(reason || 'archived via hr-admin', parseInt(id)).run();

    // Odoo archive if synced
    const apiKey = env.ODOO_API_KEY;
    let odooResult = null;
    if (apiKey && emp.odoo_employee_id) {
      try {
        await odoo(apiKey, 'hr.employee', 'write', [[emp.odoo_employee_id], { active: false }]);
        odooResult = { archived_odoo_id: emp.odoo_employee_id };
      } catch (err) {
        odooResult = { error: err.message };
      }
    }
    await logSync(db, 'archive_employee', 'hr.employee', emp.odoo_employee_id || null, emp.name,
      { reason, d1_id: parseInt(id), odoo: odooResult }, user.name);
    return json({ success: true, id: parseInt(id), odoo: odooResult });
  }

  if (action === 'shift-rules-upsert') {
    const { brand_label, pay_type, ...rest } = body;
    if (!brand_label || !pay_type) return json({ error: 'brand_label + pay_type required' }, 400);
    const allow = ['min_daily_hours','expected_daily_hours','full_day_threshold','half_day_threshold',
                   'allow_single_punch','week_off','applies_to_office'];
    const sets = [], vals = [];
    for (const k of allow) if (rest[k] !== undefined) { sets.push(`${k}=?`); vals.push(rest[k]); }
    if (!sets.length) return json({ error: 'No fields' }, 400);

    // upsert: try update, if 0 rows insert
    const existing = await db.prepare(
      'SELECT id FROM hr_shift_rules WHERE brand_label=? AND pay_type=?'
    ).bind(brand_label, pay_type).first();

    if (existing) {
      sets.push("updated_at=datetime('now')");
      vals.push(existing.id);
      await db.prepare(`UPDATE hr_shift_rules SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
    } else {
      const cols = ['brand_label','pay_type', ...allow.filter(k => rest[k] !== undefined)];
      const v = [brand_label, pay_type, ...allow.filter(k => rest[k] !== undefined).map(k => rest[k])];
      await db.prepare(`INSERT INTO hr_shift_rules (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .bind(...v).run();
    }
    await logSync(db, 'upsert_shift_rule', 'hr_shift_rules', null, `${brand_label}/${pay_type}`, rest, user.name);
    return json({ success: true });
  }

  if (action === 'leave-add') {
    const { pin: empPin, start_date, end_date, leave_type, reason } = body;
    if (!empPin || !start_date || !end_date) return json({ error: 'pin, start_date, end_date required' }, 400);
    const emp = await db.prepare('SELECT id, name FROM hr_employees WHERE pin=?').bind(empPin).first();
    if (!emp) return json({ error: 'Employee not found' }, 404);
    await db.prepare(
      `INSERT INTO hr_leaves (employee_id, pin, start_date, end_date, leave_type, reason)
       VALUES (?,?,?,?,?,?)`
    ).bind(emp.id, empPin, start_date, end_date, leave_type || 'unpaid', reason || null).run();
    await logSync(db, 'add_leave', 'hr_leaves', emp.id, emp.name, { start_date, end_date, leave_type }, user.name);
    return json({ success: true });
  }

  if (action === 'leave-approve') {
    const { id } = body;
    if (!id) return json({ error: 'id required' }, 400);
    await db.prepare('UPDATE hr_leaves SET approved=1, approved_by=? WHERE id=?').bind(user.name, parseInt(id)).run();
    return json({ success: true });
  }

  /* ━━━━━━━━━━ Odoo sync ━━━━━━━━━━ */

  if (action === 'pull-maps') {
    // Pull hr.department and hr.job from Odoo → cache into hr_department_map / hr_job_map
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);
    try {
      const [depts, jobs] = await Promise.all([
        odoo(apiKey, 'hr.department', 'search_read', [[]],
          { fields: ['id','name','company_id','parent_id'] }),
        odoo(apiKey, 'hr.job', 'search_read', [[['active','=',true]]],
          { fields: ['id','name','company_id','department_id'] }),
      ]);

      await db.prepare('DELETE FROM hr_department_map').run();
      for (const d of depts) {
        const cid = d.company_id && d.company_id[0] ? String(d.company_id[0]) : null;
        const pid = d.parent_id && d.parent_id[0] ? d.parent_id[0] : null;
        await db.prepare(
          `INSERT OR REPLACE INTO hr_department_map (name, company_id, odoo_department_id, odoo_parent_id) VALUES (?,?,?,?)`
        ).bind(d.name, cid, d.id, pid).run();
      }

      await db.prepare('DELETE FROM hr_job_map').run();
      for (const j of jobs) {
        const cid = j.company_id && j.company_id[0] ? String(j.company_id[0]) : null;
        await db.prepare(
          `INSERT OR REPLACE INTO hr_job_map (name, company_id, odoo_job_id) VALUES (?,?,?)`
        ).bind(j.name, cid, j.id).run();
      }

      await logSync(db, 'pull_maps', 'hr.department+hr.job', null, 'refresh',
        { departments: depts.length, jobs: jobs.length }, user.name);
      return json({ success: true, departments: depts.length, jobs: jobs.length });
    } catch (e) {
      await logSync(db, 'pull_maps', null, null, null, { error: e.message }, user.name, 'error', e.message);
      return json({ error: e.message }, 500);
    }
  }

  if (action === 'sync-employee' || action === 'sync-all-employees') {
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);

    // Options (sync-all-employees only):
    //   batch_size     default 8   — keeps subrequests well under CF per-invocation cap
    //   offset         default 0   — paginate; frontend loops until done
    //   only_unsynced  default 0   — if true, skip already-synced rows
    //   with_contracts default 0   — if true, also create/update hr.contract
    const batchSize = Math.max(1, Math.min(50, parseInt(body.batch_size) || 8));
    const offset = Math.max(0, parseInt(body.offset) || 0);
    const onlyUnsynced = !!body.only_unsynced;
    const withContracts = !!body.with_contracts;

    let targets = [];
    let total = 0;
    if (action === 'sync-employee') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const row = await db.prepare('SELECT * FROM hr_employees WHERE id=?').bind(parseInt(id)).first();
      if (!row) return json({ error: 'Not found' }, 404);
      targets = [row];
      total = 1;
    } else {
      // only_unsynced also filters out rows that will definitely fail: no pin,
      // or TBD brand. These need human action before a retry is useful.
      const where = onlyUnsynced
        ? "is_active=1 AND brand_label != 'TBD' AND pin IS NOT NULL AND pin != '' AND (sync_status != 'Synced' OR sync_status IS NULL)"
        : "is_active=1 AND brand_label != 'TBD'";
      const tot = await db.prepare(`SELECT COUNT(*) AS c FROM hr_employees WHERE ${where}`).first();
      total = tot?.c || 0;
      const r = await db.prepare(
        `SELECT * FROM hr_employees WHERE ${where} ORDER BY brand_label, row_no LIMIT ? OFFSET ?`
      ).bind(batchSize, offset).all();
      targets = r.results || [];
    }

    // Pre-load dept + job maps once per invocation to save per-employee D1 lookups.
    const maps = await loadHrMaps(db);

    const results = { created: 0, updated: 0, errors: 0, details: [] };
    const start = Date.now();

    for (const emp of targets) {
      if (Date.now() - start > MAX_RUNTIME_MS) {
        results.details.push({ name: emp.name, skipped: 'timeout' });
        break;
      }
      try {
        const r = await syncOneEmployee(apiKey, db, emp, user.name, { maps, withContracts });
        if (r.created) results.created++;
        else if (r.updated) results.updated++;
        results.details.push({ name: emp.name, pin: emp.pin, ...r });
      } catch (err) {
        results.errors++;
        await db.prepare(
          `UPDATE hr_employees SET sync_status='Error', sync_error=? WHERE id=?`
        ).bind(err.message, emp.id).run();
        // Skip per-error logSync to conserve subrequests; bulk log at end
        results.details.push({ name: emp.name, pin: emp.pin, error: err.message });
      }
    }

    // One sync-log row per batch instead of per-employee
    await logSync(db, 'sync_batch', 'hr.employee', null,
      `batch offset=${offset} size=${targets.length}`,
      { offset, batch_size: batchSize, total, results, withContracts }, user.name);

    const processed = action === 'sync-employee' ? 1 : (offset + targets.length);
    const done = action === 'sync-employee' ? true : (processed >= total || targets.length === 0);
    return json({
      success: true,
      offset,
      batch_size: batchSize,
      batch_processed: targets.length,
      processed,
      total,
      next_offset: processed,
      done,
      ...results,
    });
  }

  if (action === 'flawed-notify') {
    // Daily after-shift-day-close notification to staff who have flawed
    // punches yesterday. Routes each message through the staff member's
    // brand WABA (HE → hamzaexpress.in, NCH → nawabichaihouse.com, HQ → HE).
    //
    // Two auto-detectable error classes are notified:
    //   CLASS A: odd punch count (≥3) — staff missed one break punch.
    //            e.g. Nizam 10:47, 20:58, 01:09 → 3 taps, pair + orphan
    //            Message: "We got 3 punches — you missed one (break-in
    //            or break-out). Please be careful."
    //   CLASS B: exactly 1 tap within a brand's clear-IN window, no OUT.
    //            e.g. Mainuddin 10:42 AM only, NCH morning arrival window.
    //            Message: "Only your punch-in was captured. Please always
    //            punch out when leaving."
    //
    // NOT notified (need manager clarification first):
    //   - Ambiguous 1-tap outside clear IN window (Reyaz 21:45, Ameer 02:01,
    //     Ismail 21:07) — these could be IN or OUT, requires Basheer input.
    //   - Absent (0 taps) — can't tell if they didn't work or didn't punch.
    //   - Cross-boundary night shifts (Aadil) — needs cross-boundary pairing
    //     fix first, then reassess.
    //   - Owner (PIN 0305 = Nihaf) — always excluded.
    const date = body.date || shiftDayDelta(istDate(), -1);  // default yesterday
    const apiKey = env.DASHBOARD_KEY;
    if (!apiKey) return json({ error: 'DASHBOARD_KEY not set' }, 500);

    // Fetch yesterday's attendance + employee details
    const rows = (await db.prepare(
      `SELECT a.*, e.name, e.known_as, e.pin as emp_pin, e.phone, e.brand_label, e.job_name
         FROM hr_attendance_daily a
         JOIN hr_employees e ON e.id = a.employee_id
        WHERE a.date = ? AND e.is_active = 1`
    ).bind(date).all()).results || [];

    const OWNER_PIN = '1';  // PIN 1 = Nihaf, excluded from auto-notify
    // Clear-IN windows per brand (hour range where a lone tap is confidently an IN)
    const CLEAR_IN_WINDOW = {
      HE:  [9, 13],   // 09:00–12:59 — biryani kitchen morning arrival
      NCH: [9, 12],   // 09:00–11:59 — NCH morning crew; outside this = ambiguous (night shift, etc.)
      HQ:  [9, 12],   // 09:00–11:59 — office start
    };

    const results = [];
    for (const r of rows) {
      if (r.emp_pin === OWNER_PIN) { results.push({ pin: r.emp_pin, skipped: 'owner' }); continue; }
      if (!r.phone) { results.push({ pin: r.emp_pin, name: r.name, skipped: 'no_phone' }); continue; }

      const pairs = (() => { try { return JSON.parse(r.raw_punches_json || '[]'); } catch { return []; } })();
      const firstInHour = r.first_in_at ? parseInt(r.first_in_at.slice(11, 13), 10) : null;
      const brand = r.brand_label;
      const punchCount = r.punch_count || 0;

      let errorClass = null;
      let msg = null;
      const taps = pairs.flatMap(p => [p.in, p.out].filter(Boolean)).map(t => t.slice(11, 16)).join(', ');
      const greet = `Namaste ${r.known_as || r.name} bhai`;

      // Nihaf's punch semantics: 2 or 4 taps = valid. Odd count = error.
      //
      //   3+ odd count      → missed a break punch (specific error class)
      //   1 tap in clear-IN → forgot to punch out
      //   1 tap outside    → ambiguous — hold off, manager clarifies

      if (punchCount >= 3 && punchCount % 2 === 1) {
        errorClass = 'missed_break_punch';
        msg = `${greet},\n\nYesterday (${date}) we received ${punchCount} punches on the biometric (${taps}). An odd number means you MISSED one punch — either going for your break OR coming back from break.\n\nPlease always punch BOTH when leaving AND returning from break, so your hours and break time are recorded correctly. A valid shift is 2 punches (IN + OUT) or 4 punches (IN + break-OUT + break-IN + OUT).\n\n- HN HR`;
      }
      else if (punchCount === 1 && firstInHour !== null) {
        const win = CLEAR_IN_WINDOW[brand];
        if (win && firstInHour >= win[0] && firstInHour < win[1]) {
          errorClass = 'missed_checkout';
          msg = `${greet},\n\nYesterday (${date}) only your punch-IN at ${r.first_in_at.slice(11, 16)} was captured. The system did not receive your punch-OUT.\n\nPlease let Basheer bhai know what time you finished your shift so we can correct the record. And always remember to punch out when leaving.\n\n- HN HR`;
        }
      }

      if (!errorClass) { results.push({ pin: r.emp_pin, name: r.name, skipped: 'no_auto_class' }); continue; }

      // Route to brand WABA
      const endpoint = brand === 'NCH'
        ? 'https://nawabichaihouse.com/api/hr-wa-send'
        : 'https://hamzaexpress.in/api/hr-wa-send';
      const to = String(r.phone).replace(/\D/g, '').slice(-10);
      if (to.length !== 10) { results.push({ pin: r.emp_pin, name: r.name, skipped: 'invalid_phone' }); continue; }

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ to: `91${to}`, text: msg }),
        });
        const out = await resp.json();
        results.push({
          pin: r.emp_pin, name: r.name, class: errorClass,
          ok: resp.ok, wa_message_id: out.wa_message_id || null, error: out.error || null,
        });
      } catch (e) {
        results.push({ pin: r.emp_pin, name: r.name, class: errorClass, ok: false, error: e.message });
      }
    }

    const sent = results.filter(x => x.ok).length;
    const skipped = results.filter(x => x.skipped).length;
    const failed = results.filter(x => x.ok === false).length;
    await logSync(db, 'flawed_notify', 'whatsapp', null, date,
      { results, sent, skipped, failed }, user.name);
    return json({ success: true, date, summary: `Sent ${sent}, skipped ${skipped}, failed ${failed}`, results });
  }

  if (action === 'digest-send') {
    // Orchestrates brand-scoped digest delivery:
    //   HE + HQ rows go through hamzaexpress.in/api/hr-wa-send
    //   NCH rows   go through nawabichaihouse.com/api/hr-wa-send
    // Recipients: Nihaf (admin, gets financial detail) + Basheer (manager,
    // redacted). Can be invoked from UI ("Send digest" button) or by the
    // hr-digest-cron scheduled worker.
    const brand = body.brand || 'HE';
    const mode = body.mode || 'recap';
    const date = body.date || istDate();
    if (!['HE','NCH','ALL'].includes(brand)) return json({ error: 'brand must be HE|NCH|ALL' }, 400);
    if (!['recap','no_show'].includes(mode)) return json({ error: 'mode must be recap|no_show' }, 400);
    const apiKey = env.DASHBOARD_KEY;
    if (!apiKey) return json({ error: 'DASHBOARD_KEY not set' }, 500);

    // Resolve endpoint per brand
    const brandsToSend = brand === 'ALL' ? ['HE','NCH'] : [brand];
    const results = [];

    for (const b of brandsToSend) {
      const endpoint = b === 'HE'
        ? 'https://hamzaexpress.in/api/hr-wa-send'
        : 'https://nawabichaihouse.com/api/hr-wa-send';

      // Recipients: always Nihaf + Basheer. Each gets their own rendering
      // (admin view with financials vs manager view).
      const recipients = [
        { phone: '917010426808', pin: '0305', name: 'Nihaf' },
        { phone: '919061906916', pin: '8523', name: 'Basheer' },
      ];

      for (const rcp of recipients) {
        const viewer = PINS[rcp.pin];
        const includeFin = viewer ? !!viewer.view_financials : false;
        const digest = await buildDigest(db, b, date, mode, includeFin);
        if (!digest.text || digest.roster_total === 0) {
          results.push({ brand: b, to: rcp.name, skipped: true, reason: 'empty digest' });
          continue;
        }
        try {
          const r = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ to: rcp.phone, text: digest.text }),
          });
          const out = await r.json();
          results.push({ brand: b, to: rcp.name, ok: r.ok, status: r.status, wa_message_id: out.wa_message_id || null, error: out.error || null });
        } catch (e) {
          results.push({ brand: b, to: rcp.name, ok: false, error: e.message });
        }
      }
    }

    const sent = results.filter(r => r.ok).length;
    const failed = results.filter(r => r.ok === false).length;
    const skipped = results.filter(r => r.skipped).length;
    await logSync(db, 'digest_send', 'whatsapp', null, `${brand}/${mode}/${date}`,
      { results, sent, failed, skipped }, user.name);
    return json({
      success: true,
      summary: `Sent ${sent}, failed ${failed}, skipped ${skipped}`,
      date, brand, mode, results,
    });
  }

  if (action === 'pull-attendance') {
    // Pull hr.attendance from Odoo for a date range, compute daily roll-up, store in D1
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);
    const from = body.from || istDate();
    const to = body.to || from;
    try {
      const r = await pullAttendance(apiKey, db, from, to, user.name);
      return json({ success: true, from, to, ...r });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (action === 'compute-deductions') {
    const { month } = body;
    const m = month || istDate().slice(0, 7);
    const r = await computeDeductions(db, m, user.name);
    return json({ success: true, month: m, ...r });
  }

  /* ━━━━━━━━━━ CAMS device ops ━━━━━━━━━━ */

  if (action === 'cams-device-upsert') {
    const d = body;
    if (!d.serial_number) return json({ error: 'serial_number required' }, 400);
    const existing = await db.prepare('SELECT id FROM hr_cams_devices WHERE serial_number=?')
      .bind(d.serial_number).first();
    if (existing) {
      const allow = ['device_uuid','label','brand_label','location','callback_url',
                     'push_user_data','restful_api','reverify_seconds','notes'];
      const sets = [], vals = [];
      for (const k of allow) if (d[k] !== undefined) { sets.push(`${k}=?`); vals.push(d[k]); }
      if (sets.length) {
        sets.push("updated_at=datetime('now')");
        vals.push(existing.id);
        await db.prepare(`UPDATE hr_cams_devices SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
      }
      await logSync(db, 'update_cams_device', 'hr_cams_devices', existing.id, d.serial_number, d, user.name);
      return json({ success: true, id: existing.id, updated: true });
    }
    const ins = await db.prepare(
      `INSERT INTO hr_cams_devices
       (serial_number, device_uuid, label, brand_label, location, callback_url,
        push_user_data, restful_api, reverify_seconds, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      d.serial_number, d.device_uuid || null, d.label || null, d.brand_label || null,
      d.location || null, d.callback_url || null,
      d.push_user_data ?? 1, d.restful_api ?? 1, d.reverify_seconds ?? 30,
      d.notes || null,
    ).run();
    await logSync(db, 'create_cams_device', 'hr_cams_devices', ins.meta?.last_row_id, d.serial_number, d, user.name);
    return json({ success: true, id: ins.meta?.last_row_id, created: true });
  }

  if (action === 'cams-remote') {
    // Remote control via CAMS Web API 3.0
    // Supported cmd: delete-user | clear-logs | clear-all | reboot | set-reverify | push-user
    const { cmd, serial, params } = body;
    const token = env.CAMS_AUTH_TOKEN;
    const serialToUse = serial || CAMS_DEVICE_SERIAL;
    if (!cmd) return json({ error: 'cmd required' }, 400);
    if (!token) return json({ error: 'CAMS_AUTH_TOKEN not configured (add via wrangler secret put)' }, 500);

    const cmdMap = {
      'delete-user':  { cams: 'DeleteUser',    required: ['UserID'] },
      'clear-logs':   { cams: 'ClearAttLogs',  required: [] },
      'clear-all':    { cams: 'ClearAll',      required: [] },
      'reboot':       { cams: 'Reboot',        required: [] },
      'set-reverify': { cams: 'SetDeviceInfo', required: ['ReVerify'] },
      'push-user':    { cams: 'AddUser',       required: ['UserID','Name'] },
      'get-users':    { cams: 'GetUserData',   required: [] },
      'get-logs':     { cams: 'GetAttLogs',    required: [] },
    };
    const m = cmdMap[cmd];
    if (!m) return json({ error: `Unknown cmd. Options: ${Object.keys(cmdMap).join(', ')}` }, 400);
    for (const req of m.required) {
      if (!params?.[req]) return json({ error: `params.${req} required for ${cmd}` }, 400);
    }

    try {
      const result = await camsCommand(serialToUse, token, m.cams, params || {});
      await logSync(db, `cams_${cmd}`, 'cams.device', null, serialToUse,
        { cmd: m.cams, params, result }, user.name);
      return json({ success: true, cmd: m.cams, result });
    } catch (e) {
      await logSync(db, `cams_${cmd}`, 'cams.device', null, serialToUse,
        { cmd: m.cams, params }, user.name, 'error', e.message);
      return json({ error: e.message }, 502);
    }
  }

  if (action === 'cams-pull-users') {
    // Pull user list from device → cross-check with roster → flag ghost PINs
    const token = env.CAMS_AUTH_TOKEN;
    if (!token) return json({ error: 'CAMS_AUTH_TOKEN not configured' }, 500);
    try {
      const result = await camsCommand(body.serial || CAMS_DEVICE_SERIAL, token, 'GetUserData', {});
      const users = result.Data || result.Users || [];
      const rosterPins = new Set();
      const pinRows = await db.prepare('SELECT pin, name FROM hr_employees WHERE is_active=1 AND pin IS NOT NULL').all();
      for (const r of pinRows.results) rosterPins.add(String(r.pin));
      const onDevice = new Set(users.map(u => String(u.UserID || u.pin)));

      const ghosts = [...onDevice].filter(p => !rosterPins.has(p));   // on device, not in roster
      const missing = [...rosterPins].filter(p => !onDevice.has(p));  // in roster, not on device
      await logSync(db, 'cams_audit', 'cams.device', null, 'user-sync-check',
        { on_device: users.length, roster: rosterPins.size, ghosts, missing }, user.name);
      return json({ success: true, on_device: users.length, roster: rosterPins.size, ghosts, missing });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  return json({
    error: 'Unknown action',
    actions: Object.keys(permMap),
  }, 400);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Odoo sync: one employee → hr.employee + hr.contract
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Pre-load hr_department_map + hr_job_map once per sync batch so
 * syncOneEmployee does NOT issue per-employee D1 lookups. Each map key is
 * `${name}|${company_id}` (company_id may be 'null'), with a secondary
 * `${name}|` fallback used when a row has a null company_id.
 */
async function loadHrMaps(db) {
  const [dRes, jRes] = await Promise.all([
    db.prepare('SELECT name, company_id, odoo_department_id FROM hr_department_map').all(),
    db.prepare('SELECT name, company_id, odoo_job_id FROM hr_job_map').all(),
  ]);
  const depts = new Map();  // `${name}|${cid}` -> odoo_id
  const deptsNullCid = new Map();  // `${name}` -> odoo_id (fallback)
  for (const d of dRes.results || []) {
    const cid = d.company_id == null ? '' : String(d.company_id);
    depts.set(`${d.name}|${cid}`, d.odoo_department_id);
    if (cid === '') deptsNullCid.set(d.name, d.odoo_department_id);
  }
  const jobs = new Map();
  const jobsNullCid = new Map();
  for (const j of jRes.results || []) {
    const cid = j.company_id == null ? '' : String(j.company_id);
    jobs.set(`${j.name}|${cid}`, j.odoo_job_id);
    if (cid === '') jobsNullCid.set(j.name, j.odoo_job_id);
  }
  return { depts, deptsNullCid, jobs, jobsNullCid };
}

function resolveMap(map, nullMap, name, cid) {
  if (!name) return null;
  const hit = map.get(`${name}|${String(cid)}`);
  if (hit) return hit;
  return nullMap.get(name) || null;
}

async function syncOneEmployee(apiKey, db, emp, userName, opts = {}) {
  if (!emp.pin) throw new Error('pin missing — enroll in device first');
  if (emp.brand_label === 'TBD') throw new Error('brand_label is TBD');

  const withContracts = !!opts.withContracts;
  // If maps weren't pre-loaded (e.g. sync-employee single call), load them now
  const maps = opts.maps || await loadHrMaps(db);

  // 1. Resolve relational IDs from D1 maps (fast). D1's company_id column wins
  //    when set — lets HR park specific people in non-default companies without
  //    touching code. Falls back to the brand_label map otherwise.
  const cidFromDb = emp.company_id ? parseInt(emp.company_id) : null;
  const cid = cidFromDb || BRAND_COMPANY[emp.brand_label];

  const deptId = resolveMap(maps.depts, maps.deptsNullCid, emp.department_name, cid === false ? '' : cid);
  const jobId  = resolveMap(maps.jobs,  maps.jobsNullCid,  emp.job_name,        cid === false ? '' : cid);
  const deptRow = deptId ? { odoo_department_id: deptId } : null;
  const jobRow  = jobId  ? { odoo_job_id: jobId }         : null;

  // 2. Get valid hr.employee fields (cache)
  const valid = await getValidFields(apiKey, 'hr.employee');

  // 3. Build desired vals — filterFields strips unknowns (mirrors Apps Script)
  const desired = {
    name: emp.name,
    company_id: cid || false,
    department_id: deptRow?.odoo_department_id || false,
    job_id: jobRow?.odoo_job_id || false,
    job_title: emp.job_name || false,
    pin: String(emp.pin),
    // CAMS F38+ device sends payload `PunchLog.UserId` — odoo_biometric_attendance
    // module looks up hr.employee.biometric_user_id against that UserId. Must match
    // the device enrollment number (== our D1 `pin`). Without this, every punch
    // returns "Employee not found" even though pin is set.
    biometric_user_id: String(emp.pin),
    tz: 'Asia/Kolkata',
    employee_type: 'employee',
    mobile_phone: emp.phone || false,
    work_mobile: emp.phone || false,
    work_phone: emp.phone || false,
    gender: emp.gender || false,
    birthday: emp.dob || false,
    identification_id: emp.aadhaar_full || false,
    legal_name: emp.name,
    emergency_contact: emp.emergency_contact || false,
    emergency_phone: emp.emergency_phone || false,
    private_street: emp.address || false,
    notes: buildNote(emp),
    additional_note: buildNote(emp),
    wage: emp.monthly_salary || 0,
  };
  const { clean } = filterFields(desired, valid);

  // 4. Search by pin (dedup)
  const existing = await odoo(apiKey, 'hr.employee', 'search_read',
    [[['pin', '=', String(emp.pin)]]], { fields: ['id', 'name'], limit: 1 });

  let odooId, created = false;
  if (existing && existing.length) {
    odooId = existing[0].id;
    await odoo(apiKey, 'hr.employee', 'write', [[odooId], clean]);
  } else {
    odooId = await odoo(apiKey, 'hr.employee', 'create', [clean]);
    created = true;
  }

  // 5. hr.contract — ONLY if explicitly requested (saves 2 subrequests/employee).
  //    Most deployments use wage on hr.employee + CAMS attendance directly;
  //    contracts module is optional. Callers pass with_contracts=true when needed.
  let contractId = emp.odoo_contract_id;
  if (withContracts) {
    try {
      const contractValid = await getValidFields(apiKey, 'hr.contract');
      const cVals = {
        name: `Contract — ${emp.name}`,
        employee_id: odooId,
        wage: emp.monthly_salary || 0,
        date_start: emp.start_date || istDate(),
        state: 'open',
        company_id: cid || false,
      };
      const { clean: cClean } = filterFields(cVals, contractValid);

      const existingContract = await odoo(apiKey, 'hr.contract', 'search_read',
        [[['employee_id','=',odooId],['state','in',['draft','open']]]],
        { fields: ['id','name','state'], limit: 1 });

      if (existingContract && existingContract.length) {
        contractId = existingContract[0].id;
        await odoo(apiKey, 'hr.contract', 'write', [[contractId], cClean]);
      } else {
        contractId = await odoo(apiKey, 'hr.contract', 'create', [cClean]);
      }
    } catch (err) {
      // contract module may not be installed in all companies — don't hard-fail
      contractId = null;
    }
  }

  // 6. Update D1 row (preserve prior contract_id if we didn't touch contracts)
  await db.prepare(
    `UPDATE hr_employees SET
       odoo_employee_id = ?, odoo_contract_id = ?,
       sync_status = 'Synced', sync_error = NULL,
       synced_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).bind(odooId, contractId || null, emp.id).run();

  // No per-employee logSync — batch caller logs a single summary row to conserve subrequests

  return { created, updated: !created, odoo_employee_id: odooId, odoo_contract_id: contractId };
}

function buildNote(emp) {
  const parts = [];
  if (emp.pay_type) parts.push(`Pay: ${emp.pay_type}`);
  if (emp.monthly_salary) parts.push(`Salary: ₹${emp.monthly_salary}/mo`);
  if (emp.daily_rate) parts.push(`Daily: ₹${emp.daily_rate}`);
  if (emp.notes) parts.push(emp.notes);
  return parts.join(' | ');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Attendance pull: D1 hr_cams_punches → hr_attendance_daily
 *
 * Shift-day model (Apr 19 2026 rewrite):
 *   Each brand has a shift_day_start_hour (HE=09:00, NCH=06:00, HQ=00:00).
 *   A punch at time T belongs to shift-day D where D is the calendar date
 *   whose start-hour is the most recent boundary before T. I.e. an HE
 *   check-out at 00:30 Apr 20 is part of shift-day Apr 19 (yesterday's
 *   shift still running past midnight).
 *
 *   Status ladder (per employee, per shift-day):
 *     • leave        → approved leave in D1 hr_leaves
 *     • week_off     → shift_rules.week_off matches DoW
 *     • isOffice + any punch  → present  (office = any punch, no deduction)
 *     • no punches   + shift-day open  → pending    (don't finalise)
 *     • no punches   + shift-day closed → absent    (full deduction)
 *     • has punches  + shift-day open  → present    ("present until day closes")
 *     • has punches  + shift-day closed + open IN < 18h old  → present (within grace)
 *     • has punches  + shift-day closed + open IN ≥ 18h old:
 *         allow_single_punch → present (deliberate single punch)
 *         else → ghost (flagged missing-checkout, full deduction)
 *     • has punches  + all pairs closed:
 *         hours < half_day_threshold → ghost, full
 *         hours < full_day_threshold → half, 50%
 *         else → present
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// "now" in IST as a JS Date (whose wall-clock is IST).
function istNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

// Return shift-day (YYYY-MM-DD) for a punch timestamp like "2026-04-19 10:57:33" (IST).
// startHour=9  → 08:59 belongs to previous day; 09:00 onwards = current day.
function shiftDayFor(punchTimeStr, startHour) {
  const [d, t] = String(punchTimeStr).split(' ');
  if (!d) return null;
  const hr = parseInt((t || '00').slice(0, 2), 10) || 0;
  if (hr < (startHour || 0)) {
    // Belongs to previous calendar day's shift-day
    const ymd = new Date(d + 'T12:00:00Z'); // noon-anchor avoids DST off-by-one
    ymd.setUTCDate(ymd.getUTCDate() - 1);
    return ymd.toISOString().slice(0, 10);
  }
  return d;
}

// Is shift-day D closed at "now"? D closes at (D+1) start_hour:00 IST.
function isShiftDayClosed(shiftDay, startHour, nowIst) {
  const close = new Date(shiftDay + 'T00:00:00Z');
  close.setUTCDate(close.getUTCDate() + 1);
  close.setUTCHours(startHour || 0, 0, 0, 0);
  // nowIst is a Date whose UTC fields encode IST wall-clock
  return nowIst.getTime() >= close.getTime();
}

// Parse "YYYY-MM-DD HH:MM:SS" IST → JS Date whose UTC fields = IST wall-clock.
// This matches istNow(), so Date arithmetic stays consistent.
function parseIstWall(s) {
  if (!s) return null;
  return new Date(s.replace(' ', 'T') + 'Z');
}

async function pullAttendance(apiKey, db, from, to, userName) {
  // Load roster + shift rules once (now includes shift_day_start_hour + missing_checkout_hours)
  const rosterRows = await db.prepare(
    `SELECT e.*, r.min_daily_hours, r.expected_daily_hours,
            r.full_day_threshold, r.half_day_threshold,
            r.allow_single_punch, r.week_off, r.applies_to_office,
            r.scheduled_break_minutes, r.shift_start_time, r.shift_end_time,
            r.shift_day_start_hour, r.missing_checkout_hours
       FROM hr_employees e
       LEFT JOIN hr_shift_rules r
         ON r.brand_label = e.brand_label AND r.pay_type = e.pay_type
      WHERE e.is_active = 1 AND e.odoo_employee_id IS NOT NULL
        AND e.pin IS NOT NULL AND e.pin != ''`
  ).all();
  const byPin = new Map();
  for (const e of rosterRows.results) byPin.set(String(e.pin), e);

  // Expand fetch window by ±1 calendar day so we catch cross-midnight punches
  // that belong to the requested shift-days.
  const fetchFrom = shiftDayDelta(from, -1);
  const fetchTo   = shiftDayDelta(to,   +1);

  const rawPunches = await db.prepare(
    `SELECT pin, punch_time, punch_type
       FROM hr_cams_punches
       WHERE substr(punch_time, 1, 10) BETWEEN ? AND ?
       ORDER BY pin, punch_time`
  ).bind(fetchFrom, fetchTo).all();

  // Session-based pairing (Apr 20 refactor per Nihaf):
  //
  //   Old approach bucketed taps per shift-day then paired within-bucket.
  //   That broke NCH night shifts that span past 06:00 next day (Aadil
  //   22:33 → 09:24 = one shift, but OUT was in next bucket).
  //
  //   New approach: group by pin only, pair taps chronologically across
  //   days, assign each completed PAIR to the shift-day of its IN.
  //
  // CAMS F38+ sends every face-tap as punch_type="CheckIn" — no direction
  // tag. Pairing rules:
  //   1. Double-tap dedup: consecutive taps <10 min = duplicate device
  //      reads or staff hesitation. Drop the 2nd.
  //   2. Alternate-pair: 1st tap = IN, 2nd = OUT, 3rd = IN, 4th = OUT…
  //   3. Max-session cap: if gap IN→next > brand's max, previous IN
  //      becomes orphan (worker left without tapping) and current tap
  //      opens a new session.
  //
  // Per-brand MAX session (calibrated Apr 20 per real outlet hours):
  //   HE  18h — staff can arrive 9 AM, OUT up to ~2-3 AM next day
  //   NCH 14h — 24h operation but one shift rarely exceeds 12-14h
  //             (Aadil's 22:33 → 09:24 = 10h 51m = within cap ✓)
  //   HQ  14h — office flex, late-night GM tapping (Tanveer case) included
  //
  // PAIR ASSIGNMENT: each pair goes to shift-day of its IN. So Aadil's
  // (22:33 Apr 19, 09:24 Apr 20) lives in Apr 19 shift-day even though
  // OUT is in calendar-Apr 20. Ramjan's (10:40 Apr 19, 15:03 Apr 19)
  // stays in Apr 19. Works for all patterns.
  const MAX_SESSION_H = { HE: 18, NCH: 14, HQ: 14 };
  const MIN_SESSION_MINUTES = 10;

  // Group punches by pin only, keeping chronological order
  const byPinAll = new Map();  // pin → [raw rows, sorted]
  let punchCount = 0;
  for (const r of rawPunches.results || []) {
    const pin = String(r.pin);
    if (!byPin.has(pin)) continue;  // skip archived/unmapped
    if (!byPinAll.has(pin)) byPinAll.set(pin, []);
    byPinAll.get(pin).push(r);
    punchCount++;
  }

  // For each person, build pairs across all days, then assign each pair
  // to the shift-day of its IN timestamp.
  const buckets = new Map();  // `${odoo_id}|${shiftDay}` → { punches, hours, firstIn, lastOut }
  for (const [pin, rows] of byPinAll.entries()) {
    const emp = byPin.get(pin);
    const maxSessionH = MAX_SESSION_H[emp.brand_label] || 14;
    const startHour = emp.shift_day_start_hour ?? 0;

    rows.sort((a, b) => String(a.punch_time).localeCompare(String(b.punch_time)));

    // Step 1: dedup double-taps (<10 min apart)
    const clean = [];
    for (const r of rows) {
      const last = clean[clean.length - 1];
      if (last) {
        const gapMin = (parseIstWall(r.punch_time) - parseIstWall(last.punch_time)) / 60000;
        if (gapMin < MIN_SESSION_MINUTES) continue;
      }
      clean.push(r);
    }

    // Step 2: alternate-pair with max-session cap
    const pairs = [];  // { in, out }
    let openIn = null;
    for (const r of clean) {
      if (!openIn) {
        openIn = r.punch_time;
        continue;
      }
      const gapH = (parseIstWall(r.punch_time) - parseIstWall(openIn)) / 3600000;
      if (gapH <= maxSessionH) {
        pairs.push({ in: openIn, out: r.punch_time });
        openIn = null;
      } else {
        pairs.push({ in: openIn, out: null });
        openIn = r.punch_time;
      }
    }
    if (openIn) pairs.push({ in: openIn, out: null });

    // Step 3: assign each pair to the shift-day of its IN (or OUT if no IN)
    const byShiftDay = new Map();  // shiftDay → [pairs]
    for (const p of pairs) {
      const anchor = p.in || p.out;
      if (!anchor) continue;
      const sd = shiftDayFor(anchor, startHour);
      if (!sd) continue;
      if (sd < from || sd > to) continue;  // outside recompute window
      if (!byShiftDay.has(sd)) byShiftDay.set(sd, []);
      byShiftDay.get(sd).push(p);
    }

    // Step 4: aggregate per shift-day into buckets
    // tapCount = actual TAP count (every in/out is 1 tap), NOT pair count.
    //   2 pairs fully closed = 4 taps (IN, OUT, IN, OUT) — EVEN, valid
    //   1 pair + 1 orphan IN  = 3 taps — ODD, missed a break punch
    //   1 full pair           = 2 taps — EVEN, valid straight shift
    //   1 orphan IN           = 1 tap  — ODD, missing OUT
    for (const [sd, pairsInDay] of byShiftDay.entries()) {
      let hours = 0, firstIn = null, lastOut = null, tapCount = 0;
      for (const p of pairsInDay) {
        if (p.in)  tapCount++;
        if (p.out) tapCount++;
        if (p.in && p.out) {
          const ms = parseIstWall(p.out) - parseIstWall(p.in);
          if (ms > 0) hours += ms / 3600000;
        }
        if (p.in  && (!firstIn || p.in  < firstIn)) firstIn = p.in;
        if (p.out && (!lastOut || p.out > lastOut)) lastOut = p.out;
      }
      buckets.set(`${emp.odoo_employee_id}|${sd}`, {
        punches: pairsInDay, hours, firstIn, lastOut, tapCount,
      });
    }
  }

  // Target shift-days in range [from, to]
  const days = [];
  for (let cursor = from; cursor <= to; cursor = shiftDayDelta(cursor, +1)) {
    days.push(cursor);
  }

  const now = istNow();
  const written = { present: 0, half: 0, absent: 0, ghost: 0, week_off: 0, leave: 0, pending: 0, total: 0 };

  for (const emp of rosterRows.results) {
    const startHour = emp.shift_day_start_hour ?? 0;
    const missingCheckoutH = emp.missing_checkout_hours ?? 18;
    for (const shiftDay of days) {
      const key = `${emp.odoo_employee_id}|${shiftDay}`;
      const b = buckets.get(key);
      const hours = b?.hours || 0;
      // Per-employee week_off_day takes precedence over brand shift rule.
      //   Apr 19 2026: only Zoya has Sunday off among HQ staff.
      const effectiveWeekOff = emp.week_off_day || emp.week_off;
      const isWeekOff = isWeekOffDay(shiftDay, effectiveWeekOff);
      const isOffice = !!emp.applies_to_office;
      const shiftClosed = isShiftDayClosed(shiftDay, startHour, now);

      const leave = await db.prepare(
        'SELECT leave_type, approved FROM hr_leaves WHERE employee_id=? AND ? BETWEEN start_date AND end_date LIMIT 1'
      ).bind(emp.id, shiftDay).first();

      const breakInfo = b ? computeBreakGap(b.punches) : { minutes: 0, start: null, end: null };

      let status, deduction = 0, reason = null, singlePunch = 0;

      if (leave) {
        status = 'leave';
        if (leave.leave_type === 'unpaid' && !isWeekOff) {
          deduction = daily(emp);
          reason = 'unpaid leave';
        }
      } else if (isOffice) {
        // Office staff rule takes priority over week-off so Sunday office
        // punches (ad-hoc work) still register as present. No auto-deduction.
        const hasPunches = b && b.punches.length > 0;
        if (hasPunches) status = 'present';
        else if (isWeekOff) status = 'week_off';
        else if (!shiftClosed) status = 'pending';
        else { status = 'absent'; reason = 'no punches'; }
      } else if (isWeekOff) {
        status = 'week_off';
      } else if (!b || b.punches.length === 0) {
        if (!shiftClosed) {
          status = 'pending';
          reason = 'shift open — no punch yet';
        } else {
          status = 'absent';
          deduction = daily(emp);
          reason = 'no punches';
        }
      } else {
        // Has punches
        const openPair = b.punches.find(p => p.in && !p.out) || null;
        singlePunch = openPair ? 1 : 0;

        if (!shiftClosed) {
          // Shift still in progress → present until day closes
          status = 'present';
          deduction = 0;
          reason = openPair ? 'shift in progress' : null;
        } else if (openPair) {
          // Shift-day closed but an IN has no OUT — check staleness
          const ageH = Math.max(0, (now - parseIstWall(openPair.in)) / 3600000);
          if (ageH < missingCheckoutH) {
            // Inside grace window — still present (may punch out any moment)
            status = 'present';
            reason = `open IN — ${ageH.toFixed(1)}h, within ${missingCheckoutH}h grace`;
          } else if (emp.allow_single_punch) {
            status = 'present';
            reason = 'single punch (approved)';
          } else {
            status = 'ghost';
            deduction = daily(emp);
            reason = `missing checkout — IN ${openPair.in}, no OUT after ${ageH.toFixed(0)}h`;
          }
        } else {
          // All pairs closed — classic hour-based ladder
          if (hours < (emp.half_day_threshold ?? 2)) {
            status = 'ghost';
            deduction = daily(emp);
            reason = `only ${hours.toFixed(1)}h — likely ghost/bounce`;
          } else if (hours < (emp.full_day_threshold ?? 6)) {
            status = 'half';
            deduction = daily(emp) * 0.5;
            reason = `half-day (${hours.toFixed(1)}h)`;
          } else {
            status = 'present';
          }
        }
      }

      await db.prepare(
        `INSERT OR REPLACE INTO hr_attendance_daily
          (pin, employee_id, odoo_employee_id, date, first_in_at, last_out_at,
           punch_count, total_hours, status, is_single_punch,
           expected_hours, deducted_amount, deduction_reason, raw_punches_json,
           break_taken_minutes, break_start_at, break_end_at,
           computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
      ).bind(
        emp.pin, emp.id, emp.odoo_employee_id, shiftDay,
        b?.firstIn || null, b?.lastOut || null,
        b?.tapCount ?? 0, hours,
        status, singlePunch,
        emp.expected_daily_hours || 8,
        deduction, reason,
        JSON.stringify(b?.punches || []),
        breakInfo.minutes, breakInfo.start, breakInfo.end,
      ).run();

      written[status] = (written[status] || 0) + 1;
      written.total++;
    }
  }

  await logSync(db, 'pull_attendance', 'hr.attendance', null, `${from}..${to}`,
    { employees: rosterRows.results.length, punches: punchCount, written }, userName);
  return { employees: rosterRows.results.length, punches: punchCount, written };
}

// Date arithmetic on "YYYY-MM-DD" without timezone fuss.
function shiftDayDelta(ymd, days) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Break gap: detect qualifying rest periods from multi-pair punches.
 * A qualifying break = gap between OUT and next IN of 30–300 minutes
 * (business rule set by Nihaf Apr 19 2026).
 *
 *   < 30 min  → probably a bio re-verify, bathroom visit, or punch bounce.
 *               Doesn't count as a break (but still subtracts from work hours
 *               because those happen during paired-pair hours calc upstream).
 *   30–300m   → legit break. Count toward break_taken_minutes.
 *   > 300m    → split shift or forgotten checkout. Flagged as outlier.
 *
 * Output adds an `outliers` array with any oversized gaps for review.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const BREAK_MIN_MINUTES = 30;
const BREAK_MAX_MINUTES = 300;  // 5 hours

function computeBreakGap(punches) {
  if (!punches || punches.length < 2) return { minutes: 0, start: null, end: null, outliers: [] };
  // Sort by check_in ascending
  const sorted = [...punches].sort((a, b) =>
    new Date((a.in || a.out).replace(' ','T')+'Z') - new Date((b.in || b.out).replace(' ','T')+'Z')
  );
  let totalMinutes = 0, breakStart = null, breakEnd = null;
  const outliers = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const outStr = sorted[i].out;
    const nextInStr = sorted[i + 1].in;
    if (!outStr || !nextInStr) continue;
    const outMs = new Date(outStr.replace(' ','T')+'Z').getTime();
    const inMs  = new Date(nextInStr.replace(' ','T')+'Z').getTime();
    const gapMin = Math.round((inMs - outMs) / 60000);
    if (gapMin <= 0) continue;
    if (gapMin < BREAK_MIN_MINUTES) {
      // too-short gap (punch bounce / bathroom) — ignore
      continue;
    }
    if (gapMin > BREAK_MAX_MINUTES) {
      outliers.push({ start: outStr, end: nextInStr, minutes: gapMin });
      continue;
    }
    // qualifying break
    totalMinutes += gapMin;
    if (!breakStart) breakStart = outStr;
    breakEnd = nextInStr;
  }
  return { minutes: totalMinutes, start: breakStart, end: breakEnd, outliers };
}

// Break warning classifier — applied to a computed attendance row.
//   'long_break'    any single gap >300 min (split/missing-checkout hybrid)
//                   → only genuine break-rule error we flag today
//   null            clean. Includes "worked straight through" (2 punches,
//                   paired IN/OUT, no break) — per Nihaf 20 Apr: valid shift,
//                   not an error. Staff simply didn't take a break.
//
// (Removed 'no_break' and 'short_break' — too noisy. We still REPORT break
//  taken / not taken as info in UI, but no longer mark the row as flawed.)
function breakWarning(hours, breakMinutes, outliers) {
  if (outliers && outliers.length) return 'long_break';
  return null;
}

// Separate info-only predicate: "worked straight through without a break".
// UI shows this as a neutral note (not a warning), cron does NOT notify.
function workedStraight(hours, breakMinutes) {
  return hours >= 6 && (breakMinutes || 0) === 0;
}

function isWeekOffDay(dateStr, weekOff) {
  if (!weekOff || weekOff === 'none') return false;
  const dow = new Date(dateStr + 'T00:00:00').getDay();  // 0 = Sunday
  const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  return map[weekOff.toLowerCase()] === dow;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Digest builder — produces a WhatsApp-ready text + structured data
 * for Basheer (manager) and Nihaf (admin). Brand-scoped.
 *
 * mode = 'recap'   → closed-shift-day summary (previous day after both
 *                    HE 09:00 and NCH 06:00 boundaries have passed).
 *                    Present / Absent / Break issues / Missing checkout.
 * mode = 'no_show' → intra-day check: who hasn't punched yet for the
 *                    current shift-day (HE after 12:30, NCH after 06:30).
 *
 * Text is UTF-8 with emoji headers so it reads well in WhatsApp.
 * Financial lines only appear when includeFin=true (Nihaf).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function buildDigest(db, brand, date, mode, includeFin) {
  // Fetch employees + attendance for this brand/date
  const brandFilter = brand === 'ALL' ? '' : 'AND e.brand_label = ?';
  const params = [date];
  if (brand !== 'ALL') params.push(brand);

  const rows = (await db.prepare(
    `SELECT a.*, e.name, e.known_as, e.pin as emp_pin, e.brand_label, e.pay_type,
            e.monthly_salary, e.daily_rate, e.job_name, e.department_name, e.row_no
       FROM hr_employees e
       LEFT JOIN hr_attendance_daily a ON a.employee_id = e.id AND a.date = ?
      WHERE e.is_active = 1 ${brandFilter}
      ORDER BY e.brand_label, e.row_no, e.name`
  ).bind(...params).all()).results || [];

  // Enrich break info per row
  const enriched = rows.map(r => {
    const punches = (() => { try { return JSON.parse(r.raw_punches_json || '[]'); } catch { return []; } })();
    const bi = computeBreakGap(punches);
    return {
      ...r,
      status: r.status || (mode === 'no_show' ? 'pending' : 'absent'),
      break_minutes: bi.minutes,
      break_start: bi.start,
      break_end: bi.end,
      break_warning: breakWarning(r.total_hours || 0, bi.minutes, bi.outliers),
      long_break_outliers: bi.outliers || [],
    };
  });

  // Categorise
  const cat = {
    present: [], absent: [], pending: [], half: [], ghost: [],
    leave: [], week_off: [],
    no_break: [], short_break: [], long_break: [], missing_checkout: [],
  };
  for (const r of enriched) {
    (cat[r.status] || cat.absent).push(r);
    if (r.break_warning) cat[r.break_warning].push(r);
    if (r.is_single_punch && (r.status === 'ghost' || r.status === 'present' && !r.last_out_at)) {
      cat.missing_checkout.push(r);
    }
  }

  // Format helpers
  const t = (iso) => iso ? iso.slice(11, 16) : '—';
  const hm = (mins) => {
    if (!mins) return '—';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const nameOf = (r) => r.known_as && r.known_as !== r.name ? `${r.known_as} (#${r.emp_pin || '—'})` : `${r.name} (#${r.emp_pin || '—'})`;

  const prettyDate = date;
  const brandLabel = brand === 'HE' ? 'Hamza Express' : brand === 'NCH' ? 'Nawabi Chai House' : brand;

  let txt = '';

  if (mode === 'no_show') {
    txt += `⏰ *${brandLabel} — Attendance check ${prettyDate}*\n`;
    txt += `Shift open, checking who hasn't clocked in yet.\n\n`;
    if (cat.pending.length === 0) {
      txt += `✅ All expected staff have punched in.\n`;
    } else {
      txt += `🟡 *Not punched yet (${cat.pending.length}):*\n`;
      cat.pending.forEach(r => { txt += `• ${nameOf(r)} — ${r.job_name || r.department_name || '—'}\n`; });
    }
    if (cat.present.length) {
      txt += `\n✅ *Present (${cat.present.length}):*\n`;
      cat.present.slice(0, 15).forEach(r => { txt += `• ${nameOf(r)} — In ${t(r.first_in_at)}\n`; });
    }
  } else {
    // recap
    txt += `📊 *${brandLabel} — HR digest ${prettyDate}*\n\n`;

    const total = enriched.length;
    txt += `👥 Roster: ${total}  ·  ✅ ${cat.present.length}  ·  ❌ ${cat.absent.length}  ·  🕒 ${cat.half.length + cat.ghost.length}  ·  🌴 ${cat.leave.length}  ·  💤 ${cat.week_off.length}\n\n`;

    if (cat.present.length) {
      txt += `✅ *Present (${cat.present.length}):*\n`;
      cat.present.forEach(r => {
        let pairs = [];
        try { pairs = JSON.parse(r.raw_punches_json || '[]'); } catch {}
        const last = pairs[pairs.length - 1];
        const first = pairs[0];
        let line;
        if (!pairs.length) {
          line = `${nameOf(r)} · no punches on record`;
        } else if (pairs.length === 1 && !last.out) {
          // First session, still on shift
          line = `${nameOf(r)} · on shift since ${t(first.in)}`;
        } else if (pairs.length === 1 && last.out) {
          // One session, closed
          line = `${nameOf(r)} · ${t(first.in)}–${t(last.out)} · ${(r.total_hours || 0).toFixed(1)}h`;
        } else if (last && !last.out) {
          // Returned from break, currently working
          line = `${nameOf(r)} · ${t(first.in)}–${t(pairs[0].out)} · 🔁 back on shift since ${t(last.in)}${r.break_minutes ? ` (break ${hm(r.break_minutes)})` : ''}`;
        } else {
          // Multi-session, all closed
          line = `${nameOf(r)} · ${t(first.in)}–${t(last.out)} · ${(r.total_hours || 0).toFixed(1)}h${r.break_minutes ? ` (break ${hm(r.break_minutes)})` : ''}`;
        }
        txt += `• ${line}\n`;
      });
      txt += '\n';
    }
    if (cat.absent.length) {
      txt += `❌ *Absent (${cat.absent.length}):*\n`;
      cat.absent.forEach(r => { txt += `• ${nameOf(r)} — ${r.job_name || '—'}\n`; });
      txt += '\n';
    }
    if (cat.half.length) {
      txt += `🕒 *Half-day (${cat.half.length}):*\n`;
      cat.half.forEach(r => { txt += `• ${nameOf(r)} · ${(r.total_hours || 0).toFixed(1)}h\n`; });
      txt += '\n';
    }
    if (cat.ghost.length) {
      txt += `👻 *Ghost / no checkout (${cat.ghost.length}):*\n`;
      cat.ghost.forEach(r => {
        txt += `• ${nameOf(r)} — In ${t(r.first_in_at)}, ${r.deduction_reason || 'suspect'}\n`;
      });
      txt += '\n';
    }

    // Break intelligence
    const brkIssues = [...cat.no_break, ...cat.short_break, ...cat.long_break];
    if (brkIssues.length) {
      txt += `☕ *Break discipline:*\n`;
      if (cat.no_break.length)    { txt += `  🚫 No break (${cat.no_break.length}) — worked ≥6h without qualifying 30-min break:\n`; cat.no_break.forEach(r => txt += `    • ${nameOf(r)} · ${(r.total_hours||0).toFixed(1)}h\n`); }
      if (cat.short_break.length) { txt += `  ⚠ Insufficient break (${cat.short_break.length}) — worked ≥8h with <30m break:\n`; cat.short_break.forEach(r => txt += `    • ${nameOf(r)} · ${(r.total_hours||0).toFixed(1)}h, break ${hm(r.break_minutes)}\n`); }
      if (cat.long_break.length)  { txt += `  ⏳ Unusually long break (${cat.long_break.length}) — gap >5h (split shift or missed punch):\n`; cat.long_break.forEach(r => r.long_break_outliers.forEach(o => txt += `    • ${nameOf(r)} · ${t(o.start)}–${t(o.end)} (${hm(o.minutes)})\n`)); }
      txt += '\n';
    }

    if (cat.leave.length)    { txt += `🌴 *On leave (${cat.leave.length}):* ${cat.leave.map(r => r.known_as || r.name).join(', ')}\n`; }
    if (cat.week_off.length) { txt += `💤 *Week off (${cat.week_off.length}):* ${cat.week_off.map(r => r.known_as || r.name).join(', ')}\n`; }

    if (includeFin) {
      const totalDed = enriched.reduce((s, r) => s + (Number(r.deducted_amount) || 0), 0);
      if (totalDed > 0) {
        txt += `\n💸 *Deductions today:* ₹${totalDed.toLocaleString('en-IN')}\n`;
        const deducted = enriched.filter(r => (Number(r.deducted_amount) || 0) > 0);
        deducted.forEach(r => {
          txt += `  • ${nameOf(r)}: ₹${Number(r.deducted_amount).toLocaleString('en-IN')} — ${r.deduction_reason || '—'}\n`;
        });
      }
    }

    txt += `\n🔗 Full view: https://hnhotels.in/ops/hr/`;
  }

  return {
    text: txt.trim(),
    counts: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v.length])),
    roster_total: enriched.length,
  };
}

function daily(emp) {
  if (emp.daily_rate) return Number(emp.daily_rate);
  if (emp.monthly_salary) return Math.round((Number(emp.monthly_salary) / 30) * 100) / 100;
  return 0;
}

async function computeDeductions(db, month, userName) {
  // month = YYYY-MM — returns summary per employee.
  const rows = await db.prepare(
    `SELECT e.id, e.pin, e.name, e.brand_label, e.monthly_salary, e.daily_rate,
            COALESCE(SUM(a.deducted_amount), 0) AS deducted,
            COUNT(CASE WHEN a.status='absent' THEN 1 END) AS absent,
            COUNT(CASE WHEN a.status='half' THEN 1 END) AS half,
            COUNT(CASE WHEN a.status='ghost' THEN 1 END) AS ghost,
            COUNT(CASE WHEN a.status='present' THEN 1 END) AS present
       FROM hr_employees e
       LEFT JOIN hr_attendance_daily a
         ON a.employee_id = e.id AND substr(a.date,1,7) = ?
      WHERE e.is_active = 1
      GROUP BY e.id`
  ).bind(month).all();

  await logSync(db, 'compute_deductions', 'hr_attendance_daily', null, month,
    { employees: rows.results.length }, userName);
  return { rows: rows.results };
}

/* ━━━ Google Drive: SA JWT for read-only listing of staff documents ━━━ */
async function getGDriveToken(env) {
  const email = env.GDRIVE_SA_EMAIL;
  const pemRaw = env.GDRIVE_SA_PRIVATE_KEY;
  if (!email || !pemRaw) throw new Error('GDRIVE_SA_EMAIL/PRIVATE_KEY not configured on hr-admin');
  const pem = pemRaw.replace(/\\n/g, '\n');
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')),
    c => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const b64u = (s) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }));
  const sigInput = new TextEncoder().encode(`${header}.${claim}`);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, sigInput);
  const sig = b64u(String.fromCharCode(...new Uint8Array(sigBuf)));
  const jwt = `${header}.${claim}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Drive token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/* ━━━ Main entry ━━━ */

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const url = new URL(request.url);
    if (request.method === 'GET')  return await handleGet(url, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('HR Admin error:', err);
    return json({ error: err.message, stack: err.stack }, 500);
  }
}
