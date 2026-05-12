// /api/aggregator-health-watcher — owner-only alerting on aggregator pipeline degradation.
//
// Architecture:
//   workers/aggregator-health-watcher (cron */5) → hits this Function with ?action=tick
//   This Function probes 3 surfaces, dedups via D1, and fires SMS+Voice via comms-core.
//
// Probes:
//   A. /api/aggregator-pulse?action=health        — delivery (Swiggy + Zomato), suppressed 02:00-09:00 IST
//   B. /api/aggregator-pulse?action=dine-health   — dine (per-platform, anytime)
//   C. /ops/aggregator/                            — dashboard 200 + ≥1 KB
//
// Dedupe: D1 `health_alert_suppression` table keyed on platform name, 30 min window.
//
// Auth: callers must send CRON_TOKEN as ?token= or x-cron-token header (except action=status).

import { sendSms, sendVoice } from './_lib/comms-core.js';

const PAGES_BASE = 'https://hnhotels.in';
const SUPPRESS_MIN = 30;
const DELIVERY_MAX_STALE = 30;
const DINE_MAX_STALE = 60;
const DASHBOARD_MIN_BYTES = 1024;
const NIGHT_SUPPRESS_IST = [2, 9]; // [start, end) IST hour for delivery silence

function nowIST() { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function withinNightSuppress() {
  const h = nowIST().getUTCHours();
  return h >= NIGHT_SUPPRESS_IST[0] && h < NIGHT_SUPPRESS_IST[1];
}
function istHHMM() { return nowIST().toISOString().slice(11, 16); }

async function probeJson(env, action) {
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  try {
    const res = await fetch(`${PAGES_BASE}/api/aggregator-pulse?action=${action}&key=${encodeURIComponent(key || '')}`);
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function probeDashboard() {
  try {
    const res = await fetch(`${PAGES_BASE}/ops/aggregator/`);
    if (!res.ok) return { ok: false, error: `http ${res.status}`, bytes: 0 };
    const text = await res.text();
    const bytes = text.length;
    if (bytes < DASHBOARD_MIN_BYTES) return { ok: false, error: `thin body ${bytes}B`, bytes };
    return { ok: true, bytes };
  } catch (e) { return { ok: false, error: e.message, bytes: 0 }; }
}

async function isSuppressed(env, platformKey) {
  try {
    const row = await env.DB.prepare(
      'SELECT last_alert_at FROM health_alert_suppression WHERE platform = ?'
    ).bind(platformKey).first();
    if (!row) return false;
    return row.last_alert_at > Date.now() - SUPPRESS_MIN * 60_000;
  } catch (e) { return false; } // never block alerting on D1 hiccups
}

async function recordSuppression(env, platformKey, severity) {
  try {
    await env.DB.prepare(
      `INSERT INTO health_alert_suppression (platform, last_alert_at, last_severity)
       VALUES (?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET last_alert_at = excluded.last_alert_at,
                                            last_severity = excluded.last_severity`
    ).bind(platformKey, Date.now(), severity).run();
  } catch (e) { console.error('[watcher] suppression write failed:', e.message); }
}

async function fireAlert(env, { platformKey, message, severity = 'warn' }) {
  if (await isSuppressed(env, platformKey)) return { sent: false, reason: 'suppressed' };
  const phone = env.ALERT_PHONE;
  if (!phone) return { sent: false, reason: 'no ALERT_PHONE secret configured' };
  const results = {};
  try { results.sms = await sendSms(env, { phone, message }); }
  catch (e) { results.sms_error = e.message; }
  try { results.voice = await sendVoice(env, { phone, message_text: message, alert_id: `health-${platformKey}-${Date.now()}` }); }
  catch (e) { results.voice_error = e.message; }
  await recordSuppression(env, platformKey, severity);
  return { sent: true, results };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'tick';

  if (action !== 'status') {
    const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
    const expected = env.WATCHER_TOKEN || env.CRON_TOKEN;
    if (!expected || token !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
  }

  if (action === 'tick') {
    const out = { checked_at_ist: nowIST().toISOString(), alerts: [], probes: {} };

    // A. Delivery health
    const delivery = await probeJson(env, 'health');
    out.probes.delivery = delivery;
    if (delivery.ok && !withinNightSuppress()) {
      const b = delivery.body;
      const z = Number(b.age_minutes?.zomato_snap ?? 9999);
      const s = Number(b.age_minutes?.swiggy_snap ?? 9999);
      if (b.status !== 'ok' || z > DELIVERY_MAX_STALE) {
        const r = await fireAlert(env, { platformKey: 'delivery_zomato', message: `HE-Aggregator: zomato delivery snap stale ${z}m as of ${istHHMM()} IST` });
        out.alerts.push({ platform: 'delivery_zomato', stale_min: z, ...r });
      }
      if (b.status !== 'ok' || s > DELIVERY_MAX_STALE) {
        const r = await fireAlert(env, { platformKey: 'delivery_swiggy', message: `HE-Aggregator: swiggy delivery snap stale ${s}m as of ${istHHMM()} IST` });
        out.alerts.push({ platform: 'delivery_swiggy', stale_min: s, ...r });
      }
    } else if (delivery.ok && withinNightSuppress()) {
      out.probes.delivery.night_suppressed = true;
    } else {
      // The health endpoint itself failed — fire under a meta key
      const r = await fireAlert(env, { platformKey: 'delivery_endpoint', message: `HE-Aggregator: /api/aggregator-pulse?action=health failed (${delivery.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'delivery_endpoint', ...r });
    }

    // B. Dine health (anytime)
    const dine = await probeJson(env, 'dine-health');
    out.probes.dine = dine;
    if (dine.ok) {
      // dine.body.platforms is an ARRAY of {platform, last_seen, stale_minutes, ...}
      const platforms = Array.isArray(dine.body?.platforms) ? dine.body.platforms
                       : Object.values(dine.body?.platforms || {});
      for (const pdata of platforms) {
        const age = Number(pdata?.stale_minutes ?? pdata?.age_minutes ?? 9999);
        const pname = pdata?.platform || 'unknown';
        if (age > DINE_MAX_STALE) {
          const r = await fireAlert(env, { platformKey: `dine_${pname}`, message: `HE-Aggregator: dine ${pname} stale ${age}m as of ${istHHMM()} IST` });
          out.alerts.push({ platform: `dine_${pname}`, stale_min: age, ...r });
        }
      }
    }

    // C. Dashboard 200 + body size
    const dash = await probeDashboard();
    out.probes.dashboard = dash;
    if (!dash.ok) {
      const r = await fireAlert(env, { platformKey: 'dashboard', message: `HE-Aggregator: dashboard down (${dash.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'dashboard', ...r });
    }

    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }

  if (action === 'status') {
    // Read-only diagnostic — current suppression rows. No alert side-effects.
    try {
      const rows = await env.DB.prepare(
        'SELECT platform, last_alert_at, last_severity FROM health_alert_suppression ORDER BY last_alert_at DESC'
      ).all();
      return new Response(JSON.stringify({ suppressions: rows.results || [] }), { headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  if (action === 'reset') {
    // Manual clear of a single suppression — for testing alert paths
    const platform = url.searchParams.get('platform');
    if (!platform) return new Response(JSON.stringify({ error: 'platform param required' }), { status: 400, headers: { 'content-type': 'application/json' } });
    await env.DB.prepare('DELETE FROM health_alert_suppression WHERE platform = ?').bind(platform).run();
    return new Response(JSON.stringify({ ok: true, cleared: platform }), { headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { 'content-type': 'application/json' } });
}
