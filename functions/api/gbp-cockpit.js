// HN Hotels — Google Business Profile Cockpit API
// GET /api/gbp-cockpit?brand=he|nch&period=7d|28d|90d&compare=prior|yoy|off
//   &include=summary,daily,keywords,profile,reviews,health,media,qanda,actionQueue,algorithmTips,organicIntelligence
//
// Default include set covers the operations layer: summary,daily,keywords,
// profile,reviews,health,media,qanda,actionQueue,algorithmTips
// organicIntelligence is opt-in because competitor scans use billable Places
// Text Search calls.
//
// Powers the dual-brand organic dashboards at:
//   - hnhotels.in/marketing/he/gbp/
//   - hnhotels.in/marketing/nch/gbp/
//
// Brand identifiers are hardcoded against the canonical IDs captured in
// HN-Hotels-Asset-Database.xlsx on 2026-05-05 (verified against the API,
// resolved by Place ID match — never by title-substring, since a stale
// "Hamza Hotel" listing exists under the same Google account).
//
// Required Cloudflare Pages secrets (set via wrangler pages secret put):
//   - GOOGLE_ADS_CLIENT_ID            (NCH Marketing Web OAuth client)
//   - GOOGLE_ADS_CLIENT_SECRET
//   - GOOGLE_ORGANIC_REFRESH_TOKEN    (scopes: adwords + webmasters.readonly + business.manage)
//   - GOOGLE_PLACES_API_KEY           (Places API for review aggregates — no OAuth needed)
//
// All response data is read-only. Write surfaces (post composer, hours editor,
// review reply) deep-link to https://business.google.com — review reply is
// managed via that channel by design and not surfaced in this cockpit.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const BRANDS = {
  he: {
    account:  'accounts/112047111046090890635',
    location: 'locations/9588185230705816056',
    placeId:  'ChIJ-QQjtHEXrjsR-Z1RIEm2arg',
    title:    'Hamza Express',
    slug:     'hamza-express',
    domain:   'hamzaexpress.in',
    siteUrl:  'sc-domain:hamzaexpress.in',
    other:    'nch',
    center:   { lat: 12.98475, lng: 77.60291 },
    menuUrls: ['https://hamzaexpress.in/menu/', 'https://hamzaexpress.in/menu'],
    competitorQueries: [
      'Hamza Hotel HKP Road Shivajinagar Bengaluru',
      'Empire Restaurant Shivajinagar Bengaluru',
      'Valima Ki Biryani Shivajinagar Bengaluru',
      'New Hilal Restaurant Shivajinagar Bengaluru',
      'New Royal Restaurant Shivajinagar Bengaluru',
      'Persian Majlis Shivajinagar Bengaluru',
      'Prince Restaurant Shivajinagar Bengaluru',
    ],
  },
  nch: {
    account:  'accounts/112047111046090890635',
    location: 'locations/16572235710389279793',
    placeId:  'ChIJq-hENv8XrjsRCjNPpTGIogY',
    title:    'Nawabi Chai House',
    slug:     'nawabi-chai-house',
    domain:   'nawabichaihouse.com',
    siteUrl:  'sc-domain:nawabichaihouse.com',
    other:    'he',
    center:   { lat: 12.98475, lng: 77.60291 },
    menuUrls: ['https://nawabichaihouse.com/menu/', 'https://nawabichaihouse.com/menu'],
    competitorQueries: [
      'Nawabi Chai House Shivajinagar Bengaluru',
      'Irani chai Shivajinagar Bengaluru',
      'tea cafe Shivajinagar Bengaluru',
      'haleem Shivajinagar Bengaluru',
      'Empire Restaurant Shivajinagar Bengaluru',
    ],
  },
};

const DEFAULT_INCLUDE = 'summary,daily,keywords,profile,reviews,health,media,qanda,actionQueue,algorithmTips';

const PERSONA_BUCKETS = {
  he: [
    {
      id: 'brand_loyalist',
      label: 'Hamza brand / loyalist',
      persona: 'legacy_hamza_loyalist',
      intent: 'Already has Hamza/HKP Road memory; organic job is to prove this is the same food memory in the Express outlet.',
      patterns: ['hamza', 'hamza hotel', 'hamza express', 'hkp'],
      ownerRead: 'High-conversion. Protect with correct listing, reviews, photos, and paid branded coverage when needed.',
    },
    {
      id: 'late_night',
      label: 'Late-night heavy eater',
      persona: 'late_night_heavy_non_veg',
      intent: 'Open-now, nearby, serious non-veg food decision between 8 PM and 3 AM.',
      patterns: ['late night', 'open now', 'open', 'night', 'near me', '3am', '2am', 'kabab', 'biryani', 'ghee rice', 'non veg'],
      ownerRead: 'Highest Maps/Search surgical layer. Needs hours, night photos, dishes, and ad schedule alignment.',
    },
    {
      id: 'dish_nonveg',
      label: 'Dish-led non-veg seeker',
      persona: 'dish_nonveg_seeker',
      intent: 'Search starts from the dish, not the brand.',
      patterns: ['biryani', 'ghee rice', 'kabab', 'kebab', 'tandoori', 'mutton', 'chicken', 'brain', 'naan', 'grill', 'hyderabadi', 'mughlai'],
      ownerRead: 'Profile category, menu, photos, and reviews must repeat the hero dishes.',
    },
    {
      id: 'local_explorer',
      label: 'Shivajinagar food explorer',
      persona: 'shivajinagar_food_explorer',
      intent: 'Visitor around Commercial Street/MG Road/Shivajinagar choosing a real food stop.',
      patterns: ['shivajinagar', 'commercial street', 'mg road', 'russell market', 'infantry road', 'best', 'food near'],
      ownerRead: 'Needs exterior/HKP proof, directions, reviews, and local heritage signal.',
    },
    {
      id: 'family_diner',
      label: 'Family comfort diner',
      persona: 'family_comfort_diner',
      intent: 'Family wants safe seating, halal/non-veg comfort, and clean restaurant proof.',
      patterns: ['family', 'seating', 'dine', 'restaurant', 'dinner', 'lunch'],
      ownerRead: 'Needs interior seating, table spread, family-safe review language.',
    },
    {
      id: 'parcel_pickup',
      label: 'Fast parcel / pickup',
      persona: 'fast_parcel_pickup',
      intent: 'Local worker/shop owner wants phone, menu, directions, or quick takeaway.',
      patterns: ['parcel', 'takeaway', 'take away', 'pickup', 'menu', 'phone', 'contact', 'order'],
      ownerRead: 'Needs menu health, phone accuracy, parcel counter proof, quick directions.',
    },
    {
      id: 'halal_muslim_quarter',
      label: 'Halal / Muslim-quarter filter',
      persona: 'halal_local_filter',
      intent: 'Customer filters by halal, Muslim-area trust, Dakhni/Hyderabadi food.',
      patterns: ['halal', 'muslim', 'dakhni', 'hyderabadi', 'mughlai', 'non veg'],
      ownerRead: 'Needs Halal category, description coverage, and review/photo proof.',
    },
  ],
  nch: [
    {
      id: 'irani_chai',
      label: 'Irani chai seeker',
      persona: 'irani_chai_core',
      intent: 'Direct chai/snack search around Shivajinagar.',
      patterns: ['irani chai', 'chai', 'tea', 'osmania'],
      ownerRead: 'Keep chai identity and freshness proof visible.',
    },
    {
      id: 'haleem',
      label: 'Haleem seeker',
      persona: 'haleem_demand',
      intent: 'Food-led search for haleem/snack heavy item.',
      patterns: ['haleem', 'mutton', 'chicken'],
      ownerRead: 'Seasonal posts/photos and menu proof matter.',
    },
    {
      id: 'local_explorer',
      label: 'Shivajinagar cafe explorer',
      persona: 'local_explorer',
      intent: 'Nearby cafe/snack decision.',
      patterns: ['shivajinagar', 'near me', 'cafe', 'snacks', 'commercial street'],
      ownerRead: 'Maps freshness and review language matter.',
    },
  ],
};

// All daily metrics published by the GBP Performance API. Note the prefix
// inconsistency: BUSINESS_* on most, but CALL_CLICKS and WEBSITE_CLICKS are
// unprefixed (legacy enum). Verified 2026-05-05 — using prefixed forms for
// these two returns 400 INVALID_ARGUMENT.
const METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
];

const ACTION_METRICS = [
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'WEBSITE_CLICKS',
  'BUSINESS_FOOD_MENU_CLICKS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_CONVERSATIONS',
];

