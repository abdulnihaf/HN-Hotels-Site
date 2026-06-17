// /api/aggregator-health-watcher — owner-only alerting on aggregator pipeline degradation.
//
// Architecture:
//   workers/aggregator-health-watcher (cron */5) → hits this Function with ?action=tick
//   This Function probes 3 surfaces, dedups via D1, and fires WABA via comms-core.
//
// Probes:
//   A. /api/aggregator-pulse?action=health        — delivery (Swiggy + Zomato), suppressed 02:00-09:00 IST
//   B. /api/aggregator-pulse?action=dine-health   — dine (per-platform, anytime)
//   C. /ops/aggregator/                            — dashboard 200 + ≥1 KB
//
// Dedupe: D1 `health_alert_suppression` table keyed on platform name, 30 min window.
//
// Auth: callers must send CRON_TOKEN as ?token= or x-cron-token header (except action=status).

import { sendAndLog } from './_lib/comms-core.js';

const PAGES_BASE = 'https://hnhotels.in';
const SUPPRESS_MIN = 30;
const DELIVERY_MAX_STALE = 30;
const DASHBOARD_MIN_BYTES = 1024;
const NIGHT_SUPPRESS_IST = [2, 9]; // [start, end) IST hour for delivery silence
const OWNER_ALERT_PHONE = '917010426808';
const WABA_ALERT_BRAND = 'sparksol';
const WABA_AGGREGATOR_TEMPLATE = 'aggregator_session_expired_alert_v1';
const WABA_FALLBACK_TEMPLATE = 'ops_alert_critical_v1';
const CORE_RING2_SOURCES = new Set(['swiggy_fetch_orders', 'swiggy_history', 'zomato_history_v2']);
const CRITICAL_RING2_STATES = new Set(['unauthorized', 'parser_failed']);

