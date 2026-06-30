import SwiftUI

// One stock row — symbol, price, visual change bar.
private struct StockRow: View {
    let stock: WatchlistStock
    private var chg: Double { stock.change_pct ?? 0 }
    private var chgColor: Color { chg >= 0 ? HK.ready : HK.error }
    private var priceStr: String {
        guard let p = stock.last_close_rupees else { return "—" }
        if p >= 10000 { return "₹\(String(format: "%.0f", p))" }
        if p >= 1000 { return "₹\(String(format: "%.0f", p))" }
        return "₹\(String(format: "%.1f", p))"
    }
    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(stock.symbol).font(.system(size: 13, weight: .bold)).foregroundColor(HK.text)
                Text(stock.name?.components(separatedBy: " ").prefix(2).joined(separator: " ") ?? "")
                    .font(.system(size: 10)).foregroundColor(HK.textFaint).lineLimit(1)
            }.frame(width: 90, alignment: .leading)
            Text(priceStr).font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundColor(HK.textDim).frame(width: 58, alignment: .trailing)
            // Change bar: max bar width represents ±5%
            GeometryReader { g in
                let maxW = g.size.width
                let barW = min(abs(chg) / 5.0, 1.0) * maxW
                ZStack(alignment: chg >= 0 ? .leading : .trailing) {
                    RoundedRectangle(cornerRadius: 3).fill(HK.line).frame(height: 6)
                    RoundedRectangle(cornerRadius: 3).fill(chgColor.opacity(0.7)).frame(width: max(barW, 4), height: 6)
                }
            }.frame(height: 6)
            Text(String(format: "%+.1f%%", chg))
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundColor(chgColor).frame(width: 50, alignment: .trailing)
        }.padding(.vertical, 3)
    }
}

// Owner-language situation — what's happening + the ONE thing to do. No engine internals.
private enum NowAction { case connectKite, place(String), none }
private struct Situation { let headline: String; let sub: String; let tone: Color; let action: NowAction }

/// The "Now" tab — answers the owner's real questions in plain words:
/// what's happening, what's my money doing, what do I do right now. No raw engine metrics.
struct NowView: View {
    @ObservedObject var vm: WealthVM
    var session: WealthSession?
    var goToExecute: () -> Void

    @State private var pendingDeployable: Int?
    private let presets: [(String, Int)] = [("₹10K", 1_000_000), ("₹25K", 2_500_000), ("₹50K", 5_000_000), ("₹1L", 10_000_000)]

