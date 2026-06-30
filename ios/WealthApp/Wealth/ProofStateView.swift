import SwiftUI

private enum WealthProofState {
    case rejected
    case watch
    case deployable
    case unknown

    var label: String {
        switch self {
        case .rejected: return "LEARNING"
        case .watch: return "SCOUT"
        case .deployable: return "BROKER READY"
        case .unknown: return "UNKNOWN"
        }
    }

    var color: Color {
        switch self {
        case .rejected: return HK.error
        case .watch: return HK.running
        case .deployable: return HK.ready
        case .unknown: return HK.idle
        }
    }

    var headline: String {
        switch self {
        case .rejected: return "Learning mode"
        case .watch: return "Research signal only"
        case .deployable: return "Broker signal cleared"
        case .unknown: return "Proof state not loaded"
        }
    }
}

private struct ProofWitness: Identifiable {
    enum Status { case pass, warn, fail, unknown }

    let id: String
    let label: String
    let value: String
    let detail: String
    let status: Status

    var color: Color {
        switch status {
        case .pass: return HK.ready
        case .warn: return HK.running
        case .fail: return HK.error
        case .unknown: return HK.idle
        }
    }

    var icon: String {
        switch status {
        case .pass: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .fail: return "xmark.circle.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }
}

struct SignalProofCard: View {
    @ObservedObject var vm: WealthVM
    var compact = false

    var body: some View {
        let state = proofState
        Card {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Signal state")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(HK.textFaint)
                    Text(state.headline)
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundColor(state.color)
                }
                Spacer()
                Pill(text: state.label, color: state.color)
            }

            Text(summaryText(for: state))
                .font(.system(size: 13))
                .foregroundColor(HK.textDim)
                .fixedSize(horizontal: false, vertical: true)

            if !metricLine.isEmpty {
                Text(metricLine)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(HK.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().background(HK.line)

            ForEach(witnesses) { w in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: w.icon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(w.color)
                        .frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(w.label)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(HK.text)
                            Spacer()
                            Text(w.value)
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundColor(w.color)
                        }
                        if !compact || w.status != .pass {
                            Text(w.detail)
                                .font(.system(size: 11))
                                .foregroundColor(HK.textDim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    private var proofState: WealthProofState {
        guard let raw = vm.researchDepth?.verdict?.uppercased(), !raw.isEmpty else { return .unknown }
        if raw == "NO_EDGE" || raw.contains("NO_EDGE") { return .rejected }
        if raw.contains("DEPLOY") || (raw == "EDGE" && chainIsOK && vm.kiteConnected) { return .deployable }
        if raw.contains("EDGE") || raw.contains("CANDIDATE") || raw.contains("THIN") { return .watch }
        return .unknown
    }

    private var chainIsOK: Bool {
        (vm.chainHealth?.overall ?? "").lowercased() == "ok" && (vm.chainHealth?.checks ?? []).allSatisfy { ($0.status ?? "").lowercased() == "ok" }
    }

    private func summaryText(for state: WealthProofState) -> String {
        switch state {
        case .rejected:
            return "The research stack found opportunity, but the tested selection has not yet passed the required OOS, fold, and random-null gates for money."
        case .watch:
            return "There may be selection skill here, but one or more proof gates are incomplete. This can be watched or paper-scouted, not bought with size."
        case .deployable:
            return "Data, causality, OOS proof, live freshness, capacity, and order-path witnesses must all stay green before placing money."
        case .unknown:
            return "The app could not read the latest research verdict yet. Treat this as no-trade until the proof chain loads."
        }
    }

    private var witnesses: [ProofWitness] {
        let rd = vm.researchDepth
        let chain = vm.chainHealth
        let universe = rd?.universe_syms ?? 0
        let bars = rd?.bars_total ?? 0
        let verdict = displayVerdict(rd?.verdict)
        let z = rd?.random_null?.z_vs_null
        let folds = rd?.folds_positive ?? "n/a"
        let overall = (chain?.overall ?? "missing").uppercased()

        let dataStatus: ProofWitness.Status = universe >= 1_000 && bars >= 1_000_000 ? .pass : (rd == nil ? .unknown : .warn)
        let causalMethod = (rd?.method ?? "").lowercased()
        let causalStatus: ProofWitness.Status = causalMethod.contains("walk-forward") && causalMethod.contains("point-in-time") ? .pass : (rd == nil ? .unknown : .warn)
        let oosStatus: ProofWitness.Status = {
            switch proofState {
            case .deployable: return .pass
            case .watch: return .warn
            case .rejected: return .fail
            case .unknown: return .unknown
            }
        }()
        let liveStatus: ProofWitness.Status = {
            guard let chain else { return .unknown }
            if chain.overall == "ok" { return .pass }
            if chain.overall == "warn" { return .warn }
            return .fail
        }()
        let orderStatus: ProofWitness.Status = vm.kiteConnected ? (proofState == .deployable ? .pass : .warn) : .fail

        return [
            ProofWitness(
                id: "data",
                label: "Data coverage",
                value: dataStatus == .pass ? "PASS" : "CHECK",
                detail: "\(formatCount(universe)) stocks, \(formatCount(bars)) five-minute bars, \(rd?.date_range?.joined(separator: " -> ") ?? "no range")",
                status: dataStatus
            ),
            ProofWitness(
                id: "causal",
                label: "Causality",
                value: causalStatus == .pass ? "PASS" : "AUDIT",
                detail: rd?.method ?? "No method returned by the server.",
                status: causalStatus
            ),
            ProofWitness(
                id: "oos",
                label: "OOS / random-null",
                value: verdict,
                detail: "OOS \(pct(rd?.oos_expectancy_pct)) per trade, folds \(folds), random-null z \(z.map { String(format: "%.2f", $0) } ?? "n/a").",
                status: oosStatus
            ),
            ProofWitness(
                id: "live",
                label: "Live chain",
                value: overall,
                detail: (chain?.checks ?? []).map { "\($0.name): \($0.status ?? "?")" }.prefix(4).joined(separator: " · "),
                status: liveStatus
            ),
            ProofWitness(
                id: "order",
                label: "Order path",
                value: vm.kiteConnected ? "KITE OK" : "KITE OFF",
                detail: vm.kiteConnected
                    ? "Broker connection is live. A real order still needs the Execute screen's Face ID witness."
                    : "No real order path without the daily Kite token.",
                status: orderStatus
            ),
        ]
    }

    private var metricLine: String {
        guard let rd = vm.researchDepth else { return "" }
        let trades = rd.oos_trades.map(formatCount) ?? "n/a"
        let skill = pct(rd.random_null?.edge_vs_null)
        return "OOS trades \(trades) · skill vs random \(skill) · cost \(pct(rd.cost_assumption_pct))"
    }

    private func displayVerdict(_ raw: String?) -> String {
        let v = (raw ?? "missing").uppercased()
        if v == "NO_EDGE" || v.contains("NO_EDGE") { return "LEARNING" }
        if v.contains("DEPLOY") { return "BROKER READY" }
        if v.contains("EDGE") || v.contains("CANDIDATE") || v.contains("THIN") { return "SCOUT" }
        return v
    }

    private func formatCount(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000.0) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000.0) }
        return "\(n)"
    }

    private func pct(_ value: Double?) -> String {
        guard let value else { return "n/a" }
        return String(format: "%+.3f%%", value)
    }
}
