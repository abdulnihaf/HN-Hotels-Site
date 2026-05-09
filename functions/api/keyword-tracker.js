// HE Keyword Volume Tracker — Bangalore-wide volume for HE-relevant queries
// joined with HE GBP impressions so the gap (BLR demand vs HE capture) is visible.
//
// GET /api/keyword-tracker?action=universe       — list the tracked keyword universe + blocks
// GET /api/keyword-tracker?action=fetch          — refresh from Google Ads Keyword Planner, persist to D1
// GET /api/keyword-tracker?action=latest         — latest snapshot, joined with HE GBP queries (28d)
// GET /api/keyword-tracker?action=history&kw=X   — full historical series for one keyword
//
// Architecture:
//   Keyword Planner is fronted by hamzaexpress.in/api/google-ads (which holds the Google Ads
//   developer token + OAuth). This endpoint proxies through that, then caches into D1.
//   GBP query data comes from /api/gbp-cockpit (already deployed on this project).
//
// Cron: Cloudflare Pages doesn't support `cron` triggers natively. Use the workers/keyword-cron
//   sibling worker (or trigger /api/keyword-tracker?action=fetch from any other scheduled worker).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

// ─── Keyword Universe ─────────────────────────────────────────────────────
// Curated for Hamza Express. Covers four blocks of search intent:
//   generic_near_me — auto-geo "near me" queries (biggest volume, lowest impression share)
//   shivajinagar   — destination queries from 5-7km catchment ("shivajinagar biryani", both spellings)
//   hero           — HE menu hero items × geo modifier (ghee rice, kabab, biryani heroes, bheja, etc.)
//   landmark       — proximity queries to MG Rd / Commercial St / Russell Mkt / Brigade Rd / City Mkt
//   other          — Bangalore-wide brand/cuisine queries
const UNIVERSE = [
  // GENERIC NEAR-ME — auto-geo, dominant Bangalore-wide volume
  ['biryani near me',                     'generic_near_me'],
  ['food near me',                        'generic_near_me'],
  ['restaurants near me',                 'generic_near_me'],
  ['restaurants nearby',                  'generic_near_me'],
  ['best restaurant near me',             'generic_near_me'],
  ['best biryani near me',                'generic_near_me'],
  ['mutton biryani near me',              'generic_near_me'],
  ['chicken biryani near me',             'generic_near_me'],
  ['hyderabadi biryani near me',          'generic_near_me'],
  ['mandi biryani near me',               'generic_near_me'],
  ['bucket biryani near me',              'generic_near_me'],
  ['dum biryani near me',                 'generic_near_me'],
  ['halal food near me',                  'generic_near_me'],
  ['halal restaurant near me',            'generic_near_me'],
  ['kabab near me',                       'generic_near_me'],
  ['kebab near me',                       'generic_near_me'],
  ['shawarma near me',                    'generic_near_me'],
  ['tandoori chicken near me',            'generic_near_me'],
  ['grill chicken near me',               'generic_near_me'],
  ['grilled chicken near me',             'generic_near_me'],
  ['fast food near me',                   'generic_near_me'],
  ['late night restaurant near me',       'generic_near_me'],
  ['late night food near me',             'generic_near_me'],
  ['24 hour restaurant in bangalore',     'generic_near_me'],
  ['non veg restaurant near me',          'generic_near_me'],
  ['non veg food near me',                'generic_near_me'],
  ['biryani delivery near me',            'generic_near_me'],
  ['food delivery near me',               'generic_near_me'],
  ['muslim restaurant near me',           'generic_near_me'],

  // SHIVAJINAGAR DESTINATION — both spellings (Google treats them as variants)
  ['shivajinagar biryani',                'shivajinagar'],
  ['shivaji nagar biryani',               'shivajinagar'],
  ['biryani in shivajinagar',             'shivajinagar'],
  ['biryani in shivaji nagar',            'shivajinagar'],
  ['best biryani in shivajinagar',        'shivajinagar'],
  ['best biryani in shivaji nagar',       'shivajinagar'],
  ['best biryani in shivaji nagar bangalore', 'shivajinagar'],
  ['best biryani shivaji nagar',          'shivajinagar'],
  ['shivajinagar restaurant',             'shivajinagar'],
  ['shivaji nagar restaurants',           'shivajinagar'],
  ['restaurants in shivajinagar',         'shivajinagar'],
  ['restaurants in shivaji nagar',        'shivajinagar'],
  ['best restaurants in shivaji nagar bangalore', 'shivajinagar'],
  ['best restaurant in shivajinagar',     'shivajinagar'],
  ['shivajinagar food',                   'shivajinagar'],
  ['food in shivajinagar',                'shivajinagar'],
  ['best food in shivaji nagar',          'shivajinagar'],
  ['shivajinagar mughlai',                'shivajinagar'],
  ['mughlai shivaji nagar',               'shivajinagar'],
  ['halal food shivajinagar',             'shivajinagar'],
  ['halal restaurant shivajinagar',       'shivajinagar'],
  ['kabab shivajinagar',                  'shivajinagar'],
  ['chicken kabab shivaji nagar',         'shivajinagar'],
  ['late night biryani bangalore',        'shivajinagar'],
  ['hyderabadi biryani shivajinagar',     'shivajinagar'],
  ['dakhni biryani bangalore',            'shivajinagar'],
  ['dakhni food bangalore',               'shivajinagar'],
  ['mughlai restaurants in bangalore',    'shivajinagar'],
  ['best mughlai restaurants in bangalore', 'shivajinagar'],

  // HERO ITEMS — exact phrases of HE's top revenue dishes
  ['ghee rice near me',                   'hero'],
  ['ghee rice bangalore',                 'hero'],
  ['chicken kabab near me',               'hero'],
  ['chicken kebab near me',               'hero'],
  ['charcoal kabab near me',              'hero'],
  ['seekh kabab near me',                 'hero'],
  ['bheja fry near me',                   'hero'],
  ['mutton brain near me',                'hero'],
  ['chicken 65 near me',                  'hero'],
  ['chicken tikka near me',               'hero'],
  ['mughlai chicken near me',             'hero'],
  ['hamza biryani',                       'hero'],
  ['hamza hotel bangalore',               'hero'],

  // LANDMARK PROXIMITY — 5-7km catchment via specific landmarks
  ['biryani near commercial street',      'landmark'],
  ['biryani near mg road',                'landmark'],
  ['biryani near russell market',         'landmark'],
  ['biryani near brigade road',           'landmark'],
  ['restaurants near commercial street',  'landmark'],
  ['restaurants near mg road',            'landmark'],
  ['restaurants near brigade road',       'landmark'],
  ['restaurants near russell market',     'landmark'],
  ['food near commercial street',         'landmark'],
  ['food near mg road',                   'landmark'],
  ['halal food near commercial street',   'landmark'],
  ['best biryani near commercial street', 'landmark'],
  ['biryani near city market',            'landmark'],

  // OTHER — Bangalore-wide cuisine
  ['hyderabadi biryani in bangalore',     'other'],
  ['hyderabadi biryani bangalore',        'other'],
  ['best biryani in bangalore',           'other'],
  ['best biryani bangalore',              'other'],
  ['best kabab bangalore',                'other'],
  ['biryani bangalore',                   'other'],
];

