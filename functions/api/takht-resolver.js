/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/takht-resolver — the LIVE bridge between Darbar identity and the POS slots.
 *
 * Lives beside /api/takht-auth on hnhotels.in (the Darbar-identity layer).
 *
 * THE PROBLEM IT SOLVES (proven live 2026-06-25): the NCH slot registry's
 * current_person is a hand-maintained NAME that rots. v_staff_slots still credited
 * Farzaib/Ritiqu/… for ~900 token orders/month while Darbar says those people left
 * and the real active NCH runner is Sabir. Attribution silently flowed to ghosts.
 *
 * THE FIX (owner law: "the live data is pulled from the Darbar app — you know who
 * is working"): WHO is in a slot is NEVER trusted as a stored string. It is resolved
 * LIVE from Darbar (hr_employees, is_active=1) on every read, by darbar_employee_id.
 * The slot is the permanent POS container (partner_id); the person is a live
 * projection of Darbar. If a runner leaves, their binding goes inactive by itself.
 *
 *   GET ?action=roster&brand=NCH  → every slot resolved to its live Darbar person,
 *                                   status live|ghost|vacant + roster gaps + flags.
 *
 * Bindings (this repo, hn-hotels-site): DB = hn-hiring (Darbar identity),
 *           NCH_DB = nch-settlements (v_staff_slots / v_runner_slots). READ-ONLY.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Free-text job_name → Takht view. Mirrors /api/takht-auth classifyRole so
// "who can run / cashier / manage" is decided the SAME way everywhere.
function classifyRole(job) {
  const j = String(job || '').toLowerCase();
  if (/managing director|general manager|\bgm\b|\bmanager\b|cfo|office executive|\badmin\b/.test(j)) return 'manager';
  if (/cashier/.test(j)) return 'cashier';
  if (/\brunner\b/.test(j)) return 'runner';
  if (/captain|waiter|steward/.test(j)) return 'captain';
  if (/chai master|tea master|irani chai/.test(j)) return 'counter';
  return 'none';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'roster';
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const HR = env.DB;          // hn-hiring (Darbar identity)
  const SLOTS = env.NCH_DB;   // nch-settlements (POS slot registry)
  if (!HR || !SLOTS) return json({ ok: false, error: 'DB/NCH_DB not bound' }, 500);

  try {
    if (action !== 'roster') return json({ ok: false, error: `unknown action: ${action}` }, 400);

    // 1. LIVE active roster from Darbar (brand + HQ cross-brand).
    const rosterRows = (await HR.prepare(
      `SELECT id, name, known_as, brand_label, job_name FROM hr_employees
       WHERE is_active = 1 AND brand_label IN (?, 'HQ')`
    ).bind(brand).all()).results || [];
    const roster = rosterRows.map(r => ({
      id: r.id, name: r.known_as || r.name, brand: r.brand_label,
      job: r.job_name || '', view: classifyRole(r.job_name),
    }));
    const byId = new Map(roster.map(r => [r.id, r]));
    const byName = new Map(roster.filter(r => r.view !== 'none').map(r => [norm(r.name), r]));

    // 2. The POS slot registry (the permanent containers).
    const slots = (await SLOTS.prepare(
      `SELECT slot_code, role, current_person, partner_id, darbar_employee_id, active
       FROM v_staff_slots ORDER BY role, slot_code`
    ).all()).results || [];

    // 3. Resolve each slot to its LIVE person. ID-bind wins; name-match is a flagged fallback.
    const occupiedIds = new Set();
    const resolved = slots.map(s => {
      let person = null, via = null;
      if (s.darbar_employee_id && byId.has(s.darbar_employee_id)) { person = byId.get(s.darbar_employee_id); via = 'bound_id'; }
      else if (s.current_person && byName.has(norm(s.current_person))) { person = byName.get(norm(s.current_person)); via = 'name_match'; }
      if (person) occupiedIds.add(person.id);
      const status = person ? 'live' : (s.current_person ? 'ghost' : 'vacant');
      return {
        slot_code: s.slot_code, role: s.role, partner_id: s.partner_id,
        label_was: s.current_person,
        person: person ? { id: person.id, name: person.name } : null,
        resolved_via: via, status, durable: via === 'bound_id',
      };
    });

    // 4. Roster gaps — active FOH people Darbar knows who occupy NO slot.
    const unslotted = roster.filter(r => r.view !== 'none' && !occupiedIds.has(r.id))
      .map(r => ({ id: r.id, name: r.name, view: r.view, job: r.job }));

    // 5. Plain-language flags — the leak made visible.
    const flags = [];
    const ghosts = resolved.filter(s => s.status === 'ghost');
    if (ghosts.length) flags.push({ level: 'red', text: `${ghosts.length} slot(s) still credit people Darbar says are inactive: ${ghosts.map(g => `${g.slot_code}=${g.label_was}`).join(', ')}` });
    const looseRunners = unslotted.filter(u => u.view === 'runner');
    if (looseRunners.length) flags.push({ level: 'amber', text: `Active runner(s) with no bound slot: ${looseRunners.map(u => u.name).join(', ')}` });
    const nameOnly = resolved.filter(s => s.resolved_via === 'name_match');
    if (nameOnly.length) flags.push({ level: 'amber', text: `${nameOnly.length} slot(s) resolved by NAME only (fragile) — bind by Darbar id.` });
    if (!flags.length) flags.push({ level: 'green', text: 'Every slot maps to a live Darbar person by id.' });

    return json({
      ok: true, brand, resolved_at: new Date().toISOString(),
      slots: resolved,
      active_foh: roster.filter(r => r.view !== 'none'),
      unslotted, flags,
      summary: { slots: resolved.length, live: resolved.filter(s => s.status === 'live').length,
                 ghost: ghosts.length, durable: resolved.filter(s => s.durable).length },
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
