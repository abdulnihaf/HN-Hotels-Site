// background.js v6.0.0 FINAL — Aggregator Pulse service worker
// v6.0 changes (final lockdown):
//   - Added tabRefresh alarm: soft-reloads managed tabs every 4 hours to keep
//     Akamai _abck warm and force fresh cookie push.
//   - Added silenceWatchdog alarm: every 15 min, if no successful push in >30 min,
//     force-reloads tabs + re-pushes cookies.
//   - Version bumped to 6.0.0 with explicit FINAL banner so reload is verifiable.
//   - Broadcasts "lastPushAt" timestamps so silence detection works offline.
// Prior (v3.0+): pollData alarm (5 min) → direct API polling using chrome.cookies.
//   Swiggy: rms.swiggy.com/orders/v1/fetchOrders (needs stored Accesstoken)
//   Zomato: api.zomato.com/merchant-gw/web/owner-hub/reporting/get-home-data
//           api.zomato.com/merchant-gw/web/order/history/get-all

const ENDPOINT = 'https://hnhotels.in/api/aggregator-pulse';
const KEY = 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA';

const TARGETS = {
  swiggy: {
    startUrl: 'https://partner.swiggy.com/food/finance/order-payout/1342888',
    isOnPlatform: (url) => url && url.includes('swiggy.com'),
    isValid: (url) => url && url.includes('partner.swiggy.com/food/'),
    isLogin: (url) => url && url.includes('partner.swiggy.com') && !url.includes('/food/'),
    cookieDomains: ['.swiggy.com', 'partner.swiggy.com', 'rms.swiggy.com'],
  },
  zomato: {
    startUrl: 'https://www.zomato.com/partners/onlineordering/orderHistory/',
    isOnPlatform: (url) => url && url.includes('zomato.com'),
    isValid: (url) => url && url.includes('zomato.com/partners/'),
    isLogin: (url) => url && (
      url.includes('accounts.zomato.com') ||
      (url.includes('zomato.com') && !url.includes('/partners/'))
    ),
    cookieDomains: ['.zomato.com', 'www.zomato.com', 'accounts.zomato.com', 'api.zomato.com'],
  },
};

// ─── RECOVERY STATE ───────────────────────────────────────────────────────────
const lastRecoveryTime = {};
const recoveryAttempts = {};
const RECOVERY_COOLDOWN_MS = 90_000;
const MAX_RECOVERY_ATTEMPTS = 5;

// ─── SETUP ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(setupAlarms);

chrome.runtime.onStartup.addListener(async () => {
  setupAlarms();
  console.log('[HN] Chrome started — backing up then restoring cookies');
  await backupAllCookies();
  await restoreAllCookies();
  setTimeout(ensureTabs, 4000);
});

function setupAlarms() {
  chrome.alarms.create('healthCheck',     { periodInMinutes: 5 });
  chrome.alarms.create('cookieBackup',    { periodInMinutes: 30 });
  chrome.alarms.create('pollData',        { periodInMinutes: 5,  delayInMinutes: 1 });
  // v6.0: tabRefresh soft-reloads managed tabs every 4h so Akamai _abck stays warm.
  // Zomato auth tokens rotate server-side — a fresh page load refreshes them.
  chrome.alarms.create('tabRefresh',      { periodInMinutes: 240, delayInMinutes: 30 });
  // v6.0: silenceWatchdog — if no successful push in >30 min, force-reload tabs.
  chrome.alarms.create('silenceWatchdog', { periodInMinutes: 15, delayInMinutes: 15 });
}

// ─── ALARMS ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheck') await healthCheck();
  if (alarm.name === 'cookieBackup') {
    // Warm up service worker before network calls (Chrome MV3 alarm wake-up bug)
    await chrome.storage.local.get('_keepalive');
    await backupAllCookies();
    await pushCookiesToKV();
  }
  if (alarm.name === 'pollData') {
    // Warm up service worker network context before fetching (Chrome MV3 alarm wake-up bug)
    await chrome.storage.local.get('_keepalive');
    await pollAllPlatforms();
  }
  if (alarm.name === 'tabRefresh') {
    await chrome.storage.local.get('_keepalive');
    await refreshManagedTabs('scheduled');
  }
  if (alarm.name === 'silenceWatchdog') {
    await chrome.storage.local.get('_keepalive');
    await silenceWatchdog();
  }
});