const IMPRESSION_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const brandKey = (url.searchParams.get('brand') || '').toLowerCase();
  const brand = BRANDS[brandKey];
  if (!brand) {
    return json({ ok: false, error: 'brand must be one of: he, nch' }, 400);
  }

  const periodKey = url.searchParams.get('period') || '7d';
  const compareMode = url.searchParams.get('compare') || 'prior';
  // Custom date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides period=
  // Both must be valid ISO dates within the GBP Performance API window
  // (~18 months back, T-2 days forward). Caller-side validation in UI.
  const customFrom = url.searchParams.get('from');
  const customTo   = url.searchParams.get('to');
  const include = (url.searchParams.get('include') || DEFAULT_INCLUDE)
    .split(',').map(s => s.trim()).filter(Boolean);
  const wantsOrganic = include.includes('organicIntelligence');

  // GBP Performance API data lags 1-2 days. Use today-2 as endDate to ensure data exists.
  const period = resolvePeriod(periodKey, compareMode, customFrom, customTo);

  try {
    const token = await getAccessToken(env);

    const tasks = {};
    if (include.includes('summary') || include.includes('daily') || wantsOrganic) {
      tasks.perf = fetchPerformance(token, brand.location, period.startDate, period.endDate);
      if (compareMode !== 'off') {
        tasks.perfPrior = fetchPerformance(token, brand.location, period.compareStart, period.compareEnd);
      }
    }
    if (include.includes('keywords') || wantsOrganic) {
      tasks.kwThis = fetchKeywords(token, brand.location, period.thisMonth);
      tasks.kwPrev = fetchKeywords(token, brand.location, period.lastMonth);
    }
    if (include.includes('profile') || include.includes('health') ||
        include.includes('actionQueue') || include.includes('algorithmTips') || wantsOrganic) {
      tasks.profile = fetchProfile(token, brand.location);
    }
    if (include.includes('reviews') || include.includes('profile') || include.includes('actionQueue') || wantsOrganic) {
      tasks.places = fetchPlaceDetails(env, brand.placeId);
    }
    if (include.includes('media') || include.includes('actionQueue') || wantsOrganic) {
      tasks.media = fetchMedia(token, brand.location);
    }
    if (include.includes('qanda') || include.includes('actionQueue') || wantsOrganic) {
      tasks.qanda = fetchQandA(token, brand.location);
    }
    if (wantsOrganic) {
      tasks.searchConsole = fetchSearchConsole(token, brand.siteUrl, period.startDate, period.endDate);
      tasks.menuHealth = fetchMenuHealth(brand);
      tasks.competitors = fetchCompetitorBenchmark(env, brand);
    }

    const results = await runAll(tasks);

    // Build response
    const out = {
      ok: true,
      brand: brandKey,
      brandTitle: brand.title,
      otherBrand: brand.other,
      asOf: nowIstIso(),
      freshness: {
        performance: 'T-2 days (GBP API lag)',
        places: 'live',
        profile: 'live',
        keywords: 'monthly bucket',
      },
      location: {
        title: brand.title,
        placeId: brand.placeId,
        locationName: brand.location,
        domain: brand.domain,
        mapsUri: `https://www.google.com/maps/place/?q=place_id:${brand.placeId}`,
        manageUri: `https://business.google.com/n/${brand.location.split('/')[1]}`,
      },
      period: {
        label: period.label,
        isCustom: period.isCustom || false,
        days: period.days,
        startDate: period.startDate,
        endDate: period.endDate,
        compareStart: period.compareStart,
        compareEnd: period.compareEnd,
        compareMode,
      },
    };

    if (results.perf && !results.perf.error) {
      out.summary = buildSummary(results.perf, results.perfPrior);
      if (include.includes('daily')) out.daily = buildDaily(results.perf);
    } else if (results.perf?.error) {
      out.performanceError = results.perf.error;
    }
    if (results.kwThis !== undefined) {
      out.keywords = buildKeywords(results.kwThis, results.kwPrev);
      // Expose the month-buckets used so the UI can render month names and
      // show an accurate "May not finalized — showing April" fallback banner.
      out.keywords.thisMonthMeta = { year: period.thisMonth.y, month: period.thisMonth.m };
      out.keywords.lastMonthMeta = { year: period.lastMonth.y, month: period.lastMonth.m };
    }
    if (results.profile !== undefined) {
      out.profile = buildProfile(results.profile);
    }
    if (results.places !== undefined) {
      out.reviews = buildReviewsAggregate(results.places);
      // Enrich profile with Place Details fallbacks if profile fetch failed
      if (out.profile && results.places.value) {
        out.profile.placeDetails = {
          openNow:    results.places.value?.regularOpeningHours?.openNow ?? null,
          rating:     results.places.value?.rating ?? null,
          userRatingCount: results.places.value?.userRatingCount ?? null,
          priceLevel: results.places.value?.priceLevel ?? null,
        };
      }
    }
    if (include.includes('health')) {
      out.health = buildHealth(results.profile, results.places, results.perf);
    }
    if (results.media !== undefined) {
      out.media = buildMedia(results.media);
    }
    if (results.qanda !== undefined) {
      out.qanda = buildQandA(results.qanda);
    }
    if (include.includes('actionQueue')) {
      out.actionQueue = buildActionQueue({
        profile: results.profile,        // raw, for hours periods (not transformed)
        builtProfile: out.profile,        // transformed (additionalCategories as strings)
        perf: results.perf,
        perfPrior: results.perfPrior,
        places: results.places,
        media: out.media,                 // built shape with total/recent30d
        qanda: out.qanda,                 // built shape (or { error })
        summary: out.summary,
      });
    }
    if (include.includes('algorithmTips')) {
      out.algorithmTips = buildAlgorithmTips({
        brand: brandKey,
        profile: results.profile,         // raw, for description/categories.primaryCategory
        builtProfile: out.profile,        // built (additionalCategories as strings)
        media: out.media,
        qanda: out.qanda,
      });
    }
    if (wantsOrganic) {
      out.organicIntelligence = buildOrganicIntelligence({
        brandKey,
        brand,
        period: out.period,
        include,
        results,
        summary: out.summary,
        keywords: out.keywords,
        profile: out.profile,
        reviews: out.reviews,
        media: out.media,
        qanda: out.qanda,
        actionQueue: out.actionQueue || [],
      });
    }

    return json(out, 200);
  } catch (err) {
    return json({ ok: false, error: err.message, stack: env.DEBUG ? err.stack : undefined }, 500);
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────────
async function getAccessToken(env) {
  const required = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ORGANIC_REFRESH_TOKEN'];
  for (const k of required) {
    if (!env[k]) throw new Error(`Missing secret ${k} on this Cloudflare Pages project`);
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ORGANIC_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`OAuth failed: ${JSON.stringify(d).slice(0, 200)}`);
  return d.access_token;
}

// ─── Performance API ──────────────────────────────────────────────────────
async function fetchPerformance(token, locationName, startDate, endDate) {
  const params =
    METRICS.map(m => `dailyMetrics=${m}`).join('&') +
    `&dailyRange.startDate.year=${startDate.y}&dailyRange.startDate.month=${startDate.m}&dailyRange.startDate.day=${startDate.d}` +
    `&dailyRange.endDate.year=${endDate.y}&dailyRange.endDate.month=${endDate.m}&dailyRange.endDate.day=${endDate.d}`;
  const r = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Performance API ${r.status}: ${d.error?.message || 'unknown'}`);

  // Flatten into { metric: [{date, value}] } and totals { metric: sum }
  const series = {};
  const totals = {};
  for (const m of METRICS) { series[m] = []; totals[m] = 0; }
  for (const block of (d.multiDailyMetricTimeSeries || [])) {
    for (const ts of (block.dailyMetricTimeSeries || [])) {
      const metric = ts.dailyMetric;
      if (!series[metric]) { series[metric] = []; totals[metric] = 0; }
      for (const dv of (ts.timeSeries?.datedValues || [])) {
        const date = `${dv.date.year}-${String(dv.date.month).padStart(2,'0')}-${String(dv.date.day).padStart(2,'0')}`;
        const val = parseInt(dv.value || 0);
        series[metric].push({ date, value: val });
        totals[metric] += val;
      }
    }
  }
  return { series, totals };
}

// ─── Search Keywords ──────────────────────────────────────────────────────
async function fetchKeywords(token, locationName, ym) {
  const params =
    `monthlyRange.startMonth.year=${ym.y}&monthlyRange.startMonth.month=${ym.m}` +
    `&monthlyRange.endMonth.year=${ym.y}&monthlyRange.endMonth.month=${ym.m}`;
  const r = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/${locationName}/searchkeywords/impressions/monthly?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!r.ok) {
    // Keywords are non-critical — return empty array on failure rather than killing the whole response
    return { error: d.error?.message || `HTTP ${r.status}`, keywords: [] };
  }
  const rows = (d.searchKeywordsCounts || []).map(row => {
    const kw = row.searchKeyword || '';
    const lower = parseInt(row.insightsValue?.threshold || 0);
    const exact = parseInt(row.insightsValue?.value || 0);
    const impr = exact || lower;
    return {
      keyword: kw,
      impressions: impr,
      isThreshold: !exact && !!lower, // true means "less than X"
      bucket: bucketOf(impr),
    };
  }).sort((a, b) => b.impressions - a.impressions);
  return { keywords: rows };
}

function bucketOf(n) {
  if (n >= 100) return '100+';
  if (n >= 50)  return '50-100';
  if (n >= 10)  return '10-50';
  if (n > 0)    return 'low';
  return '0';
}

// ─── Business Information API ────────────────────────────────────────────
async function fetchProfile(token, locationName) {
  // Request whole sub-objects rather than nested-path cherry-picks. The API
  // silently returns an empty body for the GET /v1/locations/{id} endpoint
  // when too many nested paths are specified — verified 2026-05-05 live.
  // Whole-object readMask returns the data correctly.
  const readMask = [
    'name', 'title', 'storeCode',
    'categories', 'phoneNumbers',
    'websiteUri',
    'regularHours', 'specialHours',
    'profile',
    'openInfo',
    'metadata',
    'labels',
    'latlng',
  ].join(',');
  const r = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=${encodeURIComponent(readMask)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Business Information API ${r.status}: ${d.error?.message || 'unknown'}`);
  return d;
}

