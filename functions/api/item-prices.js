// ═══════════════════════════════════════════════════════════════════════════
// Multi-source item prices — the cheapest-across-portals engine.
//
// Every source (hyperpure, zepto, amazon, blinkit, …) scrapes the SAME catalog
// on the RTX box (once a day) and POSTs its cheapest match per item here. The
// app reads the merged view and shows the cheapest source automatically — no
// manual per-item price hunting. Adding a portal = a new `source`, never a
// schema change (COA: a source is a coordinate, not a migration).
//
//   POST /api/item-prices?t=<TOKEN>  { source, items:[{item_key,query,cheapest:{name,price,unit_price,unit,pack,brand,image,url}, options, match_count}] }
//   GET  /api/item-prices?t=<TOKEN>            → every item with all sources + cheapest flagged
//   GET  /api/item-prices?t=<TOKEN>&item=ghee  → one item
//
// Token-gated (OTP_INGEST_TOKEN, falls back to DASHBOARD_KEY). Prices in paise.
// ═══════════════════════════════════════════════════════════════════════════

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const toPaise = (v) => (v || v === 0) ? Math.round(Number(v) * 100) : null;

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
      const source = norm(body.source);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!source) return json({ error: 'source required' }, 400);
      let saved = 0;
      for (const it of items) {
        const key = norm(it.item_key || it.query);
        if (!key) continue;
        const c = it.cheapest || {};
        await db.prepare(
          `INSERT INTO item_prices (item_key, source, query, matched_name, brand, pack, unit,
             price_paise, unit_price_paise, image, url, options_json, match_count, scraped_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(item_key, source) DO UPDATE SET query=excluded.query, matched_name=excluded.matched_name,
             brand=excluded.brand, pack=excluded.pack, unit=excluded.unit, price_paise=excluded.price_paise,
             unit_price_paise=excluded.unit_price_paise, image=excluded.image, url=excluded.url,
             options_json=excluded.options_json, match_count=excluded.match_count, scraped_at=excluded.scraped_at`
        ).bind(
          key, source, it.query || key, c.name || null, c.brand || null, c.pack || null, c.unit || null,
          toPaise(c.price), toPaise(c.unit_price != null ? c.unit_price : c.price),
          c.image || null, c.url || null, JSON.stringify(it.options || []), it.match_count || 0, nowIso
        ).run();
        saved++;
      }
      return json({ ok: true, source, saved });
    }

    if (request.method === 'GET') {
      const item = url.searchParams.get('item');
      const where = item ? `WHERE item_key = ?` : '';
      const binds = item ? [norm(item)] : [];
      const rows = await db.prepare(
        `SELECT item_key, source, query, matched_name, brand, pack, unit, price_paise,
                unit_price_paise, image, url, match_count, scraped_at
           FROM item_prices ${where} ORDER BY item_key, unit_price_paise`
      ).bind(...binds).all();
      // group by item, flag the cheapest source by per-unit price
      const byItem = new Map();
      for (const r of (rows?.results || [])) {
        if (!byItem.has(r.item_key)) byItem.set(r.item_key, []);
        byItem.get(r.item_key).push(r);
      }
      const items = [...byItem.entries()].map(([key, srcs]) => {
        const ranked = srcs.slice().sort((a, b) =>
          (a.unit_price_paise ?? a.price_paise ?? 1e15) - (b.unit_price_paise ?? b.price_paise ?? 1e15));
        const cheapest = ranked[0] || null;
        return {
          item_key: key,
          cheapest_source: cheapest ? cheapest.source : null,
          sources: ranked.map((s) => ({ ...s, is_cheapest: cheapest && s.source === cheapest.source })),
        };
      });
      return json({ ok: true, count: items.length, items });
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}
