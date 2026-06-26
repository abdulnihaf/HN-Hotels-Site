import SwiftUI

// Beginner "Today" — teaches the 5-question trade checklist and applies it to today, honestly.
private enum Light { case green, amber, pending }

struct SetupView: View {
    @ObservedObject var vm: WealthVM

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Today", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    tradeDayCard
                    checklistCard
                    moneyRuleCard
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
    }

    // Is today a trade day? (plain read from verdict + market regime)
    private var tradeDayCard: some View {
        let dec = vm.verdict?.decision
        let pick = vm.verdict?.recommended_symbol
        let (head, sub, tone): (String, String, Color) = {
            if dec == "TRADE", let p = pick {
                return ("Yes — a setup in \(p)", "The engine found a stock worth trading today. Read the 5 lights below to see why.", HK.ready)
            }
            if dec == "SIT_OUT" {
                return ("No engine trade today", "No proven setup is available right now. The app records this as no engine trade, not as a manual sit-out by you.", HK.idle)
            }
            return ("Not decided yet", "The engine picks today's stock at 8:30 AM. Until then, learn the 5 lights below — that's how every trade is judged.", HK.text)
        }()
        return VStack(alignment: .leading, spacing: 8) {
            Text("Is today a trade day?").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.accent)
            Text(head).font(.system(size: 20, weight: .heavy)).foregroundColor(tone)
            Text(sub).font(.system(size: 13)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            if let r = vm.engine?.regime?.current {
                Text("Market mood: \(marketMood(r))").font(.system(size: 12, weight: .semibold)).foregroundColor(HK.textFaint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(18)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.accentSoft))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.accentLine, lineWidth: 1.5))
    }

    // The teaching core — 5 questions, each a light.
    private var checklistCard: some View {
        Card {
            Text("THE 5 LIGHTS — how every trade is judged").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.textFaint)
            qRow(1, "Is it moving up?",      "Price breaks above the morning high on heavy volume — a real move, not a fake one.", q1())
            qRow(2, "Is the market helping?", "When the Nifty is rising, stocks float up with it. Don't fight the tide.", q2())
            qRow(3, "Is big money in?",        "Banks and funds buying = wind in your sails. They move the price.", q3())
            qRow(4, "Is there a reason?",      "News, results, a big order, a hot sector — moves with a reason last longer.", .pending)
            qRow(5, "What's my risk?",         "Where you cut the loss vs take profit. Risk ₹1 to make ₹2 — never the reverse.", .pending)
            Text("More green = better trade. The lights fill in as today's data arrives (some need the market open + the 8:30 pick).")
                .font(.system(size: 11)).foregroundColor(HK.textFaint)
        }
    }

    private var moneyRuleCard: some View {
        Card {
            Text("THE ONE RULE THAT MAKES MONEY").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.textFaint)
            Text("Cut losses fast and small. Let winners run. Be flat by 3:10 PM.")
                .font(.system(size: 15, weight: .bold)).foregroundColor(HK.text)
            Text("You don't need to be right often. You need your wins bigger than your losses. Make ₹500 on wins, lose ₹200 on losses — win half the time and you're still ahead.")
                .font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
        }
    }

    // ── per-question lights (honest: only fill what the data supports) ──
    private func q1() -> Light { .pending }   // needs the pick + live price (market hours)
    private func q2() -> Light {
        guard let r = vm.engine?.regime?.current?.lowercased() else { return .pending }
        if r.contains("trend") || r.contains("up") || r.contains("bull") { return .green }
        if r.contains("rang") || r.contains("mixed") || r.contains("neutral") { return .amber }
        return .amber
    }
    private func q3() -> Light {
        guard let fii = vm.plan?.state?.fii_yesterday_cr else { return .pending }
        return fii >= 0 ? .green : .amber
    }

    private func marketMood(_ r: String) -> String {
        let s = r.lowercased()
        if s.contains("trend") { return "trending — moves can run (good for breakouts)" }
        if s.contains("rang") { return "range-bound — choppy, be picky and quick" }
        return r
    }

    @ViewBuilder
    private func qRow(_ n: Int, _ q: String, _ good: String, _ light: Light) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(.system(size: 13, weight: .heavy)).foregroundColor(HK.bg)
                .frame(width: 26, height: 26).background(Circle().fill(lightColor(light)))
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(q).font(.system(size: 14, weight: .bold)).foregroundColor(HK.text)
                    Spacer()
                    Text(lightLabel(light)).font(.system(size: 10, weight: .heavy)).foregroundColor(lightColor(light))
                }
                Text(good).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
    private func lightColor(_ l: Light) -> Color { switch l { case .green: return HK.ready; case .amber: return HK.running; case .pending: return HK.idle } }
    private func lightLabel(_ l: Light) -> String { switch l { case .green: return "GOOD"; case .amber: return "CAUTION"; case .pending: return "AT 8:30" } }
}
