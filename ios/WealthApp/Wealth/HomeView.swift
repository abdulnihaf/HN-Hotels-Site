import SwiftUI

// ───────────────────────── View model ─────────────────────────

@MainActor
final class WealthVM: ObservableObject {
    @Published var kite: KiteStatus?
    @Published var readiness: Readiness?
    @Published var auto: AutoTraderState?
    @Published var engine: EngineState?
    @Published var verdict: VerdictToday?
    @Published var config: [String: String] = [:]
    @Published var plan: TodaysPlan?
    @Published var intel: IntelAudit?
    @Published var sysHealth: SystemHealth?
    @Published var stockPicker: StockPicker?
    @Published var briefing: Briefing?
    @Published var signals: [SignalScore] = []     // per-stock engine scores (Stocks tab 5-lights)
    @Published var chainHealth: ChainHealth?
    @Published var executionGate: ExecutionGate?
    @Published var researchDepth: ResearchDepth?
    @Published var scoutToday: ScoutToday?         // the daily learning action
    @Published var scoutTrail: ScoutTrail?         // the learning trail + stats
    @Published var universe: AnalysedUniverse?     // the full ~1,248-stock analysed universe + buckets
    @Published var eodCache: [String: [EodBar]] = [:]  // per-symbol daily OHLC for the price graph
    @Published var prefill: OrderDraft?            // set by Now/Stocks → consumed by Execute (one-tap engine trade)
    @Published var status: String = ""
    @Published var loading = false
    @Published private var lastKnownKiteConnected = false

    struct OrderDraft { let symbol: String; let stop: String; let target: String; let qty: String }

    func refresh() async {
        loading = true
        status = "Refreshing…"
        // Safety-critical: load config FIRST so the real-money mode banner is correct ASAP.
        if let cfg = try? await WealthClient.shared.config() { config = cfg }
        // The rest run concurrently: one failure must not blank the others.
        async let k = WealthClient.shared.kiteStatus()
        async let r = WealthClient.shared.readiness()
        async let a = WealthClient.shared.autoTrader()
        async let e = WealthClient.shared.engineState()
        async let v = WealthClient.shared.verdictToday()
        async let p = WealthClient.shared.todaysPlan()
        async let ia = WealthClient.shared.intelAudit()
        async let sh = WealthClient.shared.systemHealth()
        async let sp = WealthClient.shared.stockPicker()
        async let br = WealthClient.shared.briefing()
        async let sg = WealthClient.shared.signals()
        async let ch = WealthClient.shared.chainHealth()
        async let eg = WealthClient.shared.executionGate()
        async let rd = WealthClient.shared.researchDepth()
        async let st = WealthClient.shared.scoutToday()
        async let str = WealthClient.shared.scoutTrail()
        async let un = WealthClient.shared.analysedUniverse()
        let nextKite = try? await k
        kite = nextKite
        // The scout is the marquee daily action — resolve it EARLY (fast endpoints),
        // ahead of the slow briefing/stockPicker awaits, so it never loads last.
        scoutToday = try? await st
        scoutTrail = try? await str
        universe = try? await un
        readiness = try? await r
        auto = try? await a
        engine = try? await e
        verdict = try? await v
        let nextPlan = try? await p
        plan = nextPlan
        if nextKite?.connected == true || nextPlan?.state?.kite_connected == true {
            lastKnownKiteConnected = true
        } else if nextKite?.connected == false || nextPlan?.state?.kite_connected == false {
            lastKnownKiteConnected = false
        }
        intel = try? await ia
        sysHealth = try? await sh
        stockPicker = try? await sp
        briefing = try? await br
        signals = (try? await sg) ?? []
        chainHealth = try? await ch
        executionGate = try? await eg
        researchDepth = try? await rd
        loading = false
        status = (kite == nil && readiness == nil && config.isEmpty) ? "Couldn't reach trade.hnhotels.in" : ""
    }

