const ENDPOINT = 'https://hnhotels.in/api/purchase-control';

const PORTALS = {
  HYPERPURE: {
    label: 'Hyperpure',
    startUrl: 'https://www.hyperpure.com/',
    domains: ['hyperpure.com'],
    searchUrl: hyperpureSearchUrl,
    searchDelayMs: 2200,
  },
  ZEPTO: {
    label: 'Zepto',
    startUrl: 'https://www.zepto.com/',
    domains: ['zepto.com', 'zeptonow.com'],
    searchUrl: (query) => `https://www.zepto.com/search?query=${encodeURIComponent(query)}`,
    searchDelayMs: 3200,
  },
  FLIPKART_MINUTES: {
    label: 'Flipkart Minutes',
    startUrl: 'https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL',
    domains: ['flipkart.com'],
    searchUrl: (query) => `https://www.flipkart.com/search?q=${encodeURIComponent(query)}&marketplace=HYPERLOCAL`,
    searchDelayMs: 3200,
  },
  INSTAMART: {
    label: 'Instamart',
    startUrl: 'https://www.swiggy.com/stores/instamart/',
    domains: ['swiggy.com'],
    searchUrl: (query) => `https://www.swiggy.com/stores/instamart/search?custom_back=true&query=${encodeURIComponent(query)}`,
    searchDelayMs: 3800,
  },
  BLINKIT: {
    label: 'Blinkit',
    startUrl: 'https://blinkit.com/',
    domains: ['blinkit.com'],
    searchUrl: (query) => `https://blinkit.com/s/?q=${encodeURIComponent(query)}`,
    searchDelayMs: 3200,
  },
  AMAZON_NOW: {
    label: 'Amazon Now',
    startUrl: 'https://www.amazon.in/',
    domains: ['amazon.in'],
    searchUrl: (query) => `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=nowstore`,
    searchDelayMs: 3400,
  },
  // Amazon Fresh lives at the same amazon.in domain as Amazon Now —
  // same cookies cover both. We list it as a separate portal so the
  // owner can verify Fresh-mode works at capture time, but the
  // captured session is interchangeable with Amazon Now's.
  AMAZON_FRESH: {
    label: 'Amazon Fresh',
    startUrl: 'https://www.amazon.in/',
    domains: ['amazon.in'],
    searchUrl: (query) => `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=amazonfresh`,
    searchDelayMs: 3400,
  },
  // Amazon Business — DIFFERENT subdomain (business.amazon.in) with its
  // own login + cookies. Owner has the HN HOTELS PVT LTD business
  // account registered there. Captures B2B prices + GST invoicing.
  AMAZON_BUSINESS: {
    label: 'Amazon Business',
    startUrl: 'https://business.amazon.in/',
    domains: ['business.amazon.in', 'amazon.in'],
    searchUrl: (query) => `https://www.amazon.in/s?k=${encodeURIComponent(query)}`,
    searchDelayMs: 3400,
  },
  BIGBASKET: {
    label: 'BigBasket',
    startUrl: 'https://www.bigbasket.com/',
    domains: ['bigbasket.com'],
    // AASA-correct path /cl/* (was /ps/ which iOS doesn't UL-claim).
    searchUrl: (query) => `https://www.bigbasket.com/cl/${encodeURIComponent(query)}`,
    searchDelayMs: 3200,
  },
  JIOMART: {
    label: 'JioMart',
    startUrl: 'https://www.jiomart.com/',
    domains: ['jiomart.com'],
    // AASA-correct /catalogsearch/* (was /search/ which JM app
    // doesn't claim).
    searchUrl: (query) => `https://www.jiomart.com/catalogsearch/result?q=${encodeURIComponent(query)}`,
    searchDelayMs: 3600,
  },
  // ─── B2B / wholesale chip-launchers (added 2026-05-29) ───
  // These don't have iOS Universal Links configured on their web
  // domains (DMart, Metro — verified via AASA probe). Session capture
  // still works for future VPS scout adapters that pull B2B prices.
  METRO: {
    label: 'Metro Wholesale',
    startUrl: 'https://www.metro-india.com/',
    domains: ['metro-india.com', 'metro.co.in'],
    searchUrl: (query) => `https://www.metro-india.com/search?q=${encodeURIComponent(query)}`,
    searchDelayMs: 3600,
  },
  DMART: {
    label: 'DMart Ready',
    startUrl: 'https://www.dmart.in/',
    domains: ['dmart.in', 'dmartready.in'],
    searchUrl: (query) => `https://www.dmart.in/search?q=${encodeURIComponent(query)}`,
    searchDelayMs: 3600,
  },
  // IndiaMART — m.indiamart.com is the mobile subdomain with the AASA
  // claim; capture happens on whatever subdomain the owner is signed
  // into in Chrome (usually the desktop www subdomain).
  INDIAMART: {
    label: 'IndiaMART',
    startUrl: 'https://www.indiamart.com/',
    domains: ['indiamart.com', 'm.indiamart.com', 'dir.indiamart.com'],
    searchUrl: (query) => `https://dir.indiamart.com/search.mp?ss=${encodeURIComponent(query)}`,
    searchDelayMs: 3600,
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'GET_CONTEXT') {
      sendResponse(await getContext());
      return;
    }
    if (message.type === 'OPEN_PORTAL') {
      await openPortal(message.sourceKey);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'CAPTURE_CURRENT') {
      sendResponse(await captureCurrent(message));
      return;
    }
    if (message.type === 'GET_HEALTH') {
      sendResponse(await getHealth(message.pin));
      return;
    }
    if (message.type === 'RUN_BROWSER_QUOTES') {
      sendResponse(await runBrowserQuotes(message));
      return;
    }
    if (message.type === 'RUN_BROWSER_QUOTES_ALL') {
      const consoleTabId = sender?.tab?.id || 0;
      sendResponse(await runBrowserQuotesAll(message, consoleTabId));
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || 'Unknown extension error' });
  });
  return true;
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Open a portal tab before capturing');
  return tab;
}

