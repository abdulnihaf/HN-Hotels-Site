// content-swiggy.js v5.0.3
// v5.0: Rebuilt from verified live portal extraction (Apr 2026).
//       Uses confirmed DOM selectors: StyledFilterButton, FilterButtonContainer, ApplyButton.
//       Date filter modal: Open → click "Date" category → select radio → Apply.
//       Captures all 45+ metrics across Sales, Bolt, Ratings, Complaints, Funnel,
//       Customers, Ads (CPC+CBA), Discounts, Operations, Menu sections.

(function () {
  'use strict';

  // ─── LOGIN DETECTION — check URL immediately on load ─────────────────────────
  const _initUrl = location.href;
  if (_initUrl.includes('partner.swiggy.com') && !_initUrl.includes('/food/')) {
    console.log('[HN] Swiggy: login page detected (URL check)');
    chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'swiggy' }).catch(() => {});
    return;
  }

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'swiggy' }).catch(() => {});

  // Dine-out pages are handled by content-swiggy-dineout.js -- bail to prevent delivery page cycling
  if (_initUrl.includes('/dineout/')) { console.log('[HN] Swiggy: dineout URL, deferring to content-swiggy-dineout.js'); return; }

  const CONFIG = {
    endpoint: 'https://hnhotels.in/api/aggregator-pulse',
    apiKey: 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA',
    readInterval: 60_000,
    pageCycleInterval: 240_000,  // 4 min — enough time for full date cycle (~35s)
    initialDelay: 8_000,
  };

  // Pages: NCH Finance → HE Finance → Business Metrics
  // Verified from live portal Apr 2026: 1342888 = Nawabi Chai House, 1342887 = Hamza Express
  const PAGES = [
    'https://partner.swiggy.com/food/finance/order-payout/1342888',
    'https://partner.swiggy.com/food/finance/order-payout/1342887',
    'https://partner.swiggy.com/food/business-metrics',
  ];

  const OUTLETS = { '1342888': 'nch', '1342887': 'he' };

  let lastPushTime = {};
  let dateCycleRunning = false;
  let dateCycleDone = false;

  // ─── DATE FILTER DEFINITIONS ─────────────────────────────────────────────────
  // Verified from live portal extraction Apr 2026 — exact radio labels in modal
  const DATE_FILTERS = [
    { label: 'Yesterday',  period: 'yesterday' },
    { label: 'This Week',  period: 'thisweek'  },
    { label: 'Last Week',  period: 'lastweek'  },
    { label: 'This Month', period: 'month'     },
    { label: 'Today',      period: 'today'     },
  ];

  // ─── API INTERCEPT BRIDGE ─────────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.data?.platform !== 'swiggy') return;
    if (e.data.type === '__hn_api_capture') {
      pushMetrics({
        source: 'api_intercept', platform: 'swiggy', brand: 'all', outlet_id: 'all',
        url: e.data.url, data: e.data.data, captured_at: e.data.ts,
      });
      if (e.data.authHeaders && Object.keys(e.data.authHeaders).length > 0) {
        chrome.runtime.sendMessage({
          type: 'SESSION_DATA', platform: 'swiggy',
          data: { headers: e.data.authHeaders, url: e.data.url },
        }).catch(() => {});
      }
    }
    if (e.data.type === '__hn_api_discovery') {
      chrome.storage.local.get(['swiggy_api_urls'], (d) => {
        const urls = new Set(d.swiggy_api_urls || []);
        urls.add(e.data.url);
        chrome.storage.local.set({ swiggy_api_urls: [...urls].slice(-100) });
      });
    }
  });

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isLoginContent(text) {
    const sample = text.slice(0, 800).toLowerCase();
    return (
      /enter (your )?(phone|mobile|email|otp|password)/.test(sample) ||
      /sign (in|up) to swiggy/.test(sample) ||
      /login with otp/.test(sample) ||
      /continue with (phone|google|email)/.test(sample)
    );
  }

  function detectPage() {
    const url = location.href;
    if (url.includes('finance') || url.includes('order-payout')) return 'finance';
    if (url.includes('business-metrics')) return 'business-metrics';
    return 'unknown';
  }

  function getCurrentPageIdx() {
    const url = location.href;
    if (url.includes('1342888')) return 0;
    if (url.includes('1342887')) return 1;
    if (url.includes('business-metrics')) return 2;
    return 0;
  }

  function cyclePage() {
    const nextIdx = (getCurrentPageIdx() + 1) % PAGES.length;
    console.log(`[HN] Swiggy: cycling to page ${nextIdx}`);
    window.location.href = PAGES[nextIdx];
  }

  // ─── MODAL FILTER HELPERS (verified selectors from live portal, Apr 2026) ─────
  // Flow: openFilterModal() → clickDateCategory() → selectDateOption() → clickApply()
  // Modal anatomy:
  //   Left panel: category buttons (Date, Brands, Cities, Filter by outlets)
  //   Right panel: options for selected category (Date → radio buttons)
  //   Footer: "Clear all" | "Apply" (orange)

  function openFilterModal() {
    // Strategy 0 (best): exact styled component class found in live portal
    const styled = document.querySelector('[class*="StyledFilterButton"]');
    if (styled && styled.offsetParent) {
      styled.click();
      console.log('[HN] Swiggy: opened filter modal via StyledFilterButton');
      return true;
    }

    // Strategy 1: button/role="button" containing "Filter" text, not too long
    // Actual button text: "2 Outlets | Filter" (length=18)
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.replace(/\s+/g, ' ').trim();
      if (t && t.includes('Filter') && t.length < 50) {
        el.click();
        console.log(`[HN] Swiggy: opened filter modal via button "${t}"`);
        return true;
      }
    }

    // Strategy 2: any visible element with "Filter" in text, small bounding box
    for (const el of document.querySelectorAll('span, div, a, li')) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim();
      if (!t || !t.includes('Filter')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width < 200 && r.height < 60 && t.length < 50) {
        el.click();
        console.log(`[HN] Swiggy: opened filter modal via span/div "${t}"`);
        return true;
      }
    }

    console.warn('[HN] Swiggy: filter button not found');
    return false;
  }

  function clickDateCategory() {
    // After modal opens, click "Date" in the left panel to ensure date radios are shown
    // Selector: [class*="FilterButtonContainer"] items, or text-match on "Date"
    const containers = [...document.querySelectorAll('[class*="FilterButtonContainer"], [class*="FilterCategory"], [class*="FilterSidebar"] > *')];
    for (const el of containers) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim();
      if (t === 'Date' || t?.startsWith('Date\n') || t?.startsWith('Date ')) {
        el.click();
        console.log('[HN] Swiggy: clicked Date category in filter panel');
        return true;
      }
    }
    // Fallback: any visible small element with text exactly "Date"
    for (const el of document.querySelectorAll('span, div, button, li')) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim();
      if (t === 'Date') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width < 150 && r.height < 60) {
          el.click();
          console.log('[HN] Swiggy: clicked Date category via fallback');
          return true;
        }
      }
    }
    // Not finding it is OK — Date may already be active (default first category)
    console.log('[HN] Swiggy: Date category click skipped (may already be active)');
    return false;
  }

  function selectDateOption(labelText) {
    // Primary: radio inputs whose label text starts with labelText
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    for (const radio of radios) {
      if (!radio.offsetParent) continue;
      const label = radio.closest('label') || radio.parentElement;
      if (!label) continue;
      const t = label.textContent?.trim();
      if (t && (t === labelText || t.startsWith(labelText + '\n') || t.startsWith(labelText + ' '))) {
        (radio.closest('label') || radio).click();
        console.log(`[HN] Swiggy: selected "${labelText}" via radio`);
        return true;
      }
    }
    // Fallback: label/option/li/span elements matching labelText
    for (const el of document.querySelectorAll('label, [role="option"], [role="radio"], li, span, div')) {
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim();
      if (!t) continue;
      if ((t === labelText || t.startsWith(labelText + '\n') || t.startsWith(labelText + ' ')) &&
          t.length <= labelText.length + 30) {
        el.click();
        console.log(`[HN] Swiggy: selected "${labelText}" via fallback element`);
        return true;
      }
    }
    console.warn(`[HN] Swiggy: could not find date option "${labelText}"`);
    return false;
  }

  function clickApply() {
    // Strategy 0: exact styled component class from live portal
    const styled = document.querySelector('[class*="ApplyButton"]');
    if (styled && styled.offsetParent) {
      styled.click();
      console.log('[HN] Swiggy: clicked Apply via ApplyButton class');
      return true;
    }
    // Strategy 1: button with exact text "Apply"
    for (const btn of document.querySelectorAll('button')) {
      if (!btn.offsetParent) continue;
      if (btn.textContent?.trim() === 'Apply') {
        btn.click();
        console.log('[HN] Swiggy: clicked Apply via button text');
        return true;
      }
    }
    // Strategy 2: any visible element with text "Apply"
    for (const el of document.querySelectorAll('span, div, [role="button"]')) {
      if (!el.offsetParent) continue;
      if (el.textContent?.trim() === 'Apply') {
        el.click();
        console.log('[HN] Swiggy: clicked Apply via span/div');
        return true;
      }
    }
    console.warn('[HN] Swiggy: Apply button not found');
    return false;
  }

  function dismissModal() {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(esc);
  }

  // ─── DATE CYCLE — runs once per business-metrics page visit ──────────────────
  // For each period: open modal → click Date category → select radio → Apply → wait 4.5s → extract.
  // ~5 periods × ~6.5s = ~32s total (pageCycleInterval is 240s — plenty of headroom)
  async function runDateCycle() {
    if (dateCycleRunning || dateCycleDone) return;
    dateCycleRunning = true;
    console.log('[HN] Swiggy v5.0: starting date cycle');
    let modalWorking = true;

    for (const filter of DATE_FILTERS) {
      if (modalWorking) {
        const opened = openFilterModal();
        if (!opened) {
          console.log('[HN] Swiggy: modal unavailable — DOM-read only');
          modalWorking = false;
        } else {
          await sleep(700);    // modal animation

          // Ensure "Date" category is selected in left panel
          clickDateCategory();
          await sleep(300);

          const selected = selectDateOption(filter.label);
          await sleep(300);

          if (selected) {
            const applied = clickApply();
            if (applied) {
              await sleep(4500);   // SPA re-render after filter apply
              const text = document.body?.innerText || '';
              if (text.length > 200 && !isLoginContent(text)) {
                extractBusinessMetrics(text, filter.period);
              } else {
                console.log(`[HN] Swiggy: period="${filter.period}" — page not ready after apply`);
              }
            } else {
              dismissModal();
              await sleep(400);
            }
          } else {
            dismissModal();
            await sleep(400);
          }
        }
      }
      await sleep(300);
    }

    // Always capture current state as 'today' (default view)
    const text = document.body?.innerText || '';
    if (text.length > 200 && !isLoginContent(text)) {
      extractBusinessMetrics(text, 'today');
    }

    dateCycleDone = true;
    dateCycleRunning = false;
    console.log('[HN] Swiggy v5.0: date cycle complete');
  }

  // ─── MAIN READ + PUSH ─────────────────────────────────────────────────────────
  function readAndPush() {
    drainBackgroundQueue().catch(() => {});   // drain background.js queue first
    const text = document.body?.innerText || '';

    // 2026-05-10 DIAGNOSTIC BEACON: every readAndPush tick posts the URL + text
    // length + detected page so we can see from server-side WHERE the user's
    // Chrome is sitting. Fires once per minute per page. Extension-version aware
    // so we can confirm new content-script code is actually running.
    pushMetrics({
      source: 'dom_read', platform: 'swiggy',
      brand: 'all', outlet_id: 'beacon',
      page: 'tick_beacon',
      metrics: {
        url: location.href,
        text_len: text.length,
        is_login: isLoginContent(text),
        page_detect: detectPage(),
        sample_first_200: text.slice(0, 200),
        ext_v: 'v5.0.4_diag',
        ts: new Date().toISOString(),
      },
      captured_at: new Date().toISOString(),
    });

    if (text.length < 100 || isLoginContent(text)) {
      if (isLoginContent(text)) {
        chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'swiggy' }).catch(() => {});
      }
      pushHeartbeat('login_or_loading');
      return;
    }

    const page = detectPage();

    if (page === 'finance') {
      extractFinance(text);
    } else if (page === 'business-metrics') {
      if (!dateCycleDone && !dateCycleRunning) {
        runDateCycle().catch(e => console.error('[HN] Swiggy: date cycle error:', e.message));
      } else if (dateCycleDone) {
        extractBusinessMetrics(text, 'today');
      }
      // If cycle is running, do nothing — it handles its own pushes
    } else {
      pushHeartbeat('unknown_page');
    }
  }

  // ─── FINANCE PAGE ─────────────────────────────────────────────────────────────
  // Page text format (verified from live portal, Apr 2026):
  // "Total Customer Paid (A)\n₹567\nTotal Fees (B)\n-₹133.81\nNet Payout (A+B+C+D+E)\n₹405.65"
  function extractFinance(text) {
    // 2026-05-10: Finance-page parser stopped producing rows after Apr 17.
    // Always dump first 8KB of innerText so we can see the current page format
    // server-side and rewrite regexes without manual Chrome inspection.
    let _ridFromUrl = null;
    const _urlMatch = location.href.match(/order-payout\/(\d+)/);
    if (_urlMatch) _ridFromUrl = _urlMatch[1];
    const _brandFromUrl = OUTLETS[_ridFromUrl] || 'unknown';
    pushMetrics({
      source: 'dom_read', platform: 'swiggy',
      brand: _brandFromUrl, outlet_id: _ridFromUrl || 'unknown',
      page: 'finance_dump_' + _brandFromUrl,
      metrics: { dump: text.slice(0, 8000), url: location.href, ts: new Date().toISOString() },
      captured_at: new Date().toISOString(),
    });

    const ridMatch = text.match(/RID:\s*(\d+)/);
    const rid = ridMatch?.[1] || _ridFromUrl || '';
    const brand = OUTLETS[rid] || _brandFromUrl;

    const finance = {};
    const nx = (key, regex) => {
      const m = text.match(regex);
      if (m) finance[key] = m[1].replace(/,/g, '');
    };

    nx('total_orders',      /Total orders\n(\d+)/);
    nx('order_count',       /Orders\n(\d+)/);
    nx('customer_paid',     /Total Customer Paid \(A\)\s*\n₹([\d,.]+)/);
    nx('total_fees',        /Total Fees \(B\)\s*\n(-?₹[\d,.]+)/);
    nx('complaint_charges', /Complaint.*?Charges \(C\)\s*\n(-?₹[\d,.]+)/);
    nx('total_taxes',       /Total Taxes \(D\)\s*\n(-?₹[\d,.]+)/);
    nx('other_charges',     /Other Charges.*?\(E\)\s*\n(-?₹[\d,.]+)/);
    nx('net_payout',        /Net Payout \(A\+B\+C\+D(?:\+E)?\)\s*\n(-?₹[\d,.]+)/);

    const payDate = (text.match(/(?:will be paid on|Payment on|Expected by)\s*(.+?)$/m) || [])[1];
    if (payDate) finance.payout_date = payDate.trim();

    if (Object.keys(finance).length > 0) {
      pushMetrics({
        source: 'dom_read', platform: 'swiggy', brand, outlet_id: rid || 'unknown',
        page: 'finance_' + brand, metrics: finance, captured_at: new Date().toISOString(),
      });
    }

    extractOrdersFromFinance(text, brand);
  }

  // Swiggy Finance order format (verified Apr 2026):
  // "14th Apr | 01:07 PM\nOrder ID : 235065477814363\nDelivered\nOrder value\n₹567\nAmount you get\n₹405.65"
  function extractOrdersFromFinance(text, brand) {
    const orders = [];
    const lines = text.split('\n');
    const year = new Date().getFullYear();
    const months = {
      Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
      Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
    };

    let i = 0;
    while (i < lines.length) {
      const l = lines[i].trim();
      // Match date lines like "14th Apr | 01:07 PM"
      if (l.match(/\d+\w*\s+\w+\s*\|\s*\d+:\d+\s*(AM|PM)/i)) {
        const order = { platform: 'swiggy', brand, captured_at: new Date().toISOString() };
        const timePart = l.split('|')[1]?.trim();
        order.order_time = timePart || l;
        const dateMatch = l.match(/(\d+)\w*\s+(\w{3})/);
        if (dateMatch) {
          const mon = months[dateMatch[2]] || '01';
          order.order_date = `${year}-${mon}-${dateMatch[1].padStart(2, '0')}`;
        }
        // Scan following lines for order detail
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const ol = lines[j].trim();
          if (!ol) continue;
          if (ol.match(/\d+\w*\s+\w+\s*\|\s*\d+:\d+\s*(AM|PM)/i)) break; // next order
          if (ol.match(/Order ID\s*[:\-]\s*/i)) {
            order.order_id = ol.match(/(\d{8,})/)?.[1];
          } else if (/^(Delivered|Cancelled|Rejected|Preparing|Ready)$/i.test(ol)) {
            order.status = ol;
          } else if (ol.match(/^Order value$/i)) {
            const v = lines[j + 1]?.trim();
            if (v?.startsWith('₹')) order.order_value = parseFloat(v.replace(/[₹,]/g, ''));
          } else if (ol.match(/^Amount you get$/i)) {
            const v = lines[j + 1]?.trim();
            if (v?.startsWith('₹')) order.net_payout = parseFloat(v.replace(/[₹,]/g, ''));
          }
        }
        order.outlet_name = brand === 'he' ? 'Hamza Express' : 'Nawabi Chai House';
        if (order.order_id) orders.push(order);
      }
      i++;
    }

    if (orders.length > 0) pushOrders(orders);
  }

  // ─── BUSINESS METRICS — all 45+ metrics, period-tagged ───────────────────────
  // All sections appear in one scrollable page. innerText captures everything.
  // Sections (from verified portal map): Sales, Bolt, Ratings, Complaints, Funnel,
  //   Customers, Ads (CPC + CBA), Discounts, Operations, Menu
  function extractBusinessMetrics(text, period = 'today') {
    const m = {};
    const nx = (key, regex) => {
      const match = text.match(regex);
      if (match) m[key] = match[1].replace(/,/g, '');
    };

    // ── Sales ──
    nx('rpt_net_sales',         /Net Sales\n₹([\d,]+)/);
    nx('rpt_delivered_orders',  /Delivered Orders\n(\d+)/);
    nx('rpt_net_aov',           /Net AOV\n₹([\d,]+)/);
    nx('rpt_cancelled_orders',  /Restaurant Cancelled Orders\n(\d+)/);
    nx('rpt_cancelled_loss',    /Cancelled Order Loss\n₹([\d,]+)/);

    // ── Bolt ──
    nx('bolt_orders',           /Bolt\nOrders\n(\d+)/);          // "Bolt\nOrders" section heading
    nx('bolt_order_count',      /^Orders\n(\d+)/m);              // fallback
    nx('bolt_pct',              /% of Bolt Orders\n([\d.]+)%/);
    nx('bolt_aov',              /AOV\n₹([\d,]+)/);
    nx('bolt_avg_prep',         /Avg Prep time\n([\d.]+)\s*min/);
    nx('bolt_lt6min_pct',       /Orders with <6 min Prep time\n([\d.]+)%/);
    nx('delayed_bolt_pct',      /Delayed Orders \(>5 min\)\n(\d+)%/);

    // ── Ratings ──
    nx('rated_orders',          /Rated Orders\n(\d+)/);
    nx('poor_rated_orders',     /Poor Rated Orders\n(\d+)/);

    // ── Complaints ──
    nx('complaint_pct',         /% Orders with Complaints\n(\d+)%/);
    nx('complaint_orders',      /Orders with Complaints\n(\d+)/);
    nx('unresolved_complaints', /Unresolved Complaints\n(\d+)/);
    nx('wrong_items',           /Wrong Items\n(\d+)\s*complaint/);
    nx('missing_items',         /Missing Items\n(\d+)\s*complaint/);
    nx('quality_issues',        /Quality Issues\n(\d+)\s*complaint/);
    nx('packaging_issues',      /Packaging.*?Issues\n(\d+)\s*complaint/);

    // ── Funnel ──
    nx('impressions',           /IMPRESSIONS\n([\d,]+)/);
    nx('menu_opens',            /MENU OPENS\n([\d,]+)/);
    nx('cart_builds',           /CART BUILDS\n([\d,]+)/);
    nx('orders_placed',         /ORDERS PLACED\n([\d,]+)/);

    // ── Customers (48h lag) ──
    nx('new_customers',         /New Customers\n(\d+)/);
    nx('repeat_customers',      /Repeat Customers\n(\d+)/);
    nx('dormant_customers',     /Dormant Customers\n(\d+)/);
    nx('new_cust_order_pct',    /New Customer Order %\n(\d+)%/);
    nx('repeat_cust_order_pct', /Repeat Customer Order %\n(\d+)%/);

    // ── Ads — CPC ──
    nx('cpc_sales',             /CPC Driven Sales\n₹([\d,]+)/);
    nx('cpc_orders',            /CPC Orders\n(\d+)/);
    nx('cpc_spends',            /Total CPC Spends\n₹([\d,]+)/);
    nx('roas',                  /ROAS\n([\d.]+)/);

    // ── Ads — CBA ──
    nx('cba_sales',             /CBA Driven Sales\n₹([\d,]+)/);
    nx('cba_spends',            /Total CBA Spends\n₹([\d,]+)/);

    // ── Discounts ──
    nx('disc_sales',            /Sales via Discounts\n₹([\d,]+)/);
    nx('rdpo',                  /Restaurant Discount Per Order.*?\n₹([\d,]+)/);

    // ── Operations ──
    nx('online_availability',   /Online Availability %\n([\d.]+)%/);
    nx('kitchen_prep_time',     /Kitchen Prep Time\n([\d.]+)\s*min/);
    nx('mfr_accuracy',          /Food Ready Accuracy.*?\n(\d+)%/);
    nx('delayed_10min',         /Delayed Orders \(> 10 mins\)\n(\d+)%/);
    nx('avg_prep_time',         /Avg Prep time\n([\d.]+)\s*min/);

    // ── Menu ──
    nx('menu_score',            /Menu Score\(Out of 100\)\n(\d+)/);
    nx('items_with_photos',     /Items with Photos\n([\d.]+)%/);
    nx('items_with_desc',       /Items with Descriptions\n([\d.]+)%/);

    // Date range shown on page — capture for display
    const drMatch = text.match(/From\s+(.+?)\.\s*Comparison/i)
      || text.match(/(\d+\w*\s+\w+\s*[-–]\s*\d+\w*\s+\w+,?\s*\d{4})/);
    if (drMatch) m.date_range = drMatch[1].trim();
    m.period = period;

    const fieldCount = Object.keys(m).filter(k => k !== 'period' && k !== 'date_range').length;
    if (fieldCount > 0) {
      pushMetrics({
        source: 'dom_read', platform: 'swiggy', brand: 'all', outlet_id: 'all',
        page: `reports_swiggy_${period}`,
        metrics: m, captured_at: new Date().toISOString(),
      });
      console.log(`[HN] Swiggy: pushed ${fieldCount} fields for period="${period}"`);
    } else {
      console.log(`[HN] Swiggy: period="${period}" — 0 fields extracted (may not be loaded)`);
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
        } catch (e) { console.error('[HN] Swiggy: drain send failed:', e.message); }
      }
      if (sent > 0) console.log(`[HN] Swiggy: drained ${sent}/${queue.length} background queue items`);
    } catch (e) { console.error('[HN] Swiggy: drainBackgroundQueue error:', e.message); }
  }

  // ─── PUSH FUNCTIONS ───────────────────────────────────────────────────────────
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
    } catch (e) { console.error('[HN] Swiggy push failed:', e.message); }
  }

  async function pushOrders(orders) {
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({ type: 'orders', orders }),
      });
      console.log(`[HN] Swiggy: pushed ${orders.length} orders`);
    } catch (e) { console.error('[HN] Swiggy order push failed:', e.message); }
  }

  async function pushHeartbeat(reason) {
    const now = Date.now();
    if (lastPushTime['heartbeat'] && now - lastPushTime['heartbeat'] < 60_000) return;
    lastPushTime['heartbeat'] = now;
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({ snapshots: [{ source: 'heartbeat', platform: 'swiggy',
          brand: 'system', outlet_id: 'ext', page: 'heartbeat',
          metrics: { reason, current_page: detectPage(), date_cycle_done: dateCycleDone,
            url: location.href.slice(0, 120), ts: new Date().toISOString() },
          captured_at: new Date().toISOString() }] }),
      });
    } catch (e) {}
  }

  // ─── TIMERS ───────────────────────────────────────────────────────────────────
  setInterval(readAndPush, CONFIG.readInterval);
  setInterval(cyclePage, CONFIG.pageCycleInterval);
  setTimeout(readAndPush, CONFIG.initialDelay);

  console.log(`[HN] Swiggy v5.0 loaded: page=${detectPage()} idx=${getCurrentPageIdx()}`);
})();
