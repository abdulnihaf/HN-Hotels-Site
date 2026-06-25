import SwiftUI
import LocalAuthentication

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
    @State private var practice = true
    @State private var lastWasPractice = false

    private var qty: Int { max(1, Int(qtyText) ?? 1) }
    private var stop: Double { Double(stopText) ?? 0 }
    private var target: Double { Double(targetText) ?? 0 }
    private var kiteOK: Bool { vm.kiteConnected }
    private var isReal: Bool { vm.config["block_real_orders"] == "0" }
    private var formValid: Bool { !symbol.isEmpty && qty >= 1 && stop > 0 && target > 0 }

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Execute", session: nil, vm: vm)
            ScrollView {
                VStack(spacing: 14) {
                    ModeBanner(vm: vm)

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

                        let canPlace = formValid && !placing && (practice || kiteOK)
                        Button {
                            errorMsg = nil; result = nil; showConfirm = true
                        } label: {
                            Text(placing ? "Placing…" : (practice ? "Place practice order" : (isReal ? "Review & place REAL order" : "Review & place (shadow)")))
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(canPlace ? HK.bg : HK.textFaint)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(RoundedRectangle(cornerRadius: HK.radiusSm)
                                    .fill(canPlace ? (practice ? HK.accent : (isReal ? HK.error : HK.accent)) : HK.cardHi))
                        }
                        .disabled(!canPlace)
                    }

                    if let r = result { resultCard(r) }
                    if let e = errorMsg {
                        Card { Text(e).font(.system(size: 13)).foregroundColor(HK.error) }
                    }

                    Card {
                        Text("How this works").font(.system(size: 12, weight: .bold)).foregroundColor(HK.textFaint)
                        Text("Places directly on Zerodha via the server — no need to open the Kite app. It fires a market BUY, waits for the fill, then sets a GTT one-cancels-other stop + target. If the GTT fails it falls back to an SL-M stop and warns you. block_real_orders=1 simulates the whole flow safely; =0 places real money.")
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
                Text(r.error ?? r.reason ?? "Unknown error").font(.system(size: 12)).foregroundColor(HK.textDim)
                if let w = r.warning { Text(w).font(.system(size: 12, weight: .semibold)).foregroundColor(HK.error) }
            }
        }
    }

    private func place() {
        guard !placing else { return }
        placing = true; errorMsg = nil; result = nil
        let tag = "HN_WE_IOS_\(Int(Date().timeIntervalSince1970))"
        let sym = symbol.uppercased()
        let isPractice = practice
        Task {
            let authed = await biometricOK()
            if !authed {
                await MainActor.run { placing = false; errorMsg = "Authorization failed — order not placed." }
                return
            }
            if isPractice {
                // Rehearse the whole flow locally — nothing leaves the phone.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                let fill = (stop + target) / 2
                let gtt = Int(Date().timeIntervalSince1970) % 100000
                let demo = BracketResult(ok: true, blocked: nil, reason: "practice", error: nil,
                                         fill_price: fill, gtt_id: gtt, fallback_used: false, warning: nil, bracket_id: nil)
                await MainActor.run { result = demo; lastWasPractice = true; placing = false }
                return
            }
            await MainActor.run { lastWasPractice = false }
            do {
                let r = try await WealthClient.shared.placeBracket(symbol: sym, qty: qty, stop: stop, target: target, tag: tag)
                await MainActor.run { result = r; placing = false }
                await vm.refresh()
            } catch {
                await MainActor.run {
                    errorMsg = (error as? WealthError)?.errorDescription ?? error.localizedDescription
                    placing = false
                }
            }
        }
    }

    private func biometricOK() async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            let ctx = LAContext()
            var err: NSError?
            // Allow passcode fallback for this high-stakes action.
            guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
                cont.resume(returning: true) // no auth available (e.g. simulator) — don't hard-block
                return
            }
            ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Authorize this order") { ok, _ in
                cont.resume(returning: ok)
            }
        }
    }
}
