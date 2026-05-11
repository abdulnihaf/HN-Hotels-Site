// Shared tier matrix + relevance scorer for the May 2026 influencer system.
// Used by /api/influencer-outreach and /api/influencer-bookings — single source of truth.
//
// Methodology — see PR description for the market-research synthesis.
// Short version:
//   - Indian food micro-influencer barter market (2024-2026): 70%+ of 5K-50K creators
//     accept barter-only when the experience is unique. 60K+ typically need cash component.
//   - HE's 1918 Dakhni heritage + late-night exclusivity = unique enough to be barter-first.
//   - Cover counts scale with follower count, but cash component only kicks in at T4 (60K+).

// Extended T0-T7 tier matrix grounded in 2026 Indian food creator economy benchmarks.
// See docs/CREATOR-PORTAL-ARCHITECTURE.md for market-research methodology.
export const TIER_MATRIX = {
  T0: {
    label:        '<1K · Newbie',
    min:          0,
    max:          999,
    covers:       0,
    cash_paise:   0,
    budget_paise: 0,
    add_ons:      [],
    asks:         [],
    auto_decline: true,
    decline_reason: 'We work with creators who have at least 1K active followers. Build your audience and apply again!',
  },
  T1: {
    label:        '1K–5K · Nano',
    min:          1000,
    max:          4999,
    covers:       1,
    cash_paise:   0,
    budget_paise: 60000,                    // ₹600
    add_ons:      [],
    asks:         ['1 reel · 3 stories · tag @hamzaexpressblr'],
    auto_approve: true,
  },
  T2: {
    label:        '5K–15K · Micro',
    min:          5000,
    max:          14999,
    covers:       2,
    cash_paise:   0,
    budget_paise: 120000,                   // ₹1,200
    add_ons:      ['Welcome chai'],
    asks:         ['1 reel · 5 stories · tag @hamzaexpressblr · use the geotag pin'],
    auto_approve: true,
  },
  T3: {
    label:        '15K–30K · Mid-Micro',
    min:          15000,
    max:          29999,
    covers:       3,
    cash_paise:   0,
    budget_paise: 180000,                   // ₹1,800
    add_ons:      ['Welcome chai', 'Dessert'],
    asks:         ['1 reel · 5 stories · tag · 24-hour bio link'],
    auto_approve: true,
  },
  T4: {
    label:        '30K–60K · Upper-Micro',
    min:          30000,
    max:          59999,
    covers:       4,
    cash_paise:   0,
    budget_paise: 240000,                   // ₹2,400
    add_ons:      ['Welcome chai', 'Dessert flight', 'Chef interaction'],
    asks:         ['1 reel · 1 permanent grid post · 5 stories · tag'],
    auto_approve: true,
    auto_approve_min_er: 0.015,             // ER >= 1.5% required for auto-approve at this tier
  },
  T5: {
    label:        '60K–100K · Macro-Micro',
    min:          60000,
    max:          99999,
    covers:       4,
    cash_paise:   50000,                    // ₹500
    budget_paise: 290000,
    // Generic category descriptors only — specific dishes pulled from /api/menu-top-sellers (HE).
    add_ons:      ['Signature heritage dish (comped)', 'Dessert flight', 'Chai', 'Chef interaction'],
    asks:         ['1 reel · 1 permanent grid post · 7 stories · 7-day bio tag'],
    auto_approve: false,                    // Manual review (cash component)
  },
  T6: {
    label:        '100K–250K · Edge-Macro',
    min:          100000,
    max:          249999,
    covers:       4,
    cash_paise:   300000,                   // ₹3,000
    budget_paise: 540000,
    add_ons:      ['Chef tasting (8 dishes)', 'Family photo', 'Chef interaction'],
    asks:         ['2 reels · 1 permanent grid post · collab post · IG live snippet'],
    auto_approve: false,
  },
  T7: {
    label:        '250K+ · Macro',
    min:          250000,
    max:          99999999,
    covers:       6,
    cash_paise:   800000,                   // ₹8,000
    budget_paise: 1064000,
    add_ons:      ['Full chef tasting menu', 'Brand brief', 'Behind-the-scenes access'],
    asks:         ['2 reels · 1 permanent grid · collab · IG live · 14-day bio tag'],
    auto_approve: false,                    // Custom proposal possible
  },
};

