/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN HR Deductions — cash-shortage tracker
 * Route: /api/hr-deductions
 *
 * Settlement endpoints at outlets (NCH /api/settlement, future HE) post
 * here whenever a cash handover comes up short. We resolve the giver's
 * staff PIN via runner_staff_map or cashier_staff_map, insert a row
 * into hr_cash_shortages, and the monthly payroll run subtracts it.
 *
 * Actions:
 *   record-shortage   POST — outlets call this on variance < -threshold
 *   list              GET  — review shortages (filterable by pin, month, status)
 *   waive             POST — Nihaf-only, marks row waived=1 (no deduction)
 *   payroll-deduction GET  — sum of uncleared shortages per pin for a month
 *   alert-on-cap      GET  — flags anyone over monthly cap
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const MONTHLY_CAP = 5000;         // per-person-per-month alert threshold
const EXACT_TOLERANCE = 20;       // min variance to log (client should filter too)

// Only these PINs can waive shortages
const WAIVE_PINS = new Set(['0305', '5882']);   // Nihaf only

// Phones for escalation (fallback if DB phone not set)
const ESCALATION_PHONES = {
  basheer: '919061906916',
  nihaf:   '917010426808',
};

async function sendWA(env, toPhone, text) {
  try {
    const token = env.WA_ACCESS_TOKEN;
    const phoneId = env.WA_PHONE_ID;
    if (!token || !phoneId || !toPhone) return false;
    const clean = String(toPhone).replace(/\D/g, '').replace(/^91/, '');
    if (clean.length !== 10) return false;
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '91' + clean,
        type: 'text',
        text: { body: text.slice(0, 1024) },
      }),
    });
    return r.ok;
  } catch (e) { console.error('WA fail:', e.message); return false; }
}

