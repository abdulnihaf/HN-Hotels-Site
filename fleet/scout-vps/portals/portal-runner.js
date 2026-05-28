// One headless Chromium for the whole service. Per-request contexts
// (BrowserContext) seeded with the latest captured portal session pulled
// from hnhotels.in. Statless contexts (created + closed per scout) so a
// renewed cookie from the Mac extension is picked up immediately.

import { chromium } from 'playwright';
import { getSession, applySessionToContext, summariseSession } from './session-bridge.js';
import { errorQuote, emptyQuote } from './utils.js';

import { scoutHyperpure } from './portals/hyperpure.js';
import * as bigbasketMod from './portals/bigbasket.js';
import { scoutJioMart } from './portals/jiomart.js';
import { scoutBlinkit } from './portals/blinkit.js';
import { scoutFlipkartMinutes } from './portals/flipkart_minutes.js';
// Wiring these three was missing — adapter files existed on disk but
// were never imported into the ADAPTERS table, so every scout call for
// AMAZON_NOW / ZEPTO returned NO_ADAPTER silently since they were added
// to DEFAULT_SOURCES in PR #250. The 111 captured Amazon Now URLs in
// the snapshot are stale (from a pre-orphan-bug run on a prior config).
import * as amazonNowMod from './portals/amazon_now.js';
import * as amazonFreshMod from './portals/amazon_fresh.js';
import { scoutZepto } from './portals/zepto.js';

const HEADLESS = process.env.SCOUT_HEADLESS !== 'false';
const NAV_TIMEOUT_MS = Number(process.env.SCOUT_NAV_TIMEOUT_MS || 25000);

// Adapters can be either:
//   - a function (Playwright mode — called with {page, ctx})
//   - { fn, direct: true } (direct HTTP mode — called with {session, ctx},
//     no Playwright context or page created)
// Direct mode is for portals where Akamai blocks Chromium fingerprint but
// accepts plain HTTPS through the residential proxy (BigBasket, eventually
// Blinkit + JioMart once their adapters are rewritten the same way).
const ADAPTERS = {
  HYPERPURE: scoutHyperpure,
  BIGBASKET: { fn: bigbasketMod.scoutBigBasket, direct: bigbasketMod.direct === true },
  JIOMART: scoutJioMart,
  BLINKIT: scoutBlinkit,
  FLIPKART_MINUTES: scoutFlipkartMinutes,
  // Newly wired 2026-05-29 — files existed but were orphaned from the
  // dispatcher table. Now-direct, Fresh-direct (DataImpulse proxy).
  AMAZON_NOW: { fn: amazonNowMod.scoutAmazonNow, direct: amazonNowMod.direct === true },
  AMAZON_FRESH: { fn: amazonFreshMod.scoutAmazonFresh, direct: amazonFreshMod.direct === true },
  ZEPTO: scoutZepto,
};

function isDirectAdapter(adapter) {
  return adapter && typeof adapter === 'object' && adapter.direct === true && typeof adapter.fn === 'function';
}

// Portals that get blocked by Akamai / portal-bot management from the VPS
// datacenter IP. Route these through the DataImpulse residential proxy.
// Hyperpure (B2B, light security) and Flipkart Minutes (works direct) stay
// off the proxy to preserve DataImpulse bandwidth.
const PROXY_PORTALS = new Set(['BIGBASKET', 'BLINKIT', 'JIOMART']);

function getProxyConfig() {
  const raw = process.env.DATAIMPULSE_PROXY_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.hostname}:${u.port}`,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch (_) {
    return null;
  }
}

const proxyConfig = getProxyConfig();

let browserPromise = null;

export async function getOrCreateBrowser({ peek = false } = {}) {
  if (browserPromise) return browserPromise;
  if (peek) return null;
  browserPromise = chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  return browserPromise;
}

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function newScoutContext(browser, session, sourceKey) {
  const ua = (session && session.user_agent) || DEFAULT_UA;
  const opts = {
    userAgent: ua,
    viewport: { width: 1366, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  };
  if (proxyConfig && PROXY_PORTALS.has(sourceKey)) {
    opts.proxy = proxyConfig;
  }
  const context = await browser.newContext(opts);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(NAV_TIMEOUT_MS);
  return context;
}

export async function runPortal(sourceKey, materialCtx) {
  const adapter = ADAPTERS[sourceKey];
  const direct = isDirectAdapter(adapter);
  if (!direct && typeof adapter !== 'function') {
    return errorQuote(`No adapter wired for ${sourceKey}`, { source: sourceKey });
  }

  let session = null;
  try {
    session = await getSession(sourceKey);
  } catch (err) {
    return emptyQuote(`Session export failed: ${err.message}`, { source: sourceKey, stage: 'session_fetch' });
  }

  if (!session || !session.ready) {
    return emptyQuote(
      session?.error || `${sourceKey} session not captured or expired — reconnect from Chrome extension`,
      { source: sourceKey, session: summariseSession(session) }
    );
  }

  // Direct HTTP mode — no Playwright. Adapter fetches through proxy itself.
  if (direct) {
    try {
      const result = await adapter.fn({ session, ctx: materialCtx });
      if (result?.raw) {
        result.raw.captured_at = session.captured_at;
        result.raw.proxy_used = true;
        result.raw.mode = 'direct';
      }
      return result;
    } catch (err) {
      return errorQuote(`Direct adapter threw: ${err.message}`, { source: sourceKey, stage: 'direct_run' });
    }
  }

  // Playwright mode — full browser context with session injection.
  const browser = await getOrCreateBrowser();
  const context = await newScoutContext(browser, session, sourceKey);
  let applied = { applied: false };
  try {
    applied = await applySessionToContext(context, session);
  } catch (err) {
    await context.close().catch(() => {});
    return errorQuote(`Session injection failed: ${err.message}`, { source: sourceKey, stage: 'session_inject' });
  }

  const page = await context.newPage();
  try {
    const result = await adapter({ page, ctx: materialCtx });
    if (result?.raw) {
      result.raw.session_applied = applied;
      result.raw.captured_at = session.captured_at;
      result.raw.proxy_used = !!(proxyConfig && PROXY_PORTALS.has(sourceKey));
      result.raw.mode = 'playwright';
    }
    return result;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  const browser = await (browserPromise ? browserPromise.catch(() => null) : null);
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
  browserPromise = null;
}
