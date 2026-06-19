-- 0018_naam_decisions.sql — the Naam marketing-decision contract (D1: hn-hiring)
--
-- One row = one owner decision on a marketing MOVE, as a COORDINATE, not prose:
--   customer-state bucket × brand × lane × proof (reel/clip-ids/QA/no-fake-food)
--   × hook × CTA × decision × post-launch result/learning.
--
-- DOCTRINE BOUNDARY: this table holds DECISION RECORDS only. Naam never mutates
-- Meta/Google spend or campaign status. `proof_verified=0` means the move was
-- decided WITHOUT machine-verified food proof (honest record — not a green tick).
--
-- The /api/naam-actions function also CREATEs this IF NOT EXISTS on first call,
-- so the table self-provisions on deploy; this file is the canonical record.

CREATE TABLE IF NOT EXISTS naam_decisions (
  id              TEXT PRIMARY KEY,                 -- 'dec_<ts>_<rand>'
  move_id         TEXT NOT NULL,                    -- daily move id; (move_id,brand) is the idempotency key
  brand           TEXT NOT NULL,                    -- 'HE' | 'NCH'
  lane            TEXT NOT NULL DEFAULT 'Meta Ads', -- channel the move acts on
  customer_state  TEXT,                             -- QISSA bucket, e.g. 'food_conviction' | 'hold'
  title           TEXT,                             -- human label shown in Queue
  hook            TEXT,                             -- the creative hook (decision coordinate)
  cta             TEXT,                             -- the CTA (e.g. 'Get Directions')
  decision        TEXT NOT NULL,                    -- 'approve' | 'hold'
  proof_verified  INTEGER NOT NULL DEFAULT 0,       -- 1 only when food proof is machine-verified
  proof_json      TEXT,                             -- {reel,clip_ids[],qa_state,no_fake_food,items[]}
  status          TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'checked'
  result_json     TEXT,                             -- post-launch readback {hands,ctr,cpc,spend,pos_spike}
  learning_note   TEXT,                             -- free-text learning (genuinely text-shaped)
  decided_by      TEXT NOT NULL DEFAULT 'owner',
  decided_at      TEXT NOT NULL,                    -- IST ISO8601
  checked_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_naam_decisions_brand   ON naam_decisions(brand, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_naam_decisions_move ON naam_decisions(move_id, brand);
