// ═══════════════════════════════════════════════════════════════════════════
// Hyperpure price feed — the scout on hn-rtx-worker scrapes the logged-in
// Hyperpure account and POSTs the cheapest valid ingredient price per item
// here; the Sauda "Tomorrow's Hyperpure order" screen GETs them.
//
//   POST /api/hyperpure-prices?t=<TOKEN>  { items: [{ item_key, query, cheapest:{name,price}, options:[...], match_count }] }
//   GET  /api/hyperpure-prices?t=<TOKEN>                → all current prices
//   GET  /api/hyperpure-prices?t=<TOKEN>&item=maida     → one item
//
// Token-gated (OTP_INGEST_TOKEN, falls back to DASHBOARD_KEY). Prices are mandi
// rates from the owner's real logged-in account — accurate by construction.
// ═══════════════════════════════════════════════════════════════════════════

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;
  const expected = env.OTP_INGEST_TOKEN || env.DASHBOARD_KEY;
  const t = url.searchParams.get('t') || request.headers.get('x-otp-token') || '';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!db) return json({ error: 'DB binding missing' }, 500);
  if (!expected || t !== expected) return json({ error: 'unauthorized' }, 401);

  const nowIso = new Date().toISOString();
  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      let saved = 0;
      for (const it of items) {
        const key = norm(it.item_key || it.query);
        if (!key) continue;
        const price = it.cheapest && it.cheapest.price ? Math.round(Number(it.cheapest.price) * 100) : null;
        await db.prepare(
          `INSERT INTO hyperpure_prices (item_key, query, cheapest_name, cheapest_price_paise, options_json, match_count, scraped_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(item_key) DO UPDATE SET query=excluded.query, cheapest_name=excluded.cheapest_name,
             cheapest_price_paise=excluded.cheapest_price_paise, options_json=excluded.options_json,
             match_count=excluded.match_count, scraped_at=excluded.scraped_at`
        ).bind(key, it.query || key, it.cheapest ? it.cheapest.name : null, price,
               JSON.stringify(it.options || []), it.match_count || 0, nowIso).run();
        saved++;
      }
      return json({ ok: true, saved });
    }
    if (request.method === 'GET') {
      const item = url.searchParams.get('item');
      if (item) {
        const r = await db.prepare(`SELECT * FROM hyperpure_prices WHERE item_key = ?`).bind(norm(item)).first();
        return json({ ok: true, item: r || null });
      }
      const rows = await db.prepare(`SELECT * FROM hyperpure_prices ORDER BY item_key`).all();
      return json({ ok: true, count: (rows?.results || []).length, items: rows?.results || [] });
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}
