// hn-winpc Modash poller.
// Long-running daemon. Polls hnhotels.in for pending Modash search jobs every 60s.
// When a job arrives, launches headless Chromium with the assigned profile's
// user-data-dir, runs the Modash search via UI, scrapes results, posts back.
//
// Owner-managed lifecycle:
//   - One-time:  setup-modash-profile.ps1 -ProfileNum N   (each of N accounts)
//   - Daily:     this poller runs continuously as a Scheduled Task
//   - Recovery:  if a profile's cookies expire, marks it 'broken' on the API;
//                owner re-runs setup-modash-profile.ps1 for that one
//
// Pacing: respects the per-profile-per-day cap set in pipeline_config (default 1).
// API guards this server-side — poller doesn't have to enforce locally.

'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// ─── Config ────────────────────────────────────────────────────────────────
const API = process.env.MODASH_API_BASE || 'https://hnhotels.in/api/influencer-pipeline';
const CRON_TOKEN = process.env.CRON_TOKEN;
const PROFILES_DIR = process.env.MODASH_PROFILES_DIR || 'C:\\hn-control\\modash-driver\\profiles';
const POLL_INTERVAL_MS = parseInt(process.env.MODASH_POLL_INTERVAL_MS || '60000');
const REQUEST_TIMEOUT_MS = 60000;

if (!CRON_TOKEN) {
  console.error('FATAL: CRON_TOKEN env var not set');
  process.exit(1);
}

// ─── Logging ───────────────────────────────────────────────────────────────
function log(level, msg, meta) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  console.log(line);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────
async function apiGet(action) {
  const r = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    headers: { 'X-Cron-Token': CRON_TOKEN },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return r.json();
}
async function apiPost(action, body) {
  const r = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cron-Token': CRON_TOKEN },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return r.json();
}