    // ── Derived ──
    // Fail UNSAFE: if we cannot read the live config, we say "UNKNOWN", never "SAFE".
    enum RealMode { case paper, ordersUnblocked, armedAuto, unknown }
    var mode: RealMode {
        guard let block = config["block_real_orders"] else { return .unknown }
        let auto = config["auto_real_trades_enabled"] ?? "0"
        let eng = config["engine_mode"] ?? "shadow_run"
        if auto == "1" && block == "0" && eng == "live" { return .armedAuto }
        if block == "0" { return .ordersUnblocked }
        return .paper
    }
    var totalCapitalPaise: Int { Int(config["total_capital_paise"] ?? "") ?? 0 }
    var deployablePaise: Int { Int(config["today_deployable_paise"] ?? "") ?? 0 }
    // Robust: trust EITHER source. A single slow/failed status fetch must not show a false "Connect Kite".
    var kiteConnected: Bool { kite?.connected == true || plan?.state?.kite_connected == true || (loading && lastKnownKiteConnected) }
    var tradeAuthorized: Bool { executionGate?.trade_authorized == true }
    var observeOnly: Bool { executionGate?.decision == "OBSERVE" || executionGate?.machine_plan_surface == "intelligence_only" }

    // Business-day truth: the engine's is_market_day is authoritative (knows holidays);
    // fall back to local weekday so the weekend framing shows instantly before the plan loads.
    var isMarketDay: Bool { plan?.state?.is_market_day ?? !MarketCalendar.isWeekend() }

    // Lazy-load a stock's daily OHLC for the price graph (cached per symbol).
    func loadEod(_ symbol: String) async {
        if eodCache[symbol] != nil { return }
        if let s = try? await WealthClient.shared.eod(symbol: symbol), let rows = s.rows, !rows.isEmpty {
            eodCache[symbol] = rows
        }
    }
}

// ───────────────────────── Money + UI helpers ─────────────────────────

enum Money {
    static let inr: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_IN")
        f.maximumFractionDigits = 0
        return f
    }()
    static func rupees(_ paise: Int?, decimals: Bool = false) -> String {
        guard let p = paise else { return "—" }
        let r = Double(p) / 100.0
        let f = inr
        f.maximumFractionDigits = decimals ? 2 : 0
        return "₹" + (f.string(from: NSNumber(value: r)) ?? "\(Int(r))")
    }
    static func rupeesFromRupee(_ r: Double) -> String {
        "₹" + (inr.string(from: NSNumber(value: r)) ?? "\(Int(r))")
    }
}

struct Card<Content: View>: View {
    let content: Content
    init(@ViewBuilder _ content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))
            .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}

struct Pill: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(color.opacity(0.16)))
            .overlay(Capsule().stroke(color.opacity(0.5), lineWidth: 1))
    }
}

struct Row: View {
    let label: String
    let value: String
    var valueColor: Color = HK.text
    var body: some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundColor(HK.textDim)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundColor(valueColor)
        }
    }
}

// ───────────────────────── Home (tab shell) ─────────────────────────

struct HomeView: View {
    @ObservedObject var session: WealthSession
    @StateObject private var vm = WealthVM()
    @State private var tab: Int = Int(ProcessInfo.processInfo.environment["WEALTH_TAB"] ?? "0") ?? 0

    var body: some View {
        TabView(selection: $tab) {
            NowView(vm: vm, session: session, goToExecute: { tab = 2 })
                .tabItem { Label("Now", systemImage: "bolt.horizontal.circle.fill") }.tag(0)
            StocksView(vm: vm, goToExecute: { tab = 2 })
                .tabItem { Label("Stocks", systemImage: "chart.line.uptrend.xyaxis") }.tag(1)
            ExecuteView(vm: vm)
                .tabItem { Label("Execute", systemImage: "bolt.fill") }.tag(2)
            SetupView(vm: vm)
                .tabItem { Label("Today", systemImage: "sun.max.fill") }.tag(3)
            OpsView(vm: vm)
                .tabItem { Label("Ops", systemImage: "waveform.path.ecg") }.tag(4)
            LabView(vm: vm)
                .tabItem { Label("Lab", systemImage: "testtube.2") }.tag(5)
        }
        .tint(HK.accent)
        .task { await vm.refresh() }
    }
}

