// /api/influencer-pipeline
//
// Autonomous cron handler for the May 2026 influencer system.
// Called by hn-influencer-pipeline-cron Worker (workers/influencer-pipeline-cron/) on schedule.
// All requests authenticated via X-Cron-Token header (env.CRON_TOKEN, shared with Worker).
//
// Cron actions (called by Worker):
//   cron-discover       — daily 4 AM IST: Apify hashtag rotation, push new handles to discovery_queue
//   cron-enrich-tick    — every 15 min: pull 8 from queue, enrich via Apify profile-scraper, ingest to bio-pulse
//   cron-score          — daily 5 AM IST: recompute scores + buckets (no-op for now since scoring is inline)
//   cron-outreach-wave  — daily 10 AM IST: pick 50 unique creators, AI-personalize, send (or queue if DRY_RUN)
//
// Read actions (no auth, dashboard-readable):
//   GET ?action=status   — last run per cron + counts + queue depth + today's outreach progress
//   GET ?action=runs     — recent pipeline_runs entries
//   GET ?action=config   — current pipeline_config values
//
// Owner write actions (DASHBOARD_KEY auth):
//   POST ?action=set-config       body={key, value}
//   POST ?action=trigger-now      body={cron_name}  — manual fire of any cron (for testing)

import { sendWaba, normalizePhone } from './_lib/comms-core.js';
import { TIER_MATRIX, tierOf, scoreRelevance, bucketOf } from './_lib/influencer-tier.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Cron-Token, X-Dashboard-Key',
};
const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s, headers: { 'Content-Type': 'application/json', ...CORS },
});

const APIFY_HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper';
const APIFY_PROFILE_ACTOR = 'apify~instagram-scraper';

const ownerKey = (env) => env.DASHBOARD_KEY || env.DASHBOARD_API_KEY || null;
const requireOwner = (env, request, body) => {
  const k = request.headers.get('X-Dashboard-Key') || new URL(request.url).searchParams.get('key') || (body && body.key);
  return k && k === ownerKey(env);
};
const requireCron = (env, request) => {
  // Accept either the global CRON_TOKEN (used by hr-cron Worker etc.) or
  // the modash-specific MODASH_CRON_TOKEN (used by hn-winpc poller). Either
  // grants /api/influencer-pipeline cron access. Owner key also passes.
  const tok = request.headers.get('X-Cron-Token');
  if (tok && env.CRON_TOKEN && tok === env.CRON_TOKEN) return true;
  if (tok && env.MODASH_CRON_TOKEN && tok === env.MODASH_CRON_TOKEN) return true;
  return requireOwner(env, request);
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (request.method === 'GET') {
      if (action === 'status')              return await getStatus(env);
      if (action === 'runs')                return await getRuns(env, url);
      if (action === 'config')              return await getConfig(env);
      if (action === 'queue')               return await getQueue(env, url);
      // Modash rotation
      if (action === 'modash-status')       return await modashStatus(env);
      if (action === 'modash-next-job')     return await modashNextJob(env, request);
    }

    if (request.method === 'POST') {
      const body = await safeJson(request);

      // Cron-triggered (Worker calls these with X-Cron-Token)
      if (action === 'cron-discover')        return await cronDiscover(env, body, request);
      if (action === 'cron-enrich-tick')     return await cronEnrichTick(env, body, request);
      if (action === 'cron-score')           return await cronScore(env, body, request);
      if (action === 'cron-outreach-wave')   return await cronOutreachWave(env, body, request);

      // Modash poller (X-Cron-Token auth, called by hn-winpc)
      if (action === 'modash-job-done')      return await modashJobDone(env, body, request);
      if (action === 'modash-cookies-expired') return await modashCookiesExpired(env, body, request);

      // Owner-triggered
      if (action === 'set-config')           return await setConfig(env, body, request);
      if (action === 'trigger-now')          return await triggerNow(env, body, request);
      if (action === 'modash-register-profile') return await modashRegisterProfile(env, body, request);
      if (action === 'modash-mark-active')   return await modashMarkActive(env, body, request);
      if (action === 'modash-enqueue-job')   return await modashEnqueueJob(env, body, request);
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack?.slice(0, 600) }, 500);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// READ — dashboard endpoints (public stats, no auth)
// ────────────────────────────────────────────────────────────────────────────

async function getStatus(env) {
  const lastRuns = await env.DB.prepare(`
    SELECT cron_name,
           MAX(started_at) as last_run_at,
           (SELECT status FROM influencer_pipeline_runs r2
              WHERE r2.cron_name = r1.cron_name ORDER BY started_at DESC LIMIT 1) as last_status,
           (SELECT count_out FROM influencer_pipeline_runs r2
              WHERE r2.cron_name = r1.cron_name ORDER BY started_at DESC LIMIT 1) as last_count
    FROM influencer_pipeline_runs r1
    GROUP BY cron_name
  `).all();

  const queueDepth = await env.DB.prepare(`
    SELECT enrich_status, COUNT(*) c FROM influencer_discovery_queue
    GROUP BY enrich_status
  `).all();

  const today = await env.DB.prepare(`
    SELECT channel, COUNT(*) c
    FROM influencer_outreach_log
    WHERE date(sent_at, 'localtime') = date('now', 'localtime')
      AND campaign = 'may_2026_v1'
    GROUP BY channel
  `).all();

  const todayUnique = await env.DB.prepare(`
    SELECT COUNT(DISTINCT creator_username) c
    FROM influencer_outreach_log
    WHERE date(sent_at, 'localtime') = date('now', 'localtime')
      AND campaign = 'may_2026_v1' AND status != 'queued'
  `).first();

  const config = await getConfigMap(env);
  const target = parseInt(config.outreach_daily_target || '50');
  const totalDb = await env.DB.prepare(`SELECT COUNT(*) c FROM influencer_bio_pulse WHERE status='ok'`).first();
  const totalQueue = await env.DB.prepare(`SELECT COUNT(*) c FROM influencer_discovery_queue WHERE enrich_status='pending'`).first();

  return json({
    success: true,
    mode: config.outreach_mode || 'dry_run',
    daily_target: target,
    today_progress: { unique: todayUnique.c, channels: today.results, target },
    queue_depth: queueDepth.results,
    last_runs: lastRuns.results,
    db_size: { ok_profiles: totalDb.c, queue_pending: totalQueue.c },
    config,
  });
}

async function getRuns(env, url) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const r = await env.DB.prepare(`
    SELECT * FROM influencer_pipeline_runs
    ORDER BY started_at DESC LIMIT ?
  `).bind(limit).all();
  return json({ success: true, runs: r.results });
}

async function getConfig(env) {
  return json({ success: true, config: await getConfigMap(env) });
}

async function getQueue(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const r = await env.DB.prepare(`
    SELECT * FROM influencer_discovery_queue
    WHERE enrich_status = ? ORDER BY discovered_at DESC LIMIT ?
  `).bind(status, limit).all();
  return json({ success: true, queue: r.results });
}

