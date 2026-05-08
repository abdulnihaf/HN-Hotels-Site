// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-signal-engine
// Composite scoring across all 8 layers.
//
// For each symbol in the universe, computes 9 dimension scores (0-100):
//   trend       — momentum vs 20/50/200-DMA + volatility-adjusted return
//   flow        — institutional buying (FII/DII flows + bulk/block deals + insider trades)
//   options     — OI build-up + max-pain proximity + IV skew (only for F&O stocks)
//   catalyst    — corp announcements materiality + earnings proximity
//   macro       — sector tailwind from rate cycle, DXY, crude, etc
//   sentiment   — news + social aggregate over last 7 days
//   breadth     — sector relative strength + delivery % conviction
//   retail_buzz — Reddit/Stocktwits/Nitter mention-velocity anomaly
//   quality     — Screener.in fundamentals (P/E, ROE, D/E, promoter holding)
//
// Composite = weighted sum. Top picks emitted to signal_scores nightly.
// Cascade detector runs in parallel for special pattern setups.
//
// Cron: nightly 19:00 IST (after all daily data lands)
// ═══════════════════════════════════════════════════════════════════════════

import { ymdHyphen, istNow } from '../../_shared/nseClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';

const WORKER_NAME = 'wealth-signal-engine';

// Composite weights — sum = 1.05 (quality is additive, not renormalised).
// retail_buzz: 0.05 — small but non-zero. Captures retail attention surges
// (Reddit + Stocktwits + Nitter mention velocity). Leading indicator on the
// way up (often precedes price moves 6-24h) AND fade-the-FOMO indicator
// when retail piles in late. Kept low because high-buzz can cut both ways;
// the weight is enough to surface attention-anomaly stocks in the top board
// without overwhelming fundamental dimensions.
// quality: 0.05 — Screener.in fundamentals (P/E, ROE, D/E, promoter holding,
// div yield, mcap). Pushes trade cards toward fundamentally sound stocks and
// penalises junk small-caps. Refreshed weekly by wealth-fundamentals worker.
const DIMENSION_WEIGHTS = {
  trend: 0.19,
  flow: 0.17,
  options: 0.12,
  catalyst: 0.14,
  macro: 0.14,
  sentiment: 0.09,
  breadth: 0.10,
  retail_buzz: 0.05,
  quality: 0.05,
};

// ───────────────────────────────────────────────
// Regime-adaptive weight overrides (Upgrade 3)
//
// detectRegime() classifies the prevailing market regime once per cycle from
// Nifty 50 + India VIX, then computeAll() swaps DIMENSION_WEIGHTS for the
// regime-specific row below. retail_buzz + quality stay fixed at 0.05 each
// across regimes (universal signals); the other 7 dims redistribute the rest.
//
//   strong_trending_up    — momentum compounding; trend up, breadth/options
//                           down (everything's rallying, less differentiated).
//   ranging               — mean-reversion; flow + catalyst + sentiment do
//                           the work, trend hurts (whipsaws).
//   high_vol              — chaos; macro + flow up to anchor reads, options
//                           noisier, breadth suppressed.
//   transitioning         — neutral default (mirror of DIMENSION_WEIGHTS).
//   strong_trending_down  — null sentinel; computeAll returns empty (no
//                           shorting yet, so we don't emit cards).
//
// Each non-null row sums to 1.05 (matches DIMENSION_WEIGHTS — quality is
// additive, not renormalised, so existing composite scaling is preserved).
// ───────────────────────────────────────────────
const REGIME_WEIGHTS = {
  strong_trending_up:   { trend: 0.30, flow: 0.18, options: 0.10, catalyst: 0.12, macro: 0.10, sentiment: 0.10, breadth: 0.05, retail_buzz: 0.05, quality: 0.05 },
  ranging:              { trend: 0.10, flow: 0.20, options: 0.15, catalyst: 0.18, macro: 0.10, sentiment: 0.15, breadth: 0.07, retail_buzz: 0.05, quality: 0.05 },
  high_vol:             { trend: 0.15, flow: 0.20, options: 0.05, catalyst: 0.18, macro: 0.20, sentiment: 0.10, breadth: 0.07, retail_buzz: 0.05, quality: 0.05 },
  transitioning:        { trend: 0.19, flow: 0.17, options: 0.12, catalyst: 0.14, macro: 0.14, sentiment: 0.09, breadth: 0.10, retail_buzz: 0.05, quality: 0.05 },
  strong_trending_down: null,
};

// Map score to 0-100 with sigmoid-like compression
function clamp01(x) { return Math.max(0, Math.min(100, x)); }
function rescale(value, lo, hi) {
  if (value == null) return 50;
  if (hi === lo) return 50;
  const t = (value - lo) / (hi - lo);
  return clamp01(t * 100);
}

// ───────────────────────────────────────────────
// TREND score + MTF alignment classification
//
// Returns BOTH the legacy 0-100 trend score AND the multi-timeframe alignment
// label per symbol (Upgrade 2). Computing the SMAs once and reusing them for
// both purposes avoids a second 200-day window scan over equity_eod.
//
// MTF alignment derived from price-vs-SMA % deviation:
//   daily   = (close - SMA20)  / SMA20  × 100
//   weekly  = (close - SMA50)  / SMA50  × 100
//   monthly = (close - SMA100) / SMA100 × 100
//
// Labels:
//   aligned_up      → all three positive; full conviction
//   partial_up      → daily + weekly positive, monthly flat (-3 ≤ m ≤ 0)
//   against_macro   → daily positive but monthly < -3; veto in computeAll
//   aligned_down    → all three negative; veto (no shorting yet)
//   mixed           → daily/weekly disagree; accept with downgrade signal
//                     (composite still emitted, UI can soft-filter)
//
// Returns: { scores: {sym→0-100}, mtf: {sym→label} }
// ───────────────────────────────────────────────
function classifyMTF(daily, weekly, monthly) {
  if (daily > 0 && weekly > 0 && monthly > 0) return 'aligned_up';
  if (daily > 0 && weekly > 0 && monthly >= -3 && monthly <= 0) return 'partial_up';
  if (daily > 0 && monthly < -3) return 'against_macro';
  if (daily < 0 && weekly < 0 && monthly < 0) return 'aligned_down';
  return 'mixed';
}

