// /api/_lib/drive-server.js
// Server-side Google Drive helpers running inside Cloudflare Pages Functions.
// Uses the OAuth refresh token (saved as CF secret GDRIVE_REFRESH_TOKEN) to
// mint short-lived access tokens, then calls Drive REST API directly via fetch.
//
// Required CF Pages secrets:
//   GDRIVE_REFRESH_TOKEN   — the user's long-lived refresh token (one-time OAuth)
//   GDRIVE_CLIENT_ID       — OAuth Desktop client ID
//   GDRIVE_CLIENT_SECRET   — OAuth Desktop client secret
//
// All exports return Promise<{ok, data?, error?, status?}>.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// In-memory cache (per-isolate). Refresh tokens are valid for hours so we mint
// once per cold start and reuse until 401.
let cachedAccessToken = null;
let cachedAccessExpiresAt = 0;

async function getAccessToken(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && cachedAccessExpiresAt > now + 60_000) {
    return { ok: true, access_token: cachedAccessToken };
  }
  if (!env.GDRIVE_REFRESH_TOKEN || !env.GDRIVE_CLIENT_ID || !env.GDRIVE_CLIENT_SECRET) {
    return { ok: false, error: 'Drive OAuth secrets not configured (need GDRIVE_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET)' };
  }

  const body = new URLSearchParams({
    client_id: env.GDRIVE_CLIENT_ID,
    client_secret: env.GDRIVE_CLIENT_SECRET,
    refresh_token: env.GDRIVE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    return { ok: false, status: res.status, error: data.error_description || data.error || 'token refresh failed', response: data };
  }
  cachedAccessToken = data.access_token;
  cachedAccessExpiresAt = now + (data.expires_in || 3600) * 1000;
  return { ok: true, access_token: cachedAccessToken };
}

/**
 * Download a file from Drive by ID. Returns ArrayBuffer of bytes + content-type.
 * @returns {Promise<{ok, bytes?, mimeType?, size?, error?}>}
 */
export async function driveDownload(env, fileId) {
  const tok = await getAccessToken(env);
  if (!tok.ok) return tok;

  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!res.ok) {
    // Retry once on 401 (cached token might be stale)
    if (res.status === 401) {
      const tok2 = await getAccessToken(env, true);
      if (!tok2.ok) return tok2;
      const res2 = await fetch(url, { headers: { authorization: `Bearer ${tok2.access_token}` } });
      if (!res2.ok) {
        const t = await res2.text();
        return { ok: false, status: res2.status, error: t.slice(0, 300) };
      }
      const buf = await res2.arrayBuffer();
      return { ok: true, bytes: buf, mimeType: res2.headers.get('content-type') || 'application/octet-stream', size: buf.byteLength };
    }
    const t = await res.text();
    return { ok: false, status: res.status, error: t.slice(0, 300) };
  }
  const buf = await res.arrayBuffer();
  return {
    ok: true,
    bytes: buf,
    mimeType: res.headers.get('content-type') || 'application/octet-stream',
    size: buf.byteLength,
  };
}

/**
 * Get metadata for a Drive file.
 * @returns {Promise<{ok, file?, error?}>}
 */
export async function driveGetMetadata(env, fileId, fields = 'id,name,mimeType,size,parents,modifiedTime') {
  const tok = await getAccessToken(env);
  if (!tok.ok) return tok;
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error?.message || 'metadata failed', response: data };
  return { ok: true, file: data };
}

/**
 * Upload a file to Drive. Replaces existing file by same name in parent folder if found.
 * @returns {Promise<{ok, fileId?, name?, error?}>}
 */
export async function driveUpload(env, { parentId, name, bytes, mimeType = 'application/pdf' }) {
  const tok = await getAccessToken(env);
  if (!tok.ok) return tok;

  // Multipart upload
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: parentId ? [parentId] : undefined, mimeType });

  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(new Uint8Array(bytes), head.byteLength);
  body.set(tail, head.byteLength + bytes.byteLength);

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tok.access_token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error?.message || 'upload failed', response: data };
  return { ok: true, fileId: data.id, name: data.name };
}

/**
 * Compute SHA-256 hex of an ArrayBuffer using the WebCrypto API (works in CF Workers).
 */
export async function sha256Hex(arrayBuffer) {
  const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
