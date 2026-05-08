// ═══════════════════════════════════════════════════════════════════════════
// Transaction cost model — Indian equity delivery (CNC)
// Sources verified against Zerodha brokerage calculator + NSE/BSE 2026 rates.
//
// All inputs/outputs in paise (INTEGER). Convert to rupees only at display.
// ═══════════════════════════════════════════════════════════════════════════

// Zerodha CNC delivery brokerage = ₹0 (free for delivery as of 2026)
// But intraday/MIS = lesser of 0.03% or ₹20 per executed order
const BROKERAGE_CNC_PAISE = 0;
const BROKERAGE_INTRADAY_FLAT = 2000; // ₹20 in paise
const BROKERAGE_INTRADAY_PCT  = 0.03;

// Statutory charges (% of trade value unless noted)
const STT_DELIVERY_SELL  = 0.001;   // 0.1% on SELL only (delivery)
const STT_INTRADAY_SELL  = 0.00025; // 0.025% on SELL only (intraday)
const EXCHANGE_TXN_NSE   = 0.0000297; // 0.00297% per side (NSE 2026)
const EXCHANGE_TXN_BSE   = 0.0000375; // 0.00375% per side (BSE)
const SEBI_CHARGES       = 0.000001;  // ₹10 per crore = 0.0001% per side
const STAMP_DUTY_DELIVERY = 0.00015; // 0.015% on BUY only (delivery)
const STAMP_DUTY_INTRADAY = 0.00003; // 0.003% on BUY only (intraday)
const GST_ON_CHARGES     = 0.18;     // 18% on (brokerage + exchange + SEBI)
const DP_CHARGES_PAISE   = 1556;     // ~₹15.56 per scrip on SELL only (delivery) — Zerodha + CDSL combined

// ─────────────────────────────────────────────────────────
// Compute round-trip cost (BUY + SELL) in paise for a CNC delivery trade.
// Returns: { total_paise, breakdown_json }
// ─────────────────────────────────────────────────────────
export function roundTripCostCnc(entryPaise, exitPaise, qty, exchange = 'NSE') {
  const exchangeRate = exchange === 'BSE' ? EXCHANGE_TXN_BSE : EXCHANGE_TXN_NSE;
  const buyValue  = entryPaise * qty;
  const sellValue = exitPaise  * qty;
  const turnover  = buyValue + sellValue;

  const stt        = Math.round(sellValue * STT_DELIVERY_SELL);
  const exchangeTxn = Math.round(turnover * exchangeRate);
  const sebi       = Math.round(turnover * SEBI_CHARGES);
  const stamp      = Math.round(buyValue * STAMP_DUTY_DELIVERY);
  const brokerage  = BROKERAGE_CNC_PAISE * 2;
  const gst        = Math.round((brokerage + exchangeTxn + sebi) * GST_ON_CHARGES);
  const dp         = DP_CHARGES_PAISE; // sell side only

  const total = stt + exchangeTxn + sebi + stamp + brokerage + gst + dp;
  return {
    total_paise: total,
    breakdown: { stt, exchange: exchangeTxn, sebi, stamp_duty: stamp, brokerage, gst, dp_charges: dp },
  };
}

// ─────────────────────────────────────────────────────────
// Same for intraday (MIS). Used for hypothetical comparison only — engine
// only places CNC at present.
// ─────────────────────────────────────────────────────────
export function roundTripCostIntraday(entryPaise, exitPaise, qty, exchange = 'NSE') {
  const exchangeRate = exchange === 'BSE' ? EXCHANGE_TXN_BSE : EXCHANGE_TXN_NSE;
  const buyValue  = entryPaise * qty;
  const sellValue = exitPaise  * qty;
  const turnover  = buyValue + sellValue;

  const stt        = Math.round(sellValue * STT_INTRADAY_SELL);
  const exchangeTxn = Math.round(turnover * exchangeRate);
  const sebi       = Math.round(turnover * SEBI_CHARGES);
  const stamp      = Math.round(buyValue * STAMP_DUTY_INTRADAY);
  // Brokerage = lesser of flat or 0.03%
  const brokeragePerSide = Math.min(
    BROKERAGE_INTRADAY_FLAT,
    Math.round(buyValue * (BROKERAGE_INTRADAY_PCT / 100))
  );
  const brokerage = brokeragePerSide * 2;
  const gst       = Math.round((brokerage + exchangeTxn + sebi) * GST_ON_CHARGES);
  // No DP charges intraday
  const total = stt + exchangeTxn + sebi + stamp + brokerage + gst;
  return {
    total_paise: total,
    breakdown: { stt, exchange: exchangeTxn, sebi, stamp_duty: stamp, brokerage, gst },
  };
}

