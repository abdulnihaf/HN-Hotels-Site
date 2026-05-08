// /api/choreo/asset?f=<filename>
//
// Streams PiSignage CDN assets through Cloudflare. The JWT comes from our
// own /api/choreo/jwt endpoint (which handles KV caching + rate-limit
// resilience), so this proxy is stateless and never triggers a session
// refresh against PiSignage on its own.

const PISIGNAGE_BASE = "https://hamzaexpress.pisignage.com";

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

export async function onRequest(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);
    const f = url.searchParams.get("f");
    if (!f) return new Response("missing ?f=", { status: 400 });
    if (!ALLOWED.has(f))
      return new Response("filename not allowed: " + f, { status: 403 });

    // Fetch JWT from our own endpoint (KV-cached + graceful failure handled there)
    const tokenUrl = new URL("/api/choreo/jwt", url.origin).toString();
    let token;
    try {
      const tr = await fetch(tokenUrl);
      if (!tr.ok) {
        return new Response("jwt-endpoint HTTP " + tr.status, { status: 502 });
      }
      const tj = await tr.json();
      token = tj.token;
      if (!token) {
        return new Response("jwt-endpoint returned no token: " + JSON.stringify(tj), {
          status: 502,
        });
      }
    } catch (e) {
      return new Response("jwt-fetch: " + (e.message || String(e)), { status: 502 });
    }

    // Stream from PiSignage CDN
    let upstream;
    try {
      upstream = await fetch(
        `${PISIGNAGE_BASE}/media/hamzaexpress/${encodeURIComponent(f)}`,
        { headers: { "x-access-token": token } }
      );
    } catch (e) {
      return new Response("upstream-fetch: " + (e.message || String(e)), { status: 502 });
    }

    if (!upstream.ok) {
      return new Response("upstream HTTP " + upstream.status, { status: upstream.status });
    }

    const h = new Headers();
    const ct = upstream.headers.get("Content-Type");
    if (ct) h.set("Content-Type", ct);
    const cl = upstream.headers.get("Content-Length");
    if (cl) h.set("Content-Length", cl);
    h.set("Cache-Control", "public, max-age=86400, immutable");
    h.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, { status: 200, headers: h });
  } catch (e) {
    return new Response("top: " + (e.message || String(e)), { status: 500 });
  }
}
