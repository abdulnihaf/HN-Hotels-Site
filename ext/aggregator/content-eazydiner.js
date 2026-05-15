// content-eazydiner.js v1.0.6
// EazyDiner / LiveTable scraper for HN Hotels — Hamza Express only (HE contract signed Mar 2026).
// Injected on: https://apps.livetableapp.com/*
// Requires manual login via India +91 OTP once — session persists for ongoing scraping.
// POSTs to /api/aggregator-pulse with platform=eazydiner.

(function () {
  'use strict';

  const OUTLET_ID = '712958';  // EazyDiner Rest. ID for Hamza Express (verified May 2026)
  const brand = 'he';

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'eazydiner' }).catch(() => {});

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
    return /\/(login|signin|sign-in|auth|otp)\b/i.test(location.pathname);
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
    const re = new RegExp(`(\\d[\\d,]*)\\s*(?:${label})`, 'i');
    const m = text.match(re);
    return m?.[1] ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function firstIntNear(text, anchorPattern, valuePattern) {
    const anchor = text.search(anchorPattern);
    if (anchor < 0) return null;
    const segment = text.slice(anchor, anchor + 260);
    const m = segment.match(valuePattern);
    return m?.[1] ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function firstRupeeNear(text, anchorPattern) {
    const anchor = text.search(anchorPattern);
    if (anchor < 0) return null;
    const segment = text.slice(anchor, anchor + 260);
    const amounts = extractRupees(segment);
    return amounts.length ? amounts[0] : null;
  }

  function scrape() {
    const idx = currentPageIdx();
    const section = PAGES[idx].name;
    const bodyText = document.body.innerText;
    const rupees = extractRupees(bodyText);
    const reservations = firstIntNear(bodyText, /total\s+reservations/i, /(\d[\d,]*)\s*(?:reservations?|bookings?)/i)
      ?? extractFirstInt(bodyText, 'reservations?|bookings?');
    const covers = firstIntNear(bodyText, /total\s+guests?|diners?/i, /(\d[\d,]*)\s*(?:diners?|guests?|covers?|pax)/i)
      ?? extractFirstInt(bodyText, 'covers?|guests?|diners?|pax');
    return {
      section,
      outlet_id: OUTLET_ID,
      rupee_amounts: rupees.slice(0, 20),
      reservations_count: reservations,
      covers_count: covers,
      no_show_count: extractFirstInt(bodyText, 'no.?shows?'),
      payeazy_revenue: firstRupeeNear(bodyText, /payeazy\s+revenue/i),
      projected_revenue: firstRupeeNear(bodyText, /projected\s+revenue/i),
      revenue_summary_mtd: firstRupeeNear(bodyText, /revenue\s+summary/i),
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

  async function run() {
    await sleep(CONFIG.hydrationDelay);

    if (isLoginPage()) {
      console.log('[HN] EazyDiner: login page — manual OTP needed');
      chrome.runtime.sendMessage({ type: 'LOGIN_DETECTED', platform: 'eazydiner' }).catch(() => {});
      return;
    }

    const data = scrape();
    await push(data);
    setTimeout(cyclePage, CONFIG.pageCycleInterval);
    setInterval(async () => {
      if (!isLoginPage()) await push(scrape());
    }, CONFIG.readInterval);
  }

  run().catch(e => console.warn('[HN] EazyDiner: run error', e));
})();
