import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Takht — the seat where revenue lands.
// Login is an IDENTITY (Darbar staff_pin → person → brand → role), and the
// surface a person sees is decided by that role, in that brand's colours.
// READ + WITNESS today; the one-tap correction WRITE is built but gated.
// ─────────────────────────────────────────────────────────────────────────────

struct ContentView: View {
    @ObservedObject var model: TakhtAppModel

    var body: some View {
        ZStack {
            TakhtTheme.bg.ignoresSafeArea()
            if model.identity == nil {
                if model.resuming { splash } else { GateView(model: model) }
            } else if model.needsBrandPick {
                BrandPickerView(model: model)
            } else {
                HomeView(model: model)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: model.identity?.id)
        .animation(.easeInOut(duration: 0.22), value: model.workingBrand)
    }

    private var splash: some View {
        VStack(spacing: 14) {
            Text("त")
                .font(.system(size: 44, weight: .heavy, design: .serif))
                .foregroundStyle(TakhtTheme.accent)
            ProgressView().tint(TakhtTheme.accent)
        }
    }
}

// ═════════════════════════════ HOME (role-routed) ═══════════════════════════
struct HomeView: View {
    @ObservedObject var model: TakhtAppModel
    private var me: TakhtIdentity { model.identity! }
    private var accent: Color { model.accent }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    switch me.scope.role {
                    case .cashier, .manager: settlementBody(canFix: me.scope.canFix, canSettle: me.scope.canSettle)
                    case .counter:           settlementBody(canFix: false, canSettle: false)
                    case .runner:            RunnerHome(accent: accent)
                    case .captain:           CaptainHome(accent: accent)
                    case .none:              noSurface
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
        }
    }

