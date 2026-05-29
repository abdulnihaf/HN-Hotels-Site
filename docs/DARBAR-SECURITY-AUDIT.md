# Darbar — Production Security Audit (PII-grade)

> Darbar holds salary, phone, Aadhaar-adjacent identity, biometric PINs and the cash
> advance ledger. It is audited here as an attacker would: every API surface, every D1
> read, every WABA outbound, every Odoo write. Ranked **P0 / P1 / P2**. Every P0 ships in
> code before the class is left.
>
> Surface reality (correcting the brief): Darbar is **Cloudflare Pages Functions** on the
> `hn-hotels-site` project — not a standalone Worker. "Secrets bound to the Darbar Worker"
> = Pages project secrets. The PWA also calls shared endpoints `/api/hr-admin` and
> `/api/hr-payroll` (used by the superseded `/ops/hr`), so their auth is in Darbar's blast radius.

---

## CLASS 1 — Authentication / Authorisation

Fixed: PR #289 (commit b988088), verified live.

### P0-1 — The entire read surface was unauthenticated. PII was world-readable. CLOSED
**Proven, live, no credentials:**
```
$ curl 'https://darbar.hnhotels.in/api/darbar?action=home'
→ exceptions[].{ name:"B Aadil Ahmed", monthly_salary:18000, phone:"9994885263", pin:"25" }  …×13
```
- `functions/api/darbar.js` `onRequest`: `GET home` and `GET/POST reconcile` had **no auth gate**. `home` returned the full exception inbox — every departed employee's name, monthly salary, daily rate, phone, and biometric PIN, plus ghost-PIN punch history.
- **The PIN gate was client-side only.** `ops/darbar/app.js` held a `USERS` map and checked the typed PIN in the browser. The server never verified it. Anyone who hit the API directly — skipping the PWA entirely — was fully unauthenticated.
- `CORS: access-control-allow-origin: *` → any website in any browser could `fetch()` this PII.
- **Same flaw on the shared reads the PWA used:** `functions/api/hr-admin.js` `handleGet` (line 248) took `pin` only to decide *financial redaction* — and the default was **expose**: `const redact = viewer ? !viewer.view_financials : false` (line 307). **No `pin` → `viewer=null` → `redact=false` → salaries returned in full.** So `GET /api/hr-admin?action=employees` with no params leaked every salary. `employees`, `attendance-daily`, `status`, `deductions`, `leaves`, `cams-punches` were all open.

**Severity rationale:** unauthenticated bulk PII (salary + phone + biometric id) on a public origin = the worst class for a payroll system. P0, fix-before-anything.

**Fix (shipped this class):** real server-side authentication.
- New `functions/api/_lib/darbar-auth.js`: `mintToken` / `verifyToken` — an HMAC-SHA256 signed, time-boxed session token (signing key = the existing `DASHBOARD_KEY` secret; no new secret, no key in client).
- `darbar.js`: `?action=auth` (POST `{pin}`) verifies the PIN **server-side** and returns a token; **every other action requires a valid token** (`x-darbar-token`) → else `401`. CORS reflected to the Darbar origin only.
- `hr-admin.js handleGet` + `hr-payroll.js`: require a valid Darbar token (or the internal `CAMS_AUTH_TOKEN` service key) on every PII read; redaction now **defaults to redact** when the viewer can't be established.
- The PWA mints a token at PIN entry and sends `x-darbar-token` on every call; the raw `DASHBOARD_KEY` is no longer present in the browser.
- `/ops/hr` (the superseded desktop UI that relied on open reads) is redirected to Darbar.

### P1-2 — Server secret (`DASHBOARD_KEY`) lived in the browser. CLOSED
Before this fix, Darbar **writes** and all `hr-payroll` calls required the caller to send the raw `DASHBOARD_KEY` (`x-dashboard-key`), which the PWA stored in `localStorage` and the owner pasted into the Account screen. A shared production secret sitting in client storage is exfiltratable (XSS, shared device, devtools). **Fixed by the token model** — the client now holds only a short-lived scoped token; the raw key never leaves the server.

