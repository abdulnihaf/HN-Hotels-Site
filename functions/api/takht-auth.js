/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/takht-auth — the Darbar → Takht identity cross-connect.
 *
 * Darbar (hr_employees, D1 hn-hiring) is the SINGLE identity source. Takht owns
 * no people — it resolves a typed staff_pin into a scoped identity here.
 *   verify-pin : pin → { id, name, brand, role, scope }   (active FOH only)
 *   directory  : brand → FOH roster (id/name/role; NO pins) for pick-lists
 *
 * brand_label scopes the surface (NCH/HE/HQ). job_name → view + capabilities.
 * BOH roles are rejected here (foh:false) — their PIN exists in Darbar but
 * Takht access is FOH-only for now; Anbar consumes BOH later.
 *
 * SECURITY NOTE: 4-digit PIN is enumerable. Before public exposure, add a
 * per-IP attempt limiter (KV). Acceptable for the internal staff PWA today;
 * flagged, not silently shipped.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ALLOW_ORIGINS = new Set([
  'https://takht.hnhotels.in',
  'https://nawabichaihouse.com',
  'https://hamzaexpress.in',
  'http://localhost:8789', 'http://127.0.0.1:8789',
]);
function corsHeaders(request) {
  const o = request.headers.get('Origin') || '';
  // Reflect a known origin, or any *.pages.dev preview of the brand projects.
  // This is a no-credentials GET — the PIN is the secret, not the origin; CORS is
  // not the access control here (the hardening TODO is a per-IP rate limiter).
  const allow = (ALLOW_ORIGINS.has(o) || /^https:\/\/[a-z0-9-]+\.(nawabi-chai-house-sit|hamza-express-site|hn-hotels-site)\.pages\.dev$/.test(o))
    ? o : 'https://takht.hnhotels.in';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}
function json(data, status, request) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders(request) });
}

// Free-text job_name → Takht view + capabilities. Mirrors the real seed roles.
// FOH (Takht now): cashier, runner, captain/waiter/steward, chai master, managers/admin.
// BOH (Anbar later): chef, cook, tandoor, helper, porotta, washer, dishwasher, cleaner.
function classifyRole(job) {
  const j = String(job || '').toLowerCase().trim();
  const mgr     = /managing director|general manager|\bgm\b|\bmanager\b|cfo|office executive|\badmin\b/.test(j);
  const cashier = /cashier/.test(j);
  const runner  = /\brunner\b/.test(j);
  const captain = /captain|waiter|steward/.test(j);
  const chai    = /chai master|tea master|irani chai/.test(j);
  let view = 'none', foh = false;
  if (mgr)          { view = 'manager'; foh = true; }
  else if (cashier) { view = 'cashier'; foh = true; }
  else if (runner)  { view = 'runner';  foh = true; }
  else if (captain) { view = 'captain'; foh = true; }
  else if (chai)    { view = 'counter'; foh = true; }   // chai master mans the NCH counter
  return {
    view, foh,
    can_fix:     mgr || cashier,
    can_settle:  mgr || cashier,
    cross_brand: mgr,                                    // HQ managers/admin see both brands
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const DB = env.DB;
  if (!DB) return json({ ok: false, error: 'DB not configured' }, 500, request);

  try {
    if (action === 'verify-pin') {
      const pin = (url.searchParams.get('pin') || '').trim();
      if (!/^\d{4}$/.test(pin)) return json({ ok: false, error: '4-digit PIN required' }, 400, request);
      const e = await DB.prepare(
        'SELECT id, name, known_as, brand_label, job_name, is_active FROM hr_employees WHERE staff_pin = ? LIMIT 1'
      ).bind(pin).first();
      if (!e || !e.is_active) return json({ ok: false, error: 'PIN not recognised' }, 401, request);
      const scope = classifyRole(e.job_name);
      if (!scope.foh) return json({ ok: false, error: 'This role has no Takht access yet (back-of-house comes with Anbar).' }, 403, request);
      return json({
        ok: true,
        id: e.id,
        name: e.known_as || e.name,
        brand: e.brand_label,            // NCH | HE | HQ
        role: e.job_name || '',
        scope,
      }, 200, request);
    }

    if (action === 'directory') {
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      if (!['HE', 'NCH', 'HQ'].includes(brand)) return json({ ok: false, error: 'brand (HE|NCH|HQ) required' }, 400, request);
      const rows = await DB.prepare(
        'SELECT id, name, known_as, job_name FROM hr_employees WHERE is_active = 1 AND brand_label = ? ORDER BY name'
      ).bind(brand).all();
      const people = (rows.results || [])
        .map(r => ({ id: r.id, name: r.known_as || r.name, role: r.job_name || '', ...classifyRole(r.job_name) }))
        .filter(p => p.foh);
      return json({ ok: true, brand, people }, 200, request);
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400, request);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, request);
  }
}