async function getContext() {
  const tab = await getActiveTab().catch(() => null);
  const settings = await chrome.storage.local.get(['accountLabel', 'locationLabel', 'pincode', 'expiryHours']);
  return {
    ok: true,
    activeUrl: tab?.url || '',
    detectedSource: tab?.url ? detectSource(tab.url) : '',
    portals: Object.entries(PORTALS).map(([key, value]) => ({ key, label: value.label, startUrl: value.startUrl })),
    settings: {
      pin: '',
      accountLabel: settings.accountLabel || '',
      locationLabel: settings.locationLabel || 'Shivajinagar',
      pincode: settings.pincode || '560051',
      expiryHours: settings.expiryHours || 6,
    },
  };
}

function detectSource(urlValue) {
  const url = new URL(urlValue);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  for (const [key, portal] of Object.entries(PORTALS)) {
    if (portal.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return key;
  }
  return '';
}

async function openPortal(sourceKey) {
  const portal = PORTALS[sourceKey];
  if (!portal) throw new Error('Unknown portal');
  await chrome.tabs.create({ url: portal.startUrl, active: true });
}

async function captureCurrent(message) {
  const pin = String(message.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter the purchase console PIN');

  const tab = await getActiveTab();
  const detected = detectSource(tab.url);
  const sourceKey = message.sourceKey || detected;
  const portal = PORTALS[sourceKey];
  if (!portal) throw new Error('Open one of the wired purchase portals before capturing');
  if (!detected) throw new Error('Current tab is not a wired purchase portal');
  if (detected !== sourceKey) throw new Error(`Current tab is ${PORTALS[detected].label}, not ${portal.label}`);

  const pageState = await readPageState(tab.id);
  const cookies = await readCookies(tab.url, portal.domains);
  const expiresAt = expiryFromCookies(cookies, Number(message.expiryHours || 6));
  const payload = {
    capture_version: '1.5.0',
    source_key: sourceKey,
    captured_url: tab.url,
    captured_title: tab.title || pageState.title || '',
    user_agent: pageState.userAgent || '',
    cookies,
    local_storage: pageState.localStorage,
    session_storage: pageState.sessionStorage,
    visible_cookie_names: pageState.cookieNames,
    visible_cookies: pageState.visibleCookies,
    storage_limits: pageState.limits,
  };

  const body = {
    action: 'upsert-portal-session',
    pin,
    source_key: sourceKey,
    account_label: String(message.accountLabel || '').trim(),
    location_label: String(message.locationLabel || '').trim(),
    pincode: String(message.pincode || '').trim(),
    user_agent: pageState.userAgent || '',
    expires_at: expiresAt,
    session: payload,
  };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Vault rejected capture (${response.status})`);

  await chrome.storage.local.set({
    accountLabel: body.account_label,
    locationLabel: body.location_label,
    pincode: body.pincode,
    expiryHours: Number(message.expiryHours || 6),
    [`lastCapture_${sourceKey}`]: new Date().toISOString(),
  });

  return {
    ok: true,
    sourceKey,
    sourceLabel: portal.label,
    cookieCount: cookies.length,
    visibleCookieCount: Object.keys(pageState.visibleCookies || {}).length,
    localStorageCount: Object.keys(pageState.localStorage).length,
    sessionStorageCount: Object.keys(pageState.sessionStorage).length,
    expiresAt,
    health: data.session,
    readyCount: data.ready_count,
  };
}

async function readCookies(tabUrl, domains) {
  const all = [];
  const origins = new Set([new URL(tabUrl).origin]);
  for (const domain of domains) {
    origins.add(`https://${domain}`);
    origins.add(`https://www.${domain}`);
  }

  for (const origin of origins) {
    try {
      all.push(...await chrome.cookies.getAll({ url: origin }));
    } catch (_) {}
  }
  for (const domain of domains) {
    try {
      all.push(...await chrome.cookies.getAll({ domain }));
    } catch (_) {}
  }

  const unique = new Map();
  for (const cookie of all) {
    unique.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expirationDate: cookie.expirationDate || null,
      hostOnly: !!cookie.hostOnly,
      httpOnly: !!cookie.httpOnly,
      secure: !!cookie.secure,
      sameSite: cookie.sameSite || 'unspecified',
      session: !!cookie.session,
      storeId: cookie.storeId || '',
    });
  }
  return [...unique.values()];
}

