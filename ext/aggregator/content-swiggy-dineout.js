// content-swiggy-dineout.js v1.0.0
// Swiggy Dine-Out scraper for HN Hotels — Hamza Express (outlet 1372737).
// Injected alongside content-swiggy.js on partner.swiggy.com/* — URL guard prevents delivery overlap.
// POSTs to /api/aggregator-pulse with platform=swiggy_dineout.

(function () {
  'use strict';

  const _initUrl = location.href;

  // Must be a dineout URL — content-swiggy.js has the reverse guard
  if (!_initUrl.includes('/dineout/')) return;

  const OUTLET_ID = '1372737';  // HE Swiggy Dine-Out outlet ID (verified May 2026)
  const brand = 'he';

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'swiggy_dineout' }).catch(() => {});

  const CONFIG = {
    endpoint: 'https://hnhotels.in/api/aggregator-pulse',
    apiKey: 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA',
    hydrationDelay: 5_000,
    readInterval: 90_000,
    pageCycleInterval: 300_000,
  };

  const PAGES = [
    { name: 'overview',      url: 'https://partner.swiggy.com/food/dineout/' },
    { name: 'reservations',  url: 'https://partner.swiggy.com/food/dineout/reservations' },
    { name: 'payments',      url: 'https://partner.swiggy.com/food/dineout/payments' },
  ];

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function currentPageIdx() {
    const url = location.href;
    if (url.includes('/payments'))     return 2;
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
      covers_count: extractFirstInt(bodyText, 'covers?|guests?'),
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
          platform: 'swiggy_dineout',
          brand,
          outlet_id: OUTLET_ID,
          page: data.section,
          url: location.href,
          data,
          captured_at: new Date().toISOString(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(`[HN] Swiggy Dine-Out ${data.section}: stored=${j.stored ?? '?'}`);
    } catch (e) {
      console.warn('[HN] Swiggy Dine-Out: push error', e);
    }
  }

  function cyclePage() {
    const next = (currentPageIdx() + 1) % PAGES.length;
    console.log(`[HN] Swiggy Dine-Out: → ${PAGES[next].name}`);
    window.location.href = PAGES[next].url;
  }

  async function run() {
    await sleep(CONFIG.hydrationDelay);
    const data = scrape();
    await push(data);
    setTimeout(cyclePage, CONFIG.pageCycleInterval);
    setInterval(async () => { await push(scrape()); }, CONFIG.readInterval);
  }

  run();
})();
