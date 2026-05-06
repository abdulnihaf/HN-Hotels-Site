// Wealth Engine — STOCK MODAL (Phase D of doc 19 §9)
//
// Per-stock deep-dive modal triggered by tap-any-symbol-anywhere via event
// delegation on [data-stock-symbol]. Replaces TradingView + Screener +
// Tijori + Trendlyne for any single stock, scoped strictly to data we
// have actually ingested.
//
// Self-mounting: include via <script src="/trading/_lib/stock-modal.js" defer>
// at end of <body>. Listens for clicks on any element with
// data-stock-symbol="SYMBOL" attribute, opens modal, fetches stock_detail.
//
// Per doc 18 §3: this file lives in trading/_lib/ (🟢 freely editable zone).
// Per doc 19 §6.3: design wireframe is the contract this file implements.

(function () {
  'use strict';

  if (!location.pathname.startsWith('/trading/')) return;
  if (window.__STOCK_MODAL_MOUNTED__) return;
  window.__STOCK_MODAL_MOUNTED__ = true;

  const STORE_KEY = 'wealth_dashboard_key';
  const cache = new Map();         // symbol -> {data, ts}
  const CACHE_TTL_MS = 60000;
  let currentSymbol = null;
  let currentNavList = [];          // for ←/→ navigation between symbols on the page

  // ─── 1. STYLES ────────────────────────────────────────────────────────────
  const css = `
    [data-stock-symbol] {
      cursor: pointer;
      -webkit-tap-highlight-color: rgba(124,92,255,0.18);
      transition: opacity 0.15s;
    }
    [data-stock-symbol]:hover { opacity: 0.85; }
    [data-stock-symbol]:active { opacity: 0.7; }

    #stock-modal {
      position: fixed; inset: 0; z-index: 9000;
      display: none; opacity: 0;
      transition: opacity 0.2s;
    }
    #stock-modal.open { display: flex; opacity: 1; }
    #stock-modal .overlay {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #stock-modal .panel {
      position: relative; margin-top: auto;
      width: 100%; max-height: 92vh;
      background: var(--bg, #0a0f1c);
      border-top: 1px solid var(--border, #2a3656);
      border-radius: 16px 16px 0 0;
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding-bottom: env(safe-area-inset-bottom, 12px);
      box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
      transform: translateY(20px);
      transition: transform 0.25s ease-out;
    }
    #stock-modal.open .panel { transform: translateY(0); }

    @media (min-width: 700px) {
      #stock-modal .panel {
        margin: auto 0 auto auto;
        max-height: 100vh; width: 580px;
        border-radius: 16px 0 0 16px;
        border-left: 1px solid var(--border, #2a3656);
        border-top: none;
        transform: translateX(20px);
      }
      #stock-modal.open .panel { transform: translateX(0); }
    }

    #stock-modal .modal-header {
      position: sticky; top: 0; z-index: 1;
      background: rgba(13, 20, 38, 0.96);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 12px 16px; border-bottom: 1px solid var(--border, #2a3656);
      display: flex; align-items: center; gap: 10px;
    }
    #stock-modal .header-symbol {
      font-size: 18px; font-weight: 700;
      color: var(--text, #e6ecff);
    }
    #stock-modal .header-ltp {
      font-size: 16px; font-weight: 600;
    }
    #stock-modal .header-pct { font-size: 12px; font-weight: 600; }
    #stock-modal .header-pct.up { color: var(--green, #2ecc71); }
    #stock-modal .header-pct.down { color: var(--red, #e74c3c); }
    #stock-modal .header-pct.flat { color: var(--muted, #8a96b8); }
    #stock-modal .modal-close {
      margin-left: auto;
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--panel-2, #1a2540); color: var(--text, #e6ecff);
      border: none; cursor: pointer; font-size: 18px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    #stock-modal .modal-close:hover { background: var(--border, #2a3656); }

    #stock-modal .modal-body { padding: 12px 16px; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; }
    #stock-modal .modal-loading,
    #stock-modal .modal-error { padding: 60px 0; text-align: center; color: var(--muted, #8a96b8); font-size: 13px; }
    #stock-modal .section { margin-bottom: 14px; }
    #stock-modal .section h3 { font-size: 11px; color: var(--muted, #8a96b8);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    #stock-modal .section h3 .meta { margin-left: auto; font-size: 9px; color: var(--muted, #8a96b8); text-transform: none; letter-spacing: 0; font-weight: 400; }

    #stock-modal .pos-overlay {
      padding: 10px 12px; background: rgba(124,92,255,0.08);
      border-left: 3px solid var(--accent, #7c5cff);
      border-radius: 6px; font-size: 11px; margin-bottom: 10px;
    }
    #stock-modal .pos-overlay strong { color: var(--accent, #7c5cff); }
    #stock-modal .pos-overlay.exited { border-left-color: var(--muted, #8a96b8); background: rgba(138,150,184,0.08); }
    #stock-modal .pos-overlay.exited strong { color: var(--muted, #8a96b8); }

    #stock-modal .chart-frame {
      background: var(--panel-2, #1a2540); border-radius: 8px;
      padding: 8px; margin-bottom: 10px;
    }
    #stock-modal .chart-frame svg { display: block; width: 100%; height: 140px; }

    #stock-modal .stat-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 8px;
      padding: 8px 10px; background: var(--panel-2, #1a2540); border-radius: 6px;
    }
    #stock-modal .stat-grid .cell { font-size: 10px; min-width: 0; }
    #stock-modal .stat-grid .lbl { color: var(--muted, #8a96b8); }
    #stock-modal .stat-grid .val { color: var(--text, #e6ecff); font-weight: 600; font-size: 11px; word-wrap: break-word; }
    #stock-modal .stat-grid .val.green { color: var(--green, #2ecc71); }
    #stock-modal .stat-grid .val.red { color: var(--red, #e74c3c); }

    #stock-modal .conv-bar {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      background: var(--panel-2, #1a2540); border-radius: 6px; margin-bottom: 8px;
    }
    #stock-modal .conv-bar .label { font-size: 10px; color: var(--muted, #8a96b8); flex-shrink: 0; }
    #stock-modal .conv-bar .track { flex: 1; height: 8px; background: var(--bg, #0a0f1c);
      border-radius: 4px; overflow: hidden; }
    #stock-modal .conv-bar .fill {
      height: 100%; background: linear-gradient(90deg, var(--accent, #7c5cff), var(--green, #2ecc71));
    }
    #stock-modal .conv-bar .val { font-size: 14px; font-weight: 700; color: var(--text, #e6ecff);
      font-variant-numeric: tabular-nums; }
    #stock-modal .conv-comp {
      display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; font-size: 10px;
      color: var(--muted, #8a96b8);
    }
    #stock-modal .conv-comp span { padding: 2px 6px; background: var(--panel-2, #1a2540);
      border-radius: 4px; }
    #stock-modal .conv-comp strong { color: var(--text, #e6ecff); }

    #stock-modal .news-row, #stock-modal .ann-row, #stock-modal .event-row {
      padding: 6px 0; border-bottom: 1px solid var(--border, #2a3656); font-size: 11px;
    }
    #stock-modal .news-row:last-child,
    #stock-modal .ann-row:last-child,
    #stock-modal .event-row:last-child { border-bottom: none; }
    #stock-modal .news-row .head, #stock-modal .ann-row .head, #stock-modal .event-row .head {
      display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px;
    }
    #stock-modal .news-row .ts, #stock-modal .ann-row .ts, #stock-modal .event-row .date {
      font-size: 9px; color: var(--muted, #8a96b8); flex-shrink: 0;
    }
    #stock-modal .sent-stripe {
      display: inline-block; width: 3px; height: 12px; border-radius: 2px; margin-right: 4px;
      vertical-align: middle;
    }
    #stock-modal .sent-stripe.pos { background: var(--green, #2ecc71); }
    #stock-modal .sent-stripe.neg { background: var(--red, #e74c3c); }
    #stock-modal .sent-stripe.neu { background: var(--muted, #8a96b8); }

    #stock-modal .options-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px;
      background: var(--panel-2, #1a2540); border-radius: 6px; font-size: 11px;
    }
    #stock-modal .options-grid .leg { padding: 6px 8px; background: var(--bg, #0a0f1c); border-radius: 4px; }
    #stock-modal .options-grid .leg.ce { border-left: 2px solid var(--green, #2ecc71); }
    #stock-modal .options-grid .leg.pe { border-left: 2px solid var(--red, #e74c3c); }
    #stock-modal .options-grid .leg .label { font-size: 9px; color: var(--muted, #8a96b8); }
    #stock-modal .options-grid .leg .premium { font-size: 14px; font-weight: 700; }
    #stock-modal .options-grid .leg .greeks { font-size: 9px; color: var(--muted, #8a96b8); margin-top: 2px; }

    #stock-modal .gap-list {
      padding: 10px 12px; background: rgba(245,176,65,0.04);
      border-left: 3px solid var(--yellow, #f5b041); border-radius: 6px;
      font-size: 10px; color: var(--muted, #8a96b8);
    }
    #stock-modal .gap-list strong { color: var(--yellow, #f5b041); display: block; margin-bottom: 4px; }
    #stock-modal .gap-list ul { list-style: none; padding: 0; margin: 0; }
    #stock-modal .gap-list li { padding: 2px 0; }

    #stock-modal .pool-pill {
      display: inline-flex; padding: 2px 7px; border-radius: 8px;
      font-size: 9px; font-weight: 700;
    }
    #stock-modal .pool-pill.in   { background: rgba(46,204,113,0.18); color: var(--green, #2ecc71); }
    #stock-modal .pool-pill.out  { background: rgba(138,150,184,0.18); color: var(--muted, #8a96b8); }
    #stock-modal .pool-pill.fo   { background: rgba(124,92,255,0.18); color: var(--accent, #7c5cff); }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'stock-modal-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ─── 2. Modal scaffold ─────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'stock-modal';
  modal.innerHTML = `
    <div class="overlay" id="modal-overlay"></div>
    <div class="panel">
      <div class="modal-header" id="modal-header">
        <span class="header-symbol">—</span>
        <button class="modal-close" id="modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body" id="modal-body">
        <div class="modal-loading">Loading…</div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // ─── 3. Helpers ────────────────────────────────────────────────────────────
  function fmtPrice(paise) {
    if (paise == null) return '—';
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtRupees(paise) {
    if (paise == null) return '—';
    const r = paise / 100;
    if (Math.abs(r) >= 10000000) return '₹' + (r / 10000000).toFixed(1) + 'cr';
    if (Math.abs(r) >= 100000) return '₹' + (r / 100000).toFixed(1) + 'L';
    if (Math.abs(r) >= 1000) return '₹' + (r / 1000).toFixed(1) + 'k';
    return '₹' + Math.round(r).toLocaleString('en-IN');
  }
  function fmtPct(v) { if (v == null) return '—'; return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }
  function fmtIstFromMs(ms) {
    if (!ms) return '—';
    const d = new Date(ms + 5.5 * 3600000);
    return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
  }
  function fmtRel(ms) {
    if (!ms) return '—';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function pctClass(v) {
    if (v == null || isNaN(v)) return 'flat';
    if (v > 0.05) return 'up'; if (v < -0.05) return 'down'; return 'flat';
  }

  // ─── 4. SVG chart with position overlays ───────────────────────────────────
  function renderChart(d) {
    const bars = d.bars || [];
    if (bars.length < 2) {
      return '<div style="font-size:10px;color:var(--muted);text-align:center;padding:50px 0">no intraday bars yet today</div>';
    }
    const p = d.position || {};
    const W = 540, H = 140;

    // Collect all reference values for viewBox
    const closes = bars.map(b => b.close_paise);
    const highs = bars.map(b => b.high_paise);
    const lows = bars.map(b => b.low_paise);
    const refs = [d.live?.ltp_paise, p.entry_paise, p.target_paise, p.stop_paise,
                  p.peak_price_paise, p.trailing_stop_paise, p.exit_paise].filter(v => v != null);
    const allVals = [...closes, ...highs, ...lows, ...refs];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = Math.max(1, maxV - minV);
    const pad = range * 0.05;
    const yMin = minV - pad;
    const yMax = maxV + pad;

    const xStep = (W - 8) / Math.max(1, bars.length - 1);
    const yScale = (v) => H - ((v - yMin) / (yMax - yMin)) * H;

    const points = bars.map((b, i) => `${4 + i * xStep},${yScale(b.close_paise).toFixed(1)}`).join(' ');

    const refLine = (val, color, dash, label) => {
      if (val == null) return '';
      const y = yScale(val);
      return `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.6"/>
              <text x="${W - 4}" y="${y - 2}" text-anchor="end" font-size="9" fill="${color}">${label}</text>`;
    };

    const lastX = 4 + (bars.length - 1) * xStep;
    const ltpY = d.live?.ltp_paise != null ? yScale(d.live.ltp_paise) : yScale(bars[bars.length - 1].close_paise);

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      ${refLine(p.target_paise, '#2ecc71', '4 2', 'TGT ' + fmtPrice(p.target_paise))}
      ${refLine(p.entry_paise, '#7c5cff', '0', 'ENTRY ' + fmtPrice(p.entry_paise))}
      ${refLine(p.exit_paise, '#f5b041', '0', 'EXIT ' + fmtPrice(p.exit_paise))}
      ${refLine(p.stop_paise, '#e74c3c', '4 2', 'STOP ' + fmtPrice(p.stop_paise))}
      ${refLine(p.trailing_stop_paise, '#f5b041', '2 2', 'trail ' + fmtPrice(p.trailing_stop_paise))}
      ${refLine(d.live?.prev_close_paise, '#8a96b8', '1 4', 'prev ' + fmtPrice(d.live?.prev_close_paise))}
      <polyline points="${points}" fill="none" stroke="#e6ecff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${p.peak_price_paise ? `<circle cx="${lastX}" cy="${yScale(p.peak_price_paise)}" r="3" fill="#2ecc71"/>` : ''}
      <circle cx="${lastX}" cy="${ltpY}" r="3.5" fill="#4fa3ff"/>
    </svg>`;
  }

  // ─── 5. Section renderers ─────────────────────────────────────────────────
  function renderHeader(d) {
    const live = d.live || {};
    const ltp = live.ltp_paise;
    const pct = live.pct_change_from_prev_close;
    const pctOpen = live.pct_change_from_open;
    return `
      <span class="header-symbol">${escapeHtml(d.symbol)}</span>
      <span class="header-ltp">${fmtPrice(ltp)}</span>
      <span class="header-pct ${pctClass(pct)}">${fmtPct(pct)} <span style="color: var(--muted); font-weight: 400">vs prev</span></span>
      ${d.is_in_pool ? '<span class="pool-pill in">IN POOL</span>' : '<span class="pool-pill out">not in pool</span>'}
      ${d.is_fo ? '<span class="pool-pill fo">F&amp;O</span>' : ''}
      <button class="modal-close" id="modal-close" aria-label="Close">×</button>
    `;
  }

  function renderPositionOverlay(d) {
    const p = d.position;
    if (!p) return '';
    if (p.state === 'ENTERED') {
      const pnl = (d.live?.ltp_paise && p.entry_paise) ? (d.live.ltp_paise - p.entry_paise) * p.qty : null;
      const pnlPct = (d.live?.ltp_paise && p.entry_paise)
        ? +(((d.live.ltp_paise - p.entry_paise) / p.entry_paise) * 100).toFixed(2) : null;
      return `<div class="pos-overlay">
        <strong>YOU HOLD ${p.qty} sh</strong> · entry ${fmtPrice(p.entry_paise)} · live P&amp;L ${pnl != null ? fmtRupees(pnl) : '—'} (${fmtPct(pnlPct)})
        ${p.target_locked ? ' · 🔒 TARGET LOCKED' : ''}
        ${p.opus_extension_active ? ' · OPUS EXTEND' : ''}
      </div>`;
    } else {
      const cls = (p.pnl_paise || 0) >= 0 ? 'green' : 'red';
      return `<div class="pos-overlay exited">
        <strong>EXITED TODAY</strong> · ${escapeHtml(p.exit_reason || '?')} @ ${fmtPrice(p.exit_paise)} · P&amp;L
        <span style="color: var(--${cls === 'green' ? 'green' : 'red'})">${fmtRupees(p.pnl_paise)}</span>
      </div>`;
    }
  }

  function renderEngineTakeSection(d) {
    const e = d.engine_take || {};
    if (!e.is_in_pool) {
      return `<div class="section">
        <h3>🤖 Our engine's take</h3>
        <div style="font-size:11px;color:var(--muted);padding:8px 0">
          Not in 73-stock intraday pool. ${e.composite_score ? `Swing-layer composite ${e.composite_score} · regime ${escapeHtml(e.composite_score_regime || '?')}` : 'No score available.'}
        </div>
      </div>`;
    }
    const s = e.suitability || {};
    const c = e.composite_conviction || {};
    const convPct = c.composite ? Math.round(c.composite * 100) : 0;
    const convLabel = convPct >= 70 ? 'HIGH' : convPct >= 50 ? 'MED' : 'LOW';

    return `<div class="section">
      <h3>🤖 Our engine's take
        <span class="meta">F1 v2 composite_conviction</span>
      </h3>
      ${c.composite != null ? `
        <div class="conv-bar">
          <span class="label">Conviction</span>
          <div class="track"><div class="fill" style="width: ${convPct}%"></div></div>
          <span class="val">${c.composite.toFixed(2)} <span style="font-size:10px;color:var(--muted)">${convLabel}</span></span>
        </div>
        <div class="conv-comp">
          <span>upside <strong>${c.upside}</strong></span>
          <span>×</span>
          <span>down_resist <strong>${c.downside_resistance}</strong></span>
          <span>×</span>
          <span>recent_regime <strong>${c.recent_regime}</strong></span>
        </div>
      ` : ''}
      <div class="stat-grid">
        <div class="cell"><div class="lbl">owner_score</div><div class="val">${s.owner_score?.toFixed(1) || '—'}</div></div>
        <div class="cell"><div class="lbl">intraday_score</div><div class="val">${s.intraday_score?.toFixed(1) || '—'}</div></div>
        <div class="cell"><div class="lbl">loss_resist</div><div class="val">${s.loss_resistance_score?.toFixed(1) || '—'}</div></div>
        <div class="cell"><div class="lbl">aoh_90d</div><div class="val">${s.avg_open_to_high_pct?.toFixed(2) || '—'}%</div></div>
        <div class="cell"><div class="lbl">hit_2pct</div><div class="val green">${s.hit_2pct_rate ? Math.round(s.hit_2pct_rate > 1 ? s.hit_2pct_rate : s.hit_2pct_rate * 100) + '%' : '—'}</div></div>
        <div class="cell"><div class="lbl">hit_3pct</div><div class="val">${s.hit_3pct_rate ? Math.round(s.hit_3pct_rate > 1 ? s.hit_3pct_rate : s.hit_3pct_rate * 100) + '%' : '—'}</div></div>
        <div class="cell"><div class="lbl">green_close</div><div class="val">${s.green_close_rate ? Math.round(s.green_close_rate > 1 ? s.green_close_rate : s.green_close_rate * 100) + '%' : '—'}</div></div>
        <div class="cell"><div class="lbl">hit_neg_2pct</div><div class="val red">${s.hit_neg_2pct_rate ? Math.round(s.hit_neg_2pct_rate > 1 ? s.hit_neg_2pct_rate : s.hit_neg_2pct_rate * 100) + '%' : '—'}</div></div>
      </div>
      ${s.avg_up_last_week_pct != null ? `
        <div style="font-size:10px;color:var(--muted);margin-top:6px">
          Recent regime (7d): aw ${s.avg_up_last_week_pct.toFixed(2)}%
          ${s.hit_2pct_last_week != null ? ` · h2 ${Math.round(s.hit_2pct_last_week)}%` : ''}
          ${s.green_close_last_week != null ? ` · gc ${Math.round(s.green_close_last_week)}%` : ''}
        </div>` : ''}
      ${e.cascade_active ? `
        <div style="margin-top:6px;padding:6px 10px;background:rgba(245,176,65,0.12);border-left:3px solid var(--yellow);border-radius:4px;font-size:10px">
          <strong style="color:var(--yellow)">CASCADE ACTIVE</strong> · ${escapeHtml(e.cascade_active.pattern_name)} · confidence ${e.cascade_active.confidence?.toFixed(2)}
        </div>` : ''}
    </div>`;
  }

  function renderMicroSection(d) {
    const m = d.micro || {};
    const live = d.live || {};
    return `<div class="section">
      <h3>📊 Market micro</h3>
      <div class="stat-grid">
        ${m.sector ? `<div class="cell"><div class="lbl">Sector</div><div class="val">${escapeHtml(m.sector)} ${m.sector_change_pct != null ? `<span class="${pctClass(m.sector_change_pct)}" style="font-size:9px">${fmtPct(m.sector_change_pct)}</span>` : ''}</div></div>` : ''}
        <div class="cell"><div class="lbl">Day open</div><div class="val">${fmtPrice(live.day_open_paise)}</div></div>
        <div class="cell"><div class="lbl">Day high</div><div class="val green">${fmtPrice(live.day_high_paise)}</div></div>
        <div class="cell"><div class="lbl">Day low</div><div class="val red">${fmtPrice(live.day_low_paise)}</div></div>
        <div class="cell"><div class="lbl">Prev close</div><div class="val">${fmtPrice(live.prev_close_paise)}</div></div>
        ${live.pct_change_from_open != null ? `<div class="cell"><div class="lbl">From open</div><div class="val ${live.pct_change_from_open > 0 ? 'green' : live.pct_change_from_open < 0 ? 'red' : ''}">${fmtPct(live.pct_change_from_open)}</div></div>` : ''}
        ${m.week_52_high_paise ? `<div class="cell"><div class="lbl">52W high</div><div class="val">${fmtPrice(m.week_52_high_paise)}${m.days_since_52w_high ? `<span style="color:var(--muted);font-size:9px"> · ${m.days_since_52w_high}d</span>` : ''}</div></div>` : ''}
        ${m.week_52_low_paise ? `<div class="cell"><div class="lbl">52W low</div><div class="val">${fmtPrice(m.week_52_low_paise)}${m.days_since_52w_low ? `<span style="color:var(--muted);font-size:9px"> · ${m.days_since_52w_low}d</span>` : ''}</div></div>` : ''}
      </div>
      ${m.circuit_hit_today ? `<div style="margin-top:6px;font-size:10px;color:var(--yellow)">⚡ Circuit hit today: ${escapeHtml(m.circuit_hit_today)}</div>` : ''}
    </div>`;
  }

  function renderFundamentalSection(d) {
    const f = d.fundamental || {};
    const cells = [];
    if (f.last_results) cells.push(`<div class="cell"><div class="lbl">Last results</div><div class="val">${escapeHtml(f.last_results.report_date || '?')} ${f.last_results.net_profit_yoy_pct != null ? `<span class="${f.last_results.net_profit_yoy_pct > 0 ? 'green' : 'red'}" style="font-size:9px">${fmtPct(f.last_results.net_profit_yoy_pct)} YoY</span>` : ''}</div></div>`);
    if (f.shareholding) {
      cells.push(`<div class="cell"><div class="lbl">Promoter</div><div class="val">${f.shareholding.promoter_pct?.toFixed(1)}%</div></div>`);
      cells.push(`<div class="cell"><div class="lbl">FII</div><div class="val">${f.shareholding.fii_pct?.toFixed(1)}%</div></div>`);
      cells.push(`<div class="cell"><div class="lbl">DII</div><div class="val">${f.shareholding.dii_pct?.toFixed(1)}%</div></div>`);
    }
    if (f.pledge) cells.push(`<div class="cell"><div class="lbl">Pledge</div><div class="val ${f.pledge.pct > 0 ? 'red' : 'green'}">${f.pledge.pct?.toFixed(1) || 0}%</div></div>`);
    if (f.insider_30d) cells.push(`<div class="cell"><div class="lbl">Insider 30d</div><div class="val">${f.insider_30d.buys || 0}b / ${f.insider_30d.sells || 0}s</div></div>`);
    if (f.bulk_block_7d != null) cells.push(`<div class="cell"><div class="lbl">Bulk/block 7d</div><div class="val">${f.bulk_block_7d}</div></div>`);

    const events = (f.upcoming_events || []).slice(0, 5);
    const eventList = events.map(e => `
      <div class="event-row">
        <div class="head">
          <span class="date">${escapeHtml(e.date || '?')}</span>
          <strong style="font-size:10px">${escapeHtml(e.kind.toUpperCase())}</strong>
        </div>
        <div style="font-size:11px;color:var(--text)">${escapeHtml(e.type || e.detail || '')}</div>
      </div>`).join('');

    return `<div class="section">
      <h3>📑 Fundamental context
        ${f.concall_sentiment ? `<span class="meta">concall sentiment: ${f.concall_sentiment.score >= 0.1 ? '🟢 positive' : f.concall_sentiment.score <= -0.1 ? '🔴 negative' : '⚪ neutral'}</span>` : ''}
      </h3>
      ${cells.length ? `<div class="stat-grid">${cells.join('')}</div>` : '<div style="font-size:11px;color:var(--muted)">No fundamental data ingested yet.</div>'}
      ${events.length ? `<div style="margin-top:8px">${eventList}</div>` : ''}
    </div>`;
  }

  function renderNewsSection(d) {
    const news = d.news_4h || [];
    if (!news.length) {
      return `<div class="section">
        <h3>📰 News (last 4h)</h3>
        <div style="font-size:11px;color:var(--muted);padding:6px 0">No news in last 4h.</div>
      </div>`;
    }
    const rows = news.map(n => {
      const sentClass = n.sentiment_score > 0.1 ? 'pos' : n.sentiment_score < -0.1 ? 'neg' : 'neu';
      return `<div class="news-row">
        <div class="head">
          <span class="ts">${fmtIstFromMs(n.published_at)}</span>
          <span class="sent-stripe ${sentClass}"></span>
          <strong style="font-size:11px">${escapeHtml(n.headline || '')}</strong>
        </div>
        <div style="font-size:9px;color:var(--muted)">${escapeHtml(n.source || '')}</div>
      </div>`;
    }).join('');
    return `<div class="section">
      <h3>📰 News
        <span class="meta">last 4h · ${news.length} items</span>
      </h3>
      ${rows}
    </div>`;
  }

  function renderAnnouncementsSection(d) {
    const ann = d.announcements_30d || [];
    if (!ann.length) {
      return `<div class="section">
        <h3>📢 Corp announcements (last 30d)</h3>
        <div style="font-size:11px;color:var(--muted);padding:6px 0">No announcements in last 30d.</div>
      </div>`;
    }
    const rows = ann.slice(0, 6).map(a => `
      <div class="ann-row">
        <div class="head">
          <span class="ts">${fmtIstFromMs(a.announced_at)}</span>
          <strong style="font-size:11px">${escapeHtml(a.subject || '')}</strong>
        </div>
        <div style="font-size:9px;color:var(--muted)">${escapeHtml(a.exchange || '')}</div>
      </div>`).join('');
    return `<div class="section">
      <h3>📢 Corp announcements
        <span class="meta">last 30d · ${ann.length} items · NSE+BSE</span>
      </h3>
      ${rows}
    </div>`;
  }

  function renderOptionsSection(d) {
    if (!d.is_fo) return '';
    if (!d.options) return `<div class="section">
      <h3>⚡ Options</h3>
      <div style="font-size:11px;color:var(--muted)">F&amp;O symbol but no recent option_chain_snapshot. wealth-options worker may be stale.</div>
    </div>`;
    const o = d.options;
    return `<div class="section">
      <h3>⚡ Options · ATM ${o.atm_strike}
        <span class="meta">${fmtIstFromMs(o.ts)} IST</span>
      </h3>
      <div class="options-grid">
        <div class="leg ce">
          <div class="label">${o.atm_strike} CE</div>
          <div class="premium">₹${o.ce.premium?.toFixed(2) || '—'}</div>
          <div class="greeks">IV ${o.ce.iv?.toFixed(1) || '—'}% · Δ ${o.ce.delta?.toFixed(2) || '—'}</div>
        </div>
        <div class="leg pe">
          <div class="label">${o.atm_strike} PE</div>
          <div class="premium">₹${o.pe.premium?.toFixed(2) || '—'}</div>
          <div class="greeks">IV ${o.pe.iv?.toFixed(1) || '—'}% · Δ ${o.pe.delta?.toFixed(2) || '—'}</div>
        </div>
      </div>
    </div>`;
  }

  function renderGapsSection(d) {
    const gaps = d.not_ingested || [];
    if (!gaps.length) return '';
    return `<div class="section">
      <div class="gap-list">
        <strong>⚠ N/A — we don't ingest these</strong>
        <ul>
          ${gaps.map(g => `<li>· ${escapeHtml(g.note)}</li>`).join('')}
        </ul>
      </div>
    </div>`;
  }

  // ─── 6. Render full modal ─────────────────────────────────────────────────
  function render(d) {
    document.getElementById('modal-header').innerHTML = renderHeader(d);
    document.getElementById('modal-close').addEventListener('click', close);
    document.getElementById('modal-body').innerHTML =
      renderPositionOverlay(d) +
      `<div class="chart-frame">${renderChart(d)}</div>` +
      renderEngineTakeSection(d) +
      renderMicroSection(d) +
      renderFundamentalSection(d) +
      renderNewsSection(d) +
      renderAnnouncementsSection(d) +
      renderOptionsSection(d) +
      renderGapsSection(d);
  }

  // ─── 7. Open / close / fetch ───────────────────────────────────────────────
  async function open(symbol) {
    if (!symbol) return;
    symbol = String(symbol).trim().toUpperCase();
    currentSymbol = symbol;

    document.getElementById('modal-header').innerHTML = `<span class="header-symbol">${escapeHtml(symbol)}</span><button class="modal-close" id="modal-close">×</button>`;
    document.getElementById('modal-close').addEventListener('click', close);
    document.getElementById('modal-body').innerHTML = '<div class="modal-loading">Loading…</div>';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Cache check
    const cached = cache.get(symbol);
    if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
      render(cached.data);
      return;
    }

    const key = localStorage.getItem(STORE_KEY) || '';
    if (!key) {
      document.getElementById('modal-body').innerHTML = '<div class="modal-error">Dashboard key not set — please unlock from any page first.</div>';
      return;
    }

    try {
      const res = await fetch('/api/trading?action=stock_detail&symbol=' + encodeURIComponent(symbol) + '&key=' + encodeURIComponent(key));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      cache.set(symbol, { data, ts: Date.now() });
      // Cap cache at 10 entries
      if (cache.size > 10) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      if (currentSymbol === symbol) render(data);
    } catch (e) {
      document.getElementById('modal-body').innerHTML = `<div class="modal-error">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function close() {
    modal.classList.remove('open');
    currentSymbol = null;
    document.body.style.overflow = '';
  }

  // ─── 8. Event delegation — listen for clicks anywhere ──────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-stock-symbol]');
    if (!el) return;
    e.preventDefault();
    const sym = el.getAttribute('data-stock-symbol');
    open(sym);
  });

  // Close on overlay tap or ESC
  document.getElementById('modal-overlay').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  // Expose for programmatic open
  window.StockModal = { open, close };
})();
