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
// timing = the payment-intelligence dimension (owner-defined):
//   'prepaid'    → amount is known AT ORDER; the app asks for payment THEN.
//   'on_receive' → amount comes with the BILL; the app asks AT RECEIVING.
//   'at_vendor'  → go-collect; paid on the spot at the shop.
const TRACKED = [
  { key: 'nazeer-water',   name: 'Nazeer Nadeem',            vpa: 'q101761866@ybl',           supplies: 'Water (Bisleri)', icon: '💧', timing: 'on_receive', channel: 'pay after receiving' },
  { key: 'ganga-buns',     name: 'Ganga Bakery',             vpa: 'paytmqr67bsov@ptys',       supplies: 'Buns',            icon: '🍞', timing: 'prepaid',    channel: 'PREPAID at order' },
  { key: 'suhail-cutlet',  name: 'Abdul Suhail',             vpa: '8971457998@hdfc',          supplies: 'Chicken Cutlets', icon: '🍗', timing: 'on_receive', channel: 'pay after receiving' },
  { key: 'krishna-samosa', name: 'Krishnamoorthi',           vpa: 'krishnamurhinisha@okaxis', supplies: 'Pyaaz Samosa',    icon: '🥟', timing: 'at_vendor',  channel: 'go-collect, pay at vendor' },
  { key: 'farooq-osmania', name: 'M Farooq Ahmed Siddique',  vpa: '7259834218@ibl',           supplies: 'Osmania Biscuit', icon: '🍪', timing: 'on_receive', channel: 'bulk → store room' },
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
      const reqId = r.meta.last_row_id;
      // WABA ping to the owner the moment a payment is asked — tap → PhonePe.
      const WA_TOKEN = context.env.WA_ACCESS_TOKEN, WA_PHONE = context.env.WA_PHONE_ID;
      if (WA_TOKEN && WA_PHONE) {
        const payUrl = `https://hnhotels.in/api/sauda-pay?action=go&id=${reqId}`;
        const msg = `💸 *Payment requested*\n${b.vendor_name} — ₹${Number(b.amount).toLocaleString('en-IN')}\n${b.note ? b.note + '\n' : ''}by ${person} · ${b.brand || 'NCH'}\n\nTap to pay (PhonePe):\n${payUrl}`;
        context.waitUntil(fetch(`https://graph.facebook.com/v21.0/${WA_PHONE}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: '917010426808', type: 'text', text: { body: msg } }),
        }).catch(() => {}));
      }
      return json({ success: true, id: reqId, at: now, by: person });
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

    // ── GO: the WhatsApp tap → PhonePe (NOT GPay — owner's rule).
    // WhatsApp can't deep-link upi:// directly, so this https hop 302s into
    // the phonepe:// scheme with vendor VPA + amount prefilled. Fallback page
    // shows buttons if the redirect is blocked.
    if (action === 'go') {
      const id = url.searchParams.get('id');
      const q = await DB.prepare(`SELECT * FROM rm_payment_requests WHERE id=?`).bind(id).first();
      if (!q) return new Response('request not found', { status: 404 });
      const pp = `phonepe://pay?pa=${encodeURIComponent(q.vpa)}&pn=${encodeURIComponent(q.vendor_name)}&am=${encodeURIComponent(Number(q.amount).toFixed(2))}&cu=INR&tn=${encodeURIComponent((q.brand || 'NCH') + ' ' + (q.note || ''))}`;
      const upi = 'upi' + pp.slice('phonepe'.length);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay ${q.vendor_name}</title>
        <style>body{background:#000;color:#f7f7fa;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:14px;text-align:center;padding:24px}
        a{display:block;width:100%;max-width:320px;padding:16px;border-radius:12px;font-weight:800;text-decoration:none;font-size:16px}
        .pp{background:#5f259f;color:#fff}.any{background:#1b1b24;color:#d4a24c;border:1px solid rgba(212,162,76,.4)}</style></head>
        <body><div style="font-size:28px;font-weight:800">₹${Number(q.amount).toLocaleString('en-IN')}</div>
        <div style="color:#9a9aa3">${q.vendor_name}${q.note ? ' · ' + q.note : ''}<br>${q.vpa || 'no VPA — pay manually'}</div>
        ${q.vpa ? `<a class="pp" href="${pp}">Open PhonePe</a><a class="any" href="${upi}">Any UPI app</a>` : ''}
        <div style="color:#5c5c66;font-size:12px">after paying, mark ✓ Paid in Sauda → 3·Pay</div>
        <script>${q.vpa ? `location.href=${JSON.stringify(pp)};` : ''}</script></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
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
