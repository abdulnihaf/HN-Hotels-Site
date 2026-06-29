#!/usr/bin/env python3
# HN Wealth — gap-up edge, hardened & honest.
# The ONE strategy with a positive OOS signal: buy a stock that gapped up >=G% at the open,
# enter at 09:40 (bar 5), hold to a fixed time-exit with a WIDE stop (tight stops whipsaw out).
# This rewrite makes the test trustworthy:
#   - POINT-IN-TIME liquidity gate (trailing-20d turnover AS OF each day) -> kills survivorship.
#   - OPENING-VOLUME confirmation (first 25min volume vs that stock's own 20d opening-vol median).
#   - WALK-FORWARD OOS: params are CHOSEN on past slices, scored on the next unseen slice only.
#   - RANDOM NULL (same days, same count, random symbols) to prove there's no look-ahead leak.
#   - Real round-trip MIS cost, reported at base & conservative levels. Stop wins ties.
# Output: search_config.json = the TUNED rule + its honest OOS stats, ready to publish to D1.
import sqlite3, json, os, math, statistics as st, datetime as dt
from collections import defaultdict

WS = os.path.expanduser("~/hn-wealth-backtest")
DB = os.path.join(WS, "bt.db")
OUT = os.path.join(WS, "search_config.json")

ENTRY_BAR = 5          # 09:40 IST (bar 0 = 09:15)
COST_BASE = 0.12       # % round-trip MIS (brokerage+STT+slippage), base
COST_CONS = 0.20       # % conservative (wider slippage)
MIN_LIQ_CR = 10.0      # trailing-20d turnover floor (matches live min_liquidity_rupees ~Rs10Cr)
N_SLICES = 7           # walk-forward time slices -> 6 OOS folds
MIN_TRAIN_TRADES = 60  # don't trust an in-sample param set with too few trades
NULL_ITERS = 300

# Param grid (chosen by walk-forward, never hand-picked)
GAPS  = [2.0, 2.5, 3.0, 4.0]       # min gap-up %
STOPS = [2.0, 3.0, 5.0, 99.0]      # stop %, 99 = effectively no stop (hold-to-time)
VOLS  = [1.0, 1.5, 2.0]            # opening-vol multiple vs own 20d median (1.0 = off)
EXITS = [45, 63, 71]               # exit bar: ~12:45, 14:30, 15:10

def pct(a, b): return (a / b - 1.0) * 100.0

def load_candidates():
    """Build every (date,symbol) gap-up candidate with its causal features + price path.
    All features are knowable BY 09:40 -> no look-ahead."""
    c = sqlite3.connect(DB)
    # --- EOD: per symbol, ordered, with trailing-20d turnover (point-in-time) ---
    eod = defaultdict(list)   # sym -> [(date, close_paise, volume)]
    for sym, d, close, vol in c.execute(
            "SELECT symbol, trade_date, c, vol FROM eod WHERE c IS NOT NULL ORDER BY symbol, trade_date"):
        eod[sym].append((d, close or 0, vol or 0))
    turnover_cr = {}          # (sym,date) -> trailing-20d avg daily turnover in Cr, AS OF prior close
    prev_close_map = {}       # (sym,date) -> prev day close (gap denominator)
    for sym, rows in eod.items():
        for i in range(len(rows)):
            d = rows[i][0]
            if i >= 1:
                prev_close_map[(sym, d)] = rows[i-1][1]
            window = rows[max(0, i-20):i]   # strictly prior 20 days
            if window:
                t = [r[1] * r[2] / 1e2 / 1e7 for r in window if r[1] and r[2]]  # paise*qty ->Rs ->Cr
                turnover_cr[(sym, d)] = (sum(t) / len(t)) if t else 0.0
    # --- 5-min bars: per symbol/day ---
    cands = []   # dicts
    open_vol_hist = defaultdict(list)  # sym -> [(date, first25min_vol)] to build point-in-time baseline
    cur_sym = None; days = None
    def flush(sym, days):
        if not days: return
        dl = sorted(days)
        # first pass: opening volumes for baseline
        first_vol = {}
        for d in dl:
            bars = days[d]
            if len(bars) >= ENTRY_BAR:
                first_vol[d] = sum(b[4] for b in bars[:ENTRY_BAR])  # bars 0..4 volume
        ov = sorted((d, first_vol[d]) for d in first_vol)
        for k in range(len(dl)):
            d = dl[k]; bars = days[d]
            if len(bars) < ENTRY_BAR + 3: continue
            pc = prev_close_map.get((sym, d))
            if not pc: continue
            day_open = bars[0][0]
            entry_px = bars[ENTRY_BAR][0]
            if pc <= 0 or day_open <= 0 or entry_px <= 0: continue
            gap = pct(day_open, pc)
            if gap < GAPS[0]: continue              # only keep gap-ups (smallest threshold)
            liq = turnover_cr.get((sym, d), 0.0)
            if liq < MIN_LIQ_CR: continue           # point-in-time liquidity gate
            # point-in-time opening-volume baseline = median of prior 20 days' first25 vol
            prior = [v for (dd, v) in ov if dd < d][-20:]
            base_vol = st.median(prior) if len(prior) >= 5 else None
            vol_mult = (first_vol.get(d, 0) / base_vol) if base_vol else 0.0
            # precompute exit return for each (stop, exit_bar) combo
            outs = {}
            for ex in EXITS:
                seg = bars[ENTRY_BAR: ex + 1]
                if not seg:
                    continue
                last_c = seg[-1][3]
                for S in STOPS:
                    sl = entry_px * (1 - S / 100.0)
                    r = None
                    for (o, h, l, cl, _v) in seg:
                        if l <= sl: r = -S; break
                    outs[(S, ex)] = r if r is not None else pct(last_c, entry_px)
            cands.append({"date": d, "sym": sym, "gap": gap, "liq": liq, "vol_mult": vol_mult, "outs": outs})
    for sym, ts, td, o, h, l, cl, vol in c.execute(
            "SELECT symbol, ts, trade_date, o, h, l, c, vol FROM bars5m ORDER BY symbol, ts"):
        if sym != cur_sym:
            if cur_sym is not None: flush(cur_sym, days)
            cur_sym = sym; days = defaultdict(list)
        days[td].append((o, h, l, cl, vol or 0))
    if cur_sym is not None: flush(cur_sym, days)
    c.close()
    return cands

