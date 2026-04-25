-- ─────────────────────────────────────────────────────────────────
-- HN Agents — Phase 1 (deterministic detection, no LLM, no persona)
-- One agent = one bag of rules.
-- Rules produce findings. Findings get reviewed by Nihaf in the UI.
-- Nihaf writes the directive himself. Not auto-drafted.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name      TEXT    NOT NULL,                                                  -- 'finance-watcher'
  started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at     INTEGER,
  status          TEXT    CHECK(status IN ('running','complete','failed')) DEFAULT 'running',
  findings_count  INTEGER NOT NULL DEFAULT 0,
  trigger         TEXT    DEFAULT 'manual',                                          -- 'manual' | 'cron'
  triggered_by    TEXT,                                                              -- PIN holder name+role
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_agent_started ON agent_runs(agent_name, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_findings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_name      TEXT    NOT NULL,
  severity        TEXT    CHECK(severity IN ('critical','high','medium','low')) NOT NULL,
  category        TEXT    NOT NULL,                                                  -- 'overdue_bill','orphan','duplicate','stale_po'
  title           TEXT    NOT NULL,                                                  -- factual, not interpretive
  detail          TEXT,
  evidence_json   TEXT,                                                              -- raw substrate row(s) for auditing
  fingerprint     TEXT    NOT NULL,                                                  -- dedup key across runs

  -- Nihaf review (the only "interpretation" — done by you, not the agent)
  verdict         TEXT    CHECK(verdict IN ('act','ignore','wrong','more_info') OR verdict IS NULL),
  verdict_note    TEXT,
  verdict_at      INTEGER,
  verdict_by      TEXT,

  -- Directive (you write it; we log it; Phase 1 doesn't auto-send)
  directive       TEXT,
  directive_channel TEXT  CHECK(directive_channel IN ('whatsapp','sms','call','email','in_person') OR directive_channel IS NULL),
  directive_to    TEXT,                                                              -- 'basheer','zoya','naveen','yash'
  directive_at    INTEGER,

  -- Closure
  closure_status  TEXT    CHECK(closure_status IN ('open','in_progress','resolved','dismissed')) NOT NULL DEFAULT 'open',
  closed_at       INTEGER,
  closure_note    TEXT,

  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_findings_run         ON agent_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_agent       ON agent_findings(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_status      ON agent_findings(closure_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_fp   ON agent_findings(agent_name, fingerprint);
