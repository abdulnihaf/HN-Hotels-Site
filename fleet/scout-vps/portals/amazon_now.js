// Amazon Now adapter — server-rendered HTML through DataImpulse proxy.
// Akamai/Amazon CAPTCHA doesn't fire for vanilla HTTPS through residential
// IPs at our volume. Parse the s-search-result divs for ASIN + title + price.

import { ProxyAgent } from 'undici';
import { pickBest, emptyQuote, errorQuote } from '../utils.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function buildCookieHeader(session) {
  const cookies = Array.isArray(session?.cookies) ? session.cookies : [];
  return cookies
    .filter((c) => c?.name && c?.value !== undefined && c.value !== null && c.value !== '')
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function parseProducts(html) {
  // Each product wraps in a div with data-asin="<ASIN>" and
  // data-component-type="s-search-result"
  const products = [];
  const blockRe = /<div[^>]*data-asin="([A-Z0-9]{6,15})"[^>]*data-component-type="s-search-result"[^>]*>([\s\S]*?)(?=<div[^>]*data-asin="[A-Z0-9]{6,15}"[^>]*data-component-type="s-search-result"|<div[^>]*class="s-pagination[^"]*"|$)/g;
  let m;
  let count = 0;
  while ((m = blockRe.exec(html)) !== null && count < 60) {
    const asin = m[1];
    const block = m[2];
    if (asin === 'B0XXXXXXXX' || asin.length < 6) continue;

    // Title — usually inside <h2> ... <span>...</span></h2>
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Price — <span class="a-price"...> contains <span class="a-offscreen">₹...</span>
    // a-offscreen has the canonical price text "₹123.45"
    const priceMatch = block.match(/<span class="a-offscreen">\s*₹\s*([\d,]+(?:\.\d+)?)\s*<\/span>/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

    // Stock — explicit out-of-stock markers
    const outOfStock = /Currently unavailable|Out of stock|Temporarily out of stock|See available choices/i.test(block);

    // Product URL
    const hrefMatch = block.match(/<a[^>]*class="a-link-normal[^"]*s-no-outline"[^>]*href="([^"]+)"/)
      || block.match(/<a[^>]*class="[^"]*s-line-clamp[^"]*"[^>]*href="([^"]+)"/)
      || block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/);
    let url = hrefMatch ? hrefMatch[1] : '';
    if (url && !url.startsWith('http')) url = `https://www.amazon.in${url}`;

    // Image — Amazon search renders product thumbs as <img class="s-image" src="...">
    // Fall back to any media-amazon.com images src in the block.
    const imgMatch = block.match(/<img[^>]*class="[^"]*s-image[^"]*"[^>]*src="([^"]+)"/)
      || block.match(/<img[^>]*src="(https?:\/\/m\.media-amazon\.com\/images\/[^"]+)"/);
    let imageUrl = imgMatch ? imgMatch[1] : '';
    if (imageUrl.startsWith('data:')) imageUrl = '';
    if (imageUrl && !imageUrl.startsWith('http')) {
      try { imageUrl = new URL(imageUrl, 'https://www.amazon.in/').toString(); } catch (_) { imageUrl = ''; }
    }

    if (title && price > 0) {
      products.push({ asin, title, price, url, image_url: imageUrl, available: !outOfStock });
      count += 1;
    }
  }
  return products;
}

async function fetchAmazonHtml(query, session) {
  const proxy = process.env.DATAIMPULSE_PROXY_URL;
  if (!proxy) throw new Error('DATAIMPULSE_PROXY_URL not set on VPS');
  const dispatcher = new ProxyAgent(proxy);

  const url = `https://www.amazon.in/s?k=${encodeURIComponent(query)}&i=nowstore`;
  const cookieHeader = buildCookieHeader(session);

  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const res = await fetch(url, { headers, dispatcher });
  const body = await res.text();
  if (!res.ok) throw new Error(`Amazon HTTP ${res.status}`);
  if (/validateCaptcha|Type the characters you see/i.test(body)) {
    throw new Error('Amazon CAPTCHA challenge served');
  }
  return body;
}

async function scoutAmazonNowDirect({ session, ctx }) {
  const query = ctx.searchQuery;
  let html;
  try {
    html = await fetchAmazonHtml(query, session);
  } catch (err) {
    return errorQuote(`Amazon Now fetch failed: ${err.message}`, { source: 'AMAZON_NOW' });
  }

  const products = parseProducts(html);
  if (!products.length) {
    return emptyQuote(`Amazon Now returned no parseable products for ${query}`, {
      source: 'AMAZON_NOW',
      html_size: html.length,
    });
  }

  const candidates = products.map((p) => ({
    title: p.title,
    price_paise: Math.round(p.price * 100),
    available: p.available,
    pack_size: '',
    sku_url: p.url,
    image_url: p.image_url || '',
  })).filter((c) => c.title && c.price_paise > 0);

  const pick = pickBest(candidates, query, ctx.matchRule);
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
      eta_minutes: 120,
      eta_label: 'Amazon Now',
      match_confidence: pick.best.confidence,
      match_notes: 'Amazon Now HTML via DataImpulse proxy',
      raw: {
        source: 'AMAZON_NOW',
        kept: pick.filtered_count,
        dropped: pick.dropped_count,
        total: pick.ranked_count,
        product_count: products.length,
      },
    };
  }
  return emptyQuote(
    candidates.length
      ? `Amazon Now had ${candidates.length} SKUs but none passed filters for ${query}`
      : `Amazon Now parsed no products for ${query}`,
    { source: 'AMAZON_NOW', candidate_count: candidates.length, html_size: html.length }
  );
}

export const scoutAmazonNow = scoutAmazonNowDirect;
export const direct = true;