async function readPageState(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPageState,
  });
  return result?.result || {
    title: '',
    userAgent: '',
    localStorage: {},
    sessionStorage: {},
    cookieNames: [],
    visibleCookies: {},
    limits: { error: 'No page state returned' },
  };
}

function collectPageState() {
  const MAX_KEYS = 80;
  const MAX_VALUE_CHARS = 6000;
  const TOKENISH = /token|auth|jwt|bearer|session|csrf|cart|user|profile|location|address|store|pincode|pin/i;

  function readStorage(store) {
    const prioritized = [];
    const normal = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key) continue;
      (TOKENISH.test(key) ? prioritized : normal).push(key);
    }
    const selected = [...prioritized, ...normal.filter((key) => !prioritized.includes(key))].slice(0, MAX_KEYS);
    const output = {};
    for (const key of selected) {
      try {
        const raw = store.getItem(key) || '';
        output[key] = raw.length > MAX_VALUE_CHARS
          ? `${raw.slice(0, MAX_VALUE_CHARS)}...[truncated:${raw.length}]`
          : raw;
      } catch (_) {}
    }
    return output;
  }

  function readVisibleCookies() {
    const output = {};
    const text = document.cookie || '';
    if (!text) return output;
    for (const part of text.split(';')) {
      const eq = part.indexOf('=');
      const key = (eq >= 0 ? part.slice(0, eq) : part).trim();
      if (!key) continue;
      const raw = eq >= 0 ? part.slice(eq + 1) : '';
      output[key] = raw.length > MAX_VALUE_CHARS
        ? `${raw.slice(0, MAX_VALUE_CHARS)}...[truncated:${raw.length}]`
        : raw;
    }
    return output;
  }

  const visibleCookies = readVisibleCookies();

  return {
    title: document.title || '',
    userAgent: navigator.userAgent || '',
    localStorage: readStorage(window.localStorage),
    sessionStorage: readStorage(window.sessionStorage),
    cookieNames: Object.keys(visibleCookies),
    visibleCookies,
    limits: {
      maxKeys: MAX_KEYS,
      maxValueChars: MAX_VALUE_CHARS,
      localStorageTotal: window.localStorage.length,
      sessionStorageTotal: window.sessionStorage.length,
    },
  };
}

function expiryFromCookies(cookies, fallbackHours) {
  const nowSeconds = Date.now() / 1000;
  const futureExpiries = cookies
    .map((cookie) => cookie.expirationDate)
    .filter((value) => Number.isFinite(value) && value > nowSeconds + 60)
    .sort((a, b) => a - b);
  const fallback = Date.now() + Math.max(1, fallbackHours || 6) * 3600000;
  const expiryMs = futureExpiries.length ? futureExpiries[0] * 1000 : fallback;
  return new Date(expiryMs).toISOString();
}

async function getHealth(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('Enter the purchase console PIN');
  const response = await fetch(`${ENDPOINT}?action=portal-health&pin=${encodeURIComponent(pin)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Health check failed (${response.status})`);
  return { ok: true, ...data };
}

