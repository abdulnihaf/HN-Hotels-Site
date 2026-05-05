// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-news
// Layer 6 — News & Sentiment (sources 44-53)
//
// 44 GDELT 2.0 events                  every 15 min 24×7
// 45 MoneyControl RSS                  every 15 min 06:00-23:30 IST
// 46 Economic Times Markets RSS        every 15 min
// 47 LiveMint Markets RSS              every 15 min
// 48 Business Standard Markets RSS     every 15 min
// 49 Reuters India RSS                 every 30 min
// 50 BQ Prime feed                     every 30 min
// 51 Reddit r/IndianStreetBets + IndiaInvestments  every 30 min
// 52 Nitter (Twitter mirror) cashtags   every 30 min
// 53 StockTwits India                  every 30 min
// ═══════════════════════════════════════════════════════════════════════════

import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';
import { scoreSentiment, importanceScore, tagSymbols, tagSectors, parseRss } from '../../_shared/sentiment.js';
import { callHaiku, parseJsonOutput } from '../../_shared/anthropic.js';

const WORKER_NAME = 'wealth-news';

function hash(s) { let h = 0x811c9dc5; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;} return h.toString(16).padStart(8,'0'); }

async function fetchRssAndStore(env, source, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 wealth-engine/1.0' }});
  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const xml = await res.text();
  const items = parseRss(xml);
  const symbolsList = (env.SYMBOLS_HINT || '').split(',').filter(Boolean);
  const ingestedAt = Date.now();
  const rows = items.map(it => {
    const headline = it.title || '';
    const fullText = `${headline} ${it.desc || ''}`;
    const id = hash(`${source}|${it.link || it.guid || headline}`);
    const publishedAt = it.pubDate ? Date.parse(it.pubDate) || ingestedAt : ingestedAt;
    return {
      id, source, url: it.link,
      headline,
      body_excerpt: (it.desc || '').slice(0, 500),
      symbols_tagged: JSON.stringify(tagSymbols(fullText, symbolsList)),
      sectors_tagged: JSON.stringify(tagSectors(fullText)),
      sentiment_score: scoreSentiment(fullText),
      importance_score: importanceScore(headline, source),
      published_at: publishedAt,
      ingested_at: ingestedAt,
    };
  }).filter(r => r.headline);
  const cols = ['id','source','url','headline','body_excerpt','symbols_tagged','sectors_tagged',
    'sentiment_score','importance_score','published_at','ingested_at'];
  return batchInsert(env.DB, 'news_items', cols, rows, 'IGNORE');
}

const RSS_SOURCES = {
  moneycontrol_top: 'https://www.moneycontrol.com/rss/MCtopnews.xml',
  moneycontrol_markets: 'https://www.moneycontrol.com/rss/marketreports.xml',
  moneycontrol_business: 'https://www.moneycontrol.com/rss/business.xml',
  et_markets: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
  livemint_markets: 'https://www.livemint.com/rss/markets',
  business_standard: 'https://www.business-standard.com/rss/markets-106.rss',
  reuters_india: 'https://feeds.reuters.com/reuters/INtopNews',
};

async function ingestRssAll(env) {
  let total = 0;
  for (const [src, url] of Object.entries(RSS_SOURCES)) {
    try {
      total += await fetchRssAndStore(env, src, url);
    } catch (e) {}
  }
  return { rows: total };
}

