/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — Vendor Entity Ring API
 * Route:  /api/vendors
 * D1:     DB (hn-hiring) — table vendor_profiles
 *
 * Canonical grammar (locked, 5 segments — v8 doctrine fix: case-encoded
 * primary/alternate across ALL FOUR architectural dimensions):
 *   {PAY_SEQ}-{SELLS}-{OPM}-{PMS}-{IDENTITY}
 *     PAY_SEQ ∈ {Pf, Rf, Pfr, Rfp}
 *                                 Pf  = only pay-first
 *                                 Rf  = only receive-first
 *                                 Pfr = pay-first primary + receive-first alt
 *                                 Rfp = receive-first primary + pay-first alt
 *     SELLS   ∈ {L, B, Lb, Bl}    Loose-only / Branded-only / Lb (loose primary
 *                                 + branded alt) / Bl (branded primary + loose
 *                                 alt). Flat 'LB' is no longer valid (v8).
 *     OPM     ∈ {M, A, Ma, Am}    Manual / Automatable / Ma (manual primary +
 *                                 auto alt) / Am (auto primary + manual alt).
 *     PMS     ∈ {C, B, Cb, Bc}    Cash-only / Bank-only / Cb (cash primary +
 *                                 bank alt) / Bc (bank primary + cash alt).
 *     IDENTITY                    Uppercase 3-10 chars, globally unique.
 *
 * All four architectural dimensions follow the same case-encoded pattern:
 *   uppercase letter = primary rail, lowercase letter = also possible (alt),
 *   absent letter = impossible. This lets the canonical code fully encode
 *   possibility from impossibility — the v7 grammar fix.
 *
 * Examples: Rf-L-M-C-PRABHU, Pf-B-A-B-ZEPTO, Rf-Lb-M-Cb-SHARIFF, Rf-B-A-Bc-HYPERPURE,
 *           Rfp-Lb-Ma-Cb-EXAMPLE (all alternates set)
 *
 * Endpoints (PIN-gated; same USERS table as rm-sourcing.js):
 *   GET    /api/vendors?pin=…                                    → list (lightweight)
 *   GET    /api/vendors?pin=…&vendor_code=…                      → single vendor + data_json
 *   GET    /api/vendors?pin=…&vendor_code=…&include=relationships → vendor + computed scope/sells/rms_supplied
 *   PUT    /api/vendors?pin=…&vendor_code=…                      → update (atomic re-key on PAY_SEQ/IDENTITY change)
 *   POST   /api/vendors?pin=…&action=create                      → create new vendor
 *   DELETE /api/vendors?pin=…&vendor_code=…                      → delete (refuses if RM-referenced)
 *
 * Computed views (relationships):
 *   - scope: set of brand prefixes ('NCH','HE','HN') derived from RMs that
 *     reference this vendor as a supplier (Loose vendors[] / Branded suppliers[]).
 *   - sells: set of letters {L,B,S,C} drawn from RM sourcing slots — L=loose,
 *     B=branded SKU, plus 'S' (services) / 'C' (consumables) future-reserved.
 *     Today computed strictly from L/B occurrences in rm_sourcing_profiles.
 *   - rms_supplied: array of {rm_code, layer, brand, sku} tuples.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

const USERS = {
  '0305': { name: 'Nihaf',   role: 'admin' },
  '5882': { name: 'Nihaf',   role: 'admin' },
  '2026': { name: 'Zoya',    role: 'purchase' },
  '8316': { name: 'Zoya',    role: 'purchase' },
  '3678': { name: 'Faheem',  role: 'settlement' },
  '6045': { name: 'Faheem',  role: 'settlement' },
  '6890': { name: 'Tanveer', role: 'staff' },
  '7115': { name: 'Kesmat',  role: 'staff' },
  '3946': { name: 'Jafar',   role: 'staff' },
  '9991': { name: 'Mujib',   role: 'staff' },
  '3697': { name: 'Yashwant',role: 'staff' },
  '3754': { name: 'Naveen',  role: 'staff' },
  '8241': { name: 'Nafees',  role: 'staff' },
  '8523': { name: 'Basheer', role: 'staff' },
  '4040': { name: 'Haneef',  role: 'viewer' },
  '5050': { name: 'Nisar',   role: 'viewer' },
};