async function runBrowserQuotes(message) {
  const pin = String(message.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter the purchase console PIN');

  const tab = await getActiveTab();
  const detected = detectSource(tab.url);
  const sourceKey = message.sourceKey || detected;
  const portal = PORTALS[sourceKey];
  if (!portal) throw new Error('Choose a wired purchase portal');
  if (detected !== sourceKey) throw new Error(`Open the logged-in ${portal.label} tab before running live quotes`);

  const result = await runQuotesForPortal({ pin, sourceKey, tab, portal, navigatedHere: true });
  if (result.error) throw new Error(result.error);
  return result;
}

async function runBrowserQuotesAll(message, consoleTabId) {
  const payload = message.payload || {};
  const pin = String(payload.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'Enter the purchase console PIN' };

  const batchId = String(payload.batch_id || '').trim();
  if (!batchId) return { ok: false, error: 'Missing batch_id from purchase console' };
  const runId = String(payload.run_id || '').trim();

  const requestedSources = Array.isArray(payload.sources) && payload.sources.length
    ? payload.sources.filter((key) => PORTALS[key])
    : Object.keys(PORTALS);
  if (!requestedSources.length) return { ok: false, error: 'No portals requested' };

  const consoleTab = consoleTabId ? await chrome.tabs.get(consoleTabId).catch(() => null) : null;
  const targetWindowId = consoleTab?.windowId;

  const perSource = [];
  for (const sourceKey of requestedSources) {
    const portal = PORTALS[sourceKey];
    if (!portal) {
      perSource.push({ source_key: sourceKey, state: 'skipped', detail: 'Unknown portal' });
      sendConsoleStatus(consoleTabId, {
        source_key: sourceKey,
        state: 'skipped',
        detail: 'Unknown portal',
      });
      continue;
    }

    sendConsoleStatus(consoleTabId, {
      source_key: sourceKey,
      source_label: portal.label,
      state: 'starting',
      detail: `Opening ${portal.label} tab`,
    });

    let tab;
    try {
      tab = await ensurePortalTab(sourceKey, targetWindowId);
    } catch (error) {
      const detail = error?.message || 'Could not open portal tab';
      perSource.push({ source_key: sourceKey, state: 'error', detail });
      sendConsoleStatus(consoleTabId, {
        source_key: sourceKey,
        source_label: portal.label,
        state: 'error',
        detail,
      });
      continue;
    }

    sendConsoleStatus(consoleTabId, {
      source_key: sourceKey,
      source_label: portal.label,
      state: 'running',
      detail: `Searching ${portal.label}`,
    });

    let result;
    try {
      result = await runQuotesForPortal({
        pin,
        sourceKey,
        tab,
        portal,
        batchId,
        runId,
        navigatedHere: false,
      });
    } catch (error) {
      result = { ok: false, error: error?.message || 'Portal quote run failed' };
    }

    if (!result.ok) {
      const detail = result.error || 'Portal quote run failed';
      perSource.push({ source_key: sourceKey, state: 'error', detail });
      sendConsoleStatus(consoleTabId, {
        source_key: sourceKey,
        source_label: portal.label,
        state: 'error',
        detail,
      });
      continue;
    }

    const summary = result.summary || {};
    const detail = result.jobCount
      ? `${summary.quoted_count || 0} quoted / ${summary.error_count || 0} error of ${result.jobCount}`
      : result.message || 'No portal jobs waiting';
    perSource.push({
      source_key: sourceKey,
      state: result.jobCount ? 'done' : 'no_jobs',
      detail,
      job_count: result.jobCount,
      updated_count: result.updatedCount,
    });
    sendConsoleStatus(consoleTabId, {
      source_key: sourceKey,
      source_label: portal.label,
      state: result.jobCount ? 'done' : 'no_jobs',
      detail,
      summary,
    });
  }

  if (consoleTabId) {
    try { await chrome.tabs.update(consoleTabId, { active: true }); } catch (_) {}
  }

  const completed = perSource.filter((entry) => entry.state === 'done').length;
  return {
    ok: true,
    batch_id: batchId,
    run_id: runId,
    sources: perSource,
    completed,
  };
}

function sendConsoleStatus(consoleTabId, payload) {
  if (!consoleTabId) return;
  try {
    chrome.tabs.sendMessage(consoleTabId, {
      target: 'HN_PURCHASE_CONSOLE_BRIDGE',
      type: 'STATUS',
      payload,
    }, () => {
      // swallow chrome.runtime.lastError — console tab may have been closed.
      void chrome.runtime.lastError;
    });
  } catch (_) {}
}

async function ensurePortalTab(sourceKey, windowId) {
  const portal = PORTALS[sourceKey];
  if (!portal) throw new Error(`Unknown portal ${sourceKey}`);
  const existing = await findPortalTab(sourceKey);
  if (existing) return existing;
  const createOptions = { url: portal.startUrl, active: false };
  if (windowId) createOptions.windowId = windowId;
  return chrome.tabs.create(createOptions);
}

async function findPortalTab(sourceKey) {
  const portal = PORTALS[sourceKey];
  if (!portal) return null;
  const patterns = [];
  for (const domain of portal.domains || []) {
    patterns.push(`*://${domain}/*`, `*://*.${domain}/*`);
  }
  if (!patterns.length) return null;
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    return tabs.find((tab) => tab.id) || null;
  } catch (_) {
    return null;
  }
}

async function runQuotesForPortal({ pin, sourceKey, tab, portal, batchId, runId, navigatedHere }) {
  if (!tab?.id) return { ok: false, error: `${portal.label} tab is not available` };

  const params = new URLSearchParams({
    action: 'browser-quote-jobs',
    pin,
    source_key: sourceKey,
  });
  if (batchId) params.set('batch_id', batchId);
  if (runId) params.set('run_id', runId);
  const jobsUrl = `${ENDPOINT}?${params.toString()}`;
  const jobsResponse = await fetch(jobsUrl);
  const jobsData = await jobsResponse.json().catch(() => ({}));
  if (!jobsResponse.ok) {
    return { ok: false, error: jobsData.error || `Quote jobs failed (${jobsResponse.status})` };
  }

  const jobs = jobsData.jobs || [];
  if (!jobs.length) {
    return {
      ok: true,
      sourceKey,
      sourceLabel: portal.label,
      jobCount: 0,
      updatedCount: 0,
      message: jobsData.message || 'No quote jobs waiting',
    };
  }

  // For Hyperpure native UI, the tab needs to actually be on a Hyperpure page.
  // If we opened the tab ourselves, wait for the start page to be ready first.
  if (!navigatedHere) {
    try {
      await waitForTabLoad(tab.id, 8000);
    } catch (_) {}
  }

  const results = [];
  for (const job of jobs.slice(0, 20)) {
    const query = job.query || job.name;
    let runResult;
    try {
      runResult = sourceKey === 'HYPERPURE'
        ? await runHyperpureSearch(tab.id, query)
        : await runGenericPortalSearch(tab.id, sourceKey, query);
    } catch (error) {
      runResult = { error: error?.message || `${portal.label} portal search failed` };
    }
    results.push({
      cart_id: job.cart_id,
      query,
      ...runResult,
    });
  }

  const ingestResponse = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'ingest-browser-search-results',
      pin,
      source_key: sourceKey,
      batch_id: batchId || jobsData.batch?.id,
      results,
    }),
  });
  const ingestData = await ingestResponse.json().catch(() => ({}));
  if (!ingestResponse.ok) {
    return { ok: false, error: ingestData.error || `Quote ingest failed (${ingestResponse.status})` };
  }

  return {
    ok: true,
    sourceKey,
    sourceLabel: portal.label,
    jobCount: jobs.length,
    updatedCount: results.length,
    batch: ingestData.batch,
    summary: ingestData.summary,
  };
}