// ─── Media (photos) via Business Information API ─────────────────────────
// Returns up to ~100 most-recent media items (photos + videos). Each has
// mediaFormat (PHOTO/VIDEO), category (COVER/PROFILE/INTERIOR/EXTERIOR/etc),
// createTime, and dimensions. Owner-uploaded only (createSource=MERCHANT).
async function fetchMedia(token, locationName) {
  // mybusinessbusinessinformation doesn't expose media — that lives on the
  // legacy mybusiness/v4 endpoint, which is still active for this resource.
  const r = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName.replace('locations/', 'accounts/-/locations/')}/media?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!r.ok) return { error: `Media API ${r.status}: ${d.error?.message || 'unknown'}`, items: [] };
  return { items: d.mediaItems || [] };
}

// ─── Q&A via My Business Q&A API ─────────────────────────────────────────
// NOTE: As of 2024 the My Business Q&A API has been retired by Google.
// Returns a structured "deprecated" response so the UI can show a friendly
// message instead of an error. Q&A still exists on the listing — but it
// can only be managed via the Google Maps app (mobile) and the Business
// Profile UI on desktop. No public API access remains.
async function fetchQandA(token, locationName) {
  const r = await fetch(
    `https://mybusinessqanda.googleapis.com/v1/${locationName}/questions?pageSize=50&answersPerQuestion=2`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (r.status === 501 || (d.error?.message || '').match(/no longer supported/i)) {
    return { deprecated: true, items: [] };
  }
  if (!r.ok) return { error: `Q&A API ${r.status}: ${d.error?.message || 'unknown'}`, items: [] };
  return { items: d.questions || [] };
}

// ─── Places API (New) — review aggregate, no OAuth needed ────────────────
async function fetchPlaceDetails(env, placeId) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    return { error: 'GOOGLE_PLACES_API_KEY not set' };
  }
  const fieldMask = [
    'displayName','rating','userRatingCount','priceLevel',
    'regularOpeningHours.openNow','currentOpeningHours.weekdayDescriptions',
    'reviews','editorialSummary','accessibilityOptions','photos',
    'websiteUri','nationalPhoneNumber',
  ].join(',');
  const r = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?fields=${encodeURIComponent(fieldMask)}`,
    { headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY } }
  );
  const d = await r.json();
  if (!r.ok) return { error: d.error?.message || `Places ${r.status}` };
  return { value: d };
}

// ─── Search Console — organic website query layer ────────────────────────
async function fetchSearchConsole(token, siteUrl, startDate, endDate) {
  const body = {
    startDate: startDate.iso,
    endDate: endDate.iso,
    dimensions: ['query'],
    rowLimit: 250,
    aggregationType: 'auto',
  };
  const r = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const d = await r.json();
  if (!r.ok) return { error: `Search Console ${r.status}: ${d.error?.message || 'unknown'}`, rows: [] };
  return {
    rows: (d.rows || []).map(row => ({
      query: row.keys?.[0] || '',
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || null,
    })),
  };
}

// ─── Menu URL health — checks the public menu path, not GBP write fields ──
async function fetchMenuHealth(brand) {
  const candidates = brand.menuUrls || [`https://${brand.domain}/menu/`];
  const checks = await Promise.all(candidates.map(async url => {
    const started = Date.now();
    try {
      const r = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'HN-Google-Organic-Cockpit/1.0' },
      });
      const contentType = r.headers.get('content-type') || '';
      const text = contentType.includes('text/html') ? await r.text() : '';
      const bodySample = text.slice(0, 4000).toLowerCase();
      return {
        url,
        finalUrl: r.url || url,
        ok: r.ok,
        status: r.status,
        latencyMs: Date.now() - started,
        contentType,
        hasMenuSignals: /menu|biryani|ghee rice|kabab|kebab|chai|haleem|order/.test(bodySample),
      };
    } catch (err) {
      return {
        url,
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        error: err.message,
      };
    }
  }));
  const winner = checks.find(c => c.ok && c.hasMenuSignals) || checks.find(c => c.ok) || checks[0] || null;
  return {
    ok: !!(winner && winner.ok && winner.hasMenuSignals),
    primary: winner,
    candidates: checks,
  };
}

