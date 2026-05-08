// ─────────────────────────────────────────────────────────────────────────
// NSE Client — handles NSE's session-cookie handshake required for all APIs.
// NSE rejects requests without:
//   1. A browser-like User-Agent
//   2. A Referer pointing to nseindia.com
//   3. Session cookies seeded by hitting the homepage first
// This helper warms cookies once per Worker invocation and reuses them.
// ─────────────────────────────────────────────────────────────────────────

const NSE_HOME = 'https://www.nseindia.com';
const NSE_API = 'https://www.nseindia.com';
const NSE_ARCHIVES = 'https://nsearchives.nseindia.com';

const HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.nseindia.com/',
  'Connection': 'keep-alive',
};

export class NSEClient {
  constructor() {
    this.cookies = '';
    this.warmed = false;
    this.lastWarmAt = 0;
    this.warmTtlMs = 5 * 60 * 1000;
  }

  async warm() {
    const now = Date.now();
    if (this.warmed && now - this.lastWarmAt < this.warmTtlMs) return;
    const seedUrls = [
      `${NSE_HOME}/`,
      `${NSE_HOME}/get-quotes/equity?symbol=RELIANCE`,
      `${NSE_HOME}/option-chain`,
    ];
    const collected = [];
    for (const url of seedUrls) {
      try {
        const res = await fetch(url, {
          headers: HEADERS_BASE,
          redirect: 'follow',
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) collected.push(setCookie);
      } catch (e) {
        // best-effort cookie seeding
      }
    }
    this.cookies = collected
      .flatMap(c => c.split(/,(?=[^ ])/))
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
    this.warmed = true;
    this.lastWarmAt = now;
  }

  async getJson(path, opts = {}) {
    await this.warm();
    const url = path.startsWith('http') ? path : `${NSE_API}${path}`;
    const headers = { ...HEADERS_BASE, Cookie: this.cookies, ...(opts.headers || {}) };
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 401 || res.status === 403) {
      this.warmed = false;
      await this.warm();
      const retry = await fetch(url, {
        headers: { ...HEADERS_BASE, Cookie: this.cookies, ...(opts.headers || {}) },
        redirect: 'follow',
      });
      if (!retry.ok) throw new Error(`NSE ${path} -> ${retry.status}`);
      return retry.json();
    }
    if (!res.ok) throw new Error(`NSE ${path} -> ${res.status}`);
    return res.json();
  }

  async getBhavcopy(yyyymmdd) {
    // NSE migrated bhavcopy URL format around July 2024.
    // New format: BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip
    // Old format: cmDDMMMYYYYbhav.csv.zip (e.g. cm03MAY2024bhav.csv.zip)
    await this.warm();

    // Try new format first
    const newUrl = `${NSE_ARCHIVES}/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip`;
    let res = await fetch(newUrl, {
      headers: { ...HEADERS_BASE, Cookie: this.cookies },
      redirect: 'follow',
    });
    if (res.ok) return res.arrayBuffer();
    if (res.status !== 404) throw new Error(`NSE bhavcopy ${yyyymmdd} -> ${res.status}`);

    // Fallback to old format for pre-July 2024 dates
    const yy = yyyymmdd.slice(0, 4);
    const mm = yyyymmdd.slice(4, 6);
    const dd = yyyymmdd.slice(6, 8);
    const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][parseInt(mm) - 1];
    const oldUrl = `${NSE_ARCHIVES}/content/historical/EQUITIES/${yy}/${monthAbbr}/cm${dd}${monthAbbr}${yy}bhav.csv.zip`;
    res = await fetch(oldUrl, {
      headers: { ...HEADERS_BASE, Cookie: this.cookies },
      redirect: 'follow',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`NSE bhavcopy old format ${yyyymmdd} -> ${res.status}`);
    return res.arrayBuffer();
  }

  async getDeliveryReport(yyyymmdd, ddmmyy) {
    // sec_bhavdata_full lives at nsearchives.nseindia.com/products/content/.
    // NOTE: if NSE has not yet published the day's file (or the date is a
    // holiday with no upstream file), the request 404s. A successful 200
    // sometimes returns yesterday's contents on holidays — caller resolves
    // the actual trade date from DATE1 in the CSV body, not from yyyymmdd.
    const url = `${NSE_ARCHIVES}/products/content/sec_bhavdata_full_${ddmmyy}.csv`;
    await this.warm();
    const doFetch = () => fetch(url, {
      headers: {
        ...HEADERS_BASE,
        Cookie: this.cookies,
        // Browsers send these when downloading a CSV from a content link;
        // omitting Accept tightens the match Akamai expects on archives.
        'Accept': 'text/csv,application/vnd.ms-excel,*/*;q=0.5',
        'Referer': 'https://www.nseindia.com/all-reports',
      },
      redirect: 'follow',
    });
    let res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      // Cookie expired or rejected — re-warm once and retry.
      this.warmed = false;
      await this.warm();
      res = await doFetch();
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`NSE delivery ${yyyymmdd} -> ${res.status}`);
    return res.text();
  }
}

export function ymdHyphen(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ymdCompact(d) {
  return ymdHyphen(d).replace(/-/g, '');
}

export function ddmmyy(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd}${mm}${String(yyyy).slice(2)}`;
}

// DDMMYYYY (8 digits). Used by NSE delivery report URL pattern
// sec_bhavdata_full_DDMMYYYY.csv (different from BSE's DDMMYY).
export function ddmmyyyy(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd}${mm}${yyyy}`;
}

export function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '' || rupees === '-') return null;
  const n = typeof rupees === 'number' ? rupees : parseFloat(String(rupees).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function safeInt(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function safeFloat(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function isISTMarketDay(d) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + istOffset);
  const dow = ist.getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function istNow() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffset);
}
