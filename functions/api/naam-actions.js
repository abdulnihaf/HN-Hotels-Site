/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/naam-actions — the Naam marketing-decision CONTRACT (D1 hn-hiring).
 *
 * Naam is the demand→action→proof→result loop. This endpoint makes the owner's
 * decision DURABLE (survives a phone wipe / a switch to laptop) and HONEST
 * (records whether food proof was machine-verified — never a fake green tick).
 *
 *   GET  ?action=list&brand=HE        → recent decisions for a brand
 *   POST {action:'request', ...}      → record an approve/hold decision (idempotent per move+brand)
 *   POST {action:'result',  id, ...}  → attach the post-launch readback + learning
 *   POST {action:'check',   id}       → mark a decision checked (no result yet)
 *
 * DOCTRINE BOUNDARY (locked): this writes DECISION RECORDS only. It holds NO Meta
 * integration and NEVER changes campaign spend/status from the phone. Any action
 * that smells like a money/campaign mutation is rejected 403 — defence in depth.
 *
 * AUTH: the same owner PINs the Naam client already ships in public JS
 * (0305 / 1918) — not a secret, so validating them here is consistent, not new
 * exposure. HARDENING TODO (same as takht-auth): per-IP attempt limiter via KV
 * before any public exposure. Flagged, not silently shipped.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const OWNER_PINS = new Set(['0305', '1918']);
const BRANDS = new Set(['HE', 'NCH']);

const ALLOW_ORIGINS = new Set([
  'https://naam.hnhotels.in',
  'https://hnhotels.in',
  'http://localhost:8789', 'http://127.0.0.1:8789',
]);
function corsHeaders(request) {
  const o = request.headers.get('Origin') || '';
  // naam Pages project is "naam-ec8"; hn-hotels-site previews also allowed.
  const allow = (ALLOW_ORIGINS.has(o) || /^https:\/\/[a-z0-9-]+\.(naam-ec8|naam|hn-hotels-site)\.pages\.dev$/.test(o))
    ? o : 'https://naam.hnhotels.in';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}
function json(data, status, request) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders(request) });
}

// IST ISO8601 (the repo is IST throughout).
function nowIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');
}

