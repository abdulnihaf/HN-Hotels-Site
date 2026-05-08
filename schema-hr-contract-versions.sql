-- HR contract versioning + edit audit trail
-- Run via: npx wrangler d1 execute hn-hiring --file=schema-hr-contract-versions.sql
-- Apply AFTER schema-hr-contract.sql
--
-- Integrity model:
--   hr_employees.contract_drive_id       → always points to LATEST PDF in Drive
--   hr_employees.contract_pdf_sha256     → hash of that file (computed at upload/regen)
--   hr_employees.contract_version        → integer counter (v1, v2, …)
--   hr_employees.contract_dirty          → 1 if D1 fields differ from what was last regenerated
--                                           (i.e. edits saved but PDF not yet regenerated)
--
-- Before any send to Leegality, the API re-downloads the Drive file, re-hashes,
-- and refuses to send if the live hash != hr_employees.contract_pdf_sha256.

-- ─── Per-version snapshot ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_contract_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  drive_file_id TEXT,                          -- nullable until upload/regen completes
  drive_file_name TEXT,                        -- e.g. "12_Mainuddin_v2.pdf"
  pdf_sha256 TEXT,                             -- nullable until materialised
  pdf_size_bytes INTEGER,
  generated_from TEXT,                         -- JSON snapshot of the input fields that produced this version
  generated_at TEXT,                           -- when the PDF was actually materialised
  generated_by TEXT,                           -- who triggered the regen
  superseded_at TEXT,                          -- set when contract_drive_id moves to the next version
  status TEXT NOT NULL DEFAULT 'pending_generation',
    -- 'pending_generation' (D1 row created, PDF not built)
    -- 'generated'          (PDF in Drive, hash known)
    -- 'sent_leegality'     (this version is the one Leegality holds)
    -- 'signed'             (Leegality returned signed PDF — separate row, signed_pdf_id set)
    -- 'superseded'         (a newer version replaced this one before sending)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id),
  UNIQUE(employee_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_contract_versions_employee ON hr_contract_versions(employee_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_contract_versions_status   ON hr_contract_versions(status);

-- ─── Field-level edit audit log ──────────────────────────────────────────────
-- Every edit through /ops/hr writes one row per changed field. Visible inline
-- on the Roster row so anyone reviewing the contract can see what changed when.
CREATE TABLE IF NOT EXISTS hr_contract_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  version_no INTEGER,                          -- the version this edit feeds INTO (i.e. the next version)
  field_name TEXT NOT NULL,                    -- e.g. 'monthly_salary', 'special_clauses'
  old_value TEXT,
  new_value TEXT,
  edited_by TEXT,
  edited_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,                             -- when this edit was materialised into a PDF (regenerated)
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_contract_edits_employee ON hr_contract_edits(employee_id, edited_at DESC);

-- ─── Augment hr_employees with the integrity fields ──────────────────────────
ALTER TABLE hr_employees ADD COLUMN contract_pdf_sha256 TEXT;
ALTER TABLE hr_employees ADD COLUMN contract_version INTEGER DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN contract_dirty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_employees ADD COLUMN contract_last_regenerated_at TEXT;
ALTER TABLE hr_employees ADD COLUMN contract_special_clauses TEXT;
  -- Free-text injected per-employee, e.g. "Mujib operates as a Service Contractor under Annexure C"

-- ─── Leegality cleanup tracking ──────────────────────────────────────────────
-- Stores raw Leegality doc list at last cleanup so we can compare against D1 leegality_doc_id
CREATE TABLE IF NOT EXISTS leegality_doc_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leegality_doc_id TEXT NOT NULL,
  doc_name TEXT,
  status TEXT,
  created_at_leegality TEXT,
  matched_employee_id INTEGER,                 -- NULL if orphan
  inventory_taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  action_taken TEXT,                           -- NULL | 'kept' | 'wiped'
  action_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leegality_inventory_orphan ON leegality_doc_inventory(matched_employee_id, action_taken);