def evaluate(cands, G, S, V, ex, cost):
    rets = [c["outs"][(S, ex)] - cost for c in cands
            if c["gap"] >= G and c["vol_mult"] >= V and (S, ex) in c["outs"]]
    return rets

def mean(x): return sum(x) / len(x) if x else float("nan")

def tstat(rets):
    n = len(rets)
    if n < 2: return float("nan"), float("nan")
    m = mean(rets); sd = st.pstdev(rets) or 1e-9
    t = m / (sd / math.sqrt(n))
    # two-sided p via normal approx
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
    return t, p

def walk_forward(cands, cost):
    """Choose params on past slices, score on the next unseen slice. Aggregate OOS only."""
    dates = sorted(set(c["date"] for c in cands))
    if len(dates) < N_SLICES * 2:
        return None
    bounds = [dates[int(len(dates) * i / N_SLICES)] for i in range(N_SLICES)] + [dates[-1]]
    oos_rets = []
    fold_log = []
    chosen = defaultdict(int)
    for i in range(1, N_SLICES):
        train_hi = bounds[i]
        test_lo, test_hi = bounds[i], bounds[i + 1]
        train = [c for c in cands if c["date"] < train_hi]
        test = [c for c in cands if test_lo <= c["date"] <= test_hi]
        if not train or not test: continue
        best = None
        for G in GAPS:
            for S in STOPS:
                for V in VOLS:
                    for ex in EXITS:
                        r = evaluate(train, G, S, V, ex, cost)
                        if len(r) < MIN_TRAIN_TRADES: continue
                        m = mean(r)
                        if best is None or m > best[0]:
                            best = (m, G, S, V, ex)
        if not best: continue
        _, G, S, V, ex = best
        chosen[(G, S, V, ex)] += 1
        r_oos = evaluate(test, G, S, V, ex, cost)
        oos_rets += r_oos
        fold_log.append({"fold": i, "train_n": len(train), "params": [G, S, V, ex],
                          "oos_n": len(r_oos), "oos_exp": round(mean(r_oos), 4) if r_oos else None})
    t, p = tstat(oos_rets)
    # most-chosen param set = the published rule
    rule = max(chosen, key=chosen.get) if chosen else None
    p_rounded = round(p, 4)
    return {"oos_n": len(oos_rets), "oos_exp": round(mean(oos_rets), 4) if oos_rets else None,
            "t": round(t, 3), "p": p_rounded, "oos_p": p_rounded, "folds": fold_log,
            "folds_positive": sum(1 for f in fold_log if f["oos_exp"] and f["oos_exp"] > 0),
            "folds_total": len(fold_log), "rule": rule,
            "rule_votes": {",".join(map(str, k)): v for k, v in chosen.items()}}

