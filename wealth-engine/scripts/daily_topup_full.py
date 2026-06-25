#!/usr/bin/env python3
# Nightly incremental top-up for the FULL liquid universe (universe_full.txt).
# Appends the latest ~12 days of EOD + 5-min bars per symbol into bt.db so the
# walk-forward backtest always trains on data through yesterday. Idempotent
# (INSERT OR REPLACE), niced, gentle. Reads via OUR proxy (no raw Kite creds).
import os, time, json, sqlite3, urllib.request, urllib.parse, datetime as dt
WS = os.path.expanduser("~/hn-wealth-backtest")
KEY = [l.split("=", 1)[1].strip() for l in open(os.path.join(WS, ".env")) if l.startswith("DASHBOARD_API_KEY=")][0]
BASE = "https://trade.hnhotels.in"
UNIV = os.path.join(WS, "universe_full.txt")
if not os.path.exists(UNIV):
    UNIV = os.path.join(WS, "universe.txt")     # fallback to the original 198
PAIRS = open(UNIV).read().split()
today = dt.date.today()
frm_eod = (today - dt.timedelta(days=20)).isoformat()
frm5 = (today - dt.timedelta(days=12))
db = sqlite3.connect(os.path.join(WS, "bt.db"))
db.execute("PRAGMA journal_mode=WAL")

def get(u, t=3):
    for i in range(t):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"x-api-key": KEY, "User-Agent": "hn-wealth-topup/1.0"}), timeout=35) as r:
                return json.load(r)
        except Exception as e:
            if i == t - 1: return {"_err": str(e)}
            time.sleep(1.2 * (i + 1))

ne = nb = 0
for p in PAIRS:
    sym, tok = p.rsplit(":", 1)
    j = get(f"{BASE}/api/trading?action=eod&symbol={urllib.parse.quote(sym)}&from={frm_eod}&to={today.isoformat()}")
    rows = j.get("rows", []) if isinstance(j, dict) else []
    db.executemany("INSERT OR REPLACE INTO eod VALUES(?,?,?,?,?,?,?,?,?)",
        [(sym, r["trade_date"], r.get("open_paise"), r.get("high_paise"), r.get("low_paise"),
          r.get("close_paise"), r.get("prev_close_paise"), r.get("volume"), r.get("delivery_pct")) for r in rows]); ne += len(rows)
    frm = f"{frm5.isoformat()} 09:15:00"; to = f"{today.isoformat()} 15:30:00"
    j = get(f"{BASE}/api/kite?action=historical&instrument_token={tok}&interval=5minute&from={urllib.parse.quote(frm)}&to={urllib.parse.quote(to)}")
    candles = (j.get("data") or {}).get("candles", []) if isinstance(j, dict) else []
    recs = []
    for c in candles:
        d0 = dt.datetime.fromisoformat(c[0])
        recs.append((sym, int(d0.timestamp() * 1000), d0.date().isoformat(),
                     round(c[1] * 100), round(c[2] * 100), round(c[3] * 100), round(c[4] * 100), c[5] or 0))
    db.executemany("INSERT OR REPLACE INTO bars5m VALUES(?,?,?,?,?,?,?,?)", recs); nb += len(recs)
    db.commit(); time.sleep(0.32)
print(f"{dt.datetime.now():%Y-%m-%d %H:%M} topup_full: {len(PAIRS)} syms | eod+{ne} bars5m+{nb} | latest {db.execute('SELECT MAX(trade_date) FROM bars5m').fetchone()[0]}", flush=True)
