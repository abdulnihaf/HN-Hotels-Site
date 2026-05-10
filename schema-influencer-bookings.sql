-- Influencer Cover Bookings — creator-facing slot picker + owner approval
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-influencer-bookings.sql
--
-- COA Doctrine fit:
--   ENTITY: slot (date × window × capacity) — finite coordinate
--           booking (creator × slot × cover_count × status)
--   ACTION: trajectory pending → confirmed → arrived → posted → attributed
--   EVENT: slot creation, booking submission, owner approval, arrival, deliverable

-- Cover commitment per follower tier (per layer file 01_layer_INFLUENCER.md)
--   T1: 5K–15K   → 2 covers, ₹1,200 meal budget
--   T2: 15K–50K  → 4 covers, ₹2,400 meal budget
--   T3: 50K–100K → 6 covers, ₹3,600 meal budget
--   T4: 100K+    → 8 covers + cash, ₹4,800 + custom
-- Slot windows (finite enum):
--   EARLY: Mon–Sat 7–9 PM   (capacity 6 groups/day)
--   PRIME: Mon–Sat 9–11 PM  (capacity 6)
--   LATE:  Mon–Sat 11 PM–1 AM (capacity 8)
--   JUMMA: Fri 12:30–2 PM   (capacity 4)
--   EID:   May 27 special   (capacity 12 across all windows)

CREATE TABLE IF NOT EXISTS influencer_slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_date       TEXT NOT NULL,                            -- YYYY-MM-DD IST
  window_code     TEXT NOT NULL,                            -- EARLY|PRIME|LATE|JUMMA|EID
  window_label    TEXT NOT NULL,                            -- '7–9 PM' etc
  capacity        INTEGER NOT NULL,                         -- max groups (NOT covers — each booking is 1 group of N covers)
  booked_count    INTEGER NOT NULL DEFAULT 0,               -- denormalized booking count
  is_blocked      INTEGER NOT NULL DEFAULT 0,               -- owner can block specific slots
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slot_date, window_code)
);

CREATE INDEX IF NOT EXISTS idx_slot_date ON influencer_slots(slot_date, window_code);

-- Per-creator booking
CREATE TABLE IF NOT EXISTS influencer_bookings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Creator identity
  creator_username  TEXT NOT NULL,
  creator_name      TEXT,
  creator_followers INTEGER,
  creator_tier      TEXT NOT NULL,                          -- T1|T2|T3|T4
  cover_commitment  INTEGER NOT NULL,                       -- expected covers (2/4/6/8)
  meal_budget_paise INTEGER NOT NULL,                       -- max ₹ to spend on meal
  -- Slot reference
  slot_id           INTEGER NOT NULL REFERENCES influencer_slots(id),
  slot_date         TEXT NOT NULL,                          -- denormalized for queries
  window_code       TEXT NOT NULL,
  -- Status enum
  status            TEXT NOT NULL DEFAULT 'pending',
                    -- pending: creator submitted, owner not yet seen
                    -- confirmed: owner approved
                    -- rejected: owner rejected
                    -- arrived: creator showed up
                    -- no_show: creator didn't show
                    -- posted: deliverable URL captured
                    -- attributed: revenue rolled up to may-execution
  -- Tracking
  outreach_token    TEXT UNIQUE,                            -- url-safe token in booking link
  contact_phone     TEXT,                                   -- creator-provided phone
  contact_email     TEXT,                                   -- creator-provided email
  notes_creator     TEXT,                                   -- creator's notes
  notes_owner       TEXT,                                   -- owner's internal notes
  actual_cover_count INTEGER,                               -- captured at arrival
  arrived_at        TEXT,                                   -- ISO timestamp
  arrived_table_or_counter TEXT,                            -- 'table' | 'counter'
  deliverable_url   TEXT,                                   -- reel/stories/post URL
  deliverable_at    TEXT,                                   -- when content went live
  attributed_revenue_paise INTEGER,                          -- realized revenue (covers × AOV)
  -- Audit
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by       TEXT,
  approved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_book_status ON influencer_bookings(status, slot_date);
CREATE INDEX IF NOT EXISTS idx_book_creator ON influencer_bookings(creator_username);
CREATE INDEX IF NOT EXISTS idx_book_token   ON influencer_bookings(outreach_token);
CREATE INDEX IF NOT EXISTS idx_book_slot    ON influencer_bookings(slot_id);