export function tierOf(followers) {
  const f = followers || 0;
  if (f < 1000)   return 'T0';
  if (f < 5000)   return 'T1';
  if (f < 15000)  return 'T2';
  if (f < 30000)  return 'T3';
  if (f < 60000)  return 'T4';
  if (f < 100000) return 'T5';
  if (f < 250000) return 'T6';
  return 'T7';
}

// ────────────────────────────────────────────────────────────────────────────
// Barter-feasibility — cold barter outreach (no cash) only makes sense
// for micro-tier creators. T5+ (60K+) require a cash component;
// cold-pitching them on barter alone burns brand goodwill on first touch.
// Memory: feedback_influencer_barter_targeting.md (2026-05-11).
// ────────────────────────────────────────────────────────────────────────────
export const BARTER_FEASIBLE_TIERS = ['T1', 'T2', 'T3', 'T4'];

export function isBarterFeasible(tier) {
  return BARTER_FEASIBLE_TIERS.includes(tier);
}

// Within-band priority boost — T2 is the documented sweet spot for barter
// acceptance + engagement rate. T4 is the upper edge (still feasible but
// drops in conversion). T1 nano is feasible but ER is more volatile.
const BARTER_FIT_BOOST = { T1: 0, T2: 1.0, T3: 0.5, T4: -0.5 };

export function barterFit(tier) {
  return BARTER_FIT_BOOST[tier] || 0;
}

// Decision: auto-approve, manual review, or auto-decline?
// Inputs: tier, ER (engagement rate), is_private, last_post_at
// Returns: { decision: 'auto_approve' | 'manual' | 'decline', reason: string }
export function approvalDecision({ tier, engagement_rate, is_private, last_post_at }) {
  const t = TIER_MATRIX[tier];
  if (!t) return { decision: 'decline', reason: 'Unknown tier' };

  if (t.auto_decline) return { decision: 'decline', reason: t.decline_reason };
  if (is_private) return { decision: 'decline', reason: 'Private profiles — please switch to public to apply' };

  // ER floor: < 0.5% likely indicates inactive / bought followers
  const er = parseFloat(engagement_rate || 0);
  if (er > 0 && er < 0.005) {
    return { decision: 'decline', reason: 'Active engagement is what we look for. Your engagement rate is below our threshold — try again as it grows.' };
  }

  // Activity floor: dormant creators (last post > 60d) get manual review
  if (last_post_at) {
    const ageDays = (Date.now() - new Date(last_post_at).getTime()) / 86400000;
    if (ageDays > 60) {
      return { decision: 'manual', reason: `Last post was ${Math.round(ageDays)} days ago. Sending to manual review.` };
    }
  }

  // Tier-level auto-approve gate
  if (!t.auto_approve) return { decision: 'manual', reason: 'High-tier creators get personalised review.' };

  // T4+ requires ER threshold
  if (t.auto_approve_min_er && er > 0 && er < t.auto_approve_min_er) {
    return { decision: 'manual', reason: `T4+ requires ER >= ${(t.auto_approve_min_er*100).toFixed(1)}%. Yours is ${(er*100).toFixed(2)}%. Sending to manual review.` };
  }

  return { decision: 'auto_approve', reason: 'Auto-approved' };
}

// ────────────────────────────────────────────────────────────────────────────
// Relevance scorer — 0 to ~10 scale based on bio + name + category signals
// ────────────────────────────────────────────────────────────────────────────

