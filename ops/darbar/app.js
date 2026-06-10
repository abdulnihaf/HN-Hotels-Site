/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DARBAR — the staffing command surface. Single owner-user, iOS PWA.
 * Reads the existing APIs (hr-admin, hr-payroll) + the new /api/darbar tissue.
 * The Today inbox is the only screen Nihaf must open daily; it empties itself
 * as he taps or as punches self-correct.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
'use strict';

const USERS = {
  '0305': { name: 'Nihaf',   role: 'admin',   fin: true  },
  '8523': { name: 'Basheer', role: 'manager', fin: false },
  '2026': { name: 'Zoya',    role: 'onboard', fin: false },
  '4040': { name: 'Haneef',  role: 'manager', fin: false },
  '5050': { name: 'Nissar',  role: 'manager', fin: false },
};

const S = {
  token: null, user: null, role: null, fin: false,
  tab: 'today',
  home: null,
  attendDate: null, attendBrand: 'all', attendRows: [], attendFilter: null,
  rosterBrand: 'all', employees: [],
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
// HE business day = IST now shifted back 4h
const bizDayIST = () => new Date(Date.now() + 5.5 * 3600e3 - 4 * 3600e3).toISOString().slice(0, 10);

/* ━━━ PIN gate — locked shell: 4 dots + 3×4 keypad, auto-submit on 4th digit ━━━ */
let pinEntry = '';
function renderDots() {
  const dots = $('pinDots').children;
  for (let i = 0; i < 4; i++) dots[i].classList.toggle('on', i < pinEntry.length);
}
function pinKey(k) {
  if (k === 'del') { pinEntry = pinEntry.slice(0, -1); $('pinErr').textContent = ''; renderDots(); return; }
  if (pinEntry.length >= 4) return;
  pinEntry += k; renderDots();
  if (pinEntry.length === 4) setTimeout(submitPin, 140);   // brief beat so the 4th dot shows
}
async function submitPin() {
  // Server-side PIN verification — the local USERS map is ONLY used for the UX
  // anticipation (instant dot fill). The actual auth happens on the server; the
  // server returns a signed HMAC token that goes out on every subsequent request.
  // The raw PIN / DASHBOARD_KEY never leaves the server.
  const u = USERS[pinEntry];  // optimistic UI only; server is the real gate
  try {
    const r = await fetch('/api/darbar?action=auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: pinEntry }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) {
      $('gate').classList.add('shake');
      $('pinErr').textContent = d.error === 'invalid PIN' ? 'Not recognised at this court.' : 'Could not reach the court.';
      setTimeout(() => { $('gate').classList.remove('shake'); pinEntry = ''; renderDots(); }, 460);
      if (navigator.vibrate) navigator.vibrate(60);
      return;
    }
    enterCourt(d.token, { name: d.user, role: d.role, fin: !!d.fin });
  } catch {
    $('pinErr').textContent = 'Connection error — try again.';
    setTimeout(() => { pinEntry = ''; renderDots(); $('pinErr').textContent = ''; }, 1200);
  }
}
function enterCourt(token, u) {
  S.token = token; S.user = u.name; S.role = u.role; S.fin = u.fin;
  sessionStorage.setItem('darbar_token', token);
  sessionStorage.setItem('darbar_user', JSON.stringify({ name: u.name, role: u.role, fin: u.fin }));
  $('gate').classList.add('hide');
  $('app').classList.remove('hide');
  S.attendDate = bizDayIST();
  setupNavCondense();
  loadHome();
}
$('keypad').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (b) pinKey(b.dataset.k);
});
// hardware keyboard (desktop testing) — digits + backspace
document.addEventListener('keydown', e => {
  if ($('gate').classList.contains('hide')) return;
  if (/^[0-9]$/.test(e.key)) pinKey(e.key);
  else if (e.key === 'Backspace') pinKey('del');
});
(function auto() {
  const tok = sessionStorage.getItem('darbar_token');
  const usr = sessionStorage.getItem('darbar_user');
  if (tok && usr) {
    try { enterCourt(tok, JSON.parse(usr)); } catch {}
  }
})();

/* ━━━ API — all requests carry the server-issued HMAC token ━━━ */
function authHeaders() {
  return S.token
    ? { 'x-darbar-token': S.token }
    : {};
}
async function api(path) {
  const r = await fetch(path, { headers: authHeaders() });
  if (r.status === 401) { signOut(); throw new Error('session expired'); }
  return r.json();
}
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); throw new Error('session expired'); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function needToken() { if (!S.token) { toast('Session expired — re-enter PIN', 'err'); signOut(); return true; } return false; }

/* ━━━ Tabs + nav condense ━━━ */
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('hide', p.dataset.tab !== t));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  if (t === 'today') loadHome();
  if (t === 'attend') loadAttend();
  if (t === 'pay') loadPay();
  if (t === 'roster') loadRoster();
}
function setupNavCondense() {
  document.querySelectorAll('.pane').forEach(pane => {
    const nav = pane.querySelector('.nav');
    pane.addEventListener('scroll', () => { if (nav) nav.classList.toggle('cond', pane.scrollTop > 24); }, { passive: true });
  });
}

/* ━━━ Toast + sheet ━━━ */
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function sheet(html) {
  const host = $('sheetHost');
  host.innerHTML = `<div class="ov" onclick="if(event.target===this)closeSheet()"><div class="sheet">${html}</div></div>`;
}
function closeSheet() { $('sheetHost').innerHTML = ''; }

