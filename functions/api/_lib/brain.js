// ─────────────────────────────────────────────────────────────────────────
// THE BRAIN — Nihaf's hands-free ops intelligence.
//
// A question arrives (typed from his phone, or dictated through the Ray-Ban
// Meta glasses). The brain reads his LIVE business state through a whitelist
// of read-only ops endpoints, asks Claude to analyse it, and returns ONE
// short spoken-style answer that gets read aloud in his ear.
//
// Design principles (Nihaf's stated ranking: ACCURACY first, then speed):
//   - Never guess a number. Claude fetches the exact source it needs via
//     tool-use, then answers from real data.
//   - Read-only by construction. The brain physically cannot write — every
//     source is a GET, auth (PIN / service key) is injected server-side, and
//     there is no write tool. A bug here can never mutate the business.
//   - Channel-independent. The SAME brain answers WhatsApp text today and a
//     voice call later — only the mouth changes, never the thinking.
//   - Every source desc states UNITS and FRESHNESS traps. This stack mixes
//     paise and rupees endpoint-by-endpoint; the desc is the contract.
//     (Lesson of 2026-06-11: may-execution's "today" was a cumulative window
//     — verify a source's raw payload before whitelisting it.)
// ─────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-4-8';   // accuracy-first; override via env.BRAIN_MODEL (was claude-fable-5, deprecated 2026-06)
const SERVICE_PIN   = '0305';              // Nihaf admin — the brain reads as the owner
const MAX_TOOL_HOPS = 4;

// IST today (YYYY-MM-DD). IST = UTC+5:30.
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Whitelisted read-only data sources — the brain's coordinate space across the
// chambers (Sales, Money, Sauda, Anbar, Takht, Darbar, Naam). Claude picks
// `source`; we build the URL and inject auth server-side. No write path exists.
//   path     → internal endpoint on this Pages project (service PIN injected)
//   url      → external endpoint (absolute; no PIN sent off-project)
//   live     → sales-insights-style feed: from/to expanded to full IST days
//              (without explicit from/to these feeds serve a rolling last-24h
//              window that READS as "today" but is not — always pin them)
//   service  → send x-service-key (CAMS_AUTH_TOKEN) — Darbar internal-caller auth
//   period   → takes ?period= (7d/28d style) instead of from/to dates
const SOURCES = {
  // ── Sales (reconciled + live) ──
  sales_overview: { path: '/api/sales', action: 'overview', desc: 'RECONCILED sales KPIs — gross sales (banked), cash/UPI/card split, order count, UPI discrepancy — for a date range, per brand (HE/NCH/ALL). Money in PAISE. Syncs after the day; if awaiting_sync, use he_live/nch_live for the live number.' },
  sales_daily:    { path: '/api/sales', action: 'daily', desc: 'Day-by-day reconciled sales rows for a brand. Money in PAISE.' },
  he_live:        { url: 'https://hamzaexpress.in/api/sales-insights', live: true, desc: 'LIVE intraday Hamza Express sales straight from the POS — revenue, orders, hourly curve, top products for a from/to window. HE ONLY. Values in RUPEES (not paise). Freshest HE number.' },
  nch_live:       { url: 'https://nawabichaihouse.com/api/sales-insights', live: true, desc: 'LIVE intraday Nawabi Chai House sales straight from the POS — same shape as he_live. NCH ONLY. Values in RUPEES (not paise). Freshest NCH number.' },

  // ── Money / finance ──
  money_cockpit:  { path: '/api/money', action: 'cockpit', desc: 'Finance: pending + overdue vendor bills, open purchase orders, cash paid, orphans, duplicate-payment alerts. Money in PAISE.' },
  owner_overview: { path: '/api/owner-dashboard', action: 'overview', desc: 'Owner summary: spend by category, POs, bills, totals split by brand. Money in PAISE.' },
  open_findings:  { path: '/api/agents', action: 'findings', desc: 'Open agent findings — money/ops risks flagged but not yet resolved.' },

  // ── Sauda (purchases & vendor payments) ──
  sauda_pay_queue:       { path: '/api/sauda-flow', action: 'pay-queue', desc: 'Sauda purchase ring: payment requests RAISED and waiting for the owner to pay, plus recently PAID — per vendor. Money in PAISE. Empty arrays = nothing waiting.' },
  sauda_vendor_balances: { path: '/api/sauda-flow', action: 'vendor-balances', desc: 'Sauda vendor khata balances — what is outstanding per vendor on rolling/periodic khata. Money in PAISE. Empty list = no khata outstanding.' },
  sauda_pay_pending:     { path: '/api/sauda-pay', action: 'pending', desc: 'Layer-1 NCH vendor payment requests pending (buns, water, cutlets, samosa…). Amounts in RUPEES (different from sauda-flow!). Empty = nothing pending.' },

  // ── Anbar (inventory room) ──
  anbar_live:     { path: '/api/anbar', action: 'live', desc: 'Anbar inventory conservation state per item per location (NCH layer-1 unit-countable items): last_count + received + issued − sold(from POS) − waste = EXPECTED stock now, with count timestamps. Quantities in PIECES, not money. expected vs a fresh count = discrepancy worth naming.' },
  anbar_expected: { path: '/api/anbar', action: 'expected', desc: "Anbar: today's expected vendor deliveries (PO lines) with status. CHECK the status field — cancelled rows are noise, only ordered/pending rows are real expectations." },

  // ── Darbar (staff / HR) ──
  darbar_today:   { path: '/api/darbar', action: 'home', service: true, desc: 'Darbar staff board for the current business day (closes 4am IST): expected/present/in-progress/missing-punch/absent counts + exception inbox (departed staff with days silent, ghost PINs, chronic missed punches) with names, brands, monthly salary and daily rate in RUPEES.' },

  // ── Takht (NCH counter settlement) ──
  takht_counter:  { url: 'https://nawabichaihouse.com/api/settlement', action: 'counter-balance', desc: 'Takht: NCH cash position at the counter SINCE THE LAST OWNER COLLECTION (read the "since" timestamp — it is NOT a calendar day): counter cash, petty cash, runner cash, expenses paid from the drawer. Values in RUPEES.' },
  takht_tokens:   { url: 'https://nawabichaihouse.com/api/token-settlement', action: 'get-status', desc: 'Takht beverage-token reconciliation: LAST settlement (check settled_at — may be days old) weighing physical tokens vs Odoo POS beverage sales; token_count vs odoo_total_beverages gap = leakage signal.' },

  // ── Naam (marketing) ──
  meta_ads:       { path: '/api/meta-ads', period: true, desc: 'Naam: Meta/Instagram ads — spend, clicks, impressions, CTR, CPC per campaign for a period (default 7d). Spend in RUPEES. NEVER report platform conversion numbers — broken by doctrine; impact is judged by POS-spike correlation.' },
  google_ads:     { path: '/api/google-ads-live', period: true, desc: 'Naam: Google Ads — spend/clicks/impressions per campaign for a period. Spend in RUPEES. Conversions omitted by doctrine.' },
  gbp:            { path: '/api/gbp-cockpit', period: true, desc: 'Naam: Google Business Profile for ONE brand (pass brand HE or NCH) — rating, reviews, search keywords, calls/directions. Performance data lags ~2 days (stated in payload freshness).' },
};

