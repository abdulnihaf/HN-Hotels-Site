import SwiftUI
import Charts

// ─────────────────────────────────────────────────────────────────────────────
//  StocksView — the centerpiece. The most relevant intraday stocks, live(-honest),
//  beautiful, and TEACHING. Built for a beginner owner:
//   • A market-tide header (the regime + breadth + VIX in plain words).
//   • A composite-sorted, scannable list of engine setups + the recognizable
//     watchlist + the day's movers (segmented).
//   • Each card carries the 5-LIGHT strip (per-dimension engine scores) + a
//     composite strength meter + an intraday move bar.
//   • Tap → a detail sheet that explains every light in plain words, shows the
//     trade plan when it IS today's pick, and pre-fills Execute (one tap to act).
//
//  HONESTY CONTRACT (non-negotiable):
//   - A dimension score of exactly 50 is the engine's NEUTRAL DEFAULT (= no data).
//     Those lights render GREY ("—"), never a fake amber/green. (Verified live:
//     flow has real data for ~11/20, macro 4/20, sentiment/quality/retail ~0.)
//   - Pre-market / when live LTP == last close, we show YESTERDAY'S CLOSE and say
//     "live at open" — never a faked live tick.
//   - The engine edge is UNPROVEN. Every actionable surface says so. These are
//     candidates to learn from, not sure things.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Light model

private enum LightState {
    case good, ok, weak, off
    var color: Color {
        switch self {
        case .good: return HK.ready
        case .ok:   return HK.running
        case .weak: return HK.error
        case .off:  return HK.idle
        }
    }
    var label: String {
        switch self {
        case .good: return "GOOD"
        case .ok:   return "OK"
        case .weak: return "WEAK"
        case .off:  return "NO DATA"
        }
    }
}

private struct Light: Identifiable {
    let n: Int
    let title: String
    let state: LightState
    let why: String
    let scoreText: String
    var id: Int { n }
}

// Exactly-50 == the engine's neutral default == no edge / no data → grey.
private func classify(_ v: Double?) -> LightState {
    guard let v = v, v != 50 else { return .off }
    if v >= 67 { return .good }
    if v > 50  { return .ok }
    return .weak
}

// Blend only the dimensions that carry REAL data (drop the exactly-50 defaults).
private func classifyBlend(_ vals: [Double?]) -> (state: LightState, avg: Double?) {
    let reals = vals.compactMap { $0 }.filter { $0 != 50 }
    guard !reals.isEmpty else { return (.off, nil) }
    let avg = reals.reduce(0, +) / Double(reals.count)
    if avg >= 67 { return (.good, avg) }
    if avg > 50  { return (.ok, avg) }
    return (.weak, avg)
}

private func scoreText(_ v: Double?) -> String {
    guard let v = v, v != 50 else { return "—" }
    return "\(Int(v.rounded()))"
}

// MARK: - Unified per-stock intel (signal scores ⋈ price)

private struct StockIntel: Identifiable {
    let symbol: String
    let price: WatchlistStock?     // nil for small-caps outside the liquid-200
    let signal: SignalScore?       // nil when the stock has no engine signal
    let plan: VerdictPlan?         // non-nil ONLY for today's verdict pick
    let marketLive: Bool
    var id: String { symbol }

    var name: String? { price?.name }
    var thesis: String? { price?.thesis }
    var composite: Double? { signal?.composite_score }
    var hasPrice: Bool { (price?.last_close_rupees ?? price?.live_ltp_rupees) != nil }

    // Show a live tick only when the market is open AND it diverges from the close.
    var showsLive: Bool {
        guard marketLive, let lp = price?.live_ltp_rupees, let lc = price?.last_close_rupees else { return false }
        return abs(lp - lc) > 0.0001
    }
    var displayPrice: Double? {
        if showsLive { return price?.live_ltp_rupees }
        return price?.last_close_rupees ?? price?.live_ltp_rupees
    }
    // Move %: live-vs-prev when live, else yesterday's close-vs-prev.
    var changePct: Double? {
        if showsLive {
            if let lc = price?.live_change_pct { return lc }
            if let lp = price?.live_ltp_rupees, let pc = price?.prev_close_rupees, pc > 0 {
                return (lp - pc) / pc * 100
            }
        }
        return price?.change_pct
    }
    var priceContext: String { showsLive ? "live" : "at close" }

