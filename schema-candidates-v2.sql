-- Candidates table v2: add state + upload batch tracking
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-candidates-v2.sql

-- State column for geographic filtering (separate from city)
ALTER TABLE candidates ADD COLUMN state TEXT;

-- Upload batch tracking: trace candidates back to their source upload
ALTER TABLE candidates ADD COLUMN upload_batch TEXT;    -- e.g. "shawaya_kerala_20260306"
ALTER TABLE candidates ADD COLUMN upload_label TEXT;    -- human label: "Shawaya Kerala Hiring"
ALTER TABLE candidates ADD COLUMN original_tier TEXT;   -- original priority/tier from source file

-- Index for state-based filtering
CREATE INDEX IF NOT EXISTS idx_candidates_state ON candidates(state);
CREATE INDEX IF NOT EXISTS idx_candidates_upload_batch ON candidates(upload_batch);
