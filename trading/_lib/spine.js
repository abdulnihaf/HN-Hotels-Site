// Wealth Engine — THE SPINE (Phase A of doc 19 §9)
//
// Always-visible top strip + bottom phase indicator on every /trading/* page.
// Self-mounting: include via <script src="/trading/_lib/spine.js" defer></script>
// at the end of <body>. Auto-refreshes every 30 seconds.
//
// Reads from: GET /api/trading?action=top_strip (additive read-only endpoint).
// PIN: reuses 'wealth_dashboard_key' from localStorage (same as every other page).
//
// Mobile-first. Tablet/desktop progressively expand columns.
//
// Per doc 18 §3: this file lives in trading/_lib/ (🟢 freely editable zone).
// Per doc 19 §5: design wireframe is the contract this file implements.

(function () {
  'use strict';

  // Run only on /trading/* pages.
  if (!location.pathname.startsWith('/trading/')) return;

  // Don't double-mount if hot-reloaded
  if (window.__SPINE_MOUNTED__) return;
  window.__SPINE_MOUNTED__ = true;

  const STORE_KEY = 'wealth_dashboard_key';
  const REFRESH_MS = 30000;
  const API_PATH = '/api/trading?action=top_strip';

  // ─── 1. Inject styles ─────────────────────────────────────────────────────
  const css = `
    :root {
      --spine-bg: #0d1426;
      --spine-bg-2: #18223d;
      --spine-border: #2a3656;
      --spine-text: #e6ecff;
      --spine-muted: #8a96b8;
      --spine-green: #2ecc71;
      --spine-red: #e74c3c;
      --spine-yellow: #f5b041;
      --spine-blue: #4fa3ff;
      --spine-purple: #b164ff;
      --spine-brown: #c08a5b;
      --spine-gray: #6b7693;
    }
    body.has-spine {
      padding-top: 76px !important;
      padding-bottom: 44px !important;
    }
    @media (min-width: 700px) {
      body.has-spine { padding-top: 56px !important; padding-bottom: 40px !important; }
    }
    #spine-top, #spine-bottom {
      position: fixed; left: 0; right: 0; z-index: 999;
      background: var(--spine-bg); color: var(--spine-text);
      font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      background-color: rgba(13, 20, 38, 0.94);
    }
    #spine-top {
      top: 0; border-bottom: 1px solid var(--spine-border);
      padding-top: env(safe-area-inset-top, 0);
    }
    #spine-bottom {
      bottom: 0; border-top: 1px solid var(--spine-border);
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    .spine-row {
      display: flex; align-items: center; gap: 0;
      padding: 6px 12px; min-height: 36px;
      overflow-x: auto; -webkit-overflow-scrolling: touch;
      scrollbar-width: none; -ms-overflow-style: none;
      white-space: nowrap;
    }
    .spine-row::-webkit-scrollbar { display: none; }
    .spine-row:not(:last-child) { border-bottom: 1px solid var(--spine-border); }
    .spine-cell {
      display: inline-flex; flex-direction: column; align-items: flex-start;
      padding: 0 10px; gap: 1px;
      border-right: 1px solid var(--spine-border);
    }
    .spine-cell:last-child { border-right: none; }
    .spine-cell .lbl {
      font-size: 9px; color: var(--spine-muted);
      text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500;
    }
    .spine-cell .val {
      font-size: 13px; font-weight: 600; color: var(--spine-text);
      display: flex; align-items: center; gap: 4px;
    }
    .spine-cell .delta { font-size: 10px; font-weight: 500; }
    .delta.up { color: var(--spine-green); }
    .delta.down { color: var(--spine-red); }
    .delta.flat { color: var(--spine-muted); }

    .spine-bottom-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; min-height: 36px; font-size: 11px;
      overflow-x: auto; white-space: nowrap;
      scrollbar-width: none; -ms-overflow-style: none;
    }
    .spine-bottom-row::-webkit-scrollbar { display: none; }
    .phase-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 9px; border-radius: 12px; font-weight: 700;
      font-size: 10px; letter-spacing: 0.4px;
    }
    .phase-pill .dot { width: 7px; height: 7px; border-radius: 50%; }
    .phase-pill.green   { background: rgba(46,204,113,0.15);  color: var(--spine-green); }
    .phase-pill.green .dot   { background: var(--spine-green); animation: pulse 2s ease-in-out infinite; }
    .phase-pill.yellow  { background: rgba(245,176,65,0.15);  color: var(--spine-yellow); }
    .phase-pill.yellow .dot  { background: var(--spine-yellow); }
    .phase-pill.blue    { background: rgba(79,163,255,0.15);  color: var(--spine-blue); }
    .phase-pill.blue .dot    { background: var(--spine-blue); animation: pulse 1.5s ease-in-out infinite; }
    .phase-pill.purple  { background: rgba(177,100,255,0.15); color: var(--spine-purple); }
    .phase-pill.purple .dot  { background: var(--spine-purple); }
    .phase-pill.brown   { background: rgba(192,138,91,0.15);  color: var(--spine-brown); }
    .phase-pill.brown .dot   { background: var(--spine-brown); }
    .phase-pill.gray    { background: rgba(107,118,147,0.15); color: var(--spine-gray); }
    .phase-pill.gray .dot    { background: var(--spine-gray); }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.85); }
    }
    .gono-pill {
      display: inline-flex; padding: 3px 9px; border-radius: 12px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
    }
    .gono-pill.go            { background: rgba(46,204,113,0.18); color: var(--spine-green); }
    .gono-pill.go-with-warning { background: rgba(245,176,65,0.18); color: var(--spine-yellow); }
    .gono-pill.no-go         { background: rgba(231,76,60,0.18);  color: var(--spine-red); }
    .spine-sep {
      color: var(--spine-border); margin: 0 2px; font-weight: 400; user-select: none;
    }
    .spine-meta { color: var(--spine-muted); }
    .spine-meta strong { color: var(--spine-text); font-weight: 600; }
    .pnl.positive { color: var(--spine-green); }
    .pnl.negative { color: var(--spine-red); }
    .pnl.zero { color: var(--spine-muted); }

    /* Hide secondary cross-asset chips on mobile */
    @media (max-width: 699px) {
      .spine-cell.tablet-only { display: none; }
    }

    .spine-error {
      padding: 6px 12px; font-size: 11px;
      color: var(--spine-yellow); text-align: center;
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'spine-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ─── 2. Mount DOM scaffold ────────────────────────────────────────────────
  const top = document.createElement('div');
  top.id = 'spine-top';
  top.innerHTML = '<div class="spine-error">Loading market state…</div>';

  const bottom = document.createElement('div');
  bottom.id = 'spine-bottom';
  bottom.innerHTML = '<div class="spine-bottom-row"><span class="spine-meta">…</span></div>';

  document.body.appendChild(top);
  document.body.appendChild(bottom);
  document.body.classList.add('has-spine');

  // ─── 3. Helpers ────────────────────────────────────────────────────────────
  function fmtNum(v, opts = {}) {
    const { decimals = 0, prefix = '' } = opts;
    if (v == null || isNaN(v)) return '—';
    const n = Number(v);
    return prefix + n.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  function fmtRupees(paise) {
    if (paise == null || isNaN(paise)) return '—';
    const r = Math.round(paise / 100);
    if (Math.abs(r) >= 100000) return '₹' + (r / 100000).toFixed(1) + 'L';
    if (Math.abs(r) >= 1000) return '₹' + (r / 1000).toFixed(1) + 'k';
    return '₹' + r.toLocaleString('en-IN');
  }
  function fmtPnl(paise) {
    if (paise == null || isNaN(paise)) return '—';
    const sign = paise > 0 ? '+' : '';
    return sign + fmtRupees(paise);
  }
  function fmtSecondsAsHm(s) {
    if (s == null || s < 0) return null;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function deltaClass(pct) {
    if (pct == null || isNaN(pct)) return 'flat';
    if (pct > 0.05) return 'up';
    if (pct < -0.05) return 'down';
    return 'flat';
  }
  function deltaArrow(pct) {
    if (pct == null || isNaN(pct)) return '·';
    if (pct > 0.05) return '↑';
    if (pct < -0.05) return '↓';
    return '·';
  }

  function cell(label, value, delta = null, opts = {}) {
    const tabletOnly = opts.tabletOnly ? ' tablet-only' : '';
    const dCls = deltaClass(delta);
    const dStr = delta != null ? `<span class="delta ${dCls}">${deltaArrow(delta)}${Math.abs(delta).toFixed(2)}%</span>` : '';
    return `<div class="spine-cell${tabletOnly}">
      <div class="lbl">${label}</div>
      <div class="val">${value} ${dStr}</div>
    </div>`;
  }

  // ─── 4. Render ─────────────────────────────────────────────────────────────
  function renderTop(d) {
    const idx = Object.fromEntries((d.indices || []).map(i => [i.name, i]));
    const ca = d.crossasset || {};
    const cap = d.capital || {};

    const niftyCell  = idx['NIFTY 50']    ? cell('NIFTY',   fmtNum(idx['NIFTY 50'].value, { decimals: 1 }),    idx['NIFTY 50'].change_pct)    : '';
    const bnfCell    = idx['NIFTY BANK']  ? cell('BNF',     fmtNum(idx['NIFTY BANK'].value, { decimals: 1 }),  idx['NIFTY BANK'].change_pct)  : '';
    const vixCell    = idx['INDIA VIX']   ? cell('VIX',     fmtNum(idx['INDIA VIX'].value, { decimals: 1 }),   null)                          : '';
    const usdinrCell = ca.USDINR          ? cell('USDINR',  fmtNum(ca.USDINR.value, { decimals: 2 }),          ca.USDINR.change_pct)          : '';
    const dxyCell    = ca.DXY             ? cell('DXY',     fmtNum(ca.DXY.value,    { decimals: 1 }),          ca.DXY.change_pct,    { tabletOnly: true }) : '';
    const brentCell  = ca.BRENT           ? cell('BRENT',   fmtNum(ca.BRENT.value,  { decimals: 1 }),          ca.BRENT.change_pct,  { tabletOnly: true }) : '';
    const giftCell   = ca.GIFT_NIFTY      ? cell('GIFT',    fmtNum(ca.GIFT_NIFTY.value, { decimals: 0 }),      null,                 { tabletOnly: true }) : '';
    const us10yCell  = ca.US10Y           ? cell('US10Y',   fmtNum(ca.US10Y.value, { decimals: 2 }) + '%',     ca.US10Y.change_pct,  { tabletOnly: true }) : '';

    const indicesRow = `<div class="spine-row">${niftyCell}${bnfCell}${vixCell}${usdinrCell}${dxyCell}${brentCell}${giftCell}${us10yCell}</div>`;

    // Capital row
    const totalPaise = cap.total_paise || 0;
    const deployedPaise = cap.deployed_paise || 0;
    const pnlPaise = cap.today_pnl_paise || 0;
    const pnlCls = pnlPaise > 0 ? 'positive' : pnlPaise < 0 ? 'negative' : 'zero';
    const pnlSign = pnlPaise > 0 ? '+' : '';
    const goNoGo = (d.readiness?.go_no_go || 'GO').toLowerCase().replace(/_/g, '-');
    const goNoGoLabel = (d.readiness?.go_no_go || 'GO').replace(/_/g, ' ');

    const capRow = `<div class="spine-row" style="font-size:11px">
      <span class="spine-meta">💰 <strong>${fmtRupees(deployedPaise)}/${fmtRupees(totalPaise)}</strong> (${cap.deployed_pct || 0}%)</span>
      <span class="spine-sep">·</span>
      <span class="pnl ${pnlCls}"><strong>${pnlSign}${fmtRupees(pnlPaise)}</strong></span>
      <span class="spine-sep">·</span>
      <span class="spine-meta">🎯 <strong>${cap.position_count || 0}</strong> pos</span>
      <span class="spine-sep">·</span>
      <span class="gono-pill ${goNoGo}">${goNoGoLabel}</span>
      <span class="spine-meta" style="margin-left:auto">T-${d.readiness?.days_to_real_money || 0}d</span>
    </div>`;

    top.innerHTML = indicesRow + capRow;
  }

  function renderBottom(d) {
    const ph = d.phase || {};
    const cap = d.capital || {};
    const phaseCls = ph.color || 'gray';
    const phaseLabel = (ph.label || 'OFF_HOURS').replace(/_/g, '-');

    const hardExitText = ph.hard_exit_seconds != null
      ? `Hard exit T-${fmtSecondsAsHm(ph.hard_exit_seconds)}`
      : ph.label === 'PRE_OPEN'
        ? `Live opens T-${Math.max(0, Math.ceil((9*60+15 - parseInt(ph.ist_now.split(':')[0])*60 - parseInt(ph.ist_now.split(':')[1])))/1)}m`
        : ph.next_phase_label
          ? `→ ${ph.next_phase_label.replace(/_/g, '-')} ${ph.next_phase_ist}`
          : '';

    let lockText = '';
    if (cap.profit_lock_remaining_paise > 0 && cap.today_pnl_paise > 0 && ph.label === 'LIVE') {
      lockText = `Profit lock T-${fmtRupees(cap.profit_lock_remaining_paise)}`;
    } else if (cap.today_pnl_paise >= (cap.profit_lock_threshold_paise || 3000000) && ph.label === 'LIVE') {
      lockText = `🔒 Profit lock ARMED`;
    }

    bottom.innerHTML = `<div class="spine-bottom-row">
      <span class="phase-pill ${phaseCls}"><span class="dot"></span> ${phaseLabel}</span>
      ${hardExitText ? `<span class="spine-meta">${hardExitText}</span>` : ''}
      ${lockText ? `<span class="spine-sep">·</span><span class="spine-meta">${lockText}</span>` : ''}
      <span class="spine-meta" style="margin-left:auto">${ph.ist_now || ''} IST</span>
    </div>`;
  }

  function renderError(msg) {
    top.innerHTML = `<div class="spine-error">${msg}</div>`;
    bottom.innerHTML = `<div class="spine-bottom-row"><span class="spine-meta">${msg}</span></div>`;
  }

  // ─── 5. Fetch + refresh loop ───────────────────────────────────────────────
  async function load() {
    const key = localStorage.getItem(STORE_KEY);
    if (!key) {
      // Page itself will show its own gate; spine is silent in that state
      top.style.display = 'none';
      bottom.style.display = 'none';
      document.body.classList.remove('has-spine');
      return;
    }
    top.style.display = '';
    bottom.style.display = '';
    document.body.classList.add('has-spine');

    try {
      const res = await fetch(API_PATH + '&key=' + encodeURIComponent(key));
      if (res.status === 401) {
        // Pin invalid — pages already handle via their own gate
        renderError('auth required');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      renderTop(d);
      renderBottom(d);
    } catch (e) {
      // Soft fail — keep last-good render visible
      console.warn('[spine] refresh failed:', e.message);
    }
  }

  // Initial load + interval
  load();
  setInterval(load, REFRESH_MS);

  // Refresh when page becomes visible (e.g., user switches back to tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  // Expose for manual refresh
  window.__SPINE_REFRESH__ = load;
})();