async function runHyperpureSearch(tabId, query) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: hyperpureNativeSearchInPage,
    args: [query],
  });
  if (hasUsableHyperpureResult(result?.result)) return result.result;

  const fallback = await runHyperpureSearchPageFallback(tabId, query);
  if (hasUsableHyperpureResult(fallback)) return fallback;
  return fallback || result?.result || { error: 'No browser search result returned' };
}

async function runGenericPortalSearch(tabId, sourceKey, query) {
  const portal = PORTALS[sourceKey];
  if (!portal?.searchUrl) return { error: `${portal?.label || sourceKey} does not have a search URL configured` };

  const targetUrl = portal.searchUrl(query);
  await chrome.tabs.update(tabId, { url: targetUrl });
  await waitForTabLoad(tabId, 14000);
  await sleep(portal.searchDelayMs || 3200);

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: genericScrapeSearchResults,
    args: [query, sourceKey, portal.label],
  });
  return result?.result || { error: `${portal.label} search page scrape returned no result` };
}

function hasUsableHyperpureResult(result) {
  if (!result || result.error) return false;
  const status = parseInt(result.status || 0, 10) || 0;
  if (status >= 400) return false;
  return !!result.data;
}

async function runHyperpureSearchPageFallback(tabId, query) {
  const targetUrl = hyperpureSearchUrl(query);
  await chrome.tabs.update(tabId, { url: targetUrl });
  await waitForTabLoad(tabId, 12000);
  await sleep(2200);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: hyperpureScrapeSearchResults,
    args: [query],
  });
  return result?.result || { error: 'Hyperpure search page scrape returned no result' };
}