// ─────────────────────────────────────────────────────────
// Adaptive R:R rule — replaces flat 2:1 minimum.
// Returns the minimum acceptable reward:risk ratio for a given conviction
// score. Math reasoning: at score X, our backtested win rate is ~Y; we need
// R:R such that expected value > 0.5R per trade after costs.
// ─────────────────────────────────────────────────────────
export function adaptiveMinRR(compositeScore) {
  // Brackets — tunable via D1 config later
  if (compositeScore >= 90) return 1.4;  // Very high conviction — accept tight setups
  if (compositeScore >= 80) return 1.7;  // High conviction
  if (compositeScore >= 70) return 2.0;  // Standard — old default
  return 2.3;                             // Marginal — demand premium R:R
}

// ─────────────────────────────────────────────────────────
// Adaptive risk-per-trade (Kelly-fraction sizing).
// Returns risk-per-trade as a fraction of total_capital, capped 0.5%-4.0%.
//
// Logic: at score X with backtested win-rate p and reward:risk b, full Kelly =
//   f* = (p*b - q) / b   where q = 1-p
// We use 0.25 × Kelly (industry-standard fractional Kelly to bound drawdowns).
// Then floor/cap to keep within sane risk budget.
//
// In absence of backtested win-rate per score-band (early days), we use a
// conservative prior:
//   score 90+  →  p=0.62, b=1.4  →  full Kelly ~33% → fractional 8% → cap at 4%
//   score 80-90 → p=0.55, b=1.7  →  full Kelly ~22% → fractional 5.5% → cap 3%
//   score 70-80 → p=0.50, b=2.0  →  full Kelly ~25% → fractional 6% → cap 2%
//   score <70  →  no entry
//
// Once backtest dataset has 100+ trades, replace the priors with empirical p.
// ─────────────────────────────────────────────────────────
export function adaptiveRiskPct(compositeScore, empiricalWinRate = null, empiricalAvgRR = null) {
  // If backtest provides empirical numbers, use them — otherwise priors.
  const p = empiricalWinRate != null ? empiricalWinRate : (
    compositeScore >= 90 ? 0.62 :
    compositeScore >= 80 ? 0.55 :
    compositeScore >= 70 ? 0.50 :
    0
  );
  const b = empiricalAvgRR != null ? empiricalAvgRR : (
    compositeScore >= 90 ? 1.4 :
    compositeScore >= 80 ? 1.7 :
    compositeScore >= 70 ? 2.0 :
    1
  );
  if (p <= 0 || b <= 0) return 0;
  const q = 1 - p;
  const fullKelly = (p * b - q) / b;
  if (fullKelly <= 0) return 0;
  const fractional = fullKelly * 0.25; // 0.25 × Kelly
  // Cap by score band
  const ceiling =
    compositeScore >= 90 ? 0.04 :
    compositeScore >= 80 ? 0.03 :
    compositeScore >= 70 ? 0.02 :
    0.01;
  return Math.max(0.005, Math.min(ceiling, fractional)); // floor 0.5%, cap by band
}

// ─────────────────────────────────────────────────────────
// Net expected value of a trade in paise, accounting for costs.
//
// gross_target_pnl − round_trip_cost
// gross_stop_pnl   − round_trip_cost
// EV = win_rate × net_target_pnl − loss_rate × |net_stop_pnl|
// ─────────────────────────────────────────────────────────
export function netExpectedValue({ entryPaise, stopPaise, targetPaise, qty, winRate }) {
  const grossWin  = (targetPaise - entryPaise) * qty;
  const grossLoss = (entryPaise - stopPaise) * qty;
  const winCost   = roundTripCostCnc(entryPaise, targetPaise, qty).total_paise;
  const lossCost  = roundTripCostCnc(entryPaise, stopPaise, qty).total_paise;
  const netWin    = grossWin - winCost;
  const netLoss   = grossLoss + lossCost; // cost makes losses worse
  const ev = winRate * netWin - (1 - winRate) * netLoss;
  return {
    gross_win_paise: grossWin,
    gross_loss_paise: grossLoss,
    net_win_paise: netWin,
    net_loss_paise: netLoss,
    win_cost_paise: winCost,
    loss_cost_paise: lossCost,
    expected_value_paise: Math.round(ev),
  };
}
