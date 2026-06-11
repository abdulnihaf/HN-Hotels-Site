// ═══════════════════════════════════════════════════════════════════════════
// ANBAR PHOTO SETTLEMENT — the count nobody counts.
//
// The presentation is LAW (defined per station); the photo is CONFORMANCE.
// Fable vision either reads an exact number or rejects the photo with a
// reason the staff can fix on the spot. It is never allowed to guess.
//
// Stations are the unit of settlement — each physical place has a closed
// list of what may appear in it, so cross-mapping is impossible to get
// wrong rather than hard to get right.
//
// Flow: settle-stations → N × settle-photo → settle-finish
//   photo  → R2 (evidence) + Fable vision → verdict row in D1
//   finish → sums per item across stations → rm_outlet_counts (kind='photo')
//
// Calibration constants (CAL) are facts of the physical outlet, set once
// at the outlet with Nihaf, changed only by PR. null = not yet calibrated;
// affected stations degrade loudly, never silently.
// ═══════════════════════════════════════════════════════════════════════════

const PINS = {
  '0305': 'Nihaf', '8523': 'Bashir', '6890': 'Tanveer', '3754': 'Naveen',
  '7115': 'CASH001', '8241': 'CASH002', '2847': 'CASH003', '5190': 'CASH004',
  '3678': 'RUN001', '4421': 'RUN002', '5503': 'RUN003', '6604': 'RUN004', '7705': 'RUN005',
  '2026': 'Zoya',
};

const CAL = {
  fridge_depth: null,    // bottles per full front-to-back column — calibrate at outlet
  bun_bag_size: null,    // buns per tied vendor bag — calibrate at outlet
  bun_box_size: null,    // buns per sealed vendor box — calibrate at outlet
  case_size: 24,         // bottles per sealed water case (owner rule 12-Jun)
};

// Vision returns ONLY the fields its station declares. Anything else is noise.
const STATIONS = [
  {
    id: 'WTR-FRIDGE', icon: '🧊', name: 'Water Fridge',
    law: 'Open the door fully. One photo — all shelves in frame.',
    items: ['NCH-WTR'],
    fields: { front_bottles_per_shelf: 'array of integers, top shelf first' },
    scene: `A single-door display fridge holding identical AquaKing 500ml water bottles on up to 3 wire shelves.
LAW: bottles are loaded in complete front-to-back columns — every bottle visible at the front implies a full column behind it. Gaps appear only where a whole column is gone.
Count the bottles visible in the FRONT ROW of each shelf (top shelf first). Do not attempt to count behind the front row.
REJECT if: the door is not fully open, a shelf is cut out of frame, or bottles are visibly scattered/lying down rather than standing in columns.`,
  },
  {
    id: 'WTR-RACK', icon: '🚰', name: 'Water Rack (wall shelf)',
    law: 'Whole shelf in frame, straight on.',
    items: ['NCH-WTR'],
    fields: { bottles: 'integer' },
    scene: `A single wooden wall shelf with AquaKing 500ml water bottles standing in a single-file row (one bottle deep).
Count every bottle.
REJECT if: bottles are two-deep or stacked (the law is single file), or the shelf edges are cut out of frame.`,
  },
  {
    id: 'WTR-CASES', icon: '📦', name: 'Sealed Water Cases',
    law: 'All unopened cases in one photo. Tap "none" if there are none.',
    items: ['NCH-WTR'], skippable: true,
    fields: { sealed_cases: 'integer' },
    scene: `Shrink-wrapped, UNOPENED cases of 24 AquaKing 500ml water bottles, stacked.
Count only fully sealed cases — an opened or torn case counts as zero here (its bottles belong on the rack or fridge).
REJECT if: you cannot tell whether a case is sealed, or part of the stack is cut out of frame.`,
  },
  {
    id: 'DISP-TOP', icon: '🍪', name: 'Display — Top Shelf',
    law: 'One shelf per photo. Trays flat, single layer, nothing stacked.',
    items: ['NCH-OB', 'NCH-PS', 'NCH-CC'],
    fields: { osmania: 'integer', samosa: 'integer', cutlet: 'integer' },
    scene: SHELF_SCENE(),
  },
  {
    id: 'DISP-MID', icon: '🥟', name: 'Display — Middle Shelf',
    law: 'One shelf per photo. Trays flat, single layer, nothing stacked.',
    items: ['NCH-OB', 'NCH-PS', 'NCH-CC'],
    fields: { osmania: 'integer', samosa: 'integer', cutlet: 'integer' },
    scene: SHELF_SCENE(),
  },
  {
    id: 'DISP-BOT', icon: '🍞', name: 'Display — Bottom Shelf (buns)',
    law: 'Whole shelf in frame. Bags lying in one row.',
    items: ['NCH-BUN'],
    fields: { bun_bags: 'integer — tied plastic bags of buns', bun_loose: 'integer — buns not inside a bag' },
    scene: `The bottom shelf of a display case holding buns in tied transparent plastic bags arranged in a row, possibly with a few loose buns.
Count the BAGS (do not try to count buns inside a bag) and separately count any LOOSE buns.
REJECT if: bags are piled two-deep so some bags are hidden, or the shelf is cut out of frame.`,
  },
];

