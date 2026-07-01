// Sauda Price Scout
// Feasibility-to-MVP layer only: discovery, pinned refresh, liveness, mapping.
// No cart/checkout automation lives here.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OWNER_PINS = new Set(['0305']);
const STAFF_PINS = new Map([
  ['0305', { pin: '0305', name: 'Nihaf', role: 'owner' }],
  ['8523', { pin: '8523', name: 'Basheer', role: 'purchase' }],
  ['2026', { pin: '2026', name: 'Zoya', role: 'purchase' }],
]);

const SOURCE_SEEDS = [
  {
    source_key: 'HYPERPURE',
    label: 'Hyperpure',
    source_kind: 'B2B',
    base_url: 'https://www.hyperpure.com/',
    priority_rank: 10,
    liveness_threshold_hours: 30,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'HIGH',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Logged-in B2B catalogue; strong for staples and planned buying, weak when search returns food-service finished goods.',
  },
  {
    source_key: 'ZEPTO',
    label: 'Zepto',
    source_kind: 'QUICK_COMMERCE',
    base_url: 'https://www.zeptonow.com/',
    priority_rank: 20,
    liveness_threshold_hours: 12,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'MEDIUM_HIGH',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Location/session dependent quick-commerce prices; good emergency signal, not bulk procurement truth.',
  },
  {
    source_key: 'BLINKIT',
    label: 'Blinkit',
    source_kind: 'QUICK_COMMERCE',
    base_url: 'https://blinkit.com/',
    priority_rank: 30,
    liveness_threshold_hours: 12,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'MEDIUM_HIGH',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Fast liveness decay and location-dependent stock; useful fallback only when mapped candidate stays live.',
  },
  {
    source_key: 'INSTAMART',
    label: 'Instamart',
    source_kind: 'QUICK_COMMERCE',
    base_url: 'https://www.swiggy.com/instamart',
    priority_rank: 40,
    liveness_threshold_hours: 12,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'MEDIUM',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Dynamic store availability; should never be crowned unless pinned SKU refresh is fresh.',
  },
  {
    source_key: 'AMAZON',
    label: 'Amazon',
    source_kind: 'MARKETPLACE',
    base_url: 'https://www.amazon.in/',
    priority_rank: 50,
    liveness_threshold_hours: 24,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'MEDIUM',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Now/Fresh/Business surfaces vary by account and location; stable URL evidence helps owner review.',
  },
  {
    source_key: 'FLIPKART',
    label: 'Flipkart',
    source_kind: 'MARKETPLACE',
    base_url: 'https://www.flipkart.com/',
    priority_rank: 60,
    liveness_threshold_hours: 24,
    capture_host: 'RTX',
    auth_mode: 'logged_in_browser',
    feasibility: 'MEDIUM_LOW',
    cadence: 'weekly discovery + daily pinned refresh',
    constraint: 'Minutes availability is narrow; keep as discovery source, not primary crown source.',
  },
];

