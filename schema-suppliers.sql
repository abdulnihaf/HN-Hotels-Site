-- ═══════════════════════════════════════════════════════════════════════════
-- HN Hotels Hiring — Manpower-supplier call list (flow #1) — D1 schema
-- Lives in the SAME D1 as Darbar + the WhatsApp hiring engine: binding DB → hn-hiring.
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-suppliers.sql
--
-- COA: a supplier is a coordinate (type × area × roles_supplied × grade × status).
-- The owner CALLS these. Every call is an event (hiring_supplier_calls), so the
-- "have we called them" UX is derived from real logged taps, never declared.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hiring_suppliers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  type             TEXT,                       -- agency | labour_contractor | placement | facility | directory
  phone            TEXT,                       -- 10-digit / E.164 digits; NULL if not found (never guessed)
  whatsapp         TEXT,
  area             TEXT,
  city             TEXT DEFAULT 'Bangalore',
  website          TEXT,
  source_urls      TEXT,                       -- JSON array of evidence URLs
  specialization   TEXT,
  roles_supplied   TEXT,                       -- JSON array (Cleaner, Dishwasher, Steward, …)
  hospitality_focus INTEGER DEFAULT 0,         -- 1 if they actually supply F&B/hotel staff
  central_blr      INTEGER DEFAULT 0,          -- 1 if in/near Shivajinagar / central BLR
  relevance_score  INTEGER DEFAULT 0,          -- 0–100 (research grade)
  grade            TEXT,                       -- A | B | C
  confidence       TEXT,                       -- high | med | low (is the phone real?)
  evidence         TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'new',-- new | called | responded | sent_jd | not_relevant | dead
  call_count       INTEGER NOT NULL DEFAULT 0,
  last_called_at   TEXT,
  last_outcome     TEXT,
  source           TEXT NOT NULL DEFAULT 'research', -- research | manual | owner
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

-- SQLite permits multiple NULLs in a UNIQUE index, so phoneless rows never collide;
-- ON CONFLICT(phone) upserts only real numbers (seed re-runs stay idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hiring_suppliers_phone  ON hiring_suppliers(phone);
CREATE INDEX        IF NOT EXISTS idx_hiring_suppliers_grade  ON hiring_suppliers(grade);
CREATE INDEX        IF NOT EXISTS idx_hiring_suppliers_status ON hiring_suppliers(status);

-- One row per call attempt — the audit trail behind every supplier's status.
CREATE TABLE IF NOT EXISTS hiring_supplier_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id     INTEGER NOT NULL,
  outcome         TEXT NOT NULL,    -- reached | no_answer | busy | callback | will_send | sent_jd | not_relevant | dead
  note            TEXT,
  roles_requested TEXT,             -- JSON array of roles asked for on this call
  by_user         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES hiring_suppliers(id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_calls_sid ON hiring_supplier_calls(supplier_id);