// ─── MESSAGES FROM CONTENT SCRIPTS ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOGIN_DETECTED') {
    handleLoginDetected(msg.platform, sender.tab?.id);
  }
  if (msg.type === 'SESSION_DATA') {
    storeSessionData(msg.platform, msg.data).catch(() => {});
  }
  if (msg.type === 'PAGE_READY') {
    console.log(`[HN] ${msg.platform}: page ready — backup + push to KV`);
    recoveryAttempts[msg.platform] = 0;
    // Backup cookies AND push to KV immediately. The KV endpoint now has
    // change-detection (aggregator-pulse.js), so posting on every page load
    // doesn't blow up KV quota — it only writes when headers actually change.
    (async () => {
      try { await backupAllCookies(); await pushCookiesToKV(); }
      catch (e) { console.log('[HN] page_ready push failed:', e.message); }
    })();
  }
  if (msg.type === 'FORCE_PUSH') {
    (async () => {
      try { await backupAllCookies(); await pushCookiesToKV(); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true; // keep channel open for async sendResponse
  }
  if (msg.type === 'FORCE_REFRESH') {
    (async () => {
      try { await ensureTabs(); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  if (msg.type === 'GET_STATUS') {
    (async () => {
      const d = await chrome.storage.local.get(['cookies_swiggy', 'cookies_zomato']);
      sendResponse({
        bufferSize: 0,
        config: { pushInterval: 300, refreshInterval: 30, endpoint: ENDPOINT },
        cookies: { swiggy: (d.cookies_swiggy||[]).length, zomato: (d.cookies_zomato||[]).length },
      });
    })();
    return true;
  }
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
  }
  return false;
});

// ─── TAB MANAGEMENT ───────────────────────────────────────────────────────────

async function ensureTabs() {
  const allTabs = await chrome.tabs.query({});
  for (const [platform, cfg] of Object.entries(TARGETS)) {
    const has = allTabs.some(t => cfg.isOnPlatform(t.url));
    if (!has) {
      console.log(`[HN] No ${platform} tab — opening`);
      await chrome.tabs.create({ url: cfg.startUrl, active: false });
    }
  }
}

async function healthCheck() {
  const allTabs = await chrome.tabs.query({});
  for (const [platform, cfg] of Object.entries(TARGETS)) {
    const completedTabs = allTabs.filter(t => t.status === 'complete');
    const validTabs = completedTabs.filter(t => cfg.isValid(t.url));
    const loginTabs = completedTabs.filter(t => cfg.isLogin(t.url));
    const anyTab = allTabs.find(t => cfg.isOnPlatform(t.url));

    if (validTabs.length === 0) {
      if (loginTabs.length > 0) {
        console.log(`[HN] ${platform}: login page — restoring session`);
        await attemptRecovery(platform, loginTabs[0].id);
      } else if (anyTab) {
        if (anyTab.status === 'complete') {
          console.log(`[HN] ${platform}: wrong page — navigating back`);
          await chrome.tabs.update(anyTab.id, { url: cfg.startUrl });
        }
      } else {
        console.log(`[HN] ${platform}: no tab — creating`);
        await chrome.tabs.create({ url: cfg.startUrl, active: false });
      }
    } else {
      if (validTabs.length > 0) recoveryAttempts[platform] = 0;
    }
  }
}

// ─── RECOVERY ─────────────────────────────────────────────────────────────────

async function attemptRecovery(platform, tabId) {
  const now = Date.now();
  const lastTime = lastRecoveryTime[platform] || 0;
  const attempts = recoveryAttempts[platform] || 0;
  if (now - lastTime < RECOVERY_COOLDOWN_MS) return;
  if (attempts >= MAX_RECOVERY_ATTEMPTS) {
    pushAlert(platform, 'recovery_failed', { attempts, message: 'Manual re-login required' });
    return;
  }
  lastRecoveryTime[platform] = now;
  recoveryAttempts[platform] = attempts + 1;
  await handleLoginDetected(platform, tabId);
}

async function handleLoginDetected(platform, tabId) {
  const restored = await restoreCookies(platform);
  if (tabId) {
    await sleep(1500);
    try { await chrome.tabs.update(tabId, { url: TARGETS[platform].startUrl }); } catch (e) {}
  }
  pushAlert(platform, 'session_redirect', { restored });
}

// ─── API POLLING — Core of v3.0 ───────────────────────────────────────────────
// Calls partner APIs directly using browser cookies — no DOM scraping needed

async function pollAllPlatforms() {
  console.log('[HN Cron] Starting API poll cycle');
  await pollZomato().catch(e => console.error('[HN Cron] Zomato poll error:', e.message));
  await pollSwiggy().catch(e => console.error('[HN Cron] Swiggy poll error:', e.message));
}

// Build Cookie header string from chrome.cookies for a platform
async function buildCookieHeader(platform) {
  const allCookies = [];
  for (const domain of TARGETS[platform].cookieDomains) {
    try { allCookies.push(...await chrome.cookies.getAll({ domain })); } catch (e) {}
  }
  // Deduplicate by name+domain
  const unique = allCookies.filter((c, i, a) =>
    a.findIndex(x => x.name === c.name && x.domain === c.domain) === i
  );
  return {
    cookieHeader: unique
      .filter(c => !c.expirationDate || c.expirationDate > Date.now() / 1000)
      .map(c => `${c.name}=${c.value}`)
      .join('; '),
    cookies: unique,
  };
}

// IST date string (YYYY-MM-DD)
function istDate(offsetDays = 0) {
  return new Date(Date.now() + (5.5 + offsetDays * 24) * 3600000).toISOString().split('T')[0];
}

// ─── ZOMATO POLLING ───────────────────────────────────────────────────────────

async function pollZomato() {
  const { cookieHeader, cookies } = await buildCookieHeader('zomato');
  if (!cookieHeader) { console.log('[HN Cron] Zomato: no cookies available'); return; }

  // Extract CSRF tokens from cookies
  const csrft = cookies.find(c => c.name === 'csrft')?.value || '';
  const mxCsrft = cookies.find(c => c.name === '__Host-zmxcsrft' || c.name === 'zmxcsrft')?.value || '';

  const headers = {
    'Cookie': cookieHeader,
    'x-zomato-csrft': csrft,
    'x-zomato-mx-csrf-token': mxCsrft,
    'x-client-id': 'zomato_web_merchant',
    'x-zomato-app-version': '2',
    'x-zomato-source-identifier': 'merchant-dashboard',
    'origin': 'https://www.zomato.com',
    'referer': 'https://www.zomato.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'accept': 'application/json, text/plain, */*',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

  const today = istDate();

  // 1. Live Tracking — POST with {"filters":[]} body (confirmed from DevTools)
  try {
    const r = await fetch(
      `https://api.zomato.com/merchant-gw/web/owner-hub/reporting/get-home-data?selected_tab=tab_daily&selected_date=${today}&selected_view=view_live_tracking`,
      { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ filters: [] }) }
    );
    if (r.ok) {
      const data = await r.json();
      await pushToAggregator({ snapshots: [{ source: 'bg_cron', platform: 'zomato', brand: 'all', outlet_id: 'all', page: 'live_tracking_api', metrics: data, captured_at: new Date().toISOString() }]});
      await markPush('zomato');
      console.log('[HN Cron] Zomato live tracking ✓');
    } else {
      const text = await r.text().catch(() => '');
      console.log('[HN Cron] Zomato live tracking HTTP', r.status, text.slice(0, 100));
    }
  } catch (e) { console.error('[HN Cron] Zomato live tracking error:', e.message); }

  // 2. Restaurant metrics — confirmed URL from DevTools (www.zomato.com/merchant-api)
  try {
    const r = await fetch(
      `https://www.zomato.com/merchant-api/restaurants/get-all?res_id=22632449,22632430`,
      { headers }
    );
    if (r.ok) {
      const data = await r.json();
      await pushToAggregator({ snapshots: [{ source: 'bg_cron', platform: 'zomato', brand: 'all', outlet_id: 'all', page: 'restaurant_metrics', metrics: data, captured_at: new Date().toISOString() }]});
      console.log('[HN Cron] Zomato restaurant metrics ✓');
    } else {
      const text = await r.text().catch(() => '');
      console.log('[HN Cron] Zomato restaurant metrics HTTP', r.status, text.slice(0, 100));
    }
  } catch (e) { console.error('[HN Cron] Zomato restaurant metrics error:', e.message); }

  // 3. Order history — separate call per outlet so brand is known definitively
  const nowMs = Date.now() + 5.5 * 3600000;
  const fromTs = Math.floor((nowMs - 2 * 86400000) / 1000);
  const toTs = Math.floor((nowMs + 3600000) / 1000);
  const outlets = [
    { res_id: '22632449', brand: 'he', name: 'Hamza Express' },
    { res_id: '22632430', brand: 'nch', name: 'Nawabi Chai House' },
  ];
  for (const outlet of outlets) {
    try {
      const r = await fetch(
        `https://api.zomato.com/merchant-gw/web/order/history/get-all?res_id=${outlet.res_id}&from_ts=${fromTs}&to_ts=${toTs}&page=1&page_size=100`,
        { headers }
      );
      if (r.ok) {
        const data = await r.json();
        // debug logging removed — infoList structure confirmed
        const orders = parseZomatoOrders(data, today, outlet.brand, outlet.name);
        if (orders.length > 0) {
          await pushToAggregator({ type: 'orders', orders });
          console.log(`[HN Cron] Zomato ${outlet.brand} ${orders.length} orders ✓`);
        } else {
          console.log(`[HN Cron] Zomato ${outlet.brand}: 0 orders (snippets: ${data?.snippets?.length || 0})`);
        }
      } else {
        const text = await r.text().catch(() => '');
        console.log(`[HN Cron] Zomato ${outlet.brand} orders HTTP`, r.status, text.slice(0, 80));
      }
    } catch (e) { console.error(`[HN Cron] Zomato ${outlet.brand} orders error:`, e.message); }
  }
}

// Extract plain text from Zomato's markdown: <style|{color|text}>
function zmdText(md) {
  if (!md || typeof md !== 'string') return '';
  const m = md.match(/\{[^|{]+\|([^{}]+)\}/);
  return m ? m[1].trim() : md.replace(/<[^>]*>/g, '').replace(/[{}]/g, '').trim();
}

function parseZomatoOrders(data, today, forceBrand, forceOutlet) {
  const orderList = data?.snippets || data?.orders || data?.orderList || [];

  const orders = [];
  for (const o of orderList) {
    const orderId = String(o.id || o.orderId || o.order_id || '');
    if (!orderId) continue;

    // --- Snippet format (api.zomato.com/merchant-gw/web/order/history/get-all) ---
    if (o.primaryTag || o.topRightText || o.infoList) {
      const status = zmdText(o.primaryTag?.label?.text || '');

      // Time: "1:03 PM | 16 April"
      const timeRaw = zmdText(o.topRightText?.text || '');
      const [orderTime, datePart] = timeRaw.split(' | ').map(s => s.trim());
      let orderDate = today;
      if (datePart) {
        const [day, month] = datePart.split(' ');
        const mo = { January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12 }[month];
        if (mo) orderDate = `${new Date().getFullYear()}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      }

      // infoList: confirmed structure from DevTools:
      // pair[0]: left="ID: xxx", right="By Customer Name"
      // pair[1]: left="items text", right="₹amount"
      // pair[2+]: left="issue description", right=""
      const pairs = (o.infoList || []).map(item => ({
        L: zmdText(item.leftText?.text || ''),
        R: zmdText(item.rightText?.text || ''),
      }));

      let customerName = '', items = '', orderValue = null, outletName = '', issues = '';
      if (pairs[0]) {
        customerName = pairs[0].R.replace(/^By /i, '');
      }
      if (pairs[1]) {
        items = pairs[1].L;
        const mAmt = pairs[1].R.match(/₹([\d,.]+)/);
        if (mAmt) orderValue = parseFloat(mAmt[1].replace(',', ''));
      }
      // pairs[2+] are issues/complaints
      const issueLines = pairs.slice(2).map(p => p.L).filter(Boolean);
      if (issueLines.length) issues = issueLines.join('; ');
      // bottomSnippet may hold outlet name
      const bottomText = zmdText(o.bottomSnippet?.text || o.bottomSnippet?.label?.text || '');
      if (!outletName && /hamza|nawabi/i.test(bottomText)) outletName = bottomText;

      // Use forced brand/outlet from per-restaurant API call
      let brand = forceBrand || 'unknown';
      const outletFinal = forceOutlet || outletName || bottomText;
      if (!forceBrand) {
        const haystack = (outletFinal + ' ' + items).toLowerCase();
        if (/hamza/.test(haystack)) brand = 'he';
        else if (/nawabi|chai/.test(haystack)) brand = 'nch';
      }

      orders.push({
        platform: 'zomato', brand,
        order_id: orderId, status: status || 'UNKNOWN',
        order_time: orderTime || '', order_date: orderDate,
        customer_name: customerName, items, order_value: orderValue,
        issues: issues || null,
        outlet_name: outletFinal, captured_at: new Date().toISOString(),
      });
      continue;
    }

    // --- Legacy flat format (fallback) ---
    const items = (o.items || o.orderItems || o.dishes || [])
      .map(i => `${i.quantity || i.qty || 1} x ${i.name || i.title || i.item_name || ''}`)
      .join(', ');
    const outletName = o.restaurantName || o.outlet_name || o.restaurant?.name || '';
    let brand = 'unknown';
    if (/hamza/i.test(outletName) || /hamza/i.test(items)) brand = 'he';
    else if (/nawabi|chai/i.test(outletName) || /chai|tea|irani|bun maska/i.test(items)) brand = 'nch';
    const rawTime = o.orderTime || o.order_time || o.placedAt || o.placed_at || '';
    let orderDate = today, orderTime = rawTime;
    if (rawTime && rawTime.includes('T')) {
      const d = new Date(rawTime);
      orderDate = d.toISOString().split('T')[0];
      orderTime = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    orders.push({
      platform: 'zomato', brand,
      order_id: orderId,
      status: o.status || o.orderStatus || 'UNKNOWN',
      order_time: orderTime,
      order_date: orderDate,
      customer_name: o.customerName || o.customer?.name || o.customer_name || '',
      items,
      order_value: parseFloat(o.totalAmount || o.amount || o.orderValue || o.order_value || 0) || null,
      outlet_name: outletName,
      captured_at: new Date().toISOString(),
    });
  }
  return orders;
}

// ─── SWIGGY POLLING ───────────────────────────────────────────────────────────

async function pollSwiggy() {
  // Swiggy uses Accesstoken for auth — cookies are supplementary only
  const stored = await chrome.storage.local.get(['swiggy_accesstoken']);
  const accesstoken = stored.swiggy_accesstoken;
  if (!accesstoken) { console.log('[HN Cron] Swiggy: no Accesstoken yet (visit partner.swiggy.com to seed it)'); return; }

  const { cookieHeader } = await buildCookieHeader('swiggy');
  // Proceed even without cookies — Accesstoken is sufficient for rms.swiggy.com

  const body = JSON.stringify({
    restaurantTimeMap: [
      { restaurantId: 1342888, lastUpdatedTime: null }, // HE
      { restaurantId: 1342887, lastUpdatedTime: null }, // NCH
    ],
    sourceMessageIdMap: { source: 'POLLING_SERVICE' },
  });

  try {
    const r = await fetch('https://rms.swiggy.com/orders/v1/fetchOrders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        'Accesstoken': accesstoken,
        'origin': 'https://partner.swiggy.com',
        'referer': 'https://partner.swiggy.com/food/',
      },
      body,
    });

    if (r.ok) {
      const data = await r.json();
      const orders = parseSwiggyLiveOrders(data);
      if (orders.length > 0) {
        await pushToAggregator({ type: 'orders', orders });
        console.log(`[HN Cron] Swiggy ${orders.length} live orders ✓`);
      }
      // Push raw snapshot for ops visibility
      const summary = (data.restaurantData || []).map(rd => ({
        restaurantId: rd.restaurantId,
        isServiceable: rd.isServiceable,
        activeBatches: Object.keys(rd.batches || {}).length,
      }));
      await pushToAggregator({ snapshots: [{
        source: 'bg_cron', platform: 'swiggy', brand: 'all', outlet_id: 'all',
        page: 'live_orders', metrics: { outlets: summary, polled_at: new Date().toISOString() },
        captured_at: new Date().toISOString(),
      }]});
      await markPush('swiggy');
    } else {
      console.log('[HN Cron] Swiggy fetchOrders HTTP', r.status);
      // Accesstoken may have expired — clear it so inject.js can capture fresh one
      if (r.status === 401 || r.status === 403) {
        await chrome.storage.local.remove(['swiggy_accesstoken']);
        console.log('[HN Cron] Swiggy: cleared expired Accesstoken');
      }
    }
  } catch (e) { console.error('[HN Cron] Swiggy fetch error:', e.message); }
}

function parseSwiggyLiveOrders(data) {
  const orders = [];
  const OUTLETS = {
    1342888: { brand: 'he', name: 'Hamza Express' },
    1342887: { brand: 'nch', name: 'Nawabi Chai House' },
  };

  for (const restaurant of (data.restaurantData || [])) {
    const outlet = OUTLETS[restaurant.restaurantId] || { brand: 'unknown', name: 'Unknown' };
    const batches = restaurant.batches || {};
    const serverTime = restaurant.serverTime;

    for (const [orderId, batch] of Object.entries(batches)) {
      if (!orderId) continue;
      const od = batch.orderDetails || batch;

      let orderDate = istDate();
      let orderTime = '';
      if (serverTime) {
        const d = new Date(serverTime);
        orderDate = d.toISOString().split('T')[0];
        orderTime = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      }

      orders.push({
        platform: 'swiggy',
        brand: outlet.brand,
        order_id: String(orderId),
        status: od.orderStatus || od.status || 'PREPARING',
        order_time: orderTime,
        order_date: orderDate,
        customer_name: od.customerName || od.customer_name || '',
        items: (od.items || []).map(i => `${i.quantity || 1} x ${i.name || ''}`).join(', '),
        order_value: parseFloat(od.orderTotal || od.order_value || 0) || null,
        outlet_name: outlet.name,
        captured_at: new Date().toISOString(),
      });
    }
  }
  return orders;
}

// ─── v6.0 TAB KEEPALIVE + SILENCE WATCHDOG ──────────────────────────────────

async function refreshManagedTabs(reason) {
  const allTabs = await chrome.tabs.query({});
  for (const [platform, cfg] of Object.entries(TARGETS)) {
    const tab = allTabs.find(t => cfg.isOnPlatform(t.url) && cfg.isValid(t.url));
    if (tab && tab.status === 'complete') {
      try {
        await chrome.tabs.reload(tab.id, { bypassCache: false });
        console.log(`[HN v6.0] Refreshed ${platform} tab (${reason})`);
      } catch (e) { console.log(`[HN v6.0] ${platform} refresh failed:`, e.message); }
    } else if (!tab) {
      // Tab missing — create it
      await chrome.tabs.create({ url: cfg.startUrl, active: false });
      console.log(`[HN v6.0] Created missing ${platform} tab (${reason})`);
    }
  }
  await chrome.storage.local.set({ last_tab_refresh: new Date().toISOString() });
}

async function markPush(platform) {
  const key = `last_push_${platform}`;
  await chrome.storage.local.set({ [key]: Date.now() });
}

async function silenceWatchdog() {
  const d = await chrome.storage.local.get(['last_push_swiggy', 'last_push_zomato']);
  const now = Date.now();
  const SILENCE_MS = 30 * 60 * 1000; // 30 min
  const silentPlatforms = [];
  for (const platform of ['swiggy', 'zomato']) {
    const last = d[`last_push_${platform}`] || 0;
    if (!last || (now - last) > SILENCE_MS) silentPlatforms.push(platform);
  }
  if (silentPlatforms.length) {
    console.log(`[HN v6.0 watchdog] Silent platforms: ${silentPlatforms.join(',')} — forcing refresh`);
    await refreshManagedTabs(`silence:${silentPlatforms.join(',')}`);
    await backupAllCookies();
    await pushCookiesToKV();
  }
}

// ─── PUSH HELPER — queue via chrome.storage.local, content scripts drain it ───
// Chrome MV3 service workers cannot reliably fetch() to external domains after
// the first activation cycle. Content scripts run in the page renderer process
// and can always fetch. So background.js queues payloads to storage; the content
// scripts call drainBackgroundQueue() at the start of each readAndPush() cycle.

async function pushToAggregator(payload) {
  try {
    const data = await chrome.storage.local.get('hn_pending_push');
    const queue = data.hn_pending_push || [];
    queue.push(payload);
    // Cap at 100 entries to avoid unbounded growth
    if (queue.length > 100) queue.splice(0, queue.length - 100);
    await chrome.storage.local.set({ hn_pending_push: queue });
    console.log(`[HN Cron] Queued payload (queue size: ${queue.length})`);
  } catch (e) {
    console.error('[HN Cron] Failed to queue payload:', e.message);
  }
}

// ─── COOKIE MANAGEMENT ────────────────────────────────────────────────────────

async function backupAllCookies() {
  const backup = {};
  for (const [platform, cfg] of Object.entries(TARGETS)) {
    const all = [];
    for (const domain of cfg.cookieDomains) {
      try { all.push(...await chrome.cookies.getAll({ domain })); } catch (e) {}
    }
    const unique = all.filter((c, i, arr) =>
      arr.findIndex(x => x.name === c.name && x.domain === c.domain && x.path === c.path) === i
    );
    backup[`cookies_${platform}`] = unique;
    console.log(`[HN] Backed up ${unique.length} ${platform} cookies`);
  }
  backup.cookies_backed_at = new Date().toISOString();
  await chrome.storage.local.set(backup);
  return backup;
}

async function pushCookiesToKV() {
  // Retired Apr 19 2026: v6.0 appliance mode polls Swiggy directly from
  // Chrome (see pollSwiggy), and Zomato cron path was already disabled.
  // No server-side consumer of KV sessions remains. Keeping the function
  // for backward-compat call sites, but it's a no-op — avoids the 1000
  // KV puts/day ceiling on Cloudflare Workers Free tier.
  return;
}

async function restoreCookies(platform) {
  const data = await chrome.storage.local.get([`cookies_${platform}`]);
  const cookies = data[`cookies_${platform}`] || [];
  if (!cookies.length) { console.log(`[HN] No ${platform} cookies saved yet`); return 0; }

  const now = Date.now() / 1000;
  let restored = 0;
  for (const c of cookies) {
    if (c.expirationDate && c.expirationDate < now) continue;
    try {
      const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      const d = {
        url: `https://${domain}${c.path || '/'}`,
        name: c.name, value: c.value,
        domain: c.domain, path: c.path || '/',
        secure: c.secure, httpOnly: c.httpOnly,
      };
      if (c.sameSite && c.sameSite !== 'unspecified') d.sameSite = c.sameSite;
      if (c.expirationDate) d.expirationDate = c.expirationDate;
      await chrome.cookies.set(d);
      restored++;
    } catch (e) {}
  }
  console.log(`[HN] Restored ${restored}/${cookies.length} ${platform} cookies`);
  return restored;
}

async function restoreAllCookies() {
  await restoreCookies('swiggy');
  await restoreCookies('zomato');
}

// ─── SESSION DATA → KV + LOCAL STORAGE ───────────────────────────────────────

async function storeSessionData(platform, data) {
  // v3.0: Save Swiggy Accesstoken locally for direct API polling.
  // Local storage is still needed — pollSwiggy() reads it to authenticate.
  if (platform === 'swiggy' && data.headers?.Accesstoken) {
    await chrome.storage.local.set({ swiggy_accesstoken: data.headers.Accesstoken });
    console.log('[HN] Swiggy Accesstoken captured and saved');
  }

  // KV push retired Apr 19 2026 — no server-side consumer. See pushCookiesToKV.
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────

async function pushAlert(platform, event, extra = {}) {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({
        snapshots: [{
          platform: 'system', brand: platform, outlet_id: 'bg',
          page: `alert_${event}`,
          metrics: { event, ...extra, ts: new Date().toISOString() },
          captured_at: new Date().toISOString(),
        }],
      }),
    });
  } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
console.log('%c[HN v6.0 FINAL] Aggregator Pulse service worker ready', 'background:#1a5e20;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold');
