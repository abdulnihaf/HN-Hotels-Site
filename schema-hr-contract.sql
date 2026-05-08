-- HR contract storage schema migration
-- Adds contract review + Leegality tracking columns to hr_employees
-- Run via: wrangler d1 execute <DB-NAME> --file=schema-hr-contract.sql

ALTER TABLE hr_employees ADD COLUMN contract_drive_id TEXT;
ALTER TABLE hr_employees ADD COLUMN contract_uploaded_at TEXT;
ALTER TABLE hr_employees ADD COLUMN contract_status TEXT DEFAULT 'not_uploaded';
-- contract_status values:
--   'not_uploaded'    — no contract yet
--   'pending_review'  — uploaded, owner needs to review
--   'approved'        — owner approved, ready to send to Leegality
--   'sent_leegality'  — eSign request sent
--   'signed'          — fully signed
--   'declined'        — employee refused

-- Leegality integration columns
ALTER TABLE hr_employees ADD COLUMN leegality_doc_id TEXT;
ALTER TABLE hr_employees ADD COLUMN leegality_sent_at TEXT;
ALTER TABLE hr_employees ADD COLUMN leegality_signed_at TEXT;
ALTER TABLE hr_employees ADD COLUMN leegality_signed_pdf_id TEXT;  -- post-signing Drive file ID

-- Effective date of the contract (used in offer letter "Effective From")
ALTER TABLE hr_employees ADD COLUMN contract_effective_date TEXT;

-- Set initial effective date for the May 2026 batch
UPDATE hr_employees SET contract_effective_date = '2026-05-01' WHERE is_active = 1;

-- Index for filtering by contract status
CREATE INDEX IF NOT EXISTS idx_hr_employees_contract_status ON hr_employees(contract_status, brand_label);
