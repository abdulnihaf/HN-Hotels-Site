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
    const f = g.funnel || {};
    const c = g.customers || {};
    const ad = g.ads || {};
    const ds = g.discounts || {};
    const ls = g.listing || {};

    $('#pane-growth').innerHTML = `
      <div class="scope-bar">${scopeBadge(g.data_scope)}<span class="scope-note">${g.data_scope_note || ''}</span></div>
      <div class="grid4">
        ${card('FUNNEL', `
          <div class="kv"><span class="k">Impressions</span><span class="v">${fmt(f.impressions)}</span></div>
          <div class="kv"><span class="k">Menu opens</span><span class="v">${fmt(f.menu_opens)}<small>${fmt(f.menu_open_rate_pct, { pct: true })}</small></span></div>
          <div class="kv"><span class="k">Cart builds</span><span class="v">${fmt(f.cart_builds)}<small>${fmt(f.cart_build_rate_pct, { pct: true })}</small></span></div>
          <div class="kv"><span class="k">Orders placed</span><span class="v">${fmt(f.orders_placed)}<small>${fmt(f.order_conversion_rate_pct, { pct: true })}</small></span></div>
          ${(f.menu_opens && f.cart_builds && f.menu_opens > 0) ? `<div class="diag">${diagFunnel(f)}</div>` : ''}
        `)}
        ${card('CUSTOMERS', `
          <div class="kv"><span class="k">New</span><span class="v">${fmt(c.new)}</span></div>
          <div class="kv"><span class="k">Repeat</span><span class="v">${fmt(c.repeat)}</span></div>
          <div class="kv"><span class="k">Dormant</span><span class="v">${fmt(c.dormant)}</span></div>
          ${c.new_pct !== null && c.new_pct !== undefined ? `<div class="kv"><span class="k">New %</span><span class="v">${fmt(c.new_pct, { pct: true })}</span></div>` : ''}
          ${c.repeat_pct !== null && c.repeat_pct !== undefined ? `<div class="kv"><span class="k">Repeat %</span><span class="v">${fmt(c.repeat_pct, { pct: true })}</span></div>` : ''}
          ${c.lapsed !== undefined ? `<div class="kv"><span class="k">Lapsed</span><span class="v">${fmt(c.lapsed)}</span></div>` : ''}
        `)}
        ${card('ADS', ad.available === false ? `<div class="not-cap">${ad.note || 'not yet captured'}</div>` : `
          <div class="kv"><span class="k">CPC sales</span><span class="v">${fmt(ad.cpc_sales, { money: true })}</span></div>
          <div class="kv"><span class="k">CPC orders</span><span class="v">${fmt(ad.cpc_orders)}</span></div>
          <div class="kv"><span class="k">CPC spend</span><span class="v">${fmt(ad.cpc_spends, { money: true })}</span></div>
          <div class="kv"><span class="k">ROAS</span><span class="v">${fmt(ad.roas, { dec: 1 })}x</span></div>
          ${ad.cba_sales !== undefined ? `<div class="kv"><span class="k">CBA sales</span><span class="v">${fmt(ad.cba_sales, { money: true })}</span></div>` : ''}
          ${ad.cba_spends !== undefined ? `<div class="kv"><span class="k">CBA spend</span><span class="v">${fmt(ad.cba_spends, { money: true })}</span></div>` : ''}
        `)}
        ${card('LISTING & DISCOUNTS', ls.available === false ? `<div class="not-cap">${ls.note || 'not yet captured'}</div>` : `
          <div class="kv"><span class="k">Menu score</span><span class="v">${fmt(ls.menu_score)}<small>/100</small></span></div>
          <div class="kv"><span class="k">Items with photos</span><span class="v">${fmt(ls.items_with_photos_pct, { pct: true })}</span></div>
          <div class="kv"><span class="k">Items with desc</span><span class="v">${fmt(ls.items_with_desc_pct, { pct: true })}</span></div>
          <div class="kv"><span class="k">Online availability</span><span class="v ${ls.online_availability_pct < 90 ? 'warn' : ''}">${fmt(ls.online_availability_pct, { pct: true })}</span></div>
          ${ds.disc_sales !== undefined ? `<div class="kv"><span class="k">Discount sales</span><span class="v">${fmt(ds.disc_sales, { money: true })}</span></div>` : ''}
        `)}
      </div>
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
    const dq = o.delivery_quality_combined || {};
    const cn = o.cancellations_combined || {};
    const cm = o.complaints_combined || {};
    const bolt = o.bolt_combined;

    $('#pane-ops').innerHTML = `
      <div class="scope-bar">${scopeBadge(o.data_scope)}<span class="scope-note">${o.data_scope_note || ''}</span></div>
      <div class="grid4">
        ${card('LIVE STATUS · HE only', live.available === false ? '<div class="not-cap">live status not available</div>' : `
          <div class="big-status ${live.is_open === false ? 'bad' : 'good'}">${live.is_open === false ? 'OFFLINE' : 'OPEN'}</div>
          <div class="kv"><span class="k">Outlet ID</span><span class="v">${live.outlet_id || meta?.res_id || '—'}</span></div>
          <div class="kv"><span class="k">Serviceable</span><span class="v">${live.is_serviceable === false ? '✗ no' : '✓ yes'}</span></div>
          ${live.stress !== undefined ? `<div class="kv"><span class="k">Stress mode</span><span class="v ${live.stress ? 'warn' : ''}">${live.stress ? 'yes' : 'no'}</span></div>` : ''}
          ${live.active_batches !== undefined ? `<div class="kv"><span class="k">Active batches</span><span class="v">${live.active_batches}</span></div>` : ''}
          ${meta ? `<div class="kv"><span class="k">Active since</span><span class="v">${meta.active_since || '—'}</span></div>` : ''}
          ${meta?.am_email ? `<div class="kv"><span class="k">AM</span><span class="v" title="${meta.am_email}">${meta.am_email.split('@')[0]}</span></div>` : ''}
        `)}
        ${card('DELIVERY QUALITY', `
          ${dq.kitchen_prep_time_min !== undefined ? `<div class="kv"><span class="k">Kitchen prep</span><span class="v">${fmt(dq.kitchen_prep_time_min, { dec: 1 })} min</span></div>` : ''}
          ${dq.avg_prep_time_min !== undefined ? `<div class="kv"><span class="k">Avg prep</span><span class="v">${fmt(dq.avg_prep_time_min, { dec: 1 })} min</span></div>` : ''}
          ${dq.mfr_accuracy_pct !== undefined ? `<div class="kv"><span class="k">Accuracy</span><span class="v ${dq.mfr_accuracy_pct < 90 ? 'warn' : ''}">${fmt(dq.mfr_accuracy_pct, { pct: true })}</span></div>` : ''}
          ${dq.delayed_10min_pct !== undefined ? `<div class="kv"><span class="k">Delayed >10min</span><span class="v ${dq.delayed_10min_pct > 5 ? 'warn' : ''}">${fmt(dq.delayed_10min_pct, { pct: true })}</span></div>` : ''}
          ${dq.online_availability_pct !== undefined ? `<div class="kv"><span class="k">Avail %</span><span class="v ${dq.online_availability_pct < 90 ? 'warn' : ''}">${fmt(dq.online_availability_pct, { pct: true })}</span></div>` : ''}
          ${dq.rejected_pct !== undefined ? `<div class="kv"><span class="k">Rejected %</span><span class="v ${dq.rejected_pct > 0 ? 'warn' : ''}">${fmt(dq.rejected_pct, { pct: true })}</span></div>` : ''}
          ${dq.delayed_pct !== undefined ? `<div class="kv"><span class="k">Delayed %</span><span class="v ${dq.delayed_pct > 5 ? 'warn' : ''}">${fmt(dq.delayed_pct, { pct: true })}</span></div>` : ''}
          ${dq.poor_rated_pct !== undefined ? `<div class="kv"><span class="k">Poor-rated %</span><span class="v ${dq.poor_rated_pct > 5 ? 'warn' : ''}">${fmt(dq.poor_rated_pct, { pct: true })}</span></div>` : ''}
          ${dq.lost_sales !== undefined ? `<div class="kv"><span class="k">Lost sales</span><span class="v ${dq.lost_sales > 0 ? 'warn' : ''}">${fmt(dq.lost_sales, { money: true })}</span></div>` : ''}
        `)}
        ${cn.cancelled_orders !== undefined ? card('CANCELLATIONS', `
          <div class="kv"><span class="k">Cancelled orders</span><span class="v ${cn.cancelled_orders > 0 ? 'warn' : ''}">${fmt(cn.cancelled_orders)}</span></div>
          <div class="kv"><span class="k">Cancelled loss</span><span class="v ${cn.cancelled_loss > 0 ? 'warn' : ''}">${fmt(cn.cancelled_loss, { money: true })}</span></div>
          <div class="kv"><span class="k">Rated orders</span><span class="v">${fmt(cn.rated_orders)}</span></div>
          <div class="kv"><span class="k">Poor-rated orders</span><span class="v ${cn.poor_rated_orders > 0 ? 'warn' : ''}">${fmt(cn.poor_rated_orders)}</span></div>
        `) : ''}
        ${cm.complaint_orders !== undefined ? card('COMPLAINTS', `
          ${cm.complaint_pct !== undefined ? `<div class="kv"><span class="k">Complaint %</span><span class="v ${cm.complaint_pct > 0 ? 'warn' : ''}">${fmt(cm.complaint_pct, { pct: true })}</span></div>` : ''}
          <div class="kv"><span class="k">Total</span><span class="v ${cm.complaint_orders > 0 ? 'warn' : ''}">${fmt(cm.complaint_orders)}</span></div>
          <div class="kv"><span class="k">Unresolved</span><span class="v ${cm.unresolved_complaints > 0 ? 'bad' : ''}">${fmt(cm.unresolved_complaints)}</span></div>
          <div class="kv"><span class="k">Wrong items</span><span class="v">${fmt(cm.wrong_items)}</span></div>
          <div class="kv"><span class="k">Missing items</span><span class="v">${fmt(cm.missing_items)}</span></div>
          <div class="kv"><span class="k">Quality</span><span class="v">${fmt(cm.quality_issues)}</span></div>
          <div class="kv"><span class="k">Packaging</span><span class="v">${fmt(cm.packaging_issues)}</span></div>
        `) : ''}
      </div>
      ${bolt ? `<div class="grid4" style="margin-top:12px">${card('BOLT (instant delivery)', `
        <div class="kv"><span class="k">Orders</span><span class="v">${fmt(bolt.order_count)}</span></div>
        <div class="kv"><span class="k">% of total</span><span class="v">${fmt(bolt.pct, { pct: true })}</span></div>
        <div class="kv"><span class="k">AOV</span><span class="v">${fmt(bolt.aov, { money: true })}</span></div>
        <div class="kv"><span class="k">Avg prep</span><span class="v">${fmt(bolt.avg_prep_min, { dec: 1 })} min</span></div>
        <div class="kv"><span class="k"><6min %</span><span class="v">${fmt(bolt.lt6min_pct, { pct: true })}</span></div>
        <div class="kv"><span class="k">Delayed %</span><span class="v ${bolt.delayed_pct > 5 ? 'warn' : ''}">${fmt(bolt.delayed_pct, { pct: true })}</span></div>
      `)}</div>` : ''}
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
