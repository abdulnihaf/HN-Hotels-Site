// HN Hotels — Google Business Profile Cockpit API
// GET /api/gbp-cockpit?brand=he|nch&period=7d|28d|90d&compare=prior|yoy|off&include=summary,daily,keywords,profile,reviews,health
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
  const include = (url.searchParams.get('include') || 'summary,daily,keywords,profile,reviews,health')
    .split(',').map(s => s.trim()).filter(Boolean);

  // GBP Performance API data lags 1-2 days. Use today-2 as endDate to ensure data exists.
  const period = resolvePeriod(periodKey, compareMode);

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
    if (include.includes('profile') || include.includes('health')) {
      tasks.profile = fetchProfile(token, brand.location);
    }
    if (include.includes('reviews') || include.includes('profile')) {
      tasks.places = fetchPlaceDetails(env, brand.placeId);
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
        label: periodKey,
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
  const readMask = [
    'name','title','storeCode',
    'phoneNumbers.primaryPhone','phoneNumbers.additionalPhones',
    'categories.primaryCategory.displayName','categories.primaryCategory.name',
    'categories.additionalCategories.displayName',
    'websiteUri',
    'regularHours','specialHours',
    'profile.description',
    'metadata.placeId','metadata.mapsUri','metadata.newReviewUri','metadata.canHaveFoodMenus',
    'openInfo.status','openInfo.canReopen',
    'serviceArea',
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

// ─── Date helpers ─────────────────────────────────────────────────────────
function resolvePeriod(label, compareMode) {
  // GBP performance data is T-2. End at 2 days ago to ensure rows exist.
  const nowMs = Date.now() + 5.5 * 3600000;
  const today = new Date(nowMs);
  const end   = new Date(nowMs - 2 * 86400000);
  const days = label === 'today' ? 1 : label === 'yesterday' ? 1 : label === '7d' ? 7 : label === '28d' ? 28 : label === '90d' ? 90 : 7;
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
    days, label,
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
