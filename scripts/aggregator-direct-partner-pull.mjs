#!/usr/bin/env node
import fs from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const swiggyCurlPath = args.get('--swiggy-curl') || '/Users/nihaf/Downloads/swiggy-curl.json';
const zomatoCurlPath = args.get('--zomato-curl') || '/Users/nihaf/Downloads/zomato-curl.txt';
const zomatoOrderPath = args.get('--zomato-order') || '/Users/nihaf/Downloads/zomato-orders.json';
const apiBase = args.get('--api') || 'https://hnhotels.in/api/aggregator-pulse';
const apiKey = args.get('--key') || process.env.HN_AGGREGATOR_API_KEY || process.env.HE_CLOUDFLARE_SECRETS_DASHBOARD_API_KEY;
const mode = args.get('--mode') || 'dry-run';
const skipSwiggy = args.get('--skip-swiggy') === 'true';
const zomatoBackfill = args.get('--zomato-backfill') === 'true';
const zomatoFrom = args.get('--zomato-from') || null;
const zomatoTo = args.get('--zomato-to') || null;
const zomatoLimit = Number(args.get('--zomato-limit') || 50);

if (!apiKey && mode === 'ingest') {
  throw new Error('Missing API key. Set HN_AGGREGATOR_API_KEY or pass --key.');
}