async function computeTrendScores(env) {
  const today = ymdHyphen(istNow());
  const r = await env.DB.prepare(`
    WITH recent AS (
      SELECT symbol, trade_date, close_paise,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) AS rn
      FROM equity_eod WHERE exchange='NSE' AND trade_date <= ?
    )
    SELECT symbol,
      MAX(CASE WHEN rn=1 THEN close_paise END) AS c1,
      AVG(CASE WHEN rn<=20 THEN close_paise END) AS dma20,
      AVG(CASE WHEN rn<=50 THEN close_paise END) AS dma50,
      AVG(CASE WHEN rn<=100 THEN close_paise END) AS dma100,
      AVG(CASE WHEN rn<=200 THEN close_paise END) AS dma200,
      MAX(CASE WHEN rn=21 THEN close_paise END) AS c20ago,
      MAX(CASE WHEN rn=63 THEN close_paise END) AS c63ago
    FROM recent WHERE rn <= 200
    GROUP BY symbol
    HAVING COUNT(*) >= 50
  `).bind(today).all();
  const scores = {};
  const mtf = {};
  for (const row of r.results || []) {
    const { symbol, c1, dma20, dma50, dma100, dma200, c20ago, c63ago } = row;
    if (!c1) continue;
    let s = 50;
    if (dma20 && c1 > dma20) s += 8; else s -= 8;
    if (dma50 && c1 > dma50) s += 10; else s -= 10;
    if (dma200 && c1 > dma200) s += 12; else s -= 12;
    if (c20ago) {
      const r1m = (c1 - c20ago) / c20ago;
      s += clamp01(50 + r1m * 200) - 50;
    }
    if (c63ago) {
      const r3m = (c1 - c63ago) / c63ago;
      s += clamp01(50 + r3m * 100) - 50;
    }
    scores[symbol] = clamp01(s);

    // MTF alignment — needs all three SMAs. Symbols with <100 days history
    // get null mtf (no veto applied; they go through neutral).
    if (dma20 && dma50 && dma100) {
      const daily   = (c1 - dma20)  / dma20  * 100;
      const weekly  = (c1 - dma50)  / dma50  * 100;
      const monthly = (c1 - dma100) / dma100 * 100;
      mtf[symbol] = classifyMTF(daily, weekly, monthly);
    }
  }
  return { scores, mtf };
}

// ───────────────────────────────────────────────
// FLOW score — block deals + insider buys
// ───────────────────────────────────────────────
async function computeFlowScores(env) {
  // 30-day window net institutional bullishness
  const since = ymdHyphen(new Date(Date.now() - 30 * 86400000));
  const r = await env.DB.prepare(`
    SELECT symbol,
      SUM(CASE WHEN deal_type IN ('bulk','block') AND txn_type='buy' THEN qty ELSE 0 END) AS buy_qty,
      SUM(CASE WHEN deal_type IN ('bulk','block') AND txn_type='sell' THEN qty ELSE 0 END) AS sell_qty
    FROM bulk_block_deals WHERE trade_date >= ? GROUP BY symbol
  `).bind(since).all();
  const insider = await env.DB.prepare(`
    SELECT symbol,
      SUM(CASE WHEN txn_type='buy' THEN value_paise ELSE 0 END) AS buy_val,
      SUM(CASE WHEN txn_type='sell' THEN value_paise ELSE 0 END) AS sell_val
    FROM insider_trades WHERE txn_date >= ? GROUP BY symbol
  `).bind(since).all();
  const insiderBySym = {};
  for (const i of (insider.results || [])) insiderBySym[i.symbol] = i;
  const out = {};
  for (const row of (r.results || [])) {
    const total = (row.buy_qty || 0) + (row.sell_qty || 0);
    let s = 50;
    if (total > 0) {
      const netRatio = ((row.buy_qty || 0) - (row.sell_qty || 0)) / total;
      s += netRatio * 30;
    }
    const ins = insiderBySym[row.symbol];
    if (ins) {
      const insTotal = (ins.buy_val || 0) + (ins.sell_val || 0);
      if (insTotal > 0) {
        const insRatio = ((ins.buy_val || 0) - (ins.sell_val || 0)) / insTotal;
        s += insRatio * 20;
      }
    }
    out[row.symbol] = clamp01(s);
  }
  return out;
}

// ───────────────────────────────────────────────
// OPTIONS score — OI buildup direction + IV
// ───────────────────────────────────────────────
async function computeOptionsScores(env) {
  // For F&O stocks: latest snapshot, sum CE chg_oi vs PE chg_oi over ATM range
  const r = await env.DB.prepare(`
    SELECT underlying AS symbol,
      SUM(ce_chg_oi) AS ce_chg, SUM(pe_chg_oi) AS pe_chg,
      AVG(ce_iv) AS ce_iv_avg, AVG(pe_iv) AS pe_iv_avg
    FROM option_chain_snapshot
    WHERE ts > ? GROUP BY underlying
  `).bind(Date.now() - 86400000).all();
  const out = {};
  for (const row of (r.results || [])) {
    let s = 50;
    const total = Math.abs(row.ce_chg || 0) + Math.abs(row.pe_chg || 0);
    if (total > 0) {
      // PE writing (PE chg_oi positive) is bullish; CE writing is bearish
      const peWriting = (row.pe_chg || 0);
      const ceWriting = (row.ce_chg || 0);
      const bullishness = (peWriting - ceWriting) / total;
      s += bullishness * 30;
    }
    if (row.pe_iv_avg && row.ce_iv_avg) {
      const skew = row.ce_iv_avg - row.pe_iv_avg;
      s += skew > 0 ? 5 : -5;
    }
    out[row.symbol] = clamp01(s);
  }
  return out;
}

// ───────────────────────────────────────────────
// CATALYST score — recent material announcements + earnings proximity
// ───────────────────────────────────────────────
async function computeCatalystScores(env) {
  const since = Date.now() - 14 * 86400000;
  const r = await env.DB.prepare(`
    SELECT symbol,
      AVG(materiality_score) AS mat,
      AVG(sentiment_score) AS sent,
      COUNT(*) AS n
    FROM corp_announcements WHERE ann_time > ? GROUP BY symbol
  `).bind(since).all();
  const upcoming = await env.DB.prepare(`
    SELECT symbol FROM results_calendar
    WHERE result_date BETWEEN date('now') AND date('now', '+10 days')
  `).all();
  const upcomingSet = new Set((upcoming.results || []).map(x => x.symbol));
  const out = {};
  for (const row of (r.results || [])) {
    let s = 50;
    s += (row.mat || 0) * 30;
    s += (row.sent || 0) * 15;
    s += Math.min(10, (row.n || 0) * 1.5);
    if (upcomingSet.has(row.symbol)) s += 8;
    out[row.symbol] = clamp01(s);
  }
  // Anyone with upcoming results but no recent announcements still gets a boost
  for (const sym of upcomingSet) {
    if (!(sym in out)) out[sym] = 58;
  }
  return out;
}

// ───────────────────────────────────────────────
// Sector classification (Upgrade 1)
//
// classifySector() — pure-JS heuristic over company name (Kite metadata)
// runSectorClassification() — weekly ingest: read top 500 liquid F&O stocks
//   from equity_eod, LEFT JOIN kite_instruments for name, classify, upsert
//   into sector_classification. Manual rows (source='manual') are preserved.
// loadSectorBasket() — read sector_classification → { BUCKET: [symbols...] }
//   used by computeMacroScores. Falls back to a small hardcoded basket if
//   the table is empty (first deploy before classifier runs).
// ───────────────────────────────────────────────
const SECTOR_BUCKETS = ['BANK_NBFC','IT_PHARMA','AUTO','METALS','ENERGY','FMCG','AIRLINES_PAINT','REALTY','INFRA','CHEMICALS','OTHER'];