function hyperpureSearchUrl(query) {
  const slug = String(query || 'search')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'search';
  const url = new URL(`https://www.hyperpure.com/in/search/${encodeURIComponent(slug)}`);
  url.searchParams.set('type', 'SEARCH');
  url.searchParams.set('query', query);
  url.searchParams.set('referenceType', 'autosuggest_enter_before_result');
  url.searchParams.set('parent_reference_type', 'autosuggest_enter_before_result');
  return url.toString();
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === 'complete') setTimeout(done, 500);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hyperpureNativeSearchInPage(query) {
  let observed = [];
  let inputDrivenAt = 0;
  const startedAt = Date.now();
  const originalFetch = window.fetch;
  const originalOpen = window.XMLHttpRequest?.prototype?.open;
  const originalSend = window.XMLHttpRequest?.prototype?.send;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  function compactText(value, limit = 320) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}...[truncated:${text.length}]` : text;
  }

  // Generic adjectives that bleed-through to unrelated SKUs ("Fresh Coriander"
  // matching "Fresh Noodles"). Kept in sync with MATCH_STOPWORDS server-side.
  const MATCH_STOPWORDS = new Set([
    'fresh', 'organic', 'premium', 'pure', 'natural', 'whole',
    'select', 'best', 'quality', 'farm', 'pack', 'packs',
    'big', 'small', 'mini', 'jumbo', 'value',
    'special', 'classic', 'original', 'choice', 'extra',
  ]);

  const rawTokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part && part.length > 3);
  const filteredTokens = rawTokens.filter((part) => !MATCH_STOPWORDS.has(part));
  // Fall back to raw tokens only if EVERY token was a stopword — otherwise
  // any URL containing "fresh" would still be accepted as relevant.
  const queryKeywords = filteredTokens.length ? filteredTokens : rawTokens;

  function isRelevant(url, body) {
    if (!queryKeywords.length) return false;
    const haystack = `${url || ''} ${body || ''}`.toLowerCase();
    return queryKeywords.some((part) => haystack.includes(part));
  }

  // Walk the parsed JSON payload looking for a product-like string field that
  // contains a query keyword. Rejects stale responses where the URL says
  // "search" but the body is from a different query (root cause of the
  // "Coriander -> Kim's Noodles" bug — Hyperpure's autosuggest cache sometimes
  // returned a prior unrelated search payload).
  function payloadMatchesQuery(data) {
    if (!queryKeywords.length) return true;
    if (!data || typeof data !== 'object') return false;
    const PRODUCT_FIELDS = new Set([
      'name', 'productname', 'product_name', 'displayname', 'display_name',
      'title', 'productdisplayname', 'item_name', 'sku_name',
    ]);
    const seen = new WeakSet();
    let found = false;
    function walk(node, depth) {
      if (found || depth > 10 || !node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const child of node) {
          if (found) return;
          walk(child, depth + 1);
        }
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (found) return;
        const kl = k.toLowerCase();
        if (PRODUCT_FIELDS.has(kl) && typeof v === 'string') {
          const text = v.toLowerCase();
          if (queryKeywords.some((part) => text.includes(part))) {
            found = true;
            return;
          }
        }
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    }
    walk(data, 0);
    return found;
  }

  function isFreshAndMatching(entry) {
    if (!entry || !entry.ok || !entry.data) return false;
    if (!inputDrivenAt || entry.captured_at_ms < (inputDrivenAt - startedAt)) return false;
    return payloadMatchesQuery(entry.data);
  }

  function parseBody(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function remember(entry) {
    observed.push({
      ...entry,
      captured_at_ms: Date.now() - startedAt,
    });
    if (observed.length > 20) observed.shift();
  }

  function patchFetch() {
    if (typeof originalFetch !== 'function') return;
    window.fetch = async function patchedFetch(input, init = {}) {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      const requestBody = init?.body || '';
      const response = await originalFetch.apply(this, arguments);
      if (isRelevant(requestUrl, requestBody)) {
        response.clone().text().then((text) => {
          remember({
            transport: 'fetch',
            url: requestUrl,
            method: init?.method || (typeof input === 'object' && input?.method) || 'GET',
            status: response.status,
            ok: response.ok,
            data: parseBody(text),
            body_preview: compactText(text),
          });
        }).catch(() => {});
      }
      return response;
    };
  }

  function patchXhr() {
    if (!originalOpen || !originalSend) return;
    window.XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__hnRequest = { method, url };
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function patchedSend(body) {
      const request = this.__hnRequest || {};
      if (isRelevant(request.url, body)) {
        this.addEventListener('loadend', () => {
          remember({
            transport: 'xhr',
            url: request.url || '',
            method: request.method || 'GET',
            status: this.status,
            ok: this.status >= 200 && this.status < 300,
            data: parseBody(this.responseText),
            body_preview: compactText(this.responseText),
          });
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  function visibleInputScore(input) {
    const rect = input.getBoundingClientRect();
    const text = [
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute('name'),
      input.getAttribute('type'),
      input.className,
      input.id,
    ].join(' ').toLowerCase();
    let score = 0;
    if (rect.width > 180 && rect.height > 20) score += 3;
    if (text.includes('search')) score += 8;
    if (text.includes('product')) score += 3;
    if (text.includes('english cucumber')) score += 4;
    if (input.offsetParent !== null) score += 3;
    return score;
  }

  function findSearchInput() {
    return Array.from(document.querySelectorAll('input, textarea'))
      .map((input) => ({ input, score: visibleInputScore(input) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.input || null;
  }

  function driveInput(input) {
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    if (nativeInputValueSetter && input instanceof window.HTMLInputElement) {
      nativeInputValueSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInputValueSetter.call(input, query);
    } else {
      input.value = query;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  function restore() {
    if (typeof originalFetch === 'function') window.fetch = originalFetch;
    if (originalOpen) window.XMLHttpRequest.prototype.open = originalOpen;
    if (originalSend) window.XMLHttpRequest.prototype.send = originalSend;
  }

  patchFetch();
  patchXhr();

  try {
    const input = findSearchInput();
    if (!input) return { error: 'Hyperpure search input was not found on this page' };

    // Drop anything captured before we typed — those are stale responses from
    // prior tab activity / autosuggest cache.
    observed = [];
    inputDrivenAt = Date.now();
    driveInput(input);

    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      const successful = observed.find(isFreshAndMatching);
      if (successful) return { status: successful.status, data: successful.data, raw_observation: {
        transport: successful.transport,
        url_path: (() => {
          try {
            const url = new URL(successful.url, location.origin);
            return `${url.origin}${url.pathname}`;
          } catch (_) {
            return compactText(successful.url, 180);
          }
        })(),
      } };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // Deadline passed. Don't return a stale/non-matching response as a fallback
    // — that's the bug that produced Coriander -> Kim's Noodles. Better to
    // signal "no fresh result" and let the caller try the page fallback or
    // mark unavailable.
    const post = observed.filter((entry) => entry.captured_at_ms >= (inputDrivenAt - startedAt));
    return {
      status: 0,
      error: 'Hyperpure search ran but no response matched the query',
      body_preview: post[post.length - 1]?.body_preview || '',
      raw_observation: {
        transport: 'native',
        observed_count: observed.length,
        post_input_count: post.length,
        had_query_match: false,
      },
    };
  } catch (error) {
    return { error: error.message || 'Hyperpure native UI search failed' };
  } finally {
    restore();
  }
}

function hyperpureScrapeSearchResults(query) {
  function cleanText(value, limit = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}...[truncated:${text.length}]` : text;
  }

  function parseRupees(text) {
    const match = String(text || '').replace(/,/g, '').match(/₹\s*(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function normalizeTitle(lines, priceIndex) {
    const blocked = /^(add|\+|notify me|view similar|out of stock|high in demand|\d+\+ recent buyers|rated|veg|non veg|brand|all)$/i;
    const rating = /^[0-9.]+\s*\(?\d*\)?$/;
    const candidates = lines
      .slice(Math.max(0, priceIndex - 8), priceIndex)
      .filter((line) => /[a-z]/i.test(line))
      .filter((line) => !blocked.test(line))
      .filter((line) => !rating.test(line))
      .filter((line) => !/^₹/.test(line))
      .filter((line) => !/off mrp|best rate|recent buyers/i.test(line));
    return cleanText(candidates.slice(-3).join(' '), 180);
  }

  function packFromText(text) {
    const match = cleanText(text, 600).match(/\b\d+(?:\.\d+)?\s?(?:kg|g|gm|ml|l|ltr|litre|pcs|pc|pack|carton|tin|bottle|nos)\b/i);
    return match ? match[0] : '';
  }

  function productFromElement(el) {
    const raw = el.innerText || '';
    if (!raw.includes('₹')) return null;
    if (raw.length < 20 || raw.length > 950) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) return null;

    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    const priceIndex = lines.findIndex((line) => /₹\s*[\d,]+(?:\.\d+)?/.test(line));
    if (priceIndex < 0) return null;
    const price = parseRupees(lines[priceIndex]);
    if (!price) return null;
    const title = normalizeTitle(lines, priceIndex);
    if (!title) return null;

    const statusText = /out of stock|notify me|view similar/i.test(raw) ? 'OUT_OF_STOCK' : 'AVAILABLE';
    return {
      name: title,
      productName: title,
      title,
      sellingPrice: price,
      price,
      packSize: packFromText(raw),
      stockStatus: statusText,
      availability: statusText,
      buttonText: /add/i.test(raw) ? 'ADD' : '',
      productUrl: location.href,
      source: 'HYPERPURE_DOM_SEARCH',
      rawText: cleanText(raw, 420),
      cardArea: Math.round(rect.width * rect.height),
    };
  }

  const candidates = Array.from(document.querySelectorAll('article, li, section, div'))
    .map(productFromElement)
    .filter(Boolean)
    .sort((a, b) => a.cardArea - b.cardArea);

  const seen = new Set();
  const products = [];
  for (const product of candidates) {
    const key = `${product.title.toLowerCase()}|${product.price}|${product.stockStatus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(product);
    if (products.length >= 30) break;
  }

  if (!products.length) {
    return {
      status: 0,
      error: 'Hyperpure search page loaded but no price cards were detected',
      body_preview: cleanText(document.body?.innerText || '', 320),
    };
  }

  return {
    status: 200,
    data: {
      source: 'HYPERPURE_DOM_SEARCH',
      query,
      url: location.href,
      products,
    },
    raw_observation: {
      transport: 'dom',
      url_path: location.pathname,
      product_count: products.length,
    },
  };
}

function genericScrapeSearchResults(query, sourceKey, sourceLabel) {
  function cleanText(value, limit = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}...[truncated:${text.length}]` : text;
  }

  function parseRupees(text) {
    const normalized = String(text || '').replace(/,/g, '');
    const matches = [...normalized.matchAll(/₹\s*(\d+(?:\.\d+)?)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!matches.length) return 0;
    return Math.min(...matches);
  }

  function packFromText(text) {
    const match = cleanText(text, 900).match(/\b\d+(?:\.\d+)?\s?(?:kg|kgs|g|gm|grams|ml|l|ltr|litre|litres|pcs|pc|pieces|pack|packs|carton|tin|bottle|bottles|nos|unit|units)\b/i);
    return match ? match[0] : '';
  }

  function deliveryFromText(text) {
    const normalized = cleanText(text, 900);
    const match = normalized.match(/\b(?:in\s*)?(\d{1,3})\s?(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\b/i);
    if (match) {
      const value = Number(match[1]);
      const unit = match[2].toLowerCase();
      const minutes = unit.startsWith('hr') || unit.startsWith('hour')
        ? value * 60
        : unit.startsWith('day')
          ? value * 1440
          : value;
      return { etaMinutes: minutes, etaLabel: match[0] };
    }
    if (/tomorrow/i.test(normalized)) return { etaMinutes: 1440, etaLabel: 'Delivery tomorrow' };
    if (/today|same day/i.test(normalized)) return { etaMinutes: 720, etaLabel: 'Same day' };
    return { etaMinutes: 0, etaLabel: '' };
  }

  function normalizeTitle(lines, priceIndex) {
    const blocked = /^(add|add item|\+|cart|buy now|notify me|view similar|out of stock|sold out|unavailable|high in demand|best rate|offers?|mrp|price|free delivery|sponsored|ad|rated|rating|ratings?|reviews?|veg|non veg|brand|all|new|login|sign in|deliver(?:y)?|minutes?|mins?|today|tomorrow)$/i;
    const badFragment = /off mrp|best rate|recent buyers|save ₹|inclusive of|delivery|cashback|bank offer|terms|sponsored/i;
    const rating = /^[0-9.]+\s*(?:\(\d+\))?$/;
    const windowStart = priceIndex >= 0 ? Math.max(0, priceIndex - 10) : 0;
    const windowEnd = priceIndex >= 0 ? Math.min(lines.length, priceIndex + 8) : Math.min(lines.length, 16);
    const candidates = lines
      .slice(windowStart, windowEnd)
      .map((line) => cleanText(line, 140))
      .filter((line) => line && /[a-z]/i.test(line))
      .filter((line) => !blocked.test(line))
      .filter((line) => !rating.test(line))
      .filter((line) => !/^₹/.test(line))
      .filter((line) => !/^\d+(?:\.\d+)?\s?(?:kg|g|gm|ml|l|pc|pcs|pack)$/i.test(line))
      .filter((line) => !badFragment.test(line));
    const scored = candidates
      .map((line, index) => ({
        line,
        index,
        score:
          (line.length >= 12 ? 4 : 0) +
          (line.length >= 24 ? 2 : 0) +
          (/\b(?:amul|heritage|nandini|president|milk|butter|rice|oil|paneer|chicken|mutton|onion|tomato|masala|container|foil|box|bag|powder|sauce|atta|maida|sugar)\b/i.test(line) ? 3 : 0) -
          (/\d{1,3}%|₹|\bmin\b|\bdelivery\b/i.test(line) ? 5 : 0),
      }))
      .sort((a, b) => b.score - a.score || b.index - a.index);
    return cleanText(scored[0]?.line || candidates[0] || '', 180);
  }

  function productUrlFromElement(el) {
    const link = el.closest('a[href]') || el.querySelector?.('a[href]');
    const href = link?.getAttribute('href') || '';
    if (!href) return location.href;
    try {
      return new URL(href, location.origin).toString();
    } catch (_) {
      return location.href;
    }
  }

  function imageUrlFromElement(el) {
    const img = el.querySelector?.('img[src], img[data-src], picture img') || el.closest?.('a')?.querySelector?.('img[src], img[data-src]');
    const src = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
    if (!src || /^data:/i.test(src)) return '';
    try {
      return new URL(src, location.origin).toString();
    } catch (_) {
      return '';
    }
  }

  function productFromElement(el) {
    const raw = el.innerText || '';
    if (!raw.includes('₹')) return null;
    if (raw.length < 16 || raw.length > 1400) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 96 || rect.height < 48) return null;
    if (rect.bottom < 0 || rect.right < 0) return null;

    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    const priceIndex = lines.findIndex((line) => /₹\s*[\d,]+(?:\.\d+)?/.test(line));
    const priceText = lines.filter((line) => /₹/.test(line) && !/off|save|cashback|bank offer|coupon/i.test(line)).join('\n') || raw;
    const price = parseRupees(priceText);
    if (!price) return null;
    const title = normalizeTitle(lines, priceIndex);
    if (!title || title.length < 3) return null;

    const statusText = /out\s*of\s*stock|notify me|view similar|sold\s*out|unavailable/i.test(raw)
      ? 'OUT_OF_STOCK'
      : 'AVAILABLE';
    const delivery = deliveryFromText(raw);

    return {
      name: title,
      productName: title,
      title,
      sellingPrice: price,
      price,
      packSize: packFromText(raw),
      stockStatus: statusText,
      availability: statusText,
      deliveryLabel: delivery.etaLabel,
      etaMinutes: delivery.etaMinutes,
      buttonText: /(^|\n|\s)(add|add item|buy now)(\s|\n|$)/i.test(raw) ? 'ADD' : '',
      productUrl: productUrlFromElement(el),
      imageUrl: imageUrlFromElement(el),
      source: `${sourceKey}_DOM_SEARCH`,
      sourceLabel,
      rawText: cleanText(raw, 520),
      cardArea: Math.round(rect.width * rect.height),
    };
  }

  const selectors = [
    '[data-testid*="product" i]',
    '[data-test-id*="product" i]',
    '[class*="product" i]',
    '[class*="Product" i]',
    '[class*="item" i]',
    '[class*="Item" i]',
    'article',
    'li',
    'section',
    'a',
    'div',
  ];
  const elements = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
  const candidates = elements
    .map(productFromElement)
    .filter(Boolean)
    .sort((a, b) => a.cardArea - b.cardArea);

  const seen = new Set();
  const products = [];
  for (const product of candidates) {
    const key = `${product.title.toLowerCase()}|${product.price}|${product.packSize}|${product.stockStatus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(product);
    if (products.length >= 40) break;
  }

  if (!products.length) {
    return {
      status: 0,
      error: `${sourceLabel} search page loaded but no price cards were detected`,
      body_preview: cleanText(document.body?.innerText || '', 360),
      data: {
        source: `${sourceKey}_DOM_SEARCH`,
        query,
        url: location.href,
        products: [],
      },
    };
  }

  return {
    status: 200,
    data: {
      source: `${sourceKey}_DOM_SEARCH`,
      query,
      url: location.href,
      products,
    },
    raw_observation: {
      transport: 'dom',
      url_path: location.pathname,
      product_count: products.length,
    },
  };
}
