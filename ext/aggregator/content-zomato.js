// content-zomato.js v5.0.3
// v5.0: Rebuilt from verified live portal extraction (Apr 2026).
// Pages cycled: Order History → Live Tracking → Business Reports
//
// Verified page structures:
// - Order History: DOM traversal per order block (innerText misses scroll-virtualized rows)
//   Format: "DELIVERED\n2:01 PM | 14 April\nID: 7992921837\nBy partipan k\n1 x item\n₹230.00"
// - Live Tracking: 5 sections — Sales overview, Customer Experience, Customer funnel, Ads & Offers, Dish trends
// - Business Reports: table with Weekly/Monthly/Daily; column = time period, rows = metrics

(function () {
  'use strict';

  // ─── LOGIN DETECTION — check URL immediately on load ─────────────────────────
  const _initUrl = location.href;
  if (_initUrl.includes('zomato.com') && !_initUrl.includes('/partners/')) {
    console.log('[HN] Zomato: login page detected (URL check)');
    chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'zomato' }).catch(() => {});
    return;
  }

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'zomato' }).catch(() => {});

  const CONFIG = {
    endpoint: 'https://hnhotels.in/api/aggregator-pulse',
    apiKey: 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA',
    readInterval: 45_000,
    pageCycleInterval: 180_000,  // 3 min per page
    initialDelay: 20_000,        // Zomato SPA needs longer to hydrate
  };

  // v6.0: Expanded page cycle — visiting each page triggers inject.js capture of
  // the corresponding merchant-api/{finance|ads|nps} XHR which is stored as a
  // snapshot (metric_type = api_finance / api_ads / api_ratings etc).
  const PAGES = [
    'https://www.zomato.com/partners/onlineordering/orderHistory/',
    'https://www.zomato.com/partners/onlineordering/reporting?selected_view=view_live_tracking',
    'https://www.zomato.com/partners/onlineordering/reporting?selected_view=view_business_reports&business_reports_type=table',
    'https://www.zomato.com/partners/onlineordering/finance/',
    'https://www.zomato.com/partners/onlineordering/ads/',
    'https://www.zomato.com/partners/onlineordering/reviews/',
  ];

  let lastPushTime = {};

  // ─── API INTERCEPT BRIDGE ─────────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.data?.platform !== 'zomato') return;
    if (e.data.type === '__hn_api_capture') {
      pushMetrics({ source: 'api_intercept', platform: 'zomato', brand: 'all', outlet_id: 'all',
        url: e.data.url, data: e.data.data, captured_at: e.data.ts });
      if (e.data.authHeaders && Object.keys(e.data.authHeaders).length > 0) {
        chrome.runtime.sendMessage({ type: 'SESSION_DATA', platform: 'zomato',
          data: { headers: e.data.authHeaders, url: e.data.url } }).catch(() => {});
      }
    }
    if (e.data.type === '__hn_api_discovery') {
      chrome.storage.local.get(['zomato_api_urls'], (d) => {
        const urls = new Set(d.zomato_api_urls || []);
        urls.add(e.data.url);
        chrome.storage.local.set({ zomato_api_urls: [...urls].slice(-100) });
      });
    }
  });

  // ─── LOGIN DETECTION ──────────────────────────────────────────────────────────
  // v5.0: Business Reports skeleton HTML is short but NOT a login page — never flag
  // reporting or live_tracking pages as login unless explicit OTP/phone patterns present.
  function isLoginContent(text) {
    const url = location.href;
    if (url.includes('view_business_reports') || url.includes('view_live_tracking') || url.includes('/reporting')) {
      const sample = text.slice(0, 800).toLowerCase();
      return /enter (your )?(phone|mobile|otp|password)/.test(sample) || /get otp/.test(sample);
    }
    const sample = text.slice(0, 800).toLowerCase();
    return (
      /enter (your )?(phone|mobile|otp|password)/.test(sample) ||
      /log(in| in) to zomato/.test(sample) ||
      /sign (in|up)/.test(sample) ||
      /get otp/.test(sample) ||
      /verify (your )?(number|mobile)/.test(sample) ||
      (text.length < 300 && !/order|sales|tracking|report/i.test(text))
    );
  }

  // ─── PAGE DETECTION ───────────────────────────────────────────────────────────
  function detectView() {
    const url = location.href;
    if (url.includes('orderHistory')) return 'order-history';
    if (url.includes('view_business_reports')) return 'business-reports';
    if (url.includes('view_live_tracking') || url.includes('/reporting')) return 'live-tracking';
    return 'unknown';
  }

  function getCurrentPageIdx() {
    const url = location.href;
    if (url.includes('orderHistory')) return 0;
    if (url.includes('view_live_tracking')) return 1;
    if (url.includes('view_business_reports')) return 2;
    if (url.includes('/reporting')) return 1;
    return 0;
  }

  function cyclePage() {
    const currentIdx = getCurrentPageIdx();
    const nextIdx = (currentIdx + 1) % PAGES.length;
    console.log(`[HN] Zomato: cycle ${currentIdx} → ${nextIdx}`);
    window.location.href = PAGES[nextIdx];
  }

  // ─── MAIN READ + PUSH ─────────────────────────────────────────────────────────
  function readAndPush() {
    drainBackgroundQueue().catch(() => {});   // drain background.js queue first
    const text = document.body?.innerText || '';

    if (text.length < 200 || isLoginContent(text)) {
      if (isLoginContent(text)) {
        console.log('[HN] Zomato: login form detected');
        chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'zomato' }).catch(() => {});
      }
      pushHeartbeat('login_or_loading');
      return;
    }

    const view = detectView();
    console.log(`[HN] Zomato v5.0: reading view="${view}"`);

    if (view === 'order-history')    extractAndPushOrders();
    else if (view === 'live-tracking') {
      const expanded = expandOutletBreakdowns();
      if (expanded > 0) {
        // Wait 2s for DOM to re-render after clicking, then re-read
        setTimeout(() => {
          const freshText = document.body?.innerText || '';
          extractLiveTracking(freshText);
          // Dump DOM context AFTER click + re-render so we see expanded state
          setTimeout(() => dumpDomContext('live_tracking'), 1500);
        }, 2000);
      } else {
        extractLiveTracking(text);
        setTimeout(() => dumpDomContext('live_tracking'), 1500);
      }
    }
    else if (view === 'business-reports') {
      extractBusinessReports(text);
      setTimeout(() => dumpDomContext('business_reports'), 1500);
    }
    else pushHeartbeat('unknown_view');
  }

  // ─── ORDER HISTORY — DOM traversal ───────────────────────────────────────────
  // Verified format (live portal, Apr 2026):
  // DELIVERED
  // 2:01 PM | 14 April          ← \u00a0 non-breaking space between time parts
  // ID: 7992921837
  // By partipan k
  // 1 x Tandoori Chicken
  // ₹230.00
  // [optional] Delay in food handover
  // [optional] Food preparation delayed by N min
  //
  // Order blocks are identified by leaf-level status text nodes (DELIVERED/PREPARING etc.)
  // Walk up 5 parent levels to get the full order block container.
  function extractAndPushOrders() {
    const orders = [];
    const seen = new Set();
    const year = new Date().getFullYear();
    const months = {
      January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
      July:'07', August:'08', September:'09', October:'10', November:'11', December:'12',
    };

    for (const el of document.querySelectorAll('*')) {
      const t = el.textContent?.trim();
      if (!t || !/^(DELIVERED|PREPARING|READY|CANCELLED|REJECTED)$/.test(t) || el.children.length > 0) continue;

      // Walk up to order block container
      let parent = el.parentElement;
      for (let i = 0; i < 5; i++) { if (parent?.parentElement) parent = parent.parentElement; }
      const blockText = parent?.innerText || '';
      if (!blockText.includes('ID:')) continue;

      // Normalize non-breaking spaces to regular spaces
      const lines = blockText.replace(/\u00a0/g, ' ').split('\n').map(l => l.trim()).filter(l => l);
      const order = { platform: 'zomato', brand: 'unknown', captured_at: new Date().toISOString() };

      // Brand from ancestor outlet header text
      const ancestor = parent?.closest?.('[class]')?.innerText || '';
      if (/hamza express/i.test(ancestor)) order.brand = 'he';
      else if (/nawabi chai/i.test(ancestor)) order.brand = 'nch';

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];

        if (/^(DELIVERED|PREPARING|READY|CANCELLED|REJECTED)/.test(l)) {
          order.status = l.replace(/\s+[1-5]\s*$/, '').trim();        // strip trailing star rating
          if (/\s([1-5])\s*$/.test(l)) order.rating = parseInt(l.match(/\s([1-5])\s*$/)[1]);
        }
        else if (/^\d+:\d+\s*(AM|PM)\s*\|/i.test(l)) {
          const parts = l.split('|').map(p => p.trim());
          order.order_time = parts[0];
          const dm = (parts[1] || '').match(/(\d+)\s+(\w+)/);
          if (dm) order.order_date = `${year}-${months[dm[2]] || '01'}-${dm[1].padStart(2, '0')}`;
        }
        else if (/^ID:\s*\d+/.test(l)) {
          order.order_id = l.replace('ID:', '').trim();
        }
        else if (/^By\s+/.test(l)) {
          order.customer_name = l.replace(/^By\s+/, '').trim();
        }
        else if (/^\d+\s*x\s/.test(l)) {
          order.items = (order.items ? order.items + ', ' : '') + l;
        }
        else if (/^₹[\d,.]+$/.test(l)) {
          order.order_value = parseFloat(l.replace(/[₹,]/g, ''));
        }
        else if (/delay|delayed/i.test(l)) {
          order.issues = (order.issues ? order.issues + '; ' : '') + l;
        }
        else if (/hamza express/i.test(l)) order.brand = 'he';
        else if (/nawabi chai/i.test(l)) order.brand = 'nch';
      }

      // Fallback brand from items if still unknown
      if (order.brand === 'unknown' && order.items) {
        order.brand = /chai|tea|coffee|bun maska|irani|osmania/i.test(order.items) ? 'nch' : 'he';
      }

      order.outlet_name = order.brand === 'he' ? 'Hamza Express'
        : order.brand === 'nch' ? 'Nawabi Chai House' : 'Unknown';

      if (order.order_id && !seen.has(order.order_id)) {
        seen.add(order.order_id);
        orders.push(order);
      }
    }

    if (orders.length > 0) pushOrders(orders);
    else pushHeartbeat('no_orders_found');
  }

  // ─── OUTLET BREAKDOWN EXPANDER ───────────────────────────────────────────────
  // Live Tracking page has "See outlet level breakdown →" links that must be clicked
  // to expose per-outlet (HE/NCH) sales data in the DOM.
  function expandOutletBreakdowns() {
    let clicked = 0;
    for (const el of document.querySelectorAll('a, button, span, div, [role="button"]')) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim();
      if (t && t.includes('outlet level breakdown')) {
        el.click();
        clicked++;
      }
    }
    if (clicked > 0) console.log(`[HN] Zomato: expanded ${clicked} outlet breakdown(s)`);
    return clicked;
  }

  // ─── LIVE TRACKING — today's real-time aggregates ─────────────────────────────
  // Page verified Apr 2026. Sections: Sales overview | Customer Experience |
  //   Customer funnel | Ads & Offers | Dish trends
  // All metric labels and formats verified from live DOM extraction.
  function extractLiveTracking(text) {
    const m = {};
    const nx = (key, regex) => { const match = text.match(regex); if (match) m[key] = match[1].replace(/,/g, ''); };

    // Sales overview
    nx('sales',              /Sales\n₹([\d,]+)/);
    nx('delivered_orders',   /Delivered orders\n(\d+)/);
    nx('aov',                /AOV\n₹([\d,]+)/);

    // Customer Experience
    nx('rejected_pct',       /Rejected orders\n([\d.]+)%/);
    nx('delayed_pct',        /Delayed orders\n([\d.]+)%/);
    nx('poor_rated_pct',     /Poor rated orders\n([\d.]+)%/);
    nx('lost_sales',         /Lost [Ss]ales\n₹([\d,]+)/);

    // Customer funnel
    nx('impressions',        /Impressions\n([\d,]+)/);
    nx('imp_to_menu',        /Impressions to menu\n([\d.]+)%/);
    nx('menu_to_cart',       /Menu to cart\n([\d.]+)%/);
    nx('cart_to_order',      /Cart to order\n([\d.]+)%/);
    nx('new_users',          /New users\n(\d+)/);
    nx('repeat_users',       /Repeat users\n(\d+)/);
    nx('lapsed_users',       /Lapsed users\n(\d+)/);

    // Ads & Offers
    nx('sales_from_offers',  /Sales from offers\n₹([\d,]+)/);

    // Outlet-level breakdown — verified format (live portal Apr 2026):
    // After clicking "See outlet level breakdown" in Sales overview:
    //   "Outlet level breakdown\nTotal sales\nToday 16 Apr\nchange\n
    //    Hamza Express, ID: 22632449\n₹1,649\n100%\n
    //    Nawabi Chai House, ID: 22632430\n₹282\n100%"
    const heM  = text.match(/Hamza Express, ID: 22632449\n₹([\d,]+)/);
    const nchM = text.match(/Nawabi Chai House, ID: 22632430\n₹([\d,]+)/);
    if (heM)  m.he_sales  = heM[1].replace(/,/g, '');
    if (nchM) m.nch_sales = nchM[1].replace(/,/g, '');
    console.log(`[HN] Zomato: outlet split — HE=${m.he_sales || 'not found'} NCH=${m.nch_sales || 'not found'}`);

    if (Object.keys(m).length > 0) {
      pushMetrics({
        source: 'dom_read', platform: 'zomato', brand: 'all', outlet_id: 'all',
        page: 'live_tracking', metrics: m, captured_at: new Date().toISOString(),
      });
      console.log(`[HN] Zomato: live_tracking pushed ${Object.keys(m).length} fields`);
    } else {
      pushHeartbeat('live_tracking_empty');
    }
  }

  // ─── BUSINESS REPORTS — weekly/monthly history table ─────────────────────────
  // URL: /reporting?selected_tab=tab_daily&...&selected_view=view_business_reports&business_reports_type=table
  // Table rows: Sales | Delivered orders | Average order value | Bad orders | Lost sales
  // Columns: weekly or monthly periods
  // Note: "tab_daily" in URL always; granularity (weekly/monthly/daily) set via filter modal.
  function extractBusinessReports(text) {
    const m = {};
    const nx = (key, regex) => { const match = text.match(regex); if (match) m[key] = match[1].replace(/,/g, ''); };

    nx('biz_sales',          /Sales\n₹([\d,]+)/);
    nx('biz_orders',         /Delivered orders\n(\d+)/);
    nx('biz_aov',            /Average order value\n₹([\d,]+)/);
    nx('biz_bad_orders_pct', /Bad orders[\s\S]{0,20}?([\d.]+)%/);
    nx('biz_lost_sales',     /Lost sales[\s\S]{0,20}?₹([\d,]+)/);
    m.view = 'business_reports';

    // Capture the date column headers to understand which period this is
    const weekMatch = text.match(/Week\s+(\d+)\s+\(([^)]+)\)/);
    if (weekMatch) m.biz_period = weekMatch[2];

    if (Object.keys(m).length > 1) {
      pushMetrics({
        source: 'dom_read', platform: 'zomato', brand: 'all', outlet_id: 'all',
        page: 'biz_reports', metrics: m, captured_at: new Date().toISOString(),
      });
      console.log(`[HN] Zomato: biz_reports pushed ${Object.keys(m).length} fields`);
    } else {
      pushHeartbeat('biz_reports_empty');
    }
  }

  // ─── BACKGROUND QUEUE DRAIN ───────────────────────────────────────────────────
  // background.js cannot reliably fetch() from service worker context after first
  // activation. It queues payloads to chrome.storage.local; we drain here.
  async function drainBackgroundQueue() {
    try {
      const data = await new Promise(r => chrome.storage.local.get('hn_pending_push', r));
      const queue = data.hn_pending_push || [];
      if (queue.length === 0) return;
      // Clear queue immediately before sending to avoid double-drain
      await new Promise(r => chrome.storage.local.set({ hn_pending_push: [] }, r));
      let sent = 0;
      for (const payload of queue) {
        try {
          await fetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
            body: JSON.stringify(payload),
          });
          sent++;
        } catch (e) { console.error('[HN] Zomato: drain send failed:', e.message); }
      }
      if (sent > 0) console.log(`[HN] Zomato: drained ${sent}/${queue.length} background queue items`);
    } catch (e) { console.error('[HN] Zomato: drainBackgroundQueue error:', e.message); }
  }

  // ─── PUSH FUNCTIONS ───────────────────────────────────────────────────────────
  // ─── DOM DUMP DIAGNOSTIC (Phase 1B helper) ──────────────────────────────────
  // Captures clickable element details + outlet-name positions on the live tracking
  // page so the next iteration can write proper outlet-filter click logic without
  // remote DOM inspection. Runs once per Chrome session per view (sessionStorage
  // gated). Pushed as metric_type='dom_dump_<view>' to D1.
  function dumpDomContext(viewName) {
    const sessionKey = `hn_dom_dumped_${viewName}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');

    const dump = {
      view: viewName,
      url: location.href.slice(0, 200),
      title: document.title,
      captured_at: new Date().toISOString(),
      interactive: [],
      outlet_anchors: [],
      filter_pills: [],
      page_text_first_3k: (document.body?.innerText || '').slice(0, 3000),
    };

    // 1. All visible interactive elements with text
    for (const el of document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"]')) {
      if (!el.offsetParent) continue;
      const text = (el.textContent || '').trim().slice(0, 80);
      if (!text) continue;
      const item = {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || null,
        text,
        cls: (el.className || '').toString().slice(0, 80),
        id: el.id || null,
      };
      const rect = el.getBoundingClientRect();
      item.pos = `${Math.round(rect.x)},${Math.round(rect.y)}`;
      dump.interactive.push(item);
      if (dump.interactive.length >= 80) break;
    }

    // 2. Leaf text nodes containing outlet names — useful for finding click targets
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) continue;
      if (/hamza express|nawabi chai|22632449|22632430/i.test(text)) {
        const anchor = el.closest('button, a, [role="button"], [onclick], [role="menuitem"]');
        dump.outlet_anchors.push({
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 150),
          parent_tag: el.parentElement?.tagName?.toLowerCase() || null,
          parent_cls: (el.parentElement?.className || '').toString().slice(0, 60),
          clickable_ancestor_tag: anchor?.tagName?.toLowerCase() || null,
          clickable_ancestor_role: anchor?.getAttribute('role') || null,
        });
        if (dump.outlet_anchors.length >= 30) break;
      }
    }

    // 3. Filter pill candidates — anything with text matching common filter labels
    const FILTER_RX = /^(All outlets|All|Daily|Today|Yesterday|Filter|Outlets?)$/i;
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (!text || !FILTER_RX.test(text)) continue;
      const anchor = el.closest('button, [role="button"], [data-clickable]');
      if (!anchor || !anchor.offsetParent) continue;
      dump.filter_pills.push({
        text,
        tag: anchor.tagName.toLowerCase(),
        role: anchor.getAttribute('role') || null,
        cls: (anchor.className || '').toString().slice(0, 80),
      });
      if (dump.filter_pills.length >= 20) break;
    }

    // Force-push (bypass the 30s pushMetrics dedup) by using a unique page key.
    fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
      body: JSON.stringify({ snapshots: [{
        source: 'dom_dump', platform: 'zomato', brand: 'system', outlet_id: 'diag',
        page: `dom_dump_${viewName}`, metrics: dump, captured_at: new Date().toISOString(),
      }] }),
    }).catch(() => {});
    console.log(`[HN] Zomato DOM dump pushed for view=${viewName}: ${dump.interactive.length} interactive, ${dump.outlet_anchors.length} outlet anchors, ${dump.filter_pills.length} filter pills`);
  }

  async function pushMetrics(payload) {
    const key = payload.page || 'default';
    const now = Date.now();
    if (lastPushTime[key] && now - lastPushTime[key] < 30_000) return;
    lastPushTime[key] = now;
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({ snapshots: [payload] }),
      });
    } catch (e) { console.error('[HN] Zomato push failed:', e.message); }
  }

  async function pushOrders(orders) {
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({ type: 'orders', orders }),
      });
      console.log(`[HN] Zomato: pushed ${orders.length} orders`);
    } catch (e) { console.error('[HN] Zomato order push failed:', e.message); }
  }

  async function pushHeartbeat(reason) {
    const now = Date.now();
    if (lastPushTime['heartbeat'] && now - lastPushTime['heartbeat'] < 60_000) return;
    lastPushTime['heartbeat'] = now;
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({ snapshots: [{ source: 'heartbeat', platform: 'zomato',
          brand: 'system', outlet_id: 'ext', page: 'heartbeat',
          metrics: { reason, current_view: detectView(), page_idx: getCurrentPageIdx(),
            url: location.href.slice(0, 120), ts: new Date().toISOString() },
          captured_at: new Date().toISOString() }] }),
      });
    } catch (e) {}
  }

  // ─── TIMERS ───────────────────────────────────────────────────────────────────
  setInterval(readAndPush, CONFIG.readInterval);
  setInterval(cyclePage, CONFIG.pageCycleInterval);
  setTimeout(readAndPush, CONFIG.initialDelay);

  console.log(`[HN] Zomato v5.0 loaded: view=${detectView()} idx=${getCurrentPageIdx()}`);
})();
