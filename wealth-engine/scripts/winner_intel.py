#!/usr/bin/env python3
"""
HN Wealth — Winner Intelligence engine (RTX box).

Intelligence + data plumbing, NOT a broker-edge claim. It:
  1. BUILD   — per symbol-day causal features (09:15->09:40 opening structure) +
               post-09:40 outcomes (to_high / to_close / to_1245 / to_1430 / MAE /
               day%) into an isolated intel.db. No leakage: features use slots 0..4
               (known by 09:40); outcomes use slots 5..74.
  2. REPLAY  — per day: actual top gainers + whether each was capturable/knowable
               at 09:40 (circuit traps + out-of-universe flagged honestly).
  3. RANK    — two-stage: Stage A rejects predictable losers (illiquid, thin/halted,
               circuit/locked, failed gap-hold, below-VWAP, already-exhausted, wide
               stop); Stage B ranks survivors by a fitted linear upside score (small
               portable coefficients the JS worker can replicate).
  4. BACKTEST— walk-forward (train past / test unseen). Honest metrics: active days,
               win rate, avg R, avg net P&L, max loss, drawdown, loser-pick freq,
               top-winner capture, regret vs top-10 realized, reason distribution,
               vs random-null + vs old gap-ranker baseline.
  5. AUTOPSY — pick vs top realized winners+losers, why missed, rejection valid?,
               reason later wrong?, rule to change. Explicit for any date.
  6. EXPORT  — ranker_config + recent replay/autopsy/witness JSON for D1 push.

bt.db: bars5m(symbol,ts[ms],trade_date,o,h,l,c,vol) PAISE, 75 bars/day,
slot i open = 09:15+5i  (slot5 = 09:40 entry). eod(...,prev_c,...,deliv).
"""
import sqlite3, json, math, sys, argparse, os
from collections import defaultdict, deque

BT_DB    = os.environ.get("BT_DB", "bt.db")
INTEL_DB = os.environ.get("INTEL_DB", "intel.db")

