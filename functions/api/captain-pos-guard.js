// /api/captain-pos-guard — zero-leakage capture + reconciliation.
// for the HE Captain POS (config 6 on test.hamzahotel.com).
//
// Actions:
//   ingest    (POST, device token) — the tab extension drains its local log here.
//   reconcile (cron token)         — prove each captured order became a real Odoo bill;
//                                     anything that didn't => discrepancy row.
//                                     Also: stuck drafts, stale session, Razorpay-no-bill.
//   heartbeat (cron token)         — record if the captain POS goes silent during open hours.
//   status    (read)               — quick counts.
//
// Logs live in D1 (env.DB = hn-hiring): pos_capture, pos_capture_events, pos_discrepancies.
// Independent of Odoo's own offline queue — this is the second durable copy.

import { sendWaba } from './_lib/comms-core.js';

const POS_DB = 'main', POS_UID = 2;
const DEFAULTS = {
  captain_config_id: 6, match_grace_seconds: 240, stuck_draft_minutes: 15,
  session_stale_hours: 24, silence_minutes: 40, open_hour_ist: 7, close_hour_ist: 3,
  reconcile_max_tries: 8, nihaf_phone: '917010426808', owner_waba_enabled: 0
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-guard-token, x-cron-token'
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...CORS } });
const nowSec = () => Math.floor(Date.now() / 1000);
const istHour = () => new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
const istStamp = (sec) => new Date((sec || nowSec()) * 1000 + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' IST';

async function cfg(env) {
  const out = { ...DEFAULTS };
  try {
    const r = await env.DB.prepare('SELECT key, value FROM pos_guard_config').all();
    for (const row of (r.results || [])) {
      const n = Number(row.value);
      out[row.key] = Number.isFinite(n) && row.value.trim() !== '' ? n : row.value;
    }
  } catch (e) {}
  return out;
}

function posUrl(env) { return (env.POS_ODOO_URL || 'https://test.hamzahotel.com/jsonrpc'); }
async function odoo(env, model, method, args, kwargs = {}) {
  const key = env.POS_ODOO_KEY;
  if (!key) throw new Error('POS_ODOO_KEY not configured');
  const r = await fetch(posUrl(env), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: 'object', method: 'execute_kw', args: [env.POS_ODOO_DB || POS_DB, Number(env.POS_ODOO_UID || POS_UID), key, model, method, args, kwargs] } })
  });
  const j = await r.json();
  if (j.error) throw new Error('odoo: ' + JSON.stringify(j.error.data?.message || j.error.message || j.error).slice(0, 200));
  return j.result;
}

// ── ingest ────────────────────────────────────────────────────────────────────
async function ingest(env, request, body) {
  const tok = request.headers.get('x-guard-token') || body.token;
  if (!env.POS_GUARD_INGEST_TOKEN || tok !== env.POS_GUARD_INGEST_TOKEN) return json({ ok: false, error: 'unauthorized' }, 401);
  const captures = Array.isArray(body.captures) ? body.captures : [];
  const events = Array.isArray(body.events) ? body.events : [];
  let nc = 0, ne = 0;
  for (const c of captures) {
    if (!c || !c.client_uid) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO pos_capture (device_id, client_uid, pos_reference, config_id, login_number, amount_total, line_count, captured_at, sync_observed, raw_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(client_uid) DO UPDATE SET
           sync_observed = excluded.sync_observed,
           amount_total  = excluded.amount_total,
           pos_reference = COALESCE(excluded.pos_reference, pos_capture.pos_reference),
           raw_json      = excluded.raw_json`
      ).bind(
        String(c.device_id || body.device_id || 'unknown'), String(c.client_uid),
        c.pos_reference || null, c.config_id != null ? Number(c.config_id) : null,
        c.login_number != null ? String(c.login_number) : null,
        Number(c.amount_total || 0), Number(c.line_count || 0),
        Number(c.captured_at || nowSec()), String(c.sync_observed || 'unknown'),
        JSON.stringify(c).slice(0, 4000)
      ).run();
      nc++;
    } catch (e) {}
  }
  for (const ev of events) {
    if (!ev || !ev.type) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO pos_capture_events (device_id, type, detail, client_uid, at) VALUES (?,?,?,?,?)`
      ).bind(String(ev.device_id || body.device_id || 'unknown'), String(ev.type), (ev.detail || '').slice(0, 500), ev.client_uid || null, Number(ev.at || nowSec())).run();
      ne++;
    } catch (e) {}
  }
  // Real-time alert on a device-reported hard failure (session expired mid-validate).
  for (const ev of events) {
    if (ev && (ev.type === 'session_expired' || ev.type === 'server_error')) {
      await raise(env, {
        kind: 'device_error', severity: 'critical', amount: 0,
        fingerprint: 'device_error:' + (ev.client_uid || ev.at || nowSec()),
        title: 'POS sync failed on the tab',
        detail: (ev.type === 'session_expired' ? 'Session expired during order sync' : 'Server error during order sync') + ' — order may not have saved. ' + (ev.detail || ''),
        evidence: ev
      });
    }
  }
  return json({ ok: true, captures: nc, events: ne });
}

