/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — RM Sourcing Profile API
 * Route:  /api/rm-sourcing
 * D1:     DB (hn-hiring) — table rm_sourcing_profiles
 *
 * GET    /api/rm-sourcing?pin=<pin>                   → list all RMs (lightweight)
 * GET    /api/rm-sourcing?pin=<pin>&rm_code=<code>    → single RM with data_json
 * PUT    /api/rm-sourcing?pin=<pin>&rm_code=<code>    → update data_json (+ optional sourcing_profile)
 * POST   /api/rm-sourcing?pin=<pin>&action=seed       → idempotent seed of 30 RMs
 *
 * Auth: ?pin=<pin> (same USERS table as rm-ops.js)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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
 * NCH/HN RM seed list — canonical codes (5-segment grammar with USAGE)
 *   {BRAND}-{TYPE}-{USAGE}-{SOURCING}-{ITEM}
 * USAGE: P (production), R (retail), O (operational consumable).
 *        Each letter appears at most once. Uppercase = primary, lowercase = alt.
 *        Single (P/R/O), pair (Pr/Po/Rp/Ro/Op/Or), or triple (Pro/Por/Rpo/Rop/Opr/Orp).
 *        At least one of P / R / O required.
 * Malai removed (state of production, not RM).
 * 3 raw items moved to Li (bought ready today, in-house possible tomorrow).
 * Tea Powder + Osmania Biscuit are dual-USAGE (Pr) — used in our service AND
 * resold as Niloufer-style retail packs.
 * LPG is O (operational fuel — neither recipe-consumed nor sold).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const SEED_RMS = [
  // HN- cross-brand (12)
  { rm_code: 'HN-AM-P-Lb-SUG', rm_name: 'Sugar' },
  { rm_code: 'HN-AM-P-Lb-MDA', rm_name: 'Maida' },
  { rm_code: 'HN-AM-P-Lb-SAU', rm_name: 'Saunf' },
  { rm_code: 'HN-AM-P-Lb-KAJ', rm_name: 'Kaju' },
  { rm_code: 'HN-AM-P-Lb-CAR', rm_name: 'Cardamom' },
  { rm_code: 'HN-AM-P-Lb-OIL', rm_name: 'Oil' },
  { rm_code: 'HN-AM-P-Lb-ALM', rm_name: 'Almonds' },
  { rm_code: 'HN-AM-P-Bl-BTR', rm_name: 'Butter' },
  { rm_code: 'HN-AM-P-B-SOD',  rm_name: 'Soda' },
  { rm_code: 'HN-AM-O-B-LPG',  rm_name: 'LPG' },
  { rm_code: 'HN-AM-P-L-CHL',  rm_name: 'Charcoal' },
  { rm_code: 'HN-AM-P-L-GIN',  rm_name: 'Ginger' },
  // NCH- only
  { rm_code: 'NCH-AM-P-Lb-MLK',  rm_name: 'Buffalo Milk' },
  { rm_code: 'NCH-AM-Pr-Bl-TEA', rm_name: 'Tea Powder' },           // Pr = used by us + resold
  { rm_code: 'NCH-AM-P-Bl-SMP',  rm_name: 'Skimmed Milk Powder' },
  { rm_code: 'NCH-AM-P-Lb-SAF',  rm_name: 'Saffron' },
  { rm_code: 'NCH-AM-P-B-WTR',   rm_name: 'Bottled Water' },
  { rm_code: 'NCH-AM-P-L-SBJ',   rm_name: 'Sabja' },
  { rm_code: 'NCH-AM-P-B-CHC',   rm_name: 'Chocolate Powder' },
  { rm_code: 'NCH-AS-P-Li-CCT',  rm_name: 'Chicken Cutlet Raw' },
  { rm_code: 'NCH-AS-P-Li-CHB',  rm_name: 'Chicken Bites Raw' },
  { rm_code: 'NCH-AS-P-Li-SMS',  rm_name: 'Samosa Raw' },
  { rm_code: 'NCH-AS-P-Lbi-BUN', rm_name: 'Bun' },
  { rm_code: 'NCH-AS-P-Lb-PMK',  rm_name: 'Pumpkin Seeds' },
  { rm_code: 'NCH-AS-P-Lb-HNY',  rm_name: 'Honey' },
  { rm_code: 'NCH-AS-P-B-HRK',   rm_name: 'Horlicks' },
  { rm_code: 'NCH-AS-P-B-BST',   rm_name: 'Boost' },
  { rm_code: 'NCH-AS-P-B-JAM',   rm_name: 'Jam' },
  { rm_code: 'NCH-AS-P-B-NUT',   rm_name: 'Nutella' },
  { rm_code: 'NCH-DM-Pr-Bl-OSB', rm_name: 'Osmania Biscuit' },      // Pr = service + Niloufer packs
];

