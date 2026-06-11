// ═══════════════════════════════════════════════════════════════════════════
// SAUDA PAY — vendor payment requests with UPI deep-link (PhonePe/any UPI app)
// The purchase journey: Sauda places PO → vendor delivers → Anbar receives
// (timestamped) → Zoya raises a payment request here → payer taps PAY →
// phone opens the UPI app with vendor VPA + amount prefilled → mark paid.
//
// Layer-1 NCH vendors (closed set; VPAs verified from the bank feed 2026-06-11).
// Migrate into rm_vendors.vpa when the vendor table gets de-duplicated.
// ═══════════════════════════════════════════════════════════════════════════

const PINS = {
  '2026': 'Zoya', '0305': 'Nihaf', '8523': 'Bashir', '6890': 'Tanveer', '3754': 'Naveen',
};
const REQUESTERS = ['Zoya', 'Nihaf', 'Tanveer', 'Naveen'];   // who may raise a request
const PAYERS = ['Nihaf', 'Tanveer', 'Naveen', 'Bashir'];     // who may mark paid

// Tracked layer-1 vendors — payment-timing reality per owner (2026-06-11):
// buns are PREPAID at order; water/cutlets pay AFTER receiving; samosa is
// go-collect, paid at the vendor. Requests are therefore fully decoupled from
// receiving — Zoya raises them whenever that vendor's rhythm says so.
const TRACKED = [
  { key: 'nazeer-water',   name: 'Nazeer Nadeem',            vpa: 'q101761866@ybl',           supplies: 'Water (Bisleri)', icon: '💧', channel: 'pay after receiving' },
  { key: 'ganga-buns',     name: 'Ganga Bakery',             vpa: 'paytmqr67bsov@ptys',       supplies: 'Buns',            icon: '🍞', channel: 'PREPAID at order' },
  { key: 'suhail-cutlet',  name: 'Abdul Suhail',             vpa: '8971457998@hdfc',          supplies: 'Chicken Cutlets', icon: '🍗', channel: 'pay after receiving' },
  { key: 'krishna-samosa', name: 'Krishnamoorthi',           vpa: 'krishnamurhinisha@okaxis', supplies: 'Pyaaz Samosa',    icon: '🥟', channel: 'go-collect, pay at vendor' },
  { key: 'farooq-osmania', name: 'M Farooq Ahmed Siddique',  vpa: '7259834218@ibl',           supplies: 'Osmania Biscuit', icon: '🍪', channel: 'bulk → store room' },
];

// Known VPAs for the wider vendor book (verified from the bank-feed fingerprint
// work, 2026-06-06). Matched against rm_vendors by name fragment, lowercase.
const KNOWN_VPAS = [
  { match: 'bootha',       vpa: 'prabhurathi13@oksbi' },
  { match: 'manjunath',    vpa: 'q025257178@ybl' },
  { match: 'tabrez',       vpa: 'mdt93044@ybl' },
  { match: 'rupnath',      vpa: 'paytmqr6pdq3f@ptys' },
  { match: 'ashrafia',     vpa: 'q318394880@ybl' },
  { match: 'ashrafiya',    vpa: 'q318394880@ybl' },
  { match: 'siraj',        vpa: '9916374699ssa@ybl' },
  { match: 'nazeer',       vpa: 'q101761866@ybl' },
  { match: 'ganga',        vpa: 'paytmqr67bsov@ptys' },
  { match: 'suhail',       vpa: '8971457998@hdfc' },
  { match: 'krishnamoorthi', vpa: 'krishnamurhinisha@okaxis' },
  { match: 'farooq',       vpa: '7259834218@ibl' },
  { match: 'osmania',      vpa: '7259834218@ibl' },
];
function vpaFor(name) {
  const n = (name || '').toLowerCase();
  const hit = KNOWN_VPAS.find(k => n.includes(k.match));
  return hit ? hit.vpa : null;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;

  try {
    if (action === 'verify-pin') {
      const person = PINS[url.searchParams.get('pin')];
      return person ? json({ success: true, person, canRequest: REQUESTERS.includes(person), canPay: PAYERS.includes(person) })
                    : json({ success: false, error: 'Wrong PIN' });
    }

    // Full vendor book: tracked five pinned on top, then EVERY Sauda vendor
    // (de-duplicated by name) — all requestable even before their items are tracked.
    if (action === 'vendors') {
      const rows = (await DB.prepare(
        `SELECT key, name FROM rm_vendors WHERE is_active IS NULL OR is_active != 0 ORDER BY name`
      ).all()).results || [];
      const seen = new Set(TRACKED.map(t => t.name.toLowerCase()));
      const rest = [];
      for (const r of rows) {
        const nameKey = r.name.toLowerCase().trim();
        if (seen.has(nameKey)) continue;
        seen.add(nameKey);
        rest.push({ key: r.key, name: r.name, vpa: vpaFor(r.name), supplies: '', icon: '🏪', channel: '' });
      }
      return json({ success: true, vendors: [...TRACKED, ...rest] });
    }

    if (action === 'request' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person || !REQUESTERS.includes(person)) return json({ success: false, error: 'Not authorised to request payments' }, 401);
      if (!b.vendor_name || !(b.amount > 0)) return json({ success: false, error: 'vendor/amount invalid' });
      const vpa = b.vpa || vpaFor(b.vendor_name) || '';
      const now = new Date().toISOString();
      const r = await DB.prepare(
        `INSERT INTO rm_payment_requests (brand, vendor_key, vendor_name, vpa, amount, note, requested_by, requested_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(b.brand || 'NCH', b.vendor_key || '', b.vendor_name, vpa, b.amount, b.note || '', person, now).run();
      return json({ success: true, id: r.meta.last_row_id, at: now, by: person });
    }

    if (action === 'pending') {
      const rows = (await DB.prepare(
        `SELECT * FROM rm_payment_requests WHERE status='pending' ORDER BY requested_at ASC`
      ).all()).results || [];
      // Attach the UPI deep link server-side so the client never assembles money strings.
      for (const r of rows) {
        r.upi_link = r.vpa
          ? `upi://pay?pa=${encodeURIComponent(r.vpa)}&pn=${encodeURIComponent(r.vendor_name)}&am=${encodeURIComponent(r.amount.toFixed(2))}&cu=INR&tn=${encodeURIComponent((r.brand || 'NCH') + ' ' + (r.note || r.vendor_key || ''))}`
          : null;  // no VPA on file — payer pays manually in PhonePe, then marks paid
      }
      return json({ success: true, requests: rows });
    }

    if (action === 'mark-paid' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person || !PAYERS.includes(person)) return json({ success: false, error: 'Not authorised to mark paid' }, 401);
      const now = new Date().toISOString();
      await DB.prepare(
        `UPDATE rm_payment_requests SET status='paid', paid_by=?, paid_at=?, utr=? WHERE id=? AND status='pending'`
      ).bind(person, now, b.utr || '', b.id).run();
      return json({ success: true, at: now, by: person });
    }

    if (action === 'cancel' && context.request.method === 'POST') {
      const b = await context.request.json();
      const person = PINS[b.pin];
      if (!person || !REQUESTERS.includes(person)) return json({ success: false, error: 'Not authorised' }, 401);
      await DB.prepare(`UPDATE rm_payment_requests SET status='cancelled' WHERE id=? AND status='pending'`).bind(b.id).run();
      return json({ success: true });
    }

    if (action === 'history') {
      const rows = (await DB.prepare(
        `SELECT * FROM rm_payment_requests WHERE status!='pending' ORDER BY requested_at DESC LIMIT 40`
      ).all()).results || [];
      return json({ success: true, requests: rows });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