function SHELF_SCENE() {
  return `One glass shelf of a display case holding white trays of snacks. Possible items, visually distinct:
- OSMANIA: round pale shortbread biscuits, smooth domed top
- SAMOSA: golden-brown triangular pastries
- CUTLET: round patties with rough orange-brown crumb coating
LAW: every tray is a single flat layer — no piece may sit on top of another, no heap.
Count the pieces of each item present (0 if absent).
REJECT if: any pieces are stacked or heaped (say which tray), pieces overlap so edges cannot be separated, or a tray is partially cut out of frame.`;
}

const VISION_MODEL = 'claude-fable-5';
const VISION_FALLBACK = 'claude-sonnet-4-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

async function visionVerdict(env, station, imageB64) {
  const fieldSpec = Object.entries(station.fields).map(([k, v]) => `"${k}": ${v}`).join(', ');
  const system = `You are the settlement eye of Anbar, an inventory system. You verify a photo against a defined presentation law and read an exact count. You NEVER estimate, NEVER guess hidden items, NEVER count what you cannot clearly see. If the law is violated or anything is ambiguous, you reject — rejection is success, a wrong number is failure.
Reply with ONLY a JSON object, no prose: {"conforms": boolean, "reject_reason": string or null (one short sentence the staff can act on, e.g. "two biscuits are stacked on the left tray — lay them flat"), ${fieldSpec}}`;
  const body = (model) => JSON.stringify({
    model, max_tokens: 500,
    system,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
      { type: 'text', text: station.scene + '\nReturn the JSON now.' },
    ] }],
  });
  const call = async (model) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: body(model),
    });
    const d = await r.json();
    if (d.error) throw new Error(`${d.error.type}: ${d.error.message}`);
    return d.content?.[0]?.text || '';
  };
  let text;
  try { text = await call(VISION_MODEL); }
  catch (e) {
    if (/model|not_found|invalid/i.test(e.message)) text = await call(VISION_FALLBACK);
    else throw e;
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('vision returned no JSON');
  return JSON.parse(m[0]);
}

