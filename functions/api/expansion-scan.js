/**
 * HN Hotels — Expansion Intelligence API
 * Cloudflare Pages Function
 *
 * Two-source expansion scouting:
 *   1. NoBroker — commercial rental listings (primary, most accurate)
 *   2. Google Places — closed business markers (supplementary signal)
 *
 * Endpoints:
 *   GET  /api/expansion-scan?action=geocode&q=Indiranagar   → lat/lng lookup
 *   GET  /api/expansion-scan?action=presets                  → preset zone list
 *   POST /api/expansion-scan { action:"scan_nobroker", lat, lng, location_name }
 *   POST /api/expansion-scan { action:"scan", lat, lng, radius, types, location_name }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ─── Preset Zones ──────────────────────────────────────────
const PRESET_ZONES = [
  { name: "Fraser Town",       lat: 12.9850, lng: 77.6100 },
  { name: "Mosque Road",       lat: 12.9980, lng: 77.5870 },
  { name: "Shivajinagar",      lat: 12.9857, lng: 77.5912 },
  { name: "Cox Town",          lat: 12.9900, lng: 77.6150 },
  { name: "Richards Town",     lat: 12.9920, lng: 77.6050 },
  { name: "Commercial Street", lat: 12.9830, lng: 77.6080 },
  { name: "Indiranagar",       lat: 12.9784, lng: 77.6408 },
  { name: "Koramangala",       lat: 12.9352, lng: 77.6245 },
  { name: "Jayanagar",         lat: 12.9308, lng: 77.5838 },
  { name: "Whitefield",        lat: 12.9698, lng: 77.7500 },
  { name: "HSR Layout",        lat: 12.9116, lng: 77.6389 },
  { name: "JP Nagar",          lat: 12.9063, lng: 77.5857 },
  { name: "Malleshwaram",      lat: 12.9965, lng: 77.5700 },
  { name: "Basavanagudi",      lat: 12.9430, lng: 77.5750 },
  { name: "RT Nagar",          lat: 13.0210, lng: 77.5970 },
  { name: "Yelahanka",         lat: 13.1007, lng: 77.5963 },
];

// ─── Brand Fit Classification ──────────────────────────────
const HE_TYPES = new Set([
  "restaurant", "bar", "meal_takeaway", "meal_delivery",
  "indian_restaurant", "middle_eastern_restaurant", "asian_restaurant",
  "night_club", "food_court",
]);
const NCH_TYPES = new Set([
  "cafe", "bakery", "tea_house", "coffee_shop", "ice_cream_shop",
]);

// ─── Helpers ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isClosed(s) {
  return s === "CLOSED_PERMANENTLY" || s === "CLOSED_TEMPORARILY";
}

function scoreLead(status, lastReviewDate) {
  if (status === "CLOSED_TEMPORARILY") return "HOT";
  if (!lastReviewDate) return "COLD";
  const months = (Date.now() - new Date(lastReviewDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 6) return "HOT";
  if (months <= 12) return "WARM";
  return "COLD";
}

function classifyBrandFit(types) {
  const he = types.some(t => HE_TYPES.has(t));
  const nch = types.some(t => NCH_TYPES.has(t));
  if (he && nch) return "HE + NCH";
  if (nch) return "NCH Fit";
  return "HE Fit";
}

function noBrokerURL(lat, lng) {
  return `https://www.nobroker.in/commercial-properties-for-rent-in-bangalore_bangalore?searchParam=AQAAAAAGe1dv&radius=0.5&lat=${lat}&lng=${lng}`;
}

function getLastReviewDate(reviews) {
  if (!reviews || !reviews.length) return null;
  let latest = null;
  for (const r of reviews) {
    if (r.publishTime) {
      const d = new Date(r.publishTime);
      if (!latest || d > latest) latest = d;
    }
  }
  return latest ? latest.toISOString().slice(0, 10) : null;
}

function closedSinceDays(lastReviewDate) {
  if (!lastReviewDate) return null;
  return Math.floor((Date.now() - new Date(lastReviewDate).getTime()) / (1000 * 60 * 60 * 24));
}

function matchesZones(lat, lng, radiusKm) {
  return PRESET_ZONES
    .filter(z => haversineKm(lat, lng, z.lat, z.lng) <= radiusKm)
    .map(z => z.name);
}

// ─── Google Places API (New) wrappers ──────────────────────
const FM_SEARCH = "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.types,places.rating,places.userRatingCount,places.location,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri";
const FM_DETAIL = "id,displayName,formattedAddress,businessStatus,types,rating,userRatingCount,nationalPhoneNumber,websiteUri,googleMapsUri,location,reviews";

async function placesNearby(apiKey, lat, lng, radius, type) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FM_SEARCH,
    },
    body: JSON.stringify({
      includedTypes: [type],
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      maxResultCount: 20,
    }),
  });
  const d = await res.json();
  return d.places || [];
}

async function placesTextSearch(apiKey, query, lat, lng, radius) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FM_SEARCH,
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      maxResultCount: 20,
    }),
  });
  const d = await res.json();
  return d.places || [];
}

async function placeDetails(apiKey, placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FM_DETAIL },
  });
  if (!res.ok) return null;
  return res.json();
}

async function placesGeocode(apiKey, query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location,places.formattedAddress,places.displayName",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  const d = await res.json();
  if (d.places && d.places.length > 0) {
    const p = d.places[0];
    return {
      lat: p.location.latitude,
      lng: p.location.longitude,
      formatted_address: p.formattedAddress,
      name: p.displayName?.text,
    };
  }
  return null;
}

// ─── Scan Engine ───────────────────────────────────────────
async function runScan(apiKey, { lat, lng, radius, types, location_name }) {
  const closedMap = new Map();
  const radiusM = radius || 3000;
  const radiusKm = radiusM / 1000;
  const searchTypes = types && types.length ? types : ["restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery"];
  const locName = location_name || "this area";

  const phases = { nearby: 0, text: 0, details: 0, replacement: 0 };

  // Phase 1: Nearby Search
  for (const type of searchTypes) {
    const places = await placesNearby(apiKey, lat, lng, radiusM, type);
    phases.nearby++;
    for (const p of places) {
      if (isClosed(p.businessStatus) && !closedMap.has(p.id)) {
        closedMap.set(p.id, p);
      }
    }
    await sleep(150);
  }

  // Phase 2: Text Search — targeted queries for closed businesses
  const textQueries = [];
  const typeKeywords = {
    restaurant: ["closed restaurant", "permanently closed restaurant", "closed hotel", "closed biryani", "closed dhaba"],
    cafe: ["closed cafe", "closed coffee shop"],
    bakery: ["closed bakery", "closed sweets shop"],
    bar: ["closed bar", "closed pub", "closed brewery"],
    meal_takeaway: ["closed takeaway", "closed fast food"],
    meal_delivery: ["closed delivery kitchen", "closed cloud kitchen"],
  };
  for (const type of searchTypes) {
    const kws = typeKeywords[type] || [`closed ${type}`];
    for (const kw of kws) {
      textQueries.push(`${kw} in ${locName} Bangalore`);
    }
  }
  // Also do general searches that return closed businesses via businessStatus
  for (const type of searchTypes) {
    textQueries.push(`${type} in ${locName} Bangalore`);
  }

  for (const q of textQueries) {
    const places = await placesTextSearch(apiKey, q, lat, lng, radiusM);
    phases.text++;
    for (const p of places) {
      if (isClosed(p.businessStatus) && !closedMap.has(p.id)) {
        const pLat = p.location?.latitude;
        const pLng = p.location?.longitude;
        if (pLat && pLng && haversineKm(lat, lng, pLat, pLng) <= radiusKm) {
          closedMap.set(p.id, p);
        }
      }
    }
    await sleep(100);
  }

  // Phase 3: Detail Fetch + Phase 4: Replacement Check
  const leads = [];

  for (const [pid, p] of closedMap) {
    // Fetch details (reviews)
    const detail = await placeDetails(apiKey, pid);
    phases.details++;
    await sleep(100);

    const d = detail || p;
    const name = d.displayName?.text || "(unknown)";
    const status = d.businessStatus || p.businessStatus;
    const placeTypes = d.types || p.types || [];
    const pLat = d.location?.latitude || p.location?.latitude;
    const pLng = d.location?.longitude || p.location?.longitude;
    const lastReview = detail ? getLastReviewDate(d.reviews) : null;
    const score = scoreLead(status, lastReview);
    const daysClosed = closedSinceDays(lastReview);

    // Replacement check — search 50m radius for operational business
    let replacedBy = null;
    let replacedByTypes = null;
    if (pLat && pLng) {
      const primaryType = placeTypes.find(t =>
        HE_TYPES.has(t) || NCH_TYPES.has(t)
      ) || "restaurant";
      const nearby = await placesNearby(apiKey, pLat, pLng, 50, primaryType);
      phases.replacement++;
      for (const n of nearby) {
        if (n.businessStatus === "OPERATIONAL" && n.id !== pid) {
          replacedBy = {
            name: n.displayName?.text,
            rating: n.rating,
            types: n.types,
            google_maps_url: n.googleMapsUri,
          };
          break;
        }
      }
      await sleep(100);
    }

    const nearbyZones = matchesZones(pLat, pLng, 3);

    leads.push({
      place_id: pid,
      name,
      business_status: status,
      score,
      brand_fit: classifyBrandFit(placeTypes),
      address: d.formattedAddress || p.formattedAddress || "",
      nearby_zones: nearbyZones,
      rating: d.rating || null,
      user_ratings_total: d.userRatingCount || 0,
      phone: d.nationalPhoneNumber || "",
      website: d.websiteUri || "",
      google_maps_url: d.googleMapsUri || "",
      nobroker_url: noBrokerURL(pLat, pLng),
      last_review_date: lastReview || null,
      days_closed: daysClosed,
      types: placeTypes,
      lat: pLat,
      lng: pLng,
      replaced_by: replacedBy,
      space_available: !replacedBy,
    });
  }

  // Sort: HOT > WARM > COLD, then by space_available (true first), then rating desc
  const ord = { HOT: 0, WARM: 1, COLD: 2 };
  leads.sort((a, b) => {
    const s = ord[a.score] - ord[b.score];
    if (s !== 0) return s;
    if (a.space_available !== b.space_available) return a.space_available ? -1 : 1;
    return (b.rating || 0) - (a.rating || 0);
  });

  // Summary stats
  const summary = {
    total: leads.length,
    by_score: { HOT: 0, WARM: 0, COLD: 0 },
    by_status: {},
    by_brand: {},
    space_available: 0,
    replaced: 0,
    api_calls: phases.nearby + phases.text + phases.details + phases.replacement,
    phases,
  };
  for (const l of leads) {
    summary.by_score[l.score] = (summary.by_score[l.score] || 0) + 1;
    summary.by_status[l.business_status] = (summary.by_status[l.business_status] || 0) + 1;
    summary.by_brand[l.brand_fit] = (summary.by_brand[l.brand_fit] || 0) + 1;
    if (l.space_available) summary.space_available++;
    else summary.replaced++;
  }

  return { leads, summary, search: { lat, lng, radius: radiusM, types: searchTypes, location_name: locName } };
}

// ─── NoBroker Scan Engine ─────────────────────────────────
const NB_API = "https://www.nobroker.in/api/v3/multi/property/COMMERCIAL_RENT/filter";
const NB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

// Food-service suitable property types on NoBroker
const NB_FOOD_TYPES = new Set(["SHOP", "RESTAURANT_CAFE", "SHOWROOM", "OTHER_BUSINESS"]);

function buildSearchParam(lat, lng, placeName) {
  const payload = [{ lat, lon: lng, placeId: "", placeName: placeName || "Search Area", showMap: false }];
  // btoa for base64 in Workers
  return btoa(JSON.stringify(payload));
}

function classifyNBBrandFit(rent, sqft, propType) {
  // NCH: smaller spaces, lower rent — chai cafe footprint ~500 sqft
  // HE: larger spaces, full restaurant — ~1000 sqft
  if (propType === "RESTAURANT_CAFE") return rent <= 50000 ? "HE + NCH" : "HE Fit";
  if (sqft > 0 && sqft <= 600 && rent <= 50000) return "NCH Fit";
  if (sqft > 800 || rent > 50000) return "HE Fit";
  return "HE + NCH"; // Unknown size — could work for either
}

function nbListingURL(id) {
  return `https://www.nobroker.in/property/commercial/rent/bangalore/${id}`;
}

async function runNoBrokerScan({ lat, lng, location_name }) {
  const searchParam = buildSearchParam(lat, lng, location_name);
  const allListings = [];
  let page = 1;
  const maxPages = 8; // ~200 listings max, avoid excessive calls

  while (page <= maxPages) {
    const url = `${NB_API}?pageNo=${page}&searchParam=${searchParam}&city=bangalore`;
    try {
      const res = await fetch(url, { headers: NB_HEADERS });
      const data = await res.json();
      if (data.status !== "success" || !data.data || data.data.length === 0) break;
      allListings.push(...data.data);
      // Check if we've fetched all
      const totalCount = data.otherParams?.total_count || 0;
      if (allListings.length >= totalCount) break;
      page++;
      await sleep(200);
    } catch (e) {
      break;
    }
  }

  // Filter for food-service suitable property types
  const leads = [];
  for (const p of allListings) {
    const propType = p.commercialPropertyType || "";
    if (!NB_FOOD_TYPES.has(propType)) continue;

    const rent = p.rent || 0;
    const sqft = p.propertySize || 0;
    const deposit = p.deposit || 0;
    const pLat = p.latitude;
    const pLng = p.longitude;
    const situation = p.aea__?.CURRENT_SITUATION?.display_value || "";
    const directions = p.aea__?.DIRECTIONS?.value || "";
    const furnishing = p.furnishingDesc || "";
    const floor = p.floorNo;
    const totalFloor = p.totalFloor;
    const negotiable = p.negotiable || false;
    const availFrom = p.availableFrom ? new Date(p.availableFrom).toISOString().slice(0, 10) : null;
    const lastUpdated = p.lastUpdateDate ? new Date(p.lastUpdateDate).toISOString().slice(0, 10) : null;
    const photos = (p.photos || []).slice(0, 4).map(ph => {
      const thumb = ph.imagesMap?.thumbnail || ph.imagesMap?.medium || "";
      return thumb ? `https:${thumb}` : null;
    }).filter(Boolean);

    const nearbyZones = matchesZones(pLat, pLng, 3);
    const brandFit = classifyNBBrandFit(rent, sqft, propType);

    // Score: Vacant + recent listing = HOT, etc.
    let score = "WARM";
    if (situation === "Vacant") score = "HOT";
    else if (situation === "Own Business") score = "COLD"; // owner running own business, may not actually vacate
    // Boost if listing is very fresh (updated in last 7 days)
    if (lastUpdated) {
      const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 7 && score !== "HOT") score = "HOT";
    }

    leads.push({
      source: "nobroker",
      id: p.id,
      title: p.propertyTitle || "",
      property_type: propType,
      property_type_label: propType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
      sqft,
      rent,
      deposit,
      brand_fit: brandFit,
      score,
      situation, // Vacant, Own Business, or empty
      address: p.street || "",
      locality: p.localityTruncated || "",
      owner_name: p.ownerName || "",
      furnishing,
      floor: floor != null ? floor : null,
      total_floor: totalFloor || null,
      negotiable,
      available_from: availFrom,
      last_updated: lastUpdated,
      photos,
      lat: pLat,
      lng: pLng,
      nearby_zones: nearbyZones,
      nobroker_url: nbListingURL(p.id),
      google_maps_url: `https://www.google.com/maps?q=${pLat},${pLng}`,
      parking: p.parkingDesc || "",
    });
  }

  // Sort: HOT first, then by rent ascending (cheapest first for budget consciousness)
  const ord = { HOT: 0, WARM: 1, COLD: 2 };
  leads.sort((a, b) => {
    const s = ord[a.score] - ord[b.score];
    if (s !== 0) return s;
    return a.rent - b.rent;
  });

  // Summary
  const summary = {
    total: leads.length,
    total_commercial: allListings.length,
    pages_fetched: page,
    by_score: { HOT: 0, WARM: 0, COLD: 0 },
    by_type: {},
    by_brand: {},
    avg_rent: leads.length ? Math.round(leads.reduce((s, l) => s + l.rent, 0) / leads.length) : 0,
    vacant_count: leads.filter(l => l.situation === "Vacant").length,
  };
  for (const l of leads) {
    summary.by_score[l.score] = (summary.by_score[l.score] || 0) + 1;
    summary.by_type[l.property_type_label] = (summary.by_type[l.property_type_label] || 0) + 1;
    summary.by_brand[l.brand_fit] = (summary.by_brand[l.brand_fit] || 0) + 1;
  }

  return { leads, summary, search: { lat, lng, location_name } };
}

// ─── Request Handler ───────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const apiKey = env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return json({ ok: false, error: "GOOGLE_PLACES_API_KEY not configured" }, 500);
  }

  try {
    // ── GET handlers ──
    if (request.method === "GET") {
      const action = url.searchParams.get("action");

      if (action === "geocode") {
        const q = url.searchParams.get("q");
        if (!q) return json({ ok: false, error: "Missing q parameter" }, 400);
        const result = await placesGeocode(apiKey, q + " Bangalore");
        if (!result) return json({ ok: false, error: "Location not found" }, 404);
        return json({ ok: true, ...result });
      }

      if (action === "presets") {
        return json({ ok: true, zones: PRESET_ZONES });
      }

      return json({ ok: false, error: "Unknown action" }, 400);
    }

    // ── POST handlers ──
    if (request.method === "POST") {
      const body = await request.json();

      if (body.action === "scan_nobroker") {
        if (!body.lat || !body.lng) {
          return json({ ok: false, error: "lat and lng are required" }, 400);
        }
        const result = await runNoBrokerScan(body);
        return json({ ok: true, ...result });
      }

      if (body.action === "scan") {
        if (!body.lat || !body.lng) {
          return json({ ok: false, error: "lat and lng are required" }, 400);
        }
        const result = await runScan(apiKey, body);
        return json({ ok: true, ...result });
      }

      return json({ ok: false, error: "Unknown action" }, 400);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
