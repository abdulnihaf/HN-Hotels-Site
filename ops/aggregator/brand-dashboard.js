const API = '/api/aggregator-pulse';
const KEY = 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA';
const MAY_START = '2026-05-01';

const cfg = {
  brand: document.body.dataset.brand,
  brandName: document.body.dataset.brandName,
  brandShort: document.body.dataset.brandShort,
  otherUrl: document.body.dataset.otherUrl,
};

const state = {
  platform: 'all',
  period: 'may_mtd',
  status: 'all',
  from: '',
  to: '',
  orders: [],
  health: null,
};

const $ = id => document.getElementById(id);

function init() {
  $('brandName').textContent = cfg.brandName;
  $('brandPill').textContent = cfg.brandShort;
  $('brandPill').className = `brand-pill ${cfg.brand}`;
  $('subtitle').textContent = `${cfg.brandName} delivery algorithm cockpit: demand, offers, rejection/missed orders, and data coverage from partner API captures.`;
  $('otherBrand').href = cfg.otherUrl;
  $('otherBrand').textContent = cfg.brand === 'he' ? 'Open NCH' : 'Open HE';
  $('period').value = state.period;
  $('status').value = state.status;
  $('fromDate').value = state.from;
  $('toDate').value = state.to;
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    state.platform = btn.dataset.platform;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    loadOrders();
  }));
  for (const id of ['period', 'status', 'fromDate', 'toDate']) {
    $(id).addEventListener('change', () => {
      state.period = $('period').value;
      state.status = $('status').value;
      state.from = $('fromDate').value;
      state.to = $('toDate').value;
      loadOrders();
    });
  }
  $('refresh').addEventListener('click', () => { loadHealth(); loadOrders(); });
  loadHealth();
  loadOrders();
  setInterval(loadHealth, 30000);
  setInterval(loadOrders, 60000);
}

function queryParams() {
  const p = new URLSearchParams({ action: 'owner-orders', key: KEY, brand: cfg.brand });
  if (state.platform !== 'all') p.set('platform', state.platform);
  if (state.status !== 'all') p.set('status', state.status);
  if (state.period === 'may_mtd') {
    p.set('date', 'custom');
    p.set('from', MAY_START);
    p.set('to', todayIst());
  } else if (state.period === 'custom') {
    p.set('date', 'custom');
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
  } else {
    p.set('date', state.period);
  }
  return p.toString();
}

async function loadHealth() {
  try {
    const r = await fetch(`${API}?action=health&key=${KEY}`);
    state.health = await r.json();
  } catch {
    state.health = { status: 'down', issues: ['health unavailable'], age_minutes: {} };
  }
  renderHealth();
}

