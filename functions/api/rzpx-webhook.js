// RazorpayX payout webhook → the deterministic close of the payout loop.
// Razorpay POSTs payout.processed / payout.failed / payout.reversed events here.
// We validate the X-Razorpay-Signature (HMAC-SHA256 over the RAW body) against
// RAZORPAYX_WEBHOOK_SECRET, then write the final status + UTR back into Sauda and
// reconcile the linked order(s). Because WE initiated the payout, the webhook just
// closes the loop — no interpretation, no email parsing.

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await request.text();
  const sig = request.headers.get('X-Razorpay-Signature') || '';
  const ok = await verifyHmac(raw, sig, env.RAZORPAYX_WEBHOOK_SECRET || '');
  if (!ok) return new Response('invalid signature', { status: 401 });

  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400 }); }

  const db = env.DB;
  const payout = evt && evt.payload && evt.payload.payout && evt.payload.payout.entity;
  if (db && payout && payout.id) {
    await db.prepare(
      `UPDATE sauda_payout SET status=?, utr=?, fees_paise=?, tax_paise=?, failure_reason=?, updated_at=datetime('now') WHERE rzp_payout_id=?`
    ).bind(payout.status || null, payout.utr || null, payout.fees || null, payout.tax || null, payout.failure_reason || null, payout.id).run().catch(() => {});

    // when the money has actually moved, reconcile the linked order(s) with the UTR
    if (payout.status === 'processed') {
      const row = await db.prepare(`SELECT order_ids FROM sauda_payout WHERE rzp_payout_id=?`).bind(payout.id).first().catch(() => null);
      let ids = [];
      try { ids = JSON.parse((row && row.order_ids) || '[]'); } catch (e) { ids = []; }
      for (const id of ids) {
        await db.prepare(`UPDATE sauda_purchase SET status='PAID', bank_ref=?, reconciled_at=datetime('now') WHERE id=?`)
          .bind(payout.utr || payout.id, id).run().catch(() => {});
      }
    }
  }
  return new Response('ok', { status: 200 });
}

async function verifyHmac(raw, sig, secret) {
  if (!secret || !sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
