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
    description: 'Money flow violations per Nihaf logical layer. 11 rules: overdue bills, orphans, PO-paid-in-cash bypass, stale POs, RM without PO, PO received no bill, PO billed twice, expense without product, stale bill no due-date, product without UOM, variant-vendor schema gap. Pre-BOM.',
    rules:       ['overdue_bill', 'orphan', 'duplicate', 'po_paid_in_cash_bypass', 'stale_po', 'rm_no_po', 'po_received_no_bill', 'po_billed_twice', 'expense_no_product', 'bill_stale_no_due', 'product_no_uom', 'schema_variant_gap'],
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

  // ─── Rule 1 (D1): Overdue bills (objective: due_date < today, not paid) ───
  for (const b of (cockpit.bills_pending || [])) {
    const due = b.due_date || b.invoice_date_due || null;
    const days = daysBetween(due);
    if (days === null || days <= 0) continue;
    findings.push({
      severity:  sev(days),
      category:  'overdue_bill',
      title:     `Overdue ${days}d · ${b.vendor_name || 'unknown vendor'} · ₹${Math.round(b.amount_residual || b.amount || 0).toLocaleString('en-IN')}`,
      detail:    `Bill ${b.odoo_name || b.bill_ref || '(no ref)'} · due ${due} · state ${b.state} · brand ${b.brand || 'unknown'}`,
      evidence:  b,
      fingerprint: `overdue_bill:${b.odoo_id || b.odoo_name || `${b.vendor_name}-${due}-${b.amount}`}`,
    });
  }

  // ─── Rule 2 (E1+E2): Orphans (outlet has it, central D1 doesn't) ───
  for (const o of (cockpit.orphans || [])) {
    findings.push({
      severity:  o.feed === 'he-outlet' ? 'high' : 'medium',  // HE explicit > NCH fuzzy
      category:  'orphan',
      title:     `Orphan ${o.brand} · ₹${Math.round(o.amount || 0).toLocaleString('en-IN')} · ${o.source || o.feed}`,
      detail:    `Outlet recorded but no central twin. Date ${o.ist_date || (o.recorded_at || '').slice(0, 10)} · cashier ${o.recorded_by_name || '-'} · "${o.description || o.item || ''}"`,
      evidence:  o,
      fingerprint: `orphan:${o.feed}:${o.source_id}`,
    });
  }

  // ─── Rule 3 (A2): High-confidence duplicate alerts (same-feed + cross-kind) ───
  // Cross-kind = "Zoya raised PO + cashier paid cash for same delivery without settle-PO"
  for (const d of (cockpit.dup_alerts || [])) {
    if (d.confidence !== 'high') continue;
    const a = d.a || {};
    const b = d.b || {};
    const isCrossKind = d.kind === 'cross-kind';
    findings.push({
      severity:  'critical',
      category:  isCrossKind ? 'po_paid_in_cash_bypass' : 'duplicate',
      title:     isCrossKind
        ? `PO paid in cash bypass · ${a.vendor_name || '?'} · ₹${Math.round(a.amount || 0).toLocaleString('en-IN')}`
        : `Duplicate · ${a.vendor_name || a.source} · ₹${Math.round(a.amount || 0).toLocaleString('en-IN')}`,
      detail:    isCrossKind
        ? `PO ${a.odoo_name || a.id} (${a.brand}) ↔ cash expense (${b.feed}) within ${d.date_gap_days}d · vendor match ${d.vendor_match_pct}% · amt diff ${d.amount_diff_pct}%. Cashier should have used Pay-PO action.`
        : `Two ${a.brand} rows · ${a.feed} ↔ ${b.feed} · "${a.item || a.description}" ↔ "${b.item || b.description}"`,
      evidence:  d,
      fingerprint: `dup:${d.kind}:${[a.id, b.id].sort().join('-')}`,
    });
  }

  // ─── Rule 4 (B2): Stale POs (open + ordered > 7 days ago, no receipt) ───
  for (const po of (cockpit.pos_open || [])) {
    if (po.state !== 'open-po') continue; // skip 'received' (handled by Rule 6)
    const ordered = po.recorded_at || po.date_order || null;
    const days = daysBetween((ordered || '').slice(0, 10));
    if (days === null || days <= 7) continue;
    findings.push({
      severity:  sev(days),
      category:  'stale_po',
      title:     `Stale PO ${days}d · ${po.vendor_name || '(unknown)'} · ₹${Math.round(po.amount || 0).toLocaleString('en-IN')}`,
      detail:    `PO ${po.odoo_name || '(no ref)'} · ordered ${(ordered || '').slice(0, 10)} · ${po.brand} · ${po.attachment_count || 0} attachment(s)`,
      evidence:  po,
      fingerprint: `stale_po:${po.odoo_id || po.odoo_name}`,
    });
  }

  // ─── Rule 5 (B1): RM bought at outlet without PO ───
  // Per Nihaf logic: ideally all RM purchases route through /ops/purchase.
  // Outlet direct cash RM expense > ₹500 = "should have been a PO first".
  // Below threshold = OK (small daily veg/milk runs).
  const RM_THRESHOLD = 500;
  for (const e of (cockpit.paid || [])) {
    if (e.kind !== 'Expense') continue;
    if (e.feed === 'central') continue;  // central went through /api/spend, fine
    const cat = String(e.category_parent || e.category || e.category_code || '').toLowerCase();
    const isRM = cat.includes('raw material') || cat === 'rm' || cat.includes('01');
    if (!isRM) continue;
    if ((e.amount || 0) < RM_THRESHOLD) continue;
    findings.push({
      severity:  e.amount > 5000 ? 'high' : 'medium',
      category:  'rm_no_po',
      title:     `RM at outlet, no PO · ${e.vendor_name || e.item || '(unspecified)'} · ₹${Math.round(e.amount).toLocaleString('en-IN')}`,
      detail:    `${e.brand} · ${e.source || e.feed} · ${e.ist_date} · "${e.description || e.item || '-'}". Per HN policy, RM > ₹${RM_THRESHOLD} should be raised in /ops/purchase first.`,
      evidence:  e,
      fingerprint: `rm_no_po:${e.feed}:${e.source_id || e.central_id}`,
    });
  }

  // ─── Rule 6 (B3): PO received but no bill landed yet ───
  // pos_open includes state='received' rows (po_lifecycle overlay marked but
  // no Odoo done) — we want PO that received >3d ago and has no matching bill.
  const billsByOrigin = new Map();
  for (const b of [...(cockpit.bills_paid || []), ...(cockpit.bills_pending || [])]) {
    if (!b.invoice_origin) continue;
    if (!billsByOrigin.has(b.invoice_origin)) billsByOrigin.set(b.invoice_origin, []);
    billsByOrigin.get(b.invoice_origin).push(b);
  }
  for (const po of (cockpit.pos_open || [])) {
    if (!po.received_at) continue;
    if (billsByOrigin.has(po.odoo_name)) continue;
    const days = daysBetween((po.received_at || '').slice(0, 10));
    if (days === null || days < 3) continue;  // give vendor 3 days to send bill
    findings.push({
      severity:  days > 14 ? 'high' : 'medium',
      category:  'po_received_no_bill',
      title:     `Received ${days}d, no bill · ${po.vendor_name || '?'} · ₹${Math.round(po.amount || 0).toLocaleString('en-IN')}`,
      detail:    `PO ${po.odoo_name} received ${(po.received_at || '').slice(0,10)} by ${po.received_by || 'unknown'} · vendor hasn't sent bill OR Naveen needs to attach.`,
      evidence:  po,
      fingerprint: `po_received_no_bill:${po.odoo_id || po.odoo_name}`,
    });
  }

  // ─── Rule 7 (D3): Same PO billed twice ───
  for (const [origin, bills] of billsByOrigin) {
    if (bills.length < 2) continue;
    const totalAmount = bills.reduce((s, b) => s + (b.amount || 0), 0);
    findings.push({
      severity:  'critical',
      category:  'po_billed_twice',
      title:     `Same PO billed ${bills.length}× · ${bills[0].vendor_name || '?'} · ₹${Math.round(totalAmount).toLocaleString('en-IN')} total`,
      detail:    `PO ${origin} has ${bills.length} bills: ${bills.map(b => `${b.odoo_name || b.bill_ref}(₹${Math.round(b.amount)})`).join(', ')}`,
      evidence:  { invoice_origin: origin, bills },
      fingerprint: `po_billed_twice:${origin}`,
    });
  }

  // ─── Rule 8 (C1): Central expense missing product link ───
  for (const e of (cockpit.paid || [])) {
    if (e.feed !== 'central') continue;
    if (e.item || e.product_id) continue;  // has product
    if (e.kind !== 'Expense') continue;
    findings.push({
      severity:  'medium',
      category:  'expense_no_product',
      title:     `Expense, no product · ${e.vendor_name || e.source || '?'} · ₹${Math.round(e.amount).toLocaleString('en-IN')}`,
      detail:    `${e.brand} · ${e.category || '-'} · ${e.ist_date} · description: "${e.description || '(empty)'}". Missing product breaks BOM mapping.`,
      evidence:  e,
      fingerprint: `expense_no_product:${e.central_id}`,
    });
  }

  // ─── Rule 9 (D2): Stale unpaid bill with no due date ───
  for (const b of (cockpit.bills_pending || [])) {
    if (b.due_date) continue;  // covered by Rule 1
    const recordedDate = (b.recorded_at || b.ist_date || '').slice(0, 10);
    const age = daysBetween(recordedDate);
    if (age === null || age < 30) continue;
    findings.push({
      severity:  age > 90 ? 'high' : 'medium',
      category:  'bill_stale_no_due',
      title:     `Stale bill ${age}d, no due date · ${b.vendor_name || '?'} · ₹${Math.round(b.amount_residual || b.amount || 0).toLocaleString('en-IN')}`,
      detail:    `Bill ${b.odoo_name} · ${b.brand} · payment_state ${b.state} · needs due_date OR pay-bill.`,
      evidence:  b,
      fingerprint: `bill_stale_no_due:${b.odoo_id || b.odoo_name}`,
    });
  }

  // ─── Rule 10 (F1): Product missing UOM (D1 direct query) ───
  try {
    const noUom = await env.DB.prepare(
      `SELECT hn_code, name, brand, category FROM rm_products
          WHERE is_active = 1 AND (uom IS NULL OR uom = '') LIMIT 50`
    ).all();
    for (const p of (noUom.results || [])) {
      findings.push({
        severity:  'medium',
        category:  'product_no_uom',
        title:     `Product missing UOM · ${p.name} (${p.hn_code})`,
        detail:    `${p.brand} · ${p.category} · UOM required for BOM mapping + agent leakage detection.`,
        evidence:  p,
        fingerprint: `product_no_uom:${p.hn_code}`,
      });
    }
  } catch (_) { /* table may not exist; skip silently */ }

  // ─── Rule 11 (F3): Variant-vendor schema gap (structural, surfaces once) ───
  try {
    const tableCheck = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rm_variant_vendors', 'rm_vendor_variants') LIMIT 1`
    ).first();
    if (!tableCheck) {
      findings.push({
        severity:  'low',
        category:  'schema_variant_gap',
        title:     `Schema gap: vendors map to product TEMPLATE, not VARIANT`,
        detail:    `rm_vendor_products joins on product_code (template) — but per spec, "Amul Butter" vs "White Butter" are variants of one product (Butter), each with its own independent vendor list (10 vendors per variant). Without variant-level vendor mapping, agent can't surface "cheaper vendor for THIS variant" signals.`,
        evidence:  { current: 'rm_vendor_products(product_code, vendor_key)', needed: 'rm_variant_vendors(variant_id, vendor_key) OR add variant_id column' },
        fingerprint: `schema_variant_gap:singleton`,
      });
    }
  } catch (_) {}

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
