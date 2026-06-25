#!/usr/bin/env python3
# HN Wealth — full liquid-universe backfill (kills survivorship).
# Fetches a YEAR of 5-min bars + EOD (with volume + prev_close) for every symbol in
# universe_full.txt into bt.db. Resumable (skips completed syms via backfill_full.state),
# idempotent (INSERT OR REPLACE), niced, single-threaded, gentle on the proxy + Kite + Nazar.
# Reads via OUR proxy (box holds DASHBOARD_API_KEY only — no raw Kite creds).
import os, sys, time, json, sqlite3, urllib.request, urllib.parse, datetime as dt

WS = os.path.expanduser("~/hn-wealth-backtest")
KEY = [l.split("=",1)[1].strip() for l in open(os.path.join(WS,".env")) if l.startswith("DASHBOARD_API_KEY=")][0]
BASE = "https://trade.hnhotels.in"
DB = os.path.join(WS, "bt.db")
UNIV = os.path.join(WS, "universe_full.txt")
STATE = os.path.join(WS, "backfill_full.state")
LOG = os.path.join(WS, "backfill_full.log")

START = "2025-06-02"                      # match existing bars5m range
TODAY = dt.date.today().isoformat()
CHUNK_DAYS = 55                           # Kite 5-min historical max ~60d/req
SLEEP = 0.40                              # ~2.5 req/s, under Kite 3/s limit

def log(msg):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    with open(LOG, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)

def get(u, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(u, headers={"x-api-key": KEY, "User-Agent": "hn-wealth-backfill/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                return {"_err": str(e)}
            time.sleep(1.5 * (i + 1))

def daterange_chunks(start, end, days):
    s = dt.date.fromisoformat(start); e = dt.date.fromisoformat(end)
    cur = s
    while cur <= e:
        c_end = min(cur + dt.timedelta(days=days - 1), e)
        yield cur.isoformat(), c_end.isoformat()
        cur = c_end + dt.timedelta(days=1)

def main():
    pairs = open(UNIV).read().split()
    done = set()
    if os.path.exists(STATE):
        done = set(l.strip() for l in open(STATE) if l.strip())
    db = sqlite3.connect(DB)
    db.execute("PRAGMA journal_mode=WAL")
    todo = [p for p in pairs if p.rsplit(":",1)[0] not in done]
    log(f"BACKFILL START: {len(pairs)} syms total, {len(done)} already done, {len(todo)} to fetch. range {START}..{TODAY}")
    t0 = time.time()
    for idx, p in enumerate(todo):
        sym, tok = p.rsplit(":", 1)
        try:
            # 1) EOD (volume + prev_close) for point-in-time liquidity gate
            j = get(f"{BASE}/api/trading?action=eod&symbol={urllib.parse.quote(sym)}&from={START}&to={TODAY}")
            rows = j.get("rows", []) if isinstance(j, dict) else []
            db.executemany("INSERT OR REPLACE INTO eod VALUES(?,?,?,?,?,?,?,?,?)",
                [(sym, r["trade_date"], r.get("open_paise"), r.get("high_paise"), r.get("low_paise"),
                  r.get("close_paise"), r.get("prev_close_paise"), r.get("volume"), r.get("delivery_pct")) for r in rows])
            time.sleep(SLEEP)
            # 2) 5-min bars in chunks
            nb = 0
            for frm, to in daterange_chunks(START, TODAY, CHUNK_DAYS):
                f5 = f"{frm} 09:15:00"; t5 = f"{to} 15:30:00"
                u = (f"{BASE}/api/kite?action=historical&instrument_token={tok}&interval=5minute"
                     f"&from={urllib.parse.quote(f5)}&to={urllib.parse.quote(t5)}")
                j = get(u)
                candles = (j.get("data") or {}).get("candles", []) if isinstance(j, dict) else []
                recs = []
                for c in candles:
                    d0 = dt.datetime.fromisoformat(c[0])
                    ts = int(d0.timestamp() * 1000)
                    recs.append((sym, ts, d0.date().isoformat(),
                                 round(c[1]*100), round(c[2]*100), round(c[3]*100), round(c[4]*100), c[5] or 0))
                if recs:
                    db.executemany("INSERT OR REPLACE INTO bars5m VALUES(?,?,?,?,?,?,?,?)", recs)
                    nb += len(recs)
                time.sleep(SLEEP)
            db.commit()
            with open(STATE, "a") as f:
                f.write(sym + "\n")
            if (idx + 1) % 25 == 0 or idx == len(todo) - 1:
                el = time.time() - t0
                rate = (idx + 1) / el
                eta = (len(todo) - idx - 1) / rate / 60 if rate > 0 else 0
                log(f"  [{idx+1}/{len(todo)}] {sym} eod+{len(rows)} bars5m+{nb} | {rate*60:.0f} syms/min | ETA {eta:.0f}m")
        except Exception as e:
            log(f"  ERR {sym}: {e}")
            time.sleep(2)
    total_syms = db.execute("SELECT COUNT(DISTINCT symbol) FROM bars5m").fetchone()[0]
    total_bars = db.execute("SELECT COUNT(*) FROM bars5m").fetchone()[0]
    log(f"BACKFILL DONE: bars5m now {total_syms} syms / {total_bars} rows in {(time.time()-t0)/60:.0f}m")

if __name__ == "__main__":
    main()