-- Outreach log — every contact attempt logged
CREATE TABLE IF NOT EXISTS influencer_outreach_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_username  TEXT NOT NULL,
  channel           TEXT NOT NULL,                          -- email | whatsapp | ig_dm
  to_address        TEXT,                                   -- email/phone/handle
  subject           TEXT,
  message_text      TEXT NOT NULL,
  outreach_token    TEXT NOT NULL,                          -- joins to influencer_bookings.outreach_token
  sent_at           TEXT NOT NULL DEFAULT (datetime('now')),
  sent_by           TEXT NOT NULL,                          -- nihaf|faheem|mumtaz|system
  status            TEXT NOT NULL DEFAULT 'sent',           -- sent|bounced|replied|booked|ignored
  reply_at          TEXT,
  reply_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_creator ON influencer_outreach_log(creator_username, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_token   ON influencer_outreach_log(outreach_token);
CREATE INDEX IF NOT EXISTS idx_outreach_status  ON influencer_outreach_log(status, sent_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Seed slots for May 10 – May 31, 2026
-- ─────────────────────────────────────────────────────────────────────────

-- Daily windows: EARLY (7-9 PM), PRIME (9-11 PM), LATE (11 PM-1 AM)
-- 21 days × 3 windows = 63 weekday/weekend slots
-- Plus Friday Jumma slots (May 15, 22, 29) at 12:30-2 PM
-- Plus May 27 Eid special (3 windows × extra capacity)

-- May 10 (Sat)
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity) VALUES
('2026-05-10', 'EARLY', '7–9 PM',     6),
('2026-05-10', 'PRIME', '9–11 PM',    6),
('2026-05-10', 'LATE',  '11 PM–1 AM', 8);

-- May 11–16 (Sun–Fri)
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity) VALUES
('2026-05-11', 'EARLY', '7–9 PM',     6), ('2026-05-11', 'PRIME', '9–11 PM', 6), ('2026-05-11', 'LATE', '11 PM–1 AM', 8),
('2026-05-12', 'EARLY', '7–9 PM',     6), ('2026-05-12', 'PRIME', '9–11 PM', 6), ('2026-05-12', 'LATE', '11 PM–1 AM', 8),
('2026-05-13', 'EARLY', '7–9 PM',     6), ('2026-05-13', 'PRIME', '9–11 PM', 6), ('2026-05-13', 'LATE', '11 PM–1 AM', 8),
('2026-05-14', 'EARLY', '7–9 PM',     6), ('2026-05-14', 'PRIME', '9–11 PM', 6), ('2026-05-14', 'LATE', '11 PM–1 AM', 8),
('2026-05-15', 'JUMMA', '12:30–2 PM', 4), ('2026-05-15', 'EARLY', '7–9 PM', 6), ('2026-05-15', 'PRIME', '9–11 PM', 6), ('2026-05-15', 'LATE', '11 PM–1 AM', 8),
('2026-05-16', 'EARLY', '7–9 PM',     6), ('2026-05-16', 'PRIME', '9–11 PM', 6), ('2026-05-16', 'LATE', '11 PM–1 AM', 8);

-- May 17–22
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity) VALUES
('2026-05-17', 'EARLY', '7–9 PM',     6), ('2026-05-17', 'PRIME', '9–11 PM', 6), ('2026-05-17', 'LATE', '11 PM–1 AM', 8),
('2026-05-18', 'EARLY', '7–9 PM',     6), ('2026-05-18', 'PRIME', '9–11 PM', 6), ('2026-05-18', 'LATE', '11 PM–1 AM', 8),
('2026-05-19', 'EARLY', '7–9 PM',     6), ('2026-05-19', 'PRIME', '9–11 PM', 6), ('2026-05-19', 'LATE', '11 PM–1 AM', 8),
('2026-05-20', 'EARLY', '7–9 PM',     6), ('2026-05-20', 'PRIME', '9–11 PM', 6), ('2026-05-20', 'LATE', '11 PM–1 AM', 8),
('2026-05-21', 'EARLY', '7–9 PM',     6), ('2026-05-21', 'PRIME', '9–11 PM', 6), ('2026-05-21', 'LATE', '11 PM–1 AM', 8),
('2026-05-22', 'JUMMA', '12:30–2 PM', 4), ('2026-05-22', 'EARLY', '7–9 PM', 6), ('2026-05-22', 'PRIME', '9–11 PM', 6), ('2026-05-22', 'LATE', '11 PM–1 AM', 8);

-- May 23–26
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity) VALUES
('2026-05-23', 'EARLY', '7–9 PM',     6), ('2026-05-23', 'PRIME', '9–11 PM', 6), ('2026-05-23', 'LATE', '11 PM–1 AM', 8),
('2026-05-24', 'EARLY', '7–9 PM',     6), ('2026-05-24', 'PRIME', '9–11 PM', 6), ('2026-05-24', 'LATE', '11 PM–1 AM', 8),
('2026-05-25', 'EARLY', '7–9 PM',     6), ('2026-05-25', 'PRIME', '9–11 PM', 6), ('2026-05-25', 'LATE', '11 PM–1 AM', 8),
('2026-05-26', 'EARLY', '7–9 PM',     6), ('2026-05-26', 'PRIME', '9–11 PM', 6), ('2026-05-26', 'LATE', '11 PM–1 AM', 8);

-- May 27 (Eid Wed) — special expanded capacity
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity, notes) VALUES
('2026-05-27', 'EID',   'All day Eid', 12, 'Eid-ul-Adha hero day — Mutton Family Pack push'),
('2026-05-27', 'PRIME', '9–11 PM',     8, 'Eid evening peak'),
('2026-05-27', 'LATE',  '11 PM–1 AM',  8, 'Eid post-dinner');

-- May 28–31
INSERT OR IGNORE INTO influencer_slots (slot_date, window_code, window_label, capacity) VALUES
('2026-05-28', 'EARLY', '7–9 PM',     6), ('2026-05-28', 'PRIME', '9–11 PM', 6), ('2026-05-28', 'LATE', '11 PM–1 AM', 8),
('2026-05-29', 'JUMMA', '12:30–2 PM', 4), ('2026-05-29', 'EARLY', '7–9 PM', 6), ('2026-05-29', 'PRIME', '9–11 PM', 6), ('2026-05-29', 'LATE', '11 PM–1 AM', 8),
('2026-05-30', 'EARLY', '7–9 PM',     6), ('2026-05-30', 'PRIME', '9–11 PM', 6), ('2026-05-30', 'LATE', '11 PM–1 AM', 8),
('2026-05-31', 'EARLY', '7–9 PM',     6), ('2026-05-31', 'PRIME', '9–11 PM', 6), ('2026-05-31', 'LATE', '11 PM–1 AM', 8);
