/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN AGENTS API — Phase 1: deterministic detection only
 *
 * No LLM. No persona. No auto-send. Rules in → findings out.
 * Nihaf reviews each finding in the UI and writes the directive himself.
 * Subsequent phases will add LLM-drafted directives once Nihaf has labeled
 * enough findings as 'act' / 'ignore' / 'wrong' / 'more_info'.
 *
 * Routes (PIN-gated, admin/cfo/gm/asstmgr/purchase):
 *   GET  /api/agents?action=list                          — registered agents
 *   POST /api/agents?action=run&agent=finance-watcher     — trigger run
 *   GET  /api/agents?action=runs&agent=                   — recent runs
 *   GET  /api/agents?action=findings&run_id=              — findings for a run
 *   GET  /api/agents?action=findings&agent=&open=1        — all open findings
 *   POST /api/agents?action=verdict                       — set verdict
 *   POST /api/agents?action=directive                     — log directive
 *   POST /api/agents?action=close                         — mark closure
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_ROLES = new Set(['admin', 'cfo', 'gm', 'asstmgr', 'purchase']);
const USERS = {
  '0305': { name: 'Nihaf',    role: 'admin'    },
  '5882': { name: 'Nihaf',    role: 'admin'    },
  '3754': { name: 'Naveen',   role: 'cfo'      },
  '6045': { name: 'Faheem',   role: 'asstmgr'  },
  '3678': { name: 'Faheem',   role: 'asstmgr'  },
  '8523': { name: 'Basheer',  role: 'gm'       },
  '6890': { name: 'Tanveer',  role: 'gm'       },
  '3697': { name: 'Yashwant', role: 'gm'       },
  '2026': { name: 'Zoya',     role: 'purchase' },
  '8316': { name: 'Zoya',     role: 'purchase' },
};

