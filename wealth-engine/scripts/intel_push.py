#!/usr/bin/env python3
"""
Push winner-intelligence artifacts (winner_intel.py outputs) to D1.
Reads winner_backtest.json / winner_replay.json / missed_autopsy.json and writes:
  ranker_configs (v1 active) · winner_replay_daily · missed_winner_autopsy · daily_selection_witness
Uses the box CF_D1_TOKEN (parameterized REST). Reproducible for the nightly loop.
  python3 intel_push.py [--days 90]
"""
import os, json, time, urllib.request, argparse
WS = os.path.expanduser("~/hn-wealth-backtest")
env = {}
for l in open(os.path.join(WS, ".env")):
    if "=" in l: k, v = l.strip().split("=", 1); env[k] = v
TOK = env.get("CF_D1_TOKEN"); ACCT = env.get("CF_ACCT"); DB = env.get("D1_DB", "1e3cea30-5990-43d2-a9de-b749d32e225a")
if not TOK or not ACCT:
    raise SystemExit("D1 push DORMANT: add CF_D1_TOKEN + CF_ACCT to .env")

def d1(sql, params=None):
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
        data=body, headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if not r.get("success"): raise SystemExit("D1 error: " + json.dumps(r.get("errors")))
    return r

def js(o): return json.dumps(o, separators=(",", ":"))

ap = argparse.ArgumentParser(); ap.add_argument("--days", type=int, default=90); A = ap.parse_args()
NOW = int(time.time() * 1000)
bt = json.load(open(os.path.join(WS, "winner_backtest.json")))
replay = json.load(open(os.path.join(WS, "winner_replay.json")))[-A.days:]
autopsy = json.load(open(os.path.join(WS, "missed_autopsy.json")))[-A.days:]

# 1. ranker_config — deactivate old, publish v1 active
rc = bt["ranker_config"]
odds = json.load(open(os.path.join(WS,"odds.json"))) if os.path.exists(os.path.join(WS,"odds.json")) else None
d1("UPDATE ranker_configs SET is_active=0")
d1("""INSERT OR REPLACE INTO ranker_configs
      (version,is_active,target,gate_json,model_json,backtest_json,trained_days,date_to,published_at,odds_json)
      VALUES (?,1,?,?,?,?,?,?,?,?)""",
   [rc["version"], rc["target"], js(rc["gate"]), js(rc["model"]),
    js({k: bt[k] for k in ("two_stage_causal", "old_gap_ranker", "random_gated", "config")}),
    rc["trained_days"], rc["date_to"], NOW, (js(odds) if odds else None)])
print("ranker_config published:", rc["version"])

# 2. winner_replay_daily
for d in replay:
    d1("""INSERT OR REPLACE INTO winner_replay_daily
          (trade_date,n_symbols,n_tradable_winners,n_circuit_traps,top_winners_json,top_tradable_json,top_losers_json,source,generated_at)
          VALUES (?,?,?,?,?,?,?, 'rtx_bars5m', ?)""",
       [d["trade_date"], d["n_symbols"], d["n_tradable_winners"], d["n_circuit_traps"],
        js(d["top_winners"]), js(d["top_tradable"]), js(d["top_losers"]), NOW])
print("winner_replay_daily rows:", len(replay))

# 3. missed_winner_autopsy + 4. daily_selection_witness (seed historical from the new ranker)
for d in autopsy:
    nlw = sum(1 for mw in d["missed_winners"] if mw.get("reason_later_wrong"))
    d1("""INSERT OR REPLACE INTO missed_winner_autopsy
          (trade_date,picks_json,chosen_detail_json,best_realized_winner,best_day_pct,missed_winners_json,n_missed,n_reason_later_wrong,top_losers_json,generated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)""",
       [d["trade_date"], js(d["picks"]), js(d["chosen_detail"]), d["best_realized_winner"], d["best_day_pct"],
        js(d["missed_winners"]), len(d["missed_winners"]), nlw, js(d["top_losers"]), NOW])
    # seed a witness row (historical OBSERVE; the live worker overwrites today's going forward)
    gated = [m for m in d["missed_winners"] if not m.get("passed_gate")]
    sel = d["picks"][0] if d["picks"] else None
    cd0 = d["chosen_detail"][0] if d["chosen_detail"] else None
    why = (f"{sel}: highest causal upside score among loss-gate survivors (opening drive + relvol + range)."
           if sel else "No name cleared the loss gate.")
    d1("""INSERT OR REPLACE INTO daily_selection_witness
          (trade_date,decision,selected_symbol,ranked_candidates_json,rejected_json,no_loser_gate_json,
           expected_r,expected_upside_pct,why_this,why_not_top_missed_json,source_state,execution_authority,
           picks_broker_facing,ranker_version,composed_at,composed_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?, 'winner_intel_replay')""",
       [d["trade_date"], "OBSERVE", sel, js(d["chosen_detail"]),
        js([{ "symbol": m["symbol"], "reasons": m["reject_reasons"] } for m in gated]),
        js({"top_winners_seen": len(d["missed_winners"]) + len(d["picks"]), "gated_out_winners": len(gated)}),
        None, None, why,
        js([{ "symbol": m["symbol"], "day_pct": m["day_pct"], "why_not": (m["reject_reasons"] or ["not top-ranked by causal upside"]) } for m in d["missed_winners"][:5]]),
        "replay", "intelligence_plan_only", rc["version"], NOW])
print("missed_winner_autopsy + daily_selection_witness rows:", len(autopsy))
print("PUSH DONE.")