def slot_of(ts_ms):
    ist_min = ((ts_ms // 1000 + 19800) % 86400) // 60
    return (ist_min - 555) // 5
ENTRY_SLOT = 5
CAUSAL_MAX = 4
EXIT_SLOTS = {"1245": 42, "1430": 63, "1510": 71}
COST_PCT   = 0.12            # round-trip MIS cost floor (matches reconcileScouts 0.0012)

try:
    import refdata as R
    FNO_SET = R.FNO_SET; N50_SET = R.NIFTY50_SET; SECTOR = R.SECTOR
except Exception:
    FNO_SET=set(); N50_SET=set(); SECTOR={}

# Stage B feature order (must match the JS worker's replication)
FEAT_KEYS = ["drive_pct","pos_vs_vwap_pct","log_relvol","gap_pct","log_liq","or_pct","prior_day_ret","is_fno"]

# Stage A loss-avoidance gate thresholds (published into ranker_config so JS uses identical values).
# Two kinds of rule: bar-based (need 09:15-09:40 bars; used in backtest) and preopen-only
# (gap×liquidity; the JS worker can apply these LIVE from preopen_snapshot+EOD even with
# the intraday_bars feed dead — this is the deployable causal core).
THR = dict(min_liq=10.0, min_bars=55, max_locked=2, gap_fade_g=2.0, gap_fade_d=-1.0,
           vwap_floor=-0.75, max_or=12.0, max_runup=8.0, runup_pos=0.85,
           preopen_circuit_gap=6.0, preopen_circuit_liq=60.0)

def f2(x):
    try:
        v = float(x)
        if v != v: return None
        return round(v, 4)
    except Exception: return None

# ════════════════════════════════════════════════════════════════════════════
def build(limit_days=None):
    src = sqlite3.connect(BT_DB); src.row_factory = sqlite3.Row
    days = [r[0] for r in src.execute("SELECT DISTINCT trade_date FROM bars5m ORDER BY trade_date")]
    if limit_days: days = days[-limit_days:]
    out = sqlite3.connect(INTEL_DB)
    out.execute("DROP TABLE IF EXISTS intel_features")
    out.execute("""CREATE TABLE intel_features (
        trade_date TEXT, symbol TEXT,
        prev_close INTEGER, day_open INTEGER, entry INTEGER, bars_present INTEGER,
        gap_pct REAL, drive_pct REAL, ret_by_0940_pct REAL, pos_vs_vwap_pct REAL,
        or_pct REAL, pos_in_range REAL, rel_vol REAL, liq20_cr REAL, prior_day_ret REAL,
        opening_locked INTEGER, near_band INTEGER, is_fno INTEGER, is_n50 INTEGER, sector TEXT,
        to_high_pct REAL, to_close_pct REAL, to_1245_pct REAL, to_1430_pct REAL,
        mae_pct REAL, day_pct REAL, circuit_trap INTEGER, tradable_winner INTEGER,
        PRIMARY KEY (trade_date, symbol))""")
    last_close = {}; prev_prev = {}
    openvol_hist = defaultdict(lambda: deque(maxlen=20))
    turn_hist    = defaultdict(lambda: deque(maxlen=20))
    nrows = 0
    for di, d in enumerate(days):
        rows = src.execute("SELECT symbol,ts,o,h,l,c,vol FROM bars5m WHERE trade_date=? ORDER BY symbol, ts", (d,)).fetchall()
        bysym = defaultdict(list)
        for r in rows: bysym[r["symbol"]].append(r)
        recs = []
        for sym, brs in bysym.items():
            slot = {}
            for b in brs:
                s = slot_of(b["ts"])
                if 0 <= s <= 74 and s not in slot: slot[s] = b
            day_open = slot[0]["o"] if 0 in slot else (brs[0]["o"] if brs else None)
            if ENTRY_SLOT in slot: entry = slot[ENTRY_SLOT]["o"]
            elif 4 in slot: entry = slot[4]["c"]
            elif 0 in slot: entry = slot[0]["o"]
            else: entry = None
            pc = last_close.get(sym); ppc = prev_prev.get(sym)
            day_turn = sum((b["vol"] or 0)*(b["c"] or 0) for b in brs)/1e9
            cw = [slot[s] for s in range(0, CAUSAL_MAX+1) if s in slot]
            feat = None
            if entry and entry > 0 and cw and pc and pc > 0:
                or_high = max(b["h"] for b in cw); or_low = min(b["l"] for b in cw)
                rng = or_high - or_low
                c0940 = slot[4]["c"] if 4 in slot else cw[-1]["c"]
                vol0 = sum((b["vol"] or 0) for b in cw)
                vwap = (sum((b["vol"] or 0)*(b["c"] or 0) for b in cw)/vol0) if vol0 > 0 else c0940
                ovh = openvol_hist[sym]; ovh_mean = (sum(ovh)/len(ovh)) if ovh else 0
                relvol = (vol0/ovh_mean) if ovh_mean > 0 else None
                th = turn_hist[sym]; liq20 = (sum(th)/len(th)) if th else None
                gap = 100*(day_open-pc)/pc
                feat = dict(
                    gap_pct=gap, drive_pct=100*(c0940-day_open)/day_open if day_open else 0.0,
                    ret_by_0940_pct=100*(entry-pc)/pc, pos_vs_vwap_pct=100*(entry-vwap)/vwap if vwap else 0.0,
                    or_pct=100*rng/day_open if day_open else 0.0,
                    pos_in_range=(entry-or_low)/rng if rng > 0 else 1.0,
                    rel_vol=relvol, liq20_cr=liq20, prior_day_ret=100*(pc-ppc)/ppc if ppc else None,
                    opening_locked=sum(1 for b in cw if b["h"] == b["l"]), near_band=1 if abs(gap) >= 18 else 0)
            outc = None
            if entry and entry > 0:
                after = [slot[s] for s in range(ENTRY_SLOT, 75) if s in slot]
                close = brs[-1]["c"]
                if after:
                    hi = max(b["h"] for b in after)
                    def at(slk):
                        if slk in slot: return slot[slk]["o"]
                        prior = [s for s in slot if ENTRY_SLOT <= s <= slk]
                        return slot[max(prior)]["c"] if prior else close
                    mae_window = [slot[s] for s in range(ENTRY_SLOT, EXIT_SLOTS["1430"]+1) if s in slot] or after
                    mae_lo = min(b["l"] for b in mae_window)
                    outc = dict(
                        to_high_pct=100*(hi-entry)/entry, to_close_pct=100*(close-entry)/entry,
                        to_1245_pct=100*(at(EXIT_SLOTS["1245"])-entry)/entry,
                        to_1430_pct=100*(at(EXIT_SLOTS["1430"])-entry)/entry,
                        mae_pct=100*(mae_lo-entry)/entry, day_pct=100*(close-pc)/pc if pc else None)
            if feat and outc:
                ct = 1 if (feat["gap_pct"] >= 5 and outc["to_high_pct"] < 0.3) else 0
                tw = 1 if (outc["to_high_pct"] >= 3 and outc["to_1430_pct"] >= 1 and ct == 0) else 0
                recs.append((d, sym, pc, day_open, entry, len(brs),
                    f2(feat["gap_pct"]), f2(feat["drive_pct"]), f2(feat["ret_by_0940_pct"]), f2(feat["pos_vs_vwap_pct"]),
                    f2(feat["or_pct"]), f2(feat["pos_in_range"]), f2(feat["rel_vol"]), f2(feat["liq20_cr"]), f2(feat["prior_day_ret"]),
                    feat["opening_locked"], feat["near_band"], 1 if sym in FNO_SET else 0, 1 if sym in N50_SET else 0, SECTOR.get(sym, "OTHER"),
                    f2(outc["to_high_pct"]), f2(outc["to_close_pct"]), f2(outc["to_1245_pct"]), f2(outc["to_1430_pct"]),
                    f2(outc["mae_pct"]), f2(outc["day_pct"]), ct, tw))
            if cw: openvol_hist[sym].append(sum((b["vol"] or 0) for b in cw))
            turn_hist[sym].append(day_turn)
            if sym in last_close: prev_prev[sym] = last_close[sym]
            last_close[sym] = brs[-1]["c"]
        out.executemany("INSERT OR REPLACE INTO intel_features VALUES (%s)" % ",".join("?"*28), recs)
        nrows += len(recs)
        if di % 40 == 0: print(f"  ...{d} ({di+1}/{len(days)}) rows={nrows}", flush=True)
    out.execute("CREATE INDEX idx_if_date ON intel_features(trade_date)")
    out.commit(); print(f"BUILD done: {nrows} rows / {len(days)} days -> {INTEL_DB}")
    src.close(); out.close()

# ════════════════════════════════════════════════════════════════════════════
def load_days():
    db = sqlite3.connect(INTEL_DB); db.row_factory = sqlite3.Row
    days = [r[0] for r in db.execute("SELECT DISTINCT trade_date FROM intel_features ORDER BY trade_date")]
    by = {}
    for d in days:
        by[d] = [dict(r) for r in db.execute("SELECT * FROM intel_features WHERE trade_date=?", (d,)).fetchall()]
    db.close(); return days, by

def stage_a(r, thr=THR):
    """Causal loss-avoidance gate. Returns (passed, reasons)."""
    reasons = []
    liq = r.get("liq20_cr")
    if liq is None or liq < thr["min_liq"]: reasons.append("illiquid")
    if (r.get("bars_present") or 0) < thr["min_bars"]: reasons.append("thin_or_halted")
    if (r.get("opening_locked") or 0) >= thr["max_locked"] or r.get("near_band"): reasons.append("circuit_locked")
    g = r.get("gap_pct") or 0; dr = r.get("drive_pct") or 0
    if g >= thr["gap_fade_g"] and dr <= thr["gap_fade_d"]: reasons.append("failed_gap_hold")
    vw = r.get("pos_vs_vwap_pct")
    if vw is not None and vw < thr["vwap_floor"]: reasons.append("below_vwap")
    orp = r.get("or_pct")
    if orp is not None and orp > thr["max_or"]: reasons.append("stop_too_wide")
    if (r.get("ret_by_0940_pct") or 0) >= thr["max_runup"] and (r.get("pos_in_range") or 0) >= thr["runup_pos"]:
        reasons.append("already_exhausted_circuit_risk")
    # preopen-only circuit proxy (live-applicable): a big gap on a thin name tends to lock
    # or reverse — catches SETL-type traps (gap 7.96% on ~27Cr) before any bar exists.
    if g >= thr["preopen_circuit_gap"] and (liq is not None and liq < thr["preopen_circuit_liq"]):
        if "circuit_locked" not in reasons: reasons.append("preopen_circuit_risk")
    return (len(reasons) == 0, reasons)

def featvec(r, med):
    relvol = r.get("rel_vol"); liq = r.get("liq20_cr")
    raw = dict(
        drive_pct=r.get("drive_pct"), pos_vs_vwap_pct=r.get("pos_vs_vwap_pct"),
        log_relvol=math.log(max(relvol, 0.1)) if relvol else None,
        gap_pct=r.get("gap_pct"), log_liq=math.log(max(liq, 1.0)) if liq else None,
        or_pct=r.get("or_pct"), prior_day_ret=r.get("prior_day_ret"), is_fno=r.get("is_fno"))
    return [raw[k] if raw[k] is not None else med[k] for k in FEAT_KEYS]

TARGET = os.environ.get("TARGET", "to_high_pct")   # Stage B objective: upside potential by default
WINSOR = 25.0

def fit_linear(rows, target=None, lam=10.0):
    target = target or TARGET
    import numpy as np
    med = {}
    for k in FEAT_KEYS:
        src = {"log_relvol":"rel_vol","log_liq":"liq20_cr"}.get(k, k)
        vals = [r[src] for r in rows if r.get(src) is not None]
        med[k] = (sorted(vals)[len(vals)//2] if vals else 0.0)
    # median imputation for log features uses raw medians -> transform
    med["log_relvol"] = math.log(max(med["log_relvol"], 0.1)) if med["log_relvol"] else 0.0
    med["log_liq"] = math.log(max(med["log_liq"], 1.0)) if med["log_liq"] else 0.0
    X = np.array([featvec(r, med) for r in rows], float)
    y = np.array([max(-WINSOR, min(WINSOR, r[target])) for r in rows], float)   # winsorize
    mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    Zb = np.hstack([Z, np.ones((len(Z), 1))])
    A = Zb.T @ Zb + lam * np.eye(Zb.shape[1]); A[-1, -1] -= lam
    w = np.linalg.solve(A, Zb.T @ y)
    return dict(weights=[float(x) for x in w[:-1]], intercept=float(w[-1]),
                mu=[float(x) for x in mu], sd=[float(x) for x in sd], med=med, feat_keys=FEAT_KEYS)

def score(r, model):
    z = [(featvec(r, model["med"])[i] - model["mu"][i]) / model["sd"][i] for i in range(len(FEAT_KEYS))]
    return sum(z[i]*model["weights"][i] for i in range(len(FEAT_KEYS))) + model["intercept"]

# ════════════════════════════════════════════════════════════════════════════
def replay(topn=10, write=True):
    days, by = load_days()
    out = []
    for d in days:
        rows = by[d]
        win = sorted([r for r in rows if r["day_pct"] is not None], key=lambda r: -r["day_pct"])
        trad = sorted([r for r in rows if r["circuit_trap"] == 0 and (r["liq20_cr"] or 0) >= THR["min_liq"]], key=lambda r: -(r["to_high_pct"] or -99))
        los = sorted([r for r in rows if r["to_1430_pct"] is not None and (r["liq20_cr"] or 0) >= THR["min_liq"]], key=lambda r: (r["to_1430_pct"] or 99))
        def pk(r):
            ok, _ = stage_a(r)
            return dict(symbol=r["symbol"], day_pct=r["day_pct"], gap_pct=r["gap_pct"], drive_pct=r["drive_pct"],
                        to_high_pct=r["to_high_pct"], to_1430_pct=r["to_1430_pct"], mae_pct=r["mae_pct"],
                        liq20_cr=r["liq20_cr"], is_fno=r["is_fno"], circuit_trap=r["circuit_trap"],
                        tradable_winner=r["tradable_winner"], capturable=int(r["circuit_trap"] == 0 and (r["liq20_cr"] or 0) >= THR["min_liq"]),
                        knowable_at_0940=int(ok))
        out.append(dict(trade_date=d, n_symbols=len(rows),
            n_tradable_winners=sum(1 for r in rows if r["tradable_winner"] == 1),
            n_circuit_traps=sum(1 for r in rows if r["circuit_trap"] == 1),
            top_winners=[pk(r) for r in win[:topn]],
            top_tradable=[pk(r) for r in trad[:topn]],
            top_losers=[pk(r) for r in los[:topn]]))
    if write:
        json.dump(out, open("winner_replay.json", "w"))
        print(f"REPLAY: {len(out)} days -> winner_replay.json")
    return out

# ════════════════════════════════════════════════════════════════════════════
def pick_topk(rows, model, k):
    """Two-stage: gate, then rank survivors by upside score. Returns chosen rows."""
    survivors = []
    for r in rows:
        ok, _ = stage_a(r)
        if ok and r.get("entry"): survivors.append(r)
    survivors.sort(key=lambda r: -score(r, model))
    # one-per-sector spread
    chosen = []; used = set()
    for r in survivors:
        sec = r.get("sector") or "OTHER"
        if sec != "OTHER" and sec in used: continue
        chosen.append(r); used.add(sec)
        if len(chosen) >= k: break
    return chosen, survivors

def old_gap_pick(rows, k):
    """Baseline = the OLD live ranker: gap×liquidity, gap>=2, liq>=10, one-per-sector."""
    c = [r for r in rows if (r.get("gap_pct") or 0) >= 2.0 and (r.get("liq20_cr") or 0) >= 10 and r.get("entry")]
    def liqf(l): return 1.0 if l >= 100 else 0.9 if l >= 25 else 0.8
    c.sort(key=lambda r: -(r["gap_pct"]*liqf(r["liq20_cr"] or 0)))
    chosen = []; used = set()
    for r in c:
        sec = r.get("sector") or "OTHER"
        if sec != "OTHER" and sec in used: continue
        chosen.append(r); used.add(sec)
        if len(chosen) >= k: break
    return chosen

def backtest(min_train=120, k=3, lam=10.0):
    import numpy as np
    days, by = load_days()
    if len(days) <= min_train + 5:
        print("not enough days"); return None
    def metrics(name, picks_per_day):
        rets=[]; rs=[]; losers=0; circ=0; active=0; captures=0; regrets=[]; reasons=defaultdict(int)
        for d, chosen, daybest in picks_per_day:
            if not chosen: continue
            active += 1
            for r in chosen:
                net = (r["to_1430_pct"] or 0) - COST_PCT
                rets.append(net)
                stop = max(0.5, (r["or_pct"] or 2)/2)
                rs.append(net/stop)
                if net < 0: losers += 1
                if r["circuit_trap"] == 1: circ += 1
            best = chosen[0]
            netb = (best["to_1430_pct"] or 0) - COST_PCT
            # capture: is our top pick a tradable winner?
            if best["tradable_winner"] == 1: captures += 1
            regrets.append(max(0.0, daybest - netb))
        n = len(rets)
        return dict(strategy=name, active_days=active, picks=n,
            win_rate=round(100*sum(1 for x in rets if x>0)/n,1) if n else None,
            avg_net_pct=round(sum(rets)/n,3) if n else None,
            avg_R=round(sum(rs)/len(rs),3) if rs else None,
            max_loss_pct=round(min(rets),2) if rets else None,
            loser_pick_freq=round(100*losers/n,1) if n else None,
            circuit_picks=circ,
            top_winner_capture_pct=round(100*captures/active,1) if active else None,
            avg_regret_pct=round(sum(regrets)/len(regrets),3) if regrets else None,
            total_net_pct=round(sum(rets),2) if rets else None)
    # walk-forward
    twostage=[]; gap=[]; rnd=[]
    rng = np.random.RandomState(42)
    for i in range(min_train, len(days)):
        d = days[i]
        train = [r for j in range(0, i) for r in by[days[j]] if r.get("to_1430_pct") is not None]
        model = fit_linear(train, TARGET, lam)
        rows = by[d]
        # day's best realizable tradable net (for regret)
        cand = [ (r["to_1430_pct"] or -99) for r in rows if r["circuit_trap"]==0 and (r["liq20_cr"] or 0)>=THR["min_liq"] ]
        daybest = (max(cand)-COST_PCT) if cand else 0.0
        ch, surv = pick_topk(rows, model, k)
        twostage.append((d, ch, daybest))
        gp = old_gap_pick(rows, k); gap.append((d, gp, daybest))
        # random from gated survivors
        rc = list(surv); rng.shuffle(rc); rnd.append((d, rc[:k], daybest))
    res = dict(
        config=dict(min_train=min_train, k=k, lam=lam, cost_pct=COST_PCT, gate=THR, feat_keys=FEAT_KEYS,
                    test_days=len(days)-min_train, date_from=days[min_train], date_to=days[-1]),
        two_stage_causal=metrics("two_stage_causal", twostage),
        old_gap_ranker=metrics("old_gap_ranker", gap),
        random_gated=metrics("random_gated_null", rnd))
    # final model fit on ALL data for live use
    allrows = [r for d in days for r in by[d] if r.get("to_1430_pct") is not None]
    res["final_model"] = fit_linear(allrows, TARGET, lam)
    res["ranker_config"] = dict(version="winner_intel_v1", target=TARGET,
        gate=THR, model=res["final_model"], k=k, cost_pct=COST_PCT,
        trained_days=len(days), date_to=days[-1])
    json.dump(res, open("winner_backtest.json", "w"))
    print(json.dumps({kk: res[kk] for kk in ("config","two_stage_causal","old_gap_ranker","random_gated")}, indent=2))
    print("BACKTEST -> winner_backtest.json")
    return res

# ════════════════════════════════════════════════════════════════════════════
def autopsy(date=None, write=True):
    days, by = load_days()
    bt = json.load(open("winner_backtest.json")) if os.path.exists("winner_backtest.json") else None
    model = bt["final_model"] if bt else fit_linear([r for d in days for r in by[d] if r.get("to_1430_pct") is not None])
    targets = [date] if date else days
    out = []
    for d in targets:
        if d not in by: continue
        rows = by[d]
        chosen, _ = pick_topk(rows, model, 3)
        picks = [c["symbol"] for c in chosen]
        win = sorted([r for r in rows if r["day_pct"] is not None], key=lambda r: -r["day_pct"])[:10]
        los = sorted([r for r in rows if r["to_1430_pct"] is not None and (r["liq20_cr"] or 0)>=THR["min_liq"]], key=lambda r: r["to_1430_pct"])[:5]
        missed = []
        for w in win:
            if w["symbol"] in picks: continue
            ok, reasons = stage_a(w)
            # was the rejection valid? a rejection is "wrong" if the name was actually a tradable winner
            actually_tradable = w["tradable_winner"] == 1
            rejection_valid = (not actually_tradable) if not ok else None
            reason_later_wrong = bool((not ok) and actually_tradable)
            rule_change = None
            if reason_later_wrong:
                rule_change = "loosen: " + ",".join(reasons) + f" (it ran to_high={w['to_high_pct']}%, to1430={w['to_1430_pct']}%)"
            missed.append(dict(symbol=w["symbol"], day_pct=w["day_pct"], gap_pct=w["gap_pct"], drive_pct=w["drive_pct"],
                to_high_pct=w["to_high_pct"], to_1430_pct=w["to_1430_pct"], circuit_trap=w["circuit_trap"],
                tradable_winner=w["tradable_winner"], passed_gate=int(ok), reject_reasons=reasons,
                rejection_valid=rejection_valid, reason_later_wrong=reason_later_wrong, rule_change=rule_change))
        chosen_detail = [dict(symbol=c["symbol"], score=round(score(c, model),3), gap_pct=c["gap_pct"], drive_pct=c["drive_pct"],
            pos_vs_vwap_pct=c["pos_vs_vwap_pct"], to_high_pct=c["to_high_pct"], to_1430_pct=c["to_1430_pct"],
            tradable_winner=c["tradable_winner"], circuit_trap=c["circuit_trap"]) for c in chosen]
        out.append(dict(trade_date=d, picks=picks, chosen_detail=chosen_detail,
            best_realized_winner=(win[0]["symbol"] if win else None), best_day_pct=(win[0]["day_pct"] if win else None),
            missed_winners=missed, top_losers=[dict(symbol=l["symbol"], to_1430_pct=l["to_1430_pct"], picked=int(l["symbol"] in picks)) for l in los]))
    if write:
        json.dump(out, open("missed_autopsy.json", "w"))
        print(f"AUTOPSY: {len(out)} days -> missed_autopsy.json")
        if date and out: print(json.dumps(out[0], indent=2))
    return out

# ════════════════════════════════════════════════════════════════════════════
# ════════════════════════════════════════════════════════════════════════════
# ODDS — honest base rates of the #1 pick (walk-forward). Powers the "best shot"
# card: the real probability a pick like today's reaches +5%/+2% intraday, the
# win rate, expected R. Never a fabricated confidence — the live system shows THIS.
def odds(min_train=120, k=1, lam=10.0):
    import statistics as st
    days, by = load_days()
    tohi=[]; net1430=[]; rs=[]
    for i in range(min_train, len(days)):
        train = [r for j in range(0, i) for r in by[days[j]] if r.get("to_1430_pct") is not None]
        model = fit_linear(train, TARGET, lam)
        ch, _ = pick_topk(by[days[i]], model, k)
        if not ch or ch[0].get("to_high_pct") is None: continue
        p = ch[0]; net = (p["to_1430_pct"] or 0) - COST_PCT
        tohi.append(p["to_high_pct"]); net1430.append(net)
        rs.append(net / max(0.5, (p["or_pct"] or 2)/2))
    n = len(tohi) or 1
    res = dict(method="walk_forward_top1", n_days=len(tohi),
        p_hit_5pct=round(100*sum(1 for x in tohi if x>=5)/n,1),
        p_hit_3pct=round(100*sum(1 for x in tohi if x>=3)/n,1),
        p_hit_2pct=round(100*sum(1 for x in tohi if x>=2)/n,1),
        avg_to_high_pct=round(sum(tohi)/n,2),
        median_to_high_pct=round(st.median(tohi),2) if tohi else None,
        win_rate_pct=round(100*sum(1 for x in net1430 if x>0)/n,1),
        avg_net_1430_pct=round(sum(net1430)/n,3),
        avg_R=round(sum(rs)/len(rs),3) if rs else None,
        worst_day_pct=round(min(net1430),2) if net1430 else None)
    json.dump(res, open("odds.json","w")); print(json.dumps(res, indent=2)); return res

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build","replay","backtest","autopsy","odds"])
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--date", default=None)
    ap.add_argument("--k", type=int, default=3)
    a = ap.parse_args()
    if a.cmd == "build": build(a.days)
    elif a.cmd == "replay": replay()
    elif a.cmd == "backtest": backtest(k=a.k)
    elif a.cmd == "autopsy": autopsy(a.date)
    elif a.cmd == "odds": odds(k=a.k)
