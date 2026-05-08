// ─────────────────────────────────────────────────────────────────────────
// Yahoo Finance — backup EOD source + global cross-asset (DXY, VIX, etc).
// No auth needed. Subject to soft rate limits, so backfill in batches of 50.
// ─────────────────────────────────────────────────────────────────────────

const YH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

export async function yahooChart(symbol, { range = '1d', interval = '1d', period1, period2 } = {}) {
  const params = new URLSearchParams();
  if (period1 && period2) {
    params.set('period1', String(Math.floor(period1 / 1000)));
    params.set('period2', String(Math.floor(period2 / 1000)));
  } else {
    params.set('range', range);
  }
  params.set('interval', interval);
  params.set('includePrePost', 'false');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetch(url, { headers: YH_HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${symbol} -> ${res.status}`);
  const j = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    out.push({
      ts: ts[i] * 1000,
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close: q.close[i],
      volume: q.volume?.[i] ?? null,
    });
  }
  return out;
}

export async function yahooEodIN(symbol, fromMs, toMs) {
  return yahooChart(`${symbol}.NS`, { interval: '1d', period1: fromMs, period2: toMs });
}
