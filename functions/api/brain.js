// /api/brain — direct test harness for the ops brain (PIN-gated, owner only).
//
// Lets us validate the brain's ACCURACY from a browser or curl BEFORE the
// glasses arrive — no WhatsApp, no glasses needed. The live glasses path reuses
// answerBrainQuery() from comms-webhook.js, so whatever answers correctly here
// answers correctly in your ear.
//
//   GET  /api/brain?pin=0305&q=how%20much%20did%20HE%20bank%20today
//   POST /api/brain?pin=0305     body: { "q": "any overdue bills?" }
//
import { answerBrainQuery } from './_lib/brain.js';

const OWNER_PINS = new Set(['0305', '5882']); // Nihaf admin only

function json(d, status = 200) {
  return new Response(JSON.stringify(d, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const url = new URL(request.url);
  const pin = url.searchParams.get('pin') || '';
  if (!OWNER_PINS.has(pin)) return json({ ok: false, error: 'auth_required' }, 401);

  // ?action=whoami — reveal the Sparksol line's own number (the "Hukm" contact).
  // The creds live only as deployed secrets, so this is the one place that can ask.
  if (url.searchParams.get('action') === 'whoami') {
    const phoneId = env.WA_SPARKSOL_PHONE_ID;
    const token   = env.WA_SPARKSOL_TOKEN || env.WA_COMMS_TOKEN || env.WA_ACCESS_TOKEN;
    if (!phoneId || !token) return json({ ok: false, error: 'sparksol creds missing' }, 500);
    const r = await fetch(`https://graph.facebook.com/v24.0/${phoneId}?fields=display_phone_number,verified_name`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return json({ ok: r.ok, sparksol: await r.json().catch(() => null) }, r.ok ? 200 : 502);
  }

  let question = url.searchParams.get('q') || '';
  if (!question && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    question = body.q || body.question || '';
  }
  if (!question) return json({ ok: false, error: 'q_required' }, 400);

  const originBase = `${url.protocol}//${url.host}`;
  const t0 = Date.now();
  try {
    const answer = await answerBrainQuery(env, { question, originBase });
    return json({ ok: true, question, answer, ms: Date.now() - t0 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), ms: Date.now() - t0 });
  }
}
