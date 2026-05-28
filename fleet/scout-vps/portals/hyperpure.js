// Hyperpure adapter — direct URL navigation to the search results page,
// then DOM scrape. The extension's hyperpureScrapeSearchResults uses the
// same approach as a fallback when the native search XHR misses; we make
// it the primary path because it's much more reliable from a fresh
// Playwright context where there's no in-page state to drive.

import { pickBest, parseRupeesToPaise, cleanText, emptyQuote, errorQuote } from '../utils.js';

function buildSearchUrl(query) {
  const slug = String(query || 'search')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'search';
  const url = new URL(`https://www.hyperpure.com/in/search/${encodeURIComponent(slug)}`);
  url.searchParams.set('type', 'SEARCH');
  url.searchParams.set('query', query);
  url.searchParams.set('referenceType', 'autosuggest_enter_before_result');
  return url.toString();
}

export async function scoutHyperpure({ page, ctx }) {
  const query = ctx.searchQuery;
  const target = buildSearchUrl(query);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    return errorQuote(`Hyperpure navigation failed: ${err.message}`, { source: 'HYPERPURE', target });
  }
  // Hyperpure's grid hydrates ~1.5s after DOMContentLoaded.
  await page.waitForTimeout(2500);

  const cards = await page.$$eval('article, li, section, div', (nodes) => {
    function clean(t, n = 220) {
      const x = String(t || '').replace(/\s+/g, ' ').trim();
      return x.length > n ? `${x.slice(0, n)}...` : x;
    }
    const out = [];
    const seen = new Set();
    for (const el of nodes) {
      const raw = el.innerText || '';
      if (!raw.includes('₹')) continue;
      if (raw.length < 20 || raw.length > 950) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      const priceIdx = lines.findIndex((l) => /₹\s*[\d,]+(?:\.\d+)?/.test(l));
      if (priceIdx < 0) continue;
      const blocked = /^(add|\+|notify me|view similar|out of stock|high in demand|\d+\+ recent buyers|rated|veg|non veg|brand|all)$/i;
      const titleCand = lines.slice(Math.max(0, priceIdx - 8), priceIdx)
        .filter((l) => /[a-z]/i.test(l))
        .filter((l) => !blocked.test(l))
        .filter((l) => !/^₹/.test(l))
        .filter((l) => !/off mrp|best rate|recent buyers/i.test(l));
      const title = clean(titleCand.slice(-3).join(' '), 180);
      if (!title || title.length < 3) continue;
      const stockOut = /out of stock|notify me|view similar/i.test(raw);
      const packMatch = clean(raw, 600).match(/\b\d+(?:\.\d+)?\s?(?:kg|g|gm|ml|l|ltr|litre|pcs|pc|pack|carton|tin|bottle|nos)\b/i);
      const pack = packMatch ? packMatch[0] : '';
      // Per-card href: must be an in-page product link, NOT a page-level
      // anchor (footer "help@hyperpure.com" mailto, "#how-it-works" CTA).
      // Live snapshot 2026-05-29 showed all 3 captured sku_urls were
      // exactly these footer/header anchors — UI fell back to broken
      // redirects. Require a product-style path prefix or emit empty so
      // the API-side canonical search-URL fallback takes over.
      const linkEl = el.closest?.('a[href]') || el.querySelector?.('a[href]');
      const rawHref = linkEl?.getAttribute('href') || '';
      const isProductPath = /^\/(in\/)?(products?|p)\//i.test(rawHref) ||
                            /^https?:\/\/[^/]*hyperpure\.com\/(in\/)?(products?|p)\//i.test(rawHref);
      const href = isProductPath ? rawHref : '';
      const imgEl = el.querySelector?.('img[src], img[data-src]');
      let imageUrl = '';
      if (imgEl) {
        const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:')) imageUrl = src;
      }
      const item = {
        title,
        price_text: lines[priceIdx],
        pack,
        available: !stockOut,
        url: href,
        image_url: imageUrl,
      };
      const key = `${title}|${lines[priceIdx]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 40) break;
    }
    return out;
  }).catch(() => []);

  const products = cards
    .map((c) => ({
      title: c.title,
      price_paise: parseRupeesToPaise(c.price_text),
      available: c.available,
      pack_size: c.pack,
      sku_url: c.url ? new URL(c.url, 'https://www.hyperpure.com/').toString() : '',
      image_url: c.image_url ? new URL(c.image_url, 'https://www.hyperpure.com/').toString() : '',
    }))
    .filter((p) => p.title && p.price_paise > 0);

  const pick = pickBest(products, query, ctx.matchRule);
  if (pick.best) {
    return {
      ok: true,
      stock_status: 'QUOTED',
      price_paise: pick.best.price_paise,
      unit_price_paise: pick.best.price_paise,
      sku_title: pick.best.title,
      sku_url: pick.best.sku_url || '',
      pack_size: pick.best.pack_size || '',
      image_url: pick.best.image_url || '',
      eta_minutes: 1440,
      eta_label: 'Hyperpure scheduled',
      match_confidence: pick.best.confidence,
      match_notes: `Hyperpure DOM via Playwright`,
      raw: { source: 'HYPERPURE', kept: pick.filtered_count, dropped: pick.dropped_count, total: pick.ranked_count, url: target },
    };
  }
  return emptyQuote(
    products.length
      ? `Hyperpure had ${products.length} SKUs but ${pick.dropped_count} were processed forms or low-confidence — no fresh match for ${query}`
      : `Hyperpure search page rendered no product cards for ${query} (may be login-gated)`,
    { source: 'HYPERPURE', card_count: products.length, url: target }
  );
}