    // The five lights.
    func lights() -> [Light] {
        let s = signal
        // 1 — Moving up? (trend)
        let l1: LightState = classify(s?.trend_score)
        // 2 — Market helping? (breadth + macro, regime-aware)
        let m = classifyBlend([s?.breadth_score, s?.macro_score])
        // 3 — Big money in? (flow)
        let l3 = classify(s?.flow_score)
        // 4 — A reason? (catalyst + sentiment + retail buzz)
        let r = classifyBlend([s?.catalyst_score, s?.sentiment_score, s?.retail_buzz_score])
        // 5 — My risk? (the plan if this is the pick, else quality)
        let l5State: LightState = plan != nil ? .good : classify(s?.quality_score)

        let regimeWord = (s?.regime ?? "").replacingOccurrences(of: "_", with: " ")
        let l5Why: String
        let l5Score: String
        if let p = plan {
            let rr = p.rr.map { String(format: "1:%.1f", $0) } ?? "—"
            l5Why = "Today's plan is set: stop \(Money.optRupee(p.stop)), target \(Money.optRupee(p.target)), \(p.qty.map(String.init) ?? "—") sh. Reward-to-risk \(rr)."
            l5Score = rr
        } else {
            l5Why = "No engine plan for this stock. If you trade it, set the stop first — risk ₹1 to make ₹2, never the reverse."
            l5Score = scoreText(s?.quality_score)
        }

        return [
            Light(n: 1, title: "Is it moving up?",
                  state: l1,
                  why: l1 == .off ? "No trend reading yet." :
                       "Trend strength \(scoreText(s?.trend_score))/100 — \(s?.mtf_alignment == "aligned_up" ? "aligned up across timeframes." : "checking the higher-timeframe trend.")",
                  scoreText: scoreText(s?.trend_score)),
            Light(n: 2, title: "Is the market helping?",
                  state: m.state,
                  why: m.state == .off ? "Breadth/macro reading thin for this stock." :
                       "Market breadth \(scoreText(s?.breadth_score))/100\(regimeWord.isEmpty ? "" : " · \(regimeWord) market"). Don't fight the tide.",
                  scoreText: scoreText(m.avg)),
            Light(n: 3, title: "Is big money in?",
                  state: l3,
                  why: l3 == .off ? "No institutional-flow data for this stock yet (flow coverage is thin market-wide)." :
                       "Flow \(scoreText(s?.flow_score))/100 — \(((s?.flow_score ?? 50) > 50) ? "buying pressure detected." : "selling pressure.")",
                  scoreText: scoreText(s?.flow_score)),
            Light(n: 4, title: "Is there a reason?",
                  state: r.state,
                  why: r.state == .off ? "No catalyst picked up." :
                       "Catalyst \(scoreText(s?.catalyst_score))/100 — news, results or a sector move behind it. Reasons make moves last.",
                  scoreText: scoreText(r.avg)),
            Light(n: 5, title: "What's my risk?",
                  state: l5State,
                  why: l5Why,
                  scoreText: l5Score),
        ]
    }
}

// MARK: - Money helper (rupee from optional)

extension Money {
    static func optRupee(_ r: Double?) -> String {
        guard let r = r else { return "—" }
        return rupeesFromRupee(r)
    }
}

// MARK: - StocksView

struct StocksView: View {
    @ObservedObject var vm: WealthVM
    var goToExecute: () -> Void

    private enum Segment: String, CaseIterable, Identifiable {
        case setups = "Top setups", watchlist = "Watchlist", movers = "Movers"
        var id: String { rawValue }
    }
    @State private var segment: Segment = .setups
    @State private var selected: StockIntel?
    @State private var bucket: String? = nil   // when set → browse the full universe by bucket

    // The bucket front door — every stock visible, organised (not a 1,248-row dump).
    private let bucketDefs: [(key: String, label: String, icon: String)] = [
        ("gapped_up", "Gapped up", "arrow.up.forward"),
        ("up_today", "Up today", "chart.line.uptrend.xyaxis"),
        ("big_movers", "Big movers", "bolt.fill"),
        ("big_money", "Big money", "indianrupeesign.circle.fill"),
        ("fno", "F&O", "f.square.fill"),
        ("nifty50", "NIFTY 50", "50.square.fill"),
        ("calm", "Calm", "leaf.fill"),
        ("volatile", "Volatile", "waveform.path.ecg"),
        ("all", "All liquid", "square.grid.2x2.fill"),
    ]
    private func bucketLabel(_ k: String) -> String { bucketDefs.first { $0.key == k }?.label ?? k }
    private func inBucket(_ b: String, _ s: AnalysedStock) -> Bool {
        switch b {
        case "all": return true
        case "gapped_up": return s.gap_candidate == true
        case "up_today": return (s.change_pct ?? 0) > 0
        case "big_movers": return abs(s.change_pct ?? 0) >= 3
        case "big_money": return s.big_money == true
        case "fno": return s.is_fno == true
        case "nifty50": return s.is_nifty50 == true
        case "calm": return s.vol_band == "calm"
        case "moderate": return s.vol_band == "moderate"
        case "volatile": return s.vol_band == "volatile"
        default: return true
        }
    }
    private func analysedRows(_ b: String) -> [StockIntel] {
        (vm.universe?.stocks ?? [])
            .filter { inBucket(b, $0) }
            .sorted { ($0.turnover_cr ?? 0) > ($1.turnover_cr ?? 0) }
            .prefix(120)
            .map { a in StockIntel(symbol: a.symbol, price: a.asWatchlist, signal: signalMap[a.symbol],
                                   plan: a.symbol == pickSymbol ? vm.verdict?.plan : nil, marketLive: marketLive) }
    }