async function loadOrders() {
  $('tableBody').innerHTML = `<tr><td colspan="11" class="empty">Loading ${cfg.brandShort} orders</td></tr>`;
  try {
    const r = await fetch(`${API}?${queryParams()}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    state.orders = data.orders || [];
    renderAll(data.summary || summarize(state.orders));
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    $('tableBody').innerHTML = `<tr><td colspan="11" class="empty">Unable to load data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAll(summary) {
  renderMetrics(summary);
  renderPlatformBoard();
  renderDataCoverage();
  renderTopItems();
  renderDemandSlots();
  renderOfferProof();
  renderPlatformMix();
  renderIssuePanels();
  renderTable();
}

function renderHealth() {
  const h = state.health || {};
  $('healthState').innerHTML = `<span class="dot ${h.status || ''}"></span>${escapeHtml(h.status || 'unknown')}`;
  const age = h.age_minutes || {};
  $('healthNote').textContent = [`SW ${age.swiggy_order ?? '-'}m`, `ZM ${age.zomato_order ?? '-'}m`].join(' · ');
}

function renderMetrics(summary) {
  const orders = state.orders;
  const delivered = orders.filter(o => o.status_group === 'delivered');
  const revenue = delivered.reduce((s, o) => s + num(o.order_value), 0);
  const aov = delivered.length ? revenue / delivered.length : 0;
  const issueRate = orders.length ? (orders.filter(o => o.issues).length / orders.length * 100) : 0;
  const rejectedMissed = (summary.rejected_orders || 0) + (summary.missed_orders || 0);
  $('mOrders').textContent = summary.total_orders || orders.length;
  $('mRevenue').textContent = rupee(revenue);
  $('mAov').textContent = rupee(aov);
  $('mRejected').textContent = summary.rejected_orders || 0;
  $('mMissed').textContent = summary.missed_orders || 0;
  $('mIssues').textContent = `${Math.round(issueRate)}%`;
  $('mDiscount').textContent = summary.discount_known_orders || 0;
  $('sOrders').textContent = tabLabel();
  $('sRevenue').textContent = `${delivered.length} delivered`;
  $('sAov').textContent = 'Delivered AOV';
  $('sRejected').textContent = `${rejectedMissed} rejected/missed`;
  $('sMissed').textContent = 'Acceptance leak';
  $('sIssues').textContent = `${orders.filter(o => o.issues).length} issue rows`;
  $('sDiscount').textContent = 'Rows with offer detail';
}

function renderDataCoverage() {
  const orders = state.orders;
  const z = orders.filter(o => o.platform === 'zomato');
  const s = orders.filter(o => o.platform === 'swiggy');
  const detail = z.filter(o => o.detail_available).length;
  const swFees = s.filter(o => o.fees).length;
  $('coverageBody').innerHTML = [
    coverageRow('Zomato', z.length, `${detail} rich detail rows; customer names available on list history.`),
    coverageRow('Swiggy', s.length, `${swFees} fee/discount rows from historical endpoint; customer names not exposed.`),
    coverageRow('Offer proof', orders.filter(o => o.discount_total != null).length, 'Use discount-known rows only for offer decisions.'),
  ].join('');
}

function coverageRow(label, value, note) {
  return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(label)}</div><div class="row-sub">${escapeHtml(note)}</div></div><div class="row-val">${value}</div></div>`;
}

function renderTopItems() {
  const stats = itemStats(state.orders).slice(0, 8);
  const max = Math.max(...stats.map(x => x.qty), 1);
  $('topItems').innerHTML = stats.length ? stats.map(item => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(item.name)}</div>
        <div class="row-sub">${item.orders} orders · ${rupee(item.revenue)} value signal</div>
        <div class="bar-track"><div class="bar-fill green" style="width:${Math.max(5, item.qty / max * 100)}%"></div></div>
      </div>
      <div class="row-val">${item.qty}</div>
    </div>`).join('') : empty('No item rows');
}

function renderDemandSlots() {
  const slots = [
    ['Breakfast', 6, 11],
    ['Lunch', 11, 16],
    ['Evening', 16, 20],
    ['Night', 20, 24],
    ['Late night', 0, 6],
  ].map(([label, start, end]) => slotStats(label, start, end));
  const max = Math.max(...slots.map(x => x.orders), 1);
  $('demandSlots').innerHTML = slots.map(slot => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${slot.label}</div>
        <div class="row-sub">${slot.delivered} delivered · ${rupee(slot.revenue)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, slot.orders / max * 100)}%"></div></div>
      </div>
      <div class="row-val">${slot.orders}</div>
    </div>`).join('');
}

function renderOfferProof() {
  const discountRows = state.orders.filter(o => o.discount_total != null && o.discount_total > 0);
  const total = discountRows.reduce((s, o) => s + num(o.discount_total), 0);
  const byItem = itemStats(discountRows).slice(0, 5);
  const header = `<div class="row"><div class="row-main"><div class="row-title">${discountRows.length} discount-known orders</div><div class="row-sub">Captured discount total ${rupee(total)}. Use this only where detail_available=true.</div></div><div class="row-val amber">${rupee(total)}</div></div>`;
  $('offerProof').innerHTML = header + (byItem.length ? byItem.map(i => `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(i.name)}</div><div class="row-sub">${i.orders} discounted rows</div></div><div class="row-val">${i.qty}</div></div>`).join('') : '');
}

function renderPlatformBoard() {
  const platforms = ['zomato', 'swiggy'];
  const visible = state.platform === 'all' ? platforms : platforms.filter(p => p === state.platform);
  $('platformBoard').innerHTML = visible.map(platform => platformCard(platform, platformStats(platform))).join('');
}

function platformStats(platform) {
  const rows = state.orders.filter(o => o.platform === platform);
  const delivered = rows.filter(o => o.status_group === 'delivered');
  const exceptions = rows.filter(o => ['rejected', 'missed', 'cancelled'].includes(o.status_group));
  const issueRows = rows.filter(o => o.issues);
  const discountRows = rows.filter(o => o.discount_total != null && o.discount_total > 0);
  const revenue = delivered.reduce((s, o) => s + num(o.order_value), 0);
  const discount = discountRows.reduce((s, o) => s + num(o.discount_total), 0);
  return {
    platform,
    rows,
    delivered,
    exceptions,
    issueRows,
    discountRows,
    revenue,
    aov: delivered.length ? revenue / delivered.length : 0,
    discount,
    topItems: itemStats(rows).slice(0, 4),
  };
}

function platformCard(platform, stats) {
  const exceptionRate = stats.rows.length ? Math.round(stats.exceptions.length / stats.rows.length * 100) : 0;
  const issueRate = stats.rows.length ? Math.round(stats.issueRows.length / stats.rows.length * 100) : 0;
  const detailNote = platform === 'zomato'
    ? `${stats.rows.filter(o => o.customer_name).length} customer names · ${stats.rows.filter(o => o.detail_available).length} details`
    : `${stats.rows.filter(o => o.fees).length} fee rows · handover/food-ready signals`;
  const actionRows = stats.exceptions.concat(stats.issueRows.filter(o => !stats.exceptions.includes(o))).slice(0, 4);
  return `
    <article class="platform-card ${platform}">
      <div class="platform-head">
        <div>
          <div class="platform-name"><span class="tag ${platform}">${labelPlatform(platform)}</span><span>${platform === 'zomato' ? 'Customer and offer lens' : 'Ops and fee lens'}</span></div>
          <div class="platform-sub">${detailNote}</div>
        </div>
        <div class="platform-state">${stats.rows.length} orders<br>${stats.delivered.length} delivered</div>
      </div>
      <div class="platform-kpis">
        ${platformKpi('Revenue', rupee(stats.revenue), 'Delivered only', 'green')}
        ${platformKpi('AOV', rupee(stats.aov), 'Delivered ticket', '')}
        ${platformKpi('Exceptions', stats.exceptions.length, `${exceptionRate}% of rows`, stats.exceptions.length ? 'red' : 'green')}
        ${platformKpi('Offer Proof', stats.discountRows.length, rupee(stats.discount), stats.discountRows.length ? 'amber' : '')}
      </div>
      <div class="platform-body">
        <div class="mini-list">
          <div class="mini-title">Top items</div>
          ${stats.topItems.length ? stats.topItems.map(i => `<div class="mini-row"><div><div class="mini-main">${escapeHtml(i.name)}</div><div class="mini-note">${i.orders} orders · ${rupee(i.revenue)}</div></div><div class="mini-val">${i.qty}</div></div>`).join('') : empty('No items')}
        </div>
        <div class="mini-list">
          <div class="mini-title">Needs control</div>
          ${actionRows.length ? actionRows.map(o => `<div class="mini-row"><div><div class="mini-main">${escapeHtml(o.items || o.order_id)}</div><div class="mini-note">${escapeHtml(o.rejection_reason || o.issues || o.status || '')}</div></div><div class="mini-val">${rupee(o.order_value || 0)}</div></div>`).join('') : `<div class="mini-row"><div class="mini-main">No exception rows</div><div class="mini-val green">${issueRate}%</div></div>`}
        </div>
      </div>
    </article>`;
}

function platformKpi(label, value, note, tone) {
  return `<div class="platform-kpi"><div class="k-label">${escapeHtml(label)}</div><div class="k-value ${tone || ''}">${escapeHtml(value)}</div><div class="k-note">${escapeHtml(note)}</div></div>`;
}

function renderPlatformMix() {
  const platforms = ['zomato', 'swiggy'].map(platform => {
    const rows = state.orders.filter(o => o.platform === platform);
    const delivered = rows.filter(o => o.status_group === 'delivered');
    const revenue = delivered.reduce((s, o) => s + num(o.order_value), 0);
    const discount = rows.filter(o => o.discount_total != null).reduce((sum, o) => sum + num(o.discount_total), 0);
    const exceptions = rows.filter(o => ['rejected', 'missed', 'cancelled'].includes(o.status_group));
    return { platform, rows, delivered, revenue, discount, exceptions };
  });
  const max = Math.max(...platforms.map(x => x.revenue), 1);
  $('platformMix').innerHTML = platforms.map(p => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${labelPlatform(p.platform)}</div>
        <div class="row-sub">${p.delivered.length} delivered · ${p.exceptions.length} exception · ${rupee(p.discount)} discount proof</div>
        <div class="bar-track"><div class="bar-fill ${p.platform === 'zomato' ? 'zm' : 'sw'}" style="width:${Math.max(4, p.revenue / max * 100)}%"></div></div>
      </div>
      <div class="row-val">${rupee(p.revenue)}</div>
    </div>`).join('');
}