const SOURCE_ALIASES = {
  hyperpure: 'HYPERPURE',
  zepto: 'ZEPTO',
  blinkit: 'BLINKIT',
  instamart: 'INSTAMART',
  swiggy_instamart: 'INSTAMART',
  amazon: 'AMAZON',
  amazon_now: 'AMAZON',
  amazon_fresh: 'AMAZON',
  amazon_business: 'AMAZON',
  flipkart: 'FLIPKART',
  flipkart_minutes: 'FLIPKART',
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sx_item (
    item_code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    last_actual_rate_paise INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
  )`,
  `CREATE TABLE IF NOT EXISTS sx_price_batch (
    id TEXT PRIMARY KEY,
    batch_date TEXT NOT NULL,
    batch_kind TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'RUNNING',
    material_count INTEGER NOT NULL DEFAULT 0,
    ok_count INTEGER NOT NULL DEFAULT 0,
    unavailable_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    portal_results_json TEXT NOT NULL DEFAULT '{}',
    triggered_by_pin TEXT NOT NULL DEFAULT '',
    started_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
    completed_at_ist TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sx_price_snapshot (
    snapshot_date TEXT NOT NULL,
    item_code TEXT NOT NULL,
    source_key TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    uom TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    sku_title TEXT NOT NULL DEFAULT '',
    sku_url TEXT NOT NULL DEFAULT '',
    pack_size TEXT NOT NULL DEFAULT '',
    price_paise INTEGER,
    unit_price_paise INTEGER,
    eta_minutes INTEGER,
    eta_label TEXT NOT NULL DEFAULT '',
    stock_status TEXT NOT NULL DEFAULT '',
    match_confidence REAL,
    match_notes TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL DEFAULT '{}',
    batch_id TEXT NOT NULL DEFAULT '',
    captured_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
    source TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (snapshot_date, item_code, source_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sx_source_profile (
    source_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('B2B','QUICK_COMMERCE','MARKETPLACE','LOCAL_VENDOR','OTHER')),
    base_url TEXT NOT NULL DEFAULT '',
    priority_rank INTEGER NOT NULL DEFAULT 100,
    liveness_threshold_hours INTEGER NOT NULL DEFAULT 24,
    discovery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (discovery_enabled IN (0,1)),
    refresh_enabled INTEGER NOT NULL DEFAULT 1 CHECK (refresh_enabled IN (0,1)),
    capture_host TEXT NOT NULL DEFAULT 'RTX',
    auth_mode TEXT NOT NULL DEFAULT 'logged_in_browser',
    config_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    updated_by_pin TEXT NOT NULL DEFAULT '',
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
  )`,
  `CREATE TABLE IF NOT EXISTS sx_source_search_phrase (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL,
    source_key TEXT NOT NULL,
    phrase TEXT NOT NULL,
    priority_rank INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    evidence_json TEXT NOT NULL DEFAULT '{}',
    updated_by_pin TEXT NOT NULL DEFAULT '',
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
    UNIQUE (item_code, source_key, phrase)
  )`,
  `CREATE TABLE IF NOT EXISTS sx_source_candidate (
    candidate_id TEXT PRIMARY KEY,
    item_code TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_sku TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    pack_size TEXT NOT NULL DEFAULT '',
    unit_label TEXT NOT NULL DEFAULT '',
    price_paise INTEGER,
    unit_price_paise INTEGER,
    currency TEXT NOT NULL DEFAULT 'INR',
    url TEXT NOT NULL DEFAULT '',
    captured_at_ist TEXT NOT NULL,
    batch_id TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    live_state TEXT NOT NULL DEFAULT 'STALE' CHECK (live_state IN ('LIVE','STALE','DEAD')),
    match_decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (match_decision IN ('PENDING','EXACT','SUBSTITUTE','EMERGENCY','REJECT')),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
    rejection_reason TEXT NOT NULL DEFAULT '',
    owner_note TEXT NOT NULL DEFAULT '',
    updated_by_pin TEXT NOT NULL DEFAULT '',
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
  )`,
  `CREATE TABLE IF NOT EXISTS sx_item_source_map (
    item_code TEXT NOT NULL,
    source_key TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('EXACT','SUBSTITUTE','EMERGENCY','REJECT')),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
    priority_rank INTEGER NOT NULL DEFAULT 100,
    notes TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    updated_by_pin TEXT NOT NULL DEFAULT '',
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
    PRIMARY KEY (item_code, source_key, candidate_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sx_refresh_job (
    job_id TEXT PRIMARY KEY,
    job_kind TEXT NOT NULL CHECK (job_kind IN ('WEEKLY_DISCOVERY','DAILY_PINNED_REFRESH','FALLBACK_SEARCH')),
    item_code TEXT NOT NULL DEFAULT '',
    source_key TEXT NOT NULL DEFAULT '',
    candidate_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
    scheduled_for_ist TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    created_by_pin TEXT NOT NULL DEFAULT '',
    created_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30'),
    updated_at_ist TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','+5 hours','+30 minutes') || '+05:30')
  )`,
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_sx_item_scout_rank ON sx_item(scout_active, mvp_rank, label)`,
  `CREATE INDEX IF NOT EXISTS idx_sx_source_candidate_item_source ON sx_source_candidate(item_code, source_key, captured_at_ist DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sx_source_candidate_live ON sx_source_candidate(live_state, match_decision, is_pinned, unit_price_paise)`,
  `CREATE INDEX IF NOT EXISTS idx_sx_item_source_map_item ON sx_item_source_map(item_code, mapping_state, is_pinned, priority_rank)`,
  `CREATE INDEX IF NOT EXISTS idx_sx_refresh_job_status ON sx_refresh_job(status, job_kind, scheduled_for_ist)`,
];

const COLUMN_ADDS = {
  sx_item: [
    ['image_r2_key', `ALTER TABLE sx_item ADD COLUMN image_r2_key TEXT NOT NULL DEFAULT ''`],
    ['scout_active', `ALTER TABLE sx_item ADD COLUMN scout_active INTEGER NOT NULL DEFAULT 0 CHECK (scout_active IN (0,1))`],
    ['mvp_rank', `ALTER TABLE sx_item ADD COLUMN mvp_rank INTEGER`],
  ],
  sx_price_batch: [
    ['source_key', `ALTER TABLE sx_price_batch ADD COLUMN source_key TEXT NOT NULL DEFAULT ''`],
    ['candidate_count', `ALTER TABLE sx_price_batch ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0`],
    ['pinned_count', `ALTER TABLE sx_price_batch ADD COLUMN pinned_count INTEGER NOT NULL DEFAULT 0`],
    ['stale_count', `ALTER TABLE sx_price_batch ADD COLUMN stale_count INTEGER NOT NULL DEFAULT 0`],
    ['host_key', `ALTER TABLE sx_price_batch ADD COLUMN host_key TEXT NOT NULL DEFAULT ''`],
    ['evidence_json', `ALTER TABLE sx_price_batch ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'`],
    ['notes', `ALTER TABLE sx_price_batch ADD COLUMN notes TEXT NOT NULL DEFAULT ''`],
  ],
  sx_price_snapshot: [
    ['candidate_id', `ALTER TABLE sx_price_snapshot ADD COLUMN candidate_id TEXT NOT NULL DEFAULT ''`],
    ['evidence_json', `ALTER TABLE sx_price_snapshot ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'`],
    ['live_state', `ALTER TABLE sx_price_snapshot ADD COLUMN live_state TEXT NOT NULL DEFAULT 'STALE' CHECK (live_state IN ('LIVE','STALE','DEAD'))`],
    ['match_decision', `ALTER TABLE sx_price_snapshot ADD COLUMN match_decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (match_decision IN ('PENDING','EXACT','SUBSTITUTE','EMERGENCY','REJECT'))`],
    ['source_url', `ALTER TABLE sx_price_snapshot ADD COLUMN source_url TEXT NOT NULL DEFAULT ''`],
  ],
};

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'dashboard';
  const db = env.DB;
  if (!db) return withCors(json({ ok: false, error: 'DB binding missing' }, 500), request);

  try {
    const publicRead = action === 'feasibility' || action === 'schema-proposal';
    let actor = null;
    if (!publicRead) {
      actor = await actorFrom(request, url, env);
      if (!actor) return withCors(json({ ok: false, error: 'unauthorized' }, 401), request);
    }

    await ensureScoutSchema(db);

    if (request.method === 'GET') {
      if (action === 'dashboard') return withCors(json(await dashboard(db, url)), request);
      if (action === 'feasibility') return withCors(json({ ok: true, sources: SOURCE_SEEDS }), request);
      if (action === 'schema-proposal') return withCors(json(schemaProposal()), request);
      if (action === 'price-find') return withCors(json(await priceFind(db, url)), request);
      if (action === 'stale-scout') return withCors(json(await staleScout(db, url)), request);
      if (action === 'drift-alert') return withCors(json(await driftAlert(db, url)), request);
      if (action === 'audit') return withCors(json(await audit(db)), request);
      return withCors(json({ ok: false, error: `unknown action: ${action}` }, 400), request);
    }

    if (request.method !== 'POST') return withCors(json({ ok: false, error: 'method_not_allowed' }, 405), request);

    if (action === 'candidate-decision') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await candidateDecision(db, body, actor)), request);
    }
    if (action === 'source-profile') {
      const body = await request.json().catch(() => ({}));
      if (!OWNER_PINS.has(actor.pin)) return withCors(json({ ok: false, error: 'owner_only' }, 403), request);
      return withCors(json(await sourceProfile(db, body, actor)), request);
    }
    if (action === 'search-phrase') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await searchPhrase(db, body, actor)), request);
    }
    if (action === 'refresh-job') {
      const body = await request.json().catch(() => ({}));
      return withCors(json(await refreshJob(db, body, actor)), request);
    }
    if (action === 'ingest-candidates') {
      const ingestActor = await ingestAuth(request, url, env);
      if (!ingestActor) return withCors(json({ ok: false, error: 'ingest_unauthorized' }, 401), request);
      const body = await request.json().catch(() => ({}));
      return withCors(json(await ingestCandidates(db, body, ingestActor)), request);
    }

    return withCors(json({ ok: false, error: `unknown action: ${action}` }, 400), request);
  } catch (err) {
    return withCors(json({ ok: false, error: 'server_error', detail: String(err?.message || err) }, 500), request);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function withCors(resp, request) {
  const origin = request.headers.get('origin') || '*';
  resp.headers.set('access-control-allow-origin', origin);
  resp.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  resp.headers.set('access-control-allow-headers', 'content-type,authorization,x-scout-token,x-dashboard-key');
  return resp;
}

async function actorFrom(request, url, env) {
  const pin = String(url.searchParams.get('pin') || request.headers.get('x-pin') || '').trim();
  if (STAFF_PINS.has(pin)) return STAFF_PINS.get(pin);

  const key = url.searchParams.get('key') || request.headers.get('x-dashboard-key') || '';
  if (key && key === (env.DASHBOARD_KEY || env.DASHBOARD_API_KEY)) {
    return { pin: 'dashboard', name: 'Dashboard', role: 'system' };
  }
  return null;
}

async function ingestAuth(request, url, env) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const token = bearer || request.headers.get('x-scout-token') || url.searchParams.get('token') || '';
  const expected = env.SAUDA_PRICE_SCOUT_TOKEN || env.SCOUT_INGEST_TOKEN || env.OTP_INGEST_TOKEN || env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || '';
  if (expected && token === expected) return { pin: 'rtx', name: 'RTX capture', role: 'capture-host' };
  return null;
}