async function ensureTable(DB) {
  await DB.exec("CREATE TABLE IF NOT EXISTS naam_decisions (id TEXT PRIMARY KEY, move_id TEXT NOT NULL, brand TEXT NOT NULL, lane TEXT NOT NULL DEFAULT 'Meta Ads', customer_state TEXT, title TEXT, hook TEXT, cta TEXT, decision TEXT NOT NULL, proof_verified INTEGER NOT NULL DEFAULT 0, proof_json TEXT, status TEXT NOT NULL DEFAULT 'queued', result_json TEXT, learning_note TEXT, decided_by TEXT NOT NULL DEFAULT 'owner', decided_at TEXT NOT NULL, checked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await DB.exec("CREATE INDEX IF NOT EXISTS idx_naam_decisions_brand ON naam_decisions(brand, created_at DESC)");
  await DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_naam_decisions_move ON naam_decisions(move_id, brand)");
}

function rowOut(r) {
  return {
    id: r.id, move_id: r.move_id, brand: r.brand, lane: r.lane,
    customer_state: r.customer_state, title: r.title, hook: r.hook, cta: r.cta,
    decision: r.decision, proof_verified: !!r.proof_verified,
    proof: safeParse(r.proof_json), status: r.status,
    result: safeParse(r.result_json), learning_note: r.learning_note,
    decided_at: r.decided_at, checked_at: r.checked_at, created_at: r.created_at,
  };
}
function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function str(v, max) { return v == null ? null : String(v).slice(0, max || 400); }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });

  const url = new URL(request.url);
  const DB = env.DB;
  if (!DB) return json({ ok: false, error: 'DB not configured' }, 500, request);

  try {
    await ensureTable(DB);

    // ── READ ────────────────────────────────────────────────
    if (request.method === 'GET') {
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const q = brand && BRANDS.has(brand)
        ? DB.prepare('SELECT * FROM naam_decisions WHERE brand = ? ORDER BY created_at DESC LIMIT 50').bind(brand)
        : DB.prepare('SELECT * FROM naam_decisions ORDER BY created_at DESC LIMIT 50');
      const rows = await q.all();
      return json({ ok: true, decisions: (rows.results || []).map(rowOut) }, 200, request);
    }

    // ── WRITE ───────────────────────────────────────────────
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405, request);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');

    // Defence in depth: this endpoint NEVER mutates spend/campaigns. Reject anything
    // that looks like one, even though no such integration exists here.
    if (/launch|pause|resume|budget|spend|mutate|campaign_status/i.test(action)) {
      return json({ ok: false, error: 'CAMPAIGN_MUTATION_NOT_PERMITTED — Naam records decisions only.' }, 403, request);
    }

    const pin = String(body.pin || '').trim();
    if (!OWNER_PINS.has(pin)) return json({ ok: false, error: 'PIN not recognised' }, 401, request);

    if (action === 'request') {
      const brand = String(body.brand || '').toUpperCase();
      if (!BRANDS.has(brand)) return json({ ok: false, error: 'brand (HE|NCH) required' }, 400, request);
      const move_id = str(body.move_id, 120);
      if (!move_id) return json({ ok: false, error: 'move_id required' }, 400, request);
      const decision = body.decision === 'hold' ? 'hold' : 'approve';
      const id = 'dec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const at = nowIST();
      const proof_verified = body.proof_verified ? 1 : 0;
      const proof_json = body.proof ? JSON.stringify(body.proof).slice(0, 4000) : null;

      // Idempotent per (move_id, brand): a re-decision UPDATEs the same row (approve↔hold)
      // instead of duplicating. ON CONFLICT keeps the original id/created_at.
      await DB.prepare(
        `INSERT INTO naam_decisions
           (id, move_id, brand, lane, customer_state, title, hook, cta, decision, proof_verified, proof_json, status, decided_by, decided_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'queued', 'owner', ?)
         ON CONFLICT(move_id, brand) DO UPDATE SET
           decision=excluded.decision, proof_verified=excluded.proof_verified,
           proof_json=excluded.proof_json, customer_state=excluded.customer_state,
           title=excluded.title, hook=excluded.hook, cta=excluded.cta, lane=excluded.lane,
           decided_at=excluded.decided_at, status='queued'`
      ).bind(
        id, move_id, brand, str(body.lane, 60) || 'Meta Ads', str(body.customer_state, 60),
        str(body.title, 200), str(body.hook, 300), str(body.cta, 120), decision, proof_verified, proof_json, at
      ).run();

      const saved = await DB.prepare('SELECT * FROM naam_decisions WHERE move_id = ? AND brand = ? LIMIT 1').bind(move_id, brand).first();
      return json({ ok: true, decision: rowOut(saved) }, 200, request);
    }

    if (action === 'result' || action === 'check') {
      const id = str(body.id, 80);
      if (!id) return json({ ok: false, error: 'id required' }, 400, request);
      const existing = await DB.prepare('SELECT id FROM naam_decisions WHERE id = ? LIMIT 1').bind(id).first();
      if (!existing) return json({ ok: false, error: 'decision not found' }, 404, request);
      const result_json = body.result ? JSON.stringify(body.result).slice(0, 4000) : null;
      await DB.prepare(
        `UPDATE naam_decisions SET status='checked', checked_at=?,
           result_json = COALESCE(?, result_json),
           learning_note = COALESCE(?, learning_note)
         WHERE id = ?`
      ).bind(nowIST(), result_json, str(body.learning_note, 1000), id).run();
      const saved = await DB.prepare('SELECT * FROM naam_decisions WHERE id = ? LIMIT 1').bind(id).first();
      return json({ ok: true, decision: rowOut(saved) }, 200, request);
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400, request);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, request);
  }
}
