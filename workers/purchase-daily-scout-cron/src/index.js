// HN Purchase Daily Scout Cron
// Runs at 09:00 IST daily. Loops materials in scope, POSTs refresh-material
// per material so each material × portal lands in daily_price_snapshots.
// Writes a meta row in daily_price_snapshot_batches via the API (the
// refresh-material handler creates one per material, but the cron loop
// itself doesn't need its own batch row — observability comes from the
// per-material batch rows + this worker's logs).

const MAX_INFLIGHT_LOG_TAIL = 5;

export default {
  async scheduled(event, env, ctx) {
    const startedAt = new Date();
    console.log(`[scout-cron] fired at ${startedAt.toISOString()} (event ${event.cron})`);
    try {
      await runDailyScout(env);
    } catch (err) {
      console.error(`[scout-cron] FATAL: ${err.message}`, err.stack);
    }
    console.log(`[scout-cron] done after ${(Date.now() - startedAt.getTime()) / 1000}s`);
  },

  // Allow manual triggering via GET /trigger?key=<DEFAULT_PIN> for testing.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger' && url.searchParams.get('key') === env.DEFAULT_PIN) {
      const startedAt = Date.now();
      try {
        const summary = await runDailyScout(env);
        return new Response(JSON.stringify({ ok: true, elapsed_ms: Date.now() - startedAt, ...summary }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
      }
    }
    return new Response('hn-purchase-daily-scout-cron — scheduled only', { status: 200 });
  },
};

async function runDailyScout(env) {
  const base = env.HN_API_BASE;
  const pin = env.DEFAULT_PIN;
  const scope = env.DEFAULT_SCOPE;
  const sources = (env.DEFAULT_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const stagger = Number(env.STAGGER_MS || 1000);
  const cap = Number(env.MAX_MATERIALS || 60);

  console.log(`[scout-cron] scope='${scope}' sources=${sources.join(',')} stagger=${stagger}ms cap=${cap}`);

  // Pull material universe (last 30d Odoo purchase history → known RM list).
  const matsRes = await fetch(`${base}/api/purchase-control?action=materials&pin=${encodeURIComponent(pin)}&brand=BOTH&days=30`);
  if (!matsRes.ok) throw new Error(`materials fetch ${matsRes.status}`);
  const matsData = await matsRes.json();
  const items = (matsData.items || []).filter((i) => !scope || i.category === scope).slice(0, cap);
  console.log(`[scout-cron] ${items.length} materials in scope (of ${(matsData.items || []).length} total)`);

  let okMaterials = 0;
  let partialMaterials = 0;
  let failedMaterials = 0;
  const recentFailures = [];

  for (const item of items) {
    const materialId = (item.product_code || item.item_id || '').toString().replace(/^code:/, '');
    if (!materialId) continue;
    try {
      const res = await fetch(`${base}/api/purchase-control?action=refresh-material`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, material_id: materialId, sources }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        failedMaterials += 1;
        recentFailures.push({ material_id: materialId, name: item.name, error: data.error || `HTTP ${res.status}` });
      } else {
        const c = data.counts || {};
        if (c.ok > 0 && c.error === 0) okMaterials += 1;
        else if (c.ok > 0) partialMaterials += 1;
        else failedMaterials += 1;
      }
    } catch (err) {
      failedMaterials += 1;
      recentFailures.push({ material_id: materialId, name: item.name, error: err.message });
    }
    if (stagger > 0) await new Promise((r) => setTimeout(r, stagger));
  }

  const summary = {
    scope,
    sources,
    materials_in_scope: items.length,
    ok_materials: okMaterials,
    partial_materials: partialMaterials,
    failed_materials: failedMaterials,
    recent_failures: recentFailures.slice(-MAX_INFLIGHT_LOG_TAIL),
  };
  console.log(`[scout-cron] summary: ok=${okMaterials} partial=${partialMaterials} failed=${failedMaterials} of ${items.length}`);
  return summary;
}
