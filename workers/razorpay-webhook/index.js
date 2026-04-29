/**
 * hn-razorpay-webhook — real-time Razorpay event ingester.
 *
 * ARCHITECTURE PIVOT 2026-04-23: Razorpay is a settlement intermediary,
 * not a money source. Razorpay balance is not where the business owns
 * money — it's a hold until IMPS settlement lands in HDFC. Writing
 * Razorpay rows into money_events double-counts every rupee (once as
 * customer payment, once as HDFC IMPS settlement). The money ledger
 * now tracks ONLY the two bank accounts: HDFC CA 4680 + Federal SA 4510.
 *
 * This worker is retained for:
 *   - Signature verification smoke test (Razorpay still POSTs here)
 *   - Future: writing to a separate razorpay_payments table for order-
 *     level reconciliation (map payment_id → eventual HDFC IMPS credit)
 *
 * For now it validates signature, logs, and 200s without DB writes.
 * Re-enable ingest by flipping INGEST_TO_MONEY_EVENTS = true when the
 * separate razorpay_payments table is introduced.
 *
 * Razorpay webhook contract:
 *   https://razorpay.com/docs/webhooks/
 *   Header X-Razorpay-Signature = hex(HMAC-SHA256(secret, raw_body))
 *   Header X-Razorpay-Event-Id — we use it as source_ref for idempotency.
 *
 * Endpoints:
 *   POST /                        — Razorpay delivery endpoint (public)
 *   GET  /?key=K                  — health + latest 10 rows (DASHBOARD_KEY)
 *   GET  /?key=K&mode=retry-failed — replays rows stuck in 'quarantined'
 */

const SOURCE = 'razorpay';
const INSTRUMENT = 'razorpay_balance';
const MAX_BODY_BYTES = 64 * 1024; // Razorpay webhooks are ~3-5 KB

// Pivot 2026-04-23: don't write to money_events. See header docstring.
// Flip to true once razorpay_payments table lands.
const INGEST_TO_MONEY_EVENTS = false;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Webhook delivery
    if (req.method === 'POST' && !url.searchParams.has('mode')) {
      return handleWebhook(req, env);
    }

    // Admin endpoints
    const key = url.searchParams.get('key') || req.headers.get('x-dashboard-key') || '';
    if (!env.DASHBOARD_KEY || !(await constantEq(key, env.DASHBOARD_KEY))) {
      return new Response('forbidden', { status: 403 });
    }

    const mode = url.searchParams.get('mode') || 'status';

    if (mode === 'status') {
      const [recent, counts, lastSeen] = await Promise.all([
        env.DB.prepare(`
          SELECT id, txn_at, direction, amount_paise, counterparty, channel,
                 source_ref, parse_status
          FROM money_events WHERE source=?
          ORDER BY id DESC LIMIT 10
        `).bind(SOURCE).all(),
        env.DB.prepare(`
          SELECT parse_status, COUNT(*) AS n FROM money_events
          WHERE source=? GROUP BY parse_status
        `).bind(SOURCE).all(),
        env.DB.prepare(`
          SELECT received_at FROM money_events
          WHERE source=? ORDER BY id DESC LIMIT 1
        `).bind(SOURCE).first(),
      ]);
      return json({
        ok: true, now: nowIso(),
        last_event_at: lastSeen?.received_at || null,
        counts: counts.results,
        recent: recent.results,
      });
    }

    return json({ ok: false, error: 'unknown_mode' }, 400);
  },
};

