// Zepto adapter — stealth Playwright + DataImpulse residential proxy.
// Akamai _abck blocks vanilla Chromium and curl, but stealth Playwright
// (playwright-extra + stealth plugin) matches real Chrome's fingerprint
// closely enough to pass. We render the search page, then DOM-scrape
// product cards directly (no XHR interception needed — products are
// visible by the time we wait 4-5s after DOMContentLoaded).

import { pickBest, emptyQuote, errorQuote } from '../utils.js';

export async function scoutZeptoStealth({ page, ctx }) {
  const query = ctx.searchQuery;
  const url = `https://www.zepto.com/search?query=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
  } catch (err) {
    return errorQuote(`Zepto navigation failed: ${err.message}`, { source: 'ZEPTO' });
  }

  const blocked = await page.evaluate(() => {
    const t = (document.body?.innerText || '').slice(0, 600);
    return /access denied|blocked|captcha|are you human/i.test(t);
  });
  if (blocked) {
    return emptyQuote('Zepto served block page despite stealth+proxy', { source: 'ZEPTO' });
  }

  // Card detection: Zepto's product tiles render text like
  //   "ADD ₹38 ₹133 ₹95 OFF Carrot Local 500 g Buy Again"
  // First ₹ = selling price, second ₹ = MRP, third ₹ = discount amount.
  const cards = await page.$$eval('*', (nodes) => {
    function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
    const out = [];
    const seen = new Set();
    for (const el of nodes) {
      const text = el.innerText || '';
      if (!text.includes('₹')) continue;
      if (text.length < 20 || text.length > 700) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.width > 600 || r.height < 80 || r.height > 600) continue;
      const c = clean(text);
      // Filter the range filter widget like "₹28 - ₹107 Minimum value..."
      if (/Minimum value|Maximum value/i.test(c)) continue;
      // Skip cart "Your cart is empty" type widgets
      if (/Your cart is empty/i.test(c)) continue;
      if (!/ADD|Buy/i.test(c)) continue;
      const key = c.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      const imgEl = el.querySelector?.('img[src], img[data-src]');
      let imageUrl = '';
      if (imgEl) {
        const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:')) imageUrl = src;
      }
      out.push({ text: c, rect: { w: Math.round(r.width), h: Math.round(r.height) }, image_url: imageUrl });
      if (out.length >= 30) break;
    }
    return out;
  }).catch(() => []);

  // Parse each card's text into title + price + pack
  const products = cards.map((c) => {
    const text = c.text;
    // Card text format: "ADD ₹SP ₹MRP ₹OFF_AMOUNT OFF <Title> <Pack> Buy Again"
    // The FIRST ₹ value is always the selling price.
    const rs = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)]
      .map((m) => Number(m[1].replace(/,/g, '')))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!rs.length) return null;
    const price = rs[0];
    // Pack
    const packMatch = text.match(/\b\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|ml|l|ltr|litre|pcs|pc|pack)\b/i);
    const pack = packMatch ? packMatch[0] : '';
    // Title — strip all rupee values + their trailing OFF + ADD/Buy actions + percent off
    let title = text
      .replace(/₹\s*[\d,]+(?:\.\d+)?\s*OFF/gi, '')
      .replace(/₹\s*[\d,]+(?:\.\d+)?/g, '')
      .replace(/\b\d+%\s*OFF\b/gi, '')
      .replace(/\bADD\s*MORE\b/gi, '')
      .replace(/\bBuy Again\b/gi, '')
      .replace(/^\s*ADD\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (pack) title = title.replace(pack, '').replace(/\s+/g, ' ').trim();
    const outOfStock = /out of stock|notify me/i.test(text);
    return { title, price, pack, available: !outOfStock, image_url: c.image_url || '' };
  }).filter(Boolean);

  if (!products.length) {
    return emptyQuote(`Zepto rendered no parseable product cards for ${query}`, { source: 'ZEPTO', card_count: cards.length });
  }

  const candidates = products.map((p) => ({
    title: p.title,
    price_paise: Math.round(p.price * 100),
    available: p.available,
    pack_size: p.pack,
    sku_url: '',
    image_url: p.image_url ? (() => { try { return new URL(p.image_url, 'https://www.zepto.com/').toString(); } catch (_) { return ''; } })() : '',
  })).filter((c) => c.title && c.price_paise > 0);

  const pick = pickBest(candidates, query, ctx.matchRule);
  if (pick.best) {
    return {
      ok: true,
      stock_status: 'QUOTED',
      price_paise: pick.best.price_paise,
      unit_price_paise: pick.best.price_paise,
      sku_title: pick.best.title,
      sku_url: '',
      pack_size: pick.best.pack_size || '',
      image_url: pick.best.image_url || '',
      eta_minutes: 15,
      eta_label: '~15 min',
      match_confidence: pick.best.confidence,
      match_notes: 'Zepto DOM via stealth Playwright + DataImpulse',
      raw: {
        source: 'ZEPTO',
        kept: pick.filtered_count,
        dropped: pick.dropped_count,
        total: pick.ranked_count,
        card_count: cards.length,
      },
    };
  }
  return emptyQuote(
    candidates.length ? `Zepto had ${candidates.length} SKUs but none passed filters for ${query}` : `Zepto returned no usable cards for ${query}`,
    { source: 'ZEPTO', candidate_count: candidates.length, card_count: cards.length }
  );
}

export const scoutZepto = scoutZeptoStealth;
export const stealth = true;
