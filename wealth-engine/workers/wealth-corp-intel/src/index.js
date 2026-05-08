// ═══════════════════════════════════════════════════════════════════════════
// Worker: wealth-corp-intel
// Layer 4 — Corporate Intelligence (sources 24-31)
//
// 24 NSE corporate announcements    every 30 min 08:00-23:00
// 25 BSE corporate announcements    every 30 min 08:00-23:00
// 26 SEBI insider trading           daily 18:00 IST
// 27 NSE corporate actions          daily 17:00 IST
// 30 NSE shareholding pattern       quarterly + on filing
// 31 NSE pledge data                weekly Sat 11:00 IST
//
// NOTE: Sources 28 (NSE board meetings) and 29 (results calendar) moved to
// the wealth-event-scraper worker, which uses the correct bm_symbol field.
// ═══════════════════════════════════════════════════════════════════════════

import { NSEClient, ymdHyphen, istNow, isISTMarketDay, rupeesToPaise, safeInt, safeFloat } from '../../_shared/nseClient.js';
import { logCronStart, logCronEnd, markSourceHealth, batchInsert } from '../../_shared/db.js';
import { callHaiku, parseJsonOutput } from '../../_shared/anthropic.js';

const WORKER_NAME = 'wealth-corp-intel';

function hash(s) { let h = 0x811c9dc5; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;} return h.toString(16).padStart(8,'0'); }