### P1-3 — Unauthenticated write: `POST ?action=reconcile`. CLOSED
`darbar.js:61` ran `reconcile(db, true)` (writes `hr_ghost_pins`) **before** the auth check. Low impact (it only upserted already-detected device PINs) but it was an unauthenticated mutation. **Fixed** — `reconcile` now sits behind `requireAuth` like every other action.

### P2-4 — PINs are 4-digit and embedded in client source. TRACKED
`USERS` (app.js) and `PINS` (hr-admin.js) are the same 5 hardcoded 4-digit PINs, present in shipped client JS. Acceptable for a single-owner tool *once the server enforces them + rate-limits*, but they are guessable (10⁴) and not secret. **Mitigation (this class):** server-side verification + token expiry; **recommended next (P2):** move the PIN map to a server secret and add attempt throttling. Tracked, not blocking.

### Class-1 status: P0-1, P1-2, P1-3 fixed in code (token auth). P2-4 mitigated + tracked.

---

## CLASS 2 — PII Exposure

### P1-5 — CORS_LEGACY wildcard constant defined but spreads into live responses. OPEN
**File:** `functions/api/hr-admin.js` lines 18, 56, 521.

`CORS_LEGACY = { 'Access-Control-Allow-Origin': '*', … }` is defined but the local helper `json()` at line 56 spreads `...CORS` (not `...CORS_LEGACY`). `CORS` is not defined as a constant in this module — it is imported as `corsHeaders` from darbar-auth and applied at the `onRequest` boundary. The internal `json()` helper therefore spreads an undefined variable.

Two consequences:
1. In normal execution, the `onRequest` gate sets the correct narrowed CORS headers on the final Response, so the wildcard does not actually reach the client for gated requests.
2. The internal `json()` helper on line 56 spreads `undefined`, which in JavaScript object spread is a no-op. The HTML settlement response at line 521 does the same. These internal responses therefore carry **no CORS headers at all**, which is correct behaviour for same-origin server-rendered HTML — but the code is misleading and `CORS_LEGACY` is dead code that could be incorrectly activated in a future refactor.

**Risk:** low today (the gate in `onRequest` works), but `CORS_LEGACY` is a trap — a future developer could wire it to a live response and open a wildcard PII surface. Dead code with `*` CORS on a payroll module is a security smell that must be removed.

**Fix required (P1):** Remove `CORS_LEGACY` constant from hr-admin.js entirely. The `json()` helper should not spread any CORS header — CORS is owned by `onRequest` via `corsHeaders(request)`. The HTML settlement at line 521 is same-origin only and needs no CORS header at all.

### P2-6 — `comms_outbox` stores phone numbers + message bodies. Column-level protection missing. TRACKED
`logOutbox` (comms-core.js:336) writes `recipient_phone` (E.164), `template_vars` (JSON-stringified, may include employee name), `body_text` (rendered SMS body), and `provider_response` (Meta API response, may contain phone metadata) to D1 `comms_outbox` in plaintext. D1 has no column-level encryption. Any CF Worker with the DB binding can read the full send history.

**Risk:** Comms metadata is PII (phone + purpose + timestamp). Acceptable for an internal audit table; the D1 binding is not exposed to the public. Tracked for future cleanup: consider hashing `recipient_phone` after 30 days or adding a retention-delete cron.

### P2-7 — `hr_ghost_pins` onboard path stores Aadhaar number in D1 plaintext. TRACKED
`ghostOnboardSubmit` (hr-automation.js:499) inserts `aadhaar_full` verbatim into `hr_employees.aadhaar_full`. This is a 12-digit government ID. D1 is not encrypted at rest at the application layer (CF storage encryption exists at infra layer, not column-level).

**Risk:** Acceptable for a tightly-scoped internal system; the table is behind the Darbar auth gate. Recommended future state: store only `aadhaar_last4` in the query-accessible column; move the full number to KV with a restricted namespace. Tracked, not blocking.

