#!/usr/bin/env python3
"""HN Wealth Round-2 causal confluence audit.

This is a proof artifact, not a trading engine. It loads the cached full-universe
candidate store on the RTX box and tests only strategies whose features are
knowable before the modeled entry:

- early_market_neutral: prior/EOD + opening-gap features -> L5/S5 entry
- late_confluence_long: first-30-minute features -> L6 entry only
- regime_gated_late_long: same late features, with train-selected regime gates

Every fold chooses its config only from the train window, then scores the next
unseen test window. Results are net of the costs already embedded in cands.pkl
outcomes, with an extra short-leg borrow/impact haircut for market-neutral.
"""

import itertools
import json
import math
import os
import pickle
import random
import statistics as st
from collections import defaultdict
from datetime import datetime

WS = os.path.expanduser("~/hn-wealth-backtest")
PKL = os.path.join(WS, "cands.pkl")
OUT = os.path.join(WS, "round2_causal_confluence_v1_results.json")

TRAIN, TEST, STEP, EMBARGO = 105, 21, 21, 1
BOOT_ITERS = 500
NULL_ITERS = 250
SHORT_EXTRA_COST_PCT = 0.10
NOTIONAL_PAISE = 10_000_000  # Rs 1,00,000

EARLY_FIELDS = [
    "gap", "ret1", "ret5", "ret20", "dist20", "atr_pct", "liq",
    "nifty_gap", "nifty_ret1", "regime_up", "vol_q",
]
LATE_FIELDS = EARLY_FIELDS + ["rel_vol", "first30", "vwap_dev5"]


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


def median(xs):
    return st.median(xs) if xs else None


def max_drawdown(vals):
    eq = peak = dd = 0.0
    for v in vals:
        eq += v
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    return dd


def zscore_by_day(rows, fields):
    by_date = defaultdict(list)
    for r in rows:
        by_date[r["date"]].append(r)
    out = []
    for _d, rs in by_date.items():
        stats = {}
        for f in fields:
            vals = [float(r.get(f) or 0.0) for r in rs]
            stats[f] = (mean(vals), st.pstdev(vals) or 1.0)
        for r in rs:
            rr = dict(r)
            for f, (mu, sd) in stats.items():
                rr["z_" + f] = (float(r.get(f) or 0.0) - mu) / sd
            out.append(rr)
    return out


def score_row(r, weights):
    return sum(float(w) * float(r.get("z_" + f, 0.0)) for f, w in weights.items())


def pass_gate(r, gate):
    if gate == "all":
        return True
    if gate == "nifty_gap_up":
        return float(r.get("nifty_gap") or 0) > 0
    if gate == "nifty_gap_down":
        return float(r.get("nifty_gap") or 0) < 0
    if gate == "regime_up":
        return int(r.get("regime_up") or 0) == 1
    if gate == "regime_down":
        return int(r.get("regime_up") or 0) == 0
    if gate == "low_vol":
        return int(r.get("vol_q") or 0) <= 1
    if gate == "high_vol":
        return int(r.get("vol_q") or 0) >= 2
    return False


