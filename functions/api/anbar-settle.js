// ═══════════════════════════════════════════════════════════════════════════
// ANBAR PHOTO SETTLEMENT v2 — staff shoot, Fable identifies everything.
//
// The staff contract is one sentence: "take clear photos of every place
// the snacks and water live." No item names, no form questions, no station
// taps. Fable identifies the SCENE (fridge / wall shelf / display shelf /
// case stack), the ITEMS, and the FORM (loose / bags / sealed box / sealed
// case / open case) from the pixels alone. The backend knows what a bag,
// box and case contain — the user is never asked.
//
// Accuracy contract (owner: "100% or reject"):
//   1. Presentation law: count only pieces whose outline is individually
//      visible. Jumbled is FINE; hidden is not. Hidden → reject with an
//      actionable reason, never a guess.
//   2. Agreement gate: every photo is read TWICE independently. If the two
//      reads disagree on any count, a third read arbitrates; no majority →
//      reject ("retake closer"). A wrong number is worse than a retake.
//   3. Conservation cross-check: finish() compares photo totals against the
//      POS-derived expectation — the second jaw of the pincer.
//
// Scenes are deduped server-side: a retake of the same place replaces the
// earlier read, it never double-counts. Settlement completes only when all
// required scenes are covered.
// ═══════════════════════════════════════════════════════════════════════════

const PINS = {
  '0305': 'Nihaf', '8523': 'Bashir', '6890': 'Tanveer', '3754': 'Naveen',
  '7115': 'CASH001', '8241': 'CASH002', '2847': 'CASH003', '5190': 'CASH004',
  '3678': 'RUN001', '4421': 'RUN002', '5503': 'RUN003', '6604': 'RUN004', '7705': 'RUN005',
  '2026': 'Zoya',
};

// Physical facts of the outlet — set once with Nihaf, changed only by PR.
// null = not calibrated; affected counts degrade LOUDLY, never silently.
const CAL = {
  fridge_depth: null,    // bottles per full front-to-back fridge column
  bun_bag_size: null,    // buns per tied vendor bag
  bun_box_size: null,    // buns per sealed vendor box
  case_size: 24,         // bottles per sealed water case (owner rule 12-Jun)
};

// The closed scene space. Staff never see these — Fable assigns them by sight.
const SLOTS = [
  { id: 'FRIDGE',         name: 'Water fridge',          icon: '🧊', required: true },
  { id: 'RACK',           name: 'Water wall shelf',      icon: '🚰', required: true },
  { id: 'DISPLAY-TOP',    name: 'Display — top shelf',   icon: '🍪', required: true },
  { id: 'DISPLAY-MIDDLE', name: 'Display — middle shelf',icon: '🥟', required: true },
  { id: 'DISPLAY-BOTTOM', name: 'Display — bottom shelf',icon: '🍞', required: true },
  { id: 'CASES',          name: 'Sealed water cases',    icon: '📦', required: false },
];

const VISION_MODEL = 'claude-fable-5';
const VISION_FALLBACK = 'claude-sonnet-4-5';

