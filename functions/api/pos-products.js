/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — POS Product Entity Ring API
 * Route:  /api/pos-products
 * D1:     DB (hn-hiring) — table pos_products
 *
 * Canonical grammar (locked):
 *   {BRAND}-{SHAPE}-{ITEM}
 *     BRAND ∈ {NCH, HE, HN}
 *     SHAPE ∈ {S1...S10}
 *       S1  RESALE             — bought-and-sold-as-is (e.g. Niloufer 100g)
 *       S2  MULTI_UNIT         — N units of same RM per sale (e.g. 3-pack)
 *       S3  SINGLE_PORTION     — exact recipe, fixed proportions
 *       S4  MULTI_PORTION      — recipe scaled to multiple portions
 *       S5  BATCH+APX          — drawn from a batch w/ approximate ratios
 *       S6  MARINATED_PROTEIN  — protein with marination (HE-side)
 *       S7  WRAP               — wrap/roll item (HE-side)
 *       S8  UNIT_PROTEIN       — unit-priced protein (HE-side)
 *       S9  COMPOSITE          — composite of sub-items (e.g. thali)
 *       S10 NO_RM              — no RM consumption (service charge, etc)
 *     ITEM — exactly 3 uppercase A-Z / 0-9 chars, unique within (BRAND, SHAPE).
 *
 * Endpoints (PIN-gated; same USERS table as rm-sourcing.js / vendors.js):
 *   GET    /api/pos-products?pin=…                   → list (lightweight)
 *   GET    /api/pos-products?pin=…&pos_code=…        → single + full data_json
 *   PUT    /api/pos-products?pin=…&pos_code=…        → update (atomic re-key on segment change)
 *   POST   /api/pos-products?pin=…&action=create     → create new POS product
 *   DELETE /api/pos-products?pin=…&pos_code=…        → delete (refuses if recipe-referenced — placeholder)
 *
 * Closes Framework Gap 2: today the 33 NCH service POS products + 21 retail
 * Niloufer SKUs live only in the Foundation Sheet. With this endpoint, they're
 * first-class D1 rows; recipes (future Action ring) can FK against pos_code.
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

const BRANDS = ['NCH', 'HE', 'HN'];
const SHAPES = ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10'];

function validateBrand(b) {
  if (!b || typeof b !== 'string') return 'brand_prefix required — NCH / HE / HN';
  if (!BRANDS.includes(b)) return `brand_prefix must be NCH, HE, or HN. Got "${b}".`;
  return null;
}

function validateShape(s) {
  if (!s || typeof s !== 'string') return 'shape required — S1...S10';
  if (!SHAPES.includes(s)) return `shape must be S1...S10. Got "${s}".`;
  return null;
}

function validateItem(i) {
  if (!i || typeof i !== 'string') return 'item_abbr required';
  const trimmed = i.trim();
  if (trimmed.length !== 3) return `item_abbr must be exactly 3 chars (got ${trimmed.length})`;
  if (!/^[A-Z0-9]{3}$/.test(trimmed)) return 'item_abbr must be uppercase A-Z / 0-9 only';
  return null;
}

function composePosCode({ brand_prefix, shape, item_abbr }) {
  const bErr = validateBrand(brand_prefix); if (bErr) throw new Error(bErr);
  const sErr = validateShape(shape);        if (sErr) throw new Error(sErr);
  const iErr = validateItem(item_abbr);     if (iErr) throw new Error(iErr);
  return `${brand_prefix}-${shape}-${item_abbr.trim().toUpperCase()}`;
}

