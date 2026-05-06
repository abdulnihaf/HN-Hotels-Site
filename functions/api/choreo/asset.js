// /api/choreo/asset?f=<filename>
//
// Asset proxy for HE choreography synchronizer.
// Fetches images/videos from PiSignage CDN with JWT authentication and
// streams them back to the WebView. The JWT is cached in KV (4hr TTL)
// and refreshed on demand using PiSignage email/password (Cloudflare secrets).
//
// Required Cloudflare secrets:
//   PISIGNAGE_EMAIL, PISIGNAGE_PASSWORD
// Required KV binding:
//   SESSIONS (already configured in wrangler.toml)
//
// JWT cache key: "pisignage:jwt"

const PISIGNAGE_BASE = "https://hamzaexpress.pisignage.com";
const KV_KEY = "pisignage:jwt";
const JWT_REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh if <5min until expiry

// Whitelist of allowed filenames — prevents arbitrary path access via the proxy.
// Keep in sync with registry/assets.json.
const ALLOWED = new Set([
  "Final_v3_TV-V1_C2_GheeRice_DalFry_Kabab.png",
  "Video_v3_TV-V1_C2_GheeRice_DalFry_Kabab.mp4",
  "Final_v3_TV-V2_C1_GheeRice_DalFry.png",
  "Video_v3_TV-V2_C1_GheeRice_DalFry.mp4",
  "Final_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.png",
  "Video_v3_TV-V3_C3_GheeRice_ButterChicken_Kabab.mp4",
  "Final_v3_TV-V4_C4_GheeRice_MuttonChatpata_Kabab.png",
  "Video_v3_TV-V4_C4_GheeRice_MuttonChatpata_Kabab.mp4",
  "Final_v3_TV-V5_C5_ChickenBiryani_Kabab.png",
  "Video_v3_TV-V5_C5_ChickenBiryani_Kabab.mp4",
  "Final_v3_TV-V6_C6_MuttonBiryani_Kabab.png",
  "Video_v3_TV-V6_C6_MuttonBiryani_Kabab.mp4",
  "Final_v3_TV-V7_GR_ProteinPair_C3_C4.png",
  "Final_v3_TV-V8_GR_VegPair_C1_C2.png",
  "Final_v3_TV-V9_Biryani_Pair_C5_C6.png",
  "Final_v3_TV-V10_GR_AllInOne_C1_C2_C3_C4.png",
  "Final_v3_TV-V11_K1_Chicken_Kathi.png",
  "Video_v3_TV-V11_K1_Chicken_Kathi_c.mp4",
  "Final_v3_TV-V12_KT_Chicken_Tikka_Kathi.png",
  "Video_v3_TV-V12_KT_Chicken_Tikka_Kathi_c.mp4",
  "Final_v3_TV-V13_Kathi_Pair_K1_KT.png",
]);

function jwtExp(token) {
  try {
    const [, payload] = token.split(".");
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.exp ? decoded.exp * 1000 : 0;
  } catch (_) { return 0; }
}

async function refreshJwt(env) {
  const r = await fetch(`${PISIGNAGE_BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.PISIGNAGE_EMAIL,
      password: env.PISIGNAGE_PASSWORD,
      getToken: true,
    }),
  });
  if (!r.ok) throw new Error("session refresh HTTP " + r.status);
  const j = await r.json();
  if (!j.token) throw new Error("no token in session response");
  await env.SESSIONS.put(KV_KEY, j.token, { expirationTtl: 4 * 60 * 60 });
  return j.token;
}

async function getJwt(env) {
  let token = await env.SESSIONS.get(KV_KEY);
  if (token) {
    const exp = jwtExp(token);
    if (!exp || exp - Date.now() < JWT_REFRESH_MARGIN_MS) token = null;
  }
  if (!token) token = await refreshJwt(env);
  return token;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const filename = url.searchParams.get("f");

  if (!filename) {
    return new Response("missing ?f=", { status: 400 });
  }
  if (!ALLOWED.has(filename)) {
    return new Response("filename not allowed", { status: 403 });
  }
  if (!env.PISIGNAGE_EMAIL || !env.PISIGNAGE_PASSWORD) {
    return new Response(
      "server not configured: set PISIGNAGE_EMAIL + PISIGNAGE_PASSWORD secrets",
      { status: 500 }
    );
  }

  let token;
  try {
    token = await getJwt(env);
  } catch (e) {
    return new Response("auth: " + e.message, { status: 502 });
  }

  const upstream = `${PISIGNAGE_BASE}/media/hamzaexpress/${encodeURIComponent(filename)}`;
  const upstreamResp = await fetch(upstream, {
    headers: { "x-access-token": token },
    cf: { cacheTtl: 86400, cacheEverything: true },
  });

  if (upstreamResp.status === 401) {
    // JWT may have been invalidated server-side — force refresh once
    try {
      token = await refreshJwt(env);
      const retry = await fetch(upstream, { headers: { "x-access-token": token } });
      return passthrough(retry);
    } catch (e) {
      return new Response("upstream auth retry failed: " + e.message, { status: 502 });
    }
  }
  return passthrough(upstreamResp);
}

function passthrough(r) {
  const h = new Headers();
  const ct = r.headers.get("Content-Type");
  if (ct) h.set("Content-Type", ct);
  const cl = r.headers.get("Content-Length");
  if (cl) h.set("Content-Length", cl);
  // Cache aggressively — assets are immutable v3 files.
  h.set("Cache-Control", "public, max-age=86400, immutable");
  h.set("Access-Control-Allow-Origin", "*");
  return new Response(r.body, { status: r.status, headers: h });
}
