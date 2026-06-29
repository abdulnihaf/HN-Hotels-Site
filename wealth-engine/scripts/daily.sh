#!/bin/bash
# HN Wealth nightly SELF-LEARNING loop (RTX box, 17:30 IST via hn-wealth-daily.timer).
# Isolated + niced; never disturbs Frigate/Nazar. Each night, with zero owner action:
#   1. incremental top-up of the FULL liquid universe (5-min bars + EOD through yesterday)
#   2. walk-forward OOS gap-up backtest, survivorship-free -> the tuned rule + HONEST stats
#   3. publish the tuned rule to D1 (wealth_strategy_config + backtest_intraday_runs)
#   4. journal yesterday's pick-vs-outcome -> wealth_pick_journal (learn from own results)
# The 09:40 Cloudflare engine reads the published rule next morning. The loop gets
# smarter from its own track record and is honest when there's no edge to trade.
set -euo pipefail
cd "$(dirname "$0")" || exit 1
{
  echo "=== NIGHTLY $(date '+%F %T') ==="
  nice -n 15 python3 -u daily_topup_full.py
  nice -n 18 python3 -u gap_edge.py
  python3 -u publish_config.py
  python3 -u journal_outcome.py
  echo "=== END $(date '+%F %T') ==="
} >> daily.log 2>&1
date +%s > last_nightly_run.txt
grep -h "VERDICT" daily.log 2>/dev/null | tail -1 | sed "s/^/$(date +%F) /" >> verdict_history.log
