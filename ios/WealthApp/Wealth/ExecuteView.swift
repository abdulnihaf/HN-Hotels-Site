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

private enum OrderMode: String, CaseIterable, Identifiable {
    case paper = "Paper"
    case real = "Real"
    var id: String { rawValue }
}

struct ExecuteView: View {
    @ObservedObject var vm: WealthVM
    @Environment(\.openURL) private var openURL

    @State private var symbol = ""
    @State private var qtyText = "1"
    @State private var stopText = ""
    @State private var targetText = ""
    @State private var showConfirm = false
    @State private var placing = false
    @State private var result: BracketResult?
    @State private var errorMsg: String?
    @State private var orderMode: OrderMode = .paper
    @State private var lastWasPractice = false
    @State private var orderWitness: OrderExecutionWitness?

    private var qty: Int { max(1, Int(qtyText) ?? 1) }
    private var stop: Double { Double(stopText) ?? 0 }
    private var target: Double { Double(targetText) ?? 0 }
    private var kiteOK: Bool { vm.kiteConnected }
    private var isReal: Bool { vm.config["block_real_orders"] == "0" }
    private var paperMode: Bool { orderMode == .paper }
    private var formValid: Bool { !symbol.isEmpty && qty >= 1 && stop > 0 && target > 0 }
    private var matchesBrokerPick: Bool {
        guard let pick = vm.brokerPick else { return false }
        let symbolOK = symbol.uppercased() == pick.symbol.uppercased()
        let qtyOK = pick.qty == nil || qty == pick.qty
        let stopOK = pick.stopRupees == nil || abs(stop - (pick.stopRupees ?? stop)) <= 0.05
        let targetOK = pick.targetRupees == nil || abs(target - (pick.targetRupees ?? target)) <= 0.05
        return symbolOK && qtyOK && stopOK && targetOK
    }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Execute", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    ModeBanner(vm: vm)
                    executionGateCard

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
                            Pill(text: vm.orderReady ? "BROKER PICK" : "INTELLIGENCE ONLY", color: vm.orderReady ? HK.ready : HK.idle)
                        }
                        Picker("Mode", selection: $orderMode) {
                            Text("Paper dry-run").tag(OrderMode.paper)
                            Text("Real").tag(OrderMode.real)
                        }
                        .pickerStyle(.segmented)
                        Text(paperMode
                             ? "Paper dry-run validates the latest TRADE verdict on the server and sends nothing to Zerodha."
                             : "Real mode can call Kite only through the whitelisted stable-IP proxy, after Face ID and server guards.")
                            .font(.system(size: 11)).foregroundColor(paperMode ? HK.ready : HK.running)
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
                        if !matchesBrokerPick {
                            Text("Order must match the current broker-facing pick exactly. Manual edits are shown, but the server will refuse them.")
                                .font(.system(size: 11, weight: .semibold)).foregroundColor(HK.running)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        let canPlace = formValid && !placing && vm.orderReady && matchesBrokerPick && (paperMode || kiteOK)
                        Button {
                            errorMsg = nil; result = nil; orderWitness = nil; showConfirm = true
                        } label: {
                            Text(placing ? "Placing…" : (paperMode ? "Stage PAPER dry-run" : (isReal ? "Review & place REAL order" : "Review & place (server shadow)")))
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(canPlace ? HK.bg : HK.textFaint)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(canPlace ? (paperMode ? HK.ready : (isReal ? HK.error : HK.accent)) : HK.cardHi))
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
                        Text("The app never talks to Kite directly. It sends the current broker-facing pick to /api/kite; the server re-checks the latest TRADE verdict, pick JSON, authority flag, source health, market hours, and stable-IP proxy before any real broker call.")
                            .font(.system(size: 12)).foregroundColor(HK.textDim)
                    }
                }
                .padding(14)
            }
            .refreshable { await vm.refresh() }
            .background(HK.bg)
        }
        .background(HK.bg.ignoresSafeArea())
        .onAppear {
            if let d = vm.prefill {
                symbol = d.symbol
                if !d.stop.isEmpty { stopText = d.stop }
                if !d.target.isEmpty { targetText = d.target }
                if !d.qty.isEmpty { qtyText = d.qty }
                orderMode = .real           // came from a broker pick → default to live shadow/real path
                vm.prefill = nil
            } else if let pick = vm.brokerPick {
                apply(pick)
            }
        }
        .onChange(of: vm.brokerPick?.symbol ?? "") { _, _ in
            if let pick = vm.brokerPick, symbol.isEmpty || !matchesBrokerPick { apply(pick) }
        }
        .alert(paperMode ? "Stage a paper dry-run?" : (isReal ? "Place a REAL order?" : "Place a server-shadow order?"), isPresented: $showConfirm) {
            Button(paperMode ? "Stage paper" : (isReal ? "Place REAL order" : "Place shadow"), role: .destructive) { place() }
            Button("Cancel", role: .cancel) {}
        } message: {
            let lead = paperMode ? "PAPER — server validates, no Zerodha call. " : (isReal ? "REAL MONEY. " : "Shadow — no real order. ")
            Text("\(lead)MIS market BUY \(qty) × \(symbol.uppercased()), stop \(Money.rupeesFromRupee(stop)), target \(Money.rupeesFromRupee(target)). Face ID / passcode required.")
        }
    }

    private func apply(_ pick: VerdictPick) {
        symbol = pick.symbol
        if let stop = pick.stopRupees { stopText = String(format: "%.2f", stop) }
        if let target = pick.targetRupees { targetText = String(format: "%.2f", target) }
        if let qty = pick.qty { qtyText = String(qty) }
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
    private var executionGateCard: some View {
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Execution gate").font(.system(size: 13, weight: .bold)).foregroundColor(HK.textFaint)
                    Text(vm.orderReady ? "TRADE — order-ready" : "OBSERVE — intelligence only")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .foregroundColor(vm.orderReady ? HK.ready : HK.running)
                }
                Spacer()
                Pill(text: vm.executionGate?.stable_ip_proxy_configured == true ? "STABLE-IP OK" : "NO STABLE-IP",
                     color: vm.executionGate?.stable_ip_proxy_configured == true ? HK.ready : HK.error)
            }
            Row(label: "Decision", value: (vm.executionGate?.decision ?? vm.verdict?.decision ?? "—").uppercased(),
                valueColor: vm.orderReady ? HK.ready : HK.textDim)
            Row(label: "Authority", value: vm.executionGate?.execution_authority ?? vm.verdict?.executionAuthority ?? "missing",
                valueColor: (vm.executionGate?.execution_authority ?? vm.verdict?.executionAuthority) == "broker_facing_picks_authorized" ? HK.ready : HK.error)
            Row(label: "Broker picks", value: "\(vm.executionGate?.picks_count ?? vm.verdict?.picks.count ?? 0)")
            if let h = vm.executionGate?.headline ?? vm.verdict?.headline {
                Text(h).font(.system(size: 12)).foregroundColor(HK.textDim).fixedSize(horizontal: false, vertical: true)
            }
            if !vm.orderBlockers.isEmpty {
                Divider().background(HK.line)
                ForEach(vm.orderBlockers.prefix(4), id: \.self) { b in
                    HStack(alignment: .top, spacing: 6) {
                        Text("·").font(.system(size: 13, weight: .bold)).foregroundColor(HK.running)
                        Text(b).font(.system(size: 12)).foregroundColor(HK.running).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !vm.unhealthyRequiredSources.isEmpty {
                Divider().background(HK.line)
                Text("Required market inputs").font(.system(size: 11, weight: .heavy)).foregroundColor(HK.textFaint)
                ForEach(vm.unhealthyRequiredSources.prefix(3)) { s in
                    Row(label: s.label, value: (s.status ?? "bad").uppercased(), valueColor: HK.running)
                }
            }
        }
    }

    @ViewBuilder
    private func resultCard(_ r: BracketResult) -> some View {
        Card {
            if lastWasPractice || r.dry_run == true {
                Pill(text: "PAPER DRY-RUN — NOT SENT TO ZERODHA", color: HK.ready)
            }
            if r.blocked == true {
                Text("SHADOW — simulated").font(.system(size: 15, weight: .bold)).foregroundColor(HK.ready)
                Text("No real order placed (block_real_orders=1). The full flow was validated safely.")
                    .font(.system(size: 12)).foregroundColor(HK.textDim)
            } else if r.dry_run == true {
                Text("Paper order staged").font(.system(size: 15, weight: .bold)).foregroundColor(HK.ready)
                Text(r.message ?? "The server validated the verdict and staged the order without contacting Kite.")
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
        guard vm.orderReady, matchesBrokerPick else {
            errorMsg = "Order blocked — this screen only sends the current broker-facing pick."
            return
        }
        placing = true; errorMsg = nil; result = nil
        let tag = "HN_WE_IOS_\(Int(Date().timeIntervalSince1970))"
        let sym = symbol.uppercased()
        let isPaper = paperMode
        let mode = isPaper ? "PAPER" : (isReal ? "REAL" : "SHADOW")
        orderWitness = OrderExecutionWitness(tag: tag, mode: mode, auth: nil,
                                             server: "Waiting for iOS auth", broker: "Not reached",
                                             timestamp: Date())
        Task {
            let auth = await authorizeOrder(isPractice: isPaper)
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
            do {
                let r = try await WealthClient.shared.placeBracket(
                    symbol: sym, qty: qty, stop: stop, target: target, tag: tag,
                    verdictId: vm.executionGate?.verdict_id ?? vm.verdict?.id,
                    dryRun: isPaper
                )
                await MainActor.run {
                    updateWitness { w in
                        w.server = serverWitness(r)
                        w.broker = brokerWitness(r)
                    }
                    result = r
                    lastWasPractice = isPaper
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
        if r.dry_run == true { return "API returned paper dry-run staged" }
        if r.blocked == true { return "API returned blocked/simulated" }
        if r.ok == true { return "API returned ok" }
        return "API returned failure"
    }

    private func brokerWitness(_ r: BracketResult) -> String {
        if r.dry_run == true {
            return "No Kite call. Server validated the broker-facing pick and staged a paper order."
        }
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
        case .opticID: return "Optic ID"
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
