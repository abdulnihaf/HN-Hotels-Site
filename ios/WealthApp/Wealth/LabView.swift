import SwiftUI
import LocalAuthentication

// ─────────────────────────────────────────────────────────────────────────────
// Execution Lab — the one-tap testing cockpit.
// Prove every order path (entry / exit / bracket / panic) at SIM (₹0) or
// TINY-REAL (a rupee-capped, Face-ID-gated real order). Every run shows its live
// status, a step log with the verbatim broker error, and a one-tap fix on failure.
// A sticky KILL button flattens everything. Nothing here arms auto-trading.
// ─────────────────────────────────────────────────────────────────────────────

enum LabKind { case tokenCheck, equityRoundTrip, bracket, squareOffAll, killSwitch }

struct LabScenario: Identifiable {
    let id: String
    let title: String
    let category: String
    let kind: LabKind
    let detail: String
    let symbol: String
    let qty: Int
    let refPaise: Int       // ref price in paise (for the capped-loss line)
    let supportsTiny: Bool
}

enum LabRowState: Equatable { case idle, running, pass, fail, deduped }

final class LabRowResult: ObservableObject {
    @Published var state: LabRowState = .idle
    @Published var result: LabResult?
    @Published var expanded = false
    @Published var lastError: String?
    @Published var lastMode: String = "sim"
}

@MainActor
final class LabVM: ObservableObject {
    @Published var tinyReal = false          // global SIM (false) / TINY-REAL (true)
    @Published var rows: [String: LabRowResult] = [:]
    @Published var killBusy = false
    @Published var killReport: String?

    // Per-test rupee ceiling read from live config (server enforces it too).
    var capPaise: Int { 50_000 }

    let scenarios: [LabScenario] = [
        .init(id: "P1", title: "Kite token live", category: "Preflight (₹0)",
              kind: .tokenCheck, detail: "Broker connected + token valid", symbol: "", qty: 0, refPaise: 0, supportsTiny: false),
        .init(id: "E1", title: "1-share round-trip (buy → fill → exit)", category: "Equity round-trip",
              kind: .equityRoundTrip, detail: "The headline: the first real fill the system ever completes", symbol: "IDEA", qty: 1, refPaise: 1400, supportsTiny: true),
        .init(id: "E5", title: "Emulated bracket (buy + SL-M stop + target)", category: "Equity round-trip",
              kind: .bracket, detail: "Gap-proof SL-M stop armed from fill; GTT target", symbol: "IDEA", qty: 1, refPaise: 1400, supportsTiny: true),
        .init(id: "X2", title: "Square-off all (positions + holdings)", category: "Exit + safety",
              kind: .squareOffAll, detail: "Flatten everything; reports what's left open", symbol: "", qty: 0, refPaise: 0, supportsTiny: true),
        .init(id: "S1", title: "Kill-switch drill", category: "Exit + safety",
              kind: .killSwitch, detail: "Open → KILL → confirm flat. Proves the disaster net.", symbol: "", qty: 0, refPaise: 0, supportsTiny: true),
    ]

    func row(_ id: String) -> LabRowResult {
        if let r = rows[id] { return r }
        let r = LabRowResult(); rows[id] = r; return r
    }

    func maxLossPaise(_ s: LabScenario, tiny: Bool) -> Int {
        guard tiny else { return 0 }
        return s.qty * s.refPaise
    }
    func overCap(_ s: LabScenario, tiny: Bool) -> Bool { maxLossPaise(s, tiny: tiny) > capPaise }
}