    private var marketLive: Bool { vm.intel?.in_market_hours == true }

    // symbol → best price record (prefer one that carries a live LTP)
    private var priceMap: [String: WatchlistStock] {
        var m: [String: WatchlistStock] = [:]
        let lists = [vm.stockPicker?.all_liquid, vm.stockPicker?.watchlist, vm.stockPicker?.top_movers]
        for list in lists {
            for s in (list ?? []) {
                if let existing = m[s.symbol] {
                    // keep whichever has a live tick / more complete record
                    if existing.live_ltp_rupees == nil && s.live_ltp_rupees != nil { m[s.symbol] = s }
                } else {
                    m[s.symbol] = s
                }
            }
        }
        return m
    }
    private var signalMap: [String: SignalScore] {
        Dictionary(vm.signals.map { ($0.symbol, $0) }, uniquingKeysWith: { a, _ in a })
    }
    private var pickSymbol: String? {
        (vm.verdict?.decision == "TRADE" && vm.tradeAuthorized) ? vm.verdict?.recommended_symbol : nil
    }

    private func intel(symbol: String, price: WatchlistStock?, signal: SignalScore?) -> StockIntel {
        StockIntel(symbol: symbol,
                   price: price,
                   signal: signal,
                   plan: (symbol == pickSymbol) ? vm.verdict?.plan : nil,
                   marketLive: marketLive)
    }