function buildUrl(originBase, source, { from, to, brand, period }) {
  const s = SOURCES[source];
  if (s.url) {
    const u = new URL(s.url);
    if (s.action) u.searchParams.set('action', s.action);
    if (s.live) {
      // Live POS feeds serve a rolling last-24h window unless pinned. Always pin.
      u.searchParams.set('from', `${from}T00:00:00`);
      u.searchParams.set('to', `${to}T23:59:59`);
    }
    return u.toString();   // external project — never send the PIN off-origin
  }
  const u = new URL(originBase + s.path);
  if (s.action) u.searchParams.set('action', s.action);
  if (s.period) {
    u.searchParams.set('period', period || '7d');
    if (brand) u.searchParams.set('brand', brand);
    u.searchParams.set('pin', SERVICE_PIN);
    return u.toString();
  }
  if (from)  u.searchParams.set('from', from);
  if (to)    u.searchParams.set('to', to);
  if (brand) u.searchParams.set('brand', brand);
  if (source === 'open_findings') u.searchParams.set('open', '1');
  if (source === 'money_cockpit' && !brand) u.searchParams.set('brand', 'ALL');
  u.searchParams.set('pin', SERVICE_PIN);
  return u.toString();
}

const TOOLS = [{
  name: 'read_ops_data',
  description:
    'Read live HN Hotels business data (READ-ONLY). Choose the source that answers the question; call several sources in parallel when the question spans domains. ' +
    'Dates are IST YYYY-MM-DD; omit them to mean today. Brand is HE, NCH, or ALL. period (ads/gbp only) like 7d or 28d.\n' +
    Object.entries(SOURCES).map(([k, v]) => `- ${k}: ${v.desc}`).join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: Object.keys(SOURCES) },
      from:   { type: 'string', description: 'IST start date YYYY-MM-DD (optional, defaults to today)' },
      to:     { type: 'string', description: 'IST end date YYYY-MM-DD (optional, defaults to today)' },
      brand:  { type: 'string', enum: ['HE', 'NCH', 'ALL'], description: 'optional' },
      period: { type: 'string', description: 'ads/gbp sources only: 7d (default) or 28d' },
    },
    required: ['source'],
  },
}];

