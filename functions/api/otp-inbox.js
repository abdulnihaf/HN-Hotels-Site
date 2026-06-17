// ═══════════════════════════════════════════════════════════════════════════
// OTP inbox — the private relay that lets the Sauda login driver log into
// purchase portals hands-free.
//
//   POST /api/otp-inbox?t=<TOKEN>   { text, sender?, source?, platform? }
//        ← the iPhone Shortcut posts every OTP SMS here (and an email watcher
//          can post email OTPs). We extract the code, guess the portal, store it.
//
//   GET  /api/otp-inbox?t=<TOKEN>[&platform=hyperpure][&consume=1]
//        ← the login driver on hn-rtx-worker reads the freshest unconsumed code
//          (≤5 min old). consume=1 marks it used (single-use).
//
// Auth: capability token `t` must equal OTP_INGEST_TOKEN (falls back to
// DASHBOARD_KEY). Codes self-expire (TTL 5 min) and are single-use.
// This is a low-privilege relay for the owner's OWN accounts, by his explicit
// instruction — built safe (short TTL, single-use, token-gated), never logs the
// token, keeps raw text only for forensics.
// ═══════════════════════════════════════════════════════════════════════════

const TTL_MS = 5 * 60 * 1000;

const PLATFORM_HINTS = [
  ['hyperpure', /hyperpure/i],
  ['zepto', /zepto/i],
  ['blinkit', /blink ?it|grofers/i],
  ['instamart', /instamart|swiggy/i],
  ['bigbasket', /big ?basket|bbnow|bb /i],
  ['jiomart', /jio ?mart|reliance/i],
  ['amazon', /amazon/i],
  ['flipkart', /flipkart|minutes/i],
  ['dmart', /dmart|avenue/i],
  ['metro', /metro/i],
];

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function guessPlatform(s) {
  const hay = String(s || '').toLowerCase();
  for (const [name, re] of PLATFORM_HINTS) if (re.test(hay)) return name;
  return 'unknown';
}
function extractOtp(text) {
  const t = String(text || '');
  // prefer a 4–8 digit run that looks like a code (avoid phone numbers via word boundaries + length)
  const m = t.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;
  const expected = env.OTP_INGEST_TOKEN || env.DASHBOARD_KEY;
  const t = url.searchParams.get('t') || request.headers.get('x-otp-token') || '';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!db) return json({ error: 'DB binding missing' }, 500);
  if (!expected || t !== expected) return json({ error: 'unauthorized' }, 401);

  const nowIso = new Date().toISOString();

  try {
    // ── INGEST (iPhone Shortcut / email watcher) ──
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const text = body.text || body.message || '';
      const otp = extractOtp(text);
      if (!otp) return json({ ok: false, error: 'no code found in text' }, 422);
      const platform = (body.platform && String(body.platform).toLowerCase()) || guessPlatform(`${body.sender || ''} ${text}`);
      const source = body.source === 'email' ? 'email' : 'sms';
      await db.prepare(
        `INSERT INTO otp_inbox (platform, otp, sender, raw, source, received_at) VALUES (?,?,?,?,?,?)`
      ).bind(platform, otp, String(body.sender || '').slice(0, 120), String(text).slice(0, 500), source, nowIso).run();
      return json({ ok: true, platform, code_len: otp.length });
    }

    // ── READ (login driver on the box) ──
    if (request.method === 'GET') {
      const platform = (url.searchParams.get('platform') || '').toLowerCase();
      const cutoff = new Date(Date.now() - TTL_MS).toISOString();
      const where = platform ? `AND platform = ?` : '';
      const binds = platform ? [cutoff, platform] : [cutoff];
      const row = await db.prepare(
        `SELECT id, platform, otp, received_at FROM otp_inbox
          WHERE consumed_at IS NULL AND received_at >= ? ${where}
          ORDER BY received_at DESC LIMIT 1`
      ).bind(...binds).first();
      if (!row) return json({ ok: true, otp: null, note: 'no fresh code' });
      if (url.searchParams.get('consume') === '1') {
        await db.prepare(`UPDATE otp_inbox SET consumed_at = ? WHERE id = ?`).bind(nowIso, row.id).run();
      }
      return json({ ok: true, otp: row.otp, platform: row.platform, received_at: row.received_at });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}