struct HeaderBar: View {
    let title: String
    var session: WealthSession?
    @ObservedObject var vm: WealthVM
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundColor(HK.text)
                Text("trade.hnhotels.in").font(.system(size: 11, weight: .medium)).foregroundColor(HK.textFaint)
            }
            Spacer()
            if vm.loading { ProgressView().tint(HK.accent) }
            Button { Task { await vm.refresh() } } label: {
                Image(systemName: "arrow.clockwise").foregroundColor(HK.textDim)
            }
            if let session {
                Button { session.signOut() } label: { Image(systemName: "lock.fill").foregroundColor(HK.textDim) }
                    .padding(.leading, 6)
            }
        }
        .padding(.horizontal).padding(.vertical, 12)
        .background(HK.bgElev)
    }
}

// ───────────────────────── Mode banner (honest paper/shadow/real) ─────────────────────────

struct ModeBanner: View {
    @ObservedObject var vm: WealthVM
    var body: some View {
        let (text, color): (String, Color) = {
            switch vm.mode {
            case .armedAuto:       return ("REAL — AUTO-TRADING ARMED", HK.error)
            case .ordersUnblocked: return ("REAL ORDERS UNBLOCKED", HK.running)
            case .paper:           return ("PAPER / SHADOW — SAFE", HK.ready)
            case .unknown:         return ("MODE UNKNOWN — verify", HK.running)
            }
        }()
        let sub = vm.mode == .unknown
            ? "Couldn't read engine config"
            : "block_real_orders=\(vm.config["block_real_orders"] ?? "?") · engine_mode=\(vm.config["engine_mode"] ?? "?")"
        return HStack(spacing: 12) {
            Image(systemName: vm.mode == .paper ? "shield.lefthalf.filled" : "exclamationmark.triangle.fill")
                .font(.system(size: 22)).foregroundColor(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(text).font(.system(size: 15, weight: .heavy)).foregroundColor(color)
                Text(sub).font(.system(size: 12)).foregroundColor(HK.textDim)
            }
            Spacer()
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(color.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(color.opacity(0.55), lineWidth: 1.5))
    }
}

// ───────────────────────── Today ─────────────────────────

struct TodayView: View {
    @ObservedObject var vm: WealthVM
    @ObservedObject var session: WealthSession

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Today", session: session, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    ModeBanner(vm: vm)

                    // Kite status
                    Card {
                        HStack {
                            Text("Kite").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                            Spacer()
                            if vm.kite?.connected == true {
                                Pill(text: "CONNECTED", color: HK.ready)
                            } else {
                                Pill(text: (vm.kite?.reason ?? "not connected").uppercased(), color: HK.running)
                            }
                        }
                        if let n = vm.kite?.user_name { Row(label: "Account", value: n) }
                        if vm.kite?.connected == true, let m = vm.kite?.expires_in_min {
                            Row(label: "Token expires in", value: "\(m) min")
                        } else {
                            Text("Connect Kite from the Capital tab to enable live data + orders.")
                                .font(.system(size: 12)).foregroundColor(HK.textDim)
                        }
                    }

                    // P&L
                    Card {
                        Text("Today's book").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        let s = vm.auto?.summary
                        HStack(alignment: .firstTextBaseline) {
                            Text(Money.rupees(s?.total_pnl_realized_paise))
                                .font(.system(size: 30, weight: .heavy, design: .rounded))
                                .foregroundColor((s?.total_pnl_realized_paise ?? 0) >= 0 ? HK.ready : HK.error)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(s?.total_positions ?? 0) positions").font(.system(size: 12)).foregroundColor(HK.textDim)
                                Text("deployed \(Money.rupees(s?.total_deployed_paise))").font(.system(size: 12)).foregroundColor(HK.textDim)
                            }
                        }
                        if let d = vm.auto?.today { Text(d).font(.system(size: 11)).foregroundColor(HK.textFaint) }
                    }

                    // Verdict + regime
                    Card {
                        Text("Engine").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        Row(label: "Today's verdict", value: (vm.verdict?.decision ?? "—").uppercased(),
                            valueColor: (vm.verdict?.decision == "TRADE") ? HK.ready : HK.textDim)
                        if let sym = vm.verdict?.recommended_symbol { Row(label: "Pick", value: sym) }
                        if let reg = vm.engine?.regime?.current { Row(label: "Regime", value: reg.capitalized) }
                        if let desc = vm.engine?.regime?.explainer?.desc {
                            Text(desc).font(.system(size: 12)).foregroundColor(HK.textDim)
                        }
                    }

