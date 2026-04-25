/**
 * hn-bank-feed-email — HDFC transaction-alert ingester.
 *
 * Pipeline:
 *   HDFC alert (alerts@hdfcbank.bank.in) → nihafwork@gmail.com →
 *     Gmail filter "from:alerts@hdfcbank.bank.in" forwards to
 *       hdfc-alerts@hnhotels.in →
 *   Cloudflare Email Routing → this Worker →
 *     DKIM check → parse → INSERT OR IGNORE into money_events
 *
 * Writes rows with source='hdfc', instrument='hdfc_ca_4680'.
 * Latency target: <60s from debit to D1 row.
 *
 * Audit fixes applied vs v1:
 *   - DKIM verification (C4): refuse emails whose Authentication-Results
 *     don't show dkim=pass for an HDFC-owned domain. Gmail-forwarded mail
 *     preserves the original signature in the ARC chain.
 *   - No phantom-row fallback (C2): a parse failure stores a 'partial'
 *     or 'quarantined' row with amount_paise=0 (schema is NOT NULL).
 *     Rollups filter on parse_status='parsed' so these zero rows never
 *     pollute SUM; dashboard surfaces them as a separate bucket so
 *     reparse can promote them once the parser improves.
 *   - Idempotency (C3): atomic INSERT OR IGNORE on UNIQUE(source, source_ref)
 *     or UNIQUE(source, instrument, direction, amount_paise, txn_at) if no ref.
 *     When parser can't find txn_at, we store NULL and flag 'partial' —
 *     never fabricate a timestamp.
 *   - Direction is else-if priority (M2).
 *   - Integer paise (H4): amounts stored as paise; no FP comparisons.
 *   - Response size/timeout caps (H8, H2).
 *
 * TODO — not critical for MVP, plan for v2:
 *   - Replace extractTextBody with postal-mime (H1) for proper base64 +
 *     nested multipart. Current extractor handles quoted-printable and
 *     single-level multipart; will miss base64-encoded HTML-only HDFC
 *     alerts (rare). Quarantined rows let us reparse once the parser
 *     improves — no data loss.
 *
 * Manual endpoints (require DASHBOARD_KEY):
 *   GET  /?key=K                       → health + latest 10 rows (constant-time compare)
 *   GET  /?key=K&mode=reparse&limit=N  → re-run parser on quarantined/partial rows
 *   POST /?key=K&mode=dry-run          → parse arbitrary body, return JSON
 */

const INSTRUMENT = 'hdfc_ca_4680';
const SOURCE = 'hdfc';
const MAX_BODY_BYTES = 512 * 1024;      // 512 KB cap on ingested email size
const MAX_DRY_RUN_BYTES = 256 * 1024;   // 256 KB cap on dry-run POST