    private var rows: [StockIntel] {
        switch segment {
        case .setups:
            return vm.signals
                .sorted { ($0.composite_score ?? 0) > ($1.composite_score ?? 0) }
                .map { intel(symbol: $0.symbol, price: priceMap[$0.symbol], signal: $0) }
        case .watchlist:
            return (vm.stockPicker?.watchlist ?? [])
                .map { intel(symbol: $0.symbol, price: $0, signal: signalMap[$0.symbol]) }
        case .movers:
            return (vm.stockPicker?.top_movers ?? [])
                .sorted { abs($0.change_pct ?? 0) > abs($1.change_pct ?? 0) }
                .map { intel(symbol: $0.symbol, price: $0, signal: signalMap[$0.symbol]) }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Stocks", session: nil, vm: vm)
            ScrollView {
                LazyVStack(spacing: 14) {
                    TideCard(vm: vm)
                    bucketGrid
                    if let b = bucket {
                        bucketHeader(b)
                        let arows = analysedRows(b)
                        if arows.isEmpty {
                            Card { Text(vm.universe == nil ? "Loading the universe…" : "No stocks in this bucket today.")
                                .font(.system(size: 13)).foregroundColor(HK.textDim) }
                        } else {
                            ForEach(arows) { st in
                                StockCard(intel: st, rank: nil).onTapGesture { selected = st }
                            }
                            Text("Top 120 by traded value. Tap any stock for its graph + the 5 lights.")
                                .font(.system(size: 10)).foregroundColor(HK.textFaint).multilineTextAlignment(.center)
                        }
                    } else {
                        unprovenBanner
                        segmentPicker
                        if rows.isEmpty {
                            Card { Text(vm.loading ? "Loading the board…" : "No stocks to show yet — pull to refresh.")
                                .font(.system(size: 13)).foregroundColor(HK.textDim) }
                        } else {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, st in
                                StockCard(intel: st, rank: segment == .setups ? idx + 1 : nil)
                                    .onTapGesture { selected = st }
                            }
                            footerNote
                        }
                    }
                    if !vm.status.isEmpty { Text(vm.status).font(.system(size: 12)).foregroundColor(HK.error) }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
        .sheet(item: $selected) { st in
            StockDetailSheet(intel: st, vm: vm, goToExecute: {
                selected = nil
                goToExecute()
            })
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        // Debug deep-links (env-gated, harmless in prod): jump to a bucket / open a stock's detail.
        .onChange(of: vm.universe?.count) { _, _ in
            let env = ProcessInfo.processInfo.environment
            if let b = env["WEALTH_BUCKET"], bucket == nil { bucket = b }
            if let sym = env["WEALTH_DETAIL"], selected == nil,
               let a = vm.universe?.stocks?.first(where: { $0.symbol == sym }) {
                selected = StockIntel(symbol: a.symbol, price: a.asWatchlist,
                                      signal: signalMap[a.symbol], plan: nil, marketLive: marketLive)
            }
        }
    }

    private var segmentPicker: some View {
        Picker("", selection: $segment) {
            ForEach(Segment.allCases) { s in Text(s.rawValue).tag(s) }
        }
        .pickerStyle(.segmented)
        .tint(HK.accent)
    }

    // The bucket front door — all ~1,248 analysed stocks, organised into named tiles.
    private var bucketGrid: some View {
        let bk = vm.universe?.buckets ?? [:]
        return VStack(alignment: .leading, spacing: 8) {
            Text("BROWSE ALL \(vm.universe?.count ?? 0) STOCKS")
                .font(.system(size: 11, weight: .heavy)).foregroundColor(HK.textFaint)
            HKGlassGroup(spacing: 8) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                    ForEach(bucketDefs, id: \.key) { d in
                        let n = bk[d.key] ?? 0
                        let on = bucket == d.key
                        Button { withAnimation(.easeInOut(duration: 0.15)) { bucket = on ? nil : d.key } } label: {
                            VStack(spacing: 4) {
                                Image(systemName: d.icon).font(.system(size: 15)).foregroundColor(on ? HK.accent : HK.textDim)
                                Text(d.label).font(.system(size: 11, weight: .bold)).foregroundColor(HK.text)
                                    .lineLimit(1).minimumScaleFactor(0.65)
                                Text("\(n)").font(.system(size: 13, weight: .heavy, design: .rounded))
                                    .foregroundColor(on ? HK.accent : HK.textFaint)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            // Liquid Glass tile: tinted + interactive (flexes on press) when selected.
                            .hkGlass(cornerRadius: HK.radiusSm, tint: on ? HK.accent : nil, interactive: true,
                                     fallbackFill: on ? HK.accent.opacity(0.14) : HK.card,
                                     fallbackStroke: on ? HK.accentLine : HK.line)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func bucketHeader(_ b: String) -> some View {
        HStack {
            Button { withAnimation { bucket = nil } } label: {
                HStack(spacing: 4) { Image(systemName: "chevron.left"); Text("All setups") }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(HK.accent)
            }.buttonStyle(.plain)
            Spacer()
            Text(bucketLabel(b)).font(.system(size: 14, weight: .heavy)).foregroundColor(HK.text)
        }
    }

    private var unprovenBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.shield.fill").font(.system(size: 18)).foregroundColor(HK.running)
            VStack(alignment: .leading, spacing: 2) {
                Text("Watch and learn — \(vm.readiness?.passing ?? "—") ready")
                    .font(.system(size: 13, weight: .heavy)).foregroundColor(HK.running)
                Text("These are research candidates, not broker trades. Learn the lights; real orders stay locked until the server broker gate opens.")
                    .font(.system(size: 11)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.running.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.running.opacity(0.45), lineWidth: 1))
    }

    private var footerNote: some View {
        VStack(spacing: 4) {
            switch segment {
            case .setups:
                Text("Ranked by the engine's composite score. Small-caps outside the liquid-200 show scores without a live price.")
            case .watchlist:
                Text("Large, recognizable names you can learn on. Engine lights appear when a stock also has a live signal.")
            case .movers:
                Text("Today's biggest moves by %. A move with green lights behind it is worth more than a move alone.")
            }
        }
        .font(.system(size: 10)).foregroundColor(HK.textFaint)
        .multilineTextAlignment(.center)
        .padding(.top, 2)
    }
}

// MARK: - Market tide header

private struct TideCard: View {
    @ObservedObject var vm: WealthVM

    private var up: Int { dist("aligned_up") + dist("partial_up") }
    private var down: Int { dist("aligned_down") + dist("against_macro") }
    private func dist(_ key: String) -> Int {
        vm.engine?.mtf_alignment?.distribution?.first(where: { $0.mtf_alignment == key })?.n ?? 0
    }

    var body: some View {
        let regime = vm.engine?.regime?.current?.replacingOccurrences(of: "_", with: " ")
        let desc = vm.engine?.regime?.explainer?.desc
        let vix = vm.engine?.regime?.evidence?.india_vix
        let nifty20 = Double(vm.engine?.regime?.evidence?.nifty_20d_pct ?? "")
        let tideUp = up >= down
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Pill(text: marketLabel.0, color: marketLabel.1)
                Spacer()
                Text("The market tide").font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint)
            }

            // Headline: tide direction in plain words
            Text(tideUp ? "Tide is with the buyers" : "Tide is against you")
                .font(.system(size: 20, weight: .heavy)).foregroundColor(tideUp ? HK.ready : HK.error)
            if up > 0 || down > 0 {
                Text("\(fmt(up)) stocks trending up vs \(fmt(down)) down across the market.")
                    .font(.system(size: 13)).foregroundColor(HK.textDim)
                breadthBar(up: up, down: down)
            }

            // Numbers row
            HStack(spacing: 12) {
                tideStat("REGIME", regime?.capitalized ?? "—", HK.text)
                Spacer()
                if let v = vix {
                    tideStat("VIX", String(format: "%.1f", v), v < 15 ? HK.ready : (v < 20 ? HK.running : HK.error),
                             sub: v < 15 ? "calm" : (v < 20 ? "moderate" : "volatile"))
                } else { tideStat("VIX", "—", HK.textDim) }
                Spacer()
                if let n = nifty20 {
                    tideStat("NIFTY 20d", String(format: "%+.1f%%", n), n >= 0 ? HK.ready : HK.error)
                } else { tideStat("NIFTY 20d", "—", HK.textDim) }
            }

            if let d = desc {
                Text(d).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
            if let max = vm.engine?.max_score_today, let thr = vm.engine?.threshold {
                Text("Strongest setup today scores \(Int(max.rounded())) (bar to qualify: \(Int(thr.rounded()))).")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(18)
        // Liquid Glass marquee — NEUTRAL glass (a colour wash washed out the same-colour
        // headline; orange clashed). Direction is carried by the headline colour + breadth bar;
        // a thin tide-coloured edge keeps the hero hint without killing contrast.
        .hkGlass(cornerRadius: HK.radius,
                 fallbackFill: HK.card,
                 fallbackStroke: (tideUp ? HK.ready : HK.error).opacity(0.55), fallbackStrokeWidth: 1.5)
        .overlay(RoundedRectangle(cornerRadius: HK.radius, style: .continuous)
                    .stroke((tideUp ? HK.ready : HK.error).opacity(0.45), lineWidth: 1))
    }

    private func tideStat(_ label: String, _ value: String, _ color: Color, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10, weight: .bold)).foregroundColor(HK.textFaint)
            Text(value).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundColor(color)
            if let sub = sub { Text(sub).font(.system(size: 10)).foregroundColor(HK.textFaint) }
        }
    }

    private func breadthBar(up: Int, down: Int) -> some View {
        let total = max(1, up + down)
        return GeometryReader { g in
            HStack(spacing: 2) {
                RoundedRectangle(cornerRadius: 3).fill(HK.ready.opacity(0.85))
                    .frame(width: g.size.width * CGFloat(up) / CGFloat(total))
                RoundedRectangle(cornerRadius: 3).fill(HK.error.opacity(0.8))
            }
        }.frame(height: 8)
    }

    private func fmt(_ n: Int) -> String { Money.inr.string(from: NSNumber(value: n)) ?? "\(n)" }

    private var marketLabel: (String, Color) {
        if vm.intel?.in_market_hours == true { return ("MARKET OPEN", HK.ready) }
        if !vm.isMarketDay { return (MarketCalendar.closedLabel, HK.idle) }
        let p = (vm.plan?.phase ?? "").lowercased()
        if p.contains("pre") { return ("PRE-MARKET", HK.running) }
        if p.contains("overnight") || p.isEmpty { return ("CLOSED", HK.idle) }
        return (p.uppercased(), HK.idle)
    }
}

// MARK: - One stock card

private struct StockCard: View {
    let intel: StockIntel
    let rank: Int?

    private var chg: Double? { intel.changePct }
    private var chgColor: Color { (chg ?? 0) >= 0 ? HK.ready : HK.error }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                if let r = rank {
                    Text("\(r)").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.accent)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(HK.accentSoft))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(intel.symbol).font(.system(size: 15, weight: .heavy)).foregroundColor(HK.text)
                    Text(intel.name ?? "Small-cap · outside liquid-200")
                        .font(.system(size: 11)).foregroundColor(HK.textFaint).lineLimit(1)
                }
                Spacer()
                priceBlock
            }

            if let thesis = intel.thesis, !thesis.isEmpty {
                Text(thesis).font(.system(size: 12)).foregroundColor(HK.textDim).lineLimit(1)
            }

            // Move bar (intraday or close-vs-prev)
            if let c = chg { MoveBar(pct: c) }

            // 5-light strip + composite meter
            HStack(spacing: 10) {
                FiveLightStrip(lights: intel.lights())
                Spacer()
                if let comp = intel.composite { CompositeChip(value: comp) }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(intel.plan != nil ? HK.accentLine : HK.line,
                                                                    lineWidth: intel.plan != nil ? 1.5 : 1))
    }