async function fireShortageAlerts(env, DB, shortageRow, giverName, counterpartyName) {
  const amt = Math.round(shortageRow.amount);
  const tsIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

  // Pull phones for everyone involved
  const giverPhone = shortageRow.pin
    ? (await DB.prepare('SELECT phone FROM hr_employees WHERE pin = ?').bind(shortageRow.pin).first())?.phone
    : null;

  // Basheer (manager) — always alerted
  const managerText = `⚠ NCH SHORTAGE ₹${amt}\n` +
    `Source: ${shortageRow.source.replace(/_/g, ' ')}\n` +
    `From: ${giverName || shortageRow.unmapped_code || 'unknown'}\n` +
    `To: ${counterpartyName || '—'}\n` +
    `Time: ${tsIST}\n` +
    `→ Logged against PIN ${shortageRow.pin || 'UNMAPPED'} for salary deduction.`;
  await sendWA(env, ESCALATION_PHONES.basheer, managerText);

  // Giver (if phone known)
  if (giverPhone) {
    const giverText = `Cash short ₹${amt} flagged on your ${shortageRow.source.replace(/_/g, ' ')} at NCH.\n` +
      `Counterparty: ${counterpartyName || '—'}\n` +
      `Time: ${tsIST}\n\n` +
      `This will be deducted from your salary unless cleared. If incorrect, inform Basheer.`;
    await sendWA(env, giverPhone, giverText);
  }

  // Cap escalation to Nihaf if this person has crossed MONTHLY_CAP
  if (shortageRow.pin) {
    const r = await DB.prepare(
      `SELECT SUM(amount) AS total FROM hr_cash_shortages
        WHERE pin = ? AND cleared_at IS NULL AND waived = 0
          AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    ).bind(shortageRow.pin).first();
    if ((r?.total || 0) > MONTHLY_CAP) {
      await sendWA(env, ESCALATION_PHONES.nihaf,
        `🚨 ${giverName || shortageRow.pin} crossed monthly shortage cap: ₹${Math.round(r.total)} (cap ₹${MONTHLY_CAP}).\n` +
        `Review at hnhotels.in/ops/hr/ before next payroll.`);
    }
  }
}

async function resolvePinFromCode(DB, giverType, giverCode) {
  if (!giverCode) return null;
  if (giverType === 'runner') {
    const row = await DB.prepare('SELECT staff_pin FROM runner_staff_map WHERE runner_code = ?')
      .bind(giverCode).first();
    return row?.staff_pin || null;
  }
  if (giverType === 'cashier') {
    const row = await DB.prepare('SELECT staff_pin FROM cashier_staff_map WHERE cashier_code = ?')
      .bind(giverCode).first();
    return row?.staff_pin || null;
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const DB = env.DB;
  if (!DB) return json({ success: false, error: 'DB not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    // ── RECORD SHORTAGE ──────────────────────────────────────
    if (action === 'record-shortage' && request.method === 'POST') {
      const body = await request.json();
      const {
        source,          // 'runner_settle' | 'shift_handover' | 'cashier_collect'
        giver_type,      // 'runner' | 'cashier'
        giver_code,      // e.g. 'RUN002', 'CASH001'
        counterparty,    // e.g. 'CASH001', 'GM001 Basheer' — for context only
        amount,          // positive ₹ shortage
        brand,           // 'NCH' | 'HE'
        settlement_id,   // FK to outlet settlement row (optional)
        notes,
      } = body;

      if (!source || !giver_code || !amount || !brand) {
        return json({ success: false, error: 'source, giver_code, amount, brand required' }, 400);
      }
      if (amount < EXACT_TOLERANCE) {
        return json({ success: true, skipped: true, reason: `amount < ₹${EXACT_TOLERANCE} tolerance` });
      }

      const pin = await resolvePinFromCode(DB, giver_type, giver_code);
      const now = new Date().toISOString();
      const amt = Math.abs(parseFloat(amount));

      const { meta } = await DB.prepare(
        `INSERT INTO hr_cash_shortages
          (pin, unmapped_code, amount, brand, source, settlement_id, counterparty, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        pin, pin ? null : giver_code, amt, brand, source,
        settlement_id || null, counterparty || null, notes || null, now,
      ).run();

      // Resolve giver's HR name for alerts
      let giverName = null;
      if (pin) {
        const r = await DB.prepare('SELECT name FROM hr_employees WHERE pin = ?').bind(pin).first();
        giverName = r?.name;
      }

      // Fire WhatsApp alerts to Basheer + giver (+ Nihaf if over cap)
      const alertRow = {
        id: meta.last_row_id, pin, unmapped_code: pin ? null : giver_code,
        amount: amt, source, counterparty,
      };
      await fireShortageAlerts(env, DB, alertRow, giverName, counterparty);

      return json({
        success: true,
        id: meta.last_row_id,
        pin, unmapped: !pin,
        staff_name: giverName,
        amount: amt,
      });
    }

    // ── LIST (Basheer / Nihaf review) ────────────────────────
    if (action === 'list') {
      const pin = url.searchParams.get('pin');
      const month = url.searchParams.get('month');         // 'YYYY-MM'
      const status = url.searchParams.get('status') || 'open'; // open|cleared|waived|all

      let q = 'SELECT * FROM hr_cash_shortages WHERE 1=1';
      const args = [];
      if (pin) { q += ' AND pin = ?'; args.push(pin); }
      if (month) { q += ' AND strftime(\'%Y-%m\', created_at) = ?'; args.push(month); }
      if (status === 'open')    q += ' AND cleared_at IS NULL AND waived = 0';
      else if (status === 'cleared') q += ' AND cleared_at IS NOT NULL AND waived = 0';
      else if (status === 'waived')  q += ' AND waived = 1';
      q += ' ORDER BY created_at DESC LIMIT 500';

      const rows = await DB.prepare(q).bind(...args).all();

      // Enrich with staff name
      const pins = [...new Set(rows.results.map(r => r.pin).filter(Boolean))];
      const nameMap = {};
      if (pins.length) {
        const nameRows = await DB.prepare(
          `SELECT pin, name FROM hr_employees WHERE pin IN (${pins.map(() => '?').join(',')})`
        ).bind(...pins).all();
        for (const n of nameRows.results) nameMap[n.pin] = n.name;
      }

      return json({
        success: true,
        count: rows.results.length,
        shortages: rows.results.map(r => ({
          ...r,
          staff_name: r.pin ? nameMap[r.pin] : null,
          is_unmapped: !r.pin,
        })),
      });
    }

    // ── WAIVE (Nihaf only) ───────────────────────────────────
    if (action === 'waive' && request.method === 'POST') {
      const body = await request.json();
      const { id, pin: actorPin, reason } = body;
      if (!WAIVE_PINS.has(actorPin)) return json({ success: false, error: 'Only Nihaf can waive' }, 403);
      if (!id) return json({ success: false, error: 'id required' }, 400);

      const now = new Date().toISOString();
      await DB.prepare(
        `UPDATE hr_cash_shortages
            SET waived = 1, cleared_at = ?, cleared_by_pin = ?, notes = COALESCE(notes, '') || ?
          WHERE id = ?`
      ).bind(now, actorPin, ` | WAIVED: ${reason || 'no reason'}`, id).run();

      return json({ success: true, id });
    }

    // ── PAYROLL DEDUCTION — monthly sum per pin ──────────────
    if (action === 'payroll-deduction') {
      const pin = url.searchParams.get('pin');
      const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
      if (!pin) return json({ success: false, error: 'pin required' }, 400);

      const r = await DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM hr_cash_shortages
          WHERE pin = ?
            AND cleared_at IS NULL
            AND waived = 0
            AND strftime('%Y-%m', created_at) = ?`
      ).bind(pin, month).first();

      return json({
        success: true,
        pin, month,
        deduction: Math.round(r.total || 0),
        count: r.count || 0,
        over_cap: (r.total || 0) > MONTHLY_CAP,
      });
    }

    // ── CAP ALERTS — flag anyone > MONTHLY_CAP this month ────
    if (action === 'alert-on-cap') {
      const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
      const rows = await DB.prepare(
        `SELECT pin, SUM(amount) AS total, COUNT(*) AS count
           FROM hr_cash_shortages
          WHERE cleared_at IS NULL AND waived = 0
            AND strftime('%Y-%m', created_at) = ?
          GROUP BY pin
          HAVING total > ?
          ORDER BY total DESC`
      ).bind(month, MONTHLY_CAP).all();

      // Enrich with names
      const pins = rows.results.map(r => r.pin).filter(Boolean);
      const nameMap = {};
      if (pins.length) {
        const nameRows = await DB.prepare(
          `SELECT pin, name, phone FROM hr_employees WHERE pin IN (${pins.map(() => '?').join(',')})`
        ).bind(...pins).all();
        for (const n of nameRows.results) nameMap[n.pin] = n;
      }

      return json({
        success: true,
        month, cap: MONTHLY_CAP,
        flagged: rows.results.map(r => ({
          ...r,
          staff_name: nameMap[r.pin]?.name,
          staff_phone: nameMap[r.pin]?.phone,
        })),
      });
    }

    // ── MARK AS DEDUCTED (payroll clearing) ──────────────────
    if (action === 'mark-deducted' && request.method === 'POST') {
      const body = await request.json();
      const { pin, month, cleared_by_pin } = body;
      if (!pin || !month) return json({ success: false, error: 'pin and month required' }, 400);

      const now = new Date().toISOString();
      const { meta } = await DB.prepare(
        `UPDATE hr_cash_shortages
            SET cleared_at = ?, cleared_in_month = ?, cleared_by_pin = ?
          WHERE pin = ? AND cleared_at IS NULL AND waived = 0
            AND strftime('%Y-%m', created_at) = ?`
      ).bind(now, month, cleared_by_pin || 'payroll', pin, month).run();

      return json({ success: true, cleared_count: meta.changes });
    }

    return json({ success: false, error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack }, 500);
  }
}
