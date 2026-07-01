# HN Wealth — COCKPIT MANIFEST (the objective, as a machine-checkable contract)

**The objective, in one line:** HN Wealth is a daily intraday trading cockpit that gives a
reasoned market action almost every day, TEACHES the owner, stays honest (never fakes an
edge), and **only ever COMPOUNDS** — every ship adds a layer and never silently drops one.

This file is the contract. Every capability the cockpit must ALWAYS have is listed below as
a `# CHECK` line. `ship-check.sh` parses these lines and REFUSES to ship (exit 1) if any
source marker is missing or any live endpoint is down. A build that adds one thing and drops
another is a FAILED build — the gate catches it so the owner never has to.

**LAW: no Wealth archive/install/upload happens until `./ship-check.sh` exits 0.**
When you add a new capability, add a `# CHECK` line for it here in the SAME commit — that is
how the cockpit's growth is locked in and can never regress.

## Required capabilities (source markers — must exist in the build being shipped)
<!-- format: # CHECK SRC|<file>|<grep-marker>|<what it guarantees> -->
# CHECK SRC|NowView.swift|ScoutTodayCard(vm: vm)|Daily scout action card on the Now tab
# CHECK SRC|SetupView.swift|ScoutTrailCard(vm: vm)|Scout learning trail on the Today tab
# CHECK SRC|ScoutView.swift|TODAY'S SCOUT|Scout view (ladder + why-this + why-not + plan + lesson)
# CHECK SRC|StocksView.swift|BROWSE ALL|All-stocks bucket-grid front door (every stock visible)
# CHECK SRC|StocksView.swift|bucketGrid|Bucket grid component
# CHECK SRC|StocksView.swift|Price graph|Stock price graph in the detail sheet
# CHECK SRC|StocksView.swift|import Charts|Swift Charts framework for the graphs
# CHECK SRC|StocksView.swift|FiveLightStrip|The 5-light teaching primitive
# CHECK SRC|StocksView.swift|TideCard|Market-tide / regime header
# CHECK SRC|ProofStateView.swift|SignalProofCard|Honest proof-state (REJECTED/WATCH/DEPLOYABLE)
# CHECK SRC|ExecuteView.swift|Order witness|Order-path Face-ID/result witness
# CHECK SRC|HomeView.swift|StocksView|Stocks tab mounted in the tab bar
# CHECK SRC|Theme.swift|func hkGlass|Liquid Glass material system (iOS 26) with flat fallback
# CHECK SRC|Theme.swift|struct HKAurora|Aurora luminance layer behind the glass
# CHECK SRC|StocksView.swift|hkGlass|Liquid Glass applied to the stock surfaces (tiles/hero/chart/pills)
# CHECK SRC|StocksView.swift|HKAurora|Per-stock detail sheet floats on the aurora canvas
# CHECK SRC|Theme.swift|enum MarketCalendar|Business-day awareness (weekend/holiday → last Fri / next Mon)
# CHECK SRC|HomeView.swift|var isMarketDay|VM exposes market-day truth to every surface
# CHECK SRC|NowView.swift|Markets closed —|Now reframes the weekend (no "pick at 09:40" on Sat/Sun)
# CHECK SRC|ScoutView.swift|weekendBlock|Scout card shows the weekend state + last scout

## Execution Lab (one-tap order-path testing cockpit — must never regress)
# CHECK SRC|LabView.swift|private var killBar|Execution Lab kill-switch (square-off-all) present
# CHECK SRC|LabView.swift|equityRoundTrip|Execution Lab equity round-trip scenario
# CHECK SRC|LabView.swift|tinyReal|Execution Lab SIM/TINY-REAL mode toggle
# CHECK SRC|LabView.swift|quantProofTrailCard|Execution Lab shows Quant proof trail but no timer execution controls
# CHECK SRC|LabView.swift|recentLabTrailCard|Execution Lab shows recent broker/test proof history
# CHECK SRC|LabClient.swift|func labSquareOffAll|Execution Lab client wired to the hardened door
# CHECK SRC|QuantControlClient.swift|func quantControlStatus|iOS client can read Quant control status
# CHECK SRC|QuantControlClient.swift|func quantControlTick|iOS client can request a paper timer tick
# CHECK SRC|QuantControlClient.swift|func quantControlSetOverride|iOS client can set a timer override from Execute
# CHECK SRC|QuantControlClient.swift|func quantControlClearOverride|iOS client can clear a timer override from Execute
# CHECK SRC|ExecuteView.swift|quantExecutionCard|Execute tab owns Quant timer execution controls
# CHECK SRC|ExecuteView.swift|saveTimerOverride|Execute tab can save the timer override
# CHECK SRC|ExecuteView.swift|runRealTimerTick|Execute tab has a Face-ID-gated real timer tick path
# CHECK SRC|HomeView.swift|LabView(vm: vm)|Execution Lab tab wired into the TabView

## Required live data (endpoints — must respond with the marker field)
<!-- format: # CHECK API|<action[&param]>|<expected-field>|<what it feeds> -->
# CHECK API|scout_today|ladder|Daily scout plan
# CHECK API|scout_trail|stats|Scout learning trail
# CHECK API|analysed_universe|buckets|Full ~1,248-stock universe + buckets
# CHECK API|eod&symbol=RELIANCE|rows|Daily OHLC for the price graphs
# CHECK API|research_depth|verdict|Honest research proof-state
# CHECK API|chain_health|overall|Pipeline health
