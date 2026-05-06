// /api/choreo/time
// Master clock for HE choreography synchronizer.
// All 4 vertical TVs query this to align their local clocks before
// computing the current slot index.

export async function onRequest(context) {
  const now = Date.now();
  return new Response(JSON.stringify({ now }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
