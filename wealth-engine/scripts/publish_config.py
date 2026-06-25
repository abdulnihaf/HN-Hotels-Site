#!/usr/bin/env python3
# Publish the nightly gap-edge tuned rule (search_config.json) into D1
# wealth_strategy_config. Deactivates the prior active row, inserts the new one
# as is_active=1. Publishes the HONEST verdict even when it is NO_EDGE (so the
# live 09:40 engine knows to sit out). Box -> D1 REST (CF_D1_TOKEN, D1-Edit only).
import os, json, time, urllib.request, datetime as dt

WS = os.path.expanduser("~/hn-wealth-backtest")
env = {}
for l in open(os.path.join(WS, ".env")):
    if "=" in l:
        k, v = l.strip().split("=", 1); env[k] = v
TOK = env.get("CF_D1_TOKEN"); ACCT = env.get("CF_ACCT"); DB = env.get("D1_DB", "1e3cea30-5990-43d2-a9de-b749d32e225a")
if not TOK or not ACCT:
    print("publish_config: DORMANT (need CF_D1_TOKEN + CF_ACCT in .env)"); raise SystemExit(0)

def d1(sql, params):
    body = json.dumps({"sql": sql, "params": params}).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
        data=body, headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))

sc = json.load(open(os.path.join(WS, "search_config.json")))
rule = sc.get("tuned_rule") or {}
wf = sc.get("walk_forward_base") or {}
null = sc.get("random_null") or {}
now = int(time.time() * 1000)
strategy = "gap_up_intraday"
cfg_date = dt.date.today().isoformat()

# 1) deactivate prior active rule(s)
d1("UPDATE wealth_strategy_config SET is_active=0 WHERE strategy=? AND is_active=1", [strategy])

# 2) insert the new tuned rule (active). NO_EDGE still gets published (engine sits out).
d1("""INSERT INTO wealth_strategy_config
  (strategy, config_date, is_active, verdict, gap_min_pct, stop_pct, vol_mult_min,
   exit_time_ist, exit_bar, min_turnover_cr, max_picks, oos_expectancy_pct, oos_trades,
   oos_p, folds_positive, edge_vs_null, universe_syms, cost_assumption_pct, derived_from,
   params_json, published_at, published_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [
    strategy, cfg_date, 1, sc.get("verdict", "NO_EDGE"),
    rule.get("gap_min_pct"), rule.get("stop_pct"), rule.get("vol_mult_min"),
    rule.get("exit_time_ist"), rule.get("exit_bar"), rule.get("min_turnover_cr") or sc.get("liquidity_gate_cr"),
    rule.get("max_picks") or 3, rule.get("oos_expectancy_pct"), rule.get("oos_trades"),
    rule.get("oos_p"), rule.get("folds_positive"), null.get("edge_vs_null"),
    sc.get("universe_syms"), sc.get("cost_base_pct"), "gap_edge.py walk-forward OOS",
    json.dumps(sc)[:60000], now, "rtx-box",
])
# 3) also surface the gap-edge result in backtest_intraday_runs (iOS Ops card + phone page read this)
dr = sc.get("date_range") or [None, None]
notes = (f"GAP-UP {sc.get('verdict')}: gap>={rule.get('gap_min_pct')}% hold->{rule.get('exit_time_ist')} "
         f"wide {rule.get('stop_pct')}% stop | OOS {rule.get('oos_expectancy_pct')}%/trade "
         f"({rule.get('folds_positive')} folds+, p={rule.get('oos_p')}) | "
         f"edge_vs_null={null.get('edge_vs_null')} | point-in-time liquidity (no survivorship) | "
         f"{sc.get('universe_syms')} syms")
d1("""INSERT OR REPLACE INTO backtest_intraday_runs
  (run_id, started_at, finished_at, status, mode, config_json, trading_days, total_trades,
   expectancy_pct, winner_capture_pct, notes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)""", [
    "gap_edge_nightly", now, now, "done", "intraday",
    json.dumps({"strategy": "gap_up_intraday", "rule": rule, "from": dr[0], "to": dr[1],
                "verdict": sc.get("verdict"), "survivorship": sc.get("survivorship")})[:8000],
    None, rule.get("oos_trades"), rule.get("oos_expectancy_pct"), None, notes[:1500]])

print(f"published config {strategy} {cfg_date}: verdict={sc.get('verdict')} "
      f"rule={rule.get('gap_min_pct')}%/{rule.get('stop_pct')}stop/{rule.get('exit_time_ist')} "
      f"oos_exp={rule.get('oos_expectancy_pct')} syms={sc.get('universe_syms')}")
