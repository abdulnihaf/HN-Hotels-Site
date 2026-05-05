-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0011 — Sector classification table
--
-- Auto-classify the full equity universe into sector buckets so macro tilts
-- propagate beyond the 70-name hardcoded basket the signal engine ships with.
--
-- Source: kite_instruments.name (company name) + heuristic keyword classifier.
-- Refreshed weekly from /run/classify_sectors. Manual overrides allowed via
-- source='manual' rows that the ingestor leaves alone.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sector_classification (
  symbol TEXT PRIMARY KEY,
  sector_bucket TEXT NOT NULL,         -- BANK_NBFC | IT_PHARMA | AUTO | METALS | ENERGY | FMCG | AIRLINES_PAINT | REALTY | INFRA | CHEMICALS | OTHER
  source TEXT,                          -- 'kite_metadata' | 'screener' | 'manual'
  classified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sector_bucket ON sector_classification(sector_bucket);