function renderIssuePanels() {
  const rejected = state.orders.filter(o => ['rejected', 'missed', 'cancelled'].includes(o.status_group));
  const opsIssues = state.orders.filter(o => o.issues && !['rejected', 'missed', 'cancelled'].includes(o.status_group));
  $('hardFailures').innerHTML = rejected.length ? rejected.slice(0, 15).map(issueRow).join('') : empty('No rejected or missed rows');
  $('opsIssues').innerHTML = opsIssues.length ? opsIssues.slice(0, 15).map(issueRow).join('') : empty('No ops issue rows');
}

function issueRow(o) {
  return `<div class="row"><div class="row-main"><div class="row-title">${escapeHtml(o.order_id)} · ${escapeHtml(o.customer_name || 'unknown')}</div><div class="row-sub">${escapeHtml(o.items || '-')}</div><div class="row-sub red">${escapeHtml(o.rejection_reason || o.issues || o.status || '')}</div></div><div class="row-val">${rupee(o.order_value || 0)}</div></div>`;
}

function renderTable() {
  const rows = state.orders;
  $('tableMeta').textContent = `${rows.length} rows · ${tabLabel()}`;
  $('tableBody').innerHTML = rows.length ? rows.map(o => `
    <tr>
      <td><strong>${escapeHtml(o.order_time || '--:--')}</strong><div class="faint">${escapeHtml(o.order_date || '')}</div></td>
      <td><span class="tag ${o.platform}">${labelPlatform(o.platform)}</span></td>
      <td><span class="tag ${o.status_group}">${labelStatus(o.status_group, o.status)}</span></td>
      <td><strong>${escapeHtml(o.order_id || '')}</strong><div class="faint">${o.detail_available ? 'detail' : 'history'}</div></td>
      <td>${escapeHtml(o.customer_name || 'unknown')}<div class="faint">${escapeHtml(o.customer_order_count_label || '')}</div></td>
      <td class="items">${escapeHtml(o.items || '-')}</td>
      <td class="money">${o.order_value != null ? rupee(o.order_value) : '-'}</td>
      <td>${o.discount_total != null ? `<span class="amber">${rupee(o.discount_total)}</span>` : '<span class="faint">not captured</span>'}</td>
      <td>${o.rating != null ? `<span class="amber">${escapeHtml(o.rating)} star</span>` : '<span class="faint">not captured</span>'}</td>
      <td class="issue">${escapeHtml(o.rejection_reason || o.issues || '')}</td>
      <td><span class="faint">${ago(o.captured_at)}</span></td>
    </tr>`).join('') : `<tr><td colspan="11" class="empty">No rows for this filter</td></tr>`;
}