### P2-8 — `hr-admin.js` staffToken uses `DASHBOARD_KEY` as fallback signing key. TRACKED
`staffToken` (hr-admin.js:92): `const secret = env.STAFF_LINK_SECRET || env.DASHBOARD_KEY || 'fallback'`. If `STAFF_LINK_SECRET` is not set, the staff-self-view link token is signed with the same key as the session token. A token signed for one purpose can't be replayed for the other (they have different payloads), but key separation is good hygiene. The fallback `'fallback'` string is especially risky if neither secret is set.

**Fix:** Add `STAFF_LINK_SECRET` as a CF Pages secret (any 32+ char random string). Until then, ensure `DASHBOARD_KEY` is set (it is, per auth verification).

### Class-2 status: P1-5 OPEN (CORS_LEGACY dead-code removal needed). P2-6, P2-7, P2-8 tracked.

---

## CLASS 3 — Comms-rail Injection

### P1-9 — Exotel TTS endpoint accepts arbitrary `text` query parameter. OPEN
**File:** `functions/api/comms-webhook.js` lines 350-355.

```js
if (action === 'exotel-tts') {
  const messageText = url.searchParams.get('text') || 'HN Hotels alert.';
  const alertId = url.searchParams.get('alert_id') || '';
  return exoMlResponse(messageText, alertId);
}
```

`exoMlResponse` XML-escapes the text before embedding in ExoML (line 244 — `escapeXml` covers `& < > " '`), so a raw XSS injection into the XML body is mitigated. However:

1. The endpoint is **unauthenticated** — any caller can hit `GET /api/comms-webhook?action=exotel-tts&text=<arbitrary>`. The URL for this endpoint is constructed by the Worker itself and passed to Exotel as a `Url` parameter (comms-core.js:290). Exotel fetches it when a call fires. If an attacker can guess or predict a live `alert_id` and construct the TTS URL directly, they get Exotel to speak attacker-controlled text to the recipient phone.
2. Exotel's callback URL validation (if configured) is the only protection. CF has no auth on this endpoint by design (Exotel fetches it server-to-server, cannot send a secret header without custom ExoML config).

**Risk level:** Moderate. Requires knowing a live alert_id (UUIDs — not easily enumerable), but the `/api/comms-webhook?action=exotel-tts` endpoint being openly reachable for arbitrary `text` is an amplification vector.

**Fix (P1):** Add a HMAC signature to the TTS URL: `comms-core.js sendVoice` appends `?sig=HMAC(DASHBOARD_KEY, alert_id + text)` to the TTS URL; `comms-webhook exotel-tts` verifies the sig before serving ExoML. Without a valid sig, return 403 and serve empty ExoML. This is a 30-line fix.

### P2-10 — WABA `sendWabaText` free-form path is not gated by opt-in check. TRACKED
`sendWabaText` (comms-core.js:116) sends arbitrary body text to any phone number. Unlike `sendAndLog`, it does not run the `phone_verification_pending` guard (lines 407-433). This function is called only by `healthGuard` (hr-automation.js:697), which sends to `OWNER_PHONE` — a hardcoded known-good number. Low risk today but could become a path for bulk unsolicited sends if any future caller is wired without opt-in checking.

**Fix (P2):** Add opt-in bypass comment or fold `sendWabaText` calls through `sendAndLog` which does perform the guard.

### P2-11 — Absence-respond webhook is open (no token-expiry or single-use enforcement). TRACKED
`respondToAbsence` (hr-automation.js:369) accepts any `t` (alert_token) and `status`. The token is a `crypto.randomUUID()` hex string (32 hex chars). The handler is unauthenticated — intentionally, because managers tap a URL from WABA. The token is not single-use and has no TTL. A resolved alert can be re-resolved to a different status by replaying the URL.

