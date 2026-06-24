// content-eazydiner.js v1.0.4
// EazyDiner / LiveTable scraper for HN Hotels — Hamza Express only (HE contract signed Mar 2026).
// Injected on: https://apps.livetableapp.com/*
// Requires manual login via India +91 OTP once — session persists for ongoing scraping.
// POSTs to /api/aggregator-pulse with platform=eazydiner.
//
// v1.0.2 (2026-05-12): isLoginPage() is now URL-only. v1.0.1 tightened the body-text regex
//   but it still false-positived — the LiveTable dashboard has a customer-add form with
//   "Enter Mobile Number" label that matched. Verified via UIA tab-probe: dashboard URL
//   is apps.livetableapp.com/dashboard, title "LiveTable - Powered by EazyDiner". URL path
//   is the only reliable signal LiveTable provides; when session dies, URL changes to /login
//   or /auth. Body-text matching is too risky on a dashboard that contains many phone labels.
//
// v1.0.1 (2026-05-12): Tightened body-text regex — necessary improvement but did NOT fully
//   fix the false-positive ("Enter Mobile Number" in customer-add form still slipped through).

(function () {
  'use strict';

  const OUTLET_ID = '712958';  // EazyDiner Rest. ID for Hamza Express (verified May 2026)
  const brand = 'he';

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'eazydiner' }).catch(() => {});

  // v1.0.3 DEBUG: fire a heartbeat POST IMMEDIATELY on script load, before any guard.
  // If this arrives at /api/aggregator-pulse, we know content-eazydiner.js is being
  // injected and can reach the API. If absent, the content-script isn't running at all.
  fetch('https://hnhotels.in/api/aggregator-pulse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA' },
    body: JSON.stringify({
      source: 'content_script',
      platform: 'eazydiner',
      brand: 'he',
      outlet_id: '712958',
      page: '_script_load_heartbeat',
      url: location.href,
      data: { v: '1.0.3', loaded_at: new Date().toISOString(), pathname: location.pathname, body_len: (document.body && document.body.innerText) ? document.body.innerText.length : -1 },
      captured_at: new Date().toISOString(),
    }),
  }).then(r => console.log('[HN] EazyDiner heartbeat:', r.status)).catch(e => console.warn('[HN] EazyDiner heartbeat err:', e));

  const CONFIG = {
    endpoint: 'https://hnhotels.in/api/aggregator-pulse',
    apiKey: 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA',
    hydrationDelay: 6_000,
    readInterval: 120_000,   // 2 min reads
    pageCycleInterval: 600_000, // 10 min per page
  };

  // Known LiveTable sections — adapt if portal changes structure
  const PAGES = [
    { name: 'dashboard',     url: 'https://apps.livetableapp.com/dashboard' },
    { name: 'reservations',  url: 'https://apps.livetableapp.com/reservations' },
    { name: 'reports',       url: 'https://apps.livetableapp.com/reports' },
  ];

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isLoginPage() {
    // URL-only check. LiveTable redirects to /login | /signin | /auth when session is dead.
    // Don't body-match — dashboards contain phone-related labels that false-positive.
    const path = location.pathname.toLowerCase();
    return /^\/(login|signin|sign-in|auth|verify)(\/|$)/.test(path);
  }

  function currentPageIdx() {
    const url = location.href;
    if (url.includes('/reports'))      return 2;
    if (url.includes('/reservations')) return 1;
    return 0;
  }

  function extractRupees(text) {
    return [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')));
  }

  function extractFirstInt(text, label) {
    const re = new RegExp(`(\\d[\\d,]*)\\s*${label}`, 'i');
    const m = text.match(re);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function scrape() {
    const idx = currentPageIdx();
    const section = PAGES[idx].name;
    const bodyText = document.body.innerText;
    const rupees = extractRupees(bodyText);
    return {
      section,
      outlet_id: OUTLET_ID,
      rupee_amounts: rupees.slice(0, 20),
      reservations_count: extractFirstInt(bodyText, 'reservations?|bookings?'),
      covers_count: extractFirstInt(bodyText, 'covers?|guests?|pax'),
      no_show_count: extractFirstInt(bodyText, 'no.?shows?'),
      body_len: bodyText.length,
      raw_snippet: bodyText.slice(0, 2000),
    };
  }

  async function push(data) {
    try {
      const res = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey },
        body: JSON.stringify({
          source: 'content_script',
          platform: 'eazydiner',
          brand,
          outlet_id: OUTLET_ID,
          page: data.section,
          url: location.href,
          data,
          captured_at: new Date().toISOString(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(`[HN] EazyDiner ${data.section}: stored=${j.stored ?? '?'}`);
    } catch (e) {
      console.warn('[HN] EazyDiner: push error', e);
    }
  }

  function cyclePage() {
    const next = (currentPageIdx() + 1) % PAGES.length;
    const nextUrl = PAGES[next].url;
    // Safety: only navigate to our known pages
    if (!nextUrl.startsWith('https://apps.livetableapp.com/')) return;
    console.log(`[HN] EazyDiner: → ${PAGES[next].name}`);
    window.location.href = nextUrl;
  }

  // v1.0.4 DEBUG: trace breadcrumbs via API posts so we can see which step succeeds.
  function trace(stage, extra) {
    return fetch('https://hnhotels.in/api/aggregator-pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA' },
      body: JSON.stringify({
        source: 'content_script',
        platform: 'eazydiner',
        brand: 'he',
        outlet_id: '712958',
        page: '_trace_' + stage,
        url: location.href,
        data: { v: '1.0.4', stage: stage, extra: extra || null, at: new Date().toISOString() },
        captured_at: new Date().toISOString(),
      }),
    }).catch(()=>{});
  }

  async function run() {
    await trace('run_enter');
    try {
      await sleep(CONFIG.hydrationDelay);
      await trace('after_sleep');

      if (isLoginPage()) {
        await trace('isLoginPage_true', { path: location.pathname });
        chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'eazydiner' }).catch(() => {});
        return;
      }
      await trace('isLoginPage_false', { path: location.pathname });

      let data;
      try {
        data = scrape();
        await trace('after_scrape', { bodylen: data.body_len, section: data.section });
      } catch (e) {
        await trace('scrape_error', { err: e.message, stack: (e.stack||'').slice(0, 400) });
        throw e;
      }

      try {
        await push(data);
        await trace('after_push');
      } catch (e) {
        await trace('push_error', { err: e.message });
        throw e;
      }

      setTimeout(cyclePage, CONFIG.pageCycleInterval);
      setInterval(async () => {
        if (!isLoginPage()) await push(scrape());
      }, CONFIG.readInterval);
      await trace('intervals_set');
    } catch (e) {
      await trace('run_error', { err: e.message, stack: (e.stack||'').slice(0, 400) });
    }
  }

  run();
})();
