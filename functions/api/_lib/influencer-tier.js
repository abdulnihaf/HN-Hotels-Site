// Shared tier matrix + relevance scorer for the May 2026 influencer system.
// Used by /api/influencer-outreach and /api/influencer-bookings — single source of truth.
//
// Methodology — see PR description for the market-research synthesis.
// Short version:
//   - Indian food micro-influencer barter market (2024-2026): 70%+ of 5K-50K creators
//     accept barter-only when the experience is unique. 60K+ typically need cash component.
//   - HE's 1918 Dakhni heritage + late-night exclusivity = unique enough to be barter-first.
//   - Cover counts scale with follower count, but cash component only kicks in at T4 (60K+).

export const TIER_MATRIX = {
  T1: {
    label:        '5K–15K · Nano-Micro',
    min:          5000,
    max:          14999,
    covers:       2,
    cash_paise:   0,
    budget_paise: 120000,                   // ₹1,200 retail = 2 covers @ ₹600 generous
    add_on:       null,
    ask:          '1 reel + 3 stories + tag',
  },
  T2: {
    label:        '15K–30K · Mid-Micro',
    min:          15000,
    max:          29999,
    covers:       3,
    cash_paise:   0,
    budget_paise: 180000,                   // ₹1,800
    add_on:       'Welcome chai',
    ask:          '1 reel + 5 stories + tag',
  },
  T3: {
    label:        '30K–60K · Upper-Micro',
    min:          30000,
    max:          59999,
    covers:       4,
    cash_paise:   0,
    budget_paise: 240000,                   // ₹2,400
    add_on:       'Welcome chai + dessert flight',
    ask:          '1 reel + 1 permanent post + 5 stories',
  },
  T4: {
    label:        '60K–100K · Macro-Micro',
    min:          60000,
    max:          99999,
    covers:       4,
    cash_paise:   50000,                    // ₹500
    budget_paise: 290000,                   // ₹2,400 food + ₹500 cash
    add_on:       'Mutton Brain Dry comp + dessert flight + chai',
    ask:          '1 reel + 1 permanent post + 7 stories + 7-day bio tag',
  },
  T5: {
    label:        '100K+ · Edge-Macro',
    min:          100000,
    max:          99999999,
    covers:       4,
    cash_paise:   200000,                   // ₹2,000
    budget_paise: 440000,                   // ₹2,400 food + ₹2,000 cash
    add_on:       'Full chef tasting (8 dishes) + family photo + chef interaction',
    ask:          '2 reels + 1 permanent post + collab post + IG live snippet',
  },
};

export function tierOf(followers) {
  const f = followers || 0;
  if (f < 15000)  return 'T1';
  if (f < 30000)  return 'T2';
  if (f < 60000)  return 'T3';
  if (f < 100000) return 'T4';
  return 'T5';
}

// ────────────────────────────────────────────────────────────────────────────
// Relevance scorer — 0 to ~10 scale based on bio + name + category signals
// ────────────────────────────────────────────────────────────────────────────

const SUB_GEO_TOKENS = [
  'frazer town', 'frazertown', 'mosque road', 'shivajinagar',
  'commercial st', 'commercial street', 'mg rd', 'm.g. road', 'mg road',
  'brigade rd', 'brigade road', 'cubbon park', 'shivajinagar bus',
];
const HALAL_TOKENS = [
  'halal', 'muslim', 'islamic', 'mughlai', 'urdu', 'iftar', 'eid', 'biryani',
  'hyderab', 'dakhni', 'kabab', 'kebab', 'tandoor', 'mutton',
];
const HERITAGE_TOKENS = [
  'authentic', 'heritage', 'classic', 'legacy', 'family-run', 'family run',
  'generations', 'oldest', 'since 1', 'vintage', 'traditional', 'original',
];
const LATENIGHT_TOKENS = [
  'late night', 'late-night', '24x7', 'midnight', 'after dark', 'nightlife',
  'party', 'late', 'night out',
];
const FOOD_PRIMARY_TOKENS = [
  'food blogger', 'foodblogger', 'food vlogger', 'foodvlogger', 'food critic',
  'food reviewer', 'food journal', 'foodie', 'food creator', 'chef',
  'food explorer', 'food hunter', 'food diary',
];
const BLR_STRONG_TOKENS = [
  'bangalore based', 'bengaluru based', 'based in bangalore', 'based in bengaluru',
  'living in bangalore', 'living in bengaluru', 'namma bengaluru',
  'in bangalore', 'in bengaluru', '📍bangalore', '📍bengaluru',
];

export function scoreRelevance(profile) {
  const bio = String(profile.biography || '').toLowerCase();
  const fullName = String(profile.full_name || '').toLowerCase();
  const cat = String(profile.category_name || '').toLowerCase();
  const blob = `${bio} ${fullName} ${cat}`;

  let score = 0;
  const reasons = [];

  // 1. BLR resident strong signal (+3) vs casual mention (+1)
  if (BLR_STRONG_TOKENS.some(t => blob.includes(t))) {
    score += 3; reasons.push('blr_resident:+3');
  } else if (/bangalore|bengaluru|blr|bglr/.test(blob)) {
    score += 1; reasons.push('blr_mention:+1');
  }

  // 2. Food vertical primary (+2)
  if (FOOD_PRIMARY_TOKENS.some(t => blob.includes(t))) {
    score += 2; reasons.push('food_primary:+2');
  } else if (/food|restaurant|cafe|cuisine|kitchen|baker|dessert/.test(blob)) {
    score += 1; reasons.push('food_secondary:+1');
  }

  // 3. Cuisine alignment (+2 — Dakhni/biryani/halal)
  const cuisineHits = HALAL_TOKENS.filter(t => blob.includes(t));
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

  // 7. Verified (+0.5)
  if (profile.is_verified) { score += 0.5; reasons.push('verified:+0.5'); }

  // 8. Business account (+0.5)
  if (profile.is_business_account) { score += 0.5; reasons.push('business:+0.5'); }

  return { score: Math.round(score * 10) / 10, reasons };
}

export function bucketOf(score) {
  if (score >= 7)   return 'HERO';        // top 5-15: white-glove, all 3 channels, +1 cover bonus
  if (score >= 4.5) return 'PRIORITY';    // 25-40: email + WABA primary, IG DM if no other
  if (score >= 2.5) return 'STANDARD';    // rest: single channel only
  return 'SKIP';                          // below threshold — not worth contacting
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