                    // Data freshness
                    if let dims = vm.engine?.dim_health, !dims.isEmpty {
                        Card {
                            Text("Data freshness").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                            ForEach(dims.prefix(9)) { d in
                                let cov = d.coverage_pct ?? 0
                                HStack {
                                    Text(d.dim).font(.system(size: 13)).foregroundColor(HK.textDim).frame(width: 92, alignment: .leading)
                                    GeometryReader { g in
                                        ZStack(alignment: .leading) {
                                            RoundedRectangle(cornerRadius: 4).fill(HK.line).frame(height: 7)
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(cov >= 60 ? HK.ready : (cov >= 20 ? HK.running : HK.error))
                                                .frame(width: max(4, g.size.width * cov / 100), height: 7)
                                        }
                                    }.frame(height: 7)
                                    Text("\(Int(cov))%").font(.system(size: 11, weight: .semibold)).foregroundColor(HK.textDim).frame(width: 38, alignment: .trailing)
                                }
                            }
                        }
                    }

                    if !vm.status.isEmpty {
                        Text(vm.status).font(.system(size: 12)).foregroundColor(HK.error)
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
    }
}

// ───────────────────────── Capital + Funding (the arming UX) ─────────────────────────

struct CapitalView: View {
    @ObservedObject var vm: WealthVM
    @Environment(\.openURL) private var openURL
    @State private var pendingDeployable: Int?
    @State private var working = false

    struct DeployablePreset: Identifiable { let label: String; let paise: Int; var id: Int { paise } }
    private let presets: [DeployablePreset] = [
        .init(label: "₹10K", paise: 1_000_000), .init(label: "₹25K", paise: 2_500_000),
        .init(label: "₹50K", paise: 5_000_000), .init(label: "₹1L", paise: 10_000_000),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Capital", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    ModeBanner(vm: vm)

                    // Kite connect
                    Card {
                        Text("Kite / Zerodha").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        if vm.kite?.connected == true {
                            Row(label: "Status", value: "Connected", valueColor: HK.ready)
                            if let n = vm.kite?.user_name { Row(label: "Account", value: n) }
                        } else {
                            Text("Not connected (\(vm.kite?.reason ?? "—")). Tap to log in with your Zerodha credentials — fund the account first.")
                                .font(.system(size: 12)).foregroundColor(HK.textDim)
                            KiteConnectButton(vm: vm)
                        }
                    }

                    // Capital layers
                    Card {
                        Text("Capital").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        Row(label: "Funded ceiling (total)", value: Money.rupees(vm.totalCapitalPaise))
                        Row(label: "Today's deployable", value: Money.rupees(vm.deployablePaise), valueColor: HK.accent)

                        Text("Set today's deployable").font(.system(size: 12, weight: .semibold)).foregroundColor(HK.textDim).padding(.top, 4)
                        HStack(spacing: 8) {
                            ForEach(presets) { p in
                                Button { pendingDeployable = p.paise } label: {
                                    Text(p.label)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(vm.deployablePaise == p.paise ? HK.bg : HK.text)
                                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                                        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(vm.deployablePaise == p.paise ? HK.accent : HK.cardHi))
                                }
                            }
                        }
                        // Derived risk math against deployable
                        let dep = Double(vm.deployablePaise) / 100.0
                        VStack(spacing: 6) {
                            Row(label: "Max per pick (30%)", value: Money.rupeesFromRupee(dep * 0.30))
                            Row(label: "Profit-lock (5%)", value: Money.rupeesFromRupee(dep * 0.05), valueColor: HK.ready)
                            Row(label: "Loss-halt (3%)", value: Money.rupeesFromRupee(dep * 0.03), valueColor: HK.error)
                        }.padding(.top, 4)
                    }

