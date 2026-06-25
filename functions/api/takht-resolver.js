/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /api/takht-resolver — the LIVE bridge between Darbar identity and the POS slots.
 *
 * Lives beside /api/takht-auth on hnhotels.in (the Darbar-identity layer).
 *
 * TWO KINDS OF SLOT, on purpose:
 *  • RUNNERS are identified by their SLOT — RUN01..RUN05 — not by a Darbar person.
 *    A runner is a position (fixed Odoo partner 64-68); accountability is per-slot.
 *    No name reconciliation, no ghost-hunting. Kept deliberately simple.
 *  • NAMED STAFF (cashier / gm / manager / admin) are real people who log into
 *    Takht with their Darbar PIN. They resolve LIVE from Darbar (hr_employees,
 *    is_active=1) by darbar_employee_id every read, so a departed cashier's slot
 *    shows as a ghost instead of silently crediting someone who left.
 *
 *   GET ?action=roster&brand=NCH  → runner slots as RUN01-05, staff slots resolved
 *                                   live to their Darbar person, with flags.
 *
 * Bindings (hn-hotels-site): DB = hn-hiring (Darbar identity),
 *           NCH_DB = nch-settlements (v_staff_slots). READ-ONLY.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Free-text job_name → Takht view. Mirrors /api/takht-auth classifyRole.
function classifyRole(job) {
  const j = String(job || '').toLowerCase();
  if (/managing director|general manager|\bgm\b|\bmanager\b|cfo|office executive|\badmin\b/.test(j)) return 'manager';
  if (/cashier/.test(j)) return 'cashier';
  if (/\brunner\b/.test(j)) return 'runner';
  if (/captain|waiter|steward/.test(j)) return 'captain';
  if (/chai master|tea master|irani chai/.test(j)) return 'counter';
  return 'none';
}
// RUN001 -> RUN01 — the clean runner identity (the slot IS the runner).
function runnerLabel(slotCode) {
  const n = (String(slotCode).match(/(\d+)$/) || [])[1];
  return n ? 'RUN' + String(parseInt(n, 10)).padStart(2, '0') : String(slotCode);
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

    // 3. Resolve each slot.
    const occupiedIds = new Set();
    const resolved = slots.map(s => {
      // RUNNERS: identified by their slot (RUN01-05). No Darbar mapping. Simple.
      if (s.role === 'runner') {
        return {
          slot_code: s.slot_code, role: 'runner', partner_id: s.partner_id,
          person: { id: null, name: runnerLabel(s.slot_code) },
          resolved_via: 'slot', status: 'slot', durable: true,
        };
      }
      // NAMED STAFF: resolve LIVE from Darbar. ID-bind wins; name-match is flagged fallback.
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

    // 4. Roster gaps — active NAMED-staff Darbar knows of who hold no slot (runners excluded).
    const unslotted = roster.filter(r => r.view !== 'none' && r.view !== 'runner' && !occupiedIds.has(r.id))
      .map(r => ({ id: r.id, name: r.name, view: r.view, job: r.job }));

    // 5. Plain-language flags (staff only — runners are slots, never ghosts).
    const flags = [];
    const ghosts = resolved.filter(s => s.status === 'ghost');
    if (ghosts.length) flags.push({ level: 'red', text: `${ghosts.length} staff slot(s) still credit people Darbar says are inactive: ${ghosts.map(g => `${g.slot_code}=${g.label_was}`).join(', ')}` });
    const nameOnly = resolved.filter(s => s.resolved_via === 'name_match');
    if (nameOnly.length) flags.push({ level: 'amber', text: `${nameOnly.length} staff slot(s) resolved by NAME only (fragile) — bind by Darbar id.` });
    if (!flags.length) flags.push({ level: 'green', text: 'Runners are RUN01-05; every staff slot maps to a live Darbar person.' });

    return json({
      ok: true, brand, resolved_at: new Date().toISOString(),
      runners: resolved.filter(s => s.role === 'runner').map(s => ({ slot_code: s.slot_code, runner: s.person.name, partner_id: s.partner_id })),
      slots: resolved,
      active_foh: roster.filter(r => r.view !== 'none'),
      unslotted, flags,
      summary: { slots: resolved.length, runners: resolved.filter(s => s.role === 'runner').length,
                 staff_live: resolved.filter(s => s.status === 'live').length,
                 staff_ghost: ghosts.length },
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