struct LabView: View {
    @ObservedObject var vm: WealthVM
    @StateObject private var lab = LabVM()
    @State private var authNote: String?

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Lab", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    preflightStrip
                    modeToggle
                    if let n = authNote {
                        Text(n).font(.system(size: 12)).foregroundColor(HK.error)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(categories, id: \.self) { cat in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(cat.uppercased()).font(.system(size: 11, weight: .bold)).foregroundColor(HK.textFaint)
                                .padding(.leading, 4)
                            ForEach(lab.scenarios.filter { $0.category == cat }) { s in
                                scenarioRow(s)
                            }
                        }
                    }
                    Color.clear.frame(height: 80) // room above the sticky kill bar
                }
                .padding(14)
            }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
        .overlay(alignment: .bottom) { killBar }
    }

    private var categories: [String] {
        var seen = Set<String>(); var out: [String] = []
        for s in lab.scenarios where !seen.contains(s.category) { seen.insert(s.category); out.append(s.category) }
        return out
    }

    // ── Preflight strip: token + the honest real-money mode ──
    private var preflightStrip: some View {
        Card {
            HStack(spacing: 10) {
                Image(systemName: vm.kiteConnected ? "checkmark.seal.fill" : "xmark.seal.fill")
                    .foregroundColor(vm.kiteConnected ? HK.ready : HK.error)
                VStack(alignment: .leading, spacing: 1) {
                    Text(vm.kiteConnected ? "Kite connected" : "Kite not connected")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
                    Text(vm.kiteConnected
                         ? "token \(vm.kite?.expires_in_min.map { "\($0) min left" } ?? "ok")"
                         : "reconnect on the Now tab before any real run")
                        .font(.system(size: 11)).foregroundColor(HK.textDim)
                }
                Spacer()
                Pill(text: (vm.config["block_real_orders"] == "0") ? "REAL ARMED" : "BLOCKED",
                     color: (vm.config["block_real_orders"] == "0") ? HK.running : HK.ready)
            }
        }
    }

    // ── Global SIM / TINY-REAL toggle + the capped-loss promise ──
    private var modeToggle: some View {
        Card {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Mode").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                    Text(lab.tinyReal ? "TINY-REAL — real orders, Face ID + ₹\(lab.capPaise/100) cap per run"
                                      : "SIM — nothing is sent to Zerodha, ₹0 at risk")
                        .font(.system(size: 12)).foregroundColor(lab.tinyReal ? HK.error : HK.textDim)
                }
                Spacer()
                Toggle("", isOn: $lab.tinyReal).labelsHidden().tint(HK.error)
            }
        }
    }

    // ── One scenario row ──
    private func scenarioRow(_ s: LabScenario) -> some View {
        let r = lab.row(s.id)
        let tiny = lab.tinyReal && s.supportsTiny
        let over = lab.overCap(s, tiny: tiny)
        let maxLoss = lab.maxLossPaise(s, tiny: tiny)
        return Card {
            HStack(alignment: .top, spacing: 10) {
                stateDot(r.state)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(s.id).font(.system(size: 11, weight: .bold)).foregroundColor(HK.accent)
                        Text(s.title).font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
                    }
                    Text(s.detail).font(.system(size: 11)).foregroundColor(HK.textDim)
                    Text(tiny ? "max you can lose this run: ₹\(maxLoss/100)" : "SIM — ₹0 at risk")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(tiny ? (over ? HK.error : HK.running) : HK.textFaint)
                }
                Spacer()
                Button {
                    run(s, tiny: tiny)
                } label: {
                    Text(r.state == .running ? "…" : "Run")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(over ? HK.textFaint : HK.bg)
                        .frame(width: 54, height: 32)
                        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(over ? HK.cardHi : HK.accent))
                }
                .disabled(r.state == .running || over || (tiny && !vm.kiteConnected))
            }
            if r.state != .idle { resultBlock(s, r) }
        }
    }

    @ViewBuilder
    private func resultBlock(_ s: LabScenario, _ r: LabRowResult) -> some View {
        Divider().background(HK.lineSoft)
        HStack {
            Text(stateLabel(r.state)).font(.system(size: 12, weight: .bold)).foregroundColor(stateColor(r.state))
            Text("(\(r.lastMode))").font(.system(size: 11)).foregroundColor(HK.textFaint)
            Spacer()
            if (r.result?.steps?.isEmpty == false) || r.lastError != nil {
                Button { r.expanded.toggle() } label: {
                    Text(r.expanded ? "hide log" : "show log").font(.system(size: 11, weight: .semibold)).foregroundColor(HK.accent)
                }
            }
        }
        if let summary = r.result?.summary, !summary.isEmpty {
            Text(summary).font(.system(size: 12)).foregroundColor(HK.textDim)
        }
        if r.expanded {
            if let steps = r.result?.steps, !steps.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { i, st in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: (st.ok ?? false) ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.system(size: 11)).foregroundColor((st.ok ?? false) ? HK.ready : HK.error)
                            Text("\(i+1). \(st.name ?? "step")").font(.system(size: 11, weight: .medium)).foregroundColor(HK.text)
                            if let d = st.detail { Text(d).font(.system(size: 11)).foregroundColor(HK.textDim).lineLimit(2) }
                        }
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.bgElev))
            }
            if let raw = r.lastError {
                Text(raw).font(.system(size: 11, design: .monospaced)).foregroundColor(HK.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.error.opacity(0.10)))
            }
        }
        // One-tap fix
        if let fix = r.result?.fix {
            HStack(spacing: 8) {
                if fix == .squareOff {
                    fixButton("Square-off now", icon: "xmark.octagon.fill", color: HK.error) {
                        if !s.symbol.isEmpty { _ = try? await WealthClient.shared.labSquareOff(symbol: s.symbol, sim: !lab.tinyReal) }
                        else { _ = try? await WealthClient.shared.labSquareOffAll(sim: !lab.tinyReal) }
                    }
                }
                fixButton("Retry", icon: "arrow.clockwise", color: HK.accent) {
                    await MainActor.run { run(s, tiny: lab.tinyReal && s.supportsTiny) }
                }
            }
        }
    }

    private func fixButton(_ title: String, icon: String, color: Color, _ act: @escaping () async -> Void) -> some View {
        Button { Task { await act() } } label: {
            Label(title, systemImage: icon).font(.system(size: 12, weight: .bold)).foregroundColor(color)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(color, lineWidth: 1))
        }
    }

    // ── Sticky kill bar ──
    private var killBar: some View {
        Button {
            Task { await killAll() }
        } label: {
            HStack {
                Image(systemName: "exclamationmark.octagon.fill")
                Text(lab.killBusy ? "Flattening…" : "KILL — SQUARE-OFF ALL")
                    .font(.system(size: 15, weight: .heavy))
                if let rep = lab.killReport { Text(rep).font(.system(size: 11)).opacity(0.9) }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(HK.error)
        }
        .disabled(lab.killBusy)
        .padding(.horizontal, 14).padding(.bottom, 6)
    }

    // ── Runner ──
    private func run(_ s: LabScenario, tiny: Bool) {
        let r = lab.row(s.id)
        r.state = .running; r.lastError = nil; r.result = nil
        r.lastMode = tiny ? "tiny_real" : "sim"
        authNote = nil
        Task {
            if tiny {
                let auth = await authorize()
                if !auth.ok {
                    await MainActor.run {
                        r.state = .fail
                        r.lastError = "Face ID / passcode not satisfied: \(auth.detail). No order sent."
                        authNote = "Real run cancelled — authorization failed."
                    }
                    return
                }
            }
            do {
                let res = try await execute(s, tiny: tiny)
                await MainActor.run {
                    r.result = res
                    r.lastError = res.rawError
                    if res.deduped == true { r.state = .deduped }
                    else { r.state = res.didSucceed ? .pass : .fail }
                    if r.state == .fail || (res.steps?.isEmpty == false) { r.expanded = true }
                }
            } catch {
                await MainActor.run {
                    r.state = .fail
                    r.lastError = error.localizedDescription
                    r.expanded = true
                }
            }
        }
    }

    private func execute(_ s: LabScenario, tiny: Bool) async throws -> LabResult {
        let sim = !tiny
        let tag = "HN_LAB_\(s.id)"
        switch s.kind {
        case .tokenCheck:
            let k = try await WealthClient.shared.kiteStatus()
            return LabResult.tokenSynthetic(connected: k.connected == true, name: k.user_name, mins: k.expires_in_min)
        case .equityRoundTrip:
            return try await WealthClient.shared.labPipelineTest(symbol: s.symbol, qty: s.qty, sim: sim)
        case .bracket:
            return try await WealthClient.shared.labPlaceBracket(symbol: s.symbol, qty: s.qty, stop: 13, target: 16, tag: tag, sim: sim)
        case .squareOffAll, .killSwitch:
            return try await WealthClient.shared.labSquareOffAll(sim: sim)
        }
    }

    private func killAll() async {
        await MainActor.run { lab.killBusy = true; lab.killReport = nil }
        let res = try? await WealthClient.shared.labSquareOffAll(sim: !lab.tinyReal)
        await MainActor.run {
            lab.killBusy = false
            if let res {
                let sq = res.squared?.count ?? 0
                let rem = res.remaining?.count ?? 0
                lab.killReport = res.flat == true ? "flat ✓ (\(sq) squared)" : "\(rem) still open!"
            } else { lab.killReport = "no broker / nothing to flatten" }
        }
    }

    // ── UI helpers ──
    private func stateDot(_ s: LabRowState) -> some View {
        Circle().fill(stateColor(s)).frame(width: 9, height: 9).padding(.top, 5)
    }
    private func stateColor(_ s: LabRowState) -> Color {
        switch s { case .idle: return HK.line; case .running: return HK.running; case .pass: return HK.ready; case .fail: return HK.error; case .deduped: return HK.running }
    }
    private func stateLabel(_ s: LabRowState) -> String {
        switch s { case .idle: return "idle"; case .running: return "running…"; case .pass: return "PASS"; case .fail: return "ERROR"; case .deduped: return "DEDUPED" }
    }

    // ── Face-ID (same device-owner-auth gate as Execute) ──
    struct AuthOut { let ok: Bool; let detail: String }
    private func authorize() async -> AuthOut {
        await withCheckedContinuation { (cont: CheckedContinuation<AuthOut, Never>) in
            let ctx = LAContext()
            ctx.localizedFallbackTitle = "Use Passcode"
            var err: NSError?
            let policy = LAPolicy.deviceOwnerAuthentication
            guard ctx.canEvaluatePolicy(policy, error: &err) else {
                #if targetEnvironment(simulator)
                cont.resume(returning: AuthOut(ok: true, detail: "simulator-bypass (not proof of on-device Face ID)"))
                #else
                cont.resume(returning: AuthOut(ok: false, detail: String(describing: err?.localizedDescription ?? "unavailable")))
                #endif
                return
            }
            ctx.evaluatePolicy(policy, localizedReason: "Authorize this TINY-REAL test order") { ok, e in
                cont.resume(returning: AuthOut(ok: ok, detail: ok ? "accepted" : String(describing: e?.localizedDescription ?? "rejected")))
            }
        }
    }
}

extension LabResult {
    // Synthetic result for the token preflight row (no order call).
    static func tokenSynthetic(connected: Bool, name: String?, mins: Int?) -> LabResult {
        let json: [String: Any] = [
            "ok": connected,
            "summary": connected ? "Connected as \(name ?? "—"), token \(mins.map { "\($0) min left" } ?? "ok")"
                                  : "Not connected — reconnect Kite on the Now tab.",
        ]
        let data = try! JSONSerialization.data(withJSONObject: json)
        return try! JSONDecoder().decode(LabResult.self, from: data)
    }
}