function classifySector(symbol, name) {
  const n = String(name || symbol || '').toUpperCase();
  // Order matters — REALTY needs to win over HOUSING-FINANCE, IT_PHARMA over
  // generic CONSULTANCY etc. Specific tokens first, then broad ones.
  if (/\bREAL ?ESTATE|\bREALTY|\bDLF\b|\bLODHA\b|\bGODREJ PROP|\bOBEROI REAL|\bPRESTIGE EST|\bSOBHA\b|\bPHOENIX MILL|\bBRIGADE ENT/.test(n)) return 'REALTY';
  if (/INFOSYS|TCS|WIPRO|HCLTECH|TECH MAHINDRA|SOFTWARE|MINDTREE|LTIM|PERSISTENT|MPHASIS|COFORGE|BIRLASOFT|HEXAWARE|CYIENT|TATA ELXSI|INTELLECT|RAMCO SYS|ZENSAR/.test(n)) return 'IT_PHARMA';
  if (/PHARMA|HEALTHCARE|HOSPITAL|\bDRUG\b|LABS|BIOCON|DIVI'?S|CIPLA|LUPIN|DR\.? REDDY|SUN PHARMA|TORRENT PHARMA|GLENMARK|AUROBINDO|ALKEM|IPCA|AJANTA|CADILA|ZYDUS|FORTIS|APOLLO HOSP|MAX HEALTH|NARAYANA|MEDPLUS/.test(n)) return 'IT_PHARMA';
  if (/\bBANK\b|\bFINANCE\b|FIN ?SERV|\bNBFC\b|HOUSING FINANCE|\bCAPITAL\b|MICRO ?FIN|HDFC LIFE|SBI LIFE|ICICI PRU|MAX FIN|MUTHOOT|MANAPPURAM|LIC HOUSING|SHRIRAM|BAJAJ FIN|CHOLA|MAS FIN|AAVAS|HOME FIRST|REPCO|CAN FIN/.test(n)) return 'BANK_NBFC';
  if (/AUTO\b|\bMOTORS\b|VEHICLES|MAHINDRA & MAHINDRA|TRACTOR|TYRES|MOTOCORP|MARUTI|EICHER|TVS MOTOR|ASHOK LEY|BAJAJ AUTO|HERO MOTO|BALKRISHNA|APOLLO TYRE|MRF|CEAT|JK TYRE|BOSCH|MOTHERSON|EXIDE|AMARA RAJA|ESCORTS|BHARAT FORGE/.test(n)) return 'AUTO';
  if (/STEEL|\bIRON\b|METAL|MINERAL|\bZINC\b|\bCOPPER\b|ALUMINIUM|ALUMINUM|NMDC|COAL INDIA|NALCO|HINDALCO|JINDAL|JSW STEEL|TATA STEEL|VEDANTA|HINDUSTAN COPPER|MOIL|SAIL\b|RATNAMANI|APL APOLLO|JSL\b|JINDAL STAINLESS/.test(n)) return 'METALS';
  if (/RELIANCE INDUSTR|\bOIL\b|\bGAS\b|PETROLEUM|ENERGY|POWER|\bONGC\b|\bBPCL\b|\bHPCL\b|\bIOC\b|INDIAN OIL|\bGAIL\b|PETRONET|TATA POWER|\bNTPC\b|ADANI POWER|ADANI GREEN|JSW ENERGY|TORRENT POWER|POWER GRID|NHPC|SJVN|NLC INDIA/.test(n)) return 'ENERGY';
  if (/FMCG|HINDUSTAN UNILEVER|\bITC\b|NESTLE|BRITANNIA|DABUR|MARICO|GODREJ CONSUMER|COLPAL|COLGATE|EMAMI|\bVBL\b|VARUN BEV|TATA CONSUMER|UNITED SPIRITS|UNITED BREWERIES|ZYDUS WELL|JYOTHY|GILLETTE|PROCTER|CONSUMER/.test(n)) return 'FMCG';
  if (/AIRLINE|INDIGO\b|SPICEJET|JET AIRWAYS|\bPAINT\b|ASIAN PAINT|BERGER PAINT|PIDILITE|AKZO NOBEL|KANSAI NEROLAC|INDIGO PAINT/.test(n)) return 'AIRLINES_PAINT';
  if (/INFRASTRUCTURE|CONSTRUCTION|CEMENT|ULTRATECH|AMBUJA|ACC\b|SHREE CEMENT|RAMCO CEM|JK CEMENT|DALMIA|INDIA CEMENT|HEIDELBERG|LARSEN|\bL ?& ?T\b|ADANI ENT|ADANI PORT|ADANI TRANS|GMR|IRB INFRA|KNR CONSTRUCTION|NCC LTD|HG INFRA|PNC INFRATECH|RAIL VIKAS|RVNL|IRCON|RITES|HINDUSTAN CONSTRUCTION/.test(n)) return 'INFRA';
  if (/CHEMICAL|FERTILIZER|FERTILISER|GUJARAT FLUORO|\bUPL\b|\bPI INDUSTRIES|AARTI|DEEPAK|NAVIN FLUORINE|SRF\b|TATA CHEM|GHCL|VINATI|CLEAN SCIENCE|BALAJI AMINES|FINE ORGANICS|ATUL\b|SOLAR INDUST|CHAMBAL FERT|COROMANDEL|GODAVARI BIOR|RALLIS|DHANUKA|HERANBA|SUMITOMO/.test(n)) return 'CHEMICALS';
  return 'OTHER';
}

async function runSectorClassification(env) {
  // Pull top 500 most liquid stocks by 30-day average traded value (₹).
  // 1 paise = ₹0.01 → close_paise × volume / 100 = traded value in ₹.
  // Threshold: avg daily turnover ≥ ₹10 Cr (= 10^9 paise) over 30 days.
  const candidates = await env.DB.prepare(`
    WITH window AS (
      SELECT symbol, AVG(close_paise * 1.0 * volume) AS avg_tv_paise
      FROM equity_eod
      WHERE exchange='NSE'
        AND trade_date >= date('now', '-30 days')
        AND volume IS NOT NULL AND volume > 0
        AND close_paise IS NOT NULL AND close_paise > 0
      GROUP BY symbol
      HAVING avg_tv_paise >= 100000000000
    )
    SELECT w.symbol, k.name
    FROM window w
    LEFT JOIN kite_instruments k
      ON k.tradingsymbol = w.symbol
      AND k.exchange = 'NSE'
      AND k.instrument_type = 'EQ'
    ORDER BY w.avg_tv_paise DESC
    LIMIT 500
  `).all();

  const now = Date.now();
  const rows = [];
  const dist = {};
  for (const c of candidates.results || []) {
    const bucket = classifySector(c.symbol, c.name);
    dist[bucket] = (dist[bucket] || 0) + 1;
    rows.push({
      symbol: c.symbol,
      sector_bucket: bucket,
      source: 'kite_metadata',
      classified_at: now,
    });
  }
  // INSERT OR REPLACE so weekly re-runs refresh classifications. Manual rows
  // (source='manual') are NOT touched here unless a manual symbol shows up
  // in the candidates set — manual classification can be preserved by using
  // a separate (symbol)-keyed row with source='manual' that the classifier
  // intentionally skips. For now: REPLACE wins on PRIMARY KEY conflict; if
  // Nihaf wants protected-manual rows, add `WHERE source='kite_metadata'` to
  // the UPSERT path later. Most overrides today are just data — fine to wipe.
  let written = 0;
  if (rows.length > 0) {
    const cols = ['symbol','sector_bucket','source','classified_at'];
    written = await batchInsert(env.DB, 'sector_classification', cols, rows, 'REPLACE');
  }
  return { rows: written, classified: rows.length, distribution: dist };
}

// Fallback basket if sector_classification is empty (first deploy / pre-ingest).
// Same 70-name set the engine shipped with — guarantees no regression for
// the legacy macro-tilt large-caps.
const FALLBACK_SECTOR_BASKET = {
  BANK_NBFC: ['HDFCBANK','ICICIBANK','SBIN','AXISBANK','KOTAKBANK','BAJFINANCE','BAJAJFINSV','SHRIRAMFIN','INDUSINDBK','FEDERALBNK','PNB','BANKBARODA','CANBK','IDFCFIRSTB'],
  IT_PHARMA: ['INFY','TCS','WIPRO','HCLTECH','TECHM','LTIM','PERSISTENT','SUNPHARMA','DRREDDY','CIPLA','LUPIN','DIVISLAB','APOLLOHOSP','BIOCON'],
  AUTO:      ['MARUTI','TATAMOTORS','M&M','HEROMOTOCO','EICHERMOT','BAJAJ-AUTO','TVSMOTOR','ASHOKLEY','MOTHERSON','BOSCHLTD'],
  METALS:    ['TATASTEEL','JSWSTEEL','HINDALCO','VEDL','COALINDIA','NMDC','NALCO','SAIL','JINDALSTEL'],
  ENERGY:    ['RELIANCE','ONGC','BPCL','IOC','HPCL','GAIL','PETRONET','OIL'],
  FMCG:      ['ITC','HINDUNILVR','NESTLEIND','BRITANNIA','DABUR','MARICO','GODREJCP','TATACONSUM','COLPAL'],
  AIRLINES_PAINT: ['INDIGO','ASIANPAINT','BERGEPAINT','PIDILITIND'],
};

async function loadSectorBasket(env) {
  const r = await env.DB.prepare(
    `SELECT symbol, sector_bucket FROM sector_classification`
  ).all();
  const rows = r.results || [];
  if (rows.length === 0) return FALLBACK_SECTOR_BASKET;
  const basket = {};
  for (const b of SECTOR_BUCKETS) basket[b] = [];
  for (const row of rows) {
    if (!basket[row.sector_bucket]) basket[row.sector_bucket] = [];
    basket[row.sector_bucket].push(row.symbol);
  }
  return basket;
}

// ───────────────────────────────────────────────
// MACRO score — sector tilt based on rate cycle + DXY + crude
// ───────────────────────────────────────────────
async function computeMacroScores(env) {
  // Get latest macro readings
  const macroR = await env.DB.prepare(`
    SELECT indicator_code, value FROM macro_indicators m1
    WHERE m1.observation_date = (SELECT MAX(observation_date) FROM macro_indicators m2 WHERE m2.indicator_code=m1.indicator_code)
  `).all();
  const macro = {};
  for (const m of (macroR.results || [])) macro[m.indicator_code] = m.value;
  const xaR = await env.DB.prepare(`
    SELECT asset_code, value FROM crossasset_ticks c1
    WHERE c1.ts = (SELECT MAX(ts) FROM crossasset_ticks c2 WHERE c2.asset_code=c1.asset_code)
  `).all();
  const xa = {};
  for (const m of (xaR.results || [])) xa[m.asset_code] = m.value;

  const repo = macro.IN_REPO;
  const dxy = xa.DXY;
  const brent = xa.BRENT;
  const us10y = xa.US10Y;

  // Sector tilt heuristics:
  //   Banks/NBFC/Realty/Auto bullish on rate cuts (low repo)
  //   IT/Pharma bullish on weak DXY (export-driven)
  //   Aviation/Paint/Tyres bullish on low crude
  //   Metals bearish on strong DXY
  // The basket now comes from sector_classification (Upgrade 1) covering the
  // full liquid F&O universe instead of the legacy 70-name hardcoded list.
  const sectorBasket = await loadSectorBasket(env);
  // Provide empty arrays for any expected bucket the basket lacks so .forEach
  // calls below never blow up.
  for (const b of ['BANK_NBFC','IT_PHARMA','AUTO','METALS','ENERGY','AIRLINES_PAINT','REALTY','INFRA','CHEMICALS']) {
    if (!sectorBasket[b]) sectorBasket[b] = [];
  }
  const tilt = {};
  // Rate cycle tilt (repo lower = bullish for rate-sensitive sectors).
  // BANK_NBFC: full sensitivity. AUTO: 0.8× (financing-dependent demand).
  // REALTY: full (mortgage-rate driven). INFRA: 0.6× (debt-financed projects).
  if (repo != null) {
    const rateTilt = repo < 6 ? 15 : (repo < 6.5 ? 8 : -5);
    sectorBasket.BANK_NBFC.forEach(s => { tilt[s] = (tilt[s]||0) + rateTilt; });
    sectorBasket.AUTO.forEach(s => { tilt[s] = (tilt[s]||0) + rateTilt * 0.8; });
    sectorBasket.REALTY.forEach(s => { tilt[s] = (tilt[s]||0) + rateTilt; });
    sectorBasket.INFRA.forEach(s => { tilt[s] = (tilt[s]||0) + rateTilt * 0.6; });
  }
  // DXY tilt — weak USD = bullish for export-led sectors, bearish for metals
  // (priced in USD, weak DXY = lower realisation in INR).
  if (dxy != null) {
    const dxyTilt = dxy < 100 ? 12 : (dxy < 105 ? 0 : -10);
    sectorBasket.IT_PHARMA.forEach(s => { tilt[s] = (tilt[s]||0) + dxyTilt; });
    sectorBasket.METALS.forEach(s => { tilt[s] = (tilt[s]||0) - dxyTilt * 0.5; });
  }
  // Crude tilt — low oil = bullish for fuel-burners + chemical input costs,
  // bearish for upstream oil cos.
  if (brent != null) {
    const crudeTilt = brent < 70 ? 10 : (brent < 85 ? 0 : -10);
    sectorBasket.AIRLINES_PAINT.forEach(s => { tilt[s] = (tilt[s]||0) + crudeTilt; });
    sectorBasket.CHEMICALS.forEach(s => { tilt[s] = (tilt[s]||0) + crudeTilt * 0.5; });
    sectorBasket.ENERGY.forEach(s => { tilt[s] = (tilt[s]||0) - crudeTilt * 0.7; });
  }
  // US 10Y rising = headwind for EM
  if (us10y != null && us10y > 4.5) {
    Object.keys(tilt).forEach(s => { tilt[s] -= 5; });
  }
  const out = {};
  for (const sym in tilt) out[sym] = clamp01(50 + tilt[sym]);
  return out;
}

// ───────────────────────────────────────────────
// SENTIMENT score — 7d aggregate news + social
// ───────────────────────────────────────────────
async function computeSentimentScores(env) {
  const since = Date.now() - 7 * 86400000;
  const r = await env.DB.prepare(`
    SELECT symbols_tagged, AVG(sentiment_score) AS s, AVG(importance_score) AS imp, COUNT(*) AS n
    FROM news_items WHERE published_at > ? AND symbols_tagged IS NOT NULL AND symbols_tagged != '[]'
    GROUP BY symbols_tagged
  `).bind(since).all();
  const social = await env.DB.prepare(`
    SELECT symbols_tagged, AVG(sentiment_score) AS s, COUNT(*) AS n
    FROM social_posts WHERE posted_at > ? AND symbols_tagged IS NOT NULL AND symbols_tagged != '[]'
    GROUP BY symbols_tagged
  `).bind(since).all();
  const out = {};
  const acc = (row, weight) => {
    try {
      const syms = JSON.parse(row.symbols_tagged || '[]');
      for (const s of syms) {
        out[s] = out[s] || { s: 0, w: 0 };
        out[s].s += (row.s || 0) * weight;
        out[s].w += weight;
      }
    } catch {}
  };
  for (const row of (r.results || [])) acc(row, (row.imp || 0.3) * Math.log(1 + (row.n || 0)));
  for (const row of (social.results || [])) acc(row, 0.3 * Math.log(1 + (row.n || 0)));
  const final = {};
  for (const sym in out) {
    const avg = out[sym].w > 0 ? out[sym].s / out[sym].w : 0;
    final[sym] = clamp01(50 + avg * 50);
  }
  return final;
}

// ───────────────────────────────────────────────
// BREADTH score — volume × price-direction proxy
//
// Original design used delivery_pct (institutional accumulation ratio) but
// NSE's sec_bhavdata_full.csv ingestion isn't running yet, so delivery_pct
// is null in 100% of equity_eod rows. Falls back to:
//   volume_today / volume_20d_avg × price_change_today
// Logic:
//   • Up move on high volume = institutional accumulation → high score
//   • Down move on high volume = distribution → low score
//   • Flat / low volume = no signal → 50 default
// When sec_bhavdata_full ingestion is fixed, we'll prefer delivery_pct again.
// ───────────────────────────────────────────────
async function computeBreadthScores(env) {
  const r = await env.DB.prepare(`
    WITH latest AS (
      SELECT symbol, close_paise, prev_close_paise, volume,
        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) AS rn
      FROM equity_eod
      WHERE exchange='NSE' AND trade_date >= date('now', '-21 days')
    ),
    avg_vol AS (
      SELECT symbol, AVG(volume) AS v20
      FROM equity_eod
      WHERE exchange='NSE' AND trade_date >= date('now', '-21 days')
        AND volume > 0
      GROUP BY symbol
      HAVING COUNT(*) >= 5
    )
    SELECT l.symbol, l.close_paise, l.prev_close_paise, l.volume, a.v20
    FROM latest l
    LEFT JOIN avg_vol a ON a.symbol = l.symbol
    WHERE l.rn = 1 AND l.close_paise > 0 AND l.prev_close_paise > 0 AND l.volume > 0
  `).all();

  const out = {};
  for (const row of (r.results || [])) {
    const priceChangePct = (row.close_paise - row.prev_close_paise) / row.prev_close_paise * 100;
    const volRatio = (row.v20 && row.v20 > 0) ? (row.volume / row.v20) : 1;
    // Volume amplifies the price-move signal
    // Cap volRatio at 0.4 - 2.5 so single outliers don't dominate
    const cappedVol = Math.max(0.4, Math.min(2.5, volRatio));
    // priceChangePct ±5% = ±20 score, multiplied by volume strength
    const priceComponent = Math.max(-20, Math.min(20, priceChangePct * 4));
    const score = 50 + priceComponent * cappedVol;
    out[row.symbol] = clamp01(score);
  }
  return out;
}

// ───────────────────────────────────────────────
// RETAIL BUZZ score — mention velocity 24h vs 7d
//
// Captures sudden retail attention surges from Reddit + Stocktwits + Nitter.
// Logic:
//   • mentions_24h / (mentions_7d / 7) = velocity ratio
//   • velocity_ratio = 1.0 → no change → score 50
//   • velocity_ratio = 2.0 → 2× normal → log(2)*15 ≈ +10 → score 60
//   • velocity_ratio = 5.0 → 5× normal → log(5)*15 ≈ +24 → score 74
//   • velocity_ratio = 0.5 → half normal → log(0.5)*15 ≈ -10 → score 40
// Applies floor of 3 mentions in 7d to avoid noise from one-off mentions.
// Engagement-weighted: each post counts as 1 + min(2, engagement_score) so
// viral posts amplify the signal.
// ───────────────────────────────────────────────
async function computeRetailBuzzScores(env) {
  const now = Date.now();
  const since7d = now - 7 * 86400000;
  const since24h = now - 24 * 3600000;
  // Pull all posts last 7d that have a tagged symbol — compute in JS since
  // symbols_tagged is a JSON array (D1/SQLite has no native UNNEST).
  const r = await env.DB.prepare(`
    SELECT symbols_tagged, posted_at, engagement_score
    FROM social_posts
    WHERE posted_at > ? AND symbols_tagged IS NOT NULL AND symbols_tagged != '[]'
  `).bind(since7d).all();

  const counts = {};   // sym -> { c7: weight7d, c24: weight24h }
  for (const row of (r.results || [])) {
    let syms;
    try { syms = JSON.parse(row.symbols_tagged); } catch { continue; }
    if (!Array.isArray(syms) || syms.length === 0) continue;
    // Engagement bonus: +1 base, +min(2, engagement) for viral posts.
    const w = 1 + Math.min(2, Math.max(0, row.engagement_score || 0));
    const inLast24h = row.posted_at > since24h;
    for (const s of syms) {
      counts[s] = counts[s] || { c7: 0, c24: 0 };
      counts[s].c7 += w;
      if (inLast24h) counts[s].c24 += w;
    }
  }
  const out = {};
  for (const sym in counts) {
    const { c7, c24 } = counts[sym];
    if (c7 < 3) continue;   // noise floor
    const baselinePerDay = c7 / 7;
    if (baselinePerDay <= 0) continue;
    const velocity = c24 / baselinePerDay;
    // Score: 50 + log(velocity) × 15, clamped 0-100.
    // Use natural log; velocity=1 → 50, velocity=e≈2.7 → 65, velocity=10 → 84.
    const score = 50 + Math.log(Math.max(0.01, velocity)) * 15;
    out[sym] = clamp01(score);
  }
  return out;
}

// ───────────────────────────────────────────────
// QUALITY score — Screener.in fundamentals (P/E, ROE, D/E, etc).
// Pre-computed weekly by wealth-fundamentals; we just read the snapshot.
// Stale rows (>21 days) are dropped so old data doesn't poison the composite.
// ───────────────────────────────────────────────
async function computeQualityScores(env) {
  const cutoff = Date.now() - 21 * 86400000;
  const r = await env.DB.prepare(
    `SELECT symbol, quality_score FROM fundamentals_snapshot
     WHERE refreshed_at >= ? AND quality_score IS NOT NULL`
  ).bind(cutoff).all();
  const out = {};
  for (const row of (r.results || [])) {
    out[row.symbol] = clamp01(row.quality_score);
  }
  return out;
}

// ───────────────────────────────────────────────
// REGIME DETECTOR (Upgrade 3)
//
// Reads the latest Nifty 50 (~21 trading days) + India VIX, computes 20d/50d
// % change vs the older bar, classifies the prevailing regime. Source of
// truth: indices_eod (populated by wealth-price-core /api/allIndices ingest).
//
// Regime rules:
//   strong_trending_up     VIX < 13 AND nifty_20d > +4% AND nifty_50d > +8%
//   strong_trending_down   VIX < 13 AND nifty_20d < -4% AND nifty_50d < -8%
//   high_vol               VIX > 18 (overrides everything else)
//   ranging                VIX 13-18 AND |nifty_20d| < 2%
//   transitioning          everything else (default)
//
// Returns: { regime, evidence: { nifty_20d_pct, nifty_50d_pct, vix } }
// On data shortage (e.g. <50 trading days of indices_eod), returns
// 'transitioning' with whatever evidence was readable. Never throws.
// ───────────────────────────────────────────────
async function detectRegime(env) {
  const evidence = { nifty_20d_pct: null, nifty_50d_pct: null, vix: null };
  // Latest 60 Nifty 50 bars (covers 20d + 50d window with buffer).
  const niftyR = await env.DB.prepare(
    `SELECT trade_date, close_paise FROM indices_eod
     WHERE index_name='NIFTY 50' AND close_paise IS NOT NULL AND close_paise > 0
     ORDER BY trade_date DESC LIMIT 60`
  ).all();
  const nifty = niftyR.results || [];
  if (nifty.length >= 51) {
    const c0 = nifty[0].close_paise;
    const c20 = nifty[20].close_paise;   // 20 trading days ago
    const c50 = nifty[50].close_paise;   // 50 trading days ago
    if (c20 > 0) evidence.nifty_20d_pct = (c0 - c20) / c20 * 100;
    if (c50 > 0) evidence.nifty_50d_pct = (c0 - c50) / c50 * 100;
  } else if (nifty.length >= 21) {
    // Partial data — emit only the 20d signal.
    const c0 = nifty[0].close_paise;
    const c20 = nifty[20].close_paise;
    if (c20 > 0) evidence.nifty_20d_pct = (c0 - c20) / c20 * 100;
  }
  // India VIX latest close.
  const vixR = await env.DB.prepare(
    `SELECT close_paise FROM indices_eod
     WHERE index_name='INDIA VIX' AND close_paise IS NOT NULL AND close_paise > 0
     ORDER BY trade_date DESC LIMIT 1`
  ).first();
  if (vixR && vixR.close_paise) evidence.vix = vixR.close_paise / 100;

  const { nifty_20d_pct: n20, nifty_50d_pct: n50, vix } = evidence;
  let regime = 'transitioning';
  if (vix != null && vix > 18) {
    regime = 'high_vol';
  } else if (vix != null && vix < 13 && n20 != null && n50 != null) {
    if (n20 > 4 && n50 > 8) regime = 'strong_trending_up';
    else if (n20 < -4 && n50 < -8) regime = 'strong_trending_down';
  } else if (vix != null && vix >= 13 && vix <= 18 && n20 != null && Math.abs(n20) < 2) {
    regime = 'ranging';
  }
  return { regime, evidence };
}

// ───────────────────────────────────────────────
// MAIN — compute composite scores for all symbols
// ───────────────────────────────────────────────
async function computeAll(env) {
  // Step 0 — detect regime FIRST. If strong_trending_down, abort (no shorting).
  const regimeResult = await detectRegime(env);
  const regime = regimeResult.regime;
  const weights = REGIME_WEIGHTS[regime];
  if (weights === null) {
    // strong_trending_down: emit nothing. Cards UI sees no fresh row → falls
    // back to last good batch with a banner ("market in strong downtrend").
    return {
      rows: 0,
      symbols: 0,
      regime,
      regime_evidence: regimeResult.evidence,
      skipped: 'strong_trending_down',
    };
  }

  const [trendResult, flow, options, catalyst, macro, sentiment, breadth, retailBuzz, quality] = await Promise.all([
    computeTrendScores(env),
    computeFlowScores(env),
    computeOptionsScores(env),
    computeCatalystScores(env),
    computeMacroScores(env),
    computeSentimentScores(env),
    computeBreadthScores(env),
    computeRetailBuzzScores(env),
    computeQualityScores(env),
  ]);
  const trend = trendResult.scores;
  const mtfMap = trendResult.mtf;

  const allSyms = new Set([
    ...Object.keys(trend),
    ...Object.keys(flow),
    ...Object.keys(options),
    ...Object.keys(catalyst),
    ...Object.keys(macro),
    ...Object.keys(sentiment),
    ...Object.keys(breadth),
    ...Object.keys(retailBuzz),
    ...Object.keys(quality),
  ]);

  const computedAt = Date.now();
  const rows = [];
  let mtfDist = { aligned_up: 0, partial_up: 0, mixed: 0, against_macro: 0, aligned_down: 0, unknown: 0 };
  for (const sym of allSyms) {
    const t = trend[sym] ?? 50;
    const f = flow[sym] ?? 50;
    const o = options[sym] ?? 50;
    const c = catalyst[sym] ?? 50;
    const m = macro[sym] ?? 50;
    const s = sentiment[sym] ?? 50;
    const b = breadth[sym] ?? 50;
    const rb = retailBuzz[sym] ?? 50;
    const q = quality[sym] ?? 50;
    const mtf = mtfMap[sym] ?? null;

    let composite =
      weights.trend * t +
      weights.flow * f +
      weights.options * o +
      weights.catalyst * c +
      weights.macro * m +
      weights.sentiment * s +
      weights.breadth * b +
      weights.retail_buzz * rb +
      weights.quality * q;

    // MTF alignment veto (Upgrade 2): force composite to 0 for stocks fighting
    // the macro tide or aligned-down. UI will skip these on the cards rail.
    // 'mixed' and 'partial_up' continue through unchanged — those carry signal.
    if (mtf === 'against_macro' || mtf === 'aligned_down') {
      composite = 0;
    }

    mtfDist[mtf || 'unknown']++;

    rows.push({
      computed_at: computedAt,
      symbol: sym,
      trend_score: t,
      flow_score: f,
      options_score: o,
      catalyst_score: c,
      macro_score: m,
      sentiment_score: s,
      breadth_score: b,
      retail_buzz_score: rb,
      quality_score: q,
      composite_score: composite,
      rationale_json: JSON.stringify({ t, f, o, c, m, s, b, rb, q, regime, mtf }),
      mtf_alignment: mtf,
      regime,
    });
  }
  const cols = ['computed_at','symbol','trend_score','flow_score','options_score','catalyst_score',
    'macro_score','sentiment_score','breadth_score','retail_buzz_score','quality_score',
    'composite_score','rationale_json','mtf_alignment','regime'];
  const written = await batchInsert(env.DB, 'signal_scores', cols, rows, 'REPLACE');
  return {
    rows: written,
    symbols: allSyms.size,
    regime,
    regime_evidence: regimeResult.evidence,
    mtf_distribution: mtfDist,
  };
}

// ───────────────────────────────────────────────
// CASCADE detection — known event → reaction patterns
// ───────────────────────────────────────────────
async function detectCascades(env) {
  const detectedAt = Date.now();
  const cascades = [];

  // 1. RBI rate-cut cascade — bank stocks rally → NBFC rally lag 1-2 days
  const repo = (await env.DB.prepare(
    `SELECT value, observation_date FROM macro_indicators
     WHERE indicator_code='IN_REPO' ORDER BY observation_date DESC LIMIT 2`
  ).all()).results || [];
  if (repo.length === 2 && repo[0].value < repo[1].value) {
    cascades.push({
      detected_at: detectedAt,
      pattern_name: 'RBI_RATE_CUT_NBFC_LAG',
      source_event_id: `repo:${repo[0].observation_date}`,
      expected_window_start: detectedAt + 86400000,
      expected_window_end: detectedAt + 5 * 86400000,
      affected_symbols: JSON.stringify(['BAJFINANCE','BAJAJFINSV','SHRIRAMFIN','CHOLAFIN','MMFS']),
      historical_win_rate: 0.68,
      expected_return_pct: 4.5,
      status: 'active',
    });
  }

  // 2. FII selling 3+ consecutive days >₹3000cr → midcap capitulation → quality-midcap bounce
  const fiiR = (await env.DB.prepare(
    `SELECT trade_date, fii_net_cr FROM fii_dii_daily
     WHERE segment='cash' ORDER BY trade_date DESC LIMIT 3`
  ).all()).results || [];
  if (fiiR.length === 3 && fiiR.every(d => d.fii_net_cr < -3000)) {
    cascades.push({
      detected_at: detectedAt,
      pattern_name: 'FII_HEAVY_SELLING_QUALITY_BOUNCE',
      source_event_id: `fii:${fiiR[0].trade_date}`,
      expected_window_start: detectedAt + 2 * 86400000,
      expected_window_end: detectedAt + 7 * 86400000,
      affected_symbols: JSON.stringify(['NIFTY MIDCAP 100']),
      historical_win_rate: 0.72,
      expected_return_pct: 5.5,
      status: 'active',
    });
  }

  // 3. Crude drop >3% overnight → aviation/paint open buy
  const brent = (await env.DB.prepare(
    `SELECT value, ts FROM crossasset_ticks WHERE asset_code='BRENT' ORDER BY ts DESC LIMIT 100`
  ).all()).results || [];
  if (brent.length >= 50) {
    const recent = brent[0].value;
    const dayAgo = brent[Math.min(brent.length - 1, 95)].value;
    if (dayAgo && (recent - dayAgo) / dayAgo < -0.03) {
      cascades.push({
        detected_at: detectedAt,
        pattern_name: 'CRUDE_DROP_AVIATION_PAINT',
        source_event_id: `brent:${brent[0].ts}`,
        expected_window_start: detectedAt,
        expected_window_end: detectedAt + 86400000,
        affected_symbols: JSON.stringify(['INDIGO','ASIANPAINT','BERGEPAINT','PIDILITIND','APOLLOTYRE']),
        historical_win_rate: 0.65,
        expected_return_pct: 3.2,
        status: 'active',
      });
    }
  }

  // 4. REPEAT_BLOCK_BUYER — runs separately (dedicated detector below) so it
  //    can also be invoked from its own cron + HTTP endpoint with rich
  //    evidence_json + idempotent dedupe. We call it here but do NOT push to
  //    the local `cascades` array since detectRepeatBlockBuyer inserts itself.
  const rbStats = await detectRepeatBlockBuyer(env);
  // (rbStats.rows reflects newly-inserted REPEAT_BLOCK_BUYER triggers — surfaced
  // separately so we don't double-count in the unified rows-written tally.)

  // 5. Promoter pledge spike >5% → 2-3 day risk window
  const pledge = (await env.DB.prepare(
    `SELECT p1.symbol, p1.pledged_pct AS now_p, p2.pledged_pct AS prev_p
     FROM promoter_pledge p1
     JOIN promoter_pledge p2 ON p1.symbol = p2.symbol AND p2.filing_date < p1.filing_date
     WHERE p1.filing_date >= date('now', '-7 days')
       AND p1.pledged_pct - p2.pledged_pct > 5
     GROUP BY p1.symbol`
  ).all()).results || [];
  for (const p of pledge) {
    cascades.push({
      detected_at: detectedAt,
      pattern_name: 'PLEDGE_SPIKE_RISK',
      source_event_id: `pledge:${p.symbol}`,
      expected_window_start: detectedAt,
      expected_window_end: detectedAt + 3 * 86400000,
      affected_symbols: JSON.stringify([p.symbol]),
      historical_win_rate: 0.75,
      expected_return_pct: -10,
      status: 'active',
    });
  }

  let written = 0;
  if (cascades.length > 0) {
    const cols = ['detected_at','pattern_name','source_event_id','expected_window_start',
      'expected_window_end','affected_symbols','historical_win_rate','expected_return_pct','status'];
    written = await batchInsert(env.DB, 'cascade_triggers_active', cols, cascades, 'IGNORE');
  }
  // Total rows written = generic cascades + repeat-block-buyer rows
  const rbRows = (rbStats && rbStats.rows) || 0;
  return { rows: written + rbRows, cascades: cascades.length, repeat_block_buyer: rbStats };
}

// ───────────────────────────────────────────────
// REPEAT_BLOCK_BUYER detector (dedicated)
//
// Pattern: same institutional client buys the SAME stock on 3+ distinct
// trading days within a rolling 5-day window. That's accumulation behaviour
// — historical hit-rate ~65-70% over the next 5-10 trading days, ~5%
// expected return. Lower hit-rate but higher quantity than the looser
// 2-buy threshold; matches institutional "build a position" flow.
//
// Idempotent: skips (symbol, client) pairs that already have an active
// REPEAT_BLOCK_BUYER trigger. Runs as part of detectCascades AND on its
// own cron at 18:05 IST (after bulk_block_deals refresh at 17:30 IST).
// ───────────────────────────────────────────────
async function detectRepeatBlockBuyer(env) {
  const detectedAt = Date.now();

  // Find (symbol, client) pairs with ≥3 distinct buy days in last 5 days
  const candidates = (await env.DB.prepare(`
    SELECT symbol,
           client_name,
           COUNT(DISTINCT trade_date) AS days,
           SUM(qty) AS total_qty,
           AVG(price_paise) AS avg_price,
           MIN(price_paise) AS min_price,
           MAX(price_paise) AS max_price,
           GROUP_CONCAT(DISTINCT trade_date) AS dates
    FROM bulk_block_deals
    WHERE txn_type='buy'
      AND trade_date >= date('now', '-5 days')
      AND client_name IS NOT NULL AND client_name != ''
      AND symbol IS NOT NULL AND symbol != ''
    GROUP BY symbol, client_name
    HAVING days >= 3
    ORDER BY days DESC, total_qty DESC
    LIMIT 50
  `).all()).results || [];

  let inserted = 0;
  const samples = [];
  for (const row of candidates) {
    // Dedupe: skip if an active REPEAT_BLOCK_BUYER trigger already exists
    // for this exact (symbol, client_name). Use source_event_id which we
    // build deterministically from the pair — exact match, no LIKE scan.
    const sourceId = `block:${row.symbol}:${row.client_name}`;
    const existing = await env.DB.prepare(`
      SELECT id FROM cascade_triggers_active
      WHERE pattern_name='REPEAT_BLOCK_BUYER'
        AND status='active'
        AND source_event_id=?
        AND expected_window_end > ?
      LIMIT 1
    `).bind(sourceId, detectedAt).first();
    if (existing) continue;

    const evidence = {
      client: row.client_name,
      days_buying: row.days,
      total_qty: row.total_qty,
      avg_price_paise: Math.round(row.avg_price || 0),
      min_price_paise: row.min_price,
      max_price_paise: row.max_price,
      dates: (row.dates || '').split(',').filter(Boolean).sort(),
    };

    await env.DB.prepare(`
      INSERT INTO cascade_triggers_active
        (detected_at, pattern_name, source_event_id, expected_window_start,
         expected_window_end, affected_symbols, historical_win_rate,
         expected_return_pct, status, evidence_json)
      VALUES (?, 'REPEAT_BLOCK_BUYER', ?, ?, ?, ?, 0.68, 5.0, 'active', ?)
    `).bind(
      detectedAt,
      sourceId,
      detectedAt,
      detectedAt + 10 * 86400000,                  // 10-day expiry
      JSON.stringify([row.symbol]),
      JSON.stringify(evidence)
    ).run();

    inserted++;
    if (samples.length < 10) {
      samples.push({ symbol: row.symbol, client: row.client_name, days: row.days, total_qty: row.total_qty });
    }
  }

  return { rows: inserted, candidates: candidates.length, samples };
}

// ───────────────────────────────────────────────
// Cron schedule (paid tier — max freshness)
// IST → UTC: subtract 5h30m
// Composite scoring runs nightly at 19:00 IST + every hour during market hours
// (so trade cards refresh intraday based on incoming flow data)
// Cascade detection fires after composite to detect new patterns
// ───────────────────────────────────────────────
const CRON_DISPATCH = {
  // Nightly post-close: full recompute + cascade detection
  '30 13 * * 1-5':  { name: 'compute_all_nightly',     fn: async (env) => { const a = await computeAll(env); const b = await detectCascades(env); return { rows: (a.rows||0)+(b.rows||0) }; } },
  // Pre-market 08:30 IST: refresh cascades on overnight US/Asia data
  '0 3 * * 1-5':    { name: 'cascade_premarket',       fn: detectCascades },
  // Hourly during market: live composite refresh on accumulating intraday data
  // TZ-6 fix May 6 2026: extended from '0 4-9' (09:30-14:30 IST) to '0 4-10'
  // (09:30-15:30 IST) so closing-tick recompute fires before autopsy runs.
  '0 4-10 * * 1-5': { name: 'compute_intraday_hourly', fn: computeAll },
  // Every 30 min during market: cascade re-scan (09:30-15:00 IST)
  '*/30 4-9 * * 1-5': { name: 'cascade_intraday',      fn: detectCascades },
  // 18:05 IST = UTC 12:35 — fires after bulk/block deals refresh (~17:30 IST)
  // so any same-day repeat-buyer accumulation is detected on the same evening.
  '35 12 * * 1-5':  { name: 'cascade_repeat_block',    fn: detectRepeatBlockBuyer },
  // Weekly Sunday 08:30 IST = UTC 03:00 Sun — refresh sector_classification
  // off the latest kite_instruments name dump + 30-day liquidity ranking.
  // (CF rejects `0` for Sunday in DOW field; `7` is the accepted alias.)
  '0 3 * * 7':      { name: 'classify_sectors_weekly', fn: runSectorClassification },
};

async function runCron(env, cronExpr) {
  const entry = CRON_DISPATCH[cronExpr];
  if (!entry) return;
  const id = await logCronStart(env.DB, WORKER_NAME, entry.name, 'cron');
  try {
    const r = await entry.fn(env);
    await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
    await markSourceHealth(env.DB, entry.name, true);
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e).slice(0, 500));
    await markSourceHealth(env.DB, entry.name, false, e);
  }
}

