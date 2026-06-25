#!/usr/bin/env python3
# Nightly pick-vs-outcome journal (closes the learning loop with DURABLE history).
# Reads the latest gap-engine verdict from D1, REPLAYS each pick's actual intraday
# result from bt.db (the box has the 5-min bars — it learns from its own results),
# compares to the strategy-free oracle (intraday_winner_daily), grades it, and writes
# one row to wealth_pick_journal. SIT_OUT days are journaled too (what moved + why we
# honestly couldn't have known). Box -> D1 REST (CF_D1_TOKEN).
import os, json, time, sqlite3, urllib.request, datetime as dt
WS = os.path.expanduser("~/hn-wealth-backtest")
env = {}
for l in open(os.path.join(WS, ".env")):
    if "=" in l:
        k, v = l.strip().split("=", 1); env[k] = v
TOK = env.get("CF_D1_TOKEN"); ACCT = env.get("CF_ACCT"); DB = env.get("D1_DB", "1e3cea30-5990-43d2-a9de-b749d32e225a")
if not TOK or not ACCT:
    print("journal_outcome: DORMANT (need CF_D1_TOKEN + CF_ACCT)"); raise SystemExit(0)

def d1(sql, params=None):
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
        data=body, headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    j = json.load(urllib.request.urlopen(req, timeout=30))
    return (j.get("result") or [{}])[0].get("results", [])

# 1) latest gap-engine verdict
vr = d1("SELECT id, trade_date, decision, picks_json, strategy_mode FROM daily_verdicts "
        "WHERE strategy_mode='intraday_gap_up' ORDER BY composed_at DESC LIMIT 1")
if not vr:
    print("journal_outcome: no gap verdict yet"); raise SystemExit(0)
v = vr[0]; td = v["trade_date"]
picks = json.loads(v.get("picks_json") or "[]")

# 2) active tuned rule (for replay exit bar / stop)
cf = d1("SELECT gap_min_pct, stop_pct, exit_bar, oos_expectancy_pct FROM wealth_strategy_config "
        "WHERE strategy='gap_up_intraday' AND is_active=1 ORDER BY published_at DESC LIMIT 1")
cfg = cf[0] if cf else {}
exit_bar = int(cfg.get("exit_bar") or 63); stop_pct = float(cfg.get("stop_pct") or 3.0)
oos_exp = cfg.get("oos_expectancy_pct")

# 3) replay each pick's real result from bt.db (entry bar 5 open -> exit_bar, wide stop)
def replay(sym, date):
    c = sqlite3.connect(os.path.join(WS, "bt.db"))
    rows = c.execute("SELECT o,h,l,c FROM bars5m WHERE symbol=? AND trade_date=? ORDER BY ts", (sym, date)).fetchall()
    c.close()
    if len(rows) < 6: return None
    entry = rows[5][0]
    if entry <= 0: return None
    sl = entry * (1 - stop_pct / 100.0)
    seg = rows[5:exit_bar + 1] or rows[5:]
    for (o, h, l, cl) in seg:
        if l <= sl: return -stop_pct
    return (seg[-1][3] / entry - 1) * 100.0

realized = []
for p in picks:
    r = replay(p.get("symbol"), td)
    if r is not None: realized.append(r)
realized_avg = round(sum(realized) / len(realized), 3) if realized else None

# 4) oracle top mover for the day
orc = d1("SELECT symbol, open_to_high_pct, realised_close_pct FROM intraday_winner_daily "
         "WHERE trade_date=? AND source='eod' ORDER BY rank ASC LIMIT 12", [td])
oracle_top = orc[0]["symbol"] if orc else None
oracle_pct = round(orc[0].get("realised_close_pct") or orc[0].get("open_to_high_pct") or 0, 2) if orc else None
oracle_syms = set(o["symbol"] for o in orc)
pick_syms = [p.get("symbol") for p in picks]

# 5) grade
if v["decision"] != "TRADE" or not pick_syms:
    grade = "sat_out"
elif any(s == oracle_top for s in pick_syms):
    grade = "hit"
elif any(s in oracle_syms for s in pick_syms):
    grade = "near"
else:
    grade = "far"

lesson = (f"Sat out; {oracle_top or 'n/a'} moved {oracle_pct}% — edge unproven, honest no-trade."
          if grade == "sat_out" else
          f"Traded {','.join(pick_syms)}; realized avg {realized_avg}%, oracle top {oracle_top} {oracle_pct}%. Grade {grade}.")

d1("""INSERT OR REPLACE INTO wealth_pick_journal
  (trade_date, strategy, verdict_id, decision, pick_symbols_json, pick_detail_json,
   action_taken, realised_pnl_pct, oracle_top_symbol, oracle_top_pct, caught_grade,
   config_oos_exp_pct, lesson_text, learned_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
  [td, "gap_up_intraday", v.get("id"), v["decision"], json.dumps(pick_syms),
   json.dumps(picks)[:8000], "sat_out" if grade == "sat_out" else "not_placed",
   realized_avg, oracle_top, oracle_pct, grade, oos_exp, lesson, int(time.time() * 1000)])
print(f"journaled {td}: decision={v['decision']} grade={grade} realized={realized_avg} oracle={oracle_top}/{oracle_pct}")
