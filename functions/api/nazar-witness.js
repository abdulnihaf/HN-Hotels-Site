/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/nazar-witness — public, login-free billed-vs-witnessed board feed for the STAFF link.
 *
 * The RTX box (he_witness.py) computes the HE cockpit and PUSHES a FACES-OFF payload here every loop
 * (POST, gated by NAZAR_WITNESS_KEY). The static staff page at /ops/witness/ reads it (GET, public + CORS).
 * The box itself stays unexposed; customer faces never leave the owner app (the pushed payload carries no
 * image URLs — only counts, the gap, table/time/duration, and the WHY). Storage: one row in D1 (binding DB).
 *
 * Honesty: GET reports `age_s`/`stale` so the page can say "data may be stale" rather than show old numbers
 * as live. Review-assist, never an oracle — the payload stays trust="calibrating" until a hand-count agrees.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const STALE_S = 180;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-ingest-key',
    'Content-Type': 'application/json',
  };
}
function json(d, status) { return new Response(JSON.stringify(d), { status: status || 200, headers: { ...cors(), 'Cache-Control': 'no-store' } }); }

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS nazar_witness_snapshot (
       brand TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL )`
  ).run();
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  if (method === 'POST') {
    // ingest is gated by the project's existing DASHBOARD_KEY (the box already holds it) — no new secret to provision
    const expected = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || '';
    const key = request.headers.get('x-ingest-key') || '';
    if (!expected || key !== expected) return json({ ok: false, err: 'unauthorized' }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, err: 'bad json' }, 400); }
    const brand = (body && body.brand) || 'HE';
    try {
      await ensureTable(env);
      await env.DB.prepare(
        `INSERT INTO nazar_witness_snapshot (brand, payload, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(brand) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`
      ).bind(brand, JSON.stringify(body), Math.floor(Date.now() / 1000)).run();
      return json({ ok: true, brand });
    } catch (e) {
      return json({ ok: false, err: String(e && e.message || e) }, 500);
    }
  }

  if (method === 'GET') {
    const brand = new URL(request.url).searchParams.get('brand') || 'HE';
    try {
      const row = await env.DB.prepare(
        `SELECT payload, updated_at FROM nazar_witness_snapshot WHERE brand=?1`
      ).bind(brand).first();
      if (!row) return json({ ok: false, warming: true, note: 'No snapshot yet — the witness feed has not pushed.' });
      const age = Math.max(0, Math.floor(Date.now() / 1000) - (row.updated_at || 0));
      let payload;
      try { payload = JSON.parse(row.payload); } catch { payload = {}; }
      return json({ ...payload, server_age_s: age, stale: age > STALE_S });
    } catch (e) {
      // table may not exist until the first push
      return json({ ok: false, warming: true, err: String(e && e.message || e) });
    }
  }

  return json({ ok: false, err: 'method not allowed' }, 405);
}