const HTTP_HANDLERS = {
  compute_all: computeAll,
  detect_cascades: detectCascades,
  cascade_repeat_block: detectRepeatBlockBuyer,
  // Sector classification ingest (Upgrade 1) — typically run weekly.
  classify_sectors: runSectorClassification,
  // Inspect-only: returns regime classification + evidence without writing.
  detect_regime: async (env) => detectRegime(env),
  // Inspect-only: returns retail-buzz distribution without writing
  compute_retail_buzz: async (env) => {
    const out = await computeRetailBuzzScores(env);
    const scores = Object.values(out);
    const sorted = Object.entries(out).sort((a, b) => b[1] - a[1]);
    const top10 = sorted.slice(0, 10).map(([sym, sc]) => ({ symbol: sym, score: Number(sc.toFixed(2)) }));
    const bottom5 = sorted.slice(-5).map(([sym, sc]) => ({ symbol: sym, score: Number(sc.toFixed(2)) }));
    const avg = scores.length > 0 ? scores.reduce((a,b) => a+b, 0) / scores.length : 0;
    const buckets = { lt30: 0, b30_50: 0, b50_70: 0, gte70: 0 };
    for (const s of scores) {
      if (s < 30) buckets.lt30++;
      else if (s < 50) buckets.b30_50++;
      else if (s < 70) buckets.b50_70++;
      else buckets.gte70++;
    }
    return { rows: scores.length, symbols: scores.length, avg: Number(avg.toFixed(2)), buckets, top10, bottom5 };
  },
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });

    if (url.pathname === '/top') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const r = await env.DB.prepare(`
        SELECT s.* FROM signal_scores s
        JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m
        ORDER BY s.composite_score DESC LIMIT ?
      `).bind(limit).all();
      return Response.json({ signals: r.results });
    }

    if (url.pathname === '/cascades') {
      const r = await env.DB.prepare(`
        SELECT * FROM cascade_triggers_active
        WHERE status='active' AND expected_window_end > ?
        ORDER BY detected_at DESC LIMIT 50
      `).bind(Date.now()).all();
      return Response.json({ cascades: r.results });
    }

    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, WORKER_NAME, m[1], 'http');
      try {
        const r = await HTTP_HANDLERS[m[1]](env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return new Response('wealth-signal-engine: try /top, /cascades, /run/compute_all, /run/detect_cascades, /run/classify_sectors, /run/detect_regime', { status: 200 });
  },
};