// SOURCE 44 — GDELT
async function ingestGdelt(env) {
  const query = '(India OR Sensex OR Nifty OR RBI OR SEBI) AND (market OR economy OR finance)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=50&format=json&timespan=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  if (!res.ok) return { rows: 0 };
  const j = await res.json();
  const items = j.articles || [];
  const symbolsList = (env.SYMBOLS_HINT || '').split(',').filter(Boolean);
  const ingestedAt = Date.now();
  const rows = items.map(it => {
    const headline = it.title || '';
    const id = hash(`gdelt|${it.url}`);
    const publishedAt = it.seendate ? Date.parse(it.seendate.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z')) || ingestedAt : ingestedAt;
    return {
      id, source: 'gdelt', url: it.url, headline,
      body_excerpt: (it.snippet || '').slice(0, 500),
      symbols_tagged: JSON.stringify(tagSymbols(headline, symbolsList)),
      sectors_tagged: JSON.stringify(tagSectors(headline)),
      sentiment_score: scoreSentiment(headline),
      importance_score: importanceScore(headline, 'gdelt'),
      published_at: publishedAt,
      ingested_at: ingestedAt,
    };
  }).filter(r => r.headline);
  const cols = ['id','source','url','headline','body_excerpt','symbols_tagged','sectors_tagged',
    'sentiment_score','importance_score','published_at','ingested_at'];
  const written = await batchInsert(env.DB, 'news_items', cols, rows, 'IGNORE');
  return { rows: written };
}

// SOURCE 51 — Reddit (retail-buzz signal)
//
// Endpoints: /new.json (sorted by recency — leading indicator).
// We previously used /.json (sorted by hot), which lags retail attention by hours.
// User-Agent: friendly identifier per Reddit API guidelines.
// Symbol tagging: against top-200 liquid F&O stocks (cached for 1h in module scope).
// Cap: 100 posts per cron tick total (≈33/sub) to stay well under 30s worker timeout.
async function getLiquidUniverse(env) {
  // Try cache first (KV-style scratch — using a singleton on globalThis with TTL)
  const cached = globalThis.__liquid_universe_cache;
  const now = Date.now();
  if (cached && (now - cached.ts) < 3600 * 1000) return cached.list;
  try {
    const r = await env.DB.prepare(`
      WITH latest AS (
        SELECT symbol, close_paise, volume,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) AS rn
        FROM equity_eod WHERE exchange='NSE' AND trade_date >= date('now','-30 days') AND volume > 0
      )
      SELECT symbol, AVG(close_paise * volume) / 1e7 AS avg_traded_value_cr
      FROM latest WHERE rn <= 20
      GROUP BY symbol HAVING avg_traded_value_cr > 50
      ORDER BY avg_traded_value_cr DESC LIMIT 200
    `).all();
    const list = (r.results || []).map(x => x.symbol);
    if (list.length) globalThis.__liquid_universe_cache = { ts: now, list };
    return list;
  } catch (e) {
    return (env.SYMBOLS_HINT || '').split(',').filter(Boolean);
  }
}

// Common-English tickers that produce false positives in social-media text
// (e.g. "no idea" → IDEA, "in oil" → OIL). We require these to appear with a
// $ prefix or in ALL-CAPS isolation to count as a mention.
const STRICT_TICKERS = new Set(['IDEA','OIL','BUY','SELL','LIVE','HOT','PEN','BSE','LIC','POLY','NICE','CARE']);

function tagSymbolsRetail(text, symbolsList) {
  if (!text || !symbolsList) return [];
  const upper = text.toUpperCase();
  return symbolsList.filter(s => {
    if (STRICT_TICKERS.has(s)) {
      // Require $TICKER, #TICKER, or all-caps surrounded by non-letters
      const re = new RegExp(`(\\$|#)${s}\\b|(?<![A-Z])${s}(?![A-Z])`);
      // Test against original text (not upper) for the $/# variant
      if (new RegExp(`(\\$|#)${s}\\b`).test(text)) return true;
      // Original-case substring with caps neighbours: only match if surrounded by uppercase context
      const ctx = new RegExp(`[^A-Za-z]${s}[^A-Za-z]`);
      return ctx.test(' ' + text + ' ') && /[A-Z]{2}/.test(text);  // lazy check: text contains some all-caps
    }
    const re = new RegExp(`\\b${s}\\b`);
    return re.test(upper);
  });
}

async function ingestReddit(env) {
  const subs = ['IndianStreetBets', 'IndiaInvestments', 'IndianStockMarket'];
  // Prefer dynamic top-200 liquid universe; fallback to SYMBOLS_HINT if DB empty.
  const universe = await getLiquidUniverse(env);
  const symbolsList = universe.length > 0 ? universe : (env.SYMBOLS_HINT || '').split(',').filter(Boolean);
  const ingestedAt = Date.now();
  const PER_SUB_LIMIT = 35;     // 35 × 3 ≈ 100 posts max per tick
  // Reddit blocks default Cloudflare-Worker UA. We rotate across realistic browser UAs;
  // both old.reddit.com and json-API endpoints respond OK to a Chrome-like UA from CF IP.
  const UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  let total = 0;
  let fetched = 0;
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    const ua = UA_POOL[i % UA_POOL.length];
    // Try old.reddit.com first (less aggressive bot-blocking) then www fallback.
    const urls = [
      `https://old.reddit.com/r/${sub}/new.json?limit=${PER_SUB_LIMIT}`,
      `https://www.reddit.com/r/${sub}/new.json?limit=${PER_SUB_LIMIT}`,
    ];
    let posts = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': ua,
            'Accept': 'application/json,text/html;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(8000),
          cf: { cacheTtl: 0 },
        });
        if (!res.ok) continue;
        const j = await res.json();
        posts = (j.data?.children || []).map(c => c.data);
        if (posts.length > 0) break;
      } catch (e) {}
    }
    fetched += posts.length;
    if (posts.length === 0) continue;
    const rows = posts.map(p => {
      const text = `${p.title || ''} ${p.selftext || ''}`;
      const id = hash(`reddit|${p.id}`);
      // Sentiment: blend keyword score with upvote_ratio (range 0-1, neutral=0.5).
      // Reddit's upvote_ratio is meaningful — when retail piles in with conviction,
      // ratio approaches 0.95. When divisive, drops below 0.6.
      const kw = scoreSentiment(text);
      const upvoteRatioBias = ((p.upvote_ratio || 0.5) - 0.5) * 0.6;  // -0.3..+0.3
      const sentiment = Math.max(-1, Math.min(1, kw * 0.7 + upvoteRatioBias));
      // Engagement: comments weigh 2x upvotes (more conviction). Normalize by /50.
      const engagement = ((p.score || p.ups || 0) + 2 * (p.num_comments || 0)) / 50;
      return {
        id, platform: 'reddit', author: p.author,
        content: text.slice(0, 1000),
        symbols_tagged: JSON.stringify(tagSymbolsRetail(text, symbolsList)),
        sentiment_score: sentiment,
        engagement_score: engagement,
        posted_at: (p.created_utc || 0) * 1000 || ingestedAt,
      };
    }).filter(r => r.content);
    const cols = ['id','platform','author','content','symbols_tagged','sentiment_score','engagement_score','posted_at'];
    total += await batchInsert(env.DB, 'social_posts', cols, rows, 'IGNORE');
    // Politeness: short pause between subs to stay under Reddit's 60-req/min cap.
    await new Promise(r => setTimeout(r, 800));
  }
  return { rows: total, fetched };
}