    private var priceBlock: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if let p = intel.displayPrice {
                Text(priceStr(p)).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(HK.text)
                if let c = chg {
                    Pill(text: String(format: "%+.1f%%", c), color: chgColor)
                }
                Text(intel.priceContext).font(.system(size: 9)).foregroundColor(HK.textFaint)
            } else {
                Text("no price").font(.system(size: 12, weight: .semibold)).foregroundColor(HK.textFaint)
                Text("small-cap").font(.system(size: 9)).foregroundColor(HK.textFaint)
            }
        }
    }

    private func priceStr(_ p: Double) -> String {
        if p >= 1000 { return "₹\(String(format: "%.0f", p))" }
        return "₹\(String(format: "%.1f", p))"
    }
}

// MARK: - Visual atoms

private struct FiveLightStrip: View {
    let lights: [Light]
    var body: some View {
        HStack(spacing: 7) {
            ForEach(lights) { l in
                Circle().fill(l.state.color)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().stroke(l.state == .off ? HK.line : .clear, lineWidth: 1))
            }
        }
    }
}

private struct CompositeChip: View {
    let value: Double
    private var band: (String, Color) {
        if value >= 75 { return ("Very strong", HK.ready) }
        if value >= 67 { return ("Strong", HK.ready) }
        if value >= 60 { return ("Setup", HK.running) }
        return ("Weak", HK.idle)
    }
    var body: some View {
        HStack(spacing: 6) {
            Text("\(Int(value.rounded()))")
                .font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundColor(band.1)
            Text(band.0).font(.system(size: 10, weight: .bold)).foregroundColor(HK.textFaint)
        }
    }
}