// Heuristic materiality scorer
function materialityScore(category, subject) {
  const c = (category || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  if (/result|earnings|quarterly|annual financial/.test(c+s)) return 0.95;
  if (/order win|contract|loi|capacity|expansion|capex/.test(s)) return 0.85;
  if (/merger|acquisition|amalgamation|demerger|scheme/.test(c+s)) return 0.95;
  if (/buyback|dividend|bonus|split|rights/.test(c+s)) return 0.8;
  if (/insider trading|sast|takeover/.test(c+s)) return 0.7;
  if (/board meeting|agm|egm/.test(c+s)) return 0.5;
  if (/clarification|response|denial/.test(s)) return 0.4;
  if (/rating|outlook|credit/.test(s)) return 0.7;
  return 0.3;
}

function sentimentScore(subject) {
  const s = (subject || '').toLowerCase();
  let pos = 0, neg = 0;
  ['win','contract','order','growth','beat','expansion','approved','positive','upgrade','dividend','bonus','buyback','partnership','launch'].forEach(w => { if (s.includes(w)) pos++; });
  ['loss','decline','fall','degrade','downgrade','probe','penalty','litigation','default','warning','suspension','resignation','fraud','investigation','recall'].forEach(w => { if (s.includes(w)) neg++; });
  return Math.max(-1, Math.min(1, (pos - neg) * 0.3));
}

// ────────────────────────────────────────────────
// SOURCE 24 — NSE corporate announcements
// ────────────────────────────────────────────────
async function ingestNseAnnouncements(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  const dd = String(target.getUTCDate()).padStart(2,'0');
  const mm = String(target.getUTCMonth()+1).padStart(2,'0');
  const yyyy = target.getUTCFullYear();
  const dateStr = ymdHyphen(target);
  const fromTo = `${dd}-${mm}-${yyyy}`;
  const nse = new NSEClient();
  const data = await nse.getJson(`/api/corporate-announcements?index=equities&from_date=${fromTo}&to_date=${fromTo}`);
  const items = Array.isArray(data) ? data : (data?.data || []);
  const ingestedAt = Date.now();
  const rows = items.map(d => {
    const symbol = (d.symbol || '').trim().toUpperCase();
    const subject = (d.desc || d.subject || d.sub || '').trim();
    const category = (d.smIndustry || d.attchmntFile || d.category || '').trim();
    const annTime = Date.parse(d.an_dt || d.announcementDate || d.exchdisstime) || ingestedAt;
    const id = hash(`NSE|${symbol}|${annTime}|${subject}`);
    return {
      id, exchange: 'NSE', symbol, ann_time: annTime,
      category, subject, details: (d.attchmntText || '').slice(0, 2000),
      attachment_url: d.attchmntFile || null,
      parsed_keywords: null,
      sentiment_score: sentimentScore(subject),
      materiality_score: materialityScore(category, subject),
      ingested_at: ingestedAt,
    };
  }).filter(r => r.symbol);
  const cols = ['id','exchange','symbol','ann_time','category','subject','details','attachment_url',
    'parsed_keywords','sentiment_score','materiality_score','ingested_at'];
  const written = await batchInsert(env.DB, 'corp_announcements', cols, rows, 'IGNORE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 25 — BSE corporate announcements
// ────────────────────────────────────────────────
async function ingestBseAnnouncements(env, dateOverride) {
  const target = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : istNow();
  const yyyymmdd = `${target.getUTCFullYear()}${String(target.getUTCMonth()+1).padStart(2,'0')}${String(target.getUTCDate()).padStart(2,'0')}`;
  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?strCat=-1&strPrevDate=${yyyymmdd}&strScrip=&strSearch=P&strToDate=${yyyymmdd}&strType=C`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.bseindia.com/corporates/ann.html',
    },
  });
  if (!res.ok) throw new Error(`BSE ann ${res.status}`);
  const j = await res.json();
  const items = j?.Table || [];
  const ingestedAt = Date.now();
  const rows = items.map(d => {
    const symbol = (d.SCRIP_CD || d.SLONGNAME || '').toString().trim();
    const subject = (d.HEADLINE || d.NEWSSUB || '').trim();
    const category = (d.CATEGORYNAME || '').trim();
    const annTime = Date.parse(d.NEWS_DT || d.News_submission_dt) || ingestedAt;
    const id = hash(`BSE|${symbol}|${annTime}|${subject}`);
    return {
      id, exchange: 'BSE', symbol, ann_time: annTime,
      category, subject, details: (d.MORE || '').slice(0, 2000),
      attachment_url: d.ATTACHMENTNAME ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${d.ATTACHMENTNAME}` : null,
      parsed_keywords: null,
      sentiment_score: sentimentScore(subject),
      materiality_score: materialityScore(category, subject),
      ingested_at: ingestedAt,
    };
  }).filter(r => r.symbol);
  const cols = ['id','exchange','symbol','ann_time','category','subject','details','attachment_url',
    'parsed_keywords','sentiment_score','materiality_score','ingested_at'];
  const written = await batchInsert(env.DB, 'corp_announcements', cols, rows, 'IGNORE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 26 — SEBI insider trading (NSE PIT — current-day filings)
// ────────────────────────────────────────────────
async function ingestNseInsiderTrades(env) {
  const nse = new NSEClient();
  const data = await nse.getJson('/api/corporates-pit?index=equities');
  const items = data?.data || [];
  const ingestedAt = Date.now();
  const rows = items.map(d => {
    const symbol = (d.symbol || '').trim();
    const id = hash(`NSE|${symbol}|${d.acqName||''}|${d.date||''}|${d.secAcq||d.totalShares||''}`);
    return {
      id, symbol,
      person_name: d.acqName || d.personName,
      designation: d.personCategory || null,
      txn_type: (d.tdpTransactionType || '').toLowerCase().includes('buy') ? 'buy' : 'sell',
      qty: safeInt(d.secAcq || d.totalShares),
      value_paise: rupeesToPaise(d.secVal || d.tdpTransactionValue || d.value),
      txn_date: d.date || null,
      filed_date: d.intimDate || null,
      reg_compliance: d.anex || d.tdpDpId || null,
      ingested_at: ingestedAt,
    };
  }).filter(r => r.symbol);
  const cols = ['id','symbol','person_name','designation','txn_type','qty','value_paise',
    'txn_date','filed_date','reg_compliance','ingested_at'];
  const written = await batchInsert(env.DB, 'insider_trades', cols, rows, 'IGNORE');
  return { rows: written, source: 'nse', items: items.length };
}

// ────────────────────────────────────────────────
// SOURCE 26b — BSE insider trading (PIT Reg 7 disclosures from BSE PIT/SAST feed)
// Mines BSE "Insider Trading / SAST" announcement category for Reg 7 (PIT) headlines.
// Headlines do not always carry qty/value — those are stored as null; person_name
// is parsed from the headline tail when present.
// ────────────────────────────────────────────────
function bseDateRange(daysBack) {
  const now = istNow();
  const from = new Date(now.getTime() - daysBack * 86400000);
  const fmt = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
  return { from: fmt(from), to: fmt(now) };
}

async function fetchBsePitFeed(daysBack = 7, maxPages = 10) {
  const { from, to } = bseDateRange(daysBack);
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?strCat=Insider+Trading+%2F+SAST&strPrevDate=${from}&strToDate=${to}&strScrip=&strSearch=P&strType=C&pageno=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0',
        'Referer': 'https://www.bseindia.com/corporates/ann.html',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`BSE PIT page ${page} -> ${res.status}`);
    const j = await res.json();
    const rows = j?.Table || [];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < 50) break; // last page
  }
  return all;
}