function nowIST() { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function withinNightSuppress() {
  const h = nowIST().getUTCHours();
  return h >= NIGHT_SUPPRESS_IST[0] && h < NIGHT_SUPPRESS_IST[1];
}
function istHHMM() { return nowIST().toISOString().slice(11, 16); }
function alertPhone(env) {
  return env.AGG_ALERT_PHONE || env.ALERT_PHONE || env.OWNER_PHONE || env.AGG_REPORT_OWNER_PHONE || OWNER_ALERT_PHONE;
}
function shorten(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '...' : text;
}
function ring2AttemptLabel(attempt) {
  const platform = String(attempt?.platform_code || 'aggregator').toUpperCase();
  const brand = String(attempt?.brand_code || 'unknown').toUpperCase();
  const source = String(attempt?.pull_source_code || attempt?.source_kind || 'feed');
  const status = String(attempt?.status_code || 'failed');
  const http = attempt?.http_status ? ` HTTP ${attempt.http_status}` : '';
  return `${platform}/${brand} ${source} ${status}${http}`;
}
function coreRing2Failures(ring2) {
  const attempts = Array.isArray(ring2?.body?.attempts) ? ring2.body.attempts : [];
  return attempts.filter(a => CORE_RING2_SOURCES.has(a?.pull_source_code) && CRITICAL_RING2_STATES.has(a?.status_code));
}
function deliveryFreshness(body, platform) {
  const ages = body?.age_minutes || {};
  const candidates = [
    ['direct', ages[`${platform}_direct`]],
    ['order', ages[`${platform}_order`]],
    ['snapshot', ages[`${platform}_snap`]],
  ];
  for (const [source, value] of candidates) {
    const age = Number(value);
    if (Number.isFinite(age)) return { source, age };
  }
  return { source: 'none', age: null };
}

async function probeJson(env, action) {
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  try {
    const res = await fetch(`${PAGES_BASE}/api/aggregator-pulse?action=${action}&key=${encodeURIComponent(key || '')}`);
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

function todayIstDate() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yesterdayIstDate() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function withinDailyReportWindow() {
  const d = nowIST();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return h === 3 && m < 15;
}

async function runRing2Pull(env) {
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  if (!key) return { ok: false, error: 'DASHBOARD_KEY missing' };
  const today = todayIstDate();
  try {
    const res = await fetch(`${PAGES_BASE}/api/aggregator-pulse?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'coa_ring2_pull',
        mode: 'live',
        triggered_by: 'aggregator-health-watcher-cron',
        from: today,
        to: today,
        max_pages: 1,
        notify: true,
      }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok && body?.ok !== false, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runDailyOwnerReport(env) {
  if (!withinDailyReportWindow()) return { skipped: true, reason: 'outside_0300_0314_ist' };
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  if (!key) return { ok: false, error: 'DASHBOARD_KEY missing' };
  const today = todayIstDate();
  const reportDate = yesterdayIstDate();
  try {
    const res = await fetch(`${PAGES_BASE}/api/aggregator-pulse?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'daily_owner_report',
        triggered_by: 'aggregator-health-watcher-cron',
        report_date: reportDate,
        from: reportDate,
        to: today,
        brands: ['he', 'nch'],
        max_pages: 4,
        send: true,
      }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok && body?.ok !== false, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runRing3Analyze(env) {
  const key = env.DASHBOARD_KEY || env.DASHBOARD_API_KEY;
  if (!key) return { ok: false, error: 'DASHBOARD_KEY missing' };
  const today = todayIstDate();
  try {
    const res = await fetch(`${PAGES_BASE}/api/aggregator-pulse?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'coa_ring3_analyze',
        triggered_by: 'aggregator-health-watcher-cron',
        from: today,
        to: today,
      }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok && body?.ok !== false, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
  const phone = alertPhone(env);
  if (!phone) return { sent: false, reason: 'no alert phone configured' };
  const results = {};
  const alertId = `aggregator-health-${platformKey}-${Date.now()}`;
  const platformLabel = platformKey.replace(/^delivery_/, '').replace(/^dine_/, '').replace(/_/g, ' ').toUpperCase();
  const action = 'Open https://hnhotels.in/ops/aggregator/ and refresh the partner API session/cURL.';
  try {
    results.waba = await sendAndLog(env, {
      channel: 'waba',
      tier: severity,
      alert_id: alertId,
      brand: WABA_ALERT_BRAND,
      phone,
      template: WABA_AGGREGATOR_TEMPLATE,
      language: 'en',
      vars: [platformLabel, 'HN Aggregator', severity, action],
    });
  } catch (e) {
    results.waba_error = e.message;
  }
  if (!results.waba?.ok) {
    try {
      results.waba_fallback = await sendAndLog(env, {
        channel: 'waba',
        tier: severity,
        alert_id: `${alertId}-fallback`,
        brand: WABA_ALERT_BRAND,
        phone,
        template: WABA_FALLBACK_TEMPLATE,
        language: 'en',
        vars: [
          'HN aggregator tracking',
          String(SUPPRESS_MIN),
          shorten(message, 120),
          action,
        ],
      });
    } catch (e) {
      results.waba_fallback_error = e.message;
    }
  }
  const wabaOk = results.waba?.ok || results.waba_fallback?.ok;
  if (!wabaOk) {
    try { results.sms = await sendAndLog(env, { channel: 'sms', tier: severity, alert_id: `${alertId}-sms`, brand: WABA_ALERT_BRAND, phone, message }); }
    catch (e) { results.sms_error = e.message; }
    try { results.voice = await sendAndLog(env, { channel: 'voice', tier: severity, alert_id: `${alertId}-voice`, brand: WABA_ALERT_BRAND, phone, message_text: message }); }
    catch (e) { results.voice_error = e.message; }
  }
  await recordSuppression(env, platformKey, severity);
  return { sent: true, channel: wabaOk ? 'waba' : 'fallback', results };
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

    // Ring 2 direct API pull runs before health checks. This is the actual
    // laptop-independent order updater: Cloudflare cron → Pages Function →
    // partner frontend API replay → D1 order rows + coordinate health.
    out.probes.ring2_pull = await runRing2Pull(env);
    out.probes.ring3_analyze = await runRing3Analyze(env);
    out.probes.daily_owner_report = await runDailyOwnerReport(env);

    const coreFailures = coreRing2Failures(out.probes.ring2_pull);
    if (coreFailures.length) {
      const detail = coreFailures.slice(0, 3).map(ring2AttemptLabel).join('; ');
      const r = await fireAlert(env, {
        platformKey: 'delivery_ring2_core',
        message: `HE-Aggregator: core delivery feed broken (${detail}) as of ${istHHMM()} IST`,
        severity: 'crit',
      });
      out.alerts.push({ platform: 'delivery_ring2_core', failures: coreFailures.length, ...r });
    } else if (!out.probes.ring2_pull.ok && !out.probes.ring2_pull.body) {
      const r = await fireAlert(env, {
        platformKey: 'delivery_ring2_endpoint',
        message: `HE-Aggregator: Ring 2 pull endpoint failed (${out.probes.ring2_pull.error || out.probes.ring2_pull.status || 'unknown'}) as of ${istHHMM()} IST`,
        severity: 'crit',
      });
      out.alerts.push({ platform: 'delivery_ring2_endpoint', ...r });
    }

    // A. Delivery health
    const delivery = await probeJson(env, 'health');
    out.probes.delivery = delivery;
    if (delivery.ok && !withinNightSuppress()) {
      const b = delivery.body;
      const z = deliveryFreshness(b, 'zomato');
      const s = deliveryFreshness(b, 'swiggy');
      out.probes.delivery_effective_age = { zomato: z, swiggy: s };
      if (z.age == null || z.age > DELIVERY_MAX_STALE) {
        const r = await fireAlert(env, { platformKey: 'delivery_zomato', message: `HE-Aggregator: zomato delivery feed stale ${z.age ?? 'unknown'}m via ${z.source} as of ${istHHMM()} IST` });
        out.alerts.push({ platform: 'delivery_zomato', stale_min: z.age, source: z.source, ...r });
      }
      if (s.age == null || s.age > DELIVERY_MAX_STALE) {
        const r = await fireAlert(env, { platformKey: 'delivery_swiggy', message: `HE-Aggregator: swiggy delivery feed stale ${s.age ?? 'unknown'}m via ${s.source} as of ${istHHMM()} IST` });
        out.alerts.push({ platform: 'delivery_swiggy', stale_min: s.age, source: s.source, ...r });
      }
    } else if (delivery.ok && withinNightSuppress()) {
      out.probes.delivery.night_suppressed = true;
    } else {
      // The health endpoint itself failed — fire under a meta key
      const r = await fireAlert(env, { platformKey: 'delivery_endpoint', message: `HE-Aggregator: /api/aggregator-pulse?action=health failed (${delivery.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'delivery_endpoint', ...r });
    }

    // B. Dine health (probe-only until dine scraping is live again).
    // Delivery Ring 2 is live and should alert. Dine-in portal scraping is not
    // part of the current live pipeline; alerting on it creates stale noise and
    // makes the owner distrust the working delivery feed.
    const dine = await probeJson(env, 'dine-health');
    out.probes.dine = dine;
    out.probes.dine_alerts_disabled = true;

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
