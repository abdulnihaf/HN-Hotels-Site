// HE / NCH per-platform dashboard — strict per-brand UI, click-through modals.
// Loaded by ops/aggregator/he/swiggy/index.html and ops/aggregator/he/zomato/index.html.
// The page sets window.HN_AGG = { brand, platform } before loading this script.

(function () {
  const KEY = 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA';
  const API = 'https://hnhotels.in/api/aggregator-pulse';
  const cfg = window.HN_AGG || { brand: 'he', platform: 'swiggy' };

  // ─── state ──────────────────────────────────────────────────────────────
  const VALID_TABS    = ['insights','dishes','customers','orders','ops','audit'];
  const VALID_PERIODS = ['today','yesterday','thisweek','lastweek','month'];
  const _storedTab    = localStorage.getItem(`agg_${cfg.brand}_${cfg.platform}_tab`);
  const _storedPeriod = localStorage.getItem(`agg_${cfg.brand}_${cfg.platform}_period`);
  let currentPeriod = VALID_PERIODS.includes(_storedPeriod) ? _storedPeriod : 'today';
  let currentTab    = VALID_TABS.includes(_storedTab) ? _storedTab : 'insights';
  let lastData      = null;
  let lastPriorData = null;
  let lastOrderDetail = null;

  // ─── helpers ────────────────────────────────────────────────────────────
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n, opts = {}) => {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number') return String(n);
    if (opts.pct)   return `${n.toFixed(1)}%`;
    if (opts.money) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (opts.dec)   return n.toFixed(opts.dec);
    return n.toLocaleString('en-IN');
  };
  const ago = (iso) => {
    if (!iso) return '—';
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60_000)     return 'just now';
    if (d < 3_600_000)  return `${Math.round(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
    return `${Math.round(d / 86_400_000)}d ago`;
  };
  const html = (strings, ...values) => strings.reduce((r, s, i) => r + s + (values[i] !== undefined ? values[i] : ''), '');
  const escape = (s) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  const priorPeriod = (p) => ({
    today: 'yesterday', yesterday: 'today', thisweek: 'lastweek', lastweek: 'thisweek', month: 'lastweek',
  }[p] || null);
  // IST "now" (UTC+5:30) — used for period range display only.
  const istNow = () => new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  const fmtDM = (d) => d.toUTCString().slice(5, 11).trim(); // "10 May"
  const periodLabel = (p) => {
    const n = istNow();
    const sub = (days) => { const d = new Date(n); d.setUTCDate(d.getUTCDate() - days); return d; };
    // weekday 0 = Sunday in SQLite. Compute most recent Sunday.
    const lastSun = (() => { const d = new Date(n); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; });
    if (p === 'today')     return `today (${fmtDM(n)})`;
    if (p === 'yesterday') return `yesterday (${fmtDM(sub(1))})`;
    if (p === 'thisweek')  return `this week (${fmtDM(lastSun())} – ${fmtDM(n)})`;
    if (p === 'lastweek')  { const e = lastSun(); const s = new Date(e); s.setUTCDate(e.getUTCDate() - 7); const eM1 = new Date(e); eM1.setUTCDate(e.getUTCDate() - 1); return `last week (${fmtDM(s)} – ${fmtDM(eM1)})`; }
    if (p === 'month')     return `last 30 days (${fmtDM(sub(30))} – ${fmtDM(n)})`;
    return p;
  };

  // ─── delta arrows ────────────────────────────────────────────────────────
  function delta(curr, prev, opts = {}) {
    if (curr === null || curr === undefined || prev === null || prev === undefined) return '';
    if (prev === 0 && curr === 0) return html`<span class="delta">—</span>`;
    if (prev === 0) return html`<span class="delta up">▲ new</span>`;
    const d = curr - prev;
    const pct = (d / Math.abs(prev)) * 100;
    const dir = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
    const arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '—');
    const inverted = opts.invert ? (dir === 'up' ? 'down' : dir === 'down' ? 'up' : 'flat') : dir;
    return html`<span class="delta ${inverted}">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
  }

  // ─── modal infra ────────────────────────────────────────────────────────
  function openModal(title, bodyHtml) {
    const modal = $('#modal');
    modal.innerHTML = html`
      <div class="modal-backdrop" onclick="window.HN_AGG_API.closeModal()"></div>
      <div class="modal-pane" role="dialog" aria-modal="true">
        <div class="modal-h">
          <div class="modal-title">${title}</div>
          <button class="modal-x" onclick="window.HN_AGG_API.closeModal()" aria-label="Close">×</button>
        </div>
        <div class="modal-b">${bodyHtml}</div>
      </div>
    `;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    $('#modal').classList.remove('open');
    document.body.classList.remove('modal-open');
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ─── render: shell ──────────────────────────────────────────────────────
  function render() {
    if (!lastData || !lastData.ok) {
      $('#main').innerHTML = `<div class="err">Failed to load data: ${escape(JSON.stringify(lastData || {}))}</div>`;
      return;
    }
    const s = lastData.sections || {};
    const sPrev = lastPriorData?.sections || {};
    $('#brand').textContent = lastData.brand.toUpperCase();
    $('#platform').textContent = lastData.platform === 'swiggy' ? 'Swiggy' : 'Zomato';
    $('#period-display').textContent = periodLabel(currentPeriod);
    const updatedAt = s.sales?.captured_at || s.orders?.captured_at;
    $('#updated').textContent = updatedAt ? ago(updatedAt) : '—';

    renderHero(s, sPrev);
    renderTab(currentTab, s);
  }

  // ─── HERO STRIP ─────────────────────────────────────────────────────────
  function renderHero(s, sPrev) {
    const sales  = s.sales?.totals || {};
    const salesP = sPrev.sales?.totals || {};
    const cohort = s.growth?.customer_cohort_he || {};
    const disc   = s.growth?.discount_usage_he || {};
    const ops    = s.ops || {};

    // Determine "good/bad" colors per metric
    const discTone   = (disc.usage_rate_pct || 0) > 50 ? 'warn' : 'good';
    const cancelTone = (ops.cancellation_rate_pct || 0) > 5 ? 'bad' : (ops.cancellation_rate_pct || 0) > 0 ? 'warn' : 'good';
    const issueTone  = (ops.issue_rate_pct || 0) > 10 ? 'bad' : (ops.issue_rate_pct || 0) > 0 ? 'warn' : 'good';

    $('#hero').innerHTML = html`
      <div class="hero-card">
        <div class="hero-label">Revenue · ${cfg.brand.toUpperCase()}</div>
        <div class="hero-num">${fmt(sales.net_sales || 0, { money: true })}</div>
        <div class="hero-sub">${delta(sales.net_sales, salesP.net_sales)} <span class="dim">vs prior</span></div>
      </div>
      <div class="hero-card">
        <div class="hero-label">Orders</div>
        <div class="hero-num">${fmt(sales.delivered_orders || 0)}</div>
        <div class="hero-sub">${delta(sales.delivered_orders, salesP.delivered_orders)} <span class="dim">vs prior</span></div>
      </div>
      <div class="hero-card">
        <div class="hero-label">AOV</div>
        <div class="hero-num">${fmt(sales.aov || 0, { money: true })}</div>
        <div class="hero-sub">${delta(sales.aov, salesP.aov)} <span class="dim">vs prior</span></div>
      </div>
      <div class="hero-card ${cohort.first_time_pct > 60 ? 'tone-warn' : 'tone-good'}">
        <div class="hero-label">First-time %</div>
        <div class="hero-num">${fmt(cohort.first_time_pct, { pct: true })}</div>
        <div class="hero-sub dim">${cohort.first_time_orders || 0} of ${cohort.sample_size || 0} orders</div>
      </div>
      <div class="hero-card tone-${discTone}">
        <div class="hero-label">Discount usage</div>
        <div class="hero-num">${fmt(disc.usage_rate_pct, { pct: true })}</div>
        <div class="hero-sub dim">${disc.orders_with_discount || 0} of ${disc.total_orders_in_sample || 0}</div>
      </div>
      <div class="hero-card tone-${cancelTone}">
        <div class="hero-label">Cancel rate</div>
        <div class="hero-num">${fmt(ops.cancellation_rate_pct, { pct: true })}</div>
        <div class="hero-sub dim">${ops.cancellation_count || 0} cancelled</div>
      </div>
      <div class="hero-card tone-${issueTone}">
        <div class="hero-label">Issue rate</div>
        <div class="hero-num">${fmt(ops.issue_rate_pct, { pct: true })}</div>
        <div class="hero-sub dim">${Object.values(ops.issue_breakdown || {}).reduce((a, b) => a + b, 0)} flagged</div>
      </div>
    `;
  }

  // ─── tab dispatch ───────────────────────────────────────────────────────
  function renderTab(tab, s) {
    $$('.pane').forEach(p => p.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $(`#pane-${tab}`)?.classList.add('active');

    if (tab === 'insights')      return renderInsights(s);
    if (tab === 'dishes')        return renderDishes(s);
    if (tab === 'customers')     return renderCustomers(s);
    if (tab === 'orders')        return renderOrders(s);
    if (tab === 'ops')           return renderOps(s);
    if (tab === 'audit')         return renderAudit(s);
  }

  // ─── INSIGHTS TAB — capture-health banner + daily chart + insights cards ───
  function renderInsights(s) {
    const insights = generateInsights(s);
    const healthBanner = renderCaptureHealth(s.capture_health, s.sales_aggregate);
    const aggregateCard = renderAggregateFallback(s.sales_aggregate);
    const chartHtml = renderDailyChart(s.daily);
    const insightsHtml = insights.length
      ? html`<div class="insights-grid">
          ${insights.map(i => html`
            <div class="insight tone-${i.tone}" ${i.action ? `onclick="window.HN_AGG_API.${i.action}"` : ''} ${i.action ? 'role="button" tabindex="0"' : ''}>
              <div class="insight-tag">${i.tag}</div>
              <div class="insight-headline">${i.headline}</div>
              <div class="insight-body">${i.body}</div>
              ${i.action_label ? `<div class="insight-cta">${i.action_label} →</div>` : ''}
            </div>
          `).join('')}
        </div>`
      : '<div class="empty"><h3>No insight cards for this period</h3><p>The chart above still shows your last 31 days.</p></div>';
    $('#pane-insights').innerHTML = healthBanner + aggregateCard + chartHtml + insightsHtml;
  }

  // ─── CAPTURE HEALTH BANNER — honest data status indicator ────────────────
  function renderCaptureHealth(ch, sa) {
    if (!ch) return '';
    const status = ch.per_order_status;
    if (status === 'healthy') return ''; // silent when healthy
    const tone = status === 'sparse' ? 'bad' : 'warn';
    const icon = status === 'sparse' ? '⚠' : '◔';
    const lastCap = ch.last_per_order_capture
      ? new Date(ch.last_per_order_capture).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      : 'never';
    let headline, body;
    if (status === 'sparse') {
      headline = `Per-order data not captured for ${ch.platform.toUpperCase()} ${ch.brand.toUpperCase()}`;
      body = `Only ${ch.orders_last_30d} per-order rows in last 30 days · last capture ${lastCap}. ${
        ch.platform === 'swiggy'
          ? 'Swiggy Finance-page DOM scrape stopped 2026-04-17. Showing aggregate metrics from business-metrics page below — combined HE+NCH only.'
          : 'Extension may be offline or partner portal layout changed.'
      }`;
    } else {
      headline = `${ch.coverage_pct_last_30d}% capture coverage in last 30 days`;
      body = `${ch.non_zero_days_last_30d} of 31 days have order captures. Zero-bars on the chart may be capture gaps, not real zero-order days.`;
    }
    return html`
      <div class="capture-health tone-${tone}">
        <div class="ch-icon">${icon}</div>
        <div class="ch-body">
          <div class="ch-h">${headline}</div>
          <div class="ch-d">${body}</div>
        </div>
      </div>
    `;
  }

  // ─── AGGREGATE FALLBACK CARD — combined HE+NCH metrics for Swiggy ────────
  function renderAggregateFallback(sa) {
    if (!sa) return '';
    const t = sa.totals || {};
    const fmtR = (v) => v != null ? '₹' + Math.round(v).toLocaleString('en-IN') : '—';
    const fmtN = (v) => v != null ? Math.round(v).toLocaleString('en-IN') : '—';
    const cap = sa.captured_at ? new Date(sa.captured_at).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
    return html`
      <div class="agg-card">
        <div class="agg-h">
          <div class="agg-title">Aggregate metrics (combined HE + NCH) <span class="agg-pill">fallback</span></div>
          <div class="agg-cap">last update ${cap}</div>
        </div>
        <div class="agg-grid">
          <div class="agg-cell"><div class="agg-l">Net Sales</div><div class="agg-v">${fmtR(t.net_sales)}</div></div>
          <div class="agg-cell"><div class="agg-l">Delivered</div><div class="agg-v">${fmtN(t.delivered_orders)}</div></div>
          <div class="agg-cell"><div class="agg-l">Cancelled</div><div class="agg-v">${fmtN(t.cancelled_orders)}</div></div>
          <div class="agg-cell"><div class="agg-l">AOV</div><div class="agg-v">${fmtR(t.aov)}</div></div>
          <div class="agg-cell"><div class="agg-l">Impressions</div><div class="agg-v">${fmtN(t.impressions)}</div></div>
          <div class="agg-cell"><div class="agg-l">Menu opens</div><div class="agg-v">${fmtN(t.menu_opens)}</div></div>
          <div class="agg-cell"><div class="agg-l">Cart builds</div><div class="agg-v">${fmtN(t.cart_builds)}</div></div>
          <div class="agg-cell"><div class="agg-l">Orders placed</div><div class="agg-v">${fmtN(t.orders_placed)}</div></div>
        </div>
        <div class="agg-warn">${escape(sa.warning || '')}</div>
      </div>
    `;
  }

  // ─── DAILY CHART — 31-day bar chart, clickable per day ───────────────────
  function renderDailyChart(daily) {
    if (!daily || !daily.points || !daily.points.length) {
      return '<div class="chart-card"><div class="chart-empty">No daily data yet.</div></div>';
    }
    const points = daily.points;
    const maxRev = Math.max(1, ...points.map(p => p.revenue || 0));
    const maxOrd = Math.max(1, ...points.map(p => p.orders || 0));
    const totalRev = points.reduce((s, p) => s + (p.revenue || 0), 0);
    const totalOrd = points.reduce((s, p) => s + (p.orders || 0), 0);
    const zeroDays = points.filter(p => (p.orders || 0) === 0).length;
    const fmtDateShort = (ds) => {
      const [, m, d] = ds.split('-').map(Number);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d} ${months[m - 1]}`;
    };
    const bars = points.map(p => {
      const rh = Math.max(2, Math.round((p.revenue / maxRev) * 100));
      const oh = Math.max(2, Math.round((p.orders / maxOrd) * 100));
      const isZero = (p.orders || 0) === 0;
      const tip = isZero
        ? `${fmtDateShort(p.date)} — no orders / no captures`
        : `${fmtDateShort(p.date)} — ${p.orders} orders · ₹${Math.round(p.revenue).toLocaleString('en-IN')} · ${p.delivered} delivered${p.cancelled ? ' · ' + p.cancelled + ' cancelled' : ''}`;
      return html`
        <div class="bar-col ${isZero ? 'is-zero' : ''}"
             onclick="window.HN_AGG_API.openDayDrilldown('${p.date}')"
             title="${escape(tip)}"
             role="button" tabindex="0">
          <div class="bar-stack">
            <div class="bar-rev" style="height:${rh}%"></div>
            <div class="bar-ord" style="height:${oh}%"></div>
          </div>
          <div class="bar-x">${fmtDateShort(p.date).split(' ')[0]}</div>
        </div>
      `;
    }).join('');
    return html`
      <div class="chart-card">
        <div class="chart-h">
          <div class="chart-title">Last 31 days · daily revenue & orders</div>
          <div class="chart-summary">
            <span><b>₹${Math.round(totalRev).toLocaleString('en-IN')}</b> total</span>
            <span><b>${totalOrd}</b> orders</span>
            <span class="${zeroDays > 0 ? 'warn' : ''}">${zeroDays} zero-order days</span>
          </div>
        </div>
        <div class="chart-legend">
          <span class="lg-rev">■ revenue</span>
          <span class="lg-ord">■ orders</span>
          <span class="lg-note">click any bar to see that day's orders</span>
        </div>
        <div class="chart-bars">${bars}</div>
      </div>
    `;
  }

  // ─── DAY DRILLDOWN — fetch and modal-display all orders for one IST day ──
  async function openDayDrilldown(dateStr) {
    openModal(`Orders on ${dateStr}`, '<div class="modal-loading">Loading…</div>');
    try {
      const r = await fetch(`/api/aggregator-pulse?action=day-orders&platform=${cfg.platform}&brand=${cfg.brand}&date=${dateStr}`);
      const j = await r.json();
      if (!j.ok) {
        openModal(`Orders on ${dateStr}`, `<div class="err">Error: ${escape(JSON.stringify(j))}</div>`);
        return;
      }
      const orders = j.orders || [];
      if (!orders.length) {
        openModal(`Orders on ${dateStr}`, html`
          <div class="empty">
            <h3>No orders captured on ${dateStr}</h3>
            <p>This may be a genuine zero-order day — or a day when the extension was offline (e.g. May 1–5 during the Tailscale migration). Check the order count from your POS to distinguish.</p>
          </div>
        `);
        return;
      }
      const body = html`
        <div class="day-summary">
          <div><b>${j.total_orders}</b> total orders · <b>${j.total_delivered}</b> delivered · <b>${j.total_cancelled}</b> cancelled</div>
          <div><b>₹${Math.round(j.revenue).toLocaleString('en-IN')}</b> delivered revenue</div>
        </div>
        <table class="orders-tbl">
          <thead><tr>
            <th>Time</th><th>ID</th><th>Status</th><th>Customer</th><th class="right">Value</th><th class="right">Payout</th><th>Rating</th>
          </tr></thead>
          <tbody>
            ${orders.map(o => html`
              <tr>
                <td>${escape(o.order_time || '—')}</td>
                <td><code>${escape(String(o.order_id || '—'))}</code></td>
                <td><span class="pill st-${(o.status || 'unknown').toLowerCase().replace(/[^a-z]/g, '')}">${escape(o.status || '—')}</span></td>
                <td>${escape(o.customer_name || '—')}</td>
                <td class="right">₹${Math.round(o.order_value || 0).toLocaleString('en-IN')}</td>
                <td class="right">${o.net_payout ? '₹' + Math.round(o.net_payout).toLocaleString('en-IN') : '—'}</td>
                <td>${o.rating != null ? '★ ' + o.rating : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      openModal(`Orders on ${dateStr} · ${cfg.brand.toUpperCase()} · ${cfg.platform}`, body);
    } catch (e) {
      openModal(`Orders on ${dateStr}`, `<div class="err">Network error: ${escape(e.message)}</div>`);
    }
  }

  function generateInsights(s) {
    const out = [];
    const sales  = s.sales?.totals || {};
    const cohort = s.growth?.customer_cohort_he || {};
    const disc   = s.growth?.discount_usage_he || {};
    const dishes = s.growth?.top_dishes_he || [];
    const ops    = s.ops || {};
    const issueBd = ops.issue_breakdown || {};

    // 1. Discount dependency
    if (disc.usage_rate_pct >= 60) {
      out.push({
        tag: 'MARGIN RISK',
        tone: 'warn',
        headline: `${disc.usage_rate_pct}% of orders use a discount`,
        body: `${disc.orders_with_discount} of ${disc.total_orders_in_sample} orders had a promo applied. That's heavy reliance on price as the conversion lever — every order is eating margin. The lever to test: a 7-day no-discount stretch on the top 3 dishes to see if volume holds.`,
        action_label: 'See discount-applied orders',
        action: `showDiscountedOrders()`,
      });
    } else if (disc.usage_rate_pct < 30 && disc.total_orders_in_sample > 5) {
      out.push({
        tag: 'PROMO HEADROOM',
        tone: 'good',
        headline: `Only ${disc.usage_rate_pct}% of orders use a discount`,
        body: `Customers are converting without heavy promo lifting. You have headroom to run a targeted promo on a single dish to grow volume without resetting customer expectations.`,
      });
    }

    // 2. Customer cohort — retention vs acquisition
    if (cohort.first_time_pct >= 65 && cohort.sample_size >= 10) {
      out.push({
        tag: 'RETENTION GAP',
        tone: 'warn',
        headline: `${cohort.first_time_pct}% of orders are first-time customers`,
        body: `You're acquiring well but only ${cohort.repeat_orders} of ${cohort.sample_size} orders came from repeat customers. The fix: WhatsApp follow-up to first-time orderers within 48h with a "thanks + try ___" message. Targets: customers in the Customers tab marked 1st order.`,
        action_label: 'See first-time customers',
        action: `showFirstTimeCustomers()`,
      });
    } else if (cohort.repeat_orders > cohort.first_time_orders && cohort.sample_size >= 10) {
      out.push({
        tag: 'STRONG RETENTION',
        tone: 'good',
        headline: `Repeat customers (${cohort.repeat_orders}) > first-time (${cohort.first_time_orders})`,
        body: `Loyalty is doing the work. Now the lever is acquisition — what gets new eyeballs on the listing.`,
      });
    }

    // 3. Dish concentration
    if (dishes.length > 0) {
      const total = dishes.reduce((s, d) => s + (d.revenue || 0), 0);
      const top = dishes[0];
      const topPct = total > 0 ? (top.revenue / total) * 100 : 0;
      if (topPct > 30) {
        out.push({
          tag: 'CONCENTRATION RISK',
          tone: 'warn',
          headline: `${top.name} is ${topPct.toFixed(0)}% of revenue`,
          body: `Your top dish carries ${fmt(top.revenue, { money: true })} of ${fmt(total, { money: true })} total. If Zomato deprioritizes it (low rating spike, photo missing) or you stock-out, the listing drops fast. Diversification fix: feature dishes #2-#3 in the listing carousel slots.`,
          action_label: `View ${top.name} orders`,
          action: `showDishOrders('${escape(top.name).replace(/'/g, "\\'")}')`,
        });
      }
    }

    // 4. Ops health
    if (ops.cancellation_rate_pct > 5) {
      out.push({
        tag: 'OPS RED FLAG',
        tone: 'bad',
        headline: `Cancellation rate at ${ops.cancellation_rate_pct}%`,
        body: `${ops.cancellation_count} of ${sales.delivered_orders + ops.cancellation_count} orders were cancelled this period. Above 5% cancellation actively hurts your Zomato/Swiggy ranking. Diagnose: are you running out of stock, or rejecting before prep?`,
      });
    }
    if (issueBd.delay && issueBd.delay > 0) {
      out.push({
        tag: 'DELAY SIGNAL',
        tone: 'warn',
        headline: `${issueBd.delay} delayed orders flagged`,
        body: `Customers complaining about delays = poor-rated orders = ranking hit. Pull the order log filtered by delay issues to see if it's a specific time-slot or dish triggering it.`,
        action_label: 'See delay orders',
        action: `showIssueOrders('delay')`,
      });
    }

    // 5. Payment mix
    const pay = s.growth?.payment_mix_he || {};
    const total = Object.values(pay).reduce((a, b) => a + b, 0);
    if (total > 5 && (pay.PAID || 0) === total) {
      out.push({
        tag: 'PAYMENT INSIGHT',
        tone: 'good',
        headline: `100% of orders are prepaid`,
        body: `Zero COD risk on this brand. Customers committing money up-front = high-intent. Worth thinking about COD-on for a 2-week test if Zomato's COD volumes in Shivajinagar look meaningful.`,
      });
    }

    // 6. Listing-quality: data is captured combined-only
    out.push({
      tag: 'CAPTURE GAP',
      tone: 'info',
      headline: `Listing-quality metrics still combined-only`,
      body: `Impressions, menu opens, ad spend, listing score, items-with-photos — all combined HE+NCH on Swiggy/Zomato's merchant view. Per-brand version requires extension outlet-filter automation (Phase 1B). Use Listing Audit tab for what we can derive without it.`,
    });

    return out;
  }

  // ─── DISHES TAB ─────────────────────────────────────────────────────────
  let dishSortKey = 'revenue';
  let dishSortDir = 'desc';

  function renderDishes(s) {
    const dishes = (s.growth?.top_dishes_he || []).slice();
    if (!dishes.length) {
      $('#pane-dishes').innerHTML = '<div class="empty"><h3>No dish-level data yet</h3><p>Dish breakdowns come from Zomato order-detail captures. Extension fires this when partner clicks into an order. Will populate as more orders land.</p></div>';
      return;
    }
    dishes.sort((a, b) => {
      const av = a[dishSortKey] ?? 0, bv = b[dishSortKey] ?? 0;
      if (typeof av === 'string') return dishSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return dishSortDir === 'asc' ? av - bv : bv - av;
    });
    const total = dishes.reduce((s, d) => s + (d.revenue || 0), 0);
    const sortHdr = (key, label) => {
      const arrow = dishSortKey === key ? (dishSortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th onclick="window.HN_AGG_API.sortDishes('${key}')" style="cursor:pointer">${label}${arrow}</th>`;
    };

    $('#pane-dishes').innerHTML = html`
      <div class="dishes-summary">
        <div class="ds-stat"><span class="ds-num">${dishes.length}</span><span class="ds-lbl">unique dishes</span></div>
        <div class="ds-stat"><span class="ds-num">${dishes.reduce((s, d) => s + d.orders, 0)}</span><span class="ds-lbl">order-lines</span></div>
        <div class="ds-stat"><span class="ds-num">${dishes.reduce((s, d) => s + d.quantity, 0)}</span><span class="ds-lbl">total qty</span></div>
        <div class="ds-stat"><span class="ds-num">${fmt(total, { money: true })}</span><span class="ds-lbl">total revenue</span></div>
        <div class="ds-stat"><span class="ds-num">${dishes.reduce((s, d) => s + (d.discount_count || 0), 0)}</span><span class="ds-lbl">w/ discount</span></div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>#</th>
          ${sortHdr('name', 'Dish')}
          ${sortHdr('orders', 'Orders')}
          ${sortHdr('quantity', 'Qty')}
          ${sortHdr('revenue', 'Revenue')}
          <th>Share</th>
          ${sortHdr('discount_count', 'w/ Discount')}
          <th>Tags</th>
        </tr></thead>
        <tbody>
          ${dishes.map((d, i) => {
            const share = total > 0 ? (d.revenue / total) * 100 : 0;
            const heavy = d.discount_count >= d.orders * 0.5 ? 'warn' : '';
            const dtTags = (d.tags || []).filter(t => t.startsWith('dt-')).slice(0, 3).map(t => t.replace('dt-', '')).join(', ');
            return html`
              <tr onclick="window.HN_AGG_API.showDishOrders('${escape(d.name).replace(/'/g, "\\'")}')" class="clickable">
                <td class="dim">${i + 1}</td>
                <td><strong>${escape(d.name)}</strong></td>
                <td class="num">${fmt(d.orders)}</td>
                <td class="num">${fmt(d.quantity)}</td>
                <td class="num"><strong>${fmt(d.revenue, { money: true })}</strong></td>
                <td class="num">
                  <div class="bar"><div class="bar-fill" style="width:${share.toFixed(1)}%"></div><span class="bar-num">${share.toFixed(1)}%</span></div>
                </td>
                <td class="num ${heavy}">${d.discount_count || 0}</td>
                <td class="tags-cell">${escape(dtTags)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <div class="hint">Click any dish row → see HE orders containing it.</div>
    `;
  }

  // ─── CUSTOMERS TAB ──────────────────────────────────────────────────────
  function renderCustomers(s) {
    if (!lastOrderDetail) {
      $('#pane-customers').innerHTML = '<div class="loading">Loading customer detail…</div>';
      fetchOrderDetail().then(() => renderCustomers(s));
      return;
    }
    const orders = (lastOrderDetail.orders || []);
    if (!orders.length) {
      $('#pane-customers').innerHTML = '<div class="empty"><h3>No order-detail captures yet for this brand</h3></div>';
      return;
    }
    // Aggregate by customer
    const byCustomer = {};
    for (const o of orders) {
      const c = o.customer || {};
      const k = c.user_id || c.name || 'unknown';
      if (!byCustomer[k]) byCustomer[k] = { user_id: c.user_id, name: c.name || 'Unknown', lifetime_orders: c.lifetime_orders, profile_url: c.profile_url, lifetime_label: c.lifetime_orders_label, orders: [], revenue: 0 };
      byCustomer[k].orders.push(o);
      byCustomer[k].revenue += o.cart?.total || 0;
    }
    const customers = Object.values(byCustomer).sort((a, b) => b.revenue - a.revenue);
    const firstTime = customers.filter(c => (c.lifetime_orders || 0) === 1);
    const repeat    = customers.filter(c => (c.lifetime_orders || 0) > 1);

    $('#pane-customers').innerHTML = html`
      <div class="dishes-summary">
        <div class="ds-stat"><span class="ds-num">${customers.length}</span><span class="ds-lbl">unique customers</span></div>
        <div class="ds-stat"><span class="ds-num">${firstTime.length}</span><span class="ds-lbl">first-time</span></div>
        <div class="ds-stat"><span class="ds-num">${repeat.length}</span><span class="ds-lbl">repeat</span></div>
        <div class="ds-stat"><span class="ds-num">${fmt(customers.reduce((s, c) => s + c.revenue, 0), { money: true })}</span><span class="ds-lbl">total revenue</span></div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Customer</th><th>Lifetime orders</th><th class="num">In period</th><th class="num">Revenue</th><th>Profile</th><th></th>
        </tr></thead>
        <tbody>
          ${customers.map((c, i) => html`
            <tr>
              <td class="dim">${i + 1}</td>
              <td><strong>${escape(c.name)}</strong>${c.lifetime_orders === 1 ? ' <span class="tag-pill new">first-time</span>' : ''}${c.lifetime_orders > 5 ? ' <span class="tag-pill loyal">loyal</span>' : ''}</td>
              <td class="dim">${escape(c.lifetime_label || c.lifetime_orders || '—')}</td>
              <td class="num">${c.orders.length}</td>
              <td class="num"><strong>${fmt(c.revenue, { money: true })}</strong></td>
              <td>${c.profile_url ? `<a href="${escape(c.profile_url)}" target="_blank" rel="noopener">Open in Zomato ↗</a>` : '—'}</td>
              <td><button class="btn-tiny" onclick="window.HN_AGG_API.showCustomerOrders('${escape(c.user_id || c.name).replace(/'/g, "\\'")}')">View orders</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="hint">Click "Open in Zomato ↗" to see customer's full Zomato profile in a new tab — useful for deciding who to retarget via WABA.</div>
    `;
  }

  // ─── ORDERS TAB ─────────────────────────────────────────────────────────
  function renderOrders(s) {
    const o = s.orders;
    if (!o) { $('#pane-orders').innerHTML = '<div class="err">no data</div>'; return; }
    const orders = o.orders || [];
    if (!orders.length) {
      $('#pane-orders').innerHTML = html`
        <div class="dishes-summary">
          <div class="ds-stat"><span class="ds-num">0</span><span class="ds-lbl">orders</span></div>
        </div>
        <div class="empty"><h3>No orders in this period.</h3><p>Try widening to "Last 30 days" or check if extension is healthy on hn-winpc.</p></div>
      `;
      return;
    }
    $('#pane-orders').innerHTML = html`
      <div class="dishes-summary">
        <div class="ds-stat"><span class="ds-num">${o.total_orders}</span><span class="ds-lbl">total</span></div>
        <div class="ds-stat"><span class="ds-num">${o.total_delivered}</span><span class="ds-lbl">delivered</span></div>
        <div class="ds-stat"><span class="ds-num">${fmt(o.total_revenue, { money: true })}</span><span class="ds-lbl">revenue</span></div>
        <div class="ds-stat"><span class="ds-num">${fmt(o.total_payout, { money: true })}</span><span class="ds-lbl">payout</span></div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>Date · Time</th><th>Status</th><th>Order ID</th><th>Customer</th><th>Items</th>
          <th class="num">Value</th><th class="num">Payout</th><th>Issues</th><th>Rating</th><th></th>
        </tr></thead>
        <tbody>
          ${orders.map(r => html`
            <tr class="clickable" onclick="window.HN_AGG_API.showOrderDetail('${escape(String(r.order_id))}')">
              <td><div>${escape(r.order_date || '—')}</div><div class="dim">${escape(r.order_time || '')}</div></td>
              <td><span class="status ${(r.status || '').toLowerCase().includes('deliver') ? 'good' : 'warn'}">${escape(r.status || '—')}</span></td>
              <td class="mono">${escape(r.order_id || '—')}</td>
              <td>${escape(r.customer_name || '—')}</td>
              <td class="trunc" title="${escape(r.items || '')}">${escape((r.items || '').substring(0, 60))}</td>
              <td class="num"><strong>${fmt(r.order_value, { money: true })}</strong></td>
              <td class="num">${fmt(r.net_payout, { money: true })}</td>
              <td>${r.issues ? `<span class="issues">${escape(r.issues)}</span>` : '<span class="dim">—</span>'}</td>
              <td>${r.rating ? `<span class="rating">★ ${r.rating}</span>` : '<span class="dim">—</span>'}</td>
              <td><span class="dim">→</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="hint">Click any row → full cart breakdown + customer profile.</div>
    `;
  }

  // ─── OPS TAB ────────────────────────────────────────────────────────────
  function renderOps(s) {
    const o = s.ops; if (!o) return;
    const live = o.live_status || {};
    const meta = o.outlet_metadata;
    const issueBd = o.issue_breakdown || {};
    const gaps = o.not_yet_he_only || {};

    const liveOpen = live.is_open === true;
    const liveOff  = live.is_open === false;
    const cancelTone = (o.cancellation_rate_pct || 0) > 5 ? 'bad' : (o.cancellation_rate_pct || 0) > 0 ? 'warn' : 'good';
    const issueTone  = (o.issue_rate_pct || 0) > 10 ? 'bad' : (o.issue_rate_pct || 0) > 0 ? 'warn' : 'good';

    $('#pane-ops').innerHTML = html`
      <div class="grid3">
        <div class="card-big tone-${liveOpen ? 'good' : liveOff ? 'bad' : 'dim'}">
          <div class="cb-label">LIVE STATUS · ${cfg.brand.toUpperCase()} only</div>
          <div class="cb-status">${liveOpen ? 'OPEN' : liveOff ? 'OFFLINE' : '—'}</div>
          <div class="cb-rows">
            ${live.outlet_id || meta?.res_id ? `<div class="kv"><span class="k">Outlet ID</span><span class="v">${live.outlet_id || meta?.res_id}</span></div>` : ''}
            ${live.is_serviceable !== undefined ? `<div class="kv"><span class="k">Serviceable</span><span class="v">${live.is_serviceable ? '✓ yes' : '✗ no'}</span></div>` : ''}
            ${live.stress !== undefined ? `<div class="kv"><span class="k">Stress mode</span><span class="v ${live.stress ? 'warn' : ''}">${live.stress ? 'yes' : 'no'}</span></div>` : ''}
            ${live.active_batches !== undefined ? `<div class="kv"><span class="k">Active batches</span><span class="v">${live.active_batches}</span></div>` : ''}
            ${live.updated_at ? `<div class="kv"><span class="k">Updated</span><span class="v dim">${ago(live.updated_at)}</span></div>` : ''}
          </div>
        </div>

        <div class="card-big tone-${cancelTone}">
          <div class="cb-label">CANCELLATIONS · ${cfg.brand.toUpperCase()} only</div>
          <div class="cb-num">${fmt(o.cancellation_rate_pct, { pct: true })}</div>
          <div class="cb-rows">
            <div class="kv"><span class="k">Cancelled count</span><span class="v">${fmt(o.cancellation_count)}</span></div>
            ${o.avg_rating ? `<div class="kv"><span class="k">Avg rating</span><span class="v">${fmt(o.avg_rating, { dec: 1 })} ★</span></div>` : ''}
            ${o.poor_rated_count > 0 ? `<div class="kv"><span class="k">Poor-rated</span><span class="v warn">${o.poor_rated_count}</span></div>` : ''}
            <div class="kv dim"><span class="k">Source</span><span class="v">aggregator_orders</span></div>
          </div>
        </div>

        <div class="card-big tone-${issueTone}" ${o.issue_rate_pct > 0 ? `onclick="window.HN_AGG_API.showAllIssueOrders()" role="button" style="cursor:pointer"` : ''}>
          <div class="cb-label">ISSUE RATE · ${cfg.brand.toUpperCase()} only</div>
          <div class="cb-num">${fmt(o.issue_rate_pct, { pct: true })}</div>
          <div class="cb-rows">
            ${Object.entries(issueBd).length ? Object.entries(issueBd).map(([k, v]) =>
              `<div class="kv"><span class="k">${k.replace(/_/g, ' ')}</span><span class="v ${v > 0 ? 'warn' : ''}">${v}</span></div>`).join('') : '<div class="dim small">no issues found</div>'}
            ${o.issue_rate_pct > 0 ? '<div class="cb-cta">click to see issue orders →</div>' : ''}
          </div>
        </div>
      </div>

      ${meta && !meta.available === false ? html`
        <div class="card-meta">
          <div class="cm-title">OUTLET METADATA · ${cfg.brand.toUpperCase()} only</div>
          <div class="cm-grid">
            ${meta.address ? `<div class="kv"><span class="k">Address</span><span class="v"><a href="https://maps.google.com/?q=${encodeURIComponent(meta.address)}" target="_blank" rel="noopener">${escape(meta.address)} ↗</a></span></div>` : ''}
            ${meta.active_since ? `<div class="kv"><span class="k">Active since</span><span class="v">${escape(meta.active_since)}</span></div>` : ''}
            ${meta.am_email ? `<div class="kv"><span class="k">Account manager</span><span class="v"><a href="mailto:${escape(meta.am_email)}">${escape(meta.am_email)}</a></span></div>` : ''}
            ${meta.am_phone ? `<div class="kv"><span class="k">AM phone</span><span class="v"><a href="tel:${escape(meta.am_phone)}">${escape(meta.am_phone)}</a></span></div>` : ''}
          </div>
        </div>
      ` : ''}

      ${Object.keys(gaps).length ? html`
        <div class="gaps-card">
          <div class="cm-title">NOT YET HE-ONLY · gaps explained</div>
          <div class="gaps-list">
            ${Object.entries(gaps).map(([k, v]) => `<div class="gap-row"><div class="gap-key">${escape(k)}</div><div class="gap-reason">${escape(v)}</div></div>`).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  // ─── LISTING AUDIT TAB ─────────────────────────────────────────────────
  function renderAudit(s) {
    const findings = generateAuditFindings(s);
    if (!findings.length) {
      $('#pane-audit').innerHTML = '<div class="empty"><h3>Need more order data</h3><p>Audit findings need at least one delivered order this period.</p></div>';
      return;
    }
    $('#pane-audit').innerHTML = html`
      <div class="audit-intro">
        <h3>Listing audit findings · ${cfg.brand.toUpperCase()} only</h3>
        <p>Auto-generated from current order + dish data. Each finding ranked by projected impact. Phase 4 (consumer-side scraping) will add competitive context to these.</p>
      </div>
      <ol class="audit-list">
        ${findings.map((f, i) => html`
          <li class="audit-row tone-${f.tone}">
            <div class="ar-num">#${i + 1}</div>
            <div class="ar-body">
              <div class="ar-headline">${f.headline}</div>
              <div class="ar-detail">${f.detail}</div>
              <div class="ar-action"><strong>Action:</strong> ${f.action}</div>
              <div class="ar-impact"><strong>Projected impact:</strong> ${f.impact}</div>
            </div>
          </li>
        `).join('')}
      </ol>
    `;
  }

  function generateAuditFindings(s) {
    const out = [];
    const dishes = s.growth?.top_dishes_he || [];
    const cohort = s.growth?.customer_cohort_he || {};
    const disc   = s.growth?.discount_usage_he || {};
    const ops    = s.ops || {};

    // Discount over-reliance
    if (disc.usage_rate_pct >= 60) {
      out.push({
        tone: 'warn',
        headline: `Discount dependency at ${disc.usage_rate_pct}% — top priority fix`,
        detail: `${disc.orders_with_discount} of ${disc.total_orders_in_sample} orders carry a discount. Customers train themselves to wait for promos. Margin gets eaten.`,
        action: `Run a 7-day no-discount A/B on your top dish. Measure volume change. If volume drops <20%, your prices are correctly calibrated and discounts are unnecessary.`,
        impact: `If volume holds, ~${Math.round(disc.usage_rate_pct * 0.7)}% margin recovery on those orders. Even a 50% discount-elim with 20% volume drop = net positive.`,
      });
    }

    // Concentration risk
    if (dishes.length > 0) {
      const total = dishes.reduce((s, d) => s + (d.revenue || 0), 0);
      const top   = dishes[0];
      const topPct = total > 0 ? (top.revenue / total) * 100 : 0;
      if (topPct > 30) {
        out.push({
          tone: 'warn',
          headline: `${top.name} carries ${topPct.toFixed(0)}% of revenue`,
          detail: `Listing is hostage to one dish. Stockout, photo loss, or rating drop on this dish = listing collapse. The next 3 dishes (${dishes.slice(1, 4).map(d => d.name).join(', ')}) are not pulling their weight.`,
          action: `Promote dishes #2-#4 in the listing carousel. Add Zomato 'must try' tag if available. Photo-quality audit on those 3 dishes.`,
          impact: `Aim for top dish < 25% revenue share within 4 weeks. Each diversified dish at #2-#4 typically picks up +3-5 orders/week with prominence.`,
        });
      }
    }

    // First-time customer leak
    if (cohort.first_time_pct >= 65 && cohort.sample_size >= 10) {
      out.push({
        tone: 'warn',
        headline: `Retention leak: ${cohort.first_time_pct}% first-time customers`,
        detail: `Acquisition is healthy. Retention isn't. Every new customer who orders once and disappears is paid acquisition cost burnt.`,
        action: `WABA template message 24-48h after first delivery: "Thanks ${cohort.first_time_orders > 0 ? '[name]' : 'first-timer'}, hope you enjoyed [dish]. Try our [dish #2] next time — here's 10% off". DLT-register the template if not already.`,
        impact: `Industry baseline: WABA retention nudge converts 8-15% of first-time orderers into 2nd order within 2 weeks. On ${cohort.first_time_orders} first-timers that's ~${Math.round(cohort.first_time_orders * 0.1)}-${Math.round(cohort.first_time_orders * 0.15)} additional orders.`,
      });
    }

    // Dish photo + tags audit (proxy)
    if (dishes.length > 0) {
      const lowVolDishes = dishes.filter(d => d.orders < 2 && d.revenue < 200);
      if (lowVolDishes.length >= 3) {
        out.push({
          tone: 'info',
          headline: `${lowVolDishes.length} dishes with <2 orders this period — likely listing-quality issue`,
          detail: `Dishes that should be discoverable but aren't getting orders: ${lowVolDishes.slice(0, 5).map(d => d.name).join(', ')}. Common causes: missing photo, weak description, wrong category tag, or just too far down the menu.`,
          action: `Open Zomato partner app → Menu → for each underperformer: confirm photo present, description ≥ 12 words, tagged into the right cuisine category. Move underperformers to bottom of menu so top dishes get prime real estate.`,
          impact: `Each fixed listing typically gains +1-2 orders/week. If 5 dishes fixed, ~25-50 added orders/month at HE's current AOV.`,
        });
      }
    }

    // Ops issues drag ranking
    if (ops.issue_rate_pct > 5 || (ops.issue_breakdown?.delay || 0) > 1) {
      out.push({
        tone: 'bad',
        headline: `${ops.issue_rate_pct}% issue rate is dragging ranking`,
        detail: `Both Zomato and Swiggy use customer issue rates as ranking signal. Even ${ops.issue_breakdown?.delay || 0} delays this period costs you organic impressions.`,
        action: `Pull the order log filtered by delay issues. Map to time-slot. If concentrated in dinner peak, kitchen capacity is the constraint — staffing up vs accepting fewer orders is the call. Set Zomato handover-time +2min during peak.`,
        impact: `Each 5% drop in issue rate ≈ +200-400 impressions/day from algo. Bigger lever than ad spend at this scale.`,
      });
    }

    // Listing-quality data gap
    out.push({
      tone: 'info',
      headline: `Listing-quality scoring is still combined-only`,
      detail: `Menu score, items-with-photos %, online availability are reported by Zomato/Swiggy as combined HE+NCH numbers. We can't yet attribute these to HE specifically.`,
      action: `Phase 1B: extension applies outlet filter on Swiggy business-metrics + Zomato live tracking, captures per-brand version. Until then, treat combined version as "directional only."`,
      impact: `Once Phase 1B lands, this audit gains 7 more dimensions. The bigger unlock is Phase 4 (consumer-side scraping) which adds competitor positioning.`,
    });

    return out;
  }

  // ─── DRILL-DOWN: dish orders modal ──────────────────────────────────────
  async function showDishOrders(dishName) {
    if (!lastOrderDetail) await fetchOrderDetail();
    const matching = (lastOrderDetail.orders || []).filter(o =>
      (o.cart?.dishes || []).some(d => d.name === dishName));
    const totalQty = matching.reduce((s, o) => s + (o.cart?.dishes || []).filter(d => d.name === dishName).reduce((q, d) => q + (d.quantity || 0), 0), 0);
    const totalRev = matching.reduce((s, o) => s + (o.cart?.dishes || []).filter(d => d.name === dishName).reduce((r, d) => r + (d.total_cost || 0), 0), 0);

    openModal(`Orders containing "${escape(dishName)}"`, html`
      <div class="dishes-summary" style="margin-bottom:14px">
        <div class="ds-stat"><span class="ds-num">${matching.length}</span><span class="ds-lbl">orders</span></div>
        <div class="ds-stat"><span class="ds-num">${totalQty}</span><span class="ds-lbl">qty</span></div>
        <div class="ds-stat"><span class="ds-num">${fmt(totalRev, { money: true })}</span><span class="ds-lbl">revenue</span></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="num">Qty</th><th class="num">Subtotal</th><th>Discount</th><th>State</th></tr></thead>
        <tbody>
          ${matching.map(o => {
            const dishMatches = (o.cart?.dishes || []).filter(d => d.name === dishName);
            const qty = dishMatches.reduce((s, d) => s + (d.quantity || 0), 0);
            const sub = dishMatches.reduce((s, d) => s + (d.total_cost || 0), 0);
            const discount = dishMatches.flatMap(d => d.discount || []).map(x => x.name).filter(Boolean).join(', ');
            return html`
              <tr>
                <td class="mono">${escape(o.display_id || o.order_id)}</td>
                <td>${o.timeline?.created_at ? new Date(o.timeline.created_at).toLocaleDateString() : '—'}</td>
                <td>${escape(o.customer?.name || '—')}<br><span class="dim small">${escape(o.customer?.lifetime_orders_label || '')}</span></td>
                <td class="num">${qty}</td>
                <td class="num">${fmt(sub, { money: true })}</td>
                <td>${discount ? `<span class="tag-pill">${escape(discount)}</span>` : '<span class="dim">—</span>'}</td>
                <td><span class="status ${o.state === 'DELIVERED' ? 'good' : 'warn'}">${escape(o.state)}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `);
  }

  // ─── DRILL-DOWN: discount-applied orders modal ──────────────────────────
  async function showDiscountedOrders() {
    if (!lastOrderDetail) await fetchOrderDetail();
    const orders = (lastOrderDetail.orders || []).filter(o =>
      (o.cart?.dishes || []).some(d => (d.discount || []).length > 0));
    openModal(`Orders with discount applied (${orders.length})`, html`
      <table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Dish</th><th>Promo name</th><th class="num">Discount</th><th class="num">Order ₹</th></tr></thead>
        <tbody>
          ${orders.flatMap(o => (o.cart?.dishes || []).flatMap(d => (d.discount || []).map(disc => html`
            <tr>
              <td class="mono">${escape(o.display_id || o.order_id)}</td>
              <td>${o.timeline?.created_at ? new Date(o.timeline.created_at).toLocaleDateString() : '—'}</td>
              <td>${escape(o.customer?.name || '—')}</td>
              <td>${escape(d.name)}</td>
              <td><span class="tag-pill">${escape(disc.name || 'unnamed')}</span></td>
              <td class="num warn">${disc.is_percentage ? fmt(disc.amount, { pct: true }) : fmt(disc.amount, { money: true })}</td>
              <td class="num">${fmt(o.cart?.total, { money: true })}</td>
            </tr>
          `))).join('')}
        </tbody>
      </table>
    `);
  }

  async function showFirstTimeCustomers() {
    if (!lastOrderDetail) await fetchOrderDetail();
    const customers = {};
    for (const o of (lastOrderDetail.orders || [])) {
      const c = o.customer || {};
      if (c.lifetime_orders === 1 && c.user_id && !customers[c.user_id]) customers[c.user_id] = { ...c, order: o };
    }
    const list = Object.values(customers);
    openModal(`First-time customers (${list.length})`, html`
      <p class="dim small" style="margin-bottom:12px">Each of these placed their first-ever Zomato order at ${cfg.brand.toUpperCase()}. Open profile in Zomato to find their handle, then queue WABA retention nudge.</p>
      <table class="data-table">
        <thead><tr><th>Name</th><th>First order</th><th class="num">₹</th><th>Profile</th></tr></thead>
        <tbody>
          ${list.map(c => html`
            <tr>
              <td><strong>${escape(c.name)}</strong></td>
              <td>${c.order.timeline?.created_at ? new Date(c.order.timeline.created_at).toLocaleString() : '—'}</td>
              <td class="num">${fmt(c.order.cart?.total, { money: true })}</td>
              <td>${c.profile_url ? `<a href="${escape(c.profile_url)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  async function showCustomerOrders(userId) {
    if (!lastOrderDetail) await fetchOrderDetail();
    const orders = (lastOrderDetail.orders || []).filter(o => (o.customer?.user_id || o.customer?.name) === userId);
    if (!orders.length) return openModal('No orders', '<p>None found.</p>');
    const c = orders[0].customer || {};
    openModal(`${escape(c.name || 'Customer')} — ${orders.length} order(s)`, html`
      <p class="dim small" style="margin-bottom:12px">${escape(c.lifetime_orders_label || '')} ${c.profile_url ? `· <a href="${escape(c.profile_url)}" target="_blank" rel="noopener">Zomato profile ↗</a>` : ''}</p>
      <table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Dishes</th><th class="num">₹</th><th>State</th></tr></thead>
        <tbody>
          ${orders.map(o => html`
            <tr>
              <td class="mono">${escape(o.display_id || o.order_id)}</td>
              <td>${o.timeline?.created_at ? new Date(o.timeline.created_at).toLocaleString() : '—'}</td>
              <td>${(o.cart?.dishes || []).map(d => `${d.quantity}x ${escape(d.name)}`).join(', ')}</td>
              <td class="num">${fmt(o.cart?.total, { money: true })}</td>
              <td><span class="status ${o.state === 'DELIVERED' ? 'good' : 'warn'}">${escape(o.state)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  async function showOrderDetail(orderId) {
    if (!lastOrderDetail) await fetchOrderDetail();
    const o = (lastOrderDetail.orders || []).find(x => String(x.order_id) === String(orderId) || String(x.display_id) === String(orderId));
    if (!o) return openModal('Order detail', `<p>Detailed capture not available for order ${escape(orderId)}. Order-detail API only fires when partner clicks into an order in Zomato portal.</p>`);
    const c = o.customer || {};
    const dishes = o.cart?.dishes || [];
    const t = o.timeline || {};
    openModal(`Order ${escape(o.display_id || o.order_id)} · ${cfg.brand.toUpperCase()}`, html`
      <div class="order-detail-grid">
        <div class="odg-section">
          <div class="cm-title">Customer</div>
          <div class="kv"><span class="k">Name</span><span class="v"><strong>${escape(c.name || '—')}</strong></span></div>
          <div class="kv"><span class="k">Lifetime orders</span><span class="v">${escape(c.lifetime_orders_label || c.lifetime_orders || '—')}</span></div>
          ${c.profile_url ? `<div class="kv"><span class="k">Profile</span><span class="v"><a href="${escape(c.profile_url)}" target="_blank" rel="noopener">Open in Zomato ↗</a></span></div>` : ''}
        </div>
        <div class="odg-section">
          <div class="cm-title">Timeline</div>
          ${t.created_at ? `<div class="kv"><span class="k">Created</span><span class="v">${new Date(t.created_at).toLocaleTimeString()}</span></div>` : ''}
          ${t.actioned_at ? `<div class="kv"><span class="k">Accepted</span><span class="v">${new Date(t.actioned_at).toLocaleTimeString()}</span></div>` : ''}
          ${t.food_ready_at ? `<div class="kv"><span class="k">Food ready</span><span class="v">${new Date(t.food_ready_at).toLocaleTimeString()}</span></div>` : ''}
          ${t.prep_min ? `<div class="kv"><span class="k">Prep time set</span><span class="v">${t.prep_min} min (${t.prep_min_min}-${t.prep_min_max} allowed)</span></div>` : ''}
        </div>
        <div class="odg-section">
          <div class="cm-title">Payment & state</div>
          <div class="kv"><span class="k">State</span><span class="v"><span class="status ${o.state === 'DELIVERED' ? 'good' : 'warn'}">${escape(o.state)}</span></span></div>
          <div class="kv"><span class="k">Method</span><span class="v">${escape(o.payment?.method || '—')}</span></div>
          <div class="kv"><span class="k">Mode</span><span class="v">${escape(o.delivery_mode || '—')}</span></div>
          ${o.zomato_delivered ? `<div class="kv"><span class="k">Rider</span><span class="v">Zomato Delivered</span></div>` : ''}
        </div>
      </div>
      <div style="margin-top:14px"><div class="cm-title">Cart</div></div>
      <table class="data-table">
        <thead><tr><th>Dish</th><th class="num">Qty</th><th class="num">Unit ₹</th><th class="num">Total ₹</th><th>Discount</th><th>Tags</th></tr></thead>
        <tbody>
          ${dishes.map(d => html`
            <tr>
              <td><strong>${escape(d.name)}</strong></td>
              <td class="num">${d.quantity}</td>
              <td class="num">${fmt(d.unit_cost, { money: true })}</td>
              <td class="num"><strong>${fmt(d.total_cost, { money: true })}</strong></td>
              <td>${(d.discount || []).map(x => `<span class="tag-pill">${escape(x.name)}</span>`).join(' ')}</td>
              <td class="tags-cell">${(d.tags || []).filter(t => t.startsWith('dt-')).slice(0, 3).map(t => t.replace('dt-', '')).join(', ')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="kv" style="margin-top:10px"><span class="k">Subtotal</span><span class="v">${fmt(o.cart?.subtotal, { money: true })}</span></div>
      <div class="kv"><span class="k"><strong>Total</strong></span><span class="v"><strong>${fmt(o.cart?.total, { money: true })}</strong></span></div>
    `);
  }

  function showIssueOrders(issueType) {
    const orders = (lastData?.sections?.orders?.orders || []).filter(o =>
      o.issues && new RegExp(issueType, 'i').test(o.issues));
    openModal(`Orders with ${issueType} issue (${orders.length})`, html`
      <table class="data-table">
        <thead><tr><th>Order ID</th><th>Date</th><th>Customer</th><th>Items</th><th class="num">₹</th><th>Issue</th></tr></thead>
        <tbody>
          ${orders.map(o => html`
            <tr>
              <td class="mono">${escape(o.order_id)}</td>
              <td>${escape(o.order_date || '—')} ${escape(o.order_time || '')}</td>
              <td>${escape(o.customer_name || '—')}</td>
              <td class="trunc" title="${escape(o.items || '')}">${escape((o.items || '').substring(0, 50))}</td>
              <td class="num">${fmt(o.order_value, { money: true })}</td>
              <td><span class="issues">${escape(o.issues)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  function showAllIssueOrders() {
    const orders = (lastData?.sections?.orders?.orders || []).filter(o => o.issues && String(o.issues).trim());
    openModal(`All flagged-issue orders (${orders.length})`, html`
      <table class="data-table">
        <thead><tr><th>Order ID</th><th>Date</th><th>Customer</th><th>Items</th><th class="num">₹</th><th>Issue</th></tr></thead>
        <tbody>
          ${orders.map(o => html`
            <tr>
              <td class="mono">${escape(o.order_id)}</td>
              <td>${escape(o.order_date || '—')} ${escape(o.order_time || '')}</td>
              <td>${escape(o.customer_name || '—')}</td>
              <td class="trunc">${escape((o.items || '').substring(0, 50))}</td>
              <td class="num">${fmt(o.order_value, { money: true })}</td>
              <td><span class="issues">${escape(o.issues)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  // ─── data fetch ─────────────────────────────────────────────────────────
  async function fetchOrderDetail() {
    try {
      const r = await fetch(`${API}?action=order-detail&brand=${cfg.brand}&platform=${cfg.platform}&limit=200&key=${KEY}`);
      lastOrderDetail = await r.json();
    } catch (e) { lastOrderDetail = { ok: false, error: e.message, orders: [] }; }
  }

  async function load() {
    $('#updated').textContent = 'loading…';
    try {
      const [r, rPrev] = await Promise.all([
        fetch(`${API}?action=parsed&brand=${cfg.brand}&platform=${cfg.platform}&period=${currentPeriod}&key=${KEY}`),
        priorPeriod(currentPeriod)
          ? fetch(`${API}?action=parsed&brand=${cfg.brand}&platform=${cfg.platform}&period=${priorPeriod(currentPeriod)}&key=${KEY}`)
          : Promise.resolve(null),
      ]);
      lastData      = await r.json();
      lastPriorData = rPrev ? await rPrev.json() : null;
      // Pre-fetch order detail for click-throughs (cheap for the user, lazy on the wire)
      if (cfg.platform === 'zomato') fetchOrderDetail();
      render();
    } catch (e) {
      $('#main').innerHTML = `<div class="err">Network error: ${escape(e.message)}</div>`;
    }
  }

  // ─── period + tab UI bindings ───────────────────────────────────────────
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
    $('#refresh')?.addEventListener('click', load);
    // Set initial active tab
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  }

  // ─── public API for inline onclick handlers ─────────────────────────────
  window.HN_AGG_API = {
    closeModal,
    showDishOrders,
    showDiscountedOrders,
    showFirstTimeCustomers,
    showCustomerOrders,
    showOrderDetail,
    showIssueOrders,
    showAllIssueOrders,
    openDayDrilldown,
    sortDishes(key) {
      if (dishSortKey === key) dishSortDir = dishSortDir === 'asc' ? 'desc' : 'asc';
      else { dishSortKey = key; dishSortDir = 'desc'; }
      if (lastData) renderDishes(lastData.sections);
    },
  };

  // ─── boot ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    bindUI();
    load();
    setInterval(load, 60_000);
  });
})();
