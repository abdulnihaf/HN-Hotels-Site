// hn-customer-match-cron — Daily upload of WABA leads to HE Google Ads
// Customer Match user list `hamza_he_leads_v1` (9384755106) via Data Manager API.
//
// Why a Worker (not a Pages Function): Pages Functions don't support cron;
// also the SA JSON secret is large (~2KB private key) and benefits from being
// scoped to this single Worker rather than every Pages Function call.
//
// Pipeline:
//   1. Fetch all leads from https://hamzaexpress.in/api/leads?show=all (open CORS, public)
//   2. Filter: status != 'dnd', source ∈ quality set, valid phone
//   3. Normalize phone → E.164 (+91XXXXXXXXXX) → SHA-256 → hex
//   4. Authenticate via service account (JWT → OAuth → datamanager scope)
//   5. POST audienceMembers:ingest with destinations + audienceMembers + termsOfService
//
// Customer Match is idempotent — uploading the same hash twice doesn't duplicate.
// Run daily and Google handles dedupe + membership_life_span on its end.
//
// Required secret:
//   DATA_MANAGER_SA_JSON = full contents of the service account JSON key

import { getDataManagerToken } from './auth.js';

const LEADS_URL = 'https://hamzaexpress.in/api/leads?show=all';
const INGEST_URL = 'https://datamanager.googleapis.com/v1/audienceMembers:ingest';
const CUSTOMER_ID = '3681710084';
const USER_LIST_ID = '9384755106';

// Only upload phones we trust came in through known funnels.
// 'unknown' is excluded — those phones may be bots / spam / typo'd.
const QUALITY_SOURCES = new Set(['ctwa_paid', 'direct', 'meta_ctwa', 'station_qr']);

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runUpload(env));
  },

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Use POST', { status: 405 });
    const result = await runUpload(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function runUpload(env) {
  if (!env.DATA_MANAGER_SA_JSON) {
    return { ok: false, error: 'DATA_MANAGER_SA_JSON secret missing — run `wrangler secret put DATA_MANAGER_SA_JSON`' };
  }

  let sa;
  try {
    sa = JSON.parse(env.DATA_MANAGER_SA_JSON);
  } catch (e) {
    return { ok: false, error: 'DATA_MANAGER_SA_JSON not valid JSON: ' + e.message };
  }

  // 1. Fetch leads
  let leadsData;
  try {
    const r = await fetch(LEADS_URL);
    if (!r.ok) return { ok: false, error: `leads fetch HTTP ${r.status}` };
    leadsData = await r.json();
  } catch (e) {
    return { ok: false, error: 'leads fetch failed: ' + e.message };
  }
  const allLeads = leadsData.leads || [];

  // 2. Filter
  const eligible = [];
  const skipped = { dnd: 0, badSource: 0, badPhone: 0 };
  for (const lead of allLeads) {
    if (lead.status === 'dnd') { skipped.dnd++; continue; }
    if (!QUALITY_SOURCES.has(lead.source)) { skipped.badSource++; continue; }
    const e164 = normalizeE164(lead.waId || lead.phone);
    if (!e164) { skipped.badPhone++; continue; }
    eligible.push(e164);
  }

  if (eligible.length === 0) {
    return { ok: true, eligible: 0, totalLeads: allLeads.length, skipped, note: 'no eligible leads to upload' };
  }

  // 3. Hash
  const audienceMembers = [];
  for (const e164 of eligible) {
    const hash = await sha256Hex(e164);
    audienceMembers.push({ userData: { userIdentifiers: [{ phoneNumber: hash }] } });
  }

  // 4. Auth
  let token;
  try {
    token = await getDataManagerToken(sa);
  } catch (e) {
    return { ok: false, error: 'auth failed: ' + e.message };
  }

  // 5. Ingest
  const body = {
    destinations: [{
      reference: 'hamza_he_leads_v1',
      loginAccount: { accountId: CUSTOMER_ID, accountType: 'GOOGLE_ADS' },
      operatingAccount: { accountId: CUSTOMER_ID, accountType: 'GOOGLE_ADS' },
      productDestinationId: USER_LIST_ID,
    }],
    audienceMembers,
    encoding: 'HEX',
    termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
  };

  let respData, respOk, respStatus;
  try {
    const r = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    respOk = r.ok;
    respStatus = r.status;
    respData = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: 'ingest fetch failed: ' + e.message };
  }

  console.log('[customer-match-ingest]', JSON.stringify(respData).slice(0, 500));

  return {
    ok: respOk,
    status: respStatus,
    totalLeads: allLeads.length,
    eligible: eligible.length,
    skipped,
    response: respData,
  };
}

// WABA wa_id usually arrives as digits-only with 91 country-code prefix
// (e.g. "919876543210"). The /api/leads endpoint also exposes a `phone` field
// with the 91 stripped. Accept either; produce '+91XXXXXXXXXX'.
function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return '+91' + digits;          // 9876543210 → +919876543210
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;  // 919876543210 → +919876543210
  return null;  // anything else is suspect; skip rather than hash garbage
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
