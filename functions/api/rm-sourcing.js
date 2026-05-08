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
 * 30 NCH RM seed list — canonical codes
 * Malai removed (state of production, not RM).
 * 3 raw items moved to Li (bought ready today, in-house possible tomorrow).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const SEED_RMS = [
  // HN- cross-brand (12)
  { rm_code: 'HN-AM-Lb-SUG', rm_name: 'Sugar' },
  { rm_code: 'HN-AM-Lb-MDA', rm_name: 'Maida' },
  { rm_code: 'HN-AM-Lb-SAU', rm_name: 'Saunf' },
  { rm_code: 'HN-AM-Lb-KAJ', rm_name: 'Kaju' },
  { rm_code: 'HN-AM-Lb-CAR', rm_name: 'Cardamom' },
  { rm_code: 'HN-AM-Lb-OIL', rm_name: 'Oil' },
  { rm_code: 'HN-AM-Lb-ALM', rm_name: 'Almonds' },
  { rm_code: 'HN-AM-Bl-BTR', rm_name: 'Butter' },
  { rm_code: 'HN-AM-B-SOD',  rm_name: 'Soda' },
  { rm_code: 'HN-AM-B-LPG',  rm_name: 'LPG' },
  { rm_code: 'HN-AM-L-CHL',  rm_name: 'Charcoal' },
  { rm_code: 'HN-AM-L-GIN',  rm_name: 'Ginger' },
  // NCH- only (18)
  { rm_code: 'NCH-AM-Lb-MLK', rm_name: 'Buffalo Milk' },
  { rm_code: 'NCH-AM-Bl-TEA', rm_name: 'Tea Powder' },
  { rm_code: 'NCH-AM-Bl-SMP', rm_name: 'Skimmed Milk Powder' },
  { rm_code: 'NCH-AM-Lb-SAF', rm_name: 'Saffron' },
  { rm_code: 'NCH-AM-B-WTR',  rm_name: 'Bottled Water' },
  { rm_code: 'NCH-AM-L-SBJ',  rm_name: 'Sabja' },
  { rm_code: 'NCH-AM-B-CHC',  rm_name: 'Chocolate Powder' },
  { rm_code: 'NCH-AS-Li-CCT', rm_name: 'Chicken Cutlet Raw' },
  { rm_code: 'NCH-AS-Li-CHB', rm_name: 'Chicken Bites Raw' },
  { rm_code: 'NCH-AS-Li-SMS', rm_name: 'Samosa Raw' },
  { rm_code: 'NCH-AS-Lbi-BUN',rm_name: 'Bun' },
  { rm_code: 'NCH-AS-Lb-PMK', rm_name: 'Pumpkin Seeds' },
  { rm_code: 'NCH-AS-Lb-HNY', rm_name: 'Honey' },
  { rm_code: 'NCH-AS-B-HRK',  rm_name: 'Horlicks' },
  { rm_code: 'NCH-AS-B-BST',  rm_name: 'Boost' },
  { rm_code: 'NCH-AS-B-JAM',  rm_name: 'Jam' },
  { rm_code: 'NCH-AS-B-NUT',  rm_name: 'Nutella' },
  { rm_code: 'NCH-DM-Bl-OSB', rm_name: 'Osmania Biscuit' },
];

/* parse rm_code → { brand_prefix, rm_type, sourcing_profile, item_abbr } */
function parseRmCode(code) {
  // shape: PREFIX-TYPE-PROFILE-ITEM   (PREFIX may have 2-3 chars; ITEM 3)
  const parts = code.split('-');
  if (parts.length !== 4) {
    throw new Error(`Bad rm_code shape: ${code}`);
  }
  const [brand_prefix, rm_type, sourcing_profile, item_abbr] = parts;
  return { brand_prefix, rm_type, sourcing_profile, item_abbr };
}

/* Compose canonical rm_code from structured parts.
 * sourcing_profile rule: primary uppercase first, alternates lowercase sorted. */
function composeRmCode({ brand_prefix, rm_type, sourcing_profile, item_abbr }) {
  if (!brand_prefix || !rm_type || !sourcing_profile || !item_abbr) {
    throw new Error('Missing required parts to compose rm_code');
  }
  const allowedBrands = new Set(['HN', 'NCH', 'HE']);
  if (!allowedBrands.has(brand_prefix)) {
    throw new Error(`Bad brand_prefix: ${brand_prefix}`);
  }
  if (!/^[ADP][MS]$/.test(rm_type)) {
    throw new Error(`Bad rm_type: ${rm_type} (expected e.g. AM/AS/DM/DS)`);
  }
  if (!/^[LBI][lbi]*$/.test(sourcing_profile)) {
    throw new Error(`Bad sourcing_profile: ${sourcing_profile}`);
  }
  if (!/^[A-Z0-9]{2,4}$/.test(item_abbr)) {
    throw new Error(`Bad item_abbr: ${item_abbr}`);
  }
  return `${brand_prefix}-${rm_type}-${sourcing_profile}-${item_abbr}`;
}