def capacity_share_pct(rows, k, long_short=False):
    shares = []
    legs = 2 if long_short else 1
    per_name = NOTIONAL_PAISE / max(1, k * legs)
    for r in rows:
        tov = float(r.get("bar5_tov") or 0)
        if tov > 0:
            shares.append(100.0 * per_name / tov)
    if not shares:
        return None
    shares.sort()
    return {
        "median_pct_bar5_turnover": round(shares[len(shares) // 2], 4),
        "p95_pct_bar5_turnover": round(shares[int(0.95 * (len(shares) - 1))], 4),
        "max_pct_bar5_turnover": round(max(shares), 4),
    }


def eval_long(rows, cfg):
    key = tuple(cfg["key"])
    k = cfg["k"]
    fno_only = cfg.get("fno_only", False)
    gate = cfg.get("gate", "all")
    by = defaultdict(list)
    for r in rows:
        if fno_only and not r.get("isf"):
            continue
        if not pass_gate(r, gate):
            continue
        y = r.get("outs", {}).get(key)
        if y is None:
            continue
        by[r["date"]].append(r)
    day_rets, day_details, picked_rows = [], [], []
    for d, rs in sorted(by.items()):
        if len(rs) < k:
            continue
        picks = sorted(rs, key=lambda r: score_row(r, cfg["weights"]), reverse=True)[:k]
        ret = mean([float(p["outs"][key]) for p in picks])
        day_rets.append(ret)
        picked_rows.extend(picks)
        day_details.append({
            "date": d,
            "ret_pct": round(ret, 4),
            "picks": [p["sym"] for p in picks],
        })
    return day_rets, day_details, capacity_share_pct(picked_rows, k, long_short=False)


def eval_market_neutral(rows, cfg):
    key_l = tuple(cfg["key_l"])
    key_s = tuple(cfg["key_s"])
    k = cfg["k"]
    gate = cfg.get("gate", "all")
    by = defaultdict(list)
    for r in rows:
        if not r.get("isf"):
            continue
        if not pass_gate(r, gate):
            continue
        if key_l in r.get("outs", {}) and key_s in r.get("outs", {}):
            by[r["date"]].append(r)
    day_rets, day_details, picked_rows = [], [], []
    for d, rs in sorted(by.items()):
        if len(rs) < 2 * k:
            continue
        ranked = sorted(rs, key=lambda r: score_row(r, cfg["weights"]), reverse=True)
        longs = ranked[:k]
        shorts = ranked[-k:]
        lret = mean([float(r["outs"][key_l]) for r in longs])
        sret = mean([float(r["outs"][key_s]) - SHORT_EXTRA_COST_PCT for r in shorts])
        ret = (lret + sret) / 2.0
        day_rets.append(ret)
        picked_rows.extend(longs)
        picked_rows.extend(shorts)
        day_details.append({
            "date": d,
            "ret_pct": round(ret, 4),
            "longs": [r["sym"] for r in longs],
            "shorts": [r["sym"] for r in shorts],
        })
    return day_rets, day_details, capacity_share_pct(picked_rows, k, long_short=True)


def block_boot_p(vals, block=5):
    vals = list(vals)
    n = len(vals)
    if n < 20:
        return None
    rng = random.Random(20260627)
    means = []
    for _ in range(BOOT_ITERS):
        sample = []
        while len(sample) < n:
            i = rng.randrange(0, max(1, n - block + 1))
            sample.extend(vals[i:i + block])
        means.append(mean(sample[:n]))
    return sum(1 for m in means if m <= 0) / len(means)


def summarize_oos(oos, folds, null, cap):
    edge_vs_null = None
    z = None
    if oos and null and null.get("null_mean_pct") is not None:
        edge_vs_null = mean(oos) - null["null_mean_pct"]
        sd = null.get("null_stdev")
        if sd:
            z = edge_vs_null / sd
    p_boot = block_boot_p(oos)
    active_per_21 = len(oos) / max(1, len(set(day for f in folds for day in f.get("test_days_list", [])))) * 21
    deployable = (
        oos and mean(oos) > 0 and
        p_boot is not None and p_boot < 0.05 and
        edge_vs_null is not None and edge_vs_null > 0 and
        z is not None and z >= 2.5 and
        sum(1 for f in folds if (f.get("test_mean_pct") or 0) > 0) >= math.ceil(0.70 * len(folds))
    )
    watch = (
        not deployable and oos and mean(oos) > 0 and
        edge_vs_null is not None and edge_vs_null > 0 and
        z is not None and z >= 2.0
    )
    return {
        "signal_state": "DEPLOYABLE" if deployable else ("WATCH_SCOUT" if watch else "REJECTED"),
        "oos_days": len(oos),
        "active_days_per_21": round(active_per_21, 1) if oos else 0,
        "oos_day_mean_pct": round(mean(oos), 4) if oos else None,
        "oos_day_median_pct": round(median(oos), 4) if oos else None,
        "oos_simple_sum_pct": round(sum(oos), 4),
        "oos_win_days": sum(1 for x in oos if x > 0),
        "oos_loss_days": sum(1 for x in oos if x < 0),
        "max_drawdown_pct_sum": round(max_drawdown(oos), 4),
        "p_day_block_boot_le_0": p_boot,
        "null": null,
        "edge_vs_null_pct": round(edge_vs_null, 4) if edge_vs_null is not None else None,
        "z_vs_null": round(z, 2) if z is not None else None,
        "folds_positive": sum(1 for f in folds if (f.get("test_mean_pct") or 0) > 0),
        "folds_total": len(folds),
        "capacity": cap,
    }


def null_for_long(rows, folds, iters=NULL_ITERS):
    pools = defaultdict(list)
    k_by_day = {}
    for f in folds:
        cfg = f["cfg"]
        key = tuple(cfg["key"])
        lo, hi = f["test_range"]
        for r in rows:
            d = r["date"]
            if d < lo or d > hi:
                continue
            if cfg.get("fno_only") and not r.get("isf"):
                continue
            if not pass_gate(r, cfg.get("gate", "all")):
                continue
            y = r.get("outs", {}).get(key)
            if y is not None:
                pools[d].append(float(y))
                k_by_day[d] = cfg["k"]
    rng = random.Random(20260627)
    means = []
    for _ in range(iters):
        day_vals = []
        for d, pool in pools.items():
            k = k_by_day[d]
            if len(pool) >= k:
                day_vals.append(mean(rng.sample(pool, k)))
        if day_vals:
            means.append(mean(day_vals))
    return {"null_mean_pct": round(mean(means), 4), "null_stdev": round(st.pstdev(means), 4)}


def null_for_market_neutral(rows, folds, iters=NULL_ITERS):
    pools = defaultdict(list)
    cfg_by_day = {}
    for f in folds:
        cfg = f["cfg"]
        kl, ks = tuple(cfg["key_l"]), tuple(cfg["key_s"])
        lo, hi = f["test_range"]
        for r in rows:
            d = r["date"]
            if d < lo or d > hi or not r.get("isf"):
                continue
            if not pass_gate(r, cfg.get("gate", "all")):
                continue
            if kl in r.get("outs", {}) and ks in r.get("outs", {}):
                pools[d].append((float(r["outs"][kl]), float(r["outs"][ks]) - SHORT_EXTRA_COST_PCT))
                cfg_by_day[d] = cfg
    rng = random.Random(20260627)
    means = []
    for _ in range(iters):
        day_vals = []
        for d, pool in pools.items():
            k = cfg_by_day[d]["k"]
            if len(pool) < 2 * k:
                continue
            sample = rng.sample(pool, 2 * k)
            longs = sample[:k]
            shorts = sample[k:]
            day_vals.append((mean([x[0] for x in longs]) + mean([x[1] for x in shorts])) / 2.0)
        if day_vals:
            means.append(mean(day_vals))
    return {"null_mean_pct": round(mean(means), 4), "null_stdev": round(st.pstdev(means), 4)}


def walk_forward(rows, dates, configs, evaluator, nuller, name):
    oos, folds, cap_samples = [], [], []
    for start in range(TRAIN + EMBARGO, len(dates) - TEST + 1, STEP):
        train_dates = set(dates[start - EMBARGO - TRAIN:start - EMBARGO])
        test_dates = set(dates[start:start + TEST])
        train_rows = [r for r in rows if r["date"] in train_dates]
        test_rows = [r for r in rows if r["date"] in test_dates]
        best = None
        for cfg in configs:
            train_rets, _details, _cap = evaluator(train_rows, cfg)
            if len(train_rets) < 50:
                continue
            score = mean(train_rets) - 0.20 * abs(max_drawdown(train_rets))
            if best is None or score > best[0]:
                best = (score, cfg, mean(train_rets), len(train_rets))
        if not best:
            continue
        _score, cfg, train_mean, train_n = best
        test_rets, details, cap = evaluator(test_rows, cfg)
        oos.extend(test_rets)
        if cap:
            cap_samples.append(cap)
        folds.append({
            "test_range": [min(test_dates), max(test_dates)],
            "test_days_list": sorted(d for d in test_dates if any(x["date"] == d for x in test_rows)),
            "cfg": cfg,
            "train_mean_pct": round(train_mean, 4),
            "train_days": train_n,
            "test_mean_pct": round(mean(test_rets), 4) if test_rets else None,
            "test_days": len(test_rets),
            "sample_days": details[:3],
        })
    null = nuller(rows, folds) if folds else None
    cap = None
    if cap_samples:
        cap = {
            "median_pct_bar5_turnover": round(median([c["median_pct_bar5_turnover"] for c in cap_samples]), 4),
            "p95_pct_bar5_turnover": round(median([c["p95_pct_bar5_turnover"] for c in cap_samples]), 4),
            "max_pct_bar5_turnover": round(max(c["max_pct_bar5_turnover"] for c in cap_samples), 4),
        }
    summary = summarize_oos(oos, folds, null, cap)
    summary.update({"name": name, "folds": folds})
    return summary


def main():
    raw = pickle.load(open(PKL, "rb"))["cands"]
    all_fields = sorted(set(EARLY_FIELDS + LATE_FIELDS))
    rows = zscore_by_day(raw, all_fields)
    dates = sorted(set(r["date"] for r in rows))

    early_weights = [
        {"gap": 1.0, "ret20": 0.5, "ret5": 0.25, "dist20": 0.25, "liq": 0.15, "atr_pct": -0.25},
        {"gap": -1.0, "ret1": -0.5, "ret5": -0.25, "ret20": -0.25, "atr_pct": -0.25},
        {"ret20": 1.0, "ret5": 0.5, "gap": 0.25, "liq": 0.25, "atr_pct": -0.25},
        {"ret20": -1.0, "ret5": -0.5, "gap": -0.25, "liq": 0.25, "atr_pct": -0.25},
        {"nifty_gap": 0.5, "gap": 0.75, "ret20": 0.5, "regime_up": 0.35},
        {"nifty_gap": -0.5, "gap": -0.75, "ret5": -0.5, "regime_up": -0.35},
    ]
    late_weights = [
        {"first30": 1.0, "vwap_dev5": 1.0, "rel_vol": 0.5, "gap": 0.25, "ret20": 0.25},
        {"first30": -1.0, "vwap_dev5": -1.0, "rel_vol": 0.5, "gap": -0.25, "ret5": -0.25},
        {"first30": 0.75, "vwap_dev5": 0.75, "ret20": 0.75, "liq": 0.2, "atr_pct": -0.25},
        {"first30": 0.5, "gap": -0.5, "ret1": -0.5, "vwap_dev5": 0.75, "rel_vol": 0.5},
        {"rel_vol": 1.0, "first30": 0.4, "gap": 0.4, "dist20": 0.4, "atr_pct": -0.4},
    ]
    gates = ["all", "regime_up", "low_vol"]

    mn_configs = []
    for weights, k, stop, exit_bar, gate in itertools.product(early_weights, [3, 5, 8], [99.0], [45, 71], gates):
        mn_configs.append({
            "kind": "early_market_neutral",
            "weights": weights,
            "k": k,
            "key_l": ["L5", stop, exit_bar],
            "key_s": ["S5", stop, exit_bar],
            "gate": gate,
            "causal_entry": "L5/S5: uses no first30/vwap_dev5/rel_vol",
        })
    late_configs = []
    for weights, k, stop, exit_bar, fno_only, gate in itertools.product(late_weights, [1, 3, 5], [99.0], [45, 71], [False, True], gates):
        late_configs.append({
            "kind": "late_confluence_long",
            "weights": weights,
            "k": k,
            "key": ["L6", stop, exit_bar],
            "fno_only": fno_only,
            "gate": gate,
            "causal_entry": "L6: first30/vwap_dev5 only after the 09:40-09:45 bar is knowable",
        })

    experiments = [
        walk_forward(rows, dates, mn_configs, eval_market_neutral, null_for_market_neutral, "early_market_neutral_v2"),
        walk_forward(rows, dates, late_configs, eval_long, null_for_long, "late_confluence_long_v1"),
    ]

    data_coverage = {
        "candidate_rows": len(rows),
        "symbols": len(set(r["sym"] for r in rows)),
        "fno_symbols_seen": len(set(r["sym"] for r in rows if r.get("isf"))),
        "date_range": [dates[0], dates[-1]],
        "trading_days": len(dates),
        "outcome_prefixes": sorted(set(k[0] for r in rows[:200] for k in r.get("outs", {}))),
    }
    states = [e["signal_state"] for e in experiments]
    global_state = "DEPLOYABLE" if "DEPLOYABLE" in states else ("WATCH_SCOUT" if "WATCH_SCOUT" in states else "REJECTED")
    out = {
        "generated_at": datetime.now().isoformat(),
        "data_coverage": data_coverage,
        "causality_audit": [
            "L5/S5 experiments exclude first30, vwap_dev5, and rel_vol.",
            "L6 experiments may use first30/vwap_dev5 because entry is after those features are knowable.",
            "Every fold has a one-day embargo between train and test windows.",
            "Config selection is train-only; test window is never used to choose weights/gates/stops.",
        ],
        "multiple_testing_count": len(mn_configs) + len(late_configs),
        "grid_note": "Operational v1 grid narrowed after a too-broad run was stopped; still includes causal early market-neutral, causal late confluence, train-selected gates, folds, bootstrap, and random-null.",
        "experiments": experiments,
        "global_signal_state": global_state,
        "global_call": "NO_DEPLOYABLE_EDGE" if global_state != "DEPLOYABLE" else "DEPLOYABLE_EDGE_REQUIRES_LIVE_ORDER_WITNESS",
    }
    json.dump(out, open(OUT, "w"), indent=2)
    print(json.dumps({
        "global_signal_state": out["global_signal_state"],
        "global_call": out["global_call"],
        "experiments": [
            {k: e[k] for k in [
                "name", "signal_state", "oos_days", "active_days_per_21", "oos_day_mean_pct",
                "oos_simple_sum_pct", "folds_positive", "folds_total",
                "p_day_block_boot_le_0", "edge_vs_null_pct", "z_vs_null",
                "max_drawdown_pct_sum"
            ]}
            for e in experiments
        ],
    }, indent=2))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
