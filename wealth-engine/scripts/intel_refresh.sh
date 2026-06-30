#!/bin/bash
# HN Wealth — nightly Winner-Intelligence refresh (RTX box).
# Rebuilds the causal feature store from bt.db, recomputes winner replay +
# missed-winner autopsy + the walk-forward ranker, and pushes to D1 so the daily
# learning witness + winner board stay fresh. Fully GUARDED: it can never break
# the core nightly learning loop (daily.sh) that runs before it. Niced; isolated
# from Frigate/Nazar. Intelligence only — never an order surface.
cd "$(dirname "$0")" || exit 0
{
  echo "=== WINNER-INTEL REFRESH $(date '+%F %T') ==="
  nice -n 18 python3 -u winner_intel.py build      && \
  nice -n 18 python3 -u winner_intel.py replay     && \
  nice -n 18 python3 -u winner_intel.py backtest   && \
  nice -n 18 python3 -u winner_intel.py autopsy    && \
  python3 -u intel_push.py --days 90               && \
  echo "WINNER-INTEL OK" || echo "WINNER-INTEL FAILED (non-fatal)"
  echo "=== END WINNER-INTEL $(date '+%F %T') ==="
} >> daily.log 2>&1
exit 0
