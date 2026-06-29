-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0022 — Execution Lab (diagnostics-first test-run trail)
-- ═══════════════════════════════════════════════════════════════════════════
-- The Lab needs EVERY order path (equity round-trip, option buy, partial exit,
-- square-off-all, bracket, …) to leave the SAME structured, replayable trail.
-- kite_bracket_orders only models the bracket flow; pipelineTest emits the ideal
-- steps[] shape but never persists it. These two tables persist that shape for
-- every path, written once at the order choke point via recordRun/recordStep.
--
-- Additive + backward-compatible: nothing existing reads these tables, so this is
-- safe to apply to live D1 BEFORE the new code deploys.
-- Money is paise (INTEGER). All timestamps are ms-epoch TEXT for parity with the
-- existing tables that store created_at as a string, OR ms-epoch — we store ISO
-- strings here so a human reading D1 sees a readable time.

CREATE TABLE IF NOT EXISTS lab_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario        TEXT NOT NULL,        -- 'E1', 'O2', 'P5', ...  (test-matrix row id; '' if ad-hoc)
  kind            TEXT NOT NULL,        -- equity_roundtrip | option_buy | partial_exit | square_off_all | bracket | place_order | ...
  surface         TEXT,                 -- 'ios_lab' | 'api' | ...
  mode            TEXT NOT NULL,        -- 'sim' | 'tiny_real'
  rung            TEXT,                 -- 'sim' | 'tiny_real' | 'full_auto'
  symbol          TEXT,
  qty             INTEGER,
  tag             TEXT,                 -- client idempotency tag
  status          TEXT NOT NULL,        -- placed | complete | complete_with_fallback | failed_no_stop | error | blocked | deduped | ...
  max_loss_paise  INTEGER,
  intent_json     TEXT,                 -- full request body (verbatim)
  steps_json      TEXT,                 -- the steps[] array (verbatim)
  raw_error       TEXT,                 -- verbatim Kite error (no paraphrase)
  action_required TEXT,                 -- naked_position | pending_order | gtt_failed | CHECK_AND_SQUAREOFF | ...
  bracket_id      INTEGER,              -- FK to kite_bracket_orders if applicable
  ios_auth_ok     INTEGER,
  created_at      TEXT,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_runs_scenario ON lab_runs(scenario, created_at);
CREATE INDEX IF NOT EXISTS idx_lab_runs_created  ON lab_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_lab_runs_tag      ON lab_runs(tag);

CREATE TABLE IF NOT EXISTS lab_steps (
  run_id  INTEGER NOT NULL,            -- FK to lab_runs.id
  seq     INTEGER NOT NULL,            -- 1-based ordinal within the run
  name    TEXT,                        -- 'market_hours_ok' | 'fund_check' | 'place_buy' | 'poll_fill' | ...
  ok      INTEGER,                     -- 1 | 0
  detail  TEXT,
  raw_json TEXT,                       -- verbatim broker response for this step
  at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_steps_run ON lab_steps(run_id, seq);

-- ── New config keys the unified order door + the Lab read ─────────────────────
-- max_order_notional_paise: the per-test rupee ceiling enforced SERVER-SIDE in
-- the unified placeOrder. An order whose (qty × ref_price) exceeds this is REFUSED
-- by construction — a fat-finger is structurally impossible, not merely caught.
-- Default ₹500 (50000 paise) covers a 1-share IDEA (~₹14) probe and a single
-- capped index-option lot's tiny premium with wide headroom, while making a
-- 100-lot or ₹50k mistake refuse. Tune up deliberately, never by momentum.
--
-- nfo_index_whitelist: the buyer-only liquid-index-weekly gate. Comma-separated
-- underlying name prefixes that are allowed for NFO option orders. Anything else
-- (stock options = physically settled = lakhs of delivery risk) is refused.
INSERT OR REPLACE INTO user_config (config_key, config_value, description, updated_at) VALUES
  ('max_order_notional_paise', '50000', 'Exec-Lab per-test rupee ceiling (qty×ref refused above) — ₹500', strftime('%s','now')*1000),
  ('nfo_index_whitelist',      'NIFTY,BANKNIFTY,FINNIFTY,MIDCPNIFTY', 'Buyer-only index weeklies allowed on NFO (prefix match); all else refused', strftime('%s','now')*1000),
  ('nfo_option_margin_cap_paise', '200000', 'NFO option order_margins.total cap (>₹2000 blocks — catches writing/SPAN) — ₹2000', strftime('%s','now')*1000),
  ('gtt_stop_slip_pct', '0.5', 'Bracket GTT stop-leg LIMIT buffer below trigger (SL-M-emulating marketable limit, %)', strftime('%s','now')*1000),
  ('time_exit_ist_hhmm', '1512', 'IST HH:MM the time-exit cron squares MIS (beats RMS ~15:20/15:25). SCAFFOLD — disabled vs real orders.', strftime('%s','now')*1000),
  ('time_exit_enabled', '0', 'Time-exit cron arm switch — 0 = SIM/dry only (NOT armed against real orders).', strftime('%s','now')*1000);