/* ━━━━━━━━━━━━━━ TODAY (exception inbox) ━━━━━━━━━━━━━━ */
async function loadHome() {
  try {
    const h = await api('/api/darbar?action=home');
    S.home = h;
    $('todayDate').textContent = fmtDayShort(h.business_day);
    renderHero(h.stats);
    renderInbox(h.exceptions || []);
    const n = h.exception_count || 0;
    $('excCount').textContent = n ? `${n} to handle` : 'all clear';
    const dot = $('todayDot');
    if (n) { dot.textContent = n; dot.classList.remove('hide'); } else dot.classList.add('hide');
    const age = h.health?.cams_last_punch_age_min;
    const dev = !h.health ? ''
      : h.health.cams_ok
        ? (age > 90 ? `last punch ${age}m · <span style="color:var(--dim)">normal lull</span>` : `device <b>live</b> (${age}m ago)`)
        : `<b style="color:var(--red)">device silent ${age}m — check it</b>`;
    $('todaySub').innerHTML = `${h.stats.present} present · ` + dev;
  } catch (e) { $('inbox').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
}
function renderHero(s) {
  $('hero').innerHTML = [
    ['present', 'Present', 'g', s.present || 0],
    ['work', 'Working', 'b', s.missing_punch || 0],
    ['absent', 'Absent', 'r', (s.absent || 0) + (s.in_progress || 0)],
    ['exp', 'Expected', '', s.expected || 0],
  ].map(([k, l, c, n]) => `<div class="stat ${c}"><div class="n num">${n}</div><div class="l">${l}</div></div>`).join('');
}
function renderInbox(exc) {
  if (!exc.length) { $('inbox').innerHTML = `<div class="empty"><div class="big">✓</div>The court is quiet. Nothing needs you.</div>`; return; }
  $('inbox').innerHTML = exc.map(cardFor).join('');
}
function cardFor(x) {
  if (x.type === 'departed') {
    const pay = x.monthly_salary ? `${inr(x.monthly_salary)}/mo` : x.daily_rate ? `${inr(x.daily_rate)}/day` : '';
    const tierPill = x.tier === 'certain' ? '<span class="pill red">gone 21d+</span>' : x.tier === 'strong' ? '<span class="pill yellow">14d+</span>' : '<span class="pill grey">7d+</span>';
    return `<div class="card xcard departed">
      <div class="xc-top"><div><div class="xc-name">${esc(x.name)} <span class="pill ${x.brand.toLowerCase()}">${x.brand}</span></div>
        <div class="xc-meta">Silent <b>${x.days_silent}d</b> · still on payroll ${pay ? `at <b>${pay}</b>` : ''}<br>last punch ${x.last_punch ? esc(x.last_punch.slice(0, 10)) : 'never'}</div></div>${tierPill}</div>
      <div class="acts">
        <button class="btn danger" onclick='confirmExit(${x.id}, ${JSON.stringify(x.name)})'>Mark left</button>
        <button class="btn dark" onclick='leaveSheet(${x.id}, ${JSON.stringify(x.name)})'>On leave</button>
        <button class="btn ghost-b sm" onclick='keepActive(${x.id})'>Keep</button>
      </div></div>`;
  }
  if (x.type === 'ghost') {
    const nm = x.device_name ? `${esc(x.device_name)} <span class="pill purple">PIN ${esc(x.pin)} · no roster</span>` : `Unknown — PIN ${esc(x.pin)} <span class="pill purple">ghost</span>`;
    return `<div class="card xcard ghost">
      <div class="xc-top"><div><div class="xc-name">${nm}</div>
        <div class="xc-meta">${x.device_name ? `device says <b>${esc(x.device_name)}</b> · ` : ''}<b>${x.punches}</b> punches over <b>${x.days}</b> days · ${esc(x.shape)}<br>${x.active ? '<b style="color:var(--green)">working now</b>' : `last seen ${x.days_silent}d ago`}</div></div></div>
      <div class="acts">
        <button class="btn primary" onclick='nameGhost(${JSON.stringify(x.pin)}, ${JSON.stringify(x.device_name || '')})'>Add to roster</button>
        <button class="btn ghost-b" onclick='dismissGhost(${JSON.stringify(x.pin)})'>Ignore</button>
      </div></div>`;
  }
  if (x.type === 'chronic') {
    return `<div class="card xcard chronic">
      <div class="xc-top"><div><div class="xc-name">${esc(x.name)} <span class="pill ${x.brand.toLowerCase()}">${x.brand}</span></div>
        <div class="xc-meta">Forgot a punch on <b>${x.odd_days}</b> of the last 7 days — needs a word, not another SMS.</div></div><span class="pill yellow">chronic</span></div></div>`;
  }
  if (x.type === 'pay_missing') {
    return `<div class="card xcard chronic">
      <div class="xc-top"><div><div class="xc-name">${esc(x.name)} <span class="pill ${(x.brand || '').toLowerCase()}">${x.brand || ''}</span></div>
        <div class="xc-meta">No pay set — the system can't show money facts for them. Their settlement line is held until you set it.</div></div><span class="pill gold">pay not set</span></div>
      <div class="acts"><button class="btn primary" onclick='setPaySheet(${x.id}, ${JSON.stringify(x.name)})'>Set pay</button></div></div>`;
  }
  if (x.type === 'never_punched') {
    return `<div class="card xcard never">
      <div class="xc-top"><div><div class="xc-name">${esc(x.name)} <span class="pill ${x.brand.toLowerCase()}">${x.brand}</span></div>
        <div class="xc-meta">On roster (PIN ${esc(x.pin)}) but has <b>never punched</b> — enrolled on the device, or not really working?</div></div><span class="pill blue">no punches</span></div></div>`;
  }
  return '';
}

/* ━━━ inbox actions ━━━ */
function confirmExit(id, name) {
  if (needToken()) return;
  sheet(`<h2>Mark ${esc(name)} as left</h2>
    <div class="sd">Stops counting them, archives the roster row, drafts a final settlement. The roster self-corrects.</div>
    <div class="fld"><label>Reason (optional)</label><input id="exReason" placeholder="stopped coming / found other work"></div>
    <div class="fld"><label>Final settlement ₹ (optional, owner-entered)</label><input id="exFnf" type="number" inputmode="numeric" placeholder="leave blank to draft later"></div>
    <div class="acts">
      <button class="btn danger" onclick='doExit(${id})'>Confirm — they've left</button>
      <button class="btn ghost-b" onclick="closeSheet()">Cancel</button>
    </div>`);
}
async function doExit(id) {
  try {
    await post('/api/darbar?action=mark-exit', { employee_id: id, reason: $('exReason').value || null, fnf_amount: $('exFnf').value ? Number($('exFnf').value) : null });
    closeSheet(); toast('Marked left · roster updated'); loadHome();
  } catch (e) { toast(e.message, 'err'); }
}
function leaveSheet(id, name) {
  if (needToken()) return;
  const t = todayIST();
  sheet(`<h2>${esc(name)} — on leave</h2><div class="sd">Suppresses the alerts and feeds payroll. Not gone, just away.</div>
    <div class="fld"><label>From</label><input id="lvFrom" type="date" value="${t}"></div>
    <div class="fld"><label>To</label><input id="lvTo" type="date" value="${t}"></div>
    <div class="fld"><label>Type</label><select id="lvType"><option value="unpaid">Unpaid (LOP)</option><option value="paid">Paid</option><option value="sick">Sick</option></select></div>
    <div class="acts"><button class="btn primary" onclick='doLeave(${id})'>Save leave</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
}
async function doLeave(id) {
  try {
    await post('/api/darbar?action=mark-leave', { employee_id: id, start_date: $('lvFrom').value, end_date: $('lvTo').value, leave_type: $('lvType').value });
    closeSheet(); toast('Leave recorded'); loadHome();
  } catch (e) { toast(e.message, 'err'); }
}
function keepActive() { toast('Kept active — will re-ask if still silent', 'info'); }

function nameGhost(pin, deviceName) {
  if (needToken()) return;
  sheet(`<h2>Name PIN ${esc(pin)}</h2><div class="sd">Turn this working ghost into a real roster member. Attendance counts from their first punch, retroactively.</div>
    <div id="obPhoto" style="display:flex;justify-content:center;margin-bottom:10px"></div>
    <div class="fld"><label>Name</label><input id="obName" value="${esc(deviceName || '')}" placeholder="full name"></div>
    <div class="fld"><label>Brand</label><select id="obBrand"><option value="NCH">Nawabi Chai House</option><option value="HE">Hamza Express</option><option value="HQ">HQ</option></select></div>
    <div class="fld"><label>Pay type</label><select id="obPay" onchange="document.getElementById('obWageWrap').dataset.t=this.value"><option value="Contract">Daily wage</option><option value="Monthly">Monthly</option></select></div>
    <div class="fld" id="obWageWrap" data-t="Contract"><label>Daily rate ₹ / Monthly ₹</label><input id="obWage" type="number" inputmode="numeric" placeholder="e.g. 600"></div>
    <div class="fld"><label>Phone (for punch-reminders)</label><input id="obPhone" type="tel" inputmode="numeric" placeholder="10-digit"></div>
    <div class="acts"><button class="btn primary" onclick='doOnboard(${JSON.stringify(pin)})'>Add to roster</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
  // The face the device enrolled — so the owner knows exactly WHO this is.
  api(`/api/darbar?action=ghost-photo&pin=${encodeURIComponent(pin)}`).then(p => {
    if (p && p.photo_base64 && $('obPhoto')) $('obPhoto').innerHTML =
      `<img src="data:image/jpeg;base64,${p.photo_base64}" alt="" style="width:96px;height:96px;border-radius:14px;object-fit:cover;border:1px solid var(--line)">`;
  }).catch(() => {});
}
async function doOnboard(pin) {
  const pay = $('obPay').value, wage = Number($('obWage').value) || null;
  try {
    await post('/api/darbar?action=onboard', {
      pin, name: $('obName').value.trim(), brand: $('obBrand').value, pay_type: pay,
      monthly_salary: pay === 'Monthly' ? wage : null, daily_rate: pay === 'Contract' ? wage : null,
      phone: $('obPhone').value.trim() || null,
    });
    closeSheet(); toast('Added to roster · sync to Odoo from Roster ↻'); loadHome();
  } catch (e) { toast(e.message, 'err'); }
}
async function dismissGhost(pin) {
  if (needToken()) return;
  try { await post('/api/darbar?action=dismiss-ghost', { pin }); toast('Ghost dismissed'); loadHome(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ━━━━━━━━━━━━━━ ATTENDANCE ━━━━━━━━━━━━━━ */
document.querySelectorAll('#attBrand button').forEach(b => b.onclick = () => {
  S.attendBrand = b.dataset.b;
  document.querySelectorAll('#attBrand button').forEach(x => x.classList.toggle('on', x === b));
  renderAttend();
});
function shiftDay(d) { const x = new Date(S.attendDate + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); S.attendDate = x.toISOString().slice(0, 10); loadAttend(); }
function jumpToday() { S.attendDate = bizDayIST(); loadAttend(); }
async function refreshAttend() {
  // server-side recompute picks up new punches, then reload
  try { toast('Pulling punches…', 'info'); await post('/api/hr-admin', { action: 'pull-attendance', pin: S.pin, from: S.attendDate, to: S.attendDate }); } catch (e) {}
  loadAttend();
}
async function loadAttend() {
  $('attDay').textContent = fmtDayShort(S.attendDate);
  $('attList').innerHTML = '<div class="skel"></div><div class="skel"></div>';
  try {
    const r = await api(`/api/hr-admin?action=attendance-daily&date=${S.attendDate}&pin=${S.pin}`);
    S.attendRows = r.rows || [];
    renderAttend();
  } catch (e) { $('attList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function attState(r) {
  // Owner's canonical rule: ANY tap = present; 0 taps = absent; odd = a punch
  // missing. BUT on the still-open business day (closes 4am) an odd count just
  // means MID-SHIFT — working or on break — never an error, never a Fix button.
  // Errors only exist on CLOSED days. 0 taps on the open day = "not in yet".
  const live = S.attendDate === bizDayIST();
  if (r.status === 'week_off' || r.status === 'leave') return { k: 'off', incomplete: false, working: false, label: r.status === 'leave' ? 'LEAVE' : 'WEEK OFF' };
  const pc = r.punch_count || 0;
  if (pc >= 1) {
    const odd = pc % 2 === 1;
    if (live && odd) return { k: 'present', incomplete: false, working: true, label: 'WORKING' };
    return { k: 'present', incomplete: odd, working: false, label: odd ? (pc === 1 ? 'IN — NO OUT' : 'MISSING PUNCH') : 'PRESENT' };
  }
  return { k: 'absent', incomplete: false, working: false, label: live ? 'NOT IN YET' : 'ABSENT' };
}
function attMatch(r, f) {
  const st = attState(r);
  if (f === 'incomplete') return st.k === 'present' && st.incomplete;
  return st.k === f;
}
function setAttendFilter(k) { S.attendFilter = (S.attendFilter === k) ? null : k; renderAttend(); }
function renderAttend() {
  let rows = S.attendRows;
  if (S.attendBrand !== 'all') rows = rows.filter(r => r.brand_label === S.attendBrand);
  // stats (clickable — tap a card to see exactly those people). Present = ANY tap;
  // Incomplete = present but a punch missing (subset of Present, the ones to fix).
  const c = { present: 0, incomplete: 0, absent: 0, off: 0 };
  rows.forEach(r => { const st = attState(r); if (st.k === 'present') { c.present++; if (st.incomplete) c.incomplete++; } else { c[st.k]++; } });
  const f = S.attendFilter;
  $('attStats').innerHTML = [
    ['Present', 'g', c.present, 'present'], ['⚠ Fix', 'y', c.incomplete, 'incomplete'], ['Absent', 'r', c.absent, 'absent'], ['Off', '', c.off, 'off'],
  ].map(([l, cl, n, k]) => `<div class="stat ${cl}" onclick="setAttendFilter('${k}')" style="cursor:pointer${f === k ? ';outline:2px solid var(--gold);outline-offset:-2px' : ''}"><div class="n num">${n}</div><div class="l">${l}</div></div>`).join('');

  // list: filtered to the tapped card if any; incomplete first (need a fix), then present, absent, off
  let list = f ? rows.filter(r => attMatch(r, f)) : rows;
  const order = (r) => { const st = attState(r); if (st.k === 'present') return st.incomplete ? 0 : 1; return st.k === 'absent' ? 2 : 3; };
  list = [...list].sort((a, b) => order(a) - order(b));
  if (!list.length) { $('attList').innerHTML = `<div class="empty">${f ? 'No one in “' + (f === 'incomplete' ? 'to fix' : f) + '” on this day.' : 'No one on this day.'}</div>`; return; }
  const hdr = f ? `<div class="xc-meta" style="margin:2px 0 8px 2px">Showing ${list.length} ${f === 'incomplete' ? 'with a missing punch' : f} — tap the card again to clear</div>` : '';
  $('attList').innerHTML = hdr + list.map(r => {
    const st = attState(r); const nm = r.known_as && r.known_as !== r.name ? `${esc(r.name)} <span style="color:var(--mute)">(${esc(r.known_as)})</span>` : esc(r.name);
    const sess = sessionLine(r);
    const fixBtn = (st.k === 'present' && st.incomplete) ? `<button class="btn primary sm" style="margin-top:9px" onclick='fixPunch(${r.employee_id}, ${JSON.stringify(S.attendDate)})'>Fix — impute missing punch</button>` : '';
    const dot = st.working ? 'inprog' : st.k === 'present' ? (st.incomplete ? 'missing' : 'present') : st.k;
    const pill = st.working ? 'blue' : st.k === 'present' ? (st.incomplete ? 'yellow' : 'green') : st.k === 'absent' ? 'red' : 'purple';
    return `<div class="arow"><div class="top"><div>
        <div class="nm"><span class="sdot ${dot}"></span>${nm} <span class="pill ${(r.brand_label||'').toLowerCase()}">${r.brand_label||''}</span></div>
        <div class="role">${esc(r.job_name || r.department_name || '')}</div>
        <div class="sess">${sess}</div></div>
        <span class="pill ${pill}">${st.label}</span></div>
        ${fixBtn}</div>`;
  }).join('');
}
function sessionLine(r) {
  if ((r.punch_count || 0) === 0) return '<span style="color:var(--mute)">no punches</span>';
  const t = s => s ? esc(s.slice(11, 16)) : '—';
  const hrs = r.total_hours ? ` · ${Number(r.total_hours).toFixed(1)}h` : '';
  const br = r.break_taken_minutes ? ` · break ${r.break_taken_minutes}m` : '';
  const pc = `${r.punch_count} tap${r.punch_count > 1 ? 's' : ''}`;
  return `${t(r.first_in_at)} → ${r.last_out_at ? t(r.last_out_at) : '<span style="color:var(--blue)">open</span>'}${hrs}${br} · ${pc}`;
}
async function fixPunch(empId, date) {
  if (needToken()) return;
  try { await post('/api/darbar?action=fix-punch', { employee_id: empId, date }); toast('Checkout imputed'); loadAttend(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ━━━━━━━━━━━━━━ PAY ━━━━━━━━━━━━━━ */
// Active settlement month: salaries for month M are paid by the 10th of M+1.
// So the 1st→10th you're still CLEARING the previous month — that's the default
// view. After the 10th the current month becomes active. (You're settling May
// during June 1–10, not June.) Navigator lets you reach any month — nothing is lost.
function activeSettlementMonth() {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (d.getUTCDate() <= 10) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function payPeriod() { return S.payMonth || (S.payMonth = activeSettlementMonth()); }
function changePayMonth(delta) {
  let [y, m] = payPeriod().split('-').map(Number);
  m += delta; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  S.payMonth = `${y}-${String(m).padStart(2, '0')}`;
  loadPay();
}
async function loadPay() {
  const month = payPeriod();
  const monthLbl = monthLabel(month);
  const isActive = month === activeSettlementMonth();
  const hint = isActive ? 'Salary period being cleared now — paid by the 10th' : 'Browsing — ◄ ► to change month';
  $('settleBanner').innerHTML = `<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <button class="btn ghost-b" style="min-width:48px;font-size:18px" onclick="changePayMonth(-1)">◄</button>
      <div style="text-align:center"><b style="font-size:17px">${esc(monthLbl)}</b><div class="xc-meta">${hint}</div></div>
      <button class="btn ghost-b" style="min-width:48px;font-size:18px" onclick="changePayMonth(1)">►</button>
    </div></div>`;
  $('advMonth').textContent = monthLbl;
  if (!S.token) { $('advList').innerHTML = '<div class="empty">Enter your PIN to load payments.</div>'; return; }
  $('advList').innerHTML = '<div class="skel"></div>';
  try {
    const r = await fetch(`/api/hr-payroll?action=list-advances&month=${month}`, { headers: authHeaders() }).then(x => x.json());
    const adv = r.advances || r.rows || [];
    if (!adv.length) { $('advList').innerHTML = `<div class="empty">No payments recorded for ${esc(monthLbl)} yet.</div>`; return; }
    // Group BY PERSON — show what's DONE this month (total paid), not per-transaction.
    const byEmp = {};
    adv.forEach(a => {
      const id = a.employee_id;
      if (!byEmp[id]) byEmp[id] = { name: a.employee_known_as || a.employee_name || a.name || a.known_as || ('Emp #' + id), brand: a.brand_label || '', advTotal: 0, setTotal: 0 };
      if (a.source === 'settlement') byEmp[id].setTotal += Number(a.amount || 0);
      else byEmp[id].advTotal += Number(a.amount || 0);
    });
    const people = Object.values(byEmp).sort((x, y) => (y.advTotal + y.setTotal) - (x.advTotal + x.setTotal));
    $('advList').innerHTML = people.map(p => {
      const total = p.advTotal + p.setTotal;
      const settled = p.setTotal > 0;
      const badge = settled
        ? '<span class="pill" style="background:var(--green-soft);color:var(--green)">✓ Settled</span>'
        : '<span class="pill" style="background:var(--gold-soft);color:var(--gold)">advance only</span>';
      const parts = [p.advTotal ? `advance ${inr(p.advTotal)}` : '', p.setTotal ? `settlement ${inr(p.setTotal)}` : ''].filter(Boolean).join(' + ');
      return `<div class="card"><div class="xc-top">
        <div><div class="xc-name">${esc(p.name)} ${p.brand ? `<span class="pill ${(p.brand || '').toLowerCase()}">${esc(p.brand)}</span>` : ''} ${badge}</div>
        <div class="xc-meta">${esc(parts)}${settled ? ' · month complete' : ''}</div></div>
        <div class="num" style="font-weight:800;font-size:17px">${inr(total)}</div></div></div>`;
    }).join('');
  } catch (e) { $('advList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
/* ━━━ MONTH BOARD — who's done, who's left, facts only ━━━ */
async function openMonthBoard() {
  if (needToken()) return;
  const month = payPeriod();
  sheet(`<h2>${esc(monthLabel(month))} — board</h2><div class="skel"></div><div class="skel"></div>`);
  let b;
  try { b = await api(`/api/darbar?action=month-board&month=${month}`); }
  catch (e) { return sheet(`<h2>Board</h2><div class="empty">${esc(e.message)}</div><div class="acts"><button class="btn ghost-b" onclick="closeSheet()">Close</button></div>`); }
  const rows = b.rows || [];
  const chip = r => r.settled > 0 ? `<span class="pill green">✓ ${inr(r.settled)}</span>`
    : r.advances > 0 ? `<span class="pill gold">adv ${inr(r.advances)}</span>`
    : `<span class="pill grey">nothing yet</span>`;
  const done = rows.filter(r => r.settled > 0).length;
  sheet(`<h2>${esc(monthLabel(month))} — board</h2>
    <div class="sd">${done}/${rows.length} settled · tap a row — facts come up, you decide</div>
    ${rows.map(r => `<div class="arow" onclick='closeSheet();loadPayCtx("settle", ${r.id}, ${JSON.stringify(b.month)})' style="margin-bottom:8px"><div class="top">
      <div><div class="nm">${esc(r.name)} <span class="pill ${(r.brand || '').toLowerCase()}">${r.brand || ''}</span>${r.is_active ? '' : ' <span class="pill grey">left</span>'}</div>
      <div class="role">worked <b>${r.days_worked}</b>d${r.days_error ? ` · ${r.days_error} punch-missing` : ''} · adv ${inr(r.advances)}</div></div>
      ${chip(r)}</div></div>`).join('')}
    <div class="acts"><button class="btn ghost-b" onclick="closeSheet()">Close</button></div>`);
}

/* ━━━ Unified pay context — settle OR advance, month chips + visual grid ━━━
 * Owner rules (2026-06-10): three SEPARATE fact lanes, no fused math; the
 * attendance grid comes up BEFORE any money moves; settling defaults to the
 * month being cleared (May until the 10th), an advance defaults to the
 * CURRENT month — one tap flips it. */
function currentMonthIST() { return todayIST().slice(0, 7); }
function prevMonthIST() {
  const [y, m] = currentMonthIST().split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function attGridHTML(c) {
  const month = c.month, days = (c.attendance && c.attendance.days) || [];
  const map = {}; days.forEach(d => { map[d.date] = d; });
  const [y, m] = month.split('-').map(Number);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const biz = bizDayIST();
  const wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="agw">${x}</div>`).join('');
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="agc blank"></div>';
  for (let d = 1; d <= nDays; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const r = map[ds];
    let cls = 'nodata';
    if (ds > biz) cls = 'future';
    else if (ds === biz) cls = 'open';                       // today — still open till 4am
    else if (r) {
      if (r.status === 'week_off' || r.status === 'leave') cls = 'off';
      else if ((r.punch_count || 0) === 0) cls = 'absent';
      else cls = (r.punch_count % 2 === 1) ? 'err' : 'ok';   // any tap = worked; odd = punch missing
    }
    cells += `<div class="agc ${cls}">${d}</div>`;
  }
  const isCur = month === currentMonthIST();
  return `<div class="agrid">${wd}${cells}</div>
    <div class="aleg"><span><i class="ok"></i>worked</span><span><i class="err"></i>punch missing</span><span><i class="absent"></i>absent</span><span><i class="off"></i>off</span>${isCur ? '<span><i class="open"></i>today — closes 4am</span>' : ''}</div>`;
}

async function openSettle() {
  if (!S.fin) return toast('Pay is owner-only', 'info');
  openPay('settle');
}
async function openAdvance() { openPay('advance'); }

async function openPay(mode) {
  if (needToken()) return;
  if (!S.employees.length) { try { S.employees = (await api('/api/hr-admin?action=employees&active=1')).employees || []; } catch {} }
  const opts = S.employees.filter(e => e.is_active).map(e => `<option value="${e.id}">${esc(e.known_as || e.name)} · ${esc(e.brand_label || '')}</option>`).join('');
  if (!opts) return toast('No staff loaded — re-enter PIN', 'err');
  const title = mode === 'settle' ? 'Settle a person' : 'Pay advance';
  const sub = mode === 'settle'
    ? "Pick who you're paying — their month comes up first: attendance, advances, settled."
    : 'Attendance comes up first — you never pay blind. Advance lands on the month you choose.';
  sheet(`<h2>${title}</h2><div class="sd">${sub}</div>
    <div class="fld"><label>Worker</label><select id="payEmp">${opts}</select></div>
    <div class="acts"><button class="btn primary" onclick="loadPayCtx('${mode}')">See & ${mode === 'settle' ? 'settle' : 'pay'}</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
}

async function loadPayCtx(mode, empId, month) {
  empId = empId || ($('payEmp') && $('payEmp').value);
  if (!empId) return;
  month = month || (mode === 'settle' ? payPeriod() : currentMonthIST());
  sheet(`<h2>Loading…</h2><div class="skel"></div><div class="skel"></div>`);
  let c;
  try { c = await api(`/api/hr-payroll?action=settle-context&employee_id=${empId}&month=${month}`); }
  catch (e) { return sheet(`<h2>${mode === 'settle' ? 'Settle' : 'Advance'}</h2><div class="empty">${esc(e.message)}</div><div class="acts"><button class="btn ghost-b" onclick="closeSheet()">Close</button></div>`); }
  if (!c || c.error || !c.employee) return sheet(`<h2>${mode === 'settle' ? 'Settle' : 'Advance'}</h2><div class="empty">${esc((c && c.error) || 'no data')}</div><div class="acts"><button class="btn ghost-b" onclick="closeSheet()">Close</button></div>`);
  const a = c.attendance, emp = c.employee;
  // Always offer last month + this month (the two real-life cases: clearing
  // the previous month vs paying against the running one) + whatever month
  // the sheet is on. Older months stay reachable via the Pay-tab navigator.
  const months = [...new Set([prevMonthIST(), currentMonthIST(), month])];
  const chips = months.map(mm =>
    `<button class="mchip ${mm === month ? 'on' : ''}" onclick="loadPayCtx('${mode}', ${emp.id}, '${mm}')">${esc(monthLabel(mm))}${mm === currentMonthIST() ? ' · live' : ''}</button>`).join('');
  const rmark = r => r.receipt_status === 'sent' ? ' ✓' : r.receipt_status === 'failed' ? ' ✗' : r.receipt_status === 'no_phone' ? ' (no phone)' : '';
  const advs = (c.advances.rows || []).map(r => `${inr(r.amount)} · ${String(r.advance_date).slice(5)} · ${esc(r.paid_via || '')}${rmark(r)}`).join('   ') || 'none';
  const setts = ((c.settlements && c.settlements.rows) || []).map(r => `${inr(r.amount)} · ${String(r.advance_date || '').slice(5)} · ${esc(r.paid_via || '')}${rmark(r)}`).join('   ') || 'none';
  const salaryLbl = emp.monthly_salary ? inr(emp.monthly_salary) + '/mo' : emp.daily_rate ? inr(emp.daily_rate) + '/day' : '—';
  const verb = mode === 'settle' ? 'Record settlement' : 'Give advance';
  sheet(`<h2>${mode === 'settle' ? 'Settle' : 'Advance'} — ${esc(emp.name)}</h2>
    <div class="sd">${esc(emp.brand || '')} · ${esc(emp.pay_type || '')} · ${salaryLbl}</div>
    <div class="mchips">${chips}</div>
    <div class="card"><div class="xc-meta"><b>1 · Attendance</b> — ${esc(monthLabel(month))}</div>
      ${attGridHTML(c)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
        <span class="pill green">worked ${a.present}</span>
        ${a.irregular ? `<span class="pill yellow">punch missing ${a.irregular}</span>` : ''}
        <span class="pill ${a.absent ? 'red' : 'grey'}">absent ${a.absent}</span>
        ${a.off ? `<span class="pill purple">off ${a.off}</span>` : ''}</div></div>
    <div class="card"><div class="xc-top"><div><b>2 · Advances given</b> <span class="xc-meta">${esc(monthLabel(month))}</span></div><div class="num" style="font-weight:800">${inr(c.advances.total)}</div></div>
      <div class="xc-meta">${esc(advs)}</div></div>
    <div class="card"><div class="xc-top"><div><b>3 · Settled</b></div><div class="num" style="font-weight:800">${inr((c.settlements && c.settlements.total) || 0)}</div></div>
      <div class="xc-meta">${esc(setts)}</div></div>
    <div class="fld"><label>${mode === 'settle' ? 'You paid ₹ — your number' : 'Advance amount ₹'}</label><input id="payAmt" type="number" inputmode="numeric" placeholder="your number"></div>
    <div class="fld"><label>📲 Receipt goes to — confirm ${esc(emp.name)}'s number</label><input id="payPhone" type="tel" inputmode="numeric" value="${esc(emp.phone || '')}" placeholder="10-digit WhatsApp number"></div>
    <div class="fld"><label>Paid via</label><select id="payVia"><option>cash</option><option>upi</option><option>bank</option><option>razorpay</option><option>paytm</option></select></div>
    <div class="fld"><label>Note (optional)</label><input id="payNote" placeholder="${mode === 'settle' ? 'final settlement / partial' : 'reason'}"></div>
    <div class="acts"><button class="btn primary" onclick='doPay("${mode}", ${emp.id}, ${JSON.stringify(month)})'>${verb} — ${esc(monthLabel(month))}</button><button class="btn ghost-b sm" onclick='overrideSheet(${emp.id}, ${JSON.stringify(emp.name)})'>Over-write</button><button class="btn ghost-b sm" onclick="closeSheet()">Cancel</button></div>`);
}

async function doPay(mode, empId, month) {
  const amt = Number($('payAmt').value);
  if (!amt) return toast(mode === 'settle' ? 'Type what you paid' : 'Enter an amount', 'err');
  const body = {
    employee_id: Number(empId), amount: amt, advance_date: todayIST(),
    paid_via: ($('payVia') || {}).value || 'cash',
    confirmed_phone: ($('payPhone') || {}).value || '', pay_period: month,
  };
  if (mode === 'settle') { body.source = 'settlement'; body.reason = 'salary settlement'; body.notes = ($('payNote') || {}).value || ('Settlement ' + month); }
  else { body.reason = ($('payNote') || {}).value || null; }
  try {
    const r = await fetch('/api/hr-payroll?action=record-advance', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'failed');
    closeSheet(); toast(receiptToast(mode === 'settle' ? 'Settlement recorded' : 'Advance recorded', j.receipt)); loadPay();
  } catch (e) { toast(e.message, 'err'); }
}

// Reflect whether the WhatsApp receipt actually went out, in the confirmation toast.
function receiptToast(base, rc) {
  if (!rc) return base;
  if (rc.ok) return base + ' \u00b7 receipt sent';
  if (rc.reason === 'no_phone' || rc.attempted === false) return base + ' \u00b7 no number on file, no receipt';
  return base + ' \u00b7 recorded, receipt didn\u2019t send';
}

/* ━━━━━━━━━━━━━━ ROSTER ━━━━━━━━━━━━━━ */
document.querySelectorAll('#rosterBrand button').forEach(b => b.onclick = () => {
  S.rosterBrand = b.dataset.b;
  document.querySelectorAll('#rosterBrand button').forEach(x => x.classList.toggle('on', x === b));
  renderRoster();
});
async function loadRoster() {
  $('rosterList').innerHTML = '<div class="skel"></div>';
  try { S.employees = (await api(`/api/hr-admin?action=employees&active=1`)).employees || []; renderRoster(); }
  catch (e) { $('rosterList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function renderRoster() {
  let rows = S.employees.filter(e => e.is_active);
  if (S.rosterBrand !== 'all') rows = rows.filter(e => e.brand_label === S.rosterBrand);
  $('rosterSub').textContent = `${rows.length} serving · tap a person for their month`;
  if (!rows.length) { $('rosterList').innerHTML = '<div class="empty">No one here.</div>'; return; }
  // Monthly staffing cost = each person's full-month pay (monthly salary, or daily×30),
  // at 100% attendance, before overtime/extras. Owner-only; recomputes per brand filter.
  const costOf = e => Number(e.monthly_salary) || (Number(e.daily_rate) || 0) * 30 || 0;
  const total = rows.reduce((s, e) => s + costOf(e), 0);
  const missing = rows.filter(e => !costOf(e)).length;
  const where = S.rosterBrand === 'all' ? 'all outlets' : S.rosterBrand;
  const costCard = S.fin ? `<div class="card" style="border-color:var(--gold-soft);margin-bottom:10px"><div class="xc-top">
      <div><b>Monthly staffing cost</b><div class="xc-meta">${where} · ${rows.length} staff · full attendance, before OT${missing ? ` · <span style="color:var(--red)">${missing} missing salary</span>` : ''}</div></div>
      <div class="num" style="font-weight:800;color:var(--gold);font-size:19px">${inr(total)}</div></div></div>` : '';
  $('rosterList').innerHTML = costCard + rows.map(e => {
    const pay = S.fin ? (e.pay_type === 'Contract' && e.daily_rate ? `${inr(e.daily_rate)}/day` : e.monthly_salary ? `${inr(e.monthly_salary)}/mo` : e.daily_rate ? `${inr(e.daily_rate)}/day` : '—') : '';
    const noPin = !e.pin ? '<span class="pill yellow">no pin</span>' : '';
    return `<div class="arow" onclick='rosterTap(${e.id})'><div class="top">
      <div><div class="nm">${esc(e.known_as || e.name)} <span class="pill ${(e.brand_label||'').toLowerCase()}">${e.brand_label||''}</span> ${noPin}</div>
      <div class="role">${esc(e.job_name || '')} ${e.pin ? '· PIN ' + esc(e.pin) : ''} · ${esc(e.pay_type || '')}</div></div>
      ${pay ? `<div style="font-weight:700;font-size:14px" class="num">${pay}</div>` : ''}</div></div>`;
  }).join('');
}
function setPaySheet(id, name) {
  if (!S.fin) return toast('Pay is owner-only', 'info');
  if (needToken()) return;
  sheet(`<h2>${esc(name)} — set pay</h2><div class="sd">One number, once. Their card unlocks everywhere the moment you save.</div>
    <div class="fld"><label>Pay type</label><select id="spType"><option value="Contract">Daily wage</option><option value="Monthly">Monthly</option></select></div>
    <div class="fld"><label>Amount ₹ (per day / per month)</label><input id="spAmt" type="number" inputmode="numeric" placeholder="e.g. 600"></div>
    <div class="acts"><button class="btn primary" onclick='doSetPay(${id})'>Save pay</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
}
async function doSetPay(id) {
  const amt = Number($('spAmt').value);
  if (!amt) return toast('Enter the amount', 'err');
  const type = $('spType').value;
  try {
    await post('/api/hr-admin', {
      action: 'employee-upsert', id,
      pay_type: type,
      monthly_salary: type === 'Monthly' ? amt : (amt * 30),
      daily_rate: type === 'Contract' ? amt : Math.round(amt / 30),
    });
    closeSheet(); toast('Pay set'); loadHome();
  } catch (e) { toast(e.message, 'err'); }
}
function rosterTap(id) {
  // The person's everything: month grid + three lanes + actions. Over-write
  // pay lives inside that sheet now.
  if (!S.fin) return toast('Pay is owner-only', 'info');
  loadPayCtx('settle', id);
}
function overrideSheet(id, name) {
  if (!S.fin) return toast('Pay is owner-only', 'info');
  if (needToken()) return;
  const period = payPeriod();
  sheet(`<h2>${esc(name)} — over-write pay</h2><div class="sd">Set the final payable yourself when attendance is gappy. Recorded alongside the computed figure, never silently replacing it.</div>
    <div class="fld"><label>Pay period</label><input id="ovPeriod" type="month" value="${period}"></div>
    <div class="fld"><label>Final payable ₹</label><input id="ovAmt" type="number" inputmode="numeric" placeholder="you type the number"></div>
    <div class="fld"><label>Why (optional)</label><input id="ovNote" placeholder="retention bonus / OT / gappy attendance"></div>
    <div class="acts"><button class="btn primary" onclick='doOverride(${id})'>Save over-write</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
}
async function doOverride(id) {
  const amt = Number($('ovAmt').value);
  if (!amt) return toast('Enter an amount', 'err');
  try {
    await post('/api/darbar?action=salary-override', { employee_id: id, pay_period: $('ovPeriod').value, amount: amt, note: $('ovNote').value || null });
    closeSheet(); toast('Over-write saved');
  } catch (e) { toast(e.message, 'err'); }
}

/* ━━━━━━━━━━━━━━ ACCOUNT / HEALTH ━━━━━━━━━━━━━━ */
function openAccount() {
  const h = S.home?.health || {};
  const cams = h.cams_ok
    ? (h.cams_last_punch_age_min > 90 ? `<span class="pill grey">lull · ${h.cams_last_punch_age_min}m</span>` : `<span class="pill green">live · ${h.cams_last_punch_age_min}m</span>`)
    : `<span class="pill red">silent ${h.cams_last_punch_age_min ?? '?'}m</span>`;
  sheet(`<h2>Account</h2><div class="sd">${esc(S.user || '')} · ${esc(S.role || '')}</div>
    <div class="yrow"><div class="ic" style="background:var(--gold-soft);color:var(--gold)">🪪</div><div><div class="yl">CAMS device</div><div class="ys">biometric punch feed</div></div><div class="yv">${cams}</div></div>
    <div class="yrow"><div class="ic" style="background:var(--green-soft);color:var(--green)">💬</div><div><div class="yl">WhatsApp · HE</div><div class="ys">staff nudges + receipts</div></div><div class="yv"><span class="pill green">live</span></div></div>
    <div class="yrow"><div class="ic" style="background:var(--red-soft);color:var(--red)">💬</div><div><div class="yl">WhatsApp · NCH</div><div class="ys">token blocked → SMS fallback</div></div><div class="yv"><span class="pill red">blocked</span></div></div>
    <div class="yrow"><div class="ic" style="background:var(--purple-soft);color:var(--purple)">👻</div><div><div class="yl">Ghost PINs</div><div class="ys">working, unnamed</div></div><div class="yv">${h.ghost_count || 0}</div></div>
    <div class="acts">
      <button class="btn dark" onclick="installPWA()">Add to Home Screen</button>
    </div>
    <div class="acts"><button class="btn ghost-b" onclick="signOut()">Sign out</button></div>
    <div style="text-align:center;color:var(--mute);font-size:11px;margin-top:16px;font-family:'Cormorant Garamond',serif;font-style:italic">Darbar · the full retinue serving the realm</div>`);
}
function signOut() { sessionStorage.clear(); location.reload(); }
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
async function installPWA() {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  else toast('On iPhone: Share → Add to Home Screen', 'info');
}

/* ━━━ utils ━━━ */
function fmtDayShort(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00Z');
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
// pull-to-refresh on Today
let ts = 0;
document.addEventListener('touchstart', e => { const p = document.querySelector('.pane:not(.hide)'); if (p && p.scrollTop === 0) ts = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', e => { if (!ts) return; const dy = e.changedTouches[0].clientY - ts; ts = 0; if (dy > 90) setTab(S.tab); });