// ─── Modash search via Playwright ──────────────────────────────────────────
async function runModashSearch(profileNum, filters) {
  const dataDir = path.join(PROFILES_DIR, `profile-${profileNum}`);
  if (!fs.existsSync(dataDir)) {
    throw new Error(`profile_dir_missing: ${dataDir} — run setup-modash-profile.ps1 -ProfileNum ${profileNum}`);
  }

  log('info', 'launching_chromium', { profileNum, dataDir });
  // Use system Chrome (channel: 'chrome') if Playwright's bundled Chromium isn't available.
  // System Chrome is already installed at C:\Program Files\Google\Chrome\Application\chrome.exe.
  // Each profile-N has its own user-data-dir, so this doesn't conflict with aggregator-pulse's
  // default-profile Chrome (different user-data-dir = different process tree, isolated cookies).
  // Configurable headless via env (default: true). MODASH_HEADLESS=0 to debug visually.
  const headless = process.env.MODASH_HEADLESS !== '0';
  const launchOptions = {
    headless,
    viewport: { width: 1366, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      // Mask common headless fingerprints to reduce anti-bot detection
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  // Prefer system Chrome (channel) when MODASH_USE_SYSTEM_CHROME=1 (set by install if Chromium download failed)
  if (process.env.MODASH_USE_SYSTEM_CHROME === '1') {
    launchOptions.channel = 'chrome';
  }
  const ctx = await chromium.launchPersistentContext(dataDir, launchOptions);

  try {
    const page = await ctx.newPage();
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
    });

    log('info', 'navigating_to_modash');
    // 'load' fires later than 'domcontentloaded' but is more reliable for SPAs.
    // Modash is heavy SPA — initial paint may take 30-60s. Bumped timeout to 90s.
    await page.goto('https://marketer.modash.io/discovery/instagram', {
      waitUntil: 'load',
      timeout: 90000,
    });

    // Wait briefly for client-side redirect to login if cookies expired
    await page.waitForTimeout(3000);
    if (page.url().includes('/login') || page.url().includes('/signin') || page.url().includes('/auth')) {
      throw new Error('cookies_expired_or_missing');
    }

    // Apply search filters via UI. NOTE: selectors depend on Modash's current DOM.
    // The Modash UI has changed in the past — owner should verify after deploy.
    // Best practice: Modash exposes XHR endpoints internally; if visible in DevTools,
    // call them directly with the session cookie for higher reliability than DOM scraping.
    //
    // The block below is a SCAFFOLD. After first deploy, owner inspects page DOM /
    // network panel and updates selectors here.
    log('info', 'applying_filters', { filters });

    const results = await scrapeSearchResults(page, filters);
    log('info', 'search_complete', { profileNum, count: results.length });
    return { results };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function scrapeSearchResults(page, filters) {
  // SCAFFOLD: this needs Modash-specific selector tuning after first run.
  //
  // Strategy options (pick the one that's most stable on first inspection):
  //   A) DOM scraping — wait for `[data-testid="creator-card"]` / similar, parse
  //      username + followers from the rendered cards.
  //   B) Network interception — page.on('response') filter the XHR that returns
  //      the search results JSON, parse that. This is more reliable.
  //
  // The implementation below tries (B) first, falls back to (A).

  return new Promise(async (resolve, reject) => {
    const collected = [];
    let resolved = false;

    // Option B: intercept the search XHR
    let firstXhrLogged = false;
    page.on('response', async (resp) => {
      try {
        const url = resp.url();
        if (!url.includes('discovery') && !url.includes('search')) return;
        if (resp.status() !== 200) return;
        const ct = resp.headers()['content-type'] || '';
        if (!ct.includes('application/json')) return;
        const data = await resp.json().catch(() => null);
        if (!data) return;
        // Modash typically returns { lookalikes: [...] } or { results: [...] } or { data: [...] }
        const list = data.lookalikes || data.results || data.data || data.items;
        if (!Array.isArray(list) || list.length === 0) return;

        // First useful XHR: log its URL + first item's schema so owner can verify Modash version
        if (!firstXhrLogged) {
          firstXhrLogged = true;
          const sample = list[0] || {};
          const sampleProfile = sample.profile || sample;
          log('info', 'first_search_xhr', {
            url: url.slice(0, 200),
            total: list.length,
            sample_keys: Object.keys(sampleProfile).slice(0, 20),
          });
        }

        for (const item of list) {
          // Modash list-view XHR returns RICH profile data — captured here:
          //   username, fullname, picture, follower_count, biography,
          //   engagement_rate, is_business, is_verified, is_private, is_brand,
          //   external_url, account_category, last_posted_at, user_id, _score.
          // This is what Apify's profile-scraper would have returned for $0.10/profile.
          // We skip Apify entirely for Modash-sourced creators.
          const p = item.profile || item;
          if (!p.username) continue;
          collected.push({
            username: String(p.username).toLowerCase(),
            full_name: p.fullname || p.fullName || p.full_name || null,
            followers: p.follower_count || p.followers || p.followersCount || null,
            following: p.following_count || null,
            engagement_rate: p.engagement_rate || p.engagementRate || null,
            profile_pic_url: p.picture || p.profilePicUrl || null,
            country: p.country || null,
            city: p.city || null,
            // Newly captured (saves Apify enrichment cost ~$0.10/profile):
            biography: p.biography || null,
            is_business: p.is_business ? 1 : 0,
            is_verified: p.is_verified ? 1 : 0,
            is_private: p.is_private ? 1 : 0,
            is_brand: p.is_brand ? 1 : 0,
            external_url: p.external_url || null,
            category_name: p.account_category || null,
            last_post_at: p.last_posted_at || null,
            user_id: p.user_id || null,
            modash_score: p._score || null,
          });
        }
      } catch (_) { /* ignore */ }
    });

    // Trigger the search by typing filters into Modash UI.
    // NOTE: this is the part most likely to need owner adjustment.
    try {
      await applyFiltersViaUI(page, filters);
    } catch (e) {
      // If UI interaction fails, give the page a few seconds to load
      // anything from initial state (Modash often shows trending creators on landing).
      await page.waitForTimeout(2000);
    }

    // Wait for first-page results
    await page.waitForTimeout(8000);

    // Scroll-paginate: Modash lazy-loads more results as you scroll.
    // Each scroll triggers another XHR → caught by the response handler above.
    // Default 5 scrolls × ~10 results/page = ~50 results per job. Configurable via
    // filter.scroll_pages (set from D1 modash_default_filters.scroll_pages).
    const scrollPages = Math.max(0, Math.min(20, parseInt(filters.scroll_pages || 5)));
    if (scrollPages > 0) {
      log('info', 'scroll_paginate_start', { scroll_pages: scrollPages });
      const before = collected.length;
      for (let i = 0; i < scrollPages; i++) {
        try {
          const grew = await page.evaluate(() => {
            // Try common Modash result-list containers; fall back to window.
            const sels = [
              '[class*="ResultsList"]',
              '[class*="results-list"]',
              '[class*="creator-grid"]',
              '[class*="CreatorGrid"]',
              '[class*="list-container"]',
              'main',
            ];
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el && el.scrollHeight > el.clientHeight) {
                el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
                return { container: sel, height: el.scrollHeight };
              }
            }
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            return { container: 'window', height: document.documentElement.scrollHeight };
          });
          await page.waitForTimeout(2500);
          log('info', 'scroll_iteration', { i: i + 1, grew, collected_so_far: collected.length });
        } catch (e) {
          log('warn', 'scroll_failed', { i, err: e.message });
        }
      }
      log('info', 'scroll_paginate_done', { added_by_scrolling: collected.length - before });
    }

    if (!resolved) {
      resolved = true;
      // Dedupe by username
      const seen = new Set();
      const unique = collected.filter(c => {
        if (seen.has(c.username)) return false;
        seen.add(c.username);
        return true;
      });
      resolve(unique);
    }
  });
}

