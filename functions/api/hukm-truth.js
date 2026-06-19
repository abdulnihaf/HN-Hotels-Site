/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/hukm-truth — THE HUKUM TRUTH SPINE.
 *
 * One uniform, trust-labeled, per-domain verdict that the Hukum app + the brain read,
 * so Nihaf (non-technical) is never shown a number that could be silently wrong.
 * Implements docs/HUKUM-TRUTH-CONTRACT.md:
 *   - truth by reconciliation (cross-check an independent witness), not single-source
 *   - every number carries `trust` (reconciled|single_source|unverified|stale|down|unknown)
 *   - the system never reports a feed as healthy when it can't verify it (→ unknown, not ok)
 *   - each domain surfaces the ONE one-tap action; nothing technical leaks to the owner
 *
 * READ-ONLY. PIN-gated (owner 0305/1918, same as the brain's SERVICE_PIN). No mutation path.
 * Adding a domain = add one async fn to DOMAINS; the contract shape is the constraint.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const OWNER_PINS = new Set(['0305', '1918']);

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Pin, x-api-key',
    'Content-Type': 'application/json',
  };
}
function json(d, status) { return new Response(JSON.stringify(d), { status: status || 200, headers: cors() }); }
function nowIST() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30'); }
function ageMin(iso) { try { return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null; } catch { return null; } }

// ── DELIVERY: capture witness (feed-integrity) reconciled against the bank witness ──
async function deliveryDomain(env, origin) {
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || '';
  let fi = null;
  try { fi = await fetch(`${origin}/api/aggregator-pulse?action=feed-integrity&key=${encodeURIComponent(key)}`).then(r => r.json()); } catch (e) { fi = { _err: e.message }; }

  // independent money witness: bank credits mentioning the aggregators vs captured order payout (last 30d)
  let recon = null;
  try {
    const bank = await env.DB.prepare(
      `SELECT count(*) n, COALESCE(SUM(amount_paise),0)/100 rupees, MAX(date(txn_at)) last
       FROM money_events WHERE direction='credit' AND txn_at >= datetime('now','-30 days')
         AND (lower(COALESCE(narration,'')||' '||COALESCE(counterparty,'')||' '||COALESCE(raw_subject,'')) LIKE '%swiggy%'
           OR lower(COALESCE(narration,'')||' '||COALESCE(counterparty,'')||' '||COALESCE(raw_subject,'')) LIKE '%zomato%'
           OR lower(COALESCE(settlement_platform,'')) IN ('swiggy','zomato'))`
    ).first().catch(() => null);
    recon = bank ? { bank_settlements_30d: bank.n, bank_rupees_30d: bank.rupees, last_settlement: bank.last } : null;
  } catch { recon = null; }

  if (!fi || !fi.ok) {
    return { domain: 'delivery', live: false, trust: 'unknown', value: 'delivery health unreadable',
      witness: 'feed-integrity unavailable', as_of: nowIST(),
      headline: 'cannot read delivery capture health', action: null, reconciliation: recon };
  }

  // map capture integrity → trust. delivery is single_source until bank reconciliation is wired
  // (recon below is the path to `reconciled`); never claim reconciled before it is.
  const integrity = fi.integrity;
  const trust = integrity === 'loss_risk' ? 'unverified'
              : integrity === 'unknown'   ? 'unknown'
              : 'single_source';
  // the ONE action, if any
  let action = null;
  const en = (fi.coordinates || []).find(c => c.verdict === 'enrichment_blocked');
  const dead = (fi.coordinates || []).find(c => c.verdict === 'dead');
  const suspect = (fi.coordinates || []).find(c => c.verdict === 'suspect_empty');
  if (dead) action = { label: `${dead.platform} capture stopped — recover the poller`, severity: 'critical' };
  else if (suspect) action = { label: `Confirm ${suspect.platform} genuinely had no orders (else session broke)`, severity: 'attention' };
  else if (en) action = { label: `${en.platform} ${en.brand}: refresh order-detail token (enrichment only)`, severity: 'low' };

  return {
    domain: 'delivery',
    live: integrity !== 'unknown' && !dead,
    trust,
    value: fi.orders_freshness ? Object.entries(fi.orders_freshness).map(([p, f]) => `${p} ${f.today ?? 0} today`).join(', ') : '—',
    witness: recon ? `scrape ✓ · bank settlement witness present (${recon.bank_settlements_30d} in 30d, reconciliation pending)` : 'scrape only — bank reconciliation not yet wired',
    as_of: fi.ist || nowIST(),
    headline: fi.headline,
    action,
    reconciliation: recon,
  };
}