// Registry of agents (Phase 1 ships finance-watcher only; we add as we go).
const AGENTS = {
  'finance-watcher': {
    domain:      'finance',
    description: 'Bills overdue, money orphans, duplicate-bill alerts, stale POs. Pre-BOM.',
    rules:       ['overdue_bill', 'orphan', 'duplicate', 'stale_po'],
    runner:      runFinanceWatcher,
  },
  // sales-watcher, ops-watcher, growth-watcher, people-watcher land later
};

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function json(d, status = 200) {
  return new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function badRequest(m)   { return json({ ok: false, error: m }, 400); }
function unauthorized()  { return json({ ok: false, error: 'auth_required' }, 401); }
function notFound(m)     { return json({ ok: false, error: m || 'not_found' }, 404); }

function auth(pin) {
  if (!pin) return null;
  const u = USERS[String(pin).trim()];
  if (!u || !ALLOWED_ROLES.has(u.role)) return null;
  return u;
}

const DAY_S = 86400;

function todayIST() {
  // IST is UTC+5:30. Get today's YYYY-MM-DD in IST.
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function daysBetween(isoDate /* YYYY-MM-DD */) {
  if (!isoDate) return null;
  const a = Date.parse(isoDate);
  if (isNaN(a)) return null;
  return Math.floor((Date.now() - a) / 1000 / DAY_S);
}

// ━━━ Finance Watcher (Phase 1) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runFinanceWatcher(env, run, actor, originBase) {
  // Reuses /api/money?action=cockpit so we don't duplicate Odoo logic.
  // SERVICE PIN for self-call: use Nihaf admin (0305) — agents authenticate as admin.
  const SERVICE_PIN = '0305';
  const today = todayIST();
  // Pull a wide window so all open POs and pending bills are visible.
  const from = '2025-01-01';
  const to   = today;

  let cockpit;
  try {
    const r = await fetch(`${originBase}/api/money?action=cockpit&from=${from}&to=${to}&brand=ALL&pin=${SERVICE_PIN}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cockpit = await r.json();
  } catch (e) {
    throw new Error(`money cockpit fetch failed: ${e.message || e}`);
  }

  const findings = [];
  const sev = (n) => n > 30 ? 'critical' : n > 7 ? 'high' : n > 0 ? 'medium' : 'low';

  // ─── Rule 1: Overdue bills (objective: due_date < today, not paid) ───
  for (const b of (cockpit.pending_bills || [])) {
    const due = b.invoice_date_due || b.due_date || null;
    const days = daysBetween(due);
    if (days === null || days <= 0) continue;
    findings.push({
      severity:  sev(days),
      category:  'overdue_bill',
      title:     `Overdue ${days}d · ${b.partner_name || b.vendor_name || 'unknown vendor'} · ₹${Math.round(b.amount_total || b.amount_residual || 0).toLocaleString('en-IN')}`,
      detail:    `Bill ${b.name || b.ref || '(no ref)'} · due ${due} · state ${b.payment_state || b.state || '-'} · brand ${b.brand || 'unknown'}`,
      evidence:  b,
      fingerprint: `overdue_bill:${b.id || b.move_id || b.name || `${b.partner_name}-${due}-${b.amount_total}`}`,
    });
  }

  // ─── Rule 2: Orphans (outlet has it, central D1 doesn't) ───
  for (const o of (cockpit.orphans || [])) {
    findings.push({
      severity:  'high',
      category:  'orphan',
      title:     `Orphan: ${o.vendor_name || o.partner_name || '(unknown)'} · ₹${Math.round(o.amount || 0).toLocaleString('en-IN')} · ${o.brand || 'unknown brand'}`,
      detail:    `Recorded in outlet D1 only. Date ${o.date || o.expense_date || '-'} · category ${o.category || '-'} · note ${o.note || '-'}`,
      evidence:  o,
      fingerprint: `orphan:${o.id || `${o.vendor_name}-${o.date}-${o.amount}`}`,
    });
  }

  // ─── Rule 3: High-confidence duplicate bill alerts ───
  for (const d of (cockpit.dup_alerts || [])) {
    if (d.confidence !== 'high') continue;
    findings.push({
      severity:  'critical',
      category:  'duplicate',
      title:     `Duplicate suspected · ${d.vendor_name || '(unknown)'} · ₹${Math.round(d.amount || 0).toLocaleString('en-IN')}`,
      detail:    `Two records within ${d.days_apart || '?'} days · sources ${d.left_source || '?'} ↔ ${d.right_source || '?'}`,
      evidence:  d,
      fingerprint: `duplicate:${[d.left_id, d.right_id].sort().join('-')}`,
    });
  }

  // ─── Rule 4: Stale POs (open + ordered > 7 days ago, no receive) ───
  for (const po of (cockpit.open_pos || [])) {
    const ordered = po.date_order || po.create_date || null;
    const days = daysBetween((ordered || '').slice(0, 10));
    if (days === null || days <= 7) continue;
    findings.push({
      severity:  sev(days),
      category:  'stale_po',
      title:     `Stale PO ${days}d · ${po.partner_name || po.vendor_name || '(unknown)'} · ₹${Math.round(po.amount_total || 0).toLocaleString('en-IN')}`,
      detail:    `PO ${po.name || '(no ref)'} · ordered ${(ordered || '').slice(0, 10)} · state ${po.state || '-'}`,
      evidence:  po,
      fingerprint: `stale_po:${po.id || po.name}`,
    });
  }

  // ─── Persist (upsert by fingerprint to keep reviewed verdicts on re-runs) ───
  let inserted = 0, updated = 0;
  for (const f of findings) {
    const existing = await env.DB.prepare(
      `SELECT id, verdict, closure_status FROM agent_findings WHERE agent_name = ? AND fingerprint = ? LIMIT 1`
    ).bind('finance-watcher', f.fingerprint).first();

    if (existing) {
      // Don't reset verdict; just refresh title/detail/evidence + bump run_id.
      await env.DB.prepare(
        `UPDATE agent_findings
            SET run_id = ?, severity = ?, title = ?, detail = ?, evidence_json = ?, updated_at = unixepoch()
          WHERE id = ?`
      ).bind(run.id, f.severity, f.title, f.detail, JSON.stringify(f.evidence), existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(
        `INSERT INTO agent_findings
            (run_id, agent_name, severity, category, title, detail, evidence_json, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(run.id, 'finance-watcher', f.severity, f.category, f.title, f.detail,
             JSON.stringify(f.evidence), f.fingerprint).run();
      inserted++;
    }
  }
  return { inserted, updated, total_findings: findings.length };
}

// ━━━ Action handlers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleList(env) {
  const out = [];
  for (const [name, def] of Object.entries(AGENTS)) {
    const last = await env.DB.prepare(
      `SELECT id, started_at, finished_at, status, findings_count
         FROM agent_runs WHERE agent_name = ? ORDER BY started_at DESC LIMIT 1`
    ).bind(name).first();
    const open = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM agent_findings WHERE agent_name = ? AND closure_status = 'open'`
    ).bind(name).first();
    out.push({ name, domain: def.domain, description: def.description, rules: def.rules, last_run: last, open_findings: open?.n || 0 });
  }
  return json({ ok: true, agents: out });
}

async function handleRun(env, url, actor, originBase) {
  const name = url.searchParams.get('agent');
  if (!name) return badRequest('agent_required');
  const def = AGENTS[name];
  if (!def) return notFound('unknown_agent');

  const r = await env.DB.prepare(
    `INSERT INTO agent_runs (agent_name, trigger, triggered_by) VALUES (?, 'manual', ?)`
  ).bind(name, `${actor.name} (${actor.role})`).run();
  const run = { id: r.meta.last_row_id, agent_name: name };

  try {
    const result = await def.runner(env, run, actor, originBase);
    await env.DB.prepare(
      `UPDATE agent_runs SET status = 'complete', finished_at = unixepoch(), findings_count = ? WHERE id = ?`
    ).bind(result.total_findings, run.id).run();
    return json({ ok: true, run_id: run.id, ...result });
  } catch (e) {
    await env.DB.prepare(
      `UPDATE agent_runs SET status = 'failed', finished_at = unixepoch(), error = ? WHERE id = ?`
    ).bind(String(e.message || e), run.id).run();
    return json({ ok: false, error: 'agent_failed', detail: String(e.message || e) });
  }
}

async function handleRuns(env, url) {
  const agent = url.searchParams.get('agent');
  const where = agent ? `WHERE agent_name = ?` : '';
  const binds = agent ? [agent] : [];
  const rows = await env.DB.prepare(
    `SELECT id, agent_name, started_at, finished_at, status, findings_count, trigger, triggered_by, error
       FROM agent_runs ${where} ORDER BY started_at DESC LIMIT 30`
  ).bind(...binds).all();
  return json({ ok: true, runs: rows.results || [] });
}

async function handleFindings(env, url) {
  const run_id = url.searchParams.get('run_id');
  const agent  = url.searchParams.get('agent');
  const open   = url.searchParams.get('open');

  const conds = [];
  const binds = [];
  if (run_id) { conds.push('run_id = ?'); binds.push(run_id); }
  if (agent)  { conds.push('agent_name = ?'); binds.push(agent); }
  if (open === '1') { conds.push("closure_status = 'open'"); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await env.DB.prepare(
    `SELECT id, run_id, agent_name, severity, category, title, detail, evidence_json,
            verdict, verdict_note, verdict_at, verdict_by,
            directive, directive_channel, directive_to, directive_at,
            closure_status, closed_at, closure_note,
            created_at, updated_at
       FROM agent_findings ${where}
       ORDER BY
         CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         created_at DESC
       LIMIT 200`
  ).bind(...binds).all();
  return json({ ok: true, findings: rows.results || [] });
}

async function handleVerdict(env, body, actor) {
  const id = body.finding_id;
  if (!id) return badRequest('finding_id_required');
  const v = body.verdict;
  if (!['act','ignore','wrong','more_info'].includes(v)) return badRequest('invalid_verdict');
  await env.DB.prepare(
    `UPDATE agent_findings
        SET verdict = ?, verdict_note = ?, verdict_at = unixepoch(), verdict_by = ?, updated_at = unixepoch()
      WHERE id = ?`
  ).bind(v, body.note || null, `${actor.name} (${actor.role})`, id).run();
  return json({ ok: true });
}

async function handleDirective(env, body, actor) {
  const id = body.finding_id;
  if (!id) return badRequest('finding_id_required');
  if (!body.directive) return badRequest('directive_required');
  const ch = body.channel;
  if (ch && !['whatsapp','sms','call','email','in_person'].includes(ch)) return badRequest('invalid_channel');
  await env.DB.prepare(
    `UPDATE agent_findings
        SET directive = ?, directive_channel = ?, directive_to = ?, directive_at = unixepoch(),
            closure_status = CASE WHEN closure_status = 'open' THEN 'in_progress' ELSE closure_status END,
            updated_at = unixepoch()
      WHERE id = ?`
  ).bind(body.directive, ch || null, body.to || null, id).run();
  return json({ ok: true });
}

async function handleClose(env, body, actor) {
  const id = body.finding_id;
  if (!id) return badRequest('finding_id_required');
  const status = body.status || 'resolved';
  if (!['resolved','dismissed'].includes(status)) return badRequest('invalid_status');
  await env.DB.prepare(
    `UPDATE agent_findings
        SET closure_status = ?, closed_at = unixepoch(), closure_note = ?, updated_at = unixepoch()
      WHERE id = ?`
  ).bind(status, body.note || null, id).run();
  return json({ ok: true });
}

// ━━━ Router ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url    = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';
  const pin    = url.searchParams.get('pin') || '';
  const user   = auth(pin);
  if (!user) return unauthorized();

  // Determine origin for self-calls (so finance-watcher can call /api/money).
  const originBase = `${url.protocol}//${url.host}`;

  try {
    if (request.method === 'GET') {
      if (action === 'list')     return handleList(env);
      if (action === 'runs')     return handleRuns(env, url);
      if (action === 'findings') return handleFindings(env, url);
      return badRequest('unknown_action');
    }
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (action === 'run')       return handleRun(env, url, user, originBase);
      if (action === 'verdict')   return handleVerdict(env, body, user);
      if (action === 'directive') return handleDirective(env, body, user);
      if (action === 'close')     return handleClose(env, body, user);
      return badRequest('unknown_action');
    }
    return badRequest('method_not_allowed');
  } catch (e) {
    return json({ ok: false, error: 'server_error', detail: String(e.message || e) });
  }
}
