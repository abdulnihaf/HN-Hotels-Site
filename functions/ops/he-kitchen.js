/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HE Kitchen Attendance Report — SSR live view of CAMS punches
 * Route:   /ops/he-kitchen?pin=<admin_pin>
 *
 * Reads hr_cams_punches directly, applies HE shift-day grouping
 * (09:00 → 08:59 next day so cross-midnight 12pm–1am shifts stay
 * intact), and renders a printable per-cook × per-day grid with
 * hours, single-tap warnings, and absences highlighted.
 *
 * Rule: 1 tap on a shift-day = present (credited, no deduction)
 *       0 taps on a shift-day = absent (1 day deducted)
 *       2+ taps = full present, hours = span(first → last)
 *
 * Two tables: April (Apr 19 → 30) + May (May 1 → today's shift-day).
 *
 * Built for the kitchen-team salary conversation — owner reads this
 * to anchor every deduction in evidence the cook can verify.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const SHIFT_START_HOUR = 9;          // HE: shift-day = 09:00 → 08:59 next day
const DEPT_FILTER = 'HE - Kitchen';
const BRAND_FILTER = 'HE';

const ADMIN_PINS = new Set(['0305', '8523', '4040', '5050']);  // matches hr-admin.js PINS

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Parse "2026-05-04 23:16:44" → JS Date treating string as IST wall-clock.
// Use UTC constructor to avoid environment timezone drift on the Worker.
function parseIstWall(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// punch_time → shift-day ISO date (YYYY-MM-DD).
// If hour < 9, the punch belongs to the previous shift-day.
function shiftDayOf(ts) {
  const t = parseIstWall(ts);
  if (t == null) return null;
  let d = new Date(t);
  if (d.getUTCHours() < SHIFT_START_HOUR) {
    d = new Date(t - 86400000);
  }
  return d.toISOString().slice(0, 10);
}

function fmtHM(ts) {
  return String(ts || '').slice(11, 16);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIST() {
  // IST = UTC+5:30
  const now = Date.now() + 5.5 * 3600 * 1000;
  return new Date(now).toISOString().slice(0, 10);
}

// Today's *shift-day* — if it's before 09:00 IST, today's shift-day is yesterday.
function todayShiftDayIST() {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  if (nowIst.getUTCHours() < SHIFT_START_HOUR) {
    nowIst.setUTCDate(nowIst.getUTCDate() - 1);
  }
  return nowIst.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const pin = (url.searchParams.get('pin') || '').trim();

  if (!ADMIN_PINS.has(pin)) {
    return html(`<!doctype html><html><head><meta charset="utf-8"><title>PIN required</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px/1.5 system-ui;background:#0c0c10;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#16161e;padding:32px;border-radius:14px;border:1px solid #2a2a35;width:280px}
h1{margin:0 0 16px;font-size:18px;font-weight:700}
input{width:100%;padding:12px;background:#0c0c10;color:#fff;border:1px solid #2a2a35;border-radius:8px;font:inherit;box-sizing:border-box}
button{margin-top:12px;width:100%;padding:12px;background:#e8930c;color:#000;border:0;border-radius:8px;font:600 14px system-ui;cursor:pointer}</style>
</head><body><form method="GET"><h1>HE Kitchen Report</h1>
<input name="pin" type="password" placeholder="Admin PIN" autofocus required inputmode="numeric">
<button>View report</button></form></body></html>`, 401);
  }

  const db = env.DB;
  if (!db) return html('<pre>D1 not configured</pre>', 500);

  // Roster — all active HE kitchen cooks (include those with NULL odoo_employee_id
  // so new hires like Badol are visible, even before Odoo sync succeeds)
  const roster = await db.prepare(
    `SELECT pin, name, COALESCE(known_as, name) AS known_as, job_name,
            monthly_salary, daily_rate
       FROM hr_employees
      WHERE brand_label = ? AND department_name = ? AND is_active = 1
        AND pin IS NOT NULL AND pin != ''
      ORDER BY daily_rate DESC, name`
  ).bind(BRAND_FILTER, DEPT_FILTER).all();

  const cooks = roster.results || [];
  if (cooks.length === 0) return html('<pre>No kitchen cooks found</pre>', 500);

  const pinList = cooks.map(c => c.pin);
  const placeholders = pinList.map(() => '?').join(',');

  // Pull raw punches from 2026-04-19 08:00 (covers first HE shift-day) through now
  const punches = await db.prepare(
    `SELECT pin, punch_time
       FROM hr_cams_punches
      WHERE pin IN (${placeholders})
        AND punch_time >= '2026-04-19 08:00:00'
      ORDER BY pin, punch_time`
  ).bind(...pinList).all();

  // Group: pin → shiftDay → [punch_time, ...]
  const byPinSd = new Map();
  for (const p of (punches.results || [])) {
    const sd = shiftDayOf(p.punch_time);
    if (!sd) continue;
    const k = String(p.pin);
    if (!byPinSd.has(k)) byPinSd.set(k, new Map());
    const inner = byPinSd.get(k);
    if (!inner.has(sd)) inner.set(sd, []);
    inner.get(sd).push(p.punch_time);
  }

  // Build day ranges
  const aprDays = [];
  for (let i = 0; i < 12; i++) aprDays.push(addDays('2026-04-19', i));  // Apr 19..30
  const mayStart = '2026-05-01';
  const todaySd = todayShiftDayIST();
  const lastClosedSd = addDays(todaySd, -1);   // Today's shift is in progress — show through yesterday only
  const mayDays = [];
  for (let d = mayStart; d <= lastClosedSd; d = addDays(d, 1)) mayDays.push(d);

  function classify(taps) {
    if (!taps || taps.length === 0) return { kind: 'absent' };
    if (taps.length === 1) return { kind: 'single', tap: taps[0] };
    const first = taps[0];
    const last = taps[taps.length - 1];
    const hours = (parseIstWall(last) - parseIstWall(first)) / 3600000;
    return { kind: 'full', first, last, hours, count: taps.length };
  }

  function cellHtml(cls, isToday) {
    if (cls.kind === 'absent') {
      return `<td class="c-abs" title="ABSENT — 1 day deduction">—</td>`;
    }
    if (cls.kind === 'single') {
      return `<td class="c-single" title="Only 1 tap @ ${fmtHM(cls.tap)} — credited (forgot to tap out)">${fmtHM(cls.tap)}<sup>!</sup></td>`;
    }
    const hStr = cls.hours.toFixed(1) + 'h';
    const tip = `${fmtHM(cls.first)} → ${fmtHM(cls.last)} · ${cls.count} taps`;
    const todayBadge = isToday ? '<sup class="live">●</sup>' : '';
    return `<td class="c-full" title="${escapeHtml(tip)}">${hStr}${todayBadge}</td>`;
  }

  function buildTable(days, title, isMay) {
    const head = `<thead><tr><th class="sticky">Cook</th><th>₹/d</th>` +
      days.map(d => `<th${d === todaySd && isMay ? ' class="today"' : ''}>${d.slice(8)}</th>`).join('') +
      `<th>Full</th><th>1-tap</th><th>Abs</th><th>Hrs</th><th>Deduct ₹</th></tr></thead>`;

    let body = '<tbody>';
    let totDeduct = 0, totAbs = 0, totHrs = 0;
    for (const c of cooks) {
      const dailyRate = c.daily_rate || 0;
      const inner = byPinSd.get(String(c.pin)) || new Map();
      let full = 0, single = 0, abs = 0, hrs = 0, deduct = 0;
      const cells = days.map(d => {
        const cls = classify(inner.get(d));
        if (cls.kind === 'full') { full++; hrs += cls.hours; }
        else if (cls.kind === 'single') single++;
        else { abs++; deduct += dailyRate; }
        return cellHtml(cls, d === todaySd);
      }).join('');
      totDeduct += deduct; totAbs += abs; totHrs += hrs;
      const rateLabel = dailyRate ? `₹${dailyRate}` : '<span class="warn">?</span>';
      body += `<tr><td class="sticky cook"><b>${escapeHtml(c.known_as)}</b><div class="job">${escapeHtml(c.job_name || '')}</div></td>` +
              `<td>${rateLabel}</td>${cells}` +
              `<td>${full}</td><td>${single}</td><td class="${abs > 0 ? 'c-abs-num' : ''}">${abs}</td>` +
              `<td>${hrs.toFixed(1)}</td><td class="${deduct > 0 ? 'c-deduct' : ''}">${deduct > 0 ? '₹' + deduct.toLocaleString('en-IN') : '0'}</td></tr>`;
    }
    body += '</tbody>';
    body += `<tfoot><tr><td class="sticky" colspan="${2 + days.length + 3}"><b>${title} totals</b></td>` +
            `<td><b>${totHrs.toFixed(1)}</b></td>` +
            `<td><b class="c-deduct">₹${totDeduct.toLocaleString('en-IN')}</b></td></tr></tfoot>`;

    return `<div class="tablewrap"><h2>${title} <small>(${days.length} shift-days)</small></h2>` +
           `<div class="scroll"><table>${head}${body}</table></div></div>`;
  }

  const aprHtml = buildTable(aprDays, 'April 19 → 30', false);
  const mayLabel = mayDays.length ? `May 1 → ${lastClosedSd.slice(8)}` : 'May (no completed shift-days yet)';
  const mayHtml = mayDays.length ? buildTable(mayDays, mayLabel, true) : '';

  const sumPunches = (punches.results || []).length;
  const generatedAt = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');

  return html(`<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>HE Kitchen Attendance — CAMS Live</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { font: 13px/1.45 -apple-system,system-ui,sans-serif; background: #0c0c10; color: #e6e6e8; margin: 0; padding: 16px 12px 80px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; border-bottom: 1px solid #1f1f28; padding-bottom: 12px; margin-bottom: 16px; }
header h1 { margin: 0; font-size: 18px; font-weight: 700; }
header .meta { color: #6e6e7a; font-size: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #9999a3; margin: 10px 0 18px; }
.legend span b { color: #e6e6e8; }
.sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: -3px; margin-right: 5px; }
.sw.full { background: #0e3d22; }
.sw.single { background: #6b4a00; }
.sw.absent { background: #5a1414; }
.tablewrap { margin: 22px 0; }
.tablewrap h2 { margin: 0 0 8px; font-size: 15px; font-weight: 700; color: #f0a944; }
.tablewrap h2 small { color: #6e6e7a; font-weight: 400; }
.scroll { overflow-x: auto; border: 1px solid #1f1f28; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; min-width: 720px; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 8px; text-align: center; border-bottom: 1px solid #15151c; border-right: 1px solid #15151c; font-size: 12px; white-space: nowrap; }
th { background: #16161e; color: #9999a3; font-weight: 600; position: sticky; top: 0; }
th.today { color: #f0a944; }
td.sticky, th.sticky { position: sticky; left: 0; background: #0c0c10; text-align: left; z-index: 2; min-width: 130px; }
th.sticky { background: #16161e; }
td.cook .job { font-size: 10px; color: #6e6e7a; margin-top: 1px; }
td.c-full { background: rgba(34, 197, 94, 0.12); color: #d4f5d4; font-weight: 600; }
td.c-single { background: rgba(234, 179, 8, 0.16); color: #fde68a; font-weight: 600; }
td.c-single sup { color: #f97316; margin-left: 1px; }
td.c-abs { background: rgba(220, 38, 38, 0.18); color: #fca5a5; font-weight: 700; }
td.c-abs-num { color: #fca5a5; font-weight: 700; }
td.c-deduct { color: #fca5a5; font-weight: 700; }
sup.live { color: #22d3ee; margin-left: 2px; font-size: 9px; }
.warn { color: #f97316; font-weight: 700; }
tfoot td { background: #16161e; color: #fff; }
.rule { background: #16161e; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #e8930c; margin-bottom: 14px; font-size: 12px; color: #c3c3c8; }
.rule b { color: #fde68a; }
footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid #1f1f28; color: #6e6e7a; font-size: 11px; }
@media print { body { background: #fff; color: #000; padding: 0; } th, td { border-color: #ccc; } td.c-full { background: #e6f5e6; color: #064;} td.c-single { background: #fff3cd; color: #5a3e00;} td.c-abs { background: #fce8e8; color: #800;} td.sticky { background: #fff !important; } }
</style></head>
<body>
<header>
  <h1>HE Kitchen — Live Attendance</h1>
  <span class="meta">Generated ${escapeHtml(generatedAt)} IST · ${sumPunches} raw punches · ${cooks.length} cooks</span>
</header>

<div class="rule">
  <b>Rule applied:</b> 1 face-tap on a shift-day = <b>present</b> (credited, no deduction — assume they forgot to tap out).
  0 taps = <b>absent</b> (1 day deduction). 2+ taps = full present, hours = span first→last tap.
  Shift-day runs <b>09:00 → 08:59 next morning</b> so a 12 PM in / 1 AM out is one shift, not two.
</div>

<div class="legend">
  <span><span class="sw full"></span>Full present (hours shown) — 2+ taps, hours = first→last</span>
  <span><span class="sw single"></span>1-tap only (time shown + <b>!</b>) — credited, but ask why no out-tap</span>
  <span><span class="sw absent"></span>Absent (—) — counts toward deduction</span>
  <span><b>?</b> in ₹/d = rate not configured in system</span>
</div>

${aprHtml}
${mayHtml}

<footer>
  Data source: D1 <code>hr_cams_punches</code> via CAMS F38+ webhook. Shift-day grouping with 9 AM rollover.
  Tap any cell to read tooltip (desktop) — first/last tap times shown there.
  This page reflects live device state — refresh after a new punch lands.
</footer>
</body></html>`);
}