// ── reconcile ───────────────────────────────────────────────────────────────
async function reconcile(env) {
  const c = await cfg(env);
  const t = nowSec();
  const report = { matched: 0, missing: 0, stuck: 0, stale_session: 0, payment_no_bill: 0 };

  // 1) prove captured orders became real Odoo bills
  const cap = await env.DB.prepare(
    `SELECT * FROM pos_capture WHERE matched = 0 AND reconcile_tries < ? AND captured_at >= ? ORDER BY captured_at ASC LIMIT 50`
  ).bind(c.reconcile_max_tries, t - 36 * 3600).all();
  for (const row of (cap.results || [])) {
    let found = null;
    try {
      if (row.pos_reference) {
        const r = await odoo(env, 'pos.order', 'search_read', [[['pos_reference', '=', row.pos_reference]]], { fields: ['id', 'amount_total', 'state'], limit: 1 });
        if (r && r.length) found = r[0];
      }
      if (!found && row.amount_total > 0) {
        const lo = new Date((row.captured_at - 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const hi = new Date((row.captured_at + 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const r = await odoo(env, 'pos.order', 'search_read',
          [[['config_id', '=', c.captain_config_id], ['date_order', '>=', lo], ['date_order', '<=', hi],
            ['amount_total', '>=', row.amount_total - 0.5], ['amount_total', '<=', row.amount_total + 0.5]]],
          { fields: ['id', 'amount_total', 'state'], limit: 1 });
        if (r && r.length) found = r[0];
      }
    } catch (e) { /* Odoo unreachable — leave for next pass */ continue; }

    if (found) {
      await env.DB.prepare('UPDATE pos_capture SET matched=1, matched_order_id=?, matched_at=? WHERE id=?').bind(found.id, t, row.id).run();
      report.matched++;
    } else {
      await env.DB.prepare('UPDATE pos_capture SET reconcile_tries = reconcile_tries + 1 WHERE id=?').bind(row.id).run();
      if (t - row.captured_at >= c.match_grace_seconds) {
        report.missing++;
        await raise(env, {
          kind: 'order_not_billed', severity: 'critical', amount: row.amount_total,
          fingerprint: 'order_not_billed:' + row.client_uid,
          title: 'Captain order has NO bill in Odoo',
          detail: `Order rung at ${istStamp(row.captured_at)} for ₹${row.amount_total} (${row.pos_reference || row.client_uid}) never became an Odoo bill. Device saw sync='${row.sync_observed}'.`,
          evidence: row
        });
      }
    }
  }

  // 2) stuck drafts on the captain register
  try {
    const cutoff = new Date((t - c.stuck_draft_minutes * 60) * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const drafts = await odoo(env, 'pos.order', 'search_read',
      [[['config_id', '=', c.captain_config_id], ['state', '=', 'draft'], ['date_order', '<=', cutoff]]],
      { fields: ['id', 'pos_reference', 'amount_total', 'date_order'], limit: 50 });
    for (const d of (drafts || [])) {
      report.stuck++;
      await raise(env, {
        kind: 'stuck_draft', severity: 'high', amount: d.amount_total || 0,
        fingerprint: 'stuck_draft:' + d.id,
        title: 'Captain order stuck in DRAFT',
        detail: `Order ${d.pos_reference || d.id} (₹${d.amount_total}) has been draft since ${d.date_order} UTC — payment likely failed mid-validate.`,
        evidence: d
      });
    }
  } catch (e) {}

  // 3) stale (never-closed) session
  try {
    const sess = await odoo(env, 'pos.session', 'search_read', [[['config_id', '=', c.captain_config_id], ['state', '=', 'opened']]], { fields: ['id', 'name', 'start_at'], limit: 5 });
    for (const s of (sess || [])) {
      const startSec = s.start_at ? Math.floor(new Date(s.start_at.replace(' ', 'T') + 'Z').getTime() / 1000) : t;
      if (t - startSec >= c.session_stale_hours * 3600) {
        report.stale_session++;
        await raise(env, {
          kind: 'session_stale', severity: 'medium', amount: 0,
          fingerprint: 'session_stale:' + s.id + ':' + new Date(t * 1000).toISOString().slice(0, 10),
          title: 'Captain POS session not closed',
          detail: `Session ${s.name} open since ${s.start_at} UTC (> ${c.session_stale_hours}h). Close it for a clean Z-report.`,
          evidence: s
        });
      }
    }
  } catch (e) {}

  // 4) Razorpay payment with no matching bill (optional — only if keys present)
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    try {
      const from = t - 90 * 60;
      const auth = btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET);
      const pr = await fetch(`https://api.razorpay.com/v1/payments?from=${from}&to=${t}&count=100`, { headers: { authorization: 'Basic ' + auth } });
      const pj = await pr.json();
      for (const p of ((pj && pj.items) || [])) {
        if (p.status !== 'captured') continue;
        const amt = (p.amount || 0) / 100;
        const lo = new Date((p.created_at - 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const hi = new Date((p.created_at + 1800) * 1000).toISOString().slice(0, 19).replace('T', ' ');
        let order = [];
        try {
          order = await odoo(env, 'pos.order', 'search_read',
            [[['config_id', '=', c.captain_config_id], ['date_order', '>=', lo], ['date_order', '<=', hi], ['amount_total', '>=', amt - 0.5], ['amount_total', '<=', amt + 0.5]]],
            { fields: ['id'], limit: 1 });
        } catch (e) { continue; }
        if (!order || !order.length) {
          report.payment_no_bill++;
          await raise(env, {
            kind: 'payment_no_bill', severity: 'critical', amount: amt,
            fingerprint: 'payment_no_bill:' + p.id,
            title: 'Razorpay payment with NO bill',
            detail: `Razorpay captured ₹${amt} at ${istStamp(p.created_at)} (${p.id}) with no matching captain order — money in, no bill.`,
            evidence: { id: p.id, amount: amt, method: p.method }
          });
        }
      }
    } catch (e) {}
  }

  return json({ ok: true, at: istStamp(t), ...report });
}

// ── heartbeat ─────────────────────────────────────────────────────────────────
async function heartbeat(env) {
  const c = await cfg(env);
  const h = istHour();
  const open = c.open_hour_ist <= c.close_hour_ist
    ? (h >= c.open_hour_ist && h < c.close_hour_ist)
    : (h >= c.open_hour_ist || h < c.close_hour_ist);
  if (!open) return json({ ok: true, skipped: 'closed_hours', ist_hour: h });
  const t = nowSec(), since = t - c.silence_minutes * 60;
  let lastCap = 0, lastOrder = 0;
  try {
    const r = await env.DB.prepare('SELECT MAX(captured_at) m FROM pos_capture').first();
    lastCap = (r && r.m) || 0;
  } catch (e) {}
  try {
    const lo = new Date(since * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const r = await odoo(env, 'pos.order', 'search_count', [[['config_id', '=', c.captain_config_id], ['date_order', '>=', lo]]]);
    lastOrder = (typeof r === 'number' && r > 0) ? t : 0;
  } catch (e) { lastOrder = -1; /* Odoo unreachable */ }
  const capSilent = lastCap < since;
  if (capSilent && lastOrder !== t) {
    await raise(env, {
      kind: 'pos_silent', severity: 'high', amount: 0,
      fingerprint: 'pos_silent:' + new Date(t * 1000).toISOString().slice(0, 13), // per-hour
      title: 'Captain POS has gone silent',
      detail: `No captured orders for >${c.silence_minutes} min and no new Odoo orders during open hours. Tab may be offline/crashed — check it.`,
      evidence: { last_capture: lastCap ? istStamp(lastCap) : 'never', odoo: lastOrder === -1 ? 'unreachable' : 'no recent orders' }
    });
    return json({ ok: true, alerted: 'pos_silent' });
  }
  return json({ ok: true, healthy: true, last_capture: lastCap ? istStamp(lastCap) : null });
}

// ── discrepancy + optional owner WABA ────────────────────────────────────────
async function raise(env, d) {
  let inserted = false;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO pos_discrepancies (fingerprint, kind, severity, amount, title, detail, evidence_json)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`
    ).bind(d.fingerprint, d.kind, d.severity || 'high', Number(d.amount || 0), d.title, d.detail || '', JSON.stringify(d.evidence || {}).slice(0, 2000)).run();
    inserted = (r.meta && r.meta.changes) ? r.meta.changes > 0 : false;
  } catch (e) { return; }
  if (!inserted) return; // already known — don't re-spam
  const c = await cfg(env);
  const ownerWabaEnabled = env.POS_GUARD_OWNER_WABA === '1' || String(c.owner_waba_enabled || '').trim() === '1';
  if (!ownerWabaEnabled) {
    try {
      await env.DB.prepare('UPDATE pos_discrepancies SET notified_at=?, notify_status=?, notify_msg_id=? WHERE fingerprint=?')
        .bind(nowSec(), 'suppressed_owner_waba', null, d.fingerprint).run();
    } catch (e) {}
    return;
  }
  const phone = env.NIHAF_PHONE || c.nihaf_phone;
  let status = 'failed', msgId = null;
  try {
    const res = await sendWaba(env, {
      brand: 'he', phone,
      template: 'captain_pos_discrepancy',
      vars: ['Hamza Express', d.title, (Number(d.amount || 0)).toFixed(2), istStamp(), (d.detail || '').slice(0, 250)]
    });
    status = res.ok ? 'sent' : 'failed';
    msgId = res.provider_msg_id || null;
  } catch (e) {}
  try {
    await env.DB.prepare('UPDATE pos_discrepancies SET notified_at=?, notify_status=?, notify_msg_id=? WHERE fingerprint=?')
      .bind(nowSec(), status, msgId, d.fingerprint).run();
  } catch (e) {}
}

// ── status ──────────────────────────────────────────────────────────────────
async function status(env) {
  const out = { ok: true };
  try {
    out.captures = (await env.DB.prepare('SELECT COUNT(*) n FROM pos_capture').first()).n;
    out.unmatched = (await env.DB.prepare('SELECT COUNT(*) n FROM pos_capture WHERE matched=0').first()).n;
    out.open_discrepancies = (await env.DB.prepare('SELECT COUNT(*) n FROM pos_discrepancies WHERE resolved=0').first()).n;
    const last = await env.DB.prepare('SELECT MAX(captured_at) m FROM pos_capture').first();
    out.last_capture = last && last.m ? istStamp(last.m) : null;
  } catch (e) { out.error = e.message; }
  return json(out);
}

// ── router ──────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'status';
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) { body = {}; } }

  // cron-protected actions
  if (action === 'reconcile' || action === 'heartbeat') {
    const tok = request.headers.get('x-cron-token') || url.searchParams.get('token');
    const expected = env.POS_GUARD_CRON_TOKEN || env.CRON_TOKEN;
    if (!expected || tok !== expected) return json({ ok: false, error: 'unauthorized' }, 401);
    return action === 'reconcile' ? reconcile(env) : heartbeat(env);
  }
  if (action === 'ingest') return ingest(env, request, body);
  if (action === 'status') return status(env);
  return json({ ok: false, error: 'unknown action' }, 400);
}