const SUB_GEO_TOKENS = [
  'frazer town', 'frazertown', 'mosque road', 'shivajinagar',
  'commercial st', 'commercial street', 'mg rd', 'm.g. road', 'mg road',
  'brigade rd', 'brigade road', 'cubbon park', 'shivajinagar bus',
  'richmond town', 'indiranagar', 'jayanagar', 'koramangala',  // BLR neighborhoods that creators commonly mention
];
// Cuisine tokens — broadened to capture all Indian regional cuisines that align with HE's Dakhni positioning.
const CUISINE_TOKENS = [
  'halal', 'muslim', 'islamic', 'mughlai', 'mughal', 'urdu', 'iftar', 'eid', 'biryani',
  'hyderab', 'dakhni', 'kabab', 'kebab', 'tandoor', 'mutton',
  'awadh', 'awadhi', 'lucknow', 'lucknowi', 'nawab', 'nawabi',
  'bhopal', 'bhopali', 'zayka', 'zaika', 'rampuri',
  'parsi', 'irani', 'persian', 'mughul',
  'kashmiri', 'pasanda', 'rezala', 'kalmi', 'chaap', 'haleem',
];
const HERITAGE_TOKENS = [
  'authentic', 'heritage', 'classic', 'legacy', 'family-run', 'family run',
  'generations', 'oldest', 'since 1', 'since 18', 'since 19', 'since 20',
  'vintage', 'traditional', 'original', 'time-tested', 'old-school', 'old school',
];
const LATENIGHT_TOKENS = [
  'late night', 'late-night', '24x7', '24/7', 'midnight', 'after dark', 'nightlife',
  'party', 'late', 'night out', 'after hours',
];
const FOOD_PRIMARY_TOKENS = [
  'food blogger', 'foodblogger', 'food vlogger', 'foodvlogger', 'food critic',
  'food reviewer', 'food journal', 'foodie', 'food creator', 'chef',
  'food explorer', 'food hunter', 'food diary', 'food enthusiast', 'food lover',
  'food influencer', 'food story', 'food stories', 'food journey', 'food review',
  'food vlog', 'food blog', 'foodgram',
];
const BLR_RESIDENT_TOKENS = [
  'bangalore based', 'bengaluru based', 'based in bangalore', 'based in bengaluru',
  'living in bangalore', 'living in bengaluru', 'namma bengaluru', 'namma bangalore',
  '📍bangalore', '📍bengaluru', '📍 bangalore', '📍 bengaluru',
];