/* parse rm_code → { brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr }
 * 5-segment grammar: PREFIX-TYPE-USAGE-SOURCING-ITEM */
function parseRmCode(code) {
  const parts = code.split('-');
  if (parts.length !== 5) {
    throw new Error(`Bad rm_code shape: ${code} (expected 5 segments)`);
  }
  const [brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr] = parts;
  return { brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr };
}

/* Closed value sets per locked grammar (mirrored in DB CHECKs from
 * migrations/0008_rm_check_constraints.sql). Single source of truth here so
 * validators read off the same enumerations the DB enforces. */
const ALLOWED_BRANDS = new Set(['HN', 'NCH', 'HE']);
const ALLOWED_RM_TYPES = new Set(['AM', 'AS', 'DM', 'DS']);
const ALLOWED_SOURCING_PROFILES = new Set([
  'L', 'B', 'Lb', 'Bl', 'Li', 'Bi', 'Lbi', 'Bli'
]);
const FORBIDDEN_I_PRIMARY = new Set(['I', 'Il', 'Ib', 'Ilb']);

/* Validate rm_type per the locked {AM, AS, DM, DS} closed set.
 * The 'P' prefix (PM/PS) was experimental, never doctrine-locked, and is
 * silently filtered out by the DB CHECK as well. */
function validateRmType(rmType) {
  if (!rmType || typeof rmType !== 'string') {
    return 'rm_type is required';
  }
  if (!ALLOWED_RM_TYPES.has(rmType)) {
    return `rm_type must be AM, AS, DM, or DS. Got "${rmType}". The 'P' prefix is not valid (it was an experimental placeholder, never doctrine-locked).`;
  }
  return null;
}

/* Compose canonical rm_code from structured parts.
 * USAGE: 1 uppercase primary {P,R,O} + 0-2 lowercase alts {p,r,o} (each letter at most once).
 * SOURCING: primary uppercase first, alternates lowercase sorted. */
function composeRmCode({ brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr }) {
  if (!brand_prefix || !rm_type || !usage_profile || !sourcing_profile || !item_abbr) {
    throw new Error('Missing required parts to compose rm_code');
  }
  if (!ALLOWED_BRANDS.has(brand_prefix)) {
    throw new Error(`Bad brand_prefix: ${brand_prefix}`);
  }
  const rmTypeErr = validateRmType(rm_type);
  if (rmTypeErr) {
    throw new Error(rmTypeErr);
  }
  // USAGE validation delegated to validateUsageProfile (handles P/R/O singletons, pairs, triples)
  const usageErr = validateUsageProfile(usage_profile);
  if (usageErr) {
    throw new Error(`Bad usage_profile: ${usage_profile} — ${usageErr}`);
  }
  // SOURCING validation delegated to validateSourcingProfile (rejects I-primary).
  const sourcingErr = validateSourcingProfile(sourcing_profile);
  if (sourcingErr) {
    throw new Error(sourcingErr);
  }
  if (!/^[A-Z0-9]{2,4}$/.test(item_abbr)) {
    throw new Error(`Bad item_abbr: ${item_abbr}`);
  }
  return `${brand_prefix}-${rm_type}-${usage_profile}-${sourcing_profile}-${item_abbr}`;
}

