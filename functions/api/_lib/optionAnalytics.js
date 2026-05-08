// ═══════════════════════════════════════════════════════════════════════════
// Option chain derived analytics
//
// Reads option_chain_snapshot rows for a given underlying + most recent
// expiry, then computes the "smart money" derivatives:
//
//   PCR (Put-Call Ratio)           = total PE OI / total CE OI
//                                    > 1.3 = bearish positioning (or hedged)
//                                    < 0.7 = bullish positioning
//                                    1.0   = neutral
//
//   PCR (Volume-based)             = day's PE volume / CE volume
//                                    Faster-moving than OI-based PCR
//
//   Max Pain                       = strike where total option holders lose
//                                    the most. Spot tends to gravitate here on
//                                    expiry day. Best 1-day-before-expiry tell.
//
//   IV Skew (25-delta call vs put) = OTM call IV − OTM put IV
//                                    Positive = call demand (bullish)
//                                    Negative = put demand (bearish, fear)
//
//   ATM IV                         = average IV at strike closest to spot
//                                    Compared to India VIX = consistency check
//
//   Gamma Exposure (GEX)           = Σ (CE gamma × CE OI − PE gamma × PE OI)
//                                    × strike. Positive = market-makers long gamma
//                                    (suppresses moves). Negative = unstable.
//                                    NOTE: requires Greeks which NSE doesn't
//                                    provide directly — we approximate via IV.
//
//   Net Long Build / Short Build  = sum of (CE chg_oi vs PE chg_oi) intraday.
// ═══════════════════════════════════════════════════════════════════════════

// Compute all derived analytics for a single underlying.
// Returns null if no data available.
export async function computeOptionAnalytics(db, underlying = 'NIFTY') {
  // Find the most recent snapshot timestamp + nearest expiry
  const latest = await db.prepare(`
    SELECT ts, expiry, underlying_paise
    FROM option_chain_snapshot
    WHERE underlying = ?
    ORDER BY ts DESC, expiry ASC
    LIMIT 1
  `).bind(underlying).first();
  if (!latest) return null;

  const ts = latest.ts;
  const expiry = latest.expiry;
  const spot = latest.underlying_paise;

  // Pull the entire chain at this snapshot+expiry
  const chain = (await db.prepare(`
    SELECT strike_paise, ce_oi, ce_chg_oi, ce_volume, ce_iv, ce_ltp_paise,
           pe_oi, pe_chg_oi, pe_volume, pe_iv, pe_ltp_paise
    FROM option_chain_snapshot
    WHERE underlying = ? AND ts = ? AND expiry = ?
    ORDER BY strike_paise ASC
  `).bind(underlying, ts, expiry).all()).results || [];

  if (chain.length === 0) return null;

  // ────────── 1. PCR (OI-based) ──────────
  const totalCeOi = chain.reduce((s, r) => s + (r.ce_oi || 0), 0);
  const totalPeOi = chain.reduce((s, r) => s + (r.pe_oi || 0), 0);
  const pcrOi = totalCeOi > 0 ? totalPeOi / totalCeOi : null;

  const totalCeVol = chain.reduce((s, r) => s + (r.ce_volume || 0), 0);
  const totalPeVol = chain.reduce((s, r) => s + (r.pe_volume || 0), 0);
  const pcrVolume = totalCeVol > 0 ? totalPeVol / totalCeVol : null;

  // ────────── 2. Max Pain ──────────
  // For each strike S, total cash payout to OPTION HOLDERS at expiry =
  //   Σ (max(spot−strike, 0) × ce_oi   for all CE) +
  //   Σ (max(strike−spot, 0) × pe_oi   for all PE)
  // Max pain is the strike where this total is LOWEST (option holders lose most,
  // option writers profit most). Spot tends to gravitate here near expiry.
  let maxPainStrike = null;
  let minPayout = Infinity;
  for (const candidate of chain) {
    const candidateStrike = candidate.strike_paise;
    let totalPayout = 0;
    for (const row of chain) {
      const ce = Math.max(0, candidateStrike - row.strike_paise) * (row.ce_oi || 0);
      const pe = Math.max(0, row.strike_paise - candidateStrike) * (row.pe_oi || 0);
      totalPayout += ce + pe;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      maxPainStrike = candidateStrike;
    }
  }

  // ────────── 3. ATM IV + IV Skew ──────────
  // Find the strike closest to spot
  let atmIdx = 0;
  let minDist = Infinity;
  chain.forEach((r, i) => {
    const dist = Math.abs(r.strike_paise - spot);
    if (dist < minDist) { minDist = dist; atmIdx = i; }
  });
  const atm = chain[atmIdx];
  const atmIv = average([atm.ce_iv, atm.pe_iv].filter(v => v != null && v > 0));

  // 25-delta proxy: pick the strike ~5% OTM on each side
  // (precise delta calc needs Black-Scholes; this is a reasonable approximation)
  const otmCallTarget = spot * 1.05;
  const otmPutTarget  = spot * 0.95;
  const otmCall = nearestStrike(chain, otmCallTarget);
  const otmPut  = nearestStrike(chain, otmPutTarget);
  const ivSkew = (otmCall?.ce_iv != null && otmPut?.pe_iv != null)
    ? otmCall.ce_iv - otmPut.pe_iv
    : null;

  // ────────── 4. OI build/unwind ──────────
  const ceOiBuild  = chain.reduce((s, r) => s + Math.max(0, r.ce_chg_oi || 0), 0);
  const peOiBuild  = chain.reduce((s, r) => s + Math.max(0, r.pe_chg_oi || 0), 0);
  const ceOiUnwind = chain.reduce((s, r) => s + Math.min(0, r.ce_chg_oi || 0), 0);
  const peOiUnwind = chain.reduce((s, r) => s + Math.min(0, r.pe_chg_oi || 0), 0);

  // Sentiment regime classification — single-line interpretation
  const regime = classifyRegime({ pcrOi, ivSkew, ceOiBuild, peOiBuild, spot, maxPainStrike });

  return {
    underlying,
    ts,
    expiry,
    spot_paise: spot,
    strikes_count: chain.length,
    // PCR
    pcr_oi: pcrOi != null ? parseFloat(pcrOi.toFixed(3)) : null,
    pcr_volume: pcrVolume != null ? parseFloat(pcrVolume.toFixed(3)) : null,
    total_ce_oi: totalCeOi,
    total_pe_oi: totalPeOi,
    // Max Pain
    max_pain_paise: maxPainStrike,
    max_pain_distance_pct: maxPainStrike && spot
      ? parseFloat(((maxPainStrike - spot) / spot * 100).toFixed(2))
      : null,
    // IV
    atm_iv: atmIv != null ? parseFloat(atmIv.toFixed(2)) : null,
    iv_skew_pct: ivSkew != null ? parseFloat(ivSkew.toFixed(2)) : null,
    // OI flow
    ce_oi_build: ceOiBuild,
    pe_oi_build: peOiBuild,
    ce_oi_unwind: ceOiUnwind,
    pe_oi_unwind: peOiUnwind,
    net_oi_build: peOiBuild - ceOiBuild, // positive = put writing > call writing = bullish
    // Regime
    regime,
  };
}