export function scoreRelevance(profile) {
  const bio = String(profile.biography || '').toLowerCase();
  const fullName = String(profile.full_name || '').toLowerCase();
  const cat = String(profile.category_name || '').toLowerCase();
  const blob = `${bio} ${fullName} ${cat}`;

  let score = 0;
  const reasons = [];

  // 1. BLR signal — any BLR mention scores well (+2.5), strong "based in" gets +3.5
  if (BLR_RESIDENT_TOKENS.some(t => blob.includes(t))) {
    score += 3.5; reasons.push('blr_resident:+3.5');
  } else if (/bangalore|bengaluru|blr|bglr|namma uru/.test(blob)) {
    score += 2.5; reasons.push('blr_mention:+2.5');
  }

  // 2. Food vertical (+2 primary, +1 secondary)
  if (FOOD_PRIMARY_TOKENS.some(t => blob.includes(t))) {
    score += 2; reasons.push('food_primary:+2');
  } else if (/food|restaurant|cafe|cuisine|kitchen|baker|dessert|patisserie|grill|bbq|barbecue/.test(blob)) {
    score += 1; reasons.push('food_secondary:+1');
  }

  // 3. Cuisine alignment with HE's Dakhni / Hyderabadi / halal positioning (+2 strong, +1 single)
  const cuisineHits = CUISINE_TOKENS.filter(t => blob.includes(t));
  if (cuisineHits.length >= 2) {
    score += 2; reasons.push(`cuisine_strong:+2(${cuisineHits.slice(0,3).join(',')})`);
  } else if (cuisineHits.length === 1) {
    score += 1; reasons.push(`cuisine_match:+1(${cuisineHits[0]})`);
  }

  // 4. Local sub-geo match (+1.5)
  const subGeoHits = SUB_GEO_TOKENS.filter(t => blob.includes(t));
  if (subGeoHits.length > 0) {
    score += 1.5; reasons.push(`sub_geo:+1.5(${subGeoHits[0]})`);
  }

  // 5. Heritage/legacy interest signal (+1)
  if (HERITAGE_TOKENS.some(t => blob.includes(t))) {
    score += 1; reasons.push('heritage:+1');
  }

  // 6. Late-night affinity (+1)
  if (LATENIGHT_TOKENS.some(t => blob.includes(t))) {
    score += 1; reasons.push('late_night:+1');
  }

  // 7. Verified — strong trust signal (+1)
  if (profile.is_verified) { score += 1; reasons.push('verified:+1'); }

  // 8. Business account — real-intent signal (+1)
  if (profile.is_business_account) { score += 1; reasons.push('business:+1'); }

  // 9. Engagement rate (Apify multi-vector enrichment) — +1.5 if ER ≥ 2%, +0.5 if 1-2%
  const er = parseFloat(profile.engagement_rate || 0);
  if (er >= 0.02) {
    score += 1.5; reasons.push(`er_high:+1.5(${(er*100).toFixed(2)}%)`);
  } else if (er >= 0.01) {
    score += 0.5; reasons.push(`er_ok:+0.5(${(er*100).toFixed(2)}%)`);
  }

  // 10. Recency — last post within 30d = +0.5; within 7d = +1
  if (profile.last_post_at) {
    const ageDays = (Date.now() - new Date(profile.last_post_at).getTime()) / 86400000;
    if (ageDays <= 7) {
      score += 1; reasons.push(`active_7d:+1`);
    } else if (ageDays <= 30) {
      score += 0.5; reasons.push(`active_30d:+0.5`);
    } else if (ageDays > 60) {
      score -= 1; reasons.push(`dormant:-1(${Math.round(ageDays)}d)`);
    }
  }

  // 11. Topic density — % of recent posts about food. Strong vs casual food creator distinction.
  const td = parseFloat(profile.food_topic_density || 0);
  if (td >= 0.7) {
    score += 1.5; reasons.push(`topic_strong:+1.5(${Math.round(td*100)}%)`);
  } else if (td >= 0.4) {
    score += 0.5; reasons.push(`topic_mid:+0.5(${Math.round(td*100)}%)`);
  }

  // 12. Multi-vector bonus — discovered by N vectors gets +(N-1) × 0.5
  // (passed in via profile.vector_count when scoring is run with vector data)
  const vectorCount = parseInt(profile.vector_count || 0);
  if (vectorCount >= 2) {
    const bonus = (vectorCount - 1) * 0.5;
    score += bonus; reasons.push(`multi_vector:+${bonus}(${vectorCount}vectors)`);
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

export function bucketOf(score) {
  // Buckets are PRIORITY ORDER for outreach, not gating.
  // STANDARD bucket creators are still actionable — they just go in the third send wave.
  // SKIP is reserved for genuine off-vertical (fashion / weight-loss / non-food categories).
  if (score >= 6)    return 'HERO';        // top 10-20%: white-glove, all 3 channels, owner-personalised
  if (score >= 4)    return 'PRIORITY';    // strong fit: email + WABA in standard wave
  if (score >= 2)    return 'STANDARD';    // viable: single best-channel, third wave
  return 'SKIP';                            // off-vertical — manual review before contacting
}

// ────────────────────────────────────────────────────────────────────────────
// outreachBucket — the bucket function that actually gates the cold-cron.
// Tier-aware:
//   - T0      → 'SKIP'         (auto-decline; never contact)
//   - T5+     → 'MANUAL_CASH'  (high reach; barter alone won't convert;
//                                requires owner-personalised cash-component pitch)
//   - T1–T4   → 'COLD_HERO' / 'COLD_PRIORITY' / 'COLD_STANDARD' / 'COLD_SKIP'
//               (score + barterFit determines priority within the cold wave)
//
// The cold outreach cron MUST filter to COLD_* buckets only.
// MANUAL_CASH creators stay in discovery + DB; they just never enter the
// auto-send queue. Owner reviews them via a separate surface.
// ────────────────────────────────────────────────────────────────────────────
export function outreachBucket({ tier, score }) {
  if (tier === 'T0') return 'SKIP';
  if (!isBarterFeasible(tier)) return 'MANUAL_CASH';

  // Within barter band: score + barterFit boost. T2 sweet spot rises.
  const adjusted = (score || 0) + barterFit(tier);
  if (adjusted >= 6) return 'COLD_HERO';
  if (adjusted >= 4) return 'COLD_PRIORITY';
  if (adjusted >= 2) return 'COLD_STANDARD';
  return 'COLD_SKIP';
}

// Convenience: is this bucket auto-sendable from the cold cron?
export const COLD_SENDABLE_BUCKETS = new Set(['COLD_HERO', 'COLD_PRIORITY', 'COLD_STANDARD']);
export function isColdSendable(bucket) {
  return COLD_SENDABLE_BUCKETS.has(bucket);
}

// Small helper: returns a friendly cover offer line for outreach text
export function offerLine(tierKey) {
  const t = TIER_MATRIX[tierKey];
  if (!t) return 'Full meal for 2 covers';
  let line = `Full meal for ${t.covers} covers`;
  if (t.add_on) line += ` + ${t.add_on}`;
  if (t.cash_paise > 0) line += ` + ₹${t.cash_paise / 100} reel bump`;
  return line;
}
