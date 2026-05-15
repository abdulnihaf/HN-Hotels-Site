// /api/aggregator-health-watcher - owner-only alerting on aggregator pipeline degradation.
//
// Architecture:
//   workers/aggregator-health-watcher (cron */5) -> hits this Function with ?action=tick
//   This Function probes delivery + dine health, dedups via D1, and sends WABA-first
//   owner alerts through comms-core. SMS/voice remain as fallbacks for urgent failures.
//
// Probes:
//   A. /api/aggregator-pulse?action=health        - delivery, suppressed 02:00-09:00 IST
//   B. /api/aggregator-pulse?action=dine-health   - dine per-platform, anytime
//   C. /ops/aggregator/                            - dashboard 200 + >=1 KB
//   D. latest dine counters                         - booking/count movement alerts
//
// Dedupe:
//   - health_alert_suppression: stale/down alerts + once-daily digest marker
//   - aggregator_dine_alert_state: booking/count movement high-water marks
//
// Auth: callers must send WATCHER_TOKEN/CRON_TOKEN as ?token= or x-cron-token
//       header, except action=status.

import { sendSms, sendVoice, sendWaba } from './_lib/comms-core.js';

const PAGES_BASE = 'https://hnhotels.in';
const SUPPRESS_MIN = 30;
const DELIVERY_MAX_STALE = 30;
const DINE_MAX_STALE = 60;
const DASHBOARD_MIN_BYTES = 1024;
const NIGHT_SUPPRESS_IST = [2, 9]; // [start, end) IST hour for delivery silence
const DEFAULT_DAILY_DIGEST_HOUR_IST = 10;

const DINE_ACTIONS = {
  zomato_dining: 'transaction history, offers, payouts',
  swiggy_dineout: 'overview, reservations, payments',
  eazydiner: 'dashboard, reservations, reports',
};

const WATCHED_DINE_COUNTERS = [
  {
    key: 'dine_booking:eazydiner:he:712958:reservations_count',
    platform: 'eazydiner',
    brand: 'he',
    outlet_id: '712958',
    metric_types: ['dashboard', 'reservations', 'reports'],
    field: 'reservations_count',
    label: 'EazyDiner HE',
    count_label: 'reservations',
  },
  {
    key: 'dine_booking:swiggy_dineout:he:1372737:reservations_count',
    platform: 'swiggy_dineout',
    brand: 'he',
    outlet_id: '1372737',
    metric_types: ['overview', 'reservations', 'payments'],
    field: 'reservations_count',
    label: 'Swiggy Dine-Out HE',
    count_label: 'reservations',
  },
  {
    key: 'dine_booking:zomato_dining:he:22632449:bookings_count',
    platform: 'zomato_dining',
    brand: 'he',
    outlet_id: '22632449',
    metric_types: ['transaction_history', 'offers', 'payouts'],
    field: 'bookings_count',
    label: 'Zomato Dining HE',
    count_label: 'bookings',
  },
];

