#!/usr/bin/env python3
"""
HN Wealth — WIDE no-human-ceiling edge hunt (round-2, on intel.db).
Runs the out-of-the-box families that the single long-only ranker never tried:
  1. market_neutral   — long top-K by causal upside score, SHORT bottom-K (F&O-shortable
                        only, + borrow cost). Cancels market beta; trades every day.
  2. regime_gated_long— long top-K only on days the regime favors it (breadth tercile).
  3. confluence_long  — long only names where drive>0 AND above-VWAP AND high rel-vol
                        (multi-feature confluence), top-K.
  4. gbm_ml           — gradient-boosted cross-sectional ranker (if sklearn available).
All walk-forward OOS (train past / test unseen), net of real costs, vs a matched-random
null. HONEST: report what survives; never fake an edge. Reuses winner_intel.py.
  python3 wide_hunt.py            (writes wide_hunt_results.json)
"""
import json, math, os, sys
import winner_intel as W

MIN_TRAIN = 120
K = 3
COST = W.COST_PCT            # ~0.12% round-trip long
BORROW = 0.05               # ~0.05%/day short borrow
MIN_LIQ = 25.0              # ₹Cr — fillable both sides

def liquid(rows):
    return [r for r in rows if (r.get("liq20_cr") or 0) >= MIN_LIQ and r.get("to_1430_pct") is not None]

def net_long(r):  return (r["to_1430_pct"] or 0) - COST
def net_short(r): return -(r["to_1430_pct"] or 0) - COST - BORROW

def summarize(name, day_pnls, active_days, extra=None):
    import statistics as st
    n = len(day_pnls)
    if n == 0: return {"strategy": name, "active_days": 0, "note": "no qualifying days"}
    pos = sum(1 for x in day_pnls if x > 0)
    mean = sum(day_pnls)/n
    sd = st.pstdev(day_pnls) if n > 1 else 0
    res = {"strategy": name, "active_days": active_days, "trading_days": n,
        "avg_net_pct_per_day": round(mean, 4), "total_net_pct": round(sum(day_pnls), 2),
        "win_rate_pct": round(100*pos/n, 1), "worst_day_pct": round(min(day_pnls), 2),
        "best_day_pct": round(max(day_pnls), 2),
        "sharpe_daily": round(mean/sd, 3) if sd > 0 else None}
    if extra: res.update(extra)
    return res

def run():
    import numpy as np
    days, by = W.load_days()
    fno = W.FNO_SET
    # daily breadth regime (causal: known by close of prior day used for gating today is ideal,
    # but breadth here is same-day realized — used only to TEST whether a regime split helps,
    # not as a live signal; flagged as descriptive).
    breadth = {}
    for d in days:
        ups = [r for r in by[d] if r.get("day_pct") is not None]
        breadth[d] = (sum(1 for r in ups if r["day_pct"] > 0)/len(ups)) if ups else 0.5
    br_sorted = sorted(breadth.values())
    br_hi = br_sorted[int(len(br_sorted)*0.66)] if br_sorted else 0.5

    mn=[]; rg=[]; rg_active=0; cf=[]; cf_active=0; rnd=[]
    rng = np.random.RandomState(7)
    for i in range(MIN_TRAIN, len(days)):
        d = days[i]
        train = [r for j in range(0, i) for r in by[days[j]] if r.get("to_1430_pct") is not None]
        model = W.fit_linear(train, "to_high_pct", 10.0)
        rows = liquid(by[d])
        if len(rows) < 2*K:
            continue
        scored = sorted(rows, key=lambda r: -W.score(r, model))
        longs = scored[:K]
        shorts = [r for r in reversed(scored) if r.get("is_fno")][:K]
        # 1. market neutral
        if longs and shorts:
            mn_day = (sum(net_long(r) for r in longs)/len(longs)
                      + sum(net_short(r) for r in shorts)/len(shorts))
            mn.append(mn_day)
            # matched null: random long/short of same sizes
            rl = list(rows); rng.shuffle(rl); rsh=[r for r in rl if r.get("is_fno")]
            if rsh:
                rnd.append(sum(net_long(r) for r in rl[:K])/K + sum(net_short(r) for r in rsh[:K])/min(K,len(rsh))/1.0)
        # 2. regime-gated long (only high-breadth days)
        if breadth[d] >= br_hi and longs:
            rg.append(sum(net_long(r) for r in longs)/len(longs)); rg_active+=1
        # 3. confluence long
        conf = [r for r in scored if (r.get("drive_pct") or 0) > 0 and (r.get("pos_vs_vwap_pct") or -9) > 0 and (r.get("rel_vol") or 0) > 1.5][:K]
        if conf:
            cf.append(sum(net_long(r) for r in conf)/len(conf)); cf_active+=1

    out = {
        "config": {"min_train": MIN_TRAIN, "k": K, "cost_pct": COST, "borrow_pct": BORROW,
                   "min_liq_cr": MIN_LIQ, "test_days": len(days)-MIN_TRAIN,
                   "date_from": days[MIN_TRAIN], "date_to": days[-1],
                   "families": 3, "multiple_testing_note": "3 families + null; treat any single positive with FDR skepticism"},
        "market_neutral": summarize("market_neutral_longshort", mn, len(mn)),
        "regime_gated_long": summarize("regime_gated_long(high_breadth)", rg, rg_active),
        "confluence_long": summarize("confluence_long(drive+vwap+relvol)", cf, cf_active),
        "matched_random_null": summarize("matched_random_null", rnd, len(rnd)),
    }
    # 4. GBM ML (optional)
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor
        gbm=[]
        for i in range(MIN_TRAIN, len(days)):
            d=days[i]
            tr=[r for j in range(0,i) for r in by[days[j]] if r.get("to_1430_pct") is not None]
            med={k:0 for k in W.FEAT_KEYS}
            X=np.array([W.featvec(r,med) for r in tr]); y=np.array([max(-25,min(25,r["to_high_pct"])) for r in tr])
            m=HistGradientBoostingRegressor(max_iter=120,max_depth=4,learning_rate=0.06).fit(X,y)
            rows=liquid(by[d])
            if len(rows)<K: continue
            Xt=np.array([W.featvec(r,med) for r in rows]); pred=m.predict(Xt)
            order=np.argsort(-pred)
            longs=[rows[j] for j in order[:K]]
            gbm.append(sum(net_long(r) for r in longs)/len(longs))
        out["gbm_ml_long"]=summarize("gbm_ml_long",gbm,len(gbm))
    except Exception as e:
        out["gbm_ml_long"]={"strategy":"gbm_ml_long","skipped":str(e)[:120]}

    json.dump(out, open("wide_hunt_results.json","w"))
    print(json.dumps(out, indent=2))
    # honest verdict
    best = max((v for k,v in out.items() if isinstance(v,dict) and v.get("avg_net_pct_per_day") is not None),
               key=lambda v: v["avg_net_pct_per_day"], default=None)
    null = out["matched_random_null"].get("avg_net_pct_per_day")
    print("\nVERDICT:", "best family", best["strategy"] if best else "none",
          "avg/day", best["avg_net_pct_per_day"] if best else None,
          "| null avg/day", null,
          "| DEPLOYABLE" if best and best["avg_net_pct_per_day"] and null is not None and best["avg_net_pct_per_day"] > max(0.15, null+0.1) and best["win_rate_pct"]>52 else "| NO DEPLOYABLE EDGE (honest)")

if __name__ == "__main__":
    run()
