// ═══════════════════════════════════════════════════════════════════════════
// Today's Plan — coaching system for the first-time trader
//
// Reads current system state (IST time, kite token, watchlist, paper trades,
// signal availability) and returns:
//   - current_step: what to do RIGHT NOW
//   - next_steps:    upcoming 2-3 steps as preview
//   - context:       supporting data the step references
//   - why:           the LOGIC behind the action (this is what user can question)
//
// Designed for a beginner doing paper trades for first 3-4 days.
// Each step is a short, actionable instruction with reasoning behind it.
// ═══════════════════════════════════════════════════════════════════════════

// IST helpers — IST = UTC + 5:30
function istNow() {
  const u = Date.now();
  return new Date(u + 5.5 * 3600 * 1000);
}
function istHourMin() {
  const t = istNow();
  return { hour: t.getUTCHours(), min: t.getUTCMinutes(), dow: t.getUTCDay() };
}
function isMarketDay() {
  const dow = istNow().getUTCDay();
  return dow >= 1 && dow <= 5;
}
function istTimeStr() {
  const t = istNow();
  return `${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')} IST`;
}

// Phase classifier — which "act" of the trading day are we in?
function tradingPhase() {
  const { hour, min } = istHourMin();
  const total = hour * 60 + min;
  // 00:00-07:00 → asleep / pre-prep
  if (total < 7 * 60) return 'overnight';
  // 07:00-09:14 → pre-market prep
  if (total < 9 * 60 + 15) return 'pre_market';
  // 09:15-09:45 → market open volatility
  if (total < 9 * 60 + 45) return 'opening';
  // 09:45-11:30 → trend-day formation
  if (total < 11 * 60 + 30) return 'morning';
  // 11:30-13:30 → lunch chop
  if (total < 13 * 60 + 30) return 'lunch';
  // 13:30-15:00 → afternoon trend
  if (total < 15 * 60) return 'afternoon';
  // 15:00-15:30 → close window
  if (total < 15 * 60 + 30) return 'close';
  // 15:30+ → post-market review
  return 'post_market';
}

