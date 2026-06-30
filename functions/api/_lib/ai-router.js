/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * NIHAF AI MODEL ROUTER  —  /api/_lib/ai-router.js   (L3 of NIHAF-AGENT-SPINE.md)
 *
 * The ENFORCED single choke point for every LLM call in the Nihaf Agent
 * platform. Same rule as comms-core.js is for messaging: NEVER call Anthropic /
 * OpenAI / Moonshot(Kimi) / Gemini from anywhere except this module.
 *
 *   selfTest(env) — auth-check every provider key. Free: it lists models, it does
 *                   NOT spend tokens or credit. Proves a key is valid, not a guess.
 *   think(env,o)  — the router. Rules-first (the caller only calls this when
 *                   deterministic rules can't decide). Per-tier priority chain +
 *                   fallback + cost cap (paise) + spend log to D1.
 *
 * Secrets (Pages production): ANTHROPIC_API_KEY · OPENAI_API_KEY ·
 *   MOONSHOT_API_KEY · GEMINI_API_KEY.  No build step — plain ES module, fetch only.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const USD_INR = 88; // cost-cap/display FX; refine with a live feed later.

// env var name per provider
const KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  moonshot:  'MOONSHOT_API_KEY',
  gemini:    'GEMINI_API_KEY',
};

// model id + USD price per 1M tokens (in/out), by provider × tier.
// Tiers: classify (cheap, high-volume) · summarize (mid) · judge (rare, hard).
// Anthropic + Moonshot ids are verified; OpenAI/Gemini ids are config — confirm
// current strings at the provider's pricing page and edit here (no code change).
const MODELS = {
  anthropic: {
    classify:  { id: 'claude-haiku-4-5',  in: 1.0,  out: 5.0  },
    summarize: { id: 'claude-sonnet-4-6', in: 3.0,  out: 15.0 },
    judge:     { id: 'claude-opus-4-8',   in: 5.0,  out: 25.0 },
  },
  moonshot: {
    classify:  { id: 'kimi-k2.7-code', in: 0.95, out: 4.0 },
    summarize: { id: 'kimi-k2.7-code', in: 0.95, out: 4.0 },
    judge:     { id: 'kimi-k2.7-code', in: 0.95, out: 4.0 },
  },
  openai: {
    classify:  { id: 'gpt-4o-mini', in: 0.15, out: 0.6  },
    summarize: { id: 'gpt-4o-mini', in: 0.15, out: 0.6  },
    judge:     { id: 'gpt-4o',      in: 2.5,  out: 10.0 },
  },
  gemini: {
    classify:  { id: 'gemini-2.0-flash', in: 0.10, out: 0.40 },
    summarize: { id: 'gemini-2.0-flash', in: 0.10, out: 0.40 },
    judge:     { id: 'gemini-2.0-pro',   in: 1.25, out: 5.0  },
  },
};

// priority order per tier; the router falls to the next provider on any failure.
const CHAINS = {
  classify:  ['anthropic', 'gemini', 'moonshot', 'openai'],
  summarize: ['anthropic', 'moonshot', 'gemini', 'openai'],
  judge:     ['anthropic', 'openai', 'moonshot'],
};

const estTokens = (s) => Math.ceil((s || '').length / 4);
const costPaise = (m, tin, tout) =>
  Math.round(((tin / 1e6) * m.in + (tout / 1e6) * m.out) * USD_INR * 100);

// ─── auth check (FREE — lists models, spends no tokens / no credit) ──────────
async function ping(env, provider) {
  const key = env[KEYS[provider]];
  if (!key) return { provider, status: 'not_configured', detail: `${KEYS[provider]} unset` };
  const t0 = Date.now();
  try {
    let res;
    if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models',
        { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    } else if (provider === 'gemini') {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    } else { // openai-compatible: openai + moonshot
      const base = provider === 'moonshot' ? 'https://api.moonshot.ai/v1' : 'https://api.openai.com/v1';
      res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
    }
    const ms = Date.now() - t0;
    if (res.ok) return { provider, status: 'authenticated', http: res.status, latency_ms: ms };
    const body = (await res.text()).slice(0, 200);
    const status = (res.status === 401 || res.status === 403) ? 'bad_key'
                 : (res.status === 429) ? 'rate_limited_or_no_credit' : 'error';
    return { provider, status, http: res.status, detail: body, latency_ms: ms };
  } catch (e) {
    return { provider, status: 'error', detail: String(e.message || e), latency_ms: Date.now() - t0 };
  }
}

