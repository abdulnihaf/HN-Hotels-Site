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
