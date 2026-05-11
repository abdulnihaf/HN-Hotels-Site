// HN Hotels — Google Business Profile Cockpit API
// GET /api/gbp-cockpit?brand=he|nch&period=7d|28d|90d&compare=prior|yoy|off
//   &include=summary,daily,keywords,profile,reviews,health,media,qanda,actionQueue,algorithmTips
//
// Default include set covers the operations layer: summary,daily,keywords,
// profile,reviews,health,media,qanda,actionQueue,algorithmTips
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
  },
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
  const include = (url.searchParams.get('include') || 'summary,daily,keywords,profile,reviews,health,media,qanda,actionQueue,algorithmTips')
    .split(',').map(s => s.trim()).filter(Boolean);

  // GBP Performance API data lags 1-2 days. Use today-2 as endDate to ensure data exists.
  const period = resolvePeriod(periodKey, compareMode, customFrom, customTo);

  try {
    const token = await getAccessToken(env);

    const tasks = {};
    if (include.includes('summary') || include.includes('daily')) {
      tasks.perf = fetchPerformance(token, brand.location, period.startDate, period.endDate);
      if (compareMode !== 'off') {
        tasks.perfPrior = fetchPerformance(token, brand.location, period.compareStart, period.compareEnd);
      }
    }
    if (include.includes('keywords')) {
      tasks.kwThis = fetchKeywords(token, brand.location, period.thisMonth);
      tasks.kwPrev = fetchKeywords(token, brand.location, period.lastMonth);
    }
    if (include.includes('profile') || include.includes('health') ||
        include.includes('actionQueue') || include.includes('algorithmTips')) {
      tasks.profile = fetchProfile(token, brand.location);
    }
    if (include.includes('reviews') || include.includes('profile') || include.includes('actionQueue')) {
      tasks.places = fetchPlaceDetails(env, brand.placeId);
    }
    if (include.includes('media') || include.includes('actionQueue')) {
      tasks.media = fetchMedia(token, brand.location);
    }
    if (include.includes('qanda') || include.includes('actionQueue')) {
      tasks.qanda = fetchQandA(token, brand.location);
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

    if (results.perf) {
      out.summary = buildSummary(results.perf, results.perfPrior);
      if (include.includes('daily')) out.daily = buildDaily(results.perf);
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