function parseCurl(path) {
  const text = fs.readFileSync(path, 'utf8');
  const url = text.match(/https?:\/\/[^\s'"]+/)?.[0]?.replace(/\\$/, '');
  if (!url) throw new Error(`No URL found in ${path}`);

  const headers = {};
  for (const match of text.matchAll(/(?:-H|--header)\s+['"]([^:'"]+):\s*([^'"]*)['"]/g)) {
    headers[match[1]] = match[2];
  }
  const cookieMatch = text.match(/(?:-b|--cookie)\s+\$?'([^']*)'/s)
    || text.match(/(?:-b|--cookie)\s+"([\s\S]*?)"/s);
  if (cookieMatch && !Object.keys(headers).some(key => key.toLowerCase() === 'cookie')) {
    headers.cookie = cookieMatch[1].replace(/\\\n/g, '').replace(/\\'/g, "'");
  }

  const dataMatch = text.match(/--data(?:-raw|-binary)?\s+\$?'([^']*)'/s)
    || text.match(/--data(?:-raw|-binary)?\s+"([\s\S]*?)"/s);
  const body = dataMatch ? dataMatch[1].replace(/\\\n/g, '').replace(/\\'/g, "'") : undefined;
  return { url, headers, body };
}

async function replayCurl(path) {
  const req = parseCurl(path);
  const response = await replayRequest(req);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { parse_error: true, sample: text.slice(0, 300) };
  }
  return { http_status: response.status, payload };
}

async function replayRequest(req, bodyOverride) {
  return fetch(req.url, {
    method: bodyOverride || req.body ? 'POST' : 'GET',
    headers: req.headers,
    body: bodyOverride || req.body,
  });
}

async function postIngest(type, payload) {
  if (mode !== 'ingest') return { skipped: true, mode };
  const url = `${apiBase}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
  return { http_status: response.status, body: await response.json() };
}

function summarizeSwiggy(payload) {
  return (payload.restaurantData || []).map(r => ({
    restaurantId: r.restaurantId,
    isOpen: r.isOpen,
    isServiceable: r.isServiceable,
    orders: (r.orders || []).map(o => ({
      order_id: o.order_id,
      status: o.status?.order_status,
      placed: o.status?.ordered_time,
      bill: o.bill,
      items: (o.cart?.items || []).map(i => `${i.quantity || 1} x ${i.name}`),
    })),
  }));
}

function summarizeZomato(payload) {
  const order = payload.order || payload;
  return {
    id: order.id,
    resId: order.resId,
    state: order.state,
    createdAt: order.createdAt,
    items: (order.cartDetails?.items?.dishes || []).map(d => `${d.quantity || 1} x ${d.name}`),
    total: order.cartDetails?.total?.amountDetails?.totalCost || null,
  };
}

function addDays(yyyyMmDd, days) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateWindows(from, toExclusive) {
  const out = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) {
    out.push([d, addDays(d, 1)]);
  }
  return out;
}

async function fetchZomatoHistoryPage(req, from, to, postbackParams = '') {
  const baseBody = req.body ? JSON.parse(req.body) : {};
  const body = {
    ...baseBody,
    limit: zomatoLimit,
    created_at: `${from},${to}`,
    postback_params: postbackParams || '',
    get_filters: postbackParams ? false : true,
  };
  const response = await replayRequest(req, JSON.stringify(body));
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { parse_error: true, sample: text.slice(0, 300) };
  }
  return { http_status: response.status, payload };
}

async function backfillZomatoHistory(path, from, toExclusive) {
  const req = parseCurl(path);
  const windows = dateWindows(from, toExclusive);
  const out = {
    from,
    to_exclusive: toExclusive,
    windows: [],
    total_snippets: 0,
    total_upserted: 0,
    failed_windows: [],
  };

  for (const [start, end] of windows) {
    let postback = '';
    let page = 0;
    let safety = 0;
    const windowOut = { from: start, to: end, pages: 0, snippets: 0, upserted: 0, has_more_final: null };
    do {
      safety++;
      page++;
      const res = await fetchZomatoHistoryPage(req, start, end, postback);
      if (res.http_status !== 200) {
        out.failed_windows.push({ from: start, to: end, page, http_status: res.http_status, keys: Object.keys(res.payload || {}) });
        break;
      }
      const snippets = Array.isArray(res.payload?.snippets) ? res.payload.snippets.length : 0;
      const ingest = snippets ? await postIngest('zomato_order_history', res.payload) : { skipped: true, reason: 'no snippets' };
      const upserted = ingest?.body?.upserted || 0;
      windowOut.pages++;
      windowOut.snippets += snippets;
      windowOut.upserted += upserted;
      out.total_snippets += snippets;
      out.total_upserted += upserted;
      windowOut.has_more_final = Boolean(res.payload?.hasMore);
      postback = res.payload?.postbackParams || res.payload?.postback_params || '';
      if (!res.payload?.hasMore || !postback) break;
    } while (safety < 20);
    if (safety >= 20) out.failed_windows.push({ from: start, to: end, reason: 'pagination safety limit' });
    out.windows.push(windowOut);
  }

  return out;
}

function collectDeep(value, predicate, limit = 20, out = []) {
  if (out.length >= limit || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectDeep(item, predicate, limit, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (predicate(key, child)) out.push({ key, value: child });
      collectDeep(child, predicate, limit, out);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function summarizeZomatoHistory(payload) {
  const snippets = Array.isArray(payload?.snippets) ? payload.snippets : [];
  return {
    hasMore: payload?.hasMore ?? null,
    snippetCount: snippets.length,
    filterCount: Array.isArray(payload?.filters) ? payload.filters.length : null,
    outletFilterCount: Array.isArray(payload?.outletFilterData) ? payload.outletFilterData.length : null,
    snippets: snippets.slice(0, 10).map((snippet, index) => {
      const ids = collectDeep(snippet, (key, value) => /^(id|orderId|order_id|orderCode|displayId)$/i.test(key) && ['string', 'number'].includes(typeof value), 8);
      const statuses = collectDeep(snippet, (key, value) => /status|state/i.test(key) && typeof value === 'string', 8);
      const amounts = collectDeep(snippet, (key, value) => /amount|total|bill/i.test(key) && ['string', 'number'].includes(typeof value), 8);
      const text = collectDeep(snippet, (key, value) => /text|title|subtitle|message|name|label/i.test(key) && typeof value === 'string', 10)
        .map(entry => entry.value)
        .filter(Boolean);
      return {
        index,
        ids,
        statuses,
        amounts,
        text,
      };
    }),
  };
}

const out = { mode, swiggy: null, zomato: null };

if (!skipSwiggy) {
  const swiggy = await replayCurl(swiggyCurlPath);
  out.swiggy = {
    replay_http_status: swiggy.http_status,
    summary: summarizeSwiggy(swiggy.payload),
    ingest: await postIngest('swiggy_fetch_orders', swiggy.payload),
  };
} else {
  out.swiggy = { skipped: true };
}

try {
  if (zomatoBackfill) {
    if (!zomatoFrom || !zomatoTo) throw new Error('Pass --zomato-from YYYY-MM-DD --zomato-to YYYY-MM-DD for backfill. --zomato-to is exclusive.');
    out.zomato = {
      backfill: await backfillZomatoHistory(zomatoCurlPath, zomatoFrom, zomatoTo),
    };
  } else {
    const zomato = await replayCurl(zomatoCurlPath);
    out.zomato = {
      replay_http_status: zomato.http_status,
      replay_top_keys: Object.keys(zomato.payload || {}),
      replay_status: zomato.payload?.status || null,
      replay_summary: summarizeZomatoHistory(zomato.payload),
      ingest: zomato.http_status === 200 ? await postIngest('zomato_order_history', zomato.payload) : null,
    };
  }
} catch (err) {
  out.zomato = { replay_error: err.message };
}

if (fs.existsSync(zomatoOrderPath)) {
  const savedOrder = JSON.parse(fs.readFileSync(zomatoOrderPath, 'utf8'));
  out.zomato.saved_order_summary = summarizeZomato(savedOrder);
  out.zomato.saved_order_ingest = await postIngest('zomato_order_detail', savedOrder);
}

console.log(JSON.stringify(out, null, 2));