/* Validate usage_profile.
 * Letter-set: {P, R, O} where each letter appears at most once.
 * Format: 1 uppercase primary + 0-2 lowercase alternates.
 * Valid: P, R, O, Pr, Po, Rp, Ro, Op, Or, Pro, Por, Rpo, Rop, Opr, Orp.
 * Invalid: empty, PR, RP, pp, oP, Prr, Prro, X.
 * Returns null if valid, or a string error message if not. */
function validateUsageProfile(usage) {
  if (!usage || typeof usage !== 'string') {
    return 'USAGE profile is required. An RM must be at least one of P (production), R (retail), or O (operational).';
  }
  // First char must be uppercase P/R/O (the primary)
  if (!/^[PRO]/.test(usage)) {
    return 'USAGE profile must start with uppercase P, R, or O (the primary).';
  }
  // Overall shape: 1 uppercase primary + 0-2 lowercase alts from {p,r,o}
  if (!/^[PRO][pro]{0,2}$/.test(usage)) {
    return 'Invalid USAGE profile. Format: 1 uppercase primary letter (P/R/O), optionally followed by 1-2 lowercase alternates.';
  }
  // No duplicates: each letter (case-insensitive) appears at most once
  const seen = new Set();
  for (const ch of usage.toUpperCase()) {
    if (seen.has(ch)) {
      return `USAGE profile contains duplicate letter '${ch}'. Each letter (P, R, O) appears at most once.`;
    }
    seen.add(ch);
  }
  return null;
}

/* Validate sourcing_profile per the locked closed set
 *   {L, B, Lb, Bl, Li, Bi, Lbi, Bli}  — 8 valid combinations
 *
 * I-primary forms ({I, Il, Ib, Ilb}) are explicitly forbidden — RMs that can
 * ONLY be produced in-house are states-of-production, not RMs. (Doctrine §4 —
 * states layer is its own ring, deferred.)
 *
 * Other rejected forms:
 *   - lowercase-first / no primary uppercase  (e.g. 'l', 'lb')
 *   - duplicate letters                       (e.g. 'Lbb', 'BB')
 *   - unsorted alternates                     (e.g. 'Lib' instead of 'Lbi')
 *   - unknown letters                         (e.g. 'Lx')
 *
 * Returns null if valid, or a string error message if not. */
function validateSourcingProfile(profile) {
  if (!profile || typeof profile !== 'string') {
    return 'SOURCING profile is required (L, B, Lb, Bl, Li, Bi, Lbi, or Bli)';
  }
  if (!ALLOWED_SOURCING_PROFILES.has(profile)) {
    if (FORBIDDEN_I_PRIMARY.has(profile)) {
      return `I-primary profiles (I, Il, Ib, Ilb) are forbidden — RMs that can ONLY be produced in-house are states-of-production, not RMs. Got "${profile}". Either add L or B as another sourcing mode, or move this item to the States layer.`;
    }
    return `SOURCING must be one of: L, B, Lb, Bl, Li, Bi, Lbi, Bli. Got "${profile}".`;
  }
  return null; // valid
}

/* Normalize sourcing profile: ensure first char is the primary uppercase, rest lowercase sorted alpha. */
function normalizeSourcingProfile(letters, primary) {
  // letters: array like ['L','B'] or string 'LB' / 'Lb'
  const arr = (Array.isArray(letters) ? letters : letters.split(''))
    .map(s => s.toUpperCase())
    .filter(s => s === 'L' || s === 'B' || s === 'I');
  if (arr.length === 0) throw new Error('At least one sourcing letter required');
  const set = Array.from(new Set(arr));
  const p = (primary || set[0]).toUpperCase();
  if (!set.includes(p)) throw new Error('primary not in sourcing letters');
  const alts = set.filter(s => s !== p).sort();
  return p + alts.map(s => s.toLowerCase()).join('');
}

/* Build empty data_json shaped to the sourcing profile letters.
 * Profile letters: L=loose, B=branded, I=in-house. */