// ━━━ Webhook handler ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleWebhook(req, env) {
  const cl = parseInt(req.headers.get('content-length') || '0', 10);
  if (cl > MAX_BODY_BYTES) return new Response('payload too large', { status: 413 });

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-razorpay-signature') || '';
  const eventId   = req.headers.get('x-razorpay-event-id') || null;

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('RAZORPAY_WEBHOOK_SECRET not set; refusing all webhooks');
    return new Response('webhook not configured', { status: 503 });
  }

  const valid = await verifySignature(rawBody, sigHeader, env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) {
    console.warn('invalid razorpay signature', { eventId, sigLen: sigHeader.length });
    return new Response('invalid signature', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch (e) { return new Response('bad json', { status: 400 }); }

  const event = payload.event || 'unknown';

  // Architecture pivot 2026-04-23: do NOT write to money_events.
  // Slice B (sales-recon) addition 2026-04-29: when the captured payment
  // carries a qr_code_id matching razorpay_qr_registry, write to
  // razorpay_qr_collections. money_events stays untouched. Webhook =
  // real-time path, REST poll in spend-sync-cron = safety net.
  if (event === 'payment.captured') {
    try {
      await ingestQrCapture(env, payload, eventId);
    } catch (e) {
      console.error('qr ingest failed (will retry via REST poll)', String(e).slice(0, 300));
    }
  }
  if (!INGEST_TO_MONEY_EVENTS) {
    console.log('razorpay event received (qr-only ingest)', { event, eventId });
    return new Response('ok (qr-only ingest)', { status: 200 });
  }

  // Events the Razorpay webhook carries — we handle the ones affecting
  // the balance ledger. Unknown events log + 200 so Razorpay doesn't retry.
  const row = mapEventToRow(event, payload);

  if (!row) {
    // Event we don't track (e.g. payment.failed) — store a quarantined marker
    // for visibility, but don't touch the ledger.
    try {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO money_events
          (source, instrument, source_ref, direction, amount_paise,
           received_at, channel, counterparty, narration,
           raw_payload, parse_status)
        VALUES (?, ?, ?, 'debit', 0, ?, 'unknown', 'razorpay-event', ?, ?, 'quarantined')
      `).bind(
        SOURCE, INSTRUMENT, eventId || `evt_${Date.now()}`, nowIso(),
        event, rawBody.slice(0, 8000),
      ).run();
    } catch {}
    return new Response('ok (ignored event)', { status: 200 });
  }

  const received_at = nowIso();
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO money_events
        (source, instrument, source_ref, direction, amount_paise,
         channel, counterparty, counterparty_ref, narration,
         txn_at, received_at, raw_payload, parse_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed')
    `).bind(
      SOURCE,
      row.instrument,
      row.source_ref,
      row.direction,
      row.amount_paise,
      row.channel,
      row.counterparty,
      row.counterparty_ref,
      row.narration,
      row.txn_at,
      received_at,
      rawBody.slice(0, 16000),
    ).run();

    // Bump source health
    try {
      await env.DB.prepare(`
        UPDATE money_source_health
        SET last_event_at = ?, last_checked_at = ?, status = 'healthy'
        WHERE source = ? AND instrument = ?
      `).bind(received_at, received_at, SOURCE, row.instrument).run();
    } catch {}

    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('razorpay insert failed', String(e).slice(0, 400));
    // Do NOT rethrow — Razorpay retries aggressively and we don't want
    // duplicate inserts if the first partial-commit actually landed.
    return new Response('recorded-with-error', { status: 200 });
  }
}

// ━━━ QR collections ingest (sales-recon Slice B) ━━━━━━━━━━━━
// Razorpay's payment.captured payload carries `entity` for the payment
// itself; for QR-originated payments, the entity has a `qr_code_id`
// field set to the QR's id (and may also include `notes.qr_code_id` if
// the merchant configured it). Match against razorpay_qr_registry; if
// no match, skip silently (REST poll will catch unregistered QR
// payments later if/when their QR gets registered).
async function ingestQrCapture(env, payload, eventId) {
  const pay = payload?.payload?.payment?.entity;
  if (!pay) return;
  const qrId = pay.qr_code_id || pay.notes?.qr_code_id;
  if (!qrId) return;

  const reg = await env.DB.prepare(
    `SELECT qr_code_id, brand, role, active FROM razorpay_qr_registry WHERE qr_code_id = ?`
  ).bind(qrId).first();
  if (!reg || !reg.active) return;

  const capTs = pay.captured_at || pay.created_at;
  const isoCap = new Date(capTs * 1000).toISOString();
  const istDay = new Date(capTs * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO razorpay_qr_collections (
       razorpay_payment_id, qr_code_id, brand, role,
       amount_paise, fee_paise, tax_paise, status, method,
       vpa, contact, captured_at, captured_at_day,
       synced_at, synced_via, raw_payload, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'webhook', ?, ?)
     ON CONFLICT(razorpay_payment_id) DO UPDATE SET
       amount_paise = excluded.amount_paise,
       status       = excluded.status,
       synced_at    = excluded.synced_at`
  ).bind(
    pay.id, qrId, reg.brand, reg.role,
    pay.amount || 0, pay.fee || 0, pay.tax || 0,
    pay.status || 'unknown', pay.method || null,
    pay.vpa || null, pay.contact || null,
    isoCap, istDay,
    new Date().toISOString(),
    JSON.stringify(pay).slice(0, 8000),
    eventId ? `event_id=${eventId}` : null
  ).run();
}

// ━━━ Event mapper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function mapEventToRow(event, payload) {
  const p = payload.payload || {};
  const now = new Date().toISOString();

  // Helper: Razorpay uses `created_at` seconds-epoch; build ISO.
  const tsFromObj = (o) => o?.created_at ? new Date(o.created_at * 1000).toISOString() : now;

  switch (event) {
    case 'payment.captured': {
      const pay = p.payment?.entity || {};
      return {
        instrument: INSTRUMENT,
        source_ref: pay.id || null,
        direction: 'credit',
        amount_paise: Number(pay.amount || 0),    // Razorpay already gives paise
        channel: mapMethodToChannel(pay.method),
        counterparty: pay.notes?.customer_name || pay.email || pay.contact || 'Razorpay customer',
        counterparty_ref: pay.vpa || pay.email || pay.contact || null,
        narration: `payment.captured · ${pay.description || pay.id || ''}`.slice(0, 400),
        txn_at: tsFromObj(pay),
      };
    }
    case 'refund.processed': {
      const rfd = p.refund?.entity || {};
      return {
        instrument: INSTRUMENT,
        source_ref: rfd.id || null,
        direction: 'debit',
        amount_paise: Number(rfd.amount || 0),
        channel: 'refund',
        counterparty: 'Refund to customer',
        counterparty_ref: rfd.payment_id || null,
        narration: `refund.processed · ${rfd.notes?.reason || rfd.id || ''}`.slice(0, 400),
        txn_at: tsFromObj(rfd),
      };
    }
    case 'payout.processed': {
      const po = p.payout?.entity || {};
      return {
        instrument: INSTRUMENT,
        source_ref: po.id || null,
        direction: 'debit',
        amount_paise: Number(po.amount || 0),
        channel: 'payout',
        counterparty: po.notes?.beneficiary_name || po.fund_account_id || 'Razorpay payout',
        counterparty_ref: po.utr || po.reference_id || null,
        narration: `payout.processed · ${po.purpose || po.id || ''}`.slice(0, 400),
        txn_at: tsFromObj(po),
      };
    }
    case 'payout.reversed': {
      const po = p.payout?.entity || {};
      return {
        instrument: INSTRUMENT,
        source_ref: (po.id || '') + '_reversed',
        direction: 'credit',
        amount_paise: Number(po.amount || 0),
        channel: 'payout_reversed',
        counterparty: po.notes?.beneficiary_name || 'Payout reversal',
        counterparty_ref: po.utr || null,
        narration: `payout.reversed · ${po.id}`,
        txn_at: tsFromObj(po),
      };
    }
    case 'settlement.processed': {
      const st = p.settlement?.entity || {};
      return {
        instrument: INSTRUMENT,
        source_ref: st.id || null,
        direction: 'debit',
        amount_paise: Number(st.amount || 0),
        channel: 'settlement',
        counterparty: 'Settlement to HDFC',
        counterparty_ref: st.utr || null,
        narration: `settlement.processed · UTR ${st.utr || st.id || ''}`.slice(0, 400),
        txn_at: tsFromObj(st),
      };
    }
    // payment.failed, payment.authorized, order.paid, subscription.* — ignored
    default:
      return null;
  }
}

function mapMethodToChannel(m) {
  if (!m) return 'unknown';
  const x = String(m).toLowerCase();
  if (x === 'upi') return 'upi';
  if (x === 'card') return 'card';
  if (x === 'netbanking') return 'netbanking';
  if (x === 'wallet') return 'wallet';
  if (x === 'emi') return 'emi';
  if (x === 'bank_transfer' || x === 'neft' || x === 'imps' || x === 'rtgs') return x;
  return 'unknown';
}

// ━━━ Signature verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function verifySignature(rawBody, expectedHex, secret) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const computedHex = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return await constantEq(computedHex, expectedHex.toLowerCase());
  } catch (e) {
    console.error('sig verify threw', e);
    return false;
  }
}

async function constantEq(a, b) {
  const A = String(a || ''), B = String(b || '');
  if (A.length !== B.length) return false;
  let r = 0;
  for (let i = 0; i < A.length; i++) r |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return r === 0;
}

function nowIso() { return new Date().toISOString(); }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