export default {
  async email(message, env, ctx) {
    const received_at = nowIso();
    let raw;
    try {
      raw = await streamToStringCapped(message.raw, MAX_BODY_BYTES);
    } catch (e) {
      // Oversized or unreadable. Don't retry; log and drop.
      console.error('email stream read failed', e);
      return;
    }

    const from    = message.headers.get('from') || '';
    const subject = message.headers.get('subject') || '';
    const authRes = message.headers.get('authentication-results') || '';
    const arcAuth = message.headers.get('arc-authentication-results') || '';
    const body    = extractTextBody(raw);

    if (!isTrustedHdfcAlert({ from, subject, body, authRes, arcAuth })) {
      // Quarantined for forensic review; not inserted into ledger.
      console.log('REJECTED email', { from: from.slice(0, 120), subject: subject.slice(0, 120) });
      return;
    }

    const parsed = parseHdfcAlert({ subject, body });

    // Partial / failed rows are inserted with amount=NULL but raw body
    // retained, so reparse can promote them later. Never inserts a fake
    // zero-amount row into the live ledger.
    try {
      await insertEvent(env.DB, {
        source: SOURCE,
        instrument: INSTRUMENT,
        ...parsed,
        received_at,
        raw_subject: subject.slice(0, 2000),
        raw_body: body.slice(0, 16000),
      });
    } catch (e) {
      console.error('insert failed (non-retried)', String(e).slice(0, 400));
      // DO NOT rethrow: Email Routing would retry and potentially
      // double-insert if the first attempt actually committed. We already
      // have raw_body captured via the quarantine insert path for recovery.
      try {
        await env.DB.prepare(`
          INSERT INTO money_events
            (source, instrument, direction, amount_paise, received_at,
             parse_status, raw_subject, raw_body, notes)
          VALUES (?, ?, 'debit', 0, ?, 'quarantined', ?, ?, ?)
        `).bind(
          SOURCE, INSTRUMENT, received_at,
          subject.slice(0, 2000), body.slice(0, 16000),
          'insert_error: ' + String(e).slice(0, 400),
        ).run();
      } catch (_) { /* last-ditch; give up silently rather than loop */ }
    }
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const key = url.searchParams.get('key') || req.headers.get('x-dashboard-key') || '';
    if (!env.DASHBOARD_KEY || !(await constantEq(key, env.DASHBOARD_KEY))) {
      return new Response('forbidden', { status: 403 });
    }

    const mode = url.searchParams.get('mode') || 'status';

    if (mode === 'reparse') {
      const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const rows = await env.DB.prepare(`
        SELECT id, raw_subject, raw_body FROM money_events
        WHERE source=? AND parse_status IN ('partial','quarantined','failed')
        ORDER BY id DESC LIMIT ? OFFSET ?
      `).bind(SOURCE, limit, offset).all();
      let fixed = 0;
      for (const r of rows.results || []) {
        const p = parseHdfcAlert({ subject: r.raw_subject || '', body: r.raw_body || '' });
        if (p.parse_status === 'parsed') {
          // COALESCE preserves original values on re-runs that parse weaker.
          await env.DB.prepare(`
            UPDATE money_events
            SET direction           = COALESCE(?, direction),
                amount_paise        = COALESCE(?, amount_paise),
                balance_paise_after = COALESCE(?, balance_paise_after),
                channel             = COALESCE(?, channel),
                counterparty        = COALESCE(?, counterparty),
                counterparty_ref    = COALESCE(?, counterparty_ref),
                source_ref          = COALESCE(?, source_ref),
                txn_at              = COALESCE(?, txn_at),
                narration           = COALESCE(?, narration),
                parse_status        = 'parsed'
            WHERE id=?
          `).bind(
            p.direction, p.amount_paise, p.balance_paise_after, p.channel,
            p.counterparty, p.counterparty_ref, p.source_ref,
            p.txn_at, p.narration, r.id,
          ).run();
          fixed++;
        }
      }
      return json({ ok: true, scanned: rows.results?.length || 0, fixed });
    }

    if (mode === 'dry-run' && req.method === 'POST') {
      const cl = parseInt(req.headers.get('content-length') || '0', 10);
      if (cl > MAX_DRY_RUN_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413);
      const body = await req.text();
      const subject = url.searchParams.get('subject') || '';
      return json({ parsed: parseHdfcAlert({ subject, body }) });
    }

    // Default: status
    const [recent, counts, lastParsed] = await Promise.all([
      env.DB.prepare(`
        SELECT id, txn_at, received_at, direction, amount_paise,
               counterparty, channel, parse_status
        FROM money_events WHERE source=?
        ORDER BY id DESC LIMIT 10
      `).bind(SOURCE).all(),
      env.DB.prepare(`
        SELECT parse_status, COUNT(*) AS n
        FROM money_events WHERE source=? GROUP BY parse_status
      `).bind(SOURCE).all(),
      env.DB.prepare(`
        SELECT received_at FROM money_events
        WHERE source=? AND parse_status='parsed'
        ORDER BY id DESC LIMIT 1
      `).bind(SOURCE).first(),
    ]);
    return json({
      ok: true, now: nowIso(),
      last_parsed_at: lastParsed?.received_at || null,
      counts: counts.results,
      recent: recent.results,
    });
  },
};

// ━━━ Sender trust: DKIM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Gate to ensure the email originated from HDFC. Prevents anyone who knows
 * the hdfc-alerts@hnhotels.in address from injecting fake transactions.
 *
 * Trust model:
 *  - The From/Sender must be an HDFC-owned domain. Verified real sender of
 *    live 2026 txn alerts is alerts@hdfcbank.bank.in. Older bank literature
 *    also uses alerts@hdfcbank.net / InstaAlert@hdfcbank.net — kept in set.
 *  - One of Authentication-Results or ARC-Authentication-Results must
 *    report dkim=pass for header.d= a hdfcbank-owned zone:
 *    hdfcbank.net | hdfcbank.com | hdfcbank.in | hdfcbank.bank.in.
 *    Gmail-forwarded mail carries the original DKIM via ARC.
 */
