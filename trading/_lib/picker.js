// ═══════════════════════════════════════════════════════════════════════════
// Stock Picker — shared modal component
//
// Usage from any trading page:
//   1. Include: <script src="/trading/_lib/picker.js"></script>
//   2. Open: openStockPicker({ onPick: (stock) => { ... }, dashboardKey: KEY })
//
// stock object passed to onPick:
//   { symbol, name, last_close_rupees, prev_close_rupees, change_pct,
//     volume, daily_value_cr, live_ltp_rupees? }
//
// Caches the API response for 60s (across modal open/close) for snappiness.
// Live LTP refreshes every time the modal opens.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  let _cache = null;
  let _cacheAt = 0;
  let _activeTab = 'watchlist';
  let _onPickCallback = null;

  // Inject CSS once
  function injectStyles() {
    if (document.getElementById('sp-styles')) return;
    const style = document.createElement('style');
    style.id = 'sp-styles';
    style.textContent = `
      #spOverlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999;
        display:flex; align-items:center; justify-content:center; padding:20px; }
      #spModal { background:#121a2e; border:2px solid #4fa3ff; border-radius:14px;
        width:100%; max-width:680px; max-height:88vh; display:flex; flex-direction:column;
        box-shadow:0 8px 32px rgba(0,0,0,0.5); overflow:hidden; }
      #spHeader { padding:14px 18px; border-bottom:1px solid #2a3656; display:flex;
        justify-content:space-between; align-items:center; gap:10px; }
      #spHeader h2 { font-size:16px; font-weight:700; color:#e6ecff; }
      #spClose { background:transparent; border:none; color:#8a96b8; cursor:pointer;
        font-size:22px; padding:4px 10px; line-height:1; }
      #spClose:hover { color:#e6ecff; }
      #spSearch { padding:10px 18px; border-bottom:1px solid #2a3656; }
      #spSearch input { width:100%; padding:9px 12px; background:#1a2540; border:1px solid #2a3656;
        border-radius:8px; color:#e6ecff; font-size:14px; }
      #spSearch input:focus { outline:none; border-color:#4fa3ff; }
      #spTabs { display:flex; gap:4px; padding:0 18px; border-bottom:1px solid #2a3656; }
      #spTabs button { background:transparent; border:none; padding:10px 12px; color:#8a96b8;
        font-size:13px; cursor:pointer; border-bottom:2px solid transparent; font-weight:500; }
      #spTabs button.active { color:#4fa3ff; border-bottom-color:#4fa3ff; font-weight:600; }
      #spTabs button:hover { color:#e6ecff; }
      #spList { flex:1; overflow-y:auto; padding:6px; }
      .sp-row { display:grid; grid-template-columns:1fr auto auto; gap:10px;
        padding:10px 12px; border-radius:8px; cursor:pointer; align-items:center;
        border-bottom:1px solid rgba(42,54,86,0.4); }
      .sp-row:hover { background:rgba(79,163,255,0.08); }
      .sp-row .left { min-width:0; }
      .sp-row .sym { font-size:14px; font-weight:700; color:#e6ecff; }
      .sp-row .name { font-size:11px; color:#8a96b8; margin-top:2px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }
      .sp-row .px { text-align:right; font-variant-numeric:tabular-nums; }
      .sp-row .px .last { font-weight:600; font-size:13px; }
      .sp-row .px .chg { font-size:11px; margin-top:2px; }
      .sp-row .vol { color:#8a96b8; font-size:11px; text-align:right;
        font-variant-numeric:tabular-nums; }
      .sp-row .pos { color:#2ecc71; }
      .sp-row .neg { color:#e74c3c; }
      .sp-row .thesis { font-size:11px; color:#7c5cff; margin-top:3px; font-style:italic;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:380px; }
      .sp-empty { padding:30px; text-align:center; color:#8a96b8; font-size:13px; }
      .sp-loading { padding:30px; text-align:center; color:#8a96b8; font-size:13px; }
      #spFooter { padding:8px 18px; border-top:1px solid #2a3656; font-size:10px;
        color:#8a96b8; text-align:center; }
      @media (max-width: 480px) {
        #spOverlay { padding: 0; }
        #spModal { max-width: 100%; max-height: 100vh; max-height: 100dvh;
          border-radius:0; border-left:none; border-right:none; }
        .sp-row { grid-template-columns: 1fr auto; }
        .sp-row .vol { display:none; }
        .sp-row .name { max-width:200px; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if (document.getElementById('spOverlay')) return;
    injectStyles();
    const html = `
      <div id="spOverlay">
        <div id="spModal">
          <div id="spHeader">
            <h2>🔍 Pick a stock</h2>
            <button id="spClose" aria-label="Close">×</button>
          </div>
          <div id="spSearch">
            <input id="spSearchInput" type="text" placeholder="Search by symbol or name (e.g. RELI, HDFC, MARUTI)..." autocomplete="off"/>
          </div>
          <div id="spTabs">
            <button data-tab="watchlist">📌 Watchlist</button>
            <button data-tab="movers">🔥 Movers</button>
            <button data-tab="all">🔍 All Liquid</button>
          </div>
          <div id="spList"><div class="sp-loading">Loading…</div></div>
          <div id="spFooter">Live LTP from Kite Connect · click row to pick</div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    // Wire
    document.getElementById('spClose').addEventListener('click', closeStockPicker);
    document.getElementById('spOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'spOverlay') closeStockPicker();
    });
    document.querySelectorAll('#spTabs button').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
    let searchTimer;
    document.getElementById('spSearchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => filterRows(e.target.value), 200);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('spOverlay').style.display !== 'none') {
        closeStockPicker();
      }
    });
  }

  async function loadData(dashboardKey) {
    const fresh = (Date.now() - _cacheAt) < 60000;
    if (_cache && fresh) return _cache;
    const r = await fetch('/api/trading?action=stock_picker&ltp=1&key=' + encodeURIComponent(dashboardKey));
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    _cache = j;
    _cacheAt = Date.now();
    return j;
  }

  function fmtPrice(rupees) {
    if (rupees == null || rupees === undefined) return '—';
    return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(pct) {
    if (pct == null) return '—';
    return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  }
  function fmtCr(cr) {
    if (cr == null || cr === 0) return '—';
    return '₹' + cr.toFixed(0) + 'Cr';
  }

  function renderRow(stock) {
    const ltp = stock.live_ltp_rupees ?? stock.last_close_rupees;
    const chg = stock.live_change_pct ?? stock.change_pct;
    const cls = chg >= 0 ? 'pos' : 'neg';
    return `
      <div class="sp-row" data-symbol="${stock.symbol}" data-ltp="${ltp || ''}">
        <div class="left">
          <div class="sym">${stock.symbol}${stock.live_ltp_rupees ? ' <span style="color:#2ecc71;font-size:9px;font-weight:400">●LIVE</span>' : ''}</div>
          <div class="name">${stock.name || stock.symbol}</div>
          ${stock.thesis ? `<div class="thesis">${stock.thesis}</div>` : ''}
        </div>
        <div class="px">
          <div class="last">${fmtPrice(ltp)}</div>
          <div class="chg ${cls}">${fmtPct(chg)}</div>
        </div>
        <div class="vol">${fmtCr(stock.daily_value_cr)}</div>
      </div>
    `;
  }

  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('#spTabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderList();
  }

  function getStocksForTab() {
    if (!_cache) return [];
    if (_activeTab === 'watchlist') return _cache.watchlist || [];
    if (_activeTab === 'movers') return _cache.top_movers || [];
    return _cache.all_liquid || [];
  }

  function filterRows(query) {
    const q = (query || '').toUpperCase().trim();
    const all = getStocksForTab();
    let filtered = all;
    if (q) {
      filtered = all.filter(s =>
        s.symbol.toUpperCase().includes(q) ||
        (s.name || '').toUpperCase().includes(q)
      );
    }
    const list = document.getElementById('spList');
    if (filtered.length === 0) {
      list.innerHTML = `<div class="sp-empty">${q ? `No stocks matching "${query}"` : (
        _activeTab === 'watchlist' ? 'Your watchlist is empty. Add some on the Execute page.' :
        'No data yet — try refreshing or check back during market hours.'
      )}</div>`;
      return;
    }
    list.innerHTML = filtered.map(renderRow).join('');
    list.querySelectorAll('.sp-row').forEach(row => {
      row.addEventListener('click', () => {
        const sym = row.dataset.symbol;
        const ltp = parseFloat(row.dataset.ltp) || null;
        const stock = filtered.find(s => s.symbol === sym);
        if (_onPickCallback) _onPickCallback(stock);
        closeStockPicker();
      });
    });
  }

  function renderList() {
    filterRows(document.getElementById('spSearchInput').value);
  }

  // PUBLIC API
  window.openStockPicker = async function ({ onPick, dashboardKey, defaultTab }) {
    if (!dashboardKey) { console.error('openStockPicker requires dashboardKey'); return; }
    _onPickCallback = onPick || null;
    buildModal();
    document.getElementById('spOverlay').style.display = 'flex';
    if (defaultTab) _activeTab = defaultTab;
    document.querySelectorAll('#spTabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === _activeTab);
    });
    document.getElementById('spList').innerHTML = '<div class="sp-loading">Loading stocks…</div>';
    document.getElementById('spSearchInput').value = '';
    document.getElementById('spSearchInput').focus();
    try {
      await loadData(dashboardKey);
      // Update header with counts
      const wl = (_cache.watchlist || []).length;
      const mv = (_cache.top_movers || []).length;
      const al = (_cache.all_liquid || []).length;
      document.querySelectorAll('#spTabs button').forEach(b => {
        const t = b.dataset.tab;
        const c = t === 'watchlist' ? wl : t === 'movers' ? mv : al;
        const label = t === 'watchlist' ? '📌 Watchlist' : t === 'movers' ? '🔥 Movers' : '🔍 All';
        b.textContent = `${label} (${c})`;
      });
      // Default tab selection — if watchlist empty, jump to movers
      if (_activeTab === 'watchlist' && wl === 0) {
        switchTab('movers');
      } else {
        renderList();
      }
    } catch (e) {
      document.getElementById('spList').innerHTML = `<div class="sp-empty">Error: ${e.message}</div>`;
    }
  };

  window.closeStockPicker = function () {
    const o = document.getElementById('spOverlay');
    if (o) o.style.display = 'none';
    _onPickCallback = null;
  };
})();
