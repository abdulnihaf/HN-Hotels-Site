// /api/choreo/jwt
//
// Returns a valid PiSignage JWT for direct CDN access by the synchronizer page.
// Cached in module-level memory per worker isolate (~30 min lifespan).
// This drastically reduces session-refresh calls vs proxying every asset.

const PISIGNAGE_BASE = "https://hamzaexpress.pisignage.com";
const REFRESH_MARGIN_MS = 30 * 60 * 1000; // refresh if <30min until expiry

// Per-isolate JWT cache
let cachedToken = null;
let cachedExp = 0;
let lastRefreshAttempt = 0;

function jwtExp(token) {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).exp * 1000;
  } catch (_) {
    return 0;
  }
}

async function refreshJwt(env) {
  // Throttle refresh attempts (in case rate-limited): skip if last attempt was <60s ago
  const now = Date.now();
  if (now - lastRefreshAttempt < 60_000 && cachedToken) {
    return cachedToken;
  }
  lastRefreshAttempt = now;

  const r = await fetch(`${PISIGNAGE_BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.PISIGNAGE_EMAIL,
      password: env.PISIGNAGE_PASSWORD,
      getToken: true,
    }),
  });
  if (r.status === 429 && cachedToken) {
    // Rate limited — return whatever we have, even if expiring
    return cachedToken;
  }
  if (!r.ok) {
    throw new Error("session HTTP " + r.status);
  }
  const j = await r.json();
  if (!j.token) throw new Error("no token in response");
  cachedToken = j.token;
  cachedExp = jwtExp(j.token);
  return j.token;
}

export async function onRequest(context) {
  const { env } = context;
  try {
    if (!env.PISIGNAGE_EMAIL || !env.PISIGNAGE_PASSWORD) {
      return jsonResp({ error: "missing email/password secrets" }, 500);
    }

    let token = cachedToken;
    if (!token || cachedExp - Date.now() < REFRESH_MARGIN_MS) {
      try {
        token = await refreshJwt(env);
      } catch (e) {
        if (cachedToken) {
          // Best effort — return stale token if refresh failed
          token = cachedToken;
        } else {
          return jsonResp({ error: "refresh: " + (e.message || String(e)) }, 502);
        }
      }
    }

    return jsonResp({ token, exp: cachedExp });
  } catch (e) {
    return jsonResp({ error: "top: " + (e.message || String(e)) }, 500);
  }
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600", // browser cache 10min
      "Access-Control-Allow-Origin": "*",
    },
  });
}