function emptyDataForProfile(profile) {
  const lower = profile.toLowerCase();
  const data = {};
  if (lower.includes('l')) data.loose = { vendors: [] };
  if (lower.includes('b')) data.branded = { brands: [] };
  if (lower.includes('i')) data.in_house = { recipes: [] };
  return data;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Main router
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(context.request.url);
  const env = context.env;
  const DB = env.DB;
  const method = context.request.method;
  const action = url.searchParams.get('action');
  const rmCodeParam = url.searchParams.get('rm_code');

  try {
    const user = authPin(url);
    if (!user) return json({ error: 'Invalid PIN' }, 401);

    if (action === 'seed' && method === 'POST') {
      return await seedAll(DB, user);
    }

    if (action === 'create' && method === 'POST') {
      return await createOne(DB, context.request, user);
    }

    if (rmCodeParam) {
      // Codes are mixed-case (e.g. HN-AM-Bl-BTR) — preserve as-is.
      const rmCode = rmCodeParam;
      if (method === 'GET') return await getOne(DB, rmCode, url);
      if (method === 'PUT') return await putOne(DB, rmCode, context.request, user);
      if (method === 'DELETE') return await deleteOne(DB, rmCode, user);
      return json({ error: 'Method not allowed' }, 405);
    }

    // no rm_code → list
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
    `SELECT rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
            rm_name, data_json, updated_at, updated_by
       FROM rm_sourcing_profiles
       ORDER BY brand_prefix, rm_type, rm_code`
  ).all();
  const rows = (rs.results || []).map(r => {
    let counts = { vendors: 0, brands: 0, skus: 0, suppliers: 0, recipes: 0 };
    try {
      const d = JSON.parse(r.data_json || '{}');
      counts.vendors = d.loose?.vendors?.length || 0;
      counts.brands  = d.branded?.brands?.length || 0;
      counts.skus    = (d.branded?.brands || []).reduce((s, b) => s + (b.skus?.length || 0), 0);
      counts.suppliers = (d.branded?.brands || []).reduce(
        (s, b) => s + (b.skus || []).reduce((s2, sk) => s2 + (sk.suppliers?.length || 0), 0),
        0
      );
      counts.recipes = d.in_house?.recipes?.length || 0;
    } catch (_) {}
    return {
      rm_code: r.rm_code,
      brand_prefix: r.brand_prefix,
      rm_type: r.rm_type,
      usage_profile: r.usage_profile,
      sourcing_profile: r.sourcing_profile,
      item_abbr: r.item_abbr,
      rm_name: r.rm_name,
      counts,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    };
  });
  return json({ count: rows.length, rms: rows });
}

