// HN Purchase Daily Scout Cron
// Runs at 09:00 IST daily. Loops materials in scope, POSTs refresh-material
// per material so each material × portal lands in daily_price_snapshots.
// Worker-pool internal concurrency (default 2) so the full 76-material pass
// completes inside CF's 15-min scheduled-event budget.

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

  // /trigger?key=<DEFAULT_PIN> manually fires the loop. Uses ctx.waitUntil so
  // the fetch handler returns immediately and the loop runs in the background,
  // matching the scheduled() lifecycle (CF's fetch wall-clock is stricter than
  // waitUntil's, which inherits scheduled-event budgets).
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger' && url.searchParams.get('key') === env.DEFAULT_PIN) {
      const startedAt = new Date();
      ctx.waitUntil((async () => {
        try {
          const summary = await runDailyScout(env);
          console.log(`[scout-cron:manual] done after ${(Date.now() - startedAt.getTime()) / 1000}s`, JSON.stringify(summary));
        } catch (err) {
          console.error(`[scout-cron:manual] FATAL: ${err.message}`, err.stack);
        }
      })());
      return new Response(JSON.stringify({
        ok: true,
        status: 'STARTED',
        started_at: startedAt.toISOString(),
        scope: env.DEFAULT_SCOPE || 'ALL',
        concurrency: Math.max(1, Math.min(4, Number(env.DEFAULT_CONCURRENCY || 2))),
        sources: (env.DEFAULT_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean),
        note: 'Running in background via ctx.waitUntil. Poll /api/purchase-control?action=daily-snapshot to see rows land.',
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('hn-purchase-daily-scout-cron — scheduled 03:30 UTC / 09:00 IST. /trigger?key=<PIN> for manual fire.', { status: 200 });
  },
};

async function runDailyScout(env) {
  const base = env.HN_API_BASE;
  const pin = env.DEFAULT_PIN;
  const scope = env.DEFAULT_SCOPE || '';
  const sources = (env.DEFAULT_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const concurrency = Math.max(1, Math.min(4, Number(env.DEFAULT_CONCURRENCY || 2)));
  const cap = Number(env.MAX_MATERIALS || 300);
  // Mirror the BuyList UI's 1095d window so the morning scout covers the
  // same materials universe the owner browses.
  const matsDays = Math.max(30, Math.min(1095, Number(env.MATERIALS_DAYS || 1095)));

  console.log(`[scout-cron] scope='${scope || 'ALL'}' sources=${sources.join(',')} concurrency=${concurrency} cap=${cap} days=${matsDays}`);

  const matsRes = await fetch(`${base}/api/purchase-control?action=materials&pin=${encodeURIComponent(pin)}&brand=BOTH&days=${matsDays}`);
  if (!matsRes.ok) throw new Error(`materials fetch ${matsRes.status}`);
  const matsData = await matsRes.json();
  const allItems = matsData.items || [];
  const items = allItems
    .filter((i) => !scope || i.category === scope)
    .filter((i) => (i.product_code || i.item_id || '').toString().replace(/^code:/, ''))
    .slice(0, cap);
  console.log(`[scout-cron] ${items.length} materials in scope (of ${allItems.length} total)`);

  let okMaterials = 0;
  let partialMaterials = 0;
  let failedMaterials = 0;
  const recentFailures = [];
  let nextIndex = 0;

  async function refreshOne(item) {
    const materialId = (item.product_code || item.item_id || '').toString().replace(/^code:/, '');
    if (!materialId) return;
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
  }

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      await refreshOne(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const summary = {
    scope: scope || 'ALL',
    sources,
    concurrency,
    materials_in_scope: items.length,
    ok_materials: okMaterials,
    partial_materials: partialMaterials,
    failed_materials: failedMaterials,
    recent_failures: recentFailures.slice(-MAX_INFLIGHT_LOG_TAIL),
  };
  console.log(`[scout-cron] summary: ok=${okMaterials} partial=${partialMaterials} failed=${failedMaterials} of ${items.length}`);
  return summary;
}
