#!/usr/bin/env node
/**
 * naam-snapshot.js — refresh the committed data spine for the Naam app.
 *
 * Naam (naam.hnhotels.in) is a VIEW-ONLY marketing surface. It reads two
 * committed files so it loads instantly and works offline:
 *   naam/data/naam-data.json         (this script refreshes it)
 *   naam/data/creative-manifest.json (built by scripts/build-creative-manifest.py)
 *
 * What this does, fault-tolerant (each source isolated, like snapshot-context.js):
 *   1. Recomputes freshness_days for every lane/brand from last_run vs today.
 *   2. Pulls the Codex marketing single-source-of-truth
 *      (~/.local/share/hn-marketing-memory/state/marketing-memory.json — READ ONLY)
 *      and refreshes status / last_run / summary / next_action per lane.
 *   3. Refreshes live glance metrics from the open-CORS cockpit APIs + aggregator.
 *   4. Stamps generated_at and writes naam-data.json back.
 *
 * It NEVER writes to Codex memory or ops/marketing-control/* — read-only there.
 * It preserves the hand-authored lane structure (titles, links, glance labels);
 * only volatile fields are updated. If a source is unreachable the previous
 * (seed) value is kept and a warning is logged.
 *
 * Run:  node scripts/naam-snapshot.js
 * Reads .env.local for: DASHBOARD_API_KEY (aggregator-pulse). Other cockpit
 * APIs are open-CORS and need no key.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'naam', 'data', 'naam-data.json');
const ENV_FILE = path.join(ROOT, '.env.local');
const MEM_FILE = path.join(os.homedir(), '.local', 'share', 'hn-marketing-memory', 'state', 'marketing-memory.json');

function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) { console.warn(`[env] ${ENV_FILE} not found — process.env only.`); return; }
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
function istISO() {
  const d = istNow();
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
}
const TODAY = istISO().slice(0, 10);
function daysBetween(iso) {
  if (!iso) return null;
  const a = new Date(iso.slice(0, 10) + 'T00:00:00Z'), b = new Date(TODAY + 'T00:00:00Z');
  return Math.max(0, Math.round((b - a) / 86400000));
}
async function getJSON(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
function setGlance(brandNode, label, patch) {
  if (!brandNode || !brandNode.glance) return;
  const g = brandNode.glance.find(x => x.label === label);
  if (g) Object.assign(g, patch);
}

// memory lane id  ->  { naam lane id, brand to update }
const MEM_MAP = {
  'meta-ads': { lane: 'meta', brand: 'HE' },
  'google-ads': { lane: 'google', brand: 'HE' },
  'delivery-aggregator': { lane: 'delivery-aggregator', brand: 'HE' },
  'dine-in-aggregator': { lane: 'dine-aggregator', brand: 'HE' },
  'pisignage': { lane: 'pisignage', brand: 'HE' },
  'reel-making': { lane: 'reel', brand: 'HE' },
  'packaging-design': { lane: 'packaging', brand: 'NCH' },
  'flyers': { lane: 'flyers', brand: 'HE' },
  'pos-write': { lane: 'pos-write', brand: 'HE' },
  'waba-outreach': { lane: 'waba-outreach', brand: 'HE' },
  'influencer': { lane: 'influencer', brand: 'HE' }
};

async function main() {
  loadEnvLocal();
  if (!fs.existsSync(DATA_FILE)) { console.error(`[fatal] ${DATA_FILE} missing — cannot refresh.`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const laneById = Object.fromEntries(data.lanes.map(l => [l.id, l]));
  let memOk = false, metricSources = 0;

  // ── 1. marketing-memory (read-only) ───────────────────────────────────────
  let memoryUpdatedAt = null;
  try {
    const mem = JSON.parse(fs.readFileSync(MEM_FILE, 'utf8'));
    // Capture when Codex last actually wrote this memory (distinct from when WE ran the snapshot)
    memoryUpdatedAt = mem.updated_at || mem.published_at || null;
    const memLanes = mem.lanes || mem; // tolerate shape
    const arr = Array.isArray(memLanes) ? memLanes : Object.values(memLanes);
    for (const m of arr) {
      const id = m.id || m.slug; if (!id || !MEM_MAP[id]) continue;
      const map = MEM_MAP[id]; const lane = laneById[map.lane]; if (!lane) continue;
      const bn = lane.brands[map.brand]; if (!bn) continue;
      const lastRun = (m.last_run_at || m.updated_at || '').slice(0, 10) || bn.last_run;
      if (lastRun) { bn.last_run = lastRun; bn.freshness_days = daysBetween(lastRun); }
      if (m.status) bn.status = m.status === 'completed' ? 'completed' : (m.status === 'ready' ? 'ready' : bn.status);
      if (m.last_summary) bn.summary = m.last_summary;
      if (m.next_action && bn.next_action) bn.next_action.text = m.next_action;
    }
    memOk = true;
  } catch (e) { console.warn('[memory] skipped:', e.message); }

  // ── 2. recompute freshness for every lane/brand from last_run ─────────────
  for (const lane of data.lanes) for (const bk of Object.keys(lane.brands)) {
    const bn = lane.brands[bk]; if (bn && bn.last_run) bn.freshness_days = daysBetween(bn.last_run);
  }

  // ── 3. live metric refresh (each isolated) ────────────────────────────────
  // Meta (HE)
  try {
    const j = await getJSON('https://hamzaexpress.in/api/ctwa-analytics?period=all');
    const a = j.adMetrics || (j.data && j.data.adMetrics);
    const bn = laneById.meta.brands.HE;
    if (a && bn) {
      setGlance(bn, 'Video Maps campaign spend', { value: inr(a.spend), sub: `${Number(a.impressions).toLocaleString('en-IN')} impr · ${Number(a.reach).toLocaleString('en-IN')} reach` });
      if (a.ctr != null) setGlance(bn, 'CTR', { value: a.ctr.toFixed(2) + '%', sub: `CPC ₹${(a.cpc || 0).toFixed(2)} · CPM ₹${(a.cpm || 0).toFixed(2)}` });
      if (a.linkClicks != null) setGlance(bn, 'Link / outbound clicks', { value: Number(a.linkClicks).toLocaleString('en-IN'), sub: `${Number(a.landingPageViews || a.lpv || 0).toLocaleString('en-IN')} landing-page views` });
      bn.last_run = TODAY; bn.freshness_days = 0; metricSources++;
    }
  } catch (e) { console.warn('[meta] kept seed:', e.message); }

  // Google (HE)
  try {
    const j = await getJSON('https://hamzaexpress.in/api/google-cockpit?period=7d');
    const o = j.overview || (j.data && j.data.overview);
    const bn = laneById.google.brands.HE;
    if (o && bn) {
      if (o.spend != null) setGlance(bn, 'Live daily budget', { sub: `7d spend ${inr(o.spend)} · ${o.clicks || 0} clicks` });
      metricSources++;
    }
  } catch (e) { console.warn('[google] kept seed:', e.message); }

  // Delivery aggregator (HE + NCH) — needs key
  const KEY = process.env.DASHBOARD_API_KEY || process.env.DASHBOARD_KEY;
  if (KEY) {
    for (const [bk, brandKey] of [['HE', 'he'], ['NCH', 'nch']]) {
      try {
        const j = await getJSON(`https://hnhotels.in/api/aggregator-pulse?action=orders&brand=${brandKey}&period=month&key=${KEY}`);
        const bn = laneById['delivery-aggregator'].brands[bk];
        if (j && j.ok && bn) {
          setGlance(bn, 'May 1–25 orders', { label: 'This month orders', value: String(j.total_orders ?? '—'), sub: (j.by_outlet || []).map(o => `${o.orders} ${o.platform}`).join(' · ') });
          setGlance(bn, 'Delivered revenue', { value: inr(j.total_revenue || 0), sub: 'this month' });
          bn.last_run = TODAY; bn.freshness_days = 0; metricSources++;
        }
      } catch (e) { console.warn(`[aggregator ${bk}] kept seed:`, e.message); }
    }
  } else { console.warn('[aggregator] no DASHBOARD_API_KEY — kept seed'); }

  // GBP (HE + NCH)
  for (const [bk, brandKey] of [['HE', 'he'], ['NCH', 'nch']]) {
    try {
      const j = await getJSON(`https://hnhotels.in/api/gbp-cockpit?brand=${brandKey}`);
      const s = j.summary; const bn = laneById.gbp.brands[bk];
      if (s && bn) {
        if (s.impressions) setGlance(bn, 'Impressions / actions', { value: Number(s.impressions.total).toLocaleString('en-IN'), sub: `${s.actions ? s.actions.total : 0} actions` });
        if (j.reviews && j.reviews.rating) setGlance(bn, 'Rating', { value: j.reviews.rating + '★', sub: (j.reviews.count || 0) + ' reviews' });
        bn.last_run = TODAY; bn.freshness_days = 0; metricSources++;
      }
    } catch (e) { console.warn(`[gbp ${bk}] kept seed:`, e.message); }
  }

  // Leads / WABA (HE)
  try {
    const j = await getJSON('https://hamzaexpress.in/api/leads?action=counts');
    const bn = laneById['waba-outreach'].brands.HE;
    if (j && j.byStage && bn) {
      const conv = (j.byStatus && j.byStatus.converted) || 0;
      setGlance(bn, 'Voucher campaign', { value: 'armed', sub: `${conv} converted leads` });
      metricSources++;
    }
  } catch (e) { console.warn('[leads] kept seed:', e.message); }

  // ── 4. validate lane↔manifest contract ───────────────────────────────────
  // Warn if a lane's related_creative_lane value has no match in the manifest.
  // Catches silent 0-count mismatches BEFORE they reach production.
  const manifestFile = require('path').join(ROOT, 'naam', 'data', 'creative-manifest.json');
  if (fs.existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const manifestLanes = new Set(manifest.lanes || []);
      let validationWarnings = 0;
      for (const lane of data.lanes) {
        const rl = lane.related_creative_lane;
        if (rl && rl !== 'other' && !manifestLanes.has(rl)) {
          console.warn(`[validate] lane "${lane.id}" related_creative_lane="${rl}" not found in creative-manifest lanes: [${[...manifestLanes].join(', ')}]. Re-run build-creative-manifest.py.`);
          validationWarnings++;
        }
      }
      if (validationWarnings === 0) console.log('[validate] lane↔manifest contract OK');
    } catch (e) { console.warn('[validate] could not read creative-manifest.json:', e.message); }
  } else {
    console.warn('[validate] creative-manifest.json not found — run build-creative-manifest.py');
  }

  // ── 5. stamp + write ──────────────────────────────────────────────────────
  data.generated_at = istISO();
  // memory_updated_at = when Codex last ACTUALLY updated the marketing memory
  // This is DISTINCT from generated_at (= when this script ran).
  // The You-tab staleness banner uses generated_at; the lane freshness_days
  // per lane uses last_run. memory_updated_at lets the UI warn when the entire
  // memory source is stale even if individual lanes show "today".
  data.memory_updated_at = memoryUpdatedAt || null;
  data.today = TODAY;
  data.as_of_note = `Refreshed ${istISO()} · memory last updated: ${memoryUpdatedAt || 'unknown'} · live metric sources:${metricSources}. Run: node scripts/naam-snapshot.js`;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`[done] naam-data.json refreshed — memory:${memOk ? 'ok' : 'skip'} (updated ${memoryUpdatedAt || '?'}), ${metricSources} live metric sources, today=${TODAY}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
