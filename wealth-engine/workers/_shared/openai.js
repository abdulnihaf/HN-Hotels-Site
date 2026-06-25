// ═══════════════════════════════════════════════════════════════════════════
// OpenAI helper — JSON-mode fallback for the wealth LLM path.
//
// Fires when ALL Anthropic tiers fail (bad/expired key, overload, malformed JSON).
// Mirrors the callClaude(...) return contract exactly so wealth-verdict's tier
// loop can treat it as just another tier:
//   returns { text, usage, cost_paise, cached, model_id }
//
// Key precedence: WEALTH_OPENAI_API_KEY (dedicated, cost-segregated) → OPENAI_API_KEY.
// Cost + provider are logged to the same anthropic_usage table (model id + a
// "provider=openai" note distinguish it), so per-provider spend attribution stays
// in one place for clean cost tracking.
//
// Pricing (per MTok): gpt-4.1 = $2 in / $8 out. USD→INR 84.
// ═══════════════════════════════════════════════════════════════════════════

import { logUsage } from './anthropic.js';

const OPENAI_MODELS = {
  'gpt-4.1': { id: 'gpt-4.1', in_usd: 2.0, out_usd: 8.0 },
};
const USD_INR = 84;
const PAISE_PER_DOLLAR = USD_INR * 100;

export async function callOpenAI(env, opts = {}) {
  const {
    prompt,
    system = null,
    max_tokens = 4000,
    purpose = 'unknown',
    worker = 'unknown',
    model = 'gpt-4.1',
    db = env.WEALTH_DB || env.DB,
  } = opts;

  if (!prompt) throw new Error('prompt is required');
  const apiKey = env.WEALTH_OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY secret not set');

  const m = OPENAI_MODELS[model] || OPENAI_MODELS['gpt-4.1'];
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: m.id,
      max_tokens,
      messages,
      // The wealth prompts already instruct "Output STRICT JSON" — json_object
      // guarantees the response parses, matching the Anthropic tiers' contract.
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  });

  const j = await r.json();

  if (j.error) {
    await logUsage(db, {
      worker, purpose, modelId: m.id, usage: { input_tokens: 0, output_tokens: 0 },
      costPaise: 0, costUsdX1000: 0, requestId: 'error', cached: false,
      notes: `provider=openai ${j.error.type || ''}: ${(j.error.message || '').slice(0, 180)}`,
    });
    throw new Error(`OpenAI ${j.error.type || 'error'}: ${j.error.message || 'unknown'}`);
  }

  const text = j.choices?.[0]?.message?.content || '';
  const inputTokens = j.usage?.prompt_tokens || 0;
  const outputTokens = j.usage?.completion_tokens || 0;
  const costUsd = (inputTokens / 1e6) * m.in_usd + (outputTokens / 1e6) * m.out_usd;
  const costPaise = Math.round(costUsd * PAISE_PER_DOLLAR);

  await logUsage(db, {
    worker, purpose, modelId: m.id,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    costPaise, costUsdX1000: Math.round(costUsd * 1000),
    requestId: j.id || '', cached: false,
    notes: 'provider=openai',
  });

  return { text, usage: j.usage, cost_paise: costPaise, cached: false, model_id: m.id };
}