                    // Arming honesty card
                    Card {
                        Text("Real-money arming").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        Row(label: "block_real_orders", value: vm.config["block_real_orders"] ?? "—",
                            valueColor: (vm.config["block_real_orders"] == "1") ? HK.ready : HK.error)
                        Row(label: "engine_mode", value: vm.config["engine_mode"] ?? "—")
                        Row(label: "auto_real_trades_enabled", value: vm.config["auto_real_trades_enabled"] ?? "—",
                            valueColor: (vm.config["auto_real_trades_enabled"] == "1") ? HK.error : HK.ready)
                        Divider().background(HK.line)
                        Text("Auto real-trading stays OFF until paper win-rate ≥ 50% (Readiness must read 11/11). The engine's own gate blocks it — this app will not one-tap arm a losing strategy. Make any first real trade manually, on your conviction.")
                            .font(.system(size: 12)).foregroundColor(HK.textDim)
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
        .confirmationDialog("Set today's deployable capital?",
                            isPresented: Binding(get: { pendingDeployable != nil }, set: { if !$0 { pendingDeployable = nil } }),
                            titleVisibility: .visible) {
            if let p = pendingDeployable {
                Button("Set to \(Money.rupees(p))") {
                    Task {
                        working = true
                        _ = try? await WealthClient.shared.setConfig(key: "today_deployable_paise", value: String(p))
                        await vm.refresh()
                        working = false
                        pendingDeployable = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) { pendingDeployable = nil }
        } message: {
            Text("This sets the sizing + profit-lock/loss-halt base. It does NOT place any order or unblock real money.")
        }
    }
}

// ───────────────────────── Readiness ─────────────────────────

struct ReadinessView: View {
    @ObservedObject var vm: WealthVM
    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Readiness", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    Card {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(vm.readiness?.overall_ready == true ? "READY" : "NOT READY")
                                    .font(.system(size: 24, weight: .heavy))
                                    .foregroundColor(vm.readiness?.overall_ready == true ? HK.ready : HK.error)
                                Text("Go / no-go for real money").font(.system(size: 12)).foregroundColor(HK.textDim)
                            }
                            Spacer()
                            Text(vm.readiness?.passing ?? "—/—")
                                .font(.system(size: 22, weight: .bold, design: .rounded)).foregroundColor(HK.text)
                        }
                    }
                    Card {
                        Text("Gates").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        ForEach(vm.readiness?.gates ?? []) { g in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: g.pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundColor(g.pass ? HK.ready : HK.error)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(g.label).font(.system(size: 14, weight: .medium)).foregroundColor(HK.text)
                                    if let t = g.target { Text(t).font(.system(size: 11)).foregroundColor(HK.textFaint) }
                                }
                                Spacer()
                            }
                            if g.id != vm.readiness?.gates?.last?.id { Divider().background(HK.lineSoft) }
                        }
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
    }
}

// ───────────────────────── Ops ─────────────────────────

struct OpsAction: Identifiable { let id = UUID(); let title: String; let detail: String; let color: Color }

