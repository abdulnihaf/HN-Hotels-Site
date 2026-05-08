// ═══════════════════════════════════════════════════════════════════════════
// Today's Watchlist — shared component
//
// Single source of truth for the rich pick-card rendering used on:
//   • /trading/today/   — primary observation view
//   • /trading/execute/ — power dashboard
//
// Both pages call window.WatchlistComponent.load(targetEl, dashboardKey, opts)
// and get the same cards, same data, same styling. Inject CSS once on first
// load. Auto-refreshes every 30s.
//
// Per-card data: full day OHLC + ₹10L hypothetical (peak/close/drawdown) +
// 90-day history + live LTP + ⭐ pick metadata + trader state.
//
// Owner asked May 5: unify /today and /execute "top picks" lists. This is
// the shared rendering both pages now share.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  if (window.WatchlistComponent) return;  // singleton

  // ── Inject CSS once ─────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.id = 'watchlist-component-styles';
  styleEl.textContent = `
    .watchlist-section {
      background: var(--panel, #121a2e); border: 1px solid var(--border, #2a3656);
      border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;
    }
    .watchlist-section h3 {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px;
      color: var(--muted, #8a96b8); margin-bottom: 4px; display: flex;
      justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
    }
    .watchlist-section .obs-summary { font-size: 12px; color: var(--text, #e6ecff); font-weight: 500; text-transform: none; letter-spacing: 0; }
    .watchlist-section .obs-tag { padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .watchlist-section .obs-tag.idle { background: rgba(138,150,184,0.18); color: var(--muted, #8a96b8); }
    .watchlist-section .obs-tag.err { background: rgba(231,76,60,0.18); color: var(--red, #e74c3c); }
    .watchlist-section .wl-meta {
      font-size: 11px; color: var(--muted, #8a96b8); margin-bottom: 10px; line-height: 1.5;
    }
    .watchlist-section .wl-actions {
      display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;
    }
    .watchlist-section .wl-btn {
      padding: 5px 10px; border-radius: 14px; font-size: 11px; font-weight: 500;
      background: var(--panel-2, #1a2540); color: var(--text, #e6ecff);
      border: 1px solid var(--border, #2a3656); cursor: pointer;
      text-decoration: none; display: inline-block;
    }
    .watchlist-section .wl-btn:hover { border-color: var(--accent, #7c5cff); color: var(--accent, #7c5cff); }
    .watchlist-section .wl-btn.copied {
      background: rgba(46,204,113,0.18); color: var(--green, #2ecc71);
      border-color: var(--green, #2ecc71);
    }
    .wl-list { display: flex; flex-direction: column; gap: 8px; }
    .wl-card {
      background: var(--panel-2, #1a2540); border-radius: 10px;
      border-left: 3px solid transparent; padding: 12px 14px;
      font-size: 12px;
    }
    .wl-card.final { border-left-color: var(--accent, #7c5cff); background: linear-gradient(90deg, rgba(124,92,255,0.10), var(--panel-2, #1a2540)); }
    .wl-card-head {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 8px; margin-bottom: 8px;
    }
    .wl-card-head .wl-rank { font-size: 10px; color: var(--muted, #8a96b8); font-variant-numeric: tabular-nums; }
    .wl-card-head .wl-sym { font-size: 16px; font-weight: 700; margin-left: 6px; }
    .wl-card-head .wl-pick-tag { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; background: var(--accent, #7c5cff); color: white; margin-left: 6px; vertical-align: middle; }
    .wl-card-head .wl-state-tag { display: inline-block; padding: 2px 7px; border-radius: 8px; font-size: 9px; font-weight: 700; margin-left: 6px; vertical-align: middle; }
    .wl-card-head .wl-state-tag.WATCHING { background: rgba(138,150,184,0.20); color: var(--muted, #8a96b8); }
    .wl-card-head .wl-state-tag.ENTERED { background: rgba(79,163,255,0.20); color: var(--blue, #4fa3ff); }
    .wl-card-head .wl-state-tag.EXITED { background: rgba(46,204,113,0.20); color: var(--green, #2ecc71); }
    .wl-card-head .wl-state-tag.SKIPPED, .wl-card-head .wl-state-tag.ABANDONED { background: rgba(231,76,60,0.20); color: var(--red, #e74c3c); }
    .wl-card-head .wl-ltp { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .wl-card-head .wl-chg { font-variant-numeric: tabular-nums; font-size: 12px; font-weight: 700; }
    .wl-card-head .wl-chg.pos { color: var(--green, #2ecc71); }
    .wl-card-head .wl-chg.neg { color: var(--red, #e74c3c); }
    .wl-ohlc-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
      background: rgba(0,0,0,0.2); border-radius: 6px; padding: 8px 10px;
      margin-bottom: 8px;
    }
    .wl-ohlc-cell { display: flex; flex-direction: column; }
    .wl-ohlc-cell .lbl { font-size: 9px; color: var(--muted, #8a96b8); text-transform: uppercase; letter-spacing: 0.4px; }
    .wl-ohlc-cell .val { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .wl-ohlc-cell .val.peak { color: var(--green, #2ecc71); }
    .wl-ohlc-cell .val.low { color: var(--red, #e74c3c); }
    .wl-10L {
      background: rgba(124,92,255,0.08); border: 1px solid rgba(124,92,255,0.30);
      border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;
    }
    .wl-10L .lbl-row { font-size: 10px; color: var(--accent, #7c5cff); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; font-weight: 600; }
    .wl-10L-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .wl-10L-cell { display: flex; flex-direction: column; }
    .wl-10L-cell .lbl { font-size: 9px; color: var(--muted, #8a96b8); }
    .wl-10L-cell .val { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .wl-10L-cell .val.pos { color: var(--green, #2ecc71); }
    .wl-10L-cell .val.neg { color: var(--red, #e74c3c); }
    .wl-10L-cell .sub { font-size: 10px; color: var(--muted, #8a96b8); }
    .wl-meta-row { font-size: 10px; color: var(--muted, #8a96b8); display: flex; flex-wrap: wrap; gap: 8px; }
    .wl-meta-row .meta-item strong { color: var(--text, #e6ecff); }
    @media (max-width: 600px) {
      .wl-ohlc-row { grid-template-columns: repeat(2, 1fr); }
      .wl-10L-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  if (!document.getElementById('watchlist-component-styles')) {
    document.head.appendChild(styleEl);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const fmtP = (paise) => paise == null ? '—' : '₹' + (paise / 100).toFixed(2);
  const fmtPct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtRupees = (paise) => paise == null
    ? '—'
    : (paise >= 0 ? '+' : '−') + '₹' + Math.abs(Math.round(paise / 100)).toLocaleString('en-IN');
  const sgn = (paise) => paise == null ? '' : (paise >= 0 ? 'pos' : 'neg');

  // ── Render a single card from a watchlist entry ────────────────────────
  function renderCard(w, i) {
    const chgClass = w.day_change_pct == null ? '' : (w.day_change_pct >= 0 ? 'pos' : 'neg');
    const stateTag = w.trader_state ? `<span class="wl-state-tag ${esc(w.trader_state)}">${esc(w.trader_state)}</span>` : '';
    const pickTag = w.is_final_pick ? `<span class="wl-pick-tag">⭐ PICK</span>` : '';
    const hist = w.intraday_history;
    const histStr = hist
      ? `2%-day rate ${hist.hit_2pct_pct_of_days?.toFixed(0)}% · 3%-day ${hist.hit_3pct_pct_of_days?.toFixed(0)}% · 5%-day ${hist.hit_5pct_pct_of_days?.toFixed(0)}% · green-close ${hist.green_close_rate?.toFixed(0)}%`
      : '';
    const tenL = w.if_10L_invested;
    const tenLBlock = tenL ? `
      <div class="wl-10L">
        <div class="lbl-row">💰 If ₹10,00,000 invested in ${esc(w.symbol)} alone (qty ${tenL.qty.toLocaleString('en-IN')} @ ₹${(tenL.deployed_paise/100).toLocaleString('en-IN', {maximumFractionDigits:0})} deployed)</div>
        <div class="wl-10L-grid">
          <div class="wl-10L-cell">
            <span class="lbl">If exited at PEAK</span>
            <span class="val ${sgn(tenL.if_exited_at_peak_paise)}">${fmtRupees(tenL.if_exited_at_peak_paise)}</span>
            <span class="sub">${fmtPct(tenL.if_exited_at_peak_pct)}</span>
          </div>
          <div class="wl-10L-cell">
            <span class="lbl">If held to CLOSE</span>
            <span class="val ${sgn(tenL.if_held_to_close_paise)}">${fmtRupees(tenL.if_held_to_close_paise)}</span>
            <span class="sub">${fmtPct(tenL.if_held_to_close_pct)}</span>
          </div>
          <div class="wl-10L-cell">
            <span class="lbl">Max drawdown intraday</span>
            <span class="val neg">${fmtRupees(tenL.max_intraday_drawdown_paise)}</span>
            <span class="sub">at day low</span>
          </div>
        </div>
      </div>` : '';

    const pickMeta = w.is_final_pick ? `
      <div class="wl-meta-row" style="margin-bottom:6px">
        <span class="meta-item">⭐ allocation <strong>${w.pick_weight_pct}%</strong></span>
        <span class="meta-item">target <strong>+${w.pick_target_pct?.toFixed(2)}%</strong></span>
        <span class="meta-item">stop <strong>−${w.pick_stop_pct?.toFixed(2)}%</strong></span>
        ${w.trader_state ? `<span class="meta-item">trader → <strong>${esc(w.trader_state)}</strong></span>` : ''}
        ${w.trader_pnl_net_paise != null ? `<span class="meta-item">P&L <strong style="color:${w.trader_pnl_net_paise>=0?'var(--green,#2ecc71)':'var(--red,#e74c3c)'}">${fmtRupees(w.trader_pnl_net_paise)}</strong></span>` : ''}
      </div>` : '';

    return `
      <div class="wl-card ${w.is_final_pick ? 'final' : ''}">
        <div class="wl-card-head">
          <div>
            <span class="wl-rank">#${i + 1}</span>
            <span class="wl-sym">${esc(w.symbol)}</span>${pickTag}${stateTag}
          </div>
          <div style="text-align:right">
            <span class="wl-ltp">${fmtP(w.live_ltp_paise || w.day_close_paise)}</span>
            <span class="wl-chg ${chgClass}" style="margin-left:8px">${fmtPct(w.day_change_pct)}</span>
          </div>
        </div>
        ${pickMeta}
        <div class="wl-ohlc-row">
          <div class="wl-ohlc-cell"><span class="lbl">Open</span><span class="val">${fmtP(w.day_open_paise)}</span></div>
          <div class="wl-ohlc-cell"><span class="lbl">Peak (high)</span><span class="val peak">${fmtP(w.day_high_paise)}</span></div>
          <div class="wl-ohlc-cell"><span class="lbl">Low</span><span class="val low">${fmtP(w.day_low_paise)}</span></div>
          <div class="wl-ohlc-cell"><span class="lbl">Close</span><span class="val">${fmtP(w.day_close_paise)}</span></div>
        </div>
        ${tenLBlock}
        <div class="wl-meta-row">
          ${histStr ? `<span class="meta-item">${histStr}</span>` : ''}
          ${w.gap_from_prev_close_pct != null ? `<span class="meta-item">gap from prev close <strong>${fmtPct(w.gap_from_prev_close_pct)}</strong></span>` : ''}
          <span class="meta-item">hybrid score <strong>${w.hybrid_score?.toFixed(1) || '—'}</strong></span>
          <span class="meta-item">regime <strong>${esc(w.regime || '—')}</strong></span>
          ${w.day_volume ? `<span class="meta-item">vol <strong>${(w.day_volume/100000).toFixed(1)}L</strong></span>` : ''}
        </div>
      </div>`;
  }

  // ── Render full section (header + actions + cards) ────────────────────
  function renderSection(j) {
    const dateShort = new Date(j.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
    const cards = j.watchlist.map((w, i) => renderCard(w, i)).join('');
    return `
      <div class="watchlist-section">
        <h3>
          📋 ${esc(dateShort)} Watchlist
          <span class="obs-summary">${j.summary.candidate_count} candidates · ${j.summary.final_pick_count} ⭐ picks</span>
        </h3>
        <div class="wl-meta">
          Frozen at <strong>${esc((j.composed_at_ist || '—').slice(11, 16))} IST</strong> when Opus composed the morning verdict ·
          ⭐ = the 3 stocks the auto-trader is actively managing ·
          Live LTP refreshes every 30s
        </div>
        <div class="wl-actions">
          <button class="wl-btn" data-copy="${esc(j.kite_format || '')}" data-copy-label="all ${j.watchlist.length}">📋 Copy ALL ${j.watchlist.length} to Kite format</button>
          <button class="wl-btn" data-copy="${esc(j.final_picks_kite_format || '')}" data-copy-label="⭐ 3 picks">⭐ Copy 3 picks only</button>
          <a class="wl-btn" href="https://kite.zerodha.com/" target="_blank" rel="noopener">🚀 Open Kite Web</a>
        </div>
        <div class="wl-list">${cards}</div>
      </div>`;
  }

  // ── Wire copy-to-Kite buttons (event delegation, single listener) ─────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.wl-btn[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    const label = btn.getAttribute('data-copy-label') || 'symbols';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `✓ ${label} copied — paste into Kite watchlist`;
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 3500);
    }).catch(() => {
      alert('Could not copy. Manual list:\n\n' + text);
    });
  });

  // ── Public load API — call from any page ──────────────────────────────
  // load(targetEl, dashboardKey, opts):
  //   - targetEl: DOM element OR id string
  //   - dashboardKey: PIN
  //   - opts: { date?: 'YYYY-MM-DD', refreshMs?: 30000 }
  // Returns: { stop() } so caller can cancel auto-refresh
  function load(targetEl, dashboardKey, opts = {}) {
    const el = typeof targetEl === 'string' ? document.getElementById(targetEl) : targetEl;
    if (!el) { console.warn('[watchlist] target not found'); return { stop() {} }; }
    let timer = null;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      try {
        const url = '/api/trading?action=todays_watchlist'
          + (opts.date ? `&date=${encodeURIComponent(opts.date)}` : '')
          + '&key=' + encodeURIComponent(dashboardKey);
        const r = await fetch(url);
        const j = await r.json();
        if (!j.ok) {
          el.innerHTML = `<div class="watchlist-section">
            <h3>📋 Today's Watchlist <span class="obs-tag idle">${esc(j.reason || 'no data')}</span></h3>
            <div class="wl-meta">No verdict found yet — composeVerdict fires at 08:30 IST.</div>
          </div>`;
        } else {
          el.innerHTML = renderSection(j);
        }
      } catch (e) {
        el.innerHTML = `<div class="watchlist-section">
          <h3>📋 Today's Watchlist <span class="obs-tag err">error</span></h3>
          <div class="wl-meta" style="color:var(--red,#e74c3c)">${esc(e.message)}</div>
        </div>`;
      }
      if (!stopped) timer = setTimeout(tick, opts.refreshMs || 30000);
    }

    tick();
    return {
      stop() { stopped = true; if (timer) clearTimeout(timer); }
    };
  }

  window.WatchlistComponent = { load, renderCard, renderSection };
})();