function average(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function nearestStrike(chain, target) {
  let best = null, bestDist = Infinity;
  for (const r of chain) {
    const d = Math.abs(r.strike_paise - target);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return best;
}

// Translate raw numbers into a 1-sentence regime call.
function classifyRegime({ pcrOi, ivSkew, ceOiBuild, peOiBuild, spot, maxPainStrike }) {
  if (pcrOi == null) return { tone: 'unknown', label: 'insufficient data', score: 50 };

  // Bullish indicators
  const bullishHits = [];
  const bearishHits = [];

  if (pcrOi > 1.3) bullishHits.push(`PCR ${pcrOi.toFixed(2)} (puts crowded — contrarian bullish)`);
  if (pcrOi < 0.7) bearishHits.push(`PCR ${pcrOi.toFixed(2)} (calls crowded — contrarian bearish)`);

  if (ivSkew != null) {
    if (ivSkew > 1.5) bullishHits.push(`call skew +${ivSkew.toFixed(1)}% (call demand)`);
    if (ivSkew < -1.5) bearishHits.push(`put skew ${ivSkew.toFixed(1)}% (fear)`);
  }

  if (peOiBuild > ceOiBuild * 1.3) bullishHits.push('put-writing (support building)');
  if (ceOiBuild > peOiBuild * 1.3) bearishHits.push('call-writing (resistance building)');

  if (maxPainStrike && spot) {
    const distPct = (maxPainStrike - spot) / spot * 100;
    if (Math.abs(distPct) > 1.5) {
      const direction = distPct > 0 ? 'higher' : 'lower';
      // Max pain is a magnet — spot tends to drift toward it
      if (distPct > 1.5) bullishHits.push(`max pain ${distPct.toFixed(1)}% ${direction}`);
      else if (distPct < -1.5) bearishHits.push(`max pain ${distPct.toFixed(1)}% ${direction}`);
    }
  }

  const score = 50 + (bullishHits.length * 10) - (bearishHits.length * 10);
  let tone = 'neutral';
  let label = 'mixed signals';
  if (bullishHits.length > bearishHits.length + 1) {
    tone = 'bullish';
    label = bullishHits.join(' · ');
  } else if (bearishHits.length > bullishHits.length + 1) {
    tone = 'bearish';
    label = bearishHits.join(' · ');
  } else if (bullishHits.length === 0 && bearishHits.length === 0) {
    tone = 'neutral';
    label = `PCR ${pcrOi?.toFixed(2)} — balanced`;
  } else {
    label = [...bullishHits, ...bearishHits].join(' · ');
  }

  return { tone, label, score: Math.max(0, Math.min(100, score)) };
}