async function applyFiltersViaUI(page, filters) {
  // Best-effort filter application. Modash UI evolves — owner tunes after first run.
  // The Modash discovery URL accepts some filters as query params; others may need
  // post-load UI manipulation. We send all known params and log what's visibly applied.
  //
  // Filter spec (read from modash_default_filters config in D1):
  //   location, country, followers_from, followers_to, engagement_rate_from,
  //   topics[], language[],
  //   bio_keywords[]            — searches creator bio for these words (OR-joined)
  //   audience_interests[]      — filter by what the FOLLOWERS care about
  //   audience_demo_religion    — { muslim: { min_pct: 15 }, ... } follower religion floor
  //   audience_demo_location    — { Bangalore: { min_pct: 30 }, ... } follower city floor
  //
  // Memory: feedback_influencer_barter_targeting.md — barter outreach targets micro-tier.
  const params = new URLSearchParams();
  if (filters.location)        params.set('location', filters.location);
  if (filters.country)         params.set('country', filters.country);
  if (filters.followers_from)  params.set('followers_min', String(filters.followers_from));
  if (filters.followers_to)    params.set('followers_max', String(filters.followers_to));
  if (filters.engagement_rate_from) params.set('engagement_min', String(filters.engagement_rate_from));
  if (filters.topics)          params.set('topics', filters.topics.join(','));
  if (filters.language)        params.set('language', filters.language.join(','));

  // New: bio keyword OR-search (Modash uses 'bio' or 'keywords' param; we try both)
  if (filters.bio_keywords && Array.isArray(filters.bio_keywords) && filters.bio_keywords.length) {
    const joined = filters.bio_keywords.join(' OR ');
    params.set('bio', joined);
    params.set('keywords', joined);
  }

  // New: audience interests (what followers like) — e.g. "Food & Drink"
  if (filters.audience_interests && Array.isArray(filters.audience_interests) && filters.audience_interests.length) {
    params.set('audience_interests', filters.audience_interests.join(','));
  }

  // New: audience demographic floors. Modash exposes religion/language/location of FOLLOWERS.
  // URL param convention used: audience_<dim>_<value>_min=<pct>
  if (filters.audience_demo_religion && typeof filters.audience_demo_religion === 'object') {
    for (const [religion, spec] of Object.entries(filters.audience_demo_religion)) {
      if (spec && typeof spec.min_pct === 'number') {
        params.set(`audience_religion_${religion}_min`, String(spec.min_pct));
      }
    }
  }
  if (filters.audience_demo_location && typeof filters.audience_demo_location === 'object') {
    for (const [loc, spec] of Object.entries(filters.audience_demo_location)) {
      if (spec && typeof spec.min_pct === 'number') {
        params.set(`audience_location_${loc.toLowerCase()}_min`, String(spec.min_pct));
      }
    }
  }

  const url = `https://marketer.modash.io/discovery/instagram?${params.toString()}`;
  log('info', 'navigating_with_filters', { url, filter_count: Array.from(params.keys()).length });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Inspect which filter chips Modash actually rendered — diagnostic, not gating.
  // Owner uses this to tune the URL param names if they don't match Modash's expected schema.
  try {
    const appliedChips = await page.evaluate(() => {
      const selectors = ['[class*="chip"]', '[class*="Chip"]', '[class*="filter-tag"]', '[class*="FilterTag"]', '[class*="filter-pill"]'];
      const all = new Set();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = (el.textContent || '').trim();
          if (t && t.length < 80) all.add(t);
        });
      }
      return Array.from(all);
    });
    log('info', 'filter_chips_visible', { count: appliedChips.length, chips: appliedChips.slice(0, 15) });
  } catch (e) {
    log('warn', 'filter_chip_inspection_failed', { err: e.message });
  }
}

// ─── Main loop ─────────────────────────────────────────────────────────────
async function tick() {
  let job;
  try {
    job = await apiGet('modash-next-job');
  } catch (e) {
    log('error', 'api_get_failed', { err: e.message });
    return;
  }
  if (job.no_jobs) return;
  if (!job.job_id) {
    log('warn', 'unexpected_response', { job });
    return;
  }

  log('info', 'job_picked', { job_id: job.job_id, profile: job.profile_num });

  let outcome;
  try {
    outcome = await runModashSearch(job.profile_num, job.search_filters);
    log('info', 'job_done', { job_id: job.job_id, count: outcome.results.length });
  } catch (e) {
    log('error', 'job_failed', { job_id: job.job_id, err: e.message });
    if (e.message === 'cookies_expired_or_missing') {
      await apiPost('modash-cookies-expired', { profile_num: job.profile_num });
    }
    await apiPost('modash-job-done', {
      job_id: job.job_id,
      results: [],
      error: e.message,
    });
    return;
  }

  await apiPost('modash-job-done', {
    job_id: job.job_id,
    results: outcome.results,
    summary: `${outcome.results.length} unique creators from profile-${job.profile_num}`,
  });
}

async function main() {
  log('info', 'poller_started', {
    api: API,
    profiles_dir: PROFILES_DIR,
    poll_interval_ms: POLL_INTERVAL_MS,
  });
  while (true) {
    try {
      await tick();
    } catch (e) {
      log('error', 'tick_unhandled', { err: e.message, stack: e.stack?.slice(0, 500) });
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
