-- fleet/marketing-shell/schema/marketing_dispatch_queue.sql
-- D1 schema for the mobile bridge dispatch queue.
-- Applied via: wrangler d1 execute hn-hiring --file=fleet/marketing-shell/schema/marketing_dispatch_queue.sql --remote
--
-- Lifecycle of a job:
--   1. iPhone/iPad/Mac POSTs to /api/marketing-bridge?action=dispatch → row inserted, status='queued'
--   2. winpc poller GETs /api/marketing-bridge?action=pending → reads queued jobs, marks them 'processing'
--   3. winpc lane reads inbox file, runs Claude, writes outbox file
--   4. winpc poller POSTs /api/marketing-bridge?action=complete with result → row updated to 'completed'
--   5. Client GET /api/marketing-bridge?action=result → returns final state

CREATE TABLE IF NOT EXISTS marketing_dispatch_queue (
  job_id        TEXT PRIMARY KEY,
  lane          TEXT NOT NULL,                          -- "01-influencer" | "02-google" | ... | "marketing-orchestrator"
  directive     TEXT NOT NULL,                          -- the user's natural-language instruction
  status        TEXT NOT NULL DEFAULT 'queued',         -- queued | processing | completed | failed | timeout
  source        TEXT,                                   -- "iphone" | "ipad" | "mac" | "curl"
  created_at    INTEGER NOT NULL,                       -- unix epoch (seconds)
  updated_at    INTEGER NOT NULL,
  result        TEXT,                                   -- text result from the lane (only set when completed)
  error         TEXT,                                   -- error message if failed
  picked_at     INTEGER,                                -- when winpc poller marked it processing
  completed_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_marketing_dispatch_status_created
  ON marketing_dispatch_queue (status, created_at);

CREATE INDEX IF NOT EXISTS idx_marketing_dispatch_lane_status
  ON marketing_dispatch_queue (lane, status);
