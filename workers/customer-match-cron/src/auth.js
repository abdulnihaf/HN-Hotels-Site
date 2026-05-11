// Service-account JWT signing + OAuth token exchange for Data Manager API.
// Uses Web Crypto API (available in Cloudflare Workers natively — no library).

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datamanager';

export async function getDataManagerToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || TOKEN_URI,
    exp: now + 3600,
    iat: now,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput =
    base64UrlEncode(JSON.stringify(header)) + '.' +
    base64UrlEncode(JSON.stringify(claim));

  const key = await importPrivateKey(sa.private_key);
  const sigBytes = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = signingInput + '.' + base64UrlEncode(new Uint8Array(sigBytes));

  const resp = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(data).slice(0, 400));
  }
  return data.access_token;
}

async function importPrivateKey(pem) {
  const der = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(der), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bin.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