function parseBsePitHeadline(headline) {
  // Example: "...Reg 7(2) of SEBI (PIT) Regulations 2015 ... for John Doe"
  const m = headline.match(/\bfor\s+([A-Z][A-Za-z .&'\-]{2,80})$/);
  return m ? m[1].trim() : null;
}

async function ingestBseInsiderTrades(env, daysBack = 7) {
  const items = await fetchBsePitFeed(daysBack, 10);
  const ingestedAt = Date.now();
  const rows = items
    .filter(r => {
      const h = (r.HEADLINE || '').toLowerCase();
      // Reg 7 = PIT insider trades.  exclude Reg 29 (SAST takeover) and Reg 31 (pledge)
      return /\breg(?:ulation)?\.?\s*7\b/.test(h) || /\bpit\s+regulation/.test(h);
    })
    .map(d => {
      const symbol = String(d.SCRIP_CD || '').trim();
      const headline = (d.HEADLINE || '').trim();
      const annTime = Date.parse(d.NEWS_DT || d.News_submission_dt) || ingestedAt;
      const id = hash(`BSE|${symbol}|PIT|${annTime}|${headline.slice(0,80)}`);
      const personName = parseBsePitHeadline(headline) || d.SLONGNAME;
      return {
        id, symbol,
        person_name: personName,
        designation: 'BSE-Reg7',
        txn_type: /\bsell\b|\bdisposal\b|\boff-?market sale\b/i.test(headline) ? 'sell'
                : /\bbuy\b|\bacquisition\b|\bpurchase\b/i.test(headline) ? 'buy'
                : null,
        qty: null,
        value_paise: null,
        txn_date: (d.NEWS_DT || '').slice(0, 10),
        filed_date: (d.NEWS_DT || '').slice(0, 10),
        reg_compliance: 'Reg 7 (PIT)',
        ingested_at: ingestedAt,
      };
    })
    .filter(r => r.symbol);
  const cols = ['id','symbol','person_name','designation','txn_type','qty','value_paise',
    'txn_date','filed_date','reg_compliance','ingested_at'];
  const written = await batchInsert(env.DB, 'insider_trades', cols, rows, 'IGNORE');
  return { rows: written, source: 'bse', items: items.length, matched: rows.length };
}

// Combined daily run — NSE PIT (current-day) + BSE PIT (last 7 days backfill).
// Cron entry point.  Used for both daily refresh and on-demand backfill.
async function ingestInsiderTrades(env, dateOverride) {
  const days = dateOverride && /^\d+$/.test(dateOverride) ? Number(dateOverride) : 7;
  const out = { rows: 0, sources: {} };
  try {
    const r = await ingestNseInsiderTrades(env);
    out.sources.nse = r;
    out.rows += r.rows || 0;
  } catch (e) { out.sources.nse = { error: String(e).slice(0, 200) }; }
  try {
    const r = await ingestBseInsiderTrades(env, days);
    out.sources.bse = r;
    out.rows += r.rows || 0;
  } catch (e) { out.sources.bse = { error: String(e).slice(0, 200) }; }
  return out;
}

// ────────────────────────────────────────────────
// SOURCE 27 — NSE corporate actions
// ────────────────────────────────────────────────
async function ingestCorpActions(env) {
  const nse = new NSEClient();
  const data = await nse.getJson('/api/corporates-corporateActions?index=equities');
  const items = data || [];
  const rows = items.map(d => {
    const symbol = (d.symbol || '').trim();
    const id = hash(`${symbol}|${d.subject||''}|${d.exDate||''}`);
    const subject = (d.subject || '').toLowerCase();
    let actionType = 'other';
    if (subject.includes('dividend')) actionType = 'dividend';
    else if (subject.includes('split')) actionType = 'split';
    else if (subject.includes('bonus')) actionType = 'bonus';
    else if (subject.includes('rights')) actionType = 'rights';
    else if (subject.includes('buyback')) actionType = 'buyback';
    return {
      id, symbol,
      action_type: actionType,
      ratio: d.subject || null,
      amount_paise: null,
      ex_date: d.exDate || null,
      record_date: d.recDate || null,
      announcement_date: d.bcStartDate || null,
    };
  }).filter(r => r.symbol);
  const cols = ['id','symbol','action_type','ratio','amount_paise','ex_date','record_date','announcement_date'];
  const written = await batchInsert(env.DB, 'corp_actions', cols, rows, 'IGNORE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 30 — NSE shareholding pattern
// ────────────────────────────────────────────────
async function ingestShareholding(env) {
  // Quarterly — pull list of recently filed and store rolling state.
  const nse = new NSEClient();
  const data = await nse.getJson('/api/corporate-share-holdings-master?index=equities');
  const items = data?.data || [];
  const rows = items.map(d => ({
    symbol: (d.symbol || '').trim(),
    quarter_end: d.dateEndingHolding || d.quarter || null,
    promoter_pct: safeFloat(d.promoter || d.promoterAndPromoterGroup),
    fii_pct: safeFloat(d.fii),
    dii_pct: safeFloat(d.dii),
    public_pct: safeFloat(d.publicShareholding),
    mf_pct: safeFloat(d.mutualFunds),
    insurance_pct: safeFloat(d.insuranceCompanies),
  })).filter(r => r.symbol && r.quarter_end);
  const cols = ['symbol','quarter_end','promoter_pct','fii_pct','dii_pct','public_pct','mf_pct','insurance_pct'];
  const written = await batchInsert(env.DB, 'shareholding_pattern', cols, rows, 'REPLACE');
  return { rows: written };
}

// ────────────────────────────────────────────────
// SOURCE 31 — NSE pledge data (filings, current snapshot)
// ────────────────────────────────────────────────
async function ingestNsePledge(env) {
  const nse = new NSEClient();
  const data = await nse.getJson('/api/corporate-pledgedata?index=equities');
  const items = data?.data || [];
  const rows = items.map(d => ({
    symbol: (d.symbol || '').trim(),
    filing_date: (d.date || d.filingDate || '').slice(0, 10),
    pledged_qty: safeInt(d.pledgedShares),
    pledged_pct: safeFloat(d.pledgedShareholdersPercentage || d.totalPledgedShares),
    encumbered_pct: safeFloat(d.encumberedShares),
  })).filter(r => r.symbol && r.filing_date);
  const cols = ['symbol','filing_date','pledged_qty','pledged_pct','encumbered_pct'];
  const written = await batchInsert(env.DB, 'promoter_pledge', cols, rows, 'REPLACE');
  return { rows: written, source: 'nse', items: items.length };
}

// ────────────────────────────────────────────────
// SOURCE 31b — BSE pledge filings (Reg 31 SAST disclosures)
// BSE PIT/SAST feed carries Reg 31(1) and 31(2) filings — these are pledge
// disclosures by promoters.  The headline does not carry pct/qty (those are in
// the linked PDF), so we record the filing event with null numeric fields.
// Downstream cascade detector can use filing-event count over a window as a
// proxy for pledge-spike risk when numeric pct is unavailable.
// ────────────────────────────────────────────────
function isPledgeHeadline(h) {
  const s = (h || '').toLowerCase();
  // Reg 31 specifically = pledge encumbrance.  exclude Reg 29 (acquisition) and Reg 7 (PIT).
  if (/\breg(?:ulation)?\.?\s*31\b/.test(s)) return true;
  if (/\bpledge\b|\bencumbr/.test(s)) return true;
  if (/\binvocation of pledge\b|\binvoke.{0,20}pledge\b/.test(s)) return true;
  return false;
}

function parsePledgePctFromHeadline(h) {
  // Some headlines do include "X% of total share capital".
  const m = h.match(/(\d+\.?\d*)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

async function ingestBsePledge(env, daysBack = 7) {
  const items = await fetchBsePitFeed(daysBack, 10);
  // Dedupe by (symbol, ISO-date) — multiple filings same day collapse into one event.
  // Within a same-day group, prefer the row that carries a parseable pct.
  const byKey = new Map();
  for (const d of items) {
    const headline = (d.HEADLINE || '').trim();
    if (!isPledgeHeadline(headline)) continue;
    const symbol = String(d.SCRIP_CD || '').trim();
    if (!symbol) continue;
    const filingDate = (d.NEWS_DT || d.News_submission_dt || '').slice(0, 10);
    if (!filingDate || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    const key = `${symbol}|${filingDate}`;
    const pct = parsePledgePctFromHeadline(headline);
    const existing = byKey.get(key);
    if (!existing || (pct !== null && existing.pledged_pct === null)) {
      byKey.set(key, {
        symbol,
        filing_date: filingDate,
        pledged_qty: null,
        pledged_pct: pct,
        encumbered_pct: null,
      });
    }
  }
  const rows = Array.from(byKey.values());
  const cols = ['symbol','filing_date','pledged_qty','pledged_pct','encumbered_pct'];
  const written = await batchInsert(env.DB, 'promoter_pledge', cols, rows, 'REPLACE');
  return { rows: written, source: 'bse', items: items.length, matched: rows.length };
}

// Combined daily run — NSE pledgedata + BSE Reg 31 filings (last N days).
// Cron entry point and HTTP-trigger entry point.
async function ingestPledge(env, dateOverride) {
  const days = dateOverride && /^\d+$/.test(dateOverride) ? Number(dateOverride) : 7;
  const out = { rows: 0, sources: {} };
  try {
    const r = await ingestNsePledge(env);
    out.sources.nse = r;
    out.rows += r.rows || 0;
  } catch (e) { out.sources.nse = { error: String(e).slice(0, 200) }; }
  try {
    const r = await ingestBsePledge(env, days);
    out.sources.bse = r;
    out.rows += r.rows || 0;
  } catch (e) { out.sources.bse = { error: String(e).slice(0, 200) }; }
  return out;
}

// ────────────────────────────────────────────────
// Concall transcript analyzer (Feature 3)
//
// Companies post Q4 transcripts on their websites within 24-48 hr of the call.
// We don't yet have a generic scraper for arbitrary URLs (each company's
// website is different); for now this function accepts a transcript blob
// + symbol via HTTP and runs Claude analysis on it. Future: auto-discovery
// from BSE concall PDFs.
//
// Cost: ~5K input + ~300 output tokens per call = ~$0.0065 = ₹0.55
// ────────────────────────────────────────────────
async function analyzeConcall(env, opts = {}) {
  const { symbol, transcript, fiscal_period = 'unknown', transcript_url = null } = opts;
  if (!symbol || !transcript) return { rows: 0, error: 'symbol + transcript required' };
  if (transcript.length < 200) return { rows: 0, error: 'transcript too short' };

  // Truncate to ~5K tokens (~20K chars) — focus on management commentary
  const truncated = transcript.slice(0, 20000);

  const system = `You are a senior Indian equity analyst extracting management tone from Q4/quarterly earnings call transcripts. Output ONLY a JSON object — no prose.`;

  const userPrompt = `Symbol: ${symbol}
Period: ${fiscal_period}

Transcript (truncated to first 20K chars):
${truncated}

---
Extract and output JSON in EXACTLY this shape:

{
  "tone_score": -1.0 to 1.0,
  "revenue_outlook": "1-2 sentence summary of management's revenue guidance/commentary",
  "margin_commentary": "1-2 sentence summary of margin trends + outlook",
  "capex_plans": "1-2 sentence summary of capex/investment plans",
  "cautionary_notes": "1-2 sentence summary of any risks/concerns management flagged",
  "raw_summary": "3-line big-picture summary"
}

tone_score: -1.0 = very defensive/negative, 0.0 = neutral/factual, +1.0 = very confident/upbeat. Be conservative — most calls are 0 to +0.3 unless management is explicitly bullish or worried.`;

  const result = await callHaiku(env, {
    prompt: userPrompt,
    system,
    max_tokens: 600,
    purpose: 'concall_analysis',
    worker: WORKER_NAME,
    cache_key: `concall_${symbol}_${fiscal_period}_${transcript.length}`,
    cache_ttl_ms: 90 * 86400000, // 90 days — concalls don't re-interpret
  });

  const parsed = parseJsonOutput(result.text);
  if (!parsed) return { rows: 0, error: 'LLM returned non-JSON', raw: result.text.slice(0, 200) };

  // Persist
  await env.DB.prepare(`
    INSERT INTO concall_analysis
      (symbol, fiscal_period, transcript_url, analyzed_at,
       tone_score, revenue_outlook, margin_commentary, capex_plans, cautionary_notes, raw_summary, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    symbol, fiscal_period, transcript_url, Date.now(),
    parsed.tone_score || 0,
    (parsed.revenue_outlook || '').slice(0, 500),
    (parsed.margin_commentary || '').slice(0, 500),
    (parsed.capex_plans || '').slice(0, 500),
    (parsed.cautionary_notes || '').slice(0, 500),
    (parsed.raw_summary || '').slice(0, 1000),
    'manual_upload'
  ).run();

  return {
    rows: 1,
    symbol,
    fiscal_period,
    tone_score: parsed.tone_score,
    cost_paise: result.cost_paise,
    cached: result.cached,
    summary: parsed,
  };
}

// ────────────────────────────────────────────────
// Unique cron expressions only — Cloudflare cron-key collision bug requires
// every cron entry to have a different expression.
const CRON_DISPATCH = {
  // Announcements stream — high frequency
  '*/5 2-17 * * *':    { name: 'nse_announcements', fn: ingestNseAnnouncements },     // every 5 min 08:00-23:00 IST
  '2-57/5 2-17 * * *': { name: 'bse_announcements', fn: ingestBseAnnouncements },     // every 5 min offset 2 min
  // EOD reports — staggered minutes to keep cron expressions unique
  '30 11 * * 1-5':     { name: 'corp_actions',      fn: ingestCorpActions },          // 17:00 IST
  '30 12 * * 1-5':     { name: 'insider_trades',    fn: ingestInsiderTrades },        // 18:00 IST  (NSE PIT + BSE Reg 7)
  '5 13 * * 1-5':      { name: 'pledge',            fn: ingestPledge },               // 18:35 IST  (NSE pledgedata + BSE Reg 31), daily
  // Weekly slow-update sources
  '0 13 * * 6':        { name: 'shareholding',      fn: ingestShareholding },         // Sat 18:30 IST
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
  nse_announcements: ingestNseAnnouncements,
  bse_announcements: ingestBseAnnouncements,
  insider_trades:    ingestInsiderTrades,
  promoter_pledge:   ingestPledge,    // alias matching D1 table name
  pledge:            ingestPledge,
  concall_analyze:   analyzeConcall,  // POST { symbol, transcript, fiscal_period, transcript_url }
  bse_insider:       (env, d) => ingestBseInsiderTrades(env, d && /^\d+$/.test(d) ? Number(d) : 7),
  bse_pledge:        (env, d) => ingestBsePledge(env, d && /^\d+$/.test(d) ? Number(d) : 7),
  nse_insider:       ingestNseInsiderTrades,
  nse_pledge:        ingestNsePledge,
  corp_actions:      ingestCorpActions,
  shareholding:      ingestShareholding,
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
        let r;
        // concall_analyze takes a POST body with { symbol, transcript, ... }
        if (m[1] === 'concall_analyze' && request.method === 'POST') {
          const body = await request.json();
          r = await analyzeConcall(env, body);
        } else {
          r = await HTTP_HANDLERS[m[1]](env, url.searchParams.get('date'));
        }
        await logCronEnd(env.DB, id, 'success', r.rows || 0, null);
        return Response.json({ ok: true, ...r });
      } catch (e) {
        await logCronEnd(env.DB, id, 'failed', 0, String(e));
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return new Response('wealth-corp-intel', { status: 200 });
  },
};