async function runTool(env, originBase, input) {
  const today = istToday();
  const from = input.from || today;
  const to   = input.to   || today;
  const s    = SOURCES[input.source] || {};
  const url  = buildUrl(originBase, input.source, { from, to, brand: input.brand, period: input.period });
  const headers = { 'X-Ops-Pin': SERVICE_PIN };
  if (s.service && env.CAMS_AUTH_TOKEN) headers['x-service-key'] = env.CAMS_AUTH_TOKEN;
  try {
    const r = await fetch(url, { headers });
    const txt = await r.text();
    // Cap payload so a large cockpit dump can't blow the token budget.
    return txt.length > 12000 ? txt.slice(0, 12000) + '…[truncated]' : txt;
  } catch (e) {
    return JSON.stringify({ error: String(e.message || e), source: input.source });
  }
}

function systemPrompt() {
  const today = istToday();
  return [
    `You are Hukm, Nihaf's private operations brain for HN Hotels Private Limited.`,
    `HN runs two Bangalore outlets: Hamza Express (HE — QSR biryani/kabab) and Nawabi Chai House (NCH — Irani chai cafe). Today, IST, is ${today}.`,
    ``,
    `His chambers — the vocabulary he will use out loud:`,
    `- Sauda = purchases, vendor orders, vendor payments. Anbar = the inventory room. Takht = the NCH counter settlement system. Darbar = staff, attendance, pay. Naam = marketing.`,
    ``,
    `Nihaf asks you questions OUT LOUD through smart glasses and HEARS your reply read aloud. So:`,
    `- Answer in 1–3 short, spoken sentences. No markdown, no bullets, no tables, no rupee symbols.`,
    `- Speak numbers the way a person would: "about 1.2 lakhs", "roughly ninety-four thousand", "twelve bills overdue". Never read out long digit strings.`,
    `- Lead with the answer. Add at most one sentence of insight, and only if it genuinely matters.`,
    ``,
    `ACCURACY IS YOUR FIRST DUTY:`,
    `- Never guess a figure. Call read_ops_data and answer from the real number. Fan out to several sources in ONE round when the question spans domains.`,
    `- UNITS VARY BY SOURCE — each source description states paise or rupees. Convert paise to rupees before speaking. Never mix them up.`,
    `- If a source reports awaiting_sync or returns nothing for today, say the number isn't synced yet rather than reporting zero as fact — for sales, fall back to the live POS feeds.`,
    `- Monthly revenue TARGETS exist only for May 2026. For any other month, give real numbers and say plainly no target is configured.`,
    `- If the data you need isn't reachable from your tools, say so plainly in one sentence. Do not invent it.`,
    ``,
    `DOMAIN RULES (Nihaf's locked rules — never violate):`,
    `- Darbar: presence pays the full day — any punch means the day is paid; odd punches on a closed day are "punch missing", still paid, just say so. NEVER compute or speak a net amount owed to a person — give the separate facts (days present, rate, advances) and let Nihaf do the final math himself.`,
    `- Naam: platform conversion numbers are broken — never report conversions as fact; speak spend, clicks, reach, and judge impact by sales correlation.`,
    `- Anbar: "expected" is what stock SHOULD be by the conservation law; a gap against a fresh count is a discrepancy — name the item and the gap.`,
    `- Takht: counter cash accumulates since the last owner collection, not per calendar day — anchor any cash figure to that window.`,
  ].join('\n');
}

async function callAnthropic(env, body) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errTxt = await r.text();
    throw new Error(`anthropic ${r.status}: ${errTxt.slice(0, 300)}`);
  }
  return r.json();
}

// Answer one question. Returns a short spoken-style string.
export async function answerBrainQuery(env, { question, originBase }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const model   = env.BRAIN_MODEL || DEFAULT_MODEL;
  const system  = systemPrompt();
  const messages = [{ role: 'user', content: question }];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const resp = await callAnthropic(env, { model, max_tokens: 600, system, tools: TOOLS, messages });

    if (resp.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: resp.content });
      // Run all requested lookups concurrently — speed costs nothing here.
      const toolBlocks = resp.content.filter(b => b.type === 'tool_use');
      const outputs = await Promise.all(toolBlocks.map(b => runTool(env, originBase, b.input || {})));
      messages.push({
        role: 'user',
        content: toolBlocks.map((b, i) => ({ type: 'tool_result', tool_use_id: b.id, content: outputs[i] })),
      });
      continue;
    }

    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    return text || 'I could not produce an answer.';
  }
  return 'That needed too many lookups — try asking it more specifically.';
}