struct OpsView: View {
    @ObservedObject var vm: WealthVM

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Ops", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    // Health score
                    Card {
                        let score = vm.intel?.summary?.health_score_pct ?? 0
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(score)%").font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundColor(scoreColor(score))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(score >= 70 ? "Healthy" : (score >= 40 ? "Attention" : "Degraded"))
                                    .font(.system(size: 14, weight: .bold)).foregroundColor(scoreColor(score))
                                Text("data integrity").font(.system(size: 11)).foregroundColor(HK.textFaint)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(vm.intel?.summary?.fresh ?? 0) fresh").font(.system(size: 12)).foregroundColor(HK.ready)
                                Text("\(vm.intel?.summary?.stale ?? 0) stale").font(.system(size: 12)).foregroundColor(HK.running)
                                Text("\((vm.intel?.sources ?? []).filter { !$0.hasData }.count) no-data").font(.system(size: 12)).foregroundColor(HK.error)
                            }
                        }
                    }

                    SignalProofCard(vm: vm, compact: true)

                    // Action needed — the recharge / reconnect / fix layer
                    Card {
                        Text("Action needed").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        let acts = actionItems()
                        if acts.isEmpty {
                            Text("Nothing needs you right now. ✓").font(.system(size: 13)).foregroundColor(HK.ready)
                        } else {
                            ForEach(acts) { a in
                                HStack(alignment: .top, spacing: 10) {
                                    Circle().fill(a.color).frame(width: 8, height: 8).padding(.top, 5)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(a.title).font(.system(size: 14, weight: .semibold)).foregroundColor(a.color)
                                        Text(a.detail).font(.system(size: 12)).foregroundColor(HK.textDim)
                                    }
                                    Spacer()
                                }
                            }
                        }
                    }

                    // Data sources
                    Card {
                        Text("Data sources").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        ForEach(vm.intel?.sources ?? []) { s in
                            HStack(spacing: 8) {
                                Circle().fill(srcColor(s)).frame(width: 8, height: 8)
                                Text(s.name).font(.system(size: 13)).foregroundColor(HK.text).lineLimit(1)
                                Spacer()
                                Text(srcLabel(s)).font(.system(size: 11, weight: .semibold)).foregroundColor(srcColor(s))
                            }
                        }
                        if (vm.intel?.sources ?? []).isEmpty {
                            Text("No audit yet.").font(.system(size: 12)).foregroundColor(HK.textDim)
                        }
                    }

                    // Cron pipeline
                    Card {
                        Text("Cron pipeline (24h)").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                        let c = vm.sysHealth?.cron_health
                        Row(label: "Fires", value: c?.cron_fires_24h.map(String.init) ?? "—")
                        Row(label: "Success", value: c?.success_24h.map(String.init) ?? "—", valueColor: HK.ready)
                        Row(label: "Failed", value: c?.failed_24h.map(String.init) ?? "—",
                            valueColor: (c?.failed_24h ?? 0) > 50 ? HK.error : HK.textDim)
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
    }

    private func scoreColor(_ s: Int) -> Color { s >= 70 ? HK.ready : (s >= 40 ? HK.running : HK.error) }

    private func kiteFeed(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.contains("ltp") || n.contains("kite") || n.contains("5-min bars") || n.contains("intraday") || n.contains("option chain")
    }

    private func srcColor(_ s: AuditSource) -> Color {
        if !s.hasData { return (s.severity == "critical") ? HK.error : HK.running }
        let age = s.age_minutes ?? 0
        return age > 1440 ? HK.running : HK.ready
    }
    private func srcLabel(_ s: AuditSource) -> String {
        if !s.hasData { return "NO DATA" }
        let age = Int(s.age_minutes ?? 0)
        if age < 0 { return "scheduled" }
        if age < 60 { return "\(age)m" }
        return "\(age / 60)h"
    }

    private func actionItems() -> [OpsAction] {
        var out: [OpsAction] = []
        // Kite connection
        if vm.kite?.connected != true {
            let reason = vm.kite?.reason ?? "not connected"
            out.append(OpsAction(title: reason == "expired" ? "Reconnect Kite (token expired)" : "Connect Kite",
                                 detail: "Kite tokens die daily ~6am IST. Tap Connect Kite on the Now tab. No live data/orders without it.",
                                 color: HK.running))
        } else if let m = vm.kite?.expires_in_min, m < 90 {
            out.append(OpsAction(title: "Kite token expiring soon", detail: "\(m) min left — reconnect to avoid a mid-session data gap.", color: HK.running))
        }
        // Kite Connect subscription (the recharge scenario)
        out.append(OpsAction(title: "Kite Connect subscription (₹500/mo)",
                             detail: "If login ever says 'Invalid api_key', the subscription lapsed — recharge at developers.kite.trade (app HN_Wealth_Engine). Active till 26 Jul 2026.",
                             color: HK.textDim))
        // No-data / down sources
        for s in (vm.intel?.sources ?? []).filter({ !$0.hasData }) {
            let sev = s.severity ?? "medium"
            let color = sev == "critical" ? HK.error : (sev == "high" ? HK.running : HK.textDim)
            let fix = kiteFeed(s.name) ? "Needs Kite + market hours — resumes when the market opens." : "Cron/source may be down — check Ops."
            out.append(OpsAction(title: "\(s.name): no data", detail: "Used by \(s.used_by ?? "engine"). \(fix)", color: color))
        }
        // Cron failures
        if let f = vm.sysHealth?.cron_health?.failed_24h, f > 50 {
            out.append(OpsAction(title: "Cron failures elevated", detail: "\(f) failed in 24h — worker logs need a look.", color: HK.running))
        }
        return out
    }
}