async function getOne(DB, rmCode, url) {
  const rs = await DB.prepare(
    `SELECT * FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rmCode).first();
  if (!rs) return json({ error: 'RM not found' }, 404);
  let data = {};
  try { data = JSON.parse(rs.data_json || '{}'); } catch (_) {}

  // Optional server-side enrichment — for each vendor_code FK reference,
  // inline the live vendor row (vendor_name, pay_seq, sells, opm, pms,
  // identity_abbr) so the editor can render names without an N+1 fetch.
  // Without ?expand=vendors, the raw compact data_json is returned.
  const expand = url ? url.searchParams.get('expand') : null;
  if (expand && /(^|,|=)vendors(=|$|,)/i.test(expand) || expand === 'vendors' || expand === '1') {
    await enrichVendorRefs(DB, data);
  }

  return json({
    rm_code: rs.rm_code,
    brand_prefix: rs.brand_prefix,
    rm_type: rs.rm_type,
    usage_profile: rs.usage_profile,
    sourcing_profile: rs.sourcing_profile,
    item_abbr: rs.item_abbr,
    rm_name: rs.rm_name,
    data,
    updated_at: rs.updated_at,
    updated_by: rs.updated_by,
  });
}

/* Walk a data_json tree and inline vendor_profile fields next to each
 * { vendor_code } reference. Adds: vendor_name, pay_seq, sells, opm, pms,
 * identity_abbr. Single batched SELECT — no N+1.
 *
 * Mutates `data` in place for efficiency. Refs without vendor_code (legacy
 * name+abbr only) are left untouched. */
async function enrichVendorRefs(DB, data) {
  const refs = [];
  collectVendorRefs(data, refs);
  if (refs.length === 0) return;

  const codes = Array.from(new Set(refs.map(r => r.vendor_code).filter(Boolean)));
  if (codes.length === 0) return;

  const placeholders = codes.map(() => '?').join(',');
  const rs = await DB.prepare(
    `SELECT vendor_code, vendor_name, pay_seq, sells, opm, pms, identity_abbr
       FROM vendor_profiles WHERE vendor_code IN (${placeholders})`
  ).bind(...codes).all();
  const byCode = new Map();
  for (const v of (rs.results || [])) byCode.set(v.vendor_code, v);

  for (const ref of refs) {
    const v = byCode.get(ref.vendor_code);
    if (v) {
      ref.vendor_name   = v.vendor_name;
      ref.pay_seq       = v.pay_seq;
      ref.sells         = v.sells;
      ref.opm           = v.opm;
      ref.pms           = v.pms;
      ref.identity_abbr = v.identity_abbr;
    } else {
      // FK points to a vendor that no longer exists — flag for owner attention.
      ref.vendor_missing = true;
    }
  }
}

/* Collect every supplier-row object (carries `vendor_code` field) inside a
 * data_json tree, returning the live array of refs (mutating these refs
 * mutates the data_json). */
function collectVendorRefs(data, out) {
  if (!data || typeof data !== 'object') return;
  const looseV = (data.loose && Array.isArray(data.loose.vendors)) ? data.loose.vendors : [];
  for (const v of looseV) if (v.vendor_code) out.push(v);
  const brands = (data.branded && Array.isArray(data.branded.brands)) ? data.branded.brands : [];
  for (const br of brands) {
    for (const sk of (br.skus || [])) {
      for (const sup of (sk.suppliers || [])) {
        if (sup.vendor_code) out.push(sup);
      }
    }
  }
  // In-house recipes occasionally carry suppliers[] too (rare, supported
  // for symmetry with vendors.js computeRelationships).
  const recipes = (data.in_house && Array.isArray(data.in_house.recipes)) ? data.in_house.recipes : [];
  for (const rec of recipes) {
    for (const sup of (rec.suppliers || [])) {
      if (sup.vendor_code) out.push(sup);
    }
  }
}

async function putOne(DB, rmCode, request, user) {
  const body = await request.json();
  const existing = await DB.prepare(
    `SELECT * FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rmCode).first();
  if (!existing) return json({ error: 'RM not found' }, 404);

  const data = body.data ?? body.data_json;
  if (data === undefined || data === null) return json({ error: 'data missing' }, 400);
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();

  // Determine target structured parts: prefer body fields, fall back to existing row.
  // For usage_profile we distinguish "not provided" (undefined → fall back) from
  // "explicitly empty string" (validation will reject below).
  const brand_prefix     = body.brand_prefix     || existing.brand_prefix;
  const rm_type          = body.rm_type          || existing.rm_type;
  const usage_profile    = (body.usage_profile !== undefined) ? body.usage_profile : existing.usage_profile;
  const sourcing_profile = body.sourcing_profile || existing.sourcing_profile;
  const item_abbr        = (body.item_abbr || existing.item_abbr || '').toUpperCase();
  const rm_name          = body.rm_name          || existing.rm_name;

  // Validate usage_profile (must be P/R/Pr/Rp, never empty)
  const usageErr = validateUsageProfile(usage_profile);
  if (usageErr) return json({ error: usageErr }, 400);

  // Validate sourcing_profile (RM must be purchasable)
  const profileErr = validateSourcingProfile(sourcing_profile);
  if (profileErr) return json({ error: profileErr }, 400);

  // Compose new code if any structured part was provided.
  let newRmCode = rmCode;
  const structuredChanged =
    body.brand_prefix !== undefined ||
    body.rm_type !== undefined ||
    body.usage_profile !== undefined ||
    body.sourcing_profile !== undefined ||
    body.item_abbr !== undefined;

  if (structuredChanged) {
    try {
      newRmCode = composeRmCode({ brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }

  if (newRmCode !== rmCode) {
    // Migration path: ensure new code is unique, INSERT new row, DELETE old.
    const collide = await DB.prepare(
      `SELECT rm_code FROM rm_sourcing_profiles WHERE rm_code = ?`
    ).bind(newRmCode).first();
    if (collide) {
      return json({ error: `rm_code ${newRmCode} already exists. Pick a different abbreviation.` }, 409);
    }

    // D1 batch is atomic — wrap insert+delete together.
    await DB.batch([
      DB.prepare(
        `INSERT INTO rm_sourcing_profiles
           (rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
            rm_name, data_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newRmCode, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
             rm_name, dataStr, now, user.name),
      DB.prepare(`DELETE FROM rm_sourcing_profiles WHERE rm_code = ?`).bind(rmCode),
    ]);
    return json({
      success: true,
      rm_code: newRmCode,
      migrated_from: rmCode,
      updated_at: now,
      updated_by: user.name,
    });
  }

  // In-place update.
  await DB.prepare(
    `UPDATE rm_sourcing_profiles
        SET brand_prefix = ?, rm_type = ?, usage_profile = ?, sourcing_profile = ?, item_abbr = ?,
            rm_name = ?, data_json = ?, updated_at = ?, updated_by = ?
      WHERE rm_code = ?`
  ).bind(brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
         rm_name, dataStr, now, user.name, rmCode).run();

  return json({ success: true, rm_code: rmCode, updated_at: now, updated_by: user.name });
}

async function createOne(DB, request, user) {
  const body = await request.json();
  const brand_prefix     = body.brand_prefix;
  const rm_type          = body.rm_type;
  const usage_profile    = body.usage_profile;
  const sourcing_profile = body.sourcing_profile;
  const item_abbr        = (body.item_abbr || '').toUpperCase();
  const rm_name          = body.rm_name;

  if (!rm_name) return json({ error: 'rm_name required' }, 400);

  // Validate usage_profile (must be P/R/Pr/Rp)
  const usageErr = validateUsageProfile(usage_profile);
  if (usageErr) return json({ error: usageErr }, 400);

  // Validate sourcing_profile (RM must be purchasable)
  const profileErr = validateSourcingProfile(sourcing_profile);
  if (profileErr) return json({ error: profileErr }, 400);

  let rm_code;
  try {
    rm_code = composeRmCode({ brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const collide = await DB.prepare(
    `SELECT rm_code FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rm_code).first();
  if (collide) {
    return json({ error: `RM with code ${rm_code} already exists. Pick a different abbreviation.` }, 409);
  }

  const data = body.data ?? body.data_json ?? emptyDataForProfile(sourcing_profile);
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();

  await DB.prepare(
    `INSERT INTO rm_sourcing_profiles
       (rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
        rm_name, data_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
         rm_name, dataStr, now, user.name).run();

  return json({ success: true, rm_code, updated_at: now, updated_by: user.name }, 201);
}

async function deleteOne(DB, rmCode, user) {
  const exists = await DB.prepare(
    `SELECT rm_code FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rmCode).first();
  if (!exists) return json({ error: 'RM not found' }, 404);
  await DB.prepare(`DELETE FROM rm_sourcing_profiles WHERE rm_code = ?`).bind(rmCode).run();
  return json({ success: true, rm_code: rmCode, deleted_by: user.name });
}

async function seedAll(DB, user) {
  const existing = await DB.prepare(
    `SELECT COUNT(*) AS n FROM rm_sourcing_profiles`
  ).first();
  if (existing && existing.n > 0) {
    return json({ success: true, skipped: true, existing_count: existing.n });
  }
  const now = Date.now();
  const stmts = SEED_RMS.map(seed => {
    const parts = parseRmCode(seed.rm_code);
    const empty = emptyDataForProfile(parts.sourcing_profile);
    return DB.prepare(
      `INSERT INTO rm_sourcing_profiles
         (rm_code, brand_prefix, rm_type, usage_profile, sourcing_profile, item_abbr,
          rm_name, data_json, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      seed.rm_code,
      parts.brand_prefix,
      parts.rm_type,
      parts.usage_profile,
      parts.sourcing_profile,
      parts.item_abbr,
      seed.rm_name,
      JSON.stringify(empty),
      now,
      user.name
    );
  });
  await DB.batch(stmts);
  return json({ success: true, inserted: SEED_RMS.length });
}
