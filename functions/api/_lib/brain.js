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
//     source is a GET, the service PIN is injected server-side, and there is no
//     write tool. A bug here can never mutate the business.
//   - Channel-independent. The SAME brain answers WhatsApp text today and a
//     voice call later — only the mouth changes, never the thinking.
// ─────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-fable-5';    // accuracy-first; override via env.BRAIN_MODEL
const SERVICE_PIN   = '0305';              // Nihaf admin — the brain reads as the owner
const MAX_TOOL_HOPS = 4;

// IST today (YYYY-MM-DD). IST = UTC+5:30.
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Whitelisted read-only data sources. Claude picks `source`; we build the URL
// and inject the service PIN server-side. There is deliberately no write path.
const SOURCES = {
  sales_overview: { path: '/api/sales',           action: 'overview', desc: 'Sales KPIs — gross sales (banked), cash/UPI/card split, order count, UPI discrepancy — for a date range, per brand. Money in paise.' },
  sales_daily:    { path: '/api/sales',           action: 'daily',    desc: 'Day-by-day sales reconciliation rows for a brand.' },
  money_cockpit:  { path: '/api/money',           action: 'cockpit',  desc: 'Finance: pending + overdue vendor bills, open purchase orders, cash paid, orphans, duplicate-payment alerts. Money in paise.' },
  owner_overview: { path: '/api/owner-dashboard', action: 'overview', desc: 'Owner summary: spend by category, POs, bills, totals split by brand.' },
  he_live:        { url: 'https://hamzaexpress.in/api/sales-insights', action: null, desc: 'LIVE intraday Hamza Express sales straight from the POS — revenue, order count, hourly curve, top products for a from/to window. HE ONLY. Values in RUPEES (not paise). Freshest HE number; the reconciled sales_overview syncs later.' },
  open_findings:  { path: '/api/agents',          action: 'findings', desc: 'Open agent findings — money/ops risks that were flagged but not yet resolved.' },
};

function buildUrl(originBase, source, { from, to, brand }) {
  const s = SOURCES[source];
  if (s.url) {
    // External live feed (public, no PIN). Takes full datetimes; we expand the
    // brain's IST dates to whole calendar days. Without from/to it serves a
    // rolling last-24h window — which reads as "today" but isn't. Always pin it.
    const u = new URL(s.url);
    u.searchParams.set('from', `${from}T00:00:00`);
    u.searchParams.set('to', `${to}T23:59:59`);
    return u.toString();
  }
  const u = new URL(originBase + s.path);
  if (s.action) u.searchParams.set('action', s.action);
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
    'Read live HN Hotels business data (READ-ONLY). Choose the source that answers the question. ' +
    'Dates are IST YYYY-MM-DD; omit them to mean today. Brand is HE, NCH, or ALL.\n' +
    Object.entries(SOURCES).map(([k, v]) => `- ${k}: ${v.desc}`).join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: Object.keys(SOURCES) },
      from:   { type: 'string', description: 'IST start date YYYY-MM-DD (optional, defaults to today)' },
      to:     { type: 'string', description: 'IST end date YYYY-MM-DD (optional, defaults to today)' },
      brand:  { type: 'string', enum: ['HE', 'NCH', 'ALL'], description: 'optional' },
    },
    required: ['source'],
  },
}];

async function runTool(originBase, input) {
  const today = istToday();
  const from = input.from || today;
  const to   = input.to   || today;
  const url  = buildUrl(originBase, input.source, { from, to, brand: input.brand });
  try {
    const r = await fetch(url, { headers: { 'X-Ops-Pin': SERVICE_PIN } });
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
    `Nihaf asks you questions OUT LOUD through smart glasses and HEARS your reply read aloud. So:`,
    `- Answer in 1–3 short, spoken sentences. No markdown, no bullets, no tables, no rupee symbols.`,
    `- Speak numbers the way a person would: "about 1.2 lakhs", "roughly ninety-four thousand", "twelve bills overdue". Never read out long digit strings.`,
    `- Lead with the answer. Add at most one sentence of insight, and only if it genuinely matters.`,
    ``,
    `ACCURACY IS YOUR FIRST DUTY:`,
    `- Never guess a figure. Call read_ops_data and answer from the real number.`,
    `- Tool money values are in PAISE (integer) unless stated otherwise — divide by 100 for rupees before speaking.`,
    `- If a source reports awaiting_sync or returns nothing for today, say the number isn't synced yet rather than reporting zero as fact.`,
    `- Monthly revenue TARGETS exist only for May 2026. If asked about pace or target for any other month, give the real sales numbers and say plainly that no target is configured for that month.`,
    `- If the data you need isn't reachable from your tools, say so plainly in one sentence. Do not invent it.`,
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
      const outputs = await Promise.all(toolBlocks.map(b => runTool(originBase, b.input || {})));
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