/* Parse a 3-segment POS code. Returns null if shape doesn't match. */
function parsePosCode(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.match(/^(NCH|HE|HN)-(S(?:[1-9]|10))-([A-Z0-9]{3})$/);
  if (!m) return null;
  return { brand_prefix: m[1], shape: m[2], item_abbr: m[3] };
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
  const codeP  = url.searchParams.get('pos_code');

  try {
    const user = authPin(url);
    if (!user) return json({ error: 'Invalid PIN' }, 401);

    if (action === 'create' && method === 'POST') {
      return await createOne(DB, context.request, user);
    }

    if (codeP) {
      if (method === 'GET')    return await getOne(DB, codeP);
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
    `SELECT pos_code, brand_prefix, shape, item_abbr, pos_name,
            data_json, updated_at, updated_by
       FROM pos_products
       ORDER BY pos_code`
  ).all();

  const rows = (rs.results || []).map(r => {
    let preview = {};
    try {
      const d = JSON.parse(r.data_json || '{}');
      preview = {
        mrp:      d.price?.mrp ?? null,
        dsp:      d.price?.dsp ?? null,
        category: d.category   ?? null,
        season:   d.season     ?? null,
      };
    } catch (_) {}
    return {
      pos_code:     r.pos_code,
      brand_prefix: r.brand_prefix,
      shape:        r.shape,
      item_abbr:    r.item_abbr,
      pos_name:     r.pos_name,
      preview,
      updated_at:   r.updated_at,
      updated_by:   r.updated_by,
    };
  });

  return json({ count: rows.length, pos_products: rows });
}

async function getOne(DB, posCode) {
  const rs = await DB.prepare(
    `SELECT * FROM pos_products WHERE pos_code = ?`
  ).bind(posCode).first();
  if (!rs) return json({ error: 'POS product not found' }, 404);

  let data = {};
  try { data = JSON.parse(rs.data_json || '{}'); } catch (_) {}

  return json({
    pos_code:     rs.pos_code,
    brand_prefix: rs.brand_prefix,
    shape:        rs.shape,
    item_abbr:    rs.item_abbr,
    pos_name:     rs.pos_name,
    data,
    updated_at:   rs.updated_at,
    updated_by:   rs.updated_by,
  });
}

async function createOne(DB, request, user) {
  const body = await request.json();
  const brand_prefix = (body.brand_prefix || '').toString().trim().toUpperCase();
  const shape        = (body.shape        || '').toString().trim().toUpperCase();
  const item_abbr    = (body.item_abbr    || '').toString().trim().toUpperCase();
  const pos_name     = (body.pos_name     || '').toString().trim();

  if (!pos_name) return json({ error: 'pos_name required' }, 400);

  const bErr = validateBrand(brand_prefix); if (bErr) return json({ error: bErr }, 400);
  const sErr = validateShape(shape);        if (sErr) return json({ error: sErr }, 400);
  const iErr = validateItem(item_abbr);     if (iErr) return json({ error: iErr }, 400);

  let pos_code;
  try {
    pos_code = composePosCode({ brand_prefix, shape, item_abbr });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  // Collision check — pos_code is the PK, also unique on (brand, shape, item).
  const collide = await DB.prepare(
    `SELECT pos_code FROM pos_products WHERE pos_code = ?`
  ).bind(pos_code).first();
  if (collide) {
    return json({
      error: `pos_code ${pos_code} already exists. Pick a different ITEM abbreviation.`,
    }, 409);
  }

  const data = body.data ?? body.data_json ?? {};
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();

  await DB.prepare(
    `INSERT INTO pos_products
       (pos_code, brand_prefix, shape, item_abbr, pos_name, data_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(pos_code, brand_prefix, shape, item_abbr, pos_name, dataStr, now, user.name).run();

  return json({
    success: true,
    pos_code,
    brand_prefix, shape, item_abbr, pos_name,
    updated_at: now,
    updated_by: user.name,
  }, 201);
}

async function putOne(DB, posCode, request, user) {
  const body = await request.json();
  const existing = await DB.prepare(
    `SELECT * FROM pos_products WHERE pos_code = ?`
  ).bind(posCode).first();
  if (!existing) return json({ error: 'POS product not found' }, 404);

  const brand_prefix = (body.brand_prefix !== undefined
    ? body.brand_prefix
    : existing.brand_prefix).toString().trim().toUpperCase();
  const shape = (body.shape !== undefined
    ? body.shape
    : existing.shape).toString().trim().toUpperCase();
  const item_abbr = (body.item_abbr !== undefined
    ? body.item_abbr
    : existing.item_abbr).toString().trim().toUpperCase();
  const pos_name = (body.pos_name !== undefined
    ? body.pos_name
    : existing.pos_name).toString().trim();

  if (!pos_name) return json({ error: 'pos_name required' }, 400);

  const bErr = validateBrand(brand_prefix); if (bErr) return json({ error: bErr }, 400);
  const sErr = validateShape(shape);        if (sErr) return json({ error: sErr }, 400);
  const iErr = validateItem(item_abbr);     if (iErr) return json({ error: iErr }, 400);

  let newCode;
  try {
    newCode = composePosCode({ brand_prefix, shape, item_abbr });
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

  if (newCode !== posCode) {
    // Re-key path: any segment changed → atomic INSERT new + DELETE old.
    const collide = await DB.prepare(
      `SELECT pos_code FROM pos_products WHERE pos_code = ?`
    ).bind(newCode).first();
    if (collide) {
      return json({ error: `pos_code ${newCode} already exists.` }, 409);
    }

    await DB.batch([
      DB.prepare(
        `INSERT INTO pos_products
           (pos_code, brand_prefix, shape, item_abbr, pos_name, data_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newCode, brand_prefix, shape, item_abbr, pos_name, dataStr, now, user.name),
      DB.prepare(`DELETE FROM pos_products WHERE pos_code = ?`).bind(posCode),
    ]);

    return json({
      success: true,
      pos_code:      newCode,
      migrated_from: posCode,
      brand_prefix, shape, item_abbr, pos_name,
      updated_at:    now,
      updated_by:    user.name,
    });
  }

  // In-place update.
  await DB.prepare(
    `UPDATE pos_products
        SET brand_prefix = ?, shape = ?, item_abbr = ?, pos_name = ?,
            data_json = ?, updated_at = ?, updated_by = ?
      WHERE pos_code = ?`
  ).bind(brand_prefix, shape, item_abbr, pos_name, dataStr, now, user.name, posCode).run();

  return json({
    success: true,
    pos_code: posCode,
    brand_prefix, shape, item_abbr, pos_name,
    updated_at: now,
    updated_by: user.name,
  });
}

async function deleteOne(DB, posCode, user) {
  const existing = await DB.prepare(
    `SELECT pos_code, pos_name FROM pos_products WHERE pos_code = ?`
  ).bind(posCode).first();
  if (!existing) return json({ error: 'POS product not found' }, 404);

  // Future: when rm_recipes lands, refuse delete if recipe references this code.
  // Today no recipe table exists, so deletion is unconstrained — but the API
  // contract is in place so the recipe ring can plug in without retrofit.
  // Defensive belt-and-braces: check for the table first.
  try {
    const refs = await DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='rm_recipes' LIMIT 1`
    ).first();
    if (refs) {
      const referenced = await DB.prepare(
        `SELECT COUNT(*) AS n FROM rm_recipes WHERE pos_code = ?`
      ).bind(posCode).first();
      if (referenced && referenced.n > 0) {
        return json({
          error: `POS product referenced in ${referenced.n} recipe${referenced.n === 1 ? '' : 's'}. Update or remove those recipes first.`,
        }, 409);
      }
    }
  } catch (_) {
    // Table doesn't exist yet — proceed with delete.
  }

  await DB.prepare(`DELETE FROM pos_products WHERE pos_code = ?`).bind(posCode).run();
  return json({ success: true, pos_code: posCode, deleted_by: user.name });
}