function authPin(url) {
  const pin = url.searchParams.get('pin');
  return pin ? USERS[pin] : null;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Canonical-code helpers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function validatePaySeq(p) {
  if (!p || typeof p !== 'string') return 'PAY_SEQ required — must be Pf, Rf, Pfr, or Rfp';
  // Explicit enum match: the 'f' suffix on every value makes a generic
  // case-encoded regex hard to write narrowly. Enumerate the four legal codes.
  if (!['Pf', 'Rf', 'Pfr', 'Rfp'].includes(p)) {
    return `PAY_SEQ must be Pf (only pay-first), Rf (only receive-first), Pfr (pay-first primary + receive-first alt), or Rfp (receive-first primary + pay-first alt). Got "${p}".`;
  }
  return null;
}

function validateSells(v) {
  if (!v || typeof v !== 'string') {
    return 'SELLS required — must be L, B, Lb, or Bl';
  }
  if (!/^[LB][lb]?$/.test(v)) {
    return `SELLS must be L (loose only), B (branded only), Lb (loose primary + branded alt), or Bl (branded primary + loose alt). Got "${v}". Note: flat 'LB' is no longer valid — use Lb or Bl with a primary letter.`;
  }
  // No duplicate letters — Ll / Bb forbidden.
  const upper = v.toUpperCase();
  if (upper.length !== new Set(upper).size) {
    return `SELLS contains duplicate letter — got "${v}". Each letter (L, B) appears at most once.`;
  }
  return null;
}

function validateOpm(v) {
  if (!v || typeof v !== 'string') {
    return 'OPM required — must be M, A, Ma, or Am';
  }
  if (!/^[MA][ma]?$/.test(v)) {
    return `OPM must be M (manual only), A (automatable only), Ma (manual primary + automatable alt), or Am (automatable primary + manual alt). Got "${v}".`;
  }
  // No duplicate letters — Mm / Aa forbidden.
  const upper = v.toUpperCase();
  if (upper.length !== new Set(upper).size) {
    return `OPM contains duplicate letter — got "${v}". Each letter (M, A) appears at most once.`;
  }
  return null;
}

function validatePms(v) {
  if (!v || typeof v !== 'string') {
    return 'PMS required — must be C, B, Cb, or Bc';
  }
  // Shape: uppercase primary letter from {C,B}, optional lowercase alt from {c,b}.
  if (!/^[CB][cb]?$/.test(v)) {
    return `PMS must be C (Cash-only), B (Bank-only), Cb (cash primary + bank alt), or Bc (bank primary + cash alt). Got "${v}". Primary letter uppercase; alternate lowercase. No duplicates.`;
  }
  // No duplicate letters — Cc / Bb forbidden.
  const upper = v.toUpperCase();
  if (upper.length !== new Set(upper).size) {
    return `PMS contains duplicate letter — got "${v}". Each letter (C, B) appears at most once.`;
  }
  return null;
}

function validateIdentity(id) {
  if (!id || typeof id !== 'string') return 'identity_abbr required';
  const trimmed = id.trim();
  if (trimmed.length === 0) return 'identity_abbr empty';
  if (trimmed.length < 3 || trimmed.length > 10)
    return `identity_abbr must be 3-10 chars (got ${trimmed.length})`;
  if (!/^[A-Z0-9]+$/.test(trimmed))
    return 'identity_abbr must be uppercase A-Z / 0-9 only';
  return null;
}

/* Normalize SELLS — accepts strings only; arrays from older clients are
 * collapsed to a deterministic Lb/Bl encoding (alphabetical primary).
 *
 * v8: SELLS is now case-encoded (uppercase primary + lowercase alt). Strings
 * MUST preserve case — do NOT toUpperCase the whole value. Trim only.
 *
 * Legacy array shape (from pre-v8 editor builds that posted ['L','B']) is
 * mapped to 'Lb' as a deterministic default. The editor sends a string after
 * v8, so this branch is a compatibility belt-and-braces for any stale tab. */
function normalizeSells(v) {
  if (Array.isArray(v)) {
    const set = new Set(
      v.map(s => String(s || '').trim()).filter(s => s === 'L' || s === 'B' || s === 'l' || s === 'b')
    );
    const arr = Array.from(set).map(s => s.toUpperCase()).sort();
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    // Two letters → primary letter is the alphabetical first by default.
    return arr[0] + arr[1].toLowerCase();
  }
  if (typeof v === 'string') {
    // Preserve case — Lb / Bl are case-meaningful.
    return v.trim();
  }
  return '';
}

function composeVendorCode({ pay_seq, sells, opm, pms, identity_abbr }) {
  const pErr = validatePaySeq(pay_seq);   if (pErr) throw new Error(pErr);
  const sErr = validateSells(sells);      if (sErr) throw new Error(sErr);
  const oErr = validateOpm(opm);          if (oErr) throw new Error(oErr);
  const mErr = validatePms(pms);          if (mErr) throw new Error(mErr);
  const iErr = validateIdentity(identity_abbr);
  if (iErr) throw new Error(iErr);
  return `${pay_seq}-${sells}-${opm}-${pms}-${identity_abbr.trim().toUpperCase()}`;
}

/* Parse a 5-segment vendor code. Returns null if shape doesn't match.
 * v8 grammar:
 *   PAY_SEQ ∈ {Pf, Rf, Pfr, Rfp}
 *   SELLS   ∈ {L, B, Lb, Bl}
 *   OPM     ∈ {M, A, Ma, Am}
 *   PMS     ∈ {C, B, Cb, Bc} */
function parseVendorCode(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.match(/^(Pf|Rf|Pfr|Rfp)-([LB][lb]?)-([MA][ma]?)-([CB][cb]?)-([A-Z0-9]{3,10})$/);
  if (!m) return null;
  return { pay_seq: m[1], sells: m[2], opm: m[3], pms: m[4], identity_abbr: m[5] };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Computed-views helpers — walk rm_sourcing_profiles for vendor refs
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* Rewrite every vendor_code FK reference inside an rm_sourcing data_json
 * tree from oldCode to newCode. Mutates `data` in place. Returns true if at
 * least one ref was changed (so the caller knows whether to write back).
 *
 * Walks the same three buckets as collectVendorRefs / computeRelationships:
 * loose.vendors[], branded.brands[].skus[].suppliers[], in_house.recipes[].suppliers[]. */
function rewriteVendorCodeRefs(data, oldCode, newCode) {
  if (!data || typeof data !== 'object') return false;
  let changed = false;
  const looseV = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
  for (const v of looseV) {
    if (v && v.vendor_code === oldCode) { v.vendor_code = newCode; changed = true; }
  }
  const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
  for (const br of brands) {
    for (const sk of (br.skus || [])) {
      for (const sup of (sk.suppliers || [])) {
        if (sup && sup.vendor_code === oldCode) { sup.vendor_code = newCode; changed = true; }
      }
    }
  }
  const recipes = (data.in_house && Array.isArray(data.in_house.recipes)) ? data.in_house.recipes : [];
  for (const rec of recipes) {
    for (const sup of (rec.suppliers || [])) {
      if (sup && sup.vendor_code === oldCode) { sup.vendor_code = newCode; changed = true; }
    }
  }
  return changed;
}

/* Determine if a supplier/vendor ref name matches the given vendor.
 * Match strategy: case-insensitive equality on `name` OR `abbr` matches identity_abbr,
 * OR vendor_code stored on the ref equals the canonical code. */
function refMatchesVendor(ref, vendor) {
  if (!ref) return false;
  const idLower = (vendor.identity_abbr || '').toLowerCase();
  const code = vendor.vendor_code;
  const refCode  = (ref.vendor_code || '').toLowerCase();
  const refAbbr  = (ref.abbr || '').toLowerCase();
  const refName  = (ref.name || '').toLowerCase();
  if (refCode && refCode === code.toLowerCase()) return true;
  if (refAbbr && refAbbr === idLower) return true;
  if (refName && refName === (vendor.vendor_name || '').toLowerCase()) return true;
  return false;
}

/* Walk all RMs, return relationships for the given vendor:
 *   { scope: ['NCH','HN'], sells: ['L','B'], rms_supplied: [{rm_code, layer, brand, sku, notes}] } */
async function computeRelationships(DB, vendor) {
  const rs = await DB.prepare(
    `SELECT rm_code, brand_prefix, sourcing_profile, data_json FROM rm_sourcing_profiles`
  ).all();
  const rms = rs.results || [];

  const brandSet = new Set();
  const sellSet  = new Set();
  const supplied = [];

  for (const r of rms) {
    let data = {};
    try { data = JSON.parse(r.data_json || '{}'); } catch (_) {}

    // Loose vendors[]
    const looseV = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
    for (const v of looseV) {
      if (refMatchesVendor(v, vendor)) {
        brandSet.add(r.brand_prefix);
        sellSet.add('L');
        supplied.push({
          rm_code: r.rm_code,
          layer:   'L',
          brand:   r.brand_prefix,
          sku:     null,
          notes:   v.notes || '',
        });
      }
    }

    // Branded brands[].skus[].suppliers[]
    const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
    for (const br of brands) {
      const skus = Array.isArray(br.skus) ? br.skus : [];
      for (const sk of skus) {
        const sups = Array.isArray(sk.suppliers) ? sk.suppliers : [];
        for (const sup of sups) {
          if (refMatchesVendor(sup, vendor)) {
            brandSet.add(r.brand_prefix);
            sellSet.add('B');
            supplied.push({
              rm_code: r.rm_code,
              layer:   'B',
              brand:   r.brand_prefix,
              sku:     `${br.name || br.abbr || ''}${sk.description ? ' / ' + sk.description : ''}`.trim() || null,
              notes:   sup.notes || '',
            });
          }
        }
      }
    }

    // In-house recipes referenced vendor (rare, but supported via recipes[].suppliers[])
    const recipes = (data.in_house && Array.isArray(data.in_house.recipes)) ? data.in_house.recipes : [];
    for (const rec of recipes) {
      const sups = Array.isArray(rec.suppliers) ? rec.suppliers : [];
      for (const sup of sups) {
        if (refMatchesVendor(sup, vendor)) {
          brandSet.add(r.brand_prefix);
          sellSet.add('I');
          supplied.push({
            rm_code: r.rm_code,
            layer:   'I',
            brand:   r.brand_prefix,
            sku:     rec.name || rec.identifier || null,
            notes:   sup.notes || '',
          });
        }
      }
    }
  }

  return {
    scope:        Array.from(brandSet).sort(),
    sells:        Array.from(sellSet).sort(),
    rms_supplied: supplied,
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Main router
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url    = new URL(context.request.url);
  const env    = context.env;
  const DB     = env.DB;
  const method = context.request.method;
  const action = url.searchParams.get('action');
  const codeP  = url.searchParams.get('vendor_code');

  try {
    const user = authPin(url);
    if (!user) return json({ error: 'Invalid PIN' }, 401);

    if (action === 'create' && method === 'POST') {
      return await createOne(DB, context.request, user);
    }

    if (codeP) {
      if (method === 'GET')    return await getOne(DB, codeP, url);
      if (method === 'PUT')    return await putOne(DB, codeP, context.request, user);
      if (method === 'DELETE') return await deleteOne(DB, codeP, user);
      return json({ error: 'Method not allowed' }, 405);
    }

    if (method === 'GET') return await listAll(DB);
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Handlers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function listAll(DB) {
  const rs = await DB.prepare(
    `SELECT vendor_code, pay_seq, sells, opm, pms, identity_abbr, vendor_name,
            data_json, updated_at, updated_by
       FROM vendor_profiles
       ORDER BY pay_seq, identity_abbr`
  ).all();

  // Aggregate scope/sells across RMs once for efficiency.
  const rmRs = await DB.prepare(
    `SELECT rm_code, brand_prefix, data_json FROM rm_sourcing_profiles`
  ).all();
  const rms = rmRs.results || [];

  const rows = (rs.results || []).map(r => {
    const v = {
      vendor_code: r.vendor_code,
      identity_abbr: r.identity_abbr,
      vendor_name: r.vendor_name,
    };
    const brandSet = new Set();
    const sellSet  = new Set();
    let rmCount = 0;
    for (const rm of rms) {
      let data = {};
      try { data = JSON.parse(rm.data_json || '{}'); } catch (_) {}
      const lv = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
      let hit = false;
      for (const ref of lv) if (refMatchesVendor(ref, v)) { brandSet.add(rm.brand_prefix); sellSet.add('L'); hit = true; }
      const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
      for (const br of brands) {
        for (const sk of (br.skus || [])) {
          for (const sup of (sk.suppliers || [])) {
            if (refMatchesVendor(sup, v)) { brandSet.add(rm.brand_prefix); sellSet.add('B'); hit = true; }
          }
        }
      }
      if (hit) rmCount++;
    }

    let dataPreview = {};
    try {
      const d = JSON.parse(r.data_json || '{}');
      dataPreview = {
        primary_mode: d.communication?.primary_mode || null,
        area:         d.location?.area || null,
        channel_hint: d.channel_hint || null,
      };
    } catch (_) {}

    return {
      vendor_code:   r.vendor_code,
      pay_seq:       r.pay_seq,
      sells:         r.sells,
      opm:           r.opm,
      pms:           r.pms,
      identity_abbr: r.identity_abbr,
      vendor_name:   r.vendor_name,
      preview:       dataPreview,
      computed: {
        scope:        Array.from(brandSet).sort(),
        sells_actual: Array.from(sellSet).sort(),
        rm_count:     rmCount,
      },
      updated_at:    r.updated_at,
      updated_by:    r.updated_by,
    };
  });

  return json({ count: rows.length, vendors: rows });
}

async function getOne(DB, vendorCode, url) {
  const rs = await DB.prepare(
    `SELECT * FROM vendor_profiles WHERE vendor_code = ?`
  ).bind(vendorCode).first();
  if (!rs) return json({ error: 'Vendor not found' }, 404);

  let data = {};
  try { data = JSON.parse(rs.data_json || '{}'); } catch (_) {}

  const out = {
    vendor_code:   rs.vendor_code,
    pay_seq:       rs.pay_seq,
    sells:         rs.sells,
    opm:           rs.opm,
    pms:           rs.pms,
    identity_abbr: rs.identity_abbr,
    vendor_name:   rs.vendor_name,
    data,
    updated_at:    rs.updated_at,
    updated_by:    rs.updated_by,
  };

  const include = url.searchParams.get('include');
  if (include === 'relationships') {
    out.computed = await computeRelationships(DB, {
      vendor_code:   rs.vendor_code,
      identity_abbr: rs.identity_abbr,
      vendor_name:   rs.vendor_name,
    });
  }

  return json(out);
}

async function createOne(DB, request, user) {
  const body = await request.json();
  // v8: PAY_SEQ, SELLS, OPM, PMS are ALL case-sensitive (uppercase primary +
  // optional lowercase alt). Do NOT toUpperCase any of them — that would
  // collapse Lb→LB and Ma→MA, defeating the whole point of the doctrine fix.
  // Trim only. IDENTITY remains uppercase-normalized.
  const pay_seq       = (body.pay_seq || '').toString().trim();
  const sells         = normalizeSells(body.sells);
  const opm           = (body.opm || '').toString().trim();
  const pms           = (body.pms || '').toString().trim();
  const identity_abbr = (body.identity_abbr || '').toString().trim().toUpperCase();
  const vendor_name   = (body.vendor_name || '').toString().trim();

  if (!vendor_name) return json({ error: 'vendor_name required' }, 400);

  const pErr = validatePaySeq(pay_seq);  if (pErr) return json({ error: pErr }, 400);
  const sErr = validateSells(sells);     if (sErr) return json({ error: sErr }, 400);
  const oErr = validateOpm(opm);         if (oErr) return json({ error: oErr }, 400);
  const mErr = validatePms(pms);         if (mErr) return json({ error: mErr }, 400);
  const iErr = validateIdentity(identity_abbr);
  if (iErr) return json({ error: iErr }, 400);

  let vendor_code;
  try {
    vendor_code = composeVendorCode({ pay_seq, sells, opm, pms, identity_abbr });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  // Identity uniqueness — global, regardless of pay_seq.
  const idCollide = await DB.prepare(
    `SELECT vendor_code FROM vendor_profiles WHERE identity_abbr = ?`
  ).bind(identity_abbr).first();
  if (idCollide) {
    return json({
      error: `identity_abbr "${identity_abbr}" is already in use by ${idCollide.vendor_code}. Pick a different identity.`,
    }, 409);
  }
  // Belt-and-braces full-code collision (should never trigger if identity is unique).
  const codeCollide = await DB.prepare(
    `SELECT vendor_code FROM vendor_profiles WHERE vendor_code = ?`
  ).bind(vendor_code).first();
  if (codeCollide) {
    return json({ error: `vendor_code ${vendor_code} already exists.` }, 409);
  }

  const data = body.data ?? body.data_json ?? {};
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();

  await DB.prepare(
    `INSERT INTO vendor_profiles
       (vendor_code, pay_seq, sells, opm, pms, identity_abbr, vendor_name, data_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(vendor_code, pay_seq, sells, opm, pms, identity_abbr, vendor_name, dataStr, now, user.name).run();

  return json({
    success: true,
    vendor_code,
    pay_seq, sells, opm, pms,
    identity_abbr,
    vendor_name,
    updated_at: now,
    updated_by: user.name,
  }, 201);
}

async function putOne(DB, vendorCode, request, user) {
  const body = await request.json();
  const existing = await DB.prepare(
    `SELECT * FROM vendor_profiles WHERE vendor_code = ?`
  ).bind(vendorCode).first();
  if (!existing) return json({ error: 'Vendor not found' }, 404);

  // v8: ALL FOUR architectural dimensions preserve case (Pfr/Rfp on PAY_SEQ,
  // Lb/Bl on SELLS, Ma/Am on OPM, Cb/Bc on PMS). Trim only — never toUpperCase.
  const pay_seq = (body.pay_seq !== undefined ? body.pay_seq : existing.pay_seq).toString().trim();
  const sells   = body.sells   !== undefined ? normalizeSells(body.sells) : existing.sells;
  const opm     = (body.opm    !== undefined ? body.opm    : existing.opm).toString().trim();
  const pms     = (body.pms    !== undefined ? body.pms    : existing.pms).toString().trim();
  const identity_abbr = (body.identity_abbr !== undefined
    ? body.identity_abbr
    : existing.identity_abbr).toString().trim().toUpperCase();
  const vendor_name = (body.vendor_name !== undefined
    ? body.vendor_name
    : existing.vendor_name).toString().trim();

  if (!vendor_name) return json({ error: 'vendor_name required' }, 400);

  const pErr = validatePaySeq(pay_seq);  if (pErr) return json({ error: pErr }, 400);
  const sErr = validateSells(sells);     if (sErr) return json({ error: sErr }, 400);
  const oErr = validateOpm(opm);         if (oErr) return json({ error: oErr }, 400);
  const mErr = validatePms(pms);         if (mErr) return json({ error: mErr }, 400);
  const iErr = validateIdentity(identity_abbr);
  if (iErr) return json({ error: iErr }, 400);

  let newCode;
  try {
    newCode = composeVendorCode({ pay_seq, sells, opm, pms, identity_abbr });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const data = body.data !== undefined
    ? body.data
    : (body.data_json !== undefined ? body.data_json : null);
  const dataStr = data === null
    ? existing.data_json
    : (typeof data === 'string' ? data : JSON.stringify(data));
  const now = Date.now();

  if (newCode !== vendorCode) {
    // Re-key path: new identity is unique, INSERT new + DELETE old atomically,
    // AND cascade-rewrite any rm_sourcing_profiles.data_json that references
    // the old code so RM trees never go stale (Framework Gap 1 closed).
    const idCollide = await DB.prepare(
      `SELECT vendor_code FROM vendor_profiles WHERE identity_abbr = ? AND vendor_code != ?`
    ).bind(identity_abbr, vendorCode).first();
    if (idCollide) {
      return json({
        error: `identity_abbr "${identity_abbr}" already in use by ${idCollide.vendor_code}.`,
      }, 409);
    }
    const codeCollide = await DB.prepare(
      `SELECT vendor_code FROM vendor_profiles WHERE vendor_code = ?`
    ).bind(newCode).first();
    if (codeCollide) {
      return json({ error: `vendor_code ${newCode} already exists.` }, 409);
    }

    // Find every RM tree that references the old code as a supplier FK.
    // LIKE-based scan is exact-string-safe because vendor codes are
    // dash-separated 5-segment tokens and the JSON encoding is
    // deterministic ("vendor_code":"<code>").
    const oldRefRs = await DB.prepare(
      `SELECT rm_code, data_json FROM rm_sourcing_profiles
        WHERE data_json LIKE ?`
    ).bind(`%"vendor_code":"${vendorCode}"%`).all();
    const cascadeRows = oldRefRs.results || [];

    // Walk each match, rewrite vendor_code FK references in place, prepare
    // a single atomic batch.
    // Order matters: DELETE old FIRST, then INSERT new — otherwise re-keys
    // that preserve identity_abbr (e.g. PAY_SEQ-only edits Pf→Pfr) trip the
    // UNIQUE(identity_abbr) constraint mid-batch. D1 batches run sequentially
    // within a single transaction, so DELETE-then-INSERT is atomic from
    // outside while sidestepping the momentary duplicate.
    const cascadedRmCodes = [];
    const stmts = [
      DB.prepare(`DELETE FROM vendor_profiles WHERE vendor_code = ?`).bind(vendorCode),
      DB.prepare(
        `INSERT INTO vendor_profiles
           (vendor_code, pay_seq, sells, opm, pms, identity_abbr, vendor_name, data_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newCode, pay_seq, sells, opm, pms, identity_abbr, vendor_name, dataStr, now, user.name),
    ];

    for (const row of cascadeRows) {
      let rmData = {};
      try { rmData = JSON.parse(row.data_json || '{}'); } catch (_) { continue; }
      const changed = rewriteVendorCodeRefs(rmData, vendorCode, newCode);
      if (!changed) continue;
      cascadedRmCodes.push(row.rm_code);
      stmts.push(
        DB.prepare(
          `UPDATE rm_sourcing_profiles
              SET data_json = ?, updated_at = ?, updated_by = ?
            WHERE rm_code = ?`
        ).bind(JSON.stringify(rmData), now, user.name, row.rm_code)
      );
    }

    try {
      await DB.batch(stmts);
    } catch (e) {
      // D1 batch is atomic — if anything fails, nothing is written.
      // Surface the cascade context in the error so callers can debug.
      return json({
        error: `Cascade failed: ${e.message}`,
        attempted_cascade: cascadedRmCodes,
      }, 500);
    }

    return json({
      success: true,
      vendor_code:   newCode,
      migrated_from: vendorCode,
      pay_seq, sells, opm, pms, identity_abbr, vendor_name,
      cascaded_rms:  cascadedRmCodes,
      cascade_count: cascadedRmCodes.length,
      updated_at:    now,
      updated_by:    user.name,
    });
  }

  // In-place update.
  await DB.prepare(
    `UPDATE vendor_profiles
        SET pay_seq = ?, sells = ?, opm = ?, pms = ?,
            identity_abbr = ?, vendor_name = ?, data_json = ?,
            updated_at = ?, updated_by = ?
      WHERE vendor_code = ?`
  ).bind(pay_seq, sells, opm, pms, identity_abbr, vendor_name, dataStr, now, user.name, vendorCode).run();

  return json({
    success: true,
    vendor_code: vendorCode,
    pay_seq, sells, opm, pms, identity_abbr, vendor_name,
    updated_at:  now,
    updated_by:  user.name,
  });
}

async function deleteOne(DB, vendorCode, user) {
  const existing = await DB.prepare(
    `SELECT vendor_code, identity_abbr, vendor_name FROM vendor_profiles WHERE vendor_code = ?`
  ).bind(vendorCode).first();
  if (!existing) return json({ error: 'Vendor not found' }, 404);

  // Fast FK pre-check: any RM referencing this vendor_code as the canonical FK?
  // (Catches the v9 supplier-row shape that stores vendor_code only.)
  const fkRs = await DB.prepare(
    `SELECT rm_code FROM rm_sourcing_profiles WHERE data_json LIKE ?`
  ).bind(`%"vendor_code":"${vendorCode}"%`).all();
  const fkRms = (fkRs.results || []).map(r => r.rm_code);

  // Belt-and-braces: also check legacy refs (name/abbr/v_shape rows from
  // before the FK migration) via the existing relationship walker.
  const refs = await computeRelationships(DB, {
    vendor_code:   existing.vendor_code,
    identity_abbr: existing.identity_abbr,
    vendor_name:   existing.vendor_name,
  });

  const referencedRmCodes = Array.from(
    new Set([...fkRms, ...refs.rms_supplied.map(r => r.rm_code)])
  );

  if (referencedRmCodes.length > 0) {
    return json({
      error: `Vendor referenced in ${referencedRmCodes.length} RM${referencedRmCodes.length === 1 ? '' : 's'}. Remove from RM tree first.`,
      referenced_rms: referencedRmCodes,
      rms_supplied:   refs.rms_supplied, // keep legacy shape for clients
    }, 409);
  }

  await DB.prepare(`DELETE FROM vendor_profiles WHERE vendor_code = ?`).bind(vendorCode).run();
  return json({ success: true, vendor_code: vendorCode, deleted_by: user.name });
}