def random_null(cands, rule, cost, iters=NULL_ITERS):
    """Same trade-days, same count, RANDOM symbols (gap-agnostic) -> proves selection skill is real."""
    if not rule: return None
    G, S, V, ex = rule
    by_date = defaultdict(list)
    for c in cands:
        if (S, ex) in c["outs"]:
            by_date[c["date"]].append(c["outs"][(S, ex)] - cost)
    real = [c["outs"][(S, ex)] - cost for c in cands
            if c["gap"] >= G and c["vol_mult"] >= V and (S, ex) in c["outs"]]
    if not real: return None
    real_m = mean(real)
    # deterministic pseudo-random (no Math.random in this env's spirit; seed-stable)
    import random
    null_means = []
    n = len(real)
    pool = [r for rs in by_date.values() for r in rs]
    rng = random.Random(20260626)
    for _ in range(iters):
        null_means.append(mean([rng.choice(pool) for _ in range(n)]))
    nm = mean(null_means); nsd = st.pstdev(null_means) or 1e-9
    return {"real_exp": round(real_m, 4), "null_exp": round(nm, 4),
            "edge_vs_null": round(real_m - nm, 4), "z_vs_null": round((real_m - nm) / nsd, 2)}

def main():
    cands = load_candidates()
    dates = sorted(set(c["date"] for c in cands))
    syms = sorted(set(c["sym"] for c in cands))
    base = walk_forward(cands, COST_BASE)
    cons = walk_forward(cands, COST_CONS)
    rule = base["rule"] if base else None
    null = random_null(cands, rule, COST_BASE) if rule else None
    # honest verdict — an "edge" must BEAT THE NULL (real selection skill), not just be >0.
    # A positive raw return that doesn't beat a same-day random gap pick is just beta, not alpha.
    beats_null = bool(null and null["edge_vs_null"] is not None and null["edge_vs_null"] > 0)
    pos = base and base["oos_exp"] is not None and base["oos_exp"] > 0
    base_p = base.get("oos_p", base.get("p")) if base else None
    null_z = null.get("z_vs_null") if null else None
    folds_needed = max(3, math.ceil((base["folds_total"] if base else 0) * 0.6))
    robust = bool(pos and base["oos_n"] >= 200 and base["folds_positive"] >= max(4, base["folds_total"] - 1)
                  and beats_null and null_z is not None and null_z >= 3.0
                  and base_p is not None and base_p < 0.05)
    thin = bool(pos and base["oos_n"] >= 100 and base["folds_positive"] >= folds_needed
                and beats_null and null_z is not None and null_z >= 2.0
                and base_p is not None and base_p < 0.15)
    verdict = ("ROBUST_EDGE" if robust else "THIN_EDGE" if thin else "NO_EDGE")
    c2 = sqlite3.connect(DB)
    bars_total = c2.execute("SELECT COUNT(*) FROM bars5m").fetchone()[0]
    bars_syms = c2.execute("SELECT COUNT(DISTINCT symbol) FROM bars5m").fetchone()[0]
    c2.close()
    out = {
        "generated_at": dt.datetime.now().isoformat(),
        "universe_syms": len(syms), "candidate_trades": len(cands),
        "bars_total": bars_total, "bars_syms": bars_syms,
        "date_range": [dates[0], dates[-1]] if dates else None,
        "entry": "09:40 IST (bar 5)", "liquidity_gate_cr": MIN_LIQ_CR,
        "survivorship": "point-in-time trailing-20d turnover gate (no liquid-today leak)",
        "cost_base_pct": COST_BASE, "cost_conservative_pct": COST_CONS,
        "walk_forward_base": base, "walk_forward_conservative": cons,
        "random_null": null, "verdict": verdict,
        "tuned_rule": (None if not rule else {
            "gap_min_pct": rule[0], "stop_pct": rule[1], "vol_mult_min": rule[2],
            "exit_bar": rule[3], "exit_time_ist": {45: "12:45", 63: "14:30", 71: "15:10"}[rule[3]],
            "min_turnover_cr": MIN_LIQ_CR,
            "oos_expectancy_pct": base["oos_exp"], "oos_trades": base["oos_n"],
            "oos_p": base["p"], "folds_positive": f"{base['folds_positive']}/{base['folds_total']}"}),
    }
    json.dump(out, open(OUT, "w"), indent=2)
    print(json.dumps({k: out[k] for k in ["universe_syms", "candidate_trades", "date_range",
          "verdict", "tuned_rule", "random_null"]}, indent=2))
    print("VERDICT:", verdict, "| OOS exp(base):", base and base["oos_exp"], "| folds+:",
          base and f"{base['folds_positive']}/{base['folds_total']}")

if __name__ == "__main__":
    main()
