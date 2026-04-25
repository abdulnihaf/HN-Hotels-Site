/**
 * hn-gmail-poller — pulls HDFC alerts from Gmail directly into D1.
 *
 * Replaces the email-routing-based ingest path which was DMARC-rejected
 * by Cloudflare for Gmail-forwarded mail. We now poll Gmail every minute
 * via the Gmail API using a stored OAuth refresh token, fetch the raw
 * RFC822, parse, and write to the right D1.
 *
 * Two pipes in one worker:
 *   - Company  (A/c 4680, Card 7103) → D1 binding `DB`          → hn-hiring
 *   - Personal (A/c 4005, Card 8891) → D1 binding `DB_PERSONAL` → hn-personal-finance
 *
 * Idempotency:
 *   - Primary: Gmail label `bank-feed-processed` excludes already-processed
 *     messages from the search query.
 *   - Secondary: D1 unique index on (source, source_ref, direction,
 *     amount_paise, txn_at) catches dupes if the label apply silently
 *     failed on a previous run.
 *
 * Cron: every minute (within free-tier 5-cron cap).
 *
 * Secrets required:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_GMAIL_REFRESH_TOKEN
 *   DASHBOARD_KEY              (for manual GET trigger)
 */

const SOURCE = 'hdfc';
const INSTR_COMPANY  = 'hdfc_ca_4680';
const INSTR_PERSONAL = 'hdfc_sa_4005';
const PROCESSED_LABEL = 'bank-feed-processed';
const HDFC_FROM = '(alerts@hdfcbank.bank.in OR alerts@hdfcbank.net OR InstaAlert@hdfcbank.net OR instaalerts@hdfcbank.net)';
const TAIL_COMPANY  = '("XX4680" OR "ending 4680" OR "A/c 4680" OR "ending 7103" OR "ending xx7103" OR "ending XX7103")';
const TAIL_PERSONAL = '("XX4005" OR "ending 4005" OR "A/c 4005" OR "ending 8891" OR "ending xx8891" OR "ending XX8891")';
// Free-tier worker has a 50-subrequest cap per invocation. Each message
// costs ~3 subreqs (raw fetch + label apply + D1 insert), plus ~4 for
// poll setup (oauth refresh + labels list + 2 search queries). Cap at 10
// per pipe → 10×3 + 4 ≈ 34 worst-case for a one-pipe run; both pipes
// share one invocation budget, so cap at 6 per pipe = ~40 total. Bumps
// to 25 once on Workers Paid (1000 subreqs/invocation).
const MAX_PER_POLL = 6;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPoll(env).catch(e => console.error('cron poll failed', e)));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const key = url.searchParams.get('key') || req.headers.get('x-dashboard-key') || '';
    if (!env.DASHBOARD_KEY || !(await constantEq(key, env.DASHBOARD_KEY))) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const mode = url.searchParams.get('mode') || 'poll';
      // ?mode=drift — compare each balance snapshot against D1's running
      // balance for that date. Reveals txns that the bank executed but
      // didn't email about (today's Paytm ₹5,718 was a real example).
      if (mode === 'drift') {
        const company  = await computeDrift(env.DB,          INSTR_COMPANY);
        const personal = await computeDrift(env.DB_PERSONAL, INSTR_PERSONAL);
        return json({ ok: true, company, personal });
      }
      // ?mode=reconcile-manual — call after each XLS upload to merge any
      // MAN_* manual entries against the canonical XLS rows. For each
      // matching tuple (instrument, direction, amount_paise, date(txn_at)),
      // the MAN row is deleted (XLS row wins, since it has the real UTR
      // and bank-side narration). Returns count of deleted MAN rows.
      if (mode === 'reconcile-manual') {
        const company  = await reconcileManual(env.DB,          INSTR_COMPANY);
        const personal = await reconcileManual(env.DB_PERSONAL, INSTR_PERSONAL);
        return json({ ok: true, company, personal });
      }
      const debug = url.searchParams.get('debug') === '1';
      const result = await runPoll(env, debug);
      return json({ ok: true, ...result });
    } catch (e) {
      return json({ ok: false, error: String(e).slice(0, 500) }, 500);
    }
  },
};