async function ensureScoutSchema(db) {
  for (const stmt of SCHEMA_STATEMENTS) await db.prepare(stmt).run();
  for (const [table, adds] of Object.entries(COLUMN_ADDS)) {
    const cols = await columnSet(db, table);
    for (const [name, sql] of adds) {
      if (!cols.has(name)) {
        await db.prepare(sql).run();
        cols.add(name);
      }
    }
  }
  for (const stmt of INDEX_STATEMENTS) await db.prepare(stmt).run();
  for (const src of SOURCE_SEEDS) {
    await db.prepare(`
      INSERT OR IGNORE INTO sx_source_profile
        (source_key, label, source_kind, base_url, priority_rank, liveness_threshold_hours, capture_host, auth_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      src.source_key,
      src.label,
      src.source_kind,
      src.base_url,
      src.priority_rank,
      src.liveness_threshold_hours,
      src.capture_host,
      src.auth_mode,
      src.constraint,
    ).run();
  }
}

async function columnSet(db, table) {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((rows.results || []).map((r) => r.name));
}

async function dashboard(db, url) {
  const limit = clampInt(url.searchParams.get('limit'), 30, 1, 60);
  const [profiles, items, stats] = await Promise.all([sourceProfiles(db), mvpItems(db, limit), tableAudit(db)]);
  const profileByKey = new Map(profiles.map((p) => [p.source_key, p]));
  const itemCodes = items.map((i) => i.item_code);
  const candidates = await allCandidates(db, items, profileByKey);
  const byItem = groupBy(candidates, (c) => c.item_code);
  const rows = items.map((item) => buildItemRow(item, byItem.get(item.item_code) || [], profileByKey));
  const hooks = buildHooks(rows);
  return {
    ok: true,
    generated_at_ist: nowIST(),
    mode: 'feasibility_to_mvp',
    laws: {
      money: 'INTEGER_PAISE',
      cart_automation: false,
      stale_crown_allowed: false,
      capture_host: 'RTX/hn-winpc logged-in browser session',
    },
    d1_truth: stats,
    source_health: sourceHealth(candidates, profiles),
    hooks,
    items: rows,
  };
}

async function sourceProfiles(db) {
  const rows = await db.prepare(`
    SELECT source_key, label, source_kind, base_url, priority_rank, liveness_threshold_hours,
           discovery_enabled, refresh_enabled, capture_host, auth_mode, config_json, notes, updated_at_ist
      FROM sx_source_profile
     ORDER BY priority_rank, source_key
  `).all();
  return rows.results || [];
}

async function mvpItems(db, limit) {
  const sxRows = await db.prepare(`
    SELECT item_code, label, unit, category, brand, image_url, image_r2_key,
           last_actual_rate_paise, active, scout_active, mvp_rank, updated_at_ist
      FROM sx_item
     WHERE active = 1 AND (scout_active = 1 OR mvp_rank IS NOT NULL)
     ORDER BY COALESCE(mvp_rank, 9999), label
     LIMIT ?
  `).bind(limit).all();
  if ((sxRows.results || []).length) {
    return sxRows.results.map((r) => ({ ...r, basis: 'sx_item.mvp_rank' }));
  }

  if (!(await tableExists(db, 'buy_lines'))) return [];

  const legacy = await db.prepare(`
    SELECT item,
           LOWER(TRIM(COALESCE(uom, ''))) AS unit,
           SUM(CASE WHEN line_total_paise > 0 THEN line_total_paise ELSE 0 END) AS spend_paise,
           MAX(CASE WHEN unit_cost_paise > 0 THEN unit_cost_paise ELSE 0 END) AS last_actual_rate_paise,
           COUNT(*) AS line_count,
           MAX(biz_date) AS latest_biz_date
      FROM buy_lines
     WHERE TRIM(COALESCE(item, '')) <> ''
     GROUP BY LOWER(TRIM(item)), LOWER(TRIM(COALESCE(uom, '')))
    HAVING spend_paise > 0
     ORDER BY spend_paise DESC, latest_biz_date DESC
     LIMIT ?
  `).bind(limit).all();

  return (legacy.results || []).map((r, idx) => ({
    item_code: slug(r.item),
    label: r.item,
    unit: r.unit || '',
    category: '',
    brand: '',
    image_url: '',
    image_r2_key: '',
    last_actual_rate_paise: asInt(r.last_actual_rate_paise),
    active: 1,
    scout_active: 0,
    mvp_rank: idx + 1,
    spend_paise: asInt(r.spend_paise),
    line_count: asInt(r.line_count),
    latest_biz_date: r.latest_biz_date || '',
    basis: 'buy_lines.spend_preview',
  }));
}

async function allCandidates(db, items, profileByKey) {
  const codes = new Set(items.map((i) => i.item_code));
  const out = [];

  const scoutRows = await db.prepare(`
    SELECT c.*, m.mapping_state, m.is_pinned AS map_is_pinned, m.priority_rank AS map_priority_rank
      FROM sx_source_candidate c
      LEFT JOIN sx_item_source_map m
        ON m.item_code = c.item_code AND m.source_key = c.source_key AND m.candidate_id = c.candidate_id
     ORDER BY c.captured_at_ist DESC
     LIMIT 1200
  `).all();
  for (const row of scoutRows.results || []) {
    if (!codes.has(row.item_code)) continue;
    out.push(normalizeScoutCandidate(row, profileByKey));
  }

  const matchKeys = itemMatchKeys(items);
  out.push(...await legacyHyperpure(db, items, matchKeys, profileByKey));
  out.push(...await legacyItemPrices(db, items, matchKeys, profileByKey));
  out.push(...await legacyDailySnapshots(db, items, matchKeys, profileByKey));

  return dedupeCandidates(out);
}

function normalizeScoutCandidate(row, profileByKey) {
  const profile = profileByKey.get(row.source_key) || {};
  const live_state = computeLiveState(row.captured_at_ist, profile.liveness_threshold_hours, row.live_state);
  const mapping_state = row.mapping_state || row.match_decision || 'PENDING';
  const is_pinned = Number(row.map_is_pinned ?? row.is_pinned ?? 0) === 1;
  return {
    candidate_id: row.candidate_id,
    item_code: row.item_code,
    source_key: row.source_key,
    source: row.source_key,
    image_url: row.image_url || '',
    title: row.title || '',
    pack_size: row.pack_size || '',
    unit_label: row.unit_label || '',
    price_paise: nullableInt(row.price_paise),
    unit_price_paise: nullableInt(row.unit_price_paise ?? row.price_paise),
    url: row.url || profile.base_url || '',
    captured_at: row.captured_at_ist || '',
    evidence: parseJson(row.evidence_json, {}),
    live_state,
    match_decision: mapping_state,
    is_pinned,
    priority_rank: asInt(row.map_priority_rank || profile.priority_rank || 100),
    source_row: 'sx_source_candidate',
  };
}

async function legacyHyperpure(db, items, matchKeys, profileByKey) {
  if (!(await tableExists(db, 'hyperpure_prices'))) return [];
  const rows = await db.prepare(`
    SELECT item_key, query, cheapest_name, cheapest_price_paise, cheapest_unit_price_paise,
           cheapest_image, cheapest_pack, cheapest_unit, scraped_at, options_json, match_count
      FROM hyperpure_prices
     ORDER BY scraped_at DESC
     LIMIT 400
  `).all();
  const profile = profileByKey.get('HYPERPURE') || {};
  const out = [];
  for (const r of rows.results || []) {
    const item = matchKeys.get(normKey(r.item_key));
    if (!item) continue;
    const captured = r.scraped_at || '';
    out.push({
      candidate_id: `LEG-HYPERPURE-${item.item_code}-${stableHash(`${r.item_key}|${r.cheapest_name}|${captured}`)}`,
      item_code: item.item_code,
      source_key: 'HYPERPURE',
      source: 'HYPERPURE',
      image_url: r.cheapest_image || '',
      title: r.cheapest_name || '',
      pack_size: r.cheapest_pack || '',
      unit_label: r.cheapest_unit || '',
      price_paise: nullableInt(r.cheapest_price_paise),
      unit_price_paise: nullableInt(r.cheapest_unit_price_paise ?? r.cheapest_price_paise),
      url: profile.base_url || '',
      captured_at: captured,
      evidence: { table: 'hyperpure_prices', item_key: r.item_key, query: r.query, match_count: asInt(r.match_count), options_json: parseJson(r.options_json, []) },
      live_state: computeLiveState(captured, profile.liveness_threshold_hours),
      match_decision: 'PENDING',
      is_pinned: false,
      priority_rank: asInt(profile.priority_rank || 10),
      source_row: 'hyperpure_prices',
    });
  }
  return out;
}

async function legacyItemPrices(db, items, matchKeys, profileByKey) {
  if (!(await tableExists(db, 'item_prices'))) return [];
  const rows = await db.prepare(`
    SELECT item_key, source, query, matched_name, brand, pack, unit, price_paise,
           unit_price_paise, image, url, options_json, match_count, scraped_at
      FROM item_prices
     ORDER BY scraped_at DESC
     LIMIT 800
  `).all();
  const out = [];
  for (const r of rows.results || []) {
    const item = matchKeys.get(normKey(r.item_key));
    if (!item) continue;
    const source = canonicalSource(r.source);
    const profile = profileByKey.get(source) || {};
    const captured = r.scraped_at || '';
    out.push({
      candidate_id: `LEG-ITEM-${source}-${item.item_code}-${stableHash(`${r.item_key}|${r.source}|${r.matched_name}|${captured}`)}`,
      item_code: item.item_code,
      source_key: source,
      source,
      image_url: r.image || '',
      title: r.matched_name || '',
      pack_size: r.pack || '',
      unit_label: r.unit || '',
      price_paise: nullableInt(r.price_paise),
      unit_price_paise: nullableInt(r.unit_price_paise ?? r.price_paise),
      url: r.url || profile.base_url || '',
      captured_at: captured,
      evidence: { table: 'item_prices', item_key: r.item_key, source_raw: r.source, query: r.query, brand: r.brand, match_count: asInt(r.match_count), options_json: parseJson(r.options_json, []) },
      live_state: computeLiveState(captured, profile.liveness_threshold_hours),
      match_decision: 'PENDING',
      is_pinned: false,
      priority_rank: asInt(profile.priority_rank || 100),
      source_row: 'item_prices',
    });
  }
  return out;
}

async function legacyDailySnapshots(db, items, matchKeys, profileByKey) {
  if (!(await tableExists(db, 'daily_price_snapshots'))) return [];
  const rows = await db.prepare(`
    SELECT snapshot_date, material_id, source_key, name, uom, brand, sku_title, sku_url,
           pack_size, price_paise, unit_price_paise, stock_status, match_rule,
           match_confidence, match_notes, captured_at, batch_id, raw_json, image_url
      FROM daily_price_snapshots
     ORDER BY captured_at DESC
     LIMIT 1200
  `).all();
  const out = [];
  for (const r of rows.results || []) {
    const item = matchKeys.get(normKey(r.material_id)) || matchKeys.get(normKey(r.name));
    if (!item) continue;
    const source = canonicalSource(r.source_key);
    const profile = profileByKey.get(source) || {};
    const captured = r.captured_at || '';
    out.push({
      candidate_id: `LEG-DAY-${source}-${item.item_code}-${stableHash(`${r.material_id}|${r.source_key}|${r.sku_title}|${r.batch_id}`)}`,
      item_code: item.item_code,
      source_key: source,
      source,
      image_url: r.image_url || '',
      title: r.sku_title || r.name || '',
      pack_size: r.pack_size || '',
      unit_label: r.uom || '',
      price_paise: nullableInt(r.price_paise),
      unit_price_paise: nullableInt(r.unit_price_paise ?? r.price_paise),
      url: r.sku_url || profile.base_url || '',
      captured_at: captured,
      evidence: { table: 'daily_price_snapshots', material_id: r.material_id, stock_status: r.stock_status, match_rule: r.match_rule, match_confidence: r.match_confidence, match_notes: r.match_notes, batch_id: r.batch_id, raw_json: parseJson(r.raw_json, {}) },
      live_state: computeLiveState(captured, profile.liveness_threshold_hours),
      match_decision: 'PENDING',
      is_pinned: false,
      priority_rank: asInt(profile.priority_rank || 100),
      source_row: 'daily_price_snapshots',
    });
  }
  return out;
}

function buildItemRow(item, candidates, profileByKey) {
  const sorted = candidates
    .filter((c) => c.match_decision !== 'REJECT')
    .sort(candidateSort(profileByKey));
  const crown = crownCandidate(sorted, profileByKey);
  const hyperpure = bestForSource(sorted, 'HYPERPURE');
  const quick = sorted
    .filter((c) => ['ZEPTO', 'BLINKIT', 'INSTAMART'].includes(c.source_key) && c.live_state === 'LIVE')
    .sort(candidateSort(profileByKey))[0] || null;
  const stalePinned = candidates.filter((c) => c.is_pinned && c.live_state !== 'LIVE');
  const liveCount = candidates.filter((c) => c.live_state === 'LIVE').length;
  const paid = nullableInt(item.last_actual_rate_paise);
  const drift = crown && paid ? paid - (crown.unit_price_paise || crown.price_paise || 0) : null;

  return {
    item_code: item.item_code,
    label: item.label,
    unit: item.unit || '',
    category: item.category || '',
    brand: item.brand || '',
    visual: { image_r2_key: item.image_r2_key || '', image_url: item.image_url || '' },
    mvp_rank: item.mvp_rank,
    spend_paise: item.spend_paise || null,
    current_paid_local: {
      rate_paise: paid,
      source: item.basis || 'sx_item.last_actual_rate_paise',
      latest_biz_date: item.latest_biz_date || '',
    },
    crown,
    compare: { hyperpure, quick_commerce: quick },
    health: {
      state: crown ? 'CROWN_LIVE' : liveCount ? 'NEEDS_MAPPING' : stalePinned.length ? 'PIN_STALE' : 'NO_LIVE_CANDIDATE',
      live_candidates: liveCount,
      stale_pinned: stalePinned.length,
      candidate_count: candidates.length,
    },
    trend: {
      paid_vs_crown_delta_paise: drift,
      paid_above_crown: drift == null ? null : drift > 0,
      paid_above_crown_pct: drift != null && crown?.unit_price_paise ? Math.round((drift / crown.unit_price_paise) * 1000) / 10 : null,
    },
    candidates: candidates
      .sort(candidateSort(profileByKey))
      .slice(0, 18),
  };
}

function crownCandidate(candidates, profileByKey) {
  const mapped = candidates.filter((c) =>
    c.live_state === 'LIVE'
    && c.is_pinned
    && ['EXACT', 'SUBSTITUTE', 'EMERGENCY'].includes(c.match_decision)
    && Number(c.unit_price_paise || c.price_paise || 0) > 0
  );
  if (!mapped.length) return null;
  mapped.sort((a, b) => {
    const rank = decisionRank(a.match_decision) - decisionRank(b.match_decision);
    if (rank) return rank;
    return candidateSort(profileByKey)(a, b);
  });
  return mapped[0];
}

function bestForSource(candidates, sourceKey) {
  return candidates.find((c) => c.source_key === sourceKey && c.live_state === 'LIVE') || null;
}

function candidateSort(profileByKey) {
  return (a, b) => {
    const live = liveRank(a.live_state) - liveRank(b.live_state);
    if (live) return live;
    const mapped = decisionRank(a.match_decision) - decisionRank(b.match_decision);
    if (mapped) return mapped;
    const pinned = Number(b.is_pinned || 0) - Number(a.is_pinned || 0);
    if (pinned) return pinned;
    const ap = asInt(a.priority_rank || profileByKey.get(a.source_key)?.priority_rank || 100);
    const bp = asInt(b.priority_rank || profileByKey.get(b.source_key)?.priority_rank || 100);
    if (ap !== bp) return ap - bp;
    const au = Number(a.unit_price_paise || a.price_paise || Number.MAX_SAFE_INTEGER);
    const bu = Number(b.unit_price_paise || b.price_paise || Number.MAX_SAFE_INTEGER);
    return au - bu;
  };
}

function liveRank(state) {
  return state === 'LIVE' ? 0 : state === 'STALE' ? 1 : 2;
}

function decisionRank(decision) {
  return { EXACT: 0, SUBSTITUTE: 1, EMERGENCY: 2, PENDING: 3, REJECT: 9 }[decision] ?? 8;
}

function buildHooks(rows) {
  const crowns = rows.filter((r) => r.crown);
  const staleItems = rows.filter((r) => r.health.state === 'PIN_STALE' || r.health.state === 'NO_LIVE_CANDIDATE');
  const drifts = rows.filter((r) => r.trend.paid_above_crown === true);
  return {
    'price-find': {
      ready: crowns.length,
      blocked: rows.length - crowns.length,
      route: '/api/sauda-price?action=price-find&item_code=...',
    },
    'stale-scout': {
      alerts: staleItems.length,
      route: '/api/sauda-price?action=stale-scout',
    },
    'drift-alert': {
      alerts: drifts.length,
      route: '/api/sauda-price?action=drift-alert',
    },
  };
}

async function priceFind(db, url) {
  const dash = await dashboard(db, withLimit(url, 60));
  const itemCode = url.searchParams.get('item_code') || '';
  const rows = itemCode ? dash.items.filter((i) => i.item_code === itemCode) : dash.items;
  return { ok: true, rows: rows.map((i) => ({ item_code: i.item_code, label: i.label, crown: i.crown, health: i.health })) };
}

async function staleScout(db, url) {
  const dash = await dashboard(db, withLimit(url, 60));
  return {
    ok: true,
    rows: dash.items
      .filter((i) => i.health.state !== 'CROWN_LIVE')
      .map((i) => ({ item_code: i.item_code, label: i.label, health: i.health, stale_candidates: i.candidates.filter((c) => c.live_state !== 'LIVE').slice(0, 8) })),
  };
}

async function driftAlert(db, url) {
  const dash = await dashboard(db, withLimit(url, 60));
  return {
    ok: true,
    rows: dash.items
      .filter((i) => i.trend.paid_above_crown === true)
      .map((i) => ({ item_code: i.item_code, label: i.label, current_paid_local: i.current_paid_local, crown: i.crown, trend: i.trend })),
  };
}

function withLimit(url, limit) {
  const clone = new URL(url.toString());
  clone.searchParams.set('limit', String(limit));
  return clone;
}

async function candidateDecision(db, body, actor) {
  const candidateId = String(body.candidate_id || '').trim();
  const decision = String(body.decision || body.mapping_state || '').trim().toUpperCase();
  if (!candidateId) return { ok: false, error: 'candidate_id_required' };
  if (!['EXACT', 'SUBSTITUTE', 'EMERGENCY', 'REJECT'].includes(decision)) return { ok: false, error: 'invalid_decision' };

  let cur = await db.prepare(`SELECT * FROM sx_source_candidate WHERE candidate_id = ?`).bind(candidateId).first();
  if (!cur && body.candidate && typeof body.candidate === 'object') {
    await promoteCandidate(db, body.candidate, actor);
    cur = await db.prepare(`SELECT * FROM sx_source_candidate WHERE candidate_id = ?`).bind(candidateId).first();
  }
  if (!cur) return { ok: false, error: 'candidate_not_found' };

  const isPinned = decision === 'REJECT' ? 0 : body.is_pinned === false ? 0 : 1;
  await db.prepare(`
    UPDATE sx_source_candidate
       SET match_decision = ?, is_pinned = ?, rejection_reason = ?,
           owner_note = ?, updated_by_pin = ?, updated_at_ist = ?
     WHERE candidate_id = ?
  `).bind(
    decision,
    isPinned,
    decision === 'REJECT' ? String(body.reason || body.rejection_reason || '') : '',
    String(body.note || ''),
    actor.pin,
    nowIST(),
    candidateId,
  ).run();

  if (decision === 'REJECT') {
    await db.prepare(`
      INSERT INTO sx_item_source_map
        (item_code, source_key, candidate_id, mapping_state, is_pinned, priority_rank, notes, evidence_json, updated_by_pin, updated_at_ist)
      VALUES (?, ?, ?, 'REJECT', 0, ?, ?, ?, ?, ?)
      ON CONFLICT(item_code, source_key, candidate_id) DO UPDATE SET
        mapping_state = excluded.mapping_state,
        is_pinned = 0,
        notes = excluded.notes,
        evidence_json = excluded.evidence_json,
        updated_by_pin = excluded.updated_by_pin,
        updated_at_ist = excluded.updated_at_ist
    `).bind(cur.item_code, cur.source_key, candidateId, asInt(body.priority_rank || 100), String(body.note || ''), safeJson(body.evidence || {}), actor.pin, nowIST()).run();
  } else {
    if (isPinned) {
      await db.prepare(`
        UPDATE sx_item_source_map
           SET is_pinned = 0, updated_by_pin = ?, updated_at_ist = ?
         WHERE item_code = ? AND source_key = ? AND mapping_state <> 'REJECT'
      `).bind(actor.pin, nowIST(), cur.item_code, cur.source_key).run();
    }
    await db.prepare(`
      INSERT INTO sx_item_source_map
        (item_code, source_key, candidate_id, mapping_state, is_pinned, priority_rank, notes, evidence_json, updated_by_pin, updated_at_ist)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_code, source_key, candidate_id) DO UPDATE SET
        mapping_state = excluded.mapping_state,
        is_pinned = excluded.is_pinned,
        priority_rank = excluded.priority_rank,
        notes = excluded.notes,
        evidence_json = excluded.evidence_json,
        updated_by_pin = excluded.updated_by_pin,
        updated_at_ist = excluded.updated_at_ist
    `).bind(
      cur.item_code,
      cur.source_key,
      candidateId,
      decision,
      isPinned,
      asInt(body.priority_rank || 100),
      String(body.note || ''),
      safeJson(body.evidence || {}),
      actor.pin,
      nowIST(),
    ).run();
  }

  return { ok: true, candidate_id: candidateId, decision, is_pinned: isPinned };
}

async function promoteCandidate(db, candidate, actor) {
  const candidateId = String(candidate.candidate_id || '').trim();
  const itemCode = String(candidate.item_code || '').trim();
  const source = canonicalSource(candidate.source_key || candidate.source);
  const title = String(candidate.title || candidate.name || '').trim();
  if (!candidateId || !itemCode || !source || !title) return;

  const profile = await db.prepare(`
    SELECT liveness_threshold_hours, base_url FROM sx_source_profile WHERE source_key = ?
  `).bind(source).first();
  const capturedAt = String(candidate.captured_at || candidate.captured_at_ist || nowIST());
  const liveState = ['LIVE', 'STALE', 'DEAD'].includes(String(candidate.live_state || '').toUpperCase())
    ? String(candidate.live_state).toUpperCase()
    : computeLiveState(capturedAt, profile?.liveness_threshold_hours || 24);

  await db.prepare(`
    INSERT INTO sx_source_candidate
      (candidate_id, item_code, source_key, source_sku, title, image_url, pack_size, unit_label,
       price_paise, unit_price_paise, currency, url, captured_at_ist, batch_id, evidence_json,
       live_state, match_decision, is_pinned, updated_by_pin, updated_at_ist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
    ON CONFLICT(candidate_id) DO NOTHING
  `).bind(
    candidateId,
    itemCode,
    source,
    String(candidate.source_sku || ''),
    title,
    String(candidate.image_url || candidate.image || ''),
    String(candidate.pack_size || candidate.pack || ''),
    String(candidate.unit_label || candidate.unit || ''),
    nullableInt(candidate.price_paise),
    nullableInt(candidate.unit_price_paise ?? candidate.price_paise),
    String(candidate.currency || 'INR'),
    String(candidate.url || profile?.base_url || ''),
    capturedAt,
    String(candidate.batch_id || ''),
    safeJson(candidate.evidence || {}),
    liveState,
    actor.pin,
    nowIST(),
  ).run();
}

async function sourceProfile(db, body, actor) {
  const source = canonicalSource(body.source_key);
  if (!source) return { ok: false, error: 'source_key_required' };
  const label = String(body.label || source).trim();
  const kind = String(body.source_kind || 'OTHER').trim().toUpperCase();
  if (!['B2B', 'QUICK_COMMERCE', 'MARKETPLACE', 'LOCAL_VENDOR', 'OTHER'].includes(kind)) return { ok: false, error: 'invalid_source_kind' };
  await db.prepare(`
    INSERT INTO sx_source_profile
      (source_key, label, source_kind, base_url, priority_rank, liveness_threshold_hours,
       discovery_enabled, refresh_enabled, capture_host, auth_mode, config_json, notes, updated_by_pin, updated_at_ist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      label = excluded.label,
      source_kind = excluded.source_kind,
      base_url = excluded.base_url,
      priority_rank = excluded.priority_rank,
      liveness_threshold_hours = excluded.liveness_threshold_hours,
      discovery_enabled = excluded.discovery_enabled,
      refresh_enabled = excluded.refresh_enabled,
      capture_host = excluded.capture_host,
      auth_mode = excluded.auth_mode,
      config_json = excluded.config_json,
      notes = excluded.notes,
      updated_by_pin = excluded.updated_by_pin,
      updated_at_ist = excluded.updated_at_ist
  `).bind(
    source,
    label,
    kind,
    String(body.base_url || ''),
    clampInt(body.priority_rank, 100, 1, 999),
    clampInt(body.liveness_threshold_hours, 24, 1, 168),
    body.discovery_enabled === false ? 0 : 1,
    body.refresh_enabled === false ? 0 : 1,
    String(body.capture_host || 'RTX'),
    String(body.auth_mode || 'logged_in_browser'),
    safeJson(body.config || body.config_json || {}),
    String(body.notes || ''),
    actor.pin,
    nowIST(),
  ).run();
  return { ok: true, source_key: source };
}

async function searchPhrase(db, body, actor) {
  const itemCode = String(body.item_code || '').trim();
  const source = canonicalSource(body.source_key);
  const phrase = String(body.phrase || '').trim();
  if (!itemCode || !source || !phrase) return { ok: false, error: 'item_code_source_key_phrase_required' };
  await db.prepare(`
    INSERT INTO sx_source_search_phrase
      (item_code, source_key, phrase, priority_rank, active, evidence_json, updated_by_pin, updated_at_ist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_code, source_key, phrase) DO UPDATE SET
      priority_rank = excluded.priority_rank,
      active = excluded.active,
      evidence_json = excluded.evidence_json,
      updated_by_pin = excluded.updated_by_pin,
      updated_at_ist = excluded.updated_at_ist
  `).bind(
    itemCode,
    source,
    phrase,
    clampInt(body.priority_rank, 100, 1, 999),
    body.active === false ? 0 : 1,
    safeJson(body.evidence || {}),
    actor.pin,
    nowIST(),
  ).run();
  return { ok: true, item_code: itemCode, source_key: source, phrase };
}

async function refreshJob(db, body, actor) {
  const jobKind = String(body.job_kind || body.kind || '').trim().toUpperCase();
  if (!['WEEKLY_DISCOVERY', 'DAILY_PINNED_REFRESH', 'FALLBACK_SEARCH'].includes(jobKind)) return { ok: false, error: 'invalid_job_kind' };
  const jobId = body.job_id || `SXJ-${compactStamp()}-${stableHash(JSON.stringify(body)).slice(0, 8)}`;
  await db.prepare(`
    INSERT INTO sx_refresh_job
      (job_id, job_kind, item_code, source_key, candidate_id, status, scheduled_for_ist,
       evidence_json, created_by_pin, created_at_ist, updated_at_ist)
    VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)
  `).bind(
    jobId,
    jobKind,
    String(body.item_code || ''),
    canonicalSource(body.source_key || '') || '',
    String(body.candidate_id || ''),
    String(body.scheduled_for_ist || nowIST()),
    safeJson(body.evidence || {}),
    actor.pin,
    nowIST(),
    nowIST(),
  ).run();
  return { ok: true, job_id: jobId, job_kind: jobKind };
}

async function ingestCandidates(db, body, actor) {
  const source = canonicalSource(body.source_key);
  const batchKind = String(body.batch_kind || 'DISCOVERY').trim().toUpperCase();
  if (!source) return { ok: false, error: 'source_key_required' };
  if (!['DISCOVERY', 'DAILY_PINNED_REFRESH', 'FALLBACK_SEARCH'].includes(batchKind)) return { ok: false, error: 'invalid_batch_kind' };

  const profiles = await sourceProfiles(db);
  const profileByKey = new Map(profiles.map((p) => [p.source_key, p]));
  const profile = profileByKey.get(source) || { liveness_threshold_hours: 24 };
  const items = Array.isArray(body.items) ? body.items : [];
  const batchId = String(body.batch_id || `PSR-${compactStamp()}-${source}-${stableHash(JSON.stringify(body).slice(0, 2000)).slice(0, 8)}`);
  const startedAt = String(body.started_at_ist || nowIST());
  let candidateCount = 0;
  let okCount = 0;
  let staleCount = 0;
  let errorCount = 0;

  await db.prepare(`
    INSERT INTO sx_price_batch
      (id, batch_date, batch_kind, scope, status, material_count, source_key, host_key,
       portal_results_json, triggered_by_pin, started_at_ist, evidence_json, notes)
    VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'RUNNING',
      material_count = excluded.material_count,
      source_key = excluded.source_key,
      host_key = excluded.host_key,
      portal_results_json = excluded.portal_results_json,
      evidence_json = excluded.evidence_json,
      notes = excluded.notes
  `).bind(
    batchId,
    ymdIST(startedAt),
    batchKind,
    String(body.scope || 'sauda-price-scout'),
    items.length,
    source,
    String(body.host_key || actor.name || 'RTX'),
    safeJson(body.portal_results || {}),
    actor.pin,
    startedAt,
    safeJson(body.evidence || {}),
    String(body.notes || ''),
  ).run();

  for (const item of items) {
    const itemCode = String(item.item_code || '').trim();
    if (!itemCode) {
      errorCount += 1;
      continue;
    }
    const candidates = Array.isArray(item.candidates) ? item.candidates : [];
    for (const candidate of candidates) {
      const title = String(candidate.title || candidate.name || '').trim();
      if (!title) {
        errorCount += 1;
        continue;
      }
      const capturedAt = String(candidate.captured_at_ist || candidate.captured_at || nowIST());
      const liveState = candidate.live_state ? String(candidate.live_state).toUpperCase() : computeLiveState(capturedAt, profile.liveness_threshold_hours);
      const candidateId = String(candidate.candidate_id || `SC-${source}-${itemCode}-${stableHash(`${candidate.source_sku || ''}|${candidate.url || ''}|${title}`)}`);
      const pricePaise = nullableInt(candidate.price_paise);
      const unitPricePaise = nullableInt(candidate.unit_price_paise ?? candidate.price_paise);
      await db.prepare(`
        INSERT INTO sx_source_candidate
          (candidate_id, item_code, source_key, source_sku, title, image_url, pack_size, unit_label,
           price_paise, unit_price_paise, currency, url, captured_at_ist, batch_id, evidence_json,
           live_state, match_decision, is_pinned, updated_by_pin, updated_at_ist)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          title = excluded.title,
          image_url = excluded.image_url,
          pack_size = excluded.pack_size,
          unit_label = excluded.unit_label,
          price_paise = excluded.price_paise,
          unit_price_paise = excluded.unit_price_paise,
          currency = excluded.currency,
          url = excluded.url,
          captured_at_ist = excluded.captured_at_ist,
          batch_id = excluded.batch_id,
          evidence_json = excluded.evidence_json,
          live_state = excluded.live_state,
          updated_by_pin = excluded.updated_by_pin,
          updated_at_ist = excluded.updated_at_ist
      `).bind(
        candidateId,
        itemCode,
        source,
        String(candidate.source_sku || ''),
        title,
        String(candidate.image_url || candidate.image || ''),
        String(candidate.pack_size || candidate.pack || ''),
        String(candidate.unit_label || candidate.unit || ''),
        pricePaise,
        unitPricePaise,
        String(candidate.currency || 'INR'),
        String(candidate.url || ''),
        capturedAt,
        batchId,
        safeJson(candidate.evidence || candidate.raw || {}),
        ['LIVE', 'STALE', 'DEAD'].includes(liveState) ? liveState : 'STALE',
        actor.pin,
        nowIST(),
      ).run();

      candidateCount += 1;
      if (liveState === 'LIVE') okCount += 1;
      else staleCount += 1;

      if (batchKind === 'DAILY_PINNED_REFRESH' || body.write_snapshots === true) {
        await writeSnapshot(db, {
          item_code: itemCode,
          source_key: source,
          candidate_id: candidateId,
          title,
          url: String(candidate.url || ''),
          pack_size: String(candidate.pack_size || candidate.pack || ''),
          unit_label: String(candidate.unit_label || candidate.unit || ''),
          price_paise: pricePaise,
          unit_price_paise: unitPricePaise,
          stock_status: String(candidate.stock_status || (liveState === 'LIVE' ? 'AVAILABLE' : 'UNAVAILABLE')),
          image_url: String(candidate.image_url || candidate.image || ''),
          batch_id: batchId,
          captured_at_ist: capturedAt,
          evidence_json: safeJson(candidate.evidence || candidate.raw || {}),
          live_state: ['LIVE', 'STALE', 'DEAD'].includes(liveState) ? liveState : 'STALE',
        });
      }
    }
  }

  const status = errorCount ? (okCount ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
  await db.prepare(`
    UPDATE sx_price_batch
       SET status = ?, candidate_count = ?, ok_count = ?, stale_count = ?, error_count = ?,
           completed_at_ist = ?
     WHERE id = ?
  `).bind(status, candidateCount, okCount, staleCount, errorCount, nowIST(), batchId).run();

  return { ok: true, batch_id: batchId, status, candidate_count: candidateCount, ok_count: okCount, stale_count: staleCount, error_count: errorCount };
}

async function writeSnapshot(db, c) {
  await db.prepare(`
    INSERT INTO sx_price_snapshot
      (snapshot_date, item_code, source_key, sku_title, sku_url, pack_size, price_paise,
       unit_price_paise, stock_status, image_url, raw_json, batch_id, captured_at_ist,
       source, candidate_id, evidence_json, live_state, match_decision, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sauda-price-scout', ?, ?, ?, 'PENDING', ?)
    ON CONFLICT(snapshot_date, item_code, source_key) DO UPDATE SET
      sku_title = excluded.sku_title,
      sku_url = excluded.sku_url,
      pack_size = excluded.pack_size,
      price_paise = excluded.price_paise,
      unit_price_paise = excluded.unit_price_paise,
      stock_status = excluded.stock_status,
      image_url = excluded.image_url,
      raw_json = excluded.raw_json,
      batch_id = excluded.batch_id,
      captured_at_ist = excluded.captured_at_ist,
      source = excluded.source,
      candidate_id = excluded.candidate_id,
      evidence_json = excluded.evidence_json,
      live_state = excluded.live_state,
      source_url = excluded.source_url
  `).bind(
    ymdIST(c.captured_at_ist),
    c.item_code,
    c.source_key,
    c.title,
    c.url,
    c.pack_size,
    c.price_paise,
    c.unit_price_paise,
    c.stock_status,
    c.image_url,
    c.evidence_json,
    c.batch_id,
    c.captured_at_ist,
    c.candidate_id,
    c.evidence_json,
    c.live_state,
    c.url,
  ).run();
}

async function audit(db) {
  const stats = await tableAudit(db);
  const profiles = await sourceProfiles(db);
  return { ok: true, generated_at_ist: nowIST(), tables: stats, profiles };
}

async function tableAudit(db) {
  const tableDefs = [
    ['sx_item', 'updated_at_ist'],
    ['sx_price_snapshot', 'captured_at_ist'],
    ['sx_price_batch', 'COALESCE(completed_at_ist, started_at_ist)'],
    ['sx_source_profile', 'updated_at_ist'],
    ['sx_source_candidate', 'captured_at_ist'],
    ['sx_item_source_map', 'updated_at_ist'],
    ['sx_source_search_phrase', 'updated_at_ist'],
    ['sx_refresh_job', 'updated_at_ist'],
    ['hyperpure_prices', 'scraped_at'],
    ['item_prices', 'scraped_at'],
    ['buy_lines', 'updated_at'],
    ['daily_price_snapshots', 'captured_at'],
    ['daily_price_snapshot_batches', 'COALESCE(completed_at, started_at)'],
  ];
  const out = [];
  for (const [table, latestExpr] of tableDefs) {
    const exists = await tableExists(db, table);
    if (!exists) {
      out.push({ table, exists: false, row_count: 0, latest: null });
      continue;
    }
    const row = await db.prepare(`SELECT COUNT(*) AS row_count, MAX(${latestExpr}) AS latest FROM ${table}`).first();
    out.push({ table, exists: true, row_count: asInt(row?.row_count), latest: row?.latest || null });
  }
  return out;
}

async function tableExists(db, table) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).bind(table).first();
  return Boolean(row);
}

function sourceHealth(candidates, profiles) {
  const bySource = groupBy(candidates, (c) => c.source_key);
  return profiles.map((p) => {
    const rows = bySource.get(p.source_key) || [];
    return {
      source_key: p.source_key,
      label: p.label,
      priority_rank: p.priority_rank,
      threshold_hours: p.liveness_threshold_hours,
      live: rows.filter((r) => r.live_state === 'LIVE').length,
      stale: rows.filter((r) => r.live_state === 'STALE').length,
      dead: rows.filter((r) => r.live_state === 'DEAD').length,
      last_captured_at: rows.map((r) => r.captured_at).filter(Boolean).sort().pop() || null,
    };
  });
}

function schemaProposal() {
  return {
    ok: true,
    feasibility_matrix: SOURCE_SEEDS,
    d1_tables: [
      'sx_source_profile',
      'sx_source_candidate',
      'sx_item_source_map',
      'sx_source_search_phrase',
      'sx_refresh_job',
      'sx_price_batch',
      'sx_price_snapshot',
      'sx_item.image_r2_key',
    ],
    endpoints: [
      'GET /api/sauda-price?action=dashboard',
      'GET /api/sauda-price?action=price-find&item_code=...',
      'GET /api/sauda-price?action=stale-scout',
      'GET /api/sauda-price?action=drift-alert',
      'POST /api/sauda-price?action=ingest-candidates',
      'POST /api/sauda-price?action=candidate-decision',
      'POST /api/sauda-price?action=source-profile',
      'POST /api/sauda-price?action=search-phrase',
      'POST /api/sauda-price?action=refresh-job',
    ],
    ux: [
      '20-30 MVP item queue from sx_item.mvp_rank/scout_active, with legacy buy_lines spend preview only when sx_item is empty.',
      'Canonical visual from sx_item.image_r2_key or image_url.',
      'Crown only pinned, mapped, LIVE candidates.',
      'Candidate cards require source, image, title, pack/unit, URL, captured_at, evidence, and LIVE/STALE/DEAD state.',
    ],
  };
}

function itemMatchKeys(items) {
  const map = new Map();
  for (const item of items) {
    for (const key of [item.item_code, item.label, slug(item.label)]) {
      const k = normKey(key);
      if (k && !map.has(k)) map.set(k, item);
    }
  }
  return map;
}

function dedupeCandidates(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.item_code}|${row.source_key}|${row.candidate_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function groupBy(rows, fn) {
  const map = new Map();
  for (const row of rows) {
    const key = fn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function canonicalSource(source) {
  const raw = String(source || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return SOURCE_ALIASES[key] || raw.toUpperCase().replace(/[\s-]+/g, '_');
}

function computeLiveState(capturedAt, thresholdHours = 24, stored = '') {
  if (stored === 'DEAD') return 'DEAD';
  const t = parseTime(capturedAt);
  if (!t) return 'STALE';
  const ageHours = (Date.now() - t.getTime()) / 36e5;
  return ageHours <= Number(thresholdHours || 24) ? 'LIVE' : 'STALE';
}

function parseTime(s) {
  if (!s) return null;
  const raw = String(s).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(' ', 'T') + '+05:30' : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().replace('Z', '+05:30');
}

function ymdIST(stamp = '') {
  const parsed = parseTime(stamp);
  const t = parsed ? parsed.getTime() : Date.now();
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function compactStamp() {
  return nowIST().replace(/[-:.TZ+]/g, '').slice(0, 14);
}

function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

function normKey(s) {
  return slug(s).replace(/_+/g, '_');
}

function stableHash(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function asInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

function nullableInt(n) {
  if (n === null || n === undefined || n === '') return null;
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : null;
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseJson(s, fallback) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(String(s || '')); } catch (_) { return fallback; }
}

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch (_) { return '{}'; }
}