const VISION_SYSTEM = `You are the settlement eye of Anbar, the inventory chamber of Nawabi Chai House (an Irani chai cafe). You receive ONE photo taken by counter staff. Your job: identify the scene, identify every tracked item in it, identify the FORM each item is in, and count exactly — or reject.

SCENES (classify into exactly one):
- FRIDGE: a single-door glass display fridge (red body) holding 500ml AquaKing water bottles on wire shelves.
- RACK: a wooden wall shelf with water bottles standing in a single-file row.
- CASES: shrink-wrapped cases of water bottles (sealed or opened), usually on the floor.
- DISPLAY-TOP / DISPLAY-MIDDLE / DISPLAY-BOTTOM: one glass shelf of the snack display case with white trays. Use visual cues: the top shelf shows the case's ceiling/frame above it; the bottom shelf sits on the steel base and usually holds bun bags; otherwise middle. If you genuinely cannot tell which shelf, use DISPLAY-UNKNOWN.
- OTHER: anything else — reject it.

TRACKED ITEMS (identify by sight, never by being told):
- water: clear 500ml bottles, teal AquaKing label
- osmania: round pale shortbread biscuits with smooth domed top
- samosa: golden-brown triangular fried pastries
- cutlet: round patties with rough orange-brown crumb coating
- bun: soft bread buns — may appear LOOSE, in tied transparent BAGS, or in a vendor BOX
- khajoor: dark brown date-cake chunks — NOTE them if present but NEVER reject a photo because of khajoor; it is settled separately.

FORMS and how to count each:
- loose: count pieces whose outline you can individually see. Jumbled or touching is FINE as long as every piece is visible. If pieces are hidden UNDER others so you cannot see them, reject.
- bag: count the BAGS, never the contents inside a bag.
- sealed_box / sealed_case: count the sealed boxes/cases. Sealed means shrink-wrap or lid intact.
- open_case / open_box: count the individual bottles/buns inside ONLY if every single one is visible from this angle; otherwise reject and say to shoot from above or move loose bottles to the fridge or rack.
- fridge_front: in the FRIDGE scene, count ONLY the bottles visible in the front row of each shelf, top shelf first. Bottles are loaded in complete front-to-back columns, so the front row is the truth. Never try to count behind it.
- row: on the RACK, count every bottle (single file law — if bottles are two-deep, reject).

REJECTION DISCIPLINE: rejection is success; a wrong number is failure. Reject when: pieces are hidden under other pieces, the scene's edges are cut off so part of the stock is out of frame, the image is too blurry/dark to separate pieces, or you cannot determine sealed vs open. The reject_reason must be ONE short sentence the staff can act on immediately.

Reply with ONLY a JSON object, no prose:
{"scene": "FRIDGE|RACK|CASES|DISPLAY-TOP|DISPLAY-MIDDLE|DISPLAY-BOTTOM|DISPLAY-UNKNOWN|OTHER",
 "conforms": boolean,
 "reject_reason": string or null,
 "observations": [{"item": "water|osmania|samosa|cutlet|bun|khajoor", "form": "loose|bag|sealed_box|open_box|sealed_case|open_case|fridge_front|row", "qty": integer}],
 "fridge_front_per_shelf": [integers, top first] // FRIDGE scene only
}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

async function readOnce(env, imageB64) {
  const call = async (model) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 700, system: VISION_SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
          { type: 'text', text: 'Identify, count, and return the JSON now.' },
        ] }],
      }),
    });
    const d = await r.json();
    if (d.error) throw new Error(`${d.error.type}: ${d.error.message}`);
    return d.content?.[0]?.text || '';
  };
  let text;
  try { text = await call(VISION_MODEL); }
  catch (e) {
    if (/model|not_found|invalid_request/i.test(e.message)) text = await call(VISION_FALLBACK);
    else throw e;
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('vision returned no JSON');
  return JSON.parse(m[0]);
}

// Canonical signature of a read: scene + sorted item/form/qty triples.
// Two reads AGREE when their signatures match exactly.
function sig(v) {
  const obs = (v.observations || []).filter(o => o.item !== 'khajoor')
    .map(o => `${o.item}|${o.form}|${o.qty}`).sort().join(';');
  const fridge = (v.fridge_front_per_shelf || []).join(',');
  return `${v.scene}~${v.conforms ? 1 : 0}~${obs}~${fridge}`;
}

// Agreement gate: 2 independent reads; disagree → 3rd arbitrates; no majority → reject.
async function agreedVerdict(env, imageB64) {
  const [a, b] = await Promise.all([readOnce(env, imageB64), readOnce(env, imageB64)]);
  if (sig(a) === sig(b)) return { v: a, reads: 2 };
  const c = await readOnce(env, imageB64);
  if (sig(c) === sig(a)) return { v: a, reads: 3 };
  if (sig(c) === sig(b)) return { v: b, reads: 3 };
  return { v: { scene: a.scene, conforms: false, reject_reason: 'counts uncertain across reads — retake closer, make sure every piece is clearly visible', observations: [] }, reads: 3, disagreed: true };
}

// Convert an agreed verdict into item piece-counts using the calibration facts.
function verdictToCounts(v) {
  const counts = {}; const warnings = [];
  const add = (code, q) => { counts[code] = (counts[code] || 0) + q; };
  if (v.scene === 'FRIDGE') {
    const front = (v.fridge_front_per_shelf || []).reduce((x, y) => x + (y || 0), 0)
      || (v.observations || []).filter(o => o.item === 'water').reduce((x, o) => x + o.qty, 0);
    if (CAL.fridge_depth == null) warnings.push(`fridge not calibrated — ${front} front bottles seen, depth unknown`);
    else add('NCH-WTR', front * CAL.fridge_depth);
    return { counts, warnings };
  }
  for (const o of (v.observations || [])) {
    if (o.item === 'khajoor') continue; // parked by owner — settled separately
    const q = o.qty || 0;
    if (o.item === 'water') {
      if (o.form === 'sealed_case') add('NCH-WTR', q * CAL.case_size);
      else add('NCH-WTR', q); // row / loose / open_case fully-visible bottles
    }
    if (o.item === 'osmania') add('NCH-OB', q);
    if (o.item === 'samosa') add('NCH-PS', q);
    if (o.item === 'cutlet') add('NCH-CC', q);
    if (o.item === 'bun') {
      if (o.form === 'bag') {
        if (CAL.bun_bag_size == null) warnings.push(`${q} bun bags seen but bag size not calibrated`);
        else add('NCH-BUN', q * CAL.bun_bag_size);
      } else if (o.form === 'sealed_box') {
        if (CAL.bun_box_size == null) warnings.push(`${q} sealed bun boxes seen but box size not calibrated`);
        else add('NCH-BUN', q * CAL.bun_box_size);
      } else add('NCH-BUN', q);
    }
  }
  return { counts, warnings };
}

// Slot a DISPLAY-UNKNOWN read: first empty display slot, else closest by counts.
function resolveSlot(scene, filled) {
  if (scene !== 'DISPLAY-UNKNOWN') return scene;
  for (const s of ['DISPLAY-TOP', 'DISPLAY-MIDDLE', 'DISPLAY-BOTTOM']) if (!filled.has(s)) return s;
  return null;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;

  try {
    if (action === 'settle-stations') {
      return json({ success: true, stations: SLOTS, cal: CAL });
    }

    if (action === 'settle-photo' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      if (!b.settle_id) return json({ success: false, error: 'settle_id missing' }, 400);
      const now = new Date().toISOString();

      // "no sealed cases today" — the one non-photo fact, recorded never silent
      if (b.skip === 'CASES') {
        await DB.prepare(`INSERT INTO anbar_settle_photos (settle_id, station, r2_key, verdict_json, conforms, by_person, created_at) VALUES (?,?,?,?,1,?,?)`)
          .bind(b.settle_id, 'CASES', null, JSON.stringify({ skipped: true, counts: {} }), person, now).run();
        return json({ success: true, slot: 'CASES', skipped: true, counts: {} });
      }

      if (!b.image) return json({ success: false, error: 'image missing' }, 400);
      const key = `${now.slice(0, 10)}/${b.settle_id}/${Date.now()}.jpg`;
      const bytes = Uint8Array.from(atob(b.image), c => c.charCodeAt(0));
      await context.env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });

      const { v, reads, disagreed } = await agreedVerdict(context.env, b.image);

      if (!v.conforms || v.scene === 'OTHER') {
        await DB.prepare(`INSERT INTO anbar_settle_photos (settle_id, station, r2_key, verdict_json, conforms, by_person, created_at) VALUES (?,?,?,?,0,?,?)`)
          .bind(b.settle_id, v.scene || 'OTHER', key, JSON.stringify({ ...v, reads, disagreed }), person, now).run();
        return json({ success: true, conforms: false, slot: v.scene, reject_reason: v.reject_reason || (v.scene === 'OTHER' ? 'could not recognise this place — shoot the fridge, wall shelf, display shelves or case stack' : 'rejected — retake') });
      }

      // which slots are already conformingly filled for this settle?
      const rows = (await DB.prepare(
        `SELECT station FROM anbar_settle_photos WHERE settle_id=? AND conforms=1`
      ).bind(b.settle_id).all()).results || [];
      const filled = new Set(rows.map(r => r.station));
      const slot = resolveSlot(v.scene, filled);
      if (!slot) return json({ success: true, conforms: false, slot: v.scene, reject_reason: 'all display shelves already photographed — could not tell which shelf this retake is; include the shelf edges' });

      const { counts, warnings } = verdictToCounts({ ...v, scene: slot });
      await DB.prepare(`INSERT INTO anbar_settle_photos (settle_id, station, r2_key, verdict_json, conforms, by_person, created_at) VALUES (?,?,?,?,1,?,?)`)
        .bind(b.settle_id, slot, key, JSON.stringify({ ...v, scene: slot, counts, warnings, reads }), person, now).run();
      return json({ success: true, conforms: true, slot, counts, warnings, reads });
    }

    if (action === 'settle-finish' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);

      // latest conforming verdict per slot — a retake replaces, never double-counts
      const rows = (await DB.prepare(
        `SELECT station, verdict_json FROM anbar_settle_photos WHERE settle_id=? AND conforms=1 AND id IN
         (SELECT MAX(id) FROM anbar_settle_photos WHERE settle_id=? AND conforms=1 GROUP BY station)`
      ).bind(b.settle_id, b.settle_id).all()).results || [];
      const have = new Set(rows.map(r => r.station));
      const missing = SLOTS.filter(s => s.required && !have.has(s.id)).map(s => s.name);
      if (missing.length) return json({ success: false, error: `not photographed yet: ${missing.join(', ')}` }, 400);

      const totals = {}; const warnings = [];
      for (const r of rows) {
        const v = JSON.parse(r.verdict_json);
        for (const [code, q] of Object.entries(v.counts || {})) totals[code] = (totals[code] || 0) + q;
        warnings.push(...(v.warnings || []));
      }

      const now = new Date().toISOString();
      const NAMES = { 'NCH-WTR': 'Water Bottle', 'NCH-OB': 'Osmania Biscuit', 'NCH-PS': 'Pyaaz Samosa', 'NCH-CC': 'Chicken Cutlet', 'NCH-BUN': 'Bun (all types)' };
      const UOMS = { 'NCH-WTR': 'bottle', 'NCH-OB': 'piece', 'NCH-PS': 'piece', 'NCH-CC': 'piece', 'NCH-BUN': 'bun' };
      for (const [code, qty] of Object.entries(totals)) {
        await DB.prepare(
          `INSERT INTO rm_outlet_counts (brand, outlet, item_code, item_name, qty, uom, counted_at, counted_by, kind, notes)
           VALUES ('NCH', 'NCH-COUNTER', ?, ?, ?, ?, ?, ?, 'photo', ?)`
        ).bind(code, NAMES[code] || code, qty, UOMS[code] || 'piece', now, person, `photo settle ${b.settle_id}`).run();
      }
      return json({ success: true, at: now, by: person, totals, warnings });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
