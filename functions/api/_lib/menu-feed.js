// _lib/menu-feed.js — fetch live HE top-sellers from /api/menu-top-sellers.
//
// Source of truth for any creator/marketing copy that needs specific dish names.
// Memory: feedback_never_invent_menu_items.md (2026-05-11).
//
// Architecture:
//   - HE Worker hosts the POS-backed endpoint with its own ODOO_API_KEY.
//   - HN Worker fetches cross-origin; CF cache + Worker module-cache absorb load.
//   - Module-level memo keeps re-fetches inside one Worker invocation to a single round-trip.
//
// Failure mode: on fetch error, return a safe empty shape so callers can fall
// back to category-only copy. Never throw — outreach must not block on POS fetch.

const HE_BASE = 'https://hamzaexpress.in';

let _memo = null;
let _memoExpiresAt = 0;
const MEMO_TTL_MS = 60 * 60 * 1000; // 1h — same order of magnitude as the upstream cache TTL

// Heuristic mapping: top-level POS categories → marketing-copy buckets we use in outreach.
// Keys are case-insensitive partial matches against POS category names.
// Used to pull one representative top-seller per bucket for the outreach copy.
const COPY_BUCKETS = [
  { copy: 'hero biryani',           match: /biryan/i },
  { copy: 'coal-tandoor kabab',     match: /kabab|kebab/i },
  { copy: 'signature heritage dish', match: /mughlai|special|chatpata|brain|bheja|hamza/i },
  { copy: 'tandoor mains',          match: /tandoor|tandoori|grill/i },
  { copy: 'heritage rice',          match: /rice|ghee|pulao/i },
  { copy: 'breads',                 match: /bread|naan|roti|kulcha|paratha/i },
  { copy: 'Dakhni dessert',         match: /dessert|sweet|meetha|kheer|qubani/i },
  { copy: 'chai / Dakhni drink',    match: /chai|drink|beverage|lassi/i },
];

export async function fetchMenuFeed(env) {
  const now = Date.now();
  if (_memo && now < _memoExpiresAt) return _memo;

  try {
    const r = await fetch(`${HE_BASE}/api/menu-top-sellers?days=30&per_category=5`, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!r.ok) throw new Error(`he_menu_feed_${r.status}`);
    const j = await r.json();
    if (!j.success) throw new Error('he_menu_feed_unsuccessful');
    _memo = {
      byCategory: j.byCategory || {},
      heroes: j.heroes || [],
      allowlist: new Set((j.allowlist || []).map(s => s.toLowerCase())),
      fetched_at: now,
    };
    _memoExpiresAt = now + MEMO_TTL_MS;
    return _memo;
  } catch (err) {
    // Safe empty shape — callers must handle and fall back to category-only copy.
    return { byCategory: {}, heroes: [], allowlist: new Set(), fetched_at: now, error: err.message };
  }
}

// Given a fetched menu feed and a tier, return an array of category-based offer
// bullets with the current top item in brackets. Adapts automatically when POS
// top-sellers shift (e.g. a new chef special enters the rotation).
//
// covers ∈ {1..6} maps to bullet count + which category buckets to mention.
// Returns array of plain strings (caller formats with bullet glyphs).
export function renderOfferLines(tier, menuFeed) {
  const covers = tier.covers || 1;

  // Find the top seller for each marketing copy bucket
  const pickedBuckets = [];
  for (const bucket of COPY_BUCKETS) {
    const item = findTopInBucket(menuFeed.byCategory, bucket.match);
    if (item) pickedBuckets.push({ copy: bucket.copy, item });
    if (pickedBuckets.length >= Math.max(3, Math.min(covers + 1, 6))) break;
  }

  if (pickedBuckets.length === 0) {
    // Fallback: pure category-level copy if POS feed is unavailable.
    return [
      `Full meal for ${covers} from our 1918 Dakhni menu — biryanis, kababs, breads, and the family classics`,
    ];
  }

  return pickedBuckets.map(({ copy, item }) => `${copy} (${item.name})`);
}

function findTopInBucket(byCategory, regex) {
  // Walk all categories; collect items whose category name OR product name matches the regex;
  // pick the highest-qty.
  let best = null;
  for (const [catName, items] of Object.entries(byCategory)) {
    const catMatches = regex.test(catName);
    for (const it of items) {
      const nameMatches = regex.test(it.name);
      if (!catMatches && !nameMatches) continue;
      if (!best || it.qty > best.qty) best = it;
    }
  }
  return best;
}

// Build a short prose summary of the offer (for the WABA template body var,
// or anywhere we need a single string instead of bullets).
export function renderOfferSummary(tier, menuFeed) {
  const lines = renderOfferLines(tier, menuFeed);
  if (lines.length <= 1) return lines[0] || '';
  // "X, Y, and Z" join
  const last = lines.pop();
  return `${lines.join(', ')}, and ${last}`;
}

// AI guard: scan a short text for food nouns that aren't in the POS allowlist.
// Returns array of suspect tokens (empty = safe). Caller decides what to do
// (retry the AI call, or fall back to deterministic template).
//
// Tokens we treat as food nouns: rough heuristic — words ending in common
// food-name patterns, or known cuisine generics. The allowlist contains
// case-folded current SKU names; partial matches count as OK
// (e.g. "biryani" is OK if "Mutton Biryani" is in the allowlist).
const FOOD_NOUN_REGEX = /\b(soup|salad|kabab|kebab|biryani|tikka|tandoori|naan|roti|paratha|kulcha|paya|nihari|haleem|brain|bheja|chatpata|mughlai|kheer|kulfi|halwa|lassi|chai|kahwa|samosa|pakora|fritter|seekh|shawarma|rezala|kalmi|chaap|korma|qorma|curry|gravy|fry|masala|pulao|ghee|rice|dessert|paneer|chicken|mutton|lamb|fish|prawn|bun|biscuit|maska|coffee)\b/gi;

export function findUnsafeFoodTerms(text, allowlist) {
  if (!text) return [];
  const lc = text.toLowerCase();
  const matches = new Set();
  let m;
  FOOD_NOUN_REGEX.lastIndex = 0;
  while ((m = FOOD_NOUN_REGEX.exec(lc)) !== null) {
    matches.add(m[0]);
  }
  const suspect = [];
  for (const token of matches) {
    // OK if any allowlist entry contains this token as a substring
    let ok = false;
    for (const sku of allowlist) {
      if (sku.includes(token)) { ok = true; break; }
    }
    if (!ok) suspect.push(token);
  }
  return suspect;
}