export async function selfTest(env) {
  const providers = ['anthropic', 'openai', 'moonshot', 'gemini'];
  const results = await Promise.all(providers.map((p) => ping(env, p)));
  const live = results.filter((r) => r.status === 'authenticated').map((r) => r.provider);
  return { live, results, checked_at: new Date().toISOString() };
}

// ─── one chat completion against a single provider/tier ─────────────────────
async function complete(env, provider, tier, { system, user, maxOut = 512 }) {
  const key = env[KEYS[provider]];
  if (!key) throw new Error(`${KEYS[provider]} unset`);
  const m = MODELS[provider][tier];

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: m.id, max_tokens: maxOut, system: system || undefined,
        messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j = await res.json();
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, model: m.id, tin: j.usage?.input_tokens, tout: j.usage?.output_tokens };
  }

  if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxOut },
        }) });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j = await res.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('');
    return { text, model: m.id, tin: j.usageMetadata?.promptTokenCount, tout: j.usageMetadata?.candidatesTokenCount };
  }

  // openai-compatible: openai + moonshot
  const base = provider === 'moonshot' ? 'https://api.moonshot.ai/v1' : 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: m.id, max_tokens: maxOut,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content || '', model: m.id,
    tin: j.usage?.prompt_tokens, tout: j.usage?.completion_tokens };
}

function safeJson(t) {
  try { return JSON.parse(String(t).trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()); }
  catch { return { _unparsed: t }; }
}

async function logSpend(env, row) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_spend_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, model TEXT, tier TEXT, agent TEXT,
      tokens_in INTEGER, tokens_out INTEGER, cost_paise INTEGER,
      at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await env.DB.prepare(
      `INSERT INTO ai_spend_log (provider, model, tier, agent, tokens_in, tokens_out, cost_paise)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.provider, row.model, row.tier, row.agent || null, row.tokens_in, row.tokens_out, row.cost_paise).run();
  } catch (_) { /* logging must never break a call */ }
}

// ─── the router: rules-first caller → tier chain + fallback + cost cap + log ─
export async function think(env, { tier = 'classify', system, input, schema, agent,
                                   max_cost_paise = 500, max_out = 512 } = {}) {
  const chain = CHAINS[tier] || CHAINS.classify;
  const user = schema
    ? `${input}\n\nRespond with ONLY valid minified JSON matching this shape (no prose, no code fence):\n${JSON.stringify(schema)}`
    : input;
  const tin = estTokens((system || '') + user);
  const attempts = [];

  for (const provider of chain) {
    if (!env[KEYS[provider]]) { attempts.push({ provider, skip: 'not_configured' }); continue; }
    const m = MODELS[provider][tier];
    const est = costPaise(m, tin, max_out);
    if (est > max_cost_paise) { attempts.push({ provider, skip: `est ₹${(est / 100).toFixed(2)} over cap` }); continue; }
    try {
      const r = await complete(env, provider, tier, { system, user, maxOut: max_out });
      const value = schema ? safeJson(r.text) : r.text;
      const spent = costPaise(m, r.tin || tin, r.tout || estTokens(r.text));
      await logSpend(env, { provider, model: r.model, tier, agent, tokens_in: r.tin || tin, tokens_out: r.tout || estTokens(r.text), cost_paise: spent });
      return { ok: true, provider, model: r.model, value, cost_paise: spent, attempts };
    } catch (e) {
      attempts.push({ provider, error: String(e.message || e) });
    }
  }
  // whole chain failed → an owner-threshold / system-gap signal for the heartbeat.
  return { ok: false, error: 'all_providers_failed', attempts };
}
