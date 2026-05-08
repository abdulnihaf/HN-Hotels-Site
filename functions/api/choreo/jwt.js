// /api/choreo/jwt
//
// Returns a valid PiSignage JWT for direct CDN access by the synchronizer.
// JWT cached in SESSIONS KV (shared across all isolates) with 4hr TTL.
// In-memory cache layer on top to skip the KV roundtrip when JWT is hot.
// On rate-limit (HTTP 429) from PiSignage, returns the stale token rather
// than crashing.

const PISIGNAGE_BASE = "https://hamzaexpress.pisignage.com";
const KV_KEY = "pisignage:jwt";
const REFRESH_MARGIN_MS = 30 * 60 * 1000;     // refresh if <30min until expiry
const REFRESH_THROTTLE_MS = 60 * 1000;        // skip refresh if attempted in last 60s

// In-memory cache (per isolate)
let memToken = null;
let memExp = 0;
let lastRefreshAttempt = 0;

function jwtExp(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).exp * 1000;
  } catch (_) {
    return 0;
  }
}

async function tryRefresh(env) {
  const now = Date.now();
  if (now - lastRefreshAttempt < REFRESH_THROTTLE_MS) return null;
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

  if (!r.ok) return null; // includes 429 rate-limit — handled by caller
  let j;
  try { j = await r.json(); } catch (_) { return null; }
  if (!j.token) return null;

  memToken = j.token;
  memExp = jwtExp(j.token);
  if (env.SESSIONS) {
    try { await env.SESSIONS.put(KV_KEY, j.token, { expirationTtl: 4 * 3600 }); }
    catch (_) {}
  }
  return j.token;
}

async function loadFromKv(env) {
  if (!env.SESSIONS) return null;
  try {
    const t = await env.SESSIONS.get(KV_KEY);
    if (t) {
      memToken = t;
      memExp = jwtExp(t);
    }
    return t;
  } catch (_) {
    return null;
  }
}

export async function onRequest(context) {
  const { env } = context;
  try {
    if (!env.PISIGNAGE_EMAIL || !env.PISIGNAGE_PASSWORD) {
      return jsonResp({ error: "missing PISIGNAGE_EMAIL/PASSWORD secrets" }, 500);
    }

    let token = memToken;
    let exp = memExp;

    // 1. Use in-memory cache if fresh enough
    const now = Date.now();
    if (token && exp - now > REFRESH_MARGIN_MS) {
      return jsonResp({ token, exp, source: "mem" });
    }

    // 2. Fall through to KV if memory is empty/stale
    if (!token || exp - now < REFRESH_MARGIN_MS) {
      const kvToken = await loadFromKv(env);
      if (kvToken) {
        token = kvToken;
        exp = memExp;
        if (exp - now > REFRESH_MARGIN_MS) {
          return jsonResp({ token, exp, source: "kv" });
        }
      }
    }

    // 3. Need a fresh refresh — try, but degrade gracefully
    const fresh = await tryRefresh(env);
    if (fresh) {
      return jsonResp({ token: fresh, exp: memExp, source: "fresh" });
    }

    // 4. Refresh failed (rate-limit or upstream issue) — return whatever we have
    if (token) {
      return jsonResp({ token, exp, source: "stale", warning: "refresh failed" });
    }

    // 5. Nothing usable — true 503
    return jsonResp({ error: "no token available; PiSignage refresh failed" }, 503);
  } catch (e) {
    return jsonResp({ error: "top: " + (e.message || String(e)) }, 500);
  }
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
