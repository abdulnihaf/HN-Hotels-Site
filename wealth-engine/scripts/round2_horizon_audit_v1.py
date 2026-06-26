#!/usr/bin/env python3
"""HN Wealth multi-horizon proof audit.

This script answers a narrower question than the strategy search:
which requested horizons can be tested with the cached RTX data, and what does
the causal Round-2 confluence model show inside each valid horizon?

It intentionally refuses to print a 2y/3y result when the underlying intraday
candidate store does not cover that horizon.
"""

import json
import math
import os
import pickle
import statistics as st
from collections import defaultdict
from datetime import datetime

import round2_causal_confluence_v1 as core

WS = os.path.expanduser("~/hn-wealth-backtest")
PKL = os.path.join(WS, "cands.pkl")
OUT = os.path.join(WS, "round2_horizon_audit_v1_results.json")

HORIZONS = [
    ("1m", 21),
    ("2m", 42),
    ("3m", 63),
    ("6m", 126),
    ("1y", 252),
    ("2y", 504),
    ("3y", 756),
]


def build_configs():
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
    for weights in early_weights:
        for k in [3, 5, 8]:
            for exit_bar in [45, 71]:
                for gate in gates:
                    mn_configs.append({
                        "kind": "early_market_neutral",
                        "weights": weights,
                        "k": k,
                        "key_l": ["L5", 99.0, exit_bar],
                        "key_s": ["S5", 99.0, exit_bar],
                        "gate": gate,
                        "causal_entry": "L5/S5: uses no first30/vwap_dev5/rel_vol",
                    })

    late_configs = []
    for weights in late_weights:
        for k in [1, 3, 5]:
            for exit_bar in [45, 71]:
                for fno_only in [False, True]:
                    for gate in gates:
                        late_configs.append({
                            "kind": "late_confluence_long",
                            "weights": weights,
                            "k": k,
                            "key": ["L6", 99.0, exit_bar],
                            "fno_only": fno_only,
                            "gate": gate,
                            "causal_entry": "L6: first30/vwap_dev5 only after the 09:40-09:45 bar is knowable",
                        })
    return mn_configs, late_configs


def summarize_dates(rows):
    dates = sorted(set(r["date"] for r in rows))
    return {
        "candidate_rows": len(rows),
        "symbols": len(set(r["sym"] for r in rows)),
        "fno_symbols": len(set(r["sym"] for r in rows if r.get("isf"))),
        "trading_days": len(dates),
        "date_range": [dates[0], dates[-1]] if dates else None,
    }


def horizon_result(rows, all_dates, label, days, mn_configs, late_configs):
    if len(all_dates) < days:
        return {
            "horizon": label,
            "requested_trading_days": days,
            "valid": False,
            "reason": "candidate_store_too_short",
            "available_trading_days": len(all_dates),
            "available_date_range": [all_dates[0], all_dates[-1]],
        }

    dates = all_dates[-days:]
    hset = set(dates)
    hrows = [r for r in rows if r["date"] in hset]
    coverage = summarize_dates(hrows)
    folds_possible = max(0, math.floor((len(dates) - core.TRAIN - core.EMBARGO - core.TEST) / core.STEP) + 1)
    if folds_possible < 1:
        return {
            "horizon": label,
            "requested_trading_days": days,
            "valid": False,
            "reason": "not_enough_days_for_walk_forward_105_train_21_test",
            "coverage": coverage,
        }

    early = core.walk_forward(hrows, dates, mn_configs, core.eval_market_neutral, core.null_for_market_neutral, "early_market_neutral_v2")
    late = core.walk_forward(hrows, dates, late_configs, core.eval_long, core.null_for_long, "late_confluence_long_v1")
    experiments = [early, late]
    states = [e["signal_state"] for e in experiments]
    global_state = "DEPLOYABLE" if "DEPLOYABLE" in states else ("WATCH_SCOUT" if "WATCH_SCOUT" in states else "REJECTED")
    return {
        "horizon": label,
        "requested_trading_days": days,
        "valid": True,
        "coverage": coverage,
        "walk_forward_folds_possible": folds_possible,
        "experiments": [
            {
                "name": e["name"],
                "signal_state": e["signal_state"],
                "oos_days": e["oos_days"],
                "active_days_per_21": e["active_days_per_21"],
                "oos_day_mean_pct": e["oos_day_mean_pct"],
                "oos_simple_sum_pct": e["oos_simple_sum_pct"],
                "folds_positive": e["folds_positive"],
                "folds_total": e["folds_total"],
                "p_day_block_boot_le_0": e["p_day_block_boot_le_0"],
                "edge_vs_null_pct": e["edge_vs_null_pct"],
                "z_vs_null": e["z_vs_null"],
                "max_drawdown_pct_sum": e["max_drawdown_pct_sum"],
                "capacity": e["capacity"],
            }
            for e in experiments
        ],
        "global_signal_state": global_state,
        "global_call": "NO_DEPLOYABLE_EDGE" if global_state != "DEPLOYABLE" else "DEPLOYABLE_REQUIRES_LIVE_ORDER_WITNESS",
    }


def main():
    raw = pickle.load(open(PKL, "rb"))["cands"]
    fields = sorted(set(core.EARLY_FIELDS + core.LATE_FIELDS))
    rows = core.zscore_by_day(raw, fields)
    all_dates = sorted(set(r["date"] for r in rows))
    mn_configs, late_configs = build_configs()
    results = [
        horizon_result(rows, all_dates, label, days, mn_configs, late_configs)
        for label, days in HORIZONS
    ]
    out = {
        "generated_at": datetime.now().isoformat(),
        "artifact": "round2_horizon_audit_v1",
        "source_candidate_store": PKL,
        "overall_coverage": summarize_dates(rows),
        "law": "Invalid horizons are refused, not inferred. WATCH/SCOUT is not a buy.",
        "walk_forward_contract": {
            "train_days": core.TRAIN,
            "embargo_days": core.EMBARGO,
            "test_days": core.TEST,
            "step_days": core.STEP,
        },
        "horizons": results,
    }
    json.dump(out, open(OUT, "w"), indent=2)
    print(json.dumps({
        "overall_coverage": out["overall_coverage"],
        "horizons": [
            {
                "horizon": r["horizon"],
                "valid": r["valid"],
                "global_signal_state": r.get("global_signal_state"),
                "reason": r.get("reason"),
                "experiments": [
                    {
                        "name": e["name"],
                        "state": e["signal_state"],
                        "sum": e["oos_simple_sum_pct"],
                        "folds": f'{e["folds_positive"]}/{e["folds_total"]}',
                        "p": e["p_day_block_boot_le_0"],
                        "z": e["z_vs_null"],
                    } for e in r.get("experiments", [])
                ],
            }
            for r in results
        ],
    }, indent=2))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