// Intraday move bar: centered baseline, fills up (green) / down (red). ±5% = full half-width.
private struct MoveBar: View {
    let pct: Double
    var body: some View {
        let frac = min(abs(pct) / 5.0, 1.0)
        let color = pct >= 0 ? HK.ready : HK.error
        return GeometryReader { g in
            let half = g.size.width / 2
            ZStack(alignment: .center) {
                RoundedRectangle(cornerRadius: 3).fill(HK.line).frame(height: 6)
                Rectangle().fill(HK.lineSoft).frame(width: 1, height: 12) // baseline tick
                HStack(spacing: 0) {
                    if pct < 0 {
                        Spacer().frame(width: half - half * frac)
                        RoundedRectangle(cornerRadius: 3).fill(color.opacity(0.85))
                            .frame(width: half * frac, height: 6)
                        Spacer().frame(width: half)
                    } else {
                        Spacer().frame(width: half)
                        RoundedRectangle(cornerRadius: 3).fill(color.opacity(0.85))
                            .frame(width: half * frac, height: 6)
                        Spacer().frame(width: half - half * frac)
                    }
                }
            }
        }.frame(height: 12)
    }
}

// MARK: - Detail sheet

private struct StockDetailSheet: View {
    let intel: StockIntel
    @ObservedObject var vm: WealthVM
    var goToExecute: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var chartMonths = 3   // 1 / 3 / 6 / 0=MAX

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                moveCard
                chartCard
                lightsCard
                if let plan = intel.plan { planCard(plan) } else { noPlanCard }
                rationaleCard
                Text("The engine's edge is unproven. Treat this as a teaching tool first until the proof ladder graduates.")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            }
            .padding(18)
        }
        // Aurora canvas — the light the floating glass cards refract.
        .background(HKAurora(tint: (intel.changePct ?? 0) >= 0 ? HK.ready : HK.error).ignoresSafeArea())
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(intel.symbol).font(.system(size: 26, weight: .heavy)).foregroundColor(HK.text)
                    Text(intel.name ?? "Small-cap · outside the liquid-200 universe")
                        .font(.system(size: 12)).foregroundColor(HK.textDim)
                }
                Spacer()
                if let p = intel.displayPrice {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Money.rupeesFromRupee(p)).font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundColor(HK.text)
                        if let c = intel.changePct { Pill(text: String(format: "%+.2f%%", c), color: c >= 0 ? HK.ready : HK.error) }
                        Text(intel.showsLive ? "live" : "yesterday's close").font(.system(size: 9)).foregroundColor(HK.textFaint)
                    }
                }
            }
            if let thesis = intel.thesis, !thesis.isEmpty {
                Text(thesis).font(.system(size: 13)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
            if !intel.showsLive {
                Text("Live prices begin at market open, 9:15 AM. Showing the last close until then.")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            }
        }
    }

    // The price GRAPH — daily close line (Swift Charts off action=eod), 1M/3M/6M/MAX.
    private var chartCard: some View {
        let all = vm.eodCache[intel.symbol] ?? []
        let shown = chartMonths == 0 ? all : Array(all.suffix(max(2, chartMonths * 21)))
        let closes = shown.compactMap { $0.close }
        let lo = closes.min() ?? 0, hi = closes.max() ?? 1
        let up = (shown.last?.close ?? 0) >= (shown.first?.close ?? 0)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Price graph").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                // Liquid Glass timeframe pills — grouped so the selection morphs between them.
                HKGlassGroup(spacing: 4) {
                    HStack(spacing: 4) {
                        ForEach([1, 3, 6, 0], id: \.self) { m in
                            Button { withAnimation(.easeInOut(duration: 0.2)) { chartMonths = m } } label: {
                                Text(m == 0 ? "MAX" : "\(m)M")
                                    .font(.system(size: 11, weight: chartMonths == m ? .heavy : .semibold))
                                    .foregroundColor(chartMonths == m ? HK.accent : HK.textFaint)
                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                    .hkGlass(Capsule(), tint: chartMonths == m ? HK.accent : nil, interactive: true,
                                             fallbackFill: chartMonths == m ? HK.accent.opacity(0.15) : Color.clear,
                                             fallbackStroke: .clear, fallbackStrokeWidth: 0)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            if shown.count >= 2 {
                Chart(shown) { bar in
                    if let c = bar.close {
                        LineMark(x: .value("Date", bar.trade_date), y: .value("Close", c))
                            .foregroundStyle(up ? HK.ready : HK.error)
                            .interpolationMethod(.monotone)
                        AreaMark(x: .value("Date", bar.trade_date), yStart: .value("lo", lo), yEnd: .value("Close", c))
                            .foregroundStyle(LinearGradient(colors: [(up ? HK.ready : HK.error).opacity(0.22), .clear], startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.monotone)
                    }
                }
                .chartYScale(domain: (lo * 0.99)...(hi * 1.01))
                .chartXAxis(.hidden)
                .frame(height: 160)
                HStack {
                    Text("\(shown.count) trading days").font(.system(size: 10)).foregroundColor(HK.textFaint)
                    Spacer()
                    Text("₹\(Int(lo)) – ₹\(Int(hi))").font(.system(size: 10)).foregroundColor(HK.textFaint)
                }
            } else {
                Text(vm.eodCache[intel.symbol] == nil ? "Loading the graph…" : "No price history for this stock.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim).frame(height: 80)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        // The showcase: a glass panel floating over the trend-tinted aurora.
        .hkGlass(cornerRadius: HK.radius)
        .task(id: intel.symbol) { await vm.loadEod(intel.symbol) }
    }

    private var moveCard: some View {
        Card {
            Text("Today's move").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            if let c = intel.changePct {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(String(format: "%+.2f%%", c)).font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundColor(c >= 0 ? HK.ready : HK.error)
                    Text(intel.showsLive ? "vs previous close, live" : "yesterday vs the day before").font(.system(size: 11)).foregroundColor(HK.textFaint)
                    Spacer()
                }
                MoveBar(pct: c).frame(height: 14)
                if let prev = intel.price?.prev_close_rupees {
                    Row(label: "Previous close", value: Money.rupeesFromRupee(prev))
                }
                if let val = intel.price?.daily_value_cr {
                    Row(label: "Traded value", value: "₹\(Int(val)) Cr")
                }
            } else {
                Text("No price series for this stock (outside the liquid-200). The engine still scores it on trend, breadth and catalyst below.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            }
        }
    }

    private var lightsCard: some View {
        Card {
            Text("THE 5 LIGHTS — how this setup is judged").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.textFaint)
            ForEach(intel.lights()) { l in
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(l.state.color).frame(width: 28, height: 28)
                        Text("\(l.n)").font(.system(size: 13, weight: .heavy)).foregroundColor(HK.bg)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(l.title).font(.system(size: 14, weight: .bold)).foregroundColor(HK.text)
                            Spacer()
                            Text(l.scoreText).font(.system(size: 12, weight: .heavy, design: .rounded)).foregroundColor(l.state.color)
                            Text(l.state.label).font(.system(size: 9, weight: .heavy)).foregroundColor(l.state.color)
                        }
                        Text(l.why).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if l.n != 5 { Divider().background(HK.lineSoft) }
            }
            if let comp = intel.composite {
                Divider().background(HK.line)
                HStack {
                    Text("Overall setup strength").font(.system(size: 13)).foregroundColor(HK.textDim)
                    Spacer()
                    CompositeChip(value: comp)
                }
                CompositeMeter(value: comp)
            }
            Text("Grey = no data yet for that question (some signals need the market open or thin market-wide). More green = a stronger setup.")
                .font(.system(size: 10)).foregroundColor(HK.textFaint)
        }
    }

    private func planCard(_ plan: VerdictPlan) -> some View {
        Card {
            HStack {
                Text(vm.tradeAuthorized ? "TODAY'S BROKER PLAN" : "TODAY'S MACHINE PLAN").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.accent)
                Spacer()
                Pill(text: vm.tradeAuthorized ? "THE PICK" : "INTELLIGENCE", color: vm.tradeAuthorized ? HK.accent : HK.ready)
            }
            if let e = plan.entry { Row(label: "Entry", value: Money.rupeesFromRupee(e)) }
            if let s = plan.stop { Row(label: "Stop (cut loss)", value: Money.rupeesFromRupee(s), valueColor: HK.error) }
            if let t = plan.target { Row(label: "Target (take profit)", value: Money.rupeesFromRupee(t), valueColor: HK.ready) }
            if let q = plan.qty { Row(label: "Quantity", value: "\(q) shares") }
            if let risk = riskRupees(plan) {
                Row(label: "Money at risk", value: Money.rupeesFromRupee(risk), valueColor: HK.error)
            }
            if let rr = plan.rr { Row(label: "Reward : risk", value: String(format: "1 : %.1f", rr), valueColor: HK.ready) }

            if vm.tradeAuthorized {
                Button {
                    vm.prefill = WealthVM.OrderDraft(
                        symbol: intel.symbol,
                        stop: plan.stop.map { String(format: "%.2f", $0) } ?? "",
                        target: plan.target.map { String(format: "%.2f", $0) } ?? "",
                        qty: plan.qty.map(String.init) ?? "")
                    goToExecute()
                } label: {
                    Text("Review & place \(intel.symbol) →")
                        .font(.system(size: 15, weight: .bold)).foregroundColor(HK.bg)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.accent))
                }
                Text("Opens Execute pre-filled. Nothing fires until you confirm with Face ID and the server gate remains open.")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            } else {
                Text(vm.executionGate?.owner_truth ?? "Machine plan only. No broker order is authorized.")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            }
        }
    }

    private var noPlanCard: some View {
        Card {
            Text("Research watch only").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            Text("The engine composes one broker-facing plan only when the server gate authorizes TRADE. This stock is for watching, research, and learning; it is not a broker order.")
                .font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            Pill(text: intel.priceContext == "live" ? "LIVE WATCH" : "AT CLOSE", color: intel.priceContext == "live" ? HK.ready : HK.idle)
        }
    }

    private var rationaleCard: some View {
        Card {
            Text("Why the engine flagged it").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            let mtf = intel.signal?.mtf_alignment?.replacingOccurrences(of: "_", with: " ")
            let regime = intel.signal?.regime?.replacingOccurrences(of: "_", with: " ")
            if intel.signal != nil {
                if let mtf = mtf { Row(label: "Multi-timeframe", value: mtf.capitalized) }
                if let regime = regime { Row(label: "Market regime", value: regime.capitalized) }
                Text(plainRationale()).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No engine signal for this stock — it's here for price reference / learning.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            }
        }
    }

    private func plainRationale() -> String {
        guard let s = intel.signal else { return "" }
        var parts: [String] = []
        if (s.trend_score ?? 0) >= 67 { parts.append("strong uptrend") }
        if (s.flow_score ?? 50) > 50 { parts.append("institutional buying") }
        if (s.catalyst_score ?? 50) > 55 { parts.append("a live catalyst") }
        if (s.breadth_score ?? 50) > 55 { parts.append("supportive breadth") }
        if parts.isEmpty { return "Picked mainly on trend; other signals are thin right now." }
        return "Flagged on " + parts.joined(separator: ", ") + "."
    }

    private func riskRupees(_ plan: VerdictPlan) -> Double? {
        guard let e = plan.entry, let s = plan.stop, let q = plan.qty else { return nil }
        return abs(e - s) * Double(q)
    }
}

private struct CompositeMeter: View {
    let value: Double
    var body: some View {
        let frac = min(max(value, 0) / 100.0, 1.0)
        let color: Color = value >= 67 ? HK.ready : (value >= 60 ? HK.running : HK.idle)
        return GeometryReader { g in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4).fill(HK.line).frame(height: 8)
                RoundedRectangle(cornerRadius: 4).fill(color).frame(width: max(6, g.size.width * frac), height: 8)
                // threshold tick at 60
                Rectangle().fill(HK.textFaint).frame(width: 1, height: 12)
                    .offset(x: g.size.width * 0.60)
            }
        }.frame(height: 12)
    }
}
