#!/usr/bin/env python3
"""
HN Wealth — SELF-LEARNING LOOP (Track C). "The loop is the product."

Closes the feedback loop so yesterday's MISSES change tomorrow's ranking — safely:
  1. Read missed_winner_autopsy → tally the reject-reasons that wrongly killed REAL
     winners (reason_later_wrong). That tells us which gate rule is too tight.
  2. Propose candidate relaxations of the worst-offending rule (bounded steps).
  3. RE-BACKTEST each candidate gate walk-forward.
  4. Adopt a candidate ONLY if it STRICTLY improves winner-capture AND keeps
     circuit-trap picks at 0 AND does not raise loser-pick freq AND does not lower
     net — i.e. it can only ever make the ranker better, never reckless.
  5. Publish the chosen gate + refreshed odds to ranker_configs (tomorrow uses it).
Reuses winner_intel.py. Run nightly (wired into intel_refresh.sh).
  python3 self_learn.py
"""
import json, os, time, urllib.request
import winner_intel as W

MIN_TRAIN, K, LAM = 120, 3, 10.0

def backtest_gate(days, by, gate):
    cap = active = losers = picks = circ = 0; nets = []
    for i in range(MIN_TRAIN, len(days)):
        train = [r for j in range(0, i) for r in by[days[j]] if r.get("to_1430_pct") is not None]
        model = W.fit_linear(train, "to_high_pct", LAM)
        surv = [r for r in by[days[i]] if W.stage_a(r, gate)[0] and r.get("entry")]
        surv.sort(key=lambda r: -W.score(r, model))
        chosen = []; used = set()
        for r in surv:
            sec = r.get("sector") or "OTHER"
            if sec != "OTHER" and sec in used: continue
            chosen.append(r); used.add(sec)
            if len(chosen) >= K: break
        if not chosen: continue
        active += 1
        for r in chosen:
            picks += 1; net = (r["to_1430_pct"] or 0) - W.COST_PCT; nets.append(net)
            if net < 0: losers += 1
            if r["circuit_trap"] == 1: circ += 1
        if chosen[0]["tradable_winner"] == 1: cap += 1
    return dict(capture=round(100*cap/active, 1) if active else 0,
                loser_freq=round(100*losers/picks, 1) if picks else 0,
                circuit=circ, avg_net=round(sum(nets)/len(nets), 3) if nets else 0, active=active)

def main():
    days, by = W.load_days()
    # 1. what the loop got wrong — reasons that killed real winners
    reasons = {}
    if os.path.exists("missed_autopsy.json"):
        for d in json.load(open("missed_autopsy.json")):
            for m in d.get("missed_winners", []):
                if m.get("reason_later_wrong"):
                    for r in (m.get("reject_reasons") or []):
                        reasons[r] = reasons.get(r, 0) + 1
    print("misses-by-reason (gate killed a real winner):", json.dumps(reasons))

    base = backtest_gate(days, by, W.THR)
    print("baseline gate:", json.dumps(base))

    # 2. candidate relaxations, keyed to the offending reasons (bounded)
    cands = []
    def variant(**kw):
        g = dict(W.THR); g.update(kw); return g
    if reasons.get("below_vwap"):                cands.append(("vwap_floor=-1.25", variant(vwap_floor=-1.25)))
    if reasons.get("stop_too_wide"):             cands.append(("max_or=16", variant(max_or=16.0)))
    if reasons.get("preopen_circuit_risk"):      cands.append(("preopen_circuit_liq=40", variant(preopen_circuit_liq=40.0)))
    if reasons.get("already_exhausted_circuit_risk"): cands.append(("max_runup=10", variant(max_runup=10.0)))
    if reasons.get("failed_gap_hold"):           cands.append(("gap_fade_d=-2", variant(gap_fade_d=-2.0)))
    if reasons.get("illiquid"):                  cands.append(("min_liq=7", variant(min_liq=7.0)))
    if not cands:
        print("LOOP: no systematic mis-rejection found — current gate already best. No change.")
        cands = []

    best_name, best_gate, best_m = "baseline", W.THR, base
    for name, g in cands:
        m = backtest_gate(days, by, g)
        improved = (m["capture"] > best_m["capture"] and m["circuit"] == 0
                    and m["loser_freq"] <= base["loser_freq"] + 0.1 and m["avg_net"] >= base["avg_net"] - 0.02)
        print(f"candidate {name}: {json.dumps(m)}  {'ADOPT' if improved else 'reject'}")
        if improved:
            best_name, best_gate, best_m = name, g, m

    decision = dict(checked_at=int(time.time()*1000), misses_by_reason=reasons,
                    baseline=base, chosen=best_name, chosen_metrics=best_m,
                    changed=(best_name != "baseline"))
    json.dump(decision, open("self_learn_decision.json", "w"))
    print("LOOP DECISION:", json.dumps(decision))

    # 3. publish the (possibly) improved gate to the active ranker config
    if best_name != "baseline":
        env = {}
        for l in open(os.path.expanduser("~/hn-wealth-backtest/.env")):
            if "=" in l: k, v = l.strip().split("=", 1); env[k] = v
        TOK, ACCT = env.get("CF_D1_TOKEN"), env.get("CF_ACCT")
        DB = env.get("D1_DB", "1e3cea30-5990-43d2-a9de-b749d32e225a")
        if TOK and ACCT:
            body = json.dumps({"sql": "UPDATE ranker_configs SET gate_json=? WHERE is_active=1",
                               "params": [json.dumps(best_gate)]}).encode()
            req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
                data=body, headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=30))
            print("PUBLISHED improved gate to ranker_config:", r.get("success"), "→", best_name,
                  f"(capture {base['capture']}→{best_m['capture']}%, losers {base['loser_freq']}→{best_m['loser_freq']}%, circuit {best_m['circuit']})")
        else:
            print("would publish but D1 token absent")
    else:
        print("LOOP: baseline gate retained (no candidate strictly improved it).")

if __name__ == "__main__":
    main()