// ─── Places Text Search — local competitor benchmark layer ───────────────
async function fetchCompetitorBenchmark(env, brand) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    return { error: 'GOOGLE_PLACES_API_KEY not set', items: [] };
  }
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.primaryType',
    'places.types',
    'places.googleMapsUri',
    'places.regularOpeningHours.openNow',
    'places.photos',
  ].join(',');
  const queries = (brand.competitorQueries || []).slice(0, 8);
  const items = await Promise.all(queries.map(async q => {
    try {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({
          textQuery: q,
          maxResultCount: 1,
          locationBias: {
            circle: {
              center: { latitude: brand.center.lat, longitude: brand.center.lng },
              radius: 2500,
            },
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        return { query: q, error: d.error?.message || `Places Text Search ${r.status}` };
      }
      const p = (d.places || [])[0];
      if (!p) {
        return { query: q, error: 'No place returned' };
      }
      return {
        query: q,
        placeId: p.id || null,
        name: p.displayName?.text || q,
        address: p.formattedAddress || null,
        rating: p.rating || null,
        reviews: p.userRatingCount || 0,
        primaryType: p.primaryType || null,
        types: p.types || [],
        openNow: p.regularOpeningHours?.openNow ?? null,
        mapsUri: p.googleMapsUri || null,
        photoCount: (p.photos || []).length,
        distanceMeters: p.location ? Math.round(distanceMeters(brand.center.lat, brand.center.lng, p.location.latitude, p.location.longitude)) : null,
      };
    } catch (err) {
      return { query: q, error: err.message };
    }
  }));
  return { items };
}

// ─── Build helpers ───────────────────────────────────────────────────────
function buildSummary(perf, prior) {
  const t = perf.totals;
  const p = prior?.totals || {};
  const sum = keys => keys.reduce((s, k) => s + (t[k] || 0), 0);
  const sumP = keys => keys.reduce((s, k) => s + (p[k] || 0), 0);

  const mapsImpr   = (t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (t.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0);
  const mapsImprP  = (p.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (p.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0);
  const searchImpr = (t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);
  const searchImprP= (p.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (p.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);
  const totalImpr  = mapsImpr + searchImpr;
  const totalImprP = mapsImprP + searchImprP;
  const actions    = sum(ACTION_METRICS);
  const actionsP   = sumP(ACTION_METRICS);

  const mobileImpr = (t.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0) + (t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);
  const desktopImpr= (t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0);

  return {
    impressions: {
      total: totalImpr, prior: totalImprP, delta: pct(totalImpr, totalImprP),
      maps: mapsImpr, mapsPrior: mapsImprP,
      search: searchImpr, searchPrior: searchImprP,
      desktop: desktopImpr,
      mobile:  mobileImpr,
      mobilePct: totalImpr ? Math.round(100 * mobileImpr / totalImpr) : 0,
      breakdown: {
        mobile_maps:    t.BUSINESS_IMPRESSIONS_MOBILE_MAPS    || 0,
        mobile_search:  t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH  || 0,
        desktop_search: t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0,
        desktop_maps:   t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS   || 0,
      },
    },
    actions: {
      total: actions, prior: actionsP, delta: pct(actions, actionsP),
      calls:        t.CALL_CLICKS                  || 0,
      callsPrior:   p.CALL_CLICKS                  || 0,
      directions:   t.BUSINESS_DIRECTION_REQUESTS  || 0,
      directionsPrior: p.BUSINESS_DIRECTION_REQUESTS || 0,
      website:      t.WEBSITE_CLICKS               || 0,
      websitePrior: p.WEBSITE_CLICKS               || 0,
      menu:         t.BUSINESS_FOOD_MENU_CLICKS    || 0,
      menuPrior:    p.BUSINESS_FOOD_MENU_CLICKS    || 0,
      orders:       t.BUSINESS_FOOD_ORDERS         || 0,
      bookings:     t.BUSINESS_BOOKINGS            || 0,
      conversations:t.BUSINESS_CONVERSATIONS       || 0,
    },
    actionRate: totalImpr ? +(100 * actions / totalImpr).toFixed(2) : 0,
    actionRatePrior: totalImprP ? +(100 * actionsP / totalImprP).toFixed(2) : 0,
  };
}

function buildDaily(perf) {
  // Roll the per-metric series into one row per date with impr/actions.
  const dates = new Set();
  for (const m of METRICS) for (const r of perf.series[m] || []) dates.add(r.date);
  const sorted = [...dates].sort();
  const dayMap = new Map();
  for (const d of sorted) dayMap.set(d, { date: d, impressions: 0, actions: 0, calls: 0, directions: 0, website: 0, mapsImpr: 0, searchImpr: 0 });
  for (const m of METRICS) {
    for (const r of perf.series[m] || []) {
      const day = dayMap.get(r.date);
      if (!day) continue;
      if (IMPRESSION_METRICS.includes(m)) {
        day.impressions += r.value;
        if (m.includes('MAPS')) day.mapsImpr += r.value;
        else day.searchImpr += r.value;
      }
      if (ACTION_METRICS.includes(m)) day.actions += r.value;
      if (m === 'CALL_CLICKS') day.calls = r.value;
      if (m === 'BUSINESS_DIRECTION_REQUESTS') day.directions = r.value;
      if (m === 'WEBSITE_CLICKS') day.website = r.value;
    }
  }
  return [...dayMap.values()];
}

function buildKeywords(thisRes, prevRes) {
  const thisList = (thisRes?.keywords) || [];
  const prevList = (prevRes?.keywords) || [];
  const prevMap = new Map(prevList.map(k => [k.keyword.toLowerCase(), k]));
  const enriched = thisList.map(k => {
    const prev = prevMap.get(k.keyword.toLowerCase());
    let trend = '→';
    let trendPct = 0;
    if (prev) {
      trendPct = pct(k.impressions, prev.impressions);
      trend = trendPct > 10 ? '↑' : trendPct < -10 ? '↓' : '→';
    } else {
      trend = 'NEW';
    }
    return { ...k, trend, trendPct, priorImpressions: prev?.impressions || 0 };
  });
  return {
    thisMonth: enriched,
    lastMonth: prevList.slice(0, 25),
    thisError: thisRes?.error,
    prevError: prevRes?.error,
  };
}

function buildProfile(profile) {
  if (!profile) return null;
  const pri = profile.categories?.primaryCategory?.displayName || null;
  const adds = (profile.categories?.additionalCategories || []).map(c => c.displayName);
  return {
    title: profile.title,
    primaryCategory: pri,
    additionalCategories: adds,
    websiteUri: profile.websiteUri || null,
    primaryPhone: profile.phoneNumbers?.primaryPhone || null,
    additionalPhones: profile.phoneNumbers?.additionalPhones || [],
    description: profile.profile?.description || null,
    descriptionLength: profile.profile?.description?.length || 0,
    regularHours: profile.regularHours?.periods || [],
    specialHours: profile.specialHours?.specialHourPeriods || [],
    openInfo: profile.openInfo || null,
    storeCode: profile.storeCode || null,
    mapsUri: profile.metadata?.mapsUri,
    newReviewUri: profile.metadata?.newReviewUri,
    canHaveFoodMenus: !!profile.metadata?.canHaveFoodMenus,
    labels: profile.labels || [],
  };
}

function buildReviewsAggregate(places) {
  if (!places || places.error) return { error: places?.error || 'unavailable' };
  const v = places.value || {};
  const reviews = (v.reviews || []).map(r => ({
    rating: r.rating,
    text:   r.text?.text || r.originalText?.text || '',
    author: r.authorAttribution?.displayName || 'Anonymous',
    authorUri: r.authorAttribution?.uri || null,
    photoUri:  r.authorAttribution?.photoUri || null,
    publishTime: r.publishTime || null,
    relativeTime: r.relativePublishTimeDescription || '',
    languageCode: r.languageCode || null,
  }));
  return {
    rating: v.rating || null,
    count:  v.userRatingCount || 0,
    priceLevel: v.priceLevel || null,
    editorialSummary: v.editorialSummary?.text || null,
    photoCount: (v.photos || []).length,
    recent: reviews,
  };
}

function buildHealth(profile, places, perf) {
  const items = [];
  const has = (v) => v != null && v !== '' && (Array.isArray(v) ? v.length > 0 : true);

  // Profile completeness
  items.push({ id: 'primary_category', status: has(profile?.categories?.primaryCategory) ? 'ok' : 'miss', weight: 5, label: 'Primary category set', value: profile?.categories?.primaryCategory?.displayName || null });
  items.push({ id: 'phone',  status: has(profile?.phoneNumbers?.primaryPhone) ? 'ok' : 'miss', weight: 4, label: 'Phone number',  value: profile?.phoneNumbers?.primaryPhone || null });
  items.push({ id: 'website',status: has(profile?.websiteUri) ? 'ok' : 'miss', weight: 3, label: 'Website',         value: profile?.websiteUri || null });
  items.push({ id: 'hours',  status: has(profile?.regularHours?.periods) ? 'ok' : 'miss', weight: 5, label: 'Regular hours',   value: profile?.regularHours?.periods?.length || 0 });

  const desc = profile?.profile?.description || '';
  items.push({ id: 'description', status: desc.length >= 200 ? 'ok' : desc.length > 0 ? 'warn' : 'miss', weight: 3, label: 'Description (200+ chars recommended)', value: desc.length });

  const photoCount = places?.value?.photos?.length || 0;
  items.push({ id: 'photos', status: photoCount >= 25 ? 'ok' : photoCount >= 10 ? 'warn' : 'miss', weight: 3, label: 'Photos (25+ recommended)', value: photoCount });

  // Special hours: warn if regular set but no specialHours covering next 60 days
  const specialHours = profile?.specialHours?.specialHourPeriods || [];
  items.push({ id: 'special_hours', status: specialHours.length > 0 ? 'ok' : 'warn', weight: 2, label: 'Special hours configured', value: specialHours.length });

  // Recent activity — using performance impressions as proxy
  const recentImpr = perf ? sumOf(perf.totals, IMPRESSION_METRICS) : 0;
  items.push({ id: 'recent_impressions', status: recentImpr > 50 ? 'ok' : recentImpr > 0 ? 'warn' : 'miss', weight: 2, label: 'Recent impressions', value: recentImpr });

  const score = scoreHealth(items);
  return { score, max: 100, items };
}

function scoreHealth(items) {
  let earned = 0, total = 0;
  for (const it of items) {
    total += it.weight;
    if (it.status === 'ok') earned += it.weight;
    else if (it.status === 'warn') earned += it.weight * 0.5;
  }
  return total > 0 ? Math.round(100 * earned / total) : 0;
}

// ─── Build helpers — Media ──────────────────────────────────────────────
function buildMedia(media) {
  if (media?.error) return { error: media.error, items: [] };
  const items = media?.items || [];
  const byCategory = {};
  let recentCount = 0;
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  let lastUploadAt = null;
  for (const m of items) {
    const cat = m.locationAssociation?.category || 'OTHER';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const t = m.createTime ? new Date(m.createTime).getTime() : 0;
    if (t > thirtyDaysAgo) recentCount++;
    if (t > (lastUploadAt || 0)) lastUploadAt = t;
  }
  const recent = items.slice(0, 12).map(m => ({
    name: m.name,
    category: m.locationAssociation?.category || 'OTHER',
    mediaFormat: m.mediaFormat,
    thumbnailUrl: m.thumbnailUrl || null,
    googleUrl: m.googleUrl || null,
    createTime: m.createTime || null,
    dimensions: m.dimensions || null,
  }));
  return {
    total: items.length,
    recent30d: recentCount,
    lastUploadAt: lastUploadAt ? new Date(lastUploadAt).toISOString() : null,
    daysSinceLastUpload: lastUploadAt ? Math.floor((Date.now() - lastUploadAt) / 86400000) : null,
    byCategory,
    recent,
  };
}

// ─── Build helpers — Q&A ────────────────────────────────────────────────
function buildQandA(qanda) {
  if (qanda?.deprecated) {
    return {
      deprecated: true,
      message: 'Q&A monitoring via API is no longer available — Google retired the My Business Q&A API in 2024. Manage Q&A directly via the Google Maps app or business.google.com.',
      items: [],
    };
  }
  if (qanda?.error) return { error: qanda.error, items: [] };
  const items = qanda?.items || [];
  const total = items.length;
  let ownerAsked = 0, ownerAnswered = 0, unanswered = 0;
  const unansweredItems = [];
  for (const q of items) {
    if (q.author?.type === 'MERCHANT') ownerAsked++;
    const answers = q.topAnswers || [];
    const hasOwnerAnswer = answers.some(a => a.author?.type === 'MERCHANT');
    if (hasOwnerAnswer) ownerAnswered++;
    if (answers.length === 0 || !hasOwnerAnswer) {
      unanswered++;
      unansweredItems.push({
        text: q.text || '',
        author: q.author?.displayName || 'Anonymous',
        upvoteCount: q.upvoteCount || 0,
        createTime: q.createTime,
      });
    }
  }
  return {
    total,
    ownerAsked,
    ownerAnswered,
    ownerAnsweredPct: total ? Math.round(100 * ownerAnswered / total) : 0,
    unanswered,
    unansweredItems: unansweredItems.slice(0, 8),
    items: items.slice(0, 12).map(q => ({
      text: q.text || '',
      authorType: q.author?.type || 'USER',
      author: q.author?.displayName || 'Anonymous',
      upvoteCount: q.upvoteCount || 0,
      totalAnswerCount: q.totalAnswerCount || 0,
      ownerAnswered: (q.topAnswers || []).some(a => a.author?.type === 'MERCHANT'),
      topAnswerText: (q.topAnswers || [])[0]?.text || null,
      createTime: q.createTime,
    })),
  };
}

// ─── Build helpers — Action Queue ────────────────────────────────────────
// The "what should the owner do today" engine. Consumes everything else and
// emits a sorted list of actions. severity: critical | warn | info.
function buildActionQueue(ctx) {
  const { profile, perf, perfPrior, places, media, qanda, summary } = ctx;
  const queue = [];
  const push = (severity, id, title, detail, actionUri) =>
    queue.push({ severity, id, title, detail, actionUri });

  // 1. Hours summary — surface the configured weekly schedule as a single
  //    INFO item. We do NOT auto-flag morning closures as critical, because
  //    many QSRs (especially North Indian / biryani in Bangalore) deliberately
  //    open at 12 PM or 2 PM. False-positive critical alerts spam the queue.
  //    The owner inspects the schedule and acts only when it doesn't match
  //    their actual operations.
  const periods = profile?.regularHours?.periods || [];
  if (periods.length > 0) {
    const summary = summarizeWeeklyHours(periods);
    if (summary.uniformPattern) {
      push('info', 'hours_summary',
        `Listing hours: ${summary.uniformPattern}`,
        `${summary.coveredDays} days configured. If your actual operating hours differ from this, fix in business.google.com — Maps filters you out of "open now" searches during the closed window.`,
        'https://business.google.com/');
    } else {
      push('info', 'hours_summary',
        `Listing has ${summary.distinctPatterns} distinct daily schedules`,
        'Hours vary across days of the week. Verify each day matches your actual operations in business.google.com.',
        'https://business.google.com/');
    }
  }

  // 2. Menu-click cliff — flag if menu clicks dropped >50% vs prior period.
  if (summary?.actions) {
    const m = summary.actions.menu, mp = summary.actions.menuPrior;
    if (mp >= 10 && m / mp <= 0.5) {
      const dropPct = Math.round(100 * (mp - m) / mp);
      push('critical', 'menu_clicks_drop',
        `Menu clicks down ${dropPct}% (${mp} → ${m})`,
        `Menu engagement is the leading indicator of intent. Investigate: (1) is hamzaexpress.in/menu reachable? (2) did the GBP menu URL change? (3) anything broken on the menu page?`,
        null);
    }
  }

  // 3. Photos cadence — alert if no upload in 30 days
  if (media && !media.error) {
    if ((media.recent30d || 0) === 0) {
      const last = media.daysSinceLastUpload != null ? `${media.daysSinceLastUpload} days ago` : 'never';
      push('warn', 'photos_stale',
        `No photos uploaded in 30 days (last: ${last})`,
        `Google rewards listing freshness. Target: 3–5 photos/week for the first 8 weeks. Categories needed: food (close-ups of hero dishes), interior (busy hours), exterior (signboard, foot-traffic).`,
        'https://business.google.com/');
    }
    if ((media.total || 0) < 25) {
      push('warn', 'photos_low_count',
        `Only ${media.total || 0} owner photos (target: 25+)`,
        `Listings with 100+ photos see ~520% more calls and 2,717% more direction requests vs 11-photo profiles.`,
        'https://business.google.com/');
    }
  }

  // 4. Q&A coverage — alert if <10 owner-seeded Q&As, or unanswered queue >0.
  // Skipped silently when the Q&A API is deprecated (Google retired it in 2024).
  if (qanda && !qanda.error && !qanda.deprecated) {
    if ((qanda.ownerAsked || 0) < 10) {
      push('warn', 'qanda_seed_low',
        `Only ${qanda.ownerAsked || 0} owner-seeded Q&As (target: 10+)`,
        `Owner-seeded Q&As act as long-tail indexed content. Seed top customer questions: halal? parking? specialty? late-night? family-friendly?`,
        'https://business.google.com/');
    }
    if ((qanda.unanswered || 0) > 0) {
      push('warn', 'qanda_unanswered',
        `${qanda.unanswered} community question(s) need an owner reply`,
        'Owner replies on community Q&As get more upvotes than third-party answers and rank higher.',
        'https://business.google.com/');
    }
  } else if (qanda?.deprecated) {
    // One-time info: surface the manual-only action even though we can't track it
    push('info', 'qanda_manual_only',
      'Q&A: API retired — manage via Maps app',
      'Google retired the My Business Q&A API in 2024. You still have ~10–12 customer questions you should owner-seed and answer (halal, parking, specialty, late-night, family-friendly, etc.) — but it has to happen in the Google Maps app on your phone.',
      'https://business.google.com/');
  }

  // 5. Bakrid 2026 — special hours not configured for May 19
  const sh = profile?.specialHours?.specialHourPeriods || [];
  const hasBakrid = sh.some(p => {
    const d = p.startDate;
    return d && d.year === 2026 && d.month === 5 && d.day >= 18 && d.day <= 20;
  });
  if (!hasBakrid) {
    push('info', 'bakrid_special_hours',
      'Bakrid 2026 (May 19) — no special hours set',
      'Eid al-Adha drives surge demand for halal restaurants. Configure extended hours (e.g. 11 AM – 2 AM) for May 18–20.',
      'https://business.google.com/');
  }

  // 6. Reviews response gap (using Places sample)
  const reviews = places?.value?.reviews || [];
  if (reviews.length > 0) {
    const recent = reviews.slice(0, 5);
    const lowRated = recent.filter(r => (r.rating || 5) <= 3);
    if (lowRated.length > 0) {
      push('warn', 'reviews_low_rated',
        `${lowRated.length} of last 5 reviews ≤ 3 stars`,
        'Respond directly. Acknowledge specifics, apologise sincerely, invite to call you. Public response is for the next reader, not the reviewer.',
        'https://business.google.com/');
    }
  }

  // 7. Action rate decline (overall)
  if (summary?.actionRate != null && summary?.actionRatePrior != null && summary.actionRatePrior > 0) {
    const delta = summary.actionRate - summary.actionRatePrior;
    if (delta < -1) {
      push('warn', 'action_rate_decline',
        `Action rate ${summary.actionRate}% (was ${summary.actionRatePrior}% — down ${(-delta).toFixed(1)}pp)`,
        'Listing impressions are converting less. Likely causes: stale photos, menu broken, no posts in 14+ days, or rank drop pushing you to lower-quality impressions.',
        null);
    }
  }

  // Sort: critical first, then warn, then info
  const order = { critical: 0, warn: 1, info: 2 };
  queue.sort((a, b) => order[a.severity] - order[b.severity]);
  return queue;
}

// summarizeWeeklyHours: present the configured weekly schedule in a way the
// owner can verify at a glance. Detects the common case where all 7 days
// share the same window ("uniform pattern"); otherwise reports that hours
// vary. Crucially does NOT impose an opinion about whether the schedule is
// "right" — that's the owner's call. We surface, owner decides.
function summarizeWeeklyHours(periods) {
  const DAYS = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const byDay = {};
  for (const d of DAYS) byDay[d] = [];
  for (const p of periods) {
    const sd = p.openDay;
    const sh = p.openTime?.hours || 0;
    const sm = p.openTime?.minutes || 0;
    // closeTime.hours of 0 with no minutes = midnight (next day boundary)
    const eh = p.closeTime?.hours != null ? p.closeTime.hours : 24;
    const em = p.closeTime?.minutes || 0;
    if (!byDay[sd]) continue;
    byDay[sd].push({ sh, sm, eh, em, crossesMidnight: sd !== p.closeDay });
  }
  // Build a per-day signature for the merged hours
  const sigByDay = {};
  let coveredDays = 0;
  for (const d of DAYS) {
    if (byDay[d].length === 0) { sigByDay[d] = '(closed)'; continue; }
    coveredDays++;
    const sorted = byDay[d].slice().sort((a, b) => a.sh - b.sh);
    sigByDay[d] = sorted.map(p =>
      `${pad2(p.sh)}:${pad2(p.sm)}–${pad2(p.eh)}:${pad2(p.em)}${p.crossesMidnight ? '+1' : ''}`
    ).join(', ');
  }
  const distinct = new Set(Object.values(sigByDay).filter(s => s !== '(closed)'));
  if (distinct.size === 1) {
    return { uniformPattern: [...distinct][0], coveredDays, distinctPatterns: 1, sigByDay };
  }
  return { uniformPattern: null, coveredDays, distinctPatterns: distinct.size, sigByDay };
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ─── Build helpers — Algorithm Tips ──────────────────────────────────────
// Rules-driven recommendations. These come from algorithm-cracking knowledge:
// what we observe vs what the local-pack ranking ladder rewards.
function buildAlgorithmTips({ brand, profile, builtProfile, media, qanda }) {
  const tips = [];
  const desc = profile?.profile?.description || '';
  // Prefer the built profile (additionalCategories already an array of strings)
  // and fall back to raw API shape if needed.
  const cats = (builtProfile?.additionalCategories
    || (profile?.categories?.additionalCategories || []).map(c => c?.displayName || c?.name || c)
    || []);
  const primary = builtProfile?.primaryCategory
    || profile?.categories?.primaryCategory?.displayName
    || '';

  // HE-specific keyword targets
  const heKeywords = ['halal','dakhni','biryani','1918','mg road','shivajinagar','ghee rice','kabab'];
  const nchKeywords = ['irani chai','haleem','osmania','chai','nawabi','shivajinagar'];
  const targets = brand === 'nch' ? nchKeywords : heKeywords;
  const descLower = desc.toLowerCase();
  const missing = targets.filter(k => !descLower.includes(k.toLowerCase()));
  if (missing.length > 0) {
    tips.push({
      id: 'desc_keyword_coverage',
      level: 'medium',
      title: `Description missing ${missing.length} high-intent keywords`,
      detail: `Top keywords absent from your 750-char description: ${missing.join(', ')}. Description text is indexed for local-pack ranking.`,
      action: 'Edit description in business.google.com',
    });
  }

  // Primary category — should be the highest-revenue lever, not "Restaurant"
  if (brand === 'he' && /^Restaurant$/i.test(primary)) {
    tips.push({
      id: 'primary_category_generic',
      level: 'high',
      title: `Primary category "${primary}" is too generic`,
      detail: 'Switch to "Biryani restaurant" — it\'s the highest-volume search match for HE\'s menu and a stronger ranking signal than generic "Restaurant".',
      action: 'Edit primary category in business.google.com',
    });
  }

  // Halal attribute — verify in categories, recommend explicit attribute
  if (brand === 'he' && !cats.some(c => /halal/i.test(c))) {
    tips.push({
      id: 'halal_category_missing',
      level: 'high',
      title: 'No halal-specific category present',
      detail: 'Add "Halal restaurant" as a secondary category. Direct match for halal_food_searchers — a top-3 PMax audience and a major Bangalore-Muslim-quarter filter signal.',
      action: 'Add category in business.google.com',
    });
  }

  // Photo recency
  if (media && !media.error) {
    if ((media.daysSinceLastUpload || 0) > 14) {
      tips.push({
        id: 'photo_recency',
        level: 'medium',
        title: `Last photo upload was ${media.daysSinceLastUpload} days ago`,
        detail: 'Photo recency is a freshness signal. Aim for 3–5 photos/week minimum during the first 8 weeks of a new optimisation cycle.',
        action: 'Upload via business.google.com',
      });
    }
  }

  // Q&A seed coverage (skipped if API deprecated)
  if (qanda && !qanda.error && !qanda.deprecated && (qanda.ownerAsked || 0) < 5) {
    const ideas = brand === 'nch'
      ? ['Are you halal?','Do you serve haleem all year?','Do you have parking?','Are you family-friendly?','Hours on weekends?']
      : ['Are you halal?','Do you have parking near MG Road?','What\'s your specialty?','Are you open late?','Vegetarian options?','Family-friendly seating?'];
    tips.push({
      id: 'qanda_seed_owner',
      level: 'medium',
      title: 'Owner-seeded Q&As under 5 — leaving long-tail rank on the table',
      detail: `Owner-asked Q&As are indexed as on-listing content. Suggested seeds for ${brand.toUpperCase()}: ${ideas.slice(0, 4).join(' · ')}…`,
      action: 'Seed via business.google.com',
    });
  }

  // Description length sweet spot (Google rewards 350-700 chars)
  if (desc.length > 0 && desc.length < 350) {
    tips.push({
      id: 'desc_too_short',
      level: 'low',
      title: `Description only ${desc.length} chars (sweet spot: 350–700)`,
      detail: 'A richer description at 500-700 chars correlates with higher local-pack ranking. Front-load brand + heritage + cuisine keywords in the first 250 chars (only that prefix shows without "more").',
      action: 'Expand description',
    });
  }

  // Order: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  tips.sort((a, b) => order[a.level] - order[b.level]);
  return tips;
}

// ─── Build helpers — Organic Intelligence ───────────────────────────────
function buildOrganicIntelligence(ctx) {
  const { brandKey, brand, period, include, results, summary, keywords, profile, reviews, media, qanda, actionQueue } = ctx;
  const searchConsole = buildSearchConsoleSummary(results.searchConsole);
  const keywordRows = [
    ...((keywords?.thisMonth || []).map(k => ({ source: 'GBP this month', query: k.keyword, impressions: k.impressions || 0, clicks: 0, position: null }))),
    ...((keywords?.lastMonth || []).map(k => ({ source: 'GBP last month', query: k.keyword, impressions: k.impressions || 0, clicks: 0, position: null }))),
    ...(searchConsole.rows || []).map(k => ({ source: 'Search Console', query: k.query, impressions: k.impressions || 0, clicks: k.clicks || 0, position: k.position || null })),
  ];
  const queryBuckets = buildQueryBuckets(brandKey, keywordRows);
  const menuHealth = buildMenuHealth(results.menuHealth);
  const photoProof = buildPhotoProofInventory(brandKey, media);
  const competitorBenchmark = buildCompetitorSummary(brand, results.competitors, reviews);
  const dataSources = buildDataSourceHealth({ include, results, summary, keywords, profile, reviews, media, qanda, searchConsole, menuHealth, competitorBenchmark });
  const actionSplit = buildOrganicActionSplit({ brandKey, profile, media, qanda, menuHealth, photoProof, queryBuckets, competitorBenchmark, actionQueue });

  return {
    version: '2026-05-15.organic-intelligence.v1',
    objective: 'Increase organic Google Maps/Search footfall by mapping each visible signal to an owner action.',
    dataSources,
    funnel: {
      impressions: summary?.impressions?.total || 0,
      mapsImpressions: summary?.impressions?.maps || 0,
      searchImpressions: summary?.impressions?.search || 0,
      actions: summary?.actions?.total || 0,
      actionRate: summary?.actionRate || 0,
      strongestAction: strongestAction(summary?.actions || {}),
      ownerRead: 'If impressions rise but action rate falls, fix conversion proof: menu, photos, hours, reviews, and Q&A.',
    },
    searchConsole,
    queryBuckets,
    menuHealth,
    competitorBenchmark,
    photoProof,
    actionSplit,
    explainers: [
      {
        id: 'maps_vs_search',
        title: 'Maps vs Search',
        detail: 'Maps impressions are high-intent local discovery. Search impressions are broader Google Search visibility. HE footfall depends more on Maps + directions than website clicks.',
      },
      {
        id: 'category_eater_static_vs_google_dynamic',
        title: 'Persona intelligence vs Google behavior',
        detail: 'The eater buckets are static local intelligence. Google behavior tells which bucket is actively using Search/Maps today, so budget and profile work should follow bucket evidence instead of equal importance.',
      },
      {
        id: 'owner_vs_api',
        title: 'What API can and cannot do',
        detail: 'The API can read performance, keywords, website queries, Places competitors, menu reachability, and media inventory. Owner/browser action is still required for photos, Q&A, category edits, review replies, and sensitive profile writes.',
      },
    ],
    period,
    generatedAt: nowIstIso(),
  };
}

function buildSearchConsoleSummary(res) {
  if (!res || res.error) {
    return {
      status: res?.error ? 'error' : 'not_requested',
      error: res?.error || null,
      rows: [],
      totals: { clicks: 0, impressions: 0, ctr: 0, avgPosition: null },
    };
  }
  const rows = (res.rows || []).filter(r => r.query).slice(0, 250);
  const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
  const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const weightedPosition = rows.reduce((s, r) => s + ((r.position || 0) * (r.impressions || 0)), 0);
  return {
    status: 'ok',
    rows: rows.slice(0, 50),
    totals: {
      clicks,
      impressions,
      ctr: impressions ? +(clicks / impressions).toFixed(4) : 0,
      avgPosition: impressions ? +(weightedPosition / impressions).toFixed(1) : null,
    },
  };
}

function buildQueryBuckets(brandKey, rows) {
  const defs = PERSONA_BUCKETS[brandKey] || PERSONA_BUCKETS.he;
  return defs.map(def => {
    const matched = rows.filter(r => matchesBucket(r.query, def.patterns));
    const byQuery = new Map();
    for (const row of matched) {
      const key = row.query.toLowerCase();
      const cur = byQuery.get(key) || { query: row.query, gbpImpressions: 0, scImpressions: 0, clicks: 0, weightedPosition: 0, posWeight: 0, sources: new Set() };
      if (/^GBP/.test(row.source)) cur.gbpImpressions += row.impressions || 0;
      if (row.source === 'Search Console') {
        cur.scImpressions += row.impressions || 0;
        cur.clicks += row.clicks || 0;
        if (row.position && row.impressions) {
          cur.weightedPosition += row.position * row.impressions;
          cur.posWeight += row.impressions;
        }
      }
      cur.sources.add(row.source);
      byQuery.set(key, cur);
    }
    const samples = [...byQuery.values()]
      .map(q => ({
        query: q.query,
        gbpImpressions: q.gbpImpressions,
        searchImpressions: q.scImpressions,
        clicks: q.clicks,
        avgPosition: q.posWeight ? +(q.weightedPosition / q.posWeight).toFixed(1) : null,
        sources: [...q.sources],
      }))
      .sort((a, b) => (b.gbpImpressions + b.searchImpressions) - (a.gbpImpressions + a.searchImpressions))
      .slice(0, 8);
    const gbpImpressions = samples.reduce((s, q) => s + q.gbpImpressions, 0);
    const searchImpressions = samples.reduce((s, q) => s + q.searchImpressions, 0);
    const clicks = samples.reduce((s, q) => s + q.clicks, 0);
    return {
      id: def.id,
      label: def.label,
      persona: def.persona,
      intent: def.intent,
      ownerRead: def.ownerRead,
      evidence: {
        gbpImpressions,
        searchImpressions,
        clicks,
        score: gbpImpressions + searchImpressions + clicks * 5,
        sampleQueries: samples,
      },
      status: samples.length ? 'has_evidence' : 'needs_data',
    };
  }).sort((a, b) => b.evidence.score - a.evidence.score);
}

function matchesBucket(query, patterns) {
  const q = String(query || '').toLowerCase();
  return patterns.some(p => q.includes(String(p).toLowerCase()));
}

function buildMenuHealth(menu) {
  if (!menu) return { status: 'not_requested', ok: false, candidates: [] };
  if (menu.error) return { status: 'error', ok: false, error: menu.error, candidates: [] };
  const primary = menu.primary || null;
  return {
    status: menu.ok ? 'ok' : 'warn',
    ok: !!menu.ok,
    primary,
    candidates: menu.candidates || [],
    ownerRead: menu.ok
      ? 'Public menu path is reachable and contains menu/dish signals.'
      : 'Public menu path did not return both HTTP success and menu/dish text. Verify GBP menu link and mobile menu page.',
  };
}

function buildPhotoProofInventory(brandKey, media) {
  const byCategory = media?.byCategory || {};
  const total = media?.total || 0;
  const food = (byCategory.FOOD_AND_DRINK || 0) + (byCategory.MENU || 0);
  const exterior = (byCategory.EXTERIOR || 0) + (byCategory.COVER || 0) + (byCategory.PROFILE || 0);
  const interior = byCategory.INTERIOR || 0;
  const recent = media?.recent30d || 0;
  const defs = brandKey === 'nch'
    ? [
        ['chai_hero', 'Irani chai / haleem proof', food, 12, 'API category can verify food volume; choose hero chai/haleem assets manually.'],
        ['exterior_local', 'Exterior / Shivajinagar proof', exterior, 4, 'Needs storefront/street proof so Maps users trust the location.'],
        ['interior_seating', 'Interior seating proof', interior, 4, 'Needed for family/cafe comfort decisions.'],
        ['freshness', 'Recent upload cadence', recent, 8, 'Target 3-5 uploads/week during optimization.'],
      ]
    : [
        ['hero_food', 'Hero food proof', food, 20, 'Ghee rice, kabab, biryani, tandoori, brain dry, naan/gravy must be visually obvious.'],
        ['night_exterior', 'Night exterior / board proof', exterior, 5, 'Needed for late-night Maps trust and open-now searches.'],
        ['family_seating', 'Interior / family seating proof', interior, 5, 'Needed for family comfort diner conversion.'],
        ['parcel_counter', 'Parcel / pickup proof', 0, 4, 'Google media API cannot classify this yet; owner/Gemini asset tagging needed.'],
        ['hkp_context', 'HKP Road street context', 0, 4, 'Google media API cannot classify street context yet; upload selected exterior/local-pulse assets.'],
        ['freshness', 'Recent upload cadence', recent, 8, 'Target 3-5 uploads/week during optimization.'],
      ];
  return {
    total,
    recent30d: recent,
    byGoogleCategory: byCategory,
    categories: defs.map(([id, label, count, target, detail]) => ({
      id,
      label,
      count,
      target,
      status: count >= target ? 'covered' : count > 0 ? 'weak' : 'missing',
      detail,
    })),
    ownerRead: 'Google media categories are too coarse. This inventory translates them into eater-proof categories; parcel/street/late-night proof still needs manual or Gemini visual tagging.',
  };
}

function buildCompetitorSummary(brand, res, reviews) {
  if (!res || res.error) return { status: res?.error ? 'error' : 'not_requested', error: res?.error || null, items: [] };
  const own = {
    name: brand.title,
    placeId: brand.placeId,
    rating: reviews?.rating || null,
    reviews: reviews?.count || 0,
    distanceMeters: 0,
    isOwnListing: true,
  };
  const items = [own, ...((res.items || []).filter(x => !x.error).map(x => ({
    name: x.name,
    placeId: x.placeId,
    rating: x.rating,
    reviews: x.reviews || 0,
    openNow: x.openNow,
    distanceMeters: x.distanceMeters,
    primaryType: x.primaryType,
    photoCount: x.photoCount,
    mapsUri: x.mapsUri,
    isOwnListing: x.placeId === brand.placeId || /hamza express/i.test(x.name || '') && /hamza-express/i.test(brand.slug),
  })))].filter(x => x.name);
  const sorted = items.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviews || 0) - (a.reviews || 0));
  const ownRank = sorted.findIndex(x => x.isOwnListing) + 1;
  return {
    status: 'ok',
    ownRank: ownRank || null,
    items: sorted.slice(0, 10),
    errors: (res.items || []).filter(x => x.error).map(x => ({ query: x.query, error: x.error })).slice(0, 5),
    ownerRead: 'This is not Google local-pack rank. It is a Places API competitor proof scan: rating, review depth, distance, open state, and category surface.',
  };
}

function buildDataSourceHealth(ctx) {
  const statusOf = (obj, okWhenEmpty = true) => {
    if (!obj) return 'not_requested';
    if (obj.error) return 'error';
    if (!okWhenEmpty && Array.isArray(obj) && obj.length === 0) return 'empty';
    return 'ok';
  };
  return [
    {
      id: 'gbp_performance',
      label: 'GBP Performance API',
      status: statusOf(ctx.results.perf),
      freshness: 'T-2 days',
      powers: ['impressions', 'calls', 'directions', 'website clicks', 'menu clicks', 'action rate'],
      note: ctx.summary ? `${ctx.summary.impressions.total || 0} impressions, ${ctx.summary.actions.total || 0} actions` : ctx.results.perf?.error || null,
    },
    {
      id: 'gbp_keywords',
      label: 'GBP Search Keywords',
      status: ctx.keywords?.thisError && ctx.keywords?.prevError ? 'error' : 'ok',
      freshness: 'monthly bucket',
      powers: ['Google Search/Maps terms that found the profile'],
      note: `${(ctx.keywords?.thisMonth || []).length} current rows, ${(ctx.keywords?.lastMonth || []).length} prior rows`,
    },
    {
      id: 'business_information',
      label: 'Business Information API',
      status: statusOf(ctx.results.profile),
      freshness: 'live',
      powers: ['category', 'hours', 'phone', 'website', 'description', 'special hours'],
      note: ctx.profile?.primaryCategory || ctx.results.profile?.error || null,
    },
    {
      id: 'places_details',
      label: 'Places API Place Details',
      status: statusOf(ctx.results.places),
      freshness: 'live',
      powers: ['rating', 'review count', 'recent public review sample', 'open now', 'photo sample'],
      note: ctx.reviews?.rating ? `${ctx.reviews.rating} rating, ${ctx.reviews.count} reviews` : ctx.results.places?.error || null,
    },
    {
      id: 'media',
      label: 'Business Profile media API',
      status: statusOf(ctx.results.media),
      freshness: 'live-ish owner media list',
      powers: ['photo count', 'recent uploads', 'Google media categories'],
      note: ctx.media ? `${ctx.media.total || 0} media, ${ctx.media.recent30d || 0} in 30d` : ctx.results.media?.error || null,
    },
    {
      id: 'search_console',
      label: 'Search Console API',
      status: ctx.searchConsole.status,
      freshness: 'organic web search',
      powers: ['website queries', 'clicks', 'impressions', 'CTR', 'average position'],
      note: ctx.searchConsole.error || `${ctx.searchConsole.totals.impressions} impressions, ${ctx.searchConsole.totals.clicks} clicks`,
    },
    {
      id: 'competitor_places',
      label: 'Places API Text Search',
      status: ctx.competitorBenchmark.status,
      freshness: 'live',
      powers: ['competitor rating/review/distance/open benchmark'],
      note: ctx.competitorBenchmark.error || `${(ctx.competitorBenchmark.items || []).length} places scanned`,
    },
    {
      id: 'menu_health',
      label: 'Public menu URL fetch',
      status: ctx.menuHealth.status,
      freshness: 'live HTTP check',
      powers: ['menu reachability', 'menu text signal'],
      note: ctx.menuHealth.primary ? `${ctx.menuHealth.primary.status} ${ctx.menuHealth.primary.finalUrl || ctx.menuHealth.primary.url}` : ctx.menuHealth.error || null,
    },
    {
      id: 'qanda',
      label: 'Q&A API',
      status: ctx.qanda?.deprecated ? 'manual_only' : statusOf(ctx.results.qanda),
      freshness: ctx.qanda?.deprecated ? 'retired API' : 'live',
      powers: ['manual Q&A action reminder'],
      note: ctx.qanda?.message || ctx.results.qanda?.error || null,
    },
  ];
}

function buildOrganicActionSplit(ctx) {
  const ownerActions = [];
  const apiActions = [];
  const approvalRequiredApiWrites = [];

  apiActions.push({ id: 'query_bucket_monitor', title: 'Keep query buckets live', status: 'active', detail: 'GBP keywords + Search Console are classified into persona buckets automatically.' });
  apiActions.push({ id: 'competitor_scan', title: 'Competitor Places benchmark', status: ctx.competitorBenchmark.status, detail: 'Uses Places API Text Search to compare rating, review depth, distance, category, and open state.' });
  apiActions.push({ id: 'menu_health', title: 'Menu URL health check', status: ctx.menuHealth.status, detail: ctx.menuHealth.ownerRead });
  apiActions.push({ id: 'photo_inventory', title: 'Photo proof inventory', status: 'active', detail: ctx.photoProof.ownerRead });

  if (/^Restaurant$/i.test(ctx.profile?.primaryCategory || '') && ctx.brandKey === 'he') {
    ownerActions.push({ id: 'primary_category', title: 'Change primary category from Restaurant', channel: 'browser', detail: 'Use Business Profile UI to switch to a stronger food-specific category if Google offers it, likely Biryani restaurant.' });
    approvalRequiredApiWrites.push({ id: 'patch_primary_category', title: 'Patch primary category by API', risk: 'Profile write; owner approval required before mutation.' });
  }
  for (const cat of ctx.photoProof.categories || []) {
    if (cat.status !== 'covered') {
      ownerActions.push({ id: `photo_${cat.id}`, title: `Upload ${cat.label}`, channel: 'browser/assets', detail: cat.detail });
    }
  }
  if (!ctx.menuHealth.ok) {
    ownerActions.push({ id: 'menu_link_verify', title: 'Verify GBP menu link and mobile menu page', channel: 'browser', detail: 'Menu clicks are a leading footfall intent signal. Fix the listing/menu page before adding spend.' });
  }
  if (ctx.qanda?.deprecated) {
    ownerActions.push({ id: 'qanda_seed', title: 'Seed and answer Q&A manually', channel: 'Google Maps app / Business Profile', detail: 'API is unavailable. Add halal, late-night, parking, family seating, specialty dishes, parcel, and directions Q&As manually.' });
  }
  for (const q of ctx.actionQueue || []) {
    if (q.id === 'bakrid_special_hours') {
      ownerActions.push({ id: q.id, title: q.title, channel: 'browser', detail: q.detail });
      approvalRequiredApiWrites.push({ id: 'patch_special_hours', title: 'Patch special hours by API', risk: 'Profile hours write; owner approval required before mutation.' });
    }
  }

  return { apiActions, ownerActions, approvalRequiredApiWrites };
}

function strongestAction(actions) {
  const rows = [
    ['directions', actions.directions || 0],
    ['calls', actions.calls || 0],
    ['menu', actions.menu || 0],
    ['website', actions.website || 0],
  ].sort((a, b) => b[1] - a[1]);
  return { type: rows[0]?.[0] || null, value: rows[0]?.[1] || 0 };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Date helpers ─────────────────────────────────────────────────────────
function resolvePeriod(label, compareMode, customFrom, customTo) {
  // GBP performance data is T-2. End at 2 days ago to ensure rows exist.
  const nowMs = Date.now() + 5.5 * 3600000;
  const today = new Date(nowMs);
  const t2 = new Date(nowMs - 2 * 86400000);

  // Custom date range path: parse YYYY-MM-DD, clamp endDate to T-2 (no GBP data
  // exists for the last 2 days), set days from the span.
  let end, days, isCustom = false;
  if (customFrom && customTo && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    isCustom = true;
    const parsedTo = new Date(customTo + 'T00:00:00Z');
    end = parsedTo > t2 ? t2 : parsedTo;
    const start0 = new Date(customFrom + 'T00:00:00Z');
    days = Math.max(1, Math.round((end - start0) / 86400000) + 1);
  } else {
    end = t2;
    days = label === 'today' ? 1 : label === 'yesterday' ? 1 : label === '7d' ? 7 : label === '28d' ? 28 : label === '90d' ? 90 : 7;
  }
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const compareEnd   = new Date(start.getTime() - 86400000);
  const compareStart = compareMode === 'yoy'
    ? new Date(start.getTime() - 365 * 86400000)
    : new Date(compareEnd.getTime() - (days - 1) * 86400000);
  const realCompareEnd = compareMode === 'yoy'
    ? new Date(end.getTime() - 365 * 86400000)
    : compareEnd;

  const ymd = d => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), iso: d.toISOString().slice(0, 10) });

  // Keyword report uses calendar-month buckets — give caller this month + prev month
  const thisMonth = { y: today.getUTCFullYear(), m: today.getUTCMonth() + 1 };
  const last = new Date(today.getTime());
  last.setUTCMonth(last.getUTCMonth() - 1);
  const lastMonth = { y: last.getUTCFullYear(), m: last.getUTCMonth() + 1 };

  return {
    days,
    label: isCustom ? `${ymd(start).iso} → ${ymd(end).iso}` : label,
    isCustom,
    startDate: { ...ymd(start), iso: ymd(start).iso },
    endDate:   { ...ymd(end),   iso: ymd(end).iso },
    compareStart: { ...ymd(compareStart), iso: ymd(compareStart).iso },
    compareEnd:   { ...ymd(realCompareEnd), iso: ymd(realCompareEnd).iso },
    thisMonth, lastMonth,
  };
}

function nowIstIso() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString();
}

// ─── Misc helpers ─────────────────────────────────────────────────────────
async function runAll(tasksObj) {
  const keys = Object.keys(tasksObj);
  const settled = await Promise.allSettled(keys.map(k => tasksObj[k]));
  const out = {};
  keys.forEach((k, i) => {
    if (settled[i].status === 'fulfilled') out[k] = settled[i].value;
    else out[k] = { error: settled[i].reason?.message || String(settled[i].reason) };
  });
  return out;
}

function sumOf(obj, keys) { return keys.reduce((s, k) => s + (obj[k] || 0), 0); }

function pct(now, prev) {
  if (!prev) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: CORS });
}
