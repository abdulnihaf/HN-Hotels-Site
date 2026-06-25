// ─────────────────────────────────────────────────────────────────────────────
//  Wealth — embedded reference lists (versioned, slow-churning, correct-by-construction)
//
//  Two categorizations the Stocks tab needs but D1 does NOT carry (the NFO instrument
//  dump is index-options-only, so F&O equity membership and NIFTY-50 membership can't be
//  derived live). They ARE stable, well-known reference sets, so we embed them with an
//  as-of date and intersect them against the live liquid universe at read time — any name
//  not in today's universe simply never renders, so a stale entry can never show a hole.
//
//  F&O list: NSE "securities in derivatives" (futures & options eligible equities).
//   Source: auto-published NSE-API snapshot (MaheshTechnicals/FNO-Stocks-list, rel 2026-06-04).
//   Includes a few index symbols (NIFTY/BANKNIFTY/…) that harmlessly drop out on the
//   equity intersection. ~190 equities after intersection.
//  NIFTY 50: the index constituents (Wikipedia/NSE, Dec 2025). Uses current trading
//   symbols (ETERNAL ex-ZOMATO, TMPV ex-Tata Motors PV demerger, JIOFIN, MAXHEALTH …).
//
//  Refresh: re-pull the release + index page at the next SEBI/NSE review and bump AS_OF.
// ─────────────────────────────────────────────────────────────────────────────

export const FNO_AS_OF = '2026-06';      // NSE derivatives list snapshot month
export const NIFTY50_AS_OF = '2025-12';  // NIFTY 50 constituents snapshot month

// NSE F&O (derivatives-eligible) symbols. Index symbols left in deliberately — they
// drop out when intersected with the cash-equity universe.
export const FNO_SYMBOLS = [
  '360ONE', 'ABB', 'ABCAPITAL', 'ADANIENSOL', 'ADANIENT', 'ADANIGREEN', 'ADANIPORTS', 'ADANIPOWER',
  'ALKEM', 'AMBER', 'AMBUJACEM', 'ANGELONE', 'APLAPOLLO', 'APOLLOHOSP', 'ASHOKLEY', 'ASIANPAINT',
  'ASTRAL', 'AUBANK', 'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJAJHLDNG',
  'BAJFINANCE', 'BANDHANBNK', 'BANKBARODA', 'BANKINDIA', 'BANKNIFTY', 'BDL', 'BEL', 'BHARATFORG',
  'BHARTIARTL', 'BHEL', 'BIOCON', 'BLUESTARCO', 'BOSCHLTD', 'BPCL', 'BRITANNIA', 'BSE', 'CAMS',
  'CANBK', 'CDSL', 'CGPOWER', 'CHOLAFIN', 'CIPLA', 'COALINDIA', 'COCHINSHIP', 'COFORGE', 'COLPAL',
  'CONCOR', 'CROMPTON', 'CUMMINSIND', 'DABUR', 'DALBHARAT', 'DELHIVERY', 'DIVISLAB', 'DIXON', 'DLF',
  'DMART', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 'EXIDEIND', 'FEDERALBNK', 'FINNIFTY', 'FORCEMOT',
  'FORTIS', 'GAIL', 'GLENMARK', 'GMRAIRPORT', 'GODFRYPHLP', 'GODREJCP', 'GODREJPROP', 'GRASIM',
  'GVT&D', 'HAL', 'HAVELLS', 'HCLTECH', 'HDFCAMC', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO', 'HINDALCO',
  'HINDPETRO', 'HINDUNILVR', 'HINDZINC', 'HYUNDAI', 'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'IDEA',
  'IDFCFIRSTB', 'IEX', 'INDHOTEL', 'INDIANB', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER', 'INFY',
  'INOXWIND', 'IOC', 'IREDA', 'IRFC', 'ITC', 'JINDALSTEL', 'JIOFIN', 'JSWENERGY', 'JSWSTEEL',
  'JUBLFOOD', 'KALYANKJIL', 'KAYNES', 'KEI', 'KFINTECH', 'KOTAKBANK', 'KPITTECH', 'LAURUSLABS',
  'LICHSGFIN', 'LICI', 'LODHA', 'LT', 'LTF', 'LTM', 'LUPIN', 'M&M', 'MANAPPURAM', 'MANKIND',
  'MARICO', 'MARUTI', 'MAXHEALTH', 'MAZDOCK', 'MCX', 'MFSL', 'MIDCPNIFTY', 'MOTHERSON', 'MOTILALOFS',
  'MPHASIS', 'MUTHOOTFIN', 'NAM-INDIA', 'NATIONALUM', 'NAUKRI', 'NBCC', 'NESTLEIND', 'NHPC', 'NIFTY',
  'NIFTYNXT50', 'NMDC', 'NTPC', 'NUVAMA', 'NYKAA', 'OBEROIRLTY', 'OFSS', 'OIL', 'ONGC', 'PAGEIND',
  'PATANJALI', 'PAYTM', 'PERSISTENT', 'PETRONET', 'PFC', 'PGEL', 'PHOENIXLTD', 'PIDILITIND', 'PIIND',
  'PNB', 'PNBHOUSING', 'POLICYBZR', 'POLYCAB', 'POWERGRID', 'POWERINDIA', 'PREMIERENE', 'PRESTIGE',
  'RADICO', 'RBLBANK', 'RECLTD', 'RELIANCE', 'RVNL', 'SAIL', 'SAMMAANCAP', 'SBICARD', 'SBILIFE',
  'SBIN', 'SHREECEM', 'SHRIRAMFIN', 'SIEMENS', 'SOLARINDS', 'SONACOMS', 'SRF', 'SUNPHARMA',
  'SUPREMEIND', 'SUZLON', 'SWIGGY', 'TATACONSUM', 'TATAELXSI', 'TATAPOWER', 'TATASTEEL', 'TCS',
  'TECHM', 'TIINDIA', 'TITAN', 'TMPV', 'TORNTPHARM', 'TRENT', 'TVSMOTOR', 'ULTRACEMCO', 'UNIONBANK',
  'UNITDSPR', 'UNOMINDA', 'UPL', 'VBL', 'VEDL', 'VMM', 'VOLTAS', 'WAAREEENER', 'WIPRO', 'YESBANK',
  'ZYDUSLIFE',
];

// NIFTY 50 constituents (current trading symbols).
export const NIFTY50_SYMBOLS = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJFINANCE',
  'BAJAJFINSV', 'BEL', 'BHARTIARTL', 'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL',
  'GRASIM', 'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDIGO',
  'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'MAXHEALTH', 'NESTLEIND',
  'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SHRIRAMFIN', 'SBIN', 'SUNPHARMA', 'TCS',
  'TATACONSUM', 'TMPV', 'TATASTEEL', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO',
];

// Fast-membership sets (built once at module load).
export const FNO_SET = new Set(FNO_SYMBOLS);
export const NIFTY50_SET = new Set(NIFTY50_SYMBOLS);

export function isFno(symbol) { return FNO_SET.has(symbol); }
export function isNifty50(symbol) { return NIFTY50_SET.has(symbol); }
