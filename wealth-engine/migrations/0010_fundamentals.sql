-- ═══════════════════════════════════════════════════════════════════════════
-- 0010_fundamentals.sql
-- Adds quality dimension fed by fundamentals (Screener.in or fallback).
-- One row per symbol — refreshed weekly.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fundamentals_snapshot (
  symbol TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL,
  pe_ratio REAL,
  pb_ratio REAL,
  roe_pct REAL,
  debt_to_equity REAL,
  div_yield_pct REAL,
  promoter_holding_pct REAL,
  market_cap_cr REAL,
  sector TEXT,
  industry TEXT,
  source TEXT,
  raw_json TEXT,
  quality_score REAL,
  PRIMARY KEY (symbol)
);
CREATE INDEX IF NOT EXISTS idx_fund_quality ON fundamentals_snapshot(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_fund_refreshed ON fundamentals_snapshot(refreshed_at);

-- Add quality_score column to signal_scores if not yet present.
-- D1 / SQLite supports ALTER TABLE ADD COLUMN; no IF NOT EXISTS — guard via PRAGMA.
ALTER TABLE signal_scores ADD COLUMN quality_score REAL;
