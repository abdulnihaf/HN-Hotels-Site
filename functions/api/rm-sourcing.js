/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — RM Sourcing Profile API
 * Route:  /api/rm-sourcing
 * D1:     DB (hn-hiring) — table rm_sourcing_profiles
 *
 * GET    /api/rm-sourcing?pin=<pin>                   → list all RMs (lightweight)
 * GET    /api/rm-sourcing?pin=<pin>&rm_code=<code>    → single RM with data_json
 * PUT    /api/rm-sourcing?pin=<pin>&rm_code=<code>    → update data_json (+ optional sourcing_profile)
 * POST   /api/rm-sourcing?pin=<pin>&action=seed       → idempotent seed of 31 RMs
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
 * 31 NCH RM seed list — canonical codes
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
  // NCH- only (19)
  { rm_code: 'NCH-AM-Lb-MLK', rm_name: 'Buffalo Milk' },
  { rm_code: 'NCH-AM-Bl-TEA', rm_name: 'Tea Powder' },
  { rm_code: 'NCH-AM-Bl-SMP', rm_name: 'Skimmed Milk Powder' },
  { rm_code: 'NCH-AM-Lb-SAF', rm_name: 'Saffron' },
  { rm_code: 'NCH-AM-B-WTR',  rm_name: 'Bottled Water' },
  { rm_code: 'NCH-AM-L-SBJ',  rm_name: 'Sabja' },
  { rm_code: 'NCH-AM-B-CHC',  rm_name: 'Chocolate Powder' },
  { rm_code: 'NCH-AS-L-CCT',  rm_name: 'Chicken Cutlet Raw' },
  { rm_code: 'NCH-AS-L-CHB',  rm_name: 'Chicken Bites Raw' },
  { rm_code: 'NCH-AS-L-SMS',  rm_name: 'Samosa Raw' },
  { rm_code: 'NCH-AS-Lbi-BUN',rm_name: 'Bun' },
  { rm_code: 'NCH-AS-Lb-PMK', rm_name: 'Pumpkin Seeds' },
  { rm_code: 'NCH-AS-Lb-HNY', rm_name: 'Honey' },
  { rm_code: 'NCH-AS-I-MAL',  rm_name: 'Malai' },
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

    if (rmCodeParam) {
      // Codes are mixed-case (e.g. HN-AM-Bl-BTR) — preserve as-is.
      const rmCode = rmCodeParam;
      if (method === 'GET') return await getOne(DB, rmCode);
      if (method === 'PUT') return await putOne(DB, rmCode, context.request, user);
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
  const exists = await DB.prepare(
    `SELECT rm_code FROM rm_sourcing_profiles WHERE rm_code = ?`
  ).bind(rmCode).first();
  if (!exists) return json({ error: 'RM not found' }, 404);

  const data = body.data ?? body.data_json;
  if (!data) return json({ error: 'data missing' }, 400);

  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();

  // Optionally update sourcing_profile if provided
  if (body.sourcing_profile) {
    await DB.prepare(
      `UPDATE rm_sourcing_profiles
          SET sourcing_profile = ?, data_json = ?, updated_at = ?, updated_by = ?
        WHERE rm_code = ?`
    ).bind(body.sourcing_profile, dataStr, now, user.name, rmCode).run();
  } else {
    await DB.prepare(
      `UPDATE rm_sourcing_profiles
          SET data_json = ?, updated_at = ?, updated_by = ?
        WHERE rm_code = ?`
    ).bind(dataStr, now, user.name, rmCode).run();
  }

  return json({ success: true, rm_code: rmCode, updated_at: now, updated_by: user.name });
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
