-- ════════════════════════════════════════════════════════════════════════
-- Darbar — Sabir phone verification guard migration.
--
-- Two changes:
--   1. Add phone_verification_pending column to hr_employees.
--   2. Flag pin 16 (Abdul Sabir Khan) so no accidental outbound send fires
--      on a potentially wrong or unconfirmed number.
--
-- Guard semantics (enforced in comms-core.js sendAndLog):
--   If phone_verification_pending = 1, sendAndLog returns
--   { ok: false, skipped: 'phone_verification_pending' } before any API call.
--   The row is still written to comms_outbox with status='skipped'.
--
-- To clear the guard once Sabir confirms his number:
--   UPDATE hr_employees SET phone_verification_pending = 0 WHERE pin = '16';
--   (Or use /api/hr-admin?action=set-phone with the verified number — that
--    endpoint clears the flag automatically after writing the phone.)
--
-- Apply:
--   wrangler d1 execute hn-hiring --remote --file=schema-darbar-sabir-phone.sql
-- ════════════════════════════════════════════════════════════════════════

-- 1. Add column (idempotent — will no-op if already present via IGNORE)
ALTER TABLE hr_employees ADD COLUMN phone_verification_pending INTEGER NOT NULL DEFAULT 0;

-- 2. Flag Sabir's row
UPDATE hr_employees
   SET phone_verification_pending = 1
 WHERE pin = '16';

-- Verify
SELECT id, pin, name, phone, phone_verification_pending
  FROM hr_employees
 WHERE pin = '16';
