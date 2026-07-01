#!/usr/bin/env python3
"""Quant forward timer.

Runs the high-cadence layer between Quant's morning intelligence plan and any
possible broker order. Default mode is PAPER: it decides, logs, and optionally
writes a D1 witness, but never places a broker order.

Real mode is deliberately hard to activate:
  --mode real --allow-real is required, AND the live /api/kite execution gate
  must already authorize the exact broker-facing pick. The server still enforces
  all existing order gates, so this script cannot bypass the Wealth app safety
  contract.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
DEFAULT_BASE = "https://trade.hnhotels.in"
DEFAULT_TRAIL_DIR = pathlib.Path.home() / "hn-wealth-backtest" / "quant_timer_trail"


def load_env_file(path: pathlib.Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def now_ist() -> dt.datetime:
    return dt.datetime.now(tz=IST)


def today_ist() -> str:
    return now_ist().strftime("%Y-%m-%d")


def parse_hhmm(value: str | None, default: dt.time) -> dt.time:
    if not value:
        return default
    s = value.strip().replace(":", "")
    if len(s) != 4 or not s.isdigit():
        raise ValueError(f"Invalid HHMM time: {value}")
    return dt.time(int(s[:2]), int(s[2:]), tzinfo=IST)


def current_minutes() -> int:
    n = now_ist()
    return n.hour * 60 + n.minute


def time_minutes(t: dt.time) -> int:
    return t.hour * 60 + t.minute


def paise_from_rs(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(round(float(v) * 100))
    except (TypeError, ValueError):
        return None


def as_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class Api:
    def __init__(self, base: str, key: str, timeout: int = 25) -> None:
        self.base = base.rstrip("/")
        self.key = key
        self.timeout = timeout

    def request(self, path: str, query: dict[str, str] | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
        query = query or {}
        qs = urllib.parse.urlencode(query)
        url = f"{self.base}{path}" + (f"?{qs}" if qs else "")
        data = None
        headers = {"x-api-key": self.key, "user-agent": "curl/8.7.1 quant-forward-timer/1.0"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"error": raw[:500]}
            parsed.setdefault("http_status", e.code)
            return parsed

    def trading(self, action: str) -> dict[str, Any]:
        return self.request("/api/trading", {"action": action})

    def kite(self, action: str, **params: str) -> dict[str, Any]:
        q = {"action": action}
        q.update(params)
        return self.request("/api/kite", q)

    def post_kite(self, action: str, body: dict[str, Any]) -> dict[str, Any]:
        return self.request("/api/kite", {"action": action}, body)


def d1_query(sql: str, params: list[Any]) -> dict[str, Any]:
    token = os.environ.get("CF_D1_TOKEN")
    account = os.environ.get("CF_ACCT")
    database = os.environ.get("D1_DB") or "1e3cea30-5990-43d2-a9de-b749d32e225a"
    if not token or not account:
        raise RuntimeError("CF_D1_TOKEN/CF_ACCT missing")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query"
    body = json.dumps({"sql": sql, "params": params}).encode()
    req = urllib.request.Request(
        url,
        data=body,
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                "user-agent": "curl/8.7.1 quant-forward-timer/1.0",
            },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def d1_write_event(event: dict[str, Any]) -> None:
    sql = """
      INSERT INTO quant_timer_events
        (trade_date, ts, symbol, state_before, state_after, decision,
         ltp_paise, entry_paise, stop_paise, target_paise, qty, pnl_pct,
         trigger_json, action_json, gate_json, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    d1_query(sql, [
        event.get("trade_date"),
        event.get("ts"),
        event.get("symbol"),
        event.get("state_before"),
        event.get("state_after"),
        event.get("decision"),
        event.get("ltp_paise"),
        event.get("entry_paise"),
        event.get("stop_paise"),
        event.get("target_paise"),
        event.get("qty"),
        event.get("pnl_pct"),
        json.dumps(event.get("trigger") or {}, sort_keys=True),
        json.dumps(event.get("action") or {}, sort_keys=True),
        json.dumps({
            "trade_authorized": event.get("gate_trade_authorized"),
            "decision": event.get("gate_decision"),
            "reasons": event.get("gate_reasons"),
        }, sort_keys=True),
        json.dumps(event.get("raw") or {}, sort_keys=True),
    ])


def latest_ltp_paise(api: Api, symbol: str) -> tuple[int | None, dict[str, Any]]:
    res = api.kite("ltp", instruments=f"NSE:{symbol}")
    data = res.get("data") or {}
    row = data.get(f"NSE:{symbol}") or {}
    return paise_from_rs(row.get("last_price")), res


def choose_plan(scout: dict[str, Any], gate: dict[str, Any]) -> dict[str, Any]:
    plan = scout.get("plan") or {}
    symbol = scout.get("primary_symbol") or gate.get("recommended_symbol")
    if not symbol:
        raise RuntimeError("No scout primary_symbol or gate recommended_symbol")
    entry = as_int(plan.get("entry_paise")) or paise_from_rs(plan.get("entry_rs"))
    stop = as_int(plan.get("stop_paise")) or paise_from_rs(plan.get("stop_rs"))
    target = as_int(plan.get("target_paise")) or paise_from_rs(plan.get("target_rs"))
    qty = as_int(plan.get("qty")) or 1
    if not entry:
        machine = gate.get("machine_execution_plan") or []
        pick = next((p for p in machine if p.get("symbol") == symbol), machine[0] if machine else {})
        entry = as_int(pick.get("entry_estimate_paise")) or as_int(pick.get("entry_paise"))
        stop = stop or as_int(pick.get("stop_paise"))
        target = target or as_int(pick.get("target_paise"))
        qty = as_int(pick.get("qty")) or qty
    if not entry:
        raise RuntimeError(f"No entry price for {symbol}")
    stop = stop or int(entry * 0.97)
    target = target or int(entry * 1.05)
    return {"symbol": symbol, "entry_paise": entry, "stop_paise": stop, "target_paise": target, "qty": qty}


def load_state(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        return {"state": "WATCHING"}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"state": "WATCHING", "state_read_error": True}


def save_state(path: pathlib.Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(path)


def append_jsonl(path: pathlib.Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(event, sort_keys=True) + "\n")


def decision_for_tick(
    mode: str,
    allow_real: bool,
    state: dict[str, Any],
    plan: dict[str, Any],
    ltp: int | None,
    gate: dict[str, Any],
    entry_deadline: dt.time,
    time_exit: dt.time,
    profit_take_pct: float,
    entry_band_pct: float,
    chase_limit_pct: float,
) -> dict[str, Any]:
    symbol = plan["symbol"]
    prior = state.get("state", "WATCHING")
    entry = int(state.get("entry_paise") or plan["entry_paise"])
    stop = int(plan["stop_paise"])
    target = max(int(plan["target_paise"]), int(entry * (1 + profit_take_pct / 100.0)))
    qty = int(plan["qty"])
    now_min = current_minutes()
    trigger: dict[str, Any] = {
        "mode": mode,
        "entry_deadline": entry_deadline.strftime("%H:%M"),
        "time_exit": time_exit.strftime("%H:%M"),
        "profit_take_pct": profit_take_pct,
        "entry_band_pct": entry_band_pct,
        "chase_limit_pct": chase_limit_pct,
    }

    if ltp is None:
        return {"decision": "WATCH", "state_after": prior, "reason": "ltp_missing", "trigger": trigger}

    pnl_pct = ((ltp - entry) / entry * 100.0) if prior in {"ENTERED_PAPER", "ENTERED_REAL"} else None
    if prior in {"EXITED", "PASSED", "BLOCKED"}:
        return {"decision": "DONE", "state_after": prior, "reason": "terminal_state", "pnl_pct": pnl_pct, "trigger": trigger}

    if prior in {"ENTERED_PAPER", "ENTERED_REAL"}:
        if ltp <= stop:
            return {"decision": "EXIT_STOP", "state_after": "EXITED", "reason": "stop_hit", "pnl_pct": pnl_pct, "trigger": trigger}
        if ltp >= target:
            return {"decision": "EXIT_PROFIT", "state_after": "EXITED", "reason": "profit_or_target_hit", "pnl_pct": pnl_pct, "trigger": trigger}
        if now_min >= time_minutes(time_exit):
            return {"decision": "EXIT_TIME", "state_after": "EXITED", "reason": "time_exit", "pnl_pct": pnl_pct, "trigger": trigger}
        return {"decision": "HOLD", "state_after": prior, "reason": "inside_risk_box", "pnl_pct": pnl_pct, "trigger": trigger}

    if now_min > time_minutes(entry_deadline):
        return {"decision": "PASS", "state_after": "PASSED", "reason": "entry_deadline_missed", "trigger": trigger}
    if ltp <= stop:
        return {"decision": "PASS", "state_after": "PASSED", "reason": "invalidated_before_entry", "trigger": trigger}

    lower = int(entry * (1 - entry_band_pct / 100.0))
    upper = int(entry * (1 + chase_limit_pct / 100.0))
    trigger.update({"entry_lower_paise": lower, "entry_upper_paise": upper})
    if lower <= ltp <= upper:
        if mode == "real":
            authorized = bool(gate.get("trade_authorized"))
            auto_allowed = allow_real and authorized
            if not auto_allowed:
                return {"decision": "BLOCKED", "state_after": "BLOCKED", "reason": "real_mode_without_live_authorized_gate", "trigger": trigger}
            return {"decision": "ENTER_REAL", "state_after": "ENTERED_REAL", "reason": "entry_band_hit", "trigger": trigger}
        return {"decision": "ENTER_PAPER", "state_after": "ENTERED_PAPER", "reason": "entry_band_hit", "trigger": trigger}
    if ltp > upper:
        return {"decision": "WATCH", "state_after": "WATCHING", "reason": "do_not_chase_wait_pullback", "trigger": trigger}
    return {"decision": "WATCH", "state_after": "WATCHING", "reason": "below_entry_wait_reclaim", "trigger": trigger}


def maybe_send_real_order(api: Api, plan: dict[str, Any], gate: dict[str, Any], tag: str) -> dict[str, Any]:
    body = {
        "exchange": "NSE",
        "tradingsymbol": plan["symbol"],
        "quantity": int(plan["qty"]),
        "product": "MIS",
        "order_type": "MARKET",
        "stop_price": round(plan["stop_paise"] / 100.0, 2),
        "target_price": round(plan["target_paise"] / 100.0, 2),
        "verdict_id": gate.get("verdict_id"),
        "tag": tag[:20],
    }
    return api.post_kite("place_bracket", body)


def maybe_square_off(api: Api, plan: dict[str, Any], mode: str, allow_real: bool, reason: str) -> dict[str, Any] | None:
    if mode != "real" or not allow_real:
        return None
    return api.post_kite("square_off", {
        "tradingsymbol": plan["symbol"],
        "exchange": "NSE",
        "product": "MIS",
        "reason": reason,
    })


def one_cycle(args: argparse.Namespace, api: Api) -> dict[str, Any]:
    scout = api.trading("scout_today")
    gate_resp = api.kite("execution_gate")
    gate = gate_resp.get("execution_gate") or gate_resp
    plan = choose_plan(scout, gate)
    symbol = plan["symbol"]
    ltp, ltp_raw = latest_ltp_paise(api, symbol)

    date = scout.get("date") or gate.get("trade_date") or today_ist()
    state_path = pathlib.Path(args.state_file or (args.trail_dir / f"{date}-{symbol}.state.json"))
    state = load_state(state_path)
    prior = state.get("state", "WATCHING")
    result = decision_for_tick(
        args.mode,
        args.allow_real,
        state,
        plan,
        ltp,
        gate,
        args.entry_deadline,
        args.time_exit,
        args.profit_take_pct,
        args.entry_band_pct,
        args.chase_limit_pct,
    )

    action: dict[str, Any] = {}
    if result["decision"] == "ENTER_REAL":
        action = maybe_send_real_order(api, plan, gate, f"QT{date.replace('-', '')}") or {}
    elif result["decision"].startswith("EXIT_"):
        action = maybe_square_off(api, plan, args.mode, args.allow_real, result["decision"]) or {}

    state.update({
        "trade_date": date,
        "symbol": symbol,
        "state": result["state_after"],
        "updated_at": now_ist().isoformat(),
        "entry_paise": state.get("entry_paise") or (ltp if result["decision"].startswith("ENTER_") else plan["entry_paise"]),
        "stop_paise": plan["stop_paise"],
        "target_paise": max(plan["target_paise"], int(plan["entry_paise"] * (1 + args.profit_take_pct / 100.0))),
        "qty": plan["qty"],
        "last_decision": result["decision"],
        "last_reason": result.get("reason"),
    })
    if result["state_after"] == "EXITED":
        state["exited_at"] = now_ist().isoformat()
        state["exit_reason"] = result["decision"]
        state["exit_ltp_paise"] = ltp
    save_state(state_path, state)

    event = {
        "trade_date": date,
        "ts": now_ist().isoformat(),
        "mode": args.mode,
        "symbol": symbol,
        "state_before": prior,
        "state_after": result["state_after"],
        "decision": result["decision"],
        "reason": result.get("reason"),
        "ltp_paise": ltp,
        "entry_paise": state.get("entry_paise"),
        "stop_paise": plan["stop_paise"],
        "target_paise": state.get("target_paise"),
        "qty": plan["qty"],
        "pnl_pct": None if result.get("pnl_pct") is None else round(float(result["pnl_pct"]), 4),
        "proof_state": (scout.get("ladder") or {}).get("proof_rung"),
        "edge_state": scout.get("edge_state"),
        "gate_trade_authorized": gate.get("trade_authorized"),
        "gate_decision": gate.get("decision"),
        "gate_reasons": gate.get("reasons") or gate.get("blocked_reasons"),
        "trigger": result.get("trigger"),
        "action": action,
        "raw": {
            "scout_headline": scout.get("headline"),
            "scout_primary": scout.get("primary_symbol"),
            "ltp_status": ltp_raw.get("status"),
            "gate_verdict_id": gate.get("verdict_id"),
        },
    }
    append_jsonl(args.trail_dir / f"{date}.jsonl", event)
    if args.d1_write:
        try:
            d1_write_event(event)
        except Exception as e:
            event["d1_write_error"] = str(e)
            append_jsonl(args.trail_dir / f"{date}.d1-errors.jsonl", event)
    if args.print_json:
        print(json.dumps(event, indent=2, sort_keys=True))
    else:
        print(f"{event['ts']} {symbol} {event['state_before']} -> {event['decision']} ({event['reason']}) ltp={ltp} pnl={event['pnl_pct']}")
    return event


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Quant forward entry/exit timer")
    p.add_argument("--base-url", default=os.environ.get("QUANT_TRADE_BASE", DEFAULT_BASE))
    p.add_argument("--api-key", default=os.environ.get("DASHBOARD_API_KEY"))
    p.add_argument("--mode", choices=["paper", "real"], default=os.environ.get("QUANT_TIMER_MODE", "paper"))
    p.add_argument("--allow-real", action="store_true", help="Required with --mode real; server gate must still authorize.")
    p.add_argument("--loop", action="store_true")
    p.add_argument("--interval-sec", type=int, default=int(os.environ.get("QUANT_TIMER_INTERVAL_SEC", "180")))
    p.add_argument("--max-cycles", type=int, default=0, help="0 = unlimited while --loop is active")
    p.add_argument("--entry-deadline", type=lambda s: parse_hhmm(s, dt.time(10, 15, tzinfo=IST)), default=parse_hhmm(os.environ.get("QUANT_TIMER_ENTRY_DEADLINE", "1015"), dt.time(10, 15, tzinfo=IST)))
    p.add_argument("--time-exit", type=lambda s: parse_hhmm(s, dt.time(12, 45, tzinfo=IST)), default=parse_hhmm(os.environ.get("QUANT_TIMER_TIME_EXIT", "1245"), dt.time(12, 45, tzinfo=IST)))
    p.add_argument("--profit-take-pct", type=float, default=float(os.environ.get("QUANT_TIMER_PROFIT_TAKE_PCT", "5.0")))
    p.add_argument("--entry-band-pct", type=float, default=float(os.environ.get("QUANT_TIMER_ENTRY_BAND_PCT", "0.80")))
    p.add_argument("--chase-limit-pct", type=float, default=float(os.environ.get("QUANT_TIMER_CHASE_LIMIT_PCT", "0.35")))
    p.add_argument("--trail-dir", type=pathlib.Path, default=pathlib.Path(os.environ.get("QUANT_TIMER_TRAIL_DIR", str(DEFAULT_TRAIL_DIR))))
    p.add_argument("--state-file", default=os.environ.get("QUANT_TIMER_STATE_FILE"))
    p.add_argument("--print-json", action="store_true")
    p.add_argument("--d1-write", action="store_true", help="Also write quant_timer_events. Requires migration 0024 and CF_D1_TOKEN/CF_ACCT.")
    return p


def main() -> int:
    load_env_file(pathlib.Path.home() / ".hn-assets.env")
    load_env_file(pathlib.Path.home() / "hn-wealth-backtest" / ".env")
    args = build_parser().parse_args()
    if not args.api_key:
        print("DASHBOARD_API_KEY missing. Source ~/.hn-assets.env or pass --api-key.", file=sys.stderr)
        return 2
    if args.mode == "real" and not args.allow_real:
        print("Refusing real mode without --allow-real. Server execution gate is still enforced.", file=sys.stderr)
        return 2
    api = Api(args.base_url, args.api_key)
    cycles = 0
    while True:
        cycles += 1
        try:
            one_cycle(args, api)
        except Exception as e:
            event = {"trade_date": today_ist(), "ts": now_ist().isoformat(), "decision": "ERROR", "error": str(e)}
            append_jsonl(args.trail_dir / f"{event['trade_date']}.jsonl", event)
            print(json.dumps(event, indent=2), file=sys.stderr)
            if not args.loop:
                return 1
        if not args.loop:
            return 0
        if args.max_cycles and cycles >= args.max_cycles:
            return 0
        time.sleep(max(15, args.interval_sec))


if __name__ == "__main__":
    raise SystemExit(main())
