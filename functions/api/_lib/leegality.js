// /api/_lib/leegality.js
// Leegality eSign client for Cloudflare Pages Functions.
//
// Leegality account credentials:
//   LEEGALITY_AUTH_TOKEN      — issued in their dashboard
//   LEEGALITY_PRIVATE_SALT    — issued for HMAC request signing (Basic plan + above)
//   LEEGALITY_API_BASE        — default 'https://app.leegality.com' (override via secret)
//   LEEGALITY_WORKFLOW_ID     — pre-configured workflow that defines signers/positions
//   LEEGALITY_USE_HMAC        — default 'true'. Set to 'false' if account uses plain token only.
//
// Auth approach (Leegality's standard pattern):
//   X-Auth-Token: <auth_token>
//   X-Signature : HMAC-SHA256-hex(private_salt, raw_request_body)  ← if HMAC enabled
//   Content-Type: application/json

const DEFAULT_API_BASE = 'https://app.leegality.com';

// ─── HMAC signing (Web Crypto API, works in CF Workers) ──────────────────────

async function hmacSha256Hex(key, body) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Buffer → base64 (CF-friendly)
function bufToBase64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function leegalityRequest(env, { method = 'POST', path, body }) {
  const base = env.LEEGALITY_API_BASE || DEFAULT_API_BASE;
  if (!env.LEEGALITY_AUTH_TOKEN) {
    return { ok: false, status: 500, error: 'LEEGALITY_AUTH_TOKEN not configured' };
  }
  const url = `${base}${path}`;
  const rawBody = body ? JSON.stringify(body) : '';

  const headers = {
    'X-Auth-Token': env.LEEGALITY_AUTH_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // HMAC signature on raw body (default behaviour). Disable via LEEGALITY_USE_HMAC=false.
  if (rawBody && env.LEEGALITY_PRIVATE_SALT && env.LEEGALITY_USE_HMAC !== 'false') {
    headers['X-Signature'] = await hmacSha256Hex(env.LEEGALITY_PRIVATE_SALT, rawBody);
  }

  const res = await fetch(url, { method, headers, body: rawBody || undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return {
    ok: res.ok,
    status: res.status,
    data: data || text,
    raw: text,
    response_headers: Object.fromEntries(res.headers.entries()),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a Leegality document for eSign.
 *
 * @param {object} env
 * @param {object} opts
 * @param {ArrayBuffer} opts.pdfBytes
 * @param {string}      opts.documentName  (e.g. "Mainuddin_employment_contract_v1.pdf")
 * @param {Array}       opts.signers       Each: { name, email?, mobile, signType: 'AADHAAR_OTP', order, label? }
 * @param {string}      [opts.workflowId]  Override env.LEEGALITY_WORKFLOW_ID
 * @param {string}      [opts.callbackUrl] Override default; defaults to /api/leegality-webhook on hnhotels.in
 * @param {string}      [opts.referenceId] External ID (we use 'hr_contract:<employee_id>')
 *
 * @returns {Promise<{ok, documentId?, signingUrl?, error?, response?}>}
 */
export async function leegalityCreateDocument(env, opts) {
  const { pdfBytes, documentName, signers, workflowId, callbackUrl, referenceId } = opts;
  if (!pdfBytes) return { ok: false, error: 'pdfBytes required' };
  if (!signers || !signers.length) return { ok: false, error: 'signers[] required' };

  const wfId = workflowId || env.LEEGALITY_WORKFLOW_ID;
  // workflowId is OPTIONAL — Leegality supports direct-upload mode where signers
  // are passed inline. If user has set up a workflow, we use that; otherwise
  // direct mode lets us send any PDF without pre-configuration.

  const cb = callbackUrl || `${env.PUBLIC_BASE_URL || 'https://hnhotels.in'}/api/leegality-webhook`;

  const body = {
    referenceId: referenceId || null,
    callbackUrl: cb,
    file: {
      name: documentName,
      content: bufToBase64(pdfBytes),
    },
    signers: signers.map((s, i) => ({
      name: s.name,
      email: s.email || null,
      mobile: s.mobile,                       // 10-digit Indian
      signType: s.signType || 'AADHAAR_OTP',
      order: s.order ?? (i + 1),
      label: s.label || (i === 0 ? 'employee' : 'signer'),
    })),
  };
  if (wfId) body.workflowId = wfId;

  // Verified via direct probes against app.leegality.com (2026-05-08):
  // /api/document/upload exists (returned 500 on empty body). All /api/v3/*
  // paths return "Resource not found". Override via env.LEEGALITY_UPLOAD_PATH
  // if your account tier uses a different route.
  const path = env.LEEGALITY_UPLOAD_PATH || '/api/document/upload';
  const res = await leegalityRequest(env, { path, body });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: res.data?.message || res.data?.error || 'Leegality send failed',
      response: res.data,
      response_headers: res.response_headers,
    };
  }

  // Different Leegality account tiers return different field names — accept any
  const d = res.data || {};
  return {
    ok: true,
    documentId: d.documentId || d.id || d.document_id || d.ref || null,
    signingUrl: d.signingUrl || d.signing_url || d.url || (d.signers?.[0]?.signing_url) || null,
    response: d,
  };
}

/**
 * Get current status of a Leegality document.
 */
export async function leegalityGetStatus(env, documentId) {
  if (!documentId) return { ok: false, error: 'documentId required' };
  const path = (env.LEEGALITY_STATUS_PATH || '/api/v3/document/status') + `?documentId=${encodeURIComponent(documentId)}`;
  const res = await leegalityRequest(env, { method: 'GET', path });
  if (!res.ok) return { ok: false, status: res.status, error: res.data?.message || 'status fetch failed', response: res.data };
  return { ok: true, data: res.data };
}

/**
 * Delete a Leegality document (used by cleanup script).
 */
export async function leegalityDeleteDocument(env, documentId) {
  if (!documentId) return { ok: false, error: 'documentId required' };
  const path = (env.LEEGALITY_DELETE_PATH || '/api/v3/document') + `/${encodeURIComponent(documentId)}`;
  const res = await leegalityRequest(env, { method: 'DELETE', path });
  if (!res.ok) return { ok: false, status: res.status, error: res.data?.message || 'delete failed', response: res.data };
  return { ok: true, response: res.data };
}

/**
 * List all documents on the Leegality account (paginated).
 */
export async function leegalityListDocuments(env, { limit = 100, offset = 0 } = {}) {
  const path = (env.LEEGALITY_LIST_PATH || '/api/v3/document') + `?limit=${limit}&offset=${offset}`;
  const res = await leegalityRequest(env, { method: 'GET', path });
  if (!res.ok) return { ok: false, status: res.status, error: res.data?.message || 'list failed', response: res.data };
  return { ok: true, data: res.data };
}