// Convert a station's verdict fields into item piece-counts. Returns
// { counts: {code: qty}, warnings: [] } — null qty means "needs calibration".
function verdictToCounts(station, v) {
  const counts = {}; const warnings = [];
  const add = (code, q) => { counts[code] = (counts[code] || 0) + q; };
  if (station.id === 'WTR-FRIDGE') {
    const front = (v.front_bottles_per_shelf || []).reduce((a, b) => a + (b || 0), 0);
    if (CAL.fridge_depth == null) { warnings.push(`fridge not calibrated — counted ${front} front bottles, depth unknown`); }
    else add('NCH-WTR', front * CAL.fridge_depth);
  }
  if (station.id === 'WTR-RACK') add('NCH-WTR', v.bottles || 0);
  if (station.id === 'WTR-CASES') add('NCH-WTR', (v.sealed_cases || 0) * CAL.case_size);
  if (station.id.startsWith('DISP-') && station.id !== 'DISP-BOT') {
    add('NCH-OB', v.osmania || 0); add('NCH-PS', v.samosa || 0); add('NCH-CC', v.cutlet || 0);
  }
  if (station.id === 'DISP-BOT') {
    const bags = v.bun_bags || 0, loose = v.bun_loose || 0;
    if (bags > 0 && CAL.bun_bag_size == null) warnings.push(`${bags} bun bags seen but bag size not calibrated`);
    else add('NCH-BUN', bags * (CAL.bun_bag_size || 0) + loose);
    if (bags === 0) add('NCH-BUN', loose);
  }
  return { counts, warnings };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;

  try {
    if (action === 'settle-stations') {
      return json({ success: true, stations: STATIONS.map(({ id, icon, name, law, skippable }) => ({ id, icon, name, law, skippable: !!skippable })), cal: CAL });
    }

    if (action === 'settle-photo' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const station = STATIONS.find(s => s.id === b.station);
      if (!station || !b.settle_id) return json({ success: false, error: 'station/settle_id invalid' }, 400);
      const now = new Date().toISOString();

      // "none today" skip for skippable stations — recorded, never silent
      if (b.skip && station.skippable) {
        await DB.prepare(`INSERT INTO anbar_settle_photos (settle_id, station, r2_key, verdict_json, conforms, by_person, created_at) VALUES (?,?,?,?,1,?,?)`)
          .bind(b.settle_id, station.id, null, JSON.stringify({ skipped: true, counts: {} }), person, now).run();
        return json({ success: true, station: station.id, skipped: true, counts: {} });
      }

      if (!b.image) return json({ success: false, error: 'image missing' }, 400);
      const key = `${now.slice(0, 10)}/${b.settle_id}/${station.id}-${Date.now()}.jpg`;
      const bytes = Uint8Array.from(atob(b.image), c => c.charCodeAt(0));
      await context.env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });

      const v = await visionVerdict(context.env, station, b.image);
      const { counts, warnings } = v.conforms ? verdictToCounts(station, v) : { counts: {}, warnings: [] };
      await DB.prepare(`INSERT INTO anbar_settle_photos (settle_id, station, r2_key, verdict_json, conforms, by_person, created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(b.settle_id, station.id, key, JSON.stringify({ ...v, counts, warnings }), v.conforms ? 1 : 0, person, now).run();
      return json({ success: true, station: station.id, conforms: !!v.conforms, reject_reason: v.reject_reason || null, counts, warnings });
    }

    if (action === 'settle-finish' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);

      // latest verdict per station for this settle
      const rows = (await DB.prepare(
        `SELECT station, verdict_json, conforms FROM anbar_settle_photos WHERE settle_id=? AND id IN
         (SELECT MAX(id) FROM anbar_settle_photos WHERE settle_id=? GROUP BY station)`
      ).bind(b.settle_id, b.settle_id).all()).results || [];
      const done = new Set(rows.filter(r => r.conforms).map(r => r.station));
      const missing = STATIONS.filter(s => !done.has(s.id)).map(s => s.name);
      if (missing.length) return json({ success: false, error: `stations not settled: ${missing.join(', ')}` }, 400);

      const totals = {}; const warnings = [];
      for (const r of rows) {
        const v = JSON.parse(r.verdict_json);
        for (const [code, q] of Object.entries(v.counts || {})) totals[code] = (totals[code] || 0) + q;
        warnings.push(...(v.warnings || []));
      }

      // write the counts — same table, same law as a human count, kind='photo'
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
