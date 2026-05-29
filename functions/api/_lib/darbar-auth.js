// ═══════════════════════════════════════════════════════════════════════════
// Darbar auth — server-side PIN verification → HMAC-signed, time-boxed token.
//
// The PIN gate is now a REAL auth boundary: the PWA posts the PIN to the server,
// the server verifies it and returns a token signed with HMAC-SHA256 keyed by the
// existing DASHBOARD_KEY secret. Every other Darbar API call must present the
// token (x-darbar-token). No new secret is introduced and the raw DASHBOARD_KEY
// never reaches the browser.
//
// Internal callers (cron, cams-ingest) authenticate with the existing
// CAMS_AUTH_TOKEN as a service key (x-service-key) instead of a user token.
// ═══════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();
const nowSec = () => Math.floor(Date.now() / 1000);

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
// constant-time string compare
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Mint a token for a verified user. ttl default 12h.
export async function mintToken(env, user, ttlSec = 43200) {
  if (!env.DASHBOARD_KEY) throw new Error('DASHBOARD_KEY not configured');
  const payload = { u: user.name, r: user.role, f: !!user.fin, exp: nowSec() + ttlSec };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(env.DASHBOARD_KEY, body));
  return `${body}.${sig}`;
}

// Verify a request. Returns the auth principal ({u,r,f} or service) or null.
// Accepts: x-darbar-token (user) OR x-service-key === CAMS_AUTH_TOKEN (internal).
export async function verifyToken(env, request) {
  try {
    const svc = request.headers.get('x-service-key');
    if (svc && env.CAMS_AUTH_TOKEN && timingSafeEq(svc, env.CAMS_AUTH_TOKEN)) {
      return { u: 'service', r: 'admin', f: true, service: true };
    }
    const tok = request.headers.get('x-darbar-token') || '';
    const dot = tok.indexOf('.');
    if (dot < 1) return null;
    const body = tok.slice(0, dot), sig = tok.slice(dot + 1);
    if (!env.DASHBOARD_KEY) return null;
    const expect = b64url(await hmac(env.DASHBOARD_KEY, body));
    if (!timingSafeEq(sig, expect)) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!p.exp || p.exp < nowSec()) return null;
    return p;
  } catch {
    return null;
  }
}

// CORS — reflect only the Darbar origins; never wildcard for a PII surface.
const ALLOWED_ORIGINS = new Set([
  'https://darbar.hnhotels.in',
  'https://hnhotels.in',
]);
export function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://darbar.hnhotels.in';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-darbar-token,x-service-key',
    'vary': 'origin',
  };
}
