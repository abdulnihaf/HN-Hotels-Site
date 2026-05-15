// content-dining.js v1.2.1
// Zomato Dining (go-out) scraper for HN Hotels — HE (22632449) and NCH (22632430).
// Injected alongside content-zomato.js on /partners/* — URL guard prevents delivery cycling.
// POSTs to /api/aggregator-pulse with platform=zomato_dining.

(function () {
  'use strict';

  const _initUrl = location.href;

  // Bail if not a dining URL (content-zomato.js has the same guard in reverse)
  if (!_initUrl.includes('/go-out/dining/')) return;

  // Extract resId from query param: ?resId=22632449 (Zomato's actual URL form)
  const resMatch = _initUrl.match(/[?&]resId=(\d+)/);
  if (!resMatch) return;

  const RES_ID = resMatch[1];
  const BRAND_MAP = { '22632449': 'he', '22632430': 'nch' };
  const brand = BRAND_MAP[RES_ID];
  if (!brand) {
    console.log(`[HN] Dining: unknown resId ${RES_ID}, skipping`);
    return;
  }

  chrome.runtime.sendMessage({ type: 'PAGE_READY', platform: 'zomato_dining' }).catch(() => {});

  const CONFIG = {
    endpoint: 'https://hnhotels.in/api/aggregator-pulse',
    apiKey: 'MzJLvqeyg__o4KX52Gu95ZGMWVLsdVVdNYdzfUJQHvA',
    hydrationMinBytes: 600,   // wait until SPA renders real content
    hydrationPollMs: 1_000,
    hydrationMaxMs: 30_000,
    readInterval: 90_000,
    pageCycleInterval: 300_000,  // 5 min per section
  };

  const sectionUrl = (path) =>
    `https://www.zomato.com/partners/go-out/dining/${path}?resId=${RES_ID}`;

  const SECTIONS = [
    { name: 'transaction_history', path: 'transactionHistory' },
    { name: 'offers',              path: 'offers' },
    { name: 'payouts',             path: 'payouts' },
  ];

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Poll until body has real content or timeout — handles Zomato React SPA slow hydration
  async function waitForContent() {
    const deadline = Date.now() + CONFIG.hydrationMaxMs;
    while (Date.now() < deadline) {
      if (document.body.innerText.length >= CONFIG.hydrationMinBytes) return;
      await sleep(CONFIG.hydrationPollMs);
    }
    console.log('[HN] Dining: hydration timeout — scraping anyway');
  }

  function currentSectionIdx() {
    const url = location.href;
    if (url.includes('transactionHistory')) return 0;
    if (url.includes('offers'))            return 1;
    if (url.includes('payouts'))           return 2;
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

  function scrape() {
    const idx = currentSectionIdx();
    const section = SECTIONS[idx].name;
    const bodyText = document.body.innerText;
    const rupees = extractRupees(bodyText);
    return {
      section,
      res_id: RES_ID,
      rupee_amounts: rupees.slice(0, 20),
      covers_count: extractFirstInt(bodyText, 'covers?'),
      bookings_count: extractFirstInt(bodyText, 'bookings?|reservations?'),
      offers_active: extractFirstInt(bodyText, 'active'),
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
          platform: 'zomato_dining',
          brand,
          outlet_id: RES_ID,
          page: data.section,
          url: location.href,
          data,
          captured_at: new Date().toISOString(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(`[HN] Dining ${brand}/${RES_ID} ${data.section}: stored=${j.stored ?? '?'}`);
    } catch (e) {
      console.warn('[HN] Dining: push error', e);
    }
  }

  function cyclePage() {
    const next = (currentSectionIdx() + 1) % SECTIONS.length;
    console.log(`[HN] Dining: → ${SECTIONS[next].name}`);
    window.location.href = sectionUrl(SECTIONS[next].path);
  }

  // Dismiss modal overlays (Mother's Day promo, etc.)
  function dismissModal() {
    const selectors = [
      '[aria-label="Close"]',
      '[class*="closeButton"]',
      '[class*="CloseButton"]',
      'button[class*="close"]',
      '[data-testid="close-button"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  async function run() {
    await waitForContent();
    if (dismissModal()) await sleep(500);

    const data = scrape();
    await push(data);

    setTimeout(cyclePage, CONFIG.pageCycleInterval);
    setInterval(async () => { await push(scrape()); }, CONFIG.readInterval);
  }

  run();
})();