function nowIST() { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function withinNightSuppress() {
  const h = nowIST().getUTCHours();
  return h >= NIGHT_SUPPRESS_IST[0] && h < NIGHT_SUPPRESS_IST[1];
}
function istHHMM() { return nowIST().toISOString().slice(11, 16); }
function istDate() { return nowIST().toISOString().slice(0, 10); }
function istStamp() {
  const iso = nowIST().toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} IST`;
}
function istDayStartEpochMs() {
  const offset = 5.5 * 60 * 60 * 1000;
  const d = new Date(Date.now() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - offset;
}
function safeJsonParse(s) { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } }
function compact(s, max = 220) {
  const out = String(s || '').replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 3) + '...' : out;
}
function alertPhone(env) {
  const raw = env.AGGREGATOR_ALERT_PHONE || env.ALERT_PHONE || env.EXOTEL_CALLER_ID;
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return raw;
}
function wabaBrand(env) { return env.AGGREGATOR_WABA_BRAND || 'he'; }
function money(n) {
  const v = Number(n || 0);
  if (!v) return 'Rs 0';
  if (v >= 100000) return `Rs ${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `Rs ${(v / 1000).toFixed(1)}K`;
  return `Rs ${Math.round(v)}`;
}

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

async function isSuppressed(env, platformKey, windowMin = SUPPRESS_MIN) {
  try {
    const row = await env.DB.prepare(
      'SELECT last_alert_at FROM health_alert_suppression WHERE platform = ?'
    ).bind(platformKey).first();
    if (!row) return false;
    return row.last_alert_at > Date.now() - windowMin * 60_000;
  } catch { return false; } // never block alerting on D1 hiccups
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

async function wasDailyDigestSentToday(env) {
  try {
    const row = await env.DB.prepare(
      'SELECT last_alert_at FROM health_alert_suppression WHERE platform = ?'
    ).bind('dine_daily_digest').first();
    return !!row && row.last_alert_at >= istDayStartEpochMs();
  } catch { return false; }
}

async function fireAlert(env, { platformKey, message, severity = 'warn' }) {
  if (await isSuppressed(env, platformKey)) return { sent: false, reason: 'suppressed' };
  const phone = alertPhone(env);
  if (!phone) return { sent: false, reason: 'no AGGREGATOR_ALERT_PHONE/ALERT_PHONE secret configured' };

  const template = env.AGGREGATOR_WABA_ALERT_TEMPLATE || 'he_aggregator_alert_v1';
  const vars = [severity.toUpperCase(), platformKey, istStamp(), compact(message, 420)];
  const results = {};

  try {
    results.waba = await sendWaba(env, { brand: wabaBrand(env), phone, template, vars });
  } catch (e) { results.waba_error = e.message; }

  const wabaOk = results.waba?.ok === true;
  const fallbackMode = env.AGGREGATOR_ALERT_FALLBACK_MODE || 'crit_or_waba_fail';
  const shouldFallback = fallbackMode === 'always' || !wabaOk || severity === 'crit';
  if (shouldFallback) {
    try { results.sms = await sendSms(env, { phone, message }); }
    catch (e) { results.sms_error = e.message; }
    try {
      results.voice = await sendVoice(env, {
        phone,
        message_text: message,
        alert_id: `health-${platformKey}-${Date.now()}`,
      });
    } catch (e) { results.voice_error = e.message; }
  }

  await recordSuppression(env, platformKey, severity);
  return { sent: true, results };
}

async function sendDailyDigest(env, digest) {
  const phone = alertPhone(env);
  if (!phone) return { sent: false, reason: 'no AGGREGATOR_ALERT_PHONE/ALERT_PHONE secret configured' };
  const template = env.AGGREGATOR_WABA_DAILY_TEMPLATE || 'he_dine_daily_digest_v1';
  const vars = [
    digest.date_line,
    digest.delivery_line,
    digest.zomato_dining_line,
    digest.swiggy_dineout_line,
    digest.eazydiner_line,
    digest.issue_line,
  ].map(v => compact(v, 900));

  const result = await sendWaba(env, { brand: wabaBrand(env), phone, template, vars });
  await recordSuppression(env, 'dine_daily_digest', result.ok ? 'info' : 'warn');
  return { sent: result.ok, result, template, vars };
}

async function fireBookingAlert(env, target, { current, previous, delta, captured_at }) {
  const phone = alertPhone(env);
  if (!phone) return { sent: false, reason: 'no AGGREGATOR_ALERT_PHONE/ALERT_PHONE secret configured' };
  const template = env.AGGREGATOR_WABA_BOOKING_TEMPLATE || 'he_dine_booking_alert_v1';
  const message = `HE-Aggregator: ${target.label} ${target.count_label} increased +${delta} (${previous} -> ${current}) as of ${istHHMM()} IST. Check ${DINE_ACTIONS[target.platform]}.`;
  const vars = [
    target.label,
    `+${delta}`,
    String(current),
    captured_at || istStamp(),
    DINE_ACTIONS[target.platform] || 'platform dashboard',
  ];
  const results = {};

  try { results.waba = await sendWaba(env, { brand: wabaBrand(env), phone, template, vars }); }
  catch (e) { results.waba_error = e.message; }
  if (!results.waba?.ok) {
    try { results.sms = await sendSms(env, { phone, message }); }
    catch (e) { results.sms_error = e.message; }
  }
  return { sent: true, results, message };
}

function flattenDineSummary(summaryBody) {
  const platforms = summaryBody?.platforms || {};
  const rows = [];
  for (const [platform, entries] of Object.entries(platforms)) {
    for (const row of (entries || [])) {
      rows.push({ ...row, platform, data: safeJsonParse(row.data) || row.data || {} });
    }
  }
  return rows.sort((a, b) => String(b.captured_at || '').localeCompare(String(a.captured_at || '')));
}

async function queryLatestDineRows(env) {
  const rows = await env.DB.prepare(`
    SELECT platform, brand, outlet_id, metric_type, data, captured_at
    FROM aggregator_snapshots
    WHERE platform IN ('zomato_dining', 'swiggy_dineout', 'eazydiner')
      AND substr(metric_type, 1, 1) != '_'
    ORDER BY captured_at DESC
    LIMIT 160
  `).all();
  return (rows.results || []).map(row => ({ ...row, data: safeJsonParse(row.data) || {} }));
}

function latestCounterSnapshot(rows, target) {
  return rows.find(row =>
    row.platform === target.platform &&
    String(row.outlet_id || '') === target.outlet_id &&
    (!target.brand || row.brand === target.brand) &&
    (!target.metric_types?.length || target.metric_types.includes(row.metric_type)) &&
    row.data?.[target.field] !== null &&
    row.data?.[target.field] !== undefined &&
    !Number.isNaN(Number(row.data[target.field]))
  ) || null;
}

async function checkDineBookingSignals(env, rows = null) {
  const dineRows = rows || await queryLatestDineRows(env);
  const out = { checked: [], alerts: [] };

  for (const target of WATCHED_DINE_COUNTERS) {
    const snap = latestCounterSnapshot(dineRows, target);
    if (!snap) {
      out.checked.push({ key: target.key, available: false });
      continue;
    }

    const current = Number(snap.data[target.field]);
    const state = await env.DB.prepare(
      `SELECT platform_key, last_metric_value, last_snapshot_at
         FROM aggregator_dine_alert_state
        WHERE platform_key = ?`
    ).bind(target.key).first();

    if (!state) {
      await env.DB.prepare(`
        INSERT INTO aggregator_dine_alert_state
          (platform_key, last_metric_value, last_snapshot_at, last_alert_at, updated_at)
        VALUES (?, ?, ?, NULL, ?)
      `).bind(target.key, current, snap.captured_at || null, Date.now()).run();
      out.checked.push({ key: target.key, seeded: true, current, captured_at: snap.captured_at });
      continue;
    }

    const previous = Number(state.last_metric_value || 0);
    if (current > previous) {
      const delta = current - previous;
      const alert = await fireBookingAlert(env, target, { current, previous, delta, captured_at: snap.captured_at });
      await env.DB.prepare(`
        UPDATE aggregator_dine_alert_state
           SET last_metric_value = ?, last_snapshot_at = ?, last_alert_at = ?, updated_at = ?
         WHERE platform_key = ?
      `).bind(current, snap.captured_at || null, Date.now(), Date.now(), target.key).run();
      out.alerts.push({ key: target.key, current, previous, delta, captured_at: snap.captured_at, ...alert });
    } else if (current < previous || snap.captured_at !== state.last_snapshot_at) {
      await env.DB.prepare(`
        UPDATE aggregator_dine_alert_state
           SET last_metric_value = ?, last_snapshot_at = ?, updated_at = ?
         WHERE platform_key = ?
      `).bind(current, snap.captured_at || null, Date.now(), target.key).run();
      out.checked.push({ key: target.key, current, previous, reset_or_refresh: current < previous, captured_at: snap.captured_at });
    } else {
      out.checked.push({ key: target.key, current, previous, changed: false, captured_at: snap.captured_at });
    }
  }

  return out;
}

function platformHealth(dineBody, platform) {
  const platforms = Array.isArray(dineBody?.platforms) ? dineBody.platforms : Object.values(dineBody?.platforms || {});
  return platforms.find(p => p.platform === platform) || null;
}

function platformDigestLine({ label, platform, health, rows }) {
  const h = health || {};
  const latest = rows.find(r => r.platform === platform) || null;
  const d = latest?.data || {};
  const bookingCount = d.bookings_count ?? d.reservations_count;
  const covers = d.covers_count;
  const rupees = Array.isArray(d.rupee_amounts) ? d.rupee_amounts : [];
  const maxRupee = Math.max(0, ...rupees, d.payeazy_revenue || 0, d.projected_revenue || 0, d.revenue_summary_mtd || 0);
  const age = h.stale_minutes != null ? `${h.stale_minutes}m` : 'never';
  const countPart = bookingCount != null ? `bookings/res ${bookingCount}` : 'bookings/res -';
  const coverPart = covers != null ? `covers ${covers}` : 'covers -';
  return `${label}: ${(h.status || 'never').toUpperCase()} ${age}; ${countPart}; ${coverPart}; ${money(maxRupee)}`;
}

async function buildDailyDigest(env, preloaded = {}) {
  const [delivery, dine, summary, attr] = await Promise.all([
    preloaded.delivery || probeJson(env, 'health'),
    preloaded.dine || probeJson(env, 'dine-health'),
    preloaded.summary || probeJson(env, 'dine-summary'),
    preloaded.attr || probeJson(env, 'dine-attribution'),
  ]);

  const rows = summary.ok ? flattenDineSummary(summary.body) : [];
  const issues = [];

  let deliveryLine = 'Delivery: health unavailable';
  if (delivery.ok) {
    const b = delivery.body || {};
    deliveryLine = `Delivery: ${(b.status || 'unknown').toUpperCase()}; SW ${b.age_minutes?.swiggy_snap ?? '-'}m; Z ${b.age_minutes?.zomato_snap ?? '-'}m`;
    if (b.status && b.status !== 'ok') issues.push(`delivery ${b.status}`);
  } else {
    issues.push(`delivery endpoint ${delivery.error}`);
  }

  if (!dine.ok) issues.push(`dine endpoint ${dine.error}`);
  if (!summary.ok) issues.push(`summary endpoint ${summary.error}`);

  const zHealth = dine.ok ? platformHealth(dine.body, 'zomato_dining') : null;
  const sHealth = dine.ok ? platformHealth(dine.body, 'swiggy_dineout') : null;
  const eHealth = dine.ok ? platformHealth(dine.body, 'eazydiner') : null;
  for (const h of [zHealth, sHealth, eHealth]) {
    if (!h || h.status !== 'live') issues.push(`${h?.platform || 'dine'} ${h?.status || 'missing'}`);
  }

  const inferred = attr.ok ? money(attr.body?.grand_total_inferred || 0) : 'Rs 0';
  const actionLine = `Actions: ZD ${DINE_ACTIONS.zomato_dining}; SDO ${DINE_ACTIONS.swiggy_dineout}; ED ${DINE_ACTIONS.eazydiner}. May DOM inferred ${inferred}.`;

  return {
    date_line: `HN dine daily ${istDate()} ${istHHMM()} IST`,
    delivery_line: deliveryLine,
    zomato_dining_line: platformDigestLine({ label: 'Zomato Dining', platform: 'zomato_dining', health: zHealth, rows }),
    swiggy_dineout_line: platformDigestLine({ label: 'Swiggy Dine-Out', platform: 'swiggy_dineout', health: sHealth, rows }),
    eazydiner_line: platformDigestLine({ label: 'EazyDiner', platform: 'eazydiner', health: eHealth, rows }),
    issue_line: issues.length ? `Issues: ${issues.join('; ')}. ${actionLine}` : `All live. ${actionLine}`,
    probes: { delivery, dine, summary, attr },
  };
}

async function maybeSendDailyDigest(env, preloaded = {}, { force = false } = {}) {
  const digestHour = Number(env.AGGREGATOR_DAILY_DIGEST_IST_HOUR || DEFAULT_DAILY_DIGEST_HOUR_IST);
  const now = nowIST();
  const inWindow = now.getUTCHours() === digestHour && now.getUTCMinutes() < 20;
  if (!force && !inWindow) return { sent: false, reason: 'outside_digest_window' };
  if (!force && await wasDailyDigestSentToday(env)) return { sent: false, reason: 'already_sent_today' };
  const digest = await buildDailyDigest(env, preloaded);
  const send = await sendDailyDigest(env, digest);
  return { ...send, digest };
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
    const out = { checked_at_ist: istStamp(), alerts: [], probes: {} };

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
      const r = await fireAlert(env, { platformKey: 'delivery_endpoint', message: `HE-Aggregator: /api/aggregator-pulse?action=health failed (${delivery.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'delivery_endpoint', ...r });
    }

    // B. Dine health (anytime)
    const dine = await probeJson(env, 'dine-health');
    out.probes.dine = dine;
    if (dine.ok) {
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
    } else {
      const r = await fireAlert(env, { platformKey: 'dine_endpoint', message: `HE-Aggregator: /api/aggregator-pulse?action=dine-health failed (${dine.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'dine_endpoint', ...r });
    }

    // C. Dashboard 200 + body size
    const dash = await probeDashboard();
    out.probes.dashboard = dash;
    if (!dash.ok) {
      const r = await fireAlert(env, { platformKey: 'dashboard', message: `HE-Aggregator: dashboard down (${dash.error}) as of ${istHHMM()} IST`, severity: 'crit' });
      out.alerts.push({ platform: 'dashboard', ...r });
    }

    // D. Booking/counter movement and daily digest
    try { out.booking_signals = await checkDineBookingSignals(env); }
    catch (e) { out.booking_signals = { error: e.message }; }
    try { out.daily_digest = await maybeSendDailyDigest(env, { delivery, dine }); }
    catch (e) { out.daily_digest = { error: e.message }; }

    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }

  if (action === 'digest-preview') {
    const digest = await buildDailyDigest(env);
    return new Response(JSON.stringify({ ok: true, digest }), { headers: { 'content-type': 'application/json' } });
  }

  if (action === 'daily' || action === 'digest') {
    const force = url.searchParams.get('force') === '1';
    const result = await maybeSendDailyDigest(env, {}, { force });
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'content-type': 'application/json' } });
  }

  if (action === 'booking-status') {
    try {
      const rows = await env.DB.prepare(
        `SELECT platform_key, last_metric_value, last_snapshot_at, last_alert_at, updated_at
           FROM aggregator_dine_alert_state
          ORDER BY updated_at DESC`
      ).all();
      return new Response(JSON.stringify({ ok: true, rows: rows.results || [] }), { headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  if (action === 'status') {
    // Read-only diagnostic - current suppression rows. No alert side-effects.
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
    // Manual clear of a single suppression - for testing alert paths
    const platform = url.searchParams.get('platform');
    if (!platform) return new Response(JSON.stringify({ error: 'platform param required' }), { status: 400, headers: { 'content-type': 'application/json' } });
    await env.DB.prepare('DELETE FROM health_alert_suppression WHERE platform = ?').bind(platform).run();
    return new Response(JSON.stringify({ ok: true, cleared: platform }), { headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { 'content-type': 'application/json' } });
}