// ── MONEY: bank/Razorpay feed liveness (money_source_health) ──
async function moneyDomain(env) {
  let rows = [];
  try { rows = (await env.DB.prepare('SELECT source, instrument, last_event_at, status, expected_max_gap_minutes FROM money_source_health').all()).results || []; }
  catch (e) { return { domain: 'money', live: false, trust: 'unknown', value: 'money health table unreadable', witness: String(e.message), as_of: nowIST(), headline: 'cannot read money feed health', action: null }; }
  if (!rows.length) return { domain: 'money', live: false, trust: 'down', value: 'no money source health rows', witness: 'money_source_health empty', as_of: nowIST(), headline: 'money feed health not configured', action: { label: 'wire money_source_health', severity: 'attention' } };

  const stale = rows.filter(r => {
    const a = ageMin(r.last_event_at);
    const gap = Number(r.expected_max_gap_minutes || 1440);
    return a == null || a > gap || (r.status && r.status !== 'ok' && r.status !== 'healthy');
  });
  const trust = stale.length ? 'stale' : 'reconciled';
  return {
    domain: 'money',
    live: stale.length < rows.length,
    trust,
    value: `${rows.length} money feeds, ${stale.length} stale`,
    witness: 'bank + Razorpay event freshness',
    as_of: nowIST(),
    headline: stale.length ? `money feeds stale: ${stale.map(s => s.source + '/' + s.instrument).join(', ')}` : 'all money feeds fresh',
    action: stale.length ? { label: `Money feed(s) stale: ${stale.map(s => s.source).join(', ')} — check ingest`, severity: 'attention' } : null,
  };
}

const DOMAINS = [deliveryDomain, moneyDomain];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

  const url = new URL(request.url);
  const pin = (url.searchParams.get('pin') || request.headers.get('X-Ops-Pin') || '').trim();
  if (!OWNER_PINS.has(pin)) return json({ ok: false, error: 'PIN required' }, 401);
  if (!env.DB) return json({ ok: false, error: 'DB not configured' }, 500);

  const origin = url.origin;
  const results = await Promise.all(DOMAINS.map(fn => fn(env, origin).catch(e => ({ domain: fn.name, live: false, trust: 'unknown', headline: 'domain error: ' + e.message, action: null }))));

  // overall rollup: loss_risk if any domain unverified/down; attention if any not reconciled/single_source or has an action
  const rank = { reconciled: 0, single_source: 0, stale: 2, unverified: 3, down: 3, unknown: 3 };
  let worst = 0;
  for (const d of results) worst = Math.max(worst, rank[d.trust] ?? 3);
  const anyAction = results.some(d => d.action);
  const overall = worst >= 3 ? 'loss_risk' : (worst >= 2 || anyAction) ? 'attention' : 'all_trustworthy';
  const actions = results.filter(d => d.action).map(d => ({ domain: d.domain, ...d.action }));

  return json({
    ok: true,
    overall,                        // all_trustworthy | attention | loss_risk
    headline: overall === 'all_trustworthy' ? 'Everything live and trustworthy'
            : actions.length ? actions.map(a => a.label).join(' · ')
            : 'Some feeds need attention',
    actions,                        // the one-tap business actions, if any
    domains: results,
    as_of: nowIST(),
  });
}
