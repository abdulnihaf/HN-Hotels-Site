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
  pin: null, user: null, role: null, fin: false,
  dkey: localStorage.getItem('darbar_dk') || '',
  tab: 'today',
  home: null,
  attendDate: null, attendBrand: 'all', attendRows: [],
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
function submitPin() {
  const u = USERS[pinEntry];
  if (!u) {
    $('gate').classList.add('shake');
    $('pinErr').textContent = 'Not recognised at this court.';
    setTimeout(() => { $('gate').classList.remove('shake'); pinEntry = ''; renderDots(); }, 460);
    if (navigator.vibrate) navigator.vibrate(60);
    return;
  }
  enterCourt(pinEntry, u);
}
function enterCourt(pin, u) {
  S.pin = pin; S.user = u.name; S.role = u.role; S.fin = u.fin;
  sessionStorage.setItem('darbar_pin', pin);
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
(function auto() { const p = sessionStorage.getItem('darbar_pin'); if (p && USERS[p]) enterCourt(p, USERS[p]); })();

/* ━━━ API ━━━ */
async function api(path) { const r = await fetch(path); return r.json(); }
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dashboard-key': S.dkey },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function needKey() {
  if (S.dkey) return true;
  toast('Set your dashboard key in ⚙ first', 'err');
  openAccount();
  return false;
}

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
    $('todaySub').innerHTML = `${h.stats.present + h.stats.in_progress} on shift · ` +
      (h.health?.cams_ok ? `device <b>live</b> (${age}m ago)` : `<b style="color:var(--red)">device silent ${age}m</b>`);
  } catch (e) { $('inbox').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
}
function renderHero(s) {
  $('hero').innerHTML = [
    ['present', 'On shift', 'g', (s.present || 0) + (s.in_progress || 0)],
    ['miss', 'Missed punch', 'y', s.missing_punch || 0],
    ['absent', 'Absent', 'r', s.absent || 0],
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
    return `<div class="card xcard ghost">
      <div class="xc-top"><div><div class="xc-name">Unknown — PIN ${esc(x.pin)} <span class="pill purple">ghost</span></div>
        <div class="xc-meta"><b>${x.punches}</b> punches over <b>${x.days}</b> days · ${esc(x.shape)}<br>${x.active ? '<b style="color:var(--green)">working now</b>' : `last seen ${x.days_silent}d ago`}</div></div></div>
      <div class="acts">
        <button class="btn primary" onclick='nameGhost(${JSON.stringify(x.pin)})'>Name this worker</button>
        <button class="btn ghost-b" onclick='dismissGhost(${JSON.stringify(x.pin)})'>Ignore</button>
      </div></div>`;
  }
  if (x.type === 'chronic') {
    return `<div class="card xcard chronic">
      <div class="xc-top"><div><div class="xc-name">${esc(x.name)} <span class="pill ${x.brand.toLowerCase()}">${x.brand}</span></div>
        <div class="xc-meta">Forgot a punch on <b>${x.odd_days}</b> of the last 7 days — needs a word, not another SMS.</div></div><span class="pill yellow">chronic</span></div></div>`;
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
  if (!needKey()) return;
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
  if (!needKey()) return;
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

function nameGhost(pin) {
  if (!needKey()) return;
  sheet(`<h2>Name PIN ${esc(pin)}</h2><div class="sd">Turn this working ghost into a real roster member. Attendance starts counting immediately.</div>
    <div class="fld"><label>Name</label><input id="obName" placeholder="full name"></div>
    <div class="fld"><label>Brand</label><select id="obBrand"><option value="NCH">Nawabi Chai House</option><option value="HE">Hamza Express</option><option value="HQ">HQ</option></select></div>
    <div class="fld"><label>Pay type</label><select id="obPay" onchange="document.getElementById('obWageWrap').dataset.t=this.value"><option value="Contract">Daily wage</option><option value="Monthly">Monthly</option></select></div>
    <div class="fld" id="obWageWrap" data-t="Contract"><label>Daily rate ₹ / Monthly ₹</label><input id="obWage" type="number" inputmode="numeric" placeholder="e.g. 600"></div>
    <div class="fld"><label>Phone (for punch-reminders)</label><input id="obPhone" type="tel" inputmode="numeric" placeholder="10-digit"></div>
    <div class="acts"><button class="btn primary" onclick='doOnboard(${JSON.stringify(pin)})'>Add to roster</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
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
  if (!needKey()) return;
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
  if (r.status === 'week_off' || r.status === 'leave') return { k: 'off', label: r.status === 'leave' ? 'LEAVE' : 'WEEK OFF' };
  const pc = r.punch_count || 0;
  if (r.status === 'pending' && pc === 0) return { k: 'inprog', label: 'AWAITED' };
  if (pc === 0) return { k: 'absent', label: 'ABSENT' };
  if (pc % 2 === 1) return { k: 'missing', label: pc === 1 ? 'NO OUT' : 'MISSED PUNCH' };
  return { k: 'present', label: r.status === 'pending' ? 'ON SHIFT' : 'PRESENT' };
}
function renderAttend() {
  let rows = S.attendRows;
  if (S.attendBrand !== 'all') rows = rows.filter(r => r.brand_label === S.attendBrand);
  // stats
  const c = { present: 0, missing: 0, absent: 0, off: 0 };
  rows.forEach(r => { const st = attState(r); c[st.k === 'inprog' ? 'present' : st.k]++; });
  $('attStats').innerHTML = [
    ['Present', 'g', c.present], ['Missed', 'y', c.missing], ['Absent', 'r', c.absent], ['Off', '', c.off],
  ].map(([l, cl, n]) => `<div class="stat ${cl}"><div class="n num">${n}</div><div class="l">${l}</div></div>`).join('');

  // order: missing first (need attention), then present, absent, off
  const rank = { missing: 0, present: 1, inprog: 1, absent: 2, off: 3 };
  rows = [...rows].sort((a, b) => rank[attState(a).k] - rank[attState(b).k]);
  if (!rows.length) { $('attList').innerHTML = '<div class="empty">No one on this day.</div>'; return; }
  $('attList').innerHTML = rows.map(r => {
    const st = attState(r); const nm = r.known_as && r.known_as !== r.name ? `${esc(r.name)} <span style="color:var(--mute)">(${esc(r.known_as)})</span>` : esc(r.name);
    const sess = sessionLine(r);
    const fixBtn = (st.k === 'missing') ? `<button class="btn primary sm" style="margin-top:9px" onclick='fixPunch(${r.employee_id}, ${JSON.stringify(S.attendDate)})'>Fix — impute out</button>` : '';
    return `<div class="arow"><div class="top"><div>
        <div class="nm"><span class="sdot ${st.k}"></span>${nm} <span class="pill ${(r.brand_label||'').toLowerCase()}">${r.brand_label||''}</span></div>
        <div class="role">${esc(r.job_name || r.department_name || '')}</div>
        <div class="sess">${sess}</div></div>
        <span class="pill ${st.k === 'present' ? 'green' : st.k === 'missing' ? 'yellow' : st.k === 'absent' ? 'red' : st.k === 'inprog' ? 'blue' : 'purple'}">${st.label}</span></div>
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
  if (!needKey()) return;
  try { await post('/api/darbar?action=fix-punch', { employee_id: empId, date }); toast('Checkout imputed'); loadAttend(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ━━━━━━━━━━━━━━ PAY ━━━━━━━━━━━━━━ */
function settlementOpen() { return (new Date(Date.now() + 5.5 * 3600e3)).getUTCDate() >= 7; }
async function loadPay() {
  const open = settlementOpen();
  const monthLbl = new Date(Date.now() + 5.5 * 3600e3).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  $('settleBanner').innerHTML = open
    ? `<div class="card" style="border-color:var(--green-soft)"><b style="color:var(--green)">Settlement open</b><div class="xc-meta" style="margin-top:4px">Classify leaves → compute → approve → pay. Last month's salary settles now.</div></div>`
    : `<div class="card"><b style="color:var(--dim)">🔒 Settlement opens on the 7th</b><div class="xc-meta" style="margin-top:4px">Salary is settled on the 7th of next month — never mid-month (it would over-deduct). Advances can be paid any day.</div></div>`;
  const month = todayIST().slice(0, 7);
  $('advMonth').textContent = monthLbl;
  if (!S.dkey) { $('advList').innerHTML = '<div class="empty">Enter your dashboard key in ⚙ to load advances.</div>'; return; }
  $('advList').innerHTML = '<div class="skel"></div>';
  try {
    const r = await fetch(`/api/hr-payroll?action=list-advances&month=${month}`, { headers: { 'x-dashboard-key': S.dkey } }).then(x => x.json());
    const adv = r.advances || r.rows || [];
    if (!adv.length) { $('advList').innerHTML = `<div class="empty">No advances in ${esc(monthLbl)} yet. Tap ＋ to pay one.</div>`; return; }
    $('advList').innerHTML = adv.map(a => `<div class="card"><div class="xc-top">
      <div><div class="xc-name">${esc(a.name || a.known_as || ('Emp #' + a.employee_id))}</div>
      <div class="xc-meta">${esc(a.advance_date || '')} · ${esc(a.paid_via || 'cash')}${a.reason ? ' · ' + esc(a.reason) : ''}${a.recovered ? ' · <span style="color:var(--green)">recovered</span>' : ''}</div></div>
      <div style="font-weight:800;font-size:16px" class="num">${inr(a.amount)}</div></div></div>`).join('');
  } catch (e) { $('advList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function openAdvance() {
  if (!needKey()) return;
  if (!S.employees.length) { try { S.employees = (await api(`/api/hr-admin?action=employees&active=1`)).employees || []; } catch {} }
  const opts = S.employees.filter(e => e.is_active).map(e => `<option value="${e.id}">${esc(e.known_as || e.name)} · ${esc(e.brand_label)}</option>`).join('');
  sheet(`<h2>Pay advance</h2><div class="sd">Records the cash event + fires a WhatsApp confirmation to the worker immediately.</div>
    <div class="fld"><label>Worker</label><select id="advEmp">${opts}</select></div>
    <div class="fld"><label>Amount ₹</label><input id="advAmt" type="number" inputmode="numeric" placeholder="3000"></div>
    <div class="fld"><label>Paid via</label><select id="advVia"><option>cash</option><option>upi</option><option>bank</option><option>razorpay</option><option>paytm</option></select></div>
    <div class="fld"><label>Note (optional)</label><input id="advNote" placeholder="reason"></div>
    <div class="acts"><button class="btn primary" onclick="doAdvance()">Pay + notify</button><button class="btn ghost-b" onclick="closeSheet()">Cancel</button></div>`);
}
async function doAdvance() {
  const amt = Number($('advAmt').value);
  if (!amt) return toast('Enter an amount', 'err');
  try {
    await fetch('/api/hr-payroll?action=record-advance', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-dashboard-key': S.dkey },
      body: JSON.stringify({ employee_id: Number($('advEmp').value), amount: amt, advance_date: todayIST(), paid_via: $('advVia').value, reason: $('advNote').value || null }),
    }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'failed'); });
    closeSheet(); toast('Advance recorded · WhatsApp fired'); loadPay();
  } catch (e) { toast(e.message, 'err'); }
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
  $('rosterSub').textContent = `${rows.length} serving · tap to over-write pay`;
  if (!rows.length) { $('rosterList').innerHTML = '<div class="empty">No one here.</div>'; return; }
  $('rosterList').innerHTML = rows.map(e => {
    const pay = S.fin ? (e.monthly_salary ? `${inr(e.monthly_salary)}/mo` : e.daily_rate ? `${inr(e.daily_rate)}/day` : '—') : '';
    const noPin = !e.pin ? '<span class="pill yellow">no pin</span>' : '';
    return `<div class="arow" onclick='overrideSheet(${e.id}, ${JSON.stringify(e.known_as || e.name)})'><div class="top">
      <div><div class="nm">${esc(e.known_as || e.name)} <span class="pill ${(e.brand_label||'').toLowerCase()}">${e.brand_label||''}</span> ${noPin}</div>
      <div class="role">${esc(e.job_name || '')} ${e.pin ? '· PIN ' + esc(e.pin) : ''} · ${esc(e.pay_type || '')}</div></div>
      ${pay ? `<div style="font-weight:700;font-size:14px" class="num">${pay}</div>` : ''}</div></div>`;
  }).join('');
}
function overrideSheet(id, name) {
  if (!S.fin) return toast('Pay is owner-only', 'info');
  if (!needKey()) return;
  const period = todayIST().slice(0, 7);
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
  const cams = h.cams_ok ? `<span class="pill green">live · ${h.cams_last_punch_age_min}m</span>` : `<span class="pill red">silent ${h.cams_last_punch_age_min ?? '?'}m</span>`;
  sheet(`<h2>Account</h2><div class="sd">${esc(S.user || '')} · ${esc(S.role || '')}</div>
    <div class="yrow"><div class="ic" style="background:var(--gold-soft);color:var(--gold)">🪪</div><div><div class="yl">CAMS device</div><div class="ys">biometric punch feed</div></div><div class="yv">${cams}</div></div>
    <div class="yrow"><div class="ic" style="background:var(--green-soft);color:var(--green)">💬</div><div><div class="yl">WhatsApp · HE</div><div class="ys">staff nudges + receipts</div></div><div class="yv"><span class="pill green">live</span></div></div>
    <div class="yrow"><div class="ic" style="background:var(--red-soft);color:var(--red)">💬</div><div><div class="yl">WhatsApp · NCH</div><div class="ys">token blocked → SMS fallback</div></div><div class="yv"><span class="pill red">blocked</span></div></div>
    <div class="yrow"><div class="ic" style="background:var(--purple-soft);color:var(--purple)">👻</div><div><div class="yl">Ghost PINs</div><div class="ys">working, unnamed</div></div><div class="yv">${h.ghost_count || 0}</div></div>
    <div class="fld" style="margin-top:16px"><label>Dashboard key (stored on this device)</label><input id="dkIn" type="password" value="${esc(S.dkey)}" placeholder="paste once — unlocks pay + actions"></div>
    <div class="acts">
      <button class="btn primary" onclick="saveKey()">Save key</button>
      <button class="btn dark" onclick="installPWA()">Add to Home Screen</button>
    </div>
    <div class="acts"><button class="btn ghost-b" onclick="signOut()">Sign out</button></div>
    <div style="text-align:center;color:var(--mute);font-size:11px;margin-top:16px;font-family:'Cormorant Garamond',serif;font-style:italic">Darbar · the full retinue serving the realm</div>`);
}
function saveKey() { S.dkey = $('dkIn').value.trim(); localStorage.setItem('darbar_dk', S.dkey); toast('Key saved'); closeSheet(); if (S.tab === 'pay') loadPay(); }
function signOut() { sessionStorage.removeItem('darbar_pin'); location.reload(); }
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
