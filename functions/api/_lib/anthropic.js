// ═══════════════════════════════════════════════════════════════════════════
// Anthropic Claude API helper — tier-aware (Haiku/Sonnet/Opus).
//
// Architecture (verified 2026-05-04):
//   • callHaiku(env, opts)   — extraction, classification, repetitive tasks
//   • callSonnet(env, opts)  — interpretation, multi-paragraph composition
//   • callOpus(env, opts)    — high-stakes decisions (verdict, invalidator)
//   • callClaude(env, model, opts) — generic core; the others are sugar
//
// All three share: SHA1 cache · daily spend cap · usage logging · prompt caching.
//
// Pricing (2026-05 verified — claude-{haiku|sonnet|opus}-4-5):
//   Haiku 4.5:   $1   / $5   / $0.10 cached  per MTok (in/out/cached)
//   Sonnet 4.5:  $3   / $15  / $0.30 cached
//   Opus 4.5:    $15  / $75  / $1.50 cached
//
// Daily cap: ₹100 (override via env.ANTHROPIC_DAILY_CAP_PAISE).
// USD→INR rate: 84.
// ═══════════════════════════════════════════════════════════════════════════

const MODELS = {
  haiku:  { id: 'claude-haiku-4-5',  in_usd: 1.0,  out_usd: 5.0,  cached_usd: 0.10 },
  sonnet: { id: 'claude-sonnet-4-5', in_usd: 3.0,  out_usd: 15.0, cached_usd: 0.30 },
  opus:   { id: 'claude-opus-4-5',   in_usd: 15.0, out_usd: 75.0, cached_usd: 1.50 },
};

const USD_INR = 84;
const PAISE_PER_DOLLAR = USD_INR * 100;
// Caps (2026-05-05 v4 — DURING PAPER TRADE PHASE, owner explicitly removed caps
// to ensure flow never breaks. Will optimize spend later based on real usage data).
// REAL backstop is Anthropic workspace cap on console.anthropic.com — that's
// what actually prevents runaway spend. We just log + observe here.
// Override via env.ANTHROPIC_DAILY_CAP_PAISE / env.ANTHROPIC_MONTHLY_CAP_PAISE.
const DEFAULT_DAILY_CAP_PAISE   = 9999999;    // effectively no cap (₹99,999/day)
const DEFAULT_MONTHLY_CAP_PAISE = 99999999;   // effectively no cap (₹9,99,999/mo)

async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getTodaySpend(db) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT COALESCE(SUM(cost_paise), 0) AS total FROM anthropic_usage WHERE date = ?`
  ).bind(today).first();
  return r?.total || 0;
}

async function getMonthSpend(db) {
  const ym = new Date().toISOString().slice(0, 7);
  const r = await db.prepare(
    `SELECT COALESCE(SUM(cost_paise), 0) AS total FROM anthropic_usage WHERE date LIKE ?`
  ).bind(`${ym}%`).first();
  return r?.total || 0;
}

async function tryCache(db, cacheKey) {
  if (!cacheKey) return null;
  const r = await db.prepare(`
    SELECT response, input_tokens, output_tokens FROM anthropic_cache
    WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > strftime('%s','now')*1000)
  `).bind(cacheKey).first();
  if (!r) return null;
  try {
    await db.prepare(`UPDATE anthropic_cache SET hit_count = hit_count + 1 WHERE cache_key = ?`).bind(cacheKey).run();
  } catch {}
  return {
    text: JSON.parse(r.response),
    usage: { input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0 },
    cost_paise: 0,
    cached: true,
  };
}

async function storeCache(db, cacheKey, purpose, text, usage, ttlMs) {
  if (!cacheKey) return;
  const expiresAt = ttlMs ? Date.now() + ttlMs : null;
  try {
    await db.prepare(`
      INSERT OR REPLACE INTO anthropic_cache
        (cache_key, purpose, response, input_tokens, output_tokens, created_at, expires_at, hit_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(cacheKey, purpose, JSON.stringify(text), usage.input_tokens || 0, usage.output_tokens || 0, Date.now(), expiresAt).run();
  } catch (e) {
    console.warn('Cache store failed:', e.message);
  }
}

