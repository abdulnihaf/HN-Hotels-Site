import SwiftUI
import LocalAuthentication

private struct OrderAuthWitness: Equatable {
    let ok: Bool
    let policy: String
    let biometry: String
    let detail: String
    let errorCode: String?
}

private struct OrderExecutionWitness: Equatable {
    let tag: String
    let mode: String
    var auth: OrderAuthWitness?
    var server: String
    var broker: String
    let timestamp: Date
}

@MainActor
private final class QuantExecuteVM: ObservableObject {
    @Published var status: QuantControlStatus?
    @Published var tick: QuantTickResult?
    @Published var command: QuantCommandResult?
    @Published var busy = false
    @Published var error: String?

    func refresh() async {
        busy = true
        error = nil
        do {
            status = try await WealthClient.shared.quantControlStatus()
        } catch {
            status = nil
            self.error = (error as? WealthError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }

    func runTick(mode: String, allowReal: Bool) async {
        busy = true
        error = nil
        do {
            tick = try await WealthClient.shared.quantControlTick(mode: mode, allowReal: allowReal)
            status = try? await WealthClient.shared.quantControlStatus()
        } catch {
            tick = nil
            self.error = (error as? WealthError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }

    func setOverride(symbol: String, entry: Double, stop: Double, target: Double, qty: Int) async {
        busy = true
        error = nil
        do {
            command = try await WealthClient.shared.quantControlSetOverride(
                symbol: symbol,
                entry: entry,
                stop: stop,
                target: target,
                qty: qty,
                reason: "ios_execute_tab_override"
            )
            status = try? await WealthClient.shared.quantControlStatus()
        } catch {
            command = nil
            self.error = (error as? WealthError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }

    func clearOverride() async {
        busy = true
        error = nil
        do {
            command = try await WealthClient.shared.quantControlClearOverride()
            status = try? await WealthClient.shared.quantControlStatus()
        } catch {
            command = nil
            self.error = (error as? WealthError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }
}

struct ExecuteView: View {
    @ObservedObject var vm: WealthVM
    @Environment(\.openURL) private var openURL
    @StateObject private var quant = QuantExecuteVM()

    @State private var symbol = ""
    @State private var qtyText = "1"
    @State private var entryText = ""
    @State private var stopText = ""
    @State private var targetText = ""
    @State private var showConfirm = false
    @State private var showRealTimerConfirm = false
    @State private var placing = false
    @State private var result: BracketResult?
    @State private var errorMsg: String?
    @State private var practice = true
    @State private var lastWasPractice = false
    @State private var orderWitness: OrderExecutionWitness?
    @State private var timerAuthNote: String?

    private var qty: Int { max(1, Int(qtyText) ?? 1) }
    private var entry: Double { Double(entryText) ?? 0 }
    private var stop: Double { Double(stopText) ?? 0 }
    private var target: Double { Double(targetText) ?? 0 }
    private var kiteOK: Bool { vm.kiteConnected }
    private var isReal: Bool { vm.config["block_real_orders"] == "0" }
    private var tradeAuthorized: Bool { vm.tradeAuthorized }
    private var formValid: Bool { !symbol.isEmpty && qty >= 1 && stop > 0 && target > 0 }
    private var timerOverrideValid: Bool { !symbol.isEmpty && entry > 0 && stop > 0 && target > 0 && qty >= 1 }
    private var quantRealReady: Bool {
        quant.status?.next_tick?.real_enabled == true && quant.status?.gate?.trade_authorized == true
    }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Execute", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    ModeBanner(vm: vm)
                    executionGateCard
                    quantExecutionCard

                    if !kiteOK {
                        Card {
                            Text("Kite not connected").font(.system(size: 14, weight: .bold)).foregroundColor(HK.running)
                            Text("Connect Kite to place orders. Until then no order can fire (the server rejects with kite_expired).")
                                .font(.system(size: 12)).foregroundColor(HK.textDim)
                            KiteConnectButton(vm: vm)
                        }
                    }

                    Card {
                        HStack {
                            Text("New order").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                            Spacer()
                            Pill(text: "MIS · MARKET BUY", color: HK.accent)
                        }
                        Toggle(isOn: $practice) {
                            Text("Practice (rehearse — nothing sent)").font(.system(size: 13)).foregroundColor(HK.textDim)
                        }.tint(HK.accent)
                        labeledField("Symbol (NSE)", text: $symbol, placeholder: "e.g. HFCL", caps: true)
                        HStack {
                            Text("Quantity").font(.system(size: 14)).foregroundColor(HK.textDim)
                            Spacer()
                            TextField("1", text: $qtyText)
                                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                .font(.system(size: 16, weight: .semibold)).foregroundColor(HK.text).frame(width: 90)
                        }
                        labeledField("Stop ₹", text: $stopText, placeholder: "below entry", decimal: true)
                        labeledField("Target ₹", text: $targetText, placeholder: "above entry", decimal: true)

                        if stop > 0 && target > 0 {
                            Text("Stop \(Money.rupeesFromRupee(stop)) · Target \(Money.rupeesFromRupee(target)) · \(qty) sh · auto-squares 15:15 (MIS)")
                                .font(.system(size: 11)).foregroundColor(HK.textFaint)
                        }

                        let canPlace = formValid && !placing && (practice || (kiteOK && tradeAuthorized))
                        Button {
                            errorMsg = nil; result = nil; orderWitness = nil; showConfirm = true
                        } label: {
                            Text(placing ? "Placing…" : (practice ? "Place practice order" : (tradeAuthorized ? (isReal ? "Review & place REAL order" : "Review & place broker order") : "Broker order locked")))
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(canPlace ? HK.bg : HK.textFaint)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(RoundedRectangle(cornerRadius: HK.radiusSm)
                                    .fill(canPlace ? (practice ? HK.accent : (isReal ? HK.error : HK.accent)) : HK.cardHi))
                        }
                        .disabled(!canPlace)
                    }

                    if let r = result { resultCard(r) }
                    if let w = orderWitness { witnessCard(w) }
                    if let e = errorMsg {
                        Card { Text(e).font(.system(size: 13)).foregroundColor(HK.error) }
                    }

                    Card {
                        Text("How this works").font(.system(size: 12, weight: .bold)).foregroundColor(HK.textFaint)
                        Text("Real orders go only through the server execution gate and the stable-IP Kite proxy. OBSERVE days are intelligence only; practice orders stay local and do not touch Zerodha.")
                            .font(.system(size: 12)).foregroundColor(HK.textDim)
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
        .task { await quant.refresh() }
        .onAppear {
            if let d = vm.prefill {
                symbol = d.symbol
                if !d.stop.isEmpty { stopText = d.stop }
                if !d.target.isEmpty { targetText = d.target }
                if !d.qty.isEmpty { qtyText = d.qty }
                practice = false           // came from a real pick → default to live shadow/real path
                vm.prefill = nil
            }
        }
        .alert(practice ? "Place a practice order?" : (isReal ? "Place a REAL order?" : "Place a simulated order?"), isPresented: $showConfirm) {
            Button(practice ? "Place practice order" : (isReal ? "Place REAL order" : "Place (shadow)"), role: .destructive) { place() }
            Button("Cancel", role: .cancel) {}
        } message: {
            let lead = practice ? "PRACTICE — nothing is sent to Zerodha. " : (isReal ? "⚠️ REAL MONEY. " : "Shadow — no real order. ")
            Text("\(lead)MIS market BUY \(qty) × \(symbol.uppercased()), stop \(Money.rupeesFromRupee(stop)), target \(Money.rupeesFromRupee(target)). Face ID / passcode required.")
        }
        .alert("Run real Quant timer tick?", isPresented: $showRealTimerConfirm) {
            Button("Run real tick", role: .destructive) { runRealTimerTick() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This asks the server to run the timer in real mode. The backend will still block unless the real switches, broker gate, symbol authority, and Face ID all pass.")
        }
    }

    private var executionGateCard: some View {
        Card {
            HStack {
                Text("Broker gate").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                Pill(text: tradeAuthorized ? "AUTHORIZED" : "INTELLIGENCE ONLY",
                     color: tradeAuthorized ? HK.error : HK.ready)
            }
            Text(vm.executionGate?.owner_truth ?? "Waiting for server gate.")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(tradeAuthorized ? HK.error : HK.textDim)
                .fixedSize(horizontal: false, vertical: true)
            if let reasons = vm.executionGate?.blocked_reasons, !reasons.isEmpty {
                Text(reasons.prefix(3).joined(separator: " · "))
                    .font(.system(size: 11)).foregroundColor(HK.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var quantExecutionCard: some View {
        Card {
            HStack {
                Text("Quant execution").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                Pill(text: quantExecutionPill.0, color: quantExecutionPill.1)
            }
            Text("Execute owns the timer controls. Paper tick writes the trail; real tick stays locked until the server gate and real switches are green.")
                .font(.system(size: 12))
                .foregroundColor(HK.textDim)
                .fixedSize(horizontal: false, vertical: true)

            if let q = quant.status {
                Row(label: "Phase", value: "\(q.trade_date ?? "—") · \(q.phase ?? "—")")
                Row(label: "Gate", value: q.gate?.trade_authorized == true ? "TRADE AUTHORIZED" : (q.gate?.decision ?? "BLOCKED"),
                    valueColor: q.gate?.trade_authorized == true ? HK.error : HK.ready)
                Row(label: "Timer mode", value: "\(q.next_tick?.default_mode ?? "paper") · real \(q.next_tick?.real_enabled == true ? "on" : "off")")
                Row(label: "Timer pick", value: q.scout?.primary_symbol ?? q.gate?.recommended_symbol ?? "—")
                if let event = q.timer?.events?.first {
                    Row(label: "Latest tick", value: "\(event.symbol ?? "—") · \(event.decision ?? "—") → \(event.state_after ?? "—")")
                }
                if q.override?.active == true {
                    Row(label: "Override", value: "\(q.override?.symbol ?? "—") · active", valueColor: HK.running)
                }
            } else {
                Text(quant.error ?? "Load the Quant execution state.")
                    .font(.system(size: 12))
                    .foregroundColor(quant.error == nil ? HK.textDim : HK.error)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let tick = quant.tick {
                Text("Last tick: \(tick.decision ?? "—") → \(tick.state_after ?? "—")")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(tick.ok == true ? HK.ready : HK.error)
            }
            if let command = quant.command {
                Text(command.ok == true ? "Override command accepted." : (command.error ?? "Override command failed."))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(command.ok == true ? HK.ready : HK.error)
            }
            if let note = timerAuthNote {
                Text(note)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(note.contains("failed") ? HK.error : HK.textFaint)
            }

            HStack(spacing: 8) {
                Button {
                    Task { await quant.refresh() }
                } label: {
                    Label(quant.busy ? "Loading…" : "Refresh", systemImage: "arrow.clockwise")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.busy)

                Button {
                    Task { await quant.runTick(mode: "paper", allowReal: false) }
                } label: {
                    Label("Paper tick", systemImage: "play.circle.fill")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.busy || quant.status?.timer?.available != true)
            }

            HStack(spacing: 8) {
                Button {
                    applyQuantPlan()
                } label: {
                    Label("Use timer plan", systemImage: "arrow.down.doc.fill")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.status == nil)

                Button {
                    showRealTimerConfirm = true
                } label: {
                    Label(quantRealReady ? "Real tick" : "Real locked", systemImage: "lock.shield.fill")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.busy || !quantRealReady)
            }

            Divider().background(HK.lineSoft)

            Text("Timer override from this form").font(.system(size: 12, weight: .bold)).foregroundColor(HK.textFaint)
            labeledField("Timer entry ₹", text: $entryText, placeholder: "entry trigger", decimal: true)
            HStack(spacing: 8) {
                Button {
                    saveTimerOverride()
                } label: {
                    Label("Save override", systemImage: "slider.horizontal.3")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.busy || !timerOverrideValid)

                Button {
                    Task { await quant.clearOverride() }
                } label: {
                    Label("Clear", systemImage: "xmark.circle")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(quant.busy)
            }
        }
    }

    private var quantExecutionPill: (String, Color) {
        if quant.busy { return ("LOADING", HK.running) }
        if quant.status == nil {
            return quant.error == nil ? ("NOT LOADED", HK.idle) : ("API ERROR", HK.running)
        }
        if quantRealReady { return ("REAL READY", HK.error) }
        if quant.status?.timer?.available == true { return ("PAPER READY", HK.ready) }
        return ("TIMER PENDING", HK.running)
    }

    private func applyQuantPlan() {
        guard let q = quant.status else { return }
        let event = q.timer?.events?.first
        if let sym = q.scout?.primary_symbol ?? event?.symbol ?? q.gate?.recommended_symbol {
            symbol = sym.uppercased()
        }
        if let n = q.scout?.qty ?? event?.qty {
            qtyText = "\(max(1, n))"
        }
        if let p = q.scout?.entry_paise ?? event?.entry_paise {
            entryText = paiseText(p)
        }
        if let p = q.scout?.stop_paise ?? event?.stop_paise {
            stopText = paiseText(p)
        }
        if let p = q.scout?.target_paise ?? event?.target_paise {
            targetText = paiseText(p)
        }
        practice = false
    }

    private func saveTimerOverride() {
        guard timerOverrideValid else {
            errorMsg = "Timer override needs symbol, entry, stop, target, and quantity."
            return
        }
        let sym = symbol.uppercased()
        Task {
            await quant.setOverride(symbol: sym, entry: entry, stop: stop, target: target, qty: qty)
        }
    }

    private func runRealTimerTick() {
        guard quantRealReady else {
            timerAuthNote = "Real timer is locked by the server gate."
            return
        }
        Task {
            let auth = await authorizeOrder(isPractice: false)
            if !auth.ok {
                await MainActor.run {
                    timerAuthNote = "Face ID failed: \(auth.detail)"
                }
                return
            }
            await MainActor.run {
                timerAuthNote = "Face ID accepted. Asking server to run real timer tick."
            }
            await quant.runTick(mode: "real", allowReal: true)
            await vm.refresh()
        }
    }

    private func paiseText(_ paise: Int) -> String {
        let rupees = Double(paise) / 100.0
        return String(format: "%.2f", rupees)
    }

    @ViewBuilder
    private func labeledField(_ label: String, text: Binding<String>, placeholder: String, caps: Bool = false, decimal: Bool = false) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundColor(HK.textDim)
            Spacer()
            TextField(placeholder, text: text)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 16, weight: .semibold)).foregroundColor(HK.text)
                .frame(width: 150)
                .keyboardType(decimal ? .decimalPad : .default)
                .textInputAutocapitalization(caps ? .characters : .never)
                .autocorrectionDisabled(true)
        }
    }

    @ViewBuilder
    private func resultCard(_ r: BracketResult) -> some View {
        Card {
            if lastWasPractice {
                Pill(text: "PRACTICE — NOT SENT TO ZERODHA", color: HK.accent)
            }
            if r.blocked == true {
                Text("SHADOW — simulated").font(.system(size: 15, weight: .bold)).foregroundColor(HK.ready)
                Text("No real order placed (block_real_orders=1). The full flow was validated safely.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            } else if r.ok == true {
                Text("Order placed ✓").font(.system(size: 15, weight: .bold)).foregroundColor(HK.ready)
                if let f = r.fill_price { Row(label: "Fill price", value: Money.rupeesFromRupee(f)) }
                if let g = r.gtt_id { Row(label: "GTT (stop+target)", value: "#\(g)") }
                if r.fallback_used == true, let w = r.warning {
                    Text(w).font(.system(size: 12)).foregroundColor(HK.running)
                }
            } else {
                Text("Order failed").font(.system(size: 15, weight: .bold)).foregroundColor(HK.error)
                Text(orderFailureText(r)).font(.system(size: 12)).foregroundColor(HK.textDim)
                if let w = r.warning { Text(w).font(.system(size: 12, weight: .semibold)).foregroundColor(HK.error) }
            }
        }
    }

    private func orderFailureText(_ r: BracketResult) -> String {
        if let message = r.message, !message.isEmpty { return message }
        if r.error == "market_closed_preflight" {
            return "NSE regular market is closed. Orders can be placed only Mon-Fri, 09:15-15:30 IST."
        }
        return r.error ?? r.reason ?? "Unknown error"
    }

    @ViewBuilder
    private func witnessCard(_ w: OrderExecutionWitness) -> some View {
        Card {
            HStack {
                Text("Order witness").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                Spacer()
                Pill(text: w.mode, color: w.mode == "REAL" ? HK.error : HK.accent)
            }
            Row(label: "Attempt", value: w.tag)
            Row(label: "Time", value: w.timestamp.formatted(date: .omitted, time: .standard))
            if let auth = w.auth {
                Row(label: "iOS auth", value: auth.ok ? "OK" : "FAILED", valueColor: auth.ok ? HK.ready : HK.error)
                Row(label: "Policy", value: auth.policy)
                Row(label: "Biometry", value: auth.biometry)
                Text(auth.detail).font(.system(size: 12)).foregroundColor(auth.ok ? HK.textDim : HK.error)
                if let code = auth.errorCode {
                    Text(code).font(.system(size: 11, weight: .semibold)).foregroundColor(HK.textFaint)
                }
            } else {
                Row(label: "iOS auth", value: "Requested", valueColor: HK.running)
            }
            Row(label: "Server", value: w.server)
            Text(w.broker).font(.system(size: 12)).foregroundColor(HK.textDim)
        }
    }

    private func place() {
        guard !placing else { return }
        if !practice && !tradeAuthorized {
            errorMsg = vm.executionGate?.owner_truth ?? "Broker order locked by execution gate."
            return
        }
        placing = true; errorMsg = nil; result = nil
        let tag = "HN_WE_IOS_\(Int(Date().timeIntervalSince1970))"
        let sym = symbol.uppercased()
        let isPractice = practice
        let mode = isPractice ? "PRACTICE" : (isReal ? "REAL" : "SHADOW")
        orderWitness = OrderExecutionWitness(tag: tag, mode: mode, auth: nil,
                                             server: "Waiting for iOS auth", broker: "Not reached",
                                             timestamp: Date())
        Task {
            let auth = await authorizeOrder(isPractice: isPractice)
            await MainActor.run {
                updateWitness { w in
                    w.auth = auth
                    w.server = auth.ok ? "Authorized; broker request not sent yet" : "Stopped before server"
                    w.broker = auth.ok ? "Waiting for server result" : "No Zerodha request sent"
                }
            }
            if !auth.ok {
                await MainActor.run {
                    placing = false
                    errorMsg = "Authorization failed — order not placed. \(auth.detail)"
                }
                return
            }
            if isPractice {
                // Rehearse the whole flow locally — nothing leaves the phone.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                let fill = (stop + target) / 2
                let gtt = Int(Date().timeIntervalSince1970) % 100000
                let demo = BracketResult(ok: true, blocked: nil, reason: "practice", error: nil, message: nil,
                                         fill_price: fill, gtt_id: gtt, fallback_used: false, warning: nil, bracket_id: nil)
                await MainActor.run {
                    updateWitness { w in
                        w.server = "Practice only - not sent to trade.hnhotels.in"
                        w.broker = "No Zerodha order. Local rehearsal fill \(Money.rupeesFromRupee(fill)); demo GTT #\(gtt)."
                    }
                    result = demo
                    lastWasPractice = true
                    placing = false
                }
                return
            }
            await MainActor.run { lastWasPractice = false }
            do {
                let r = try await WealthClient.shared.placeBracket(symbol: sym, qty: qty, stop: stop, target: target, tag: tag)
                await MainActor.run {
                    updateWitness { w in
                        w.server = serverWitness(r)
                        w.broker = brokerWitness(r)
                    }
                    result = r
                    placing = false
                }
                await vm.refresh()
            } catch {
                await MainActor.run {
                    let text = (error as? WealthError)?.errorDescription ?? error.localizedDescription
                    updateWitness { w in
                        w.server = "API threw: \(text)"
                        w.broker = "No confirmed broker order"
                    }
                    errorMsg = text
                    placing = false
                }
            }
        }
    }

    private func updateWitness(_ mutate: (inout OrderExecutionWitness) -> Void) {
        guard var witness = orderWitness else { return }
        mutate(&witness)
        orderWitness = witness
    }

    private func serverWitness(_ r: BracketResult) -> String {
        if r.blocked == true { return "API returned blocked/simulated" }
        if r.ok == true { return "API returned ok" }
        return "API returned failure"
    }

    private func brokerWitness(_ r: BracketResult) -> String {
        if r.blocked == true {
            return "Server simulation only. No real broker order placed."
        }
        if r.ok == true {
            var parts = ["Broker order accepted"]
            if let f = r.fill_price { parts.append("fill \(Money.rupeesFromRupee(f))") }
            if let g = r.gtt_id { parts.append("GTT #\(g)") }
            if r.fallback_used == true { parts.append("fallback stop used") }
            return parts.joined(separator: " · ")
        }
        return orderFailureText(r)
    }

    private func authorizeOrder(isPractice: Bool) async -> OrderAuthWitness {
        await withCheckedContinuation { (cont: CheckedContinuation<OrderAuthWitness, Never>) in
            let ctx = LAContext()
            ctx.localizedFallbackTitle = "Use Passcode"
            var err: NSError?
            let policy = LAPolicy.deviceOwnerAuthentication
            // Allow passcode fallback for this high-stakes action.
            guard ctx.canEvaluatePolicy(policy, error: &err) else {
                let reason = Self.authErrorLabel(err)
                #if targetEnvironment(simulator)
                if isPractice {
                    cont.resume(returning: OrderAuthWitness(
                        ok: true,
                        policy: "simulator-practice-bypass",
                        biometry: Self.biometryName(ctx.biometryType),
                        detail: "Simulator practice bypass only. This is not proof that Face ID works on iPhone.",
                        errorCode: reason
                    ))
                    return
                }
                #endif
                cont.resume(returning: OrderAuthWitness(
                    ok: false,
                    policy: "deviceOwnerAuthentication",
                    biometry: Self.biometryName(ctx.biometryType),
                    detail: "iOS could not evaluate device-owner authentication: \(reason).",
                    errorCode: reason
                ))
                return
            }
            let biometry = Self.biometryName(ctx.biometryType)
            ctx.evaluatePolicy(policy, localizedReason: "Authorize this order") { ok, error in
                let detail = ok
                    ? "iOS accepted device-owner authentication for this order attempt."
                    : "iOS rejected authorization: \(Self.authErrorLabel(error))."
                cont.resume(returning: OrderAuthWitness(
                    ok: ok,
                    policy: "deviceOwnerAuthentication",
                    biometry: biometry,
                    detail: detail,
                    errorCode: ok ? nil : Self.authErrorLabel(error)
                ))
            }
        }
    }

    private static func biometryName(_ type: LABiometryType) -> String {
        switch type {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .none: return "None"
        @unknown default: return "Unknown"
        }
    }

    private static func authErrorLabel(_ error: Error?) -> String {
        guard let ns = error as NSError? else { return "no-error" }
        if ns.domain == LAError.errorDomain, let code = LAError.Code(rawValue: ns.code) {
            switch code {
            case .authenticationFailed: return "authenticationFailed (\(ns.code))"
            case .userCancel: return "userCancel (\(ns.code))"
            case .userFallback: return "userFallback (\(ns.code))"
            case .systemCancel: return "systemCancel (\(ns.code))"
            case .passcodeNotSet: return "passcodeNotSet (\(ns.code))"
            case .biometryNotAvailable: return "biometryNotAvailable (\(ns.code))"
            case .biometryNotEnrolled: return "biometryNotEnrolled (\(ns.code))"
            case .biometryLockout: return "biometryLockout (\(ns.code))"
            case .appCancel: return "appCancel (\(ns.code))"
            case .invalidContext: return "invalidContext (\(ns.code))"
            case .notInteractive: return "notInteractive (\(ns.code))"
            default: return "\(code) (\(ns.code))"
            }
        }
        return "\(ns.domain) \(ns.code)"
    }
}