/* Validate sourcing_profile per the "RM must be purchasable" rule.
 * Returns null if valid, or a string error message if not. */
function validateSourcingProfile(profile) {
  if (!profile || typeof profile !== 'string') {
    return 'Sourcing profile is required';
  }
  if (profile === 'I') {
    return 'An RM must be purchasable. Items only producible in-house are states of production, not RMs. Either add L or B as another sourcing mode, or move this item to the States layer.';
  }
  if (!/^[LBI][lbi]*$/.test(profile)) {
    return 'Invalid sourcing profile. Must contain only L, B, I letters with primary uppercase.';
  }
  // First letter is primary; rest are alternates
  const primary = profile[0];
  const alternates = profile.slice(1);
  // Check no duplicates: primary letter shouldn't appear lowercase in alternates
  if (alternates.toUpperCase().includes(primary)) {
    return 'Sourcing profile is malformed: primary letter cannot also appear as alternate.';
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
      if (method === 'GET') return await getOne(DB, rmCode);
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
    `SELECT rm_code, brand_prefix, rm_type, sourcing_profile, item_abbr,
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

async function getOne(DB, rmCode) {
  const rs = await DB.prepare(
    `SELECT * FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rmCode).first();
  if (!rs) return json({ error: 'RM not found' }, 404);
  let data = {};
  try { data = JSON.parse(rs.data_json || '{}'); } catch (_) {}
  return json({
    rm_code: rs.rm_code,
    brand_prefix: rs.brand_prefix,
    rm_type: rs.rm_type,
    sourcing_profile: rs.sourcing_profile,
    item_abbr: rs.item_abbr,
    rm_name: rs.rm_name,
    data,
    updated_at: rs.updated_at,
    updated_by: rs.updated_by,
  });
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
  const brand_prefix     = body.brand_prefix     || existing.brand_prefix;
  const rm_type          = body.rm_type          || existing.rm_type;
  const sourcing_profile = body.sourcing_profile || existing.sourcing_profile;
  const item_abbr        = (body.item_abbr || existing.item_abbr || '').toUpperCase();
  const rm_name          = body.rm_name          || existing.rm_name;

  // Validate sourcing_profile (RM must be purchasable)
  const profileErr = validateSourcingProfile(sourcing_profile);
  if (profileErr) return json({ error: profileErr }, 400);

  // Compose new code if any structured part was provided.
  let newRmCode = rmCode;
  const structuredChanged =
    body.brand_prefix !== undefined ||
    body.rm_type !== undefined ||
    body.sourcing_profile !== undefined ||
    body.item_abbr !== undefined;

  if (structuredChanged) {
    try {
      newRmCode = composeRmCode({ brand_prefix, rm_type, sourcing_profile, item_abbr });
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
           (rm_code, brand_prefix, rm_type, sourcing_profile, item_abbr,
            rm_name, data_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newRmCode, brand_prefix, rm_type, sourcing_profile, item_abbr,
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
        SET brand_prefix = ?, rm_type = ?, sourcing_profile = ?, item_abbr = ?,
            rm_name = ?, data_json = ?, updated_at = ?, updated_by = ?
      WHERE rm_code = ?`
  ).bind(brand_prefix, rm_type, sourcing_profile, item_abbr,
         rm_name, dataStr, now, user.name, rmCode).run();

  return json({ success: true, rm_code: rmCode, updated_at: now, updated_by: user.name });
}

async function createOne(DB, request, user) {
  const body = await request.json();
  const brand_prefix     = body.brand_prefix;
  const rm_type          = body.rm_type;
  const sourcing_profile = body.sourcing_profile;
  const item_abbr        = (body.item_abbr || '').toUpperCase();
  const rm_name          = body.rm_name;

  if (!rm_name) return json({ error: 'rm_name required' }, 400);

  // Validate sourcing_profile (RM must be purchasable)
  const profileErr = validateSourcingProfile(sourcing_profile);
  if (profileErr) return json({ error: profileErr }, 400);

  let rm_code;
  try {
    rm_code = composeRmCode({ brand_prefix, rm_type, sourcing_profile, item_abbr });
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
       (rm_code, brand_prefix, rm_type, sourcing_profile, item_abbr,
        rm_name, data_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(rm_code, brand_prefix, rm_type, sourcing_profile, item_abbr,
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
         (rm_code, brand_prefix, rm_type, sourcing_profile, item_abbr,
          rm_name, data_json, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      seed.rm_code,
      parts.brand_prefix,
      parts.rm_type,
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
