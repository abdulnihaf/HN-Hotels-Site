const ENDPOINT = 'https://hnhotels.in/api/purchase-control';

const PORTALS = {
  HYPERPURE: {
    label: 'Hyperpure',
    startUrl: 'https://www.hyperpure.com/',
    domains: ['hyperpure.com'],
  },
  ZEPTO: {
    label: 'Zepto',
    startUrl: 'https://www.zepto.com/',
    domains: ['zepto.com', 'zeptonow.com'],
  },
  FLIPKART_MINUTES: {
    label: 'Flipkart Minutes',
    startUrl: 'https://www.flipkart.com/flipkart-minutes-store?marketplace=HYPERLOCAL',
    domains: ['flipkart.com'],
  },
  INSTAMART: {
    label: 'Instamart',
    startUrl: 'https://www.swiggy.com/stores/instamart/',
    domains: ['swiggy.com'],
  },
  BLINKIT: {
    label: 'Blinkit',
    startUrl: 'https://blinkit.com/',
    domains: ['blinkit.com'],
  },
  AMAZON_NOW: {
    label: 'Amazon Now',
    startUrl: 'https://www.amazon.in/',
    domains: ['amazon.in'],
  },
  BIGBASKET: {
    label: 'BigBasket',
    startUrl: 'https://www.bigbasket.com/',
    domains: ['bigbasket.com'],
  },
  JIOMART: {
    label: 'JioMart',
    startUrl: 'https://www.jiomart.com/',
    domains: ['jiomart.com'],
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
  if (!portal) throw new Error('Open one of the 8 purchase portals before capturing');
  if (!detected) throw new Error('Current tab is not one of the 8 purchase portals');
  if (detected !== sourceKey) throw new Error(`Current tab is ${PORTALS[detected].label}, not ${portal.label}`);

  const pageState = await readPageState(tab.id);
  const cookies = await readCookies(tab.url, portal.domains);
  const expiresAt = expiryFromCookies(cookies, Number(message.expiryHours || 6));
  const payload = {
    capture_version: '1.1.0',
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
  if (!portal) throw new Error('Choose one of the 8 purchase portals');
  if (detected !== sourceKey) throw new Error(`Open the logged-in ${portal.label} tab before running live quotes`);
  if (sourceKey !== 'HYPERPURE') throw new Error(`${portal.label} live quote runner is not wired yet`);

  const jobsUrl = `${ENDPOINT}?action=browser-quote-jobs&pin=${encodeURIComponent(pin)}&source_key=${encodeURIComponent(sourceKey)}`;
  const jobsResponse = await fetch(jobsUrl);
  const jobsData = await jobsResponse.json().catch(() => ({}));
  if (!jobsResponse.ok) throw new Error(jobsData.error || `Quote jobs failed (${jobsResponse.status})`);

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

  const results = [];
  for (const job of jobs.slice(0, 20)) {
    const result = await runHyperpureSearch(tab.id, job.query || job.name);
    results.push({
      cart_id: job.cart_id,
      query: job.query || job.name,
      ...result,
    });
  }

  const ingestResponse = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'ingest-browser-search-results',
      pin,
      source_key: sourceKey,
      batch_id: jobsData.batch?.id,
      results,
    }),
  });
  const ingestData = await ingestResponse.json().catch(() => ({}));
  if (!ingestResponse.ok) throw new Error(ingestData.error || `Quote ingest failed (${ingestResponse.status})`);

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
  return result?.result || { error: 'No browser search result returned' };
}

async function hyperpureNativeSearchInPage(query) {
  const observed = [];
  const startedAt = Date.now();
  const originalFetch = window.fetch;
  const originalOpen = window.XMLHttpRequest?.prototype?.open;
  const originalSend = window.XMLHttpRequest?.prototype?.send;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  function compactText(value, limit = 320) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}...[truncated:${text.length}]` : text;
  }

  function isRelevant(url, body) {
    const haystack = `${url || ''} ${body || ''}`.toLowerCase();
    const normalizedQuery = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (haystack.includes('search')) return true;
    return normalizedQuery.some((part) => part.length > 3 && haystack.includes(part));
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
    driveInput(input);

    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const successful = observed.find((entry) => entry.ok && entry.data);
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

    const last = observed[observed.length - 1];
    if (last) {
      return {
        status: last.status || 0,
        data: last.data || null,
        body_preview: last.body_preview || '',
        raw_observation: {
          transport: last.transport,
          observed_count: observed.length,
          last_status: last.status || 0,
        },
      };
    }
    return { error: 'Hyperpure did not issue a visible search request after typing into its search box' };
  } catch (error) {
    return { error: error.message || 'Hyperpure native UI search failed' };
  } finally {
    restore();
  }
}
