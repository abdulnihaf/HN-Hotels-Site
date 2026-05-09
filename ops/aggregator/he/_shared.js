// Shared JS for HE Swiggy and HE Zomato dashboards.
// Loaded by both /ops/aggregator/he/swiggy/index.html and /ops/aggregator/he/zomato/index.html.
//
// The page sets window.HN_AGG = { brand, platform } before loading this script.
// This file handles: data fetch, period switching, tab switching, and rendering each section.

(function () {
  const KEY = 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA';
  const API = 'https://hnhotels.in/api/aggregator-pulse';
  const cfg = window.HN_AGG || { brand: 'he', platform: 'swiggy' };

  // ─── state ──────────────────────────────────────────────────────────────
  let currentPeriod = localStorage.getItem(`agg_${cfg.brand}_${cfg.platform}_period`) || 'today';
  let currentTab = localStorage.getItem(`agg_${cfg.brand}_${cfg.platform}_tab`) || 'growth';
  let lastData = null;

  // ─── helpers ────────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n, opts = {}) => {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number') return String(n);
    if (opts.pct) return `${n.toFixed(1)}%`;
    if (opts.money) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (opts.dec) return n.toFixed(opts.dec);
    return n.toLocaleString('en-IN');
  };
  const ago = (iso) => {
    if (!iso) return '—';
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
    return `${Math.round(d / 86_400_000)}d ago`;
  };
  const scopeBadge = (scope) => {
    const map = {
      he_only: { label: 'HE only', class: 'good' },
      nch_only: { label: 'NCH only', class: 'good' },
      he_only_or_nch_only: { label: cfg.brand.toUpperCase() + ' only', class: 'good' },
      partial_he_only: { label: 'partial HE-only', class: 'warn' },
      combined_he_nch: { label: 'combined HE+NCH', class: 'warn' },
      unavailable: { label: 'not yet captured', class: 'bad' },
    };
    const x = map[scope] || { label: scope, class: 'warn' };
    return `<span class="scope ${x.class}" title="data scope">${x.label}</span>`;
  };

  // ─── render ─────────────────────────────────────────────────────────────
  function render(data) {
    if (!data || !data.ok) {
      $('#main').innerHTML = `<div class="err">Failed to load data: ${JSON.stringify(data)}</div>`;
      return;
    }
    const s = data.sections || {};
    $('#brand').textContent = data.brand.toUpperCase();
    $('#platform').textContent = data.platform === 'swiggy' ? 'Swiggy' : 'Zomato';
    $('#period-display').textContent = currentPeriod.replace('thisweek', 'this week').replace('lastweek', 'last week');
    const updatedAt = s[currentTab]?.captured_at || s.growth?.captured_at;
    $('#updated').textContent = updatedAt ? ago(updatedAt) : '—';

    renderTab(currentTab, s);
  }

  function renderTab(tab, s) {
    // hide all panes
    $$('.pane').forEach(p => p.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $(`#pane-${tab}`).classList.add('active');

    if (tab === 'growth') return renderGrowth(s.growth);
    if (tab === 'ops') return renderOps(s.ops);
    if (tab === 'sales') return renderSales(s.sales);
    if (tab === 'finance') return renderFinance(s.finance);
    if (tab === 'reviews') return renderReviews(s.reviews);
    if (tab === 'orders') return renderOrders(s.orders);
  }

  // ─── GROWTH & LISTING (default tab) ─────────────────────────────────────
  function renderGrowth(g) {
    if (!g) { $('#pane-growth').innerHTML = '<div class="err">no data</div>'; return; }
    if (g.data_scope === 'unavailable') {
      $('#pane-growth').innerHTML = `<div class="empty"><h3>Growth data not yet captured</h3><p>${g.reason || ''}</p></div>`;
      return;
    }

    // STRICT HE-only schema: top_dishes_he + customer_cohort_he + payment_mix_he + discount_usage_he
    const dishes = g.top_dishes_he || [];
    const cohort = g.customer_cohort_he || {};
    const payments = g.payment_mix_he || {};
    const disc = g.discount_usage_he || {};
    const gaps = g.not_yet_he_only || {};

    const dishesRows = dishes.slice(0, 10).map((d, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${d.name}</td>
        <td class="num">${fmt(d.orders)}</td>
        <td class="num">${fmt(d.quantity)}</td>
        <td class="num">${fmt(d.revenue, { money: true })}</td>
        <td class="num">${d.discount_count || 0}</td>
        <td><span class="tags">${(d.tags || []).filter(t => t.startsWith('dt-')).slice(0, 3).join(', ')}</span></td>
      </tr>`).join('');

    const paymentRows = Object.entries(payments).map(([k, v]) =>
      `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

    $('#pane-growth').innerHTML = `
      <div class="scope-bar">${scopeBadge(g.data_scope)}<span class="scope-note">${g.data_scope_note || ''}</span></div>
      <div class="grid4">
        ${card(`CUSTOMER COHORT · ${cfg.brand.toUpperCase()} only`, cohort.sample_size ? `
          <div class="big-num">${fmt(cohort.first_time_pct, { pct: true })}</div>
          <div class="kv"><span class="k">First-time</span><span class="v">${fmt(cohort.first_time_orders)}</span></div>
          <div class="kv"><span class="k">Repeat</span><span class="v">${fmt(cohort.repeat_orders)}</span></div>
          <div class="kv"><span class="k">Sample</span><span class="v">${fmt(cohort.sample_size)} orders</span></div>
        ` : '<div class="not-cap">No order-detail captures yet for this brand</div>')}
        ${card(`DISCOUNT USAGE · ${cfg.brand.toUpperCase()} only`, disc.total_orders_in_sample ? `
          <div class="big-num ${disc.usage_rate_pct > 50 ? 'warn' : ''}">${fmt(disc.usage_rate_pct, { pct: true })}</div>
          <div class="kv"><span class="k">With discount</span><span class="v">${fmt(disc.orders_with_discount)}</span></div>
          <div class="kv"><span class="k">Sample</span><span class="v">${fmt(disc.total_orders_in_sample)} orders</span></div>
          ${disc.usage_rate_pct > 50 ? '<div class="diag-bad" style="margin-top:6px;font-size:10px">Heavy reliance on discounts — margin risk</div>' : ''}
        ` : '<div class="not-cap">No order-detail captures yet</div>')}
        ${card(`PAYMENT MIX · ${cfg.brand.toUpperCase()} only`, paymentRows || '<div class="not-cap">No payment data yet</div>')}
        ${card('NOT YET HE-ONLY', `
          ${Object.entries(gaps).slice(0, 6).map(([k, v]) =>
            `<div style="font-size:10px;padding:3px 0;border-bottom:1px solid var(--very-faint, #1a1a30)"><strong>${k}</strong><br><span style="color:var(--dim)">${v}</span></div>`
          ).join('')}
          ${Object.keys(gaps).length > 6 ? `<div style="font-size:10px;color:var(--dim);margin-top:4px">+ ${Object.keys(gaps).length - 6} more gaps</div>` : ''}
        `)}
      </div>
      ${dishes.length ? `
        <h3 style="margin-top:18px;font-size:11px;font-weight:700;color:var(--dim);letter-spacing:0.4px">TOP DISHES · ${cfg.brand.toUpperCase()} ONLY (from order-detail captures)</h3>
        <table class="orders-table" style="margin-top:6px">
          <thead><tr><th>#</th><th>Dish</th><th class="num">Orders</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">w/Disc</th><th>Zomato tags</th></tr></thead>
          <tbody>${dishesRows}</tbody>
        </table>
      ` : ''}
    `;
  }

  function diagFunnel(f) {
    // Surfaces the weakest stage in the funnel as a one-line diagnostic
    const stages = [
      { name: 'menu open', rate: f.menu_open_rate_pct, baseline: 8 },
      { name: 'cart build', rate: f.cart_build_rate_pct, baseline: 25 },
      { name: 'order place', rate: f.order_conversion_rate_pct, baseline: 50 },
    ].filter(s => s.rate !== null && s.rate !== undefined);
    if (!stages.length) return '';
    const worst = stages.reduce((a, b) => (a.rate / a.baseline < b.rate / b.baseline ? a : b));
    if (worst.rate >= worst.baseline) return `<span class="diag-good">funnel healthy</span>`;
    return `<span class="diag-bad">${worst.name} stage leaking — ${worst.rate}% vs ~${worst.baseline}% baseline</span>`;
  }

  // ─── OPS HEALTH ─────────────────────────────────────────────────────────
  function renderOps(o) {
    if (!o) { $('#pane-ops').innerHTML = '<div class="err">no data</div>'; return; }
    if (o.data_scope === 'unavailable') {
      $('#pane-ops').innerHTML = `<div class="empty"><h3>Ops data not yet captured</h3><p>${o.reason || ''}</p></div>`;
      return;
    }
    const live = o.live_status || {};
    const meta = o.outlet_metadata;
    const issueBreakdown = o.issue_breakdown || {};
    const gaps = o.not_yet_he_only || {};
    // Old combined fields no longer in payload — only HE-only fields below.
    const dq = {}, cn = {}, cm = {}, bolt = null;  // kept as empty so existing code doesn't NPE if dashboard cached

    const issueRows = Object.entries(issueBreakdown).map(([k, v]) =>
      `<div class="kv"><span class="k">${k.replace(/_/g, ' ')}</span><span class="v ${v > 0 ? 'warn' : ''}">${v}</span></div>`).join('');

    $('#pane-ops').innerHTML = `
      <div class="scope-bar">${scopeBadge(o.data_scope)}<span class="scope-note">${o.data_scope_note || ''}</span></div>
      <div class="grid4">
        ${card(`LIVE STATUS · ${cfg.brand.toUpperCase()} only`, live.available === false ? `<div class="not-cap">${live.reason || 'live status not available'}</div>` : `
          <div class="big-status ${live.is_open === false ? 'bad' : 'good'}">${live.is_open === false ? 'OFFLINE' : (live.is_open === true ? 'OPEN' : '—')}</div>
          ${live.outlet_id ? `<div class="kv"><span class="k">Outlet ID</span><span class="v">${live.outlet_id}</span></div>` : (meta?.res_id ? `<div class="kv"><span class="k">Outlet ID</span><span class="v">${meta.res_id}</span></div>` : '')}
          ${live.is_serviceable !== undefined ? `<div class="kv"><span class="k">Serviceable</span><span class="v">${live.is_serviceable === false ? '✗ no' : '✓ yes'}</span></div>` : ''}
          ${live.stress !== undefined ? `<div class="kv"><span class="k">Stress mode</span><span class="v ${live.stress ? 'warn' : ''}">${live.stress ? 'yes' : 'no'}</span></div>` : ''}
          ${live.active_batches !== undefined ? `<div class="kv"><span class="k">Active batches</span><span class="v">${live.active_batches}</span></div>` : ''}
        `)}
        ${meta && !meta.available === false ? card(`OUTLET METADATA · ${cfg.brand.toUpperCase()} only`, `
          ${meta.address ? `<div class="kv"><span class="k">Address</span><span class="v" style="font-size:10px;text-align:right">${meta.address}</span></div>` : ''}
          ${meta.active_since ? `<div class="kv"><span class="k">Active since</span><span class="v">${meta.active_since}</span></div>` : ''}
          ${meta.am_email ? `<div class="kv"><span class="k">AM email</span><span class="v" style="font-size:10px"><a href="mailto:${meta.am_email}" style="color:var(--text)">${meta.am_email}</a></span></div>` : ''}
          ${meta.am_phone ? `<div class="kv"><span class="k">AM phone</span><span class="v"><a href="tel:${meta.am_phone}" style="color:var(--text)">${meta.am_phone}</a></span></div>` : ''}
        `) : ''}
        ${card(`CANCELLATIONS · ${cfg.brand.toUpperCase()} only`, `
          <div class="big-num ${o.cancellation_rate_pct > 5 ? 'warn' : ''}">${fmt(o.cancellation_rate_pct, { pct: true })}</div>
          <div class="kv"><span class="k">Count</span><span class="v ${o.cancellation_count > 0 ? 'warn' : ''}">${fmt(o.cancellation_count)}</span></div>
          ${o.avg_rating !== null && o.avg_rating !== undefined ? `<div class="kv"><span class="k">Avg rating</span><span class="v">${fmt(o.avg_rating, { dec: 1 })} ★</span></div>` : ''}
          ${o.poor_rated_count > 0 ? `<div class="kv"><span class="k">Poor-rated</span><span class="v warn">${fmt(o.poor_rated_count)}</span></div>` : ''}
          <div style="font-size:9px;color:var(--dim);margin-top:6px">From aggregator_orders WHERE brand='${cfg.brand}'</div>
        `)}
        ${card(`ISSUES · ${cfg.brand.toUpperCase()} only`, o.issue_rate_pct !== undefined ? `
          <div class="big-num ${o.issue_rate_pct > 5 ? 'warn' : ''}">${fmt(o.issue_rate_pct, { pct: true })}</div>
          <div class="kv"><span class="k">Issue rate</span><span class="v"></span></div>
          ${issueRows}
          ${Object.keys(issueBreakdown).length === 0 ? '<div style="font-size:10px;color:var(--green);margin-top:4px">no issues found</div>' : ''}
        ` : '<div class="not-cap">no order data this period</div>')}
      </div>
      ${Object.keys(gaps).length ? `
        <div class="grid4" style="margin-top:12px">
          ${card('NOT YET HE-ONLY', `
            ${Object.entries(gaps).map(([k, v]) =>
              `<div style="font-size:10px;padding:3px 0;border-bottom:1px solid var(--very-faint, #1a1a30)"><strong>${k}</strong><br><span style="color:var(--dim)">${v}</span></div>`
            ).join('')}
          `)}
        </div>
      ` : ''}
    `;
  }

  // ─── SALES ──────────────────────────────────────────────────────────────
  function renderSales(s) {
    if (!s) { $('#pane-sales').innerHTML = '<div class="err">no data</div>'; return; }
    if (s.data_scope === 'unavailable') {
      $('#pane-sales').innerHTML = `<div class="empty"><h3>Sales data not yet captured</h3><p>${s.reason || ''}</p></div>`;
      return;
    }
    const t = s.totals || {};
    $('#pane-sales').innerHTML = `
      <div class="scope-bar">${scopeBadge(s.data_scope)}<span class="scope-note">${s.data_scope_note || ''}</span></div>
      <div class="grid4">
        ${card('REVENUE', `
          <div class="big-num">${fmt(t.net_sales || t.sales, { money: true })}</div>
          <div class="kv"><span class="k">Date range</span><span class="v" style="font-size:11px">${s.date_range || '—'}</span></div>
        `)}
        ${card('ORDERS', `
          <div class="big-num">${fmt(t.delivered_orders)}</div>
          <div class="kv"><span class="k">delivered</span><span class="v"></span></div>
        `)}
        ${card('AOV', `
          <div class="big-num">${fmt(t.aov, { money: true })}</div>
        `)}
        ${t.cancelled_orders !== undefined ? card('CANCELLATIONS', `
          <div class="kv"><span class="k">Cancelled</span><span class="v ${t.cancelled_orders > 0 ? 'warn' : ''}">${fmt(t.cancelled_orders)}</span></div>
          <div class="kv"><span class="k">Loss</span><span class="v ${t.cancelled_loss > 0 ? 'warn' : ''}">${fmt(t.cancelled_loss, { money: true })}</span></div>
        `) : ''}
      </div>
    `;
  }

  // ─── FINANCE ────────────────────────────────────────────────────────────
  function renderFinance(f) {
    $('#pane-finance').innerHTML = `<div class="empty"><h3>Finance data not yet captured</h3><p>${f?.reason || 'Pending Phase 1B (extension extractor for the Swiggy / Zomato finance pages).'}</p></div>`;
  }

  // ─── REVIEWS ────────────────────────────────────────────────────────────
  function renderReviews(r) {
    $('#pane-reviews').innerHTML = `<div class="empty"><h3>Reviews data not yet captured</h3><p>${r?.reason || 'Pending Phase 1B.'}</p></div>`;
  }

  // ─── ORDERS ─────────────────────────────────────────────────────────────
  function renderOrders(o) {
    if (!o) { $('#pane-orders').innerHTML = '<div class="err">no data</div>'; return; }
    const orders = o.orders || [];
    const summary = `
      <div class="scope-bar">${scopeBadge(o.data_scope)}</div>
      <div class="grid4" style="margin-bottom:14px">
        ${card('TOTAL ORDERS', `<div class="big-num">${fmt(o.total_orders)}</div>`)}
        ${card('DELIVERED', `<div class="big-num">${fmt(o.total_delivered)}</div>`)}
        ${card('REVENUE', `<div class="big-num">${fmt(o.total_revenue, { money: true })}</div>`)}
        ${card('NET PAYOUT', `<div class="big-num">${fmt(o.total_payout, { money: true })}</div>`)}
      </div>
    `;
    if (!orders.length) {
      $('#pane-orders').innerHTML = summary + `<div class="empty"><h3>No orders in this period.</h3></div>`;
      return;
    }
    const rows = orders.map(o => `
      <tr>
        <td>${o.order_date || '—'} ${o.order_time || ''}</td>
        <td><span class="status ${(o.status || '').toLowerCase().includes('deliver') ? 'good' : 'warn'}">${o.status || '—'}</span></td>
        <td>${o.order_id || '—'}</td>
        <td>${o.customer_name || '—'}</td>
        <td>${(o.items || '').substring(0, 60)}</td>
        <td class="num">${fmt(o.order_value, { money: true })}</td>
        <td class="num">${fmt(o.net_payout, { money: true })}</td>
        <td>${o.issues ? `<span class="issues">${o.issues}</span>` : '—'}</td>
        <td>${o.rating ? `★ ${o.rating}` : '—'}</td>
      </tr>
    `).join('');
    $('#pane-orders').innerHTML = summary + `
      <table class="orders-table">
        <thead><tr>
          <th>Date / Time</th><th>Status</th><th>Order ID</th><th>Customer</th><th>Items</th>
          <th class="num">Value</th><th class="num">Payout</th><th>Issues</th><th>Rating</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function card(title, body) {
    return `<div class="card"><div class="card-h">${title}</div><div class="card-b">${body}</div></div>`;
  }

  // ─── data fetch ─────────────────────────────────────────────────────────
  async function load() {
    $('#updated').textContent = 'loading…';
    try {
      const r = await fetch(`${API}?action=parsed&brand=${cfg.brand}&platform=${cfg.platform}&period=${currentPeriod}&key=${KEY}`);
      const data = await r.json();
      lastData = data;
      render(data);
    } catch (e) {
      $('#main').innerHTML = `<div class="err">Network error: ${e.message}</div>`;
    }
  }

  // ─── period + tab UI ────────────────────────────────────────────────────
  function bindUI() {
    $$('.dfbtn').forEach(b => {
      b.classList.toggle('active', b.dataset.period === currentPeriod);
      b.addEventListener('click', () => {
        currentPeriod = b.dataset.period;
        localStorage.setItem(`agg_${cfg.brand}_${cfg.platform}_period`, currentPeriod);
        $$('.dfbtn').forEach(x => x.classList.toggle('active', x.dataset.period === currentPeriod));
        load();
      });
    });
    $$('.tab').forEach(t => {
      t.addEventListener('click', () => {
        currentTab = t.dataset.tab;
        localStorage.setItem(`agg_${cfg.brand}_${cfg.platform}_tab`, currentTab);
        if (lastData) renderTab(currentTab, lastData.sections);
      });
    });
    $('#refresh').addEventListener('click', load);
  }

  // ─── boot ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    bindUI();
    load();
    // Auto-refresh every 60 seconds
    setInterval(load, 60_000);
  });
})();
