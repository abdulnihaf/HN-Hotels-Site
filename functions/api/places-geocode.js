// Lightweight Places-API lookup — given a placeId, return its lat/lng.
// Used by tooling that needs to set Google Ads PROXIMITY criteria around a
// physical location (e.g. fixing the 2026-05-12 Gurugram→Bangalore blunder
// by re-anchoring PMax to a 2km circle around HE Shivajinagar).
//
// GET /api/places-geocode?placeId=ChIJ...

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const placeId = url.searchParams.get('placeId');
  if (!placeId) return j({ error: 'placeId required' }, 400);
  if (!env.GOOGLE_PLACES_API_KEY) return j({ error: 'GOOGLE_PLACES_API_KEY not set' }, 500);

  try {
    const r = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=displayName,location,formattedAddress`,
      { headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY } },
    );
    const d = await r.json();
    if (!r.ok) return j({ error: d.error?.message || `Places ${r.status}`, raw: d }, 500);
    return j({
      placeId,
      name: d.displayName?.text,
      formattedAddress: d.formattedAddress,
      latitude: d.location?.latitude,
      longitude: d.location?.longitude,
    });
  } catch (e) {
    return j({ error: e.message }, 500);
  }
}

function j(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}