const KEYWORD_PLANNER_UPSTREAM = 'https://hamzaexpress.in/api/google-ads';
const GBP_COCKPIT_UPSTREAM     = 'https://hnhotels.in/api/gbp-cockpit';
const BANGALORE_GEO            = '1007768';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'latest';

  try {
    switch (action) {
      case 'universe':  return json(buildUniverseResponse());
      case 'fetch':     return json(await fetchAndStore(env, url));
      case 'latest':    return json(await loadLatest(env));
      case 'history':   return json(await loadHistory(env, url.searchParams.get('kw') || ''));
      default:          return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: err.message, stack: env.DEBUG ? err.stack : undefined }, 500);
  }
}

// ─── Action: universe ────────────────────────────────────────────────────
function buildUniverseResponse() {
  const blocks = {};
  for (const [kw, block] of UNIVERSE) {
    if (!blocks[block]) blocks[block] = [];
    blocks[block].push(kw);
  }
  return {
    total: UNIVERSE.length,
    blocks: Object.fromEntries(
      Object.entries(blocks).map(([k, v]) => [k, { count: v.length, keywords: v }])
    ),
  };
}

// ─── Action: fetch ───────────────────────────────────────────────────────
// Calls Keyword Planner (via HE upstream), persists rows to D1.
// Auth: optional ?key=<DASHBOARD_KEY> if env.DASHBOARD_KEY set; otherwise open
// (the Keyword Planner upstream is rate-limited and idempotent).
async function fetchAndStore(env, url) {
  if (env.DASHBOARD_KEY && url.searchParams.get('key') !== env.DASHBOARD_KEY) {
    throw new Error('forbidden — supply ?key=DASHBOARD_KEY');
  }
  if (!env.DB) throw new Error('D1 binding "DB" missing on this Pages project');

  const today = todayIstYmd();
  const keywords = UNIVERSE.map(([kw]) => kw);

  // Keyword Planner accepts up to ~50-100 keywords per call. Keep batches at 30 to
  // stay well under URL length limits when proxying via the upstream's GET param.
  const BATCH = 30;
  const results = [];
  for (let i = 0; i < keywords.length; i += BATCH) {
    const batch = keywords.slice(i, i + BATCH);
    const params = new URLSearchParams({
      action:   'keyword-volumes',
      keywords: batch.join(','),
      location: BANGALORE_GEO,
    });
    const resp = await fetch(`${KEYWORD_PLANNER_UPSTREAM}?${params.toString()}`);
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      throw new Error(`upstream Keyword Planner ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error(`upstream error: ${data.error}`);
    for (const k of (data.keywords || [])) results.push(k);
  }

  // Build a name→block map (preserve original casing)
  const blockMap = new Map(UNIVERSE.map(([kw, block]) => [kw.toLowerCase(), block]));

  // Persist — INSERT OR IGNORE so rerunning the same day is idempotent
  const stmt = env.DB.prepare(`
    INSERT OR IGNORE INTO kw_volumes
      (keyword, block, captured_at, avg_monthly_searches, low_bid_inr, high_bid_inr,
       competition, competition_index, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const batchStmts = [];
  for (const r of results) {
    const kw     = (r.keyword || '').toLowerCase().trim();
    const block  = blockMap.get(kw) || 'other';
    const vol    = parseInt(r.avgMonthlySearches) || 0;
    const lowBid = r.lowBidINR  ? parseFloat(r.lowBidINR)  : null;
    const hiBid  = r.highBidINR ? parseFloat(r.highBidINR) : null;
    const comp   = r.competition || 'UNSPECIFIED';
    const compIx = parseInt(r.competitionIndex) || 0;
    batchStmts.push(stmt.bind(kw, block, today, vol, lowBid, hiBid, comp, compIx, BANGALORE_GEO));
  }

  if (batchStmts.length) {
    const out = await env.DB.batch(batchStmts);
    inserted = out.reduce((s, r) => s + (r.meta?.changes || 0), 0);
  }

  return {
    captured_at: today,
    keywords_requested: keywords.length,
    keywords_returned:  results.length,
    rows_inserted:      inserted,
    note: inserted < results.length
      ? 'some rows skipped — already captured today (re-run is idempotent)'
      : 'all rows inserted',
  };
}

// ─── Action: latest ──────────────────────────────────────────────────────
// Pull latest snapshot, optionally enrich with HE GBP impressions. Best-effort
// case-insensitive substring match between Keyword Planner exact phrases and
// GBP loose query matches.
async function loadLatest(env) {
  if (!env.DB) throw new Error('D1 binding "DB" missing');

  // Most recent capture date in the table
  const meta = await env.DB.prepare(`
    SELECT MAX(captured_at) AS latest_date FROM kw_volumes
  `).first();
  const latestDate = meta?.latest_date;
  if (!latestDate) {
    return {
      latest_date: null,
      universe_size: UNIVERSE.length,
      keywords: [],
      note: 'no snapshots yet — call /api/keyword-tracker?action=fetch first',
    };
  }

  const rows = await env.DB.prepare(`
    SELECT keyword, block, avg_monthly_searches, low_bid_inr, high_bid_inr,
           competition, competition_index
    FROM kw_volumes
    WHERE captured_at = ?
    ORDER BY avg_monthly_searches DESC
  `).bind(latestDate).all();

  // Pull HE GBP queries (28d) for cross-reference. Best-effort — failure shouldn't
  // tank the response.
  let gbpMap = new Map();
  try {
    const gbp = await fetch(`${GBP_COCKPIT_UPSTREAM}?brand=he&period=28d&include=summary,keywords`).then(r => r.json());
    const lastMonth = gbp?.keywords?.lastMonth || [];
    for (const q of lastMonth) {
      gbpMap.set((q.keyword || '').toLowerCase(), q.impressions || 0);
    }
  } catch (e) {
    // swallow — gbp enrichment is non-critical
  }

  // Compute prior snapshot for trend (next-most-recent date)
  let priorMap = new Map();
  const priorDate = await env.DB.prepare(`
    SELECT MAX(captured_at) AS d FROM kw_volumes WHERE captured_at < ?
  `).bind(latestDate).first();
  if (priorDate?.d) {
    const priorRows = await env.DB.prepare(`
      SELECT keyword, avg_monthly_searches FROM kw_volumes WHERE captured_at = ?
    `).bind(priorDate.d).all();
    for (const r of priorRows.results || []) {
      priorMap.set(r.keyword, r.avg_monthly_searches);
    }
  }

  const enriched = (rows.results || []).map(r => {
    const heImp = matchGbpImpressions(r.keyword, gbpMap);
    const prior = priorMap.get(r.keyword);
    const trend = prior == null ? null
                : prior === 0    ? (r.avg_monthly_searches > 0 ? 100 : 0)
                : Math.round(((r.avg_monthly_searches - prior) / prior) * 100);
    return {
      ...r,
      he_imp_28d:  heImp,
      he_share_pct: r.avg_monthly_searches > 0
        ? +(100 * heImp / r.avg_monthly_searches).toFixed(2)
        : 0,
      trend_pct:    trend,
    };
  });

  // Block aggregates
  const totals = enriched.reduce((acc, r) => {
    acc.total_volume     += r.avg_monthly_searches;
    acc.total_he_imp_28d += r.he_imp_28d;
    acc.by_block[r.block] = acc.by_block[r.block] || { volume: 0, he_imp: 0, count: 0 };
    acc.by_block[r.block].volume  += r.avg_monthly_searches;
    acc.by_block[r.block].he_imp  += r.he_imp_28d;
    acc.by_block[r.block].count   += 1;
    return acc;
  }, { total_volume: 0, total_he_imp_28d: 0, by_block: {} });

  return {
    latest_date: latestDate,
    prior_date: priorDate?.d || null,
    universe_size: UNIVERSE.length,
    totals,
    keywords: enriched,
  };
}

// Best-effort fuzzy match between Keyword Planner exact phrase and GBP query.
// GBP returns variants like "shivaji nagar biryani" while we track "shivajinagar biryani"
// — collapse spaces in 'shivaji nagar' → 'shivajinagar' for matching.
function matchGbpImpressions(kpKeyword, gbpMap) {
  if (!gbpMap.size) return 0;
  const normalize = s => s.toLowerCase().replace(/shivaji\s+nagar/g, 'shivajinagar').replace(/\s+/g, ' ').trim();
  const target = normalize(kpKeyword);
  let total = 0;
  for (const [gbpKey, imp] of gbpMap.entries()) {
    const g = normalize(gbpKey);
    if (g === target) { total = Math.max(total, imp); continue; } // exact match
    // partial: GBP query contains the KP phrase as substring
    if (g.includes(target) || target.includes(g)) total = Math.max(total, imp);
  }
  return total;
}

// ─── Action: history ─────────────────────────────────────────────────────
async function loadHistory(env, kwParam) {
  if (!env.DB) throw new Error('D1 binding "DB" missing');
  const kw = (kwParam || '').toLowerCase().trim();
  if (!kw) throw new Error('?kw=<keyword> required');
  const rows = await env.DB.prepare(`
    SELECT captured_at, avg_monthly_searches, low_bid_inr, high_bid_inr, competition
    FROM kw_volumes
    WHERE keyword = ?
    ORDER BY captured_at ASC
  `).bind(kw).all();
  return { keyword: kw, points: rows.results || [] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function todayIstYmd() {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  return ist.toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}
