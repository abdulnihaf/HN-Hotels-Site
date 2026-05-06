// /api/choreo/jwt — DEBUG MODE: returns simple JSON to test module loading

export async function onRequest(context) {
  try {
    const env = context.env;
    return new Response(JSON.stringify({
      ok: true,
      ts: Date.now(),
      hasEmail: !!env.PISIGNAGE_EMAIL,
      hasPassword: !!env.PISIGNAGE_PASSWORD,
      hasSessions: !!env.SESSIONS,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response("err: " + (e.message || String(e)), { status: 500 });
  }
}