**Risk:** Low. The handler already checks `if (alert.status === 'resolved') return { ok: true, already_resolved: true }` so a second tap is a no-op once resolved. But an unresolved alert can be set to `left` (which archives the employee) by anyone who intercepts the URL. WABA link previews, chat backups, or link-scraping by third-party apps on the manager's phone are realistic attack paths.

**Fix (P2):** Mark `alert_token` as used on first `respondToAbsence` call (set `token_used_at`); reject replays after 48h. Not blocking.

### Class-3 status: P1-9 OPEN (TTS HMAC sig needed). P2-10, P2-11 tracked.

---

## CLASS 4 — Salary Ledger Integrity

### P1-12 — `salaryOverride` and `markExit` accept unvalidated numeric amounts from the POST body. OPEN
**File:** `functions/api/darbar.js` lines 353-369 (salaryOverride), lines 284-308 (markExit).

`salaryOverride`: `amount` is taken directly from `body.amount` with no range validation. A negative amount would write a negative `net_payable` to `hr_payroll_snapshots`. A NaN or non-numeric would be stored as `null` silently (JS number coercion). Similarly, `fnf_amount` in `markExit` is written without type-checking.

**Fix (P1):** Add `Number.isFinite(amount) && amount >= 0` guard. Amounts are rupees; a reasonable max is ₹99,999. Reject outside range with 400.

### P2-13 — `hr-payroll compute-payable` mid-month over-deducts. TRACKED (known, operational)
As documented in `feedback_payroll_settlement_timing.md`: `compute-payable` called before month-end counts future days as LOP. This is an operational constraint (salaries settled on 7th of following month), not a code bug per se, but the endpoint has no guard preventing a mid-month call from producing a misleading frozen snapshot.

**Fix (P2):** Add a warning field `{ mid_month_warning: true }` to the compute response when `pay_period` equals the current month. The snapshot `status` stays `'computed'` (not `'approved'`); only the owner can approve.

### P2-14 — `hr_advances` has no duplicate-prevention guard on the same `(employee_id, advance_date, amount)`. TRACKED
`record-advance` (hr-payroll.js:218) does a plain INSERT with no deduplication check. Double-tapping the UI or a network retry creates two identical rows, both of which feed into `computePayableFor`. The payroll computation then deducts the advance twice.

**Fix (P2):** Add a `reference` column unique constraint or an idempotency key check before inserting.

### Class-4 status: P1-12 OPEN (amount range validation). P2-13, P2-14 tracked.

---

## CLASS 5 — Cron Blast Radius

### P1-15 — `cron-detect-absences` fires WABA to manager with employee PII in template vars. No cap. OPEN
**File:** `functions/api/hr-automation.js` line 208-228.

`sendAbsenceWaba` builds vars `[empName + ' absent Nd', brand + ' (PIN XX) role', 'Last punch YYYY-MM-DD...', respondUrl]`. These go into template `ops_alert_v1` body parameters. If a cron run fires on N absent employees simultaneously, N WABA messages go to Basheer/Farooq in quick succession. There is no send-rate cap or batching.

**Risk:** If an edge case inflates the `candidates` list (e.g. CAMS sync gap), the manager receives dozens of messages. More seriously, the template vars include `PIN` + `employee name` — this is biometric-adjacent PII being transmitted via WABA to a manager phone. Meta's infrastructure holds these template variable values.