// Main entry — assembles the plan based on current state
export async function getTodaysPlan(db, env) {
  const phase = tradingPhase();
  const isMkt = isMarketDay();
  const time = istTimeStr();

  // Read configurable threshold (early-engine mode lowers from 70 to 60)
  const thresholdRow = await db.prepare(
    `SELECT config_value FROM user_config WHERE config_key='max_signal_threshold' LIMIT 1`
  ).first();
  const cardThreshold = parseInt(thresholdRow?.config_value || '70');
  const earlyEngineMode = cardThreshold < 70;

  // Fetch all the state-dependent context in parallel-ish
  const [
    kiteStatus, watchlistRows, paperOpen, paperTotal, alerts,
    cards, signalMax, briefing, fii, sectorRotation,
  ] = await Promise.all([
    fetchKiteStatus(db, env),
    db.prepare(`SELECT COUNT(*) AS n FROM user_watchlist WHERE is_active=1`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM paper_trades WHERE is_active=1`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM paper_trades`).first(),
    // Count must match the same noise filter the alerts list uses, otherwise
    // badge shows "27" but the panel only has 2 real items — confusing.
    db.prepare(`
      SELECT COUNT(*) AS n FROM system_alerts
      WHERE is_read=0 AND severity IN ('critical','warn')
        AND NOT (
          category='watchdog' AND title LIKE 'Cron stale:%' AND (
               title LIKE '%seed_backfill%' OR title LIKE '%imd%'
            OR title LIKE '%posoco%' OR title LIKE '%fred%'
            OR title LIKE '%db_vacuum%' OR title LIKE '%weekly_digest%'
            OR title LIKE '%backfill:nse_bulk%' OR title LIKE '%backfill:nse_block%'
            OR title LIKE '%backfill:bse_deals%' OR title LIKE '%backfill:fno_participant_oi%'
            OR title LIKE '%backfill:nse_bhavcopy%' OR title LIKE '%backfill:bse_bhavcopy%'
            OR title LIKE '%backfill:delivery%' OR title LIKE '%backfill:fii_dii_cash%'
            OR title LIKE '%backfill:fii_deriv%' OR title LIKE '%backfill:mwpl%'
            OR title LIKE '%sector_history_refresh%' OR title LIKE '%bond_direction%'
            OR title LIKE '%yahoo_eod%'
          )
        )
    `).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM signal_scores s JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m WHERE s.composite_score >= ?`).bind(cardThreshold).first(),
    db.prepare(`SELECT MAX(composite_score) AS m FROM signal_scores s JOIN (SELECT MAX(computed_at) AS m FROM signal_scores) x ON s.computed_at=x.m`).first(),
    db.prepare(`SELECT briefing_date, narrative FROM daily_briefings ORDER BY briefing_date DESC LIMIT 1`).first(),
    db.prepare(`SELECT * FROM fii_dii_daily ORDER BY trade_date DESC LIMIT 1`).first(),
    db.prepare(`SELECT index_name, close_paise FROM sector_indices WHERE trade_date = (SELECT MAX(trade_date) FROM sector_indices) LIMIT 5`).all(),
  ]);

  const state = {
    phase, time, is_market_day: isMkt,
    kite_connected: kiteStatus.connected,
    kite_expires_in_min: kiteStatus.expires_in_min,
    watchlist_count: watchlistRows?.n || 0,
    paper_open_count: paperOpen?.n || 0,
    paper_total_count: paperTotal?.n || 0,
    unread_alerts: alerts?.n || 0,
    cards_today: cards?.n || 0,
    signal_max_today: signalMax?.m || 0,
    briefing_date: briefing?.briefing_date,
    fii_yesterday_cr: fii?.fii_net_cr,
    dii_yesterday_cr: fii?.dii_net_cr,
    card_threshold: cardThreshold,
    early_engine_mode: earlyEngineMode,
  };

  // Build phase-specific step list
  let steps = [];
  if (!isMkt) steps = stepsWeekend(state);
  else if (phase === 'overnight' || phase === 'pre_market') steps = stepsPreMarket(state);
  else if (phase === 'opening') steps = stepsOpening(state);
  else if (phase === 'morning') steps = stepsMorning(state);
  else if (phase === 'lunch') steps = stepsLunch(state);
  else if (phase === 'afternoon') steps = stepsAfternoon(state);
  else if (phase === 'close') steps = stepsClose(state);
  else if (phase === 'post_market') steps = stepsPostMarket(state);

  return {
    state,
    phase,
    time,
    current_step: steps[0] || null,
    next_steps: steps.slice(1, 4),
    total_steps_in_phase: steps.length,
  };
}

async function fetchKiteStatus(db, env) {
  try {
    const tok = await db.prepare(
      `SELECT access_token, expires_at FROM kite_tokens WHERE is_active=1 ORDER BY obtained_at DESC LIMIT 1`
    ).first();
    if (!tok) return { connected: false };
    const expiresInMin = Math.round((tok.expires_at - Date.now()) / 60000);
    return { connected: expiresInMin > 0, expires_in_min: expiresInMin };
  } catch { return { connected: false }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: WEEKEND (Sat/Sun) — no market today
// ═══════════════════════════════════════════════════════════════════════════
function stepsWeekend(s) {
  return [
    {
      step: 'Take a break — markets are closed',
      what: 'NSE/BSE only operate Mon-Fri. Today is a non-market day.',
      why: 'Trying to trade on weekends is impossible — there\'s no liquidity, no price discovery, no exchange. Even GIFT Nifty (which trades 23/7) only matters as a Monday-open predictor. Use today to PREP not TRADE.',
      action: 'review',
      next_visible_action: 'Read briefing for next market day · Add stocks to watchlist · Review last week\'s paper trades',
      tooltip_terms: ['GIFT Nifty', 'liquidity', 'price discovery'],
    },
    {
      step: 'Read the next market day briefing',
      what: 'Daily briefing compiles at 08:30 IST every market day. Today\'s shows what the FII/DII flow + sectors look like heading into Monday open.',
      why: 'The biggest mistake new traders make: opening the app at 09:14 IST and immediately taking a position. By then you\'re reacting, not preparing. Reading the briefing now means you walk into Monday already knowing the story.',
      action: 'open_briefing',
      tooltip_terms: ['FII', 'DII', 'sector rotation'],
    },
    {
      step: 'Set up your watchlist (if not done)',
      what: `Add 5-10 stocks you want to focus on. Currently you have ${s.watchlist_count} symbols.`,
      why: 'Focus beats scatter. A trader watching 5 stocks deeply will beat one watching 50 superficially. Pick stocks you can have an opinion on — sector you understand, business you\'ve heard of, news you\'ve been following.',
      action: 'open_watchlist',
      tooltip_terms: ['watchlist'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: PRE_MARKET (07:00-09:15 IST) — the prep window
// ═══════════════════════════════════════════════════════════════════════════
function stepsPreMarket(s) {
  const steps = [];

  // Step 0 — Kite connection check (always first)
  if (!s.kite_connected || s.kite_expires_in_min < 30) {
    steps.push({
      step: 'Connect Kite — token expires daily',
      what: 'Your Zerodha session expires every morning around 06:30 IST. You need to re-authenticate before market opens.',
      why: 'SEBI mandates daily re-auth for security. Without it, no orders can be placed and live LTP feeds stop. This is non-negotiable — every Indian retail trader does this each morning.',
      action: 'reconnect_kite',
      url: '/wealth/auth/login',
      blocking: true,
      tooltip_terms: ['SEBI', 'LTP'],
    });
  }

  // Step 1 — Check alerts
  if (s.unread_alerts > 0) {
    steps.push({
      step: `Check ${s.unread_alerts} unread alert${s.unread_alerts > 1 ? 's' : ''}`,
      what: 'The 🔔 bell shows things the system caught overnight — token expiry, stop hits, order rejections, anomalies.',
      why: 'Information you might miss otherwise. Click each alert, mark read, then move on.',
      action: 'open_alerts',
      tooltip_terms: [],
    });
  }

  // Step 2 — Read briefing
  steps.push({
    step: 'Read today\'s morning briefing',
    what: `${s.briefing_date ? 'Auto-compiled at 08:30 IST. Reads' : 'Will auto-compile at 08:30 IST. Currently reads'}: yesterday FII flow ${s.fii_yesterday_cr != null ? '₹' + Math.round(s.fii_yesterday_cr) + ' Cr' : 'pending'}, DII flow ${s.dii_yesterday_cr != null ? '₹' + Math.round(s.dii_yesterday_cr) + ' Cr' : 'pending'}.`,
    why: 'Markets open with overnight context already priced in. Reading the briefing tells you whether today is a "risk-on" day (FII buying, low VIX) or "risk-off" (FII selling, high VIX). You position different on different days. Don\'t skip this — even pros read this first.',
    action: 'open_briefing',
    tooltip_terms: ['FII', 'DII', 'VIX', 'risk-on', 'risk-off'],
  });

  // Step 3 — Watchlist check
  if (s.watchlist_count < 3) {
    steps.push({
      step: 'Add stocks to your watchlist',
      what: `You have ${s.watchlist_count} on watchlist. Add 5-10 today.`,
      why: 'A watchlist forces focus. Without it, you\'ll get distracted by every price move on every stock. With it, you only look for setups in the 5-10 you\'ve thought about. This is THE #1 difference between professional traders and gamblers.',
      action: 'open_watchlist',
      tooltip_terms: ['watchlist', 'setup'],
    });
  }

  // Step 4 — Wait for market
  const minToOpen = (9 * 60 + 15) - (istNow().getUTCHours() * 60 + istNow().getUTCMinutes());
  if (minToOpen > 0) {
    steps.push({
      step: `Wait — market opens in ${minToOpen} min`,
      what: 'Don\'t place anything before 09:15 IST. The pre-open auction (09:00-09:08) is institutional-only.',
      why: 'Retail orders before 09:15 just queue up at the next-tick auction price — you have no control over fill price. Better to wait, see what opens, then react.',
      action: 'wait',
      tooltip_terms: ['pre-open auction'],
    });
  }

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: OPENING (09:15-09:45 IST) — DON'T TRADE YET
// ═══════════════════════════════════════════════════════════════════════════
function stepsOpening(s) {
  return [
    {
      step: 'Watch — DO NOT trade in first 15 min',
      what: 'First 15 minutes after 09:15 are pure volatility. Stocks gap up, gap down, whipsaw. Spreads are wide.',
      why: `Three things happen 09:15-09:30: (1) overnight orders (AMO) all execute together — chaotic. (2) Algos run their morning logic — adds noise. (3) Pre-open auction price gets "tested" — often reverses. Professional traders WAIT this out. Don\'t enter, don\'t exit, just observe. Patience is the cheapest edge in trading.`,
      action: 'wait',
      tooltip_terms: ['AMO', 'algos', 'whipsaw', 'spread'],
    },
    {
      step: 'Note the day type forming',
      what: 'Is Nifty trending up steadily? Or whipsawing? Or dropping fast?',
      why: '"Trend day" (steady direction) needs different strategy than "range day" (chop between two levels). On trend days, ride momentum. On range days, fade the extremes. Wrong strategy on wrong day = stops hit + frustration.',
      action: 'observe',
      tooltip_terms: ['trend day', 'range day', 'fade'],
    },
    {
      step: 'Check if engine produced any cards',
      what: `Engine recomputes signals every hour during market. Currently ${s.cards_today} card(s) above threshold ${s.card_threshold}. Max score: ${(s.signal_max_today || 0).toFixed(1)}.`,
      why: `A "card" means the engine\'s 7-dimension scoring system found a stock scoring ≥${s.card_threshold} with R:R 2:1+ math. That\'s a candidate, not a command. You still apply your own 3-question test.${s.early_engine_mode ? ' Engine is in EARLY MODE — threshold lowered from 70 to ' + s.card_threshold + ' because some scoring dimensions (options, sentiment, breadth) are still data-starved. Will raise back as ingestion fixes land.' : ''}`,
      action: 'review_cards',
      tooltip_terms: ['composite score', '3-question test', 'R:R'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: MORNING (09:45-11:30 IST) — best entry window
// ═══════════════════════════════════════════════════════════════════════════
function stepsMorning(s) {
  const steps = [];

  if (s.cards_today > 0) {
    steps.push({
      step: `Review ${s.cards_today} engine card${s.cards_today > 1 ? 's' : ''}`,
      what: `Cards passed composite score ≥${s.card_threshold} AND adaptive R:R math. Highest scorer first.${s.early_engine_mode ? ' (Early-engine mode: threshold lowered to ' + s.card_threshold + ' while options + sentiment scoring matures.)' : ''}`,
      why: 'You\'re paper-trading until CPV clears. Even if a card looks great, click 📝 Paper Trade — not 🚀 CONFIRM. The 3-question test is the same. The discipline-building is the same. Only the money is different.',
      action: 'open_first_card',
      tooltip_terms: ['composite score', 'CPV', 'adaptive R:R'],
    });
  } else if (s.signal_max_today < s.card_threshold) {
    steps.push({
      step: 'No engine cards — score ceiling too low',
      what: `Max score today: ${(s.signal_max_today || 0).toFixed(1)}. Cards need ≥${s.card_threshold}.`,
      why: `Engine needs equity_eod + option chain data flowing freshly. If max is below threshold, the engine is correctly saying "no high-conviction setups today — sit out." That\'s a feature. Most pros sit out 7 of 10 days. The discipline of not trading is the rarest skill.`,
      action: 'use_manual_paper',
      tooltip_terms: ['equity_eod', 'option chain'],
    });
  }

  steps.push({
    step: 'Use manual paper trade for watchlist setups',
    what: 'See a stock breaking out on your watchlist? Open + Manual paper trade form, enter symbol + thesis.',
    why: 'Even without engine cards, you should practice the FLOW: see setup → write thesis → 3-question test → place paper. The system records the Bayesian observation either way. Over 10-30 trades, you\'ll learn whether your thesis-writing is accurate or you\'re fooling yourself.',
    action: 'open_manual_paper',
    tooltip_terms: ['breakout', 'thesis', 'Bayesian observation'],
  });

  if (s.paper_open_count > 0) {
    steps.push({
      step: `Watch your ${s.paper_open_count} open paper trade${s.paper_open_count > 1 ? 's' : ''}`,
      what: 'MTM updates live. Distance-to-stop and distance-to-target tell you how close you are to either exit.',
      why: 'Paper or real, the discipline is identical: don\'t sit on a stop-bound trade in denial. If MTM is -1.5% with stop at -2%, the trade is failing. Note that. Don\'t move the stop wider — that\'s the #1 retail trader mistake.',
      action: 'review_open_papers',
      tooltip_terms: ['MTM', 'stop'],
    });
  }

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: LUNCH (11:30-13:30 IST) — the dead zone
// ═══════════════════════════════════════════════════════════════════════════
function stepsLunch(s) {
  return [
    {
      step: 'Lunch chop — minimal new trades',
      what: 'Volume drops 50%+ between 11:30 and 13:30 IST. Spreads widen.',
      why: 'Institutional desks are at lunch. Without them, price moves are mostly retail noise. Retail noise = false breakouts → you get stopped out → frustration. Professional move: hold what you have, take profits if anything hits target, but new entries should be rare.',
      action: 'manage_existing',
      tooltip_terms: ['liquidity', 'breakout'],
    },
    {
      step: 'Review morning trades',
      what: `${s.paper_open_count} open · review thesis vs actual movement`,
      why: 'For each open trade: was your written thesis correct so far? If not, why? Don\'t rationalize — note honestly. This is where you learn fastest.',
      action: 'review_papers',
      tooltip_terms: ['thesis'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: AFTERNOON (13:30-15:00 IST) — second wave
// ═══════════════════════════════════════════════════════════════════════════
function stepsAfternoon(s) {
  return [
    {
      step: 'Afternoon trend window',
      what: 'Europe opened at 12:30 IST. By 13:30, US futures + Europe direction reflect in Indian indices.',
      why: 'A second wave of moves often appears. If morning was bullish and afternoon confirms, trend day. If morning was bullish but afternoon reverses, range day or potential reversal pattern. Note which it is.',
      action: 'observe',
      tooltip_terms: ['trend day', 'reversal pattern'],
    },
    {
      step: 'Add to winners (selectively)',
      what: 'If a paper trade is +2-3% and structure intact, you can pyramid up — but be careful.',
      why: 'Pyramiding (adding to winners) is what separates good traders from great ones. But ONLY add when the original thesis is being PROVEN. Adding to a tiny gain is fine; adding to a small loss is averaging down (career death). For week 1, just observe — don\'t pyramid yet.',
      action: 'review_open_papers',
      tooltip_terms: ['pyramid', 'averaging down'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: CLOSE (15:00-15:30 IST) — institutional flows
// ═══════════════════════════════════════════════════════════════════════════
function stepsClose(s) {
  return [
    {
      step: 'No new positions in last 30 min',
      what: 'Mutual funds rebalance, FII desks square off, volume spikes — direction unpredictable.',
      why: 'Last 30 min is institutional traffic. Retail entries here are like jumping into highway traffic. Wait for tomorrow.',
      action: 'wait',
      tooltip_terms: ['rebalance', 'square off'],
    },
    {
      step: 'Close losers manually if needed',
      what: 'Any trade that didn\'t hit stop but is clearly failing → exit at market.',
      why: '"It might come back overnight" → 70% of the time it doesn\'t, and you wake up to a wider loss. Discipline = exit when thesis is broken, not when it\'s comfortable.',
      action: 'review_open_papers',
      tooltip_terms: ['thesis broken'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase: POST_MARKET (15:30+ IST) — review & learn
// ═══════════════════════════════════════════════════════════════════════════
function stepsPostMarket(s) {
  return [
    {
      step: 'Review every trade you took today',
      what: `${s.paper_total_count - s.paper_open_count} closed paper trade${s.paper_total_count - s.paper_open_count !== 1 ? 's' : ''} today. Open the Paper panel and read each.`,
      why: 'For each closed trade ask: (1) Was the thesis correct? (2) Did sizing match conviction? (3) Did I respect stop or hold/move? (4) What surprised me? This is where 80% of learning happens. Pros do this every single day for years.',
      action: 'review_paper_history',
      tooltip_terms: ['conviction', 'sizing'],
    },
    {
      step: 'Update Bayesian state — passive',
      what: 'Engine auto-records every closed paper trade into bayesian_priors.',
      why: 'Once you have ≥30 closed trades in a bucket (tranche × score band × regime), the empirical posterior overrides hardcoded priors in adaptive sizing. That\'s when the system becomes "yours" — tuned to YOUR market timing.',
      action: 'view_bayesian',
      tooltip_terms: ['Bayesian', 'posterior', 'prior'],
    },
    {
      step: 'Update tomorrow\'s watchlist',
      what: 'Add new stocks based on today\'s observations. Remove stocks that didn\'t move at all.',
      why: 'Watchlists go stale fast. A stock you watched for 2 weeks without acting on isn\'t teaching you anything — replace it with one you have a fresher thesis on.',
      action: 'open_watchlist',
      tooltip_terms: ['stale watchlist'],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline glossary — used by tooltips throughout the UI
// Each term: short definition + why-it-matters
// ═══════════════════════════════════════════════════════════════════════════
const GLOSSARY = {
  'FII': {
    full: 'Foreign Institutional Investor',
    short: 'Mutual funds, hedge funds, pension funds based outside India that buy/sell Indian stocks.',
    why: 'Their daily net flow is the #1 driver of Nifty short-term moves. When FII buys ₹3000+ Cr, foreign confidence is up. When they sell heavily, EM-wide risk-off is happening.',
  },
  'DII': {
    full: 'Domestic Institutional Investor',
    short: 'Indian mutual funds, insurance, pension funds, banks.',
    why: 'When FII sells but DII absorbs (buys), quality stocks bounce within 2-5 days — one of our cascade patterns. Watching the FII vs DII tug-of-war daily reveals near-term direction.',
  },
  'VIX': {
    full: 'India VIX (Volatility Index)',
    short: 'A 30-day forward-looking volatility index. Higher = market expects bigger price swings.',
    why: 'VIX < 13 = complacency (calm before move). VIX > 18 = fear. Trade smaller when VIX is high — same setup loses 2× as often.',
  },
  'GIFT Nifty': {
    full: 'GIFT City Nifty Futures',
    short: 'Nifty futures traded at GIFT City SEZ near-24/7 (replaces SGX Nifty since 2023).',
    why: 'Trades while Indian market is closed. The 06:30 IST GIFT print tells you which way Nifty is likely to open. First signal of the day.',
  },
  'composite score': {
    full: 'Engine composite score',
    short: 'Weighted average of 7 dimensions: trend (20%), flow (18%), options (12%), catalyst (15%), macro (15%), sentiment (10%), breadth (10%).',
    why: 'Score ≥70 = tradeable card. ≥80 = high conviction. ≥90 = very high. The score answers "how many independent signals agree this is a buy".',
  },
  'R:R': {
    full: 'Reward to Risk ratio',
    short: 'How much you can gain ÷ how much you can lose. R:R 2:1 means ₹2 reward for every ₹1 at risk.',
    why: 'You can be wrong 60% of the time at R:R 2:1 and still profit. At R:R 1:1 you need 51%+ accuracy. Math beats feelings.',
  },
  '3-question test': {
    full: 'The 3 questions before any trade',
    short: 'Q1: Can I explain the thesis in one sentence? Q2: Can I sleep with the max loss? Q3: Does R:R math work?',
    why: 'Forces you to articulate before acting. If you can\'t answer Q1 cleanly, you don\'t actually have a thesis — you have a hope.',
  },
  'CPV': {
    full: 'Customer Personal Verification (Zerodha)',
    short: 'Mandatory verification step Zerodha runs after account opening before activating trades.',
    why: 'Until CPV clears, your funds may be debit-frozen. Pre-funding while frozen risks lockout. Paper trade until cleared.',
  },
  'PCR': {
    full: 'Put-Call Ratio',
    short: 'Total Put open interest / Total Call open interest at NSE.',
    why: 'PCR > 1.3 = puts crowded = paradoxically bullish (everyone\'s hedged, market floats up). PCR < 0.7 = calls crowded = bearish (greed peaking).',
  },
  'max pain': {
    full: 'Max Pain (options theory)',
    short: 'The strike price at which option holders collectively lose the most money on expiry.',
    why: 'Spot tends to gravitate toward max pain on expiry day — option writers (institutions) want max pain to be reality. Useful as a magnet level on expiry day.',
  },
  'trend day': {
    full: 'Trend day',
    short: 'A day where price moves in one direction with shallow pullbacks — trends from open to close.',
    why: 'On trend days, ride momentum (let winners run). Tight stops below recent low. ~30% of days.',
  },
  'range day': {
    full: 'Range day',
    short: 'A day where price chops between two horizontal levels — no clear direction.',
    why: 'On range days, fade the extremes (sell high, buy low). Most days are like this. ~50% of days.',
  },
  'fade': {
    full: 'Fade (a move)',
    short: 'Bet against an extreme price move on the assumption it\'s overdone.',
    why: 'Counter-trend strategy. Works in range markets. Career death in strong trends.',
  },
  'AMO': {
    full: 'After-Market Order',
    short: 'Order placed at Zerodha overnight, queued for tomorrow\'s 09:15 open.',
    why: 'You commit to a price/qty before market opens — fills at next-tick at market open. Useful for "I want in regardless of opening price".',
  },
  'algos': {
    full: 'Algorithmic / automated traders',
    short: 'Computer programs that execute orders based on rules. ~70% of NSE volume is algo.',
    why: 'Algos act first on news, fastest on patterns. Retail can\'t compete on speed — only on time horizon and judgment.',
  },
  'whipsaw': {
    full: 'Whipsaw',
    short: 'Rapid reversal in price that triggers stops on both sides.',
    why: 'Stops you out, then continues original direction. Most painful pattern for tight-stop traders. Best avoided by wider stops + smaller position size.',
  },
  'spread': {
    full: 'Bid-ask spread',
    short: 'Difference between highest buyer and lowest seller. Wider = costlier to enter.',
    why: 'Tight spread (< 5 paise) = liquid stock. Wide spread (> 50 paise) = illiquid → harder to exit at fair price → avoid.',
  },
  'liquidity': {
    full: 'Liquidity',
    short: 'How easy it is to buy or sell large quantity without moving the price.',
    why: 'High-volume stocks (>10 cr daily volume) = liquid. Low-volume = illiquid → orders move price → bad fills.',
  },
  'price discovery': {
    full: 'Price discovery',
    short: 'The market\'s ongoing process of figuring out the "fair" price through buy/sell forces.',
    why: 'When market is closed, no price discovery happens — last close is just the last agreed price. Reopening Monday usually has gap to digest weekend news.',
  },
  'pre-open auction': {
    full: 'Pre-open auction (09:00-09:08 IST)',
    short: '8-minute window where orders are collected and matched at a single equilibrium price for the open.',
    why: 'Institutional-only window — sets the day\'s opening reference. The 09:08 final print tells you collective bias. Retail orders usually queue but don\'t move the auction.',
  },
  'rebalance': {
    full: 'Portfolio rebalance',
    short: 'Mutual funds adjusting holdings to match their target allocations.',
    why: 'Most rebalancing happens 14:30-15:30 IST. Causes large but not necessarily directional moves.',
  },
  'square off': {
    full: 'Square off',
    short: 'Closing all open positions for the day (intraday traders).',
    why: 'Intraday positions MUST be squared off by 15:20 IST or broker auto-squares (with charges). Doesn\'t apply to delivery (CNC).',
  },
  'thesis': {
    full: 'Trade thesis',
    short: 'Your one-line reason for entering — "X will go up because Y".',
    why: 'Forces clarity. If you can\'t articulate, you\'re gambling. Saved theses become your post-trade learning material.',
  },
  'thesis broken': {
    full: 'Thesis broken',
    short: 'When the reason you entered the trade no longer applies.',
    why: 'Different from "stop hit". Sometimes thesis is broken before stop is hit — exit then, don\'t wait for the stop. Example: bought RELIANCE on Q4 results expectation, results pre-leak negative → thesis broken, exit immediately.',
  },
  'breakout': {
    full: 'Breakout',
    short: 'Price moving above a clear resistance level with volume confirmation.',
    why: 'Real breakouts: volume 1.5×+ avg, candle closes above level, follows through next day. False breakouts: volume meh, fades intraday. Volume is the truth-teller.',
  },
  'reversal pattern': {
    full: 'Reversal pattern',
    short: 'Price action suggesting trend is about to reverse (e.g., double top, head-and-shoulders).',
    why: 'Reversals offer best R:R but lowest hit-rate. For week 1, ignore reversal trades — they\'re harder. Trade trend continuations only.',
  },
  'stop': {
    full: 'Stop-loss',
    short: 'Pre-set price at which you exit a losing trade automatically.',
    why: 'Set BEFORE entering. Move only in your favor (trail stop up). Never widen — that\'s how ₹10K losses become ₹50K losses.',
  },
  'MTM': {
    full: 'Mark-to-Market (P&L)',
    short: 'Current unrealized profit/loss on an open position.',
    why: 'Fluctuates with every tick. Don\'t emotionally react to red MTM mid-trade — your stop protects you. Reacting before stop hits = breaking your own plan.',
  },
  'risk-on': {
    full: 'Risk-on environment',
    short: 'Market mood favors growth assets (equities, EM, crypto). FII buys, VIX low.',
    why: 'On risk-on days, hold longer. Stops can be wider. Cyclicals (banks, auto, metals) outperform.',
  },
  'risk-off': {
    full: 'Risk-off environment',
    short: 'Market mood favors safe assets (bonds, gold, USD). FII sells, VIX high.',
    why: 'On risk-off days, trade smaller. Defensives (FMCG, pharma, IT) outperform. Hedge or sit out.',
  },
  'cascade': {
    full: 'Cascade pattern',
    short: 'A documented event-→-reaction sequence (e.g., RBI rate cut → NBFC rally with 1-2 day lag, ~68% historical hit rate).',
    why: 'Most retail trades on news. Cascades trade the predictable reaction TO the news. Better R:R than chasing the news itself.',
  },
  'Bayesian': {
    full: 'Bayesian learning',
    short: 'A way of updating belief about win-rate as new evidence arrives.',
    why: 'Replaces guessing with measuring. After 30+ trades in a category, the engine knows YOUR actual win-rate, not the textbook one.',
  },
  'posterior': {
    full: 'Posterior probability',
    short: 'Updated belief about win-rate AFTER seeing some trades.',
    why: 'Starts as a prior (educated guess). Each trade nudges it toward the empirical truth.',
  },
  'prior': {
    full: 'Prior probability',
    short: 'Starting belief before any data is observed.',
    why: 'We seed with conservative priors (50% win-rate at score 70-80). Real data either confirms or revises.',
  },
  'pyramid': {
    full: 'Pyramiding',
    short: 'Adding to a position that\'s already winning.',
    why: 'Lets winners compound. But ONLY add when original thesis is proving correct, not on hope. Initial position larger than each add.',
  },
  'averaging down': {
    full: 'Averaging down',
    short: 'Buying more of a losing position to reduce average cost.',
    why: 'Career death. The textbook reason for blowing up retail traders. Losing trade tells you thesis is wrong — ego says "I\'ll be right eventually" — you double down — bigger loss. Don\'t.',
  },
  'sector rotation': {
    full: 'Sector rotation',
    short: 'Money flowing between sectors (Banking → IT → Pharma → ...) over time.',
    why: 'Different sectors lead at different points in business cycle. Rate cuts → financials. Growth fears → defensives. Riding the leading sector beats stock-picking.',
  },
  'watchlist': {
    full: 'Watchlist',
    short: 'A small list (5-15) of stocks you actively track with intent.',
    why: 'Focus beats scatter. A trader watching 5 stocks deeply will beat one watching 50 superficially.',
  },
  'setup': {
    full: 'Setup',
    short: 'A specific pattern + condition that, when present, triggers a trade.',
    why: 'Setups are repeatable. "Stock above 50-day SMA + volume spike + sector leading" is a setup. "I have a feeling" is not.',
  },
  'conviction': {
    full: 'Trade conviction',
    short: 'How strongly you believe the setup will work.',
    why: 'Higher conviction → bigger size (Kelly fractional). Lower conviction → smaller size or skip. Conviction must come from data, not gut.',
  },
  'sizing': {
    full: 'Position sizing',
    short: 'How many shares/lots to buy.',
    why: 'Most important variable in long-term performance. Even great setups can blow up an account if oversized. Never risk > 2% per trade.',
  },
  'stale watchlist': {
    full: 'Stale watchlist',
    short: 'Stocks on your list that haven\'t moved or had news in weeks.',
    why: 'Not learning anything from them. Replace with stocks that have a fresher catalyst or reason.',
  },
  'SEBI': {
    full: 'Securities and Exchange Board of India',
    short: 'Indian capital markets regulator.',
    why: 'Sets daily-auth rules, KYC/CPV requirements, lot sizes, circuit limits. Makes the rules everyone trades under.',
  },
  'LTP': {
    full: 'Last Traded Price',
    short: 'Most recent price at which the stock actually traded.',
    why: 'Different from bid (highest buyer) and ask (lowest seller). Live MTM uses LTP.',
  },
  'equity_eod': {
    full: 'Equity end-of-day data',
    short: 'Daily OHLCV (Open/High/Low/Close/Volume) for every stock.',
    why: 'Foundation of all technical analysis. The engine\'s trend dimension reads this.',
  },
  'option chain': {
    full: 'Option chain',
    short: 'Table of all option strikes (puts + calls) for a given expiry.',
    why: 'Where smart money positions. Reading PCR, max pain, IV skew = reading institutional sentiment.',
  },
  'adaptive R:R': {
    full: 'Adaptive Reward:Risk',
    short: 'R:R minimum varies by composite score: 90+ = 1.4, 80-90 = 1.7, 70-80 = 2.0, <70 = no trade.',
    why: 'Higher conviction trades can accept tighter R:R because hit-rate is higher. Math from Bayesian win-rates.',
  },
  'Bayesian observation': {
    full: 'Bayesian observation',
    short: 'A closed trade\'s outcome (win/loss + return %) feeding into the engine\'s learning.',
    why: 'Each one nudges the posterior. After ~30 in a bucket, posterior overrides prior in sizing decisions.',
  },
};

export function getGlossary(url) {
  const term = url.searchParams.get('term');
  if (!term) return { glossary: GLOSSARY, terms: Object.keys(GLOSSARY).sort() };
  const t = GLOSSARY[term] || GLOSSARY[term.toUpperCase()] || GLOSSARY[term.toLowerCase()];
  return t ? { term, ...t } : { error: 'term not found' };
}