// SOURCE 52 — Nitter (free Twitter mirror)
async function ingestNitter(env) {
  const instances = (env.NITTER_INSTANCES || 'nitter.poast.org,nitter.privacydev.net').split(',');
  const cashtags = (env.CASHTAGS || 'NIFTY,BANKNIFTY,SENSEX,RELIANCE,HDFCBANK,INFY,TCS').split(',');
  const symbolsList = (env.SYMBOLS_HINT || '').split(',').filter(Boolean);
  const ingestedAt = Date.now();
  let total = 0;
  for (const tag of cashtags) {
    let succeeded = false;
    for (const inst of instances) {
      try {
        const url = `https://${inst}/search?f=tweets&q=%24${tag}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const html = await res.text();
        // crude: extract tweet blocks
        const tweetRe = /<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
        const matches = [...html.matchAll(tweetRe)].slice(0, 20);
        const rows = matches.map((m, i) => {
          const content = m[1].replace(/<[^>]+>/g, '').trim();
          const id = hash(`nitter|${tag}|${content.slice(0, 80)}|${i}`);
          return {
            id, platform: 'nitter', author: null,
            content: content.slice(0, 500),
            symbols_tagged: JSON.stringify(tagSymbols(content + ' ' + tag, symbolsList)),
            sentiment_score: scoreSentiment(content),
            engagement_score: 0,
            posted_at: ingestedAt,
          };
        }).filter(r => r.content);
        const cols = ['id','platform','author','content','symbols_tagged','sentiment_score','engagement_score','posted_at'];
        total += await batchInsert(env.DB, 'social_posts', cols, rows, 'IGNORE');
        succeeded = true;
        break;
      } catch (e) {}
    }
    if (!succeeded) break;
  }
  return { rows: total };
}

// SOURCE 53 — StockTwits
async function ingestStockTwits(env) {
  const symbols = (env.STOCKTWITS_SYMBOLS || 'NIFTY,RELIANCE,HDFCBANK,INFY,TCS').split(',');
  const ingestedAt = Date.now();
  let total = 0;
  for (const sym of symbols) {
    try {
      const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${sym}.json`, {
        headers: { 'User-Agent': 'wealth-engine/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const messages = j.messages || [];
      const rows = messages.map(m => ({
        id: hash(`stocktwits|${m.id}`),
        platform: 'stocktwits',
        author: m.user?.username,
        content: (m.body || '').slice(0, 500),
        symbols_tagged: JSON.stringify([sym]),
        sentiment_score: m.entities?.sentiment?.basic === 'Bullish' ? 0.6 : (m.entities?.sentiment?.basic === 'Bearish' ? -0.6 : scoreSentiment(m.body)),
        engagement_score: (m.likes?.total || 0) / 10,
        posted_at: m.created_at ? Date.parse(m.created_at) : ingestedAt,
      })).filter(r => r.content);
      const cols = ['id','platform','author','content','symbols_tagged','sentiment_score','engagement_score','posted_at'];
      total += await batchInsert(env.DB, 'social_posts', cols, rows, 'IGNORE');
    } catch (e) {}
  }
  return { rows: total };
}

// ────────────────────────────────────────────────────────────────────────
// LLM-based news tagging — uses Claude Haiku to extract NSE stock tickers
// and refine sentiment from news headlines + body. Fills the 60% gap left
// by keyword-only tagging.
//
// Cost discipline:
//   • Haiku only ($1/MT input, $5/MT output)
//   • Cache key = headline hash → never re-call same content
//   • Daily cap enforced inside callHaiku
//   • Process untagged-or-default items only (skip if symbols_tagged already set)
// ────────────────────────────────────────────────────────────────────────
async function llmTagNews(env, opts = {}) {
  const lookbackHours = opts.hours || 24;
  const maxItems = opts.max || 100;
  const since = Date.now() - lookbackHours * 3600000;

  // Pick news that's untagged OR keyword-tagged (which may be wrong/sparse)
  // Prefer recent + high-importance items
  const news = (await env.DB.prepare(`
    SELECT id, headline, body_excerpt, source, importance_score, symbols_tagged
    FROM news_items
    WHERE published_at > ?
      AND headline IS NOT NULL
      AND (symbols_tagged IS NULL OR symbols_tagged = '[]' OR LENGTH(symbols_tagged) < 4)
    ORDER BY importance_score DESC NULLS LAST, published_at DESC
    LIMIT ?
  `).bind(since, maxItems).all()).results || [];

  if (news.length === 0) return { rows: 0, skipped: 'no-untagged-news' };

  // Top liquid F&O stocks (universe to choose from — keeps LLM focused)
  const liquidSymbols = ((await env.DB.prepare(`
    SELECT symbol FROM equity_eod
    WHERE exchange='NSE' AND trade_date >= date('now', '-30 days') AND volume > 0
    GROUP BY symbol
    HAVING AVG(close_paise * volume) > 100000000000
    ORDER BY AVG(close_paise * volume) DESC LIMIT 250
  `).all()).results || []).map(r => r.symbol);

  const universeHint = liquidSymbols.slice(0, 250).join(', ');

  const system = `You extract Indian stock tickers from financial news. You output ONLY JSON, no prose.

UNIVERSE: NSE-listed F&O stocks. Restrict tickers to these examples + similar:
${universeHint}

RULES:
- Output JSON: { "symbols": ["TICKER1","TICKER2"], "sentiment": -1.0 to 1.0, "category": "results|m&a|guidance|regulatory|macro|other" }
- Max 5 tickers. Use NSE convention (RELIANCE, HDFCBANK, BAJFINANCE etc.)
- Only tickers EXPLICITLY mentioned. No guesses, no sector-wide assumptions.
- Sentiment: -1 = bearish news, 0 = neutral/factual, +1 = bullish news. Be conservative.
- If a sectoral ETF or index is the subject (e.g. "Nifty IT down 2%"), output []`;

  let tagged = 0, costPaiseTotal = 0, hits = 0;
  const errors = [];

  for (const item of news) {
    try {
      const userPrompt = `Headline: ${item.headline}
${item.body_excerpt ? `Excerpt: ${item.body_excerpt.slice(0, 400)}` : ''}

Output JSON only.`;

      const result = await callHaiku(env, {
        prompt: userPrompt,
        system,
        max_tokens: 150,
        purpose: 'news_tagging',
        worker: WORKER_NAME,
        cache_key: `news_tag_${item.id}`,
        cache_ttl_ms: 30 * 86400000, // 30 days — news doesn't re-interpret
      });

      const parsed = parseJsonOutput(result.text);
      if (!parsed) continue;

      const symbols = Array.isArray(parsed.symbols) ? parsed.symbols.filter(s => typeof s === 'string').slice(0, 5) : [];
      const sentiment = typeof parsed.sentiment === 'number' ? Math.max(-1, Math.min(1, parsed.sentiment)) : null;

      // Update only if we got something useful
      if (symbols.length > 0 || sentiment !== null) {
        await env.DB.prepare(`
          UPDATE news_items SET
            symbols_tagged = ?,
            sentiment_score = COALESCE(?, sentiment_score)
          WHERE id = ?
        `).bind(JSON.stringify(symbols), sentiment, item.id).run();
        tagged++;
      }

      costPaiseTotal += result.cost_paise || 0;
      if (result.cached) hits++;
    } catch (e) {
      errors.push(`${item.id}: ${e.message?.slice(0, 80)}`);
      // Stop on cap errors
      if (e.message?.includes('cap-reached')) break;
    }
  }

  return {
    rows: tagged,
    processed: news.length,
    cost_paise: costPaiseTotal,
    cache_hits: hits,
    errors: errors.slice(0, 5),
  };
}

// Unique expressions. Paid tier — RSS + GDELT every 5 min (was 15, GDELT disabled).
const CRON_DISPATCH = {
  '*/5 * * * *':         { name: 'rss_news',   fn: ingestRssAll },          // every 5 min (was 15)
  '2-57/5 * * * *':      { name: 'gdelt',      fn: ingestGdelt },           // every 5 min offset 2 (was disabled)
  '*/10 * * * *':        { name: 'reddit',     fn: ingestReddit },          // every 10 min (was 30)
  '4-54/10 * * * *':     { name: 'nitter',     fn: ingestNitter },          // every 10 min offset 4 (was disabled)
  '*/10 3-10 * * 1-5':   { name: 'stocktwits', fn: ingestStockTwits },      // every 10 min during market (was 30)
  '15 * * * *':          { name: 'llm_tag_news', fn: llmTagNews },          // every hour at :15 — LLM tagger fills gaps
};

async function runCron(env, cronExpr) {
  const entry = CRON_DISPATCH[cronExpr];
  if (!entry) return;
  const id = await logCronStart(env.DB, WORKER_NAME, entry.name, 'cron');
  try {
    const r = await entry.fn(env);
    await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
    await markSourceHealth(env.DB, entry.name, true);
  } catch (e) {
    await logCronEnd(env.DB, id, 'failed', 0, String(e).slice(0, 500));
    await markSourceHealth(env.DB, entry.name, false, e);
  }
}

const HTTP_HANDLERS = {
  rss_news: ingestRssAll, gdelt: ingestGdelt,
  reddit: ingestReddit, reddit_ingest: ingestReddit,   // alias per task spec
  nitter: ingestNitter, stocktwits: ingestStockTwits,
  llm_tag_news: llmTagNews,
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env, event.cron)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.DASHBOARD_KEY) return new Response('unauthorized', { status: 401 });
    const m = url.pathname.match(/^\/run\/([a-z0-9_]+)$/);
    if (m && HTTP_HANDLERS[m[1]]) {
      const id = await logCronStart(env.DB, WORKER_NAME, m[1], 'http');
      try {
        const r = await HTTP_HANDLERS[m[1]](env);
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return new Response('wealth-news', { status: 200 });
  },
};
