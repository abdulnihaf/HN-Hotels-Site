/* /api/ai-router — admin diagnostic + manual tester for the Nihaf AI model router.
 * PIN-gated (admin only). Logic lives in /api/_lib/ai-router.js.
 *
 *   GET  /api/ai-router?action=selftest&pin=0305
 *        → auth-check all 4 provider keys (free, no tokens spent).
 *   GET  /api/ai-router?action=think&pin=0305&tier=classify&q=...
 *   POST /api/ai-router?action=think&pin=0305   body: {tier, system, input, schema}
 *        → run a real completion through the tier chain (spends a few tokens).
 */
import { selfTest, think } from './_lib/ai-router.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ADMIN_PINS = new Set(['0305', '5882']); // Nihaf
const json = (d, s = 200) =>
  new Response(JSON.stringify(d, null, 2), { status: s, headers: { 'content-type': 'application/json', ...CORS } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const pin = (url.searchParams.get('pin') || '').trim();
  if (!ADMIN_PINS.has(pin)) return json({ ok: false, error: 'auth_required' }, 401);

  const action = url.searchParams.get('action') || 'selftest';
  try {
    if (action === 'selftest') return json({ ok: true, ...(await selfTest(env)) });
    if (action === 'think') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const r = await think(env, {
        tier:   url.searchParams.get('tier') || body.tier || 'classify',
        system: body.system,
        input:  body.input || url.searchParams.get('q') || 'Reply with the single word: ok',
        schema: body.schema,
        agent:  'ai-router-test',
      });
      return json(r);
    }
    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: 'server_error', detail: String(e.message || e) }, 500);
  }
}
