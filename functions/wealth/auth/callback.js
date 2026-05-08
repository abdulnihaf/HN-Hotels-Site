// ═══════════════════════════════════════════════════════════════════════════
// /wealth/auth/callback — Kite Connect OAuth callback handler
//
// Kite redirects here after user logs in:
//   https://app.hnhotels.in/wealth/auth/callback?status=success&request_token=XYZ
//
// We exchange the request_token for an access_token by POSTing to
// https://api.kite.trade/session/token with checksum = SHA256(api_key + request_token + api_secret)
//
// On success: store access_token in D1.kite_tokens, redirect user back to /trading.
// On failure: render an error page with the upstream message.
// ═══════════════════════════════════════════════════════════════════════════

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const requestToken = url.searchParams.get('request_token');
  const action = url.searchParams.get('action');

  if (status !== 'success' || !requestToken) {
    return errorPage(`Kite OAuth returned status=${status || 'missing'}. Please re-initiate from /trading.`);
  }

  const apiKey = env.KITE_API_KEY;
  const apiSecret = env.KITE_API_SECRET;
  if (!apiKey || !apiSecret) {
    return errorPage('KITE_API_KEY or KITE_API_SECRET not configured. Run: wrangler pages secret put KITE_API_SECRET --project-name hn-hotels-site');
  }

  // checksum = SHA256(api_key + request_token + api_secret)
  const enc = new TextEncoder().encode(apiKey + requestToken + apiSecret);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  const checksum = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

  const formBody = new URLSearchParams({
    api_key: apiKey,
    request_token: requestToken,
    checksum,
  });

  let kiteResp;
  try {
    const r = await fetch('https://api.kite.trade/session/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Kite-Version': '3',
      },
      body: formBody.toString(),
    });
    kiteResp = await r.json();
    if (!r.ok || kiteResp.status !== 'success') {
      return errorPage(`Kite session/token failed: ${kiteResp.message || r.status}`);
    }
  } catch (e) {
    return errorPage(`Kite API call failed: ${e.message}`);
  }

  const data = kiteResp.data || {};
  const obtainedAt = Date.now();
  const expiresAt = nextSixAmIst(obtainedAt);

  if (env.WEALTH_DB) {
    try {
      // Mark all previous tokens inactive
      await env.WEALTH_DB.prepare(`UPDATE kite_tokens SET is_active=0`).run();
      await env.WEALTH_DB.prepare(
        `INSERT INTO kite_tokens (user_id,access_token,public_token,user_name,email,user_type,broker,exchanges,products,order_types,api_key,obtained_at,expires_at,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
      ).bind(
        data.user_id || null,
        data.access_token,
        data.public_token || null,
        data.user_name || null,
        data.email || null,
        data.user_type || null,
        data.broker || null,
        JSON.stringify(data.exchanges || []),
        JSON.stringify(data.products || []),
        JSON.stringify(data.order_types || []),
        apiKey,
        obtainedAt,
        expiresAt,
      ).run();
    } catch (e) {
      return errorPage(`Token received but DB write failed: ${e.message}. Token is valid but won't survive page reload — re-run OAuth after fixing DB.`);
    }
  }

  // Redirect to /trading with a success flag
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/trading/?kite=connected&until=${expiresAt}`,
    },
  });
}

function nextSixAmIst(fromMs) {
  // 06:00 IST = 00:30 UTC. Find next occurrence after fromMs.
  const d = new Date(fromMs);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 30, 0));
  if (target.getTime() <= fromMs) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime();
}

function errorPage(message) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kite Connect — Error</title>
<style>
  body { font-family: system-ui; background:#0a0f1c; color:#e6ecff; padding:40px; max-width:560px; margin:0 auto; line-height:1.5; }
  h1 { color:#e74c3c; }
  pre { background:#121a2e; padding:14px; border-radius:8px; overflow-x:auto; border:1px solid #2a3656; }
  a { color:#7c5cff; }
</style></head>
<body>
<h1>Kite Connect — Authorization Failed</h1>
<pre>${escapeHtml(message)}</pre>
<p><a href="/trading/">← Back to dashboard</a> · <a href="/wealth/auth/login">↻ Retry login</a></p>
</body></html>`;
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }});
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
