// Lightweight financial-news sentiment + symbol-tagging.
// Not BERT-grade — heuristic. Good enough for ranking/filtering at retail scale.

const POS = ['beat','beats','beating','rally','surge','jump','gain','grow','growth','expansion',
  'profit','profits','upgrade','upgraded','win','wins','order','orders','contract','contracts',
  'launch','launches','partnership','approved','dividend','bonus','buyback','record','high',
  'positive','strong','robust','outperform','breakthrough','milestone'];
const NEG = ['miss','misses','missing','fall','falls','decline','drop','crash','plunge','tumble',
  'loss','losses','downgrade','downgraded','probe','penalty','fine','litigation','lawsuit',
  'fraud','scandal','investigation','default','warning','suspension','resignation','recall',
  'bankrupt','negative','weak','disappointing','underperform','crisis','concern','risk'];

export function scoreSentiment(text) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POS) { const re = new RegExp(`\\b${w}\\b`, 'g'); pos += (t.match(re) || []).length; }
  for (const w of NEG) { const re = new RegExp(`\\b${w}\\b`, 'g'); neg += (t.match(re) || []).length; }
  const denom = Math.max(1, pos + neg);
  return Math.max(-1, Math.min(1, (pos - neg) / denom));
}

export function importanceScore(headline, source) {
  if (!headline) return 0.1;
  const h = headline.toLowerCase();
  let s = 0.3;
  if (/rbi|fed|fomc|sebi|government|budget|tariff/.test(h)) s += 0.3;
  if (/earnings|results|profit|revenue|guidance/.test(h)) s += 0.2;
  if (/merger|acquisition|ipo|delisting|bankruptcy/.test(h)) s += 0.3;
  if (/oil|crude|gold|rupee|dollar|yields/.test(h)) s += 0.15;
  if (source === 'reuters' || source === 'bloomberg') s += 0.15;
  return Math.min(1, s);
}

// Detect Indian-listed symbols from headline against a known watchlist.
// SYMBOLS is supplied via env var so we can refresh with the universe.
export function tagSymbols(text, symbolsList) {
  if (!text || !symbolsList) return [];
  const t = text.toUpperCase();
  return symbolsList.filter(s => {
    const re = new RegExp(`\\b${s}\\b`);
    return re.test(t);
  });
}

export function tagSectors(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const map = {
    BANK:    /bank|nbfc|finance|lender|loans|deposits/,
    IT:      /\b(it sector|technology|software|infosys|tcs|wipro|hcl|tech mahindra)\b/,
    AUTO:    /\b(auto|automobile|car|two-wheeler|truck|tractor|maruti|tata motors|m&m|mahindra|hero|bajaj auto|tvs|eicher)\b/,
    PHARMA:  /\b(pharma|drug|generic|cipla|sun pharma|dr reddy|lupin|aurobindo|biocon|divis)\b/,
    FMCG:    /\b(fmcg|consumer|hul|hindustan unilever|nestle|itc|britannia|dabur|marico|godrej)\b/,
    METALS:  /\b(metal|steel|aluminium|copper|tata steel|jsw|hindalco|vedanta|nmdc|coal india|nalco|sail)\b/,
    OIL:     /\b(oil|crude|petroleum|reliance|ongc|ioc|bpcl|hpcl|gail)\b/,
    REALTY:  /\b(realty|real estate|housing|dlf|godrej properties|oberoi|prestige|brigade|sobha)\b/,
    POWER:   /\b(power|electricity|ntpc|tata power|adani power|jsw energy|nhpc|powergrid|sjvn)\b/,
    CEMENT:  /\b(cement|ultratech|shree cement|ambuja|acc|jk cement|ramco|dalmia)\b/,
    DEFENCE: /\b(defence|defense|hal|bharat dynamics|bel|garden reach|mazagon|bdl)\b/,
    INFRA:   /\b(infrastructure|capex|construction|l&t|larsen|irb|gmr|gvk|adani enterprises)\b/,
  };
  return Object.entries(map).filter(([_, re]) => re.test(t)).map(([k]) => k);
}

// Minimal RSS parser using the items between <item>…</item>
export function parseRss(xml) {
  const items = [];
  const re = /<item[\s\S]*?<\/item>/g;
  const m = xml.match(re) || [];
  for (const block of m) {
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const x = block.match(r);
      if (!x) return null;
      return x[1].replace(/<!\[CDATA\[/, '').replace(/\]\]>/, '').replace(/<[^>]+>/g, '').trim();
    };
    items.push({
      title: get('title'),
      link: get('link'),
      desc: get('description') || get('summary') || '',
      pubDate: get('pubDate') || get('published') || get('dc:date'),
      guid: get('guid'),
    });
  }
  return items;
}