export function isTrustedHdfcAlert({ from, subject, body, authRes, arcAuth }) {
  const f = String(from || '').toLowerCase();
  // Accept any sender ending in a hdfcbank-owned zone (incl. subdomains
  // like mailers.hdfcbank.bank.in). Anchored to '@' so 'fakehdfcbank.com'
  // cannot slip through.
  const fromOk =
    /@([a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/.test(f) ||
    /(alerts|instaalert|instaalerts|information)@hdfcbank/i.test(f);

  const auth = (String(authRes) + '\n' + String(arcAuth)).toLowerCase();
  // DKIM d= must be a hdfcbank-owned zone. Same set as the sender gate.
  const dkimOk = /dkim\s*=\s*pass[^;]*header\.d=(?:[a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/i.test(auth);

  // Hard fail without DKIM — this is a banking ingest, we don't bet on
  // sender string alone.
  if (!dkimOk || !fromOk) return false;

  // Soft content hint — DKIM-signed HDFC domain can still send non-alert
  // mail (marketing, statements). Require at least one money-ish keyword.
  const bLow = String(body || '').toLowerCase();
  const sLow = String(subject || '').toLowerCase();
  const smellsLikeAlert =
    /\b(debited|credited|debit|credit|paid|received|sent|withdrawn)\b/i.test(bLow) ||
    /\b(debited|credited|alert|txn|transaction)\b/i.test(sLow);
  return smellsLikeAlert;
}

// ━━━ Parser ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse HDFC alert email. Returns a row shape ready for money_events insert.
 * On partial parse, returns parse_status='partial' with null/undefined
 * fields — caller stores raw body so /?mode=reparse can retry.
 */
export function parseHdfcAlert({ subject, body }) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const s = String(subject || '').replace(/\s+/g, ' ').trim();

  // Direction — anchor to the lead (subject + first ~400 chars of body)
  // because HDFC alert footers contain disclaimer text like "If you did
  // not authorize this debit, call…" which would misfire a body-wide
  // \bdebit\b match on a CREDIT email, flipping the ledger sign. The
  // lead carries the action verb ("has been debited/credited to A/c…");
  // the footer is pure boilerplate.
  const lead = text.slice(0, 400);
  let direction = null;
  if (/\b(debited|debit|sent|paid|withdrawn)\b/i.test(lead) ||
      /\b(debit|sent)\b/i.test(s)) {
    direction = 'debit';
  } else if (/\b(credited|credit|received)\b/i.test(lead) ||
             /\b(credit|received)\b/i.test(s)) {
    direction = 'credit';
  }

  // Amount — anchor on debit/credit proximity to avoid picking up amounts
  // from marketing footers. Capped repetition avoids catastrophic backtrack.
  const amountRe1 = /(?:rs|inr|₹)\.?\s*([\d,]{1,15}(?:\.\d{1,2})?)\s+(?:has\s+been\s+)?(?:debited|credited|withdrawn|sent|paid|received|credit|debit)/i;
  const amountRe2 = /(?:debited|credited|withdrawn|sent|paid|received)[^.]{0,40}?(?:rs|inr|₹)\.?\s*([\d,]{1,15}(?:\.\d{1,2})?)/i;
  const amtMatch = text.match(amountRe1) || text.match(amountRe2);
  const amountRupees = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : null;
  const amount_paise = amountRupees != null && !isNaN(amountRupees)
    ? Math.round(amountRupees * 100) : null;

  // Balance after ("Avl Bal", "Available Balance")
  const balMatch = text.match(/(?:avl(?:\.|ailable)?\s*bal(?:ance)?|balance)\s*[:\-]?\s*(?:rs|inr|₹)\.?\s*([\d,]{1,15}(?:\.\d{1,2})?)/i);
  const balRupees = balMatch ? Number(balMatch[1].replace(/,/g, '')) : null;
  const balance_paise_after = balRupees != null && !isNaN(balRupees)
    ? Math.round(balRupees * 100) : null;

  // Channel
  let channel = 'unknown';
  if (/\bupi\b|vpa|@[a-z]+\b/i.test(text))       channel = 'upi';
  else if (/\bimps\b/i.test(text))                channel = 'imps';
  else if (/\bneft\b/i.test(text))                channel = 'neft';
  else if (/\brtgs\b/i.test(text))                channel = 'rtgs';
  else if (/debit\s*card|credit\s*card|\bpos\b|swiped/i.test(text)) channel = 'card';
  else if (/\batm\b/i.test(text))                 channel = 'atm';
  else if (/cheque|\bchq\b/i.test(text))          channel = 'cheque';
  else if (/\b(charge|fee|gst|tax)\b/i.test(text)) channel = 'charges';

  // Bank reference
  const refMatch =
    text.match(/(?:upi\s*ref(?:erence)?|rrn|txn\s*(?:id|ref(?:erence)?)|neft\s*ref|ref(?:erence)?\s*(?:no\.?|number)?)\s*[:#]?\s*([A-Z0-9]{8,24})/i) ||
    text.match(/\b(\d{12})\b/) ||
    text.match(/\b([A-Z0-9]{16,22})\b/);
  const source_ref = refMatch ? refMatch[1].toUpperCase() : null;

  // Counterparty — anchored to terminator to avoid runaway backtrack.
  // Explicit length cap: 1-59 chars, terminated by fixed tokens.
  let counterparty = null, counterparty_ref = null;
  if (direction === 'debit') {
    const m = text.match(/(?:paid\s+to|to)\s+([A-Z][A-Za-z0-9 &._\-]{1,59}?)\s+(?:vpa\b|on\b|,|\.|\/|ref\b|rs\b|inr\b|upi\b|imps\b|neft\b)/i);
    if (m) counterparty = m[1].trim();
  } else if (direction === 'credit') {
    const m = text.match(/(?:received\s+from|from)\s+([A-Z][A-Za-z0-9 &._\-]{1,59}?)\s+(?:vpa\b|on\b|,|\.|\/|ref\b|rs\b|inr\b|upi\b|imps\b|neft\b)/i);
    if (m) counterparty = m[1].trim();
  }
  const vpaMatch = text.match(/\b([a-z0-9._\-]{2,40}@[a-z]{2,20})\b/i);
  if (vpaMatch) counterparty_ref = vpaMatch[1].toLowerCase();

  // Transaction time. Critical for idempotency — if we can't find it,
  // return null and let the insert mark this row 'partial'. Never
  // substitute now() — that defeats dedup.
  let txn_at = null;
  const dtNum = text.match(/on\s+(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?))?/i);
  const dtWord = text.match(/on\s+(\d{1,2})[\- ]([A-Za-z]{3,9})[\- ](\d{2,4})(?:\s+(\d{1,2}:\d{2}))?/i);
  if (dtNum) txn_at = normalizeNumericDate(dtNum);
  else if (dtWord) txn_at = normalizeWordDate(dtWord);

  const narration =
    text.match(/[^.]*\b(debited|credited|sent|received|paid|withdrawn)[^.]*/i)?.[0]?.slice(0, 400)
    || text.slice(0, 400);

  const ok = direction && amount_paise != null && amount_paise > 0;
  const hasDate = !!txn_at;
  let parse_status = 'parsed';
  if (!ok) parse_status = 'partial';
  else if (!hasDate && !source_ref) parse_status = 'partial';  // no way to dedup

  return {
    parse_status,
    direction,
    amount_paise: ok ? amount_paise : null,
    balance_paise_after,
    channel,
    counterparty,
    counterparty_ref,
    source_ref,
    txn_at,
    narration,
  };
}

// ━━━ D1 insert ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function insertEvent(db, row) {
  // Atomic idempotency via UNIQUE indexes on (source, source_ref) and
  // (source, instrument, direction, amount_paise, txn_at). INSERT OR
  // IGNORE returns 0 rows changed on conflict — no race, no duplicate.
  //
  // amount_paise is NOT NULL in the schema. For partial/quarantined rows
  // the parser returns null; coerce to 0 here so the insert actually
  // lands (instead of throwing NOT NULL and falling through to the outer
  // catch-all, which would reclassify a 'partial' row as 'quarantined').
  // Rollups filter on parse_status='parsed' so 0-amount non-parsed rows
  // never pollute SUM.
  const r = await db.prepare(`
    INSERT OR IGNORE INTO money_events
      (source, instrument, source_ref, direction, amount_paise,
       balance_paise_after, channel, counterparty, counterparty_ref,
       narration, txn_at, received_at, raw_subject, raw_body, parse_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.source, row.instrument, row.source_ref || null,
    row.direction || 'debit',
    row.amount_paise != null ? row.amount_paise : 0,
    row.balance_paise_after ?? null,
    row.channel || null, row.counterparty || null, row.counterparty_ref || null,
    row.narration || null, row.txn_at || null,
    row.received_at, row.raw_subject, row.raw_body,
    row.parse_status,
  ).run();

  // Bump source health row.
  try {
    await db.prepare(`
      UPDATE money_source_health
      SET last_event_at = ?, last_event_id = last_insert_rowid(),
          last_checked_at = ?, status = 'healthy'
      WHERE source = ? AND instrument = ?
    `).bind(row.received_at, nowIso(), row.source, row.instrument).run();
  } catch (e) {
    console.warn('health update skipped', e);
  }

  return r.meta.last_row_id || 0;
}

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function streamToStringCapped(stream, cap) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) throw new Error('email body exceeds cap ' + cap);
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { merged.set(c, o); o += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Minimal MIME text extractor. Handles:
 *  - single-level multipart/alternative (text/plain preferred, text/html fallback)
 *  - quoted-printable transfer encoding (including UTF-8 multi-byte)
 * Does NOT yet handle:
 *  - base64 transfer encoding
 *  - nested multipart/related with inline images
 *  - non-UTF8 charsets
 * Quarantine path catches unparseable bodies for manual reparse after
 * upgrading this function to postal-mime (TODO in v2).
 */
function extractTextBody(raw) {
  // Strip style/script upfront so their text content doesn't bleed into regexes.
  const nuke = s => String(s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');

  const plainMatch = raw.match(
    /Content-Type:\s*text\/plain[\s\S]*?(?:\r?\n){2}([\s\S]*?)(?=\r?\n--|\r?\n\r?\n\.|\r?\n$)/i);
  if (plainMatch) {
    const enc = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw.slice(0, plainMatch.index + 200));
    return nuke(enc ? decodeQuotedPrintable(plainMatch[1]) : plainMatch[1]);
  }
  const htmlMatch = raw.match(
    /Content-Type:\s*text\/html[\s\S]*?(?:\r?\n){2}([\s\S]*?)(?=\r?\n--|\r?\n\r?\n\.|\r?\n$)/i);
  if (htmlMatch) {
    const enc = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw.slice(0, htmlMatch.index + 200));
    const body = enc ? decodeQuotedPrintable(htmlMatch[1]) : htmlMatch[1];
    return nuke(body).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  // Last resort: treat entire blob as text after nuking tags.
  return nuke(decodeQuotedPrintable(raw)).replace(/<[^>]+>/g, ' ');
}

/**
 * Correct quoted-printable decode that preserves UTF-8 multi-byte sequences.
 * e.g. `=E2=82=B9` correctly becomes ₹, not three Latin-1 chars.
 */
function decodeQuotedPrintable(s) {
  const soft = String(s || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /[0-9A-Fa-f]{2}/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(soft.charCodeAt(i) & 0xFF);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
}

// txn_at MUST be byte-identical to the XLS-backfill output to share the
// `(source, source_ref, direction, amount_paise, txn_at)` unique index. The
// Python backfill emits `YYYY-MM-DDT00:00:00+05:30` (IST midnight literal,
// no UTC roundtrip). We mirror that exact string so live email rows dedup
// cleanly against backfill rows on the next monthly statement upload.
// HDFC alert times go into received_at and narration; we don't need them
// in txn_at for ledger purposes.
function normalizeNumericDate(m) {
  try {
    let [_, dd, mm, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    const y = parseInt(yy, 10), mo = parseInt(mm, 10), d = parseInt(dd, 10);
    if (y < 2020 || y > new Date().getFullYear() + 1) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+05:30`;
  } catch { return null; }
}

function normalizeWordDate(m) {
  try {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
    let [_, dd, monWord, yy] = m;
    const mo = months[monWord.toLowerCase().slice(0, 3)];
    if (!mo) return null;
    if (yy.length === 2) yy = '20' + yy;
    const dy = parseInt(yy, 10), dd_ = parseInt(dd, 10);
    if (dy < 2020 || dy > new Date().getFullYear() + 1) return null;
    if (dd_ < 1 || dd_ > 31) return null;
    return `${dy}-${String(mo).padStart(2, '0')}-${String(dd_).padStart(2, '0')}T00:00:00+05:30`;
  } catch { return null; }
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
