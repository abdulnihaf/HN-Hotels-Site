import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// SCOUT — the daily LEARNING action. Answers the owner's questions on one screen:
// why this, why not the other ~1,200, exact rupee risk, what proves it wrong,
// what we learned. Honest by construction: a paper scout is learning + market
// contact, never a proven ₹1L edge. Reuses the HK cockpit system.
// ─────────────────────────────────────────────────────────────────────────────

private func rupee(_ v: Double?, _ decimals: Bool = true) -> String {
    guard let v else { return "—" }
    return Money.rupeesFromRupee(decimals ? (Double(Int(v * 100)) / 100) : v)
}

// The 5-rung ladder: REJECTED → PAPER_SCOUT → TOKEN_SCOUT → WATCH_SCOUT → DEPLOYABLE
struct ScoutLadderStrip: View {
    let ladder: ScoutLadderModel
    private let order = ["REJECTED", "PAPER_SCOUT", "TOKEN_SCOUT", "WATCH_SCOUT", "DEPLOYABLE"]
    private func short(_ s: String) -> String {
        switch s {
        case "REJECTED": return "Reject"
        case "PAPER_SCOUT": return "Paper"
        case "TOKEN_SCOUT": return "Token"
        case "WATCH_SCOUT": return "Watch"
        case "DEPLOYABLE": return "Deploy"
        default: return s
        }
    }
    var body: some View {
        let action = ladder.action_rung ?? "PAPER_SCOUT"
        let proof = ladder.proof_rung ?? "REJECTED"
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(order, id: \.self) { rung in
                    let isAction = rung == action
                    let isProof = rung == proof
                    VStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(isAction ? HK.accent : (isProof ? HK.error.opacity(0.5) : HK.line))
                            .frame(height: 6)
                        Text(short(rung))
                            .font(.system(size: 9, weight: isAction ? .heavy : .semibold))
                            .foregroundColor(isAction ? HK.accent : (isProof ? HK.error : HK.textFaint))
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 6) {
                Text("Proof: \(short(proof))").font(.system(size: 10, weight: .bold)).foregroundColor(HK.error)
                Text("·").foregroundColor(HK.textFaint)
                Text("Today: \(short(action)) — \(action == "PAPER_SCOUT" ? "paper only" : "proof mode")").font(.system(size: 10, weight: .bold)).foregroundColor(HK.accent)
            }
            if let cond = ladder.to_deployable {
                Text(cond).font(.system(size: 10)).foregroundColor(HK.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// THE daily action card.
struct ScoutTodayCard: View {
    @ObservedObject var vm: WealthVM

    var body: some View {
        let s = vm.scoutToday
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY'S SCOUT").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.textFaint)
                    Text(s?.headline ?? (vm.loading ? "Loading today's scout…" : "No scout composed yet today"))
                        .font(.system(size: 19, weight: .heavy, design: .rounded))
                        .foregroundColor(HK.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if let mode = s?.mode { Pill(text: mode, color: mode == "TOKEN" ? HK.running : HK.idle) }
            }

            if let s, s.has_scout == true {
                if let ladder = s.ladder { ScoutLadderStrip(ladder: ladder) }

                // HONEST anchor — the most important line on the screen.
                if let honest = s.honest_expectation {
                    Text(honest)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(HK.running)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.running.opacity(0.10)))
                }

                if s.decision == "SCOUT", let sym = s.primary_symbol {
                    Divider().background(HK.line)
                    // WHY THIS
                    section("WHY \(sym)", s.why_this ?? "—")
                    if let cands = s.candidates, cands.count > 1 {
                        Text("Basket: " + cands.joined(separator: ", "))
                            .font(.system(size: 11)).foregroundColor(HK.textDim)
                    }
                    // THE PLAN + RISK (owner language)
                    if let p = s.plan { planBlock(p) }
                    // WHAT PROVES IT WRONG
                    if let inval = s.invalidation { section("WHAT PROVES IT WRONG", inval) }
                    // WHY NOT THE OTHERS
                    if let wn = s.why_not { whyNotBlock(wn) }
                } else {
                    // SKIPPED / quiet day
                    Text("Nothing qualified today. Watching the open, no paper trade — a quiet day is data too.")
                        .font(.system(size: 12)).foregroundColor(HK.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // OUTCOME (after the bell)
                if let o = s.outcome { outcomeBlock(o) }
                else if s.decision == "SCOUT" {
                    Text("Outcome lands after close — the system replays this plan and writes the lesson.")
                        .font(.system(size: 10)).foregroundColor(HK.textFaint)
                }
            } else {
                Text(s?.note ?? (vm.loading
                                 ? "Reading the 09:40 scout and latest lesson from trade.hnhotels.in."
                                 : "The scout is composed at 09:40 IST each market day. On a weekend or holiday there is none."))
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private func section(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 11, weight: .heavy)).foregroundColor(HK.accent)
            Text(body).font(.system(size: 13)).foregroundColor(HK.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func planBlock(_ p: ScoutPlanModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("THE PLAN (paper)").font(.system(size: 11, weight: .heavy)).foregroundColor(HK.accent)
            HStack(spacing: 0) {
                planCell("Enter", rupee(p.entry_rs), HK.text)
                planCell("Stop", rupee(p.stop_rs), HK.error)
                planCell("Target", rupee(p.target_rs), HK.ready)
                planCell("Qty", p.qty.map { "\($0)" } ?? "—", HK.text)
            }
            HStack {
                Text("Most you'd risk")
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(HK.textDim)
                Spacer()
                Text(rupee(p.expected_risk_rs))
                    .font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundColor(HK.error)
                Text("· if target " + rupee(p.expected_reward_rs))
                    .font(.system(size: 11)).foregroundColor(HK.ready)
            }
        }
    }

    @ViewBuilder private func planCell(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundColor(HK.textFaint)
            Text(value).font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundColor(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }.frame(maxWidth: .infinity)
    }

    @ViewBuilder private func whyNotBlock(_ wn: ScoutWhyNot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("WHY NOT THE OTHERS").font(.system(size: 11, weight: .heavy)).foregroundColor(HK.accent)
            HStack(spacing: 6) {
                funnel("\(wn.scanned ?? 0)", "scanned")
                arrow(); funnel("\(wn.gapped_up ?? 0)", "moved")
                arrow(); funnel("\(wn.liquid_scored ?? 0)", "liquid")
                arrow(); funnel("\(wn.picked ?? 0)", "picked")
            }
            ForEach(wn.sample_rejected ?? []) { r in
                HStack(alignment: .top, spacing: 6) {
                    Text(r.symbol).font(.system(size: 11, weight: .bold)).foregroundColor(HK.textDim).frame(width: 86, alignment: .leading)
                    Text(r.reason ?? "—").font(.system(size: 11)).foregroundColor(HK.textFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
    @ViewBuilder private func funnel(_ n: String, _ label: String) -> some View {
        VStack(spacing: 1) {
            Text(n).font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundColor(HK.text)
            Text(label).font(.system(size: 9)).foregroundColor(HK.textFaint)
        }
    }
    @ViewBuilder private func arrow() -> some View {
        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundColor(HK.textFaint)
    }

    @ViewBuilder private func outcomeBlock(_ o: ScoutOutcome) -> some View {
        let color = o.win_loss == "win" ? HK.ready : (o.win_loss == "loss" ? HK.error : HK.idle)
        VStack(alignment: .leading, spacing: 4) {
            Divider().background(HK.line)
            HStack {
                Text("WHAT HAPPENED").font(.system(size: 11, weight: .heavy)).foregroundColor(HK.accent)
                Spacer()
                if let wl = o.win_loss { Pill(text: wl.uppercased(), color: color) }
            }
            HStack(spacing: 10) {
                if let pnl = o.pnl_net_rs { metric("Paper P&L", rupee(pnl), color) }
                if let r = o.r_multiple { metric("R", String(format: "%.2f", r), color) }
                if let g = o.caught_grade { metric("Caught", g, HK.textDim) }
            }
            if let l = o.lesson {
                Text(l).font(.system(size: 12)).foregroundColor(HK.text).fixedSize(horizontal: false, vertical: true)
            }
            if let os = o.oracle_top_symbol, let op = o.oracle_top_pct {
                Text("Day's biggest mover: \(os) " + String(format: "%+.1f%%", op))
                    .font(.system(size: 10)).foregroundColor(HK.textFaint)
            }
        }
    }
    @ViewBuilder private func metric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundColor(HK.textFaint)
            Text(value).font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundColor(color)
        }
    }
}

// The learning trail — what the daily scouting taught over time.
struct ScoutTrailCard: View {
    @ObservedObject var vm: WealthVM
    var body: some View {
        let t = vm.scoutTrail
        Card {
            Text("LEARNING TRAIL").font(.system(size: 12, weight: .heavy)).foregroundColor(HK.textFaint)
            if let st = t?.stats {
                HStack(spacing: 0) {
                    stat("Active", "\(st.active_rate ?? 0)%", HK.accent)
                    stat("Hit rate", st.hit_rate_pct.map { "\($0)%" } ?? "—", HK.text)
                    stat("Paper P&L", rupee(st.cum_paper_net_rs, false), (st.cum_paper_net_rs ?? 0) >= 0 ? HK.ready : HK.error)
                    stat("Worst day", rupee(st.worst_day_net_rs, false), HK.error)
                }
                if let note = st.honest_note {
                    Text(note).font(.system(size: 11)).foregroundColor(HK.textFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Divider().background(HK.line)
            ForEach(t?.days ?? []) { d in
                HStack(alignment: .top, spacing: 8) {
                    Text(String((d.date ?? "").suffix(5))).font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint).frame(width: 42, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(d.symbol ?? (d.decision == "SCOUT" ? "—" : "sat out"))
                                .font(.system(size: 12, weight: .bold)).foregroundColor(HK.text)
                            if let wl = d.win_loss {
                                Pill(text: wl.uppercased(), color: wl == "win" ? HK.ready : wl == "loss" ? HK.error : HK.idle)
                            }
                            if let p = d.pnl_net_rs { Text(rupee(p)).font(.system(size: 11, weight: .semibold)).foregroundColor(p >= 0 ? HK.ready : HK.error) }
                        }
                        if let l = d.lesson {
                            Text(l).font(.system(size: 11)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
            }
            if (t?.days ?? []).isEmpty {
                Text(vm.loading && t == nil
                     ? "Reading the learning trail from trade.hnhotels.in…"
                     : "No scout days yet. The first lesson lands after the next market day's close.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            }
        }
    }
    @ViewBuilder private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundColor(color).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 10)).foregroundColor(HK.textFaint)
        }.frame(maxWidth: .infinity)
    }
}