**Fix (P1):** (a) Cap cron sends at N=10 per run with a `limit` guard and a `dry_run` flag for testing; (b) consider moving PIN out of WABA template body (it's in the URL already via `respondUrl`).

### P2-16 — `healthGuard` hardcodes `OWNER_PHONE = '917010426808'` in source. TRACKED
**File:** `functions/api/hr-automation.js` line 569.

This phone number is Nihaf's. It is committed to the repository. If the number changes, the hardcode must be updated in code. It is not a security vulnerability (it is the alert destination, not a secret), but it ties a personal phone number to a public repo and requires a code change to rotate.

**Fix (P2):** Read from `env.OWNER_PHONE` CF secret with hardcoded as fallback. One-line change.

### P2-17 — `cron-health-guard` is POST-gated by `x-cron-token` but token is compared with `===`. TRACKED
**File:** `functions/api/hr-automation.js` line 56.

```js
if (request.headers.get('x-cron-token') !== env.CRON_TOKEN) {
  return json({ error: 'unauthorized' }, 401);
}
```

Plain `!==` comparison is not timing-safe. An attacker doing a timing side-channel to enumerate `CRON_TOKEN` length is theoretically possible, though the CF edge network timing variance makes practical exploitation very difficult. The pattern was correctly addressed in darbar-auth.js (`timingSafeEq`) but not replicated here.

**Fix (P2):** Reuse `timingSafeEq` from darbar-auth.js for cron token verification.

### Class-5 status: P1-15 OPEN (absence WABA blast cap). P2-16, P2-17 tracked.

---

## CLASS 6 — Secret Hygiene

### P1-18 — `CORS_LEGACY` dead code with wildcard CORS is a time-bomb for secret surface expansion. OPEN
(Cross-references P1-5 above.) The `CORS_LEGACY` constant in hr-admin.js has `'Access-Control-Allow-Origin': '*'`. It is currently inert because `...CORS` (undefined) is a no-op spread and the `onRequest` gate applies narrowed CORS. However, if any future code path uses `...CORS_LEGACY` instead of the correct `corsHeaders()`, the entire hr-admin PII surface reopens to cross-origin reads. The constant must be deleted.

### P2-19 — `STAFF_LINK_SECRET` not set; fallback to `DASHBOARD_KEY` couples two token types. TRACKED
(Cross-references P2-8 above.) Per `~/.hn-assets.env`, `STAFF_LINK_SECRET` is not in the Darbar secret set. The staff self-view HMAC (hr-admin.js line 93) falls back to `DASHBOARD_KEY`. These are different trust levels: the Darbar session token (minted at PIN entry, 12h TTL) vs. the staff self-view link (permanent per employee). They should be signed by different keys.

**Action:** `wrangler pages secret put STAFF_LINK_SECRET` with a fresh 32-char random value.

### P2-20 — Fast2SMS API key sent in GET query params (visible in CF logs and provider logs). TRACKED
**File:** `functions/api/_lib/comms-core.js` line 171.

`url.searchParams.set('authorization', env.FAST2SMS_API_KEY)`. Fast2SMS's bulk API uses `authorization` as a query param (not a header). This key therefore appears in CF access logs, Fast2SMS server logs, and any HTTP intermediary. Rotating the key after a compromise is the only mitigation; the API design is the provider's constraint.

**Risk:** CF logs are not public, but the key being in URLs is a hygiene concern. Add a note to the key rotation runbook: rotate this key quarterly regardless of incidents.

### Odoo Health-Check Guard — Status: SHIPPED
**File:** `functions/api/hr-automation.js` lines 568-707.

`healthGuard` (action `cron-health-guard`) was added in commit b988088 as a daily 06:00 IST cron. It checks three live dependencies:
- (a) Odoo API key (uid=2 + ODOO_API_KEY via JSON-RPC `res.users.read([[2]])`)
- (b) Fast2SMS wallet balance (threshold: 50 credits)
- (c) WABA sparksol token expiry + data_access_expires_at

On failure, it sends a free-form WABA alert to the owner. The check correctly reads from `env.ODOO_API_KEY` (not hardcoded), uses the `odoo.hnhotels.in` instance (not ops.hamzahotel.com), and handles HTTP 200 with JSON-RPC error gracefully.

**Wiring needed:** Add `cron-health-guard` to the CF Worker schedule. Recommended: `0 0:30 * * *` (00:30 UTC = 06:00 IST). The endpoint is gated by `x-cron-token` like all other cron actions.

### Class-6 status: P1-18 OPEN (CORS_LEGACY deletion). P2-19, P2-20 tracked. Health-guard code shipped, wiring pending.

---

## PHASE 2 — Bug Fixes

### A. Ghost-onboard sync_status case — CLOSED

**Reported:** `ghostOnboardSubmit` in `hr-automation.js` was inserting `sync_status='pending'` (lowercase), which the Odoo sync cron expected as `'Pending'` (mixed case), causing the ghost-onboard mini-UI (Basheer's flow) to 500.

**Verified status:** Line 495 of `hr-automation.js` now reads:
```js
is_active, track_attendance, sync_status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'Pending')
```
The correct `'Pending'` casing is in the current deployed commit. This was patched in `b744d16` (phase 0 foundation fixes). Commit `b988088` (Class 1 security) built on top of this and did not regress it.

**Result:** CLOSED. No further action needed.

### B. Odoo API key guard — SHIPPED

**Reported:** The Worker was using a stale `ODOO_API_KEY` (Yash's user key) causing the Darbar dashboard sync to silently fail. The fix was uid=2 + ODOO_API_KEY as the stable admin authentication path.

**Code shipped:** `hr-admin.js` `odooAuth()` (line 160) now returns `parseInt(env?.ODOO_UID, 10) || ODOO_ADMIN_UID` (defaulting to uid=2). All Odoo calls go through `odoo(apiKey, ...)` using this uid. The comment at line 155 explicitly documents the admin-only API policy.

**Daily guard shipped:** `healthGuard` in `hr-automation.js` (lines 573-616) fires a WABA alert to the owner if the Odoo key returns AccessDenied. This guard needs to be wired to a CF cron trigger (`cron-health-guard` action, `x-cron-token` gated).

**Remaining action:** Wire `cron-health-guard` to Cloudflare scheduled trigger. No code change needed.

---

## PHASE 3 — Notify Pre-load Status

### Template texts

All 5 Darbar WABA templates are written, seeded in `dlt_templates` as `status='pending'`, and documented with exact body text in `docs/DARBAR-NOTIFY-ACTIVATION.md`. Templates:

| Template | Purpose | Variables |
|---|---|---|
| `darbar_missed_exit_v1` | Staff didn't punch out | `{{1}}` = first name |
| `darbar_absent_v1` | No punch recorded for shift | `{{1}}` = first name |
| `darbar_break_open_v1` | Break return punch missing | `{{1}}` = first name |
| `darbar_departed_confirm_v1` | Manager: confirm departure | `{{1}}` name, `{{2}}` days, `{{3}}` brand |
| `darbar_ghost_pin_v1` | Owner: unknown PIN punching | `{{1}}` PIN, `{{2}}` punches, `{{3}}` days |

Approved existing templates (live): `hr_advance_paid_v1`, `hr_salary_paid_v1`.

### Sabir phone migration

Schema migration `schema-darbar-sabir-phone.sql` adds `phone_verification_pending` column to `hr_employees` and flags Sabir's row (id=42, PIN 16). The `sendAndLog` function in `comms-core.js` (lines 407-433) already enforces this guard — sends to a phone with `phone_verification_pending=1` are skipped and logged to `comms_outbox` with `status='skipped'` and `skipped: 'phone_verification_pending'`.

**Activation sequence:**
1. Apply `schema-darbar-sabir-phone.sql` to D1 hn-hiring (idempotent)
2. Obtain Sabir's verified 10-digit WhatsApp number
3. Call `POST /api/hr-admin?action=set-phone` with `{ pin: "16", phone: "...", clear_verification_pending: true }`
4. Submit 5 templates in Meta Business Manager (exact body text in DARBAR-NOTIFY-ACTIVATION.md)
5. For each approved template: `POST /api/comms?action=update-dlt-template` with `{ template_name, dlt_template_id, status: "approved" }`
6. Run dry-run: `POST /api/hr-automation?action=cron-detect-absences` with `x-cron-token`
7. Wire `cron-health-guard` to CF schedule

Full runbook: `docs/DARBAR-NOTIFY-ACTIVATION.md`.

---

## Summary Table

| ID | Finding | File | Severity | Status |
|---|---|---|---|---|
| P0-1 | Unauthenticated PII world-read (darbar + hr-admin + hr-payroll) | darbar.js, hr-admin.js, hr-payroll.js | P0 | CLOSED (PR #289, b988088) |
| P1-2 | DASHBOARD_KEY lived in browser localStorage | app.js, hr-payroll.js | P1 | CLOSED (PR #289) |
| P1-3 | Unauthenticated POST reconcile write | darbar.js | P1 | CLOSED (PR #289) |
| P2-4 | 4-digit hardcoded PINs in client JS, guessable | app.js, hr-admin.js | P2 | MITIGATED — server-side verify active; throttling tracked |
| P1-5 | CORS_LEGACY `*` dead-code in hr-admin.js | hr-admin.js:18 | P1 | OPEN — delete constant + fix json() helper |
| P2-6 | comms_outbox stores phone + body plaintext | comms-core.js | P2 | TRACKED — retention cron future work |
| P2-7 | Aadhaar full number in hr_employees D1 plaintext | hr-automation.js | P2 | TRACKED — move to KV future work |
| P2-8 | staffToken falls back to DASHBOARD_KEY signing | hr-admin.js:93 | P2 | TRACKED — add STAFF_LINK_SECRET CF secret |
| P1-9 | Exotel TTS endpoint accepts unauthenticated arbitrary `text` | comms-webhook.js:350 | P1 | OPEN — add HMAC sig to TTS URL |
| P2-10 | sendWabaText bypasses opt-in/phone_verification_pending guard | comms-core.js:116 | P2 | TRACKED — scope limited to healthGuard today |
| P2-11 | Absence-respond webhook token has no TTL or single-use enforcement | hr-automation.js:369 | P2 | TRACKED — add token_used_at + 48h expiry |
| P1-12 | salaryOverride and markExit accept unvalidated negative/NaN amounts | darbar.js:353 | P1 | OPEN — add Number.isFinite + range guard |
| P2-13 | compute-payable mid-month over-deducts (operational constraint) | hr-payroll.js | P2 | TRACKED — add mid_month_warning field |
| P2-14 | hr_advances: no dedup guard; double-tap creates double deduction | hr-payroll.js | P2 | TRACKED — add idempotency key |
| P1-15 | Absence cron fires unlimited WABA sends; includes PIN in template | hr-automation.js:208 | P1 | OPEN — add N=10 cap; remove PIN from body |
| P2-16 | OWNER_PHONE hardcoded in source | hr-automation.js:569 | P2 | TRACKED — read from env.OWNER_PHONE |
| P2-17 | cron-token comparison is not timing-safe | hr-automation.js:56 | P2 | TRACKED — use timingSafeEq |
| P1-18 | CORS_LEGACY deletion (same as P1-5, different framing) | hr-admin.js:18 | P1 | OPEN — same fix as P1-5 |
| P2-19 | STAFF_LINK_SECRET not provisioned; shares DASHBOARD_KEY signing | hr-admin.js:93 | P2 | TRACKED — wrangler pages secret put |
| P2-20 | Fast2SMS API key in GET query params (visible in logs) | comms-core.js:171 | P2 | TRACKED — provider API constraint; quarterly rotation |
| Bug A | Ghost-onboard sync_status='pending' casing → 500 | hr-automation.js:495 | fix | CLOSED (b744d16) |
| Bug B | Stale ODOO_API_KEY — Darbar sync dead | hr-admin.js:160 | fix | CLOSED (b988088); health-guard wiring PENDING |

**Open P0:** None.

**Open P1:** P1-5 (CORS_LEGACY dead-code), P1-9 (TTS HMAC), P1-12 (amount validation), P1-15 (absence blast cap). These four must ship before Darbar is considered production-hardened.

**Open P2:** 8 tracked items, none blocking.

---

*Audit date: 2026-05-29. Audited by: Claude Sonnet 4.6 (subagent). Next review: when any P1 fix ships or a new API surface is added.*