// ━━━ Main poll loop ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runPoll(env, debug = false) {
  const t0 = Date.now();
  const access = await getAccessToken(env);
  const labelId = await ensureLabel(access, PROCESSED_LABEL);
  const company  = await processQuery(access, env.DB,          INSTR_COMPANY,  TAIL_COMPANY,  labelId, debug);
  const personal = await processQuery(access, env.DB_PERSONAL, INSTR_PERSONAL, TAIL_PERSONAL, labelId, debug);
  return {
    elapsed_ms: Date.now() - t0,
    company,
    personal,
  };
}

async function processQuery(access, db, instrument, tailFilter, labelId, debug = false) {
  if (!db) return { skipped: 'no_d1_binding' };
  // newer_than:1d — XLS backfill is the audit baseline for any txn older
  // than 24h. The poller's job is incremental top-up only; processing old
  // mails risks duplicate inserts because card-debit alerts don't carry a
  // UTR/RRN that we can use as source_ref, and our null-ref rows would not
  // dedup against the XLS rows (which DO have refs). Cap time window to
  // 24h so the role boundary is clean: live = poller, history = XLS.
  // newer_than:1d — sticking with a tight window after testing 7d showed
  // that "Account update" mails older than 24h include device-registration
  // / online-banking-login notices that the parser correctly classifies as
  // not-quite-txns but still inserts as partials, polluting D1 with
  // null-amount rows. The PROCESSED_LABEL filter handles dedup for any
  // re-processing within 24h, and if the poller is down >24h the OWNER
  // can do a manual catch-up by removing the label from any unprocessed
  // backlog. We accept this tradeoff over the alternative noise.
  const q = `${HDFC_FROM} ${tailFilter} newer_than:1d -label:${PROCESSED_LABEL}`;
  const ids = await listMessages(access, q, MAX_PER_POLL);
  let inserted = 0, dupes = 0, partials = 0, failed = 0, snapshots = 0;
  const reasons = [];   // { id, subject, reason } — populated only when debug=true
  for (const id of ids) {
    try {
      const raw = await getRawMessage(access, id);
      const { from, subject, body, authResults } = parseRfc822(raw);

      // Cheap sender + DKIM check before classifying as txn vs balance
      // summary. A balance-summary mail still needs to come from a trusted
      // HDFC sender — otherwise a phishing mail could poison the snapshot
      // table and trigger a false "drift detected" alert.
      const f = String(from || '').toLowerCase();
      const fromOk =
        /@([a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/.test(f) ||
        /(alerts|instaalert|instaalerts|information)@hdfcbank/i.test(f);
      const dkimOk = /dkim\s*=\s*pass[^;]*header\.[di]=@?(?:[a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/i.test(authResults || '');
      if (!fromOk || !dkimOk) {
        if (debug) reasons.push({ id, subject: (subject||'').slice(0,80), reason: !fromOk ? 'from_not_hdfc' : 'dkim_fail' });
        failed++;
        continue;
      }

      // Classify: balance-summary (route to snapshot table) vs txn alert.
      const snap = parseBalanceSummary({ subject, body });
      if (snap) {
        await upsertSnapshot(db, instrument, {
          ...snap,
          received_at: nowIso(),
          source_email_id: id,
          raw_subject: (subject || '').slice(0, 2000),
          raw_body: (body || '').slice(0, 16000),
        });
        await applyLabel(access, id, labelId);
        snapshots++;
        // Auto-trigger drift check the moment a fresh snapshot lands. This
        // is the moment we have a new audit anchor — defer it to a manual
        // ?mode=drift call and you'd never know about a bank-side drift
        // until someone opens the dashboard. checkDriftForDate inserts a
        // drift_log row only on non-zero drift (signal, not noise).
        const driftResult = await checkDriftForDate(db, instrument, snap.snapshot_date, snap.balance_paise);
        if (debug) reasons.push({ id, subject: (subject||'').slice(0,80), reason: `snapshot ${snap.snapshot_date} = ₹${(snap.balance_paise/100).toFixed(2)} drift=${driftResult.verdict}` });
        continue;
      }

      const trust = trustReason({ from, subject, body, authResults });
      if (trust !== 'ok') {
        if (debug) reasons.push({ id, subject: (subject||'').slice(0,80), reason: trust });
        console.log('rejected', trust, id, subject?.slice(0, 100));
        failed++;
        continue;
      }
      const parsed = parseHdfcAlert({ subject, body });
      const r = await insertEvent(db, {
        source: SOURCE,
        instrument,
        ...parsed,
        received_at: nowIso(),
        raw_subject: (subject || '').slice(0, 2000),
        raw_body: (body || '').slice(0, 16000),
      });
      if (r.changed) inserted++;
      else dupes++;
      if (parsed.parse_status !== 'parsed') partials++;
      if (debug && parsed.parse_status !== 'parsed') {
        reasons.push({ id, subject: (subject||'').slice(0,80), reason: 'partial: ' + JSON.stringify({ direction: parsed.direction, amount_paise: parsed.amount_paise, txn_at: parsed.txn_at, source_ref: parsed.source_ref }) });
      }
      await applyLabel(access, id, labelId);
    } catch (e) {
      if (debug) reasons.push({ id, reason: 'exception: ' + String(e).slice(0, 200) });
      console.error('message failed', id, String(e).slice(0, 300));
      failed++;
    }
  }
  if (inserted > 0 || dupes > 0) await bumpHealth(db, instrument);
  const summary = { matched: ids.length, inserted, dupes, snapshots, partials, failed };
  if (debug) summary.reasons = reasons;
  return summary;
}

// HDFC sends a "View: Account update" mail every morning whose body says
// "The available balance in your account ending XX4680 is Rs. INR X as of
// DD-MMM-YY". This is NOT a transaction — it's the daily-balance audit
// anchor that replaces the XLS upload in our flow. Returns null if the
// mail isn't a balance summary.
function parseBalanceSummary({ subject, body }) {
  if (!/account\s+update|available\s+balance/i.test(subject || '')) return null;
  const text = String(body || '').replace(/\s+/g, ' ');
  // Reject if there's a transaction verb in the lead — those are
  // IMPS/NEFT mails that ALSO mention a balance. Includes the full set
  // of HDFC verb variants (added, deducted, etc.) so a NEFT-credit mail
  // doesn't get mis-routed to the snapshot table.
  if (/\b(debited|credited|transferred|withdrawn|paid|sent|added|deducted|deposited|reversed)\b/i.test(text.slice(0, 600))) return null;
  const m = text.match(
    /available\s+balance[\s\S]{0,80}?\bis\s+(?:rs\.?\s*)?(?:inr\s+)?([\d,]+(?:\.\d{1,2})?)\s+as\s+of\s+(\d{1,2})[\- ]([A-Za-z]{3,9})[\- ](\d{2,4})/i,
  );
  if (!m) return null;
  const balance_paise = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
  if (!Number.isFinite(balance_paise) || balance_paise < 0) return null;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',sept:'09',oct:'10',nov:'11',dec:'12' };
  const mo = months[m[3].toLowerCase().slice(0, 3)];
  if (!mo) return null;
  let yy = m[4];
  if (yy.length === 2) yy = '20' + yy;
  const dd = String(parseInt(m[2], 10)).padStart(2, '0');
  const snapshot_date = `${yy}-${mo}-${dd}`;
  return { snapshot_date, balance_paise };
}

async function upsertSnapshot(db, instrument, row) {
  // INSERT OR REPLACE — last balance email of the day wins. They should
  // all be identical anyway (EOD reflects same closing across multiple
  // sends), but if HDFC ever revises mid-day we want the latest.
  await db.prepare(`
    INSERT INTO money_balance_snapshot
      (instrument, snapshot_date, balance_paise, received_at,
       source_email_id, raw_subject, raw_body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instrument, snapshot_date) DO UPDATE SET
      balance_paise = excluded.balance_paise,
      received_at   = excluded.received_at,
      source_email_id = excluded.source_email_id,
      raw_subject   = excluded.raw_subject,
      raw_body      = excluded.raw_body
  `).bind(
    instrument, row.snapshot_date, row.balance_paise, row.received_at,
    row.source_email_id || null, row.raw_subject || null, row.raw_body || null,
  ).run();
}

// Drift = bank's claimed end-of-day balance vs D1's running balance for
// that date. Logic: find the latest money_event row with balance_paise_after
// where txn_at is on or before snapshot_date end-of-day. If their balances
// disagree, we have drift — usually a txn the bank executed but didn't
// email about (today's Paytm ₹5,718 was the canonical example).
async function computeDrift(db, instrument) {
  if (!db) return { skipped: 'no_d1_binding' };
  const snaps = await db.prepare(`
    SELECT snapshot_date, balance_paise FROM money_balance_snapshot
    WHERE instrument = ?
    ORDER BY snapshot_date DESC
    LIMIT 14
  `).bind(instrument).all();

  const out = [];
  for (const s of (snaps.results || [])) {
    out.push(await checkDriftForDate(db, instrument, s.snapshot_date, s.balance_paise));
  }
  return out;
}

// Reconcile MAN_* manual entries against canonical XLS rows. Run this after
// every monthly XLS upload — the XLS row carries the real UTR + bank
// narration; the MAN row was a placeholder. Match by
// (instrument, direction, amount_paise, calendar-date) and delete the MAN
// row if a non-MAN row covers the same tuple.
async function reconcileManual(db, instrument) {
  if (!db) return { skipped: 'no_d1_binding' };
  // Find candidate dupe pairs: a MAN row plus a non-MAN row with the same
  // (instrument, direction, amount_paise, date(txn_at)). Prefer the
  // non-MAN row's source_ref, narration, and balance_paise_after.
  const candidates = await db.prepare(`
    SELECT m.id AS man_id, m.txn_at AS man_txn_at, m.amount_paise AS man_amount,
           m.direction AS man_dir, x.id AS xls_id, x.source_ref AS xls_ref
    FROM money_events m
    JOIN money_events x ON
      x.instrument = m.instrument
      AND x.direction = m.direction
      AND x.amount_paise = m.amount_paise
      AND substr(x.txn_at, 1, 10) = substr(m.txn_at, 1, 10)
      AND x.id != m.id
      AND (x.source_ref IS NULL OR x.source_ref NOT LIKE 'MAN_%')
    WHERE m.source_ref LIKE 'MAN_%'
      AND m.instrument = ?
      AND m.parse_status = 'parsed'
  `).bind(instrument).all();

  let deleted = 0;
  const keptIds = [];
  for (const c of (candidates.results || [])) {
    try {
      await db.prepare('DELETE FROM money_events WHERE id = ?').bind(c.man_id).run();
      deleted++;
      keptIds.push({ man_id_deleted: c.man_id, replaced_by_xls_id: c.xls_id, ref: c.xls_ref });
    } catch (e) {
      console.warn('manual reconcile skipped for id', c.man_id, String(e).slice(0, 200));
    }
  }
  return { instrument, manual_rows_deleted: deleted, replacements: keptIds };
}

// One drift-check pass for a specific (instrument, date, expected_balance).
// Returns the verdict and side-effect-logs to money_balance_drift only when
// drift is non-zero — keeps the drift log a SIGNAL table, not a heartbeat.
// |drift| < ₹1 (100 paise) counted as zero to absorb rounding flutter.
async function checkDriftForDate(db, instrument, snapshot_date, snapshot_paise) {
  const eod = `${snapshot_date}T23:59:59+05:30`;
  const lastBal = await db.prepare(`
    SELECT id, txn_at, balance_paise_after, counterparty, direction, amount_paise
    FROM money_events
    WHERE instrument = ?
      AND parse_status = 'parsed'
      AND balance_paise_after IS NOT NULL
      AND txn_at <= ?
    ORDER BY txn_at DESC, id DESC
    LIMIT 1
  `).bind(instrument, eod).first();

  const computed = lastBal?.balance_paise_after ?? null;
  const drift_paise = computed != null ? (snapshot_paise - computed) : null;
  const verdict = drift_paise == null ? 'no_data'
    : (Math.abs(drift_paise) < 100 ? 'ok' : 'DRIFT');

  const summary = {
    date: snapshot_date,
    bank_balance_rs: snapshot_paise / 100,
    computed_balance_rs: computed != null ? computed / 100 : null,
    drift_rs: drift_paise != null ? drift_paise / 100 : null,
    latest_event: lastBal ? {
      id: lastBal.id, txn_at: lastBal.txn_at,
      counterparty: lastBal.counterparty,
      direction: lastBal.direction,
      amount_rs: lastBal.amount_paise / 100,
    } : null,
    verdict,
  };

  // Persist drift only when it's a real signal — non-zero drift OR no_data.
  // verdict=ok is heartbeat noise; we'd accumulate one row per check
  // forever otherwise.
  if (verdict !== 'ok') {
    try {
      await db.prepare(`
        INSERT INTO money_balance_drift
          (instrument, snapshot_date, snapshot_paise, computed_paise, drift_paise, checked_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        instrument, snapshot_date, snapshot_paise,
        computed ?? 0, drift_paise ?? 0, nowIso(),
        verdict === 'no_data'
          ? 'no_balance_event_for_date — D1 has no balance_paise_after row at or before this date'
          : `drift ₹${(drift_paise/100).toFixed(2)} — bank says ₹${(snapshot_paise/100).toFixed(2)}, D1 latest balance is ₹${(computed/100).toFixed(2)} (event id ${lastBal.id})`,
      ).run();
    } catch (e) {
      console.warn('drift log skipped', String(e).slice(0, 200));
    }
  }

  return summary;
}

// Return 'ok' when trust gate passes, otherwise a reason string identifying
// which clause failed. Lets the debug endpoint diagnose silent rejections.
function trustReason({ from, subject, body, authResults }) {
  const f = String(from || '').toLowerCase();
  const fromOk =
    /@([a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/.test(f) ||
    /(alerts|instaalert|instaalerts|information)@hdfcbank/i.test(f);
  if (!fromOk) return 'from_not_hdfc';
  const dkimOk = /dkim\s*=\s*pass[^;]*header\.[di]=@?(?:[a-z0-9.-]+\.)?hdfcbank\.(net|com|in|bank\.in)\b/i.test(authResults || '');
  if (!dkimOk) return 'dkim_fail';
  const bLow = String(body || '').toLowerCase();
  const sLow = String(subject || '').toLowerCase();
  const smellsLikeAlert =
    /\b(debited|credited|debit|credit|paid|received|sent|withdrawn|added|deducted|deposited|transferred|reversed)\b/i.test(bLow) ||
    /\b(debited|credited|alert|txn|transaction|account update|view)\b/i.test(sLow);
  if (!smellsLikeAlert) return 'no_money_keywords';
  return 'ok';
}

// ━━━ OAuth ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_GMAIL_REFRESH_TOKEN) {
    throw new Error('missing OAuth secrets');
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('token refresh failed: ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  return j.access_token;
}

// ━━━ Gmail API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function gmailGet(access, path, params = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
  if (!r.ok) throw new Error(`gmail ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function gmailPost(access, path, body) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gmail ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function listMessages(access, q, maxResults) {
  const j = await gmailGet(access, 'messages', { q, maxResults: String(maxResults) });
  return (j.messages || []).map(m => m.id);
}

async function getRawMessage(access, id) {
  const j = await gmailGet(access, `messages/${id}`, { format: 'raw' });
  // raw is base64url-encoded RFC822
  return base64UrlDecodeToString(j.raw);
}

async function ensureLabel(access, name) {
  const list = await gmailGet(access, 'labels');
  const existing = (list.labels || []).find(l => l.name === name);
  if (existing) return existing.id;
  const created = await gmailPost(access, 'labels', {
    name,
    labelListVisibility: 'labelHide',  // keep it out of the sidebar clutter
    messageListVisibility: 'hide',
  });
  return created.id;
}

async function applyLabel(access, msgId, labelId) {
  return gmailPost(access, `messages/${msgId}/modify`, {
    addLabelIds: [labelId],
  });
}

// ━━━ RFC822 helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function base64UrlDecodeToString(s) {
  // Gmail raw uses URL-safe base64 without padding.
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function parseRfc822(raw) {
  // Split headers/body on first blank line. Gmail tends to use \r\n.
  const splitIdx = raw.indexOf('\r\n\r\n');
  const altIdx   = raw.indexOf('\n\n');
  const idx = splitIdx >= 0 ? splitIdx + 4 : (altIdx >= 0 ? altIdx + 2 : raw.length);
  const hdrBlock = raw.slice(0, idx);
  const bodyBlock = raw.slice(idx);
  // Unfold headers (lines starting with whitespace continue the prior header).
  const unfolded = hdrBlock.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const get = (name) => {
    const re = new RegExp('^' + name + '\\s*:\\s*(.*)$', 'i');
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };
  // Both Authentication-Results and ARC-Authentication-Results may appear,
  // possibly multiple times. Collect them all.
  const authResults = lines
    .filter(l => /^(authentication-results|arc-authentication-results)\s*:/i.test(l))
    .join(' | ')
    .toLowerCase();
  return {
    from: get('From'),
    subject: decodeMimeHeader(get('Subject')),
    body: extractTextBody(raw),  // run on full raw — handles multipart properly
    authResults,
  };
}

function decodeMimeHeader(s) {
  // Subjects sometimes use =?utf-8?B?...?= encoding. Best-effort.
  return String(s || '').replace(/=\?utf-8\?(B|Q)\?([^?]+)\?=/gi, (_, enc, val) => {
    try {
      if (enc.toUpperCase() === 'B') {
        const pad = val.length % 4 ? '='.repeat(4 - (val.length % 4)) : '';
        const bin = atob(val + pad);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      } else {
        return val.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
                  .replace(/_/g, ' ');
      }
    } catch { return val; }
  });
}

// ━━━ Sender trust (DKIM gate) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isTrustedHdfcAlert(args) {
  return trustReason(args) === 'ok';
}

// ━━━ Parser (verbatim from bank-feed-email worker; date emits IST literal) ━

function parseHdfcAlert({ subject, body }) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const s = String(subject || '').replace(/\s+/g, ' ').trim();

  const lead = text.slice(0, 400);
  let direction = null;
  // HDFC uses many verb variants across mail types:
  //   POS/UPI debit:  "Rs.X is debited from your HDFC Bank Debit Card..."
  //   IMPS debit:     "INR X has been debited from your account..."
  //   Online debit:   "Rs.X has been deducted from your Account..."
  //   NEFT credit:    "Rs.INR X has been successfully added to your account..."
  //   IMPS credit:    "INR X has been credited to your account..."
  // All variants must map to debit/credit cleanly.
  if (/\b(debited|debit|sent|paid|withdrawn|deducted|transferred)\b/i.test(lead) ||
      /\b(debit|sent|deducted)\b/i.test(s)) {
    direction = 'debit';
  } else if (/\b(credited|credit|received|added|deposited)\b/i.test(lead) ||
             /\b(credit|received|added)\b/i.test(s)) {
    direction = 'credit';
  }

  // Amount regex needs to handle:
  //   "Rs.760.12 is debited"      (single prefix Rs.)
  //   "INR 15,000.00 has been debited"  (single prefix INR)
  //   "Rs.INR 5,718.00 has been ... added"  (double prefix Rs.INR — yes really)
  //   "Rs. 22,500.00 has been deducted"
  // The currency-prefix part must allow either form, so we factor it.
  const amountRe1 = /(?:rs\.?\s*(?:inr\s+)?|inr\s+|₹\s*)([\d,]{1,15}(?:\.\d{1,2})?)\s+(?:is\s+|was\s+|will\s+be\s+|has\s+been\s+(?:successfully\s+)?)?(?:debited|credited|withdrawn|sent|paid|received|debit|credit|added|deducted|deposited|transferred|reversed)/i;
  const amountRe2 = /(?:debited|credited|withdrawn|sent|paid|received|added|deducted|deposited|transferred|reversed)[^.]{0,40}?(?:rs\.?\s*(?:inr\s+)?|inr\s+|₹\s*)([\d,]{1,15}(?:\.\d{1,2})?)/i;
  const amtMatch = text.match(amountRe1) || text.match(amountRe2);
  const amountRupees = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : null;
  const amount_paise = amountRupees != null && !isNaN(amountRupees)
    ? Math.round(amountRupees * 100) : null;

  // Balance after — handles multiple HDFC formats:
  //   "Avl Bal: Rs.X"             (terse SMS-style)
  //   "Available Balance Rs. X"   (older email)
  //   "Available Balance: INR X"
  //   "available balance in your account is Rs. INR X"  (NEFT credit emails)
  //   "Available Balance: INR X"  (IMPS emails)
  const balMatch = text.match(/(?:avl(?:\.|ailable)?\s*bal(?:ance)?|balance)(?:\s+in\s+your\s+account)?\s*(?:[:\-]|is)?\s*(?:rs\.?\s*(?:inr\s+)?|inr\s+|₹\s*)([\d,]{1,15}(?:\.\d{1,2})?)/i);
  const balRupees = balMatch ? Number(balMatch[1].replace(/,/g, '')) : null;
  const balance_paise_after = balRupees != null && !isNaN(balRupees)
    ? Math.round(balRupees * 100) : null;

  let channel = 'unknown';
  if (/\bupi\b|vpa|@[a-z]+\b/i.test(text))       channel = 'upi';
  else if (/\bimps\b/i.test(text))                channel = 'imps';
  else if (/\bneft\b/i.test(text))                channel = 'neft';
  else if (/\brtgs\b/i.test(text))                channel = 'rtgs';
  else if (/debit\s*card|credit\s*card|\bpos\b|swiped/i.test(text)) channel = 'card';
  else if (/\batm\b/i.test(text))                 channel = 'atm';
  else if (/cheque|\bchq\b/i.test(text))          channel = 'cheque';
  else if (/\b(charge|fee|gst|tax)\b/i.test(text)) channel = 'charges';

  const refMatch =
    text.match(/(?:upi\s*ref(?:erence)?|rrn|txn\s*(?:id|ref(?:erence)?)|neft\s*ref|ref(?:erence)?\s*(?:no\.?|number)?)\s*[:#]?\s*([A-Z0-9]{8,24})/i) ||
    text.match(/\b(\d{12})\b/) ||
    text.match(/\b([A-Z0-9]{16,22})\b/);
  const source_ref = refMatch ? refMatch[1].toUpperCase() : null;

  let counterparty = null, counterparty_ref = null;
  if (direction === 'debit') {
    const m = text.match(/(?:paid\s+to|to)\s+([A-Z][A-Za-z0-9 &._\-]{1,59}?)\s+(?:vpa\b|on\b|,|\.|\/|ref\b|rs\b|inr\b|upi\b|imps\b|neft\b)/i);
    if (m) counterparty = m[1].trim();
    // HDFC card debits: "...debited from your HDFC Bank Debit Card ending NNNN at MERCHANT on..."
    if (!counterparty) {
      const m2 = text.match(/at\s+([A-Z][A-Za-z0-9 &._\-]{1,59}?)\s+on\s/i);
      if (m2) counterparty = m2[1].trim();
    }
    // Online-banking debit: "for a Transfer to payee NAME via HDFC Bank Online Banking"
    if (!counterparty) {
      const m3 = text.match(/(?:transfer|payment)\s+to\s+(?:payee\s+)?([A-Z][A-Za-z0-9 &._\-]{1,79}?)\s+via\b/i);
      if (m3) counterparty = m3[1].trim();
    }
  } else if (direction === 'credit') {
    const m = text.match(/(?:received\s+from|from)\s+([A-Z][A-Za-z0-9 &._\-]{1,59}?)\s+(?:vpa\b|on\b|,|\.|\/|ref\b|rs\b|inr\b|upi\b|imps\b|neft\b)/i);
    if (m) counterparty = m[1].trim();
    // NEFT-credit "added to your account ending XX4680 from NEFT Cr-YESB...-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS..."
    if (!counterparty) {
      const m2 = text.match(/from\s+(?:NEFT\s+Cr-|IMPS-|RTGS-)?[A-Z0-9]+-([A-Z][A-Za-z0-9 &._\-]{1,79}?)\s+(?:on|\bPA\b|-HN HOTELS|REF|RRN)/i);
      if (m2) counterparty = m2[1].trim();
    }
  }
  const vpaMatch = text.match(/\b([a-z0-9._\-]{2,40}@[a-z]{2,20})\b/i);
  if (vpaMatch) counterparty_ref = vpaMatch[1].toLowerCase();

  // Date — emit IST midnight literal to match XLS backfill format byte-for-byte.
  let txn_at = null;
  const dtNum  = text.match(/on\s+(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/i);
  const dtWord = text.match(/on\s+(\d{1,2})[\- ]([A-Za-z]{3,9})[\- ,]?\s*(\d{2,4})/i);
  if (dtNum) txn_at = normalizeNumericDate(dtNum);
  else if (dtWord) txn_at = normalizeWordDate(dtWord);

  const narration =
    text.match(/[^.]*\b(debited|credited|sent|received|paid|withdrawn)[^.]*/i)?.[0]?.slice(0, 400)
    || text.slice(0, 400);

  const ok = direction && amount_paise != null && amount_paise > 0;
  const hasDate = !!txn_at;
  let parse_status = 'parsed';
  if (!ok) parse_status = 'partial';
  else if (!hasDate && !source_ref) parse_status = 'partial';

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

// ━━━ Body extraction (quoted-printable + simple multipart) ━━━

function extractTextBody(raw) {
  const nuke = s => String(s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  // Look for text/plain part first; fall back to text/html.
  const plain = raw.match(
    /Content-Type:\s*text\/plain[\s\S]*?(?:\r?\n){2}([\s\S]*?)(?=\r?\n--|\r?\n\r?\n\.|\r?\n$)/i);
  if (plain) {
    const enc = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw.slice(0, plain.index + 200));
    const b64 = /Content-Transfer-Encoding:\s*base64/i.test(raw.slice(0, plain.index + 200));
    let body = plain[1];
    if (enc) body = decodeQuotedPrintable(body);
    else if (b64) body = decodeBase64Body(body);
    return nuke(body);
  }
  const html = raw.match(
    /Content-Type:\s*text\/html[\s\S]*?(?:\r?\n){2}([\s\S]*?)(?=\r?\n--|\r?\n\r?\n\.|\r?\n$)/i);
  if (html) {
    const enc = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw.slice(0, html.index + 200));
    const b64 = /Content-Transfer-Encoding:\s*base64/i.test(raw.slice(0, html.index + 200));
    let body = html[1];
    if (enc) body = decodeQuotedPrintable(body);
    else if (b64) body = decodeBase64Body(body);
    return nuke(body).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  return nuke(decodeQuotedPrintable(raw)).replace(/<[^>]+>/g, ' ');
}

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

function decodeBase64Body(s) {
  try {
    const cleaned = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    const pad = cleaned.length % 4 ? '='.repeat(4 - (cleaned.length % 4)) : '';
    const bin = atob(cleaned + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch { return s; }
}

// ━━━ D1 insert (idempotent) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function insertEvent(db, row) {
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

  // NB: source_health update intentionally NOT done here — it would cost
  // one D1 subrequest per message, which blows the free-tier 50-subreq
  // cap. Caller batches a single health update at end of poll.
  return { changed: r.meta.changes > 0 };
}

async function bumpHealth(db, instrument) {
  try {
    await db.prepare(`
      UPDATE money_source_health
      SET last_event_at = ?, last_checked_at = ?, status = 'healthy'
      WHERE source = ? AND instrument = ?
    `).bind(nowIso(), nowIso(), 'hdfc', instrument).run();
  } catch (e) {
    console.warn('health update skipped', String(e).slice(0, 200));
  }
}

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