    // ── Header: who, role, brand, lock ──
    private var header: some View {
        let brand = model.workingBrand ?? me.brand
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(TakhtTheme.card)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(accent.opacity(0.5), lineWidth: 1))
                Text(me.initial)
                    .font(.system(size: 20, weight: .heavy, design: .serif))
                    .foregroundStyle(accent)
            }
            .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(me.name)
                    .font(.system(size: 22, weight: .heavy, design: .serif))
                    .foregroundStyle(TakhtTheme.text)
                HStack(spacing: 6) {
                    Text(me.role.isEmpty ? "staff" : me.role)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(TakhtTheme.textDim)
                    Text(brand.shortName)
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(accent)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(accent.opacity(0.16), in: Capsule())
                }
            }
            Spacer()
            if model.isRefreshing { ProgressView().tint(accent).scaleEffect(0.8) }
            Button { model.lock() } label: {
                Image(systemName: "lock.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(TakhtTheme.text)
                    .frame(width: 38, height: 38)
                    .background(TakhtTheme.card, in: Circle())
                    .overlay(Circle().stroke(TakhtTheme.line, lineWidth: 1))
            }
        }
        .padding(16)
        .background(TakhtTheme.bgElev)
    }

    // ── Cashier / Manager / Counter: the witness board ──
    @ViewBuilder
    private func settlementBody(canFix: Bool, canSettle: Bool) -> some View {
        flagsCard
        handHero
        upiCard
        chaiCard
        sessionCard
        if canFix { fixCard }
        if canSettle { settleCard }
    }

    private var noSurface: some View {
        cardContainer(title: "No Takht surface", icon: "person.fill.questionmark", badge: nil) {
            Text("This role has no counter view yet. Back-of-house joins through Anbar.")
                .font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
        }
    }

    // ── FLAGS — "what was missed, read to staff" ──
    private var flagsCard: some View {
        cardContainer(title: "What was missed", icon: "exclamationmark.bubble.fill", badge: "READ TO STAFF") {
            VStack(spacing: 8) { ForEach(model.flags) { f in flagRow(f) } }
        }
    }
    private func flagRow(_ f: TakhtFlag) -> some View {
        let c: Color = f.level == .red ? TakhtTheme.red : (f.level == .amber ? TakhtTheme.amber : TakhtTheme.green)
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(c).frame(width: 9, height: 9).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.title.capForDisplay())
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(TakhtTheme.text)
                Text(f.cause.capForDisplay(120))
                    .font(.system(size: 12.5)).foregroundStyle(TakhtTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(c.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.opacity(0.3), lineWidth: 0.5))
    }

    // ── The rupee that reaches your hand ──
    private var handHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                chainNode("Runners", TakhtFmt.rupee(model.balance?.runnerCash), TakhtTheme.textDim)
                arrow
                chainNode("Cashier", TakhtFmt.rupee(model.balance?.counterCash), TakhtTheme.textDim)
                arrow
                chainNode("Hand", TakhtFmt.rupee(model.handTotal), accent)
            }
            .padding(.bottom, 4)
            if model.balance != nil {
                Text(TakhtFmt.rupee(model.handTotal))
                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                    .foregroundStyle(TakhtTheme.text)
                Text("cash that should reach the hand")
                    .font(.system(size: 12)).foregroundStyle(TakhtTheme.textDim)
            } else {
                Text("Counter balance unreadable")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TakhtTheme.textFaint).padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(colors: [accent.opacity(0.18), TakhtTheme.card], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: TakhtTheme.radius)
        )
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(accent.opacity(0.35), lineWidth: 1))
    }
    private var arrow: some View {
        Text("→").foregroundStyle(accent).font(.system(size: 16, weight: .bold)).padding(.horizontal, 4)
    }
    private func chainNode(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 11, weight: .heavy))
                .foregroundStyle(color == accent ? accent : TakhtTheme.textDim)
            Text(value).font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(color == accent ? accent : TakhtTheme.text)
        }
        .frame(maxWidth: .infinity)
    }

    // ── UPI · Razorpay vs POS ──
    private var upiCard: some View {
        cardContainer(title: "UPI · Razorpay vs POS", icon: "indianrupeesign.circle.fill",
                      badge: model.upi == nil ? nil : "LIVE") {
            if let snaps = model.upi?.snapshots, !snaps.isEmpty {
                VStack(spacing: 7) {
                    ForEach(snaps) { s in
                        HStack(spacing: 6) {
                            Text((s.entity + (s.isRunnerQr == true ? " (runner)" : "")).capForDisplay())
                                .font(.system(size: 12.5, weight: .medium))
                                .foregroundStyle(TakhtTheme.textDim).lineLimit(1)
                            Spacer()
                            Text(TakhtFmt.rupee(s.razorpay)).font(.system(size: 13, weight: .semibold)).foregroundStyle(TakhtTheme.text)
                            Text("/r").font(.system(size: 10)).foregroundStyle(TakhtTheme.textFaint)
                            Text(TakhtFmt.rupee(s.posUpi)).font(.system(size: 13, weight: .semibold)).foregroundStyle(TakhtTheme.text)
                            Text("/p").font(.system(size: 10)).foregroundStyle(TakhtTheme.textFaint)
                            gapPill(s)
                        }
                    }
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }
    private func gapPill(_ s: TakhtUpiSnapshot) -> some View {
        let c: Color = s.isOff ? TakhtTheme.red : TakhtTheme.green
        let txt = s.isOff ? (s.gap > 0 ? "+" : "") + TakhtFmt.rupee(s.gap) : "✓"
        return Text(txt).font(.system(size: 10, weight: .heavy)).foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(c.opacity(0.16), in: Capsule())
    }

    // ── Chai · token box vs POS ──
    private var chaiCard: some View {
        cardContainer(title: "Inventory · chai", icon: "cup.and.saucer.fill", badge: nil) {
            if let t = model.token {
                metricGrid([
                    ("Weighed tokens", "\(t.tokenCount ?? 0)"),
                    ("POS beverages",  "\(t.odooTotalBeverages ?? 0)"),
                    ("Gap",            "\((t.discrepancy ?? 0) > 0 ? "+" : "")\(t.discrepancy ?? 0)"),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }

    // ── POS session ──
    private var sessionCard: some View {
        cardContainer(title: "POS session", icon: "clock.badge.checkmark.fill", badge: nil) {
            if let sh = model.shift {
                let days = (sh.shiftMinutes ?? 0) / 1440
                metricGrid([
                    ("Cashier",  sh.name?.capForDisplay(24) ?? "—"),
                    ("Open for", "\(days)d"),
                    ("State",    days > 1 ? "never closed" : "ok"),
                ])
            } else {
                Text("No shift on record").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }

    // ── Fix (built, WRITE gated) ──
    private var fixCard: some View {
        gatedAction(icon: "wrench.and.screwdriver.fill",
                    title: "Fix what's wrong",
                    sub: "One tap per error — never blocks the day. Writes to POS; switched on with owner approval.")
    }
    private var settleCard: some View {
        gatedAction(icon: "checkmark.seal.fill",
                    title: "Settle this shift",
                    sub: "Cash count + handover. Records the settlement; switched on with owner approval.")
    }
    private func gatedAction(icon: String, title: String, sub: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 14)).foregroundStyle(accent.opacity(0.8))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(TakhtTheme.text)
                Text(sub).font(.system(size: 12)).foregroundStyle(TakhtTheme.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Text("GATED").font(.system(size: 9, weight: .heavy)).foregroundStyle(TakhtTheme.amber)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(TakhtTheme.amber.opacity(0.16), in: Capsule())
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(TakhtTheme.bgElev, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(TakhtTheme.line, lineWidth: 1))
    }

    // ── Reusable card chrome ──
    private func cardContainer<Content: View>(title: String, icon: String, badge: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(accent)
                Text(title).font(.system(size: 13, weight: .bold)).foregroundStyle(TakhtTheme.textDim).textCase(.uppercase)
                Spacer()
                if let b = badge {
                    Text(b).font(.system(size: 9, weight: .heavy)).foregroundStyle(TakhtTheme.green)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(TakhtTheme.green.opacity(0.16), in: Capsule())
                }
            }
            content()
        }
        .padding(14)
        .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(TakhtTheme.line, lineWidth: 1))
    }
    private func metricGrid(_ items: [(String, String)]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 10) {
            ForEach(items, id: \.0) { label, value in
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(.system(size: 10, weight: .bold)).foregroundStyle(TakhtTheme.textFaint).textCase(.uppercase)
                    Text(value).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(TakhtTheme.text)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// ═════════════════════════ RUNNER / CAPTAIN homes ═══════════════════════════
struct RunnerHome: View {
    let accent: Color
    var body: some View { LiabilityHome(accent: accent,
        line: "Tokens you took + your direct sales − the UPI you already collected.",
        wire: "Your live ₹ owed needs the Darbar→POS runner link (your Darbar id → your POS partner). Once wired, this shows your liability and any tokens not tagged to you, all shift.") }
}
struct CaptainHome: View {
    let accent: Color
    var body: some View { LiabilityHome(accent: accent,
        line: "What you collected at the table minus what you've handed to the counter.",
        wire: "Your live number needs the Darbar→POS captain link (Darbar id → employee_id). Then it shows your owed + untagged orders.") }
}
private struct LiabilityHome: View {
    let accent: Color; let line: String; let wire: String
    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("YOUR CASH TO HAND OVER").font(.system(size: 11, weight: .heavy)).foregroundStyle(TakhtTheme.textDim)
                Text("—").font(.system(size: 44, weight: .heavy, design: .rounded)).foregroundStyle(accent)
                Text(line).font(.system(size: 13)).foregroundStyle(TakhtTheme.textDim).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(LinearGradient(colors: [accent.opacity(0.16), TakhtTheme.card], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
            .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(accent.opacity(0.3), lineWidth: 1))

            HStack(alignment: .top, spacing: 8) {
                Text("NEXT WIRE").font(.system(size: 9, weight: .heavy)).foregroundStyle(TakhtTheme.amber)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(TakhtTheme.amber.opacity(0.16), in: Capsule())
                Text(wire).font(.system(size: 12)).foregroundStyle(TakhtTheme.textFaint).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(13)
            .background(TakhtTheme.bgElev, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(TakhtTheme.line, lineWidth: 1))
        }
    }
}

// ═════════════════════════════ BRAND PICKER (HQ) ════════════════════════════
struct BrandPickerView: View {
    @ObservedObject var model: TakhtAppModel
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.identity?.name ?? "—")
                        .font(.system(size: 22, weight: .heavy, design: .serif)).foregroundStyle(TakhtTheme.text)
                    Text("HN Hotels · both brands").font(.system(size: 12)).foregroundStyle(TakhtTheme.accent)
                }
                Spacer()
                Button { model.lock() } label: {
                    Image(systemName: "lock.fill").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(TakhtTheme.text).frame(width: 38, height: 38)
                        .background(TakhtTheme.card, in: Circle())
                        .overlay(Circle().stroke(TakhtTheme.line, lineWidth: 1))
                }
            }
            .padding(16).background(TakhtTheme.bgElev)
            Spacer()
            Text("WHICH COUNTER?").font(.system(size: 12, weight: .heavy)).foregroundStyle(TakhtTheme.textDim).padding(.bottom, 16)
            HStack(spacing: 12) {
                brandButton(.nch, "Nawabi", "Chai House")
                brandButton(.he, "Hamza", "Express")
            }
            .padding(.horizontal, 20)
            Spacer(); Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private func brandButton(_ b: TakhtBrand, _ l1: String, _ l2: String) -> some View {
        Button { Task { await model.pickBrand(b) } } label: {
            VStack(spacing: 4) {
                Text(l1).font(.system(size: 22, weight: .heavy, design: .serif)).foregroundStyle(TakhtTheme.text)
                Text(l2).font(.system(size: 13, weight: .medium, design: .serif)).italic().foregroundStyle(b.accent)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 26)
            .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(b.accent.opacity(0.5), lineWidth: 1))
        }
    }
}

// ═══════════════════════════════════ GATE ═══════════════════════════════════
struct GateView: View {
    @ObservedObject var model: TakhtAppModel
    private let accent = TakhtTheme.accent
    @State private var buf = ""
    @State private var err = ""
    @State private var checking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 18).fill(TakhtTheme.bgElev)
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.5), lineWidth: 1))
                    .frame(width: 76, height: 76)
                Text("त").font(.system(size: 38, weight: .heavy, design: .serif)).foregroundStyle(accent)
            }
            Text("Takht").font(.system(size: 46, weight: .heavy, design: .serif))
                .foregroundStyle(TakhtTheme.text).padding(.top, 16)
            Text("enter your Darbar PIN")
                .font(.system(size: 14, weight: .medium, design: .serif)).italic()
                .foregroundStyle(accent).padding(.top, 2)

            HStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { i in
                    Circle().strokeBorder(accent.opacity(0.6), lineWidth: 1.5)
                        .background(Circle().fill(i < buf.count ? accent : .clear))
                        .frame(width: 12, height: 12)
                }
            }
            .padding(.top, 30).padding(.bottom, 28)

            Text(err.isEmpty ? " " : err).font(.system(size: 13)).foregroundStyle(TakhtTheme.red).frame(height: 16)
            keypad.padding(.top, 8)
            Spacer()
            Text("HN Hotels · since 1918")
                .font(.system(size: 11, weight: .medium, design: .serif)).italic()
                .foregroundStyle(accent.opacity(0.5)).padding(.bottom, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TakhtTheme.bg.ignoresSafeArea())
    }

    private var keypad: some View {
        let keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(68), spacing: 22), count: 3), spacing: 22) {
            ForEach(keys, id: \.self) { k in
                if k.isEmpty {
                    Color.clear.frame(width: 68, height: 68)
                } else {
                    Button { tap(k) } label: {
                        Text(k).font(.system(size: k == "⌫" ? 22 : 26, weight: .regular))
                            .foregroundStyle(k == "⌫" ? TakhtTheme.textDim : TakhtTheme.text)
                            .frame(width: 68, height: 68)
                            .background(k == "⌫" ? Color.clear : TakhtTheme.cardHi, in: Circle())
                    }
                    .disabled(checking)
                }
            }
        }
    }

    private func tap(_ k: String) {
        err = ""
        if k == "⌫" { if !buf.isEmpty { buf.removeLast() }; return }
        guard buf.count < 4 else { return }
        buf += k
        if buf.count == 4 { submit() }
    }
    private func submit() {
        let pin = buf
        checking = true
        Task {
            if let e = await model.unlock(pin: pin) {
                err = e; buf = ""; checking = false
            }
        }
    }
}