    private var kiteOK: Bool { vm.kiteConnected }
    private var positions: Int { vm.auto?.summary?.total_positions ?? 0 }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Now", session: session, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    situationHero
                    ScoutTodayCard(vm: vm)
                    SignalProofCard(vm: vm)
                    if vm.briefing?.llm_narrative != nil { briefingCard }
                    moneyCard
                    if positions > 0 { positionCard }
                    pickCard
                    marketContextCard
                    topPicksCard
                    kiteCapitalCard
                    if !vm.status.isEmpty { Text(vm.status).font(.system(size: 12)).foregroundColor(HK.error) }
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
                    Task { _ = try? await WealthClient.shared.setConfig(key: "today_deployable_paise", value: String(p)); await vm.refresh(); pendingDeployable = nil }
                }
            }
            Button("Cancel", role: .cancel) { pendingDeployable = nil }
        } message: { Text("Sets your position size + the profit-lock / loss-halt levels. Places no order.") }
    }

    // ── The one thing happening + the one thing to do ──
    private var situationHero: some View {
        let s = situation()
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Pill(text: marketLabel.0, color: marketLabel.1)
                Text(vm.plan?.time ?? "").font(.system(size: 12, weight: .semibold)).foregroundColor(HK.textDim)
                Spacer()
            }
            Text(s.headline).font(.system(size: 21, weight: .heavy)).foregroundColor(s.tone)
            Text(s.sub).font(.system(size: 14)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            switch s.action {
            case .connectKite:
                KiteConnectButton(vm: vm, label: "Connect Kite")
            case .place(let sym):
                Button { vm.prefill = WealthVM.OrderDraft(symbol: sym, stop: "", target: "", qty: ""); goToExecute() } label: {
                    Text("Review & place \(sym) →").font(.system(size: 15, weight: .bold)).foregroundColor(HK.bg)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.accent))
                }
            case .none:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(18)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.accentSoft))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.accentLine, lineWidth: 1.5))
    }

    private func situation() -> Situation {
        let phase = (vm.plan?.phase ?? "").lowercased()
        let dec = vm.verdict?.decision
        let pick = vm.verdict?.recommended_symbol
        // Weekend / holiday FIRST: no "pick at 09:40" framing on a non-market day.
        if !vm.isMarketDay {
            let next = MarketCalendar.nextTradingDay()
            return Situation(
                headline: "Markets closed — \(MarketCalendar.weekday())",
                sub: "NSE is shut today. Last session was \(MarketCalendar.dayShort(MarketCalendar.lastTradingDay())); it reopens \(MarketCalendar.dayShort(next)) 9:15 AM and the engine composes its next call \(MarketCalendar.weekday(next)) 09:40. Nothing to do — rest.",
                tone: HK.idle, action: .none)
        }
        if !kiteOK {
            return Situation(headline: "Connect Kite to begin",
                             sub: "Your broker link powers live prices and orders. It's a 30-second login each morning — tokens reset overnight.",
                             tone: HK.running, action: .connectKite)
        }
        if positions > 0 {
            return Situation(headline: "You're in a trade",
                             sub: "The engine is holding the stop and target. Watch it on the Execute tab; it squares off by 3:10 PM.",
                             tone: HK.accent, action: .none)
        }
        if dec == "TRADE", let p = pick, vm.tradeAuthorized {
            return Situation(headline: "Today: trade \(p)",
                             sub: "The engine found a setup. Review the exact entry, stop, target and quantity before placing it. Treat it as unproven until the proof ladder graduates.",
                             tone: HK.ready, action: .place(p))
        }
        if dec == "TRADE", let p = pick {
            return Situation(headline: "Today: \(p) is staged only",
                             sub: vm.executionGate?.owner_truth ?? "The machine plan is visible, but the broker gate is closed. No order can fire until the server authorizes it.",
                             tone: HK.running, action: .none)
        }
        if dec == "OBSERVE" {
            return Situation(headline: "Today: observe only",
                             sub: vm.executionGate?.owner_truth ?? "The machine plan is intelligence only today. Paper scout results are for learning; no broker order is authorized.",
                             tone: HK.idle, action: .none)
        }
        if dec == "SIT_OUT" {
            return Situation(headline: "Today: no engine trade",
                             sub: "No proven edge is available right now. This is an engine no-trade verdict, not a record that you personally sat out.",
                             tone: HK.idle, action: .none)
        }
        if phase.contains("overnight") || phase.contains("pre") || phase.isEmpty {
            return Situation(headline: "Pre-market — engine composes at 09:40",
                             sub: "Nothing to do yet. The engine waits for the opening bars and composes today's call around 09:40 AM. You're connected and set.",
                             tone: HK.text, action: .none)
        }
        return Situation(headline: "Watching the market",
                         sub: "No pick right now. The engine is scanning live and will surface a setup here if one appears.",
                         tone: HK.text, action: .none)
    }

    // ── Your money (net, plain) ──
    private var moneyCard: some View {
        Card {
            Text("Your money today").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            let pnl = vm.auto?.summary?.total_pnl_realized_paise
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Money.rupees(pnl)).font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundColor((pnl ?? 0) >= 0 ? HK.ready : HK.error)
                Text("net · after charges").font(.system(size: 12)).foregroundColor(HK.textFaint)
                Spacer()
            }
            Row(label: "In play today", value: Money.rupees(vm.deployablePaise))
            Row(label: "Capital", value: Money.rupees(vm.totalCapitalPaise) + " funded")
            Text("Brokerage + STT are already deducted — small trades lose more to charges, so size matters.")
                .font(.system(size: 11)).foregroundColor(HK.textFaint)
        }
    }

    private var positionCard: some View {
        Card {
            Text("Open right now").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            let s = vm.auto?.summary
            Row(label: "Positions", value: "\(s?.total_positions ?? 0)")
            Row(label: "Deployed", value: Money.rupees(s?.total_deployed_paise))
            Row(label: "P&L (net)", value: Money.rupees(s?.total_pnl_realized_paise),
                valueColor: (s?.total_pnl_realized_paise ?? 0) >= 0 ? HK.ready : HK.error)
        }
    }

    // ── The pick (only meaningful detail) ──
    private var pickCard: some View {
        Card {
            Text(vm.isMarketDay ? "Today's call" : "Next call").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            if !vm.isMarketDay {
                let next = MarketCalendar.nextTradingDay()
                Text("Markets are closed (\(MarketCalendar.weekday())). The engine's next call composes \(MarketCalendar.weekday(next)) 09:40 AM — see Friday's on the Today tab's trail.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            } else if vm.verdict?.decision == "TRADE", let p = vm.verdict?.recommended_symbol {
                Row(label: "Decision", value: "TRADE", valueColor: HK.ready)
                Row(label: "Stock", value: p)
                Text(vm.tradeAuthorized ? "Full entry / stop / target opens in Execute. Confidence is unproven — keep it small." : "Staged intelligence only. Execute stays locked until the broker gate opens.")
                    .font(.system(size: 11)).foregroundColor(vm.tradeAuthorized ? HK.running : HK.textFaint)
            } else if vm.verdict?.decision == "OBSERVE" {
                Row(label: "Decision", value: "OBSERVE", valueColor: HK.idle)
                if let sym = vm.verdict?.recommended_symbol { Row(label: "Machine plan", value: sym) }
                Text(vm.executionGate?.owner_truth ?? "Paper scout only. No broker order is authorized today.")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
            } else if vm.verdict?.decision == "SIT_OUT" {
                Row(label: "Decision", value: "NO ENGINE TRADE", valueColor: HK.idle)
            } else {
                Text("Composes around 09:40 AM (Mon–Fri), after the opening bars. Until then there's nothing to act on.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            }
        }
    }

    // ── Kite + capital (compact, tucked at the bottom) ──
    private var kiteCapitalCard: some View {
        Card {
            HStack {
                Text("Setup").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                Pill(text: kiteOK ? "KITE OK" : "KITE OFF", color: kiteOK ? HK.ready : HK.running)
                Pill(text: vm.tradeAuthorized ? "ORDER GATE OPEN" : "BROKER BLOCKED", color: vm.tradeAuthorized ? HK.error : HK.ready)
            }
            Text("Today's size").font(.system(size: 12)).foregroundColor(HK.textDim)
            HStack(spacing: 8) {
                ForEach(presets.indices, id: \.self) { i in
                    let item = presets[i]
                    Button { pendingDeployable = item.1 } label: {
                        Text(item.0).font(.system(size: 13, weight: .bold))
                            .foregroundColor(vm.deployablePaise == item.1 ? HK.bg : HK.text)
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(vm.deployablePaise == item.1 ? HK.accent : HK.cardHi))
                    }
                }
            }
        }
    }

    // ── Morning read (engine-composed briefing) ──
    private var briefingCard: some View {
        Card {
            HStack {
                Text("Morning read").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                if let d = vm.briefing?.date { Text(d).font(.system(size: 11)).foregroundColor(HK.textFaint) }
            }
            if let narrative = vm.briefing?.llm_narrative {
                // Strip markdown bold markers for clean on-screen display.
                let clean = narrative
                    .replacingOccurrences(of: "**", with: "")
                    .replacingOccurrences(of: "__", with: "")
                Text(String(clean.prefix(600)) + (clean.count > 600 ? "…" : ""))
                    .font(.system(size: 13)).foregroundColor(HK.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let facts = vm.briefing?.supporting_facts, !facts.isEmpty {
                Divider().background(HK.line)
                ForEach(Array(facts.prefix(4).enumerated()), id: \.offset) { _, fact in
                    HStack(alignment: .top, spacing: 6) {
                        Text("·").font(.system(size: 13, weight: .bold)).foregroundColor(HK.accent)
                        Text(fact).font(.system(size: 12)).foregroundColor(HK.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // ── Market context (FII/DII + VIX + regime) ──
    private var marketContextCard: some View {
        Card {
            Text("Market context").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
            let state = vm.plan?.state
            let fii = state?.fii_yesterday_cr
            let dii = state?.dii_yesterday_cr
            let vix = vm.engine?.regime?.evidence?.india_vix
            let regime = vm.engine?.regime?.current
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("FII").font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint)
                    if let f = fii {
                        Text(f >= 0 ? "+₹\(Int(f)) Cr" : "−₹\(Int(-f)) Cr")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundColor(f >= 0 ? HK.ready : HK.error)
                        Text("foreign funds").font(.system(size: 10)).foregroundColor(HK.textFaint)
                    } else { Text("—").font(.system(size: 15, weight: .heavy)).foregroundColor(HK.textDim) }
                }
                Spacer()
                VStack(alignment: .center, spacing: 4) {
                    Text("DII").font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint)
                    if let d = dii {
                        Text(d >= 0 ? "+₹\(Int(d)) Cr" : "−₹\(Int(-d)) Cr")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundColor(d >= 0 ? HK.ready : HK.error)
                        Text("domestic funds").font(.system(size: 10)).foregroundColor(HK.textFaint)
                    } else { Text("—").font(.system(size: 15, weight: .heavy)).foregroundColor(HK.textDim) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("VIX").font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint)
                    if let v = vix {
                        Text(String(format: "%.1f", v))
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundColor(v < 15 ? HK.ready : (v < 20 ? HK.running : HK.error))
                        Text(v < 15 ? "calm" : (v < 20 ? "moderate" : "volatile"))
                            .font(.system(size: 10)).foregroundColor(HK.textFaint)
                    } else { Text("—").font(.system(size: 15, weight: .heavy)).foregroundColor(HK.textDim) }
                }
            }
            if let r = regime {
                Divider().background(HK.line)
                HStack {
                    Text("Regime").font(.system(size: 13)).foregroundColor(HK.textDim)
                    Spacer()
                    Text(r.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(HK.text)
                }
                if let desc = vm.engine?.regime?.explainer?.desc {
                    Text(desc).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // ── Top picks (visual change bars) ──
    private var topPicksCard: some View {
        let stocks = vm.stockPicker?.watchlist?.prefix(8) ?? []
        return Card {
            HStack {
                Text("Engine watchlist").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                if let total = vm.stockPicker?.total {
                    Text("\(total) tracked").font(.system(size: 11)).foregroundColor(HK.textFaint)
                }
            }
            if stocks.isEmpty {
                Text("Loading picks…").font(.system(size: 13)).foregroundColor(HK.textDim)
            } else {
                ForEach(Array(stocks)) { s in
                    StockRow(stock: s)
                }
                Text("Yesterday's close · live prices at market open 09:15")
                    .font(.system(size: 10)).foregroundColor(HK.textFaint)
            }
        }
    }

    private var marketLabel: (String, Color) {
        if vm.intel?.in_market_hours == true { return ("MARKET OPEN", HK.ready) }
        if !vm.isMarketDay { return (MarketCalendar.closedLabel, HK.idle) }
        let p = (vm.plan?.phase ?? "").lowercased()
        if p.contains("pre") { return ("PRE-MARKET", HK.running) }
        if p.contains("overnight") || p.isEmpty { return ("CLOSED", HK.idle) }
        return (p.uppercased(), HK.idle)
    }
}