function itemStats(rows) {
  const map = new Map();
  for (const o of rows) {
    for (const item of parseItems(o.items)) {
      const current = map.get(item.name) || { name: item.name, qty: 0, orders: 0, revenue: 0 };
      current.qty += item.qty;
      current.orders += 1;
      current.revenue += num(o.order_value);
      map.set(item.name, current);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
}

function parseItems(text) {
  if (!text) return [];
  return String(text).split(/,\s*/).map(part => {
    const m = part.match(/^(\d+)\s*x\s*(.+)$/i);
    return { qty: m ? Number(m[1]) : 1, name: (m ? m[2] : part).trim() };
  }).filter(x => x.name);
}

function slotStats(label, start, end) {
  const rows = state.orders.filter(o => {
    const hour = parseHour(o.order_time);
    if (hour == null) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  });
  const delivered = rows.filter(o => o.status_group === 'delivered');
  return { label, orders: rows.length, delivered: delivered.length, revenue: delivered.reduce((s, o) => s + num(o.order_value), 0) };
}

function parseHour(value) {
  if (!value) return null;
  const s = String(value).trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h;
  }
  const m = s.match(/^(\d{1,2}):/);
  return m ? Number(m[1]) : null;
}

function summarize(rows) {
  const delivered = rows.filter(o => o.status_group === 'delivered');
  return {
    total_orders: rows.length,
    delivered_orders: delivered.length,
    rejected_orders: rows.filter(o => o.status_group === 'rejected').length,
    missed_orders: rows.filter(o => o.status_group === 'missed').length,
    discount_known_orders: rows.filter(o => o.discount_total != null).length,
  };
}

function tabLabel() {
  if (state.platform === 'zomato') return 'Zomato';
  if (state.platform === 'swiggy') return 'Swiggy';
  return 'Unified';
}

function labelPlatform(v) { return v === 'zomato' ? 'Zomato' : v === 'swiggy' ? 'Swiggy' : 'Unknown'; }
function labelStatus(group, raw) {
  if (group === 'delivered') return 'Delivered';
  if (group === 'rejected') return 'Rejected';
  if (group === 'missed') return 'Missed';
  if (group === 'cancelled') return 'Cancelled';
  if (group === 'active') return raw || 'Active';
  return raw || 'Other';
}
function rupee(v) { return '₹' + Math.round(num(v)).toLocaleString('en-IN'); }
function num(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
function todayIst() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
function ago(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function empty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }

init();