async function logUsage(db, { worker, purpose, modelId, usage, costPaise, costUsdX1000, requestId, cached, notes }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await db.prepare(`
      INSERT INTO anthropic_usage
        (ts, date, worker, purpose, model, input_tokens, output_tokens, cached_tokens, cost_paise, cost_usd_x1000, request_id, cached_response, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Date.now(), today, worker || 'unknown', purpose || 'unknown', modelId,
      usage.input_tokens || 0, usage.output_tokens || 0,
      usage.cache_read_input_tokens || 0,
      costPaise, costUsdX1000,
      requestId || '', cached ? 1 : 0, notes || null
    ).run();
  } catch (e) {
    console.warn('Usage log failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE — generic Claude call with model selection.
//
// opts = {
//   prompt, system, max_tokens, purpose, worker,
//   cache_key, cache_ttl_ms, force_call,
//   db,                                         // D1 binding
// }
// modelTier = 'haiku' | 'sonnet' | 'opus'
//
// Returns: { text, usage, cost_paise, cached, model_id }
// ═══════════════════════════════════════════════════════════════════════════
export async function callClaude(env, modelTier, opts = {}) {
  const model = MODELS[modelTier];
  if (!model) throw new Error(`unknown model tier: ${modelTier}`);

  const {
    prompt,
    system = null,
    max_tokens = 200,
    purpose = 'unknown',
    worker = 'unknown',
    cache_key: rawCacheKey = null,
    cache_ttl_ms = 7 * 86400 * 1000,
    force_call = false,
    db = env.WEALTH_DB || env.DB,
  } = opts;

  if (!prompt) throw new Error('prompt is required');
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY secret not set');

  // Cache key includes model — same prompt to Haiku vs Opus gives different output
  const cacheKey = rawCacheKey
    ? await sha1(`${model.id}|${system || ''}|${prompt}|${max_tokens}`)
    : null;

  // 1. Cache check
  if (!force_call && cacheKey) {
    const hit = await tryCache(db, cacheKey);
    if (hit) {
      await logUsage(db, {
        worker, purpose, modelId: model.id, usage: hit.usage,
        costPaise: 0, costUsdX1000: 0,
        requestId: 'cache-hit', cached: true,
      });
      return { ...hit, model_id: model.id };
    }
  }

  // 2. Spend monitoring (first month — observe-don't-throw policy).
  // We don't block calls based on caps for now. Anthropic workspace ceiling
  // ($20/mo) is the real safety net. After 2 weeks of usage data, owner
  // reviews per-layer breakdown via getSpendSummary() and tightens what's wasteful.
  // Soft alerts still fire at 50/80% so we *know* when something accelerates.
  if (!force_call && env.ANTHROPIC_HARD_CAP === '1') {
    // Opt-in hard cap (set ANTHROPIC_HARD_CAP=1 secret to enable)
    const dailyCap   = parseInt(env.ANTHROPIC_DAILY_CAP_PAISE   || DEFAULT_DAILY_CAP_PAISE);
    const monthlyCap = parseInt(env.ANTHROPIC_MONTHLY_CAP_PAISE || DEFAULT_MONTHLY_CAP_PAISE);
    const [todaySpend, monthSpend] = await Promise.all([getTodaySpend(db), getMonthSpend(db)]);
    if (monthSpend >= monthlyCap) throw new Error(`monthly-cap-reached: ₹${(monthSpend/100).toFixed(2)} / ₹${(monthlyCap/100).toFixed(0)}`);
    if (todaySpend >= dailyCap)   throw new Error(`daily-cap-reached: ₹${(todaySpend/100).toFixed(2)} / ₹${(dailyCap/100).toFixed(0)}`);
  }

  // Soft alerts DISABLED during paper-trade phase (would pollute alert stream).
  // Spend still tracked in anthropic_usage table for later review. Re-enable
  // by setting env.ANTHROPIC_SOFT_ALERTS=1 when ready to tune.
  if (!force_call && env.ANTHROPIC_SOFT_ALERTS === '1') {
    const monthlyTarget = parseInt(env.ANTHROPIC_MONTHLY_CAP_PAISE || DEFAULT_MONTHLY_CAP_PAISE);
    const monthSpend = await getMonthSpend(db);
    const monthlyPct = monthSpend / monthlyTarget;

    let alertSeverity = null;
    let alertTitle = null;
    let alertBody = null;
    if (monthlyPct >= 0.8) {
      alertSeverity = 'warn';
      alertTitle = `Anthropic month spend at ${(monthlyPct*100).toFixed(0)}% of soft target`;
      alertBody = `₹${(monthSpend/100).toFixed(2)} / ₹${(monthlyTarget/100).toFixed(0)}. Set ANTHROPIC_HARD_CAP=1 to enforce.`;
    } else if (monthlyPct >= 0.5) {
      alertSeverity = 'info';
      alertTitle = `Anthropic month spend at ${(monthlyPct*100).toFixed(0)}% of soft target`;
      alertBody = `Spent ₹${(monthSpend/100).toFixed(2)} this month. Soft target ₹${(monthlyTarget/100).toFixed(0)}.`;
    }

    if (alertSeverity) {
      // Dedupe: skip if same category fired in last 4 hours
      const recent = await db.prepare(`
        SELECT id FROM system_alerts
        WHERE category='anthropic_spend' AND ts > strftime('%s','now')*1000 - 4*3600000
        LIMIT 1
      `).first().catch(() => null);
      if (!recent) {
        try {
          await db.prepare(`
            INSERT INTO system_alerts (ts, severity, category, title, body)
            VALUES (?, ?, 'anthropic_spend', ?, ?)
          `).bind(Date.now(), alertSeverity, alertTitle, alertBody).run();
        } catch {}
      }
    }
  }

  // 3. Make the API call
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    // Opus + Sonnet are slower than Haiku — 60s headroom for verdict-quality calls
    signal: AbortSignal.timeout(modelTier === 'haiku' ? 20000 : 60000),
  });

  const j = await r.json();

  if (j.error) {
    await logUsage(db, {
      worker, purpose, modelId: model.id, usage: { input_tokens: 0, output_tokens: 0 },
      costPaise: 0, costUsdX1000: 0,
      requestId: 'error', cached: false,
      notes: `${j.error.type}: ${j.error.message?.slice(0, 200)}`,
    });
    throw new Error(`Anthropic ${j.error.type}: ${j.error.message}`);
  }

  // 4. Compute cost (model-specific pricing)
  const inputTokens = j.usage?.input_tokens || 0;
  const outputTokens = j.usage?.output_tokens || 0;
  const cachedTokens = j.usage?.cache_read_input_tokens || 0;
  const billableInput = Math.max(0, inputTokens - cachedTokens);
  const costUsd =
    (billableInput / 1e6) * model.in_usd +
    (cachedTokens / 1e6) * model.cached_usd +
    (outputTokens / 1e6) * model.out_usd;
  const costPaise = Math.round(costUsd * PAISE_PER_DOLLAR);
  const costUsdX1000 = Math.round(costUsd * 1000);

  const text = j.content?.[0]?.text || '';

  await logUsage(db, {
    worker, purpose, modelId: model.id,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: cachedTokens },
    costPaise, costUsdX1000,
    requestId: j.id || '', cached: false,
  });

  if (cacheKey) {
    await storeCache(db, cacheKey, purpose, text, j.usage || {}, cache_ttl_ms);
  }

  return { text, usage: j.usage, cost_paise: costPaise, cached: false, model_id: model.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// SUGAR WRAPPERS — tier-locked. Pick by task importance.
// ═══════════════════════════════════════════════════════════════════════════
export const callHaiku  = (env, opts) => callClaude(env, 'haiku',  opts);
export const callSonnet = (env, opts) => callClaude(env, 'sonnet', opts);
export const callOpus   = (env, opts) => callClaude(env, 'opus',   opts);

// JSON parser (handles markdown code fences)
export function parseJsonOutput(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
}

// Spend summary — for monitoring endpoint
export async function getSpendSummary(db) {
  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  const dailyByPurpose = (await db.prepare(`
    SELECT purpose, model, SUM(cost_paise) AS spent_paise, COUNT(*) AS calls,
      SUM(CASE WHEN cached_response = 1 THEN 1 ELSE 0 END) AS cache_hits
    FROM anthropic_usage WHERE date = ? GROUP BY purpose, model
  `).bind(today).all()).results || [];

  const monthly = (await db.prepare(`
    SELECT date, SUM(cost_paise) AS spent_paise, COUNT(*) AS calls
    FROM anthropic_usage WHERE date LIKE ? GROUP BY date ORDER BY date DESC LIMIT 31
  `).bind(`${ym}%`).all()).results || [];

  const cacheStats = (await db.prepare(`
    SELECT purpose, COUNT(*) AS entries, SUM(hit_count) AS total_hits
    FROM anthropic_cache GROUP BY purpose
  `).all()).results || [];

  const dailyByModel = (await db.prepare(`
    SELECT model, SUM(cost_paise) AS spent_paise, COUNT(*) AS calls
    FROM anthropic_usage WHERE date = ? GROUP BY model
  `).bind(today).all()).results || [];

  const todayTotal = dailyByPurpose.reduce((s, r) => s + (r.spent_paise || 0), 0);
  const monthTotal = monthly.reduce((s, r) => s + (r.spent_paise || 0), 0);

  return {
    today: { date: today, total_paise: todayTotal, by_purpose: dailyByPurpose, by_model: dailyByModel },
    month: { ym, total_paise: monthTotal, daily: monthly },
    cache: cacheStats,
    cap_paise_daily: DEFAULT_DAILY_CAP_PAISE,
    cap_pct_used_today: (todayTotal / DEFAULT_DAILY_CAP_PAISE * 100).toFixed(1),
  };
}