async function getConfigMap(env) {
  const r = await env.DB.prepare(`SELECT key, value FROM influencer_pipeline_config`).all();
  const map = {};
  for (const row of r.results) map[row.key] = row.value;
  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// WRITE — owner-gated config + manual trigger
// ────────────────────────────────────────────────────────────────────────────

async function setConfig(env, body, request) {
  if (!requireOwner(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.key || body.value == null) return json({ error: 'key + value required' }, 400);
  await env.DB.prepare(`
    INSERT INTO influencer_pipeline_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).bind(body.key, String(body.value)).run();
  return json({ success: true, key: body.key, value: body.value });
}

async function triggerNow(env, body, request) {
  if (!requireOwner(env, request, body)) return json({ error: 'unauthorized' }, 401);
  const cron = body.cron_name;
  if (cron === 'discover')       return await cronDiscover(env, body, request);
  if (cron === 'enrich-tick')    return await cronEnrichTick(env, body, request);
  if (cron === 'score')          return await cronScore(env, body, request);
  if (cron === 'outreach-wave')  return await cronOutreachWave(env, body, request);
  return json({ error: 'unknown cron_name (use: discover|enrich-tick|score|outreach-wave)' }, 400);
}

// ────────────────────────────────────────────────────────────────────────────
// CRON 1: DISCOVERY — multi-vector rotation
// ────────────────────────────────────────────────────────────────────────────
// Daily rotation across 4 Apify discovery vectors:
//   day mod 4 = 0: hashtag rotation        (current — 18 BLR food hashtags in slots)
//   day mod 4 = 1: geotag location scrape  (BLR food location pages)
//   day mod 4 = 2: tagged-user expansion   (top creators' collab network)
//   day mod 4 = 3: comment-author scrape   (engaged audience on viral BLR food posts)
// Modash branch (when modash_enabled=true) takes priority over all 4 Apify vectors.

async function cronDiscover(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);

  const config = await getConfigMap(env);
  if (config.discovery_enabled !== 'true') return json({ skipped: 'disabled' });

  // Modash takes priority when an active profile is below daily cap
  if (config.modash_enabled === 'true') {
    const dailyCap = parseInt(config.modash_searches_per_profile_per_day || '1');
    const activeProfile = await env.DB.prepare(`
      SELECT profile_num FROM modash_profiles
      WHERE status='active' AND searches_today < ? LIMIT 1
    `).bind(dailyCap).first();

    if (activeProfile) {
      const runId = await startRun(env, 'discovery');
      const filters = JSON.parse(config.modash_default_filters || '{}');
      const job = await env.DB.prepare(`
        INSERT INTO modash_jobs (job_type, search_filters_json, status)
        VALUES ('search', ?, 'pending')
      `).bind(JSON.stringify(filters)).run();
      return await finishRun(env, runId, 'ok', 0, 0, 0,
        `Modash job ${job.meta.last_row_id} queued (profile ${activeProfile.profile_num} available)`);
    }
  }

  // Pick today's vector — manual override via discovery_vector_today config (else date-based)
  const override = config.discovery_vector_today;
  const VECTORS = ['hashtag', 'geotag', 'tagged', 'comments'];
  let vector = override && VECTORS.includes(override) ? override : null;
  if (!vector) {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    vector = VECTORS[dayOfYear % VECTORS.length];
  }

  // Dispatch
  if (vector === 'hashtag')  return await runHashtagDiscovery(env, config);
  if (vector === 'geotag')   return await runGeotagDiscovery(env, config);
  if (vector === 'tagged')   return await runTaggedDiscovery(env, config);
  if (vector === 'comments') return await runCommentsDiscovery(env, config);
  return json({ error: 'unknown vector: ' + vector }, 400);
}

// Vector 1: hashtag rotation
async function runHashtagDiscovery(env, config) {
  const runId = await startRun(env, 'discovery_hashtag');
  try {
    const rotation = JSON.parse(config.hashtag_rotation || '[]');
    const idx = parseInt(config.hashtag_rotation_index || '0') % rotation.length;
    const hashtags = rotation[idx];
    if (!hashtags || hashtags.length === 0) return await finishRun(env, runId, 'skipped', 0, 0, 0, 'no hashtags');

    const apifyRun = await apifyTrigger(env, APIFY_HASHTAG_ACTOR, {
      hashtags, resultsLimit: 50, resultsType: 'posts',
    });
    const dataset = await apifyWaitAndRead(env, apifyRun.id, 600);

    const usernames = uniqueOwnerUsernames(dataset.items);
    const { added, skipped } = await ingestDiscovered(env, usernames, 'apify_hashtag', { hashtags, dataset_id: apifyRun.dataset_id });

    const nextIdx = (idx + 1) % rotation.length;
    await env.DB.prepare(`UPDATE influencer_pipeline_config SET value=?, updated_at=datetime('now') WHERE key='hashtag_rotation_index'`).bind(String(nextIdx)).run();

    return await finishRun(env, runId, 'ok', usernames.size, added, apifyRun.cost_usd,
      `hashtag slot ${idx}: ${hashtags.join(',')} → ${usernames.size} unique, ${added} new (${skipped} dup)`);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

// Vector 2: geotag location scrape
async function runGeotagDiscovery(env, config) {
  const runId = await startRun(env, 'discovery_geotag');
  try {
    const locations = JSON.parse(config.geotag_locations || '[]');
    if (!locations.length) return await finishRun(env, runId, 'skipped', 0, 0, 0, 'no locations seeded');

    const directUrls = locations.map(l => l.url);
    const postsPerLocation = parseInt(config.geotag_posts_per_location || '50');

    const apifyRun = await apifyTrigger(env, APIFY_PROFILE_ACTOR, {
      directUrls, resultsType: 'posts', resultsLimit: postsPerLocation,
    });
    const dataset = await apifyWaitAndRead(env, apifyRun.id, 600);

    const usernames = uniqueOwnerUsernames(dataset.items);
    const { added, skipped } = await ingestDiscovered(env, usernames, 'apify_geotag',
      { locations: locations.map(l => l.name), dataset_id: apifyRun.dataset_id });

    return await finishRun(env, runId, 'ok', usernames.size, added, apifyRun.cost_usd,
      `geotag ${locations.length} locations → ${usernames.size} unique, ${added} new (${skipped} dup)`);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

// Vector 3: tagged-user expansion (network of top creators)
async function runTaggedDiscovery(env, config) {
  const runId = await startRun(env, 'discovery_tagged');
  try {
    const seedCount = parseInt(config.tagged_seed_count || '20');
    const postsPerSeed = parseInt(config.tagged_posts_per_seed || '12');

    // Pick top BLR-food creators as seeds
    const seeds = await env.DB.prepare(`
      SELECT username FROM influencer_bio_pulse
      WHERE status='ok' AND is_private=0
        AND followers_count BETWEEN 5000 AND 200000
        AND (LOWER(IFNULL(biography,'') || ' ' || IFNULL(full_name,'')) LIKE '%bangalore%'
          OR LOWER(IFNULL(biography,'') || ' ' || IFNULL(full_name,'')) LIKE '%bengaluru%'
          OR LOWER(IFNULL(biography,'') || ' ' || IFNULL(full_name,'')) LIKE '%blr%')
        AND (LOWER(IFNULL(biography,'')) LIKE '%food%' OR LOWER(IFNULL(biography,'')) LIKE '%foodie%'
          OR LOWER(IFNULL(biography,'')) LIKE '%biryani%' OR LOWER(IFNULL(biography,'')) LIKE '%cafe%'
          OR LOWER(IFNULL(biography,'')) LIKE '%restaurant%')
      ORDER BY contact_channels DESC, followers_count DESC
      LIMIT ?
    `).bind(seedCount).all();

    if (seeds.results.length === 0) return await finishRun(env, runId, 'skipped', 0, 0, 0, 'no seeds');

    const directUrls = seeds.results.map(s => `https://www.instagram.com/${s.username}/`);
    const apifyRun = await apifyTrigger(env, APIFY_PROFILE_ACTOR, {
      directUrls, resultsType: 'posts', resultsLimit: postsPerSeed, addParentData: false,
    });
    const dataset = await apifyWaitAndRead(env, apifyRun.id, 600);

    // Extract taggedUsers from each post
    const tagged = new Set();
    for (const post of dataset.items) {
      const tags = post.taggedUsers || [];
      for (const t of tags) {
        const u = (typeof t === 'string' ? t : t?.username || '').toLowerCase().trim();
        if (u) tagged.add(u);
      }
    }

    const { added, skipped } = await ingestDiscovered(env, tagged, 'apify_tagged',
      { seed_count: seeds.results.length, dataset_id: apifyRun.dataset_id });

    return await finishRun(env, runId, 'ok', tagged.size, added, apifyRun.cost_usd,
      `tagged: ${seeds.results.length} seeds × ${postsPerSeed} posts → ${tagged.size} unique tagged, ${added} new (${skipped} dup)`);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

// Vector 4: comment-author scrape on viral BLR food posts
async function runCommentsDiscovery(env, config) {
  const runId = await startRun(env, 'discovery_comments');
  try {
    const postUrls = JSON.parse(config.comment_post_urls || '[]');
    if (!postUrls.length) return await finishRun(env, runId, 'skipped', 0, 0, 0, 'no post URLs seeded — owner adds via config');

    const authorsPerPost = parseInt(config.comment_authors_per_post || '300');
    const apifyRun = await apifyTrigger(env, 'apify~instagram-comment-scraper', {
      directUrls: postUrls, resultsLimit: authorsPerPost,
    });
    const dataset = await apifyWaitAndRead(env, apifyRun.id, 600);

    const authors = new Set();
    for (const c of dataset.items) {
      const u = (c.ownerUsername || c.username || '').toLowerCase().trim();
      if (u) authors.add(u);
    }

    const { added, skipped } = await ingestDiscovered(env, authors, 'apify_comments',
      { post_urls: postUrls, dataset_id: apifyRun.dataset_id });

    return await finishRun(env, runId, 'ok', authors.size, added, apifyRun.cost_usd,
      `comments: ${postUrls.length} posts → ${authors.size} unique authors, ${added} new (${skipped} dup)`);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

// Shared helpers
function uniqueOwnerUsernames(items) {
  const set = new Set();
  for (const it of items) {
    const u = (it.ownerUsername || it.username || '').toLowerCase().trim();
    if (u) set.add(u);
  }
  return set;
}

async function ingestDiscovered(env, usernames, vector, sourceMeta) {
  let added = 0, skipped = 0;
  for (const u of usernames) {
    // Always record the discovery vector (even for known creators — for multi-vector bonus)
    try {
      await env.DB.prepare(`
        INSERT INTO influencer_discovery_vectors (username, vector, source_meta) VALUES (?, ?, ?)
      `).bind(u, vector, JSON.stringify(sourceMeta)).run();
    } catch { /* unique conflict — already discovered via this vector */ }

    const inDb = await env.DB.prepare(`SELECT 1 FROM influencer_bio_pulse WHERE username=?`).bind(u).first();
    if (inDb) { skipped++; continue; }
    try {
      await env.DB.prepare(`
        INSERT INTO influencer_discovery_queue (username, source, source_meta) VALUES (?, ?, ?)
      `).bind(u, vector, JSON.stringify(sourceMeta)).run();
      added++;
    } catch { /* already queued */ }
  }
  return { added, skipped };
}

// ────────────────────────────────────────────────────────────────────────────
// CRON 2: ENRICHMENT TICKER — pull 8 from queue, Apify profile-scraper, ingest
// ────────────────────────────────────────────────────────────────────────────

async function cronEnrichTick(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);

  const config = await getConfigMap(env);
  if (config.enrichment_enabled !== 'true') return json({ skipped: 'disabled' });

  const runId = await startRun(env, 'enrichment');
  try {
    const batchSize = 8;
    const batch = await env.DB.prepare(`
      SELECT id, username FROM influencer_discovery_queue
      WHERE enrich_status = 'pending' ORDER BY discovered_at LIMIT ?
    `).bind(batchSize).all();

    if (batch.results.length === 0) {
      return await finishRun(env, runId, 'skipped', 0, 0, 0, 'queue empty');
    }

    // Mark in-flight
    const ids = batch.results.map(r => r.id);
    for (const id of ids) {
      await env.DB.prepare(`
        UPDATE influencer_discovery_queue SET enrich_status='enriching', enrich_attempts=enrich_attempts+1 WHERE id=?
      `).bind(id).run();
    }

    const usernames = batch.results.map(r => r.username);
    const directUrls = usernames.map(u => `https://www.instagram.com/${u}/`);

    // resultsType:'details' returns the profile + recent posts. We use the posts
    // to compute ER + last_post_at + topic_density per creator.
    const apifyRun = await apifyTrigger(env, APIFY_PROFILE_ACTOR, {
      directUrls, resultsType: 'details', resultsLimit: 12, addParentData: false,
    });
    const dataset = await apifyWaitAndRead(env, apifyRun.id, 300);

    // Group items by username — one profile + N posts per username
    const byUser = new Map();
    for (const it of dataset.items) {
      const u = (it.username || it.ownerUsername || '').toLowerCase();
      if (!u) continue;
      if (!byUser.has(u)) byUser.set(u, { profile: null, posts: [] });
      const slot = byUser.get(u);
      // Profile items have followersCount; post items have likesCount + caption
      if (it.followersCount != null) slot.profile = it;
      else if (it.likesCount != null || it.caption != null) slot.posts.push(it);
    }

    // Ingest each result into influencer_bio_pulse + flip queue row to 'enriched'
    let okCount = 0, errCount = 0;

    for (const row of batch.results) {
      const slot = byUser.get(row.username);
      const item = slot?.profile;
      const posts = slot?.posts || [];
      if (!item || item.followersCount == null) {
        await env.DB.prepare(`
          UPDATE influencer_discovery_queue SET enrich_status='failed', enriched_at=datetime('now'),
                                                enrich_error=? WHERE id=?
        `).bind(item ? 'no_follower_data' : 'not_in_apify_response', row.id).run();
        errCount++;
        continue;
      }
      try {
        // Compute ER + last_post_at + topic_density from posts
        const metrics = computePostMetrics(posts, item.followersCount);
        await ingestApifyProfile(env, item, metrics);
        await env.DB.prepare(`
          UPDATE influencer_discovery_queue SET enrich_status='enriched', enriched_at=datetime('now') WHERE id=?
        `).bind(row.id).run();
        okCount++;
      } catch (e) {
        await env.DB.prepare(`
          UPDATE influencer_discovery_queue SET enrich_status='failed', enriched_at=datetime('now'),
                                                enrich_error=? WHERE id=?
        `).bind(e.message, row.id).run();
        errCount++;
      }
    }

    return await finishRun(env, runId, 'ok', batch.results.length, okCount, apifyRun.cost_usd,
      `${okCount} enriched, ${errCount} failed`);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CRON 3: SCORE + BUCKET RECOMPUTE
// ────────────────────────────────────────────────────────────────────────────
// Currently scoring is INLINE in /api/influencer-outreach (computed at query time).
// This cron is a no-op placeholder for now — kept so the cron schedule is symmetric
// and future score-caching work fits in. If we ever materialise scores, this is where.

async function cronScore(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);
  const runId = await startRun(env, 'scoring');
  return await finishRun(env, runId, 'ok', 0, 0, 0, 'inline scoring (no-op)');
}

// ────────────────────────────────────────────────────────────────────────────
// CRON 4: DAILY OUTREACH WAVE — pick 50 unique, AI-personalize, send
// ────────────────────────────────────────────────────────────────────────────

async function cronOutreachWave(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);

  const config = await getConfigMap(env);
  if (config.outreach_enabled !== 'true') return json({ skipped: 'disabled' });

  const runId = await startRun(env, 'outreach_wave');
  try {
    const isLive = config.outreach_mode === 'live';
    const heroN     = parseInt(config.hero_per_day || '5');
    const priorityN = parseInt(config.priority_per_day || '15');
    const standardN = parseInt(config.standard_per_day || '30');

    // Pick uncontacted creators by bucket
    const candidates = await pickWaveCandidates(env);
    const byBucket = { HERO: [], PRIORITY: [], STANDARD: [] };
    for (const c of candidates) {
      if (byBucket[c.bucket] && byBucket[c.bucket].length < (
        c.bucket === 'HERO' ? heroN : c.bucket === 'PRIORITY' ? priorityN : standardN
      )) {
        byBucket[c.bucket].push(c);
      }
    }

    const wave = [...byBucket.HERO, ...byBucket.PRIORITY, ...byBucket.STANDARD];
    if (wave.length === 0) {
      return await finishRun(env, runId, 'skipped', 0, 0, 0, 'no eligible uncontacted creators');
    }

    let queued = 0, sent = 0, errors = 0, aiCost = 0;

    for (const c of wave) {
      const tier = TIER_MATRIX[c.tier];
      const niche = pickNiche(c);
      const firstName = pickFirstName(c);

      // Channels per bucket
      const channels = (
        c.bucket === 'HERO'     ? ['email','waba','ig_dm'] :
        c.bucket === 'PRIORITY' ? ['email','waba'] :
        ['best']                                 // STANDARD: best available channel
      );

      const token = await ensureBookingShell(env, c, tier);

      // AI personalize (if enabled)
      let aiOpener = null;
      if (config.ai_personalization === 'true' && env.ANTHROPIC_API_KEY) {
        try {
          const r = await aiPersonalize(env, c, niche, tier);
          aiOpener = r.opener;
          aiCost += r.cost_usd;
        } catch (_) { /* fall back to template */ }
      }

      for (const ch of channels) {
        const finalCh = ch === 'best'
          ? (c.has_email ? 'email' : c.has_phone ? 'waba' : 'ig_dm')
          : ch;

        const payload = buildMessage(c, firstName, niche, tier, token, finalCh, aiOpener);
        if (!payload) { errors++; continue; }

        if (isLive) {
          const r = await actuallySend(env, c, finalCh, payload);
          if (r.ok) { sent++; } else { errors++; }
        } else {
          // DRY_RUN: just queue
          await logQueued(env, c, finalCh, payload, token, tier, niche);
          queued++;
        }
      }
    }

    const note = `${wave.length} unique creators · ${sent} sent · ${queued} queued · ${errors} errors · mode=${config.outreach_mode}`;
    return await finishRun(env, runId, 'ok', wave.length, sent + queued, aiCost, note);
  } catch (e) {
    return await finishRun(env, runId, 'error', 0, 0, 0, null, e.message);
  }
}

async function pickWaveCandidates(env) {
  // BLR + 5K-100K + has_any_contact (gives us email/waba reach) OR has_phone OR ig_dm fallback
  // Skip already-contacted on every channel for this campaign.
  const r = await env.DB.prepare(`
    SELECT p.*
    FROM influencer_bio_pulse p
    LEFT JOIN influencer_outreach_log o
      ON o.creator_username = p.username AND o.campaign='may_2026_v1' AND o.status != 'queued'
    WHERE p.status='ok' AND p.is_private=0
      AND p.followers_count BETWEEN 5000 AND 100000
      AND o.id IS NULL
      AND (LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bangalore%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%blr%'
        OR LOWER(IFNULL(p.biography,'') || ' ' || IFNULL(p.full_name,'')) LIKE '%bengaluru%')
    LIMIT 200
  `).all();

  return r.results.map(c => {
    const { score } = scoreRelevance(c);
    return { ...c, relevance_score: score, bucket: bucketOf(score), tier: tierOf(c.followers_count) };
  }).sort((a, b) => {
    const r = { HERO: 0, PRIORITY: 1, STANDARD: 2, SKIP: 3 };
    return (r[a.bucket] - r[b.bucket]) || (b.relevance_score - a.relevance_score);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// AI PERSONALIZATION — Claude Haiku
// ────────────────────────────────────────────────────────────────────────────

async function aiPersonalize(env, creator, niche, tier) {
  const prompt = `You are writing a one-line opener for a cold outreach message from Hamza Express, Bangalore's 1918 Dakhni biryani family restaurant, to an Instagram food creator. The opener must reference something specific from their bio — their niche, location, or a unique angle — and feel personal, not templated.

Creator handle: @${creator.username}
Full name: ${creator.full_name || ''}
Followers: ${creator.followers_count}
Bio: """${(creator.biography || '').slice(0, 500)}"""
Detected niche: ${niche}

Return ONLY the opener line (≤25 words). No greeting, no signoff, no quotes, no "Hi X". Just the body opener that follows "Hi Sara, ".

Examples of good openers:
- "Saw your reel on Mosque Road kababs last month — exactly the kind of food storytelling we admire."
- "Your Awadhi recipes hit me — we're doing Dakhni heritage-style at Hamza, similar lineage."
- "BLR foodie of the truest kind — your Frazer Town picks are spot-on."

Now write one for this creator.`;

  const t0 = Date.now();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error('ai_failed_' + resp.status);
  const j = await resp.json();
  const opener = j.content?.[0]?.text?.trim().replace(/^["']|["']$/g, '');
  // Haiku 4.5 pricing approx: $0.001 input + $0.005 output per 1K tokens. Tiny per call.
  const cost = ((j.usage?.input_tokens || 0) * 0.001 + (j.usage?.output_tokens || 0) * 0.005) / 1000;
  return { opener, cost_usd: cost, latency_ms: Date.now() - t0 };
}

// ────────────────────────────────────────────────────────────────────────────
// MESSAGE BUILDERS
// ────────────────────────────────────────────────────────────────────────────

function buildMessage(c, firstName, niche, tier, token, channel, aiOpener) {
  if (channel === 'email') {
    if (!c.has_email) return null;
    const recipient = pickRecipientEmails(c)[0];
    if (!recipient) return null;
    return {
      channel: 'email', recipient,
      subject: 'Barter collab — 1918 Hamza Express, Shivajinagar',
      body: renderEmailBody(firstName, niche, tier, token, aiOpener),
    };
  }
  if (channel === 'waba') {
    if (!c.has_phone) return null;
    const phones = pickRecipientPhones(c);
    if (!phones.length) return null;
    return {
      channel: 'waba', recipient: phones[0],
      template: 'he_influencer_barter_v1',
      vars: [firstName, niche, String(tier.covers), token],
    };
  }
  if (channel === 'ig_dm') {
    return {
      channel: 'ig_dm', recipient: '@' + c.username,
      message: renderIgDm(firstName, niche, tier, token, aiOpener),
    };
  }
  return null;
}

async function actuallySend(env, c, channel, payload) {
  if (channel === 'email') {
    // Worker can't open SMTP; fire to a sender-relay. For now, queue and let the local sender pick it up.
    // The local sender script (scripts/influencer_email_sender.py) uses /api/influencer-outreach?action=create-batch
    // which already pulls 'queued' status rows. So we just write a queued row here too — local sender runs every N min.
    await logQueued(env, c, channel, payload, payload.token || null, null, payload.niche_tag);
    return { ok: true, queued: true };
  }
  if (channel === 'waba') {
    const r = await sendWaba(env, {
      brand: 'he', phone: payload.recipient, template: payload.template, vars: payload.vars,
      buttons: [{ sub_type: 'url', index: 0, url_token: payload.vars[3] }],
    });
    await logSendResult(env, c, channel, payload, r);
    return { ok: r.ok };
  }
  if (channel === 'ig_dm') {
    // Cannot auto-send. Queue for owner.
    await logQueued(env, c, channel, payload, payload.token || null, null, null);
    return { ok: true, queued: true };
  }
  return { ok: false, error: 'unknown_channel' };
}

async function logQueued(env, c, channel, payload, token, tier, niche) {
  await env.DB.prepare(`
    INSERT INTO influencer_outreach_log (
      creator_username, channel, to_address, subject, message_text, outreach_token,
      sent_by, status, template_used, tier_assigned, cover_offer, niche_tag, campaign, actor
    ) VALUES (?, ?, ?, ?, ?, ?, 'cron_pipeline', 'queued', ?, ?, ?, ?, 'may_2026_v1', 'pipeline_dryrun')
  `).bind(
    c.username, channel, payload.recipient || null, payload.subject || null,
    payload.body || payload.message || JSON.stringify(payload),
    token || null,
    payload.template || (channel === 'email' ? 'cold_email_v1' : channel === 'ig_dm' ? 'ig_dm_v1' : null),
    c.tier, c.tier_meta?.covers || null, niche || null
  ).run();
}

async function logSendResult(env, c, channel, payload, sendResult) {
  await env.DB.prepare(`
    INSERT INTO influencer_outreach_log (
      creator_username, channel, to_address, message_text, outreach_token,
      sent_by, status, template_used, provider, provider_msg_id,
      tier_assigned, cover_offer, campaign, actor
    ) VALUES (?, ?, ?, ?, ?, 'cron_pipeline', ?, ?, 'meta-cloud-api', ?, ?, ?, 'may_2026_v1', 'cron_pipeline')
  `).bind(
    c.username, channel, payload.recipient,
    payload.body || payload.message || JSON.stringify(payload.vars || []),
    payload.vars?.[3] || null,
    sendResult.ok ? 'sent' : 'failed',
    payload.template || null,
    sendResult.provider_msg_id || null,
    c.tier, c.tier_meta?.covers || null
  ).run();
}

// ────────────────────────────────────────────────────────────────────────────
// MODASH ROTATION — multi-account browser-session-based discovery
// ────────────────────────────────────────────────────────────────────────────
// Architecture:
//   Owner pre-logs each Modash trial account on hn-winpc Chrome (one isolated
//   user-data-dir per account). Cookies persist for ~30d. The hn-winpc poller
//   pulls jobs from this API, runs the search via headless Chromium against
//   the right profile, POSTs results back. No passwords ever stored or seen.

async function modashStatus(env) {
  const profiles = await env.DB.prepare(`
    SELECT * FROM modash_profiles ORDER BY profile_num
  `).all();
  const jobsToday = await env.DB.prepare(`
    SELECT status, COUNT(*) c FROM modash_jobs
    WHERE date(created_at, 'localtime') = date('now', 'localtime')
    GROUP BY status
  `).all();
  const recentJobs = await env.DB.prepare(`
    SELECT id, status, profile_num, result_count, result_summary,
           created_at, completed_at, error_msg
    FROM modash_jobs ORDER BY created_at DESC LIMIT 20
  `).all();
  const config = await getConfigMap(env);
  return json({
    success: true,
    enabled: config.modash_enabled === 'true',
    profiles: profiles.results,
    profile_counts: {
      total: profiles.results.length,
      active: profiles.results.filter(p => p.status === 'active').length,
      pending: profiles.results.filter(p => p.status === 'pending_setup').length,
      depleted: profiles.results.filter(p => p.status === 'depleted').length,
      broken: profiles.results.filter(p => p.status === 'broken').length,
    },
    jobs_today: jobsToday.results,
    recent_jobs: recentJobs.results,
  });
}

async function modashRegisterProfile(env, body, request) {
  if (!requireOwner(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.profile_num) return json({ error: 'profile_num required' }, 400);
  await env.DB.prepare(`
    INSERT INTO modash_profiles (profile_num, email, status)
    VALUES (?, ?, 'pending_setup')
    ON CONFLICT(profile_num) DO UPDATE SET email=excluded.email, status='pending_setup'
  `).bind(body.profile_num, body.email || null).run();
  return json({ success: true, profile_num: body.profile_num });
}

async function modashMarkActive(env, body, request) {
  if (!requireOwner(env, request, body)) return json({ error: 'unauthorized' }, 401);
  if (!body.profile_num) return json({ error: 'profile_num required' }, 400);
  await env.DB.prepare(`
    UPDATE modash_profiles SET status='active', cookies_setup_at=datetime('now'),
                                cookies_invalid_at=NULL
    WHERE profile_num = ?
  `).bind(body.profile_num).run();
  return json({ success: true });
}

async function modashEnqueueJob(env, body, request) {
  // Owner can manually enqueue a Modash search job. Also called from cronDiscover.
  if (!requireOwner(env, request, body) && !requireCron(env, request)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const config = await getConfigMap(env);
  const filters = body.filters || JSON.parse(config.modash_default_filters || '{}');
  const r = await env.DB.prepare(`
    INSERT INTO modash_jobs (job_type, search_filters_json, status)
    VALUES (?, ?, 'pending')
  `).bind(body.job_type || 'search', JSON.stringify(filters)).run();
  return json({ success: true, job_id: r.meta.last_row_id });
}

async function modashNextJob(env, request) {
  // Called by hn-winpc poller — needs CRON_TOKEN auth.
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);

  // Pick next pending job. Assign to least-recently-used active profile.
  const job = await env.DB.prepare(`
    SELECT * FROM modash_jobs WHERE status='pending' ORDER BY created_at LIMIT 1
  `).first();
  if (!job) return json({ no_jobs: true });

  const config = await getConfigMap(env);
  const dailyCap = parseInt(config.modash_searches_per_profile_per_day || '1');

  // Pick LRU active profile that hasn't hit daily cap
  const profile = await env.DB.prepare(`
    SELECT * FROM modash_profiles
    WHERE status='active' AND searches_today < ?
    ORDER BY COALESCE(last_used_at, '1970-01-01') ASC
    LIMIT 1
  `).bind(dailyCap).first();
  if (!profile) {
    // No profile available right now — leave job pending
    return json({ no_jobs: true, reason: 'no_active_profile_below_cap' });
  }

  // Assign + mark running
  await env.DB.prepare(`
    UPDATE modash_jobs SET status='running', profile_num=?, picked_at=datetime('now') WHERE id=?
  `).bind(profile.profile_num, job.id).run();
  await env.DB.prepare(`
    UPDATE modash_profiles
    SET searches_today = searches_today + 1,
        searches_lifetime = searches_lifetime + 1,
        last_used_at = datetime('now')
    WHERE profile_num=?
  `).bind(profile.profile_num).run();

  return json({
    job_id: job.id,
    job_type: job.job_type,
    profile_num: profile.profile_num,
    profile_email: profile.email,
    search_filters: JSON.parse(job.search_filters_json),
  });
}

async function modashJobDone(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!body.job_id) return json({ error: 'job_id required' }, 400);

  const results = body.results || [];
  const error = body.error || null;
  const status = error ? 'failed' : 'done';

  await env.DB.prepare(`
    UPDATE modash_jobs
    SET status=?, completed_at=datetime('now'), error_msg=?, result_count=?, result_summary=?
    WHERE id=?
  `).bind(status, error, results.length, body.summary || null, body.job_id).run();

  // Push each result into discovery_queue (dedup vs bio_pulse + queue)
  let added = 0, skippedExisting = 0;
  for (const r of results) {
    const u = (r.username || '').toLowerCase().trim();
    if (!u) continue;
    const inDb = await env.DB.prepare(`SELECT 1 FROM influencer_bio_pulse WHERE username=?`).bind(u).first();
    if (inDb) { skippedExisting++; continue; }
    try {
      await env.DB.prepare(`
        INSERT INTO influencer_discovery_queue (username, source, source_meta)
        VALUES (?, 'modash', ?)
      `).bind(u, JSON.stringify({
        job_id: body.job_id,
        followers: r.followers || null,
        engagement_rate: r.engagement_rate || null,
        full_name: r.full_name || null,
      })).run();
      added++;
    } catch (e) { /* unique conflict — already queued */ }
  }

  return json({
    success: true,
    job_id: body.job_id,
    status,
    pushed_to_queue: added,
    skipped_existing: skippedExisting,
  });
}

async function modashCookiesExpired(env, body, request) {
  if (!requireCron(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!body.profile_num) return json({ error: 'profile_num required' }, 400);
  await env.DB.prepare(`
    UPDATE modash_profiles SET status='broken', cookies_invalid_at=datetime('now'),
                                notes=COALESCE(notes,'') || ' [cookies expired ' || datetime('now') || ']'
    WHERE profile_num=?
  `).bind(body.profile_num).run();
  return json({ success: true, action: 'profile_marked_broken' });
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

async function startRun(env, name) {
  const r = await env.DB.prepare(`
    INSERT INTO influencer_pipeline_runs (cron_name, status) VALUES (?, 'running')
  `).bind(name).run();
  return r.meta.last_row_id;
}

async function finishRun(env, runId, status, countIn, countOut, costUsd, notes, errorMsg) {
  await env.DB.prepare(`
    UPDATE influencer_pipeline_runs
    SET completed_at = datetime('now'), status=?, count_in=?, count_out=?, cost_usd=?, notes=?, error_msg=?
    WHERE id=?
  `).bind(status, countIn || 0, countOut || 0, costUsd || 0, notes || null, errorMsg || null, runId).run();
  return json({ run_id: runId, status, count_in: countIn, count_out: countOut, notes, error: errorMsg });
}

async function apifyTrigger(env, actor, input) {
  const headers = { 'Authorization': 'Bearer ' + env.APIFY_TOKEN, 'Content-Type': 'application/json' };
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/runs`, {
    method: 'POST', headers, body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error('apify_trigger_failed_' + r.status);
  const j = await r.json();
  return { id: j.data.id, dataset_id: j.data.defaultDatasetId, cost_usd: 0 };
}

async function apifyWaitAndRead(env, runId, maxSecs = 300) {
  const headers = { 'Authorization': 'Bearer ' + env.APIFY_TOKEN };
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxSecs) {
    await new Promise(r => setTimeout(r, 8000));
    const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    if (!sr.ok) continue;
    const sj = await sr.json();
    const s = sj.data.status;
    if (['SUCCEEDED','FAILED','ABORTED','TIMED_OUT'].includes(s)) {
      const cost = sj.data.usageTotalUsd || 0;
      const datasetId = sj.data.defaultDatasetId;
      const dr = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=1000`, { headers });
      const items = dr.ok ? await dr.json() : [];
      return { items, status: s, cost_usd: cost };
    }
  }
  throw new Error('apify_timeout');
}

async function ingestApifyProfile(env, it, metrics = {}) {
  const u = (it.username || '').toLowerCase().trim();
  if (!u) throw new Error('no_username');
  const bio = it.biography || '';
  const bioLinks = it.bioLinks || [];
  const bizEmail = it.businessEmail || it.publicEmail || null;
  const bizPhone = it.businessPhoneNumber || it.publicPhoneNumber || null;

  const { emails, phones, whatsapp } = extractContacts(bio, bioLinks, bizEmail, bizPhone);
  const hasEmail = emails.length > 0 ? 1 : 0;
  const hasPhone = phones.length > 0 ? 1 : 0;
  const hasWa = whatsapp.length > 0 ? 1 : 0;

  await env.DB.prepare(`
    INSERT INTO influencer_bio_pulse (
      username, full_name, biography, external_url, bio_links_json, category_name,
      is_business_account, is_professional_account, is_verified, is_private,
      followers_count, following_count, media_count, profile_pic_url,
      business_email, business_phone_number,
      has_email_button, has_call_button, has_any_button,
      extracted_emails_json, extracted_phones_json, extracted_whatsapp_json,
      has_email, has_phone, has_whatsapp, has_any_contact, contact_channels,
      engagement_rate, last_post_at, food_topic_density,
      avg_likes_per_post, avg_comments_per_post, posts_analyzed,
      status, source, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', 'apify_profile_cron', datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      full_name=excluded.full_name, biography=excluded.biography, external_url=excluded.external_url,
      bio_links_json=excluded.bio_links_json, category_name=excluded.category_name,
      is_business_account=excluded.is_business_account, is_verified=excluded.is_verified,
      is_private=excluded.is_private, followers_count=excluded.followers_count,
      following_count=excluded.following_count, media_count=excluded.media_count,
      profile_pic_url=excluded.profile_pic_url, business_email=excluded.business_email,
      business_phone_number=excluded.business_phone_number,
      has_email_button=excluded.has_email_button, has_call_button=excluded.has_call_button,
      has_any_button=excluded.has_any_button,
      extracted_emails_json=excluded.extracted_emails_json,
      extracted_phones_json=excluded.extracted_phones_json,
      extracted_whatsapp_json=excluded.extracted_whatsapp_json,
      has_email=excluded.has_email, has_phone=excluded.has_phone, has_whatsapp=excluded.has_whatsapp,
      has_any_contact=excluded.has_any_contact, contact_channels=excluded.contact_channels,
      engagement_rate=COALESCE(excluded.engagement_rate, engagement_rate),
      last_post_at=COALESCE(excluded.last_post_at, last_post_at),
      food_topic_density=COALESCE(excluded.food_topic_density, food_topic_density),
      avg_likes_per_post=COALESCE(excluded.avg_likes_per_post, avg_likes_per_post),
      avg_comments_per_post=COALESCE(excluded.avg_comments_per_post, avg_comments_per_post),
      posts_analyzed=COALESCE(excluded.posts_analyzed, posts_analyzed),
      status=excluded.status, source=excluded.source, fetched_at=datetime('now')
  `).bind(
    u, it.fullName || null, bio, it.externalUrl || null, JSON.stringify(bioLinks),
    it.categoryName || it.businessCategoryName || null,
    it.isBusinessAccount ? 1 : 0, it.isProfessionalAccount ? 1 : 0,
    it.verified ? 1 : 0, it.private ? 1 : 0,
    it.followersCount || null, it.followsCount || it.followingCount || null, it.postsCount || it.mediaCount || null,
    it.profilePicUrlHD || it.profilePicUrl || null,
    bizEmail, bizPhone,
    bizEmail ? 1 : 0, bizPhone ? 1 : 0, (bizEmail || bizPhone) ? 1 : 0,
    JSON.stringify(emails), JSON.stringify(phones), JSON.stringify(whatsapp),
    hasEmail, hasPhone, hasWa, (hasEmail || hasPhone || hasWa) ? 1 : 0, hasEmail + hasPhone + hasWa,
    metrics.engagement_rate || null,
    metrics.last_post_at || null,
    metrics.food_topic_density || null,
    metrics.avg_likes || null,
    metrics.avg_comments || null,
    metrics.posts_analyzed || null
  ).run();
}

// Compute ER + last_post_at + topic-density from posts array.
// Returns {} if no posts so we keep existing values via COALESCE.
function computePostMetrics(posts, followersCount) {
  if (!posts || posts.length === 0 || !followersCount || followersCount < 1) return {};

  const FOOD_KEYWORDS = /food|biryani|kabab|kebab|tandoor|cafe|cafe|cuisine|dakhni|hyderab|muslim|halal|mughlai|chai|coffee|restaurant|eats|recipe|tasting|gourmet|cooking|baker|dessert|chef|foodie|foodgasm|delicious|yummy|street ?food|barbecue|bbq|grill|kitchen/i;

  let totalLikes = 0, totalComments = 0;
  let foodCount = 0;
  let latestTimestamp = null;
  for (const p of posts) {
    totalLikes += (p.likesCount || 0);
    totalComments += (p.commentsCount || 0);
    const cap = (p.caption || p.text || '').slice(0, 1000);
    if (FOOD_KEYWORDS.test(cap)) foodCount++;
    const ts = p.timestamp || p.takenAtTimestamp;
    if (ts) {
      const t = typeof ts === 'string' ? new Date(ts).getTime() : (ts > 1e12 ? ts : ts * 1000);
      if (t && (!latestTimestamp || t > latestTimestamp)) latestTimestamp = t;
    }
  }
  const avgLikes = Math.round(totalLikes / posts.length);
  const avgComments = Math.round(totalComments / posts.length);
  const er = (avgLikes + avgComments) / followersCount;  // standard IG ER calc
  return {
    engagement_rate: Math.round(er * 10000) / 10000,  // 4 decimal places
    avg_likes: avgLikes,
    avg_comments: avgComments,
    posts_analyzed: posts.length,
    last_post_at: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    food_topic_density: Math.round((foodCount / posts.length) * 100) / 100,
  };
}

const EMAIL_RE = /[\w.+-]+(?:@[\w.+-]+)*@[\w-]+(?:\.[\w-]+)+/g;
const INDIAN_MOBILE_RE = /(?:\+?91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}/g;
const WHATSAPP_LINK_RE = /(?:wa\.me\/|whatsapp\.com\/send\?phone=|chat\.whatsapp\.com\/|api\.whatsapp\.com\/send\?phone=)([+\d-]+)/gi;

function extractContacts(bio, bioLinks, bizEmail, bizPhone) {
  let blob = bio || '';
  for (const bl of (bioLinks || [])) {
    if (typeof bl === 'string') blob += ' ' + bl;
    else blob += ' ' + (bl.url || '') + ' ' + (bl.title || '');
  }
  const emails = new Set();
  for (const e of (blob.match(EMAIL_RE) || [])) emails.add(cleanEmail(e));
  if (bizEmail) emails.add(bizEmail.toLowerCase().trim());

  const phones = new Set();
  for (const p of (blob.match(INDIAN_MOBILE_RE) || [])) {
    const d = p.replace(/\D/g, '');
    if (d.length >= 10 && d.length <= 12) phones.add(d.slice(-10));
  }
  if (bizPhone) {
    const d = bizPhone.replace(/\D/g, '');
    if (d.length >= 10 && d.length <= 12) phones.add(d.slice(-10));
  }

  const whatsapp = new Set();
  let m;
  WHATSAPP_LINK_RE.lastIndex = 0;
  while ((m = WHATSAPP_LINK_RE.exec(blob)) !== null) {
    const d = m[1].replace(/\D/g, '');
    if (d.length >= 10 && d.length <= 12) whatsapp.add(d.slice(-10));
  }

  return { emails: [...emails], phones: [...phones], whatsapp: [...whatsapp] };
}

function cleanEmail(e) {
  if ((e.match(/@/g) || []).length > 1) {
    const parts = e.rsplit ? e.rsplit('@', 1) : (() => { const i = e.lastIndexOf('@'); return [e.slice(0, i), e.slice(i + 1)]; })();
    return parts[0].replace(/@/g, '') + '@' + parts[1];
  }
  return e.toLowerCase();
}

function pickRecipientEmails(p) {
  const out = [];
  if (p.business_email) out.push(p.business_email.trim().toLowerCase());
  try {
    for (const e of JSON.parse(p.extracted_emails_json || '[]')) {
      if (e && !out.includes(e.toLowerCase())) out.push(e.toLowerCase());
    }
  } catch {}
  return out.filter(e => /^[^@]+@[^@]+\.[^@]+$/.test(e));
}

function pickRecipientPhones(p) {
  const out = [];
  if (p.business_phone_number) {
    const n = normalizePhone(p.business_phone_number);
    if (n.length >= 10) out.push(n);
  }
  try {
    for (const ph of JSON.parse(p.extracted_phones_json || '[]')) {
      const n = normalizePhone(ph);
      if (n.length >= 10 && !out.includes(n)) out.push(n);
    }
  } catch {}
  return out;
}

async function ensureBookingShell(env, profile, tier) {
  const existing = await env.DB.prepare(`
    SELECT outreach_token FROM influencer_bookings WHERE creator_username=? AND status='pending'
    ORDER BY id DESC LIMIT 1
  `).bind(profile.username).first();
  if (existing && existing.outreach_token) return existing.outreach_token;

  let token;
  for (let i = 0; i < 5; i++) {
    token = genToken();
    const taken = await env.DB.prepare(`SELECT 1 FROM influencer_bookings WHERE outreach_token=?`).bind(token).first();
    if (!taken) break;
  }
  await env.DB.prepare(`
    INSERT INTO influencer_bookings (
      creator_username, creator_name, creator_followers, creator_tier, cover_commitment,
      meal_budget_paise, slot_id, slot_date, window_code, status, outreach_token
    ) VALUES (?, ?, ?, ?, ?, ?, 0, '0000-00-00', 'PENDING', 'pending', ?)
  `).bind(
    profile.username, profile.full_name || null, profile.followers_count || null,
    tier.label?.split(' ')[0]?.replace(/[^A-Z0-9]/gi, '') || 'T1',
    tier.covers, tier.budget_paise, token
  ).run();
  return token;
}

function genToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}

function pickFirstName(p) {
  const fn = p.full_name || '';
  const cleaned = fn.replace(/[^\w\s'-]/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  if (first && first.length > 1 && first.length < 20) return first;
  const u = String(p.username || '').replace(/[._]/g, ' ').split(' ')[0];
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function pickNiche(p) {
  const blob = (String(p.biography || '') + ' ' + String(p.category_name || '')).toLowerCase();
  if (/biryani|hyderab|dakhni|mughlai|kebab|kabab|awadh|nawabi|lucknowi/.test(blob)) return 'biryani & Dakhni food';
  if (/cafe|coffee|chai/.test(blob)) return 'BLR cafes';
  if (/street food|street/.test(blob)) return 'BLR street food';
  if (/halal|muslim|bhopali|zayka/.test(blob)) return 'halal food in BLR';
  if (/dessert|baker|cake|patisserie/.test(blob)) return 'BLR desserts';
  if (/restaurant|eats|cuisine|dine/.test(blob)) return 'BLR restaurants';
  return 'Bangalore food';
}

function renderEmailBody(firstName, niche, tier, token, aiOpener) {
  const url = `https://hnhotels.in/marketing/Influencer/booking/?token=${token}`;
  const opener = aiOpener || `Saw your ${niche} content and would love to host you for a barter collab.`;
  return `Hi ${firstName},

${opener}

Hamza Express — 4th-generation Dakhni/Hyderabadi biryani family in Bangalore since 1918 (Shivajinagar, walking distance from MG Rd / Commercial St / Brigade Rd).

Covered (zero cost to you):
• Full meal for ${tier.covers} people — biryani, mutton brain dry, kababs, tandoori, our signature ghee rice
• Pick your slot: 4 PM, 6 PM, 8 PM, 10 PM, or 12 AM (5 windows daily, 1 spot each)
• Pre-Eid Mutton Family Pack (₹2,200) launching May 21 — exclusive media access if you want it

Ask in return:
• 1 reel or post-set, organic style — no scripted brand-speak
• Tag @hamzaexpressblr + use the geotag pin

Pick your slot: ${url}

References:
• https://nawabichaihouse.com (sister brand)
• Outlet: 19, H.K.P. Road, Shivajinagar, Bangalore 560051

Thanks for considering it.

Nihaf
Managing Director, HN Hotels Pvt Ltd
nihaf@hnhotels.in
`;
}

function renderIgDm(firstName, niche, tier, token, aiOpener) {
  const url = `https://hnhotels.in/marketing/Influencer/booking/?token=${token}`;
  const opener = aiOpener || `Saw your ${niche} content.`;
  return `Hi ${firstName} 👋

${opener}

Hamza Express — Bangalore's 1918 Dakhni biryani family (Shivajinagar). Want to host you for a barter collab — full meal for ${tier.covers}, your choice of timing.

Pick a slot: ${url}

Outlet: 19, H.K.P. Road, Shivajinagar. — Nihaf, MD HN Hotels`;
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
